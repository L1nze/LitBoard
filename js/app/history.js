/* LitBoard 会话级撤销/重做：仅管理快照栈，不拥有业务操作。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitHistory = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var undoStack = [];
    var redoStack = [];
    var limit = options.limit || 100;
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function snapOne(list, id) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) return clone(list[i]);
      }
      return { __absent: true };
    }
    function snapshot(ids) {
      ids = ids || {};
      var state = options.state;
      var snap = { papers: {}, notes: {}, folders: {} };
      (ids.papers || []).forEach(function (id) { snap.papers[id] = snapOne(state.papers, id); });
      (ids.notes || []).forEach(function (id) { snap.notes[id] = snapOne(state.notes, id); });
      (ids.folders || []).forEach(function (id) {
        var record = snapOne(state.folders, id);
        snap.folders[id] = record.__absent ? snapOne(state.folderTombstones, id) : record;
      });
      return snap;
    }
    function apply(snap) {
      var state = options.state;
      function applyList(list, map) {
        Object.keys(map || {}).forEach(function (id) {
          var record = map[id];
          var index = -1;
          for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === id) { index = i; break; } }
          if (record.__absent) { if (index !== -1) list.splice(index, 1); }
          else if (index === -1) list.push(clone(record));
          else list[index] = clone(record);
        });
      }
      applyList(state.papers, snap.papers);
      applyList(state.notes, snap.notes);
      var liveFolders = Object.create(null), deletedFolders = Object.create(null);
      Object.keys(snap.folders || {}).forEach(function (id) {
        var record = snap.folders[id];
        liveFolders[id] = !record.__absent && !record.deletedAt ? record : { __absent: true };
        deletedFolders[id] = !record.__absent && record.deletedAt ? record : { __absent: true };
      });
      applyList(state.folders, liveFolders);
      applyList(state.folderTombstones, deletedFolders);
      var normalized = options.normalizeWorkspace(options.payload());
      state.papers = normalized.papers;
      state.notes = normalized.notes;
    }
    function commit(label, before, ids) {
      undoStack.push({ label: label, before: before, after: snapshot(ids) });
      if (undoStack.length > limit) undoStack.shift();
      redoStack = [];
    }
    function restore(entry, target, source) {
      if (!entry) return null;
      apply(entry[target]);
      source.push(entry);
      return { label: entry.label };
    }
    return {
      commit: commit,
      redo: function () { return restore(redoStack.pop(), 'after', undoStack); },
      snapshot: snapshot,
      status: function () {
        return {
          redoLabel: redoStack.length ? redoStack[redoStack.length - 1].label : '',
          undoLabel: undoStack.length ? undoStack[undoStack.length - 1].label : ''
        };
      },
      undo: function () { return restore(undoStack.pop(), 'before', redoStack); }
    };
  }

  return { create: create };
});
