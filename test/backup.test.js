'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { createLibraryDb } = require('../electron/db.js');
const { createBackupManager, MANIFEST_VERSION, publishObject } = require('../electron/backup.js');
const { createDataPathManager } = require('../electron/data-paths.js');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function makeEnv(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-bk-'));
  const configDir = path.join(root, 'config');
  const libraryDir = path.join(root, 'savefolder');
  const backupDir = path.join(root, 'backup');
  const defaultDir = path.join(root, 'default');
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(libraryDir, { recursive: true });
  await fs.mkdir(defaultDir, { recursive: true });
  await fs.writeFile(path.join(defaultDir, 'data-paths.json'), JSON.stringify({
    version: 1, configDir: configDir, libraryDir: libraryDir
  }), 'utf8');
  const dataPathManager = createDataPathManager({ defaultDir: defaultDir });
  dataPathManager.prepareAtStartup();
  const db = createLibraryDb(libraryDir);
  await db.open();
  const manager = createBackupManager({
    libraryDir: libraryDir,
    configDir: configDir,
    dataPathManager: dataPathManager,
    getDb: function () { return db; }
  });
  t.after(async function () {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, configDir, libraryDir, backupDir, defaultDir, dataPathManager, db, manager };
}

async function seedLibrary(db, configDir, options) {
  const files = options && options.files;
  const managedPdf = path.join(configDir, 'synced-attachments', 'items', 'p1', 'zABC12345.pdf');
  await fs.mkdir(path.dirname(managedPdf), { recursive: true });
  await fs.writeFile(managedPdf, files && files.managed || '%PDF-1.4 managed attachment', 'utf8');
  const externalSupp = path.join(configDir, '..', 'external-supp.txt');
  await fs.writeFile(externalSupp, files && files.external || 'supplementary material', 'utf8');
  const snapImage = path.join(configDir, 'annotation-images', 'snap-1.png');
  await fs.mkdir(path.dirname(snapImage), { recursive: true });
  await fs.writeFile(snapImage, Buffer.from([0x89, 0x50, 0x4e, 0x47, 77, 66, 1, 2]), 'utf8');
  await db.saveState({
    papers: [{
      id: 'p1', title: 'Backed Up Paper',
      attachments: [
        { id: 'at1', kind: 'pdf', fileName: 'zABC12345.pdf', path: managedPdf },
        { id: 'at2', kind: 'supp', fileName: 'external-supp.txt', path: externalSupp }
      ],
      pdfAnnotations: [{
        id: 'an1', type: 'snapshot', color: '#ffd400', text: '', comment: '',
        position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, createdAt: 1, updatedAt: 1, imagePath: snapImage
      }]
    }]
  });
  return { managedPdf, externalSupp, snapImage };
}

test('backup creates a snapshot with manifest, dedup objects and stripped bridge token', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await env.db.setSetting('bridgeToken', 'super-secret-token');
  await seedLibrary(env.db, env.configDir);
  const result = await env.manager.createSnapshot();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.assets, 3); // 托管 PDF + 外部补充材料 + 批注截图

  const snapshots = await env.manager.listSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].valid, true);
  const snapshotDir = path.join(env.backupDir, 'snapshots', result.snapshotId);
  const manifest = JSON.parse(await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, MANIFEST_VERSION);
  assert.equal(manifest.database.file, 'library.sqlite.gz');
  assert.equal(manifest.assets.length, 3);

  // 归档数据库不包含扩展令牌
  const raw = zlib.gunzipSync(await fs.readFile(path.join(snapshotDir, 'library.sqlite.gz')));
  assert.equal(sha256(raw), manifest.database.dbSha256);
  const probe = path.join(env.root, 'probe.sqlite');
  await fs.writeFile(probe, raw);
  const d = new DatabaseSync(probe);
  const token = d.prepare("SELECT value FROM settings WHERE key = 'bridgeToken'").get();
  const integrity = d.prepare('PRAGMA integrity_check').get();
  d.close();
  assert.equal(token, undefined);
  assert.equal(Object.values(integrity)[0], 'ok');

  // 内容寻址：全部对象与 manifest 哈希一致
  for (const asset of manifest.assets) {
    const objectFile = path.join(env.backupDir, 'objects', asset.hash.slice(0, 2), asset.hash);
    const content = await fs.readFile(objectFile);
    assert.equal(sha256(content), asset.hash);
  }
});

test('backup dedups the same file referenced from multiple papers', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  const shared = path.join(env.root, 'shared.pdf');
  await fs.writeFile(shared, 'SAME CONTENT PDF', 'utf8');
  await env.db.saveState({ papers: [
    { id: 'p1', title: 'A', attachments: [{ id: 'a1', kind: 'pdf', fileName: 'a.pdf', path: shared }] },
    { id: 'p2', title: 'B', attachments: [{ id: 'a2', kind: 'pdf', fileName: 'b.pdf', path: shared }] }
  ] });
  const result = await env.manager.createSnapshot();
  assert.equal(result.ok, true);
  assert.equal(result.assets, 2); // manifest 两条条目
  // 但对象仓只有一个对象
  let objectCount = 0;
  const buckets = await fs.readdir(path.join(env.backupDir, 'objects'));
  for (const bucket of buckets) {
    objectCount += (await fs.readdir(path.join(env.backupDir, 'objects', bucket))).length;
  }
  assert.equal(objectCount, 1);
});

