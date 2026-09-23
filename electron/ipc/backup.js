'use strict';

/* backup:* + data-paths:* + app:relaunch —— 完整备份、数据目录切换与重启语义
 * （自 main.js registerIpc 平移）。三个组共享 ctx.forceQuitNext：恢复/目录切换重启
 * 跳过渲染层保存收尾（数据库已切换，收尾无意义），关闭拦截读同一标志放行。 */

const { app, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const ctx = require('./context.js');

module.exports = { register: register };

function register() {
  ctx.handle('backup:status', function () { return ctx.backupManager.status(); });
  ctx.handle('backup:choose-dir', async function () {
    const result = await dialog.showOpenDialog(ctx.mainWindow, {
      title: ctx.T('选择 LitBoard 完整备份目录（独立于配置与文献库目录，建议放 OneDrive 或外接盘）'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const directory = result.filePaths[0];
    try {
      ctx.dataPathManager.stageBackupDir(directory);
      ctx.dataPathState = ctx.dataPathManager.getState();
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
    // 已有快照目录只读挂载，不先写入空库快照，避免首次恢复触发轮换删除历史版本。
    const existing = await ctx.backupManager.listSnapshots(directory);
    const backup = existing.some(function (item) { return item.valid; })
      ? { ok: false, skipped: true, existing: true }
      : await ctx.backupManager.createSnapshot();
    return { backupDir: directory, backup: backup };
  });
  ctx.handle('backup:run', function () { return ctx.backupManager.createSnapshot(); });
  ctx.handle('backup:set-keep', function (_event, value) {
    try {
      ctx.dataPathState = ctx.dataPathManager.stageBackupKeep(value);
      return { ok: true, keepSnapshots: ctx.dataPathState.backupKeep };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  // 遗留文件清理：扫描只读，清理只删扫描列出的东西（详见 backup.js 的 scanLeftovers 注释）
  ctx.handle('backup:scan-leftovers', function () { return ctx.backupManager.scanLeftovers(); });
  ctx.handle('backup:clean-leftovers', function () { return ctx.backupManager.cleanLeftovers(); });
  ctx.handle('backup:restore', async function (_event, snapshotId) {
    // 手动恢复：先以当前库成功创建紧急快照，再校验所选快照、还原并重启应用
    // 紧急快照不参与本次轮换，确保用户选择的旧快照不会在恢复前被删掉。
    const emergency = await ctx.backupManager.createSnapshot(null, { skipRotation: true, skipIfUnchanged: false });
    if (!emergency.ok) {
      return { ok: false, error: ctx.T('恢复前必须能成功创建当前库的紧急快照：') + (emergency.error || ctx.T('备份目录不可用')) };
    }
    const state = ctx.dataPathManager.getState();
    if (!state || !state.backupDir) return { ok: false, error: ctx.T('尚未配置备份目录') };
    await ctx.libraryDb.close();
    const restored = await ctx.backupManager.restoreSnapshot({
      snapshotId: String(snapshotId || ''), quarantineTag: 'before-restore'
    });
    if (!restored.ok) {
      const dbPath = ctx.libraryDb && ctx.libraryDb.paths && ctx.libraryDb.paths.file;
      let originalPresent = false;
      try { await fs.access(dbPath); originalPresent = true; } catch (error) {}
      if (originalPresent) {
        try { await ctx.libraryDb.open(); }
        catch (error) {
          setImmediate(function () { app.exit(1); });
          return { ok: false, error: restored.error + ctx.T('；原库重新打开失败：') + String(error && error.message || error) };
        }
      }
      if (!originalPresent) setImmediate(function () { app.exit(1); });
      return { ok: false, error: restored.error + (originalPresent ? '' : ctx.T('；原库文件不存在，已停止继续打开空库')) };
    }
    // 数据库已切换到历史状态，旧的远端基线不再可信；下次同步必须重新建立基线。
    await fs.rm(path.join(ctx.dataPathState.configDir, 'sync-base.json'), { force: true }).catch(function () {});
    // 还原成功：重启应用，让渲染层从新库重新加载（跳过关闭收尾：数据库已切换）
    setImmediate(function () {
      ctx.forceQuitNext = true;
      app.relaunch();
      app.quit();
    });
    return { ok: true, snapshotId: restored.snapshotId, assets: restored.assets };
  });
  ctx.handle('backup:open-dir', async function () {
    const state = ctx.dataPathManager.getState();
    if (!state || !state.backupDir) return ctx.T('尚未配置备份目录');
    return shell.openPath(state.backupDir);
  });
  ctx.handle('data-paths:get', function () {
    // getState 里是同步 fs（readFileSync 定位文件）：落在慢盘/云同步目录上会卡住主进程，
    // 表现为「打开设置整窗无响应」。超 2s 记 startupLog（与 integrations:get-config 同一 watchdog）
    const startedAt = Date.now();
    try {
      return ctx.dataPathManager.getState();
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed > 2000) ctx.startupLog('slow ipc: data-paths:get ' + elapsed + 'ms（设置打开卡顿来源）');
    }
  });
  ctx.handle('data-paths:stage', function (_event, value) {
    const result = ctx.dataPathManager.stage(value || {});
    ctx.dataPathState = ctx.dataPathManager.getState();
    return result;
  });
  ctx.handle('app:get-version', function () { return app.getVersion(); });
  ctx.handle('app:relaunch', function () {
    const current = ctx.dataPathManager.getState();
    if (!current.restartRequired) return false;
    setImmediate(function () {
      ctx.forceQuitNext = true; // 数据目录切换重启：跳过渲染层保存收尾
      app.relaunch();
      app.quit();
    });
    return true;
  });
}
