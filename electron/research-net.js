'use strict';

/**
 * LitBoard 检索服务（主进程专用）：OpenAlex / Semantic Scholar / Scopus 客户端。
 *
 * 每主机节流队列、请求超时兜底与连接测试错误分类已抽到 `electron/net-throttle.js`
 * （公共网络工具库，webfetch-net 同样引用）；本文件只保留检索侧的东西：
 * 各源的端点、参数形状与归一化，以及端点级限速（R16）。
 *
 * 计时（sleep/now）可注入，node:test 用假时钟覆盖队列行为。
 *
 * 端点级限速（R16）：OpenAlex 的 search.semantic 官方限 1 req/s，与该主机的普通检索
 * （3 并发 / 200ms）不是同一档——用 createEndpointGate 在主机队列之外再串一层间隔，
 * 否则语义检索会被自己的并发打死（主机策略管的是「主机」，管不了「端点」）。
 */
const LitResearch = require('../js/research.js');
const { createThrottleQueue, classifyTestError, defaultSleep } = require('./net-throttle.js');

/**
 * 端点级最小间隔闸门：把同一端点的调用串行化，并保证相邻两次发起间隔 ≥ minIntervalMs。
 * 与主机队列叠加使用（队列控并发与主机节流，闸门控端点配额）。
 */
function createEndpointGate(minIntervalMs, options) {
  const opts = options || {};
  const sleep = opts.sleep || defaultSleep;
  const now = opts.now || function () { return Date.now(); };
  const gap = Math.max(0, Number(minIntervalMs) || 0);
  let chain = Promise.resolve();
  let last = -Infinity;
  return function gate() {
    const run = chain.then(async function () {
      const wait = last + gap - now();
      if (wait > 0) await sleep(wait);
      last = now();
    });
    chain = run.then(function () {}, function () {});
    return run;
  };
}

/* ---------------- 摘要回填的纯解析（模块级导出，node:test 直测） ---------------- */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
}

