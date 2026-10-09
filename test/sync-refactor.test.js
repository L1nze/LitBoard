'use strict';

/* 坚果云同步重构（对象先行 / 真实对账 / 断路器 / 备份链 / 限流暂停）的回归测试。
 * 与 sync.test.js 共用同一套 mock WebDAV 手法：fetch 返回 Response，服务端状态
 * 存在闭包变量里。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createIntegrations } = require('../electron/integrations.js');

function makeSafeStorage() {
  return {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from(value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8'); }
  };
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/** 最小可用 WebDAV 内存服务端：
 *  - 库/附件/备份存 Map，PROPFIND 按 Range: rows=a-b 分页（可关）
 *  - 可注入：附件 PUT 失败计数、强制 429、删除指定对象 */
function makeDavServer() {
  const state = {
    files: new Map(),          // url -> Buffer|string
    etags: new Map(),
    folders: new Set(),
    attachmentPuts: [],
    libraryPuts: 0,
    propfinds: 0,
    propfindPages: 0,
    failAttachmentPuts: 0,     // 前 N 次附件 PUT 返回 500
    rateLimitAttachmentPuts: 0, // 前 N 次附件 PUT 返回 429
    paged: true,               // PROPFIND 是否模拟坚果云 750/页
    deleteObject: function (name) {
      for (const key of Array.from(state.files.keys())) {
        if (key.includes('/attachments/' + name)) state.files.delete(key);
      }
    }
  };
  const libraryUrl = 'https://dav.jianguoyun.com/dav/LitBoard/litboard-library.json';
  const attachmentsUrl = 'https://dav.jianguoyun.com/dav/LitBoard/attachments';
  state.libraryUrl = libraryUrl;
  state.attachmentsUrl = attachmentsUrl;

  const hrefFor = function (url) {
    const parsed = new URL(url);
    return parsed.pathname;
  };

  const fetch = async function (url, init) {
    const method = init.method;
    if (method === 'GET') {
      const body = state.files.get(url);
      return body !== undefined
        ? new Response(body, { status: 200, headers: { ETag: state.etags.get(url) || '"e1"' } })
        : new Response('', { status: 404 });
    }
    if (method === 'PUT') {
      if (url === libraryUrl) { state.libraryPuts++; }
      if (url.startsWith(attachmentsUrl + '/')) {
        if (state.rateLimitAttachmentPuts > 0) {
          state.rateLimitAttachmentPuts--;
          return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
        }
        if (state.failAttachmentPuts > 0) {
          state.failAttachmentPuts--;
          return new Response('', { status: 500 });
        }
        state.attachmentPuts.push(url.slice(attachmentsUrl.length + 1));
      }
      state.files.set(url, init.body);
      state.etags.set(url, '"e' + (state.etags.size + 1) + '"');
      return new Response('', { status: 201, headers: { ETag: state.etags.get(url) } });
    }
    if (method === 'MKCOL') { state.folders.add(url); return new Response('', { status: 201 }); }
    // 注意 204 不能携带 body（哪怕是空串），否则 Response 构造器抛错
    if (method === 'DELETE') { state.files.delete(url); return new Response(null, { status: 204 }); }
    if (method === 'COPY') {
      const destination = init.headers && init.headers.Destination;
      if (!destination) return new Response('', { status: 400 });
      const source = state.files.get(url);
      if (source === undefined) return new Response('', { status: 404 });
      state.files.set(destination, source);
      return new Response('', { status: 201 });
    }
    if (method === 'PROPFIND') {
      state.propfinds++;
      const isBackups = url.includes('/backups');
      const base = isBackups ? url.replace(/\/+$/, '') + '/' : attachmentsUrl + '/';
      let names = [];
      for (const key of state.files.keys()) {
        if (!key.startsWith(base)) continue;
        const rest = key.slice(base.length);
        if (rest && !rest.endsWith('/')) names.push(rest);
      }
      names.sort();
      if (!state.paged) {
        return new Response('<multistatus>' + names.map(function (n) {
          return '<response><href>' + hrefFor(base + n) + '</href></response>';
        }).join('') + '</multistatus>', { status: 207 });
      }
      // 坚果云分页语义：按 Range: rows=a-b 截取
      const range = String(init.headers && init.headers.Range || '');
      const match = /^rows=(\d+)-(\d+)$/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match ? Number(match[2]) : 749;
      const page = names.slice(start, end + 1);
      state.propfindPages++;
      return new Response('<multistatus>' + page.map(function (n) {
        return '<response><href>' + hrefFor(base + n) + '</href></response>';
      }).join('') + '</multistatus>', { status: 207 });
    }
    throw new Error('Unexpected request ' + method + ' ' + url);
  };
  return { state: state, fetch: fetch };
}

