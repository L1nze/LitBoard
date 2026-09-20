'use strict';

/**
 * LitBoard AI 助手对话层构建脚本（一次性外置构建，仓库保持零 node_modules）。
 *
 * 依赖安装在外置工具目录（比照 ensure-tools / lint.js 惯例）：
 *   %LOCALAPPDATA%\LitBoardAuiTools\node_modules\{react, react-dom, @assistant-ui/react, esbuild}
 * 用法：node scripts/agent-ui-bundle/build.js
 * 产物：vendor/assistant-ui/agent-chat.js（自包含 IIFE，挂 window.LitAgentChat）
 *
 * 版本唯一真源：本目录 package.json（与 scripts/ensure-tools.ps1 的约定一致）。
 * 升级依赖后必须重跑 vendor-hashes 并更新 docs/THIRD-PARTY.md。
 */
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const toolsDir = process.env.LITBOARD_AUI_TOOLS
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LitBoardAuiTools');

function ensureDeps() {
  const esbuildPath = path.join(toolsDir, 'node_modules', 'esbuild');
  if (fsSync.existsSync(esbuildPath)) return;
  const pinned = JSON.parse(fsSync.readFileSync(path.join(scriptDir, 'package.json'), 'utf8'));
  const deps = Object.entries(Object.assign({}, pinned.dependencies, pinned.devDependencies))
    .map(function (entry) { return entry[0] + '@' + entry[1]; });
  console.log('[agent-ui-bundle] installing deps to ' + toolsDir);
  fsSync.mkdirSync(toolsDir, { recursive: true });
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--prefix', toolsDir, '--no-audit', '--no-fund'].concat(deps),
    { stdio: 'inherit' });
}

function build() {
  ensureDeps();
  const esbuild = require(path.join(toolsDir, 'node_modules', 'esbuild'));
  const outfile = path.join(repoRoot, 'vendor', 'assistant-ui', 'agent-chat.js');
  fsSync.mkdirSync(path.dirname(outfile), { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(scriptDir, 'main.jsx')],
    bundle: true,
    format: 'iife',
    globalName: 'LitAgentChat',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    outfile: outfile,
    // 依赖装在外置工具目录（仓库零 node_modules），必须显式给出解析路径，
    // 否则 esbuild 从入口目录向上找不到 react / @assistant-ui
    nodePaths: [path.join(toolsDir, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.FALSE': 'false' },
    legalComments: 'inline'
  });
  const size = fsSync.statSync(outfile).size;
  console.log('[agent-ui-bundle] built ' + path.relative(repoRoot, outfile) + ' (' + Math.round(size / 1024) + ' KB)');
  console.log('[agent-ui-bundle] next: npm run vendor-hashes && update docs/THIRD-PARTY.md');
}

build();