/* publishObject：内容寻址对象的发布必须容忍「目标已经就位」。
 * 上面那条去重测试偶发 ok:false 就是这里出的问题——两路并发暂存同一内容，
 * Windows 上 rename 覆盖已落地对象抛 EPERM（或被只读属性/杀毒句柄挡住），
 * 旧实现直接把它当「资源无法读取」，于是整份备份不发布。 */
test('publishObject tolerates a target that is already published', async function () {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-pub-'));
  try {
    const content = Buffer.from('SAME CONTENT PDF', 'utf8');
    const hash = sha256(content);
    const target = path.join(root, 'objects', hash.slice(0, 2), hash);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // 正常发布：临时文件就位后改名，内容与哈希一致
    const tempOk = target + '.tmp-1';
    await fs.writeFile(tempOk, content);
    await publishObject(tempOk, target, hash);
    assert.equal(sha256(await fs.readFile(target)), hash);
    await assert.rejects(fs.access(tempOk), '临时文件必须已被改名/清理');

    // 竞态形态：另一路已写好同内容对象，且目标带只读属性（Windows 上 rename 会 EPERM）
    const tempRace = target + '.tmp-2';
    await fs.writeFile(tempRace, content);
    await fs.chmod(target, 0o444);
    await publishObject(tempRace, target, hash);   // 不得抛错
    assert.equal(sha256(await fs.readFile(target)), hash, '对象内容不得被改坏');
    await assert.rejects(fs.access(tempRace), '竞态路径也要清掉临时文件');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('backup rotation keeps 7 snapshots and GC removes unreferenced objects', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  // 第一份：附件内容 AAA
  await seedLibrary(env.db, env.configDir, { files: { managed: 'AAA', external: 'AAA ext' } });
  const first = await env.manager.createSnapshot();
  assert.equal(first.ok, true);
  const firstManifest = JSON.parse(await fs.readFile(
    path.join(env.backupDir, 'snapshots', first.snapshotId, 'manifest.json'), 'utf8'));
  // 后续 7 份：附件内容换成别的内容（长度不同避免 hash 缓存误命中）
  for (let i = 0; i < 7; i++) {
    const content = 'content-variant-' + i + '-xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    await seedLibrary(env.db, env.configDir, { files: { managed: content + '_m', external: content + '_e' } });
    const r = await env.manager.createSnapshot();
    assert.equal(r.ok, true, r.error);
  }
  // 只剩 7 份快照，且最初那份的附件对象已被 GC
  const snapshots = await env.manager.listSnapshots();
  assert.equal(snapshots.length, 7);
  const oldHash = firstManifest.assets[0].hash;
  const oldObject = path.join(env.backupDir, 'objects', oldHash.slice(0, 2), oldHash);
  await assert.rejects(fs.access(oldObject)); // 不再被引用 → 已被清理
});

test('backup with a missing referenced file is not published and keeps old snapshots', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await seedLibrary(env.db, env.configDir);
  const first = await env.manager.createSnapshot();
  assert.equal(first.ok, true);
  // 引用一个不存在的文件
  const missingFile = path.join(env.root, 'gone.pdf');
  await env.db.saveState({
    papers: [{ id: 'p2', title: 'Broken', attachments: [{ id: 'atx', kind: 'pdf', fileName: 'gone.pdf', path: missingFile }] }]
  });
  const result = await env.manager.createSnapshot();
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].path, missingFile);
  // 旧快照保留，没有发布半成品
  assert.equal((await env.manager.listSnapshots()).length, 1);
  const staging = await fs.readdir(env.backupDir);
  assert.equal(staging.some(function (name) { return String(name).indexOf('.staging-') === 0; }), false);
});

test('restore validates hashes and rewrites asset paths into restored-assets', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await env.db.setSetting('bridgeToken', 'token-before-restore');
  const seeded = await seedLibrary(env.db, env.configDir);
  const snapshot = await env.manager.createSnapshot();
  assert.equal(snapshot.ok, true);
  // 篡改前先记录各文件原内容
  const managedBytes = await fs.readFile(seeded.managedPdf);
  const suppBytes = await fs.readFile(seeded.externalSupp);
  await env.db.close();

  const restored = await env.manager.restoreSnapshot({ snapshotId: snapshot.snapshotId, quarantineTag: 'before-restore' });
  assert.equal(restored.ok, true, restored.error);
  assert.equal(restored.assets, 3);
  assert.ok(restored.quarantined.some(function (name) { return name.indexOf('litboard.sqlite.before-restore-') === 0; }));

  // 重新打开：路径全部指向受管 restored-assets/<snapshotId>/，文件内容与原文件一致
  const db2 = createLibraryDb(env.libraryDir);
  await db2.open();
  const state = await db2.loadState();
  const paper = state.papers[0];
  assert.equal(paper.attachments.length, 2);
  for (const att of paper.attachments) {
    assert.ok(att.path.indexOf(path.join(env.configDir, 'restored-assets', snapshot.snapshotId)) === 0);
  }
  const snapAnn = paper.pdfAnnotations.find(function (a) { return a.id === 'an1'; });
  assert.ok(snapAnn.imagePath.indexOf(path.join(env.configDir, 'restored-assets', snapshot.snapshotId)) === 0);
  assert.deepEqual(await fs.readFile(paper.attachments[0].path), managedBytes);
  assert.deepEqual(await fs.readFile(paper.attachments[1].path), suppBytes);
  // 令牌在快照中已被剥离 → 恢复后没有旧令牌
  assert.equal(await db2.getSetting('bridgeToken'), null);
  await db2.close();
});

