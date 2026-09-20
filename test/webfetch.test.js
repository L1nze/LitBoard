'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../js/webfetch.js');

test('isAcademicUrl: whitelist suffixes match with exact boundaries', function () {
  assert.equal(W.isAcademicUrl('https://arxiv.org/abs/2401.00001').ok, true);
  assert.equal(W.isAcademicUrl('https://www.nature.com/articles/x').ok, true);
  assert.equal(W.isAcademicUrl('http://math.mit.edu/paper.pdf').ok, true);       // .edu
  assert.equal(W.isAcademicUrl('https://foo.ac.cn/a').ok, true);                 // .ac.cn
  assert.equal(W.isAcademicUrl('https://pmc.ncbi.nlm.nih.gov/pmid/x').ok, true);
  assert.equal(W.isAcademicUrl('https://evil-cambridge.org/x').ok, false);       // 边界：非子域
  assert.equal(W.isAcademicUrl('https://arxiv.org.evil.com/x').ok, false);       // 白名单串不受信
  assert.equal(W.isAcademicUrl('https://github.com/x').ok, false);               // 非学术
  assert.equal(W.isAcademicUrl('ftp://arxiv.org/x').ok, false);                  // 协议
  assert.equal(W.isAcademicUrl('not a url').ok, false);
  const denied = W.isAcademicUrl('https://example.com/x');
  assert.ok(denied.reason.indexOf('白名单') !== -1);
});

test('normalizeSearchResponse: defensive fields, shape mismatch reported', function () {
  const payload = {
    results: [
      {
        title: 'A Study',
        url: 'https://arxiv.org/abs/1',
        snippet: 'abs',
        site_name: 'arxiv.org',
        authors: ['Zhang', 'Li'],
        venue: 'Nature',
        year: 2024,
        citation_count: 7,
        doi: 'https://doi.org/10.1/A'
      },
      { title: '', url: 'https://x' } // 无标题 → 过滤
    ],
    total_results: 5
  };
  const r = W.normalizeSearchResponse(payload, 'q');
  assert.equal(r.shapeOk, true);
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.results[0].authors, ['Zhang', 'Li']);
  assert.equal(r.results[0].venue, 'Nature');
  assert.equal(r.results[0].year, 2024);
  assert.equal(r.results[0].citations, 7);
  assert.equal(r.results[0].doi, '10.1/a');
  const bad = W.normalizeSearchResponse({ error: 'x' }, 'q');
  assert.equal(bad.shapeOk, false);
  assert.equal(bad.results.length, 0);
});

test('parseFetchResponse: 200 with errors[] is a reported partial failure', function () {
  const r = W.parseFetchResponse({
    results: [],
    errors: [{ url: 'https://arxiv.org/abs/1', error: 'timeout' }]
  }, 'https://arxiv.org/abs/1');
  assert.equal(r.ok, false);
  assert.equal(r.partial, true);
  assert.ok(r.error.indexOf('timeout') !== -1);
});

test('parseFetchResponse: final_url leaving academic domain is discarded', function () {
  const r = W.parseFetchResponse({
    results: [{ url: 'https://arxiv.org/abs/1', final_url: 'https://login.example.com/captured', text: '# hi' }],
    errors: []
  }, 'https://arxiv.org/abs/1');
  assert.equal(r.ok, false);
  assert.ok(r.error.indexOf('学术域') !== -1);
  assert.equal(r.markdown, undefined);
});

test('parseFetchResponse: happy path returns markdown and final url', function () {
  const r = W.parseFetchResponse({
    results: [{ url: 'https://arxiv.org/abs/1', final_url: 'https://arxiv.org/abs/1', title: 'T', text: '# Hello' }],
    errors: []
  }, 'https://arxiv.org/abs/1');
  assert.equal(r.ok, true);
  assert.equal(r.markdown, '# Hello');
  assert.equal(r.finalUrl, 'https://arxiv.org/abs/1');
});

test('normalizedTitle strips punctuation and case', function () {
  assert.equal(W.normalizedTitle('Hello, World!  A—Study.'), 'hello world a study');
  assert.equal(W.normalizedTitle(''), '');
});

