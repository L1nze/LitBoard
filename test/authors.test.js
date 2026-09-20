'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitAuthors = require('../js/authors.js');

test('nameKey treats western name orderings and abbreviations as one person', function () {
  assert.equal(LitAuthors.nameKey('Turing, Alan M.'), LitAuthors.nameKey('Alan M. Turing'));
  assert.equal(LitAuthors.nameKey('Turing, Alan'), LitAuthors.nameKey('Alan Turing'));
  assert.equal(LitAuthors.nameKey('Turing, A. M.'), LitAuthors.nameKey('Turing, Alan M.'));
  assert.equal(LitAuthors.nameKey('张三'), LitAuthors.nameKey('张三'));
  // 注意：键按「姓 + 首字母」归并，John/Jane Smith 会落在同一建议组，由用户在弹窗中人工确认
  assert.equal(LitAuthors.nameKey('Smith, John'), LitAuthors.nameKey('Smith, Jane'));
});

test('findMergeGroups finds spelling variants sorted by frequency', function () {
  const papers = [
    { id: 'p1', authors: ['Alan M. Turing', 'John Smith'] },
    { id: 'p2', authors: ['Turing, Alan M.'] },
    { id: 'p3', authors: ['Turing, Alan M.'] },
    { id: 'p4', authors: ['Jane Doe'] },
    { id: 'p5', authors: ['Alan M. Turing'], deletedAt: Date.now() } // 回收站条目不参与
  ];
  const groups = LitAuthors.findMergeGroups(papers);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].suggested, 'Turing, Alan M.');
  assert.equal(groups[0].variants.length, 2);
});

test('mergeAuthors rewrites variants and dedupes, skipping trashed papers nothing', function () {
  const papers = [
    { id: 'p1', authors: ['Alan M. Turing', 'John Smith'] },
    { id: 'p2', authors: ['Turing, Alan M.', 'Alan M. Turing'] }
  ];
  const result = LitAuthors.mergeAuthors(papers, ['Alan M. Turing'], 'Turing, Alan M.');
  assert.equal(result.papersChanged, 2);
  assert.equal(result.occurrences, 2);
  assert.deepEqual(papers[0].authors, ['Turing, Alan M.', 'John Smith']);
  assert.deepEqual(papers[1].authors, ['Turing, Alan M.']); // 重复项被去重
  assert.deepEqual(LitAuthors.mergeAuthors(papers, ['Nobody'], 'X'), { papersChanged: 0, occurrences: 0 });
});
