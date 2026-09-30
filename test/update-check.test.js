'use strict';

/* electron/update-check.js 状态机测试：预下载 → SHA-256 校验 → 单份缓存 → 就绪/应用。
 * 全部 IO 注入（无网络）：fake Release / fake 下载流 / spawn / reveal / quit。
 * 钉住的硬不变量：
 * - 任何时刻缓存目录至多一份安装包（隔代升级新包落盘、旧包即删）；
 * - 装完新版后启动，pending 不再比当前版本新 → 安装包与状态自动删除；
 * - 校验失败（哈希不匹配）不就绪、不留 .part 与状态文件；
 * - 重启后凭 state.json + 文件复核直接就绪，不重复下载。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdateManager } = require('../electron/update-check.js');

const SETUP_101 = Buffer.from('fake-setup-bytes-1.0.1');
const SETUP_102 = Buffer.from('fake-setup-bytes-1.0.2-with-more-bytes');
const PORTABLE_101 = Buffer.from('fake-portable-bytes-1.0.1');

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function setupName(v) { return 'LitBoard-Setup-' + v + '-x64.exe'; }
function portableName(v) { return 'LitBoard-Portable-' + v + '-x64.exe'; }

function releaseFor(v, bytesSetup, bytesPortable) {
  return {
    tag_name: 'v' + v, draft: false, prerelease: false,
    assets: [
      { name: setupName(v), state: 'uploaded',
        browser_download_url: 'https://github.com/L1nze/LitBoard/releases/download/v' + v + '/' + setupName(v) },
      { name: portableName(v), state: 'uploaded',
        browser_download_url: 'https://github.com/L1nze/LitBoard/releases/download/v' + v + '/' + portableName(v) }
    ]
  };
}

function sumsFor(v, bytesSetup, bytesPortable) {
  return '# sums\n' +
    sha(bytesSetup) + '  ' + setupName(v) + '\n' +
    sha(bytesPortable) + '  ' + portableName(v) + '\n';
}

function responseOf(bytes) {
  return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
}

async function makeEnv(t, opts) {
  opts = opts || {};
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-update-'));
  t.after(async function () { await fs.rm(configDir, { recursive: true, force: true }); });
  const calls = { fetchRelease: 0, downloads: [], spawned: [], revealed: [], quits: 0, statuses: [] };
  const state = {
    latest: opts.latest || '1.0.1',
    bytes: { setup: SETUP_101, portable: PORTABLE_101 },
    sumsOverride: opts.sumsOverride || null
  };
  const deps = {
    getConfigDir: function () { return configDir; },
    currentVersion: opts.currentVersion || '1.0.0',
    isPackaged: true,
    isPortable: !!opts.isPortable,
    fetchRelease: async function () {
      calls.fetchRelease += 1;
      return state.latest === null ? null : releaseFor(state.latest, state.bytes.setup, state.bytes.portable);
    },
    fetchText: async function () {
      if (state.sumsOverride != null) return state.sumsOverride;
      return sumsFor(state.latest, state.bytes.setup, state.bytes.portable);
    },
    netFetch: async function (url) {
      calls.downloads.push(url);
      return responseOf(url.indexOf('Portable') !== -1 ? state.bytes.portable : state.bytes.setup);
    },
    spawnInstaller: async function (file) { calls.spawned.push(file); },
    revealPath: async function (file) { calls.revealed.push(file); },
    requestQuit: function () { calls.quits += 1; },
    sendStatus: function (s) { calls.statuses.push(s.status + (s.version ? ':' + s.version : '')); }
  };
  const manager = createUpdateManager(deps);
  return { manager: manager, calls: calls, configDir: configDir, state: state };
}

function cacheFiles(configDir) {
  const dir = path.join(configDir, 'update-cache');
  try { return fsSync.readdirSync(dir).sort(); } catch (error) { return []; }
}

test('首次发现新版本：后台预下载 + 校验就绪，缓存只此一份', async function (t) {
  const env = await makeEnv(t);
  const snap = await env.manager.checkNow();
  // available 是瞬态：预下载立即接管为 downloading（状态事件里两者都有）
  assert.ok(snap.status === 'available' || snap.status === 'downloading');
  assert.ok(env.calls.statuses.indexOf('available:1.0.1') !== -1);
  const done = await env.manager.downloadNow();
  assert.equal(done.status, 'ready');
  assert.equal(done.version, '1.0.1');
  assert.deepEqual(cacheFiles(env.configDir), [setupName('1.0.1'), 'state.json'].sort());
  // 状态流转包含 downloading 与 ready（渲染层据此提醒）
  assert.ok(env.calls.statuses.indexOf('downloading:1.0.1') !== -1);
  assert.ok(env.calls.statuses.indexOf('ready:1.0.1') !== -1);
  // 已就绪再检查：不重复下载
  const again = await env.manager.checkNow();
  assert.equal(again.status, 'ready');
  assert.equal(env.calls.downloads.length, 1);
});

test('重启恢复：凭 state.json + 文件复核直接就绪，不触网不重复下载', async function (t) {
  const first = await makeEnv(t);
  await first.manager.checkNow();
  await first.manager.downloadNow();
  // 同一配置目录新建管理器（模拟重启），不手动 init 前是 idle
  const env = await makeEnv(t, { latest: '1.0.1' });
  env.manager = createUpdateManager({
    getConfigDir: function () { return first.configDir; },
    currentVersion: '1.0.0', isPackaged: true, isPortable: false,
    fetchRelease: env.calls.fetchReleaseFn = async function () { env.calls.fetchRelease += 1; return releaseFor('1.0.1', SETUP_101, PORTABLE_101); },
    fetchText: async function () { return sumsFor('1.0.1', SETUP_101, PORTABLE_101); },
    netFetch: async function () { throw new Error('就绪恢复不应再下载'); },
    spawnInstaller: async function (f) { env.calls.spawned.push(f); },
    revealPath: async function () {}, requestQuit: function () { env.calls.quits += 1; },
    sendStatus: function () {}
  });
  await env.manager.init();
  const snap = env.manager.snapshot();
  assert.equal(snap.status, 'ready');
  assert.equal(snap.version, '1.0.1');
  const applied = await env.manager.applyUpdate();
  assert.equal(applied.ok, true);
  assert.equal(applied.mode, 'installer');
  assert.equal(env.calls.spawned.length, 1);
  assert.equal(env.calls.quits, 1);
});

test('装完新版后启动：pending 不再比当前版本新 → 安装包与状态自动删除', async function (t) {
  const first = await makeEnv(t);
  await first.manager.checkNow();
  await first.manager.downloadNow();
  assert.deepEqual(cacheFiles(first.configDir), [setupName('1.0.1'), 'state.json'].sort());
  // 用户通过安装程序升级到 1.0.1：新版本的启动 currentVersion 已是 1.0.1
  const upgraded = createUpdateManager({
    getConfigDir: function () { return first.configDir; },
    currentVersion: '1.0.1', isPackaged: true, isPortable: false,
    fetchRelease: async function () { throw new Error('不应触网'); },
    fetchText: async function () { throw new Error('不应触网'); },
    netFetch: async function () { throw new Error('不应触网'); },
    spawnInstaller: async function () {}, revealPath: async function () {},
    requestQuit: function () {}, sendStatus: function () {}
  });
  await upgraded.init();
  assert.equal(upgraded.snapshot().status, 'idle');
  assert.deepEqual(cacheFiles(first.configDir), [], '缓存目录应被清空');
});

test('隔代升级：最新版是 1.0.2 时替换 1.0.1 缓存，任何时刻只存一份', async function (t) {
  const env = await makeEnv(t, { latest: '1.0.1' });
  await env.manager.checkNow();
  await env.manager.downloadNow();
  assert.deepEqual(cacheFiles(env.configDir), [setupName('1.0.1'), 'state.json'].sort());
  // 用户一直没更，期间又发了 1.0.2：releases/latest 直接给最新
  env.state.latest = '1.0.2';
  env.state.bytes = { setup: SETUP_102, portable: PORTABLE_101 };
  await env.manager.checkNow();
  const done = await env.manager.downloadNow();
  assert.equal(done.status, 'ready');
  assert.equal(done.version, '1.0.2');
  assert.deepEqual(cacheFiles(env.configDir), [setupName('1.0.2'), 'state.json'].sort(),
    '旧版本安装包必须被替换删除');
});

test('校验失败（SHA-256 不匹配）：不就绪、不留 .part 与状态文件', async function (t) {
  const env = await makeEnv(t, { sumsOverride: '0'.repeat(64) + '  ' + setupName('1.0.1') + '\n' });
  await env.manager.checkNow();
  const done = await env.manager.downloadNow();
  assert.equal(done.status, 'error');
  assert.ok(String(done.error).indexOf('校验失败') !== -1);
  assert.deepEqual(cacheFiles(env.configDir), [], '损坏文件与状态都不留');
  const applied = await env.manager.applyUpdate();
  assert.equal(applied.ok, false);
});

test('中断残片：.part 文件启动即清', async function (t) {
  const env = await makeEnv(t);
  await fs.mkdir(path.join(env.configDir, 'update-cache'), { recursive: true });
  await fs.writeFile(path.join(env.configDir, 'update-cache', setupName('1.0.1') + '.part'), 'partial');
  await env.manager.init();
  assert.equal(env.manager.snapshot().status, 'idle');
  assert.deepEqual(cacheFiles(env.configDir), []);
});

test('并发检查去重：两次 checkNow 只发一次 releases/latest 请求', async function (t) {
  const env = await makeEnv(t);
  const a = env.manager.checkNow();
  const b = env.manager.checkNow();
  await Promise.all([a, b]);
  assert.equal(env.calls.fetchRelease, 1);
  await env.manager.downloadNow();
});

test('已是最新（无更高版本 / 无 Release）：up-to-date，不下载', async function (t) {
  const env = await makeEnv(t, { latest: null, currentVersion: '9.9.9' });
  const snap = await env.manager.checkNow();
  assert.equal(snap.status, 'up-to-date');
  assert.equal(env.calls.downloads.length, 0);
});

test('便携版：applyUpdate 打开文件所在目录而不是拉起安装程序', async function (t) {
  const env = await makeEnv(t, { isPortable: true });
  await env.manager.checkNow();
  const done = await env.manager.downloadNow();
  assert.equal(done.status, 'ready');
  assert.equal(done.fileName, portableName('1.0.1'));
  const applied = await env.manager.applyUpdate();
  assert.equal(applied.ok, true);
  assert.equal(applied.mode, 'reveal');
  assert.equal(env.calls.revealed.length, 1);
  assert.equal(env.calls.spawned.length, 0);
  assert.equal(env.calls.quits, 0);
});

test('未打包（开发/冒烟）：checkNow 直接 idle，不触网', async function (t) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-update-dev-'));
  t.after(async function () { await fs.rm(configDir, { recursive: true, force: true }); });
  const manager = createUpdateManager({
    getConfigDir: function () { return configDir; },
    currentVersion: '1.0.0', isPackaged: false, isPortable: false,
    fetchRelease: async function () { throw new Error('不应触网'); },
    fetchText: async function () { throw new Error('不应触网'); },
    netFetch: async function () { throw new Error('不应触网'); },
    spawnInstaller: async function () {}, revealPath: async function () {},
    requestQuit: function () {}, sendStatus: function () {}
  });
  await manager.init();
  const snap = await manager.checkNow();
  assert.equal(snap.status, 'idle');
  assert.equal(snap.packaged, false);
});
