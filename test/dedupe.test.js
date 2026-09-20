'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitDedupe = require('../js/dedupe.js');

function p(over) {
  return Object.assign({
    id: 'p' + Math.random().toString(36).slice(2, 8),
    title: '', authors: [], year: null, venue: '', doi: '', url: '', abstract: '',
    volume: '', pages: '', citations: null, citationSource: '', citationUpdatedAt: '',
    oaUrl: '', openalexId: '', pdfFileName: '', pdfPath: '', key: '', entryType: 'article',
    tags: [], status: 'unread', rating: 0, notes: '', addedAt: 1000
  }, over);
}

test('findGroups groups by DOI case-insensitively', function () {
  const groups = LitDedupe.findGroups([
    p({ id: 'a', title: 'Paper One', doi: '10.1000/ABC' }),
    p({ id: 'b', title: 'Totally Different Name', doi: '10.1000/abc' }),
    p({ id: 'c', title: 'Unrelated Third', doi: '10.1000/xyz' })
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(function (x) { return x.id; }).sort(), ['a', 'b']);
});

test('findGroups treats identical PDF fingerprints as definite duplicates', function () {
  const fingerprint = 'a'.repeat(64);
  const groups = LitDedupe.findGroups([
    p({ id: 'p1', title: 'Unrecognized scan one', pdfFingerprint: fingerprint }),
    p({ id: 'p2', title: 'Different extracted title', pdfFingerprint: fingerprint })
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(function (item) { return item.id; }).sort(), ['p1', 'p2']);
});

test('findGroups does not group by title-only candidates', function () {
  const groups = LitDedupe.findGroups([
    p({ id: 'a', title: 'Attention Is All You Need', doi: '' }),
    p({ id: 'b', title: 'attention is ALL you need!', doi: '10.1/x' }),
    p({ id: 'c', title: 'Another Paper Entirely', doi: '10.1/x' }) // 与 b 同 DOI → 三条一组
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(function (item) { return item.id; }).sort(), ['b', 'c']);
});

test('findGroups ignores placeholder titles like (无标题)', function () {
  const groups = LitDedupe.findGroups([
    p({ id: 'a', title: '(无标题)' }),
    p({ id: 'b', title: '(无标题)' }),
    p({ id: 'c', title: '(未识别标题)' }),
    p({ id: 'd', title: '(未识别标题)' })
  ]);
  assert.equal(groups.length, 0);
});

test('title matching does not merge conflicting years or first authors', function () {
  const groups = LitDedupe.findGroups([
    p({ id: 'a', title: 'A Shared Research Title', year: 2020, authors: ['Jane Doe'] }),
    p({ id: 'b', title: 'A Shared Research Title', year: 2021, authors: ['Jane Doe'] }),
    p({ id: 'c', title: 'A Shared Research Title', year: 2020, authors: ['John Roe'] })
  ]);
  assert.equal(groups.length, 0);
});

test('isDuplicate only accepts exact DOI or PDF fingerprint', function () {
  assert.equal(LitDedupe.isDuplicate(
    p({ title: 'A Shared Research Title', doi: '10.1000/a' }),
    p({ title: 'A Shared Research Title', doi: '10.1000/b' })
  ), false);
  assert.equal(LitDedupe.isDuplicate(
    p({ title: 'Attention Is All You Need', year: 2017, authors: ['Ashish Vaswani'] }),
    p({ title: 'attention is all you need!' })
  ), false);
});

test('title-only matches are exposed as manual candidates', function () {
  assert.equal(LitDedupe.isTitleCandidate(
    p({ title: 'Attention Is All You Need', year: 2017, authors: ['Ashish Vaswani'] }),
    p({ title: 'attention is all you need!' })
  ), true);
});

test('merge keeps the most complete entry id and fills gaps from others', function () {
  const rich = p({ id: 'rich', title: 'T', doi: '10.1/t', abstract: 'Long abstract', venue: 'Nature', year: 2020, citations: 5, notes: '我的笔记', addedAt: 2000 });
  const poor = p({ id: 'poor', title: 'T', pdfPath: 'C:\\papers\\t.pdf', pdfFileName: 't.pdf', citations: 120, citationSource: 'OpenAlex', tags: ['经典'], status: 'read', rating: 4, addedAt: 1000 });
  const m = LitDedupe.merge([poor, rich]);
  assert.equal(m.id, 'rich');                    // 更完整者保留
  assert.equal(m.pdfPath, 'C:\\papers\\t.pdf');  // 空字段回填
  assert.equal(m.citations, 120);                // 被引取最大
  assert.equal(m.citationSource, 'OpenAlex');
  assert.deepEqual(m.tags, ['经典']);            // 标签并集
  assert.equal(m.status, 'read');                // 状态取进度最远
  assert.equal(m.rating, 4);                     // 评分取最高
  assert.equal(m.addedAt, 1000);                 // 加入时间取最早
  assert.equal(m.notes, '我的笔记');             // 唯一笔记不拼分隔符
});

test('merge concatenates distinct notes and unions tags', function () {
  const a = p({ id: 'a', title: 'T', notes: '笔记A', tags: ['x'], abstract: 'zz' });
  const b = p({ id: 'b', title: 'T', notes: '笔记B', tags: ['x', 'y'] });
  const m = LitDedupe.merge([a, b]);
  assert.match(m.notes, /笔记A/);
  assert.match(m.notes, /笔记B/);
  assert.match(m.notes, /合并自重复条目/);
  assert.deepEqual(m.tags.sort(), ['x', 'y']);
});

test('merge preserves assignments from every folder', function () {
  const merged = LitDedupe.merge([
    { id: 'p1', title: 'Same', folderIds: ['f1'], tags: [] },
    { id: 'p2', title: 'Same', folderIds: ['f2', 'f1'], tags: [] }
  ]);
  assert.deepEqual(merged.folderIds.sort(), ['f1', 'f2']);
});

test('merge unions PDF annotations and keeps the newest matching annotation', function () {
  const oldAnnotation = { id: 'a1', comment: 'old', updatedAt: 10 };
  const newAnnotation = { id: 'a1', comment: 'new', updatedAt: 20 };
  const merged = LitDedupe.merge([
    p({ id: 'p1', title: 'Same', pdfAnnotations: [oldAnnotation] }),
    p({ id: 'p2', title: 'Same', pdfAnnotations: [newAnnotation, { id: 'a2', updatedAt: 15 }] })
  ]);
  assert.equal(merged.pdfAnnotations.length, 2);
  assert.equal(merged.pdfAnnotations.find(function (item) { return item.id === 'a1'; }).comment, 'new');
});
