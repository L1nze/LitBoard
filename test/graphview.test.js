'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GraphGen = require('../js/graphgen.js');

function loadGraphView() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id, hidden: true, value: '60', textContent: '', innerHTML: '', checked: true,
        addEventListener: function () {},
        querySelectorAll: function () { return []; }
      });
    }
    return elements.get(id);
  }
  class DataSet {
    constructor(items) { this.items = new Map((items || []).map((item) => [item.id, Object.assign({}, item)])); }
    get(id) { return this.items.get(id); }
    update(item) { this.items.set(item.id, Object.assign({}, this.items.get(item.id), item)); }
  }
  let networks = 0;
  class Network {
    constructor() { networks++; }
    destroy() {}
    fit() {}
    on() {}
    once() {}
    selectNodes() {}
    focus() {}
    setOptions() {}
    startSimulation() {}
  }
  const window = {
    LitGraphGen: GraphGen,
    LitI18n: { t: (s) => s },
    vis: { DataSet, Network },
    matchMedia: () => ({ matches: false })
  };
  const context = {
    window,
    document: {
      getElementById: element,
      documentElement: { getAttribute: () => 'light' }
    },
    performance: { now: () => 0 },
    setTimeout: () => 1,
    clearTimeout: () => {},
    fetch: async () => ({ text: async () => '' }),
    btoa: () => '', unescape, encodeURIComponent,
    Map, Set, Promise, Array, Object, String, Number, Math, Date, JSON, RegExp, Error
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/graphview.js'), 'utf8'), context);
  return { api: window.LitGraphView, elements, networkCount: () => networks, window };
}

test('GraphView：关闭只销毁视图，最近图可在原生窗口直接重开', function () {
  const harness = loadGraphView();
  const graph = {
    nodes: [{ id: 'W1', title: 'Paper', year: 2024, citedBy: 1, authors: ['Author'], seed: true }],
    edges: [], communities: { W1: 0 },
    meta: { seeds: ['W1'], depth: 1, maxNodes: 60, nodeCount: 1, edgeCount: 0, communityCount: 1 }
  };
  harness.api.showData(graph, '测试网络');
  harness.api.close();
  assert.equal(harness.elements.get('graph-mask').hidden, true);
  assert.equal(harness.api.reopen(), true);
  assert.equal(harness.elements.get('graph-mask').hidden, false);
  assert.equal(harness.networkCount(), 2, '重开应重新创建原生 vis.Network 视图');
});

test('Agent 侧提供最近引文网络快捷项并接到 GraphView.reopen', function () {
  const agentUi = fs.readFileSync(path.join(__dirname, '../js/agentui.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(agentUi, /重开最近引文网络/);
  assert.match(agentUi, /reopenGraphPanel/);
  assert.match(app, /LitGraphView\.reopen\(\)/);
});

test('最近引文网络快捷项只显示在生成它的对话', function () {
  const source = fs.readFileSync(path.join(__dirname, '../js/agentui.js'), 'utf8');
  const start = source.indexOf('  function renderAttachments(run) {');
  const end = source.indexOf('  function bridge()', start);
  assert.ok(start >= 0 && end > start);
  const wrap = { hidden: true, innerHTML: '', children: [], appendChild(node) { this.children.push(node); } };
  const context = {
    $: () => wrap, T: (s) => s,
    el: (_tag, _class, label) => ({ label, appendChild(child) { this.label = child.label; }, addEventListener() {} }),
    deps: { reopenGraphPanel: () => true },
    recentGraphSessionId: 'session-a', desk: {}
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.renderAttachments = renderAttachments;', context);
  context.renderAttachments({ id: 'session-b', doc: { attachments: [] } });
  assert.equal(wrap.hidden, true);
  assert.equal(wrap.children.length, 0);
  context.renderAttachments({ id: 'session-a', doc: { attachments: [] } });
  assert.equal(wrap.hidden, false);
  assert.equal(wrap.children.at(-1).label, '重开最近引文网络');
});

test('GraphView：close 剥离节点大字段且不改调用方数据；重开即时渲染轻量快照并按 id 回查补全摘要；__network 随销毁清空', async function () {
  const harness = loadGraphView();
  let queried = null;
  harness.api.init({
    desktop: {
      researchGraph: function () { return Promise.resolve({}); },
      researchGetWorks: function (ids) {
        queried = ids;
        return Promise.resolve([
          { id: 'W1', abstract: 'recovered abstract one' },
          { id: 'W2', abstract: 'recovered abstract two' }
        ]);
      }
    }
  });
  const graph = {
    nodes: [
      { id: 'W1', title: 'Paper', year: 2024, citedBy: 1, authors: ['Author'], abstract: '重型摘要一'.repeat(200), seed: true },
      { id: 'W2', title: 'Other', year: 2023, citedBy: 2, authors: ['Writer'], abstract: '重型摘要二'.repeat(200) }
    ],
    edges: [{ from: 'W1', to: 'W2' }], communities: { W1: 0, W2: 0 },
    meta: { seeds: ['W1'], depth: 1, maxNodes: 60, nodeCount: 2, edgeCount: 1, communityCount: 1 }
  };
  harness.api.showData(graph, '轻量重开');
  assert.ok(harness.window.__network, '渲染期间 __network 是活动视图句柄');
  harness.api.close();
  assert.equal(harness.window.__network, null, '销毁后不得再被 UI 全局钉住');
  assert.equal(graph.nodes[0].abstract, '重型摘要一'.repeat(200), 'close 只读原始数据，不得原地剥离调用方对象');
  const detail = harness.elements.get('graph-detail');
  assert.ok(harness.api.reopen(), '轻量快照可直接重开');
  assert.ok(detail.innerHTML.includes('<h2>Other</h2>'), '轻量快照仍渲染标题等小字段（默认选中 = 排位最高节点）');
  assert.ok(!detail.innerHTML.includes('重型摘要一'), '关闭时剥离的摘要不应立即出现');
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.ok(Array.isArray(queried) && queried.indexOf('W1') !== -1 && queried.indexOf('W2') !== -1,
    '重开后按节点 id 回查调研库：' + JSON.stringify(queried));
  assert.ok(detail.innerHTML.includes('recovered abstract'), '回查结果补进详情卡');
});

test('GraphView：回查查不到摘要时保持轻量展示，不报错不臆造内容', async function () {
  const harness = loadGraphView();
  let queried = null;
  harness.api.init({
    desktop: {
      researchGraph: function () { return Promise.resolve({}); },
      researchGetWorks: function (ids) { queried = ids; return Promise.resolve([]); }
    }
  });
  const graph = {
    nodes: [{ id: 'W1', title: 'Solo', year: 2024, citedBy: 1, authors: ['Author'], abstract: 'big abstract body' }],
    edges: [], communities: { W1: 0 },
    meta: { seeds: ['W1'], nodeCount: 1, edgeCount: 0, communityCount: 1 }
  };
  harness.api.showData(graph, 'T');
  harness.api.close();
  harness.api.reopen();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.ok(harness.elements.get('graph-detail').innerHTML.includes('Solo'), '查无结果也能重开渲染');
  assert.ok(!harness.elements.get('graph-detail').innerHTML.includes('big abstract body'), '摘要保持剥离');
  assert.deepEqual(queried, ['W1'], '确实发起过回查（结果为空）');
});
