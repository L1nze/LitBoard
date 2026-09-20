'use strict';

/* bridge:* —— 浏览器扩展本地桥接（127.0.0.1 服务；从 main.js registerIpc 平移）。
 * 注意晚绑定：bridgeServer 在 registerAll() 之后才由 main.js 创建，这里必须调用时读 ctx。 */

const ctx = require('./context.js');

module.exports = { register: register };

function register() {
  ctx.handle('bridge:status', async function () {
    const status = ctx.bridgeServer ? ctx.bridgeServer.status() : { running: false, port: null };
    return {
      running: status.running,
      port: status.port,
      token: ctx.bridgeServer ? await ctx.bridgeServer.getToken() : ''
    };
  });
  ctx.handle('bridge:set-enabled', async function (_event, enabled) {
    await ctx.libraryDb.setSetting('bridgeEnabled', !!enabled);
    if (!ctx.bridgeServer) return { running: false };
    if (enabled) await ctx.bridgeServer.start();
    else await ctx.bridgeServer.stop();
    return ctx.bridgeServer.status();
  });
  ctx.handle('bridge:set-current-folder', function (_event, folderId) {
    if (ctx.bridgeServer) ctx.bridgeServer.setCurrentFolder(folderId);
  });
}
