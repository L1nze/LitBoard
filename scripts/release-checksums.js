#!/usr/bin/env node
'use strict';

/* M5 发布材料：为 dist/ 下待发布的安装包生成 SHA256SUMS.txt（标准 sha256sum 格式及构建环境说明头）。
 * 用法：npm run dist 之后运行  node scripts/release-checksums.js
 * 输出：dist/SHA256SUMS.txt（请与安装包一同发布，供用户核对完整性。）
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function releaseFiles(dir, version) {
  const expected = [
    `LitBoard-Setup-${version}-x64.exe`,
    `LitBoard-Portable-${version}-x64.exe`
  ];
  const missing = expected.filter(function (name) {
    return !fs.existsSync(path.join(dir, name));
  });
  if (missing.length) {
    throw new Error('缺少当前版本安装包：' + missing.join('、'));
  }
  // 扩展包也带版本号；历史版本 exe/zip/blockmap 一律排除。
  const extension = `LitBoard-Extension-${version}.zip`;
  if (fs.existsSync(path.join(dir, extension))) expected.push(extension);
  return expected;
}

function main() {
  if (!fs.existsSync(distDir)) {
    throw new Error('dist/ 不存在，请先运行 npm run dist');
  }
  const files = releaseFiles(distDir, pkg.version);
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
    lines.push(hash + '  ' + name);
  }

  const outFile = path.join(distDir, 'SHA256SUMS.txt');
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  console.log('release-checksums: 写入 ' + outFile);
  console.log(lines.slice(6).join('\n'));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('release-checksums: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { releaseFiles };
