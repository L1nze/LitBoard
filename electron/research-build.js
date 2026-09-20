'use strict';

/**
 * LitBoard 调研库向量构建器（二期）：content-hash 增量 + 库空闲调度 + 成本护栏。
 *
 * 规则（对应 roadmap B-1 语义）：
 * - 待嵌判定 = 无向量 / 内容 hash 变了 / 模型或配方版本不符（research-db.pendingEmbeddings）；
 * - 只在库空闲（无待保存、无进行中同步——由调用方注入 isIdle）时跑，批间复检；
 * - 失败批次不自动重试计费（R14）：整批失败写入持久 failed 标记（settings 表，
 *   由调用方注入 getSetting/setSetting）——巡检/入库触发见标记即跳过，**零新增请求**；
 *   用户手动「构建」清除标记重跑。没有用户侧开关（语义检索是 AI 助手的工具）：向量模型
 *   配置不齐时调用方根本不触发构建，中止进行中的循环走 abort()；
 * - 进度经 notify('research:embed-progress') 上报，done 累计、total 未知传 -1。
 *
 * 除空闲/手动构建外，还有一条**查询路径按需补齐**（topUp，比照上游 literature-mcp 的
 * `library_query` + `semantic_query`）：语义检索前最多补 TOPUP_LIMIT 篇，让刚入库、还没轮到
 * 空闲构建的库立刻可检索；预算小、同样尊重失败标记，绝不因为一次查询就放开计费。
 */
const LitResearch = require('../js/research.js');

const BATCH = 50;
// 查询路径按需补齐的单次上限（上游是 256，这里按「一次查询最多 50 篇」收紧）
const TOPUP_LIMIT = 50;
const FAILED_MARKER_KEY = 'embedFailedBatch';

