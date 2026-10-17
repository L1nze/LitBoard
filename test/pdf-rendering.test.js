'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function loadPdfModule() {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');
  const context = {
    URL,
    window: {},
    document: { baseURI: 'file:///litboard/' }
  };
  vm.runInNewContext(source, context);
  return context.window.LitPdf;
}

/** searchPageText 已删除（产品搜索走 handle.search 的 worker 分块路径）：
 *  断言迁移到活路径 buildPageSearchIndex + runPageSearch——它们仍是 handle.search
 *  的兼容回退实现，也是 worker 侧搜索核心的对拍参照。 */
function searchItems(api, items, query, options) {
  return api.runPageSearch(api.buildPageSearchIndex(items), query, options);
}

/** 在 Node vm 里求值 mupdf-worker.js（懒加载改造后无顶层 dynamic import），
 *  经 LitPdfWorkerSearchExpose 钩子取 worker 侧搜索核心引用 */
function loadWorkerSearchCore() {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'js', 'mupdf-worker.js'), 'utf8');
  let exposed = null;
  const context = {};
  context.self = context; // self === globalThis（onmessage 顶层赋值可落地）
  context.LitPdfWorkerSearchExpose = function (core) { exposed = core; };
  vm.runInNewContext(source, context);
  assert.ok(exposed && typeof exposed.searchItems === 'function', 'worker 暴露搜索核心');
  return exposed;
}

test('MuPDF module worker is the only packaged PDF engine; raster pixels map 1:1 and the renderer toggle is gone', function () {
  const pdfSource = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(root, 'js', 'mupdf-worker.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

  assert.match(pdfSource, /MuPDF\.js 单内核/);
  assert.match(workerSource, /import\('\.\.\/vendor\/mupdf\/mupdf\.js'\)/);
  assert.match(html, /js\/mupdf-client\.js/);
  ['mupdf.js', 'mupdf-wasm.js', 'mupdf-wasm.wasm', 'LICENSE'].forEach(function (name) {
    assert.ok(fs.statSync(path.join(root, 'vendor', 'mupdf', name)).size > 0);
  });

  // 默认：位图精确等于 devicePixelRatio——合成期零重采样，边缘不带灰晕
  const ratio = loadPdfModule().renderPixelRatio;
  assert.equal(ratio({ width: 800, height: 1100 }, 1.25), 1.25);
  assert.equal(ratio({ width: 800, height: 1100 }, 2), 2);
  assert.equal(ratio({ width: 800, height: 1100 }, 1), 1);
  // 显式倍率（离屏导出/测试）优先于 dpr
  assert.equal(ratio({ width: 800, height: 1100 }, 1, 4), 4);
  // 内存护栏：大页/高 dpr 下按 maxCanvasPixels 平方根收顶（24M RGBA ≈ 96MB/页）
  const viewport = { width: 4000, height: 5000 };
  const capped = ratio(viewport, 2);
  assert.ok(capped < 2, 'oversized page should hit the canvas pixel cap');
  assert.ok(viewport.width * viewport.height * capped * capped <= 25165824 + 1);

  // renderer 切换已从 PDF 工具栏与持久化位置移除
  assert.doesNotMatch(html, /pdf-renderer-toggle/);
  assert.doesNotMatch(appSource, /pdfState\.renderer/);
});

test('formula fixture contains embedded font programs for fidelity regression', function () {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'embedded-formula.pdf')).toString('latin1');
  // pdfTeX stores the font dictionaries in compressed object streams, while
  // the embedded Type 1 font program streams expose their three lengths.
  assert.match(fixture, /\/Length1\s+\d+/);
  assert.match(fixture, /\/Length2\s+\d+/);
});

