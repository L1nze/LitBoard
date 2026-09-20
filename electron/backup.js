'use strict';

/**
 * LitBoard 完整备份管理（主进程专用）。
 *
 * 布局（用户选择的独立备份根目录）：
 *   <backupDir>/objects/<hh>/<sha256>        内容寻址资产仓：同一文件跨快照只存一份
 *   <backupDir>/snapshots/<snapshotId>/      轻量快照：library.sqlite.gz + manifest.json
 *   <backupDir>/hash-cache.json              按 (路径,大小,mtime) 缓存资产哈希，加速每日快照
 *
 * 快照清单 manifest.json（version 2）：
 *   { version, snapshotId, createdAt,
 *     database: { file, size, sha256, dbSize, dbSha256 },
 *     assets: [{ paperId, itemId, kind, subKind, name, hash, size, archivePath }] }
 *
 * 保证：
 * - 快照先写入 .staging-<id> 临时目录，完成数据库与全部资产校验后才原子改名发布；
 * - 任一引用资源读取失败/哈希不匹配 → 不发布该备份，返回缺失清单，旧快照保留；
 * - 最多保留最近 keepLimit() 份成功快照（默认 7，可在设置里改，1–30）；内容与最近一份完全相同时
 *   不发布重复快照，把轮换位留给真正不同的状态；清理旧快照后只删除不再被任何保留快照引用的对象；
 * - 列表默认只读 manifest（便宜）；深度校验（解压 + 完整性检查 + 逐个附件哈希）只在恢复流程或显式
 *   传 { verify: true } 时进行 —— 否则光看一眼状态就要把 7 份快照的全部附件重读一遍。
 * - 快照数据库中剥离浏览器扩展令牌（bridgeToken）；integrations.json 凭据从不进入备份；
 * - 恢复时：验证 manifest 与全部哈希 → 原库改名 *.corrupt-* 保留 → 临时位置还原验证 →
 *   资产落入受管 restored-assets/<snapshotId>/ 并重写库内路径 → 替换工作库 → 重新打开验证。
 */
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { DatabaseSync } = require('node:sqlite');
const LitModel = require('../js/model.js');
const { hashEntity } = require('./db.js');

const MANIFEST_VERSION = 2;
const LEGACY_MANIFEST_VERSION = 1;
// 保留份数默认 7，可在「设置 → 完整备份」里改（1–30）。只影响轮换上限，本身不删除任何文件。
const DEFAULT_KEEP_SNAPSHOTS = 7;
const MIN_KEEP_SNAPSHOTS = 1;
const MAX_KEEP_SNAPSHOTS = 30;
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DB_FILE_GZ = 'library.sqlite.gz';

// 遗留文件清理的门槛。原则：只清理「可证明无用」的东西，对可能仍有价值的一律加年龄门槛。
const STAGING_STALE_MS = 24 * 60 * 60 * 1000;        // 崩溃残留的备份暂存目录
const RESTORE_LEFTOVER_MS = 24 * 60 * 60 * 1000;      // .previous-* / .tmp-* 恢复残留
const QUARANTINE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;  // 隔离的数据库副本：30 天内一律保留
const ORPHAN_MANAGED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;  // 受管孤儿文件：7 天内保留（避开多端同步窗口）
const WRITE_BACKUP_KEEP_MS = 30 * 24 * 60 * 60 * 1000;   // .litbak 写回留底：30 天内一律保留

const LEFTOVER_LABELS = {
  staging: '崩溃残留的备份暂存目录',
  previousAssets: '恢复后保留的上一代附件目录',
  tempAssets: '恢复中断留下的临时附件目录',
  orphanRestored: '库内已不再引用的恢复附件目录',
  prePathChange: '迁移数据目录时留下的旧库副本（保留最新一份）',
  quarantineDb: '已隔离的数据库副本（损坏 / 恢复前）',
  orphanManaged: '库已不再引用的受管附件文件',
  writeBackups: '批注写回前的 .litbak 留底'
};

/** 有界并发遍历：结果按输入顺序落位（与串行版完全一致），worker 抛错即整体 reject。
 *  备份的哈希/复制/校验都是独立资产的 I/O，4 路并发即可吃满磁盘队列而不压垮低速存储。 */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let r = 0; r < n; r++) {
    runners.push((async function () {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(items[i], i);
      }
    })());
  }
  await Promise.all(runners);
  return out;
}

async function sha256File(filePath) {
  return new Promise(function (resolve, reject) {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', function (chunk) { hash.update(chunk); });
    stream.on('error', reject);
    stream.on('end', function () { resolve(hash.digest('hex')); });
  });
}

/**
 * 把校验过的临时文件发布为内容寻址对象（temp → objects/<hash>）。
 *
 * 同内容资产的并发暂存会争抢同一个 target：Windows 上 rename 覆盖「刚被另一路写入」
 * 或「被杀毒扫描占着句柄」的目标会抛 EPERM/EBUSY/EEXIST——**这不是备份失败**，
 * 对象其实已经就位。此时复核 target 哈希，一致即视为成功（丢弃临时文件）；
 * 不一致就短暂退避重试，重试用尽才如实报错。
 *
 * 曾因此把「两个文献引用同一个 PDF」的备份整份判失败（missing 一条 → 不发布快照），
 * 且只在并发竞态下偶发：测试表现为 createSnapshot 偶发 ok:false。
 */
async function publishObject(temp, target, hash) {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fs.rename(temp, target);
      return;
    } catch (error) {
      const code = error && error.code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EEXIST') throw error;
      try {
        if ((await sha256File(target)) === hash) {
          await fs.rm(temp, { force: true }).catch(function () {});
          return;
        }
      } catch (inner) { /* 目标还读不了（对方仍在写）：退避后重试 */ }
      await new Promise(function (resolve) { setTimeout(resolve, 20 * (attempt + 1)); });
    }
  }
  throw new Error('对象仓写入失败：目标被占用且内容不一致（' + target + '）');
}

/**
 * 流式 SHA-256 Transform：插入 pipeline 边转发边算哈希，
 * pipeline resolve 后调 digestHex() 取值 —— 大文件不再整段进内存。
 */
