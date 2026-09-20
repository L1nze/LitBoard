'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitCite = require('../js/cite.js');

const paper = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit'],
  year: 2017,
  venue: 'Advances in Neural Information Processing Systems',
  volume: '30',
  pages: '5998-6008',
  doi: '10.48550/arXiv.1706.03762',
  entryType: 'inproceedings',
  tags: ['deep-learning']
};

test('APA formats western authors as Family, Initials with year and DOI', function () {
  const out = LitCite.apa(paper);
  assert.match(out, /^Vaswani, A\., Shazeer, N\., Parmar, N\., & Uszkoreit, J\. \(2017\)\./);
  assert.match(out, /Attention Is All You Need/);
  assert.match(out, /https:\/\/doi\.org\/10\.48550\/arXiv\.1706\.03762$/);
});

test('GB/T 7714 truncates to first three authors + et al and marks type', function () {
  const out = LitCite.gbt7714(paper);
  assert.match(out, /^Vaswani A, Shazeer N, Parmar N, et al\./);
  assert.match(out, /\[C\]/); // inproceedings -> 会议[C]
  assert.match(out, /2017, 30: 5998-6008\.$/);
});

test('GB/T 7714 keeps Chinese names intact and uses 等', function () {
  const cn = LitCite.gbt7714({
    title: '深度学习综述', authors: ['张三', '李四', '王五', '赵六'],
    year: 2024, venue: '计算机学报', entryType: 'article'
  });
  assert.match(cn, /^张三, 李四, 王五, 等\. 深度学习综述\[J\]\./);
});

test('RIS emits valid tagged records with split page range', function () {
  const ris = LitCite.ris(paper);
  assert.match(ris, /^TY {2}- CONF/m);
  assert.match(ris, /^AU {2}- Vaswani, Ashish/m);
  assert.match(ris, /^SP {2}- 5998/m);
  assert.match(ris, /^EP {2}- 6008/m);
  assert.match(ris, /^DO {2}- 10\.48550\/arXiv\.1706\.03762/m);
  assert.match(ris, /^ER {2}- \s*$/m);
});

test('RIS handles multiple papers separated by blank lines', function () {
  const ris = LitCite.ris([paper, { title: 'X', authors: [], entryType: 'article' }]);
  assert.equal((ris.match(/^TY {2}- /gm) || []).length, 2);
  assert.equal((ris.match(/^ER {2}- /gm) || []).length, 2);
});

test('v12 creator projection keeps citation output identical', function () {
  // authors 现在是 creators 的投影（"Given Family" → "Family, Given"），
  // 手写引用引擎（勿动）的输出必须逐字不回归。
  const LitModel = require('../js/model.js');
  const normalized = LitModel.normalizePaper(paper);
  assert.equal(LitCite.apa(normalized), LitCite.apa(paper));
  assert.equal(LitCite.gbt7714(normalized), LitCite.gbt7714(paper));
  assert.equal(LitCite.mla(normalized), LitCite.mla(paper));
  const cjk = LitModel.normalizePaper({
    title: '深度学习综述', authors: ['张三', '李四', '王五', '赵六'],
    year: 2024, venue: '计算机学报', entryType: 'article'
  });
  assert.match(LitCite.gbt7714(cjk), /^张三, 李四, 王五, 等\. 深度学习综述\[J\]\./);
});