test('PDF selection geometry trims character rects (default, real font metrics, fallback) and merges adjacent fragments', function () {
  const geometry = loadPdfModule().selectionGeometry;
  // 默认按比例裁剪行盒，字符端点不动
  const rect = geometry.normalizeCharacterRect({
    left: 10, top: 20, right: 50, bottom: 40, width: 40, height: 20
  }, 0);

  assert.equal(rect.left, 10);
  assert.equal(rect.right, 50);
  assert.ok(Math.abs(rect.height - 17.2) < 1e-9);
  assert.ok(Math.abs(rect.top - 21.4) < 1e-9);

  // 真实字体度量：行盒 17.68px（line-height:1 的最小行盒），字体 Arial 度量：ascent 10.86 / descent 2.54
  const metrics = { fontSize: 12, ascent: 10.86, descent: 2.54 };
  const rectMetrics = geometry.normalizeCharacterRect({
    left: 10, top: 20, right: 50, bottom: 37.68, width: 40, height: 17.68
  }, 0, metrics);

  assert.equal(rectMetrics.left, 10);
  assert.equal(rectMetrics.right, 50);
  // baseline = 20 + (17.68-13.4)/2 + 10.86 = 33.0
  assert.ok(Math.abs(rectMetrics.top - 22.14) < 1e-9);
  assert.ok(Math.abs(rectMetrics.bottom - 35.54) < 1e-9);
  assert.ok(Math.abs(rectMetrics.height - 13.4) < 1e-9);

  // 度量缺失时回退按比例裁剪
  const rectFallback = geometry.normalizeCharacterRect({
    left: 10, top: 20, right: 50, bottom: 37.68, width: 40, height: 17.68
  }, 0, null);
  assert.ok(Math.abs(rectFallback.height - 17.68 * 0.86) < 1e-9);

  // 相邻片段矩形合并，跨行保留
  const merged = geometry.mergeRects([
    { left: 10, top: 10, right: 30, bottom: 20, width: 20, height: 10 },
    { left: 31, top: 10, right: 50, bottom: 20, width: 19, height: 10 },
    { left: 10, top: 24, right: 40, bottom: 34, width: 30, height: 10 }
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].left, 10);
  assert.equal(merged[0].right, 50);
  assert.equal(merged[1].top, 24);
});

test('PDF selection uses text-layer character offsets instead of page-level range boxes', function () {
  const source = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');

  assert.match(source, /textLayer\.textDivs/);
  assert.match(source, /selectedTextDivs\(range, sheet\._litTextDivs, bands\)/);
  assert.match(source, /fragmentClientRects\(fragment\)/);
  assert.doesNotMatch(source, /var clientRects = Array\.prototype\.slice\.call\(range\.getClientRects\(\)\)/);
});

// ---------- 文本层几何：逐字 quad 是唯一来源 ----------
// 中文 PDF 的替代字体排版会把行盒拉长/压到相邻行（「选四五个字，高亮拉长或
// 压到下一行」）。文本层因此不再靠浏览器重排：span 的位置/宽度来自 MuPDF 的
// 逐字 quad，选区高亮直接切这份几何。
function muLine(text, x, top, size, advance) {
  const sizes = new Float32Array(text.length);
  const quads = new Float32Array(text.length * 8);
  for (let i = 0; i < text.length; i++) {
    const cx = x + advance * i;
    const o = i * 8;
    sizes[i] = size;
    quads[o] = cx; quads[o + 1] = top;
    quads[o + 2] = cx + advance; quads[o + 3] = top;
    quads[o + 4] = cx; quads[o + 5] = top + size;
    quads[o + 6] = cx + advance; quads[o + 7] = top + size;
  }
  return { bbox: [x, top, x + advance * text.length, top + size], wmode: 0, dir: [1, 0],
    font: '', size: size, text: text, sizes: sizes, quads: quads };
}

