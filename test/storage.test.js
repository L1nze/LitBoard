'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLibraryStorage } = require('../electron/storage.js');

test('library storage saves, loads, and recovers from a damaged primary file', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const storage = createLibraryStorage(dir);
  await storage.save([{ id: 'p1', title: 'First', notes: 'important' }]);
  await storage.save([{ id: 'p1', title: 'Second', notes: 'newer' }]);
  assert.equal((await storage.load())[0].title, 'Second');
  await fs.writeFile(storage.paths.file, '{broken', 'utf8');
  const recovered = await storage.load();
  assert.equal(recovered[0].title, 'First');
  assert.equal(recovered[0].notes, 'important');
});

test('library storage persists folder definitions and assignments', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-folders-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const storage = createLibraryStorage(dir);
  await storage.saveState({
    folders: [{ id: 'f1', name: 'Methods' }],
    papers: [{ id: 'p1', title: 'Paper', folderIds: ['f1'] }]
  });
  const state = await storage.loadState();
  assert.equal(state.folders.length, 1);
  assert.equal(state.folders[0].id, 'f1');
  assert.equal(state.folders[0].name, 'Methods');
  assert.equal(state.folders[0].parentId, '');
  assert.equal(state.folders[0].sortIndex, 0);
  assert.deepEqual(state.papers[0].folderIds, ['f1']);
});
