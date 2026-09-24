'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const createStore = require('../js/app/workspace-store.js').create;
const LitModel = require('../js/model.js');
const { createLibraryDb } = require('../electron/db.js');

function makeState() {
  return {
    papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [],
    savedSearchTombstones: [], tagColors: {}, tagColorRecords: []
  };
}

test('folder IDs matching object prototype names survive normalization and membership checks', function () {
  const workspace = LitModel.normalizeWorkspace({
    folders: [{ id: 'toString', name: 'Parent' }, { id: 'constructor', name: 'Child', parentId: 'toString' }],
    papers: [{ id: 'p', title: 'Paper', folderIds: ['toString', 'constructor'] }]
  });
  assert.deepEqual(workspace.folders.map(function (folder) { return folder.id; }), ['toString', 'constructor']);
  assert.equal(workspace.folders[1].parentId, 'toString');
  assert.deepEqual(workspace.papers[0].folderIds, ['toString', 'constructor']);
});

function makeStore(state, db, toasts) {
  const desktop = {
    loadLibrary: function () { return Promise.resolve(db.loadState()); },
    saveLibrary: function (value, baseSignatures) {
      const snapshot = JSON.parse(JSON.stringify(value));
      return Promise.resolve(db.saveState(Object.assign(snapshot, { baseSignatures: baseSignatures })));
    }
  };
  return createStore({
    state: state,
    model: LitModel,
    uid: function () { return 'test-id'; },
    T: function (value) { return value; },
    toast: function (message) { toasts.push(message); },
    storeKey: 'library-crud-test',
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    desktop: function () { return desktop; },
    clearQueryCache: function () {},
    scheduleSync: function () {},
    resolveConflicts: function () { return Promise.resolve(false); },
    onLoad: function () {}
  });
}

test('workspace store persists Zotero-style folder and item CRUD through SQLite', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-library-crud-'));
  const db = createLibraryDb(dir);
  await db.open();
  t.after(async function () {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const state = makeState();
  const toasts = [];
  const store = makeStore(state, db, toasts);
  await store.load();

  state.folders.push({ id: 'f-parent', name: 'Zotero Collection', parentId: '', sortIndex: 0 });
  state.folders.push({ id: 'f-child', name: 'Subcollection', parentId: 'f-parent', sortIndex: 0 });
  state.papers.push(LitModel.normalizePaper({
    id: 'p-one', title: 'Paper with note and PDF', folderIds: ['f-parent', 'f-child'],
    attachments: [{ id: 'att-one', kind: 'pdf', fileName: 'paper.pdf', path: 'D:/fixture/paper.pdf' }]
  }));
  state.notes.push(LitModel.normalizeNote({
    id: 'n-one', paperId: 'p-one', title: 'Reading note', content: 'Keep this note with the item.'
  }));
  const firstSave = store.save(true);

  // 在上一笔保存仍排队时再新增条目，验证 store 的序列化、touch 和 DB 签名协议。
  state.folders.push({ id: 'f-second', name: 'Another Collection', parentId: '', sortIndex: 1 });
  state.papers.push(LitModel.normalizePaper({
    id: 'p-two', title: 'Second paper', folderIds: ['f-second']
  }));
  const secondSave = store.save(true);
  assert.deepEqual(await Promise.all([firstSave, secondSave]), [true, true]);
  assert.equal(await store.waitForIdle(), true);

  // 删除 collection 只解除归属并记录 folder 墓碑，文献、附件和笔记仍保留。
  const child = state.folders.find(function (folder) { return folder.id === 'f-child'; });
  state.folders = state.folders.filter(function (folder) { return folder.id !== 'f-child'; });
  state.folderTombstones.push(Object.assign({}, child, { deletedAt: Date.now() }));
  state.papers.find(function (paper) { return paper.id === 'p-one'; }).folderIds = ['f-parent'];
  assert.equal(await store.save(true), true);

  // 文献软删除和恢复都经过同一工作区保存通道。
  const secondPaper = state.papers.find(function (paper) { return paper.id === 'p-two'; });
  secondPaper.deletedAt = Date.now();
  assert.equal(await store.save(true), true);
  secondPaper.deletedAt = null;
  secondPaper.updatedAt = Date.now();
  assert.equal(await store.save(true), true);
  assert.equal(await store.waitForIdle(), true);
  assert.deepEqual(toasts, [], '不应出现 SQLite 本地保存失败 toast');

  // 用全新的 store 重载，验证 DB 内容能按模型规则重新投影。
  const reloadedState = makeState();
  const reloadedStore = makeStore(reloadedState, db, toasts);
  await reloadedStore.load();
  const savedOne = reloadedState.papers.find(function (paper) { return paper.id === 'p-one'; });
  const savedTwo = reloadedState.papers.find(function (paper) { return paper.id === 'p-two'; });
  assert.ok(savedOne);
  assert.deepEqual(savedOne.folderIds, ['f-parent']);
  assert.equal(savedOne.attachments[0].id, 'att-one');
  assert.equal(savedOne.notes, 'Keep this note with the item.');
  assert.equal(reloadedState.notes.find(function (note) { return note.id === 'n-one'; }).content,
    'Keep this note with the item.');
  assert.ok(savedTwo);
  assert.equal(savedTwo.deletedAt, null);
  assert.ok(reloadedState.folderTombstones.some(function (folder) { return folder.id === 'f-child'; }));
  assert.deepEqual(toasts, [], '重载与签名确认期间也不应出现保存失败 toast');
});
