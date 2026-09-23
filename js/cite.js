/* LitBoard 引用：RIS 导出 + splitName + 样式元数据；样式渲染统一走 citeproc（js/cslcite.js） */
(function (root, factory) {
  var csl = null;
  if (typeof module === 'object' && module.exports) {
    try { csl = require('./cslcite.js'); } catch (e) { /* 浏览器端经 window.LitCsl 取 */ }
  }
  var api = factory(csl);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitCite = api;
})(typeof window !== 'undefined' ? window : null, function (nodeCsl) {
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

  // ---------- 样式渲染（统一走 citeproc：js/cslcite.js + vendor 样式）----------
  var FORMATS = [
    { key: 'apa', label: 'APA (7th)', styleId: 'apa' },
    { key: 'gbt7714', label: 'GB/T 7714-2015（国标）', styleId: 'china-national-standard-gb-t-7714-2015-numeric' },
    { key: 'mla', label: 'MLA (9th)', styleId: 'modern-language-association' }
  ];

  function cslApi() {
    return nodeCsl || (typeof window !== 'undefined' ? window.LitCsl : null);
  }

  /**
   * 用内置 CSL 样式渲染单条文献 → Promise<纯文本>（locale 恒 zh-CN，引擎唯一语言环境）。
   * citeproc 输出是 HTML，经 htmlToRuns 拼纯文本：<sup>/<i> 是 run 上的格式标志，
   * 不会留下字面标签；编号与正文之间的制表位（second-field-align）还原为 \t。
   */
  function renderFormat(styleId, paper) {
    var csl = cslApi();
    if (!csl) return Promise.reject(new Error('citeproc 不可用'));
    var rendered;
    if (typeof window === 'undefined') {
      var fs = require('node:fs');
      var path = require('node:path');
      var base = path.join(__dirname, '..', 'vendor', 'citeproc');
      var styleXml = fs.readFileSync(path.join(base, 'styles', styleId + '.csl'), 'utf8');
      var localeXml = fs.readFileSync(path.join(base, 'locales', 'zh-CN.xml'), 'utf8');
      rendered = csl.renderBibliography([paper], styleXml, localeXml);
    } else {
      rendered = csl.renderWithBuiltinStyle([paper], styleId);
    }
    return rendered.then(function (htmlList) {
      return csl.htmlToRuns(htmlList && htmlList[0] || '').map(function (run) {
        if (run.tab) return '\t';
        if (run.br) return '\n';
        return run.text || '';
      }).join('');
    });
  }

  return {
    ris: ris, risEntry: risEntry,
    formats: FORMATS,
    renderFormat: renderFormat,
    _splitName: splitName
  };
});
