/* 跨库 PDF 全文搜索：渲染层负责 PDF 文本提取（PDF.js），
 * 桌面版索引与查询由主进程 SQLite（FTS5 trigram）承担；
 * 浏览器版退化为会话内存缓存 + 线性扫描。 */
(function () {
  'use strict';

  var DESKTOP = !!(window && window.litboardDesktop);
  var metaCache = null;           // { paperId: { fingerprint, updatedAt } }
  var memoryCache = {};           // 浏览器版：{ paperId: { fingerprint, pages } }
  var memoryFailed = {};          // 浏览器版：提取失败会话内不再重试

  function attachmentKey(paper, attachment) { return paper.id + ':' + (attachment && attachment.id || ''); }
  function paperAttachments(paper) {
    var list = (paper && paper.attachments || []).filter(function (attachment) {
      return attachment && attachment.kind === 'pdf' && attachment.path;
    });
    if (!list.length && paper && paper.pdfPath) list.push({ id: '', kind: 'pdf', path: paper.pdfPath,
      fileName: paper.pdfFileName || '', fingerprint: paper.pdfFingerprint || '' });
    return list;
  }

  function norm(s) { return String(s || '').toLocaleLowerCase(); }

  function ensureMeta() {
    if (metaCache) return Promise.resolve(metaCache);
    if (!DESKTOP || !window.litboardDesktop.pdfSearchMeta) {
      metaCache = {};
      return Promise.resolve(metaCache);
    }
    return window.litboardDesktop.pdfSearchMeta().then(function (value) {
      metaCache = value && typeof value === 'object' ? value : {};
      return metaCache;
    }).catch(function () { metaCache = {}; return metaCache; });
  }

  /** 从 PDF 提取全部页面文本（页数与单页长度设上限，防异常文件） */
  function extractPages(paper, attachment) {
    if (!window.LitPdf || !DESKTOP || !window.litboardDesktop.readFileBytes || !attachment || !attachment.path) {
      return Promise.resolve(null); // 无桌面桥接时无法读取本地 PDF
    }
    return window.LitPdf.load().then(function () {
      return window.litboardDesktop.readFileBytes(attachment.path);
    }).then(function (bytes) {
      return window.LitPdf.extractText(attachment.path, new Uint8Array(bytes));
    }).then(function (result) {
      return result.pages.slice(0, 400).map(function (text) {
        return String(text || '').length > 200000 ? String(text).slice(0, 200000) : String(text || '');
      });
    });
  }

  function indexAttachment(paper, attachment) {
    var key = attachmentKey(paper, attachment);
    return extractPages(paper, attachment).then(function (pages) {
      if (!pages) return null;
      if (DESKTOP && window.litboardDesktop.pdfSearchPut) {
        return window.litboardDesktop.pdfSearchPut({
          paperId: paper.id, attachmentId: attachment.id || '',
          fingerprint: attachment.fingerprint || paper.pdfFingerprint || '',
          method: 'pdfjs',
          pages: pages
        }).then(function () {
          metaCache[key] = { fingerprint: attachment.fingerprint || paper.pdfFingerprint || '', updatedAt: Date.now() };
          return pages;
        });
      }
      memoryCache[key] = { fingerprint: attachment.fingerprint || paper.pdfFingerprint || '', pages: pages };
      return pages;
    });
  }

  /** 索引是否最新（无指纹的旧条目只在缺失时补一次） */
  function isStale(attachment, meta) {
    if (!meta) return true;
    if (attachment.fingerprint) return meta.fingerprint !== attachment.fingerprint;
    return false;
  }

  /** 纯逻辑：在逐页文本中扫描关键词 → 命中页索引数组 */
  function scanTexts(query, pages) {
    var needle = norm(query).trim();
    var hits = [];
    if (!needle || !pages || !pages.length) return hits;
    pages.forEach(function (text, index) {
      if (norm(text).indexOf(needle) !== -1) hits.push(index);
    });
    return hits;
  }

  /** 从候选文献展开出全部 PDF 检索单元（逐附件） */
  function expandUnits(candidates) {
    var units = [];
    (candidates || []).forEach(function (paper) {
      paperAttachments(paper).forEach(function (attachment) { units.push({ paper: paper, attachment: attachment }); });
    });
    return units;
  }

  /** 缺失/过期的单元（对照 meta 指纹），这些才需要提取正文 */
  function staleUnits(units) {
    return units.filter(function (unit) {
      return isStale(unit.attachment, metaCache[attachmentKey(unit.paper, unit.attachment)] ||
        metaCache[unit.paper.id]);
    });
  }

  /** 并发提取入库 stale 单元（3 并发，单篇失败不阻塞）；返回成功入库篇数 */
  function indexUnits(units, onProgress) {
    var done = 0;
    var okCount = 0;
    function tick(title) {
      done++;
      if (onProgress) onProgress({ done: done, total: units.length, title: title || '' });
    }
    var cursor = 0;
    function worker() {
      if (cursor >= units.length) return Promise.resolve();
      var unit = units[cursor++];
      return indexAttachment(unit.paper, unit.attachment)
        .then(function (pages) { if (pages && pages.length) okCount++; }, function () { /* 单篇失败不阻塞整体 */ })
        .then(function () { tick(unit.paper.title || unit.attachment.fileName || ''); return worker(); });
    }
    var workers = [];
    for (var i = 0; i < Math.min(3, units.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () { return okCount; });
  }

  function searchDesktop(query, candidates, onProgress) {
    return ensureMeta().then(function () {
      var stale = staleUnits(expandUnits(candidates));
      return indexUnits(stale, onProgress).then(function () {
        return window.litboardDesktop.pdfSearchQuery(query);
      });
    }).then(function (hits) {
      var byId = {};
      candidates.forEach(function (paper) { byId[paper.id] = paper; });
      return (hits || []).map(function (hit) {
        var paper = byId[hit.paperId];
        var attachment = paper ? paperAttachments(paper).find(function (item) { return item.id === hit.attachmentId; }) : null;
        return paper ? { paper: paper, attachment: attachment || null, attachmentId: hit.attachmentId || '',
          pages: hit.pages, count: hit.count, snippets: hit.snippets || [] } : null;
      }).filter(Boolean);
    });
  }

  /**
   * 主动构建全文索引：把缺失/过期的 PDF 正文提取入库（不执行查询）。
   * 供设置页「构建索引」使用；返回 Promise<{ indexed, total, stale }>。
   */
  function reindex(papers, onProgress) {
    if (!DESKTOP || !window.litboardDesktop || !window.litboardDesktop.pdfSearchPut) {
      return Promise.resolve({ indexed: 0, total: 0, stale: 0 });
    }
    var units = expandUnits(papers);
    var total = units.length;
    return ensureMeta().then(function () {
      var stale = staleUnits(units);
      return indexUnits(stale, onProgress).then(function (indexed) {
        return { indexed: indexed, total: total, stale: stale.length };
      });
    });
  }

  function searchBrowser(needle, candidates, onProgress) {
    var hits = [];
    var units = [];
    candidates.forEach(function (paper) {
      paperAttachments(paper).forEach(function (attachment) { units.push({ paper: paper, attachment: attachment }); });
    });
    var done = 0;
    var total = units.length;
    function tick(title) {
      done++;
      if (onProgress) onProgress({ done: done, total: total, title: title || '' });
    }
    var cursor = 0;
    function paperText(paper, attachment) {
      var key = attachmentKey(paper, attachment);
      var entry = memoryCache[key];
      if (entry && (!attachment.fingerprint || entry.fingerprint === attachment.fingerprint)) {
        return Promise.resolve(entry.pages);
      }
      if (memoryFailed[key]) return Promise.resolve(null);
      return indexAttachment(paper, attachment).catch(function () { memoryFailed[key] = true; return null; });
    }
    function worker() {
      if (cursor >= units.length) return Promise.resolve();
      var unit = units[cursor++];
      return paperText(unit.paper, unit.attachment).then(function (pages) {
        var pageHits = pages ? scanTexts(needle, pages) : [];
        if (pageHits.length) hits.push({ paper: unit.paper, attachment: unit.attachment,
          attachmentId: unit.attachment.id || '', pages: pageHits, count: pageHits.length, snippets: [] });
        tick(unit.paper.title || unit.attachment.fileName || '');
        return worker();
      });
    }
    var workers = [];
    for (var i = 0; i < Math.min(3, units.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () { return hits; });
  }

  /**
   * 跨库全文检索。桌面版：缺失/过期条目先提取建索引（3 并发），
   * 命中查询由主进程 FTS 完成；onProgress({ done, total, title }) 用于进度提示。
   * 返回 [{ paper, pages:[页索引], count, snippets }]。
   */
  function search(query, papers, onProgress) {
    var needle = norm(query).trim();
    var candidates = (papers || []).filter(function (paper) { return paper && paperAttachments(paper).length; });
    if (!needle) return Promise.resolve([]);
    if (DESKTOP && window.litboardDesktop.pdfSearchQuery) {
      return searchDesktop(query, candidates, onProgress);
    }
    return searchBrowser(needle, candidates, onProgress);
  }

  function invalidate(paperId, attachmentId) {
    var key = paperId + ':' + (attachmentId || '');
    delete memoryCache[key];
    delete memoryFailed[key];
    if (metaCache) { delete metaCache[key]; if (!attachmentId) delete metaCache[paperId]; }
    if (DESKTOP && window.litboardDesktop.pdfSearchInvalidate) {
      window.litboardDesktop.pdfSearchInvalidate({ paperId: paperId, attachmentId: attachmentId || '' }).catch(function () {});
    }
  }

  /** 清除索引后调用：丢弃内存 meta，下次检索重建 */
  function resetCache() {
    metaCache = null;
    memoryCache = {};
    memoryFailed = {};
  }

  window.LitPdfSearch = {
    search: search,
    reindex: reindex,
    invalidate: invalidate,
    resetCache: resetCache,
    scanTexts: scanTexts
  };
})();