/** 首传确认 + 应用的便捷封装 */
async function syncWithFirstUpload(integrations, workspace) {
  const pending = await integrations.nutstoreSync(workspace);
  if (pending && pending.pendingPlan) {
    assert.equal(pending.pendingPlan.firstUploadSuspected, true, '预期是首传确认而非其他暂停');
    return integrations.applyNutstoreSyncPlan({
      planId: pending.pendingPlan.planId,
      resolutions: { 'plan:first-upload': 'local' }
    });
  }
  return pending;
}

test('对象先行：附件 PUT 失败时云端库不登记该附件（无假元数据）', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-object-first-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, '%PDF-object-first');
  // 云端已有库（避免首传确认）：登记 1 篇无附件文献
  dav.state.files.set(dav.state.libraryUrl, JSON.stringify({ syncVersion: 6, papers: [{ id: 'p0', title: '占位' }], folders: [] }));
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  dav.state.failAttachmentPuts = 1;
  const result = await integrations.nutstoreSync({
    papers: [{ id: 'p1', title: '对象先行', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath }] }],
    folders: []
  });
  assert.equal(result.assets.failures.length, 1);
  assert.equal(result.assets.pendingUpload, 1, '失败附件计入待上传队列');
  const cloud = JSON.parse(dav.state.files.get(dav.state.libraryUrl));
  const cloudAsset = cloud.papers.find(function (p) { return p.id === 'p1'; }).attachments[0];
  assert.ok(!cloudAsset.cloudName, 'PUT 失败：云端不得登记 cloudName');
  assert.ok(!cloudAsset.cloudHash);
});

test('对象先行（既有悬空登记）：清单缺对象且重传失败时，终写剥离旧登记', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-strip-dangling-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const pdf = Buffer.from('%PDF-dangling');
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, pdf);
  // 固定两侧附件时间，避免分别 normalize 时 Date.now() 漂移触发无关冲突。
  // 云端库带着悬空登记（历史事故形态）：词条声称有附件，attachments/ 里没有对象
  dav.state.files.set(dav.state.libraryUrl, JSON.stringify({ syncVersion: 6, papers: [{
    id: 'p1', title: '悬空', updatedAt: 2000, attachments: [{ id: 'a1', addedAt: 1000, kind: 'pdf', fileName: 'paper.pdf',
      cloudName: 'p1.pdf', cloudHash: sha256(pdf), cloudSize: pdf.length }]
  }], folders: [] }));
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  dav.state.failAttachmentPuts = 1; // 重传也失败
  const result = await integrations.nutstoreSync({
    papers: [{ id: 'p1', title: '悬空', updatedAt: 2000, attachments: [{ id: 'a1', addedAt: 1000, kind: 'pdf', fileName: 'paper.pdf', path: pdfPath,
      cloudName: 'p1.pdf', cloudHash: sha256(pdf), cloudSize: pdf.length }] }],
    folders: []
  });
  assert.ok(result.assets, '不应进入冲突暂停：' + JSON.stringify(Object.keys(result)));
  assert.equal(result.assets.pendingUpload, 1);
  const cloud = JSON.parse(dav.state.files.get(dav.state.libraryUrl));
  const cloudAsset = cloud.papers[0].attachments[0];
  assert.ok(!cloudAsset.cloudName, '真实清单缺对象 + 重传失败：悬空登记被剥离');
});

test('真实对账（A2 回归）：云端对象被外部删除后，下一轮同步重传', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-reupload-deleted-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, '%PDF-reupload');
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const first = await syncWithFirstUpload(integrations, {
    papers: [{ id: 'p1', title: '重传', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath }] }],
    folders: []
  });
  assert.equal(first.assets.uploaded, 1);
  assert.equal(dav.state.attachmentPuts.length, 1);
  // 稳态：再同步一次，不重传（清单里有）
  await integrations.nutstoreSync({ papers: first.workspace.papers, folders: [] });
  assert.equal(dav.state.attachmentPuts.length, 1, '对象在云端：不重复上传');
  // 用户在云端直接删掉对象：下轮必须发现并重传（旧实现拿库 JSON 自证，永不重传）
  dav.state.deleteObject('p1.pdf');
  const third = await integrations.nutstoreSync({ papers: first.workspace.papers, folders: [] });
  assert.equal(third.assets.uploaded, 1, '对象被删：重新上传');
  assert.equal(dav.state.attachmentPuts.length, 2);
});

