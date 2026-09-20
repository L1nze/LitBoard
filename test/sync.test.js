'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const LitSync = require('../js/sync.js');
const { createIntegrations, extractFirstPdfFromZip } = require('../electron/integrations.js');
const { DatabaseSync } = require('node:sqlite');

test('workspace sync keeps both sides and LWW-merges by id', function () {
  const result = LitSync.mergeWorkspaces(
    { folders: [{ id: 'f1', name: 'Local' }], papers: [{ id: 'p1', title: 'Same Paper', doi: '10.1/x', notes: 'local', folderIds: ['f1'] }] },
    { folders: [{ id: 'f2', name: 'Remote' }], papers: [{ id: 'p2', title: 'Same Paper', doi: '10.1/x', notes: 'remote', folderIds: ['f2'] }] }
  );
  // 不同 id 的同 DOI 条目在同步层各自保留（应用层的自动查重负责折叠）
  assert.equal(result.workspace.papers.length, 2);
  assert.deepEqual(result.workspace.folders.map(function (folder) { return folder.id; }).sort(), ['f1', 'f2']);
});

test('sync LWW picks the newer paper as a whole', function () {
  const older = Date.now() - 10000;
  const newer = Date.now();
  const result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: '本地标题', tags: ['a'], folderIds: ['f1'], updatedAt: older }] },
    { papers: [{ id: 'p1', title: '远端标题', tags: ['b'], folderIds: ['f2'], updatedAt: newer }],
      folders: [{ id: 'f1', name: 'F1' }, { id: 'f2', name: 'F2' }] }
  );
  const paper = result.workspace.papers[0];
  assert.equal(paper.title, '远端标题'); // 新的赢
  assert.deepEqual(paper.tags, ['b']);
  assert.deepEqual(paper.folderIds, ['f2']);
  assert.equal(result.conflicts.length, 1); // 本地被覆盖 → 记录
  assert.equal(result.conflicts[0].overwritten.title, '本地标题');
});

test('sync LWW keeps the newer paper collections without reviving removals', function () {
  const older = 100;
  const newer = 200;
  const annotationA = { id: 'a1', type: 'highlight', color: '#ffd400', text: 'a', comment: '',
    position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, createdAt: 1, updatedAt: older };
  const annotationB = { id: 'a2', type: 'highlight', color: '#ffd400', text: 'b', comment: '',
    position: { pageIndex: 0, rects: [[5, 6, 7, 8]] }, createdAt: 1, updatedAt: older };
  const result = LitSync.mergeWorkspaces(
    {
      folders: [{ id: 'f1', name: 'Keep', updatedAt: older }, { id: 'f2', name: 'Remove', updatedAt: older }],
      papers: [{ id: 'p1', title: 'Paper', updatedAt: newer, tags: ['keep'], folderIds: ['f1'],
        attachments: [{ id: 'att1', kind: 'pdf', fileName: 'keep.pdf', path: 'D:\\keep.pdf' }],
        pdfAnnotations: [annotationA] }]
    },
    {
      folders: [{ id: 'f1', name: 'Keep', updatedAt: older }, { id: 'f2', name: 'Remove', updatedAt: older }],
      papers: [{ id: 'p1', title: 'Paper', updatedAt: older, tags: ['keep', 'removed'], folderIds: ['f1', 'f2'],
        attachments: [
          { id: 'att1', kind: 'pdf', fileName: 'keep.pdf', path: 'E:\\keep.pdf' },
          { id: 'att2', kind: 'supp', fileName: 'removed.zip', path: 'E:\\removed.zip' }
        ],
        pdfAnnotations: [annotationA, annotationB] }]
    }
  );
  const paper = result.workspace.papers[0];
  assert.deepEqual(paper.tags, ['keep']);
  assert.deepEqual(paper.folderIds, ['f1']);
  assert.deepEqual(paper.attachments.map(function (item) { return item.id; }), ['att1']);
  assert.equal(paper.attachments[0].path, 'D:\\keep.pdf');
  assert.deepEqual(paper.pdfAnnotations.map(function (item) { return item.id; }), ['a1']);
});

test('remote winners retain matching local snapshot files', function () {
  const snapshot = { id: 'snap1', type: 'snapshot', color: '#ffd400', text: '', comment: '',
    position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, createdAt: 1, updatedAt: 1 };
  const result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: 'Local', updatedAt: 100,
      pdfAnnotations: [Object.assign({}, snapshot, { imagePath: 'D:\\local\\snapshot.png' })] }] },
    { papers: [{ id: 'p1', title: 'Remote', updatedAt: 200, pdfAnnotations: [snapshot] }] }
  );
  assert.equal(result.workspace.papers[0].title, 'Remote');
  assert.equal(result.workspace.papers[0].pdfAnnotations[0].imagePath, 'D:\\local\\snapshot.png');
});

test('sync purge scenario: newer local tombstone beats older remote paper (no revival)', function () {
  const purgeAt = 500;
  const result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: '彻底删除', deletedAt: purgeAt, updatedAt: purgeAt, doi: '10.1000/x' }] },
    { papers: [{ id: 'p1', title: '彻底删除', deletedAt: null, updatedAt: 100, doi: '10.1000/x' }] }
  );
  const paper = result.workspace.papers[0];
  assert.equal(paper.deletedAt, purgeAt);  // 墓碑（本地较新）胜出，不会复活为活跃条目
  assert.strictEqual(result.conflicts.length, 0); // 本地胜出不产生覆盖冲突
});

test('sync does not revive a purged paper that no longer exists on either side', function () {
  const purgeAt = 500;
  // 本地已上传墓碑后，设备 B 合并：本地有墓碑，远端已删除该条目
  const result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: 'x', deletedAt: purgeAt, updatedAt: purgeAt, doi: '10.1000/y' }] },
    { papers: [] }
  );
  assert.equal(result.workspace.papers[0].deletedAt, purgeAt);
});

test('sync propagates folder, saved-search, and tag-color tombstones', function () {  const result = LitSync.mergeWorkspaces(
    {
      papers: [],
      folders: [{ id: 'f1', name: 'Folder', updatedAt: 100, deletedAt: 200 }],
      savedSearches: [{ id: 's1', name: 'Search', query: 'tag:x', updatedAt: 100, deletedAt: 200 }],
      tagColorRecords: [{ tag: 'x', color: '#112233', updatedAt: 100, deletedAt: 200 }]
    },
    {
      papers: [],
      folders: [{ id: 'f1', name: 'Folder', updatedAt: 100 }],
      savedSearches: [{ id: 's1', name: 'Search', query: 'tag:x', updatedAt: 100 }],
      tagColorRecords: [{ tag: 'x', color: '#112233', updatedAt: 100 }]
    }
  );
  assert.equal(result.workspace.folders[0].deletedAt, 200);
  assert.equal(result.workspace.savedSearches[0].deletedAt, 200);
  assert.equal(result.workspace.tagColorRecords[0].deletedAt, 200);
  assert.deepEqual(result.workspace.tagColors, {});
});

test('sync tombstone propagates deletion when the delete is newer', function () {
  const t1 = Date.now() - 10000;
  const t2 = Date.now();
  // 远端更新于 t2，本地删除于 t1 → 远端复活（更新更晚）
  let result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: 'X', deletedAt: t1, updatedAt: t1 }] },
    { papers: [{ id: 'p1', title: 'X', updatedAt: t2 }] }
  );
  assert.equal(result.workspace.papers[0].deletedAt, null);
  // 本地删除于 t2（更晚）→ 删除传播
  result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: 'X', deletedAt: t2, updatedAt: t1 }] },
    { papers: [{ id: 'p1', title: 'X', updatedAt: t1 }] }
  );
  assert.ok(result.workspace.papers[0].deletedAt);
  // 只存在于一端的条目原样保留（含墓碑）
  result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: 'X', deletedAt: t2, updatedAt: t2 }] },
    { papers: [] }
  );
  assert.equal(result.workspace.papers.length, 1);
  assert.ok(result.workspace.papers[0].deletedAt);
});

test('sync keeps the winning paper annotation snapshot', function () {
  const t1 = Date.now() - 5000;
  const t2 = Date.now();
  const annA = { id: 'a1', type: 'highlight', color: '#ffd400', text: 'q', comment: 'old',
    position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, createdAt: 1, updatedAt: t1 };
  const annB = Object.assign({}, annA, { comment: 'new', updatedAt: t2 });
  const result = LitSync.mergeWorkspaces(
    { papers: [{ id: 'p1', title: 'X', updatedAt: t2, pdfAnnotations: [annA] }] },
    { papers: [{ id: 'p1', title: 'X', updatedAt: t1, pdfAnnotations: [annB] }] }
  );
  assert.equal(result.workspace.papers[0].pdfAnnotations.length, 1);
  assert.equal(result.workspace.papers[0].pdfAnnotations[0].comment, 'old');
});

test('v4 sync plan exposes field conflicts and applies the selected side conditionally', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-plan-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 4, papers: [{ id: 'p1', title: 'Remote', updatedAt: 20 }], folders: [] });
  const puts = [];
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: safeStorage,
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return new Response(remoteBody, { status: 200, headers: { ETag: '"v1"' } });
      }
      if (init.method === 'GET') return new Response('', { status: 404 });
      if (init.method === 'MKCOL') return new Response('', { status: 405 });
      if (init.method === 'PUT') {
        puts.push({ body: init.body, headers: init.headers });
        remoteBody = init.body;
        return new Response('', { status: 201, headers: { ETag: '"v2"' } });
      }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const plan = await integrations.createNutstoreSyncPlan({
    mode: 'merge', workspace: { papers: [{ id: 'p1', title: 'Local', updatedAt: 10 }], folders: [] }
  });
  assert.equal(plan.syncVersion, 6);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].field, 'title');
  const result = await integrations.applyNutstoreSyncPlan({
    planId: plan.planId,
    resolutions: { [plan.conflicts[0].conflictId]: 'local' }
  });
  assert.equal(result.workspace.papers[0].title, 'Local');
  assert.equal(JSON.parse(puts[0].body).syncVersion, 6);
  assert.equal(puts[0].headers['If-Match'], '"v1"');
});

test('stale remote sync plan is rejected without uploading', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-plan-stale-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 4, papers: [{ id: 'p1', title: 'Remote' }], folders: [] });
  let etag = '"v1"', putCount = 0;
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: safeStorage,
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
      }
      if (init.method === 'GET') return new Response('', { status: 404 });
      if (init.method === 'MKCOL') return new Response('', { status: 405 });
      if (init.method === 'PUT') { putCount++; return new Response('', { status: 201 }); }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const plan = await integrations.createNutstoreSyncPlan({ mode: 'restore', workspace: { papers: [], folders: [] } });
  remoteBody = JSON.stringify({ syncVersion: 4, papers: [{ id: 'p2', title: 'Changed' }], folders: [] });
  etag = '"v2"';
  await assert.rejects(
    integrations.applyNutstoreSyncPlan({ planId: plan.planId, resolutions: {} }),
    function (error) { return error && error.code === 'SYNC_PLAN_STALE'; }
  );
  assert.equal(putCount, 0);
});

