/* LitBoard CSL-JSON 导入映射（Zotero / Better BibTeX / citeproc 生态互通；浏览器 / Node 共用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitCslJson = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var TYPE_MAP = {
    'article-journal': 'article', 'article-magazine': 'article', 'paper-conference': 'inproceedings',
    book: 'book', chapter: 'incollection', thesis: 'phdthesis', report: 'report',
    'article-newspaper': 'newspaper', webpage: 'webpage', post: 'webpage', 'post-weblog': 'webpage',
    patent: 'patent', manuscript: 'preprint', article: 'preprint'
  };
  var REVERSE_TYPE_MAP = {
    article: 'article-journal', inproceedings: 'paper-conference', book: 'book',
    incollection: 'chapter', phdthesis: 'thesis', mastersthesis: 'thesis', report: 'report',
    newspaper: 'article-newspaper', webpage: 'webpage', preprint: 'manuscript', patent: 'patent', misc: 'article'
  };

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  /** 判断一个 JSON 值是否像 CSL-JSON（区别于 LitBoard 备份 {papers:[...]}） */
  function looksLikeCslJson(value) {
    var item = Array.isArray(value) ? value[0] : value;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (item.papers || item.schemaVersion) return false;
    return typeof item.type === 'string' && (item.title != null || item.author != null || item.DOI != null || item.id != null);
  }

  function authorName(author) {
    if (!author || typeof author !== 'object') return '';
    if (author.literal) return text(author.literal).trim();
    var family = text(author.family).trim();
    var given = text(author.given).trim();
    return (given + ' ' + family).trim() || family;
  }

  function creatorFromCsl(author, creatorType) {
    if (!author || typeof author !== 'object') return null;
    if (author.literal) return { creatorType: creatorType, family: '', given: '', name: text(author.literal).trim() };
    return { creatorType: creatorType, family: text(author.family).trim(), given: text(author.given).trim(), name: '' };
  }

  function dateParts(value) {
    var parts = value && value['date-parts'] && value['date-parts'][0];
    return Array.isArray(parts) && parts.length && parts[0] ? parts : null;
  }

  function dateText(value) {
    var parts = dateParts(value);
    if (!parts) return '';
    return parts.map(function (part) { return String(part).padStart(2, '0'); }).join('-');
  }

  function cslToPaper(item) {
    var raw = item && typeof item === 'object' ? item : {};
    var entryType = TYPE_MAP[text(raw.type)] || 'misc';
    var dateParts = raw.issued && raw.issued['date-parts'] && raw.issued['date-parts'][0];
    var year = Array.isArray(dateParts) && dateParts[0] ? Number(dateParts[0]) : null;
    var authors = (Array.isArray(raw.author) ? raw.author : []).map(authorName).filter(Boolean);
    var creators = [];
    (Array.isArray(raw.author) ? raw.author : []).forEach(function (author) {
      var creator = creatorFromCsl(author, 'author');
      if (creator && (creator.name || creator.family || creator.given)) creators.push(creator);
    });
    (Array.isArray(raw.editor) ? raw.editor : []).forEach(function (author) {
      var creator = creatorFromCsl(author, 'editor');
      if (creator && (creator.name || creator.family || creator.given)) creators.push(creator);
    });
    (Array.isArray(raw.translator) ? raw.translator : []).forEach(function (author) {
      var creator = creatorFromCsl(author, 'translator');
      if (creator && (creator.name || creator.family || creator.given)) creators.push(creator);
    });
    var issn = Array.isArray(raw.ISSN) ? raw.ISSN[0] : raw.ISSN;
    var isbn = Array.isArray(raw.ISBN) ? raw.ISBN[0] : raw.ISBN;
    return {
      key: text(raw.id).replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 120),
      entryType: entryType,
      originalType: text(raw.type),
      title: text(raw.title).trim() || '(无标题)',
      creators: creators,
      authors: authors,
      date: dateText(raw.issued),
      accessDate: dateText(raw.accessed),
      year: Number.isFinite(year) ? year : null,
      venue: text(raw['container-title']) || text(raw['event-title']) || text(raw.publisher),
      volume: text(raw.volume),
      issue: text(raw.issue),
      pages: text(raw.page),
      publisher: text(raw.publisher),
      issn: text(issn),
      isbn: text(isbn),
      edition: text(raw.edition),
      language: text(raw.language),
      doi: text(raw.DOI).replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim(),
      url: text(raw.URL),
      abstract: text(raw.abstract),
      sourceType: TYPE_MAP[text(raw.type)] ? '' : text(raw.type)
    };
  }

  /** 解析 CSL-JSON（单条对象或数组）→ 文献对象数组；不像 CSL-JSON 时返回 [] */
  function parsePapers(value) {
    if (!looksLikeCslJson(value)) return [];
    var list = Array.isArray(value) ? value : [value];
    return list.map(cslToPaper).filter(function (paper) {
      return paper.title !== '(无标题)' || paper.authors.length || paper.doi;
    });
  }

  function paperToCslJson(paper) {
    var p = paper || {};
    var out = {
      id: text(p.key || p.id),
      type: text(p.originalType || p.cslType || REVERSE_TYPE_MAP[p.entryType] || 'article'),
      title: text(p.title), volume: text(p.volume), issue: text(p.issue), page: text(p.pages),
      publisher: text(p.publisher), edition: text(p.edition), language: text(p.language)
    };
    if (p.doi) out.DOI = text(p.doi);
    if (p.url) out.URL = text(p.url);
    if (p.abstract) out.abstract = text(p.abstract);
    if (p.venue) out['container-title'] = text(p.venue);
    if (p.place) out['publisher-place'] = text(p.place);
    if (p.series) out['collection-title'] = text(p.series);
    if (p.journalAbbreviation) out['container-title-short'] = text(p.journalAbbreviation);
    function addCreators(role, field) {
      var list = (p.creators || []).filter(function (creator) { return creator.creatorType === role; }).map(function (creator) {
        return creator.name ? { literal: creator.name } : { family: creator.family || '', given: creator.given || '' };
      }).filter(function (creator) { return creator.literal || creator.family || creator.given; });
      if (list.length) out[field] = list;
    }
    addCreators('author', 'author'); addCreators('editor', 'editor'); addCreators('translator', 'translator');
    if (!out.author && Array.isArray(p.authors) && p.authors.length) {
      out.author = p.authors.map(function (name) {
        var parts = text(name).split(',');
        return parts.length > 1 ? { family: parts[0].trim(), given: parts.slice(1).join(',').trim() } : { literal: text(name) };
      });
    }
    function toDate(value) {
      var parts = text(value).split('-').map(Number);
      return parts.length && parts[0] ? parts : null;
    }
    var issued = toDate(p.date || (p.year == null ? '' : String(p.year)));
    var accessed = toDate(p.accessDate);
    if (issued) out.issued = { 'date-parts': [issued] };
    if (accessed) out.accessed = { 'date-parts': [accessed] };
    return out;
  }

  function exportCslJson(papers) {
    return (Array.isArray(papers) ? papers : [papers]).filter(Boolean).map(paperToCslJson);
  }

  return { looksLikeCslJson: looksLikeCslJson, cslToPaper: cslToPaper, parsePapers: parsePapers,
    paperToCslJson: paperToCslJson, exportCslJson: exportCslJson };
});
