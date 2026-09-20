/* BibTeX 解析 / 生成（vendor parser 优先，旧容错 parser 兜底） */
(function (root, factory) {
  var vendor = null;
  if (typeof module === 'object' && module.exports) {
    try { vendor = require('../vendor/bibtex-parse.js'); } catch (e) {}
    module.exports = factory(vendor);
  } else {
    root.LitBib = factory(root['bibtex-parse']);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (vendorParser) {
  'use strict';

  // 常见 LaTeX 转义 → Unicode
  var ACCENTS = {
    "\\'a":'á',"\\'e":'é',"\\'i":'í',"\\'o":'ó',"\\'u":'ú',"\\'y":'ý',
    "\\'A":'Á',"\\'E":'É',"\\'I":'Í',"\\'O":'Ó',"\\'U":'Ú',
    '\\"a':'ä','\\"e':'ë','\\"i':'ï','\\"o':'ö','\\"u':'ü',
    '\\"A':'Ä','\\"O':'Ö','\\"U':'Ü',
    '\\`a':'à','\\`e':'è','\\`i':'ì','\\`o':'ò','\\`u':'ù',
    '\\^a':'â','\\^e':'ê','\\^i':'î','\\^o':'ô','\\^u':'û',
    '\\~n':'ñ','\\~a':'ã','\\~o':'õ',
    '\\c{c}':'ç','\\c{C}':'Ç','\\v{c}':'č','\\v{s}':'š','\\v{z}':'ž',
    '\\o':'ø','\\O':'Ø','\\aa':'å','\\AA':'Å','\\ae':'æ','\\ss':'ß',
    '\\&':'&','\\%':'%','\\$':'$','\\_':'_','\\#':'#',
    '---':'—','--':'–','~':' '
  };

  function cleanLatex(s) {
    if (!s) return '';
    var out = String(s);
    // \'{e} 形式归一为 \'e
    out = out.replace(/\\(['"`^~])\{(\w)\}/g, '\\$1$2');
    for (var k in ACCENTS) out = out.split(k).join(ACCENTS[k]);
    out = out.replace(/\\(text|math)?(bf|it|rm|sf|tt|emph)\b/g, '');
    out = out.replace(/[{}]/g, '');            // 去保护大括号
    out = out.replace(/\\[a-zA-Z]+\s*/g, ' '); // 残余命令
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }

  function skipBalanced(text, j, open, close) {
    var depth = 1;
    while (j < text.length && depth > 0) {
      if (text[j] === open) depth++;
      else if (text[j] === close) depth--;
      j++;
    }
    return j;
  }

  /** 旧容错 parser：vendor parser 失败时兜底，避免整个导入批次中断。 */
  function fallbackParseBibtex(text) {
    var entries = [];
    var n = text.length, i = 0;
    while (i < n) {
      var at = text.indexOf('@', i);
      if (at === -1) break;
      i = at + 1;
      var j = i;
      while (j < n && /[a-zA-Z]/.test(text[j])) j++;
      var type = text.slice(i, j).toLowerCase();
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] !== '{' && text[j] !== '(') { continue; }
      var open = text[j], close = open === '{' ? '}' : ')';
      j++;
      if (type === 'comment' || type === 'preamble' || type === 'string') {
        i = skipBalanced(text, j, open, close);
        continue;
      }
      // 引用 key
      var k = j;
      while (k < n && text[k] !== ',' && text[k] !== close) k++;
      var key = text.slice(j, k).trim();
      var fields = {};
      j = k;
      // depth0 恒为 1 的深度计数器已移除：close 即条目结束
      while (j < n) {
        var ch = text[j];
        if (ch === close) break;
        if (ch === ',' || /\s/.test(ch)) { j++; continue; }
        // 字段名
        var f = j;
        while (f < n && /[^=\s,})]/.test(text[f])) f++;
        var name = text.slice(j, f).toLowerCase().trim();
        while (f < n && /\s/.test(text[f])) f++;
        if (text[f] !== '=') { j = f + 1; continue; }
        f++;
        while (f < n && /\s/.test(text[f])) f++;
        var value = '';
        if (text[f] === '{') {
          f++;
          var start = f, d = 1;
          while (f < n && d > 0) {
            if (text[f] === '{') d++;
            else if (text[f] === '}') d--;
            if (d > 0) f++;
          }
          value = text.slice(start, f);
          f++;
        } else if (text[f] === '"') {
          f++;
          var start2 = f, d2 = 0;
          while (f < n && !(text[f] === '"' && d2 === 0)) {
            if (text[f] === '{') d2++;
            else if (text[f] === '}') d2--;
            f++;
          }
          value = text.slice(start2, f);
          f++;
        } else {
          var start3 = f;
          while (f < n && text[f] !== ',' && text[f] !== close && !/\s/.test(text[f])) f++;
          value = text.slice(start3, f);
        }
        if (name) fields[name] = value;
        j = f;
      }
      if (key || Object.keys(fields).length) {
        entries.push({ type: type, key: key, fields: fields });
      }
      i = j + 1;
    }
    return entries;
  }

  /** 解析 BibTeX 文本 → [{type, key, fields:{lowername: value}}] */
  function parseBibtex(text) {
    if (vendorParser && typeof vendorParser.entries === 'function') {
      try {
        return vendorParser.entries(String(text || '')).map(function (item) {
          var fields = {};
          Object.keys(item || {}).forEach(function (key) {
            if (key === 'key' || key === 'type') return;
            fields[key.toLowerCase()] = item[key] == null ? '' : String(item[key]);
          });
          return { type: String(item.type || 'article').toLowerCase(), key: item.key || '', fields: fields };
        });
      } catch (e) {}
    }
    return fallbackParseBibtex(String(text || ''));
  }

  /** "Last, First and Last2, First2" / "First Last and ..." → ["First Last", ...] */
  function parseAuthors(raw) {
    if (!raw) return [];
    return cleanLatex(raw).split(/\s+and\s+/i).map(function (a) {
      a = a.trim();
      var m = a.split(',');
      if (m.length === 2) return (m[1].trim() + ' ' + m[0].trim()).trim();
      return a;
    }).filter(Boolean);
  }

  function parseCreators(raw, creatorType) {
    if (!raw) return [];
    return cleanLatex(raw).split(/\s+and\s+/i).map(function (value) {
      value = value.trim();
      if (!value) return null;
      var parts = value.split(',');
      if (parts.length > 1) return { creatorType: creatorType, family: parts[0].trim(), given: parts.slice(1).join(',').trim(), name: '' };
      var tokens = value.split(/\s+/);
      if (tokens.length === 1) return { creatorType: creatorType, family: value, given: '', name: '' };
      return { creatorType: creatorType, family: tokens.pop(), given: tokens.join(' '), name: '' };
    }).filter(Boolean);
  }

  function parseFileAttachments(raw) {
    var list = [];
    String(raw || '').split(/\s*;\s*/).forEach(function (part) {
      var value = cleanLatex(part).trim();
      if (!/\.pdf(?:$|[:?#])/i.test(value)) return;
      var pdfMatch = value.match(/(?:^|:)((?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/])[^:;]*?\.pdf)(?=[:;]|$)/i) ||
        value.match(/(?:^|:)([^:;]*?\.pdf)(?=[:;]|$)/i);
      var filePath = pdfMatch ? pdfMatch[1].trim() : value.replace(/:PDF$/i, '').trim();
      filePath = filePath.replace(/^file:\/\//i, '').replace(/\\:/g, ':');
      if (!filePath || !/\.pdf$/i.test(filePath)) return;
      if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(filePath)) return;
      list.push({
        kind: 'pdf',
        fileName: filePath.split(/[\\/]/).pop(),
        path: filePath,
        fingerprint: '',
        cloudName: '',
        syncSignature: '',
        addedAt: Date.now()
      });
    });
    return list;
  }

  var MAPPED_FIELDS = {
    title: true, author: true, editor: true, year: true, date: true, journal: true, journaltitle: true,
    booktitle: true, doi: true, url: true, abstract: true, volume: true, number: true, issue: true,
    pages: true, publisher: true, issn: true, isbn: true, edition: true, language: true, file: true,
    urldate: true, accessdate: true, lastchecked: true, location: true, address: true, series: true
  };

  /** BibTeX 条目 → LitBoard 文献对象 */
  function entryToPaper(e) {
    var f = e.fields || {};
    var entryType = e.type || 'article';
    var date = cleanLatex(f.date || '');
    var year = parseInt(cleanLatex(f.year || date), 10);
    var doi = cleanLatex(f.doi || '').replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim();
    var venue = '';
    if (entryType === 'article') venue = cleanLatex(f.journal || f.journaltitle || '');
    else if (entryType === 'inproceedings' || entryType === 'incollection') venue = cleanLatex(f.booktitle || '');
    else if (entryType !== 'book') venue = cleanLatex(f.journal || f.journaltitle || f.booktitle || '');
    var extra = {};
    Object.keys(f).forEach(function (name) {
      if (!MAPPED_FIELDS[name] && f[name] != null && String(f[name]).trim()) extra[name] = cleanLatex(f[name]);
    });
    var creators = parseCreators(f.author, 'author').concat(parseCreators(f.editor, 'editor'));
    var parsedDate = /^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(date) ? date : '';
    if (date && !parsedDate) extra.date_raw = date;
    return {
      key: e.key || '',
      entryType: entryType,
      originalType: entryType,
      bibtexFlavor: f.journaltitle || f.date || f.urldate ? 'biblatex' : 'bibtex',
      title: cleanLatex(f.title || '') || '(无标题)',
      authors: parseAuthors(f.author),
      creators: creators,
      date: parsedDate || (year && !isNaN(year) ? String(year) : ''),
      accessDate: cleanLatex(f.urldate || f.accessdate || f.lastchecked || ''),
      year: isNaN(year) ? null : year,
      venue: venue,
      doi: doi,
      url: cleanLatex(f.url || ''),
      abstract: cleanLatex(f.abstract || ''),
      volume: cleanLatex(f.volume || ''),
      issue: cleanLatex(f.number || f.issue || ''),
      pages: cleanLatex(f.pages || ''),
      publisher: cleanLatex(f.publisher || ''),
      place: cleanLatex(f.location || f.address || ''),
      series: cleanLatex(f.series || ''),
      issn: cleanLatex(f.issn || ''),
      isbn: cleanLatex(f.isbn || ''),
      edition: cleanLatex(f.edition || ''),
      language: cleanLatex(f.language || ''),
      bibtexExtra: extra,
      attachments: parseFileAttachments(f.file)
    };
  }

  function bibEscape(s) { return String(s || '').replace(/[{}]/g, ''); }

  /** 文献对象 → BibTeX 文本 */
  function paperToBibtex(p, options) {
    var key = p.key || 'anonnodate';
    var entryType = p.entryType || 'article';
    var flavor = (options && options.flavor) || p.bibtexFlavor || 'bibtex';
    var lines = ['@' + entryType + '{' + key + ','];
    function add(name, v) { if (v) lines.push('  ' + name + ' = {' + bibEscape(v) + '},'); }
    add('title', p.title);
    var authorCreators = (p.creators || []).filter(function (c) { return c.creatorType === 'author'; });
    var editorCreators = (p.creators || []).filter(function (c) { return c.creatorType === 'editor'; });
    function creatorText(list, fallback) {
      return list.length ? list.map(function (c) { return c.name || (c.family + (c.given ? ', ' + c.given : '')); }).join(' and ') : fallback;
    }
    add('author', creatorText(authorCreators, (p.authors || []).join(' and ')));
    if (editorCreators.length) add('editor', creatorText(editorCreators, ''));
    if (p.date && p.date !== String(p.year || '')) add('date', p.date);
    else add('year', p.year);
    if (entryType === 'inproceedings' || entryType === 'incollection') add('booktitle', p.venue);
    else if (entryType !== 'book') add(flavor === 'biblatex' ? 'journaltitle' : 'journal', p.venue);
    add('volume', p.volume);
    add('number', p.issue);
    add('pages', p.pages);
    add('publisher', p.publisher);
    add(flavor === 'biblatex' ? 'location' : 'address', p.place);
    add('series', p.series);
    add('issn', p.issn);
    add('isbn', p.isbn);
    add('edition', p.edition);
    add('language', p.language);
    add('doi', p.doi);
    add('url', p.url);
    add('abstract', p.abstract);
    add(flavor === 'biblatex' ? 'urldate' : 'urldate', p.accessDate);
    Object.keys(p.bibtexExtra || {}).sort().forEach(function (name) {
      if (/^[a-z0-9_.:-]{1,80}$/i.test(name)) add(name, p.bibtexExtra[name]);
    });
    var out = lines.join('\n');
    return out.replace(/,\n?$/, '') + '\n}';
  }

  var LitBib = {
    parse: parseBibtex,
    entryToPaper: entryToPaper,
    paperToBibtex: paperToBibtex,
    cleanLatex: cleanLatex
  };
  return LitBib;
});
