'use strict';

/* research:* + embed:* —— AI 调研助手子系统：调研库、多源检索、向量嵌入、
 * 临时全文链、网页检索、段落找文献、引文网络（自 main.js registerIpc 平移）。
 * scheduleAutoEmbed 导出给 main.js 启动装配的 60s 空闲巡检 setInterval 用。 */

const { app, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { storeFileInto } = require('../integrations.js');
const { itemAttachmentDir } = require('../item-storage.js');
const LitResearch = require('../../js/research.js');
const LitGraphGen = require('../../js/graphgen.js');
const LitLitSearch = require('../../js/litsearch.js');
const LitWebFetch = require('../../js/webfetch.js');
const LitMarkdown = require('../../js/markdown.js');
const litgraph = require('../litgraph.js');
const ctx = require('./context.js');
const { createSafePublicHttpsFetch } = require('../safe-fetch.js');

const safePublicFetch = createSafePublicHttpsFetch();

module.exports = { register: register, scheduleAutoEmbed: scheduleAutoEmbed };

/**
 * 语义检索是 AI 助手的工具（正式库那条 `semantic:` 搜索链已移除，没有用户侧开关）：
 * 向量模型配置就绪即视为可用。巡检与检索入库后都走这里，配置不齐直接跳过
 * （不调用 maybeAutoBuild，免得每 60s 往日志里写一条「未配置」的失败）。
 */
function scheduleAutoEmbed() {
  if (!ctx.researchEmbedder || ctx.researchEmbedder.isRunning()) return;
  Promise.resolve()
    .then(function () { return ctx.researchEmbedder.resolveTarget(); })
    .then(function (target) {
      if (!target || target.ok !== true) return null;
      return ctx.researchEmbedder.maybeAutoBuild(true);
    })
    .catch(function () {});
}

/* 自动摘要回填（M9-6：替代设置页手动按钮）：检索入库 / 导入完成后，对本批缺摘要且有
 * DOI 的条目后台跑 Crossref→Elsevier（同一节流队列与配额记账护栏），单批 ≤25 条。
 * fire-and-forget：不阻塞检索返回；失败仅记启动日志，缺摘要条目下次检索仍会被选中。 */
function scheduleAutoBackfill(rows) {
  if (!ctx.researchDb || !ctx.researchNet || !Array.isArray(rows)) return;
  const list = rows
    .filter(function (r) { return r && r.id && r.doi && !(r.abstract && r.abstract.length); })
    .slice(0, 25)
    .map(function (r) { return { id: r.id, doi: r.doi }; });
  if (!list.length) return;
  ctx.researchNet.backfillAbstracts(list, {}).then(function (result) {
    (result.results || []).forEach(function (row) {
      if (row.abstract) ctx.researchDb.updateWorkText(row.id, { abstract: row.abstract }, row.source);
    });
    ctx.startupLog('auto-backfill: ' + (result.updated || 0) + '/' + list.length +
      (result.stopped ? ' (rate-limited, will resume next round)' : ''));
  }).catch(function (error) {
    ctx.startupLog('auto-backfill failed: ' + (error && error.message || error));
  });
}

async function webSearchGateOk() {
  try {
    return ctx.libraryDb.getSetting('webSearchEnabled') === true &&
      ctx.libraryDb.getSetting('webSearchEgressAcknowledged') === true;
  } catch (error) { return false; }
}

/* R12：抓取正文的内存缓存（url → markdown），fetch_page 的 offset 续读命中缓存
 * 不再发网络请求；上限 8 条（超出按插入序淘汰），只缓存最近一次会话进程内使用。 */
const fetchedPageCache = new Map();
const FETCH_PAGE_EXCERPT = 4000;
function cacheFetchPage(key, entry) {
  if (fetchedPageCache.size >= 8) {
    fetchedPageCache.delete(fetchedPageCache.keys().next().value);
  }
  fetchedPageCache.set(key, entry);
}

/* R15/R16：正式库已收藏索引（researchId + DOI 两路）——「调研库已有」与「正式库已收藏」
 * 是两件事，旧实现用一个 collected=!isNew 把前者冒充后者，模型据此误报「已在你库里」。
 * 结果按「正式库最后一次写入」缓存：loadState 要 JSON.parse + normalize 整库（实测 6k 篇
 * ~110-130ms），而 web_search/find_literature 每次召回都要问一遍——主进程即窗口的消息泵，
 * 每轮白付一次就会看到「一调工具就卡」。库一写 lastLibraryWriteAt 就变，缓存随之失效。 */
const IN_LIBRARY_CACHE_MS = 30000;
let inLibraryCache = { key: -1, at: 0, index: new Set() };

/* 补登记（research:register）的活动运行标记：research:register-cancel 置 canceled，
 * 分片循环在片头检查、当前片收尾后带着已完成部分返回。同一时刻只有渲染层一个调用方。 */
let activeRegisterRun = null;

async function inLibraryIndex() {
  const key = Number(ctx.lastLibraryWriteAt) || 0;
  if (inLibraryCache.key === key && Date.now() - inLibraryCache.at < IN_LIBRARY_CACHE_MS) {
    return inLibraryCache.index;
  }
  const out = new Set();
  try {
    const state = await ctx.libraryDb.loadState();
    (state.papers || []).forEach(function (p) {
      if (!p || p.deletedAt) return;
      (Array.isArray(p.researchIds) ? p.researchIds : []).forEach(function (id) {
        if (id) out.add(String(id));
      });
      if (p.doi) out.add('doi:' + LitResearch.normalizeDoi(p.doi));
    });
    inLibraryCache = { key: key, at: Date.now(), index: out };
  } catch (error) {
    // 正式库读不到就报「未知已收藏」= 全部未命中，不阻断检索（也不缓存这份空结果）
    return out;
  }
  return out;
}

const FIND_MAX_CLAIMS = 12;
const FIND_REMOTE_CLAIM_BUDGET = 4;
const FIND_PER_CLAIM = 5;

/**
 * 把一批候选（我们的调研行形态）归位入库，并返回**顺序一一对应**的合并层输入。
 * 身份解析顺序：既有 id（OpenAlex 的 W…）→ DOI → S2 paperId → 规范化标题 → 新建 local:。
 * 检索即入库：幂等 UPSERT，重复检索只刷新记录，不产生重复行（literature-mcp 同策略）。
 */
function ingestCandidates(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row || !row.title) { out.push(null); return; }
    let workId = String(row.id || '');
    if (!workId && row.doi) workId = ctx.researchDb.findByExtId('doi', row.doi) || '';
    if (!workId && row.s2Id) workId = ctx.researchDb.findByExtId('s2', row.s2Id) || '';
    // A-followup #5：稳定标识优先——同一网页再次检索时先按已登记的 URL 找回身份，
    // 不能只靠标题（标题变了/规范键不匹配就会另造一个 local: 身份，造成身份分裂）
    if (!workId && row.pageUrl) workId = ctx.researchDb.findByExtId('url', row.pageUrl) || '';
    if (!workId) workId = ctx.researchDb.findIdByNormalizedTitle(row.title) || '';
    if (!workId) workId = 'local:' + require('node:crypto').randomBytes(8).toString('hex');
    const draft = Object.assign({}, row, { id: workId });
    delete draft.s2Id;
    ctx.researchDb.upsertWorks([draft]);
    const exts = LitResearch.extIdsForRow({ id: workId, doi: draft.doi, s2Id: row.s2Id, pageUrl: draft.pageUrl });
    if (exts.length) ctx.researchDb.addExtIds(workId, exts);
    out.push({
      workId: workId, id: workId, doi: draft.doi || '', title: draft.title,
      year: draft.year == null ? null : draft.year,
      sourceName: draft.sourceName || '', venue: draft.sourceName || '',
      abstract: draft.abstract || '', snippet: draft.snippet || '',
      pageUrl: draft.pageUrl || '', oaUrl: draft.oaUrl || '',
      citedBy: Number(draft.citedBy) || 0, type: draft.type || ''
    });
  });
  return out;
}

