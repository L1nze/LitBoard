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

test('buildVisibleRows expands all rows in tree order with depth and hasChildren', function () {
  const rows = LitFolderTree.buildVisibleRows(makeFolders(), {});
  assert.deepEqual(rows.map(function (r) { return [r.folder.id, r.depth, r.hasChildren]; }), [
    ['A', 0, true], ['A1', 1, false], ['A2', 1, false],
    ['B', 0, false], ['C', 0, false]
  ]);
});

test('buildVisibleRows skips children of collapsed folders', function () {
  const rows = LitFolderTree.buildVisibleRows(makeFolders(), { A: true });
  assert.deepEqual(rows.map(function (r) { return r.folder.id; }), ['A', 'B', 'C']);
  const rowsAllCollapsed = LitFolderTree.buildVisibleRows(makeFolders(), { A: true, A1: true });
  assert.deepEqual(rowsAllCollapsed.map(function (r) { return r.folder.id; }), ['A', 'B', 'C']);
});

test('buildVisibleRows treats missing parent as root', function () {
  const folders = makeFolders();
  folders.push({ id: 'X', name: 'X', parentId: 'ghost', sortIndex: 0 });
  const rows = LitFolderTree.buildVisibleRows(folders, {});
  assert.deepEqual(rows.map(function (r) { return r.folder.id; }), ['A', 'A1', 'A2', 'X', 'B', 'C']);
});

test('rangeIds returns inclusive span in either direction', function () {
  const visible = ['A', 'A1', 'A2', 'B', 'C'];
  assert.deepEqual(LitFolderTree.rangeIds(visible, 'A', 'B'), ['A', 'A1', 'A2', 'B']);
  assert.deepEqual(LitFolderTree.rangeIds(visible, 'B', 'A'), ['A', 'A1', 'A2', 'B']);
  assert.deepEqual(LitFolderTree.rangeIds(visible, 'C', 'C'), ['C']);
});

test('rangeIds returns empty when either endpoint is missing', function () {
  assert.deepEqual(LitFolderTree.rangeIds(['A', 'B'], 'A', 'zz'), []);
  assert.deepEqual(LitFolderTree.rangeIds(['A', 'B'], 'zz', 'A'), []);
  assert.deepEqual(LitFolderTree.rangeIds([], 'A', 'B'), []);
});

test('dropModeFromRatio maps top 25% / bottom 25% / middle 50%', function () {
  assert.equal(LitFolderTree.dropModeFromRatio(0), 'before');
  assert.equal(LitFolderTree.dropModeFromRatio(0.24), 'before');
  assert.equal(LitFolderTree.dropModeFromRatio(0.25), 'inside');
  assert.equal(LitFolderTree.dropModeFromRatio(0.5), 'inside');
  assert.equal(LitFolderTree.dropModeFromRatio(0.75), 'inside');
  assert.equal(LitFolderTree.dropModeFromRatio(0.76), 'after');
  assert.equal(LitFolderTree.dropModeFromRatio(1), 'after');
});

test('collectSubtreeIds includes roots and all descendants', function () {
  const set = LitFolderTree.collectSubtreeIds(makeFolders(), ['A']);
  assert.deepEqual(Object.keys(set).sort(), ['A', 'A1', 'A2']);
  const both = LitFolderTree.collectSubtreeIds(makeFolders(), ['A', 'C']);
  assert.deepEqual(Object.keys(both).sort(), ['A', 'A1', 'A2', 'C']);
});

test('applyMove single folder inside reparents to target end', function () {
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
});

test('applyMove before/after reorders within the same parent', function () {
  const folders = makeFolders();
  const moved = LitFolderTree.applyMove(folders, ['C'], 'A', 'before');
  assert.equal(moved.changed, true);
  const rootIds = folders
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (a, b) { return a.sortIndex - b.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds, ['C', 'A', 'B']);
  const folders2 = makeFolders();
  LitFolderTree.applyMove(folders2, ['A'], 'C', 'after');
  const rootIds2 = folders2
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (a, b) { return a.sortIndex - b.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds2, ['B', 'C', 'A']);
});

test('applyMove cross-parent move renumbers the old parent group', function () {
  const folders = makeFolders();
  const result = LitFolderTree.applyMove(folders, ['A2'], 'B', 'before');
  assert.equal(result.changed, true);
  assert.ok(result.touchedIds.includes('A2'));
  const a1 = folders.find(function (f) { return f.id === 'A1'; });
  assert.equal(a1.parentId, 'A');
  assert.equal(a1.sortIndex, 0);   // 旧父组只剩它，重编号为 0
  const a2 = folders.find(function (f) { return f.id === 'A2'; });
  assert.equal(a2.parentId, '');
});

