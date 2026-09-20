'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LitCsl = require('../js/cslcite.js');

const styleDir = path.join(__dirname, '..', 'vendor', 'citeproc', 'styles');
const localeDir = path.join(__dirname, '..', 'vendor', 'citeproc', 'locales');
const apa = fs.readFileSync(path.join(styleDir, 'apa.csl'), 'utf8');
const gbt = fs.readFileSync(path.join(styleDir, 'china-national-standard-gb-t-7714-2015-numeric.csl'), 'utf8');
const enUS = fs.readFileSync(path.join(localeDir, 'en-US.xml'), 'utf8');
const zhCN = fs.readFileSync(path.join(localeDir, 'zh-CN.xml'), 'utf8');

const multiLatin = {
  id: 'l1', title: 'Bearing fault diagnosis with deep learning', entryType: 'article',
  authors: ['X Wang', 'D Mao', 'X Li', 'Zhao Liu'], year: 2020,
  venue: 'Mechanical Systems and Signal Processing', volume: '140', pages: '106-655',
  doi: '10.1016/j.ymssp.2020.106655'
};
const multiCjk = {
  id: 'c1', title: '基于声振融合的故障诊断', entryType: 'article',
  authors: ['张三', '李四', '王五', '赵六'], year: 2021, venue: '机械工程学报',
  volume: '57', pages: '1-10'
};

test('paperToCslItem maps bibliographic fields and author forms', function () {
  const item = LitCsl.paperToCslItem({
    id: 'p1', entryType: 'inproceedings', title: 'A Paper',
    authors: ['X Wang', 'Mao, Dong', '张三', 'Aristotle'],
    year: 2020, venue: 'CVPR', volume: '3', issue: '2', pages: '1-10',
    doi: '10.1/x', url: 'https://example.org/x', publisher: 'ACM', issn: '1234-5678'
  });
  assert.equal(item.id, 'p1');
  assert.equal(item.type, 'paper-conference');
  assert.equal(item.title, 'A Paper');
  // 创作者三种写法：末段姓氏 / 「姓, 名」 / 中文全名与单段名按 literal 保序
  assert.deepEqual(item.author, [
    { family: 'Wang', given: 'X' },
    { family: 'Mao', given: 'Dong' },
    { literal: '张三' },
    { literal: 'Aristotle' }
  ]);
  assert.deepEqual(item.issued, { 'date-parts': [[2020]] });
  assert.equal(item['container-title'], 'CVPR');
  assert.equal(item.volume, '3');
  assert.equal(item.issue, '2');
  assert.equal(item.page, '1-10');
  assert.equal(item.DOI, '10.1/x');
  assert.equal(item.URL, 'https://example.org/x');
  assert.equal(item.publisher, 'ACM');
  assert.equal(item.ISSN, '1234-5678');
  // 无法映射的条目类型按 document，不静默归为 article
  assert.equal(LitCsl.paperToCslItem({ id: 'x', entryType: 'dataset', title: 'T' }).type, 'document');
});

test('paperToCslItemFull maps creators, structured dates and extra containers', function () {
  const item = LitCsl.paperToCslItemFull({
    id: 'p2', title: 'Full', date: '2021-05-06', accessDate: '2022-01-02',
    creators: [
      { creatorType: 'author', family: 'Li', given: 'Si' },
      { creatorType: 'editor', name: '编委会' },
      { creatorType: 'translator', family: 'Zhao', given: 'Liu' }
    ],
    place: 'Beijing', series: 'LNCS', journalAbbreviation: 'J. Test',
    entryType: 'dataset', sourceType: 'dataset'
  });
  assert.deepEqual(item.author, [{ family: 'Li', given: 'Si' }]);
  assert.deepEqual(item.editor, [{ literal: '编委会' }]);
  assert.deepEqual(item.translator, [{ family: 'Zhao', given: 'Liu' }]);
  assert.deepEqual(item.issued, { 'date-parts': [[2021, 5, 6]] });
  assert.deepEqual(item.accessed, { 'date-parts': [[2022, 1, 2]] });
  assert.equal(item['publisher-place'], 'Beijing');
  assert.equal(item['collection-title'], 'LNCS');
  assert.equal(item['container-title-short'], 'J. Test');
  assert.equal(item.genre, 'dataset');
  assert.equal(item.type, 'document');
});

