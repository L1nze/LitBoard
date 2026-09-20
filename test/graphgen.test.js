'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/graphgen.js');

function fakeLib() {
  // 库行：A 引 B、C；B 引 C；D 无出边
  return {
    A: { id: 'A', title: 'Alpha', year: 2020, citedBy: 10, doi: '10.1/a', refs: ['B', 'C'] },
    B: { id: 'B', title: 'Beta', year: 2021, citedBy: 5, refs: ['C'] },
    C: { id: 'C', title: 'Gamma', year: 2019, citedBy: 100, refs: [] },
    D: { id: 'D', title: 'Delta', year: 2022, citedBy: 1, refs: ['A'] }
  };
}

function makeDeps(lib, missingMap) {
  return {
    getWorks: async function (ids) { return ids.map((id) => lib[id]).filter(Boolean); },
    fetchMissing: async function (ids) { return ids.map((id) => (missingMap || {})[id]).filter(Boolean); }
  };
}

test('buildGraphData: depth-1 BFS with induced subgraph edges only', async function () {
  const deps = makeDeps(fakeLib());
  const r = await G.buildGraphData(['A'], { depth: 1, maxNodes: 200 }, deps);
  const ids = r.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['A', 'B', 'C']);
  // 诱导子图：A→B、A→C、B→C；不含 D（未扩到）
  const edgeKeys = r.edges.map((e) => e.from + '→' + e.to).sort();
  assert.deepEqual(edgeKeys, ['A→B', 'A→C', 'B→C']);
  assert.equal(r.meta.depth, 1);
  assert.equal(r.meta.nodeCount, 3);
  assert.equal(r.meta.edgeCount, 3);
  assert.ok(r.meta.builtAt);
  assert.equal(r.nodes.filter((n) => n.seed).length, 1);
});

test('buildGraphData: missing neighbors fetched then joined', async function () {
  const lib = fakeLib();
  const missing = { E: { id: 'E', title: 'Epsilon', refs: ['C'] } };
  lib.A.refs = ['B', 'E'];
  const deps = makeDeps(lib, missing);
  const r = await G.buildGraphData(['A'], { depth: 2, maxNodes: 200 }, deps);
  assert.ok(r.nodes.some((n) => n.id === 'E'));
  assert.ok(r.edges.some((e) => e.from === 'E' && e.to === 'C'));
});

test('buildGraphData: maxNodes cap picks most-referenced candidates', async function () {
  // 两个种子都引用 N99（频次 2），其余 14 个邻居各被引用 1 次；
  // cap=10 → 扩出 8 个邻居（2 种子 + 8 = 10 节点），N99 频次最高必进集合
  const lib = { S1: { id: 'S1', title: 'S1', refs: [] }, S2: { id: 'S2', title: 'S2', refs: [] } };
  for (let i = 0; i < 14; i++) lib['N' + i] = { id: 'N' + i, title: 'N' + i, refs: [] };
  lib.N99 = { id: 'N99', title: 'Hub', refs: [] };
  lib.S1.refs = ['N99'].concat(Array.from({ length: 7 }, (_, i) => 'N' + i));
  lib.S2.refs = ['N99'].concat(Array.from({ length: 7 }, (_, i) => 'N' + (i + 7)));
  const r = await G.buildGraphData(['S1', 'S2'], { depth: 1, maxNodes: 10 }, makeDeps(lib));
  assert.ok(r.nodes.length <= 10, 'nodes=' + r.nodes.length);
  assert.ok(r.nodes.some((n) => n.id === 'N99')); // 高频被引者优先进
});

test('buildGraphData: empty seeds yield empty graph with meta', async function () {
  const r = await G.buildGraphData([], { depth: 2, maxNodes: 200 }, makeDeps(fakeLib()));
  assert.equal(r.nodes.length, 0);
  assert.equal(r.edges.length, 0);
  assert.equal(r.meta.nodeCount, 0);
});

test('pageRank ranks cited hubs above citations', function () {
  const ids = ['A', 'B', 'C'];
  const edges = [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }];
  const ranks = G.pageRank(ids, edges);
  assert.ok(ranks.get('C') > ranks.get('A'));
  assert.ok(ranks.get('C') > ranks.get('B'));
  // 和 ≈ 1
  let sum = 0;
  ranks.forEach((v) => { sum += v; });
  assert.ok(Math.abs(sum - 1) < 1e-6);
});

test('escapeForInlineScript neutralizes script-closing sequences', function () {
  const evil = '</script><img src=x onerror=alert(1)> and <!--x-->';
  const safe = G.escapeForInlineScript(JSON.stringify({ t: evil }));
  assert.ok(safe.indexOf('</script') === -1);
  assert.ok(safe.indexOf('<!--') === -1);
  // 能被 JSON.parse 无损还原
  const roundTrip = JSON.parse(safe);
  assert.equal(roundTrip.t, evil);
});

test('renderGraphHtml: offline self-contained, no raw closing script inside data, meta embedded', function () {
  const data = {
    nodes: [{ id: 'A', title: 'Hello </script><script>alert(1)</script>', year: 2020, citedBy: 1 }],
    edges: [],
    meta: { seeds: ['A'], depth: 2, maxNodes: 200, nodeCount: 1, edgeCount: 0, builtAt: '2026-09-20T00:00:00Z' }
  };
  const libText = 'var vis={DataSet:function(){},Network:function(){}};';
  const html = G.renderGraphHtml(data, libText, { title: '测试图' });
  // 正文只允许两处 </script>（库块与初始化块的收尾）
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.ok(html.indexOf('测试图') !== -1);
  assert.ok(html.indexOf('构建于：2026-09-20') !== -1);
  // 数据区：恶意串已被转义为安全序列（可被 JSON.parse 还原）
  const m = html.match(/^var DATA=JSON\.parse\("(.*)"\);$/m);
  assert.ok(m, 'payload present');
  assert.ok(m[1].indexOf('</script') === -1);
  const restored = JSON.parse(JSON.parse('"' + m[1] + '"'));
  assert.equal(restored.nodes[0].label, data.nodes[0].title); // 原始标题（5 词内不截断）落在 vis label 上
  assert.equal(restored.meta.depth, 2);
});