test('MuPDF page text keeps per-character quads (whitespace-only lines dropped) and maps them to viewport rects', function () {
  const geometry = loadPdfModule().selectionGeometry;
  const pageData = {
    lines: [muLine('磷酸铁锂电池', 99.3, 135.5, 12, 12), muLine('   ', 99.3, 155.5, 12, 12)]
  };
  const content = geometry.textItems(pageData, [0, 0, 595.32, 842.04]);

  assert.equal(content.items.length, 1, '纯空白行不建 span（空盒会被选区误命中）');
  const item = content.items[0];
  assert.equal(item.str, '磷酸铁锂电池');
  assert.equal(item.muQuads.length, item.str.length * 8, '每个 UTF-16 码元各占一份 quad');
  assert.equal(item.muSizes.length, item.str.length);
  // 行 bbox 的左缘与纵向位置原样保留（MuPDF 左上原点 → transform 用页高翻回）
  assert.equal(item.muBox[0], 99.3);
  assert.ok(Math.abs(item.transform[5] - (842.04 - 135.5)) < 1e-6);
  assert.equal(item.transform[3], 12);

  // 页高 800、缩放 2：MuPDF (x, top) → 视口 (2x, 2top)
  const contentVp = geometry.textItems({ lines: [muLine('硕士', 408, 100, 15, 15)] }, [0, 0, 600, 800]);
  const itemVp = contentVp.items[0];
  const viewport = { convertMuRect: function (rect) {
    return [rect[0] * 2, rect[1] * 2, rect[2] * 2, rect[3] * 2];
  } };
  const rects = geometry.charViewportRects(itemVp, viewport);

  assert.equal(rects.length, 2);
  assert.equal(rects[0][0], 816);
  assert.equal(rects[1][0], 846);
  // 「硕士」两个字：并集宽度恰好是两倍字宽
  const fragment = geometry.fragmentViewportRect({
    textContent: itemVp.str, _litCharRects: rects, _litBox: [816, 200, 876, 230]
  }, 0, 2);
  assert.equal(fragment.rect[0], 816);
  assert.equal(fragment.rect[2], 876);
});

test('text layer stores per-character geometry for fragment highlights', function () {
  const source = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');

  // span 上挂逐字矩形与视口盒；片段矩形优先切这份几何，只有缺失时才退回 Range
  assert.match(source, /span\._litCharRects = charRects/);
  assert.match(source, /span\._litBox = \[/);
  assert.match(source, /var precise = muFragmentViewportRect\(fragment\.div, fragment\.start, fragment\.end\)/);
  assert.match(source, /sx = boxWidth > 0 \? client\.width \/ boxWidth : 1/);
  // 文本层与搜索流必须用同一个 items 过滤条件（textDivs 下标 = fragment.itemIndex）
  assert.match(source, /return item && typeof item\.str === 'string';/);
});

function bandRect(left, top, right, bottom) {
  return { left: left, top: top, right: right, bottom: bottom,
    width: right - left, height: bottom - top };
}

test('focus line trim drops barely-entered lines (boundary, paragraph gap, single-line, rotated, invalid) and dropBandLine removes the whole line', function () {
  const geometry = loadPdfModule().selectionGeometry;
  // 两行行盒：y 100–120 / 124–144（4px 行距）。行高 20 → eps = 6px
  const bands = [bandRect(10, 100, 300, 120), bandRect(10, 124, 300, 144)];

  // 正向拖选，鼠标只越过下行行带顶端 1px → 剔除该行
  const dropped = geometry.focusLineTrim(bands, 125, true);
  assert.ok(dropped);
  assert.equal(dropped.top, 124);
  // 鼠标进入行带 7px（指到该行文本上）→ 保留
  assert.equal(geometry.focusLineTrim(bands, 131, true), null);
  // 反向拖选：焦点行 = 第一行，鼠标尚未从下方真正进入（距行带底 2px）→ 剔除
  const droppedBack = geometry.focusLineTrim(bands, 118, false);
  assert.ok(droppedBack);
  assert.equal(droppedBack.top, 100);
  // 反向且鼠标已深入第一行 → 保留
  assert.equal(geometry.focusLineTrim(bands, 108, false), null);

  // 段间距 32px：鼠标停在段间空白（越过上一行底 20px）不应选中下一段
  const para = [bandRect(10, 100, 300, 120), bandRect(10, 152, 300, 172)];
  const droppedPara = geometry.focusLineTrim(para, 140, true);
  assert.ok(droppedPara);
  assert.equal(droppedPara.top, 152);
  assert.equal(geometry.focusLineTrim(para, 161, true), null);

  // 单行选区永不剔除（唯一行不可能被误选）
  assert.equal(geometry.focusLineTrim([bandRect(10, 100, 300, 120)], 101, true), null);
  // 竖排/旋转文本行盒（高 > 宽）不参与 y 阈值判定
  assert.equal(geometry.focusLineTrim([
    bandRect(10, 100, 30, 140), bandRect(10, 144, 30, 184)
  ], 145, true), null);
  // 非法输入
  assert.equal(geometry.focusLineTrim(null, 100, true), null);
  assert.equal(geometry.focusLineTrim([bandRect(10, 100, 300, 120)], NaN, true), null);

  // dropBandLine：第二行由两个 span 组成（同一行两段矩形），整行全部剔除
  const multiBands = [
    bandRect(10, 100, 300, 120),
    bandRect(10, 124, 150, 144), bandRect(152, 124, 300, 144)
  ];
  const kept = geometry.dropBandLine(multiBands, { left: 10, top: 124, right: 300, bottom: 144,
    width: 290, height: 20 });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].top, 100);
});

