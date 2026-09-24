'use strict';
/* 构建 Rust 图谱内核并入库：cargo build --release → 拷贝 .node 到 vendor/litgraph/ →
 * 刷新 vendor/SHA256SUMS。Rust 工具链在用户目录（~/.cargo），构建缓存在
 * %LOCALAPPDATA%\LitBoardBuildTools\rust-target——都不进项目目录（零 node_modules 约定）。
 * CI 不装 Rust：仓库提交预编译产物，改动内核源码后在本机跑本脚本重新入库。
 * 用法：node scripts/litgraph-bundle/build.js */
const { execFileSync } = require('node:child_process');
const fsSync = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..', '..');
const crateDir = path.join(__dirname, 'rust');
const outDir = path.join(repo, 'vendor', 'litgraph');
const artifact = 'litgraph.win32-x64-msvc.node';

const home = process.env.USERPROFILE || process.env.HOME || '';
const cargo = process.env.CARGO || path.join(home, '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const targetDir = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'LitBoardBuildTools', 'rust-target');

console.log('cargo build --release（target: ' + targetDir + '）');
execFileSync(cargo, ['build', '--release'], {
  cwd: crateDir,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { CARGO_TARGET_DIR: targetDir })
});
fsSync.mkdirSync(outDir, { recursive: true });
const dll = process.platform === 'win32' ? 'litgraph.dll' : 'liblitgraph.so';
fsSync.copyFileSync(path.join(targetDir, 'release', dll), path.join(outDir, artifact));
console.log('已拷贝 ' + artifact + ' → vendor/litgraph/（' + fsSync.statSync(path.join(outDir, artifact)).size + ' 字节）');
execFileSync(process.execPath, [path.join(repo, 'scripts', 'vendor-hashes.js')], { stdio: 'inherit' });
console.log('vendor/SHA256SUMS 已刷新');
