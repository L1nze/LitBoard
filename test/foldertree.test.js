'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitFolderTree = require('../js/foldertree.js');

/** 造一棵树：root: A(0) B(1) C(2)；A 下有 A1(0) A2(1) */
function makeFolders() {
  return [
    { id: 'A', name: 'A', parentId: '', sortIndex: 0 },
    { id: 'B', name: 'B', parentId: '', sortIndex: 1 },
    { id: 'C', name: 'C', parentId: '', sortIndex: 2 },
    { id: 'A1', name: 'A1', parentId: 'A', sortIndex: 0 },
    { id: 'A2', name: 'A2', parentId: 'A', sortIndex: 1 }
  ];
}

function snapshot(folders) {
  return folders.map(function (f) { return f.id + '|' + (f.parentId || '') + '|' + (f.sortIndex || 0); });
}

test('compareFolders sorts by sortIndex then name', function () {
  const rows = [{ sortIndex: 2, name: 'b' }, { sortIndex: 0, name: 'z' }, { sortIndex: 2, name: 'a' }];
  rows.sort(LitFolderTree.compareFolders);
  assert.deepEqual(rows.map(function (r) { return r.name; }), ['z', 'a', 'b']);
});

test('buildVisibleRows expands tree order, skips collapsed children and treats missing parent as root', function () {
  const rows = LitFolderTree.buildVisibleRows(makeFolders(), {});
  assert.deepEqual(rows.map(function (r) { return [r.folder.id, r.depth, r.hasChildren]; }), [
    ['A', 0, true], ['A1', 1, false], ['A2', 1, false],
    ['B', 0, false], ['C', 0, false]
  ]);
  const collapsedRows = LitFolderTree.buildVisibleRows(makeFolders(), { A: true });
  assert.deepEqual(collapsedRows.map(function (r) { return r.folder.id; }), ['A', 'B', 'C']);
  const rowsAllCollapsed = LitFolderTree.buildVisibleRows(makeFolders(), { A: true, A1: true });
  assert.deepEqual(rowsAllCollapsed.map(function (r) { return r.folder.id; }), ['A', 'B', 'C']);
  const orphanFolders = makeFolders();
  orphanFolders.push({ id: 'X', name: 'X', parentId: 'ghost', sortIndex: 0 });
  const orphanRows = LitFolderTree.buildVisibleRows(orphanFolders, {});
  assert.deepEqual(orphanRows.map(function (r) { return r.folder.id; }), ['A', 'A1', 'A2', 'X', 'B', 'C']);
});

test('tree helpers: rangeIds endpoints, dropModeFromRatio zones and collectSubtreeIds descendants', function () {
  const visible = ['A', 'A1', 'A2', 'B', 'C'];
  const cases = [
    { name: 'forward', visible, from: 'A', to: 'B', expected: ['A', 'A1', 'A2', 'B'] },
    { name: 'backward', visible, from: 'B', to: 'A', expected: ['A', 'A1', 'A2', 'B'] },
    { name: 'single', visible, from: 'C', to: 'C', expected: ['C'] },
    { name: 'missing end', visible: ['A', 'B'], from: 'A', to: 'zz', expected: [] },
    { name: 'missing start', visible: ['A', 'B'], from: 'zz', to: 'A', expected: [] },
    { name: 'empty tree', visible: [], from: 'A', to: 'B', expected: [] }
  ];
  for (const scenario of cases) {
    assert.deepEqual(LitFolderTree.rangeIds(scenario.visible, scenario.from, scenario.to), scenario.expected, scenario.name);
  }
  assert.equal(LitFolderTree.dropModeFromRatio(0), 'before');
  assert.equal(LitFolderTree.dropModeFromRatio(0.24), 'before');
  assert.equal(LitFolderTree.dropModeFromRatio(0.25), 'inside');
  assert.equal(LitFolderTree.dropModeFromRatio(0.5), 'inside');
  assert.equal(LitFolderTree.dropModeFromRatio(0.75), 'inside');
  assert.equal(LitFolderTree.dropModeFromRatio(0.76), 'after');
  assert.equal(LitFolderTree.dropModeFromRatio(1), 'after');
  const set = LitFolderTree.collectSubtreeIds(makeFolders(), ['A']);
  assert.deepEqual(Object.keys(set).sort(), ['A', 'A1', 'A2']);
  const both = LitFolderTree.collectSubtreeIds(makeFolders(), ['A', 'C']);
  assert.deepEqual(Object.keys(both).sort(), ['A', 'A1', 'A2', 'C']);
});

