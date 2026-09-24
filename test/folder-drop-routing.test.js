'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/app.js'), 'utf8');
const start = source.indexOf('    async function pathFromDroppedDirectory(rootEntry) {');
const end = source.indexOf('    function sidebarFileDrop(e) {', start);
assert.ok(start >= 0 && end > start);
const LitFolderImport = require('../js/folderimport.js');

test('one drop collapses nested directory roots and imports loose documents into the chosen collection', async () => {
  const calls = [];
  const context = {
    folderImportBusy: false, folderImportCancelled: false,
    desktop: { getPathForFile: file => file.path, scanFolder() {} },
    window: { LitFolderImport }, T: value => value,
    toast: value => calls.push(['toast', value]),
    importDroppedFolder: async (path, folder) => calls.push(['folder', path, folder]),
    importLooseDocuments: async (files, folder) => calls.push(['files', files.map(file => file.name), folder])
  };
  vm.runInNewContext(source.slice(start, end), context);
  const items = [
    { name: 'A', path: 'C:/docs/A', isDirectory: true },
    { name: 'sub', path: 'C:/docs/A/sub', isDirectory: true },
    { name: 'B', path: 'C:/docs/B', isDirectory: true },
    { name: 'extra.epub', path: 'C:/docs/extra.epub', size: 9 }
  ].map(file => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: !!file.isDirectory, name: file.name }),
    getAsFile: () => file }));
  await context.importExternalDrop({ dataTransfer: { items, files: [] } }, 'target');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['folder', 'C:/docs/A', 'target'],
    ['folder', 'C:/docs/B', 'target'],
    ['files', ['extra.epub'], 'target']
  ]);
});

test('directory entry without a top-level File resolves its path from a nested disk-backed file', async () => {
  const calls = [];
  const context = {
    folderImportBusy: false, folderImportCancelled: false,
    desktop: { getPathForFile: file => file.path, scanFolder() {} },
    window: { LitFolderImport }, T: value => value, toast() {},
    importDroppedFolder: async path => calls.push(path),
    importLooseDocuments: async () => { throw new Error('Unexpected loose file import'); }
  };
  vm.runInNewContext(source.slice(start, end), context);
  function directory(name, fullPath, children) {
    return { name, fullPath, isDirectory: true, createReader() {
      let sent = false;
      return { readEntries(callback) { callback(sent ? [] : children); sent = true; } };
    } };
  }
  const leaf = { name: 'paper.pdf', fullPath: '/Research/sub/paper.pdf', isFile: true,
    file(callback) { callback({ name: this.name, path: 'C:/Data/Research/sub/paper.pdf' }); } };
  const root = directory('Research', '/Research', [directory('sub', '/Research/sub', [leaf])]);
  const item = { kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null };
  await context.importExternalDrop({ dataTransfer: { items: [item], files: [] } }, '');
  assert.deepEqual(calls, ['C:/Data/Research']);
});
