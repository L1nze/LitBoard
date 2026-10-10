"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Model = require('../js/model.js');
const Mirror = require('../js/cloudmirror.js');
const Sync = require('../js/sync.js');
const { createIntegrations } = require('../electron/integrations.js');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-mirror-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const base = 'https://dav.jianguoyun.com/dav/LitBoard/';
  const library = base + 'litboard-library.json', attachments = base + 'attachments/';
  const files = new Map(), calls = []; let seq = 1;
  const put = (url, body) => files.set(url, { body: Buffer.from(body), etag: '"' + seq++ + '"' });
  const pdf = Buffer.from('%PDF-local');
  const pdfPath = path.join(dir, 'p.pdf'); await fs.writeFile(pdfPath, pdf);
  const att = { id: 'a', kind: 'pdf', fileName: 'p.pdf', path: pdfPath, addedAt: 1, cloudName: 'keep.pdf',
    cloudHash: crypto.createHash('sha256').update(pdf).digest('hex'), cloudSize: pdf.length };
  const local = Model.normalizeWorkspace({ papers: [{ id: 'p', title: 'Local title', addedAt: 1, updatedAt: 1, attachments: [att] }] });
  const remote = Model.normalizeWorkspace({ papers: [{ id: 'p', title: 'Cloud title', addedAt: 1, updatedAt: 2, attachments: [att] },
    { id: 'extra', title: 'Cloud extra', updatedAt: Date.now() + 60000, attachments: [{ id: 'old', kind: 'pdf', cloudName: 'extra.pdf' }] }],
    notes: [{ id: 'remoteNote', paperId: 'extra' }], folders: [{ id: 'remoteFolder', name: 'remote' }] });
  put(library, JSON.stringify(Sync.createSyncEnvelope(remote)));
  put(attachments + 'keep.pdf', pdf); put(attachments + 'extra.pdf', '%PDF-extra'); put(attachments + 'orphan.pdf', '%PDF-orphan');
  const state = { local, files, calls, library, attachments, base, put, denyListing: false, failUpload: false, failBackup: false, afterMove: null, progress: [] };
  const api = createIntegrations({ baseDir: dir, homeDir: dir, readWorkspace: async () => state.local,
    notify: (channel, payload) => { if (channel === 'integrations:sync-progress') state.progress.push(payload); },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() },
    fetch: async (url, init) => {
      const method = init.method, headers = init.headers || {}; calls.push({ method, url, headers });
      const item = files.get(url);
      if (method === 'GET' || method === 'HEAD') return item
        ? new Response(method === 'HEAD' ? null : item.body, { status: 200, headers: { ETag: item.etag, 'Content-Length': item.body.length } })
        : new Response('', { status: 404 });
      if (method === 'PROPFIND') {
        if (state.denyListing) return new Response('', { status: 405 });
        const root = url.replace(/\/$/, '') + '/';
        const names = [root].concat([...files.keys()].filter(k => k.startsWith(root)));
        return new Response('<d:multistatus xmlns:d="DAV:">' + names.map(k => '<d:response><d:href>' + new URL(k).pathname +
          '</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>').join('') + '</d:multistatus>', { status: 207 });
      }
      if (method === 'MKCOL') return new Response('', { status: 201 });
      if (headers['If-Match'] && (!item || headers['If-Match'] !== item.etag)) return new Response('', { status: 412 });
      if (headers['If-None-Match'] === '*' && item) return new Response('', { status: 412 });
      if (method === 'PUT') {
        if (state.failUpload && url.startsWith(attachments)) return new Response('', { status: 500 });
        if (state.failBackup && url.endsWith('manifest.json')) return new Response('', { status: 500 });
        put(url, init.body); return new Response('', { status: 201, headers: { ETag: files.get(url).etag } });
      }
      if (method === 'COPY' || method === 'MOVE') {
        if (!item) return new Response('', { status: 404 });
        if (headers.Overwrite === 'F' && files.has(headers.Destination)) return new Response('', { status: 412 });
        put(headers.Destination, item.body);
        if (method === 'MOVE') { files.delete(url); if (state.afterMove) state.afterMove(url); }
        return new Response('', { status: 201 });
      }
      if (method === 'DELETE') { files.delete(url); return new Response(null, { status: 204 }); }
      throw new Error('Unexpected ' + method + ' ' + url);
    }
  });
  await api.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  state.api = api;
  state.preview = () => api.createNutstoreSyncPlan({ mode: 'mirror', workspace: state.local });
  state.apply = (plan, cleanup = 'local') => api.applyNutstoreSyncPlan({ planId: plan.planId, workspace: state.local,
    resolutions: { 'mirror:confirm': 'local', 'mirror:cleanup': cleanup } });
  return state;
}

