'use strict';
/* js/app/note-export.js 单元级：markdown 段落计划与内联引用解析（纯函数部分）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const LitNoteExport = require('../js/app/note-export.js');
const LitExcerpt = require('../js/excerpt.js');

function makeHarness() {
  const storage = new Map();
  const api = LitNoteExport.create({
    T: function (s) { return s; },
    toast: function () {},
    desktop: function () { return {}; },
    state: { papers: [] },
    getById: function () { return null; },
    localStorage: {
      getItem: function (k) { return storage.has(k) ? storage.get(k) : null; },
      setItem: function (k, v) { storage.set(k, v); }
    }
  });
  return api;
}

test('mdSegmentToParagraphs：标题加粗成段、列表符号剥除、空行分段、栅栏行跳过', () => {
  const api = makeHarness();
  const out = api._test.mdSegmentToParagraphs(
    '# 标题一\n\n第一段文字\n继续同行\n\n- 列表项\n\n```\ncode block\n```\n\n第二段'
  );
  // 期望段落：[标题一(bold)] [第一段文字\n继续同行] [列表项] [code block（围栏内容按原文保留，只丢 ``` 行）] [第二段]
  assert.strictEqual(out.length, 5);
  assert.deepStrictEqual(out[0], { parts: [{ text: '标题一', bold: true }] });
  assert.strictEqual(out[1].parts[0].text.indexOf('第一段文字'), 0);
  assert.ok(out[2].parts[0].text.indexOf('列表项') !== -1, '列表标记应剥除');
  assert.ok(out[2].parts[0].text.indexOf('- ') === -1);
  assert.ok(out[3].parts[0].text.indexOf('```') === -1, '栅栏标记行不进段落');
  assert.strictEqual(out[4].parts[0].text, '第二段');
});

test('mdSegmentToParagraphs：note-assets 独立图片行 → imageRel 段', () => {
  const api = makeHarness();
  const out = api._test.mdSegmentToParagraphs('前文\n\n![img](note-assets/n1/pic.png)\n\n后文');
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out[1], { parts: [{ imageRel: 'note-assets/n1/pic.png' }] });
});

test('inlineMdParts：litboard 引用链接拆 cite run，参数解码、残留 md 记号清理', () => {
  const api = makeHarness();
  const parts = api._test.inlineMdParts(
    '见 **张三** 的 [张三 2020](litboard://open/paper/p1?locator=p.%2012&prefix=见)'
  );
  const textParts = parts.filter(function (p) { return p.text != null; });
  const cite = parts.filter(function (p) { return p.cite; })[0];
  assert.ok(cite, '应解析出 cite run');
  assert.strictEqual(cite.cite.paperId, 'p1');
  assert.strictEqual(cite.cite.label, '张三 2020');
  assert.strictEqual(cite.cite.locator, 'p. 12', '参数应 decodeURIComponent');
  assert.strictEqual(cite.cite.prefix, '见');
  assert.ok(textParts[0].text.indexOf('**') === -1, '加粗记号应清掉');
  assert.ok(textParts[0].text.indexOf('张三') !== -1);
});

test('inlineMdParts：suppressAuthor=1 透传；无参数链接也有基本字段', () => {
  const api = makeHarness();
  const parts = api._test.inlineMdParts('A [x](litboard://open/paper/p2?suppressAuthor=1) B');
  const cite = parts.filter(function (p) { return p.cite; })[0];
  assert.strictEqual(cite.cite.suppressAuthor, true);
  const plain = api._test.inlineMdParts('[y](litboard://open/paper/p3)');
  const cite2 = plain.filter(function (p) { return p.cite; })[0];
  assert.strictEqual(cite2.cite.paperId, 'p3');
  assert.strictEqual(cite2.cite.locator, '');
});

test('笔记摘录导出 Word 保留引文、摘录正文和评论', async () => {
  const api = LitNoteExport.create({
    T: function (s) { return s; },
    desktop: function () { return {}; },
    state: { papers: [{ id: 'p1' }] },
    getById: function (id) { return id === 'p1' ? { id: id } : null; },
    localStorage: { getItem: function () { return null; } },
    excerpt: LitExcerpt,
    docxLib: { buildDocx: function (paragraphs) { return paragraphs; } },
    csldoc: {
      createDocument: function () {
        return {
          updateLibrary: function () { return Promise.resolve(); },
          addCitation: function () { return Promise.resolve({ citationId: 'c1', text: '(Author, 2020)' }); },
          toJSON: function () { return { citations: [{ id: 'c1' }] }; },
          citationCount: function () { return 0; }
        };
      }
    }
  });
  const md = LitExcerpt.buildExcerpt({ paperId: 'p1', quote: 'Important quotation', comment: 'My comment' });
  const paragraphs = await api._test.buildNoteDocx(md, { styleXml: '', localeXml: '', styleId: 'apa', configDir: '' });
  assert.match(JSON.stringify(paragraphs), /Important quotation/);
  assert.match(JSON.stringify(paragraphs), /My comment/);
  assert.match(JSON.stringify(paragraphs), /citation/);
});
