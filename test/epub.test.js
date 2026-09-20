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
