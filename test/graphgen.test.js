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

/* 两个 6 篇论文的互引簇（各成员互相引用），中间一条桥边 —— 社区划分的经典样本 */
function twoCommunities() {
  const lib = {};
  for (let i = 0; i < 6; i++) lib['A' + i] = { id: 'A' + i, title: 'Alpha ' + i, year: 2000 + i, citedBy: 10 + i, refs: [] };
  for (let i = 0; i < 6; i++) lib['B' + i] = { id: 'B' + i, title: 'Beta ' + i, year: 2010 + i, citedBy: 5, refs: [] };
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      if (i === j) continue;
      lib['A' + i].refs.push('A' + j);
      lib['B' + i].refs.push('B' + j);
    }
  }
  lib.A0.refs.push('B0');
  return lib;
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
  assert.equal(r.meta.version, 2);
  assert.equal(r.nodes.filter((n) => n.seed).length, 1);
  // 指标随行落库：度数 / PageRank / 社区
  const c = r.nodes.find((n) => n.id === 'C');
  assert.equal(c.inDeg, 2);
  assert.equal(c.outDeg, 0);
  assert.ok(c.rank > r.nodes.find((n) => n.id === 'A').rank);
  assert.equal(typeof r.communities.C, 'number');
});

test('buildGraphData: depth 0 = 只用给定文献（literature-mcp 诱导子图原语义）', async function () {
  const r = await G.buildGraphData(['A', 'B'], { depth: 0, maxNodes: 200 }, makeDeps(fakeLib()));
  assert.deepEqual(r.nodes.map((n) => n.id).sort(), ['A', 'B']);
  assert.deepEqual(r.edges.map((e) => e.from + '→' + e.to), ['A→B']);
  assert.ok(r.nodes.every((n) => n.seed));
});

