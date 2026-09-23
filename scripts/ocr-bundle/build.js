'use strict';

/**
 * LitBoard OCR vendor 构建脚本（一次性外置构建，仓库保持零 node_modules）。
 *
 * 依赖安装在外置工具目录（比照 agent-ui-bundle / ensure-tools 惯例）：
 *   %LOCALAPPDATA%\LitBoardOcrTools\node_modules\{@paddleocr/paddleocr-js}
 * 用法：node scripts/ocr-bundle/build.js
 * 产物 vendor/paddleocr/：
 *   paddleocr.js   —— 主线程驱动 IIFE（挂 window.LitPaddleOcr；OpenCV 已 stub 剥离）
 *   worker-entry.js —— SDK module worker bundle（含 OpenCV；patch 掉 file:// 守卫）
 *   ort/…          —— onnxruntime-web 1.24.3 的 wasm（jsep 与非 jsep 四件）
 *
 * 版本唯一真源：本目录 package.json。升级依赖后必须重跑 vendor-hashes 并更新 docs/THIRD-PARTY.md；
 * worker-entry 的 patch 锚点计数不符会直接抛错（SDK 结构漂移需人工复核）。
 */
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const toolsDir = process.env.LITBOARD_OCR_TOOLS
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LitBoardOcrTools');
const outDir = path.join(repoRoot, 'vendor', 'paddleocr');

const ORT_VERSION = '1.24.3'; // 与 @paddleocr/paddleocr-js 0.4.2 的 CDN fallback 同版（探针已验证互通）
const ORT_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'
];

function ensureDeps() {
  const sdk = path.join(toolsDir, 'node_modules', '@paddleocr', 'paddleocr-js');
  if (fsSync.existsSync(sdk)) return;
  const pinned = JSON.parse(fsSync.readFileSync(path.join(scriptDir, 'package.json'), 'utf8'));
  const deps = Object.entries(pinned.dependencies).map(function (entry) { return entry[0] + '@' + entry[1]; });
  console.log('[ocr-bundle] installing deps to ' + toolsDir);
  fsSync.mkdirSync(toolsDir, { recursive: true });
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--prefix', toolsDir, '--no-audit', '--no-fund'].concat(deps),
    { stdio: 'inherit', shell: process.platform === 'win32' });
}

function buildMain() {
  const esbuild = require(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'LitBoardAuiTools', 'node_modules', 'esbuild'));
  const outfile = path.join(outDir, 'paddleocr.js');
  esbuild.buildSync({
    entryPoints: [path.join(scriptDir, 'entry.mjs')],
    bundle: true,
    format: 'iife',
    globalName: 'LitPaddleOcrBundle',
    target: 'es2022',
    minify: true,
    outfile: outfile,
    nodePaths: [path.join(toolsDir, 'node_modules')],
    // opencv.js Emscripten 壳的 Node 分支 require("fs"/"path")，浏览器不执行，标 external 保留惰性调用
    external: ['fs', 'path'],
    // 主线程剥除 OpenCV：worker 模式主线程用不到；其加载期 new Function 被 CSP 拦（探针已证）
    alias: { '@techstark/opencv-js': path.join(scriptDir, 'opencv-stub.mjs') },
    logLevel: 'warning'
  });
  console.log('[ocr-bundle] built paddleocr.js (' + Math.round(fsSync.statSync(outfile).size / 1024) + ' KB)');
}

function buildWorker() {
  // SDK 只随包发布聚合后的 worker bundle（dist/assets/worker-entry-*.js），直接拷贝并 patch：
  // handleInit 硬编码 ensureServedFromHttp（location.protocol === 'file:' 即 throw）。
  // 该检查假设浏览器（file:// fetch 必失败）；Electron file:// 下 fetch(file://) 实测可用
  // （scripts/one-off/probe-paddleocr/ T1）。锚点计数=1 防版本漂移静默漏 patch。
  const assetsDir = path.join(toolsDir, 'node_modules', '@paddleocr', 'paddleocr-js', 'dist', 'assets');
  const entries = fsSync.readdirSync(assetsDir).filter(function (f) { return f.endsWith('.js'); });
  if (entries.length !== 1) throw new Error('worker-entry 候选数=' + entries.length + '（预期 1）——SDK 结构漂移，需人工复核');
  let src = fsSync.readFileSync(path.join(assetsDir, entries[0]), 'utf8');
  const needle = 'if (globalThis.location.protocol === "file:")';
  const hits = src.split(needle).length - 1;
  if (hits !== 1) throw new Error('worker-entry patch 锚点计数=' + hits + '（预期 1）——SDK 版本漂移，需人工复核');
  src = src.replace(needle, 'if (false) /* LitBoard: Electron file:// fetch 可用（探针 T1），浏览器的 file: 守卫不适用 */');
  const outfile = path.join(outDir, 'worker-entry.js');
  fsSync.writeFileSync(outfile, src);
  console.log('[ocr-bundle] built worker-entry.js (' + Math.round(fsSync.statSync(outfile).size / 1024) + ' KB, patched file-origin guard)');
}

