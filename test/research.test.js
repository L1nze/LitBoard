'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitResearch = require('../js/research.js');

test('shortWorkId strips openalex URL forms', function () {
  assert.equal(LitResearch.shortWorkId('https://openalex.org/W2741809807'), 'W2741809807');
  assert.equal(LitResearch.shortWorkId('W123'), 'W123');
  assert.equal(LitResearch.shortWorkId('w9'), 'W9');
  assert.equal(LitResearch.shortWorkId('https://openalex.org/S4210208519'), 'S4210208519');
  assert.equal(LitResearch.shortWorkId(''), '');
  assert.equal(LitResearch.shortWorkId('local:abc'), 'local:abc');
});

test('normalizeDoi strips prefixes and lowercases', function () {
  assert.equal(LitResearch.normalizeDoi('https://doi.org/10.1016/J.XYZ.2024.01.001'), '10.1016/j.xyz.2024.01.001');
  assert.equal(LitResearch.normalizeDoi('doi:10.1234/ABC'), '10.1234/abc');
  assert.equal(LitResearch.normalizeDoi(''), '');
});

test('abstractFromInvertedIndex reassembles text by position', function () {
  assert.equal(
    LitResearch.abstractFromInvertedIndex({ '锌': [0], '电池': [1], '重要': [3] }),
    '锌 电池 重要'
  );
  assert.equal(LitResearch.abstractFromInvertedIndex(null), '');
  assert.equal(LitResearch.abstractFromInvertedIndex('not-an-object'), '');
});

test('normalizeOpenAlexWork maps a full work payload', function () {
  const row = LitResearch.normalizeOpenAlexWork({
    id: 'https://openalex.org/W42',
    doi: 'https://doi.org/10.1000/XYZ',
    title: 'A Study',
    publication_year: 2024,
    publication_date: '2024-05-01',
    type: 'article',
    primary_location: { source: { id: 'https://openalex.org/S7', display_name: 'Nature' } },
    open_access: { is_oa: true, oa_url: 'https://x/paper.pdf' },
    language: 'en',
    cited_by_count: 7,
    authorships: [
      { raw_author_name: 'Zhang San', author: { orcid: 'https://orcid.org/0000-0001-0002-0003' } },
      { author: { display_name: 'Li Si' } },
      {}
    ],
    referenced_works: ['https://openalex.org/W1', 'W2', 'garbage'],
    concepts: [{ display_name: 'Physics' }],
    keywords: [{ display_name: 'battery' }]
  });
  assert.equal(row.id, 'W42');
  assert.equal(row.doi, '10.1000/xyz');
  assert.equal(row.sourceId, 'S7');
  assert.equal(row.sourceName, 'Nature');
  assert.equal(row.isOa, true);
  assert.equal(row.authors.length, 2);
  assert.equal(row.authors[0].orcid, '0000-0001-0002-0003');
  assert.deepEqual(row.refs, ['W1', 'W2', 'garbage']);
  assert.equal(LitResearch.normalizeOpenAlexWork(null).id, '');
});

test('extIdsForRow and mergeExtIdLists dedupe by kind+value', function () {
  const a = LitResearch.extIdsForRow({ id: 'W1', doi: '10.1/a' });
  const b = LitResearch.extIdsForRow({ id: 'W2', doi: '10.1/a' });
  const merged = LitResearch.mergeExtIdLists(a, b);
  assert.equal(merged.length, 3);
  const local = LitResearch.extIdsForRow({ id: 'local:x', doi: '' });
  assert.equal(local.length, 0);
});

test('sanitizeFileStem handles illegal chars, reserved names, trailing dots and length', function () {
  assert.equal(LitResearch.sanitizeFileStem('a<b>c|d/e'), 'a b c d e');
  assert.equal(LitResearch.sanitizeFileStem('CON'), 'CON_');
  assert.equal(LitResearch.sanitizeFileStem('com1.txt'), 'com1.txt_');
  assert.equal(LitResearch.sanitizeFileStem('name... '), 'name');
  assert.equal(LitResearch.sanitizeFileStem('   '), '未命名');
  const long = LitResearch.sanitizeFileStem('标'.repeat(100), 50);
  assert.equal(Array.from(long).length, 50);
});