test('断路器：本地大批缺失被当成删除传播时暂停并要求确认', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-mass-drop-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const ten = [];
  for (let i = 0; i < 10; i++) ten.push({ id: 'p' + i, title: 'P' + i, updatedAt: 1000 + i });
  const seeded = await syncWithFirstUpload(integrations, { papers: ten, folders: [] });
  assert.equal(seeded.workspace.papers.length, 10);
  // 模拟本机数据目录事故：只剩 3 篇（7 篇 ≥ max(3,10%) 阈值）
  const local = { papers: seeded.workspace.papers.slice(0, 3).map(function (p) {
    return Object.assign({}, p, { updatedAt: p.updatedAt + 5000 });
  }), folders: [] };
  const pending = await integrations.nutstoreSync(local);
  assert.equal(pending.pendingPlan.massDropSuspected, true, '大批移除必须暂停自动写入');
  assert.equal(pending.pendingPlan.massDropCount, 7);
  assert.equal(JSON.parse(dav.state.files.get(dav.state.libraryUrl)).papers.length, 10, '未确认前云端原样');
  // 确认删除：按本地 3 篇覆盖
  const confirmed = await integrations.applyNutstoreSyncPlan({
    planId: pending.pendingPlan.planId,
    resolutions: { 'plan:mass-drop-reset': 'local' }
  });
  assert.equal(confirmed.workspace.papers.length, 3);
  assert.equal(JSON.parse(dav.state.files.get(dav.state.libraryUrl)).papers.length, 3);
});

test('断路器：选择放弃删除时，云端被移除的词条恢复回来', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-mass-drop-undo-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const ten = [];
  for (let i = 0; i < 10; i++) ten.push({ id: 'p' + i, title: 'P' + i, updatedAt: 1000 + i });
  const seeded = await syncWithFirstUpload(integrations, { papers: ten, folders: [] });
  const local = { papers: seeded.workspace.papers.slice(0, 3).map(function (p) {
    return Object.assign({}, p, { updatedAt: p.updatedAt + 5000 });
  }), folders: [] };
  const pending = await integrations.nutstoreSync(local);
  assert.equal(pending.pendingPlan.massDropSuspected, true);
  const undone = await integrations.applyNutstoreSyncPlan({
    planId: pending.pendingPlan.planId,
    resolutions: { 'plan:mass-drop-reset': 'remote' }
  });
  assert.equal(undone.workspace.papers.length, 10, '放弃删除：远端 10 篇全部恢复');
  assert.equal(JSON.parse(dav.state.files.get(dav.state.libraryUrl)).papers.length, 10);
});

test('断路器不误伤：删除 1-2 篇正常传播，无需确认', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-mass-drop-ok-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const ten = [];
  for (let i = 0; i < 10; i++) ten.push({ id: 'p' + i, title: 'P' + i, updatedAt: 1000 + i });
  const seeded = await syncWithFirstUpload(integrations, { papers: ten, folders: [] });
  const two = { papers: seeded.workspace.papers.slice(0, 8).map(function (p) {
    return Object.assign({}, p, { updatedAt: p.updatedAt + 5000 });
  }), folders: [] };
  const result = await integrations.nutstoreSync(two);
  assert.ok(!result.pendingPlan, '删除 2/10 低于阈值：直接同步');
  assert.equal(JSON.parse(dav.state.files.get(dav.state.libraryUrl)).papers.length, 8);
});

