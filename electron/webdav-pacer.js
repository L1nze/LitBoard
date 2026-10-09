'use strict';

/* 坚果云 WebDAV 限流预算与会话节流器。
 *
 * 坚果云官方限制：免费版每 30 分钟 ≤600 次请求（平均约 20 次/分钟），专业版
 * ≤1500 次。LitBoard 一次同步远不止一两个请求（库 JSON 读写 + 每个 PDF 一至
 * 两次 MKCOL/PUT），不主动节流时整库首次上传必然触发 429，且中断后毫无进展
 * 记录。RequestPacer 给同步会话内的所有 WebDAV 请求排队：
 *   - 最小间隔：把请求速率压到官方均值以下（free ≈19 次/分钟，pro ≈48 次/分钟）；
 *   - 窗口预算：30 分钟滚动窗口内保留尾部配额（库终写、校验、配置同步），
 *     预算将尽时主动暂停，而不是等服务端 429；
 *   - 状态持久化：窗口内请求时间戳与暂停截止时刻由调用方落盘
 *     （sync-asset-ledger.json 的 pacing 字段），跨会话/跨重启生效，
 *     滚动窗口自动过期。
 *
 * 时钟与睡眠可注入（测试用虚拟时钟即时推进）。acquire() 串行排队，窗口判定
 * 不存在并发竞争；暂停以 SYNC_RATE_PAUSED 错误抛出，由同步编排层转成
 * 「暂停 + 自动续传」结果而不是硬失败。 */

const PACING_PROFILES = {
  free: { maxPerWindow: 600, minIntervalMs: 3100 },
  pro: { maxPerWindow: 1500, minIntervalMs: 1250 }
};
const WINDOW_MS = 30 * 60 * 1000;
/** 尾部保留配额：预算耗尽前停下，给库 JSON 终写 + 写后校验 + 配置同步 +
 *  云端备份留出请求数，避免附件传完却写不回元数据的尴尬。 */
const TAIL_RESERVE = 24;

function pacingProfile(name) {
  return name === 'pro' ? PACING_PROFILES.pro : PACING_PROFILES.free;
}

/** 载入持久化限流状态；结构无效时返回空白窗口（老台账文件没有 pacing 字段）。 */
function loadPacingValue(value) {
  const requests = Array.isArray(value && value.requests)
    ? value.requests.filter(function (n) { return Number.isFinite(n) && n > 0; }) : [];
  const resumeAt = Number(value && value.resumeAt);
  return { requests: requests, resumeAt: Number.isFinite(resumeAt) && resumeAt > 0 ? resumeAt : 0 };
}

function createRequestPacer(pacerOptions) {
  const opts = pacerOptions || {};
  const profile = opts.profile === 'pro' ? PACING_PROFILES.pro : PACING_PROFILES.free;
  const maxPerWindow = Number.isFinite(opts.maxPerWindow) && opts.maxPerWindow > 0
    ? Math.floor(opts.maxPerWindow) : profile.maxPerWindow;
  const minIntervalMs = Number.isFinite(opts.minIntervalMs) && opts.minIntervalMs >= 0
    ? Math.floor(opts.minIntervalMs) : profile.minIntervalMs;
  const now = opts.now || function () { return Date.now(); };
  const sleep = opts.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  const loadState = opts.loadState || null;
  const saveState = opts.saveState || null;

  let state = null;
  let loaded = null;
  let lastPersist = Promise.resolve();
  // acquire 串行链：窗口判定与间隔等待不会交错；前一次暂停不影响后续排队。
  let chain = Promise.resolve();

  function prune() {
    const cutoff = now() - WINDOW_MS;
    if (state.requests.length && state.requests[0] <= cutoff) {
      state.requests = state.requests.filter(function (ts) { return ts > cutoff; });
    }
    if (state.resumeAt && state.resumeAt <= now()) state.resumeAt = 0;
  }

  async function persist() {
    if (!saveState || !state) return;
    try { await saveState({ requests: state.requests.slice(), resumeAt: state.resumeAt }); } catch (error) {}
  }

  async function ensureState() {
    if (state) return;
    if (!loaded) {
      loaded = (async function () {
        let saved = null;
        if (loadState) { try { saved = await loadState(); } catch (error) {} }
        state = loadPacingValue(saved);
        prune();
      })();
    }
    await loaded;
  }

  function pauseError(reason, resumeAt) {
    const when = new Date(resumeAt).toLocaleTimeString();
    const error = new Error('坚果云 WebDAV 限流额度已用尽（' + reason + '），同步暂停，' + when + ' 后自动续传');
    error.name = 'RateLimitPauseError';
    error.code = 'SYNC_RATE_PAUSED';
    error.resumeAt = resumeAt;
    return error;
  }

  async function doAcquire() {
    await ensureState();
    prune();
    if (state.resumeAt > now()) throw pauseError('窗口恢复中', state.resumeAt);
    if (state.requests.length >= maxPerWindow - TAIL_RESERVE) {
      // 滚动窗口：最老请求滑出窗口的时刻即额度恢复时刻。
      const resumeAt = (state.requests[0] || now()) + WINDOW_MS + 5000;
      state.resumeAt = resumeAt;
      await persist();
      throw pauseError('30 分钟请求预算将尽', resumeAt);
    }
    const last = state.requests.length ? state.requests[state.requests.length - 1] : 0;
    const waitMs = Math.max(0, last + minIntervalMs - now());
    if (waitMs > 0) await sleep(waitMs);
    state.requests.push(now());
    lastPersist = persist();
    await lastPersist;
  }

  function acquire() {
    const result = chain.then(doAcquire);
    chain = result.catch(function () {});
    return result;
  }

  /** 服务端 429：尊重 Retry-After；缺省按滚动窗口恢复时刻估算（宁等勿撞）。
   *  正常路径下 429 响应来自一次已 acquire 的请求（state 必已就绪）；直接
   *  调用时也保证 state 存在，暂停时刻不丢。 */
  function noteRateLimited(retryAfterSeconds) {
    if (!state) state = loadPacingValue(null);
    const hintMs = Math.max(0, Number(retryAfterSeconds) || 0) * 1000;
    const fallback = state.requests.length
      ? state.requests[0] + WINDOW_MS + 5000 : now() + WINDOW_MS;
    const resumeAt = hintMs > 0 ? now() + hintMs + 2000 : fallback;
    state.resumeAt = Math.max(state.resumeAt || 0, resumeAt);
    if (state.resumeAt > now() + WINDOW_MS) state.requests = [];
    lastPersist = persist();
    return pauseError('服务端 429', resumeAt);
  }

  return {
    acquire: acquire,
    noteRateLimited: noteRateLimited,
    /** 等待最后一次状态落盘完成（暂停返回前调用，保证 resumeAt 已持久化） */
    flush: async function () { await lastPersist; },
    profile: opts.profile === 'pro' ? 'pro' : 'free',
    maxPerWindow: maxPerWindow,
    minIntervalMs: minIntervalMs,
    stats: function () {
      return { requests: state ? state.requests.length : 0, resumeAt: state ? state.resumeAt : 0 };
    }
  };
}

module.exports = { createRequestPacer, loadPacingValue, pacingProfile, WINDOW_MS, TAIL_RESERVE };