test('sessionDirName appends two-digit sequence', function () {
  assert.equal(LitResearch.sessionDirName('锂电池 Review', 1), '锂电池 Review 01');
  assert.equal(LitResearch.sessionDirName('锂电池 Review', 12), '锂电池 Review 12');
});

test('sessionTitleFrom truncates to ~20 chars', function () {
  assert.equal(LitResearch.sessionTitleFrom('  关于   超声电池监测的文献调研与分析 '), '关于 超声电池监测的文献调研与分析');
  assert.equal(LitResearch.sessionTitleFrom(''), '新会话');
  const long = LitResearch.sessionTitleFrom('字'.repeat(30));
  assert.equal(Array.from(long).length, 21); // 20 字 + 省略号
});

test('truncateForDisk marks truncation', function () {
  assert.equal(LitResearch.truncateForDisk('abc', 10), 'abc');
  const out = LitResearch.truncateForDisk('x'.repeat(50), 10);
  assert.equal(out.slice(0, 10), 'xxxxxxxxxx');
  assert.ok(out.indexOf('已截断') !== -1);
});

test('renderSessionMarkdown and sanitizeSessionForDisk round-trip safely', function () {
  const session = {
    id: 's1', title: '测试 <会话>', createdAt: '2026-09-19', updatedAt: '2026-09-19',
    model: 'test-model',
    attachments: [{ file: '附件/a.bib', label: '核心文献' }],
    messages: [
      { role: 'user', content: '找一下文献' },
      {
        role: 'assistant', content: '好的',
        toolCalls: [{ name: 'search_openalex', status: 'ok', summary: 'q=电池' }]
      },
      { role: 'tool', content: 'y'.repeat(99999) }
    ]
  };
  const clean = LitResearch.sanitizeSessionForDisk(session, 1000);
  assert.equal(clean.v, 1);
  const toolMsg = clean.messages[2];
  assert.ok(toolMsg.content.length < 1100);
  assert.ok(toolMsg.content.indexOf('已截断') !== -1);
  const md = LitResearch.renderSessionMarkdown(clean);
  assert.ok(md.indexOf('# 测试') !== -1);
  assert.ok(md.indexOf('openalex') !== -1);
  assert.ok(md.indexOf('附件：`附件/a.bib`') !== -1);
  // 原对象不被原地修改
  assert.equal(session.messages[2].content.length, 99999);
});

test('embeddingText follows the harness recipe and caps lengths', function () {
  const row = {
    title: 'Zinc batteries',
    abstract: 'A'.repeat(5000),
    concepts: ['Physics', 'Chemistry'],
    keywords: ['battery', 'zinc']
  };
  const text = LitResearch.embeddingText(row);
  assert.ok(text.startsWith('Zinc batteries\nAbstract: '));
  assert.ok(text.indexOf('Concepts: Physics, Chemistry') !== -1);
  assert.ok(text.indexOf('Keywords: battery, zinc') !== -1);
  assert.ok(text.length <= 3000);
  // 摘要在 2200 字符处截断
  const absPart = text.split('\n')[1];
  assert.ok(absPart.length <= 2200 + 'Abstract: '.length);
  assert.equal(LitResearch.embeddingText({}), '');
});

test('contentHash/embeddingHash are stable and input-sensitive', function () {
  const row = { title: 'T', abstract: 'A', concepts: ['c'], keywords: ['k'] };
  assert.equal(LitResearch.embeddingHash(row), LitResearch.embeddingHash({ title: 'T', abstract: 'A', concepts: ['c'], keywords: ['k'] }));
  assert.notEqual(LitResearch.embeddingHash(row), LitResearch.embeddingHash({ title: 'T2', abstract: 'A', concepts: ['c'], keywords: ['k'] }));
  assert.equal(LitResearch.contentHash(''), LitResearch.contentHash(''));
  assert.notEqual(LitResearch.contentHash('a'), LitResearch.contentHash('b'));
  assert.match(LitResearch.contentHash('x'), /^[0-9a-f]{16}$/);
});

test('estimateEmbedTokens weights CJK', function () {
  assert.ok(LitResearch.estimateEmbedTokens(['电池电池电池电池']) >= 4);
  assert.ok(LitResearch.estimateEmbedTokens(['battery health']) <= 4);
  assert.equal(LitResearch.estimateEmbedTokens([]), 0);
});