/** Crossref message.abstract 多为 JATS 标签串 → 剥标签取纯文本 */
/** Scopus 查询构造（纯函数）：TITLE-ABS-KEY 包裹关键词 + PUBYEAR 过滤（AFT/BEF 闭区间） */
function buildScopusQuery(input) {
  const req = input || {};
  const terms = String(req.query || '').trim().slice(0, 300)
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(function (t) { return '"' + t.replace(/"/g, '') + '"'; })
    .join(' ');
  if (!terms) throw new Error('Scopus 检索词为空');
  let query = 'TITLE-ABS-KEY(' + terms + ')';
  const from = Number(req.yearFrom);
  const to = Number(req.yearTo);
  if (isFinite(from) && from > 1000) query += ' AND PUBYEAR AFT ' + Math.floor(from - 1);
  if (isFinite(to) && to > 1000) query += ' AND PUBYEAR BEF ' + Math.floor(to + 1);
  return query;
}

  /** Scopus 检索结果条目 → 归一化 hit（纯函数；dc:creator 兼容字符串/数组两种形态） */
function normalizeScopusHit(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const doiRaw = String(e['prism:doi'] || '').trim();
  const doi = doiRaw.toLowerCase().replace(/^doi:/i, '');
  const coverDate = String(e['prism:coverDate'] || '');
  const creators = Array.isArray(e['dc:creator']) ? e['dc:creator']
    : (e['dc:creator'] ? [e['dc:creator']] : []);
  return {
    eid: String(e['dc:identifier'] || '').replace(/^EID:/i, '') || (e.eid ? String(e.eid) : ''),
    doi: /^10\.\d{4,9}\//.test(doi) ? doi : '',
    title: String(e['dc:title'] || '').trim(),
    year: coverDate ? (Number(coverDate.slice(0, 4)) || null) : null,
    source: String(e['prism:publicationName'] || ''),
    authors: creators.map(function (name) { return { name: String(name) }; }).slice(0, 20),
    citedByScopus: Number(e['citedby-count']) || 0
  };
}

function parseCrossrefAbstract(work) {
  // JATS 剥标签与实体解码的唯一实现在 js/research.js（与检索归一化共用），此处只做转发
  return LitResearch.crossrefAbstract(work);
}

/** Elsevier abstracts-retrieval-response：abstracts[].abstract 形态多变，深度优先收文本 */
function parseElsevierAbstract(payload) {
  const root = payload && payload['abstracts-retrieval-response'];
  const head = root && root.item && root.item.bibrecord && root.item.bibrecord.head;
  const abstracts = head && head.abstracts;
  if (!Array.isArray(abstracts)) return '';
  let found = '';
  (function walk(node) {
    if (found || node == null) return;
    if (typeof node === 'string') { found = node; return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      if (typeof node._ === 'string') { found = node._; return; } // xml2js 风格文本键
      if (typeof node.$ === 'string') { found = node.$; return; }
      Object.keys(node).forEach(function (key) { walk(node[key]); });
    }
  })(abstracts);
  return decodeEntities(found).replace(/\s+/g, ' ').trim();
}

function createResearchNet(options) {
  const opts = options || {};
  const queue = createThrottleQueue(opts.fetch, opts);
  const sleep = opts.sleep || defaultSleep;
  // OpenAlex：3 并发 + ≥200ms 间隔起步（key + mailto 走 polite pool，限额宽，但保守起步）
  queue.setPolicy('api.openalex.org', { concurrency: 3, minIntervalMs: 200 });
  // 回填链：Crossref 宽松、Elsevier 严格（单并发 ~1.1s——防触发配额；429 由上层记账停批）
  queue.setPolicy('api.crossref.org', { concurrency: 2, minIntervalMs: 500 });
  queue.setPolicy('api.elsevier.com', { concurrency: 1, minIntervalMs: 1100 });
  // Semantic Scholar：官方无 Key 走共享池（≈100 req/5min，且与他人争用），带 Key 为 1 req/s。
  // 取值 1200ms 是「带 Key 的 1/s」再留一点余量；429 由队列退避消化。
  queue.setPolicy('api.semanticscholar.org', { concurrency: 1, minIntervalMs: 1200 });
  // OpenAlex 语义端点官方限 1 req/s（与该主机普通检索不同档，故单独加闸门）
  const openalexSemanticGate = createEndpointGate(1000, { sleep: sleep, now: opts.now });
  const getConfig = opts.getConfig || async function () { return {}; };
  const OPENALEX_WORKS = 'https://api.openalex.org/works';
  const OPENALEX_AUTOCOMPLETE = 'https://api.openalex.org/autocomplete';
  const S2_SEARCH = 'https://api.semanticscholar.org/graph/v1/paper/search';

  /** 实体名 → OpenAlex ID 联想（R18，对照 literature-mcp 的 autocomplete）：
   *  作者/期刊/机构/出版商/资助方名称解析成可塞进检索 filter 的 ID。走主机节流队列。 */
  async function autocomplete(entity, query) {
    const kind = ['authors', 'sources', 'institutions', 'publishers', 'funders'].indexOf(String(entity || '')) >= 0
      ? String(entity) : 'works';
    const term = String(query || '').trim().slice(0, 200);
    if (!term) return [];
    const params = await openalexParams({ entity: kind, search: term });
    const data = await queue.requestJson(OPENALEX_AUTOCOMPLETE + '?' + params.toString(), {
      headers: { Accept: 'application/json' }
    });
    return (Array.isArray(data.results) ? data.results : []).slice(0, 10).map(function (item) {
      return {
        id: String(item.id || ''),
        name: String(item.display_name || ''),
        citedBy: Number(item.cited_by_count) || 0,
        hint: String(item.hint || '')
      };
    });
  }

  async function fetchCrossrefAbstract(doi) {
    const params = new URLSearchParams();
    const cfg = await getConfig();
    if (cfg && cfg.openalexEmail) params.set('mailto', String(cfg.openalexEmail).slice(0, 200));
    const url = 'https://api.crossref.org/works/' + encodeURIComponent(doi) +
      (params.toString() ? '?' + params.toString() : '');
    const data = await queue.requestJson(url, { headers: { Accept: 'application/json' } });
    return parseCrossrefAbstract(data && data.message);
  }

  /** 单条 DOI 直查 Crossref → 归一化调研行（无标题的畸形记录返回 null）。
   *  get_work 兜底用：刚登记、OpenAlex 尚未索引的最新文献常只有这里能解析到。 */
  async function fetchCrossrefWork(doi) {
    const params = new URLSearchParams();
    const cfg = await getConfig();
    if (cfg && cfg.openalexEmail) params.set('mailto', String(cfg.openalexEmail).slice(0, 200));
    const url = 'https://api.crossref.org/works/' + encodeURIComponent(doi) +
      (params.toString() ? '?' + params.toString() : '');
    const data = await queue.requestJson(url, { headers: { Accept: 'application/json' } });
    if (!data || !data.message) return null;
    const row = LitResearch.normalizeCrossrefWork(data.message);
    return row.title ? row : null;
  }

  async function fetchElsevierAbstract(doi) {
    const cfg = await getConfig();
    if (!cfg || !cfg.elsevierApiKey) return '';
    const url = 'https://api.elsevier.com/content/abstract/doi/' + encodeURIComponent(doi);
    const data = await queue.requestJson(url, {
      headers: { Accept: 'application/json', 'X-ELS-APIKey': cfg.elsevierApiKey }
    });
    return parseElsevierAbstract(data);
  }

  /**
   * 回填一批 [{id, doi}]：逐条 Crossref → Elsevier；命中即返回该条来源。
   * 429/配额类错误 → 记账停批（stopped=true，剩余条目下次续跑）；404/无摘要 → 该条记空来源继续。
   */
  async function backfillAbstracts(rows, callbacks) {
    const list = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.doi; });
    const onProgress = callbacks && callbacks.onProgress;
    const results = [];
    let updated = 0;
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      let abstract = '';
      let source = '';
      try {
        abstract = await fetchCrossrefAbstract(row.doi);
        if (abstract) source = 'crossref';
      } catch (error) {
        if (error && error.status === 429) {
          return { updated: updated, results: results, stopped: true, reason: 'rate_limited', done: i, total: list.length };
        }
        // 其余错误（403/5xx 耗尽重试等）：该条放弃，继续下一条
      }
      if (!abstract) {
        try {
          abstract = await fetchElsevierAbstract(row.doi);
          if (abstract) source = 'elsevier';
        } catch (error) {
          if (error && error.status === 429) {
            return { updated: updated, results: results, stopped: true, reason: 'rate_limited', done: i, total: list.length };
          }
        }
      }
      if (abstract) {
        results.push({ id: row.id, source: source, abstract: abstract });
        updated++;
      } else {
        results.push({ id: row.id, source: '', abstract: '' });
      }
      if (typeof onProgress === 'function') onProgress({ done: i + 1, total: list.length, updated: updated });
    }
    return { updated: updated, results: results, stopped: false, reason: '', done: list.length, total: list.length };
  }

  async function openalexParams(extra) {
    const params = new URLSearchParams();
    const cfg = await getConfig();
    if (cfg && cfg.openalexEmail) params.set('mailto', String(cfg.openalexEmail).slice(0, 200));
    if (cfg && cfg.openalexApiKey) params.set('api_key', String(cfg.openalexApiKey).slice(0, 200));
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key] != null && extra[key] !== '') params.set(key, String(extra[key]));
    });
    return params;
  }

  /** OpenAlex 429 → 带行动指引的错误：匿名配额按出口 IP 共享（代理/公司网下常被挤兑
   *  耗尽），免费 API Key 走个人配额。这条话术会进检索工具的失败说明，用户照着做即可。 */
  function openalexQuotaHint(error) {
    if (error && error.status === 429) {
      const hours = Math.max(1, Math.round((error.retryAfterSeconds || 0) / 3600));
      const err = new Error('OpenAlex 免费额度已用尽（匿名额度按出口 IP 共享、每日重置，本次约 ' + hours +
        ' 小时后恢复）；在「设置 → 检索与元数据服务」填入免费 API Key（openalex.org/settings/api，注册即得）' +
        '可改用个人每日配额，不再与共享出口 IP 抢额度。检索可先用 Crossref 侧结果');
      err.status = 429;
      err.retryAfterSeconds = error.retryAfterSeconds || 0;
      return err;
    }
    return error;
  }

  function yearFilters(input) {
    const filters = [];
    const from = Number(input && input.yearFrom);
    const to = Number(input && input.yearTo);
    if (isFinite(from) && from > 1000) filters.push('from_publication_date:' + Math.floor(from) + '-01-01');
    if (isFinite(to) && to > 1000) filters.push('to_publication_date:' + Math.floor(to) + '-12-31');
    return filters;
  }

  /**
   * 关键词 / 语义检索（单页，默认 25 条上限 50——调研对话不需要深分页，手动模式可翻页）。
   * mode='semantic' 走 OpenAlex 的 search.semantic（官方基于标题/摘要向量与余弦相似度，
   * 接受整段自然语言），限 1 req/s 且单页上限 50；sort 固定 relevance_score:desc
   * （有检索词时官方不支持其他排序）。
   */
  async function searchOpenAlex(input) {
    const req = input || {};
    const mode = req.mode === 'semantic' ? 'semantic' : 'keyword';
    const limit = Math.max(1, Math.min(mode === 'semantic' ? 50 : 50, Number(req.limit) || 25));
    const params = await openalexParams({
      per_page: limit,
      page: Math.max(1, Number(req.page) || 1)
    });
    const query = String(req.query || '').trim().slice(0, mode === 'semantic' ? 2000 : 500);
    if (query) params.set(mode === 'semantic' ? 'search.semantic' : 'search', query);
    const filters = yearFilters(req);
    if (filters.length) params.set('filter', filters.join(','));
    if (query && mode !== 'semantic') params.set('sort', 'relevance_score:desc');
    if (mode === 'semantic') await openalexSemanticGate();
    let data;
    try {
      data = await queue.requestJson(OPENALEX_WORKS + '?' + params.toString(), {
        headers: { Accept: 'application/json' }
      });
    } catch (error) { throw openalexQuotaHint(error); }
    const results = Array.isArray(data.results) ? data.results : [];
    return {
      mode: mode,
      count: (data.meta && Number(data.meta.count)) || results.length,
      results: results.map(LitResearch.normalizeOpenAlexWork).filter(function (row) { return row.id; })
    };
  }

  /**
   * Semantic Scholar 相关度检索（Academic Graph API）。
   *
   * 事实边界（2026-09-20 查证 api.semanticscholar.org/api-docs/graph）：
   * - 公开 API **没有** 文本→向量的语义检索端点；/paper/search 是 S2 自己的相关度排序
   *   （比严格关键词匹配宽松，但不是「段落找文献」的向量召回）。本方法如实按相关度检索命名，
   *   不冒充语义检索；「段落找文献」由 main 的 find-literature 多源合并承担；
   * - 无 Key 走共享池（≈100 req/5min 且与他人争用），带 Key 1 req/s —— 策略已在队列上设；
   * - 需要 fields 才返回正文以外的字段；年份用 `year=YYYY-YYYY` 或 `year=YYYY`。
   */
  async function searchSemanticScholar(input) {
    const cfg = await getConfig();
    const req = input || {};
    const params = new URLSearchParams();
    params.set('query', String(req.query || '').trim().slice(0, 500));
    params.set('fields', 'paperId,title,abstract,venue,year,citationCount,authors,externalIds,openAccessPdf,publicationTypes,url,tldr');
    params.set('limit', String(Math.max(1, Math.min(100, Number(req.limit) || 20))));
    const offset = Math.max(0, Number(req.offset) || 0);
    if (offset) params.set('offset', String(offset));
    const yearFrom = Number(req.yearFrom);
    const yearTo = Number(req.yearTo);
    if (isFinite(yearFrom) && yearFrom > 1000) {
      params.set('year', isFinite(yearTo) && yearTo > 1000 ? Math.floor(yearFrom) + '-' + Math.floor(yearTo) : Math.floor(yearFrom) + '-');
    } else if (isFinite(yearTo) && yearTo > 1000) {
      params.set('year', '-' + Math.floor(yearTo));
    }
    if (Number(req.minCitations) > 0) params.set('minCitationCount', String(Math.floor(Number(req.minCitations))));
    if (req.openAccessOnly === true) params.set('openAccessPdf', '');
    const headers = { Accept: 'application/json' };
    if (cfg && cfg.semanticscholarApiKey) headers['x-api-key'] = String(cfg.semanticscholarApiKey);
    const data = await queue.requestJson(S2_SEARCH + '?' + params.toString(), { headers: headers })
      .catch(function (error) {
        if (error && error.status === 403) {
          const denied = new Error('Semantic Scholar 拒绝访问（HTTP 403）：API Key 无效，或共享池限流（配置 Key 可提升配额）');
          denied.status = error.status;   // 同上：状态码留给连接测试分类
          throw denied;
        }
        throw error;
      });
    const list = Array.isArray(data && data.data) ? data.data : [];
    return {
      total: Number(data && data.total) || list.length,
      offset: Number(data && data.offset) || offset,
      hasMore: !!(data && data.next),
      results: list.map(LitResearch.normalizeSemanticScholarPaper).filter(function (row) { return row.title; })
    };
  }

  /**
   * Crossref 检索（DOI 注册库，无需 Key；mailto 进 polite pool 与 OpenAlex 共用邮箱配置）。
   * 出版商一登记就收录——最新上线的论文常先于 OpenAlex / S2 出现在这里。
   * query.bibliographic 官方按相关度排序（sort 与 query 不兼容，故不传 sort）；
   * 年份走 from-pub-date / until-pub-date 过滤（覆盖 print/online 发行日期）。
   */
  // 检索噪声类型：eLife 一类出版商把同行评审记录（Review for … / Decision letter …）
  // 也注册成 DOI（type=peer-review），相关度排序里大量混入；component 是论文的图表部件
  // 记录。两者都不属于「文献发现」，检索侧剔除——直查单条 DOI（fetchCrossrefWork）
  // 不过滤：用户点名要的 DOI 照常解析。
  const CROSSREF_SEARCH_NOISE_TYPES = new Set(['peer-review', 'component']);
  async function searchCrossref(input) {
    const req = input || {};
    const query = String(req.query || '').trim().slice(0, 500);
    if (!query) throw new Error('Crossref 检索词为空');
    const params = new URLSearchParams();
    params.set('query.bibliographic', query);
    const limit = Math.max(1, Math.min(50, Number(req.limit) || 20));
    params.set('rows', String(limit));
    const offset = Math.max(0, Number(req.offset) || 0);
    if (offset) params.set('offset', String(offset));
    const cfg = await getConfig();
    if (cfg && cfg.openalexEmail) params.set('mailto', String(cfg.openalexEmail).slice(0, 200));
    const filters = [];
    const from = Number(req.yearFrom);
    const to = Number(req.yearTo);
    if (isFinite(from) && from > 1000) filters.push('from-pub-date:' + Math.floor(from) + '-01-01');
    if (isFinite(to) && to > 1000) filters.push('until-pub-date:' + Math.floor(to) + '-12-31');
    if (filters.length) params.set('filter', filters.join(','));
    const data = await queue.requestJson('https://api.crossref.org/works?' + params.toString(), {
      headers: { Accept: 'application/json' }
    });
    const message = data && data.message ? data.message : {};
    const items = Array.isArray(message.items) ? message.items : [];
    const total = Number(message['total-results']) || items.length;
    const results = items
      .filter(function (item) {
        return !CROSSREF_SEARCH_NOISE_TYPES.has(String(item && item.type || '').toLowerCase());
      })
      .map(LitResearch.normalizeCrossrefWork)
      .filter(function (row) { return row.title; });
    return {
      count: total,
      offset: offset,
      hasMore: offset + items.length < total,
      results: results
    };
  }

  /** 批量按 ID 拉取（扩邻居/补登记用）：filter=openalex_id:W1|W2…，100/批。
   *  分块并发发入队列（结果仍按分块序落位）：主机策略本就限 OpenAlex 并发 3 + 最小间隔，
   *  并发递交只会填满策略允许的槽位，不会越过限流。 */
  async function fetchWorksByIds(ids) {
    const list = (Array.isArray(ids) ? ids : []).map(LitResearch.shortWorkId)
      .filter(function (id) { return /^W\d+$/.test(id); });
    const unique = Array.from(new Set(list));
    const chunks = [];
    for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));
    const groups = await Promise.all(chunks.map(async function (chunk) {
      const params = await openalexParams({
        filter: 'openalex_id:' + chunk.join('|'),
        per_page: 100
      });
      let data;
      try {
        data = await queue.requestJson(OPENALEX_WORKS + '?' + params.toString(), {
          headers: { Accept: 'application/json' }
        });
      } catch (error) { throw openalexQuotaHint(error); }
      return (Array.isArray(data.results) ? data.results : []).map(LitResearch.normalizeOpenAlexWork)
        .filter(function (row) { return row.id; });
    }));
    const out = [];
    groups.forEach(function (rows) { rows.forEach(function (row) { out.push(row); }); });
    return out;
  }

  /** 批量按 DOI 向 OpenAlex 反查 work（Scopus 归并用）：filter=doi:10..|10..，25/批（同上，分块并发） */
  async function fetchWorksByDois(dois) {
    const list = (Array.isArray(dois) ? dois : []).map(LitResearch.normalizeDoi)
      .filter(function (doi) { return /^10\.\d{4,9}\//.test(doi); });
    const unique = Array.from(new Set(list));
    const chunks = [];
    for (let i = 0; i < unique.length; i += 25) chunks.push(unique.slice(i, i + 25));
    const groups = await Promise.all(chunks.map(async function (chunk) {
      const params = await openalexParams({
        filter: 'doi:' + chunk.join('|'),
        per_page: 25
      });
      let data;
      try {
        data = await queue.requestJson(OPENALEX_WORKS + '?' + params.toString(), {
          headers: { Accept: 'application/json' }
        });
      } catch (error) { throw openalexQuotaHint(error); }
      return (Array.isArray(data.results) ? data.results : []).map(LitResearch.normalizeOpenAlexWork)
        .filter(function (row) { return row.id; });
    }));
    const out = [];
    groups.forEach(function (rows) { rows.forEach(function (row) { out.push(row); }); });
    return out;
  }

  /**
   * Scopus 检索（Elsevier Search API，STANDARD view）。
   * 事实边界（2026-09-20 查证 dev.elsevier.com）：
   * - 免费 Key 即可检索、返回基本元数据（题名/作者/来源/DOI/Scopus 引用数）；
   * - **检索结果不含摘要**（摘要只能走 Abstract Retrieval 且受订阅限制）；
   * - COMPLETE view / 更高配额需要机构订阅（insttoken）；
   * - 走同一节流队列（api.elsevier.com 单并发 ≥1.1s），401/403 明确报权限问题。
   */
  async function searchScopus(input) {
    const cfg = await getConfig();
    if (!cfg || !cfg.elsevierApiKey) {
      const err = new Error('Elsevier API Key 未配置（设置 → 集成与服务 → 检索与元数据服务）');
      err.code = 'NO_KEY';
      throw err;
    }
    const req = input || {};
    const query = buildScopusQuery(req);
    const params = new URLSearchParams({
      query: query,
      view: 'STANDARD',
      count: String(Math.max(1, Math.min(25, Number(req.limit) || 20))),
      start: '0',
      httpAccept: 'application/json'
    });
    const data = await queue.requestJson('https://api.elsevier.com/content/search/scopus?' + params.toString(), {
      headers: { Accept: 'application/json', 'X-ELS-APIKey': cfg.elsevierApiKey }
    }).catch(function (error) {
      if (error && (error.status === 401 || error.status === 403)) {
        const denied = new Error('Scopus 检索权限不足（HTTP ' + error.status +
          '）：Key 未开通 Scopus Search，或需要机构订阅（insttoken）');
        // 保留原始状态码：连接测试要按 401/403 与 429 分别回报，
        // 重抛时丢掉 status 就只剩「失败」一种说法了
        denied.status = error.status;
        throw denied;
      }
      throw error;
    });
    const wrapper = data && data['search-results'];
    const entries = wrapper && Array.isArray(wrapper.entry) ? wrapper.entry : [];
    const hits = entries.map(normalizeScopusHit).filter(function (hit) { return hit.title || hit.doi; });
    return {
      count: Number(wrapper && wrapper['opensearch:totalResults']) || hits.length,
      hits: hits
    };
  }

  /* ---------------- 连接测试（设置页「测试全部服务」一次测完本节所有源） ----------------
   * 每个源打一发最小真实请求：只读、不写库、**不抛异常**——失败以
   * { status:'error', code } 返回，由渲染层翻成用户语言（主进程不产出面向用户的句子）。
   * code 语义固定：missing_key 未配置 / unauthorized 凭据无效或无权限 /
   * rate_limited 上游限流 / not_found 目标记录不存在（端点本身通了）/ network 不可达 /
   * error 其余。只做「能不能用」的判定，不进业务链、不改任何状态。
   * 客户端与业务路径共用同一个节流队列：测试同样受主机限流约束，不会额外冲击配额。
   * （错误分类在 net-throttle 的 classifyTestError，webfetch-net 复用同一份。） */

  /** OpenAlex：固定 DOI 反查一发。无 Key 也能用（polite pool 靠邮箱），
   *  channel 如实回报实际走的是哪条通道——否则用户会以为填的 Key 生效了。 */
  async function testOpenAlex() {
    const cfg = (await getConfig()) || {};
    try {
      const params = await openalexParams({ filter: 'doi:10.1038/nature12373', 'per-page': '1' });
      const data = await queue.requestJson(OPENALEX_WORKS + '?' + params.toString(), {
        headers: { Accept: 'application/json' }
      });
      const count = Number(data && data.meta && data.meta.count);
      return {
        status: 'ok', code: '',
        channel: cfg.openalexApiKey ? 'key' : (cfg.openalexEmail ? 'email' : 'anonymous'),
        count: isFinite(count) ? count : null
      };
    } catch (error) { return { status: 'error', code: classifyTestError(error) }; }
  }

  /** Elsevier：两个能力分开回报——摘要检索端点（回填链用的那个，只需 Key）
   *  与 Scopus 检索（另需机构订阅）。「摘要通但 Scopus 无权限」是最常见的组合，
   *  必须分开说，否则用户会以为 Key 坏了。未配置 Key → skipped。
   *  摘要端点返回 404 时按「凭据没问题、该 DOI 不在库」处理（401/403 才会被判无效）。 */
  async function testElsevier() {
    const cfg = (await getConfig()) || {};
    if (!cfg.elsevierApiKey) return { status: 'skipped', code: 'missing_key' };
    const result = { status: 'ok', code: '', abstract: false, scopus: '' };
    try {
      result.abstract = !!(await fetchElsevierAbstract('10.1016/j.cell.2011.02.013'));
    } catch (error) {
      const code = classifyTestError(error);
      if (code !== 'not_found') return { status: 'error', code: code };
    }
    try {
      await searchScopus({ query: 'literature management', limit: 1 });
      result.scopus = 'ok';
    } catch (error) { result.scopus = classifyTestError(error); }
    return result;
  }

  return {
    searchOpenAlex: searchOpenAlex,
    searchSemanticScholar: searchSemanticScholar,
    searchCrossref: searchCrossref,
    fetchCrossrefWork: fetchCrossrefWork,
    fetchWorksByIds: fetchWorksByIds,
    fetchWorksByDois: fetchWorksByDois,
    searchScopus: searchScopus,
    testOpenAlex: testOpenAlex,
    testElsevier: testElsevier,
    backfillAbstracts: backfillAbstracts,
    autocomplete: autocomplete,
    parseCrossrefAbstract: parseCrossrefAbstract,
    parseElsevierAbstract: parseElsevierAbstract
  };
}

module.exports = {
  createResearchNet: createResearchNet,
  createEndpointGate: createEndpointGate,
  // 节流队列与错误分类的正典位置已迁 electron/net-throttle.js；此处按原 API 转发，
  // 既有消费方（test/research-net.test.js 等）引用路径不变、行为不变。
  createThrottleQueue: createThrottleQueue,
  classifyTestError: classifyTestError,
  parseCrossrefAbstract: parseCrossrefAbstract,
  parseElsevierAbstract: parseElsevierAbstract,
  buildScopusQuery: buildScopusQuery,
  normalizeScopusHit: normalizeScopusHit
};
