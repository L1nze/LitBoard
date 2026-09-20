#!/usr/bin/env node
'use strict';

/* M5 发布材料：为 dist/ 下待发布的安装包生成 SHA256SUMS.txt（含大小与构建环境说明头）。
 * 用法：npm run dist 之后运行  node scripts/release-checksums.js
 * 输出：dist/SHA256SUMS.txt（请与安装包一同发布，供用户核对完整性。）
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!fs.existsSync(distDir)) {
  console.error('release-checksums: dist/ 不存在，请先运行 npm run dist');
  process.exit(1);
}

const files = fs.readdirSync(distDir).filter(function (name) {
  return /\.(exe|zip|blockmap)$/i.test(name);
}).sort();

if (!files.length) {
  console.error('release-checksums: dist/ 下没有可校验的发布文件');
  process.exit(1);
}

const lines = [
  '# LitBoard ' + pkg.version + ' — SHA-256 校验和',
  '# 生成时间: ' + new Date().toISOString(),
  '# 构建环境: Windows x64 · Electron ' + pkg.devDependencies.electron +
    ' · electron-builder ' + pkg.devDependencies['electron-builder'],
  '# 核对方式（PowerShell）: Get-FileHash <文件> -Algorithm SHA256',
  '# 核对方式（Linux/macOS）: sha256sum -c SHA256SUMS.txt',
  ''
];

for (const name of files) {
  const full = path.join(distDir, name);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  const sizeMB = (fs.statSync(full).size / 1024 / 1024).toFixed(1);
  lines.push(hash + '  ' + name + '  (' + sizeMB + ' MB)');
}

const outFile = path.join(distDir, 'SHA256SUMS.txt');
fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
console.log('release-checksums: 写入 ' + outFile);
console.log(lines.slice(7).join('\n'));
