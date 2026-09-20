#!/usr/bin/env node
'use strict';

/* 打包前的版本迭代：把 package.json 的 version 按语义化规则 +1，并同步 package-lock.json 的
 * 对应两处（顶层 version 与 packages[""]），让安装包名（LitBoard-Setup-<版本>-x64.exe）、
 * dist/SHA256SUMS.txt 与包内版本始终一致。version 的唯一真源仍是 package.json
 * （docs/releasing.md）——这里只是把「手动同步」变成打包流程的一步。
 *
 * 用法：
 *   node scripts/bump-version.js                  # patch +1（打包默认）
 *   node scripts/bump-version.js --level=minor     # major / minor / patch / none
 *   node scripts/bump-version.js --dry-run         # 只打印将要写入的版本，不改文件
 *   node scripts/bump-version.js --quiet           # 不打印（供脚本调用）
 *   node scripts/bump-version.js --root=<目录>      # 指定项目根（默认 = 本脚本的上一级）
 *
 * 只做定点替换、不重新序列化整个 JSON：package-lock.json 里 node_modules/* 的 version 是依赖
 * 版本，重排或误改都会污染锁文件，所以按位置精确替换并逐项校验。
 */

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = Object.freeze(['major', 'minor', 'patch']);
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
/* 顶层键的缩进用 [ \t] 而不是 \s：\s 会跨行匹配，可能把上一行的换行也吃进来 */
const TOP_VERSION_RE = /(^[ \t]*"version":[ \t]*")([^"]*)(")/m;
const ROOT_ENTRY_RE = /^([ \t]*)""[ \t]*:[ \t]*\{/m;

/** '1.2.3' + level → 下一个版本号；level 非法或当前版本不是 x.y.z 时抛错 */
function nextVersion(current, level) {
  const match = VERSION_PATTERN.exec(String(current == null ? '' : current).trim());
  if (!match) throw new Error('version 必须是 x.y.z 形式：' + JSON.stringify(current));
  if (LEVELS.indexOf(level) === -1) {
    throw new Error('未知的版本级别：' + JSON.stringify(level) + '（可用：' + LEVELS.join(' / ') + ' / none）');
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (level === 'major') return (major + 1) + '.0.0';
  if (level === 'minor') return major + '.' + (minor + 1) + '.0';
  return major + '.' + minor + '.' + (patch + 1);
}

/** package.json：全文只有这一个顶层 version 键，换掉它的值（其余字节原样保留） */
function replacePackageVersion(text, from, to) {
  const found = text.match(/^[ \t]*"version":[ \t]*"[^"]*"/gm) || [];
  if (found.length !== 1) throw new Error('package.json 里的顶层 "version" 键数量异常：' + found.length);
  const current = TOP_VERSION_RE.exec(text);
  if (!current || current[2] !== from) {
    throw new Error('package.json 的 version 与预期不符：' + JSON.stringify(current && current[2]));
  }
  return text.replace(TOP_VERSION_RE, '$1' + to + '$3');
}

/** package-lock.json：只改顶层与 packages[""] 两处，依赖条目的 version 一律不动 */
function replaceLockVersions(text, from, to) {
  const top = TOP_VERSION_RE.exec(text);
  if (!top) throw new Error('package-lock.json 缺少顶层 version');
  if (top[2] !== from) throw new Error('package-lock.json 的 version 与 package.json 不一致：' + JSON.stringify(top[2]));
  let out = text.replace(TOP_VERSION_RE, '$1' + to + '$3');
  const rootEntry = ROOT_ENTRY_RE.exec(out);
  if (!rootEntry) throw new Error('package-lock.json 缺少 packages[""] 条目');
  const offset = rootEntry.index + rootEntry[0].length;
  const tail = out.slice(offset);
  const inner = TOP_VERSION_RE.exec(tail);
  if (!inner) throw new Error('package-lock.json 的 packages[""] 里没有 version');
  if (inner[2] !== from) throw new Error('packages[""] 的 version 与预期不符：' + JSON.stringify(inner[2]));
  return out.slice(0, offset) + tail.replace(TOP_VERSION_RE, '$1' + to + '$3');
}

function writeIfChanged(file, before, after) {
  if (before === after) return false;
  fs.writeFileSync(file, after, 'utf8');
  return true;
}

/**
 * 迭代仓库版本号。
 * options = { root, level: 'major'|'minor'|'patch'|'none', dryRun }
 * 返回 { from, to, changed, files: [...] }；level='none' 时原样返回且不写文件。
 */
function bumpVersionFiles(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const root = opts.root ? path.resolve(opts.root) : path.resolve(__dirname, '..');
  const level = opts.level || 'patch';
  const pkgFile = path.join(root, 'package.json');
  const lockFile = path.join(root, 'package-lock.json');
  const pkgText = fs.readFileSync(pkgFile, 'utf8');
  const from = JSON.parse(pkgText).version;
  if (level === 'none') return { from: from, to: from, changed: false, files: [] };

  const to = nextVersion(from, level);
  const nextPkg = replacePackageVersion(pkgText, from, to);
  const hasLock = fs.existsSync(lockFile);
  const lockText = hasLock ? fs.readFileSync(lockFile, 'utf8') : '';
  const nextLock = hasLock ? replaceLockVersions(lockText, from, to) : '';

  // 写回前先确认结果可解析且版本确实变了（定点替换出错就宁可什么都不写）
  if (JSON.parse(nextPkg).version !== to) throw new Error('package.json 版本替换未生效');
  if (hasLock && JSON.parse(nextLock).version !== to) throw new Error('package-lock.json 版本替换未生效');

  const files = [];
  if (!opts.dryRun) {
    if (writeIfChanged(pkgFile, pkgText, nextPkg)) files.push(pkgFile);
    if (hasLock && writeIfChanged(lockFile, lockText, nextLock)) files.push(lockFile);
  }
  return { from: from, to: to, changed: true, files: files };
}

function parseArgs(argv) {
  const out = { level: 'patch', dryRun: false, quiet: false, root: '' };
  (argv || []).forEach(function (arg) {
    if (arg === '--dry-run') { out.dryRun = true; return; }
    if (arg === '--quiet') { out.quiet = true; return; }
    let match = /^--level=(.+)$/.exec(arg);
    if (match) { out.level = match[1].trim(); return; }
    match = /^--root=(.+)$/.exec(arg);
    if (match) { out.root = match[1].trim(); return; }
    throw new Error('未知参数：' + arg +
      '（可用：--level=<major|minor|patch|none>、--root=<目录>、--dry-run、--quiet）');
  });
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const result = bumpVersionFiles({ level: args.level, dryRun: args.dryRun, root: args.root || undefined });
  if (!args.quiet) {
    if (!result.changed) console.log('LitBoard 版本保持 ' + result.from + '（--level=none）');
    else console.log('LitBoard 版本：' + result.from + ' → ' + result.to +
      (args.dryRun ? '（--dry-run，未写入文件）' : ''));
  }
  return result;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error('bump-version: ' + (error && error.message || error));
    process.exit(1);
  }
}

module.exports = {
  LEVELS: LEVELS,
  nextVersion: nextVersion,
  replacePackageVersion: replacePackageVersion,
  replaceLockVersions: replaceLockVersions,
  bumpVersionFiles: bumpVersionFiles,
  parseArgs: parseArgs,
  main: main
};
