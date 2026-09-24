/* LitBoard 文件夹树纯逻辑：可见行、区间选择、多选移动、落点判定（浏览器 / Node 共用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitFolderTree = api;
})(typeof self !== 'undefined' ? self : null, function () {
  'use strict';

  /** 同级排序：sortIndex 升序，平手按名称 */
  function compareFolders(a, b) {
    return (a.sortIndex || 0) - (b.sortIndex || 0) || a.name.localeCompare(b.name);
  }

  function indexByParent(folders) {
    var byId = Object.create(null), children = Object.create(null);
    folders.forEach(function (f) { byId[f.id] = f; });
    folders.forEach(function (f) {
      var pid = f.parentId && byId[f.parentId] ? f.parentId : '';
      (children[pid] = children[pid] || []).push(f);
    });
    Object.keys(children).forEach(function (pid) { children[pid].sort(compareFolders); });
    return { byId: byId, children: children };
  }

  /**
   * 可见行（等价 app.js 原 folderTree()）：按父→子排序展开，collapsedMap 为真值的节点
   * 不展开其子级。返回 [{ folder, depth, hasChildren }]。
   */
  function buildVisibleRows(folders, collapsedMap) {
    var children = indexByParent(folders).children;
    var result = [];
    function visit(pid, depth) {
      (children[pid] || []).forEach(function (f) {
        result.push({ folder: f, depth: depth, hasChildren: (children[f.id] || []).length > 0 });
        if (!(collapsedMap && Object.prototype.hasOwnProperty.call(collapsedMap, f.id) && collapsedMap[f.id])) visit(f.id, depth + 1);
      });
    }
    visit('', 0);
    return result;
  }

  /** Shift 区间：anchorId 与 targetId 之间（含两端）的可见 id，任一缺失返回 [] */
  function rangeIds(visibleIds, anchorId, targetId) {
    var a = visibleIds.indexOf(anchorId), b = visibleIds.indexOf(targetId);
    if (a === -1 || b === -1) return [];
    return a <= b ? visibleIds.slice(a, b + 1) : visibleIds.slice(b, a + 1);
  }

  /** 落点判定：上 25% before、下 25% after、中间 50% inside（边界值归 inside） */
  function dropModeFromRatio(ratio) {
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'inside';
  }

  /** rootIds 各子树的 id 集合（含根自身），返回 { id: true } */
  function collectSubtreeIds(folders, rootIds) {
    var children = indexByParent(folders).children;
    var set = Object.create(null);
    function walk(id) {
      if (set[id]) return;
      set[id] = true;
      (children[id] || []).forEach(function (f) { walk(f.id); });
    }
    (rootIds || []).forEach(walk);
    return set;
  }

  /**
   * 多选移动/排序统一实现（泛化原 reorderFolder）。
   * - dragIds 先清洗：不存在的丢弃；祖先也在被拖集合里的丢弃（整棵子树随根移动）。
   * - targetId 为空且 mode 为 'rootEnd' 时移到根级末尾；targetId 为被拖项或被拖项后代时拒绝。
   * - 被拖集合按整树可见顺序保持相对次序，作为连续块插入。
   * - 受影响同级组（新父组 + 各被拖项旧父组）重新从 0 编号。
   * 返回 { changed, touchedIds }；changed 为 false 时保证不改动 folders。
   */
  function applyMove(folders, dragIds, targetId, mode) {
    var byId = Object.create(null), dragSet = Object.create(null);
    folders.forEach(function (f) { byId[f.id] = f; });
    (dragIds || []).forEach(function (id) { if (byId[id]) dragSet[id] = true; });
    // 被拖集合的后代项从集合剔除（随其根一起移动）
    Object.keys(dragSet).forEach(function (id) {
      var current = byId[id].parentId, guard = 0;
      while (current && guard++ < folders.length + 1) {
        if (dragSet[current]) { delete dragSet[id]; return; }
        current = byId[current] ? (byId[current].parentId || '') : '';
      }
    });
    var ids = Object.keys(dragSet);
    if (!ids.length) return { changed: false, touchedIds: [] };
    if (mode !== 'rootEnd') {
      if (!targetId || !byId[targetId]) return { changed: false, touchedIds: [] };
      if (dragSet[targetId]) return { changed: false, touchedIds: [] };
      var cur = byId[targetId].parentId, guard2 = 0;
      while (cur && guard2++ < folders.length + 1) {
        if (dragSet[cur]) return { changed: false, touchedIds: [] };
        cur = byId[cur] ? (byId[cur].parentId || '') : '';
      }
    }
    var grouped = indexByParent(folders);
    var children = grouped.children;
    // 被拖集合按整树可见顺序排序（折叠态不影响顺序，传空 collapsedMap）
    var visibleOrder = buildVisibleRows(folders, null).map(function (row) { return row.folder.id; });
    var orderedIds = visibleOrder.filter(function (id) { return dragSet[id]; });
    var newParent = mode === 'rootEnd' ? '' : (mode === 'inside' ? targetId : (byId[targetId].parentId || ''));
    // 新父组剔除被拖项后的序列
    var siblings = (children[newParent] || []).filter(function (f) { return !dragSet[f.id]; });
    var insertAt = siblings.length;
    if (mode === 'before' || mode === 'after') {
      var t = -1;
      for (var i = 0; i < siblings.length; i++) if (siblings[i].id === targetId) { t = i; break; }
      if (t === -1) t = siblings.length;
      if (mode === 'after') t++;
      insertAt = Math.max(0, Math.min(t, siblings.length));
    }
    // 变更前快照（id -> {pid, idx}），用于判变与还原
    var before = Object.create(null);
    folders.forEach(function (f) { before[f.id] = { pid: f.parentId || '', idx: f.sortIndex || 0 }; });
    // 各被拖项的旧父组（与新父组不同的）先记下，移动后重编号
    var oldParents = Object.create(null);
    orderedIds.forEach(function (id) {
      var pid = byId[id].parentId || '';
      if (pid !== newParent) oldParents[pid] = true;
    });
    orderedIds.forEach(function (id) { byId[id].parentId = newParent; });
    var final = siblings.slice();
    final.splice.apply(final, [insertAt, 0].concat(orderedIds.map(function (id) { return byId[id]; })));
    final.forEach(function (f, index) { f.sortIndex = index; });
    Object.keys(oldParents).forEach(function (pid) {
      var index = 0;
      (children[pid] || []).forEach(function (f) {
        if (dragSet[f.id]) return;   // 被拖项已在 final.forEach 里拿到新父组下标
        f.sortIndex = index++;
      });
    });
    // 判变：与快照比对，无差异则整体还原
    var touchedIds = [];
    folders.forEach(function (f) {
      if (before[f.id].pid !== (f.parentId || '') || before[f.id].idx !== (f.sortIndex || 0)) touchedIds.push(f.id);
    });
    if (!touchedIds.length) {
      folders.forEach(function (f) {
        f.parentId = before[f.id].pid;
        f.sortIndex = before[f.id].idx;
      });
      return { changed: false, touchedIds: [] };
    }
    return { changed: true, touchedIds: touchedIds };
  }

  return {
    compareFolders: compareFolders,
    buildVisibleRows: buildVisibleRows,
    rangeIds: rangeIds,
    dropModeFromRatio: dropModeFromRatio,
    collectSubtreeIds: collectSubtreeIds,
    applyMove: applyMove
  };
});
