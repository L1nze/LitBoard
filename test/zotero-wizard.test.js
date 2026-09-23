'use strict';
/* js/app/zotero-wizard.js 单元级：桩 DOM + 桩 desktop，走通四步状态机与导入管线。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const LitZoteroWizard = require('../js/app/zotero-wizard.js');

function makeEl() {
  return {
    textContent: '', innerHTML: '', value: '', checked: false,
    hidden: false, disabled: false, max: 0,
    handlers: {},
    addEventListener: function (type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    click: function () { (this.handlers.click || []).forEach(function (fn) { fn.call(this); }, this); }
  };
}

function makeHarness(overrides) {
  const els = {};
  [
    '#sync-zotero-dir', '#zotero-wiz-dir', '#zotero-wiz-source-status', '#zotero-import-mask',
    '#zotero-wiz-step-label', '#zotero-wiz-back', '#zotero-wiz-cancel', '#zotero-wiz-export',
    '#zotero-wiz-next', '#zotero-wiz-stats', '#zotero-wiz-progress', '#zotero-wiz-progress-text',
    '#zotero-wiz-copy', '#zotero-wiz-report', '#sync-import-zotero',
    '#zotero-wiz-detect', '#zotero-wiz-choose'
  ].forEach(function (id) { els[id] = makeEl(); });
  els['#zotero-wiz-dir'].dataset = {};
  const stepEls = [];
  // $all('#zotero-import-mask .zotero-wiz-step') → 桩集合
  const allStubs = {
    '#zotero-import-mask .zotero-wiz-step': stepEls
  };
  const calls = { scanned: null, imported: null, applied: 0, merged: 0, downloaded: [] };
  const opts = {
    T: function (s) { return s; },
    $: function (sel) { return els[sel] || null; },
    $all: function (sel) { return allStubs[sel] || []; },
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
    toast: function () {},
    desktop: function () {
      return {
        scanZoteroLibrary: function (input) { calls.scanned = input; return Promise.resolve(SCAN_RESULT); },
        detectZoteroDataDir: function () { return Promise.resolve(''); },
        chooseZoteroDataDir: function () { return Promise.resolve(''); },
        importZoteroLibrary: function (input) { calls.imported = input; return Promise.resolve(IMPORT_RESULT); },
        onZoteroProgress: function () { return function () {}; }
      };
    },
    state: function () {
      return {
        papers: [{ id: 'p1', zoteroKey: 'K1', attachments: [{ zoteroKey: 'A1', path: 'x.pdf' }] }],
        notes: [], folders: [], folderTombstones: [], tagColorRecords: []
      };
    },
    mergeZoteroImport: function (current, incoming) {
      calls.merged++;
      return { workspace: { papers: current.papers, notes: [], folders: [], tagColorRecords: [] },
        stats: { papersAdded: 1, papersUpdated: 0, attachmentsAdded: 1, notesAdded: 0, notesSkipped: 0, annotationsAdded: 0 },
        conflicts: [] };
    },
    applySyncedWorkspace: function (ws) { calls.applied++; return Promise.resolve(); },
    download: function (name, content, type) { calls.downloaded.push({ name: name, content: content, type: type }); },
    stamp: function () { return '2026-09-22'; }
  };
  Object.keys(overrides || {}).forEach(function (k) { opts[k] = overrides[k]; });
  const api = LitZoteroWizard.create(opts);
  api.bind();
  return { api: api, els: els, calls: calls, stepEls: stepEls };
}

const SCAN_RESULT = { stats: { source: { items: 3, notes: 1, attachments: 2, annotations: 0, collections: 1, tags: 2 }, missing: 1, unconverted: 0, failures: 0 } };
const IMPORT_RESULT = {
  workspace: { papers: [], notes: [], folders: [], tagColorRecords: [] },
  report: { imported: { assetsCopied: 2, assetsSkipped: 1, annotations: 0, folders: 1, tagColors: 1 },
    missing: [{ fileName: 'a.pdf', reason: 'not-found' }], failures: [], unconverted: [] }
};

test('向导：打开复位到来源步，绑定设置页目录值', () => {
  const h = makeHarness();
  h.els['#sync-zotero-dir'].value = 'D:/zotero';
  h.els['#sync-import-zotero'].click();
  assert.strictEqual(h.els['#zotero-import-mask'].hidden, false, '遮罩应显示');
  assert.strictEqual(h.api.stateForTest().step, 'source');
  assert.strictEqual(h.els['#zotero-wiz-dir'].value, 'D:/zotero');
});

test('向导：扫描 → 预览统计表 → 导入 → 报告，全链状态机', async () => {
  const flush = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  const h = makeHarness();
  h.els['#sync-zotero-dir'].value = 'D:/zotero';
  h.els['#sync-import-zotero'].click();
  h.els['#zotero-wiz-next'].click(); // source → 扫描
  await flush();
  assert.strictEqual(h.api.stateForTest().step, 'preview', '扫描完成后进预览步');
  assert.ok(h.els['#zotero-wiz-stats'].innerHTML.indexOf('zotero-report-table') !== -1);
  assert.strictEqual(h.calls.scanned.dir, 'D:/zotero');

  h.els['#zotero-wiz-copy'].checked = true;
  h.els['#zotero-wiz-next'].click(); // preview → 导入
  await flush();
  assert.strictEqual(h.calls.imported.copyFiles, true);
  assert.ok(h.calls.imported.existing.paperKeys.indexOf('K1') !== -1, '既有 zoteroKey 应收集');
  assert.strictEqual(h.calls.applied, 1, '合并结果应经 applySyncedWorkspace 落库');
  assert.strictEqual(h.api.stateForTest().step, 'report');
  const reportHtml = h.els['#zotero-wiz-report'].innerHTML;
  assert.ok(reportHtml.indexOf('新增条目') !== -1);
  assert.ok(reportHtml.indexOf('zotero-report-group') !== -1, '缺失附件等分组应渲染');

  // 报告导出
  h.els['#zotero-wiz-export'].click();
  assert.strictEqual(h.calls.downloaded.length, 1);
  assert.ok(h.calls.downloaded[0].name.indexOf('zotero-import-report-2026-09-22') === 0);

  // 完成即关闭
  h.els['#zotero-wiz-next'].click();
  assert.strictEqual(h.els['#zotero-import-mask'].hidden, true);
});

test('向导：扫描失败回到来源步并显示错误', async () => {
  const flush = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  const h = makeHarness({
    desktop: function () {
      return { scanZoteroLibrary: function () { return Promise.reject(new Error('库被占用')); } };
    }
  });
  h.els['#sync-zotero-dir'].value = 'D:/zotero';
  h.els['#sync-import-zotero'].click();
  h.els['#zotero-wiz-next'].click();
  await flush();
  assert.strictEqual(h.api.stateForTest().step, 'source');
  assert.ok(h.els['#zotero-wiz-source-status'].textContent.indexOf('库被占用') !== -1);
});

test('向导：导入中（busy）取消不生效', () => {
  const h = makeHarness();
  h.els['#sync-zotero-dir'].value = 'D:/zotero';
  h.els['#sync-import-zotero'].click();
  // 手动把状态置 busy 模拟导入进行中
  h.api.stateForTest().busy = true;
  h.els['#zotero-wiz-cancel'].click();
  assert.strictEqual(h.els['#zotero-import-mask'].hidden, false, 'busy 时不得关闭');
});
