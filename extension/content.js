/* LitBoard 保存助手 — 页面元数据提取（注入执行，幂等；含知网详情页支持） */
(function () {
  'use strict';
  if (window.__litboardExtractorLoaded) return;
  window.__litboardExtractorLoaded = true;

  function meta(names) {
    for (var i = 0; i < names.length; i++) {
      var el = document.querySelector('meta[name="' + names[i] + '"], meta[property="' + names[i] + '"]');
      if (el && el.content) return el.content.trim();
    }
    return '';
  }

  function cleanDoi(value) {
    return String(value || '').replace(/^doi:/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/[).,;\]]+$/, '').trim();
  }

  function elText(el) {
    return el ? String(el.innerText || el.textContent || '').trim() : '';
  }

  function uniqueStrings(list) {
    var seen = {}, result = [];
    list.forEach(function (value) {
      var t = String(value || '').trim();
      if (t && !seen[t]) { seen[t] = true; result.push(t); }
    });
    return result;
  }

  function isCnkiDetailPage() {
    return /(^|\.)cnki\.net$/i.test(location.hostname) &&
      /(kns8s?|kcms2?|KCMS)\//i.test(location.pathname) &&
      !!document.querySelector('.wx-tit h1, .doc-top, #paramfilename');
  }

  function topicText(selector, label) {
    var el = document.querySelector(selector);
    if (!el) return '';
    var value = elText(el).replace(/^\s+/, '');
    var m = value.match(new RegExp('^(' + label + ')[：:\\s]*([\\s\\S]*)'));
    return m ? m[2].trim() : value;
  }

  function cnkiLabeledData() {
    // 详情页各字段行：.row / li.top-space > .rowtit，提取 label→value
    var rows = [];
    try { rows = document.querySelectorAll('.main .container :has(>[class^="rowtit"])'); } catch (e) {
      var titles = document.querySelectorAll('.main .container [class^="rowtit"]');
      var unique = [];
      titles.forEach(function (t) { if (t.parentElement && unique.indexOf(t.parentElement) === -1) unique.push(t.parentElement); });
      rows = unique;
    }
    var data = {};
    rows.forEach(function (row) {
      var labelEl = row.querySelector('[class^="rowtit"]');
      if (!labelEl) return;
      var label = elText(labelEl).replace(/[：:]$/, '');
      var clone = row.cloneNode(true);
      (clone.querySelectorAll('[class^="rowtit"]') || []).forEach(function (n) { n.remove(); });
      data[label] = elText(clone).replace(/\s+/g, ' ');
    });
    return data;
  }

  function cnkiDetailExtract() {
    var result = { source: 'CNKI', url: location.href };
    var label = cnkiLabeledData();

    var titleNode = document.querySelector('.wx-tit > h1, .wx-tit h1');
    result.title = titleNode ? String(titleNode.textContent || '').replace(/\s+/g, ' ').trim() : '';

    // 作者：#authorpart 内 span>a，或逗号分隔；去掉 sup 标注
    var authorEl = document.querySelector('#authorpart');
    if (authorEl) {
      var spanLinks = authorEl.querySelectorAll('span > a');
      if (spanLinks.length) {
        result.authors = uniqueStrings(Array.prototype.map.call(spanLinks, function (a) {
          return String(a.textContent || '').trim();
        }));
      } else {
        result.authors = uniqueStrings(elText(authorEl).split(/[,，]/));
      }
    } else {
      var authorMeta = meta(['citation_author']);
      result.authors = uniqueStrings(authorMeta.split(/[,，]/));
    }

    // 期刊信息（journalArticle）：.top-tip 文本
    var pubInfo = elText(document.querySelector('.top-tip'));
    var parsedPubInfo = window.LitTranslators && window.LitTranslators.parseCnkiPublicationInfo
      ? window.LitTranslators.parseCnkiPublicationInfo(pubInfo) : {};
    result.venue = parsedPubInfo.venue || label['来源期刊'] || label['期刊'] || label['刊名'] ||
      meta(['citation_journal_title', 'dc.source']) || elText(document.querySelector('.top-tip > a, .top-tip a')) || '';
    result.year = parsedPubInfo.year || ((label['发表时间'] || label['出版年'] || label['年'] || '').match(/(?:19|20)\d{2}/) || [])[0] || '';
    result.volume = parsedPubInfo.volume || '';
    result.issue = parsedPubInfo.issue || '';
    result.pages = parsedPubInfo.pages || '';

    result.abstract = topicText('.abstract-text', '摘要') || label['摘要'] || '';
    var keywordsEl = document.querySelector('.keywords');
    if (keywordsEl) {
      var tagLinks = keywordsEl.querySelectorAll('a');
      if (tagLinks.length) {
        result.tags = uniqueStrings(Array.prototype.map.call(tagLinks, function (a) {
          return String(a.textContent || '').replace(/[;；]$/, '').trim();
        }));
      } else {
        result.tags = uniqueStrings(elText(keywordsEl).split(/[;；]/));
      }
    }

    result.doi = cleanDoi(label['DOI'] || meta(['citation_doi']));
    result.issn = label['ISSN'] || label['CN'] || '';

    // PDF 下载链接（登录/未登录都可能指向下载接口）
    var pdfLink = document.querySelector('.btn-dlpdf > a, .btn-qwxz > a, .download-pdf a');
    if (pdfLink) {
      var href = pdfLink.getAttribute('href') || '';
      if (href && !/^javascript:/i.test(href)) {
        result.pdfUrl = new URL(href, location.href).href;
        if (result.pdfUrl.indexOf('login') !== -1) result.pdfUrl = '';
      }
    }
    // 细节页参数（导出接口需要）
    var filename = document.querySelector('#paramfilename') && document.querySelector('#paramfilename').value;
    var dbcode = document.querySelector('#paramdbcode') && document.querySelector('#paramdbcode').value;
    var dbname = document.querySelector('#paramdbname') && document.querySelector('#paramdbname').value;
    if (filename) {
      result.moduleId = filename;
      result.dbcode = dbcode;
      result.dbname = dbname;
    }
    return result;
  }

  /** 知网导出接口（无需登录即可出 ISSN / 卷期页码等字段，登录后更全） */
  async function cnkiExportEnrich(meta) {
    var filename = meta.moduleId || (document.querySelector('#export-id') && document.querySelector('#export-id').value || '');
    if (!filename) return meta;
    try {
      var head = document.head.innerHTML;
      var exportUrlMatch = head.match(/['"]?([^'"]*\/dm8\/API\/GetExport[^'"]*)/);
      var apiUrl = (document.querySelector('#export-url') && document.querySelector('#export-url').value) ||
        (exportUrlMatch && exportUrlMatch[1]) || 'https://kns.cnki.net/dm8/API/GetExport';
      var body = 'filename=' + encodeURIComponent(filename) +
        '&uniplatform=' + (meta.uniplatform || 'NZKPT') +
        '&displaymode=' + encodeURIComponent('GBTREFER,elearning,EndNote');
      var resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: body
      });
      if (!resp.ok) return meta;
      var json = await resp.json();
      if (!json || json.code !== 1 || !Array.isArray(json.data)) return meta;
      var refworks = '';
      json.data.forEach(function (entry) { if (entry && entry.key === 'EndNote' && entry.value && entry.value[0]) refworks = entry.value[0].replace(/<br>/g, '\\n'); });
      if (!refworks) return meta;
      var fields = {};
      refworks.split(/\\r?\\n/).forEach(function (line) {
        var m = line.match(/^%(\\w)\\s?([\\s\\S]*?)\\s*$/);
        if (!m || !m[2]) return;
        var key = m[1], value = m[2].trim();
        if (!value) return;
        if (key === 'T' || key === '!') { if (!fields.title) fields.title = value; }
        else if (key === 'A') { (fields.authors = fields.authors || []).push(value); }
        else if (key === 'J') { if (!fields.venue) fields.venue = value; }
        else if (key === 'D') { var y = value.match(/(\\d{4})/); if (y) fields.year = y[1]; }
        else if (key === 'V') { if (!fields.volume) fields.volume = value; }
        else if (key === 'N') { if (!fields.issue) fields.issue = value; }
        else if (key === 'P') { if (!fields.pages) fields.pages = value.replace(/[^0-9\\s,，-]/g, '').trim(); }
        else if (key === 'I') { if (!fields.issn) fields.issn = value; }
        else if (key === 'K') { (fields.tags = fields.tags || []).push(value); }
        else if (key === 'X') { if (!fields.abstract) fields.abstract = value; }
        else if (key === 'R') { var doi = cleanDoi(value); if (doi && doi.indexOf('(') === -1 && doi.indexOf('.') !== -1) fields.doi = doi; }
      });
      ['title', 'venue', 'year', 'volume', 'issue', 'pages', 'doi', 'abstract', 'issn'].forEach(function (f) {
        if (!meta[f] && fields[f]) meta[f] = fields[f];
      });
      if (fields.authors && fields.authors.length && !(meta.authors && meta.authors.length)) meta.authors = uniqueStrings(fields.authors);
      if (fields.tags && fields.tags.length && !(meta.tags && meta.tags.length)) meta.tags = uniqueStrings(fields.tags);
    } catch (e) { /* 导出接口失败不阻塞基本信息 */ }
    return meta;
  }

  function extractGeneric() {
    var result = {
      doi: cleanDoi(meta(['citation_doi', 'dc.identifier', 'prism.doi', 'bepress_citation_doi'])),
      title: meta(['citation_title', 'dc.title', 'og:title']) || document.title || '',
      pdfUrl: meta(['citation_pdf_url', 'citation_fulltext_pdf_url']),
      url: location.href,
      authors: Array.prototype.slice.call(document.querySelectorAll('meta[name="citation_author"]'))
        .map(function (el) { return el.content.trim(); }).filter(Boolean).slice(0, 50)
    };
    // 详情页判定：带 citation_* 强 meta 的页面（区别于搜索结果/列表页）
    result.detailPage = !!meta(['citation_doi', 'citation_title', 'prism.doi', 'bepress_citation_doi']);
    // 期刊/会议与卷期页（Highwire + PRISM + DC 都顺手读）
    result.venue = meta(['citation_journal_title', 'citation_conference_title', 'prism.publicationName', 'dc.source']);
    result.volume = meta(['citation_volume', 'prism.volume']);
    result.issue = meta(['citation_issue', 'prism.issue']);
    var firstPage = meta(['citation_firstpage', 'prism.startingPage']);
    var lastPage = meta(['citation_lastpage', 'prism.endingPage']);
    if (firstPage) result.pages = lastPage && lastPage !== firstPage ? firstPage + '-' + lastPage : firstPage;
    // 年份：citation_date / dc.date / prism.coverDate 等，取第一个 4 位数年份
    var dateRaw = meta(['citation_publication_date', 'citation_date', 'citation_online_date', 'prism.coverDate', 'dc.date']);
    var yearMatch = String(dateRaw).match(/(\d{4})/);
    if (yearMatch) result.year = yearMatch[1];
    result.issn = meta(['citation_issn', 'prism.issn', 'dc.identifier_issn']);
    result.abstract = meta(['citation_abstract', 'og:description', 'description']);
    // 关键词 → 标签（citation_keywords 可能出现多次，也兼容逗号/分号分隔的单条）
    var keywordEls = document.querySelectorAll('meta[name="citation_keywords"], meta[name="dc.subject"]');
    var keywords = [];
    Array.prototype.forEach.call(keywordEls, function (el) {
      String(el.content || '').split(/[;,，；]/).forEach(function (piece) { keywords.push(piece); });
    });
    result.tags = uniqueStrings(keywords).slice(0, 20);
    // arXiv 摘要页：没有 DOI 时用 arXiv 编号构造
    if (!result.doi) {
      var arxiv = location.href.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/i);
      if (arxiv) result.doi = '10.48550/arXiv.' + arxiv[1];
    }
    // DOI 正则兜底（页面前 2 万字符）
    if (!result.doi && document.body) {
      var m = document.body.innerText.slice(0, 20000).match(/\b10\.\d{4,9}\/[^\s"'<>]{4,80}/);
      if (m) result.doi = cleanDoi(m[0]);
    }
    return applyTranslator(result);
  }

  /** 阶段五：专用 translator 优先补字段；命中但解析失败时透传原因（popup 展示），再走通用兜底 */
  function applyTranslator(result) {
    if (!window.LitTranslators) return result;
    try {
      var tResult = window.LitTranslators.runTranslators({
        url: function () { return location.href; },
        meta: function (name) { return meta([name]); },
        metas: function (name) {
          return Array.prototype.slice.call(document.querySelectorAll('meta[name="' + name + '"], meta[property="' + name + '"]'))
            .map(function (el) { return el.content.trim(); }).filter(Boolean);
        },
        attr: function (selector, attrName) {
          var el = document.querySelector(selector);
          return el ? String(el.getAttribute(attrName) || '') : '';
        },
        text: function (selector) { return elText(document.querySelector(selector)); },
        jsonld: function () { return []; }
      });
      if (!tResult || !tResult.report) return result;
      if (tResult.report.translator) result.sourceType = 'translator:' + tResult.report.translator;
      if (tResult.report.failed) result.translatorError = tResult.report.reason || tResult.report.translator;
      if (tResult.item) {
        var it = tResult.item;
        // 专用解析结果完整合并（页面基础提取优先，translator 补缺；F02）
        ['title', 'venue', 'volume', 'issue', 'pages', 'publisher', 'isbn', 'language', 'abstract', 'entryType', 'date'].forEach(function (f) {
          if ((result[f] == null || result[f] === '') && it[f]) result[f] = it[f];
        });
        if (it.authors && it.authors.length && !(result.authors && result.authors.length)) result.authors = it.authors.slice(0, 50);
        if (!result.doi && it.doi) result.doi = cleanDoi(it.doi);
        if (it.tags && it.tags.length) result.tags = uniqueStrings((result.tags || []).concat(it.tags)).slice(0, 20);
        if (it.attachments && it.attachments.length) {
          if (!result.pdfUrl) result.pdfUrl = it.attachments[0].url || '';
          var extras = it.attachments.slice(1).filter(function (a) { return a && a.url && a.url !== result.pdfUrl; })
            .map(function (a) { return { url: a.url, fileName: a.fileName || '', kind: a.kind || 'pdf' }; });
          if (extras.length) result.attachments = extras;
        }
        var extra = tResult.item.bibtexExtra || {};
        Object.keys(extra).forEach(function (key) { if (result[key] == null || result[key] === '') result[key] = extra[key]; });
        if (tResult.item.date && !result.year) {
          var ym = String(tResult.item.date).match(/(\d{4})/);
          if (ym) result.year = ym[1];
        }
        if (tResult.item.attachments && tResult.item.attachments.length && !result.pdfUrl) {
          result.pdfUrl = tResult.item.attachments[0].url || '';
        }
      }
    } catch (e) {}
    return result;
  }
  function collectDoiItems() {
    var seen = {};
    var items = [];
    function add(doi, title) {
      doi = cleanDoi(doi);
      if (!doi || seen[doi.toLowerCase()]) return;
      seen[doi.toLowerCase()] = true;
      items.push({ doi: doi, title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 300) });
    }
    Array.prototype.forEach.call(document.querySelectorAll('a[href*="doi.org/10."]'), function (a) {
      var href = a.getAttribute('href') || '';
      var m = href.match(/doi\.org\/(10\.\d{4,9}\/[^\s"'<>?#]+)/i);
      if (!m) return;
      var title = elText(a);
      if (title.length < 8) {
        var container = a.closest('li, article, tr, div');
        var heading = container && container.querySelector('h1, h2, h3, h4, [class*="title" i]');
        if (heading) title = elText(heading);
      }
      add(m[1], title);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-doi]'), function (el) {
      var title = elText(el.querySelector('h1, h2, h3, h4, [class*="title" i]')) || el.getAttribute('data-title') || '';
      add(el.getAttribute('data-doi'), title);
    });
    return items.slice(0, 50);
  }

  async function extractAll() {
    if (isCnkiDetailPage()) {
      var cnki = cnkiDetailExtract();
      cnki = await cnkiExportEnrich(cnki);
      if (!cnki.title && !cnki.doi) {
        // 极端情况：页面结构不匹配，回退通用提取
        var generic = extractGeneric();
        generic.source = 'CNKI';
        return generic;
      }
      return cnki;
    }
    return extractGeneric();
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === 'litboard-extract') {
      extractAll().then(sendResponse, function () { sendResponse(extractGeneric()); });
      return true; // 异步响应
    }
    if (message.type === 'litboard-list-dois') {
      sendResponse({ items: collectDoiItems() });
      return false;
    }
  });
})();
