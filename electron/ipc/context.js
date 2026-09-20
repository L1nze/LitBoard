'use strict';

/* IPC 域模块的共享上下文（单例；CommonJS require 缓存保证全局唯一）。
 *
 * main.js 在启动装配时把子系统实例写进这里；各域模块（ipc/*.js）在 handler 被调用时
 * 读 ctx.X 属性——**必须调用时读取、禁止解构成 const 捕获**：
 * - bridgeServer 在 registerAll() 之后才创建（注册时它还是 null）；
 * - researchDb / agentSessions 初始化失败时为 null（handler 带 null 守卫）；
 * - mainWindow 可被 activate 重建（main.js 侧单点镜像写入 ctx）；
 * - dataPathState 在备份 / 数据目录切换 / 迁移重试等多处重赋值。
 *
 * 跨域共享标志：forceQuitNext（backup:restore / app:relaunch 写，关闭拦截读）、
 * syncInFlight 与 lastLibraryWriteAt（integrations / library 域写，向量空闲调度 isIdle 读）。 */

const { app, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const LitI18n = require('../../js/i18n.js');
require('../../js/i18n-en.js');

const ctx = {
  T: LitI18n.t.bind(LitI18n),
  // —— 可变子系统引用（main.js 启动装配写入；域模块调用时读取）——
  mainWindow: null,
  dataPathManager: null,
  dataPathState: null,
  libraryDb: null,
  integrations: null,
  bridgeServer: null,
  wordBridgeInstance: null,
  backupManager: null,
  researchDb: null,
  researchNet: null,
  researchEmbedder: null,
  embedService: null,
  agentNet: null,
  agentSessions: null,
  webFetchNet: null,
  // —— 跨域共享标志 ——
  forceQuitNext: false,
  syncInFlight: false,
  lastLibraryWriteAt: 0
};

// —— 启动诊断日志：全进程唯一实例（整文件重写式，出现两份会互相覆盖）。
// 打包版没有控制台，「进程在但窗口没出来」这类问题靠它定位；每条整体重写文件，
// 失败静默（诊断不能反噬启动）。 ——
let startupLogBuffer = [];
let startupLogFile = '';
function startupLog(message) {
  startupLogBuffer.push(new Date().toISOString() + ' ' + message);
  if (startupLogBuffer.length > 400) startupLogBuffer.splice(0, startupLogBuffer.length - 400);
  const target = startupLogFile || path.join(app.getPath('userData'), 'litboard-startup.log');
  fs.writeFile(target, startupLogBuffer.join('\n') + '\n', 'utf8').catch(function () {});
}
ctx.startupLog = startupLog;
ctx.setStartupLogFile = function (file) { startupLogFile = file; };

/* M2 IPC 加固：统一校验调用来源——只接受主窗口顶层 frame 的调用。
 * 渲染层进程被攻破时，子 frame / 伪造 sender 无法直接触达文件与数据库通道。
 * （sandbox+contextIsolation 已开启；这里补的是纵深防御。） */
function isTrustedSender(event) {
  if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return false;
  if (event.sender !== ctx.mainWindow.webContents) return false;
  const frame = event.senderFrame;
  if (frame && frame.parent) return false; // 拒绝子 iframe
  return true;
}

function handle(channel, fn) {
  ipcMain.handle(channel, function (event, ...args) {
    if (!isTrustedSender(event)) throw new Error(ctx.T('LitBoard: 非受信调用来源（') + channel + '）');
    return fn(event, ...args);
  });
}
ctx.handle = handle;

module.exports = ctx;
