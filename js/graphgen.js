/* LitBoard 引文网络：图构建 + 版式（浏览器 / Node 共用，纯逻辑零依赖）
 *
 * 构建与分析逻辑整体对照 literature-mcp（openalex_mcp/graph/）：
 * - core.build_citation_graph：节点 = 请求的文献集合，诱导子图（两端都在集合内才成边，
 *   边向 = from 引用 to），不在库中的 ID 如实上报（missing）；
 * - __init__._select_important_nodes：超过可视上限时按重要性截取
 *   （.50 被引 + .25 PageRank + .15 集合内被引 + .10 奠基年份），并如实回报隐藏了多少篇；
 * - metrics.detect_communities：小图贪心模块度（CNM）/ 大图 Louvain 局部移动，
 *   社区号按规模降序（0 = 最大社区）；
 * - visualize.py：确定性弹簧布局预置坐标 → 浏览器短暂力导向收敛后自动冻结；颜色 = 年份、
 *   大小 = 被引量稳健对数缩放（5/95 分位裁剪）、线深 = 局部引用强度、标签只给重要节点
 *   （其余悬停显示）；三栏版式 = 左「本图论文」列表 / 中画布 / 右详情卡。
 *
 * 约定：
 * - 每张图都基于调研库的明确数据快照：种子 + 深度 + 节点上限 + 构建时间随文件保存；
 * - 缺邻居时由检索服务先补库再计算（数据补齐在主进程 electron 侧，本模块只收注入的数据源）；
 * - 导出 HTML 为离线自包含（内嵌 vis-network + 内嵌图数据）；外部不可信串进脚本上下文
 *   一律「JSON 序列化 + 脚本序列转义」两道闸。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitGraphGen = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ── 常数：逐个对照 literature-mcp/openalex_mcp/graph/visualize.py ── */
  var DEFAULTS = { depth: 2, maxNodes: 120 };
  var MAX_NODES = 500;  // 超限时按重要性截取；与种子/调研库批量读取上限保持一致
  var MAX_SEEDS = 500;  // 可参与重要性筛选的种子上限；最终仍只展示 MAX_NODES 个
  var NODE_SIZE = { min: 13, max: 34, fallback: 23, easing: 0.74 };
  var EDGE_ALPHA = { min: 0.035, max: 0.22 };
  var EDGE_WIDTH = { min: 0.35, max: 0.85 };
  var COMMUNITY_LIMIT = { nodes: 500, edges: 10000 };
  var LAYOUT = { seed: 42, iterations: 200, iterationsLarge: 100, k: 2, pixel: 90 };
  var HIGHLIGHT = '#1d4ed8';

  /* 年份顺序色阶 / 社区辅助色 / 连线基色。节点颜色只编码年份；社区色保留给
   * 兼容调用与后续辅助视图，社区本身仍参与线强度与详情统计。 */
  var PALETTES = {
    light: {
      yearRamp: ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#2563eb'],
      community: ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#1e40af', '#0ea5e9', '#38bdf8', '#7dd3fc'],
      edge: [71, 105, 157], fallback: '#7b91aa',
      border: '#93b4dc', hoverBorder: '#1d4ed8',
      label: '#1b2a30', labelStroke: 'rgba(255,255,255,0.92)', highlight: HIGHLIGHT
    },
    dark: {
      yearRamp: ['#172554', '#1e3a8a', '#1d4ed8', '#3b82f6', '#93c5fd'],
      community: ['#93c5fd', '#60a5fa', '#3b82f6', '#bfdbfe', '#2563eb', '#7dd3fc', '#38bdf8', '#a5b4fc'],
      edge: [133, 170, 221], fallback: '#93a8c4',
      border: '#527db5', hoverBorder: '#bfdbfe',
      label: '#e4eef0', labelStroke: 'rgba(16,24,26,0.9)', highlight: '#60a5fa'
    }
  };

  /* 界面文案：默认中文（导出快照与参考实现一致）；应用内面板传入 T() 译文覆盖 */
  var TEXTS = {
    title: '引文网络',
    papers: '本图论文',
    origin: '种子文献',
    noPapers: '本图没有论文。',
    authorsUnavailable: '作者未收录',
    moreAuthors: '另有 {n} 位作者',
    unknownYear: '年份未知',
    unknownVenue: '期刊未知',
    citations: '被引',
    localCitedBy: '库内被引',
    localRefs: '库内引用',
    abstract: '摘要',
    community: '社区',
    contextLine: '该文献在当前图中与 {n} 条库内引用相连。',
    idLine: 'OpenAlex ID：{id}',
    legendColor: '颜色 = 年份',
    legendSize: '大小 = 被引量（稳健对数缩放）',
    legendEdge: '线深 = 局部引用强度',
    legendCommunity: '共 {n} 个引文社区',
    legendClick: '点击节点高亮；悬停显示作者与年份',
    physics: '力导向动画（稳定后自动关闭）',
    toolYear: '年份', toolVenue: '期刊', toolCited: '被引',
    toolAuthors: '作者', toolCommunity: '社区', toolId: 'ID',
    hint: 'LitBoard 引文网络快照 · 离线自包含',
    truncated: '原始 {total} 篇，按重要性保留 {kept} 篇，隐藏 {hidden} 篇'
  };

  function mergeTexts(overrides) {
    var out = {};
    Object.keys(TEXTS).forEach(function (key) { out[key] = TEXTS[key]; });
    if (overrides) {
      Object.keys(overrides).forEach(function (key) {
        if (overrides[key] != null && overrides[key] !== '') out[key] = String(overrides[key]);
      });
    }
    return out;
  }

  function fill(text, params) {
    return String(text == null ? '' : text).replace(/\{(\w+)\}/g, function (whole, key) {
      return params && params[key] != null ? String(params[key]) : whole;
    });
  }

  function paletteOf(name) { return PALETTES[name === 'dark' ? 'dark' : 'light']; }

  function hexRgb(hex) {
    var value = String(hex || '').replace('#', '');
    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
  }

  function rgbHex(rgb) {
    return '#' + rgb.map(function (part) {
      return Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0');
    }).join('');
  }

  /** 年份 → 多停靠顺序色阶；单年份图取中点色，未知年份由调用方使用 fallback。 */
  function rampColor(year, minYear, maxYear, paletteName) {
    var ramp = paletteOf(paletteName).yearRamp;
    var value = Number(year);
    var lo = Number(minYear);
    var hi = Number(maxYear);
    if (!isFinite(value) || !isFinite(lo) || !isFinite(hi)) return paletteOf(paletteName).fallback;
    var t = hi > lo ? Math.max(0, Math.min(1, (value - lo) / (hi - lo))) : 0.5;
    var scaled = t * (ramp.length - 1);
    var index = Math.min(ramp.length - 2, Math.floor(scaled));
    var mix = scaled - index;
    var left = hexRgb(ramp[index]);
    var right = hexRgb(ramp[index + 1]);
    return rgbHex(left.map(function (part, channel) { return part + (right[channel] - part) * mix; }));
  }

  function yearBarCss(paletteName) {
    var ramp = paletteOf(paletteName).yearRamp;
    return 'linear-gradient(90deg,' + ramp.map(function (color, index) {
      return color + ' ' + Math.round(index * 100 / (ramp.length - 1)) + '%';
    }).join(',') + ')';
  }

  function clamp(value, lo, hi, fallback) {
    var num = Number(value);
    if (!isFinite(num)) return fallback;
    return Math.max(lo, Math.min(hi, num));
  }

  function uniqueStrings(list, cap) {
    var seen = new Set();
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (item) {
      var id = String(item == null ? '' : item).trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return cap ? out.slice(0, cap) : out;
  }

  function authorNames(value) {
    return (Array.isArray(value) ? value : []).map(function (item) {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item.name === 'string') return item.name.trim();
      return '';
    }).filter(Boolean);
  }

  /** 作者列表显示：超过 limit 位显示「等 N 位」（对照 core.format_authors） */
  function formatAuthors(names, limit) {
    var list = (Array.isArray(names) ? names : []).filter(Boolean);
    var cap = Number(limit) > 0 ? Number(limit) : 5;
    if (!list.length) return '';
    if (list.length <= cap) return list.join(', ');
    return list.slice(0, cap).join(', ') + TEXTS.moreAuthors.replace('{n}', list.length);
  }

  /* ─────────────────────────── 图 → 指标 ─────────────────────────── */

  /** PageRank（damping .85 幂迭代；方向 from 引用 → to 被引，故被引多的 rank 高） */
  function pageRank(ids, edges, options) {
    var opts = options || {};
    var damping = Number(opts.damping) || 0.85;
    var iterations = Math.max(1, Number(opts.iterations) || 20);
    var n = ids.length;
    var ranks = new Map();
    if (!n) return ranks;
    var init = 1 / n;
    var outCount = new Map();
    ids.forEach(function (id) { ranks.set(id, init); outCount.set(id, 0); });
    edges.forEach(function (e) { outCount.set(e.from, (outCount.get(e.from) || 0) + 1); });
    for (var it = 0; it < iterations; it++) {
      var next = new Map();
      ids.forEach(function (id) { next.set(id, (1 - damping) / n); });
      edges.forEach(function (e) {
        var out = outCount.get(e.from) || 1;
        next.set(e.to, next.get(e.to) + damping * (ranks.get(e.from) || 0) / out);
      });
      // 悬挂节点（不出边）把份额均分
      ids.forEach(function (id) {
        if ((outCount.get(id) || 0) === 0) {
          var share = damping * (ranks.get(id) || 0) / n;
          ids.forEach(function (other) { next.set(other, next.get(other) + share); });
        }
      });
      ranks = next;
    }
    return ranks;
  }

  /** 度数统计：无向度（引用 + 被引）用于排名与重要性 */
  function degreeMaps(ids, edges) {
    var inDeg = new Map();
    var outDeg = new Map();
    var degree = new Map();
    ids.forEach(function (id) { inDeg.set(id, 0); outDeg.set(id, 0); degree.set(id, 0); });
    edges.forEach(function (e) {
      if (!inDeg.has(e.from) || !inDeg.has(e.to) || e.from === e.to) return;
      outDeg.set(e.from, outDeg.get(e.from) + 1);
      inDeg.set(e.to, inDeg.get(e.to) + 1);
      degree.set(e.from, degree.get(e.from) + 1);
      degree.set(e.to, degree.get(e.to) + 1);
    });
    return { inDeg: inDeg, outDeg: outDeg, degree: degree };
  }

  function normalizeScores(values, tieValue) {
    var out = {};
    var keys = Object.keys(values);
    if (!keys.length) return out;
    var lo = Infinity;
    var hi = -Infinity;
    keys.forEach(function (key) {
      var value = Number(values[key]) || 0;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    });
    var tie = tieValue == null ? 0 : tieValue;
    keys.forEach(function (key) {
      out[key] = hi === lo ? tie : ((Number(values[key]) || 0) - lo) / (hi - lo);
    });
    return out;
  }

  /**
   * 重要性截取（对照 literature-mcp/__init__._select_important_nodes）：
   * 被引量 50% + PageRank 25% + 集合内被引（入度）15% + 奠基性年份 10%。
   * 这是「可读性排序代理」，不是学术质量评判——返回的 kept 即保留集。
   */
  function selectImportantNodes(nodes, edges, limit) {
    var ids = nodes.map(function (n) { return n.id; });
    var scores = {};
    var n = ids.length;
    var cap = Math.max(1, Number(limit) || DEFAULTS.maxNodes);
    if (n <= cap) {
      ids.forEach(function (id) { scores[id] = 1; });
      return { kept: ids.slice(), hidden: [], scores: scores };
    }
    var byId = new Map();
    nodes.forEach(function (node) { byId.set(node.id, node); });
    var deg = degreeMaps(ids, edges);
    var ranks = pageRank(ids, edges);
    var citation = {};
    var incoming = {};
    var years = [];
    ids.forEach(function (id) {
      citation[id] = Math.log1p(Math.max(0, Number(byId.get(id).citedBy) || 0));
      incoming[id] = Math.log1p(deg.inDeg.get(id) || 0);
      var year = byId.get(id).year;
      if (typeof year === 'number' && isFinite(year) && year > 0) years.push(year);
    });
    var newest = years.length ? Math.max.apply(null, years) : 0;
    var oldest = years.length ? Math.min.apply(null, years) : 0;
    var age = {};
    ids.forEach(function (id) {
      var year = byId.get(id).year;
      age[id] = (typeof year === 'number' && isFinite(year) && year > 0) ? newest - year : 0;
    });
    var citationN = normalizeScores(citation, 0);
    var pagerankN = normalizeScores(ranksToObject(ranks), 0);
    var incomingN = normalizeScores(incoming, 0);
    var ageN = newest !== oldest ? normalizeScores(age, 0) : (function () {
      var flat = {};
      ids.forEach(function (id) { flat[id] = 0.5; });
      return flat;
    })();
    ids.forEach(function (id) {
      scores[id] = 0.50 * citationN[id] + 0.25 * pagerankN[id] + 0.15 * incomingN[id] + 0.10 * ageN[id];
    });
    var ranked = ids.slice().sort(function (a, b) {
      if (scores[b] !== scores[a]) return scores[b] - scores[a];
      if (citation[b] !== citation[a]) return citation[b] - citation[a];
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return {
      kept: ranked.slice(0, cap),
      hidden: ranked.slice(cap),
      scores: scores
    };
  }

  function ranksToObject(ranks) {
    var out = {};
    ranks.forEach(function (value, key) { out[key] = value; });
    return out;
  }

  /** 无向邻接（权重 = 边数）；自环按度 2 计（模块度口径） */
  function undirectedAdjacency(ids, edges) {
    var adj = new Map();
    var m2 = 0;
    ids.forEach(function (id) { adj.set(id, new Map()); });
    (Array.isArray(edges) ? edges : []).forEach(function (e) {
      if (!adj.has(e.from) || !adj.has(e.to)) return;
      if (e.from === e.to) {
        var self = adj.get(e.from);
        self.set(e.from, (self.get(e.from) || 0) + 2);
        m2 += 2;
        return;
      }
      var a = adj.get(e.from);
      var b = adj.get(e.to);
      a.set(e.to, (a.get(e.to) || 0) + 1);
      b.set(e.from, (b.get(e.from) || 0) + 1);
      m2 += 2;
    });
    return { adj: adj, m2: m2 };
  }

  /**
   * 社区划分（对照 metrics.detect_communities）：小图贪心模块度（Clauset-Newman-Moore），
   * 大图走 Louvain 局部移动；都按社区规模降序编号（0 = 最大社区）。
   * 社区只影响线深（同社区 +0.15）与详情展示，不改变图结构。
   */
  function detectCommunities(ids, edges) {
    var out = new Map();
    if (!ids.length) return out;
    var graph = undirectedAdjacency(ids, edges);
    var big = ids.length > COMMUNITY_LIMIT.nodes || (edges || []).length > COMMUNITY_LIMIT.edges;
    var groups = graph.m2 === 0
      ? ids.map(function (id) { return [id]; })
      : (big ? louvainGroups(ids, graph) : greedyModularityGroups(ids, edges, graph));
    groups.sort(function (a, b) {
      if (b.length !== a.length) return b.length - a.length;
      return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
    });
    groups.forEach(function (group, index) {
      group.forEach(function (id) { out.set(id, index); });
    });
    return out;
  }

  /** CNM 贪心模块度：每轮并入 ΔQ 最大且为正的一对社区（ΔQ = w/m − deg_a·deg_b/(2m²)） */
  function greedyModularityGroups(ids, edgeList, graph) {
    var adj = graph.adj;
    var m2 = graph.m2;
    var m = m2 / 2;
    var comm = new Map();
    var members = new Map();
    var cdeg = new Map();
    ids.forEach(function (id) {
      comm.set(id, id);
      members.set(id, [id]);
      var sum = 0;
      adj.get(id).forEach(function (weight) { sum += weight; });
      cdeg.set(id, sum);
    });
    var links = new Map();
    function pairKey(a, b) { return a < b ? a + '\u0000' + b : b + '\u0000' + a; }
    function addLink(a, b, weight) {
      if (a === b) return;
      var key = pairKey(a, b);
      links.set(key, (links.get(key) || 0) + weight);
    }
    (Array.isArray(edgeList) ? edgeList : []).forEach(function (e) {
      if (e.from === e.to || !comm.has(e.from) || !comm.has(e.to)) return;
      addLink(e.from, e.to, 1);
    });
    function delta(a, b) {
      var weight = links.get(pairKey(a, b)) || 0;
      return weight / m - (cdeg.get(a) * cdeg.get(b)) / (2 * m * m);
    }
    var guard = 0;
    while (guard++ < ids.length) {
      var best = null;
      links.forEach(function (_weight, key) {
        var parts = key.split('\u0000');
        var a = parts[0];
        var b = parts[1];
        if (a === b) return;
        var score = delta(a, b);
        if (!best || score > best.score) best = { a: a, b: b, score: score };
      });
      if (!best || best.score <= 0) break;
      mergeCommunities(best.a, best.b);
    }
    return Array.from(members.values());

    function mergeCommunities(a, b) {
      // 小社区并入大社区（保持代表稳定），逐个搬运 link 权重
      var keep = members.get(a).length >= members.get(b).length ? a : b;
      var drop = keep === a ? b : a;
      var dropped = members.get(drop);
      dropped.forEach(function (id) { comm.set(id, keep); });
      members.set(keep, members.get(keep).concat(dropped));
      members.delete(drop);
      cdeg.set(keep, cdeg.get(keep) + cdeg.get(drop));
      cdeg.delete(drop);
      var moved = [];
      links.forEach(function (weight, key) {
        var parts = key.split('\u0000');
        if (parts[0] !== drop && parts[1] !== drop) return;
        moved.push({ other: parts[0] === drop ? parts[1] : parts[0], weight: weight, key: key });
      });
      moved.forEach(function (entry) {
        links.delete(entry.key);
        addLink(keep, entry.other, entry.weight);
      });
    }
  }

  /** Louvain 局部移动（大图启发式；社区只作视觉/展示用途，不追求模函数极值） */
  function louvainGroups(ids, graph) {
    var adj = graph.adj;
    var m2 = graph.m2;
    var rand = seededRandom(LAYOUT.seed);
    var degree = new Map();
    ids.forEach(function (id) {
      var sum = 0;
      adj.get(id).forEach(function (weight) { sum += weight; });
      degree.set(id, sum);
    });
    var comm = new Map();
    var cdeg = new Map();
    ids.forEach(function (id) { comm.set(id, id); cdeg.set(id, degree.get(id)); });
    var order = ids.slice();
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    for (var pass = 0; pass < 20; pass++) {
      var moved = false;
      order.forEach(function (id) {
        var own = comm.get(id);
        var k = degree.get(id) || 0;
        var weights = new Map();
        adj.get(id).forEach(function (weight, nb) {
          if (nb === id) return;
          var c = comm.get(nb);
          weights.set(c, (weights.get(c) || 0) + weight);
        });
        cdeg.set(own, (cdeg.get(own) || 0) - k);
        var bestComm = own;
        var bestGain = (weights.get(own) || 0) - k * (cdeg.get(own) || 0) / m2;
        weights.forEach(function (weight, c) {
          var gain = weight - k * (cdeg.get(c) || 0) / m2;
          if (gain > bestGain + 1e-12) { bestGain = gain; bestComm = c; }
        });
        cdeg.set(bestComm, (cdeg.get(bestComm) || 0) + k);
        if (bestComm !== own) { comm.set(id, bestComm); moved = true; }
      });
      if (!moved) break;
    }
    var groups = new Map();
    ids.forEach(function (id) {
      var key = comm.get(id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    });
    return Array.from(groups.values());
  }

  /* ─────────────────────────── 布局 ─────────────────────────── */

  /** 确定性随机（mulberry32）：同一张图每次构建得到同一套坐标（对照参考实现的 seed=42） */
  function seededRandom(seed) {
    var state = (Number(seed) >>> 0) || 1;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 弱连通分量（无向） */
  function components(ids, adj) {
    var seen = new Set();
    var out = [];
    ids.forEach(function (start) {
      if (seen.has(start)) return;
      var stack = [start];
      var group = [];
      seen.add(start);
      while (stack.length) {
        var id = stack.pop();
        group.push(id);
        adj.get(id).forEach(function (_weight, nb) {
          if (seen.has(nb)) return;
          seen.add(nb);
          stack.push(nb);
        });
      }
      out.push(group);
    });
    return out;
  }

  function centerOf(positions, group) {
    var x = 0;
    var y = 0;
    group.forEach(function (id) {
      x += positions.get(id)[0];
      y += positions.get(id)[1];
    });
    return [x / group.length, y / group.length];
  }

  /** 孤立/稀疏部分贴到主连通分量的外环上（对照 visualize._arrange_disconnected_components） */
  function arrangeComponents(positions, groups) {
    var sorted = groups.slice().sort(function (a, b) {
      if (b.length !== a.length) return b.length - a.length;
      var minA = a.slice().sort()[0];
      var minB = b.slice().sort()[0];
      return minA < minB ? -1 : (minA > minB ? 1 : 0);
    });
    if (sorted.length <= 1) return positions;
    var main = sorted[0];
    var mainCenter = centerOf(positions, main);
    var adjusted = new Map();
    positions.forEach(function (value, id) {
      adjusted.set(id, [value[0] - mainCenter[0], value[1] - mainCenter[1]]);
    });
    var mainRadius = 0.35;
    main.forEach(function (id) {
      var p = adjusted.get(id);
      mainRadius = Math.max(mainRadius, Math.hypot(p[0], p[1]));
    });
    var ringRadius = Math.min(0.88, Math.max(0.58, mainRadius + 0.22));
    var peripheral = sorted.slice(1);
    var step = (2 * Math.PI) / Math.max(1, peripheral.length);
    peripheral.forEach(function (group, index) {
      var angle = -Math.PI / 7 + index * step;
      var targetRadius = Math.min(0.92, ringRadius + 0.04 * (index % 2));
      var center = centerOf(adjusted, group);
      var dx = Math.cos(angle) * targetRadius - center[0];
      var dy = Math.sin(angle) * targetRadius - center[1];
      group.forEach(function (id) {
        var p = adjusted.get(id);
        adjusted.set(id, [p[0] + dx, p[1] + dy]);
      });
    });
    return adjusted;
  }

  /** 极弱连接节点不许飘太远（对照 visualize._compact_peripheral_nodes） */
  function compactPeripheral(positions, degree) {
    var maxRadius = 0.96;
    var isolateRadius = 0.72;
    var out = new Map();
    positions.forEach(function (value, id) {
      var radius = Math.hypot(value[0], value[1]);
      var target = radius;
      if (radius > 0) {
        var deg = degree.get(id) || 0;
        if (deg === 0) target = Math.min(maxRadius, Math.max(isolateRadius, radius));
        else if (deg === 1 && radius > maxRadius) target = maxRadius;
      }
      var scale = target === radius || radius === 0 ? 1 : target / radius;
      out.set(id, [value[0] * scale, value[1] * scale]);
    });
    return out;
  }

  /**
   * 确定性初始布局：Fruchterman-Reingold（seed 固定）→ 连通分量摆位 → 边缘收缩 →
   * 单位空间 ×(90·√n) 转像素。浏览器只做短暂收敛，稳定后冻结（同参考实现）。
   */
  function computeLayout(ids, edges, options) {
    var opts = options || {};
    var list = uniqueStrings(ids);
    var positions = new Map();
    if (!list.length) return positions;
    if (list.length === 1) {
      positions.set(list[0], [0, 0]);
      return positions;
    }
    var graph = undirectedAdjacency(list, edges);
    var adj = graph.adj;
    var rand = seededRandom(Number(opts.seed) || LAYOUT.seed);
    var n = list.length;
    list.forEach(function (id) { positions.set(id, [rand(), rand()]); });
    var k = LAYOUT.k / Math.sqrt(n);
    var iterations = Number(opts.iterations) > 0
      ? Number(opts.iterations)
      : (n > 400 ? LAYOUT.iterationsLarge : LAYOUT.iterations);
    var temperature = 0.1;
    var disp = new Map();
    for (var it = 0; it < iterations; it++) {
      list.forEach(function (id) { disp.set(id, [0, 0]); });
      for (var i = 0; i < n; i++) {
        var pi = positions.get(list[i]);
        var di = disp.get(list[i]);
        for (var j = i + 1; j < n; j++) {
          var pj = positions.get(list[j]);
          var dj = disp.get(list[j]);
          var dx = pi[0] - pj[0];
          var dy = pi[1] - pj[1];
          var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          var force = (k * k) / dist;
          var ux = dx / dist;
          var uy = dy / dist;
          di[0] += ux * force; di[1] += uy * force;
          dj[0] -= ux * force; dj[1] -= uy * force;
        }
      }
      list.forEach(function (id) {
        var pa = positions.get(id);
        var da = disp.get(id);
        adj.get(id).forEach(function (_weight, nb) {
          if (nb <= id) return;   // 无向边只算一次（id 全序去重）
          var pb = positions.get(nb);
          var db = disp.get(nb);
          var dx = pa[0] - pb[0];
          var dy = pa[1] - pb[1];
          var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          var force = (dist * dist) / k;
          var ux = dx / dist;
          var uy = dy / dist;
          da[0] -= ux * force; da[1] -= uy * force;
          db[0] += ux * force; db[1] += uy * force;
        });
      });
      list.forEach(function (id) {
        var d = disp.get(id);
        var p = positions.get(id);
        var len = Math.sqrt(d[0] * d[0] + d[1] * d[1]) || 0.01;
        var step = Math.min(len, temperature) / len;
        p[0] += d[0] * step;
        p[1] += d[1] * step;
      });
      temperature = Math.max(temperature * 0.99, 0.001);
    }
    // 复位到原点并缩放到 [-1,1]（对照 networkx spring_layout 的 scale=1.0）
    var cx = 0;
    var cy = 0;
    positions.forEach(function (p) { cx += p[0]; cy += p[1]; });
    cx /= n; cy /= n;
    var maxAbs = 0;
    positions.forEach(function (p) {
      p[0] -= cx; p[1] -= cy;
      maxAbs = Math.max(maxAbs, Math.abs(p[0]), Math.abs(p[1]));
    });
    if (maxAbs > 0) positions.forEach(function (p) { p[0] /= maxAbs; p[1] /= maxAbs; });
    var degree = degreeMaps(list, edges).degree;
    positions = compactPeripheral(arrangeComponents(positions, components(list, adj)), degree);
    var factor = LAYOUT.pixel * Math.sqrt(n);
    var out = new Map();
    positions.forEach(function (p, id) {
      out.set(id, [Math.round(p[0] * factor * 10) / 10, Math.round(p[1] * factor * 10) / 10]);
    });
    return out;
  }

  /* ─────────────────────────── 图构建 ─────────────────────────── */

  /**
   * 组装图数据（数据源注入，Node 可测）。
   * deps.getWorks(ids) → 库中已有行 [{id,title,year,doi,citedBy,sourceName,abstract,authors,refs:[ids]}]
   * deps.fetchMissing(ids) → 联网补取并入库后返回的行（没有则缺漏）
   * seeds: 起始 workId 列表；params: {depth,maxNodes}；onProgress({phase,done,total})
   * 返回 { nodes, edges, communities, meta, missing }。
   */
  async function buildGraphData(seeds, params, deps, onProgress) {
    var opts = params || {};
    var depth = clamp(opts.depth, 0, 3, DEFAULTS.depth);
    var maxNodes = clamp(opts.maxNodes, 10, MAX_NODES, DEFAULTS.maxNodes);
    var getWorks = deps.getWorks;
    var fetchMissing = deps.fetchMissing || async function () { return []; };
    var notify = typeof onProgress === 'function' ? onProgress : function () {};

    var seedIds = uniqueStrings(seeds, MAX_SEEDS);
    if (!seedIds.length) {
      return { nodes: [], edges: [], communities: {}, missing: [], meta: metaOf(seedIds, depth, maxNodes, 0, 0, 0, 0) };
    }

    var byId = new Map();   // id → work row
    function absorb(rows) {
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (!row || !row.id) return;
        if (!byId.has(row.id)) { byId.set(row.id, row); return; }
        var cur = byId.get(row.id);
        // 同一身份多来源（库内行 / 联网补齐）：有引用边的那份更完整
        if ((!cur.refs || !cur.refs.length) && row.refs && row.refs.length) byId.set(row.id, row);
      });
    }

    absorb(await getWorks(seedIds));
    var frontier = seedIds.filter(function (id) { return byId.has(id); });
    for (var d = 0; d < depth; d++) {
      if (!frontier.length || byId.size >= maxNodes) break;
      var counts = new Map();
      frontier.forEach(function (id) {
        var refs = (byId.get(id) && byId.get(id).refs) || [];
        refs.forEach(function (rid) {
          if (byId.has(rid)) return;
          counts.set(rid, (counts.get(rid) || 0) + 1);
        });
      });
      var budget = maxNodes - byId.size;
      var nextIds = Array.from(counts.entries())
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, budget)
        .map(function (pair) { return pair[0]; });
      if (!nextIds.length) break;
      notify({ phase: 'expand', depth: d + 1, candidates: nextIds.length });
      absorb(await getWorks(nextIds));
      var missing = nextIds.filter(function (id) { return !byId.has(id); });
      if (missing.length) {
        notify({ phase: 'fetch', depth: d + 1, candidates: missing.length });
        absorb(await fetchMissing(missing));
      }
      frontier = nextIds.filter(function (id) { return byId.has(id); });
    }

    var missingSeeds = seedIds.filter(function (id) { return !byId.has(id); });

    // 诱导子图：两端都在集合内才成边（边向 = from 引用 to）
    var edges = [];
    var present = new Set(byId.keys());
    byId.forEach(function (work, id) {
      uniqueStrings(work.refs).forEach(function (rid) {
        if (present.has(rid)) edges.push({ from: id, to: rid });
      });
    });
    edges = edges.filter(function (edge) { return edge.from !== edge.to; });

    var totalNodes = byId.size;
    var nodes = Array.from(byId.keys()).map(function (id) {
      var work = byId.get(id);
      return {
        id: id,
        title: work.title || '',
        year: work.year == null ? null : Number(work.year),
        doi: work.doi || '',
        citedBy: Number(work.citedBy) || 0,
        sourceName: work.sourceName || '',
        abstract: work.abstract || '',
        authors: authorNames(work.authors),
        seed: seedIds.indexOf(id) !== -1
      };
    });

    // 可读性截取（超过上限时按重要性保留；对照 graph_visualize 的截断语义）
    var selection = selectImportantNodes(nodes, edges, maxNodes);
    var keptSet = new Set(selection.kept);
    if (selection.hidden.length) {
      nodes = nodes.filter(function (node) { return keptSet.has(node.id); });
      edges = edges.filter(function (edge) { return keptSet.has(edge.from) && keptSet.has(edge.to); });
    }

    // 社区划分（metrics.detect_communities）——在最终节点集上算。
    // deps.computeMetrics：可选注入（主进程的 Rust 内核走这条）；缺省纯 JS，渲染层/Node 测试不受影响
    var nodeIds = nodes.map(function (node) { return node.id; });
    var metrics = deps.computeMetrics
      ? await deps.computeMetrics(nodeIds, edges)
      : { communities: detectCommunities(nodeIds, edges), ranks: pageRank(nodeIds, edges) };
    var communities = metrics.communities;
    var ranks = metrics.ranks;
    var deg = degreeMaps(nodeIds, edges);
    var finalNodes = nodes.map(function (node) {
      return Object.assign({}, node, {
        inDeg: deg.inDeg.get(node.id) || 0,
        outDeg: deg.outDeg.get(node.id) || 0,
        rank: ranks.get(node.id) || 0,
        score: selection.scores[node.id] == null ? 0 : selection.scores[node.id],
        community: communities.has(node.id) ? communities.get(node.id) : 0
      });
    });
    var meta = metaOf(seedIds, depth, maxNodes, finalNodes.length, edges.length, totalNodes,
      selection.hidden.length, missingSeeds);
    var communityNumbers = {};
    communities.forEach(function (value) { communityNumbers[value] = true; });
    meta.communityCount = Object.keys(communityNumbers).length;

    return {
      nodes: finalNodes,
      edges: edges,
      communities: communitiesToObject(communities),
      missing: missingSeeds,
      meta: meta
    };
  }

  function communitiesToObject(communities) {
    var out = {};
    communities.forEach(function (value, key) { out[key] = value; });
    return out;
  }

  function metaOf(seedIds, depth, maxNodes, nodeCount, edgeCount, totalCount, hiddenCount, missing) {
    var total = totalCount == null ? nodeCount : totalCount;
    return {
      version: 2,
      seeds: seedIds,
      depth: depth,
      maxNodes: maxNodes,
      nodeCount: nodeCount,
      edgeCount: edgeCount,
      totalCount: total,
      hiddenCount: hiddenCount || 0,
      truncated: (hiddenCount || 0) > 0,
      communityCount: 0,
      missing: (missing || []).slice(0, 20),
      missingCount: (missing || []).length,
      builtAt: new Date().toISOString()
    };
  }

  /* ─────────────────────────── 视觉编码 ─────────────────────────── */

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return 0;
    if (sortedValues.length === 1) return sortedValues[0];
    var index = (sortedValues.length - 1) * p;
    var lower = Math.floor(index);
    var upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    var weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /** 被引量 → 稳健对数缩放尺寸（5/95 分位裁剪 + 缓动，防一篇高被引压扁全图） */
  function nodeSizes(nodes) {
    var sizes = new Map();
    if (!nodes.length) return sizes;
    var logs = nodes.map(function (node) {
      return Math.log1p(Math.max(0, Number(node.citedBy) || 0));
    }).sort(function (a, b) { return a - b; });
    var lo = percentile(logs, 0.05);
    var hi = percentile(logs, 0.95);
    if (hi <= lo) { lo = logs[0]; hi = logs[logs.length - 1]; }
    nodes.forEach(function (node) {
      var value = Math.log1p(Math.max(0, Number(node.citedBy) || 0));
      if (hi === lo) { sizes.set(node.id, NODE_SIZE.fallback); return; }
      var t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
      t = Math.pow(t, NODE_SIZE.easing);
      sizes.set(node.id, Math.round(NODE_SIZE.min + t * (NODE_SIZE.max - NODE_SIZE.min)));
    });
    return sizes;
  }

  /** 引文社区 → 离散分类色；无社区时使用中性回退色。 */
  function communityColor(community, paletteName) {
    var pal = paletteOf(paletteName);
    var index = Number(community);
    if (!isFinite(index) || index < 0) return pal.fallback;
    return pal.community[Math.floor(index) % pal.community.length];
  }

  function edgeRgba(palette, alpha) {
    var rgb = paletteOf(palette).edge;
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')';
  }

  function neighborMap(ids, edges) {
    var out = new Map();
    ids.forEach(function (id) { out.set(id, new Set()); });
    edges.forEach(function (e) {
      if (!out.has(e.from) || !out.has(e.to) || e.from === e.to) return;
      out.get(e.from).add(e.to);
      out.get(e.to).add(e.from);
    });
    return out;
  }

  /** 线深 = 局部引用结构强度：共同邻居 .55 + 端点连接度 .30 + 同社区 .15 */
  function edgeStrengths(ids, edges, communities) {
    var out = new Map();
    if (!edges.length) return out;
    var neighbors = neighborMap(ids, edges);
    var endpoint = {};
    edges.forEach(function (e) {
      var du = Math.max(1, (neighbors.get(e.from) || new Set()).size);
      var dv = Math.max(1, (neighbors.get(e.to) || new Set()).size);
      endpoint[e.from + '\u0000' + e.to] = Math.log1p(Math.sqrt(du * dv));
    });
    var endpointN = normalizeScores(endpoint, 0);
    var byId = communities || {};
    edges.forEach(function (e) {
      var nu = new Set(neighbors.get(e.from) || []);
      var nv = new Set(neighbors.get(e.to) || []);
      nu.delete(e.to);
      nv.delete(e.from);
      var shared = (nu.size && nv.size)
        ? intersectionCount(nu, nv) / Math.sqrt(nu.size * nv.size)
        : 0;
      var sameCommunity = byId[e.from] != null && byId[e.from] === byId[e.to] ? 1 : 0;
      var strength = Math.min(1, 0.55 * shared + 0.30 * (endpointN[e.from + '\u0000' + e.to] || 0) + 0.15 * sameCommunity);
      out.set(e.from + '\u0000' + e.to, strength);
    });
    return out;
  }

  function intersectionCount(a, b) {
    var count = 0;
    var small = a.size <= b.size ? a : b;
    var large = small === a ? b : a;
    small.forEach(function (value) { if (large.has(value)) count += 1; });
    return count;
  }

  /** 标签配额：min(n, max(18, √n·2.5))——只为重要节点常显标签，其余悬停显示 */
  function labelLimit(n) {
    if (!n) return 0;
    return Math.min(n, Math.max(18, Math.floor(Math.sqrt(n) * 2.5)));
  }

  /** 排名：度数 → 被引（对数）→ 年份，降序（对照 visualize._ranked_nodes） */
  function rankNodes(nodes, edges) {
    var ids = nodes.map(function (node) { return node.id; });
    var deg = degreeMaps(ids, edges).degree;
    var byId = new Map();
    nodes.forEach(function (node) { byId.set(node.id, node); });
    return ids.slice().sort(function (a, b) {
      var da = deg.get(a) || 0;
      var db = deg.get(b) || 0;
      if (da !== db) return db - da;
      var ca = Math.log1p(Math.max(0, Number(byId.get(a).citedBy) || 0));
      var cb = Math.log1p(Math.max(0, Number(byId.get(b).citedBy) || 0));
      if (ca !== cb) return cb - ca;
      var ya = Number(byId.get(a).year) || 0;
      var yb = Number(byId.get(b).year) || 0;
      if (ya !== yb) return yb - ya;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
  }

  /** 紧凑标签：第一作者姓氏 + 年份（对照 visualize._display_label） */
  function displayLabel(node) {
    var names = Array.isArray(node.authors) ? node.authors : [];
    var first = names.length && String(names[0]).trim() ? String(names[0]).trim().split(/\s+/).pop() : '';
    var year = node.year;
    if (first && year) return first + ', ' + year;
    return first || (year ? String(year) : '');
  }

  function tooltipOf(node, texts) {
    var lines = [node.title || node.id];
    lines.push(fill('{label}{value}', { label: texts.toolYear + ': ', value: node.year || texts.unknownYear }));
    lines.push(texts.toolVenue + ': ' + (node.sourceName || '-'));
    lines.push(texts.toolCited + ': ' + (Number(node.citedBy) || 0));
    var authors = formatAuthors(node.authors);
    if (authors) lines.push(texts.toolAuthors + ': ' + authors);
    if (node.community != null) lines.push(texts.toolCommunity + ': ' + node.community);
    lines.push(texts.toolId + ': ' + node.id);
    return lines.join('\n');
  }

  /**
   * 图数据 → vis 数据（lapp 双方共用：导出快照与应用内面板走同一条编码，避免版式漂移）。
   * 返回 { nodes, edges, meta, legend, defaultSelectedId }。
   */
  function viewerData(graph, options) {
    var opts = options || {};
    var texts = mergeTexts(opts.texts);
    var palette = paletteOf(opts.palette);
    var nodes = (graph && graph.nodes) || [];
    var edges = (graph && graph.edges) || [];
    var communities = (graph && graph.communities) || {};
    var meta = (graph && graph.meta) || {};
    var ids = nodes.map(function (node) { return node.id; });
    var layout = opts.layout || computeLayout(ids, edges, opts.layoutOptions);
    var sizes = nodeSizes(nodes);
    var strengths = edgeStrengths(ids, edges, communities);
    var ranked = rankNodes(nodes, edges);
    var ranks = new Map();
    ranked.forEach(function (id, index) { ranks.set(id, index); });
    var prominent = new Set(ranked.slice(0, labelLimit(nodes.length)));
    var deg = degreeMaps(ids, edges);
    var years = nodes.map(function (node) { return Number(node.year); }).filter(function (year) { return isFinite(year) && year > 0; });
    var yearMin = years.length ? Math.min.apply(null, years) : null;
    var yearMax = years.length ? Math.max.apply(null, years) : null;

    var visNodes = nodes.map(function (node) {
      var label = displayLabel(node);
      var background = rampColor(node.year, yearMin, yearMax, opts.palette);
      var pos = layout.get(node.id) || [0, 0];
      return {
        id: node.id,
        label: prominent.has(node.id) ? label : '',
        fullLabel: label,
        pinnedLabel: prominent.has(node.id),
        paperTitle: node.title || '',
        paperAbstract: String(node.abstract || '').trim(),
        authorsText: formatAuthors(node.authors),
        year: node.year == null ? null : node.year,
        source: node.sourceName || '',
        citationCount: Math.max(0, Number(node.citedBy) || 0),
        community: communities[node.id] == null ? null : communities[node.id],
        isSeed: !!node.seed,
        rank: ranks.has(node.id) ? ranks.get(node.id) : ids.length,
        inCount: deg.inDeg.get(node.id) || 0,
        outCount: deg.outDeg.get(node.id) || 0,
        color: {
          background: background,
          border: palette.border,
          highlight: { background: background, border: palette.highlight },
          hover: { background: background, border: palette.hoverBorder }
        },
        shape: 'dot',
        size: sizes.get(node.id) == null ? NODE_SIZE.fallback : sizes.get(node.id),
        x: pos[0],
        y: pos[1],
        title: tooltipOf(node, texts)
      };
    });

    var visEdges = edges.map(function (edge, index) {
      var strength = strengths.get(edge.from + '\u0000' + edge.to) || 0;
      var alpha = EDGE_ALPHA.min + strength * (EDGE_ALPHA.max - EDGE_ALPHA.min);
      var width = EDGE_WIDTH.min + strength * (EDGE_WIDTH.max - EDGE_WIDTH.min);
      return {
        id: 'e' + index,
        from: edge.from,
        to: edge.to,
        width: Math.round(width * 100) / 100,
        color: {
          color: edgeRgba(opts.palette, alpha),
          highlight: edgeRgba(opts.palette, 0.56),
          hover: edgeRgba(opts.palette, 0.42),
          inherit: false
        }
      };
    });

    var sorted = visNodes.slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
    return {
      nodes: visNodes,
      edges: visEdges,
      meta: meta,
      texts: texts,
      palette: opts.palette === 'dark' ? 'dark' : 'light',
      yearMin: yearMin,
      yearMax: yearMax,
      communityCount: Object.keys(communities).length
        ? Math.max.apply(null, Object.keys(communities).map(function (id) { return communities[id]; })) + 1
        : 0,
      defaultSelectedId: sorted.length ? sorted[0].id : null,
      sortedIds: sorted.map(function (node) { return node.id; })
    };
  }

  /** vis.Network 选项（导出与应用内共用同一份，防止交互手感漂移） */
  function graphOptions(paletteName) {
    var palette = paletteOf(paletteName);
    return {
      nodes: {
        borderWidth: 1.4,
        borderWidthSelected: 4,
        shadow: { enabled: true, color: 'rgba(31,49,73,0.15)', size: 9, x: 0, y: 2 },
        font: {
          size: 12, color: palette.label, strokeWidth: 5, strokeColor: palette.labelStroke
        },
        labelHighlightBold: false,
        chosen: {
          node: function (values) {
            values.borderColor = palette.highlight;
            values.borderWidth = 4;
            values.shadow = true;
            values.shadowColor = 'rgba(194,120,3,0.30)';
            values.shadowSize = 18;
          }
        }
      },
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 0.22 } },
        color: {
          color: edgeRgba(paletteName, 0.06),
          highlight: edgeRgba(paletteName, 0.56),
          hover: edgeRgba(paletteName, 0.42),
          inherit: false
        },
        width: 0.4,
        selectionWidth: 1.15,
        hoverWidth: 0.8,
        smooth: false
      },
      physics: {
        enabled: true,
        solver: 'barnesHut',
        barnesHut: {
          theta: 0.65,
          gravitationalConstant: -2600,
          centralGravity: 0.18,
          springLength: 128,
          springConstant: 0.018,
          damping: 0.28,
          avoidOverlap: 0.48
        },
        maxVelocity: 24,
        minVelocity: 0.65,
        timestep: 0.35,
        adaptiveTimestep: true,
        stabilization: { enabled: false }
      },
      interaction: { hover: true, tooltipDelay: 120, hideEdgesOnDrag: true, hideEdgesOnZoom: true }
    };
  }

  /* ─────────────────────────── 三栏内容（双方共用同一份渲染） ─────────────────────────── */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function paperRowHtml(node, texts, selectedId) {
    var active = node.id === selectedId ? ' active' : '';
    return '<div class="paper-row' + active + '" data-id="' + escapeHtml(node.id) + '">' +
      (node.isSeed ? '<div class="origin-label">' + escapeHtml(texts.origin) + '</div>' : '') +
      '<h3>' + escapeHtml(node.paperTitle || node.fullLabel || node.id) + '</h3>' +
      '<div class="paper-authors">' + escapeHtml(node.authorsText || node.source || texts.authorsUnavailable) + '</div>' +
      '<div class="paper-year">' + escapeHtml(node.year || '-') + '</div>' +
      '</div>';
  }

  function paperListHtml(view, selectedId) {
    var texts = view.texts;
    if (!view.sortedIds.length) return '<div class="empty-list">' + escapeHtml(texts.noPapers) + '</div>';
    var byId = new Map();
    view.nodes.forEach(function (node) { byId.set(node.id, node); });
    return view.sortedIds.map(function (id) {
      return paperRowHtml(byId.get(id), texts, selectedId);
    }).join('');
  }

  function authorChipsHtml(node, texts) {
    var text = node.authorsText;
    if (!text) return '<span>' + escapeHtml(texts.authorsUnavailable) + '</span>';
    var parts = text.split(',').map(function (part) { return part.trim(); }).filter(Boolean);
    if (parts.length <= 3) {
      return parts.map(function (part) { return '<span>' + escapeHtml(part) + '</span>'; }).join('');
    }
    return '<span>' + escapeHtml(parts[0]) + '</span>' +
      '<span class="author-chip">' + escapeHtml(fill(texts.moreAuthors, { n: parts.length - 1 })) + '</span>';
  }

  function detailHtml(node, texts) {
    if (!node) return '<div class="empty-list">' + escapeHtml(texts.noPapers) + '</div>';
    var inCount = node.inCount || 0;
    var outCount = node.outCount || 0;
    var abstractBlock = node.paperAbstract
      ? '<div class="detail-abstract"><b>' + escapeHtml(texts.abstract) + '</b>' + escapeHtml(node.paperAbstract) + '</div>'
      : '';
    return '<h2>' + escapeHtml(node.paperTitle || node.fullLabel || node.id) + '</h2>' +
      '<div class="detail-authors">' + authorChipsHtml(node, texts) + '</div>' +
      '<div class="detail-meta">' + escapeHtml(node.year || texts.unknownYear) + ', ' +
      escapeHtml(node.source || texts.unknownVenue) + '</div>' +
      '<div class="detail-stats">' +
      '<div class="stat"><b>' + escapeHtml(node.citationCount || 0) + '</b><span>' + escapeHtml(texts.citations) + '</span></div>' +
      '<div class="stat"><b>' + escapeHtml(inCount) + '</b><span>' + escapeHtml(texts.localCitedBy) + '</span></div>' +
      '<div class="stat"><b>' + escapeHtml(outCount) + '</b><span>' + escapeHtml(texts.localRefs) + '</span></div>' +
      '</div>' +
      abstractBlock +
      '<div class="detail-section"><b>' + escapeHtml(texts.community + ' ' + (node.community == null ? '-' : node.community)) + '</b><br>' +
      escapeHtml(fill(texts.contextLine, { n: inCount + outCount })) + '</div>' +
      '<div class="id-line">' + escapeHtml(fill(texts.idLine, { id: node.id })) + '</div>';
  }

  function legendHtml(view) {
    var texts = view.texts;
    var minYear = view.yearMin == null ? texts.unknownYear : view.yearMin;
    var maxYear = view.yearMax == null ? texts.unknownYear : view.yearMax;
    var lines = [
      '<b>' + escapeHtml(texts.legendColor) + '</b>',
      '<div class="yearbar" style="background:' + yearBarCss(view.palette) + '"></div>',
      '<div class="yearbar-labels"><span>' + escapeHtml(minYear) + '</span><span>' + escapeHtml(maxYear) + '</span></div>',
      '<b>' + escapeHtml(texts.legendSize) + '</b>',
      '<b>' + escapeHtml(texts.legendEdge) + '</b>',
      escapeHtml(fill(texts.legendCommunity, { n: view.communityCount })),
      escapeHtml(texts.legendClick),
      '<label class="ph"><input type="checkbox" id="physicsToggle" checked>' + escapeHtml(texts.physics) + '</label>'
    ];
    return lines.join('\n');
  }

  /* ─────────────────────────── 离线快照导出 ─────────────────────────── */

  /** 脚本上下文转义：JSON 文本的结构字符不含 `<`，全部 `\u003c` 化即可彻底杜绝 `</script`、`<!--` 等序列 */
  function escapeForInlineScript(jsonText) {
    return String(jsonText == null ? '' : jsonText).replace(/</g, '\\u003c');
  }

  /** JSON 文本 → 安全的 JS 字符串字面量内容（供 JSON.parse 侧恢复） */
  function asJsString(jsonText) {
    return String(jsonText == null ? '' : jsonText)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /* 查看器脚本：与应用内面板同一套交互（列表点选、悬停显标签、详情同步、稳定后冻结物理）。
   * 数据侧（viewerData / paperListHtml / detailHtml）双方共用，只有 DOM 装配各自实现。 */
  var VIEWER_SCRIPT = [
    'DATA.options.nodes.chosen={node:function(values){values.borderColor=DATA.highlight;values.borderWidth=4;',
    '  values.shadow=true;values.shadowColor=DATA.shadowColor;values.shadowSize=18;}};',
    'var nodes=new vis.DataSet(DATA.nodes);',
    'var edges=new vis.DataSet(DATA.edges);',
    'var network=new vis.Network(document.getElementById("net"),{nodes:nodes,edges:edges},DATA.options);',
    'var index={};DATA.nodes.forEach(function(n){index[n.id]=n;});',
    'var selected=null;var syncing=false;var freezeTimer=null;var animStart=performance.now();',
    'function detail(node){document.getElementById("detailCard").innerHTML=DATA.detailHtml[node.id]||"";}',
    'function list(){document.getElementById("paperList").innerHTML=DATA.paperListHtml[selected]||DATA.paperListHtml.__default;',
    '  Array.prototype.forEach.call(document.getElementById("paperList").querySelectorAll(".paper-row"),function(row){',
    '    row.addEventListener("click",function(){select(row.getAttribute("data-id"),true);});});}',
    'function select(id,focus){var node=index[id];if(!node)return;',
    '  if(selected&&selected!==id){var prev=nodes.get(selected);if(prev&&!prev.pinnedLabel)nodes.update({id:prev.id,label:""});}',
    '  selected=id;nodes.update({id:node.id,label:node.fullLabel});detail(node);list();',
    '  if(!syncing){syncing=true;network.selectNodes([id],false);syncing=false;}',
    '  if(focus)network.focus(id,{scale:1.05,animation:{duration:450,easingFunction:"easeInOutQuad"}});}',
    'network.on("hoverNode",function(p){var node=nodes.get(p.node);',
    '  if(node&&!node.pinnedLabel)nodes.update({id:node.id,label:node.fullLabel});',
    '  if(node&&index[node.id])detail(index[node.id]);});',
    'network.on("blurNode",function(p){var node=nodes.get(p.node);',
    '  if(node&&!node.pinnedLabel&&node.id!==selected)nodes.update({id:node.id,label:""});',
    '  if(selected&&index[selected])detail(index[selected]);});',
    'network.on("selectNode",function(p){if(p.nodes[0])select(p.nodes[0],false);});',
    'var toggle=document.getElementById("physicsToggle");',
    'function freeze(){if(freezeTimer)clearTimeout(freezeTimer);',
    '  var left=Math.max(0,1200-(performance.now()-animStart));',
    '  freezeTimer=setTimeout(function(){network.setOptions({physics:{enabled:false}});if(toggle)toggle.checked=false;},left);}',
    'network.once("stabilized",freeze);freezeTimer=setTimeout(freeze,6000);',
    'if(toggle)toggle.addEventListener("change",function(e){if(freezeTimer)clearTimeout(freezeTimer);',
    '  network.setOptions({physics:{enabled:e.target.checked}});',
    '  if(e.target.checked){animStart=performance.now();network.startSimulation();freezeTimer=setTimeout(freeze,6000);}});',
    'list();if(DATA.defaultSelectedId)select(DATA.defaultSelectedId,false);'
  ];

  /* vis-network 兜底 CDN：vendor 缺失时快照仍能打开（离线时给出明确提示） */
  var VIS_CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js',
    'https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js',
    'https://registry.npmmirror.com/vis-network/9.1.9/files/standalone/umd/vis-network.min.js'
  ];

  /** 图参数摘要（左栏「节点/边/种子/深度/上限/构建时间」+ 截断如实说明）——导出与应用内共用 */
  function metaSummary(meta, texts) {
    var m = meta || {};
    var parts = [
      '节点 ' + (m.nodeCount || 0) + ' · 边 ' + (m.edgeCount || 0),
      '种子 ' + ((m.seeds || []).length) + ' · 深度 ' + (m.depth || 0) + ' · 上限 ' + (m.maxNodes || 0)
    ];
    if (m.communityCount) parts.push('社区 ' + m.communityCount + ' 个');
    if (m.builtAt) parts.push('构建于 ' + String(m.builtAt).slice(0, 19).replace('T', ' '));
    var html = escapeHtml(parts.join(' · '));
    if (m.truncated) {
      html += '<br>' + escapeHtml(fill((texts || mergeTexts()).truncated, {
        total: m.totalCount || 0, kept: m.nodeCount || 0, hidden: m.hiddenCount || 0
      }));
    }
    if (m.missingCount) {
      html += '<br>' + escapeHtml('库中缺失 ' + m.missingCount + ' 篇种子：' + (m.missing || []).join(', '));
    }
    return html;
  }

  /** 离线自包含 HTML 快照：三栏版式 + 内嵌 vis-network + 内嵌图数据（对照 literature-mcp 的导出） */
  function renderGraphHtml(graph, libText, options) {
    var opts = options || {};
    // 图数据自带预置布局（Rust 内核随图下发）时直接用，快照与面板不产生两套坐标
    var view = viewerData(graph, {
      palette: 'light',
      texts: opts.texts,
      layout: graph.layout ? new Map(graph.layout) : undefined
    });
    var title = String(opts.title || view.texts.title);
    var detailById = {};
    view.nodes.forEach(function (node) { detailById[node.id] = detailHtml(node, view.texts); });
    var listBySelection = { __default: paperListHtml(view, null) };
    view.nodes.forEach(function (node) { listBySelection[node.id] = paperListHtml(view, node.id); });
    var payload = escapeForInlineScript(JSON.stringify({
      nodes: view.nodes,
      edges: view.edges,
      options: graphOptions('light'),
      highlight: paletteOf('light').highlight,
      shadowColor: 'rgba(194,120,3,0.30)',
      texts: view.texts,
      detailHtml: detailById,
      paperListHtml: listBySelection,
      defaultSelectedId: view.defaultSelectedId
    }));
    var summary = metaSummary(view.meta, view.texts);
    var payloadLine = 'var DATA=JSON.parse("' + asJsString(payload) + '");';
    var boot = VIEWER_SCRIPT.join('\n');
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>' + escapeHtml(title) + '</title>',
      '<style>',
      EXPORT_CSS,
      '</style></head><body>',
      '<aside class="side-panel left-panel">',
      '<div class="panel-head">' + escapeHtml(view.texts.papers) + '</div>',
      '<div class="panel-sub">' + summary + '</div>',
      '<div class="paper-list" id="paperList"></div></aside>',
      '<aside class="side-panel right-panel"><article class="detail-card" id="detailCard"></article></aside>',
      '<div id="net"></div>',
      '<div class="legend" id="legend">' + legendHtml(view) + '</div>',
      '<div id="hint">' + escapeHtml(view.texts.hint) + '</div>',
      '<script type="text/javascript">',
      String(libText || ''),
      '</script>',
      '<script type="text/javascript">',
      '(function loadVis(i){',
      '  var urls=' + JSON.stringify(VIS_CDN_URLS) + ';',
      '  function boot(){',
      payloadLine,
      boot,
      '  }',
      '  if(typeof vis!=="undefined"){boot();return;}',
      '  if(i>=urls.length){document.body.insertAdjacentHTML("beforeend",',
      '    \'<div style="position:fixed;left:10px;bottom:10px;background:#fdecea;border:1px solid #e15759;padding:8px 12px;font-size:12px;z-index:99">\' +',
      '    "vis-network 加载失败，请检查网络后刷新页面。</div>");return;}',
      '  var s=document.createElement("script");s.src=urls[i];s.onload=boot;',
      '  s.onerror=function(){s.remove();loadVis(i+1);};document.head.appendChild(s);',
      '})(0);',
      '</script>',
      '</body></html>'
    ].join('\n');
  }

  /* 导出快照样式：三栏 + 论文列表 + 详情卡 + 图例（浅色，自包含） */
  var EXPORT_CSS = [
    '  :root { --left-panel-w: 340px; --right-panel-w: 360px; --accent: #1f4f8f;',
    '    --selection: ' + HIGHLIGHT + '; --muted: #6f7d83; --rule: #e8ecee; }',
    '  * { box-sizing: border-box; }',
    '  body { margin: 0; background: #ffffff; color: #17252a;',
    '    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; overflow: hidden; }',
    '  #net { position: fixed; top: 0; left: var(--left-panel-w); right: var(--right-panel-w); bottom: 0;',
    '    width: auto; height: auto; background-color: #ffffff; }',
    '  .side-panel { position: fixed; top: 0; bottom: 0; width: var(--left-panel-w); background: #fff;',
    '    z-index: 12; overflow: hidden; display: flex; flex-direction: column; }',
    '  .left-panel { left: 0; border-right: 1px solid var(--rule); }',
    '  .right-panel { right: 0; width: var(--right-panel-w); border-left: 1px solid var(--rule);',
    '    box-shadow: -6px 0 20px rgba(30,42,46,0.06); }',
    '  .panel-head { height: 42px; padding: 14px 22px 0; color: var(--accent);',
    '    border-bottom: 1px solid #edf0f1; font-size: 12px; font-weight: 800; }',
    '  .panel-sub { padding: 8px 22px 9px; border-bottom: 1px solid #edf0f1; color: #86949a;',
    '    font-size: 11px; line-height: 1.5; }',
    // 列表用 flex 剩余高度而不是绝对定位：面板头/摘要的行数会随截断说明变化，
    // 写死 top 偏移会让摘要与首行列表叠在一起
    '  .paper-list { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 20px; }',
    '  .paper-row { display: grid; grid-template-columns: 1fr auto; gap: 8px;',
    '    padding: 15px 22px 14px; border-bottom: 1px solid #edf0f1; cursor: pointer; background: #fff; }',
    '  .paper-row:hover { background: #f8fbfb; }',
    '  .paper-row.active { background: #fff8e8; box-shadow: inset 3px 0 var(--selection); }',
    '  .origin-label { grid-column: 1 / 3; margin-bottom: -2px; color: #a86704; font-size: 12px; font-weight: 800; }',
    '  .paper-row h3 { grid-column: 1 / 3; margin: 0; font-size: 14px; line-height: 1.25; font-weight: 700; color: #111b1f; }',
    '  .paper-authors { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
    '    color: var(--muted); font-size: 12px; }',
    '  .paper-year { color: #6d7b81; font-size: 12px; align-self: end; }',
    '  .detail-card { padding: 28px 28px 34px; overflow-y: auto; height: 100%; }',
    '  .detail-card h2 { margin: 0 0 14px; color: #111b1f; font-size: 19px; line-height: 1.35; font-weight: 800; }',
    '  .detail-authors { display: flex; flex-wrap: wrap; gap: 8px; color: #6c767b; font-size: 13px; margin-bottom: 12px; }',
    '  .author-chip { background: #edf1f2; color: #526166; border-radius: 3px; padding: 2px 7px; }',
    '  .detail-meta { color: #7a858a; font-size: 13px; line-height: 1.7; margin-bottom: 20px; }',
    '  .detail-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0 22px; }',
    '  .stat { border: 1px solid #e2e7e8; border-radius: 6px; padding: 10px 8px; }',
    '  .stat b { display: block; color: #10252b; font-size: 16px; line-height: 1.1; }',
    '  .stat span { display: block; margin-top: 4px; color: #718086; font-size: 11px; }',
    '  .detail-abstract { margin: 0 0 20px; color: #26383e; font-size: 13px; line-height: 1.65; }',
    '  .detail-abstract b { display: block; margin-bottom: 6px; color: #17252a; }',
    '  .detail-section { border-top: 1px solid #edf0f1; padding-top: 16px; color: #26383e; font-size: 13px; line-height: 1.65; }',
    '  .id-line { margin-top: 16px; color: #758287; font-size: 12px; word-break: break-all; }',
    '  .empty-list { padding: 18px 22px; color: #7a858a; font-size: 13px; }',
    '  .legend { position: fixed; left: calc(var(--left-panel-w) + 24px); bottom: 18px; width: 240px;',
    '    border: 0; padding: 0; font-size: 11px; line-height: 1.6; color: #5b6472; z-index: 10; }',
    '  .legend b { display: none; }',
    '  .legend .yearbar { height: 8px; margin: 5px 0 2px; border-radius: 3px; }',
    '  .legend .yearbar-labels { display: flex; justify-content: space-between; color: #7a878b; }',
    '  .legend .ph { display: block; margin-top: 6px; cursor: pointer; color: #7a878b; }',
    '  #hint { position: fixed; right: 12px; bottom: 8px; color: #b6bfc7; font-size: 11px; z-index: 11; }',
    '  #meta-note { display: none; }',
    '  @media (max-width: 1100px) { :root { --left-panel-w: 300px; --right-panel-w: 320px; } }'
  ].join('\n');

  return {
    DEFAULTS: DEFAULTS,
    MAX_NODES: MAX_NODES,
    PALETTES: PALETTES,
    TEXTS: TEXTS,
    buildGraphData: buildGraphData,
    pageRank: pageRank,
    selectImportantNodes: selectImportantNodes,
    detectCommunities: detectCommunities,
    computeLayout: computeLayout,
    viewerData: viewerData,
    graphOptions: graphOptions,
    paperListHtml: paperListHtml,
    detailHtml: detailHtml,
    legendHtml: legendHtml,
    metaSummary: metaSummary,
    nodeSizes: nodeSizes,
    communityColor: communityColor,
    rampColor: rampColor,
    yearBarCss: yearBarCss,
    edgeStrengths: edgeStrengths,
    labelLimit: labelLimit,
    rankNodes: rankNodes,
    displayLabel: displayLabel,
    formatAuthors: formatAuthors,
    seededRandom: seededRandom,
    escapeForInlineScript: escapeForInlineScript,
    escapeHtml: escapeHtml,
    renderGraphHtml: renderGraphHtml
  };
});