test('buildGraphData: missing 种子如实上报，不静默丢弃', async function () {
  const r = await G.buildGraphData(['A', 'NOPE'], { depth: 0, maxNodes: 200 }, makeDeps(fakeLib()));
  assert.deepEqual(r.missing, ['NOPE']);
  assert.equal(r.meta.missingCount, 1);
  assert.equal(r.nodes.length, 1);
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

test('buildGraphData: 默认 120、硬上限 500，超限后按重要性截取', async function () {
  assert.equal(G.DEFAULTS.maxNodes, 120);
  assert.equal(G.MAX_NODES, 500);
  const lib = {};
  for (let i = 0; i < 620; i++) lib['W' + i] = { id: 'W' + i, title: 'W' + i, citedBy: i, refs: [] };
  const r = await G.buildGraphData(Object.keys(lib), { depth: 0, maxNodes: 900 }, makeDeps(lib));
  assert.equal(r.meta.maxNodes, 500);
  assert.equal(r.nodes.length, 500);
  assert.equal(r.meta.totalCount, 500); // 种子输入本身按 MAX_SEEDS=500 截取
  assert.equal(r.meta.hiddenCount, 0);
});

test('buildGraphData: empty seeds yield empty graph with meta', async function () {
  const r = await G.buildGraphData([], { depth: 2, maxNodes: 200 }, makeDeps(fakeLib()));
  assert.equal(r.nodes.length, 0);
  assert.equal(r.edges.length, 0);
  assert.equal(r.meta.nodeCount, 0);
});

test('buildGraphData: 种子超过上限时按重要性截取并如实回报隐藏数', async function () {
  const lib = {};
  for (let i = 0; i < 40; i++) {
    lib['W' + i] = { id: 'W' + i, title: 'Paper ' + i, year: 2000 + (i % 10), citedBy: i, refs: [] };
  }
  // 成环互引，保证每篇都有度；W39 被引最高
  for (let i = 0; i < 40; i++) lib['W' + i].refs = ['W' + ((i + 1) % 40), 'W39'];
  const r = await G.buildGraphData(Object.keys(lib), { depth: 0, maxNodes: 12 }, makeDeps(lib));
  assert.equal(r.nodes.length, 12);
  assert.equal(r.meta.totalCount, 40);
  assert.equal(r.meta.hiddenCount, 28);
  assert.equal(r.meta.truncated, true);
  assert.ok(r.nodes.some((n) => n.id === 'W39'), '高被引者必须在保留集里');
  // 边只在保留集内部（诱导子图）
  const kept = new Set(r.nodes.map((n) => n.id));
  assert.ok(r.edges.every((e) => kept.has(e.from) && kept.has(e.to)));
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

test('selectImportantNodes: 上限内全保留；超限按 被引/PageRank/被引/年份 择优', function () {
  const nodes = [
    { id: 'hot', title: 'Hot', year: 2010, citedBy: 1000 },
    { id: 'mid', title: 'Mid', year: 2020, citedBy: 100 },
    { id: 'new', title: 'New', year: 2024, citedBy: 1 }
  ];
  const all = G.selectImportantNodes(nodes, [], 10);
  assert.deepEqual(all.kept.sort(), ['hot', 'mid', 'new']);
  assert.equal(all.hidden.length, 0);
  const cut = G.selectImportantNodes(nodes, [], 1);
  assert.deepEqual(cut.kept, ['hot']);
  assert.deepEqual(cut.hidden, ['mid', 'new']);
  assert.ok(cut.scores.hot > cut.scores.new);
});

test('detectCommunities: 两个互引簇分成两个社区，编号按规模降序', function () {
  const lib = twoCommunities();
  const nodes = Object.keys(lib).map((id) => ({ id, year: lib[id].year, citedBy: lib[id].citedBy }));
  const edges = [];
  Object.keys(lib).forEach((id) => lib[id].refs.forEach((to) => edges.push({ from: id, to })));
  const communities = G.detectCommunities(nodes.map((n) => n.id), edges);
  const a = communities.get('A3');
  const b = communities.get('B3');
  assert.notEqual(a, b, '两个簇不该同社区');
  assert.equal(communities.get('A0'), a);
  assert.equal(communities.get('B5'), b);
  assert.equal(a, 0, '规模相同/更大者编号更小（此处 A 簇被引更高，先排序）');
});

test('detectCommunities: 无边图退化为各自独立社区；大图走 Louvain 分支不抛错', function () {
  const single = G.detectCommunities(['x', 'y'], []);
  assert.equal(single.get('x'), 0);
  assert.equal(single.get('y'), 1);
  // 501 节点触发大图分支（>500）
  const ids = [];
  const edges = [];
  for (let i = 0; i < 501; i++) {
    ids.push('n' + i);
    if (i > 0) edges.push({ from: 'n' + i, to: 'n' + (i - 1) });
  }
  const big = G.detectCommunities(ids, edges);
  assert.equal(big.size, 501);
  assert.ok(big.get('n0') !== undefined);
});

test('computeLayout: 确定性、无 NaN、按 √n 铺开', function () {
  const lib = twoCommunities();
  const edges = [];
  Object.keys(lib).forEach((id) => lib[id].refs.forEach((to) => edges.push({ from: id, to })));
  const ids = Object.keys(lib);
  const a = G.computeLayout(ids, edges);
  const b = G.computeLayout(ids, edges);
  assert.deepEqual(Array.from(a.keys()), Array.from(b.keys()));
  ids.forEach((id) => {
    const p = a.get(id);
    assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), id + ' 坐标必须有限');
    assert.deepEqual(p, b.get(id), id + ' 同图同坐标');
  });
  const radius = Math.max(...ids.map((id) => Math.hypot(a.get(id)[0], a.get(id)[1])));
  assert.ok(radius > 90 * Math.sqrt(ids.length) * 0.2, '应铺开而不是挤成一团');
});

test('viewerData: 稀疏标签、年份顺序配色、被引对数尺寸、线深分层', function () {
  const lib = {};
  for (let i = 0; i < 60; i++) {
    lib['W' + i] = {
      id: 'W' + i, title: 'Title ' + i, year: 2000 + (i % 20), citedBy: i * 3,
      authors: [{ name: 'Surname' + i + ' Given' }], sourceName: 'J', refs: []
    };
  }
  // 环形互引 + 一个被反复引用的枢纽：局部结构强度有差异（否则线深会是一条直线）
  for (let i = 0; i < 60; i++) {
    lib['W' + i].refs = ['W' + ((i + 1) % 60), 'W' + ((i + 7) % 60)];
    if (i % 5 === 0) lib['W' + i].refs.push('W3');
  }
  const ids = Object.keys(lib);
  const edges = [];
  ids.forEach((id) => lib[id].refs.forEach((to) => edges.push({ from: id, to })));
  const graph = {
    nodes: ids.map((id) => ({
      id, title: lib[id].title, year: lib[id].year, citedBy: lib[id].citedBy,
      authors: ['Surname' + id.slice(1) + ' Given'], refs: lib[id].refs, sourceName: 'J'
    })),
    edges,
    communities: Object.fromEntries(ids.map((id, i) => [id, i % 3])),
    meta: { nodeCount: ids.length, edgeCount: edges.length, seeds: [], depth: 1, maxNodes: 60 }
  };
  const view = G.viewerData(graph, { palette: 'light' });
  const labelled = view.nodes.filter((n) => n.label);
  assert.equal(labelled.length, G.labelLimit(ids.length));
  assert.ok(labelled.length < ids.length, '不该每个节点都挂标签（hairball 的根源）');
  assert.ok(view.nodes.every((n) => !n.label || /^[A-Za-z]+, \d{4}$/.test(n.label)), '标签形态 = 第一作者姓氏, 年份');
  // 尺寸随时间单调（被引越多越大），且落在参考实现的区间内
  const biggest = view.nodes.reduce((acc, n) => (n.citationCount > acc.citationCount ? n : acc), view.nodes[0]);
  const smallest = view.nodes.reduce((acc, n) => (n.citationCount < acc.citationCount ? n : acc), view.nodes[0]);
  assert.equal(biggest.size, G.PALETTES && 34);
  assert.equal(smallest.size, 13);
  // 节点颜色按年份使用连续顺序色阶；社区仍用于线强度与详情指标，不劫持节点色彩。
  assert.notEqual(view.nodes[0].color.background, view.nodes[3].color.background);
  assert.notEqual(view.nodes[0].color.background, view.nodes[1].color.background);
  // 线深：强度不同 → alpha 分层，且都在参考区间内
  const alphas = view.edges.map((e) => Number(e.color.color.match(/([\d.]+)\)$/)[1]));
  assert.ok(Math.min(...alphas) >= 0.035 && Math.max(...alphas) <= 0.22);
  assert.ok(new Set(alphas.map((a) => a.toFixed(3))).size > 1, '线深应有分层而不是一条直线');
  assert.ok(view.defaultSelectedId, '默认选中排位最高的节点');
  assert.equal(view.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), true);
});