function createResearchEmbedder(options) {
  const opts = options || {};
  const db = opts.researchDb;
  // 向量模型出网层（electron/embed-net.js）：语义检索唯一的嵌入链路（正式库那条已删除）
  const embed = opts.embed;
  const getSetting = opts.getSetting || async function () { return null; };
  const setSetting = opts.setSetting || async function () {};
  const isIdle = opts.isIdle || function () { return true; };
  const notify = opts.notify || function () {};
  const log = opts.log || function () {};
  let running = false;
  let abortFlag = false;

  async function readFailedMarker() {
    try {
      const value = await getSetting(FAILED_MARKER_KEY);
      return value && typeof value === 'object' ? value : null;
    } catch (error) { return null; }
  }

  async function clearFailedMarker() {
    try { await setSetting(FAILED_MARKER_KEY, null); } catch (error) { /* 清不掉只影响恢复提示 */ }
  }

  async function writeFailedMarker(failed) {
    try { await setSetting(FAILED_MARKER_KEY, failed); } catch (error) { /* 持久化失败仍有内存返回值 */ }
  }

  /** 当前生效的向量模型目标（含来源：configured 专用配置 / legacy-chat 回退 AI 助手端点） */
  async function resolveTarget() {
    if (embed && typeof embed.resolveTarget === 'function') return await embed.resolveTarget();
    return { ok: false, source: '', baseUrl: '', apiKey: '', model: '', batch: 0, reason: '向量模型未就绪' };
  }

  /** 估价（构建确认框用）：待嵌条数 + 粗估 token；带出持久失败标记供 UI 呈现 */
  async function estimate() {
    const target = await resolveTarget();
    const pending = db.pendingEmbeddings({
      model: target.model || '', recipe: LitResearch.EMBED_RECIPE, limit: 5000
    });
    const approxTokens = LitResearch.estimateEmbedTokens(pending.map(function (p) {
      return LitResearch.embeddingText(p.work);
    }));
    return {
      count: pending.length, approxTokens: approxTokens, model: target.model || '',
      source: target.source, failed: await readFailedMarker()
    };
  }

  /** 手动构建：清除失败标记（明确的人工恢复动作）后开跑 */
  async function runBuild() {
    await clearFailedMarker();
    if (running) return { skipped: 'already_running' };
    const target = await resolveTarget();
    if (!target.ok) throw new Error('向量模型未配置（设置 → 集成与服务 → 向量嵌入（调研库））');
    const model = target.model;
    running = true;
    abortFlag = false;
    let embedded = 0;
    let batches = 0;
    try {
      while (true) {
        if (abortFlag) return { stopped: 'aborted', embedded: embedded, batches: batches };
        if (!isIdle()) {
          log('embed build paused: library busy');
          return { stopped: 'busy', embedded: embedded, batches: batches };
        }
        const pending = db.pendingEmbeddings({
          model: model, recipe: LitResearch.EMBED_RECIPE, limit: BATCH
        });
        if (!pending.length) return { done: true, embedded: embedded, batches: batches };
        const texts = pending.map(function (p) { return LitResearch.embeddingText(p.work); });
        let result;
        try {
          result = await embed.embedTexts({ texts: texts });
        } catch (error) {
          // 计费红线（R14）：失败即停 + 持久 failed 标记——空闲巡检/检索入库都不再自动发起，
          // 待嵌条目保持 pending，用户手动「构建」清除标记后续跑
          const message = String(error && error.message || error);
          const failed = { error: message, at: new Date().toISOString(), model: model, pending: pending.length };
          await writeFailedMarker(failed);
          log('embed build stopped on batch failure: ' + message);
          return { error: message, embedded: embedded, batches: batches, failed: failed };
        }
        const puts = result.vectors.map(function (vec, index) {
          return {
            workId: pending[index].work.id,
            model: result.model,
            dim: Array.isArray(vec) ? vec.length : 0,
            recipe: LitResearch.EMBED_RECIPE,
            hash: pending[index].hash,
            vec: Buffer.from(new Float32Array(vec).buffer)
          };
        });
        db.vecPut(puts);
        embedded += puts.length;
        batches++;
        notify('research:embed-progress', { done: embedded, total: -1 });
      }
    } finally {
      running = false;
    }
  }

  /**
   * 查询路径的按需补齐（比照上游 literature-mcp 的 `library_query` + `semantic_query`：
   * 查询前先把缺向量的文献补一批，让「刚入库还没轮到空闲构建」的库立刻可用语义检索）。
   *
   * 与自动构建同一套纪律，但预算小得多：
   * - 一次调用最多 limit 篇（默认 TOPUP_LIMIT = 50，且不超过单批 BATCH）；
   * - 持久 failed 标记存在时直接跳过——失败批次必须经用户手动恢复（R14 计费红线）；
   * - 构建器已在跑（空闲巡检或手动构建）时跳过，避免同一批重复计费；
   * - 只补「当前模型 + 当前配方」缺的，内容没变的条目不会被重嵌。
   */
  async function topUp(limit) {
    if (running) return { skipped: 'running' };
    const target = await resolveTarget();
    if (!target.ok) return { skipped: 'unconfigured', reason: target.reason };
    const failed = await readFailedMarker();
    if (failed) {
      log('query top-up skipped: failed batch awaiting manual retry (' + failed.error + ')');
      return { skipped: 'failed', failed: failed };
    }
    const size = Math.max(1, Math.min(BATCH, Number(limit) || TOPUP_LIMIT));
    const pending = db.pendingEmbeddings({
      model: target.model || '', recipe: LitResearch.EMBED_RECIPE, limit: size
    });
    if (!pending.length) return { embedded: 0, pending: 0 };
    running = true;
    try {
      const texts = pending.map(function (p) { return LitResearch.embeddingText(p.work); });
      let result;
      try {
        result = await embed.embedTexts({ texts: texts });
      } catch (error) {
        // 与自动构建同一条红线：失败即写持久标记、不重试计费，待用户手动「构建」恢复
        const message = String(error && error.message || error);
        const marker = { error: message, at: new Date().toISOString(), model: target.model || '', pending: pending.length };
        await writeFailedMarker(marker);
        log('query top-up failed, marked for manual retry: ' + message);
        return { error: message, embedded: 0, failed: marker };
      }
      const puts = result.vectors.map(function (vec, index) {
        return {
          workId: pending[index].work.id,
          model: result.model,
          dim: Array.isArray(vec) ? vec.length : 0,
          recipe: LitResearch.EMBED_RECIPE,
          hash: pending[index].hash,
          vec: Buffer.from(new Float32Array(vec).buffer)
        };
      });
      db.vecPut(puts);
      log('query top-up embedded ' + puts.length + ' work(s)');
      return { embedded: puts.length, pending: pending.length };
    } finally {
      running = false;
    }
  }

  function abort() { abortFlag = true; }
  function isRunning() { return running; }

  /** 空闲自动构建（main 定时调用；开关由调用方判定）。
   *  R14：持久 failed 标记存在时直接跳过——失败批次必须经用户手动恢复。 */
  async function maybeAutoBuild(enabled) {
    if (!enabled || running) return { skipped: true };
    const failed = await readFailedMarker();
    if (failed) {
      log('auto embed build skipped: failed batch awaiting manual retry (' + failed.error + ')');
      return { skipped: 'failed', failed: failed };
    }
    try {
      return await runBuild();
    } catch (error) {
      log('auto embed build failed: ' + String(error && error.message || error));
      return { error: String(error && error.message || error) };
    }
  }

  return {
    estimate: estimate, runBuild: runBuild, abort: abort, isRunning: isRunning,
    resolveTarget: resolveTarget, topUp: topUp,
    maybeAutoBuild: maybeAutoBuild, readFailedMarker: readFailedMarker, clearFailedMarker: clearFailedMarker
  };
}

module.exports = {
  createResearchEmbedder: createResearchEmbedder,
  FAILED_MARKER_KEY: FAILED_MARKER_KEY,
  TOPUP_LIMIT: TOPUP_LIMIT
};
