/* LitReflow：PDF 重排阅读的分析层（阶段六）。
 * UMD 双出口，纯函数（输入 PDF.js getTextContent 原始 items，输出阅读序文本块），Node 可测。
 * 启发式规则（刻意简单、可降级）：
 *  - 行聚簇：|y 差| ≤ 行高中位数×0.6 视为同一行；行内按 x 排序拼接
 *  - 词间空格：相邻 item 间隙 > 行高×0.25 补空格（CJK 无间隙自然连排）
 *  - 栏检测：行宽 ≥ 页宽×0.7 判为通栏（标题/摘要/页脚）不拆栏；
 *    其余行按 x 重叠（重叠 > 行宽 50%）贪心聚类成栏，栏间按 x 排序
 *  - 通栏行按 y 穿插到栏序结果中（栏首行之前 / 末尾）
 *  - 栏数 > 2 时退化：全部按 y、x 单栏排序（三栏以上版式不做猜测）
 *  - 段落：相邻行 y 间距 > 行高中位数×1.9 → 新段落
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LitReflow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v, d) { var n = Number(v); return Number.isFinite(n) ? n : (d || 0); }

  /**
   * pdf.js textContent items → 行数组 [{text, x, y, w, h, page}]
   * items: [{str, transform:[a,b,c,d,e,f], width, height}]
   */
  function linesFromItems(items, pageIndex) {
    var raw = (items || []).filter(function (it) {
      return it && typeof it.str === 'string' && it.str.trim() && Array.isArray(it.transform);
    });
    if (!raw.length) return [];
    var heights = raw.map(function (it) { return Math.abs(num(it.transform[3])); })
      .filter(function (h) { return h > 0; }).sort(function (a, b) { return a - b; });
    var lineH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
    var tol = lineH * 0.6;
    var prepared = raw.map(function (it) {
      return {
        str: it.str,
        x: num(it.transform[4]),
        y: num(it.transform[5]),
        w: num(it.width, Math.abs(num(it.str.length * lineH * 0.5))),
        h: Math.abs(num(it.transform[3])) || lineH
      };
    });
    prepared.sort(function (a, b) { return a.y - b.y; });
    var lines = [];
    prepared.forEach(function (it) {
      var last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) <= tol) {
        last.items.push(it);
        last.y = (last.y * (last.items.length - 1) + it.y) / last.items.length;
        last.h = Math.max(last.h, it.h);
      } else {
        lines.push({ y: it.y, h: it.h, items: [it] });
      }
    });
    var spaceGap = lineH * 0.25;
    // 同一 y 簇内再按 x 间隙切段：间隙 > 行高×1.8 视为跨栏，拆成独立行（栏检测的前提）
    var breakGap = lineH * 1.8;
    var outLines = [];
    lines.forEach(function (line) {
      line.items.sort(function (a, b) { return a.x - b.x; });
      var segs = [[]];
      var endX = null;
      line.items.forEach(function (it) {
        if (endX != null && it.x - endX > breakGap) segs.push([]);
        segs[segs.length - 1].push(it);
        endX = Math.max(endX == null ? -Infinity : endX, it.x + (it.w || 0));
      });
      segs.forEach(function (seg) {
        if (seg.length) outLines.push({ y: line.y, h: line.h, items: seg });
      });
    });
    return outLines.map(function (line) {
      var text = '';
      var endX = null;
      line.items.forEach(function (it) {
        if (endX != null && it.x - endX > spaceGap) text += ' ';
        text += it.str;
        endX = Math.max(endX == null ? -Infinity : endX, it.x + (it.w || 0));
      });
      var xs = line.items.map(function (it) { return it.x; });
      var x1 = Math.max.apply(null, line.items.map(function (it) { return it.x + (it.w || 0); }));
      return {
        text: text.replace(/\s+/g, ' ').trim(),
        x: Math.min.apply(null, xs),
        y: line.y,
        w: Math.max(1, x1 - Math.min.apply(null, xs)),
        h: line.h,
        page: pageIndex == null ? 0 : pageIndex
      };
    }).filter(function (l) { return l.text; });
  }

  function overlapWidth(a0, a1, b0, b1) {
    return Math.min(a1, b1) - Math.max(a0, b0);
  }

  /**
   * 行数组（单页）→ 阅读序段落块 [{type:'p', text, page}]
   * pageWidth 缺省取行最大右缘（调用方应传 viewport.width 更可靠）
   */
  function readingOrder(lines, pageWidth) {
    if (!lines || !lines.length) return [];
    var pw = num(pageWidth, 0);
    if (!pw) pw = Math.max.apply(null, lines.map(function (l) { return l.x + l.w; }).concat([1]));
    var heights = lines.map(function (l) { return l.h; }).sort(function (a, b) { return a - b; });
    var lineH = heights[Math.floor(heights.length / 2)] || 10;

    var fulls = [], rest = [];
    lines.forEach(function (l) { (l.w >= pw * 0.7 ? fulls : rest).push(l); });

    var cols = [];
    rest.slice().sort(function (a, b) { return a.x - b.x; }).forEach(function (l) {
      var col = null;
      for (var i = 0; i < cols.length; i++) {
        if (overlapWidth(l.x, l.x + l.w, cols[i].x0, cols[i].x1) > l.w * 0.5) { col = cols[i]; break; }
      }
      if (col) {
        col.lines.push(l);
        col.x0 = Math.min(col.x0, l.x);
        col.x1 = Math.max(col.x1, l.x + l.w);
      } else {
        cols.push({ x0: l.x, x1: l.x + l.w, lines: [l] });
      }
    });

    var chunks;
    if (cols.length > 2) {
      // 三栏以上不做猜测：退化单栏（先 y 降序后 x）
      var single = rest.slice().sort(function (a, b) {
        return Math.abs(a.y - b.y) <= lineH * 0.6 ? a.x - b.x : b.y - a.y;
      }).concat(fulls.slice().sort(function (a, b) { return b.y - a.y; }));
      chunks = [single];
    } else {
      cols.sort(function (a, b) { return a.x0 - b.x0; });
      // PDF 坐标 y 向上：阅读序 = y 降序
      cols.forEach(function (c) { c.lines.sort(function (a, b) { return b.y - a.y; }); });
      fulls.sort(function (a, b) { return b.y - a.y; });
      // 通栏行拆分：高于所有栏首行 → 开头；其余（页脚/夹中）→ 结尾
      var colsTopY = Math.max.apply(null, cols.map(function (c) { return c.lines.length ? c.lines[0].y : -Infinity; }).concat([-Infinity]));
      var headFulls = fulls.filter(function (l) { return l.y > colsTopY; });
      var tailFulls = fulls.filter(function (l) { return l.y <= colsTopY; });
      chunks = [];
      headFulls.forEach(function (l) { chunks.push([l]); });
      cols.forEach(function (c) { chunks.push(c.lines.slice()); });
      tailFulls.forEach(function (l) { chunks.push([l]); });
    }

    // 段落合并：块内相邻行 y 间距 > 1.9×行高 → 新段落（块间不跨并）
    var blocks = [];
    chunks.forEach(function (chunk) {
      var prev = null;
      chunk.forEach(function (l) {
        if (prev && prev.y - l.y <= lineH * 1.9) {
          prev.block.text += ' ' + l.text;
          prev.y = l.y;
        } else {
          var block = { type: 'p', text: l.text, page: l.page };
          blocks.push(block);
          prev = { y: l.y, block: block };
        }
      });
      prev = null;
    });
    return blocks;
  }

  return { linesFromItems: linesFromItems, readingOrder: readingOrder };
});