test('viewerData: 深浅主题各用一套年份顺序色阶', function () {
  const graph = {
    nodes: [
      { id: 'a', title: 'A', year: 1990, citedBy: 1, authors: ['One'], refs: [] },
      { id: 'b', title: 'B', year: 2008, citedBy: 4, authors: ['Two'], refs: [] },
      { id: 'c', title: 'C', year: 2024, citedBy: 9, authors: ['Three'], refs: [] }
    ],
    edges: [{ from: 'b', to: 'a' }, { from: 'c', to: 'b' }], communities: { a: 0, b: 1, c: 0 }, meta: {}
  };
  const light = G.viewerData(graph, { palette: 'light' });
  const dark = G.viewerData(graph, { palette: 'dark' });
  assert.notEqual(light.nodes[0].color.background, dark.nodes[0].color.background);
  assert.notEqual(light.nodes[0].color.background, light.nodes[2].color.background, '同社区的不同年份也应有不同颜色');
  assert.notEqual(light.nodes[0].color.background, light.nodes[1].color.background, '年份连续变化应映射到不同颜色');
  assert.notEqual(dark.nodes[0].color.background, dark.nodes[2].color.background, '深色主题同样按年份映射');
});

test('图例使用与节点同源的年份渐变色条', function () {
  const graph = {
    nodes: [
      { id: 'a', title: 'A', year: 1990, citedBy: 1, authors: ['One'], refs: [] },
      { id: 'b', title: 'B', year: 2024, citedBy: 9, authors: ['Two'], refs: [] }
    ],
    edges: [{ from: 'b', to: 'a' }], communities: { a: 0, b: 1 }, meta: {}
  };
  const view = G.viewerData(graph, { palette: 'light' });
  const legend = G.legendHtml(view);
  assert.ok(legend.includes('yearbar'), legend);
  assert.ok(legend.includes('linear-gradient'), legend);
  assert.ok(legend.includes(String(view.yearMin)), legend);
  assert.ok(legend.includes(String(view.yearMax)), legend);
});

