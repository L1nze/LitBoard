/* LitBoard PDF 批注互操作：写回标准批注到 PDF 文件 / 读取 PDF 内已有批注（浏览器 / Node 共用）
 *
 * 写回走 pdf-lib 低层字典（Highlight/Underline/Text + QuadPoints），
 * 读取走 PDF.js getAnnotations。坐标均为 PDF 用户空间（左下原点），与库内模型一致。
 */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('../vendor/pdflib/pdf-lib.min.js') : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitPdfAnnot = api;
})(typeof window !== 'undefined' ? window : null, function (nodePdfLib) {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  function pdfLib() {
    if (nodePdfLib) return nodePdfLib;
    if (typeof window !== 'undefined' && window.PDFLib) return window.PDFLib;
    throw new Error(T('pdf-lib 未加载'));
  }

  function hexToRgb(hex) {
    var m = String(hex || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return [1, 0.84, 0];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  }

  function pdfDate(timestamp) {
    var d = new Date(timestamp || Date.now());
    function pad(n) { return String(n).padStart(2, '0'); }
    return 'D:' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + 'Z';
  }

  /**
   * 把 LitBoard 批注写入 PDF 字节，返回 { bytes, written, skipped }。
   * - highlight → /Highlight，underline → /Underline，note → /Text（便签）
   * - 已存在同 /NM 的批注自动跳过（幂等，可重复写回）
   * - snapshot/ink 类型不写回（非标准批注），计入 skipped
   */
  async function writeAnnotations(pdfBytes, annotations) {
    var lib = pdfLib();
    var PDFName = lib.PDFName, PDFArray = lib.PDFArray, PDFHexString = lib.PDFHexString;
    var doc = await lib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    var pages = doc.getPages();
    var byPage = {};
    (annotations || []).forEach(function (ann) {
      if (!ann || !ann.position) return;
      var page = ann.position.pageIndex;
      (byPage[page] = byPage[page] || []).push(ann);
    });
    var written = 0, skipped = 0;
    Object.keys(byPage).forEach(function (pageIndexText) {
      var pageIndex = Number(pageIndexText);
      var page = pages[pageIndex];
      if (!page) { skipped += byPage[pageIndexText].length; return; }
      var context = doc.context;
      var annots = page.node.lookup(PDFName.of('Annots'), PDFArray) || (function () {
        var arr = context.obj([]);
        page.node.set(PDFName.of('Annots'), arr);
        return arr;
      })();
      var existingNames = {};
      for (var i = 0; i < annots.size(); i++) {
        var dict = annots.lookup(i);
        var nm = dict && typeof dict.lookup === 'function' ? dict.lookup(PDFName.of('NM')) : null;
        if (nm && typeof nm.decodeText === 'function') existingNames[nm.decodeText()] = true;
      }
      byPage[pageIndexText].forEach(function (ann) {
        if (ann.type === 'snapshot' || ann.type === 'ink') { skipped++; return; }
        if (existingNames[ann.id]) { skipped++; return; }
        var color = hexToRgb(ann.color);
        var base = {
          Type: 'Annot',
          C: color,
          CA: 1,
          Contents: PDFHexString.fromText(ann.comment || ann.text || ''),
          T: PDFHexString.fromText('LitBoard'),
          NM: PDFHexString.fromText(String(ann.id)),
          M: PDFHexString.fromText(pdfDate(ann.updatedAt)),
          F: 4
        };
        if (ann.type === 'note') {
          var rect = ann.position.rects[0];
          base.Subtype = 'Text';
          base.Name = 'Comment';
          base.Rect = [rect[0], rect[3], rect[0] + 20, rect[3] + 20];
        } else {
          var quads = [];
          var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          ann.position.rects.forEach(function (r) {
            minX = Math.min(minX, r[0]); minY = Math.min(minY, r[1]);
            maxX = Math.max(maxX, r[2]); maxY = Math.max(maxY, r[3]);
            // QuadPoints 顺序：左上、右上、左下、右下
            quads.push(r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]);
          });
          base.Subtype = ann.type === 'underline' ? 'Underline' : 'Highlight';
          base.Rect = [minX, minY, maxX, maxY];
          base.QuadPoints = quads;
        }
        annots.push(context.register(context.obj(base)));
        existingNames[ann.id] = true;
        written++;
      });
    });
    var bytes = await doc.save();
    return { bytes: bytes, written: written, skipped: skipped };
  }

  /**
   * 读取 PDF 内已有批注（经 PDF.js 文档对象）→ LitBoard 批注数组。
   * id 形如 "pdfjs-<page>-<index>"，供导入时按 id/位置去重。
   */
  async function readAnnotations(pdfjsDoc) {
    var out = [];
    if (!pdfjsDoc) return out;
    var now = Date.now();
    for (var p = 1; p <= pdfjsDoc.numPages; p++) {
      var page = await pdfjsDoc.getPage(p);
      var items = [];
      try { items = await page.getAnnotations({ intent: 'display' }); } catch (e) { items = []; }
      items.forEach(function (item, index) {
        var typeMap = { Highlight: 'highlight', Underline: 'underline', Squiggly: 'underline', Text: 'note' };
        var type = typeMap[item.subtype];
        if (!type || !item.rect) return;
        var rects = [];
        if (Array.isArray(item.quadPoints) && item.quadPoints.length) {
          item.quadPoints.forEach(function (quad) {
            var xs = quad.map(function (pt) { return pt.x; });
            var ys = quad.map(function (pt) { return pt.y; });
            rects.push([Math.min.apply(null, xs), Math.min.apply(null, ys),
              Math.max.apply(null, xs), Math.max.apply(null, ys)]);
          });
        } else {
          rects.push([item.rect[0], item.rect[1], item.rect[2], item.rect[3]]);
        }
        var color = '#ffd400';
        if (item.color && typeof item.color.length === 'number' && item.color.length >= 3) {
          color = '#' + [item.color[0], item.color[1], item.color[2]]
            .map(function (c) { return Math.round(c).toString(16).padStart(2, '0'); }).join('');
        }
        out.push({
          id: 'pdfjs-' + (p - 1) + '-' + index,
          type: type,
          color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffd400',
          text: '',
          comment: String(item.contents || ''),
          position: { pageIndex: p - 1, rects: rects },
          createdAt: now,
          updatedAt: now
        });
      });
    }
    return out;
  }

  return { writeAnnotations: writeAnnotations, readAnnotations: readAnnotations, hexToRgb: hexToRgb };
});
