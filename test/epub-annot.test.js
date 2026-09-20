'use strict';
/* EPUB 批注 → 摘录 → 笔记闭环（阶段六切片 3）：
 * CFI 指纹、excerpt/noteml 的 epubcfi 往返、litboard:// 定位参数 */
const test = require('node:test');
const assert = require('node:assert');
const LitModel = require('../js/model.js');
const LitExcerpt = require('../js/excerpt.js');
const LitNoteMl = require('../js/noteml.js');

const EPUB_ANN = {
  id: 'an1', type: 'highlight', color: '#ffd400', attachmentId: 'attE1',
  text: 'EPUB 中选中的一段话', comment: '很重要',
  position: { cfi: 'epubcfi(/6/4[ch1]!/4/2/1:0-8)', textAnchor: { exact: 'EPUB 中选中的一段话', prefix: '', suffix: '' } },
  createdAt: 1000, updatedAt: 1000
};

test('annotationFingerprint：EPUB（CFI）与 PDF（页码+矩形）指纹互不混淆', () => {
  const epubFp = LitModel.annotationFingerprint(EPUB_ANN);
  assert.ok(epubFp.indexOf('cfi') !== -1);
  assert.ok(epubFp.indexOf('epubcfi') !== -1);
  // 不同 CFI → 不同指纹（旧实现会全部相同，因为没有 pageIndex/rects）
  const other = Object.assign({}, EPUB_ANN, { position: { cfi: 'epubcfi(/6/6[ch2]!/4/2/1:0-8)' } });
  assert.notStrictEqual(epubFp, LitModel.annotationFingerprint(other));
  // 同 CFI 同文本 → 同指纹（dedupe 生效）
  assert.strictEqual(epubFp, LitModel.annotationFingerprint(JSON.parse(JSON.stringify(EPUB_ANN))));
  // PDF 批注指纹不受影响
  const pdfFp = LitModel.annotationFingerprint({ id: 'a', type: 'highlight', text: 'x', position: { pageIndex: 3, rects: [[1, 2, 3, 4]] } });
  assert.strictEqual(pdfFp, 'highlight|3|1,2,3,4|x');
});

test('dedupeAnnotations：EPUB 批注按 CFI 去重', () => {
  const dup = JSON.parse(JSON.stringify(EPUB_ANN));
  const list = LitModel.dedupeAnnotations([EPUB_ANN, dup, Object.assign({}, EPUB_ANN, { position: { cfi: 'epubcfi(/6/8!/2)' } })]);
  assert.strictEqual(list.length, 2);
});

test('normalizePdfAnnotations 保留 cfi 与 textAnchor（EPUB 批注可入库）', () => {
  const normalized = LitModel.normalizePdfAnnotations([EPUB_ANN]);
  assert.strictEqual(normalized.length, 1);
  assert.strictEqual(normalized[0].position.cfi, 'epubcfi(/6/4[ch1]!/4/2/1:0-8)');
  assert.strictEqual(normalized[0].position.pageIndex, null);
  assert.strictEqual(normalized[0].position.textAnchor.exact, 'EPUB 中选中的一段话');
});

test('buildExcerpt/parseExcerpts：epubcfi 随摘录块往返', () => {
  const block = LitExcerpt.buildExcerpt({
    paperId: 'p1', paperTitle: '书', attachmentId: 'attE1', annotationId: 'an1',
    pageIndex: null, epubcfi: 'epubcfi(/6/4!/2/1:0-8)', sourceUpdatedAt: 1000,
    quote: 'EPUB 中选中的一段话', comment: '笔记评论'
  });
  const parsed = LitExcerpt.parseExcerpts('前文\n\n' + block + '\n\n后文');
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].epubcfi, 'epubcfi(/6/4!/2/1:0-8)');
  assert.strictEqual(parsed[0].pageIndex, null);
  assert.strictEqual(parsed[0].quote, 'EPUB 中选中的一段话');
});

test('buildLocateUrl：epubcfi 参数编码进 litboard:// 链接', () => {
  const url = LitExcerpt.buildLocateUrl({ paperId: 'p1', attachmentId: 'attE1', annotationId: 'an1', epubcfi: 'epubcfi(/6/4!/2/1:0-8)' });
  assert.ok(url.indexOf('litboard://open/paper/p1') === 0);
  assert.ok(url.indexOf('epubcfi=') !== -1);
  assert.ok(url.indexOf(encodeURIComponent('epubcfi(/6/4!/2/1:0-8)')) !== -1);
  // 无 epubcfi 的旧链接不变
  const pdfUrl = LitExcerpt.buildLocateUrl({ paperId: 'p1', attachmentId: 'a1', annotationId: 'an1', pageIndex: 2 });
  assert.ok(pdfUrl.indexOf('page=3') !== -1);
  assert.ok(pdfUrl.indexOf('epubcfi') === -1);
});

