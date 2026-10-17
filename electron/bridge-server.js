'use strict';

/**
 * LitBoard 浏览器扩展桥接服务（主进程）。
 * 监听 127.0.0.1 的本地 HTTP 端口，接收浏览器扩展的「一键保存」请求：
 *   GET  /ping           存活探测（无需令牌）
 *   POST /save           保存文献 { doi?, title?, url?, pdfUrl?, authors?, year?, venue? }
 *                        —— 同步段只做本地查重 + 入库，立即响应；联网元数据补全与
 *                           PDF 下载转后台任务，完成后经 onSaved 事件通知渲染层刷新。
 *                        响应字段 { ok, id, title, duplicated, pdfAttached } 为超集扩展：
 *                           enrichPending: boolean（新增，旧扩展忽略）——还有后台任务在跑
 *                           pdfAttached ——如实反映「条目当前是否已带 PDF」：新保存且
 *                                           下载转后台时为 false（后台完成后经 onSaved 可见），
 *                                           重复命中且已有 PDF 时为 true
 *   POST /attach-pdf     浏览器下载好的 PDF 落盘挂附件。两种形态：
 *                        a) Content-Type: application/pdf —— 原始字节直传（新扩展优先走这条，
 *                           避免 64MB base64 JSON）；paperId/fileName 走查询参数
 *                           （?paperId=…&fileName=…），上限 64MB
 *                        b) Content-Type: application/json —— { paperId, pdfBase64, fileName }
 *                           （旧扩展兼容路径，行为不变）
 * 令牌鉴权（X-LitBoard-Token），首次启动随机生成并持久化在 SQLite settings 中。
 * 协议兼容约束：应用与扩展独立更新，响应形状只增不改——删字段/改语义都会打断
 * 「旧扩展 ↔ 新服务」或「新扩展 ↔ 旧服务」组合。
 */
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const { downloadPdfToFile, availablePdfPath } = require('./pdfdownload.js');
const { createSafePublicHttpsFetch } = require('./safe-fetch.js');

const DEFAULT_PORT = 24117;
const MAX_PORT_ATTEMPTS = 8;

