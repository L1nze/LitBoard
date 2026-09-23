'use strict';

/* library:* + settings:* —— 文献库状态读写与设置键值（自 main.js registerIpc 平移）。
 * lastLibraryWriteAt 是向量空闲调度 isIdle 的输入（跨域共享，经 ctx）。 */

const LitI18n = require('../../js/i18n.js');
const ctx = require('./context.js');

module.exports = { register: register };

function register() {
  ctx.handle('library:load', function () { return ctx.libraryDb.loadState(); });
  // 阅读时间轻量落盘（不参与内容 hash，不触发同步脏写）
  ctx.handle('library:record-read', function (_event, value) {
    return ctx.libraryDb.recordReadAt(String(value && value.paperId || ''), Number(value && value.at) || Date.now());
  });
  // 实体级保存协议：payload = { workspace, baseSignatures }；旧调用（直接传 workspace）自动兼容
  ctx.handle('library:save', function (_event, value) {
    const payload = value && value.workspace && typeof value.workspace === 'object'
      ? value : { workspace: value || {} };
    const result = ctx.libraryDb.saveState(Object.assign({}, payload.workspace, {
      baseSignatures: payload.baseSignatures || null
    }));
    ctx.lastLibraryWriteAt = Date.now();
    return result;
  });
  // 整库替换（仅供 JSON 整库恢复等显式场景）
  ctx.handle('library:replace', function (_event, value) {
    const result = ctx.libraryDb.replaceState(value || {});
    return result;
  });
  ctx.handle('settings:get', function (_event, key) { return ctx.libraryDb.getSetting(key); });
  ctx.handle('settings:set', function (_event, payload) {
    // uiLang 变化时让主进程的原生对话框立即跟随（不落 localStorage，仅内存）
    if (payload && payload.key === 'uiLang') {
      LitI18n.setLang(String(payload.value || ''), { persist: false });
    }
    return ctx.libraryDb.setSetting(payload && payload.key, payload && payload.value);
  });
}
