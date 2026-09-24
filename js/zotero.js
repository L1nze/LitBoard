/* LitBoard Zotero 库映射：zotero.sqlite 抽取的纯 JSON 快照 → LitBoard 工作区（浏览器 / Node 共用）
 * 纯函数模块：不碰 fs / sqlite / 网络，文件存在性探测经 options.fileExists 注入。
 * 路径一律按字符串处理（Zotero 路径可能是 Windows 反斜杠），复制落地由主进程负责。
 */
(function (root, factory) {
  var model = (typeof module === 'object' && module.exports) ? require('./model.js') : (root && root.LitModel);
  var api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitZotero = api;
})(typeof window !== 'undefined' ? window : null, function (LitModel) {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  /* ---------- 通用小工具 ---------- */
  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function asArray(v) { return Array.isArray(v) ? v : []; }
  function isValidId(v) { return /^[A-Za-z0-9_-]{1,120}$/.test(text(v)); }
  function pushUnique(list, value) { if (list.indexOf(value) === -1) list.push(value); }
  function groupBy(list, key) {
    var out = {};
    asArray(list).forEach(function (row) {
      if (!row || row[key] == null) return;
      (out[row[key]] = out[row[key]] || []).push(row);
    });
    return out;
  }

  /* ---------- 路径字符串工具（不碰文件系统） ---------- */
  function isAbsolutePath(p) {
    return /^([A-Za-z]:[\\/]|\\\\|[\\/])/.test(text(p));
  }
  function baseName(p) {
    var parts = text(p).split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }
  function joinPath(base, name) {
    base = text(base); name = text(name).replace(/^[\\/]+/, '');
    if (!base) return name;
    if (!name) return base;
    var backslash = base.indexOf('\\') !== -1;
    if (backslash) name = name.replace(/\//g, '\\'); // 跟随基准的分隔符风格
    var sep = /[\\/]$/.test(base) ? '' : (backslash ? '\\' : '/');
    return base + sep + name;
  }

  function decodeBase64(value) {
    try {
      if (typeof Buffer !== 'undefined') return Buffer.from(String(value), 'base64').toString('utf8');
      if (typeof atob !== 'undefined') {
        var bin = atob(String(value));
        var pct = '';
        for (var i = 0; i < bin.length; i++) {
          var hex = bin.charCodeAt(i).toString(16);
          pct += '%' + (hex.length < 2 ? '0' + hex : hex);
        }
        return decodeURIComponent(pct);
      }
    } catch (e) {}
    return '';
  }

  function escapeHtml(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** data-citation JSON → 引用的 Zotero item key 列表（文献 id 确定性派生 z<key>） */
  function citationItemsFromAttrs(attrs) {
    var raw = attrValue(attrs, 'data-citation');
    if (!raw) return [];
    var items = [];
    try {
      var data = JSON.parse(decodeEntities(raw));
      (Array.isArray(data.citationItems) ? data.citationItems : []).forEach(function (item) {
        var key = '';
        (Array.isArray(item.uris) ? item.uris : []).forEach(function (uri) {
          var m = /\/items\/([A-Za-z0-9_-]+)\/?$/.exec(text(uri));
          if (m && !key) key = m[1];
        });
        if (key) {
          items.push({
            key: key,
            paperId: 'z' + key,
            locator: text(item.locator),
            label: text(item.label),
            prefix: text(item.prefix),
            suffix: text(item.suffix)
          });
        }
      });
    } catch (e) {}
    return items;
  }

  /** 引文显示文本 → LitBoard 引用链接/节点；保留多篇文献链接并在损失时记入 unconverted */
  function renderCitationLink(plain, items, format, ctx) {
    if (!items.length) {
      if (ctx && ctx.unconverted) {
        ctx.unconverted.push({ kind: 'note-citation', key: ctx.zoteroKey, detail: plain.slice(0, 80) });
      }
      return format === 'html' ? escapeHtml(plain) : plain;
    }
    // 组合引文或定位符/前后缀损失：记录到 unconverted
    var hasExtra = items.length > 1 || items.some(function (it) { return it.locator || it.prefix || it.suffix; });
    if (hasExtra && ctx && ctx.unconverted) {
      var detail = items.length > 1
        ? T('多文献组合引文（') + items.map(function (it) { return it.key + (it.locator ? ' p.' + it.locator : ''); }).join('; ') + '）：' + plain.slice(0, 80)
        : T('引文定位符/前后缀损失（') + items[0].key + (items[0].locator ? ' p.' + items[0].locator : '') + '）：' + plain.slice(0, 80);
      ctx.unconverted.push({ kind: 'note-citation', key: ctx.zoteroKey, detail: detail });
    }
    if (items.length === 1) {
      return format === 'html'
        ? '<a href="litboard://open/paper/' + items[0].paperId + '">' + escapeHtml(plain) + '</a>'
        : '[' + plain + '](litboard://open/paper/' + items[0].paperId + ')';
    }
    // 多文献组合引文：尝试按分号切分分别建立链接，保留每篇文献的出处跳转
    var openParen = '', closeParen = '', body = plain;
    if (/^[(\uff08[]/.test(plain) && /[)\uff09\]]$/.test(plain)) {
      openParen = plain.charAt(0);
      closeParen = plain.charAt(plain.length - 1);
      body = plain.slice(1, -1);
    }
    var parts = body.split(/[;；]/);
    if (parts.length === items.length) {
      var rendered = parts.map(function (part, idx) {
        var trimmed = part.trim();
        return format === 'html'
          ? '<a href="litboard://open/paper/' + items[idx].paperId + '">' + escapeHtml(trimmed) + '</a>'
          : '[' + trimmed + '](litboard://open/paper/' + items[idx].paperId + ')';
      });
      return openParen + rendered.join('; ') + closeParen;
    }
    // 无法精准对齐分段时：为所有 key 生成链接
    if (format === 'html') {
      return items.map(function (it) {
        return '<a href="litboard://open/paper/' + it.paperId + '">[' + it.key + ']</a>';
      }).join(' ') + ' ' + escapeHtml(plain);
    }
    return items.map(function (it) {
      return '[' + it.key + '](litboard://open/paper/' + it.paperId + ')';
    }).join(' ') + ' ' + plain;
  }

  function htmlToRichText(html, ctx) {
    ctx = ctx || {};
    var source = text(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    // Zotero 引文节点 → litboard 链接（可解析出 key 时；否则剥壳留纯文本并记 unconverted）
    source = source.replace(/<(span|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi, function (full, name, attrs, inner) {
      if (!/\bdata-citation(\s*=|\s|$)/i.test(attrs) &&
          !/\bclass\s*=\s*("[^"]*\bcitation\b[^"]*"|'[^']*\bcitation\b[^']*')/i.test(attrs)) return full;
      var plain = decodeEntities(text(inner).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      var items = citationItemsFromAttrs(attrs);
      return renderCitationLink(plain, items, 'html', ctx);
    });
    source = source.replace(/<img\b([^>]*)>/gi, function (full, attrs) {
      var src = text(attrValue(attrs, 'src')).trim();
      if (!src) return '';
      var dataM = /^data:image\/([a-z0-9+.-]+)\s*;base64,[\s\S]+$/i.exec(src);
      if (dataM) {
        ctx.imageSeq = (ctx.imageSeq || 0) + 1;
        var ext = MIME_EXT[text(dataM[1]).toLowerCase()] || 'png';
        var fileName = 'image-' + ctx.imageSeq + '.' + ext;
        var rel = 'note-assets/' + ctx.noteId + '/' + fileName;
        (ctx.assets || []).push({ kind: 'note-image', paperId: '', attachmentId: '', noteId: ctx.noteId,
          annotationId: '', zoteroKey: ctx.zoteroKey, sourcePath: '', fileName: fileName, dataUri: src });
        (ctx.noteAssets || []).push({ fileName: fileName, path: rel });
        return '<img src="' + rel + '" alt="' + escapeHtml(attrValue(attrs, 'alt')) + '">';
      }
      if (/^https?:\/\//i.test(src)) return '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(attrValue(attrs, 'alt')) + '">';
      var fileSrc = src.replace(/^file:\/\/?/i, ''), abs = '';
      if (isAbsolutePath(fileSrc)) abs = fileSrc;
      else if (ctx.dataDir) abs = joinPath(joinPath(joinPath(ctx.dataDir, 'storage'), ctx.zoteroKey), fileSrc);
      if (abs && (!ctx.fileExists || ctx.fileExists(abs))) {
        ctx.imageSeq = (ctx.imageSeq || 0) + 1;
        var localName = baseName(fileSrc) || ('image-' + ctx.imageSeq + '.png');
        var localRel = 'note-assets/' + ctx.noteId + '/' + localName;
        (ctx.assets || []).push({ kind: 'note-image', paperId: '', attachmentId: '', noteId: ctx.noteId,
          annotationId: '', zoteroKey: ctx.zoteroKey, sourcePath: abs, fileName: localName, dataUri: '' });
        (ctx.noteAssets || []).push({ fileName: localName, path: localRel });
        return '<img src="' + localRel + '" alt="' + escapeHtml(attrValue(attrs, 'alt')) + '">';
      }
      (ctx.unconverted || []).push({ kind: 'note-image', key: ctx.zoteroKey, detail: src });
      return '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(attrValue(attrs, 'alt')) + '">';
    });
    return typeof ctx.sanitizeHtml === 'function' ? ctx.sanitizeHtml(source) : source;
  }

  /* ---------- extra 字段的 LitBoard 标记（与 integrations.js parseExtra 同款语义） ---------- */
  function parseExtra(value) {
    var result = { status: '', rating: null, notes: '', rest: '' };
    var rest = [];
    text(value).split(/\r?\n/).forEach(function (line) {
      var m = /^LitBoard Status:\s*(unread|reading|read)\s*$/i.exec(line);
      if (m) { result.status = m[1].toLowerCase(); return; }
      m = /^LitBoard Rating:\s*([0-5])\s*$/i.exec(line);
      if (m) { result.rating = Number(m[1]); return; }
      m = /^LitBoard Markdown:\s*([A-Za-z0-9+/=]+)\s*$/i.exec(line);
      if (m) { result.notes = decodeBase64(m[1]); return; }
      rest.push(line);
    });
    result.rest = rest.join('\n').trim();
    return result;
  }

  /* ---------- HTML → Markdown（简易状态机，不引入 DOM） ---------- */
  function decodeEntities(s) {
    return text(s)
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
  function attrValue(attrs, name) {
    var re = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    var m = re.exec(attrs);
    if (!m) return '';
    return m[1] != null ? m[1] : (m[2] != null ? m[2] : text(m[3]));
  }
  /** 从 from 起找与 name 配对的闭合标签（同名嵌套计深度），返回 {start, end} 或 null */
  function findClosingTag(html, from, name) {
    var re = new RegExp('<\\s*(\\/?)\\s*' + name + '(\\s[^>]*)?>', 'gi');
    re.lastIndex = from;
    var depth = 1, m;
    while ((m = re.exec(html))) {
      if (m[1]) {
        depth--;
        if (!depth) return { start: m.index, end: m.index + m[0].length };
      } else if (!/\/>$/.test(m[0])) depth++;
    }
    return null;
  }

  var MIME_EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp', bmp: 'bmp', 'svg+xml': 'svg' };

  /**
   * ctx = { noteId, zoteroKey, dataDir, fileExists, assets, noteAssets, unconverted, imageSeq }
   * 图片资产登记进 ctx.assets（落地复制由主进程做），正文写 note-assets/<noteId>/<fileName> 相对路径。
   */
  function htmlToMarkdown(html, ctx) {
    ctx = ctx || {};
    var assets = ctx.assets || [];
    var noteAssets = ctx.noteAssets || [];
    var unconverted = ctx.unconverted || [];
    if (typeof ctx.imageSeq !== 'number') ctx.imageSeq = 0;
    var out = [];
    var listStack = [];
    var linkStack = [];
    var preDepth = 0;

    function blockBreak() { out.push('\n\n'); }
    function flat(s) {
      var decoded = decodeEntities(s);
      return preDepth > 0 ? decoded : decoded.replace(/\s+/g, ' ');
    }
    function handleImage(attrs) {
      var src = decodeEntities(attrValue(attrs, 'src')).trim();
      if (!src) return;
      var dataM = /^data:image\/([a-z0-9+.-]+)\s*;base64,([\s\S]+)$/i.exec(src);
      if (dataM) {
        var ext = MIME_EXT[text(dataM[1]).toLowerCase()] || 'png';
        ctx.imageSeq++;
        var fn = 'image-' + ctx.imageSeq + '.' + ext;
        var rel = 'note-assets/' + ctx.noteId + '/' + fn;
        assets.push({ kind: 'note-image', paperId: '', attachmentId: '', noteId: ctx.noteId,
          annotationId: '', zoteroKey: ctx.zoteroKey, sourcePath: '', fileName: fn, dataUri: src });
        noteAssets.push({ fileName: fn, path: rel });
        out.push('![](' + rel + ')');
        return;
      }
      if (/^https?:\/\//i.test(src)) { out.push('![](' + src + ')'); return; }
      // 文件路径：绝对直接用；相对基于 dataDir/storage/<note item key>/
      var fileSrc = src.replace(/^file:\/\/\/?/i, '');
      var abs = '';
      if (isAbsolutePath(fileSrc)) abs = fileSrc;
      else if (ctx.dataDir) abs = joinPath(joinPath(joinPath(ctx.dataDir, 'storage'), ctx.zoteroKey), fileSrc);
      if (abs && (!ctx.fileExists || ctx.fileExists(abs))) {
        ctx.imageSeq++;
        var fn2 = baseName(fileSrc) || ('image-' + ctx.imageSeq + '.png');
        var rel2 = 'note-assets/' + ctx.noteId + '/' + fn2;
        assets.push({ kind: 'note-image', paperId: '', attachmentId: '', noteId: ctx.noteId,
          annotationId: '', zoteroKey: ctx.zoteroKey, sourcePath: abs, fileName: fn2, dataUri: '' });
        noteAssets.push({ fileName: fn2, path: rel2 });
        out.push('![](' + rel2 + ')');
        return;
      }
      out.push('![](' + src + ')');
      unconverted.push({ kind: 'note-image', key: ctx.zoteroKey, detail: src });
    }
    /** data-citation / class="citation" 节点：剥壳留纯文本并记入 unconverted */
    function isCitationNode(name, attrs) {
      if (name !== 'span' && name !== 'div') return false;
      return /\bdata-citation(\s*=|\s|$)/i.test(attrs) ||
        /\bclass\s*=\s*("[^"]*\bcitation\b[^"]*"|'[^']*\bcitation\b[^']*')/i.test(attrs);
    }

    var i = 0, n = text(html).length, source = text(html);
    while (i < n) {
      var lt = source.indexOf('<', i);
      if (lt === -1) { out.push(flat(source.slice(i))); break; }
      if (lt > i) out.push(flat(source.slice(i, lt)));
      var gt = source.indexOf('>', lt);
      if (gt === -1) { out.push(flat(source.slice(lt))); break; }
      var raw = source.slice(lt, gt + 1);
      i = gt + 1;
      if (/^<\s*(!|\?)/.test(raw)) continue; // 注释 / 处理指令
      var tm = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)>$/.exec(raw);
      if (!tm) continue; // 无法识别的标签直接丢弃
      var closing = tm[1] === '/';
      var name = tm[2].toLowerCase();
      var attrs = tm[3] || '';

      if (!closing && name === 'table') {
        var tableClose = findClosingTag(source, i, 'table');
        if (tableClose) {
          var fragment = source.slice(lt, tableClose.end);
          blockBreak(); out.push(fragment); blockBreak();
          unconverted.push({ kind: 'note-table', key: ctx.zoteroKey, detail: fragment.slice(0, 80) });
          i = tableClose.end;
        }
        continue;
      }
      if (!closing && isCitationNode(name, attrs)) {
        var citeClose = findClosingTag(source, i, name);
        if (citeClose) {
          var plain = decodeEntities(source.slice(i, citeClose.start).replace(/<[^>]*>/g, ' '))
            .replace(/\s+/g, ' ').trim();
          var items = citationItemsFromAttrs(attrs);
          out.push(renderCitationLink(plain, items, 'md', ctx));
          i = citeClose.end;
          continue;
        }
      }
      if (!closing) {
        if (name === 'img') { handleImage(attrs); continue; }
        if (name === 'br') { out.push('\n'); continue; }
        if (name === 'p' || name === 'div') { blockBreak(); continue; }
        if (/^h[1-6]$/.test(name)) { blockBreak(); out.push(new Array(Number(name[1]) + 1).join('#') + ' '); continue; }
        if (name === 'strong' || name === 'b') { out.push('**'); continue; }
        if (name === 'em' || name === 'i') { out.push('*'); continue; }
        if (name === 'ul' || name === 'ol') { blockBreak(); listStack.push({ name: name, count: 0 }); continue; }
        if (name === 'li') {
          var top = listStack.length ? listStack[listStack.length - 1] : null;
          var indent = new Array(Math.max(0, listStack.length - 1) + 1).join('  ');
          var marker = '- ';
          if (top && top.name === 'ol') { top.count++; marker = top.count + '. '; }
          out.push('\n' + indent + marker);
          continue;
        }
        if (name === 'blockquote') { blockBreak(); out.push('> '); continue; }
        if (name === 'pre') { blockBreak(); out.push('```\n'); preDepth++; continue; }
        if (name === 'code') { if (!preDepth) out.push('`'); continue; }
        if (name === 'a') {
          var href = decodeEntities(attrValue(attrs, 'href')).trim();
          if (/^https?:\/\//i.test(href)) { linkStack.push(href); out.push('['); }
          else linkStack.push('');
          continue;
        }
        continue; // 其余标签剥壳
      }
      /* 闭合标签 */
      if (name === 'p' || name === 'div' || /^h[1-6]$/.test(name) || name === 'blockquote') { blockBreak(); continue; }
      if (name === 'strong' || name === 'b') { out.push('**'); continue; }
      if (name === 'em' || name === 'i') { out.push('*'); continue; }
      if (name === 'ul' || name === 'ol') { listStack.pop(); blockBreak(); continue; }
      if (name === 'pre') { preDepth = Math.max(0, preDepth - 1); out.push('\n```'); blockBreak(); continue; }
      if (name === 'code') { if (!preDepth) out.push('`'); continue; }
      if (name === 'a') {
        var link = linkStack.length ? linkStack.pop() : '';
        if (link) out.push('](' + link + ')');
        continue;
      }
    }
    return out.join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------- 条目类型与字段映射 ---------- */
  var TYPE_MAP = {
    journalArticle: 'article', conferencePaper: 'inproceedings', book: 'book',
    bookSection: 'incollection', thesis: 'phdthesis', report: 'report',
    newspaperArticle: 'newspaper', webpage: 'webpage', preprint: 'preprint', patent: 'patent'
  };
  var FIELD_MAP = {
    title: 'title', abstractNote: 'abstract', DOI: 'doi', url: 'url', volume: 'volume',
    issue: 'issue', pages: 'pages', publisher: 'publisher', place: 'place', edition: 'edition',
    language: 'language', ISSN: 'issn', ISBN: 'isbn', journalAbbreviation: 'journalAbbreviation',
    accessDate: 'accessDate'
  };
  var VENUE_FIELDS = ['publicationTitle', 'proceedingsTitle', 'bookTitle', 'conferenceName', 'university'];
  var ROLE_MAP = { author: 'author', editor: 'editor', translator: 'translator' };
  var ANNOTATION_TYPE_MAP = { highlight: 'highlight', underline: 'underline', note: 'note', ink: 'ink', image: 'snapshot' };

  function errorMessage(e) { return text(e && e.message) || T('未知错误'); }

  /**
   * 主映射：raw（zotero.sqlite 抽取的纯 JSON） → { workspace, report, assets }
   * options = { dataDir, fileExists(absPath)->bool, baseAttachmentPath }
   */
  function mapLibrary(raw, options) {
    raw = raw && typeof raw === 'object' ? raw : {};
    options = options && typeof options === 'object' ? options : {};
    var dataDir = text(options.dataDir);
    var fileExists = typeof options.fileExists === 'function' ? options.fileExists : null;
    var baseAttachmentPath = text(options.baseAttachmentPath);
    var sourceLibraryId = text(options.sourceLibraryId || options.libraryId || raw.libraryId).trim();
    var noteFormat = options.noteFormat === 'richtext' ? 'richtext' : 'markdown';

    var report = {
      source: { libraryId: sourceLibraryId, items: 0, notes: 0, attachments: 0, annotations: 0, collections: 0, tags: 0 },
      imported: { papers: 0, notes: 0, attachments: 0, annotations: 0, folders: 0, tagColors: 0, related: 0 },
      missing: [],
      failures: [],
      unconverted: [],
      conflicts: [],
      queryFailures: asArray(raw.queryFailures),
      mapping: { items: 0, attachments: 0, notes: 0 }
    };
    report.queryFailures.forEach(function (failure) {
      report.failures.push({ kind: 'query', key: failure.query || '', message: failure.message || 'Zotero query failed' });
    });
    var assets = [];

    var deleted = {};
    asArray(raw.deletedItemIDs).forEach(function (id) { deleted[id] = true; });

    /* ---- 条目骨架 ---- */
    var itemById = {};
    asArray(raw.allItems).forEach(function (it) {
      if (!it || it.itemID == null) return;
      itemById[it.itemID] = { key: text(it.key), typeName: text(it.typeName) };
    });
    var papers = [];
    var paperById = {};
    var paperIdByItemId = {}; // zotero itemID -> LitBoard paper id
    var itemIdByPaperId = {};
    var typeNameByPaperId = {};
    asArray(raw.allItems).forEach(function (it) {
      if (!it || it.itemID == null || deleted[it.itemID]) return;
      if (it.libraryID != null && asArray(raw.personalLibraryIds).length &&
          raw.personalLibraryIds.indexOf(it.libraryID) === -1) return;
      var typeName = text(it.typeName);
      if (typeName === 'attachment' || typeName === 'note' || typeName === 'annotation') return;
      var key = text(it.key);
      if (!key) return;
      report.source.items++;
      try {
        var paper = {
          id: 'z' + key, zoteroKey: key, sourceLibraryId: sourceLibraryId, entryType: 'misc', title: '',
          creators: [], tags: [], folderIds: [], relatedIds: [],
          attachments: [], pdfAnnotations: [], bibtexExtra: {}
        };
        papers.push(paper);
        paperById[paper.id] = paper;
        paperIdByItemId[it.itemID] = paper.id;
        itemIdByPaperId[paper.id] = it.itemID;
        typeNameByPaperId[paper.id] = typeName;
      } catch (e) {
        report.failures.push({ kind: 'item', key: key, message: errorMessage(e) });
      }
    });

    /* ---- 字段 / 创作者 / 标签（按条目 try/catch） ---- */
    var fieldsByItem = groupBy(raw.itemData, 'itemID');
    var creatorsByItem = groupBy(raw.creators, 'itemID');
    var tagsByItem = groupBy(raw.tags, 'itemID');
    papers.forEach(function (paper) {
      try {
        var itemID = itemIdByPaperId[paper.id];
        var typeName = typeNameByPaperId[paper.id];
        var thesisKind = '';
        var dateRaw = '';
        var extraRaw = '';
        asArray(fieldsByItem[itemID]).forEach(function (row) {
          var name = text(row.fieldName);
          var value = text(row.value);
          if (!name || !value) return;
          if (FIELD_MAP[name]) { paper[FIELD_MAP[name]] = value; return; }
          if (name === 'series' || name === 'seriesTitle') { if (!paper.series) paper.series = value; return; }
          if (VENUE_FIELDS.indexOf(name) !== -1) { if (!paper.venue) paper.venue = value; return; }
          if (name === 'date') { dateRaw = value; return; }
          if (name === 'extra') { extraRaw = value; return; }
          if (name === 'thesisType' || name === 'type') thesisKind = value;
          paper.bibtexExtra[name] = value.slice(0, 50000);
        });
        /* 条目类型（thesis 需 thesisType/type 判定学位层次） */
        var entryType = TYPE_MAP[typeName] || '';
        if (typeName === 'thesis' && /master/i.test(thesisKind)) entryType = 'mastersthesis';
        if (entryType) paper.entryType = entryType;
        else { paper.entryType = 'misc'; paper.sourceType = typeName; }
        /* 日期：原样过 normalizeDate，非法则存 date_raw 并提取年份兜底 */
        if (dateRaw) {
          if (LitModel.normalizeDate(dateRaw)) paper.date = dateRaw;
          else {
            paper.bibtexExtra.date_raw = dateRaw.slice(0, 50000);
            var yearMatch = /\d{4}/.exec(dateRaw);
            if (yearMatch) paper.year = Number(yearMatch[0]);
          }
        }
        /* extra：LitBoard 标记解析，余量原文进 bibtexExtra.extra */
        if (extraRaw) {
          var extra = parseExtra(extraRaw);
          if (extra.status) paper.status = extra.status;
          if (extra.rating != null) paper.rating = extra.rating;
          if (extra.notes) paper.notes = extra.notes;
          if (extra.rest) paper.bibtexExtra.extra = extra.rest.slice(0, 50000);
        }
        /* 创作者：orderIndex 排序，角色映射，fieldMode=1 单字段拆分 */
        asArray(creatorsByItem[itemID]).slice().sort(function (a, b) {
          return (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0);
        }).forEach(function (row) {
          var role = ROLE_MAP[text(row.creatorType)] || 'other';
          if (Number(row.fieldMode) === 1) {
            var parsed = LitModel.parseCreatorName(text(row.lastName));
            if (parsed) { parsed.creatorType = role; paper.creators.push(parsed); }
            return;
          }
          paper.creators.push({
            creatorType: role,
            family: text(row.lastName),
            given: text(row.firstName),
            name: ''
          });
        });
        asArray(tagsByItem[itemID]).forEach(function (row) {
          var name = text(row.name).trim();
          if (name) paper.tags.push(name);
        });
      } catch (e) {
        report.failures.push({ kind: 'item', key: paper.zoteroKey, message: errorMessage(e) });
      }
    });

    /* ---- 文件夹（collections 层级） ---- */
    var folders = [];
    var folderByCollection = {};
    asArray(raw.collections).forEach(function (row, index) {
      var key = text(row && row.key);
      if (!key) return;
      folderByCollection[row.collectionID] = { id: 'fzc' + key, name: text(row.name), parentId: '', sortIndex: index };
    });
    asArray(raw.collections).forEach(function (row) {
      var folder = folderByCollection[row && row.collectionID];
      var parent = row && row.parentCollectionID != null ? folderByCollection[row.parentCollectionID] : null;
      if (folder && parent) folder.parentId = parent.id;
    });
    Object.keys(folderByCollection).forEach(function (id) { folders.push(folderByCollection[id]); });
    asArray(raw.collectionItems).forEach(function (row) {
      if (!row) return;
      var paperId = paperIdByItemId[row.itemID];
      var folder = folderByCollection[row.collectionID];
      if (paperId && folder && paperById[paperId]) pushUnique(paperById[paperId].folderIds, folder.id);
    });

    /* ---- 附件（先于批注处理，批注要回填 attachmentId） ---- */
    var attachmentByItemId = {}; // zotero attachment itemID -> { attachment, paperId, key }
    asArray(raw.attachments).forEach(function (row) {
      if (!row || deleted[row.itemID]) return;
      report.source.attachments++;
      var key = text(row.key);
      try {
        var linkMode = Number(row.linkMode) || 0;
        var parentItemID = row.parentItemID;
        var parentInfo = parentItemID != null ? itemById[parentItemID] : null;
        var parentKey = parentInfo ? parentInfo.key : '';
        if (linkMode === 3) {
          /* 纯链接：不入附件，父条目缺 url 时补上 */
          var linkPaperId = parentItemID != null ? paperIdByItemId[parentItemID] : '';
          if (linkPaperId && paperById[linkPaperId] && !paperById[linkPaperId].url && text(row.url)) {
            paperById[linkPaperId].url = text(row.url);
          }
          return;
        }
        var paper = null;
        var contentType = text(row.contentType);
        var rawPath = text(row.path);
        var fileName = baseName(rawPath.replace(/^storage:/i, '')) || key;
        if (parentItemID == null || parentItemID === '') {
          /* 独立附件 → 占位 paper */
          paper = {
           id: 'z' + key, zoteroKey: key, sourceLibraryId: sourceLibraryId, entryType: 'misc', sourceType: 'attachment',
            title: fileName, creators: [], tags: [], folderIds: [], relatedIds: [],
            attachments: [], pdfAnnotations: [], bibtexExtra: {}
          };
          papers.push(paper);
          paperById[paper.id] = paper;
          report.unconverted.push({ kind: 'standalone-attachment', key: key, detail: fileName });
        } else {
          var paperId = paperIdByItemId[parentItemID];
          if (!paperId || !paperById[paperId]) {
            report.failures.push({ kind: 'attachment', key: key, message: T('父条目不存在或已被删除') });
            return;
          }
          paper = paperById[paperId];
        }
        /* kind 判定 */
        var kind = 'other';
        if (contentType === 'application/pdf') kind = 'pdf';
        else if (contentType === 'application/epub+zip') kind = 'epub';
        else if (contentType === 'text/html' && linkMode === 1) kind = 'snapshot';
        else if (/\.pdf$/i.test(fileName)) kind = 'pdf';
        /* 路径解析 */
        var sourcePath = '';
        var checkPath = '';
        var missingReason = '';
        if (/^storage:/i.test(rawPath)) {
          var storageFile = rawPath.replace(/^storage:/i, '');
          var storageDir = joinPath(joinPath(dataDir, 'storage'), key);
          sourcePath = kind === 'snapshot' ? storageDir : joinPath(storageDir, storageFile);
          checkPath = joinPath(storageDir, storageFile);
        } else if (isAbsolutePath(rawPath)) {
          sourcePath = rawPath; checkPath = rawPath;
        } else if (rawPath) {
          if (baseAttachmentPath) { sourcePath = joinPath(baseAttachmentPath, rawPath); checkPath = sourcePath; }
          else missingReason = 'relative-no-base';
        } else missingReason = 'not-found';
        var exists = !missingReason && sourcePath && (!fileExists || fileExists(checkPath));
        if (!exists && !missingReason) missingReason = 'not-found';
        if (missingReason) {
          report.missing.push({ zoteroKey: key, parentKey: parentKey, fileName: fileName, reason: missingReason });
        }
        var attachment = {
          id: 'zatt_' + key, zoteroKey: key, sourceLibraryId: sourceLibraryId, kind: kind, fileName: fileName,
          path: exists ? sourcePath : ''
        };
        paper.attachments.push(attachment);
        attachmentByItemId[row.itemID] = { attachment: attachment, paperId: paper.id, key: key };
        if (kind === 'pdf' && !paper.zoteroAttachmentKey) paper.zoteroAttachmentKey = key;
        assets.push({
          kind: kind === 'snapshot' ? 'snapshot-dir' : 'file',
          paperId: paper.id, attachmentId: attachment.id, noteId: '', annotationId: '',
          zoteroKey: key, sourcePath: exists ? sourcePath : '', fileName: fileName, dataUri: ''
        });
      } catch (e) {
        report.failures.push({ kind: 'attachment', key: key, message: errorMessage(e) });
      }
    });

    /* ---- 批注 ---- */
    asArray(raw.annotations).forEach(function (row) {
      if (!row || deleted[row.itemID]) return;
      report.source.annotations++;
      var key = text(row.key);
      try {
        var position = JSON.parse(text(row.position) || '{}');
        var attInfo = attachmentByItemId[row.parentItemID];
        if (!attInfo || !paperById[attInfo.paperId]) {
          report.missing.push({ zoteroKey: key, parentKey: '', fileName: '', reason: 'annotation-orphan' });
          return;
        }
        var rawType = text(row.type);
        var type = ANNOTATION_TYPE_MAP[rawType] || '';
        if (!type) {
          type = 'note';
          report.unconverted.push({ kind: 'annotation-type', key: key, detail: rawType });
        }
        var rects = Array.isArray(position.rects) ? position.rects : [];
        var annotation = {
          id: 'zann_' + key, type: type, sourceLibraryId: sourceLibraryId, zoteroKey: key, color: text(row.color),
          attachmentId: attInfo.attachment.id,
          text: text(row.text), comment: text(row.comment),
          position: { pageIndex: position.pageIndex, rects: rects }
        };
        if (type === 'ink') {
          /* Zotero paths 为「数组的数组」，展平成 LitBoard 的单层点列 */
          var points = [];
          asArray(position.paths).forEach(function (pathPoints) {
            asArray(pathPoints).forEach(function (pt) { points.push(pt); });
          });
          annotation.position.points = points;
        }
        if (type === 'snapshot' && text(row.imagePath)) {
          var imagePath = text(row.imagePath);
          var candidates = isAbsolutePath(imagePath) ? [imagePath]
            : [joinPath(dataDir, imagePath), joinPath(joinPath(joinPath(dataDir, 'storage'), key), imagePath)];
          var found = '';
          for (var ci = 0; ci < candidates.length; ci++) {
            if (!fileExists || fileExists(candidates[ci])) { found = candidates[ci]; break; }
          }
          if (found) {
            assets.push({
              kind: 'annotation-image', paperId: attInfo.paperId, attachmentId: attInfo.attachment.id,
              noteId: '', annotationId: annotation.id, zoteroKey: key,
              sourcePath: found, fileName: baseName(imagePath), dataUri: ''
            });
          } else {
            report.unconverted.push({ kind: 'annotation-image', key: key, detail: imagePath });
          }
        }
        paperById[attInfo.paperId].pdfAnnotations.push(annotation);
      } catch (e) {
        report.failures.push({ kind: 'annotation', key: key, message: errorMessage(e) });
      }
    });

    /* ---- 笔记（HTML → Markdown） ---- */
    var notes = [];
    asArray(raw.notes).forEach(function (row) {
      if (!row || deleted[row.itemID]) return;
      report.source.notes++;
      var key = text(row.key);
      try {
        var id = 'znote_' + key;
        if (!isValidId(id)) id = '';
        var pathId = id || 'znote';
        var parentPaperId = '';
        if (row.parentItemID != null && row.parentItemID !== '' && paperIdByItemId[row.parentItemID]) {
          parentPaperId = paperIdByItemId[row.parentItemID];
        }
        var ctx = {
          noteId: pathId, zoteroKey: key, dataDir: dataDir, fileExists: fileExists,
          assets: assets, noteAssets: [], unconverted: report.unconverted, imageSeq: 0,
          sanitizeHtml: options.sanitizeHtml
        };
        var sourceHtml = text(row.note);
        var content = noteFormat === 'richtext' ? htmlToRichText(sourceHtml, ctx) : htmlToMarkdown(sourceHtml, ctx);
        notes.push({
          id: id, paperId: parentPaperId, zoteroKey: key, sourceLibraryId: sourceLibraryId,
          title: text(row.title), content: content, format: noteFormat, sourceHtml: sourceHtml,
          sourceMeta: { libraryId: sourceLibraryId, itemID: row.itemID, parentItemID: row.parentItemID, zoteroKey: key },
          assets: ctx.noteAssets
        });
      } catch (e) {
        report.failures.push({ kind: 'note', key: key, message: errorMessage(e) });
      }
    });

    /* ---- 关联条目（双向 relatedIds） ---- */
    asArray(raw.relations).forEach(function (row) {
      if (!row) return;
      var subjectId = paperIdByItemId[row.subjectItemID];
      var objectId = text(row.objectKey) ? 'z' + text(row.objectKey) : '';
      if (!subjectId || !objectId || !paperById[objectId] || subjectId === objectId) return;
      pushUnique(paperById[subjectId].relatedIds, objectId);
      pushUnique(paperById[objectId].relatedIds, subjectId);
      report.imported.related++;
    });

    /* ---- 标签颜色 ---- */
    var tagColorRecords = [];
    asArray(raw.tagColors).forEach(function (row) {
      var name = text(row && row.name).trim();
      if (!name) return;
      tagColorRecords.push({ tag: name, color: text(row.color), updatedAt: 1, deletedAt: null });
    });

    /* ---- 汇总与 normalize ---- */
    report.source.collections = asArray(raw.collections).length;
    report.source.tags = asArray(raw.tags).length;
    report.imported.papers = papers.length;
    report.imported.notes = notes.length;
    report.imported.attachments = papers.reduce(function (sum, p) { return sum + p.attachments.length; }, 0);
    report.imported.annotations = papers.reduce(function (sum, p) { return sum + p.pdfAnnotations.length; }, 0);
    report.imported.folders = folders.length;
    report.imported.tagColors = tagColorRecords.length;
    report.mapping.items = papers.filter(function (p) { return !!p.zoteroKey; }).length;
    report.mapping.notes = notes.filter(function (n0) { return !!n0.zoteroKey; }).length;
    report.mapping.attachments = papers.reduce(function (sum, p) {
      return sum + p.attachments.filter(function (a) { return !!a.zoteroKey; }).length;
    }, 0);

    var workspace = LitModel.normalizeWorkspace({
      papers: papers, notes: notes, folders: folders, tagColorRecords: tagColorRecords
    });
    return { workspace: workspace, report: report, assets: assets };
  }

  return {
    mapLibrary: mapLibrary,
    htmlToMarkdown: htmlToMarkdown,
    parseExtra: parseExtra
  };
});
