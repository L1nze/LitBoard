'use strict';

/* 应用自动更新管理器（预下载 + 单份缓存 + 就绪提醒）：
 * - checkNow()：查 releases/latest；发现更高版本即后台预下载对应安装包（Setup/Portable 按当前形态），
 *   下载完成并经 SHA-256（同 Release 的 SHA256SUMS.txt）校验后才算就绪——用户点「立即更新」时
 *   安装包已在本地，直接拉起 NSIS 安装界面，不再经过浏览器与下载目录选择。
 * - 单份缓存：只有校验成功才替换旧安装包；隔代升级时新包落盘、旧包即删；.part 残片启动即清。
 *   存储占用不随发布次数增长（任何时刻至多一份安装包 + 一个 state.json）。
 * - 安装完自动删除：启动时 pending 版本不再比当前版本新（=用户已装完新版）→ 删除安装包与状态。
 * - applyUpdate()：安装版拉起安装程序并退出应用；便携版在资源管理器中定位新文件（由其自行替换）。
 * 依赖全部注入：node:test 可用纯 Node 驱动（见 test/update-check.test.js）。 */

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const LitUpdate = require('../js/update.js');

const CACHE_DIR_NAME = 'update-cache';
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 整包下载的放弃期限（不是限速）
const PROGRESS_STEP = 4 * 1024 * 1024;      // 进度事件按 4MB 节流，避免刷屏 IPC

