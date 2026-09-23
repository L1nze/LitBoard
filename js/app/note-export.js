/* LitBoard 笔记导出 Word：markdown/富文本 → 段落计划（文本/图片/引文域混排）→
 * docx 生成 + 参考文献表。摘录块与引用节点转可刷新引文域，未解析 paperId 回退纯文本。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitNoteExport = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var T = options.T;
    var toast = options.toast || function () {};
    var desktop = options.desktop();
    var state = options.state;
    var getById = options.getById || function () { return null; };
    var stamp = options.stamp || function () { return new Date().toISOString().slice(0, 10); };
    var store = options.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
    var docxLib = options.docxLib || (typeof window !== 'undefined' ? window.LitDocx : null);
    var csldoc = options.csldoc || (typeof window !== 'undefined' ? window.LitCslDoc : null);
    var csl = options.csl || (typeof window !== 'undefined' ? window.LitCsl : null);
    var noteml = options.noteml || (typeof window !== 'undefined' ? window.LitNoteMl : null);
    var excerpt = options.excerpt || (typeof window !== 'undefined' ? window.LitExcerpt : null);

    /* ---- 笔记导出 Word（阶段三下半）：文本/图片混排 + 摘录块与引用节点 → 可刷新引文域 ---- */
    function exportNoteToWord(note) {
      if (!desktop) { toast(T('导出 Word 需要桌面版')); return; }
      if (!note) { toast(T('请先选择或新建一篇笔记')); return; }
      if (!docxLib || !csldoc || !noteml || !csl || !excerpt) {
        toast(T('导出模块未加载')); return;
      }
      var html = note.format === 'richtext'
        ? noteml.sanitizeHtml(note.content)
        : noteml.markdownToHtml(note.content);
      var md = noteml.htmlToMarkdown(html);
      var styleId = store.getItem('litboard.cslStyle') || 'apa';
      var isBuiltin = csl.BUILTIN_STYLES.some(function (s) { return s.id === styleId; });
      var stylePromise = isBuiltin
        ? fetch('vendor/citeproc/styles/' + styleId + '.csl').then(function (r) {
            if (!r.ok) throw new Error(T('样式文件缺失'));
            return r.text();
          })
        : desktop.fetchCslStyle(styleId);
      Promise.all([
        stylePromise,
        fetch('vendor/citeproc/locales/zh-CN.xml').then(function (r) { return r.text(); }),
        desktop.getDataPaths()
      ]).then(function (values) {
        return buildNoteDocx(md, {
          styleXml: values[0], localeXml: values[1], styleId: styleId,
          configDir: values[2] && values[2].configDir || ''
        });
      }).then(function (bytes) {
        return desktop.saveFile({
          name: 'litboard-note-' + stamp() + '.docx',
          bytes: bytes,
          filters: [{ name: T('Word 文档'), extensions: ['docx'] }]
        });
      }).then(function (saved) {
        if (saved) toast(T('✓ 笔记已导出为 Word'));
      }).catch(function (error) {
        toast(T('⚠ 导出失败：') + (error && error.message || error));
      });
    }

    function buildNoteDocx(md, env) {
      var doc = csldoc.createDocument({
        styleXml: env.styleXml, localeXml: env.localeXml, styleId: env.styleId, localeId: 'zh-CN'
      });
      // 预读图片字节（note-assets 相对路径）
      var rels = [];
      md.replace(/!\[[^\]]*\]\((note-assets\/[^)\s]+)\)/g, function (_, rel) { rels.push(rel); return _; });
      var uniqueRels = rels.filter(function (rel, index) { return rels.indexOf(rel) === index; });
      var imageMap = {};
      return doc.updateLibrary(state.papers.filter(function (p) { return !p.deletedAt; }))
        .then(function () {
          return Promise.all(uniqueRels.map(function (rel) {
            if (!env.configDir) return Promise.resolve(null);
            var abs = env.configDir.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\');
            var readBytes = desktop && (desktop.readFileBytes || desktop.readBytes);
            if (!readBytes) return Promise.resolve(null);
            return readBytes.call(desktop, abs).then(function (bytes) {
              var ext = (rel.match(/\.[a-z0-9]{1,8}$/i) || ['.png'])[0].toLowerCase();
              imageMap[rel] = { data: bytes, ext: ext };
            }).catch(function () {});
          }));
        })
        .then(function () {
          // 块级切分：lbex 摘录块与正文交错
          var spans = excerpt.parseExcerpts(md);
          var segments = [];
          var pos = 0;
          spans.forEach(function (span) {
            if (span.start > pos) segments.push({ type: 'text', md: md.slice(pos, span.start) });
            segments.push({ type: 'excerpt', span: span });
            pos = span.end;
          });
          if (pos < md.length) segments.push({ type: 'text', md: md.slice(pos) });
          // 顺序执行：每个引用节点一次 addCitation
          var paragraphs = [];
          var chain = Promise.resolve();
          function pushCitationRun(paperId, extras, fallbackText) {
            return doc.addCitation({ items: [Object.assign({ paperId: paperId }, extras || {})] })
              .then(function (result) {
                var cluster = doc.toJSON().citations.filter(function (c) { return c.id === result.citationId; })[0];
                paragraphs.push({ runs: [{ citation: { payload: cluster, text: result.text } }] });
              })
              .catch(function () {
                paragraphs.push({ text: fallbackText || (T('（未找到文献 ') + paperId + '）') });
              });
          }
          segments.forEach(function (segment) {
            if (segment.type === 'excerpt') {
              chain = chain.then(function () {
                if (segment.span.quote) paragraphs.push({ text: segment.span.quote });
                if (segment.span.comment) paragraphs.push({ text: segment.span.comment });
                if (!getById(segment.span.paperId)) {
                  if (!segment.span.quote && !segment.span.comment) {
                    paragraphs.push({ text: T('（来源文献不在库中）') });
                  }
                  return;
                }
                return pushCitationRun(segment.span.paperId, {});
              });
              return;
            }
            mdSegmentToParagraphs(segment.md).forEach(function (para) {
              chain = chain.then(function () {
                var runChain = Promise.resolve();
                var runs = [];
                para.parts.forEach(function (part) {
                  runChain = runChain.then(function () {
                    if (part.text != null) {
                      runs.push(part.bold ? { text: part.text, bold: true } : { text: part.text });
                    } else if (part.imageRel) {
                      if (imageMap[part.imageRel]) runs.push({ image: imageMap[part.imageRel] });
                    } else if (part.cite) {
                      return pushCitationRunInto(runs, part.cite);
                    }
                  });
                });
                return runChain.then(function () {
                  if (runs.length) paragraphs.push({ runs: runs });
                });
              });
            });
          });
          function pushCitationRunInto(runs, cite) {
            if (!getById(cite.paperId)) {
              runs.push({ text: cite.label || (T('（未找到文献 ') + cite.paperId + '）') });
              return Promise.resolve();
            }
            return doc.addCitation({ items: [{
              paperId: cite.paperId,
              locator: cite.locator || '',
              label: cite.labelParam || '',
              prefix: cite.prefix || '',
              suffix: cite.suffix || '',
              suppressAuthor: !!cite.suppressAuthor
            }] }).then(function (result) {
              var cluster = doc.toJSON().citations.filter(function (c) { return c.id === result.citationId; })[0];
              runs.push({ citation: { payload: cluster, runs: csl.htmlToRuns(result.text) } });
            }).catch(function () {
              runs.push({ text: cite.label || cite.paperId });
            });
          }
          return chain.then(function () {
            if (doc.citationCount() > 0) {
              paragraphs.push({ runs: [{ text: T('参考文献'), bold: true }] });
              var bibFormat = doc.getBibliographyFormat();
              doc.getBibliography().forEach(function (entry) {
                paragraphs.push(Object.assign({ runs: csl.htmlToRuns(entry) }, bibFormat));
              });
            }
            return docxLib.buildDocx(paragraphs);
          });
        });
    }

    /** markdown 文本段 → 段落计划（纯文本/图片/引用链接拆 run；标题加粗） */
    function mdSegmentToParagraphs(md) {
      var lines = md.replace(/\r\n?/g, '\n').split('\n');
      var out = [];
      var buffer = [];
      function flush() {
        if (!buffer.length) return;
        var raw = buffer.join('\n');
        buffer = [];
        out.push({ parts: inlineMdParts(raw) });
      }
      lines.forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed) { flush(); return; }
        if (/^```/.test(trimmed)) { flush(); return; }
        var heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
          flush();
          out.push({ parts: [{ text: heading[2], bold: true }] });
          return;
        }
        var imageOnly = trimmed.match(/^!\[[^\]]*\]\((note-assets\/[^)\s]+)\)$/);
        if (imageOnly) {
          flush();
          out.push({ parts: [{ imageRel: imageOnly[1] }] });
          return;
        }
        buffer.push(trimmed.replace(/^[-*+]\s+|^\d+[.)]\s+/, ''));
      });
      flush();
      return out;
    }

    var CITE_LINK_RE = /\[([^\]]+)\]\(litboard:\/\/open\/paper\/([A-Za-z0-9_-]{1,120})(?:\?([^\s)]+))?\)/g;
    function inlineMdParts(raw) {
      var parts = [];
      var last = 0;
      var match;
      CITE_LINK_RE.lastIndex = 0;
      while ((match = CITE_LINK_RE.exec(raw))) {
        if (match.index > last) parts.push({ text: raw.slice(last, match.index) });
        var params = {};
        if (match[3]) {
          match[3].split('&').forEach(function (pair) {
            var kv = pair.split('=');
            try { params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); } catch (e) {}
          });
        }
        parts.push({
          cite: {
            paperId: match[2],
            label: match[1],
            locator: params.locator || '',
            labelParam: params.label || '',
            prefix: params.prefix || '',
            suffix: params.suffix || '',
            suppressAuthor: params.suppressAuthor === '1'
          }
        });
        last = match.index + match[0].length;
      }
      if (last < raw.length) parts.push({ text: raw.slice(last) });
      // 清掉残留 md 记号（加粗等）
      parts.forEach(function (part) {
        if (part.text != null) {
          part.text = part.text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[`*_]/g, '').trim();
          if (!part.text) part.text = '';
        }
      });
      return parts.filter(function (part) { return part.text == null || part.text !== ''; });
    }


    return {
      exportWord: exportNoteToWord,
      _test: {
        buildNoteDocx: buildNoteDocx,
        mdSegmentToParagraphs: mdSegmentToParagraphs,
        inlineMdParts: inlineMdParts
      }
    };
  }

  return { create: create };
});
