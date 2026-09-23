'use strict';

/* integrations:* —— 坚果云同步 / 翻译 / Zotero / 期刊分级等集成服务（自 main.js
 * registerIpc 平移）。ctx.syncInFlight 是向量空闲调度 isIdle 的输入（跨域共享）。
 * 注意：本文件是 integrations:* 通道的注册层，服务本体在 ../integrations.js。 */

const { clipboard, dialog } = require('electron');
const ctx = require('./context.js');

module.exports = { register: register };

async function getPortableSyncSettings() {
  const keys = ['trashRetentionDays', 'autoWriteBack', 'renameTemplate', 'proxyPrefix'];
  const settings = {};
  for (const key of keys) {
    const value = await ctx.libraryDb.getSetting(key);
    if (value !== null && value !== undefined) settings[key] = value;
  }
  return settings;
}

async function applyPortableSyncSettings(config) {
  if (!config || typeof config !== 'object') return;
  const values = {
    trashRetentionDays: config.trashRetentionDays,
    autoWriteBack: config.autoWriteBack
  };
  for (const key of Object.keys(values)) {
    if (values[key] !== null && values[key] !== undefined) await ctx.libraryDb.setSetting(key, values[key]);
  }
}

function register() {
  // 设置弹窗打开的头一道 IPC。有一例「进设置整窗无响应」的报告在隔离环境无法复现
  // （渲染层实测 30ms 内完成），最可能的主进程侧嫌疑是本通道或 data-paths:get 被卡；
  // 超过 2s 落一条 startupLog——复发时 litboard-startup.log 直接指出卡在哪条通道、多久。
  ctx.handle('integrations:get-config', function () {
    const startedAt = Date.now();
    return Promise.resolve(ctx.integrations.getConfig()).finally(function () {
      const elapsed = Date.now() - startedAt;
      if (elapsed > 2000) ctx.startupLog('slow ipc: integrations:get-config ' + elapsed + 'ms（设置打开卡顿来源）');
    });
  });
  ctx.handle('integrations:save-config', function (_event, value) { return ctx.integrations.saveConfig(value || {}); });
  ctx.handle('integrations:reveal-secret', function (_event, value) { return ctx.integrations.revealSecret(value || {}); });
  ctx.handle('integrations:copy-secret', function (_event, value) {
    return ctx.integrations.revealSecret(value || {}).then(function (secret) {
      if (!secret) throw new Error(ctx.T('未找到已保存的 API Key'));
      clipboard.writeText(secret);
      return true;
    });
  });
  ctx.handle('integrations:sync-nutstore', async function (_event, value) {
    const input = value || {};
    const workspace = input && input.workspace && typeof input.workspace === 'object' ? input.workspace : input;
    ctx.syncInFlight = true;
    let result = null;
    try {
      result = await ctx.integrations.nutstoreSync(Object.assign({}, workspace, {
        portableSettings: await getPortableSyncSettings()
      }));
    } finally {
      ctx.syncInFlight = false;
    }
    await applyPortableSyncSettings(result && result.config);
    return result;
  });
  ctx.handle('integrations:inspect-nutstore', function (_event, value) {
    if (!ctx.integrations.inspectNutstoreRemote) throw new Error(ctx.T('当前版本不支持云端检查'));
    return ctx.integrations.inspectNutstoreRemote(value || {});
  });
  ctx.handle('integrations:create-sync-plan', async function (_event, value) {
    if (!ctx.integrations.createNutstoreSyncPlan) throw new Error(ctx.T('当前版本不支持云端同步计划'));
    return ctx.integrations.createNutstoreSyncPlan(Object.assign({}, value || {}, { portableSettings: await getPortableSyncSettings() }));
  });
  ctx.handle('integrations:apply-sync-plan', function (_event, value) {
    if (!ctx.integrations.applyNutstoreSyncPlan) throw new Error(ctx.T('当前版本不支持应用云端同步计划'));
    return ctx.integrations.applyNutstoreSyncPlan(value || {}).then(async function (result) {
      await applyPortableSyncSettings(result && result.config);
      return result;
    });
  });
  ctx.handle('integrations:pull-config', function (_event, value) {
    if (!ctx.integrations.pullNutstoreConfig) throw new Error(ctx.T('当前版本不支持云端配置恢复'));
    return ctx.integrations.pullNutstoreConfig(value || {}).then(async function (result) {
      await applyPortableSyncSettings(result && result.config);
      return result;
    });
  });
  ctx.handle('integrations:test-nutstore', function (_event, value) { return ctx.integrations.testNutstoreConnection(value || {}); });
  ctx.handle('integrations:translate', function (_event, value) { return ctx.integrations.translateText(value || {}); });
  ctx.handle('integrations:test-translation', function (_event, value) { return ctx.integrations.testTranslationConnection(value || {}); });
  ctx.handle('integrations:scigreat-rank', function (_event, value) { return ctx.integrations.getJournalRank(value || {}); });
  ctx.handle('integrations:test-scigreat', function (_event, value) { return ctx.integrations.testJournalRankConnection(value || {}); });
  /* 检索与元数据服务：一次把本节的四个源都测一遍（设置页一个按钮，各源独立回报）。
   * 只读探测，不进业务链；TinyFish 受「开关 + 出境告知」双重门控——未启用时如实回报
   * skipped，**不发请求**（未经同意的出境不能靠一个测试按钮绕过）。 */
  ctx.handle('integrations:test-sources', async function () {
    function wrap(id, promise) {
      return Promise.resolve(promise)
        .then(function (result) { return Object.assign({ id: id }, result || {}); })
        .catch(function (error) { return { id: id, status: 'error', code: 'error', message: String(error && error.message || error) }; });
    }
    const webEnabled = (await ctx.libraryDb.getSetting('webSearchEnabled')) === true;
    const webAck = (await ctx.libraryDb.getSetting('webSearchEgressAcknowledged')) === true;
    const tinyfish = (!webEnabled || !webAck)
      ? { id: 'tinyfish', status: 'skipped', code: 'not_enabled' }
      : (ctx.webFetchNet ? wrap('tinyfish', ctx.webFetchNet.testConnection())
        : { id: 'tinyfish', status: 'error', code: 'error' });
    const results = await Promise.all([
      ctx.researchNet ? wrap('openalex', ctx.researchNet.testOpenAlex()) : { id: 'openalex', status: 'error', code: 'error' },
      ctx.researchNet ? wrap('semanticscholar', ctx.researchNet.testSemanticScholar()) : { id: 'semanticscholar', status: 'error', code: 'error' },
      ctx.researchNet ? wrap('elsevier', ctx.researchNet.testElsevier()) : { id: 'elsevier', status: 'error', code: 'error' },
      tinyfish
    ]);
    return { results: results };
  });
  ctx.handle('integrations:detect-zotero', function () { return ctx.integrations.detectZoteroDataDir(); });
  ctx.handle('integrations:choose-zotero', async function () {
    const result = await dialog.showOpenDialog(ctx.mainWindow, { title: ctx.T('选择 Zotero 数据目录'), properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return '';
    return ctx.integrations.setZoteroDataDir(result.filePaths[0]);
  });
  ctx.handle('integrations:import-zotero-local', function () { return ctx.integrations.importZoteroLocal(); });
  ctx.handle('integrations:scan-zotero', function (_event, value) { return ctx.integrations.scanZoteroLibrary(value || {}); });
  ctx.handle('integrations:import-zotero', function (_event, value) { return ctx.integrations.importZoteroLibrary(value || {}); });
  ctx.handle('integrations:migrate-zotero-cloud', function (_event, value) {
    return ctx.integrations.migrateZoteroCloudAttachments(value || {});
  });
}
