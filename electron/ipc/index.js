'use strict';

/* IPC 域注册入口：main.js 在启动序列的原 registerIpc() 调用点调用 registerAll()。
 * 每个域模块各自 require('./context.js') 取共享状态与 handle 脚手架；
 * 注册必须在 createWindow() 之前、bridgeServer 创建之前完成（与原顺序一致）。
 * 注意：ipcMain.handle 对同一通道二次注册会抛错——registerAll 全进程只允许调用一次。 */

const windowDomain = require('./window.js');
const wordDomain = require('./word.js');
const libraryDomain = require('./library.js');
const backupDomain = require('./backup.js');
const bridgeDomain = require('./bridge.js');
const integrationsDomain = require('./integrations.js');
const filesDomain = require('./files.js');
const ocrDomain = require('./ocr.js');
const pdfsearchDomain = require('./pdfsearch.js');
const researchDomain = require('./research.js');
const agentDomain = require('./agent.js');
const apiDomain = require('./api.js');

function registerAll() {
  windowDomain.register();
  wordDomain.register();
  libraryDomain.register();
  backupDomain.register();
  bridgeDomain.register();
  integrationsDomain.register();
  filesDomain.register();
  ocrDomain.register();
  pdfsearchDomain.register();
  researchDomain.register();
  agentDomain.register();
  apiDomain.register();
}

module.exports = { registerAll: registerAll };
