/* LitBoard 引用生成：APA / GB/T 7714 / MLA 引文字符串 + RIS 导出（浏览器 / Node 共用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitCite = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;

  /** "First Middle Last" → {family, given}；中文名与单字段名整体保留 */
  function splitName(name) {
    var raw = String(name || '').trim();
    var isCJK = CJK.test(raw);
    if (isCJK) return { raw: raw, family: raw, given: '', isCJK: true };
    // "Last, First" 形式
    if (raw.indexOf(',') !== -1) {
      var seg = raw.split(',');
      return { raw: raw, family: seg[0].trim(), given: (seg[1] || '').trim(), isCJK: false };
    }
    var parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return { raw: raw, family: raw, given: '', isCJK: false };
    var family = parts.pop();
    return { raw: raw, family: family, given: parts.join(' '), isCJK: false };
  }

  function initials(given, opts) {
    opts = opts || {};
    var toks = String(given || '').split(/[\s.-]+/).filter(Boolean);
    return toks.map(function (t) {
      return t.charAt(0).toUpperCase() + (opts.dot ? '.' : '');
    }).join(opts.space ? ' ' : '');
  }

  function tidy(s) { return String(s).replace(/\s+/g, ' ').replace(/\s+([,.\]])/g, '$1').trim(); }

  function firstIsCJK(authors) {
    return !!(authors && authors.length && splitName(authors[0]).isCJK);
  }

  // ---------- APA 7 ----------
  function apaAuthor(name) {
    var n = splitName(name);
    if (n.isCJK || !n.given) return n.raw;
    return n.family + ', ' + initials(n.given, { dot: true, space: true });
  }
  function joinApa(list) {
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    return list.slice(0, -1).join(', ') + ', & ' + list[list.length - 1];
  }
  function apa(p) {
    var s = joinApa((p.authors || []).map(apaAuthor));
    if (s) s += ' ';
    s += '(' + (p.year != null ? p.year : 'n.d.') + '). ';
    if (p.title) s += p.title + (/[.?!]$/.test(p.title) ? ' ' : '. ');
    if (p.venue) {
      s += p.venue;
      if (p.volume) s += ', ' + p.volume;
      if (p.pages) s += ', ' + p.pages;
      s += '.';
    }
    if (p.doi) s += ' https://doi.org/' + p.doi;
    return tidy(s);
  }

  // ---------- GB/T 7714-2015（顺序编码，期刊）----------
  var GB_TYPE = {
    article: 'J', inproceedings: 'C', incollection: 'C', proceedings: 'C',
    book: 'M', inbook: 'M', phdthesis: 'D', mastersthesis: 'D',
    techreport: 'R', misc: 'EB', online: 'EB'
  };
  function gbAuthor(name) {
    var n = splitName(name);
    if (n.isCJK || !n.given) return n.raw;
    return n.family + ' ' + initials(n.given, { dot: false, space: false }).toUpperCase();
  }
  function gbt7714(p) {
    var authors = (p.authors || []).map(gbAuthor);
    var etal = firstIsCJK(p.authors) ? ', 等' : ', et al';
    var au = authors.length > 3 ? authors.slice(0, 3).join(', ') + etal : authors.join(', ');
    var type = GB_TYPE[p.entryType] || 'J';
    var s = '';
    if (au) s += au + '. ';
    s += (p.title || '') + '[' + type + ']. ';
    if (p.venue) s += p.venue + ', ';
    s += (p.year != null ? p.year : '');
    if (p.volume) s += ', ' + p.volume;
    if (p.pages) s += ': ' + p.pages;
    s += '.';
    return tidy(s);
  }

  // ---------- MLA 9 ----------
  function mlaAuthor(name) {
    var n = splitName(name);
    if (n.isCJK || !n.given) return n.raw;
    return n.family + ', ' + n.given;
  }
  function mla(p) {
    var a = p.authors || [];
    var au = '';
    if (a.length === 1) au = mlaAuthor(a[0]);
    else if (a.length === 2) au = mlaAuthor(a[0]) + ', and ' + mlaAuthor(a[1]);
    else if (a.length > 2) au = mlaAuthor(a[0]) + ', et al';
    var s = '';
    if (au) s += au + '. ';
    if (p.title) s += '“' + p.title + '.” ';
    if (p.venue) s += p.venue + ', ';
    if (p.volume) s += 'vol. ' + p.volume + ', ';
    if (p.year != null) s += p.year + ', ';
    if (p.pages) s += 'pp. ' + p.pages + ', ';
    return tidy(s).replace(/,$/, '.');
  }

  // ---------- RIS（Zotero / EndNote 互通）----------
  var RIS_TY = {
    article: 'JOUR', inproceedings: 'CONF', proceedings: 'CONF', incollection: 'CHAP',
    inbook: 'CHAP', book: 'BOOK', phdthesis: 'THES', mastersthesis: 'THES',
    techreport: 'RPRT', online: 'ELEC', misc: 'GEN'
  };
  function risAuthor(name) {
    var n = splitName(name);
    if (n.isCJK || !n.given) return n.raw;
    return n.family + ', ' + n.given;
  }
  function risEntry(p) {
    var L = [];
    L.push('TY  - ' + (RIS_TY[p.entryType] || 'GEN'));
    (p.authors || []).forEach(function (a) { if (a) L.push('AU  - ' + risAuthor(a)); });
    if (p.title) L.push('TI  - ' + p.title);
    if (p.year != null) L.push('PY  - ' + p.year);
    if (p.venue) L.push((p.entryType === 'inproceedings' || p.entryType === 'incollection' ? 'T2  - ' : 'JO  - ') + p.venue);
    if (p.volume) L.push('VL  - ' + p.volume);
    if (p.pages) {
      var m = String(p.pages).split(/\s*[-–—]+\s*/);
      L.push('SP  - ' + m[0].trim());
      if (m[1]) L.push('EP  - ' + m[1].trim());
    }
    if (p.doi) L.push('DO  - ' + p.doi);
    if (p.url) L.push('UR  - ' + p.url);
    if (p.abstract) L.push('AB  - ' + String(p.abstract).replace(/\r?\n/g, ' '));
    (p.tags || []).forEach(function (t) { if (t) L.push('KW  - ' + t); });
    L.push('ER  - ');
    return L.join('\r\n');
  }
  function ris(papers) {
    var list = Array.isArray(papers) ? papers : [papers];
    return list.map(risEntry).join('\r\n\r\n') + '\r\n';
  }

  var FORMATS = [
    { key: 'apa', label: 'APA (7th)', fn: apa },
    { key: 'gbt7714', label: 'GB/T 7714-2015（国标）', fn: gbt7714 },
    { key: 'mla', label: 'MLA (9th)', fn: mla }
  ];

  return {
    apa: apa, gbt7714: gbt7714, mla: mla,
    ris: ris, risEntry: risEntry,
    formats: FORMATS,
    _splitName: splitName
  };
});
