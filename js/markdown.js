/* LitBoard Markdown：markdown-it 适配层（浏览器 / Node 共用）
 *
 * 渲染内核为 vendored markdown-it（vendor/markdown-it/，MIT，classic script 挂
 * window.markdownit；Node 侧走 require）。本文件只保留 LitBoard 的领域定制，
 * 对外契约不变：render(markdown) → html、setAssetBase / assetBase。
 * - 图片 ![](path)：白名单 http(s) / file:// / note-assets/（经 assetBase 拼成 file://），
 *   其余一律剥成纯文本（esc(alt || src)），绝不注入；
 * - litboard://open/paper/... 内部链接 → <a data-internal="1">（应用内点击拦截跳转，
 *   不弹外部浏览器）；http(s) 链接 → target=_blank rel=noopener；其他协议保持字面文本；
 * - <!--lbex {...} --> 摘录块：begin…end 整块消费，内部引用行合并为一个 blockquote
 *   并追加定位锚 <a class="lb-excerpt-loc">；data-lbex 保留原始 JSON 串，保证
 *   md → html → md 往返不丢出处；
 * - 数学公式只「原样保住 + 标明边界」：$...$ → span.lb-math，行内 $$…$$ →
 *   span.lb-math.lb-math-block，独立行 $$…$$（可跨行）与 \[…\] → div.lb-math.lb-math-block
 *   （样式在 css/style.css；AI 对话层由 MathJax 排版）。
 */