test('remote restore refuses to treat a missing library file as an empty library', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-restore-missing-library-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(),
    fetch: async function (url, init) {
      if (init.method === 'GET') return new Response('', { status: 404 });
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p', nutstoreFolder: 'LitBoard' });
  await assert.rejects(
    integrations.createNutstoreSyncPlan({ mode: 'restore', workspace: { papers: [{ id: 'p1', title: '本地' }], folders: [] } }),
    /未找到远端库文件.*litboard-library\.json/
  );
});

test('concurrent regular sync retries on an ETag change instead of losing either device', async function (t) {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-concurrent-a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-concurrent-b-'));
  t.after(function () { return Promise.all([fs.rm(dirA, { recursive: true, force: true }), fs.rm(dirB, { recursive: true, force: true })]); });
  let remoteBody = JSON.stringify({ syncVersion: 4, papers: [{ id: 'p0', title: 'Base' }], folders: [] });
  let etag = '"v1"';
  let libraryReads = 0, releaseReads;
  const readBarrier = new Promise(function (resolve) { releaseReads = resolve; });
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      const snapshot = remoteBody, snapshotEtag = etag;
      libraryReads++;
      if (libraryReads === 2) releaseReads();
      if (libraryReads <= 2) await readBarrier;
      return new Response(snapshot, { status: 200, headers: { ETag: snapshotEtag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      if (init.headers['If-Match'] !== etag) return new Response('', { status: 412 });
      remoteBody = init.body;
      etag = etag === '"v1"' ? '"v2"' : '"v3"';
      return new Response('', { status: 201, headers: { ETag: etag } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const A = createIntegrations({ baseDir: dirA, homeDir: dirA, safeStorage: safeStorage, fetch: fetch });
  const B = createIntegrations({ baseDir: dirB, homeDir: dirB, safeStorage: safeStorage, fetch: fetch });
  await A.saveConfig({ nutstoreUser: 'a', nutstorePassword: 'p' });
  await B.saveConfig({ nutstoreUser: 'b', nutstorePassword: 'p' });
  await Promise.all([
    A.nutstoreSync({ papers: [{ id: 'pa', title: 'A' }], folders: [] }),
    B.nutstoreSync({ papers: [{ id: 'pb', title: 'B' }], folders: [] })
  ]);
  const ids = JSON.parse(remoteBody).papers.map(function (paper) { return paper.id; }).sort();
  assert.deepEqual(ids, ['p0', 'pa', 'pb']);
});

test('remote restore downloads and verifies attachment and snapshot assets atomically', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-assets-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const pdf = Buffer.from('%PDF-remote-asset');
  const image = Buffer.from('PNG-snapshot-asset');
  const hash = function (value) { return crypto.createHash('sha256').update(value).digest('hex'); };
  let remote = {
    syncVersion: 4,
    papers: [{ id: 'p1', title: 'Remote', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', cloudName: 'p1.pdf', cloudHash: hash(pdf), cloudSize: pdf.length }],
      pdfAnnotations: [{ id: 'n1', type: 'snapshot', position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, cloudName: 'snapshots/p1/n1.png', cloudHash: hash(image), cloudSize: image.length }] }],
    folders: []
  };
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: safeStorage,
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) return new Response(JSON.stringify(remote), { status: 200, headers: { ETag: '"v1"' } });
      if (init.method === 'GET' && url.endsWith('/attachments/p1.pdf')) return new Response(pdf, { status: 200 });
      if (init.method === 'GET' && url.endsWith('/attachments/snapshots/p1/n1.png')) return new Response(image, { status: 200 });
      if (init.method === 'GET') return new Response('', { status: 404 });
      if (init.method === 'MKCOL') return new Response('', { status: 405 });
      if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
        remote = JSON.parse(init.body);
        return new Response('', { status: 201, headers: { ETag: '"v2"' } });
      }
      if (init.method === 'PUT') return new Response('', { status: 201 });
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const plan = await integrations.createNutstoreSyncPlan({ mode: 'restore', workspace: { papers: [], folders: [] } });
  const result = await integrations.applyNutstoreSyncPlan({ planId: plan.planId, resolutions: {} });
  const attachmentPath = result.workspace.papers[0].attachments[0].path;
  const imagePath = result.workspace.papers[0].pdfAnnotations[0].imagePath;
  assert.equal(await fs.readFile(attachmentPath, 'utf8'), pdf.toString('utf8'));
  assert.equal(await fs.readFile(imagePath, 'utf8'), image.toString('utf8'));
});

test('portable configuration can be restored independently', async function (t) {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-portable-a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-portable-b-'));
  t.after(function () { return Promise.all([fs.rm(dirA, { recursive: true, force: true }), fs.rm(dirB, { recursive: true, force: true })]); });
  const cloud = new Map();
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  const fetchFactory = function () { return async function (url, init) {
    if (init.method === 'GET') { const body = cloud.get(url); return body ? new Response(body, { status: 200 }) : new Response('', { status: 404 }); }
    if (init.method === 'MKCOL') return new Response('', { status: 201 });
    if (init.method === 'PUT') { cloud.set(url, init.body); return new Response('', { status: 201 }); }
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  }; };
  const A = createIntegrations({ baseDir: dirA, homeDir: dirA, safeStorage: safeStorage, fetch: fetchFactory() });
  const B = createIntegrations({ baseDir: dirB, homeDir: dirB, safeStorage: safeStorage, fetch: fetchFactory() });
  await A.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p', configSyncPassword: 'shared', translatorProvider: 'openai', translatorTarget: 'en', renameTemplate: '{title}', trashRetentionDays: 7, autoWriteBack: true });
  await A.nutstoreSync({ papers: [], folders: [] });
  await B.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p', configSyncPassword: 'shared' });
  const pulled = await B.pullPortableConfig({});
  assert.equal(pulled.found, true);
  assert.equal(pulled.config.translatorProvider, 'openai');
  assert.equal(pulled.config.translatorTarget, 'en');
  assert.equal(pulled.config.renameTemplate, '{title}');
  assert.equal(pulled.config.trashRetentionDays, 7);
  assert.equal(pulled.config.autoWriteBack, true);
});

test('nutstore WebDAV sync reads, merges, and writes the library envelope', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let written = null;
  const requestUrls = [];
  let remote = { papers: [{ id: 'p2', title: 'Remote Paper', doi: '10.2/r' }], folders: [] };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      requestUrls.push(url);
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return new Response(JSON.stringify(remote), { status: 200 });
      }
      if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
        written = JSON.parse(init.body); remote = written; return new Response('', { status: 201 });
      }
      if (init.method === 'MKCOL') return new Response('', { status: 201 });
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({
    nutstoreUser: 'user@example.com', nutstorePassword: 'secret', nutstoreFolder: 'Research/LitBoard'
  });
  const result = await integrations.nutstoreSync({ papers: [{ id: 'p1', title: 'Local Paper', doi: '10.1/l' }], folders: [] });
  assert.equal(result.workspace.papers.length, 2);
  assert.equal(written.papers.length, 2);
  assert.equal(written.syncVersion, 6);
  assert.equal(result.uploaded, true);
  assert.ok(requestUrls.some(function (url) { return url.includes('/Research/LitBoard/litboard-library.json'); }));
});

test('nutstore sync initializes the LitBoard directory when first read returns 409', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-409-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let firstRead = true;
  let libraryBody = '';
  const createdFolders = [];
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json') && firstRead) {
        firstRead = false; return new Response('', { status: 409 });
      }
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return libraryBody ? new Response(libraryBody, { status: 200 }) : new Response('', { status: 404 });
      }
      if (init.method === 'MKCOL') { createdFolders.push(url); return new Response('', { status: 201 }); }
      if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
        libraryBody = init.body;
        return new Response('', { status: 201 });
      }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({
    nutstoreUser: 'user@example.com', nutstorePassword: 'secret', nutstoreFolder: 'Research/LitBoard'
  });
  const result = await integrations.nutstoreSync({ papers: [{ id: 'p1', title: 'Local Paper' }], folders: [] });
  assert.equal(result.workspace.papers.length, 1);
  assert.ok(createdFolders.includes('https://dav.jianguoyun.com/dav/Research'));
  assert.ok(createdFolders.includes('https://dav.jianguoyun.com/dav/Research/LitBoard'));
});

test('nutstore sync skips the upload when the merged content is identical to remote', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-skip-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let putCount = 0;
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  let remoteBody = '';
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: safeStorage,
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return remoteBody ? new Response(remoteBody, { status: 200 }) : new Response('', { status: 404 });
      }
      if (init.method === 'GET') return new Response('', { status: 404 });
      if (init.method === 'MKCOL') return new Response('', { status: 201 });
      if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
        putCount++;
        remoteBody = init.body;
        return new Response('', { status: 201 });
      }
      if (init.method === 'PUT') return new Response('', { status: 201 });
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u@x.com', nutstorePassword: 'p', nutstoreFolder: 'LitBoard' });
  const papers = [{ id: 'p1', title: 'Paper', updatedAt: 1000 }];
  const first = await integrations.nutstoreSync({ papers: papers, folders: [] });
  assert.equal(first.uploaded, true);
  const second = await integrations.nutstoreSync({ papers: first.workspace.papers, folders: [] });
  assert.equal(second.uploaded, false); // 内容一致：增量跳过
  assert.equal(putCount, 1);
});

test('sync rejects a successful PUT when the remote library did not persist the payload', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-write-verify-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  let libraryPuts = 0;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(),
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return new Response(remoteBody, { status: 200, headers: { ETag: '"v1"' } });
      }
      if (init.method === 'GET') return new Response('', { status: 404 });
      if (init.method === 'MKCOL') return new Response('', { status: 405 });
      if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
        libraryPuts++;
        // 模拟服务端返回成功但没有真正保存请求体。
        return new Response('', { status: 201, headers: { ETag: '"v2"' } });
      }
      if (init.method === 'PUT') return new Response('', { status: 201 });
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  await assert.rejects(
    integrations.nutstoreSync({ papers: [{ id: 'p1', title: '必须落到远端' }], folders: [] }),
    /远端写入后校验失败/
  );
  assert.equal(libraryPuts, 1);
});

