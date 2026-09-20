/* LitBoard 摘录节点：批注 → 笔记的可解析 Markdown 块（浏览器 / Node 共用）
 *
 * 格式契约（生成与解析同处，改动需同步测试）：
 *
 *   <!--lbex {"v":1,"paperId":"p1","paperTitle":"…","attachmentId":"a1","annotationId":"ann1","pageIndex":4,"sourceUpdatedAt":1700000000000} -->
 *   > 摘录快照第一行
 *   > 第二行
 *
 *   个人评论（可无）
 *
 *   <!--/lbex-->
 *
 * 摘录元数据随 note.content 走（同步/备份零新增）；「来源已更新」用 sourceUpdatedAt 与
 * 当前批注 updatedAt 比对判定；定位链接为 litboard://open/paper/<id>?attachment=…&annotation=…&page=…。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitExcerpt = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  var MARKER_BEGIN = /^<!--lbex (\{.*\}) -->\s*$/;
  var MARKER_END = /^<!--\/lbex-->\s*$/;

  function escQuote(value) {
    return text(value).replace(/\r\n?/g, '\n').trim();
  }

  /** 出处定位链接（page 为 1 起页码） */
  function buildLocateUrl(meta) {
    var params = [];
    if (meta.attachmentId) params.push('attachment=' + encodeURIComponent(meta.attachmentId));
    if (meta.annotationId) params.push('annotation=' + encodeURIComponent(meta.annotationId));
    if (meta.pageIndex != null) params.push('page=' + (Number(meta.pageIndex) + 1));
    // EPUB 批注：CFI 定位（阶段六）
    if (meta.epubcfi) params.push('epubcfi=' + encodeURIComponent(meta.epubcfi));
    return 'litboard://open/paper/' + encodeURIComponent(meta.paperId || '') +
      (params.length ? '?' + params.join('&') : '');
  }

  /**
   * 生成摘录块。input = { paperId, paperTitle, attachmentId, annotationId, pageIndex,
   *   sourceUpdatedAt, quote, comment }
   */
  function buildExcerpt(input) {
    var meta = {
      v: 1,
      paperId: text(input && input.paperId),
      paperTitle: text(input && input.paperTitle).slice(0, 200),
      attachmentId: text(input && input.attachmentId),
      annotationId: text(input && input.annotationId),
      pageIndex: input && input.pageIndex != null ? Number(input.pageIndex) : null,
      epubcfi: text(input && input.epubcfi).slice(0, 2000),
      sourceUpdatedAt: input && input.sourceUpdatedAt != null ? Number(input.sourceUpdatedAt) : null
    };
    var quote = escQuote(input && input.quote);
    var comment = escQuote(input && input.comment);
    var lines = ['<!--lbex ' + JSON.stringify(meta) + ' -->'];
    if (quote) {
      quote.split('\n').forEach(function (line) { lines.push('> ' + line); });
    }
    lines.push('');
    if (comment) lines.push(comment);
    lines.push('');
    lines.push('<!--/lbex-->');
    return lines.join('\n');
  }

  /**
   * 解析 content 中的全部摘录块。未闭合块宽容处理（到下一个标记或文末）。
   * 返回 [{ meta 字段平铺, quote, comment, start, end }]，按出现顺序。
   */
  function parseExcerpts(content) {
    var source = text(content).replace(/\r\n?/g, '\n');
    var lines = source.split('\n');
    var out = [];
    var current = null;
    var quoteLines = [];
    var commentLines = [];
    function flush() {
      if (!current) return;
      current.quote = quoteLines.join('\n').trim();
      current.comment = commentLines.join('\n').trim();
      current.start = current._startOffset;
      current.end = current._cursor;
      delete current._startOffset;
      delete current._cursor;
      out.push(current);
      current = null;
      quoteLines = [];
      commentLines = [];
    }
    var offset = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var begin = MARKER_BEGIN.exec(line);
      var end = MARKER_END.exec(line);
      if (begin) {
        flush();
        var meta = null;
        try { meta = JSON.parse(begin[1]); } catch (e) { meta = null; }
        current = {
          paperId: text(meta && meta.paperId),
          paperTitle: text(meta && meta.paperTitle),
          attachmentId: text(meta && meta.attachmentId),
          annotationId: text(meta && meta.annotationId),
          pageIndex: meta && meta.pageIndex != null ? Number(meta.pageIndex) : null,
          epubcfi: text(meta && meta.epubcfi),
          sourceUpdatedAt: meta && meta.sourceUpdatedAt != null ? Number(meta.sourceUpdatedAt) : null
        };
        current._startOffset = offset;
        current._cursor = offset + line.length;
      } else if (end) {
        if (current) {
          current._cursor = offset + line.length;
          flush();
        }
      } else if (current) {
        var quoteLine = /^>\s?(.*)$/.exec(line);
        if (quoteLine && !commentLines.length) {
          quoteLines.push(quoteLine[1]);
        } else if (line.trim() === '') {
          if (commentLines.length) commentLines.push(''); // 评论内空行
          // 引用与评论之间的空行不归属任何一侧
        } else {
          commentLines.push(line);
        }
        current._cursor = offset + line.length;
      }
      offset += line.length + 1;
    }
    flush();
    return out;
  }

  /**
   * 来源状态比对。resolveAnnotation(annotationId) → 批注对象 | null | undefined。
   * 返回每项 { status: 'fresh'|'changed'|'deleted', excerpt, current? }。
   */
  function staleExcerpts(content, resolveAnnotation) {
    return parseExcerpts(content).map(function (excerpt) {
      var annotation = resolveAnnotation ? resolveAnnotation(excerpt.annotationId, excerpt) : null;
      if (!annotation) return { status: 'deleted', excerpt: excerpt };
      if (excerpt.sourceUpdatedAt != null && Number(annotation.updatedAt) !== Number(excerpt.sourceUpdatedAt)) {
        return { status: 'changed', excerpt: excerpt, current: annotation };
      }
      return { status: 'fresh', excerpt: excerpt };
    });
  }

  /** 原位替换摘录块（「采用来源更新」）：保留 marker 位置，重写引用与评论 */
  function replaceExcerpt(content, excerpt, patch) {
    var source = text(content).replace(/\r\n?/g, '\n');
    var next = buildExcerpt({
      paperId: excerpt.paperId,
      paperTitle: excerpt.paperTitle,
      attachmentId: excerpt.attachmentId,
      annotationId: excerpt.annotationId,
      pageIndex: excerpt.pageIndex,
      epubcfi: excerpt.epubcfi,   // EPUB 定位随行，防止「采用更新/保留」后 CFI 丢失
      sourceUpdatedAt: patch && patch.sourceUpdatedAt != null ? patch.sourceUpdatedAt : excerpt.sourceUpdatedAt,
      quote: patch && patch.quote != null ? patch.quote : excerpt.quote,
      comment: patch && patch.comment != null ? patch.comment : excerpt.comment
    });
    return source.slice(0, excerpt.start) + next + source.slice(excerpt.end);
  }

  /** 「保留」：把 marker 的 sourceUpdatedAt 对齐当前批注，不再提示更新 */
  function markExcerptCurrent(content, excerpt, annotation) {
    return replaceExcerpt(content, excerpt, {
      quote: excerpt.quote,
      comment: excerpt.comment,
      sourceUpdatedAt: annotation && annotation.updatedAt != null ? annotation.updatedAt : excerpt.sourceUpdatedAt
    });
  }

  /** 删除摘录块（连同前后最多一个空行，避免留洞） */
  function removeExcerpt(content, excerpt) {
    var source = text(content).replace(/\r\n?/g, '\n');
    var start = excerpt.start;
    var end = excerpt.end;
    // 吞掉块后紧跟的空行
    while (end < source.length && source[end] === '\n' && source[end + 1] === '\n') end++;
    if (end < source.length && source[end] === '\n') end++;
    return (source.slice(0, start) + source.slice(end)).replace(/\n{3,}/g, '\n\n');
  }

  return {
    buildExcerpt: buildExcerpt,
    parseExcerpts: parseExcerpts,
    staleExcerpts: staleExcerpts,
    replaceExcerpt: replaceExcerpt,
    markExcerptCurrent: markExcerptCurrent,
    removeExcerpt: removeExcerpt,
    buildLocateUrl: buildLocateUrl
  };
});
