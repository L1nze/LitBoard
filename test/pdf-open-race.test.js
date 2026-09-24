'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/app.js'), 'utf8');

function harness() {
  const pending = new Map();
  const activated = [];
  const overlay = { hidden: true };
  const context = {
    pdfTabs: [], pdfOpenRequest: 0, pdfState: {},
    $: () => overlay, T: s => s, toast() {},
    organizePaperAttachments() {}, recordPaperRead() {}, stashPdfTab() {}, renderPdfTabs() {},
    pdfAttachment: (paper, id) => paper.attachments.find(a => a.id === id),
    desktop: { getSetting(key) { return new Promise(resolve => pending.set(key, resolve)); } },
    activatePdfTab(tab) { activated.push(tab.key); context.pdfState.paper = tab.paper; context.pdfState.attachmentId = tab.attachment.id; },
  };
  const start = source.indexOf('  function openPdfViewer(');
  const end = source.indexOf('  var savePdfAnnotationComment', start);
  vm.runInNewContext(source.slice(start, end), context);
  const paper = { id: 'p', attachments: [{ id: 'a', path: 'a.pdf' }, { id: 'b', path: 'b.pdf' }] };
  return { context, pending, activated, paper };
}

test('快速打开同一条目的两个附件，迟到的阅读位置不会切回旧附件', async () => {
  const h = harness();
  h.context.openPdfViewer(h.paper, 'a');
  h.context.openPdfViewer(h.paper, 'b');
  h.pending.get('readpos:p:b')({ page: 2 });
  await new Promise(setImmediate);
  h.pending.get('readpos:p:a')({ page: 7 });
  await new Promise(setImmediate);
  assert.deepEqual(h.activated, ['p:b']);
  assert.equal(h.context.pdfTabs[0].page, 7);
});

test('关闭等待阅读位置的附件后，不会被异步回调重新打开', async () => {
  const h = harness();
  h.context.openPdfViewer(h.paper, 'a');
  h.context.pdfTabs.length = 0;
  h.pending.get('readpos:p:a')({ page: 3 });
  await new Promise(setImmediate);
  assert.deepEqual(h.activated, []);
});