test('三栏版式与交互：列表/详情/图例都由数据侧预渲染（导出与应用内共用）', function () {
  const graph = {
    nodes: [
      { id: 'W1', title: 'Seed paper', year: 2020, citedBy: 12, authors: ['Zhang San', 'Li Si'], sourceName: 'Nature', abstract: 'abstract text', seed: true, refs: [] },
      { id: 'W2', title: 'Cited paper', year: 2018, citedBy: 3, authors: ['Wang Wu'], sourceName: 'Science', refs: [] }
    ],
    edges: [{ from: 'W1', to: 'W2' }],
    communities: { W1: 0, W2: 0 },
    meta: { nodeCount: 2, edgeCount: 1, seeds: ['W1'], depth: 1, maxNodes: 120, builtAt: '2026-09-21T00:00:00Z' }
  };
  const view = G.viewerData(graph, { palette: 'light' });
  const list = G.paperListHtml(view, 'W1');
  assert.ok(list.includes('paper-row active'), '选中行高亮');
  assert.ok(list.includes('origin-label'), '种子来源标记');
  assert.ok(list.includes('Seed paper') && list.includes('Cited paper'));
  const detail = G.detailHtml(view.nodes.find((n) => n.id === 'W1'), view.texts);
  assert.ok(detail.includes('Seed paper'));
  assert.ok(detail.includes('abstract text'));
  assert.ok(detail.includes('W1'));
  assert.ok(detail.includes('Nature'));
  const legend = G.legendHtml(view);
  assert.ok(legend.includes('yearbar') && legend.includes('physicsToggle'));
  const summary = G.metaSummary(view.meta, view.texts);
  assert.ok(summary.includes('节点 2'));
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

test('renderGraphHtml: 三栏离线自包含、数据区不可逃逸、meta 与截断如实呈现', function () {
  const data = {
    nodes: [{
      id: 'A', title: 'Hello </script><script>alert(1)</script>', year: 2020, citedBy: 1,
      authors: ['Eve Attacker'], refs: [], seed: true
    }],
    edges: [],
    communities: { A: 0 },
    meta: {
      seeds: ['A'], depth: 2, maxNodes: 120, nodeCount: 1, edgeCount: 0,
      totalCount: 9, hiddenCount: 8, truncated: true, communityCount: 1, builtAt: '2026-09-20T00:00:00Z'
    }
  };
  const libText = 'var vis={DataSet:function(){},Network:function(){}};';
  const html = G.renderGraphHtml(data, libText, { title: '测试图' });
  // 正文只允许两处 </script>（库块与初始化块的收尾）
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.ok(html.indexOf('测试图') !== -1);
  assert.ok(html.indexOf('构建于 2026-09-20') !== -1);
  assert.ok(html.indexOf('按重要性保留 1 篇，隐藏 8 篇') !== -1, '截断必须如实报出：' + html.slice(0, 200));
  // 三栏骨架与图例都在
  assert.ok(html.indexOf('id="paperList"') !== -1);
  assert.ok(html.indexOf('id="detailCard"') !== -1);
  assert.ok(html.indexOf('id="net"') !== -1);
  assert.ok(html.indexOf('id="legend"') !== -1);
  // 数据区：恶意串已被转义为安全序列（可被 JSON.parse 还原）
  const m = html.match(/^var DATA=JSON\.parse\("(.*)"\);$/m);
  assert.ok(m, 'payload present');
  assert.ok(m[1].indexOf('</script') === -1);
  const restored = JSON.parse(JSON.parse('"' + m[1] + '"'));
  assert.equal(restored.nodes[0].paperTitle, data.nodes[0].title);
  assert.equal(restored.texts.papers, '本图论文');
  assert.ok(restored.options.physics.barnesHut, '力导向参数随快照固化');
  assert.equal(restored.options.smooth, undefined);
});
