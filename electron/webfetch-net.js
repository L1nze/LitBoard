'use strict';

/**
 * 科研网页检索网络层（主进程专用）：TinyFish Search/Fetch 适配器。
 *
 * - 固定 URL 主机（api.search.tinyfish.ai / api.fetch.tinyfish.ai），主进程 net.fetch 直连，
 *   与 ALLOWED_API_HOSTS/CSP（渲染层直连白名单）无关——比照 M9 一期信任边界；
 * - 复用 createThrottleQueue（免费额度条款未稳定，保守起步：2 并发 + ≥500ms 间隔）；
 * - 按可替换 provider 设计：所有 TinyFish 特定形状（端点/参数/字段名）收敛在本模块，
 *   响应形状校验与规范化在 js/webfetch.js（纯函数）；
 * - 失败不自动重试计费类请求（Search/Fetch 虽免费，仍沿用队列既有 429/5xx 退避语义，仅 3 次封顶）。
 */
const { createThrottleQueue, classifyTestError } = require('./research-net.js');
const LitWebFetch = require('../js/webfetch.js');

const SEARCH_URL = 'https://api.search.tinyfish.ai';
const FETCH_URL = 'https://api.fetch.tinyfish.ai';

function createWebFetchNet(options) {
  const opts = options || {};
  const getConfig = opts.getConfig || async function () { return {}; };
  const queue = createThrottleQueue(opts.fetch, opts);
  // R15：官方默认配额 30 次/分钟 → 间隔取 2000ms（旧值 500ms≈120 次/分钟，四倍超限）。
  // 并发降到 1：并发与间隔在同一配额下表里是相乘关系，2 并发会让实际速率翻倍。
  queue.setPolicy('api.search.tinyfish.ai', { concurrency: 1, minIntervalMs: 2000 });
  queue.setPolicy('api.fetch.tinyfish.ai', { concurrency: 1, minIntervalMs: 2000 });

  async function requireKey() {
    const cfg = await getConfig();
    const key = cfg && cfg.tinyfishApiKey;
    if (!key) throw new Error('网页检索 API Key 未配置（设置 → 集成与服务 → 检索与元数据服务）');
    return key;
  }

  /**
   * 检索：mode='paper'（默认）走 research_paper 域（结构化论文结果）；
   * mode='web' 不限定 domain_type，覆盖工具描述承诺的一般科研网页——会议主页、项目页、
   * 数据集页、机构库条目。R15：旧实现硬编码 research_paper，那些页面永远检索不到。
   * 年份用 pub_year_min/max（research_paper 不支持日期过滤；web 模式同样沿用，上游无该参数时忽略）。
   */
  async function webSearch(input) {
    const key = await requireKey();
    const req = input || {};
    const mode = req.mode === 'web' ? 'web' : 'paper';
    const params = new URLSearchParams();
    params.set('query', String(req.query || '').trim().slice(0, 500));
    if (mode === 'paper') params.set('domain_type', 'research_paper');
    // 官方参数表中没有 `num`；这里仍传（上游忽略即无副作用），真正的条数上限由本地截断保证
    if (req.limit != null) params.set('num', String(Math.max(1, Math.min(20, Number(req.limit) || 10))));
    const yearFrom = Number(req.yearFrom);
    const yearTo = Number(req.yearTo);
    if (isFinite(yearFrom) && yearFrom > 1000) params.set('pub_year_min', String(Math.floor(yearFrom)));
    if (isFinite(yearTo) && yearTo > 1000) params.set('pub_year_max', String(Math.floor(yearTo)));
    if (req.purpose) params.set('purpose', String(req.purpose).slice(0, 2000));
    const data = await queue.requestJson(SEARCH_URL + '?' + params.toString(), {
      headers: { Accept: 'application/json', 'X-API-Key': key }
    });
    // 账号权限/鉴权错误不得被当成「没有结果」：解析层报形状不符时这里补一句诊断提示
    const normalized = LitWebFetch.normalizeSearchResponse(data, req.query);
    normalized.mode = mode;
    return normalized;
  }

  /** 抓取公开学术页 → markdown。域外 URL 在这里直接拒绝（不给第三方出境机会）。 */
  async function fetchPage(input) {
    const url = String(input && input.url || '').trim();
    const check = LitWebFetch.isAcademicUrl(url);
    if (!check.ok) {
      const err = new Error('拒绝抓取：' + check.reason);
      err.code = 'NON_ACADEMIC_URL';
      throw err;
    }
    const key = await requireKey();
    const data = await queue.requestJson(FETCH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': key },
      signal: input && input.signal,
      body: JSON.stringify({ urls: [url], format: 'markdown', ttl: 0 })
    });
    return LitWebFetch.parseFetchResponse(data, url);
  }

  /** 连接测试（设置页「测试全部服务」）：一发最小检索，只验证「Key 能不能通」。
   *  未配置 Key → skipped（由调用方判，这里兜底）；已配置但鉴权失败 → unauthorized。
   *  与业务路径共用节流队列，测试同样受 2s 间隔约束，不会额外冲击免费配额。 */
  async function testConnection() {
    const cfg = await getConfig();
    if (!cfg || !cfg.tinyfishApiKey) return { status: 'skipped', code: 'missing_key' };
    try {
      const result = await webSearch({ query: 'literature management', mode: 'paper', limit: 1 });
      return { status: 'ok', code: '', count: (result && result.results ? result.results.length : 0) };
    } catch (error) { return { status: 'error', code: classifyTestError(error) }; }
  }

  return { webSearch: webSearch, fetchPage: fetchPage, testConnection: testConnection };
}

module.exports = { createWebFetchNet: createWebFetchNet };
