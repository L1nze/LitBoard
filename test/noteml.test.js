'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitNoteMl = require('../js/noteml.js');
const LitExcerpt = require('../js/excerpt.js');

test('sanitizeHtml strips dangerous content and keeps the whitelist', function () {
  const dirty = '<p onclick="x()">a<script>alert(1)</script><b>bold</b>' +
    '<img src="note-assets/n1/a.png" alt="图" onerror="x()">' +
    '<a href="javascript:alert(1)">bad</a><a href="https://ok.com" target="_blank">ok</a>' +
    '<span class="evil" style="color:red">s</span></p>';
  const clean = LitNoteMl.sanitizeHtml(dirty);
  assert.match(clean, /<p>a<b>bold<\/b>/);
  assert.doesNotMatch(clean, /script|onclick|onerror|javascript:/);
  assert.match(clean, /<img src="note-assets\/n1\/a\.png" alt="图">/);
  assert.match(clean, /<a href="https:\/\/ok\.com">ok<\/a>/);
  assert.doesNotMatch(clean, /target=/);
  assert.doesNotMatch(clean, /class="evil"|style=/);
});

test('sanitizeHtml keeps lb-citation / lb-excerpt structured nodes', function () {
  const cit = LitNoteMl.buildCitationHtml({ paperId: 'p1', label: '(Li, 2023)', locator: '5', suppressAuthor: true });
  const ex = LitNoteMl.buildExcerptHtml({ paperId: 'p1', annotationId: 'a1', pageIndex: 2 }, 'quote', 'comment');
  const clean = LitNoteMl.sanitizeHtml('<div>' + cit + ex + '</div>');
  assert.equal(LitNoteMl.parseCitations(clean).length, 1);
  assert.equal(LitNoteMl.parseExcerptBlocks(clean).length, 1);
});

test('citation node build/parse round-trips all attributes', function () {
  const html = LitNoteMl.buildCitationHtml({
    paperId: 'p1', label: '(Doe, 2020)', locator: '12',
    prefix: 'see', suffix: 'esp.', suppressAuthor: false
  });
  const list = LitNoteMl.parseCitations('<p>x</p>' + html);
  assert.equal(list.length, 1);
  assert.equal(list[0].paperId, 'p1');
  assert.equal(list[0].locator, '12');
  assert.equal(list[0].prefix, 'see');
  assert.equal(list[0].suffix, 'esp.');
  assert.equal(list[0].text, '(Doe, 2020)');
});

test('excerpt html block parse shares stale semantics with markdown form', function () {
  const html = LitNoteMl.buildExcerptHtml(
    { paperId: 'p1', paperTitle: 'T', attachmentId: 'att1', annotationId: 'ann1', pageIndex: 4, sourceUpdatedAt: 100 },
    '第一行<br>第二行', '我的评论');
  const blocks = LitNoteMl.parseExcerptBlocks(html);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].quoteText, '第一行\n第二行');
  assert.equal(blocks[0].commentText, '我的评论');
  assert.equal(blocks[0].sourceUpdatedAt, 100);
  // 与 markdown 形态互转：html → md 的 lbex 块可被 LitExcerpt 解析
  const md = LitNoteMl.htmlToMarkdown(html);
  const mdBlocks = LitExcerpt.parseExcerpts(md);
  assert.equal(mdBlocks.length, 1);
  assert.equal(mdBlocks[0].annotationId, 'ann1');
  assert.equal(mdBlocks[0].pageIndex, 4);
});

test('excerpt block replace/mark/remove operate on html content', function () {
  const ex = LitNoteMl.buildExcerptHtml({ paperId: 'p1', annotationId: 'a1', pageIndex: 1, sourceUpdatedAt: 1 }, 'old', 'oldc');
  const head = '<p>前</p>';
  const tail = LitNoteMl.buildExcerptHtml({ paperId: 'p2', annotationId: 'a2', pageIndex: 2, sourceUpdatedAt: 1 }, 'keep', '');
  let content = head + ex + tail;
  content = LitNoteMl.replaceExcerptBlock(content, 'a1', { quoteText: 'new', commentText: 'newc', sourceUpdatedAt: 2 });
  let blocks = LitNoteMl.parseExcerptBlocks(content);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].quoteText, 'new');
  assert.equal(blocks[0].sourceUpdatedAt, 2);
  assert.equal(blocks[1].quoteText, 'keep');
  content = LitNoteMl.markExcerptBlockCurrent(content, 'a1', 99);
  assert.equal(LitNoteMl.parseExcerptBlocks(content)[0].sourceUpdatedAt, 99);
  content = LitNoteMl.removeExcerptBlock(content, 'a1');
  blocks = LitNoteMl.parseExcerptBlocks(content);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].annotationId, 'a2');
});

test('htmlToMarkdown keeps tables, images, citations and excerpt locate links', function () {
  const html = '<h2>标题</h2><p>正文 <strong>粗</strong> <img src="note-assets/n/i.png" alt="图"></p>' +
    LitNoteMl.buildCitationHtml({ paperId: 'p1', label: '(Li, 2023)', locator: '5' }) +
    '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>' +
    LitNoteMl.buildExcerptHtml({ paperId: 'p1', annotationId: 'a1', pageIndex: 3 }, '引文', '');
  const md = LitNoteMl.htmlToMarkdown(html);
  assert.match(md, /## 标题/);
  assert.match(md, /\*\*粗\*\*/);
  assert.match(md, /!\[图\]\(note-assets\/n\/i\.png\)/);
  assert.match(md, /\[\(Li, 2023\)\]\(litboard:\/\/open\/paper\/p1\?locator=5/);
  assert.match(md, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  // 摘录块还原为 lbex markdown 块，定位链接可被解析
  const blocks = LitExcerpt.parseExcerpts(md);
  assert.equal(blocks.length, 1);
  assert.match(LitExcerpt.buildLocateUrl(blocks[0]), /annotation=a1&page=4/);
});

test('markdownToHtml wraps LitMarkdown and migration round-trips', function () {
  const exMd = LitExcerpt.buildExcerpt({ paperId: 'p1', annotationId: 'a1', pageIndex: 1, quote: '引文' });
  const md = '# 标题\n\n' + exMd + '\n\n[定位](litboard://open/paper/p1?annotation=a1&page=2)';
  const html = LitNoteMl.markdownToHtml(md);
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /lb-excerpt-loc/); // markdown 渲染已带摘录定位锚
  // md → html → md 不丢出处链接
  const back = LitNoteMl.htmlToMarkdown(html);
  assert.match(back, /litboard:\/\/open\/paper\/p1/);
  assert.equal(LitExcerpt.parseExcerpts(back).length, 1);
});