test('applyMove inside reparents to target end; before/after reorders within the same parent', function () {
  const folders = makeFolders();
  const result = LitFolderTree.applyMove(folders, ['C'], 'A', 'inside');
  assert.equal(result.changed, true);
  assert.ok(result.touchedIds.includes('C'));
  const c = folders.find(function (f) { return f.id === 'C'; });
  assert.equal(c.parentId, 'A');
  // 根组剔除 C 后按原序重编号：A、B 的相对位置与下标不变
  const b = folders.find(function (f) { return f.id === 'B'; });
  assert.equal(b.sortIndex, 1);
  const a = folders.find(function (f) { return f.id === 'A'; });
  assert.equal(a.sortIndex, 0);
  // 目标父组 A 下：A1、A2 不变，C 追加在末尾
  const aKids = folders
    .filter(function (f) { return f.parentId === 'A'; })
    .sort(function (x, y) { return x.sortIndex - y.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(aKids, ['A1', 'A2', 'C']);
  const beforeFolders = makeFolders();
  const moved = LitFolderTree.applyMove(beforeFolders, ['C'], 'A', 'before');
  assert.equal(moved.changed, true);
  const rootIds = beforeFolders
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (x, y) { return x.sortIndex - y.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds, ['C', 'A', 'B']);
  const afterFolders = makeFolders();
  LitFolderTree.applyMove(afterFolders, ['A'], 'C', 'after');
  const rootIds2 = afterFolders
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (x, y) { return x.sortIndex - y.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds2, ['B', 'C', 'A']);
});

test('applyMove cross-parent and multi-drag moves renumber the old parent group preserving tree order', function () {
  const folders = makeFolders();
  const result = LitFolderTree.applyMove(folders, ['A2'], 'B', 'before');
  assert.equal(result.changed, true);
  assert.ok(result.touchedIds.includes('A2'));
  const a1 = folders.find(function (f) { return f.id === 'A1'; });
  assert.equal(a1.parentId, 'A');
  assert.equal(a1.sortIndex, 0);   // 旧父组只剩它，重编号为 0
  const a2 = folders.find(function (f) { return f.id === 'A2'; });
  assert.equal(a2.parentId, '');
  const multiFolders = makeFolders();
  const multiResult = LitFolderTree.applyMove(multiFolders, ['A2', 'A1'], 'B', 'after');
  assert.equal(multiResult.changed, true);
  assert.ok(multiResult.touchedIds.includes('A1') && multiResult.touchedIds.includes('A2'));
  // 相对次序保持 A1 在 A2 前（树序 = sortIndex 序），插入 B 之后
  const rootIds = multiFolders
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (x, y) { return x.sortIndex - y.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds, ['A', 'B', 'A1', 'A2', 'C']);
  // 旧父组 A 已无子级
  assert.equal(multiFolders.some(function (f) { return f.parentId === 'A'; }), false);
});

test('applyMove leaves the tree untouched for invalid or no-op moves', function () {
  const cases = [
    { name: 'own descendant', ids: ['A'], target: 'A1', mode: 'inside' },
    { name: 'target in dragged set', ids: ['A', 'B'], target: 'B', mode: 'before' },
    { name: 'already after target', ids: ['C'], target: 'B', mode: 'after' },
    { name: 'empty drag set', ids: [], target: 'A', mode: 'inside' }
  ];
  for (const scenario of cases) {
    const folders = makeFolders();
    const before = snapshot(folders);
    const result = LitFolderTree.applyMove(folders, scenario.ids, scenario.target, scenario.mode);
    assert.equal(result.changed, false, scenario.name);
    assert.deepEqual(result.touchedIds, [], scenario.name);
    assert.deepEqual(snapshot(folders), before, scenario.name);
  }
});

test('applyMove drag-set edge cases: sanitizes descendants, rootEnd promotes to root, unknown ids dropped', function () {
  const sanitizeFolders = makeFolders();
  // A1 的祖先 A 也在集合里 → A1 被剔除，只移动 A（A1 随子树跟随）
  const sanitizeResult = LitFolderTree.applyMove(sanitizeFolders, ['A1', 'A'], 'C', 'before');
  assert.equal(sanitizeResult.changed, true);
  assert.ok(!sanitizeResult.touchedIds.includes('A1') || sanitizeFolders.find(function (f) { return f.id === 'A1'; }).sortIndex !== 0);
  const sanA = sanitizeFolders.find(function (f) { return f.id === 'A'; });
  const sanA1 = sanitizeFolders.find(function (f) { return f.id === 'A1'; });
  assert.equal(sanA.parentId, '');
  assert.equal(sanA1.parentId, 'A');   // 子树跟随，A1 仍在 A 下
  // A 未被移进自己的子树
  assert.equal(sanA1.parentId === 'A', true);
  const rootEndFolders = makeFolders();
  const rootEndResult = LitFolderTree.applyMove(rootEndFolders, ['A1'], null, 'rootEnd');
  assert.equal(rootEndResult.changed, true);
  const rootEndA1 = rootEndFolders.find(function (f) { return f.id === 'A1'; });
  assert.equal(rootEndA1.parentId, '');
  const rootIds = rootEndFolders
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (x, y) { return x.sortIndex - y.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds, ['A', 'B', 'C', 'A1']);
  // 旧父组 A 下 A2 重编号为 0
  const a2 = rootEndFolders.find(function (f) { return f.id === 'A2'; });
  assert.equal(a2.sortIndex, 0);
  const unknownFolders = makeFolders();
  const unknownResult = LitFolderTree.applyMove(unknownFolders, ['zz', 'B'], 'A', 'inside');
  assert.equal(unknownResult.changed, true);
  const b = unknownFolders.find(function (f) { return f.id === 'B'; });
  assert.equal(b.parentId, 'A');
});

test('folder IDs matching object prototype names remain valid tree nodes and drag targets', function () {
  const folders = [
    { id: 'toString', name: 'Parent', parentId: '', sortIndex: 0 },
    { id: 'child', name: 'Child', parentId: 'toString', sortIndex: 0 },
    { id: 'constructor', name: 'Other', parentId: '', sortIndex: 1 }
  ];
  assert.deepEqual(LitFolderTree.buildVisibleRows(folders, {}).map(function (row) { return row.folder.id; }),
    ['toString', 'child', 'constructor']);
  assert.deepEqual(Object.keys(LitFolderTree.collectSubtreeIds(folders, ['toString'])).sort(), ['child', 'toString']);
  assert.equal(LitFolderTree.applyMove(folders, ['constructor'], 'toString', 'inside').changed, true);
  assert.equal(folders.find(function (folder) { return folder.id === 'constructor'; }).parentId, 'toString');
});
