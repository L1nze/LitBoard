'use strict';
/* 统一附件入口与 kind 映射（阶段六切片 1） */
const test = require('node:test');
const assert = require('node:assert');
const LitModel = require('../js/model.js');

test('attachmentKindForFile 后缀映射', () => {
  assert.strictEqual(LitModel.attachmentKindForFile('paper.pdf'), 'pdf');
  assert.strictEqual(LitModel.attachmentKindForFile('Novel.EPUB'), 'epub');
  assert.strictEqual(LitModel.attachmentKindForFile('archive.PDF'), 'pdf');
  assert.strictEqual(LitModel.attachmentKindForFile('data.zip'), '');
  assert.strictEqual(LitModel.attachmentKindForFile(''), '');
  assert.strictEqual(LitModel.attachmentKindForFile(null), '');
});

test('normalizeAttachment 无显式 kind 时按后缀判 epub/pdf', () => {
  const epub = LitModel.normalizeAttachment({ id: 'a1', fileName: 'book.epub', path: '/books/book.epub' });
  assert.strictEqual(epub.kind, 'epub');
  const pdf = LitModel.normalizeAttachment({ id: 'a2', path: '/papers/p.pdf' });
  assert.strictEqual(pdf.kind, 'pdf');
  const other = LitModel.normalizeAttachment({ id: 'a3', fileName: 'notes.txt' });
  assert.strictEqual(other.kind, 'other');
});

test('normalizeAttachment 显式合法 kind 不被后缀覆盖', () => {
  const snap = LitModel.normalizeAttachment({ id: 'a4', kind: 'snapshot', path: '/snaps/site' });
  assert.strictEqual(snap.kind, 'snapshot');
  const supp = LitModel.normalizeAttachment({ id: 'a5', kind: 'supp', fileName: 'book.epub' });
  assert.strictEqual(supp.kind, 'supp');
});