function createBridgeServer(options) {
  const libraryDb = options.libraryDb;
  const netFetch = options.fetch;
  const safeFetch = createSafePublicHttpsFetch();
  // 页面及元数据提供的 PDF 地址不可信，使用独立的公共 HTTPS 下载出口。
  const pdfFetch = options.pdfFetch || async function (url, init) {
    const response = await safeFetch(url, init);
    if (!response.ok || /text\/html/i.test(String(response.headers.get('content-type') || ''))) {
      if (response.discard) response.discard();
      return response;
    }
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/pdf' }
    });
  };
  // PDF 落盘目录：主进程按条目 ID 返回独立受管目录；旧调用方的静态 downloadsDir 仍兼容。
  const resolveDownloadDir = typeof options.resolveDownloadDir === 'function'
    ? options.resolveDownloadDir
    : async function () { return options.downloadsDir; };
  const onSaved = options.onSaved || function () {};
  let server = null;
  let actualPort = null;
  let operationQueue = Promise.resolve();
  let currentFolderId = '';

  async function getToken() {
    let token = await libraryDb.getSetting('bridgeToken');
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
      await libraryDb.setSetting('bridgeToken', token);
    }
    return token;
  }

  function send(res, status, payload) {
    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-LitBoard-Token',
      'Vary': 'Origin'
    };
    // M2 Origin 策略：不再回 *。仅对浏览器扩展来源反射 Origin，网页跨站调用拿不到 CORS 许可。
    // 鉴权始终以 X-LitBoard-Token 为准（不因来源放宽），这里只是收窄浏览器侧的可读性。
    const origin = res._req && res._req.headers && res._req.headers.origin;
    if (typeof origin === 'string' && /^chrome-extension:\/\/[a-z0-9-]{8,64}$/i.test(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    }
    res.writeHead(status, headers);
    res.end(body);
  }

  function readBody(req, maxBytes) {
    const limit = maxBytes || 1024 * 1024;
    return new Promise(function (resolve, reject) {
      const chunks = [];
      let size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
      req.on('error', reject);
    });
  }

  /** /attach-pdf 原始字节直传用：与 readBody 同限流，但保留 Buffer 不转字符串 */
  function readBodyRaw(req, maxBytes) {
    const limit = maxBytes || 1024 * 1024;
    return new Promise(function (resolve, reject) {
      const chunks = [];
      let size = 0;
      req.on('data', function (chunk) {
        size += chunk.length;
        if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', function () { resolve(Buffer.concat(chunks)); });
      req.on('error', reject);
    });
  }

  // ---------- 后台补全任务（保存响应已提前返回，这里静默完成联网富化与 PDF 下载） ----------
  // 小并发（2）：批量保存时既不让 20 个 OpenAlex/PDF 请求同时打到网上，也不会串行到分钟级。
  const BACKGROUND_CONCURRENCY = 2;
  const backgroundQueue = [];
  let backgroundActive = 0;
  let backgroundIdleWaiters = [];

  function pumpBackground() {
    while (backgroundActive < BACKGROUND_CONCURRENCY && backgroundQueue.length) {
      const task = backgroundQueue.shift();
      backgroundActive++;
      Promise.resolve().then(task).catch(function () { /* 后台任务失败只影响本次补全，不打断服务 */ })
        .then(function () {
          backgroundActive--;
          pumpBackground();
          if (backgroundActive === 0 && backgroundQueue.length === 0) {
            const waiters = backgroundIdleWaiters;
            backgroundIdleWaiters = [];
            waiters.forEach(function (resolve) { resolve(); });
          }
        });
    }
  }

  function scheduleBackground(task) {
    backgroundQueue.push(task);
    pumpBackground();
  }

  /** 测试钩子：等所有后台补全任务落定（生产路径不用） */
  function whenIdle() {
    if (backgroundActive === 0 && backgroundQueue.length === 0) return Promise.resolve();
    return new Promise(function (resolve) { backgroundIdleWaiters.push(resolve); });
  }

  // 本次会话内已联网补全成功的 DOI（跳过重复富化；失败不记，网络恢复后的下次保存仍会重试）。
  // 会话级缓存不落库：重启后对无 abstract 的条目会再补一次，属可接受的保守行为。
  const enrichedDois = new Map();
  const ENRICHED_DOI_CAP = 2000;

  function markEnriched(doi) {
    const key = String(doi || '').toLowerCase();
    if (!key) return;
    if (enrichedDois.has(key)) enrichedDois.delete(key);
    enrichedDois.set(key, Date.now());
    if (enrichedDois.size > ENRICHED_DOI_CAP) {
      enrichedDois.delete(enrichedDois.keys().next().value);
    }
  }

  function enrichedRecently(doi) {
    return enrichedDois.has(String(doi || '').toLowerCase());
  }

  /** 条目是否已带 PDF 附件（pdfPath 是 attachments 的兼容投影，双保险都查） */
  function hasPdfAttachment(paper) {
    if (!paper) return false;
    if (paper.pdfPath) return true;
    return (paper.attachments || []).some(function (a) { return a && a.kind === 'pdf' && a.path; });
  }

  /** 知网 PDF 需要登录会话，主进程直连拿不到 cookie，跳过下载 */
  function isCnkiSessionUrl(pdfUrl) {
    return /(^|\.)cnki\.net$/i.test(function () {
      try { return new URL(pdfUrl).hostname; } catch (e) { return ''; }
    }());
  }

  /** 富化字段并入输入（页面提取优先，仅补缺）；返回是否真的并入了任何字段 */
  function mergeEnriched(target, enriched) {
    if (!enriched) return false;
    let merged = false;
    ['abstract', 'venue', 'oaUrl', 'openalexId', 'volume', 'issue', 'pages', 'issn'].forEach(function (f) {
      if (!target[f] && enriched[f]) { target[f] = enriched[f]; merged = true; }
    });
    if (!target.title && enriched.title) { target.title = enriched.title; merged = true; }
    if (target.year == null && enriched.year != null) { target.year = enriched.year; merged = true; }
    if (!(target.authors && target.authors.length) && enriched.authors && enriched.authors.length) {
      target.authors = enriched.authors; merged = true;
    }
    if (target.citations == null && enriched.citations != null) {
      target.citations = enriched.citations;
      target.citationSource = enriched.citationSource || '';
      merged = true;
    }
    return merged;
  }


  /** 给补全/下载请求加超时兜底，网络挂起时快速失败而不是无限等待 */
  function withTimeout(init, ms) {
    return Object.assign({}, init, { signal: AbortSignal.timeout(ms || 12000) });
  }

  /** OpenAlex 元数据抓取（主进程精简版；失败时退化为仅标题入库） */
  async function fetchOpenAlexByDoi(doi) {
    try {
      const response = await netFetch('https://api.openalex.org/works/https://doi.org/' + encodeURIComponent(doi),
        withTimeout({ headers: { Accept: 'application/json' } }));
      if (!response.ok) return null;
      const w = await response.json();
      if (!w) return null;
      const paper = {};
      if (w.title) paper.title = w.title;
      if (Array.isArray(w.authorships)) {
        paper.authors = w.authorships.map(function (a) { return a && a.author && a.author.display_name || ''; }).filter(Boolean);
      }
      if (w.publication_year) paper.year = w.publication_year;
      if (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) {
        paper.venue = w.primary_location.source.display_name;
      }
      if (w.biblio) {
        if (w.biblio.volume) paper.volume = String(w.biblio.volume);
        if (w.biblio.issue) paper.issue = String(w.biblio.issue);
        if (w.biblio.first_page) paper.pages = String(w.biblio.first_page) + (w.biblio.last_page ? '-' + w.biblio.last_page : '');
      }
      if (w.doi) paper.doi = String(w.doi).replace(/^https?:\/\/doi\.org\//i, '');
      // OpenAlex 的摘要是倒排索引（{词: [位置]}），重建为正文；兼容直接给字符串的形态
      const inverted = w.abstract_inverted_index;
      if (typeof w.abstract === 'string' && w.abstract) {
        paper.abstract = w.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } else if (inverted && typeof inverted === 'object') {
        const slots = [];
        Object.keys(inverted).forEach(function (word) {
          (inverted[word] || []).forEach(function (pos) {
            if (Number.isInteger(pos) && pos >= 0 && pos < 10000) slots[pos] = word;
          });
        });
        const text = [];
        for (let i = 0; i < slots.length; i++) if (slots[i] != null) text.push(slots[i]);
        if (text.length) paper.abstract = text.join(' ');
      }
      if (typeof w.cited_by_count === 'number') {
        paper.citations = w.cited_by_count;
        paper.citationSource = 'OpenAlex';
      }
      if (w.open_access && w.open_access.oa_url) paper.oaUrl = w.open_access.oa_url;
      if (w.id) paper.openalexId = w.id;
      return paper;
    } catch (error) {
      return null;
    }
  }

  /** Crossref 兼底补全（OpenAlex 查不到时；同样只提取常用字段） */
  async function fetchCrossrefByDoi(doi) {
    try {
      const response = await netFetch('https://api.crossref.org/works/' + encodeURIComponent(doi),
        withTimeout({ headers: { Accept: 'application/json' } }));
      if (!response.ok) return null;
      const data = await response.json();
      const m = data && data.message;
      if (!m) return null;
      const paper = {};
      if (Array.isArray(m.title) && m.title[0]) paper.title = String(m.title[0]);
      if (Array.isArray(m.author)) {
        paper.authors = m.author.map(function (a) {
          return [a && a.given, a && a.family].filter(Boolean).join(' ').trim();
        }).filter(Boolean);
      }
      const parts = m.issued && Array.isArray(m.issued['date-parts']) && m.issued['date-parts'][0];
      if (parts && parts[0]) paper.year = Number(parts[0]) || null;
      if (Array.isArray(m['container-title']) && m['container-title'][0]) paper.venue = String(m['container-title'][0]);
      if (m.volume) paper.volume = String(m.volume);
      if (m.issue) paper.issue = String(m.issue);
      if (m.page) paper.pages = String(m.page);
      if (Array.isArray(m.ISSN) && m.ISSN[0]) paper.issn = String(m.ISSN[0]);
      if (m.DOI) paper.doi = String(m.DOI);
      if (typeof m['is-referenced-by-count'] === 'number') {
        paper.citations = m['is-referenced-by-count'];
        paper.citationSource = 'Crossref';
      }
      if (typeof m.abstract === 'string') paper.abstract = m.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return paper;
    } catch (error) {
      return null;
    }
  }

  /** 入库（仅活跃 DOI 去重）——由 db 层原子事务完成，folderId 为可选目标文件夹。返回 { paper, duplicated } */
  function upsertPaper(input) {
    return libraryDb.bridgeUpsertPaper({
      doi: String(input.doi || '').replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim(),
      title: input.title || '',
      url: input.url || '',
      authors: input.authors || [],
      year: input.year != null ? input.year : null,
      venue: input.venue || '',
      abstract: input.abstract || '',
      issn: input.issn || '',
      citations: input.citations != null ? input.citations : null,
      citationSource: input.citationSource || '',
      oaUrl: input.oaUrl || '',
      openalexId: input.openalexId || '',
      volume: input.volume || '',
      issue: input.issue || '',
      pages: input.pages || '',
      tags: input.tags || [],
      folderId: String(input.folderId || ''),
      sourceType: input.sourceType || '',
      translatorError: input.translatorError || '',
      entryType: input.entryType || '',
      date: input.date || '',
      publisher: input.publisher || '',
      isbn: input.isbn || '',
      language: input.language || ''
    });
  }

  async function attachPdf(paperId, pdfUrl) {
    try {
      const dir = await resolveDownloadDir(paperId);
      await fs.mkdir(dir, { recursive: true });
      const target = await availablePdfPath(dir, 'litboard-' + paperId + '.pdf');
      const result = await downloadPdfToFile(pdfUrl, target, { fetch: pdfFetch, timeoutMs: 30000 });
      if (result && result.error) return false;
      return attachPdfFile(paperId, result.path);
    } catch (error) {
      return false;
    }
  }

  /** 扩展在浏览器端下载好的 PDF 字节落盘并挂附件；知网等需要登录会话的 PDF 走这里 */
  async function attachPdfBytes(paperId, bytes, fileName) {
    try {
      if (!Buffer.isBuffer(bytes) || bytes.length < 1024 ||
          bytes.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) === -1) return false;
      const dir = await resolveDownloadDir(paperId);
      await fs.mkdir(dir, { recursive: true });
      const safeName = String(fileName || '').replace(/[^\w\u4e00-\u9fff\-. ]/g, '_').slice(-120).trim();
      const target = await availablePdfPath(dir,
        'litboard-' + paperId + (safeName && /\.pdf$/i.test(safeName) ? '-' + safeName : '.pdf'));
      await fs.writeFile(target, bytes);
      return attachPdfFile(paperId, target);
    } catch (error) {
      return false;
    }
  }

  /** base64 老路径（旧扩展兼容）：校验后转字节复用 attachPdfBytes */
  async function attachPdfBase64(paperId, base64, fileName) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(String(base64 || ''))) return false;
    return attachPdfBytes(paperId, Buffer.from(base64, 'base64'), fileName);
  }

  /** 共享的附件登记逻辑：把磁盘上的 PDF 挂到 paper.attachments 首位（db 原子事务） */
  function attachPdfFile(paperId, filePath) {
    const paper = libraryDb.bridgeAttachPdf(paperId, filePath, path.basename(filePath));
    return paper ? true : false;
  }

  /**
   * 后台收尾：联网富化（OpenAlex → Crossref 兼底）+ PDF 候选下载。
   * 响应早已返回，这里静默完成；有实际变更时再发一次 onSaved 让渲染层刷新。
   */
  async function finishSaveInBackground(paperId, input, needsEnrich, requestDuplicated) {
    const enrichedInput = Object.assign({}, input);
    let changed = false;
    if (needsEnrich) {
      const enriched = await fetchOpenAlexByDoi(input.doi) || await fetchCrossrefByDoi(input.doi);
      if (enriched) markEnriched(input.doi); // 失败不记：下次保存仍会重试
      if (mergeEnriched(enrichedInput, enriched)) {
        try { await upsertPaper(enrichedInput); changed = true; } catch (e) { return; }
      }
    }
    let paper;
    try { paper = libraryDb.getPaper(paperId); } catch (e) { paper = null; }
    if (!paper) return; // 保存后被并发硬删除：放弃补全
    let pdfAttached = false;
    if (!hasPdfAttachment(paper)) {
      // PDF 下载候选：页面直链优先（知网会话链除外），其次开放获取 oaUrl
      const pdfCandidates = [];
      if (input.pdfUrl && !isCnkiSessionUrl(input.pdfUrl)) pdfCandidates.push(input.pdfUrl);
      const oaUrl = enrichedInput.oaUrl || paper.oaUrl;
      if (oaUrl) pdfCandidates.push(oaUrl);
      for (let i = 0; i < pdfCandidates.length && !pdfAttached; i++) {
        pdfAttached = await attachPdf(paperId, pdfCandidates[i]);
      }
      // 附加附件（translator 多附件）：尽力逐个下载挂靠（F02）
      const seenUrls = {};
      if (input.pdfUrl) seenUrls[input.pdfUrl] = true;
      for (const extra of input.attachments) {
        if (seenUrls[extra.url]) continue;
        seenUrls[extra.url] = true;
        try { if (await attachPdf(paperId, extra.url)) changed = true; } catch (e) { /* 单个附件失败不阻塞 */ }
      }
    }
    if (changed || pdfAttached) {
      // duplicated 沿用本次请求的判定（渲染层 toast 据此区分「已保存/已合并」）
      onSaved({ paperId: paperId, paper: libraryDb.getPaper(paperId) || paper, duplicated: !!requestDuplicated, pdfAttached: pdfAttached });
    }
  }

  async function handleSave(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求须为 JSON 对象');
    } catch (error) {
      send(res, 400, { ok: false, error: '无效 JSON' });
      return;
    }
    const input = {
      doi: String(body.doi || ''),
      title: String(body.title || ''),
      url: String(body.url || ''),
      pdfUrl: String(body.pdfUrl || ''),
      authors: Array.isArray(body.authors) ? body.authors.map(String) : [],
      venue: String(body.venue || ''),
      abstract: String(body.abstract || ''),
      issn: String(body.issn || ''),
      year: body.year != null ? Number(body.year) : null,
      volume: String(body.volume || ''),
      issue: String(body.issue || ''),
      pages: String(body.pages || ''),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      folderId: String(body.folderId || ''),
      sourceType: String(body.sourceType || '').slice(0, 120),
      translatorError: String(body.translatorError || '').slice(0, 300),
      // 阶段五收尾：translator 产出的完整字段（F02）
      entryType: String(body.entryType || '').slice(0, 40),
      date: String(body.date || '').slice(0, 20),
      publisher: String(body.publisher || '').slice(0, 200),
      isbn: String(body.isbn || '').slice(0, 20),
      language: String(body.language || '').slice(0, 20),
      attachments: (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 5).map(function (a) {
        var url = String(a && a.url || '');
        if (!/^https?:\/\//i.test(url)) return null;
        return { url: url.slice(0, 2000), fileName: String(a.fileName || '').slice(0, 200) };
      }).filter(Boolean)
    };
    if (!input.title && !input.doi) {
      send(res, 422, { ok: false, error: '缺少标题或 DOI' });
      return;
    }
    // 无标题但带 DOI 的罕见路径：条目标题只能来自联网补全（bridgeUpsertPaper 不回填
    // 已有条目的标题，先入库会卡死在「(未命名)」），保留旧的「先补全再入库」——响应慢
    // 但正确；本会话已补全过的 DOI 直接跳过。
    if (!input.title && input.doi && !enrichedRecently(input.doi)) {
      const enriched = await fetchOpenAlexByDoi(input.doi) || await fetchCrossrefByDoi(input.doi);
      if (enriched) markEnriched(input.doi);
      mergeEnriched(input, enriched);
    }
    // —— 同步段：只做本地查重 + 入库（指纹/DOI 去重在 db 层事务里），零联网 ——
    const result = await upsertPaper(input);
    const paper = result.paper;
    const alreadyHasPdf = hasPdfAttachment(paper);
    const fieldsComplete = !!(paper.abstract && String(paper.abstract).trim()) || enrichedRecently(input.doi);
    // 后台任务判定：重复命中且字段齐全（有 abstract 或近期已补全）时完全跳过联网。
    const needsEnrich = !!input.doi && !fieldsComplete;
    const mayGainPdf = !alreadyHasPdf && (
      (input.pdfUrl && !isCnkiSessionUrl(input.pdfUrl)) ||
      input.oaUrl || paper.oaUrl ||
      needsEnrich // 富化可能带出 oaUrl
    );
    const wantsExtras = !alreadyHasPdf && input.attachments.length > 0;
    const pending = needsEnrich || mayGainPdf || wantsExtras;
    if (pending) {
      scheduleBackground(function () { return finishSaveInBackground(paper.id, input, needsEnrich, result.duplicated); });
    }
    onSaved({ paperId: paper.id, paper: paper, duplicated: result.duplicated, pdfAttached: alreadyHasPdf });
    send(res, 200, {
      ok: true,
      id: paper.id,
      title: paper.title,
      duplicated: result.duplicated,
      pdfAttached: alreadyHasPdf,
      // 新增字段：旧扩展忽略；新扩展据此展示「后台补全中」而不是误报 PDF 失败
      enrichPending: pending
    });
  }

  async function handleAttachPdf(req, res) {
    const contentType = String(req.headers['content-type'] || '');
    // 新路径：原始 PDF 字节直传（paperId/fileName 走查询参数），省掉 base64 JSON 的膨胀与解码
    if (/^application\/pdf\b/i.test(contentType)) {
      let bytes;
      try {
        bytes = await readBodyRaw(req, 64 * 1024 * 1024);
      } catch (error) {
        send(res, 400, { ok: false, error: '请求体过大或 PDF 无效' });
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const paperId = String(url.searchParams.get('paperId') || '');
      const fileName = String(url.searchParams.get('fileName') || '');
      if (!paperId) { send(res, 422, { ok: false, error: '缺少 paperId' }); return; }
      const attached = await attachPdfBytes(paperId, bytes, fileName);
      if (!attached) {
        send(res, 200, { ok: false, attached: false, error: 'PDF 字节无效' });
        return;
      }
      const paper = libraryDb.getPaper(paperId);
      onSaved({ paperId: paperId, paper: paper || null, duplicated: false, pdfAttached: true });
      send(res, 200, { ok: true, attached: true });
      return;
    }
    // 老路径：base64 JSON（旧扩展兼容，行为不变）
    let body;
    try {
      body = JSON.parse(await readBody(req, 64 * 1024 * 1024));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求须为 JSON 对象');
    } catch (error) {
      send(res, 400, { ok: false, error: '请求体过大或 JSON 无效' });
      return;
    }
    const paperId = String(body.paperId || '');
    if (!paperId) { send(res, 422, { ok: false, error: '缺少 paperId' }); return; }
    const attached = await attachPdfBase64(paperId, String(body.pdfBase64 || ''), String(body.fileName || ''));
    if (!attached) {
      send(res, 200, { ok: false, attached: false, error: 'PDF 字节无效' });
      return;
    }
    const paper = libraryDb.getPaper(paperId);
    onSaved({ paperId: paperId, paper: paper || null, duplicated: false, pdfAttached: true });
    send(res, 200, { ok: true, attached: true });
  }

  /** 文件夹树（按层级排序）响应给扩展 popup */
  async function handleFolders(res) {
    const state = await libraryDb.loadState();
    const byParent = {};
    state.folders.forEach(function (folder) {
      if (folder.deletedAt) return;
      (byParent[folder.parentId || ''] = byParent[folder.parentId || ''] || []).push(folder);
    });
    const folders = [];
    function walk(parentId, depth) {
      (byParent[parentId] || []).sort(function (a, b) { return (a.sortIndex || 0) - (b.sortIndex || 0); })
        .forEach(function (folder) {
          folders.push({ id: folder.id, name: folder.name, parentId: folder.parentId || '', depth: depth });
          walk(folder.id, depth + 1);
        });
    }
    walk('', 0);
    const currentValid = state.folders.some(function (f) { return f.id === currentFolderId && !f.deletedAt; });
    send(res, 200, { ok: true, folders: folders, currentFolderId: currentValid ? currentFolderId : '' });
  }

  async function route(req, res) {
    if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/ping') {
      send(res, 200, { ok: true, app: 'LitBoard' });
      return;
    }
    if ((url.pathname === '/save' && req.method === 'POST') ||
        (url.pathname === '/folders' && req.method === 'GET') ||
        (url.pathname === '/attach-pdf' && req.method === 'POST')) {
      const token = await getToken();
      if (req.headers['x-litboard-token'] !== token) {
        send(res, 401, { ok: false, error: '令牌无效' });
        return;
      }
      if (url.pathname === '/save') await handleSave(req, res);
      else if (url.pathname === '/attach-pdf') await handleAttachPdf(req, res);
      else await handleFolders(res);
      return;
    }
    send(res, 404, { ok: false, error: '未知接口' });
  }

  function createServer() {
    return http.createServer(function (req, res) {
      res._req = req; // send() 反射 Origin 时读取请求头
      route(req, res).catch(function (error) {
        send(res, 500, { ok: false, error: String(error && error.message || error) });
      });
    });
  }

  async function startServer() {
    const enabled = await libraryDb.getSetting('bridgeEnabled');
    if (enabled === false) return { running: false };
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      const port = DEFAULT_PORT + attempt;
      const candidate = createServer();
      const ok = await new Promise(function (resolve) {
        const onError = function () {
          candidate.off('listening', onListening);
          resolve(false);
        };
        const onListening = function () {
          candidate.off('error', onError);
          resolve(true);
        };
        candidate.once('error', onError);
        candidate.once('listening', onListening);
        candidate.listen(port, '127.0.0.1');
      });
      if (ok) {
        server = candidate;
        actualPort = port;
        return { running: true, port: port, token: await getToken() };
      }
    }
    console.error('LitBoard bridge: no free loopback port');
    return { running: false };
  }

  function enqueue(operation) {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(function () {});
    return result;
  }

  function start() {
    return enqueue(async function () {
      if (server && actualPort != null) {
        return { running: true, port: actualPort, token: await getToken() };
      }
      return startServer();
    });
  }

  function stop() {
    return enqueue(async function () {
      const current = server;
      server = null;
      actualPort = null;
      if (!current) return;
      await new Promise(function (resolve) { current.close(function () { resolve(); }); });
    });
  }

  return {
    start: start,
    stop: stop,
    getToken: getToken,
    whenIdle: whenIdle,
    setCurrentFolder: function (id) { currentFolderId = String(id || ''); },
    status: function () { return { running: !!server && actualPort != null, port: actualPort }; }
  };
}

module.exports = { createBridgeServer, DEFAULT_PORT };