test('tampered manifest or database snapshot is rejected on restore', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await seedLibrary(env.db, env.configDir);
  const snapshot = await env.manager.createSnapshot();
  assert.equal(snapshot.ok, true);
  await env.db.close();
  const snapshotDir = path.join(env.backupDir, 'snapshots', snapshot.snapshotId);
  // 篡改 manifest 中的数据库哈希
  const manifest = JSON.parse(await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'));
  manifest.database.dbSha256 = '0'.repeat(64);
  await fs.writeFile(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  const rejected = await env.manager.restoreSnapshot({ snapshotId: snapshot.snapshotId });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /哈希不匹配/);
  // 原库不受影响（未被隔离/替换）
  assert.equal((await fs.readdir(env.libraryDir)).some(function (name) { return name === 'litboard.sqlite'; }), true);
});

test('latest valid snapshot auto-restores a corrupted database and quarantines it', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await seedLibrary(env.db, env.configDir);
  await env.db.saveState({ papers: [{ id: 'p9', title: 'Later Paper' }] });
  const first = await env.manager.createSnapshot();
  assert.equal(first.ok, true);
  // 再写入一篇并备第二份（最新）
  await env.db.saveState({ papers: [{ id: 'p10', title: 'Newest' }] });
  const second = await env.manager.createSnapshot();
  assert.equal(second.ok, true);
  await env.db.close();
  // 写坏主库
  await fs.writeFile(path.join(env.libraryDir, 'litboard.sqlite'), 'garbage data'.repeat(100), 'utf8');
  const restored = await env.manager.restoreLatestValid();
  assert.equal(restored.ok, true, restored.error);
  assert.equal(restored.snapshotId, second.snapshotId); // 从最新有效快照恢复
  assert.ok(restored.quarantined.some(function (name) { return name.indexOf('litboard.sqlite.corrupt-') === 0; }));
  const db2 = createLibraryDb(env.libraryDir);
  await db2.open();
  const state = await db2.loadState();
  assert.ok(state.papers.some(function (p) { return p.title === 'Newest'; }));
  await db2.close();
});

test('corrupted database with no snapshot is refused, files are preserved, no empty db', async function (t) {
  const env = await makeEnv(t);
  await env.db.close();
  await fs.writeFile(path.join(env.libraryDir, 'litboard.sqlite'), 'garbage'.repeat(40), 'utf8');
  const restored = await env.manager.restoreLatestValid();
  assert.equal(restored.ok, false);
  // 无备份时主库仍原样保留
  assert.match(await fs.readFile(path.join(env.libraryDir, 'litboard.sqlite'), 'utf8'), /^garbage/);
  const db2 = createLibraryDb(env.libraryDir);
  await assert.rejects(db2.open(), function (error) {
    assert.equal(error.code, 'LITBOARD_DB_CORRUPT');
    return true;
  });
});

test('legacy .bak fallback still works when no snapshot exists', async function (t) {
  const env = await makeEnv(t);
  await env.db.saveState({ papers: [{ id: 'p1', title: 'From BAK' }] });
  await env.db.backupIfDue(true); // 生成 litboard.sqlite.bak
  await env.db.close();
  await fs.writeFile(path.join(env.libraryDir, 'litboard.sqlite'), 'broken db'.repeat(50), 'utf8');
  const restored = await env.manager.restoreLegacyBak();
  assert.equal(restored.ok, true, restored.error);
  assert.ok(restored.quarantined.some(function (name) { return name.indexOf('litboard.sqlite.corrupt-') === 0; }));
  const db2 = createLibraryDb(env.libraryDir);
  await db2.open();
  assert.equal((await db2.loadState()).papers[0].title, 'From BAK');
  await db2.close();
});

test('backup dir must be writable and not nested with config or library dirs', async function (t) {
  const env = await makeEnv(t);
  assert.throws(function () { env.dataPathManager.stageBackupDir(env.configDir); }, /独立目录/);
  assert.throws(function () { env.dataPathManager.stageBackupDir(env.libraryDir); }, /独立目录/);
  assert.throws(function () { env.dataPathManager.stageBackupDir(path.join(env.configDir, 'sub')); }, /独立目录/);
  assert.throws(function () { env.dataPathManager.stageBackupDir('relative/path'); }, /有效的绝对目录/);
  env.dataPathManager.stageBackupDir(env.backupDir);
  assert.equal(env.dataPathManager.getState().backupDir, env.backupDir);
  // 常规启动路径也能读到 backupDir
  const again = createDataPathManager({ defaultDir: env.defaultDir });
  const state = again.prepareAtStartup();
  assert.equal(state.backupDir, env.backupDir);
});