test('备份链：内容变化覆盖云端前先 COPY 到 backups/，超量裁剪到 5 份', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-backup-chain-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  let papers = [{ id: 'p1', title: 'v0', updatedAt: 1000 }];
  await syncWithFirstUpload(integrations, { papers: papers, folders: [] });
  // 连续 10 次内容变化：每次覆盖前都应有备份，最终保留最近 5 份
  for (let i = 1; i <= 10; i++) {
    papers = [{ id: 'p1', title: 'v' + i, updatedAt: 1000 + i }];
    await integrations.nutstoreSync({ papers: papers, folders: [] });
  }
  const backupNames = Array.from(dav.state.files.keys())
    .filter(function (url) { return url.includes('/backups/library-'); })
    .map(function (url) { return url.split('/').pop(); });
  assert.ok(backupNames.length >= 1, '至少留有一份云端备份');
  // 裁剪语义：超过 8 份时删到 5；稳态下界 5、上界 = 5 + 阈值内的正常新增
  assert.ok(backupNames.length <= 6, '备份链有界（裁到 5 后至多再加 1），实际 ' + backupNames.length);
  // 本地 sync-history 也应有留档（读取过的每一版云端库）
  const history = await fs.readdir(path.join(dir, 'sync-history'));
  assert.ok(history.length >= 1, '本地 sync-history 有内容寻址留档');
  // 最后一版备份应等于被覆盖前的内容（v9 时代的库）
  const lastBackup = dav.state.files.get(Array.from(dav.state.files.keys())
    .filter(function (url) { return url.includes('/backups/library-'); }).sort().pop());
  assert.equal(JSON.parse(lastBackup).papers[0].title, 'v9');
});

test('限流暂停（节流器启用）：429 软暂停 + pacing 状态持久化 + 到点续传完成', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-paced-429-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  dav.state.files.set(dav.state.libraryUrl, JSON.stringify({ syncVersion: 6, papers: [{ id: 'p0', title: '占位' }], folders: [] }));
  // 虚拟时钟：节流等待即时推进，测试不为 3.1s 间隔买单
  let nowMs = 1700000000000;
  const clock = { now: function () { return nowMs; }, sleep: async function (ms) { nowMs += ms; } };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch,
    pacing: clock
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, '%PDF-paced');
  const workspace = { papers: [{ id: 'p1', title: '限流', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath }] }], folders: [] };
  dav.state.rateLimitAttachmentPuts = 1;
  const paused = await integrations.nutstoreSync(workspace);
  assert.equal(paused.paused, true);
  assert.ok(paused.resumeAt > clock.now(), '恢复时刻在未来（Retry-After=60s）');
  const ledger = JSON.parse(await fs.readFile(path.join(dir, 'sync-asset-ledger.json'), 'utf8'));
  assert.ok(ledger.pacing && ledger.pacing.resumeAt > clock.now(), 'pacing 暂停状态持久化到台账');
  // 未到恢复时刻：再同步立即暂停
  const still = await integrations.nutstoreSync(workspace);
  assert.equal(still.paused, true);
  // 时钟推进过恢复时刻：续传完成
  nowMs = paused.resumeAt + 10000;
  const resumed = await integrations.nutstoreSync(workspace);
  assert.ok(!resumed.paused, '恢复时刻已过：同步完成');
  assert.equal(resumed.assets.uploaded, 1);
  assert.equal(dav.state.attachmentPuts.length, 1);
});

test('节流预算：窗口将尽时主动暂停，不必等服务端 429', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-paced-budget-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  dav.state.files.set(dav.state.libraryUrl, JSON.stringify({ syncVersion: 6, papers: [], folders: [] }));
  let nowMs = 1700000000000;
  const clock = { now: function () { return nowMs; }, sleep: async function (ms) { nowMs += ms; } };
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch,
    pacing: clock, maxPerWindow: undefined
  });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  // 预置一个几乎耗尽的窗口（free 档 600-24=576 已用满）
  const ledgerPath = path.join(dir, 'sync-asset-ledger.json');
  const used = [];
  for (let i = 0; i < 600 - 24; i++) used.push(nowMs - i * 1000);
  await fs.writeFile(ledgerPath, JSON.stringify({ version: 1, remoteKey: 'u\n' + dav.state.libraryUrl, assets: {},
    pacing: { requests: used, resumeAt: 0 } }));
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, '%PDF-budget');
  const paused = await integrations.nutstoreSync({
    papers: [{ id: 'p1', title: '预算', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath }] }],
    folders: []
  });
  assert.equal(paused.paused, true, '预算将尽：主动暂停');
  assert.equal(dav.state.attachmentPuts.length, 0, '没有发出附件请求');
  assert.match(paused.message, /预算/);
});

