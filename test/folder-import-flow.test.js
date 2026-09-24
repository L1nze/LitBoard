'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/app.js'), 'utf8');
const start = source.indexOf('  var folderImportBusy = false;');
const end = source.indexOf('  function handleFiles(', start);
assert.ok(start >= 0 && end > start);
const LitFolderImport = require('../js/folderimport.js');
const LitModel = require('../js/model.js');

test('nested folder import keeps PDF and other document attachments, reuses folders and source files', async () => {
  const state = {
    folders: [{ id: 'target', name: 'Target', parentId: '', sortIndex: 0 }], papers: []
  };
  const scan = { ok: true, rootName: 'Research', unreadable: [], files: [
    { rel: 'sub/a.pdf', name: 'a.pdf', ext: '.pdf', abs: 'C:/src/sub/a.pdf', size: 10, sourceKey: 'pdf-key' },
    { rel: 'sub/b.epub', name: 'b.epub', ext: '.epub', abs: 'C:/src/sub/b.epub', size: 20, sourceKey: 'epub-key' },
    { rel: 'sub/c.docx', name: 'c.docx', ext: '.docx', abs: 'C:/src/sub/c.docx', size: 30, sourceKey: 'word-key' },
    { rel: 'skip.csv', name: 'skip.csv', ext: '.csv', abs: 'C:/src/skip.csv', size: 40, sourceKey: 'skip-key' }
  ] };
  let nextId = 0, saves = 0, copies = 0;
  const messages = [];
  const context = {
    state, window: { LitFolderImport, LitModel }, T: (s, args) => s.replace(/\{(\w+)\}/g, (_, key) => args[key]),
    $: () => ({ hidden: false }),
    desktop: {
      scanFolder: async () => scan,
      storeAttachment: async ({ path }) => { copies++; return { path: 'D:/managed/' + path.split('/').pop() }; }
    },
    uid: () => 'p' + ++nextId, folderUid: () => 'f' + ++nextId,
    attachmentUid: () => 'a' + ++nextId,
    parsePdfEntries: async (entries, inputOf, assignPaper) => entries.map(entry => {
      const paper = { id: 'pdf-' + entry.name, title: entry.name, attachments: [
        { id: 'pdf-att', kind: 'pdf', fileName: entry.name, path: inputOf(entry).path }
      ] };
      assignPaper(paper, entry);
      return paper;
    }),
    storeImportedPdfFiles: async () => {},
    addPapers(papers) {
      let added = 0, merged = 0;
      papers.forEach(paper => {
        const existing = state.papers.find(p => p.title === paper.title);
        if (existing) { merged++; return; }
        state.papers.push(LitModel.normalizePaper(paper));
        added++;
      });
      saves++;
      return { added, merged, addedIds: papers.map(p => p.id), matches: [] };
    },
    save() { saves++; }, waitForLocalSave: async () => true,
    renderAll() {}, renderFolders() {}, selectFolder() {}, toast(message) { messages.push(message); },
    setTimeout, clearTimeout,
    backfillPdfFingerprints: async () => {}, queueImportedPdfIndex() {}, refreshFolderJournalRanks() {}
  };
  vm.runInNewContext(source.slice(start, end), context);
  await context.importDroppedFolder('C:/src', 'target');
  assert.equal(state.folders.length, 3);
  const root = state.folders.find(f => f.name === 'Research');
  const child = state.folders.find(f => f.name === 'sub');
  assert.equal(root.parentId, 'target');
  assert.equal(child.parentId, root.id);
  assert.equal(state.papers.length, 3);
  assert.ok(state.papers.every(p => p.folderIds.includes(child.id)));
  assert.deepEqual(state.papers.map(p => p.attachments[0].kind).sort(), ['epub', 'other', 'pdf']);
  assert.equal(copies, 2);
  assert.equal(saves, 1);
  await context.importDroppedFolder('C:/src', 'target');
  assert.equal(state.folders.length, 3);
  assert.equal(state.papers.length, 3);
  assert.equal(copies, 2);
  assert.ok(messages.some(message => message.includes('跳过不支持的文件 1 个')));
});

