/* Plans an explicit local-authoritative cloud reconciliation; no I/O. */
(function (root, factory) {
  var model = typeof module === 'object' && module.exports ? require('./model.js') : root.LitModel;
  var api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitCloudMirror = api;
})(typeof window !== 'undefined' ? window : null, function (model) {
  'use strict';
  var collections = ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'];
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function signature(workspace) {
    var maps = model.workspaceSignatures(workspace);
    return JSON.stringify(collections.map(function (name) {
      return Object.keys(maps[name]).sort().map(function (key) { return [key, maps[name][key]]; });
    }));
  }
  function activeAssets(workspace) {
    var assets = [];
    var liveIds = new Set();
    (workspace.papers || []).forEach(function (paper) {
      if (!paper || paper.deletedAt) return;
      liveIds.add(paper.id);
      (paper.attachments || []).forEach(function (asset) { assets.push(asset); });
      (paper.pdfAnnotations || []).forEach(function (ann) { if (ann.type === 'snapshot') assets.push(ann); });
    });
    (workspace.notes || []).forEach(function (note) {
      if (!note || note.deletedAt || (note.paperId && !liveIds.has(note.paperId))) return;
      (note.assets || []).forEach(function (asset) { assets.push(asset); });
    });
    return assets;
  }
  function build(localInput, remoteInput, now) {
    var local = model.normalizeWorkspace(clone(localInput));
    var remote = model.normalizeWorkspace(clone(remoteInput));
    var target = clone(local);
    var stamp = Number(now) || Date.now();
    collections.forEach(function (name) {
      (local[name] || []).concat(remote[name] || []).forEach(function (item) {
        stamp = Math.max(stamp, (Number(item.updatedAt) || 0) + 1, (Number(item.deletedAt) || 0) + 1);
      });
    });
    var changes = [];
    collections.forEach(function (name) {
      var key = name === 'tagColorRecords' ? 'tag' : 'id';
      var localMap = new Map((local[name] || []).map(function (item) { return [item[key], item]; }));
      var remoteMap = new Map((remote[name] || []).map(function (item) { return [item[key], item]; }));
      target[name] = (local[name] || []).map(function (item) {
        var next = clone(item), other = remoteMap.get(item[key]);
        next.updatedAt = stamp;
        if (next.deletedAt) next.deletedAt = stamp;
        if (!item.deletedAt || (other && !other.deletedAt)) changes.push({ collection: name, id: item[key],
          title: item.title || item.name || item[key], action: item.deletedAt ? 'remove' : other && !other.deletedAt ? 'keep-local' : 'upload' });
        return next;
      });
      (remote[name] || []).forEach(function (item) {
        if (localMap.has(item[key])) return;
        var next = clone(item);
        next.deletedAt = stamp; next.updatedAt = stamp;
        target[name].push(next);
        if (!item.deletedAt) changes.push({ collection: name, id: item[key], title: item.title || item.name || item[key], action: 'remove' });
      });
    });
    var liveIds = new Set(target.papers.filter(function (p) { return !p.deletedAt; }).map(function (p) { return p.id; }));
    target.notes.forEach(function (note) { if (note.paperId && !liveIds.has(note.paperId)) { note.deletedAt = stamp; note.updatedAt = stamp; } });
    target = model.normalizeWorkspace(target);
    return { workspace: target, changes: changes, localCount: local.papers.filter(function (p) { return !p.deletedAt; }).length,
      remoteCount: remote.papers.filter(function (p) { return !p.deletedAt; }).length };
  }
  return { build: build, activeAssets: activeAssets, signature: signature };
});
