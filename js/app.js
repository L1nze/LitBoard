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
  var THEME_KEY = 'litboard.theme';
  var ONBOARD_DISMISS_KEY = 'litboard.onboardDismissed';
  var PANE_SIZES_KEY = 'litboard.paneSizes';
  var FOLDER_TREE_KEY = 'litboard.folderTree.v1';
  var STATS_COLLAPSED_KEY = 'litboard.statsCollapsed.v1';
  var HIDDEN_PURGED_KEY = 'litboard.hiddenPurged.v1';
  var SHORTCUTS_KEY = 'litboard.shortcuts.v1';
  var TABLE_PAGE_SIZE = 100;
  var workspaceRevision = 0;
  var persistedWorkspaceSignatures = null;
  var baseSnapshotEntities = null;   // 最近一次被数据库确认的实体内容克隆（三方合并 base）
  var desktop = window.litboardDesktop || null;

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
    activeSavedSearchId: '',
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
    activeSavedSearchIds: [],      // 阶段四：多智能文件夹联合（AND）
    shortcuts: { pdfOnly: 'p', bibkey: 'b' },
    tablePage: 0,
    sort: { key: 'addedAt', dir: -1 },
    ftEnabled: false,      // PDF 全文检索模式
    ftHits: {}             // paperId -> { pages, count }
  };

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

  function readPaneSizes() {
    try {
      var value = JSON.parse(localStorage.getItem(PANE_SIZES_KEY) || '{}');
      return {
        left: clamp(Number(value.left) || 220, 160, 360),
        right: clamp(Number(value.right) || 370, 300, 560)
      };
    } catch (e) { return { left: 220, right: 370 }; }
  }

  function applyPaneSizes(sizes) {
    var workspace = $('.workspace');
    if (!workspace) return;
    var available = Math.max(0, workspace.clientWidth - 520);
    var left = clamp(sizes.left, 160, 360);
    var right = clamp(sizes.right, 300, 560);
    if (left + right > available && available >= 460) {
      if (right > 300) right = Math.max(300, available - left);
      if (left + right > available) left = Math.max(160, available - right);
    }
    workspace.style.setProperty('--library-width', left + 'px');
    workspace.style.setProperty('--detail-width', right + 'px');
    workspace.dataset.leftWidth = left;
    workspace.dataset.rightWidth = right;
    $('#resizer-left').setAttribute('aria-valuenow', left);
    $('#resizer-left').setAttribute('aria-valuemin', '160');
    $('#resizer-left').setAttribute('aria-valuemax', '360');
    $('#resizer-right').setAttribute('aria-valuenow', right);
    $('#resizer-right').setAttribute('aria-valuemin', '300');
    $('#resizer-right').setAttribute('aria-valuemax', '560');
  }

  function savePaneSizes() {
    var workspace = $('.workspace');
    if (!workspace) return;
    localStorage.setItem(PANE_SIZES_KEY, JSON.stringify({
      left: Number(workspace.dataset.leftWidth),
      right: Number(workspace.dataset.rightWidth)
    }));
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

  function toast(msg, ms, action) {
    var el = document.createElement('div');
    el.className = 'toast';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    var timer = setTimeout(remove, ms || 2600);
    function remove() { clearTimeout(timer); el.remove(); }
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

  function setupIssuesMenu() {
    var btn = $('#btn-issues');
    var menu = $('#issues-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) {
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
      p.relatedIds = (p.relatedIds || []).filter(function (rid) { return !idSet[rid]; });
    });
    if (purged) { saveHiddenPurged(); save(); closeDrawer(); renderAll(); }
    return purged;
  }

  // ---------- 存储 ----------
  function workspacePayload() {
    return {
      papers: state.papers,
      notes: state.notes,
      folders: state.folders.concat(state.folderTombstones),
      savedSearches: state.savedSearches.concat(state.savedSearchTombstones),
      tagColors: state.tagColors,
      tagColorRecords: state.tagColorRecords
    };
  }

  function applyWorkspaceState(workspace) {
    state.papers = workspace.papers;
    state.notes = workspace.notes || [];
    state.folders = (workspace.folders || []).filter(function (folder) { return !folder.deletedAt; });
    state.folderTombstones = (workspace.folders || []).filter(function (folder) { return !!folder.deletedAt; });
    state.savedSearches = (workspace.savedSearches || []).filter(function (search) { return !search.deletedAt; });
    state.savedSearchTombstones = (workspace.savedSearches || []).filter(function (search) { return !!search.deletedAt; });
    state.tagColors = workspace.tagColors || {};
    state.tagColorRecords = workspace.tagColorRecords || [];
    persistedWorkspaceSignatures = window.LitModel.workspaceSignatures(workspacePayload());
    baseSnapshotEntities = cloneAllEntities(workspacePayload());
  }

  /** 实体内容克隆表（三方合并的 base）：id/tag → 最近一次被数据库确认的内容 */
  function cloneAllEntities(workspace) {
    var out = { papers: {}, notes: {}, folders: {}, savedSearches: {}, tagColorRecords: {} };
    function cloneList(target, list, keyOf) {
      (list || []).forEach(function (item) {
        if (!item) return;
        var key = keyOf(item);
        try { target[key] = JSON.parse(JSON.stringify(item)); } catch (e) {}
      });
    }
    cloneList(out.papers, workspace && workspace.papers, function (x) { return x.id; });
    cloneList(out.notes, workspace && workspace.notes, function (x) { return x.id; });
    cloneList(out.folders, workspace && workspace.folders, function (x) { return x.id; });
    cloneList(out.savedSearches, workspace && workspace.savedSearches, function (x) { return x.id; });
    cloneList(out.tagColorRecords, workspace && workspace.tagColorRecords, function (x) { return x.tag; });
    return out;
  }

  /** 保存成功后，把签名相对旧 base 变化的实体克隆进 base 快照 */
  function refreshBaseSnapshot(workspace, oldBase) {
    if (!baseSnapshotEntities) { baseSnapshotEntities = cloneAllEntities(workspace); return; }
    var sigs = window.LitModel.workspaceSignatures(workspace);
    function keyOfCollection(collection) {
      return collection === 'tagColorRecords' ? function (x) { return x.tag; } : function (x) { return x.id; };
    }
    ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'].forEach(function (collection) {
      var keyOf = keyOfCollection(collection);
      var seen = {};
      (workspace[collection] || []).forEach(function (item) {
        var key = keyOf(item);
        seen[key] = true;
        var changed = !oldBase || !oldBase[collection] || oldBase[collection][key] !== sigs[collection][key];
        if (!changed) return;
        try { baseSnapshotEntities[collection][key] = JSON.parse(JSON.stringify(item)); } catch (e) {}
      });
      Object.keys(baseSnapshotEntities[collection]).forEach(function (key) {
        if (!seen[key]) delete baseSnapshotEntities[collection][key];
      });
    });
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
  function resolveSaveConflicts(conflicts) {
    if (!window.LitMerge || !conflicts || !conflicts.length) return Promise.resolve(true);
    var chain = Promise.resolve(true);
    conflicts.forEach(function (conflict) {
      chain = chain.then(function (proceed) {
        if (!proceed) return false;
        var local = findLocalEntity(conflict.collection, conflict.id);
        if (!local) return true; // 本地没有该实体：保留库内版本即可
        var base = baseSnapshotEntities[conflict.collection][conflict.id] || null;
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

  /* M1 保存链：串联每轮 save() 的落库结果。关闭收尾经 waitForLocalSave() 等它 settle，
   * 区分「已进入队列」与「已持久化」。 */
  var saveChain = Promise.resolve(true);
  function trackSave(promise) {
    saveChain = saveChain.then(function () { return promise; }, function () { return promise; })
      .then(function (result) { return result !== false; }, function () { return false; });
    return promise;
  }

  function signaturesContain(actual, expected) {
    if (!actual || !expected) return false;
    var collections = ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'];
    for (var i = 0; i < collections.length; i++) {
      var name = collections[i];
      var expectedMap = expected[name] || {};
      var actualMap = actual[name] || {};
      var keys = Object.keys(expectedMap);
      for (var j = 0; j < keys.length; j++) {
        if (actualMap[keys[j]] !== expectedMap[keys[j]]) return false;
      }
    }
    return true;
  }

  function save(skipNutstoreSync) {
    window.LitModel.assignCitationKeys(state.papers);
    if (window.LitQuery && window.LitQuery.clearHaystackCache) window.LitQuery.clearHaystackCache();
    var workspace = workspacePayload();
    if (persistedWorkspaceSignatures) {
      window.LitModel.touchWorkspaceChanges(workspace, persistedWorkspaceSignatures, Date.now());
    }
    var saveRevision = ++workspaceRevision;
    var nextSignatures = window.LitModel.workspaceSignatures(workspace);
    var oldBase = persistedWorkspaceSignatures;
    function confirmSaved(result) {
      if (desktop && (!result || !signaturesContain(result.signatures, nextSignatures))) {
        throw new Error(T('SQLite 写入后校验失败：数据库返回的内容签名与当前工作区不一致'));
      }
      // 只有这轮保存仍是“最新一轮”时才更新确认状态，防止旧轮结果覆盖新轮
      if (workspaceRevision !== saveRevision) return true;
      persistedWorkspaceSignatures = (result && result.signatures) || nextSignatures;
      refreshBaseSnapshot(workspace, oldBase);
      if (!skipNutstoreSync) scheduleNutstoreSync();
      return true;
    }
    if (desktop) {
      return trackSave(desktop.saveLibrary(workspace, persistedWorkspaceSignatures).then(function (result) {
        if (!result || !result.conflicts || !result.conflicts.length) return confirmSaved(result);
        if (workspaceRevision !== saveRevision) return true; // 期间又有新编辑：留给下一次保存
        // 有冲突：先把已写入的实体同步进 base，再合并解决冲突并以最新 base 重提
        persistedWorkspaceSignatures = (result && result.signatures) || oldBase;
        refreshBaseSnapshot(workspace, oldBase);
        return resolveSaveConflicts(result.conflicts).then(function (resolved) {
          if (!resolved) {
            toast(T('⚠ 保存冲突未解决，本地修改已保留，请重试'));
            return false;
          }
          return save(skipNutstoreSync);
        });
      }).catch(function (e) {
        toast(T('⚠ 本地数据保存失败：') + (e && e.message || e));
        return false;
      }));
    }
    var localStorageOk = true;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(workspace));
      confirmSaved(null);
    } catch (e) {
      localStorageOk = false;
      toast(T('⚠ 本地存储已满，数据未能保存，请导出 JSON 备份'));
    }
    return trackSave(Promise.resolve(localStorageOk));
  }
  /** 等待全部已排队的本地保存落库；resolve 布尔 = 是否全部成功 */
  function waitForLocalSave() {
    if (saveNotes && saveNotes.flush) saveNotes.flush();
    return saveChain;
  }
  function load() {
    if (desktop) {
      return desktop.loadLibrary().then(function (value) {
        var workspace = window.LitModel.normalizeWorkspace(value, uid);
        applyWorkspaceState(workspace);
        libraryLoadFailed = false;
        window.litboardSqliteReady = true;
      }).catch(function (e) {
        libraryLoadFailed = true;
        applyWorkspaceState(window.LitModel.normalizeWorkspace({}, uid));
        toast(T('⚠ 本地数据库读取失败：') + (e && e.message || e));
      });
    }
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var workspace = window.LitModel.normalizeWorkspace(raw ? JSON.parse(raw) : {}, uid);
      applyWorkspaceState(workspace);
    } catch (e) { applyWorkspaceState(window.LitModel.normalizeWorkspace({}, uid)); }
    return Promise.resolve();
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
    return window.LitModel.normalizePaper(Object.assign({
      id: uid(),
      key: '', entryType: 'article',
      title: '', authors: [], year: null, venue: '',
      doi: '', url: '', abstract: '',
      citations: null, citationSource: '', citationUpdatedAt: '', oaUrl: '', openalexId: '',
      tags: [], folderIds: [], status: 'unread', rating: 0, notes: '', pdfAnnotations: [],
      addedAt: Date.now()
    }, base || {}), uid);
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
    var addedIds = [];   // M9 二期：新建条目的 id（收藏桥回写 researchIds 用）
    var indexMap = [];   // 与输入 list 逐一对齐：{ kind: 'added'|'merged', id }（收藏桥回写 researchIds 用）
    list.forEach(function (base) {
      var hit = window.LitDedupe.findMatch(index, base);
      var existing = hit ? hit.paper : null;
      if (existing) {
        // 挂附件：incoming 的 PDF 并入原条目（指纹>路径>id 判重；原无主 PDF 时置首成为主 PDF）
        var beforeCount = (existing.attachments || []).length;
        var mergedAttachments = window.LitDedupe.mergeAttachments(existing, base);
        var attachedNow = mergedAttachments.length > beforeCount;
        var changed = false;
        matches.push({ id: existing.id, title: existing.title, folderIds: (existing.folderIds || []).slice(), reason: hit.reason, attachedPdf: attachedNow });
        // 只补空字段，不覆盖用户已有内容；pdf* 旧字段不直写，交给 normalizePaper 从主附件重投影
        ['abstract', 'doi', 'url', 'venue', 'oaUrl', 'openalexId', 'key'].forEach(function (f) {
          if (!existing[f] && base[f]) { existing[f] = base[f]; changed = true; }
        });
        if (existing.year == null && base.year != null) { existing.year = base.year; changed = true; }
        if (existing.citations == null && base.citations != null) { existing.citations = base.citations; changed = true; }
        if ((!existing.authors || !existing.authors.length) && base.authors && base.authors.length) { existing.authors = base.authors; changed = true; }
        if (base.pdfAnnotations && base.pdfAnnotations.length) {
          existing.pdfAnnotations = window.LitDedupe.merge([existing, base]).pdfAnnotations;
          changed = true;
        }
        if (folderId && (existing.folderIds || []).indexOf(folderId) === -1) { existing.folderIds.push(folderId); changed = true; }
        if (attachedNow) {
          existing.attachments = mergedAttachments;
          changed = true;
        }
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
  var undoStack = [], redoStack = [];
  var UNDO_LIMIT = 100;
  function snapOne(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return JSON.parse(JSON.stringify(list[i]));
    }
    return { __absent: true };
  }
  function makeSnapshot(ids) {
    ids = ids || {};
    var snap = { papers: {}, notes: {}, folders: {} };
    (ids.papers || []).forEach(function (id) { snap.papers[id] = snapOne(state.papers, id); });
    (ids.notes || []).forEach(function (id) { snap.notes[id] = snapOne(state.notes, id); });
    (ids.folders || []).forEach(function (id) {
      var rec = snapOne(state.folders, id);
      snap.folders[id] = rec.__absent ? snapOne(state.folderTombstones, id) : rec;
    });
    return snap;
  }
  function applySnapshot(snap) {
    function applyList(list, map) {
      Object.keys(map || {}).forEach(function (id) {
        var rec = map[id];
        var idx = -1;
        for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === id) { idx = i; break; } }
        if (rec.__absent) { if (idx !== -1) list.splice(idx, 1); }
        else if (idx === -1) list.push(JSON.parse(JSON.stringify(rec)));
        else list[idx] = JSON.parse(JSON.stringify(rec));
      });
    }
    applyList(state.papers, snap.papers);
    applyList(state.notes, snap.notes);
    applyList(state.folders, snap.folders);
    applyList(state.folderTombstones, snap.folders);
    // 归一化一次，修正兼容投影（paper.notes 等）
    var norm = window.LitModel.normalizeWorkspace(workspacePayload());
    state.papers = norm.papers;
    state.notes = norm.notes;
  }
  function commitUndo(label, before, ids) {
    undoStack.push({ label: label, before: before, after: makeSnapshot(ids) });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoUi();
  }
  function undoOnce() {
    var entry = undoStack.pop();
    if (!entry) return;
    applySnapshot(entry.before);
    redoStack.push(entry);
    save(); renderAll();
    if (drawerId && getById(drawerId)) openDrawer(drawerId);
    updateUndoUi();
    toast(T('↩ 已撤销：') + entry.label);
  }
  function redoOnce() {
    var entry = redoStack.pop();
    if (!entry) return;
    applySnapshot(entry.after);
    undoStack.push(entry);
    save(); renderAll();
    if (drawerId && getById(drawerId)) openDrawer(drawerId);
    updateUndoUi();
    toast(T('↪ 已重做：') + entry.label);
  }
  function updateUndoUi() {
    var u = $('#btn-undo'), r = $('#btn-redo');
    if (u) {
      u.disabled = !undoStack.length;
      u.title = undoStack.length ? T('撤销：') + undoStack[undoStack.length - 1].label + '（Ctrl+Z）' : T('撤销（Ctrl+Z）');
    }
    if (r) {
      r.disabled = !redoStack.length;
      r.title = redoStack.length ? T('重做：') + redoStack[redoStack.length - 1].label + '（Ctrl+Y）' : T('重做（Ctrl+Y）');
    }
  }
  // ---------- 筛选 & 排序 ----------
  var querySyntaxError = false;
  /* 排序用 collator 实例复用：localeCompare 每次调用都重解析 locale，万级文献排序时差一个数量级 */
  var SORT_COLLATOR = null;

  function filteredPapers() {
    var f = state.filters;
    var inTrash = state.activeFolderId === 'trash';
    var isRecent = state.activeFolderId === 'recent';
    var q = window.LitQuery ? window.LitQuery.normalizeForSearch(f.q) : f.q.toLowerCase();
    var parsed = null;
    querySyntaxError = false;
    if (f.q && !state.ftEnabled && window.LitQuery) {
      parsed = window.LitQuery.parse(f.q);
      if (parsed.error) { parsed = null; querySyntaxError = true; }
    }
    // 阶段四：多选文件夹的后代集合（一次计算）
    var multiFolderSets = {};
    state.activeFolderIds.forEach(function (fid) { multiFolderSets[fid] = folderDescendantSet(fid); });
    var out = state.papers.filter(function (p) {
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
    // 智能文件夹（与当前筛选叠加；支持多选联合 AND）
    var activeSearchIds = state.activeSavedSearchId
      ? [state.activeSavedSearchId].concat(state.activeSavedSearchIds.filter(function (id) { return id !== state.activeSavedSearchId; }))
      : state.activeSavedSearchIds.slice();
    if (activeSearchIds.length && window.LitQuery) {
      activeSearchIds.forEach(function (searchId) {
        var saved = state.savedSearches.find(function (s) { return s.id === searchId; });
        if (!saved) return;
        var compiled = compileSavedSearch(saved);
        if (compiled.matcher) out = out.filter(compiled.matcher);
      });
    }
    var key = state.sort.key, dir = state.sort.dir;
    var STATUS_ORDER = { unread: 0, reading: 1, read: 2 };
    var sortCollator = SORT_COLLATOR || (SORT_COLLATOR = new Intl.Collator());
    out.sort(function (a, b) {
      var va, vb;
      if (key === 'firstAuthor') { va = (a.authors || [])[0] || ''; vb = (b.authors || [])[0] || ''; }
      else if (key === 'status') { va = STATUS_ORDER[a.status] || 0; vb = STATUS_ORDER[b.status] || 0; }
      else if (key === 'journalRank') { va = journalRankQuality(a); vb = journalRankQuality(b); }
      else { va = a[key]; vb = b[key]; }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // 空值恒沉底
      if (vb == null) return -1;
      if (typeof va === 'string') return sortCollator.compare(va, vb) * dir;
      return (va - vb) * dir;
    });
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

  /* 阶段四：智能文件夹编译缓存（内容或工作区引用变化即重编） */
  var savedSearchCompileCache = {};
  function compileSavedSearch(search) {
    var hit = savedSearchCompileCache[search.id];
    if (hit && hit.query === search.query && hit.ast === search.ast &&
        hit.notes === state.notes && hit.folders === state.folders) return hit.compiled;
    var compiled = null;
    try {
      compiled = window.LitQuery.compile(
        search.ast ? JSON.parse(search.ast) : search.query,
        { notes: state.notes, folders: state.folders });
    } catch (e) {
      compiled = { matcher: null, error: String(e && e.message || e) };
    }
    savedSearchCompileCache[search.id] = {
      query: search.query, ast: search.ast,
      notes: state.notes, folders: state.folders, compiled: compiled
    };
    return compiled;
  }

  function hasActiveFilters() {
    var f = state.filters;
    return !!(f.q || f.status || f.tag || f.year != null || f.pdfOnly || (f.bibkeys && f.bibkeys.length) || state.ftEnabled);
  }

  function clearFilters() {
    state.filters = { q: '', status: '', tag: '', year: null, pdfOnly: false, bibkeys: [] };
    state.tablePage = 0;
    $('#search').value = '';
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
      return (p.attachments || []).some(function (attachment) { return attachment.kind === 'pdf' && attachment.path; }) || !!p.pdfPath;
    });
    var statusEl = $('#ft-status');
    statusEl.hidden = false;
    statusEl.textContent = candidates.length
      ? T('全文检索中…（') + candidates.length + T(' 篇 PDF，首次较慢）')
      : T('库内没有带本地 PDF 的文献');
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
      statusEl.textContent = hits.length
        ? T('命中 ') + hits.length + T(' 篇 · ') + totalMatches + T(' 处')
        : T('PDF 正文中未找到「') + query + '」';
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

  /* 侧栏计数单遍缓存：头部四项 + 每文件夹计数 + 智能文件夹命中数。
   * 签名 = 各集合长度 + 最大 updatedAt/lastReadAt + purge 键数：内容性修改一律经
   * touch/touchWorkspaceChanges 抬 updatedAt，阅读进度只动 lastReadAt，彻底删除改
   * hiddenPurged 键数——签名不变则计数必然不变，renderAll 因此从 O(文件夹×文献)
   * 的逐文件夹全量扫描降为一次 O(文献) 遍历且跨渲染复用。 */
  var sidebarCountsCache = { sig: '', data: null };
  function sidebarCounts() {
    var maxUp = 0, maxRead = 0;
    for (var i = 0; i < state.papers.length; i++) {
      var p = state.papers[i];
      if (p.updatedAt > maxUp) maxUp = p.updatedAt;
      if (p.lastReadAt > maxRead) maxRead = p.lastReadAt;
    }
    var maxNote = 0;
    for (var j = 0; j < state.notes.length; j++) { if (state.notes[j].updatedAt > maxNote) maxNote = state.notes[j].updatedAt; }
    var maxFolder = 0;
    for (var k = 0; k < state.folders.length; k++) { if (state.folders[k].updatedAt > maxFolder) maxFolder = state.folders[k].updatedAt; }
    var sig = [state.papers.length, maxUp, maxRead, state.notes.length, maxNote,
      state.folders.length, maxFolder, Object.keys(state.hiddenPurged).length].join('|');
    if (sidebarCountsCache.sig === sig && sidebarCountsCache.data) return sidebarCountsCache.data;
    var byFolder = {}, all = 0, unfiled = 0, recent = 0, trash = 0;
    var matchers = [], searchCounts = {};
    state.savedSearches.forEach(function (s) {
      var compiled = window.LitQuery ? compileSavedSearch(s) : null;
      matchers.push(compiled && compiled.matcher ? compiled.matcher : null);
      searchCounts[s.id] = 0;
    });
    state.papers.forEach(function (paper) {
      if (paper.deletedAt) { if (!state.hiddenPurged[paper.id]) trash++; return; }
      all++;
      var fids = paper.folderIds || [];
      if (!fids.length) unfiled++;
      if (paper.lastReadAt) recent++;
      for (var m = 0; m < fids.length; m++) byFolder[fids[m]] = (byFolder[fids[m]] || 0) + 1;
      for (var s = 0; s < matchers.length; s++) if (matchers[s] && matchers[s](paper)) searchCounts[state.savedSearches[s].id]++;
    });
    sidebarCountsCache = { sig: sig, data: { byFolder: byFolder, all: all, unfiled: unfiled, recent: recent, trash: trash, searchCounts: searchCounts } };
    return sidebarCountsCache.data;
  }

  function folderPaperCount(folderId) {
    return sidebarCounts().byFolder[folderId] || 0;
  }

  function compareFolders(a, b) {
    return (a.sortIndex || 0) - (b.sortIndex || 0) || a.name.localeCompare(b.name);
  }

  function folderTree(includeCollapsed) {
    var children = {}, byId = {}, result = [];
    state.folders.forEach(function (folder) { byId[folder.id] = folder; });
    state.folders.forEach(function (folder) {
      var parentId = folder.parentId && byId[folder.parentId] ? folder.parentId : '';
      (children[parentId] = children[parentId] || []).push(folder);
    });
    Object.keys(children).forEach(function (parentId) {
      children[parentId].sort(compareFolders);
    });
    function visit(parentId, depth) {
      (children[parentId] || []).forEach(function (folder) {
        result.push({ folder: folder, depth: depth });
        if (includeCollapsed || !state.collapsedFolders[folder.id]) visit(folder.id, depth + 1);
      });
    }
    visit('', 0);
    return result;
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

  function renumberFolderOrder(parentId) {
    folderChildren(parentId).forEach(function (folder, index) { folder.sortIndex = index; });
  }

  /** 拖动排序：mode 为 'before' | 'after' | 'inside' */
  function reorderFolder(dragId, targetId, mode) {
    var dragged = state.folders.find(function (folder) { return folder.id === dragId; });
    var target = state.folders.find(function (folder) { return folder.id === targetId; });
    if (!dragged || !target || dragId === targetId || isFolderDescendant(dragId, targetId)) return false;
    var oldParent = dragged.parentId || '';
    if (mode === 'inside') {
      dragged.parentId = targetId;
      var childrenOfTarget = folderChildren(targetId).filter(function (folder) { return folder.id !== dragId; });
      childrenOfTarget.push(dragged);
      childrenOfTarget.forEach(function (folder, index) { folder.sortIndex = index; });
    } else {
      dragged.parentId = target.parentId || '';
      var siblings = folderChildren(target.parentId || '');
      var pos = siblings.indexOf(target);
      if (pos === -1) pos = siblings.length;
      if (mode === 'after') pos++;
      var without = siblings.filter(function (folder) { return folder.id !== dragId; });
      without.splice(Math.max(0, Math.min(pos, without.length)), 0, dragged);
      without.forEach(function (folder, index) { folder.sortIndex = index; });
    }
    if (oldParent !== (dragged.parentId || '')) renumberFolderOrder(oldParent);
    return true;
  }

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
    if (multi) {
      // 阶段四：Ctrl+点击加入/移出多选集合（联合筛选，含子文件夹）
      var idx = state.activeFolderIds.indexOf(folderId);
      if (idx === -1) state.activeFolderIds.push(folderId);
      else state.activeFolderIds.splice(idx, 1);
      state.activeFolderId = state.activeFolderIds.length ? state.activeFolderIds[0] : folderId;
    } else {
      state.activeFolderId = folderId;
      state.activeFolderIds = [];
    }
    state.activeSavedSearchId = '';   // 点击侧栏文件夹即退出智能文件夹视图
    state.activeSavedSearchIds = [];
    state.focusId = null;
    // 阶段四：切换文件夹保留筛选条件（不再清搜索框）
    state.selected = {};
    state.selAnchor = null;
    state.tablePage = 0;
    journalRankFreezeOrder = null;    // 切换视图即取消冻结（新列表按新排序渲染）
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
    list.innerHTML = '';
    folderTree().forEach(function (entry) {
      var folder = entry.folder;
      var row = document.createElement('div');
      row.className = 'folder-item' + (state.activeFolderId === folder.id ? ' active' : '');
      if (state.activeFolderIds.indexOf(folder.id) !== -1) row.classList.add('multi-active');
      row.dataset.folder = folder.id;
      row.draggable = true;
      row.style.setProperty('--folder-depth', entry.depth);
      row.classList.toggle('nested', entry.depth > 0);
      row.classList.toggle('collapsed', !!state.collapsedFolders[folder.id]);
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
    renderSavedSearches();
  }

  /** 删除文件夹：子文件夹上移一级，文献本身保留（Zotero 行为） */
  function deleteFolder(folderId) {
    var folder = state.folders.find(function (item) { return item.id === folderId; });
    if (!folder) return;
    var childCount = state.folders.filter(function (item) { return item.parentId === folderId; }).length;
    dlgConfirm(T('删除文件夹'), T('删除文件夹“') + folder.name + T('”？文献本身不会被删除。') +
      (childCount ? T('其 ') + childCount + T(' 个子文件夹将上移一级。') : ''), T('删除'), true).then(function (ok) {
      if (!ok) return;
      state.folders.forEach(function (item) { if (item.parentId === folderId) item.parentId = folder.parentId || ''; });
      state.folders = state.folders.filter(function (item) { return item.id !== folderId; });
      state.folderTombstones = state.folderTombstones.filter(function (item) { return item.id !== folderId; });
      state.folderTombstones.push(Object.assign({}, folder, { deletedAt: Date.now() }));
      state.papers.forEach(function (paper) {
        paper.folderIds = (paper.folderIds || []).filter(function (fid) { return fid !== folderId; });
      });
      if (state.activeFolderId === folderId) resetActiveFolder();
      save(); renderAll();
      toast(T('已删除文件夹“') + folder.name + '”');
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

  function exportFolderBib(folder) {
    var papers = folderPapers(folder.id);
    if (!papers.length) { toast(T('该文件夹（含子文件夹）下没有文献')); return; }
    var base = (window.LitRename && window.LitRename.sanitize(folder.name, 80)) || 'folder';
    var out = papers.map(window.LitBib.paperToBibtex).join('\n\n');
    download(base + '.bib', out);
  }

  function buildFolderCtxItems(folder) {
    return [
      { header: folderPath(folder) },
      'sep',
      { label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } },
      { label: T('新建子文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(folder.id); } },
      'sep',
      { label: T('导出 PDF…'), icon: 'lb-i-tray-up', fn: function () { exportPdfs(folderPapers(folder.id)); } },
      { label: T('导出 BibTeX'), icon: 'lb-i-doc', fn: function () { exportFolderBib(folder); } },
      { label: T('构建引文网络'), icon: 'lb-i-layers', fn: function () { buildFolderGraph(folder); } },
      'sep',
      { label: T('重命名…'), icon: 'lb-i-pencil', fn: function () { renameFolder(folder.id); } },
      { label: T('删除文件夹'), icon: 'lb-i-trash', danger: true, fn: function () { deleteFolder(folder.id); } }
    ];
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

  // ---------- 智能文件夹 ----------
  function savedSearchCount(search) {
    return sidebarCounts().searchCounts[search.id] || 0;
  }

  function renderSavedSearches() {
    var list = $('#saved-search-list');
    if (!list) return;
    list.innerHTML = '';
    state.savedSearches.slice().sort(function (a, b) { return a.sortIndex - b.sortIndex; }).forEach(function (search) {
      var row = document.createElement('div');
      var isActive = state.activeSavedSearchId === search.id || state.activeSavedSearchIds.indexOf(search.id) !== -1;
      row.className = 'saved-search-item' + (isActive ? ' active' : '');
      var select = document.createElement('button');
      select.type = 'button';
      select.className = 'saved-search-select';
      select.dataset.savedSearch = search.id;
      select.title = search.query + T('（Ctrl+点击可多选联合）');
      select.innerHTML = '<span class="saved-search-label">' + svgUse('lb-i-search') + esc(search.name) + '</span>' +
        '<span class="library-count">' + savedSearchCount(search) + '</span>';
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'saved-search-edit';
      editBtn.dataset.editSavedSearch = search.id;
      editBtn.title = T('编辑智能文件夹');
      editBtn.textContent = '✎';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'saved-search-delete';
      del.dataset.deleteSavedSearch = search.id;
      del.title = T('删除智能文件夹');
      del.textContent = '×';
      row.appendChild(select);
      row.appendChild(editBtn);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  function saveCurrentSearch() {
    var query = state.filters.q.trim();
    if (!query) { toast(T('先在搜索框输入条件（如 tag:综述 year>=2020）')); return; }
    dlgPrompt(T('智能文件夹名称'), T('保存当前搜索条件：') + query, '', query.length > 24 ? query.slice(0, 24) + '…' : query).then(function (name) {
      if (name == null) return;
      name = name.trim().slice(0, 80);
      if (!name) return;
      if (window.LitQuery) {
        var parsed = window.LitQuery.parse(query);
        if (parsed.error) { toast(T('搜索语法有误，无法保存：') + parsed.error); return; }
      }
      state.savedSearches.push({
        id: 'ss' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        name: name, query: query,
        ast: window.LitQuery ? window.LitQuery.serializeAst(window.LitQuery.parseAst(query)) : '',
        sortIndex: state.savedSearches.length
      });
      save();
      renderSavedSearches();
      toast(T('✓ 已保存智能文件夹「') + name + '」');
    });
  }

  /** 阶段四：编辑智能文件夹（改名 + 改条件；AST 随保存更新，旧记录运行时自动迁移） */
  function editSavedSearch(id) {
    var search = state.savedSearches.find(function (s) { return s.id === id; });
    if (!search) return;
    dlgPrompt(T('重命名智能文件夹'), T('名称'), search.name).then(function (name) {
      if (name == null) return;
      name = name.trim().slice(0, 80);
      if (!name) return;
      dlgPrompt(T('搜索条件'), T('语法同搜索框；支持 ann(...)/note(...)/folder:"名称"/lastread>=2024-01-01/missing:venue'), search.query).then(function (query) {
        if (query == null) return;
        query = query.trim();
        if (!query) return;
        var parsed = window.LitQuery ? window.LitQuery.parse(query) : null;
        if (parsed && (parsed.error || !parsed.matcher)) {
          toast(T('搜索语法有误：') + (parsed.error || T('空条件')));
          return;
        }
        search.name = name;
        search.query = query;
        search.ast = window.LitQuery ? window.LitQuery.serializeAst(window.LitQuery.parseAst(query)) : '';
        window.LitModel.touch(search);
        save();
        renderSavedSearches();
        renderAll();
        toast(T('✓ 已更新智能文件夹「') + name + '」');
      });
    });
  }

  /** 应用智能文件夹；multi（Ctrl+点击）= 加入/移出多选联合集 */
  function applySavedSearch(id, multi) {
    if (multi) {
      var idx = state.activeSavedSearchIds.indexOf(id);
      if (idx === -1) state.activeSavedSearchIds.push(id);
      else state.activeSavedSearchIds.splice(idx, 1);
      state.activeSavedSearchId = state.activeSavedSearchIds.length ? state.activeSavedSearchIds[0] : '';
    } else if (state.activeSavedSearchId === id) {
      state.activeSavedSearchId = '';   // 再点一次取消
      state.activeSavedSearchIds = [];
    } else {
      state.activeSavedSearchId = id;
      state.activeSavedSearchIds = [];
    }
    resetActiveFolder();
    state.activeFolderIds = [];
    // 阶段四：切换智能文件夹保留筛选条件（不再清搜索框）
    state.tablePage = 0;
    renderAll();
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
      var badge = att.path ? T('<span class="attachment-badge local">本地</span>')
        : (att.cloudName ? T('<span class="attachment-badge cloud">云端</span>') : T('<span class="attachment-badge missing">缺文件</span>'));
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
    epubState.pendingSelection = null;
    $('#epub-sel-popover').hidden = true;
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
    // 收起 PDF overlay（若可见）
    if (!$('#pdf-overlay').hidden) {
      saveReadPos.flush();
      stashPdfTab();
      ttsStop();
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
    epubState.api.goTo(annotation.position.cfi);
    renderEpubAnnotations(annotationId);
    var item = $('#epub-annotation-list [data-annotation-id="' + annotationId + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  /* ---- EPUB 侧栏笔记编辑器（与 PDF 面板同一交互，id 前缀 epub-） ---- */
  var epubNoteCurrentId = '';
  var saveEpubNoteSide = debounce(function () { save(); }, 500);
  var saveEpubAnnotationComment = debounce(function () { save(); }, 600);

  function currentEpubNote() {
    if (!epubState.paper) return null;
    var note = epubNoteCurrentId ? findNote(epubNoteCurrentId) : null;
    if (note && (note.paperId === epubState.paper.id || !note.paperId)) return note;
    var own = notesForPaper(epubState.paper.id);
    return own.length ? own[0] : (topicNotes()[0] || null);
  }

  function renderEpubNoteEditor() {
    var editor = $('#epub-note-editor');
    if (!epubState.paper) { editor.hidden = true; return; }
    editor.hidden = false;
    var note = currentEpubNote();
    epubNoteCurrentId = note ? note.id : '';
    fillNoteSelect($('#epub-note-select'), epubState.paper.id, epubNoteCurrentId);
    var ta = $('#epub-note-textarea');
    ta.value = note ? note.content : '';
    ta.disabled = !note;
    setEpubNoteMode($('#epub-note-preview-tab').classList.contains('active') ? 'preview' : 'edit');
    renderEpubNoteStale();
  }

  function setEpubNoteMode(mode) {
    var preview = mode === 'preview';
    $('#epub-note-textarea').hidden = preview;
    $('#epub-note-preview').hidden = !preview;
    $('#epub-note-edit-tab').classList.toggle('active', !preview);
    $('#epub-note-preview-tab').classList.toggle('active', preview);
    if (preview) {
      var note = currentEpubNote();
      if (!note || !note.content.trim()) {
        $('#epub-note-preview').innerHTML = T('<p class="d-abstract none">暂无内容</p>');
      } else if (note.format === 'richtext' && window.LitNoteMl) {
        $('#epub-note-preview').innerHTML = window.LitNoteMl.sanitizeHtml(note.content);
      } else {
        $('#epub-note-preview').innerHTML = window.LitMarkdown.render(note.content);
      }
    }
  }

  function renderEpubNoteStale() {
    var box = $('#epub-note-stale');
    var note = currentEpubNote();
    if (!note) { box.hidden = true; box.innerHTML = ''; return; }
    var items;
    if (note.format === 'richtext' && window.LitNoteMl) {
      items = window.LitNoteMl.parseExcerptBlocks(note.content).map(function (block) {
        var found = findAnnotationAnywhere(block.annotationId, block.paperId, block.attachmentId);
        if (!found) return { status: 'deleted', annotationId: block.annotationId, preview: block.quoteText };
        if (block.sourceUpdatedAt != null && Number(found.annotation.updatedAt) !== Number(block.sourceUpdatedAt)) {
          return { status: 'changed', annotationId: block.annotationId, preview: block.quoteText, current: found.annotation };
        }
        return { status: 'fresh', annotationId: block.annotationId, preview: block.quoteText };
      }).filter(function (item) { return item.status !== 'fresh'; });
    } else if (window.LitExcerpt) {
      items = window.LitExcerpt.staleExcerpts(note.content, function (annotationId, excerpt) {
        var found = findAnnotationAnywhere(annotationId, excerpt && excerpt.paperId, excerpt && excerpt.attachmentId);
        return found ? found.annotation : null;
      }).filter(function (item) { return item.status !== 'fresh'; })
        .map(function (item) {
          return { status: item.status, annotationId: item.excerpt.annotationId, preview: item.excerpt.quote, current: item.current || null };
        });
    } else {
      box.hidden = true; box.innerHTML = ''; return;
    }
    box.innerHTML = '';
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false;
    items.slice(0, 10).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'pdf-note-stale-item';
      var badge = document.createElement('span');
      badge.className = 'pdf-note-stale-badge' + (item.status === 'deleted' ? ' deleted' : '');
      badge.textContent = item.status === 'deleted' ? T('来源已删除') : T('来源已更新');
      row.appendChild(badge);
      var quote = document.createElement('span');
      quote.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      quote.textContent = (item.preview || '').split('\n')[0].slice(0, 40);
      row.appendChild(quote);
      var mkBtn = function (label, action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost btn-xs';
        btn.dataset.staleAction = action;
        btn.dataset.annotationId = item.annotationId;
        btn.textContent = label;
        return btn;
      };
      if (item.status === 'changed') {
        row.appendChild(mkBtn(T('采用更新'), 'adopt'));
        row.appendChild(mkBtn(T('保留'), 'keep'));
      } else {
        row.appendChild(mkBtn(T('移除摘录'), 'remove'));
      }
      box.appendChild(row);
    });
  }

  function epubHandleStaleAction(action, annotationId) {
    var note = currentEpubNote();
    if (!note) return;
    if (note.format === 'richtext' && window.LitNoteMl) {
      var richTarget = window.LitNoteMl.parseExcerptBlocks(note.content).find(function (block) {
        return block.annotationId === annotationId;
      });
      var found = richTarget ? findAnnotationAnywhere(annotationId, richTarget.paperId, richTarget.attachmentId) : null;
      if (action === 'adopt' && found) {
        note.content = window.LitNoteMl.replaceExcerptBlock(note.content, annotationId, {
          quoteText: annotationQuote(found.annotation),
          commentText: found.annotation.comment || '',
          sourceUpdatedAt: found.annotation.updatedAt
        });
        toast(T('✓ 已采用来源更新'));
      } else if (action === 'keep' && found) {
        note.content = window.LitNoteMl.markExcerptBlockCurrent(note.content, annotationId, found.annotation.updatedAt);
      } else if (action === 'remove') {
        note.content = window.LitNoteMl.removeExcerptBlock(note.content, annotationId);
      } else return;
      window.LitModel.touch(note);
      save();
      $('#epub-note-textarea').value = note.content;
      renderEpubNoteStale();
      if (!$('#epub-note-preview').hidden) setEpubNoteMode('preview');
      return;
    }
    if (!window.LitExcerpt) return;
    var target = window.LitExcerpt.parseExcerpts(note.content)
      .find(function (x) { return x.annotationId === annotationId; });
    if (!target) return;
    var foundMarkdown = findAnnotationAnywhere(annotationId, target.paperId, target.attachmentId);
    if (action === 'adopt' && foundMarkdown) {
      note.content = window.LitExcerpt.replaceExcerpt(note.content, target, {
        quote: annotationQuote(foundMarkdown.annotation),
        comment: foundMarkdown.annotation.comment || '',
        sourceUpdatedAt: foundMarkdown.annotation.updatedAt
      });
      toast(T('✓ 已采用来源更新'));
    } else if (action === 'keep' && foundMarkdown) {
      note.content = window.LitExcerpt.markExcerptCurrent(note.content, target, foundMarkdown.annotation);
    } else if (action === 'remove') {
      note.content = window.LitExcerpt.removeExcerpt(note.content, target);
    } else return;
    window.LitModel.touch(note);
    save();
    $('#epub-note-textarea').value = note.content;
    renderEpubNoteStale();
    if (!$('#epub-note-preview').hidden) setEpubNoteMode('preview');
  }

  function addAttachmentsTo(paper) {
    if (!desktop || !desktop.chooseFiles) { toast(T('添加附件需要桌面版')); return; }
    desktop.chooseFiles({ title: T('添加附件到「') + String(paper.title).slice(0, 24) + '」' }).then(function (files) {
      if (!files || !files.length) return;
      paper.attachments = paper.attachments || [];
      files.forEach(function (file) {
        paper.attachments.push(window.LitModel.normalizeAttachment({
          id: attachmentUid(),
          kind: window.LitModel.attachmentKindForFile(file.name) || 'supp',
          fileName: file.name,
          path: file.path
        }));
      });
      var norm = window.LitModel.normalizePaper(paper, uid);
      norm.id = paper.id;
      state.papers[state.papers.indexOf(paper)] = norm;
      save(); renderAll(); openDrawer(paper.id);
      toast(T('✓ 已添加 ') + files.length + T(' 个附件'));
    }).catch(function (e) { toast(T('⚠ 添加附件失败：') + (e && e.message || e)); });
  }

  /* 文件拖到条目行上：附加到该条目（Zotero 式行级落点，对照 collectionViewItemTree.onDrop
   * 的 application/x-moz-file 分支）。PDF 拷入受管 synced-attachments（files:store-pdf）后挂为
   * PDF 附件（原无主 PDF 则置首，与导入合并同口径）；其他类型比照「添加附件」走外部路径；
   * .lnk 快捷方式拒绝（Zotero 同）。附加后为该篇补建全文索引。 */
  function attachDroppedFiles(paper, files) {
    if (!desktop) { toast(T('附加文件需要桌面版')); return; }
    var list = Array.prototype.slice.call(files || []);
    if (list.some(function (f) { return /\.lnk$/i.test(f.name); })) toast(T('⚠ 快捷方式（.lnk）无法作为附件，已跳过'));
    list = list.filter(function (f) { return !/\.lnk$/i.test(f.name); });
    if (!list.length) return;
    var pdfs = list.filter(function (f) { return /\.pdf$/i.test(f.name); });
    var supps = list.filter(function (f) { return !/\.pdf$/i.test(f.name); });
    paper.attachments = paper.attachments || [];
    var chain = Promise.resolve();
    pdfs.forEach(function (f) {
      chain = chain.then(function () {
        return desktop.storePdf({ path: f.path }).then(function (result) {
          if (!result || result.error || result.unchanged) {
            toast('⚠ ' + f.name + T(' 存储失败：') + (result && result.error || T('文件已在库中')));
            return;
          }
          var att = window.LitModel.normalizeAttachment({
            id: attachmentUid(),
            kind: 'pdf',
            fileName: result.name || f.name,
            path: result.path
          });
          var hasPrimary = (paper.attachments || []).some(function (a) { return a && a.kind === 'pdf' && a.path; });
          if (!hasPrimary) paper.attachments.unshift(att); else paper.attachments.push(att);
        });
      });
    });
    supps.forEach(function (f) {
      chain = chain.then(function () {
        paper.attachments.push(window.LitModel.normalizeAttachment({
          id: attachmentUid(),
          kind: window.LitModel.attachmentKindForFile(f.name) || 'supp',
          fileName: f.name,
          path: f.path
        }));
      });
    });
    chain.then(function () {
      window.LitModel.touch(paper);
      var norm = window.LitModel.normalizePaper(paper, uid);
      norm.id = paper.id;
      var idx = state.papers.indexOf(paper);
      if (idx !== -1) state.papers[idx] = norm;
      save(); renderAll();
      toast(T('✓ 已附加 ') + list.length + T(' 个文件到「') + String(paper.title || '').slice(0, 24) + '」');
      if (pdfs.length) {
        indexPaperFulltext(norm);
        backfillPdfFingerprints().then(renderAll).catch(function () {});
      }
    }).catch(function (e) { toast(T('⚠ 附加失败：') + (e && e.message || e)); });
  }

  function renameAttachmentByTemplate(paper, attId) {
    if (!desktop || !desktop.renameFile || !window.LitRename) { toast(T('重命名需要桌面版')); return; }
    var att = (paper.attachments || []).find(function (a) { return a.id === attId; });
    if (!att || !att.path) { toast(T('该附件没有本地文件')); return; }
    var template = (integrationConfig && integrationConfig.renameTemplate) || window.LitRename.DEFAULT_TEMPLATE;
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
    var template = (integrationConfig && integrationConfig.renameTemplate) || window.LitRename.DEFAULT_TEMPLATE;
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
  function selectRangeTo(targetId) {
    var list = filteredPapers();
    var targetIdx = -1, anchorIdx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === targetId) targetIdx = i;
      if (list[i].id === state.selAnchor) anchorIdx = i;
    }
    state.selected = {};
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

  function renderChart() {
    var body = $('#year-chart');
    body.innerHTML = '';
    var old = $('.ybar-x'); if (old) old.remove();

    var counts = {};
    state.papers.forEach(function (p) { if (!p.deletedAt && p.year != null) counts[p.year] = (counts[p.year] || 0) + 1; });
    var years = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    if (!years.length) {
      body.innerHTML = T('<div class="chart-empty">导入文献后显示年份分布</div>');
      return;
    }
    var minY = years[0], maxY = years[years.length - 1];
    var seq = [];
    if (maxY - minY <= 50) { for (var y = minY; y <= maxY; y++) seq.push(y); }
    else seq = years; // 跨度太大时只画有数据的年份
    var maxCount = Math.max.apply(null, years.map(function (y) { return counts[y]; }));

    var tooltip = $('#chart-tooltip');
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
        state.filters.year = (state.filters.year === y) ? null : y;
        state.tablePage = 0;
        renderAll();
      });
      body.appendChild(bar);
    });

    // x 轴刻度：首尾年份 + 中间一个
    var axis = document.createElement('div');
    axis.className = 'ybar-x';
    var mid = seq[Math.floor(seq.length / 2)];
    seq.forEach(function (y) {
      var s = document.createElement('span');
      if (y === minY || y === maxY || (seq.length > 4 && y === mid)) s.textContent = y;
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
    tags.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'chip' + (state.filters.tag === t ? ' active' : '');
      if (state.tagColors[t]) b.style.setProperty('--tag-color', state.tagColors[t]);
      b.textContent = t + ' ' + freq[t];
      b.addEventListener('click', function () {
        state.filters.tag = (state.filters.tag === t) ? '' : t;
        state.tablePage = 0;
        renderAll();
      });
      wrap.appendChild(b);
    });
  }

  var STATUS_LABEL = { unread: T('未读'), reading: T('在读'), read: T('已读') };
  var STATUS_NEXT = { unread: 'reading', reading: 'read', read: 'unread' };

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
  var journalRankPending = Object.create(null);   // venueKey → true，正在查询的期刊
  var journalRankFreezeOrder = null;              // 分区补查期间冻结的行顺序（paper id 数组）
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
    if (journalRankPending[venueKey]) {
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
    if (journalRankFreezeOrder) {
      var pos = {};
      journalRankFreezeOrder.forEach(function (id, i) { pos[id] = i; });
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
    var visibleCount = state.papers.filter(function (p) { return !state.hiddenPurged[p.id]; }).length;
    $('#empty-state').style.display = visibleCount ? 'none' : '';
    // M3：跳过引导后，空库只显示一行简版提示（信息仍在，不再展开四步清单）
    var onboardDismissed = false;
    try { onboardDismissed = localStorage.getItem(ONBOARD_DISMISS_KEY) === '1'; } catch (e) {}
    $('#onboard-steps').hidden = onboardDismissed;
    $('#onboard-actions').hidden = onboardDismissed;
    $('#onboard-short').hidden = !onboardDismissed;
    $('#table-foot').textContent = visibleCount
      ? T('共 ') + visibleCount + T(' 篇') + (hasActiveFilters() ? T('，当前显示 ') + list.length + T(' 篇') : '')
      : '';

    $('#table-pagination').hidden = list.length <= TABLE_PAGE_SIZE;
    $('#table-page-info').textContent = list.length ? (start + 1) + '-' + (start + pageItems.length) + ' / ' + list.length : '0 / 0';
    $('#table-page-prev').disabled = state.tablePage === 0;
    $('#table-page-next').disabled = state.tablePage >= pageCount - 1;

    // 排序指示
    $all('.lit-table th.sortable').forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.sort === state.sort.key);
      th.classList.toggle('desc', th.dataset.sort === state.sort.key && state.sort.dir === -1);
    });

    var rows = [];
    pageItems.forEach(function (p) {
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
      var cls = 'lit-row' + (state.selected[p.id] ? ' selected' : '') + (p.id === state.focusId ? ' focused' : '') +
        (p.id === drawerId ? ' detail-active' : '');
      rows.push('<tr class="' + cls.trim() + '" data-id="' + p.id + T('" draggable="true" title="拖动到左侧文件夹可归类">') +
        '<td class="col-attachment">' + attachmentHtml(p) + '</td>' +
        '<td class="col-title"><div class="t-title-row">' + expandHtml + '<div class="t-title">' + esc(p.title) + '</div></div>' +
          (sub.length ? '<div class="t-sub">' + sub.join(' · ') + '</div>' : '') + '</td>' +
        '<td class="cell-authors">' + esc(authorsShort(p.authors)) + '</td>' +
        '<td class="num">' + (p.year != null ? p.year : '—') + '</td>' +
        '<td>' + esc(p.venue || '—') + '</td>' +
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
          if (att.path) badges.push(T('<span class="attachment-badge local">本地</span>'));
          else if (att.cloudName) badges.push(T('<span class="attachment-badge cloud">云端</span>'));
          else badges.push(T('<span class="attachment-badge missing">缺文件</span>'));

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
    tbody.innerHTML = rows.join('');
    syncCheckAll(list);
  }

  // ---------- 通用对话框（替代原生 confirm / prompt） ----------
  var dlgState = null;

  function dlgCancel() {
    if (!dlgState) return;
    var s = dlgState;
    dlgState = null;
    $('#dlg-mask').hidden = true;
    s.resolve(s.mode === 'confirm' ? false : null);
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
      ['word-panel-mask', '#word-panel-close'], ['bridge-panel-mask', '#bridge-panel-close']
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

  function dlgSettle(value) {
    if (!dlgState) return;
    var s = dlgState;
    dlgState = null;
    $('#dlg-mask').hidden = true;
    s.resolve(value);
  }

  /**
   * options: { title, body, okText, danger, input: {placeholder, value}, list: [{id, label}] }
   * confirm 模式 resolve true/false；input 模式 resolve 字符串/null；list 模式 resolve 选中 id/null（点击即选）。
   */
  function dlgOpen(options) {
    if (dlgState) dlgCancel();
    return new Promise(function (resolve) {
      var mode = options.list ? 'list' : (options.input ? 'input' : 'confirm');
      dlgState = { resolve: resolve, mode: mode };
      $('#dlg-title').textContent = options.title || T('确认');
      var body = $('#dlg-body');
      body.textContent = options.body || '';
      body.hidden = !options.body;
      var input = $('#dlg-input');
      input.hidden = !options.input;
      if (options.input) {
        input.placeholder = options.input.placeholder || '';
        input.value = options.input.value || '';
      }
      var list = $('#dlg-list');
      list.innerHTML = '';
      list.hidden = !options.list;
      if (options.list) {
        options.list.forEach(function (item) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'dlg-option';
          b.textContent = item.label;
          b.addEventListener('click', function () { dlgSettle(item.id); });
          list.appendChild(b);
        });
      }
      var okBtn = $('#dlg-ok');
      okBtn.hidden = mode === 'list';
      okBtn.textContent = options.okText || T('确定');
      okBtn.className = 'btn ' + (options.danger ? 'btn-danger-solid' : 'btn-primary');
      $('#dlg-mask').hidden = false;
      setTimeout(function () {
        if (mode === 'input') { input.focus(); input.select(); }
        else if (mode === 'list') { var first = list.querySelector('.dlg-option'); if (first) first.focus(); }
        else okBtn.focus();
      }, 0);
    });
  }

  function dlgConfirm(title, body, okText, danger) {
    return dlgOpen({ title: title, body: body, okText: okText, danger: danger });
  }

  function dlgPrompt(title, body, placeholder, value) {
    return dlgOpen({ title: title, body: body, input: { placeholder: placeholder, value: value } });
  }

  function dlgPick(title, body, items) {
    return dlgOpen({ title: title, body: body, list: items });
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

  function showCtxMenu(x, y, items) {
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
    items.push({ label: T('标为已读'), dot: 'read', fn: function () { ctxSetStatus('read', papers); } });
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
    items.push({ label: T('移入回收站'), icon: 'lb-i-trash', danger: true, fn: function () {
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
    if (!desktop || !desktop.writePdf || !window.PDFLib || !window.LitPdfAnnot) {
      if (!silent) toast(T('写回批注需要桌面版'));
      return Promise.resolve(false);
    }
    if (!paper || !attachment || !attachment.path) {
      if (!silent) toast(T('没有本地 PDF'));
      return Promise.resolve(false);
    }
    var annotations = annotationsForAttachment(paper, attachment);
    return desktop.readFileBytes(attachment.path).then(function (bytes) {
      return window.LitPdfAnnot.writeAnnotations(new Uint8Array(bytes), annotations);
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
  function maybeImportPdfAnnotations(paper, doc, attachment) {
    if (!window.LitPdfAnnot || !doc || !paper || !attachment) return;
    window.LitPdfAnnot.readAnnotations(doc).then(function (found) {
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
      toast(T('PDF 内含 ') + fresh.length + T(' 条标准批注'), 9000, {
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

  /** 用户主动打开某条文献（点列表行 / Enter / 右键「打开详情」/ 相关文献链接）：
   * 右栏可能正停在 AI 对话或手动检索面板，此时必须切回详情页——否则详情写进了隐藏面板，
   * 用户看到的是「点了没反应」。内部的「刷新当前抽屉」调用仍走 openDrawer（不动右栏），
   * 否则撤销、补全、编辑保存这类刷新会把正在对话的用户拽出 AI 面板。 */
  function openDrawerAndReveal(id) {
    if (window.LitAgentUi && window.LitAgentUi.switchPane) window.LitAgentUi.switchPane('detail');
    openDrawer(id);
  }

  function openDrawer(id) {
    var p = getById(id);
    if (!p) return;
    drawerId = id;
    drawerFolderFilter = '';
    $('#drawer').hidden = false;
    $('#detail-empty').hidden = true;

    $('#d-status').value = p.status;
    $('#d-title').textContent = p.title;
    var metaParts = [];
    if (p.authors && p.authors.length) metaParts.push(p.authors.join(', '));
    if (p.venue) metaParts.push(p.venue);
    if (p.year != null) metaParts.push(p.year);
    if (p.key) metaParts.push('bibkey: ' + p.key);
    if (p.citations != null) metaParts.push(T('被引 ') + p.citations + (p.citationSource ? '（' + p.citationSource + '）' : ''));
    $('#d-meta').textContent = metaParts.join(' · ') || T('（暂无元数据，可点右上角「补全」）');
    renderJournalRank(p);

    var links = [];
    // DOI 以链接形态给出：链接文本就是 DOI 本体（看得见、选得中），点击打开 doi.org 主页
    if (p.doi) links.push('<a href="https://doi.org/' + esc(p.doi) + '" target="_blank" rel="noopener" title="'
      + esc(T('点击打开 doi.org 主页')) + '">DOI ' + esc(p.doi) + '</a>');
    if (p.oaUrl) links.push('<a href="' + esc(p.oaUrl) + T('" target="_blank" rel="noopener">开放获取全文</a>'));
    if (p.url) links.push('<a href="' + esc(p.url) + T('" target="_blank" rel="noopener">原始链接</a>'));
    if (p.openalexId) links.push('<a href="' + esc(p.openalexId) + '" target="_blank" rel="noopener">OpenAlex</a>');
    if (p.doi && integrationConfig && integrationConfig.proxyPrefix) {
      var proxyTarget = 'https://doi.org/' + p.doi;
      var proxyPrefix = integrationConfig.proxyPrefix;
      var proxyHref = proxyPrefix.indexOf('%U') !== -1
        ? proxyPrefix.replace('%U', encodeURIComponent(proxyTarget))
        : proxyPrefix + proxyTarget;
      links.push('<a href="' + esc(proxyHref) + T('" target="_blank" rel="noopener" title="经机构代理访问出版商全文">') + svgUse('lb-i-bank') + T('机构访问</a>'));
    }
    if (p.pdfPath && desktop) links.push(T('<button type="button" data-act="read-pdf" title="使用 LitBoard 内置阅读器打开">') + svgUse('lb-i-book') + T('内置 PDF 打开</button>'));
    if (p.pdfPath && desktop) links.push(T('<button type="button" data-act="open-pdf" title="使用系统默认 PDF 程序打开">') + svgUse('lb-i-external') + T('外部程序打开</button>'));
    if (p.title) links.push('<a href="https://scholar.google.com/scholar?q=' + encodeURIComponent(p.title) + T('" target="_blank" rel="noopener">Google 学术</a>'));
    $('#d-links').innerHTML = links.join('');

    renderDrawerRating(p.rating);

    $('#d-tags').value = (p.tags || []).join(', ');
    renderFolderAssignments(p);
    renderAttachments(p);
    renderRelated(p);
    var absEl = $('#d-abstract');
    if (p.abstract) { absEl.textContent = p.abstract; absEl.classList.remove('none'); }
    else { absEl.textContent = T('（无摘要 — 试试「补全」按钮）'); absEl.classList.add('none'); }

    var n = window.LitEnrich.guessSampleSize(p.abstract);
    $('#d-extract').textContent = n ? T('从摘要识别的样本量（供参考）：n = ') + n : '';

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

  function addJournalRankItem(container, label, value, kind) {
    if (value == null || value === '') return;
    var item = document.createElement('span');
    item.className = 'journal-rank-item' + (kind ? ' ' + kind : '');
    var title = document.createElement('strong');
    title.textContent = label + ' ';
    item.appendChild(title);
    item.appendChild(document.createTextNode(String(value)));
    container.appendChild(item);
  }
  function addJournalRankFlag(container, label, kind) {
    var item = document.createElement('span');
    item.className = 'journal-rank-item' + (kind ? ' ' + kind : '');
    item.textContent = label;
    container.appendChild(item);
  }
  function renderJournalRank(paper, message) {
    var wrap = $('#d-journal-rank');
    var values = $('#d-journal-rank-values');
    values.innerHTML = '';
    if (!paper || !paper.venue) { wrap.hidden = true; return; }
    var rank = paper.journalRank;
    if (rank) {
      if (rank.beihe) addJournalRankFlag(values, T('北核'), 'rank-core');
      if (rank.xr) addJournalRankItem(values, T('新锐'), rankXrValue(rank.xr), journalRankTier(rank.xr));
      if (rank.xrTop) addJournalRankFlag(values, 'Top', 'rank-top');
      if (rank.jcr) addJournalRankItem(values, 'JCR', rank.jcr, 'rank-jcr');
      if (rank.imf != null) addJournalRankItem(values, 'IF', rank.imf, 'rank-if');
    }
    if (!values.childNodes.length && message) {
      var empty = document.createElement('span');
      empty.className = 'journal-rank-empty';
      empty.textContent = message;
      values.appendChild(empty);
    }
    wrap.hidden = !values.childNodes.length;
  }
  /** 统一取期刊等级数据：兼容 SciGreat({results:[{data}]}) 与 EasyScholar({code,msg,data}) */
  function rankResultData(response) {
    if (!response) return null;
    if (Array.isArray(response.results)) {
      var result = response.results[0];
      return result && result.data && typeof result.data === 'object' ? result.data : null;
    }
    if (Number(response.code) === 200 && response.data && typeof response.data === 'object') return response.data;
    return null;
  }
  /** 把不同提供商的等级数据归一为 journalRank 模型字段 */
  function journalRankFromData(data) {
    if (!data) return null;
    var o = data.officialRank && data.officialRank.all ? data.officialRank.all : data;
    return window.LitModel.normalizeJournalRank({
      abbr: data.abbr || o.abbr || '',
      jcr: data.jcr || o.sci || '',
      cas: data.cas || o.sciBase || o.sciUp || '',
      casTop: data.cas_top || o.sciUpTop || '',
      xr: data.xr || o.xr || '',
      xrTop: data.xr_top || o.xrTop || '',
      beihe: data.pku || data.pku_core || data.beihe || data.beida_core || data.core || o.pku || '',
      imf: data.imf != null ? data.imf : o.sciif,
      jci: data.jci != null ? data.jci : o.jci,
      updatedAt: Date.now()
    });
  }
  function journalRankSummary(data) {
    var rank = journalRankFromData(data);
    if (!rank) return T('无分区数据');
    var parts = [];
    if (rank.xr) parts.push(T('新锐 ') + rank.xr);
    if (rank.xrTop) parts.push('Top');
    if (rank.beihe) parts.push(T('北核'));
    if (rank.cas) parts.push(T('中科院 ') + rank.cas);
    if (rank.imf != null) parts.push('IF ' + rank.imf);
    return parts.length ? parts.join(' · ') : T('有数据');
  }
  function shouldRefreshJournalRank(paper) {
    var checkedAt = Number(paper && paper.journalRankCheckedAt) || 0;
    return !!(paper && paper.venue) && (!checkedAt || Date.now() - checkedAt > 7 * 24 * 60 * 60 * 1000);
  }
  // 文件夹切换时自动查询当前列表；同一期刊在一次刷新中只请求一次。
  var journalRankRequests = Object.create(null);
  var journalRankAutoRun = 0;
  function requestFolderJournalRank(paper) {
    if (!desktop || !desktop.getScigreatRank || !paper || !paper.venue) return Promise.resolve(null);
    var key = String(paper.venue).trim().toLowerCase();
    if (!key) return Promise.resolve(null);
    if (!journalRankRequests[key]) {
      journalRankRequests[key] = Promise.resolve()
        .then(function () { return desktop.getScigreatRank({ journal: paper.venue }); })
        .finally(function () { delete journalRankRequests[key]; });
    }
    return journalRankRequests[key].then(function (response) {
      var data = rankResultData(response);
      paper.journalRankCheckedAt = Date.now();
      paper.journalRank = journalRankFromData(data);
      return response;
    });
  }
  function refreshFolderJournalRanks(folderId) {
    if (!desktop || !desktop.getScigreatRank) return Promise.resolve();
    var run = ++journalRankAutoRun;
    var list = filteredPapers();
    var start = state.tablePage * TABLE_PAGE_SIZE;
    var papers = list.slice(start, start + TABLE_PAGE_SIZE).filter(function (paper) { return !!paper.venue; });
    if (!papers.length) return Promise.resolve();
    var groups = Object.create(null);
    var venueKeys = [];
    papers.forEach(function (paper) {
      var key = String(paper.venue).trim().toLowerCase();
      if (!groups[key]) { groups[key] = []; venueKeys.push(key); }
      groups[key].push(paper);
    });
    var changed = false;
    var cursor = 0;
    function updateGroup(group, source) {
      group.forEach(function (paper) {
        if (paper !== source && (paper.journalRank !== source.journalRank ||
            paper.journalRankCheckedAt !== source.journalRankCheckedAt)) changed = true;
        paper.journalRank = source.journalRank;
        paper.journalRankCheckedAt = source.journalRankCheckedAt;
        if (drawerId === paper.id) renderJournalRank(paper);
      });
      if (run === journalRankAutoRun && state.activeFolderId === folderId) renderTable();
    }
    function worker() {
      if (run !== journalRankAutoRun || state.activeFolderId !== folderId) return Promise.resolve();
      var key = venueKeys[cursor++];
      if (key == null) return Promise.resolve();
      var group = groups[key];
      var cached = group.find(function (paper) { return !shouldRefreshJournalRank(paper); });
      if (cached) {
        updateGroup(group, cached);
        return worker();
      }
      journalRankPending[key] = true;
      if (run === journalRankAutoRun && state.activeFolderId === folderId) renderTable();
      return requestFolderJournalRank(group[0]).then(function () {
        changed = true;
        delete journalRankPending[key];
        updateGroup(group, group[0]);
      }).catch(function () {
        delete journalRankPending[key];
        if (run === journalRankAutoRun && state.activeFolderId === folderId) renderTable();
        /* 自动刷新保持静默，保留已有缓存 */
      }).then(worker);
    }
    var workerCount = Math.min(3, venueKeys.length);
    var workers = [];
    for (var i = 0; i < workerCount; i++) workers.push(worker());
    return Promise.all(workers).then(function () {
      if (changed && run === journalRankAutoRun) save();
    });
  }
  var journalRankRefreshBusy = false;
  function refreshJournalRank(silent) {
    var paper = getById(drawerId);
    if (!paper || !paper.venue) return;
    if (!desktop || !desktop.getScigreatRank) { toast(T('期刊分区查询仅在桌面版可用')); return; }
    if (journalRankRefreshBusy) return;
    journalRankRefreshBusy = true;
    var button = $('#d-journal-rank-refresh');
    button.disabled = true;
    renderJournalRank(paper, T('正在查询期刊分区…'));
    desktop.getScigreatRank({ journal: paper.venue }).then(function (response) {
      var data = rankResultData(response);
      paper.journalRankCheckedAt = Date.now();
      if (!data) {
        paper.journalRank = null;
        save();
        renderTable();
        if (drawerId === paper.id) renderJournalRank(paper, T('未找到该期刊的分区信息'));
        return;
      }
      paper.journalRank = journalRankFromData(data);
      save();
      renderTable();
      if (drawerId === paper.id) renderJournalRank(paper);
    }).catch(function (error) {
      if (!silent && drawerId === paper.id) renderJournalRank(paper, error && error.message || String(error));
    }).finally(function () { journalRankRefreshBusy = false; button.disabled = false; });
  }

  /**
   * 仅补查"没有分区数据"的期刊，严格控制 API 访问次数：
   * - 已有分区数据的（=有分区标签）一律跳过，不重刷
   * - 近 7 天内已查过但仍无数据的也跳过（避免反复请求空结果）
   * - 同期刊只请求一次；串行 + 每批 600ms 间隔，避免服务商限流
   * 表头那颗圆圈按钮是开关：点一下开始，跑的时候再点一下暂停（队列与进度留着），
   * 再点继续。因此运行期间按钮**不能** disabled——否则第二次点击根本不会触发。
   */
  var rankRefreshRun = null;          // { venues, cursor, done, total, failed, paused }
  var rankRefreshInterval = 600;      // 串行批间隔：EasyScholar（≤2 次/秒）等契约下绝对安全

  function updateRankRefreshUi() {
    var run = rankRefreshRun;
    var stateName = !run ? 'idle' : (run.paused ? 'paused' : 'running');
    var button = $('#rank-refresh-all');
    if (button) {
      button.disabled = false;        // 运行中也必须可点：点一下就是暂停
      button.dataset.rankState = stateName;
      var label = stateName === 'running' ? T('正在补查期刊分区（点一下暂停）')
        : stateName === 'paused' ? T('分区补查已暂停（点一下继续）')
          : T('补查当前文件夹缺失的期刊分区');
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', stateName === 'running' ? 'true' : 'false');
      var icon = button.querySelector('use');
      if (icon) {
        icon.setAttribute('href', stateName === 'running' ? '#lb-i-pause'
          : (stateName === 'paused' ? '#lb-i-play' : '#lb-i-refresh'));
      }
    }
    var progress = $('#rank-refresh-progress');
    if (progress) {
      progress.hidden = !run;
      progress.classList.toggle('paused', stateName === 'paused');
      progress.textContent = run ? run.done + '/' + run.total : '';
    }
  }

  function delayThenRankRefresh(fn, ms) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(fn()); }, ms);
    });
  }

  function finishRankRefresh() {
    var run = rankRefreshRun;
    rankRefreshRun = null;
    journalRankFreezeOrder = null;
    updateRankRefreshUi();
    save();
    renderTable();
    if (!run) return;
    toast(run.failed
      ? T('当前文件夹分区补查完成：') + (run.total - run.failed) + T(' 成功，') + run.failed + T(' 无数据')
      : T('✓ 当前文件夹分区补查完成：') + run.total + T(' 个期刊'));
  }

  function pauseRankRefresh() {
    var run = rankRefreshRun;
    if (!run) return;
    run.paused = true;
    // 冻结只在跑的时候有意义：暂停后让表格回到常规排序，同时把已查到的结果落盘
    journalRankFreezeOrder = null;
    save();
    renderTable();
    updateRankRefreshUi();
    toast(T('已暂停分区补查：') + run.done + '/' + run.total + T('（再点一下继续）'));
  }

  function runRankRefreshStep() {
    var run = rankRefreshRun;
    if (!run || run.paused) return Promise.resolve();
    if (run.cursor >= run.venues.length) { finishRankRefresh(); return Promise.resolve(); }
    var entry = run.venues[run.cursor++];
    var key = entry.key;
    journalRankPending[key] = true;
    renderTable();
    return desktop.getScigreatRank({ journal: entry.venue }).then(function (response) {
      var data = rankResultData(response);
      var now = Date.now();
      state.papers.forEach(function (paper) {
        if (paper.deletedAt || !paper.venue) return;
        if (String(paper.venue).trim().toLowerCase() !== key) return;
        paper.journalRankCheckedAt = now;
        paper.journalRank = data ? journalRankFromData(data) : null;
      });
      if (!data) run.failed++;
    }).catch(function () { run.failed++; })
      .finally(function () {
        delete journalRankPending[key];
        run.done++;
        updateRankRefreshUi();
        renderTable();
        if (rankRefreshRun === run && run.paused) {
          save();                     // 暂停瞬间正在飞的那次请求也要落地，别随进程丢掉
        } else {
          toast(T('分区补查中 ') + run.done + '/' + run.total + (run.failed ? T('，失败 ') + run.failed : '') + '…', 1200);
        }
      })
      .then(function () { return delayThenRankRefresh(runRankRefreshStep, rankRefreshInterval); });
  }

  function refreshAllJournalRanks() {
    if (!desktop || !desktop.getScigreatRank) { toast(T('期刊分区查询仅在桌面版可用')); return Promise.resolve(); }
    if (rankRefreshRun) {
      // 已有任务：这一下是暂停；暂停中则是继续（队列接着跑，不重新扫描文件夹）
      if (rankRefreshRun.paused) {
        rankRefreshRun.paused = false;
        journalRankFreezeOrder = Array.prototype.map.call(
          document.querySelectorAll('#table-body tr.lit-row'), function (tr) { return tr.dataset.id; }
        );
        updateRankRefreshUi();
        toast(T('继续分区补查：') + rankRefreshRun.done + '/' + rankRefreshRun.total);
        return runRankRefreshStep();
      }
      pauseRankRefresh();
      return Promise.resolve();
    }
    var oneWeek = 7 * 24 * 60 * 60 * 1000;
    var seen = Object.create(null);
    var venues = [];
    // 只补查当前文件夹（当前视图）下没有分区数据的期刊，不做全库扫描
    filteredPapers().forEach(function (paper) {
      if (paper.deletedAt || !paper.venue) return;
      if (isArxivPaper(paper)) return;
      if (paper.journalRank) return;                     // 已有分区数据 → 不刷
      var checkedAt = Number(paper.journalRankCheckedAt) || 0;
      if (Date.now() - checkedAt < oneWeek) return;      // 近 7 天查过仍无数据 → 不刷
      var key = String(paper.venue).trim().toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      venues.push({ key: key, venue: paper.venue });
    });
    if (!venues.length) {
      toast(T('当前文件夹没有需要补查的期刊（已有分区数据或近 7 天查过）'));
      return Promise.resolve();
    }
    rankRefreshRun = { venues: venues, cursor: 0, done: 0, total: venues.length, failed: 0, paused: false };
    // 冻结当前显示顺序（按分区列排序时数据更新也不会让行跳位）
    journalRankFreezeOrder = Array.prototype.map.call(
      document.querySelectorAll('#table-body tr.lit-row'), function (tr) { return tr.dataset.id; }
    );
    updateRankRefreshUi();
    return runRankRefreshStep();
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
      glyphEl.className = 'import-folder-glyph' + (depth > 0 ? ' child' : '');
      glyphEl.setAttribute('aria-hidden', 'true');
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

  var backfillPdfFingerprintsRunning = false;
  function backfillPdfFingerprints() {
    if (!desktop || !window.LitPdf.fingerprint) return Promise.resolve();
    if (backfillPdfFingerprintsRunning) return Promise.resolve();
    backfillPdfFingerprintsRunning = true;
    var targets = [];
    state.papers.forEach(function (paper) {
      if (paper.deletedAt) return;
      (paper.attachments || []).forEach(function (att) {
        if (att && att.kind === 'pdf' && att.path && !att.fingerprint) targets.push({ paper: paper, attachment: att });
      });
    });
    var cursor = 0;
    function worker() {
      var target = targets[cursor++];
      if (!target) return Promise.resolve();
      return Promise.race([
        window.LitPdf.fingerprint(target.attachment.path),
        new Promise(function (resolve) { setTimeout(function () { resolve(''); }, 10000); })
      ]).then(function (fingerprint) {
        if (!fingerprint) return;
        target.attachment.fingerprint = fingerprint;
        window.LitModel.touch(target.paper);
        var norm = window.LitModel.normalizePaper(target.paper, uid);
        norm.id = target.paper.id;
        var idx = state.papers.indexOf(target.paper);
        if (idx !== -1) state.papers[idx] = norm;
      }).catch(function () { /* 文件已移动或缺失时仍可继续导入 */ }).then(worker);
    }
    return Promise.all([worker(), worker(), worker()]).then(function () {
      if (targets.length) save(true);
    }).finally(function () {
      backfillPdfFingerprintsRunning = false;
    });
  }
  function restoreJsonWorkspace(workspace) {
    applyWorkspaceState(workspace);
    resetActiveFolder();
    closeDrawer();
    renderAll();
    // 显式整库恢复：走 library:replace（保留“替换整个资料库”语义），普通编辑不影响
    if (desktop && desktop.replaceLibrary) {
      var payload = workspacePayload();
      desktop.replaceLibrary(payload).then(function () {
        persistedWorkspaceSignatures = window.LitModel.workspaceSignatures(workspacePayload());
        baseSnapshotEntities = cloneAllEntities(workspacePayload());
        toast(T('✓ 已从备份恢复 ') + state.papers.length + T(' 篇文献'));
      }).catch(function (e) {
        toast(T('⚠ 整库恢复失败：') + (e && e.message || e));
      });
    } else {
      save();
      toast(T('✓ 已从备份恢复 ') + state.papers.length + T(' 篇文献'));
    }
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

  /** 把解析出的 PDF 逐个拷进配置目录/synced-attachments（主进程按 z 键格式命名，原文件保留），再交给 addPapers。
   *  4 worker 并发拷贝：各条目只改自己附件对象的 path/fileName，互不依赖；与解析段（3 worker）同量级，不给主进程压队列 */
  function storeImportedPdfFiles(papers) {
    if (!desktop || !desktop.storePdf) return Promise.resolve();
    var tasks = [];
    papers.forEach(function (paper) {
      var att = primaryAttachment(paper);
      if (att && att.path && /\.pdf$/i.test(att.path)) tasks.push(att);
    });
    var cursor = 0;
    function worker() {
      var att = tasks[cursor++];
      if (!att) return Promise.resolve();
      return desktop.storePdf({ path: att.path }).then(function (result) {
        if (result && !result.error && !result.unchanged) {
          att.path = result.path;
          att.fileName = result.name;
        }
      }).catch(function () {}).then(worker);
    }
    return Promise.all([worker(), worker(), worker(), worker()]);
  }

  function importPdfFiles(files, folderId) {
    toast(T('正在解析 ') + files.length + T(' 个 PDF…'));
    var papers = [];
    var cursor = 0;
    // 3 个 worker 并行解析（指纹/前 2 页文本/联网补全），与 backfillPdfFingerprints 同级并发
    function worker() {
      var f = files[cursor++];
      if (!f) return Promise.resolve();
      // 单文件看门狗：联网补全最坏情况 = 3 源 × 15s 超时 + 解析，75s 兜底不卡死整批导入
      var watchdog = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error(T('解析超时（可能是网络请求挂起）'))); }, 75000);
      });
      return Promise.race([window.LitPdf.pdfToPaper(f), watchdog])
        .then(function (p) { papers.push(p); })
        .catch(function (err) {
          toast('⚠ ' + f.name + T(' 解析失败：') + (err && err.message || err));
        })
        .then(worker);
    }
    Promise.all([worker(), worker(), worker()]).then(function () {
      if (!papers.length) return;
      storeImportedPdfFiles(papers).then(function () {
        var r = addPapers(papers, { folderId: folderId });
        toast(T('✓ PDF 导入 ') + r.added + T(' 篇') + (r.merged ? T('，匹配已有 ') + r.merged + T(' 篇') : '') +
          (r.attached ? T('，其中 ') + r.attached + T(' 个 PDF 已挂到原条目') : '') +
          importFolderLabel(folderId) + mergedPdfLocationText(r.matches), r.matches.length ? 7000 : undefined);
        renderAll();
        if (desktop && desktop.getScigreatRank) refreshFolderJournalRanks(folderId);
        backfillPdfFingerprints().then(function () { renderAll(); });
      });
    });
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
    download('litboard-' + stamp() + '.bib', out);
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
    var template = (integrationConfig && integrationConfig.renameTemplate) ||
      (window.LitRename && window.LitRename.DEFAULT_TEMPLATE) || '{author} - {year} - {title}';
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
    var venueChanged = false;
    if (editingId) {
      var p = getById(editingId); if (!p) { $('#edit-mask').hidden = true; return; }
      var undoBefore = makeSnapshot({ papers: [p.id] });
      var venueBefore = String(p.venue || '').trim().toLowerCase();
      // creators/date 是权威字段，authors/year 是投影：用户改投影须同步权威，否则 normalize 会用旧权威值还原（F03）
      var authorsBefore = JSON.stringify(p.authors || []);
      var yearBefore = p.year != null ? p.year : null;
      Object.keys(data).forEach(function (k) { p[k] = data[k]; });
      if (JSON.stringify(data.authors) !== authorsBefore) {
        var preservedCreators = (p.creators || []).filter(function (c) { return c && c.creatorType !== 'author'; });
        var authorCreators = data.authors.map(function (a) {
          var c = window.LitModel.parseCreatorName(a);
          if (c) c.creatorType = 'author';
          return c;
        }).filter(Boolean);
        p.creators = preservedCreators.concat(authorCreators);
      }
      if (data.year !== yearBefore) {
        p.date = data.year != null ? String(data.year) : '';
      }
      // 期刊名变化 → 作废分区缓存并重查（旧数据已无意义）
      var venueAfter = String(p.venue || '').trim().toLowerCase();
      if (venueBefore !== venueAfter) {
        p.journalRank = null;
        p.journalRankCheckedAt = 0;
        venueChanged = true;
      }
      // citekey 被修改则钉住（防止自动重排）；与库内他人冲突时拒绝
      if (citekey && citekey !== p.key) {
        var conflict = state.papers.some(function (other) {
          return other.id !== p.id && String(other.key || '').toLowerCase() === citekey.toLowerCase();
        });
        if (conflict) { toast('citekey「' + citekey + T('」已被其他文献使用')); return; }
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
      $('#edit-mask').hidden = true;
      if (drawerId === editingId) openDrawer(editingId);
      toast(T('✓ 已保存'));
      if (venueChanged) refreshFolderJournalRanks(state.activeFolderId);
    } else {
      if (citekey) { data.key = citekey; data.keyPinned = true; }
      var r = addPapers([data]);
      $('#edit-mask').hidden = true;
      toast(r.added ? T('✓ 已新建文献') : T('与已有文献重复，已合并'));
      renderAll();
    }
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
    window.LitCite.formats.forEach(function (fmt) {
      var text = fmt.fn(paper);
      var item = document.createElement('div');
      item.className = 'cite-item';
      var head = document.createElement('div');
      head.className = 'cite-item-head';
      var label = document.createElement('span');
      label.className = 'cite-item-label';
      label.textContent = fmt.label;
      var copy = document.createElement('button');
      copy.className = 'cite-copy';
      copy.textContent = T('复制');
      copy.addEventListener('click', function () {
        copyToClipboard(text).then(function () { toast(T('✓ 已复制 ') + fmt.label); });
      });
      head.appendChild(label); head.appendChild(copy);
      var body = document.createElement('div');
      body.className = 'cite-text';
      body.textContent = text;
      item.appendChild(head); item.appendChild(body);
      wrap.appendChild(item);
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
    renderer: 'auto',
    selectedText: '', selectionPositions: [], annotationColor: '#ffd400', translationRequest: 0,
    renderToken: 0, searchResults: [], searchMatches: [], searchIndex: -1,
    snapshotMode: false, inkMode: false,
    reflowMode: false, reflowFont: 13, reflowPages: {}, reflowNextPage: 1, reflowBusy: false, reflowMarks: [], reflowEpoch: 0
  };
  var pdfTabs = [];              // [{ paper, attachment, page, scale, layout, rotation, scrollTop }]
  var pdfThumbsObserver = null;

  function persistReadPos(paperId) {
    if (!desktop || !desktop.setSetting || !pdfState.paper || pdfState.paper.id !== paperId) return;
    var attachmentId = pdfState.attachmentId || '';
    desktop.setSetting('readpos:' + paperId + ':' + attachmentId, {
      attachmentId: attachmentId,
      page: pdfState.currentPage || 1,
      scale: pdfState.scale,
      layout: pdfState.layout,
      rotation: pdfState.rotation,
      renderer: pdfState.renderer,
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
    var tab = pdfTabs.find(function (t) { return t.paper.id === pdfState.paper.id; });
    if (tab) {
      tab.page = pdfState.currentPage;
      tab.attachment = pdfState.attachment;
      tab.scale = pdfState.scale;
      tab.layout = pdfState.layout;
      tab.rotation = pdfState.rotation;
      tab.renderer = pdfState.renderer;
      tab.scrollTop = $('#pdf-scroll').scrollTop || 0;
    }
  }

  function goToLibraryTab() {
    saveReadPos.flush();
    stashPdfTab();
    if (!$('#epub-overlay').hidden) { stashEpubTab(); persistEpubReadPos.flush(); }
    hidePdfTranslation();
    setPdfPageLocked(false);
    $('#pdf-overlay').hidden = true;
    $('#epub-overlay').hidden = true;
    ttsStop();
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
    // 第一个标签固定为「资料库」
    var libChip = document.createElement('span');
    libChip.className = 'pdf-tab' + ((pdfActive || epubActive) ? '' : ' active');
    var libTitle = document.createElement('button');
    libTitle.type = 'button';
    libTitle.className = 'pdf-tab-title';
    libTitle.title = T('返回资料库');
    libTitle.textContent = T('▤ 资料库');
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
    setPdfPageLocked(true);
    resetPdfReflow();
    if (!$('#epub-overlay').hidden) { stashEpubTab(); persistEpubReadPos.flush(); epubTtsStop(); hideEpubSelPopover(); $('#epub-overlay').hidden = true; }
    $('#pdf-overlay').hidden = false;
    if (pdfState.handle) { pdfState.handle.cancel(); pdfState.handle = null; }
    pdfState.paper = tab.paper;
    pdfState.attachment = tab.attachment || pdfAttachment(tab.paper, '');
    pdfState.attachmentId = pdfState.attachment ? pdfState.attachment.id : '';
    pdfState.currentPage = tab.page || 1;
    pdfState.scale = tab.scale || 1.35;
    pdfState.layout = tab.layout || 'single';
    pdfState.rotation = tab.rotation || 0;
    pdfState.renderer = tab.renderer === 'pdfjs' || tab.renderer === 'pdfium' ? tab.renderer : 'auto';
    pdfState.searchResults = [];
    pdfState.searchMatches = [];
    pdfState.searchIndex = -1;
    pdfState.snapshotMode = false;
    pdfState.inkMode = false;
    $('#pdf-snapshot-toggle').setAttribute('aria-pressed', 'false');
    $('#pdf-ink-toggle').setAttribute('aria-pressed', 'false');
    $('#pdf-title').textContent = (tab.paper.title || tab.paper.pdfFileName || 'PDF') +
      (pdfState.attachment && pdfState.attachment.fileName ? ' · ' + pdfState.attachment.fileName : '');
    recordPaperRead(tab.paper);
    refreshAgentChips(); // R19：切标签 = 换了正在读的文献
    renderPdfAnnotations();
    renderPdfNoteEditor();
    renderPdfViewer();
    renderPdfTabs();
    if (tab.scrollTop) {
      pdfState.handle.promise.then(function () {
        if (tab.scrollTop) $('#pdf-scroll').scrollTop = tab.scrollTop;
      }).catch(function () {});
    }
  }

  function switchPdfTab(key) {
    if (!$('#pdf-overlay').hidden && pdfState.paper && pdfState.attachmentId &&
        pdfState.paper.id + ':' + pdfState.attachmentId === key) return;
    stashPdfTab();
    var tab = pdfTabs.find(function (t) { return t.key === key; });
    if (tab) activatePdfTab(tab);
  }

  function hidePdfOverlay() {
    savePdfAnnotationComment.flush();
    resetPdfReflow();
    if (pdfState.handle) { pdfState.handle.cancel(); pdfState.handle = null; }
    if (pdfThumbsObserver) { pdfThumbsObserver.disconnect(); pdfThumbsObserver = null; }
    $('#pdf-scroll').innerHTML = '';
    $('#pdf-outline').innerHTML = '';
    $('#pdf-thumbs').innerHTML = '';
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
    var attachment = pdfAttachment(paper, attachmentId);
    if (!desktop || !attachment || !attachment.path) { toast(T('没有可阅读的本地 PDF 附件')); return; }
    var tabKey = paper.id + ':' + attachment.id;
    if (!$('#pdf-overlay').hidden && pdfState.paper && pdfState.paper.id + ':' + pdfState.attachmentId === tabKey) return;
    if (!$('#pdf-overlay').hidden) stashPdfTab();
    $('#pdf-overlay').hidden = false;
    recordPaperRead(paper);
    var tab = pdfTabs.find(function (t) { return t.key === tabKey; });
    if (tab) { activatePdfTab(tab); return; }
    if (pdfTabs.length >= 8) { toast(T('最多同时打开 8 个 PDF')); return; }
    tab = { key: tabKey, paper: paper, attachment: attachment };
    pdfTabs.push(tab);
    if (desktop.getSetting) {
      desktop.getSetting('readpos:' + paper.id + ':' + attachment.id).then(function (pos) {
        if (!pos) return desktop.getSetting('readpos:' + paper.id);
        return pos;
      }).then(function (pos) {
        if (pos && pdfTabs.indexOf(tab) !== -1) {
          tab.page = pos.page || 1;
          tab.scale = pos.scale || 1.35;
          tab.layout = pos.layout || 'single';
          tab.rotation = pos.rotation || 0;
          tab.renderer = pos.renderer === 'pdfjs' || pos.renderer === 'pdfium' ? pos.renderer : 'auto';
          tab.scrollTop = pos.scrollTop || 0;
        }
        activatePdfTab(tab);
      }).catch(function () { activatePdfTab(tab); });
    } else {
      activatePdfTab(tab);
    }
  }

  var savePdfAnnotationComment = debounce(function () { save(); }, 600);
  var runPdfSearch = debounce(function () { performPdfSearch(false); }, 350);
  var pdfWheelZoomSteps = 0;
  var pdfSelectionFrame = 0;
  var applyPdfWheelZoom = debounce(function () {
    var steps = pdfWheelZoomSteps;
    pdfWheelZoomSteps = 0;
    if (steps) zoomPdf(steps * 0.1);
  }, 80);
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
    ocrBusy = true;
    var banner = $('#pdf-ocr-banner');
    var textEl = $('#pdf-ocr-banner-text');
    banner.hidden = false;
    textEl.textContent = T('OCR 准备中（首次需下载约 15MB 语言包）…');
    window.LitOcr.ensureData().then(function (status) {
      return window.LitOcr.ocrPages(pageIndexes, status.dir, function (pageIndex) {
        return doc.getPage(pageIndex + 1).then(function (page) {
          var viewport = page.getViewport({ scale: 2 });
          var canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise
            .then(function () { return canvas; });
        });
      }, function (progress) {
        textEl.textContent = T('OCR 识别中 ') + progress.done + '/' + progress.total + T('（第 ') + progress.page + T(' 页）…');
      });
    }).then(function (result) {
      var pages = result && result.pages || {};
      if (!Object.keys(pages).length) return null;
      return desktop.pdfSearchGetPages(paper.id, pdfState.attachmentId).then(function (existing) {
        var merged = Array.isArray(existing) ? existing.slice() : [];
        Object.keys(pages).forEach(function (idx) { merged[Number(idx)] = pages[idx]; });
        return desktop.pdfSearchPut({
          paperId: paper.id,
          attachmentId: pdfState.attachmentId,
          fingerprint: pdfState.attachment && pdfState.attachment.fingerprint || paper.pdfFingerprint || '',
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
  function renderPdfOutline(doc) {
    var wrap = $('#pdf-outline');
    wrap.innerHTML = '';
    if (!doc) return;
    doc.getOutline().then(function (outline) {
      if (!outline || !outline.length) {
        wrap.innerHTML = T('<div class="pdf-side-empty">本文档没有大纲</div>');
        return;
      }
      function addItems(items, depth) {
        items.forEach(function (item) {
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'pdf-outline-item';
          row.style.paddingLeft = (10 + depth * 14) + 'px';
          row.title = item.title || '';
          row.textContent = item.title || T('(未命名)');
          row.addEventListener('click', function () {
            var destPromise = typeof item.dest === 'string'
              ? doc.getDestination(item.dest)
              : Promise.resolve(item.dest);
            Promise.resolve(destPromise).then(function (dest) {
              if (!dest || !dest[0]) return;
              return doc.getPageIndex(dest[0]).then(function (index) { goToPdfPage(index + 1); });
            }).catch(function () {});
          });
          wrap.appendChild(row);
          if (item.items && item.items.length) addItems(item.items, depth + 1);
        });
      }
      addItems(outline, 0);
    }).catch(function () {
      wrap.innerHTML = T('<div class="pdf-side-empty">大纲读取失败</div>');
    });
  }

  function markPdfThumb(page) {
    $all('#pdf-thumbs .pdf-thumb').forEach(function (el) {
      el.classList.toggle('active', Number(el.dataset.page) === page);
    });
  }

  function renderPdfThumbs(doc) {
    var wrap = $('#pdf-thumbs');
    wrap.innerHTML = '';
    if (pdfThumbsObserver) { pdfThumbsObserver.disconnect(); pdfThumbsObserver = null; }
    if (!doc) return;
    var pages = doc.numPages;
    for (var p = 1; p <= pages; p++) {
      (function (pageNum) {
        var item = document.createElement('div');
        item.className = 'pdf-thumb';
        item.dataset.page = pageNum;
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
          var viewport = page.getViewport({ scale: 1 });
          var scale = 96 / viewport.width;
          var thumbViewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.ceil(thumbViewport.width);
          canvas.height = Math.ceil(thumbViewport.height);
          var holder = item.querySelector('.pdf-thumb-canvas-wrap');
          holder.innerHTML = '';
          holder.appendChild(canvas);
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: thumbViewport }).promise;
        }).catch(function () {});
      });
    }, { root: wrap, rootMargin: '200px 0px' });
    Array.prototype.forEach.call(wrap.children, function (child) { pdfThumbsObserver.observe(child); });
    markPdfThumb(pdfState.currentPage || 1);
  }

  function togglePdfSide(tab) {
    var side = $('#pdf-side');
    var show = !side.hidden && side.dataset.tab === tab ? false : true;
    side.hidden = !show;
    side.dataset.tab = tab;
    $('#pdf-side-toggle').setAttribute('aria-pressed', show ? 'true' : 'false');
    $('#pdf-side-tab-outline').classList.toggle('active', tab === 'outline');
    $('#pdf-side-tab-thumbs').classList.toggle('active', tab === 'thumbs');
    $('#pdf-outline').hidden = tab !== 'outline';
    $('#pdf-thumbs').hidden = tab !== 'thumbs';
    if (show && pdfState.handle && pdfState.handle.doc) {
      if (tab === 'outline' && !$('#pdf-outline').childNodes.length) renderPdfOutline(pdfState.handle.doc);
      if (tab === 'thumbs' && !$('#pdf-thumbs').childNodes.length) renderPdfThumbs(pdfState.handle.doc);
    }
  }

  // ---------- 区域截图 / 手写 ----------
  function captureSnapshot(sheet, rectClient) {
    var canvas = sheet.querySelector('canvas');
    var viewport = sheet._litViewport;
    if (!canvas || !viewport) { toast(T('页面尚未渲染完成，稍后再试')); return; }
    var bounds = sheet.getBoundingClientRect();
    var x = Math.max(0, rectClient.left - bounds.left);
    var y = Math.max(0, rectClient.top - bounds.top);
    var w = Math.min(rectClient.width, bounds.width - x);
    var h = Math.min(rectClient.height, bounds.height - y);
    if (w < 8 || h < 8) { toast(T('选区太小')); return; }
    // 画布像素与 CSS 尺寸的比例
    var ratio = canvas.width / bounds.width;
    var crop = document.createElement('canvas');
    crop.width = Math.round(w * ratio);
    crop.height = Math.round(h * ratio);
    crop.getContext('2d').drawImage(canvas,
      Math.round(x * ratio), Math.round(y * ratio), crop.width, crop.height,
      0, 0, crop.width, crop.height);
    var a = viewport.convertToPdfPoint(x, y);
    var b = viewport.convertToPdfPoint(x + w, y + h);
    var pdfRect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    var dataUrl = crop.toDataURL('image/png');
    var name = 'snap-' + Date.now();
    desktop.saveAnnotationImage({ name: name, dataUrl: dataUrl }).then(function (result) {
      if (!result || result.error) { toast(T('⚠ 截图保存失败：') + (result && result.error || '')); return; }
      var now = Date.now();
      var annotation = {
        id: annotationUid(), type: 'snapshot', color: pdfState.annotationColor,
        attachmentId: pdfState.attachmentId,
        text: T('区域截图'), comment: '', imagePath: result.path,
        position: { pageIndex: Number(sheet.dataset.page) - 1, rects: [pdfRect] },
        createdAt: now, updatedAt: now
      };
      pdfState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(
        (pdfState.paper.pdfAnnotations || []).concat([annotation]));
      syncViewerAnnotations();
      save();
      renderPdfAnnotations(annotation.id);
      toast(T('✓ 已保存区域截图批注'));
    }).catch(function (e) { toast(T('⚠ 截图保存失败：') + (e && e.message || e)); });
  }

  function startSnapshotDrag(e) {
    var sheet = e.target.closest('.pdf-page-sheet');
    if (!sheet) return;
    e.preventDefault();
    var scroll = $('#pdf-scroll');
    var startX = e.clientX, startY = e.clientY;
    var marker = document.createElement('div');
    marker.className = 'pdf-snapshot-rect';
    scroll.appendChild(marker);
    function place(ev) {
      var rect = {
        left: Math.min(startX, ev.clientX), top: Math.min(startY, ev.clientY),
        width: Math.abs(ev.clientX - startX), height: Math.abs(ev.clientY - startY)
      };
      var scrollBounds = scroll.getBoundingClientRect();
      marker.style.left = (rect.left - scrollBounds.left + scroll.scrollLeft) + 'px';
      marker.style.top = (rect.top - scrollBounds.top + scroll.scrollTop) + 'px';
      marker.style.width = rect.width + 'px';
      marker.style.height = rect.height + 'px';
      marker.dataset.rect = JSON.stringify(rect);
    }
    place(e);
    function onMove(ev) { place(ev); }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      var rect = JSON.parse(marker.dataset.rect || 'null');
      marker.remove();
      toggleSnapshotMode(false);
      if (rect && rect.width >= 8 && rect.height >= 8) captureSnapshot(sheet, rect);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function toggleSnapshotMode(force) {
    if (pdfState.reflowMode) { toast(T('重排模式下不可用截图批注')); return; }
    pdfState.snapshotMode = typeof force === 'boolean' ? force : !pdfState.snapshotMode;
    if (pdfState.snapshotMode) toggleInkMode(false);
    $('#pdf-snapshot-toggle').setAttribute('aria-pressed', pdfState.snapshotMode ? 'true' : 'false');
    $('#pdf-scroll').classList.toggle('snapshot-mode', pdfState.snapshotMode);
  }

  function startInkStroke(e) {
    var sheet = e.target.closest('.pdf-page-sheet');
    if (!sheet || !sheet._litViewport) return;
    e.preventDefault();
    var bounds = sheet.getBoundingClientRect();
    var canvas = document.createElement('canvas');
    canvas.className = 'pdf-ink-overlay';
    canvas.width = Math.round(bounds.width);
    canvas.height = Math.round(bounds.height);
    canvas.style.width = bounds.width + 'px';
    canvas.style.height = bounds.height + 'px';
    sheet.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.strokeStyle = pdfState.annotationColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var points = [];
    function addPoint(ev) {
      var x = ev.clientX - bounds.left, y = ev.clientY - bounds.top;
      points.push([x, y]);
      if (points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(points[points.length - 2][0], points[points.length - 2][1]);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    addPoint(e);
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    function onMove(ev) { addPoint(ev); }
    function onUp() {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      if (points.length < 3) { canvas.remove(); return; }
      var viewport = sheet._litViewport;
      var pdfPoints = points.map(function (pt) { return viewport.convertToPdfPoint(pt[0], pt[1]); });
      var xs = pdfPoints.map(function (p) { return p[0]; });
      var ys = pdfPoints.map(function (p) { return p[1]; });
      var now = Date.now();
      var annotation = {
        id: annotationUid(), type: 'ink', color: pdfState.annotationColor,
        attachmentId: pdfState.attachmentId,
        text: T('手写批注'), comment: '',
        position: {
          pageIndex: Number(sheet.dataset.page) - 1,
          rects: [[Math.min.apply(null, xs), Math.min.apply(null, ys),
            Math.max.apply(null, xs), Math.max.apply(null, ys)]],
          points: pdfPoints
        },
        createdAt: now, updatedAt: now
      };
      pdfState.paper.pdfAnnotations = window.LitModel.normalizePdfAnnotations(
        (pdfState.paper.pdfAnnotations || []).concat([annotation]));
      canvas.remove(); // 由批注层统一重绘
      syncViewerAnnotations();
      save();
      renderPdfAnnotations(annotation.id);
    }
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  function toggleInkMode(force) {
    if (pdfState.reflowMode) { toast(T('重排模式下不可用手写批注')); return; }
    pdfState.inkMode = typeof force === 'boolean' ? force : !pdfState.inkMode;
    if (pdfState.inkMode) toggleSnapshotMode(false);
    $('#pdf-ink-toggle').setAttribute('aria-pressed', pdfState.inkMode ? 'true' : 'false');
    $('#pdf-scroll').classList.toggle('ink-mode', pdfState.inkMode);
  }

  function updatePdfViewUi() {
    $('#pdf-zoom').textContent = Math.round(pdfState.scale * 100) + '%';
    $('#pdf-layout-toggle').setAttribute('aria-pressed', pdfState.layout === 'spread' ? 'true' : 'false');
    $('#pdf-layout-toggle').title = pdfState.layout === 'spread' ? T('切换为单栏阅读') : T('切换为双栏阅读');
    var rendererButton = $('#pdf-renderer-toggle');
    rendererButton.textContent = pdfState.renderer === 'auto' ? T('自动渲染') : (pdfState.renderer === 'pdfium' ? 'PDFium' : 'PDF.js');
    rendererButton.title = T('切换 PDF 渲染器') + (pdfState.handle && pdfState.handle.renderer
      ? ' · ' + T('当前：') + pdfState.handle.renderer : '');
  }

  function togglePdfRenderer() {
    var modes = ['auto', 'pdfium', 'pdfjs'];
    pdfState.renderer = modes[(modes.indexOf(pdfState.renderer) + 1) % modes.length];
    var tab = pdfTabs.find(function (item) {
      return item.key === (pdfState.paper && pdfState.paper.id + ':' + pdfState.attachmentId);
    });
    if (tab) tab.renderer = pdfState.renderer;
    renderPdfViewer();
    saveReadPos();
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
      renderer: pdfState.renderer,
      textLayer: true,
      annotations: annotationsForAttachment(pdfState.paper, attachment),
      onPageChange: updatePdfPageUi,
      onSheetRendered: onPdfSheetRendered,
      onAnnotationClick: focusPdfAnnotation
    });
    pdfState.handle.promise.then(function (doc) {
      if (token !== pdfState.renderToken || !doc) return;
      updatePdfPageUi(Math.min(targetPage, doc.numPages), doc.numPages);
      updatePdfViewUi();
      if (targetPage > 1) pdfState.handle.goToPage(targetPage);
      if ($('#pdf-search').value.trim()) performPdfSearch(true);
      maybeImportPdfAnnotations(pdfState.paper, doc, pdfState.attachment);
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

  function focusPdfAnnotation(annotationId) {
    if (!pdfState.paper) return;
    var annotation = annotationsForAttachment(pdfState.paper, pdfState.attachment).find(function (item) { return item.id === annotationId; });
    if (!annotation) return;
    if (pdfState.handle) pdfState.handle.goToPage(annotation.position.pageIndex + 1);
    renderPdfAnnotations(annotationId);
    var item = $('#pdf-annotation-list [data-annotation-id="' + annotationId + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  /* ---- 阅读器侧栏笔记编辑器（阶段三）：目标笔记选择/新建、Markdown 编辑+预览、来源更新提示 ---- */
  var pdfNoteCurrentId = '';
  var savePdfNoteSide = debounce(function () { save(); }, 500);

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

  function currentPdfNote() {
    if (!pdfState.paper) return null;
    var note = pdfNoteCurrentId ? findNote(pdfNoteCurrentId) : null;
    // 本篇笔记必须属于当前文献；主题笔记（paperId=''）跨文献保持
    if (note && (note.paperId === pdfState.paper.id || !note.paperId)) return note;
    var own = notesForPaper(pdfState.paper.id);
    return own.length ? own[0] : (topicNotes()[0] || null);
  }

  function renderPdfNoteEditor() {
    var editor = $('#pdf-note-editor');
    if (!pdfState.paper) { editor.hidden = true; return; }
    editor.hidden = false;
    var note = currentPdfNote();
    pdfNoteCurrentId = note ? note.id : '';
    fillNoteSelect($('#pdf-note-select'), pdfState.paper.id, pdfNoteCurrentId);
    var ta = $('#pdf-note-textarea');
    ta.value = note ? note.content : '';
    ta.disabled = !note;
    setPdfNoteMode($('#pdf-note-preview-tab').classList.contains('active') ? 'preview' : 'edit');
    renderPdfNoteStale();
  }

  function setPdfNoteMode(mode) {
    var preview = mode === 'preview';
    $('#pdf-note-textarea').hidden = preview;
    $('#pdf-note-preview').hidden = !preview;
    $('#pdf-note-edit-tab').classList.toggle('active', !preview);
    $('#pdf-note-preview-tab').classList.toggle('active', preview);
    if (preview) {
      var note = currentPdfNote();
      if (!note || !note.content.trim()) {
        $('#pdf-note-preview').innerHTML = T('<p class="d-abstract none">暂无内容</p>');
      } else if (note.format === 'richtext' && window.LitNoteMl) {
        $('#pdf-note-preview').innerHTML = window.LitNoteMl.sanitizeHtml(note.content);
      } else {
        $('#pdf-note-preview').innerHTML = window.LitMarkdown.render(note.content);
      }
    }
  }

  function renderPdfNoteStale() {
    var box = $('#pdf-note-stale');
    var note = currentPdfNote();
    if (!note) { box.hidden = true; box.innerHTML = ''; return; }
    var items;
    if (note.format === 'richtext' && window.LitNoteMl) {
      items = window.LitNoteMl.parseExcerptBlocks(note.content).map(function (block) {
        var found = findAnnotationAnywhere(block.annotationId, block.paperId, block.attachmentId);
        if (!found) return { status: 'deleted', annotationId: block.annotationId, preview: block.quoteText };
        if (block.sourceUpdatedAt != null && Number(found.annotation.updatedAt) !== Number(block.sourceUpdatedAt)) {
          return { status: 'changed', annotationId: block.annotationId, preview: block.quoteText, current: found.annotation };
        }
        return { status: 'fresh', annotationId: block.annotationId, preview: block.quoteText };
      }).filter(function (item) { return item.status !== 'fresh'; });
    } else if (window.LitExcerpt) {
      items = window.LitExcerpt.staleExcerpts(note.content, function (annotationId, excerpt) {
        var found = findAnnotationAnywhere(annotationId, excerpt && excerpt.paperId, excerpt && excerpt.attachmentId);
        return found ? found.annotation : null;
      }).filter(function (item) { return item.status !== 'fresh'; })
        .map(function (item) {
          return { status: item.status, annotationId: item.excerpt.annotationId, preview: item.excerpt.quote, current: item.current || null };
        });
    } else {
      box.hidden = true; box.innerHTML = ''; return;
    }
    box.innerHTML = '';
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false;
    items.slice(0, 10).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'pdf-note-stale-item';
      var badge = document.createElement('span');
      badge.className = 'pdf-note-stale-badge' + (item.status === 'deleted' ? ' deleted' : '');
      badge.textContent = item.status === 'deleted' ? T('来源已删除') : T('来源已更新');
      row.appendChild(badge);
      var quote = document.createElement('span');
      quote.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      quote.textContent = (item.preview || '').split('\n')[0].slice(0, 40);
      row.appendChild(quote);
      var mkBtn = function (label, action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost btn-xs';
        btn.dataset.staleAction = action;
        btn.dataset.annotationId = item.annotationId;
        btn.textContent = label;
        return btn;
      };
      if (item.status === 'changed') {
        row.appendChild(mkBtn(T('采用更新'), 'adopt'));
        row.appendChild(mkBtn(T('保留'), 'keep'));
      } else {
        row.appendChild(mkBtn(T('移除摘录'), 'remove'));
      }
      box.appendChild(row);
    });
  }

  function handleStaleAction(action, annotationId) {
    var note = currentPdfNote();
    if (!note) return;
    if (note.format === 'richtext' && window.LitNoteMl) {
      var richTarget = window.LitNoteMl.parseExcerptBlocks(note.content).find(function (block) {
        return block.annotationId === annotationId;
      });
      var found = richTarget ? findAnnotationAnywhere(annotationId, richTarget.paperId, richTarget.attachmentId) : null;
      if (action === 'adopt' && found) {
        note.content = window.LitNoteMl.replaceExcerptBlock(note.content, annotationId, {
          quoteText: annotationQuote(found.annotation),
          commentText: found.annotation.comment || '',
          sourceUpdatedAt: found.annotation.updatedAt
        });
        toast(T('✓ 已采用来源更新'));
      } else if (action === 'keep' && found) {
        note.content = window.LitNoteMl.markExcerptBlockCurrent(note.content, annotationId, found.annotation.updatedAt);
      } else if (action === 'remove') {
        note.content = window.LitNoteMl.removeExcerptBlock(note.content, annotationId);
      } else return;
      window.LitModel.touch(note);
      save();
      $('#pdf-note-textarea').value = note.content;
      renderPdfNoteStale();
      if (!$('#pdf-note-preview').hidden) setPdfNoteMode('preview');
      return;
    }
    if (!window.LitExcerpt) return;
    var target = window.LitExcerpt.parseExcerpts(note.content)
      .find(function (x) { return x.annotationId === annotationId; });
    if (!target) return;
    var foundMarkdown = findAnnotationAnywhere(annotationId, target.paperId, target.attachmentId);
    if (action === 'adopt' && foundMarkdown) {
      note.content = window.LitExcerpt.replaceExcerpt(note.content, target, {
        quote: annotationQuote(foundMarkdown.annotation),
        comment: foundMarkdown.annotation.comment || '',
        sourceUpdatedAt: foundMarkdown.annotation.updatedAt
      });
      toast(T('✓ 已采用来源更新'));
    } else if (action === 'keep' && foundMarkdown) {
      note.content = window.LitExcerpt.markExcerptCurrent(note.content, target, foundMarkdown.annotation);
    } else if (action === 'remove') {
      note.content = window.LitExcerpt.removeExcerpt(note.content, target);
    } else return;
    window.LitModel.touch(note);
    save();
    $('#pdf-note-textarea').value = note.content;
    renderPdfNoteStale();
    if (!$('#pdf-note-preview').hidden) setPdfNoteMode('preview');
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
    fillNoteSelect($('#excerpt-target'), paper.id, pdfNoteCurrentId);
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
      epubNoteCurrentId = note.id;
      $('#excerpt-mask').hidden = true;
      excerptDlg = null;
      renderEpubNoteEditor();
    } else {
      pdfNoteCurrentId = note.id;
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

  /* ---- 笔记导出 Word（阶段三下半）：文本/图片混排 + 摘录块与引用节点 → 可刷新引文域 ---- */
  function exportNoteToWord(note) {
    if (!desktop) { toast(T('导出 Word 需要桌面版')); return; }
    if (!note) { toast(T('请先选择或新建一篇笔记')); return; }
    if (!window.LitDocx || !window.LitCslDoc || !window.LitNoteMl || !window.LitCsl || !window.LitExcerpt) {
      toast(T('导出模块未加载')); return;
    }
    var html = note.format === 'richtext'
      ? window.LitNoteMl.sanitizeHtml(note.content)
      : window.LitNoteMl.markdownToHtml(note.content);
    var md = window.LitNoteMl.htmlToMarkdown(html);
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
      fetch('vendor/citeproc/locales/zh-CN.xml').then(function (r) { return r.text(); }),
      desktop.getDataPaths()
    ]).then(function (values) {
      return buildNoteDocx(md, {
        styleXml: values[0], localeXml: values[1], styleId: styleId,
        configDir: values[2] && values[2].configDir || ''
      });
    }).then(function (bytes) {
      return desktop.saveFile({
        name: 'litboard-note-' + stamp() + '.docx',
        bytes: bytes,
        filters: [{ name: T('Word 文档'), extensions: ['docx'] }]
      });
    }).then(function (saved) {
      if (saved) toast(T('✓ 笔记已导出为 Word'));
    }).catch(function (error) {
      toast(T('⚠ 导出失败：') + (error && error.message || error));
    });
  }

  function buildNoteDocx(md, env) {
    var doc = window.LitCslDoc.createDocument({
      styleXml: env.styleXml, localeXml: env.localeXml, styleId: env.styleId, localeId: 'zh-CN'
    });
    // 预读图片字节（note-assets 相对路径）
    var rels = [];
    md.replace(/!\[[^\]]*\]\((note-assets\/[^)\s]+)\)/g, function (_, rel) { rels.push(rel); return _; });
    var uniqueRels = rels.filter(function (rel, index) { return rels.indexOf(rel) === index; });
    var imageMap = {};
    return doc.updateLibrary(state.papers.filter(function (p) { return !p.deletedAt; }))
      .then(function () {
        return Promise.all(uniqueRels.map(function (rel) {
          if (!env.configDir) return Promise.resolve(null);
          var abs = env.configDir.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\');
          var readBytes = desktop && (desktop.readFileBytes || desktop.readBytes);
          if (!readBytes) return Promise.resolve(null);
          return readBytes.call(desktop, abs).then(function (bytes) {
            var ext = (rel.match(/\.[a-z0-9]{1,8}$/i) || ['.png'])[0].toLowerCase();
            imageMap[rel] = { data: bytes, ext: ext };
          }).catch(function () {});
        }));
      })
      .then(function () {
        // 块级切分：lbex 摘录块与正文交错
        var spans = window.LitExcerpt.parseExcerpts(md);
        var segments = [];
        var pos = 0;
        spans.forEach(function (span) {
          if (span.start > pos) segments.push({ type: 'text', md: md.slice(pos, span.start) });
          segments.push({ type: 'excerpt', span: span });
          pos = span.end;
        });
        if (pos < md.length) segments.push({ type: 'text', md: md.slice(pos) });
        // 顺序执行：每个引用节点一次 addCitation
        var paragraphs = [];
        var chain = Promise.resolve();
        function pushCitationRun(paperId, extras, fallbackText) {
          return doc.addCitation({ items: [Object.assign({ paperId: paperId }, extras || {})] })
            .then(function (result) {
              var cluster = doc.toJSON().citations.filter(function (c) { return c.id === result.citationId; })[0];
              paragraphs.push({ runs: [{ citation: { payload: cluster, text: result.text } }] });
            })
            .catch(function () {
              paragraphs.push({ text: fallbackText || (T('（未找到文献 ') + paperId + '）') });
            });
        }
        segments.forEach(function (segment) {
          if (segment.type === 'excerpt') {
            chain = chain.then(function () {
              if (!getById(segment.span.paperId)) {
                paragraphs.push({ text: segment.span.quote || T('（来源文献不在库中）') });
                return;
              }
              return pushCitationRun(segment.span.paperId, {}, segment.span.quote);
            });
            return;
          }
          mdSegmentToParagraphs(segment.md).forEach(function (para) {
            chain = chain.then(function () {
              var runChain = Promise.resolve();
              var runs = [];
              para.parts.forEach(function (part) {
                runChain = runChain.then(function () {
                  if (part.text != null) {
                    runs.push(part.bold ? { text: part.text, bold: true } : { text: part.text });
                  } else if (part.imageRel) {
                    if (imageMap[part.imageRel]) runs.push({ image: imageMap[part.imageRel] });
                  } else if (part.cite) {
                    return pushCitationRunInto(runs, part.cite);
                  }
                });
              });
              return runChain.then(function () {
                if (runs.length) paragraphs.push({ runs: runs });
              });
            });
          });
        });
        function pushCitationRunInto(runs, cite) {
          if (!getById(cite.paperId)) {
            runs.push({ text: cite.label || (T('（未找到文献 ') + cite.paperId + '）') });
            return Promise.resolve();
          }
          return doc.addCitation({ items: [{
            paperId: cite.paperId,
            locator: cite.locator || '',
            label: cite.labelParam || '',
            prefix: cite.prefix || '',
            suffix: cite.suffix || '',
            suppressAuthor: !!cite.suppressAuthor
          }] }).then(function (result) {
            var cluster = doc.toJSON().citations.filter(function (c) { return c.id === result.citationId; })[0];
            runs.push({ citation: { payload: cluster, runs: window.LitCsl.htmlToRuns(result.text) } });
          }).catch(function () {
            runs.push({ text: cite.label || cite.paperId });
          });
        }
        return chain.then(function () {
          if (doc.citationCount() > 0) {
            paragraphs.push({ runs: [{ text: T('参考文献'), bold: true }] });
            var bibFormat = doc.getBibliographyFormat();
            doc.getBibliography().forEach(function (entry) {
              paragraphs.push(Object.assign({ runs: window.LitCsl.htmlToRuns(entry) }, bibFormat));
            });
          }
          return window.LitDocx.buildDocx(paragraphs);
        });
      });
  }

  /** markdown 文本段 → 段落计划（纯文本/图片/引用链接拆 run；标题加粗） */
  function mdSegmentToParagraphs(md) {
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var buffer = [];
    function flush() {
      if (!buffer.length) return;
      var raw = buffer.join('\n');
      buffer = [];
      out.push({ parts: inlineMdParts(raw) });
    }
    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) { flush(); return; }
      if (/^```/.test(trimmed)) { flush(); return; }
      var heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flush();
        out.push({ parts: [{ text: heading[2], bold: true }] });
        return;
      }
      var imageOnly = trimmed.match(/^!\[[^\]]*\]\((note-assets\/[^)\s]+)\)$/);
      if (imageOnly) {
        flush();
        out.push({ parts: [{ imageRel: imageOnly[1] }] });
        return;
      }
      buffer.push(trimmed.replace(/^[-*+]\s+|^\d+[.)]\s+/, ''));
    });
    flush();
    return out;
  }

  var CITE_LINK_RE = /\[([^\]]+)\]\(litboard:\/\/open\/paper\/([A-Za-z0-9_-]{1,120})(?:\?([^\s)]+))?\)/g;
  function inlineMdParts(raw) {
    var parts = [];
    var last = 0;
    var match;
    CITE_LINK_RE.lastIndex = 0;
    while ((match = CITE_LINK_RE.exec(raw))) {
      if (match.index > last) parts.push({ text: raw.slice(last, match.index) });
      var params = {};
      if (match[3]) {
        match[3].split('&').forEach(function (pair) {
          var kv = pair.split('=');
          try { params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); } catch (e) {}
        });
      }
      parts.push({
        cite: {
          paperId: match[2],
          label: match[1],
          locator: params.locator || '',
          labelParam: params.label || '',
          prefix: params.prefix || '',
          suffix: params.suffix || '',
          suppressAuthor: params.suppressAuthor === '1'
        }
      });
      last = match.index + match[0].length;
    }
    if (last < raw.length) parts.push({ text: raw.slice(last) });
    // 清掉残留 md 记号（加粗等）
    parts.forEach(function (part) {
      if (part.text != null) {
        part.text = part.text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[`*_]/g, '').trim();
        if (!part.text) part.text = '';
      }
    });
    return parts.filter(function (part) { return part.text == null || part.text !== ''; });
  }

  /* ---- Word 写作（COM 自动化；协议见 word/wordbridge.js 头部注释） ---- */
  function b64utf8(s) {
    var bytes = new TextEncoder().encode(String(s == null ? '' : s));
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function unb64(s) {
    var bin = atob(String(s || ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function wordFail(error) {
    $('#word-status').textContent = '⚠ ' + (error && error.message || String(error));
    toast('⚠ Word：' + (error && error.message || error));
  }
  function wordDetect() {
    if (!desktop || !desktop.wordInvoke) { wordFail(new Error(T('当前版本不支持 Word 集成'))); return; }
    $('#word-status').textContent = T('正在连接 Word…');
    desktop.wordInvoke({ line: 'INFO', timeout: 20000 }).then(function (rest) {
      var parts = String(rest || '').split('|');
      var version = parts[0] ? unb64(parts[0]) : '';
      var names = (parts[2] || '').split(';').filter(Boolean).map(unb64);
      var select = $('#word-doc-select');
      select.innerHTML = '';
      names.forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.split(/[\\/]/).pop();
        select.appendChild(opt);
      });
      if (!names.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = T('（Word 中没有打开的文档）');
        select.appendChild(empty);
      }
      $('#word-status').textContent = version
        ? T('已连接 Word ') + version + T('，打开文档 ') + names.length + T(' 个。') +
          T('插入引文前请把光标放到目标位置；引文格式跟随 LitBoard 当前 CSL 样式。')
        : T('未检测到正在运行的 Microsoft Word；请打开 Word 与目标文档后重新点击「检测 Word」。');
      wordSyncStyleSelect();
    }).catch(wordFail);
  }
  function wordTargetPath() {
    var path = $('#word-doc-select').value;
    if (!path) throw new Error(T('请先在 Word 中打开一个文档并重新检测'));
    return path;
  }
  function wordParseFieldsPayloads(codes) {
    // 域指令 → CitationCluster payload（与 docx.readDocxFields 同一契约）
    return codes.map(function (code) {
      var m = /^\s*ADDIN\s+LitBoard\.Citation\.1\s+"([\s\S]*)"\s*$/.exec(String(code || '').trim());
      if (!m) return null;
      try { return JSON.parse(m[1]); } catch (e) { return null; }
    }).filter(Boolean);
  }
  function wordCurrentStyle(documentId) {
    var styleMap = {};
    try { styleMap = JSON.parse(localStorage.getItem('litboard.wordStyles') || '{}') || {}; } catch (e) {}
    var styleId = styleMap[documentId] || localStorage.getItem('litboard.cslStyle') || 'apa';
    var localePromise = fetch('vendor/citeproc/locales/zh-CN.xml').then(function (r) { return r.text(); });
    var custom = wordCustomStyles()[styleId];
    if (custom) {
      return localePromise.then(function (localeXml) {
        return { styleXml: custom.xml, localeXml: localeXml, styleId: styleId };
      });
    }
    var isBuiltin = window.LitCsl.BUILTIN_STYLES.some(function (s) { return s.id === styleId; });
    var stylePromise = isBuiltin
      ? fetch('vendor/citeproc/styles/' + styleId + '.csl').then(function (r) {
          if (!r.ok) throw new Error(T('样式文件缺失'));
          return r.text();
        })
      : desktop.fetchCslStyle(styleId);
    return Promise.all([stylePromise, localePromise])
      .then(function (texts) { return { styleXml: texts[0], localeXml: texts[1], styleId: styleId }; });
  }
  /** 从文档现有域重建 csldoc 会话（统一刷新/参考文献表/插入的渲染口径） */
  function wordBuildSession(payloads, documentId) {
    return wordCurrentStyle(documentId).then(function (env) {
      var doc = window.LitCslDoc.createDocument({ styleXml: env.styleXml, localeXml: env.localeXml, styleId: env.styleId, localeId: 'zh-CN' });
      return doc.updateLibrary(state.papers.filter(function (p) { return !p.deletedAt; })).then(function () {
        return doc.restore(payloads).then(function () { return doc; });
      });
    });
  }
  /* Word 的域结果只认纯文本：citeproc 的 HTML 得先转成 RTF（上标/斜体/小型大写才真正生效），
     再包成最小 RTF 文档交给桥用 InsertFile 读进域——桥按 '{\rtf' 前缀识别，纯文本回退不受影响。 */
  function wordRtfDocument(html) { return '{\\rtf ' + window.LitCsl.htmlToRtf(html) + '}'; }
  /* 参考文献条目：转成 RTF 片段后逐条交给桥（桥负责 \par 连接与外层包装） */
  function wordRtfEntries(entries) {
    return (entries || []).map(function (entry) { return b64utf8(window.LitCsl.htmlToRtf(entry)); });
  }
  /* 参考文献段落格式负载：'rtf,indent,firstLineIndent,entrySpacing,lineSpacing,tabStops'
     （twips；行距是倍数：1 = 单倍，不设时不发送） */
  function wordBibliographyFormatSpec(session) {
    var format = session.getBibliographyFormat();
    return ['rtf', format.indent, format.firstLineIndent, format.entrySpacing, format.lineSpacing, format.tabStops.join('+')].join(',');
  }
  function wordRefresh() {
    try { wordTargetPath(); } catch (e) { wordFail(e); return; }
    var path = $('#word-doc-select').value;
    $('#word-status').textContent = T('正在读取文档引文域…');
    desktop.wordInvoke({ line: 'FIELDS|' + b64utf8(path) })
      .then(function (rest) {
        var parts = String(rest).split('|');
        var fields = (parts[1] || '').split(';').filter(Boolean).map(function (item) {
          var pair = item.split('~');
          return { code: unb64(pair[0] || ''), text: unb64(pair[1] || '') };
        });
        if (!fields.length) { toast(T('该文档没有 LitBoard 引文域')); $('#word-status').textContent = T('文档中没有 LitBoard 引文域。'); return; }
        var payloads = wordParseFieldsPayloads(fields.map(function (f) { return f.code; }));
        return wordBuildSession(payloads, path).then(function (session) {
          var clusters = session.toJSON().citations;
          var texts = clusters.map(function (c) { return b64utf8(wordRtfDocument(session.getCitationText(c.id))); });
          // 快照回写：会话已用库内最新文献刷新 cslItem，同时更新域内嵌快照（F10）
          var codes = clusters.map(function (c) { return b64utf8(JSON.stringify({ version: 1, items: c.items })); });
          // 参考文献条目按 rtf 片段原样传递（剥标签会连 \tab/\super 一起毁掉）；
          // 段落格式由会话按 CSL 样式算出，桥负责落到 Word 段落格式
          var bib = wordRtfEntries(session.getBibliography());
          var line = 'APPLY|' + b64utf8(path) + '|' + texts.join(';') + '|' + bib.join(';') + '|' + codes.join(';') +
            '|' + wordBibliographyFormatSpec(session);
          return desktop.wordInvoke({ line: line, timeout: 60000 }).then(function () {
            var missing = session.missingItemIds();
            $('#word-status').textContent = T('✓ 已刷新 ') + clusters.length + T(' 个引文') +
              (bib.length ? T('，参考文献表 ') + bib.length + T(' 条') : '') +
              (missing.length ? T('；有 ') + missing.length + T(' 条文献不在库中（按文档内快照渲染）') : '');
            toast(T('✓ Word 引文已刷新'));
          });
        });
      }).catch(wordFail);
  }
  /* Word 引文插入：文献多选弹窗（勾选顺序即同一处引文的合并顺序） */
  var wordCiteChosen = {};
  var wordCiteHayCache = null;
  /* 检索 haystack：标题 + 年份 + 作者的多种形态（姓/名分列、姓名倒序、「王, 小明」→「王小明」去分隔形态），
     走 normalizeForSearch 折叠大小写/变音符/全半角；按 paperId 缓存，弹窗打开时重置 */
  function wordCiteHaystack(p) {
    if (!wordCiteHayCache) wordCiteHayCache = {};
    var hit = wordCiteHayCache[p.id];
    if (hit != null) return hit;
    var parts = [String(p.title || ''), String(p.year == null ? '' : p.year)];
    (p.authors || []).forEach(function (a) {
      var n = window.LitCite && LitCite._splitName ? LitCite._splitName(a) : { family: String(a || ''), given: '' };
      var fam = String(n.family || ''), giv = String(n.given || '');
      parts.push(String(a || ''), fam, giv, giv + ' ' + fam, String(a || '').replace(/[,\s，]+/g, ''));
    });
    hit = normHit(parts.join(' '));
    wordCiteHayCache[p.id] = hit;
    return hit;
  }
  function wordCiteUpdateCount() {
    $('#word-cite-count').textContent = T('已选 ') + Object.keys(wordCiteChosen).length + T(' 篇');
  }
  function renderWordCiteList() {
    var query = normHit(String($('#word-cite-search').value || '').trim());
    var tokens = query ? query.split(/\s+/).filter(Boolean) : [];
    var box = $('#word-cite-list');
    box.innerHTML = '';
    state.papers.forEach(function (p) {
      if (p.deletedAt) return;
      if (tokens.length && !tokens.every(function (t) { return wordCiteHaystack(p).indexOf(t) !== -1; })) return;
      var label = (p.authors && p.authors.length ? String(p.authors[0]).split(',')[0] : T('匿名')) +
        (p.year ? ', ' + p.year : '') + ' · ' + String(p.title || '').slice(0, 60);
      var row = document.createElement('div');
      row.className = 'excerpt-item wordcite-row' + (wordCiteChosen[p.id] ? ' wordcite-row-on' : '');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!wordCiteChosen[p.id];
      var quote = document.createElement('span');
      quote.className = 'excerpt-item-quote';
      quote.textContent = label;
      row.appendChild(checkbox);
      row.appendChild(quote);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) wordCiteChosen[p.id] = true;
        else delete wordCiteChosen[p.id];
        row.classList.toggle('wordcite-row-on', checkbox.checked);
        wordCiteUpdateCount();
      });
      row.addEventListener('click', function () {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
      box.appendChild(row);
    });
    wordCiteUpdateCount();
  }
  function wordInsertCitation() {
    try { wordTargetPath(); } catch (e) { wordFail(e); return; }
    var live = state.papers.filter(function (p) { return !p.deletedAt; });
    if (!live.length) { toast(T('文献库为空')); return; }
    wordCiteChosen = {};
    wordCiteHayCache = null;
    $('#word-cite-search').value = '';
    renderWordCiteList();
    $('#word-cite-mask').hidden = false;
  }
  function wordInsertCitationConfirm() {
    var targetPath;
    try { targetPath = wordTargetPath(); } catch (e) { wordFail(e); return; }
    var items = state.papers.filter(function (p) { return !p.deletedAt && wordCiteChosen[p.id]; })
      .map(function (p) { return { paperId: p.id }; });
    if (!items.length) { toast(T('请先勾选要引用的文献')); return; }
    $('#word-cite-mask').hidden = true;
    $('#word-status').textContent = T('正在渲染引文…');
    var payload = { version: 1, items: items };
    wordBuildSession([payload], targetPath).then(function (session) {
      var cluster = session.toJSON().citations[0];
      var text = wordRtfDocument(session.getCitationText(cluster.id));
      return desktop.wordInvoke({ command: 'INSERT', documentId: targetPath,
        args: { payload: JSON.stringify(cluster), text: text }, timeout: 30000 })
        .then(function () {
          $('#word-status').textContent = T('已插入 ') + items.length + T(' 条，正在按全文顺序重算引文编号…');
          wordRefresh(); // 插入后立即按文档序重算（数字制编号与既有引文顺序一致，F10）
          toast(T('✓ 已插入引文（') + items.length + T(' 篇）'));
        });
    }).catch(wordFail);
  }
  /* 引文格式：内置 CSL 样式；按目标文档记忆（litboard.wordStyles），未选文档时改全局默认。
   * 支持导入本地 .csl 自定义样式（localStorage 存 XML，key 前缀 custom-）。 */
  function wordStyleMap() {
    try { return JSON.parse(localStorage.getItem('litboard.wordStyles') || '{}') || {}; } catch (e) { return {}; }
  }
  function wordCustomStyles() {
    try { return JSON.parse(localStorage.getItem('litboard.customCslStyles') || '{}') || {}; } catch (e) { return {}; }
  }
  function wordImportCustomStyle() {
    if (!desktop || !desktop.chooseFiles || !desktop.readFileBytes) { wordFail(new Error(T('当前版本不支持导入'))); return; }
    desktop.chooseFiles({ title: T('选择 CSL 样式文件（.csl）') }).then(function (files) {
      if (!files || !files[0]) return;
      return desktop.readFileBytes(files[0]).then(function (bytes) {
        var xml = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        if (!/<style[\s>]/.test(xml)) throw new Error(T('不是有效的 CSL 样式文件'));
        var m = /<title>([^<]+)<\/title>/.exec(xml);
        var title = (m ? m[1] : '').trim() || files[0].split(/[\\/]/).pop().replace(/\.csl$/i, '');
        var map = wordCustomStyles();
        var key = 'custom-' + Date.now().toString(36);
        var count = Object.keys(map).filter(function (k) { return map[k].title === title; }).length;
        if (count) key = Object.keys(map).find(function (k) { return map[k].title === title; }); // 同名重导入覆盖
        map[key] = { title: title, xml: xml };
        try { localStorage.setItem('litboard.customCslStyles', JSON.stringify(map)); }
        catch (e) { throw new Error(T('样式过大或本地存储已满，无法保存')); }
        wordInitStyleSelect();
        var sel = $('#word-style-select');
        sel.value = key;
        sel.dispatchEvent(new Event('change'));
        $('#word-status').textContent = T('✓ 已导入样式「') + title + T('」，新插入引文立即生效。');
        toast(T('✓ 已导入 CSL 样式：') + title);
      });
    }).catch(wordFail);
  }
  function wordSyncStyleSelect() {
    var path = $('#word-doc-select').value;
    var styleId = (path ? wordStyleMap()[path] : null) || localStorage.getItem('litboard.cslStyle') || 'apa';
    var sel = $('#word-style-select');
    var known = Array.prototype.some.call(sel.options, function (o) { return o.value === styleId; });
    sel.value = known ? styleId : 'apa';
    $('#word-style-hint').textContent = path ? T('格式跟随当前目标文档保存。') : '';
  }
  function wordInitStyleSelect() {
    var sel = $('#word-style-select');
    sel.innerHTML = '';
    window.LitCsl.BUILTIN_STYLES.forEach(function (style) {
      var opt = document.createElement('option');
      opt.value = style.id;
      opt.textContent = style.label;
      sel.appendChild(opt);
    });
    var customs = wordCustomStyles();
    Object.keys(customs).forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = (customs[key].title || key) + T('（自定义）');
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      var path = $('#word-doc-select').value;
      if (path) {
        var map = wordStyleMap();
        map[path] = sel.value;
        localStorage.setItem('litboard.wordStyles', JSON.stringify(map));
        $('#word-style-hint').textContent = T('已切换（仅此文档）；已有引文点「刷新引文与参考文献表」按新格式重排。');
      } else {
        localStorage.setItem('litboard.cslStyle', sel.value);
        $('#word-style-hint').textContent = T('未选目标文档，已设为全局默认引文格式。');
      }
    });
    wordSyncStyleSelect();
  }
  function wordBibliography() {
    try { wordTargetPath(); } catch (e) { wordFail(e); return; }
    var path = $('#word-doc-select').value;
    desktop.wordInvoke({ line: 'FIELDS|' + b64utf8(path) })
      .then(function (rest) {
        var parts = String(rest).split('|');
        var payloads = wordParseFieldsPayloads((parts[1] || '').split(';').filter(Boolean).map(function (item) { return unb64(item.split('~')[0] || ''); }));
        return wordBuildSession(payloads, path).then(function (session) {
          var bib = wordRtfEntries(session.getBibliography());
          if (!bib.length) { toast(T('没有可引用的文献（先插入引文）')); return; }
          return desktop.wordInvoke({ command: 'BIB', documentId: path, args: { entries: bib.join(';'), format: wordBibliographyFormatSpec(session) }, timeout: 30000 }).then(function () {
            toast(T('✓ 已插入参考文献表（') + bib.length + T(' 条）'));
          });
        });
      }).catch(wordFail);
  }
  function wordUnlink() {
    try { wordTargetPath(); } catch (e) { wordFail(e); return; }
    var path = $('#word-doc-select').value;
    dlgPrompt(T('副本文件名'), T('例如 manuscript-plain.docx（保存在原文档同目录）'), 'manuscript-plain.docx').then(function (name) {
      if (name == null) return;
      name = String(name).trim();
      if (!/\.docx$/i.test(name)) name += '.docx';
      var dir = path.replace(/[\\/][^\\/]*$/, '');
      var newPath = dir + '\\' + name.replace(/[\\/:*?"<>|]/g, '_');
      return desktop.wordInvoke({ line: 'UNLINKCOPY|' + b64utf8(path) + '|' + b64utf8(newPath), timeout: 30000 })
        .then(function () {
          $('#word-status').textContent = T('✓ 已生成解除关联副本：') + newPath;
          toast(T('✓ 已生成解除关联副本（原件未改动）'));
          wordDetect();
        });
    }).catch(wordFail);
  }
  function wordConvertZotero() {
    if (!desktop || !desktop.wordZoteroConvertRead) { wordFail(new Error(T('当前版本不支持转换'))); return; }
    desktop.chooseFiles({ filters: [{ name: T('Word 文档'), extensions: ['docx'] }] }).then(function (files) {
      if (!files || !files[0]) return;
      var source = files[0];
      return desktop.wordZoteroConvertRead(source).then(function (fields) {
        var keyToId = {};
        state.papers.forEach(function (p) { if (p.zoteroKey) keyToId[p.zoteroKey] = p.id; });
        var converted = window.LitDocx.convertZoteroFields(fields, {
          resolveKey: function (key) { return keyToId[key] || null; }
        });
        var r = converted.report;
        var message = T('共识别 Zotero 引文 ') + r.citations + T(' 处：匹配库内文献 ') + r.matched +
          T('，未匹配 ') + r.unmatched + T('（保留嵌入快照，仍可读可刷新）。') +
          (r.missingKeys.length ? T('\n未匹配：') + r.missingKeys.slice(0, 10).join('、') : '');
        return dlgConfirm(T('转换 Zotero 引文'), message, T('生成 LitBoard 副本')).then(function (ok) {
          if (!ok) return;
          return dlgPrompt(T('副本文件名'), T('例如 manuscript-litboard.docx（保存在原文档同目录）'), 'manuscript-litboard.docx').then(function (name) {
            if (name == null) return;
            name = String(name).trim();
            if (!/\.docx$/i.test(name)) name += '.docx';
            var dir = source.replace(/[\\/][^\\/]*$/, '');
            var target = dir + '\\' + name.replace(/[\\/:*?"<>|]/g, '_');
            return desktop.wordZoteroConvertWrite({ source: source, target: target, fields: converted.fields })
              .then(function () {
                toast(T('✓ 已生成转换副本：') + target + T('（原件未改动）'));
                $('#word-status').textContent = T('✓ Zotero 引文转换完成：') + target;
              });
          });
        });
      });
    }).catch(wordFail);
  }

  $('#word-detect').addEventListener('click', wordDetect);
  $('#word-insert-citation').addEventListener('click', wordInsertCitation);
  $('#word-refresh').addEventListener('click', wordRefresh);
  $('#word-bibliography').addEventListener('click', wordBibliography);
  $('#word-unlink').addEventListener('click', wordUnlink);
  $('#word-convert-zotero').addEventListener('click', wordConvertZotero);
  $('#word-cite-search').addEventListener('input', renderWordCiteList);
  $('#word-cite-cancel').addEventListener('click', function () { $('#word-cite-mask').hidden = true; });
  $('#word-cite-confirm').addEventListener('click', wordInsertCitationConfirm);
  $('#word-doc-select').addEventListener('change', wordSyncStyleSelect);
  $('#word-style-import').addEventListener('click', wordImportCustomStyle);
  wordInitStyleSelect();

  /* ---- 可视化查询构建器（阶段四余项；生成文本与搜索框共享同一求值逻辑） ---- */
  var qbRows = [];
  var QB_KINDS = [['field', T('字段')], ['flag', T('具备')], ['missing', T('缺失字段')], ['text', T('关键词')], ['ann', T('批注组')], ['note', T('笔记组')], ['attachment', T('附件组')], ['count', T('数量比较')]];
  var QB_FIELDS = ['title', 'author', 'venue', 'tag', 'type', 'status', 'year', 'citations', 'rating', 'doi', 'key', 'notes', 'abstract', 'folderid', 'lastread', 'annotations', 'attachments'];
  var QB_FIELD_LABELS = { title: T('标题'), author: T('作者'), venue: T('期刊/会议'), tag: T('标签'), type: T('类型'), status: T('状态'),
    year: T('年份'), citations: T('被引次数'), rating: T('评分'), doi: 'DOI', key: T('引用键'), notes: T('笔记'), abstract: T('摘要'),
    folderid: T('文件夹 ID'), lastread: T('最近阅读'), annotations: T('批注数'), attachments: T('附件数') };
  var QB_FLAGS = ['pdf', 'notes', 'annotations', 'epub', 'snapshot', 'doi', 'abstract', 'unread', 'reading', 'read'];

  function openQueryBuilder() {
    qbRows = [{ join: 'AND', kind: 'field', field: 'title', cmp: ':', value: '' }];
    $('#query-builder-mask').hidden = false;
    renderQbRows();
  }
  function renderQbRows() {
    var box = $('#qb-rows');
    box.innerHTML = '';
    qbRows.forEach(function (row, index) {
      var div = document.createElement('div');
      div.className = 'qb-row';
      var join = document.createElement('select');
      join.className = 'qb-join';
      join.innerHTML = T('<option value="AND">且</option><option value="OR">或</option>');
      join.value = row.join || 'AND';
      join.hidden = index === 0;
      join.addEventListener('change', function () { row.join = join.value; updateQbPreview(); });
      div.appendChild(join);
      var kind = document.createElement('select');
      kind.className = 'qb-kind';
      kind.innerHTML = QB_KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('');
      kind.value = row.kind;
      div.appendChild(kind);
      var dynamic = document.createElement('span');
      dynamic.style.cssText = 'display:flex;gap:6px;flex:1;align-items:center';
      function valueInput(placeholder) {
        var input = document.createElement('input');
        input.className = 'qb-value';
        input.value = row.value || '';
        input.placeholder = placeholder || '';
        input.addEventListener('input', function () { row.value = input.value; updateQbPreview(); });
        return input;
      }
      function rebuild() {
        dynamic.innerHTML = '';
        if (row.kind === 'field') {
          var field = document.createElement('select');
          field.className = 'qb-field';
           field.innerHTML = QB_FIELDS.map(function (f) { return '<option value="' + f + '">' + (QB_FIELD_LABELS[f] || f) + '</option>'; }).join('');
          field.value = row.field || 'title';
          field.addEventListener('change', function () { row.field = field.value; updateQbPreview(); });
          dynamic.appendChild(field);
          var cmp = document.createElement('select');
          cmp.className = 'qb-cmp';
          cmp.innerHTML = T('<option value=":">包含</option><option value="=">等于</option><option value=">=">≥</option><option value="<=">≤</option><option value=">">&gt;</option><option value="<">&lt;</option>');
          cmp.value = row.cmp || ':';
          cmp.addEventListener('change', function () { row.cmp = cmp.value; updateQbPreview(); });
          dynamic.appendChild(cmp);
          dynamic.appendChild(valueInput(T('匹配值')));
        } else if (row.kind === 'flag') {
          var flag = document.createElement('select');
          flag.className = 'qb-field';
          flag.innerHTML = QB_FLAGS.map(function (f) { return '<option value="' + f + '">' + f + '</option>'; }).join('');
          flag.value = row.value || 'pdf';
          row.value = flag.value;
          flag.addEventListener('change', function () { row.value = flag.value; updateQbPreview(); });
          dynamic.appendChild(flag);
        } else if (row.kind === 'missing') {
          var mf = document.createElement('select');
          mf.className = 'qb-field';
           mf.innerHTML = QB_FIELDS.map(function (f) { return '<option value="' + f + '">' + (QB_FIELD_LABELS[f] || f) + '</option>'; }).join('');
          mf.value = row.field || 'doi';
          row.field = mf.value;
          mf.addEventListener('change', function () { row.field = mf.value; updateQbPreview(); });
          dynamic.appendChild(mf);
        } else if (row.kind === 'ann' || row.kind === 'note') {
           dynamic.appendChild(valueInput(T('组内条件，如 "量子" color:#ffd400（须同一对象满足）')));
        } else if (row.kind === 'attachment') {
          dynamic.appendChild(valueInput(T('组内条件，如 kind:pdf 或 name:"supp"')));
        } else if (row.kind === 'count') {
          var countField = document.createElement('select');
          countField.className = 'qb-field';
          countField.innerHTML = T('<option value="annotations">批注</option><option value="notes">笔记</option><option value="attachments">附件</option>');
          countField.value = row.field || 'annotations'; row.field = countField.value;
          countField.addEventListener('change', function () { row.field = countField.value; updateQbPreview(); });
          dynamic.appendChild(countField);
          var countCmp = document.createElement('select');
          countCmp.className = 'qb-cmp';
          countCmp.innerHTML = '<option value=">=">≥</option><option value="=">=</option><option value=">">&gt;</option><option value="<=">≤</option><option value="<">&lt;</option>';
          countCmp.value = row.cmp || '>=';
          countCmp.addEventListener('change', function () { row.cmp = countCmp.value; updateQbPreview(); });
          dynamic.appendChild(countCmp);
          dynamic.appendChild(valueInput(T('数量')));
        } else {
          dynamic.appendChild(valueInput(T('关键词')));
        }
      }
      kind.addEventListener('change', function () {
        row.kind = kind.value;
        row.value = ''; row.field = 'title'; row.cmp = ':';
        rebuild(); updateQbPreview();
      });
      rebuild();
      div.appendChild(dynamic);
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-ghost btn-xs';
      del.textContent = '×';
      del.title = T('删除条件');
      del.addEventListener('click', function () { qbRows.splice(index, 1); renderQbRows(); });
      div.appendChild(del);
      box.appendChild(div);
    });
    updateQbPreview();
  }
  function updateQbPreview() {
    var text = window.LitQuery ? window.LitQuery.rowsToText(qbRows) : '';
    var preview = $('#qb-preview');
    preview.textContent = text || T('（无条件）');
    preview.classList.remove('error');
    if (text && window.LitQuery) {
      var parsed = window.LitQuery.parseAst(text);
      if (parsed.error) { preview.textContent += T(' —— 语法错误：') + parsed.error; preview.classList.add('error'); }
    }
  }

  /* ---- 批量字段编辑（阶段四余项：展示不同值 / 明确清空 / 预览影响条目） ---- */
  var bulkEditPapers = [];
  function bulkEditCurrentValue(paper, field) {
    if (field === 'tags') return (paper.tags || []).join(', ');
    if (field === 'authors') return (paper.authors || []).join(', ');
    var v = paper[field];
    return v == null ? '' : String(v);
  }
  function openBulkEdit(papers) {
    bulkEditPapers = papers.filter(function (p) { return !p.deletedAt; });
    if (!bulkEditPapers.length) { toast(T('请先选择文献')); return; }
    $('#bulk-edit-summary').textContent = T('已选 ') + bulkEditPapers.length + T(' 篇文献。选择字段并输入新值；「明确清空」会把该字段置空。');
    $('#bulk-edit-value').value = '';
    $('#bulk-edit-clear').checked = false;
    $('#bulk-edit-mask').hidden = false;
    updateBulkEditView();
  }
  function updateBulkEditView() {
    var field = $('#bulk-edit-field').value;
    var counts = {}, order = [];
    bulkEditPapers.forEach(function (p) {
      var v = bulkEditCurrentValue(p, field) || T('（空）');
      if (!counts[v]) { counts[v] = 0; order.push(v); }
      counts[v]++;
    });
    $('#bulk-edit-distinct').innerHTML = T('<span class="field-hint">当前不同值：</span>') +
      order.slice(0, 12).map(function (v) {
        return '<span class="distinct-item">' + esc(v.length > 30 ? v.slice(0, 30) + '…' : v) + ' ×' + counts[v] + '</span>';
      }).join('') + (order.length > 12 ? '<span class="field-hint">…</span>' : '');
    updateBulkEditPreview();
  }
  function updateBulkEditPreview() {
    var field = $('#bulk-edit-field').value;
    var clear = $('#bulk-edit-clear').checked;
    var value = $('#bulk-edit-value').value.trim();
    if (!clear && !value) { $('#bulk-edit-preview').textContent = T('输入新值后可预览影响条目数。'); return; }
    var affected = bulkEditPapers.filter(function (p) {
      return bulkEditCurrentValue(p, field) !== (clear ? '' : value);
    }).length;
    $('#bulk-edit-preview').textContent = T('将影响 ') + affected + ' / ' + bulkEditPapers.length + T(' 篇') + (clear ? T('（清空 ') + field + '）' : '');
  }
  function confirmBulkEdit() {
    var field = $('#bulk-edit-field').value;
    var clear = $('#bulk-edit-clear').checked;
    var value = $('#bulk-edit-value').value.trim();
    if (!clear && !value) { toast(T('请输入新值或勾选「明确清空」')); return; }
    var changed = 0;
    var undoBefore = makeSnapshot({ papers: bulkEditPapers.map(function (p) { return p.id; }) });
    bulkEditPapers.forEach(function (p) {
      var next = clear ? '' : value;
      if (bulkEditCurrentValue(p, field) === next) return;
      if (field === 'status') {
        if (['unread', 'reading', 'read'].indexOf(next) === -1 && !clear) return;
        p.status = clear ? 'unread' : next;
      } else if (field === 'rating') {
        var r = clear ? 0 : Number(next);
        if (!Number.isFinite(r) || r < 0 || r > 5) return;
        p.rating = Math.trunc(r);
      } else if (field === 'year') {
        var y = clear ? null : Number(next);
        p.year = y != null && Number.isFinite(y) && y >= 1000 && y <= 3000 ? Math.trunc(y) : null;
        if (!clear && p.year == null) return;
        p.date = p.year != null ? String(p.year) : '';
      } else if (field === 'tags') {
        p.tags = clear ? [] : window.LitModel.cleanTags(next.split(/[,，]/));
      } else if (field === 'authors') {
        var preservedCreators = (p.creators || []).filter(function (creator) { return creator.creatorType !== 'author'; });
        var authorCreators = clear ? [] : next.split(/\r?\n/).map(function (line) {
          return window.LitModel.parseCreatorName(line.trim());
        }).filter(Boolean);
        authorCreators.forEach(function (creator) { creator.creatorType = 'author'; });
        p.creators = preservedCreators.concat(authorCreators);
        var norm = window.LitModel.normalizePaper(p);
        norm.id = p.id;
        Object.keys(p).forEach(function (k) { delete p[k]; });
        Object.assign(p, norm);
      } else {
        if (!clear && ['title', 'venue', 'doi', 'abstract', 'language'].indexOf(field) === -1) return;
        p[field] = next;
      }
      window.LitModel.touch(p);
      changed++;
    });
    commitUndo(T('批量编辑') + field, undoBefore, { papers: bulkEditPapers.map(function (p) { return p.id; }) });
    save(); renderAll();
    $('#bulk-edit-mask').hidden = true;
    toast(T('✓ 批量编辑完成：') + changed + T(' 篇已更新'));
  }

  $('#btn-query-builder').addEventListener('click', openQueryBuilder);
  $('#qb-add-row').addEventListener('click', function () {
    qbRows.push({ join: 'AND', kind: 'field', field: 'title', cmp: ':', value: '' });
    renderQbRows();
  });
  $('#qb-cancel').addEventListener('click', function () { $('#query-builder-mask').hidden = true; });
  $('#qb-apply').addEventListener('click', function () {
    var text = window.LitQuery ? window.LitQuery.rowsToText(qbRows) : '';
    if (text) {
      var parsed = window.LitQuery.parseAst(text);
      if (parsed.error) { toast(T('语法错误：') + parsed.error); return; }
    }
    $('#search').value = text;
    state.filters.q = text;
    state.tablePage = 0;
    $('#query-builder-mask').hidden = true;
    renderAll();
  });
  $('#bulk-edit-cancel').addEventListener('click', function () { $('#bulk-edit-mask').hidden = true; });
  $('#bulk-edit-confirm').addEventListener('click', confirmBulkEdit);
  $('#bulk-edit-field').addEventListener('change', updateBulkEditView);
  $('#bulk-edit-value').addEventListener('input', updateBulkEditPreview);
  $('#bulk-edit-clear').addEventListener('change', updateBulkEditPreview);

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
  var ttsState = { sentences: [], index: 0, rate: 1.2, speaking: false, paused: false, bar: null };
  function ttsCollect() {
    var sentences = [];
    // 重排模式：文本来自 .reflow-doc 分页块
    if (pdfState.reflowMode) {
      $all('#pdf-scroll .reflow-doc .reflow-page').forEach(function (pageEl) {
        var pageText = (pageEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (!pageText) return;
        (pageText.match(/[^。！？.!?]+[。！？.!?]?/g) || []).forEach(function (s) {
          s = s.trim();
          if (s.length > 1) sentences.push({ page: Number(pageEl.dataset.page) || 1, text: s });
        });
      });
      return sentences;
    }
    $all('#pdf-scroll .pdf-page-sheet').forEach(function (sheet) {
      var divs = sheet._litTextDivs || [];
      var pageText = divs.map(function (d) { return d.textContent || ''; }).join(' ').replace(/\s+/g, ' ').trim();
      if (!pageText) return;
      var parts = pageText.match(/[^。！？.!?]+[。！？.!?]?/g) || [];
      parts.forEach(function (s) {
        s = s.trim();
        if (s.length > 1) sentences.push({ page: Number(sheet.dataset.page) || 1, text: s });
      });
    });
    return sentences;
  }
  function ttsEnsureBar(parent) {
    if (ttsState.bar) return ttsState.bar;
    var bar = document.createElement('div');
    bar.className = 'pdf-tts-bar';
    bar.hidden = true;
    bar.innerHTML = '<span id="tts-status"></span>' +
      T('<select id="tts-rate" title="语速"><option value="0.8">0.8×</option><option value="1">1×</option><option value="1.2" selected>1.2×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>') +
      T('<button type="button" class="btn btn-ghost btn-xs" id="tts-pause">暂停</button>') +
      T('<button type="button" class="btn btn-ghost btn-xs" id="tts-stop">停止</button>');
    (parent || $('#pdf-overlay')).appendChild(bar);
    bar.querySelector('#tts-rate').addEventListener('change', function (e) {
      ttsState.rate = Number(e.target.value) || 1.2;
    });
    bar.querySelector('#tts-pause').addEventListener('click', function () {
      if (!ttsState.speaking && !epubTtsState.speaking) return; // EPUB 朗读同样可暂停（F15）
      if (!ttsState.paused) { window.speechSynthesis.pause(); ttsState.paused = true; this.textContent = T('继续'); }
      else { window.speechSynthesis.resume(); ttsState.paused = false; this.textContent = T('暂停'); }
    });
    bar.querySelector('#tts-stop').addEventListener('click', function () { ttsStop(); epubTtsStop(); });
    ttsState.bar = bar;
    return bar;
  }
  function ttsSpeakNext() {
    if (!ttsState.speaking) return;
    if (ttsState.index >= ttsState.sentences.length) { ttsStop(); $('#tts-status').textContent = T('朗读完成'); return; }
    var s = ttsState.sentences[ttsState.index];
    var u = new window.SpeechSynthesisUtterance(s.text);
    u.lang = /[㐀-鿿]/.test(s.text) ? 'zh-CN' : 'en-US';
    u.rate = ttsState.rate;
    u.onend = function () { ttsState.index++; ttsSpeakNext(); };
    u.onerror = function () { ttsState.index++; ttsSpeakNext(); };
    $('#tts-status').textContent = T('第 ') + (ttsState.index + 1) + '/' + ttsState.sentences.length + T(' 句 · 第 ') + s.page + T(' 页');
    if (pdfState.reflowMode) {
      var block = $('#pdf-scroll .reflow-doc .reflow-page[data-page="' + s.page + '"]');
      if (block) block.scrollIntoView({ block: 'start' });
    } else {
      goToPdfPage(s.page);
    }
    window.speechSynthesis.speak(u);
  }
  function ttsStop() {
    ttsState.speaking = false;
    window.speechSynthesis.cancel();
    if (ttsState.bar) ttsState.bar.hidden = true;
  }
  function ttsToggle() {
    if (ttsState.speaking) { ttsStop(); return; }
    var sentences = ttsCollect();
    if (!sentences.length) { toast(T('没有可朗读的文本（请先渲染页面或做 OCR）')); return; }
    ttsState.sentences = sentences;
    ttsState.index = 0;
    ttsState.speaking = true;
    ttsState.paused = false;
    var pdfBar = ttsEnsureBar();
    pdfBar.hidden = false;
    var pdfPause = pdfBar.querySelector('#tts-pause');
    if (pdfPause) pdfPause.textContent = T('暂停');
    ttsSpeakNext();
  }
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

  $('#pdf-tts').addEventListener('click', ttsToggle);
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
        epubNoteCurrentId = note.id;
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
  // EPUB 侧栏笔记编辑器
  $('#epub-note-select').addEventListener('change', function (e) {
    epubNoteCurrentId = e.target.value;
    renderEpubNoteEditor();
  });
  $('#epub-note-new').addEventListener('click', function () {
    if (!epubState.paper) return;
    dlgPrompt(T('新建笔记'), T('标题；留空则创建跨文献主题笔记'), '').then(function (title) {
      if (title == null) return;
      var note = createNote(title.trim() ? epubState.paper.id : '', title.trim());
      epubNoteCurrentId = note.id;
      save(); renderEpubNoteEditor();
      toast(T('✓ 已创建笔记'));
    });
  });
  $('#epub-note-edit-tab').addEventListener('click', function () { setEpubNoteMode('edit'); });
  $('#epub-note-preview-tab').addEventListener('click', function () { setEpubNoteMode('preview'); });
  $('#epub-note-richtext').addEventListener('click', function () { openNoteEditor(currentEpubNote()); });
  $('#epub-note-export-word').addEventListener('click', function () { exportNoteToWord(currentEpubNote()); });
  $('#epub-note-textarea').addEventListener('input', function (e) {
    var note = currentEpubNote();
    if (!note) return;
    note.content = e.target.value;
    window.LitModel.touch(note);
    saveEpubNoteSide();
  });
  $('#epub-note-stale').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-stale-action]');
    if (btn) epubHandleStaleAction(btn.dataset.staleAction, btn.dataset.annotationId);
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
    epubNoteCurrentId = note.id;
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

  function hidePdfTranslation() {
    pdfState.translationRequest++;
    $('#pdf-translation-popover').hidden = true;
    $('#pdf-translation-result').hidden = true;
    $('#pdf-note-composer').hidden = true;
    $('#pdf-note-text').value = '';
    pdfState.selectedText = '';
    pdfState.selectionPositions = [];
    if (pdfState.handle && pdfState.handle.clearSelection) pdfState.handle.clearSelection();
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
    $('#pdf-translation-source').textContent = pdfState.selectedText;
    $('#pdf-translation-provider').textContent = T('可批注或翻译');
    $('#pdf-translation-result').hidden = true;
    $('#pdf-translation-result').textContent = '';
    $('#pdf-translate-selection').disabled = false;
    $('#pdf-translate-selection').textContent = T('翻译');
    var popover = $('#pdf-translation-popover');
    popover.hidden = false;
    var rect = range.getBoundingClientRect();
    var top = rect.bottom + 10;
    if (top + popover.offsetHeight > window.innerHeight - 12) top = Math.max(12, rect.top - popover.offsetHeight - 10);
    popover.style.left = Math.max(12, Math.min(window.innerWidth - popover.offsetWidth - 12, rect.left)) + 'px';
    popover.style.top = top + 'px';
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
    if (pdfState.reflowMode) {
      pdfState.reflowFont = Math.max(10, Math.min(22, pdfState.reflowFont + (delta > 0 ? 1 : -1)));
      applyReflowFont();
      return;
    }
    pdfState.scale = Math.max(0.6, Math.min(3, Math.round((pdfState.scale + delta) * 100) / 100));
    applyPdfViewChange();
  }
  function togglePdfLayout() {
    if (pdfState.reflowMode) { toast(T('重排模式下不可切换版式')); return; }
    pdfState.layout = pdfState.layout === 'single' ? 'spread' : 'single';
    applyPdfViewChange();
  }
  function rotatePdf() {
    if (pdfState.reflowMode) { toast(T('重排模式下不可旋转')); return; }
    pdfState.rotation = (pdfState.rotation + 90) % 360;
    applyPdfViewChange();
  }
  function fitPdfWidth() {
    if (pdfState.reflowMode) { toast(T('重排模式下无需适宽')); return; }
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
    if (pdfState.reflowMode) {
      var block = $('#pdf-scroll .reflow-doc .reflow-page[data-page="' + page + '"]');
      if (block) { block.scrollIntoView({ block: 'start' }); return; }
    }
    page = Math.max(1, Math.min(pdfState.pageCount, Number(page) || 1));
    pdfState.handle.goToPage(page);
    updatePdfPageUi(page, pdfState.pageCount);
    saveReadPos();
  }

  /* ---- PDF 重排阅读模式（阶段六）：栏检测重建纯文本流；位图不动（CSS 隐藏 sheet），切回即原位 ---- */
  function resetPdfReflow() {
    pdfState.reflowMode = false;
    pdfState.reflowBusy = false;
    pdfState.reflowMarks = [];
    pdfState.reflowPages = {};
    pdfState.reflowEpoch++; // 使在飞提取回调失效（F13：旧页内容不得落地）
    var scroll = $('#pdf-scroll');
    if (scroll) scroll.classList.remove('reflow-on');
    var doc = scroll && scroll.querySelector('.reflow-doc');
    if (doc) doc.remove();
    var btn = $('#pdf-reflow-toggle');
    if (btn) btn.setAttribute('aria-pressed', 'false');
  }
  function togglePdfReflow() {
    if (!pdfState.handle || !pdfState.pageCount) { toast(T('PDF 尚未渲染完成')); return; }
    if (pdfState.reflowMode) {
      pdfState.reflowMode = false;
      resetPdfReflow();
      $('#pdf-zoom').textContent = Math.round(pdfState.scale * 100) + '%';
      return;
    }
    pdfState.reflowMode = true;
    pdfState.reflowEpoch++;
    pdfState.reflowPages = {};
    pdfState.reflowNextPage = 1;
    pdfState.reflowBusy = false;
    $('#pdf-scroll').classList.add('reflow-on');
    $('#pdf-reflow-toggle').setAttribute('aria-pressed', 'true');
    applyReflowFont();
    toast(T('重排模式：纯文本流（批注 / 搜索 / 手写暂不可用），缩放键调字号'));
    ensureReflowPages();
  }
  function applyReflowFont() {
    var doc = $('#pdf-scroll .reflow-doc');
    if (doc) doc.style.setProperty('--reflow-font', pdfState.reflowFont + 'px');
    $('#pdf-zoom').textContent = pdfState.reflowFont + 'pt';
  }
  function reflowDocEl() {
    var scroll = $('#pdf-scroll');
    var doc = scroll.querySelector('.reflow-doc');
    if (!doc) {
      doc = document.createElement('div');
      doc.className = 'reflow-doc';
      scroll.appendChild(doc);
      applyReflowFont();
    }
    return doc;
  }
  function renderReflowPage(pageNum, blocks) {
    var doc = reflowDocEl();
    var loading = doc.querySelector('.reflow-loading');
    var pageEl = document.createElement('div');
    pageEl.className = 'reflow-page';
    pageEl.dataset.page = pageNum;
    var h = document.createElement('h4');
    h.textContent = T('第 ') + pageNum + T(' 页');
    pageEl.appendChild(h);
    if (!blocks.length) {
      var emptyP = document.createElement('p');
      emptyP.className = 'reflow-loading';
      emptyP.textContent = T('（本页无文本）');
      pageEl.appendChild(emptyP);
    }
    blocks.forEach(function (b) {
      var p = document.createElement('p');
      p.textContent = b.text;
      pageEl.appendChild(p);
    });
    doc.insertBefore(pageEl, loading || null);
  }
  /* 懒提取：每批 5 页串行（getTextContent 已是异步），视口不满自动续提；epoch 防在飞旧回调落地（F13） */
  function ensureReflowPages() {
    if (!pdfState.reflowMode || pdfState.reflowBusy) return;
    if (pdfState.reflowNextPage > pdfState.pageCount) return;
    var epoch = pdfState.reflowEpoch;
    var handle = pdfState.handle;
    function live() {
      return pdfState.reflowMode && pdfState.reflowEpoch === epoch && pdfState.handle === handle;
    }
    pdfState.reflowBusy = true;
    var doc = reflowDocEl();
    var loading = document.createElement('div');
    loading.className = 'reflow-loading';
    doc.appendChild(loading);
    var n = pdfState.reflowNextPage;
    var batchEnd = Math.min(pdfState.pageCount, n + 4);
    function step() {
      if (!live()) { loading.remove(); pdfState.reflowBusy = false; return; }
      if (n > batchEnd) {
        loading.remove();
        pdfState.reflowBusy = false;
        pdfState.reflowNextPage = n;
        // 搜索激活时：重扫高亮并继续全量提取（搜索需要全文）
        if (reflowSearchActive()) {
          performReflowSearch(true);
          ensureReflowPages();
          return;
        }
        var scroll = $('#pdf-scroll');
        if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 600) ensureReflowPages();
        return;
      }
      var pageNum = n;
      n++;
      loading.textContent = T('正在提取第 ') + pageNum + T(' 页…');
      handle.doc.getPage(pageNum).then(function (page) {
        return page.getTextContent();
      }).then(function (content) {
        if (!live()) return;
        var blocks = window.LitReflow.readingOrder(
          window.LitReflow.linesFromItems(content.items, pageNum), null);
        pdfState.reflowPages[pageNum] = blocks;
        renderReflowPage(pageNum, blocks);
        step();
      }).catch(function () {
        if (!live()) return;
        pdfState.reflowPages[pageNum] = [];
        step();
      });
    }
    step();
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
    if (pdfState.reflowMode) { goToReflowSearchResult(delta); return; }
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
  /* ---- 重排模式搜索：DOM 文本高亮（懒提取页随批次递增重扫） ---- */
  function clearReflowSearchMarks() {
    $all('#pdf-scroll .reflow-hit').forEach(function (mark) {
      var parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    pdfState.reflowMarks = [];
  }
  function reflowSearchActive() {
    return !!(pdfState.reflowMode && $('#pdf-search').value.trim());
  }
  function goToReflowSearchResult(delta) {
    var marks = pdfState.reflowMarks || [];
    if (!marks.length) return;
    pdfState.searchIndex = (pdfState.searchIndex + delta + marks.length) % marks.length;
    marks.forEach(function (m, i) { m.classList.toggle('active', i === pdfState.searchIndex); });
    marks[pdfState.searchIndex].scrollIntoView({ block: 'center' });
    $('#pdf-search-status').textContent = (pdfState.searchIndex + 1) + '/' + marks.length + T(' 匹配');
  }
  function performReflowSearch(preserveIndex) {
    var query = $('#pdf-search').value.trim();
    var prevIndex = pdfState.searchIndex;
    clearReflowSearchMarks();
    pdfState.searchMatches = [];
    pdfState.searchIndex = -1;
    if (!query) { $('#pdf-search-status').textContent = ''; return; }
    var doc = $('#pdf-scroll .reflow-doc');
    if (!doc) { $('#pdf-search-status').textContent = T('无结果'); return; }
    var lower = query.toLocaleLowerCase();
    var walker = document.createTreeWalker(doc, window.NodeFilter.SHOW_TEXT);
    var byNode = new Map();
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      var tl = node.nodeValue.toLocaleLowerCase();
      var pos = 0;
      var idx;
      while ((idx = tl.indexOf(lower, pos)) !== -1) {
        if (!byNode.has(node)) byNode.set(node, []);
        byNode.get(node).push({ start: idx, end: idx + query.length });
        pos = idx + query.length;
      }
    }
    // 每节点从后往前替换（surroundContents 后原节点保留前段，后续小偏移仍有效）
    byNode.forEach(function (hits, textNode) {
      hits.sort(function (a, b) { return b.start - a.start; });
      hits.forEach(function (hit) {
        var range = document.createRange();
        try {
          range.setStart(textNode, hit.start);
          range.setEnd(textNode, hit.end);
          var mark = document.createElement('mark');
          mark.className = 'reflow-hit';
          range.surroundContents(mark);
          pdfState.reflowMarks.unshift(mark);
        } catch (e) { /* 跨元素边界等异常：跳过该处 */ }
      });
    });
    pdfState.reflowMarks.sort(function (a, b) {
      return a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
    var totalPages = pdfState.pageCount || 0;
    var extracted = Object.keys(pdfState.reflowPages || {}).length;
    if (!pdfState.reflowMarks.length) {
      $('#pdf-search-status').textContent = T('无结果') + (extracted < totalPages ? T('（提取中 ') + extracted + '/' + totalPages + T(' 页）') : '');
      return;
    }
    if (preserveIndex && prevIndex >= 0) {
      pdfState.searchIndex = Math.min(prevIndex, pdfState.reflowMarks.length - 1);
      goToReflowSearchResult(0);
    } else {
      goToReflowSearchResult(1);
    }
    if (extracted < totalPages) {
      $('#pdf-search-status').textContent += T(' · 已提取 ') + extracted + '/' + totalPages + T(' 页');
    }
  }
  function performPdfSearch(preserveIndex) {
    if (pdfState.reflowMode) { performReflowSearch(preserveIndex); return; }
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
    handle.search(query).then(function (results) {
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
      goToPdfSearchResult(1);
    }).catch(function () { $('#pdf-search-status').textContent = T('搜索失败'); });
  }

  // ---------- 库内查重与合并 ----------
  function mergeGroupIntoState(group) {
    var merged = window.LitModel.normalizePaper(window.LitDedupe.merge(group), uid);
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
  }

  function renderDedupeModal() {
    var groups = window.LitDedupe.findGroups(state.papers.filter(function (p) { return !p.deletedAt; }));
    var list = $('#dedupe-list');
    list.innerHTML = '';
    $('#dedupe-merge-all').hidden = groups.length === 0;
    $('#dedupe-summary').textContent = groups.length
      ? T('发现 ') + groups.length + T(' 组重复（按 PDF 内容、DOI 或标题匹配）。合并保留信息最完整的一条，其余条目的空缺字段、标签、笔记并入后删除。')
      : '';
    if (!groups.length) {
      list.innerHTML = T('<div class="dedupe-empty">未发现重复文献（按 PDF 内容 / DOI / 标题匹配）</div>');
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
    { title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'], year: 2017, venue: 'NeurIPS', doi: '10.48550/arXiv.1706.03762', tags: [T('深度学习'), T('经典')], status: 'read', rating: 5, entryType: 'inproceedings' },
    { title: 'Deep Residual Learning for Image Recognition', authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'], year: 2016, venue: 'CVPR', doi: '10.1109/CVPR.2016.90', tags: [T('深度学习'), T('经典')], status: 'read', rating: 5, entryType: 'inproceedings' },
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
  var autoSyncEnabled = true; // 「内容变化时自动同步」开关；关闭后仅手动「保存并同步」/对照应用触发
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

  function syncFormValue() {
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
      translatorApiKey: $('#sync-translator-api-key').value,
      rankProvider: $('#sync-rank-provider').value,
      scigreatApiKey: $('#sync-scigreat-api-key').value,
      easyscholarApiKey: $('#sync-easyscholar-api-key').value,
      renameTemplate: $('#sync-rename-template').value.trim(),
      pdfDownloadDir: $('#sync-pdf-download-dir').value.trim(),
      proxyPrefix: $('#sync-proxy-prefix').value.trim(),
      bibExportPath: $('#sync-bib-export-path').value.trim(),
      agentBaseUrl: $('#sync-agent-base-url') ? $('#sync-agent-base-url').value.trim() : '',
      agentModel: $('#sync-agent-model') ? $('#sync-agent-model').value.trim() : '',
      agentApiDialect: $('#sync-agent-dialect') ? $('#sync-agent-dialect').value : '',
      agentApiKey: $('#sync-agent-api-key') ? $('#sync-agent-api-key').value : '',
      // 留空 = 用默认值（256000 / 12800，权威在 js/agentcore DEFAULTS）：空串交给主进程归一为 0
      agentContextTokens: $('#sync-agent-context-tokens') ? $('#sync-agent-context-tokens').value.trim() : '',
      agentMaxOutputTokens: $('#sync-agent-max-output-tokens') ? $('#sync-agent-max-output-tokens').value.trim() : '',
      openalexEmail: $('#sync-openalex-email') ? $('#sync-openalex-email').value.trim() : '',
      openalexApiKey: $('#sync-openalex-key') ? $('#sync-openalex-key').value : '',
      embedProvider: $('#sync-embed-provider') ? $('#sync-embed-provider').value : '',
      embedBaseUrl: $('#sync-embed-base-url') ? $('#sync-embed-base-url').value.trim() : '',
      embedModel: $('#sync-embed-model') ? $('#sync-embed-model').value.trim() : '',
      embedApiKey: $('#sync-embed-api-key') ? $('#sync-embed-api-key').value : '',
      elsevierApiKey: $('#sync-elsevier-key') ? $('#sync-elsevier-key').value : '',
      tinyfishApiKey: $('#sync-tinyfish-key') ? $('#sync-tinyfish-key').value : '',
      semanticscholarApiKey: $('#sync-semanticscholar-key') ? $('#sync-semanticscholar-key').value : ''
    };
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
    $('#sync-rename-template').value = config.renameTemplate || '';
    $('#sync-pdf-download-dir').value = config.pdfDownloadDir || '';
    $('#sync-proxy-prefix').value = config.proxyPrefix || '';
    $('#sync-bib-export-path').value = config.bibExportPath || '';
    if (config.trashRetentionDays != null) $('#sync-trash-days').value = Number(config.trashRetentionDays);
    if (config.autoWriteBack != null) $('#sync-auto-writeback').checked = config.autoWriteBack === true;
    if ($('#sync-agent-base-url')) {
      $('#sync-agent-base-url').value = config.agentBaseUrl || '';
      $('#sync-agent-model').value = config.agentModel || '';
      if ($('#sync-agent-dialect')) $('#sync-agent-dialect').value = config.agentApiDialect || '';
      // 0 = 留空（用默认值）：输入框显示空，而不是把默认值写成一个会被保存的数字
      if ($('#sync-agent-context-tokens')) {
        $('#sync-agent-context-tokens').value = config.agentContextTokens ? String(config.agentContextTokens) : '';
      }
      if ($('#sync-agent-max-output-tokens')) {
        $('#sync-agent-max-output-tokens').value = config.agentMaxOutputTokens ? String(config.agentMaxOutputTokens) : '';
      }
      $('#sync-agent-api-key').value = '';
      $('#sync-agent-preset').value = '';
      refreshAgentDialectHint();
      $('#sync-openalex-email').value = config.openalexEmail || '';
      $('#sync-openalex-key').value = '';
      if ($('#sync-embed-provider')) $('#sync-embed-provider').value = config.embedProvider || '';
      if ($('#sync-embed-base-url')) $('#sync-embed-base-url').value = config.embedBaseUrl || '';
      $('#sync-embed-model').value = config.embedModel || '';
      if ($('#sync-embed-api-key')) $('#sync-embed-api-key').value = '';
      $('#sync-elsevier-key').value = '';
      $('#sync-tinyfish-key').value = '';
      $('#sync-semanticscholar-key').value = '';
    }
    if (desktop.getSetting && $('#sync-web-search-enabled')) {
      desktop.getSetting('webSearchEnabled').then(function (value) {
        $('#sync-web-search-enabled').checked = value === true;
      }).catch(function () {});
    }
    refreshEmbedUsageLine();
    refreshEmbedSourceHint();
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
    var pendingKey = $('#sync-embed-api-key') ? $('#sync-embed-api-key').value : '';
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
    var target = $('#sync-agent-dialect-hint');
    if (!target) return;
    var base = $('#sync-agent-base-url') ? $('#sync-agent-base-url').value.trim() : '';
    if (!base || !window.LitAgentProto) {
      target.textContent = T('填好 Base URL 后会显示实际使用的接口协议与请求地址');
      return;
    }
    var dialect = LitAgentProto.detectDialect(base, {
      dialect: $('#sync-agent-dialect') ? $('#sync-agent-dialect').value : '',
      model: $('#sync-agent-model') ? $('#sync-agent-model').value.trim() : ''
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

  function bindAgentSettings() {
    var preset = $('#sync-agent-preset');
    if (preset) {
      preset.addEventListener('change', function () {
        if (!preset.value) return;
        $('#sync-agent-base-url').value = preset.value;
        if (!$('#sync-agent-model').value.trim()) {
          var hints = {
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
          if (hints[preset.value]) $('#sync-agent-model').value = hints[preset.value];
        }
        refreshAgentDialectHint();
      });
    }
    var dialectSelect = $('#sync-agent-dialect');
    if (dialectSelect) dialectSelect.addEventListener('change', refreshAgentDialectHint);
    var baseInput = $('#sync-agent-base-url');
    if (baseInput) baseInput.addEventListener('input', refreshAgentDialectHint);
    var modelInput = $('#sync-agent-model');
    if (modelInput) modelInput.addEventListener('input', refreshAgentDialectHint);
    var testBtn = $('#sync-agent-test');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('sync-agent-test-status', T('正在连接…'), 'pending');
        desktop.agentTest({
          baseUrl: $('#sync-agent-base-url').value.trim(),
          apiKey: $('#sync-agent-api-key').value,
          model: $('#sync-agent-model').value.trim(),
          dialect: $('#sync-agent-dialect') ? $('#sync-agent-dialect').value : ''
        }).then(function (result) {
          setSyncInlineStatus('sync-agent-test-status', T('连接成功') + (result.model ? ' · ' + result.model : ''), 'success');
        }).catch(function (error) {
          setSyncInlineStatus('sync-agent-test-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
    }
    var fetchModelsBtn = $('#sync-agent-fetch-models');
    if (fetchModelsBtn) {
      fetchModelsBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('sync-agent-test-status', T('正在拉取模型清单…'), 'pending');
        desktop.agentListModels({
          baseUrl: $('#sync-agent-base-url').value.trim(),
          apiKey: $('#sync-agent-api-key').value,
          model: $('#sync-agent-model').value.trim(),
          dialect: $('#sync-agent-dialect') ? $('#sync-agent-dialect').value : ''
        }).then(function (result) {
          var models = (result && result.models) || [];
          var list = $('#sync-agent-model-list');
          list.innerHTML = '';
          models.forEach(function (id) {
            var option = document.createElement('option');
            option.value = id;
            list.appendChild(option);
          });
          // 当前为空或不在清单里时，自动选中第一个（免手输）
          var input = $('#sync-agent-model');
          if (!input.value.trim() || models.indexOf(input.value.trim()) === -1) {
            if (models.length) input.value = models[0];
          }
          setSyncInlineStatus('sync-agent-test-status',
            T('✓ 拉取到 ') + models.length + T(' 个模型，点模型名输入框可下拉选择'), 'success');
        }).catch(function (error) {
          setSyncInlineStatus('sync-agent-test-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
    }
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
          embedApiKey: $('#sync-embed-api-key') ? $('#sync-embed-api-key').value : '',
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
    var importBtn = $('#sync-research-import');
    if (importBtn) {
      importBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('sync-research-status', T('正在导入…'), 'pending');
        desktop.researchImportHarness().then(function (result) {
          if (result && result.canceled) {
            setSyncInlineStatus('sync-research-status', T('已取消'), '');
          } else {
            setSyncInlineStatus('sync-research-status',
              T('✓ 已导入 ') + (result && result.imported || 0) + T(' 篇（可重复执行，不会产生重复）'), 'success');
          }
          if (window.LitAgentUi) LitAgentUi.refreshResearchStats();
        }).catch(function (error) {
          setSyncInlineStatus('sync-research-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
    }
    var browseBtn = $('#sync-agent-session-browse');
    if (browseBtn) {
      browseBtn.addEventListener('click', function () {
        desktop.chooseDirectory({ title: T('选择会话记录根目录') }).then(function (picked) {
          if (picked) $('#sync-agent-session-root').value = picked;
        }).catch(function () {});
      });
    }
    var openBtn = $('#sync-agent-session-open');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        desktop.sessionOpenRoot().catch(function (error) { toast(T('打开失败：') + String(error && error.message || error)); });
      });
    }
    // 调研库导入进度 → 状态行
    if (desktop.onResearchImportProgress && !bindAgentSettings.progressBound) {
      bindAgentSettings.progressBound = true;
      desktop.onResearchImportProgress(function (p) {
        setSyncInlineStatus('sync-research-status',
          T('导入中 ') + (p.done || 0) + '/' + (p.total || 0), 'pending');
      });
    }
    /* M9-4：科研网页检索——首次开启弹出境告知，确认落 webSearchEgressAcknowledged */
    var webSearchBox = $('#sync-web-search-enabled');
    if (webSearchBox) {
      webSearchBox.addEventListener('change', function () {
        if (!webSearchBox.checked) return; // 关闭无需确认
        if (!desktop.getSetting) return;
        desktop.getSetting('webSearchEgressAcknowledged').then(function (ack) {
          if (ack === true) return;
          return dlgConfirm(T('启用科研网页检索'),
            T('开启后，AI 助手的检索词与抓取的 URL 将发送到 TinyFish 服务器（第三方数据出境，故默认关闭、需你知情确认）。') +
            T('\n\n抓取仅限公开学术域白名单内的 URL；关闭开关后不再有任何该主机外呼。'),
            T('知晓并开启')).then(function (yes) {
            if (yes) {
              desktop.setSetting('webSearchEgressAcknowledged', true).catch(function () {});
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
      registerBtn.addEventListener('click', function () {
        var button = this;
        button.disabled = true;
        setSyncInlineStatus('sync-research-status', T('补登记中（DOI 直查 + 本地身份）…'), 'pending');
        desktop.researchRegister({ limit: 200 }).then(function (r) {
          var applied = applyResearchProposals(r.proposals || []);
          setSyncInlineStatus('sync-research-status',
            T('✓ 扫描 ') + (r.scanned || 0) + T(' 条，补登记 ') + applied + T(' 条'), 'success');
        }).catch(function (error) {
          setSyncInlineStatus('sync-research-status', error && error.message || String(error), 'error');
        }).finally(function () { button.disabled = false; });
      });
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
            T(' tokens（按内容 hash 增量：未变化的条目不会重复嵌入）。') + failedNote,
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
    var railW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-width')) || 42;
    var detail = 0;
    if (ws && !ws.classList.contains('rail-collapsed')) {
      detail = parseFloat(getComputedStyle(ws).getPropertyValue('--detail-width')) || 0;
    }
    document.body.style.setProperty('--reading-rail-w', Math.round(railW + detail) + 'px');
  }

  /** 观察两个阅读层的 hidden 与 workspace 的 rail-collapsed 类，保持 body 状态与让位宽度实时同步 */
  function watchReadingRail() {
    [$('#pdf-overlay'), $('#epub-overlay'), document.querySelector('.workspace')].forEach(function (node) {
      if (!node || typeof MutationObserver === 'undefined') return;
      new MutationObserver(syncReadingRail).observe(node, { attributes: true, attributeFilter: ['hidden', 'class'] });
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
      /* M9 二期：收藏桥 / PDF 收入（agent 写类工具与手动模式共用同一链路） */
      collectWorks: collectWorks,
      importStagedPdfs: importStagedPdfs,
      /* M9 三期：引文网络面板（agent build_graph 工具的展示与快照出口） */
      openGraphPanel: function (data, title) {
        if (window.LitGraphView) LitGraphView.showData(data, title);
      },
      saveGraphHtmlToSession: function (data, sessionId) {
        return window.LitGraphView ? LitGraphView.saveHtmlToSession(data, sessionId) : Promise.resolve({ file: '' });
      },
      /* M9-4：网页快照挂载（主进程已落盘 + 已入 pdf_fts，这里补附件记录并走 save 管线） */
      attachSnapshot: attachSnapshotFromResearch,
      /* M9-5（R11）：页面渲染生产端——PDF.js 离屏渲染指定页为 PNG（agent render_pdf_pages
       *  工具用）；agentui 只在 vision 模型时启用。
       *  R1：工具层传的已是 1 基物理页，renderPageToPng 也按 1 基消费——适配器不得再 +1
       *  （曾把请求的第 1 页渲染成第 2 页，末页则直接超界） */
      renderPageImage: function (input) {
        if (!window.LitPdf || !LitPdf.renderPageToPng || !input || !input.path) return Promise.resolve(null);
        return LitPdf.renderPageToPng(input.path, Math.max(1, Math.floor(Number(input.pageIndex) || 1)), input.scale);
      },
      /* R19 临时全文链：按路径抽取 PDF 全文文本（agent read_work_fulltext 用；临时文件
       *  抽取完主进程即删）。与全文索引同一条 LitPdf.extractText 管线（PDF.js），
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
      toast(T('所选文献还没有调研身份：请先在 设置 → 调研库 →「补登记正式库」，或通过 AI 助手收藏'));
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
   * 收藏桥（agent 工具 collect_papers / 手动模式「收藏」按钮共用）：
   * 确认 → addPapers（LitDedupe 去重）→ researchIds 回写 → 返回 {added, merged, canceled}。
   */
  function collectWorks(workIds, folderId) {
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
      return dlgConfirm(T('收藏到正式库'),
        T('将 ') + works.length + T(' 篇文献收藏到「') + folderName + T('」；已存在的自动去重合并。'),
        T('收藏')).then(function (yes) {
        if (!yes) return { canceled: true, added: 0, merged: 0 };
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

  /** PDF 第二步：已暂存进受管目录的 PDF → 建/并条目挂附件（researchIds 同样回写） */
  function importStagedPdfs(storedList, folderId) {
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
        T('将 ') + pairs.length + T(' 个 PDF 收入正式库（创建或合并条目并挂载附件）。'),
        T('收入')).then(function (yes) {
        if (!yes) return { canceled: true, added: 0, merged: 0 };
        var r = addPapers(pairs.map(function (pair) { return pair.draft; }), { folderId: target });
        var touched = false;
        pairs.forEach(function (pair, i) {
          var entry = (r.indexMap || [])[i];
          if (!entry) return;
          touched = applyResearchIds([entry.id], pair.work.id) || touched;
        });
        if (touched) save();
        renderAll();
        // 新挂载的 PDF 排队建全文索引（reindex 只处理「未索引/指纹变化」的附件，增量）
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
    keyInput.placeholder = free ? T('免费接口无需凭据') : (aliyun ? T('留空则保持原 AK/SK') : T('留空则保持原 Key'));
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
  function openWordPanel() {
    $('#word-panel-mask').hidden = false;
    // 打开即检测一次：从外面进来没有「先点检测」的前置步骤，开箱就要能看到文档列表
    wordDetect();
  }
  function closeWordPanel() { $('#word-panel-mask').hidden = true; }

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

  function openSyncSettings(sectionId) {
    if (!desktop || !desktop.getIntegrationConfig) { toast(T('同步功能仅在桌面版可用')); return; }
    $('#sync-mask').hidden = false;
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
        desktop.getSetting('trashRetentionDays').then(function (days) {
          $('#sync-trash-days').value = days == null ? 30 : Number(days);
        }).catch(function () { $('#sync-trash-days').value = 30; });
        desktop.getSetting('autoWriteBack').then(function (value) {
          $('#sync-auto-writeback').checked = value === true;
        }).catch(function () {});
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
        syncThemeSelect.value = localStorage.getItem(THEME_KEY) || 'auto';
      }
      var syncLangSelect = $('#sync-lang-select');
      if (syncLangSelect) {
        syncLangSelect.value = localStorage.getItem('litboard.lang') || 'auto';
      }
      // 指定 sectionId 时切到其所在分组并短暂高亮（首次使用清单「扩展」步、划词翻译等）
      if (sectionId && typeof sectionId === 'string') {
        var section = $('#' + sectionId + '-section');
        if (section) {
          activateSyncGroup(section.dataset.syncGroup);
          section.classList.add('sync-section-flash');
          setTimeout(function () { section.classList.remove('sync-section-flash'); }, 1600);
        }
      }
    }).catch(function (error) {
      $('#sync-status').textContent = T('读取配置失败：') + (error && error.message || error);
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
      refreshSyncFormAfterSync = true;
      // 自动保存不回填表单：异步返回时会覆盖用户正在编辑的其他字段
      if (!auto) fillSyncForm(config);
      $('#sync-status').classList.remove('error');
      $('#sync-status').textContent = auto ? T('已自动保存 · ') + new Date().toLocaleTimeString() : T('配置已保存');
      var trashDays = Math.max(0, Math.min(3650, Number($('#sync-trash-days').value) || 0));
      if (desktop.setSetting) {
        desktop.setSetting('trashRetentionDays', trashDays).catch(function () {});
        autoWriteBack = $('#sync-auto-writeback').checked;
        desktop.setSetting('autoWriteBack', autoWriteBack).catch(function () {});
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
        if (desktop.bridgeSetEnabled) {
          desktop.bridgeSetEnabled($('#sync-bridge-enabled').checked).then(refreshBridgeStatus).catch(function () {});
        }
      }
      // 自动保存只落本机；上传云端仍由「保存并同步」/内容变化自动同步触发
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
    if (!syncAutoSaveDirty) return;
    syncAutoSaveDirty = false;
    saveSyncSettings({ auto: true }).catch(function (error) {
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

  // ---------- 完整备份 ----------
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
      var restoreBtn = $('#sync-backup-restore');
      var openBtn = $('#sync-backup-open');
      if (restoreBtn) restoreBtn.disabled = !info.configured;
      if (openBtn) openBtn.disabled = !info.configured;
      var keepInput = $('#sync-backup-keep');
      var keepApply = $('#sync-backup-keep-apply');
      if (keepInput && document.activeElement !== keepInput) {
        keepInput.value = info.keepSnapshots ? String(info.keepSnapshots) : '';
        keepInput.placeholder = (info.keepMin || 1) + '–' + (info.keepMax || 30) +
          T('（默认 ') + (info.defaultKeepSnapshots || info.keepSnapshots || 7) + '）';
      }
      if (keepApply) keepApply.disabled = !info.configured;
      var el = $('#sync-backup-status');
      if (!el) return info;
      if (!info.configured) {
        setBackupStatusText(T('未设置备份目录 — 选择目录后立即创建首份完整备份。'), '');
        return info;
      }
      var parts = [];
      if (info.lastBackupAt) parts.push(T('上次备份：') + new Date(info.lastBackupAt).toLocaleString());
      if (info.snapshots && info.snapshots.length) {
        parts.push(T('快照 ') + info.snapshots.length + T(' 份（保留 ') + info.keepSnapshots + '）');
      }
      if (info.lastSnapshotId) parts.push(T('最近：') + info.lastSnapshotId);
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
      refreshBackupStatus();
      if (result.backup && result.backup.ok) {
        setBackupStatusText(T('✓ 备份目录已设置，首份完整备份已创建（') + result.backup.snapshotId + '）', 'success');
      } else if (result.backup && result.backup.skipped && result.backup.existing) {
        setBackupStatusText(T('✓ 已挂载现有备份目录；未创建空库快照'), 'success');
      } else {
        var reason = result.backup && result.backup.error || T('未知错误');
        setBackupStatusText(T('备份目录已设置；但首份备份未完成：') + reason, 'warning');
      }
    }).catch(function (e) {
      setBackupStatusText(T('设置备份目录失败：') + (e && e.message || e), 'error');
    });
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
    return (value / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function cleanBackupLeftovers() {
    if (!desktop || !desktop.scanBackupLeftovers || !desktop.cleanBackupLeftovers) return;
    setBackupStatusText(T('正在扫描遗留文件…'), 'pending');
    desktop.scanBackupLeftovers().then(function (scan) {
      var items = (scan && scan.items) || [];
      var skipNote = scan && scan.skipped && scan.skipped.length ? T('（已跳过：') + scan.skipped.join('；') + '）' : '';
      if (!items.length) {
        setBackupStatusText(T('没有可清理的遗留文件') + skipNote, 'success');
        return;
      }
      var detail = Object.keys(scan.categories).map(function (key) {
        var group = scan.categories[key];
        return group.label + ' ' + group.count + T(' 项 / ') + formatBytes(group.bytes);
      }).join('；');
      var dangerCount = items.filter(function (item) { return item.danger; }).length;
      var message = T('将删除 ') + items.length + T(' 项遗留文件，释放约 ') + formatBytes(scan.totalBytes) + '。' +
        detail + '。' +
        (dangerCount
          ? T('其中 ') + dangerCount + T(' 项属于高危类别（已隔离的数据库副本、批注写回前的 .litbak 留底），') +
            T('它们分别保留着损坏库或写回前原件的最后一份拷贝，都只有超过 30 天保留期才会出现在这里；删除后无法找回。')
          : '') +
        T('当前数据库、全部快照与仍在被引用的附件都不会被删除。') + skipNote;
      dlgConfirm(T('清理遗留文件'), message, T('清理'), true).then(function (ok) {
        if (!ok) { setBackupStatusText(T('已取消清理'), ''); return; }
        setBackupStatusText(T('正在清理…'), 'pending');
        desktop.cleanBackupLeftovers().then(function (result) {
          if (!result || !result.ok) { setBackupStatusText(T('清理失败'), 'error'); return; }
          var failedNote = result.failed && result.failed.length ? '，' + result.failed.length + T(' 项失败') : '';
          setBackupStatusText(T('✓ 已清理 ') + result.removed + T(' 项，释放 ') + formatBytes(result.bytes) + failedNote, 'success');
        }).catch(function (e) {
          setBackupStatusText(T('清理失败：') + (e && e.message || e), 'error');
        });
      });
    }).catch(function (e) {
      setBackupStatusText(T('扫描遗留文件失败：') + (e && e.message || e), 'error');
    });
  }

  function applyBackupKeep() {
    if (!desktop || !desktop.setBackupKeep) return;
    var input = $('#sync-backup-keep');
    if (!input) return;
    var value = String(input.value || '').trim();
    if (!/^\d+$/.test(value)) { setBackupStatusText(T('保留份数请填 1–30 之间的整数'), 'warning'); return; }
    setBackupStatusText(T('正在保存保留份数…'), 'pending');
    desktop.setBackupKeep(Number(value)).then(function (result) {
      if (!result || !result.ok) {
        setBackupStatusText(T('设置保留份数失败：') + ((result && result.error) || T('未知错误')), 'error');
        return;
      }
      setBackupStatusText(T('✓ 保留份数已设为 ') + result.keepSnapshots + T('（下一次成功备份时轮换生效）'), 'success');
      refreshBackupStatus();
    }).catch(function (e) {
      setBackupStatusText(T('设置保留份数失败：') + (e && e.message || e), 'error');
    });
  }

  function runBackupNow() {
    if (!desktop || !desktop.backupNow) return;
    setBackupStatusText(T('正在创建完整备份…'), 'pending');
    desktop.backupNow().then(function (result) {
      if (result && result.ok && result.unchanged) {
        setBackupStatusText(T('✓ 文献库与最近一份快照内容一致，未重复保存（仍为 ') + result.snapshotId + '）', 'success');
      } else if (result && result.ok) {
        setBackupStatusText(T('✓ 完整备份完成：') + result.snapshotId + '（' + result.assets + T(' 个附件') +
          (result.prunedObjects ? T('，清理 ') + result.prunedObjects + T(' 个旧对象') : '') + '）', 'success');
      } else {
        var reason = (result && result.error) || T('未知错误');
        if (result && result.missing && result.missing.length) {
          reason += T('。缺失 ') + result.missing.length + T(' 个引用文件：') +
            result.missing.slice(0, 3).map(function (m) { return m.path; }).join('、') +
            (result.missing.length > 3 ? T(' 等') : '');
        }
        setBackupStatusText(T('备份未发布：') + reason, 'error');
      }
      refreshBackupStatus();
    }).catch(function (e) {
      setBackupStatusText(T('备份失败：') + (e && e.message || e), 'error');
      refreshBackupStatus();
    });
  }

  function restoreFromBackup() {
    if (!desktop || !desktop.restoreBackup) return;
    refreshBackupStatus().then(function (info) {
      if (!info || !info.configured) { setBackupStatusText(T('请先设置备份目录'), 'warning'); return; }
      var snapshots = (info.snapshots || []).filter(function (s) { return s.valid; });
      if (!snapshots.length) { setBackupStatusText(T('备份目录中没有有效快照'), 'warning'); return; }
      dlgPick(T('从完整备份恢复'), T('选择要还原的快照（恢复前会先创建当前库的紧急快照，并逐项校验所选快照的数据库与附件哈希，随后重启应用）：'),
        snapshots.map(function (s) {
          return { id: s.id, label: s.createdAt + ' · ' + (s.assets || 0) + T(' 个附件') };
        })).then(function (id) {
        if (!id) return;
        dlgConfirm(T('恢复完整备份'), T('将把当前文献库替换为快照 ') + id + T(' 的内容。') +
          T('当前库会先自动备份为紧急快照，恢复后应用将重启。是否继续？'), T('恢复并重启'), true).then(function (ok) {
          if (!ok) return;
          setBackupStatusText(T('正在创建紧急快照并恢复…'), 'pending');
          desktop.restoreBackup(id).then(function (result) {
            if (result && result.ok) {
              setBackupStatusText(T('✓ 已从 ') + result.snapshotId + T(' 恢复，应用即将重启…'), 'success');
            } else {
              setBackupStatusText(T('恢复失败：') + ((result && result.error) || T('未知错误')), 'error');
              refreshBackupStatus();
            }
          }).catch(function (e) {
            setBackupStatusText(T('恢复失败：') + (e && e.message || e), 'error');
            refreshBackupStatus();
          });
        });
      });
    });
  }

  function openBackupDir() {
    if (!desktop || !desktop.openBackupDir) return;
    desktop.openBackupDir().then(function (err) {
      if (err) setBackupStatusText(T('打开备份目录失败：') + err, 'error');
    }).catch(function () {});
  }

  /** 库内带本地 PDF 的附件总数（与 LitPdfSearch 的索引单元口径一致） */
  function localPdfUnitCount() {
    var count = 0;
    state.papers.forEach(function (paper) {
      var list = (paper.attachments || []).filter(function (attachment) {
        return attachment && attachment.kind === 'pdf' && attachment.path;
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
        T(' 篇 PDF 正文（约 ') + (mb >= 0.1 ? mb.toFixed(1) + ' MB' : '0 MB') + '）。';
      if (!total) text = T('库内没有带本地 PDF 的文献。');
      else if (missing) text += T('其余 ') + missing + T(' 篇在首次全文检索时自动构建，也可点「构建索引」立即生成。');
      el.textContent = text;
    }).catch(function () {});
  }

  function applySyncedWorkspace(value, skipNutstoreSync) {
    var workspace = window.LitModel.normalizeWorkspace(value, uid);
    // baseSignatures 必须是「数据库最近一次确认的内容签名」。applyWorkspaceState 会把
    // persistedWorkspaceSignatures 推进到新内容；若直接以它为 base，saveState 会把
    // 每个条目都判成「本地未改」而跳过——同步落库 / Zotero 导入完成会被静默丢弃。
    var persistedBeforeApply = persistedWorkspaceSignatures;
    applyWorkspaceState(workspace);
    persistedWorkspaceSignatures = persistedBeforeApply;
    var saved = save(skipNutstoreSync); renderAll();
    if (drawerId && getById(drawerId)) openDrawer(drawerId);
    return Promise.resolve(saved).then(function (ok) {
      if (!ok) throw new Error(T('同步结果未能写入本地 SQLite，已停止显示完成状态'));
      return workspace;
    });
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
        if (localValue && remoteValue && String(localValue) !== String(remoteValue)) {
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

  function showSyncConflicts(conflicts) {
    toast(T('同步冲突：') + conflicts.length + T(' 条本地修改被云端版本覆盖'), 9000, {
      label: T('查看'), fn: function () {
        var list = $('#sync-conflict-list');
        list.innerHTML = '';
        conflicts.forEach(function (c) {
          var row = document.createElement('div');
          row.className = 'sync-conflict-row';
          row.innerHTML = '<span class="sync-conflict-title">' + esc(c.title || c.id) + '</span>' +
            T('<span class="sync-conflict-dir">以云端版本为准</span>');
          list.appendChild(row);
        });
        $('#sync-conflict-mask').hidden = false;
        pendingConflictExport = conflicts;
      }
    });
  }
  var pendingConflictExport = [];
  var pendingRemotePlan = null;
  var pendingRemoteResolutions = {};
  var LOCAL_EMPTY_RESET_KEY = 'plan:local-empty-reset'; // 与主进程 integrations.js 保持一致
  var remotePlanApplying = false;
  var refreshSyncFormAfterSync = false;

  function remotePlanId(plan) {
    return plan && (plan.planId || plan.id || plan.token) || '';
  }

  function remotePlanConflicts(plan) {
    return plan && (Array.isArray(plan.conflicts) ? plan.conflicts :
      Array.isArray(plan.fieldConflicts) ? plan.fieldConflicts : []) || [];
  }

  function remotePlanLocalOnly(plan) {
    return plan && (Array.isArray(plan.localOnly) ? plan.localOnly :
      Array.isArray(plan.localOnlyEntities) ? plan.localOnlyEntities : []) || [];
  }

  function remoteConflictKey(conflict, index) {
    return String(conflict && (conflict.conflictId || conflict.id) ||
      (conflict && conflict.collection || 'papers') + ':' + (conflict && conflict.entityId || conflict && conflict.itemId || '') + ':' +
      (conflict && conflict.field || '') + ':' + index);
  }

  function remoteConflictLabel(conflict) {
    var collection = conflict && conflict.collection || 'papers';
    var id = conflict && (conflict.entityId || conflict.id || conflict.itemId) || '';
    var field = conflict && (conflict.field || conflict.label) || T('实体');
    return collection + ' · ' + (conflict && (conflict.title || id) || id) + ' · ' + field;
  }

  var remotePlanModel = {
    items: [],
    requiredKeys: new Set(),
    resolvedKeys: new Set(),
    filteredItems: [],
    renderedCount: 0,
    filterText: '',
    chunkSize: 60,
    rowMap: new Map(),
    scrollTicking: false
  };

  function remotePlanValue(value) {
    if (value === undefined || value === null) return T('（不存在 / 删除）');
    if (typeof value === 'string') return value.length > 1500 ? (value.slice(0, 1500) + T('…（长文本截断）')) : (value || T('（空）'));
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      var s = JSON.stringify(value, null, 2);
      return s.length > 1500 ? (s.slice(0, 1500) + T('\n…（超长结构截断）')) : s;
    } catch (error) {
      return String(value);
    }
  }

  function updateRemotePlanRowVisual(row, choice) {
    var buttons = row.querySelectorAll('[data-remote-choice]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var isSel = (btn.dataset.remoteChoice === choice);
      btn.classList.toggle('selected', isSel);
      if (btn.parentElement && btn.parentElement.classList.contains('remote-plan-value')) {
        btn.parentElement.classList.toggle('selected', isSel);
      }
    }
  }

  function updateRemotePlanApplyButton() {
    var isComplete = (remotePlanModel.resolvedKeys.size >= remotePlanModel.requiredKeys.size);
    var applyBtn = $('#sync-remote-plan-apply');
    if (applyBtn) applyBtn.disabled = !isComplete;
  }

  function updateRemotePlanSummary() {
    if (!pendingRemotePlan) return;
    var totalRequired = remotePlanModel.requiredKeys.size;
    var resolvedCount = remotePlanModel.resolvedKeys.size;
    var totalItems = remotePlanModel.items.length;
    var remoteState = pendingRemotePlan.remoteExists === false
      ? T('远端库文件不存在')
      : T('远端 ') + (pendingRemotePlan.remoteCount == null ? T('未知') : pendingRemotePlan.remoteCount) + T(' 篇');
    var summary = (pendingRemotePlan.mode === 'restore' ? T('远端恢复') : T('普通同步')) +
      ' · ' + remoteState +
      T(' · 待选择 ') + totalRequired + T(' 项（已选 ') + resolvedCount + '/' + totalRequired + '）' +
      (totalItems > totalRequired ? T('，仅本机 ') + (totalItems - totalRequired) + T(' 项') : '') + '。' +
      T('采用本机＝本机保留；远端无此条目时会重新上传，远端已有另一版本时保持云端副本不变。') +
      T('采用远端＝本机改用云端内容。') +
      (pendingRemotePlan.localEmptyReset ? T('检测到本机文献为 0 而同步基线仍有内容（常见于本机读取失败或切换过数据目录），已暂停自动同步，请先选择处理方式。') :
        (pendingRemotePlan.remoteResetSuspected ? T('检测到远端库从非空突然变为 0 篇，已暂停自动同步，请确认保留本机。') : '')) +
      (pendingRemotePlan.remoteEtag ? T('远端版本已锁定，应用前会再次校验。') : '');
    $('#sync-remote-plan-summary').textContent = summary;
  }

  function setRemotePlanChoice(key, choice) {
    pendingRemoteResolutions[key] = choice;
    if (remotePlanModel.requiredKeys.has(key)) {
      if (choice === 'local' || choice === 'remote') {
        remotePlanModel.resolvedKeys.add(key);
      } else {
        remotePlanModel.resolvedKeys.delete(key);
      }
      updateRemotePlanApplyButton();
    }
    var row = remotePlanModel.rowMap.get(key) || (typeof window !== 'undefined' && window.CSS && window.CSS.escape ? document.querySelector('[data-remote-conflict-key="' + window.CSS.escape(key) + '"]') : null);
    if (row) {
      updateRemotePlanRowVisual(row, choice);
    }
    updateRemotePlanBulkButtons();
  }

  // 批量按钮的「已应用」态由未决项的实际选择反推：全部未决项都指向同一侧才算生效，
  // 逐项改过就自动熄灭——既是点击反馈，也不会显示过期的状态。
  function uniformRemotePlanChoice() {
    var keys = remotePlanModel.requiredKeys;
    if (!keys.size) return '';
    var first = '';
    keys.forEach(function (key) { if (!first) first = pendingRemoteResolutions[key]; });
    if (first !== 'local' && first !== 'remote') return '';
    var uniform = true;
    keys.forEach(function (key) { if (pendingRemoteResolutions[key] !== first) uniform = false; });
    return uniform ? first : '';
  }

  function updateRemotePlanBulkButtons() {
    var applied = uniformRemotePlanChoice();
    [['#sync-remote-choose-local', 'local'], ['#sync-remote-choose-remote', 'remote']].forEach(function (pair) {
      var btn = $(pair[0]);
      if (!btn) return;
      var on = (applied === pair[1]);
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? T('全部未决项当前都采用这一侧（逐项改动后会取消）') : '';
    });
  }

  function batchSetRemotePlanChoices(choice) {
    if (!pendingRemotePlan) return;
    var label = choice === 'local' ? T('采用本机版本') : T('采用远端版本');
    var changed = 0;
    var undecided = 0;
    for (var i = 0; i < remotePlanModel.items.length; i++) {
      var item = remotePlanModel.items[i];
      if (pendingRemoteResolutions[item.key] !== choice) changed++;
      pendingRemoteResolutions[item.key] = choice;
      if (item.isRequired) {
        if (!remotePlanModel.resolvedKeys.has(item.key)) undecided++;
        remotePlanModel.resolvedKeys.add(item.key);
      }
    }
    updateRemotePlanApplyButton();
    remotePlanModel.rowMap.forEach(function (row) {
      updateRemotePlanRowVisual(row, choice);
    });
    updateRemotePlanSummary();
    updateRemotePlanBulkButtons();
    // 列表可能滚在别处、行也未必在视口里，点完必须当场有回音
    toast(changed
      ? T('✓ 已将 ') + changed + T(' 项设为「') + label + '」' + (undecided ? T('，未决项已全部有选择') : '')
      : T('所有条目本来就是「') + label + '」');
  }

  function createRemotePlanRow(item) {
    var key = item.key;
    var row = document.createElement('div');
    row.className = 'remote-plan-row';
    row.dataset.remoteConflictKey = key;
    var head = document.createElement('div');
    head.className = 'remote-plan-row-head';
    head.textContent = item.label;
    var hint = document.createElement('small');
    hint.textContent = item.hint;
    head.appendChild(hint);
    row.appendChild(head);

    var curChoice = pendingRemoteResolutions[key];

    if (item.kind === 'conflict') {
      var values = document.createElement('div');
      values.className = 'remote-plan-values';
      var localBox = document.createElement('div');
      localBox.className = 'remote-plan-value' + (curChoice === 'local' ? ' selected' : '');
      var localText = document.createElement('div');
      localText.textContent = remotePlanValue(item.localVal);
      localBox.appendChild(localText);
      var localBtn = document.createElement('button');
      localBtn.type = 'button';
      localBtn.className = 'btn' + (curChoice === 'local' ? ' selected' : '');
      localBtn.dataset.remoteChoice = 'local';
      localBtn.textContent = T('采用本机版本');
      localBox.appendChild(localBtn);
      values.appendChild(localBox);

      var remoteBox = document.createElement('div');
      remoteBox.className = 'remote-plan-value' + (curChoice === 'remote' ? ' selected' : '');
      var remoteText = document.createElement('div');
      remoteText.textContent = remotePlanValue(item.remoteVal);
      remoteBox.appendChild(remoteText);
      var remoteBtn = document.createElement('button');
      remoteBtn.type = 'button';
      remoteBtn.className = 'btn' + (curChoice === 'remote' ? ' selected' : '');
      remoteBtn.dataset.remoteChoice = 'remote';
      remoteBtn.textContent = T('采用远端版本');
      remoteBox.appendChild(remoteBtn);
      values.appendChild(remoteBox);

      row.appendChild(values);
    } else {
      var buttons = document.createElement('div');
      buttons.className = 'remote-plan-toolbar';
      var keepBtn = document.createElement('button');
      keepBtn.type = 'button';
      keepBtn.className = 'btn' + (curChoice === 'local' ? ' selected' : '');
      keepBtn.dataset.remoteChoice = 'local';
      keepBtn.textContent = item.localLabel || T('保留本机');
      buttons.appendChild(keepBtn);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn' + (curChoice === 'remote' ? ' selected' : '');
      removeBtn.dataset.remoteChoice = 'remote';
      removeBtn.textContent = item.remoteLabel || T('从本机移除');
      buttons.appendChild(removeBtn);

      row.appendChild(buttons);
    }
    return row;
  }

  function appendRemotePlanChunk() {
    var list = $('#sync-remote-plan-list');
    if (!list) return;
    var filtered = remotePlanModel.filteredItems;
    var start = remotePlanModel.renderedCount;
    if (start >= filtered.length) return;
    var end = Math.min(filtered.length, start + remotePlanModel.chunkSize);
    var frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) {
      var item = filtered[i];
      var row = createRemotePlanRow(item);
      remotePlanModel.rowMap.set(item.key, row);
      frag.appendChild(row);
    }
    list.appendChild(frag);
    remotePlanModel.renderedCount = end;

    var oldMore = list.querySelector('.remote-plan-more-hint');
    if (oldMore) oldMore.remove();
    if (end < filtered.length) {
      var moreHint = document.createElement('div');
      moreHint.className = 'remote-plan-more-hint';
      moreHint.style.cssText = 'text-align:center;padding:8px;font-size:12px;color:var(--text-muted);cursor:pointer;';
      moreHint.textContent = T('已显示 ') + end + T(' / 共 ') + filtered.length + T(' 项（向下滚动继续加载，或点击此处全部加载）');
      moreHint.addEventListener('click', function () {
        remotePlanModel.chunkSize = filtered.length;
        appendRemotePlanChunk();
      });
      list.appendChild(moreHint);
    }
  }

  function applyRemotePlanFilter(query) {
    remotePlanModel.filterText = String(query || '').trim().toLowerCase();
    if (!remotePlanModel.filterText) {
      remotePlanModel.filteredItems = remotePlanModel.items;
    } else {
      var q = remotePlanModel.filterText;
      remotePlanModel.filteredItems = remotePlanModel.items.filter(function (item) {
        return (item.label && item.label.toLowerCase().indexOf(q) !== -1) ||
          (item.localText && item.localText.toLowerCase().indexOf(q) !== -1) ||
          (item.remoteText && item.remoteText.toLowerCase().indexOf(q) !== -1);
      });
    }
    var list = $('#sync-remote-plan-list');
    if (list) {
      list.innerHTML = '';
      remotePlanModel.renderedCount = 0;
      remotePlanModel.rowMap.clear();
      appendRemotePlanChunk();
    }
  }

  function renderRemotePlan(plan) {
    pendingRemotePlan = plan;
    pendingRemoteResolutions = {};
    remotePlanModel.items = [];
    remotePlanModel.requiredKeys.clear();
    remotePlanModel.resolvedKeys.clear();
    remotePlanModel.renderedCount = 0;
    remotePlanModel.rowMap.clear();
    remotePlanModel.filterText = '';
    remotePlanModel.chunkSize = 60;

    var allConflicts = remotePlanConflicts(plan);
    var conflicts = allConflicts.filter(function (conflict) { return conflict.direction !== 'local-only'; });
    var localOnly = remotePlanLocalOnly(plan);

    // 「本机为空疑似重置」：作为必选决议置顶——不选就不能应用，避免把
    // 「读不到」静默当成「已删除」清空远端。
    if (plan.localEmptyReset) {
      remotePlanModel.requiredKeys.add(LOCAL_EMPTY_RESET_KEY);
      remotePlanModel.items.push({
        key: LOCAL_EMPTY_RESET_KEY,
        kind: 'conflict',
        label: T('⚠ 本机工作区为空（0 篇），同步基线仍有内容'),
        hint: T('本机为空常见于数据库读取失败或切换过数据目录；正常删除会留下墓碑，不会整库消失'),
        localVal: T('本机：空库（0 篇）——选择将按空库覆盖远端'),
        remoteVal: plan.baseRecoveryAvailable
          ? T('上次同步基线：') + plan.baseRecoveryCount + T(' 篇——选择将从本机同步基线恢复双方元数据')
          : T('远端：') + (plan.remoteCount == null ? T('未知') : plan.remoteCount) + T(' 篇——选择将把远端内容拉回本机'),
        localText: T('本机为空库'),
        remoteText: plan.baseRecoveryAvailable ? T('同步基线恢复') : T('远端完整库'),
        isRequired: true
      });
    }

    conflicts.forEach(function (conflict, index) {
      var key = remoteConflictKey(conflict, index);
      remotePlanModel.requiredKeys.add(key);
      remotePlanModel.items.push({
        key: key,
        kind: 'conflict',
        label: remoteConflictLabel(conflict),
        hint: T('请选择一个版本'),
        localVal: conflict.local,
        remoteVal: conflict.remote,
        localText: typeof conflict.local === 'string' ? conflict.local : (conflict.local && (conflict.local.title || conflict.local.name) || ''),
        remoteText: typeof conflict.remote === 'string' ? conflict.remote : (conflict.remote && (conflict.remote.title || conflict.remote.name) || ''),
        isRequired: true
      });
    });

    localOnly.forEach(function (entity, index) {
      var collection = entity && entity.collection || 'papers';
      var value = entity && (entity.entity || entity.value || entity) || {};
      var id = entity && (entity.id || entity.entityId) || value.id || index;
      var key = entity && entity.conflictId || 'local-only:' + collection + ':' + id;
      remotePlanModel.items.push({
        key: key,
        kind: 'local-only',
        label: T('仅本机 · ') + (value.title || value.name || id),
        hint: T('默认保留'),
        localLabel: T('保留本机'),
        remoteLabel: T('从本机移除'),
        localVal: value,
        remoteVal: null,
        localText: value.title || value.name || '',
        remoteText: '',
        isRequired: false
      });
    });

    remotePlanModel.filteredItems = remotePlanModel.items;

    var filterInput = $('#sync-remote-plan-filter');
    if (filterInput) filterInput.value = '';

    resetRemotePlanProgressUi();
    var list = $('#sync-remote-plan-list');
    list.innerHTML = '';
    appendRemotePlanChunk();

    updateRemotePlanSummary();
    updateRemotePlanApplyButton();
    updateRemotePlanBulkButtons();
    $('#sync-remote-plan-mask').hidden = false;
  }

  function inspectRemote() {
    if (!desktop || !desktop.inspectNutstoreRemote) { setSyncInlineStatus('sync-remote-status', T('当前版本不支持远端检查'), 'error'); return; }
    setSyncInlineStatus('sync-remote-status', T('正在只读检查远端…'), 'pending');
    desktop.inspectNutstoreRemote(syncFormValue()).then(function (info) {
      if (info && info.exists === false) {
        var missing = T('未找到远端库文件 · ') + (info.fileUrl || 'litboard-library.json') +
          (info.status ? ' · HTTP ' + info.status : '');
        setSyncInlineStatus('sync-remote-status', missing, 'warning');
        return;
      }
      var paperCount = info && info.counts && info.counts.papers;
      var text = T('远端库文件存在 · ') + (paperCount == null ? T('文献数未知') : (paperCount + T(' 篇'))) +
        (info && info.fileUrl ? ' · ' + info.fileUrl : '');
      if (info && info.config && info.config.exists) text += (info.config.locked ? T(' · 配置已加密（需配置密码）') : T(' · 含可恢复配置'));
      setSyncInlineStatus('sync-remote-status', text, 'success');
    }).catch(function (error) {
      setSyncInlineStatus('sync-remote-status', error && error.message || String(error), 'error');
    });
  }

  function createRemotePlan(mode) {
    if (!desktop || !desktop.createNutstoreSyncPlan) { setSyncInlineStatus('sync-remote-status', T('当前版本不支持远端恢复计划'), 'error'); return; }
    setSyncInlineStatus('sync-remote-status', T('正在读取远端并生成对照…'), 'pending');
    desktop.createNutstoreSyncPlan({ config: syncFormValue(), workspace: workspacePayload(), mode: mode }).then(function (plan) {
      renderRemotePlan(plan || {});
      setSyncInlineStatus('sync-remote-status', T('已生成对照，请完成选择后应用'), 'warning');
    }).catch(function (error) {
      setSyncInlineStatus('sync-remote-status', error && error.message || String(error), 'error');
    });
  }

  function pullRemoteConfig() {
    if (!desktop || !desktop.pullNutstoreConfig) { setSyncInlineStatus('sync-remote-status', T('当前版本不支持独立配置恢复'), 'error'); return; }
    setSyncInlineStatus('sync-remote-status', T('正在恢复远端配置…'), 'pending');
    desktop.pullNutstoreConfig(syncFormValue()).then(function (result) {
      if (!result || !result.found) throw new Error(T('远端没有可用的加密配置'));
      integrationConfig = result.config || integrationConfig;
      if (result.config) {
        applyPortableConfigRuntime(result.config);
        fillSyncForm(result.config);
      }
      setSyncInlineStatus('sync-remote-status', T('配置恢复完成（文献库未改变）'), 'success');
      toast(T('远端配置恢复完成'));
    }).catch(function (error) {
      setSyncInlineStatus('sync-remote-status', error && error.message || String(error), 'error');
    });
  }

  function closeRemotePlanDialog() {
    if (remotePlanApplying) return; // 应用进行中不允许关闭，避免同步落库到一半丢 UI
    $('#sync-remote-plan-mask').hidden = true;
    pendingRemotePlan = null;
    pendingRemoteResolutions = {};
    remotePlanModel.items = [];
    remotePlanModel.filteredItems = [];
    remotePlanModel.rowMap.clear();
    remotePlanModel.requiredKeys.clear();
    remotePlanModel.resolvedKeys.clear();
    var planList = $('#sync-remote-plan-list');
    if (planList) planList.innerHTML = '';
    var filterInput = $('#sync-remote-plan-filter');
    if (filterInput) filterInput.value = '';
  }

  function setRemotePlanApplying(applying) {
    remotePlanApplying = applying;
    var progress = $('#sync-remote-plan-progress');
    var list = $('#sync-remote-plan-list');
    var filterInput = $('#sync-remote-plan-filter');
    var toolbar = filterInput && filterInput.parentElement;
    if (progress) progress.hidden = !applying;
    if (list) list.hidden = applying;
    if (toolbar) toolbar.hidden = applying;
  }

  function setRemotePlanProgress(payload) {
    if (!payload) return;
    var text = $('#sync-remote-plan-progress-text');
    var percent = $('#sync-remote-plan-progress-percent');
    var bar = $('#sync-remote-plan-progress-bar');
    if (text && payload.message) text.textContent = payload.message;
    if (!bar) return;
    if (payload.phase === 'assets' && payload.total > 0) {
      bar.max = payload.total;
      bar.value = Math.max(0, Math.min(payload.done, payload.total));
      if (percent) percent.textContent = Math.round((bar.value / bar.max) * 100) + '%';
    } else if (payload.phase === 'done') {
      bar.max = 100;
      bar.value = 100;
      if (percent) percent.textContent = '100%';
    } else {
      // 校验/写入/配置阶段总量未知：进度条走不确定态动画
      bar.removeAttribute('value');
      if (percent) percent.textContent = '';
    }
  }

  function resetRemotePlanProgressUi() {
    setRemotePlanApplying(false);
    var cancelButton = $('#sync-remote-plan-cancel');
    if (cancelButton) {
      cancelButton.disabled = false;
      cancelButton.textContent = T('取消');
    }
    var applyButton = $('#sync-remote-plan-apply');
    if (applyButton) {
      applyButton.hidden = false;
      applyButton.textContent = T('应用选择并同步');
    }
  }

  function setRemotePlanCompleted(message) {
    remotePlanApplying = false;
    var progress = $('#sync-remote-plan-progress');
    var list = $('#sync-remote-plan-list');
    var filterInput = $('#sync-remote-plan-filter');
    var toolbar = filterInput && filterInput.parentElement;
    if (progress) progress.hidden = false;
    if (list) list.hidden = true;
    if (toolbar) toolbar.hidden = true;
    setRemotePlanProgress({ phase: 'done', message: message || T('同步完成') });
    var cancelButton = $('#sync-remote-plan-cancel');
    if (cancelButton) {
      cancelButton.disabled = false;
      cancelButton.textContent = T('关闭');
    }
    var applyButton = $('#sync-remote-plan-apply');
    if (applyButton) applyButton.hidden = true;
  }

  function handleSyncProgress(payload) {
    if (!payload) return;
    if (remotePlanApplying) {
      if (payload.scope === 'apply-plan' && payload.planId === remotePlanId(pendingRemotePlan)) {
        setRemotePlanProgress(payload);
      }
      return;
    }
    // 后台自动同步：设置弹窗开着时把阶段信息透出到状态行
    if (payload.message && syncBusy) {
      var status = $('#sync-status');
      var mask = $('#sync-mask');
      if (status && mask && !mask.hidden) status.textContent = payload.message;
    }
  }

  function applyRemotePlan() {
    if (!pendingRemotePlan || !desktop || !desktop.applyNutstoreSyncPlan) return;
    if (remotePlanApplying) return;
    var planMode = pendingRemotePlan.mode;
    var button = $('#sync-remote-plan-apply'); button.disabled = true;
    var cancelButton = $('#sync-remote-plan-cancel'); if (cancelButton) cancelButton.disabled = true;
    setRemotePlanApplying(true);
    setRemotePlanProgress({ phase: 'verify', message: T('正在校验远端版本…') });
    setSyncInlineStatus('sync-remote-status', T('正在校验远端版本并应用…'), 'pending');
    var applyAssetFailures = 0;
    desktop.applyNutstoreSyncPlan({ planId: remotePlanId(pendingRemotePlan), resolutions: pendingRemoteResolutions }).then(function (result) {
      var workspace = result && result.workspace ? result.workspace : result;
      applyAssetFailures = result && result.assets && result.assets.failures ? result.assets.failures.length : 0;
      if (workspace && workspace.papers) {
        return applySyncedWorkspace(workspace, true).then(function () {
          setSyncIndicator('ok');
          if (desktop.getIntegrationConfig) return desktop.getIntegrationConfig().catch(function () { return null; });
          return null;
        });
      }
      if (desktop.getIntegrationConfig) return desktop.getIntegrationConfig().catch(function () { return null; });
      return null;
    }).then(function (config) {
      if (config) {
        applyPortableConfigRuntime(config);
        fillSyncForm(config);
      }
      var label = planMode === 'merge' ? T('同步对照已应用') : T('远端恢复完成');
      if (applyAssetFailures) label += '（' + applyAssetFailures + T(' 个附件失败，下次同步自动续传）');
      setSyncInlineStatus('sync-remote-status', label, applyAssetFailures ? 'warning' : 'success');
      setRemotePlanCompleted(label);
      toast(label);
    }).catch(function (error) {
      resetRemotePlanProgressUi();
      button.disabled = false;
      setSyncInlineStatus('sync-remote-status', error && error.message || String(error), 'error');
    });
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
      if (!silent) throw new Error(T('请先配置坚果云账号和应用密码'));
      return Promise.resolve(false);
    }
    syncBusy = true;
    setSyncIndicator('syncing');
    if (!silent) { $('#sync-status').classList.remove('error'); $('#sync-status').textContent = T('正在同步…'); }
    var current = workspacePayload();
    var syncRevision = workspaceRevision;
    var chain = Promise.resolve(current);
    if (useNutstore) chain = chain.then(function (workspace) { return desktop.syncNutstore(workspace); });
    return chain.then(function (result) {
      if (result && (result.pendingPlan || result.plan)) {
        renderRemotePlan(result.pendingPlan || result.plan);
        setSyncInlineStatus('sync-remote-status', T('后台同步发现冲突，远端写入已暂停'), 'warning');
        if (!silent) $('#sync-status').textContent = T('同步发现冲突，请完成远端对照');
        return false;
      }
      var workspace = result && result.workspace ? result.workspace : result;
      if (workspaceRevision !== syncRevision) {
        scheduleNutstoreSync(true); // 本次同步已在进行中，收尾重排队不受自动同步开关影响
        if (!silent) $('#sync-status').textContent = T('检测到新的本地修改，已重新排队同步');
        return true;
      }
      return applySyncedWorkspace(workspace, true).then(function () {
        if (result && result.config && refreshSyncFormAfterSync) {
          integrationConfig = result.config;
          applyPortableConfigRuntime(result.config);
          fillSyncForm(result.config);
          refreshSyncFormAfterSync = false;
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
      setSyncIndicator('error', error && error.message || String(error));
      if (!silent) {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = error && error.message || String(error);
      }
      if (!silent) toast(T('同步失败：') + (error && error.message || error));
      return false;
    }).finally(function () {
      syncBusy = false;
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

  // ---------- 主题（GitHub 流行 Top 5 亮暗主题体系） ----------
  var THEMES = [
    'auto',
    'light-github', 'light-catppuccin', 'light-solarized', 'light-onelight', 'light-gruvbox',
    'dark-catppuccin', 'dark-dracula', 'dark-tokyonight', 'dark-nord', 'dark-onedark'
  ];
  var THEME_INFO = {
    'auto':             { label: T('跟随系统'), group: 'auto', icon: 'lb-i-theme-auto' },
    'light':            { label: 'GitHub Light', group: 'light', dot: 'theme-github', icon: 'lb-i-sun' },
    'light-github':     { label: 'GitHub Light', group: 'light', dot: 'theme-github', icon: 'lb-i-sun' },
    'light-catppuccin': { label: 'Catppuccin Latte', group: 'light', dot: 'theme-catppuccin-latte', icon: 'lb-i-sun' },
    'light-solarized':  { label: 'Solarized Light', group: 'light', dot: 'theme-solarized-light', icon: 'lb-i-sun' },
    'light-onelight':   { label: 'One Light', group: 'light', dot: 'theme-onelight', icon: 'lb-i-sun' },
    'light-gruvbox':    { label: 'Gruvbox Light', group: 'light', dot: 'theme-gruvbox-light', icon: 'lb-i-sun' },
    'dark':             { label: 'Catppuccin Mocha', group: 'dark', dot: 'theme-catppuccin-mocha', icon: 'lb-i-moon' },
    'dark-catppuccin':  { label: 'Catppuccin Mocha', group: 'dark', dot: 'theme-catppuccin-mocha', icon: 'lb-i-moon' },
    'dark-dracula':     { label: 'Dracula', group: 'dark', dot: 'theme-dracula', icon: 'lb-i-moon' },
    'dark-tokyonight':  { label: 'Tokyo Night', group: 'dark', dot: 'theme-tokyonight', icon: 'lb-i-moon' },
    'dark-nord':        { label: 'Nord', group: 'dark', dot: 'theme-nord', icon: 'lb-i-moon' },
    'dark-onedark':     { label: 'One Dark', group: 'dark', dot: 'theme-onedark', icon: 'lb-i-moon' }
  };
  var THEME_LABEL = {
    auto: T('跟随系统'),
    light: 'GitHub Light',
    'light-github': 'GitHub Light',
    'light-catppuccin': 'Catppuccin Latte',
    'light-solarized': 'Solarized Light',
    'light-onelight': 'One Light',
    'light-gruvbox': 'Gruvbox Light',
    dark: 'Catppuccin Mocha',
    'dark-catppuccin': 'Catppuccin Mocha',
    'dark-dracula': 'Dracula',
    'dark-tokyonight': 'Tokyo Night',
    'dark-nord': 'Nord',
    'dark-onedark': 'One Dark'
  };
  var THEME_ICON = {
    auto: 'lb-i-theme-auto',
    light: 'lb-i-sun',
    'light-github': 'lb-i-sun',
    'light-catppuccin': 'lb-i-sun',
    'light-solarized': 'lb-i-sun',
    'light-onelight': 'lb-i-sun',
    'light-gruvbox': 'lb-i-sun',
    dark: 'lb-i-moon',
    'dark-catppuccin': 'lb-i-moon',
    'dark-dracula': 'lb-i-moon',
    'dark-tokyonight': 'lb-i-moon',
    'dark-nord': 'lb-i-moon',
    'dark-onedark': 'lb-i-moon'
  };

  function applyTheme(t) {
    var root = document.documentElement;
    // 切换瞬间禁用过渡：Chromium 下仅 color-scheme 变化时，带 background-color
    // 过渡的元素不会重解析 light-dark()，会整片卡在旧色（css 里有 .theme-switching 说明）
    root.classList.add('theme-switching');
    if (t === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', t);
    }
    var info = THEME_INFO[t] || THEME_INFO.auto;
    var themeBtn = $('#btn-theme');
    if (themeBtn) {
      themeBtn.innerHTML = svgUse(info.icon || THEME_ICON[t] || THEME_ICON.auto);
      themeBtn.title = T('主题：') + (info.label || THEME_LABEL[t] || THEME_LABEL.auto) + T('（点击切换）');
    }
    var syncThemeSelect = $('#sync-theme-select');
    if (syncThemeSelect && syncThemeSelect.value !== t) {
      syncThemeSelect.value = t;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { root.classList.remove('theme-switching'); });
    });
  }

  function setTheme(t) {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    var info = THEME_INFO[t] || THEME_INFO.auto;
    toast(T('已应用主题：') + (info.label || THEME_LABEL[t] || t));
  }

  /* 语言切换：词典 + 静态骨架即时重译，动态区域走全量重渲染；无需重启。
   * 同时把解析后的语言镜像进 settings 表，主进程原生对话框据此取文案。 */
  function applyLanguage(value) {
    if (!window.LitI18n) return;
    window.LitI18n.setLang(value);
    document.documentElement.lang = window.LitI18n.getLang();
    window.LitI18n.applyStatic(document);
    renderAll();
    renderPdfTabs();
    if (desktop && desktop.setSetting) {
      desktop.setSetting('uiLang', window.LitI18n.getLang()).catch(function () {});
    }
    toast(window.LitI18n.getLang() === 'en' ? 'Interface language: English' : '界面语言：简体中文');
  }

  function cycleTheme() {
    var cur = localStorage.getItem(THEME_KEY) || 'auto';
    var idx = THEMES.indexOf(cur);
    if (idx === -1) {
      if (cur === 'light') idx = THEMES.indexOf('light-github');
      else if (cur === 'dark') idx = THEMES.indexOf('dark-catppuccin');
      else idx = 0;
    }
    var next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next);
  }

  function showThemeMenu() {
    var cur = localStorage.getItem(THEME_KEY) || 'auto';
    var btn = $('#btn-theme');
    if (!btn) return;
    var rect = btn.getBoundingClientRect();

    var isCur = function (key) {
      if (cur === key) return true;
      if (key === 'light-github' && cur === 'light') return true;
      if (key === 'dark-catppuccin' && cur === 'dark') return true;
      return false;
    };

    var items = [
      { header: T('界面与主题') },
      {
        label: T('跟随系统 (Auto)') + (cur === 'auto' ? '  ✓' : ''),
        icon: 'lb-i-theme-auto',
        fn: function () { setTheme('auto'); }
      },
      'sep',
      { header: T('浅色主题 (GitHub Top 5)') },
      {
        label: T('GitHub Light（经典白）') + (isCur('light-github') ? '  ✓' : ''),
        dot: 'theme-github',
        fn: function () { setTheme('light-github'); }
      },
      {
        label: T('Catppuccin Latte（柔和浅色）') + (isCur('light-catppuccin') ? '  ✓' : ''),
        dot: 'theme-catppuccin-latte',
        fn: function () { setTheme('light-catppuccin'); }
      },
      {
        label: T('Solarized Light（日耀米黄）') + (isCur('light-solarized') ? '  ✓' : ''),
        dot: 'theme-solarized-light',
        fn: function () { setTheme('light-solarized'); }
      },
      {
        label: T('One Light（原子浅灰）') + (isCur('light-onelight') ? '  ✓' : ''),
        dot: 'theme-onelight',
        fn: function () { setTheme('light-onelight'); }
      },
      {
        label: T('Gruvbox Light（复古羊皮）') + (isCur('light-gruvbox') ? '  ✓' : ''),
        dot: 'theme-gruvbox-light',
        fn: function () { setTheme('light-gruvbox'); }
      },
      'sep',
      { header: T('深色主题 (GitHub Top 5)') },
      {
        label: T('Catppuccin Mocha（经典摩卡）') + (isCur('dark-catppuccin') ? '  ✓' : ''),
        dot: 'theme-catppuccin-mocha',
        fn: function () { setTheme('dark-catppuccin'); }
      },
      {
        label: T('Dracula（德古拉紫）') + (isCur('dark-dracula') ? '  ✓' : ''),
        dot: 'theme-dracula',
        fn: function () { setTheme('dark-dracula'); }
      },
      {
        label: T('Tokyo Night（东京夜色）') + (isCur('dark-tokyonight') ? '  ✓' : ''),
        dot: 'theme-tokyonight',
        fn: function () { setTheme('dark-tokyonight'); }
      },
      {
        label: T('Nord（极光冷灰）') + (isCur('dark-nord') ? '  ✓' : ''),
        dot: 'theme-nord',
        fn: function () { setTheme('dark-nord'); }
      },
      {
        label: T('One Dark（原子深灰）') + (isCur('dark-onedark') ? '  ✓' : ''),
        dot: 'theme-onedark',
        fn: function () { setTheme('dark-onedark'); }
      }
    ];

    showCtxMenu(rect.left - 120, rect.bottom + 6, items);
  }

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
    // 右栏图标轨（详情 / AI 助手 / 手动检索）在 agentui 内部绑定，此处不重复
    // 更多菜单（顶栏瘦身：低频操作收进这里）
    $('#btn-more').addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = $('#more-menu');
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function () { $('#more-menu').hidden = true; });
    $('#more-menu').addEventListener('click', function () { $('#more-menu').hidden = true; });
    bindAgentSettings();
    $('#word-panel-close').addEventListener('click', closeWordPanel);
    $('#bridge-panel-close').addEventListener('click', closeBridgePanel);
    $('#word-panel-mask').addEventListener('click', function (e) { if (e.target === this) closeWordPanel(); });
    $('#bridge-panel-mask').addEventListener('click', function (e) { if (e.target === this) closeBridgePanel(); });
    $('#sync-nav').addEventListener('click', function (e) {
      var btn = e.target.closest('.sync-nav-btn');
      if (btn) activateSyncGroup(btn.dataset.syncGroup);
    });
    $('#sync-close').addEventListener('click', closeSyncSettings);
    // 设置项改动即自动保存：文本输入在失焦/回车时（change），勾选与下拉即时
    ['sync-nutstore-url', 'sync-nutstore-user', 'sync-nutstore-password', 'sync-nutstore-folder',
      'sync-zotero-webdav-folder', 'sync-translator-provider', 'sync-translator-target',
      'sync-translator-model', 'sync-translator-api-key', 'sync-rank-provider',
      'sync-scigreat-api-key', 'sync-easyscholar-api-key',
      'sync-rename-template', 'sync-proxy-prefix', 'sync-trash-days',
      'sync-auto-writeback', 'sync-auto-sync'
    ].forEach(function (id) {
      $('#' + id).addEventListener('change', queueSyncAutoSave);
    });
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
    $('#sync-choose-config-dir').addEventListener('click', function () { chooseDataPath('config'); });
    $('#sync-choose-library-dir').addEventListener('click', function () { chooseDataPath('library'); });
    $('#sync-data-paths-apply').addEventListener('click', applyDataPathChanges);
    $('#sync-backup-choose').addEventListener('click', chooseBackupDir);
    $('#sync-backup-keep-apply').addEventListener('click', applyBackupKeep);
    $('#sync-backup-cleanup').addEventListener('click', cleanBackupLeftovers);
    $('#sync-backup-now').addEventListener('click', runBackupNow);
    $('#sync-backup-restore').addEventListener('click', restoreFromBackup);
    $('#sync-backup-open').addEventListener('click', openBackupDir);
    $('#sync-remote-inspect').addEventListener('click', inspectRemote);
    $('#sync-remote-config').addEventListener('click', pullRemoteConfig);
    $('#sync-remote-restore').addEventListener('click', function () { createRemotePlan('restore'); });
    $('#sync-remote-merge').addEventListener('click', function () { createRemotePlan('merge'); });
    $('#sync-remote-plan-cancel').addEventListener('click', closeRemotePlanDialog);
    $('#sync-remote-plan-apply').addEventListener('click', applyRemotePlan);
    $('#sync-remote-choose-local').addEventListener('click', function () {
      batchSetRemotePlanChoices('local');
    });
    $('#sync-remote-choose-remote').addEventListener('click', function () {
      batchSetRemotePlanChoices('remote');
    });

    var planList = $('#sync-remote-plan-list');
    if (planList) {
      planList.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-remote-choice]');
        if (!btn) return;
        var row = btn.closest('[data-remote-conflict-key]');
        if (!row) return;
        var key = row.dataset.remoteConflictKey;
        var choice = btn.dataset.remoteChoice;
        setRemotePlanChoice(key, choice);
      });
      planList.addEventListener('scroll', function () {
        if (remotePlanModel.scrollTicking) return;
        remotePlanModel.scrollTicking = true;
        requestAnimationFrame(function () {
          remotePlanModel.scrollTicking = false;
          if (planList.scrollTop + planList.clientHeight >= planList.scrollHeight - 200) {
            appendRemotePlanChunk();
          }
        });
      });
    }

    var planFilter = $('#sync-remote-plan-filter');
    if (planFilter) {
      planFilter.addEventListener('input', debounce(function () {
        applyRemotePlanFilter(planFilter.value);
      }, 150));
    }
    $('#sync-translator-provider').addEventListener('change', updateTranslatorFields);
    $('#sync-translator-auto').addEventListener('change', function () { setTranslatorAutoTranslate(this.checked, true); });
    $('#sync-save').addEventListener('click', function () {
      cancelSyncAutoSave();
      saveSyncSettings().catch(function (error) {
        $('#sync-status').classList.add('error');
        $('#sync-status').textContent = error && error.message || String(error);
      });
    });
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
        scigreatApiKey: $('#sync-scigreat-api-key').value,
        easyscholarApiKey: $('#sync-easyscholar-api-key').value,
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
    $('#sync-run').addEventListener('click', function () {
      cancelSyncAutoSave();
      saveSyncSettings().then(function (config) { return performSync(config, false); });
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
    $('#sync-bib-export-choose').addEventListener('click', function () {
      if (!desktop || !desktop.chooseSavePath) return;
      desktop.chooseSavePath({
        title: T('选择自动导出的 .bib 文件'), name: 'library.bib',
        filters: [{ name: T('BibTeX 文件'), extensions: ['bib'] }]
      }).then(function (filePath) {
        if (filePath) { $('#sync-bib-export-path').value = filePath; queueSyncAutoSave(); }
      }).catch(function () {});
    });
    $('#sync-bib-export-clear').addEventListener('click', function () {
      $('#sync-bib-export-path').value = '';
      queueSyncAutoSave();
    });
    $('#sync-pdf-download-dir-choose').addEventListener('click', function () {
      if (!desktop || !desktop.chooseDirectory) return;
      desktop.chooseDirectory({ title: T('选择 PDF 自动下载目录') }).then(function (dirPath) {
        if (dirPath) { $('#sync-pdf-download-dir').value = dirPath; queueSyncAutoSave(); }
      }).catch(function () {});
    });
    $('#sync-pdf-download-dir-clear').addEventListener('click', function () {
      $('#sync-pdf-download-dir').value = '';
      queueSyncAutoSave();
    });
    $('#sync-bridge-copy-token').addEventListener('click', function () {
      if (!bridgeTokenCache) { toast(T('令牌未生成')); return; }
      copyToClipboard(bridgeTokenCache).then(function () { toast(T('✓ 令牌已复制')); });
    });
    $('#sync-clear-pdf-cache').addEventListener('click', function () {
      dlgConfirm(T('删除全文索引'), T('删除 PDF 全文索引？下次全文检索时会重新提取正文（耗时取决于文献数量）。'), T('删除索引'), true).then(function (ok) {
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
    // ---------- Zotero 导入向导（选择来源 → 扫描预览 → 导入 → 核对报告） ----------
    var zoteroWiz = { step: 'source', dir: '', scan: null, report: null, busy: false, offProgress: null };
    var ZOTERO_WIZ_LABELS = { source: T('选择来源'), preview: T('扫描预览'), progress: T('导入'), report: T('核对报告') };
    var ZOTERO_WIZ_ORDER = ['source', 'preview', 'progress', 'report'];

    function zoteroWizRender() {
      var index = ZOTERO_WIZ_ORDER.indexOf(zoteroWiz.step);
      $('#zotero-wiz-step-label').textContent = T('第 ') + (index + 1) + T(' 步 / 共 4 步：') + ZOTERO_WIZ_LABELS[zoteroWiz.step];
      $all('#zotero-import-mask .zotero-wiz-step').forEach(function (el) {
        el.hidden = el.dataset.zoteroStep !== zoteroWiz.step;
      });
      $('#zotero-wiz-back').hidden = zoteroWiz.step !== 'preview' || zoteroWiz.busy;
      $('#zotero-wiz-cancel').textContent = zoteroWiz.step === 'report' ? T('关闭') : T('取消');
      $('#zotero-wiz-cancel').disabled = zoteroWiz.busy;
      $('#zotero-wiz-export').hidden = zoteroWiz.step !== 'report';
      var next = $('#zotero-wiz-next');
      next.disabled = zoteroWiz.busy || (zoteroWiz.step === 'source' && !zoteroWiz.dir);
      next.hidden = zoteroWiz.step === 'progress';
      next.textContent = zoteroWiz.step === 'report' ? T('完成')
        : zoteroWiz.step === 'preview' ? T('开始导入') : T('下一步');
      if (zoteroWiz.step === 'preview' && zoteroWiz.scan) {
        var s = zoteroWiz.scan.stats;
        $('#zotero-wiz-stats').innerHTML = '<table class="zotero-report-table">' +
          T('<tr><td>条目</td><td>') + s.source.items + '</td></tr>' +
          T('<tr><td>笔记</td><td>') + s.source.notes + '</td></tr>' +
          T('<tr><td>附件</td><td>') + s.source.attachments + '</td></tr>' +
          T('<tr><td>批注</td><td>') + s.source.annotations + '</td></tr>' +
          T('<tr><td>文件夹</td><td>') + s.source.collections + '</td></tr>' +
          T('<tr><td>标签</td><td>') + s.source.tags + '</td></tr>' +
          (s.missing ? T('<tr><td>缺失/未下载附件</td><td>') + s.missing + '</td></tr>' : '') +
          (s.unconverted ? T('<tr><td>保留原始表示的内容</td><td>') + s.unconverted + '</td></tr>' : '') +
          (s.failures ? T('<tr><td>无法读取的条目</td><td>') + s.failures + '</td></tr>' : '') +
          '</table>';
      }
    }

    function zoteroWizGo(step) { zoteroWiz.step = step; zoteroWizRender(); }

    function openZoteroWizard() {
      if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
      zoteroWiz = { step: 'source', dir: $('#sync-zotero-dir').value.trim(), scan: null, report: null, busy: false, offProgress: null };
      $('#zotero-wiz-dir').value = zoteroWiz.dir;
      $('#zotero-wiz-source-status').textContent = '';
      $('#zotero-import-mask').hidden = false;
      zoteroWizRender();
    }

    function closeZoteroWizard() {
      if (zoteroWiz.busy) return;
      if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
      $('#zotero-import-mask').hidden = true;
    }

    function zoteroWizFail(message) {
      zoteroWiz.busy = false;
      $('#zotero-wiz-source-status').textContent = message;
      zoteroWizRender();
      toast('⚠ ' + message);
    }

    function zoteroWizScan() {
      zoteroWiz.busy = true;
      $('#zotero-wiz-source-status').textContent = T('正在只读扫描 Zotero 库…');
      zoteroWizRender();
      desktop.scanZoteroLibrary({ dir: zoteroWiz.dir }).then(function (result) {
        zoteroWiz.busy = false;
        zoteroWiz.scan = result;
        zoteroWizGo('preview');
      }).catch(function (error) {
        zoteroWizFail(error && error.message || String(error));
      });
    }

    function zoteroWizReportGroup(title, items, format) {
      if (!items || !items.length) return '';
      return '<details class="zotero-report-group"><summary>' + esc(title) + '（' + items.length + '）</summary>' +
        '<ul class="zotero-report-list">' + items.slice(0, 500).map(function (item) {
          return '<li>' + esc(format(item)) + '</li>';
        }).join('') + (items.length > 500 ? T('<li>…（其余 ') + (items.length - 500) + T(' 条见导出报告）</li>') : '') +
        '</ul></details>';
    }

    function zoteroWizShowReport(importResult, mergeResult) {
      var report = importResult.report;
      var imp = report.imported;
      var stats = mergeResult.stats;
      var html = '<table class="zotero-report-table">' +
        T('<tr><td>新增条目</td><td>') + stats.papersAdded + '</td></tr>' +
        T('<tr><td>补缺更新条目</td><td>') + stats.papersUpdated + '</td></tr>' +
        T('<tr><td>新增附件</td><td>') + stats.attachmentsAdded + T('（复制文件 ') + imp.assetsCopied +
          (imp.assetsSkipped ? T('，跳过已存在 ') + imp.assetsSkipped : '') + '）</td></tr>' +
        T('<tr><td>新增笔记</td><td>') + stats.notesAdded + (stats.notesSkipped ? T('（已有 ') + stats.notesSkipped + T(' 条未覆盖）') : '') + '</td></tr>' +
        T('<tr><td>导入批注</td><td>') + (imp.annotations + stats.annotationsAdded) + '</td></tr>' +
        T('<tr><td>文件夹 / 标签颜色</td><td>') + imp.folders + ' / ' + imp.tagColors + '</td></tr>' +
        '</table>';
      html += zoteroWizReportGroup(T('缺失 / 未下载的附件（可稍后用「迁移云附件」补齐）'), report.missing, function (m) {
        return (m.fileName || m.zoteroKey) + ' — ' + ({ 'not-found': T('源文件不存在'), 'relative-no-base': T('相对路径缺少基准目录'), 'annotation-orphan': T('批注找不到所属附件') })[m.reason] || m.reason;
      });
      html += zoteroWizReportGroup(T('失败项（不影响其余内容导入）'), report.failures, function (f) {
        return '[' + f.kind + '] ' + f.key + ' — ' + f.message;
      });
      html += zoteroWizReportGroup(T('保留原始表示的内容'), report.unconverted, function (u) {
        return '[' + u.kind + '] ' + u.key + (u.detail ? ' — ' + u.detail : '');
      });
      html += zoteroWizReportGroup(T('字段差异（已保留本地值，未覆盖）'), mergeResult.conflicts, function (c) {
        return c.field + T('：本地「') + (c.localValue || T('（空）')) + '」 ≠ Zotero「' + (c.zoteroValue || T('（空）')) + '」';
      });
      $('#zotero-wiz-report').innerHTML = html || T('<p class="field-hint">没有可导入的内容。</p>');
      zoteroWiz.report = { import: report, merge: { stats: mergeResult.stats, conflicts: mergeResult.conflicts } };
      zoteroWizGo('report');
    }

    function zoteroWizImport() {
      zoteroWiz.busy = true;
      zoteroWizGo('progress');
      var existing = { attachmentKeys: [], noteKeys: [], paperKeys: [] };
      state.papers.forEach(function (p) {
        if (p.zoteroKey) existing.paperKeys.push(p.zoteroKey);
        (p.attachments || []).forEach(function (a) {
          if (a.zoteroKey && a.path && String(a.path).trim()) existing.attachmentKeys.push(a.zoteroKey);
        });
      });
      (state.notes || []).forEach(function (n) { if (n.zoteroKey) existing.noteKeys.push(n.zoteroKey); });
      if (desktop.onZoteroProgress) {
        zoteroWiz.offProgress = desktop.onZoteroProgress(function (payload) {
          if (!payload || zoteroWiz.step !== 'progress') return;
          var total = payload.total || 0, done = payload.done || 0;
          $('#zotero-wiz-progress').max = Math.max(total, 1);
          $('#zotero-wiz-progress').value = done;
          $('#zotero-wiz-progress-text').textContent = T('正在复制附件文件… ') + done + ' / ' + total;
        });
      }
      desktop.importZoteroLibrary({
        dir: zoteroWiz.dir,
        copyFiles: $('#zotero-wiz-copy').checked,
        existing: existing
      }).then(function (result) {
        var mergeResult = mergeZoteroImport({
          papers: state.papers, notes: state.notes, folders: state.folders.concat(state.folderTombstones),
          tagColorRecords: state.tagColorRecords
        }, result.workspace);
        return applySyncedWorkspace(mergeResult.workspace).then(function () {
          zoteroWiz.busy = false;
          if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
          zoteroWizShowReport(result, mergeResult);
          toast(T('✓ Zotero 导入完成：新增 ') + mergeResult.stats.papersAdded + T(' 篇'));
        });
      }).catch(function (error) {
        if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
        zoteroWizGo('source');
        zoteroWizFail(error && error.message || String(error));
      });
    }

    $('#zotero-wiz-detect').addEventListener('click', function () {
      $('#zotero-wiz-source-status').textContent = T('正在检测…');
      desktop.detectZoteroDataDir().then(function (dir) {
        zoteroWiz.dir = dir || '';
        $('#zotero-wiz-dir').value = zoteroWiz.dir;
        $('#zotero-wiz-source-status').textContent = dir ? T('已找到：') + dir : T('未找到 Zotero 数据目录');
        zoteroWizRender();
      });
    });
    $('#zotero-wiz-choose').addEventListener('click', function () {
      desktop.chooseZoteroDataDir().then(function (dir) {
        if (dir) {
          zoteroWiz.dir = dir;
          $('#zotero-wiz-dir').value = dir;
          $('#zotero-wiz-source-status').textContent = T('已选择：') + dir;
          zoteroWizRender();
        } else {
          $('#zotero-wiz-source-status').textContent = T('所选目录不是有效的 Zotero 数据目录');
        }
      });
    });
    $('#zotero-wiz-next').addEventListener('click', function () {
      if (zoteroWiz.step === 'source') zoteroWizScan();
      else if (zoteroWiz.step === 'preview') zoteroWizImport();
      else if (zoteroWiz.step === 'report') closeZoteroWizard();
    });
    $('#zotero-wiz-back').addEventListener('click', function () {
      if (zoteroWiz.step === 'preview') zoteroWizGo('source');
    });
    $('#zotero-wiz-cancel').addEventListener('click', closeZoteroWizard);
    $('#zotero-wiz-export').addEventListener('click', function () {
      if (!zoteroWiz.report) return;
      download('zotero-import-report-' + stamp() + '.json', JSON.stringify(zoteroWiz.report, null, 2), 'application/json');
    });

    $('#sync-import-zotero').addEventListener('click', function () {
      openZoteroWizard();
    });
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
    $('#folder-list').addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-folder]');
      if (toggle) { toggleFolder(toggle.dataset.toggleFolder); return; }
      var addChild = e.target.closest('[data-parent-folder]');
      if (addChild) { openFolderCreator(addChild.dataset.parentFolder); return; }
      var del = e.target.closest('[data-delete-folder]');
      if (del) { deleteFolder(del.dataset.deleteFolder); return; }
      var item = e.target.closest('[data-folder]');
      if (item) { selectFolder(item.dataset.folder, { multi: e.ctrlKey || e.metaKey });  }
    });
    // 文件夹右键菜单（Zotero 式：新建/子文件夹/重命名/删除）
    $('#folder-list').addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.folder-item[data-folder]');
      if (row) {
        var folder = state.folders.find(function (f) { return f.id === row.dataset.folder; });
        if (!folder) return;
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, buildFolderCtxItems(folder));
      } else {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, [
          { label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } }
        ]);
      }
    });
    $('#folder-empty').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, [
        { label: T('新建文件夹'), icon: 'lb-i-folder-new', fn: function () { openFolderCreator(''); } }
      ]);
    });
    // 文件夹拖拽排序
    var folderDragId = null;
    // 当前预览对应的落点（目标行 + 方式），供「在缺口处松手」时取用
    var folderDragHover = null;
    var FOLDER_DRAG_TYPE = 'application/x-litboard-folder';
    $('#folder-list').addEventListener('dragstart', function (e) {
      var row = e.target.closest('.folder-item[data-folder]');
      if (!row || !e.dataTransfer) return;
      if (e.target.closest('.folder-toggle, .folder-delete, .folder-add-child')) {
        e.preventDefault();
        return;
      }
      folderDragId = row.dataset.folder;
      folderDragHover = null;
      e.dataTransfer.setData(FOLDER_DRAG_TYPE, folderDragId);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
      $('#folder-list').classList.add('folder-reordering');
    });
    $('#folder-list').addEventListener('dragend', function () {
      folderDragId = null;
      folderDragHover = null;
      clearFolderDropMarks();
      resetFolderOrderPreview();
      $all('#folder-list .folder-item').forEach(function (row) { row.classList.remove('dragging'); });
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
      clearFolderDropMarks();
      resetFolderOrderPreview();
    });
    $('#folder-list').addEventListener('dragover', function (e) {
      if (!folderDragId) return;
      var row = e.target.closest('.folder-item[data-folder]');
      if (!row) return;
      clearFolderDropMarks(row);
      var dragged = state.folders.find(function (folder) { return folder.id === folderDragId; });
      if (!dragged) return;
      if (row.dataset.folder === folderDragId) {
        // 缺口 = 被拖行当前的视觉位置：允许在缺口上松手，落点取已预览的插入位
        if (folderDragHover) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
        return;
      }
      if (isFolderDescendant(folderDragId, row.dataset.folder)) { folderDragHover = null; return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var rect = row.getBoundingClientRect();
      var ratio = (e.clientY - rect.top) / rect.height;
      if (ratio < 0.35) {
        row.classList.add('drag-before');
        previewFolderOrder(row, 'before', folderDragId);
        folderDragHover = { targetId: row.dataset.folder, mode: 'before' };
      } else if (ratio > 0.65) {
        row.classList.add('drag-after');
        previewFolderOrder(row, 'after', folderDragId);
        folderDragHover = { targetId: row.dataset.folder, mode: 'after' };
      } else {
        row.classList.add('drag-over');
        resetFolderOrderPreview();
        folderDragHover = null;
      }
    });
    $('#folder-list').addEventListener('drop', function (e) {
      var row = e.target.closest('.folder-item[data-folder]');
      if (!row || !folderDragId) return;
      var targetId = row.dataset.folder;
      var dragged = state.folders.find(function (folder) { return folder.id === folderDragId; });
      if (!dragged) return;
      var mode;
      if (targetId === folderDragId) {
        // 在缺口（被拖行自身）上松手：采用当前预览的插入位
        if (!folderDragHover) return;
        targetId = folderDragHover.targetId;
        mode = folderDragHover.mode;
      } else {
        if (isFolderDescendant(folderDragId, targetId)) return;
        var rect = row.getBoundingClientRect();
        var ratio = (e.clientY - rect.top) / rect.height;
        mode = ratio < 0.35 ? 'before' : (ratio > 0.65 ? 'after' : 'inside');
      }
      e.preventDefault();
      e.stopPropagation();
      folderDragId = null;
      folderDragHover = null;
      // undo 快照必须在 reorderFolder 变更之前抓（否则 before=after，撤销成空操作）；
      // 受影响的不仅是拖拽双方——两侧父级的同级列表都会被重排，一并纳入快照
      var targetFolder = null;
      for (var fi = 0; fi < state.folders.length; fi++) {
        if (state.folders[fi].id === targetId) { targetFolder = state.folders[fi]; break; }
      }
      var undoIds = {};
      undoIds[dragged.id] = true;
      undoIds[targetId] = true;
      folderChildren(dragged.parentId || '').forEach(function (item) { undoIds[item.id] = true; });
      if (targetFolder) {
        var newParentId = mode === 'inside' ? targetId : (targetFolder.parentId || '');
        folderChildren(newParentId).forEach(function (item) { undoIds[item.id] = true; });
      }
      var undoIdList = Object.keys(undoIds);
      var undoBefore = makeSnapshot({ folders: undoIdList });
      if (reorderFolder(dragged.id, targetId, mode)) {
        commitUndo(mode === 'inside' ? T('移动文件夹') : T('调整文件夹顺序'), undoBefore, { folders: undoIdList });
        clearFolderDropMarks();
        renderFolders();
        // 落定反馈：被拖行（移入已折叠父级时退而闪目标行）短暂描边闪光
        var rows = $all('#folder-list .folder-item[data-folder]');
        var landed = rows.find(function (item) { return item.dataset.folder === dragged.id; }) ||
          rows.find(function (item) { return item.dataset.folder === targetId; });
        if (landed) {
          landed.classList.add('drop-flash');
          setTimeout(function () { landed.classList.remove('drop-flash'); }, 600);
        }
        toast(mode === 'inside' ? T('✓ 已移入「') + dragged.name + '」' : T('✓ 已调整顺序'));
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
    $('#onboard-backup').addEventListener('click', function () { openSyncSettings('backup'); });
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
    $('#paste-cancel').addEventListener('click', function () { $('#paste-mask').hidden = true; });
    $('#paste-ok').addEventListener('click', function () {
      var text = $('#paste-area').value.trim();
      $('#paste-mask').hidden = true;
      $('#paste-area').value = '';
      if (text) promptImportFolder(function (folderId) { importBibText(text, folderId); }, pendingPasteFolderId);
      pendingPasteFolderId = '';
    });

    // 拖放。只有两个落点：统计仪表盘 = 导入（虚线框 + 提示胶囊）；
    // 条目行 = 附加到该条（Zotero 式行级高亮）。拖到其他区域不接文件，只提示落点。
    var dragDepth = 0;
    var fileDropTr = null;
    var statsDropActive = false;
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
    function setStatsDropActive(on) {
      if (statsDropActive === on) return;
      statsDropActive = on;
      var row = $('#stats-row');
      if (row) row.classList.toggle('drop-zone-active', on);
      var hint = $('#stats-drop-hint');
      if (hint) hint.hidden = !on;
    }
    function clearFileDropZones() {
      setFileDropTr(null);
      setStatsDropActive(false);
    }
    document.addEventListener('dragenter', function (e) {
      e.preventDefault();
      if (!dragHasFiles(e)) return;
      dragDepth++;
      var pill = $('#drag-hint-pill');
      if (pill) pill.hidden = false;
    });
    document.addEventListener('dragleave', function (e) {
      e.preventDefault();
      if (!dragHasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) {
        var pill = $('#drag-hint-pill');
        if (pill) pill.hidden = true;
        clearFileDropZones();
      }
    });
    document.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (!dragHasFiles(e)) return;
      // 行级 / 仪表盘落区只在桌面版有意义（浏览器拿不到文件路径，附加无从谈起）
      var tr = (!desktop || !e.target.closest) ? null : e.target.closest('#table-body tr[data-id]');
      var paper = tr ? getById(tr.dataset.id) : null;
      if (paper && paper.deletedAt) { tr = null; paper = null; }
      setFileDropTr(tr);
      // 仪表盘落区在收起态也激活（细条上只显示虚线框，胶囊由 CSS 隐藏），保证导入入口常在
      var statsHit = e.target.closest ? e.target.closest('#stats-row') : null;
      setStatsDropActive(!tr && !!statsHit);
      // 悬停仪表盘落区时由框头胶囊接管，其余位置保持全局胶囊
      var pill = $('#drag-hint-pill');
      if (pill) pill.hidden = statsDropActive;
      if (fileDropTr && e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      var pill = $('#drag-hint-pill');
      if (pill) pill.hidden = true;
      var files = e.dataTransfer && e.dataTransfer.files.length
        ? Array.prototype.slice.call(e.dataTransfer.files) : null;
      var tr = fileDropTr;
      var inStats = statsDropActive;
      clearFileDropZones();
      if (tr) {
        var paper = getById(tr.dataset.id);
        if (paper && !paper.deletedAt && files) attachDroppedFiles(paper, files);
        return;
      }
      if (!files) return;
      if (inStats) {
        promptImportFolder(function (folderId) { handleFiles(files, folderId); }, currentImportFolderId());
      } else {
        toast(T('拖到顶部统计区导入文献；拖到条目行附加为附件'));
      }
    });

    // 拖动表格行到左侧文件夹归类
    var dragPayloadIds = null;
    var DRAG_TYPE = 'application/x-litboard-papers';
    $('#table-body').addEventListener('dragstart', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (!tr || !e.dataTransfer) return;
      var id = tr.dataset.id;
      var ids = state.selected[id] ? selectedIds() : [id];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copy';
      dragPayloadIds = ids;
      tr.classList.add('dragging');
    });
    $('#table-body').addEventListener('dragend', function () {
      dragPayloadIds = null;
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
      e.dataTransfer.dropEffect = 'copy';
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
      if (target.dataset.folder === 'unfiled') {
        papers.forEach(function (paper) { paper.folderIds = []; });
        save(); renderAll();
        toast(T('✓ 已移出 ') + papers.length + T(' 篇的文件夹'));
        return;
      }
      var folder = state.folders.find(function (item) { return item.id === target.dataset.folder; });
      if (!folder) return;
      papers.forEach(function (paper) {
        if ((paper.folderIds || []).indexOf(folder.id) === -1) paper.folderIds.push(folder.id);
      });
      save(); renderAll();
      toast(T('✓ 已将 ') + papers.length + T(' 篇加入「') + folder.name + '」');
    });

    // 补全 / 导出菜单
    $('#btn-enrich').addEventListener('click', enrichAll);
    $('#btn-enrich-stop').addEventListener('click', abortEnrich);
    $('#btn-export').addEventListener('click', function (e) {
      e.stopPropagation();
      $('#export-menu').hidden = !$('#export-menu').hidden;
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
      $('#add-status').textContent = T('支持 DOI、arXiv 编号或论文标题；抓取后可再编辑。');
      $('#add-id').focus();
    });
    $('#add-cancel').addEventListener('click', function () { $('#add-mask').hidden = true; });
    $('#add-fetch').addEventListener('click', function () { quickAdd($('#add-id').value); });
    $('#add-id').addEventListener('keydown', function (e) { if (e.key === 'Enter') quickAdd(this.value); });
    $('#add-manual').addEventListener('click', function () { $('#add-mask').hidden = true; openEditModal(null); });

    // 智能文件夹
    $('#btn-save-search').addEventListener('click', saveCurrentSearch);
    $('#saved-search-list').addEventListener('click', function (e) {
      var del = e.target.closest('[data-delete-saved-search]');
      if (del) {
        var id = del.dataset.deleteSavedSearch;
        var removedSearch = state.savedSearches.find(function (search) { return search.id === id; });
        state.savedSearches = state.savedSearches.filter(function (s) { return s.id !== id; });
        if (removedSearch) {
          state.savedSearchTombstones = state.savedSearchTombstones.filter(function (search) { return search.id !== id; });
          state.savedSearchTombstones.push(Object.assign({}, removedSearch, { deletedAt: Date.now() }));
        }
        if (state.activeSavedSearchId === id) state.activeSavedSearchId = '';
        save(); renderAll();
        return;
      }
      var sel = e.target.closest('[data-saved-search]');
      if (sel) { applySavedSearch(sel.dataset.savedSearch, e.ctrlKey || e.metaKey); return; }
      var editSearch = e.target.closest('[data-edit-saved-search]');
      if (editSearch) { editSavedSearch(editSearch.dataset.editSavedSearch);  }
    });

    // 标签管理
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
    $('#sync-conflict-close').addEventListener('click', function () { $('#sync-conflict-mask').hidden = true; });
    $('#sync-conflict-export').addEventListener('click', function () {
      if (!pendingConflictExport.length) return;
      download('litboard-sync-conflicts-' + stamp() + '.json', JSON.stringify(pendingConflictExport.map(function (c) {
        return { id: c.id, title: c.title, direction: c.direction, overwrittenLocalVersion: c.overwritten };
      }), null, 2), 'application/json');
    });
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
    $('#pdf-renderer-toggle').addEventListener('click', togglePdfRenderer);
  $('#pdf-reflow-toggle').addEventListener('click', togglePdfReflow);
  $('#pdf-scroll').addEventListener('scroll', function () {
    if (pdfState.reflowMode) ensureReflowPages();
  });
    $('#pdf-translation-settings').addEventListener('click', function () { openSyncSettings('translation'); });
    $('#pdf-page-prev').addEventListener('click', function () { goToPdfPage(pdfState.currentPage - 1); });
    $('#pdf-page-next').addEventListener('click', function () { goToPdfPage(pdfState.currentPage + 1); });
    $('#pdf-page-number').addEventListener('change', function (e) { goToPdfPage(e.target.value); });
    $('#pdf-search').addEventListener('input', runPdfSearch);
    $('#pdf-search').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runPdfSearch.flush(); goToPdfSearchResult(e.shiftKey ? -1 : 1); }
    });
    $('#pdf-search-prev').addEventListener('click', function () { goToPdfSearchResult(-1); });
    $('#pdf-search-next').addEventListener('click', function () { goToPdfSearchResult(1); });
    $('#pdf-search-toggle').addEventListener('click', function () { pdfSearchPanelOpen(); });
    $('#pdf-annotations-toggle').addEventListener('click', function () {
      var panel = $('#pdf-annotations');
      // 阅读模式：批注面板已收编为右栏页签——隐藏状态归 switchPane 统一管理
      if (panel.parentElement && panel.parentElement.classList.contains('detail-sidebar') &&
          window.LitAgentUi && LitAgentUi.switchPane) {
        var annoActive = panel.hidden === false;
        LitAgentUi.switchPane(annoActive ? 'detail' : 'anno');
        this.setAttribute('aria-pressed', annoActive ? 'false' : 'true');
        return;
      }
      panel.hidden = !panel.hidden;
      this.setAttribute('aria-pressed', panel.hidden ? 'false' : 'true');
    });
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
        pdfWheelZoomSteps = Math.max(-3, Math.min(3, pdfWheelZoomSteps + (e.deltaY < 0 ? 1 : -1)));
        applyPdfWheelZoom();
      } else if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        this.scrollLeft += e.deltaY;
      }
    }, { passive: false });
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
          pdfNoteCurrentId = note.id;
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
    // 阶段三：侧栏笔记编辑器
    $('#pdf-note-select').addEventListener('change', function (e) {
      pdfNoteCurrentId = e.target.value;
      renderPdfNoteEditor();
    });
    $('#pdf-note-new').addEventListener('click', function () {
      if (!pdfState.paper) return;
      dlgPrompt(T('新建笔记'), T('标题；留空则创建跨文献主题笔记'), '').then(function (title) {
        if (title == null) return;
        var note = createNote(title.trim() ? pdfState.paper.id : '', title.trim());
        pdfNoteCurrentId = note.id;
        save(); renderPdfNoteEditor();
        toast(T('✓ 已创建笔记'));
      });
    });
    $('#pdf-note-edit-tab').addEventListener('click', function () { setPdfNoteMode('edit'); });
    $('#pdf-note-preview-tab').addEventListener('click', function () { setPdfNoteMode('preview'); });
    // 阶段三下半：富文本编辑器 / 导出 Word
    $('#pdf-note-richtext').addEventListener('click', function () { openNoteEditor(currentPdfNote()); });
    $('#pdf-note-export-word').addEventListener('click', function () { exportNoteToWord(currentPdfNote()); });
    $('#pdf-note-textarea').addEventListener('input', function (e) {
      var note = currentPdfNote();
      if (!note) return;
      note.content = e.target.value;
      window.LitModel.touch(note);
      savePdfNoteSide();
    });
    $('#pdf-note-stale').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-stale-action]');
      if (btn) handleStaleAction(btn.dataset.staleAction, btn.dataset.annotationId);
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
      pdfNoteCurrentId = note.id;
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
    $('#pdf-write-back').addEventListener('click', function () {
      if (!pdfState.paper) return;
      writeBackPdfAnnotations(pdfState.paper, pdfState.attachment, false);
    });
    $('#pdf-side-toggle').addEventListener('click', function () {
      togglePdfSide($('#pdf-side').dataset.tab === 'thumbs' ? 'thumbs' : 'outline');
    });
    $('#pdf-side-tab-outline').addEventListener('click', function () { togglePdfSide('outline'); });
    $('#pdf-side-tab-thumbs').addEventListener('click', function () { togglePdfSide('thumbs'); });
    $('#pdf-snapshot-toggle').addEventListener('click', function () { toggleSnapshotMode(); });
    $('#pdf-ink-toggle').addEventListener('click', function () { toggleInkMode(); });
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
    $('#pdf-scroll').addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (pdfState.snapshotMode) { startSnapshotDrag(e); return; }
      if (pdfState.inkMode) { startInkStroke(e);  }
    });

    // 点遮罩空白处关闭（表单类弹窗除外，避免误触丢失输入）
    ['add-mask', 'cite-mask', 'shortcuts-mask', 'bibkey-search-mask', 'dedupe-mask', 'zotero-import-mask', 'excerpt-mask', 'note-edit-mask', 'query-builder-mask', 'bulk-edit-mask', 'authors-mask', 'related-mask', 'tags-mask', 'sync-conflict-mask'].forEach(function (id) {
      $('#' + id).addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
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
    $('#dlg-ok').addEventListener('click', function () {
      if (!dlgState) return;
      if (dlgState.mode === 'input') dlgSettle($('#dlg-input').value);
      else dlgSettle(true);
    });
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

    // 搜索 / 筛选
    $('#search').addEventListener('input', debounce(function (e) {
      state.filters.q = e.target.value.trim();
      state.tablePage = 0;
      if (state.ftEnabled) { state.ftHits = {}; runFtSearch(); }
      renderAll();
      var hint = $('#search-hint');
      if (querySyntaxError && state.filters.q) {
        hint.textContent = T('检索语法有误，已按普通子串搜索（支持 field:value、AND/OR/NOT、year>=2020、/正则/）');
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

    // 表头排序
    $all('.lit-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
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
      if (e.ctrlKey || e.metaKey) {
        state.selAnchor = state.selAnchor || p.id;
        toggleSelectId(p.id);
        state.focusId = p.id;
        return;
      }
      if (e.shiftKey) {
        state.selAnchor = state.selAnchor || p.id;
        selectRangeTo(p.id);
        state.focusId = p.id;
        updateSelectionUi();
        return;
      }
      state.selAnchor = p.id;
      state.focusId = p.id;
      openDrawerAndReveal(p.id);
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
      if (ctxMenuEl && !e.target.closest('.ctx-menu')) hideCtxMenu();
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
      if (act === 'unread' || act === 'reading' || act === 'read') {
        var undoBefore = makeSnapshot({ papers: papers.map(function (p) { return p.id; }) });
        papers.forEach(function (p) { p.status = act; });
        commitUndo(T('批量标记') + STATUS_LABEL[act], undoBefore, { papers: papers.map(function (p) { return p.id; }) });
        save(); renderAll(); toast(T('✓ 已标记 ') + papers.length + T(' 篇为') + STATUS_LABEL[act]);
      } else if (act === 'edit-fields') {
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
        dlgConfirm(T('移入回收站'), T('删除选中的 ') + papers.length + T(' 篇？可在提示条点「撤销」恢复，也可稍后在回收站找回。'), T('移入回收站')).then(function (ok) {
          if (ok) removePapers(ids);
        });
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
      var blocking = ['pdf-overlay', 'epub-overlay', 'edit-mask', 'add-mask', 'cite-mask', 'paste-mask', 'shortcuts-mask', 'bibkey-search-mask', 'dedupe-mask', 'zotero-import-mask', 'excerpt-mask', 'note-edit-mask', 'query-builder-mask', 'bulk-edit-mask', 'snapshot-mask', 'sync-mask', 'sync-remote-plan-mask', 'import-folder-mask', 'authors-mask', 'related-mask', 'tags-mask', 'sync-conflict-mask', 'dlg-mask'];
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
    $('#d-journal-rank-refresh').addEventListener('click', refreshJournalRank);
    // 这颗按钮住在可排序的表头里：不拦住冒泡的话，点一下开始/暂停会顺带把表格按分区重排
    $('#rank-refresh-all').addEventListener('click', function (event) {
      event.stopPropagation();
      refreshAllJournalRanks();
    });
    updateRankRefreshUi();   // 先落一次初始态：data-rank-state/图标不依赖第一次点击
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
    $('#d-enrich').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      var btn = $('#d-enrich');
      btn.disabled = true; setBtnLabel(btn, T('查询中…'));
      window.LitEnrich.enrichPaper(p).then(function (patch) {
        btn.disabled = false; setBtnLabel(btn, T('补全'));
        if (patch) {
          var updated = applyPatch(p, patch);
          save(); renderAll(); openDrawer(updated.id);
          toast(T('✓ 已补全（来源：') + (patch.source || 'API') + '）');
        } else {
          toast(T('三个数据源均未找到该文献（可检查 DOI 或标题）'));
        }
      }).catch(function (err) {
        btn.disabled = false; setBtnLabel(btn, T('补全'));
        toast(T('⚠ 查询失败：') + (err && err.message || T('网络错误')));
      });
    });
    $('#d-fetch-pdf').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      fetchPdfForPaper(p);
    });
    $('#d-copy-bib').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      copyToClipboard(window.LitBib.paperToBibtex(p)).then(function () { toast(T('✓ BibTeX 已复制')); });
    });
    $('#d-edit').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      openEditModal(p);
    });
    $('#d-cite').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      openCiteModal(p);
    });
    $('#d-delete').addEventListener('click', function () {
      var p = getById(drawerId); if (!p) return;
      dlgConfirm(T('删除文献'), T('删除「') + p.title.slice(0, 40) + T('…」？可在提示条点「撤销」恢复。'), T('删除'), true).then(function (ok) {
        if (!ok) return;
        removePapers([p.id], T('已删除「') + p.title.slice(0, 24) + '」');
      });
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
  /* 下载文件名：优先按「PDF 命名模板」生成（与「按模板重命名」同一口径），回退标题-年份。
   * 返回不含扩展名的主名（.pdf 由主进程 safePdfFileName 统一补）。 */
  function pdfDownloadBaseName(p) {
    var template = (integrationConfig && integrationConfig.renameTemplate) ||
      (window.LitRename && window.LitRename.DEFAULT_TEMPLATE) || '{author} - {year} - {title}';
    var base = (window.LitRename && window.LitRename.buildName(p, template)) || '';
    if (!base || base === 'paper') {
      base = pdfSafeFileName(p).replace(/\.pdf$/i, '');
    }
    return base;
  }
  function pdfAutoDownloadDir() {
    return String((integrationConfig && integrationConfig.pdfDownloadDir) || '').trim();
  }
  function setPdfButton(label, disabled) {
    var btn = $('#d-fetch-pdf');
    if (!btn) return;
    btn.disabled = !!disabled;
    setBtnLabel(btn, label);
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
      dir: pdfAutoDownloadDir()
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
    applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
    initWindowControls();
    state.collapsedFolders = readCollapsedFolders();
    state.shortcuts = readShortcutSettings();
    applyPaneSizes(readPaneSizes());
    bindEvents();
    initAgentUi();
    /* 阅读模式右栏可达性：PDF/EPUB 全屏层打开时，右栏（详情/AI/手动检索）浮到层上，
     * 阅读层右侧让出同等宽度（css body.reading-open；AI 对话与手动检索的回答由此可达）。
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
      // 「内容变化时自动同步」开关控制，关闭后仅手动「保存并同步」联网。
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
      // 回收站惰性清理（默认保留 30 天，可在设置中调整，0 = 永不清理）
      if (desktop && desktop.getSetting) {
        desktop.getSetting('trashRetentionDays').then(function (days) {
          var retention = days == null ? 30 : Number(days);
          if (!Number.isFinite(retention) || retention <= 0) return;
          var cutoff = Date.now() - retention * 86400000;
          var stale = state.papers.filter(function (p) { return p.deletedAt && p.deletedAt < cutoff; })
            .map(function (p) { return p.id; });
          if (stale.length) {
            purgePapers(stale);
            toast(T('回收站已自动清理 ') + stale.length + T(' 篇（超过 ') + retention + T(' 天）'));
          }
        }).catch(function () {});
      }
      renderAll();
      renderPdfTabs();
      reportCurrentFolder(); // 启动时同步一次当前文件夹给浏览器扩展
      window.litboardReadyAt = performance.now();
    });
  }
  start();
})();