test('nutstore sync excludes local paths and ignores path-only differences', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-local-paths-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const cloud = new Map();
  let libraryPutCount = 0;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      if (init.method === 'GET') {
        const body = cloud.get(url);
        return body ? new Response(body, { status: 200 }) : new Response('', { status: 404 });
      }
      if (init.method === 'MKCOL') return new Response('', { status: 201 });
      if (init.method === 'PUT') {
        cloud.set(url, init.body);
        if (url.endsWith('litboard-library.json')) libraryPutCount++;
        return new Response('', { status: 201 });
      }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'user@example.com', nutstorePassword: 'secret' });
  const base = { id: 'p1', title: 'Paper', updatedAt: 100,
    attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: 'C:\\Users\\Alice\\paper.pdf' }],
    pdfAnnotations: [{ id: 'snap1', type: 'snapshot', imagePath: 'C:\\Users\\Alice\\snapshot.png',
      position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, createdAt: 1, updatedAt: 1 }] };
  const first = await integrations.nutstoreSync({ papers: [base], folders: [] });
  assert.equal(first.uploaded, true);
  const remoteText = Array.from(cloud.entries()).find(function (entry) { return entry[0].endsWith('litboard-library.json'); })[1];
  assert.doesNotMatch(remoteText, /Alice|paper\.pdf"\s*,\s*"path|imagePath/);
  const changedPath = JSON.parse(JSON.stringify(first.workspace.papers[0]));
  changedPath.attachments[0].path = 'D:\\Users\\Bob\\paper.pdf';
  changedPath.pdfPath = changedPath.attachments[0].path;
  changedPath.pdfAnnotations[0].imagePath = 'D:\\Users\\Bob\\snapshot.png';
  const second = await integrations.nutstoreSync({ papers: [changedPath], folders: [] });
  assert.equal(second.uploaded, false);
  assert.equal(libraryPutCount, 1);
});

test('nutstore sync writes sensitive app settings as an encrypted config file', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-config-sync-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let encryptedConfig = '';
  let libraryBody = '';
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return libraryBody ? new Response(libraryBody, { status: 200 }) : new Response('', { status: 404 });
      }
      if (init.method === 'GET' && url.endsWith('litboard-config.enc')) return new Response('', { status: 404 });
      if (init.method === 'MKCOL') return new Response('', { status: 201 });
      if (init.method === 'PUT' && url.endsWith('litboard-config.enc')) { encryptedConfig = init.body; return new Response('', { status: 201 }); }
      if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
        libraryBody = init.body;
        return new Response('', { status: 201 });
      }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({
    nutstoreUser: 'user@example.com', nutstorePassword: 'nutstore-secret',
    translatorApiKey: 'translator-secret', scigreatApiKey: 'scigreat-secret', configSyncPassword: 'shared-config-password'
  });
  await integrations.nutstoreSync({ papers: [], folders: [] });
  const envelope = JSON.parse(encryptedConfig);
  assert.equal(envelope.version, 1);
  assert.ok(envelope.salt && envelope.iv && envelope.tag && envelope.data);
  assert.doesNotMatch(encryptedConfig, /translator-secret|scigreat-secret|nutstore-secret/);
});

test('nutstore config sync propagates API keys across devices and never wipes local secrets', async function (t) {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-config-a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-config-b-'));
  t.after(function () {
    return Promise.all([
      fs.rm(dirA, { recursive: true, force: true }),
      fs.rm(dirB, { recursive: true, force: true })
    ]);
  });
  const cloud = new Map();
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  const fetchFactory = function () {
    return async function (url, init) {
      if (init.method === 'GET') {
        const body = cloud.get(url);
        return body ? new Response(body, { status: 200 }) : new Response('', { status: 404 });
      }
      if (init.method === 'MKCOL') return new Response('', { status: 201 });
      if (init.method === 'PUT') {
        if (url.endsWith('litboard-config.enc')) {
          assert.doesNotMatch(init.body, /translator-secret|scigreat-secret|nutstore-secret/);
        }
        cloud.set(url, init.body);
        return new Response('', { status: 201 });
      }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    };
  };
  const A = createIntegrations({ baseDir: dirA, homeDir: dirA, safeStorage, fetch: fetchFactory() });
  const B = createIntegrations({ baseDir: dirB, homeDir: dirB, safeStorage, fetch: fetchFactory() });

  await A.saveConfig({
    nutstoreUser: 'user@example.com', nutstorePassword: 'nutstore-secret',
    translatorApiKey: 'translator-secret', scigreatApiKey: 'scigreat-secret', configSyncPassword: 'shared-config-password'
  });
  await B.saveConfig({ nutstoreUser: 'user@example.com', nutstorePassword: 'nutstore-secret', configSyncPassword: 'shared-config-password' });

  // B 先同步（没有 Key），云端变成“空 Key”配置
  await B.nutstoreSync({ papers: [], folders: [] });
  // A 同步：远端时间戳更新但无 Key → 必须保留本机 Key 并上传
  await A.nutstoreSync({ papers: [], folders: [] });
  assert.equal((await A.getConfig()).hasTranslatorApiKey, true);
  assert.equal((await A.getConfig()).hasScigreatApiKey, true);
  // B 再同步：应从云端获得 A 的 Key（配置在设备间收敛，而不是互相抹掉）
  await B.nutstoreSync({ papers: [], folders: [] });
  const configB = await B.getConfig();
  assert.equal(configB.hasTranslatorApiKey, true);
  assert.equal(configB.hasScigreatApiKey, true);
});

test('partial integration config saves preserve the selected translation target', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-config-partial-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function () { throw new Error('network should not be used'); }
  });
  await integrations.saveConfig({ translatorTarget: 'en' });
  await integrations.saveConfig({ zoteroDataDir: path.join(dir, 'Zotero') });
  assert.equal((await integrations.getConfig()).translatorTarget, 'en');
});

test('unchanged encrypted config is not rewritten on every sync', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-config-stable-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const cloud = new Map();
  let configPutCount = 0;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      if (init.method === 'GET') {
        const body = cloud.get(url);
        return body ? new Response(body, { status: 200 }) : new Response('', { status: 404 });
      }
      if (init.method === 'MKCOL') return new Response('', { status: 201 });
      if (init.method === 'PUT') {
        cloud.set(url, init.body);
        if (url.endsWith('litboard-config.enc')) configPutCount++;
        return new Response('', { status: 201 });
      }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({
    nutstoreUser: 'user@example.com', nutstorePassword: 'secret',
    translatorApiKey: 'api-key', configSyncPassword: 'shared-password'
  });
  await integrations.nutstoreSync({ papers: [], folders: [] });
  await integrations.nutstoreSync({ papers: [], folders: [] });
  assert.equal(configPutCount, 1);
});

test('nutstore connection test uses unsaved credentials without writing data', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-nutstore-test-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let requestSeen = null;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: { isEncryptionAvailable: function () { return true; } },
    fetch: async function (url, init) {
      requestSeen = { url: url, init: init };
      return new Response('', { status: 207 });
    }
  });
  const result = await integrations.testNutstoreConnection({
    nutstoreUrl: 'https://dav.jianguoyun.com/dav/', nutstoreUser: 'user@example.com', nutstorePassword: 'app-password',
    nutstoreFolder: 'Research/LitBoard'
  });
  assert.equal(result.ok, true);
  assert.equal(requestSeen.init.method, 'PROPFIND');
  assert.equal(requestSeen.init.headers.Depth, '0');
  assert.match(requestSeen.init.headers.Authorization, /^Basic /);
  assert.equal(requestSeen.url, 'https://dav.jianguoyun.com/dav/Research/LitBoard');
  assert.equal(result.folder, 'Research/LitBoard');
});

test('network timeout aborts the underlying WebDAV request', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-nutstore-timeout-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let aborted = false;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, requestTimeoutMs: 20,
    safeStorage: { isEncryptionAvailable: function () { return true; } },
    fetch: function (url, init) {
      return new Promise(function (resolve, reject) {
        init.signal.addEventListener('abort', function () {
          aborted = true;
          reject(new Error('aborted'));
        }, { once: true });
      });
    }
  });
  await assert.rejects(integrations.testNutstoreConnection({
    nutstoreUrl: 'https://dav.jianguoyun.com/dav/', nutstoreUser: 'user@example.com', nutstorePassword: 'app-password',
    nutstoreFolder: 'LitBoard'
  }), /网络请求超时/);
  assert.equal(aborted, true);
});

test('translation keeps the API key in encrypted config and uses the selected provider', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-translate-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let requestSeen = null;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      requestSeen = { url: url, init: init };
      return new Response(JSON.stringify({ choices: [{ message: { content: '机器翻译结果' } }] }), { status: 200 });
    }
  });
  await integrations.saveConfig({ translatorProvider: 'qwen', translatorApiKey: 'secret-key' });
  const config = await integrations.getConfig();
  assert.equal(config.translatorProvider, 'qwen');
  assert.equal(config.hasTranslatorApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'translatorApiKey'), false);
  const result = await integrations.translateText({ text: 'A selected sentence.' });
  assert.equal(result.provider, 'qwen');
  assert.equal(result.translation, '机器翻译结果');
  assert.equal(requestSeen.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(JSON.parse(requestSeen.init.body).model, 'qwen-mt-plus');
  assert.match(requestSeen.init.headers.Authorization, /^Bearer /);
});

test('Aliyun machine translation signs AccessKey credentials without sending the secret', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-aliyun-translate-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let requestSeen = null;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      requestSeen = { url: url, init: init };
      return new Response(JSON.stringify({ Code: '200', Data: { Translated: '机器翻译结果' } }), { status: 200 });
    }
  });
  await integrations.saveConfig({
    translatorProvider: 'aliyun', translatorApiKey: 'test-access-id@test-access-secret', translatorTarget: 'zh'
  });
  const result = await integrations.translateText({ text: 'A selected sentence.' });
  const parameters = new URLSearchParams(requestSeen.init.body);
  assert.equal(result.provider, 'aliyun');
  assert.equal(result.translation, '机器翻译结果');
  assert.equal(requestSeen.url, 'https://mt.cn-hangzhou.aliyuncs.com/');
  assert.equal(requestSeen.init.method, 'POST');
  assert.equal(parameters.get('AccessKeyId'), 'test-access-id');
  assert.equal(parameters.get('Action'), 'TranslateGeneral');
  assert.equal(parameters.get('SourceLanguage'), 'auto');
  assert.equal(parameters.get('TargetLanguage'), 'zh');
  assert.equal(parameters.get('SourceText'), 'A selected sentence.');
  assert.ok(parameters.get('Signature'));
  assert.doesNotMatch(requestSeen.init.body, /test-access-secret/);
});

test('translation connection test uses unsaved settings without persisting credentials', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-translate-test-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let requestSeen = null;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      requestSeen = { url: url, init: init };
      return new Response(JSON.stringify({ choices: [{ message: { content: '连接测试成功' } }] }), { status: 200 });
    }
  });
  const result = await integrations.testTranslationConnection({
    translatorProvider: 'qwen', translatorModel: '', translatorTarget: 'zh', translatorApiKey: 'unsaved-key'
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'qwen');
  assert.equal(result.translation, '连接测试成功');
  assert.equal(requestSeen.init.headers.Authorization, 'Bearer unsaved-key');
  await assert.rejects(fs.readFile(path.join(dir, 'integrations.json'), 'utf8'), { code: 'ENOENT' });
});