test('PROPFIND 分页：超过 750 个对象时按 Range 翻页拿到完整清单', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-propfind-pages-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  // 云端放 800 个对象 + 库里登记其中一个（p1.pdf，本地文件哈希一致）
  const pdf = Buffer.from('%PDF-paged');
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, pdf);
  for (let i = 0; i < 800; i++) {
    dav.state.files.set(dav.state.attachmentsUrl + '/obj-' + String(i).padStart(4, '0') + '.bin', Buffer.from('x' + i));
  }
  dav.state.files.set(dav.state.attachmentsUrl + '/p1.pdf', pdf);
  dav.state.files.set(dav.state.libraryUrl, JSON.stringify({ syncVersion: 6, papers: [{
    id: 'p1', title: '分页', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf',
      cloudName: 'p1.pdf', cloudHash: sha256(pdf), cloudSize: pdf.length }]
  }], folders: [] }));
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const result = await integrations.nutstoreSync({
    papers: [{ id: 'p1', title: '分页', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath,
      cloudName: 'p1.pdf', cloudHash: sha256(pdf), cloudSize: pdf.length }] }],
    folders: []
  });
  assert.ok(dav.state.propfindPages >= 2, '至少翻了两页（800 个对象 > 750/页）');
  assert.equal(result.assets.uploaded, 0, '清单完整命中 p1.pdf：无需上传');
  assert.equal(dav.state.attachmentPuts.length, 0);
  // 对账（inspect）：声称 1 个、实有 801 个
  const info = await integrations.inspectNutstoreRemote({});
  assert.equal(info.audit.supported, true);
  assert.equal(info.audit.claimedCount, 1);
  assert.equal(info.audit.actualCount, 801);
  assert.equal(info.audit.missingCount, 0);
});

test('inspect 对账：悬空登记（词条声称有、云端没有）必须可见', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-audit-missing-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  dav.state.files.set(dav.state.libraryUrl, JSON.stringify({ syncVersion: 6, papers: [{
    id: 'p1', title: '悬空', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf',
      cloudName: 'p1.pdf', cloudHash: sha256(Buffer.from('x')), cloudSize: 1 }]
  }], folders: [] }));
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const info = await integrations.inspectNutstoreRemote({});
  assert.equal(info.audit.supported, true);
  assert.equal(info.audit.missingCount, 1);
  assert.deepEqual(info.audit.missing, ['p1.pdf']);
});

test('首传确认：选择取消时不写云端', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-first-upload-cancel-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const pending = await integrations.nutstoreSync({ papers: [{ id: 'p1', title: '取消' }], folders: [] });
  assert.equal(pending.pendingPlan.firstUploadSuspected, true);
  await assert.rejects(integrations.applyNutstoreSyncPlan({
    planId: pending.pendingPlan.planId,
    resolutions: { 'plan:first-upload': 'remote' }
  }), /云端还没有文献库文件/);
  assert.equal(dav.state.libraryPuts, 0, '取消首传：云端零写入');
});

test('云端 JSON 自证捷径已废除：登记名不再跳过真实 PROPFIND', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-no-self-cert-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const dav = makeDavServer();
  const pdf = Buffer.from('%PDF-selfcert');
  const pdfPath = path.join(dir, 'paper.pdf');
  await fs.writeFile(pdfPath, pdf);
  // 库 JSON 声称 p1.pdf 已上传，但 attachments/ 是空的（历史悬空形态）
  dav.state.files.set(dav.state.libraryUrl, JSON.stringify({ syncVersion: 6, papers: [{
    id: 'p1', title: '自证', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf',
      cloudName: 'p1.pdf', cloudHash: sha256(pdf), cloudSize: pdf.length }]
  }], folders: [] }));
  const integrations = createIntegrations({ baseDir: dir, homeDir: dir, safeStorage: makeSafeStorage(), fetch: dav.fetch });
  await integrations.saveConfig({ nutstoreUser: 'u', nutstorePassword: 'p' });
  const result = await integrations.nutstoreSync({
    papers: [{ id: 'p1', title: '自证', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'paper.pdf', path: pdfPath,
      cloudName: 'p1.pdf', cloudHash: sha256(pdf), cloudSize: pdf.length }] }],
    folders: []
  });
  assert.ok(dav.state.propfinds >= 1, '登记名存在也必须做真实 PROPFIND');
  assert.equal(result.assets.uploaded, 1, '真实清单缺对象：重传，而不是采信库 JSON');
});
