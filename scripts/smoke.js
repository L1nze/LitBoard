#!/usr/bin/env node
'use strict';

/* 标准功能冒烟：隔离目录启动 Electron，跑 index.html / 主流程断言（断言本体在 electron/main.js）。
 * 用法：npm run smoke [-- /path/to/electron.exe]
 * 可选：LITBOARD_SMOKE_PDF=<pdf> 验证渲染；LITBOARD_SMOKE_SHOT=<png> 截图；LITBOARD_SMOKE_SCALE=<倍数>。
 * 退出码 0 = 全部断言通过。切勿用真实 userData 运行。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = process.argv[2] || path.join(
  process.env.LOCALAPPDATA || '', 'LitBoardBuildTools', 'node_modules', 'electron', 'dist', 'electron.exe');

if (!fs.existsSync(electronPath)) {
  console.error('smoke: 找不到 electron.exe（%s）。可传参指定路径，或先运行 npm start 安装外置工具。', electronPath);
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'litboard-smoke-'));
const resultFile = path.join(workDir, 'result.json');
const env = Object.assign({}, process.env, {
  LITBOARD_SMOKE_TEST: '1',
  LITBOARD_SMOKE_RESULT: resultFile
});
const run = spawnSync(electronPath, ['.', '--user-data-dir=' + path.join(workDir, 'userdata')], {
  cwd: projectRoot,
  env: env,
  encoding: 'utf8',
  timeout: 120000,
  windowsHide: true
});
let payload = null;
try {
  payload = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  console.log(JSON.stringify(payload, null, 2));
} catch (e) {
  console.error('smoke: 未取得结果文件');
}
fs.rmSync(workDir, { recursive: true, force: true });
if (run.status !== 0 || !payload) {
  console.error('smoke: 失败（exit=%s）', run.status);
  console.error((run.stdout || '').slice(-2000), (run.stderr || '').slice(-2000));
  process.exit(1);
}
console.log('smoke: PASS');