test('snapshot listing is cheap by default and only hashes assets when asked', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await seedLibrary(env.db, env.configDir);
  const snapshot = await env.manager.createSnapshot();
  assert.equal(snapshot.ok, true, snapshot.error);
  const manifest = JSON.parse(await fs.readFile(
    path.join(env.backupDir, 'snapshots', snapshot.snapshotId, 'manifest.json'), 'utf8'));
  // 制造「深度校验必然失败」的状态：删掉一个内容寻址对象
  const victim = path.join(env.backupDir, 'objects', manifest.assets[0].hash.slice(0, 2), manifest.assets[0].hash);
  await fs.rm(victim);

  // 默认列表只读 manifest：照常列出，且不谎称已深度校验
  const cheap = await env.manager.listSnapshots();
  assert.equal(cheap.length, 1);
  assert.equal(cheap[0].valid, true);
  assert.equal(cheap[0].verified, false);

  // 显式要求时才逐项校验，并如实报告损坏
  const deep = await env.manager.listSnapshots(null, { verify: true });
  assert.equal(deep[0].valid, false);
  assert.equal(deep[0].verified, false);
  assert.match(deep[0].error, /资产对象缺失或损坏/);

  // 恢复流程仍然拒绝损坏快照，且校验发生在改动工作库之前
  await env.db.close();
  const rejected = await env.manager.restoreSnapshot({ snapshotId: snapshot.snapshotId });
  assert.equal(rejected.ok, false);
  assert.equal((await fs.readdir(env.libraryDir)).includes('litboard.sqlite'), true);
});

test('rotation honours a user-configured retention count', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  env.dataPathManager.stageBackupKeep(2);
  assert.equal(env.dataPathManager.getState().backupKeep, 2);
  assert.equal((await env.manager.status()).keepSnapshots, 2);

  for (let i = 0; i < 4; i++) {
    await env.db.saveState({ papers: [{ id: 'p' + i, title: 'T' + i }] });
    const result = await env.manager.createSnapshot();
    assert.equal(result.ok, true, result.error);
    assert.equal(result.prunedSnapshots, i >= 2 ? 1 : 0);
  }
  assert.equal((await env.manager.listSnapshots()).length, 2);

  assert.throws(function () { env.dataPathManager.stageBackupKeep(0.5); }, /1–30/);
  assert.throws(function () { env.dataPathManager.stageBackupKeep(31); }, /1–30/);
  // 还没设置备份目录时不允许改份数（用一个全新的、没有 backupDir 的定位文件）
  const emptyDefaultDir = path.join(env.root, 'fresh-default');
  await fs.mkdir(emptyDefaultDir, { recursive: true });
  const fresh = createDataPathManager({ defaultDir: emptyDefaultDir });
  fresh.prepareAtStartup();
  assert.throws(function () { fresh.stageBackupKeep(3); }, /请先设置完整备份目录/);
});

test('an unchanged library does not publish a duplicate snapshot', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await seedLibrary(env.db, env.configDir);

  const first = await env.manager.createSnapshot();
  assert.equal(first.ok, true, first.error);
  assert.ok(!first.unchanged);

  const second = await env.manager.createSnapshot();
  assert.equal(second.ok, true, second.error);
  assert.equal(second.skipped, true);
  assert.equal(second.unchanged, true);
  assert.equal(second.snapshotId, first.snapshotId);
  assert.equal((await env.manager.listSnapshots()).length, 1);
  const names = await fs.readdir(env.backupDir);
  assert.equal(names.some(function (name) { return String(name).indexOf('.staging-') === 0; }), false);

  // 恢复前的紧急快照必须真的落盘，即使内容与最近一份相同
  const emergency = await env.manager.createSnapshot(null, { skipRotation: true, skipIfUnchanged: false });
  assert.equal(emergency.ok, true, emergency.error);
  assert.ok(!emergency.unchanged);
  assert.notEqual(emergency.snapshotId, first.snapshotId);
  assert.equal((await env.manager.listSnapshots()).length, 2);

  // 内容真的变了就必须发布新快照
  await env.db.saveState({ papers: [{ id: 'p2', title: 'Changed' }] });
  const third = await env.manager.createSnapshot();
  assert.equal(third.ok, true, third.error);
  assert.ok(!third.unchanged);
  assert.equal((await env.manager.listSnapshots()).length, 3);
});

