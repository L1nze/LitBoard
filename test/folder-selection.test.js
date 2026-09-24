'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const LitFolderTree = require('../js/foldertree.js');

const appSource = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const tableClickMarker = "$('#table-body').addEventListener('click', function (e) {";
const tableClickStart = appSource.indexOf(tableClickMarker);
const selectionMarker = '// Windows 风格选择：Ctrl 切换单选，Shift 区间多选，均不打开抽屉';
const selectionStart = appSource.indexOf(selectionMarker, tableClickStart);
const selectionEnd = appSource.indexOf('\n    });\n    // 双击表格行：双击附件子行打开该附件；双击文献行打开其主 PDF', selectionStart);
assert.ok(tableClickStart >= 0 && selectionStart > tableClickStart && selectionEnd > selectionStart,
  'app.js should retain the table row selection branch boundary');
const selectionBranchSource = appSource.slice(selectionStart + selectionMarker.length, selectionEnd);
const rangeStart = appSource.indexOf('  function selectRangeTo(');
const rangeEnd = appSource.indexOf('\n  function moveFocus(', rangeStart);
assert.ok(rangeStart >= 0 && rangeEnd > rangeStart, 'app.js should expose selectRangeTo');
const rangeSource = appSource.slice(rangeStart, rangeEnd);

function folderHarness() {
  const state = {
    activeFolderId: 'all', activeFolderIds: [], folderSelAnchor: null,
    folderFocusId: null,
    focusId: null, selected: {}, selAnchor: null, tablePage: 3,
    folders: [
      { id: 'A', parentId: '', name: 'A', sortIndex: 0 },
      { id: 'B', parentId: '', name: 'B', sortIndex: 1 },
      { id: 'C', parentId: '', name: 'C', sortIndex: 2 }
    ]
  };
  const calls = [];
  const context = {
    state,
    window: { LitFolderTree },
    folderTree: function () { return LitFolderTree.buildVisibleRows(state.folders, {}); },
    journalRankClearFrozen: function () { calls.push('clear-rank'); },
    renderAll: function () { calls.push('render'); },
    refreshFolderJournalRanks: function (id) { calls.push('rank:' + id); },
    reportCurrentFolder: function () { calls.push('report'); }
  };
  vm.runInNewContext(selectFolderSource() + '\nthis.selectFolder = selectFolder;', context);
  return { state, calls, selectFolder: context.selectFolder };
}
function selectFolderSource() {
  const start = appSource.indexOf('  function selectFolder(');
  const end = appSource.indexOf('\n  function reportCurrentFolder()', start);
  assert.ok(start >= 0 && end > start, 'app.js should expose selectFolder');
  return appSource.slice(start, end);
}

function paperHarness(selected, anchor) {
  const state = { selected: Object.assign({}, selected), selAnchor: anchor, focusId: null };
  const rows = ['A', 'B', 'C'].map(function (id) { return { id }; });
  const calls = [];
  const context = {
    state,
    filteredPapers: function () { return rows; },
    updateSelectionUi: function () { calls.push('selection-ui'); },
    openDrawerAndReveal: function (id) { calls.push('open:' + id); },
    toggleSelectId: function (id) {
      if (state.selected[id]) delete state.selected[id]; else state.selected[id] = true;
      context.updateSelectionUi();
    }
  };
  vm.runInNewContext(rangeSource + '\nthis.selectRangeTo = selectRangeTo; this.handle = function (e, id) { var p = { id: id };' + selectionBranchSource + '\n};', context);
  return { state, calls, handle: context.handle };
}

test('normal click A then Ctrl-click B keeps both folders selected', function () {
  const h = folderHarness();
  h.selectFolder('A');
  h.selectFolder('B', { multi: true });
  assert.deepEqual(Array.from(h.state.activeFolderIds), ['A', 'B']);
  assert.equal(h.state.activeFolderId, 'A');
});

test('Ctrl-click toggles an already selected folder out of the union', function () {
  const h = folderHarness();
  h.selectFolder('A');
  h.selectFolder('B', { multi: true });
  h.selectFolder('A', { multi: true });
  assert.deepEqual(Array.from(h.state.activeFolderIds), ['B']);
  assert.equal(h.state.activeFolderId, 'B');
});

test('Shift selects the visible inclusive range from the most recent anchor', function () {
  const h = folderHarness();
  h.selectFolder('A');
  h.selectFolder('C', { range: true });
  assert.deepEqual(Array.from(h.state.activeFolderIds), ['A', 'B', 'C']);
  assert.equal(h.state.activeFolderId, 'A');
});

test('Ctrl+Shift folder selection extends the visible range additively', function () {
  const h = folderHarness();
  h.selectFolder('A');
  h.selectFolder('C', { multi: true, range: true });
  assert.deepEqual(Array.from(h.state.activeFolderIds), ['A', 'B', 'C']);
  assert.equal(h.state.activeFolderId, 'A');
});

