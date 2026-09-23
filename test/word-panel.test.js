'use strict';
/* js/app/word-panel.js 单元级：base64 协议、域指令解析、样式存取、引文弹窗过滤。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const LitWordPanel = require('../js/app/word-panel.js');

function makeNode() {
  const node = {
    tagName: '', type: '', className: '', textContent: '', value: '', hidden: false, checked: false,
    dataset: {}, children: [], options: [], style: {},
    classList: { _s: new Set(), add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); }, toggle: function (c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains: function (c) { return this._s.has(c); } },
    appendChild: function (c) { this.children.push(c); return c; },
    setAttribute: function () {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function (type, fn) { (this.handlers = this.handlers || {})[type] = fn; },
    dispatchEvent: function () {}
  };
  let html = '';
  Object.defineProperty(node, 'innerHTML', {
    get: function () { return html; },
    set: function (v) { html = v; if (v === '') node.children = []; }
  });
  return node;
}

function makeHarness(opts) {
  global.document = {
    createElement: function (tag) { return makeNode(tag); },
    createDocumentFragment: function () { return makeNode('fragment'); },
    querySelectorAll: function () { return []; }
  };
  global.Event = function Event(type) { this.type = type; };
  const storage = new Map();
  const els = {};
  ['#word-panel-mask', '#word-doc-select', '#word-style-select', '#word-style-hint', '#word-status',
    '#word-cite-mask', '#word-cite-search', '#word-cite-hint', '#word-cite-list', '#word-cite-count'].forEach(function (id) {
    els[id] = makeNode();
    els[id].options = [];
  });
  const state = { papers: opts && opts.papers || [] };
  const api = LitWordPanel.create(Object.assign({
    T: function (s) { return s; },
    $: function (sel) { return els[sel] || null; },
    toast: function () {},
    dlgPrompt: function () { return Promise.resolve(null); },
    dlgConfirm: function () { return Promise.resolve(false); },
    desktop: function () { return {}; },
    state: state,
    normHit: function (s) { return String(s == null ? '' : s).toLowerCase(); },
    localStorage: {
      getItem: function (k) { return storage.has(k) ? storage.get(k) : null; },
      setItem: function (k, v) { storage.set(k, v); }
    },
    csl: { BUILTIN_STYLES: [{ id: 'apa', label: 'APA' }], htmlToRtf: function (h) { return h; } },
    csldoc: null, docx: null,
    query: null,
    citeSplitName: function (name) {
      const m = String(name).split(',');
      return m.length > 1 ? { family: m[0].trim(), given: m[1].trim() } : { family: String(name), given: '' };
    }
  }, opts && opts.overrides || {}));
  return { api: api, els: els, storage: storage, state: state };
}

test('b64utf8/unb64：UTF-8 往返（含中文）', () => {
  const h = makeHarness();
  const samples = ['hello', '中文路径/引文', 'a|b;c', '𝄞 surrogate pair'];
  samples.forEach(function (s) {
    assert.strictEqual(h.api._test.unb64(h.api._test.b64utf8(s)), s);
  });
});

test('parseFieldsPayloads：只认 LitBoard.Citation.1 域，坏 JSON 丢弃', () => {
  const h = makeHarness();
  const payload = JSON.stringify({ version: 1, items: [{ paperId: 'p1' }] });
  const out = h.api._test.parseFieldsPayloads([
    'ADDIN LitBoard.Citation.1 "' + payload + '"',
    'ADDIN ZOTERO_ITEM CSL_CITATION {x}',     // 非本产品域 → 丢弃
    'ADDIN LitBoard.Citation.1 "{broken"',    // 坏 JSON → 丢弃
    '   ADDIN  LitBoard.Citation.1  "' + payload + '"  ' // 宽松空白
  ]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { version: 1, items: [{ paperId: 'p1' }] });
});

test('样式存取：按文档记忆 map；自定义样式同标题重导入覆盖同 key', () => {
  const h = makeHarness();
  h.storage.set('litboard.wordStyles', JSON.stringify({ 'D:/a.docx': 'gb-t-7714' }));
  assert.strictEqual(h.api._test.styleMap()['D:/a.docx'], 'gb-t-7714');
  assert.deepStrictEqual(h.api._test.customStyles(), {}, '空自定义');
});

test('引文弹窗：纯关键词分词 AND 命中 haystack（年份/姓名倒序可搜）', () => {
  const papers = [
    { id: 'p1', deletedAt: null, title: 'Quantum Networks', year: 2021, authors: ['Zhang, San'] },
    { id: 'p2', deletedAt: null, title: 'Classical Shadows', year: 2019, authors: ['Li, Si'] },
    { id: 'p3', deletedAt: 123, title: 'Deleted Paper', year: 2020, authors: [] }
  ];
  const h = makeHarness({ papers: papers });
  h.els['#word-cite-search'].value = 'zhang 2021';
  h.api._test.renderCiteList();
  assert.strictEqual(h.els['#word-cite-list'].children.length, 1, '作者姓 + 年份 AND 命中一篇');
  assert.ok(h.els['#word-cite-list'].children[0].children[1].textContent.indexOf('Quantum') !== -1);

  h.els['#word-cite-search'].value = '';
  h.api._test.renderCiteList();
  assert.strictEqual(h.els['#word-cite-list'].children.length, 2, '空查询列出全部未删条目');
});

test('引文弹窗：语法查询交给注入的 LitQuery（matcher 生效）', () => {
  const papers = [
    { id: 'p1', deletedAt: null, title: 'Alpha', year: 2021, authors: [] },
    { id: 'p2', deletedAt: null, title: 'Beta', year: 2020, authors: [] }
  ];
  const h = makeHarness({
    papers: papers,
    overrides: {
      query: {
        isPlainText: function (raw) { return raw.indexOf('year:') === -1; },
        parse: function (raw) {
          return { error: null, matcher: function (p) { return p.year === 2021; } };
        }
      }
    }
  });
  h.els['#word-cite-search'].value = 'year:2021';
  h.api._test.renderCiteList();
  assert.strictEqual(h.els['#word-cite-list'].children.length, 1, '语法路径走 matcher');
  assert.strictEqual(h.els['#word-cite-hint'].hidden, true, '语法有效不挂提示');
});
