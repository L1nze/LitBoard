/* LitBoard 网站 translators（阶段五切片）：专用站点解析 → 新数据模型（浏览器 / Node 共用）
 *
 * 设计：
 * - ctx 为「最小 DOM 抽象」，浏览器端由 content.js 用真实 DOM 装配，Node 测试用夹具对象；
 *   meta(name)/metas(name) 读 citation_* / dc / prism；jsonld() 返回解析后的 JSON-LD 数组；
 *   url()/text(sel) 辅助。
 * - 每个 translator：{ id, label, match(url), run(ctx) } → { item, attachments, snapshot, report }；
 *   item 为 addPapers/bridgeUpsertPaper 兼容的原始 paper 对象（多附件、sourceType 标识来源）。
 * - runTranslators(ctx)：专用命中优先；全部未命中返回 null（调用方走通用元数据兜底）。
 * - MV3 合规：全部为随版本发布的静态代码，不在线下载执行脚本。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitTranslators = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function firstNonEmpty(list) {
    for (var i = 0; i < list.length; i++) { var v = text(list[i]).trim(); if (v) return v; }
    return '';
  }
  function parseAuthors(value) {
    return text(value).split(/;\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function parseCnkiPublicationInfo(value) {
    var source = text(value).replace(/\s+/g, ' ').replace(/[。.]$/, '').trim();
    if (!source) return {};
    var yearMatch = /(?:^|\D)((?:19|20)\d{2})(?=\D|$)/.exec(source);
    if (!yearMatch) return { venue: source };
    var year = yearMatch[1];
    var yearIndex = yearMatch.index + yearMatch[0].indexOf(year);
    var venue = source.slice(0, yearIndex).replace(/[\s.,，。;；:：]+$/, '').replace(/^《|》$/g, '').trim();
    var tail = source.slice(yearIndex + year.length).replace(/^\s*[,，.。;；:]\s*/, '').trim();
    var volume = '', issue = '', pages = '';
    var volumeMatch = /^(\d+)(?:\s*[(（](\d+)[)）])?/.exec(tail);
    if (volumeMatch) {
      volume = volumeMatch[1];
      issue = volumeMatch[2] || '';
      tail = tail.slice(volumeMatch[0].length);
      var pageMatch = /[:：]\s*([\d\s,，-]+)/.exec(tail);
      if (pageMatch) pages = pageMatch[1].replace(/\s+/g, '').replace(/[，,]+$/, '');
    }
    return { venue: venue, year: year, volume: volume, issue: issue, pages: pages };
  }
  /** citation_* meta → item 基础（通用投影，专用 translator 在此基础上补特例）
   *  支持多值 meta（ctx.metas）：citation_author 逐作者、citation_keywords 逐关键词 */
  function itemFromMeta(ctx) {
    var m = function (name) { return ctx.meta(name); };
    var ms = function (name) {
      if (typeof ctx.metas === 'function') return ctx.metas(name) || [];
      var single = ctx.meta(name);
      return single ? [single] : [];
    };
    var authorList = ms('citation_author').length ? ms('citation_author')
      : ms('dc.Creator').length ? ms('dc.Creator') : parseAuthors(m('citation_author') || m('dc.Creator'));
    var item = {
      title: firstNonEmpty([m('citation_title'), m('dc.Title'), m('og:title')]),
      authors: authorList.map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 100),
      venue: firstNonEmpty([m('citation_journal_title'), m('citation_conference_title'), m('prism.publicationName')]),
      volume: m('citation_volume'), issue: m('citation_issue'),
      pages: firstNonEmpty([m('citation_firstpage') + (m('citation_lastpage') ? '-' + m('citation_lastpage') : ''), m('citation_pages')]),
      publisher: m('citation_publisher'),
      issn: m('citation_issn'), isbn: m('citation_isbn'),
      doi: (m('citation_doi') || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
      date: m('citation_date') || m('citation_publication_date') || m('prism.publicationDate') || '',
      language: m('citation_language') || '',
      abstract: m('citation_abstract') || m('dc.Description') || '',
      url: ctx.url(),
      entryType: 'article',
      attachments: [],
      tags: [],
      bibtexExtra: {}
    };
    var pdf = m('citation_pdf_url') || m('citation_fulltext_pdf_url');
    if (pdf) {
      item.attachments.push({ kind: 'pdf', fileName: decodeURIComponent((pdf.match(/\/([^/?]+\.pdf)(?:[?#]|$)/i) || [])[1] || 'paper.pdf'), path: '', url: pdf, source: 'page-link' });
    }
    // 关键词 → 标签（逐条 meta 优先，其次分隔符拆分）
    var keywords = ms('citation_keywords').concat(ms('dc.Subject'));
    if (!keywords.length && m('citation_keywords')) keywords = m('citation_keywords').split(/[,，;；]/);
    item.tags = keywords.map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 30);
    return item;
  }
  function arxivIdFromUrl(url) {
    var m = /arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i.exec(text(url));
    return m ? m[1].replace(/\.pdf$/i, '') : '';
  }

  var translators = [
    {
      id: 'arxiv',
      label: 'arXiv',
      match: function (url) { return /(^|\.)arxiv\.org$/.test(new URL(text(url)).hostname); },
      run: function (ctx) {
        var item = itemFromMeta(ctx);
        var id = arxivIdFromUrl(ctx.url());
        if (!id) return null;
        item.entryType = 'preprint';
        item.sourceType = 'translator:arxiv';
        item.bibtexExtra.eprint = id.split('v')[0];
        item.bibtexExtra.eprinttype = 'arxiv';
        if (!item.date) {
          var m = /\[(\d{4})\.(\d{2})/.exec(ctx.text('.dateline') || ctx.text('div.dateline') || '');
          if (m) item.date = m[1] + '-' + m[2];
        }
        var absUrl = 'https://arxiv.org/abs/' + id;
        if (item.url !== absUrl) item.url = absUrl;
        if (!item.attachments.length) {
          item.attachments.push({ kind: 'pdf', fileName: id + '.pdf', path: '', url: 'https://arxiv.org/pdf/' + id, source: 'oa-url' });
        }
        return { item: item, attachments: item.attachments, snapshot: false, report: { translator: 'arxiv' } };
      }
    },
    {
      id: 'pubmed',
      label: 'PubMed',
      match: function (url) { return /(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$/.test(new URL(text(url)).hostname); },
      run: function (ctx) {
        var item = itemFromMeta(ctx);
        var pmid = (ctx.url().match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/) || [])[1] || ctx.meta('citation_pmid');
        if (!pmid) return null;
        item.sourceType = 'translator:pubmed';
        item.bibtexExtra.pmid = pmid;
        var pmcid = text(ctx.text('.pmc-link') || '').match(/PMC\d+/) || text(ctx.url()).match(/PMC\d+/);
        if (pmcid) item.bibtexExtra.pmcid = pmcid[0];
        if (!item.doi) {
          var doiInPage = text(ctx.text('.citation-doi') || '').match(/10\.\d{4,9}\/\S+/);
          if (doiInPage) item.doi = doiInPage[0];
        }
        return { item: item, attachments: item.attachments, snapshot: false, report: { translator: 'pubmed' } };
      }
    },
    {
      id: 'cnki',
      label: 'CNKI',
      match: function (url) { return /(^|\.)cnki\.net$/.test(new URL(text(url)).hostname.replace(/^www\./, '')); },
      run: function (ctx) {
        var item = itemFromMeta(ctx);
        if (!item.title) item.title = firstNonEmpty([ctx.meta('dc.title'), ctx.text('h1')]);
        if (!item.title) return null;
        item.sourceType = 'translator:cnki';
        // CNKI 中文文献：作者 meta 可能为整体字符串，按中文分号/空格粗切
        if (item.authors.length === 1 && /[;；]/.test(ctx.meta('citation_author'))) {
          item.authors = ctx.meta('citation_author').split(/[;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
        }
        var publicationInfo = parseCnkiPublicationInfo(ctx.text('.top-tip'));
        if (!item.venue) item.venue = firstNonEmpty([ctx.meta('dc.source'), publicationInfo.venue, ctx.text('.top-tip')]);
        if (!item.date && publicationInfo.year) item.date = publicationInfo.year;
        if (!item.volume && publicationInfo.volume) item.volume = publicationInfo.volume;
        if (!item.issue && publicationInfo.issue) item.issue = publicationInfo.issue;
        if (!item.pages && publicationInfo.pages) item.pages = publicationInfo.pages;
        var dbcode = (ctx.url().match(/[?&]dbcode=(\w+)/) || [])[1];
        if (dbcode) item.bibtexExtra.dbcode = dbcode;
        return { item: item, attachments: item.attachments, snapshot: false, report: { translator: 'cnki' } };
      }
    },
    {
      id: 'google-scholar',
      label: 'Google Scholar',
      match: function (url) {
        var host = new URL(text(url)).hostname;
        return /(^|\.)scholar\.google\./.test(host);
      },
      run: function (ctx) {
        var item = itemFromMeta(ctx);
        if (!item.title) return { item: null, attachments: [], snapshot: false, report: { translator: 'google-scholar', failed: true, reason: 'no-meta' } };
        item.sourceType = 'translator:google-scholar';
        // GS 的 PDF 链接（右侧 [PDF]）常无 citation_pdf_url，ctx.text 兜底由 content.js 提供
        if (!item.attachments.length) {
          var pdfHref = ctx.attr ? ctx.attr('a[href*="pdf"]', 'href') : '';
          if (pdfHref) {
            item.attachments.push({ kind: 'pdf', fileName: 'scholar.pdf', path: '', url: pdfHref, source: 'page-link' });
          }
        }
        return { item: item, attachments: item.attachments, snapshot: false, report: { translator: 'google-scholar' } };
      }
    },
    {
      // 通用出版商层：ScienceDirect / SpringerLink / Wiley / T&F / ACS / IEEE / ACM / PLOS /
      // Frontiers / Oxford / Cambridge / Nature / Science / bioRxiv / medRxiv —— 均以 citation_* 方言为主，
      // 特例由后续站点 translator 覆盖（本层放最后，兜底专用）。
      id: 'publisher',
      label: T('出版商通用'),
      match: function (url) {
        var host = new URL(text(url)).hostname.replace(/^www\./, '');
        return /(sciencedirect\.com|springer\.com|link\.springer|wiley\.com|onlinelibrary\.wiley|tandfonline\.com|acs\.org|ieee\.org|computer\.org|acm\.org|plos\.org|frontiersin\.org|oup\.com|oxfordacademic\.com|cambridge\.org|nature\.com|science\.org|biorxiv\.org|medrxiv\.org)$/.test(host);
      },
      run: function (ctx) {
        var item = itemFromMeta(ctx);
        if (!item.title) return { item: null, attachments: [], snapshot: false, report: { translator: 'publisher', failed: true, reason: 'no-meta' } };
        item.sourceType = 'translator:publisher';
        // IEEE/ACM 等会议条目：conference 优先于 journal
        var confTitle = ctx.meta('citation_conference_title');
        if (confTitle && !item.venue) item.venue = confTitle;
        if (confTitle) item.entryType = 'inproceedings';
        if (/biorxiv\.org|medrxiv\.org$/.test(new URL(ctx.url()).hostname.replace(/^www\./, ''))) {
          item.entryType = 'preprint';
          item.bibtexExtra.server = new URL(ctx.url()).hostname.indexOf('medrxiv') !== -1 ? 'medRxiv' : 'bioRxiv';
        }
        return { item: item, attachments: item.attachments, snapshot: false, report: { translator: 'publisher' } };
      }
    }
  ];

  function runTranslators(ctx) {
    var url = ctx.url();
    for (var i = 0; i < translators.length; i++) {
      var t = translators[i];
      var matched = false;
      try { matched = t.match(url); } catch (e) { matched = false; }
      if (!matched) continue;
      var result = null;
      try { result = t.run(ctx); } catch (e) { result = null; }
      if (result && result.item && result.item.title) {
        result.report = result.report || {};
        result.report.translator = t.id;
        return result;
      }
      // 专用 translator 命中但解析失败 → 交由调用方按失败原因展示并走兜底
      return { item: null, attachments: [], snapshot: false,
        report: { translator: t.id, failed: true, reason: result && result.report && result.report.reason || 'parse-failed' } };
    }
    return null;
  }

  return { translators: translators, runTranslators: runTranslators, itemFromMeta: itemFromMeta,
    parseCnkiPublicationInfo: parseCnkiPublicationInfo };
});
