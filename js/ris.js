/* LitBoard RIS 导入解析（Zotero / EndNote / Mendeley 互通；浏览器 / Node 共用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitRis = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var TY_MAP = {
    JOUR: 'article', MGZN: 'article', CONF: 'inproceedings', CPAPER: 'inproceedings',
    BOOK: 'book', CHAP: 'incollection', THES: 'phdthesis', RPRT: 'report',
    NEWS: 'newspaper', ELEC: 'webpage', PAT: 'patent', GEN: 'misc'
  };
  var BOOK_TYPES = { book: true, incollection: true };

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  /** "Family, Given" / "Given Family" → 统一 "Given Family"（与 bibtex.parseAuthors 一致） */
  function normalizeAuthor(name) {
    var value = text(name).trim();
    if (!value) return '';
    var parts = value.split(',');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return (parts[1].trim() + ' ' + parts[0].trim()).trim();
    }
    return value;
  }

  function creatorFromRis(name, creatorType) {
    var value = normalizeAuthor(name);
    var parts = value.split(/\s+/);
    return value ? { creatorType: creatorType, family: parts.pop() || '', given: parts.join(' '), name: '' } : null;
  }

  /**
   * 解析 RIS 文本 → 条目数组 [{ type, fields: { TAG: [values] } }]
   * 宽容处理：忽略 BOM、接受 continuation 行（非 TAG 起始行并入上一个字段）。
   */
  function parse(input) {
    var entries = [];
    var current = null;
    var lastTag = '';
    String(input || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach(function (line) {
      var m = line.match(/^([A-Z][A-Z0-9]) {2}- ?(.*)$/);
      if (!m) {
        if (current && lastTag && line.trim()) {
          var values = current.fields[lastTag];
          values[values.length - 1] += ' ' + line.trim();
        }
        return;
      }
      var tag = m[1], value = m[2].trim();
      if (tag === 'TY') {
        current = { type: value, fields: {} };
        lastTag = '';
        return;
      }
      if (!current) return;
      if (tag === 'ER') {
        entries.push(current);
        current = null;
        lastTag = '';
        return;
      }
      (current.fields[tag] = current.fields[tag] || []).push(value);
      lastTag = tag;
    });
    if (current) entries.push(current); // 文件末尾缺 ER 的容错
    return entries;
  }

  function first(fields, tag) {
    var values = fields[tag];
    return values && values.length ? values[0] : '';
  }

  /** RIS 条目 → LitBoard 文献对象（交给 LitModel.normalizePaper 收尾） */
  function entryToPaper(entry) {
    var fields = entry.fields || {};
    var entryType = TY_MAP[String(entry.type || '').toUpperCase()] || 'misc';
    var rawDate = first(fields, 'DA') || first(fields, 'Y1') || first(fields, 'PY');
    var dateMatch = rawDate.match(/^(\d{4})(?:[-/]?(\d{2}))?(?:[-/]?(\d{2}))?/);
    var date = dateMatch ? dateMatch[1] + (dateMatch[2] ? '-' + dateMatch[2] : '') + (dateMatch[3] ? '-' + dateMatch[3] : '') : '';
    var yearMatch = rawDate.match(/(\d{4})/);
    var sp = first(fields, 'SP'), ep = first(fields, 'EP');
    var authors = (fields.AU || fields.A1 || []).map(normalizeAuthor).filter(Boolean);
    var creators = (fields.AU || fields.A1 || []).map(function (name) { return creatorFromRis(name, 'author'); }).filter(Boolean)
      .concat((fields.A2 || fields.ED || []).map(function (name) { return creatorFromRis(name, 'editor'); }).filter(Boolean));
    var sn = first(fields, 'SN');
    var paper = {
      entryType: entryType,
      originalType: text(entry.type || ''),
      title: first(fields, 'TI') || first(fields, 'T1') || first(fields, 'CT') || '(无标题)',
      authors: authors,
      creators: creators,
      date: date,
      accessDate: first(fields, 'Y2') || first(fields, 'AD'),
      year: yearMatch ? Number(yearMatch[1]) : null,
      venue: first(fields, 'JO') || first(fields, 'JA') || first(fields, 'JF') || first(fields, 'T2') || first(fields, 'J1'),
      volume: first(fields, 'VL'),
      issue: first(fields, 'IS'),
      pages: sp && ep ? sp + '-' + ep : (sp || ep),
      publisher: first(fields, 'PB'),
      place: first(fields, 'CY'),
      series: first(fields, 'T3'),
      doi: first(fields, 'DO').replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim(),
      url: first(fields, 'UR'),
      abstract: first(fields, 'AB') || first(fields, 'N2'),
      language: first(fields, 'LA'),
      edition: first(fields, 'ET'),
      tags: (fields.KW || []).map(function (tag) { return text(tag).trim(); }).filter(Boolean),
      notes: (fields.N1 || []).join('\n\n'),
      bibtexExtra: rawDate && !date ? { date_raw: rawDate } : {}
    };
    if (sn) {
      if (BOOK_TYPES[entryType] || /^97[89]/.test(sn.replace(/[-\s]/g, ''))) paper.isbn = sn;
      else paper.issn = sn;
    }
    return paper;
  }

  function parsePapers(input) {
    return parse(input).map(entryToPaper).filter(function (paper) {
      return paper.title && paper.title !== '(无标题)' || paper.authors.length || paper.doi;
    });
  }

  function risType(paper) {
    var type = paper && paper.entryType;
    var map = { article: 'JOUR', inproceedings: 'CONF', incollection: 'CHAP', book: 'BOOK',
      phdthesis: 'THES', mastersthesis: 'THES', report: 'RPRT', newspaper: 'NEWS',
      webpage: 'ELEC', patent: 'PAT', misc: 'GEN' };
    return map[type] || 'GEN';
  }

  function paperToRisReport(paper) {
    var p = paper || {}, lines = ['TY  - ' + risType(p)], omitted = [];
    function add(tag, value) { if (value != null && String(value) !== '') lines.push(tag + '  - ' + String(value).replace(/\r?\n/g, ' ')); }
    add('ID', p.key || p.id); add('TI', p.title);
    var authors = (p.creators || []).filter(function (c) { return c.creatorType === 'author'; });
    if (!authors.length) authors = (p.authors || []).map(function (name) { return { name: name }; });
    authors.forEach(function (creator) { add('AU', creator.name || (creator.family + (creator.given ? ', ' + creator.given : ''))); });
    (p.creators || []).filter(function (c) { return c.creatorType === 'editor'; }).forEach(function (creator) {
      add('A2', creator.name || (creator.family + (creator.given ? ', ' + creator.given : '')));
    });
    add('DA', p.date || (p.year == null ? '' : String(p.year)));
    add('Y2', p.accessDate); add('JO', p.venue); add('VL', p.volume); add('IS', p.issue);
    var page = String(p.pages || '');
    if (page) {
      var range = page.split(/\s*[-–]\s*/); add('SP', range[0]); if (range[1]) add('EP', range[1]);
    }
    add('PB', p.publisher); add('CY', p.place); add('T3', p.series); add('SN', p.isbn || p.issn);
    add('DO', p.doi); add('UR', p.url); add('AB', p.abstract);
    (p.tags || []).forEach(function (tag) { add('KW', tag); });
    add('N1', p.notes);
    if (p.journalAbbreviation) omitted.push('journalAbbreviation');
    if (p.bibtexExtra && Object.keys(p.bibtexExtra).length) omitted.push('bibtexExtra');
    lines.push('ER  -');
    return { text: lines.join('\n') + '\n', omitted: omitted };
  }

  function paperToRis(paper) { return paperToRisReport(paper).text; }

  return { parse: parse, entryToPaper: entryToPaper, parsePapers: parsePapers,
    paperToRis: paperToRis, paperToRisReport: paperToRisReport };
});