// ---------- 阅读器内搜索：命中 → textDivs 高亮的对齐与准度 ----------
// PDF.js TextLayer 的 textDivs 与「str 有定义的 items（含空串）」逐项对齐，
// 搜索流必须用同一数组，否则空串 item 之后所有命中整体错位（高亮画到别的行）。
function fakeTextDivs(items) {
  return items.map(function (item) { return { textContent: item.str }; });
}

function fragmentText(items, fragments) {
  return fragments.map(function (fragment) {
    return items[fragment.itemIndex].str.slice(fragment.start, fragment.end);
  }).join('');
}

test('reader search maps fragments across items: empty-slot div alignment, split words without false spaces', function () {
  const api = loadPdfModule();
  const items = [
    { str: 'shown in figure (a) and ' },
    { str: '', hasEOL: true },            // 空 item：占一个 div 槽位但不进 DOM
    { str: 'snapshot' },                  // 真正的命中
    { str: ' whenever useful' },
    { str: '', hasEOL: true },
    { str: 'free of charge' }
  ];
  const matches = searchItems(api, items, 'snapshot');
  assert.equal(matches.length, 1);
  const divs = fakeTextDivs(items);
  matches[0].fragments.forEach(function (fragment) {
    const slice = divs[fragment.itemIndex].textContent.slice(fragment.start, fragment.end);
    assert.ok(slice.length > 0, 'fragment must select text from its own div');
    assert.equal(slice, items[fragment.itemIndex].str.slice(fragment.start, fragment.end));
  });
  assert.equal(fragmentText(items, matches[0].fragments), 'snapshot');

  // 同一行内因字体/TJ 数组断开的两个 chunk 之间没有空格字形，join(' ') 会拆散单词
  const splitItems = [{ str: 'snaps' }, { str: 'hot' }, { str: ' of the' }];
  const splitMatches = searchItems(api, splitItems, 'snapshot');
  assert.equal(splitMatches.length, 1);
  assert.equal(fragmentText(splitItems, splitMatches[0].fragments), 'snapshot');
  // 跨 realm（vm 上下文）对象不用 deepStrictEqual，比较序列化形态
  assert.equal(JSON.stringify(splitMatches[0].fragments), JSON.stringify([
    { itemIndex: 0, start: 0, end: 5 },
    { itemIndex: 1, start: 0, end: 3 }
  ]));
});

test('reader search joins phrases across line breaks and resolves hyphenation', function () {
  const api = loadPdfModule();
  const lines = [
    { str: 'at the end of' , hasEOL: true },
    { str: 'line text' }
  ];
  const phrase = searchItems(api, lines, 'end of line');
  assert.equal(phrase.length, 1);
  assert.equal(fragmentText(lines, phrase[0].fragments), 'end ofline'); // 片段拼接近似（行界不属任何 div）
  assert.equal(phrase[0].text, 'end of\nline');                          // match.text 保留行界换行

  // 行尾连字符 + 换行 = 断词，检索时应还原整词（高亮盖住两段）
  const hyphenated = [
    { str: 'a sig-', hasEOL: true },
    { str: 'nificant result' }
  ];
  const joined = searchItems(api, hyphenated, 'significant');
  assert.equal(joined.length, 1);
  assert.equal(fragmentText(hyphenated, joined[0].fragments), 'significant');
  // 行中连字符不受影响
  assert.equal(searchItems(api, [{ str: 'well-known' }], 'well-known').length, 1);
});