test('mirror preview is read-only; apply reconciles entries and archives exact reviewed extras after backup', async t => {
  const f = await fixture(t), before = JSON.stringify(f.local), plan = await f.preview();
  assert.equal(JSON.stringify(f.local), before, 'preview does not mutate the local workspace');
  assert.ok(f.calls.every(c => ['GET', 'HEAD', 'PROPFIND'].includes(c.method)));
  assert.equal(plan.localCount, 1); assert.equal(plan.remoteCount, 2);
  assert.deepEqual(plan.extras.map(a => a.name).sort(), ['extra.pdf', 'orphan.pdf']);
  const result = await f.apply(plan);
  assert.equal(result.mirror.complete, true); assert.equal(result.mirror.moved, 2);
  const cloud = JSON.parse(f.files.get(f.library).body);
  assert.deepEqual(cloud.papers.filter(p => !p.deletedAt).map(p => p.title), ['Local title']);
  assert.ok(cloud.notes.find(n => n.id === 'remoteNote').deletedAt);
  assert.ok(cloud.folders.find(folder => folder.id === 'remoteFolder').deletedAt);
  assert.ok(f.files.has(f.attachments + 'keep.pdf'));
  assert.equal(f.files.has(f.attachments + 'extra.pdf'), false);
  const backup = JSON.parse(f.files.get(f.base + plan.archivePath + 'manifest.json').body);
  assert.ok(cloud.papers.find(p => p.id === 'extra').deletedAt > backup.library.papers.find(p => p.id === 'extra').updatedAt);
  assert.equal(backup.library.papers.filter(p => !p.deletedAt).length, 2);
  assert.equal(f.files.get(f.base + plan.archivePath + '0.asset').body.toString(), '%PDF-extra');
  assert.ok(!f.calls.some(c => c.method === 'DELETE'));
  assert.ok(f.calls.findIndex(c => c.method === 'PUT' && c.url.endsWith('manifest.json')) < f.calls.findIndex(c => c.method === 'MOVE'));
  // 预览全程分阶段上报进度：读库 → 清单 → 逐个多余文件 HEAD（分钟级预览不能看起来像卡死）
  const phases = f.progress.filter(p => p.scope === 'plan').map(p => p.phase);
  assert.ok(phases.includes('library') && phases.includes('inventory'), 'reports staged progress');
  const extrasSteps = f.progress.filter(p => p.scope === 'plan' && p.phase === 'extras');
  assert.equal(extrasSteps.length, plan.extras.length, 'one progress event per extra file HEAD');
  assert.match(extrasSteps[0].message, /1\/2/);
});

test('cleanup protects live PDFs, snapshots, annotations and note images, excludes deleted owners', () => {
  const workspace = { papers: [{ id: 'p', attachments: [{ cloudName: 'p.pdf' }, { cloudName: 'web.zip' }],
    pdfAnnotations: [{ type: 'snapshot', cloudName: 'annotation.png' }] },
  { id: 'deleted', deletedAt: 1, attachments: [{ cloudName: 'old.pdf' }] }],
  notes: [{ id: 'n', paperId: 'p', assets: [{ cloudName: 'note.png' }] }, { id: 'topic', assets: [{ cloudName: 'topic.png' }] },
    { id: 'removed', deletedAt: 1, assets: [{ cloudName: 'old-note.png' }] },
    { id: 'orphan', paperId: 'deleted', assets: [{ cloudName: 'orphan.png' }] }] };
  assert.deepEqual(Mirror.activeAssets(workspace).map(a => a.cloudName), ['p.pdf', 'web.zip', 'annotation.png', 'note.png', 'topic.png']);
});

