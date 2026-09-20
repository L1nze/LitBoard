/* LitBoard 笔记富文本契约层（阶段三下半）：richtext HTML 白名单、引用/摘录节点、md↔html 转换（浏览器 / Node 共用）
 *
 * 编辑器只经本模块进出 HTML：构造即白名单，保存与渲染双清洗（sanitizeHtml）。
 * 摘录节点在 richtext 下为 <blockquote class="lb-excerpt" data-lbex='{json}'>（与 js/excerpt.js
 * 的 markdown 注释形态共享同一 meta 字段与 stale 语义）；引用节点为 <span class="lb-citation">。
 */
(function (root, factory) {
  var md = null, ex = null;
  if (typeof module === 'object' && module.exports) {
    md = require('./markdown.js');
    ex = require('./excerpt.js');
  } else {
    md = root && root.LitMarkdown;
    ex = root && root.LitExcerpt;
  }
  var api = factory(md, ex);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitNoteMl = api;
})(typeof window !== 'undefined' ? window : null, function (LitMarkdown, LitExcerpt) {
  'use strict';

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function esc(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function unesc(value) {
    return text(value).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
  }
  function stripTags(html) {
    return unesc(text(html).replace(/<[^>]*>/g, '')).trim();
  }
  /** stripTags 的块级版：<br> 还原为换行 */
  function blockText(html) {
    return stripTags(text(html).replace(/<br\s*\/?>/g, '\n'));
  }
  function validId(value) { return /^[A-Za-z0-9_-]{1,120}$/.test(text(value)) ? text(value) : ''; }
  function validHttpUrl(value) { return /^https?:\/\//i.test(text(value)) ? text(value) : ''; }
  function validFileUrl(value) { return /^file:\/\//i.test(text(value)) ? text(value) : ''; }
  function validNoteAsset(value) { return /^note-assets\/[^\s"']+$/.test(text(value)) ? text(value) : ''; }
  function validImgSrc(value) {
    return validHttpUrl(value) || validFileUrl(value) || validNoteAsset(value);
  }
  function validHref(value) {
    if (validHttpUrl(value)) return text(value);
    if (/^litboard:\/\/open\/paper\/[A-Za-z0-9_-]{1,120}[^\s"'<>]*$/.test(text(value))) return text(value);
    return '';
  }
  function validJsonAttr(value) {
    if (text(value).length > 2000) return '';
    try { JSON.parse(unesc(value)); return text(value); } catch (e) { return ''; }
  }
  function isNumberAttr(value) { return /^\d{1,3}$/.test(text(value)) ? text(value) : ''; }
  function classIs(value, allowed) { return text(value) === allowed ? allowed : ''; }

  /* ---------------- sanitize（白名单重建） ---------------- */
  var BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'p', 'br', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'strong', 'em', 'b', 'i', 'u', 'a', 'img', 'table', 'tr', 'td', 'th', 'span'];
  var ATTR_FILTERS = {
    a: { href: validHref, title: text, 'class': function (v) { return classIs(v, 'lb-excerpt-loc'); } },
    img: { src: validImgSrc, alt: text },
    span: {
      'data-paperid': validId,
      'data-locator': function (v) { return text(v).slice(0, 40); },
      'data-label': function (v) { return text(v).slice(0, 200); },
      'data-prefix': function (v) { return text(v).slice(0, 200); },
      'data-suffix': function (v) { return text(v).slice(0, 200); },
      'data-suppressauthor': function (v) { return v === 'true' ? 'true' : ''; },
      'class': function (v) { return classIs(v, 'lb-citation'); }
    },
    blockquote: {
      'data-lbex': validJsonAttr,
      'class': function (v) { return classIs(v, 'lb-excerpt'); }
    },
    p: { 'class': function (v) { return classIs(v, 'lbex-comment'); } },
    td: { colspan: isNumberAttr, rowspan: isNumberAttr },
    th: { colspan: isNumberAttr, rowspan: isNumberAttr }
  };

  function filterAttrs(tag, attrString) {
    var filters = ATTR_FILTERS[tag] || {};
    var out = '';
    var re = /\b([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
    var match;
    while ((match = re.exec(text(attrString)))) {
      var name = match[1].toLowerCase();
      var filter = filters[name];
      if (!filter) continue;
      var raw = match[2];
      var value = raw.charAt(0) === '"' || raw.charAt(0) === "'" ? raw.slice(1, -1) : raw;
      var clean = filter(unesc(value));
      if (clean) out += ' ' + name + '="' + esc(clean) + '"';
    }
    return out;
  }

  /** 白名单清洗：script/style/注释连内容删除；未登记标签剥壳留内容；属性按标签白名单过滤 */
  function sanitizeHtml(html) {
    var source = text(html)
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    return source.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, function (full, close, name, attrs) {
      var tag = name.toLowerCase();
      if (BLOCK_TAGS.indexOf(tag) === -1) return ''; // 剥壳
      if (close) return '</' + tag + '>';
      if (tag === 'br') return '<br>';
      if (tag === 'img') return '<img' + filterAttrs(tag, attrs || '') + '>';
      return '<' + tag + filterAttrs(tag, attrs || '') + '>';
    });
  }

  /* ---------------- 引用节点 ---------------- */
  function buildCitationHtml(input) {
    var attrs = ' class="lb-citation" data-paperid="' + esc(validId(input && input.paperId) || 'unknown') + '"';
    if (input && input.locator) attrs += ' data-locator="' + esc(text(input.locator).slice(0, 40)) + '"';
    if (input && input.label) attrs += ' data-label="' + esc(text(input.label).slice(0, 200)) + '"';
    if (input && input.prefix) attrs += ' data-prefix="' + esc(text(input.prefix).slice(0, 200)) + '"';
    if (input && input.suffix) attrs += ' data-suffix="' + esc(text(input.suffix).slice(0, 200)) + '"';
    if (input && input.suppressAuthor) attrs += ' data-suppressauthor="true"';
    return '<span' + attrs + '>' + esc(text(input && input.label) || '（引用）') + '</span>';
  }

  function parseCitations(html) {
    var out = [];
    var re = /<span\b([^>]*\blb-citation\b[^>]*)>([\s\S]*?)<\/span>/g;
    var match;
    while ((match = re.exec(text(html)))) {
      var attrs = {};
      var attrRe = /\b([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
      var am;
      while ((am = attrRe.exec(match[1]))) attrs[am[1].toLowerCase()] = unesc(am[2]);
      if (!validId(attrs['data-paperid'])) continue;
      out.push({
        paperId: attrs['data-paperid'],
        locator: attrs['data-locator'] || '',
        label: attrs['data-label'] || '',
        prefix: attrs['data-prefix'] || '',
        suffix: attrs['data-suffix'] || '',
        suppressAuthor: attrs['data-suppressauthor'] === 'true',
        text: stripTags(match[2])
      });
    }
    return out;
  }

  /* ---------------- 摘录节点（richtext 形态） ---------------- */
  function buildExcerptHtml(meta, quote, comment, options) {
    var opts = options || {};
    var isPlain = !!opts.plainText;
    var json = JSON.stringify({
      v: 1,
      paperId: text(meta && meta.paperId),
      paperTitle: text(meta && meta.paperTitle).slice(0, 200),
      attachmentId: text(meta && meta.attachmentId),
      annotationId: text(meta && meta.annotationId),
      pageIndex: meta && meta.pageIndex != null ? Number(meta.pageIndex) : null,
      epubcfi: text(meta && meta.epubcfi).slice(0, 2000),
      sourceUpdatedAt: meta && meta.sourceUpdatedAt != null ? Number(meta.sourceUpdatedAt) : null
    });
    var quoteBody = '';
    if (quote) {
      quoteBody = isPlain ? esc(quote).replace(/\r?\n/g, '<br>') : sanitizeHtml(quote);
    }
    var out = '<blockquote class="lb-excerpt" data-lbex="' + esc(json) + '">' + quoteBody + '</blockquote>';
    if (comment && (isPlain ? text(comment).trim() : stripTags(comment))) {
      var commentBody = isPlain ? esc(comment).replace(/\r?\n/g, '<br>') : sanitizeHtml(comment);
      out += '<p class="lbex-comment">' + commentBody + '</p>';
    }
    return out;
  }

  function parseExcerptBlocks(html) {
    var out = [];
    var re = /<blockquote\b[^>]*\bclass="lb-excerpt"[^>]*\bdata-lbex="([^"]*)"[^>]*>([\s\S]*?)<\/blockquote>(?:\s*<p\b[^>]*\bclass="lbex-comment"[^>]*>([\s\S]*?)<\/p>)?/g;
    var match;
    while ((match = re.exec(text(html)))) {
      var meta = null;
      try { meta = JSON.parse(unesc(match[1])); } catch (e) { meta = null; }
      if (!meta || !meta.paperId) continue;
      out.push({
        paperId: text(meta.paperId),
        paperTitle: text(meta.paperTitle),
        attachmentId: text(meta.attachmentId),
        annotationId: text(meta.annotationId),
        pageIndex: meta.pageIndex != null ? Number(meta.pageIndex) : null,
        epubcfi: text(meta.epubcfi),
        sourceUpdatedAt: meta.sourceUpdatedAt != null ? Number(meta.sourceUpdatedAt) : null,
        quoteText: blockText(match[2]),
        commentText: match[3] ? blockText(match[3]) : ''
      });
    }
    return out;
  }

  function findExcerptBlockSpan(html, annotationId) {
    var re = /<blockquote\b[^>]*\bclass="lb-excerpt"[^>]*\bdata-lbex="([^"]*)"[^>]*>[\s\S]*?<\/blockquote>(?:\s*<p\b[^>]*\bclass="lbex-comment"[^>]*>[\s\S]*?<\/p>)?/g;
    var match;
    while ((match = re.exec(text(html)))) {
      var meta = null;
      try { meta = JSON.parse(unesc(match[1])); } catch (e) { meta = null; }
      if (meta && text(meta.annotationId) === text(annotationId)) {
        return { start: match.index, end: match.index + match[0].length, meta: meta };
      }
    }
    return null;
  }

  function replaceExcerptBlock(html, annotationId, patch) {
    var found = findExcerptBlockSpan(html, annotationId);
    if (!found) return text(html);
    var meta = found.meta;
    var next = buildExcerptHtml({
      paperId: meta.paperId, paperTitle: meta.paperTitle, attachmentId: meta.attachmentId,
      annotationId: meta.annotationId, pageIndex: meta.pageIndex, epubcfi: meta.epubcfi,
      sourceUpdatedAt: patch && patch.sourceUpdatedAt != null ? patch.sourceUpdatedAt : meta.sourceUpdatedAt
    }, patch && patch.quoteText != null ? esc(patch.quoteText).replace(/\n/g, '<br>') : null,
       patch && patch.commentText != null ? esc(patch.commentText).replace(/\n/g, '<br>') : null);
    return text(html).slice(0, found.start) + next + text(html).slice(found.end);
  }
  function markExcerptBlockCurrent(html, annotationId, updatedAt) {
    var found = findExcerptBlockSpan(html, annotationId);
    if (!found) return text(html);
    return replaceExcerptBlock(html, annotationId, { sourceUpdatedAt: updatedAt });
  }
  function removeExcerptBlock(html, annotationId) {
    var found = findExcerptBlockSpan(html, annotationId);
    if (!found) return text(html);
    var next = text(html).slice(0, found.start) + text(html).slice(found.end);
    return next.replace(/\n{3,}/g, '\n\n');
  }

  /* ---------------- html → markdown（专用逆转换，出处与定位保留） ---------------- */
  function locateUrlFromCitation(citation) {
    var params = [];
    if (citation.locator) params.push('locator=' + encodeURIComponent(citation.locator));
    if (citation.label) params.push('label=' + encodeURIComponent(citation.label));
    if (citation.suppressAuthor) params.push('suppressAuthor=1');
    if (citation.prefix) params.push('prefix=' + encodeURIComponent(citation.prefix));
    if (citation.suffix) params.push('suffix=' + encodeURIComponent(citation.suffix));
    return 'litboard://open/paper/' + encodeURIComponent(citation.paperId) + (params.length ? '?' + params.join('&') : '');
  }

  function htmlToMarkdown(html) {
    var source = sanitizeHtml(html);
    var stash = [];
    function stashBlock(block) { stash.push(block); return ' ' + (stash.length - 1) + ' '; }
    // 1) 摘录块 → markdown lbex 块（经 LitExcerpt.buildExcerpt 保证格式一致）
    if (LitExcerpt) {
      source = source.replace(/<blockquote\b[^>]*\bclass="lb-excerpt"[^>]*\bdata-lbex="([^"]*)"[^>]*>([\s\S]*?)<\/blockquote>(?:\s*<p\b[^>]*\bclass="lbex-comment"[^>]*>([\s\S]*?)<\/p>)?/g,
        function (full, json, quoteHtml, commentHtml) {
          var meta = null;
          try { meta = JSON.parse(unesc(json)); } catch (e) { meta = null; }
          if (!meta) return '';
          return stashBlock(LitExcerpt.buildExcerpt({
            paperId: meta.paperId, paperTitle: meta.paperTitle, attachmentId: meta.attachmentId,
            annotationId: meta.annotationId, pageIndex: meta.pageIndex, epubcfi: meta.epubcfi,
            sourceUpdatedAt: meta.sourceUpdatedAt,
            quote: blockText(quoteHtml), comment: commentHtml ? blockText(commentHtml) : ''
          }));
        });
      // 2) 引用节点 → litboard 链接
      source = source.replace(/<span\b([^>]*\blb-citation\b[^>]*)>([\s\S]*?)<\/span>/g, function (full, attrs, inner) {
        var citation = parseCitations('<span ' + attrs + '>' + inner + '</span>')[0];
        if (!citation) return stripTags(inner);
        return '[' + (citation.text || citation.label || '引用') + '](' + locateUrlFromCitation(citation) + ')';
      });
    }
    // 3) 块级结构
    source = source.replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/g, function (_, level, inner) {
      return '\n\n' + new Array(Number(level) + 1).join('#') + ' ' + inlineToMd(inner) + '\n\n';
    });
    source = source.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, function (_, inner) {
      return '\n\n```\n' + stripTags(inner) + '\n```\n\n';
    });
    source = source.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, function (_, inner) {
      return '\n\n```\n' + stripTags(inner) + '\n```\n\n';
    });
    // 表格 → markdown 表（首行 th 为表头）
    source = source.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, function (_, inner) {
      var rows = [];
      var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      var rowMatch;
      while ((rowMatch = rowRe.exec(inner))) {
        var cells = [];
        var cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
        var cellMatch;
        while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(stripTags(cellMatch[1]).replace(/\|/g, '\\|'));
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) return '';
      var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      rows = rows.map(function (r) {
        while (r.length < width) r.push('');
        return r;
      });
      var lines = ['| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(function () { return '---'; }).join(' | ') + ' |'];
      rows.slice(1).forEach(function (r) { lines.push('| ' + r.join(' | ') + ' |'); });
      return '\n\n' + lines.join('\n') + '\n\n';
    });
    source = source.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/g, function (_, inner) {
      var items = [];
      var itemRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
      var m;
      while ((m = itemRe.exec(inner))) items.push('- ' + inlineToMd(m[1]));
      return '\n' + items.join('\n') + '\n';
    });
    source = source.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/g, function (_, inner) {
      var items = [];
      var itemRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
      var m, index = 0;
      while ((m = itemRe.exec(inner))) { index++; items.push(index + '. ' + inlineToMd(m[1])); }
      return '\n' + items.join('\n') + '\n';
    });
    source = source.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g, function (_, inner) {
      var plain = blockText(inner).split('\n').filter(function (l, i, arr) { return l.trim() || i < arr.length - 1; }).join('\n');
      return '\n\n' + plain.split('\n').map(function (line) { return '> ' + line; }).join('\n') + '\n\n';
    });
    source = source.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, function (_, inner) {
      return '\n\n' + inlineToMd(inner) + '\n\n';
    });
    source = source.replace(/<br\s*\/?>/g, '\n');
    // 4) 还原 stash
    source = source.replace(/ (\d+) /g, function (_, index) { return stash[Number(index)] || ''; });
    // 5) 残余行内标签再收一遍（嵌套列表等场景的尾巴）
    source = inlineToMd(source);
    return source.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function inlineToMd(html) {
    var value = text(html);
    value = value.replace(/<img\b[^>]*\bsrc="([^"]*)"[^>]*\balt="([^"]*)"[^>]*>/g, function (_, src, alt) {
      return '![' + unesc(alt) + '](' + unesc(src) + ')';
    });
    value = value.replace(/<img\b[^>]*\bsrc="([^"]*)"[^>]*>/g, function (_, src) {
      return '![](' + unesc(src) + ')';
    });
    value = value.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, function (_, href, inner) {
      return '[' + stripTags(inner) + '](' + unesc(href) + ')';
    });
    value = value.replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**');
    value = value.replace(/<(em|i)>([\s\S]*?)<\/\1>/g, '*$2*');
    value = value.replace(/<code>([\s\S]*?)<\/code>/g, '`$1`');
    return value;
  }

  function markdownToHtml(markdown) {
    return LitMarkdown && LitMarkdown.render ? LitMarkdown.render(markdown) : esc(text(markdown));
  }

  return {
    sanitizeHtml: sanitizeHtml,
    buildCitationHtml: buildCitationHtml,
    parseCitations: parseCitations,
    buildExcerptHtml: buildExcerptHtml,
    parseExcerptBlocks: parseExcerptBlocks,
    replaceExcerptBlock: replaceExcerptBlock,
    markExcerptBlockCurrent: markExcerptBlockCurrent,
    removeExcerptBlock: removeExcerptBlock,
    htmlToMarkdown: htmlToMarkdown,
    markdownToHtml: markdownToHtml,
    stripTags: stripTags,
    blockText: blockText,
    escapeHtml: esc,
    locateUrlFromCitation: locateUrlFromCitation
  };
});
