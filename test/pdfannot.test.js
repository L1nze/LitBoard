'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFName, PDFArray } = require('../vendor/pdflib/pdf-lib.min.js');
const LitPdfAnnot = require('../js/pdfannot.js');

async function makePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('Page one content', { x: 50, y: 700, size: 14 });
  doc.addPage([612, 792]).drawText('Page two content', { x: 50, y: 700, size: 14 });
  return doc.save();
}

const sampleAnnotations = [
  { id: 'hl1', type: 'highlight', color: '#ffd400', text: 'quote', comment: '重要结论',
    position: { pageIndex: 0, rects: [[50, 690, 200, 712], [50, 670, 180, 690]] }, createdAt: 1, updatedAt: 2 },
  { id: 'ul1', type: 'underline', color: '#5aa9ff', text: '', comment: '',
    position: { pageIndex: 0, rects: [[50, 640, 220, 652]] }, createdAt: 3, updatedAt: 3 },
  { id: 'nt1', type: 'note', color: '#ff6b6b', text: '', comment: '页边批注',
    position: { pageIndex: 1, rects: [[400, 700, 420, 720]] }, createdAt: 4, updatedAt: 4 },
  { id: 'snap1', type: 'snapshot', color: '#ffd400', text: '', comment: '',
    position: { pageIndex: 0, rects: [[10, 10, 100, 100]] }, createdAt: 5, updatedAt: 5, imagePath: 'x.png' },
  { id: 'ink1', type: 'ink', color: '#ffd400', text: '', comment: '',
    position: { pageIndex: 0, rects: [[10, 10, 100, 100]], points: [[10, 10], [50, 50]] }, createdAt: 6, updatedAt: 6 }
];

test('writeAnnotations embeds standard PDF annotations and skips non-standard types', async function () {
  const bytes = await makePdf();
  const result = await LitPdfAnnot.writeAnnotations(bytes, sampleAnnotations);
  assert.equal(result.written, 3);
  assert.equal(result.skipped, 2); // snapshot + ink

  const reloaded = await PDFDocument.load(result.bytes);
  const page0 = reloaded.getPage(0);
  const annots0 = page0.node.lookup(PDFName.of('Annots'), PDFArray);
  assert.equal(annots0.size(), 2);
  const hl = annots0.lookup(0);
  assert.equal(hl.lookup(PDFName.of('Subtype')).toString(), '/Highlight');
  assert.equal(hl.lookup(PDFName.of('QuadPoints')).size(), 16); // 两个矩形 × 8 坐标
  assert.equal(hl.lookup(PDFName.of('Contents')).decodeText(), '重要结论');
  const page1 = reloaded.getPage(1);
  const annots1 = page1.node.lookup(PDFName.of('Annots'), PDFArray);
  assert.equal(annots1.size(), 1);
  assert.equal(annots1.lookup(0).lookup(PDFName.of('Subtype')).toString(), '/Text');
});

test('writeAnnotations is idempotent via /NM dedupe', async function () {
  const bytes = await makePdf();
  const first = await LitPdfAnnot.writeAnnotations(bytes, sampleAnnotations);
  const second = await LitPdfAnnot.writeAnnotations(first.bytes, sampleAnnotations);
  assert.equal(second.written, 0);
  assert.equal(second.skipped, 5);
});

test('writeAnnotations on a PDF without any annotations still succeeds', async function () {
  const bytes = await makePdf();
  const result = await LitPdfAnnot.writeAnnotations(bytes, []);
  assert.equal(result.written, 0);
  const reloaded = await PDFDocument.load(result.bytes);
  assert.equal(reloaded.getPageCount(), 2);
});
