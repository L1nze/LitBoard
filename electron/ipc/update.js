'use strict';

/* app:* 应用更新通道（自 ipc/backup.js 拆出）：版本查询、手动检查、状态快照、应用更新。
 * 下载 / 校验 / 单份缓存状态机在 electron/update-check.js（ctx.updateManager），
 * 本域只做转发与空值守卫；check-update 触发检查并联动后台预下载。 */

const { app } = require('electron');
const ctx = require('./context.js');

module.exports = { register: register };

function register() {
  ctx.handle('app:get-version', function () { return app.getVersion(); });
  ctx.handle('app:check-update', async function () {
    if (!ctx.updateManager) return null;
    return ctx.updateManager.checkNow();
  });
  ctx.handle('app:update-status', function () {
    return ctx.updateManager ? ctx.updateManager.snapshot() : null;
  });
  ctx.handle('app:apply-update', async function () {
    if (!ctx.updateManager) return { ok: false, reason: 'unavailable' };
    return ctx.updateManager.applyUpdate();
  });
}
