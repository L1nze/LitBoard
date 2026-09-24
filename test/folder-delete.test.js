'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const LitHistory = require('../js/app/history.js');
const LitFolderTree = require('../js/foldertree.js');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

function harness(confirmResult) {
  const state = {
    folders: [
      { id: 'A', name: 'A', parentId: '', sortIndex: 0 },
      { id: 'B', name: 'B', parentId: 'A', sortIndex: 0 },
      { id: 'C', name: 'C', parentId: 'B', sortIndex: 0 },
      { id: 'D', name: 'D', parentId: '', sortIndex: 1 }
    ],
    papers: [
      { id: 'p1', folderIds: ['A', 'B', 'C', 'D'], attachments: [{ id: 'att1', path: 'paper.pdf' }] },
      { id: 'p2', folderIds: ['B', 'D'], attachments: [{ id: 'att2', path: 'other.pdf' }] }
    ],
    notes: [{ id: 'n1', paperId: 'p1', content: 'keep note' }],
    folderTombstones: [],
    activeFolderId: 'A', activeFolderIds: ['A', 'C', 'D'], folderSelAnchor: 'C', folderFocusId: 'B'
  };
  const history = LitHistory.create({
    state,
    payload: function () { return { papers: state.papers, notes: state.notes, folders: state.folders }; },
    normalizeWorkspace: function (workspace) { return workspace; },
    limit: 100
  });
  const context = {
    state,
    window: { LitFolderTree },
    T: function (value) { return value; },
    dlgConfirm: function () { return Promise.resolve(confirmResult !== false); },
    save: function () { return Promise.resolve(true); },
    renderAll: function () {},
    toast: function () {},
    resetActiveFolder: function () { state.activeFolderId = 'all'; },
    makeSnapshot: history.snapshot,
    commitUndo: history.commit
  };
  const start = source.indexOf('  function deleteFolder(');
  const end = source.indexOf('  function renameFolder(', start);
  assert.ok(start >= 0 && end > start, 'app.js should expose the folder deletion functions');
  vm.runInNewContext(source.slice(start, end), context);
  return { state, context, history };
}

function sortedFolders(folders) {
  return folders.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
}

test('deleting a parent recursively tombstones a three-level subtree and preserves papers, files, and notes', async function () {
  const h = harness(true);
  await h.context.deleteFolder('A');

  assert.deepEqual(Array.from(h.state.folders, function (f) { return f.id; }), ['D']);
  assert.deepEqual(Array.from(h.state.folderTombstones, function (f) { return f.id; }).sort(), ['A', 'B', 'C']);
  assert.deepEqual(Array.from(h.state.papers[0].folderIds), ['D']);
  assert.deepEqual(Array.from(h.state.papers[1].folderIds), ['D']);
  assert.deepEqual(Array.from(h.state.papers, function (p) { return p.attachments[0].id; }), ['att1', 'att2']);
  assert.deepEqual(Array.from(h.state.notes, function (n) { return n.id; }), ['n1']);
  assert.deepEqual(Array.from(h.state.activeFolderIds), ['D']);
  assert.equal(h.state.folderSelAnchor, null);
  assert.equal(h.state.folderFocusId, null);
});

test('deleting a mixed parent and child set tombstones each descendant once', async function () {
  const h = harness(true);
  await h.context.deleteFolders(['B', 'A', 'B']);

  assert.deepEqual(Array.from(h.state.folders, function (f) { return f.id; }), ['D']);
  assert.deepEqual(Array.from(h.state.folderTombstones, function (f) { return f.id; }).sort(), ['A', 'B', 'C']);
  assert.equal(new Set(h.state.folderTombstones.map(function (f) { return f.id; })).size, 3);
});

test('canceling folder deletion leaves the complete workspace and history unchanged', async function () {
  const h = harness(false);
  const before = JSON.stringify(h.state);
  await h.context.deleteFolder('A');

  assert.equal(JSON.stringify(h.state), before);
  assert.equal(h.history.status().undoLabel, '');
});

test('undo and redo restore and remove the full folder hierarchy and paper memberships', async function () {
  const h = harness(true);
  const originalFolders = sortedFolders(h.state.folders);
  const originalPaperFolders = h.state.papers.map(function (p) { return p.folderIds.slice(); });
  await h.context.deleteFolder('A');

  assert.ok(h.history.undo());
  assert.deepEqual(sortedFolders(h.state.folders), originalFolders);
  assert.deepEqual(h.state.papers.map(function (p) { return Array.from(p.folderIds); }), originalPaperFolders);
  assert.deepEqual(Array.from(h.state.folderTombstones), []);

  assert.ok(h.history.redo());
  assert.deepEqual(Array.from(h.state.folders, function (f) { return f.id; }), ['D']);
  assert.deepEqual(Array.from(h.state.folderTombstones, function (f) { return f.id; }).sort(), ['A', 'B', 'C']);
  assert.deepEqual(Array.from(h.state.papers[0].folderIds), ['D']);
  assert.deepEqual(Array.from(h.state.papers[1].folderIds), ['D']);
  assert.deepEqual(Array.from(h.state.papers, function (p) { return p.attachments[0].id; }), ['att1', 'att2']);
  assert.deepEqual(Array.from(h.state.notes, function (n) { return n.id; }), ['n1']);
});
