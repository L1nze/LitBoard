'use strict';
/* EPUB 阅读封装纯逻辑（阶段六切片 2）：TOC 展平 / CFI 排序 / 阅读位置 / 错误分类 / 选区转换 */
const test = require('node:test');
const assert = require('node:assert');
const LitEpub = require('../js/epub.js');

test('flattenToc 展平嵌套目录并记录深度', () => {
  const toc = [
    { label: '第一章', href: 'c1.xhtml', subitems: [{ label: '1.1 节', href: 'c1.xhtml#s1' }] },
    { label: '第二章', href: 'c2.xhtml' }
  ];
  const flat = LitEpub.flattenToc(toc);
  assert.deepStrictEqual(flat, [
    { label: '第一章', href: 'c1.xhtml', depth: 0 },
    { label: '1.1 节', href: 'c1.xhtml#s1', depth: 1 },
    { label: '第二章', href: 'c2.xhtml', depth: 0 }
  ]);
});

test('flattenToc 容错：空项 / 无标签 / 非法输入', () => {
  assert.deepStrictEqual(LitEpub.flattenToc(null), []);
  assert.deepStrictEqual(LitEpub.flattenToc([null, { subitems: 'bad' }]), [
    { label: '（无标题章节）', href: '', depth: 0 }
  ]);
});

test('cfiSortKey 提取 spine 序号，跨章节能排出阅读顺序', () => {
  const a = 'epubcfi(/6/4[ch1]!/4/2/2)';
  const b = 'epubcfi(/6/6[ch2]!/4/2/2)';
  const c = 'epubcfi(/6/8!/4/2/2)';
  assert.ok(LitEpub.cfiSortKey(a) < LitEpub.cfiSortKey(b));
  assert.ok(LitEpub.cfiSortKey(b) < LitEpub.cfiSortKey(c));
  assert.ok(LitEpub.compareCfi(a, b) < 0);
  assert.ok(LitEpub.compareCfi(b, a) > 0);
  assert.strictEqual(LitEpub.compareCfi(a, a), 0);
  assert.strictEqual(LitEpub.cfiSortKey(''), null);
  assert.strictEqual(LitEpub.cfiSortKey('not-a-cfi'), null);
});

test('encodeReadPos 规范化字号与主题，decode 宽容解析', () => {
  const pos = LitEpub.encodeReadPos({ cfi: 'epubcfi(/6/4!/2)', fontSize: 19, theme: 'sepia' });
  assert.deepStrictEqual(pos, { cfi: 'epubcfi(/6/4!/2)', fontSize: 19, theme: 'sepia' });
  // 非法值回落默认
  const bad = LitEpub.encodeReadPos({ cfi: 'x', fontSize: 99, theme: 'neon' });
  assert.deepStrictEqual(bad, { cfi: 'x', fontSize: 16, theme: 'light' });
  assert.strictEqual(LitEpub.decodeReadPos({ cfi: 'epubcfi(/6/4!/2)', fontSize: 23, theme: 'dark' }).fontSize, 23);
  assert.strictEqual(LitEpub.decodeReadPos(null), null);
  assert.strictEqual(LitEpub.decodeReadPos({ fontSize: 16 }), null); // 无 cfi 视为无位置
  assert.strictEqual(LitEpub.decodeReadPos('junk'), null);
});

test('classifyError 归类 EPUB 打开失败原因', () => {
  assert.strictEqual(LitEpub.classifyError(new Error('Invalid or unsupported zip file.')).code, 'not-zip');
  assert.strictEqual(LitEpub.classifyError(new Error('container.xml missing')).code, 'no-package');
  assert.strictEqual(LitEpub.classifyError(new Error('Encryption (DRM) not supported')).code, 'encrypted');
  const unk = LitEpub.classifyError(new Error('boom'));
  assert.strictEqual(unk.code, 'unknown');
  assert.strictEqual(unk.message, 'boom');
});

test('rangeToAnnotationData 转换选区为批注数据', () => {
  const d = LitEpub.rangeToAnnotationData({ toString: () => '选中的文字' }, 'epubcfi(/6/4!/2/1:0-4)');
  assert.deepStrictEqual(d, { cfi: 'epubcfi(/6/4!/2/1:0-4)', text: '选中的文字' });
  assert.deepStrictEqual(LitEpub.rangeToAnnotationData(null, 'x'), { cfi: 'x', text: '' });
});

test('stepFontSize / stepTheme 三档循环', () => {
  assert.strictEqual(LitEpub.stepFontSize(16, 1), 19);
  assert.strictEqual(LitEpub.stepFontSize(23, 1), 16);
  assert.strictEqual(LitEpub.stepFontSize(16, -1), 23);
  assert.strictEqual(LitEpub.stepFontSize(99, 1), 19); // 非法值先回落 16 再步进
  assert.strictEqual(LitEpub.stepTheme('light', 1), 'sepia');
  assert.strictEqual(LitEpub.stepTheme('dark', 1), 'light');
  assert.strictEqual(LitEpub.stepTheme('dark', -1), 'sepia');
});

/* ---------- 正文抽取（全文索引：spine 章节序 = 页序） ---------- */

