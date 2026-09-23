'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createStore = require('../js/app/workspace-store.js').create;

function makeModel() {
  function signatures(workspace) {
    function map(list, key) {
      const out = {};
      (list || []).forEach(function (item) { out[item[key]] = JSON.stringify(item); });
      return out;
    }
    return {
      papers: map(workspace.papers, 'id'), notes: map(workspace.notes, 'id'),
      folders: map(workspace.folders, 'id'), savedSearches: map(workspace.savedSearches, 'id'),
      tagColorRecords: map(workspace.tagColorRecords, 'tag')
    };
  }
  return {
    assignCitationKeys: function () {},
    normalizeWorkspace: function (workspace) { return workspace; },
    touchWorkspaceChanges: function () {},
    workspaceSignatures: signatures
  };
}

function workspace(title) {
  return {
    papers: [{ id: 'p1', title: title }], notes: [], folders: [], savedSearches: [],
    tagColors: {}, tagColorRecords: []
  };
}

test('同步应用用应用前确认签名保存，避免把远端工作区误判为本地未改', async function () {
  const state = { papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [], savedSearchTombstones: [], tagColors: {}, tagColorRecords: [] };
  const model = makeModel();
  const calls = [];
  const desktop = {
    saveLibrary: function (value, base) {
      calls.push({ base: base, title: value.papers[0].title });
      return Promise.resolve({ signatures: model.workspaceSignatures(value), conflicts: [] });
    }
  };
  const store = createStore({
    state: state, model: model, uid: function () { return 'id'; }, T: function (s) { return s; },
    toast: function () {}, storeKey: 'test', localStorage: { getItem: function () { return null; }, setItem: function () {} },
    desktop: function () { return desktop; }, clearQueryCache: function () {}, scheduleSync: function () {},
    resolveConflicts: function () { return Promise.resolve(true); }, onLoad: function () {}
  });

  await store.replace(workspace('local confirmed'));
  calls.length = 0;
  await store.applyIncoming(workspace('remote applied'), true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, 'remote applied');
  assert.equal(calls[0].base.papers.p1, JSON.stringify({ id: 'p1', title: 'local confirmed' }));
});

test('保存完成后仅把变化的实体推进到冲突合并 base', async function () {
  const state = { papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [], savedSearchTombstones: [], tagColors: {}, tagColorRecords: [] };
  const model = makeModel();
  const desktop = { saveLibrary: function (value) { return Promise.resolve({ signatures: model.workspaceSignatures(value), conflicts: [] }); } };
  const store = createStore({
    state: state, model: model, uid: function () { return 'id'; }, T: function (s) { return s; },
    toast: function () {}, storeKey: 'test', localStorage: { getItem: function () { return null; }, setItem: function () {} },
    desktop: function () { return desktop; }, clearQueryCache: function () {}, scheduleSync: function () {},
    resolveConflicts: function () { return Promise.resolve(true); }, onLoad: function () {}
  });

  await store.replace(workspace('before'));
  state.papers[0].title = 'after';
  await store.save(true);

  assert.equal(store.getBase().papers.p1.title, 'after');
  assert.equal(store.getRevision(), 2);
});
