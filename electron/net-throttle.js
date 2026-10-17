'use strict';

/**
 * LitBoard 主进程网络工具库：每主机节流队列 + 请求超时兜底 + 连接测试错误分类。
 *
 * 从 research-net.js 原样搬移（导出同名 API，行为零变化）：节流是「防触发」优先于
 * 「触发后退避」——每主机限并发 + 最小发起间隔，429/5xx 才走指数退避重试（尊重
 * Retry-After），其余错误直接上抛。计时（sleep/now）可注入，node:test 用假时钟
 * 覆盖队列行为。消费方：research-net（OpenAlex / Semantic Scholar / Scopus / 回填链）
 * 与 webfetch-net（TinyFish 检索/抓取）。
 */

const DEFAULT_POLICY = { concurrency: 2, minIntervalMs: 400 };
const MAX_ATTEMPTS = 3;
/** 单请求超时上限：JSON 检索请求一律 20s 封顶（与 agent-net 的空闲超时同一量级）。
 *  本库只有 JSON 请求——流式 SSE 在 agent-net，有自己的超时/中止体系，不受影响。
 *  没有这层兜底时，上游挂起会让 find_literature / 检索工具的调用无限等待。
 *  信号在**拿到主机队列槽位之后**才创建（排队等待不计入超时），且每次重试都是
 *  新的一份；调用方自带 signal 时不覆盖。 */
const REQUEST_TIMEOUT_MS = 20000;

function defaultSleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function makeDeferred() {
  let resolveFn = null;
  const promise = new Promise(function (resolve) { resolveFn = resolve; });
  return { promise: promise, resolve: resolveFn };
}

function createThrottleQueue(doFetch, options) {
  const opts = options || {};
  const sleep = opts.sleep || defaultSleep;
  const now = opts.now || function () { return Date.now(); };
  // 可注入（测试用假时钟加速）；缺省用生产 20s 兜底
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : REQUEST_TIMEOUT_MS;
  const hosts = new Map(); // host → { running, lastDispatch, waiters, slot, pumping }

  function hostState(host) {
    if (!hosts.has(host)) {
      hosts.set(host, { running: 0, lastDispatch: -Infinity, waiters: [], slot: makeDeferred(), pumping: false });
    }
    return hosts.get(host);
  }

  function setPolicy(host, policy) {
    const st = hostState(host);
    st.policy = {
      concurrency: Math.max(1, Number(policy && policy.concurrency) || 1),
      minIntervalMs: Math.max(0, Number(policy && policy.minIntervalMs) || 0)
    };
  }
  function policyOf(st) { return st.policy || DEFAULT_POLICY; }

  function pump(host) {
    const st = hostState(host);
    if (st.pumping) return;
    st.pumping = true;
    (async function () {
      try {
        while (st.waiters.length) {
          const policy = policyOf(st);
          while (st.running >= policy.concurrency && st.waiters.length) {
            await st.slot.promise;
          }
          if (!st.waiters.length) break;
          const wait = st.lastDispatch + policy.minIntervalMs - now();
          if (wait > 0) await sleep(wait);
          if (!st.waiters.length) break;
          const resolveAcquired = st.waiters.shift();
          st.running++;
          st.lastDispatch = now();
          if (typeof opts.onDispatch === 'function') {
            try { opts.onDispatch(host, st.lastDispatch); } catch (error) { /* 观测钩子不反噬调度 */ }
          }
          resolveAcquired(function release() {
            st.running--;
            const prevSlot = st.slot;
            st.slot = makeDeferred();
            prevSlot.resolve();
            pump(host);
          });
        }
      } finally {
        st.pumping = false;
      }
    })();
  }

  function acquire(host) {
    const st = hostState(host);
    return new Promise(function (resolve) {
      st.waiters.push(resolve);
      pump(host);
    });
  }

  async function fetchThrottled(url, init) {
    const host = new URL(url).host;
    const release = await acquire(host);
    try {
      // 超时兜底：槽位到手才起表（排队不计入）；不覆盖调用方自带的 signal
      const request = Object.assign({}, init || {});
      if (!request.signal) request.signal = AbortSignal.timeout(timeoutMs);
      return await doFetch(url, request);
    } finally {
      release();
    }
  }

  function backoffMs(attempt) {
    return (1 << Math.min(attempt, 5)) * 500 + Math.floor(Math.random() * 250);
  }

  /** 带重试的 JSON GET/POST：仅 429/5xx/传输错误重试，其余状态码立即上抛 */
  async function requestJson(url, init) {
    let attempt = 0;
    while (true) {
      attempt++;
      let response = null;
      try {
        response = await fetchThrottled(url, init || {});
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS) {
          throw new Error('网络请求失败（' + new URL(url).host + '）：' + String(error && error.message || error));
        }
        await sleep(backoffMs(attempt));
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= MAX_ATTEMPTS) {
          const err = new Error('上游限流或服务异常（HTTP ' + response.status + '）：' + new URL(url).host);
          err.status = response.status;
          throw err;
        }
        const retryAfter = Number(response.headers && response.headers.get && response.headers.get('retry-after'));
        await sleep(isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 120
          ? retryAfter * 1000
          : backoffMs(attempt));
        continue;
      }
      if (!response.ok) {
        const err = new Error('HTTP ' + response.status + '（' + new URL(url).host + '）');
        err.status = response.status;
        throw err;
      }
      return await response.json();
    }
  }

  return { setPolicy: setPolicy, requestJson: requestJson, fetchThrottled: fetchThrottled };
}

/** 连接测试的错误分类（research-net 与 webfetch-net 共用同一份判定）。
 *  code 语义固定，渲染层按 code 出文案：missing_key / unauthorized / rate_limited /
 *  not_found / network / error。 */
function classifyTestError(error) {
  const status = Number(error && error.status) || 0;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (error && error.code === 'NO_KEY') return 'missing_key';
  if (/网络请求失败/.test(String(error && error.message || ''))) return 'network';
  return 'error';
}

module.exports = {
  createThrottleQueue: createThrottleQueue,
  classifyTestError: classifyTestError,
  defaultSleep: defaultSleep
};