test('opfPathFromContainer / spineHrefsFromOpf：容器与 OPF 解析', () => {
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  assert.equal(LitEpub.opfPathFromContainer(container), 'OEBPS/content.opf');
  assert.equal(LitEpub.opfPathFromContainer(''), '');
  assert.equal(LitEpub.opfPathFromContainer("<rootfiles><rootfile full-path='a/b.opf'/></rootfiles>"), 'a/b.opf');

  const opf = '<?xml version="1.0"?>' +
    '<package><manifest>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
    '<item id="c2" href="chap%202.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="css" href="style.css" media-type="text/css"/>' +
    '</manifest><spine toc="ncx">' +
    '<itemref idref="c1"/>' +
    '<itemref idref="c2"/>' +
    '<itemref idref="missing"/>' +
    '</spine></package>';
  // spine 顺序保持（不按清单序）；缺清单项跳过；URL 解码
  assert.deepStrictEqual(LitEpub.spineHrefsFromOpf(opf), ['chapter1.xhtml', 'chap%202.xhtml']);
  assert.deepStrictEqual(LitEpub.spineHrefsFromOpf('<package></package>'), []);

  // 相对 OPF 目录解析 + 去 fragment + 上跳目录
  assert.equal(LitEpub.resolveHref('OEBPS/content.opf', 'chapter1.xhtml'), 'OEBPS/chapter1.xhtml');
  assert.equal(LitEpub.resolveHref('OEBPS/text/content.opf', '../style/main.css#frag'), 'OEBPS/style/main.css');
  assert.equal(LitEpub.resolveHref('content.opf', 'chap%202.xhtml'), 'chap 2.xhtml');
});

test('xhtmlToText：head/script 剔除、块级换行、实体解码、空白收敛', () => {
  const xhtml = '<?xml version="1.0" encoding="utf-8"?>' +
    '<html><head><title>忽略我</title><style>p { color: red }</style></head>' +
    '<body><h1>第一章&nbsp;引言</h1>' +
    '<script>var x = "&lt;script&gt;";</script>' +
    '<p>第一段，含 <em>强调</em> 与 &amp; 符号。</p><p>第二段</p>' +
    '<div>行<br/>断开</div>' +
    '</body></html>';
  const text = LitEpub.xhtmlToText(xhtml);
  assert.ok(!text.includes('忽略我'), 'head 里的 title 不进正文');
  assert.ok(!text.includes('color: red'), 'style 不进正文');
  assert.ok(!text.includes('var x'), 'script 不进正文');
  assert.ok(text.includes('第一章\u00a0引言') || text.includes('第一章 引言'), '实体解码');
  assert.ok(text.includes('第一段，含 强调 与 & 符号。'));
  // 块级边界换行、行内标签不换行
  assert.ok(/第一章[^\n]*引言\n\n?第一段/.test(text.replace(/\u00a0/g, ' ')));
  assert.ok(text.includes('行\n断开'));
  const again = LitEpub.xhtmlToText(text);
  assert.equal(again, text); // 纯文本再过一遍不变（幂等）
});

test('chapterTexts：按 spine 序映射、缺文件记空串保持页序', () => {
  const texts = LitEpub.chapterTexts(
    ['OEBPS/c1.xhtml', 'OEBPS/c2.xhtml', 'OEBPS/missing.xhtml'],
    { 'OEBPS/c1.xhtml': '<p>Alpha</p>', 'OEBPS/c2.xhtml': '<p>Beta</p>' }
  );
  assert.deepStrictEqual(texts, ['Alpha', 'Beta', '']);
  assert.deepStrictEqual(LitEpub.chapterTexts(null, {}), []);
});

// WS4：textAnchor 章内查找（旧 CFI 解析失败时的回退锚，纯函数）
test('findAnchorRange：exact 单节点命中 / 跨节点命中 / prefix-suffix 消歧 / 未命中返回 null', () => {
  const nodes = [
    { data: '采样定理指出，' },
    { data: '若信号最高频率为 B，' },
    { data: '采样频率须大于 2B。' },
  ];
  // 单节点内
  assert.deepStrictEqual(LitEpub.findAnchorRange(nodes, { exact: '采样定理' }),
    { startNode: 0, startOffset: 0, endNode: 0, endOffset: 4 });
  // 跨节点（「频率为 B，采样」横跨 node1 尾与 node2 头）
  assert.deepStrictEqual(LitEpub.findAnchorRange(nodes, { exact: '频率为 B，采样' }),
    { startNode: 1, startOffset: 5, endNode: 2, endOffset: 2 }); // 「频率」在「若信号最高」之后
  const disambig = LitEpub.findAnchorRange(nodes, { exact: '采样频率', prefix: '，' });
  assert.deepStrictEqual(disambig, { startNode: 2, startOffset: 0, endNode: 2, endOffset: 4 }, 'prefix 校验通过（「，」紧邻其前）');
  // 「采样频率」全书仅一处（node2 开头），无 prefix 时同样命中它
  assert.deepStrictEqual(LitEpub.findAnchorRange(nodes, { exact: '采样频率' }),
    { startNode: 2, startOffset: 0, endNode: 2, endOffset: 4 });
  // suffix 消歧
  const bySuffix = LitEpub.findAnchorRange(nodes, { exact: '采样频率', suffix: '须' });
  assert.deepStrictEqual(bySuffix, { startNode: 2, startOffset: 0, endNode: 2, endOffset: 4 });
  // 未命中 / 空 exact / 空 anchor
  assert.strictEqual(LitEpub.findAnchorRange(nodes, { exact: '不存在的串' }), null);
  assert.strictEqual(LitEpub.findAnchorRange(nodes, {}), null);
  assert.strictEqual(LitEpub.findAnchorRange(null, { exact: '采样' }), null);
});