function stageOrt() {
  // ort wasm 从 npm 拉的 tarball 里取（不信任 CDN 单文件直链的长期稳定性；版本与 package.json 钉版对齐）
  const cacheDir = path.join(toolsDir, 'ort-cache');
  fsSync.mkdirSync(cacheDir, { recursive: true });
  const tgz = path.join(cacheDir, 'onnxruntime-web-' + ORT_VERSION + '.tgz');
  if (!fsSync.existsSync(tgz)) {
    console.log('[ocr-bundle] fetching onnxruntime-web@' + ORT_VERSION + ' ...');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', 'onnxruntime-web@' + ORT_VERSION, '--pack-destination', cacheDir],
      { stdio: 'inherit', cwd: cacheDir, shell: process.platform === 'win32' });
    const packed = path.join(cacheDir, 'onnxruntime-web-' + ORT_VERSION + '.tgz');
    if (packed !== tgz && fsSync.existsSync(packed)) fsSync.renameSync(packed, tgz);
  }
  const extractDir = path.join(cacheDir, 'onnxruntime-web-' + ORT_VERSION);
  if (!fsSync.existsSync(path.join(extractDir, 'package'))) {
    fsSync.mkdirSync(extractDir, { recursive: true });
    // 相对路径 + cwd：Windows 下 tar 把绝对路径里的 "C:" 当远程主机，反斜杠又会被引号转义弄坏
    execFileSync('tar', ['-xzf', path.relative(extractDir, tgz)], { stdio: 'inherit', cwd: extractDir });
  }
  for (const f of ORT_FILES) {
    const from = path.join(extractDir, 'package', 'dist', f);
    const to = path.join(outDir, 'ort', f);
    fsSync.mkdirSync(path.dirname(to), { recursive: true });
    fsSync.copyFileSync(from, to);
    console.log('[ocr-bundle] ort/' + f + ' (' + Math.round(fsSync.statSync(to).size / 1024) + ' KB)');
  }
}

function copyLicense() {
  // SDK 与 ort 的许可信息随包分发（THIRD-PARTY 台账引用）
  const sdkPkg = path.join(toolsDir, 'node_modules', '@paddleocr', 'paddleocr-js');
  const copies = [
    [path.join(sdkPkg, 'package.json'), 'package.paddleocr-js.json']
  ];
  for (const [from, name] of copies) {
    if (!fsSync.existsSync(from)) { console.log('[ocr-bundle] WARN missing ' + from); continue; }
    fsSync.copyFileSync(from, path.join(outDir, name));
    console.log('[ocr-bundle] ' + name);
  }
  // onnxruntime-web npm 包不带 LICENSE 文件（许可在上游仓库根目录），落一份许可指津避免歧义
  fsSync.writeFileSync(path.join(outDir, 'LICENSE.onnxruntime-web.txt'),
    'onnxruntime-web ' + ORT_VERSION + ' — MIT License.\n' +
    'Copyright (c) Microsoft Corporation.\n' +
    'Upstream: https://github.com/microsoft/onnxruntime (LICENSE at repo root).\n' +
    'The npm package (onnxruntime-web) distributes dist artifacts without a bundled\n' +
    'LICENSE file; this notice records the upstream license for the vendored copies\n' +
    'under vendor/paddleocr/ort/.\n');
  console.log('[ocr-bundle] LICENSE.onnxruntime-web.txt');
}

fsSync.mkdirSync(outDir, { recursive: true });
ensureDeps();
buildMain();
buildWorker();
stageOrt();
copyLicense();
console.log('[ocr-bundle] next: node scripts/vendor-hashes.js && update docs/THIRD-PARTY.md');