test('SciGreat journal-rank lookup uses an encrypted key and journal query', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-scigreat-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let requestSeen = null;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      requestSeen = { url: url, init: init };
      return new Response(JSON.stringify({ code: 200, results: [{ data: { abbr: 'Nature', jcr: 'Q1', cas: '1区', imf: 48.5 } }] }), { status: 200 });
    }
  });
  await integrations.saveConfig({ scigreatApiKey: 'scigreat-secret' });
  const config = await integrations.getConfig();
  assert.equal(config.hasScigreatApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'scigreatApiKey'), false);
  const response = await integrations.getScigreatRank({ journal: 'Nature' });
  assert.equal(response.results[0].data.jcr, 'Q1');
  assert.equal(requestSeen.url, 'https://api.scigreat.com/info/getrank');
  assert.deepEqual(JSON.parse(requestSeen.init.body), [{ journal: ['Nature'] }]);
  assert.match(requestSeen.init.headers.Authorization, /^Bearer /);
});

test('EasyScholar journal-rank lookup uses encrypted secretKey, URL-encodes期刊名, and paces to 2/s', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-easyscholar-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const requests = [];
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url) {
      requests.push({ url: url, at: Date.now() });
      return new Response(JSON.stringify({
        code: 200, msg: 'SUCCESS',
        data: { officialRank: { all: { xr: '1区', xrTop: 'Top', pku: '北大核心', sciif: '48.5', jci: '11.14' } } }
      }), { status: 200 });
    }
  });
  await integrations.saveConfig({ rankProvider: 'easyscholar', easyscholarApiKey: 'es-secret' });
  const config = await integrations.getConfig();
  assert.equal(config.rankProvider, 'easyscholar');
  assert.equal(config.hasEasyscholarApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'easyscholarApiKey'), false);
  const response = await integrations.getJournalRank({ journal: 'Nature Reviews & Molecular Biology' });
  assert.equal(response.data.officialRank.all.xr, '1区');
  assert.equal(requests.length, 1);
  const firstUrl = new URL(requests[0].url);
  assert.equal(firstUrl.origin + firstUrl.pathname, 'https://www.easyscholar.cc/open/getPublicationRank');
  assert.equal(firstUrl.searchParams.get('secretKey'), 'es-secret');
  assert.equal(firstUrl.searchParams.get('publicationName'), 'Nature Reviews & Molecular Biology');
  // 连续两次请求必须间隔 ≥500ms（官方限速 ≤2 次/秒）
  await integrations.getJournalRank({ journal: 'Cell' });
  assert.equal(requests.length, 2);
  assert.ok(requests[1].at - requests[0].at >= 490, 'EasyScholar 请求未限速');
  const raw = await fs.readFile(path.join(dir, 'integrations.json'), 'utf8');
  assert.equal(raw.includes('es-secret'), false, 'EasyScholar key 以明文写入配置');
});

test('EasyScholar test connection uses unsaved key without persisting credentials', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-easyscholar-test-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let requestSeen = null;
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      requestSeen = { url: url, init: init };
      return new Response(JSON.stringify({
        code: 200, msg: 'SUCCESS', data: { officialRank: { all: { sci: 'Q1', sciBase: '中科院1区', xr: '1区' } } }
      }), { status: 200 });
    }
  });
  const result = await integrations.testJournalRankConnection({
    rankProvider: 'easyscholar', easyscholarApiKey: 'unsaved-es-key', journal: 'Nature'
  });
  assert.equal(result.provider, 'easyscholar');
  assert.equal(result.data.officialRank.all.sci, 'Q1');
  assert.match(requestSeen.url, /secretKey=unsaved-es-key/);
  assert.match(requestSeen.url, /publicationName=Nature/);
  await assert.rejects(fs.readFile(path.join(dir, 'integrations.json'), 'utf8'), { code: 'ENOENT' });
});

test('local Zotero import reads metadata, collections, tags, and PDF paths', async function (t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-zotero-'));
  t.after(function () { return fs.rm(home, { recursive: true, force: true }); });
  const dataDir = path.join(home, 'Zotero');
  await fs.mkdir(path.join(dataDir, 'storage', 'ATTACH1'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'storage', 'ATTACH1', 'paper.pdf'), 'pdf');
  const db = new DatabaseSync(path.join(dataDir, 'zotero.sqlite'));
  db.exec(`
    CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INTEGER, key TEXT);
    CREATE TABLE deletedItems (itemID INTEGER);
    CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
    CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
    CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
    CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, orderIndex INTEGER);
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE itemTags (itemID INTEGER, tagID INTEGER);
    CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, key TEXT, collectionName TEXT, parentCollectionID INTEGER);
    CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);
    CREATE TABLE itemAttachments (itemID INTEGER, parentItemID INTEGER, path TEXT, contentType TEXT);
    INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'attachment');
    INSERT INTO items VALUES (1, 1, 'ITEMKEY1'), (2, 2, 'ATTACH1');
    INSERT INTO fields VALUES (1, 'title'), (2, 'DOI'), (3, 'date');
    INSERT INTO itemDataValues VALUES (1, 'Imported Paper'), (2, '10.1234/imported'), (3, '2025');
    INSERT INTO itemData VALUES (1, 1, 1), (1, 2, 2), (1, 3, 3);
    INSERT INTO creators VALUES (1, 'Jane', 'Doe');
    INSERT INTO itemCreators VALUES (1, 1, 0);
    INSERT INTO tags VALUES (1, 'review');
    INSERT INTO itemTags VALUES (1, 1);
    INSERT INTO collections VALUES (1, 'COLKEY1', 'Methods', NULL), (2, 'COLKEY2', 'Experiments', 1);
    INSERT INTO collectionItems VALUES (2, 1);
    INSERT INTO itemAttachments VALUES (2, 1, 'storage:paper.pdf', 'application/pdf');
  `);
  db.close();
  const integrations = createIntegrations({
    baseDir: path.join(home, 'config'), homeDir: home,
    safeStorage: { isEncryptionAvailable: function () { return true; } },
    fetch: async function () { throw new Error('network should not be used'); }
  });
  const result = await integrations.importZoteroLocal();
  assert.equal(result.papers.length, 1);
  assert.equal(result.papers[0].title, 'Imported Paper');
  assert.deepEqual(result.papers[0].authors, ['Doe, Jane']);
  assert.deepEqual(result.papers[0].tags, ['review']);
  assert.equal(result.folders[0].name, 'Methods');
  assert.equal(result.folders[1].parentId, result.folders[0].id);
  assert.deepEqual(result.papers[0].folderIds, [result.folders[1].id]);
  assert.equal(result.papers[0].pdfPath, path.join(dataDir, 'storage', 'ATTACH1', 'paper.pdf'));
});

function storedZip(name, data) {
  const filename = Buffer.from(name, 'utf8');
  const body = Buffer.from(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(0, 42);
  const directoryOffset = local.length + filename.length + body.length;
  const directorySize = central.length + filename.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, filename, body, central, filename, end]);
}

test('Zotero WebDAV ZIP extraction returns the contained PDF safely', function () {
  const result = extractFirstPdfFromZip(storedZip('nested/paper.pdf', '%PDF-test'));
  assert.equal(result.name, 'paper.pdf');
  assert.equal(result.data.toString(), '%PDF-test');
});

test('Zotero cloud migration downloads a keyed archive into LitBoard storage', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-zotero-cloud-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const archive = storedZip('paper.pdf', '%PDF-cloud');
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir,
    safeStorage: {
      isEncryptionAvailable: function () { return true; },
      encryptString: function (value) { return Buffer.from(value, 'utf8'); },
      decryptString: function (value) { return value.toString('utf8'); }
    },
    fetch: async function (url, init) {
      assert.equal(init.method, 'GET');
      assert.match(url, /\/zotero\/ATTACH1\.zip$/);
      return new Response(archive, { status: 200 });
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'user@example.com', nutstorePassword: 'secret', zoteroWebDavFolder: 'zotero' });
  const result = await integrations.migrateZoteroCloudAttachments({
    papers: [{ id: 'p1', title: 'Cloud Paper', zoteroAttachmentKey: 'ATTACH1', pdfFileName: 'paper.pdf' }], folders: []
  });
  assert.equal(result.downloaded, 1);
  assert.equal(await fs.readFile(result.workspace.papers[0].pdfPath, 'utf8'), '%PDF-cloud');
});

/* ---------- 同步协议 v6：来源字段/附件索引 + v3-v5 读取兼容 ---------- */

test('v6 envelope round-trips the notes collection', function () {
  const env = LitSync.createSyncEnvelope({
    papers: [{ id: 'p1', title: 'T' }],
    notes: [{ id: 'n1', paperId: 'p1', content: 'note body', createdAt: 10, updatedAt: 20 }],
    folders: []
  });
  assert.equal(env.syncVersion, 6);
  assert.equal(env.notes.length, 1);
  const read = LitSync.readSyncEnvelope(JSON.parse(JSON.stringify(env)));
  assert.equal(read.syncVersion, 6);
  assert.equal(read.legacy, false);
  assert.equal(read.workspace.notes.length, 1);
  assert.equal(read.workspace.notes[0].content, 'note body');
  assert.equal(read.workspace.notes[0].paperId, 'p1');
});

test('v6 reader accepts v3/v4/v5 envelopes and rejects newer versions', function () {
  [undefined, 3, 4, 5, 6].forEach(function (version) {
    const input = { papers: [{ id: 'p1', title: 'T' }], folders: [] };
    if (version !== undefined) input.syncVersion = version;
    const read = LitSync.readSyncEnvelope(input);
    assert.ok(Array.isArray(read.workspace.notes));
    assert.equal(read.workspace.notes.length, 0); // 旧格式没有 notes 集合
  });
  assert.ok(LitSync.SUPPORTED_SYNC_VERSIONS.indexOf(3) !== -1);
  assert.ok(LitSync.SUPPORTED_SYNC_VERSIONS.indexOf(4) !== -1);
  assert.ok(LitSync.SUPPORTED_SYNC_VERSIONS.indexOf(5) !== -1);
  // 更新的格式一律拒读：旧端不会把新格式改坏后写回
  assert.equal(LitSync.isSupportedSyncVersion(6), true);
  assert.throws(function () { LitSync.readSyncEnvelope({ syncVersion: 99 }); }, /不支持的/);
  assert.equal(LitSync.isSupportedSyncVersion(7), false);
});

