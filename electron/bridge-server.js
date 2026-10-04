'use strict';

/**
 * LitBoard 浏览器扩展桥接服务（主进程）。
 * 监听 127.0.0.1 的本地 HTTP 端口，接收浏览器扩展的「一键保存」请求：
 *   GET  /ping           存活探测（无需令牌）
 *   POST /save           保存文献 { doi?, title?, url?, pdfUrl?, authors?, year?, venue? }
 * 令牌鉴权（X-LitBoard-Token），首次启动随机生成并持久化在 SQLite settings 中。
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

  /** 扩展在浏览器端下载好的 PDF（base64）落盘并挂附件；知网等需要登录会话的 PDF 走这里 */
  async function attachPdfBase64(paperId, base64, fileName) {
    try {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(String(base64 || ''))) return false;
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length < 1024 || bytes.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) === -1) return false;
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

  /** 共享的附件登记逻辑：把磁盘上的 PDF 挂到 paper.attachments 首位（db 原子事务） */
  function attachPdfFile(paperId, filePath) {
    const paper = libraryDb.bridgeAttachPdf(paperId, filePath, path.basename(filePath));
    return paper ? true : false;
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
    // 有 DOI 先联网补全（OpenAlex → Crossref 兼底，主进程直连）；已有字段以页面提取（如知网）为准，仅补缺
    if (input.doi) {
      const enriched = await fetchOpenAlexByDoi(input.doi) || await fetchCrossrefByDoi(input.doi);
      if (enriched) {
        ['abstract', 'venue', 'oaUrl', 'openalexId', 'volume', 'issue', 'pages', 'issn'].forEach(function (f) {
          if (!input[f] && enriched[f]) input[f] = enriched[f];
        });
        if (!input.title && enriched.title) input.title = enriched.title;
        if (input.year == null && enriched.year != null) input.year = enriched.year;
        if (!(input.authors && input.authors.length) && enriched.authors && enriched.authors.length) input.authors = enriched.authors;
        if (input.citations == null && enriched.citations != null) {
          input.citations = enriched.citations;
          input.citationSource = enriched.citationSource || '';
        }
      }
    }
    if (!input.title && !input.doi) {
      send(res, 422, { ok: false, error: '缺少标题或 DOI' });
      return;
    }
    const result = await upsertPaper(input);
    let pdfAttached = false;
    // 知网等需要会话 cookie 的 PDF 由扩展在浏览器上下文下载后走 /attach-pdf，
    // 主进程直连拿不到登录 cookie，直接跳过避免无效请求。
    const needsSessionPdf = /(^|\.)cnki\.net$/i.test(function () {
      try { return new URL(input.pdfUrl).hostname; } catch (e) { return ''; }
    }());
    // PDF 下载候选：页面直链优先，其次 OpenAlex 给出的开放获取链接（oaUrl）
    const wantsPdf = !result.duplicated || (result.paper && !result.paper.pdfPath);
    if (wantsPdf && result.paper) {
      const pdfCandidates = [];
      if (input.pdfUrl && !needsSessionPdf) pdfCandidates.push(input.pdfUrl);
      if (input.oaUrl) pdfCandidates.push(input.oaUrl);
      for (let i = 0; i < pdfCandidates.length && !pdfAttached; i++) {
        pdfAttached = await attachPdf(result.paper.id, pdfCandidates[i]);
      }
      // 附加附件（translator 多附件）：尽力逐个下载挂靠（F02）
      const seenUrls = {};
      if (input.pdfUrl) seenUrls[input.pdfUrl] = true;
      for (const extra of input.attachments) {
        if (seenUrls[extra.url]) continue;
        seenUrls[extra.url] = true;
        try { await attachPdf(result.paper.id, extra.url); } catch (e) { /* 单个附件失败不阻塞 */ }
      }
    }
    onSaved({ paperId: result.paper.id, paper: result.paper, duplicated: result.duplicated, pdfAttached: pdfAttached });
    send(res, 200, {
      ok: true,
      id: result.paper.id,
      title: result.paper.title,
      duplicated: result.duplicated,
      pdfAttached: pdfAttached
    });
  }

  async function handleAttachPdf(req, res) {
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
    setCurrentFolder: function (id) { currentFolderId = String(id || ''); },
    currentFolder: function () { return currentFolderId; },
    status: function () { return { running: !!server && actualPort != null, port: actualPort }; }
  };
}

module.exports = { createBridgeServer, DEFAULT_PORT };