test('Ctrl-click adds an unselected paper while retaining the existing selection', function () {
  const h = paperHarness({ A: true }, 'A');
  h.handle({ ctrlKey: true, metaKey: false, shiftKey: false }, 'B');
  assert.deepEqual(Array.from(Object.keys(h.state.selected).sort()), ['A', 'B']);
});

test('Ctrl+Shift-click extends the anchored paper range additively', function () {
  const h = paperHarness({ A: true }, 'A');
  h.handle({ ctrlKey: true, metaKey: false, shiftKey: true }, 'C');
  assert.deepEqual(Array.from(Object.keys(h.state.selected).sort()), ['A', 'B', 'C']);
});

const deletePaper = { id: 'p', title: 'Paper', folderIds: ['f'], deletedAt: null };
const deleteFolder = { id: 'f', name: 'Folder' };
const deleteHelperStart = appSource.indexOf('  function confirmPapersToTrash(ids) {');
const deleteHelperEnd = appSource.indexOf('\n  /**', deleteHelperStart);
assert.ok(deleteHelperStart >= 0 && deleteHelperEnd > deleteHelperStart);
const deleteHelperSource = appSource.slice(deleteHelperStart, deleteHelperEnd);

function contextForDelete() {
  const calls = { trash: 0, unlink: 0, confirm: '' };
  const context = {
    T: value => value,
    drawerId: 'p',
    currentFolderLinkTarget: () => deleteFolder,
    selectedIds: () => ['p'],
    getById: () => deletePaper,
    dlgConfirm(title) { calls.confirm = title; return Promise.resolve(true); },
    removePapers(ids) { calls.trash++; assert.deepEqual(Array.from(ids), ['p']); },
    removePapersFromFolder() { calls.unlink++; }
  };
  return { context, calls };
}

test('bulk Delete in a folder routes the paper to Trash', async function () {
  const start = appSource.indexOf("    $('#bulk-bar').addEventListener('click', function (e) {");
  const end = appSource.indexOf('    // 常驻详情栏', start);
  assert.ok(start >= 0 && end > start);
  let onClick;
  const { context, calls } = contextForDelete();
  context.$ = () => ({ addEventListener(_type, callback) { onClick = callback; } });
  vm.runInNewContext(deleteHelperSource + '\n' + appSource.slice(start, end), context);
  onClick({ target: { closest: () => ({ dataset: { bulk: 'delete' } }) } });
  await Promise.resolve();
  assert.equal(calls.confirm, '移入回收站');
  assert.equal(calls.trash, 1);
  assert.equal(calls.unlink, 0);
});

test('Delete key trashes selected papers, but leaves folder focus and input alone', function () {
  const start = appSource.indexOf('    // M1 弹窗栈：注册覆盖层（Esc 只关最顶层）');
  const end = appSource.indexOf("    $('#d-status').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  let onKeydown;
  const calls = [];
  const context = {
    setupModalStack() {}, setupIssuesMenu() {}, readIssues: () => [],
    $: () => ({ hidden: true }),
    document: { addEventListener(type, callback) { if (type === 'keydown') onKeydown = callback; } },
    state: { activeFolderId: 'f', resultView: 'papers', focusId: 'p', shortcuts: {} },
    selectedIds: () => ['p'], getById: () => deletePaper,
    matchesShortcut: () => false,
    confirmPapersToTrash(ids) { calls.push(Array.from(ids)); }
  };
  vm.runInNewContext(appSource.slice(start, end), context);
  assert.equal(typeof onKeydown, 'function');
  function press(tagName, closest) {
    let prevented = false;
    onKeydown({ key: 'Delete', target: { tagName, isContentEditable: false, closest: () => closest },
      metaKey: false, ctrlKey: false, altKey: false, preventDefault() { prevented = true; } });
    return prevented;
  }
  assert.equal(press('DIV', null), true);
  assert.deepEqual(calls, [['p']]);
  assert.equal(press('DIV', {}), false, 'folder tree handles its own Delete key');
  assert.equal(press('INPUT', null), false);
  context.state.activeFolderId = 'trash';
  assert.equal(press('DIV', null), false, 'Delete does not permanently purge Trash items');
  assert.deepEqual(calls, [['p']]);
});

test('drawer Delete in a folder routes the paper to Trash', async function () {
  const start = appSource.indexOf('    function deleteDrawerPaper() {');
  const end = appSource.indexOf("    $('#d-more').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  const { context, calls } = contextForDelete();
  vm.runInNewContext(appSource.slice(start, end), context);
  context.deleteDrawerPaper();
  await Promise.resolve();
  assert.equal(calls.confirm, '移入回收站');
  assert.equal(calls.trash, 1);
  assert.equal(calls.unlink, 0);
});