test('leftover cleanup removes only provably-dead files and keeps referenced ones', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // 被库引用的恢复附件：必须保留
  const restoredRoot = path.join(env.configDir, 'restored-assets');
  const referenced = path.join(restoredRoot, '20260910-000000-bbbbbb');
  const livePdf = path.join(referenced, 'assets', 'p1', 'live.pdf');
  await fs.mkdir(path.dirname(livePdf), { recursive: true });
  await fs.writeFile(livePdf, 'LIVE PDF');
  await env.db.saveState({ papers: [{ id: 'p1', title: 'T', attachments: [
    { id: 'a1', kind: 'pdf', fileName: 'live.pdf', path: livePdf }] }] });
  const snapshot = await env.manager.createSnapshot();
  assert.equal(snapshot.ok, true, snapshot.error);

  // 库内已无引用的恢复目录：可清
  const orphan = path.join(restoredRoot, '20200101-000000-aaaaaa');
  await fs.mkdir(path.join(orphan, 'assets', 'p9'), { recursive: true });
  await fs.writeFile(path.join(orphan, 'assets', 'p9', 'old.pdf'), 'OLD CONTENT');

  // 恢复残留 .previous-*（老化后可清）
  const previous = path.join(restoredRoot, '.previous-20200101-000000-cccccc-111-2222');
  await fs.mkdir(previous, { recursive: true });
  await fs.writeFile(path.join(previous, 'x.pdf'), 'X');
  await fs.utimes(previous, old, old);

  // 崩溃残留的暂存目录（老化后可清）与新建的（必须保留）
  const staleStaging = path.join(env.backupDir, '.staging-20200101-000000-deadbe');
  await fs.mkdir(staleStaging, { recursive: true });
  await fs.writeFile(path.join(staleStaging, 'library.sqlite.gz'), 'garbage');
  await fs.utimes(staleStaging, old, old);
  const freshStaging = path.join(env.backupDir, '.staging-20990101-000000-fresh1');
  await fs.mkdir(freshStaging, { recursive: true });

  // 迁移数据目录留下的旧库副本：保留最新一份
  const oldMigrated = path.join(env.libraryDir, 'litboard.sqlite.pre-path-change-20200101000000.bak');
  const newMigrated = path.join(env.libraryDir, 'litboard.sqlite.pre-path-change-20260910000000.bak');
  await fs.writeFile(oldMigrated, 'old library copy');
  await fs.writeFile(newMigrated, 'new library copy');
  await fs.utimes(oldMigrated, old, old);

  // 隔离的数据库副本：超 30 天的可清，未超期的必须保留
  const oldQuarantine = path.join(env.libraryDir, 'litboard.sqlite.corrupt-' + (Date.now() - 90 * 86400000) + '-1-abcdef');
  const freshQuarantine = path.join(env.libraryDir, 'litboard.sqlite.before-restore-' + Date.now() + '-1-abcdef');
  await fs.writeFile(oldQuarantine, 'old corrupt copy');
  await fs.writeFile(freshQuarantine, 'recent quarantine');
  await fs.utimes(oldQuarantine, old, old);

  const objectsBefore = await fs.readdir(path.join(env.backupDir, 'objects'));

  const scan = await env.manager.scanLeftovers();
  const names = scan.items.map(function (item) { return item.name; });
  const has = function (target) { return names.indexOf(path.basename(target)) !== -1; };
  assert.ok(has(orphan), '库内无引用的恢复目录应被列出');
  assert.ok(!has(referenced), '仍被引用的恢复目录不应被列出');
  assert.ok(has(previous), '过期的 .previous-* 应被列出');
  assert.ok(has(staleStaging), '陈旧的 .staging-* 应被列出');
  assert.ok(!has(freshStaging), '新建的 .staging-* 不应被列出');
  assert.ok(has(oldMigrated), '旧的迁移副本应被列出');
  assert.ok(!has(newMigrated), '最新的迁移副本应保留');
  assert.ok(has(oldQuarantine), '超过 30 天的隔离副本应被列出');
  assert.ok(!has(freshQuarantine), '未超期的隔离副本必须保留');
  assert.equal(scan.categories.quarantineDb.count, 1);
  assert.equal(scan.items.filter(function (item) { return item.danger; }).length, 1);
  assert.ok(scan.totalBytes > 0);

  const result = await env.manager.cleanLeftovers();
  assert.equal(result.ok, true);
  assert.equal(result.removed, scan.items.length);
  assert.deepEqual(result.failed, []);

  await assert.rejects(fs.stat(orphan));
  await assert.rejects(fs.stat(oldQuarantine));
  await assert.rejects(fs.stat(oldMigrated));
  // 该留的一个都不能少：引用中的附件、最新迁移副本、未超期隔离件、进行中的暂存、当前库与快照
  await fs.stat(referenced);
  await fs.stat(newMigrated);
  await fs.stat(freshQuarantine);
  await fs.stat(freshStaging);
  await fs.stat(path.join(env.libraryDir, 'litboard.sqlite'));
  assert.equal((await env.manager.listSnapshots()).length, 1);
  assert.deepEqual(await fs.readdir(path.join(env.backupDir, 'objects')), objectsBefore);
});

test('leftover cleanup skips reference-based categories when the database is unreadable', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  const restoredRoot = path.join(env.configDir, 'restored-assets');
  const candidate = path.join(restoredRoot, '20200101-000000-aaaaaa');
  await fs.mkdir(candidate, { recursive: true });
  // 库不可读（未打开）→ 不允许依据引用关系删任何恢复附件目录
  const offline = createBackupManager({
    libraryDir: env.libraryDir, configDir: env.configDir,
    dataPathManager: env.dataPathManager,
    getDb: function () { return null; }
  });
  const scan = await offline.scanLeftovers();
  assert.equal(scan.items.some(function (item) { return item.category === 'orphanRestored'; }), false);
  assert.match(scan.skipped.join('；'), /数据库不可读/);
  await fs.stat(candidate); // 目录仍在
  const cleaned = await offline.cleanLeftovers();
  assert.equal(cleaned.removed, 0);
  await fs.stat(candidate);
});

