'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLibraryDb } = require('../electron/db.js');
const { createLibraryStorage } = require('../electron/storage.js');

test('legacy JSON library and pdftext cache migrate into SQLite with backups kept', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-migrate-'));
  const dbs = [];
  t.after(async function () {
    for (const handle of dbs) await handle.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  // 造旧版数据
  const legacy = createLibraryStorage(dir);
  await legacy.saveState({
    papers: [
      { id: 'p1', title: 'Legacy One', authors: ['Ada Lovelace'], year: 1843, pdfPath: 'D:\\a.pdf' },
      { id: 'p2', title: 'Legacy Two', tags: ['综述'] }
    ],
    folders: [{ id: 'f1', name: 'Old Folder' }]
  });
  const pdfCacheFile = path.join(dir, 'pdftext.v1.json');
  await fs.writeFile(pdfCacheFile, JSON.stringify({
    p1: { fingerprint: 'fp1', pages: ['legacy cached text about transformers'], updatedAt: 1 }
  }), 'utf8');

  const db = createLibraryDb(dir);
  dbs.push(db);
  await db.open();
  const migrated = await db.migrateLegacy(legacy, pdfCacheFile);
  assert.deepEqual(migrated.sort(), ['library', 'pdftext']);

  // 数据完整进入 SQLite
  const state = await db.loadState();
  assert.equal(state.papers.length, 2);
  assert.equal(state.folders[0].name, 'Old Folder');
  assert.equal(state.papers.find(function (p) { return p.id === 'p1'; }).attachments[0].kind, 'pdf');
  const hits = await db.pdfTextQuery('ransformers');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].paperId, 'p1');

  // 旧文件改名留底而非删除
  await assert.doesNotReject(fs.access(legacy.paths.file + '.migrated'));
  await assert.doesNotReject(fs.access(pdfCacheFile + '.migrated'));
  await assert.rejects(fs.access(legacy.paths.file));
  await assert.rejects(fs.access(pdfCacheFile));

  // 二次运行不会重复迁移
  const again = await db.migrateLegacy(legacy, pdfCacheFile);
  assert.deepEqual(again, []);
});

test('migration on a fresh machine is a no-op', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-migrate-fresh-'));
  const db = createLibraryDb(dir);
  t.after(async function () {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await db.open();
  const migrated = await db.migrateLegacy(createLibraryStorage(dir), path.join(dir, 'pdftext.v1.json'));
  assert.deepEqual(migrated, []);
  assert.equal((await db.loadState()).papers.length, 0);
});
