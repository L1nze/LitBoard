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

test('MuPDF module worker is the only packaged PDF rendering engine', function () {
  const pdfSource = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(root, 'js', 'mupdf-worker.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(pdfSource, /MuPDF\.js 单内核/);
  assert.match(workerSource, /import\('\.\.\/vendor\/mupdf\/mupdf\.js'\)/);
  assert.match(html, /js\/mupdf-client\.js/);
  ['mupdf.js', 'mupdf-wasm.js', 'mupdf-wasm.wasm', 'LICENSE'].forEach(function (name) {
    assert.ok(fs.statSync(path.join(root, 'vendor', 'mupdf', name)).size > 0);
  });
});

test('renderer override is removed from the PDF toolbar and persisted positions', function () {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

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

test('PDF selection geometry trims browser line boxes without changing character endpoints', function () {
  const geometry = loadPdfModule().selectionGeometry;
  const rect = geometry.normalizeCharacterRect({
    left: 10, top: 20, right: 50, bottom: 40, width: 40, height: 20
  }, 0);

  assert.equal(rect.left, 10);
  assert.equal(rect.right, 50);
  assert.ok(Math.abs(rect.height - 17.2) < 1e-9);
  assert.ok(Math.abs(rect.top - 21.4) < 1e-9);
});

test('PDF selection geometry uses real font metrics to keep descenders inside the box', function () {
  const geometry = loadPdfModule().selectionGeometry;
  // 行盒 17.68px（line-height:1 的最小行盒），字体 Arial 度量：ascent 10.86 / descent 2.54
  const metrics = { fontSize: 12, ascent: 10.86, descent: 2.54 };
  const rect = geometry.normalizeCharacterRect({
    left: 10, top: 20, right: 50, bottom: 37.68, width: 40, height: 17.68
  }, 0, metrics);

  assert.equal(rect.left, 10);
  assert.equal(rect.right, 50);
  // baseline = 20 + (17.68-13.4)/2 + 10.86 = 33.0
  assert.ok(Math.abs(rect.top - 22.14) < 1e-9);
  assert.ok(Math.abs(rect.bottom - 35.54) < 1e-9);
  assert.ok(Math.abs(rect.height - 13.4) < 1e-9);
});

test('PDF selection metrics path falls back to proportional trim when metrics are absent', function () {
  const geometry = loadPdfModule().selectionGeometry;
  const rect = geometry.normalizeCharacterRect({
    left: 10, top: 20, right: 50, bottom: 37.68, width: 40, height: 17.68
  }, 0, null);
  assert.ok(Math.abs(rect.height - 17.68 * 0.86) < 1e-9);
});

test('PDF selection geometry merges adjacent fragments but keeps separate lines', function () {
  const geometry = loadPdfModule().selectionGeometry;
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

test('MuPDF page text keeps per-character quads and drops whitespace-only lines', function () {
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
});

test('per-character quads become viewport rects through the page viewport', function () {
  const geometry = loadPdfModule().selectionGeometry;
  const content = geometry.textItems({ lines: [muLine('硕士', 408, 100, 15, 15)] }, [0, 0, 600, 800]);
  const item = content.items[0];
  // 页高 800、缩放 2：MuPDF (x, top) → 视口 (2x, 2top)
  const viewport = { convertMuRect: function (rect) {
    return [rect[0] * 2, rect[1] * 2, rect[2] * 2, rect[3] * 2];
  } };
  const rects = geometry.charViewportRects(item, viewport);

  assert.equal(rects.length, 2);
  assert.equal(rects[0][0], 816);
  assert.equal(rects[1][0], 846);
  // 「硕士」两个字：并集宽度恰好是两倍字宽
  const fragment = geometry.fragmentViewportRect({
    textContent: item.str, _litCharRects: rects, _litBox: [816, 200, 876, 230]
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

test('focus line trim drops the next line when the pointer barely crossed the boundary', function () {
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
});

test('focus line trim tolerates paragraph gaps and ignores single-line or rotated bands', function () {
  const geometry = loadPdfModule().selectionGeometry;
  // 段间距 32px：鼠标停在段间空白（越过上一行底 20px）不应选中下一段
  const para = [bandRect(10, 100, 300, 120), bandRect(10, 152, 300, 172)];
  const dropped = geometry.focusLineTrim(para, 140, true);
  assert.ok(dropped);
  assert.equal(dropped.top, 152);
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
});

test('dropBandLine removes every rect of the dropped line but keeps other lines', function () {
  const geometry = loadPdfModule().selectionGeometry;
  // 第二行由两个 span 组成（同一行两段矩形）
  const bands = [
    bandRect(10, 100, 300, 120),
    bandRect(10, 124, 150, 144), bandRect(152, 124, 300, 144)
  ];
  const kept = geometry.dropBandLine(bands, { left: 10, top: 124, right: 300, bottom: 144,
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

test('reader search keeps fragment itemIndex aligned with text layer divs (empty items occupy slots)', function () {
  const api = loadPdfModule();
  const items = [
    { str: 'shown in figure (a) and ' },
    { str: '', hasEOL: true },            // 空 item：占一个 div 槽位但不进 DOM
    { str: 'snapshot' },                  // 真正的命中
    { str: ' whenever useful' },
    { str: '', hasEOL: true },
    { str: 'free of charge' }
  ];
  const matches = api.searchPageText(items, 'snapshot');
  assert.equal(matches.length, 1);
  const divs = fakeTextDivs(items);
  matches[0].fragments.forEach(function (fragment) {
    const slice = divs[fragment.itemIndex].textContent.slice(fragment.start, fragment.end);
    assert.ok(slice.length > 0, 'fragment must select text from its own div');
    assert.equal(slice, items[fragment.itemIndex].str.slice(fragment.start, fragment.end));
  });
  assert.equal(fragmentText(items, matches[0].fragments), 'snapshot');
});

test('reader search matches words split across items without inserting a false space', function () {
  const api = loadPdfModule();
  // 同一行内因字体/TJ 数组断开的两个 chunk 之间没有空格字形，join(' ') 会拆散单词
  const items = [{ str: 'snaps' }, { str: 'hot' }, { str: ' of the' }];
  const matches = api.searchPageText(items, 'snapshot');
  assert.equal(matches.length, 1);
  assert.equal(fragmentText(items, matches[0].fragments), 'snapshot');
  // 跨 realm（vm 上下文）对象不用 deepStrictEqual，比较序列化形态
  assert.equal(JSON.stringify(matches[0].fragments), JSON.stringify([
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
  const phrase = api.searchPageText(lines, 'end of line');
  assert.equal(phrase.length, 1);
  assert.equal(fragmentText(lines, phrase[0].fragments), 'end ofline'); // 片段拼接近似（行界不属任何 div）
  assert.equal(phrase[0].text, 'end of\nline');                          // match.text 保留行界换行

  // 行尾连字符 + 换行 = 断词，检索时应还原整词（高亮盖住两段）
  const hyphenated = [
    { str: 'a sig-', hasEOL: true },
    { str: 'nificant result' }
  ];
  const joined = api.searchPageText(hyphenated, 'significant');
  assert.equal(joined.length, 1);
  assert.equal(fragmentText(hyphenated, joined[0].fragments), 'significant');
  // 行中连字符不受影响
  assert.equal(api.searchPageText([{ str: 'well-known' }], 'well-known').length, 1);
});

test('reader search folds case, ligatures, fullwidth, and whitespace like PDF.js find', function () {
  const api = loadPdfModule();
  // 连字 ﬁ → fi
  assert.equal(api.searchPageText([{ str: '\uFB01le system' }], 'file').length, 1);
  // 全角 → 半角
  assert.equal(api.searchPageText([{ str: '\uFF34\uFF45\uFF58\uFF54' }], 'Text').length, 1);
  // 不换行空格 / 连续空白折叠为单空格
  assert.equal(api.searchPageText([{ str: 'a\u00A0\u00A0b' }], 'a b').length, 1);
  assert.equal(api.searchPageText([{ str: 'a  b' }], 'a  b'.replace(/\s+/g, ' ')).length, 1);
  // 大小写
  assert.equal(api.searchPageText([{ str: 'Snapshot' }], 'SNAPSHOT').length, 1);
  // 空白 needle 不产生命中
  assert.equal(JSON.stringify(api.searchPageText([{ str: 'text' }], '   ')), '[]');
});

test('reader search keeps CJK boundaries space-free across lines', function () {
  const api = loadPdfModule();
  const items = [
    { str: '\u4E2D\u6587\u6587\u732E', hasEOL: true },
    { str: '\u68C0\u7D22\u51C6\u5EA6' }
  ];
  assert.equal(api.searchPageText(items, '\u6587\u732E\u68C0\u7D22').length, 1);
  // 拉丁行界折叠为单空格：跨行词组仍可命中
  const latin = [
    { str: 'target', hasEOL: true },
    { str: 'text' }
  ];
  assert.equal(api.searchPageText(latin, 'target text').length, 1);
});

test('reader search finds multiple non-overlapping matches and reports match text', function () {
  const api = loadPdfModule();
  const items = [{ str: 'the cat and the dog and the bird' }];
  const matches = api.searchPageText(items, 'the');
  assert.equal(matches.length, 3);
  assert.equal(matches[0].text, 'the');
  assert.equal(matches[2].fragments[0].start, 24);
});

test('reader search match-case option keeps folding consistent on both sides', function () {
  const api = loadPdfModule();
  const items = [{ str: 'Snapshot snapshot SNAPSHOT' }];
  assert.equal(api.searchPageText(items, 'snapshot').length, 3); // 默认忽略大小写
  const cs = api.searchPageText(items, 'snapshot', { caseSensitive: true });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].fragments[0].start, 9);
  assert.equal(api.searchPageText(items, 'Snapshot', { caseSensitive: true }).length, 1);
  assert.equal(api.searchPageText(items, 'SNAPSHOT', { caseSensitive: true }).length, 1);
  // 区分大小写与 NFKC 折叠共存：全角/连字照常折叠，只是不再小写化
  assert.equal(api.searchPageText([{ str: '\uFF34\uFF45\uFF58\uFF54' }], 'Text', { caseSensitive: true }).length, 1);
  assert.equal(api.searchPageText([{ str: '\uFF34\uFF45\uFF58\uFF54' }], 'text', { caseSensitive: true }).length, 0);
  assert.equal(api.searchPageText([{ str: '\uFB01le' }], 'file', { caseSensitive: true }).length, 1);
  assert.equal(api.searchPageText([{ str: '\uFB01le' }], 'File', { caseSensitive: true }).length, 0);
});

test('reader search whole-word option rejects embedded matches and keeps scanning', function () {
  const api = loadPdfModule();
  const items = [{ str: 'the theory is thematic; the cat' }];
  assert.equal(api.searchPageText(items, 'the').length, 4); // the/theory/thematic/the
  const whole = api.searchPageText(items, 'the', { wholeWord: true });
  assert.equal(whole.length, 2);
  assert.equal(whole[0].fragments[0].start, 0);
  assert.equal(whole[1].fragments[0].start, 24);
  // 被否决的命中之后逐位推进：有效命中可能与否决部分重叠
  assert.equal(api.searchPageText([{ str: 'cat catcat cat' }], 'cat', { wholeWord: true }).length, 2);
  // 跨 item 的全字命中照常映射片段
  const split = api.searchPageText([{ str: 'a big ' }, { str: 'cat and cats' }], 'cat', { wholeWord: true });
  assert.equal(split.length, 1);
  assert.deepEqual([split[0].fragments[0].itemIndex, split[0].fragments[0].end], [1, 3]);
  // CJK 不是词字符（与 JS \b 同语义）：邻接汉字视作边界
  assert.equal(api.searchPageText([{ str: '\u7F51\u7EDC\u68C0\u7D22' }], '\u68C0\u7D22', { wholeWord: true }).length, 1);
  // 与区分大小写叠加
  assert.equal(api.searchPageText([{ str: 'The the' }], 'The', { caseSensitive: true, wholeWord: true }).length, 1);
});

test('reader search match-case option wires through app.js search options UI', function () {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

  assert.match(html, /id="pdf-search-case"/);
  assert.match(html, /id="pdf-search-word"/);
  assert.match(appSource, /bindPdfSearchOption\('#pdf-search-case', 'litboard\.pdfSearchCase'\)/);
  assert.match(appSource, /bindPdfSearchOption\('#pdf-search-word', 'litboard\.pdfSearchWord'\)/);
  assert.match(appSource, /caseSensitive:\s*pdfSearchOptionOn\('#pdf-search-case'\)/);
  assert.match(appSource, /wholeWord:\s*pdfSearchOptionOn\('#pdf-search-word'\)/);
});

test('reader search repaints all rendered pages when the query changes (no stale highlights)', function () {
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  // 换查询只重画「当前命中页」会把旧查询的高亮残留在其它已渲染页上
  // （逐字输入时每个中间态各跳一次页，残留成数轮旧高亮叠加）；
  // renderSearchLayer 对空结果也会先移除旧层，重画全部已渲染页即同时完成清理
  assert.match(appSource, /function repaintAllPdfSearchHighlights/);
  assert.match(appSource, /repaintAllPdfSearchHighlights\(\);\s*goToPdfSearchResult\(1\)/);
});