test('stopping during scan leaves the library unchanged', async () => {
  const state = { folders: [], papers: [] };
  let resolveScan;
  const stopButton = { hidden: true };
  const messages = [];
  const context = {
    state, window: { LitFolderImport, LitModel }, T: s => s,
    $: () => stopButton,
    desktop: { scanFolder: () => new Promise(resolve => { resolveScan = resolve; }), storeAttachment() {} },
    parsePdfEntries() { throw new Error('Parsing should not start after Stop'); },
    toast: message => messages.push(message), renderAll() {}
  };
  vm.runInNewContext(source.slice(start, end), context);
  const importing = context.importDroppedFolder('C:/src', '');
  assert.equal(stopButton.hidden, false);
  context.folderImportCancelled = true;
  resolveScan({ ok: true, rootName: 'Research', files: [
    { rel: 'a.pdf', name: 'a.pdf', ext: '.pdf', abs: 'C:/src/a.pdf', size: 1 }
  ] });
  await importing;
  assert.deepEqual(state.folders, []);
  assert.deepEqual(state.papers, []);
  assert.equal(stopButton.hidden, true);
  assert.ok(messages.includes('已停止导入'));
});

test('folder and document previews appear before the single final save', async () => {
  const state = { folders: [], papers: [] };
  let releaseCopy, copying;
  const copyStarted = new Promise(resolve => { copying = resolve; });
  let saves = 0;
  const views = [];
  const context = {
    state, window: { LitFolderImport, LitModel }, T: value => value,
    $: () => ({ hidden: false }), setTimeout, clearTimeout,
    desktop: {
      scanFolder: async () => ({ ok: true, rootName: 'Root', files: [
        { rel: 'Child/a.docx', name: 'a.docx', ext: '.docx', abs: 'C:/a.docx', sourceKey: 'a' },
        { rel: 'Child/b.epub', name: 'b.epub', ext: '.epub', abs: 'C:/b.epub', sourceKey: 'b' }
      ] }),
      storeAttachment: ({ path }) => path === 'C:/b.epub'
        ? new Promise(resolve => { releaseCopy = () => resolve({ path: 'D:/b.epub' }); copying(); })
        : Promise.resolve({ path: 'D:/a.docx' })
    },
    uid: (() => { let n = 0; return () => 'p' + ++n; })(),
    folderUid: (() => { let n = 0; return () => 'f' + ++n; })(),
    attachmentUid: (() => { let n = 0; return () => 'a' + ++n; })(),
    parsePdfEntries: async () => [], storeImportedPdfFiles: async () => {},
    addPapers(papers) { state.papers.push(...papers); saves++; return { added: papers.length, merged: 0, addedIds: [], matches: [] }; },
    save() { saves++; }, waitForLocalSave: async () => true,
    selectFolder() { views.push(state.folders.map(f => f.name)); },
    renderFolders() { views.push(state.folders.map(f => f.name)); },
    renderAll() {}, toast() {}, backfillPdfFingerprints: async () => {},
    queueImportedPdfIndex() {}, refreshFolderJournalRanks() {}
  };
  vm.runInNewContext(source.slice(start, end), context);
  const importing = context.importDroppedFolder('C:/Root', '');
  await copyStarted;
  assert.deepEqual(views[0], ['Root']);
  assert.ok(views.some(view => view.includes('Child')));
  assert.equal(context.folderImportPreviewPapers.length, 1);
  assert.equal(state.papers.length, 0);
  assert.equal(saves, 0);
  releaseCopy();
  await importing;
  assert.equal(context.folderImportPreviewPapers.length, 0);
  assert.equal(state.papers.length, 2);
  assert.equal(saves, 1);
});
