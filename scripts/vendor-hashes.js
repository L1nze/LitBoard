#!/usr/bin/env node
'use strict';

/* 生成 vendor/ 第三方文件的 SHA-256 校验文件（SHA256SUMS）。
 * 台账 docs/THIRD-PARTY.md 承诺构建产物可追溯到 vendor 源文件；升级 vendor 后运行：
 *   node scripts/vendor-hashes.js
 * 校验（CI 或本地）：
 *   node scripts/vendor-hashes.js --check
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'vendor');
const outFile = path.join(vendorDir, 'SHA256SUMS');
const checkOnly = process.argv.includes('--check');

const EXTS = new Set(['.js', '.mjs', '.wasm', '.json', '.css', '.xml', '.csl', '.txt']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) { return a.name < b.name ? -1 : 1; })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name !== 'SHA256SUMS' &&
      (EXTS.has(path.extname(entry.name)) || /^(LICENSE|COPYING|NOTICE)([._-].*)?$/i.test(entry.name))) out.push(full);
  }
  return out;
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const files = walk(vendorDir);
const lines = files.map(function (file) {
  return hash(file) + '  ' + path.relative(root, file).split(path.sep).join('/');
});

if (checkOnly) {
  if (!fs.existsSync(outFile)) {
    console.error('vendor-hashes: 缺少 SHA256SUMS，先运行 node scripts/vendor-hashes.js 生成');
    process.exit(1);
  }
  const expected = fs.readFileSync(outFile, 'utf8').trim().split('\n').sort();
  const actual = lines.slice().sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    console.error('vendor-hashes: 校验失败——vendor 内容与 SHA256SUMS 不一致（升级 vendor 后请重新生成）');
    process.exit(1);
  }
  console.log('vendor-hashes: OK（%d 个文件）', actual.length);
} else {
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  console.log('vendor-hashes: 写入 %s（%d 个文件）', path.relative(root, outFile), lines.length);
}