test('reader search match basics: folding (case, ligature, fullwidth, whitespace), CJK boundaries, multiple matches', function () {
  const api = loadPdfModule();
  // 连字 ﬁ → fi
  assert.equal(searchItems(api, [{ str: '\uFB01le system' }], 'file').length, 1);
  // 全角 → 半角
  assert.equal(searchItems(api, [{ str: '\uFF34\uFF45\uFF58\uFF54' }], 'Text').length, 1);
  // 不换行空格 / 连续空白折叠为单空格
  assert.equal(searchItems(api, [{ str: 'a\u00A0\u00A0b' }], 'a b').length, 1);
  assert.equal(searchItems(api, [{ str: 'a  b' }], 'a  b'.replace(/\s+/g, ' ')).length, 1);
  // 大小写
  assert.equal(searchItems(api, [{ str: 'Snapshot' }], 'SNAPSHOT').length, 1);
  // 空白 needle 不产生命中
  assert.equal(JSON.stringify(searchItems(api, [{ str: 'text' }], '   ')), '[]');

  // CJK 行界不插空格，跨行仍可命中
  const cjkItems = [
    { str: '\u4E2D\u6587\u6587\u732E', hasEOL: true },
    { str: '\u68C0\u7D22\u51C6\u5EA6' }
  ];
  assert.equal(searchItems(api, cjkItems, '\u6587\u732E\u68C0\u7D22').length, 1);
  // 拉丁行界折叠为单空格：跨行词组仍可命中
  const latin = [
    { str: 'target', hasEOL: true },
    { str: 'text' }
  ];
  assert.equal(searchItems(api, latin, 'target text').length, 1);

  // 多个不重叠命中与命中文本上报
  const multiMatches = searchItems(api, [{ str: 'the cat and the dog and the bird' }], 'the');
  assert.equal(multiMatches.length, 3);
  assert.equal(multiMatches[0].text, 'the');
  assert.equal(multiMatches[2].fragments[0].start, 24);
});

test('reader search options: caseSensitive and wholeWord keep folding and boundaries consistent', function () {
  const api = loadPdfModule();
  const items = [{ str: 'Snapshot snapshot SNAPSHOT' }];
  assert.equal(searchItems(api, items, 'snapshot').length, 3); // 默认忽略大小写
  const cs = searchItems(api, items, 'snapshot', { caseSensitive: true });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].fragments[0].start, 9);
  assert.equal(searchItems(api, items, 'Snapshot', { caseSensitive: true }).length, 1);
  assert.equal(searchItems(api, items, 'SNAPSHOT', { caseSensitive: true }).length, 1);
  // 区分大小写与 NFKC 折叠共存：全角/连字照常折叠，只是不再小写化
  assert.equal(searchItems(api, [{ str: '\uFF34\uFF45\uFF58\uFF54' }], 'Text', { caseSensitive: true }).length, 1);
  assert.equal(searchItems(api, [{ str: '\uFF34\uFF45\uFF58\uFF54' }], 'text', { caseSensitive: true }).length, 0);
  assert.equal(searchItems(api, [{ str: '\uFB01le' }], 'file', { caseSensitive: true }).length, 1);
  assert.equal(searchItems(api, [{ str: '\uFB01le' }], 'File', { caseSensitive: true }).length, 0);

  // 全字匹配：嵌入式命中被否决后逐位推进，跨 item 命中照常映射片段
  const wordItems = [{ str: 'the theory is thematic; the cat' }];
  assert.equal(searchItems(api, wordItems, 'the').length, 4); // the/theory/thematic/the
  const whole = searchItems(api, wordItems, 'the', { wholeWord: true });
  assert.equal(whole.length, 2);
  assert.equal(whole[0].fragments[0].start, 0);
  assert.equal(whole[1].fragments[0].start, 24);
  // 被否决的命中之后逐位推进：有效命中可能与否决部分重叠
  assert.equal(searchItems(api, [{ str: 'cat catcat cat' }], 'cat', { wholeWord: true }).length, 2);
  // 跨 item 的全字命中照常映射片段
  const split = searchItems(api, [{ str: 'a big ' }, { str: 'cat and cats' }], 'cat', { wholeWord: true });
  assert.equal(split.length, 1);
  assert.deepEqual([split[0].fragments[0].itemIndex, split[0].fragments[0].end], [1, 3]);
  // CJK 不是词字符（与 JS \b 同语义）：邻接汉字视作边界
  assert.equal(searchItems(api, [{ str: '\u7F51\u7EDC\u68C0\u7D22' }], '\u68C0\u7D22', { wholeWord: true }).length, 1);
  // 与区分大小写叠加
  assert.equal(searchItems(api, [{ str: 'The the' }], 'The', { caseSensitive: true, wholeWord: true }).length, 1);
});

