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

test('PDF rendering profile preserves embedded fonts and avoids system substitution', function () {
  const source = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');

  assert.match(source, /disableFontFace:\s*false/);
  assert.match(source, /useSystemFonts:\s*false/);
  assert.match(source, /isEvalSupported:\s*false/);
  assert.match(source, /standardFontDataUrl:\s*STANDARD_FONT_URL/);
  assert.match(source, /iccUrl:\s*ICC_URL/);
});

test('matching PDF.js font, CMap, WASM, and ICC resources are packaged locally', function () {
  const required = [
    ['standard_fonts', 'FoxitSymbol.pfb'],
    ['standard_fonts', 'LiberationSans-Regular.ttf'],
    ['cmaps', 'Adobe-GB1-UCS2.bcmap'],
    ['wasm', 'openjpeg.wasm'],
    ['iccs', 'CGATS001Compat-v2-micro.icc']
  ];

  required.forEach(function (parts) {
    const filePath = path.join(root, 'vendor', 'pdfjs', ...parts);
    assert.ok(fs.statSync(filePath).size > 0, filePath + ' should be non-empty');
  });
});

test('PDFium is the default renderer with targeted PDF.js compatibility and bidirectional fallback', function () {
  const pdfiumSource = fs.readFileSync(path.join(root, 'js', 'pdfium.js'), 'utf8');
  const pdfSource = fs.readFileSync(path.join(root, 'js', 'pdfimport.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(pdfiumSource, /FPDF_RenderPageBitmap/);
  assert.match(pdfSource, /LitPdfium\.openBytes/);
  assert.match(pdfSource, /pdfJsTask\s*=\s*page\.render/);
  assert.match(pdfSource, /catch\(function \(\) \{ return 'pdfium'; \}\)/);
  assert.match(pdfSource, /preferred === 'pdfjs' \? renderWithPdfJs : renderWithPdfium/);
  assert.match(html, /script-src[^;]*'wasm-unsafe-eval'/);
  assert.match(html, /js\/pdfium\.js/);
  ['pdfium.js', 'pdfium.wasm', 'LICENSE', 'LICENSE.pdfium'].forEach(function (name) {
    assert.ok(fs.statSync(path.join(root, 'vendor', 'pdfium', name)).size > 0);
  });
});

test('renderer policy uses PDF.js only for missing non-subset CJK system fonts', function () {
  const policy = loadPdfModule().rendererPolicy;

  assert.equal(policy.preferPdfJsForFonts([
    { name: 'SimHei', missingFile: true }
  ]), true);
  assert.equal(policy.preferPdfJsForFonts([
    { name: 'ABCDEF+SimHei', missingFile: true }
  ]), false);
  assert.equal(policy.preferPdfJsForFonts([
    { name: 'REIMWR+CharisSIL', missingFile: true },
    { name: 'KXTUHT+STIXMath-Regular', missingFile: true }
  ]), false);
  assert.equal(policy.preferPdfJsForFonts([
    { name: 'SimHei', missingFile: false }
  ]), false);
});

test('renderer override is exposed in the PDF toolbar and persisted per attachment', function () {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

  assert.match(html, /id="pdf-renderer-toggle"/);
  assert.match(appSource, /renderer:\s*pdfState\.renderer/);
  assert.match(appSource, /pos\.renderer === 'pdfjs' \|\| pos\.renderer === 'pdfium'/);
  assert.match(appSource, /\['auto', 'pdfium', 'pdfjs'\]/);
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
