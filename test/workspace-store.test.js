'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createStore = require('../js/app/workspace-store.js').create;
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const LitModel = require('../js/model.js');
const { createLibraryDb } = require('../electron/db.js');
const LitMerge = require('../js/merge.js');

for (const scenario of [{ cancelFirst: false, overlap: false }, { cancelFirst: true, overlap: false }, { cancelFirst: false, overlap: true }, { cancelFirst: false, overlap: true, choice: 'remote' }]) {
  const { cancelFirst, overlap } = scenario;
  const choice = scenario.choice || 'local';
  test('保存冲突保留已确认祖先和本地修改' + (cancelFirst ? '，取消后重试仍需解决冲突' : '') + (overlap ? '，同字段修改选择' + choice : ''), async function (t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-store-conflict-'));
    const db = createLibraryDb(dir);
    await db.open();
    t.after(async function () { await db.close(); await fs.rm(dir, { recursive: true, force: true }); });
    db.replaceState({ papers: [{ id: 'p1', title: 'base', venue: 'base venue' }, { id: 'p2', title: 'unchanged' }] });
    const state = { papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [],
      savedSearchTombstones: [], tagColors: {}, tagColorRecords: [] };
    let resolutions = 0;
    const desktop = {
      loadLibrary: function () { return Promise.resolve(db.loadState()); },
      saveLibrary: function (value, base) { return Promise.resolve(db.saveState(Object.assign({}, value, { baseSignatures: base }))); }
    };
    const store = createStore({
      state: state, model: LitModel, uid: function () { return 'id'; }, T: function (s) { return s; },
      toast: function () {}, desktop: function () { return desktop; }, scheduleSync: function () {}, onLoad: function () {},
      resolveConflicts: function (conflicts, base) {
        ++resolutions;
        assert.equal(base.papers.p1.title, 'base');
        if (cancelFirst && resolutions === 1) return Promise.resolve(false);
        const merged = LitMerge.mergeEntity(base.papers.p1, state.papers[0], conflicts[0].entity, LitMerge.PAPER_SPEC);
        assert.equal(merged.conflicts.length, overlap ? 1 : 0);
        if (overlap) {
          assert.equal(merged.conflicts[0].field, 'title');
          LitMerge.applyChoice(merged.merged, merged.conflicts[0], choice);
        }
        state.papers[0] = merged.merged;
        return Promise.resolve(true);
      }
    });
    await store.load();
    state.papers[0].title = 'local title';
    state.papers[1].title = 'nonconflicting edit';
    const external = db.loadState();
    if (overlap) external.papers[0].title = 'external title';
    else external.papers[0].venue = 'external venue';
    db.saveState(external);
    if (cancelFirst) assert.equal(await store.save(true), false);
    assert.equal(await store.save(true), true);
    assert.equal(resolutions, cancelFirst ? 2 : 1);
    const expectedTitle = choice === 'remote' ? 'external title' : 'local title';
    assert.equal(db.loadState().papers[0].title, expectedTitle);
    assert.equal(db.loadState().papers[0].venue, overlap ? 'base venue' : 'external venue');
    assert.equal(store.getBase().papers.p1.title, expectedTitle);
    assert.equal(store.getBase().papers.p2.title, 'nonconflicting edit');
  });
}

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

