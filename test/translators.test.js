'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const LitTranslators = require('../js/translators.js');

test('CNKI EndNote export fills missing metadata on a detail page', async function () {
  let listener;
  const title = { textContent: '保障数据隐私的锂电池多用户协同智能健康监测通用基础模型' };
  const elements = {
    '.wx-tit h1, .doc-top, #paramfilename': title,
    '.wx-tit > h1, .wx-tit h1': title,
    '#paramfilename': { value: 'JXGC20260826014' }
  };
  const document = {
    head: { innerHTML: '' },
    querySelector: selector => elements[selector] || null,
    querySelectorAll: () => []
  };
  const context = {
    document,
    location: { hostname: 'kns.cnki.net', pathname: '/kcms2/article/abstract', href: 'https://kns.cnki.net/kcms2/article/abstract?v=1' },
    URL,
    fetch: async () => ({ ok: true, json: async () => ({ code: 1, data: [{ key: 'EndNote', value: [
      '%0 Journal Article<br>%T 保障数据隐私的锂电池多用户协同智能健康监测通用基础模型<br>' +
      '%A 张微<br>%A 常希鹏<br>%A 李响<br>%A 杨绍杰<br>%J 机械工程学报<br>' +
      '%D 2026<br>%V 62<br>%N 11<br>%P 1-12<br>%I 0577-6686<br>%R 10.3901/JME.260773'
    ] }] }) }),
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    window: {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8'), context);
  const result = await new Promise(resolve => listener({ type: 'litboard-extract' }, {}, resolve));

  assert.deepEqual(Array.from(result.authors), ['张微', '常希鹏', '李响', '杨绍杰']);
  assert.equal(result.venue, '机械工程学报');
  assert.equal(result.year, '2026');
  assert.equal(result.volume, '62');
  assert.equal(result.issue, '11');
  assert.equal(result.pages, '1-12');
  assert.equal(result.issn, '0577-6686');
  assert.equal(result.doi, '10.3901/JME.260773');
  assert.equal(result.sourceType, 'translator:cnki');
});

test('CNKI journal tooltip does not become part of the captured journal name', async function () {
  let listener;
  const title = { textContent: '基于超声时频域主成分分析的磷酸铁锂储能电池荷电状态评估' };
  const elements = {
    '.wx-tit h1, .doc-top, #paramfilename': title,
    '.wx-tit > h1, .wx-tit h1': title,
    '.top-tip': { innerText: '高电压技术 · 查看该刊数据库收录来源' },
    '#paramfilename': { value: 'SMOKE20260818' }
  };
  const context = {
    document: { head: { innerHTML: '' }, querySelector: selector => elements[selector] || null, querySelectorAll: () => [] },
    location: { hostname: 'kns.cnki.net', pathname: '/kcms2/article/abstract', href: 'https://kns.cnki.net/kcms2/article/abstract?v=1' },
    URL,
    fetch: async () => ({ ok: true, json: async () => ({ code: 1, data: [
      { key: 'EndNote', value: ['%T 基于超声时频域主成分分析的磷酸铁锂储能电池荷电状态评估<br>%J 高电压技术'] }
    ] }) }),
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    window: { LitTranslators }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8'), context);
  const result = await new Promise(resolve => listener({ type: 'litboard-extract' }, {}, resolve));
  assert.equal(result.venue, '高电压技术');
  assert.equal(LitTranslators.parseCnkiPublicationInfo('高电压技术，查看该刊数据库收录来源').venue, '高电压技术');
});

test('CNKI journal meta fallback also removes the database-source tooltip', async function () {
  let listener;
  const title = { textContent: '基于超声时频域主成分分析的磷酸铁锂储能电池荷电状态评估' };
  const elements = {
    '.wx-tit h1, .doc-top, #paramfilename': title,
    '.wx-tit > h1, .wx-tit h1': title,
    'meta[name="citation_journal_title"], meta[property="citation_journal_title"]':
      { content: '高电压技术 · 查看该刊数据库收录来源' }
  };
  const context = {
    document: { head: { innerHTML: '' }, querySelector: selector => elements[selector] || null, querySelectorAll: () => [] },
    location: { hostname: 'kns.cnki.net', pathname: '/kcms2/article/abstract', href: 'https://kns.cnki.net/kcms2/article/abstract?v=article' },
    URL,
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    window: { LitTranslators }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8'), context);
  const result = await new Promise(resolve => listener({ type: 'litboard-extract' }, {}, resolve));
  assert.equal(result.venue, '高电压技术');
});

test('CNKI generic metadata fallback removes the journal tooltip when detail selectors change', async function () {
  let listener;
  const elements = {
    'meta[name="citation_title"], meta[property="citation_title"]': { content: '储能电池荷电状态评估' },
    'meta[name="citation_journal_title"], meta[property="citation_journal_title"]':
      { content: '高电压技术 · 查看该刊数据库收录来源' }
  };
  const context = {
    document: {
      title: '储能电池荷电状态评估', body: { innerText: '' },
      querySelector: selector => elements[selector] || null,
      querySelectorAll: () => []
    },
    location: { hostname: 'kns.cnki.net', pathname: '/kcms2/article/abstract', href: 'https://kns.cnki.net/kcms2/article/abstract?v=article' },
    URL,
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    window: { LitTranslators }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8'), context);
  const result = await new Promise(resolve => listener({ type: 'litboard-extract' }, {}, resolve));
  assert.equal(result.venue, '高电压技术');
});

function ctx(url, metaMap, texts, opts) {
  // metaMap 值可为 string（单值）或 string[]（真多值，模拟重复 meta 标签）
  const o = opts || {};
  const values = function (name) {
    const v = (metaMap || {})[name];
    if (v == null) return [];
    return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  };
  const attrs = o.attrs || {}; // {selector: {attrName: value}}
  return {
    url: function () { return url; },
    meta: function (name) { return values(name)[0] || ''; },
    metas: function (name) { return values(name); },
    attr: function (selector, attrName) {
      return attrs[selector] && attrs[selector][attrName] != null ? String(attrs[selector][attrName]) : '';
    },
    jsonld: function () { return o.jsonld || []; },
    text: function (sel) { return (texts || {})[sel] || ''; }
  };
}

test('arXiv translator maps abs page to preprint with eprint extras', function () {
  const r = LitTranslators.runTranslators(ctx('https://arxiv.org/abs/1706.03762v5', {
    'citation_title': 'Attention Is All You Need',
    'citation_author': 'Ashish Vaswani; Noam Shazeer',
    'citation_date': '2017/06/12',
    'citation_pdf_url': 'https://arxiv.org/pdf/1706.03762'
  }));
  assert.equal(r.report.translator, 'arxiv');
  assert.equal(r.item.entryType, 'preprint');
  assert.equal(r.item.sourceType, 'translator:arxiv');
  assert.equal(r.item.bibtexExtra.eprint, '1706.03762');
  assert.equal(r.item.date, '2017/06/12');
  assert.equal(r.item.attachments[0].url, 'https://arxiv.org/pdf/1706.03762');
});

test('PubMed translator records PMID and finds DOI in page text', function () {
  const r = LitTranslators.runTranslators(ctx('https://pubmed.ncbi.nlm.nih.gov/12345678/', {
    'citation_title': 'Some Study',
    'citation_author': 'Jane Doe'
  }, { '.citation-doi': 'doi: 10.1000/example' }));
  assert.equal(r.report.translator, 'pubmed');
  assert.equal(r.item.bibtexExtra.pmid, '12345678');
  assert.equal(r.item.doi, '10.1000/example');
});

test('CNKI translator splits semicolon authors and keeps dbcode', function () {
  const r = LitTranslators.runTranslators(ctx('https://kns.cnki.net/kcms2/article/abstract?v=x&dbcode=CJFD', {
    'citation_title': '深度学习综述',
    'citation_author': '张三; 李四; 王五'
  }));
  assert.equal(r.report.translator, 'cnki');
  assert.deepEqual(r.item.authors, ['张三', '李四', '王五']);
  assert.equal(r.item.bibtexExtra.dbcode, 'CJFD');
});


test('unmatched site returns null; matched-but-failing returns failed report', function () {
  assert.equal(LitTranslators.runTranslators(ctx('https://example.com/paper', {})), null);
  const r = LitTranslators.runTranslators(ctx('https://arxiv.org/abs/1706.03762', {})); // 无 meta 仍可出标题？无 citation_title → itemFromMeta 空标题
  assert.ok(r.report.failed === true || r.report.translator === 'arxiv');
});

test('publisher generic layer maps repeated citation_author and conference entries', function () {
  const r = LitTranslators.runTranslators({
    url: () => 'https://ieeexplore.ieee.org/document/1234567',
    meta: (n) => ({
      'citation_title': 'A Conference Paper',
      'citation_conference_title': 'Proc. IEEE ICML',
      'citation_pdf_url': 'https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=1234567'
    }[n] || ''),
    metas: (n) => n === 'citation_author' ? ['Wei Li', 'San Zhang'] : [],
    jsonld: () => []
  });
  assert.equal(r.report.translator, 'publisher');
  assert.deepEqual(r.item.authors, ['Wei Li', 'San Zhang']);
  assert.equal(r.item.venue, 'Proc. IEEE ICML');
  assert.equal(r.item.entryType, 'inproceedings');
  assert.equal(r.item.attachments.length, 1);
});

test('biorxiv preprint marks server and preprint entry type', function () {
  const r = LitTranslators.runTranslators({
    url: () => 'https://www.biorxiv.org/content/10.1101/2024.01.01.123456',
    meta: (n) => ({ 'citation_title': 'A Preprint', 'citation_doi': '10.1101/2024.01.01.123456' }[n] || ''),
    metas: () => [],
    jsonld: () => []
  });
  assert.equal(r.item.entryType, 'preprint');
  assert.equal(r.item.bibtexExtra.server, 'bioRxiv');
});

test('google scholar detail page uses citation meta; missing meta reports failure reason', function () {
  const ok = LitTranslators.runTranslators({
    url: () => 'https://scholar.google.com/scholar?cluster=123',
    meta: (n) => ({ 'citation_title': 'Scholar Paper', 'citation_journal_title': 'Some J', 'citation_publication_date': '2020/05/01' }[n] || ''),
    metas: (n) => n === 'citation_author' ? ['Doe J'] : [],
    attr: () => '',
    text: () => '',
    jsonld: () => []
  });
  assert.equal(ok.report.translator, 'google-scholar');
  assert.equal(ok.item.venue, 'Some J');
  assert.equal(ok.item.date, '2020/05/01');
  const fail = LitTranslators.runTranslators({
    url: () => 'https://scholar.google.com/scholar?q=x',
    meta: () => '', metas: () => [], attr: () => '', text: () => '', jsonld: () => []
  });
  assert.equal(fail.report.failed, true);
  assert.equal(fail.report.reason, 'no-meta'); // 调用方据此提示具体失败原因
});

test('keyword tags collect from repeated citation_keywords', function () {
  const r = LitTranslators.runTranslators({
    url: () => 'https://www.nature.com/articles/s41586-020-0000-0',
    meta: (n) => ({ 'citation_title': 'Nature Paper' }[n] || ''),
    metas: (n) => n === 'citation_keywords' ? ['crispr', 'genomics'] : [],
    jsonld: () => []
  });
  assert.equal(r.report.translator, 'publisher');
  assert.deepEqual(r.item.tags, ['crispr', 'genomics']);
});

test('publisher layer maps volume/issue/first-last pages/date via shared fixture', function () {
  const miss = LitTranslators.runTranslators(ctx('https://journals.aps.org/prl/abstract/10.1103/x', { 'citation_title': 'T' }));
  assert.equal(miss, null); // 未命中站点
  const p = LitTranslators.runTranslators(ctx('https://www.sciencedirect.com/science/article/pii/S0092867420301445', {
    'citation_title': 'Journal Article',
    'citation_journal_title': 'Cell',
    'citation_volume': '181',
    'citation_issue': '2',
    'citation_firstpage': '391',
    'citation_lastpage': '399',
    'citation_doi': 'https://doi.org/10.1016/j.cell.2020.04.004',
    'citation_date': '2020/04/16',
    'citation_author': ['Alice A', 'Bob B', 'Carol C']
  }));
  assert.equal(p.report.translator, 'publisher');
  assert.equal(p.item.volume, '181');
  assert.equal(p.item.issue, '2');
  assert.equal(p.item.pages, '391-399');
  assert.equal(p.item.doi, '10.1016/j.cell.2020.04.004'); // doi.org 前缀剥离
  assert.equal(p.item.date, '2020/04/16');
  assert.deepEqual(p.item.authors, ['Alice A', 'Bob B', 'Carol C']); // 真多值 meta
  assert.equal(p.item.sourceType, 'translator:publisher');
});

test('google scholar PDF fallback via ctx.attr when no citation_pdf_url', function () {
  const r = LitTranslators.runTranslators(ctx('https://scholar.google.com/scholar?cluster=123', {
    'citation_title': 'Scholar With PDF'
  }, {}, { attrs: { 'a[href*="pdf"]': { href: 'https://example.edu/paper.pdf' } } }));
  assert.equal(r.report.translator, 'google-scholar');
  assert.equal(r.item.attachments.length, 1);
  assert.equal(r.item.attachments[0].url, 'https://example.edu/paper.pdf');
  assert.equal(r.item.attachments[0].source, 'page-link');
});

test('publisher host matching covers springer/oup/cambridge variants', function () {
  ['https://link.springer.com/article/10.1007/s112', 'https://academic.oup.com/bioinformatics/article/36/1/1',
   'https://www.cambridge.org/core/journals/1', 'https://journals.plos.org/plosone/article?id=10.1/x',
   'https://www.frontiersin.org/articles/10.3389/fx', 'https://pubs.acs.org/doi/10.1021/x'].forEach(function (url) {
    const r = LitTranslators.runTranslators(ctx(url, { 'citation_title': 'T', 'citation_author': 'Solo' }));
    assert.equal(r && r.report.translator, 'publisher', url);
  });
});
