'use strict';
/* js/app/remote-plan.js 单元级：迷你 DOM 桩 + 桩 desktop，走通对照渲染、决议与应用。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const LitRemotePlan = require('../js/app/remote-plan.js');

/* 迷你 DOM：够 createElement/append/classList/dataset 用即可 */
function makeNode(tag) {
  return {
    tagName: tag, className: '', textContent: '', innerHTML: '', value: '', hidden: false,
    disabled: false, max: 0, title: '',
    style: { cssText: '', setProperty: function () {} },
    dataset: {},
    children: [],
    classList: {
      _set: new Set(),
      add: function (c) { this._set.add(c); },
      remove: function (c) { this._set.delete(c); },
      toggle: function (c, on) { if (on === undefined) on = !this._set.has(c); on ? this._set.add(c) : this._set.delete(c); },
      contains: function (c) { return this._set.has(c); }
    },
    handlers: {},
    appendChild: function (child) { this.children.push(child); return child; },
    remove: function () {},
    setAttribute: function (k, v) { this['attr_' + k] = v; },
    removeAttribute: function (k) { delete this['attr_' + k]; },
    addEventListener: function (type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    click: function () { (this.handlers.click || []).forEach(function (fn) { fn.call(this); }, this); }
  };
}

function makeHarness(planOverride, inspection, overrides) {
  const extra = overrides || {};
  const els = {};
  const ids = [
    '#sync-remote-mirror', '#sync-mirror-options', '#sync-mirror-confirm', '#sync-mirror-cleanup', '#sync-remote-plan-title',
    '#sync-conflict-list', '#sync-conflict-mask', '#sync-remote-plan-mask', '#sync-remote-plan-list',
    '#sync-remote-plan-filter', '#sync-remote-plan-summary', '#sync-remote-plan-apply',
    '#sync-remote-plan-cancel', '#sync-remote-plan-progress', '#sync-remote-plan-progress-text',
    '#sync-remote-plan-progress-percent', '#sync-remote-plan-progress-bar',
    '#sync-remote-choose-local', '#sync-remote-choose-remote', '#sync-remote-inspect',
    '#sync-remote-restore', '#sync-remote-merge', '#sync-conflict-close', '#sync-conflict-export'
  ];
  ids.forEach(function (id) {
    els[id] = makeNode(id === '#sync-remote-plan-list' ? 'div' : 'button');
    if (id === '#sync-conflict-mask' || id === '#sync-remote-plan-mask') els[id].hidden = true; // 遮罩默认不可见，断言才有意义
    if (id === '#sync-remote-plan-filter') {
      els[id].parentElement = makeNode('div');
    }
  });
  // 渲染链需要 document.createElement / createDocumentFragment（行节点全部走桩）
  global.document = {
    createElement: function (tag) { return makeNode(tag); },
    createDocumentFragment: function () { return makeNode('fragment'); },
    querySelector: function () { return null; }
  };
  const calls = { created: null, createdCount: 0, applied: null, appliedWorkspace: 0, indicator: [], statuses: [] };
  const PLAN = planOverride || {
    mode: 'merge', remoteCount: 5, remoteExists: true,
    conflicts: [
      { collection: 'papers', entityId: 'p1', field: 'title', title: '论文 A', local: '旧题', remote: '新题' },
      { collection: 'notes', entityId: 'n1', field: 'content', title: '笔记 B', local: { title: '本地笔记' }, remote: { title: '云端笔记' } }
    ],
    localOnly: [{ collection: 'papers', entity: { id: 'p9', title: '仅本机条目' } }]
  };
  const api = LitRemotePlan.create({
    T: function (s) { return s; },
    $: function (sel) { return els[sel] || null; },
    esc: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    debounce: function (fn) { fn.flush = function () { fn(); }; return fn; },
    desktop: function () {
      return {
        createNutstoreSyncPlan: function (input) {
          calls.created = input; calls.createdCount++;
          return extra.createPlan ? extra.createPlan(input) : Promise.resolve(PLAN);
        },
        applyNutstoreSyncPlan: function (input) { calls.applied = input; return Promise.resolve({ workspace: { papers: [] }, assets: { failures: [] } }); },
        inspectNutstoreRemote: function (input) { calls.inspected = input; return inspection ? inspection() : Promise.resolve({ exists: true, counts: { papers: 5 } }); },
        getIntegrationConfig: function () { return Promise.resolve({ autoWriteBack: false }); }
      };
    },
    syncFormValue: function () { return { user: 'u' }; },
    workspacePayload: function () { return { papers: [] }; },
    setSyncInlineStatus: function (id, text, kind) { calls.statuses.push({ id: id, text: text, kind: kind }); },
    applySyncedWorkspace: function (ws) { calls.appliedWorkspace++; return Promise.resolve(); },
    applyPortableConfigRuntime: function () {},
    fillSyncForm: function () {},
    setSyncIndicator: function (stateName) { calls.indicator.push(stateName); },
    isSyncBusy: function () { return !!(extra.isSyncBusy && extra.isSyncBusy()); },
    setSyncBusy: extra.setSyncBusy,
    download: function () {},
    stamp: function () { return '2026-09-22'; }
  });
  api.bind();
  return { api: api, els: els, calls: calls };
}

const flush = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

/* ---------- 渲染、决议与应用全流程 ---------- */

test('对照：渲染计划与决议应用全流程（未决禁用 → 批量补齐 → 应用落库 → 完成复位）', async () => {
  const h = makeHarness();
  h.els['#sync-remote-merge'].click();
  await flush();
  assert.strictEqual(h.els['#sync-remote-plan-mask'].hidden, false, '对照弹窗应弹出');
  let st = h.api.stateForTest();
  assert.strictEqual(st.model.items.length, 3, '2 冲突 + 1 仅本机');
  assert.strictEqual(st.model.requiredKeys.size, 2, '仅冲突为必选');
  assert.strictEqual(h.els['#sync-remote-plan-apply'].disabled, true, '未决时禁用');
  assert.ok(h.els['#sync-remote-plan-summary'].textContent.indexOf('待选择 2 项') !== -1);
  assert.ok(h.els['#sync-remote-plan-summary'].textContent.indexOf('仅本机 1 项') !== -1);

  h.els['#sync-remote-choose-local'].click();
  assert.strictEqual(h.els['#sync-remote-plan-apply'].disabled, false, '决议齐后启用');
  st = h.api.stateForTest();
  assert.strictEqual(st.resolutions[st.model.items[0].key], 'local');
  assert.strictEqual(st.resolutions[st.model.items[2].key], 'local', '仅本机条目默认也是可批量侧');

  h.els['#sync-remote-plan-apply'].click();
  h.els['#sync-remote-plan-cancel'].click();
  assert.strictEqual(h.els['#sync-remote-plan-mask'].hidden, false, '应用中关闭被拒');
  await flush();
  assert.ok(h.calls.applied, '应调用 applyNutstoreSyncPlan');
  assert.strictEqual(h.calls.appliedWorkspace, 1, '合并结果应落库');
  assert.strictEqual(h.els['#sync-remote-plan-apply'].hidden, true, '完成后应用钮收起');
  assert.strictEqual(h.els['#sync-remote-plan-cancel'].textContent, '关闭');

  h.api.close();
  assert.strictEqual(h.els['#sync-remote-plan-mask'].hidden, true, '完成后可关闭');
  assert.strictEqual(h.api.stateForTest().plan, null, '关闭即清空计划');
  assert.deepStrictEqual(h.api.stateForTest().resolutions, {});
});

/* ---------- 防覆盖断路器与首传确认：强制确认项的渲染与门槛 ---------- */

test('对照：空库重置 / 大批移除 / 首传均为必选确认项，未决不得应用', async () => {
  const reset = makeHarness({ mode: 'restore', localEmptyReset: true, baseRecoveryAvailable: true,
    baseRecoveryCount: 42, conflicts: [], localOnly: [] });
  reset.els['#sync-remote-restore'].click(); await flush();
  assert.strictEqual(reset.api.stateForTest().model.items.length, 1);
  assert.strictEqual(reset.api.stateForTest().model.requiredKeys.size, 1, '空库重置为必选');
  assert.strictEqual(reset.els['#sync-remote-plan-apply'].disabled, true);

  const drop = makeHarness({ mode: 'merge', remoteCount: 210, remoteExists: true,
    massDropSuspected: true, massDropCount: 206, remoteActiveCount: 210, conflicts: [], localOnly: [] });
  drop.els['#sync-remote-merge'].click(); await flush();
  const dropState = drop.api.stateForTest();
  assert.strictEqual(dropState.model.requiredKeys.has('plan:mass-drop-reset'), true, 'mass-drop 为必选');
  assert.strictEqual(dropState.model.items.length, 1);
  assert.strictEqual(drop.els['#sync-remote-plan-apply'].disabled, true, '未确认不得应用');
  assert.ok(drop.els['#sync-remote-plan-summary'].textContent.indexOf('206') !== -1, '摘要说明移除规模');

  const first = makeHarness({ mode: 'merge', remoteExists: false, firstUploadSuspected: true, localPaperCount: 4,
    conflicts: [], localOnly: [] });
  first.els['#sync-remote-merge'].click(); await flush();
  const firstState = first.api.stateForTest();
  assert.strictEqual(firstState.model.requiredKeys.has('plan:first-upload'), true);
  assert.strictEqual(first.els['#sync-remote-plan-apply'].disabled, true);
  // 模拟用户选「取消上传」（remote 侧）：不调后端，直接关弹窗
  firstState.resolutions['plan:first-upload'] = 'remote';
  firstState.model.resolvedKeys.add('plan:first-upload');
  first.els['#sync-remote-plan-apply'].disabled = false;
  first.els['#sync-remote-plan-apply'].click();
  await flush();
  assert.strictEqual(first.calls.applied, null, '取消首传：不应调用 applyNutstoreSyncPlan');
  assert.strictEqual(first.els['#sync-remote-plan-mask'].hidden, true, '直接关闭弹窗');
  assert.ok(first.calls.statuses.some(function (s) { return s.id === 'sync-remote-status' && s.text.indexOf('已取消首次上传') !== -1; }));
});

/* ---------- 检查（inspect）状态行 ---------- */

test('对照：inspect 状态行——对账明细与核验未知时的措辞', async () => {
  const h = makeHarness(null, () => Promise.resolve({ exists: true, checkedAt: Date.now(),
    counts: { papers: 0, attachments: 4, pdfs: 3, webSnapshots: 1 },
    assetCheck: { registered: 3, existing: 2, missing: 1, unregistered: 1 } }));
  await h.api.inspect();
  assert.equal(h.calls.inspected.verifyAssets, true);
  assert.deepEqual(h.calls.inspected.config, { user: 'u' });
  const status = h.calls.statuses.at(-1);
  assert.match(status.text, /本机有效文献：0 篇.*云端有效文献：0 篇/);
  assert.match(status.text, /云端库附件：4（PDF 3 · 网页快照：1 · 其他：0）/);
  assert.match(status.text, /已核验存在：2\/3 · 缺失文件：1/);
  assert.match(status.text, /未登记云端文件：1/);
  assert.equal(status.kind, 'warning');
  const unknown = makeHarness();
  await unknown.api.inspect();
  assert.match(unknown.calls.statuses.at(-1).text, /云端有效文献：5 篇/, '默认检查也展示云端计数');
  assert.match(unknown.calls.statuses.at(-1).text, /附件文件尚未核验/);
  assert.equal(unknown.calls.statuses.at(-1).kind, 'warning');
});

test('过期检查不能覆盖新检查或同步中的状态', async () => {
  const pending = [];
  const h = makeHarness(null, () => new Promise(resolve => pending.push(resolve)));
  const first = h.api.inspect();
  const second = h.api.inspect();
  pending[1]({ exists: true, counts: { papers: 2 } });
  await second;
  pending[0]({ exists: true, counts: { papers: 9 } });
  await first;
  assert.match(h.calls.statuses.at(-1).text, /云端有效文献：2 篇/);
  const third = h.api.inspect();
  h.api.invalidateInspection();
  pending[2]({ exists: true, counts: { papers: 9 } });
  await third;
  assert.equal(h.calls.statuses.at(-1).text, '云端状态待刷新');
});

/* ---------- 仅云端条目与整理预览 ---------- */

test('普通对照展示仅云端条目，已删除条目不进入展示和批量选择', async () => {
  const h = makeHarness({ mode: 'merge', remoteCount: 1, conflicts: [], localOnly: [], remoteOnly: [
    { collection: 'papers', id: 'cloud', entity: { title: 'Cloud only' } },
    { collection: 'papers', id: 'deleted', entity: { title: 'Deleted', deletedAt: 1 } }
  ] });
  h.api.createPlan('merge'); await flush();
  const items = h.api.stateForTest().model.items;
  assert.equal(items.length, 1); assert.equal(items[0].kind, 'info');
  assert.match(items[0].label, /仅云端.*Cloud only/);
  h.els['#sync-remote-choose-local'].click();
  assert.deepEqual(h.api.stateForTest().resolutions, {});
});

test('整理预览列出文件，须单独确认；默认不归档多余文件', async () => {
  const h = makeHarness({ mode: 'mirror', planId: 'mirror-test', localCount: 0, remoteCount: 1, cleanupSupported: true,
    changes: [{ collection: 'papers', id: 'extra', title: 'Extra', action: 'remove' }],
    extras: [{ name: 'orphan.pdf' }], missing: [{ name: 'missing.pdf', hasLocalPath: false }], archivePath: 'backups/cleanup-test/' });
  h.els['#sync-remote-mirror'].click(); await flush();
  assert.equal(h.calls.created.mode, 'mirror');
  assert.equal(h.els['#sync-mirror-options'].hidden, false);
  assert.equal(h.els['#sync-remote-choose-local'].hidden, true);
  assert.equal(h.els['#sync-remote-plan-apply'].disabled, true);
  assert.equal(h.api.stateForTest().model.items.length, 3);
  h.api.apply(); assert.equal(h.calls.applied, null);
  h.els['#sync-mirror-confirm'].checked = true;
  h.els['#sync-mirror-confirm'].handlers.change[0].call(h.els['#sync-mirror-confirm']);
  assert.equal(h.els['#sync-remote-plan-apply'].disabled, false);
  h.api.apply(); await flush();
  assert.equal(h.calls.applied.resolutions['mirror:confirm'], 'local');
  assert.equal(h.calls.applied.resolutions['mirror:cleanup'], 'remote');
});

/* ---------- 生成期竞态回归：镜像预览是分钟级只读任务，期间后台同步曾把对照结果静默作废 ---------- */

function deferredHarness(overrides) {
  let release = null;
  const planPromise = new Promise(function (resolve) { release = resolve; });
  const h = makeHarness(null, null, Object.assign({ createPlan: function () { return planPromise; } }, overrides));
  return { h: h, release: release };
}

test('对照：生成期占用同步位——重复点击与手动检查让路、进度透状态行、完成释放并弹出', async () => {
  const busyLog = [];
  const d = deferredHarness({ setSyncBusy: function (v) { busyLog.push(v); } });
  d.h.els['#sync-remote-mirror'].click();
  assert.strictEqual(busyLog[busyLog.length - 1], true, '生成开始即占用同步位（后台防抖/定时同步据此让路）');
  assert.strictEqual(d.h.api.stateForTest().creating, true);
  d.h.els['#sync-remote-merge'].click();
  d.h.api.inspect();
  await flush();
  assert.strictEqual(d.h.calls.createdCount, 1, '生成中重复点击不重复发起 IPC');
  assert.strictEqual(d.h.calls.inspected, undefined, '生成中的手动检查被顺延，不抢状态行');

  d.h.api.handleProgress({ scope: 'plan', phase: 'extras', message: '正在核对多余文件（1/3）：a.pdf' });
  const last = d.h.calls.statuses[d.h.calls.statuses.length - 1];
  assert.strictEqual(last.id, 'sync-remote-status');
  assert.strictEqual(last.kind, 'pending');
  assert.match(last.text, /多余文件/);
  const before = d.h.calls.statuses.length;
  d.h.api.handleProgress({ scope: 'sync', phase: 'assets', message: '后台阶段' });
  assert.strictEqual(d.h.calls.statuses.length, before, '非计划进度不改对照状态行');

  d.release({ mode: 'merge', remoteCount: 5, remoteExists: true, conflicts: [], localOnly: [] });
  await flush(); await flush();
  assert.strictEqual(d.h.els['#sync-remote-plan-mask'].hidden, false, '对照应正常弹出');
  assert.strictEqual(busyLog[busyLog.length - 1], false, '结束后释放同步位');
  assert.strictEqual(d.h.api.stateForTest().creating, false);
});

test('对照：生成被取代显式作废不悬挂；后台同步进行中点生成给出友好提示', async () => {
  const d = deferredHarness();
  d.h.els['#sync-remote-mirror'].click();
  d.h.api.invalidateInspection(); // 模拟并发失效（修复前这一步会把结果静默吞掉）
  d.release({ mode: 'merge', remoteCount: 5, remoteExists: true, conflicts: [], localOnly: [] });
  await flush(); await flush();
  assert.strictEqual(d.h.els['#sync-remote-plan-mask'].hidden, true, '被取代的结果不开弹窗');
  const last = d.h.calls.statuses[d.h.calls.statuses.length - 1];
  assert.strictEqual(last.id, 'sync-remote-status');
  assert.strictEqual(last.kind, 'warning');
  assert.match(last.text, /已作废/);
  assert.strictEqual(d.h.api.stateForTest().creating, false);

  const busy = makeHarness(null, null, { isSyncBusy: function () { return true; } });
  busy.els['#sync-remote-mirror'].click();
  await flush();
  assert.strictEqual(busy.calls.createdCount, 0, '后台同步中不发起 IPC，不去撞主进程任务锁');
  assert.strictEqual(busy.api.stateForTest().creating, false);
  assert.match(busy.calls.statuses[busy.calls.statuses.length - 1].text, /后台同步/);
  assert.strictEqual(busy.calls.statuses[busy.calls.statuses.length - 1].kind, 'warning');
});
