'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const moduleUrl = pathToFileURL(path.join(root, 'vendor', 'mupdf', 'mupdf.js')).href;

test('MuPDF writes standard highlight and text annotations incrementally', async function () {
  const mupdf = await import(moduleUrl);
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'embedded-formula.pdf'));
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  const page = doc.loadPage(0);
  const highlight = page.createAnnotation('Highlight');
  highlight.setName('hl1');
  highlight.setContents('重要结论');
  highlight.setColor([1, 0.84, 0]);
  highlight.setQuadPoints([[20, 20, 180, 20, 20, 42, 180, 42]]);
  highlight.update();
  highlight.destroy();
  const note = page.createAnnotation('Text');
  note.setName('nt1');
  note.setContents('页边批注');
  note.setRect([220, 30, 240, 50]);
  note.update();
  note.destroy();
  const saved = doc.saveToBuffer('incremental').asUint8Array().slice();
  page.destroy();
  doc.destroy();

  const reloaded = mupdf.Document.openDocument(saved, 'application/pdf').asPDF();
  const reloadedPage = reloaded.loadPage(0);
  const annotations = reloadedPage.getAnnotations();
  assert.equal(annotations.length, 2);
  assert.deepEqual(annotations.map(function (item) { return item.getType(); }).sort(), ['Highlight', 'Text']);
  assert.ok(annotations.some(function (item) { return item.getName() === 'hl1' && item.getContents() === '重要结论'; }));
  annotations.forEach(function (item) { item.destroy(); });
  reloadedPage.destroy();
  reloaded.destroy();
});