test('legacy .bak throttle no longer writes into the database', async function (t) {
  const env = await makeEnv(t);
  await env.db.saveState({ papers: [{ id: 'p1', title: 'Stamp' }] });

  assert.equal(await env.db.backupIfDue(true), true);
  const stamp = path.join(env.libraryDir, 'litboard.sqlite.bak.stamp');
  assert.ok(Number(await fs.readFile(stamp, 'utf8')) > 0);
  const before = sha256(await fs.readFile(path.join(env.libraryDir, 'litboard.sqlite')));

  assert.equal(await env.db.backupIfDue(true), true);
  const after = sha256(await fs.readFile(path.join(env.libraryDir, 'litboard.sqlite')));
  assert.equal(after, before, '备份节流不应再改动数据库文件');
  assert.equal(await env.db.getSetting('lastBackupAt'), null);
  assert.equal(await env.db.backupIfDue(false), false);
});
async function seedNoteAssetsAndSnapshotDir(db, configDir) {
  const noteImg = path.join(configDir, 'note-assets', 'n1', 'img.png');
  await fs.mkdir(path.dirname(noteImg), { recursive: true });
  await fs.writeFile(noteImg, 'NOTE-IMAGE-CONTENT', 'utf8');
  const snapDir = path.join(configDir, 'synced-attachments', 'snapdir1');
  await fs.mkdir(path.join(snapDir, 'sub'), { recursive: true });
  await fs.writeFile(path.join(snapDir, 'page.html'), '<html>page</html>', 'utf8');
  await fs.writeFile(path.join(snapDir, 'sub', 'style.css'), 'body { margin: 0; }', 'utf8');
  await db.saveState({
    papers: [{ id: 'p1', title: 'With Snapshot Dir', attachments: [
      { id: 'snap1', kind: 'snapshot', fileName: 'snapdir1', path: snapDir }
    ] }],
    notes: [{ id: 'n1', paperId: '', title: 'Topic note', content: 'has image',
      createdAt: 1, updatedAt: 1,
      assets: [{ fileName: 'img.png', path: noteImg }] }]
  });
  return { noteImg, snapDir };
}

test('backup includes note assets and snapshot attachment directory files', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  await seedNoteAssetsAndSnapshotDir(env.db, env.configDir);
  const result = await env.manager.createSnapshot();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.assets, 3); // 快照目录 2 个文件 + 笔记资产 1 个

  const manifest = JSON.parse(await fs.readFile(
    path.join(env.backupDir, 'snapshots', result.snapshotId, 'manifest.json'), 'utf8'));
  const noteEntry = manifest.assets.find(function (a) { return a.kind === 'note'; });
  assert.ok(noteEntry, 'manifest 应包含笔记资产条目');
  assert.equal(noteEntry.paperId, '_notes');
  assert.equal(noteEntry.itemId, 'n1-0');
  assert.equal(noteEntry.noteId, 'n1');
  assert.equal(noteEntry.assetIndex, 0);
  assert.equal(noteEntry.archivePath.indexOf('assets/_notes/n1-0-'), 0);

  const snapEntries = manifest.assets.filter(function (a) {
    return a.kind === 'attachment' && a.subKind === 'snapshot';
  });
  assert.equal(snapEntries.length, 2);
  assert.deepEqual(
    snapEntries.map(function (a) { return a.relPath; }).sort(),
    ['page.html', 'sub/style.css'].sort());
  snapEntries.forEach(function (a) {
    assert.equal(a.paperId, 'p1');
    assert.equal(a.itemId, 'snap1');
    assert.equal(a.archivePath.indexOf('assets/p1/snap1/'), 0);
  });
});

test('restore rewrites note asset and snapshot directory paths into restored-assets', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  const seeded = await seedNoteAssetsAndSnapshotDir(env.db, env.configDir);
  const snapshot = await env.manager.createSnapshot();
  assert.equal(snapshot.ok, true, snapshot.error);
  const noteImgBytes = await fs.readFile(seeded.noteImg);
  const pageBytes = await fs.readFile(path.join(seeded.snapDir, 'page.html'));
  const cssBytes = await fs.readFile(path.join(seeded.snapDir, 'sub', 'style.css'));
  await env.db.close();

  const restored = await env.manager.restoreSnapshot({ snapshotId: snapshot.snapshotId, quarantineTag: 'before-restore' });
  assert.equal(restored.ok, true, restored.error);
  const restoreRoot = path.join(env.configDir, 'restored-assets', snapshot.snapshotId);

  const db2 = createLibraryDb(env.libraryDir);
  await db2.open();
  const state = await db2.loadState();
  const snapAtt = state.papers[0].attachments.find(function (a) { return a.id === 'snap1'; });
  assert.equal(snapAtt.path, path.join(restoreRoot, 'assets', 'p1', 'snap1'));
  assert.deepEqual(await fs.readFile(path.join(snapAtt.path, 'page.html')), pageBytes);
  assert.deepEqual(await fs.readFile(path.join(snapAtt.path, 'sub', 'style.css')), cssBytes);
  const note = state.notes.find(function (n) { return n.id === 'n1'; });
  assert.equal(note.assets.length, 1);
  assert.equal(note.assets[0].path.indexOf(restoreRoot), 0);
  assert.deepEqual(await fs.readFile(note.assets[0].path), noteImgBytes);
  await db2.close();
});