test('连续保存按顺序写入并使用上次确认的签名', async function () {
  const state = { papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [],
    savedSearchTombstones: [], tagColors: {}, tagColorRecords: [] };
  const model = makeModel();
  const pending = [];
  const bases = [];
  const toasts = [];
  const desktop = {
    loadLibrary: function () { return Promise.resolve(workspace('base')); },
    saveLibrary: function (_value, base) {
      bases.push(base);
      return new Promise(function (resolve) { pending.push(resolve); });
    }
  };
  const store = createStore({
    state: state, model: model, uid: function () { return 'id'; }, T: function (s) { return s; },
    toast: function (message) { toasts.push(message); }, storeKey: 'test',
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    desktop: function () { return desktop; }, clearQueryCache: function () {}, scheduleSync: function () {},
    resolveConflicts: function () { return Promise.resolve(true); }, onLoad: function () {}
  });
  await store.load();
  state.papers[0].title = 'first';
  const first = store.save(true);
  await Promise.resolve();
  state.papers[0].title = 'second';
  const second = store.save(true);
  assert.equal(pending.length, 1);
  const firstSignatures = model.workspaceSignatures(workspace('first'));
  pending[0]({ signatures: firstSignatures, conflicts: [] });
  assert.equal(await first, true);
  await Promise.resolve();
  assert.equal(pending.length, 2);
  const latest = model.workspaceSignatures(workspace('second'));
  pending[1]({ signatures: latest, conflicts: [] });
  assert.equal(await second, true);
  assert.deepEqual(toasts, []);
  assert.equal(bases[1].papers.p1, firstSignatures.papers.p1);
  assert.equal(store.getBase().papers.p1.title, 'second');
});

