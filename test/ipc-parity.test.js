'use strict';

/* IPC 对等性护栏（随 main.js IPC 域拆分建立）：preload 暴露的每个 invoke 通道都必须有
 * 对应注册、注册的每个 handle 通道也必须有 preload 调用方（双向对等，防止搬运遗漏或
 * 通道名笔误静默失效）；渲染层 send 的生命周期通道必须有主进程监听。附带校验
 * electron/ipc/*.js 的相对 require 路径都指向存在的文件（抓 ../../js/ 层级错误）。 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readMainProcessSources() {
  const files = [path.join(ROOT, 'electron', 'main.js')]
    .concat(fs.readdirSync(path.join(ROOT, 'electron', 'ipc'))
      .filter(function (f) { return /\.js$/.test(f); })
      .map(function (f) { return path.join(ROOT, 'electron', 'ipc', f); }));
  return files.map(function (file) {
    return { file: file, text: fs.readFileSync(file, 'utf8') };
  });
}

function collectMatches(pattern, sources) {
  const out = [];
  sources.forEach(function (src) {
    for (const m of src.text.matchAll(pattern)) out.push({ channel: m[1], file: path.relative(ROOT, src.file) });
  });
  return out;
}

test('preload 的每个 invoke 通道都有主进程注册（无悬空调用）', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  const invoked = new Set();
  for (const m of preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) invoked.add(m[1]);

  const sources = readMainProcessSources();
  const registered = new Set(
    collectMatches(/ctx\.handle\('([^']+)',/g, sources)
      .concat(collectMatches(/ipcMain\.handle\('([^']+)',/g, sources))
      .map(function (x) { return x.channel; })
  );

  const missing = Array.from(invoked).filter(function (c) { return !registered.has(c); });
  assert.deepStrictEqual(missing, [], 'preload 调用了但主进程未注册的通道');
});

test('主进程注册的每个 handle 通道都有 preload 调用方（无死注册/拼写漂移）', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  const invoked = new Set();
  for (const m of preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) invoked.add(m[1]);

  const sources = readMainProcessSources();
  const registered = collectMatches(/ctx\.handle\('([^']+)',/g, sources)
    .concat(collectMatches(/ipcMain\.handle\('([^']+)',/g, sources));

  const dead = registered.filter(function (x) { return !invoked.has(x.channel); });
  assert.deepStrictEqual(dead.map(function (x) { return x.file + ' :: ' + x.channel; }), [],
    '注册了但 preload 从不调用的通道');
});

test('handle 通道无重复注册（ipcMain.handle 二次注册会抛错）', () => {
  const sources = readMainProcessSources();
  const all = collectMatches(/ctx\.handle\('([^']+)',/g, sources)
    .concat(collectMatches(/ipcMain\.handle\('([^']+)',/g, sources));
  const seen = new Map();
  const dup = [];
  all.forEach(function (x) {
    if (seen.has(x.channel)) dup.push(x.channel + ' @ ' + seen.get(x.channel) + ' & ' + x.file);
    else seen.set(x.channel, x.file);
  });
  assert.deepStrictEqual(dup, []);
});

test('渲染层 send 的生命周期通道都有主进程监听', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  const sent = new Set();
  for (const m of preload.matchAll(/ipcRenderer\.send\('([^']+)'/g)) sent.add(m[1]);

  const sources = readMainProcessSources();
  const listened = new Set(
    collectMatches(/ipcMain\.on(?:ce)?\('([^']+)'/g, sources).map(function (x) { return x.channel; })
  );

  const missing = Array.from(sent).filter(function (c) { return !listened.has(c); });
  assert.deepStrictEqual(missing, [], '渲染层 send 但主进程未监听的通道');
});

test('electron/ipc/*.js 的相对 require 路径都指向存在的文件', () => {
  const ipcDir = path.join(ROOT, 'electron', 'ipc');
  const broken = [];
  fs.readdirSync(ipcDir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
    const text = fs.readFileSync(path.join(ipcDir, f), 'utf8');
    for (const m of text.matchAll(/require\('(\.[^']+)'\)/g)) {
      const target = path.resolve(ipcDir, m[1]);
      if (!fs.existsSync(target)) broken.push(f + ' -> ' + m[1]);
    }
  });
  assert.deepStrictEqual(broken, [], 'require 路径解析失败（注意 ../.. 层级）');
});