test('reader search app wiring: options UI bound and all rendered pages repainted on query change', function () {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

  assert.match(html, /id="pdf-search-case"/);
  assert.match(html, /id="pdf-search-word"/);
  assert.match(appSource, /bindPdfSearchOption\('#pdf-search-case', 'litboard\.pdfSearchCase'\)/);
  assert.match(appSource, /bindPdfSearchOption\('#pdf-search-word', 'litboard\.pdfSearchWord'\)/);
  assert.match(appSource, /caseSensitive:\s*pdfSearchOptionOn\('#pdf-search-case'\)/);
  assert.match(appSource, /wholeWord:\s*pdfSearchOptionOn\('#pdf-search-word'\)/);
  // 换查询只重画「当前命中页」会把旧查询的高亮残留在其它已渲染页上
  // （逐字输入时每个中间态各跳一次页，残留成数轮旧高亮叠加）；
  // renderSearchLayer 对空结果也会先移除旧层，重画全部已渲染页即同时完成清理
  assert.match(appSource, /function repaintAllPdfSearchHighlights/);
  assert.match(appSource, /repaintAllPdfSearchHighlights\(\);\s*goToPdfSearchResult\(1\)/);
});

test('searchPageText 死代码已删除；搜索经 handle.search 的 worker 分块路径主链接线', function () {
  const api = loadPdfModule();
  const pdfSource = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');

  assert.ok(!('searchPageText' in api), 'LitPdf 不再导出 searchPageText（产品搜索走 pdfsearch.js / handle.search，此包装器仅测试在用）');
  assert.doesNotMatch(pdfSource, /function searchPageText/, '实现一并删除');
  assert.match(pdfSource, /searchDocumentChunk/, 'handle.search 主路径走 worker 侧 searchDocument 分块');
  assert.ok(typeof api.buildPageSearchIndex === 'function' && typeof api.runPageSearch === 'function',
    '纯函数仍导出：handle.search 兼容回退与 worker 对拍都依赖它们');
});