test('applyMove multi-drag moves both folders preserving tree order', function () {
  const folders = makeFolders();
  const result = LitFolderTree.applyMove(folders, ['A2', 'A1'], 'B', 'after');
  assert.equal(result.changed, true);
  assert.ok(result.touchedIds.includes('A1') && result.touchedIds.includes('A2'));
  // 相对次序保持 A1 在 A2 前（树序 = sortIndex 序），插入 B 之后
  const rootIds = folders
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (a, b) { return a.sortIndex - b.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds, ['A', 'B', 'A1', 'A2', 'C']);
  // 旧父组 A 已无子级
  assert.equal(folders.some(function (f) { return f.parentId === 'A'; }), false);
});

test('applyMove rejects dragging a folder into its own descendant', function () {
  const folders = makeFolders();
  const before = snapshot(folders);
  const result = LitFolderTree.applyMove(folders, ['A'], 'A1', 'inside');
  assert.equal(result.changed, false);
  assert.deepEqual(result.touchedIds, []);
  assert.deepEqual(snapshot(folders), before);
});

test('applyMove rejects a target that is part of the dragged set', function () {
  const folders = makeFolders();
  const before = snapshot(folders);
  const result = LitFolderTree.applyMove(folders, ['A', 'B'], 'B', 'before');
  assert.equal(result.changed, false);
  assert.deepEqual(snapshot(folders), before);
});

test('applyMove sanitizes dragged descendants out of the drag set', function () {
  const folders = makeFolders();
  // A1 的祖先 A 也在集合里 → A1 被剔除，只移动 A（A1 随子树跟随）
  const result = LitFolderTree.applyMove(folders, ['A1', 'A'], 'C', 'before');
  assert.equal(result.changed, true);
  assert.ok(!result.touchedIds.includes('A1') || folders.find(function (f) { return f.id === 'A1'; }).sortIndex !== 0);
  const a = folders.find(function (f) { return f.id === 'A'; });
  const a1 = folders.find(function (f) { return f.id === 'A1'; });
  assert.equal(a.parentId, '');
  assert.equal(a1.parentId, 'A');   // 子树跟随，A1 仍在 A 下
  // A 未被移进自己的子树
  assert.equal(a1.parentId === 'A', true);
});

test('applyMove rootEnd moves folders to root end', function () {
  const folders = makeFolders();
  const result = LitFolderTree.applyMove(folders, ['A1'], null, 'rootEnd');
  assert.equal(result.changed, true);
  const a1 = folders.find(function (f) { return f.id === 'A1'; });
  assert.equal(a1.parentId, '');
  const rootIds = folders
    .filter(function (f) { return (f.parentId || '') === ''; })
    .sort(function (a, b) { return a.sortIndex - b.sortIndex; })
    .map(function (f) { return f.id; });
  assert.deepEqual(rootIds, ['A', 'B', 'C', 'A1']);
  // 旧父组 A 下 A2 重编号为 0
  const a2 = folders.find(function (f) { return f.id === 'A2'; });
  assert.equal(a2.sortIndex, 0);
});

test('applyMove reports changed:false and does not mutate on a no-op move', function () {
  const folders = makeFolders();
  const before = snapshot(folders);
  // C 已经在 B 之后 → 无变化
  const result = LitFolderTree.applyMove(folders, ['C'], 'B', 'after');
  assert.equal(result.changed, false);
  assert.deepEqual(result.touchedIds, []);
  assert.deepEqual(snapshot(folders), before);
});

test('applyMove drops unknown ids from the drag set', function () {
  const folders = makeFolders();
  const result = LitFolderTree.applyMove(folders, ['zz', 'B'], 'A', 'inside');
  assert.equal(result.changed, true);
  const b = folders.find(function (f) { return f.id === 'B'; });
  assert.equal(b.parentId, 'A');
});

test('applyMove empty drag set is a no-op', function () {
  const folders = makeFolders();
  const before = snapshot(folders);
  const result = LitFolderTree.applyMove(folders, [], 'A', 'inside');
  assert.equal(result.changed, false);
  assert.deepEqual(snapshot(folders), before);
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
