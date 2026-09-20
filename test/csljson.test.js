'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitCslJson = require('../js/csljson.js');
const LitModel = require('../js/model.js');

const sample = [
  {
    id: 'turing1950',
    type: 'article-journal',
    title: 'Computing machinery and intelligence',
    author: [{ family: 'Turing', given: 'Alan M.' }],
    issued: { 'date-parts': [[1950, 10]] },
    'container-title': 'Mind',
    volume: '59', issue: '236', page: '433-460',
    DOI: '10.1093/mind/LIX.236.433',
    ISSN: ['0026-4423'],
    language: 'en',
    abstract: 'I propose to consider the question.'
  },
  {
    type: 'book',
    title: 'The Art of Computer Programming',
    author: [{ family: 'Knuth', given: 'Donald E.' }, { literal: 'Addison-Wesley' }],
    issued: { 'date-parts': [[1968]] },
    publisher: 'Addison-Wesley',
    ISBN: '978-0-201-89683-1',
    edition: '1'
  }
];

test('looksLikeCslJson distinguishes CSL items from LitBoard backups', function () {
  assert.equal(LitCslJson.looksLikeCslJson(sample), true);
  assert.equal(LitCslJson.looksLikeCslJson({ papers: [] }), false);
  assert.equal(LitCslJson.looksLikeCslJson({ schemaVersion: 8, papers: [] }), false);
  assert.equal(LitCslJson.looksLikeCslJson('string'), false);
  assert.equal(LitCslJson.looksLikeCslJson([]), false);
  assert.equal(LitCslJson.looksLikeCslJson([{ title: 'no type' }]), false);
});

test('parsePapers maps article-journal with full bibliographic fields', function () {
  const papers = LitCslJson.parsePapers(sample);
  assert.equal(papers.length, 2);
  const first = papers[0];
  assert.equal(first.entryType, 'article');
  assert.equal(first.key, 'turing1950');
  assert.deepEqual(first.authors, ['Alan M. Turing']);
  assert.equal(first.year, 1950);
  assert.equal(first.venue, 'Mind');
  assert.equal(first.volume, '59');
  assert.equal(first.issue, '236');
  assert.equal(first.pages, '433-460');
  assert.equal(first.doi, '10.1093/mind/LIX.236.433');
  assert.equal(first.issn, '0026-4423');
});

test('parsePapers maps book with publisher, ISBN and literal author', function () {
  const book = LitCslJson.parsePapers(sample)[1];
  assert.equal(book.entryType, 'book');
  assert.deepEqual(book.authors, ['Donald E. Knuth', 'Addison-Wesley']);
  assert.equal(book.publisher, 'Addison-Wesley');
  assert.equal(book.isbn, '978-0-201-89683-1');
});

test('CSL-JSON papers survive model normalization with pinned-imported keys kept', function () {
  const normalized = LitModel.normalizeLibrary(LitCslJson.parsePapers(sample));
  assert.equal(normalized[0].key, 'turing1950'); // 导入 key 保留（v8 行为）
  assert.equal(normalized[1].entryType, 'book');
});

test('parsePapers rejects non-CSL values', function () {
  assert.deepEqual(LitCslJson.parsePapers({ papers: [{ title: 'x' }] }), []);
  assert.deepEqual(LitCslJson.parsePapers(null), []);
  assert.deepEqual(LitCslJson.parsePapers(42), []);
});

test('CSL-JSON export preserves roles, full dates and access dates', function () {
  const item = LitCslJson.paperToCslJson({
    key: 'x1', entryType: 'article', title: 'X', date: '2024-02-29', accessDate: '2025-01-02',
    venue: 'Journal', creators: [
      { creatorType: 'author', family: 'Doe', given: 'Jane', name: '' },
      { creatorType: 'editor', family: 'Roe', given: 'John', name: '' }
    ]
  });
  assert.deepEqual(item.issued['date-parts'], [[2024, 2, 29]]);
  assert.deepEqual(item.accessed['date-parts'], [[2025, 1, 2]]);
  assert.deepEqual(item.author, [{ family: 'Doe', given: 'Jane' }]);
  assert.deepEqual(item.editor, [{ family: 'Roe', given: 'John' }]);
});
