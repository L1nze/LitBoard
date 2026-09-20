'use strict';

/* window:* —— 无边框窗口的自绘窗口控制（自 main.js registerIpc 平移） */

const ctx = require('./context.js');

module.exports = { register: register };

function register() {
  ctx.handle('window:minimize', function () { if (ctx.mainWindow) ctx.mainWindow.minimize(); });
  ctx.handle('window:toggle-maximize', function () {
    if (!ctx.mainWindow) return false;
    if (ctx.mainWindow.isMaximized()) ctx.mainWindow.unmaximize();
    else ctx.mainWindow.maximize();
    return ctx.mainWindow.isMaximized();
  });
  ctx.handle('window:close', function () { if (ctx.mainWindow) ctx.mainWindow.close(); });
  ctx.handle('window:is-maximized', function () {
    return !!(ctx.mainWindow && !ctx.mainWindow.isDestroyed() && ctx.mainWindow.isMaximized());
  });
}