test('leftover scan keeps restored dirs referenced via note assets or snapshot directories', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  const restoredRoot = path.join(env.configDir, 'restored-assets');
  const snapRef = path.join(restoredRoot, '20200101-000000-snap01', 'assets', 'p1', 'snapdir');
  await fs.mkdir(snapRef, { recursive: true });
  await fs.writeFile(path.join(snapRef, 'page.html'), 'x');
  const noteRef = path.join(restoredRoot, '20200102-000000-note01', 'assets', '_notes');
  await fs.mkdir(noteRef, { recursive: true });
  const noteImg = path.join(noteRef, 'n1-0-img.png');
  await fs.writeFile(noteImg, 'y');
  const orphan = path.join(restoredRoot, '20200103-000000-orph01');
  await fs.mkdir(orphan, { recursive: true });
  await fs.writeFile(path.join(orphan, 'old.pdf'), 'OLD');
  await env.db.saveState({
    papers: [{ id: 'p1', title: 'T', attachments: [
      { id: 's1', kind: 'snapshot', fileName: 'snapdir', path: snapRef }
    ] }],
    notes: [{ id: 'n1', paperId: '', content: 'n', createdAt: 1, updatedAt: 1,
      assets: [{ fileName: 'img.png', path: noteImg }] }]
  });

  const scan = await env.manager.scanLeftovers();
  const names = scan.items.map(function (item) { return item.name; });
  assert.ok(names.indexOf('20200103-000000-orph01') !== -1, '库内无引用的恢复目录应被列出');
  assert.ok(names.indexOf('20200101-000000-snap01') === -1, '快照目录引用的恢复目录不应被列出');
  assert.ok(names.indexOf('20200102-000000-note01') === -1, '笔记资产引用的恢复目录不应被列出');
});

test('rotation prunes hash-cache entries no longer referenced by surviving snapshots', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  env.dataPathManager.stageBackupKeep(1);

  // 第一份快照引用 fileA：hash-cache 里出现 fileA 的条目
  const fileA = path.join(env.configDir, 'synced-attachments', 'zOLD0001.pdf');
  await fs.mkdir(path.dirname(fileA), { recursive: true });
  await fs.writeFile(fileA, 'CONTENT-A', 'utf8');
  await env.db.saveState({ papers: [{ id: 'p1', title: 'A', attachments: [
    { id: 'a1', kind: 'pdf', fileName: 'old.pdf', path: fileA }] }] });
  const first = await env.manager.createSnapshot();
  assert.equal(first.ok, true, first.error);
  const cacheFile = path.join(env.backupDir, 'hash-cache.json');
  const cacheWithA = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  const shaA = Object.values(cacheWithA.files)[0].sha256;

  // 整库替换为 p2（硬删 p1）：新快照发布后轮换丢掉第一份，fileA 的哈希不再被引用
  const fileB = path.join(env.configDir, 'synced-attachments', 'zNEW0002.pdf');
  await fs.writeFile(fileB, 'CONTENT-B', 'utf8');
  await env.db.replaceState({ papers: [{ id: 'p2', title: 'B', attachments: [
    { id: 'b1', kind: 'pdf', fileName: 'new.pdf', path: fileB }] }] });
  const second = await env.manager.createSnapshot();
  assert.equal(second.ok, true, second.error);

  const cache = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  const entries = Object.values(cache.files);
  assert.equal(entries.length, 1, '裁剪后只剩仍被引用的一条');
  const manifestB = JSON.parse(await fs.readFile(
    path.join(env.backupDir, 'snapshots', second.snapshotId, 'manifest.json'), 'utf8'));
  assert.equal(entries[0].sha256, manifestB.assets[0].hash);
  assert.ok(entries[0].sha256 !== shaA);
});

