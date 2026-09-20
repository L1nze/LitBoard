#!/usr/bin/env node
'use strict';

/* 生命周期冒烟（M1-4 / M5-CI）：真实「写入 → 关闭 → 重启 → 校验」两阶段，跑在隔离目录。
 * 覆盖 M1 关闭收尾握手：阶段一写入文献后调用真实窗口关闭（主进程拦截 → 渲染层等待保存
 * 持久化 → close-ack 放行）；阶段二全新进程加载同一隔离库，断言数据一致。
 *
 * 用法：node scripts/smoke-lifecycle.js [electron.exe 路径]
 * electron 路径缺省按 ensure-tools 约定取 %LOCALAPPDATA%\LitBoardBuildTools。
 * 退出码 0 = 通过；工作目录应为项目根（读取 electron/main.js）。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronArg = process.argv[2] || '';
const electronPath = electronArg || path.join(
  process.env.LOCALAPPDATA || '', 'LitBoardBuildTools', 'node_modules', 'electron', 'dist', 'electron.exe');

if (!fs.existsSync(electronPath)) {
  console.error('smoke-lifecycle: 找不到 electron.exe（%s）。可传参指定路径，或先运行 npm start 安装外置工具。', electronPath);
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'litboard-lifecycle-'));
const userData = path.join(workDir, 'userdata');

function phase(mode, timeoutMs) {
  const resultFile = path.join(workDir, mode + '.json');
  const env = Object.assign({}, process.env, {
    LITBOARD_SMOKE_TEST: '1',
    LITBOARD_SMOKE_LIFECYCLE: mode,
    LITBOARD_SMOKE_RESULT: resultFile
  });
  const run = spawnSync(electronPath, ['.', '--user-data-dir=' + userData], {
    cwd: projectRoot,
    env: env,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  });
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch (e) {}
  return { status: run.status, payload: payload, stdout: run.stdout || '', stderr: run.stderr || '' };
}

console.log('smoke-lifecycle: 阶段一 write（写入 + 真实关闭）…');
const writePhase = phase('write', 90000);
if (writePhase.status !== 0 || !writePhase.payload || !writePhase.payload.closedCleanly) {
  console.error('smoke-lifecycle: write 阶段失败（status=%s）', writePhase.status);
  console.error(writePhase.stdout.slice(-2000), writePhase.stderr.slice(-2000));
  process.exit(1);
}
console.log('smoke-lifecycle: 写入 %s 条，关闭收尾 ack=%s',
  writePhase.payload.countAfterSave, writePhase.payload.closedCleanly);

console.log('smoke-lifecycle: 阶段二 verify（重启后校验）…');
const verifyPhase = phase('verify', 90000);
if (verifyPhase.status !== 0 || !verifyPhase.payload || !verifyPhase.payload.consistent) {
  console.error('smoke-lifecycle: verify 阶段失败（status=%s）', verifyPhase.status);
  console.error(writePhase.stdout.slice(-2000), verifyPhase.stderr.slice(-2000));
  process.exit(1);
}
console.log('smoke-lifecycle: 重启后 paperCount=%s，title 一致 → PASS', verifyPhase.payload.paperCount);
fs.rmSync(workDir, { recursive: true, force: true });
