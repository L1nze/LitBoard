#!/usr/bin/env node
'use strict';

/*
 * 跨平台的 `npm run lint`。
 *
 * 本项目约定「项目目录零 node_modules」，所以 eslint 可能不在本地：
 *   1) 若项目内已 npm install（CI 走 `npm ci` 即是这种情况）→ 用项目的 eslint；
 *   2) 否则用/安装到独立的外置工具目录：
 *      Windows  %LOCALAPPDATA%\LitBoardLintTools
 *      其它系统 $XDG_CACHE_HOME/litboard-lint-tools（默认 ~/.cache/...）
 *      可用环境变量 LITBOARD_LINT_TOOLS_DIR 覆盖。
 *
 * 注意：不要和 %LOCALAPPDATA%\LitBoardBuildTools（Electron/electron-builder）共用目录 ——
 * `npm install --prefix` 会裁掉不在本次依赖集里的包，两边会互相删除。
 *
 * 不直接写 `eslint .` 的原因：在零 node_modules 环境下 PATH 里没有 eslint。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(__dirname, '..');
const ESLINT_BIN = path.join('node_modules', 'eslint', 'bin', 'eslint.js');
const isWindows = process.platform === 'win32';

function resolveToolsDir() {
  if (process.env.LITBOARD_LINT_TOOLS_DIR) return process.env.LITBOARD_LINT_TOOLS_DIR;
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'LitBoardLintTools');
  }
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheHome, 'litboard-lint-tools');
}

function findEslint() {
  const candidates = [
    path.join(projectDir, ESLINT_BIN),
    path.join(resolveToolsDir(), ESLINT_BIN),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readEslintRange() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  const range = (pkg.devDependencies && pkg.devDependencies.eslint) || '';
  // 去掉 ^ ~ 前缀：Windows 下命令经 cmd.exe 解释时 `^` 是转义符，且外置工具与本项目一样倾向精确版本
  return range.replace(/^[\^~>=<\s]+/, '');
}

function installEslint() {
  const target = resolveToolsDir();
  const version = readEslintRange();
  fs.mkdirSync(target, { recursive: true });
  console.log('[litboard] 未找到 eslint，正在安装到 ' + target + ' …');
  const result = spawnSync(
    isWindows ? 'npm.cmd' : 'npm',
    ['install', '--prefix', target, '--no-save', '--no-audit', '--no-fund', 'eslint@' + version],
    { stdio: 'inherit', shell: isWindows }
  );
  if (result.status !== 0) {
    console.error('[litboard] 安装 eslint 失败；可先执行 `npm install` 再重试。');
    process.exit(result.status || 1);
  }
}

let eslintBin = findEslint();
if (!eslintBin) {
  installEslint();
  eslintBin = findEslint();
}
if (!eslintBin) {
  console.error('[litboard] 仍然找不到 eslint，请检查工具目录或改用 `npm install`。');
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const result = spawnSync(process.execPath, [eslintBin].concat(extraArgs.length ? extraArgs : ['.']), {
  cwd: projectDir,
  stdio: 'inherit',
});

process.exit(result.status === null ? 1 : result.status);
