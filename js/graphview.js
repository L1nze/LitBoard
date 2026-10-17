/* LitBoard 引文网络面板（渲染层）：#graph-mask 的三栏视图（本图文献 / 画布 / 详情）
 *
 * - 版式与交互对照 literature-mcp 的 HTML 快照：左列表点选、画布悬停显标签、右详情同步、
 *   力导向短暂收敛后自动冻结；数据侧（viewerData/paperListHtml/detailHtml/graphOptions）
 *   全部来自 LitGraphGen，导出快照与应用内面板共用同一套编码，避免两边版式漂移；
 * - 应用内渲染用 vendored vis-network（index.html 静态引入）；
 * - 「导出 HTML」把 vis 库文本 + 图数据 + 参数元数据打成离线自包含文件
 *   （LitGraphGen.renderGraphHtml 负责脚本上下文转义）；
 *   会话里发起的构建直接存进会话附件目录（agent 流程），手动构建走另存为；
 * - 面板关闭只销毁视图，保留最近一次图数据供 AI 侧快捷重开；关闭时把节点大字段
 *   （abstract 等）剥离成轻量快照，重开即时渲染后再按节点 id 从调研库回查补全摘要
 *   （本地读取，不触发联网构建），面板关闭期间不把整份图数据钉在内存。
 */
