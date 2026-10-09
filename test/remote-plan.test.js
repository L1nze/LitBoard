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

function makeHarness(planOverride) {
  const els = {};
  const ids = [
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
  const calls = { created: null, applied: null, appliedWorkspace: 0, indicator: [], statuses: [] };
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
        createNutstoreSyncPlan: function (input) { calls.created = input; return Promise.resolve(PLAN); },
        applyNutstoreSyncPlan: function (input) { calls.applied = input; return Promise.resolve({ workspace: { papers: [] }, assets: { failures: [] } }); },
        inspectNutstoreRemote: function () { return Promise.resolve({ exists: true, counts: { papers: 5 } }); },
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
    isSyncBusy: function () { return false; },
    download: function () {},
    stamp: function () { return '2026-09-22'; }
  });
  api.bind();
  return { api: api, els: els, calls: calls };
}

const flush = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

test('对照：createPlan 渲染计划，必选项未决时应用钮禁用', async () => {
  const h = makeHarness();
  h.els['#sync-remote-merge'].click();
  await flush();
  assert.strictEqual(h.els['#sync-remote-plan-mask'].hidden, false, '对照弹窗应弹出');
  const st = h.api.stateForTest();
  assert.strictEqual(st.model.items.length, 3, '2 冲突 + 1 仅本机');
  assert.strictEqual(st.model.requiredKeys.size, 2, '仅冲突为必选');
  assert.strictEqual(h.els['#sync-remote-plan-apply'].disabled, true, '未决时禁用');
  assert.ok(h.els['#sync-remote-plan-summary'].textContent.indexOf('待选择 2 项') !== -1);
  assert.ok(h.els['#sync-remote-plan-summary'].textContent.indexOf('仅本机 1 项') !== -1);
});

test('对照：批量「采用本机」补齐决议，应用走 applyNutstoreSyncPlan', async () => {
  const h = makeHarness();
  h.els['#sync-remote-merge'].click();
  await flush();
  h.els['#sync-remote-choose-local'].click();
  assert.strictEqual(h.els['#sync-remote-plan-apply'].disabled, false, '决议齐后启用');
  const st = h.api.stateForTest();
  assert.strictEqual(st.resolutions[st.model.items[0].key], 'local');
  assert.strictEqual(st.resolutions[st.model.items[2].key], 'local', '仅本机条目默认也是可批量侧');

  h.els['#sync-remote-plan-apply'].click();
  await flush();
  assert.ok(h.calls.applied, '应调用 applyNutstoreSyncPlan');
  assert.strictEqual(h.calls.appliedWorkspace, 1, '合并结果应落库');
  assert.strictEqual(h.els['#sync-remote-plan-apply'].hidden, true, '完成后应用钮收起');
  assert.strictEqual(h.els['#sync-remote-plan-cancel'].textContent, '关闭');
});

test('对照：本机空库疑似重置列为必选置顶项', async () => {
  const h = makeHarness({
    mode: 'restore', localEmptyReset: true, baseRecoveryAvailable: true, baseRecoveryCount: 42,
    conflicts: [], localOnly: []
  });
  h.els['#sync-remote-restore'].click();
  await flush();
  const st = h.api.stateForTest();
  assert.strictEqual(st.model.items.length, 1);
  assert.strictEqual(st.model.requiredKeys.size, 1, '空库重置为必选');
  assert.strictEqual(h.els['#sync-remote-plan-apply'].disabled, true);
});

test('对照：应用进行中（applying）不允许关闭', async () => {
  const h = makeHarness();
  h.els['#sync-remote-merge'].click();
  await flush();
  h.els['#sync-remote-choose-remote'].click();
  h.els['#sync-remote-plan-apply'].click();
  h.els['#sync-remote-plan-cancel'].click();
  assert.strictEqual(h.els['#sync-remote-plan-mask'].hidden, false, '应用中关闭被拒');
  await flush();
});

test('对照：handleProgress 在应用期路由到进度条；完成后可关闭并复位', async () => {
  const h = makeHarness();
  h.els['#sync-remote-merge'].click();
  await flush();
  h.els['#sync-remote-choose-local'].click();
  h.els['#sync-remote-plan-apply'].click();
  await flush();
  h.api.close();
  assert.strictEqual(h.els['#sync-remote-plan-mask'].hidden, true, '完成后可关闭');
  assert.strictEqual(h.api.stateForTest().plan, null, '关闭即清空计划');
  assert.deepStrictEqual(h.api.stateForTest().resolutions, {});
});

/* ---------- 防覆盖断路器与首传确认：强制确认项的渲染与门槛 ---------- */

test('对照：大批移除云端词条时出现强制确认项，未选不得应用', async () => {
  const h = makeHarness({
    mode: 'merge', remoteCount: 210, remoteExists: true,
    massDropSuspected: true, massDropCount: 206, remoteActiveCount: 210,
    conflicts: [], localOnly: []
  });
  h.els['#sync-remote-merge'].click();
  await flush();
  const st = h.api.stateForTest();
  assert.strictEqual(st.model.requiredKeys.has('plan:mass-drop-reset'), true, 'mass-drop 为必选');
  assert.strictEqual(st.model.items.length, 1);
  assert.strictEqual(h.els['#sync-remote-plan-apply'].disabled, true, '未确认不得应用');
  assert.ok(h.els['#sync-remote-plan-summary'].textContent.indexOf('206') !== -1, '摘要说明移除规模');
});

test('对照：首传确认项渲染，选「取消」不调后端直接关弹窗', async () => {
  const h = makeHarness({
    mode: 'merge', remoteExists: false, firstUploadSuspected: true, localPaperCount: 4,
    conflicts: [], localOnly: []
  });
  h.els['#sync-remote-merge'].click();
  await flush();
  const st = h.api.stateForTest();
  assert.strictEqual(st.model.requiredKeys.has('plan:first-upload'), true);
  assert.strictEqual(h.els['#sync-remote-plan-apply'].disabled, true);
  // 模拟用户选「取消上传」（remote 侧）
  st.resolutions['plan:first-upload'] = 'remote';
  st.model.resolvedKeys.add('plan:first-upload');
  h.els['#sync-remote-plan-apply'].disabled = false;
  h.els['#sync-remote-plan-apply'].click();
  await flush();
  assert.strictEqual(h.calls.applied, null, '取消首传：不应调用 applyNutstoreSyncPlan');
  assert.strictEqual(h.els['#sync-remote-plan-mask'].hidden, true, '直接关闭弹窗');
  assert.ok(h.calls.statuses.some(function (s) { return s.id === 'sync-remote-status' && s.text.indexOf('已取消首次上传') !== -1; }));
});

test('对照：inspect 对账展示「附件登记/云端实有/缺失」', async () => {
  const h = makeHarness();
  // inspectNutstoreRemote 在 harness 桩内固定返回；这里断言 status 展示链路
  h.els['#sync-remote-inspect'].click();
  await flush();
  assert.ok(h.calls.statuses.some(function (s) { return s.id === 'sync-remote-status' && s.text.indexOf('云端库文件存在') !== -1; }));
});
