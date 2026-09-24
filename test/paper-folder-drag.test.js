'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/app.js'), 'utf8');
const start = source.indexOf('    // 拖动表格行到左侧文件夹归类');
const end = source.indexOf('    // 补全 / 导出菜单', start);
assert.ok(start >= 0 && end > start);

function harness() {
  const tableEvents = {}, documentEvents = {};
  const paper = { id: 'p', folderIds: ['A', 'C'] };
  const state = { selected: {}, activeFolderId: 'A', activeFolderIds: [], folders: [
    { id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }
  ] };
  const changes = [];
  const context = {
    state, window: { LitModel: { touch() {} } }, T: s => s,
    $: () => ({ addEventListener(type, callback) { tableEvents[type] = callback; } }),
    $all: () => [], document: { addEventListener(type, callback) { documentEvents[type] = callback; } },
    currentFolderLinkTarget: () => state.folders[0], selectedIds: () => ['p'], getById: () => paper,
    makeSnapshot: () => ({ papers: { p: { folderIds: paper.folderIds.slice() } } }),
    commitUndo(_label, before) { changes.push(before.papers.p.folderIds); },
    save() {}, renderAll() {}, toast() {}
  };
  vm.runInNewContext(source.slice(start, end), context);
  const tr = { dataset: { id: 'p' }, classList: { add() {} } };
  const transfer = { effectAllowed: '', setData() {}, getData() { return ''; } };
  function drag(shift) {
    tableEvents.dragstart({ target: { closest: () => tr }, dataTransfer: transfer });
    const target = { dataset: { folder: 'B' }, classList: { add() {} } };
    documentEvents.drop({ target: { closest: () => target }, dataTransfer: transfer,
      shiftKey: shift, preventDefault() {} });
  }
  return { paper, changes, drag, transfer };
}

test('ordinary drag adds collection membership; Shift drag moves only from the viewed collection', () => {
  const h = harness();
  h.drag(false);
  assert.deepEqual(Array.from(h.paper.folderIds), ['A', 'C', 'B']);
  h.paper.folderIds = ['A', 'C'];
  h.drag(true);
  assert.deepEqual(Array.from(h.paper.folderIds), ['C', 'B']);
  assert.equal(h.transfer.effectAllowed, 'copyMove');
  assert.deepEqual(h.changes.map(value => Array.from(value)), [['A', 'C'], ['A', 'C']]);
});
