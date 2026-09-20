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

/* ---------------- 数学公式（LaTeX 源码形态） ----------------
 * 现在没有排版引擎：渲染器的职责只有两条——**原样保住**公式内容、
 * 标明边界。这两条都是回归防线：曾经 $x_1 + y_2$ 被斜体规则渲染成 x<em>1 + y</em>2。 */

test('公式：LaTeX 源码原样保住，不被斜体/加粗规则改坏', function () {
  const sub = LitMarkdown.render('下标 $x_1 + y_2 = z_3$ 结束');
  assert.match(sub, /<span class="lb-math">x_1 \+ y_2 = z_3<\/span>/);
  assert.doesNotMatch(sub, /<em>/, '公式里的下划线是下标语法，不是强调标记');

  const star = LitMarkdown.render('星号 $a * b * c$ 结束');
  assert.match(star, /<span class="lb-math">a \* b \* c<\/span>/);
  assert.doesNotMatch(star, /<em>/);

  // 反斜杠命令必须原样保留（\frac / \alpha 不能被当转义吃掉）
  const frac = LitMarkdown.render('分式 $\\frac{a}{b}$ 与 $\\alpha$');
  assert.match(frac, /<span class="lb-math">\\frac\{a\}\{b\}<\/span>/);
  assert.match(frac, /<span class="lb-math">\\alpha<\/span>/);

  // 公式里的 HTML 字符按文本转义，不允许穿透成标签
  const risky = LitMarkdown.render('$a < b$');
  assert.match(risky, /<span class="lb-math">a &lt; b<\/span>/);
});

test('公式：$$ 走块级样式；金额、行内代码、跨行都不误伤', function () {
  const block = LitMarkdown.render('前\n\n$$\\begin{bmatrix} 1 & 2 \\end{bmatrix}$$\n\n后');
  assert.match(block, /<span class="lb-math lb-math-block">/);

  // 金额不是公式：闭括号后接数字（$5-$10）、开括号前是词字符（US$5）都不算
  const price = LitMarkdown.render('价格 $5-$10，以及 US$5 and US$10 两种写法');
  assert.doesNotMatch(price, /lb-math/);

  // 行内代码优先：`$x_1$` 是代码，不是公式
  const code = LitMarkdown.render('写法 `$x_1$` 保留为代码');
  assert.match(code, /<code>\$x_1\$<\/code>/);
  assert.doesNotMatch(code, /lb-math/);

  // 中文紧邻公式（中文里最常见的写法）：前导字符是 CJK，不该被「前导词字符」规则挡掉
  const cjk = LitMarkdown.render('由$E=mc^2$可得');
  assert.match(cjk, /<span class="lb-math">E=mc\^2<\/span>/);

  // 段落内的换行会先合并成一行再解析：$$ 块跨行照样识别（期望行为，别当回归删掉）
  const multiline = LitMarkdown.render('$$\n\\begin{aligned} a \\\\ b \\end{aligned}\n$$');
  assert.match(multiline, /lb-math-block/);

  // 但空行会切断段落 → 公式被断开（系统提示据此要求公式内不留空行）
  const broken = LitMarkdown.render('$$a\n\nb$$');
  assert.doesNotMatch(broken, /lb-math/);
});
