'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../js/agentfilecontext.js');

test('literal keyword search preserves source offsets and continues bounded results', () => {
  const source = '甲 [a.*] 乙 [A.*] 丙 [a.*]';
  const first = F.searchTextWindows(source, '[a.*]', { limit: 2, context: 2 });
  assert.equal(first.matches.length, 2);
  for (const m of first.matches) assert.equal(source.slice(m.matchOffset, m.matchEnd).toLowerCase(), '[a.*]');
  assert.equal(first.truncated, true);
  const next = F.searchTextWindows(source, '[a.*]', { offset: first.nextOffset });
  assert.equal(next.matches.length, 1);
  assert.equal(next.nextOffset, null);
  assert.equal(F.searchTextWindows(source, '[a.*]', { caseSensitive: true }).matches.length, 2);
  assert.throws(() => F.searchTextWindows(source, ' '), /Search query/);
});

test('search reports a bounded scan and finds keyword crossing scan boundary on continuation', () => {
  const text = 'x'.repeat(999998) + 'ABCDEF';
  const first = F.searchTextWindows(text, 'ABCDEF');
  assert.equal(first.matches.length, 0);
  assert.equal(first.scannedEnd, 1000000);
  assert.equal(first.truncated, true);
  const second = F.searchTextWindows(text, 'ABCDEF', { offset: first.nextOffset });
  assert.equal(second.matches[0].matchOffset, 999998);
});

test('reading coverage merges overlaps and distinguishes extraction from complete source reading', () => {
  let c = F.mergeCoverage({}, { totalChars: 100, totalPages: 5, chars: [[0, 30], [20, 50]], pages: [[1, 2], [2, 3]] });
  assert.deepEqual(c.chars, [[0, 50]]);
  assert.deepEqual(c.pages, [[1, 3]]);
  assert.equal(F.coverageSummary(c).readChars, 50);
  assert.equal(F.coverageSummary(c).textComplete, false);
  c = F.mergeCoverage(c, { chars: [[50, 200]], pages: [[4, 5]] });
  assert.equal(F.coverageSummary(c).textComplete, true);
  assert.equal(F.coverageSummary(c).pagesComplete, true);
  assert.equal(F.coverageSummary(F.mergeCoverage(c, { extractionTruncated: true })).textComplete, false);
  assert.deepEqual(F.mergeIntervals([[NaN, 4], [-1, 4], [9, 2], [3, 8], [8, 9]], 6), [[3, 6]]);
  assert.equal(F.coverageSummary({}).textComplete, false);
});

test('unknown totals preserve read ranges without implying completion', () => {
  const c = F.coverageSummary({ chars: [[10, 20]], pages: [[2, 4]] });
  assert.deepEqual(c.chars, [[10, 20]]);
  assert.deepEqual(c.pages, [[2, 4]]);
  assert.equal(c.totalPages, 0);
  assert.equal(c.textComplete, false);
  assert.equal(c.pagesComplete, false);
});

test('coverage reconstructs successful read windows and rendered pages including compacted history', () => {
  const tool = (name, result, props) => Object.assign({ role: 'tool', name, content: JSON.stringify(result) }, props);
  const c = F.getFileCoverage([
    tool('read_session_file', { file: '附件/a.pdf', text: 'abc', offset: 0, totalChars: 10 }, { compacted: true }),
    tool('read_session_file', { file: '附件/a.pdf', text: 'def', offset: 2 }),
    tool('render_session_pdf_pages', { file: '附件/a.pdf', renderedPages: [1, 3, 3, 0, '4'], pages: [1, 2, 3, 4] }),
    tool('read_session_file', { file: '附件/a.pdf', text: 'abcdef', offset: 5 }, { error: true }),
    tool('read_session_file', { file: '附件/a.pdf', text: 'abcdef', offset: 5, error: 'failed' }),
    tool('read_session_file', { file: '附件/b.pdf', text: 'abcdef', offset: 5 }),
    tool('search_session_file', { file: '附件/a.pdf', matches: [{ offset: 0, text: 'all' }], totalChars: 3 }),
    { role: 'tool', name: 'read_session_file', content: '{broken' }
  ], '附件/a.pdf');
  assert.deepEqual(c.chars, [[0, 5]]);
  assert.deepEqual(c.pages, [[1, 1], [3, 3]]);
  assert.equal(c.totalChars, 10);
  assert.equal(c.totalPages, 0);
  assert.equal(c.textComplete, false);
});