window.LitGraphView = (function () {
  'use strict';
  // params 透传（同 agentui：带 {n} 的键丢了第二参会显示成字面占位符）
  var T = function (s, params) {
    return (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) ? window.LitI18n.t(s, params) : s;
  };

  var desk = null;
  var deps = null;
  var lastGraph = null;     // 最近一次图数据；close() 后是轻量形态（节点 abstract 已剥离）
  var lastView = null;      // LitGraphGen.viewerData 产物（vis 数据 + 文案 + 预渲染列表/详情）
  var lastTitle = '';
  var lastSeeds = [];
  var graphToken = 0;       // 视图换代计数：作废关闭/换图后才返回的异步摘要回查
  var net = null;
  var nodes = null;
  var nodeIndex = new Map();
  var selected = null;
  var syncing = false;
  var freezeTimer = null;
  var animStart = 0;
  var visLibTextRef = null; // WeakRef 包箱（{text}）：两次导出之间不把 ~700KB 库全文钉在内存

  function $(id) { return document.getElementById(id); }
  function G() { return window.LitGraphGen; }

  /* 主题决定年份顺序色阶与连线基色；截图/导出恒用浅色版。 */
  function currentPalette() {
    var attr = document.documentElement.getAttribute('data-theme') || '';
    if (/^dark/.test(attr)) return 'dark';
    if (/^light/.test(attr)) return 'light';
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  /** 界面文案：图内所有短标签走 T()，与页签/工具条同一套双语机制 */
  function viewerTexts() {
    return {
      title: T('引文网络'),
      papers: T('本图文献'),
      origin: T('种子文献'),
      noPapers: T('本图没有文献。'),
      authorsUnavailable: T('作者未收录'),
      moreAuthors: T('另有 {n} 位作者'),
      unknownYear: T('年份未知'),
      unknownVenue: T('期刊未知'),
      citations: T('被引'),
      localCitedBy: T('库内被引'),
      localRefs: T('库内引用'),
      abstract: T('摘要'),
      community: T('社区'),
      contextLine: T('该文献在当前图中与 {n} 条库内引用相连。'),
      idLine: T('OpenAlex ID：{id}'),
      legendColor: T('颜色 = 年份'),
      legendSize: T('大小 = 被引量（稳健对数缩放）'),
      legendEdge: T('线深 = 局部引用强度'),
      legendCommunity: T('共 {n} 个引文社区'),
      legendClick: T('点击节点高亮；悬停显示作者与年份'),
      physics: T('力导向动画（稳定后自动关闭）'),
      toolYear: T('年份'),
      toolVenue: T('期刊'),
      toolCited: T('被引'),
      toolAuthors: T('作者'),
      toolCommunity: T('社区'),
      toolId: T('ID'),
      hint: T('引文网络快照 · 离线自包含'),
      truncated: T('原始 {total} 篇，按重要性保留 {kept} 篇，隐藏 {hidden} 篇')
    };
  }

  function init(options) {
    deps = options || {};
    desk = deps.desktop;
    if (!desk || typeof desk.researchGraph !== 'function') return;
    $('graph-close').addEventListener('click', close);
    $('graph-mask').addEventListener('click', function (e) { if (e.target === $('graph-mask')) close(); });
    $('graph-export').addEventListener('click', exportHtml);
    $('graph-rebuild').addEventListener('click', function () { build(lastSeeds, lastTitle); });
  }

  function close() {
    $('graph-mask').hidden = true;
    destroyView();
    lastView = null;
    graphToken++;            // 作废在途的摘要回查，防止迟到的结果把大字段写回轻量快照
    lastGraph = slimGraphForReopen(lastGraph);
  }

  /** close 后 lastGraph 只留重开所需的最小形态：meta/布局/边/社区原样保留，
   *  节点剥离 abstract 等大字段（id/title/year/作者/被引等展示小字段保留）。
   *  复制而非原地改：不触碰 agent 工具/冒烟流程传入的原始数据对象。 */
  function slimGraphForReopen(data) {
    if (!data || !Array.isArray(data.nodes)) return data;
    var slim = {};
    Object.keys(data).forEach(function (key) { slim[key] = data[key]; });
    slim.nodes = data.nodes.map(function (node) {
      if (!node || node.abstract == null) return node;
      var copy = {};
      Object.keys(node).forEach(function (key) { if (key !== 'abstract') copy[key] = node[key]; });
      return copy;
    });
    return slim;
  }

  /** 关闭后重开最近一次原生图窗：先渲染轻量快照（即时、离线），
   *  再按节点 id 从调研库回查补全摘要（本地读取，不重新联网构建）。 */
  function reopen() {
    if (!lastGraph) return false;
    showGraph(lastGraph, lastTitle);
    backfillAbstracts(lastGraph);
    return true;
  }

  /** 轻量快照的摘要回查：researchGetWorks 是调研库本地读取；查不到/失败就保持无摘要展示。 */
  function backfillAbstracts(graph) {
    if (!desk || typeof desk.researchGetWorks !== 'function' || !graph || !Array.isArray(graph.nodes)) return;
    var ids = graph.nodes.filter(function (node) { return node && node.id && node.abstract == null; })
      .map(function (node) { return node.id; });
    if (!ids.length) return;
    var token = graphToken;
    Promise.resolve().then(function () { return desk.researchGetWorks(ids); }).then(function (rows) {
      if (token !== graphToken) return; // 期间已关闭/换图：丢弃迟到结果
      var byId = {};
      (rows || []).forEach(function (row) { if (row && row.id) byId[row.id] = row.abstract || ''; });
      var touched = false;
      graph.nodes.forEach(function (node) {
        if (!node || node.id == null || byId[node.id] == null) return;
        node.abstract = byId[node.id];
        var view = nodeIndex.get(node.id);
        if (view) view.paperAbstract = String(byId[node.id]).trim();
        touched = true;
      });
      if (touched && selected) renderDetail(selected);
    }).catch(function () { /* 回查失败：保持轻量展示，摘要留待下次构建 */ });
  }

  function destroyView() {
    if (freezeTimer) { clearTimeout(freezeTimer); freezeTimer = null; }
    if (net) { try { net.destroy(); } catch (error) { /* 视图已销毁 */ } net = null; }
    window.__network = null; // 已销毁的 vis.Network 不得再被 UI 全局钉住
    nodes = null;
    nodeIndex = new Map();
    selected = null;
  }

  function setStatus(text) {
    var el = $('graph-status');
    if (el) el.textContent = text;
  }

  /** 入口：给定种子 workId 列表构建并展示（depth/maxNodes 读面板参数） */
  async function build(seeds, title) {
    lastSeeds = (Array.isArray(seeds) ? seeds : []).filter(Boolean).slice(0, 500);
    lastTitle = title || T('引文网络');
    $('graph-mask').hidden = false;
    $('graph-title').textContent = lastTitle;
    setStatus(T('正在构建（取数 → 扩邻居 → 计算）…'));
    try {
      var data = await desk.researchGraph({
        workIds: lastSeeds,
        depth: Number($('graph-depth').value),
        maxNodes: Number($('graph-maxnodes').value)
      });
      showGraph(data, lastTitle);
    } catch (error) {
      setStatus(T('构建失败：') + String(error && error.message || error));
    }
  }

  function metaLine(meta) {
    var m = meta || {};
    var line = T('节点 ') + (m.nodeCount || 0) + T(' · 边 ') + (m.edgeCount || 0) +
      T(' · 深度 ') + m.depth + T(' · 构建于 ') + String(m.builtAt || '').slice(0, 19).replace('T', ' ');
    if (m.truncated) line += ' · ' + T('已按重要性截取隐藏 {n} 篇（共 {total} 篇）', { n: m.hiddenCount || 0, total: m.totalCount || 0 });
    return line;
  }

  /** 直接展示已组装好的图数据（agent 工具 build_graph / 手动构建共用） */
  function showGraph(data, title) {
    lastGraph = data;
    graphToken++;           // 换图作废在途的旧图摘要回查
    if (!lastSeeds.length) lastSeeds = (data && data.meta && data.meta.seeds) || [];
    if (title) lastTitle = title;
    $('graph-mask').hidden = false;
    $('graph-title').textContent = lastTitle;
    render(data);
    setStatus(metaLine(data && data.meta));
  }

  function render(data) {
    if (!window.vis || !window.vis.Network) { setStatus(T('vis-network 未加载')); return; }
    if (!G()) return;
    destroyView();
    var palette = currentPalette();
    var view = G().viewerData(data, {
      palette: palette,
      texts: viewerTexts(),
      // 主进程 Rust 内核随图下发的预置布局（[[id,[x,y]],...]）：有则直接用，渲染层不再现算
      layout: data.layout ? new Map(data.layout) : undefined
    });
    lastView = view;
    view.nodes.forEach(function (node) { nodeIndex.set(node.id, node); });
    $('graph-list-head').textContent = view.texts.papers;
    $('graph-meta').innerHTML = G().metaSummary(view.meta, view.texts);
    $('graph-legend').innerHTML = G().legendHtml(view);
    var container = $('graph-canvas');
    nodes = new window.vis.DataSet(view.nodes);
    net = new window.vis.Network(container, { nodes: nodes, edges: new window.vis.DataSet(view.edges) },
      G().graphOptions(palette));
    window.__network = net;   // 调试/冒烟句柄（与导出快照同名）
    selected = view.defaultSelectedId;
    renderList();
    renderDetail(selected);
    bindNetwork();
    bindPhysics(view);
    // 首帧坐标由预置布局给定：先让 vis 把摄像机对准全图，再开始收敛动画
    try { net.fit({ animation: false }); } catch (error) { /* 空图无需适配 */ }
  }

  function renderList() {
    if (!lastView) return;
    var list = $('graph-list');
    list.innerHTML = G().paperListHtml(lastView, selected);
    Array.prototype.forEach.call(list.querySelectorAll('.paper-row'), function (row) {
      row.addEventListener('click', function () { selectNode(row.getAttribute('data-id'), true); });
    });
  }

  function renderDetail(id) {
    var card = $('graph-detail');
    if (!card) return;
    var node = id ? nodeIndex.get(id) : null;
    card.innerHTML = G().detailHtml(node, (lastView && lastView.texts) || {});
  }

  function selectNode(id, focus) {
    var node = nodeIndex.get(id);
    if (!node || !nodes) return;
    if (selected && selected !== id) {
      var previous = nodes.get(selected);
      if (previous && !previous.pinnedLabel) nodes.update({ id: previous.id, label: '' });
    }
    selected = id;
    nodes.update({ id: node.id, label: node.fullLabel });
    renderList();
    renderDetail(id);
    if (!syncing && net) {
      syncing = true;
      try { net.selectNodes([id], false); } catch (error) { /* 空图 */ }
      syncing = false;
    }
    if (focus && net) {
      net.focus(id, { scale: 1.05, animation: { duration: 450, easingFunction: 'easeInOutQuad' } });
    }
  }

  function bindNetwork() {
    net.on('hoverNode', function (params) {
      var node = nodes.get(params.node);
      if (node && !node.pinnedLabel) nodes.update({ id: node.id, label: node.fullLabel });
      if (node && nodeIndex.has(node.id)) renderDetail(node.id);
    });
    net.on('blurNode', function (params) {
      var node = nodes.get(params.node);
      if (node && !node.pinnedLabel && node.id !== selected) nodes.update({ id: node.id, label: '' });
      if (selected) renderDetail(selected);
    });
    net.on('selectNode', function (params) {
      if (!syncing && params.nodes[0]) selectNode(params.nodes[0], false);
    });
  }

  /* 短暂力导向收敛后冻结（大图不会持续吃 CPU）；图例里的开关可手动重开 */
  function bindPhysics() {
    var toggle = $('physicsToggle');
    function freeze() {
      if (freezeTimer) clearTimeout(freezeTimer);
      var remaining = Math.max(0, 1200 - (performance.now() - animStart));
      freezeTimer = setTimeout(function () {
        if (net) net.setOptions({ physics: { enabled: false } });
        if (toggle) toggle.checked = false;
      }, remaining);
    }
    animStart = performance.now();
    net.once('stabilized', freeze);
    freezeTimer = setTimeout(freeze, 6000);
    if (toggle) {
      toggle.addEventListener('change', function (event) {
        if (freezeTimer) clearTimeout(freezeTimer);
        if (!net) return;
        net.setOptions({ physics: { enabled: event.target.checked } });
        if (event.target.checked) {
          animStart = performance.now();
          net.startSimulation();
          freezeTimer = setTimeout(freeze, 6000);
        }
      });
    }
  }

  async function ensureVisLibText() {
    var box = visLibTextRef && visLibTextRef.deref();
    if (box) return box.text;
    var response = await fetch('vendor/vis-network/vis-network.min.js');
    var text = await response.text();
    // WeakRef 只能挂对象：字符串装箱。导出之间该箱可被回收（下次导出重新 fetch），
    // 不把 ~700KB 的库全文常驻内存；无 WeakRef 的环境干脆不缓存。
    if (typeof WeakRef === 'function') visLibTextRef = new WeakRef({ text: text });
    return text;
  }

  /** 导出离线自包含 HTML：agent 会话里发起的存会话附件，手动入口走另存为 */
  async function exportHtml() {
    if (!lastGraph || !lastGraph.nodes || !lastGraph.nodes.length) { setStatus(T('没有可导出的图')); return; }
    var lib = await ensureVisLibText();
    var html = G().renderGraphHtml(lastGraph, lib, { title: lastTitle, texts: viewerTexts() });
    var b64 = btoa(unescape(encodeURIComponent(html)));
    var name = window.LitResearch.sessionDirName(lastTitle, 1) + '.html';
    var sessionId = deps.getAgentSessionId ? deps.getAgentSessionId() : '';
    if (sessionId && desk.sessionSaveAttachment) {
      var saved = await desk.sessionSaveAttachment(sessionId, {
        name: name, label: lastTitle, dataBase64: b64
      });
      setStatus(T('✓ 已存入会话附件：') + (saved && saved.file || ''));
      if (deps.toast) deps.toast(T('✓ 已存入会话附件：') + (saved && saved.file || ''));
      return;
    }
    var ok = await desk.saveFile({
      name: name,
      content: html,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    });
    if (ok) { setStatus(T('✓ 已导出')); if (deps.toast) deps.toast(T('✓ 已导出 HTML 快照')); }
  }

  /** 把给定图数据导出为离线 HTML 并存进指定会话附件目录（agent 工具链用） */
  async function saveHtmlToSession(data, sessionId) {
    if (!desk || !desk.sessionSaveAttachment || !sessionId) return { file: '' };
    var lib = await ensureVisLibText();
    var html = G().renderGraphHtml(data, lib, { title: lastTitle || T('引文网络'), texts: viewerTexts() });
    var b64 = btoa(unescape(encodeURIComponent(html)));
    var saved = await desk.sessionSaveAttachment(sessionId, {
      name: '引文网络 ' + ((data.meta && data.meta.builtAt) || '').slice(0, 10) + '.html',
      label: T('引文网络（') + ((data.meta && data.meta.nodeCount) || 0) + T(' 节点）'),
      dataBase64: b64
    });
    return { file: saved && saved.file || '' };
  }

  return {
    init: init, build: build, close: close, reopen: reopen,
    showData: showGraph, showGraph: showGraph,
    saveHtmlToSession: saveHtmlToSession
  };
})();