test('v6 sync plan merges notes three-way and propagates tombstones', function () {
  const base = {
    papers: [], folders: [],
    notes: [
      { id: 'n1', paperId: 'p1', content: 'old', createdAt: 1, updatedAt: 100 },
      { id: 'n2', paperId: 'p1', content: 'to be deleted', createdAt: 1, updatedAt: 100 }
    ]
  };
  const local = {
    papers: [], folders: [],
    notes: [
      { id: 'n1', paperId: 'p1', content: 'local edit', createdAt: 1, updatedAt: 200 },
      { id: 'n2', paperId: 'p1', content: 'to be deleted', createdAt: 1, updatedAt: 100 }
    ]
  };
  const remote = {
    papers: [], folders: [],
    notes: [
      { id: 'n1', paperId: 'p1', content: 'old', createdAt: 1, updatedAt: 100 },
      { id: 'n2', paperId: 'p1', content: 'to be deleted', createdAt: 1, updatedAt: 100, deletedAt: 300 },
      { id: 'n3', paperId: '', title: '主题', content: 'remote only', createdAt: 5, updatedAt: 300 }
    ]
  };
  const plan = LitSync.createSyncPlan({ base: base, local: local, remote: remote, now: 1000 });
  assert.equal(plan.syncVersion, 6);
  assert.equal(plan.conflicts.length, 0); // 无歧义：n1 本地改、n2 远端删、n3 远端新增
  const result = LitSync.applySyncPlan(plan, {}, { now: 1000 });
  assert.equal(result.ok, true);
  const notes = result.workspace.notes;
  const n1 = notes.find(function (n) { return n.id === 'n1'; });
  const n2 = notes.find(function (n) { return n.id === 'n2'; });
  const n3 = notes.find(function (n) { return n.id === 'n3'; });
  assert.equal(n1.content, 'local edit');
  assert.equal(n2.deletedAt, 300); // 墓碑保留并传播
  assert.equal(n3.content, 'remote only');
  // 同一笔记双端改内容 → 字段冲突需人工选择
  const conflictPlan = LitSync.createSyncPlan({
    base: base, remote: remote,
    local: { papers: [], folders: [], notes: [
      { id: 'n1', paperId: 'p1', content: 'local edit', createdAt: 1, updatedAt: 200 },
      { id: 'n2', paperId: 'p1', content: 'to be deleted', createdAt: 1, updatedAt: 100 }
    ] },
    now: 1000
  });
  const remoteEdited = LitSync.createSyncPlan({
    base: base, local: local,
    remote: { papers: [], folders: [], notes: [
      { id: 'n1', paperId: 'p1', content: 'remote edit', createdAt: 1, updatedAt: 150 },
      { id: 'n2', paperId: 'p1', content: 'to be deleted', createdAt: 1, updatedAt: 100 }
    ] },
    now: 1000
  });
  assert.equal(conflictPlan.conflicts.length, 0);
  assert.equal(remoteEdited.conflicts.length, 1);
  assert.equal(remoteEdited.conflicts[0].collection, 'notes');
  assert.equal(remoteEdited.conflicts[0].field, 'content');
  const resolved = LitSync.applySyncPlan(remoteEdited, {}, { now: 1000, useDefaults: true });
  assert.equal(resolved.ok, true);
});

/* ---------- 本机保留登记：选「采用本机版本」不上传覆盖远端 ---------- */

function makeSafeStorage() {
  return {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
}

test('invertLocalChoices rewrites explicit local picks and keeps remote picks', function () {
  const flipped = LitSync.invertLocalChoices({
    'papers:p1:title': 'local',
    'papers:p2:abstract': 'remote',
    'papers:p3:extra': 'keep-local'
  });
  assert.equal(flipped['papers:p1:title'], 'remote');
  assert.equal(flipped['papers:p2:abstract'], 'remote');
  assert.equal(flipped['papers:p3:extra'], 'remote');
  const arrayForm = LitSync.invertLocalChoices([{ conflictId: 'c1', choice: 'local' }, { conflictId: 'c2', value: 'remote' }]);
  assert.equal(arrayForm[0].choice, 'remote');
  assert.equal(arrayForm[1].choice, 'remote');
});

test('remote-absent entities are never pinned and legacy null-remote pins are released', function () {
  const local = { papers: [{ id: 'p1', title: '本地标题', updatedAt: 200 }], folders: [] };
  const remote = { papers: [], folders: [] };
  assert.deepEqual(LitSync.extractWorkspacePins(local, remote, 300), {});

  const plan = LitSync.createSyncPlan({
    base: { papers: [{ id: 'p1', title: '旧标题', updatedAt: 100 }], folders: [] },
    local: local,
    remote: remote,
    now: 300
  });
  const legacyPins = {
    'papers:p1': { savedAt: 200, local: local.papers[0], remote: null }
  };
  assert.deepEqual(LitSync.evaluateSyncPins(legacyPins, plan), {});
});

test('choosing local keeps the remote copy untouched and keeps both sides split', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-pin-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [{ id: 'p1', title: '远端标题' }], folders: [] });
  let etag = '"v1"';
  let libraryPuts = 0;
  const progressEvents = [];
  const safeStorage = makeSafeStorage();
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      if (init.headers['If-Match'] && init.headers['If-Match'] !== etag) return new Response('', { status: 412 });
      libraryPuts++;
      remoteBody = init.body;
      etag = '"put-' + libraryPuts + '"';
      return new Response('', { status: 201, headers: { ETag: etag } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: safeStorage, fetch: fetch,
    notify: function (channel, payload) { if (channel === 'integrations:sync-progress') progressEvents.push(payload); }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const local = { papers: [{ id: 'p1', title: '本地标题' }], folders: [] };

  const plan = await integrations.createNutstoreSyncPlan({ workspace: local, mode: 'merge' });
  assert.equal(plan.conflicts.length, 1);
  const conflictId = plan.conflicts[0].conflictId;

  const applied = await integrations.applyNutstoreSyncPlan({ planId: plan.planId, resolutions: { [conflictId]: 'local' } });
  // 本机保留本地标题；云端保持远端标题（不因「选本机」而被覆盖）
  assert.equal(applied.workspace.papers[0].title, '本地标题');
  assert.equal(applied.pinned, 1);
  assert.equal(libraryPuts, 0);
  assert.equal(JSON.parse(remoteBody).papers[0].title, '远端标题');
  const base = JSON.parse(await fs.readFile(path.join(dir, 'sync-base.json'), 'utf8'));
  assert.equal(base.pins['papers:p1'].local.title, '本地标题');
  assert.equal(base.pins['papers:p1'].remote.title, '远端标题');
  // 应用过程有可见的同步进度（校验 → 附件 → 配置 → 完成）
  const phases = progressEvents.map(function (event) { return event.phase; });
  assert.ok(phases.includes('verify') && phases.includes('assets') && phases.includes('config') && phases.includes('done'));

  // 本机没再改动 → 后续自动同步维持分叉：本机本地标题、云端远端标题、不再弹对照
  const second = await integrations.nutstoreSync(applied.workspace);
  assert.equal(second.pendingPlan, undefined);
  assert.equal(second.uploaded, false);
  assert.equal(second.workspace.papers[0].title, '本地标题');
  assert.equal(libraryPuts, 0);
  assert.equal(JSON.parse(remoteBody).papers[0].title, '远端标题');

  // 远端被另一台设备改动 → 登记解除，重新弹对照而不是互相覆盖
  remoteBody = JSON.stringify({ syncVersion: 6, papers: [{ id: 'p1', title: '远端又改了' }], folders: [] });
  etag = '"v2"';
  const third = await integrations.nutstoreSync(second.workspace);
  assert.ok(third.pendingPlan, '远端变化后应重新生成对照计划');
  assert.ok(third.pendingPlan.conflicts.length >= 1);
});

test('choosing local after the remote library was cleared repopulates the remote library', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-remote-cleared-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [{ id: 'p1', title: '初始标题', updatedAt: 100 }], folders: [] });
  let etag = '"v1"';
  let libraryPuts = 0;
  const safeStorage = makeSafeStorage();
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      if (init.headers['If-Match'] && init.headers['If-Match'] !== etag) return new Response('', { status: 412 });
      libraryPuts++;
      remoteBody = init.body;
      etag = '"put-' + libraryPuts + '"';
      return new Response('', { status: 201, headers: { ETag: etag } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: safeStorage, fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });

  const initial = { papers: [{ id: 'p1', title: '初始标题', updatedAt: 100 }], folders: [] };
  const first = await integrations.nutstoreSync(initial);
  assert.equal(first.uploaded, false);

  remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  etag = '"v2"';
  const local = { papers: [{ id: 'p1', title: '本地新标题', updatedAt: 200 }], folders: [] };
  const plan = await integrations.createNutstoreSyncPlan({ workspace: local, mode: 'merge' });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].deletedBy, 'remote');

  const applied = await integrations.applyNutstoreSyncPlan({
    planId: plan.planId,
    resolutions: { [plan.conflicts[0].conflictId]: 'local' }
  });
  assert.equal(applied.uploaded, true);
  assert.equal(applied.pinned, 0);
  assert.equal(libraryPuts, 1);
  assert.equal(JSON.parse(remoteBody).papers[0].title, '本地新标题');
});

test('keeping an unchanged local-only item after the remote library was cleared uploads it', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-remote-cleared-unchanged-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [{ id: 'p1', title: '本地标题', updatedAt: 100 }], folders: [] });
  let etag = '"v1"';
  let libraryPuts = 0;
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      libraryPuts++;
      remoteBody = init.body;
      etag = '"put-' + libraryPuts + '"';
      return new Response('', { status: 201, headers: { ETag: etag } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const local = { papers: [{ id: 'p1', title: '本地标题', updatedAt: 100 }], folders: [] };
  await integrations.nutstoreSync(local);

  remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  etag = '"v2"';
  const plan = await integrations.createNutstoreSyncPlan({ workspace: local, mode: 'merge' });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.localOnly.length, 1);
  assert.equal(plan.localOnly[0].status, 'deleted-remote');

  const applied = await integrations.applyNutstoreSyncPlan({
    planId: plan.planId,
    resolutions: { [plan.localOnly[0].conflictId]: 'local' }
  });
  assert.equal(applied.uploaded, true);
  assert.equal(libraryPuts, 1);
  assert.equal(JSON.parse(remoteBody).papers[0].title, '本地标题');
});

test('an unexpected empty remote library pauses automatic sync for local recovery review', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-empty-remote-review-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const local = { papers: [{ id: 'p1', title: '本地标题', updatedAt: 100 }], folders: [] };
  let remoteBody = JSON.stringify(LitSync.createSyncEnvelope(local));
  let etag = '"v1"';
  let libraryPuts = 0;
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      libraryPuts++;
      remoteBody = init.body;
      return new Response('', { status: 201 });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  await integrations.nutstoreSync(local);

  remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  etag = '"cleared"';
  const result = await integrations.nutstoreSync(local);
  assert.ok(result.pendingPlan, '远端突然清空时必须暂停自动写入并打开对照');
  assert.equal(result.pendingPlan.remoteResetSuspected, true);
  assert.equal(result.pendingPlan.localOnly.length, 1);
  assert.equal(libraryPuts, 0);
});

