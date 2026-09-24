'use strict';
/* js/app/journal-rank.js 单元级：提供商数据归一、7 天窗口、文件夹补查去重与共享请求。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const LitModel = require('../js/model.js');
const LitJournalRank = require('../js/app/journal-rank.js');

function makeNode(tag) {
  return {
    tagName: tag, className: '', textContent: '', innerHTML: '', hidden: false, disabled: false, title: '',
    dataset: {}, children: [],
    style: { setProperty: function () {} },
    classList: { _s: new Set(), add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); }, toggle: function () {}, contains: function (c) { return this._s.has(c); } },
    appendChild: function (c) { this.children.push(c); return c; },
    setAttribute: function () {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

function makeHarness(getRank) {
  global.document = {
    createElement: function (tag) { return makeNode(tag); },
    createDocumentFragment: function () { return makeNode('fragment'); },
    querySelectorAll: function () { return []; }
  };
  const els = {};
  ['#d-journal-rank', '#d-journal-rank-values', '#d-journal-rank-refresh', '#rank-refresh-all', '#rank-refresh-progress'].forEach(function (id) {
    els[id] = makeNode(id.indexOf('values') !== -1 || id.indexOf('rank-progress') !== -1 ? 'div' : 'button');
  });
  els['#d-journal-rank'].hidden = false;
  const calls = { saved: 0, rendered: 0, rankCalls: [], rankInputs: [] };
  const state = {
    papers: [], tablePage: 0, activeFolderId: 'all'
  };
  const api = LitJournalRank.create({
    T: function (s) { return s; },
    $: function (sel) { return els[sel] || null; },
    toast: function () {},
    save: function () { calls.saved++; },
    renderTable: function () { calls.rendered++; },
    getById: function (id) { return state.papers.find(function (p) { return p.id === id; }) || null; },
    drawerId: function () { return null; },
    filteredPapers: function () { return state.papers.filter(function (p) { return !p.deletedAt; }); },
    state: state,
    model: LitModel,
    desktop: function () {
      return {
        getScigreatRank: function (input) {
          calls.rankInputs.push(input);
          calls.rankCalls.push(input.journal);
          if (getRank) return getRank(input);
          return Promise.resolve({ results: [{ data: { jcr: 'Q1', imf: 12.3, pku: 'y' } }] });
        }
      };
    },
    tablePageSize: 100
  });
  return { api: api, els: els, calls: calls, state: state };
}

const flush = function (ticks) {
  return new Promise(function (r) {
    let n = ticks || 8;
    (function step() { if (n-- <= 0) setTimeout(r, 0); else Promise.resolve().then(step); })();
  });
};

test('resultData：兼容 SciGreat({results:[{data}]}) 与 EasyScholar({code:200,data})', () => {
  const h = makeHarness();
  assert.deepStrictEqual(h.api.resultData({ results: [{ data: { jcr: 'Q1' } }] }), { jcr: 'Q1' });
  assert.deepStrictEqual(h.api.resultData({ code: 200, data: { jcr: 'Q2' } }), { jcr: 'Q2' });
  assert.strictEqual(h.api.resultData({ code: 500, msg: 'x' }), null);
  assert.strictEqual(h.api.resultData(null), null);
});

test('summary：归一后的等级摘要（新锐/北核/IF）', () => {
  const h = makeHarness();
  const s = h.api.summary({ jcr: 'Q1', imf: 12.3, pku: 'y', xr: '2' });
  assert.ok(s.indexOf('北核') !== -1 && s.indexOf('IF 12.3') !== -1, s);
  assert.strictEqual(h.api.summary(null), '无分区数据');
});

test('shouldRefresh：有 venue 且 7 天外/未查过才刷新', () => {
  const h = makeHarness();
  assert.strictEqual(h.api.shouldRefresh({ venue: 'Nature' }), true);
  assert.strictEqual(h.api.shouldRefresh({ venue: 'Nature', journalRankCheckedAt: Date.now() }), false);
  assert.strictEqual(h.api.shouldRefresh({ venue: 'Nature', journalRankCheckedAt: Date.now() - 8 * 24 * 3600 * 1000 }), true);
  assert.strictEqual(h.api.shouldRefresh({}), false);
});

test('refreshFolder：同期刊只请求一次，组内结果共享并落库', async () => {
  const h = makeHarness();
  h.state.papers = [
    { id: 'p1', venue: 'Nature', issn: '0028-0836' },
    { id: 'p2', venue: ' nature ' },   // 大小写/空白归一后同刊
    { id: 'p3', venue: 'Science' }
  ];
  await h.api.refreshFolder('all');
  await flush(20);
  assert.strictEqual(h.calls.rankCalls.length, 2, '两个期刊各请求一次');
  assert.deepEqual(h.calls.rankInputs[0], { journal: 'Nature', issn: ['0028-0836'] });
  assert.ok(h.state.papers[0].journalRank && h.state.papers[0].journalRank.jcr === 'Q1');
  assert.strictEqual(h.state.papers[1].journalRank.jcr, 'Q1', '同刊共享结果');
  assert.ok(h.state.papers[0].journalRankCheckedAt > 0);
  assert.ok(h.calls.saved >= 1, '变更后落库');
});

test('refreshFolder：缓存未过期的一律跳过（零请求）', async () => {
  const h = makeHarness();
  var cached = { jcr: 'Q1' };
  h.state.papers = [{ id: 'p1', venue: 'Nature', journalRank: cached, journalRankCheckedAt: Date.now() }];
  await h.api.refreshFolder('all');
  await flush(4);
  assert.strictEqual(h.calls.rankCalls.length, 0);
  assert.strictEqual(h.state.papers[0].journalRank, cached, '缓存对象不被替换');
});

test('refreshFolder：已缓存的多个期刊不重复重绘表格', async () => {
  const h = makeHarness();
  h.state.papers = Array.from({ length: 60 }, function (_, i) {
    return { id: 'p' + i, venue: 'Journal ' + i, journalRank: { jcr: 'Q1' },
      journalRankCheckedAt: Date.now() };
  });
  await h.api.refreshFolder('all');
  assert.equal(h.calls.rankCalls.length, 0);
  assert.equal(h.calls.rendered, 0);
  assert.equal(h.calls.saved, 0);
});

test('refreshFolder：同刊仅将有效缓存同步给过期条目', async () => {
  const h = makeHarness();
  const cached = { jcr: 'Q1' };
  h.state.papers = [
    { id: 'fresh', venue: 'Nature', journalRank: cached, journalRankCheckedAt: Date.now() },
    { id: 'stale', venue: 'nature', journalRank: null, journalRankCheckedAt: 0 }
  ];
  await h.api.refreshFolder('all');
  assert.equal(h.calls.rankCalls.length, 0);
  assert.strictEqual(h.state.papers[1].journalRank, cached);
  assert.equal(h.calls.rendered, 1);
  assert.equal(h.calls.saved, 1);
});

test('pending 标记与冻结序访问器：默认空，清空后回到 null', () => {
  const h = makeHarness();
  assert.strictEqual(h.api.isPending('nature'), false);
  assert.strictEqual(h.api.frozenOrder(), null);
  h.api.clearFrozenOrder();
  assert.strictEqual(h.api.frozenOrder(), null);
  assert.strictEqual(Object.keys(h.api.stateForTest().pending).length, 0);
});

test('分区补查暂停后立即继续，不越过仍在进行的请求', async () => {
  let releaseFirst;
  const h = makeHarness(function (input) {
    if (input.journal === 'Nature') {
      return new Promise(function (resolve) { releaseFirst = resolve; });
    }
    return Promise.resolve({ results: [{ data: { jcr: 'Q2' } }] });
  });
  h.state.papers = [{ id: 'p1', venue: 'Nature' }, { id: 'p2', venue: 'Science' }];
  const running = h.api.refreshAll();
  h.api.refreshAll();
  h.api.refreshAll();
  assert.deepEqual(h.calls.rankCalls, ['Nature']);
  releaseFirst({ results: [{ data: { jcr: 'Q1' } }] });
  await running;
  assert.deepEqual(h.calls.rankCalls, ['Nature', 'Science']);
  assert.equal(h.api.stateForTest().run, null);
});