function sha256Stream() {
  const hash = crypto.createHash('sha256');
  const transform = new Transform({
    transform: function (chunk, _enc, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  transform.digestHex = function () { return hash.digest('hex'); };
  return transform;
}

function safeFileName(name) {
  // Windows 非法字符与控制字符统一替换为下划线
  const clean = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return clean.slice(0, 120) || 'file';
}

function newSnapshotId() {
  const now = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) +
    '-' + crypto.randomBytes(3).toString('hex');
}

function newRestoreToken() {
  return Date.now() + '-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
}

function createBackupManager(options) {
  const libraryDir = options.libraryDir;
  const configDir = options.configDir;
  const dataPathManager = options.dataPathManager || null;
  const getDb = options.getDb || function () { return null; };
  const dbFile = path.join(libraryDir, 'litboard.sqlite');

  function configuredDir() {
    if (!dataPathManager) return '';
    const state = dataPathManager.getState();
    return state && state.backupDir ? String(state.backupDir) : '';
  }

  /** 有效保留份数：用户设置过就用用户的，否则用默认值（非法值一律回落到默认） */
  function keepLimit() {
    const state = dataPathManager ? dataPathManager.getState() : null;
    const raw = state ? Number(state.backupKeep) : NaN;
    if (!Number.isFinite(raw) || raw < MIN_KEEP_SNAPSHOTS) return DEFAULT_KEEP_SNAPSHOTS;
    return Math.min(MAX_KEEP_SNAPSHOTS, Math.round(raw));
  }

  function objectsDir(root) { return path.join(root, 'objects'); }
  function snapshotsDir(root) { return path.join(root, 'snapshots'); }
  function objectPath(root, hash) { return path.join(objectsDir(root), hash.slice(0, 2), hash); }

  async function pathExists(target) {
    try {
      await fs.access(target);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function readJson(file) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { return null; }
  }

  async function writeJsonAtomic(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.tmp-' + process.pid + '-' + Date.now();
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    try {
      await fs.rename(temp, file);
    } catch (error) {
      await fs.copyFile(temp, file);
      await fs.rm(temp, { force: true });
    }
  }

  async function loadHashCache(root) {
    const cache = await readJson(path.join(root, 'hash-cache.json'));
    return cache && typeof cache === 'object' && cache.files ? cache : { files: {} };
  }

  async function hashAsset(root, asset, cache) {
    const stat = await fs.stat(asset.path);
    if (!stat.isFile()) throw new Error('不是常规文件');
    const key = process.platform === 'win32' ? path.resolve(asset.path).toLowerCase() : path.resolve(asset.path);
    const hit = cache.files[key];
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.sha256;
    const sha256 = await sha256File(asset.path);
    cache.files[key] = { size: stat.size, mtimeMs: stat.mtimeMs, sha256: sha256 };
    cache.dirty = true;
    return sha256;
  }

  /** 递归枚举快照目录（网页快照 attachment 的 path 是目录）；超限额直接抛错，不生成不完整备份 */
  async function walkAssetDir(dir) {
    const MAX_FILES = 2000, MAX_BYTES = 500 * 1024 * 1024;
    const out = [];
    let totalBytes = 0;
    async function walk(current, prefix) {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        const rel = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory()) { await walk(abs, rel); continue; }
        if (!entry.isFile()) continue;
        const stat = await fs.stat(abs);
        totalBytes += stat.size;
        out.push({ abs: abs, rel: rel });
        if (out.length > MAX_FILES || totalBytes > MAX_BYTES) {
          throw new Error('快照目录过大（>' + MAX_FILES + ' 个文件或 >500MB）：' + dir);
        }
      }
    }
    await walk(dir, '');
    return out;
  }

  /** 从当前库收集需要备份的本地资源（托管/外部附件 + 批注截图 + 笔记资产 + 快照目录） */
  async function collectAssets() {
    const db = getDb();
    if (!db) throw new Error('数据库未打开');
    const state = await db.loadState();
    const assets = [];
    for (const paper of state.papers) {
      for (const att of (paper.attachments || [])) {
        if (!att || !att.path) continue;
        if (att.kind === 'snapshot') {
          // 快照的 path 是目录：逐文件入 manifest，relPath 保留目录内相对结构
          let files = [];
          try { files = await walkAssetDir(att.path); } catch (error) {
            if (error && error.code === 'ENOENT') continue; // 目录缺失等同附件缺失，不阻断备份
            throw error;
          }
          files.forEach(function (file) {
            assets.push({
              paperId: paper.id, itemId: att.id, kind: 'attachment', subKind: 'snapshot',
              name: file.rel, path: file.abs, relPath: file.rel
            });
          });
          continue;
        }
        assets.push({
          paperId: paper.id, itemId: att.id, kind: 'attachment', subKind: att.kind || 'other',
          name: att.fileName || path.basename(att.path), path: att.path
        });
      }
      (paper.pdfAnnotations || []).forEach(function (ann) {
        if (!ann || ann.type !== 'snapshot' || !ann.imagePath) return;
        assets.push({
          paperId: paper.id, itemId: ann.id, kind: 'annotation', subKind: 'snapshot',
          name: path.basename(ann.imagePath), path: ann.imagePath
        });
      });
    }
    (state.notes || []).forEach(function (note) {
      (note.assets || []).forEach(function (asset, index) {
        if (!asset || !asset.path) return;
        assets.push({
          paperId: '_notes', itemId: note.id + '-' + index, kind: 'note', subKind: 'image',
          name: asset.fileName || path.basename(asset.path), path: asset.path,
          noteId: note.id, assetIndex: index
        });
      });
    });
    return assets;
  }

  /** 生成数据库快照（剥离扩展令牌），gzip 后写入 staging，返回度量信息 */
  async function stageDatabase(stagingDir) {
    const db = getDb();
    if (!db) throw new Error('数据库未打开');
    const rawSnapshot = path.join(stagingDir, 'library.sqlite');
    await db.snapshotTo(rawSnapshot);
    // 剥离浏览器扩展令牌：恢复后需重新生成并配置扩展
    const snapshotDb = new DatabaseSync(rawSnapshot);
    try {
      snapshotDb.exec("DELETE FROM settings WHERE key = 'bridgeToken'");
      snapshotDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const check = snapshotDb.prepare('PRAGMA integrity_check').get();
      if (!check || Object.values(check)[0] !== 'ok') throw new Error('数据库快照完整性检查失败');
    } finally {
      try { snapshotDb.close(); } catch (error) {}
    }
    await fs.rm(rawSnapshot + '-wal', { force: true }).catch(function () {});
    await fs.rm(rawSnapshot + '-shm', { force: true }).catch(function () {});
    // 流式 gzip（管线内顺带算 raw 哈希）：不把整库读进内存、不阻塞主进程事件循环。
    // level 3：数据库字节熵高，更高压缩等级体积几乎无收益、CPU 显著变贵。
    const rawHasher = sha256Stream();
    const gzFile = path.join(stagingDir, DB_FILE_GZ);
    await pipeline(
      fsSync.createReadStream(rawSnapshot),
      rawHasher,
      zlib.createGzip({ level: 3 }),
      fsSync.createWriteStream(gzFile)
    );
    const rawStat = await fs.stat(rawSnapshot);
    await fs.rm(rawSnapshot, { force: true });
    return {
      file: DB_FILE_GZ, size: (await fs.stat(gzFile)).size, sha256: await sha256File(gzFile),
      dbSize: rawStat.size, dbSha256: rawHasher.digestHex()
    };
  }

  /** 把单个资产纳入对象仓（已存在则跳过），返回 manifest 条目 */
  let stageTempSeq = 0;
  async function stageAsset(root, asset, cache) {
    const hash = await hashAsset(root, asset, cache);
    const target = objectPath(root, hash);
    try {
      await fs.access(target);
    } catch (error) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      // 临时名必须唯一：同内容哈希的多个资产会指向同一 target，并发暂存时
      // 固定后缀会让彼此截断对方的临时文件，触发「写入对象仓后哈希不匹配」
      const temp = target + '.tmp-' + process.pid + '-' + (++stageTempSeq);
      await fs.copyFile(asset.path, temp);
      // 写完复核哈希，校验通过才原子改名
      const verify = await sha256File(temp);
      if (verify !== hash) {
        await fs.rm(temp, { force: true });
        throw new Error('写入对象仓后哈希不匹配');
      }
      // 发布到内容寻址路径：同内容资产并发争抢同一 target 时容忍 Windows 的 EPERM
      await publishObject(temp, target, hash);
    }
    const stat = await fs.stat(asset.path);
    const archivePath = asset.relPath
      ? 'assets/' + asset.paperId + '/' + asset.itemId + '/' +
        String(asset.relPath).split(/[\\/]/).map(safeFileName).join('/')
      : 'assets/' + asset.paperId + '/' + asset.itemId + '-' + safeFileName(asset.name);
    return {
      paperId: asset.paperId, itemId: asset.itemId, kind: asset.kind, subKind: asset.subKind,
      name: asset.name, hash: hash, size: stat.size, archivePath: archivePath,
      relPath: asset.relPath || '', noteId: asset.noteId || '',
      assetIndex: asset.assetIndex == null ? null : asset.assetIndex
    };
  }

  /**
   * 与指定快照逐字节比对：数据库内容与附件集合都没变 → true。
   * 只读 manifest，不产生任何额外 I/O。旧 manifest 缺 dbSha256 时一律返回 false
   * （宁可多存一份，也不因为信息缺失而漏掉一次备份）。
   */
  async function isSameContentAs(root, snapshotId, database, entries) {
    const manifest = await readJson(path.join(snapshotsDir(root), snapshotId, 'manifest.json'));
    if (!manifest || !manifest.database) return false;
    if (!manifest.database.dbSha256 || manifest.database.dbSha256 !== database.dbSha256) return false;
    const key = function (asset) { return asset.paperId + '/' + asset.itemId + '/' + asset.hash; };
    const previous = (manifest.assets || []).map(key).sort();
    const current = entries.map(key).sort();
    if (previous.length !== current.length) return false;
    for (let i = 0; i < current.length; i++) {
      if (previous[i] !== current[i]) return false;
    }
    return true;
  }

  /** 创建一份完整快照。失败时不发布半成品，旧快照保留。 */
  async function createSnapshot(backupDirOverride, createOptions) {
    const options = createOptions || (backupDirOverride && typeof backupDirOverride === 'object' ? backupDirOverride : {});
    const root = typeof backupDirOverride === 'string' ? backupDirOverride : options.backupDirOverride || configuredDir();
    if (!root) return { ok: false, unconfigured: true, error: '尚未配置备份目录' };
    await fs.mkdir(snapshotsDir(root), { recursive: true });
    await fs.mkdir(objectsDir(root), { recursive: true });
    const snapshotId = newSnapshotId();
    const staging = path.join(root, '.staging-' + snapshotId);
    const missing = [];
    try {
      await fs.mkdir(staging, { recursive: true });
      const database = await stageDatabase(staging);
      // M9 二期：身份核（调研库不可重建部分的小体积镜像，~1-2MB；恢复=空库导入+后台重拉元数据）
      let researchIdentity = null;
      if (typeof options.getResearchIdentity === 'function') {
        try {
          const core = await options.getResearchIdentity();
          if (core && core.works && core.works.length) {
            const identityFile = path.join(staging, 'research-identity.json');
            await writeJsonAtomic(identityFile, core);
            researchIdentity = {
              file: 'research-identity.json',
              works: core.works.length,
              bytes: (await fs.stat(identityFile)).size
            };
          }
        } catch (error) {
          // 身份核是增强项：导出失败不阻断备份
        }
      }
      const assets = await collectAssets();
      const cache = await loadHashCache(root);
      // 资产互不依赖：4 路并发暂存（哈希缓存按路径分键，无共享写冲突）；
      // 结果按输入顺序回填 entries/missing，manifest 顺序与串行版一致
      const staged = await mapLimit(assets, 4, async function (asset) {
        try {
          return { entry: await stageAsset(root, asset, cache) };
        } catch (error) {
          return {
            missing: {
              paperId: asset.paperId, itemId: asset.itemId, path: asset.path,
              reason: String(error && error.message || error)
            }
          };
        }
      });
      const entries = [];
      for (const row of staged) {
        if (row.entry) entries.push(row.entry);
        else missing.push(row.missing);
      }
      if (cache.dirty) await writeJsonAtomic(path.join(root, 'hash-cache.json'), cache);
      if (missing.length) {
        await fs.rm(staging, { recursive: true, force: true }).catch(function () {});
        return { ok: false, missing: missing, error: '有 ' + missing.length + ' 个引用资源无法读取，未发布备份' };
      }
      const manifest = {
        version: MANIFEST_VERSION,
        snapshotId: snapshotId,
        createdAt: new Date().toISOString(),
        database: database,
        assets: entries
      };
      if (researchIdentity) manifest.researchIdentity = researchIdentity;
      await writeJsonAtomic(path.join(staging, 'manifest.json'), manifest);
      // 发布前最终校验：gunzip + 完整性 + 哈希（staging 直接在根目录下，对象仓根须显式传入）
      const check = await verifySnapshotDir(staging, root);
      if (!check.valid) {
        await fs.rm(staging, { recursive: true, force: true }).catch(function () {});
        return { ok: false, error: '快照校验失败：' + check.error };
      }
      // 与最近一份快照逐字节相同（数据库 + 附件集合）→ 不发布重复快照。
      // 恢复前的紧急快照传 skipIfUnchanged: false，保证「先备份当前库」永远真的落盘。
      if (options.skipIfUnchanged !== false) {
        const latest = (await listSnapshots(root))[0];
        if (latest && latest.valid && await isSameContentAs(root, latest.id, database, entries)) {
          await fs.rm(staging, { recursive: true, force: true }).catch(function () {});
          if (dataPathManager) dataPathManager.markBackupSuccess(Date.now(), latest.id);
          return {
            ok: true, skipped: true, unchanged: true, snapshotId: latest.id,
            createdAt: latest.createdAt, assets: entries.length,
            dbBytes: database.dbSize, gzBytes: database.size,
            prunedSnapshots: 0, prunedObjects: 0
          };
        }
      }
      const finalDir = path.join(snapshotsDir(root), snapshotId);
      await fs.rename(staging, finalDir);
      if (dataPathManager) dataPathManager.markBackupSuccess(Date.now(), snapshotId);
      const rotation = options.skipRotation
        ? { prunedSnapshots: 0, prunedObjects: 0 }
        : await rotateAndCollectGarbage(root);
      return {
        ok: true, snapshotId: snapshotId, createdAt: manifest.createdAt,
        assets: entries.length, dbBytes: database.dbSize, gzBytes: database.size,
        prunedSnapshots: rotation.prunedSnapshots, prunedObjects: rotation.prunedObjects
      };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(function () {});
      return { ok: false, error: String(error && error.message || error) };
    }
  }

  /** 距离上次成功超过 24h 才自动备份 */
  async function maybeAutoBackup() {
    if (!dataPathManager) return { ok: false, skipped: true };
    const state = dataPathManager.getState();
    if (!state || !state.backupDir) return { ok: false, skipped: true };
    const last = Number(state.backupLastAt) || 0;
    if (Date.now() - last < AUTO_INTERVAL_MS) return { ok: false, skipped: true };
    return createSnapshot();
  }

  /**
   * 列出快照（新→旧）。
   *
   * 默认是「便宜」的列表：只读 manifest.json，不碰 object 仓、不解压数据库。
   * 早先每份快照都跑一遍 verifySnapshotDir（解压 + integrity_check + 逐个附件 SHA-256），
   * 于是打开设置页只看一眼状态，就要把全部快照的附件重读一遍（实测：1 MiB 附件 → 7 MiB 读取，
   * 且每创建一份新快照同样如此）。深度校验改由 { verify: true } 显式触发。
   */
  async function listSnapshots(backupDirOverride, options) {
    const opts = options || {};
    const root = backupDirOverride || configuredDir();
    if (!root) return [];
    let names = [];
    try {
      names = await fs.readdir(snapshotsDir(root));
    } catch (error) { return []; }
    const out = [];
    for (const name of names) {
      const dir = path.join(snapshotsDir(root), name);
      const manifest = await readJson(path.join(dir, 'manifest.json'));
      if (!manifest || (manifest.version !== MANIFEST_VERSION && manifest.version !== LEGACY_MANIFEST_VERSION)) {
        out.push({
          id: name, valid: false, verified: false, createdAt: '', assets: 0, dbBytes: 0,
          error: 'manifest 缺失或版本不兼容'
        });
        continue;
      }
      const entry = {
        id: name, valid: true, verified: false, createdAt: manifest.createdAt || '',
        assets: (manifest.assets || []).length,
        dbBytes: manifest.database && manifest.database.dbSize || 0,
        error: ''
      };
      if (opts.verify) {
        const check = await verifySnapshotDir(dir, root);
        entry.valid = !!check.valid;
        entry.verified = !!check.valid;
        entry.error = check.valid ? '' : check.error;
        if (check.assets) entry.badAssets = check.assets;
      }
      out.push(entry);
    }
    out.sort(function (a, b) {
      var ka = String(a.createdAt || a.id), kb = String(b.createdAt || b.id);
      if (ka !== kb) return kb.localeCompare(ka);
      return String(b.id).localeCompare(String(a.id)); // 同秒并列时按 id 稳定排序
    });
    return out;
  }

  /** 轮换：保留最近 keepLimit() 份，GC 不再被引用的对象（新快照已发布后执行） */
  async function rotateAndCollectGarbage(root) {
    const keep = keepLimit();
    const snapshots = await listSnapshots(root);
    const survivors = snapshots.slice(0, keep);
    const dropped = snapshots.slice(keep);
    for (const item of dropped) {
      await fs.rm(path.join(snapshotsDir(root), item.id), { recursive: true, force: true }).catch(function () {});
    }
    const referenced = {};
    for (const item of survivors) {
      const manifest = await readJson(path.join(snapshotsDir(root), item.id, 'manifest.json'));
      (manifest && manifest.assets || []).forEach(function (asset) { referenced[asset.hash] = true; });
    }
    // 顺带裁剪 hash-cache：条目只服务于「同路径同大小同 mtime 复用哈希」，
    // 哈希已不被任何保留快照引用的条目今后也不会命中有用的值，删掉防止无限增长。
    const cache = await loadHashCache(root);
    let prunedCacheEntries = 0;
    Object.keys(cache.files).forEach(function (key) {
      const entry = cache.files[key];
      if (entry && referenced[String(entry.sha256 || '').toLowerCase()]) return;
      delete cache.files[key];
      prunedCacheEntries++;
    });
    if (prunedCacheEntries) await writeJsonAtomic(path.join(root, 'hash-cache.json'), cache);
    let prunedObjects = 0;
    let buckets = [];
    try { buckets = await fs.readdir(objectsDir(root)); } catch (error) {}
    for (const bucket of buckets) {
      const bucketDir = path.join(objectsDir(root), bucket);
      let names = [];
      try { names = await fs.readdir(bucketDir); } catch (error) { continue; }
      for (const name of names) {
        if (!/^[a-f0-9]{64}$/i.test(name)) continue;
        if (referenced[name.toLowerCase()]) continue;
        await fs.rm(path.join(bucketDir, name), { force: true }).catch(function () {});
        prunedObjects++;
      }
      const rest = await fs.readdir(bucketDir).catch(function () { return ['?']; });
      if (!rest.length) await fs.rmdir(bucketDir).catch(function () {});
    }
    return { prunedSnapshots: dropped.length, prunedObjects: prunedObjects, prunedCacheEntries: prunedCacheEntries, keep: keep };
  }

  /** 校验快照目录：manifest、gz 哈希、解压后数据库哈希与完整性、全部资产哈希 */
  async function verifySnapshotDir(dir, rootOverride) {
    const manifest = await readJson(path.join(dir, 'manifest.json'));
    if (!manifest || (manifest.version !== MANIFEST_VERSION && manifest.version !== LEGACY_MANIFEST_VERSION)) return { valid: false, error: 'manifest 缺失或版本不兼容' };
    const dbInfo = manifest.database || {};
    const gzFile = path.join(dir, DB_FILE_GZ);
    try {
      await fs.access(gzFile);
    } catch (error) {
      return { valid: false, error: '缺少数据库快照文件' };
    }
    if (dbInfo.sha256 && (await sha256File(gzFile)) !== dbInfo.sha256) return { valid: false, error: '数据库快照压缩包哈希不匹配' };
    // 流式解压到探针文件，raw 哈希在管线内顺带算出
    const probe = path.join(dir, '.verify-' + process.pid + '.sqlite');
    const rawHasher = sha256Stream();
    try {
      await pipeline(
        fsSync.createReadStream(gzFile),
        zlib.createGunzip(),
        rawHasher,
        fsSync.createWriteStream(probe)
      );
    } catch (error) {
      await fs.rm(probe, { force: true }).catch(function () {});
      return { valid: false, error: '数据库快照解压失败' };
    }
    if (dbInfo.dbSha256 && rawHasher.digestHex() !== dbInfo.dbSha256) {
      await fs.rm(probe, { force: true }).catch(function () {});
      return { valid: false, error: '数据库快照内容哈希不匹配' };
    }
    let snapshotDb = null;
    try {
      snapshotDb = new DatabaseSync(probe);
      const check = snapshotDb.prepare('PRAGMA integrity_check').get();
      if (!check || Object.values(check)[0] !== 'ok') return { valid: false, error: '数据库快照完整性检查失败' };
    } catch (error) {
      return { valid: false, error: '数据库快照无法打开：' + String(error && error.message || error) };
    } finally {
      try { if (snapshotDb) snapshotDb.close(); } catch (error) {}
      await fs.rm(probe, { force: true }).catch(function () {});
      await fs.rm(probe + '-wal', { force: true }).catch(function () {});
      await fs.rm(probe + '-shm', { force: true }).catch(function () {});
    }
    // 快照目录为 snapshots/<id> 时根目录可推导；staging 等其它布局由调用方显式传入
    const root = rootOverride || path.dirname(path.dirname(dir));
    const assets = manifest.assets || [];
    // 逐对象整读哈希是纯独立 I/O：4 路并发把发布前校验从串行轮次压缩到约 1/4
    const badAssets = [];
    await mapLimit(assets, 4, async function (asset) {
      const file = objectPath(root, asset.hash);
      try {
        const actual = await sha256File(file);
        if (actual !== asset.hash) badAssets.push({ itemId: asset.itemId, reason: '哈希不匹配' });
      } catch (error) {
        badAssets.push({ itemId: asset.itemId, reason: '对象缺失' });
      }
    });
    if (badAssets.length) return { valid: false, error: badAssets.length + ' 个资产对象缺失或损坏', assets: badAssets };
    return { valid: true, manifest: manifest };
  }

  /**
   * 把当前工作库文件改名保留（corrupt / before-restore）。
   *
   * 该操作本身也保持事务性：WAL/SHM 移动失败时，已移动的文件会按
   * 逆序放回原位，避免留下一个“主库已隔离但 WAL 仍在原位”的混合状态。
   */
  async function quarantineLibraryFiles(tag, transaction) {
    const suffix = '.' + (tag || 'corrupt') + '-' + newRestoreToken();
    const moved = [];
    if (transaction) transaction.quarantinedFiles = moved;
    try {
      for (const name of ['litboard.sqlite', 'litboard.sqlite-wal', 'litboard.sqlite-shm']) {
        const from = path.join(libraryDir, name);
        const to = from + suffix;
        try {
          await fs.rename(from, to);
          moved.push({ name: name, from: from, to: to });
        } catch (error) {
          // 只有文件不存在才是正常情况；权限/占用等错误必须中止恢复。
          if (error && error.code === 'ENOENT') continue;
          throw error;
        }
      }
    } catch (error) {
      const rollbackErrors = [];
      for (let i = moved.length - 1; i >= 0; i--) {
        try {
          await fs.rename(moved[i].to, moved[i].from);
          moved.splice(i, 1);
        }
        catch (rollbackError) { rollbackErrors.push(String(rollbackError && rollbackError.message || rollbackError)); }
      }
      if (rollbackErrors.length) error.rollbackError = rollbackErrors.join('; ');
      throw error;
    }
    return moved.map(function (item) { return path.basename(item.to); });
  }

  async function verifyDatabaseFile(file) {
    let probe = null;
    try {
      probe = new DatabaseSync(file, { readOnly: true });
      probe.exec('PRAGMA busy_timeout = 5000');
      const check = probe.prepare('PRAGMA integrity_check').get();
      if (!check || Object.values(check)[0] !== 'ok') throw new Error('替换后的数据库完整性检查失败');
    } finally {
      try { if (probe) probe.close(); } catch (error) {}
    }
  }

  async function moveExistingRestoreAssets(finalAssetsDir, token) {
    let stat;
    try { stat = await fs.lstat(finalAssetsDir); }
    catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat) return null;
    const parent = path.dirname(finalAssetsDir);
    const previous = path.join(parent, '.previous-' + path.basename(finalAssetsDir) + '-' + token);
    await fs.rename(finalAssetsDir, previous);
    return previous;
  }

  async function ensureAbsent(target) {
    if (await pathExists(target)) throw new Error('恢复目标已存在，拒绝覆盖：' + target);
  }

  /**
   * 在所有暂存内容都完成校验后切换工作库与 restored-assets。
   *
   * 数据库和资产目录位于不同目录，无法用一个 rename 同时提交，因此用
   * “旧内容改名保留 → 新内容改名就位 → 最终校验 → 失败逆序恢复”的事务
   * 语义。成功后旧资产目录仍保留在 .previous-* 下，不在恢复路径中删除。
   */
  async function atomicRestoreSwitch(options) {
    const opts = options || {};
    const token = opts.token || newRestoreToken();
    const transaction = {
      token: token,
      tempDbFile: opts.tempDbFile,
      tempAssetsDir: opts.tempAssetsDir,
      finalAssetsDir: opts.finalAssetsDir,
      dbInstalled: false,
      assetsInstalled: false,
      previousAssetsDir: null,
      quarantinedFiles: []
    };
    try {
      await quarantineLibraryFiles(opts.quarantineTag || 'corrupt', transaction);
      if (transaction.finalAssetsDir && transaction.tempAssetsDir) {
        transaction.previousAssetsDir = await moveExistingRestoreAssets(transaction.finalAssetsDir, token);

        // POSIX rename 会覆盖目标；显式检查使恢复不可能静默覆盖并发产生的文件。
        await ensureAbsent(transaction.finalAssetsDir);
        await fs.rename(transaction.tempAssetsDir, transaction.finalAssetsDir);
        transaction.assetsInstalled = true;
      }

      await ensureAbsent(dbFile);
      await fs.rename(transaction.tempDbFile, dbFile);
      transaction.dbInstalled = true;
      await verifyDatabaseFile(dbFile);

      return {
        quarantined: transaction.quarantinedFiles.map(function (item) { return path.basename(item.to); }),
        previousAssetsDir: transaction.previousAssetsDir
      };
    } catch (error) {
      const rollbackErrors = await rollbackRestoreSwitch(transaction);
      if (rollbackErrors.length) {
        error.rollbackError = rollbackErrors.join('; ');
      }
      throw error;
    }
  }

  async function rollbackRestoreSwitch(transaction) {
    const errors = [];
    const recordError = function (error) {
      errors.push(String(error && error.message || error));
    };
    // 先把本次安装的新数据库移到暂存目录（或失败隔离名），再恢复旧库。
    if (transaction.dbInstalled) {
      // read/write 探针或外部进程可能留下 WAL/SHM；先把它们隔离，不能
      // 让新 WAL 与旧主库重新组合。
      for (const name of ['litboard.sqlite-wal', 'litboard.sqlite-shm']) {
        const sidecar = path.join(libraryDir, name);
        try {
          if (await pathExists(sidecar)) {
            await fs.rename(sidecar, sidecar + '.failed-restore-' + transaction.token);
          }
        } catch (error) { recordError(error); }
      }
      try {
        await fs.rename(dbFile, transaction.tempDbFile);
      } catch (error) {
        recordError(error);
        try {
          await fs.rename(dbFile, dbFile + '.failed-restore-' + transaction.token);
        } catch (fallbackError) { recordError(fallbackError); }
      }
    }

    // 同理撤回本次安装的新资产目录；绝不删除旧的 finalAssetsDir 内容。
    if (transaction.assetsInstalled) {
      try {
        await fs.rename(transaction.finalAssetsDir, transaction.tempAssetsDir);
      } catch (error) {
        recordError(error);
        try {
          await fs.rename(transaction.finalAssetsDir,
            transaction.finalAssetsDir + '.failed-restore-' + transaction.token);
        } catch (fallbackError) { recordError(fallbackError); }
      }
    }

    // 旧资产目录只有在目标空缺时才放回；目标已有内容时宁可两份都保留。
    if (transaction.previousAssetsDir) {
      try {
        if (await pathExists(transaction.finalAssetsDir)) {
          throw new Error('回滚资产目录目标仍存在：' + transaction.finalAssetsDir);
        }
        await fs.rename(transaction.previousAssetsDir, transaction.finalAssetsDir);
      } catch (error) { recordError(error); }
    }

    // 按与隔离相反的顺序恢复主库/WAL/SHM，且禁止覆盖外部新出现的文件。
    const moved = transaction.quarantinedFiles || [];
    for (let i = moved.length - 1; i >= 0; i--) {
      const item = moved[i];
      try {
        if (await pathExists(item.from)) {
          throw new Error('回滚数据库目标仍存在：' + item.from);
        }
        await fs.rename(item.to, item.from);
      } catch (error) {
        if (error && error.code === 'ENOENT') continue;
        recordError(error);
      }
    }
    return errors;
  }

  /**
   * 从快照恢复（调用方须先关闭工作数据库）：
   * 验证快照 → 隔离原库 → 临时位置还原验证 → 资产落 restored-assets 并重写路径 → 替换 → 重开验证。
   */
  async function restoreSnapshot(restoreOptions) {
    const opts = restoreOptions || {};
    const root = opts.backupDir || configuredDir();
    if (!root) return { ok: false, error: '尚未配置备份目录' };
    let snapshotId = opts.snapshotId;
    if (!snapshotId) {
      const snapshots = (await listSnapshots(root)).filter(function (item) { return item.valid; });
      if (!snapshots.length) return { ok: false, error: '备份目录中没有有效快照' };
      snapshotId = snapshots[0].id;
    }
    const dir = path.join(snapshotsDir(root), snapshotId);
    const check = await verifySnapshotDir(dir);
    if (!check.valid) return { ok: false, error: '快照校验失败：' + check.error, snapshotId: snapshotId };
    const manifest = check.manifest;

    // 1) 解压数据库到文献库目录旁的临时位置并复核。每次恢复使用唯一
    // token，避免重复点击/并发调用复用上一次残留的暂存目录。
    const restoreToken = newRestoreToken();
    const tempDir = path.join(libraryDir, '.restore-' + restoreToken);
    await fs.mkdir(tempDir, { recursive: true });
    const tempDbFile = path.join(tempDir, 'litboard.sqlite');
    let tempAssetsDir = '';
    try {
      // 流式解压数据库到临时位置，raw 哈希在管线内顺带算出并复核
      const rawHasher = sha256Stream();
      await pipeline(
        fsSync.createReadStream(path.join(dir, DB_FILE_GZ)),
        zlib.createGunzip(),
        rawHasher,
        fsSync.createWriteStream(tempDbFile)
      );
      if (rawHasher.digestHex() !== manifest.database.dbSha256) throw new Error('数据库快照内容哈希不匹配');

      // 2) 资产复制到受管 restored-assets/<snapshotId>/（先写临时目录再改名）。
      //    库内路径必须记录最终目录（restored-assets/<snapshotId>/），
      //    因为随后 tempAssetsDir 会被整体改名，临时路径会失效。
      const restoreRoot = path.join(configDir, 'restored-assets');
      const finalAssetsDir = path.join(restoreRoot, snapshotId);
      tempAssetsDir = path.join(restoreRoot, '.tmp-' + snapshotId + '-' + restoreToken);
      await fs.mkdir(tempAssetsDir, { recursive: true });
      // 复制 + 复核哈希是独立 I/O：6 路并发；路径映射在全部落位后按原顺序统一应用，
      // 保持串行版「列表靠后者覆盖同键」的语义不变
      const restoredAssets = await mapLimit(manifest.assets || [], 6, async function (asset) {
        // archivePath 必须由备份流程生成：拒绝绝对路径与目录穿越
        const rel = String(asset.archivePath || '');
        if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).indexOf('..') !== -1) {
          throw new Error('manifest 包含非法归档路径：' + rel);
        }
        const from = objectPath(root, asset.hash);
        const to = path.join(tempAssetsDir, rel);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
        const verify = await sha256File(to);
        if (verify !== asset.hash) throw new Error('资产还原后哈希不匹配：' + rel);
        return asset;
      });
      const pathMap = {}; // paperId/itemId → 最终绝对路径
      const dirMap = {};  // paperId/itemId → 快照目录的最终目录（relPath 资产）
      const noteAssetMap = {}; // noteId/assetIndex → 笔记资产的最终绝对路径
      for (const asset of restoredAssets) {
        const finalPath = path.join(finalAssetsDir, String(asset.archivePath || ''));
        pathMap[asset.paperId + '/' + asset.itemId] = finalPath;
        if (asset.relPath) dirMap[asset.paperId + '/' + asset.itemId] = path.join(finalAssetsDir, 'assets', asset.paperId, asset.itemId);
        if (asset.noteId && asset.assetIndex != null) noteAssetMap[asset.noteId + '/' + asset.assetIndex] = finalPath;
      }

      // 3) 重写还原库中的附件/批注图片路径（据 manifest，不触碰原外部文件与托管目录）
      const restoredDb = new DatabaseSync(tempDbFile);
      try {
        restoredDb.exec('PRAGMA busy_timeout = 5000');
        const rows = restoredDb.prepare('SELECT id, data FROM papers').all();
        const update = restoredDb.prepare('UPDATE papers SET data = ?, hash = ? WHERE id = ?');
        const deleteAtts = restoredDb.prepare('DELETE FROM attachments WHERE paper_id = ?');
        const insertAtt = restoredDb.prepare(
          'INSERT INTO attachments(id, paper_id, kind, file_name, path, fingerprint, cloud_name, sync_signature, added_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)');
        restoredDb.exec('BEGIN');
        try {
          rows.forEach(function (row) {
            let paper;
            try { paper = JSON.parse(row.data); } catch (error) { return; }
            (paper.attachments || []).forEach(function (att) {
              if (!att) return;
              if (att.kind === 'snapshot' && dirMap[row.id + '/' + att.id]) {
                // 快照附件的 path 是目录：指向还原后的目录
                if (att.path !== dirMap[row.id + '/' + att.id]) att.path = dirMap[row.id + '/' + att.id];
                return;
              }
              const target = pathMap[row.id + '/' + att.id];
              if (target && att.path !== target) att.path = target;
            });
            (paper.pdfAnnotations || []).forEach(function (ann) {
              const target = ann && ann.type === 'snapshot' && pathMap[row.id + '/' + ann.id];
              if (target && ann.imagePath !== target) ann.imagePath = target;
            });
            // 路径重写后统一重投影（pdfPath 等旧字段）并重算 hash；附件表同步路径列
            const normalized = LitModel.normalizePaper(paper);
            normalized.id = row.id;
            const stored = Object.assign({}, normalized);
            update.run(JSON.stringify(stored), hashEntity(stored), row.id);
            deleteAtts.run(row.id);
            (normalized.attachments || []).forEach(function (att) {
              insertAtt.run(att.id, row.id, att.kind, att.fileName, att.path, att.fingerprint,
                att.cloudName, att.syncSignature, att.addedAt);
            });
          });
          // 防御：快照已剥离令牌，这里再确保一次
          restoredDb.exec("DELETE FROM settings WHERE key = 'bridgeToken'");
          // 笔记资产路径重写（v4 起有 notes 表；旧快照没有则跳过）
          const hasNotesTable = !!restoredDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get();
          if (hasNotesTable) {
            const noteRows = restoredDb.prepare('SELECT id, data FROM notes').all();
            const updateNote = restoredDb.prepare('UPDATE notes SET data = ?, hash = ? WHERE id = ?');
            noteRows.forEach(function (noteRow) {
              let note;
              try { note = JSON.parse(noteRow.data); } catch (error) { return; }
              let touched = false;
              (note.assets || []).forEach(function (noteAsset, index) {
                const target = noteAssetMap[noteRow.id + '/' + index];
                if (target && noteAsset.path !== target) { noteAsset.path = target; touched = true; }
              });
              if (!touched) return;
              // 路径重写后统一走 normalize 再落盘：hash 列与 loadState 的重规范化结果保持一致
              const normalizedNote = LitModel.normalizeNote(note);
              updateNote.run(JSON.stringify(normalizedNote), hashEntity(normalizedNote), noteRow.id);
            });
          }
          restoredDb.exec('COMMIT');
        } catch (error) {
          try { restoredDb.exec('ROLLBACK'); } catch (rollbackError) {}
          throw error;
        }
        const integrity = restoredDb.prepare('PRAGMA integrity_check').get();
        if (!integrity || Object.values(integrity)[0] !== 'ok') throw new Error('还原后的数据库完整性检查失败');
        restoredDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally {
        try { restoredDb.close(); } catch (error) {}
      }
      await fs.rm(tempDbFile + '-wal', { force: true }).catch(function () {});
      await fs.rm(tempDbFile + '-shm', { force: true }).catch(function () {});

      // 4) 全部验证通过后才动工作库。旧库与旧资产先改名保留，任何
      // 提交/最终校验失败都由 atomicRestoreSwitch 逆序回滚。
      const switched = await atomicRestoreSwitch({
        tempDbFile: tempDbFile,
        tempAssetsDir: tempAssetsDir,
        finalAssetsDir: finalAssetsDir,
        quarantineTag: opts.quarantineTag || 'corrupt',
        token: restoreToken
      });
      await fs.rm(tempDir, { recursive: true, force: true }).catch(function () {});
      return {
        ok: true, snapshotId: snapshotId, createdAt: manifest.createdAt,
        assets: (manifest.assets || []).length, quarantined: switched.quarantined,
        restoredAssetsDir: finalAssetsDir,
        previousRestoredAssetsDir: switched.previousAssetsDir || ''
      };
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(function () {});
      if (tempAssetsDir) await fs.rm(tempAssetsDir, { recursive: true, force: true }).catch(function () {});
      const message = String(error && error.message || error) +
        (error && error.rollbackError ? '；回滚失败：' + error.rollbackError : '');
      return { ok: false, error: message, snapshotId: snapshotId };
    }
  }

  /** 从新到旧找到第一份通过校验的快照并恢复 */
  async function restoreLatestValid(backupDirOverride) {
    const root = backupDirOverride || configuredDir();
    const snapshots = (await listSnapshots(root)).filter(function (item) { return item.valid; });
    for (const item of snapshots) {
      const result = await restoreSnapshot({ snapshotId: item.id, backupDir: root, quarantineTag: 'corrupt' });
      if (result.ok) return result;
    }
    return { ok: false, error: snapshots.length ? '所有快照均未通过校验' : '备份目录中没有快照' };
  }

  /** 兼容性兜底：已有 litboard.sqlite.bak 且有效时恢复（同样保留原始损坏文件） */
  async function restoreLegacyBak() {
    const bakFile = dbFile + '.bak';
    try { await fs.access(bakFile); } catch (error) { return { ok: false, error: '没有 .bak 兜底文件' }; }
    let probe = null;
    try {
      probe = new DatabaseSync(bakFile);
      const check = probe.prepare('PRAGMA integrity_check').get();
      if (!check || Object.values(check)[0] !== 'ok') return { ok: false, error: '.bak 兜底文件也已损坏' };
    } catch (error) {
      return { ok: false, error: '.bak 兜底文件无法打开' };
    } finally {
      try { if (probe) probe.close(); } catch (error) {}
    }
    const token = newRestoreToken();
    const tempDir = path.join(libraryDir, '.legacy-restore-' + token);
    const tempDbFile = path.join(tempDir, 'litboard.sqlite');
    try {
      await fs.mkdir(tempDir, { recursive: true });
      await fs.copyFile(bakFile, tempDbFile);
      const switched = await atomicRestoreSwitch({
        tempDbFile: tempDbFile,
        quarantineTag: 'corrupt',
        token: token
      });
      await fs.rm(tempDir, { recursive: true, force: true }).catch(function () {});
      return { ok: true, legacyBak: true, quarantined: switched.quarantined };
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(function () {});
      const message = String(error && error.message || error) +
        (error && error.rollbackError ? '；回滚失败：' + error.rollbackError : '');
      return { ok: false, error: message };
    }
  }

  async function status() {
    const configured = configuredDir();
    const state = dataPathManager ? dataPathManager.getState() : {};
    const snapshots = configured ? await listSnapshots() : [];
    return {
      configured: !!configured,
      backupDir: configured,
      lastBackupAt: Number(state.backupLastAt) || 0,
      lastSnapshotId: state.backupLastSnapshotId || '',
      snapshots: snapshots,
      keepSnapshots: keepLimit(),
      keepMin: MIN_KEEP_SNAPSHOTS,
      keepMax: MAX_KEEP_SNAPSHOTS,
      defaultKeepSnapshots: DEFAULT_KEEP_SNAPSHOTS,
      autoIntervalHours: AUTO_INTERVAL_MS / 3600000
    };
  }

  /**
   * 递归统计目录体积（清理界面要显示“能释放多少”）
   */
  async function dirBytes(target) {
    let total = 0;
    let entries = [];
    try { entries = await fs.readdir(target, { withFileTypes: true }); } catch (error) { return 0; }
    for (const entry of entries) {
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) total += await dirBytes(full);
      else {
        try { total += (await fs.stat(full)).size; } catch (error) {}
      }
    }
    return total;
  }

  function normPath(value) {
    const resolved = path.resolve(String(value || ''));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  /**
   * 库内仍在引用的附件/批注图片路径集合。
   * 返回 null 表示「无法判断」（库未打开或已损坏）——此时调用方必须放弃按引用清理，
   * 宁可留着垃圾也不能误删用户唯一的一份附件。
   */
  function referencedAssetPaths() {
    const db = getDb();
    if (!db || typeof db.loadState !== 'function') return null;
    let state;
    try { state = db.loadState(); } catch (error) { return null; }
    if (!state || !Array.isArray(state.papers)) return null;
    const fsSync = require('node:fs');
    const referenced = new Set();
    const addDirTree = function (dir) {
      // 快照目录：目录本身与其下所有文件都算被引用，避免清理误删
      referenced.add(normPath(dir));
      let entries;
      try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch (error) { return; }
      entries.forEach(function (entry) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) addDirTree(abs);
        else referenced.add(normPath(abs));
      });
    };
    state.papers.forEach(function (paper) {
      if (!paper) return;
      if (paper.pdfPath) referenced.add(normPath(paper.pdfPath));
      (paper.attachments || []).forEach(function (att) {
        if (!att || !att.path) return;
        if (att.kind === 'snapshot') { addDirTree(att.path); return; }
        referenced.add(normPath(att.path));
      });
      (paper.pdfAnnotations || []).forEach(function (ann) {
        if (ann && ann.imagePath) referenced.add(normPath(ann.imagePath));
      });
    });
    (state.notes || []).forEach(function (note) {
      (note && note.assets || []).forEach(function (asset) {
        if (asset && asset.path) referenced.add(normPath(asset.path));
      });
    });
    return referenced;
  }

  /**
   * 扫描可清理的遗留文件。只读，不改动任何东西。
   *
   * 每一类都遵循「无法证明无用就整类跳过」：例如库打不开时不清理恢复附件目录。
   * 危险类别（隔离的数据库副本 = 损坏库的最后一份拷贝）额外设 30 天保留期。
   * 返回 { items, totalBytes, categories, skipped }，items 每项：
   *   { category, path, name, bytes, mtimeMs, danger }
   */
  async function scanLeftovers() {
    const now = Date.now();
    const root = configuredDir();
    const items = [];
    const skipped = [];
    const add = function (category, full, bytes, mtimeMs, danger) {
      items.push({
        category: category, path: full, name: path.basename(full),
        bytes: bytes, mtimeMs: mtimeMs, danger: !!danger
      });
    };
    const listDirs = async function (dir, prefix) {
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (error) { return []; }
      const out = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || String(entry.name).indexOf(prefix) !== 0) continue;
        const full = path.join(dir, entry.name);
        let stat = null;
        try { stat = await fs.stat(full); } catch (error) { continue; }
        out.push({ path: full, mtimeMs: stat.mtimeMs });
      }
      return out;
    };

    // 1) 备份目录里崩溃残留的 .staging-*
    if (root) {
      for (const entry of await listDirs(root, '.staging-')) {
        if (now - entry.mtimeMs < STAGING_STALE_MS) continue;
        add('staging', entry.path, await dirBytes(entry.path), entry.mtimeMs);
      }
    }

    // 2) 配置目录 restored-assets 下的恢复残留
    const restoredRoot = path.join(configDir, 'restored-assets');
    for (const entry of await listDirs(restoredRoot, '.previous-')) {
      if (now - entry.mtimeMs < RESTORE_LEFTOVER_MS) continue;
      add('previousAssets', entry.path, await dirBytes(entry.path), entry.mtimeMs);
    }
    for (const entry of await listDirs(restoredRoot, '.tmp-')) {
      if (now - entry.mtimeMs < RESTORE_LEFTOVER_MS) continue;
      add('tempAssets', entry.path, await dirBytes(entry.path), entry.mtimeMs);
    }

    // 3) 库内仍在引用的资产路径集合：「恢复附件目录」与「受管孤儿文件」两类清理共用
    const referenced = referencedAssetPaths();
    if (!referenced) {
      skipped.push('当前数据库不可读，已跳过「恢复附件目录 / 受管孤儿文件」的清理');
    } else {
      // 3a) 库内已不再引用的 restored-assets/<snapshotId>/
      const keep = new Set();
      referenced.forEach(function (target) {
        const relative = path.relative(normPath(restoredRoot), target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
        const head = relative.split(/[\\/]/)[0];
        if (head) keep.add(head);
      });
      let entries = [];
      try { entries = await fs.readdir(restoredRoot, { withFileTypes: true }); } catch (error) {}
      for (const entry of entries) {
        if (!entry.isDirectory() || String(entry.name).charAt(0) === '.') continue;
        if (keep.has(entry.name)) continue;
        const full = path.join(restoredRoot, entry.name);
        let stat = null;
        try { stat = await fs.stat(full); } catch (error) { continue; }
        add('orphanRestored', full, await dirBytes(full), stat.mtimeMs);
      }

      // 3b) 受管目录里库已不再引用的孤儿文件。
      //     三重保险：受管命名模式 + 年龄门槛 + 墓碑条目仍算引用（loadState 返回全部论文）。
      const orphanCutoff = now - ORPHAN_MANAGED_KEEP_MS;
      const bakCutoff = now - WRITE_BACKUP_KEEP_MS;
      // files:store-pdf / Zotero 导入的 z 键命名（storeFileInto/storeDirInto）
      const isManagedKey = /^z[A-Z0-9]{8}(\.[a-z0-9]{1,12})?$/i;
      // 下载落盘的快照目录（integrations.js assetTarget：<paperId>.<attachmentId>.snapshot）
      const isSnapshotDownloadDir = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.snapshot$/;
      const listEntries = async function (dir) {
        try { return await fs.readdir(dir, { withFileTypes: true }); } catch (error) { return []; }
      };
      const addOrphan = async function (full) {
        if (referenced.has(normPath(full))) return;
        let stat = null;
        try { stat = await fs.stat(full); } catch (error) { return; }
        if (stat.mtimeMs > orphanCutoff) return;
        add('orphanManaged', full, stat.size, stat.mtimeMs);
      };
      const addWriteBackup = async function (full) {
        let stat = null;
        try { stat = await fs.stat(full); } catch (error) { return; }
        if (stat.mtimeMs > bakCutoff) return;
        add('writeBackups', full, stat.size, stat.mtimeMs, true);
      };

      // synced-attachments 顶层：z 键文件/快照目录、下载快照目录、.litwrite 残留、.litbak 留底
      const syncedDir = path.join(configDir, 'synced-attachments');
      for (const entry of await listEntries(syncedDir)) {
        const full = path.join(syncedDir, entry.name);
        if (entry.isDirectory()) {
          if (!isManagedKey.test(entry.name) && !isSnapshotDownloadDir.test(entry.name)) continue;
          if (referenced.has(normPath(full))) continue;
          let stat = null;
          try { stat = await fs.stat(full); } catch (error) { continue; }
          if (stat.mtimeMs > orphanCutoff) continue;
          add('orphanManaged', full, await dirBytes(full), stat.mtimeMs);
          continue;
        }
        if (!entry.isFile()) continue;
        if (/\.litbak$/i.test(entry.name)) { await addWriteBackup(full); continue; }
        if (isManagedKey.test(entry.name) || /\.litwrite$/i.test(entry.name)) await addOrphan(full);
      }

      // annotation-images：批注截图逐文件判孤儿
      const annDir = path.join(configDir, 'annotation-images');
      for (const entry of await listEntries(annDir)) {
        if (!entry.isFile() || !/\.png$/i.test(entry.name)) continue;
        await addOrphan(path.join(annDir, entry.name));
      }

      // note-assets/<noteId>/：笔记图片逐文件判孤儿
      const noteRoot = path.join(configDir, 'note-assets');
      for (const noteDirEntry of await listEntries(noteRoot)) {
        if (!noteDirEntry.isDirectory()) continue;
        const noteDir = path.join(noteRoot, noteDirEntry.name);
        for (const entry of await listEntries(noteDir)) {
          if (!entry.isFile()) continue;
          await addOrphan(path.join(noteDir, entry.name));
        }
      }
    }

    // 4) 迁移数据目录留下的旧库副本：保留最新一份，其余可清
    let migrated = [];
    try {
      const names = await fs.readdir(libraryDir);
      for (const name of names) {
        if (!/^litboard\.sqlite\.pre-path-change-.*\.bak$/.test(name)) continue;
        const full = path.join(libraryDir, name);
        let stat = null;
        try { stat = await fs.stat(full); } catch (error) { continue; }
        migrated.push({ path: full, mtimeMs: stat.mtimeMs, bytes: stat.size });
      }
    } catch (error) {}
    migrated.sort(function (a, b) { return b.mtimeMs - a.mtimeMs; });
    migrated.slice(1).forEach(function (entry) {
      add('prePathChange', entry.path, entry.bytes, entry.mtimeMs);
    });

    // 5) 已隔离的数据库副本（*.corrupt-* / *.before-restore-*）—— 危险类别，仅清理超过 30 天的
    try {
      const names = await fs.readdir(libraryDir);
      for (const name of names) {
        if (!/^litboard\.sqlite(-wal|-shm)?\.(corrupt|before-restore)-/.test(name)) continue;
        const full = path.join(libraryDir, name);
        let stat = null;
        try { stat = await fs.stat(full); } catch (error) { continue; }
        if (now - stat.mtimeMs < QUARANTINE_KEEP_MS) continue;
        add('quarantineDb', full, stat.size, stat.mtimeMs, true);
      }
    } catch (error) {}

    const categories = {};
    let totalBytes = 0;
    items.forEach(function (item) {
      if (!categories[item.category]) {
        categories[item.category] = { label: LEFTOVER_LABELS[item.category] || item.category, count: 0, bytes: 0 };
      }
      categories[item.category].count += 1;
      categories[item.category].bytes += item.bytes;
      totalBytes += item.bytes;
    });
    return { items: items, totalBytes: totalBytes, categories: categories, skipped: skipped };
  }

  /**
   * 执行清理：只删 scanLeftovers() 列出的东西（内部重新扫描一遍，避免界面停留期间状态漂移）。
   * 当前数据库、当前快照、对象仓、仍在被引用的附件都不在范围内。
   */
  async function cleanLeftovers() {
    const scan = await scanLeftovers();
    let bytes = 0;
    const removed = [];
    const failed = [];
    for (const item of scan.items) {
      try {
        await fs.rm(item.path, { recursive: true, force: true });
        removed.push({ category: item.category, name: item.name, bytes: item.bytes });
        bytes += item.bytes;
      } catch (error) {
        failed.push({ name: item.name, error: String(error && error.message || error) });
      }
    }
    return {
      ok: true, removed: removed.length, bytes: bytes,
      categories: scan.categories, items: removed, failed: failed, skipped: scan.skipped
    };
  }

  return {
    createSnapshot: createSnapshot,
    maybeAutoBackup: maybeAutoBackup,
    listSnapshots: listSnapshots,
    verifySnapshotDir: verifySnapshotDir,
    restoreSnapshot: restoreSnapshot,
    restoreLatestValid: restoreLatestValid,
    restoreLegacyBak: restoreLegacyBak,
    atomicRestoreSwitch: atomicRestoreSwitch,
    quarantineLibraryFiles: quarantineLibraryFiles,
    status: status,
    keepLimit: keepLimit,
    isSameContentAs: isSameContentAs,
    scanLeftovers: scanLeftovers,
    cleanLeftovers: cleanLeftovers,
    KEEP_SNAPSHOTS: DEFAULT_KEEP_SNAPSHOTS,
    AUTO_INTERVAL_MS: AUTO_INTERVAL_MS
  };
}

module.exports = {
  createBackupManager: createBackupManager,
  publishObject: publishObject,
  MANIFEST_VERSION: MANIFEST_VERSION,
  KEEP_SNAPSHOTS: DEFAULT_KEEP_SNAPSHOTS,
  DEFAULT_KEEP_SNAPSHOTS: DEFAULT_KEEP_SNAPSHOTS,
  MIN_KEEP_SNAPSHOTS: MIN_KEEP_SNAPSHOTS,
  MAX_KEEP_SNAPSHOTS: MAX_KEEP_SNAPSHOTS
};