/**
 * 单条论点的多路召回。claim 可以是字符串或 { text, variants }——variants 是同一论点的
 * 多语言版本，各版本都查一遍（中文论点查中文库、英文论点查英文库）。
 * 返回 { candidates, routes }——routes 逐路记成败，供工具层如实呈现「哪些线路查过、哪些没查/失败」。
 */
async function recallForClaim(claim, recallCtx) {
  const routes = [];
  const groups = [];
  const queries = (claim && Array.isArray(claim.variants) && claim.variants.length)
    ? claim.variants.slice(0, 2)
    : [String(claim && claim.text != null ? claim.text : claim || '')];
  // S2：年份约束贯穿每条召回路线（工具接收了就必须生效，不能只存在参数里）
  const yearFrom = isFinite(recallCtx.yearFrom) && recallCtx.yearFrom > 1000 ? Math.floor(recallCtx.yearFrom) : null;
  const yearTo = isFinite(recallCtx.yearTo) && recallCtx.yearTo > 1000 ? Math.floor(recallCtx.yearTo) : null;
  const inYear = (w) => {
    if (w && w.year != null && Number.isFinite(Number(w.year))) {
      const y = Number(w.year);
      if (yearFrom != null && y < yearFrom) return false;
      if (yearTo != null && y > yearTo) return false;
    }
    return true; // 年份未知不剔除（在 notes 里说明），只剔除明确越界的
  };

  // ① 本地调研库关键词（FTS/LIKE）：无任何外部依赖，永远可用
  queries.forEach(function (q) {
    try {
      const local = ctx.researchDb.queryWorks({ q: q, limit: 12, yearFrom: yearFrom, yearTo: yearTo });
      const rows = ctx.researchDb.getWorks((local.works || []).map(function (w) { return w.id; }));
      groups.push({ provider: 'library', works: rows });
      routes.push({ id: 'library', ok: true, count: rows.length, query: q });
    } catch (error) {
      routes.push({ id: 'library', ok: false, count: 0, query: q, error: String(error && error.message || error) });
    }
  });

  // ② 本地调研库向量（需已配置嵌入模型且有向量）——cosineSearch 无年份参数，取回后过滤
  if (recallCtx.vectorReady) {
    for (const q of queries) {
      try {
        const embedded = await ctx.embedService.embedTexts({ texts: [q] });
        const vec = new Float32Array(embedded.vectors[0]);
        const hits = ctx.researchDb.cosineSearch(Buffer.from(vec.buffer), {
          limit: 24, model: embedded.model, recipe: LitResearch.EMBED_RECIPE
        });
        const rows = ctx.researchDb.getWorks(hits.map(function (h) { return h.workId; })).filter(inYear);
        groups.push({ provider: 'library-vector', works: rows });
        routes.push({ id: 'library-vector', ok: true, count: rows.length, query: q });
      } catch (error) {
        routes.push({ id: 'library-vector', ok: false, count: 0, query: q, error: String(error && error.message || error) });
      }
    }
  }

  // ③ 远端召回（受预算控制；超出预算的论点只走本地，如实标记）
  if (!recallCtx.remote) {
    routes.push({ id: 'remote', ok: true, count: 0, skipped: 'over_budget' });
    return { candidates: LitLitSearch.mergeCandidates(groups), routes: routes };
  }
  const remoteRoutes = [
    {
      id: 'openalex-semantic', enabled: recallCtx.providers.openalexSemantic,
      run: async function (q) {
        const r = await ctx.researchNet.searchOpenAlex({ query: q, mode: 'semantic', limit: 15, yearFrom: yearFrom, yearTo: yearTo });
        return { rows: r.results || [], total: r.count };
      }
    },
    {
      id: 'openalex-keyword', enabled: recallCtx.providers.openalexKeyword,
      run: async function (q) {
        const r = await ctx.researchNet.searchOpenAlex({ query: q, mode: 'keyword', limit: 15, yearFrom: yearFrom, yearTo: yearTo });
        return { rows: r.results || [], total: r.count };
      }
    },
    {
      id: 'semanticscholar', enabled: recallCtx.providers.semanticscholar,
      run: async function (q) {
        const r = await ctx.researchNet.searchSemanticScholar({ query: q, limit: 15, yearFrom: yearFrom, yearTo: yearTo });
        return { rows: r.results || [], total: r.total };
      }
    },
    {
      id: 'web', enabled: recallCtx.providers.web,
      run: async function (q) {
        const r = await ctx.webFetchNet.webSearch({ query: q, mode: 'paper', limit: 10, yearFrom: yearFrom, yearTo: yearTo });
        if (!r.shapeOk) throw new Error('网页检索响应形状异常');
        return { rows: (r.results || []).map(LitWebFetch.workFromSearchResult), total: r.total };
      }
    }
  ];
  for (const route of remoteRoutes) {
    if (!route.enabled) continue;
    // 同一路线的多个语言版本合并成一条 route 记录（成败按最后一次为准，count 累加）
    let ok = true;
    let count = 0;
    let total = 0;
    let error = '';
    for (const q of queries) {
      try {
        const r = await route.run(q);
        const candidates = ingestCandidates(r.rows);
        const works = candidates.filter(Boolean);
        groups.push({ provider: route.id, works: works });
        count += works.length;
        total = Math.max(total, Number(r.total) || 0);
      } catch (err) {
        ok = false;
        error = String(err && err.message || err);
      }
    }
    routes.push(ok
      ? { id: route.id, ok: true, count: count, total: total }
      : { id: route.id, ok: false, count: count, total: total, error: error });
  }
  return { candidates: LitLitSearch.mergeCandidates(groups), routes: routes };
}

