'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitExcerpt = require('../js/excerpt.js');

function ann(updatedAt, patch) {
  return Object.assign({ id: 'ann1', type: 'highlight', text: 'quote', comment: 'note', color: '#ffd400', updatedAt: updatedAt }, patch || {});
}

test('buildExcerpt/parseExcerpts round-trips quote and comment', function () {
  const block = LitExcerpt.buildExcerpt({
    paperId: 'p1', paperTitle: 'Alpha', attachmentId: 'a1', annotationId: 'ann1',
    pageIndex: 4, sourceUpdatedAt: 111, quote: '第一行\n第二行', comment: '我的评论'
  });
  const list = LitExcerpt.parseExcerpts('前文\n\n' + block + '\n\n后文');
  assert.equal(list.length, 1);
  const ex = list[0];
  assert.equal(ex.paperId, 'p1');
  assert.equal(ex.paperTitle, 'Alpha');
  assert.equal(ex.attachmentId, 'a1');
  assert.equal(ex.annotationId, 'ann1');
  assert.equal(ex.pageIndex, 4);
  assert.equal(ex.sourceUpdatedAt, 111);
  assert.equal(ex.quote, '第一行\n第二行');
  assert.equal(ex.comment, '我的评论');
  // start/end 覆盖整块（含标记行）
  assert.equal(('前文\n\n' + block + '\n\n后文').slice(ex.start, ex.end), block);
});

test('parseExcerpts handles multiple blocks, empty comment and unclosed block', function () {
  const b1 = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a1', quote: 'q1' });
  const b2 = LitExcerpt.buildExcerpt({ paperId: 'p2', annotationId: 'a2', quote: 'q2', comment: 'c2' });
  const unclosed = LitExcerpt.buildExcerpt({ paperId: 'p3', annotationId: 'a3', quote: 'q3' })
    .replace('<!--/lbex-->', ''); // 未闭合
  const list = LitExcerpt.parseExcerpts(b1 + '\n\n' + b2 + '\n\n' + unclosed);
  assert.equal(list.length, 3);
  assert.equal(list[0].comment, '');
  assert.equal(list[1].comment, 'c2');
  assert.equal(list[2].quote, 'q3');
});

test('staleExcerpts reports fresh, changed and deleted', function () {
  const fresh = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a1', quote: 'q', sourceUpdatedAt: 100 });
  const changed = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a2', quote: 'old', sourceUpdatedAt: 100 });
  const deleted = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a3', quote: 'q', sourceUpdatedAt: 100 });
  const content = [fresh, changed, deleted].join('\n\n');
  const annotations = { a1: ann(100), a2: ann(200, { text: 'new' }) };
  const result = LitExcerpt.staleExcerpts(content, function (id) { return annotations[id] || null; });
  assert.deepEqual(result.map(function (r) { return r.status; }), ['fresh', 'changed', 'deleted']);
  assert.equal(result[1].current.text, 'new');
});

test('replaceExcerpt swaps quote/comment in place and keeps position', function () {
  const before = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a1', quote: 'old', comment: 'oldc', sourceUpdatedAt: 1 });
  const after = LitExcerpt.buildExcerpt({ paperId: 'p2', annotationId: 'a2', quote: 'keep', sourceUpdatedAt: 1 });
  const content = '头\n\n' + before + '\n\n' + after + '\n\n尾';
  const ex = LitExcerpt.parseExcerpts(content)[0];
  const next = LitExcerpt.replaceExcerpt(content, ex, { quote: 'new', comment: 'newc', sourceUpdatedAt: 2 });
  const list = LitExcerpt.parseExcerpts(next);
  assert.equal(list.length, 2);
  assert.equal(list[0].quote, 'new');
  assert.equal(list[0].comment, 'newc');
  assert.equal(list[0].sourceUpdatedAt, 2);
  assert.equal(list[1].quote, 'keep'); // 后块不受影响
  assert.match(next, /^头\n\n/);
  assert.match(next, /\n\n尾$/);
});

test('markExcerptCurrent silences future stale prompts', function () {
  const block = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a1', quote: 'q', sourceUpdatedAt: 1 });
  const ex = LitExcerpt.parseExcerpts(block)[0];
  const next = LitExcerpt.markExcerptCurrent(block, ex, ann(999));
  const result = LitExcerpt.staleExcerpts(next, function () { return ann(999); });
  assert.deepEqual(result.map(function (r) { return r.status; }), ['fresh']);
});

test('removeExcerpt removes the whole block without leaving holes', function () {
  const b1 = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a1', quote: 'q1' });
  const b2 = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a2', quote: 'q2' });
  const content = '头\n\n' + b1 + '\n\n' + b2 + '\n\n尾';
  const next = LitExcerpt.removeExcerpt(content, LitExcerpt.parseExcerpts(content)[0]);
  const list = LitExcerpt.parseExcerpts(next);
  assert.equal(list.length, 1);
  assert.equal(list[0].annotationId, 'a2');
  assert.match(next, /^头\n\n/);
  assert.match(next, /\n\n尾$/);
});

test('buildLocateUrl shapes the litboard link', function () {
  const url = LitExcerpt.buildLocateUrl({ paperId: 'p1', attachmentId: 'a1', annotationId: 'ann1', pageIndex: 4 });
  assert.equal(url, 'litboard://open/paper/p1?attachment=a1&annotation=ann1&page=5');
});