test('clearing the remote library reuploads locally verified assets and creates the attachment root', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-remote-assets-cleared-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const pdf = Buffer.from('%PDF-remote-cleared');
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, pdf);
  const digest = crypto.createHash('sha256').update(pdf).digest('hex');
  const local = {
    papers: [{
      id: 'p1', title: '带附件文献', updatedAt: 100,
      attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath,
        cloudName: 'p1.pdf', cloudHash: digest, cloudSize: pdf.length }]
    }],
    folders: []
  };
  let remoteBody = JSON.stringify(LitSync.createSyncEnvelope(local));
  let etag = '"v1"';
  let attachmentRootExists = false;
  let assetPuts = 0;
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'PROPFIND') return new Response('', { status: 405 });
    if (init.method === 'MKCOL' && url.endsWith('/attachments')) {
      attachmentRootExists = true;
      return new Response('', { status: 201 });
    }
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.includes('/attachments/')) {
      if (!attachmentRootExists) return new Response('', { status: 409 });
      assetPuts++;
      return new Response('', { status: 201 });
    }
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      remoteBody = init.body;
      etag = '"v2"';
      return new Response('', { status: 201, headers: { ETag: etag } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  await integrations.nutstoreSync(local);

  remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  etag = '"cleared"';
  attachmentRootExists = false;
  const plan = await integrations.createNutstoreSyncPlan({ workspace: local, mode: 'merge' });
  const applied = await integrations.applyNutstoreSyncPlan({
    planId: plan.planId,
    resolutions: { [plan.localOnly[0].conflictId]: 'local' }
  });
  assert.equal(applied.uploaded, true);
  assert.equal(assetPuts, 1);
  assert.equal(attachmentRootExists, true);
});

test('an empty remote library reuses attachment files discovered by one PROPFIND', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-reuse-orphan-assets-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const pdf = Buffer.from('%PDF-existing-remote');
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, pdf);
  const digest = crypto.createHash('sha256').update(pdf).digest('hex');
  const local = {
    papers: [{ id: 'p1', title: '本机元数据', attachments: [{
      id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath,
      cloudName: 'p1.pdf', cloudHash: digest, cloudSize: pdf.length
    }] }],
    folders: []
  };
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  let assetPuts = 0;
  let propfinds = 0;
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: '"v1"' } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'PROPFIND' && url.endsWith('/attachments')) {
      propfinds++;
      return new Response('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
        '<d:response><d:href>/dav/LitBoard/attachments/</d:href></d:response>' +
        '<d:response><d:href>/dav/LitBoard/attachments/p1.pdf</d:href></d:response>' +
        '</d:multistatus>', { status: 207 });
    }
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.includes('/attachments/')) {
      assetPuts++;
      return new Response('', { status: 201 });
    }
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      remoteBody = init.body;
      return new Response('', { status: 201, headers: { ETag: '"v2"' } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p', nutstoreFolder: 'LitBoard' });
  const result = await integrations.nutstoreSync(local);
  assert.equal(result.uploaded, true);
  assert.equal(propfinds, 1);
  assert.equal(assetPuts, 0);
  assert.equal(JSON.parse(remoteBody).papers[0].title, '本机元数据');
});

