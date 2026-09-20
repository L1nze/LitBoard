/* LitBoard 引文网络：图数据组装与快照导出（浏览器 / Node 共用，纯逻辑零依赖）
 *
 * 约定：
 * - 每张图都基于调研库的明确数据快照：种子 + 深度 + 节点上限 + 构建时间随文件保存；
 * - 扩边走 BFS（引文边 = referenced_works），诱导子图——两端都在集合内才成边；
 * - 缺邻居时由检索服务先补库再计算（数据补齐在主进程 electron 侧，本模块只收注入的数据源）；
 * - 导出 HTML 为离线自包含文件（内嵌 vis-network + 内嵌图数据）；
 *   外部不可信串（标题等）进脚本上下文一律「JSON 序列化 + 脚本序列转义」两道闸。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitGraphGen = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULTS = { depth: 2, maxNodes: 200 };

  /**
   * 组装图数据（数据源注入，Node 可测）。
   * deps.getWorks(ids) → 库中已有行 [{id,title,year,citedBy,refs:[ids]}]
   * deps.fetchMissing(ids) → 联网补取并入库后返回的行（没有则缺漏）
   * seeds: 起始 workId 列表；params: {depth, maxNodes}；onProgress({phase,done,total})
   */
  async function buildGraphData(seeds, params, deps, onProgress) {
    var opts = params || {};
    var depth = Math.max(1, Math.min(3, Number(opts.depth) || DEFAULTS.depth));
    var maxNodes = Math.max(10, Math.min(500, Number(opts.maxNodes) || DEFAULTS.maxNodes));
    var getWorks = deps.getWorks;
    var fetchMissing = deps.fetchMissing || async function () { return []; };
    var notify = typeof onProgress === 'function' ? onProgress : function () {};

    var seedIds = (Array.isArray(seeds) ? seeds : []).map(String).filter(Boolean).slice(0, 50);
    if (!seedIds.length) return { nodes: [], edges: [], meta: metaOf(seedIds, depth, maxNodes, 0, 0) };

    var byId = new Map();   // id → work row
    function absorb(rows) {
      var added = [];
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (!row || !row.id) return;
        if (!byId.has(row.id)) { byId.set(row.id, row); added.push(row.id); }
        else if (row.refs && row.refs.length) {
          var cur = byId.get(row.id);
          if (!cur.refs || !cur.refs.length) byId.set(row.id, row);
        }
      });
      return added;
    }

    absorb(await getWorks(seedIds));
    var frontier = seedIds.filter(function (id) { return byId.has(id); });
    for (var d = 0; d < depth; d++) {
      if (!frontier.length || byId.size >= maxNodes) break;
      // 下一层候选 = 当前层的所有引用（不在集合内），按被引频次排序截取
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
      // 库中已有的先吸收，缺的再补取入库（fetchMissing 的副作用 = 补库）
      var have = await getWorks(nextIds);
      absorb(have);
      var missing = nextIds.filter(function (id) { return !byId.has(id); });
      if (missing.length) {
        notify({ phase: 'fetch', depth: d + 1, candidates: missing.length });
        absorb(await fetchMissing(missing));
      }
      frontier = nextIds.filter(function (id) { return byId.has(id); });
    }

    // 诱导子图：两端都在集合内才成边（边向 = 引用关系：from 引用了 to）
    var edges = [];
    var inDeg = new Map();
    var outDeg = new Map();
    byId.forEach(function (work, id) {
      (work.refs || []).forEach(function (rid) {
        if (!byId.has(rid)) return;
        edges.push({ from: id, to: rid });
        outDeg.set(id, (outDeg.get(id) || 0) + 1);
        inDeg.set(rid, (inDeg.get(rid) || 0) + 1);
      });
    });
    var ids = Array.from(byId.keys());
    var ranks = pageRank(ids, edges);
    var maxCited = 1;
    ids.forEach(function (id) {
      var c = byId.get(id).citedBy || 0;
      if (c > maxCited) maxCited = c;
    });
    var nodes = ids.map(function (id) {
      var w = byId.get(id);
      return {
        id: id,
        title: w.title || '',
        year: w.year || null,
        doi: w.doi || '',
        citedBy: w.citedBy || 0,
        sourceName: w.sourceName || '',
        inDeg: inDeg.get(id) || 0,
        outDeg: outDeg.get(id) || 0,
        rank: ranks.get(id) || 0,
        seed: seedIds.indexOf(id) !== -1
      };
    });
    return { nodes: nodes, edges: edges, meta: metaOf(seedIds, depth, maxNodes, nodes.length, edges.length) };
  }

  function metaOf(seedIds, depth, maxNodes, nodeCount, edgeCount) {
    return {
      version: 1,
      seeds: seedIds,
      depth: depth,
      maxNodes: maxNodes,
      nodeCount: nodeCount,
      edgeCount: edgeCount,
      builtAt: new Date().toISOString()
    };
  }

  /** PageRank（damping 0.85，幂迭代；方向 from 引用 → to 被引，故被引多的 rank 高） */
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
    var outEdges = new Map();
    edges.forEach(function (e) {
      if (!outEdges.has(e.from)) outEdges.set(e.from, []);
      outEdges.get(e.from).push(e.to);
    });
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

  /** 脚本上下文转义：JSON 文本的结构字符不含 `<`，全部 `\u003c` 化即可彻底杜绝 `</script`、`<!--` 等序列 */
  function escapeForInlineScript(jsonText) {
    return String(jsonText == null ? '' : jsonText).replace(/</g, '\\u003c');
  }

  function toVisNodes(nodes) {
    var maxCited = 1;
    nodes.forEach(function (n) { if (n.citedBy > maxCited) maxCited = n.citedBy; });
    return nodes.map(function (n) {
      var label = (n.title || n.id).split(/\s+/).slice(0, 6).join(' ');
      if (n.title && n.title.split(/\s+/).length > 6) label += '…';
      return {
        id: n.id,
        label: label,
        title: (n.title || n.id) + (n.year ? '（' + n.year + '）' : '') +
          (n.citedBy ? ' · 被引 ' + n.citedBy : '') + (n.doi ? '\n' + n.doi : ''),
        value: 8 + 24 * Math.sqrt((n.citedBy || 0) / maxCited),
        color: n.seed ? { background: '#ff9f43', border: '#d35400' } : undefined,
        borderWidth: n.rank > 0 ? 1 + Math.min(4, n.rank * 40) : 1
      };
    });
  }

  function toVisEdges(edges) {
    return edges.map(function (e, i) {
      return { id: 'e' + i, from: e.from, to: e.to, arrows: 'to' };
    });
  }

  /** JSON 文本 → 安全的 JS 字符串字面量内容（供 JSON.parse 侧恢复） */
  function asJsString(jsonText) {
    return String(jsonText == null ? '' : jsonText)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /** 离线自包含 HTML 快照：内嵌 vis-network（libText）+ 内嵌图数据 + 参数元数据 */
  function renderGraphHtml(data, libText, options) {
    var graph = data && data.nodes ? data : { nodes: [], edges: [], meta: {} };
    var meta = graph.meta || {};
    var title = String(options && options.title || 'LitBoard 引文网络');
    var payload = escapeForInlineScript(JSON.stringify({
      nodes: toVisNodes(graph.nodes),
      edges: toVisEdges(graph.edges),
      meta: meta
    }));
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>' + escapeHtml(title) + '</title>',
      '<style>',
      'html,body{margin:0;height:100%;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;background:#fff;color:#1f2329;}',
      '#graph{position:absolute;inset:0;}',
      '#panel{position:absolute;left:0;top:0;bottom:0;width:300px;overflow-y:auto;background:rgba(255,255,255,.96);',
      'border-right:1px solid #e5e6eb;padding:14px 14px 32px;box-sizing:border-box;}',
      '#panel h1{font-size:15px;margin:0 0 8px;}#panel .meta{color:#6b7280;font-size:12px;margin-bottom:12px;}',
      '#panel .meta div{margin:2px 0;}#detail{border-top:1px dashed #d8dade;padding-top:10px;font-size:12.5px;}',
      '#detail .t{font-weight:650;margin-bottom:4px;}#detail .d{color:#6b7280;white-space:pre-wrap;}',
      '#hint{position:absolute;right:10px;bottom:8px;color:#9ca3af;font-size:11px;}',
      '@media (max-width:760px){#panel{width:230px}}',
      '</style></head><body>',
      '<div id="panel"><h1>' + escapeHtml(title) + '</h1>',
      '<div class="meta">' +
        '<div>节点：' + (meta.nodeCount || 0) + ' · 边：' + (meta.edgeCount || 0) + '</div>' +
        '<div>种子：' + (meta.seeds ? meta.seeds.length : 0) + ' · 深度：' + (meta.depth || 0) + ' · 上限：' + (meta.maxNodes || 0) + '</div>' +
        '<div>构建于：' + escapeHtml(String(meta.builtAt || '')) + '</div></div>',
      '<div id="detail"><div class="d">点击节点查看文献详情；橙色 = 种子文献。</div></div>',
      '</div>',
      '<div id="graph"></div>',
      '<div id="hint">LitBoard 引文网络快照 · 离线自包含</div>',
      '<script type="text/javascript">',
      libText,
      '</script>',
      '<script type="text/javascript">',
      '(function(){',
      'var DATA=JSON.parse("' + asJsString(payload) + '");',
      'var nodes=new vis.DataSet(DATA.nodes);',
      'var edges=new vis.DataSet(DATA.edges);',
      'var net=new vis.Network(document.getElementById("graph"),{nodes:nodes,edges:edges},{',
      '  physics:{stabilization:{iterations:180}},interaction:{hover:true,tooltipDelay:120},',
      '  nodes:{shape:"dot",scaling:{label:false}},edges:{color:"#c9cdd4",smooth:{type:"continuous"}}',
      '});',
      'net.once("stabilizationIterationsDone",function(){net.setOptions({physics:false});});',
      'net.on("click",function(e){',
      '  var id=e.nodes&&e.nodes[0];if(!id)return;',
      '  var n=DATA.nodes.filter(function(x){return x.id===id})[0];if(!n)return;',
      '  var d=document.getElementById("detail");',
      '  d.innerHTML="<div class=\\"t\\"></div><div class=\\"d\\"></div>";',
      '  d.querySelector(".t").textContent=n.title||n.id;',
      '  d.querySelector(".d").textContent=[n.year?("年份："+n.year):"",n.doi?("DOI："+n.doi):"",(n.value!=null?("被引（对数缩放显示）")):""].filter(Boolean).join("\\n");',
      '});',
      '})();',
      '</script>',
      '</body></html>'
    ].join('\n');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  return {
    DEFAULTS: DEFAULTS,
    buildGraphData: buildGraphData,
    pageRank: pageRank,
    escapeForInlineScript: escapeForInlineScript,
    toVisNodes: toVisNodes,
    toVisEdges: toVisEdges,
    renderGraphHtml: renderGraphHtml,
    escapeHtml: escapeHtml
  };
});