function createUpdateManager(deps) {
  const getConfigDir = deps.getConfigDir;       // () => string（调用时取：数据目录可迁移）
  const currentVersion = deps.currentVersion;   // app.getVersion()
  const isPackaged = !!deps.isPackaged;
  const isPortable = !!deps.isPortable;
  const fetchRelease = deps.fetchRelease;       // () => Promise<releaseJson|null>
  const fetchText = deps.fetchText;             // (url) => Promise<string>
  const netFetch = deps.netFetch;               // (url, opts) => Promise<Response>（流式下载）
  const spawnInstaller = deps.spawnInstaller;   // (file) => Promise<void>|void
  const revealPath = deps.revealPath;           // (file) => Promise<void>|void
  const requestQuit = deps.requestQuit || function () {};
  const sendStatus = deps.sendStatus || function () {};
  const log = deps.log || function () {};

  let status = { status: 'idle', version: '', url: '', fileName: '', progress: null, error: '' };
  let checkPromise = null;
  let downloadPromise = null;
  let pending = null;    // {version, tagName, fileName, url, sha256}
  let readyFile = null;  // 已校验就绪的安装包绝对路径

  function cacheDir() { return path.join(getConfigDir(), CACHE_DIR_NAME); }
  function statePath() { return path.join(cacheDir(), 'state.json'); }

  function snapshot() {
    return {
      status: status.status,
      version: status.version,
      url: status.url,
      fileName: status.fileName,
      progress: status.progress,
      error: status.error,
      packaged: isPackaged
    };
  }
  function setStatus(next) {
    status = Object.assign({}, status, next);
    sendStatus(snapshot());
  }

  async function readStateFile() {
    try {
      const raw = JSON.parse(await fs.readFile(statePath(), 'utf8'));
      if (raw && typeof raw.version === 'string' && typeof raw.fileName === 'string' &&
          /^[0-9a-f]{64}$/.test(String(raw.sha256 || '')) && Number(raw.bytes) > 0) return raw;
    } catch (error) { /* 损坏视作无状态 */ }
    return null;
  }
  async function writeStateFile(state) {
    await fs.mkdir(cacheDir(), { recursive: true });
    const tmp = statePath() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmp, statePath());
  }

  // 清扫：keep = state.json +（可选）当前唯一就绪安装包；旧版本包 / .part 残片 / 孤儿文件一律删
  async function sweep(keepFileName) {
    const keep = ['state.json'].concat(keepFileName ? [keepFileName] : []);
    let entries = [];
    try { entries = await fs.readdir(cacheDir()); } catch (error) { return; }
    const plan = LitUpdate.cacheSweepPlan(entries, keep);
    for (const name of plan.remove) {
      await fs.rm(path.join(cacheDir(), name), { force: true, recursive: true }).catch(function () {});
    }
  }

  async function sha256File(file) {
    return new Promise(function (resolve, reject) {
      const hash = crypto.createHash('sha256');
      fsSync.createReadStream(file)
        .on('data', function (chunk) { hash.update(chunk); })
        .on('error', reject)
        .on('end', function () { resolve(hash.digest('hex')); });
    });
  }

  // 启动初始化：恢复「已就绪」状态；pending 版本不再比当前新（装完了）或文件缺失/损坏 → 整缓存删除
  async function init() {
    if (!isPackaged) return;
    const state = await readStateFile();
    const file = state ? path.join(cacheDir(), state.fileName) : '';
    let valid = false;
    if (state && LitUpdate.newer(state.version, currentVersion)) {
      try {
        const stat = await fs.stat(file);
        valid = stat.size === Number(state.bytes) && (await sha256File(file)) === state.sha256;
      } catch (error) { valid = false; }
    }
    if (valid) {
      readyFile = file;
      pending = { version: state.version, tagName: 'v' + state.version, fileName: state.fileName, url: '', sha256: state.sha256 };
      await sweep(state.fileName);
      setStatus({ status: 'ready', version: state.version, fileName: state.fileName, error: '' });
      log('update: cached installer ready for v' + state.version);
    } else {
      await sweep(null);
      await fs.rm(statePath(), { force: true }).catch(function () {});
      setStatus({ status: 'idle', version: '', fileName: '', progress: null, error: '' });
    }
  }

  async function checkNow() {
    if (!isPackaged) return snapshot();
    if (checkPromise) return checkPromise.then(snapshot);
    // 下载目标在完成前保持固定，避免 pending 与已缓存文件指向不同版本。
    if (downloadPromise) return downloadPromise.then(snapshot);
    checkPromise = (async function () {
      setStatus({ status: 'checking', error: '' });
      try {
        const release = await fetchRelease();
        const info = LitUpdate.releaseInfo(release, currentVersion, isPortable);
        if (!info) {
          setStatus({ status: 'up-to-date', version: '', url: '', fileName: '', progress: null, error: '' });
          return;
        }
        // 同版本安装包已就绪：直接可用，不重复下载
        if (readyFile && pending && pending.version === info.version) {
          setStatus({ status: 'ready', version: info.version, url: info.url, fileName: pending.fileName, error: '' });
          return;
        }
        pending = { version: info.version, tagName: info.tagName, fileName: info.fileName, url: info.url, sha256: '' };
        setStatus({ status: 'available', version: info.version, url: info.url, fileName: info.fileName, progress: null, error: '' });
        // 预下载是检查的自然延续：fire-and-forget，失败只反映到状态，不阻塞检查调用方
        downloadNow().catch(function () {});
      } catch (error) {
        setStatus({ status: 'error', error: String(error && error.message || error) });
        throw error;
      }
    })();
    try { await checkPromise; } finally { checkPromise = null; }
    return snapshot();
  }

  async function downloadNow() {
    if (!isPackaged) return snapshot();
    if (!pending || !pending.url) throw new Error('没有可下载的更新');
    if (downloadPromise) return downloadPromise.then(snapshot);
    downloadPromise = (async function () {
      const target = pending;
      setStatus({ status: 'downloading', version: target.version, progress: { done: 0, total: 0 }, error: '' });
      const partPath = path.join(cacheDir(), target.fileName + '.part');
      try {
        const sumsText = await fetchText(LitUpdate.sumsUrl(target.tagName));
        const expected = LitUpdate.parseSha256Sums(sumsText)[target.fileName];
        if (!expected) throw new Error('SHA256SUMS 中缺少 ' + target.fileName);
        await fs.mkdir(cacheDir(), { recursive: true });
        const bytes = await streamDownload(target.url, partPath, function (done, total) {
          setStatus({ status: 'downloading', version: target.version, progress: { done: done, total: total }, error: '' });
        });
        const actual = await sha256File(partPath);
        if (actual !== expected) {
          await fs.rm(partPath, { force: true }).catch(function () {});
          throw new Error('安装包校验失败（SHA-256 不匹配）');
        }
        const finalPath = path.join(cacheDir(), target.fileName);
        await fs.rename(partPath, finalPath);
        target.sha256 = expected;
        readyFile = finalPath;
        await writeStateFile({ version: target.version, fileName: target.fileName, sha256: expected, bytes: bytes });
        await sweep(target.fileName); // 只保留这一份：隔代升级的旧包与残片一并清掉
        setStatus({ status: 'ready', version: target.version, fileName: target.fileName, progress: null, error: '' });
        log('update: installer cached for v' + target.version + ' (' + bytes + ' bytes)');
      } catch (error) {
        await fs.rm(partPath, { force: true }).catch(function () {});
        setStatus({ status: 'error', error: String(error && error.message || error), progress: null });
        log('update: download failed: ' + (error && error.message || error));
      }
    })();
    try { await downloadPromise; } finally { downloadPromise = null; }
    return snapshot();
  }

  async function streamDownload(url, dest, onProgress) {
    const res = await netFetch(url, { headers: { 'User-Agent': 'LitBoard' }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error('下载更新：HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    let done = 0;
    let lastEmit = -PROGRESS_STEP;
    const progress = new Transform({
      transform: function (chunk, _encoding, callback) {
        done += chunk.length;
        if (done - lastEmit >= PROGRESS_STEP) { lastEmit = done; onProgress(done, total); }
        callback(null, chunk);
      }
    });
    // pipeline 全程处理读写错误，并在失败时关闭文件、取消响应流。
    await pipeline(Readable.fromWeb(res.body), progress, fsSync.createWriteStream(dest));
    onProgress(done, total || done);
    return done;
  }

  async function applyUpdate() {
    if (status.status !== 'ready' || !readyFile) return { ok: false, reason: status.status };
    const file = readyFile;
    if (isPortable) {
      await revealPath(file);
      return { ok: true, mode: 'reveal', file: file };
    }
    await spawnInstaller(file);
    requestQuit();
    return { ok: true, mode: 'installer' };
  }

  return {
    init: init,
    checkNow: checkNow,
    downloadNow: downloadNow,
    applyUpdate: applyUpdate,
    snapshot: snapshot,
    _cacheDir: cacheDir // 测试与诊断用
  };
}

module.exports = { createUpdateManager: createUpdateManager, CACHE_DIR_NAME: CACHE_DIR_NAME };