test('an asset upload failure is recorded without blocking the library JSON write', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-asset-upload-failure-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, '%PDF-upload-failure');
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  let assetGets = 0;
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: '"v1"' } });
    }
    if (init.method === 'GET' && url.includes('/attachments/')) {
      assetGets++;
      return new Response('', { status: 404 });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 201 });
    if (init.method === 'PUT' && url.includes('/attachments/')) return new Response('', { status: 500 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      remoteBody = String(init.body);
      return new Response('', { status: 201, headers: { ETag: '"v2"' } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const result = await integrations.nutstoreSync({
    papers: [{ id: 'p1', title: '上传失败', attachments: [{ id: 'a1', kind: 'pdf', path: pdfPath, fileName: 'paper.pdf' }] }],
    folders: []
  });
  // 附件失败不再拖死整轮同步：文献库 JSON 照常写入，失败明细进 assets.failures 供 UI 提示
  assert.equal(result.uploaded, true);
  assert.equal(JSON.parse(remoteBody).papers.length, 1);
  assert.equal(result.assets.failures.length, 1);
  assert.match(result.assets.failures[0].message, /附件上传失败：HTTP 500/);
  assert.equal(assetGets, 0, '上传失败不应被误报成下载重试');
});

test('WebDAV rate limiting stops the asset loop immediately', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-rate-limit-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const firstPath = path.join(dir, 'first.pdf');
  const secondPath = path.join(dir, 'second.pdf');
  await fs.writeFile(firstPath, '%PDF-first');
  await fs.writeFile(secondPath, '%PDF-second');
  let assetPuts = 0;
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(JSON.stringify({ syncVersion: 6, papers: [], folders: [] }), { status: 200, headers: { ETag: '"v1"' } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 201 });
    if (init.method === 'PUT' && url.includes('/attachments/')) {
      assetPuts++;
      return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  await assert.rejects(integrations.nutstoreSync({
    papers: [{ id: 'p1', title: '限流测试', attachments: [
      { id: 'a1', kind: 'pdf', path: firstPath, fileName: 'first.pdf' },
      { id: 'a2', kind: 'supp', path: secondPath, fileName: 'second.pdf' }
    ] }],
    folders: []
  }), /访问频率限制/);
  assert.equal(assetPuts, 1);
});

test('non-snapshot annotations do not advance attachment progress', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-progress-annotations-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const rawWorkspace = {
    papers: [{
      id: 'p1', title: '批注文献', updatedAt: 100,
      pdfAnnotations: [
        { id: 'h1', type: 'highlight', createdAt: 100, updatedAt: 100, position: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
        { id: 'h2', type: 'highlight', createdAt: 100, updatedAt: 100, position: { pageIndex: 1, rects: [[1, 2, 3, 4]] } }
      ]
    }],
    folders: []
  };
  const remoteEnvelope = LitSync.createSyncEnvelope(rawWorkspace);
  const workspace = LitSync.readSyncEnvelope(remoteEnvelope).workspace;
  const progress = [];
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(JSON.stringify(remoteEnvelope), { status: 200, headers: { ETag: '"v1"' } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch,
    notify: function (channel, payload) {
      if (channel === 'integrations:sync-progress' && payload.phase === 'assets') progress.push(payload);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  await integrations.nutstoreSync(workspace);
  assert.ok(progress.length >= 1);
  assert.ok(progress.every(function (event) { return event.done <= event.total; }));
  assert.deepEqual(progress.map(function (event) { return [event.done, event.total]; }), [[0, 0]]);
});

test('editing a pinned entity locally releases the pin and resumes propagation', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-pin-edit-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [{ id: 'p1', title: '远端标题' }], folders: [] });
  let etag = '"v1"';
  let libraryPuts = 0;
  const safeStorage = makeSafeStorage();
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      if (init.headers['If-Match'] && init.headers['If-Match'] !== etag) return new Response('', { status: 412 });
      libraryPuts++;
      remoteBody = init.body;
      etag = '"put-' + libraryPuts + '"';
      return new Response('', { status: 201, headers: { ETag: etag } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: safeStorage, fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const plan = await integrations.createNutstoreSyncPlan({
    workspace: { papers: [{ id: 'p1', title: '本地标题' }], folders: [] }, mode: 'merge'
  });
  const applied = await integrations.applyNutstoreSyncPlan({
    planId: plan.planId, resolutions: { [plan.conflicts[0].conflictId]: 'local' }
  });
  assert.equal(applied.pinned, 1);

  // 用户再次编辑本条目 → 登记解除，恢复正常同步（本地修改上云）
  const edited = JSON.parse(JSON.stringify(applied.workspace));
  edited.papers[0].title = '本地新标题';
  edited.papers[0].updatedAt = Date.now() + 60000;
  const next = await integrations.nutstoreSync(edited);
  assert.equal(next.pendingPlan, undefined);
  assert.equal(next.uploaded, true);
  assert.equal(next.pinned, 0);
  assert.equal(libraryPuts, 1);
  assert.equal(JSON.parse(remoteBody).papers[0].title, '本地新标题');
});

/* ---------- Zotero 导入向导：扫描 → 导入（含资产复制）→ 重复导入幂等 ---------- */

async function makeZoteroWizardFixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-zotero-wiz-'));
  t.after(function () { return fs.rm(home, { recursive: true, force: true }); });
  const dataDir = path.join(home, 'Zotero');
  await fs.mkdir(path.join(dataDir, 'storage', 'ATTACH1'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'storage', 'ATTACH1', 'paper.pdf'), '%PDF-main');
  await fs.mkdir(path.join(dataDir, 'storage', 'ATTACH2'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'storage', 'ATTACH2', 'snap.html'), '<html>snapshot</html>');
  await fs.writeFile(path.join(dataDir, 'storage', 'ATTACH2', 'style.css'), 'body{}');
  await fs.mkdir(path.join(dataDir, 'storage', 'ATTACH3'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'storage', 'ATTACH3', 'lone.pdf'), '%PDF-lone');
  // ATTACH5 的文件故意不创建（云端未下载）
  const db = new DatabaseSync(path.join(dataDir, 'zotero.sqlite'));
  db.exec(`
    CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INTEGER, key TEXT);
    CREATE TABLE deletedItems (itemID INTEGER);
    CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
    CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value TEXT);
    CREATE TABLE itemData (itemID INTEGER, fieldID INTEGER, valueID INTEGER);
    CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INTEGER DEFAULT 0);
    CREATE TABLE creatorTypes (creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
    CREATE TABLE itemCreators (itemID INTEGER, creatorID INTEGER, creatorTypeID INTEGER, orderIndex INTEGER);
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE itemTags (itemID INTEGER, tagID INTEGER);
    CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, key TEXT, collectionName TEXT, parentCollectionID INTEGER);
    CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);
    CREATE TABLE itemAttachments (itemID INTEGER, parentItemID INTEGER, linkMode INTEGER, contentType TEXT, path TEXT);
    CREATE TABLE itemNotes (itemID INTEGER, parentItemID INTEGER, note TEXT, title TEXT);
    CREATE TABLE itemAnnotations (itemID INTEGER, parentItemID INTEGER, type TEXT, text TEXT, comment TEXT,
      color TEXT, pageLabel TEXT, position TEXT, sortOrder INTEGER);
    CREATE TABLE relations (subject TEXT, predicate TEXT, object TEXT);
    CREATE TABLE settings (key TEXT, value TEXT);
    INSERT INTO itemTypes VALUES (1,'journalArticle'),(2,'attachment'),(3,'note'),(4,'book'),(5,'dataset');
    INSERT INTO items VALUES
      (1,1,'ITEMKEY1'),(2,2,'ATTACH1'),(3,2,'ATTACH2'),(4,3,'NOTEKEY1'),(5,3,'NOTEKEY2'),
      (6,2,'ANNKEY1'),(7,4,'BOOKKEY1'),(8,5,'DSKEY1'),(9,2,'ATTACH3'),(10,2,'ATTACH4'),
      (11,2,'ATTACH5'),(12,1,'DELETED1');
    INSERT INTO deletedItems VALUES (12);
    INSERT INTO fields VALUES (1,'title'),(2,'DOI'),(3,'date'),(4,'publicationTitle'),(5,'place'),
      (6,'series'),(7,'journalAbbreviation'),(8,'accessDate'),(9,'extra'),(10,'numPages');
    INSERT INTO itemDataValues VALUES
      (1,'Imported Paper'),(2,'10.1234/imported'),(3,'2025-03-02'),(4,'Nature'),(5,'London'),
      (6,'Nature Series'),(7,'Nature'),(8,'2025-06-01'),(9,'LitBoard Status: read\nPMID: 123'),
      (10,'31'),(11,'A Book'),(12,'2020'),(13,'Some Dataset'),(14,'2024'),(15,'Gone'),(16,'2019');
    INSERT INTO itemData VALUES
      (1,1,1),(1,2,2),(1,3,3),(1,4,4),(1,5,5),(1,6,6),(1,7,7),(1,8,8),(1,9,9),(1,10,10),
      (7,1,11),(7,3,12),(8,1,13),(8,3,14),(12,1,15),(12,3,16);
    INSERT INTO creatorTypes VALUES (1,'author'),(2,'editor');
    INSERT INTO creators VALUES (1,'Jane','Doe',0),(2,'','World Health Organization',1),(3,'Erin','Editor',2);
    INSERT INTO itemCreators VALUES (1,1,1,0),(1,2,1,1),(7,3,2,0);
    INSERT INTO tags VALUES (1,'review'),(2,'ml');
    INSERT INTO itemTags VALUES (1,1),(1,2);
    INSERT INTO collections VALUES (1,'COLKEY1','Methods',NULL),(2,'COLKEY2','Experiments',1);
    INSERT INTO collectionItems VALUES (2,1);
    INSERT INTO itemAttachments VALUES
      (2,1,0,'application/pdf','storage:paper.pdf'),
      (3,1,1,'text/html','storage:snap.html'),
      (9,NULL,0,'application/pdf','storage:lone.pdf'),
      (10,1,3, NULL, NULL),
      (11,1,0,'application/pdf','storage:missing.pdf');
    INSERT INTO itemNotes VALUES
      (4,1,'<h2>要点</h2><p>方法<strong>新颖</strong>，见 <span data-citation="{}">(Doe, 2025)</span></p><table><tr><td>1</td></tr></table><img src="data:image/png;base64,iVBORw0KGgo=">',''),
      (5,NULL,'<p>跨文献主题笔记</p>','主题');
    INSERT INTO itemAnnotations VALUES
      (6,2,'highlight','quoted text','my comment','#ffd400','5','{"pageIndex":4,"rects":[[10,20,100,40]]}',0);
    INSERT INTO relations VALUES
      ('http://zotero.org/users/local/ab12/items/ITEMKEY1','dc:relation','http://zotero.org/users/local/ab12/items/BOOKKEY1');
    INSERT INTO settings VALUES ('tagColors','[{"name":"review","color":"#ff0000"}]');
  `);
  db.close();
  return { home: home, dataDir: dataDir };
}

function wizardIntegrations(t, home) {
  const baseDir = path.join(home, 'config');
  const integrations = createIntegrations({
    baseDir: baseDir, homeDir: home,
    safeStorage: { isEncryptionAvailable: function () { return true; } },
    fetch: async function () { throw new Error('network should not be used'); }
  });
  return { integrations: integrations, baseDir: baseDir };
}

test('Zotero wizard scans, imports with asset copy, and skips copies on re-import', async function (t) {
  const { home, dataDir } = await makeZoteroWizardFixture(t);
  const { integrations, baseDir } = wizardIntegrations(t, home);

  const scan = await integrations.scanZoteroLibrary({ dir: dataDir });
  assert.equal(scan.stats.source.items, 3); // ITEMKEY1/BOOKKEY1/DSKEY1（DELETED1 已删不计；独立附件不占 items）
  assert.equal(scan.stats.source.notes, 2);
  assert.equal(scan.stats.source.annotations, 1);
  assert.equal(scan.stats.missing, 1); // ATTACH5 未下载

  const result = await integrations.importZoteroLibrary({ dir: dataDir, copyFiles: true });
  const ws = result.workspace;
  const report = result.report;
  const papers = ws.papers;
  assert.equal(papers.length, 4); // 3 条目 + 独立附件占位
  const p1 = papers.find(function (p) { return p.zoteroKey === 'ITEMKEY1'; });
  assert.equal(p1.title, 'Imported Paper');
  assert.equal(p1.entryType, 'article');
  assert.equal(p1.date, '2025-03-02');
  assert.equal(p1.year, 2025);
  assert.equal(p1.place, 'London');
  assert.equal(p1.series, 'Nature Series');
  assert.equal(p1.journalAbbreviation, 'Nature');
  assert.equal(p1.accessDate, '2025-06-01');
  assert.equal(p1.status, 'read'); // extra 的 LitBoard 标记
  assert.equal(p1.bibtexExtra.numpages, '31'); // 未映射字段兜底
  assert.deepEqual(p1.creators.map(function (c) { return c.creatorType + ':' + (c.name || c.family); }),
    ['author:Doe', 'author:World Health Organization']);
  assert.equal(p1.tags.length, 2);
  assert.equal(p1.folderIds.length, 1);
  // 附件：PDF + 快照目录复制进受管目录；未下载的 ATTACH5 保留空路径记录
  assert.equal(p1.attachments.length, 3);
  const pdfAtt = p1.attachments.find(function (a) { return a.kind === 'pdf' && a.path; });
  assert.ok(pdfAtt.path.startsWith(baseDir));
  assert.equal(await fs.readFile(pdfAtt.path, 'utf8'), '%PDF-main');
  const missingAtt = p1.attachments.find(function (a) { return a.zoteroKey === 'ATTACH5'; });
  assert.equal(missingAtt.path, '');
  const snapAtt = p1.attachments.find(function (a) { return a.kind === 'snapshot'; });
  assert.ok(snapAtt.path.startsWith(path.join(baseDir, 'synced-attachments')));
  assert.equal(await fs.readFile(path.join(snapAtt.path, 'snap.html'), 'utf8'), '<html>snapshot</html>');
  assert.equal(await fs.readFile(path.join(snapAtt.path, 'style.css'), 'utf8'), 'body{}');
  // 批注：类型/定位/评论/颜色/attachmentId
  assert.equal(p1.pdfAnnotations.length, 1);
  const ann = p1.pdfAnnotations[0];
  assert.equal(ann.type, 'highlight');
  assert.equal(ann.attachmentId, pdfAtt.id);
  assert.equal(ann.position.pageIndex, 4);
  assert.equal(ann.text, 'quoted text');
  assert.equal(ann.comment, 'my comment');
  // 关联双向
  const book = papers.find(function (p) { return p.zoteroKey === 'BOOKKEY1'; });
  assert.equal(book.entryType, 'book');
  assert.deepEqual(book.creators.map(function (c) { return c.creatorType; }), ['editor']);
  assert.ok(p1.relatedIds.indexOf(book.id) !== -1);
  assert.ok(book.relatedIds.indexOf(p1.id) !== -1);
  // 未识别类型 → misc + sourceType
  const ds = papers.find(function (p) { return p.zoteroKey === 'DSKEY1'; });
  assert.equal(ds.entryType, 'misc');
  assert.equal(ds.sourceType, 'dataset');
  // 独立附件占位
  const lone = papers.find(function (p) { return p.zoteroKey === 'ATTACH3'; });
  assert.equal(lone.sourceType, 'attachment');
  assert.equal(lone.attachments.length, 1);
  assert.ok(report.unconverted.some(function (u) { return u.kind === 'standalone-attachment'; }));
  // 缺失附件入报告
  assert.ok(report.missing.some(function (m) { return m.zoteroKey === 'ATTACH5' && m.reason === 'not-found'; }));
  // 笔记：附属 + 独立；清洗后的 richtext；图片资产落 note-assets；citation 入 unconverted
  assert.equal(ws.notes.length, 2);
  const childNote = ws.notes.find(function (n) { return n.zoteroKey === 'NOTEKEY1'; });
  assert.equal(childNote.paperId, p1.id);
  assert.equal(childNote.format, 'richtext');
  assert.match(childNote.content, /<h2>要点<\/h2>/);
  assert.match(childNote.content, /<strong>新颖<\/strong>/);
  assert.match(childNote.content, /\(Doe, 2025\)/);
  assert.match(childNote.content, /<table>/); // 不可转换结构保留原始 HTML
  assert.match(childNote.sourceHtml, /<h2>要点<\/h2>/);
  assert.equal(childNote.assets.length, 1);
  assert.ok(childNote.assets[0].path.startsWith(path.join(baseDir, 'note-assets')));
  const standalone = ws.notes.find(function (n) { return n.zoteroKey === 'NOTEKEY2'; });
  assert.equal(standalone.paperId, '');
  assert.match(standalone.content, /跨文献主题笔记/);
  assert.ok(report.unconverted.some(function (u) { return u.kind === 'note-citation'; }));
  // 标签颜色
  assert.equal(ws.tagColorRecords.some(function (r) { return r.tag === 'review' && r.color === '#ff0000'; }), true);
  assert.ok(report.imported.assetsCopied >= 4); // pdf + snapshot-dir + note-image（+ 快照内逐文件不另计）

  // 重复导入：已有 key 的资产不再复制
  const again = await integrations.importZoteroLibrary({
    dir: dataDir, copyFiles: true,
    existing: {
      attachmentKeys: ['ATTACH1', 'ATTACH2', 'ATTACH3'],
      noteKeys: ['NOTEKEY1', 'NOTEKEY2'],
      paperKeys: ['ITEMKEY1', 'BOOKKEY1', 'DSKEY1']
    }
  });
  assert.equal(again.report.imported.assetsCopied, 0);
  assert.ok(again.report.imported.assetsSkipped >= 3);
  assert.equal(again.workspace.papers.length, 4);
});

/* ---------- v5 资产同步：快照目录 ZIP + 笔记资产 ---------- */

test('snapshot dirs and note assets sync over WebDAV end to end', async function (t) {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-asset-a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-asset-b-'));
  t.after(function () {
    return Promise.all([fs.rm(dirA, { recursive: true, force: true }), fs.rm(dirB, { recursive: true, force: true })]);
  });
  // A 机本地资产：快照目录（2 文件）+ 笔记图片
  const snapDir = path.join(dirA, 'synced-attachments', 'zSNAP0001');
  await fs.mkdir(snapDir, { recursive: true });
  await fs.writeFile(path.join(snapDir, 'snap.html'), '<html>A</html>');
  await fs.mkdir(path.join(snapDir, 'res'), { recursive: true });
  await fs.writeFile(path.join(snapDir, 'res', 'a.png'), 'PNG-A');
  const noteImg = path.join(dirA, 'note-assets', 'n1', 'img.png');
  await fs.mkdir(path.dirname(noteImg), { recursive: true });
  await fs.writeFile(noteImg, 'IMG-A');

  const cloud = new Map();
  const safeStorage = {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
  const fetchFactory = function () {
    return async function (url, init) {
      if (init.method === 'GET') {
        const body = cloud.get(url);
        return body ? new Response(body, { status: 200 }) : new Response('', { status: 404 });
      }
      if (init.method === 'MKCOL') return new Response('', { status: 201 });
      if (init.method === 'PUT') { cloud.set(url, Buffer.from(init.body)); return new Response('', { status: 201 }); }
      if (init.method === 'PROPFIND') return new Response('', { status: 207 });
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    };
  };
  const A = createIntegrations({ baseDir: dirA, homeDir: dirA, safeStorage: safeStorage, fetch: fetchFactory() });
  const B = createIntegrations({ baseDir: dirB, homeDir: dirB, safeStorage: safeStorage, fetch: fetchFactory() });
  const workspaceA = {
    papers: [{
      id: 'p1', title: 'Snap Paper',
      attachments: [{ id: 'a1', kind: 'snapshot', fileName: 'snap', path: snapDir }]
    }],
    notes: [{ id: 'n1', paperId: 'p1', content: 'see ![](note-assets/n1/img.png)', assets: [{ fileName: 'img.png', path: noteImg }] }],
    folders: []
  };
  await A.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const up = await A.nutstoreSync(workspaceA);
  assert.ok(up.assets.uploaded >= 2); // 快照 zip + 笔记图片
  const syncedAttachment = up.workspace.papers[0].attachments[0];
  assert.equal(syncedAttachment.cloudName, 'p1/a1.zip');
  const syncedNoteAsset = up.workspace.notes[0].assets[0];
  assert.equal(syncedNoteAsset.cloudName, 'notes/n1/img.png');
  assert.ok(syncedAttachment.cloudHash);

  // B 机（空库）拉取：快照解压落目录、笔记资产落 note-assets
  await B.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const down = await B.nutstoreSync({ papers: [], notes: [], folders: [] });
  const bAtt = down.workspace.papers[0].attachments[0];
  assert.equal(bAtt.kind, 'snapshot');
  assert.ok(bAtt.path.startsWith(dirB));
  assert.equal(await fs.readFile(path.join(bAtt.path, 'snap.html'), 'utf8'), '<html>A</html>');
  assert.equal(await fs.readFile(path.join(bAtt.path, 'res', 'a.png'), 'utf8'), 'PNG-A');
  const bNoteAsset = down.workspace.notes[0].assets[0];
  assert.ok(bNoteAsset.path.startsWith(path.join(dirB, 'note-assets')));
  assert.equal(await fs.readFile(bNoteAsset.path, 'utf8'), 'IMG-A');
});

test('v5 envelope carries lastReadAt for the recent-reading view', function () {
  const env = LitSync.createSyncEnvelope({
    papers: [{ id: 'p1', title: 'T', lastReadAt: 1700000000000 }, { id: 'p2', title: 'U' }],
    notes: [], folders: []
  });
  const read = LitSync.readSyncEnvelope(JSON.parse(JSON.stringify(env)));
  const p1 = read.workspace.papers.find(function (p) { return p.id === 'p1'; });
  assert.equal(Number(p1.lastReadAt), 1700000000000);
});

/* ---------- 本机为空疑似重置：整库消失必须人工确认，不允许静默清空远端 ---------- */

test('adoptRemoteEntities fills missing remote entities without overwriting local ones', function () {
  const now = Date.now();
  const result = LitSync.adoptRemoteEntities(
    { papers: [{ id: 'p1', title: '本机保留', folderIds: [] }], notes: [], folders: [], savedSearches: [], tagColorRecords: [] },
    {
      syncVersion: 6,
      papers: [
        { id: 'p1', title: '远端版本不应覆盖本机已有', updatedAt: now },
        { id: 'p2', title: '远端拉回', updatedAt: now },
        { id: 'p3', title: '远端墓碑', deletedAt: now, updatedAt: now }
      ],
      folders: [{ id: 'f1', name: '远端文件夹', updatedAt: now }],
      notes: [{ id: 'n1', paperId: '', content: '主题笔记', createdAt: now, updatedAt: now }],
      savedSearches: [],
      tagColorRecords: [{ tag: 'ai', color: '#ff0000', updatedAt: now }]
    }
  );
  assert.deepEqual(result.papers.map(function (p) { return p.id; }).sort(), ['p1', 'p2', 'p3']);
  assert.equal(result.papers.find(function (p) { return p.id === 'p1'; }).title, '本机保留');
  assert.ok(result.papers.find(function (p) { return p.id === 'p3'; }).deletedAt, 'remote tombstones stay tombstoned');
  assert.ok(result.folders.some(function (f) { return f.id === 'f1'; }));
  assert.ok(result.notes.some(function (n) { return n.id === 'n1'; }));
  assert.ok(result.tagColorRecords.some(function (r) { return r.tag === 'ai'; }));
});

test('empty local workspace against a non-empty sync base pauses and requires an explicit choice', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-empty-local-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  let etag = '"v1"';
  const puts = [];
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(),
    fetch: async function (url, init) {
      if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
        return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
      }
      if (init.method === 'GET') return new Response('', { status: 404 });
      if (init.method === 'MKCOL') return new Response('', { status: 405 });
      if (init.method === 'PUT') {
        puts.push(JSON.parse(init.body));
        remoteBody = init.body;
        etag = '"v2"';
        return new Response('', { status: 201, headers: { ETag: '"v2"' } });
      }
      throw new Error('Unexpected request ' + init.method + ' ' + url);
    }
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const localPapers = [
    { id: 'p1', title: 'Remote One', updatedAt: 10 },
    { id: 'p2', title: 'Remote Two', updatedAt: 11 }
  ];
  const first = await integrations.nutstoreSync({ papers: localPapers, folders: [] });
  assert.ok(!first.pendingPlan);
  assert.equal(first.uploaded, true);
  puts.length = 0;

  // 模拟事故：本机工作区突然为空（读取失败/数据目录被切换），自动同步必须暂停
  const paused = await integrations.nutstoreSync({ papers: [], folders: [] });
  assert.ok(paused.pendingPlan, 'auto sync pauses on suspected empty-local reset');
  assert.equal(paused.uploaded, false);
  assert.ok(paused.pendingPlan.remoteResetSuspected);
  assert.ok(paused.pendingPlan.localEmptyReset);
  assert.equal(puts.length, 0, 'no remote write while paused');

  // 对照计划同样标记；未做选择前拒绝应用
  const plan = await integrations.createNutstoreSyncPlan({ mode: 'merge', workspace: { papers: [], folders: [] } });
  assert.ok(plan.localEmptyReset);
  await assert.rejects(
    integrations.applyNutstoreSyncPlan({ planId: plan.planId, resolutions: {} }),
    /本机工作区为空/
  );

  // 选择「采用远端版本」：把远端拉回本机，云端内容保持不变
  const adopted = await integrations.applyNutstoreSyncPlan({
    planId: plan.planId,
    resolutions: { 'plan:local-empty-reset': 'remote' }
  });
  assert.deepEqual(adopted.workspace.papers.map(function (p) { return p.id; }).sort(), ['p1', 'p2']);
  const base = JSON.parse(await fs.readFile(path.join(dir, 'sync-base.json'), 'utf8'));
  assert.equal(base.workspace.papers.length, 2);
  for (const body of puts) assert.equal(body.papers.length, 2, 'remote must never be emptied');

  // 选择「采用本机版本」= 显式确认清空远端，仍然可行
  puts.length = 0;
  const wipePlan = await integrations.createNutstoreSyncPlan({ mode: 'merge', workspace: { papers: [], folders: [] } });
  assert.ok(wipePlan.localEmptyReset);
  const wiped = await integrations.applyNutstoreSyncPlan({
    planId: wipePlan.planId,
    resolutions: { 'plan:local-empty-reset': 'local' }
  });
  assert.equal(wiped.workspace.papers.length, 0);
  assert.ok(puts.some(function (body) { return body.papers.length === 0; }));
});

test('both empty sides can recover metadata from a non-empty sync base', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sync-base-recovery-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  let remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  let etag = '"v1"';
  const fetch = async function (url, init) {
    if (init.method === 'GET' && url.endsWith('litboard-library.json')) {
      return new Response(remoteBody, { status: 200, headers: { ETag: etag } });
    }
    if (init.method === 'GET') return new Response('', { status: 404 });
    if (init.method === 'MKCOL') return new Response('', { status: 405 });
    if (init.method === 'PUT' && url.endsWith('litboard-library.json')) {
      remoteBody = init.body;
      etag = '"v2"';
      return new Response('', { status: 201, headers: { ETag: etag } });
    }
    if (init.method === 'PUT') return new Response('', { status: 201 });
    throw new Error('Unexpected request ' + init.method + ' ' + url);
  };
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const original = { papers: [{ id: 'p1', title: '基线可恢复', updatedAt: 10 }], folders: [] };
  await integrations.nutstoreSync(original);

  remoteBody = JSON.stringify({ syncVersion: 6, papers: [], folders: [] });
  etag = '"empty"';
  const paused = await integrations.nutstoreSync({ papers: [], folders: [] });
  assert.ok(paused.pendingPlan);
  assert.equal(paused.pendingPlan.baseRecoveryAvailable, true);
  assert.equal(paused.pendingPlan.baseRecoveryCount, 1);
  const recovered = await integrations.applyNutstoreSyncPlan({
    planId: paused.pendingPlan.planId,
    resolutions: { 'plan:local-empty-reset': 'remote' }
  });
  assert.equal(recovered.workspace.papers.length, 1);
  assert.equal(recovered.workspace.papers[0].title, '基线可恢复');
  assert.equal(JSON.parse(remoteBody).papers.length, 1);
});
