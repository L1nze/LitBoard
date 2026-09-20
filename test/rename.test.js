'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitRename = require('../js/rename.js');

const paper = {
  authors: ['Vaswani, Ashish', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit'],
  year: 2017,
  title: 'Attention Is All You Need',
  venue: 'NeurIPS',
  key: 'vaswani2017'
};

test('buildName renders author/year/title tokens', function () {
  assert.equal(LitRename.buildName(paper, '{author} - {year} - {title}'),
    'Vaswani - 2017 - Attention Is All You Need');
  assert.equal(LitRename.buildName(paper, '{citekey}_{venue}'), 'vaswani2017_NeurIPS');
});

test('authors3 token collapses long author lists with et al.', function () {
  // 文件名不允许结尾句点：'et al.' 的尾点会被清洗
  assert.equal(LitRename.buildName(paper, '{authors3}'), 'Vaswani, Shazeer, Parmar et al');
  assert.equal(LitRename.buildName({ authors: ['Solo Author'], year: 2020 }, '{authors3}'), 'Author');
});

test('sanitize strips filesystem-illegal and control characters', function () {
  assert.equal(LitRename.sanitize('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(LitRename.sanitize('trail...   '), 'trail');
  assert.equal(LitRename.sanitize('ok'), 'ok');
});

test('buildName falls back for empty input and keeps long titles bounded', function () {
  assert.equal(LitRename.buildName({}, ''), 'anon - nodate - untitled');
  const long = LitRename.buildName({ title: 'x'.repeat(500), authors: [], year: null }, '{title}');
  assert.ok(long.length <= 120);
});

test('unknown tokens pass through literally', function () {
  assert.equal(LitRename.buildName(paper, '{year}[{doi}]'), '2017[{doi}]');
});