test('citeproc renders APA bibliography from vendored style', async function () {
  const out = await LitCsl.renderBibliography([multiLatin], apa, enUS);
  assert.equal(out.length, 1);
  assert.match(out[0], /Wang, X\., Mao, D\., Li, X\., &#38; Liu, Z\./);
  assert.match(out[0], /\(2020\)\./);
  assert.match(out[0], /<i>Mechanical Systems and Signal Processing<\/i>/);
  assert.match(out[0], /https:\/\/doi\.org\/10\.1016\/j\.ymssp\.2020\.106655/);
});

test('citeproc renders GB/T 7714 numeric bibliography with Chinese locale', async function () {
  const out = await LitCsl.renderBibliography([multiCjk], gbt, zhCN);
  assert.equal(out.length, 1);
  assert.match(out[0], /\[1\]/);
  assert.match(out[0], /张三, 李四, 王五, 等\./);
  assert.match(out[0], /基于声振融合的故障诊断\[J\]\. 机械工程学报, 2021, 57: 1-10\./);
  // vendored 定制：access/medium-id 不再输出 DOI 与联机标志
  assert.doesNotMatch(out[0], /DOI|http|\[J\/OL\]/i);
});

test('姓氏大小写：全大写规范成首字母大写，已规范写法与虚词原样保留', function () {
  const item = LitCsl.paperToCslItem({
    id: 'n1', title: 'T', entryType: 'article',
    authors: ['BROWN, T B', 'WANG, Y', 'McDonald, K', 'van der Berg, J', 'LI, J', '张三', 'ARISTOTLE']
  });
  assert.deepEqual(item.author.map(function (a) { return a.family || a.literal; }),
    ['Brown', 'Wang', 'McDonald', 'van der Berg', 'Li', '张三', 'ARISTOTLE']);
  // 单字姓氏不做虚词判断（杜 DU → Du，不是 du）
  assert.equal(LitCsl.paperToCslItem({ id: 'n2', title: 'T', entryType: 'book', authors: ['DU, W'] }).author[0].family, 'Du');
  // 多词姓氏里的虚词保持小写；非虚词照常首字母大写
  const multi = LitCsl.paperToCslItemFull({
    id: 'n3', title: 'T', entryType: 'book',
    creators: [{ creatorType: 'author', family: 'VAN DER BERG', given: 'J' },
      { creatorType: 'editor', family: 'SMITH-JONES', given: 'A' }]
  });
  assert.equal(multi.author[0].family, 'van der Berg');
  assert.equal(multi.editor[0].family, 'Smith-Jones');
});

test('GB/T 7714 渲染：姓氏首字母大写而非全大写', async function () {
  const out = await LitCsl.renderBibliography([{
    id: 'caps1', title: 'Language Models are Few-Shot Learners', entryType: 'inproceedings',
    authors: ['T B BROWN', 'B MANN'], year: 2020, venue: 'NeurIPS', volume: '33', pages: '1877-1901'
  }], gbt, zhCN);
  assert.match(out[0], /Brown T B, Mann B\./);
  assert.doesNotMatch(out[0], /BROWN T B/);
});

test('fixLatinEtAl: 西文条目「等」→ et al.，中文条目保留', function () {
  assert.equal(LitCsl.fixLatinEtAl('WANG X, MAO D, LI X, 等. Bearing fault diagnosis.'), 'WANG X, MAO D, LI X, et al. Bearing fault diagnosis.');
  assert.equal(LitCsl.fixLatinEtAl('张三, 李四, 王五, 等. 基于声振融合的故障诊断.'), '张三, 李四, 王五, 等. 基于声振融合的故障诊断.');
  // zh-CN 术语紧贴西文名：补出 "et al." 的标准间隔（Vaswani等 → Vaswani et al.）
  assert.equal(LitCsl.fixLatinEtAl('(Brown等, 2020; Wang等, 2024)'), '(Brown et al., 2020; Wang et al., 2024)');
  assert.equal(LitCsl.fixLatinEtAl('Vaswani等.'), 'Vaswani et al.');
  assert.equal(LitCsl.fixLatinEtAl('等, 2017'), 'et al., 2017');
  assert.equal(LitCsl.fixLatinEtAl('no marker here'), 'no marker here');
  assert.equal(LitCsl.fixLatinEtAl(''), '');
  assert.equal(LitCsl.fixLatinEtAl(null), '');
});

test('htmlToRtf: HTML 标签转成 RTF 控制字，非 ASCII 走转义序列', function () {
  // 上标：Word 的域结果只认纯文本，<sup> 直接塞进去会原样印出来
  assert.equal(LitCsl.htmlToRtf('<sup>[1]</sup>'), '{\\super [1]}');
  // 斜体 / 粗体 / 小型大写：标签换成 RTF 分组
  assert.equal(LitCsl.htmlToRtf('<i>J</i> of <b>T</b>ests'), '{\\i J} of {\\b T}ests');
  assert.equal(LitCsl.htmlToRtf('<span style="font-variant:small-caps;">smith</span>'), '{\\scaps smith}');
  // 中文与 en dash 按 citeproc 的 rtf 约定转义（临时文件按 ASCII 落盘也不会乱码）
  assert.equal(LitCsl.htmlToRtf('张三'), '\\uc0\\u24352{}\\uc0\\u19977{}');
  assert.equal(LitCsl.htmlToRtf('&#8211;'), '\\uc0\\u8211{}');
  // RTF 特殊字符必须转义，否则会破坏控制字结构
  assert.equal(LitCsl.htmlToRtf('a{b}c\\d'), 'a\\{b\\}c\\\\d');
  // second-field-align：编号与正文之间补 \tab（配合段落制表位把正文对齐）
  const entry = '<div class="csl-entry">\n  <div class="csl-left-margin">[1]</div>' +
    '<div class="csl-right-inline">HE K. Title.</div>\n</div>\n';
  assert.equal(LitCsl.htmlToRtf(entry), '[1]\\tab HE K. Title.');
  // citeproc 输出里的缩进换行是排版噪声，不能变成条目开头的空格
  assert.equal(LitCsl.htmlToRtf('\n    plain\n  '), 'plain');
  assert.equal(LitCsl.htmlToRtf(''), '');
  assert.equal(LitCsl.htmlToRtf(null), '');
});

test('htmlToRuns: 同一套词法的 docx run 形态（导出 Word 用）', function () {
  // 上标：docx 侧要的是 run 上的格式标志，不是 <sup> 文本
  assert.deepEqual(LitCsl.htmlToRuns('<sup>[1,2]</sup>'), [{ text: '[1,2]', sup: true }]);
  assert.deepEqual(LitCsl.htmlToRuns('A <i>B</i> &amp; <b>C</b>'),
    [{ text: 'A ' }, { text: 'B', italic: true }, { text: ' & ' }, { text: 'C', bold: true }]);
  // second-field-align：编号与正文之间是一个制表位 run（配合段落制表位对齐）
  const entry = '<div class="csl-entry">\n  <div class="csl-left-margin">[1]</div>' +
    '<div class="csl-right-inline">HE K. <i>T</i>.</div>\n</div>\n';
  assert.deepEqual(LitCsl.htmlToRuns(entry), [
    { text: '[1]' }, { tab: true }, { text: 'HE K. ' }, { text: 'T', italic: true }, { text: '.' }
  ]);
  assert.deepEqual(LitCsl.htmlToRuns('a<br>b'), [{ text: 'a' }, { br: true }, { text: 'b' }]);
  assert.deepEqual(LitCsl.htmlToRuns('<span style="font-variant:small-caps;">smith</span>'),
    [{ text: 'smith', smallCaps: true }]);
  // HTML 实体解码一次，不在两个出口里各解一遍
  assert.deepEqual(LitCsl.htmlToRuns('&#8211; &lt;x&gt;'), [{ text: '\u2013 <x>' }]);
  assert.deepEqual(LitCsl.htmlToRuns(''), []);
  assert.deepEqual(LitCsl.htmlToRuns(null), []);
});

test('GB/T 7714 渲染：西文条目 et al. 且不输出 DOI/URL，中文条目保留「等」', async function () {
  const out = await LitCsl.renderBibliography([multiLatin, multiCjk], gbt, zhCN);
  assert.equal(out.length, 2);
  const latin = out[0], cjk = out[1];
  assert.match(latin, /et al\./);
  assert.doesNotMatch(latin, /et al\.\./);
  assert.doesNotMatch(latin, /等/);
  assert.doesNotMatch(latin, /DOI|10\.1016|http/i);
  assert.match(cjk, /等/);
  assert.doesNotMatch(cjk, /et al\./);
});

test('GB/T 7714 卷号输出裸数字，西文条目不再混入「卷」标签', async function () {
  const conf = {
    id: 'n1', title: 'Attention Is All You Need', entryType: 'inproceedings',
    authors: ['A Vaswani', 'N Shazeer', 'N Parmar'], year: 2017,
    venue: 'NeurIPS', volume: '30', pages: '5998-6008'
  };
  const book = {
    id: 'n2', title: '中文多卷书', entryType: 'book', authors: ['张三'], year: 2015,
    publisher: '高等教育出版社', place: '北京', volume: '2'
  };
  // 顺序编码与著者-出版年两个变体的 volume 宏同源，都要断言
  // （author-date 的文献表按著者-年份重排，按内容找条目，不按下标）
  const adStyle = fs.readFileSync(path.join(styleDir, 'china-national-standard-gb-t-7714-2015-author-date.csl'), 'utf8');
  const numOut = await LitCsl.renderBibliography([conf, book], gbt, zhCN);
  assert.match(numOut[0], /\[C\]\/\/NeurIPS: 30\. 2017: 5998-6008\./);
  assert.doesNotMatch(numOut[0], /卷/);
  assert.match(numOut[1], /中文多卷书: 2\[M\]/);
  const adOut = (await LitCsl.renderBibliography([conf, book], adStyle, zhCN))
    .find(function (entry) { return entry.indexOf('NeurIPS') !== -1; });
  assert.match(adOut, /\[C\]\/\/NeurIPS: 30\. 5998-6008\./);
  assert.doesNotMatch(adOut, /卷/);
});

test('GB/T 7714 不输出孤立的「[引用日期]」（access 定制的一部分）', async function () {
  const cited = {
    id: 'acc1', title: 'An Electrochemical Aging-Informed Approach', entryType: 'article',
    authors: ['S Zhang', 'Z Liu'], year: 2025,
    venue: 'IEEE Transactions on Power Electronics', volume: '40', issue: '5',
    pages: '7354-7369', doi: '10.1109/tpel.2025.x', accessDate: '2025-03-13'
  };
  const adStyle = fs.readFileSync(path.join(styleDir, 'china-national-standard-gb-t-7714-2015-author-date.csl'), 'utf8');
  const numOut = (await LitCsl.renderBibliography([cited], gbt, zhCN))[0];
  assert.match(numOut, /7354-7369\./);
  assert.doesNotMatch(numOut, /\[\d{4}-\d{2}-\d{2}\]/);
  const adOut = (await LitCsl.renderBibliography([cited], adStyle, zhCN))[0];
  assert.doesNotMatch(adOut, /\[\d{4}-\d{2}-\d{2}\]/);
});