test('R15: pageUrl 与 pdfUrl 分开；venue 不丢；snippet 不当 abstract；type 按证据推断', function () {
  const payload = {
    results: [
      {
        title: 'A Real Paper', url: 'https://arxiv.org/abs/2401.1',
        pdf_url: 'https://arxiv.org/pdf/2401.1', venue: 'Journal of Power Sources',
        site_name: 'arxiv.org', snippet: '网页片段文字', doi: '10.1016/j.jpowsour.2024.01',
        year: 2024, citation_count: 12
      },
      {
        title: 'A Conference Page', url: 'https://conf.example.edu/2024',
        site_name: 'conf.example.edu', snippet: '会议主页说明'
      },
      { title: 'S2 style OA', url: 'https://s2.org/p', openAccessPdf: { url: 'https://s2.org/p.pdf' } }
    ],
    total_results: 3
  };
  const r = W.normalizeSearchResponse(payload, 'q');
  const [paper, conf, s2] = r.results;
  assert.equal(paper.pdfUrl, 'https://arxiv.org/pdf/2401.1', 'PDF 直链被提取');
  assert.equal(paper.url, 'https://arxiv.org/abs/2401.1', '网页地址保持不变');
  assert.equal(paper.venue, 'Journal of Power Sources');
  assert.equal(paper.abstract, '', 'snippet 不得被当作摘要');
  assert.equal(paper.snippet, '网页片段文字');
  assert.equal(paper.entryType, 'article', '有 DOI/PDF/venue → article');
  assert.equal(conf.entryType, 'web', '无 DOI/PDF/venue → 如实标 web');
  assert.equal(s2.pdfUrl, 'https://s2.org/p.pdf', 'openAccessPdf.url 形态也能取到');
  assert.equal(s2.entryType, 'article');
});

test('R15: workFromSearchResult 的字段归属（oaUrl 只放 PDF 直链、pageUrl 溯源、venue 优先）', function () {
  const withPdf = W.workFromSearchResult({
    title: 'T', url: 'https://arxiv.org/abs/1', pdfUrl: 'https://arxiv.org/pdf/1',
    venue: 'Nature Energy', siteName: 'arxiv.org', snippet: '片段', abstract: '', doi: '', year: 2024
  });
  assert.equal(withPdf.oaUrl, 'https://arxiv.org/pdf/1', 'oaUrl 是 PDF 直链（可直接下载）');
  assert.equal(withPdf.pageUrl, 'https://arxiv.org/abs/1');
  assert.equal(withPdf.sourceName, 'Nature Energy', 'venue 优先于 siteName');
  assert.equal(withPdf.abstract, '', '没有真摘要就为空');
  assert.equal(withPdf.snippet, '片段');
  assert.equal(withPdf.isOa, true);
  assert.equal(withPdf.type, 'article');
  // 没有 PDF 直链时 oaUrl 必须为空（否则会被当成下载地址去下 /abs/ 页面）
  const noPdf = W.workFromSearchResult({ title: 'T', url: 'https://arxiv.org/abs/2', venue: '', siteName: 'arxiv.org', snippet: 's' });
  assert.equal(noPdf.oaUrl, '');
  assert.equal(noPdf.sourceName, 'arxiv.org', '没有 venue 才退回站点名');
  assert.equal(noPdf.type, 'web');
  assert.equal(noPdf.isOa, false);
});

test('R15: inferEntryType 认识上游 type 字段并归一并列类型名', function () {
  assert.equal(W.inferEntryType({ type: 'journal-article' }), 'article');
  assert.equal(W.inferEntryType({ type: 'proceedings-article' }), 'article');
  assert.equal(W.inferEntryType({ type: 'preprint' }), 'preprint');
  assert.equal(W.inferEntryType({ type: 'dataset' }), 'dataset');
  assert.equal(W.inferEntryType({} ) , 'web');
});

test('R15: normalizeDoiValue 只做形态归一（不因机构号位数丢元数据）', function () {
  assert.equal(W.normalizeDoiValue('https://doi.org/10.1016/J.X'), '10.1016/j.x');
  assert.equal(W.normalizeDoiValue('doi:10.1/a'), '10.1/a');
  assert.equal(W.normalizeDoiValue('not-a-doi'), '');
  assert.equal(W.normalizeDoiValue(''), '');
});
