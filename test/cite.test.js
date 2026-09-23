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
const cnPaper = {
  title: '深度学习综述', authors: ['张三', '李四', '王五', '赵六'],
  year: 2024, venue: '计算机学报', volume: '47', issue: '3', pages: '521-535',
  entryType: 'article'
};

// 样式渲染统一走 citeproc（js/cslcite.js，locale 恒 zh-CN），断言其真实输出的结构
const STYLE_IDS = { apa: 'apa', gbt7714: 'china-national-standard-gb-t-7714-2015-numeric', mla: 'modern-language-association' };

test('formats 是 {key,label,styleId} 元数据，指向 vendor 内置样式', function () {
  assert.deepEqual(LitCite.formats.map(function (f) { return f.styleId; }), [
    STYLE_IDS.apa, STYLE_IDS.gbt7714, STYLE_IDS.mla
  ]);
  assert.ok(LitCite.formats.every(function (f) { return f.key && f.label; }));
});

test('APA renders western authors as Family, Initials with year and DOI', async function () {
  const out = await LitCite.renderFormat(STYLE_IDS.apa, paper);
  assert.match(out, /^Vaswani, A\., Shazeer, N\., Parmar, N\., & Uszkoreit, J\. \(2017\)\./);
  assert.match(out, /Attention Is All You Need\./);
  assert.match(out, /Advances in Neural Information Processing Systems, 30/);
  assert.match(out, /https:\/\/doi\.org\/10\.48550\/arXiv\.1706\.03762$/);
  // 纯文本出口：HTML 标签经 htmlToRuns 消灭，不留字面残留
  assert.doesNotMatch(out, /<[a-z]/i);
});

test('GB/T 7714 truncates to first three authors + et al and marks conference type', async function () {
  const out = await LitCite.renderFormat(STYLE_IDS.gbt7714, paper);
  assert.match(out, /^\[1\]\tVaswani A, Shazeer N, Parmar N, et al\./); // 编号 + 前三作者 + et al.
  assert.match(out, /Attention Is All You Need\[C\]\/\//); // 会议条目完整 [C]// 形态
  assert.match(out, /2017: 5998-6008\.$/);
  // vendored 定制：不输出 DOI/URL；西文条目用 et al. 不用「等」
  assert.doesNotMatch(out, /10\.48550|DOI|https?:/i);
  assert.doesNotMatch(out, /等/);
  assert.doesNotMatch(out, /<[a-z]/i);
});

test('GB/T 7714 keeps Chinese names intact and uses 等', async function () {
  const out = await LitCite.renderFormat(STYLE_IDS.gbt7714, cnPaper);
  assert.match(out, /^\[1\]\t张三, 李四, 王五, 等\. 深度学习综述\[J\]\./);
  assert.match(out, /计算机学报, 2024, 47\(3\): 521-535\.$/);
  assert.doesNotMatch(out, /et al\./);
});

test('MLA lists first author in full then et-al marker, with title and DOI', async function () {
  const out = await LitCite.renderFormat(STYLE_IDS.mla, paper);
  // zh-CN locale：术语为中文（《》/卷/页），条目含 CJK 故 fixLatinEtAl 规则不适用，「等」保留
  assert.match(out, /^Vaswani, Ashish, 等\. 《Attention Is All You Need》\./);
  assert.match(out, /Advances in Neural Information Processing Systems/);
  assert.match(out, /https:\/\/doi\.org\/10\.48550\/arXiv\.1706\.03762\.$/);
  assert.doesNotMatch(out, /<[a-z]/i);
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

test('splitName parses western and CJK names (retained API)', function () {
  assert.deepEqual(LitCite._splitName('Ashish Vaswani'), { raw: 'Ashish Vaswani', family: 'Vaswani', given: 'Ashish', isCJK: false });
  assert.deepEqual(LitCite._splitName('Vaswani, Ashish'), { raw: 'Vaswani, Ashish', family: 'Vaswani', given: 'Ashish', isCJK: false });
  assert.deepEqual(LitCite._splitName('张三'), { raw: '张三', family: '张三', given: '', isCJK: true });
  assert.deepEqual(LitCite._splitName('Aristotle'), { raw: 'Aristotle', family: 'Aristotle', given: '', isCJK: false });
});

test('creator projection keeps citation output identical', async function () {
  // authors 是 creators 的投影（"Given Family" → "Family, Given"），
  // 经 normalize 的条目渲染输出必须与原始条目逐字一致。
  const LitModel = require('../js/model.js');
  for (const fmt of LitCite.formats) {
    const raw = await LitCite.renderFormat(fmt.styleId, paper);
    const normalized = await LitCite.renderFormat(fmt.styleId, LitModel.normalizePaper(paper));
    assert.equal(normalized, raw, fmt.key + ' 投影后输出一致');
  }
  const cjk = await LitCite.renderFormat(STYLE_IDS.gbt7714, LitModel.normalizePaper(cnPaper));
  assert.match(cjk, /张三, 李四, 王五, 等\. 深度学习综述\[J\]\./);
});
