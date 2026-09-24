'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const LitModel = require('../js/model.js');
const LitDedupe = require('../js/dedupe.js');
const LitPdfTabs = require('../js/app/pdf-tabs.js');

function pdf(id, path, fingerprint) {
  return { id, kind: 'pdf', fileName: id + '.pdf', path, fingerprint: fingerprint || '' };
}

test('同一文献的多 PDF 经规范化和去重后仍可按附件 ID 分别打开', function () {
  const first = pdf('pdf-a', 'C:/papers/a.pdf', 'a'.repeat(64));
  const second = pdf('pdf-b', 'C:/papers/b.pdf', 'b'.repeat(64));
  const normalized = LitModel.normalizePaper({ id: 'paper', title: 'Paper', attachments: [first, second] });
  const merged = LitDedupe.mergeAttachmentsDetailed({ attachments: normalized.attachments }, null);

  assert.deepEqual(merged.attachments.map(function (item) { return item.id; }), ['pdf-a', 'pdf-b']);
  const tabs = merged.attachments.map(function (attachment) {
    return { key: LitPdfTabs.key(normalized.id, attachment.id), attachment: attachment };
  });
  assert.equal(LitPdfTabs.find(tabs, 'paper', 'pdf-a').attachment.path, first.path);
  assert.equal(LitPdfTabs.find(tabs, 'paper', 'pdf-b').attachment.path, second.path);
});

test('合法但命中对象原型名的附件 ID 不会被规范化去重表吞掉', function () {
  const paper = LitModel.normalizePaper({
    id: 'paper', title: 'Paper', attachments: [
      pdf('toString', 'C:/papers/a.pdf'),
      pdf('pdf-b', 'C:/papers/b.pdf')
    ]
  });

  assert.deepEqual(paper.attachments.map(function (item) { return item.id; }), ['toString', 'pdf-b']);
});

test('库内文献合并保留原型名附件 ID 对应的附件', function () {
  const merged = LitDedupe.merge([
    { id: 'paper-a', title: 'Paper', attachments: [pdf('constructor', 'C:/papers/a.pdf')] },
    { id: 'paper-b', title: 'Paper', attachments: [pdf('pdf-b', 'C:/papers/b.pdf')] }
  ]);

  assert.deepEqual(merged.attachments.map(function (item) { return item.id; }), ['constructor', 'pdf-b']);
});