test('noteml 富文本摘录块：epubcfi 往返不丢（md→html→md 出处保留）', () => {
  const html = LitNoteMl.buildExcerptHtml(
    { paperId: 'p1', paperTitle: '书', attachmentId: 'attE1', annotationId: 'an1', pageIndex: null, epubcfi: 'epubcfi(/6/4!/2/1:0-8)', sourceUpdatedAt: 1000 },
    'EPUB 摘录原文', ''
  );
  const blocks = LitNoteMl.parseExcerptBlocks(html);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].epubcfi, 'epubcfi(/6/4!/2/1:0-8)');
  // replaceExcerptBlock 重建后 epubcfi 仍在
  const replaced = LitNoteMl.replaceExcerptBlock(html, 'an1', { quoteText: '更新后的原文', commentText: '', sourceUpdatedAt: 2000 });
  assert.strictEqual(LitNoteMl.parseExcerptBlocks(replaced)[0].epubcfi, 'epubcfi(/6/4!/2/1:0-8)');
  assert.strictEqual(LitNoteMl.parseExcerptBlocks(replaced)[0].quoteText, '更新后的原文');
});

test('staleExcerpts：EPUB 批注的 sourceUpdatedAt 比对照常工作', () => {
  const block = LitExcerpt.buildExcerpt({
    paperId: 'p1', paperTitle: '书', attachmentId: 'attE1', annotationId: 'an1',
    pageIndex: null, epubcfi: 'epubcfi(/6/4!/2)', sourceUpdatedAt: 1000,
    quote: '原文', comment: ''
  });
  const fresh = LitExcerpt.staleExcerpts(block, () => EPUB_ANN);
  assert.strictEqual(fresh[0].status, 'fresh');
  const changed = LitExcerpt.staleExcerpts(block, () => Object.assign({}, EPUB_ANN, { updatedAt: 2000 }));
  assert.strictEqual(changed[0].status, 'changed');
  const deleted = LitExcerpt.staleExcerpts(block, () => null);
  assert.strictEqual(deleted[0].status, 'deleted');
});

test('replaceExcerpt/markExcerptCurrent 保留 epubcfi（采用更新/保留后 CFI 不丢）', () => {
  const block = LitExcerpt.buildExcerpt({
    paperId: 'p1', paperTitle: '书', attachmentId: 'attE1', annotationId: 'an1',
    pageIndex: null, epubcfi: 'epubcfi(/6/4!/2/1:0-8)', sourceUpdatedAt: 1000,
    quote: '原文', comment: '评'
  });
  const replaced = LitExcerpt.replaceExcerpt(block, LitExcerpt.parseExcerpts(block)[0], {
    quote: '新原文', comment: '新评', sourceUpdatedAt: 2000
  });
  assert.strictEqual(LitExcerpt.parseExcerpts(replaced)[0].epubcfi, 'epubcfi(/6/4!/2/1:0-8)');
  assert.strictEqual(LitExcerpt.parseExcerpts(replaced)[0].quote, '新原文');
  const kept = LitExcerpt.markExcerptCurrent(block, LitExcerpt.parseExcerpts(block)[0], { updatedAt: 3000 });
  assert.strictEqual(LitExcerpt.parseExcerpts(kept)[0].epubcfi, 'epubcfi(/6/4!/2/1:0-8)');
  assert.strictEqual(LitExcerpt.parseExcerpts(kept)[0].sourceUpdatedAt, 3000);
});

test('noteml htmlToMarkdown：富文本摘录块转回 Markdown 时 epubcfi 随行', () => {
  const html = LitNoteMl.buildExcerptHtml(
    { paperId: 'p1', paperTitle: '书', attachmentId: 'attE1', annotationId: 'an1', pageIndex: null, epubcfi: 'epubcfi(/6/4!/2)', sourceUpdatedAt: 1000 },
    '富文本摘录', ''
  );
  const md = LitNoteMl.htmlToMarkdown(html);
  const parsed = LitExcerpt.parseExcerpts(md);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].epubcfi, 'epubcfi(/6/4!/2)');
  // 含 epubcfi 的 lbex 定位链接应带 epubcfi 参数
  assert.ok(parsed[0].epubcfi && LitExcerpt.buildLocateUrl(parsed[0]).indexOf('epubcfi=') !== -1);
});
