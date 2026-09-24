/* LitBoard 主程序：状态、渲染、交互 */
(function () {
  'use strict';
  var T = (window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js
  /* 启动即翻译静态骨架：此时文档里只有界面元素、没有用户数据，
   * 整串精确替换不会误伤文献标题/笔记等内容；动态区域由 T() 直出。 */
  if (window.LitI18n) {
    document.documentElement.lang = window.LitI18n.getLang();
    window.LitI18n.applyStatic(document);
    if (window.litboardDesktop && window.litboardDesktop.setSetting) {
      // 镜像给主进程：原生对话框按同一语言出文案（失败无碍，仅少本地化）
      window.litboardDesktop.setSetting('uiLang', window.LitI18n.getLang()).catch(function () {});
    }
  }

  var STORE_KEY = 'litboard.papers.v1';
  var ONBOARD_DISMISS_KEY = 'litboard.onboardDismissed';
  var PANE_SIZES_KEY = 'litboard.paneSizes';
  var LEFT_SIDEBAR_COLLAPSED_KEY = 'litboard.leftSidebarCollapsed.v1';
  var RIGHT_SIDEBAR_COLLAPSED_KEY = 'litboard.rightSidebarCollapsed.v1';
  var FOLDER_TREE_KEY = 'litboard.folderTree.v1';
  var STATS_COLLAPSED_KEY = 'litboard.statsCollapsed.v1';
  var TAG_LIST_COLLAPSED_KEY = 'litboard.sidebarTagListCollapsed.v1';
  var TAG_LIST_HEIGHT_KEY = 'litboard.sidebarTagListHeight.v1';
  var HIDDEN_PURGED_KEY = 'litboard.hiddenPurged.v1';
  var SHORTCUTS_KEY = 'litboard.shortcuts.v1';
  var TABLE_PAGE_SIZE = 100;
  var workspaceStore = null;
  var desktop = window.litboardDesktop || null;
  var FONT_SCALE_KEY = 'litboard.fontScale';
  var FONT_SCALE_MIN = 0.8;
  var FONT_SCALE_MAX = 1.3;
  var fontScale = 1;

  function applyFontScale(value) {
    fontScale = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, Math.round(value * 10) / 10));
    if (desktop && desktop.setZoomFactor) desktop.setZoomFactor(fontScale);
    localStorage.setItem(FONT_SCALE_KEY, String(fontScale));
    var output = $('#sync-font-size-value');
    if (output) output.textContent = Math.round(fontScale * 100) + '%';
    var down = $('#sync-font-size-down');
    var up = $('#sync-font-size-up');
    if (down) down.disabled = fontScale <= FONT_SCALE_MIN;
    if (up) up.disabled = fontScale >= FONT_SCALE_MAX;
  }

  var savedFontScale = Number(localStorage.getItem(FONT_SCALE_KEY));
  applyFontScale(Number.isFinite(savedFontScale) && savedFontScale >= FONT_SCALE_MIN && savedFontScale <= FONT_SCALE_MAX
    ? savedFontScale : 1);

  var state = {
    papers: [],
    notes: [],           // Note 实体集合（v12；含 deletedAt 墓碑，供同步删除传播）
    folders: [],
    folderTombstones: [],
    savedSearches: [],
    savedSearchTombstones: [],
    tagColors: {},
    tagColorRecords: [],
    activeFolderId: 'all',
    collapsedFolders: {},
    expandedRows: {},    // paperId -> true，行展开状态（附件子行）
    selected: {},        // id -> true，批量选择
    focusId: null,       // 键盘导航聚焦的行
    selAnchor: null,     // Shift 区间选择的锚点行 id
    lastDeleted: null,   // 撤销删除用
    hiddenPurged: {},    // id -> true，彻底删除（永久墓碑；视图层一律排除）
    filters: { q: '', status: '', tag: '', year: null, pdfOnly: false, bibkeys: [] },
    resultView: 'papers',          // 阶段四：文献 | 批注 | 笔记 | 附件
    activeFolderIds: [],           // 阶段四：Ctrl+点击多选文件夹（含子文件夹）
    folderSelAnchor: null,         // 文件夹 Shift 区间选择的锚点（最近一次非 range 点击）
    folderFocusId: null,           // 文件夹树键盘导航的聚焦行
    shortcuts: { pdfOnly: 'p', bibkey: 'b' },
    tablePage: 0,
    sort: { key: 'addedAt', dir: -1 },
    ftEnabled: false,      // PDF 全文检索模式
    ftHits: {}             // paperId -> { pages, count }
  };

  var TABLE_COLUMNS_KEY = 'litboard.tableColumns';
  var TABLE_COLUMNS = [
    { key: 'attachment', label: 'PDF', width: 38, fixed: true },
    { key: 'title', label: '标题', width: 260, fixed: true },
    { key: 'status', label: '状态', width: 76 },
    { key: 'authors', label: '作者', width: 150 },
    { key: 'year', label: '年份', width: 64 },
    { key: 'venue', label: '期刊 / 会议', width: 180 },
    { key: 'rank', label: '分区', width: 150 },
    { key: 'rating', label: '评分', width: 80 },
    { key: 'tags', label: '标签', width: 160, optional: true },
    { key: 'addedAt', label: '添加时间', width: 108, optional: true },
    { key: 'updatedAt', label: '修改时间', width: 108, optional: true },
    { key: 'doi', label: 'DOI', width: 210, optional: true }
  ];
  var tableColumns = (function () {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(TABLE_COLUMNS_KEY)) || {}; } catch (error) {}
    var result = {};
    TABLE_COLUMNS.forEach(function (column) {
      var value = saved[column.key] || {};
      result[column.key] = {
        visible: column.fixed || (typeof value.visible === 'boolean' ? value.visible : !column.optional),
        width: column.key === 'attachment' ? column.width :
          Math.max(column.key === 'title' ? 180 : 48, Math.min(800, Number(value.width) || column.width))
      };
    });
    return result;
  })();
  function visibleTableColumns() {
    return TABLE_COLUMNS.filter(function (column) { return tableColumns[column.key].visible; });
  }
  function saveTableColumns() {
    try { localStorage.setItem(TABLE_COLUMNS_KEY, JSON.stringify(tableColumns)); } catch (error) {}
  }
  function applyTableColumns(widthOnly) {
    var total = 0;
    var headers = {};
    TABLE_COLUMNS.forEach(function (column) {
      var th = $('#lit-table th[data-column="' + column.key + '"]');
      if (!th) return;
      headers[column.key] = th;
      var preference = tableColumns[column.key];
      if (!widthOnly) th.hidden = !preference.visible;
      if (preference.visible) total += preference.width;
    });
    var spare = Math.max(0, $('#table-wrap').clientWidth - total);
    var titleExtra = Math.round(spare * (tableColumns.venue.visible ? 0.6 : 1));
    TABLE_COLUMNS.forEach(function (column) {
      var extra = column.key === 'title' ? titleExtra : column.key === 'venue' ? spare - titleExtra : 0;
      headers[column.key].style.width = (tableColumns[column.key].width + extra) + 'px';
    });
    $('#lit-table').style.width = (total + spare) + 'px';
    if (widthOnly) return;
    $all('#table-body tr[data-id], #table-body tr.attachment-subrow').forEach(function (row) {
      Array.prototype.forEach.call(row.cells, function (cell) {
        cell.hidden = !tableColumns[cell.dataset.column].visible;
      });
    });
  }

  // ---------- 工具 ----------
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // 引用 index.html 内的 SVG sprite（lb-i-*），用于 JS 动态生成的图标
  function svgUse(id, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
  }
  function setBtnLabel(btn, text) {
    var span = btn && btn.querySelector('.btn-label');
    if (span) span.textContent = text;
  }
  function uid() { return 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function folderUid() { return 'fld' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); } // 'fld' 前缀与 Zotero 导入的 'fzc' 隔离
  function debounce(fn, ms) {
    var t, args, self;
    function run() {
      t = null;
      var callArgs = args, callSelf = self;
      args = self = null;
      fn.apply(callSelf, callArgs);
    }
    function wrapped() {
      args = arguments; self = this;
      clearTimeout(t); t = setTimeout(run, ms);
    }
    wrapped.flush = function () { if (t) { clearTimeout(t); run(); } };
    return wrapped;
  }

  function readCollapsedFolders() {
    try {
      var value = JSON.parse(localStorage.getItem(FOLDER_TREE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (e) { return {}; }
  }

  function readHiddenPurged() {
    try {
      var value = JSON.parse(localStorage.getItem(HIDDEN_PURGED_KEY) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        var clean = {};
        Object.keys(value).forEach(function (id) { clean[id] = true; });
        return clean;
      }
    } catch (e) {}
    try {
      var staleIds = JSON.parse(localStorage.getItem(HIDDEN_PURGED_KEY) || '[]');
      var map = {};
      (Array.isArray(staleIds) ? staleIds : []).forEach(function (id) { map[id] = true; });
      return map;
    } catch (e) { return {}; }
  }
  function saveHiddenPurged() {
    try {
      var map = {};
      Object.keys(state.hiddenPurged).forEach(function (id) {
        if (state.hiddenPurged[id]) map[id] = state.hiddenPurged[id];
      });
      localStorage.setItem(HIDDEN_PURGED_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function readShortcutSettings() {
    try {
      var value = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) || '{}');
      return {
        pdfOnly: typeof value.pdfOnly === 'string' && value.pdfOnly ? value.pdfOnly : 'p',
        bibkey: typeof value.bibkey === 'string' && value.bibkey ? value.bibkey : 'b'
      };
    } catch (e) { return { pdfOnly: 'p', bibkey: 'b' }; }
  }

  function shortcutFromEvent(e) {
    var key = String(e.key || '').toLowerCase();
    if (!key || ['control', 'shift', 'alt', 'meta'].indexOf(key) !== -1) return '';
    if (key === ' ') key = 'space';
    var parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    parts.push(key);
    return parts.join('+');
  }

  function shortcutLabel(value) {
    return String(value || '').split('+').map(function (part) {
      var labels = { ctrl: 'Ctrl', meta: 'Meta', alt: 'Alt', shift: 'Shift', space: 'Space' };
      return labels[part] || (part.length === 1 ? part.toUpperCase() : part);
    }).join(' + ');
  }

  function matchesShortcut(e, value) {
    return !e.repeat && shortcutFromEvent(e) === value;
  }

  function renderShortcutSettings() {
    $all('[data-shortcut]').forEach(function (input) {
      input.value = shortcutLabel(state.shortcuts[input.dataset.shortcut]);
    });
  }
  function saveCollapsedFolders() {
    localStorage.setItem(FOLDER_TREE_KEY, JSON.stringify(state.collapsedFolders));
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  /* 两侧栏可调范围：拖拽钳制、持久化回读、ARIA 三处共用一份，免得改一处漏两处。
     右栏上限放宽到 800（详情/对话面板在宽屏下值得更宽）；实际能拖到多少还要过
     applyPaneSizes 的「中间栏至少留 520px」——那是防止列表被挤扁的硬底线。 */
  var PANE_LIMITS = { left: { min: 160, max: 360 }, right: { min: 300, max: 800 } };

  function readPaneSizes() {
    try {
      var value = JSON.parse(localStorage.getItem(PANE_SIZES_KEY) || '{}');
      return {
        left: clamp(Number(value.left) || 220, PANE_LIMITS.left.min, PANE_LIMITS.left.max),
        right: clamp(Number(value.right) || 370, PANE_LIMITS.right.min, PANE_LIMITS.right.max)
      };
    } catch (e) { return { left: 220, right: 370 }; }
  }

  function applyPaneSizes(sizes) {
    var workspace = $('.workspace');
    if (!workspace) return;
    var available = Math.max(0, workspace.clientWidth - 520);
    var left = clamp(sizes.left, PANE_LIMITS.left.min, PANE_LIMITS.left.max);
    var right = clamp(sizes.right, PANE_LIMITS.right.min, PANE_LIMITS.right.max);
    var leftCollapsed = workspace.classList.contains('left-collapsed');
    var rightCollapsed = workspace.classList.contains('rail-collapsed');
    var leftReserved = leftCollapsed ? 28 : left;
    var rightReserved = rightCollapsed ? 0 : right;
    if (leftReserved + rightReserved > available && available >= 460) {
      if (!rightCollapsed && right > PANE_LIMITS.right.min) {
        right = Math.max(PANE_LIMITS.right.min, available - leftReserved);
      }
      if (!leftCollapsed && left + (rightCollapsed ? 0 : right) > available) {
        left = Math.max(PANE_LIMITS.left.min, available - (rightCollapsed ? 0 : right));
      }
    }
    workspace.style.setProperty('--library-width', left + 'px');
    workspace.style.setProperty('--detail-width', right + 'px');
    workspace.dataset.leftWidth = left;
    workspace.dataset.rightWidth = right;
    syncReadingRail(); // 阅读模式下拖宽侧栏时，PDF 让位宽度与把手位置实时跟随
    $('#resizer-left').setAttribute('aria-valuenow', left);
    $('#resizer-left').setAttribute('aria-valuemin', String(PANE_LIMITS.left.min));
    $('#resizer-left').setAttribute('aria-valuemax', String(PANE_LIMITS.left.max));
    $('#resizer-right').setAttribute('aria-valuenow', right);
    $('#resizer-right').setAttribute('aria-valuemin', String(PANE_LIMITS.right.min));
    $('#resizer-right').setAttribute('aria-valuemax', String(PANE_LIMITS.right.max));
  }

  function savePaneSizes() {
    var workspace = $('.workspace');
    if (!workspace) return;
    localStorage.setItem(PANE_SIZES_KEY, JSON.stringify({
      left: Number(workspace.dataset.leftWidth),
      right: Number(workspace.dataset.rightWidth)
    }));
  }

  function readCollapsedPreference(key) {
    try { return localStorage.getItem(key) === '1'; } catch (error) { return false; }
  }

  function setLeftSidebarCollapsed(collapsed, persist) {
    var workspace = $('.workspace');
    var collapseButton = $('#btn-left-sidebar-collapse');
    var openButton = $('#btn-left-sidebar-open');
    var sidebar = $('#library-sidebar');
    workspace.classList.toggle('left-collapsed', collapsed);
    sidebar.setAttribute('aria-hidden', String(collapsed));
    sidebar.inert = collapsed;
    openButton.hidden = !collapsed;
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    openButton.setAttribute('aria-expanded', String(collapsed));
    applyPaneSizes({
      left: Number(workspace.dataset.leftWidth) || 220,
      right: Number(workspace.dataset.rightWidth) || 370
    });
    if (persist) {
      try { localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (error) {}
    }
  }

  function setRightSidebarCollapsed(collapsed, persist) {
    var workspace = $('.workspace');
    var sidebar = $('#detail-sidebar');
    workspace.classList.toggle('rail-collapsed', collapsed);
    sidebar.setAttribute('aria-hidden', String(collapsed));
    sidebar.inert = collapsed;
    applyPaneSizes({
      left: Number(workspace.dataset.leftWidth) || 220,
      right: Number(workspace.dataset.rightWidth) || 370
    });
    if (persist) {
      try { localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (error) {}
    }
  }

  function bindPaneResizer(id, side) {
    var handle = $('#' + id);
    var workspace = $('.workspace');
    var startX = 0, startWidth = 0;
    function resizeTo(width) {
      var sizes = {
        left: Number(workspace.dataset.leftWidth) || 220,
        right: Number(workspace.dataset.rightWidth) || 370
      };
      sizes[side] = width;
      applyPaneSizes(sizes);
    }
    handle.addEventListener('pointerdown', function (e) {
      startX = e.clientX;
      startWidth = Number(workspace.dataset[side + 'Width']);
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('resizing-panes');
    });
    handle.addEventListener('pointermove', function (e) {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      var delta = e.clientX - startX;
      resizeTo(startWidth + (side === 'left' ? delta : -delta));
    });
    function finish(e) {
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-panes');
      savePaneSizes();
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('dblclick', function () {
      resizeTo(side === 'left' ? 220 : 370);
      savePaneSizes();
    });
    handle.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var current = Number(workspace.dataset[side + 'Width']);
      var delta = e.key === 'ArrowRight' ? 10 : -10;
      resizeTo(current + (side === 'left' ? delta : -delta));
      savePaneSizes();
    });
  }

  /* ---------- 弹窗拖拽改尺寸（右下角手柄） ----------
   * 弹窗由遮罩居中，所以尺寸按「指针到弹窗中心的距离 ×2」换算：直接累加指针位移会让
   * 手柄只走一半（居中布局把增量对半分给了两侧）。尺寸按弹窗键名存 localStorage
   * （与栏宽 PANE_SIZES_KEY 同一条思路：纯界面布局偏好，不进库、不参与同步）。 */
  var MODAL_SIZES_KEY = 'litboard.modalSizes';

  function readModalSizes() {
    try { return JSON.parse(localStorage.getItem(MODAL_SIZES_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeModalSize(key, size) {
    var all = readModalSizes();
    if (size) all[key] = { w: Math.round(size.w), h: Math.round(size.h) };
    else delete all[key];
    try {
      if (Object.keys(all).length) localStorage.setItem(MODAL_SIZES_KEY, JSON.stringify(all));
      else localStorage.removeItem(MODAL_SIZES_KEY);
    } catch (e) {}
  }
  /* 可拖范围：遮罩给了 20px 内边距，四边各让出来，弹窗不会贴边也不会溢出屏幕 */
  function modalSizeBounds(minW, minH) {
    var maxW = Math.max(320, window.innerWidth - 40);
    var maxH = Math.max(240, window.innerHeight - 40);
    return { minW: Math.min(minW, maxW), minH: Math.min(minH, maxH), maxW: maxW, maxH: maxH };
  }
  /* size 为空 = 复位到 CSS 默认尺寸（清掉内联样式） */
  function applyModalSize(modal, size, minW, minH) {
    if (!modal) return;
    if (!size) { modal.style.width = ''; modal.style.height = ''; modal.style.maxHeight = ''; return; }
    var b = modalSizeBounds(minW, minH);
    var w = Math.round(clamp(size.w, b.minW, b.maxW));
    var h = Math.round(clamp(size.h, b.minH, b.maxH));
    modal.style.width = w + 'px';
    modal.style.height = h + 'px';
    modal.style.maxHeight = h + 'px'; // 覆盖 .sync-modal 自带的 max-height，否则拖不高
  }

  function bindModalResizer(modal, grip, key, minW, minH) {
    if (!modal || !grip) return;
    var centerX = 0, centerY = 0, dragId = null;
    function saveCurrentSize() {
      if (!modal.style.width) { writeModalSize(key, null); return; }
      writeModalSize(key, { w: parseInt(modal.style.width, 10), h: parseInt(modal.style.height, 10) });
    }
    function currentSize() {
      var rect = modal.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    }
    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var rect = modal.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      dragId = e.pointerId;
      // 捕获失败（合成事件没有真实指针）不该让拖拽失效：下面的判定看 dragId，不看捕获
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      grip.classList.add('dragging');
      document.body.classList.add('resizing-modal');
    });
    grip.addEventListener('pointermove', function (e) {
      if (dragId === null || e.pointerId !== dragId) return;
      applyModalSize(modal, {
        w: Math.abs(e.clientX - centerX) * 2,
        h: Math.abs(e.clientY - centerY) * 2
      }, minW, minH);
    });
    function finish(e) {
      if (dragId === null || e.pointerId !== dragId) return;
      dragId = null;
      try { if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); } catch (err) {}
      grip.classList.remove('dragging');
      document.body.classList.remove('resizing-modal');
      saveCurrentSize();
    }
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
    grip.addEventListener('dblclick', function () {
      applyModalSize(modal, null, minW, minH);
      writeModalSize(key, null);
    });
    grip.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 40 : 16;
      var dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      var dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      var size = currentSize();
      applyModalSize(modal, { w: size.w + dx, h: size.h + dy }, minW, minH);
      saveCurrentSize();
    });
    // 窗口变小后原尺寸可能已经超界：按新视口重新钳制（存的值不动，窗口变大再打开即恢复）
    window.addEventListener('resize', function () {
      if (modal.hidden || !modal.style.width) return;
      applyModalSize(modal, currentSize(), minW, minH);
    });
  }

  function toast(msg, ms, action) {
    var el = document.createElement('div');
    el.className = 'toast';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    var timer = ms === 0 ? null : setTimeout(remove, ms || 2600);
    function remove() { if (timer) clearTimeout(timer); el.remove(); }
    if (action && action.label && action.fn) {
      var btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', function () { remove(); action.fn(); });
      el.appendChild(btn);
    }
    $('#toast-wrap').appendChild(el);
    // M3 通知中心：⚠ 开头的失败提示进入可找回列表，不再转瞬即逝
    if (/^⚠/.test(String(msg))) recordIssue(msg);
    return remove;
  }

  /* ---- M3 通知中心：最近的问题与失败提示（本机 localStorage，保留 20 条，不上传） ---- */
  var ISSUES_KEY = 'litboard.issues';
  var unseenIssues = 0;

  function readIssues() {
    try {
      var value = JSON.parse(localStorage.getItem(ISSUES_KEY) || '[]');
      return Array.isArray(value) ? value.slice(0, 20) : [];
    } catch (e) { return []; }
  }

  function writeIssues(list) {
    try { localStorage.setItem(ISSUES_KEY, JSON.stringify(list.slice(0, 20))); } catch (e) {}
  }

  function recordIssue(msg) {
    var list = readIssues();
    if (list[0] && list[0].msg === msg && Date.now() - list[0].time < 3000) return; // 连续同文去重
    list.unshift({ time: Date.now(), msg: String(msg) });
    writeIssues(list);
    unseenIssues++;
    updateIssueBadge();
  }

  function updateIssueBadge() {
    var btn = $('#btn-issues');
    var badge = $('#issues-badge');
    if (!btn || !badge) return;
    btn.hidden = false;
    badge.hidden = unseenIssues === 0;
    badge.textContent = unseenIssues > 9 ? '9+' : String(unseenIssues);
  }

  function renderIssuesMenu() {
    var listEl = $('#issues-list');
    if (!listEl) return;
    var list = readIssues();
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.innerHTML = T('<div class="issues-empty">没有记录</div>');
      return;
    }
    list.forEach(function (issue) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-item issues-item';
      item.title = T('点击复制详情');
      var timeEl = document.createElement('span');
      timeEl.className = 'issues-time';
      timeEl.textContent = new Date(issue.time).toLocaleString();
      var msgEl = document.createElement('span');
      msgEl.className = 'issues-msg';
      msgEl.textContent = issue.msg;
      item.appendChild(timeEl);
      item.appendChild(msgEl);
      item.addEventListener('click', function () {
        copyToClipboard('[' + new Date(issue.time).toLocaleString() + '] ' + issue.msg);
        toast(T('✓ 问题详情已复制到剪贴板'));
      });
      listEl.appendChild(item);
    });
  }

  /* ---- 顶栏下拉菜单互斥 ----
   * 通知中心 / 导出 / 更多三个下拉同在一个 .menu-wrap 内，都是 right:0 + top:100%，
   * 同时展开会完全叠在一起。而每个开关的 click 都必须 stopPropagation（不挡冒泡的话，
   * document 级「点击外部即关闭」会在按钮自己的 handler 之前把刚展开的面板关掉，表现为
   * 「点了没反应」），于是「先开 A 再点 B」时 A 收不到 dismiss —— 两块面板一起留着。
   * 这里统一登记顶栏下拉：展开任何一个之前先收起其余。关闭仍走各自的 document click
   * （保留「点菜单项即收起」的语义）。 */
  var topbarMenus = [];
  function registerTopbarMenu(button, menu) {
    if (!button || !menu) return;
    topbarMenus = topbarMenus.filter(function (entry) { return entry.menu !== menu; });
    topbarMenus.push({ button: button, menu: menu });
  }
  /** 切换一个已登记的顶栏下拉，返回切换后是否展开；展开前先收起同族的其它下拉。 */
  function toggleTopbarMenu(menu) {
    var willOpen = menu.hidden;
    topbarMenus.forEach(function (entry) { if (entry.menu !== menu) entry.menu.hidden = true; });
    menu.hidden = !willOpen;
    return willOpen;
  }

  function setupIssuesMenu() {
    var btn = $('#btn-issues');
    var menu = $('#issues-menu');
    if (!btn || !menu) return;
    registerTopbarMenu(btn, menu);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (toggleTopbarMenu(menu)) {
        unseenIssues = 0;
        updateIssueBadge();
        renderIssuesMenu();
      }
    });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { menu.hidden = true; });
    $('#issues-clear').addEventListener('click', function () {
      writeIssues([]);
      renderIssuesMenu();
      toast(T('已清空问题记录'));
    });
  }

  function copyToClipboard(text) {
    if (desktop) return desktop.copyText(text);
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return dlgPrompt(T('复制以下内容'), '', '', text).then(function () {});
  }

  /** 统一删除入口：软删除（置墓碑），toast 可撤销；回收站中可恢复或彻底清除 */
  function removePapers(ids, label) {
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });
    var now = Date.now();
    var removed = state.papers.filter(function (p) { return idSet[p.id] && !p.deletedAt; });
    if (!removed.length) return;
    var undoBefore = makeSnapshot({ papers: removed.map(function (p) { return p.id; }) });
    removed.forEach(function (p) {
      p.deletedAt = now;
      p.updatedAt = now;
      delete state.selected[p.id];
    });
    commitUndo(T('移入回收站 ') + removed.length + T(' 篇'), undoBefore, { papers: removed.map(function (p) { return p.id; }) });
    state.lastDeleted = removed;
    save(); closeDrawer(); renderAll();
    toast(label || (T('已移入回收站 ') + removed.length + T(' 篇')), 6000, {
      label: T('撤销'), fn: function () {
        if (!state.lastDeleted) return;
        state.lastDeleted.forEach(function (p) { p.deletedAt = null; p.updatedAt = Date.now(); });
        var n = state.lastDeleted.length;
        state.lastDeleted = null;
        save(); renderAll();
        toast(T('已恢复 ') + n + T(' 篇'));
      }
    });
  }

  function confirmPapersToTrash(ids) {
    var papers = ids.map(getById).filter(function (p) { return p && !p.deletedAt; });
    if (!papers.length) return;
    dlgConfirm(T('移入回收站'), T('删除选中的 ') + papers.length + T(' 篇？可在提示条点「撤销」恢复，也可稍后在回收站找回。'), T('移入回收站'), true).then(function (ok) {
      if (ok) removePapers(papers.map(function (p) { return p.id; }));
    });
  }

  /** 仅供明确标为“从当前文件夹移出”的操作使用；删除文献始终进入回收站。 */
  function currentFolderLinkTarget() {
    if (state.activeFolderIds.length) return null;
    var folderId = currentImportFolderId();
    if (!folderId) return null;
    return state.folders.find(function (folder) { return folder.id === folderId; }) || null;
  }

  function removePapersFromFolder(papers, folder) {
    if (!folder) return 0;
    var linked = (papers || []).filter(function (paper) {
      return paper && !paper.deletedAt && (paper.folderIds || []).indexOf(folder.id) !== -1;
    });
    if (!linked.length) return 0;
    var ids = linked.map(function (paper) { return paper.id; });
    var undoBefore = makeSnapshot({ papers: ids });
    linked.forEach(function (paper) {
      paper.folderIds = (paper.folderIds || []).filter(function (id) { return id !== folder.id; });
      window.LitModel.touch(paper);
      delete state.selected[paper.id];
    });
    commitUndo(T('从文件夹「') + folder.name + T('」移出'), undoBefore, { papers: ids });
    if (drawerId && ids.indexOf(drawerId) !== -1) closeDrawer();
    save(); renderAll();
    toast(T('✓ 已从“') + folder.name + T('”移出 ') + linked.length + T(' 篇（文献与附件仍保留）'));
    return linked.length;
  }

  /** 恢复回收站条目 */
  function restorePapers(ids) {
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });
    var n = 0;
    var undoBefore = makeSnapshot({ papers: ids.slice() });
    state.papers.forEach(function (p) {
      if (idSet[p.id] && p.deletedAt) { p.deletedAt = null; p.updatedAt = Date.now(); n++; }
    });
    if (n) {
      commitUndo(T('恢复 ') + n + T(' 篇'), undoBefore, { papers: ids.slice() });
      save(); renderAll();
    }
    return n;
  }

  /** 彻底删除（不可恢复）：置永久墓碑（deletedAt 非空）并从视图层永久排除。
   *  墓碑随工作区持久化，坚果云同步通过既有墓碑机制把删除传播到其他设备；
   *  硬删（从 state.papers 移除）会导致同步合并时被远端旧版本复活。 */
  function purgePapers(ids) {
    var idSet = {};
    ids.forEach(function (id) { idSet[id] = true; });
    var now = Date.now();
    var purged = 0;
    state.papers.forEach(function (p) {
      if (!idSet[p.id]) return;
      p.deletedAt = now;
      p.updatedAt = now;
      state.hiddenPurged[p.id] = true;
      delete state.selected[p.id];
      if (window.LitPdfSearch) window.LitPdfSearch.invalidate(p.id);
      purged++;
    });
    // 附属笔记一并立墓碑（随同步传播删除）；paperId='' 的主题笔记不受影响
    state.notes.forEach(function (note) {
      if (note.paperId && idSet[note.paperId] && !note.deletedAt) {
        note.deletedAt = now;
        note.updatedAt = now;
      }
    });
    state.papers.forEach(function (p) {
      // 附属笔记已全部墓碑化，兼容投影同步清空（与 normalizeWorkspace 的重投影口径一致）
      if (idSet[p.id]) p.notes = '';
      p.relatedIds = (p.relatedIds || []).filter(function (rid) { return !idSet[rid]; });
    });
    if (purged) { saveHiddenPurged(); save(); closeDrawer(); renderAll(); }
    return purged;
  }

  // ---------- 存储 ----------
  function initWorkspaceStore() {
    if (!window.LitWorkspaceStore) return;
    workspaceStore = window.LitWorkspaceStore.create({
      state: state, model: window.LitModel, uid: uid, T: T, toast: toast,
      storeKey: STORE_KEY, localStorage: localStorage, desktop: function () { return desktop; },
      clearQueryCache: function () {
        if (window.LitQuery && window.LitQuery.clearHaystackCache) window.LitQuery.clearHaystackCache();
      },
      scheduleSync: scheduleNutstoreSync,
      resolveConflicts: resolveSaveConflicts,
      onLoad: function (ok, error) {
        libraryLoadFailed = !ok;
        if (ok && desktop) window.litboardSqliteReady = true;
        if (!ok) toast(T('⚠ 本地数据库读取失败：') + (error && error.message || error));
      }
    });
  }
  function workspacePayload() {
    return workspaceStore.payload();
  }

  function findLocalEntity(collection, id) {
    if (collection === 'tagColorRecords') {
      return state.tagColorRecords.find(function (x) { return x.tag === id; }) || null;
    }
    if (collection === 'papers') return getById(id);
    if (collection === 'notes') {
      return state.notes.find(function (x) { return x.id === id; }) || null;
    }
    if (collection === 'folders') {
      return state.folders.concat(state.folderTombstones).find(function (x) { return x.id === id; }) || null;
    }
    return state.savedSearches.concat(state.savedSearchTombstones).find(function (x) { return x.id === id; }) || null;
  }

  function replaceLocalEntity(collection, id, entity) {
    function replaceIn(list, keyOf) {
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (keyOf(list[i]) === id) { idx = i; break; } }
      if (idx === -1) return false;
      list[idx] = entity;
      return true;
    }
    if (collection === 'papers') {
      if (!replaceIn(state.papers, function (x) { return x.id; })) return true; // 本地已无该实体：保留库内版本
      var norm = window.LitModel.normalizePaper(entity, uid);
      norm.id = entity.id;
      state.papers[state.papers.indexOf(entity)] = norm;
    } else if (collection === 'notes') {
      if (!replaceIn(state.notes, function (x) { return x.id; })) state.notes.push(entity);
      var normNote = window.LitModel.normalizeNote(entity);
      normNote.id = entity.id;
      state.notes[state.notes.indexOf(entity)] = normNote;
    } else if (collection === 'folders') {
      if (!replaceIn(state.folders, function (x) { return x.id; }) &&
          !replaceIn(state.folderTombstones, function (x) { return x.id; })) {
        if (entity.deletedAt) state.folderTombstones.push(entity);
        else state.folders.push(entity);
      }
    } else if (collection === 'savedSearches') {
      if (!replaceIn(state.savedSearches, function (x) { return x.id; }) &&
          !replaceIn(state.savedSearchTombstones, function (x) { return x.id; })) {
        if (entity.deletedAt) state.savedSearchTombstones.push(entity);
        else state.savedSearches.push(entity);
      }
    } else if (collection === 'tagColorRecords') {
      replaceIn(state.tagColorRecords, function (x) { return x.tag; });
      if (window.LitModel.tagColorsFromRecords) {
        state.tagColors = window.LitModel.tagColorsFromRecords(state.tagColorRecords);
      }
    }
    return true;
  }

  function previewConflictValue(v) {
    if (v === undefined || v === null) return T('（删除）');
    var s = typeof v === 'string' ? v : JSON.stringify(v);
    return String(s).replace(/\s+/g, ' ').slice(0, 60);
  }

  /**
   * 处理保存冲突：对每个冲突实体做三方合并（base = 最近确认内容）；
   * 不重叠字段自动合并；同一标量字段/同 id 子项同时变化时逐项弹对话框让用户选择。
   * 全部解决后返回 true（调用方会以最新 base 重新提交）。用户取消返回 false。
   */
  function resolveSaveConflicts(conflicts, baseSnapshot) {
    if (!window.LitMerge || !conflicts || !conflicts.length) return Promise.resolve(true);
    var chain = Promise.resolve(true);
    conflicts.forEach(function (conflict) {
      chain = chain.then(function (proceed) {
        if (!proceed) return false;
        var local = findLocalEntity(conflict.collection, conflict.id);
        if (!local) return true; // 本地没有该实体：保留库内版本即可
        var base = baseSnapshot && baseSnapshot[conflict.collection] && baseSnapshot[conflict.collection][conflict.id] || null;
        var remote = conflict.entity || {};
        var spec = conflict.collection === 'papers' ? window.LitMerge.PAPER_SPEC : window.LitMerge.PLAIN_SPEC;
        var mergedResult = window.LitMerge.mergeEntity(base, local, remote, spec);
        var merged = mergedResult.merged;
        if (!mergedResult.conflicts.length) {
          replaceLocalEntity(conflict.collection, conflict.id, merged);
          return true;
        }
        var pending = Promise.resolve(true);
        mergedResult.conflicts.forEach(function (fieldConflict, index) {
          pending = pending.then(function (ok) {
            if (!ok) return false;
            return dlgPick(
              T('保存冲突（') + (index + 1) + '/' + mergedResult.conflicts.length + '）：' +
                (conflict.title || conflict.id),
              T('字段「') + fieldConflict.label + T('」在界面与浏览器扩展（或外部写入）中同时被修改。选择保留哪一个：'),
              [
                { id: 'local', label: T('本地修改：') + previewConflictValue(fieldConflict.local) },
                { id: 'remote', label: T('扩展修改：') + previewConflictValue(fieldConflict.remote) }
              ]
            ).then(function (choice) {
              if (choice == null) return false; // 用户取消：中止本次保存
              window.LitMerge.applyChoice(merged, fieldConflict, choice);
              return true;
            });
          });
        });
        return pending.then(function (ok) {
          if (!ok) return false;
          replaceLocalEntity(conflict.collection, conflict.id, merged);
          return true;
        });
      });
    });
    return chain;
  }

  function save(skipNutstoreSync) {
    return workspaceStore.save(skipNutstoreSync);
  }
  /** 等待全部已排队的本地保存落库；resolve 布尔 = 是否全部成功 */
  function waitForLocalSave() {
    if (saveNotes && saveNotes.flush) saveNotes.flush();
    if (pdfNotePanel) pdfNotePanel.flush();
    if (epubNotePanel) epubNotePanel.flush();
    return workspaceStore.waitForIdle();
  }
  function load() {
    return workspaceStore.load();
  }

  // ---------- 数据模型 ----------
  /* 笔记（v12）：Note 实体为权威，paper.notes 只是兼容投影。
   * 详情抽屉的 textarea 读写都走这里。 */
  function paperNote(paperId) {
    var found = null;
    state.notes.forEach(function (note) {
      if (note.deletedAt || note.paperId !== paperId) return;
      if (!found || note.createdAt < found.createdAt) found = note;
    });
    return found;
  }
  function paperNoteContent(p) {
    var note = paperNote(p.id);
    return note ? note.content : (p.notes || '');
  }
  function setPaperNoteContent(p, content) {
    var note = paperNote(p.id);
    if (note) {
      note.content = content;
      window.LitModel.touch(note);
    } else {
      state.notes.push(window.LitModel.normalizeNote({ paperId: p.id, content: content }));
    }
    // 维护内存中的兼容投影，让搜索/「有笔记」角标即时生效；持久层以 notes 集合为准
    p.notes = content;
  }

  /* ---- 多笔记支持 + 批注摘录（阶段三） ---- */
  function liveNotes() { return state.notes.filter(function (n) { return !n.deletedAt; }); }
  function notesForPaper(paperId) { return liveNotes().filter(function (n) { return n.paperId === paperId; }); }
  function topicNotes() { return liveNotes().filter(function (n) { return !n.paperId; }); }
  function findNote(id) { return liveNotes().find(function (n) { return n.id === id; }) || null; }
  function createNote(paperId, title) {
    var note = window.LitModel.normalizeNote({ paperId: paperId || '', title: title || '', content: '' });
    state.notes.push(note);
    return note;
  }
  function findAnnotationAnywhere(annotationId, paperId, attachmentId) {
    for (var i = 0; i < state.papers.length; i++) {
      var paper = state.papers[i];
      if (paperId && paper.id !== paperId) continue;
      var found = null;
      (paper.pdfAnnotations || []).forEach(function (a) {
        if (a.id === annotationId && (!attachmentId || a.attachmentId === attachmentId)) found = a;
      });
      if (found) return { paper: paper, annotation: found };
    }
    return null;
  }
  function annotationQuote(annotation) {
    if (annotation.type === 'snapshot') return annotation.text || T('[区域截图]');
    if (annotation.type === 'ink') return T('[手写笔迹]');
    return annotation.text || T('[无文字内容]');
  }
  function annotationToExcerptBlock(annotation, paper) {
    return window.LitExcerpt.buildExcerpt({
      paperId: paper.id, paperTitle: paper.title,
      attachmentId: annotation.attachmentId || '',
      annotationId: annotation.id,
      pageIndex: annotation.position.pageIndex,
      epubcfi: annotation.position.cfi || '',
      sourceUpdatedAt: annotation.updatedAt,
      quote: annotationQuote(annotation),
      comment: annotation.comment || ''
    });
  }
  /** 把一组批注以摘录块追加到笔记；返回写入条数。richtext 笔记用 HTML 摘录块（否则 sanitizeHtml 会剥掉 lbex 注释标记，出处丢失） */
  function addAnnotationsToNote(note, annotations, paper) {
    if (!note || !annotations || !annotations.length) return 0;
    var blocks;
    if (note.format === 'richtext' && window.LitNoteMl) {
      blocks = annotations.map(function (a) {
        return window.LitNoteMl.buildExcerptHtml({
          paperId: paper.id, paperTitle: paper.title,
          attachmentId: a.attachmentId || '',
          annotationId: a.id,
          pageIndex: a.position ? a.position.pageIndex : null,
          epubcfi: (a.position && a.position.cfi) || '',
          sourceUpdatedAt: a.updatedAt
        }, annotationQuote(a), a.comment || '', { plainText: true });
      });
    } else {
      blocks = annotations.map(function (a) { return annotationToExcerptBlock(a, paper); });
    }
    var base = (note.content || '').replace(/\s+$/, '');
    note.content = (base ? base + '\n\n' : '') + blocks.join('\n\n') + '\n';
    window.LitModel.touch(note);
    save();
    return annotations.length;
  }

  function newPaper(base) {
    var paper = window.LitModel.normalizePaper(Object.assign({
      id: uid(),
      key: '', entryType: 'article',
      title: '', authors: [], year: null, venue: '',
      doi: '', url: '', abstract: '',
      citations: null, citationSource: '', citationUpdatedAt: '', oaUrl: '', openalexId: '',
      tags: [], folderIds: [], status: 'unread', rating: 0, notes: '', pdfAnnotations: [],
      addedAt: Date.now()
    }, base || {}), uid);
    var merged = window.LitDedupe.mergeAttachmentsDetailed({ attachments: paper.attachments }, null);
    if (merged.attachments.length === paper.attachments.length) return paper;
    paper.attachments = merged.attachments;
    paper.pdfAnnotations = remapAnnotationAttachments(paper.pdfAnnotations, merged.aliases).annotations;
    var normalized = window.LitModel.normalizePaper(paper, uid);
    normalized.id = paper.id;
    return normalized;
  }

  function remapAnnotationAttachments(annotations, aliases) {
    var changed = false;
    var result = (annotations || []).map(function (annotation) {
      var canonicalId = annotation && aliases[annotation.attachmentId];
      if (!canonicalId || canonicalId === annotation.attachmentId) return annotation;
      changed = true;
      return Object.assign({}, annotation, { attachmentId: canonicalId });
    });
    return { annotations: result, changed: changed };
  }

  /** 去重导入；命中已有条目时 PDF 走 attachments 挂到原条目（Zotero 式）；返回 {added, merged, attached, matches} */
  function addPapers(list, options) {
    var folderId = options && options.folderId || '';
    if (!state.folders.some(function (folder) { return folder.id === folderId; })) folderId = '';
    list = window.LitModel.normalizeLibrary(list, uid);
    var initialCount = state.papers.length;
    // 整库一次建索引 O(n)，之后每条导入 O(1) 匹配
    var index = window.LitDedupe.createMatchIndex(state.papers);
    var added = 0, merged = 0, attached = 0, matches = [];
    var removedAttachmentIndexes = [];
    var addedIds = [];   // M9 二期：新建条目的 id（收藏桥回写 researchIds 用）
    var indexMap = [];   // 与输入 list 逐一对齐：{ kind: 'added'|'merged', id }（收藏桥回写 researchIds 用）
    list.forEach(function (base) {
      var hit = window.LitDedupe.findMatch(index, base);
      var existing = hit ? hit.paper : null;
      if (existing) {
        // 挂附件：incoming 的 PDF 并入原条目（指纹>路径>id 判重；原无主 PDF 时置首成为主 PDF）
        var beforeAttachments = existing.attachments || [];
        var attachmentMerge = window.LitDedupe.mergeAttachmentsDetailed(existing, base);
        var mergedAttachments = attachmentMerge.attachments;
        var attachmentsChanged = mergedAttachments.length !== beforeAttachments.length ||
          mergedAttachments.some(function (attachment, index) { return attachment !== beforeAttachments[index]; });
        var attachedNow = attachmentMerge.added.length > 0;
        var changed = false;
        matches.push({ id: existing.id, title: existing.title, folderIds: (existing.folderIds || []).slice(), reason: hit.reason, attachedPdf: attachedNow });
        // 只补空字段，不覆盖用户已有内容；pdf* 旧字段不直写，交给 normalizePaper 从主附件重投影
        ['abstract', 'doi', 'url', 'venue', 'volume', 'issue', 'pages', 'issn',
          'oaUrl', 'openalexId', 'key'].forEach(function (f) {
          if (!existing[f] && base[f]) { existing[f] = base[f]; changed = true; }
        });
        if (existing.year == null && base.year != null) { existing.year = base.year; changed = true; }
        if (existing.citations == null && base.citations != null) { existing.citations = base.citations; changed = true; }
        if ((!existing.authors || !existing.authors.length) && base.authors && base.authors.length) { existing.authors = base.authors; changed = true; }
        if (base.pdfAnnotations && base.pdfAnnotations.length) {
          existing.pdfAnnotations = remapAnnotationAttachments(
            window.LitDedupe.merge([existing, base]).pdfAnnotations, attachmentMerge.aliases
          ).annotations;
          changed = true;
        } else {
          var remappedAnnotations = remapAnnotationAttachments(existing.pdfAnnotations, attachmentMerge.aliases);
          if (remappedAnnotations.changed) {
            existing.pdfAnnotations = remappedAnnotations.annotations;
            changed = true;
          }
        }
        // 归属并集：options.folderId（传统单文件夹导入）+ base 自带 folderIds
        //（拖入文件夹导入按目录逐条预盖，让整棵树一次 addPapers/一次 save 落库）
        var incomingFolders = folderId ? [folderId] : [];
        (base.folderIds || []).forEach(function (fid) {
          if (fid && incomingFolders.indexOf(fid) === -1) incomingFolders.push(fid);
        });
        incomingFolders.forEach(function (fid) {
          if ((existing.folderIds || []).indexOf(fid) === -1) { existing.folderIds.push(fid); changed = true; }
        });
        if (attachmentsChanged) {
          existing.attachments = mergedAttachments;
          changed = true;
        }
        Object.keys(attachmentMerge.aliases).forEach(function (removedId) {
          var canonicalId = attachmentMerge.aliases[removedId];
          if (removedId && canonicalId && removedId !== canonicalId) {
            removedAttachmentIndexes.push({ paperId: existing.id, attachmentId: removedId });
          }
        });
        if (changed) {
          window.LitModel.touch(existing);
          var norm = window.LitModel.normalizePaper(existing, uid);
          norm.id = existing.id;
          state.papers[state.papers.indexOf(existing)] = norm;
          existing = norm;
        }
        if (attachedNow) attached++;
        window.LitDedupe.indexPaper(index, existing); // 补登记新获得的指纹/DOI
        merged++;
        indexMap.push({ kind: 'merged', id: existing.id });
      } else {
        var p = newPaper(base);
        if (folderId && p.folderIds.indexOf(folderId) === -1) p.folderIds.push(folderId);
        state.papers.push(p);
        window.LitDedupe.indexPaper(index, p);
        addedIds.push(p.id);
        added++;
        indexMap.push({ kind: 'added', id: p.id });
      }
    });
    added = Math.max(0, state.papers.length - initialCount);
    merged = Math.max(0, list.length - added);
    save();
    if (window.LitPdfSearch && LitPdfSearch.invalidate) {
      removedAttachmentIndexes.forEach(function (item) {
        LitPdfSearch.invalidate(item.paperId, item.attachmentId);
      });
    }
    return { added: added, merged: merged, attached: attached, matches: matches, addedIds: addedIds, indexMap: indexMap };
  }

  function getById(id) {
    for (var i = 0; i < state.papers.length; i++) {
      if (state.papers[i].id === id) return state.papers[i];
    }
    return null;
  }

  /* ---- 会话级撤销/重做（阶段四尾巴） ----
   * 快照对（before/after）入栈；Undo 恢复 before、Redo 恢复 after；创建型操作以 __absent
   * 标记支持「撤销创建 = 删除」。覆盖：字段编辑、标签、文件夹移动/排序、软删除与恢复、
   * 批注新建/删除/标签。不覆盖：彻底删除（purge）、外部文件覆盖（PDF 写回/重命名）、远端同步写入。 */
  var history = null;
  function initHistory() {
    if (!window.LitHistory) return;
    history = window.LitHistory.create({
      state: state, payload: workspacePayload, normalizeWorkspace: window.LitModel.normalizeWorkspace, limit: 100
    });
  }
  function makeSnapshot(ids) {
    return history.snapshot(ids);
  }
  function commitUndo(label, before, ids) {
    history.commit(label, before, ids);
    updateUndoUi();
  }
  function undoOnce() {
    var result = history && history.undo();
    if (!result) return;
    save(); renderAll();
    if (drawerId && getById(drawerId)) openDrawer(drawerId);
    updateUndoUi();
    toast(T('↩ 已撤销：') + result.label);
  }
  function redoOnce() {
    var result = history && history.redo();
    if (!result) return;
    save(); renderAll();
    if (drawerId && getById(drawerId)) openDrawer(drawerId);
    updateUndoUi();
    toast(T('↪ 已重做：') + result.label);
  }
  function updateUndoUi() {
    if (!history) return;
    var status = history.status();
    var undo = $('#btn-undo'), redo = $('#btn-redo');
    if (undo) {
      undo.disabled = !status.undoLabel;
      undo.title = status.undoLabel ? T('撤销：') + status.undoLabel + '（Ctrl+Z）' : T('撤销（Ctrl+Z）');
    }
    if (redo) {
      redo.disabled = !status.redoLabel;
      redo.title = status.redoLabel ? T('重做：') + status.redoLabel + '（Ctrl+Y）' : T('重做（Ctrl+Y）');
    }
  }
  // ---------- 筛选 & 排序 ----------
  var querySyntaxError = false;
  var plainSearchMatches = {};   // paperId → LitQuery.rankPlainText()，供相关度排序与命中说明
  var searchSortOverride = false; // 用户点表头后，当前查询尊重显式列排序
  /* 排序用 collator 实例复用：localeCompare 每次调用都重解析 locale，万级文献排序时差一个数量级 */
  var SORT_COLLATOR = null;

  function filteredPapers() {
    var f = state.filters;
    var inTrash = state.activeFolderId === 'trash';
    var isRecent = state.activeFolderId === 'recent';
    var q = window.LitQuery ? window.LitQuery.normalizeForSearch(f.q) : f.q.toLowerCase();
    var plainSearch = !!(f.q && !state.ftEnabled && window.LitQuery && window.LitQuery.isPlainText(f.q) && window.LitQuery.rankPlainText);
    var queryContext = null;
    if (q && !state.ftEnabled && window.LitQuery) {
      var notesByPaper = {};
      (state.notes || []).forEach(function (note) {
        if (!note || note.deletedAt || !note.paperId) return;
        (notesByPaper[note.paperId] = notesByPaper[note.paperId] || []).push(note);
      });
      queryContext = { notes: state.notes, folders: state.folders, notesByPaper: notesByPaper };
    }
    plainSearchMatches = {};
    var parsed = null;
    querySyntaxError = false;
    if (f.q && !state.ftEnabled && window.LitQuery && !plainSearch) {
      parsed = window.LitQuery.parse(f.q, queryContext);
      if (parsed.error) { parsed = null; querySyntaxError = true; }
    }
    // 阶段四：多选文件夹的后代集合（一次计算）
    var multiFolderSets = {};
    state.activeFolderIds.forEach(function (fid) { multiFolderSets[fid] = folderDescendantSet(fid); });
    var out = state.papers.concat(folderImportPreviewPapers).filter(function (p) {
      if (state.hiddenPurged[p.id]) return false; // 彻底删除的永久墓碑：任何视图（含回收站）都不显示
      if (inTrash ? !p.deletedAt : p.deletedAt) return false; // 回收站视图只看墓碑，其余视图排除
      if (isRecent && !p.lastReadAt) return false;
      if (state.activeFolderId === 'unfiled' && (p.folderIds || []).length) return false;
      if (!inTrash && !isRecent && state.activeFolderId !== 'all' && state.activeFolderId !== 'unfiled' &&
          (p.folderIds || []).indexOf(state.activeFolderId) === -1) return false;
      // 阶段四：多文件夹联合（任一命中，含子文件夹）
      if (!inTrash && state.activeFolderIds.length) {
        var inAny = state.activeFolderIds.some(function (fid) {
          var set = multiFolderSets[fid];
          return (p.folderIds || []).some(function (id) { return set[id]; });
        });
        if (!inAny) return false;
      }
      if (f.status && p.status !== f.status) return false;
      if (f.tag && (p.tags || []).indexOf(f.tag) === -1) return false;
      if (f.year != null && p.year !== f.year) return false;
      if (f.pdfOnly && !(p.pdfPath || p.pdfFileName || p.pdfCloudName || p.zoteroAttachmentKey)) return false;
      if (f.bibkeys && f.bibkeys.length && f.bibkeys.indexOf(String(p.key || '').toLowerCase()) === -1) return false;
      if (q) {
        if (state.ftEnabled) {
          if (!state.ftHits[p.id]) return false;
        } else if (plainSearch) {
          var ranked = window.LitQuery.rankPlainText(p, f.q, queryContext);
          if (!ranked.matched) return false;
          plainSearchMatches[p.id] = ranked;
        } else if (parsed) {
          if (!parsed.matcher(p)) return false;
        } else {
          var hay = window.LitQuery ? window.LitQuery.normalizeForSearch(
            [p.key, p.title, (p.authors || []).join(' '), p.venue, p.abstract, p.notes, (p.tags || []).join(' ')].join(' '))
            : [p.key, p.title, (p.authors || []).join(' '), p.venue, p.abstract, p.notes, (p.tags || []).join(' ')].join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
      }
      return true;
    });
    var key = state.sort.key, dir = state.sort.dir;
    var STATUS_ORDER = { unread: 0, reading: 1 };
    var sortCollator = SORT_COLLATOR || (SORT_COLLATOR = new Intl.Collator());
    var compareCurrentSort = function (a, b) {
      var va, vb;
      if (key === 'firstAuthor') { va = (a.authors || [])[0] || ''; vb = (b.authors || [])[0] || ''; }
      else if (key === 'status') { va = STATUS_ORDER[a.status] || 0; vb = STATUS_ORDER[b.status] || 0; }
      else if (key === 'tags') { va = (a.tags || []).join(', '); vb = (b.tags || []).join(', '); }
      else if (key === 'journalRank') { va = journalRankQuality(a); vb = journalRankQuality(b); }
      else { va = a[key]; vb = b[key]; }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // 空值恒沉底
      if (vb == null) return -1;
      if (typeof va === 'string') return sortCollator.compare(va, vb) * dir;
      return (va - vb) * dir;
    };
    if (!searchSortOverride && state.ftEnabled && q) {
      out.sort(function (a, b) {
        var score = ((state.ftHits[b.id] && state.ftHits[b.id].count) || 0) -
          ((state.ftHits[a.id] && state.ftHits[a.id].count) || 0);
        return score || compareCurrentSort(a, b);
      });
    } else if (!searchSortOverride && plainSearch) {
      out.sort(function (a, b) {
        var score = ((plainSearchMatches[b.id] && plainSearchMatches[b.id].score) || 0) -
          ((plainSearchMatches[a.id] && plainSearchMatches[a.id].score) || 0);
        return score || compareCurrentSort(a, b);
      });
    } else {
      out.sort(compareCurrentSort);
    }
    // 最近阅读视图：按最后阅读时间倒序
    if (isRecent) {
      out.sort(function (a, b) { return (b.lastReadAt || 0) - (a.lastReadAt || 0); });
    }
    return out;
  }

  /** 阶段四：文件夹后代 id 集合（含自身，递归子文件夹）；先一次建父→子索引再走子树，
   *  避免每次递归内部再全量扫 state.folders 的 O(文件夹²) 行为 */
  function folderDescendantSet(folderId) {
    var childrenOf = {};
    state.folders.forEach(function (f) {
      var pid = f.parentId || '';
      (childrenOf[pid] = childrenOf[pid] || []).push(f.id);
    });
    var set = {};
    var walk = function (id) {
      if (set[id]) return;
      set[id] = true;
      (childrenOf[id] || []).forEach(walk);
    };
    walk(folderId);
    return set;
  }

  function hasActiveFilters() {
    var f = state.filters;
    return !!(f.q || f.status || f.tag || f.year != null || f.pdfOnly || (f.bibkeys && f.bibkeys.length) || state.ftEnabled);
  }

  function clearFilters() {
    state.filters = { q: '', status: '', tag: '', year: null, pdfOnly: false, bibkeys: [] };
    state.tablePage = 0;
    $('#search').value = '';
    searchSortOverride = false;
    $all('#status-seg .seg-btn').forEach(function (x) { x.classList.toggle('active', !x.dataset.status); });
  }

  function togglePdfAttachmentSearch() {
    var enable = !state.filters.pdfOnly;
    clearFilters();
    resetActiveFolder();
    state.filters.pdfOnly = enable;
    renderAll();
    toast(enable ? T('仅显示有 PDF 附件的条目') : T('已取消 PDF 附件检索'));
  }

  // ---------- PDF 全文检索（跨库，桌面版） ----------
  var ftSearchToken = 0;
  var runFtSearch = debounce(function () { performFullTextSearch(); }, 350);

  function toggleFullTextSearch() {
    if (!desktop) { toast(T('PDF 全文检索需要桌面版')); return; }
    state.ftEnabled = !state.ftEnabled;
    $('#btn-ft').classList.toggle('active', state.ftEnabled);
    if (!state.ftEnabled) {
      ftSearchToken++;
      state.ftHits = {};
      var statusEl = $('#ft-status');
      statusEl.hidden = true;
      statusEl.textContent = '';
      renderAll();
      toast(T('已关闭 PDF 全文检索'));
      return;
    }
    toast(T('PDF 全文检索已开启：在搜索框输入关键词后检索 PDF 正文'));
    if ($('#search').value.trim()) performFullTextSearch();
    else renderAll();
  }

  function performFullTextSearch() {
    var query = $('#search').value.trim();
    var token = ++ftSearchToken;
    if (!state.ftEnabled || !query) {
      state.ftHits = {};
      $('#ft-status').hidden = true;
      renderAll();
      return;
    }
    if (!window.LitPdfSearch) return;
    var candidates = state.papers.filter(function (p) {
      return !p.deletedAt && ((p.attachments || []).some(function (attachment) {
        return (attachment.kind === 'pdf' || attachment.kind === 'epub') && attachment.path;
      }) || !!p.pdfPath);
    });
    var statusEl = $('#ft-status');
    statusEl.hidden = false;
    statusEl.textContent = candidates.length
      ? T('全文检索中…（') + candidates.length + T(' 篇，首次较慢）')
      : T('库内没有带本地全文文件（PDF/EPUB）的文献');
    window.LitPdfSearch.search(query, candidates, function (progress) {
      if (token !== ftSearchToken) return;
      statusEl.textContent = T('全文检索中 ') + progress.done + '/' + progress.total + '…';
    }).then(function (hits) {
      if (token !== ftSearchToken) return;
      var hitsById = {};
      var totalMatches = 0;
      hits.forEach(function (hit) {
        var current = hitsById[hit.paper.id];
        if (!current) current = hitsById[hit.paper.id] = { paper: hit.paper, pages: [], count: 0, attachmentId: hit.attachmentId || '', attachments: [] };
        current.attachments.push(hit);
        if (!current.pages.length) { current.pages = hit.pages; current.attachmentId = hit.attachmentId || ''; }
        current.count += hit.count;
        totalMatches += hit.count;
      });
      state.ftHits = hitsById;
      state.tablePage = 0;
      var matchedPapers = Object.keys(hitsById).length;
      statusEl.textContent = matchedPapers
        ? T('命中 ') + matchedPapers + T(' 篇 · ') + totalMatches + T(' 个命中页') +
          (hits.some(function (hit) { return hit.truncated; }) ? T('（只显示前 2000 个命中页，请缩小关键词）') : '')
        : T('全文中未找到「') + query + '」';
      renderAll();
    }).catch(function () {
      if (token !== ftSearchToken) return;
      statusEl.textContent = T('全文检索失败');
    });
  }

  function openFullTextHit(paper, hit) {
    var query = state.filters.q;
    if (query) $('#pdf-search').value = query;
    if (hit && hit.attachmentId) {
      var hitAtt = (paper.attachments || []).filter(function (a) { return a && a.id === hit.attachmentId; })[0];
      if (hitAtt && hitAtt.kind === 'epub') {
        // EPUB 命中：页 = spine 章节序号（0 基），epub.js display 直接接受序号定位
        openEpubViewer(paper, hitAtt.id, (hit.pages && hit.pages[0]) || 0);
        return;
      }
      openPdfAt({ paperId: paper.id, attachmentId: hit.attachmentId, page: (hit.pages && hit.pages[0] || 0) + 1 });
    } else openPdfViewer(paper);
  }

  function openBibkeySearch() {
    $('#bibkey-search-mask').hidden = false;
    $('#bibkey-search-status').textContent = '';
    // 列出库内已有 bibkey 供自动补全（多选场景用户可能记不全拼写）
    var suggestions = [];
    state.papers.forEach(function (paper) {
      var key = String(paper.key || '').trim();
      if (key && suggestions.indexOf(key) === -1) suggestions.push(key);
    });
    suggestions.sort();
    $('#bibkey-suggest').innerHTML = suggestions.map(function (key) {
      return '<option value="' + key.replace(/"/g, '&quot;') + '"></option>';
    }).join('');
    $('#bibkey-search-input').focus();
    $('#bibkey-search-input').select();
  }

  function searchByBibkeys() {
    var keys = $('#bibkey-search-input').value.split(/[,，\s]+/).map(function (key) {
      return key.trim().toLowerCase();
    }).filter(Boolean);
    var unique = [];
    keys.forEach(function (key) { if (unique.indexOf(key) === -1) unique.push(key); });
    if (!unique.length) { $('#bibkey-search-status').textContent = T('请输入至少一个 bibkey'); return; }
    var available = {};
    state.papers.forEach(function (paper) { available[String(paper.key || '').toLowerCase()] = true; });
    var missing = unique.filter(function (key) { return !available[key]; });
    clearFilters();
    resetActiveFolder();
    state.filters.bibkeys = unique;
    $('#bibkey-search-mask').hidden = true;
    renderAll();
    var found = unique.length - missing.length;
    if (found) {
      toast(T('找到 ') + found + T(' 篇') + (missing.length ? T('；未找到：') + missing.join(', ') : ''));
    } else {
      toast(T('未找到任何匹配的 bibkey：') + unique.join(', '), 6000);
    }
  }

  // ---------- 渲染 ----------
  function renderAll() {
    renderFolders();
    renderStats();
    renderChart();
    renderTagChips();
    renderTable();
    renderBulkBar();
    if (drawerId) renderFolderAssignments(getById(drawerId));
    $('#btn-clear-filters').hidden = !hasActiveFilters();
    refreshAgentChips(); // R19：焦点/文件夹变了，AI 面板上下文 chips 跟着刷
  }

  /* 侧栏计数单遍缓存：头部四项 + 每文件夹计数。
   * 签名 = 各集合长度 + 最大 updatedAt/lastReadAt + purge 键数：内容性修改一律经
   * touch/touchWorkspaceChanges 抬 updatedAt，阅读进度只动 lastReadAt，彻底删除改
   * hiddenPurged 键数——签名不变则计数必然不变，renderAll 因此从 O(文件夹×文献)
   * 的逐文件夹全量扫描降为一次 O(文献) 遍历且跨渲染复用。 */
  var sidebarCountsCache = { sig: '', data: null };
  function sidebarCounts() {
    var visiblePapers = state.papers.concat(folderImportPreviewPapers);
    var maxUp = 0, maxRead = 0;
    for (var i = 0; i < visiblePapers.length; i++) {
      var p = visiblePapers[i];
      if (p.updatedAt > maxUp) maxUp = p.updatedAt;
      if (p.lastReadAt > maxRead) maxRead = p.lastReadAt;
    }
    var maxNote = 0;
    for (var j = 0; j < state.notes.length; j++) { if (state.notes[j].updatedAt > maxNote) maxNote = state.notes[j].updatedAt; }
    var maxFolder = 0;
    for (var k = 0; k < state.folders.length; k++) { if (state.folders[k].updatedAt > maxFolder) maxFolder = state.folders[k].updatedAt; }
    var sig = [visiblePapers.length, maxUp, maxRead, state.notes.length, maxNote,
      state.folders.length, maxFolder, Object.keys(state.hiddenPurged).length].join('|');
    if (sidebarCountsCache.sig === sig && sidebarCountsCache.data) return sidebarCountsCache.data;
    var byFolder = {}, all = 0, unfiled = 0, recent = 0, trash = 0;
    visiblePapers.forEach(function (paper) {
      if (paper.deletedAt) { if (!state.hiddenPurged[paper.id]) trash++; return; }
      all++;
      var fids = paper.folderIds || [];
      if (!fids.length) unfiled++;
      if (paper.lastReadAt) recent++;
      for (var m = 0; m < fids.length; m++) byFolder[fids[m]] = (byFolder[fids[m]] || 0) + 1;
    });
    sidebarCountsCache = { sig: sig, data: { byFolder: byFolder, all: all, unfiled: unfiled, recent: recent, trash: trash } };
    return sidebarCountsCache.data;
  }

  function folderPaperCount(folderId) {
    return sidebarCounts().byFolder[folderId] || 0;
  }

  function compareFolders(a, b) {
    return window.LitFolderTree.compareFolders(a, b);
  }

  function folderTree(includeCollapsed) {
    // 纯逻辑（排序/折叠/防环修复）在 js/foldertree.js，单一权威避免两处漂移
    return window.LitFolderTree.buildVisibleRows(state.folders, includeCollapsed ? null : state.collapsedFolders);
  }

  function folderChildren(folderId) {
    return state.folders
      .filter(function (folder) { return folder.parentId === folderId; })
      .sort(compareFolders);
  }

  function isFolderDescendant(ancestorId, folderId) {
    var byId = {};
    state.folders.forEach(function (folder) { byId[folder.id] = folder; });
    var current = byId[folderId], guard = 0;
    while (current && guard++ < state.folders.length + 1) {
      if (current.id === ancestorId) return true;
      current = current.parentId ? byId[current.parentId] : null;
    }
    return false;
  }

  /** 拖动排序统一走 window.LitFolderTree.applyMove（js/foldertree.js），此处不再留第二份实现 */

  function clearFolderDropMarks(keep) {
    $all('#folder-list .folder-item').forEach(function (row) {
      if (row !== keep) row.classList.remove('drag-before', 'drag-after', 'drag-over');
    });
  }

  /**
   * 拖动排序的实时预览：按插入位给每行写 translateY，被拖行移到缺口、
   * 中间行让位（过渡动画由 #folder-list.folder-reordering 下的 CSS 承担）。
   * k 语义 = 被拖行在「剔除自身后的序列」中的插入下标。
   */
  function previewFolderOrder(targetRow, mode, dragId) {
    var list = $('#folder-list');
    if (!list || !dragId) return;
    var rows = $all('#folder-list .folder-item[data-folder]');
    var d = rows.findIndex(function (row) { return row.dataset.folder === dragId; });
    var t = rows.indexOf(targetRow);
    if (d === -1 || t === -1) return;
    var gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    var unit = rows[d].getBoundingClientRect().height + gap;
    if (!(unit > 0)) return;
    var p = t < d ? t : t - 1;              // 目标行在剔除被拖行后的下标
    var k = mode === 'after' ? p + 1 : p;   // 插入位
    rows.forEach(function (row, i) {
      var shift;
      if (i === d) {
        shift = k - d;
      } else {
        var q = i < d ? i : i - 1;          // 该行在剔除序列中的下标
        shift = (q >= k ? 1 : 0) - (q >= d ? 1 : 0);
      }
      var px = shift * unit;
      var value = px ? 'translateY(' + px + 'px)' : '';
      if (row.style.transform !== value) row.style.transform = value;
    });
  }

  /** 清除预览位移（保留过渡类时行会滑回原位） */
  function resetFolderOrderPreview() {
    $all('#folder-list .folder-item').forEach(function (row) { row.style.transform = ''; });
  }

  function toggleFolder(folderId) {
    if (state.collapsedFolders[folderId]) delete state.collapsedFolders[folderId];
    else state.collapsedFolders[folderId] = true;
    saveCollapsedFolders();
    renderFolders();
  }

  function folderPath(folder) {
    var byId = {}, parts = [], current = folder, guard = 0;
    state.folders.forEach(function (item) { byId[item.id] = item; });
    while (current && guard++ < state.folders.length + 1) {
      parts.unshift(current.name);
      current = current.parentId ? byId[current.parentId] : null;
    }
    return parts.join(' / ');
  }

  function selectFolder(folderId, options) {
    var multi = options && options.multi;
    var range = options && options.range;
    if (range) {
      // Shift 区间：锚点 = 最近一次普通/Ctrl 点击（不随区间点击移动），
      // 区间取自当前可见行顺序（折叠节点不展开）；保持多选联合筛选语义
      var anchor = state.folderSelAnchor || state.activeFolderId;
      var visibleIds = folderTree().map(function (entry) { return entry.folder.id; });
      var span = window.LitFolderTree.rangeIds(visibleIds, anchor, folderId);
      if (!span.length) span = [folderId];
      if (span.length) {
        var previous = state.activeFolderIds.length ? state.activeFolderIds : [state.activeFolderId];
        state.activeFolderIds = multi ? previous.concat(span).filter(function (id, index, ids) {
          return visibleIds.indexOf(id) !== -1 && ids.indexOf(id) === index;
        }) : span;
        state.activeFolderId = state.activeFolderIds[0];
      }
    } else if (multi) {
      // 阶段四：Ctrl+点击加入/移出多选集合（联合筛选，含子文件夹）
      if (!state.activeFolderIds.length && state.folders.some(function (f) { return f.id === state.activeFolderId; })) {
        state.activeFolderIds = [state.activeFolderId];
      }
      var idx = state.activeFolderIds.indexOf(folderId);
      if (idx === -1) state.activeFolderIds.push(folderId);
      else state.activeFolderIds.splice(idx, 1);
      state.activeFolderId = state.activeFolderIds.length ? state.activeFolderIds[0] : 'all';
      state.folderSelAnchor = folderId;
    } else {
      state.activeFolderId = folderId;
      state.activeFolderIds = [];
      state.folderSelAnchor = folderId;
    }
    if (state.folders.some(function (f) { return f.id === folderId; })) state.folderFocusId = folderId;
    state.focusId = null;
    // 阶段四：切换文件夹保留筛选条件（不再清搜索框）
    state.selected = {};
    state.selAnchor = null;
    state.tablePage = 0;
    journalRankClearFrozen();          // 切换视图即取消冻结（新列表按新排序渲染）
    renderAll();
    refreshFolderJournalRanks(folderId);
    reportCurrentFolder();            // 同步给浏览器扩展（右键保存落点）
  }

  function reportCurrentFolder() {
    if (!desktop || !desktop.bridgeSetCurrentFolder) return;
    var folderId = currentImportFolderId();
    desktop.bridgeSetCurrentFolder(folderId);
  }

  /** activeFolderId 的直接重置点统一走这里，保持扩展侧「当前文件夹」同步 */
  function resetActiveFolder() {
    state.activeFolderId = 'all';
    reportCurrentFolder();
  }

  function renderFolders() {
    var counts = sidebarCounts();
    $('#library-count-all').textContent = counts.all;
    $('#library-count-unfiled').textContent = counts.unfiled;
    $('#library-count-recent').textContent = counts.recent;
    $('#library-count-trash').textContent = counts.trash;
    $all('#library-nav [data-folder]').forEach(function (item) {
      item.classList.toggle('active', item.dataset.folder === state.activeFolderId);
    });
    var childCountByParent = {};
    state.folders.forEach(function (folder) {
      var pid = folder.parentId || '';
      childCountByParent[pid] = (childCountByParent[pid] || 0) + 1;
    });
    var list = $('#folder-list');
    // 键盘导航：重建会丢掉 DOM 焦点，重建前记下、重建后还给聚焦行
    var hadFocus = document.activeElement === list || list.contains(document.activeElement);
    list.innerHTML = '';
    folderTree().forEach(function (entry) {
      var folder = entry.folder;
      var row = document.createElement('div');
      row.className = 'folder-item' + (state.activeFolderId === folder.id ? ' active' : '');
      if (state.activeFolderIds.indexOf(folder.id) !== -1) row.classList.add('multi-active');
      row.dataset.folder = folder.id;
      row.draggable = true;
      row.tabIndex = -1;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(entry.depth + 1));
      row.setAttribute('aria-selected', String(state.activeFolderId === folder.id || state.activeFolderIds.indexOf(folder.id) !== -1));
      row.setAttribute('aria-expanded', entry.hasChildren ? String(!state.collapsedFolders[folder.id]) : 'false');
      row.style.setProperty('--folder-depth', entry.depth);
      row.classList.toggle('nested', entry.depth > 0);
      row.classList.toggle('collapsed', !!state.collapsedFolders[folder.id]);
      if (state.folderFocusId === folder.id) row.classList.add('focused');
      var select = document.createElement('button');
      select.className = 'folder-select';
      select.dataset.folder = folder.id;
      select.title = folder.name;
      var main = document.createElement('span');
      main.className = 'folder-item-main';
      var childCount = childCountByParent[folder.id] || 0;
      var toggle = document.createElement('button');
      toggle.className = 'folder-toggle' + (childCount ? '' : ' empty');
      toggle.dataset.toggleFolder = folder.id;
      toggle.disabled = !childCount;
      toggle.setAttribute('aria-label', childCount ? (state.collapsedFolders[folder.id] ? T('展开') : T('收起')) + ' ' + folder.name : T('无子文件夹'));
      toggle.setAttribute('aria-expanded', String(!state.collapsedFolders[folder.id]));
      toggle.textContent = '›';
      var glyph = document.createElement('span');
      glyph.className = 'folder-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = svgUse('lb-i-folder');
      var label = document.createElement('span');
      label.className = 'folder-item-label';
      label.textContent = folder.name;
      var count = document.createElement('span');
      count.className = 'library-count';
      count.textContent = counts.byFolder[folder.id] || 0;
      main.appendChild(glyph);
      main.appendChild(label);
      select.appendChild(main);
      select.appendChild(count);
      var del = document.createElement('button');
      del.className = 'folder-delete';
      del.dataset.deleteFolder = folder.id;
      del.title = T('删除文件夹');
      del.setAttribute('aria-label', T('删除文件夹 ') + folder.name);
      del.textContent = '×';
      var add = document.createElement('button');
      add.className = 'folder-add-child';
      add.dataset.parentFolder = folder.id;
      add.title = T('新建子文件夹');
      add.setAttribute('aria-label', T('在 ') + folder.name + T(' 下新建文件夹'));
      add.textContent = '+';
      var actions = document.createElement('span');
      actions.className = 'folder-actions';
      actions.appendChild(add);
      actions.appendChild(del);
      row.appendChild(toggle);
      row.appendChild(select);
      row.appendChild(actions);
      list.appendChild(row);
    });
    $('#folder-empty').hidden = state.folders.length > 0;
    if (hadFocus) {
      var focusedRow = list.querySelector('.folder-item.focused') ||
        (state.folderFocusId ? list.querySelector('.folder-item[data-folder="' + state.folderFocusId + '"]') : null);
      if (focusedRow) focusedRow.focus({ preventScroll: true });
      else list.focus({ preventScroll: true });
    }
  }

  /** 与 Zotero 一致：删除整个集合子树，文献、附件及笔记保留。 */
  function deleteFolder(folderId) {
    return deleteFolders([folderId]);
  }

  function deleteFolders(folderIds) {
    var selected = state.folders.filter(function (folder) { return folderIds.indexOf(folder.id) !== -1; });
    if (!selected.length) return;
    var targetSet = window.LitFolderTree.collectSubtreeIds(state.folders, selected.map(function (f) { return f.id; }));
    var targets = state.folders.filter(function (folder) { return targetSet[folder.id]; });
    var names = selected.map(function (f) { return '「' + f.name + '」'; }).join('、');
    var childTotal = targets.length - selected.length;
    return dlgConfirm(T('删除 ') + targets.length + T(' 个文件夹'),
      T('删除文件夹 ') + names + T('？文献本身不会被删除。') +
        (childTotal ? T('共 ') + childTotal + T(' 个子文件夹将一并删除。') : ''),
      T('删除'), true).then(function (ok) {
      if (!ok) return;
      var affectedPaperIds = state.papers
        .filter(function (p) { return (p.folderIds || []).some(function (fid) { return targetSet[fid]; }); })
        .map(function (p) { return p.id; });
      var undoIds = targets.map(function (folder) { return folder.id; });
      var undoBefore = makeSnapshot({ folders: undoIds, papers: affectedPaperIds });
      var deletedAt = Date.now();
      state.folders = state.folders.filter(function (folder) { return !targetSet[folder.id]; });
      state.folderTombstones = state.folderTombstones.filter(function (folder) { return !targetSet[folder.id]; });
      targets.forEach(function (folder) {
        state.folderTombstones.push(Object.assign({}, folder, { deletedAt: deletedAt }));
      });
      state.papers.forEach(function (paper) {
        paper.folderIds = (paper.folderIds || []).filter(function (fid) { return !targetSet[fid]; });
      });
      commitUndo(T('删除文件夹'), undoBefore, { folders: undoIds, papers: affectedPaperIds });
      if (targetSet[state.activeFolderId]) resetActiveFolder();
      state.activeFolderIds = state.activeFolderIds.filter(function (fid) { return !targetSet[fid]; });
      if (state.folderSelAnchor && targetSet[state.folderSelAnchor]) state.folderSelAnchor = null;
      if (state.folderFocusId && targetSet[state.folderFocusId]) state.folderFocusId = null;
      renderAll();
      return save().then(function (saved) {
        if (saved) toast(T('已删除 ') + targets.length + T(' 个文件夹'));
      });
    });
  }

  function renameFolder(folderId) {
    var folder = state.folders.find(function (item) { return item.id === folderId; });
    if (!folder) return;
    dlgPrompt(T('重命名文件夹'), T('为“') + folder.name + T('”输入新名称：'), T('文件夹名称'), folder.name).then(function (name) {
      if (name == null) return;
      name = name.trim().slice(0, 80);
      if (!name) { toast(T('文件夹名称不能为空')); return; }
      if (name === folder.name) return;
      var parentId = folder.parentId || '';
      if (state.folders.some(function (f) {
        return f.id !== folderId && (f.parentId || '') === parentId && f.name.toLowerCase() === name.toLowerCase();
      })) {
        toast(T('该位置已存在同名文件夹')); return;
      }
      folder.name = name;
      window.LitModel.touch(folder);
      save(); renderAll();
      toast(T('✓ 已重命名为“') + name + '”');
    });
  }

  /** 文件夹下的文献（含所有子文件夹，去重、排除已删除） */
  function folderPapers(folderId) {
    var ids = {};
    state.folders.forEach(function (folder) {
      if (isFolderDescendant(folderId, folder.id)) ids[folder.id] = true;
    });
    var seen = {};
    return state.papers.filter(function (p) {
      if (p.deletedAt || seen[p.id]) return false;
      var hit = (p.folderIds || []).some(function (fid) { return !!ids[fid]; });
      if (hit) seen[p.id] = true;
      return hit;
    });
  }

  /** 内置视图（全部文献/未分类/最近阅读/回收站）的文献集合，口径与 filteredPapers 的
   *  视图分支一致：彻底删除的永久墓碑在任何视图（含回收站）都不出现。 */
  function libraryViewPapers(folderId) {
    return state.papers.filter(function (p) {
      if (state.hiddenPurged[p.id]) return false;
      if (folderId === 'trash') return !!p.deletedAt;
      if (p.deletedAt) return false;
      if (folderId === 'all') return true;
      if (folderId === 'unfiled') return !(p.folderIds || []).length;
      if (folderId === 'recent') return !!p.lastReadAt;
      return false;
    });
  }

  function libraryViewLabel(folderId) {
    if (folderId === 'all') return T('全部文献');
    if (folderId === 'unfiled') return T('未分类');
    if (folderId === 'recent') return T('最近阅读');
    return T('回收站');
  }

  /** 导出任意文献集合为 BibTeX；emptyMsg 由调用方给出更贴合语境的「没有文献」提示 */
  function exportPapersBib(papers, baseName, emptyMsg) {
    if (!papers.length) { toast(emptyMsg || T('没有可导出的文献')); return; }
    var base = (window.LitRename && window.LitRename.sanitize(baseName, 80)) || 'library';
    var out = papers.map(window.LitBib.paperToBibtex).join('\n\n');
    download(base + '.bib', out);
  }

  function exportFolderBib(folder) {
    exportPapersBib(folderPapers(folder.id), folder.name, T('该文件夹（含子文件夹）下没有文献'));
  }

  function buildFolderCtxItems(folder) {
    return [
      { header: folderPath(folder) },
      'sep',
      { label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } },
      { label: T('新建子文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(folder.id); } },
      { label: T('在此导入文件夹…'), icon: 'lb-i-folder-import', fn: function () { chooseFolderImport(folder.id); } },
      'sep',
      { label: T('导出 PDF…'), icon: 'lb-i-tray-up', fn: function () { exportPdfs(folderPapers(folder.id)); } },
      { label: T('导出 BibTeX'), icon: 'lb-i-doc', fn: function () { exportFolderBib(folder); } },
      { label: T('构建引文网络'), icon: 'lb-i-layers', fn: function () { buildFolderGraph(folder); } },
      'sep',
      { label: T('重命名…'), icon: 'lb-i-pencil', fn: function () { renameFolder(folder.id); } },
      { label: T('删除文件夹'), icon: 'lb-i-trash', danger: true, fn: function () { deleteFolder(folder.id); } }
    ];
  }

  /** 右键多选集合时的批量菜单：删除对整组生效（Zotero 式） */
  function buildFolderCtxItemsMulti(folderIds) {
    var count = folderIds.length;
    return [
      { header: count + T(' 个文件夹') },
      'sep',
      { label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } },
      { label: T('新建子文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(folderIds[0]); } },
      'sep',
      { label: T('删除 ') + count + T(' 个文件夹'), icon: 'lb-i-trash', danger: true,
        fn: function () { deleteFolders(folderIds); } }
    ];
  }

  /** 回收站「恢复全部」：清空墓碑标记，条目回到原文件夹 */
  function restoreAllTrash() {
    var ids = libraryViewPapers('trash').map(function (p) { return p.id; });
    if (!ids.length) { toast(T('回收站已经是空的')); return; }
    var n = restorePapers(ids);
    state.selected = {};
    renderAll();
    toast(T('✓ 已恢复 ') + n + T(' 篇'));
  }

  /** 清空回收站：站内全部条目彻底删除（永久墓碑，不可恢复） */
  function emptyTrash() {
    var ids = libraryViewPapers('trash').map(function (p) { return p.id; });
    if (!ids.length) { toast(T('回收站已经是空的')); return; }
    dlgConfirm(T('清空回收站'),
      T('彻底删除回收站中的 ') + ids.length + T(' 篇文献？此操作不可恢复！'),
      T('清空回收站'), true).then(function (ok) {
      if (!ok) return;
      var n = purgePapers(ids);
      toast(T('✓ 已清空回收站，彻底删除 ') + n + T(' 篇'));
    });
  }

  /** 内置视图右键菜单：集合级操作与文件夹菜单对齐；回收站换成恢复/清空 */
  function buildLibraryCtxItems(folderId) {
    var label = libraryViewLabel(folderId);
    var items = [{ header: label }, 'sep'];
    if (folderId === 'trash') {
      items.push({ label: T('恢复全部'), icon: 'lb-i-undo', fn: restoreAllTrash });
      items.push('sep');
      items.push({ label: T('清空回收站'), icon: 'lb-i-trash', danger: true, fn: emptyTrash });
      return items;
    }
    var papers = libraryViewPapers(folderId);
    items.push({ label: T('导出 PDF…'), icon: 'lb-i-tray-up', fn: function () { exportPdfs(papers); } });
    items.push({ label: T('导出 BibTeX'), icon: 'lb-i-doc', fn: function () { exportPapersBib(papers, label); } });
    items.push({ label: T('构建引文网络'), icon: 'lb-i-layers', fn: function () { openGraphForPapers(papers.slice(0, 200)); } });
    items.push('sep');
    items.push({ label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } });
    items.push({ label: T('导入文件夹…'), icon: 'lb-i-folder-import', fn: function () { chooseFolderImport(''); } });
    return items;
  }

  var drawerFolderFilter = '';

  function folderAssignmentRow(paper, entry) {
    var folder = entry.folder;
    var row = document.createElement('label');
    row.className = 'detail-folder-option';
    row.style.setProperty('--depth', Math.min(entry.depth, 8));
    row.title = folderPath(folder);
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.assignFolder = folder.id;
    input.checked = (paper.folderIds || []).indexOf(folder.id) !== -1;
    var glyph = document.createElement('span');
    glyph.className = 'detail-folder-glyph';
    glyph.innerHTML = svgUse(entry.depth ? 'lb-i-doc' : 'lb-i-folder');
    var name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.name;
    var count = document.createElement('span');
    count.className = 'folder-count';
    count.textContent = folderPaperCount(folder.id);
    row.appendChild(input);
    row.appendChild(glyph);
    row.appendChild(name);
    row.appendChild(count);
    return row;
  }

  function renderFolderList(list, paper, query) {
    list.innerHTML = '';
    var q = String(query || '').trim().toLowerCase();
    var entries = folderTree(true);
    if (!q) {
      entries.forEach(function (entry) { list.appendChild(folderAssignmentRow(paper, entry)); });
      return;
    }
    // 命中项连同祖先链一起保留，保证层级上下文可见
    var matched = {};
    entries.forEach(function (entry) {
      var folder = entry.folder;
      if (folder.name.toLowerCase().indexOf(q) === -1 && folderPath(folder).toLowerCase().indexOf(q) === -1) return;
      var current = folder, guard = 0;
      while (current && guard++ < state.folders.length + 1) {
        matched[current.id] = true;
        current = current.parentId ? state.folders.find(function (f) { return f.id === current.parentId; }) : null;
      }
    });
    entries.forEach(function (entry) {
      if (!matched[entry.folder.id]) return;
      var row = folderAssignmentRow(paper, entry);
      if (entry.folder.name.toLowerCase().indexOf(q) === -1) row.classList.add('folder-filter-context');
      list.appendChild(row);
    });
  }

  function renderFolderAssignments(paper) {
    var wrap = $('#d-folders');
    wrap.innerHTML = '';
    if (!paper) return;
    var actionsHtml = T('<div class="detail-folder-actions"><button type="button" class="btn btn-ghost" id="d-folder-new">＋ 新建文件夹</button></div>');
    if (!state.folders.length) {
      wrap.innerHTML = T('<div class="detail-folder-empty">左侧新建文件夹后，可在这里分类。</div>') + actionsHtml;
      return;
    }
    // 已加入的文件夹（chips，点击 × 即移出）
    var chips = document.createElement('div');
    chips.className = 'detail-folder-chips';
    var assigned = (paper.folderIds || []).map(function (fid) {
      return state.folders.find(function (f) { return f.id === fid; });
    }).filter(Boolean);
    if (!assigned.length) {
      var hint = document.createElement('span');
      hint.className = 'detail-folder-chips-empty';
      hint.textContent = T('未加入任何文件夹');
      chips.appendChild(hint);
    }
    assigned.forEach(function (folder) {
      var chip = document.createElement('span');
      chip.className = 'detail-folder-chip';
      chip.title = folderPath(folder);
      var name = document.createElement('span');
      name.textContent = folder.name;
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'detail-folder-chip-x';
      remove.dataset.unassignFolder = folder.id;
      remove.title = T('移出文件夹');
      remove.textContent = '×';
      chip.appendChild(name);
      chip.appendChild(remove);
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    // 筛选框
    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'detail-folder-filter';
    search.id = 'd-folder-filter';
    search.placeholder = T('筛选 ') + state.folders.length + T(' 个文件夹…');
    search.value = drawerFolderFilter;
    wrap.appendChild(search);
    // 层级列表
    var list = document.createElement('div');
    list.className = 'detail-folder-list';
    list.id = 'd-folder-list';
    wrap.appendChild(list);
    renderFolderList(list, paper, drawerFolderFilter);
    // 底部操作
    wrap.insertAdjacentHTML('beforeend', actionsHtml);
  }

  // ---------- 标签管理 ----------
  var TAG_PALETTE = ['#ffd400', '#5fbf77', '#5aa9ff', '#ff6b6b', '#b28dff', '#ff9f43', '#26c6da', '#8d99ae'];

  function tagFrequency() {
    var freq = {};
    state.papers.forEach(function (p) {
      if (p.deletedAt) return;
      (p.tags || []).forEach(function (tag) { freq[tag] = (freq[tag] || 0) + 1; });
    });
    return freq;
  }

  function setTagColor(tag, color) {
    var normalized = String(color || '').toLowerCase();
    var record = state.tagColorRecords.find(function (item) { return item.tag === tag; });
    if (normalized) {
      state.tagColors[tag] = normalized;
      if (record) {
        record.color = normalized;
        record.deletedAt = null;
      } else {
        state.tagColorRecords.push({ tag: tag, color: normalized, deletedAt: null });
      }
      return;
    }
    var previous = state.tagColors[tag] || (record && record.color) || '';
    delete state.tagColors[tag];
    if (!previous) return;
    if (record) {
      record.deletedAt = Date.now();
    } else {
      state.tagColorRecords.push({ tag: tag, color: previous, deletedAt: Date.now() });
    }
  }

  function renderTagManageList() {
    var freq = tagFrequency();
    var list = $('#tag-manage-list');
    list.innerHTML = '';
    var tags = Object.keys(freq).sort(function (a, b) { return a.localeCompare(b); });
    if (!tags.length) {
      list.innerHTML = T('<div class="dedupe-empty">还没有标签</div>');
      $('#tags-merge-selected').hidden = true;
      return;
    }
    $('#tags-merge-selected').hidden = tags.length < 2;
    // 轻量层级：foo/bar 归到 foo 下并缩进展示
    var topLevel = {};
    tags.forEach(function (tag) {
      var prefix = tag.indexOf('/') !== -1 ? tag.split('/')[0] : '';
      if (prefix) (topLevel[prefix] = topLevel[prefix] || []).push(tag);
    });
    var displayed = {};
    function tagRow(tag, depth) {
      displayed[tag] = true;
      var row = document.createElement('div');
      row.className = 'tag-manage-row' + (depth ? ' nested' : '');
      var color = state.tagColors[tag] || '';
      row.innerHTML =
        '<input type="checkbox" data-tag-select="' + esc(tag) + '">' +
        '<button type="button" class="tag-color-dot" data-tag-color="' + esc(tag) + T('" title="更换颜色"') +
          (color ? ' style="background:' + esc(color) + '"' : '') + '></button>' +
        '<span class="tag-manage-name">' + esc(tag) + '</span>' +
        '<span class="tag-manage-count">' + freq[tag] + '</span>' +
        '<button type="button" class="attachment-action" data-tag-rename="' + esc(tag) + T('">重命名</button>') +
        '<button type="button" class="attachment-action danger" data-tag-delete="' + esc(tag) + T('">删除</button>');
      list.appendChild(row);
    }
    tags.forEach(function (tag) {
      if (displayed[tag]) return;
      if (tag.indexOf('/') !== -1) return; // 子标签随父级展示
      tagRow(tag, 0);
      (topLevel[tag] || []).forEach(function (child) { tagRow(child, 1); });
    });
    tags.forEach(function (tag) {  // 父级本身未被使用的孤儿子标签
      if (!displayed[tag]) tagRow(tag, tag.indexOf('/') !== -1 ? 1 : 0);
    });
  }

  function renameTagEverywhere(oldName, newName) {
    var target = String(newName || '').trim();
    if (!target || target === oldName) return 0;
    var changed = 0;
    state.papers.forEach(function (p) {
      var tags = p.tags || [];
      if (tags.indexOf(oldName) === -1) return;
      var set = {};
      p.tags = tags.map(function (t) { return t === oldName ? target : t; })
        .filter(function (t) { if (set[t]) return false; set[t] = true; return true; });
      changed++;
    });
    if (state.tagColors[oldName]) {
      var color = state.tagColors[oldName];
      setTagColor(target, color);
      setTagColor(oldName, '');
    }
    if (state.filters.tag === oldName) state.filters.tag = target;
    return changed;
  }

  function deleteTagEverywhere(name) {
    var changed = 0;
    state.papers.forEach(function (p) {
      var tags = p.tags || [];
      if (tags.indexOf(name) === -1) return;
      p.tags = tags.filter(function (t) { return t !== name; });
      changed++;
    });
    setTagColor(name, '');
    if (state.filters.tag === name) state.filters.tag = '';
    return changed;
  }

  // ---------- 附件（多附件） ----------
  function attachmentUid() { return 'at' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function primaryAttachment(paper) {
    var atts = paper && paper.attachments || [];
    for (var i = 0; i < atts.length; i++) if (atts[i].kind === 'pdf') return atts[i];
    return null;
  }

  function renderAttachments(paper) {
    var wrap = $('#d-attachments');
    if (!wrap) return;
    wrap.innerHTML = '';
    var atts = paper.attachments || [];
    if (!atts.length) {
      wrap.innerHTML = T('<div class="attachment-empty">暂无附件，可用右上角「PDF」按钮联网获取开放获取全文。</div>');
    }
    var primary = primaryAttachment(paper);
    atts.forEach(function (att) {
      var row = document.createElement('div');
      row.className = 'attachment-row';
      var icon = att.kind === 'pdf' ? svgUse('lb-i-doc') : (att.kind === 'supp' ? svgUse('lb-i-paperclip') : svgUse('lb-i-package'));
      var badge = !att.path
        ? (att.cloudName ? T('<span class="attachment-badge cloud">云端</span>') : T('<span class="attachment-badge missing">缺文件</span>'))
        : '';
      row.innerHTML = '<span class="attachment-icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="attachment-name" title="' + esc(att.path || att.fileName || '') + '">' +
          esc(att.fileName || att.path || T('(未命名)')) + '</span>' +
        (primary === att ? T('<span class="attachment-badge primary">主 PDF</span>') : '') + badge;
      var actions = document.createElement('span');
      actions.className = 'attachment-actions';
      if (att.path && desktop) {
        actions.insertAdjacentHTML('beforeend',
          '<button type="button" class="attachment-action" data-att-action="open" data-att-id="' + att.id + T('">打开</button>') +
          '<button type="button" class="attachment-action" data-att-action="reveal" data-att-id="' + att.id + T('" title="在文件管理器中定位该文件">定位</button>'));
      }
      if (att.kind === 'pdf' && primary !== att) {
        actions.insertAdjacentHTML('beforeend',
          '<button type="button" class="attachment-action" data-att-action="primary" data-att-id="' + att.id + T('">设为主 PDF</button>'));
      }
      actions.insertAdjacentHTML('beforeend',
        '<button type="button" class="attachment-action danger" data-att-action="remove" data-att-id="' + att.id + T('" title="仅从库中移除记录，不删除本机文件">移除</button>'));
      row.appendChild(actions);
      wrap.appendChild(row);
    });
    var footer = document.createElement('div');
    footer.className = 'attachment-footer';
    if (desktop) {
      footer.insertAdjacentHTML('beforeend',
        '<button type="button" class="btn btn-ghost" data-att-action="add">' + svgUse('lb-i-plus') + T('添加附件</button>'));
      if (primary && primary.path) {
        footer.insertAdjacentHTML('beforeend',
          '<button type="button" class="btn btn-ghost" data-att-action="rename" data-att-id="' + primary.id + T('" title="按设置中的命名模板重命名主 PDF 文件">') + svgUse('lb-i-pencil') + T('按模板重命名</button>'));
      }
    }
    wrap.appendChild(footer);
  }

  // 统一附件打开入口（抽屉附件行 / 实体命中视图共用；右键菜单走 legacy pdfPath 不在此列）
  function openAttachment(paper, att) {
    if (!att) return;
    if (att.kind === 'pdf') { openPdfViewer(paper, att.id); return; }
    if (att.kind === 'epub') { openEpubViewer(paper, att.id); return; }
    if (att.kind === 'snapshot') {
      if (att.path) openSnapshotViewer(att.path, paper ? paper.title : '');
      else if (att.cloudName) toast(T('网页快照保存在云端，尚未下载到本机'));
      else toast(T('网页快照文件缺失'));
      return;
    }
    if (desktop && att.path) {
      desktop.openPath(att.path).then(function (err) { if (err) toast(T('⚠ 无法打开：') + err); });
    } else if (att.cloudName) {
      toast(T('此附件保存在云端，尚未下载到本机'));
    } else {
      toast(T('附件文件缺失'));
    }
  }

  // ---------- 内置 EPUB 阅读器（阶段六） ----------
  var epubState = {
    paper: null, attachment: null, attachmentId: '', api: null,
    tocItems: [], cfi: '', annotationColor: '#ffd400',
    pendingSelection: null, token: 0, fontSize: 16, theme: 'light'
  };
  var epubTabs = [];   // [{ key, paper, attachment, cfi, fontSize, theme }]
  var epubProgressEl = null; // 进度条常驻元素（激活重建视图时重挂，避免被 innerHTML 清掉）
  function keepEpubProgress() {
    if (!epubProgressEl) epubProgressEl = $('#epub-progress');
    var view = $('#epub-view');
    if (epubProgressEl && view && epubProgressEl.parentNode !== view) view.appendChild(epubProgressEl);
    var fill = $('#epub-progress-fill');
    if (fill) fill.style.width = '0%';
  }
  function showEpubProgress() {
    if (!epubState.api) return;
    var prog = epubState.api.progress();
    if (!prog) return;
    var fill = $('#epub-progress-fill');
    if (fill) fill.style.width = prog.percent + '%';
    return Math.round(prog.percent);
  }

  function epubAttachment(paper, attachmentId) {
    if (!paper) return null;
    var atts = paper.attachments || [];
    if (attachmentId) return atts.find(function (att) { return att.id === attachmentId; }) || null;
    return atts.find(function (att) { return att.kind === 'epub' && att.path; }) || null;
  }

  var persistEpubReadPos = debounce(function () {
    if (!desktop || !desktop.setSetting || !epubState.paper) return;
    desktop.setSetting('readpos:epub:' + epubState.paper.id + ':' + epubState.attachmentId, window.LitEpub.encodeReadPos({
      cfi: epubState.cfi, fontSize: epubState.fontSize, theme: epubState.theme
    })).catch(function () {});
  }, 5000);

  function stashEpubTab() {
    if (!epubState.paper) return;
    var tab = epubTabs.find(function (t) { return t.key === epubState.paper.id + ':' + epubState.attachmentId; });
    if (tab) {
      tab.cfi = epubState.cfi;
      tab.fontSize = epubState.fontSize;
      tab.theme = epubState.theme;
    }
  }

  function epubOnRelocated(cfi, href) {
    epubState.cfi = cfi;
    // 位置标签：当前 TOC 章节名 + 阅读进度百分比
    var label = '';
    epubState.tocItems.forEach(function (item) {
      if (item.href && href && (href === item.href || href.indexOf(item.href.split('#')[0]) === 0)) label = item.label;
    });
    var pct = showEpubProgress();
    $('#epub-location').textContent = (label ? label + ' · ' : '') + (pct != null ? pct + '%' : '');
    $all('#epub-toc .epub-toc-item').forEach(function (btn) {
      btn.classList.toggle('active', !!label && btn.textContent === label);
    });
    persistEpubReadPos();
    // 朗读：等翻章结果
    if (epubTtsState.waitingChapter) {
      epubTtsState.waitingChapter = false;
      epubTtsState.sentences = epubTtsCollect();
      epubTtsState.index = 0;
      if (!epubTtsState.sentences.length) {
        epubTtsState.emptyChapterTries++;
        if (epubTtsState.emptyChapterTries >= 3 || !epubState.api) { epubTtsStop(); if ($('#tts-status')) $('#tts-status').textContent = T('朗读完成'); return; }
        epubTtsState.waitingChapter = true;
        epubState.api.next();
        return;
      }
      epubTtsState.emptyChapterTries = 0;
      epubTtsSpeakNext();
    }
  }

  function epubOnSelected(cfiRange, range, contents) {
    var text = range ? String(range.toString() || '') : '';
    if (!text.trim()) { hideEpubSelPopover(); return; }
    epubState.pendingSelection = window.LitEpub.rangeToAnnotationData(range, cfiRange);
    refreshAgentChips(); // 新选区落定，agent 上下文 chip 即时反映「选中」
    var pop = $('#epub-sel-popover');
    var x = 80, y = 90;
    try {
      var rect = range.getBoundingClientRect();
      var frame = contents && contents.window && contents.window.frameElement ? contents.window.frameElement.getBoundingClientRect() : null;
      if (rect && frame) {
        x = Math.max(8, frame.left + rect.left);
        y = Math.max(8, frame.top + rect.top - 44);
      }
    } catch (e) {}
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    pop.hidden = false;
  }
  function hideEpubSelPopover() {
    var had = !!epubState.pendingSelection;
    epubState.pendingSelection = null;
    $('#epub-sel-popover').hidden = true;
    if (had) refreshAgentChips(); // 选区清空，agent 上下文 chip 同步摘掉
  }

  function renderEpubToc(items) {
    epubState.tocItems = items || [];
    var box = $('#epub-toc');
    box.innerHTML = '';
    if (!epubState.tocItems.length) {
      box.innerHTML = T('<p class="d-abstract none">本书没有目录</p>');
      return;
    }
    epubState.tocItems.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'epub-toc-item';
      btn.style.paddingLeft = (8 + item.depth * 14) + 'px';
      btn.textContent = item.label;
      btn.title = item.label;
      btn.addEventListener('click', function () {
        if (epubState.api && item.href) epubState.api.display(item.href);
      });
      box.appendChild(btn);
    });
  }

  function applyEpubPrefs() {
    if (!epubState.api) return;
    epubState.api.setFontSize(epubState.fontSize);
    epubState.api.setTheme(epubState.theme);
    $('#epub-font-size').textContent = epubState.fontSize + 'px';
  }

  function activateEpubTab(tab, cfiOverride) {
    ++pdfOpenRequest;
    pausePdfReadingTimer();
    // 收起 PDF overlay（若可见）
    if (!$('#pdf-overlay').hidden) {
      saveReadPos.flush();
      stashPdfTab();
      $('#pdf-overlay').hidden = true;
    }
    epubTtsStop();
    hideEpubSelPopover();
    var token = ++epubState.token;
    setPdfPageLocked(true);
    $('#epub-overlay').hidden = false;
    if (epubState.api) { epubState.api.destroy(); epubState.api = null; }
    epubState.paper = tab.paper;
    epubState.attachment = tab.attachment;
    epubState.attachmentId = tab.attachment.id;
    epubState.cfi = '';
    epubState.tocItems = [];
    $('#epub-title').textContent = (tab.paper.title || tab.attachment.fileName || 'EPUB') +
      (tab.attachment.fileName ? ' · ' + tab.attachment.fileName : '');
    $('#epub-location').textContent = '';
    $('#epub-view').innerHTML = T('<div class="pdf-loading">正在打开 EPUB…</div>');
    keepEpubProgress();
    recordPaperRead(tab.paper);
    syncReadingDrawer(tab.paper);
    refreshAgentChips(); // R19：切标签 = 换了正在读的文献
    var target = cfiOverride || tab.cfi || undefined;
    var readBytes = desktop && (desktop.readFileBytes || desktop.readBytes);
    if (!readBytes) { toast(T('EPUB 阅读需要桌面版')); return; }
    readBytes.call(desktop, tab.attachment.path).then(function (bytes) {
      if (token !== epubState.token) return;
      var api = window.LitEpub.openEpub(bytes, {
        container: $('#epub-view'),
        onRelocated: epubOnRelocated,
        onSelected: epubOnSelected
      });
      epubState.api = api;
      epubState.fontSize = tab.fontSize || 16;
      epubState.theme = tab.theme || 'light';
      applyEpubPrefs();
      return api.display(target).then(function () {
        // 后台生成精确位置表（spine ≤80 章才启用），完成后刷新进度显示
        api.enableLocations().then(function (ready) {
          if (ready && token === epubState.token) showEpubProgress();
        });
        return api.toc();
      }).then(function (items) {
        if (token !== epubState.token) return;
        renderEpubToc(items);
        attachAllEpubRenditionAnnotations();
        renderEpubAnnotations();
        renderEpubNoteEditor();
      });
    }).catch(function (err) {
      if (token !== epubState.token) return;
      var info = window.LitEpub.classifyError(err);
      toast(T('⚠ EPUB 打开失败：') + info.message, 5000);
      $('#epub-view').innerHTML = T('<div class="pdf-loading">打开失败：') + (info.message || '') + '</div>';
    });
    renderPdfTabs();
  }

  function switchEpubTab(key, cfiOverride) {
    if (!$('#epub-overlay').hidden && epubState.paper && epubState.paper.id + ':' + epubState.attachmentId === key && !cfiOverride) return;
    stashEpubTab();
    persistEpubReadPos.flush();
    var tab = epubTabs.find(function (t) { return t.key === key; });
    if (tab) activateEpubTab(tab, cfiOverride);
  }

  function hideEpubOverlay() {
    epubTtsStop();
    hideEpubSelPopover();
    if (epubState.api) { epubState.api.destroy(); epubState.api = null; }
    $('#epub-view').innerHTML = '';
    $('#epub-toc').innerHTML = '';
    setPdfPageLocked(false);
    $('#epub-overlay').hidden = true;
    epubState.paper = null;
    epubState.attachment = null;
    epubState.attachmentId = '';
    epubTabs = [];
    renderPdfTabs();
    refreshAgentChips(); // R19：阅读层关了，上下文回落列表焦点
  }

  function closeEpubTab(key) {
    var idx = -1;
    for (var i = 0; i < epubTabs.length; i++) if (epubTabs[i].key === key) { idx = i; break; }
    if (idx === -1) return;
    var wasActive = epubState.paper && epubTabs[idx].key === (epubState.paper.id + ':' + epubState.attachmentId);
    if (wasActive) persistEpubReadPos.flush();
    epubTabs.splice(idx, 1);
    if (!epubTabs.length) { hideEpubOverlay(); return; }
    if (wasActive) activateEpubTab(epubTabs[Math.max(0, idx - 1)]);
    else renderPdfTabs();
  }

  function closeEpubViewer() {
    if ($('#epub-overlay').hidden) return;
    if (!epubState.paper) { hideEpubOverlay(); return; }
    closeEpubTab(epubState.paper.id + ':' + epubState.attachmentId);
  }

  function openEpubViewer(paper, attachmentId, cfi) {
    organizePaperAttachments(paper && paper.id);
    if (!window.LitEpub) { toast(T('EPUB 组件未加载')); return; }
    var attachment = epubAttachment(paper, attachmentId);
    if (!desktop || !attachment || !attachment.path) { toast(T('没有可阅读的本地 EPUB 附件')); return; }
    var tabKey = paper.id + ':' + attachment.id;
    if (!$('#epub-overlay').hidden && epubState.paper && epubState.paper.id + ':' + epubState.attachmentId === tabKey && !cfi) return;
    if (!$('#epub-overlay').hidden) { stashEpubTab(); persistEpubReadPos.flush(); }
    var tab = epubTabs.find(function (t) { return t.key === tabKey; });
    if (tab) { if (cfi) tab.cfi = cfi; activateEpubTab(tab, cfi); return; }
    if (epubTabs.length >= 8) { toast(T('最多同时打开 8 个阅读标签')); return; }
    tab = { key: tabKey, paper: paper, attachment: attachment, cfi: cfi || '' };
    epubTabs.push(tab);
    if (desktop.getSetting) {
      desktop.getSetting('readpos:epub:' + paper.id + ':' + attachment.id).then(function (pos) {
        var decoded = window.LitEpub.decodeReadPos(pos);
        if (decoded && epubTabs.indexOf(tab) !== -1) {
          tab.cfi = cfi || decoded.cfi;
          tab.fontSize = decoded.fontSize;
          tab.theme = decoded.theme;
        }
        if (epubTabs.indexOf(tab) !== -1) activateEpubTab(tab, cfi);
      }).catch(function () { if (epubTabs.indexOf(tab) !== -1) activateEpubTab(tab, cfi); });
    } else {
      activateEpubTab(tab, cfi);
    }
  }

  /* EPUB 朗读：本章句子播完自动 next() 翻章（ relocated 钩子续播，空章最多跳 3 个） */
  var epubTtsState = { sentences: [], index: 0, speaking: false, waitingChapter: false, emptyChapterTries: 0 };

  /* 朗读状态栏：EPUB 朗读专用（PDF 朗读已裁撤），语速/暂停/停止共用一份 */
  var ttsState = { rate: 1.2, paused: false, bar: null };
  function ttsEnsureBar(parent) {
    if (ttsState.bar) return ttsState.bar;
    var bar = document.createElement('div');
    bar.className = 'pdf-tts-bar';
    bar.hidden = true;
    bar.innerHTML = '<span id="tts-status"></span>' +
      T('<select id="tts-rate" title="语速"><option value="0.8">0.8×</option><option value="1">1×</option><option value="1.2" selected>1.2×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>') +
      T('<button type="button" class="btn btn-ghost btn-xs" id="tts-pause">暂停</button>') +
      T('<button type="button" class="btn btn-ghost btn-xs" id="tts-stop">停止</button>');
    parent.appendChild(bar);
    bar.querySelector('#tts-rate').addEventListener('change', function (e) {
      ttsState.rate = Number(e.target.value) || 1.2;
    });
    bar.querySelector('#tts-pause').addEventListener('click', function () {
      if (!epubTtsState.speaking) return;
      if (!ttsState.paused) { window.speechSynthesis.pause(); ttsState.paused = true; this.textContent = T('继续'); }
      else { window.speechSynthesis.resume(); ttsState.paused = false; this.textContent = T('暂停'); }
    });
    bar.querySelector('#tts-stop').addEventListener('click', function () { epubTtsStop(); });
    ttsState.bar = bar;
    return bar;
  }
  function epubTtsCollect() {
    var t = epubState.api ? epubState.api.visibleText() : '';
    var sentences = [];
    (t.match(/[^。！？.!?]+[。！？.!?]?/g) || []).forEach(function (s) {
      s = s.trim();
      if (s.length > 1) sentences.push(s);
    });
    return sentences;
  }
  function epubTtsSpeakNext() {
    if (!epubTtsState.speaking) return;
    var s = epubTtsState;
    if (s.index >= s.sentences.length) {
      s.sentences = [];
      s.index = 0;
      if (!epubState.api) { epubTtsStop(); return; }
      s.waitingChapter = true;
      epubState.api.next();
      return;
    }
    var u = new window.SpeechSynthesisUtterance(s.sentences[s.index]);
    u.lang = /[㐀-鿿]/.test(s.sentences[s.index]) ? 'zh-CN' : 'en-US';
    u.rate = ttsState.rate;
    u.onend = function () { s.index++; epubTtsSpeakNext(); };
    u.onerror = function () { s.index++; epubTtsSpeakNext(); };
    if ($('#tts-status')) $('#tts-status').textContent = T('第 ') + (s.index + 1) + '/' + s.sentences.length + T(' 句');
    window.speechSynthesis.speak(u);
  }
  function epubTtsStop() {
    epubTtsState.speaking = false;
    epubTtsState.waitingChapter = false;
    window.speechSynthesis.cancel();
    if (ttsState.bar) ttsState.bar.hidden = true;
  }
  function epubTtsToggle() {
    if (epubTtsState.speaking) { epubTtsStop(); return; }
    var sentences = epubTtsCollect();
    if (!sentences.length) { toast(T('本章没有可朗读的文本')); return; }
    epubTtsState.sentences = sentences;
    epubTtsState.index = 0;
    epubTtsState.speaking = true;
    epubTtsState.emptyChapterTries = 0;
    ttsState.paused = false;
    var epubBar = ttsEnsureBar($('#epub-overlay'));
    epubBar.hidden = false;
    var epubPause = epubBar.querySelector('#tts-pause');
    if (epubPause) epubPause.textContent = T('暂停');
    epubTtsSpeakNext();
  }

  /* ---- EPUB 批注（CFI 定位，阶段六切片 3） ---- */
  function attachEpubRenditionAnnotation(ann) {
    if (!epubState.api || !ann || !ann.position || !ann.position.cfi) return;
    try {
      epubState.api.rendition.annotations.add(
        ann.type === 'underline' ? 'underline' : 'highlight',
        ann.position.cfi,
        { id: ann.id },
        null,
        'lb-epub-ann',
        { fill: ann.color || '#ffd400' }
      );
    } catch (e) {}
  }
  function attachAllEpubRenditionAnnotations() {
    if (!epubState.api || !epubState.paper) return;
    annotationsForAttachment(epubState.paper, epubState.attachment).forEach(attachEpubRenditionAnnotation);
  }
  function detachEpubRenditionAnnotation(ann) {
    if (!epubState.api || !ann || !ann.position || !ann.position.cfi) return;
    try {
      epubState.api.rendition.annotations.remove(ann.type === 'underline' ? 'underline' : 'highlight', ann.position.cfi);
    } catch (e) {}
  }

  function createEpubAnnotation(type, comment) {
    var sel = epubState.pendingSelection;
    if (!epubState.paper || !sel || !sel.cfi) { hideEpubSelPopover(); return; }
    var now = Date.now();
    var undoBefore = makeSnapshot({ papers: [epubState.paper.id] });
    var addition = {
      id: annotationUid(), type: type, color: epubState.annotationColor, attachmentId: epubState.attachmentId,
      text: (sel.text || '').slice(0, 12000), comment: comment || '',
      position: { cfi: sel.cfi, textAnchor: { exact: (sel.text || '').slice(0, 2000), prefix: '', suffix: '' } },
      createdAt: now, updatedAt: now
    };
    epubState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(
      (epubState.paper.pdfAnnotations || []).concat([addition])
    );
    commitUndo(T('添加批注'), undoBefore, { papers: [epubState.paper.id] });
    save();
    var added = epubState.paper.pdfAnnotations.filter(function (a) { return a.position && a.position.cfi === sel.cfi; }).pop();
    if (added) attachEpubRenditionAnnotation(added);
    hideEpubSelPopover();
    try {
      var selection = window.getSelection();
      if (selection) selection.removeAllRanges();
    } catch (e) {}
    renderEpubAnnotations(added && added.id);
    renderEpubNoteStale();
    toast(T('已添加') + (type === 'highlight' ? T('高亮') : T('批注')));
  }

  function renderEpubAnnotations(activeId) {
    var list = $('#epub-annotation-list');
    var empty = $('#epub-annotation-empty');
    var annotations = annotationsForAttachment(epubState.paper, epubState.attachment).slice()
      .sort(function (a, b) { return window.LitEpub.compareCfi((a.position && a.position.cfi) || '', (b.position && b.position.cfi) || ''); });
    list.innerHTML = '';
    $('#epub-annotation-count').textContent = annotations.length;
    empty.hidden = annotations.length > 0;
    annotations.forEach(function (annotation) {
      var item = document.createElement('article');
      item.className = 'pdf-annotation-item' + (annotation.id === activeId ? ' active' : '');
      item.dataset.annotationId = annotation.id;
      item.style.setProperty('--annotation-color', annotation.color);
      var head = document.createElement('div');
      head.className = 'pdf-annotation-item-head';
      var label = document.createElement('strong');
      label.textContent = { highlight: T('高亮'), underline: T('下划线'), note: T('批注') }[annotation.type] || T('批注');
      var page = document.createElement('span');
      page.textContent = 'EPUB';
      page.title = (annotation.position && annotation.position.cfi) || '';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pdf-annotation-delete';
      remove.dataset.deleteAnnotation = annotation.id;
      remove.title = T('删除批注');
      remove.setAttribute('aria-label', T('删除批注'));
      remove.textContent = '×';
      head.appendChild(label); head.appendChild(page); head.appendChild(remove);
      var quote = document.createElement('p');
      quote.className = 'pdf-annotation-quote';
      quote.textContent = annotation.text || T('无文字内容');
      var comment = document.createElement('textarea');
      comment.className = 'pdf-annotation-comment';
      comment.dataset.annotationComment = annotation.id;
      comment.rows = 2;
      comment.placeholder = T('添加批注内容…');
      comment.value = annotation.comment || '';
      var actions = document.createElement('div');
      actions.className = 'pdf-annotation-actions';
      var toNote = document.createElement('button');
      toNote.type = 'button';
      toNote.className = 'btn btn-ghost btn-xs';
      toNote.dataset.annotationToNote = annotation.id;
      toNote.title = T('把这条批注作为摘录加入笔记');
      toNote.textContent = T('加到笔记');
      actions.appendChild(toNote);
      var tagBox = document.createElement('span');
      tagBox.className = 'pdf-annotation-tags';
      (annotation.tags || []).forEach(function (tag) {
        var chipEl = document.createElement('span');
        chipEl.className = 'pdf-annotation-tag';
        chipEl.dataset.annotationTagRemove = annotation.id;
        chipEl.dataset.tag = tag;
        chipEl.title = T('点击移除标签');
        chipEl.textContent = tag;
        tagBox.appendChild(chipEl);
      });
      var tagInput = document.createElement('input');
      tagInput.className = 'pdf-annotation-tag-input';
      tagInput.dataset.annotationTagInput = annotation.id;
      tagInput.placeholder = T('＋标签');
      tagInput.setAttribute('aria-label', T('批注标签'));
      tagBox.appendChild(tagInput);
      actions.appendChild(tagBox);
      item.appendChild(head); item.appendChild(quote); item.appendChild(comment); item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function focusEpubAnnotation(annotationId) {
    if (!epubState.paper || !epubState.api) return;
    var annotation = annotationsForAttachment(epubState.paper, epubState.attachment).find(function (item) { return item.id === annotationId; });
    if (!annotation || !annotation.position || !annotation.position.cfi) return;
    // textAnchor 随行：旧 epub.js CFI 解析失败时的回退锚（findAnchorRange 章内查找）
    epubState.api.goTo(annotation.position.cfi, annotation.position.textAnchor);
    renderEpubAnnotations(annotationId);
    var item = $('#epub-annotation-list [data-annotation-id="' + annotationId + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  /* ---- 阅读器侧栏笔记：PDF / EPUB 共用 js/app/note-panel.js ---- */
  var epubNotePanel = null;
  var pdfNotePanel = null;
  var saveEpubAnnotationComment = debounce(function () { save(); }, 600);

  function currentEpubNote() {
    return epubNotePanel ? epubNotePanel.current() : null;
  }

  function renderEpubNoteEditor() {
    if (epubNotePanel) epubNotePanel.render();
  }

  function renderEpubNoteStale() {
    if (epubNotePanel) epubNotePanel.renderStale();
  }

  var itemOrganizeInFlight = Object.create(null);
  var itemOrganizeSeen = Object.create(null);
  function attachmentPathsKey(paper) {
    return (paper && paper.attachments || []).map(function (att) {
      return att && att.path ? att.id + ':' + att.path : '';
    }).join('\n');
  }

  /** 旧附件在首次打开该条目时复制进专属目录；先校验副本，再保存路径，原件保留。 */
  function organizePaperAttachments(paperId) {
    if (!paperId || !desktop || !desktop.organizeItemAttachments) return Promise.resolve();
    var paper = getById(paperId);
    if (!paper || paper.deletedAt || !(paper.attachments || []).some(function (att) { return att && att.path; })) return Promise.resolve();
    var key = attachmentPathsKey(paper);
    if (itemOrganizeSeen[paperId] === key) return Promise.resolve();
    if (itemOrganizeInFlight[paperId]) return itemOrganizeInFlight[paperId];
    var list = paper.attachments.filter(function (att) { return att && att.id && att.path; }).map(function (att) {
      return { id: att.id, kind: att.kind, fileName: att.fileName, path: att.path };
    });
    itemOrganizeInFlight[paperId] = desktop.organizeItemAttachments({ paperId: paperId, attachments: list })
      .then(function (result) {
        if (!result || result.error) throw new Error(result && result.error || T('附件整理失败'));
        if (result.failed && result.failed.length) {
          toast('⚠ ' + T('部分附件整理失败：') + result.failed[0].error);
        }
        return waitForLocalSave().then(function (ready) {
          if (!ready) return;
          var current = getById(paperId);
          if (!current || current.deletedAt) return;
          var changes = {};
          (result.updated || []).forEach(function (entry) { changes[entry.id] = entry; });
          var changed = false;
          var attachments = (current.attachments || []).map(function (att) {
            var entry = att && changes[att.id];
            if (!entry || att.path !== entry.from) return att;
            changed = true;
            return Object.assign({}, att, { path: entry.path });
          });
          if (!changed) {
            itemOrganizeSeen[paperId] = attachmentPathsKey(current);
            return backfillPdfFingerprints([paperId]);
          }
          var next = window.LitModel.normalizePaper(Object.assign({}, current, { attachments: attachments }), uid);
          next.id = current.id;
          var index = state.papers.indexOf(current);
          if (index === -1) return;
          state.papers[index] = next;
          return save(true).then(function (saved) {
            if (!saved) return;
            itemOrganizeSeen[paperId] = attachmentPathsKey(next);
            renderAll();
            if (drawerId === paperId) openDrawer(paperId);
            return backfillPdfFingerprints([paperId]);
          });
        });
      }).catch(function (error) { toast('⚠ ' + T('附件整理失败：') + (error && error.message || error)); })
      .finally(function () { delete itemOrganizeInFlight[paperId]; });
    return itemOrganizeInFlight[paperId];
  }

  function attachmentSourcePath(file) {
    if (desktop && desktop.getPathForFile) {
      try {
        var resolved = desktop.getPathForFile(file);
        if (resolved) return resolved;
      } catch (error) { /* 文件选择对话框返回的是普通路径对象，不是 File */ }
    }
    return file && file.path ? String(file.path) : '';
  }

  /** Zotero 式子附件：先复制到条目受管目录，成功后一次性提交附件记录。 */
  function attachFilesToPaper(paper, files, fromDrop) {
    if (!desktop || !desktop.storeAttachment) { toast(T('附加文件需要桌面版')); return Promise.resolve(); }
    var list = Array.prototype.slice.call(files || []);
    if (list.some(function (file) { return /\.lnk$/i.test(file.name); })) toast(T('⚠ 快捷方式（.lnk）无法作为附件，已跳过'));
    list = list.filter(function (file) { return !/\.lnk$/i.test(file.name); });
    // DataTransfer 的 File 离开 drop 事件后可能失效；必须在这里同步解析真实路径。
    var sources = list.map(function (file) {
      return { name: file.name, path: attachmentSourcePath(file) };
    });
    var added = [];
    var chain = Promise.resolve();
    sources.forEach(function (file) {
      chain = chain.then(function () {
        var sourcePath = file.path;
        if (!sourcePath) {
          toast('⚠ ' + file.name + T(' 存储失败：') + T('无效的源文件路径'));
          return;
        }
        var current = getById(paper.id);
        var existing = (current && current.attachments || []).concat(added).filter(function (att) {
          return att && att.kind === 'pdf' && att.path;
        }).map(function (att) { return { kind: att.kind, path: att.path }; });
        return desktop.storeAttachment({ paperId: paper.id, path: sourcePath, existing: existing }).then(function (result) {
          if (!result || result.error) {
            toast('⚠ ' + file.name + T(' 存储失败：') + (result && result.error || T('无效的源文件路径')));
            return;
          }
          if (result.duplicate) {
            toast('⚠ ' + file.name + ' · ' + T('文件已在库中'));
            return;
          }
          added.push(window.LitModel.normalizeAttachment({
            id: attachmentUid(),
            kind: window.LitModel.attachmentKindForFile(file.name) || 'supp',
            fileName: file.name,
            path: result.path
          }));
        });
      });
    });
    return chain.then(function () {
      if (!added.length) return;
      var current = getById(paper.id);
      if (!current || current.deletedAt) return;
      var attachments = (current.attachments || []).slice();
      added.forEach(function (attachment) {
        if (attachment.kind === 'pdf' && !attachments.some(function (a) { return a && a.kind === 'pdf'; })) {
          attachments.unshift(attachment);
        } else attachments.push(attachment);
      });
      var next = Object.assign({}, current, { attachments: attachments });
      window.LitModel.touch(next);
      var norm = window.LitModel.normalizePaper(next, uid);
      norm.id = current.id;
      state.papers[state.papers.indexOf(current)] = norm;
      return save().then(function (saved) {
        if (!saved) return;
        renderAll();
        if (!fromDrop) openDrawer(paper.id);
        toast(fromDrop
          ? T('✓ 已附加 ') + added.length + T(' 个文件到「') + String(paper.title || '').slice(0, 24) + '」'
          : T('✓ 已添加 ') + added.length + T(' 个附件'));
        if (added.some(function (a) { return a.kind === 'pdf' || a.kind === 'epub'; })) {
          backfillPdfFingerprints([paper.id]).then(function () {
            var updated = getById(paper.id);
            if (updated) indexPaperFulltext(updated);
            renderAll();
            return organizePaperAttachments(paper.id);
          }).catch(function () {});
        } else organizePaperAttachments(paper.id);
      });
    }).catch(function (error) { toast(T('⚠ 附加失败：') + (error && error.message || error)); });
  }

  function addAttachmentsTo(paper) {
    if (!desktop || !desktop.chooseFiles) { toast(T('添加附件需要桌面版')); return; }
    desktop.chooseFiles({ title: T('添加附件到「') + String(paper.title).slice(0, 24) + '」' }).then(function (files) {
      if (files && files.length) return attachFilesToPaper(paper, files, false);
    }).catch(function (error) { toast(T('⚠ 添加附件失败：') + (error && error.message || error)); });
  }

  /* 文件拖到条目行上：File 路径必须经 preload 的 webUtils.getPathForFile 解析。 */
  function attachDroppedFiles(paper, files) {
    return attachFilesToPaper(paper, files, true);
  }

  function renameAttachmentByTemplate(paper, attId) {
    if (!desktop || !desktop.renameFile || !window.LitRename) { toast(T('重命名需要桌面版')); return; }
    var att = (paper.attachments || []).find(function (a) { return a.id === attId; });
    if (!att || !att.path) { toast(T('该附件没有本地文件')); return; }
    var template = window.LitRename.DEFAULT_TEMPLATE;
    var base = window.LitRename.buildName(paper, template);
    desktop.renameFile({ path: att.path, baseName: base }).then(function (result) {
      if (!result || result.error) { toast(T('⚠ 重命名失败：') + (result && result.error || T('未知错误'))); return; }
      if (result.unchanged) { toast(T('文件名已符合模板')); return; }
      att.path = result.path;
      att.fileName = result.name;
      var norm = window.LitModel.normalizePaper(paper, uid);
      norm.id = paper.id;
      state.papers[state.papers.indexOf(paper)] = norm;
      save(); renderAll();
      if (drawerId === paper.id) openDrawer(paper.id);
      toast(T('✓ 已重命名为 ') + result.name);
    }).catch(function (e) { toast(T('⚠ 重命名失败：') + (e && e.message || e)); });
  }

  function bulkRenamePdfs(papers) {
    if (!desktop || !desktop.renameFile || !window.LitRename) { toast(T('重命名需要桌面版')); return; }
    var targets = papers.filter(function (p) { return primaryAttachment(p) && primaryAttachment(p).path; });
    if (!targets.length) { toast(T('选中文献没有本地 PDF 附件')); return; }
    var template = window.LitRename.DEFAULT_TEMPLATE;
    var renamed = 0, failed = 0;
    toast(T('正在按模板重命名 ') + targets.length + T(' 个 PDF…'));
    var chain = Promise.resolve();
    targets.forEach(function (paper) {
      chain = chain.then(function () {
        var att = primaryAttachment(paper);
        return desktop.renameFile({ path: att.path, baseName: window.LitRename.buildName(paper, template) })
          .then(function (result) {
            if (result && !result.error && !result.unchanged) {
              att.path = result.path;
              att.fileName = result.name;
              renamed++;
            } else if (result && result.error) failed++;
          }).catch(function () { failed++; });
      });
    });
    chain.then(function () {
      save(); renderAll();
      if (drawerId) openDrawer(drawerId);
      toast(T('✓ 重命名完成：') + renamed + T(' 个已改名') + (failed ? '，' + failed + T(' 个失败') : '') + T('，其余已符合模板'));
    });
  }

  // ---------- 相关文献 ----------
  var relatedPickerPaperId = null;

  function renderRelated(paper) {
    var wrap = $('#d-related');
    if (!wrap) return;
    wrap.innerHTML = '';
    var shown = 0;
    (paper.relatedIds || []).forEach(function (rid) {
      var target = getById(rid);
      if (!target) return;
      shown++;
      var chip = document.createElement('span');
      chip.className = 'related-chip';
      var link = document.createElement('button');
      link.type = 'button';
      link.className = 'related-chip-link';
      link.dataset.relatedOpen = rid;
      link.title = target.title;
      link.textContent = target.title.slice(0, 40) + (target.title.length > 40 ? '…' : '');
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'related-chip-x';
      remove.dataset.relatedRemove = rid;
      remove.title = T('移除关联');
      remove.textContent = '×';
      chip.appendChild(link);
      chip.appendChild(remove);
      wrap.appendChild(chip);
    });
    if (!shown) {
      var hint = document.createElement('span');
      hint.className = 'related-empty';
      hint.textContent = T('暂无关联');
      wrap.appendChild(hint);
    }
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-ghost related-add';
    add.dataset.relatedAdd = '1';
    add.textContent = T('＋ 添加关联');
    wrap.appendChild(add);
  }

  function renderRelatedPicker(query) {
    var paper = getById(relatedPickerPaperId);
    var list = $('#related-picker-list');
    list.innerHTML = '';
    if (!paper) return;
    var q = String(query || '').trim().toLowerCase();
    var related = {};
    (paper.relatedIds || []).forEach(function (rid) { related[rid] = true; });
    var matches = state.papers.filter(function (p) {
      if (p.id === paper.id || related[p.id] || p.deletedAt) return false;
      if (!q) return true;
      return (p.title + ' ' + (p.authors || []).join(' ')).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 50);
    if (!matches.length) {
      list.innerHTML = T('<div class="detail-folder-empty">没有可关联的文献</div>');
      return;
    }
    matches.forEach(function (p) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'related-picker-row';
      row.dataset.relatedPick = p.id;
      row.innerHTML = '<span class="related-picker-title">' + esc(p.title) + '</span>' +
        '<span class="related-picker-meta">' + esc(authorsShort(p.authors)) + (p.year ? ' · ' + p.year : '') + '</span>';
      list.appendChild(row);
    });
  }

  function linkRelated(sourceId, targetId) {
    var source = getById(sourceId), target = getById(targetId);
    if (!source || !target) return;
    source.relatedIds = source.relatedIds || [];
    target.relatedIds = target.relatedIds || [];
    if (source.relatedIds.indexOf(targetId) === -1) source.relatedIds.push(targetId);
    if (target.relatedIds.indexOf(sourceId) === -1) target.relatedIds.push(sourceId); // 双向互链
    save(); renderAll();
    if (drawerId === sourceId) renderRelated(source);
  }

  function unlinkRelated(sourceId, targetId) {
    var source = getById(sourceId), target = getById(targetId);
    if (!source) return;
    source.relatedIds = (source.relatedIds || []).filter(function (id) { return id !== targetId; });
    if (target) target.relatedIds = (target.relatedIds || []).filter(function (id) { return id !== sourceId; });
    save(); renderAll();
    if (drawerId === sourceId) renderRelated(source);
  }

  // ---------- 作者合并 ----------
  function renderAuthorsModal() {
    var groups = window.LitAuthors.findMergeGroups(state.papers);
    var list = $('#authors-list');
    list.innerHTML = '';
    $('#authors-merge-selected').hidden = groups.length === 0;
    if (!groups.length) {
      list.innerHTML = T('<div class="dedupe-empty">未发现需要合并的作者写法</div>');
      return;
    }
    groups.forEach(function (group, index) {
      var row = document.createElement('label');
      row.className = 'authors-group';
      var variantsText = group.variants.map(function (v) { return v.name + ' ×' + v.count; }).join('；');
      row.innerHTML = '<input type="checkbox" data-author-group="' + index + '" checked>' +
        '<span class="authors-group-body"><strong>' + esc(group.suggested) + '</strong>' +
        '<span class="authors-variants">' + esc(variantsText) + '</span></span>';
      list.appendChild(row);
    });
  }

  function mergeSelectedAuthors() {
    var groups = window.LitAuthors.findMergeGroups(state.papers);
    var selected = {};
    $all('#authors-list [data-author-group]:checked').forEach(function (box) {
      selected[Number(box.dataset.authorGroup)] = true;
    });
    var papersChanged = 0, occurrences = 0, groupCount = 0;
    groups.forEach(function (group, index) {
      if (!selected[index]) return;
      var fromNames = group.variants.map(function (v) { return v.name; })
        .filter(function (name) { return name !== group.suggested; });
      var result = window.LitAuthors.mergeAuthors(state.papers, fromNames, group.suggested);
      papersChanged += result.papersChanged;
      occurrences += result.occurrences;
      groupCount++;
    });
    if (!groupCount) return;
    save(); renderAll();
    renderAuthorsModal();
    toast(T('✓ 已合并 ') + groupCount + T(' 组：改写 ') + occurrences + T(' 处、涉及 ') + papersChanged + T(' 篇'));
  }

  // ---------- 批量选择 ----------
  function selectedIds() { return Object.keys(state.selected); }
  function renderBulkBar() {
    var ids = selectedIds();
    $('#bulk-bar').hidden = ids.length === 0;
    if (ids.length) $('#bulk-count').textContent = T('已选 ') + ids.length + T(' 篇');
    var inTrash = state.activeFolderId === 'trash';
    $all('#bulk-bar [data-normal-only]').forEach(function (b) { b.hidden = inTrash; });
    $all('#bulk-bar [data-trash-only]').forEach(function (b) { b.hidden = !inTrash; });
  }
  function syncCheckAll(list) {
    list = list || filteredPapers();
    var all = $('#check-all');
    if (!all) return;
    var selCount = list.filter(function (p) { return state.selected[p.id]; }).length;
    all.checked = list.length > 0 && selCount === list.length;
    all.indeterminate = selCount > 0 && selCount < list.length;
  }
  function updateSelectionUi() {
    $all('#table-body tr').forEach(function (tr) {
      var on = !!state.selected[tr.dataset.id];
      tr.classList.toggle('selected', on);
      var box = tr.querySelector('[data-act="select"]');
      if (box) box.checked = on;
    });
    syncCheckAll();
    renderBulkBar();
  }
  function updateFocusUi() {
    $all('#table-body tr').forEach(function (tr) {
      tr.classList.toggle('focused', tr.dataset.id === state.focusId);
    });
  }
  function toggleSelectId(id) {
    if (state.selected[id]) delete state.selected[id]; else state.selected[id] = true;
    updateSelectionUi();
  }
  /** Shift 区间选择：从锚点行到目标行（按当前筛选/排序顺序）全部选中，替换原选择 */
  function selectRangeTo(targetId, additive) {
    var list = filteredPapers();
    var targetIdx = -1, anchorIdx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === targetId) targetIdx = i;
      if (list[i].id === state.selAnchor) anchorIdx = i;
    }
    if (!additive) state.selected = {};
    if (targetIdx === -1) return;
    if (anchorIdx === -1) { state.selected[targetId] = true; return; }
    var from = Math.min(anchorIdx, targetIdx), to = Math.max(anchorIdx, targetIdx);
    for (var j = from; j <= to; j++) state.selected[list[j].id] = true;
  }
  function moveFocus(delta, extend) {
    var list = filteredPapers();
    if (!list.length) return;
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === state.focusId) { idx = i; break; } }
    if (extend && !state.selAnchor && state.focusId) state.selAnchor = state.focusId;
    idx = idx === -1 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, idx + delta));
    state.focusId = list[idx].id;
    if (extend) {
      selectRangeTo(state.focusId);
      updateSelectionUi();
    }
    var targetPage = Math.floor(idx / TABLE_PAGE_SIZE);
    if (targetPage !== state.tablePage) {
      state.tablePage = targetPage;
      renderTable(list);
    }
    updateFocusUi();
    var tr = document.querySelector('#table-body tr[data-id="' + state.focusId + '"]');
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }

  function renderStats() {
    var livePapers = state.papers.filter(function (p) { return !p.deletedAt; });
    var total = livePapers.length;
    var monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    var thisMonth = 0, localPdf = 0, completeFields = 0, missingDoi = 0, missingAbstract = 0;
    livePapers.forEach(function (p) {
      if (p.addedAt >= monthAgo) thisMonth++;
      if (p.pdfPath) localPdf++;
      if (p.authors && p.authors.length) completeFields++;
      if (p.year != null) completeFields++;
      if (p.venue) completeFields++;
      if (p.doi) completeFields++; else missingDoi++;
      if (p.abstract) completeFields++; else missingAbstract++;
    });
    $('#stat-total').textContent = total;
    var pdfPct = total ? Math.round(localPdf / total * 100) + '%' : '0%';
    $('#stat-pdf').textContent = pdfPct;
    $('#stat-pdf-hint').textContent = total ? localPdf + ' / ' + total + T(' 篇已落地') : T('暂无文献');
    $('#stat-completeness').textContent = total ? Math.round(completeFields / (total * 5) * 100) + '%' : '0%';
    var doiBtn = $('#stat-missing-doi');
    var absBtn = $('#stat-missing-abstract');
    doiBtn.hidden = !total || !missingDoi;
    doiBtn.textContent = T('缺 DOI ') + missingDoi;
    absBtn.hidden = !total || !missingAbstract;
    absBtn.textContent = T('缺摘要 ') + missingAbstract;
    var years = livePapers.map(function (p) { return p.year; }).filter(function (y) { return y != null; });
    $('#stat-total-hint').textContent = years.length
      ? Math.min.apply(null, years) + ' – ' + Math.max.apply(null, years)
      : ' ';
    var stripText = $('#stats-strip-text');
    if (stripText) {
      var parts = [total + T(' 篇')];
      if (total) parts.push(T('本地 PDF ') + pdfPct);
      if (thisMonth) parts.push(T('近 30 天 +') + thisMonth);
      stripText.textContent = parts.join(' · ');
    }
  }

  var chartShowAllYears = false;
  var chartRecentStart = null;
  function renderChart() {
    var body = $('#year-chart');
    body.innerHTML = '';
    var old = $('.ybar-x'); if (old) old.remove();

    var counts = {};
    state.papers.forEach(function (p) { if (!p.deletedAt && !state.hiddenPurged[p.id] && p.year != null) counts[p.year] = (counts[p.year] || 0) + 1; });
    var years = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    if (!years.length) {
      body.innerHTML = T('<div class="chart-empty">导入文献后显示年份分布</div>');
      $('#chart-peak').textContent = '';
      $('#chart-range').hidden = true;
      return;
    }
    var minY = years[0], maxY = years[years.length - 1];
    var recentStart = maxY - 19;
    chartRecentStart = recentStart;
    var showAll = chartShowAllYears;
    $('#chart-range').hidden = minY >= recentStart;
    $('#chart-range').textContent = showAll ? T('只看近 20 年') : T('查看全部年份');
    $('#chart-range').setAttribute('aria-pressed', String(showAll));
    var seq = [];
    if (showAll && maxY - minY > 50) seq = years; // 全时段跨度太大时只画有数据的年份
    else for (var y = showAll ? minY : Math.max(minY, recentStart); y <= maxY; y++) seq.push(y);
    var maxCount = Math.max.apply(null, seq.map(function (y) { return counts[y] || 0; }));
    var peakYear = seq.reduce(function (best, y) { return (counts[y] || 0) > (counts[best] || 0) ? y : best; }, seq[0]);
    $('#chart-peak').textContent = T('峰值 ') + peakYear + T(' 年 · ') + counts[peakYear] + T(' 篇');

    var tooltip = $('#chart-tooltip');
    if (!showAll && minY < recentStart) {
      var earlierCount = years.filter(function (y) { return y < recentStart; })
        .reduce(function (sum, y) { return sum + counts[y]; }, 0);
      var earlierBar = document.createElement('div');
      earlierBar.className = 'ybar earlier';
      earlierBar.style.height = '16px';
      earlierBar.setAttribute('aria-label', recentStart + T(' 年前 · ') + earlierCount + T(' 篇'));
      earlierBar.addEventListener('mouseenter', function () {
        tooltip.textContent = T('更早') + ' · ' + earlierCount + T(' 篇');
        tooltip.hidden = false;
        var cardRect = earlierBar.closest('.chart-card').getBoundingClientRect();
        var r = earlierBar.getBoundingClientRect();
        tooltip.style.left = (r.left - cardRect.left + r.width / 2) + 'px';
        tooltip.style.top = (r.top - cardRect.top - 6) + 'px';
      });
      earlierBar.addEventListener('mouseleave', function () { tooltip.hidden = true; });
      body.appendChild(earlierBar);
    }
    seq.forEach(function (y) {
      var c = counts[y] || 0;
      var bar = document.createElement('div');
      bar.className = 'ybar' + (state.filters.year != null && state.filters.year !== y ? ' dimmed' : '');
      bar.style.height = c ? Math.max(4, Math.round(c / maxCount * 100)) + '%' : '2px';
      if (!c) bar.style.background = 'var(--gridline)';
      bar.setAttribute('aria-label', y + T(' 年 ') + c + T(' 篇'));
      bar.dataset.year = y;
      bar.addEventListener('mouseenter', function () {
        tooltip.textContent = y + T(' 年 · ') + c + T(' 篇');
        tooltip.hidden = false;
        var cardRect = bar.closest('.chart-card').getBoundingClientRect();
        var r = bar.getBoundingClientRect();
        tooltip.style.left = (r.left - cardRect.left + r.width / 2) + 'px';
        tooltip.style.top = (r.top - cardRect.top - 6) + 'px';
      });
      bar.addEventListener('mouseleave', function () { tooltip.hidden = true; });
      bar.addEventListener('click', function () {
        if (state.filters.year === y) {
          state.filters.year = null;
        } else {
          // 柱图统计整个正式库；点击后列表也切到同一范围，避免旧筛选遮住这几篇。
          clearFilters();
          resetActiveFolder();
          state.activeFolderIds = [];
          state.activeSavedSearchId = '';
          state.activeSavedSearchIds = [];
          state.ftEnabled = false;
          ftSearchToken++;
          state.ftHits = {};
          $('#btn-ft').classList.remove('active');
          $('#ft-status').hidden = true;
          state.filters.year = y;
        }
        state.tablePage = 0;
        renderAll();
      });
      body.appendChild(bar);
    });

    // x 轴刻度：首尾年份 + 中间一个
    var axis = document.createElement('div');
    axis.className = 'ybar-x';
    if (!showAll && minY < recentStart) {
      var earlierLabel = document.createElement('span');
      earlierLabel.textContent = T('更早');
      axis.appendChild(earlierLabel);
    }
    var mid = seq[Math.floor(seq.length / 2)];
    seq.forEach(function (y) {
      var s = document.createElement('span');
      if ((y === seq[0] && (showAll || minY >= recentStart)) ||
          y === maxY || (seq.length > 4 && y === mid)) s.textContent = y;
      axis.appendChild(s);
    });
    body.parentNode.appendChild(axis);

    $('#chart-note').textContent = state.filters.year != null
      ? T('已筛选 ') + state.filters.year + T(' 年，点击同一柱取消')
      : T('点击柱子可按年份筛选');
  }

  function renderTagChips() {
    var wrap = $('#tag-chips');
    var freq = tagFrequency();
    var tags = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 12);
    wrap.innerHTML = '';
    $('#tag-list-resize').hidden = tags.length === 0;
    $('#sidebar-tag-panel').classList.toggle('no-tags', tags.length === 0);
    tags.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'chip' + (state.filters.tag === t ? ' active' : '');
      if (state.tagColors[t]) b.style.setProperty('--tag-color', state.tagColors[t]);
      b.textContent = t + ' ' + freq[t];
      b.title = t + ' ' + freq[t];
      b.addEventListener('click', function () {
        state.filters.tag = (state.filters.tag === t) ? '' : t;
        state.tablePage = 0;
        renderAll();
      });
      wrap.appendChild(b);
    });
  }

  var STATUS_LABEL = { unread: T('未读'), reading: T('在读') };
  var STATUS_NEXT = { unread: 'reading', reading: 'unread' };

  function starsHtml(n) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += '<span class="' + (i <= n ? 'on' : 'off') + '">★</span>';
    return '<span class="stars">' + s + '</span>';
  }

  function authorsShort(authors) {
    if (!authors || !authors.length) return '—';
    if (authors.length === 1) return authors[0];
    // 多作者只显示第一作者姓氏 + 等（"Jia, Yikai" → "Jia 等"）
    var family = String(authors[0]).split(',')[0].trim();
    return (family || authors[0]) + T(' 等');
  }

  function attachmentHtml(p) {
    if (p.pdfPath) {
      return T('<span class="attachment-state attachment-local" title="有本地 PDF 附件（双击行打开）" aria-label="有本地 PDF 附件">') + svgUse('lb-i-doc') + '</span>';
    }
    if (p.pdfCloudName) {
      return T('<span class="attachment-state attachment-cloud" title="LitBoard 云端 PDF，尚未下载到本机" aria-label="LitBoard 云端 PDF，尚未下载到本机">') + svgUse('lb-i-file-down') + '</span>';
    }
    if (p.zoteroAttachmentKey) {
      return T('<span class="attachment-state attachment-cloud" title="Zotero 迁移附件，尚未落地到本机" aria-label="Zotero 迁移附件，尚未落地到本机">') + svgUse('lb-i-file-down') + '</span>';
    }
    if (p.pdfFileName) {
      return T('<span class="attachment-state attachment-cloud" title="PDF 附件记录存在，但本机文件缺失" aria-label="PDF 附件记录存在，但本机文件缺失">') + svgUse('lb-i-file-down') + '</span>';
    }
    if (p.oaUrl) {
      return T('<span class="attachment-state attachment-online" title="有在线 PDF 链接" aria-label="有在线 PDF 链接">') + svgUse('lb-i-external') + '</span>';
    }
    return T('<span class="attachment-state attachment-none" title="无 PDF 附件" aria-label="无 PDF 附件">—</span>');
  }

  function journalRankTier(value) {
    var match = String(value || '').match(/[1-4]/);
    return match ? 'rank-' + ({ '1': 'one', '2': 'two', '3': 'three', '4': 'four' })[match[0]] : '';
  }
  function journalRankQuality(paper) {
    var rank = paper && paper.journalRank;
    if (!rank) return -1;
    var tier = journalRankTier(rank.xr);
    var score = { 'rank-one': 40, 'rank-two': 30, 'rank-three': 20, 'rank-four': 10 }[tier] || 0;
    if (rank.beihe) score += 50;
    if (rank.xrTop) score += 100;
    return score + Math.min(Number(rank.imf) || 0, 9.9) / 10;
  }
  function isArxivPaper(paper) {
    if (!paper) return false;
    var doi = String(paper.doi || '').toLowerCase();
    if (doi.indexOf('arxiv') !== -1 || doi.indexOf('10.48550') !== -1) return true;
    if (String(paper.entryType || '').toLowerCase() === 'preprint') return true;
    var venue = String(paper.venue || '').toLowerCase();
    return venue === 'arxiv' || venue.indexOf('arxiv preprint') !== -1 || venue.indexOf('arxiv.org') !== -1;
  }
  function rankXrLabel(value) {
    var s = String(value || '');
    return /^新锐/.test(s) ? s : T('新锐 ') + s;
  }
  function rankXrValue(value) {
    var s = String(value || '');
    return s.replace(/^新锐\s*/, '');
  }
  function journalRankCellHtml(paper) {
    var rank = paper.journalRank;
    if (rank) {
      var chips = [];
      if (rank.beihe) chips.push(T('<span class="rank-chip rank-core" title="北大核心">北核</span>'));
      if (rank.xr) chips.push('<span class="rank-chip ' + journalRankTier(rank.xr) + '">' + esc(rankXrLabel(rank.xr)) + '</span>');
      if (rank.xrTop) chips.push('<span class="rank-chip rank-top">Top</span>');
      if (rank.jcr) chips.push(T('<span class="rank-chip rank-jcr" title="JCR 分区">JCR ') + esc(rank.jcr) + '</span>');
      if (rank.imf != null) chips.push('<span class="rank-chip rank-if">IF ' + esc(rank.imf) + '</span>');
      return chips.length ? chips.join('') : T('<span class="rank-cell-empty" title="已查询过，未有分区数据">—</span>');
    }
    if (isArxivPaper(paper)) {
      return T('<span class="rank-cell-arxiv" title="arXiv 预印本，不属于期刊，无分区数据">预印本</span>');
    }
    var venueKey = String(paper.venue || '').trim().toLowerCase();
    if (!paper.venue) {
      return T('<span class="rank-cell-empty" title="该文献未填写期刊名，补全元数据后会自动查询分区">—<span class="rank-cell-hint">无期刊名</span></span>');
    }
    if (journalRankIsPending(venueKey)) {
      return T('<span class="rank-cell-pending" title="正在查询期刊分区…">…</span>');
    }
    if (shouldRefreshJournalRank(paper)) {
      return T('<span class="rank-cell-empty" title="尚未查询过；切换文件夹后会自动查询">—</span>');
    }
    return T('<span class="rank-cell-empty" title="近 7 天内已查询过，未查找到该期刊分区数据">—</span>');
  }

  /* ---------- 阶段四：结果实体视图（文献/批注/笔记/附件）与命中上下文 ---------- */
  function normHit(value) {
    return window.LitQuery ? window.LitQuery.normalizeForSearch(value) : String(value == null ? '' : value).toLowerCase();
  }
  function highlightHit(value, q) {
    var raw = String(value == null ? '' : value);
    if (!q) return esc(raw);
    var idx = raw.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return esc(raw); // 规范化命中但位置不可映射时退化为不高亮
    return esc(raw.slice(0, idx)) + '<mark>' + esc(raw.slice(idx, idx + q.length)) + '</mark>' + esc(raw.slice(idx + q.length));
  }

  var ENTITY_HIT_PAGE_SIZE = 100;
  var entityHitPage = 0;
  var entityHitPageKey = '';

  function renderEntityHits() {
    var box = $('#entity-hits');
    if (!box) return;
    var qRaw = state.filters.q.trim();
    var view = state.resultView;
    var savedQuery = state.filters.q;
    state.filters.q = '';
    var papers = filteredPapers();
    state.filters.q = savedQuery;
    var scope = view === 'annotations' ? 'annotation' : (view === 'notes' ? 'note' : 'attachment');
    var result = window.LitQuery && window.LitQuery.searchEntities
      ? window.LitQuery.searchEntities(qRaw, { papers: papers, notes: state.notes, folders: state.folders }, { scope: scope })
      : { total: 0, items: [] };
    if (result.error) {
      box.innerHTML = '<p class="field-hint">' + esc(T('搜索语法有误：') + result.error) + '</p>';
      return;
    }
    // M3：ID 索引替代逐项全库 find；切换查询/视图时回到第一页
    var paperById = {};
    papers.forEach(function (item) { paperById[item.id] = item; });
    var pageKey = view + '|' + qRaw;
    if (pageKey !== entityHitPageKey) { entityHitPageKey = pageKey; entityHitPage = 0; }
    var totalPages = Math.max(1, Math.ceil(result.items.length / ENTITY_HIT_PAGE_SIZE));
    entityHitPage = Math.min(entityHitPage, totalPages - 1);
    var q = qRaw && window.LitQuery && window.LitQuery.isPlainText(qRaw) ? normHit(qRaw) : '';
    var rows = result.items.slice(entityHitPage * ENTITY_HIT_PAGE_SIZE, (entityHitPage + 1) * ENTITY_HIT_PAGE_SIZE).map(function (hit) {
      var entity = hit.entity || {};
      var paper = paperById[hit.paperId];
      var paperTitle = paper ? paper.title : T('主题笔记');
      if (scope === 'annotation') return {
        icon: '<span class="pdf-color" style="background:' + esc(entity.color || '#ffd400') + '"></span>',
        title: highlightHit(entity.text || ({ snapshot: T('区域截图'), ink: T('手写笔迹') })[entity.type] || T('批注'), q),
        meta: esc(paperTitle) + T(' · 第 ') + ((entity.position && entity.position.pageIndex || 0) + 1) + T('页') + (entity.comment ? ' · ' + esc(entity.comment.slice(0, 40)) : ''),
        attrs: 'data-hit-paper="' + esc(hit.paperId) + '" data-hit-attachment="' + esc(hit.attachmentId) + '" data-hit-annotation="' + esc(hit.entityId) + '" data-hit-cfi="' + esc((hit.target && hit.target.epubcfi) || '') + '"'
      };
      if (scope === 'note') {
        var snippet = entity.format === 'richtext' && window.LitNoteMl ? window.LitNoteMl.stripTags(entity.content).slice(0, 80) : String(entity.content || '').slice(0, 80);
        return { icon: svgUse('lb-i-note'), title: esc(entity.title || T('（无标题笔记）')),
          meta: esc(paperTitle) + ' · ' + highlightHit(snippet, q), attrs: 'data-hit-note="' + esc(hit.entityId) + '"' };
      }
      var kindLabel = { pdf: 'PDF', epub: 'EPUB', snapshot: T('网页快照'), supp: T('补充材料'), other: T('附件') }[entity.kind] || T('附件');
      return { icon: svgUse('lb-i-paperclip'), title: esc(entity.fileName || T('(未命名)')),
        meta: esc(paperTitle) + ' · ' + kindLabel + (entity.path ? '' : T(' · 未落地')),
        attrs: 'data-hit-paper="' + esc(hit.paperId) + '" data-hit-attachment="' + esc(hit.entityId) + '" data-hit-attach="' + esc(entity.path || '') + '"' };
    });
    var scopeLabel = ({ annotations: T('批注'), notes: T('笔记'), attachments: T('附件') })[view] || '';
    var header = '<div class="entity-hits-head">' + result.total + T(' 条') + scopeLabel +
      (qRaw ? T('（关键词：') + esc(qRaw) + '）' : '');
    if (totalPages > 1) {
      header += T(' · 第 ') + (entityHitPage + 1) + '/' + totalPages + T(' 页') +
        '<span class="entity-hits-pager">' +
        '<button class="btn btn-ghost btn-xs" data-hit-page="prev"' + (entityHitPage === 0 ? ' disabled' : '') + T('>上一页</button>') +
        '<button class="btn btn-ghost btn-xs" data-hit-page="next"' + (entityHitPage >= totalPages - 1 ? ' disabled' : '') + T('>下一页</button>') +
        '</span>';
    }
    header += '</div>';
    if (!rows.length) {
      box.innerHTML = header + T('<p class="field-hint">当前筛选下没有匹配的条目。</p>');
      return;
    }
    box.innerHTML = header + rows.map(function (row) {
      return '<div class="entity-hit-row" ' + row.attrs + ' tabindex="0">' +
        '<span class="entity-hit-icon">' + row.icon + '</span>' +
        '<span class="entity-hit-title">' + row.title + '</span>' +
        '<span class="entity-hit-meta">' + row.meta + '</span></div>';
    }).join('');
  }

  function decorateTableRows(pageItems) {
    var papersById = {};
    pageItems.forEach(function (paper) { papersById[paper.id] = paper; });
    $all('#table-body tr[data-id], #table-body tr.attachment-subrow').forEach(function (row) {
      var paper = papersById[row.dataset.id || row.dataset.parentId];
      if (!paper) return;
      ['attachment', 'title', 'authors', 'year', 'venue', 'rank', 'rating'].forEach(function (key, index) {
        row.cells[index].dataset.column = key;
      });
      var statusCell = row.insertCell(2);
      statusCell.dataset.column = 'status';
      if (row.dataset.id) {
        statusCell.className = 'cell-status';
        statusCell.innerHTML = '<span class="status-dot status-' + esc(paper.status || 'unread') + '"></span>' +
          esc(STATUS_LABEL[paper.status] || paper.status || '—');
        var title = row.querySelector('.t-title');
        var reason = row.querySelector('.search-match-reason');
        if (title) title.title = paper.title + (reason ? '\n' + reason.textContent : '');
        var sub = row.querySelector('.t-sub');
        if (sub) {
          var badge = sub.querySelector('.ft-badge');
          if (badge) row.querySelector('.t-title-row').appendChild(badge);
          if (paper.notes) row.querySelector('.t-title-row').insertAdjacentHTML('beforeend',
            '<span class="row-note-mark" title="' + T('有笔记') + '">' + svgUse('lb-i-note') + '</span>');
          sub.remove();
        }
        if (reason) reason.remove();
      } else {
        statusCell.textContent = '—';
      }
      function addCell(key, value, tooltip) {
        var cell = row.insertCell(-1);
        cell.dataset.column = key;
        cell.className = 'cell-truncate';
        cell.textContent = value || '—';
        if (tooltip) cell.title = tooltip;
      }
      if (row.dataset.id) {
        addCell('tags', (paper.tags || []).join(', '), (paper.tags || []).join(', '));
        addCell('addedAt', paper.addedAt ? new Date(paper.addedAt).toLocaleDateString() : '');
        addCell('updatedAt', paper.updatedAt ? new Date(paper.updatedAt).toLocaleDateString() : '');
        addCell('doi', paper.doi, paper.doi);
      } else {
        ['tags', 'addedAt', 'updatedAt', 'doi'].forEach(function (key) { addCell(key, ''); });
      }
    });
  }

  function renderTable(list) {
    // 阶段四：非文献视图渲染命中列表
    var entityBox = $('#entity-hits');
    if (state.resultView !== 'papers') {
      if (entityBox) entityBox.hidden = false;
      $('#table-wrap').hidden = true;
      renderEntityHits();
      return;
    }
    if (entityBox) entityBox.hidden = true;
    $('#table-wrap').hidden = false;
    list = list || filteredPapers();
    // 分区补查期间冻结当前行顺序：数据更新不会让行立即跳位
    var journalRankFrozen = journalRankFrozenOrder();
    if (journalRankFrozen) {
      var pos = {};
      journalRankFrozen.forEach(function (id, i) { pos[id] = i; });
      var frozen = list.slice().sort(function (a, b) {
        var pa = pos[a.id], pb = pos[b.id];
        if (pa != null && pb != null) return pa - pb;
        if (pa != null) return -1;
        if (pb != null) return 1;
        return 0;
      });
      list = frozen;
    }
    var tbody = $('#table-body');
    var pageCount = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE));
    state.tablePage = Math.max(0, Math.min(state.tablePage, pageCount - 1));
    var start = state.tablePage * TABLE_PAGE_SIZE;
    var pageItems = list.slice(start, start + TABLE_PAGE_SIZE);
    var visibleCount = state.papers.concat(folderImportPreviewPapers).filter(function (p) { return !state.hiddenPurged[p.id]; }).length;
    $('#empty-state').style.display = visibleCount ? 'none' : '';
    // M3：跳过引导后，空库只显示一行简版提示（信息仍在，不再展开四步清单）
    var onboardDismissed = false;
    try { onboardDismissed = localStorage.getItem(ONBOARD_DISMISS_KEY) === '1'; } catch (e) {}
    $('#onboard-steps').hidden = onboardDismissed;
    $('#onboard-actions').hidden = onboardDismissed;
    $('#onboard-short').hidden = !onboardDismissed;
    var folderViewActive = state.activeFolderIds.length > 0 ||
      (!!state.activeFolderId && state.activeFolderId !== 'all');
    $('#table-foot').textContent = visibleCount
      ? T('共 ') + visibleCount + T(' 篇') + (hasActiveFilters() || folderViewActive ? T('，当前显示 ') + list.length + T(' 篇') : '')
      : '';

    $('#table-pagination').hidden = list.length <= TABLE_PAGE_SIZE;
    $('#table-page-info').textContent = list.length ? (start + 1) + '-' + (start + pageItems.length) + ' / ' + list.length : '0 / 0';
    $('#table-page-prev').disabled = state.tablePage === 0;
    $('#table-page-next').disabled = state.tablePage >= pageCount - 1;

    // 排序指示
    var relevanceSorted = !searchSortOverride && !!state.filters.q &&
      (state.ftEnabled || (window.LitQuery && window.LitQuery.isPlainText(state.filters.q)));
    $all('.lit-table th.sortable').forEach(function (th) {
      th.classList.toggle('sorted', !relevanceSorted && th.dataset.sort === state.sort.key);
      th.classList.toggle('desc', !relevanceSorted && th.dataset.sort === state.sort.key && state.sort.dir === -1);
    });

    var rows = [];
    pageItems.forEach(function (p) {
      if (p.folderImportPreview) {
        rows.push('<tr class="lit-row" aria-busy="true"><td class="col-attachment">…</td>' +
          '<td class="col-title"><div class="t-title">' + esc(p.title) + '</div></td>' +
          '<td colspan="5">' + T('正在导入…') + '</td></tr>');
        return;
      }
      var atts = (p.attachments || []);
      var hasAtts = atts.length > 0;
      var isExpanded = !!state.expandedRows[p.id];
      var expandHtml = hasAtts
        ? '<button type="button" class="row-expand-btn' + (isExpanded ? ' expanded' : '') + '" data-act="toggle-expand" data-id="' + p.id + '" title="' + (isExpanded ? T('折叠附件') : T('展开附件')) + '" aria-label="' + (isExpanded ? T('折叠附件') : T('展开附件')) + '"><svg class="ic" aria-hidden="true"><use href="#lb-i-chev-r"/></svg></button>'
        : '<span class="row-expand-spacer" aria-hidden="true"></span>';

      var sub = [];
      if (p.notes) sub.push(svgUse('lb-i-note') + T('有笔记'));
      if (p.oaUrl || p.pdfFileName) sub.push(svgUse('lb-i-doc') + 'PDF');
      var ftHit = state.ftEnabled && state.ftHits[p.id];
      if (ftHit) {
        var shownPages = ftHit.pages.slice(0, 3).map(function (i) { return i + 1; }).join(',');
        var more = ftHit.pages.length > 3 ? '…' : '';
        sub.push(T('<button type="button" class="ft-badge" data-act="ft-open" title="在 PDF 阅读器中打开到命中页">') + svgUse('lb-i-ft') + T('全文 ×') + ftHit.count +
          T('（第 ') + shownPages + T(' 页') + more + '）</button>');
      }
      var searchMatch = plainSearchMatches[p.id];
      var searchMatchHtml = '';
      if (searchMatch && searchMatch.field && searchMatch.field !== 'title' && searchMatch.snippet) {
        var fieldLabels = {
          tags: T('标签'), key: T('引用键'), authors: T('作者'), venue: T('期刊'),
          abstract: T('摘要'), notes: T('笔记')
        };
        searchMatchHtml = '<div class="search-match-reason"><span>' + T('命中') +
          esc(fieldLabels[searchMatch.field] || searchMatch.field) + '：</span>' + esc(searchMatch.snippet) + '</div>';
      }
      var cls = 'lit-row' + (state.selected[p.id] ? ' selected' : '') + (p.id === state.focusId ? ' focused' : '') +
        (p.id === drawerId ? ' detail-active' : '');
      rows.push('<tr class="' + cls.trim() + '" data-id="' + p.id + T('" draggable="true" title="拖动到左侧文件夹可归类">') +
        '<td class="col-attachment">' + attachmentHtml(p) + '</td>' +
        '<td class="col-title"><div class="t-title-row">' + expandHtml + '<div class="t-title">' + esc(p.title) + '</div></div>' +
          searchMatchHtml +
          (sub.length ? '<div class="t-sub">' + sub.join(' · ') + '</div>' : '') + '</td>' +
        '<td class="cell-authors">' + esc(authorsShort(p.authors)) + '</td>' +
        '<td class="num">' + (p.year != null ? p.year : '—') + '</td>' +
        '<td class="col-venue"><div class="t-venue" title="' + esc(p.venue || '') + '">' + esc(p.venue || '—') + '</div></td>' +
        '<td class="cell-rank">' + journalRankCellHtml(p) + '</td>' +
        '<td>' + (p.rating ? starsHtml(p.rating) : '<span class="stars"><span class="off">—</span></span>') + '</td>' +
        '</tr>');

      if (isExpanded && hasAtts) {
        var primary = primaryAttachment(p);
        atts.forEach(function (att) {
          var iconId = att.kind === 'pdf' ? 'lb-i-doc' : (att.kind === 'epub' ? 'lb-i-book' : (att.kind === 'snapshot' ? 'lb-i-camera' : (att.kind === 'supp' ? 'lb-i-paperclip' : 'lb-i-package')));
          var kindLabel = { pdf: T('PDF 文档'), epub: T('EPUB 电子书'), snapshot: T('网页快照'), supp: T('补充材料'), other: T('附件') }[att.kind] || T('附件');
          var attName = att.fileName || (att.path ? att.path.split(/[/\\]/).pop() : '') || kindLabel;
          var badges = [];
          if (primary === att) badges.push(T('<span class="attachment-badge primary">主 PDF</span>'));
          if (!att.path && att.cloudName) badges.push(T('<span class="attachment-badge cloud">云端</span>'));
          else if (!att.path) badges.push(T('<span class="attachment-badge missing">缺文件</span>'));

          var acts = [];
          if (att.path && desktop) {
            acts.push(T('<button type="button" class="btn btn-ghost btn-xs subrow-act-btn" data-subact="open" title="打开此附件">打开</button>'));
            acts.push(T('<button type="button" class="btn btn-ghost btn-xs subrow-act-btn" data-subact="reveal" title="在系统文件管理器中定位">定位</button>'));
          }

          rows.push('<tr class="lit-subrow attachment-subrow" data-parent-id="' + p.id + '" data-att-id="' + att.id + T('" title="双击打开附件">') +
            '<td class="col-attachment"><span class="subrow-tree-glyph" aria-hidden="true">↳</span></td>' +
            '<td class="col-title">' +
              '<div class="attachment-subrow-content">' +
                '<span class="attachment-subrow-icon" aria-hidden="true">' + svgUse(iconId) + '</span>' +
                '<span class="attachment-subrow-name" title="' + esc(att.path || att.fileName || '') + '">' + esc(attName) + '</span>' +
                badges.join('') +
                '<span class="attachment-subrow-actions">' + acts.join('') + '</span>' +
              '</div>' +
            '</td>' +
            '<td class="cell-authors"><span class="subrow-kind">' + esc(kindLabel) + '</span></td>' +
            '<td class="num">—</td>' +
            '<td>—</td>' +
            '<td class="cell-rank">—</td>' +
            '<td>—</td>' +
            '</tr>');
        });
      }
    });
    // 筛选后零结果：空库（无任何文献）仍走 onboard 空态，这里只提示「筛选无命中」
    var filterActive = hasActiveFilters() || (state.activeFolderId && state.activeFolderId !== 'all');
    if (!rows.length && filterActive) {
      rows.push('<tr class="lit-row"><td colspan="' + visibleTableColumns().length + '">' +
        T('<p class="field-hint">当前筛选下没有匹配的条目。</p>') + '</td></tr>');
    }
    tbody.innerHTML = rows.join('');
    decorateTableRows(pageItems);
    applyTableColumns();
    syncCheckAll(list);
  }

  // ---------- 通用对话框（替代原生 confirm / prompt） ----------
  var dialogs = null;
  function initDialogs() {
    if (!window.LitDialogs) return;
    dialogs = window.LitDialogs.create({ $: $, T: T });
  }
  function dlgCancel() { if (dialogs) dialogs.cancel(); }

  /* ---- Zotero 导入向导（js/app/zotero-wizard.js）：适配层 ---- */
  var zoteroWizard = null;
  function initZoteroWizard() {
    if (!window.LitZoteroWizard) return;
    zoteroWizard = window.LitZoteroWizard.create({
      T: T, $: $, $all: $all, esc: esc, toast: toast,
      desktop: function () { return desktop; },
      state: function () { return state; },
      mergeZoteroImport: mergeZoteroImport,
      applySyncedWorkspace: applySyncedWorkspace,
      download: download,
      stamp: stamp
    });
    zoteroWizard.bind();
  }

  /* ---- 远端同步对照（js/app/remote-plan.js）：适配层 ---- */
  var remotePlan = null;
  function initRemotePlan() {
    if (!window.LitRemotePlan) return;
    remotePlan = window.LitRemotePlan.create({
      T: T, $: $, esc: esc, toast: toast, debounce: debounce,
      desktop: function () { return desktop; },
      syncFormValue: syncFormValue,
      workspacePayload: workspacePayload,
      setSyncInlineStatus: setSyncInlineStatus,
      applySyncedWorkspace: applySyncedWorkspace,
      applyPortableConfigRuntime: applyPortableConfigRuntime,
      fillSyncForm: fillSyncForm,
      setSyncIndicator: setSyncIndicator,
      isSyncBusy: function () { return syncBusy; },
      download: download,
      stamp: stamp
    });
    remotePlan.bind();
  }
  function showSyncConflicts(conflicts) { if (remotePlan) remotePlan.showConflicts(conflicts); }
  function showRemotePlan(plan) { if (remotePlan) remotePlan.show(plan); }
  function closeRemotePlanDialog() { if (remotePlan) remotePlan.close(); }
  function handleSyncProgress(payload) { if (remotePlan) remotePlan.handleProgress(payload); }

  /* ---- 期刊分区（js/app/journal-rank.js）：适配层 ---- */
  var journalRank = null;
  function initJournalRank() {
    if (!window.LitJournalRank) return;
    journalRank = window.LitJournalRank.create({
      T: T, $: $, toast: toast, save: save, renderTable: renderTable,
      getById: getById, drawerId: function () { return drawerId; },
      filteredPapers: filteredPapers, state: state,
      desktop: function () { return desktop; },
      isArxivPaper: isArxivPaper,
      tablePageSize: TABLE_PAGE_SIZE,
      model: window.LitModel,
      journalRankTier: journalRankTier, rankXrValue: rankXrValue
    });
    journalRank.bind();
  }
  function renderJournalRank(paper, message) { if (journalRank) journalRank.renderRank(paper, message); }
  function refreshFolderJournalRanks(folderId) { if (journalRank) journalRank.refreshFolder(folderId); }
  function refreshJournalRank(silent) { if (journalRank) journalRank.refresh(silent); }
  function rankResultData(response) { return journalRank ? journalRank.resultData(response) : null; }
  function journalRankSummary(data) { return journalRank ? journalRank.summary(data) : ''; }
  function shouldRefreshJournalRank(paper) { return journalRank ? journalRank.shouldRefresh(paper) : false; }
  function journalRankIsPending(key) { return journalRank ? journalRank.isPending(key) : false; }
  function journalRankFrozenOrder() { return journalRank ? journalRank.frozenOrder() : null; }
  function journalRankClearFrozen() { if (journalRank) journalRank.clearFrozenOrder(); }

  /* ---- 查询构建器 / 批量编辑（js/app/query-builder.js）：适配层 ---- */
  var queryBuilder = null;
  function initQueryBuilder() {
    if (!window.LitQueryBuilder) return;
    queryBuilder = window.LitQueryBuilder.create({
      T: T, $: $, esc: esc, toast: toast, state: state,
      save: save, renderAll: renderAll,
      makeSnapshot: makeSnapshot, commitUndo: commitUndo,
      query: window.LitQuery, model: window.LitModel
    });
  }
  function openBulkEdit(papers) { if (queryBuilder) queryBuilder.openBulkEdit(papers); }

  /* ---- 笔记导出 Word（js/app/note-export.js）：适配层 ---- */
  var noteExport = null;
  function initNoteExport() {
    if (!window.LitNoteExport) return;
    noteExport = window.LitNoteExport.create({
      T: T, toast: toast, desktop: function () { return desktop; },
      state: state, getById: getById, stamp: stamp,
      docxLib: window.LitDocx, csldoc: window.LitCslDoc, csl: window.LitCsl,
      noteml: window.LitNoteMl, excerpt: window.LitExcerpt
    });
  }
  function exportNoteToWord(note) { if (noteExport) noteExport.exportWord(note); }

  /* ---- Word 写作面板（js/app/word-panel.js）：适配层 ---- */
  var wordPanel = null;
  function initWordPanel() {
    if (!window.LitWordPanel) return;
    wordPanel = window.LitWordPanel.create({
      T: T, $: $, toast: toast, dlgPrompt: dlgPrompt, dlgConfirm: dlgConfirm,
      desktop: function () { return desktop; }, state: state, normHit: normHit,
      csl: window.LitCsl, csldoc: window.LitCslDoc, docx: window.LitDocx,
      query: window.LitQuery,
      citeSplitName: window.LitCite && window.LitCite._splitName
    });
    wordPanel.bind();
  }

  /* ---- M1 弹窗栈：所有覆盖层注册进 LitModal（js/modal.js），Esc 只关最顶层。
   * close 一律走对应「取消/关闭」按钮或专用关闭函数，保证与鼠标操作同一状态清理路径。 ---- */
  function setupModalStack() {
    if (!window.LitModal) return;
    var m = window.LitModal;
    [['paste-mask', '#paste-cancel'], ['related-mask', '#related-cancel'], ['add-mask', '#add-cancel'],
      ['edit-mask', '#edit-cancel'], ['cite-mask', '#cite-close'], ['dedupe-mask', '#dedupe-close'],
      ['zotero-import-mask', '#zotero-wiz-cancel'], ['query-builder-mask', '#qb-cancel'],
      ['bulk-edit-mask', '#bulk-edit-cancel'], ['excerpt-mask', '#excerpt-cancel'],
      ['authors-mask', '#authors-close'], ['tags-mask', '#tags-close'], ['shortcuts-mask', '#shortcuts-close'],
      ['bibkey-search-mask', '#bibkey-search-cancel'], ['sync-mask', '#sync-close'],
      ['sync-conflict-mask', '#sync-conflict-close'], ['word-cite-mask', '#word-cite-cancel'],
      ['word-panel-mask', '#word-panel-close'], ['bridge-panel-mask', '#bridge-panel-close'],
      ['graph-mask', '#graph-close'], ['snapshot-mask', '#snapshot-close']
    ].forEach(function (pair) {
      var mask = $('#' + pair[0]);
      var btn = $(pair[1]);
      if (mask && btn) m.watch(mask, function () { btn.click(); });
    });
    // 同步对照弹窗：应用进行中守卫会拒绝关闭，须把栈状态回填
    var remotePlanMask = $('#sync-remote-plan-mask');
    if (remotePlanMask) m.watch(remotePlanMask, function () {
      closeRemotePlanDialog();
      if (!remotePlanMask.hidden) m.sync(remotePlanMask);
    });
    var importMask = $('#import-folder-mask');
    if (importMask) m.watch(importMask, function () { cancelImportFolder(); });
    var dlgMask = $('#dlg-mask');
    if (dlgMask) m.watch(dlgMask, function () { dlgCancel(); });
    // 笔记编辑器：脏守卫关闭；确认保留时把栈状态 sync 回真实可见性
    var noteMask = $('#note-edit-mask');
    if (noteMask) m.watch(noteMask, function () {
      if (window.LitNoteEditor && window.LitNoteEditor.requestClose) {
        window.LitNoteEditor.requestClose().then(function (closed) {
          if (!closed) m.sync(noteMask);
        });
      } else {
        noteMask.hidden = true;
      }
    });
    // 阅读器悬浮层先于阅读器注册即可；栈按显示时序而非注册顺序决定顶层
    var epubPopover = $('#epub-sel-popover');
    if (epubPopover) m.watch(epubPopover, function () { hideEpubSelPopover(); });
    var pdfPopover = $('#pdf-translation-popover');
    if (pdfPopover) m.watch(pdfPopover, function () { hidePdfTranslation(); });
    var epubOverlay = $('#epub-overlay');
    if (epubOverlay) m.watch(epubOverlay, function () { closeEpubViewer(); });
    var pdfOverlay = $('#pdf-overlay');
    if (pdfOverlay) m.watch(pdfOverlay, function () { closePdfViewer(); });
  }

  function dlgConfirm(title, body, okText, danger) { return dialogs.confirm(title, body, okText, danger); }
  function dlgPrompt(title, body, placeholder, value) { return dialogs.prompt(title, body, placeholder, value); }
  function dlgPick(title, body, items) { return dialogs.pick(title, body, items); }

  // ---------- 检索语法速查（主检索与 Word 引文弹窗共用） ----------
  var searchHelp = null;
  function initSearchHelp() {
    if (!window.LitSearchHelp) return;
    searchHelp = window.LitSearchHelp.create({ $: $, T: T, esc: esc, clamp: clamp });
    searchHelp.bind();
  }

  // ---------- 右键快捷菜单 ----------
  var ctxMenuEl = null;
  var ctxSubEl = null;

  function hideCtxSub() {
    if (ctxSubEl) { ctxSubEl.remove(); ctxSubEl = null; }
  }

  function hideCtxMenu() {
    hideCtxSub();
    if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
  }

  function showCtxSub(anchorBtn, children) {
    hideCtxSub();
    var el = document.createElement('div');
    el.className = 'ctx-menu ctx-submenu';

    var listContainer = document.createElement('div');
    listContainer.className = 'ctx-sub-list';

    function renderSubItems(query) {
      listContainer.innerHTML = '';
      var q = String(query || '').trim().toLowerCase();
      var filtered = children.filter(function (child) {
        if (!q) return true;
        var nameMatch = String(child.label || '').toLowerCase().indexOf(q) !== -1;
        var pathMatch = String(child.fullPath || '').toLowerCase().indexOf(q) !== -1;
        return nameMatch || pathMatch;
      });

      if (!filtered.length) {
        var empty = document.createElement('div');
        empty.className = 'ctx-sub-empty';
        empty.textContent = T('未找到匹配的文件夹');
        listContainer.appendChild(empty);
        return;
      }

      filtered.forEach(function (child) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-item' + (child.assigned ? ' is-assigned' : '');

        var titleText = child.assigned
          ? T('已在此文件夹（点击移出）：') + (child.fullPath || child.label)
          : T('加入：') + (child.fullPath || child.label);
        btn.title = titleText;

        if (!q && child.depth != null) {
          btn.style.paddingLeft = (8 + child.depth * 14) + 'px';
        }

        var inner = '';
        if (!q && child.depth > 0) {
          inner += '<span class="ctx-tree-branch" aria-hidden="true">└</span>';
        }
        if (child.icon) {
          inner += svgUse(child.icon);
        }
        inner += '<span class="ctx-folder-name">' + esc(child.label) + '</span>';

        if (q && child.parentPath) {
          inner += '<span class="ctx-folder-subpath" title="' + esc(child.parentPath) + '">' + esc(child.parentPath) + '</span>';
        }

        if (child.assigned) {
          inner += T('<span class="ctx-folder-check" aria-hidden="true" title="已包含选中文献">✓</span>');
        }

        btn.innerHTML = inner;
        btn.addEventListener('click', function () {
          hideCtxMenu();
          child.fn();
        });
        listContainer.appendChild(btn);
      });
    }

    if (children.length >= 6) {
      var searchWrap = document.createElement('div');
      searchWrap.className = 'ctx-search-wrap';
      var searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.className = 'ctx-search-input';
      searchInput.placeholder = T('搜索 ') + children.length + T(' 个文件夹…');
      searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
      searchInput.addEventListener('input', function () {
        renderSubItems(searchInput.value);
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var firstBtn = listContainer.querySelector('.menu-item');
          if (firstBtn) {
            e.preventDefault();
            firstBtn.click();
          }
        } else if (e.key === 'ArrowDown') {
          var firstItem = listContainer.querySelector('.menu-item');
          if (firstItem) {
            e.preventDefault();
            firstItem.focus();
          }
        } else if (e.key === 'Escape') {
          hideCtxMenu();
        }
      });
      searchWrap.appendChild(searchInput);
      el.appendChild(searchWrap);
    }

    el.appendChild(listContainer);
    renderSubItems('');

    document.body.appendChild(el);
    var anchor = anchorBtn.getBoundingClientRect();
    var rect = el.getBoundingClientRect();
    var left = anchor.right - 4;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, anchor.left - rect.width + 4);
    }
    el.style.left = left + 'px';
    el.style.top = clamp(anchor.top, 8, Math.max(8, window.innerHeight - rect.height - 8)) + 'px';
    ctxSubEl = el;
  }

  /** 通用弹出菜单。opts.anchor（元素 rect）= 贴着该元素展开：空间不够时向上弹，
   *  对话面板底部的模型菜单靠它贴在按钮上方（否则会盖住输入框）。 */
  function showCtxMenu(x, y, items, opts) {
    hideCtxMenu();
    var el = document.createElement('div');
    el.id = 'ctx-menu';
    el.className = 'ctx-menu';
    items.forEach(function (item) {
      if (item === 'sep') {
        var sep = document.createElement('hr');
        sep.className = 'menu-sep';
        el.appendChild(sep);
        return;
      }
      if (item.header) {
        var head = document.createElement('div');
        head.className = 'ctx-menu-head';
        head.textContent = item.header;
        head.title = item.header;
        el.appendChild(head);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-item' + (item.danger ? ' danger' : '') + (item.children ? ' has-sub' : '');
      if (item.icon) btn.insertAdjacentHTML('afterbegin', svgUse(item.icon));
      else if (item.dot) {
        var dot = document.createElement('span');
        dot.className = 'ctx-dot ctx-dot-' + item.dot;
        dot.setAttribute('aria-hidden', 'true');
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(item.label));
      if (item.children) {
        var arrow = document.createElement('span');
        arrow.className = 'sub-arrow';
        arrow.textContent = '▸';
        btn.appendChild(arrow);
        btn.addEventListener('mouseenter', function () { showCtxSub(btn, item.children); });
        btn.addEventListener('click', function () {
          if (ctxSubEl) hideCtxSub(); else showCtxSub(btn, item.children);
        });
      } else {
        btn.addEventListener('mouseenter', hideCtxSub);
        btn.addEventListener('click', function () {
          hideCtxMenu();
          item.fn();
        });
      }
      el.appendChild(btn);
    });
    el.style.left = '0px';
    el.style.top = '0px';
    document.body.appendChild(el);
    var rect = el.getBoundingClientRect();
    var anchor = opts && opts.anchor;
    if (anchor) {
      // 贴着锚元素展开：默认在其上方（底部工具条），上方放不下才落到下方
      var above = anchor.top - rect.height - 6;
      if (above < 8) above = Math.min(anchor.bottom + 6, window.innerHeight - rect.height - 8);
      el.style.left = clamp(anchor.left, 8, Math.max(8, window.innerWidth - rect.width - 8)) + 'px';
      el.style.top = clamp(above, 8, Math.max(8, window.innerHeight - rect.height - 8)) + 'px';
      ctxMenuEl = el;
      return;
    }
    el.style.left = clamp(x, 8, Math.max(8, window.innerWidth - rect.width - 8)) + 'px';
    el.style.top = clamp(y, 8, Math.max(8, window.innerHeight - rect.height - 8)) + 'px';
    ctxMenuEl = el;
  }

  function ctxSetStatus(status, papers) {
    papers.forEach(function (p) { p.status = status; });
    save(); renderAll();
    toast(T('✓ 已标记 ') + papers.length + T(' 篇为') + STATUS_LABEL[status]);
  }

  function ctxAddTags(papers) {
    dlgPrompt(T('添加标签'), T('给选中的 ') + papers.length + T(' 篇添加标签（逗号分隔）'), T('如：综述, 机器学习')).then(function (t) {
      if (t == null) return;
      var tags = t.split(/[,，;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!tags.length) return;
      papers.forEach(function (p) {
        var set = {};
        (p.tags || []).forEach(function (x) { set[x] = true; });
        tags.forEach(function (x) { set[x] = true; });
        p.tags = Object.keys(set);
      });
      papers.forEach(function (paper) { paper.tags = window.LitModel.cleanTags(paper.tags); });
      save(); renderAll(); toast(T('✓ 已为 ') + papers.length + T(' 篇加标签'));
    });
  }

  function ctxFolderChildren(papers) {
    var entries = folderTree(true);
    var byId = Object.create(null);
    state.folders.forEach(function (f) { byId[f.id] = f; });

    return entries.map(function (entry) {
      var folder = entry.folder;
      var depth = entry.depth || 0;
      var fullPath = folderPath(folder);
      var parentFolder = folder.parentId ? byId[folder.parentId] : null;
      var parentPath = parentFolder ? folderPath(parentFolder) : '';
      var isAssigned = papers.length > 0 && papers.every(function (p) {
        return (p.folderIds || []).indexOf(folder.id) !== -1;
      });

      return {
        id: folder.id,
        folder: folder,
        depth: depth,
        label: folder.name,
        fullPath: fullPath,
        parentPath: parentPath,
        assigned: isAssigned,
        icon: 'lb-i-folder',
        fn: function () {
          var undoBefore = makeSnapshot({ papers: papers.map(function (p) { return p.id; }) });
          if (isAssigned) {
            papers.forEach(function (paper) {
              paper.folderIds = (paper.folderIds || []).filter(function (id) { return id !== folder.id; });
            });
            commitUndo(T('从文件夹「') + folder.name + T('」移出'), undoBefore, { papers: papers.map(function (p) { return p.id; }) });
            save(); renderAll();
            toast(T('✓ 已将 ') + papers.length + T(' 篇从“') + folder.name + T('”移出'));
          } else {
            papers.forEach(function (paper) {
              if ((paper.folderIds || []).indexOf(folder.id) === -1) {
                paper.folderIds = (paper.folderIds || []).concat([folder.id]);
              }
            });
            commitUndo(T('加入文件夹「') + folder.name + '」', undoBefore, { papers: papers.map(function (p) { return p.id; }) });
            save(); renderAll();
            toast(T('✓ 已将 ') + papers.length + T(' 篇加入“') + folder.name + '”');
          }
        }
      };
    });
  }

  function buildPaperCtxItems(target, papers) {
    var items = [];
    items.push({ header: papers.length > 1
      ? T('已选 ') + papers.length + T(' 篇文献')
      : String(target.title || T('(无标题)')) });
    items.push('sep');
    if (target.deletedAt) {
      items.push({ label: T('恢复'), icon: 'lb-i-undo', fn: function () {
        var n = restorePapers(papers.map(function (p) { return p.id; }));
        state.selected = {}; renderAll(); toast(T('✓ 已恢复 ') + n + T(' 篇'));
      } });
      items.push({ label: T('彻底删除'), icon: 'lb-i-x-circle', danger: true, fn: function () {
        dlgConfirm(T('彻底删除'), T('彻底删除选中的 ') + papers.length + T(' 篇？此操作不可恢复！'), T('彻底删除'), true).then(function (ok) {
          if (!ok) return;
          var n = purgePapers(papers.map(function (p) { return p.id; }));
          toast(T('已彻底删除 ') + n + T(' 篇'));
        });
      } });
      return items;
    }
    items.push({ label: T('打开详情'), icon: 'lb-i-book', fn: function () { openDrawerAndReveal(target.id); } });
    items.push({ label: T('构建引文网络'), icon: 'lb-i-layers', fn: function () { openGraphForPapers(papers); } });
    var hasLocalPdf = papers.some(function (p) {
      var att = primaryAttachment(p);
      return !!(att && att.path);
    });
    if (desktop && hasLocalPdf) {
      if (target.pdfPath) {
        items.push({ label: T('内置阅读器打开'), icon: 'lb-i-book', fn: function () { openPdfViewer(target); } });
        items.push({ label: T('外部程序打开 PDF'), icon: 'lb-i-external', fn: function () {
          desktop.openPath(target.pdfPath).then(function (err) { if (err) toast(T('⚠ 无法打开 PDF：') + err); });
        } });
        items.push({ label: T('打开所在位置'), icon: 'lb-i-folder', fn: function () {
          desktop.revealInFolder(target.pdfPath).then(function (err) { if (err) toast(T('⚠ 无法定位：') + err); });
        } });
      }
      items.push({ label: T('导出 PDF…'), icon: 'lb-i-tray-up', fn: function () { exportPdfs(papers); } });
      items.push({ label: papers.length > 1 ? T('构建全文索引（') + papers.length + T(' 篇）') : T('构建全文索引'),
        icon: 'lb-i-search', fn: function () { ctxBuildFulltextIndex(papers); } });
    }
    items.push('sep');
    items.push({ label: T('标为未读'), dot: 'unread', fn: function () { ctxSetStatus('unread', papers); } });
    items.push({ label: T('标为在读'), dot: 'reading', fn: function () { ctxSetStatus('reading', papers); } });
    items.push('sep');
    items.push({ label: T('添加标签…'), icon: 'lb-i-tag', fn: function () { ctxAddTags(papers); } });
    if (state.folders.length) {
      items.push({ label: T('加入文件夹'), icon: 'lb-i-folder', children: ctxFolderChildren(papers) });
    }
    items.push('sep');
    items.push({ label: T('复制 BibTeX'), icon: 'lb-i-doc', fn: function () {
      copyToClipboard(window.LitBib.paperToBibtex(target)).then(function () { toast(T('✓ BibTeX 已复制')); });
    } });
    items.push({ label: T('生成引用…'), icon: 'lb-i-quote', fn: function () { openCiteModal(target); } });
    items.push({ label: T('编辑…'), icon: 'lb-i-pencil', fn: function () { openEditModal(target); } });
    items.push({ label: T('一键补全'), icon: 'lb-i-sparkle', fn: function () { bulkEnrich(papers); } });
    items.push('sep');
    var linkFolder = currentFolderLinkTarget();
    if (linkFolder) {
      items.push({ label: T('从当前文件夹移出'), icon: 'lb-i-folder', fn: function () {
        dlgConfirm(T('从当前文件夹移出'), T('将选中的 ') + papers.length + T(' 篇从“') + linkFolder.name +
          T('”移出？文献、附件及其它文件夹中的链接都会保留。'), T('移出')).then(function (ok) {
          if (ok) removePapersFromFolder(papers, linkFolder);
        });
      } });
    }
    items.push({ label: linkFolder ? T('移入回收站（所有文件夹）') : T('移入回收站'), icon: 'lb-i-trash', danger: true, fn: function () {
      dlgConfirm(T('移入回收站'), T('删除选中的 ') + papers.length + T(' 篇？可在提示条点「撤销」恢复，也可稍后在回收站找回。'), T('移入回收站')).then(function (ok) {
        if (!ok) return;
        removePapers(papers.map(function (p) { return p.id; }));
      });
    } });
    return items;
  }

  /* 右键「构建全文索引」：对该条目（或多选）的全部 PDF 附件提取正文入库。
   * reindex 只处理缺失/过期的附件（stale 语义），已最新的条目不重复提取。 */
  function ctxBuildFulltextIndex(papers) {
    if (!desktop || !window.LitPdfSearch || !window.LitPdfSearch.reindex) { toast(T('全文索引需要桌面版')); return; }
    var list = (papers || []).filter(function (p) { return p && !p.deletedAt; });
    if (!list.length) { toast(T('没有可索引的文献')); return; }
    toast(list.length > 1 ? T('正在构建 ') + list.length + T(' 篇全文索引…') : T('正在构建全文索引…'));
    window.LitPdfSearch.reindex(list).then(function (result) {
      if (!result || !result.stale) { toast(T('全文索引已是最新')); return; }
      if (result.indexed) toast(T('✓ 已构建 ') + result.indexed + T(' 篇全文索引'));
      else toast(T('⚠ 未能提取 PDF 文本（可能没有文本层）'));
    }).catch(function (err) {
      toast(T('⚠ 构建失败：') + (err && err.message || err));
    });
  }

  function buildAttachmentCtxItems(paper, att) {
    var items = [];
    var name = att.fileName || (att.path ? att.path.split(/[/\\]/).pop() : '') || T('附件');
    items.push({ header: name });
    items.push('sep');
    items.push({ label: T('打开附件'), icon: 'lb-i-external', fn: function () { openAttachment(paper, att); } });
    if (att.path && desktop) {
      items.push({ label: T('打开所在位置'), icon: 'lb-i-folder', fn: function () {
        desktop.revealInFolder(att.path).then(function (err) { if (err) toast(T('⚠ 无法定位：') + err); });
      } });
    }
    var primary = primaryAttachment(paper);
    if (att.kind === 'pdf' && primary !== att) {
      items.push({ label: T('设为主 PDF'), icon: 'lb-i-doc', fn: function () {
        paper.attachments = [att].concat((paper.attachments || []).filter(function (a) { return a !== att; }));
        var norm = window.LitModel.normalizePaper(paper, uid);
        norm.id = paper.id;
        state.papers[state.papers.indexOf(paper)] = norm;
        save(); renderAll();
        toast(T('✓ 已设为主 PDF'));
      } });
    }
    items.push('sep');
    items.push({ label: T('移除附件'), icon: 'lb-i-trash', danger: true, fn: function () {
      dlgConfirm(T('移除附件'), T('从库中移除附件「') + name + T('」？本机文件不会被删除。'), T('移除'), true).then(function (ok) {
        if (!ok) return;
        paper.attachments = (paper.attachments || []).filter(function (a) { return a !== att; });
        var norm = window.LitModel.normalizePaper(paper, uid);
        norm.id = paper.id;
        state.papers[state.papers.indexOf(paper)] = norm;
        save(); renderAll();
        toast(T('✓ 附件已移除'));
      });
    } });
    return items;
  }

  // ---------- 批注写回 / 标准批注导入 ----------
  var autoWriteBack = false;
  var writeBackTimer = null;

  function writeBackPdfAnnotations(paper, attachment, silent) {
    if (typeof attachment === 'boolean') { silent = attachment; attachment = pdfAttachment(paper, ''); }
    if (!desktop || !desktop.writePdf || !window.LitPdf || !window.LitPdf.writeAnnotations) {
      if (!silent) toast(T('写回批注需要桌面版'));
      return Promise.resolve(false);
    }
    if (!paper || !attachment || !attachment.path) {
      if (!silent) toast(T('没有本地 PDF'));
      return Promise.resolve(false);
    }
    var annotations = annotationsForAttachment(paper, attachment);
    return desktop.readFileBytes(attachment.path).then(function (bytes) {
      return window.LitPdf.writeAnnotations(new Uint8Array(bytes), annotations);
    }).then(function (result) {
      if (!result.written) {
        if (!silent) toast(T('所有批注已在 PDF 中（幂等跳过）'));
        return false;
      }
      return desktop.writePdf({ path: attachment.path, bytes: result.bytes }).then(function (writeResult) {
        if (writeResult && writeResult.error) {
          if (!silent) toast(T('⚠ 写回失败：') + writeResult.error);
          return false;
        }
        if (!silent) toast(T('✓ 已写回 ') + result.written + T(' 条批注（原文件已留 .litbak 备份）'));
        return true;
      });
    }).catch(function (e) {
      if (!silent) toast(T('⚠ 写回失败：') + (e && e.message || e));
      return false;
    });
  }

  function scheduleAutoWriteBack() {
    if (!autoWriteBack || !pdfState.paper) return;
    var targetPaper = pdfState.paper;
    var targetAttachment = pdfState.attachment;
    clearTimeout(writeBackTimer);
    writeBackTimer = setTimeout(function () {
      if (targetPaper && targetAttachment) writeBackPdfAnnotations(targetPaper, targetAttachment, true);
    }, 1500);
  }

  /** 打开 PDF 后检测文件内已有的标准批注，提示导入到库 */
  function maybeImportPdfAnnotations(paper, attachment) {
    if (!window.LitPdf || !window.LitPdf.readAnnotations || !paper || !attachment) return;
    window.LitPdf.readAnnotations(attachment.path).then(function (found) {
      if (!found || !found.length) return;
      found = found.map(function (annotation) { return Object.assign({}, annotation, { attachmentId: attachment.id }); });
      var existing = {};
      var existingFp = {};
      annotationsForAttachment(paper, attachment).forEach(function (a) {
        existing[a.id] = true;
        existingFp[window.LitModel.annotationFingerprint(a)] = true;
      });
      // 内容级去重：与库内已有批注同指纹（页+矩形+文本）的 PDF 内嵌批注视为重复
      // （典型来源：Zotero 数据库批注已入库，同一 PDF 又内嵌了一份）
      var fresh = found.filter(function (a) {
        return !existing[a.id] && !existingFp[window.LitModel.annotationFingerprint(a)];
      });
      if (!fresh.length) return;
      toast(T('PDF 里自带 ') + fresh.length + T(' 条批注'), 9000, {
        label: T('导入到库'), fn: function () {
          paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(
            (paper.pdfAnnotations || []).concat(fresh));
          save();
          if (pdfState.paper === paper && pdfState.attachment === attachment) {
            syncViewerAnnotations();
            renderPdfAnnotations();
          }
          toast(T('✓ 已导入 ') + fresh.length + T(' 条批注'));
        }
      });
    }).catch(function () {});
  }

  // ---------- 常驻详情栏 ----------
  var drawerId = null;
  var saveNotes = null;
  var drawerInlineEditing = false;
  var drawerEnriching = false;

  function setDrawerInlineEditControls(editing) {
    var editButton = $('#d-edit');
    editButton.innerHTML = svgUse(editing ? 'lb-i-x' : 'lb-i-pencil') + T(editing ? '取消' : '编辑');
    editButton.title = editing ? T('放弃未保存的修改') : T('编辑字段');
    $('#d-inline-save').hidden = !editing;
  }

  function renderDrawerEditableFields(p) {
    var title = $('#d-title');
    var meta = $('#d-meta');
    var abstract = $('#d-abstract');
    var extract = $('#d-extract');
    if (drawerInlineEditing) {
      title.innerHTML = '<input class="d-title-input" id="d-inline-title" type="text" value="' + esc(p.title || '') + '">';
      var rows = [
        [T('作者：'), 'authors', (p.authors || []).join('; '), T('多位作者以分号分隔')],
        [T('年份：'), 'year', p.year != null ? p.year : '', ''],
        [T('期刊：'), 'venue', p.venue || '', ''],
        ['bibkey: ', 'key', p.key || '', '']
      ];
      meta.innerHTML = rows.map(function (row) {
        var attrs = row[1] === 'year' ? ' inputmode="numeric"' : row[1] === 'key' ? ' spellcheck="false"' : '';
        return '<label class="d-meta-row d-inline-meta"><strong>' + esc(row[0]) + '</strong><input class="d-inline-input" data-inline-field="' +
          row[1] + '" type="text" value="' + esc(row[2]) + '" placeholder="' + esc(row[3]) + '"' + attrs + '></label>';
      }).join('');
      abstract.classList.remove('none');
      abstract.innerHTML = '<textarea class="d-inline-abstract" id="d-inline-abstract" placeholder="' + esc(T('暂无摘要')) + '">' + esc(p.abstract || '') + '</textarea>';
      extract.hidden = true;
      return;
    }
    title.textContent = p.title;
    var metaRows = [
      [T('作者：'), p.authors && p.authors.length ? p.authors.join(', ') : '—'],
      [T('年份：'), p.year != null ? p.year : '—'],
      [T('期刊：'), p.venue || '—'],
      ['bibkey: ', p.key || '—']
    ];
    meta.innerHTML = metaRows.map(function (row) {
      return '<span class="d-meta-row"><strong>' + esc(row[0]) + '</strong>' + esc(row[1]) + '</span>';
    }).join('');
    if (p.abstract) { abstract.textContent = p.abstract; abstract.classList.remove('none'); }
    else { abstract.textContent = T('（无摘要 — 试试「补全」按钮）'); abstract.classList.add('none'); }
    var n = window.LitEnrich.guessSampleSize(p.abstract);
    extract.textContent = n ? T('从摘要识别的样本量（供参考）：n = ') + n : '';
    extract.hidden = false;
  }

  function startDrawerInlineEdit() {
    var p = getById(drawerId);
    if (!p) return;
    drawerInlineEditing = true;
    renderDrawerEditableFields(p);
    setDrawerInlineEditControls(true);
    $('#d-inline-title').focus();
  }

  function cancelDrawerInlineEdit() {
    var p = getById(drawerId);
    drawerInlineEditing = false;
    if (p) renderDrawerEditableFields(p);
    setDrawerInlineEditControls(false);
  }

  function saveDrawerInlineEdit() {
    var p = getById(drawerId);
    if (!p) return;
    var title = $('#d-inline-title').value.trim();
    if (!title) { toast(T('标题不能为空')); $('#d-inline-title').focus(); return; }
    var fields = {};
    $all('[data-inline-field]').forEach(function (input) { fields[input.dataset.inlineField] = input.value; });
    var result = applyPaperEdits(p, {
      title: title,
      authors: parseAuthorInput(fields.authors),
      year: String(fields.year || '').trim() ? parseInt(fields.year, 10) : null,
      venue: String(fields.venue || '').trim(),
      abstract: $('#d-inline-abstract').value
    }, String(fields.key || '').trim());
    if (!result) return;
    drawerInlineEditing = false;
    openDrawer(drawerId);
    toast(T('✓ 已保存'));
    if (result.venueChanged) refreshFolderJournalRanks(state.activeFolderId);
  }

  /** 用户主动打开某条文献（点列表行 / Enter / 右键「打开详情」/ 相关文献链接）：
   * 右栏可能正停在 AI 对话面板，此时必须切回详情页——否则详情写进了隐藏面板，
   * 用户看到的是「点了没反应」。内部的「刷新当前抽屉」调用仍走 openDrawer（不动右栏），
   * 否则撤销、补全、编辑保存这类刷新会把正在对话的用户拽出 AI 面板。 */
  function openDrawerAndReveal(id) {
    if (window.LitAgentUi && window.LitAgentUi.switchPane) window.LitAgentUi.switchPane('detail');
    openDrawer(id);
    organizePaperAttachments(id);
  }

  function openDrawer(id) {
    var p = getById(id);
    if (!p) return;
    drawerId = id;
    drawerInlineEditing = false;
    setDrawerInlineEditControls(false);
    drawerFolderFilter = '';
    $('#drawer').hidden = false;
    $('#detail-empty').hidden = true;

    $('#d-status').value = p.status;
    renderDrawerEditableFields(p);
    renderJournalRank(p);

    var links = [];
    // DOI 以链接形态给出：链接文本就是 DOI 本体（看得见、选得中），点击打开 doi.org 主页
    if (p.doi) links.push('<a href="https://doi.org/' + esc(p.doi) + '" target="_blank" rel="noopener" title="'
      + esc(T('点击打开 doi.org 主页')) + '">DOI ' + esc(p.doi) + '</a>');
    if (p.oaUrl) links.push('<a href="' + esc(p.oaUrl) + T('" target="_blank" rel="noopener">开放获取全文</a>'));
    if (p.url) links.push('<a href="' + esc(p.url) + T('" target="_blank" rel="noopener">原始链接</a>'));
    if (p.openalexId) links.push('<a href="' + esc(p.openalexId) + '" target="_blank" rel="noopener">OpenAlex</a>');
    if (p.pdfPath && desktop) links.push(T('<button type="button" data-act="read-pdf" title="使用 LitBoard 内置阅读器打开">') + svgUse('lb-i-book') + T('内置 PDF 打开</button>'));
    if (p.pdfPath && desktop) links.push(T('<button type="button" data-act="open-pdf" title="使用系统默认 PDF 程序打开">') + svgUse('lb-i-external') + T('外部程序打开</button>'));
    if (p.title) links.push('<a href="https://scholar.google.com/scholar?q=' + encodeURIComponent(p.title) + T('" target="_blank" rel="noopener">Google 学术</a>'));
    $('#d-links').innerHTML = links.join('');

    renderDrawerRating(p.rating);

    $('#d-tags').value = (p.tags || []).join(', ');
    renderFolderAssignments(p);
    renderAttachments(p);
    renderRelated(p);
    $('#d-notes').value = paperNoteContent(p);
    $('#d-notes-saved').textContent = '';
    setNotesMode('edit');
    if (shouldRefreshJournalRank(p)) refreshJournalRank(true);
    // 表格行高亮立即跟随（无需整表重渲染）：行底色（focused/detail-active 类；
    // 旧选中竖条样式已按反馈移除，类保留作键盘导航标记）
    updateFocusUi();
    $all('#table-body tr').forEach(function (tr) {
      tr.classList.toggle('detail-active', tr.dataset.id === drawerId);
    });
  }

  /** 阅读标签切换时，详情内容必须跟随当前文献；不调用 openDrawerAndReveal，
   * 以免用户正在使用 AI / 批注页签时被强制切回详情页。 */
  function syncReadingDrawer(paper) {
    if (!paper || drawerId === paper.id) return;
    openDrawer(paper.id);
  }

  function setNotesMode(mode) {
    var preview = mode === 'preview';
    $('#d-notes').hidden = preview;
    $('#d-notes-preview').hidden = !preview;
    $('#d-notes-edit-tab').classList.toggle('active', !preview);
    $('#d-notes-preview-tab').classList.toggle('active', preview);
    $('#d-notes-edit-tab').setAttribute('aria-selected', String(!preview));
    $('#d-notes-preview-tab').setAttribute('aria-selected', String(preview));
    if (preview) {
      var value = $('#d-notes').value;
      var drawerNote = drawerId ? paperNote(drawerId) : null;
      if (!value.trim()) {
        $('#d-notes-preview').innerHTML = T('<p class="d-abstract none">暂无笔记</p>');
      } else if (drawerNote && drawerNote.format === 'richtext' && window.LitNoteMl) {
        $('#d-notes-preview').innerHTML = window.LitNoteMl.sanitizeHtml(value);
      } else {
        $('#d-notes-preview').innerHTML = window.LitMarkdown.render(value);
      }
    }
  }

  function renderDrawerRating(rating) {
    var html = '';
    for (var i = 1; i <= 5; i++) {
      html += '<span class="' + (i <= rating ? 'on' : 'off') + '" data-star="' + i + '">★</span>';
    }
    $('#d-rating').innerHTML = html;
  }

  function closeDrawer() {
    if (saveNotes && saveNotes.flush) saveNotes.flush();
    drawerId = null;
    $('#drawer').hidden = true;
    $('#detail-empty').hidden = false;
    renderTable();
  }

  // ---------- 导入 ----------
  function currentImportFolderId() {
    return state.activeFolderId !== 'all' && state.activeFolderId !== 'unfiled' &&
      state.folders.some(function (folder) { return folder.id === state.activeFolderId; }) ? state.activeFolderId : '';
  }
  function importFolderLabel(folderId) {
    var folder = state.folders.find(function (item) { return item.id === folderId; });
    return folder ? T('，已归入“') + folderPath(folder) + '”' : '';
  }

  // ---------- 导入目标文件夹选择 ----------
  var pendingImportRun = null;
  var chosenImportFolderId = '';
  var importFolderCollapsed = {};

  function importFolderOptionRow(folderId, name, depth, count) {
    var label = document.createElement('label');
    label.className = 'detail-folder-option';
    label.style.setProperty('--depth', Math.min(depth || 0, 8));
    label.title = name;
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = 'import-folder';
    input.value = folderId;
    input.checked = chosenImportFolderId === folderId;
    var glyphEl = document.createElement('span');
    if (folderId === '') {
      glyphEl.className = 'detail-folder-glyph';
      glyphEl.innerHTML = svgUse('lb-i-inbox');
    } else {
      glyphEl.className = 'detail-folder-glyph';
      glyphEl.innerHTML = svgUse('lb-i-folder');
    }
    var nameEl = document.createElement('span');
    nameEl.className = 'folder-name';
    nameEl.textContent = name;
    label.appendChild(input);
    label.appendChild(glyphEl);
    label.appendChild(nameEl);
    if (count != null) {
      var countEl = document.createElement('span');
      countEl.className = 'folder-count';
      countEl.textContent = count;
      label.appendChild(countEl);
    }
    return label;
  }

  function isImportFolderCollapsed(folderId) {
    if (Object.prototype.hasOwnProperty.call(importFolderCollapsed, folderId)) return importFolderCollapsed[folderId];
    return true; // 导入选择器默认折叠，避免一次全展开
  }

  function ensureImportFolderPathVisible(folderId) {
    var byId = {};
    state.folders.forEach(function (folder) { byId[folder.id] = folder; });
    var current = byId[folderId];
    if (!current) return;
    var guard = 0;
    while (current && current.parentId && guard++ < state.folders.length + 1) {
      importFolderCollapsed[current.parentId] = false;
      current = byId[current.parentId];
    }
  }

  /** 导入目标文件夹树节点：可折叠的多级选择 */
  function importFolderTreeRow(folderId, name, depth, count, collapsed) {
    var row = document.createElement('div');
    row.className = 'detail-folder-tree-row';
    row.style.setProperty('--depth', Math.min(depth || 0, 8));
    row.classList.toggle('collapsed', !!collapsed);
    var children = folderChildren(folderId);
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'detail-folder-toggle' + (children.length ? '' : ' empty');
    toggle.dataset.toggleImportFolder = folderId;
    toggle.disabled = !children.length;
    toggle.setAttribute('aria-label', children.length ? (collapsed ? T('展开') : T('收起')) + ' ' + name : T('无子文件夹'));
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = '▸';
    row.appendChild(toggle);
    var label = importFolderOptionRow(folderId, name, depth, count);
    label.style.paddingLeft = '6px';
    row.appendChild(label);
    return row;
  }

  function appendImportFolderTree(list, parentId, depth) {
    var children = folderChildren(parentId);
    children.forEach(function (folder) {
      var collapsed = isImportFolderCollapsed(folder.id);
      list.appendChild(importFolderTreeRow(folder.id, folder.name, depth, folderPaperCount(folder.id), collapsed));
      if (!collapsed) appendImportFolderTree(list, folder.id, depth + 1);
    });
  }

  function renderImportFolderChooser(defaultFolderId) {
    chosenImportFolderId = defaultFolderId || '';
    var list = $('#import-folder-list');
    if (!list) return;
    var q = String(($('#import-folder-filter').value) || '').trim().toLowerCase();
    list.innerHTML = '';
    var unfiledCount = state.papers.filter(function (p) { return !(p.folderIds || []).length; }).length;
    var entries = folderTree(true);
    if (!q) {
      if (chosenImportFolderId) ensureImportFolderPathVisible(chosenImportFolderId);
      list.appendChild(importFolderOptionRow('', T('未分类'), 0, unfiledCount));
      appendImportFolderTree(list, '', 0);
      return;
    }
    // 命中项连同祖先链一起保留，保证层级上下文可见
    var matched = {};
    entries.forEach(function (entry) {
      var folder = entry.folder;
      if (folder.name.toLowerCase().indexOf(q) === -1 && folderPath(folder).toLowerCase().indexOf(q) === -1) return;
      var current = folder, guard = 0;
      while (current && guard++ < state.folders.length + 1) {
        matched[current.id] = true;
        current = current.parentId ? state.folders.find(function (f) { return f.id === current.parentId; }) : null;
      }
    });
    var hasMatch = false;
    entries.forEach(function (entry) {
      if (!matched[entry.folder.id]) return;
      var row = importFolderOptionRow(entry.folder.id, entry.folder.name, entry.depth, folderPaperCount(entry.folder.id));
      if (entry.folder.name.toLowerCase().indexOf(q) === -1) row.classList.add('folder-filter-context');
      list.appendChild(row);
      hasMatch = true;
    });
    if (!hasMatch) {
      var empty = document.createElement('div');
      empty.className = 'detail-folder-empty';
      empty.textContent = T('没有匹配的文件夹');
      list.appendChild(empty);
    }
  }

  function promptImportFolder(run, defaultFolderId) {
    importFolderCollapsed = {};
    if ($('#import-folder-filter')) $('#import-folder-filter').value = '';
    renderImportFolderChooser(defaultFolderId);
    pendingImportRun = run;
    $('#import-folder-mask').hidden = false;
    var filter = $('#import-folder-filter');
    if (filter) setTimeout(function () { filter.focus(); }, 0);
  }

  function confirmImportFolder() {
    $('#import-folder-mask').hidden = true;
    var run = pendingImportRun;
    pendingImportRun = null;
    if (run) run(chosenImportFolderId);
  }

  function cancelImportFolder() {
    $('#import-folder-mask').hidden = true;
    pendingImportRun = null;
  }
  function paperLocationLabel(folderIds) {
    var paths = (folderIds || []).map(function (id) {
      var folder = state.folders.find(function (item) { return item.id === id; });
      return folder ? folderPath(folder) : '';
    }).filter(Boolean);
    return paths.length ? paths.join('、') : T('未分类');
  }
  function mergedPdfLocationText(matches) {
    var seen = {}, unique = [];
    (matches || []).forEach(function (match) {
      if (!match || seen[match.id]) return;
      seen[match.id] = true;
      unique.push(match);
    });
    if (!unique.length) return '';
    var shown = unique.slice(0, 3).map(function (match) {
      var tag = match.attachedPdf ? T('（已挂 PDF 附件）')
        : (match.reason === 'pdf' ? T('（PDF 内容相同）') : T('（元数据匹配）'));
      return '「' + String(match.title || T('(无标题)')).slice(0, 36) + '」' + tag + T('位于') + paperLocationLabel(match.folderIds);
    });
    return T('；已合并到原条目：') + shown.join('；') + (unique.length > shown.length ? T('；另有 ') + (unique.length - shown.length) + T(' 条') : '');
  }

  var backfillPdfFingerprintsQueue = Promise.resolve();
  function backfillPdfFingerprints(paperIds) {
    if (!desktop || !window.LitPdf.fingerprint) return Promise.resolve();
    var allowed = null;
    if (Array.isArray(paperIds)) {
      allowed = Object.create(null);
      paperIds.forEach(function (id) { if (id) allowed[id] = true; });
    }
    var run = backfillPdfFingerprintsQueue.then(function () {
      var targets = [];
      state.papers.forEach(function (paper) {
        if (paper.deletedAt || allowed && !allowed[paper.id]) return;
        (paper.attachments || []).forEach(function (att) {
          if (att && (att.kind === 'pdf' || att.kind === 'epub') && att.path && !att.fingerprint) {
            targets.push({ paperId: paper.id, attachmentId: att.id, path: att.path });
          }
        });
      });
      var cursor = 0;
      var resolved = [];
      function worker() {
        var target = targets[cursor++];
        if (!target) return Promise.resolve();
        return Promise.race([
          window.LitPdf.fingerprint(target.path),
          new Promise(function (resolve) { setTimeout(function () { resolve(''); }, 10000); })
        ]).then(function (fingerprint) {
          if (/^[a-f0-9]{64}$/i.test(String(fingerprint || ''))) {
            resolved.push(Object.assign({}, target, { fingerprint: String(fingerprint).toLowerCase() }));
          }
        }).catch(function () { /* 文件已移动或缺失时仍可继续导入 */ }).then(worker);
      }
      return Promise.all([worker(), worker(), worker()]).then(function () {
        if (!resolved.length) return;
        var byPaper = Object.create(null), removedIndexes = [], touched = false;
        resolved.forEach(function (result) {
          (byPaper[result.paperId] = byPaper[result.paperId] || []).push(result);
        });
        Object.keys(byPaper).forEach(function (paperId) {
          var paper = getById(paperId);
          if (!paper || paper.deletedAt) return;
          var merged = window.LitPdfImportFlow.applyFingerprints(paper, byPaper[paperId], window.LitDedupe);
          if (!merged.changed) return;
          touched = true;
          var next = Object.assign({}, paper, {
            attachments: merged.attachments,
            pdfAnnotations: remapAnnotationAttachments(paper.pdfAnnotations, merged.aliases).annotations
          });
          window.LitModel.touch(next);
          var normalized = window.LitModel.normalizePaper(next, uid);
          normalized.id = paper.id;
          state.papers[state.papers.indexOf(paper)] = normalized;
          Object.keys(merged.aliases).forEach(function (removedId) {
            if (removedId && removedId !== merged.aliases[removedId]) {
              removedIndexes.push({ paperId: paperId, attachmentId: removedId });
            }
          });
        });
        if (!touched) return;
        return save(true).then(function (saved) {
          if (!saved || !window.LitPdfSearch || !LitPdfSearch.invalidate) return;
          removedIndexes.forEach(function (item) { LitPdfSearch.invalidate(item.paperId, item.attachmentId); });
        });
      });
    });
    backfillPdfFingerprintsQueue = run.catch(function () {});
    return run;
  }
  function restoreJsonWorkspace(workspace) {
    var replacing = workspaceStore.replace(workspace);
    resetActiveFolder();
    closeDrawer();
    renderAll();
    replacing.then(function () {
      toast(T('✓ 已从备份恢复 ') + state.papers.length + T(' 篇文献'));
    }).catch(function (e) {
      toast(T('⚠ 整库恢复失败：') + (e && e.message || e));
    });
  }

  function importBibText(text, folderId) {
    var entries = window.LitBib.parse(text);
    if (!entries.length) { toast(T('没有解析到 BibTeX 条目')); return; }
    var papers = entries.map(window.LitBib.entryToPaper);
    var r = addPapers(papers, { folderId: folderId });
    toast(T('✓ 导入 ') + r.added + T(' 篇') + (r.merged ? T('，匹配已有 ') + r.merged + T(' 篇') : '') + importFolderLabel(folderId));
    renderAll();
  }

  function importRisText(text, folderId) {
    if (!window.LitRis) { toast(T('RIS 解析模块未加载')); return; }
    var papers = window.LitRis.parsePapers(text);
    if (!papers.length) { toast(T('没有解析到 RIS 条目')); return; }
    var r = addPapers(papers, { folderId: folderId });
    toast(T('✓ RIS 导入 ') + r.added + T(' 篇') + (r.merged ? T('，匹配已有 ') + r.merged + T(' 篇') : '') + importFolderLabel(folderId));
    renderAll();
  }

  function importJsonText(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { toast(T('JSON 解析失败')); return; }
    // 1) LitBoard 备份（含 papers 数组）→ 整库恢复
    var workspace = window.LitModel.normalizeWorkspace(data, uid);
    var list = workspace.papers;
    if (list.length) {
      if (!state.papers.length) {
        restoreJsonWorkspace(workspace);
        return;
      }
      dlgConfirm(T('恢复 JSON 备份'), T('恢复 JSON 备份将替换当前 ') + state.papers.length + T(' 篇文献。建议先导出当前数据。是否继续？'), T('替换并恢复'), true).then(function (ok) {
        if (ok) restoreJsonWorkspace(workspace);
      });
      return;
    }
    // 2) CSL-JSON（Zotero / citeproc 生态）→ 追加导入
    if (window.LitCslJson && window.LitCslJson.looksLikeCslJson(data)) {
      var cslPapers = window.LitCslJson.parsePapers(data);
      if (!cslPapers.length) { toast(T('CSL-JSON 中没有可用条目')); return; }
      var r = addPapers(cslPapers, { folderId: currentImportFolderId() });
      toast(T('✓ CSL-JSON 导入 ') + r.added + T(' 篇') + (r.merged ? T('，匹配已有 ') + r.merged + T(' 篇') : ''));
      renderAll();
      return;
    }
    toast(T('JSON 中没有文献数据'));
  }

  /** 把解析出的新 PDF 拷进配置目录/synced-attachments，再交给 addPapers。
   *  已在库中或同批次出现的相同指纹只合并文件夹归属，不再制造第二份受管文件。
   *  4 worker 并发拷贝：各条目只改自己附件对象的 path/fileName，互不依赖；与解析段（3 worker）同量级，不给主进程压队列 */
  function storeImportedPdfFiles(papers, options) {
    if (!desktop || !desktop.storePdf) return Promise.resolve();
    // 复制前先确定最终条目 ID：同 DOI/指纹的不同 PDF 进入同一个物理目录。
    var paperIdByAttachment = window.LitPdfImportFlow.assignItemIds(
      papers, state.papers, window.LitDedupe, uid);
    return window.LitPdfImportFlow.storePdfAttachments(papers, state.papers, function (sourcePath, attachment) {
      if (options && typeof options.isCancelled === 'function' && options.isCancelled()) {
        return { error: T('已停止') };
      }
      return desktop.storePdf({ path: sourcePath, paperId: paperIdByAttachment.get(attachment) });
    }).catch(function (error) {
      throw new Error(T('PDF 复制失败：') + (error && error.message || error));
    });
  }

  /** PDF 导入落库后增量建全文索引：新建/被挂 PDF 的条目交给 reindex（stale 语义，
   *  已最新的附件不重复提取）；与调研侧 importStagedPdfs 的收尾同款，别处导入不建索引 */
  function queueImportedPdfIndex(result) {
    if (!window.LitPdfSearch || !LitPdfSearch.reindex) return;
    var affectedIds = {};
    ((result && result.addedIds) || []).concat(((result && result.matches) || []).map(function (m) { return m.id; }))
      .forEach(function (pid) { affectedIds[pid] = true; });
    var affected = state.papers.filter(function (p) { return affectedIds[p.id]; });
    if (affected.length) LitPdfSearch.reindex(affected, function () {}).catch(function () {});
  }

  function parsePdfEntries(entries, inputOf, assignPaper, options) {
    return window.LitPdfImportFlow.parseMany(entries, function (entry) {
      return window.LitPdf.pdfToPaper(inputOf(entry)).then(function (paper) {
        if (assignPaper) assignPaper(paper, entry);
        return paper;
      });
    }, {
      concurrency: 3,
      timeoutMs: 75000,
      isCancelled: options && options.isCancelled,
      onStart: options && options.onStart,
      onError: function (entry, error) {
        toast('⚠ ' + entry.name + T(' 解析失败：') +
          (error && error.message === 'timeout' ? T('解析超时（可能是网络请求挂起）') : (error && error.message || error)));
      }
    });
  }

  function finishPdfImport(papers, folderId) {
    if (!papers.length) return Promise.resolve(null);
    return storeImportedPdfFiles(papers).then(function () {
      var result = addPapers(papers, { folderId: folderId || '' });
      renderAll();
      return waitForLocalSave().then(function (saved) {
        if (!saved) throw new Error(T('导入结果未能保存到本地'));
        // 指纹回填和全文索引可在导入成功后后台进行，不阻塞下一批目录。
        backfillPdfFingerprints((result.addedIds || []).concat((result.matches || []).map(function (m) { return m.id; }))).then(function () {
          renderAll();
          queueImportedPdfIndex(result);
        }).catch(function () {});
        return result;
      });
    });
  }

  function importPdfFiles(files, folderId) {
    toast(T('正在解析 ') + files.length + T(' 个 PDF…'));
    return parsePdfEntries(files, function (file) { return file; })
      .then(function (papers) { return finishPdfImport(papers, folderId); })
      .then(function (result) {
        if (!result) return;
        toast(T('✓ PDF 导入 ') + result.added + T(' 篇') + (result.merged ? T('，匹配已有 ') + result.merged + T(' 篇') : '') +
          (result.attached ? T('，其中 ') + result.attached + T(' 个 PDF 已挂到原条目') : '') +
          importFolderLabel(folderId) + mergedPdfLocationText(result.matches), result.matches.length ? 7000 : undefined);
        if (desktop && desktop.getScigreatRank) refreshFolderJournalRanks(folderId);
        return result;
      }).catch(function (error) {
        toast('⚠ ' + (error && error.message || error));
        return null;
      });
  }

  /* 目录树导入：PDF 走现有解析/去重，其他文档作为附件条目；原件始终保留。 */
  var folderImportBusy = false;
  var folderImportCancelled = false;
  var folderImportPreviewPapers = [];
  function chooseFolderImport(targetFolderId) {
    if (!desktop || !desktop.chooseDirectory || !desktop.scanFolder) {
      toast(T('导入文件夹需要桌面版'));
      return;
    }
    desktop.chooseDirectory({}).then(function (dirPath) {
      if (dirPath) return importDroppedFolder(dirPath, targetFolderId);
    }).catch(function (error) { toast('⚠ ' + (error && error.message || error)); });
  }
  async function importDroppedFolder(dirPath, targetFolderId) {
    if (!desktop || !desktop.scanFolder || !desktop.storeAttachment) {
      toast(T('导入文件夹需要桌面版'));
      return;
    }
    if (folderImportBusy) { toast(T('已有文件夹正在导入，请稍后再试')); return; }
    folderImportBusy = true;
    folderImportCancelled = false;
    $('#more-stop-folder-import').hidden = false;
    var createdFolderIds = [], persistStarted = false;
    try {
      if (!state.folders.some(function (folder) { return folder.id === targetFolderId; })) targetFolderId = '';
      var scan = await desktop.scanFolder({ path: dirPath });
      if (!scan || scan.error) throw new Error((scan && scan.error) || T('扫描失败'));
      if (folderImportCancelled) { toast(T('已停止导入')); return; }
      var plan = window.LitFolderImport.planFolderImport({
        scan: scan, folders: state.folders, targetFolderId: targetFolderId
      });
      if (!plan.files.length) { toast(T('文件夹中没有可导入的文档')); return; }

      var folderIdByKey = Object.create(null);
      var rootId = plan.root.id || folderUid();
      function nextSortIndex(parentId) {
        return state.folders.filter(function (f) { return (f.parentId || '') === parentId; }).length;
      }
      if (!plan.root.id) {
        state.folders.push({ id: rootId, name: plan.root.name,
          parentId: targetFolderId, sortIndex: nextSortIndex(targetFolderId) });
        createdFolderIds.push(rootId);
      }
      selectFolder(rootId);
      await new Promise(function (resolve) { setTimeout(resolve, 0); });
      for (var folderIndex = 0; folderIndex < plan.createList.length; folderIndex++) {
        var spec = plan.createList[folderIndex];
        var parentId = spec.parentKey ? (plan.reuseMap[spec.parentKey] || folderIdByKey[spec.parentKey]) : rootId;
        var id = folderUid();
        state.folders.push({ id: id, name: spec.name, parentId: parentId, sortIndex: nextSortIndex(parentId) });
        createdFolderIds.push(id);
        folderIdByKey[spec.key] = id;
        if (folderIndex % 8 === 7 || folderIndex === plan.createList.length - 1) {
          renderFolders();
          await new Promise(function (resolve) { setTimeout(resolve, 0); });
        }
      }
      if (folderImportCancelled) {
        state.folders = state.folders.filter(function (folder) { return createdFolderIds.indexOf(folder.id) === -1; });
        renderAll();
        toast(T('已停止导入'));
        return;
      }
      function folderFor(entry) {
        return entry.dirRel ? (plan.reuseMap[entry.dirRel] || folderIdByKey[entry.dirRel] || rootId) : rootId;
      }

      var failures = [], duplicates = [], drafts = [], seenKeys = Object.create(null);
      var attemptedPdfs = 0, attemptedOther = 0;
      var previewTimer = null;
      function showImportPreview(paper) {
        var preview = window.LitModel.normalizePaper(paper, uid);
        preview.folderImportPreview = true;
        folderImportPreviewPapers.push(preview);
        if (!previewTimer) previewTimer = setTimeout(function () {
          previewTimer = null;
          renderAll();
        }, 50);
      }
      var pdfPapers = await parsePdfEntries(plan.pdfs, function (entry) {
        return { name: entry.name, path: entry.abs };
      }, function (paper, entry) { paper.folderIds = [folderFor(entry)]; showImportPreview(paper); }, {
        isCancelled: function () { return folderImportCancelled; },
        onStart: function () { attemptedPdfs++; }
      });
      for (var missing = pdfPapers.length; missing < attemptedPdfs; missing++) failures.push('PDF');
      await storeImportedPdfFiles(pdfPapers);
      for (var i = 0; i < plan.otherFiles.length; i++) {
        if (folderImportCancelled) break;
        attemptedOther++;
        var entry = plan.otherFiles[i];
        var key = entry.sourceKey;
        var existing = key && state.papers.find(function (paper) {
          return !paper.deletedAt && paper.sourceMeta && paper.sourceMeta.folderImportKey === key;
        });
        if (existing || key && seenKeys[key]) {
          duplicates.push({ paper: existing || seenKeys[key], folderId: folderFor(entry) });
          continue;
        }
        var paperId = uid();
        try {
          var stored = await desktop.storeAttachment({ paperId: paperId, path: entry.abs, existing: [] });
          if (!stored || stored.error || !stored.path) {
            stored = await desktop.storeAttachment({ paperId: paperId, path: entry.abs, existing: [] });
          }
          if (!stored || stored.error || !stored.path) throw new Error(stored && stored.error || T('附件复制失败'));
          var paper = { id: paperId, entryType: 'misc',
            title: entry.name.replace(/\.[^.]+$/, '').trim() || entry.name,
            folderIds: [folderFor(entry)],
            sourceMeta: { folderImportKey: key, folderImportSize: entry.size },
            attachments: [{ id: attachmentUid(), kind: window.LitModel.attachmentKindForFile(entry.name) || 'other',
              fileName: entry.name, path: stored.path }] };
          drafts.push(paper);
          showImportPreview(paper);
          if (key) seenKeys[key] = paper;
        } catch (error) { failures.push(entry.rel + ': ' + (error && error.message || error)); }
      }
      duplicates.forEach(function (item) {
        if ((item.paper.folderIds || []).indexOf(item.folderId) === -1) item.paper.folderIds.push(item.folderId);
      });
      folderImportPreviewPapers = [];
      if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
      persistStarted = true;
      var result = pdfPapers.length || drafts.length ? addPapers(pdfPapers.concat(drafts), {}) : null;
      if (!result) save();
      renderAll();
      if (!await waitForLocalSave()) throw new Error(T('导入结果未能保存到本地'));
      selectFolder(rootId);
      var duplicateCount = duplicates.length + (result ? result.merged : 0);
      var importedCount = result ? result.added : 0;
      toast(T('✓ 文件夹导入完成：发现 {found} 个文件；新增 {added} 个、重复 {duplicates} 个、失败 {failed} 个；新建文件夹 {created} 个、复用 {reused} 个', {
        found: plan.files.length, added: importedCount, duplicates: duplicateCount,
        failed: failures.length, created: plan.createdCount, reused: plan.reusedCount
      }) + (folderImportCancelled ? T('；已停止，未处理 {n} 个', { n: plan.files.length - attemptedPdfs - attemptedOther }) : '') +
        (plan.skippedUnsupported ? T('；跳过不支持的文件 {n} 个', { n: plan.skippedUnsupported }) : '') +
        (scan.hiddenSkipped ? T('；跳过隐藏项 {n} 个', { n: scan.hiddenSkipped }) : '') +
        (scan.unreadable && scan.unreadable.length ? T('；无法读取 {n} 项', { n: scan.unreadable.length }) : ''), 9000);
      if (result && pdfPapers.length) {
        backfillPdfFingerprints((result.addedIds || []).concat((result.matches || []).map(function (m) { return m.id; })))
          .then(function () { queueImportedPdfIndex(result); }).catch(function () {});
      }
      if (desktop && desktop.getScigreatRank) refreshFolderJournalRanks(rootId);
      return result;
    } catch (error) {
      if (!persistStarted) {
        state.folders = state.folders.filter(function (folder) { return createdFolderIds.indexOf(folder.id) === -1; });
      }
      toast('⚠ ' + (error && error.message || error));
    } finally {
      if (previewTimer) clearTimeout(previewTimer);
      folderImportPreviewPapers = [];
      renderAll();
      folderImportBusy = false;
      $('#more-stop-folder-import').hidden = true;
    }
  }

  async function importLooseDocuments(files, folderId) {
    if (!desktop || !desktop.storeAttachment) { toast(T('导入文件需要桌面版')); return; }
    var supported = window.LitFolderImport.supportedExtensions;
    var entries = (files || []).filter(function (file) {
      return supported.some(function (ext) { return file.name.toLowerCase().endsWith(ext); });
    });
    if (!entries.length) { toast(T('没有可导入的文档')); return; }
    try {
      var pdfEntries = entries.filter(function (file) { return /\.pdf$/i.test(file.name); });
      var pdfPapers = await parsePdfEntries(pdfEntries, function (entry) { return entry; }, function (paper) {
        paper.folderIds = folderId ? [folderId] : [];
      });
      await storeImportedPdfFiles(pdfPapers);
      var drafts = [], duplicates = [], failures = pdfEntries.length - pdfPapers.length;
      var seen = Object.create(null);
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (/\.pdf$/i.test(entry.name)) continue;
        var key = 'loose:' + entry.name.toLowerCase() + ':' + Number(entry.size || 0);
        var existing = state.papers.find(function (paper) {
          return !paper.deletedAt && paper.sourceMeta && paper.sourceMeta.folderImportKey === key;
        });
        if (existing || seen[key]) { duplicates.push(existing || seen[key]); continue; }
        var paperId = uid();
        try {
          var stored = await desktop.storeAttachment({ paperId: paperId, path: entry.path, existing: [] });
          if (!stored || stored.error || !stored.path) throw new Error(stored && stored.error || T('附件复制失败'));
          var paper = { id: paperId, entryType: 'misc',
            title: entry.name.replace(/\.[^.]+$/, '').trim() || entry.name,
            folderIds: folderId ? [folderId] : [], sourceMeta: { folderImportKey: key },
            attachments: [{ id: attachmentUid(), kind: window.LitModel.attachmentKindForFile(entry.name) || 'other',
              fileName: entry.name, path: stored.path }] };
          drafts.push(paper);
          seen[key] = paper;
        } catch (error) { failures++; }
      }
      duplicates.forEach(function (paper) {
        if (folderId && (paper.folderIds || []).indexOf(folderId) === -1) paper.folderIds.push(folderId);
      });
      var result = pdfPapers.length || drafts.length ? addPapers(pdfPapers.concat(drafts), {}) : null;
      if (!result && duplicates.length) save();
      renderAll();
      if (!await waitForLocalSave()) throw new Error(T('导入结果未能保存到本地'));
      toast(T('✓ 文档导入完成：新增 {added} 个、重复 {duplicates} 个、失败 {failed} 个', {
        added: result ? result.added : 0,
        duplicates: duplicates.length + (result ? result.merged : 0), failed: failures
      }));
      if (result && pdfPapers.length) {
        backfillPdfFingerprints((result.addedIds || []).concat((result.matches || []).map(function (m) { return m.id; })))
          .then(function () { queueImportedPdfIndex(result); }).catch(function () {});
      }
    } catch (error) { toast('⚠ ' + (error && error.message || error)); }
  }

  function handleFiles(fileList, folderId) {
    var files = Array.prototype.slice.call(fileList);
    var pdfs = files.filter(function (f) { return /\.pdf$/i.test(f.name); });
    var bibs = files.filter(function (f) { return /\.(bib|bibtex|txt)$/i.test(f.name); });
    var riss = files.filter(function (f) { return /\.ris$/i.test(f.name); });
    var xmls = files.filter(function (f) { return /\.xml$/i.test(f.name); });
    var jsons = files.filter(function (f) { return /\.json$/i.test(f.name); });
    if (!pdfs.length && !bibs.length && !riss.length && !xmls.length && !jsons.length) {
      toast(T('支持 .bib / .ris / .pdf / .json 文件'));
      return;
    }
    bibs.forEach(function (f) {
      f.text().then(function (text) { importBibText(text, folderId); }).catch(function () { toast(T('⚠ 读取 ') + f.name + T(' 失败')); });
    });
    riss.forEach(function (f) {
      f.text().then(function (text) { importRisText(text, folderId); }).catch(function () { toast(T('⚠ 读取 ') + f.name + T(' 失败')); });
    });
    xmls.forEach(function (f) {
      f.text().then(function (text) {
        if (/<records[\s>]/i.test(text)) toast(T('暂不支持 EndNote XML：请在 EndNote 中「导出为 RIS」后再导入'));
        else toast(T('无法识别的 XML 格式（支持 .bib / .ris / .json / .pdf）'));
      }).catch(function () { toast(T('⚠ 读取 ') + f.name + T(' 失败')); });
    });
    jsons.forEach(function (f) {
      f.text().then(importJsonText).catch(function () { toast(T('⚠ 读取 ') + f.name + T(' 失败')); });
    });
    if (pdfs.length) importPdfFiles(pdfs, folderId);
  }

  function handleDesktopFiles(files, folderId) {
    var pdfs = [];
    files.forEach(function (f) {
      if (f.error) { toast(T('⚠ 读取 ') + f.name + T(' 失败：') + f.error); return; }
      if (f.extension === '.pdf') pdfs.push({ name: f.name, path: f.path });
      else if (f.extension === '.json') importJsonText(f.text || '');
      else if (f.extension === '.ris') importRisText(f.text || '', folderId);
      else if (f.extension === '.xml') {
        if (/<records[\s>]/i.test(f.text || '')) toast(T('暂不支持 EndNote XML：请在 EndNote 中「导出为 RIS」后再导入'));
        else toast(T('无法识别的 XML 格式（支持 .bib / .ris / .json / .pdf）'));
      }
      else if (/^\.(bib|bibtex|txt)$/i.test(f.extension)) importBibText(f.text || '', folderId);
    });
    if (pdfs.length) importPdfFiles(pdfs, folderId);
  }

  // ---------- 补全 ----------
  /* 顶栏「一键补全」是开关式交互（同期刊分区补查）：点一下开始，跑时点一下暂停，
   * 暂停中点一下继续；旁边的 ✕ 按钮随时中断。每篇查过（无论命中与否）都记入
   * 24h 台账（localStorage），所以中断/重启后再点 = 从上次没查过的地方接着来，
   * 不会把刚查过的整批重查一遍；台账里全查过时会询问是否强制重查。
   * 批量菜单对选中条目的补全是显式指令：不做台账跳过（强制重查）。 */
  var enrichLedger = window.LitEnrich.createAttemptLedger({
    get: function () {
      try { return JSON.parse(localStorage.getItem('litboard.enrichAttempts') || '{}'); }
      catch (e) { return null; }
    },
    set: function (map) {
      try { localStorage.setItem('litboard.enrichAttempts', JSON.stringify(map)); } catch (e) { /* 只在内存记账 */ }
    }
  });

  var enrichRun = null; // { ctl:{paused,aborted,wake}, targets, done, ok }

  function setEnrichUi() {
    var btn = $('#btn-enrich');
    var stop = $('#btn-enrich-stop');
    if (!btn) return;
    var icon = btn.querySelector('use');
    var run = enrichRun;
    if (!run) {
      btn.disabled = false;
      setBtnLabel(btn, T('一键补全'));
      btn.title = T('用 OpenAlex、Semantic Scholar、Crossref 补全元数据（跳过近 24h 查过的，从上次进度继续）');
      if (icon) icon.setAttribute('href', '#lb-i-sparkle');
      if (stop) stop.hidden = true;
      return;
    }
    setBtnLabel(btn, (run.ctl.paused ? T('已暂停 ') : T('补全中 ')) + run.done + '/' + run.targets.length);
    btn.title = run.ctl.paused ? T('补全已暂停，点击继续') : T('点击暂停补全');
    if (icon) icon.setAttribute('href', run.ctl.paused ? '#lb-i-play' : '#lb-i-pause');
    if (stop) stop.hidden = false;
  }

  function startEnrichRun(targets, startToastPrefix) {
    enrichRun = { ctl: { paused: false, aborted: false }, targets: targets, done: 0, ok: 0 };
    setEnrichUi();
    if (startToastPrefix) toast(startToastPrefix + targets.length + T(' 篇…（顶栏按钮可暂停，✕ 中断）'));
    var run = enrichRun;
    window.LitEnrich.enrichBatch(targets, function (done, total, paper, patch) {
      enrichLedger.mark(paper.id);
      if (enrichRun !== run) return; // 已被新一轮取代（理论到不了：新一轮前必先置空）
      run.done = done;
      if (patch) { applyPatch(paper, patch); run.ok++; }
      setEnrichUi();
      if (done % 5 === 0 || done === total) { save(); renderAll(); }
    }, run.ctl).then(function () {
      var finished = enrichRun === run ? run : null;
      enrichRun = null;
      setEnrichUi();
      save(); renderAll();
      if (finished) {
        toast(finished.ctl.aborted
          ? T('已中断补全：') + finished.done + '/' + finished.targets.length + T('，命中的 ') + finished.ok + T(' 篇已保留，再点「一键补全」从断点继续')
          : T('✓ 补全完成：') + finished.ok + '/' + finished.targets.length + T(' 篇命中'));
      }
      if (drawerId) openDrawer(drawerId);
    });
  }

  function enrichAll() {
    var run = enrichRun;
    if (run) {
      run.ctl.paused = !run.ctl.paused;
      run.ctl.wake();
      setEnrichUi();
      if (run.ctl.paused) save(); // 暂停瞬间把在飞请求拿到的结果落盘，别随进程丢掉
      toast(run.ctl.paused
        ? T('已暂停补全：') + run.done + '/' + run.targets.length + T('（再点一下继续）')
        : T('继续补全：') + run.done + '/' + run.targets.length);
      return;
    }
    var incomplete = state.papers.filter(function (p) {
      return !p.deletedAt && (p.citations == null || !p.abstract || !p.venue);
    });
    if (!incomplete.length) { toast(T('所有文献信息已完整 ✓')); return; }
    var targets = incomplete.filter(function (p) { return !enrichLedger.isRecent(p.id); });
    if (!targets.length) {
      dlgConfirm(T('重新补全'), T('这 ') + incomplete.length + T(' 篇在近 24 小时内都尝试过联网补全（未全部命中）。要忽略记录、强制重新查询吗？'), T('强制重查')).then(function (yes) {
        if (!yes || enrichRun) return; // 等待确认期间可能已开了别的补全任务
        incomplete.forEach(function (p) { enrichLedger.clear(p.id); });
        startEnrichRun(incomplete);
      });
      return;
    }
    startEnrichRun(targets);
  }

  function abortEnrich() {
    var run = enrichRun;
    if (!run) return;
    run.ctl.aborted = true;
    run.ctl.paused = false;
    run.ctl.wake();
  }

  /* 补全结果只能写投影字段（year / authors），权威的 date / creators 靠整体重规范化补齐：
   * saveState 入库前会 normalizeWorkspace，只写投影会让「库内签名」与渲染层按内存算的签名不等，
   * 写入后校验必失败（同 F03）。故照 addPapers：补完 touch + normalizePaper，再放回集合。
   * 返回重规范化后的实体（调用方持有的旧引用已脱离 state，勿继续使用）。 */
  function applyPatch(paper, patch) {
    var changed = false;
    if (patch.citations != null) {
      paper.citations = patch.citations;
      paper.citationSource = patch.source || '';
      paper.citationUpdatedAt = patch.enrichedAt || new Date().toISOString();
      changed = true;
    }
    if (patch.abstract && !paper.abstract) { paper.abstract = patch.abstract; changed = true; }
    if (patch.venue && !paper.venue) { paper.venue = patch.venue; changed = true; }
    if (patch.year != null && paper.year == null) { paper.year = patch.year; changed = true; }
    if (patch.doi && !paper.doi) { paper.doi = patch.doi; changed = true; }
    if (patch.volume && !paper.volume) { paper.volume = patch.volume; changed = true; }
    if (patch.issue && !paper.issue) { paper.issue = patch.issue; changed = true; }
    if (patch.pages && !paper.pages) { paper.pages = patch.pages; changed = true; }
    if (patch.publisher && !paper.publisher) { paper.publisher = patch.publisher; changed = true; }
    if (patch.issn && !paper.issn) { paper.issn = patch.issn; changed = true; }
    if (patch.isbn && !paper.isbn) { paper.isbn = patch.isbn; changed = true; }
    if (patch.oaUrl) { paper.oaUrl = patch.oaUrl; changed = true; }
    if (patch.openalexId) { paper.openalexId = patch.openalexId; changed = true; }
    if (patch.authorsFromApi && (!paper.authors || !paper.authors.length)) {
      paper.authors = patch.authorsFromApi; changed = true;
    }
    if (!changed) return paper;
    window.LitModel.touch(paper);
    var norm = window.LitModel.normalizePaper(paper, uid);
    norm.id = paper.id;
    var index = state.papers.indexOf(paper);
    if (index !== -1) state.papers[index] = norm;
    return norm;
  }

  // ---------- 导出 ----------
  function download(name, content, mime) {
    if (desktop) {
      var ext = name.split('.').pop().toUpperCase();
      desktop.saveFile({ name: name, content: content, filters: [{ name: ext + T(' 文件'), extensions: [name.split('.').pop()] }] })
        .then(function (saved) { if (saved) toast(T('✓ 已导出 ') + name); })
        .catch(function (e) { toast(T('⚠ 导出失败：') + (e && e.message || e)); });
      return;
    }
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + '' + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function exportJson() {
    var livePapers = state.papers.filter(function (p) { return !p.deletedAt; });
    download('litboard-' + stamp() + '.json', JSON.stringify({
      exportedAt: new Date().toISOString(), papers: livePapers, notes: state.notes.filter(function (n) { return !n.deletedAt; }),
      folders: state.folders, savedSearches: state.savedSearches, tagColors: state.tagColors
    }, null, 2), 'application/json');
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    var head = [T('标题'), T('作者'), T('年份'), T('期刊/会议'), 'DOI', T('被引'), T('被引来源'), T('状态'), T('评分'), T('标签'), T('笔记'), T('摘要')];
    var rows = state.papers.filter(function (p) { return !p.deletedAt; }).map(function (p) {
      return [p.title, (p.authors || []).join('; '), p.year, p.venue, p.doi, p.citations,
        p.citationSource, STATUS_LABEL[p.status], p.rating, (p.tags || []).join('; '), p.notes, p.abstract].map(csvCell).join(',');
    });
    download('litboard-' + stamp() + '.csv', '﻿' + head.join(',') + '\n' + rows.join('\n'), 'text/csv;charset=utf-8');
  }

  function exportBib() {
    var out = state.papers.filter(function (p) { return !p.deletedAt; }).map(window.LitBib.paperToBibtex).join('\n\n');
    var name = 'litboard-' + stamp() + '.bib';
    if (!desktop || !desktop.saveFile) { download(name, out); return; }
    desktop.saveFile({
      name: name,
      bytes: new TextEncoder().encode(out),
      filters: [{ name: T('BibTeX 文件'), extensions: ['bib'] }]
    }).catch(function (error) {
      toast(T('⚠ BibTeX 导出失败：') + (error && error.message || error));
    });
  }

  function exportRis() {
    var livePapers = state.papers.filter(function (p) { return !p.deletedAt; });
    if (!livePapers.length) { toast(T('文献库为空')); return; }
    download('litboard-' + stamp() + '.ris', window.LitCite.ris(livePapers), 'application/x-research-info-systems');
  }

  function exportCslJson() {
    var livePapers = state.papers.filter(function (p) { return !p.deletedAt; });
    if (!livePapers.length) { toast(T('文献库为空')); return; }
    if (!window.LitCslJson || !window.LitCslJson.exportCslJson) { toast(T('CSL-JSON 导出模块未加载')); return; }
    download('litboard-' + stamp() + '.csl.json', JSON.stringify(window.LitCslJson.exportCslJson(livePapers), null, 2), 'application/json');
  }

  /** 导出 Word（.docx）：每篇文献一个可刷新引文域（复杂域 + LitBoard.Citation.1 payload）+ 参考文献表 */
  function exportDocx() {
    if (!window.LitDocx || !window.LitCslDoc) { toast(T('Word 导出模块未加载')); return; }
    if (!desktop) { toast(T('导出 Word 需要桌面版')); return; }
    var livePapers = state.papers.filter(function (p) { return !p.deletedAt; });
    if (!livePapers.length) { toast(T('文献库为空')); return; }
    var styleId = localStorage.getItem('litboard.cslStyle') || 'apa';
    var isBuiltin = window.LitCsl.BUILTIN_STYLES.some(function (s) { return s.id === styleId; });
    var stylePromise = isBuiltin
      ? fetch('vendor/citeproc/styles/' + styleId + '.csl').then(function (r) {
          if (!r.ok) throw new Error(T('样式文件缺失'));
          return r.text();
        })
      : desktop.fetchCslStyle(styleId);
    Promise.all([
      stylePromise,
      fetch('vendor/citeproc/locales/zh-CN.xml').then(function (r) { return r.text(); })
    ]).then(function (texts) {
      var doc = window.LitCslDoc.createDocument({ styleXml: texts[0], localeXml: texts[1], styleId: styleId, localeId: 'zh-CN' });
      return doc.updateLibrary(livePapers).then(function () {
        var chain = Promise.resolve();
        livePapers.forEach(function (paper) {
          chain = chain.then(function () { return doc.addCitation({ items: [{ paperId: paper.id }] }); });
        });
        return chain.then(function () {
          var clusters = doc.toJSON().citations;
          var paragraphs = livePapers.map(function (paper, index) {
            return { runs: [{ citation: {
              payload: clusters[index],
              runs: window.LitCsl.htmlToRuns(doc.getCitationText(clusters[index].id))
            } }] };
          });
          paragraphs.push({ runs: [{ text: T('参考文献'), bold: true }] });
          // 引文文本是 citeproc 的 HTML：交给 htmlToRuns 转成带真格式的 run（否则 <sup> 会被印出来）；
          // 条目再套上按 CSL 样式算出的段落格式（悬挂缩进 + 编号制表位）
          var bibFormat = doc.getBibliographyFormat();
          doc.getBibliography().forEach(function (entry) {
            paragraphs.push(Object.assign({ runs: window.LitCsl.htmlToRuns(entry) }, bibFormat));
          });
          return window.LitDocx.buildDocx(paragraphs);
        });
      });
    }).then(function (bytes) {
      return desktop.saveFile({
        name: 'litboard-' + stamp() + '.docx',
        bytes: bytes,
        filters: [{ name: T('Word 文档'), extensions: ['docx'] }]
      });
    }).then(function (saved) {
      if (saved) toast(T('✓ 已导出 Word 文档（含 ') + livePapers.length + T(' 个可刷新引文域）'));
    }).catch(function (error) {
      toast(T('⚠ Word 导出失败：') + (error && error.message || error));
    });
  }

  /** 批量导出选中条目的本地主 PDF 到指定目录（按重命名模板生成文件名，重名自动加后缀） */
  function exportPdfs(papers) {
    if (!desktop || !desktop.exportPdfs || !desktop.chooseDirectory) { toast(T('导出 PDF 需要桌面版')); return; }
    var targets = papers.filter(function (p) {
      var att = primaryAttachment(p);
      return !!(att && att.path && /\.pdf$/i.test(att.path));
    });
    if (!targets.length) { toast(T('所选条目没有本地 PDF 附件')); return; }
    var template = (window.LitRename && window.LitRename.DEFAULT_TEMPLATE) || '{author} - {year} - {title}';
    desktop.chooseDirectory({ title: T('选择导出 PDF 的文件夹') }).then(function (dir) {
      if (!dir) return;
      var files = targets.map(function (p) {
        var att = primaryAttachment(p);
        var base = window.LitRename ? window.LitRename.buildName(p, template) : (p.key || p.title || 'paper');
        return { path: att.path, name: base };
      });
      return desktop.exportPdfs({ dir: dir, files: files }).then(function (result) {
        if (result && result.error) { toast(T('⚠ 导出失败：') + result.error); return; }
        var copied = (result && result.copied) || [];
        var failed = (result && result.failed) || [];
        var msg = T('✓ 已导出 ') + copied.length + T(' 个 PDF 到 ') + dir;
        if (failed.length) msg += '，' + failed.length + T(' 个失败');
        toast(msg, 6000, { label: T('打开文件夹'), fn: function () { desktop.openPath(dir); } });
      });
    }).catch(function (e) { toast(T('⚠ 导出失败：') + (e && e.message || e)); });
  }

  // ---------- 快速添加（DOI / arXiv / 标题）----------
  function extractDoi(s) {
    var m = String(s).match(/\b(10\.\d{4,9}\/[^\s"'<>]+)/);
    return m ? m[1].replace(/[).,;\]]+$/, '') : '';
  }
  function arxivId(s) {
    var m = String(s).trim().match(/^(?:arxiv:)?\s*(\d{4}\.\d{4,5})(?:v\d+)?$/i);
    return m ? m[1] : '';
  }
  function isbnId(s) {
    var m = String(s).trim().match(/^(?:isbn[:\s]*)?([0-9][0-9\- ]{8,18}[0-9xX])$/i);
    if (!m) return '';
    var id = m[1].replace(/[-\s]/g, '');
    return /^\d{9}[\dXx]$/.test(id) || /^97[89]\d{10}$/.test(id) ? id : '';
  }
  function pmidId(s) {
    var t = String(s).trim();
    var m = t.match(/^pmid[:\s]*(\d{1,9})$/i);
    if (m) return m[1];
    return /^\d{7,9}$/.test(t) ? t : '';
  }
  function patchToPaper(patch, doiHint) {
    return {
      title: patch.titleFromApi || T('(未命名)'),
      authors: patch.authorsFromApi || [],
      year: patch.year != null ? patch.year : null,
      venue: patch.venue || '',
      volume: patch.volume || '',
      issue: patch.issue || '',
      pages: patch.pages || '',
      publisher: patch.publisher || '',
      issn: patch.issn || '',
      isbn: patch.isbn || '',
      doi: patch.doi || doiHint || '',
      url: patch.url || '',
      abstract: patch.abstract || '',
      citations: patch.citations != null ? patch.citations : null,
      citationSource: patch.source || '',
      oaUrl: patch.oaUrl || '',
      openalexId: patch.openalexId || ''
    };
  }
  function quickAdd(raw) {
    var input = String(raw || '').trim();
    var statusEl = $('#add-status');
    if (!input) { statusEl.textContent = T('请输入 DOI、arXiv 编号、PMID、ISBN 或标题。'); return; }
    var fetchBtn = $('#add-fetch');
    if (fetchBtn) fetchBtn.disabled = true;      // 抓取期间禁连点，避免重复请求
    statusEl.textContent = T('正在联网抓取…');
    var doi = extractDoi(input);
    var ax = arxivId(input);
    var isbn = isbnId(input);
    var pmid = isbn ? '' : pmidId(input);
    var lookup;
    if (doi) lookup = window.LitEnrich.byDoi(doi);
    else if (ax) lookup = window.LitEnrich.byDoi('10.48550/arXiv.' + ax).then(function (p) {
      return p || window.LitEnrich.byTitle(input);
    });
    else if (isbn) lookup = window.LitEnrich.byIsbn(isbn);
    else if (pmid) lookup = window.LitEnrich.byPmid(pmid);
    else lookup = window.LitEnrich.byTitle(input);
    lookup.then(function (patch) {
      if (!patch) { statusEl.textContent = T('未找到，可改为手动录入，或核对 DOI / 标题。'); return; }
      var base = patchToPaper(patch, doi || (ax ? '10.48550/arXiv.' + ax : ''));
      var r = addPapers([base]);
      $('#add-mask').hidden = true;
      $('#add-id').value = '';
      statusEl.textContent = '';
      toast(r.added ? T('✓ 已添加：') + String(base.title).slice(0, 40) : T('与已有文献重复，已合并元数据'));
      renderAll();
    }).catch(function (err) {
      statusEl.textContent = T('⚠ 抓取失败：') + (err && err.message || T('网络错误'));
    }).finally(function () {
      if (fetchBtn) fetchBtn.disabled = false;
    });
  }

  // ---------- 新建 / 编辑 ----------
  var editingId = null;
  function openEditModal(paper) {
    editingId = paper ? paper.id : null;
    $('#edit-head').textContent = paper ? T('编辑文献') : T('新建文献');
    var p = paper || {};
    $('#e-title').value = p.title || '';
    $('#e-authors').value = (p.authors || []).join('; ');
    $('#e-year').value = p.year != null ? p.year : '';
    $('#e-type').value = p.entryType || 'article';
    $('#e-venue').value = p.venue || '';
    $('#e-volume').value = p.volume || '';
    $('#e-issue').value = p.issue || '';
    $('#e-pages').value = p.pages || '';
    $('#e-language').value = p.language || '';
    $('#e-publisher').value = p.publisher || '';
    $('#e-issn').value = p.issn || '';
    $('#e-isbn').value = p.isbn || '';
    $('#e-doi').value = p.doi || '';
    $('#e-url').value = p.url || '';
    $('#e-citekey').value = p.key || '';
    $('#e-abstract').value = p.abstract || '';
    $('#edit-mask').hidden = false;
    $('#e-title').focus();
  }
  function parseAuthorInput(val) {
    var s = String(val || '').trim();
    if (!s) return [];
    if (/[;\n；]/.test(s)) {
      return s.split(/[;\n；]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    }
    return [s];
  }
  function saveEditModal() {
    var citekey = $('#e-citekey').value.trim();
    var data = {
      title: $('#e-title').value.trim(),
      authors: parseAuthorInput($('#e-authors').value),
      year: $('#e-year').value.trim() ? parseInt($('#e-year').value, 10) : null,
      entryType: $('#e-type').value || 'article',
      venue: $('#e-venue').value.trim(),
      volume: $('#e-volume').value.trim(),
      issue: $('#e-issue').value.trim(),
      pages: $('#e-pages').value.trim(),
      language: $('#e-language').value.trim(),
      publisher: $('#e-publisher').value.trim(),
      issn: $('#e-issn').value.trim(),
      isbn: $('#e-isbn').value.trim(),
      doi: $('#e-doi').value.trim(),
      url: $('#e-url').value.trim(),
      abstract: $('#e-abstract').value
    };
    if (!data.title) { toast(T('标题不能为空')); return; }
    if (editingId) {
      var p = getById(editingId); if (!p) { $('#edit-mask').hidden = true; return; }
      var result = applyPaperEdits(p, data, citekey);
      if (!result) return;
      $('#edit-mask').hidden = true;
      if (drawerId === editingId) openDrawer(editingId);
      toast(T('✓ 已保存'));
      if (result.venueChanged) refreshFolderJournalRanks(state.activeFolderId);
    } else {
      if (citekey) { data.key = citekey; data.keyPinned = true; }
      var r = addPapers([data]);
      $('#edit-mask').hidden = true;
      toast(r.added ? T('✓ 已新建文献') : T('与已有文献重复，已合并'));
      renderAll();
    }
  }

  /** 编辑弹窗与详情区原位编辑共用这一条保存路径，防止 creators/date 投影或 citekey
   * 冲突校验在两处漂移。data 只需携带本次实际可编辑的字段。 */
  function applyPaperEdits(p, data, citekey) {
    // 先检查冲突，避免被拒绝的保存把未规范化草稿留在内存对象上。
    if (citekey && citekey !== p.key) {
      var conflict = state.papers.some(function (other) {
        return other.id !== p.id && String(other.key || '').toLowerCase() === citekey.toLowerCase();
      });
      if (conflict) { toast('citekey「' + citekey + T('」已被其他文献使用')); return null; }
    }
    var undoBefore = makeSnapshot({ papers: [p.id] });
    var venueBefore = String(p.venue || '').trim().toLowerCase();
    var hasAuthors = Object.prototype.hasOwnProperty.call(data, 'authors');
    var hasYear = Object.prototype.hasOwnProperty.call(data, 'year');
    var authorsBefore = JSON.stringify(p.authors || []);
    var yearBefore = p.year != null ? p.year : null;
    Object.keys(data).forEach(function (k) { p[k] = data[k]; });
    // creators/date 是权威字段，authors/year 是投影：改投影时同步权威字段，避免 normalize 还原旧值。
    if (hasAuthors && JSON.stringify(data.authors) !== authorsBefore) {
      var preservedCreators = (p.creators || []).filter(function (c) { return c && c.creatorType !== 'author'; });
      var authorCreators = data.authors.map(function (a) {
        var c = window.LitModel.parseCreatorName(a);
        if (c) c.creatorType = 'author';
        return c;
      }).filter(Boolean);
      p.creators = preservedCreators.concat(authorCreators);
    }
    if (hasYear && data.year !== yearBefore) p.date = data.year != null ? String(data.year) : '';
    var venueChanged = venueBefore !== String(p.venue || '').trim().toLowerCase();
    if (venueChanged) {
      p.journalRank = null;
      p.journalRankCheckedAt = 0;
    }
    // citekey 被修改则钉住（防止自动重排）；与库内他人冲突时拒绝。
    if (citekey && citekey !== p.key) {
      p.key = citekey;
      p.keyPinned = true;
    } else if (!citekey) {
      p.key = '';
      p.keyPinned = false;
    }
    var norm = window.LitModel.normalizePaper(p, uid);
    norm.id = p.id;
    var idx = state.papers.indexOf(p);
    if (idx !== -1) state.papers[idx] = norm;
    commitUndo(T('编辑字段'), undoBefore, { papers: [p.id] });
    save(); renderAll();
    organizePaperAttachments(p.id);
    return { venueChanged: venueChanged };
  }

  // ---------- 引用生成 ----------
  var citePaperId = null;

  function stripHtml(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
  }

  function renderCslCitation(styleIdOrXml) {
    var paper = getById(citePaperId);
    var out = $('#cite-csl-output');
    if (!paper || !window.LitCsl) return;
    out.textContent = T('渲染中…');
    var isCustomXml = styleIdOrXml.indexOf('<') !== -1;
    var locale = paper.language === 'en' ? 'en-US' : 'zh-CN';
    var localeFile = 'vendor/citeproc/locales/' + locale + '.xml';
    var stylePromise = isCustomXml
      ? Promise.resolve(styleIdOrXml)
      : fetch('vendor/citeproc/styles/' + styleIdOrXml + '.csl').then(function (r) {
        if (!r.ok) throw new Error(T('样式文件缺失'));
        return r.text();
      });
    Promise.all([stylePromise, fetch(localeFile).then(function (r) { return r.text(); })])
      .then(function (texts) {
        return window.LitCsl.renderBibliography([paper], texts[0], texts[1]);
      }).then(function (htmlList) {
        out.innerHTML = htmlList[0] || T('（无输出）');
      }).catch(function (error) {
        out.textContent = T('CSL 渲染失败：') + (error && error.message || error);
      });
  }

  function openCiteModal(paper) {
    citePaperId = paper.id;
    var wrap = $('#cite-list');
    wrap.innerHTML = '';
    var loading = document.createElement('div');
    loading.className = 'cite-item';
    loading.textContent = T('渲染中…');
    wrap.appendChild(loading);
    // 样式渲染走 citeproc（异步）：单样式失败只影响该条目，其余照常
    Promise.allSettled(window.LitCite.formats.map(function (fmt) {
      return window.LitCite.renderFormat(fmt.styleId, paper);
    })).then(function (results) {
      if (citePaperId !== paper.id) return; // 等待期间已改开别的文献
      wrap.innerHTML = '';
      window.LitCite.formats.forEach(function (fmt, i) {
        var res = results[i];
        var ok = res.status === 'fulfilled';
        var text = ok ? res.value : '';
        var item = document.createElement('div');
        item.className = 'cite-item';
        var head = document.createElement('div');
        head.className = 'cite-item-head';
        var label = document.createElement('span');
        label.className = 'cite-item-label';
        label.textContent = fmt.label;
        head.appendChild(label);
        if (ok) {
          var copy = document.createElement('button');
          copy.className = 'cite-copy';
          copy.textContent = T('复制');
          copy.addEventListener('click', function () {
            copyToClipboard(text).then(function () { toast(T('✓ 已复制 ') + fmt.label); });
          });
          head.appendChild(copy);
        }
        var body = document.createElement('div');
        body.className = 'cite-text';
        body.textContent = ok ? (text || T('（无输出）'))
          : T('CSL 渲染失败：') + (res.reason && res.reason.message || res.reason);
        item.appendChild(head); item.appendChild(body);
        wrap.appendChild(item);
      });
    });
    // CSL 样式区
    var select = $('#cite-csl-style');
    if (!select.options.length && window.LitCsl) {
      window.LitCsl.BUILTIN_STYLES.forEach(function (style) {
        var opt = document.createElement('option');
        opt.value = style.id;
        opt.textContent = style.label;
        select.appendChild(opt);
      });
      var saved = null;
      try { saved = localStorage.getItem('litboard.cslStyle'); } catch (e) {}
      if (saved && window.LitCsl.BUILTIN_STYLES.some(function (s) { return s.id === saved; })) select.value = saved;
    }
    renderCslCitation(select.value || 'china-national-standard-gb-t-7714-2015-numeric');
    $('#cite-mask').hidden = false;
  }

  // ---------- 内置 PDF 阅读器 ----------
  var pdfState = {
    handle: null, scale: 1.35, rotation: 0, paper: null, attachment: null, attachmentId: '', layout: 'single', currentPage: 1, pageCount: 0,
    selectedText: '', selectionPositions: [], annotationColor: '#ffd400', translationRequest: 0,
    renderToken: 0, searchResults: [], searchMatches: [], searchIndex: -1
  };
  var pdfTabs = [];              // [{ paper, attachment, page, scale, layout, rotation, scrollTop }]
  var pdfOpenRequest = 0;
  var pdfThumbsObserver = null;
  var pdfOutlineRows = [];
  var PDF_SIDE_WIDTH_KEY = 'litboard.pdfSideWidth';
  var PDF_SIDE_COLLAPSED_KEY = 'litboard.pdfSideCollapsed';
  var PDF_READING_THRESHOLD_MS = 10 * 60 * 1000;
  var pdfReadingElapsed = Object.create(null);
  var pdfReadingActive = null;

  function pausePdfReadingTimer() {
    if (!pdfReadingActive) return;
    clearTimeout(pdfReadingActive.timer);
    pdfReadingElapsed[pdfReadingActive.key] = (pdfReadingElapsed[pdfReadingActive.key] || 0) +
      Math.max(0, Date.now() - pdfReadingActive.started);
    pdfReadingActive = null;
  }

  function startPdfReadingTimer(paper, attachmentId) {
    pausePdfReadingTimer();
    if (!paper || !attachmentId || paper.status !== 'unread' || document.hidden || $('#pdf-overlay').hidden) return;
    var key = paper.id + ':' + attachmentId;
    var active = { paper: paper, key: key, started: Date.now(), timer: null };
    pdfReadingActive = active;
    active.timer = setTimeout(function () {
      if (pdfReadingActive !== active) return;
      pausePdfReadingTimer();
      if (paper.status !== 'unread' || $('#pdf-overlay').hidden || !pdfState.paper ||
          pdfState.paper.id !== paper.id || pdfState.attachmentId !== attachmentId) return;
      paper.status = 'reading';
      save();
      renderAll();
      if (drawerId === paper.id) $('#d-status').value = 'reading';
    }, Math.max(0, PDF_READING_THRESHOLD_MS - (pdfReadingElapsed[key] || 0)));
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pausePdfReadingTimer();
    else if (!$('#pdf-overlay').hidden && pdfState.pageCount > 0) startPdfReadingTimer(pdfState.paper, pdfState.attachmentId);
  });

  function persistReadPos(paperId) {
    if (!desktop || !desktop.setSetting || !pdfState.paper || pdfState.paper.id !== paperId) return;
    var attachmentId = pdfState.attachmentId || '';
    desktop.setSetting('readpos:' + paperId + ':' + attachmentId, {
      attachmentId: attachmentId,
      page: pdfState.currentPage || 1,
      scale: pdfState.scale,
      layout: pdfState.layout,
      rotation: pdfState.rotation,
      scrollTop: $('#pdf-scroll').scrollTop || 0
    }).catch(function () {});
  }
  var saveReadPos = debounce(function () {
    if (pdfState.paper) persistReadPos(pdfState.paper.id);
  }, 800);

  function pdfAttachment(paper, attachmentId) {
    if (!paper) return null;
    var atts = paper.attachments || [];
    if (attachmentId) return atts.find(function (att) { return att.id === attachmentId; }) || null;
    return primaryAttachment(paper);
  }

  // 阅读器渲染层只看当前附件的批注（F06：防跨附件串显）
  function viewerAnnotations() {
    return annotationsForAttachment(pdfState.paper, pdfState.attachment);
  }
  function syncViewerAnnotations() {
    if (pdfState.handle) pdfState.handle.setAnnotations(viewerAnnotations());
  }

  function annotationsForAttachment(paper, attachment) {
    if (!paper || !attachment) return [];
    return (paper.pdfAnnotations || []).filter(function (annotation) {
      return annotation.attachmentId === attachment.id && annotation.sourceStatus !== 'unresolved';
    });
  }

  function stashPdfTab() {
    if (!pdfState.paper) return;
    // 同一条目可有多个 PDF 标签，必须按附件身份保存，不能覆盖同条目的第一个标签。
    var tab = window.LitPdfTabs.find(pdfTabs, pdfState.paper.id, pdfState.attachmentId);
    if (tab) {
      tab.page = pdfState.currentPage;
      tab.attachment = pdfState.attachment;
      tab.scale = pdfState.scale;
      tab.layout = pdfState.layout;
      tab.rotation = pdfState.rotation;
      tab.scrollTop = $('#pdf-scroll').scrollTop || 0;
    }
  }

  function goToLibraryTab() {
    ++pdfOpenRequest;
    pausePdfReadingTimer();
    saveReadPos.flush();
    stashPdfTab();
    if (!$('#epub-overlay').hidden) { stashEpubTab(); persistEpubReadPos.flush(); }
    hidePdfTranslation();
    setPdfPageLocked(false);
    $('#pdf-overlay').hidden = true;
    $('#epub-overlay').hidden = true;
    epubTtsStop();
    renderPdfTabs();
  }

  function setPdfPageLocked(locked) {
    document.body.classList.toggle('pdf-locked', !!locked);
  }

  function renderPdfTabs() {
    var bar = $('#pdf-tabs');
    bar.innerHTML = '';
    var pdfActive = !$('#pdf-overlay').hidden && !!pdfState.paper;
    var epubActive = !$('#epub-overlay').hidden && !!epubState.paper;
    // 第一个标签固定为「文献库」
    var libChip = document.createElement('span');
    libChip.className = 'pdf-tab' + ((pdfActive || epubActive) ? '' : ' active');
    var libTitle = document.createElement('button');
    libTitle.type = 'button';
    libTitle.className = 'pdf-tab-title';
    libTitle.title = T('返回文献库');
    libTitle.textContent = T('▤ 文献库');
    libTitle.addEventListener('click', goToLibraryTab);
    libChip.appendChild(libTitle);
    bar.appendChild(libChip);
    pdfTabs.forEach(function (tab) {
      var chip = document.createElement('span');
      chip.className = 'pdf-tab' + (pdfActive && pdfState.paper.id === tab.paper.id && pdfState.attachmentId === (tab.attachment && tab.attachment.id || '') ? ' active' : '');
      var title = document.createElement('button');
      title.type = 'button';
      title.className = 'pdf-tab-title';
      title.title = tab.paper.title || tab.paper.pdfFileName || 'PDF';
      title.textContent = (tab.paper.title || tab.paper.pdfFileName || 'PDF').slice(0, 26);
       title.addEventListener('click', function () { switchPdfTab(tab.key); });
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'pdf-tab-x';
      close.title = T('关闭该标签');
      close.textContent = '×';
      close.addEventListener('click', function (e) {
        e.stopPropagation();
         closePdfTab(tab.key);
      });
      chip.appendChild(title);
      chip.appendChild(close);
      bar.appendChild(chip);
    });
    epubTabs.forEach(function (tab) {
      var chip = document.createElement('span');
      chip.className = 'pdf-tab' + (epubActive && epubState.paper.id === tab.paper.id && epubState.attachmentId === (tab.attachment && tab.attachment.id || '') ? ' active' : '');
      var title = document.createElement('button');
      title.type = 'button';
      title.className = 'pdf-tab-title';
      title.title = tab.paper.title || tab.attachment.fileName || 'EPUB';
      title.textContent = '📖 ' + (tab.paper.title || tab.attachment.fileName || 'EPUB').slice(0, 24);
      title.addEventListener('click', function () { switchEpubTab(tab.key); });
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'pdf-tab-x';
      close.title = T('关闭该标签');
      close.textContent = '×';
      close.addEventListener('click', function (e) {
        e.stopPropagation();
        closeEpubTab(tab.key);
      });
      chip.appendChild(title);
      chip.appendChild(close);
      bar.appendChild(chip);
    });
  }

  function activatePdfTab(tab) {
    ++pdfOpenRequest;
    pausePdfReadingTimer();
    setPdfPageLocked(true);
    if (!$('#epub-overlay').hidden) { stashEpubTab(); persistEpubReadPos.flush(); epubTtsStop(); hideEpubSelPopover(); $('#epub-overlay').hidden = true; }
    $('#pdf-overlay').hidden = false;
    if (pdfState.handle) { pdfState.handle.cancel(); pdfState.handle = null; }
    pdfState.paper = tab.paper;
    pdfState.attachment = tab.attachment || pdfAttachment(tab.paper, '');
    pdfState.attachmentId = pdfState.attachment ? pdfState.attachment.id : '';
    pdfState.currentPage = tab.page || 1;
    pdfState.pageCount = 0;
    pdfState.scale = tab.scale || 1.35;
    pdfState.layout = tab.layout || 'single';
    pdfState.rotation = tab.rotation || 0;
    pdfState.searchResults = [];
    pdfState.searchMatches = [];
    pdfState.searchIndex = -1;
    $('#pdf-title').textContent = (tab.paper.title || tab.paper.pdfFileName || 'PDF') +
      (pdfState.attachment && pdfState.attachment.fileName ? ' · ' + pdfState.attachment.fileName : '');
    recordPaperRead(tab.paper);
    syncReadingDrawer(tab.paper);
    refreshAgentChips(); // R19：切标签 = 换了正在读的文献
    renderPdfAnnotations();
    renderPdfNoteEditor();
    renderPdfViewer();
    renderPdfTabs();
    if (tab.scrollTop) {
      var restoringHandle = pdfState.handle;
      restoringHandle.promise.then(function () {
        if (pdfState.handle === restoringHandle && tab.scrollTop) $('#pdf-scroll').scrollTop = tab.scrollTop;
      }).catch(function () {});
    }
  }

  function switchPdfTab(key) {
    ++pdfOpenRequest;
    if (!$('#pdf-overlay').hidden && pdfState.paper && pdfState.attachmentId &&
        pdfState.paper.id + ':' + pdfState.attachmentId === key) return;
    stashPdfTab();
    var tab = pdfTabs.find(function (t) { return t.key === key; });
    if (tab) activatePdfTab(tab);
  }

  function hidePdfOverlay() {
    ++pdfOpenRequest;
    pausePdfReadingTimer();
    savePdfAnnotationComment.flush();
    if (pdfState.handle) { pdfState.handle.cancel(); pdfState.handle = null; }
    if (pdfThumbsObserver) { pdfThumbsObserver.disconnect(); pdfThumbsObserver = null; }
    $('#pdf-scroll').innerHTML = '';
    $('#pdf-outline').innerHTML = '';
    $('#pdf-thumbs').innerHTML = '';
    pdfOutlineRows = [];
    hidePdfTranslation();
    setPdfPageLocked(false);
    $('#pdf-overlay').hidden = true;
    pdfState.paper = null;
    pdfState.attachment = null;
    pdfState.attachmentId = '';
    pdfState.pageCount = 0;
    pdfTabs = [];
    renderPdfTabs();
    refreshAgentChips(); // R19：阅读层关了，上下文回落列表焦点
  }

  function closePdfTab(key) {
    var idx = -1;
    for (var i = 0; i < pdfTabs.length; i++) if (pdfTabs[i].key === key) { idx = i; break; }
    if (idx === -1) return;
    var wasActive = pdfState.paper && pdfTabs[idx].key === (pdfState.paper.id + ':' + pdfState.attachmentId);
    if (wasActive) persistReadPos(pdfState.paper.id);
    pdfTabs.splice(idx, 1);
    if (!pdfTabs.length) {
      if (epubTabs.length) {
        pausePdfReadingTimer();
        // PDF 标签清空但还有 EPUB 标签：收起 PDF overlay，切到 EPUB
        if (pdfState.handle) { pdfState.handle.cancel(); pdfState.handle = null; }
        hidePdfTranslation();
        $('#pdf-scroll').innerHTML = '';
        $('#pdf-overlay').hidden = true;
        pdfState.paper = null;
        pdfState.attachment = null;
        pdfState.attachmentId = '';
        activateEpubTab(epubTabs[epubTabs.length - 1]);
        return;
      }
      hidePdfOverlay();
      return;
    }
    if (wasActive) activatePdfTab(pdfTabs[Math.max(0, idx - 1)]);
    else renderPdfTabs();
  }

  /* 阶段四：记录阅读时间（不进内容签名，不触发同步脏写；轻量落盘） */
  function recordPaperRead(paper) {
    if (!paper || !desktop || !desktop.recordRead) return;
    var now = Date.now();
    if (paper.lastReadAt && now - Number(paper.lastReadAt) < 60000) return;
    paper.lastReadAt = now;
    desktop.recordRead({ paperId: paper.id, at: now }).catch(function () {});
  }

  function openPdfViewer(paper, attachmentId) {
    organizePaperAttachments(paper && paper.id);
    var attachment = pdfAttachment(paper, attachmentId);
    if (!desktop || !attachment || !attachment.path) { toast(T('没有可阅读的本地 PDF 附件')); return; }
    var request = ++pdfOpenRequest;
    var tabKey = paper.id + ':' + attachment.id;
    if (!$('#pdf-overlay').hidden && pdfState.paper && pdfState.paper.id + ':' + pdfState.attachmentId === tabKey) return;
    if (!$('#pdf-overlay').hidden) stashPdfTab();
    recordPaperRead(paper);
    var tab = pdfTabs.find(function (t) { return t.key === tabKey; });
    if (tab) { activatePdfTab(tab); return; }
    if (pdfTabs.length >= 8) { toast(T('最多同时打开 8 个 PDF')); return; }
    tab = { key: tabKey, paper: paper, attachment: attachment };
    pdfTabs.push(tab);
    renderPdfTabs();
    function activateIfCurrent() {
      if (request === pdfOpenRequest && pdfTabs.indexOf(tab) !== -1) activatePdfTab(tab);
    }
    if (desktop.getSetting) {
      desktop.getSetting('readpos:' + paper.id + ':' + attachment.id).then(function (pos) {
        if (!pos) return desktop.getSetting('readpos:' + paper.id);
        return pos;
      }).catch(function () { return null; }).then(function (pos) {
        if (pos && pdfTabs.indexOf(tab) !== -1) {
          tab.page = pos.page || 1;
          tab.scale = pos.scale || 1.35;
          tab.layout = pos.layout || 'single';
          tab.rotation = pos.rotation || 0;
          tab.scrollTop = pos.scrollTop || 0;
        }
        activateIfCurrent();
      });
    } else {
      activateIfCurrent();
    }
  }

  var savePdfAnnotationComment = debounce(function () { save(); }, 600);
  var runPdfSearch = debounce(function () { performPdfSearch(false); }, 350);
  var pdfSelectionFrame = 0;
  // Ctrl+滚轮缩放两段式：每个滚轮刻度立即走 zoomPreview——只改 CSS（旧位图拉伸、
  // 文本/链接/批注层 transform 等比跟随），零重绘零光栅，手势期间跟手不卡帧；
  // 停顿 160ms 后 settle 走一次完整 relayout 出清晰位图。旧实现每 80ms 一档
  // 全量重排 + 主线程同步光栅，连续缩放必然掉帧。
  function previewPdfWheelZoom(direction) {
    var next = Math.max(0.6, Math.min(3, Math.round((pdfState.scale + direction * 0.1) * 100) / 100));
    if (next === pdfState.scale) return;
    pdfState.scale = next;
    updatePdfViewUi();
    var current = pdfState.handle;
    if (current && current.zoomPreview) current.zoomPreview(next); // 文档未就绪时静默失败，settle 兜底
  }
  var settlePdfWheelZoom = debounce(function () {
    applyPdfViewChange(); // 预览已就位，此处补一次原位重排出清晰页
  }, 160);
  function applyPdfWheelZoom(direction) {
    previewPdfWheelZoom(direction);
    settlePdfWheelZoom();
  }
  function annotationUid() { return 'a' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function updatePdfPageUi(page, total) {
    pdfState.currentPage = page || 1;
    pdfState.pageCount = total || pdfState.pageCount || 0;
    $('#pdf-page-number').value = pdfState.currentPage;
    $('#pdf-page-number').max = Math.max(1, pdfState.pageCount);
    $('#pdf-page-total').textContent = '/ ' + pdfState.pageCount;
    $('#pdf-page-prev').disabled = pdfState.currentPage <= 1;
    $('#pdf-page-next').disabled = pdfState.currentPage >= pdfState.pageCount;
    markPdfThumb(pdfState.currentPage);
    markPdfOutline(pdfState.currentPage);
    saveReadPos();
    refreshAgentChips(); // R19：chip 上的「第 N 页」跟随翻页
  }

  // ---------- OCR（扫描件） ----------
  var ocrBusy = false;

  function hideOcrBanner() {
    $('#pdf-ocr-banner').hidden = true;
  }

  function detectScannedPdf(doc) {
    if (!doc || !desktop || !window.LitOcr) return;
    var checks = [];
    var pagesToCheck = Math.min(3, doc.numPages);
    for (var p = 1; p <= pagesToCheck; p++) {
      (function (pageNum) {
        checks.push(doc.getPage(pageNum).then(function (page) {
          return page.getTextContent();
        }).then(function (content) {
          return content.items.reduce(function (sum, item) { return sum + (item.str || '').trim().length; }, 0);
        }).catch(function () { return 0; }));
      })(p);
    }
    Promise.all(checks).then(function (counts) {
      if (token0Invalid()) return;
      var hasText = counts.some(function (c) { return c > 20; });
      var banner = $('#pdf-ocr-banner');
      if (hasText) { banner.hidden = true; return; }
      // 已有 OCR 索引则不必提示
      desktop.pdfSearchMeta().then(function (meta) {
        if (token0Invalid()) return;
        var entry = meta && (meta[pdfState.paper.id + ':' + pdfState.attachmentId] || meta[pdfState.paper.id]);
        banner.hidden = !!(entry && entry.method === 'ocr');
      }).catch(function () {});
    });
    function token0Invalid() { return !pdfState.paper || pdfState.handle && pdfState.handle.doc !== doc; }
  }

  function ocrPdfPages(pageIndexes) {
    if (!window.LitOcr || !pdfState.handle || !pdfState.handle.doc || !pdfState.paper) return;
    if (ocrBusy) { toast(T('OCR 正在进行中…')); return; }
    var doc = pdfState.handle.doc;
    var paper = pdfState.paper;
    // OCR 是跨多个异步边界的长任务。目标身份必须在启动时冻结；用户切换阅读标签后
    // pdfState 会指向另一附件，若落库时再读它，会把旧文档正文写进新附件索引。
    var attachmentId = pdfState.attachmentId;
    var attachment = pdfState.attachment;
    var fingerprint = attachment && attachment.fingerprint || paper.pdfFingerprint || '';
    ocrBusy = true;
    var banner = $('#pdf-ocr-banner');
    var textEl = $('#pdf-ocr-banner-text');
    banner.hidden = false;
    textEl.textContent = T('OCR 准备中（首次需下载约 21MB 识别模型）…');
    window.LitOcr.ensureData().then(function (status) {
      return window.LitOcr.ocrPages(pageIndexes, status.dir, function (pageIndex) {
        return doc.getPage(pageIndex + 1).then(function (page) {
          var viewport = page.getViewport({ scale: 2 });
          var canvas = document.createElement('canvas');
          return page.renderToCanvas(canvas, viewport.scale, viewport.rotation);
        });
      }, function (progress) {
        textEl.textContent = T('OCR 识别中 ') + progress.done + '/' + progress.total + T('（第 ') + progress.page + T(' 页）…');
      });
    }).then(function (result) {
      var pages = result && result.pages || {};
      if (!Object.keys(pages).length) return null;
      // A-followup #2：旧版单 PDF 时代的索引行写在 attachmentId='' 上。只有当前打开的
      // 正是该文献主 PDF 时才允许读它——读补充材料的索引绝不能被主文献正文顶上。
      var ocrMainAtt = primaryAttachment(paper);
      var ocrLegacy = !!ocrMainAtt && ocrMainAtt.id === attachmentId;
      return desktop.pdfSearchGetPages(paper.id, attachmentId, ocrLegacy).then(function (existing) {
        var merged = Array.isArray(existing) ? existing.slice() : [];
        Object.keys(pages).forEach(function (idx) { merged[Number(idx)] = pages[idx]; });
        return desktop.pdfSearchPut({
          paperId: paper.id,
          attachmentId: attachmentId,
          fingerprint: fingerprint,
          method: 'ocr',
          pages: merged
        });
      }).then(function () {
        if (window.LitPdfSearch) window.LitPdfSearch.resetCache();
        toast(T('✓ OCR 完成：') + Object.keys(pages).length + T(' 页，全文检索已可用'));
      });
    }).catch(function (error) {
      toast(T('⚠ OCR 失败：') + (error && error.message || error));
    }).finally(function () {
      ocrBusy = false;
      hideOcrBanner();
    });
  }

  // ---------- 大纲 / 缩略图 ----------
  function markPdfOutline(page) {
    var active = null;
    var previous = $('#pdf-outline .pdf-outline-row.active');
    pdfOutlineRows.forEach(function (entry) {
      entry.row.classList.remove('active');
      if (entry.page <= page && !entry.row.closest('.pdf-outline-children[hidden]') &&
          (!active || entry.page >= active.page)) active = entry;
    });
    if (active) {
      active.row.classList.add('active');
      if (active.row !== previous && !$('#pdf-side').hidden && $('#pdf-side').dataset.tab === 'outline') {
        active.row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }

  function renderPdfOutline(doc) {
    var wrap = $('#pdf-outline');
    wrap.innerHTML = '';
    pdfOutlineRows = [];
    if (!doc) return;
    doc.getOutline().then(function (outline) {
      if (!pdfState.handle || pdfState.handle.doc !== doc) return;
      if (!outline || !outline.length) {
        wrap.innerHTML = T('<div class="pdf-side-empty">本文档没有大纲</div>');
        return;
      }
      function addItems(items, parent) {
        items.forEach(function (item) {
          var node = document.createElement('div');
          node.className = 'pdf-outline-node';
          var rowWrap = document.createElement('div');
          rowWrap.className = 'pdf-outline-row';
          var toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'pdf-outline-toggle';
          toggle.textContent = item.down && item.down.length ? '›' : '';
          toggle.disabled = !item.down || !item.down.length;
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'pdf-outline-item';
          row.title = item.title || '';
          row.textContent = item.title || T('(未命名)');
          row.addEventListener('click', function () {
            if (Number.isFinite(Number(item.page)) && Number(item.page) >= 0) goToPdfPage(Number(item.page) + 1);
          });
          rowWrap.appendChild(toggle);
          rowWrap.appendChild(row);
          node.appendChild(rowWrap);
          parent.appendChild(node);
          if (Number.isInteger(item.page) && item.page >= 0) pdfOutlineRows.push({ row: rowWrap, page: item.page + 1 });
          if (item.down && item.down.length) {
            var children = document.createElement('div');
            children.className = 'pdf-outline-children';
            children.hidden = item.open === false;
            toggle.setAttribute('aria-expanded', String(!children.hidden));
            toggle.setAttribute('aria-label', T('展开或收起大纲章节'));
            toggle.addEventListener('click', function () {
              children.hidden = !children.hidden;
              toggle.setAttribute('aria-expanded', String(!children.hidden));
              markPdfOutline(pdfState.currentPage);
            });
            node.appendChild(children);
            addItems(item.down, children);
          }
        });
      }
      addItems(outline, wrap);
      markPdfOutline(pdfState.currentPage);
    }).catch(function () {
      if (pdfState.handle && pdfState.handle.doc === doc) wrap.innerHTML = T('<div class="pdf-side-empty">大纲读取失败</div>');
    });
  }

  function markPdfThumb(page) {
    $all('#pdf-thumbs .pdf-thumb').forEach(function (el) {
      el.classList.toggle('active', Number(el.dataset.page) === page);
    });
    if (!$('#pdf-side').hidden && $('#pdf-side').dataset.tab === 'thumbs') {
      var active = $('#pdf-thumbs .pdf-thumb.active');
      if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function renderPdfThumbs(doc) {
    var wrap = $('#pdf-thumbs');
    wrap.innerHTML = '';
    if (pdfThumbsObserver) { pdfThumbsObserver.disconnect(); pdfThumbsObserver = null; }
    if (!doc) return;
    var pages = doc.numPages;
    for (var p = 1; p <= pages; p++) {
      (function (pageNum) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'pdf-thumb';
        item.dataset.page = pageNum;
        item.setAttribute('aria-label', T('页码') + ' ' + pageNum);
        item.innerHTML = '<div class="pdf-thumb-canvas-wrap"><span class="pdf-thumb-placeholder">' + pageNum + '</span></div>' +
          '<span class="pdf-thumb-num">' + pageNum + '</span>';
        item.addEventListener('click', function () { goToPdfPage(pageNum); });
        wrap.appendChild(item);
      })(p);
    }
    pdfThumbsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var item = entry.target;
        if (item.dataset.done) return;
        item.dataset.done = '1';
        var pageNum = Number(item.dataset.page);
        doc.getPage(pageNum).then(function (page) {
          if (!pdfState.handle || pdfState.handle.doc !== doc || !item.isConnected) return;
          var viewport = page.getViewport({ scale: 1 });
          var scale = 120 * (window.devicePixelRatio || 1) / viewport.width;
          var thumbViewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.style.width = '120px';
          canvas.style.height = Math.round(120 * viewport.height / viewport.width) + 'px';
          var holder = item.querySelector('.pdf-thumb-canvas-wrap');
          holder.innerHTML = '';
          holder.appendChild(canvas);
          return page.renderToCanvas(canvas, thumbViewport.scale, thumbViewport.rotation);
        }).catch(function () {});
      });
    }, { root: wrap, rootMargin: '200px 0px' });
    Array.prototype.forEach.call(wrap.children, function (child) { pdfThumbsObserver.observe(child); });
    markPdfThumb(pdfState.currentPage || 1);
  }

  function setPdfSideVisible(show) {
    var side = $('#pdf-side');
    side.hidden = !show;
    side.inert = !show;
    $('#pdf-reader-main').classList.toggle('pdf-side-collapsed', !show);
    $('#pdf-side-resizer').hidden = !show;
    $('#pdf-side-open').hidden = show;
    $('#pdf-side-open').setAttribute('aria-expanded', String(show));
    $('#pdf-side-toggle').setAttribute('aria-pressed', show ? 'true' : 'false');
    try { localStorage.setItem(PDF_SIDE_COLLAPSED_KEY, show ? '0' : '1'); } catch (e) {}
    if (show) selectPdfSideTab(side.dataset.tab || 'thumbs');
  }

  function selectPdfSideTab(tab) {
    var side = $('#pdf-side');
    if (side.hidden) setPdfSideVisible(true);
    side.dataset.tab = tab;
    $('#pdf-side-tab-outline').classList.toggle('active', tab === 'outline');
    $('#pdf-side-tab-thumbs').classList.toggle('active', tab === 'thumbs');
    $('#pdf-side-tab-outline').setAttribute('aria-selected', String(tab === 'outline'));
    $('#pdf-side-tab-thumbs').setAttribute('aria-selected', String(tab === 'thumbs'));
    $('#pdf-side-tab-outline').tabIndex = tab === 'outline' ? 0 : -1;
    $('#pdf-side-tab-thumbs').tabIndex = tab === 'thumbs' ? 0 : -1;
    $('#pdf-outline').hidden = tab !== 'outline';
    $('#pdf-thumbs').hidden = tab !== 'thumbs';
    if (pdfState.handle && pdfState.handle.doc) {
      if (tab === 'outline' && !$('#pdf-outline').childNodes.length) renderPdfOutline(pdfState.handle.doc);
      if (tab === 'thumbs' && !$('#pdf-thumbs').childNodes.length) renderPdfThumbs(pdfState.handle.doc);
    }
    if (tab === 'thumbs') markPdfThumb(pdfState.currentPage);
    else markPdfOutline(pdfState.currentPage);
  }

  function updatePdfViewUi() {
    $('#pdf-zoom').textContent = Math.round(pdfState.scale * 100) + '%';
    $('#pdf-layout-toggle').setAttribute('aria-pressed', pdfState.layout === 'spread' ? 'true' : 'false');
    $('#pdf-layout-toggle').title = pdfState.layout === 'spread' ? T('切换为单栏阅读') : T('切换为双栏阅读');
  }

  // 视图参数（缩放/版式/旋转）变化：优先走 relayout 原位重排（复用文档、保留旧位图
  // 做拉伸预览，无白屏闪烁）；文档尚未就绪时回退全量重开
  function applyPdfViewChange() {
    updatePdfViewUi();
    var handle = pdfState.handle;
    var fast = !!(handle && handle.relayout && handle.relayout({
      scale: pdfState.scale,
      layout: pdfState.layout,
      rotation: pdfState.rotation
    }));
    if (!fast) renderPdfViewer();
    saveReadPos();
  }

  function renderPdfViewer() {
    var scroll = $('#pdf-scroll');
    var attachment = pdfState.attachment;
    if (pdfThumbsObserver) { pdfThumbsObserver.disconnect(); pdfThumbsObserver = null; }
    $('#pdf-outline').innerHTML = '';
    $('#pdf-thumbs').innerHTML = '';
    pdfOutlineRows = [];
    if (!pdfState.paper || !attachment || !attachment.path) {
      scroll.innerHTML = T('<div class="pdf-loading">⚠ 当前附件没有本地 PDF 文件</div>');
      return;
    }
    var targetPage = pdfState.currentPage;
    var token = ++pdfState.renderToken;
    if (pdfState.handle) pdfState.handle.cancel();
    scroll.innerHTML = T('<div class="pdf-loading">正在渲染 PDF…</div>');
    updatePdfViewUi();
    pdfState.handle = window.LitPdf.renderPdf(attachment.path, scroll, {
      scale: pdfState.scale,
      layout: pdfState.layout,
      rotation: pdfState.rotation,
      textLayer: true,
      annotations: annotationsForAttachment(pdfState.paper, attachment),
      onPageChange: updatePdfPageUi,
      onSheetRendered: onPdfSheetRendered,
      onAnnotationClick: revealPdfAnnotation
    });
    pdfState.handle.promise.then(function (doc) {
      if (token !== pdfState.renderToken || !doc) return;
      updatePdfPageUi(Math.min(targetPage, doc.numPages), doc.numPages);
      startPdfReadingTimer(pdfState.paper, pdfState.attachmentId);
      updatePdfViewUi();
      if (targetPage > 1) pdfState.handle.goToPage(targetPage);
      if ($('#pdf-search').value.trim()) performPdfSearch(true);
      maybeImportPdfAnnotations(pdfState.paper, pdfState.attachment);
      detectScannedPdf(doc);
      if (!$('#pdf-side').hidden) {
        if ($('#pdf-side').dataset.tab === 'thumbs') renderPdfThumbs(doc);
        else renderPdfOutline(doc);
      }
    }).catch(function (err) {
      if (token !== pdfState.renderToken) return;
      scroll.innerHTML = T('<div class="pdf-loading">⚠ 无法渲染：') + esc(err && err.message || String(err)) + '</div>';
    });
  }

  function renderPdfAnnotations(activeId) {
    var list = $('#pdf-annotation-list');
    var empty = $('#pdf-annotation-empty');
    var annotations = annotationsForAttachment(pdfState.paper, pdfState.attachment);
    list.innerHTML = '';
    $('#pdf-annotation-count').textContent = annotations.length;
    empty.hidden = annotations.length > 0;
    annotations.forEach(function (annotation) {
      var item = document.createElement('article');
      item.className = 'pdf-annotation-item' + (annotation.id === activeId ? ' active' : '');
      item.dataset.annotationId = annotation.id;
      item.style.setProperty('--annotation-color', annotation.color);
      var head = document.createElement('div');
      head.className = 'pdf-annotation-item-head';
      var label = document.createElement('strong');
      label.textContent = { highlight: T('高亮'), underline: T('下划线'), note: T('批注'), snapshot: T('截图'), ink: T('手写') }[annotation.type] || T('批注');
      var page = document.createElement('span');
      page.textContent = T('第 ') + (annotation.position.pageIndex + 1) + T(' 页');
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pdf-annotation-delete';
      remove.dataset.deleteAnnotation = annotation.id;
      remove.title = T('删除批注');
      remove.setAttribute('aria-label', T('删除批注'));
      remove.textContent = '×';
      head.appendChild(label); head.appendChild(page); head.appendChild(remove);
      var quote = document.createElement('p');
      quote.className = 'pdf-annotation-quote';
      if (annotation.type === 'snapshot' && annotation.imagePath) {
        var img = document.createElement('img');
        img.className = 'pdf-annotation-thumb';
        img.src = 'file:///' + String(annotation.imagePath).replace(/\\/g, '/');
        img.alt = T('区域截图');
        quote.appendChild(img);
      } else {
        quote.textContent = annotation.text || T('无文字内容');
      }
      var comment = document.createElement('textarea');
      comment.className = 'pdf-annotation-comment';
      comment.dataset.annotationComment = annotation.id;
      comment.rows = 2;
      comment.placeholder = T('添加批注内容…');
      comment.value = annotation.comment || '';
      var actions = document.createElement('div');
      actions.className = 'pdf-annotation-actions';
      var toNote = document.createElement('button');
      toNote.type = 'button';
      toNote.className = 'btn btn-ghost btn-xs';
      toNote.dataset.annotationToNote = annotation.id;
      toNote.title = T('把这条批注作为摘录加入笔记');
      toNote.textContent = T('加到笔记');
      actions.appendChild(toNote);
      var tagBox = document.createElement('span');
      tagBox.className = 'pdf-annotation-tags';
      (annotation.tags || []).forEach(function (tag) {
        var chipEl = document.createElement('span');
        chipEl.className = 'pdf-annotation-tag';
        chipEl.dataset.annotationTagRemove = annotation.id;
        chipEl.dataset.tag = tag;
        chipEl.title = T('点击移除标签');
        chipEl.textContent = tag;
        tagBox.appendChild(chipEl);
      });
      var tagInput = document.createElement('input');
      tagInput.className = 'pdf-annotation-tag-input';
      tagInput.dataset.annotationTagInput = annotation.id;
      tagInput.placeholder = T('＋标签');
      tagInput.setAttribute('aria-label', T('批注标签'));
      tagBox.appendChild(tagInput);
      actions.appendChild(tagBox);
      item.appendChild(head); item.appendChild(quote); item.appendChild(comment); item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function revealPdfAnnotation(annotationId) {
    if (!annotationsForAttachment(pdfState.paper, pdfState.attachment).some(function (item) { return item.id === annotationId; })) return;
    if (window.LitAgentUi && window.LitAgentUi.switchPane) window.LitAgentUi.switchPane('anno');
    renderPdfAnnotations(annotationId);
    var item = $('#pdf-annotation-list [data-annotation-id="' + annotationId + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  function focusPdfAnnotation(annotationId) {
    if (!pdfState.paper) return;
    var annotation = annotationsForAttachment(pdfState.paper, pdfState.attachment).find(function (item) { return item.id === annotationId; });
    if (!annotation) return;
    var paperId = pdfState.paper.id, attachmentId = pdfState.attachment.id;
    if (pdfState.handle) pdfState.handle.goToPage(annotation.position.pageIndex + 1).then(function () {
      if (!pdfState.paper || pdfState.paper.id !== paperId || !pdfState.attachment || pdfState.attachment.id !== attachmentId) return;
      var sheet = $('#pdf-scroll .pdf-page-sheet[data-page="' + (annotation.position.pageIndex + 1) + '"]');
      if (!sheet) return;
      var marks = sheet.querySelectorAll('.pdf-annotation-mark');
      var first = null;
      marks.forEach(function (mark) {
        if (mark.dataset.annotationId !== annotationId) return;
        if (!first) first = mark;
        mark.classList.remove('pdf-annotation-flash');
        void mark.offsetWidth;
        mark.classList.add('pdf-annotation-flash');
      });
      if (first) first.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    });
    renderPdfAnnotations(annotationId);
    var item = $('#pdf-annotation-list [data-annotation-id="' + annotationId + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  /* ---- 阅读器侧栏笔记编辑器（阶段三）：目标笔记选择/新建、Markdown 编辑+预览、来源更新提示 ---- */
  function fillNoteSelect(select, paperId, currentId) {
    select.innerHTML = '';
    [{ label: T('本篇笔记'), list: notesForPaper(paperId) }, { label: T('主题笔记'), list: topicNotes() }]
      .forEach(function (group) {
        if (!group.list.length) return;
        var og = document.createElement('optgroup');
        og.label = group.label;
        group.list.forEach(function (note) {
          var opt = document.createElement('option');
          opt.value = note.id;
          opt.textContent = note.title || T('（无标题笔记）');
          og.appendChild(opt);
        });
        select.appendChild(og);
      });
    if (!select.options.length) {
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = T('（无笔记，点「＋新建」创建）');
      select.appendChild(placeholder);
    }
    if (currentId && select.querySelector('option[value="' + currentId + '"]')) select.value = currentId;
    else select.selectedIndex = 0;
  }

  function createReaderNotePanel(prefix, getPaper) {
    if (!window.LitNotePanel) return null;
    return window.LitNotePanel.create({
      $: $, T: T, debounce: debounce, prefix: prefix, getPaper: getPaper,
      notesForPaper: notesForPaper, topicNotes: topicNotes, findNote: findNote,
      findAnnotationAnywhere: findAnnotationAnywhere, annotationQuote: annotationQuote,
      fillSelect: fillNoteSelect, noteMl: window.LitNoteMl, markdown: window.LitMarkdown,
      excerpt: window.LitExcerpt, touch: function (note) { window.LitModel.touch(note); },
      save: save, toast: toast, createNote: createNote,
      prompt: function (title, body, placeholder) { return dlgPrompt(title, body, placeholder); },
      openRichtext: openNoteEditor, exportWord: exportNoteToWord
    });
  }

  function initReaderNotePanels() {
    epubNotePanel = createReaderNotePanel('epub', function () { return epubState.paper; });
    pdfNotePanel = createReaderNotePanel('pdf', function () { return pdfState.paper; });
    if (epubNotePanel) epubNotePanel.bind();
    if (pdfNotePanel) pdfNotePanel.bind();
  }

  function currentPdfNote() {
    return pdfNotePanel ? pdfNotePanel.current() : null;
  }

  function renderPdfNoteEditor() {
    if (pdfNotePanel) pdfNotePanel.render();
  }

  /* ---- 批注多选加入笔记弹窗（#excerpt-mask） ---- */
  var excerptDlg = null; // { paper, colorFilter, tagFilter, checked: {id:bool} }

  function openExcerptDialog(paper) {
    var readerPaper = paper && pdfState.paper === paper && pdfState.attachment
      ? Object.assign({}, paper, { pdfAnnotations: annotationsForAttachment(paper, pdfState.attachment) }) : paper;
    if (!readerPaper || !(readerPaper.pdfAnnotations || []).length) { toast(T('当前附件还没有批注')); return; }
    var checked = {};
    (readerPaper.pdfAnnotations || []).forEach(function (a) { checked[a.id] = true; });
    excerptDlg = { paper: readerPaper, colorFilter: '', tagFilter: '', checked: checked };
    $('#excerpt-mask').hidden = false;
    renderExcerptDialog();
  }

  function renderExcerptDialog() {
    if (!excerptDlg) return;
    var paper = excerptDlg.paper;
    var annotations = paper.pdfAnnotations || [];
    $('#excerpt-summary').textContent = '《' + paper.title + T('》共 ') + annotations.length + T(' 条批注，勾选后加入目标笔记。');
    // 颜色筛选 chips
    var colors = [];
    annotations.forEach(function (a) { if (colors.indexOf(a.color) === -1) colors.push(a.color); });
    var colorBox = $('#excerpt-color-filter');
    colorBox.innerHTML = '';
    var allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'excerpt-color-chip' + (excerptDlg.colorFilter ? '' : ' active');
    allChip.title = T('全部颜色');
    allChip.style.background = 'linear-gradient(90deg,#ffd400,#ff6b6b,#5aa9ff,#5fbf77,#b28dff)';
    allChip.addEventListener('click', function () { excerptDlg.colorFilter = ''; renderExcerptDialog(); });
    colorBox.appendChild(allChip);
    colors.forEach(function (color) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'excerpt-color-chip' + (excerptDlg.colorFilter === color ? ' active' : '');
      chip.style.background = color;
      chip.title = color;
      chip.addEventListener('click', function () {
        excerptDlg.colorFilter = excerptDlg.colorFilter === color ? '' : color;
        renderExcerptDialog();
      });
      colorBox.appendChild(chip);
    });
    // 标签筛选
    var tags = [];
    annotations.forEach(function (a) {
      (a.tags || []).forEach(function (tag) { if (tags.indexOf(tag) === -1) tags.push(tag); });
    });
    var tagFilter = $('#excerpt-tag-filter');
    var keep = excerptDlg.tagFilter;
    tagFilter.innerHTML = T('<option value="">全部标签</option>') +
      tags.map(function (tag) { return '<option value="' + esc(tag) + '">' + esc(tag) + '</option>'; }).join('');
    tagFilter.value = tags.indexOf(keep) !== -1 ? keep : '';
    excerptDlg.tagFilter = tagFilter.value;
    // 清单
    var list = $('#excerpt-list');
    list.innerHTML = '';
    var visible = annotations.filter(function (a) {
      if (excerptDlg.colorFilter && a.color !== excerptDlg.colorFilter) return false;
      if (excerptDlg.tagFilter && (a.tags || []).indexOf(excerptDlg.tagFilter) === -1) return false;
      return true;
    });
    if (!visible.length) {
      list.innerHTML = T('<p class="field-hint">当前筛选下没有批注。</p>');
    }
    visible.forEach(function (a) {
      var row = document.createElement('label');
      row.className = 'excerpt-item';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = excerptDlg.checked[a.id] !== false;
      checkbox.addEventListener('change', function () { excerptDlg.checked[a.id] = checkbox.checked; });
      row.appendChild(checkbox);
      var dot = document.createElement('span');
      dot.className = 'pdf-color';
      dot.style.background = a.color;
      row.appendChild(dot);
      var quote = document.createElement('span');
      quote.className = 'excerpt-item-quote';
      quote.textContent = annotationQuote(a).split('\n')[0].slice(0, 80);
      row.appendChild(quote);
      var meta = document.createElement('span');
      meta.className = 'excerpt-item-meta';
      meta.textContent = 'p.' + (a.position.pageIndex + 1) + (a.comment ? T(' · 有评论') : '');
      row.appendChild(meta);
      list.appendChild(row);
    });
    // 目标笔记
    var currentNote = currentPdfNote();
    fillNoteSelect($('#excerpt-target'), paper.id, currentNote ? currentNote.id : '');
  }

  function confirmExcerptDialog() {
    if (!excerptDlg) return;
    var paper = excerptDlg.paper;
    var chosen = (paper.pdfAnnotations || []).filter(function (a) { return excerptDlg.checked[a.id] !== false; });
    if (!chosen.length) { toast(T('没有勾选任何批注')); return; }
    var targetId = $('#excerpt-target').value;
    var note = targetId ? findNote(targetId) : null;
    if (!note) {
      note = createNote(paper.id, '');
      toast(T('已新建本篇笔记'));
    }
    var n = addAnnotationsToNote(note, chosen, paper);
    if (!$('#epub-overlay').hidden) {
      if (epubNotePanel) epubNotePanel.setCurrentId(note.id);
      $('#excerpt-mask').hidden = true;
      excerptDlg = null;
      renderEpubNoteEditor();
    } else {
      if (pdfNotePanel) pdfNotePanel.setCurrentId(note.id);
      $('#excerpt-mask').hidden = true;
      excerptDlg = null;
      renderPdfNoteEditor();
    }
    toast(T('✓ 已把 ') + n + T(' 条摘录加入「') + (note.title || T('笔记')) + '」');
  }

  /* ---- litboard:// 出处定位（应用内点击 + 系统协议拉起）；EPUB 批注走 epubcfi 分支 ---- */
  function openPdfAt(target) {
    if (!target || !target.paperId) return;
    var paper = getById(target.paperId);
    if (!paper) { toast(T('文献不存在（可能已删除）：') + target.paperId); return; }
    if (target.epubcfi) {
      var epubAtt = epubAttachment(paper, target.attachmentId || '');
      if (!epubAtt) { toast('《' + paper.title + T('》没有可定位的 EPUB 附件')); return; }
      openEpubViewer(paper, epubAtt.id, target.epubcfi);
      if (target.annotationId) {
        var triesAnn = 0;
        var timerAnn = setInterval(function () {
          triesAnn++;
          var ready = epubState.paper === paper && epubState.attachmentId === epubAtt.id && epubState.api;
          if (!ready && triesAnn <= 60) return;
          clearInterval(timerAnn);
          if (ready && annotationsForAttachment(paper, epubAtt).some(function (a) { return a.id === target.annotationId; })) {
            renderEpubAnnotations(target.annotationId);
          }
        }, 100);
      }
      return;
    }
    var attachment = pdfAttachment(paper, target.attachmentId || '');
    if (target.attachmentId && !attachment) { toast(T('指定附件不存在或已移除：') + target.attachmentId); return; }
    if (!attachment || !attachment.path) { toast('《' + paper.title + T('》指定附件没有本地 PDF 文件')); return; }
    openPdfViewer(paper, attachment.id);
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var ready = pdfState.paper === paper && pdfState.attachmentId === attachment.id && pdfState.handle;
      if (!ready && tries <= 60) return;
      clearInterval(timer);
      if (!ready) return;
      if (target.annotationId) {
        var found = annotationsForAttachment(paper, attachment).some(function (a) { return a.id === target.annotationId; });
        if (found) {
          focusPdfAnnotation(target.annotationId);
        } else {
          if (target.page) goToPdfPage(target.page);
          toast(T('来源批注已删除') + (target.page ? T('（已定位到所在页）') : ''));
        }
      } else if (target.page) {
        goToPdfPage(target.page);
      }
    }, 100);
  }

  function parseLitboardHref(href) {
    try {
      var url = new URL(String(href || ''));
      if (url.protocol !== 'litboard:') return null;
      if (url.hostname.toLowerCase() !== 'open') return null;
      var match = /^\/paper\/([A-Za-z0-9_-]{1,120})$/.exec(url.pathname);
      if (!match) return null;
      var validId = function (value) { return /^[A-Za-z0-9_-]{1,120}$/.test(String(value || '')) ? String(value) : ''; };
      var page = Number(url.searchParams.get('page'));
      return {
        paperId: match[1],
        attachmentId: validId(url.searchParams.get('attachment')),
        annotationId: validId(url.searchParams.get('annotation')),
        epubcfi: String(url.searchParams.get('epubcfi') || '').slice(0, 2000),
        page: Number.isFinite(page) && page > 0 ? Math.trunc(page) : 0
      };
    } catch (e) { return null; }
  }

  function handleLitboardClick(event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href^="litboard://"]') : null;
    if (!anchor) return;
    event.preventDefault();
    var target = parseLitboardHref(anchor.getAttribute('href'));
    if (target) openPdfAt(target);
  }

  /* ---- 富文本编辑器入口（阶段三下半） ---- */
  function openNoteEditor(note) {
    if (!window.LitNoteEditor) { toast(T('编辑器未加载')); return; }
    if (!note) { toast(T('请先选择或新建一篇笔记')); return; }
    window.LitNoteEditor.open({
      note: note,
      papers: state.papers.filter(function (p) { return !p.deletedAt; }),
      onSave: function (saved) {
        window.LitModel.touch(saved);
        save();
        renderPdfNoteEditor();
        toast(T('✓ 笔记已保存（富文本）'));
      },
      prompt: dlgPrompt,
      pick: dlgPick,
      confirmDiscard: dlgConfirm,
      pickImage: function () {
        if (!desktop || !desktop.chooseFiles) return Promise.resolve(null);
        return desktop.chooseFiles({ filters: [{ name: T('图片'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }] })
          .then(function (files) { return files && files[0] ? { path: files[0] } : null; });
      },
      citationLabel: function (paper) {
        return (paper.authors && paper.authors.length ? String(paper.authors[0]).split(',')[0] : T('匿名')) +
          (paper.year ? ', ' + paper.year : '') + ' · ' + String(paper.title || '').slice(0, 40);
      }
    });
  }

  /* ---- 可视化查询构建器（阶段四余项；生成文本与搜索框共享同一求值逻辑） ---- */
  // 阶段四尾巴：撤销/重做入口（按钮 + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）
  $('#btn-undo').addEventListener('click', undoOnce);
  $('#btn-redo').addEventListener('click', redoOnce);
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var key = String(e.key || '').toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    var target = e.target;
    var tag = target && target.tagName ? target.tagName : '';
    var inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable);
    if (inEditable) return; // 输入框内交给原生撤销
    if (key === 'y' || e.shiftKey) { e.preventDefault(); redoOnce(); }
    else { e.preventDefault(); undoOnce(); }
  });
  updateUndoUi();

  /* ---- 阶段六切片：PDF 朗读（本机 speechSynthesis）+ 网页快照安全阅读 ---- */
  /* 网页快照安全阅读：禁脚本（sandbox 空值）、禁远端资源（CSP default-src none） */
  function openSnapshotViewer(filePath, title) {
    var readBytes = desktop && (desktop.readFileBytes || desktop.readBytes);
    if (!readBytes) { toast(T('快照阅读需要桌面版')); return; }
    readBytes.call(desktop, filePath).then(function (bytes) {
      var html = new TextDecoder('utf-8').decode(bytes);
      var csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:;">';
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + csp; }) : csp + html;
      $('#snapshot-title').textContent = title || '';
      $('#snapshot-frame').srcdoc = html;
      $('#snapshot-mask').hidden = false;
    }).catch(function (e) { toast(T('⚠ 快照读取失败：') + (e && e.message || e)); });
  }

  // EPUB 阅读器工具栏（阶段六）
  $('#epub-close').addEventListener('click', closeEpubViewer);
  $('#epub-external').addEventListener('click', function () {
    if (epubState.attachment && desktop) desktop.openPath(epubState.attachment.path).then(function (err) { if (err) toast(T('⚠ 无法打开：') + err); });
  });
  $('#epub-toc-toggle').addEventListener('click', function () {
    var side = $('#epub-side');
    side.hidden = !side.hidden;
    this.setAttribute('aria-pressed', String(!side.hidden));
  });
  $('#epub-prev').addEventListener('click', function () { if (epubState.api) epubState.api.prev(); });
  $('#epub-next').addEventListener('click', function () { if (epubState.api) epubState.api.next(); });
  $('#epub-font-minus').addEventListener('click', function () {
    epubState.fontSize = window.LitEpub.stepFontSize(epubState.fontSize, -1);
    applyEpubPrefs();
    stashEpubTab();
  });
  $('#epub-font-plus').addEventListener('click', function () {
    epubState.fontSize = window.LitEpub.stepFontSize(epubState.fontSize, 1);
    applyEpubPrefs();
    stashEpubTab();
  });
  $('#epub-theme').addEventListener('click', function () {
    epubState.theme = window.LitEpub.stepTheme(epubState.theme, 1);
    applyEpubPrefs();
    stashEpubTab();
    toast(T('主题：') + { light: T('明亮'), sepia: T('羊皮纸'), dark: T('暗黑') }[epubState.theme]);
  });
  $('#epub-tts').addEventListener('click', epubTtsToggle);
  $('#epub-annotations-toggle').addEventListener('click', function () {
    var panel = $('#epub-annotations');
    panel.hidden = !panel.hidden;
    this.setAttribute('aria-pressed', String(!panel.hidden));
  });
  $('#epub-sel-close').addEventListener('click', hideEpubSelPopover);
  // 进度条点击跳转（locations 就绪精确跳转，否则退 spine 章节）
  $('#epub-progress').addEventListener('click', function (e) {
    if (!epubState.api) return;
    var rect = this.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / Math.max(1, rect.width) * 100;
    epubState.api.seek(pct);
  });
  // EPUB 批注（阶段六切片 3）
  $('#epub-add-highlight').addEventListener('click', function () { createEpubAnnotation('highlight'); });
  $('#epub-add-note').addEventListener('click', function () {
    if (!epubState.pendingSelection) return;
    dlgPrompt(T('添加批注'), T('批注内容'), '').then(function (comment) {
      if (comment == null) return;
      createEpubAnnotation('note', comment.trim());
    });
  });
  $('#epub-annotation-colors').addEventListener('click', function (e) {
    var color = e.target.closest('[data-epub-color]');
    if (!color) return;
    epubState.annotationColor = color.dataset.epubColor;
    $all('#epub-annotation-colors .pdf-color').forEach(function (button) { button.classList.toggle('active', button === color); });
  });
  $('#epub-annotation-list').addEventListener('click', function (e) {
    var removeButton = e.target.closest('[data-delete-annotation]');
    if (removeButton) {
      var id = removeButton.dataset.deleteAnnotation;
      var annotations = epubState.paper && epubState.paper.pdfAnnotations || [];
      var index = annotations.findIndex(function (item) { return item.id === id; });
      if (index === -1) return;
      var removed = annotations[index];
      var undoBefore = makeSnapshot({ papers: [epubState.paper.id] });
      annotations.splice(index, 1);
      detachEpubRenditionAnnotation(removed);
      commitUndo(T('删除批注'), undoBefore, { papers: [epubState.paper.id] });
      save(); renderEpubAnnotations();
      toast(T('已删除批注（笔记中的摘录不受影响）'), 5000, { label: T('撤销'), fn: function () {
        if (!epubState.paper) return;
        epubState.paper.pdfAnnotations.splice(Math.min(index, epubState.paper.pdfAnnotations.length), 0, removed);
        epubState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(epubState.paper.pdfAnnotations);
        attachEpubRenditionAnnotation(removed);
        save(); renderEpubAnnotations(removed.id);
      } });
      return;
    }
    var toNoteButton = e.target.closest('[data-annotation-to-note]');
    if (toNoteButton) {
      if (!epubState.paper) return;
      var annId = toNoteButton.dataset.annotationToNote;
      var source = epubState.paper.pdfAnnotations.find(function (item) { return item.id === annId; });
      if (!source) return;
      var note = currentEpubNote() || createNote(epubState.paper.id, '');
      var added = addAnnotationsToNote(note, [source], epubState.paper);
      if (added) {
        if (epubNotePanel) epubNotePanel.setCurrentId(note.id);
        renderEpubNoteEditor();
        toast(T('✓ 已加入「') + (note.title || T('笔记')) + T('」（可在预览中点 ↩ 定位）'));
      }
      return;
    }
    var tagChip = e.target.closest('[data-annotation-tag-remove]');
    if (tagChip) {
      if (!epubState.paper) return;
      var tagAnn = epubState.paper.pdfAnnotations.find(function (item) { return item.id === tagChip.dataset.annotationTagRemove; });
      if (!tagAnn) return;
      var undoBeforeTag = makeSnapshot({ papers: [epubState.paper.id] });
      tagAnn.tags = (tagAnn.tags || []).filter(function (tag) { return tag !== tagChip.dataset.tag; });
      tagAnn.updatedAt = Date.now();
      epubState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(epubState.paper.pdfAnnotations);
      commitUndo(T('批注移除标签'), undoBeforeTag, { papers: [epubState.paper.id] });
      save(); renderEpubAnnotations(tagAnn.id);
      return;
    }
    if (e.target.closest('textarea') || e.target.closest('input')) return;
    var item = e.target.closest('[data-annotation-id]');
    if (item) focusEpubAnnotation(item.dataset.annotationId);
  });
  $('#epub-annotation-list').addEventListener('keydown', function (e) {
    var input = e.target.closest('[data-annotation-tag-input]');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    if (!epubState.paper) return;
    var tagAnn = epubState.paper.pdfAnnotations.find(function (item) { return item.id === input.dataset.annotationTagInput; });
    var tag = input.value.trim();
    if (!tagAnn || !tag) return;
    var undoBefore = makeSnapshot({ papers: [epubState.paper.id] });
    tagAnn.tags = (tagAnn.tags || []).concat([tag]);
    tagAnn.updatedAt = Date.now();
    epubState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(epubState.paper.pdfAnnotations);
    commitUndo(T('批注加标签'), undoBefore, { papers: [epubState.paper.id] });
    save(); renderEpubAnnotations(tagAnn.id);
  });
  $('#epub-annotation-list').addEventListener('input', function (e) {
    var input = e.target.closest('[data-annotation-comment]');
    if (!input || !epubState.paper) return;
    var annotation = epubState.paper.pdfAnnotations.find(function (item) { return item.id === input.dataset.annotationComment; });
    if (!annotation) return;
    annotation.comment = input.value;
    annotation.updatedAt = Date.now();
    saveEpubAnnotationComment();
  });
  $('#epub-annotations-to-note').addEventListener('click', function () {
    if (epubState.paper) openExcerptDialog(epubState.paper);
  });
  $('#epub-annotations-all-note').addEventListener('click', function () {
    if (!epubState.paper) return;
    var annotations = annotationsForAttachment(epubState.paper, epubState.attachment);
    if (!annotations.length) { toast(T('本篇还没有批注')); return; }
    var note = createNote(epubState.paper.id, '《' + epubState.paper.title + T('》批注笔记'));
    var n = addAnnotationsToNote(note, annotations.slice(), epubState.paper);
    if (epubNotePanel) epubNotePanel.setCurrentId(note.id);
    renderEpubNoteEditor();
    toast(T('✓ 已生成批注笔记（') + n + T(' 条摘录）'));
  });
  window.addEventListener('resize', function () {
    if (!$('#epub-overlay').hidden && epubState.api) epubState.api.resize();
  });
  $('#snapshot-close').addEventListener('click', function () {
    $('#snapshot-mask').hidden = true;
    $('#snapshot-frame').srcdoc = '';
  });

  function createPdfAnnotation(type, comment) {
    if (!pdfState.paper || !pdfState.selectionPositions.length) return;
    var now = Date.now();
    var undoBefore = makeSnapshot({ papers: [pdfState.paper.id] });
    var additions = pdfState.selectionPositions.map(function (position) {
      return {
        id: annotationUid(), type: type, color: pdfState.annotationColor, attachmentId: pdfState.attachmentId,
        text: pdfState.selectedText, comment: comment || '', position: position,
        createdAt: now, updatedAt: now
      };
    });
    pdfState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(
      (pdfState.paper.pdfAnnotations || []).concat(additions)
    );
    syncViewerAnnotations();
    commitUndo(T('添加批注'), undoBefore, { papers: [pdfState.paper.id] });
    save();
    scheduleAutoWriteBack();
    renderPdfAnnotations(additions[0] && additions[0].id);
    var selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    hidePdfTranslation();
    toast(T('已添加') + ({ highlight: T('高亮'), underline: T('下划线'), note: T('批注') }[type] || T('批注')));
  }

  var pdfTranslationAnchor = null;
  function positionPdfTranslation() {
    var popover = $('#pdf-translation-popover');
    if (popover.hidden || !pdfTranslationAnchor) return;
    var view = readingViewport();
    var rect = pdfTranslationAnchor;
    popover.style.maxHeight = Math.max(0, Math.min(330, view.bottom - view.top - 24)) + 'px';
    var top = rect.bottom + 10;
    if (top + popover.offsetHeight > view.bottom - 12) top = Math.max(view.top + 12, rect.top - popover.offsetHeight - 10);
    var left = Math.max(view.left + 12, Math.min(view.right - popover.offsetWidth - 12, rect.left));
    popover.style.left = left + 'px';
    popover.style.top = Math.max(view.top + 12, Math.min(view.bottom - popover.offsetHeight - 12, top)) + 'px';
  }
  function hidePdfTranslation() {
    pdfState.translationRequest++;
    pdfTranslationAnchor = null;
    $('#pdf-translation-popover').hidden = true;
    $('#pdf-translation-result').hidden = true;
    $('#pdf-note-composer').hidden = true;
    $('#pdf-note-text').value = '';
    pdfState.selectedText = '';
    pdfState.selectionPositions = [];
    if (pdfState.handle && pdfState.handle.clearSelection) pdfState.handle.clearSelection();
    refreshAgentChips(); // 选区清空，agent 上下文 chip 同步摘掉
  }
  // 自动翻译偏好：阅读器弹层与设置页两处勾选共享同一状态，落 DB settings 表
  var translatorAutoTranslate = false;
  function setTranslatorAutoTranslate(value, persist) {
    translatorAutoTranslate = value === true;
    var popoverBox = $('#pdf-auto-translate');
    if (popoverBox) popoverBox.checked = translatorAutoTranslate;
    var settingsBox = $('#sync-translator-auto');
    if (settingsBox) settingsBox.checked = translatorAutoTranslate;
    if (persist && desktop && desktop.setSetting) {
      desktop.setSetting('translatorAutoTranslate', translatorAutoTranslate).catch(function () {});
    }
  }
  function showPdfTranslationSelection() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return hidePdfTranslation();
    var range = selection.getRangeAt(0);
    var scroll = $('#pdf-scroll');
    var node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!node || !scroll.contains(node)) return hidePdfTranslation();
    var selectionData = pdfState.handle && pdfState.handle.selectionToData
      ? pdfState.handle.selectionToData(range)
      : { text: selection.toString(), positions: pdfState.handle ? pdfState.handle.selectionToPositions(range) : [] };
    var text = selectionData.text.replace(/\s+/g, ' ').trim();
    if (!text) return hidePdfTranslation();
    var positions = selectionData.positions;
    if (!positions.length) return hidePdfTranslation();
    pdfState.selectedText = text.slice(0, 12000);
    pdfState.selectionPositions = positions;
    refreshAgentChips(); // 新选区落定，agent 上下文 chip 即时反映「选中：第 N 页」
    $('#pdf-translation-source').textContent = pdfState.selectedText;
    $('#pdf-translation-provider').textContent = T('可批注或翻译');
    $('#pdf-translation-result').hidden = true;
    $('#pdf-translation-result').textContent = '';
    $('#pdf-translate-selection').disabled = false;
    $('#pdf-translate-selection').textContent = T('翻译');
    var popover = $('#pdf-translation-popover');
    popover.hidden = false;
    // 译文异步填入会改变高度；保留选区位置，让 ResizeObserver 在尺寸变化后重新定位。
    pdfTranslationAnchor = range.getBoundingClientRect();
    positionPdfTranslation();
    if (translatorAutoTranslate) translatePdfSelection();
  }
  function translatePdfSelection() {
    if (!pdfState.selectedText) return;
    if (!desktop || !desktop.translateSelection) { toast(T('划词翻译仅在桌面版可用')); return; }
    var requestId = ++pdfState.translationRequest;
    var button = $('#pdf-translate-selection');
    button.disabled = true;
    button.textContent = T('翻译中…');
    $('#pdf-translation-provider').textContent = T('正在请求翻译服务');
    $('#pdf-translation-result').hidden = false;
    $('#pdf-translation-result').textContent = T('正在翻译…');
    desktop.translateSelection({ text: pdfState.selectedText }).then(function (result) {
      if (requestId !== pdfState.translationRequest) return;
      $('#pdf-translation-provider').textContent = TRANSLATOR_NAMES[result.provider] || result.provider;
      $('#pdf-translation-result').textContent = result.translation;
    }).catch(function (error) {
      if (requestId !== pdfState.translationRequest) return;
      $('#pdf-translation-provider').textContent = T('翻译失败');
      $('#pdf-translation-result').textContent = error && error.message || String(error);
    }).finally(function () {
      if (requestId === pdfState.translationRequest) { button.disabled = false; button.textContent = T('翻译'); }
    });
  }
  function closePdfViewer() {
    if ($('#pdf-overlay').hidden) return;
    pdfSearchPanelOpen(false);
    if (!pdfState.paper) { hidePdfOverlay(); return; }
    closePdfTab(pdfState.paper.id + ':' + pdfState.attachmentId); // 关闭当前标签；最后一个关闭时收起阅读器
  }
  /* M3：窄窗 PDF 搜索浮层——≤1220px 时搜索框收起，经切换按钮 / Ctrl+F 唤出；Esc 先收起 */
  function pdfSearchPanelOpen(open) {
    var tools = document.querySelector('.pdf-tools');
    if (!tools) return;
    var wantOpen = typeof open === 'boolean' ? open : !tools.classList.contains('pdf-search-open');
    tools.classList.toggle('pdf-search-open', wantOpen);
    var toggleBtn = $('#pdf-search-toggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-pressed', wantOpen ? 'true' : 'false');
    if (wantOpen) {
      var input = $('#pdf-search');
      input.focus();
      input.select();
    }
  }
  function zoomPdf(delta) {
    pdfState.scale = Math.max(0.6, Math.min(3, Math.round((pdfState.scale + delta) * 100) / 100));
    applyPdfViewChange();
  }
  function togglePdfLayout() {
    pdfState.layout = pdfState.layout === 'single' ? 'spread' : 'single';
    applyPdfViewChange();
  }
  function rotatePdf() {
    pdfState.rotation = (pdfState.rotation + 90) % 360;
    applyPdfViewChange();
  }
  function fitPdfWidth() {
    if (!pdfState.handle || !pdfState.handle.doc) return;
    var scroll = $('#pdf-scroll');
    var pageNumber = pdfState.currentPage || 1;
    pdfState.handle.doc.getPage(pageNumber).then(function (page) {
      var viewport = page.getViewport({ scale: 1, rotation: pdfState.rotation });
      var available = Math.max(240, scroll.clientWidth - 48);
      if (pdfState.layout === 'spread' && scroll.clientWidth > 900) available = (available - 16) / 2;
      pdfState.scale = Math.max(0.6, Math.min(3, Math.round(available / viewport.width * 100) / 100));
      applyPdfViewChange();
    });
  }
  function goToPdfPage(page) {
    if (!pdfState.handle || !pdfState.pageCount) return;
    page = Math.max(1, Math.min(pdfState.pageCount, Number(page) || 1));
    pdfState.handle.goToPage(page);
    updatePdfPageUi(page, pdfState.pageCount);
    saveReadPos();
  }

  function markPdfSearchPage(page) {
    $all('#pdf-scroll .pdf-page-sheet.pdf-search-hit-page').forEach(function (sheet) { sheet.classList.remove('pdf-search-hit-page'); });
    var sheet = $('#pdf-scroll .pdf-page-sheet[data-page="' + page + '"]');
    if (sheet) sheet.classList.add('pdf-search-hit-page');
  }
  function pageSearchResult(pageIndex) {
    for (var i = 0; i < pdfState.searchResults.length; i++) {
      if (pdfState.searchResults[i].pageIndex === pageIndex) return pdfState.searchResults[i];
    }
    return null;
  }
  function applyPdfSearchHighlights(pageIndex, activeIndex) {
    var sheet = $('#pdf-scroll .pdf-page-sheet[data-page="' + (pageIndex + 1) + '"]');
    if (!sheet || !sheet._litTextDivs) return;
    var pageResult = pageSearchResult(pageIndex);
    window.LitPdf.renderSearchLayer(sheet, pageResult ? pageResult.matches : [], activeIndex == null ? -1 : activeIndex);
  }
  /** 换查询后重画全部已渲染页：goToPdfSearchResult 只重画当前命中页，其它页上一轮
   *  查询的高亮会残留（逐字输入时每个中间态各跳一次页，残留更多）；renderSearchLayer
   *  对空结果也会先移除旧层，无命中的页借此一并清干净 */
  function repaintAllPdfSearchHighlights() {
    $all('#pdf-scroll .pdf-page-sheet').forEach(function (sheet) {
      var page = Number(sheet.dataset.page);
      if (page) applyPdfSearchHighlights(page - 1, -1);
    });
  }
  function clearPdfSearchHighlights() {
    $all('#pdf-scroll .pdf-search-layer').forEach(function (layer) { layer.remove(); });
  }
  function onPdfSheetRendered(sheet, pageIndex) {
    if (!pdfState.searchMatches.length) return;
    var activeIndex = -1;
    var current = pdfState.searchMatches[pdfState.searchIndex];
    if (current && current.pageIndex === pageIndex) activeIndex = current.matchIndex;
    applyPdfSearchHighlights(pageIndex, activeIndex);
  }
  function goToPdfSearchResult(delta) {
    if (!pdfState.searchMatches.length) return;
    pdfState.searchIndex = (pdfState.searchIndex + delta + pdfState.searchMatches.length) % pdfState.searchMatches.length;
    var match = pdfState.searchMatches[pdfState.searchIndex];
    $('#pdf-search-status').textContent = (pdfState.searchIndex + 1) + '/' + pdfState.searchMatches.length + T(' 匹配');
    $('#pdf-search-status').title = T('第 ') + (match.pageIndex + 1) + T(' 页');
    markPdfSearchPage(match.pageIndex + 1);
    pdfState.handle.goToPage(match.pageIndex + 1).then(function () {
      applyPdfSearchHighlights(match.pageIndex, match.matchIndex);
    });
    updatePdfPageUi(match.pageIndex + 1, pdfState.pageCount);
  }
  /** 检索选项开关（区分大小写 / 全字匹配）：aria-pressed 是唯一状态源，偏好存 localStorage */
  function pdfSearchOptionOn(id) {
    var button = $(id);
    return !!(button && button.getAttribute('aria-pressed') === 'true');
  }
  function bindPdfSearchOption(id, key) {
    var button = $(id);
    if (!button) return;
    button.setAttribute('aria-pressed', localStorage.getItem(key) === '1' ? 'true' : 'false');
    button.addEventListener('click', function () {
      var on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {}
      performPdfSearch(false);
    });
  }
  function performPdfSearch(preserveIndex) {
    var query = $('#pdf-search').value.trim();
    if (!pdfState.handle || !query) {
      pdfState.searchResults = []; pdfState.searchMatches = []; pdfState.searchIndex = -1;
      $('#pdf-search-status').textContent = '';
      markPdfSearchPage(-1);
      clearPdfSearchHighlights();
      return;
    }
    var handle = pdfState.handle;
    $('#pdf-search-status').textContent = T('搜索中');
    handle.search(query, {
      caseSensitive: pdfSearchOptionOn('#pdf-search-case'),
      wholeWord: pdfSearchOptionOn('#pdf-search-word')
    }).then(function (results) {
      if (handle !== pdfState.handle) return;
      var matches = [];
      results.forEach(function (pageResult) {
        pageResult.matches.forEach(function (match, matchIndex) {
          matches.push({ pageIndex: pageResult.pageIndex, page: pageResult.page, matchIndex: matchIndex, text: match.text });
        });
      });
      pdfState.searchResults = results;
      pdfState.searchMatches = matches;
      pdfState.searchIndex = preserveIndex ? Math.min(pdfState.searchIndex, matches.length - 1) : -1;
      if (!matches.length) {
        $('#pdf-search-status').textContent = T('无结果');
        markPdfSearchPage(-1);
        clearPdfSearchHighlights();
        return;
      }
      repaintAllPdfSearchHighlights();
      goToPdfSearchResult(1);
    }).catch(function () { $('#pdf-search-status').textContent = T('搜索失败'); });
  }

  // ---------- 库内查重与合并 ----------
  function mergeGroupIntoState(group) {
    var mergedSource = window.LitDedupe.merge(group);
    var attachmentMerge = window.LitDedupe.mergeAttachmentsDetailed({ attachments: mergedSource.attachments }, null);
    mergedSource.attachments = attachmentMerge.attachments;
    mergedSource.pdfAnnotations = remapAnnotationAttachments(mergedSource.pdfAnnotations, attachmentMerge.aliases).annotations;
    var merged = window.LitModel.normalizePaper(mergedSource, uid);
    var dropIds = {};
    group.forEach(function (p) { if (p.id !== merged.id) dropIds[p.id] = true; });
    var now = Date.now();
    merged.updatedAt = now;
    function redirectExcerpt(content, oldId, newId) {
      var value = String(content || '');
      var quoted = value.replace(new RegExp('(\\"paperId\\"\\s*:\\s*\\")' + oldId + '(\\")', 'g'), '$1' + newId + '$2');
      return quoted.replace(new RegExp('(&quot;paperId&quot;\\s*:\\s*&quot;)' + oldId + '(&quot;)', 'g'), '$1' + newId + '$2');
    }
    for (var i = 0; i < state.papers.length; i++) {
      if (state.papers[i].id === merged.id) { state.papers[i] = merged; break; }
    }
    state.papers.forEach(function (paper) {
      if (dropIds[paper.id]) {
        paper.deletedAt = now;
        paper.updatedAt = now;
      }
      if (!paper.relatedIds || !paper.relatedIds.length) return;
      var seen = {}, related = [];
      paper.relatedIds.forEach(function (id) {
        var next = dropIds[id] ? merged.id : id;
        if (next !== paper.id && !seen[next]) { seen[next] = true; related.push(next); }
      });
      paper.relatedIds = related;
    });
    state.notes.forEach(function (note) {
      if (dropIds[note.paperId]) {
        var oldNotePaperId = note.paperId;
        note.paperId = merged.id;
        note.content = redirectExcerpt(note.content, oldNotePaperId, merged.id);
        window.LitModel.touch(note);
      } else {
        Object.keys(dropIds).forEach(function (oldId) {
          var next = redirectExcerpt(note.content, oldId, merged.id);
          if (next !== note.content) { note.content = next; window.LitModel.touch(note); }
        });
      }
    });
    Object.keys(dropIds).forEach(function (id) { delete state.selected[id]; });
    if (drawerId && dropIds[drawerId]) closeDrawer();
    if (window.LitPdfSearch && LitPdfSearch.invalidate) {
      Object.keys(attachmentMerge.aliases).forEach(function (removedId) {
        if (removedId && removedId !== attachmentMerge.aliases[removedId]) {
          LitPdfSearch.invalidate(merged.id, removedId);
        }
      });
    }
  }

  function renderDedupeModal() {
    var groups = window.LitDedupe.findGroups(state.papers.filter(function (p) { return !p.deletedAt; }));
    var list = $('#dedupe-list');
    list.innerHTML = '';
    $('#dedupe-merge-all').hidden = groups.length === 0;
    $('#dedupe-summary').textContent = groups.length
      ? T('发现 ') + groups.length + T(' 组重复（按 PDF 内容或 DOI 精确匹配）。合并保留信息最完整的一条，其余条目的空缺字段、标签、笔记并入后删除。')
      : '';
    if (!groups.length) {
      list.innerHTML = T('<div class="dedupe-empty">未发现重复文献（按 PDF 内容 / DOI 精确匹配）</div>');
      return;
    }
    groups.forEach(function (group, gi) {
      var box = document.createElement('div');
      box.className = 'dedupe-group';
      var head = document.createElement('div');
      head.className = 'dedupe-group-head';
      var title = document.createElement('span');
      title.className = 'dedupe-group-title';
      title.textContent = T('第 ') + (gi + 1) + T(' 组 · ') + group.length + T(' 篇');
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = T('合并这 ') + group.length + T(' 篇');
      btn.addEventListener('click', function () {
        mergeGroupIntoState(group);
        save(); renderAll();
        toast(T('✓ 已合并 ') + group.length + T(' 篇为 1 篇'));
        renderDedupeModal();
      });
      head.appendChild(title); head.appendChild(btn);
      box.appendChild(head);
      group.forEach(function (p, pi) {
        var row = document.createElement('div');
        row.className = 'dedupe-entry';
        var badge = document.createElement('span');
        badge.className = pi === 0 ? 'dedupe-keep-badge' : 'dedupe-drop-badge';
        badge.textContent = pi === 0 ? T('保留') : T('并入');
        var main = document.createElement('div');
        main.className = 'dedupe-entry-main';
        var t = document.createElement('div');
        t.className = 'dedupe-entry-title';
        t.textContent = p.title;
        var sub = document.createElement('div');
        sub.className = 'dedupe-entry-sub';
        var bits = [];
        if (p.year != null) bits.push(p.year);
        if (p.venue) bits.push(p.venue);
        if (p.doi) bits.push('DOI: ' + p.doi);
        bits.push(STATUS_LABEL[p.status] || p.status);
        if (p.notes) bits.push(svgUse('lb-i-note') + T('有笔记'));
        if (p.pdfPath || p.pdfFileName) bits.push(svgUse('lb-i-doc') + 'PDF');
        if (p.addedAt) bits.push(T('加入于 ') + new Date(p.addedAt).toLocaleDateString());
        sub.textContent = bits.join(' · ');
        main.appendChild(t); main.appendChild(sub);
        row.appendChild(badge); row.appendChild(main);
        box.appendChild(row);
      });
      list.appendChild(box);
    });
  }

  // ---------- 批量补全 ----------
  function bulkEnrich(papers) {
    if (enrichRun) { toast(T('正在补全中…（顶栏按钮可暂停，✕ 中断）')); return; }
    if (!papers.length) return;
    startEnrichRun(papers, T('正在补全选中的 '));
  }

  // ---------- 示例数据 ----------
  var DEMO = [
    { title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'], year: 2017, venue: 'NeurIPS', doi: '10.48550/arXiv.1706.03762', tags: [T('深度学习'), T('经典')], status: 'reading', rating: 5, entryType: 'inproceedings' },
    { title: 'Deep Residual Learning for Image Recognition', authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'], year: 2016, venue: 'CVPR', doi: '10.1109/CVPR.2016.90', tags: [T('深度学习'), T('经典')], status: 'reading', rating: 5, entryType: 'inproceedings' },
    { title: 'Highly accurate protein structure prediction with AlphaFold', authors: ['John Jumper', 'Richard Evans'], year: 2021, venue: 'Nature', doi: '10.1038/s41586-021-03819-2', tags: ['AI for Science'], status: 'reading', rating: 0 },
    { title: 'Language Models are Few-Shot Learners', authors: ['Tom B. Brown', 'Benjamin Mann'], year: 2020, venue: 'NeurIPS', doi: '10.48550/arXiv.2005.14165', tags: [T('深度学习'), 'LLM'], status: 'unread', rating: 0, entryType: 'inproceedings' },
    { title: 'A survey on evaluation of large language models', authors: ['Yupeng Chang', 'Xu Wang'], year: 2024, venue: 'ACM TIST', doi: '10.1145/3641289', tags: ['LLM', T('综述')], status: 'unread', rating: 0 }
  ];

  function loadDemo() {
    var r = addPapers(DEMO);
    toast(T('✓ 已载入 ') + r.added + T(' 篇示例，点「一键补全」试试联网获取摘要和被引数'));
    renderAll();
  }

  // ---------- 坚果云 / Zotero 同步 ----------
  var syncBusy = false;
  var libraryLoadFailed = false; // 本地库最近一次读取失败时置位：阻止联网同步，防止把空库传上云端
  var autoSyncEnabled = true; // 「内容变化时自动同步」开关；关闭后仅手动「立即同步」/对照应用触发
  var integrationConfig = null;
  var dataPathInfo = null;
  var nutstoreSyncTimer = null;
  var TRANSLATOR_HELP = {
    volc: {
      name: T('火山翻译（免费接口）'),
      free: true,
      url: 'https://translate.volcengine.com',
      label: T('火山翻译网页版'),
      note: T('字节跳动火山翻译网页端接口，国内直连、无需凭据，默认服务商。')
    },
    tencent: {
      name: T('腾讯交互翻译（免费接口）'),
      free: true,
      url: 'https://transmart.qq.com',
      label: T('腾讯交互翻译官网'),
      note: T('腾讯 TranSmart 交互翻译网页端接口，国内直连、无需凭据。')
    },
    google: {
      name: T('谷歌翻译（免费接口）'),
      free: true,
      url: 'https://translate.google.com',
      label: T('谷歌翻译网页版'),
      note: T('网页版免费接口，长文本自动按句分块；大陆网络需自行配置代理。')
    },
    cnki: {
      name: T('CNKI 学术翻译（免费接口）'),
      free: true,
      url: 'https://dict.cnki.net',
      label: T('CNKI 学术翻译网页版'),
      note: T('中国知网学术翻译，学术术语友好、自动中英互译；单次约 800 字自动分块，被限流时到网页版过一次人机验证。')
    },
    mymemory: {
      name: T('MyMemory 翻译记忆库（免费接口）'),
      free: true,
      url: 'https://mymemory.translated.net',
      label: T('MyMemory 官网'),
      note: T('翻译记忆库匹配，匿名每日约 5000 字符配额，超配额请明日再用或换其他服务商。')
    },
    qwen: {
      name: 'Qwen / DashScope',
      url: 'https://help.aliyun.com/zh/model-studio/get-api-key',
      label: T('阿里云百炼控制台'),
      note: T('申请 DashScope API Key；默认模型为 qwen-mt-plus。')
    },
    aliyun: {
      name: T('阿里云机器翻译'),
      url: 'https://help.aliyun.com/zh/machine-translation/getting-started/activate-machine-translation-for-developers',
      label: T('机器翻译开通文档'),
      note: T('先开通机器翻译，再创建 AccessKey，凭据格式为 AccessKey ID@AccessKey Secret。')
    },
    openai: {
      name: 'OpenAI',
      url: 'https://platform.openai.com/api-keys',
      label: 'OpenAI API keys',
      note: T('创建 API Key；默认模型为 gpt-4o-mini。')
    },
    deepseek: {
      name: 'DeepSeek',
      url: 'https://platform.deepseek.com/api_keys',
      label: 'DeepSeek API keys',
      note: T('创建 API Key；默认模型为 deepseek-chat。')
    }
  };
  var TRANSLATOR_NAMES = {
    volc: T('火山翻译'),
    tencent: T('腾讯交互翻译'),
    google: T('谷歌翻译'),
    cnki: T('CNKI 学术翻译'),
    mymemory: 'MyMemory',
    qwen: 'Qwen',
    aliyun: T('阿里云机器翻译'),
    openai: 'OpenAI',
    deepseek: 'DeepSeek'
  };

  function scheduleNutstoreSync(force) {
    if (!desktop || !desktop.getIntegrationConfig) return;
    // 库未加载成功（含启动读取失败）：不排队联网同步，空工作区上传会清空云端
    if (libraryLoadFailed) return;
    // 关闭自动同步时忽略变化触发的调度；force 仅供进行中的同步收尾重排队
    if (!force && !autoSyncEnabled) return;
    clearTimeout(nutstoreSyncTimer);
    nutstoreSyncTimer = setTimeout(function () {
      nutstoreSyncTimer = null;
      if (syncBusy) { scheduleNutstoreSync(force); return; }
      desktop.getIntegrationConfig().then(function (config) {
        integrationConfig = config;
        return performSync(config, true);
      }).catch(function () {});
    }, 1200);
  }

  /* 设置表单是否已按配置装载过（fillSyncForm 收尾置位）。未装载时表单里只有 HTML 默认值
     ——下拉首项、空输入框、默认勾选态；把这些提交上去等于用默认值覆盖已存配置
     （打开设置页时读配置失败就停在这种状态，见 openSyncSettings 的错误分支）。
     未装载时提交空对象：saveConfig 逐字段「缺省沿用现值」，即整份配置原样不动。 */
  var syncFormLoaded = false;

  function syncFormValue() {
    if (!syncFormLoaded) return {};
    return {
      nutstoreUrl: $('#sync-nutstore-url').value.trim(),
      nutstoreUser: $('#sync-nutstore-user').value.trim(),
      nutstorePassword: $('#sync-nutstore-password').value,
      nutstoreFolder: $('#sync-nutstore-folder').value.trim(),
      zoteroWebDavFolder: $('#sync-zotero-webdav-folder').value.trim(),
      zoteroDataDir: $('#sync-zotero-dir').value.trim(),
      translatorProvider: $('#sync-translator-provider').value,
      translatorModel: $('#sync-translator-model').value.trim(),
      translatorTarget: $('#sync-translator-target').value,
      translatorApiKey: secretInputValue('sync-translator-api-key'),
      rankProvider: $('#sync-rank-provider').value,
      scigreatApiKey: secretInputValue('sync-scigreat-api-key'),
      easyscholarApiKey: secretInputValue('sync-easyscholar-api-key'),
      /* AI 助手「服务商 + 模型」：清单由本页草稿承载（含刚敲、尚未保存的明文 Key），
       * 主进程按 id 合并。草稿还没装载（设置从未打开）时两项都不提交——提交空清单会把
       * 服务商全删掉，提交空 activeProviderId 会把当前选中项打回内置服务商。 */
      agentProviders: agentProvidersForForm(),
      agentActiveProviderId: agentProvidersDraft ? agentProvidersActiveId : undefined,
      // 默认值也会展示给用户；若用户未改默认显示值，仍提交空串保持「未显式设置」的存储语义。
      agentContextTokens: agentBudgetFormValue('sync-agent-context-tokens'),
      agentMaxOutputTokens: agentBudgetFormValue('sync-agent-max-output-tokens'),
      openalexEmail: $('#sync-openalex-email') ? $('#sync-openalex-email').value.trim() : '',
      openalexApiKey: secretInputValue('sync-openalex-key'),
      embedProvider: $('#sync-embed-provider') ? $('#sync-embed-provider').value : '',
      embedBaseUrl: $('#sync-embed-base-url') ? $('#sync-embed-base-url').value.trim() : '',
      embedModel: $('#sync-embed-model') ? $('#sync-embed-model').value.trim() : '',
      embedApiKey: secretInputValue('sync-embed-api-key'),
      elsevierApiKey: secretInputValue('sync-elsevier-key'),
      tinyfishApiKey: secretInputValue('sync-tinyfish-key')
    };
  }

  function agentBudgetDefaults() {
    var defaults = window.LitAgentCore && LitAgentCore.DEFAULTS;
    return {
      contextTokens: Number(defaults && defaults.contextTokens) || 256000,
      maxOutputTokens: Number(defaults && defaults.maxOutputTokens) || 12800
    };
  }

  function fillAgentBudgetInput(id, configuredValue, fallback) {
    var input = $('#' + id);
    if (!input) return;
    var explicit = Number(configuredValue) > 0;
    input.value = String(explicit ? configuredValue : fallback);
    input.dataset.defaultValue = String(fallback);
    input.dataset.usingDefault = explicit ? '0' : '1';
  }

  function agentBudgetFormValue(id) {
    var input = $('#' + id);
    if (!input) return '';
    var value = input.value.trim();
    return input.dataset.usingDefault === '1' && value === input.dataset.defaultValue ? '' : value;
  }

  function secretInputValue(id) {
    var input = $('#' + id);
    return input && input.dataset.secretState !== 'masked' ? input.value : '';
  }

  function secretInputShell(input) {
    if (!input) return null;
    if (input.parentNode && input.parentNode.classList.contains('secret-key-shell')) return input.parentNode;
    var shell = document.createElement('div');
    shell.className = 'secret-key-shell';
    input.parentNode.insertBefore(shell, input);
    shell.appendChild(input);
    return shell;
  }

  function secretRefOf(input) {
    return { kind: input.dataset.secretKind || '', providerId: input.dataset.secretProviderId || '' };
  }

  function replaceSecretInput(input) {
    input.dataset.secretState = 'editing';
    input.value = '';
    input.type = 'password';
    input.readOnly = false;
    input.classList.remove('key-retained');
    input.placeholder = input.dataset.emptyPlaceholder || T('粘贴 API Key');
    input.title = '';
    var actions = secretInputShell(input).querySelector('.secret-key-actions');
    if (actions) actions.hidden = true;
    input.focus();
  }

  function bindSecretActions(input) {
    if (!input || input.dataset.secretBound === '1') return;
    input.dataset.secretBound = '1';
    var shell = secretInputShell(input);
    var actions = document.createElement('span');
    actions.className = 'secret-key-actions';
    var copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'btn btn-ghost btn-xs'; copy.textContent = T('复制');
    copy.addEventListener('click', function () {
      var ref = secretRefOf(input);
      var job = input.dataset.secretState === 'revealed' ? copyToClipboard(input.value)
        : (desktop && desktop.copyIntegrationSecret ? desktop.copyIntegrationSecret(ref) : Promise.reject(new Error('not available')));
      Promise.resolve(job).then(function () { toast(T('✓ 已复制')); }).catch(function (error) { toast(String(error && error.message || error)); });
    });
    var view = document.createElement('button');
    view.type = 'button'; view.className = 'btn btn-ghost btn-xs'; view.textContent = T('查看');
    view.addEventListener('click', function () {
      if (input.dataset.secretState === 'revealed') { renderMaskedSecret(input); return; }
      if (!desktop || !desktop.revealIntegrationSecret) return;
      desktop.revealIntegrationSecret(secretRefOf(input)).then(function (secret) {
        if (!secret) throw new Error(T('未找到已保存的 API Key'));
        input.value = secret; input.type = 'text'; input.readOnly = true;
        input.dataset.secretState = 'revealed'; input.classList.add('key-retained');
        input.title = T('已显示完整 Key；再次点“查看”恢复脱敏显示');
      }).catch(function (error) { toast(String(error && error.message || error)); });
    });
    var edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'btn btn-ghost btn-xs'; edit.textContent = T('编辑');
    edit.addEventListener('click', function () { replaceSecretInput(input); });
    actions.appendChild(copy); actions.appendChild(view); actions.appendChild(edit);
    shell.appendChild(actions);
  }

  function renderMaskedSecret(input) {
    input.value = input.dataset.secretHint || '****';
    input.type = 'text'; input.readOnly = true;
    input.dataset.secretState = 'masked'; input.classList.add('key-retained');
    input.placeholder = ''; input.title = T('已保存 Key（留空则保持不变）');
    var actions = secretInputShell(input).querySelector('.secret-key-actions');
    if (actions) actions.hidden = false;
  }

  function markRetainedKey(id, saved, hint, ref) {
    var input = $('#' + id);
    if (!input) return;
    if (!input.dataset.emptyPlaceholder) input.dataset.emptyPlaceholder = input.placeholder;
    if (!saved) {
      input.dataset.secretState = '';
      input.type = 'password'; input.readOnly = false;
      input.placeholder = input.dataset.emptyPlaceholder; input.title = '';
      input.classList.remove('key-retained');
      var hiddenActions = secretInputShell(input).querySelector('.secret-key-actions');
      if (hiddenActions) hiddenActions.hidden = true;
      return;
    }
    input.dataset.secretKind = ref && ref.kind || '';
    input.dataset.secretProviderId = ref && ref.providerId || '';
    input.dataset.secretHint = hint || '****';
    bindSecretActions(input);
    renderMaskedSecret(input);
  }

  /** 期刊分区只展示当前服务商需要的那把凭据；两把已存 Key 都保留，切换不会清空。 */
  function updateRankProviderFields() {
    var provider = $('#sync-rank-provider').value;
    $all('[data-rank-provider-key]').forEach(function (field) {
      field.hidden = field.dataset.rankProviderKey !== provider;
    });
  }

  function fillSyncForm(config) {
    integrationConfig = config;
    $('#sync-nutstore-url').value = config.nutstoreUrl || 'https://dav.jianguoyun.com/dav/';
    $('#sync-nutstore-user').value = config.nutstoreUser || '';
    $('#sync-nutstore-password').value = '';
    $('#sync-nutstore-folder').value = config.nutstoreFolder || 'LitBoard';
    $('#sync-zotero-webdav-folder').value = config.zoteroWebDavFolder || 'zotero';
    $('#sync-zotero-dir').value = config.zoteroDataDir || '';
    $('#sync-translator-provider').value = config.translatorProvider || 'volc';
    $('#sync-translator-model').value = config.translatorModel || '';
    $('#sync-translator-target').value = config.translatorTarget || 'zh';
    $('#sync-translator-api-key').value = '';
    updateTranslatorFields();
    $('#sync-rank-provider').value = config.rankProvider || 'scigreat';
    $('#sync-scigreat-api-key').value = '';
    $('#sync-easyscholar-api-key').value = '';
    markRetainedKey('sync-scigreat-api-key', !!config.hasScigreatApiKey, config.scigreatApiKeyHint, { kind: 'scigreat' });
    markRetainedKey('sync-easyscholar-api-key', !!config.hasEasyscholarApiKey, config.easyscholarApiKeyHint, { kind: 'easyscholar' });
    updateRankProviderFields();
    if ($('#agent-provider-items')) {
      // AI 助手服务商清单：草稿从配置装载（含 hasApiKey 占位），明文 Key 只在用户重填时进草稿
      loadAgentProviders(config);
      var budgets = agentBudgetDefaults();
      fillAgentBudgetInput('sync-agent-context-tokens', config.agentContextTokens, budgets.contextTokens);
      fillAgentBudgetInput('sync-agent-max-output-tokens', config.agentMaxOutputTokens, budgets.maxOutputTokens);
      $('#sync-openalex-email').value = config.openalexEmail || '';
      $('#sync-openalex-key').value = '';
      markRetainedKey('sync-openalex-key', !!config.hasOpenalexApiKey, config.openalexApiKeyHint, { kind: 'openalex' });
      if ($('#sync-embed-provider')) $('#sync-embed-provider').value = config.embedProvider || '';
      if ($('#sync-embed-base-url')) $('#sync-embed-base-url').value = config.embedBaseUrl || '';
      $('#sync-embed-model').value = config.embedModel || '';
      if ($('#sync-embed-api-key')) $('#sync-embed-api-key').value = '';
      markRetainedKey('sync-embed-api-key', !!config.hasEmbedApiKey, config.embedApiKeyHint, { kind: 'embed' });
      $('#sync-elsevier-key').value = '';
      markRetainedKey('sync-elsevier-key', !!config.hasElsevierApiKey, config.elsevierApiKeyHint, { kind: 'elsevier' });
      $('#sync-tinyfish-key').value = '';
      markRetainedKey('sync-tinyfish-key', !!config.hasTinyfishApiKey, config.tinyfishApiKeyHint, { kind: 'tinyfish' });
    }
    if (desktop.getSetting && $('#sync-web-search-enabled')) {
      desktop.getSetting('webSearchEnabled').then(function (value) {
        $('#sync-web-search-enabled').checked = value === true;
      }).catch(function () {});
    }
    refreshEmbedUsageLine();
    refreshEmbedSourceHint();
    // 表单已按真实配置装载：从这里起才允许把表单值提交回配置
    syncFormLoaded = true;
  }

  /** 向量嵌入用量行（设置页常驻展示） */
  function refreshEmbedUsageLine() {
    var target = $('#sync-embed-usage');
    if (!target || !desktop.researchEmbedUsage) return;
    desktop.researchEmbedUsage().then(function (u) {
      target.textContent = T('嵌入用量：') + (u.tokens || 0) + T(' tokens / ') + (u.requests || 0) + T(' 次请求');
    }).catch(function () {});
  }

  /** 向量模型来源提示：如实说明「调研库向量当前用谁的端点与 Key」。
   * 解析规则与主进程同一份（js/embedcfg.js），所以这里显示什么，实际就发什么。 */
  function refreshEmbedSourceHint() {
    var target = $('#sync-embed-source');
    if (!target || !window.LitEmbedCfg) return;
    var pendingKey = secretInputValue('sync-embed-api-key');
    var known = integrationConfig || {};
    var target_ = LitEmbedCfg.resolveTarget({
      embedProvider: $('#sync-embed-provider') ? $('#sync-embed-provider').value : '',
      embedBaseUrl: $('#sync-embed-base-url') ? $('#sync-embed-base-url').value.trim() : '',
      embedApiKey: pendingKey || (known.hasEmbedApiKey ? 'set' : ''),
      embedModel: $('#sync-embed-model') ? $('#sync-embed-model').value.trim() : '',
      agentBaseUrl: known.agentBaseUrl || '',
      agentApiKey: known.hasAgentApiKey ? 'set' : ''
    });
    if (!target_.ok) { target.textContent = T(target_.reason); return; }
    if (target_.source === 'configured') {
      target.textContent = T('调研库向量将使用上面这套独立配置：{url}', { url: embedEndpointOf(target_.baseUrl) });
      return;
    }
    target.textContent = T('未填独立的 Base URL / API Key：调研库向量沿用 AI 助手端点 {url}（模型 {model}）', {
      url: embedEndpointOf(target_.baseUrl), model: target_.model
    });
  }

  /** 嵌入端点推导复用协议层的规则（去掉尾段再拼 /embeddings），避免设置页与实际发包地址不一致 */
  function embedEndpointOf(baseUrl) {
    if (window.LitAgentProto) return LitAgentProto.embeddingsEndpointFor(baseUrl);
    return String(baseUrl || '').replace(/\/+$/, '') + '/embeddings';
  }

  /* ===== AI 调研助手（一期）：设置区绑定与抽屉初始化 ===== */
  /** 接口格式提示：如实显示「当前 Base URL + 模型名会按哪种协议、发到哪个地址」。
   * 配 opencode / anthropic 兼容端点时最容易踩的坑就是「URL 看着对、协议不对」。 */
  function refreshAgentDialectHint() {
    var target = $('#agent-p-dialect-hint');
    if (!target) return;
    var base = $('#agent-p-base-url') ? $('#agent-p-base-url').value.trim() : '';
    if (!base || !window.LitAgentProto) {
      target.textContent = T('填好 Base URL 后会显示实际使用的接口协议与请求地址');
      return;
    }
    var provider = agentProviderDraft(agentProviderSelected);
    var dialect = LitAgentProto.detectDialect(base, {
      dialect: $('#agent-p-dialect') ? $('#agent-p-dialect').value : '',
      model: (provider && provider.activeModel) || ''
    });
    // 协议名是专有名词（与品牌名同例：界面语言 ≠ 协议名），不进词典
    var labels = {
      chat: 'OpenAI Chat Completions',
      responses: 'OpenAI Responses',
      messages: 'Anthropic Messages'
    };
    target.textContent = T('将按 {dialect} 发包：{url}', {
      dialect: labels[dialect] || dialect,
      url: LitAgentProto.endpointFor(base, dialect)
    });
  }

  /* ===== AI 助手「模型与服务商」（设置 → 集成与服务 → AI 助手） =====
   * 配置语义全在 js/agentcfg.js（浏览器/Node 共用纯函数）；这里只维护**草稿**：
   * 服务商清单 + 当前选中项 + 详情区正在编辑的那一个。任何改动都走既有的自动保存
   * 通道（syncFormValue → integrations:save-config），主进程按 id 合并 Key
   * （非空 = 更新，留空/缺省 = 保持原值），所以清单里的 Key 只在用户重填时进草稿。 */
  var agentProvidersDraft = null;     // 未打开过设置时为 null：此时不提交清单，免得清空配置
  var agentProvidersActiveId = '';    // 当前生效的服务商（对话面板底部显示的就是它）
  var agentProviderSelected = '';     // 详情区正在编辑的服务商
  var AGENT_PRESET_HINTS = {          // 选预设时顺手填进「添加模型」输入框的建议值（不落配置）
    'https://opencode.ai/zen/go/v1': 'deepseek-flash',
    'https://opencode.ai/zen/v1': 'deepseek-flash',
    'https://api.openai.com/v1': 'gpt-5',
    'https://api.anthropic.com': 'claude-sonnet-4-5',
    'https://api.deepseek.com': 'deepseek-flash',
    'https://api.deepseek.com/anthropic': 'deepseek-flash',
    'https://api.moonshot.cn/v1': 'kimi-k2.7-code',
    'https://open.bigmodel.cn/api/paas/v4': 'glm-5.2',
    'https://open.bigmodel.cn/api/anthropic': 'glm-5.2',
    'https://api.z.ai/api/anthropic': 'glm-5.2',
    'https://dashscope.aliyuncs.com/compatible-mode/v1': 'qwen-plus',
    'http://localhost:11434/v1': 'qwen3'
  };

  function agentCfgMod() { return window.LitAgentCfg || null; }

  /** Base URL 预设（每次渲染时构造：标签随界面语言即时变化）。
   *  纯品牌名不包 T()——界面语言 ≠ 品牌名。 */
  function agentPresetOptions() {
    return [
      { value: 'https://opencode.ai/zen/go/v1', label: T('OpenCode Go（订阅套餐）') },
      { value: 'https://opencode.ai/zen/v1', label: 'OpenCode Zen' },
      { value: 'https://api.openai.com/v1', label: 'OpenAI' },
      { value: 'https://api.anthropic.com', label: 'Anthropic (Claude)' },
      { value: 'https://api.deepseek.com', label: 'DeepSeek' },
      { value: 'https://api.deepseek.com/anthropic', label: T('DeepSeek（Anthropic 兼容）') },
      { value: 'https://api.moonshot.cn/v1', label: T('Kimi（Moonshot）') },
      { value: 'https://open.bigmodel.cn/api/paas/v4', label: T('智谱 GLM') },
      { value: 'https://open.bigmodel.cn/api/anthropic', label: T('智谱 GLM（Anthropic 兼容）') },
      { value: 'https://api.z.ai/api/anthropic', label: T('Z.ai（Anthropic 兼容）') },
      { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: T('通义千问（DashScope）') },
      { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
      { value: 'https://api.siliconflow.cn/v1', label: T('硅基流动 SiliconFlow') },
      { value: 'http://localhost:11434/v1', label: T('本地 ollama') }
    ];
  }

  /** 从配置装载草稿（打开设置、或非自动保存成功后回填） */
  function loadAgentProviders(config) {
    var mod = agentCfgMod();
    if (!mod) { agentProvidersDraft = null; return; }
    var cfg = mod.normalizeConfig(config || {});
    agentProvidersDraft = cfg.providers;
    agentProvidersActiveId = cfg.activeId;
    if (!agentProviderDraft(agentProviderSelected)) agentProviderSelected = cfg.activeId;
    renderAgentProviderList();
    renderAgentProviderDetail();
  }

  function agentProviderDraft(id) {
    return (agentProvidersDraft || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  /** 提交给主进程的清单：只在用户重填过 Key 时带上明文（主进程加密后落盘） */
  function agentProvidersForForm() {
    if (!agentProvidersDraft) return undefined;
    return agentProvidersDraft.map(function (p) {
      var out = {
        id: p.id, name: p.name, baseUrl: p.baseUrl, dialect: p.dialect,
        models: (p.models || []).slice(), activeModel: p.activeModel
      };
      if (p.apiKey) out.apiKey = p.apiKey;
      return out;
    });
  }

  /** 保存成功后：草稿里的明文已落盘，就地清掉（输入框没焦点时才清，免得打断正在输入的人） */
  function afterAgentProvidersSaved() {
    (agentProvidersDraft || []).forEach(function (p) {
      if (!p.apiKey) return;
      p.hasApiKey = true;
      if ($('#agent-p-api-key') && document.activeElement !== $('#agent-p-api-key')) $('#agent-p-api-key').value = '';
      delete p.apiKey;
    });
    renderAgentProviderList();
    var input = $('#agent-p-api-key');
    var provider = agentProviderDraft(agentProviderSelected);
    if (input && provider && !input.value) input.placeholder = agentKeyPlaceholder(provider);
  }

  function agentKeyPlaceholder(provider) {
    return provider && (provider.hasApiKey || provider.apiKey)
      ? T('已保存 Key（留空则保持不变）')
      : T('粘贴 API Key');
  }

  function agentProviderLabelOf(provider) {
    var mod = agentCfgMod();
    var label = mod ? mod.providerLabel(provider, window.LitAgentProto) : '';
    return label || T('未命名服务商');
  }

  function renderAgentProviderList() {
    var host = $('#agent-provider-items');
    if (!host || !agentProvidersDraft) return;
    var mod = agentCfgMod();
    host.innerHTML = '';
    agentProvidersDraft.forEach(function (provider) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'agent-provider-row' + (provider.id === agentProviderSelected ? ' active' : '');
      row.title = provider.baseUrl || T('未填写 Base URL');
      var status = mod ? mod.providerStatus(provider) : 'empty';
      row.innerHTML = '<span class="agent-provider-dot ' + status + '" aria-hidden="true"></span>' +
        '<span class="agent-provider-name">' + esc(agentProviderLabelOf(provider)) + '</span>' +
        (provider.id === agentProvidersActiveId
          ? '<span class="agent-provider-current">' + esc(T('当前')) + '</span>' : '');
      row.addEventListener('click', function () {
        agentProviderSelected = provider.id;
        renderAgentProviderList();
        renderAgentProviderDetail();
      });
      host.appendChild(row);
    });
  }

  function renderAgentModelList(provider) {
    var host = $('#agent-p-models');
    if (!host) return;
    host.innerHTML = '';
    if (!(provider.models || []).length) {
      var empty = document.createElement('div');
      empty.className = 'agent-model-empty';
      empty.textContent = T('还没有模型：填一个模型名点「添加模型」，或点「拉取模型」从端点取回清单。');
      host.appendChild(empty);
      return;
    }
    provider.models.forEach(function (model) {
      var row = document.createElement('div');
      row.className = 'agent-model-row' + (provider.activeModel === model ? ' active' : '');
      var pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'agent-model-pick';
      pick.title = T('点选即设为当前使用的模型');
      pick.innerHTML = '<span class="agent-model-radio" aria-hidden="true"></span><span class="agent-model-id">' +
        esc(model) + '</span>' +
        (provider.activeModel === model
          ? '<span class="agent-model-badge">' + esc(provider.id === agentProvidersActiveId ? T('当前') : T('待启用')) + '</span>'
          : '');
      pick.addEventListener('click', function () { selectAgentModel(provider.id, model); });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost agent-model-del';
      remove.textContent = '✕';
      remove.title = T('移除该模型');
      remove.addEventListener('click', function () { removeAgentModel(provider.id, model); });
      row.appendChild(pick);
      row.appendChild(remove);
      host.appendChild(row);
    });
  }

  /** 详情区（每次渲染重建：字段少、状态简单，重建比增量同步更不容易出错） */
  function renderAgentProviderDetail() {
    var host = $('#agent-provider-detail');
    if (!host || !agentProvidersDraft) return;
    var mod = agentCfgMod();
    var provider = agentProviderDraft(agentProviderSelected) || agentProvidersDraft[0];
    if (!provider) { host.innerHTML = ''; return; }
    agentProviderSelected = provider.id;
    var isDefault = !mod || provider.id === mod.DEFAULT_PROVIDER_ID;
    var presets = '<option value="">' + esc(T('常用预设…')) + '</option>' +
      agentPresetOptions().map(function (item) {
        return '<option value="' + esc(item.value) + '">' + esc(item.label) + '</option>';
      }).join('');
    host.innerHTML =
      '<div class="agent-detail-head">' +
        '<input type="text" class="text-input" id="agent-p-name" maxlength="60" value="' + esc(provider.name || '') +
          '" placeholder="' + esc(T('服务商名称（可留空）')) + '">' +
      '</div>' +
      '<label class="agent-field">Base URL' +
        '<div class="inline-row">' +
          '<select id="agent-p-preset">' + presets + '</select>' +
          '<input type="text" id="agent-p-base-url" value="' + esc(provider.baseUrl || '') +
            '" placeholder="' + esc(T('https://api.deepseek.com（本地服务可用 http://localhost）')) + '">' +
        '</div>' +
      '</label>' +
      '<label class="agent-field">' + esc(T('接口格式')) +
        '<select id="agent-p-dialect">' +
          '<option value="">' + esc(T('自动识别（推荐）')) + '</option>' +
          '<option value="chat">OpenAI Chat Completions</option>' +
          '<option value="responses">OpenAI Responses</option>' +
          '<option value="messages">Anthropic Messages</option>' +
        '</select>' +
      '</label>' +
      '<div class="field-hint" id="agent-p-dialect-hint">—</div>' +
      '<label class="agent-field">API Key' +
        '<input type="password" id="agent-p-api-key" autocomplete="new-password" placeholder="' +
          esc(agentKeyPlaceholder(provider)) + '">' +
      '</label>' +
      '<div class="agent-model-block">' +
        '<div class="agent-model-head"><span>' + esc(T('模型')) + '</span>' +
          '<span class="agent-model-hint">' + esc(T('点选即设为当前使用')) + '</span></div>' +
        '<div class="agent-model-list" id="agent-p-models"></div>' +
        '<div class="inline-row">' +
          '<input type="text" id="agent-p-model-input" placeholder="' + esc(T('如 deepseek-flash')) + '">' +
          '<button type="button" class="btn" id="agent-p-model-add">' + esc(T('添加模型')) + '</button>' +
          '<button type="button" class="btn" id="agent-p-fetch-models">' + esc(T('拉取模型')) + '</button>' +
        '</div>' +
        '<div class="sync-inline-status" id="agent-p-status" role="status" aria-live="polite"></div>' +
      '</div>' +
      '<div class="sync-inline-actions">' +
        '<button type="button" class="btn" id="agent-p-test">' + esc(T('测试连接')) + '</button>' +
        (isDefault ? '' : '<button type="button" class="btn agent-provider-delete" id="agent-p-delete">' +
          esc(T('删除该服务商')) + '</button>') +
      '</div>';
    if ($('#agent-p-dialect')) $('#agent-p-dialect').value = provider.dialect || '';
    if (provider.hasApiKey && !provider.apiKey) {
      markRetainedKey('agent-p-api-key', true, provider.apiKeyHint, { kind: 'agent', providerId: provider.id });
    }
    renderAgentModelList(provider);
    refreshAgentDialectHint();
    bindAgentProviderDetail(provider, isDefault);
  }

  /** 详情区事件：所有改动 = 改草稿 → 重画 → 自动保存（与设置页其余字段同一条通道） */
  function bindAgentProviderDetail(provider, isDefault) {
    function commit() {
      renderAgentProviderList();
      refreshAgentDialectHint();
      queueSyncAutoSave();
    }
    [['agent-p-name', 'name'], ['agent-p-base-url', 'baseUrl']].forEach(function (pair) {
      var input = $('#' + pair[0]);
      if (!input) return;
      input.addEventListener('input', function () { provider[pair[1]] = input.value.trim(); renderAgentProviderList(); refreshAgentDialectHint(); });
      input.addEventListener('change', function () { provider[pair[1]] = input.value.trim(); commit(); });
    });
    var keyInput = $('#agent-p-api-key');
    if (keyInput) {
      keyInput.addEventListener('input', function () { provider.apiKey = keyInput.value; });
      keyInput.addEventListener('change', function () { provider.apiKey = keyInput.value; commit(); });
    }
    var dialect = $('#agent-p-dialect');
    if (dialect) {
      dialect.addEventListener('change', function () { provider.dialect = dialect.value; commit(); });
    }
    var preset = $('#agent-p-preset');
    if (preset) {
      preset.addEventListener('change', function () {
        if (!preset.value) return;
        provider.baseUrl = preset.value;
        var baseInput = $('#agent-p-base-url');
        if (baseInput) baseInput.value = preset.value;
        // 预设顺带把「添加模型」输入框填上建议模型名（要点「添加模型」才进清单，不静默落配置）
        var hint = AGENT_PRESET_HINTS[preset.value];
        var modelInput = $('#agent-p-model-input');
        if (hint && modelInput && !modelInput.value.trim() && !(provider.models || []).length) modelInput.value = hint;
        preset.value = '';
        commit();
      });
    }
    var addBtn = $('#agent-p-model-add');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var input = $('#agent-p-model-input');
        var value = input ? input.value.trim() : '';
        if (!value) { setSyncInlineStatus('agent-p-status', T('请先填写模型名'), 'error'); return; }
        if (provider.models.indexOf(value) === -1) {
          provider.models.push(value);
          if (!provider.activeModel) provider.activeModel = value;
        }
        provider.activeModel = value;
        agentProvidersActiveId = provider.id;
        if (input) input.value = '';
        setSyncInlineStatus('agent-p-status', T('已添加：') + value, 'success');
        renderAgentProviderDetail();
        commit();
      });
      var modelInput = $('#agent-p-model-input');
      if (modelInput) {
        modelInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); addBtn.click(); }
        });
      }
    }
    var fetchBtn = $('#agent-p-fetch-models');
    if (fetchBtn) {
      fetchBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('agent-p-status', T('正在拉取模型清单…'), 'pending');
        // 先把手上的改动落盘：主进程要按 id 取该服务商存的 Key（没重填也能测）
        Promise.resolve(flushSyncAutoSave()).then(function () {
          return desktop.agentListModels({
            providerId: provider.id,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey || '',
            model: provider.activeModel,
            dialect: provider.dialect
          });
        }).then(function (result) {
          var models = (result && result.models) || [];
          var added = 0;
          models.forEach(function (id) {
            if (provider.models.indexOf(id) === -1) { provider.models.push(id); added++; }
          });
          if (!provider.activeModel && provider.models.length) provider.activeModel = provider.models[0];
          renderAgentProviderDetail();
          commit();
          setSyncInlineStatus('agent-p-status',
            T('✓ 拉取到 ') + models.length + T(' 个模型') + (added ? T('，其中 ') + added + T(' 个已加入清单') : T('，清单已是最新')), 'success');
        }).catch(function (error) {
          setSyncInlineStatus('agent-p-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
    }
    var testBtn = $('#agent-p-test');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('agent-p-status', T('正在连接…'), 'pending');
        Promise.resolve(flushSyncAutoSave()).then(function () {
          return desktop.agentTest({
            providerId: provider.id,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey || '',
            model: provider.activeModel,
            dialect: provider.dialect
          });
        }).then(function (result) {
          setSyncInlineStatus('agent-p-status', T('连接成功') + (result && result.model ? ' · ' + result.model : ''), 'success');
        }).catch(function (error) {
          setSyncInlineStatus('agent-p-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
    }
    var deleteBtn = $('#agent-p-delete');
    if (deleteBtn && !isDefault) {
      deleteBtn.addEventListener('click', function () {
        dlgConfirm(T('删除该服务商'), T('「') + agentProviderLabelOf(provider) + T('」的 Base URL、API Key 与模型清单都会从本机删除。'), T('删除'), true).then(function (ok) {
          if (!ok) return;
          var mod = agentCfgMod();
          var next = mod ? mod.removeProvider({ providers: agentProvidersDraft, activeId: agentProvidersActiveId }, provider.id) : null;
          if (!next) return;
          agentProvidersDraft = next.providers;
          agentProvidersActiveId = next.activeId;
          agentProviderSelected = next.activeId;
          renderAgentProviderList();
          renderAgentProviderDetail();
          queueSyncAutoSave();
          toast(T('✓ 已删除服务商'));
        });
      });
    }
  }

  /** 底部模型菜单（对话面板）与设置页共同的选择入口：选中即改当前服务商与模型 */
  function selectAgentModel(providerId, model) {
    var mod = agentCfgMod();
    if (!mod || !agentProvidersDraft) return;
    var next = mod.selectModel({ providers: agentProvidersDraft, activeId: agentProvidersActiveId }, providerId, model);
    agentProvidersDraft = next.providers;
    agentProvidersActiveId = next.activeId;
    renderAgentProviderList();
    renderAgentProviderDetail();
    queueSyncAutoSave();
  }

  function removeAgentModel(providerId, model) {
    var provider = agentProviderDraft(providerId);
    if (!provider) return;
    provider.models = provider.models.filter(function (id) { return id !== model; });
    if (provider.activeModel === model) provider.activeModel = provider.models[0] || '';
    renderAgentProviderDetail();
    renderAgentProviderList();
    queueSyncAutoSave();
  }

  function addAgentProvider() {
    var mod = agentCfgMod();
    if (!mod || !agentProvidersDraft) return;
    if (agentProvidersDraft.length >= mod.MAX_PROVIDERS) {
      toast(T('服务商数量已达上限'));
      return;
    }
    var provider = {
      id: mod.newProviderId(agentProvidersDraft),
      name: '', baseUrl: '', dialect: '', models: [], activeModel: '', hasApiKey: false
    };
    agentProvidersDraft = agentProvidersDraft.concat([provider]);
    agentProviderSelected = provider.id;
    renderAgentProviderList();
    renderAgentProviderDetail();
    var nameInput = $('#agent-p-name');
    if (nameInput) nameInput.focus();
    queueSyncAutoSave();
  }

  function bindAgentSettings() {
    /* AI 助手服务商清单的入口按钮（详情区与模型行的监听在每次渲染时挂） */
    var addProvider = $('#agent-provider-add');
    if (addProvider) addProvider.addEventListener('click', addAgentProvider);
    var embedPreset = $('#sync-embed-provider');
    if (embedPreset) {
      embedPreset.addEventListener('change', function () {
        var preset = window.LitEmbedCfg ? LitEmbedCfg.PRESETS[embedPreset.value] : null;
        if (preset) {
          if ($('#sync-embed-base-url')) $('#sync-embed-base-url').value = preset.baseUrl;
          if ($('#sync-embed-model')) $('#sync-embed-model').value = preset.model;
        }
        refreshEmbedSourceHint();
      });
    }
    ['sync-embed-base-url', 'sync-embed-api-key', 'sync-embed-model'].forEach(function (id) {
      var input = document.getElementById(id);
      if (input) input.addEventListener('input', refreshEmbedSourceHint);
    });
    var embedTestBtn = $('#sync-embed-test');
    if (embedTestBtn) {
      embedTestBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('sync-embed-test-status', T('正在连接…'), 'pending');
        desktop.embedTest({
          embedProvider: $('#sync-embed-provider') ? $('#sync-embed-provider').value : '',
          embedBaseUrl: $('#sync-embed-base-url') ? $('#sync-embed-base-url').value.trim() : '',
          embedApiKey: secretInputValue('sync-embed-api-key'),
          embedModel: $('#sync-embed-model') ? $('#sync-embed-model').value.trim() : ''
        }).then(function (result) {
          setSyncInlineStatus('sync-embed-test-status',
            T('连接成功') + ' · ' + (result.model || '') + T('（{dim} 维）', { dim: result.dim || 0 }), 'success');
        }).catch(function (error) {
          setSyncInlineStatus('sync-embed-test-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
    }
    var refreshBtn = $('#sync-research-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        if (window.LitAgentUi) LitAgentUi.refreshResearchStats();
      });
    }
    var browseBtn = $('#sync-agent-session-browse');
    if (browseBtn) {
      browseBtn.addEventListener('click', function () {
        desktop.chooseDirectory({ title: T('选择会话记录根目录') }).then(function (picked) {
          // 程序写值不触发 change：手动补一次自动保存，否则选完目录不算数
          if (picked) { $('#sync-agent-session-root').value = picked; queueSyncAutoSave(); }
        }).catch(function () {});
      });
    }
    var openBtn = $('#sync-agent-session-open');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        desktop.sessionOpenRoot().catch(function (error) { toast(T('打开失败：') + String(error && error.message || error)); });
      });
    }
    /* M9-4：科研网页检索——首次开启弹出境告知，确认落 webSearchEgressAcknowledged */
    var webSearchBox = $('#sync-web-search-enabled');
    if (webSearchBox) {
      webSearchBox.addEventListener('change', function () {
        if (!webSearchBox.checked) { queueSyncAutoSave(); return; } // 关闭无需确认
        if (!desktop.getSetting) { queueSyncAutoSave(); return; }
        desktop.getSetting('webSearchEgressAcknowledged').then(function (ack) {
          if (ack === true) { queueSyncAutoSave(); return; }
          return dlgConfirm(T('启用科研网页检索'),
            T('开启后，AI 助手的检索词与抓取的 URL 将发送到 TinyFish 服务器（第三方数据出境，故默认关闭、需你知情确认）。') +
            T('\n\n抓取仅限公开学术域白名单内的 URL；关闭开关后不再有任何该主机外呼。'),
            T('知晓并开启')).then(function (yes) {
            // 落盘必须等告知确认之后：先存的话，用户点「取消」时后台已带着出境开关跑起来了
            if (yes) {
              desktop.setSetting('webSearchEgressAcknowledged', true).catch(function () {});
              queueSyncAutoSave();
            } else {
              webSearchBox.checked = false;
            }
          });
        }).catch(function () {});
      });
    }
    /* M9 二期：摘要回填 / 补登记 / 向量构建（含估价确认） */
    var backfillBtn = $('#sync-research-backfill');
    if (backfillBtn) {
      backfillBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('sync-research-status', T('回填中（Crossref → Elsevier）…'), 'pending');
        desktop.researchBackfill({ limit: 100 }).then(function (r) {
          var msg = T('✓ 回填完成：') + (r.updated || 0) + '/' + (r.total || 0);
          if (r.stopped) msg = T('回填被限流暂停：') + (r.updated || 0) + '/' + (r.total || 0) + T('（稍后再跑会续上）');
          setSyncInlineStatus('sync-research-status', msg, r.stopped ? 'warning' : 'success');
          if (window.LitAgentUi) LitAgentUi.refreshResearchStats();
        }).catch(function (error) {
          setSyncInlineStatus('sync-research-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
      if (desktop.onResearchBackfillProgress) {
        desktop.onResearchBackfillProgress(function (p) {
          setSyncInlineStatus('sync-research-status',
            T('回填中 ') + (p.done || 0) + '/' + (p.total || 0) + T('（已补 ') + (p.updated || 0) + '）', 'pending');
        });
      }
    }
    var registerBtn = $('#sync-research-register');
    if (registerBtn) {
      /* 一次点击跑全量（主进程分片 + 逐片进度）；运行中按钮变「停止」，
       * 再点一次置停止位——主进程当前片收尾后带着已完成部分返回 */
      var registerRunning = false;
      registerBtn.addEventListener('click', function () {
        if (registerRunning) {
          desktop.researchRegisterCancel();
          setSyncInlineStatus('sync-research-status', T('正在停止补登记…'), 'pending');
          return;
        }
        var button = this;
        var label = button.textContent;
        registerRunning = true;
        button.textContent = T('停止');
        setSyncInlineStatus('sync-research-status', T('补登记中（DOI 直查 + 本地身份）…'), 'pending');
        desktop.researchRegister({ limit: 0 }).then(function (r) {
          var applied = applyResearchProposals(r.proposals || []);
          var msg = (r.stopped ? T('已停止：扫描 ') : T('✓ 扫描 ')) + (r.scanned || 0) + T(' 条，补登记 ') + applied + T(' 条');
          // 带 DOI 但在线反查也没解析到的条目如实报出——否则「补登记 0 条」会把用户搞糊涂
          if (r.unresolved) msg += T('；有 ') + r.unresolved + T(' 条带 DOI 但暂未解析到调研身份（需联网反查 OpenAlex，稍后再试）');
          setSyncInlineStatus('sync-research-status', msg, r.unresolved || r.stopped ? 'warning' : 'success');
        }).catch(function (error) {
          setSyncInlineStatus('sync-research-status', error && error.message || String(error), 'error');
        }).finally(function () {
          registerRunning = false;
          button.textContent = label;
        });
      });
      if (desktop.onResearchRegisterProgress) {
        desktop.onResearchRegisterProgress(function (p) {
          if (!registerRunning) return;
          setSyncInlineStatus('sync-research-status',
            T('补登记中 ') + (p.done || 0) + '/' + (p.total || 0) + T('（已解析 ') + (p.proposed || 0) + T(' 条）'), 'pending');
        });
      }
    }
    var embedBtn = $('#sync-embed-build');
    if (embedBtn) {
      embedBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('sync-embed-status', T('统计待嵌入条目…'), 'pending');
        desktop.researchEmbedEstimate().then(function (est) {
          if (!est.count) {
            setSyncInlineStatus('sync-embed-status', T('✓ 向量索引已是最新（0 条待嵌入）'), 'success');
            return null;
          }
          // R14：存在持久失败标记时明说「自动构建已停」，点「开始构建」即手动恢复
          var failedNote = est.failed
            ? '\n' + T('⚠ 上次自动构建失败已停批（') + String(est.failed.error || '') + T('）；点击开始构建将清除失败状态并续跑。')
            : '';
          return dlgConfirm(T('构建向量索引'),
            T('将为 ') + est.count + T(' 条文献嵌入向量，约 ') + est.approxTokens +
            T(' tokens（按内容比对增量：未变化的条目不会重复嵌入）。') + failedNote,
            T('开始构建')).then(function (yes) {
            if (!yes) { setSyncInlineStatus('sync-embed-status', T('已取消'), ''); return null; }
            setSyncInlineStatus('sync-embed-status', T('构建中…'), 'pending');
            return desktop.researchEmbedBuild().then(function (r) {
              if (r && r.error) {
                setSyncInlineStatus('sync-embed-status', T('构建中断：') + r.error + T('（已停自动重试；修好配置后手动点「构建」续跑）'), 'error');
              } else if (r && r.stopped === 'busy') {
                setSyncInlineStatus('sync-embed-status', T('库正忙，已暂停（空闲时自动续）'), 'warning');
              } else {
                setSyncInlineStatus('sync-embed-status', T('✓ 构建完成：') + (r && r.embedded || 0) + T(' 条'), 'success');
              }
              refreshEmbedUsageLine();
            });
          });
        }).catch(function (error) {
          setSyncInlineStatus('sync-embed-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
      if (desktop.onEmbedProgress) {
        desktop.onEmbedProgress(function (p) {
          setSyncInlineStatus('sync-embed-status', T('构建中：已嵌入 ') + (p.done || 0) + T(' 条'), 'pending');
        });
      }
    }
  }

  /* ===== 阅读模式右栏可达性 ===== */
  var annoDockHome = null; // 批注面板还原位（离开阅读模式时回插 PDF 阅读层）
  /** 批注面板收编为右栏第四个页签（仅 PDF 阅读层打开时停靠）；阅读器工具条的
   *  「批注」开关与 rail 页签共用同一 hidden 状态。还原时记住原位插回。 */
  function dockAnnotations(pdfOpen) {
    var anno = document.getElementById('pdf-annotations');
    var aside = document.querySelector('.detail-sidebar');
    if (!anno || !aside) return;
    if (pdfOpen && anno.parentElement !== aside) {
      if (!annoDockHome) annoDockHome = { parent: anno.parentElement, next: anno.nextElementSibling };
      aside.insertBefore(anno, aside.firstElementChild);
      // 停靠前若批注面板正开着 → 切到批注页签，保持「开着」的观感连续
      if (!anno.hidden && window.LitAgentUi && LitAgentUi.switchPane) LitAgentUi.switchPane('anno');
    } else if (!pdfOpen && annoDockHome && anno.parentElement === aside) {
      var anchor = annoDockHome.next && annoDockHome.next.parentElement === annoDockHome.parent ? annoDockHome.next : null;
      annoDockHome.parent.insertBefore(anno, anchor);
      annoDockHome = null;
      anno.hidden = true; // 回阅读层后由阅读器工具条开关重新唤起
      // 若离开时正停在批注页签：右栏其它面板都被 switchPane 藏了，回落到详情
      if (window.LitAgentUi && LitAgentUi.switchPane) LitAgentUi.switchPane('detail');
    }
  }

  /** body.reading-open + 阅读层让位宽度同步：rail 恒可见（--rail-width），
   *  侧栏未收起时再让出 --detail-width。收起/展开经 .rail-collapsed 类变化驱动。 */
  function syncReadingRail() {
    var pdfEl = $('#pdf-overlay');
    var epubEl = $('#epub-overlay');
    var pdfOpen = !!(pdfEl && !pdfEl.hidden);
    var reading = pdfOpen || !!(epubEl && !epubEl.hidden);
    document.body.classList.toggle('reading-open', reading);
    dockAnnotations(pdfOpen);
    var ws = document.querySelector('.workspace');
    var rightCollapsed = !!(ws && ws.classList.contains('rail-collapsed'));
    var detailSidebar = $('#detail-sidebar');
    if (detailSidebar) {
      detailSidebar.setAttribute('aria-hidden', String(rightCollapsed));
      detailSidebar.inert = rightCollapsed;
    }
    var rightToggle = $('#btn-right-sidebar-toggle');
    if (rightToggle) {
      rightToggle.setAttribute('aria-expanded', String(!rightCollapsed));
      var icon = rightToggle.querySelector('use');
      if (icon) icon.setAttribute('href', rightCollapsed ? '#lb-i-chev-l' : '#lb-i-chev-r');
    }
    var railW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-width')) || 42;
    var detail = 0;
    if (ws && !ws.classList.contains('rail-collapsed')) {
      detail = parseFloat(getComputedStyle(ws).getPropertyValue('--detail-width')) || 0;
      // 阅读模式侧栏是浮层（CSS 另有 vw 视觉钳制会生效）——按实际渲染宽让位，
      // 拖动把手时 PDF 让位宽度与侧栏左缘严格贴合、不出现缝隙
      if (reading) {
        var sidebar = document.querySelector('.detail-sidebar');
        if (sidebar) detail = Math.round(sidebar.getBoundingClientRect().width);
      }
    }
    document.body.style.setProperty('--reading-rail-w', Math.round(railW + detail) + 'px');
  }

  /** 阅读视图的可用矩形（阅读层实际占用的那块）：阅读模式下右栏让位后，阅读区内的
   *  临时浮层（划词翻译等）必须收在里面——右栏浮层 z-index 高于阅读层，越界部分会被它
   *  盖掉；越到顶栏上也会被顶栏压住。非阅读模式退化为整窗。 */
  function readingViewport() {
    var overlay = $('#pdf-overlay');
    if (document.body.classList.contains('reading-open') && overlay && !overlay.hidden) {
      var rect = overlay.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }
    }
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  /** 观察两个阅读层的 hidden 与 workspace 的 rail-collapsed 类，保持 body 状态与让位宽度实时同步 */
  function watchReadingRail() {
    var workspace = document.querySelector('.workspace');
    [$('#pdf-overlay'), $('#epub-overlay'), workspace].forEach(function (node) {
      if (!node || typeof MutationObserver === 'undefined') return;
      new MutationObserver(function (mutations) {
        syncReadingRail();
        if (node === workspace && mutations.some(function (mutation) { return mutation.attributeName === 'class'; })) {
          try {
            localStorage.setItem(RIGHT_SIDEBAR_COLLAPSED_KEY,
              workspace.classList.contains('rail-collapsed') ? '1' : '0');
          } catch (error) {}
        }
      }).observe(node, { attributes: true, attributeFilter: ['hidden', 'class'] });
    });
    if (typeof window !== 'undefined') window.addEventListener('resize', syncReadingRail);
    syncReadingRail();
  }

  /* R19：当前阅读上下文——阅读层可见时返回正在读的文献与位置。
   * getCurrentPaper 的「阅读优先」与 agent 的阅读位置冻结共用这一个来源，避免两处判断漂移。 */
  function currentReadingContext() {
    try {
      var pdfOverlay = document.getElementById('pdf-overlay');
      if (pdfOverlay && !pdfOverlay.hidden && pdfState && pdfState.paper) {
        return { kind: 'pdf', paper: pdfState.paper, attachmentId: pdfState.attachmentId || '',
          page: pdfState.currentPage || 1, pageCount: pdfState.pageCount || 0 };
      }
      var epubOverlay = document.getElementById('epub-overlay');
      if (epubOverlay && !epubOverlay.hidden && epubState && epubState.paper) {
        var prog = epubState.api && epubState.api.progress ? epubState.api.progress() : null;
        return { kind: 'epub', paper: epubState.paper,
          progress: prog && isFinite(prog.percent) ? Math.round(prog.percent) : null };
      }
    } catch (error) {}
    return null;
  }

  /* 阅读器当前划词选区（VSCode 式「当前选中」上下文）：复用划词翻译面板维护的
   * pdfState.selectedText / selectionPositions——选区塌陷或阅读层关闭时它们已被清空，
   * 生命周期天然一致。页码按 R1 契约转成 1 基物理页。 */
  function currentPdfSelectionContext() {
    try {
      var overlay = document.getElementById('pdf-overlay');
      if (!overlay || overlay.hidden || !pdfState || !pdfState.paper) return null;
      var text = String(pdfState.selectedText || '').trim();
      var positions = pdfState.selectionPositions || [];
      if (!text || !positions.length) return null;
      return {
        paperId: pdfState.paper.id,
        attachmentId: pdfState.attachmentId || '',
        page: (positions[0].pageIndex || 0) + 1,
        pageTo: (positions[positions.length - 1].pageIndex || 0) + 1,
        pageCount: pdfState.pageCount || 0,
        text: text
      };
    } catch (error) { return null; }
  }

  /* EPUB 划词选区：位置身份是 CFI + 章节名 + 进度百分比（流式排版没有固定页码）。
   * 章节标签与 #epub-location 用同一算法（TOC href 前缀匹配），与阅读器显示一致。 */
  function currentEpubSelectionContext() {
    try {
      var overlay = document.getElementById('epub-overlay');
      if (!overlay || overlay.hidden || !epubState || !epubState.paper) return null;
      var sel = epubState.pendingSelection;
      var selText = String((sel && sel.text) || '').trim();
      if (!sel || !selText || !sel.cfi) return null;
      var progress = null;
      var chapter = '';
      if (epubState.api) {
        var prog = epubState.api.progress ? epubState.api.progress() : null;
        if (prog && isFinite(prog.percent)) progress = prog.percent;
        var href = epubState.api.currentHref ? epubState.api.currentHref() : '';
        (epubState.tocItems || []).forEach(function (item) {
          if (item.href && href && (href === item.href || href.indexOf(item.href.split('#')[0]) === 0)) chapter = item.label;
        });
      }
      return {
        kind: 'epub',
        paperId: epubState.paper.id,
        attachmentId: epubState.attachmentId || '',
        cfi: sel.cfi,
        chapter: chapter,
        progress: progress,
        text: selText
      };
    } catch (error) { return null; }
  }

  /* R19：阅读位置 / 列表焦点变化后刷新 AI 面板上下文 chips（面板未开或未初始化时安全） */
  function refreshAgentChips() {
    if (window.LitAgentUi && LitAgentUi.refreshChips) LitAgentUi.refreshChips();
  }

  function initAgentUi() {
    if (!window.LitAgentUi || !desktop || !desktop.agentChat) return;
    LitAgentUi.init({
      desktop: desktop,
      getPapers: function () { return state.papers; },
      getPaperById: function (id) {
        return state.papers.filter(function (p) { return p.id === id; })[0] || null;
      },
      getPapersInFolder: function (folderId) {
        return state.papers.filter(function (p) {
          return !p.deletedAt && (p.folderIds || []).indexOf(folderId) !== -1;
        });
      },
      /* 正在读的文献与位置（PDF 页码 / EPUB 进度）；无阅读层时返回 null */
      getCurrentReading: function () { return currentReadingContext(); },
      /* 阅读器当前划词选区（PDF 文字 + 页码 / EPUB 文字 + CFI·章节·进度）；无选区时 null。
       * 两个阅读层互斥可见，各 getter 自守卫，按序取第一个命中的即可 */
      getCurrentSelection: function () { return currentPdfSelectionContext() || currentEpubSelectionContext(); },
      getCurrentPaper: function () {
        // R2：阅读层可见时以「正在读的那篇」为准（PDF/EPUB 标签切到谁就是谁），
        // 否则回落列表焦点——先开 A 再开 B 又切回 A 时，提问「这篇」必须指向 A，
        // 而不是列表焦点里最后点过的 B
        var reading = currentReadingContext();
        var id = (reading && reading.paper && reading.paper.id) ||
          state.focusId || Object.keys(state.selected)[0] || '';
        if (!id) return null;
        return state.papers.filter(function (p) { return p.id === id; })[0] || null;
      },
      getCurrentFolder: function () {
        var fid = state.activeFolderId;
        if (!fid || fid === 'all' || fid === 'unfiled' || fid === 'trash' || fid === 'recent') return null;
        var folder = state.folders.filter(function (f) { return f.id === fid; })[0];
        return folder ? folder.name : null;
      },
      prompt: function (title, value) { return dlgPrompt(title, '', '', value); },
      confirm: function (title, body) { return dlgConfirm(title, body); },
      showCtxMenu: showCtxMenu,
      toast: toast,
      /* 对话面板底部「管理模型…」：直接打开 设置 → 集成与服务 → AI 助手（服务商与模型） */
      openAgentSettings: function () { openSyncSettings('agent'); },
      /* M9 二期：收藏桥 / PDF 收入（供 agent 写类工具共用） */
      collectWorks: collectWorks,
      importStagedPdfs: importStagedPdfs,
      /* M9 三期：引文网络面板（agent build_graph 工具的展示与快照出口） */
      openGraphPanel: function (data, title) {
        if (window.LitGraphView) LitGraphView.showData(data, title);
      },
      reopenGraphPanel: function () {
        return !!(window.LitGraphView && LitGraphView.reopen && LitGraphView.reopen());
      },
      saveGraphHtmlToSession: function (data, sessionId) {
        return window.LitGraphView ? LitGraphView.saveHtmlToSession(data, sessionId) : Promise.resolve({ file: '' });
      },
      /* M9-4：网页快照挂载（主进程已落盘 + 已入 pdf_fts，这里补附件记录并走 save 管线） */
      attachSnapshot: attachSnapshotFromResearch,
      /* M9-5（R11）：页面渲染生产端——MuPDF 离屏渲染指定页为 PNG（agent render_pdf_pages
       *  工具用）；agentui 只在 vision 模型时启用。
       *  R1：工具层传的已是 1 基物理页，renderPageToPng 也按 1 基消费——适配器不得再 +1
       *  （曾把请求的第 1 页渲染成第 2 页，末页则直接超界） */
      renderPageImage: function (input) {
        if (!window.LitPdf || !LitPdf.renderPageToPng || !input || !input.path) return Promise.resolve(null);
        return LitPdf.renderPageToPng(input.path, Math.max(1, Math.floor(Number(input.pageIndex) || 1)), input.scale);
      },
      /* 多页一次开文档（agent 视觉工具用）：逐页调用会为每页重读整份 PDF 并重新解析，
       *  大 PDF 上就是「渲染截图时整个界面卡住」——文档只开一次的批量口子在这里 */
      renderPagesImage: function (input) {
        if (!window.LitPdf || !LitPdf.renderPagesToPng || !input || !input.path) return Promise.resolve([]);
        return LitPdf.renderPagesToPng(input.path, input.pages, input.scale);
      },
      /* R19 临时全文链：按路径抽取 PDF 全文文本（agent read_work_fulltext 用；临时文件
       *  抽取完主进程即删）。与全文索引同一条 LitPdf.extractText 管线（MuPDF），
       *  页数/单页长度上限与 pdfsearch.extractPages 一致；带「第 N 页」标记供引用页码 */
      extractPdfTextByPath: function (filePath) {
        if (!window.LitPdf || !LitPdf.extractText || !desktop.readFileBytes || !filePath) return Promise.resolve(null);
        return Promise.resolve(window.LitPdf.load()).then(function () {
          return desktop.readFileBytes(filePath);
        }).then(function (bytes) {
          return LitPdf.extractText(filePath, new Uint8Array(bytes));
        }).then(function (result) {
          if (!result || !Array.isArray(result.pages)) return null;
          return result.pages.slice(0, 400).map(function (text, idx) {
            var page = String(text || '');
            if (page.length > 200000) page = page.slice(0, 200000);
            return page ? '【第 ' + (idx + 1) + ' 页】\n' + page : '';
          }).filter(Boolean).join('\n\n');
        });
      }
    });
  }

  /* ===== M9 三期：引文网络双入口（右键菜单） ===== */

  /** 收集一组文献可作种子的调研身份（去重、截 50）；无身份时提示先补登记 */
  function researchSeedsForPapers(papers) {
    var seen = {};
    var seeds = [];
    (papers || []).forEach(function (p) {
      if (!p || p.deletedAt) return;
      (p.researchIds || []).forEach(function (rid) {
        if (!seen[rid]) { seen[rid] = true; seeds.push(rid); }
      });
    });
    return seeds.slice(0, 50);
  }

  function openGraphForPapers(papers) {
    if (!desktop || !desktop.researchGraph) { toast(T('引文网络需要桌面版')); return; }
    var seeds = researchSeedsForPapers(papers);
    if (!seeds.length) {
      toast(T('所选文献还没登记到调研库：请先在 设置 → 调研库 →「补登记文献库」，或通过 AI 助手收藏'));
      return;
    }
    if (window.LitGraphView) LitGraphView.build(seeds, papers.length > 1 ? T('已选文献的引文网络') : (papers[0].title || T('引文网络')).slice(0, 40));
  }

  function buildFolderGraph(folder) {
    var papers = state.papers.filter(function (p) {
      return !p.deletedAt && (p.folderIds || []).indexOf(folder.id) !== -1;
    });
    openGraphForPapers(papers.slice(0, 200));
  }

  /* ===== M9 二期：调研库 → 正式库 收藏桥 ===== */

  function validFolderId(fid) {
    return fid && state.folders.some(function (f) { return f.id === fid; }) ? fid : '';
  }

  /** 调研行 → 正式库草稿（authors 取名字数组；researchIds 由调用方在入库后回写） */
  function workToDraft(w) {
    return {
      title: w.title || '', year: w.year || null, doi: w.doi || '',
      venue: w.sourceName || '', abstract: w.abstract || '',
      oaUrl: w.oaUrl || '', entryType: 'article', key: '',
      authors: (w.authors || []).map(function (a) { return a && a.name ? a.name : String(a || ''); }).filter(Boolean)
    };
  }

  /** 入库后回写 researchIds（addPapers 的合并路径不复制该字段） */
  function applyResearchIds(idList, researchId) {
    var touched = false;
    idList.forEach(function (pid) {
      var paper = getById(pid);
      if (!paper) return;
      var ids = Array.isArray(paper.researchIds) ? paper.researchIds : [];
      if (ids.indexOf(researchId) === -1) {
        paper.researchIds = ids.concat([researchId]);
        window.LitModel.touch(paper);
        touched = true;
      }
    });
    return touched;
  }

  /**
   * M9-4：网页快照挂载（agent fetch_page 的 paperId 路径）。
   * 主进程已落盘 snapshot 目录 + 写入 pdf_fts；这里补附件记录、走 save 管线并刷新检索缓存。
   */
  function attachSnapshotFromResearch(paperId, attachment) {
    var paper = getById(paperId);
    if (!paper || paper.deletedAt || !attachment || !attachment.id) return false;
    var attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
    if (attachments.some(function (a) { return a && a.id === attachment.id; })) return false;
    attachments.push({
      id: attachment.id, kind: 'snapshot', fileName: attachment.fileName || '网页快照',
      path: attachment.path || '', fingerprint: attachment.fingerprint || ''
    });
    paper.attachments = attachments;
    window.LitModel.touch(paper);
    var norm = window.LitModel.normalizePaper(paper, uid);
    norm.id = paper.id;
    state.papers[state.papers.indexOf(paper)] = norm;
    save();
    // R07：只刷新渲染层 meta 缓存（主进程已 await 写完索引）——**不能**走
    // pdfSearchInvalidate({paperId})，那会连该文献 PDF 附件的已有索引一起删掉
    if (window.LitPdfSearch) LitPdfSearch.resetCache();
    renderAll();
    toast(T('✓ 网页快照已挂载，可全文检索'));
    return true;
  }

  /**
   * 收藏桥（供 agent 工具 collect_papers 使用）：
   * 确认 → addPapers（LitDedupe 去重）→ researchIds 回写 → 返回 {added, merged, canceled}。
   * opts.isCancelled：同 importStagedPdfs——确认框后的取消复核（A-followup #6）。
   */
  function collectWorks(workIds, folderId, opts) {
    if (!desktop || !desktop.researchGetWorks) return Promise.reject(new Error(T('需要桌面版')));
    var ids = (Array.isArray(workIds) ? workIds : []).map(String).filter(Boolean).slice(0, 50);
    if (!ids.length) return Promise.resolve({ added: 0, merged: 0 });
    return desktop.researchGetWorks(ids).then(function (works) {
      works = (works || []).filter(Boolean);
      if (!works.length) return { added: 0, merged: 0 };
      var target = validFolderId(folderId) ||
        (state.activeFolderId && validFolderId(state.activeFolderId)) || '';
      var folderName = target
        ? ((state.folders.filter(function (f) { return f.id === target; })[0] || {}).name || '')
        : T('未归档');
      return dlgConfirm(T('收藏到文献库'),
        T('将 ') + works.length + T(' 篇文献收藏到「') + folderName + T('」；已存在的自动去重合并。'),
        T('收藏')).then(function (yes) {
        if (!yes) return { canceled: true, added: 0, merged: 0 };
        if (opts && typeof opts.isCancelled === 'function' && opts.isCancelled()) {
          return { canceled: true, stopped: true, added: 0, merged: 0 };
        }
        var idByWork = {};
        works.forEach(function (w) { idByWork[w.id] = w; });
        var r = addPapers(works.map(workToDraft), { folderId: target });
        var touched = false;
        works.forEach(function (w, i) {
          var entry = (r.indexMap || [])[i];
          if (!entry) return;
          touched = applyResearchIds([entry.id], w.id) || touched;
        });
        if (touched) save();
        renderAll();
        return { added: r.added || 0, merged: r.merged || 0, attached: r.attached || 0 };
      });
    });
  }

  /** 调研暂存 PDF 先补内容指纹，复制前即可命中同文件，避免建出重复条目。 */
  function fingerprintStagedDrafts(pairs, isCancelled) {
    if (!window.LitPdf || !LitPdf.fingerprint) return Promise.resolve();
    var cursor = 0;
    function worker() {
      if (isCancelled && isCancelled()) return Promise.resolve();
      var pair = pairs[cursor++];
      if (!pair) return Promise.resolve();
      var attachment = pair.draft.attachments[0];
      return LitPdf.fingerprint(attachment.path).then(function (fingerprint) {
        if (/^[a-f0-9]{64}$/i.test(String(fingerprint || ''))) attachment.fingerprint = fingerprint.toLowerCase();
      }).catch(function () {}).then(worker);
    }
    return Promise.all([worker(), worker(), worker()]);
  }

  /** PDF 第二步：已暂存进受管目录的 PDF → 建/并条目挂附件（researchIds 同样回写）。
   *  opts.isCancelled：确认框与复制/哈希后的异步边界都需复核取消信号。 */
  function importStagedPdfs(storedList, folderId, opts) {
    if (!desktop || !desktop.researchGetWorks) return Promise.reject(new Error(T('需要桌面版')));
    var stored = (Array.isArray(storedList) ? storedList : []).filter(function (s) { return s && s.path; });
    if (!stored.length) return Promise.resolve({ added: 0, merged: 0 });
    var workIds = stored.map(function (s) { return s.workId; }).filter(Boolean);
    return desktop.researchGetWorks(workIds).then(function (works) {
      var workOf = {};
      (works || []).forEach(function (w) { workOf[w.id] = w; });
      // R06：draft 与 workId 的对应关系在构建时固定——收入后按输入序回写 researchIds，
      // 不按标题反查（同标题不同 workId 的研究会错误串联）
      var pairs = [];
      stored.forEach(function (s) {
        var w = workOf[s.workId];
        if (!w) return;
        var draft = workToDraft(w);
        draft.attachments = [{ kind: 'pdf', fileName: s.fileName || (s.path.split(/[\\/]/).pop()), path: s.path }];
        pairs.push({ draft: draft, work: w });
      });
      if (!pairs.length) return { added: 0, merged: 0 };
      var target = validFolderId(folderId) ||
        (state.activeFolderId && validFolderId(state.activeFolderId)) || '';
      return dlgConfirm(T('收入 PDF 到文献库'),
        T('将 ') + pairs.length + T(' 个 PDF 收入文献库（创建或合并条目并挂载附件）。'),
        T('收入')).then(function (yes) {
        if (!yes) return { canceled: true, added: 0, merged: 0 };
        if (opts && typeof opts.isCancelled === 'function' && opts.isCancelled()) {
          return { canceled: true, stopped: true, added: 0, merged: 0 };
        }
        return fingerprintStagedDrafts(pairs, opts && opts.isCancelled).then(function () {
          if (opts && typeof opts.isCancelled === 'function' && opts.isCancelled()) {
            return { canceled: true, stopped: true, added: 0, merged: 0 };
          }
          return storeImportedPdfFiles(pairs.map(function (pair) { return pair.draft; }), opts);
        }).catch(function (error) {
          if (opts && typeof opts.isCancelled === 'function' && opts.isCancelled()) {
            return { canceled: true, stopped: true, added: 0, merged: 0 };
          }
          throw error;
        }).then(function (staged) {
          if (staged && staged.canceled) return staged;
          if (opts && typeof opts.isCancelled === 'function' && opts.isCancelled()) {
            return { canceled: true, stopped: true, added: 0, merged: 0 };
          }
          var r = addPapers(pairs.map(function (pair) { return pair.draft; }), { folderId: target });
          return waitForLocalSave().then(function (saved) {
            if (!saved) throw new Error(T('导入结果未能保存到本地'));
            var touched = false;
            pairs.forEach(function (pair, i) {
              var entry = (r.indexMap || [])[i];
              if (!entry) return;
              touched = applyResearchIds([entry.id], pair.work.id) || touched;
            });
            return touched ? save() : true;
          }).then(function (saved) {
            if (!saved) throw new Error(T('导入结果未能保存到本地'));
            return backfillPdfFingerprints((r.addedIds || []).concat((r.matches || []).map(function (m) { return m.id; })));
          }).then(function () {
            renderAll();
            // 新挂载的 PDF 排队建全文索引（reindex 只处理缺失或指纹变化的附件）。
            if (window.LitPdfSearch && LitPdfSearch.reindex) {
              var affectedIds = {};
              (r.addedIds || []).concat((r.matches || []).map(function (m) { return m.id; }))
                .forEach(function (pid) { affectedIds[pid] = true; });
              var affected = state.papers.filter(function (p) { return affectedIds[p.id]; });
              if (affected.length) LitPdfSearch.reindex(affected, function () {}).catch(function () {});
            }
            return { added: r.added || 0, merged: r.merged || 0, attached: r.attached || 0 };
          });
        });
      });
    });
  }

  /** 补登记：应用主进程提案（paper.researchIds），返回应用条数 */
  function applyResearchProposals(proposals) {
    var list = Array.isArray(proposals) ? proposals : [];
    var touched = false;
    list.forEach(function (p) {
      if (p && p.paperId && p.researchId) touched = applyResearchIds([p.paperId], p.researchId) || touched;
    });
    if (touched) { save(); renderAll(); }
    return touched ? list.length : 0;
  }

  function fillDataPathForm(info) {
    dataPathInfo = info || null;
    var configDir = info && (info.pendingConfigDir || info.configDir) || '';
    var libraryDir = info && (info.pendingLibraryDir || info.libraryDir) || '';
    $('#sync-config-dir').value = configDir;
    $('#sync-library-dir').value = libraryDir;
    var apply = $('#sync-data-paths-apply');
    apply.disabled = !info || !!info.fatalError || !!info.rebasePending;
    if (!info) {
      setSyncInlineStatus('sync-data-path-status', T('无法读取数据目录'), 'error');
    } else if (info.migrationError) {
      setSyncInlineStatus('sync-data-path-status', info.migrationError, 'error');
    } else if (info.rebasePending) {
      setSyncInlineStatus('sync-data-path-status', T('上次迁移的托管附件路径尚未重定位，请重启后再试'), 'warning');
    } else if (info.cleanupPending) {
      setSyncInlineStatus('sync-data-path-status', info.cleanupError || T('上次迁移的旧数据目录尚未清理完成，重启后将自动重试'), 'warning');
    } else if (info.restartRequired) {
      setSyncInlineStatus('sync-data-path-status', T('已选择新目录，重启后迁移生效'), 'warning');
    } else if (info.runtimeSweepFailed > 0) {
      setSyncInlineStatus('sync-data-path-status', T('旧数据目录里的运行时缓存仍被别的程序占用，LitBoard 会自动重试清理'), 'warning');
    } else if (info.cleanupPreserved && info.cleanupPreserved.length) {
      // 这类文件在新目录里没有对应副本（多半是迁移后原地自我更新的伴生文件），保留但不删除
      setSyncInlineStatus('sync-data-path-status',
        T('旧数据目录保留了 ') + info.cleanupPreserved.length + T(' 项未迁移内容：') + info.cleanupPreserved.join('、'), '');
    } else {
      setSyncInlineStatus('sync-data-path-status', T('当前目录正在使用中'), 'success');
    }
  }

  function updateTranslatorFields() {
    var provider = $('#sync-translator-provider').value;
    var help = TRANSLATOR_HELP[provider] || TRANSLATOR_HELP.volc;
    var free = !!(help && help.free);
    var aliyun = provider === 'aliyun';
    var usesModel = !free && !aliyun;
    $('#sync-translator-model').disabled = !usesModel;
    $('#sync-translator-model').placeholder = usesModel ? T('留空使用服务商默认模型') : (free ? T('免费接口无需模型') : T('机器翻译无需模型'));
    $('#sync-translator-credential-label').textContent = free ? T('凭据') : (aliyun ? 'AccessKey ID@AccessKey Secret' : 'API Key');
    var keyInput = $('#sync-translator-api-key');
    keyInput.disabled = free;
    var hasSavedKey = integrationConfig && integrationConfig.hasTranslatorApiKey;
    if (free) {
      markRetainedKey('sync-translator-api-key', false);
      keyInput.placeholder = T('免费接口无需凭据');
    } else if (hasSavedKey) {
      markRetainedKey('sync-translator-api-key', true, integrationConfig.translatorApiKeyHint, { kind: 'translator' });
    } else {
      markRetainedKey('sync-translator-api-key', false);
      keyInput.placeholder = aliyun ? T('留空则保持原 AK/SK') : T('留空则保持原 Key');
    }
    var keyHelp = $('#sync-translator-key-help');
    if (keyHelp) keyHelp.hidden = free;
    var helpEl = $('#sync-translator-provider-help');
    if (!helpEl) return;
    if (free) {
      helpEl.textContent = help.name + '：' + help.note + T(' 参考入口：');
    } else {
      helpEl.textContent = help.name + '：' + help.note + T(' 申请入口：');
    }
    var link = document.createElement('a');
    link.href = help.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = help.label;
    helpEl.appendChild(link);
    helpEl.appendChild(document.createTextNode('。'));
  }

  function setSyncInlineStatus(id, message, stateName) {
    var status = $('#' + id);
    status.textContent = message || '';
    status.className = 'sync-inline-status' + (stateName ? ' ' + stateName : '');
  }

  function activateSyncGroup(groupId) {
    if (!groupId) groupId = 'storage';
    $all('#sync-nav .sync-nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.syncGroup === groupId);
    });
    $all('#sync-mask .sync-section').forEach(function (section) {
      section.hidden = section.dataset.syncGroup !== groupId;
    });
  }

  /* 顶栏快捷入口：Word 写作与浏览器扩展（原来埋在设置 → 集成与服务，主界面看不到）。
   * 面板元素从设置弹窗整体搬了出来，ID 不变，处理器照旧工作。 */
  function openWordPanel() { if (wordPanel) wordPanel.open(); }

  function openBridgePanel() {
    if (!desktop) { toast(T('浏览器扩展仅在桌面版可用')); return; }
    $('#bridge-panel-mask').hidden = false;
    if (desktop.getSetting) {
      desktop.getSetting('bridgeEnabled').then(function (value) {
        $('#sync-bridge-enabled').checked = value !== false;
      }).catch(function () {});
    }
    refreshBridgeStatus();
  }
  function closeBridgePanel() { $('#bridge-panel-mask').hidden = true; }

  function checkForAppUpdate(manual) {
    if (!desktop || !desktop.checkAppUpdate) return;
    var button = $('#settings-check-update');
    if (manual && button) button.disabled = true;
    desktop.checkAppUpdate().then(function (result) {
      if (result && result.version) {
        toast(T('发现 LitBoard 新版本 ') + result.version, 30000, {
          label: T('下载新版'),
          fn: function () {
            desktop.downloadAppUpdate().catch(function (error) {
              toast(T('⚠ 无法打开下载链接：') + (error && error.message || error));
            });
          }
        });
        if (button) button.textContent = T('下载新版 ') + result.version;
      } else if (manual) {
        toast(T('当前已是最新版本'));
      }
    }).catch(function (error) {
      if (manual) toast(T('⚠ 检查更新失败：') + (error && error.message || error));
    }).finally(function () { if (button) button.disabled = false; });
  }

  function openSyncSettings(sectionId) {
    if (!desktop || !desktop.getIntegrationConfig) { toast(T('同步功能仅在桌面版可用')); return; }
    $('#sync-mask').hidden = false;
    // 设置弹窗版本号（index.html 的 <span id="settings-version"></span>；取不到就留空）
    var vEl = $('#settings-version');
    if (vEl && window.litboardDesktop && litboardDesktop.getAppVersion) {
      litboardDesktop.getAppVersion().then(function (v) {
        if (vEl && v) vEl.textContent = T('版本') + ' ' + v;
      }).catch(function () {});
    }
    applyModalSize($('.sync-modal'), readModalSizes().settings, 560, 360);
    activateSyncGroup('storage');
    $('#sync-status').classList.remove('error');
    $('#sync-status').textContent = T('正在读取配置…');
    setSyncInlineStatus('sync-data-path-status', T('正在读取…'), 'pending');
    setSyncInlineStatus('sync-nutstore-test-status', '', '');
    setSyncInlineStatus('sync-translator-test-status', '', '');
    setSyncInlineStatus('sync-scigreat-test-status', '', '');
    var dataPathsPromise = desktop.getDataPaths
      ? desktop.getDataPaths()
      : Promise.reject(new Error(T('当前桌面版本不支持自定义数据目录')));
    Promise.all([desktop.getIntegrationConfig(), dataPathsPromise]).then(function (values) {
      fillSyncForm(values[0]);
      fillDataPathForm(values[1]);
      if (window.LitAgentUi) LitAgentUi.onSettingsOpen();
      refreshPdfIndexStats();
      refreshBackupStatus();
      $('#sync-status').textContent = '';
      if (desktop.getSetting) {
        desktop.getSetting('translatorAutoTranslate').then(function (value) {
          $('#sync-translator-auto').checked = value === true;
        }).catch(function () {});
        desktop.getSetting('autoSyncEnabled').then(function (value) {
          $('#sync-auto-sync').checked = value !== false;
          autoSyncEnabled = value !== false;
        }).catch(function () {});
      }
      var syncThemeSelect = $('#sync-theme-select');
      if (syncThemeSelect) {
        syncThemeSelect.value = currentTheme();
      }
      var syncLangSelect = $('#sync-lang-select');
      if (syncLangSelect) {
        syncLangSelect.value = localStorage.getItem('litboard.lang') || 'auto';
      }
      // 指定 sectionId 时切到其所在分组并短暂高亮（首次使用清单「扩展」步、划词翻译、
      // 对话面板的「管理模型…」）；分组里该段可能不在视野内，滚动过去高亮才看得见
      if (sectionId && typeof sectionId === 'string') {
        var section = $('#' + sectionId + '-section');
        if (section) {
          activateSyncGroup(section.dataset.syncGroup);
          if (section.scrollIntoView) section.scrollIntoView({ block: 'start' });
          section.classList.add('sync-section-flash');
          setTimeout(function () { section.classList.remove('sync-section-flash'); }, 1600);
        }
      }
    }).catch(function (error) {
      // 配置没读上来：表单停在 HTML 默认值，装载守卫会拦住后续提交（不让默认值覆盖已存配置），
      // 所以必须说清楚「这里改了不会存」，否则用户以为改完就生效了
      $('#sync-status').textContent = T('读取配置失败：') + (error && error.message || error) +
        T('（配置未装载，本页改动不会保存；请重开设置页）');
      $('#sync-status').classList.add('error');
    });
  }

  function chooseDataPath(kind) {
    if (!desktop || !desktop.chooseDirectory) return;
    var input = kind === 'config' ? $('#sync-config-dir') : $('#sync-library-dir');
    var label = kind === 'config' ? T('配置与缓存目录') : T('文献库目录');
    desktop.chooseDirectory({ title: T('选择 LitBoard ') + label, defaultPath: input.value }).then(function (directory) {
      if (!directory) return;
      input.value = directory;
      setSyncInlineStatus('sync-data-path-status', T('目录已选择；应用后将重启并把数据搬到新目录'), 'warning');
    }).catch(function (error) {
      setSyncInlineStatus('sync-data-path-status', error && error.message || String(error), 'error');
    });
  }

  function applyDataPathChanges() {
    if (!desktop || !desktop.stageDataPaths || !desktop.relaunchApp) return;
    var button = $('#sync-data-paths-apply');
    button.disabled = true;
    setSyncInlineStatus('sync-data-path-status', T('正在保存当前文献库…'), 'pending');
    if (saveNotes && saveNotes.flush) saveNotes.flush();
    desktop.saveLibrary(workspacePayload()).then(function () {
      setSyncInlineStatus('sync-data-path-status', T('正在检查目标目录…'), 'pending');
      return desktop.stageDataPaths({
        configDir: $('#sync-config-dir').value.trim(),
        libraryDir: $('#sync-library-dir').value.trim()
      });
    }).then(function (result) {
      fillDataPathForm(result);
      if (!result.changed) {
        setSyncInlineStatus('sync-data-path-status', T('目录未更改，无需重启'), 'success');
        button.disabled = false;
        return false;
      }
      setSyncInlineStatus('sync-data-path-status', T('数据已安全保存，正在重启并迁移…'), 'pending');
      return desktop.relaunchApp().then(function (started) {
        if (!started) throw new Error(T('未能安排重启，请手动重启 LitBoard'));
        return true;
      });
    }).catch(function (error) {
      button.disabled = !!(dataPathInfo && (dataPathInfo.fatalError || dataPathInfo.rebasePending));
      setSyncInlineStatus('sync-data-path-status', error && error.message || String(error), 'error');
    });
  }

  function saveSyncSettings(opts) {
    if (!desktop) return Promise.reject(new Error(T('同步功能仅在桌面版可用')));
    var auto = !!(opts && opts.auto);
    return desktop.saveIntegrationConfig(syncFormValue()).then(function (config) {
      integrationConfig = config;
      if (remotePlan) remotePlan.markRefreshFormAfterSync();
      // 自动保存不回填表单：异步返回时会覆盖用户正在编辑的其他字段
      if (!auto) fillSyncForm(config);
      else afterAgentProvidersSaved();
      $('#sync-status').classList.remove('error');
      $('#sync-status').textContent = auto ? T('已自动保存 · ') + new Date().toLocaleTimeString() : T('配置已保存');
      // 这几个开关只活在设置表单的 DOM 里：表单没装载时读到的是 HTML 默认值，
      // 写回去等于替用户改开关（关掉的自动同步被打开、网页检索被打开）。未装载就整块跳过。
      if (desktop.setSetting && syncFormLoaded) {
        autoSyncEnabled = $('#sync-auto-sync').checked;
        desktop.setSetting('autoSyncEnabled', autoSyncEnabled).catch(function () {});
        // AI 助手（一期）：会话根目录走 settings 表；凭据走 integrations.json
        if ($('#sync-agent-session-root')) {
          var agentRoot = $('#sync-agent-session-root').value.trim();
          if (agentRoot) desktop.setSetting('agentSessionRoot', agentRoot).catch(function () {});
          // R17：自动压缩上下文开关（与凭据同区，保存即生效）
          if ($('#sync-agent-autocompact')) {
            desktop.setSetting('autoCompactEnabled', $('#sync-agent-autocompact').checked).catch(function () {});
          }
          if (window.LitAgentUi) LitAgentUi.refreshConfig();
        }
        // M9-4：科研网页检索开关（出境告知在开启瞬间的 change 监听里落 webSearchEgressAcknowledged）
        if ($('#sync-web-search-enabled')) {
          desktop.setSetting('webSearchEnabled', $('#sync-web-search-enabled').checked).catch(function () {});
          if (window.LitAgentUi) LitAgentUi.refreshConfig();
        }
        // 扩展桥开关不在这里落：它是顶栏「扩展」面板的控件（自己的 change 监听立即生效），
        // 本函数读不到它的真实勾选态——面板没开过就是 HTML 默认的未勾选，写了会停掉扩展桥
      }
      // 自动保存只落本机；上传云端仍由「立即同步」/内容变化自动同步触发
      if (!auto) scheduleNutstoreSync();
      if (drawerId) refreshJournalRank(true);
      return config;
    });
  }

  var syncAutoSaveTimer = null;
  var syncAutoSaveDirty = false;
  function queueSyncAutoSave() {
    syncAutoSaveDirty = true;
    if (syncAutoSaveTimer) clearTimeout(syncAutoSaveTimer);
    syncAutoSaveTimer = setTimeout(function () {
      syncAutoSaveTimer = null;
      flushSyncAutoSave();
    }, 600);
  }
  function flushSyncAutoSave() {
    if (syncAutoSaveTimer) { clearTimeout(syncAutoSaveTimer); syncAutoSaveTimer = null; }
    if (!syncAutoSaveDirty) return Promise.resolve(null);
    syncAutoSaveDirty = false;
    // 返回 promise：调用方（服务商的「测试连接 / 拉取模型」）要等落盘完成才能按 id 取凭据
    return saveSyncSettings({ auto: true }).catch(function (error) {
      $('#sync-status').classList.add('error');
      $('#sync-status').textContent = T('自动保存失败：') + (error && error.message || String(error));
      toast(T('设置自动保存失败：') + (error && error.message || error));
    });
  }
  function cancelSyncAutoSave() {
    if (syncAutoSaveTimer) { clearTimeout(syncAutoSaveTimer); syncAutoSaveTimer = null; }
    syncAutoSaveDirty = false;
  }
  function closeSyncSettings() {
    flushSyncAutoSave();
    $('#sync-mask').hidden = true;
  }

  var bridgeTokenCache = '';
  function refreshBridgeStatus() {
    if (!desktop || !desktop.bridgeStatus) return;
    desktop.bridgeStatus().then(function (status) {
      bridgeTokenCache = status.token || '';
      var el = $('#sync-bridge-status');
      if (el) {
        el.textContent = status.running
          ? T('运行中 · 端口 ') + status.port
          : T('未运行');
      }
    }).catch(function () {});
  }

  // ---------- 完整备份（简化设置：目录、立即备份、恢复） ----------
  function setBackupStatusText(message, stateName) {
    var el = $('#sync-backup-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'sync-inline-status' + (stateName ? ' ' + stateName : '');
  }

  function refreshBackupStatus() {
    if (!desktop || !desktop.getBackupStatus) return Promise.resolve(null);
    return desktop.getBackupStatus().then(function (info) {
      var input = $('#sync-backup-dir');
      if (input) input.value = info.backupDir || '';
      var configured = !!info.configured;
      var restoreBtn = $('#sync-backup-restore');
      var openBtn = $('#sync-backup-open');
      var backupBtn = $('#sync-backup-now');
      if (restoreBtn) restoreBtn.disabled = !configured;
      if (openBtn) openBtn.disabled = !configured;
      if (backupBtn) backupBtn.disabled = !configured;
      if (!configured) {
        setBackupStatusText(T('未设置备份目录 — 选择目录后立即创建首份完整备份。'), '');
        return info;
      }
      var parts = [];
      if (info.lastBackupAt) parts.push(T('上次备份：') + new Date(info.lastBackupAt).toLocaleString());
      if (info.snapshots && info.snapshots.length) {
        parts.push(T('备份副本 ') + info.snapshots.length + T(' 份（保留 ') + info.keepSnapshots + '）');
      }
      setBackupStatusText(parts.join(' · ') || T('已配置'), 'success');
      return info;
    }).catch(function () { return null; });
  }

  function chooseBackupDir() {
    if (!desktop || !desktop.chooseBackupDir) return;
    setBackupStatusText(T('正在选择目录并创建首份备份…'), 'pending');
    desktop.chooseBackupDir().then(function (result) {
      if (!result || result.canceled) { refreshBackupStatus(); return; }
      if (result.error) { setBackupStatusText(T('备份目录不可用：') + result.error, 'error'); return; }
      if (result.backup && result.backup.ok) {
        setBackupStatusText(T('✓ 备份目录已设置，首份完整备份已创建（') + result.backup.snapshotId + '）', 'success');
      } else if (result.backup && result.backup.existing) {
        setBackupStatusText(T('✓ 已挂载现有备份目录；未创建空库备份副本'), 'success');
      }
      refreshBackupStatus();
    }).catch(function (error) {
      setBackupStatusText(T('设置备份目录失败：') + (error && error.message || error), 'error');
    });
  }

  function runBackupNow() {
    if (!desktop || !desktop.backupNow) return;
    setBackupStatusText(T('正在创建完整备份…'), 'pending');
    desktop.backupNow().then(function (result) {
      if (result && result.ok && result.unchanged) {
        setBackupStatusText(T('✓ 文献库与最近一份备份副本内容一致，未重复保存（仍为 ') + result.snapshotId + '）', 'success');
      } else if (result && result.ok) {
        setBackupStatusText(T('✓ 完整备份完成：') + result.snapshotId, 'success');
      } else {
        setBackupStatusText(T('备份失败：') + ((result && result.error) || T('未知错误')), 'error');
      }
      refreshBackupStatus();
    }).catch(function (error) {
      setBackupStatusText(T('备份失败：') + (error && error.message || error), 'error');
    });
  }

  function restoreFromBackup() {
    if (!desktop || !desktop.restoreBackup) return;
    refreshBackupStatus().then(function (info) {
      var snapshots = info && info.snapshots ? info.snapshots.filter(function (item) { return item.valid; }) : [];
      if (!snapshots.length) { setBackupStatusText(T('备份目录中没有有效备份副本'), 'warning'); return; }
      dlgPick(T('从完整备份恢复'), T('选择要还原的备份副本（恢复前会先创建当前库的紧急备份副本，并逐项校验所选备份副本的数据库与附件哈希，随后重启应用）：'),
        snapshots.map(function (item) { return { id: item.id, label: item.createdAt + ' · ' + (item.assets || 0) + T(' 个附件') }; }))
        .then(function (snapshotId) {
          if (!snapshotId) return;
          return dlgConfirm(T('恢复完整备份'), T('将把当前文献库替换为备份副本 ') + snapshotId + T(' 的内容。') +
            T('当前库会先自动备份为紧急备份副本，恢复后应用将重启。是否继续？'), T('恢复并重启'), true)
            .then(function (ok) {
              if (!ok) return;
              setBackupStatusText(T('正在创建紧急备份副本并恢复…'), 'pending');
              return desktop.restoreBackup(snapshotId).then(function (result) {
                if (result && result.ok) setBackupStatusText(T('✓ 已从 ') + result.snapshotId + T(' 恢复，应用即将重启…'), 'success');
                else setBackupStatusText(T('恢复失败：') + ((result && result.error) || T('未知错误')), 'error');
              });
            });
        }).catch(function (error) {
          setBackupStatusText(T('恢复失败：') + (error && error.message || error), 'error');
        });
    });
  }

  function openBackupDir() {
    if (!desktop || !desktop.openBackupDir) return;
    desktop.openBackupDir().then(function (error) {
      if (error) setBackupStatusText(T('打开备份目录失败：') + error, 'error');
    }).catch(function () {});
  }

  /** 库内带本地全文文件（PDF/EPUB）的附件总数（与 LitPdfSearch 的索引单元口径一致） */
  function localPdfUnitCount() {
    var count = 0;
    state.papers.forEach(function (paper) {
      if (paper.deletedAt) return;
      var list = (paper.attachments || []).filter(function (attachment) {
        return attachment && (attachment.kind === 'pdf' || attachment.kind === 'epub') && attachment.path;
      });
      if (list.length) count += list.length;
      else if (paper.pdfPath) count++;
    });
    return count;
  }

  function refreshPdfIndexStats() {
    if (!desktop || !desktop.pdfSearchStats) return;
    desktop.pdfSearchStats().then(function (stats) {
      var el = $('#pdf-index-stats');
      if (!el) return;
      var mb = (stats.chars || 0) / 1024 / 1024;
      var indexed = stats.entries || 0;
      var total = localPdfUnitCount();
      var missing = Math.max(0, total - indexed);
      var text = T('已索引 ') + indexed + ' / ' + total +
        T(' 篇全文正文（约 ') + (mb >= 0.1 ? mb.toFixed(1) + ' MB' : '0 MB') + '）。';
      if (!total) text = T('库内没有带本地全文文件（PDF/EPUB）的文献。');
      else if (missing) text += T('其余 ') + missing + T(' 篇在首次全文检索时自动构建，也可点「构建索引」立即生成。');
      el.textContent = text;
    }).catch(function () {});
  }

  function applySyncedWorkspace(value, skipNutstoreSync) {
    var saved = workspaceStore.applyIncoming(value, skipNutstoreSync); renderAll();
    if (drawerId && getById(drawerId)) openDrawer(drawerId);
    return saved;
  }

  /**
   * Zotero 快照并入当前工作区（重复导入幂等）：
   * - papers 按 sourceLibraryId+zoteroKey 匹配（多库防跨库误命中）；元数据只补空字段，非空差异记入 conflicts（只读，不覆盖本地已改内容）；
   * - 阅读状态/评分/笔记/批注/引用数等用户内容一律保留本地；批注按 id 并集（Zotero key 派生 id 幂等）；
   * - 附件按 zoteroKey 判重补缺；已有同 key 附件缺本地路径时回填本次路径；notes 按 zoteroKey 幂等（已有同 key 笔记跳过不覆盖）；
   * - 文件夹按 id 合并：本地 fzc 文件夹保留（用户重命名不丢），只新增源内缺失的；标签颜色只补缺失。
   * 返回 { workspace, conflicts, stats }。
   */
  function mergeZoteroImport(currentValue, zoteroValue) {
    var current = window.LitModel.normalizeWorkspace(currentValue, uid);
    var zotero = window.LitModel.normalizeWorkspace(zoteroValue, uid);
    var conflicts = [];
    var stats = { papersAdded: 0, papersUpdated: 0, attachmentsAdded: 0, notesAdded: 0, notesSkipped: 0, annotationsAdded: 0 };
    // 匹配键 = 来源库 + Zotero key（多库/群组库同 key 不串库；单库时与旧行为一致）
    function zKeyOf(item) {
      return item && item.zoteroKey ? String(item.sourceLibraryId || '') + ':' + item.zoteroKey : '';
    }
    var byZoteroKey = {};
    current.papers.forEach(function (paper, index) {
      var key = zKeyOf(paper);
      if (key) byZoteroKey[key] = index;
    });
    // 只补空的元数据字段；阅读状态等用户内容经 preserve 保留
    var FILL_FIELDS = ['abstract', 'doi', 'url', 'venue', 'volume', 'issue', 'pages', 'publisher',
      'place', 'series', 'journalAbbreviation', 'issn', 'isbn', 'edition', 'language',
      'date', 'accessDate', 'oaUrl', 'openalexId', 'key'];
    // 冲突对照（只读）：双方都非空且不一致的字段
    var CONFLICT_FIELDS = ['title', 'date', 'venue', 'doi', 'volume', 'issue', 'pages', 'publisher', 'abstract'];
    zotero.papers.forEach(function (incoming) {
      var inKey = zKeyOf(incoming);
      var index = inKey ? byZoteroKey[inKey] : undefined;
      if (index == null) {
        current.papers.push(incoming);
        if (inKey) byZoteroKey[inKey] = current.papers.length - 1;
        stats.papersAdded++;
        return;
      }
      var existing = current.papers[index];
      var next = Object.assign({}, existing);
      var changed = false;
      FILL_FIELDS.forEach(function (field) {
        if (!next[field] && incoming[field]) { next[field] = incoming[field]; changed = true; }
      });
      if (next.year == null && incoming.year != null) { next.year = incoming.year; changed = true; }
      if ((!next.creators || !next.creators.length) && incoming.creators && incoming.creators.length) {
        next.creators = incoming.creators; changed = true;
      }
      if (!next.entryType || next.entryType === 'misc' && incoming.entryType !== 'misc') {
        if (incoming.entryType && incoming.entryType !== next.entryType) { next.entryType = incoming.entryType; changed = true; }
      }
      CONFLICT_FIELDS.forEach(function (field) {
        var localValue = existing[field], remoteValue = incoming[field];
        if (localValue && remoteValue && String(localValue) !== String(remoteValue) &&
            (field !== 'doi' || window.LitDedupe.normDoi(localValue) !== window.LitDedupe.normDoi(remoteValue))) {
          conflicts.push({ zoteroKey: incoming.zoteroKey, paperId: existing.id, field: field,
            localValue: String(localValue).slice(0, 300), zoteroValue: String(remoteValue).slice(0, 300) });
        }
      });
      if (String(existing.authors || '') !== String(incoming.authors || '') &&
          (existing.authors || []).length && (incoming.authors || []).length) {
        conflicts.push({ zoteroKey: incoming.zoteroKey, paperId: existing.id, field: 'authors',
          localValue: (existing.authors || []).join('; ').slice(0, 300),
          zoteroValue: (incoming.authors || []).join('; ').slice(0, 300) });
      }
      // 附件按 zoteroKey 补缺（多库复合键）；同 key 已存在但本地缺路径 → 回填本次路径（上次源文件缺失时导入空路径）
      var attachmentKeys = {};
      (next.attachments || []).forEach(function (att) { var k = zKeyOf(att); if (k) attachmentKeys[k] = true; });
      (incoming.attachments || []).forEach(function (att) {
        var attKey = zKeyOf(att);
        if (attKey && attachmentKeys[attKey]) {
          var prev = (next.attachments || []).find(function (x) { return zKeyOf(x) === attKey; });
          if (prev && !prev.path && att.path) {
            prev.path = att.path;
            if (!prev.fileName && att.fileName) prev.fileName = att.fileName;
            changed = true;
          }
          return;
        }
        if (!attKey && (next.attachments || []).some(function (x) { return x.fingerprint && x.fingerprint === att.fingerprint; })) return;
        next.attachments = (next.attachments || []).concat([att]);
        if (attKey) attachmentKeys[attKey] = true;
        stats.attachmentsAdded++;
        changed = true;
      });
      // 批注按 id 并集（id 由 Zotero key 派生，重复导入幂等），再做内容指纹去重
      var annIds = {};
      (next.pdfAnnotations || []).forEach(function (ann) { annIds[ann.id] = true; });
      var freshAnns = (incoming.pdfAnnotations || []).filter(function (ann) { return !annIds[ann.id]; });
      if (freshAnns.length) {
        next.pdfAnnotations = window.LitModel.dedupeAnnotations((next.pdfAnnotations || []).concat(freshAnns));
        stats.annotationsAdded += freshAnns.length;
        changed = true;
      }
      // 文件夹：本地非 fzc + Zotero fzc
      var localFolderIds = (next.folderIds || []).filter(function (id) { return !/^fzc/.test(id); });
      next.folderIds = localFolderIds.concat(incoming.folderIds || []);
      // 用户内容一律保留本地（不动 status/rating/notes/addedAt/citations/引用来源等）
      if (changed) {
        stats.papersUpdated++;
        var norm = window.LitModel.normalizePaper(next, uid);
        norm.id = existing.id;
        current.papers[index] = norm;
      }
    });
    // 笔记按 zoteroKey 幂等：本地已有同 key 笔记一律跳过（不覆盖本地笔记）
    var noteKeys = {};
    (current.notes || []).forEach(function (note) { var k = zKeyOf(note); if (k) noteKeys[k] = true; });
    (zotero.notes || []).forEach(function (note) {
      var noteKey = zKeyOf(note);
      if (noteKey && noteKeys[noteKey]) { stats.notesSkipped++; return; }
      current.notes.push(note);
      if (noteKey) noteKeys[noteKey] = true;
      stats.notesAdded++;
    });
    // 标签颜色只补缺失
    var tagSeen = {};
    (current.tagColorRecords || []).forEach(function (record) { tagSeen[record.tag] = true; });
    (zotero.tagColorRecords || []).forEach(function (record) {
      if (tagSeen[record.tag]) return;
      tagSeen[record.tag] = true;
      current.tagColorRecords.push(record);
    });
    // 文件夹按 id 合并：本地已有（含 fzc）保留用户本地名（重命名不丢），只新增源内缺失的
    var folderById = {};
    current.folders.forEach(function (folder) { folderById[folder.id] = true; });
    (zotero.folders || []).forEach(function (folder) {
      if (!folderById[folder.id]) { current.folders.push(folder); folderById[folder.id] = true; }
    });
    return { workspace: window.LitModel.normalizeWorkspace(current, uid), conflicts: conflicts, stats: stats };
  }

  /** 旧调用方（云附件迁移）保持返回工作区的签名 */
  function mergeZoteroSnapshot(currentValue, zoteroValue) {
    return mergeZoteroImport(currentValue, zoteroValue).workspace;
  }

  function setSyncIndicator(stateName, detail) {
    var el = $('#sync-indicator');
    if (!el) return;
    el.classList.remove('syncing', 'ok', 'error');
    el.innerHTML = svgUse('lb-i-sync');
    if (stateName === 'syncing') {
      el.classList.add('syncing');
      el.title = T('正在同步…');
    } else if (stateName === 'ok') {
      el.classList.add('ok');
      el.title = T('上次同步：') + (detail || new Date().toLocaleTimeString());
    } else if (stateName === 'error') {
      el.classList.add('error');
      el.title = T('同步失败：') + (detail || '');
    } else {
      el.title = detail || T('同步状态');
    }
  }

  function applyPortableConfigRuntime(config) {
    if (!config || typeof config !== 'object') return;
    if (config.autoWriteBack != null) autoWriteBack = config.autoWriteBack === true;
  }

  function performSync(config, silent) {
    if (syncBusy || !desktop) return Promise.resolve(false);
    if (libraryLoadFailed) {
      var loadError = T('本地数据库未加载成功，已阻止同步：请重启应用或检查数据目录，避免把空库传到云端');
      setSyncIndicator('error', loadError);
      if (!silent) {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = loadError;
        toast(T('同步已阻止：') + loadError);
      }
      return Promise.resolve(false);
    }
    var useNutstore = config.nutstoreUser && config.hasNutstorePassword;
    if (!useNutstore) {
      // 不抛异常：调用点是点击处理里 fire-and-forget 的 .then，抛出去只会变成未捕获的
      // rejection（控制台报错，而界面上停在上一句「配置已保存」，看着像点了没反应）
      var notConfigured = T('请先配置坚果云账号和应用密码');
      setSyncIndicator('error', notConfigured);
      if (!silent) {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = notConfigured;
        toast(T('同步失败：') + notConfigured);
      }
      return Promise.resolve(false);
    }
    syncBusy = true;
    $('#sync-stop').hidden = false;
    $('#sync-stop').disabled = false;
    setSyncIndicator('syncing');
    if (!silent) { $('#sync-status').classList.remove('error'); $('#sync-status').textContent = T('正在同步…'); }
    var current = workspacePayload();
    var syncRevision = workspaceStore.getRevision();
    var chain = Promise.resolve(current);
    if (useNutstore) chain = chain.then(function (workspace) { return desktop.syncNutstore(workspace); });
    return chain.then(function (result) {
      if (result && (result.pendingPlan || result.plan)) {
        showRemotePlan(result.pendingPlan || result.plan);
        setSyncInlineStatus('sync-remote-status', T('后台同步发现冲突，云端写入已暂停'), 'warning');
        if (!silent) $('#sync-status').textContent = T('同步发现冲突，请完成云端对照');
        return false;
      }
      var workspace = result && result.workspace ? result.workspace : result;
      if (workspaceStore.getRevision() !== syncRevision) {
        scheduleNutstoreSync(true); // 本次同步已在进行中，收尾重排队不受自动同步开关影响
        if (!silent) $('#sync-status').textContent = T('检测到新的本地修改，已重新排队同步');
        return true;
      }
      return applySyncedWorkspace(workspace, true).then(function () {
        if (result && result.config && remotePlan && remotePlan.shouldRefreshForm()) {
          integrationConfig = result.config;
          applyPortableConfigRuntime(result.config);
          fillSyncForm(result.config);
          remotePlan.clearRefreshFormFlag();
        }
        if (desktop.getIntegrationConfig) {
          desktop.getIntegrationConfig().then(function (freshConfig) {
            integrationConfig = freshConfig;
            applyPortableConfigRuntime(freshConfig);
          }).catch(function () {});
        }
        var assetFailures = result && result.assets && result.assets.failures || [];
        if (assetFailures.length) {
          // 附件失败不再阻断文献库写入；明确提示，进度已记台账、下次同步自动续传
          var afMsg = T('文献库已同步，') + assetFailures.length + T(' 个附件暂时失败（下次同步自动续传）');
          setSyncIndicator('error', afMsg);
          if (!silent) $('#sync-status').textContent = afMsg;
          toast('⚠ ' + afMsg);
        } else {
          setSyncIndicator('ok');
          if (result && result.conflicts && result.conflicts.length) showSyncConflicts(result.conflicts);
          if (!silent) $('#sync-status').textContent = T('同步完成 · ') + new Date().toLocaleTimeString();
          if (!silent) toast(T('同步完成'));
        }
        return true;
      });
    }).catch(function (error) {
      if (error && String(error.message || error).indexOf('同步已停止') !== -1) {
        setSyncIndicator('', T('同步已停止'));
        if (!silent) $('#sync-status').textContent = T('同步已停止；已上传附件下次可续传');
        return false;
      }
      setSyncIndicator('error', error && error.message || String(error));
      if (!silent) {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = error && error.message || String(error);
      }
      if (!silent) toast(T('同步失败：') + (error && error.message || error));
      return false;
    }).finally(function () {
      syncBusy = false;
      $('#sync-stop').hidden = true;
    });
  }

  var creatingFolderParentId = '';
  function openFolderCreator(parentId) {
    creatingFolderParentId = parentId || '';
    var parent = state.folders.find(function (folder) { return folder.id === creatingFolderParentId; });
    $('#folder-create-parent').hidden = !parent;
    $('#folder-create-parent').textContent = parent ? T('新建于：') + folderPath(parent) : '';
    $('#folder-create-form').hidden = false;
    $('#folder-create-error').textContent = '';
    $('#folder-name-input').focus();
  }

  /* ---- 主题与界面语言（js/app/theme.js）：适配层 ---- */
  var theme = null;
  function initTheme() {
    if (!window.LitTheme) return;
    theme = window.LitTheme.create({
      T: T, $: $, svgUse: svgUse, toast: toast, showCtxMenu: showCtxMenu,
      renderAll: renderAll, renderPdfTabs: renderPdfTabs,
      desktop: function () { return desktop; },
      i18n: window.LitI18n
    });
  }
  function currentTheme() { return theme ? theme.current() : (localStorage.getItem('litboard.theme') || 'auto'); }
  function applyTheme(t) { if (theme) theme.apply(t); }
  function setTheme(t) { if (theme) theme.set(t); }
  function cycleTheme() { if (theme) theme.cycle(); }
  function showThemeMenu() { if (theme) theme.showMenu(); }
  function applyLanguage(value) { if (theme) theme.applyLanguage(value); }

  // ---------- 无边框窗口控制 ----------
  function setMaximizedUi(maximized) {
    document.body.classList.toggle('win-maximized', maximized);
    var maxBtn = $('#win-max');
    if (!maxBtn) return;
    var iconMax = maxBtn.querySelector('.win-icon-max');
    var iconRestore = maxBtn.querySelector('.win-icon-restore');
    if (iconMax) iconMax.hidden = maximized;
    if (iconRestore) iconRestore.hidden = !maximized;
    maxBtn.title = maximized ? T('还原') : T('最大化');
  }
  function initWindowControls() {
    if (!desktop || !desktop.windowMinimize) return;
    var controls = $('#window-controls');
    if (!controls) return;
    controls.hidden = false;
    $('#win-min').addEventListener('click', function () { desktop.windowMinimize(); });
    $('#win-max').addEventListener('click', function () { desktop.windowToggleMaximize(); });
    $('#win-close').addEventListener('click', function () { desktop.windowClose(); });
    if (desktop.windowIsMaximized) {
      desktop.windowIsMaximized().then(setMaximizedUi).catch(function () {});
    }
    if (desktop.onWindowMaximizeChanged) desktop.onWindowMaximizeChanged(setMaximizedUi);
    if (desktop.onSyncProgress) desktop.onSyncProgress(handleSyncProgress);
    // 双击拖拽区切换最大化（Windows 习惯）
    $('.topbar').addEventListener('dblclick', function (event) {
      if (event.target.closest('button, input, .menu, .window-controls')) return;
      desktop.windowToggleMaximize();
    });
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    bindPaneResizer('resizer-left', 'left');
    bindPaneResizer('resizer-right', 'right');
    $('#btn-left-sidebar-collapse').addEventListener('click', function () { setLeftSidebarCollapsed(true, true); });
    $('#btn-left-sidebar-open').addEventListener('click', function () { setLeftSidebarCollapsed(false, true); });
    $('#btn-right-sidebar-toggle').addEventListener('click', function () {
      setRightSidebarCollapsed(!$('.workspace').classList.contains('rail-collapsed'), true);
    });
    new ResizeObserver(function () { applyTableColumns(true); }).observe($('#table-wrap'));
    bindModalResizer($('.sync-modal'), $('#sync-resize-grip'), 'settings', 560, 360);
    bindModalResizer($('.graph-modal'), $('#graph-resize-grip'), 'graph', 900, 560);
    applyModalSize($('.graph-modal'), readModalSizes().graph, 900, 560);
    window.addEventListener('resize', debounce(function () {
      applyPaneSizes({
        left: Number($('.workspace').dataset.leftWidth) || 220,
        right: Number($('.workspace').dataset.rightWidth) || 370
      });
    }, 100));
    // 资料库与文件夹
    $('#btn-new-folder').addEventListener('click', function () { openFolderCreator(''); });
    $('#btn-sync').addEventListener('click', function () { openSyncSettings(); });
    $('#btn-word').addEventListener('click', openWordPanel);
    $('#btn-bridge').addEventListener('click', openBridgePanel);
    // 右栏图标轨（详情 / AI 助手 / 阅读批注）在 agentui 内部绑定，此处不重复
    // 更多菜单（顶栏瘦身：低频操作收进这里）
    registerTopbarMenu($('#btn-more'), $('#more-menu'));
    $('#btn-more').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleTopbarMenu($('#more-menu'));
    });
    document.addEventListener('click', function () { $('#more-menu').hidden = true; });
    $('#more-menu').addEventListener('click', function () { $('#more-menu').hidden = true; });
    bindAgentSettings();
    $('#bridge-panel-close').addEventListener('click', closeBridgePanel);
    $('#bridge-panel-mask').addEventListener('click', function (e) { if (e.target === this) closeBridgePanel(); });
    $('#sync-nav').addEventListener('click', function (e) {
      var btn = e.target.closest('.sync-nav-btn');
      if (btn) activateSyncGroup(btn.dataset.syncGroup);
    });
    $('#sync-close').addEventListener('click', closeSyncSettings);
    $('#settings-check-update').addEventListener('click', function () {
      var button = $('#settings-check-update');
      if (button.textContent.indexOf(T('下载新版 ')) === 0) {
        desktop.downloadAppUpdate().catch(function (error) {
          toast(T('⚠ 无法打开下载链接：') + (error && error.message || error));
        });
      } else checkForAppUpdate(true);
    });
    // 设置项改动即自动保存：文本输入在失焦/回车时（change），勾选与下拉即时
    ['sync-nutstore-url', 'sync-nutstore-user', 'sync-nutstore-password', 'sync-nutstore-folder',
      'sync-zotero-webdav-folder', 'sync-translator-provider', 'sync-translator-target',
      'sync-translator-model', 'sync-translator-api-key', 'sync-rank-provider',
      'sync-scigreat-api-key', 'sync-easyscholar-api-key', 'sync-auto-sync',
      // 检索/元数据服务、向量模型与 AI 预算：以前只搭别的字段的顺风车，
      // 单改这些字段（页脚承诺「改动即时保存」）关窗就丢，这里补齐
      'sync-openalex-email', 'sync-openalex-key', 'sync-elsevier-key', 'sync-tinyfish-key',
      'sync-embed-provider', 'sync-embed-base-url', 'sync-embed-model', 'sync-embed-api-key',
      'sync-agent-context-tokens', 'sync-agent-max-output-tokens', 'sync-agent-session-root',
      'sync-agent-autocompact'
    ].forEach(function (id) {
      $('#' + id).addEventListener('change', queueSyncAutoSave);
    });
    $('#sync-rank-provider').addEventListener('change', updateRankProviderFields);
    // 扩展开关已搬到顶栏「扩展」面板：不能走设置自动保存（设置从未打开时表单是空的，
    // 保存会把空配置写回去抹掉凭据），改为立即生效
    $('#sync-bridge-enabled').addEventListener('change', function () {
      if (!desktop || !desktop.bridgeSetEnabled) return;
      desktop.bridgeSetEnabled(this.checked).then(refreshBridgeStatus).catch(function () {});
    });
    var syncThemeSelect = $('#sync-theme-select');
    if (syncThemeSelect) {
      syncThemeSelect.addEventListener('change', function () {
        setTheme(this.value);
      });
    }
    var syncLangSelect = $('#sync-lang-select');
    if (syncLangSelect) {
      syncLangSelect.addEventListener('change', function () {
        applyLanguage(this.value);
      });
    }
    $('#sync-font-size-down').addEventListener('click', function () { applyFontScale(fontScale - 0.1); });
    $('#sync-font-size-reset').addEventListener('click', function () { applyFontScale(1); });
    $('#sync-font-size-up').addEventListener('click', function () { applyFontScale(fontScale + 0.1); });
    $('#sync-choose-config-dir').addEventListener('click', function () { chooseDataPath('config'); });
    $('#sync-choose-library-dir').addEventListener('click', function () { chooseDataPath('library'); });
    $('#sync-data-paths-apply').addEventListener('click', applyDataPathChanges);
    $('#sync-backup-choose').addEventListener('click', chooseBackupDir);
    $('#sync-backup-now').addEventListener('click', runBackupNow);
    $('#sync-backup-restore').addEventListener('click', restoreFromBackup);
    $('#sync-backup-open').addEventListener('click', openBackupDir);
    $('#sync-stop').addEventListener('click', function () {
      if (!syncBusy || !desktop || !desktop.cancelNutstoreSync) return;
      this.disabled = true;
      $('#sync-status').textContent = T('正在停止同步…');
      desktop.cancelNutstoreSync().catch(function (error) {
        $('#sync-stop').disabled = false;
        $('#sync-status').textContent = error && error.message || String(error);
      });
    });
    /* 远端对照/冲突弹窗整体在 js/app/remote-plan.js */
    initRemotePlan();
    $('#sync-translator-provider').addEventListener('change', updateTranslatorFields);
    $('#sync-translator-auto').addEventListener('change', function () { setTranslatorAutoTranslate(this.checked, true); });
    $('#sync-test-nutstore').addEventListener('click', function () {
      var button = this;
      button.disabled = true;
      setSyncInlineStatus('sync-nutstore-test-status', T('正在连接…'), 'pending');
      desktop.testNutstoreConnection(syncFormValue()).then(function (result) {
        var message = result.folderExists
          ? T('连接成功 · ') + result.folder
          : T('连接成功 · 目录将在首次同步时创建');
        setSyncInlineStatus('sync-nutstore-test-status', message, 'success');
      }).catch(function (error) {
        setSyncInlineStatus('sync-nutstore-test-status', error && error.message || String(error), 'error');
      }).finally(function () { button.disabled = false; });
    });
    $('#sync-test-translator').addEventListener('click', function () {
      var button = this;
      button.disabled = true;
      setSyncInlineStatus('sync-translator-test-status', T('正在翻译测试文本…'), 'pending');
      desktop.testTranslationConnection(syncFormValue()).then(function (result) {
        var provider = TRANSLATOR_NAMES[result.provider] || result.provider;
        setSyncInlineStatus('sync-translator-test-status', T('连接成功 · ') + provider + ' · ' + result.translation, 'success');
      }).catch(function (error) {
        setSyncInlineStatus('sync-translator-test-status', error && error.message || String(error), 'error');
      }).finally(function () { button.disabled = false; });
    });
    $('#sync-test-scigreat').addEventListener('click', function () {
      var button = this;
      button.disabled = true;
      setSyncInlineStatus('sync-scigreat-test-status', T('正在测试…'), 'pending');
      var provider = $('#sync-rank-provider').value;
      desktop.testScigreatConnection({
        rankProvider: provider,
        scigreatApiKey: secretInputValue('sync-scigreat-api-key'),
        easyscholarApiKey: secretInputValue('sync-easyscholar-api-key'),
        journal: 'Nature'
      }).then(function (result) {
        var data = rankResultData(result);
        var label = result.provider === 'easyscholar' ? 'EasyScholar' : 'OneScholar/SciGreat';
        setSyncInlineStatus('sync-scigreat-test-status', data
          ? T('API 可用 · ') + label + ' · ' + journalRankSummary(data)
          : T('已连接，但测试期刊无结果'), data ? 'success' : 'warning');
      }).catch(function (error) {
        setSyncInlineStatus('sync-scigreat-test-status', error && error.message || String(error), 'error');
      }).finally(function () { button.disabled = false; });
    });
    /* 检索与元数据服务：一个按钮测设置页可配置的三个源（OpenAlex / Elsevier / TinyFish）。
     * 逐行列出「哪个源能用、为什么不能用」——只报一句成功/失败等于没说。服务名是专有名词，
     * 不进词典；状态与细节走 T()。 */
    var SOURCE_TEST_LABELS = {
      openalex: 'OpenAlex', elsevier: 'Elsevier', tinyfish: 'TinyFish'
    };
    function sourceStatusText(item) {
      if (item.status === 'ok') return T('可用');
      if (item.status === 'skipped') {
        return item.code === 'not_enabled' ? T('未启用（需先勾选并确认出境告知）') : T('未配置');
      }
      var code = item.code || 'error';
      if (code === 'unauthorized') return T('凭据无效或无权限');
      if (code === 'rate_limited') return T('上游限流（稍后重试）');
      if (code === 'network') return T('无法连接');
      return T('测试失败');
    }
    function sourceDetailText(item) {
      if (item.status !== 'ok') return '';
      var parts = [];
      if (item.id === 'openalex') {
        parts.push(item.channel === 'key' ? T('带 API Key')
          : (item.channel === 'email' ? T('polite pool（邮箱）') : T('未填邮箱')));
        parts.push(T('命中 {n} 条').replace('{n}', String(item.count == null ? 0 : item.count)));
      } else if (item.id === 'elsevier') {
        // 摘要回填（只需 Key）与 Scopus 检索（另需机构订阅）分开说：常见情形是前者通、
        // 后者无权限，含混成一句会让用户以为 Key 坏了
        parts.push(item.abstract ? T('摘要回填可用') : T('摘要端点无该 DOI 记录'));
        if (item.scopus === 'ok') parts.push(T('Scopus 检索可用'));
        else if (item.scopus === 'unauthorized') parts.push(T('Scopus 检索无权限（需机构订阅）'));
        else parts.push(T('Scopus 检索不可用'));
      } else if (item.id === 'tinyfish') {
        parts.push(T('命中 {n} 条').replace('{n}', String(item.count == null ? 0 : item.count)));
      }
      return parts.join(' · ');
    }
    function renderSourcesTestResult(results) {
      var box = $('#sync-sources-test-result');
      if (!box) return;
      box.textContent = '';
      if (!results || !results.length) { box.hidden = true; return; }
      results.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'st-row' + (item.status === 'error' ? ' bad' : '');
        var name = document.createElement('span');
        name.className = 'st-name';
        name.textContent = SOURCE_TEST_LABELS[item.id] || item.id;
        var text = document.createElement('span');
        text.className = 'st-text';
        var detail = sourceDetailText(item);
        text.textContent = sourceStatusText(item) + (detail ? ' · ' + detail : '');
        row.appendChild(name);
        row.appendChild(text);
        box.appendChild(row);
      });
      box.hidden = false;
    }
    $('#sync-test-sources').addEventListener('click', function () {
      var button = this;
      button.disabled = true;
      setSyncInlineStatus('sync-sources-test-status', T('正在测试…'), 'pending');
      renderSourcesTestResult(null);
      desktop.testSources().then(function (payload) {
        var results = (payload && payload.results) || [];
        renderSourcesTestResult(results);
        var failed = results.filter(function (item) { return item.status === 'error'; }).length;
        setSyncInlineStatus('sync-sources-test-status',
          failed ? T('有 {n} 个服务未通过').replace('{n}', String(failed)) : T('测试完成'),
          failed ? 'error' : 'success');
      }).catch(function (error) {
        setSyncInlineStatus('sync-sources-test-status', error && error.message || String(error), 'error');
      }).finally(function () { button.disabled = false; });
    });
    // 「立即同步」（设置 → 云同步）：先取消待执行的自动保存、把当前表单一次性落盘，
    // 再发起一次非静默同步（状态与失败原因要看得见）。页脚不放同步按钮——改动本就即时保存，
    // 页脚再挂一个「保存并同步」会让人以为不点就丢设置。
    $('#sync-run').addEventListener('click', function () {
      cancelSyncAutoSave();
      saveSyncSettings().then(function (config) { return performSync(config, false); })
        .catch(function (error) {
          // 兜底：保存或同步链路上任何未预期的失败都要落到看得见的地方——点击处理没人接这个
          // promise，漏出去就是控制台里一条未捕获的 rejection（界面停在「配置已保存」）
          var message = error && error.message || String(error);
          $('#sync-status').classList.add('error');
          $('#sync-status').textContent = message;
          toast(T('同步失败：') + message);
        });
    });
    $('#sync-detect-zotero').addEventListener('click', function () {
      $('#sync-status').textContent = T('正在检测 Zotero 数据目录…');
      desktop.detectZoteroDataDir().then(function (dir) {
        $('#sync-zotero-dir').value = dir || '';
        $('#sync-status').textContent = dir ? T('已找到：') + dir : T('未找到 Zotero 数据目录');
        if (dir) queueSyncAutoSave();
      }).catch(function (error) {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = error && error.message || String(error);
      });
    });
    $('#sync-choose-zotero').addEventListener('click', function () {
      desktop.chooseZoteroDataDir().then(function (dir) {
        if (dir) { $('#sync-zotero-dir').value = dir; $('#sync-status').textContent = T('已选择：') + dir; queueSyncAutoSave(); }
      }).catch(function () {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = T('所选目录不是有效的 Zotero 数据目录');
      });
    });
    $('#sync-refresh-pdf-index').addEventListener('click', function () {
      refreshPdfIndexStats();
      setSyncInlineStatus('sync-pdf-index-status', T('已刷新'), 'ok');
      setTimeout(function () { setSyncInlineStatus('sync-pdf-index-status', '', ''); }, 1500);
    });
    $('#sync-build-pdf-index').addEventListener('click', function () {
      if (!window.LitPdfSearch || !window.LitPdfSearch.reindex) return;
      var button = $('#sync-build-pdf-index');
      button.disabled = true;
      setSyncInlineStatus('sync-pdf-index-status', T('正在构建全文索引…'), 'pending');
      window.LitPdfSearch.reindex(state.papers, function (progress) {
        setSyncInlineStatus('sync-pdf-index-status', T('正在构建 ') + progress.done + '/' + progress.total + '…', 'pending');
      }).then(function (result) {
        refreshPdfIndexStats();
        if (!result || !result.stale) setSyncInlineStatus('sync-pdf-index-status', T('全文索引已是最新'), 'success');
        else setSyncInlineStatus('sync-pdf-index-status', T('✓ 已构建 ') + result.indexed + T(' 篇全文索引'), 'success');
      }).catch(function (error) {
        refreshPdfIndexStats();
        setSyncInlineStatus('sync-pdf-index-status', T('构建失败：') + (error && error.message || error), 'error');
      }).finally(function () {
        button.disabled = false;
      });
    });
    $('#sync-bridge-copy-token').addEventListener('click', function () {
      if (!bridgeTokenCache) { toast(T('令牌未生成')); return; }
      copyToClipboard(bridgeTokenCache).then(function () { toast(T('✓ 令牌已复制')); });
    });
    $('#sync-clear-pdf-cache').addEventListener('click', function () {
      dlgConfirm(T('删除全文索引'), T('删除 PDF 全文索引？下次全文检索时会重新提取正文（耗时取决于文献数量）。'), T('清除索引'), true).then(function (ok) {
        if (!ok) return;
        desktop.pdfSearchClear().then(function () {
          if (window.LitPdfSearch) window.LitPdfSearch.resetCache();
          refreshPdfIndexStats();
          $('#sync-status').textContent = T('PDF 全文索引已清除');
        }).catch(function (error) {
          $('#sync-status').classList.add('error');
          $('#sync-status').textContent = T('清除索引失败：') + (error && error.message || error);
        });
      });
    });
    /* Zotero 导入向导整体在 js/app/zotero-wizard.js（状态 + 绑定 + 四步流程） */
    initZoteroWizard();
    initJournalRank();
    initQueryBuilder();
    initWordPanel();
    initNoteExport();
    $('#sync-migrate-zotero-cloud').addEventListener('click', function () {
      if (syncBusy) return;
      syncBusy = true;
      $('#sync-migrate-zotero-cloud').disabled = true;
      $('#sync-status').classList.remove('error');
      $('#sync-status').textContent = T('正在读取 Zotero 并从坚果云迁移缺失 PDF…');
      saveSyncSettings().then(function () {
        return desktop.importZoteroLocal();
      }).then(function (snapshot) {
        return mergeZoteroSnapshot({ papers: state.papers, folders: state.folders }, snapshot);
      }).then(function (workspace) {
        return desktop.migrateZoteroCloudAttachments(workspace);
      }).then(function (result) {
        $('#sync-status').textContent = T('已下载 ') + result.downloaded + T(' 个 PDF，正在写入 LitBoard 坚果云目录…');
        return desktop.syncNutstore(result.workspace).then(function (workspace) {
          return { workspace: workspace, stats: result };
        });
      }).then(function (result) {
        return applySyncedWorkspace(result.workspace).then(function () {
          $('#sync-status').textContent = T('迁移完成：下载 ') + result.stats.downloaded + T('，本地已有 ') +
            result.stats.existing + T('，云端缺失 ') + result.stats.missing + T('，失败 ') + result.stats.failed;
          toast(T('Zotero 云附件迁移完成'));
        });
      }).catch(function (error) {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = error && error.message || String(error);
      }).finally(function () {
        syncBusy = false;
        $('#sync-migrate-zotero-cloud').disabled = false;
      });
    });
    $('#folder-create-cancel').addEventListener('click', function () {
      creatingFolderParentId = '';
      $('#folder-create-form').hidden = true;
      $('#folder-create-parent').hidden = true;
      $('#folder-name-input').value = '';
      $('#folder-create-error').textContent = '';
    });
    $('#folder-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        $('#folder-create-cancel').click();
      }
    });
    $('#folder-create-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#folder-name-input').value.trim();
      if (!name) {
        $('#folder-create-error').textContent = T('请输入文件夹名称');
        $('#folder-name-input').focus();
        return;
      }
      if (state.folders.some(function (folder) {
        return (folder.parentId || '') === creatingFolderParentId && folder.name.toLowerCase() === name.toLowerCase();
      })) {
        $('#folder-create-error').textContent = T('已存在同名文件夹');
        $('#folder-name-input').select();
        return;
      }
      var folder = { id: folderUid(), name: name.slice(0, 80), parentId: creatingFolderParentId, sortIndex: folderChildren(creatingFolderParentId).length };
      state.folders.push(folder);
      creatingFolderParentId = '';
      state.activeFolderId = folder.id;
      $('#folder-create-form').hidden = true;
      $('#folder-create-parent').hidden = true;
      $('#folder-name-input').value = '';
      $('#folder-create-error').textContent = '';
      save(); selectFolder(folder.id);
      toast(T('已创建文件夹“') + folder.name + '”');
    });
    $('#library-nav').addEventListener('click', function (e) {
      var item = e.target.closest('[data-folder]');
      if (item) selectFolder(item.dataset.folder, { multi: e.ctrlKey || e.metaKey });
    });
    // 内置视图右键菜单（全部文献/未分类/最近阅读/回收站）；与文件夹树一致，右击先选中该项
    $('#library-nav').addEventListener('contextmenu', function (e) {
      var item = e.target.closest('.library-item[data-folder]');
      if (!item) return;
      e.preventDefault();
      var folderId = item.dataset.folder;
      if (state.activeFolderId !== folderId || state.activeFolderIds.length) selectFolder(folderId);
      showCtxMenu(e.clientX, e.clientY, buildLibraryCtxItems(folderId));
    });
    $('#folder-list').addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-folder]');
      if (toggle) { toggleFolder(toggle.dataset.toggleFolder); return; }
      var addChild = e.target.closest('[data-parent-folder]');
      if (addChild) { openFolderCreator(addChild.dataset.parentFolder); return; }
      var del = e.target.closest('[data-delete-folder]');
      if (del) { deleteFolder(del.dataset.deleteFolder); return; }
      var item = e.target.closest('[data-folder]');
      if (item) { selectFolder(item.dataset.folder, { multi: e.ctrlKey || e.metaKey, range: e.shiftKey });  }
    });
    // 文件夹树键盘导航：↑↓ 移动选中、←→ 折叠/展开（或跳父级/子级）、Enter 选中、F2 重命名、Delete 删除
    $('#folder-list').addEventListener('keydown', function (e) {
      var entries = folderTree();
      if (!entries.length) return;
      var ids = entries.map(function (entry) { return entry.folder.id; });
      var idx = state.folderFocusId ? ids.indexOf(state.folderFocusId) : -1;
      var entry = idx === -1 ? null : entries[idx];
      var handled = true;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var step = e.key === 'ArrowDown' ? 1 : -1;
        var next = idx === -1 ? (step > 0 ? 0 : ids.length - 1)
          : Math.max(0, Math.min(ids.length - 1, idx + step));
        selectFolder(ids[next], { range: e.shiftKey, multi: e.ctrlKey || e.metaKey });
      } else if (e.key === 'ArrowRight') {
        if (entry && entry.hasChildren) {
          if (state.collapsedFolders[entry.folder.id]) toggleFolder(entry.folder.id);
          else if (idx + 1 < ids.length) selectFolder(ids[idx + 1]);
        } else handled = false;
      } else if (e.key === 'ArrowLeft') {
        if (entry) {
          if (entry.hasChildren && !state.collapsedFolders[entry.folder.id]) toggleFolder(entry.folder.id);
          else if (entry.folder.parentId && ids.indexOf(entry.folder.parentId) !== -1) selectFolder(entry.folder.parentId);
          else handled = false;
        } else handled = false;
      } else if (e.key === 'Enter') {
        if (entry) selectFolder(entry.folder.id); else handled = false;
      } else if (e.key === 'F2') {
        if (entry) renameFolder(entry.folder.id); else handled = false;
      } else if (e.key === 'Delete') {
        if (!entry) handled = false;
        else if (state.activeFolderIds.length > 1 && state.activeFolderIds.indexOf(entry.folder.id) !== -1) {
          deleteFolders(state.activeFolderIds.slice());
        } else deleteFolder(entry.folder.id);
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        var focusedRow = $('#folder-list .folder-item.focused');
        if (focusedRow && focusedRow.scrollIntoView) focusedRow.scrollIntoView({ block: 'nearest' });
      }
    });
    // 文件夹右键菜单（Zotero 式：新建/子文件夹/重命名/删除；多选时批量）
    $('#folder-list').addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.folder-item[data-folder]');
      if (row) {
        var folder = state.folders.find(function (f) { return f.id === row.dataset.folder; });
        if (!folder) return;
        e.preventDefault();
        // 右击已在多选集合内的行 → 菜单对整组生效；集合外的行先单选（Zotero 行为）
        var selIds = state.activeFolderIds.length ? state.activeFolderIds.slice() : [state.activeFolderId];
        if (selIds.indexOf(folder.id) === -1) {
          selectFolder(folder.id);
          selIds = [folder.id];
        }
        if (selIds.length > 1) showCtxMenu(e.clientX, e.clientY, buildFolderCtxItemsMulti(selIds));
        else showCtxMenu(e.clientX, e.clientY, buildFolderCtxItems(folder));
      } else {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, [
          { label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } },
          { label: T('导入文件夹…'), icon: 'lb-i-folder-import', fn: function () { chooseFolderImport(''); } }
        ]);
      }
    });
    $('#folder-empty').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, [
        { label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } },
        { label: T('导入文件夹…'), icon: 'lb-i-folder-import', fn: function () { chooseFolderImport(''); } }
      ]);
    });
    // 文件夹拖拽排序（支持多选整组拖）
    var folderDragId = null;          // 拖拽源行（多选拖时为主行）
    var folderDragIds = null;         // 被拖集合（可见树序的 id 数组）
    var folderDragSubtree = null;     // 被拖集合 ∪ 各自子树（防环 + 缺口判定）
    // 当前预览对应的落点（目标行 + 方式），供「在缺口处松手」时取用
    var folderDragHover = null;
    var FOLDER_DRAG_TYPE = 'application/x-litboard-folder';
    // 悬停折叠节点自动展开
    var folderAutoExpandTimer = null;
    var folderAutoExpandId = null;
    function cancelFolderAutoExpand() {
      if (folderAutoExpandTimer) { clearTimeout(folderAutoExpandTimer); folderAutoExpandTimer = null; }
      folderAutoExpandId = null;
    }
    function scheduleFolderAutoExpand(folderId) {
      var folder = state.folders.find(function (f) { return f.id === folderId; });
      var hasKids = !!folder && state.folders.some(function (f) { return f.parentId === folderId; });
      if (!hasKids || !state.collapsedFolders[folderId]) { cancelFolderAutoExpand(); return; }
      if (folderAutoExpandId === folderId) return;
      cancelFolderAutoExpand();
      folderAutoExpandId = folderId;
      folderAutoExpandTimer = setTimeout(function () {
        folderAutoExpandTimer = null; folderAutoExpandId = null;
        if (!folderDragId) return;
        delete state.collapsedFolders[folderId];
        saveCollapsedFolders();
        renderFolders();   // 重建后拖拽继续，行标记/落点随 dragover 重绘
      }, 600);
    }
    $('#folder-list').addEventListener('dragstart', function (e) {
      var row = e.target.closest('.folder-item[data-folder]');
      if (!row || !e.dataTransfer) return;
      if (e.target.closest('.folder-toggle, .folder-delete, .folder-add-child')) {
        e.preventDefault();
        return;
      }
      var dragId = row.dataset.folder;
      // 多选整组拖：被拖行在多选集合内时拖整个集合（applyMove 再清洗后代/防环）
      var ids = state.activeFolderIds.indexOf(dragId) !== -1 ? state.activeFolderIds.slice() : [dragId];
      folderDragId = dragId;
      folderDragIds = ids;
      folderDragSubtree = window.LitFolderTree.collectSubtreeIds(state.folders, ids);
      folderDragHover = null;
      e.dataTransfer.setData(FOLDER_DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
      $all('#folder-list .folder-item[data-folder]').forEach(function (item) {
        if (ids.indexOf(item.dataset.folder) !== -1) item.classList.add('dragging');
      });
      if (ids.length > 1) row.setAttribute('data-drag-count', String(ids.length));
      $('#folder-list').classList.add('folder-reordering');
    });
    $('#folder-list').addEventListener('dragend', function () {
      folderDragId = null;
      folderDragIds = null;
      folderDragSubtree = null;
      folderDragHover = null;
      cancelFolderAutoExpand();
      $('#folder-list').classList.remove('folder-root-drop');
      $('#folder-empty').classList.remove('folder-root-drop');
      $('#library-nav [data-folder="all"]').classList.remove('folder-root-drop');
      clearFolderDropMarks();
      resetFolderOrderPreview();
      $all('#folder-list .folder-item').forEach(function (row) {
        row.classList.remove('dragging');
        row.removeAttribute('data-drag-count');
      });
      // 等回位动画播完再摘掉过渡类；期间若已开始新一次拖拽则保留
      setTimeout(function () {
        if (!folderDragId) $('#folder-list').classList.remove('folder-reordering');
      }, 200);
    });
    $('#folder-list').addEventListener('dragleave', function (e) {
      if (!folderDragId) return;
      // 拖拽期间 relatedTarget 不可靠（常 null），改用坐标判定是否真的离开列表
      var bounds = $('#folder-list').getBoundingClientRect();
      if (e.clientX >= bounds.left && e.clientX <= bounds.right &&
          e.clientY >= bounds.top && e.clientY <= bounds.bottom) return;
      folderDragHover = null;
      cancelFolderAutoExpand();
      $('#folder-list').classList.remove('folder-root-drop');
      clearFolderDropMarks();
      resetFolderOrderPreview();
    });
    $('#folder-list').addEventListener('dragover', function (e) {
      if (!folderDragId) return;
      var list = $('#folder-list');
      var row = e.target.closest('.folder-item[data-folder]');
      if (!row) {
        // 列表空白区 = 移到根级末尾
        clearFolderDropMarks();
        resetFolderOrderPreview();
        cancelFolderAutoExpand();
        list.classList.add('folder-root-drop');
        folderDragHover = { targetId: null, mode: 'rootEnd' };
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        return;
      }
      if (list.classList.contains('folder-root-drop')) list.classList.remove('folder-root-drop');
      clearFolderDropMarks(row);
      if (folderDragSubtree && folderDragSubtree[row.dataset.folder]) {
        // 落在被拖集合（自身行 = 缺口 / 被拖后代 = 防环）上
        if (row.dataset.folder !== folderDragId) { folderDragHover = null; return; }
        // 缺口 = 被拖行当前的视觉位置：允许在缺口上松手，落点取已预览的插入位
        if (folderDragHover) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
        return;
      }
      scheduleFolderAutoExpand(row.dataset.folder);
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var rect = row.getBoundingClientRect();
      var ratio = (e.clientY - rect.top) / rect.height;
      var mode = window.LitFolderTree.dropModeFromRatio(ratio);
      if (mode === 'before') {
        row.classList.add('drag-before');
        if (folderDragIds.length === 1) previewFolderOrder(row, 'before', folderDragIds[0]);
        else resetFolderOrderPreview();
        folderDragHover = { targetId: row.dataset.folder, mode: 'before' };
      } else if (mode === 'after') {
        row.classList.add('drag-after');
        if (folderDragIds.length === 1) previewFolderOrder(row, 'after', folderDragIds[0]);
        else resetFolderOrderPreview();
        folderDragHover = { targetId: row.dataset.folder, mode: 'after' };
      } else {
        row.classList.add('drag-over');
        resetFolderOrderPreview();
        folderDragHover = null;
      }
    });
    /** 文件夹落定的统一收尾：undo 快照（变更前）+ applyMove + 反馈 + 延迟保存。row 为 null 表示根级末尾。 */
    function handleFolderDrop(e, row) {
      var targetId, mode;
      if (!row) {
        targetId = null; mode = 'rootEnd';
      } else {
        targetId = row.dataset.folder;
        if (folderDragSubtree && folderDragSubtree[targetId]) {
          // 缺口（被拖行自身）或防环位置松手：采用已预览的插入位
          if (!folderDragHover) return;
          targetId = folderDragHover.targetId;
          mode = folderDragHover.mode;
        } else {
          var rect = row.getBoundingClientRect();
          var ratio = (e.clientY - rect.top) / rect.height;
          mode = window.LitFolderTree.dropModeFromRatio(ratio);
        }
      }
      var dragIds = folderDragIds || [folderDragId];
      e.preventDefault();
      e.stopPropagation();
      folderDragId = null;
      folderDragIds = null;
      folderDragSubtree = null;
      folderDragHover = null;
      cancelFolderAutoExpand();
      $('#folder-list').classList.remove('folder-root-drop');
      $('#folder-empty').classList.remove('folder-root-drop');
      $('#library-nav [data-folder="all"]').classList.remove('folder-root-drop');
      // undo 快照必须在 applyMove 变更之前抓：被拖集合 + 旧父组 + 新父组都会被重排
      var undoIds = {};
      dragIds.forEach(function (id) { undoIds[id] = true; });
      state.folders.forEach(function (f) {
        if (dragIds.indexOf(f.id) !== -1) return;
        var sharesParentWithDragged = dragIds.some(function (id) {
          var df = state.folders.find(function (x) { return x.id === id; });
          return df && (df.parentId || '') === (f.parentId || '');
        });
        if (sharesParentWithDragged) undoIds[f.id] = true;
      });
      if (targetId) {
        undoIds[targetId] = true;
        var tf = state.folders.find(function (x) { return x.id === targetId; });
        if (tf) {
          var newParentId = mode === 'inside' ? targetId : (tf.parentId || '');
          state.folders.forEach(function (f) { if ((f.parentId || '') === newParentId) undoIds[f.id] = true; });
        }
      } else {
        state.folders.forEach(function (f) { if (!(f.parentId || '')) undoIds[f.id] = true; });
      }
      var undoIdList = Object.keys(undoIds);
      var undoBefore = makeSnapshot({ folders: undoIdList });
      var result = window.LitFolderTree.applyMove(state.folders, dragIds, targetId, mode);
      if (!result.changed) return;
      commitUndo(mode === 'inside' || mode === 'rootEnd' ? T('移动文件夹') : T('调整文件夹顺序'), undoBefore, { folders: undoIdList });
      clearFolderDropMarks();
      renderFolders();
      // 落定反馈：所有被动过的行短暂描边闪光
      $all('#folder-list .folder-item[data-folder]').forEach(function (landed) {
        if (result.touchedIds.indexOf(landed.dataset.folder) === -1) return;
        landed.classList.add('drop-flash');
        setTimeout(function () { landed.classList.remove('drop-flash'); }, 600);
      });
      var firstDragged = state.folders.find(function (f) { return f.id === dragIds[0]; });
      toast(dragIds.length > 1
        ? T('✓ 已移动 ') + dragIds.length + T(' 个文件夹')
        : (mode === 'inside'
          ? T('✓ 已移入「') + (firstDragged ? firstDragged.name : '') + '」'
          : (mode === 'rootEnd' ? T('✓ 已移到根级') : T('✓ 已调整顺序'))));
      // save() 要给全库算两遍内容签名、再把整个工作区序列化过 IPC，
      // 几千条文献就是上百毫秒的同步阻塞——同步调用会卡住松手后的第一帧，
      // 表现为「落定瞬间卡顿一下」。让到新顺序绘制完成后再保存；
      // 窗口被隐藏时 rAF 不触发，用定时器兜底（只执行一次）。
      var saved = false;
      var deferredSave = function () {
        if (saved) return;
        saved = true;
        save();
      };
      requestAnimationFrame(function () { requestAnimationFrame(deferredSave); });
      setTimeout(deferredSave, 200);
    }
    $('#folder-list').addEventListener('drop', function (e) {
      if (!folderDragId) return;
      handleFolderDrop(e, e.target.closest('.folder-item[data-folder]'));
    });
    // 空态（无文件夹时的占位行）同样接受文件夹拖放 = 根级末尾
    [$('#folder-empty'), $('#library-nav [data-folder="all"]')].forEach(function (folderEmptyEl) {
      if (!folderEmptyEl) return;
      folderEmptyEl.addEventListener('dragover', function (e) {
        if (!folderDragId) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        folderDragHover = { targetId: null, mode: 'rootEnd' };
        folderEmptyEl.classList.add('folder-root-drop');
      });
      folderEmptyEl.addEventListener('dragleave', function (e) {
        if (!folderDragId) return;
        var bounds = e.currentTarget.getBoundingClientRect();
        if (e.clientX >= bounds.left && e.clientX <= bounds.right &&
            e.clientY >= bounds.top && e.clientY <= bounds.bottom) return;
        folderEmptyEl.classList.remove('folder-root-drop');
      });
      folderEmptyEl.addEventListener('drop', function (e) {
        if (!folderDragId) return;
        e.preventDefault();
        e.stopPropagation();
        handleFolderDrop(e, null);
      });
    });
    // 导入
    var pendingImportFolderId = '';
    var pendingPasteFolderId = '';
    $('#btn-import').addEventListener('click', function () {
      pendingImportFolderId = currentImportFolderId();
      if (desktop) {
        desktop.chooseImportFiles().then(function (files) {
          promptImportFolder(function (folderId) { handleDesktopFiles(files, folderId); }, pendingImportFolderId);
        }).catch(function (e) {
          toast(T('⚠ 选择文件失败：') + (e && e.message || e));
        });
      } else $('#file-input').click();
    });
    $('#file-input').addEventListener('change', function (e) {
      if (e.target.files.length) {
        var files = Array.prototype.slice.call(e.target.files);
        promptImportFolder(function (folderId) { handleFiles(files, folderId); }, pendingImportFolderId);
      }
      pendingImportFolderId = '';
      e.target.value = '';
    });
    $('#btn-demo').addEventListener('click', loadDemo);
    // M3 首次使用清单：四步引导（可跳过；跳过后空库只显示一行简版提示）
    $('#onboard-import').addEventListener('click', function () { $('#btn-import').click(); });
    $('#onboard-bridge').addEventListener('click', openBridgePanel);
    $('#onboard-skip').addEventListener('click', function () {
      try { localStorage.setItem(ONBOARD_DISMISS_KEY, '1'); } catch (e) {}
      renderTable();
    });

    // 导入目标文件夹选择
    $('#import-folder-ok').addEventListener('click', confirmImportFolder);
    $('#import-folder-cancel').addEventListener('click', cancelImportFolder);
    $('#import-folder-list').addEventListener('change', function (e) {
      if (e.target.name === 'import-folder') chosenImportFolderId = e.target.value;
    });
    $('#import-folder-list').addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-import-folder]');
      if (!toggle) return;
      e.preventDefault();
      e.stopPropagation();
      var folderId = toggle.dataset.toggleImportFolder;
      importFolderCollapsed[folderId] = !isImportFolderCollapsed(folderId);
      renderImportFolderChooser(chosenImportFolderId);
    });

    $('#import-folder-filter').addEventListener('input', function () {
      renderImportFolderChooser(chosenImportFolderId);
    });
    $('#import-folder-filter').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmImportFolder(); }
    });

    // 粘贴 BibTeX
    $('#btn-paste').addEventListener('click', function () {
      pendingPasteFolderId = currentImportFolderId();
      $('#paste-mask').hidden = false;
      $('#paste-area').focus();
    });
    // 菜单按当前单选文件夹导入；右键菜单可指定具体落点。
    $('#more-import-folder').addEventListener('click', function () {
      chooseFolderImport(currentImportFolderId());
    });
    $('#more-stop-folder-import').addEventListener('click', function () {
      folderImportCancelled = true;
      toast(T('正在停止导入，已处理的文件会保留'));
    });
    $('#paste-cancel').addEventListener('click', function () { $('#paste-mask').hidden = true; });
    $('#paste-ok').addEventListener('click', function () {
      var text = $('#paste-area').value.trim();
      $('#paste-mask').hidden = true;
      $('#paste-area').value = '';
      if (text) promptImportFolder(function (folderId) { importBibText(text, folderId); }, pendingPasteFolderId);
      pendingPasteFolderId = '';
    });

    // 外部文件只接受明确的目标：文献行添附件，文件夹树导入目录/文档。
    var fileDropTr = null;
    function dragHasFiles(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return !!(types && Array.prototype.indexOf.call(types, 'Files') !== -1);
    }
    function setFileDropTr(tr) {
      if (fileDropTr === tr) return;
      if (fileDropTr) fileDropTr.classList.remove('file-drop-target');
      fileDropTr = tr || null;
      if (fileDropTr) fileDropTr.classList.add('file-drop-target');
    }
    document.addEventListener('dragleave', function (e) {
      if (!dragHasFiles(e)) return;
      if (!fileDropTr || fileDropTr.contains(e.relatedTarget)) return;
      setFileDropTr(null);
    });
    document.addEventListener('dragover', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      var tr = (!desktop || !e.target.closest) ? null : e.target.closest('#table-body tr[data-id]');
      var paper = tr ? getById(tr.dataset.id) : null;
      if (paper && paper.deletedAt) { tr = null; paper = null; }
      setFileDropTr(tr);
      if (tr) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    document.addEventListener('drop', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      var tr = e.target.closest ? e.target.closest('#table-body tr[data-id]') : null;
      setFileDropTr(null);
      var paper = tr ? getById(tr.dataset.id) : null;
      if (paper && !paper.deletedAt && e.dataTransfer.files.length) {
        var clearBusy = toast(T('正在处理拖入的文件…'), 0);
        attachDroppedFiles(paper, Array.prototype.slice.call(e.dataTransfer.files)).catch(function (error) {
          toast('⚠ ' + (error && error.message || error));
        }).finally(clearBusy);
      } else {
        var clearImportBusy = toast(T('正在处理拖入的文件…'), 0);
        importExternalDrop(e, currentImportFolderId()).catch(function (error) {
          toast('⚠ ' + (error && error.message || error));
        }).finally(clearImportBusy);
      }
    });

    // OS 文件夹拖入左侧栏：悬停文件夹行 = 导入到该文件夹内部；列表空白/空态 = 根级导入
    //（拖入的文件夹本身建为对应位置的 LitBoard 文件夹，目录树走 folders 实体，见 importDroppedFolder）。
    // 与内部拖动（文件夹排序 folderDragId / 条目归类 dragPayloadIds）互不干扰；stopPropagation
    // 截停本区域的 OS 文件拖放，防止 document 级落区把同一 drop 再处理一遍。
    var sidebarFileRow = null;
    function clearSidebarFileDrop() {
      if (sidebarFileRow) { sidebarFileRow.classList.remove('folder-file-drop'); sidebarFileRow = null; }
      $('#folder-list').classList.remove('folder-file-drop');
      $('#folder-empty').classList.remove('folder-file-drop');
      $('#library-nav [data-folder="all"]').classList.remove('folder-file-drop');
    }
    function sidebarFileDragOver(e) {
      if (folderDragId || dragPayloadIds) return;
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      var row = e.target.closest ? e.target.closest('.folder-item[data-folder]') : null;
      if (sidebarFileRow !== row) {
        if (sidebarFileRow) sidebarFileRow.classList.remove('folder-file-drop');
        sidebarFileRow = row || null;
        if (sidebarFileRow) sidebarFileRow.classList.add('folder-file-drop');
      }
      var inList = !row && !!(e.target.closest && e.target.closest('#folder-list'));
      var inEmpty = !row && !!(e.target.closest && e.target.closest('#folder-empty'));
      var inRoot = !row && !!(e.target.closest && e.target.closest('#library-nav [data-folder="all"]'));
      $('#folder-list').classList.toggle('folder-file-drop', inList);
      $('#folder-empty').classList.toggle('folder-file-drop', inEmpty);
      $('#library-nav [data-folder="all"]').classList.toggle('folder-file-drop', inRoot);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
    function sidebarFileDragLeave(e) {
      if (!dragHasFiles(e)) return;
      // 拖拽期间 relatedTarget 不可靠（常 null），改用坐标判定是否真的离开该元素
      var bounds = e.currentTarget.getBoundingClientRect();
      if (e.clientX >= bounds.left && e.clientX <= bounds.right &&
          e.clientY >= bounds.top && e.clientY <= bounds.bottom) return;
      clearSidebarFileDrop();
    }
    async function pathFromDroppedDirectory(rootEntry) {
      var queue = [rootEntry], visited = 0;
      while (queue.length && visited++ < 5000) {
        var entry = queue.shift();
        if (entry.isFile && entry.file) {
          var file = await new Promise(function (resolve) { entry.file(resolve, function () { resolve(null); }); });
          var filePath = '';
          try { if (file) filePath = desktop.getPathForFile(file) || ''; } catch (error) { filePath = ''; }
          var rootRel = String(rootEntry.fullPath || '');
          var leafRel = String(entry.fullPath || '');
          if (filePath && rootRel && leafRel.indexOf(rootRel + '/') === 0) {
            var segments = leafRel.slice(rootRel.length + 1).split('/');
            var rootPath = filePath;
            segments.forEach(function () { rootPath = rootPath.replace(/[\\/][^\\/]+$/, ''); });
            return rootPath;
          }
        } else if (entry.isDirectory && entry.createReader) {
          var reader = entry.createReader();
          while (visited + queue.length < 5000) {
            var children = await new Promise(function (resolve) {
              reader.readEntries(resolve, function () { resolve([]); });
            });
            if (!children.length) break;
            queue.push.apply(queue, children);
          }
        }
      }
      return '';
    }
    async function importExternalDrop(e, targetFolderId) {
      if (!desktop || !desktop.getPathForFile || !desktop.scanFolder) {
        toast(T('导入文件夹需要桌面版'));
        return;
      }
      if (folderImportBusy) { toast(T('已有文件夹正在导入，请稍后再试')); return; }
      folderImportCancelled = false;
      // 同一 drop 中的多个根目录只处理一次；目录的 File 可能位于 dataTransfer.files 而非 getAsFile()。
      var dirPaths = [], looseFiles = [], directoryEntries = [], unresolvable = 0;
      var transferredFiles = Array.prototype.slice.call(e.dataTransfer.files || []);
      var items = Array.prototype.slice.call(e.dataTransfer.items || []);
      items.forEach(function (item, index) {
        if (!item || item.kind !== 'file') return;
        var entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        var file = (item.getAsFile && item.getAsFile()) ||
          transferredFiles.find(function (candidate) { return entry && candidate.name === entry.name; }) ||
          (!entry && transferredFiles[index]);
        if (!file) {
          if (entry && entry.isDirectory) directoryEntries.push(entry);
          else unresolvable++;
          return;
        }
        var path = '';
        try { path = desktop.getPathForFile(file) || ''; } catch (error) { path = ''; }
        if (!path) {
          if (entry && entry.isDirectory) directoryEntries.push(entry);
          else unresolvable++;
          return;
        }
        if (entry && entry.isDirectory) dirPaths.push(path);
        else looseFiles.push({ name: file.name, path: path, size: file.size });
      });
      if (!items.length) transferredFiles.forEach(function (file) {
        var path = '';
        try { path = desktop.getPathForFile(file) || ''; } catch (error) { path = ''; }
        if (path) looseFiles.push({ name: file.name, path: path, size: file.size });
        else unresolvable++;
      });
      for (var j = 0; j < directoryEntries.length; j++) {
        var resolved = await pathFromDroppedDirectory(directoryEntries[j]);
        if (resolved) dirPaths.push(resolved);
        else unresolvable++;
      }
      if (!dirPaths.length && !looseFiles.length) {
        toast(unresolvable ? T('无法读取拖入项的路径，请改用「更多 → 导入文件夹…」')
          : T('无法读取拖入项'));
        return;
      }
      var chain = Promise.resolve();
      window.LitFolderImport.collapseRootPaths(dirPaths).forEach(function (path) {
        chain = chain.then(function () {
          if (!folderImportCancelled) return importDroppedFolder(path, targetFolderId);
        });
      });
      if (looseFiles.length) chain = chain.then(function () {
        if (!folderImportCancelled) return importLooseDocuments(looseFiles, targetFolderId);
      });
      return chain;
    }
    function sidebarFileDrop(e) {
      if (folderDragId || dragPayloadIds || !dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      var row = e.target.closest ? e.target.closest('.folder-item[data-folder]') : null;
      clearSidebarFileDrop();
      var clearBusy = toast(T('正在处理拖入的文件…'), 0);
      importExternalDrop(e, row ? row.dataset.folder : '').catch(function (error) {
        toast('⚠ ' + (error && error.message || error));
      }).finally(clearBusy);
    }
    ['#folder-list', '#folder-empty', '#library-nav [data-folder="all"]'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      el.addEventListener('dragover', sidebarFileDragOver);
      el.addEventListener('dragleave', sidebarFileDragLeave);
      el.addEventListener('drop', sidebarFileDrop);
    });

    // 拖动表格行到左侧文件夹归类
    var dragPayloadIds = null;
    var dragSourceFolderId = '';
    var DRAG_TYPE = 'application/x-litboard-papers';
    $('#table-body').addEventListener('dragstart', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (!tr || !e.dataTransfer) return;
      var id = tr.dataset.id;
      var ids = state.selected[id] ? selectedIds() : [id];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copyMove';
      dragPayloadIds = ids;
      var sourceFolder = currentFolderLinkTarget();
      dragSourceFolderId = sourceFolder ? sourceFolder.id : '';
      tr.classList.add('dragging');
    });
    $('#table-body').addEventListener('dragend', function () {
      dragPayloadIds = null;
      dragSourceFolderId = '';
      $all('.lit-table tr.dragging').forEach(function (tr) { tr.classList.remove('dragging'); });
      $all('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
    });
    document.addEventListener('dragenter', function (e) {
      var target = e.target.closest('#folder-list [data-folder]') || e.target.closest('#library-nav [data-folder="unfiled"]');
      if (!target || !dragPayloadIds) return;
      e.preventDefault();
      target.classList.add('drag-over');
    });
    document.addEventListener('dragover', function (e) {
      var target = e.target.closest('#folder-list [data-folder]') || e.target.closest('#library-nav [data-folder="unfiled"]');
      if (!target || !dragPayloadIds) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.shiftKey && dragSourceFolderId ? 'move' : 'copy';
      $all('.drag-over').forEach(function (el) { if (el !== target) el.classList.remove('drag-over'); });
      target.classList.add('drag-over');
    });
    document.addEventListener('drop', function (e) {
      var target = e.target.closest('#folder-list [data-folder]') || e.target.closest('#library-nav [data-folder="unfiled"]');
      if (!target) return;
      e.preventDefault();
      var ids = dragPayloadIds;
      if (!ids && e.dataTransfer) {
        try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch (err) { ids = null; }
      }
      $all('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
      dragPayloadIds = null;
      if (!ids || !ids.length) return;
      var papers = ids.map(getById).filter(Boolean);
      if (!papers.length) return;
      var sourceFolderId = dragSourceFolderId;
      dragSourceFolderId = '';
      if (target.dataset.folder === 'unfiled') {
        papers.forEach(function (paper) { paper.folderIds = []; });
        save(); renderAll();
        toast(T('✓ 已移出 ') + papers.length + T(' 篇的文件夹'));
        return;
      }
      var folder = state.folders.find(function (item) { return item.id === target.dataset.folder; });
      if (!folder) return;
      var moving = e.shiftKey && sourceFolderId && sourceFolderId !== folder.id;
      var changedPapers = papers.filter(function (paper) {
        return (paper.folderIds || []).indexOf(folder.id) === -1 ||
          moving && (paper.folderIds || []).indexOf(sourceFolderId) !== -1;
      });
      if (!changedPapers.length) return;
      var undoIds = changedPapers.map(function (paper) { return paper.id; });
      var undoBefore = makeSnapshot({ papers: undoIds });
      papers.forEach(function (paper) {
        if ((paper.folderIds || []).indexOf(folder.id) === -1) paper.folderIds.push(folder.id);
        if (moving) paper.folderIds = paper.folderIds.filter(function (id) { return id !== sourceFolderId; });
        window.LitModel.touch(paper);
      });
      commitUndo(moving ? T('移动文献') : T('加入文件夹'), undoBefore, { papers: undoIds });
      save(); renderAll();
      toast(moving ? T('✓ 已将 ') + papers.length + T(' 篇移至「') + folder.name + '」'
        : T('✓ 已将 ') + papers.length + T(' 篇加入「') + folder.name + '」');
    });

    // 补全 / 导出菜单
    $('#btn-enrich').addEventListener('click', enrichAll);
    $('#btn-enrich-stop').addEventListener('click', abortEnrich);
    registerTopbarMenu($('#btn-export'), $('#export-menu'));
    $('#btn-export').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleTopbarMenu($('#export-menu'));
    });
    document.addEventListener('click', function () { $('#export-menu').hidden = true; });
    $('#btn-export-json').addEventListener('click', exportJson);
    $('#btn-export-csv').addEventListener('click', exportCsv);
    $('#btn-export-bib').addEventListener('click', exportBib);
    $('#btn-export-ris').addEventListener('click', exportRis);
    $('#btn-export-csljson').addEventListener('click', exportCslJson);
    $('#btn-export-docx').addEventListener('click', exportDocx);

    // 快速添加
    $('#btn-add').addEventListener('click', function () {
      $('#add-mask').hidden = false;
      $('#add-status').textContent = T('支持 DOI、arXiv 编号或文献标题；联网获取后可再编辑。');
      $('#add-id').focus();
    });
    $('#add-cancel').addEventListener('click', function () { $('#add-mask').hidden = true; });
    $('#add-fetch').addEventListener('click', function () { quickAdd($('#add-id').value); });
    $('#add-id').addEventListener('keydown', function (e) { if (e.key === 'Enter') quickAdd(this.value); });
    $('#add-manual').addEventListener('click', function () { $('#add-mask').hidden = true; openEditModal(null); });

    // 标签管理
    var sidebarTags = $('#sidebar-tag-panel');
    var tagCollapseButton = $('#btn-tag-collapse');
    var tagResizeGrip = $('#tag-list-resize');
    var tagListHeight = 112;
    try { tagListHeight = Number(localStorage.getItem(TAG_LIST_HEIGHT_KEY)) || 112; } catch (error) {}
    function setTagListHeight(value, persist) {
      tagListHeight = clamp(Math.round(value), 56, 180);
      sidebarTags.style.setProperty('--tag-panel-height', tagListHeight + 'px');
      tagResizeGrip.setAttribute('aria-valuenow', String(tagListHeight));
      if (persist) {
        try { localStorage.setItem(TAG_LIST_HEIGHT_KEY, String(tagListHeight)); } catch (error) {}
      }
    }
    setTagListHeight(tagListHeight, false);
    var tagResizeStartY = 0, tagResizeStartHeight = 0;
    tagResizeGrip.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      tagResizeStartY = event.clientY;
      tagResizeStartHeight = tagListHeight;
      tagResizeGrip.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-tags');
    });
    tagResizeGrip.addEventListener('pointermove', function (event) {
      if (!tagResizeGrip.hasPointerCapture(event.pointerId)) return;
      setTagListHeight(tagResizeStartHeight - (event.clientY - tagResizeStartY), false);
    });
    function finishTagResize(event) {
      if (!tagResizeGrip.hasPointerCapture(event.pointerId)) return;
      tagResizeGrip.releasePointerCapture(event.pointerId);
      document.body.classList.remove('resizing-tags');
      setTagListHeight(tagListHeight, true);
    }
    tagResizeGrip.addEventListener('pointerup', finishTagResize);
    tagResizeGrip.addEventListener('pointercancel', finishTagResize);
    tagResizeGrip.addEventListener('lostpointercapture', function () {
      document.body.classList.remove('resizing-tags');
    });
    tagResizeGrip.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      setTagListHeight(tagListHeight + (event.key === 'ArrowUp' ? 12 : -12), true);
    });
    var tagsCollapsed = false;
    try { tagsCollapsed = localStorage.getItem(TAG_LIST_COLLAPSED_KEY) === '1'; } catch (error) {}
    function setTagsCollapsed(collapsed, persist) {
      sidebarTags.classList.toggle('tag-list-collapsed', collapsed);
      tagCollapseButton.setAttribute('aria-expanded', String(!collapsed));
      if (persist) {
        try { localStorage.setItem(TAG_LIST_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (error) {}
      }
    }
    setTagsCollapsed(tagsCollapsed, false);
    tagCollapseButton.addEventListener('click', function () {
      setTagsCollapsed(!sidebarTags.classList.contains('tag-list-collapsed'), true);
    });
    $('#btn-manage-tags').addEventListener('click', function () {
      renderTagManageList();
      $('#tags-mask').hidden = false;
    });
    $('#tags-close').addEventListener('click', function () { $('#tags-mask').hidden = true; });
    $('#tags-merge-selected').addEventListener('click', function () {
      var selected = $all('#tag-manage-list [data-tag-select]:checked').map(function (box) {
        return box.dataset.tagSelect;
      });
      if (selected.length < 2) { toast(T('勾选至少两个标签')); return; }
      dlgPrompt(T('合并标签'), T('把选中的 ') + selected.length + T(' 个标签统一为：'), '', selected[0]).then(function (target) {
        if (target == null || !target.trim()) return;
        var changed = 0;
        selected.forEach(function (name) {
          if (name !== target.trim()) changed += renameTagEverywhere(name, target.trim());
        });
        save(); renderAll(); renderTagManageList();
        toast(T('✓ 已合并标签，影响 ') + changed + T(' 篇'));
      });
    });
    $('#tag-manage-list').addEventListener('click', function (e) {
      var colorBtn = e.target.closest('[data-tag-color]');
      if (colorBtn) {
        var tag = colorBtn.dataset.tagColor;
        var current = state.tagColors[tag] || '';
        var nextColor = TAG_PALETTE[(TAG_PALETTE.indexOf(current) + 1) % (TAG_PALETTE.length + 1)] || '';
        setTagColor(tag, nextColor);
        save(); renderAll(); renderTagManageList();
        return;
      }
      var renameBtn = e.target.closest('[data-tag-rename]');
      if (renameBtn) {
        var oldName = renameBtn.dataset.tagRename;
        dlgPrompt(T('重命名标签'), T('将标签「') + oldName + T('」重命名为：'), '', oldName).then(function (newName) {
          if (newName == null || !newName.trim() || newName.trim() === oldName) return;
          var n = renameTagEverywhere(oldName, newName.trim());
          save(); renderAll(); renderTagManageList();
          toast(T('✓ 已重命名，影响 ') + n + T(' 篇'));
        });
        return;
      }
      var deleteBtn = e.target.closest('[data-tag-delete]');
      if (deleteBtn) {
        var name = deleteBtn.dataset.tagDelete;
        dlgConfirm(T('移除标签'), T('从所有文献移除标签「') + name + T('」？（不会删除文献）'), T('移除'), true).then(function (ok) {
          if (!ok) return;
          var removed = deleteTagEverywhere(name);
          save(); renderAll(); renderTagManageList();
          toast(T('✓ 已移除标签，影响 ') + removed + T(' 篇'));
        });
      }
    });

    // 新建 / 编辑
    $('#edit-cancel').addEventListener('click', function () { $('#edit-mask').hidden = true; });
    $('#edit-save').addEventListener('click', saveEditModal);

    // 引用
    $('#cite-close').addEventListener('click', function () { $('#cite-mask').hidden = true; });
    $('#cite-csl-style').addEventListener('change', function (e) {
      try { localStorage.setItem('litboard.cslStyle', e.target.value); } catch (err) {}
      renderCslCitation(e.target.value);
    });
    $('#cite-csl-more').addEventListener('click', function () {
      if (!desktop || !desktop.fetchCslStyle) { toast(T('在线样式库需要桌面版')); return; }
      dlgPrompt(T('在线获取 CSL 样式'), T('输入样式 ID（如 elsevier-harvard、springer-lecture-notes；可到 zotero.org/styles 查询）：'), 'elsevier-harvard').then(function (id) {
        if (!id || !id.trim()) return;
        desktop.fetchCslStyle(id.trim()).then(function (xml) {
          renderCslCitation(xml);
          toast(T('✓ 已加载样式 ') + id.trim());
        }).catch(function (error) {
          toast(T('⚠ 样式获取失败：') + (error && error.message || error));
        });
      });
    });
    $('#cite-csl-copy').addEventListener('click', function () {
      var text = stripHtml($('#cite-csl-output').innerHTML).trim();
      if (!text) return;
      copyToClipboard(text).then(function () { toast(T('✓ 已复制 CSL 引用')); });
    });

    // 快捷键帮助与自定义
    $('#btn-shortcuts').addEventListener('click', function () { renderShortcutSettings(); $('#shortcuts-mask').hidden = false; });
    $('#shortcuts-close').addEventListener('click', function () { $('#shortcuts-mask').hidden = true; });
    $all('[data-shortcut]').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var value = shortcutFromEvent(e);
        if (!value) return;
        if (value.indexOf('+') === -1 && ['escape', '/', 'j', 'k', 'enter', 'x', 's', 'n', 'e', '?'].indexOf(value) !== -1) {
          toast(T('该按键已用于内置快捷操作'));
          return;
        }
        var name = input.dataset.shortcut;
        var other = name === 'pdfOnly' ? 'bibkey' : 'pdfOnly';
        if (state.shortcuts[other] === value) { toast(T('该快捷键已被特殊检索占用')); return; }
        state.shortcuts[name] = value;
        localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(state.shortcuts));
        renderShortcutSettings();
      });
    });

    // bibkey 检索
    $('#bibkey-search-cancel').addEventListener('click', function () { $('#bibkey-search-mask').hidden = true; });
    $('#bibkey-search-ok').addEventListener('click', searchByBibkeys);
    $('#bibkey-search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); searchByBibkeys(); }
    });

    // 库内查重与合并
    $('#btn-dedupe').addEventListener('click', function () {
      $('#dedupe-mask').hidden = false;
      renderDedupeModal();
    });
    // 作者合并
    $('#btn-authors').addEventListener('click', function () {
      $('#authors-mask').hidden = false;
      renderAuthorsModal();
    });
    $('#authors-close').addEventListener('click', function () { $('#authors-mask').hidden = true; });
    $('#authors-merge-selected').addEventListener('click', mergeSelectedAuthors);

    // 同步状态 / 冲突报告
    $('#sync-indicator').addEventListener('click', function () { openSyncSettings(); });
    $('#dedupe-close').addEventListener('click', function () { $('#dedupe-mask').hidden = true; });
    $('#dedupe-merge-all').addEventListener('click', function () {
      var groups = window.LitDedupe.findGroups(state.papers.filter(function (p) { return !p.deletedAt; }));
      if (!groups.length) return;
      var total = groups.reduce(function (s, g) { return s + g.length; }, 0);
      dlgConfirm(T('合并全部重复组'), T('合并全部 ') + groups.length + T(' 组（共 ') + total + T(' 篇 → ') + groups.length + T(' 篇）？标签、笔记与空缺字段会并入保留条目。'), T('合并全部'), true).then(function (ok) {
        if (!ok) return;
        groups.forEach(mergeGroupIntoState);
        save(); renderAll();
        toast(T('✓ 已合并 ') + groups.length + T(' 组重复'));
        renderDedupeModal();
      });
    });

    // PDF 阅读器
    $('#pdf-close').addEventListener('click', closePdfViewer);
    $('#pdf-zoom-in').addEventListener('click', function () { zoomPdf(0.2); });
    $('#pdf-zoom-out').addEventListener('click', function () { zoomPdf(-0.2); });
    $('#pdf-fit-width').addEventListener('click', fitPdfWidth);
    $('#pdf-rotate').addEventListener('click', rotatePdf);
    $('#pdf-layout-toggle').addEventListener('click', togglePdfLayout);
    $('#rail-translation').addEventListener('click', function () { openSyncSettings('translation'); });
    $('#pdf-page-prev').addEventListener('click', function () { goToPdfPage(pdfState.currentPage - 1); });
    $('#pdf-page-next').addEventListener('click', function () { goToPdfPage(pdfState.currentPage + 1); });
    $('#pdf-page-number').addEventListener('change', function (e) { goToPdfPage(e.target.value); });
    $('#pdf-search').addEventListener('input', runPdfSearch);
    $('#pdf-search').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runPdfSearch.flush(); goToPdfSearchResult(e.shiftKey ? -1 : 1); }
    });
    bindPdfSearchOption('#pdf-search-case', 'litboard.pdfSearchCase');
    bindPdfSearchOption('#pdf-search-word', 'litboard.pdfSearchWord');
    $('#pdf-search-prev').addEventListener('click', function () { goToPdfSearchResult(-1); });
    $('#pdf-search-next').addEventListener('click', function () { goToPdfSearchResult(1); });
    $('#pdf-search-toggle').addEventListener('click', function () { pdfSearchPanelOpen(); });
    $('#pdf-annotation-colors').addEventListener('click', function (e) {
      var color = e.target.closest('[data-annotation-color]');
      if (!color) return;
      pdfState.annotationColor = color.dataset.annotationColor;
      $all('#pdf-annotation-colors .pdf-color').forEach(function (button) { button.classList.toggle('active', button === color); });
    });
    $('#pdf-add-highlight').addEventListener('click', function () { createPdfAnnotation('highlight'); });
    $('#pdf-add-underline').addEventListener('click', function () { createPdfAnnotation('underline'); });
    $('#pdf-add-note').addEventListener('click', function () {
      $('#pdf-note-composer').hidden = false;
      $('#pdf-note-text').focus();
    });
    $('#pdf-note-cancel').addEventListener('click', function () { $('#pdf-note-composer').hidden = true; });
    $('#pdf-note-save').addEventListener('click', function () { createPdfAnnotation('note', $('#pdf-note-text').value.trim()); });
    $('#pdf-translate-selection').addEventListener('click', translatePdfSelection);
    $('#pdf-auto-translate').addEventListener('change', function () { setTranslatorAutoTranslate(this.checked, true); });
    $('#pdf-translation-close').addEventListener('click', hidePdfTranslation);
    new ResizeObserver(positionPdfTranslation).observe($('#pdf-translation-popover'));
    $('#pdf-scroll').addEventListener('mouseup', function () { setTimeout(showPdfTranslationSelection, 0); });
    $('#pdf-scroll').addEventListener('keyup', function () { setTimeout(showPdfTranslationSelection, 0); });
    document.addEventListener('selectionchange', function () {
      if ($('#pdf-overlay').hidden || !pdfState.handle || !pdfState.handle.selectionToData) return;
      if (pdfSelectionFrame) cancelAnimationFrame(pdfSelectionFrame);
      pdfSelectionFrame = requestAnimationFrame(function () {
        pdfSelectionFrame = 0;
        var selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) {
          pdfState.handle.clearSelection();
          return;
        }
        var range = selection.getRangeAt(0);
        var ancestor = range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        if (ancestor && $('#pdf-scroll').contains(ancestor)) pdfState.handle.selectionToData(range);
      });
    });
    $('#pdf-scroll').addEventListener('wheel', function (e) {
      if (e.ctrlKey) {
        e.preventDefault();
        applyPdfWheelZoom(e.deltaY < 0 ? 1 : -1);
      } else if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        this.scrollLeft += e.deltaY;
      }
    }, { passive: false });
    $('#pdf-scroll').addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, textarea')) return;
      var selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      var sheet = e.target.closest('.pdf-page-sheet');
      if (!sheet) return;
      var marks = sheet.querySelectorAll('.pdf-annotation-mark:not(.pdf-annotation-ink)');
      for (var i = marks.length - 1; i >= 0; i--) {
        var rect = marks[i].getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          revealPdfAnnotation(marks[i].dataset.annotationId);
          return;
        }
      }
    });
    $('#pdf-annotation-list').addEventListener('click', function (e) {
      var removeButton = e.target.closest('[data-delete-annotation]');
      if (removeButton) {
        var id = removeButton.dataset.deleteAnnotation;
        var annotations = pdfState.paper && pdfState.paper.pdfAnnotations || [];
        var index = annotations.findIndex(function (item) { return item.id === id; });
        if (index === -1) return;
        var removed = annotations[index];
        var undoBefore = makeSnapshot({ papers: [pdfState.paper.id] });
        annotations.splice(index, 1);
        syncViewerAnnotations();
        commitUndo(T('删除批注'), undoBefore, { papers: [pdfState.paper.id] });
        save(); scheduleAutoWriteBack(); renderPdfAnnotations();
        toast(T('已删除批注（笔记中的摘录不受影响）'), 5000, { label: T('撤销'), fn: function () {
          if (!pdfState.paper) return;
          pdfState.paper.pdfAnnotations.splice(Math.min(index, pdfState.paper.pdfAnnotations.length), 0, removed);
          pdfState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(pdfState.paper.pdfAnnotations);
          syncViewerAnnotations();
          save(); renderPdfAnnotations(removed.id);
        } });
        return;
      }
      // 阶段三：单条批注 → 摘录加入当前目标笔记
      var toNoteButton = e.target.closest('[data-annotation-to-note]');
      if (toNoteButton) {
        if (!pdfState.paper) return;
        var annId = toNoteButton.dataset.annotationToNote;
        var source = pdfState.paper.pdfAnnotations.find(function (item) { return item.id === annId; });
        if (!source) return;
        var note = currentPdfNote() || createNote(pdfState.paper.id, '');
        var added = addAnnotationsToNote(note, [source], pdfState.paper);
        if (added) {
          if (pdfNotePanel) pdfNotePanel.setCurrentId(note.id);
          renderPdfNoteEditor();
          toast(T('✓ 已加入「') + (note.title || T('笔记')) + T('」（可在预览中点 ↩ 定位）'));
        }
        return;
      }
      // 阶段三：批注标签 chips（点击移除）
      var tagChip = e.target.closest('[data-annotation-tag-remove]');
      if (tagChip) {
        if (!pdfState.paper) return;
        var tagAnn = pdfState.paper.pdfAnnotations.find(function (item) { return item.id === tagChip.dataset.annotationTagRemove; });
        if (!tagAnn) return;
        var undoBeforeTag = makeSnapshot({ papers: [pdfState.paper.id] });
        tagAnn.tags = (tagAnn.tags || []).filter(function (tag) { return tag !== tagChip.dataset.tag; });
        tagAnn.updatedAt = Date.now();
        pdfState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(pdfState.paper.pdfAnnotations);
        syncViewerAnnotations();
        commitUndo(T('批注移除标签'), undoBeforeTag, { papers: [pdfState.paper.id] });
        save(); renderPdfAnnotations(tagAnn.id);
        return;
      }
      if (e.target.closest('textarea') || e.target.closest('input')) return;
      var item = e.target.closest('[data-annotation-id]');
      if (item) focusPdfAnnotation(item.dataset.annotationId);
    });
    // 阶段三：批注标签输入（回车添加）
    $('#pdf-annotation-list').addEventListener('keydown', function (e) {
      var input = e.target.closest('[data-annotation-tag-input]');
      if (!input || e.key !== 'Enter') return;
      e.preventDefault();
      if (!pdfState.paper) return;
      var tagAnn = pdfState.paper.pdfAnnotations.find(function (item) { return item.id === input.dataset.annotationTagInput; });
      var tag = input.value.trim();
      if (!tagAnn || !tag) return;
      var undoBefore = makeSnapshot({ papers: [pdfState.paper.id] });
      tagAnn.tags = (tagAnn.tags || []).concat([tag]);
      tagAnn.updatedAt = Date.now();
      pdfState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(pdfState.paper.pdfAnnotations);
      syncViewerAnnotations();
      commitUndo(T('批注加标签'), undoBefore, { papers: [pdfState.paper.id] });
      save(); renderPdfAnnotations(tagAnn.id);
    });
    // 阶段三：批注 → 笔记入口
    $('#pdf-annotations-to-note').addEventListener('click', function () {
      if (pdfState.paper) openExcerptDialog(pdfState.paper);
    });
    $('#pdf-annotations-all-note').addEventListener('click', function () {
      if (!pdfState.paper) return;
      var annotations = annotationsForAttachment(pdfState.paper, pdfState.attachment);
      if (!annotations.length) { toast(T('本篇还没有批注')); return; }
      var note = createNote(pdfState.paper.id, '《' + pdfState.paper.title + T('》批注笔记'));
      var n = addAnnotationsToNote(note, annotations.slice(), pdfState.paper);
      if (pdfNotePanel) pdfNotePanel.setCurrentId(note.id);
      renderPdfNoteEditor();
      toast(T('✓ 已生成批注笔记（') + n + T(' 条摘录）'));
    });
    $('#excerpt-cancel').addEventListener('click', function () { $('#excerpt-mask').hidden = true; excerptDlg = null; });
    $('#excerpt-confirm').addEventListener('click', confirmExcerptDialog);
    $('#excerpt-tag-filter').addEventListener('change', function (e) {
      if (!excerptDlg) return;
      excerptDlg.tagFilter = e.target.value;
      renderExcerptDialog();
    });
    $('#excerpt-target-new').addEventListener('click', function () {
      if (!excerptDlg) return;
      var paper = excerptDlg.paper;
      dlgPrompt(T('新建笔记'), T('标题；留空则创建跨文献主题笔记'), '').then(function (title) {
        if (title == null) return;
        var note = createNote(title.trim() ? paper.id : '', title.trim());
        save(); renderExcerptDialog();
        $('#excerpt-target').value = note.id;
      });
    });
    $('#pdf-annotation-list').addEventListener('input', function (e) {
      var input = e.target.closest('[data-annotation-comment]');
      if (!input || !pdfState.paper) return;
      var annotation = pdfState.paper.pdfAnnotations.find(function (item) { return item.id === input.dataset.annotationComment; });
      if (!annotation) return;
      annotation.comment = input.value;
      annotation.updatedAt = Date.now();
      savePdfAnnotationComment();
    });
    // 阶段三：litboard:// 出处定位（笔记预览/正文内的摘录锚）
    document.addEventListener('click', handleLitboardClick);
    if (desktop && desktop.onOpenTarget) {
      desktop.onOpenTarget(function (target) { openPdfAt(target); });
    }
    $('#pdf-external').addEventListener('click', function () {
      if (pdfState.paper && desktop) desktop.openPath(pdfState.paper.pdfPath);
    });
    try {
      var savedPdfSideWidth = Number(localStorage.getItem(PDF_SIDE_WIDTH_KEY));
      if (savedPdfSideWidth) $('#pdf-reader-main').style.setProperty('--pdf-side-width', clamp(savedPdfSideWidth, 160, 420) + 'px');
      if (localStorage.getItem(PDF_SIDE_COLLAPSED_KEY) === '1') setPdfSideVisible(false);
    } catch (e) {}
    $('#pdf-side-toggle').addEventListener('click', function () { setPdfSideVisible($('#pdf-side').hidden); });
    $('#pdf-side-collapse').addEventListener('click', function () { setPdfSideVisible(false); });
    $('#pdf-side-open').addEventListener('click', function () { setPdfSideVisible(true); });
    $('#pdf-side-tab-outline').addEventListener('click', function () { selectPdfSideTab('outline'); });
    $('#pdf-side-tab-thumbs').addEventListener('click', function () { selectPdfSideTab('thumbs'); });
    $('#pdf-side').querySelector('.pdf-side-tabs').addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('pdf-side-tab') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      var next = e.target.id === 'pdf-side-tab-outline' ? 'thumbs' : 'outline';
      selectPdfSideTab(next);
      $('#pdf-side-tab-' + next).focus();
    });
    (function () {
      var grip = $('#pdf-side-resizer');
      var main = $('#pdf-reader-main');
      var startX = 0, startWidth = 240;
      function width() { return parseFloat(getComputedStyle(main).getPropertyValue('--pdf-side-width')) || 240; }
      function resize(value) {
        var max = Math.max(160, Math.min(420, main.clientWidth - 340));
        var next = clamp(value, 160, max);
        main.style.setProperty('--pdf-side-width', next + 'px');
        grip.setAttribute('aria-valuenow', String(next));
        grip.setAttribute('aria-valuemax', String(max));
      }
      function saveWidth() {
        try { localStorage.setItem(PDF_SIDE_WIDTH_KEY, String(width())); } catch (e) {}
      }
      grip.setAttribute('aria-valuemin', '160');
      grip.setAttribute('aria-valuemax', '420');
      grip.setAttribute('aria-valuenow', String(width()));
      grip.addEventListener('pointerdown', function (e) {
        startX = e.clientX;
        startWidth = width();
        grip.setPointerCapture(e.pointerId);
        grip.classList.add('dragging');
        document.body.classList.add('resizing-panes');
      });
      grip.addEventListener('pointermove', function (e) {
        if (grip.hasPointerCapture(e.pointerId)) resize(startWidth + e.clientX - startX);
      });
      function finish(e) {
        if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
        grip.classList.remove('dragging');
        document.body.classList.remove('resizing-panes');
        saveWidth();
      }
      grip.addEventListener('pointerup', finish);
      grip.addEventListener('pointercancel', finish);
      grip.addEventListener('dblclick', function () { resize(240); saveWidth(); });
      grip.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        resize(width() + (e.key === 'ArrowRight' ? 10 : -10));
        saveWidth();
      });
    })();
    $('#pdf-ocr-page').addEventListener('click', function () {
      if (!pdfState.handle || !pdfState.pageCount) return;
      ocrPdfPages([pdfState.currentPage - 1]);
    });
    $('#pdf-ocr-all').addEventListener('click', function () {
      if (!pdfState.handle || !pdfState.pageCount) return;
      dlgConfirm(T('全文 OCR'), T('对全部 ') + pdfState.pageCount + T(' 页执行 OCR？耗时较长，期间可继续浏览。'), T('开始 OCR')).then(function (ok) {
        if (!ok) return;
        var all = [];
        for (var i = 0; i < pdfState.pageCount; i++) all.push(i);
        ocrPdfPages(all);
      });
    });
    $('#pdf-ocr-cancel').addEventListener('click', function () {
      if (ocrBusy && window.LitOcr) window.LitOcr.cancel();
      hideOcrBanner();
    });
    // 点遮罩空白处关闭（表单类弹窗除外，避免误触丢失输入）
    ['add-mask', 'bibkey-search-mask', 'zotero-import-mask', 'excerpt-mask', 'note-edit-mask', 'query-builder-mask', 'bulk-edit-mask'].forEach(function (id) {
      $('#' + id).addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
    });
    // 纯信息类弹窗：点遮罩空白处关闭，一律走对应关闭按钮，保证状态清理与点按钮一致
    [['dedupe-mask', '#dedupe-close'], ['authors-mask', '#authors-close'], ['tags-mask', '#tags-close'],
      ['shortcuts-mask', '#shortcuts-close'], ['sync-conflict-mask', '#sync-conflict-close'],
      ['cite-mask', '#cite-close'], ['related-mask', '#related-cancel'], ['snapshot-mask', '#snapshot-close'],
      ['graph-mask', '#graph-close']
    ].forEach(function (pair) {
      var infoMask = $('#' + pair[0]);
      var infoBtn = $(pair[1]);
      if (infoMask && infoBtn) infoMask.addEventListener('mousedown', function (e) { if (e.target === infoMask) infoBtn.click(); });
    });
    // 设置弹窗关闭前先落盘待保存的改动
    $('#sync-mask').addEventListener('click', function (e) { if (e.target === this) closeSyncSettings(); });
    // 同步对照弹窗走统一关闭入口：应用进行中不允许关
    $('#sync-remote-plan-mask').addEventListener('click', function (e) {
      if (e.target === this) closeRemotePlanDialog();
    });

    // 通用对话框
    $('#dlg-cancel').addEventListener('click', dlgCancel);
    $('#dlg-mask').addEventListener('click', function (e) { if (e.target === this) dlgCancel(); });
    $('#dlg-ok').addEventListener('click', function () { if (dialogs) dialogs.submit(); });
    $('#dlg-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#dlg-ok').click(); }
    });
    $('#btn-clear').addEventListener('click', function () {
      if (!state.papers.length) { toast(T('文献库已为空')); return; }
      dlgConfirm(T('清空全部文献'), T('确定清空全部 ') + state.papers.length + T(' 篇文献？可在提示条点「撤销」恢复，也建议先导出 JSON 备份。'), T('清空全部'), true).then(function (ok) {
        if (!ok) return;
        removePapers(state.papers.map(function (p) { return p.id; }), T('已清空 ') + state.papers.length + T(' 篇'));
      });
    });
    $('#btn-theme').addEventListener('click', function (e) {
      // 挡住冒泡：同一次 click 会让 document 级「点击 ctx 菜单外部即关闭」把刚弹出的
      // 主题菜单立刻关掉，表现为点按钮毫无反应（与 #btn-export 的 stopPropagation 同理）
      e.stopPropagation();
      if (e.shiftKey) cycleTheme();
      else showThemeMenu();
    });

    initSearchHelp();

    // 搜索 / 筛选
    $('#search').addEventListener('input', debounce(function (e) {
      state.filters.q = e.target.value.trim();
      searchSortOverride = false;
      state.tablePage = 0;
      if (state.ftEnabled) { state.ftHits = {}; runFtSearch(); }
      renderAll();
      var hint = $('#search-hint');
      if (querySyntaxError && state.filters.q) {
        hint.textContent = T('检索语法有误，已按普通子串搜索（点搜索框旁的 ? 查看语法速查）');
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }, 250));
    $('#btn-ft').addEventListener('click', toggleFullTextSearch);

    // 统计面板整体收起/展开（记住状态）；收起后只剩一行摘要，点摘要展开
    function setStatsCollapsed(collapsed, persist) {
      $('#stats-row').classList.toggle('stats-collapsed', collapsed);
      var strip = $('#stats-strip');
      strip.hidden = !collapsed;
      strip.setAttribute('aria-expanded', String(!collapsed));
      if (persist) {
        try { localStorage.setItem(STATS_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (err) {}
      }
    }
    $('#btn-stats-collapse').addEventListener('click', function () { setStatsCollapsed(true, true); });
    $('#stats-strip').addEventListener('click', function () { setStatsCollapsed(false, true); });
    $('#chart-range').addEventListener('click', function () {
      chartShowAllYears = !chartShowAllYears;
      if (!chartShowAllYears && state.filters.year != null && state.filters.year < chartRecentStart) {
        state.filters.year = null;
        state.tablePage = 0;
        renderAll();
      } else renderChart();
    });
    try { setStatsCollapsed(localStorage.getItem(STATS_COLLAPSED_KEY) === '1', false); } catch (err) { setStatsCollapsed(false, false); }

    // 完整度 tile 的缺字段计数 → 一键填入对应 missing: 查询
    function applyStatQuery(text) {
      $('#search').value = text;
      state.filters.q = text;
      state.tablePage = 0;
      state.ftHits = {};
      if (state.ftEnabled) runFtSearch();
      renderAll();
    }
    $('#stat-missing-doi').addEventListener('click', function () { applyStatQuery('missing:doi'); });
    $('#stat-missing-abstract').addEventListener('click', function () { applyStatQuery('missing:abstract'); });

    $all('#status-seg .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        $all('#status-seg .seg-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        state.filters.status = b.dataset.status;
        state.tablePage = 0;
        renderAll();
      });
    });
    // 阶段四：结果实体视图切换
    $all('#result-view .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.resultView = btn.dataset.resultView || 'papers';
        $all('#result-view .seg-btn').forEach(function (x) { x.classList.toggle('active', x === btn); });
        state.tablePage = 0;
        renderTable();
      });
    });
    // 阶段四：实体命中行点击（批注→定位 / 笔记→编辑器 / 附件→打开）
    $('#entity-hits').addEventListener('click', function (e) {
      var pageBtn = e.target.closest('[data-hit-page]');
      if (pageBtn && !pageBtn.disabled) {
        entityHitPage = Math.max(0, entityHitPage + (pageBtn.dataset.hitPage === 'next' ? 1 : -1));
        renderEntityHits();
        return;
      }
      var row = e.target.closest('[data-hit-paper],[data-hit-note],[data-hit-attach]');
      if (!row) return;
      if (row.dataset.hitAnnotation) {
        openPdfAt({ paperId: row.dataset.hitPaper, attachmentId: row.dataset.hitAttachment, annotationId: row.dataset.hitAnnotation, page: 0, epubcfi: row.dataset.hitCfi || '' });
      } else if (row.dataset.hitNote) {
        var note = findNote(row.dataset.hitNote);
        if (note) openNoteEditor(note);
      } else if (row.dataset.hitAttach) {
        var paper = getById(row.dataset.hitPaper);
        var attachment = paper && (paper.attachments || []).find(function (item) { return item.id === row.dataset.hitAttachment; });
        openAttachment(paper, attachment);
      }
    });
    $('#btn-clear-filters').addEventListener('click', function () {
      clearFilters();
      renderAll();
    });

    function showTableColumnsMenu(x, y, anchor) {
      var items = [{ header: T('显示列') }];
      TABLE_COLUMNS.filter(function (column) { return !column.fixed; }).forEach(function (column) {
        items.push({ label: (tableColumns[column.key].visible ? '✓  ' : '    ') + T(column.label), fn: function () {
          tableColumns[column.key].visible = !tableColumns[column.key].visible;
          saveTableColumns();
          renderTable();
        } });
      });
      items.push('sep');
      items.push({ label: T('恢复默认列'), fn: function () {
        TABLE_COLUMNS.forEach(function (column) {
          tableColumns[column.key] = { visible: !column.optional, width: column.width };
        });
        saveTableColumns();
        renderTable();
      } });
      showCtxMenu(x, y, items, anchor ? { anchor: anchor } : null);
    }
    $('#table-columns-btn').addEventListener('click', function (event) {
      event.stopPropagation();
      var rect = event.currentTarget.getBoundingClientRect();
      showTableColumnsMenu(rect.left, rect.top, rect);
    });
    $('#lit-table thead').addEventListener('contextmenu', function (event) {
      if (!event.target.closest('th[data-column]')) return;
      event.preventDefault();
      showTableColumnsMenu(event.clientX, event.clientY);
    });
    var suppressHeaderClick = false;
    var suppressHeaderClickTimer = 0;
    $('#lit-table thead').addEventListener('click', function (event) {
      if (!suppressHeaderClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressHeaderClick = false;
      clearTimeout(suppressHeaderClickTimer);
    }, true);
    $all('.lit-table th[data-column]').forEach(function (th) {
      if (th.dataset.column === 'attachment') return;
      var grip = document.createElement('span');
      grip.className = 'column-resizer';
      grip.setAttribute('aria-hidden', 'true');
      th.appendChild(grip);
      grip.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        event.stopPropagation();
        suppressHeaderClick = true;
        clearTimeout(suppressHeaderClickTimer);
        var key = th.dataset.column;
        var startX = event.clientX;
        var startWidth = th.getBoundingClientRect().width;
        grip.classList.add('dragging');
        document.body.classList.add('resizing-columns');
        function move(moveEvent) {
          tableColumns[key].width = Math.max(key === 'title' ? 180 : 48,
            Math.min(800, Math.round(startWidth + moveEvent.clientX - startX)));
          applyTableColumns(true);
        }
        function stop() {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', stop);
          document.removeEventListener('pointercancel', stop);
          grip.classList.remove('dragging');
          document.body.classList.remove('resizing-columns');
          saveTableColumns();
          // pointerup 后浏览器可能把 click 派给 th，而不是握柄；只吞这次收尾点击。
          suppressHeaderClickTimer = setTimeout(function () { suppressHeaderClick = false; }, 500);
        }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', stop);
        document.addEventListener('pointercancel', stop);
      });
    });

    // 表头排序
    $all('.lit-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.column-resizer')) return;
        // 分区列内嵌的「补查缺失分区」按钮：不触发排序（bind 里另有 stopPropagation 兜底双保险）
        if (e.target && e.target.closest && e.target.closest('#rank-refresh-all')) return;
        var key = th.dataset.sort;
        searchSortOverride = !!state.filters.q;
        if (state.sort.key === key) state.sort.dir *= -1;
        else state.sort = { key: key, dir: key === 'title' || key === 'firstAuthor' || key === 'venue' ? 1 : -1 };
        state.tablePage = 0;
        renderTable();
      });
    });

    $('#table-page-prev').addEventListener('click', function () {
      if (state.tablePage <= 0) return;
      state.tablePage--;
      renderTable();
      refreshFolderJournalRanks(state.activeFolderId);
    });
    $('#table-page-next').addEventListener('click', function () {
      var list = filteredPapers();
      if ((state.tablePage + 1) * TABLE_PAGE_SIZE >= list.length) return;
      state.tablePage++;
      renderTable(list);
      refreshFolderJournalRanks(state.activeFolderId);
    });

    // 表格行：展开折叠 / 状态切换 / 打开抽屉 / 附件交互
    $('#table-body').addEventListener('click', function (e) {
      var expBtn = e.target.closest('[data-act="toggle-expand"]');
      if (expBtn) {
        e.stopPropagation();
        var expId = expBtn.dataset.id;
        if (state.expandedRows[expId]) {
          delete state.expandedRows[expId];
        } else {
          state.expandedRows[expId] = true;
        }
        renderTable();
        return;
      }

      var subTr = e.target.closest('tr.attachment-subrow');
      if (subTr) {
        var parentPaper = getById(subTr.dataset.parentId);
        if (!parentPaper) return;
        var attId = subTr.dataset.attId;
        var att = (parentPaper.attachments || []).find(function (a) { return a.id === attId; });
        if (!att) return;
        var subAct = e.target.closest('[data-subact]');
        if (subAct) {
          var act = subAct.dataset.subact;
          if (act === 'open') {
            openAttachment(parentPaper, att);
            return;
          }
          if (act === 'reveal') {
            if (att.path && desktop) desktop.revealInFolder(att.path).then(function (err) { if (err) toast(T('⚠ 无法定位：') + err); });
            return;
          }
        }
        state.selAnchor = parentPaper.id;
        state.focusId = parentPaper.id;
        openDrawerAndReveal(parentPaper.id);
        return;
      }

      var tr = e.target.closest('tr.lit-row') || e.target.closest('tr');
      if (!tr) return;
      var p = getById(tr.dataset.id);
      if (!p) return;
      var selBox = e.target.closest('[data-act="select"]');
      if (selBox) {
        if (e.shiftKey) {
          state.selAnchor = state.selAnchor || p.id;
          selectRangeTo(p.id);
        } else {
          if (selBox.checked) state.selected[p.id] = true; else delete state.selected[p.id];
          state.selAnchor = p.id;
        }
        state.focusId = p.id;
        updateSelectionUi();
        return;
      }
      var statusBtn = e.target.closest('[data-act="status"]');
      if (statusBtn) {
        p.status = STATUS_NEXT[p.status];
        save(); renderAll();
        return;
      }
      var ftOpen = e.target.closest('[data-act="ft-open"]');
      if (ftOpen) {
        openFullTextHit(p, state.ftHits[p.id]);
        return;
      }
      // Windows 风格选择：Ctrl 切换单选，Shift 区间多选，均不打开抽屉
      if (e.shiftKey) {
        state.selAnchor = state.selAnchor || p.id;
        selectRangeTo(p.id, e.ctrlKey || e.metaKey);
        state.focusId = p.id;
        updateSelectionUi();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        state.selAnchor = p.id;
        toggleSelectId(p.id);
        state.focusId = p.id;
        return;
      }
      state.selected = {};
      state.selected[p.id] = true;
      state.selAnchor = p.id;
      state.focusId = p.id;
      openDrawerAndReveal(p.id);
      updateSelectionUi();
    });
    // 双击表格行：双击附件子行打开该附件；双击文献行打开其主 PDF
    $('#table-body').addEventListener('dblclick', function (e) {
      var subTr = e.target.closest('tr.attachment-subrow');
      if (subTr) {
        var parentPaper = getById(subTr.dataset.parentId);
        if (!parentPaper) return;
        var att = (parentPaper.attachments || []).find(function (a) { return a.id === subTr.dataset.attId; });
        if (att) openAttachment(parentPaper, att);
        return;
      }
      var tr = e.target.closest('tr.lit-row');
      if (tr && !e.target.closest('[data-act]')) {
        var p = getById(tr.dataset.id);
        if (p) {
          var primary = primaryAttachment(p) || (p.attachments && p.attachments[0]);
          if (primary) openAttachment(p, primary);
        }
      }
    });
    // 表格行右键快捷菜单
    $('#table-body').addEventListener('contextmenu', function (e) {
      var subTr = e.target.closest('tr.attachment-subrow');
      if (subTr) {
        var parentPaper = getById(subTr.dataset.parentId);
        if (!parentPaper) return;
        var att = (parentPaper.attachments || []).find(function (a) { return a.id === subTr.dataset.attId; });
        if (!att) return;
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, buildAttachmentCtxItems(parentPaper, att));
        return;
      }
      var tr = e.target.closest('tr.lit-row') || e.target.closest('tr');
      if (!tr) return;
      var target = getById(tr.dataset.id);
      if (!target) return;
      e.preventDefault();
      // 右键未选中行 → 单选该行；已选中则沿用当前多选
      if (!state.selected[target.id]) {
        state.selected = {};
        state.selected[target.id] = true;
        state.selAnchor = target.id;
        state.focusId = target.id;
        updateSelectionUi();
      }
      var papers = selectedIds().map(getById).filter(Boolean);
      if (!papers.length) papers = [target];
      showCtxMenu(e.clientX, e.clientY, buildPaperCtxItems(target, papers));
    });
    document.addEventListener('click', function (e) {
      // 对话面板底部的模型徽标用 click 打开菜单（不是 contextmenu）：同一个 click 会冒泡到这里，
      // 不排除它就会「开了立刻关」——看上去像点了没反应
      if (ctxMenuEl && !e.target.closest('.ctx-menu') && !e.target.closest('#agent-model-btn')) hideCtxMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideCtxMenu();
    });
    var checkAllBox = $('#check-all');
    if (checkAllBox) {
      checkAllBox.addEventListener('change', function () {
        var list = filteredPapers();
        var on = this.checked;
        list.forEach(function (p) { if (on) state.selected[p.id] = true; else delete state.selected[p.id]; });
        if (!on) state.selAnchor = null;
        updateSelectionUi();
      });
    }
    $('#bulk-clear-sel').addEventListener('click', function () {
      state.selected = {}; state.selAnchor = null; updateSelectionUi();
    });
    $('#bulk-bar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bulk]'); if (!b) return;
      var act = b.dataset.bulk;
      var ids = selectedIds(); if (!ids.length) return;
      var papers = ids.map(getById).filter(Boolean);
      if (act === 'edit-fields') {
        openBulkEdit(papers);
      } else if (act === 'tag') {
        dlgPrompt(T('添加标签'), T('给选中的 ') + papers.length + T(' 篇添加标签（逗号分隔）'), T('如：综述, 机器学习')).then(function (t) {
          if (t == null) return;
          var tags = t.split(/[,，;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
          if (!tags.length) return;
          var undoBefore = makeSnapshot({ papers: papers.map(function (p) { return p.id; }) });
          papers.forEach(function (p) {
            var set = {};
            (p.tags || []).forEach(function (x) { set[x] = true; });
            tags.forEach(function (x) { set[x] = true; });
            p.tags = Object.keys(set);
          });
          papers.forEach(function (paper) { paper.tags = window.LitModel.cleanTags(paper.tags); });
          commitUndo(T('批量加标签'), undoBefore, { papers: papers.map(function (p) { return p.id; }) });
          save(); renderAll(); toast(T('✓ 已为 ') + papers.length + T(' 篇加标签'));
        });
      } else if (act === 'folder') {
        if (!state.folders.length) { toast(T('请先在左侧新建文件夹')); return; }
        dlgPick(T('加入文件夹'), T('将选中的 ') + papers.length + T(' 篇加入：'), state.folders.slice().sort(function (a, b) {
          return folderPath(a).localeCompare(folderPath(b), 'zh');
        }).map(function (folder) { return { id: folder.id, label: folderPath(folder) }; })).then(function (folderId) {
          if (folderId == null) return;
          var target = state.folders.find(function (f) { return f.id === folderId; });
          if (!target) return;
          var undoBefore = makeSnapshot({ papers: papers.map(function (p) { return p.id; }) });
          papers.forEach(function (paper) {
            if ((paper.folderIds || []).indexOf(target.id) === -1) paper.folderIds.push(target.id);
          });
          commitUndo(T('加入文件夹「') + target.name + '」', undoBefore, { papers: papers.map(function (p) { return p.id; }) });
          save(); renderAll(); toast(T('✓ 已将 ') + papers.length + T(' 篇加入“') + target.name + '”');
        });
      } else if (act === 'enrich') {
        bulkEnrich(papers);
      } else if (act === 'rename') {
        bulkRenamePdfs(papers);
      } else if (act === 'export-bib') {
        download('litboard-selected-' + stamp() + '.bib', papers.map(window.LitBib.paperToBibtex).join('\n\n'));
      } else if (act === 'export-ris') {
        download('litboard-selected-' + stamp() + '.ris', window.LitCite.ris(papers), 'application/x-research-info-systems');
      } else if (act === 'delete') {
        confirmPapersToTrash(ids);
      } else if (act === 'restore') {
        var restored = restorePapers(ids);
        state.selected = {};
        renderAll();
        toast(T('✓ 已恢复 ') + restored + T(' 篇'));
      } else if (act === 'purge') {
        dlgConfirm(T('彻底删除'), T('彻底删除选中的 ') + papers.length + T(' 篇？此操作不可恢复！'), T('彻底删除'), true).then(function (ok) {
          if (!ok) return;
          var purged = purgePapers(ids);
          state.selected = {};
          renderAll();
          toast(T('已彻底删除 ') + purged + T(' 篇'));
        });
      }
    });

    // 常驻详情栏
    $('#d-close').addEventListener('click', closeDrawer);
    $('#d-links').addEventListener('click', function (e) {
      var p = getById(drawerId); if (!p) return;
      if (e.target.closest('[data-act="read-pdf"]')) { openPdfViewer(p); return; }
      var openButton = e.target.closest('[data-act="open-pdf"]');
      if (!openButton || !desktop || !p.pdfPath) return;
      desktop.openPath(p.pdfPath).then(function (errorMessage) {
        if (errorMessage) toast(T('⚠ 无法打开 PDF：') + errorMessage);
      });
    });
    // M1 弹窗栈：注册覆盖层（Esc 只关最顶层）
    setupModalStack();
    // M3 通知中心：有历史问题时显示入口
    setupIssuesMenu();
    if ($('#btn-issues') && readIssues().length) $('#btn-issues').hidden = false;
    document.addEventListener('keydown', function (e) {
      if (!$('#pdf-overlay').hidden && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault(); pdfSearchPanelOpen(true); return;
      }
      if (e.key === 'Escape') {
        // 检索语法速查浮层：非模态，先于弹窗栈收起
        if (searchHelp && searchHelp.isOpen()) { searchHelp.close(); return; }
        // 窄窗搜索浮层先收起，再走弹窗栈（M1：只关最顶层）
        if (!$('#pdf-overlay').hidden && document.querySelector('.pdf-tools.pdf-search-open')) {
          pdfSearchPanelOpen(false);
          return;
        }
        if (window.LitModal && window.LitModal.closeTop()) return;
        closeDrawer();
        return;
      }
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (!$('#pdf-overlay').hidden) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goToPdfPage(pdfState.currentPage + 1); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goToPdfPage(pdfState.currentPage - 1); }
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomPdf(0.2); }
        else if (e.key === '-') { e.preventDefault(); zoomPdf(-0.2); }
        else if (e.key === '0') { e.preventDefault(); fitPdfWidth(); }
        return;
      }
      if (!$('#epub-overlay').hidden) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); if (epubState.api) epubState.api.next(); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); if (epubState.api) epubState.api.prev(); }
        return;
      }
      // 有弹窗/阅读器打开时，除 Esc 外不响应导航键
      var blocking = ['pdf-overlay', 'epub-overlay', 'edit-mask', 'add-mask', 'cite-mask', 'paste-mask', 'shortcuts-mask', 'bibkey-search-mask', 'dedupe-mask', 'zotero-import-mask', 'excerpt-mask', 'note-edit-mask', 'query-builder-mask', 'bulk-edit-mask', 'snapshot-mask', 'sync-mask', 'sync-remote-plan-mask', 'import-folder-mask', 'authors-mask', 'related-mask', 'tags-mask', 'sync-conflict-mask', 'dlg-mask', 'word-panel-mask', 'bridge-panel-mask', 'graph-mask', 'word-cite-mask'];
      for (var i = 0; i < blocking.length; i++) { if (!$('#' + blocking[i]).hidden) return; }
      if (matchesShortcut(e, state.shortcuts.pdfOnly)) { e.preventDefault(); togglePdfAttachmentSearch(); return; }
      if (matchesShortcut(e, state.shortcuts.bibkey)) { e.preventDefault(); openBibkeySearch(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        var allList = filteredPapers();
        allList.forEach(function (p) { state.selected[p.id] = true; });
        updateSelectionUi();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'Delete': {
          if (e.target.closest('#folder-list, #library-nav') || state.activeFolderId === 'trash' || state.resultView !== 'papers') break;
          var deleteIds = selectedIds();
          if (!deleteIds.length && state.focusId) deleteIds = [state.focusId];
          if (deleteIds.length) { e.preventDefault(); confirmPapersToTrash(deleteIds); }
          break;
        }
        case '/': e.preventDefault(); $('#search').focus(); break;
        case 'j': e.preventDefault(); moveFocus(1, e.shiftKey); break;
        case 'k': e.preventDefault(); moveFocus(-1, e.shiftKey); break;
        case 'ArrowDown': if (e.shiftKey) { e.preventDefault(); moveFocus(1, true); } break;
        case 'ArrowUp': if (e.shiftKey) { e.preventDefault(); moveFocus(-1, true); } break;
        case 'ArrowRight': {
          if (state.focusId) {
            var fpR = getById(state.focusId);
            if (fpR && fpR.attachments && fpR.attachments.length) {
              e.preventDefault();
              state.expandedRows[fpR.id] = true;
              renderTable();
            }
          }
          break;
        }
        case 'ArrowLeft': {
          if (state.focusId && state.expandedRows[state.focusId]) {
            e.preventDefault();
            delete state.expandedRows[state.focusId];
            renderTable();
          }
          break;
        }
        case 'Enter': if (state.focusId) openDrawerAndReveal(state.focusId); break;
        case 'x': if (state.focusId) toggleSelectId(state.focusId); break;
        case 's': {
          if (state.focusId) { var fp = getById(state.focusId); if (fp) { fp.status = STATUS_NEXT[fp.status]; save(); renderAll(); } }
          break;
        }
        case 'n': $('#btn-add').click(); break;
        case 'e': if ($('#drawer').hidden) enrichAll(); break;
        case '?': $('#shortcuts-mask').hidden = false; break;
      }
    });
    $('#d-status').addEventListener('change', function (e) {
      var p = getById(drawerId); if (!p) return;
      p.status = e.target.value;
      save(); renderAll();
    });
    $('#d-rating').addEventListener('click', function (e) {
      var star = e.target.closest('[data-star]'); if (!star) return;
      var p = getById(drawerId); if (!p) return;
      var v = parseInt(star.dataset.star, 10);
      p.rating = (p.rating === v) ? 0 : v; // 点同一颗星取消
      renderDrawerRating(p.rating);
      save(); renderTable();
    });
    $('#d-tags').addEventListener('change', function (e) {
      var p = getById(drawerId); if (!p) return;
      p.tags = window.LitModel.cleanTags(e.target.value.split(/[,，;；]/));
      save(); renderAll();
    });
    // 附件区操作（事件委托）
    $('#d-attachments').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-att-action]');
      if (!btn) return;
      var p = getById(drawerId); if (!p) return;
      var action = btn.dataset.attAction;
      if (action === 'add') { addAttachmentsTo(p); return; }
      if (action === 'rename') { renameAttachmentByTemplate(p, btn.dataset.attId); return; }
      var att = (p.attachments || []).find(function (a) { return a.id === btn.dataset.attId; });
      if (!att) return;
      if (action === 'open') {
        openAttachment(p, att);
      } else if (action === 'reveal') {
        desktop.revealInFolder(att.path).then(function (err) { if (err) toast(T('⚠ 无法定位：') + err); });
      } else if (action === 'primary') {
        p.attachments = [att].concat(p.attachments.filter(function (a) { return a !== att; }));
        var norm = window.LitModel.normalizePaper(p, uid);
        norm.id = p.id;
        state.papers[state.papers.indexOf(p)] = norm;
        save(); renderAll(); openDrawer(p.id);
        toast(T('✓ 已设为主 PDF'));
      } else if (action === 'remove') {
        dlgConfirm(T('移除附件'), T('从库中移除附件「') + (att.fileName || att.path) + T('」？本机文件不会被删除。'), T('移除'), true).then(function (ok) {
          if (!ok) return;
          p.attachments = p.attachments.filter(function (a) { return a !== att; });
          var norm2 = window.LitModel.normalizePaper(p, uid);
          norm2.id = p.id;
          state.papers[state.papers.indexOf(p)] = norm2;
          save(); renderAll(); openDrawer(p.id);
        });
      }
    });
    // 相关文献（事件委托）
    $('#d-related').addEventListener('click', function (e) {
      var p = getById(drawerId); if (!p) return;
      var openBtn = e.target.closest('[data-related-open]');
      if (openBtn) { openDrawerAndReveal(openBtn.dataset.relatedOpen); return; }
      var removeBtn = e.target.closest('[data-related-remove]');
      if (removeBtn) { unlinkRelated(p.id, removeBtn.dataset.relatedRemove); return; }
      if (e.target.closest('[data-related-add]')) {
        relatedPickerPaperId = p.id;
        $('#related-filter').value = '';
        renderRelatedPicker('');
        $('#related-mask').hidden = false;
        setTimeout(function () { $('#related-filter').focus(); }, 0);
      }
    });
    $('#related-filter').addEventListener('input', function (e) { renderRelatedPicker(e.target.value); });
    $('#related-cancel').addEventListener('click', function () { $('#related-mask').hidden = true; });
    $('#related-picker-list').addEventListener('click', function (e) {
      var row = e.target.closest('[data-related-pick]');
      if (!row) return;
      linkRelated(relatedPickerPaperId, row.dataset.relatedPick);
      renderRelatedPicker($('#related-filter').value);
      toast(T('✓ 已建立关联（双向）'));
    });
    $('#d-notes-edit-tab').addEventListener('click', function () { setNotesMode('edit'); });
    $('#d-notes-preview-tab').addEventListener('click', function () { setNotesMode('preview'); });
    $('#d-folders').addEventListener('change', function (e) {
      var input = e.target.closest('[data-assign-folder]');
      var p = getById(drawerId);
      if (!input || !p) return;
      var folderId = input.dataset.assignFolder;
      var ids = (p.folderIds || []).slice();
      var index = ids.indexOf(folderId);
      if (input.checked && index === -1) ids.push(folderId);
      if (!input.checked && index !== -1) ids.splice(index, 1);
      p.folderIds = ids;
      save(); renderAll();
    });
    // 详情栏文件夹区：筛选 / 移出 chip / 新建文件夹
    $('#d-folders').addEventListener('input', function (e) {
      if (e.target.id !== 'd-folder-filter') return;
      drawerFolderFilter = e.target.value;
      var p = getById(drawerId); if (!p) return;
      renderFolderList($('#d-folder-list'), p, drawerFolderFilter);
    });
    $('#d-folders').addEventListener('click', function (e) {
      var p = getById(drawerId); if (!p) return;
      var unassign = e.target.closest('[data-unassign-folder]');
      if (unassign) {
        p.folderIds = (p.folderIds || []).filter(function (id) { return id !== unassign.dataset.unassignFolder; });
        save(); renderAll();
        return;
      }
      var create = e.target.closest('#d-folder-new');
      if (!create) return;
      dlgPrompt(T('新建文件夹'), '', T('文件夹名称')).then(function (name) {
        if (name == null) return;
        name = name.trim().slice(0, 80);
        if (!name) { toast(T('文件夹名称不能为空')); return; }
        var parentId = state.activeFolderId !== 'all' && state.activeFolderId !== 'unfiled'
          ? state.activeFolderId : '';
        if (state.folders.some(function (f) { return f.parentId === parentId && f.name === name; })) {
          toast(T('该位置已存在同名文件夹')); return;
        }
        var folder = { id: folderUid(), name: name, parentId: parentId, sortIndex: folderChildren(parentId).length };
        state.folders.push(folder);
        if ((p.folderIds || []).indexOf(folder.id) === -1) p.folderIds.push(folder.id);
        drawerFolderFilter = '';
        save(); renderAll();
        toast(T('✓ 已创建文件夹「') + name + T('」并加入本文献'));
      });
    });
    saveNotes = debounce(function (paperId) {
      var p = getById(paperId); if (!p) return;
      save();
      if (drawerId === paperId) $('#d-notes-saved').textContent = T('已保存 ✓');
      renderTable();
    }, 500);
    $('#d-notes').addEventListener('input', function (e) {
      var p = getById(drawerId); if (!p) return;
      setPaperNoteContent(p, e.target.value);
      $('#d-notes-saved').textContent = T('输入中…');
      saveNotes(p.id);
    });
    window.addEventListener('beforeunload', function () { if (saveNotes) saveNotes.flush(); });
    function enrichDrawerPaper() {
      var p = getById(drawerId); if (!p) return;
      if (drawerEnriching) return;
      drawerEnriching = true;
      toast(T('查询中…'));
      window.LitEnrich.enrichPaper(p).then(function (patch) {
        if (patch) {
          var updated = applyPatch(p, patch);
          save(); renderAll(); openDrawer(updated.id);
          toast(T('✓ 已补全（来源：') + (patch.source || 'API') + '）');
        } else {
          toast(T('三个数据源均未找到该文献（可检查 DOI 或标题）'));
        }
      }).catch(function (err) {
        toast(T('⚠ 查询失败：') + (err && err.message || T('网络错误')));
      }).finally(function () {
        drawerEnriching = false;
      });
    }
    $('#d-fetch-pdf').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      fetchPdfForPaper(p);
    });
    function copyDrawerBib() {
      var p = getById(drawerId); if (!p) return;
      copyToClipboard(window.LitBib.paperToBibtex(p)).then(function () { toast(T('✓ BibTeX 已复制')); });
    }
    $('#d-edit').addEventListener('click', function () {
      if (drawerInlineEditing) cancelDrawerInlineEdit();
      else startDrawerInlineEdit();
    });
    $('#d-inline-save').addEventListener('click', saveDrawerInlineEdit);
    $('#drawer').addEventListener('keydown', function (e) {
      if (!drawerInlineEditing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelDrawerInlineEdit(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveDrawerInlineEdit(); }
    });
    $('#d-cite').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      openCiteModal(p);
    });
    function deleteDrawerPaper() {
      var p = getById(drawerId); if (!p) return;
      dlgConfirm(T('移入回收站'), T('删除「') + p.title.slice(0, 40) + T('…」？可在提示条点「撤销」恢复。'), T('移入回收站'), true).then(function (ok) {
        if (ok) removePapers([p.id]);
      });
    }
    $('#d-more').addEventListener('click', function (e) {
      e.stopPropagation();
      var rect = e.currentTarget.getBoundingClientRect();
      showCtxMenu(rect.right - 190, rect.bottom + 4, [
        { label: T('补全元数据'), icon: 'lb-i-sparkle', fn: enrichDrawerPaper },
        { label: T('复制 BibTeX'), icon: 'lb-i-doc', fn: copyDrawerBib },
        'sep',
        { label: T('删除文献'), icon: 'lb-i-trash', danger: true, fn: deleteDrawerPaper }
      ]);
    });
  }

  // ---------- 开放获取 PDF 下载（详情栏「PDF」按钮 + 扩展抓取自动补全共用） ----------
  var pdfDownloading = false;
  var pdfDownloadSource = '';
  function pdfSafeFileName(p) {
    var base = String(p.title || p.pdfFileName || 'paper')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (p.year) base += '-' + p.year;
    return (base || 'paper') + '.pdf';
  }
  /* 下载文件名固定使用默认模板（与「按模板重命名」同一口径），回退标题-年份。
   * 返回不含扩展名的主名（.pdf 由主进程 safePdfFileName 统一补）。 */
  function pdfDownloadBaseName(p) {
    var template = (window.LitRename && window.LitRename.DEFAULT_TEMPLATE) || '{author} - {year} - {title}';
    var base = (window.LitRename && window.LitRename.buildName(p, template)) || '';
    if (!base || base === 'paper') {
      base = pdfSafeFileName(p).replace(/\.pdf$/i, '');
    }
    return base;
  }
  function setPdfButton(label, disabled) {
    var btn = $('#d-fetch-pdf');
    if (!btn) return;
    btn.disabled = !!disabled;
    setBtnLabel(btn, label);
    btn.title = label === 'PDF' ? T('从 OpenAlex / Semantic Scholar 查找开放获取 PDF 并保存到本机') : label;
    btn.setAttribute('aria-label', label === 'PDF' ? T('获取 PDF') : label);
  }
  /* 下载落盘后静默构建该篇全文索引：新附件不在索引 meta 里，reindex 只提取这一篇 */
  function indexPaperFulltext(paper) {
    if (!window.LitPdfSearch || !window.LitPdfSearch.reindex) return;
    window.LitPdfSearch.reindex([paper]).catch(function () {});
  }
  /* opts.quiet = 后台自动补全：不弹抽屉、不 toast，失败静默（详情栏按钮流程保持原交互） */
  function downloadPdfCandidate(p, candidates, index, opts) {
    var quiet = !!(opts && opts.quiet);
    var c = candidates[index];
    pdfDownloadSource = c.source;
    setPdfButton(c.source + '…', true);
    return desktop.downloadPdf({
      url: c.url,
      name: pdfDownloadBaseName(p),
      paperId: p.id
    }).then(function (result) {
      if (!result || result.canceled) {
        if (!quiet) toast(T('已取消下载'));
        setPdfButton('PDF', false);
        return;
      }
      if (result.error) {
        if (index + 1 < candidates.length) {
          if (!quiet) toast(c.source + T(' 下载失败：') + result.error + T('，尝试下一个来源…'));
          return downloadPdfCandidate(p, candidates, index + 1, opts);
        }
        if (!quiet) toast(T('⚠ 下载失败：') + result.error);
        setPdfButton('PDF', false);
        return;
      }
      p.attachments = (p.attachments || []).filter(function (att) {
        return !(att && att.kind === 'pdf' && att.path === result.path);
      });
      p.attachments.unshift({
        id: uid(),
        kind: 'pdf',
        fileName: result.path.split(/[\\/]/).pop(),
        path: result.path,
        fingerprint: '',
        cloudName: '',
        syncSignature: '',
        addedAt: Date.now()
      });
      window.LitModel.touch(p);
      var norm = window.LitModel.normalizePaper(p, uid);
      norm.id = p.id;
      var idx = state.papers.indexOf(p);
      if (idx !== -1) state.papers[idx] = norm;
      save(); renderAll();
      indexPaperFulltext(norm);
      setPdfButton('PDF', false);
      if (!quiet) { openDrawer(p.id); toast(T('✓ PDF 已保存到 ') + result.path); }
    });
  }
  function fetchPdfForPaper(p) {
    if (!desktop) { toast(T('下载 PDF 需要桌面版')); return Promise.resolve(); }
    if (pdfDownloading) return Promise.resolve();
    pdfDownloading = true;
    setPdfButton(T('查找中…'), true);
    return window.LitEnrich.findPdfUrls(p).then(function (candidates) {
      if (!candidates.length) {
        toast(T('未找到开放获取 PDF：OpenAlex 和 Semantic Scholar 都没有可下载的全文链接'));
        return;
      }
      if (candidates.length === 1) return downloadPdfCandidate(p, candidates, 0);
      return dlgPick(T('选择 PDF 来源'), T('找到 ') + candidates.length + T(' 个可下载的 PDF 链接：'),
        candidates.map(function (c, i) { return { id: i, label: c.source + ' — ' + c.url }; })
      ).then(function (picked) {
        if (picked == null) return;
        return downloadPdfCandidate(p, candidates, picked);
      });
    }).catch(function (err) {
      toast(T('⚠ 查找 PDF 失败：') + (err && err.message || T('网络错误')));
    }).then(function () {
      pdfDownloading = false;
      setPdfButton('PDF', false);
    });
  }
  /* 扩展抓取的条目若没带上 PDF：后台按开放获取来源（OpenAlex / S2 / Crossref / arXiv）
   * 自动补下载并建索引。串行队列避免列表页批量保存时的并发风暴；失败静默。 */
  var bridgePdfQueue = Promise.resolve();
  function autoFetchPdfAfterBridgeSave(info) {
    var paperId = String(info && info.paperId || '');
    if (!paperId || !desktop || !window.LitEnrich) return;
    bridgePdfQueue = bridgePdfQueue.then(function () {
      var p = state.papers.find(function (x) { return x.id === paperId; });
      if (!p || p.deletedAt) return;
      var hasPdf = !!p.pdfPath || (p.attachments || []).some(function (a) {
        return a && a.kind === 'pdf' && a.path;
      });
      if (hasPdf) { indexPaperFulltext(p); return; }
      return window.LitEnrich.findPdfUrls(p).then(function (candidates) {
        if (!candidates || !candidates.length) return;
        return downloadPdfCandidate(p, candidates, 0, { quiet: true });
      }).catch(function () { /* 后台补全失败不打扰 */ });
    });
  }
  if (desktop && desktop.onDownloadProgress) {
    desktop.onDownloadProgress(function (info) {
      if (!pdfDownloading) return;
      var total = Number(info && info.total) || 0;
      var received = Number(info && info.received) || 0;
      setPdfButton(pdfDownloadSource + (total ? ' ' + Math.round(received / total * 100) + '%' : '…'), true);
    });
  }

  // ---------- 启动 ----------
  function start() {
    initTheme();
    applyTheme(currentTheme());
    initWindowControls();
    state.collapsedFolders = readCollapsedFolders();
    state.shortcuts = readShortcutSettings();
    setLeftSidebarCollapsed(readCollapsedPreference(LEFT_SIDEBAR_COLLAPSED_KEY), false);
    applyPaneSizes(readPaneSizes());
    initWorkspaceStore();
    initHistory();
    initDialogs();
    initReaderNotePanels();
    bindEvents();
    initAgentUi();
    setRightSidebarCollapsed(readCollapsedPreference(RIGHT_SIDEBAR_COLLAPSED_KEY), false);
    /* 阅读模式右栏可达性：PDF/EPUB 全屏层打开时，右栏（详情/AI/批注）浮到层上，
     * 阅读层右侧让出同等宽度（css body.reading-open；AI 对话由此可达）。
     * hidden/class 都会被各处直接赋值，统一 MutationObserver 同步，不逐点插桩。 */
    watchReadingRail();
    // M9 三期：引文网络面板
    if (window.LitGraphView && desktop && desktop.researchGraph) {
      LitGraphView.init({ desktop: desktop, toast: toast });
    }
    // 阶段三：Markdown 图片相对路径（note-assets/）拼接基准 = 配置目录
    if (desktop && desktop.getDataPaths && window.LitMarkdown && window.LitMarkdown.setAssetBase) {
      desktop.getDataPaths().then(function (paths) {
        if (paths && paths.configDir) {
          window.LitMarkdown.setAssetBase('file:///' + String(paths.configDir).replace(/\\/g, '/'));
        }
      }).catch(function () {});
    }
    if (desktop && desktop.getIntegrationConfig) {
      desktop.getIntegrationConfig().then(function (config) { integrationConfig = config; }).catch(function () {});
      if (desktop.getSetting) {
        desktop.getSetting('autoWriteBack').then(function (value) {
          autoWriteBack = value === true;
        }).catch(function () {});
        desktop.getSetting('autoSyncEnabled').then(function (value) {
          autoSyncEnabled = value !== false; // 旧库无此设置时保持原有自动同步行为
        }).catch(function () {});
        desktop.getSetting('translatorAutoTranslate').then(function (value) {
          setTranslatorAutoTranslate(value === true, false);
        }).catch(function () {});
      }
      // 浏览器扩展保存入库 → 刷新视图并提示；顺带后台补全 PDF（未带时）与全文索引
      if (desktop.onLibraryUpdated) {
        desktop.onLibraryUpdated(function (info) {
          load().then(function () {
            renderAll();
            toast(info.duplicated
              ? T('已从浏览器合并：') + String(info.title || '').slice(0, 36)
              : T('✓ 已从浏览器保存：') + String(info.title || '').slice(0, 36) + (info.pdfAttached ? T('（含 PDF）') : ''));
            autoFetchPdfAfterBridgeSave(info);
          });
        });
      }
      // 定时自动同步（15 分钟；编辑后另有 1.2s 防抖同步）。两者都受
      // 「内容变化时自动同步」开关控制，关闭后仅手动「立即同步」联网。
      setInterval(function () {
        if (autoSyncEnabled && !syncBusy && integrationConfig && integrationConfig.nutstoreUser && integrationConfig.hasNutstorePassword) {
          performSync(integrationConfig, true);
        }
      }, 15 * 60 * 1000);
      // 退出前收尾（will-quit 兜底路径；常规窗口关闭走下方 onCloseRequest）：
      // 等本地保存落库后再 ack。退出时不再发起网络同步——受主进程 5s 兜底限制大概率被截断，
      // 反而制造无谓冲突；常规同步由 15 分钟定时 + 编辑后防抖覆盖。
      if (desktop.onBeforeQuit) {
        desktop.onBeforeQuit(function () {
          var acked = false;
          var ack = function () {
            if (acked) return;
            acked = true;
            desktop.quitAck();
          };
          setTimeout(ack, 4000);
          waitForLocalSave().then(ack, ack);
        });
      }
      // M1 关闭收尾：主进程拦截窗口 close 后发来请求；等本地保存「已持久化」再放行。
      // 保存失败 → 保留窗口，由用户决定是否放弃未保存修改强制退出。
      if (desktop.onCloseRequest) {
        desktop.onCloseRequest(function () {
          waitForLocalSave().then(function (ok) {
            if (ok) { desktop.closeAck({ ok: true }); return; }
            dlgConfirm(T('本地保存失败'),
              T('部分修改未成功写入数据库。仍要退出会丢失这些未落库的修改（本机草稿与最近一次完整数据仍在磁盘上）。'),
              T('仍要退出'), true).then(function (force) {
              desktop.closeAck({ ok: !!force });
            });
          }, function () {
            desktop.closeAck({ ok: false });
          });
        });
      }
    }
    load().then(function () {
      state.hiddenPurged = readHiddenPurged();
      // 修剪失效的隐藏标记：id 已不存在，或该条目已恢复为活跃（备份恢复等）→ 取消隐藏
      var stillPurged = {};
      state.papers.forEach(function (p) {
        if (state.hiddenPurged[p.id] && p.deletedAt) stillPurged[p.id] = true;
      });
      state.hiddenPurged = stillPurged;
      if (Object.keys(readHiddenPurged()).length !== Object.keys(stillPurged).length) saveHiddenPurged();
      // 回收站固定保留 30 天；不再将这个低频维护策略暴露为设置项。
      var retention = 30;
      var cutoff = Date.now() - retention * 86400000;
      var stale = state.papers.filter(function (p) { return p.deletedAt && p.deletedAt < cutoff; })
        .map(function (p) { return p.id; });
      if (stale.length) {
        purgePapers(stale);
        toast(T('回收站已自动清理 ') + stale.length + T(' 篇（超过 ') + retention + T(' 天）'));
      }
      renderAll();
      renderPdfTabs();
      reportCurrentFolder(); // 启动时同步一次当前文件夹给浏览器扩展
      window.litboardReadyAt = performance.now();
      if (desktop && desktop.checkAppUpdate) setTimeout(function () { checkForAppUpdate(false); }, 3000);
    });
  }
  if (desktop && desktop.isSmokeTest) window.litboardSmokeImportFolder = importDroppedFolder;
  start();
})();