function register() {
  // ===== 调研助手（一期）：调研库 / OpenAlex 检索 / LLM 流式 / 会话 =====
  ctx.handle('research:query', function (_event, input) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    return ctx.researchDb.queryWorks(input || {});
  });
  ctx.handle('research:get-works', function (_event, ids) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    return ctx.researchDb.getWorks(ids);
  });
  ctx.handle('research:stats', function () {
    return ctx.researchDb ? ctx.researchDb.stats() : { error: ctx.T('调研库未就绪') };
  });
  ctx.handle('research:search-openalex', async function (_event, input) {
    if (!ctx.researchDb || !ctx.researchNet) throw new Error(ctx.T('调研库未就绪'));
    const req = input || {};
    // mode='semantic' 走 OpenAlex 的 search.semantic（整段自然语言，1 req/s）
    const result = await ctx.researchNet.searchOpenAlex(req);
    const upserted = ctx.researchDb.upsertWorks(result.results);
    ctx.researchDb.recordSearch({ q: req.query, filters: { yearFrom: req.yearFrom, yearTo: req.yearTo, mode: result.mode }, count: result.count });
    scheduleAutoBackfill(result.results); // 本批缺摘要的新条目自动回填（后台，不阻塞返回）
    // 检索结果自动嵌入（向量模型就绪 + 构建器空闲）：走 maybeAutoBuild——
    // 失败批次有持久 failed 标记时不再自动发起（R14 计费红线），手动构建才会清除标记
    scheduleAutoEmbed();
    return {
      mode: result.mode,
      count: result.count,
      stored: upserted.count,
      works: result.results.slice(0, 50).map(function (row) {
        return {
          id: row.id, doi: row.doi, title: row.title, year: row.year,
          sourceName: row.sourceName, citedBy: row.citedBy, isOa: row.isOa,
          hasAbstract: !!(row.abstract && row.abstract.length)
        };
      })
    };
  });
  /* Scopus 检索（Elsevier Search API）：作为 OpenAlex 的互补发现源——Scopus 引用数、
   * 独立召回；结果按 DOI 归并进调研库（已存在→标注；OpenAlex 反查到 W-id→以 OpenAlex
   * 元数据入库；查不到→建 local: 身份兜底）。检索结果本身不含摘要（API 限制）。 */
  ctx.handle('research:search-scopus', async function (_event, input) {
    if (!ctx.researchDb || !ctx.researchNet) throw new Error(ctx.T('调研库未就绪'));
    const req = input || {};
    const result = await ctx.researchNet.searchScopus(req);
    const hits = result.hits || [];
    const byDoi = {};
    const missing = [];
    hits.forEach(function (hit) {
      if (hit.doi) {
        const existing = ctx.researchDb.findByExtId('doi', hit.doi);
        if (existing) byDoi[hit.doi] = existing;
        else missing.push(hit.doi);
      }
    });
    let resolved = [];
    if (missing.length) {
      try { resolved = await ctx.researchNet.fetchWorksByDois(missing); } catch (error) { /* 反查失败不阻断，走 local 兜底 */ }
    }
    const resolvedDoi = {};
    resolved.forEach(function (row) { if (row.doi) resolvedDoi[row.doi] = row; });
    if (resolved.length) ctx.researchDb.upsertWorks(resolved);
    // OpenAlex 也没有的（无 DOI 或反查未命中）：local 身份兜底，标题/来源/Scopus 引用数入库
    const locals = hits.filter(function (hit) {
      if (hit.doi && (byDoi[hit.doi] || resolvedDoi[hit.doi])) return false;
      return !!(hit.title);
    }).map(function (hit) {
      return {
        id: 'local:' + require('node:crypto').createHash('sha1').update(hit.eid || hit.doi || hit.title).digest('hex').slice(0, 12),
        doi: hit.doi || '', title: hit.title, year: hit.year,
        sourceName: hit.source, citedBy: hit.citedByScopus,
        isOa: false, authors: hit.authors, refs: []
      };
    });
    if (locals.length) ctx.researchDb.upsertWorks(locals);
    scheduleAutoBackfill(resolved.concat(locals)); // 本批缺摘要条目自动回填（后台）
    ctx.researchDb.recordSearch({ q: req.query, filters: { source: 'scopus', yearFrom: req.yearFrom, yearTo: req.yearTo }, count: result.count });
    // A-followup #3：正式库收藏状态必须来自**正式库反查**——此前工具层拿「调研库已有」
    // （existed）冒充「已收藏到正式库」，模型据此误报「已在你库里」或跳过用户想做的收藏
    const inLibrary = await inLibraryIndex();
    return {
      count: result.count,
      stored: resolved.length + locals.length,
      works: hits.map(function (hit) {
        const workId = (hit.doi && (byDoi[hit.doi] || (resolvedDoi[hit.doi] && resolvedDoi[hit.doi].id))) ||
          (hit.title && 'local:' + require('node:crypto').createHash('sha1').update(hit.eid || hit.doi || hit.title).digest('hex').slice(0, 12)) || '';
        return {
          id: workId, doi: hit.doi, title: hit.title, year: hit.year,
          sourceName: hit.source, citedBy: hit.citedByScopus, isOa: false,
          existed: !!(hit.doi && byDoi[hit.doi]),
          inLibrary: inLibrary.has(workId) || !!(hit.doi && inLibrary.has('doi:' + LitResearch.normalizeDoi(hit.doi))),
          hasAbstract: false
        };
      }).filter(function (w) { return w.id; })
    };
  });

  ctx.handle('research:import-harness', async function (event) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    let file = path.join(app.getPath('home'), '.AI-CACHE', 'openalex', 'library.db');
    try { require('node:fs').accessSync(file); } catch (error) {
      const picked = await dialog.showOpenDialog(ctx.mainWindow, {
        title: ctx.T('选择 literature-mcp 调研库文件（library.db）'),
        properties: ['openFile'],
        filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }]
      });
      if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
      file = picked.filePaths[0];
    }
    const result = await ctx.researchDb.importFromHarness(file, function (progress) {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('research:import-progress', progress);
      }
    });
    ctx.startupLog('research harness import done: ' + JSON.stringify(result));
    // 导入后的存量清扫：历史遗留缺摘要条目（含本次导入）也进自动回填（按引用数优先，≤25/批）
    scheduleAutoBackfill(ctx.researchDb.findWorksNeedingAbstract({ limit: 25 }));
    return result;
  });

  /* Semantic Scholar 相关度检索（R16）：结果按 DOI/s2 标识归位后入库调研库，
   * 与 OpenAlex 互补（S2 的引用数与被引语境常与 OpenAlex 不同；OA PDF 直链来自 openAccessPdf）。 */
  ctx.handle('research:search-semanticscholar', async function (_event, input) {
    if (!ctx.researchDb || !ctx.researchNet) throw new Error(ctx.T('调研库未就绪'));
    const req = input || {};
    const result = await ctx.researchNet.searchSemanticScholar(req);
    const before = ctx.researchDb.getWorks((result.results || []).map(function (row) {
      return row.doi ? ctx.researchDb.findByExtId('doi', row.doi) : null;
    }).filter(Boolean));
    const existedIds = {};
    before.forEach(function (row) { existedIds[row.id] = true; });
    const candidates = ingestCandidates(result.results);
    const works = candidates.filter(Boolean).map(function (c) {
      return {
        id: c.workId, doi: c.doi, title: c.title, year: c.year,
        sourceName: c.sourceName, citedBy: c.citedBy, oaUrl: c.oaUrl,
        hasAbstract: !!c.abstract, existed: !!existedIds[c.workId]
      };
    });
    ctx.researchDb.recordSearch({ q: req.query, filters: { source: 'semanticscholar' }, count: works.length });
    return { count: result.total, stored: works.length, hasMore: result.hasMore, works: works };
  });
  /* 语义检索（库内相似文献，R16 入口一）：向量可用则走向量，否则**降级为关键词**——
   * 用户没配 embedding 时这个按钮不该变成摆设，只是召回质量如实降级并说明。
   * mode: 'auto'（默认）| 'vector' | 'keyword' */
  ctx.handle('research:semantic-search', async function (_event, input) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    const query = String(input && input.query || '').trim();
    if (!query) return { works: [], mode: 'empty', note: '' };
    const limit = Number(input && input.limit) || 20;
    const requested = String(input && input.mode || 'auto');
    const embedTarget = await ctx.embedService.resolveTarget();
    // 查询路径按需补齐（比照上游 literature-mcp 的 library_query + semantic_query）：最多 50 篇/次，
    // 让「刚检索入库、还没轮到空闲构建」的库这次就能走向量。失败标记存在时 topUp 自行跳过（不重试计费）。
    let topUp = null;
    if (embedTarget.ok && requested !== 'keyword' && ctx.researchEmbedder) {
      topUp = await ctx.researchEmbedder.topUp();
    }
    // A-followup #4：可用性按**当前模型 + 配方**的覆盖判定（不是全库向量总数）——
    // 换过嵌入模型时旧向量还在，总数不为零，但 cosineSearch 只认同模型同配方的向量，
    // 进了向量分支也一篇都命不中，用户看到的像「没有相关文献」。
    const coverage = embedTarget.ok
      ? ctx.researchDb.vecCoverage({ model: embedTarget.model, recipe: LitResearch.EMBED_RECIPE })
      : { total: 0, matched: 0 };
    const readiness = LitResearch.vectorReadiness(embedTarget, coverage);
    const vectorPossible = readiness.ready;
    const useVector = requested === 'vector' ? vectorPossible : (requested === 'auto' && vectorPossible);
    if (!useVector) {
      // 关键词降级：LLM 无嵌入服务时的可用路径（不是「功能不可用」）
      const r = ctx.researchDb.queryWorks({ q: query, limit: limit, yearFrom: input && input.yearFrom, yearTo: input && input.yearTo });
      const rows = ctx.researchDb.getWorks((r.works || []).map(function (w) { return w.id; }));
      const topUpFailed = !!(topUp && topUp.skipped === 'failed');
      // 四种原因分别如实说明：显式要关键词 / 没配模型 / 配了但当前模型还没有向量（库里有
      // 别的模型的向量）/ 当前模型构建失败被跳过。含糊其辞会让模型把「索引没建好」
      // 说成「没有相关文献」。
      let note = '';
      if (requested !== 'keyword') {
        note = topUpFailed
          ? ctx.T('向量构建上次失败（待手动重试），本次已按关键词检索')
          : readiness.reason === 'stale-model'
            ? ctx.T('当前向量模型（{model}）还没有可用向量（库内 {n} 条向量属于其它模型），本次已按关键词检索；构建当前模型的向量后即可语义检索', {
              model: String(embedTarget.model || ''), n: coverage.total
            })
            : requested === 'vector'
              ? ctx.T('未配置嵌入模型或向量索引为空，无法按向量检索')
              : ctx.T('未配置嵌入模型或向量索引为空，已按关键词检索；配置后可用语义检索');
      }
      return {
        mode: requested === 'vector' ? 'vector_unavailable' : 'keyword',
        note: note,
        total: r.total,
        works: rows.map(function (w) {
          return {
            id: w.id, doi: w.doi, title: w.title, year: w.year, sourceName: w.sourceName,
            citedBy: w.citedBy, isOa: w.isOa, hasAbstract: !!w.abstract, abstract: w.abstract,
            snippet: w.snippet, score: 0
          };
        })
      };
    }
    const result = await ctx.embedService.embedTexts({ texts: [query] });
    const vec = new Float32Array(result.vectors[0]);
    // R13：检索只命中「同一嵌入模型 + 同一配方」的向量——等维不同模型的向量
    // 不是同一空间，混检会给出虚假的满分命中
    const hits = ctx.researchDb.cosineSearch(Buffer.from(vec.buffer), {
      limit: limit,
      yearFrom: input && input.yearFrom,
      yearTo: input && input.yearTo,
      model: result.model,
      recipe: LitResearch.EMBED_RECIPE
    });
    const works = ctx.researchDb.getWorks(hits.map(function (h) { return h.workId; }));
    const scoreOf = {};
    hits.forEach(function (h) { scoreOf[h.workId] = h.score; });
    return {
      mode: 'vector',
      note: '',
      works: works.map(function (w) {
        return {
          id: w.id, doi: w.doi, title: w.title, year: w.year, sourceName: w.sourceName,
          citedBy: w.citedBy, isOa: w.isOa, hasAbstract: !!w.abstract, abstract: w.abstract,
          snippet: w.snippet, score: scoreOf[w.id] || 0
        };
      })
    };
  });
  /* 摘要回填：OpenAlex 缺摘要 → Crossref → Elsevier abstract；字段级 provenance；429 记账停批 */
  ctx.handle('research:backfill', async function (event, input) {
    if (!ctx.researchDb || !ctx.researchNet) throw new Error(ctx.T('调研库未就绪'));
    const rows = ctx.researchDb.findWorksNeedingAbstract({ limit: Number(input && input.limit) || 100 });
    if (!rows.length) return { updated: 0, done: 0, total: 0, stopped: false, reason: '' };
    const result = await ctx.researchNet.backfillAbstracts(rows, {
      onProgress: function (p) {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('research:backfill-progress', p);
        }
      }
    });
    result.results.forEach(function (row) {
      if (row.abstract) ctx.researchDb.updateWorkText(row.id, { abstract: row.abstract }, row.source);
    });
    return result;
  });
  /* 向量嵌入：估价（确认框）/ 手动或空闲触发构建 / 用量 */
  ctx.handle('research:embed-estimate', function () {
    if (!ctx.researchEmbedder) throw new Error(ctx.T('向量嵌入未就绪'));
    return ctx.researchEmbedder.estimate();
  });
  ctx.handle('research:embed-build', function () {
    if (!ctx.researchEmbedder) throw new Error(ctx.T('向量嵌入未就绪'));
    return ctx.researchEmbedder.runBuild();
  });
  /* 向量模型连通性：沿用设置表单里尚未保存的值（与 AI 助手测试同约定） */
  ctx.handle('embed:test', function (_event, input) {
    if (!ctx.embedService) throw new Error(ctx.T('向量嵌入未就绪'));
    return ctx.embedService.test(input || {});
  });
  ctx.handle('research:embed-usage', function () {
    return ctx.embedService ? ctx.embedService.getUsage() : { requests: 0, tokens: 0 };
  });
  /* PDF 两步（用户确认后由 agent 工具触发）：
   * 第一步：OpenAlex oaUrl → 下载进当前会话附件目录并登记附件↔身份映射；
   * 第二步：会话附件复制进受管目录（storeFileInto），返回存储路径供渲染层建条目挂附件。 */
  ctx.handle('research:download-pdfs', async function (_event, input) {
    if (!ctx.researchDb || !ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    const sessionId = String(input && input.sessionId || '');
    const workIds = (Array.isArray(input && input.workIds) ? input.workIds : []).map(String).slice(0, 20);
    if (!sessionId || !workIds.length) throw new Error(ctx.T('无效的下载请求'));
    const works = ctx.researchDb.getWorks(workIds);
    // 4 路并发下载（各自独立出版商域名，无共享限流）；落盘写经单一链串行化，
    // 规避 sanitize 后同名的两个标题在 saveAttachment 的存在性检查上竞态
    const out = new Array(works.length);
    let cursor = 0;
    let saveChain = Promise.resolve();
    const runDownload = async function () {
      while (cursor < works.length) {
        const i = cursor++;
        const work = works[i];
        if (!work.oaUrl) { out[i] = { workId: work.id, file: '', error: ctx.T('无开放获取链接') }; continue; }
        try {
          const response = await safePublicFetch(work.oaUrl, {
            headers: { Accept: 'application/pdf,*/*' }, maxBytes: 80 * 1024 * 1024
          });
          if (!response.ok) { out[i] = { workId: work.id, file: '', error: ctx.T('下载失败（HTTP ') + response.status + '）' }; continue; }
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 1000 || bytes[0] !== 0x25) { out[i] = { workId: work.id, file: '', error: ctx.T('返回内容不是 PDF') }; continue; }
          const name = LitResearch.sanitizeFileStem(work.title || work.id, 60) + '.pdf';
          const saved = await (saveChain = saveChain.then(function () {
            return ctx.agentSessions.saveAttachment(sessionId, {
              name: name, label: work.title || work.id, dataBase64: bytes.toString('base64')
            });
          }));
          out[i] = { workId: work.id, file: saved.file, title: work.title };
        } catch (error) {
          out[i] = { workId: work.id, file: '', error: String(error && error.message || error) };
        }
      }
    };
    await Promise.all([runDownload(), runDownload(), runDownload(), runDownload()]);
    return { results: out };
  });
  ctx.handle('research:stage-pdfs', async function (_event, input) {
    if (!ctx.researchDb || !ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    const sessionId = String(input && input.sessionId || '');
    const files = (Array.isArray(input && input.files) ? input.files : []).slice(0, 20);
    if (!sessionId || !files.length) throw new Error(ctx.T('无效的暂存请求'));
    const attachmentsDir = path.join(ctx.dataPathState.configDir, 'attachments');
    // 独立本地复制（storeFileInto 随机 z 键命名，无碰撞）：4 路并发，结果按输入序落位
    const out = new Array(files.length);
    let stageCursor = 0;
    const runStage = async function () {
      while (stageCursor < files.length) {
        const i = stageCursor++;
        const item = files[i];
        try {
          // R06：attachmentPath 是 async（读索引解析目录），必须 await——
          // 旧代码把 Promise 直接传给 storeFileInto，报「paths[0] must be string」
          const abs = await ctx.agentSessions.attachmentPath(sessionId, String(item.file || ''));
          const stored = await storeFileInto(attachmentsDir, abs, '.pdf');
          out[i] = { workId: String(item.workId || ''), fileName: stored.name, path: stored.path };
        } catch (error) {
          out[i] = { workId: String(item.workId || ''), fileName: '', path: '', error: String(error && error.message || error) };
        }
      }
    };
    await Promise.all([runStage(), runStage(), runStage(), runStage()]);
    return { results: out };
  });
  /* R19 临时全文链（对照 literature-mcp 的 fetch_fulltext，按用户决定走「仅文本参考」路线）：
   * agent 要方法学/实验细节时，下载 OA PDF 到临时目录 → 渲染层抽取文本 → 文本入调研库
   * （works_fulltext 侧表 + FTS，可检索可续读）→ 临时 PDF 立即删除。
   * 与 download_pdfs（保留 PDF 本体、写类确认门）互补：仅参考不留文件、不经确认门。 */
  const FULLTEXT_TMP = 'tmp-fulltext';
  ctx.handle('research:fulltext-read', async function (_event, input) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    const workId = String((input && input.workId) || '');
    if (!workId) throw new Error(ctx.T('缺少 workId'));
    // 已有全文（上次拉取的缓存）：直接给窗口，不再联网
    const cached = ctx.researchDb.getFulltextWindow(workId, input && input.fromChar, input && input.length);
    if (cached) return { cached: true, window: cached };
    const rows = ctx.researchDb.getWorks([workId]);
    const work = rows && rows[0];
    if (!work) throw new Error(ctx.T('未找到该调研文献：') + workId);
    if (!work.oaUrl) {
      return { cached: false, error: '该文献没有开放获取链接（oaUrl 为空），无法拉取全文；请改用摘要证据或让用户以其他途径获取原文' };
    }
    const response = await safePublicFetch(work.oaUrl, {
      headers: { Accept: 'application/pdf,*/*' }, maxBytes: 80 * 1024 * 1024
    });
    if (!response.ok) return { cached: false, error: '全文下载失败（HTTP ' + response.status + '）' };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 80 * 1024 * 1024) return { cached: false, error: 'PDF 过大（>80MB），已跳过' };
    if (bytes.length < 1000 || bytes[0] !== 0x25) return { cached: false, error: '返回内容不是 PDF（OA 链接可能指向落地页）' };
    const dir = path.join(ctx.dataPathState.configDir, FULLTEXT_TMP);
    await fs.mkdir(dir, { recursive: true });
    const safeId = workId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    const tempPath = path.join(dir, safeId + '-' + Date.now() + '-' + require('node:crypto').randomBytes(4).toString('hex') + '.pdf');
    await fs.writeFile(tempPath, bytes);
    return { cached: false, tempPath: tempPath, workId: workId, title: work.title || '' };
  });
  ctx.handle('research:fulltext-store', async function (_event, input) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    const workId = String((input && input.workId) || '');
    const text = String((input && input.text) || '');
    const tempPath = String((input && input.tempPath) || '');
    // 只删自己临时目录里的文件：tempPath 不接受任意路径（防把删除原语暴露给渲染层）
    const dir = path.join(ctx.dataPathState.configDir, FULLTEXT_TMP);
    const insideTmp = tempPath && path.dirname(tempPath) === dir;
    try {
      if (insideTmp) await fs.rm(tempPath, { force: true });
    } catch (error) { /* 删除失败不阻断：启动清扫兜底 */ }
    if (!workId || !text.trim()) return { stored: 0 };
    const stored = ctx.researchDb.upsertFulltext(workId, text);
    // 存完即回首个窗口，工具侧一次往返拿到正文
    return { stored: stored, window: stored ? ctx.researchDb.getFulltextWindow(workId, 0, input && input.length) : null };
  });
  /* ===== M9-4 科研网页检索（TinyFish；默认关 + 出境告知，双端把关） ===== */
  /* 检索：结果规范化后入库调研库——DOI 直查 → 规范化标题匹配 → local: 本地身份 + URL ext_id。
   * R15 元数据保真：pageUrl（网页地址）/ pdfUrl（PDF 直链）/ venue / snippet 各归各位，
   * type 按证据推断（不再一律 web），并如实回报「调研库已有」与「正式库已收藏」。 */
  ctx.handle('research:web-search', async function (_event, input) {
    if (!ctx.researchDb || !ctx.webFetchNet) throw new Error(ctx.T('调研库未就绪'));
    if (!(await webSearchGateOk())) throw new Error(ctx.T('科研网页检索未开启（含出境告知确认）'));
    const normalized = await ctx.webFetchNet.webSearch(input || {});
    if (!normalized.shapeOk) throw new Error(ctx.T('网页检索响应形状异常，已放弃入库'));
    const inLibrary = await inLibraryIndex();
    const out = [];
    let matched = 0;
    for (const r of normalized.results) {
      let workId = r.doi ? ctx.researchDb.findByExtId('doi', r.doi) : null;
      let isNew = false;
      // A-followup #5：稳定标识（DOI → 已登记 URL）优先于标题匹配——同一个页面重复检索
      // 时不该再建一个新的 local: 身份
      if (!workId && r.url) workId = ctx.researchDb.findByExtId('url', r.url);
      if (!workId) workId = ctx.researchDb.findIdByNormalizedTitle(r.title);
      const exts = [{ kind: 'url', value: r.url }].concat(r.doi ? [{ kind: 'doi', value: r.doi }] : []);
      if (workId) {
        ctx.researchDb.addExtIds(workId, exts);
        matched++;
        // 已存在的身份也要补这次才拿到的元数据（PDF 直链 / venue / snippet）
        ctx.researchDb.upsertWorks([Object.assign(LitWebFetch.workFromSearchResult(r), { id: workId })]);
      } else {
        workId = 'local:' + require('node:crypto').randomBytes(8).toString('hex');
        const draft = LitWebFetch.workFromSearchResult(r);
        draft.id = workId;
        ctx.researchDb.upsertWorks([draft]);
        ctx.researchDb.addExtIds(workId, exts);
        isNew = true;
      }
      out.push({
        workId: workId, isNew: isNew, title: r.title, url: r.url, pdfUrl: r.pdfUrl || '',
        siteName: r.siteName, venue: r.venue || '', entryType: r.entryType || 'web',
        year: r.year, snippet: r.snippet.slice(0, 300), citations: r.citations, doi: r.doi,
        inResearch: !isNew,
        inLibrary: inLibrary.has(workId) || !!(r.doi && inLibrary.has('doi:' + r.doi))
      });
    }
    ctx.researchDb.recordSearch({ q: input && input.query, filters: { source: 'web', mode: normalized.mode || 'paper' }, count: out.length });
    return {
      total: normalized.total, works: out, mode: normalized.mode || 'paper',
      matched: matched, created: out.filter(function (w) { return w.isNew; }).length
    };
  });
  /* 抓取：仅学术域；markdown → 已收藏条目落 snapshot 目录附件并入 pdf_fts（消掉「快照不可全文检索」），
   * 未收藏条目落当前会话附件目录；final_url 越域在解析层已丢弃。 */
  ctx.handle('research:fetch-page', async function (_event, input) {
    if (!ctx.webFetchNet) throw new Error(ctx.T('调研库未就绪'));
    if (!(await webSearchGateOk())) throw new Error(ctx.T('科研网页检索未开启（含出境告知确认）'));
    const url = String(input && input.url || '');
    const offset = Math.max(0, Number(input && input.offset) || 0);
    // R12：续读（offset>0）优先走缓存——长正文分块读完不再重复抓取
    let markdown = '';
    let parsed = null;
    if (offset > 0 && fetchedPageCache.has(url)) {
      parsed = fetchedPageCache.get(url);
      markdown = parsed.markdown;
    } else {
      parsed = await ctx.webFetchNet.fetchPage({ url: url });
      if (!parsed.ok) {
        return { ok: false, partial: !!parsed.partial, error: parsed.error };
      }
      markdown = parsed.markdown;
      cacheFetchPage(url, { ok: true, markdown: markdown, title: parsed.title, finalUrl: parsed.finalUrl });
    }
    const result = {
      ok: true,
      title: parsed.title,
      finalUrl: parsed.finalUrl,
      markdownExcerpt: markdown.slice(offset, offset + FETCH_PAGE_EXCERPT),
      offset: offset,
      totalLength: markdown.length,
      nextOffset: offset + FETCH_PAGE_EXCERPT < markdown.length ? offset + FETCH_PAGE_EXCERPT : null
    };
    const paperId = String(input && input.paperId || '');
    const sessionId = String(input && input.sessionId || '');
    // 续读（offset>0）只取正文片段：快照附件在首次抓取（offset=0）时创建，不重复挂载
    if (paperId && offset === 0) {
      const state = await ctx.libraryDb.loadState();
      const paper = (state.papers || []).filter(function (p) { return p.id === paperId && !p.deletedAt; })[0];
      if (!paper) return { ok: false, error: ctx.T('未找到该正式库文献：') + paperId };
      const crypto = require('node:crypto');
      const attId = 'att' + crypto.randomBytes(10).toString('hex');
      const dir = path.join(itemAttachmentDir(ctx.dataPathState.configDir, paperId), attId + '.snapshot');
      await fs.mkdir(dir, { recursive: true });
      const titleText = String(parsed.title || '网页快照').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
      const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + titleText + '</title>' +
        '<style>body{max-width:860px;margin:24px auto;padding:0 16px;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;}' +
        'img{max-width:100%}pre{overflow-x:auto;background:#f6f7f9;padding:10px;border-radius:6px;}</style></head><body>' +
        LitMarkdown.render(markdown) + '</body></html>';
      await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8');
      await fs.writeFile(path.join(dir, 'page.md'), markdown, 'utf8');
      const fingerprint = crypto.createHash('sha256').update(markdown, 'utf8').digest('hex');
      // R07：必须 await 索引写入完成——渲染层挂载附件后不再清索引，这里的写入就是最终态
      await ctx.libraryDb.pdfTextPut({
        paperId: paperId, attachmentId: attId, fingerprint: fingerprint,
        method: 'snapshot', pages: [markdown]
      });
      result.attachment = {
        id: attId, kind: 'snapshot',
        fileName: (parsed.title || '网页快照').slice(0, 80),
        path: dir, fingerprint: fingerprint
      };
    } else if (sessionId && offset === 0) {
      const saved = await ctx.agentSessions.saveAttachment(sessionId, {
        name: (parsed.title || '网页正文').slice(0, 60) + '.md',
        label: parsed.title || String(input && input.url || ''),
        dataBase64: Buffer.from(markdown, 'utf8').toString('base64')
      });
      result.file = saved && saved.file || '';
    }
    return result;
  });
  /* ===== R16 段落找文献（大模型 tool 的服务端实现） =====
   * 契约：给定一段话（或模型拆好的论点），多路召回 → 合并去重 → 逐论点做摘要级证据归因。
   * 三条纪律：
   * - **主题相近 ≠ 支撑论点**：没有命中论点的证据句就诚实地报 not_found（纯函数层保证）；
   * - **召回范围如实回报**：远端召回有预算（默认前 4 条论点），被跳过的论点明确列出，
   *   不允许把「只查了前几条」说成「整段都查过了」；
   * - **每条线路独立成败**：某一路（S2 限流 / 网络 / 未配置）失败不影响其余，失败原因逐路回报。 */
  ctx.handle('research:find-literature', async function (_event, input) {
    if (!ctx.researchDb || !ctx.researchNet) throw new Error(ctx.T('调研库未就绪'));
    const req = input || {};
    const text = String(req.text || '').trim();
    const provided = Array.isArray(req.claims)
      ? req.claims.map(function (c) { return String(c == null ? '' : c).trim(); }).filter(Boolean)
      : [];
    if (!text && !provided.length) throw new Error(ctx.T('没有可检索的内容'));
    const providedEn = Array.isArray(req.claimsEn)
      ? req.claimsEn.map(function (c) { return String(c == null ? '' : c).trim(); })
      : [];
    const primary = (provided.length
      ? provided
      : LitLitSearch.splitClaims(text).map(function (c) { return c.text; })
    ).slice(0, FIND_MAX_CLAIMS);
    if (!primary.length) throw new Error(ctx.T('没有可检索的论点'));
    // 跨语言：模型可给同一批论点的英文版（一一对应）。召回与证据判定都用两版，
    // 否则中文论点在英文摘要上必然落空（词面匹配的硬边界）。
    const claims = primary.map(function (cn, index) {
      const en = providedEn[index];
      const variants = en && en !== cn ? [cn, en] : [cn];
      return { text: cn, variants: variants };
    });
    // 预算：远端召回只覆盖前 N 条论点（OpenAlex 语义 1 req/s，条数一多会拖很久）
    const budget = Math.max(1, Math.min(FIND_MAX_CLAIMS, Number(req.remoteClaimBudget) || FIND_REMOTE_CLAIM_BUDGET));
    const webOk = await webSearchGateOk();
    // 召回源：OpenAlex（关键词 + 语义）与 Semantic Scholar 常开——语义检索只作为 agent 工具
    // 存在，没有用户侧供应商开关；学术网页仍受开关 + 出境告知双重门控
    const providers = {
      openalexKeyword: true,
      openalexSemantic: true,
      semanticscholar: true,
      web: webOk
    };
    const findEmbedTarget = await ctx.embedService.resolveTarget();
    // A-followup #4：本地向量召回的就绪判定同样按当前模型 + 配方的覆盖（见 vecCoverage）
    const findCoverage = findEmbedTarget.ok
      ? ctx.researchDb.vecCoverage({ model: findEmbedTarget.model, recipe: LitResearch.EMBED_RECIPE })
      : { total: 0, matched: 0 };
    const findReadiness = LitResearch.vectorReadiness(findEmbedTarget, findCoverage);
    const vectorReady = findReadiness.ready;

    const perClaim = [];
    for (let i = 0; i < claims.length; i++) {
      perClaim.push(await recallForClaim(claims[i], {
        providers: providers, vectorReady: vectorReady, remote: i < budget,
        yearFrom: Number(req.yearFrom) || null, yearTo: Number(req.yearTo) || null
      }));
    }
    // 跨论点统一合并（同一条被多条论点召回只留一行），证据归因在纯函数层完成；
    // S2 收口：即使某条路线漏了年份（上游忽略参数），最终候选再按年份统一过滤一次
    const findYearFrom = Number(req.yearFrom) || null;
    const findYearTo = Number(req.yearTo) || null;
    let yearDropped = 0;
    let yearUnknown = 0;
    const yearOk = (w) => {
      const y = Number(w && w.year);
      if (w && w.year != null && Number.isFinite(y) && y > 1000) {
        if (findYearFrom != null && y < findYearFrom) return false;
        if (findYearTo != null && y > findYearTo) return false;
        return true;
      }
      yearUnknown++;
      return true;
    };
    const mergedAll = LitLitSearch.mergeCandidates([{
      provider: 'all',
      works: perClaim.reduce(function (acc, item) { return acc.concat(item.candidates); }, [])
    }]);
    const hasYearFilter = (findYearFrom != null && findYearFrom > 1000) || (findYearTo != null && findYearTo > 1000);
    const merged = hasYearFilter
      ? mergedAll.filter(function (w) { const ok = yearOk(w); if (!ok) yearDropped++; return ok; })
      : mergedAll;
    const findings = LitLitSearch.buildFindings(claims, merged, {
      perClaim: Math.max(1, Math.min(10, Number(req.perClaim) || FIND_PER_CLAIM))
    });
    const inLibrary = await inLibraryIndex();
    const routeFailures = [];
    findings.forEach(function (finding, index) {
      const routes = perClaim[index] ? perClaim[index].routes : [];
      finding.routes = routes;
      finding.candidates.forEach(function (c) {
        c.inLibrary = inLibrary.has(c.workId) || !!(c.doi && inLibrary.has('doi:' + c.doi));
        c.inResearch = true;
      });
      routes.forEach(function (route) {
        if (!route.ok && routeFailures.length < 6) {
          routeFailures.push({ claim: finding.claim.slice(0, 60), route: route.id, error: route.error });
        }
      });
    });
    ctx.researchDb.recordSearch({
      q: text.slice(0, 500),
      filters: { source: 'find-literature', claims: claims.length },
      count: merged.length
    });
    const notes = [];
    if (!vectorReady) {
      // 如实区分「没配/索引为空」与「索引属于别的模型」——后者不是没配，是当前向量空间未建
      notes.push(findReadiness.reason === 'stale-model'
        ? ctx.T('本地向量索引不属于当前嵌入模型（库内 {n} 条向量来自其它模型）：本地召回走关键词。重建当前模型的向量可提升同义改写召回。', { n: findCoverage.total })
        : ctx.T('本地向量检索未启用或索引为空：本地召回走关键词。配置嵌入模型并构建索引可提升同义改写召回。'));
    }
    if (!webOk) notes.push(ctx.T('科研网页检索未开启，未参与召回。'));
    if (claims.length > budget) {
      notes.push(ctx.T('远端召回只覆盖前 ') + budget + ctx.T(' 条论点（其余仅查本地库）；需要更多时把 text 拆小分次调用。'));
    }
    // S2：年份约束如实回报——剔了多少、多少未知年份未过滤
    if (hasYearFilter) {
      let yearNote = ctx.T('年份约束 ') + (findYearFrom || '') + '–' + (findYearTo || '') + ctx.T(' 已应用于全部召回路线与最终候选（越界已剔除 ') + yearDropped + ctx.T(' 条）');
      if (yearUnknown > 0) yearNote += '；' + yearUnknown + ctx.T(' 条候选年份未知，保留未过滤');
      notes.push(yearNote + '。');
    }
    return {
      claims: findings,
      providerStats: {
        localVector: vectorReady,
        openalex: providers.openalexKeyword,
        semanticscholar: providers.semanticscholar,
        web: webOk
      },
      remoteClaimsCovered: Math.min(budget, claims.length),
      remoteClaimsSkipped: Math.max(0, claims.length - budget),
      candidateTotal: merged.length,
      routeFailures: routeFailures,
      notes: notes
    };
  });
  ctx.handle('research:graph', async function (_event, input) {
    if (!ctx.researchDb || !ctx.researchNet) throw new Error(ctx.T('调研库未就绪'));
    const seeds = (Array.isArray(input && input.workIds) ? input.workIds : []).map(String).filter(Boolean).slice(0, 500);
    if (!seeds.length) throw new Error(ctx.T('没有可作为种子的调研身份'));
    // Rust 图谱内核可用时：社区划分/PageRank/布局在 libuv 线程池算（napi 异步任务，
    // 不堵主进程消息泵），布局随图数据下发、渲染层 viewerData 直接用预置坐标；
    // 不可用回退 graphgen 纯 JS 路径（渲染层现算布局，结果同为确定性、只是较慢）
    const native = litgraph.load();
    let nativeLayout = null;
    const deps = {
      getWorks: async function (ids) { return ctx.researchDb.getWorks(ids); },
      fetchMissing: async function (ids) {
        const rows = await ctx.researchNet.fetchWorksByIds(ids);
        ctx.researchDb.upsertWorks(rows);
        return rows;
      }
    };
    if (native) {
      deps.computeMetrics = async function (ids, edges) {
        const metrics = await native.computeGraphMetrics(ids, edges, null);
        const communities = new Map();
        const ranks = new Map();
        ids.forEach(function (id, index) {
          communities.set(id, metrics.communities[index]);
          ranks.set(id, metrics.pagerank[index]);
        });
        nativeLayout = metrics.layout.map(function (p) { return [p.id, [p.x, p.y]]; });
        return { communities: communities, ranks: ranks };
      };
    }
    const graph = await LitGraphGen.buildGraphData(seeds, {
      depth: input && input.depth,
      maxNodes: input && input.maxNodes
    }, deps);
    if (nativeLayout) graph.layout = nativeLayout;
    return graph;
  });
  /* 补登记：正式库条目 ↔ 调研库身份。主进程只产提案（DOI 直查 + 无 DOI 建本地身份）；
   * 写回 paper.researchIds 由渲染层完成（save 管线与同步语义归渲染层所有）。
   * 一次跑全量（limit 缺省/0 = 不设限），分片处理：片间让出主进程消息泵（主进程即
   * 窗口的消息泵，长循环必须呼吸），逐片推 research:register-progress；
   * research:register-cancel 置停止位，当前片收尾后带着已完成部分返回。 */
  ctx.handle('research:register', async function (event, input) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    const rawLimit = Math.floor(Number(input && input.limit) || 0);
    const limit = rawLimit > 0 ? Math.min(50000, rawLimit) : 0;
    const state = await ctx.libraryDb.loadState();
    let candidates = (state.papers || []).filter(function (p) {
      return p && !p.deletedAt && !(Array.isArray(p.researchIds) && p.researchIds.length);
    });
    if (limit) candidates = candidates.slice(0, limit);
    const total = candidates.length;
    const sendProgress = function (p) {
      try {
        if (event.sender && typeof event.sender.send === 'function' &&
            !(typeof event.sender.isDestroyed === 'function' && event.sender.isDestroyed())) {
          event.sender.send('research:register-progress', p);
        }
      } catch (_error) { /* 进度推送失败不影响补登记本体 */ }
    };
    const proposals = [];
    let unresolved = 0;
    let scanned = 0;
    let stopped = false;
    const run = { canceled: false };
    activeRegisterRun = run;
    try {
      const CHUNK = 200;
      for (let start = 0; start < total; start += CHUNK) {
        if (run.canceled) { stopped = true; break; }
        const slice = candidates.slice(start, start + CHUNK);
        // 第一遍：本地 ext_ids 直查 DOI；查不到的收集起来批量向 OpenAlex 反查——
        // 「DOI 直查」必须真的解析：从未检索过的带 DOI 条目此前在这里被整个跳过，
        // 永远拿不到调研身份，右键构建引文网络就永远停在「还没有调研身份」
        const missedDois = new Set();
        for (const paper of slice) {
          const doi = paper.doi ? LitResearch.normalizeDoi(paper.doi) : '';
          if (doi && !ctx.researchDb.findByExtId('doi', doi)) missedDois.add(doi);
        }
        if (missedDois.size && ctx.researchNet && typeof ctx.researchNet.fetchWorksByDois === 'function') {
          try {
            const fetched = await ctx.researchNet.fetchWorksByDois(Array.from(missedDois));
            if (fetched.length) ctx.researchDb.upsertWorks(fetched);
          } catch (error) {
            // 在线反查失败（离线/限流）不阻断——标题认领与本地身份兜底照常，未解析数如实上报
          }
        }
        for (const paper of slice) {
          const doi = paper.doi ? LitResearch.normalizeDoi(paper.doi) : '';
          let researchId = doi ? ctx.researchDb.findByExtId('doi', doi) : null;
          let createdLocal = false;
          if (!researchId && paper.title) {
            // A-followup #5：先按规范化标题认领**既有**身份（检索早已入库的同一篇论文），
            // 认不到才考虑分配本地身份——否则补登记会为同一篇论文造出第二个 local: 身份。
            // 带 DOI 的条目同样先试这条：认领既有身份零分裂风险
            researchId = ctx.researchDb.findIdByNormalizedTitle(paper.title);
          }
          if (!researchId && !doi && paper.title) {
            // 无 DOI：分配本地身份（代理键永不变更；日后匹配合并走 merge_log 重定向）。
            // 带 DOI 的条目不建 local:——doi→local: 进了 ext_ids 会挡住日后的真实身份解析
            researchId = 'local:' + require('node:crypto').randomBytes(8).toString('hex');
            ctx.researchDb.upsertWorks([{ id: researchId, title: paper.title, year: paper.year || null, doi: '' }]);
            createdLocal = true;
          }
          if (researchId) {
            proposals.push({ paperId: paper.id, researchId: researchId, title: paper.title || '', createdLocal: createdLocal });
          } else {
            unresolved += 1;
          }
        }
        scanned += slice.length;
        sendProgress({ done: scanned, total: total, proposed: proposals.length, unresolved: unresolved });
        if (start + CHUNK < total) await new Promise(function (resolve) { setImmediate(resolve); });
      }
    } finally {
      if (activeRegisterRun === run) activeRegisterRun = null;
    }
    return { proposals: proposals, scanned: scanned, unresolved: unresolved, stopped: stopped };
  });
  ctx.handle('research:register-cancel', function () {
    if (activeRegisterRun) activeRegisterRun.canceled = true;
    return { ok: true };
  });
  /* R18 文献检索能力补齐（对照 literature-mcp）：精确取文献（DOI / OpenAlex ID / 标题精确）、
   * 实体名 → OpenAlex ID 联想、库内引文邻接。三个都是「检索即入库」幂等语义，不动正式库。 */
  ctx.handle('research:get-work', async function (_event, input) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    const raw = String((input && input.query) || '').trim();
    if (!raw) throw new Error(ctx.T('缺少检索词'));
    const doiMatch = raw.match(/(10\.\d{4,9}\/[^\s"'<>]+)/i);
    const doi = doiMatch ? LitResearch.normalizeDoi(doiMatch[1]) : '';
    const idMatch = raw.match(/(W\d{4,})/i);
    const workId = idMatch ? 'W' + idMatch[1].slice(1) : '';
    let row = null;
    let origin = 'local';
    if (doi) row = ctx.researchDb.getWorks([ctx.researchDb.findByExtId('doi', doi)].filter(Boolean))[0] || null;
    if (!row && workId) row = ctx.researchDb.getWorks([workId])[0] || null;
    if (!row && (doi || workId) && ctx.researchNet) {
      const fetched = workId ? await ctx.researchNet.fetchWorksByIds([workId]) : await ctx.researchNet.fetchWorksByDois([doi]);
      if (fetched.length) {
        ctx.researchDb.upsertWorks(fetched);
        row = ctx.researchDb.getWorks([fetched[0].id])[0] || null;
        origin = 'openalex';
      }
    }
    if (!row) {
      const byTitle = ctx.researchDb.findIdByNormalizedTitle(raw);
      if (byTitle) row = ctx.researchDb.getWorks([byTitle])[0] || null;
    }
    if (!row) return { found: false, note: '本地与 OpenAlex 均未精确命中；模糊/主题检索请改用 search_openalex 或 search_research' };
    return {
      found: true,
      origin: origin,
      work: {
        id: row.id, doi: row.doi || '', title: row.title || '', year: row.year || null,
        sourceName: row.sourceName || '', citedBy: row.citedBy || 0, isOa: row.isOa === true,
        oaUrl: row.oaUrl || '', hasAbstract: !!row.abstract,
        abstract: String(row.abstract || '').slice(0, 1500)
      }
    };
  });
  ctx.handle('research:autocomplete', async function (_event, input) {
    if (!ctx.researchNet) throw new Error(ctx.T('调研库未就绪'));
    return ctx.researchNet.autocomplete(input && input.entity, input && input.query);
  });
  ctx.handle('research:graph-neighbors', function (_event, input) {
    if (!ctx.researchDb) throw new Error(ctx.T('调研库未就绪'));
    const seeds = Array.from(new Set((Array.isArray(input && input.workIds) ? input.workIds : [])
      .map(String).filter(Boolean))).slice(0, 20);
    if (!seeds.length) throw new Error(ctx.T('缺少 workIds'));
    const direction = ['in', 'out', 'both'].indexOf(String((input && input.direction) || 'both')) >= 0
      ? String((input && input.direction) || 'both') : 'both';
    const snapshot = ctx.researchDb.getRefsSnapshot();
    const refsById = new Map();
    const citingOf = new Map(); // 被引方 → 引用它的库内文献
    snapshot.forEach(function (entry) {
      refsById.set(entry.id, entry.refs);
      entry.refs.forEach(function (ref) {
        if (!citingOf.has(ref)) citingOf.set(ref, []);
        citingOf.get(ref).push(entry.id);
      });
    });
    const pick = function (ids, cap) {
      const inLibrary = Array.from(new Set(ids)).filter(function (id) { return refsById.has(id); });
      const external = ids.length - inLibrary.length;
      const rows = ctx.researchDb.getWorks(inLibrary.slice(0, 200));
      rows.sort(function (a, b) { return (b.citedBy || 0) - (a.citedBy || 0); });
      return {
        works: rows.slice(0, cap).map(function (w) {
          return { workId: w.id, title: w.title || '', year: w.year || null, citedBy: w.citedBy || 0 };
        }),
        externalNotInLibrary: external
      };
    };
    const out = direction !== 'in'
      ? pick(seeds.reduce(function (acc, id) { return acc.concat(refsById.get(id) || []); }, []), 30)
      : null;
    const inn = direction !== 'out'
      ? pick(seeds.reduce(function (acc, id) { return acc.concat(citingOf.get(id) || []); }, []), 30)
      : null;
    return { seeds: seeds, direction: direction, out: out, in: inn };
  });
}