test('连续删除同一文献所在的文件夹时每次保存均落库', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-store-delete-'));
  const db = createLibraryDb(dir);
  await db.open();
  t.after(async function () { await db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await db.replaceState({
    papers: [{ id: 'p1', title: 'Paper', folderIds: ['f1', 'f2'] }],
    folders: [{ id: 'f1', name: 'One' }, { id: 'f2', name: 'Two' }]
  });
  const state = { papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [],
    savedSearchTombstones: [], tagColors: {}, tagColorRecords: [] };
  const toasts = [];
  let pending = Promise.resolve();
  const desktop = {
    loadLibrary: function () { return Promise.resolve(db.loadState()); },
    saveLibrary: function (value, base) {
      const snapshot = JSON.parse(JSON.stringify(value));
      const signatures = JSON.parse(JSON.stringify(base));
      pending = pending.then(function () { return db.saveState(Object.assign(snapshot, { baseSignatures: signatures })); });
      return pending;
    }
  };
  const store = createStore({
    state: state, model: LitModel, uid: function () { return 'id'; }, T: function (s) { return s; },
    toast: function (message) { toasts.push(message); }, storeKey: 'test',
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    desktop: function () { return desktop; }, clearQueryCache: function () {}, scheduleSync: function () {},
    resolveConflicts: function () { return Promise.resolve(false); }, onLoad: function () {}
  });
  await store.load();
  for (const id of ['f1', 'f2']) {
    const folder = state.folders.find(function (item) { return item.id === id; });
    state.folders = state.folders.filter(function (item) { return item.id !== id; });
    state.folderTombstones.push(Object.assign({}, folder, { deletedAt: Date.now() }));
    state.papers[0].folderIds = state.papers[0].folderIds.filter(function (fid) { return fid !== id; });
    store.save(true);
  }
  assert.deepEqual({ idle: await store.waitForIdle(), toasts: toasts }, { idle: true, toasts: [] });
  const saved = db.loadState();
  assert.deepEqual(saved.papers[0].folderIds, []);
  assert.equal(saved.folders.filter(function (folder) { return !!folder.deletedAt; }).length, 2);
});

test('彻底清除带笔记的文献后连续保存均落库（内存投影漂移不触发写后校验误判）', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-store-purge-'));
  const db = createLibraryDb(dir);
  await db.open();
  t.after(async function () { await db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const paper1 = LitModel.normalizePaper({ id: 'p1', title: 'Paper One' });
  paper1.notes = 'hello note'; // 兼容投影（渲染层 setPaperNoteContent 维护）
  const paper2 = LitModel.normalizePaper({ id: 'p2', title: 'Paper Two' });
  await db.replaceState({
    papers: [paper1, paper2],
    notes: [LitModel.normalizeNote({ id: 'n1', paperId: 'p1', content: 'hello note' })]
  });
  const state = { papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [],
    savedSearchTombstones: [], tagColors: {}, tagColorRecords: [] };
  const toasts = [];
  let pending = Promise.resolve();
  const desktop = {
    loadLibrary: function () { return Promise.resolve(db.loadState()); },
    saveLibrary: function (value, base) {
      const snapshot = JSON.parse(JSON.stringify(value));
      const signatures = JSON.parse(JSON.stringify(base));
      pending = pending.then(function () { return db.saveState(Object.assign(snapshot, { baseSignatures: signatures })); });
      return pending;
    }
  };
  const store = createStore({
    state: state, model: LitModel, uid: function () { return 'id'; }, T: function (s) { return s; },
    toast: function (message) { toasts.push(message); }, storeKey: 'test',
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    desktop: function () { return desktop; }, clearQueryCache: function () {}, scheduleSync: function () {},
    resolveConflicts: function () { return Promise.resolve(false); }, onLoad: function () {}
  });
  await store.load();

  // 模拟 purgePapers：文献与附属笔记立墓碑；即使内存里的 paper.notes 投影未及时刷新，
  // 保存也必须按归一化口径落库并通过写后校验（此前这里会误判失败且之后每次保存都失败）。
  const now = Date.now();
  state.papers.forEach(function (p) {
    if (p.id !== 'p1') return;
    p.deletedAt = now; p.updatedAt = now;
  });
  state.notes.forEach(function (n) {
    if (n.paperId !== 'p1') return;
    n.deletedAt = now; n.updatedAt = now;
  });
  store.save(true);
  assert.equal(await store.waitForIdle(), true);
  assert.deepEqual(toasts, []);

  // 连续第二次删除（软删 p2）也必须正常落库
  const p2 = state.papers.find(function (p) { return p.id === 'p2'; });
  p2.deletedAt = Date.now(); p2.updatedAt = Date.now();
  store.save(true);
  assert.equal(await store.waitForIdle(), true);
  assert.deepEqual(toasts, []);

  const saved = db.loadState();
  const savedP1 = saved.papers.find(function (p) { return p.id === 'p1'; });
  const savedN1 = saved.notes.find(function (n) { return n.id === 'n1'; });
  assert.ok(savedP1.deletedAt && savedN1.deletedAt);
  assert.equal(savedP1.notes, ''); // 附属笔记已墓碑化，库端投影被重算为空
  assert.ok(saved.papers.find(function (p) { return p.id === 'p2'; }).deletedAt);
});

test('写后校验失败后锚点推进到库端真实签名，下一次保存可自愈', async function () {
  const state = { papers: [], notes: [], folders: [], folderTombstones: [], savedSearches: [],
    savedSearchTombstones: [], tagColors: {}, tagColorRecords: [] };
  const model = makeModel();
  const toasts = [];
  let sabotage = true;
  const desktop = {
    loadLibrary: function () { return Promise.resolve(workspace('base')); },
    saveLibrary: function (value) {
      const signatures = model.workspaceSignatures(value);
      if (sabotage) signatures.papers.p1 = 'tampered'; // 模拟一次库端签名口径漂移
      return Promise.resolve({ signatures: signatures, conflicts: [] });
    }
  };
  const store = createStore({
    state: state, model: model, uid: function () { return 'id'; }, T: function (s) { return s; },
    toast: function (message) { toasts.push(message); }, storeKey: 'test',
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    desktop: function () { return desktop; }, clearQueryCache: function () {}, scheduleSync: function () {},
    resolveConflicts: function () { return Promise.resolve(true); }, onLoad: function () {}
  });
  await store.load();
  state.papers[0].title = 'changed';
  assert.equal(await store.save(true), false); // 第一次校验失败：报错但不死锁
  assert.equal(toasts.length, 1);
  sabotage = false;
  assert.equal(await store.save(true), true); // 锚点已推进到库端真实签名，自愈
  assert.equal(toasts.length, 1);
});
