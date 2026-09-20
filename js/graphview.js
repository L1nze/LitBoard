/* LitBoard 引文网络面板（渲染层）：#graph-mask 的构建/渲染/导出/关闭
 *
 * - 应用内渲染用 vendored vis-network（index.html 静态引入）；
 * - 「导出 HTML」把 vis 库文本 + 图数据 + 参数元数据打成离线自包含文件
 *   （LitGraphGen.renderGraphHtml 负责脚本上下文转义）；
 *   会话里发起的构建直接存进会话附件目录（agent 流程），手动构建走另存为；
 * - 面板关闭只销毁视图（数据在调研库），重开重新构建/渲染。
 */
window.LitGraphView = (function () {
  'use strict';
  var T = function (s) { return (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) ? window.LitI18n.t(s) : s; };

  var desk = null;
  var deps = null;
  var lastData = null;
  var lastTitle = '';
  var net = null;
  var visLibText = null;
  var lastSeeds = [];

  function $(id) { return document.getElementById(id); }

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
    if (net) { try { net.destroy(); } catch (error) {} net = null; }
    lastData = null;
  }

  function setStatus(text) {
    var el = $('graph-status');
    if (el) el.textContent = text;
  }

  /** 入口：给定种子 workId 列表构建并展示（depth/maxNodes 读面板参数） */
  async function build(seeds, title) {
    lastSeeds = (Array.isArray(seeds) ? seeds : []).filter(Boolean).slice(0, 50);
    lastTitle = title || T('引文网络');
    $('graph-mask').hidden = false;
    $('graph-title').textContent = lastTitle;
    setStatus(T('正在构建（取数 → 扩邻居 → 计算）…'));
    try {
      var data = await desk.researchGraph({
        workIds: lastSeeds,
        depth: Number($('graph-depth').value) || 2,
        maxNodes: Number($('graph-maxnodes').value) || 200
      });
      lastData = data;
      render(data);
      setStatus(T('节点 ') + (data.meta.nodeCount || 0) + T(' · 边 ') + (data.meta.edgeCount || 0) +
        T(' · 深度 ') + data.meta.depth + T(' · 构建于 ') + String(data.meta.builtAt || '').slice(0, 19).replace('T', ' '));
    } catch (error) {
      setStatus(T('构建失败：') + String(error && error.message || error));
    }
  }

  function render(data) {
    if (!window.vis || !window.vis.Network) { setStatus(T('vis-network 未加载')); return; }
    var container = $('graph-canvas');
    if (net) { try { net.destroy(); } catch (error) {} net = null; }
    var nodes = new window.vis.DataSet(window.LitGraphGen.toVisNodes(data.nodes));
    var edges = new window.vis.DataSet(window.LitGraphGen.toVisEdges(data.edges));
    net = new window.vis.Network(container, { nodes: nodes, edges: edges }, {
      physics: { stabilization: { iterations: 200 } },
      interaction: { hover: true, tooltipDelay: 120 },
      nodes: { shape: 'dot', scaling: { label: false } },
      edges: { color: '#c9cdd4', smooth: { type: 'continuous' } }
    });
    net.once('stabilizationIterationsDone', function () {
      net.setOptions({ physics: false });
    });
  }

  async function ensureVisLibText() {
    if (visLibText) return visLibText;
    var response = await fetch('vendor/vis-network/vis-network.min.js');
    visLibText = await response.text();
    return visLibText;
  }

  /** 导出离线自包含 HTML：agent 会话里发起的存会话附件，手动入口走另存为 */
  async function exportHtml() {
    if (!lastData || !lastData.nodes || !lastData.nodes.length) { setStatus(T('没有可导出的图')); return; }
    var lib = await ensureVisLibText();
    var html = window.LitGraphGen.renderGraphHtml(lastData, lib, { title: lastTitle });
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

  /** 直接展示已组装好的图数据（agent 工具 build_graph 调用） */
  function showData(data, title) {
    lastData = data;
    lastSeeds = (data && data.meta && data.meta.seeds) || [];
    lastTitle = title || T('引文网络');
    $('graph-mask').hidden = false;
    $('graph-title').textContent = lastTitle;
    render(data);
    var meta = data && data.meta || {};
    setStatus(T('节点 ') + (meta.nodeCount || 0) + T(' · 边 ') + (meta.edgeCount || 0) +
      T(' · 深度 ') + (meta.depth || 0) + T(' · 构建于 ') + String(meta.builtAt || '').slice(0, 19).replace('T', ' '));
  }

  /** 把给定图数据导出为离线 HTML 并存进指定会话附件目录（agent 工具链用） */
  async function saveHtmlToSession(data, sessionId) {
    if (!desk || !desk.sessionSaveAttachment || !sessionId) return { file: '' };
    var lib = await ensureVisLibText();
    var html = window.LitGraphGen.renderGraphHtml(data, lib, { title: lastTitle || T('引文网络') });
    var b64 = btoa(unescape(encodeURIComponent(html)));
    var saved = await desk.sessionSaveAttachment(sessionId, {
      name: '引文网络 ' + (data.meta && data.meta.builtAt || '').slice(0, 10) + '.html',
      label: T('引文网络（') + (data.meta && data.meta.nodeCount || 0) + T(' 节点）'),
      dataBase64: b64
    });
    return { file: saved && saved.file || '' };
  }

  return { init: init, build: build, close: close, showData: showData, saveHtmlToSession: saveHtmlToSession };
})();