// ---------- worker 侧搜索核心 与 渲染侧纯函数 对拍 ----------
// worker 的 searchDocument 在 WASM 侧逐页折叠匹配（免逐页 RPC 与逐字 quad 负载），
// 其命中片段必须与渲染层逐字对齐（itemIndex = textDivs 下标），因此两套实现
// 用同一份 fixture 对拍：任一侧改折叠/行界/全字规则，本用例即红。
test('worker 搜索核心与渲染侧纯函数逐位一致（同一 fixture 对拍）', function () {
  const api = loadPdfModule();
  const worker = loadWorkerSearchCore();
  const fixtures = [
    { str: 'shown in figure (a) and ' }, { str: '', hasEOL: true }, { str: 'snapshot' },
    { str: ' whenever useful' }, { str: '', hasEOL: true }, { str: 'free of charge' }
  ];
  const split = [{ str: 'snaps' }, { str: 'hot' }, { str: ' of the' }];
  const lines = [{ str: 'at the end of', hasEOL: true }, { str: 'line text' }];
  const hyphenated = [{ str: 'a sig-', hasEOL: true }, { str: 'nificant result' }];
  const cjk = [{ str: '\u4E2D\u6587\u6587\u732E', hasEOL: true }, { str: '\u68C0\u7D22\u51C6\u5EA6' }];
  const latin = [{ str: 'target', hasEOL: true }, { str: 'text' }];
  const folding = [{ str: '\uFB01le system \uFF34\uFF45\uFF58\uFF54 a\u00A0\u00A0b  the cat' }];
  const word = [{ str: 'the theory is thematic; the cat catcat' }];
  const cases = [
    [fixtures, 'snapshot', null],
    [split, 'snapshot', null],
    [lines, 'end of line', null],
    [hyphenated, 'significant', null],
    [hyphenated, 'sig-', null],
    [cjk, '\u6587\u732E\u68C0\u7D22', null],
    [cjk, '\u68C0\u7D22', { wholeWord: true }],
    [latin, 'target text', null],
    [folding, 'file', null],
    [folding, 'TEXT', null],
    [folding, 'text', { caseSensitive: true }],
    [folding, 'a b', null],
    [folding, 'cat', null],
    [folding, 'cat', { wholeWord: true }],
    [word, 'the', null],
    [word, 'the', { wholeWord: true }],
    [word, 'The', { caseSensitive: true, wholeWord: true }],
    [[{ str: 'text' }], '   ', null],
    [[{ str: 'a big ' }, { str: 'cat and cats' }], 'cat', { wholeWord: true }]
  ];
  cases.forEach(function (item) {
    const rendererSide = searchItems(api, item[0], item[1], item[2]);
    const workerSide = worker.searchItems(item[0], item[1], item[2]);
    assert.equal(JSON.stringify(workerSide), JSON.stringify(rendererSide),
      'worker 与渲染侧结果不一致: ' + JSON.stringify(item[1]) + ' ' + JSON.stringify(item[2]));
  });
});

// ---------- 位图 LRU（releasePage 不再立即销毁位图） ----------
test('bitmap LRU：命中刷新热度、超限逐最旧淘汰（close 显式释放）、整体失效', function () {
  const api = loadPdfModule();
  const lru = api.createBitmapLru({ maxEntries: 3, maxBytes: 4096 });
  const mkBitmap = function (w, h) {
    return { width: w, height: h, bitmap: { closed: false, close: function () { this.closed = true; } } };
  };
  const byteOf = function (w, h) { return w * h * 4; };

  assert.ok(lru.put('a', mkBitmap(8, 8)));
  const bitmapB = mkBitmap(8, 8);
  assert.ok(lru.put('b', bitmapB));
  assert.ok(lru.put('c', mkBitmap(8, 8)));
  assert.equal(lru.size(), 3);
  assert.equal(lru.bytes(), byteOf(8, 8) * 3);

  assert.ok(lru.use('a'), '命中 a 并刷新热度');
  assert.ok(lru.put('d', mkBitmap(8, 8)), '入第 4 条触发淘汰');
  assert.equal(lru.size(), 3);
  assert.strictEqual(lru.use('b'), null, '最旧的 b 被淘汰');
  assert.equal(bitmapB.bitmap.closed, true, '淘汰即显式 close');
  assert.ok(lru.use('a') && lru.use('c') && lru.use('d'), '其余条目健在');

  // 内存上限：条数未满但字节超限同样逐最旧淘汰
  const tight = api.createBitmapLru({ maxEntries: 10, maxBytes: byteOf(8, 8) });
  assert.ok(tight.put('x', mkBitmap(8, 8)));
  assert.ok(tight.put('y', mkBitmap(8, 8)));
  assert.equal(tight.size(), 1, '字节超限淘汰最旧');
  assert.strictEqual(tight.use('x'), null);
  assert.ok(tight.use('y'));

  // 单条超内存上限（异常巨页）：拒绝入缓存，调用方自行释放
  const tiny = api.createBitmapLru({ maxEntries: 4, maxBytes: 64 });
  const huge = mkBitmap(64, 64);
  assert.strictEqual(tiny.put('huge', huge), false);
  assert.equal(tiny.size(), 0);

  // clear：全部释放（bitmap close 可观察），缓存归零
  const bitmapC = mkBitmap(8, 8);
  lru.put('c2', bitmapC);
  lru.clear();
  assert.equal(lru.size(), 0);
  assert.equal(lru.bytes(), 0);
  assert.strictEqual(lru.use('c2'), null);
  assert.equal(bitmapC.bitmap.closed, true, 'clear 释放全部位图');
});
