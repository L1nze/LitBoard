'use strict';
/* js/app/query-builder.js 单元级：批量编辑字段语义 + 构建器行状态。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const LitQueryBuilder = require('../js/app/query-builder.js');
const LitModel = require('../js/model.js');
const LitQuery = require('../js/query.js');

function makeNode() {
  return {
    tagName: '', className: '', textContent: '', innerHTML: '', value: '', hidden: false, checked: false,
    dataset: {}, children: [], options: [], style: {},
    classList: { _s: new Set(), add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); }, toggle: function () {}, contains: function (c) { return this._s.has(c); } },
    appendChild: function (c) { this.children.push(c); return c; },
    setAttribute: function () {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function (type, fn) { (this.handlers = this.handlers || {})[type] = fn; },
    click: function () { if (this.handlers && this.handlers.click) this.handlers.click(); }
  };
}

function makeHarness() {
  global.document = {
    createElement: function (tag) { return makeNode(tag); },
    createDocumentFragment: function () { return makeNode('fragment'); },
    querySelectorAll: function () { return []; }
  };
  const els = {};
  ['#query-builder-mask', '#qb-rows', '#qb-preview', '#qb-add-row', '#qb-cancel', '#qb-apply', '#btn-query-builder',
    '#bulk-edit-mask', '#bulk-edit-summary', '#bulk-edit-field', '#bulk-edit-value', '#bulk-edit-clear',
    '#bulk-edit-distinct', '#bulk-edit-preview', '#bulk-edit-cancel', '#bulk-edit-confirm', '#search'].forEach(function (id) {
    els[id] = makeNode();
  });
  const state = { filters: { q: '' }, tablePage: 3 };
  const calls = { saved: 0, rendered: 0, undoLabels: [] };
  const api = LitQueryBuilder.create({
    T: function (s) { return s; },
    $: function (sel) { return els[sel] || null; },
    esc: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    state: state,
    save: function () { calls.saved++; },
    renderAll: function () { calls.rendered++; },
    makeSnapshot: function () { return { papers: {} }; },
    commitUndo: function (label) { calls.undoLabels.push(label); },
    query: LitQuery,
    model: LitModel
  });
  return { api: api, els: els, state: state, calls: calls };
}

test('批量编辑：status 合法值生效并进撤销栈；非法值不动', () => {
  const h = makeHarness();
  const papers = [
    LitModel.normalizePaper({ id: 'p1', title: 'A', status: 'read' }),
    LitModel.normalizePaper({ id: 'p2', title: 'B', status: 'unread' })
  ];
  h.api.openBulkEdit(papers);
  h.els['#bulk-edit-field'].value = 'status';
  h.els['#bulk-edit-value'].value = 'reading';
  h.els['#bulk-edit-confirm'].click();
  assert.strictEqual(papers[0].status, 'reading');
  assert.strictEqual(papers[1].status, 'reading');
  assert.ok(h.calls.undoLabels.some(function (l) { return l.indexOf('批量编辑') !== -1; }));
  assert.strictEqual(h.calls.saved, 1);
  assert.strictEqual(h.els['#bulk-edit-mask'].hidden, true);

  const h2 = makeHarness();
  const bad = [LitModel.normalizePaper({ id: 'p1', status: 'read' })];
  h2.api.openBulkEdit(bad);
  h2.els['#bulk-edit-field'].value = 'status';
  h2.els['#bulk-edit-value'].value = 'bogus'; // 白名单外 → 该条跳过
  h2.els['#bulk-edit-confirm'].click();
  assert.strictEqual(bad[0].status, 'read', '非法 status 不落');
});

test('批量编辑：rating 越界拒绝、year 联动 date、tags 去重', () => {
  const h = makeHarness();
  const papers = [
    LitModel.normalizePaper({ id: 'p1', rating: 1, year: 1999, date: '1999', tags: ['a', 'a'] })
  ];
  h.api.openBulkEdit(papers);
  h.els['#bulk-edit-field'].value = 'rating';
  h.els['#bulk-edit-value'].value = '9';
  h.els['#bulk-edit-confirm'].click();
  assert.strictEqual(papers[0].rating, 1, 'rating 越界（>5）该条跳过不落');

  const h1b = makeHarness();
  const p1b = LitModel.normalizePaper({ id: 'p1', rating: 1 });
  h1b.api.openBulkEdit([p1b]);
  h1b.els['#bulk-edit-field'].value = 'rating';
  h1b.els['#bulk-edit-value'].value = '4';
  h1b.els['#bulk-edit-confirm'].click();
  assert.strictEqual(p1b.rating, 4, '合法 rating 正常写入');

  const h2 = makeHarness();
  const p2 = LitModel.normalizePaper({ id: 'p1', year: 1999, date: '1999', tags: ['a'] });
  h2.api.openBulkEdit([p2]);
  h2.els['#bulk-edit-field'].value = 'year';
  h2.els['#bulk-edit-value'].value = '2024';
  h2.els['#bulk-edit-confirm'].click();
  assert.strictEqual(p2.year, 2024);
  assert.strictEqual(p2.date, '2024', 'year 改写联动 date');

  const h3 = makeHarness();
  const p3 = LitModel.normalizePaper({ id: 'p1', tags: ['a', 'a', 'b'] });
  h3.api.openBulkEdit([p3]);
  h3.els['#bulk-edit-field'].value = 'tags';
  h3.els['#bulk-edit-value'].value = 'a, a, c';
  h3.els['#bulk-edit-confirm'].click();
  assert.deepStrictEqual(p3.tags.slice().sort(), ['a', 'c'], 'cleanTags 去重');
});

test('批量编辑：明确清空 tags → 空数组', () => {
  const h = makeHarness();
  const p = LitModel.normalizePaper({ id: 'p1', tags: ['a', 'b'] });
  h.api.openBulkEdit([p]);
  h.els['#bulk-edit-field'].value = 'tags';
  h.els['#bulk-edit-clear'].checked = true;
  h.els['#bulk-edit-confirm'].click();
  assert.deepStrictEqual(p.tags, []);
});

test('批量编辑：deletedAt 条目在入口即被过滤', () => {
  const h = makeHarness();
  h.api.openBulkEdit([
    LitModel.normalizePaper({ id: 'p1' }),
    { id: 'p2', deletedAt: 1 }
  ]);
  assert.strictEqual(h.api.stateForTest().bulkEditPapers.length, 1);
});

test('构建器：open 重置为单行默认条件并显示遮罩', () => {
  const h = makeHarness();
  h.api.open();
  assert.strictEqual(h.els['#query-builder-mask'].hidden, false);
  const rows = h.api.stateForTest().qbRows;
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['cmp', 'field', 'join', 'kind', 'value'].sort());
});