(function (root, factory) {
  var MarkdownIt = root && root.markdownit;
  if (!MarkdownIt && typeof module === 'object' && module.exports) {
    try { MarkdownIt = require('../vendor/markdown-it/markdown-it.min.js'); } catch (e) { MarkdownIt = null; }
  }
  var api = factory(MarkdownIt);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitMarkdown = api;
})(typeof window !== 'undefined' ? window : null, function (MarkdownIt) {
  'use strict';

  var assetBase = ''; // 渲染层启动时设为 file:///<configDir>/（note-assets 相对路径拼接用）
  function setAssetBase(value) { assetBase = String(value || ''); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function resolveImageSrc(src) {
    var value = String(src || '');
    if (/^https?:\/\//i.test(value)) return value;
    if (/^file:\/\//i.test(value)) return value;
    if (/^note-assets\//.test(value) && assetBase) {
      return assetBase.replace(/\/+$/, '') + '/' + value;
    }
    return '';
  }

  var LBEX_BEGIN = /^<!--lbex (\{.*\}) -->\s*$/;
  var LBEX_END = /^<!--\/lbex-->\s*$/;
  var LBEX_QUOTE = /^>\s?(.*)$/;
  var MATH_SINGLE = /^\s*\$\$(.*?)\$\$\s*$/;
  var MATH_DD_OPEN = /^\s*\$\$\s*$/;
  var MATH_DD_START = /^\s*\$\$(.+)$/;
  var MATH_BRACKET_OPEN = /^\s*\\\[\s*$/;

  /* ---------------- 摘录块（lbex）块规则 ----------------
   * begin…end 整块消费；内部连续的 `> ` 引用行合并为一个 blockquote，其余非空行
   * 按普通段落渲染（摘录的个人评论就是这段落）。meta 非法或缺 paperId 时退化为普通
   * blockquote（保持旧实现的紧凑形态），定位锚参数只在有值时出现。 */
  function lbexBlock(state, startLine, endLine, silent) {
    var begin = LBEX_BEGIN.exec(
      state.src.slice(state.bMarks[startLine], state.eMarks[startLine]));
    if (!begin) return false;
    var closeLine = -1;
    for (var scan = startLine + 1; scan < endLine; scan++) {
      if (LBEX_END.test(state.src.slice(state.bMarks[scan], state.eMarks[scan]))) {
        closeLine = scan;
        break;
      }
    }
    if (closeLine < 0) return false; // 标记不成对时不消费，保持字面文本
    if (silent) return true;

    var meta = null;
    try { meta = JSON.parse(begin[1]); } catch (e) { meta = null; }

    var html = '', quoteBuf = [], paraBuf = [];
    function flushQuote() {
      if (!quoteBuf.length) return;
      var body = quoteBuf.map(function (line) {
        return state.md.renderInline(line, state.env);
      }).join('<br>');
      if (meta && meta.paperId) {
        var params = [];
        if (meta.attachmentId) params.push('attachment=' + encodeURIComponent(meta.attachmentId));
        if (meta.annotationId) params.push('annotation=' + encodeURIComponent(meta.annotationId));
        if (meta.pageIndex != null) params.push('page=' + (Number(meta.pageIndex) + 1));
        var url = 'litboard://open/paper/' + encodeURIComponent(meta.paperId) +
          (params.length ? '?' + params.join('&') : '');
        body += '<a class="lb-excerpt-loc" href="' + esc(url) + '">↩ ' +
          esc(meta.pageIndex != null ? 'p.' + (Number(meta.pageIndex) + 1) : '定位') + '</a>';
        // 保留结构化元数据（begin 标记里的原始 JSON 串），保证 md → html → md 往返不丢出处
        html += '<blockquote class="lb-excerpt" data-lbex="' + esc(begin[1]) + '">' + body + '</blockquote>';
      } else {
        html += '<blockquote>' + body + '</blockquote>';
      }
      quoteBuf = [];
    }
    function flushPara() {
      if (!paraBuf.length) return;
      html += '<p>' + state.md.renderInline(paraBuf.join(' '), state.env) + '</p>';
      paraBuf = [];
    }
    for (var line = startLine + 1; line < closeLine; line++) {
      var raw = state.src.slice(state.bMarks[line], state.eMarks[line]);
      var quote = LBEX_QUOTE.exec(raw);
      if (quote) { flushPara(); quoteBuf.push(quote[1]); }
      else if (!raw.trim()) { flushQuote(); flushPara(); }
      else { flushQuote(); paraBuf.push(raw.trim()); }
    }
    flushQuote();
    flushPara();

    var token = state.push('lbex', '', 0);
    token.block = true;
    token.map = [startLine, closeLine + 1];
    token.content = html;
    state.line = closeLine + 1;
    return true;
  }

  /* ---------------- 数学块规则 ----------------
   * 独立行 $$…$$（同行或跨行，包括正文与起止符同行）与 \[ … \] → div.lb-math.lb-math-block；起止标记
   * 不成对时不消费（保持字面文本），与旧实现的行级语义一致。 */
  function mathBlock(state, startLine, endLine, silent) {
    var text = state.src.slice(
      state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
    var single = MATH_SINGLE.exec(text);
    var endMarker = '';
    var bodyLines = [];
    var nextLine = startLine + 1;
    if (single) {
      bodyLines.push(single[1]);
    } else {
      var doubleStart = MATH_DD_START.exec(text);
      if (MATH_DD_OPEN.test(text)) endMarker = '$$';
      else if (doubleStart) {
        endMarker = '$$';
        bodyLines.push(doubleStart[1]);
      } else if (MATH_BRACKET_OPEN.test(text)) endMarker = '\\]';
      else return false;
      var closeLine = -1;
      for (var scan = startLine + 1; scan < endLine; scan++) {
        var raw = state.src.slice(state.bMarks[scan], state.eMarks[scan]);
        if (endMarker === '$$') {
          var close = /^(.*?)\$\$\s*$/.exec(raw);
          if (close) {
            if (close[1]) bodyLines.push(close[1]);
            closeLine = scan;
            break;
          }
        } else if (raw.trim() === endMarker) { closeLine = scan; break; }
        bodyLines.push(raw);
      }
      if (closeLine < 0) return false;
      nextLine = closeLine + 1;
    }
    if (silent) return true;
    var token = state.push('math_block', '', 0);
    token.block = true;
    token.map = [startLine, nextLine];
    token.content = bodyLines.join('\n');
    state.line = nextLine;
    return true;
  }

  /* ---------------- 数学行内规则（必须先于 emphasis）----------------
   * 公式里的 _ 与 * 是 LaTeX 语法，交给强调规则会被吃掉——$x_1 + y_2$ 曾渲染成
   * x<em>1 + y</em>2。边界判定沿用 KaTeX auto-render 的保守规则（开符前非词字符、
   * 开符后非空白、闭符前非空白、闭符后不接数字），$5-$10 这类金额不误判；
   * 行内 $$…$$ 保持兼容：在段落内排版为 display math（span.lb-math-block）。 */
  function mathInline(state, silent) {
    var start = state.pos;
    var src = state.src;
    if (src.charCodeAt(start) !== 0x24 /* $ */) return false;

    if (src.charCodeAt(start + 1) === 0x24) {
      var doubleClose = src.indexOf('$$', start + 2);
      if (doubleClose < 0) return false;
      var doubleBody = src.slice(start + 2, doubleClose);
      if (!doubleBody || doubleBody.indexOf('\n') >= 0) return false;
      if (!silent) {
        var doubleToken = state.push('math_inline_block', '', 0);
        doubleToken.markup = '$$';
        doubleToken.content = doubleBody;
      }
      state.pos = doubleClose + 2;
      return true;
    }

    // 单 $：开符前不是词字符或 $（词字符前导不算，如 US$5）
    if (start > 0 && /[\w$]/.test(src.charAt(start - 1))) return false;
    if (start + 1 >= state.posMax || /\s/.test(src.charAt(start + 1))) return false;
    var close = src.indexOf('$', start + 1);
    if (close < 0) return false;
    var body = src.slice(start + 1, close);
    // 体至少 1 字符、不跨行、闭符前非空白、闭符后不接数字（$5-$10 不算）
    if (!body || body.indexOf('\n') >= 0 || /\s$/.test(body)) return false;
    if (close + 1 < state.posMax && /\d/.test(src.charAt(close + 1))) return false;
    if (!silent) {
      var token = state.push('math_inline', '', 0);
      token.markup = '$';
      token.content = body;
    }
    state.pos = close + 1;
    return true;
  }

  /* ---------------- 图片规则（经 ruler.at 整体接管原 image 规则）----------------
   * 与旧实现同一判定形态 ![alt](src)；src 白名单（http(s) / file:// / note-assets/）
   * 在 renderer 侧判定——markdown-it 默认 validateLink 拒绝 file:，会让 file://
   * 图片退回字面文本，故不能依赖原规则的解析。 */
  var IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)/;
  function imageRule(state, silent) {
    var match = IMAGE_RE.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) {
      var token = state.push('image', 'img', 0);
      token.attrs = [['src', match[2]]];
      token.content = match[1];
    }
    state.pos += match[0].length;
    return true;
  }

  var md = null;
  if (MarkdownIt) {
    md = MarkdownIt({ html: false, linkify: false });

    // 链接白名单与旧实现一致：只有 http(s) 与 litboard://open/paper/ 成锚，
    // 其余协议（javascript:、file:、mailto:、相对路径……）一律保持字面文本。
    md.validateLink = function (url) {
      var value = String(url || '');
      if (/^litboard:\/\//i.test(value)) return /^litboard:\/\/open\/paper\//i.test(value);
      return /^https?:\/\//i.test(value);
    };

    md.block.ruler.before('table', 'lbex', lbexBlock,
      { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.block.ruler.before('table', 'math_block', mathBlock,
      { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.inline.ruler.before('emphasis', 'math_inline', mathInline, {});
    md.inline.ruler.at('image', imageRule, {});

    var defaultLinkOpen = md.renderer.rules.link_open ||
      function (tokens, idx, options, env, self) { return self.renderToken(tokens, idx, options); };
    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      var href = tokens[idx].attrGet('href') || '';
      if (/^litboard:\/\//i.test(href)) {
        tokens[idx].attrSet('data-internal', '1');
      } else if (/^https?:\/\//i.test(href)) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener');
      }
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    md.renderer.rules.image = function (tokens, idx) {
      var src = tokens[idx].attrGet('src') || '';
      var alt = tokens[idx].content == null ? '' : String(tokens[idx].content);
      var resolved = resolveImageSrc(src);
      return resolved
        ? '<img src="' + esc(resolved) + '" alt="' + esc(alt) + '">'
        : esc(alt || src);
    };

    md.renderer.rules.math_inline = function (tokens, idx) {
      return '<span class="lb-math">' + esc(tokens[idx].content) + '</span>';
    };
    md.renderer.rules.math_inline_block = function (tokens, idx) {
      return '<span class="lb-math lb-math-block">' + esc(String(tokens[idx].content).trim()) + '</span>';
    };
    md.renderer.rules.math_block = function (tokens, idx) {
      return '<div class="lb-math lb-math-block">' + esc(String(tokens[idx].content).trim()) + '</div>\n';
    };
    md.renderer.rules.lbex = function (tokens, idx) {
      return tokens[idx].content + '\n';
    };

    md.renderer.rules.table_open = function () {
      return '<div class="lb-table-wrap"><table class="lb-markdown-table">\n';
    };
    md.renderer.rules.table_close = function () { return '</table></div>\n'; };
  }

  function render(markdown) {
    if (!md) throw new Error('LitMarkdown: markdown-it is not loaded (vendor/markdown-it missing)');
    return md.render(String(markdown == null ? '' : markdown));
  }

  return { render: render, setAssetBase: setAssetBase, assetBase: function () { return assetBase; } };
});
