/* LitBoard CSL 引用引擎：paper → CSL-JSON 映射 + citeproc 渲染（浏览器 / Node 共用）
 *
 * citeproc-js 以 CommonJS 形式 vendor 在 vendor/citeproc/citeproc.js：
 * 浏览器端经 window.module 垫片以经典 script 加载；Node 端直接 require。
 */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('../vendor/citeproc/citeproc.js') : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitCsl = api;
})(typeof window !== 'undefined' ? window : null, function (nodeCSL) {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  var CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
  /* GB/T 7714 双语惯例：中文文献用「等」、西文文献用「et al.」。citeproc 的术语取自
   * 引擎唯一 locale（我们默认 zh-CN），没有按条目切换的机制，因此在渲染出口修正：
   * 条目中除「等」外不含任何 CJK 字符 → 视为西文条目，把「等」替换为 et al.。
   * 只动「等」一个词，对任意样式安全（「等」只会来自 et-al 术语）。 */
  function fixLatinEtAl(value) {
    var t = text(value);
    if (!t) return t;
    if (CJK_CHAR.test(t.replace(/等/g, ''))) return t;
    // 「等」后紧跟样式自带分隔句点时换成不带点的 et al，避免出现 et al.. 双句点；
    // zh-CN 术语紧贴西文名（Vaswani等 → Vaswaniet al.），前置字符非空白时补一个空格
    return t.replace(/等/g, function (mark, offset, s) {
      var prev = offset > 0 ? s.charAt(offset - 1) : '';
      var al = s.charAt(offset + 1) === '.' ? 'et al' : 'et al.';
      return prev && !/\s/.test(prev) ? ' ' + al : al;
    });
  }

  /* ---------------- HTML → 富文本（写进 Word 用） ----------------
   * Word 的 Range.Text 只认纯文本：把 citeproc 的 HTML 直接塞进域结果，<sup>[1-3]</sup>
   * 会原样印在文档里（真机复现过）。两条出口都在这套词法之上：
   * - htmlToRtf  → RTF 文本，交给桥落临时 .rtf 再用 Range.InsertFile 读进域结果
   * - htmlToRuns → docx run 数组，交给 js/docx.js 生成带 w:vertAlign / w:i 的 run
   * 转换规则与 citeproc 自己的 rtf 输出对齐：
   * - 非 ASCII 一律转 \uc0\uNNNN{}（RTF 出口）；文件按 ASCII 落盘，中文才不会乱码
   * - RTF 特殊字符 \ { } 转义；docx 出口按 XML 转义（由 docx.js 负责）
   * - <i>/<em>、<b>/<strong>、<sup>、<sub>、small-caps 的 span、<br>
   * - second-field-align：编号 div 与正文 div 之间补一个制表位，配合段落制表位对齐
   *   （对应 citeproc rtf 输出的 "[1]\tab "）
   */
  var HTML_FORMAT_FLAGS = {
    i: 'italic', em: 'italic', b: 'bold', strong: 'bold',
    sup: 'sup', sub: 'sub', sc: 'smallCaps', smallcaps: 'smallCaps'
  };
  // 片段上可能出现的格式标志（键名即 run 的属性名）；RTF 出口按它为每个标志取控制字
  var FORMAT_FLAG_NAMES = ['bold', 'italic', 'smallCaps', 'sup', 'sub'];
  var RTF_FLAG_CONTROLS = {
    italic: '\\i ', bold: '\\b ', sup: '\\super ', sub: '\\sub ', smallCaps: '\\scaps '
  };
  var RTF_NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function decodeHtmlEntities(value) {
    var t = text(value);
    if (t.indexOf('&') === -1) return t;
    return t.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (mark, body) {
      if (body.charAt(0) === '#') {
        var code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCharCode(code) : mark;
      }
      var named = RTF_NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? mark : named;
    });
  }
  /**
   * 共用的 HTML 词法：citeproc 的输出 → 片段数组。
   * 元素形如 { text } / { tab: true } / { br: true }，可带 bold/italic/sup/sub/smallCaps。
   * 只做「结构 → 片段」，不管转义与最终形态（那是各出口的事）。
   */
  function htmlSegments(html) {
    // 先分词再解实体：反过来会让标题里的 &lt;i&gt; 被当成标签吞掉
    var input = text(html).replace(/^\s+|\s+$/g, '');
    var segments = [];
    var format = {};
    var flags = [];
    var cursor = 0;
    var sawLeftMargin = false;
    var tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>/g;
    var match;
    function pushText(chunk) {
      // citeproc 的输出是缩进过的 HTML：纯缩进（含换行）的片段是排版噪声，丢掉，
      // 否则会在条目开头/中间留下成串空格（Word 里显示成一排点）
      if (!chunk || (/^\s*$/.test(chunk) && chunk.indexOf('\n') !== -1)) return;
      var decoded = decodeHtmlEntities(chunk);
      if (!decoded) return;
      var segment = { text: decoded };
      for (var i = 0; i < flags.length; i++) segment[flags[i]] = true;
      segments.push(segment);
    }
    while ((match = tagPattern.exec(input)) !== null) {
      pushText(input.slice(cursor, match.index));
      cursor = tagPattern.lastIndex;
      var name = match[1].toLowerCase();
      var closing = match[0].charAt(1) === '/';
      var flag = HTML_FORMAT_FLAGS[name];
      var isSmallCapsSpan = name === 'span' && /small-caps/i.test(match[0]);
      if (!closing && /csl-left-margin/.test(match[0])) sawLeftMargin = true;
      if (!closing && /csl-right-inline/.test(match[0]) && sawLeftMargin) {
        segments.push({ tab: true });          // 编号与正文之间：交给段落制表位对齐
        sawLeftMargin = false;
      }
      if (flag) {
        format[flag] = !closing;
      } else if (isSmallCapsSpan) {
        format.smallCaps = !closing;
      } else if (closing && name === 'span' && Object.prototype.hasOwnProperty.call(format, 'smallCaps') === false) {
        // 非 small-caps 的 span 闭合：不动格式状态
      } else if (closing && name === 'span') {
        format.smallCaps = false;
      } else if (name === 'br') {
        segments.push({ br: true });
      }
      flags = [];
      for (var key in format) if (format[key]) flags.push(key);
    }
    pushText(input.slice(cursor));
    return segments;
  }
  function rtfEscapeCode(code) {
    if (code === 0x5c) return '\\\\';
    if (code === 0x7b) return '\\{';
    if (code === 0x7d) return '\\}';
    if (code < 0x20) return code === 0x0a || code === 0x09 ? ' ' : '';
    if (code < 0x80) return String.fromCharCode(code);
    return '\\uc0\\u' + code + '{}';
  }
  function rtfEscapeText(value) {
    var out = '';
    for (var i = 0; i < value.length; i++) out += rtfEscapeCode(value.charCodeAt(i));
    return out;
  }
  function htmlToRtf(html) {
    var segments = htmlSegments(html);
    var out = '';
    segments.forEach(function (segment) {
      if (segment.tab) { out += '\\tab '; return; }
      if (segment.br) { out += '\\line '; return; }
      var controls = '';
      for (var flag in RTF_FLAG_CONTROLS) if (segment[flag]) controls += RTF_FLAG_CONTROLS[flag];
      out += controls ? '{' + controls + rtfEscapeText(segment.text) + '}' : rtfEscapeText(segment.text);
    });
    return out.replace(/^\s+|\s+$/g, '');
  }
  /**
   * HTML → docx run 数组（js/docx.js 的 paragraph.runs 吃这个形态）。
   * 与 htmlToRtf 同源，保证「导出 Word」与「Word 插件」看到同样的上标/斜体。
   */
  function htmlToRuns(html) {
    var segments = htmlSegments(html);
    var runs = segments.map(function (segment) {
      if (segment.tab) return { tab: true };
      if (segment.br) return { br: true };
      var run = { text: segment.text };
      for (var i = 0; i < FORMAT_FLAG_NAMES.length; i++) {
        if (segment[FORMAT_FLAG_NAMES[i]]) run[FORMAT_FLAG_NAMES[i]] = true;
      }
      return run;
    });
    // 与 htmlToRtf 同一口径：去掉首尾空白片段留下的空格
    if (runs.length) {
      if (runs[0].text) runs[0].text = runs[0].text.replace(/^\s+/, '');
      var last = runs[runs.length - 1];
      if (last.text) last.text = last.text.replace(/\s+$/, '');
    }
    return runs.filter(function (run) { return run.tab || run.br || run.text; });
  }

  var BUILTIN_STYLES = [
    { id: 'china-national-standard-gb-t-7714-2015-numeric', label: T('GB/T 7714 顺序编码（国自然）') },
    { id: 'china-national-standard-gb-t-7714-2015-author-date', label: T('GB/T 7714 著者-出版年') },
    { id: 'apa', label: 'APA 7th' },
    { id: 'elsevier-with-titles', label: T('Elsevier（编号含标题）') },
    { id: 'elsevier-vancouver', label: T('Elsevier Vancouver 编码') },
    { id: 'modern-language-association', label: 'MLA 9th' },
    { id: 'nature', label: 'Nature' },
    { id: 'ieee', label: 'IEEE' },
    { id: 'vancouver', label: 'Vancouver' },
    { id: 'chicago-author-date', label: T('Chicago 著者-出版年') },
    { id: 'chicago-notes-bibliography', label: T('Chicago 注释-文献表') }
  ];

  var TYPE_MAP = {
    article: 'article-journal', inproceedings: 'paper-conference', book: 'book',
    incollection: 'chapter', phdthesis: 'thesis', mastersthesis: 'thesis',
    report: 'report', newspaper: 'article-newspaper', webpage: 'webpage',
    preprint: 'manuscript', patent: 'patent', misc: 'document'
  };

  /* 姓名大小写：GB/T 官方样式把姓氏排成全大写，本库按国内论文惯例改排「首字母大写」
   * （样式侧 uppercase → capitalize-first）。citeproc 的 capitalize-first 只补首字母、
   * 不会把其余字母转小写，所以数据里存成全大写（BibTeX / 数据库导入常见）时依旧是全大写，
   * 这里再规范化一次。只动「完全没有小写字母」的词：已规范写法的姓名（McDonald、d'Angelo）
   * 原样保留；多词姓氏里的虚词（van/der/de…）保持小写；单字姓氏不做虚词判断，
   * 免得把中文姓「杜 DU」写成「du」。 */
  var NAME_PARTICLES = {
    van: 1, von: 1, vom: 1, der: 1, den: 1, de: 1, del: 1, della: 1,
    dos: 1, la: 1, le: 1, ter: 1, ten: 1, zu: 1
  };
  function normalizeFamilyName(value) {
    var v = text(value);
    if (!v || !/[A-Z]/.test(v)) return v;
    var tokens = v.split(/([^A-Za-z]+)/);
    var words = 0;
    tokens.forEach(function (token) { if (/[A-Za-z]/.test(token)) words++; });
    return tokens.map(function (token) {
      if (!/[A-Za-z]/.test(token)) return token;
      if (/[a-z]/.test(token)) return token;
      var lower = token.toLowerCase();
      if (words > 1 && NAME_PARTICLES[lower]) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('');
  }
  function authorToCsl(name) {
    var value = text(name).trim();
    if (!value) return null;
    // CJK 全名（无空格无逗号）按 literal 保持原序
    if (/^[㐀-鿿·]+$/.test(value)) return { literal: value };
    if (value.indexOf(',') !== -1) {
      var parts = value.split(',');
      return { family: normalizeFamilyName(parts[0].trim()), given: parts.slice(1).join(' ').trim() };
    }
    var tokens = value.split(/\s+/);
    if (tokens.length === 1) return { literal: value };
    return { family: normalizeFamilyName(tokens[tokens.length - 1]), given: tokens.slice(0, -1).join(' ') };
  }

  /** LitBoard paper → CSL-JSON item */
  function paperToCslItem(paper) {
    var p = paper || {};
    var item = {
      id: text(p.key) || text(p.id) || 'item',
      type: TYPE_MAP[text(p.entryType)] || 'document',
      title: text(p.title)
    };
    var authors = (Array.isArray(p.authors) ? p.authors : []).map(authorToCsl).filter(Boolean);
    if (authors.length) item.author = authors;
    if (p.year != null) item.issued = { 'date-parts': [[p.year]] };
    if (p.venue) item['container-title'] = text(p.venue);
    if (p.volume) item.volume = text(p.volume);
    if (p.issue) item.issue = text(p.issue);
    if (p.pages) item.page = text(p.pages);
    if (p.doi) item.DOI = text(p.doi);
    if (p.url) item.URL = text(p.url);
    if (p.publisher) item.publisher = text(p.publisher);
    if (p.issn) item.ISSN = text(p.issn);
    if (p.isbn) item.ISBN = text(p.isbn);
    if (p.edition) item.edition = text(p.edition);
    if (p.language) item.language = text(p.language);
    if (p.abstract) item.abstract = text(p.abstract);
    return item;
  }

  /* ---- 全字段版本（阶段二）：结构化创作者角色 + 完整日期 + 出版地/系列/缩写刊名/来源类型 ---- */
  function creatorsToCsl(creators, role) {
    return (creators || []).filter(function (c) { return c && c.creatorType === role; })
      .map(function (c) {
        if (c.name) return { literal: c.name };
        var out = {};
        if (c.family) out.family = normalizeFamilyName(c.family);
        if (c.given) out.given = text(c.given);
        return out.family || out.given ? out : null;
      }).filter(Boolean);
  }
  /** 'YYYY[-MM[-DD]]' → CSL date-parts 数组（部分日期合法） */
  function dateToDateParts(value) {
    var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text(value).trim());
    if (!m) return null;
    var parts = [Number(m[1])];
    if (m[2]) {
      parts.push(Number(m[2]));
      if (m[3]) parts.push(Number(m[3]));
    }
    return parts;
  }
  /**
   * LitBoard paper → 完整 CSL-JSON item（阶段二文档上下文引用用）。
   * 在 paperToCslItem 投影基础上补：creators 角色（author/editor/translator）、
   * 完整出版日期、访问日期、出版地、系列、缩写刊名、来源类型（sourceType → genre）。
   * 无这些新字段的条目输出与 paperToCslItem 逐字一致（有测试锁定）。
   */
  function paperToCslItemFull(paper) {
    var p = paper || {};
    var item = paperToCslItem(p);
    if (Array.isArray(p.creators) && p.creators.length) {
      var authors = creatorsToCsl(p.creators, 'author');
      if (authors.length) item.author = authors;
      var editors = creatorsToCsl(p.creators, 'editor');
      if (editors.length) item.editor = editors;
      var translators = creatorsToCsl(p.creators, 'translator');
      if (translators.length) item.translator = translators;
    }
    var dateParts = p.date ? dateToDateParts(p.date) : null;
    if (dateParts) item.issued = { 'date-parts': [dateParts] };
    if (p.accessDate) {
      var accessed = dateToDateParts(p.accessDate);
      if (accessed) item.accessed = { 'date-parts': [accessed] };
    }
    if (p.place) item['publisher-place'] = text(p.place);
    if (p.series) item['collection-title'] = text(p.series);
    if (p.journalAbbreviation) item['container-title-short'] = text(p.journalAbbreviation);
    if (p.sourceType && !TYPE_MAP[text(p.entryType)]) item.genre = text(p.sourceType);
    return item;
  }

  var loading = null;
  function loadCiteproc() {
    if (nodeCSL) return Promise.resolve(nodeCSL);
    if (typeof window !== 'undefined' && window.CSL) return Promise.resolve(window.CSL);
    if (typeof window === 'undefined') return Promise.reject(new Error(T('citeproc 不可用')));
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      window.module = { exports: {} };
      window.exports = window.module.exports;
      var s = document.createElement('script');
      s.src = 'vendor/citeproc/citeproc.js';
      s.onload = function () {
        window.CSL = window.module.exports;
        delete window.module;
        delete window.exports;
        resolve(window.CSL);
      };
      s.onerror = function () { reject(new Error(T('citeproc 加载失败'))); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function fetchText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(T('加载失败：') + url);
      return r.text();
    });
  }

  /**
   * 用指定 CSL 样式渲染一组文献的参考文献表（HTML 字符串数组）。
   * styleXml/localeXml 由调用方提供（本地 vendor 或在线缓存）。
   */
  function renderBibliography(papers, styleXml, localeXml) {
    return loadCiteproc().then(function (CSL) {
      var items = {};
      var ids = [];
      (papers || []).forEach(function (paper) {
        var item = paperToCslItemFull(paper);
        items[item.id] = item;
        ids.push(item.id);
      });
      var sys = {
        retrieveLocale: function () { return localeXml; },
        retrieveItem: function (id) { return items[id]; }
      };
      var engine = new CSL.Engine(sys, styleXml);
      engine.updateItems(ids);
      var bib = engine.makeBibliography();
      return (bib && bib[1] || []).map(function (html) { return fixLatinEtAl(html); });
    });
  }

  /** 便捷入口：按内置样式 id 渲染（从 vendor 读取样式与语言环境） */
  function renderWithBuiltinStyle(papers, styleId, locale) {
    var base = 'vendor/citeproc/';
    var localeFile = locale === 'en-US' ? 'en-US' : 'zh-CN';
    return Promise.all([
      fetchText(base + 'styles/' + styleId + '.csl'),
      fetchText(base + 'locales/' + localeFile + '.xml')
    ]).then(function (texts) {
      return renderBibliography(papers, texts[0], texts[1]);
    });
  }

  return {
    BUILTIN_STYLES: BUILTIN_STYLES,
    fixLatinEtAl: fixLatinEtAl,
    htmlToRtf: htmlToRtf,
    htmlToRuns: htmlToRuns,
    paperToCslItem: paperToCslItem,
    paperToCslItemFull: paperToCslItemFull,
    renderBibliography: renderBibliography,
    renderWithBuiltinStyle: renderWithBuiltinStyle,
    loadCiteproc: loadCiteproc
  };
});