test('metadata-only choice leaves extra files intact; cleanup is never implicit', async t => {
  const f = await fixture(t), plan = await f.preview();
  await assert.rejects(f.api.applyNutstoreSyncPlan({ planId: plan.planId }), /确认/);
  const result = await f.apply(plan, 'remote');
  assert.equal(result.mirror.moved, 0); assert.ok(!f.calls.some(c => c.method === 'MOVE'));
});

test('stale local/remote/object each invalidate the mirror before any remote mutation', async t => {
  for (const change of ['local', 'remote', 'object']) {
    const f = await fixture(t), plan = await f.preview(); f.calls.length = 0;
    if (change === 'local') f.local.papers[0].title = 'Changed locally';
    if (change === 'remote') f.put(f.library, f.files.get(f.library).body);
    if (change === 'object') f.put(f.attachments + 'extra.pdf', 'changed');
    await assert.rejects(f.apply(plan), /变化/, change + ' 变化应拒绝执行');
    assert.ok(f.calls.every(c => ['GET', 'HEAD', 'PROPFIND'].includes(c.method)), change + ' 拒绝时保持只读');
  }
});

test('unavailable inventory refuses preview without mutation', async t => {
  const f = await fixture(t); f.denyListing = true;
  await assert.rejects(f.preview(), /完整云端文件清单/);
  assert.ok(f.calls.every(c => ['GET', 'HEAD', 'PROPFIND'].includes(c.method)));
});

test('pre-apply failures (backup write, attachment completion) keep the old library and never move files', async t => {
  const backup = await fixture(t), backupPlan = await backup.preview();
  const backupOriginal = backup.files.get(backup.library).body.toString();
  backup.failBackup = true;
  await assert.rejects(backup.apply(backupPlan), /失败/);
  assert.equal(backup.files.get(backup.library).body.toString(), backupOriginal);
  assert.ok(!backup.calls.some(c => c.method === 'MOVE'));

  const assets = await fixture(t);
  assets.files.delete(assets.attachments + 'keep.pdf'); assets.failUpload = true;
  const plan = await assets.preview();
  assert.equal(plan.missing.length, 1);
  const assetsOriginal = assets.files.get(assets.library).body.toString();
  await assert.rejects(assets.apply(plan), /附件未完成/);
  assert.equal(assets.files.get(assets.library).body.toString(), assetsOriginal);
  assert.ok(!assets.calls.some(c => c.method === 'MOVE'));
});

test('library changed during MOVE restores the archived object and returns an incomplete result', async t => {
  const f = await fixture(t), plan = await f.preview();
  f.afterMove = url => { if (url.startsWith(f.attachments)) { f.put(f.library, f.files.get(f.library).body); f.afterMove = null; } };
  const result = await f.apply(plan);
  assert.equal(result.mirror.complete, false); assert.equal(result.mirror.moved, 0);
  assert.ok(f.files.has(f.attachments + 'extra.pdf')); assert.ok(f.files.has(f.attachments + 'orphan.pdf'));
  await assert.rejects(f.apply(plan), /过期/);
});


test('local edits during cleanup are not overwritten by the returned snapshot', async t => {
  const f = await fixture(t), plan = await f.preview();
  f.afterMove = () => { f.local.papers[0].title = 'New edit'; f.afterMove = null; };
  const result = await f.apply(plan);
  assert.equal(result.mirror.complete, false); assert.equal(result.workspace, null);
  assert.equal(f.local.papers[0].title, 'New edit');
  assert.ok(f.files.has(f.attachments + 'orphan.pdf'), 'remaining files are not touched');
});

test('cancel after a move stops further cleanup and never auto-replays the plan', async t => {
  const f = await fixture(t), plan = await f.preview();
  f.afterMove = () => { f.api.cancelNutstoreSync(); f.afterMove = null; };
  const result = await f.apply(plan);
  assert.equal(result.mirror.complete, false);
  assert.equal(f.calls.filter(c => c.method === 'MOVE').length, 1);
  assert.ok(f.files.has(f.base + plan.archivePath + 'manifest.json'));
  assert.ok(f.files.has(f.attachments + 'orphan.pdf'));
  await assert.rejects(f.apply(plan), /过期/);
});