test('managed orphan files and stale .litbak backups are scanned and cleaned', async function (t) {
  const env = await makeEnv(t);
  env.dataPathManager.stageBackupDir(env.backupDir);
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const syncedDir = path.join(env.configDir, 'synced-attachments');
  await fs.mkdir(syncedDir, { recursive: true });

  // 被库引用的受管文件 + 墓碑条目引用的受管文件：必须保留
  const livePdf = path.join(syncedDir, 'zLIVE0001.pdf');
  await fs.writeFile(livePdf, 'LIVE', 'utf8');
  const tombPdf = path.join(syncedDir, 'zTOMB0002.pdf');
  await fs.writeFile(tombPdf, 'TOMB', 'utf8');
  const nestedLive = path.join(syncedDir, 'items', 'p1', 'zLIVE0003.pdf');
  await fs.mkdir(path.dirname(nestedLive), { recursive: true });
  await fs.writeFile(nestedLive, 'NESTED-LIVE', 'utf8');
  await env.db.saveState({ papers: [
    { id: 'p1', title: 'Live', attachments: [
      { id: 'a1', kind: 'pdf', fileName: 'live.pdf', path: livePdf },
      { id: 'a3', kind: 'pdf', fileName: 'nested.pdf', path: nestedLive }
    ] },
    { id: 'p2', title: 'Tomb', deletedAt: Date.now(),
      attachments: [{ id: 'a2', kind: 'pdf', fileName: 'tomb.pdf', path: tombPdf }] }
  ] });

  // 孤儿（已陈旧）：z 键文件、.litwrite 残留、批注截图、笔记图片、下载快照目录
  const orphanPdf = path.join(syncedDir, 'zORPH0003.pdf');
  await fs.writeFile(orphanPdf, 'ORPHAN', 'utf8');
  await fs.utimes(orphanPdf, old, old);
  const nestedOrphan = path.join(syncedDir, 'items', 'p1', 'zORPH0004.pdf');
  await fs.writeFile(nestedOrphan, 'NESTED-ORPHAN', 'utf8');
  await fs.utimes(nestedOrphan, old, old);
  const litwrite = path.join(syncedDir, 'zORPH0003.pdf.litwrite');
  await fs.writeFile(litwrite, 'PARTIAL', 'utf8');
  await fs.utimes(litwrite, old, old);
  const freshOrphan = path.join(syncedDir, 'zFRESH0004.pdf');
  await fs.writeFile(freshOrphan, 'FRESH', 'utf8');
  const orphanImg = path.join(env.configDir, 'annotation-images', 'orphan-ann.png');
  await fs.mkdir(path.dirname(orphanImg), { recursive: true });
  await fs.writeFile(orphanImg, 'IMG', 'utf8');
  await fs.utimes(orphanImg, old, old);
  const orphanNote = path.join(env.configDir, 'note-assets', 'nGone', 'img.png');
  await fs.mkdir(path.dirname(orphanNote), { recursive: true });
  await fs.writeFile(orphanNote, 'NOTE', 'utf8');
  await fs.utimes(orphanNote, old, old);
  const orphanSnapDir = path.join(syncedDir, 'pGone.attGone.snapshot');
  await fs.mkdir(orphanSnapDir, { recursive: true });
  await fs.writeFile(path.join(orphanSnapDir, 'index.html'), 'SNAP', 'utf8');
  await fs.utimes(orphanSnapDir, old, old);
  // 非受管命名的散落文件：即使陈旧也不碰
  const stranger = path.join(syncedDir, 'readme.txt');
  await fs.writeFile(stranger, 'hello', 'utf8');
  await fs.utimes(stranger, old, old);

  // .litbak：陈旧的可清（danger 类），新鲜的必须保留
  const staleBak = path.join(syncedDir, 'zBAKX0009.pdf.litbak');
  await fs.writeFile(staleBak, 'OLD BAK', 'utf8');
  await fs.utimes(staleBak, old, old);
  const freshBak = path.join(syncedDir, 'zBAKY0010.pdf.litbak');
  await fs.writeFile(freshBak, 'FRESH BAK', 'utf8');

  const scan = await env.manager.scanLeftovers();
  const byPath = {};
  scan.items.forEach(function (item) { byPath[item.path] = item; });
  assert.ok(byPath[orphanPdf] && byPath[orphanPdf].category === 'orphanManaged', '孤儿 z 键文件应被列出');
  assert.ok(byPath[nestedOrphan] && byPath[nestedOrphan].category === 'orphanManaged', '条目目录内的孤儿 z 键文件应被列出');
  assert.ok(byPath[litwrite] && byPath[litwrite].category === 'orphanManaged', '.litwrite 残留应被列出');
  assert.ok(byPath[orphanImg] && byPath[orphanImg].category === 'orphanManaged', '孤儿批注截图应被列出');
  assert.ok(byPath[orphanNote] && byPath[orphanNote].category === 'orphanManaged', '孤儿笔记图片应被列出');
  assert.ok(byPath[orphanSnapDir] && byPath[orphanSnapDir].category === 'orphanManaged', '孤儿下载快照目录应被列出');
  assert.ok(!byPath[freshOrphan], '未到 7 天的孤儿不应被列出');
  assert.ok(!byPath[livePdf], '被库引用的文件不应被列出');
  assert.ok(!byPath[nestedLive], '条目目录内仍被引用的附件不应被列出');
  assert.ok(!byPath[tombPdf], '墓碑条目引用的文件不应被列出（回收站语义）');
  assert.ok(!byPath[stranger], '非受管命名的文件不应被列出');
  assert.ok(byPath[staleBak] && byPath[staleBak].category === 'writeBackups', '陈旧 .litbak 应被列出');
  assert.equal(byPath[staleBak].danger, true, '.litbak 属危险类别');
  assert.ok(!byPath[freshBak], '未到 30 天的 .litbak 不应被列出');

  const result = await env.manager.cleanLeftovers();
  assert.equal(result.ok, true, JSON.stringify(result.failed));
  await assert.rejects(fs.stat(orphanPdf));
  await assert.rejects(fs.stat(nestedOrphan));
  await assert.rejects(fs.stat(litwrite));
  await assert.rejects(fs.stat(orphanImg));
  await assert.rejects(fs.stat(orphanNote));
  await assert.rejects(fs.stat(orphanSnapDir));
  await assert.rejects(fs.stat(staleBak));
  await fs.stat(livePdf);
  await fs.stat(nestedLive);
  await fs.stat(tombPdf);
  await fs.stat(freshOrphan);
  await fs.stat(stranger);
  await fs.stat(freshBak);
});
