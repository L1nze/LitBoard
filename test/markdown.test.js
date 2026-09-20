'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitMarkdown = require('../js/markdown.js');
const LitExcerpt = require('../js/excerpt.js');

test('existing syntax still renders (regression)', function () {
  const html = LitMarkdown.render('# 标题\n\n正文 **加粗** *斜体* `code` [链接](https://example.com)\n\n- 甲\n- 乙\n\n> 引用\n\n```\ncode block\n```');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank"/);
  assert.match(html, /<ul><li>甲<\/li><li>乙<\/li><\/ul>/);
  assert.match(html, /<blockquote>引用<\/blockquote>/);
  assert.match(html, /<pre><code>code block<\/code><\/pre>/);
});

test('images render for http, file and note-assets paths', function () {
  LitMarkdown.setAssetBase('');
  assert.match(LitMarkdown.render('![x](https://example.com/a.png)'), /<img src="https:\/\/example\.com\/a\.png"/);
  assert.match(LitMarkdown.render('![x](file:///C:/cfg/note-assets/n1/i.png)'), /<img src="file:\/\/\/C:\/cfg/);
  // 相对 note-assets 需要 assetBase
  assert.doesNotMatch(LitMarkdown.render('![x](note-assets/n1/i.png)'), /<img/);
  LitMarkdown.setAssetBase('file:///C:/cfg/');
  assert.match(LitMarkdown.render('![x](note-assets/n1/i.png)'), /<img src="file:\/\/\/C:\/cfg\/note-assets\/n1\/i\.png"/);
  // 其他相对路径不渲染（剥成文本，不注入）
  assert.doesNotMatch(LitMarkdown.render('![x](../evil.png)'), /<img/);
  LitMarkdown.setAssetBase('');
});

test('litboard links render internal, other schemes stay text', function () {
  const html = LitMarkdown.render('[定位](litboard://open/paper/p1?annotation=a1&page=3)');
  assert.match(html, /<a href="litboard:\/\/open\/paper\/p1\?annotation=a1&amp;page=3" data-internal="1">定位<\/a>/);
  assert.doesNotMatch(html, /target="_blank"/);
  // javascript: 链接不生成锚
  assert.doesNotMatch(LitMarkdown.render('[x](javascript:alert(1))'), /<a href="javascript/);
});

test('lbex markers are hidden and quote gets a locate anchor', function () {
  const block = LitExcerpt.buildExcerpt({
    paperId: 'p1', annotationId: 'ann1', attachmentId: 'a1', pageIndex: 4, quote: '第一行\n第二行', comment: '评论'
  });
  const html = LitMarkdown.render('前\n\n' + block + '\n\n后');
  assert.doesNotMatch(html, /lbex \{/);          // 标记不可见
  assert.doesNotMatch(html, /&lt;!--/);           // 不转义泄漏
  assert.match(html, /<blockquote class="lb-excerpt" data-lbex="/);
  assert.match(html, /第一行<br>第二行<a class="lb-excerpt-loc" href="litboard:\/\/open\/paper\/p1\?attachment=a1&amp;annotation=ann1&amp;page=5">↩ p\.5<\/a><\/blockquote>/);
  assert.match(html, /<p>评论<\/p>/);
  assert.match(html, /<p>前<\/p>/);
  assert.match(html, /<p>后<\/p>/);
});

test('consecutive plain quotes merge into one blockquote', function () {
  const html = LitMarkdown.render('> 甲\n> 乙\n\n后段');
  assert.match(html, /<blockquote>甲<br>乙<\/blockquote>/);
});
