'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitDedupe = require('../js/dedupe.js');

function p(over) {
  return Object.assign({
    id: 'p' + Math.random().toString(36).slice(2, 8),
    title: '', authors: [], year: null, doi: '',
    pdfFileName: '', pdfPath: '', pdfFingerprint: '',
    attachments: [], addedAt: 1000
  }, over);
}

function att(over) {
  return Object.assign({
    id: 'at' + Math.random().toString(36).slice(2, 8),
    kind: 'pdf', fileName: 'paper.pdf', path: '', fingerprint: '', addedAt: 1000
  }, over);
}

// ---------- createMatchIndex / findMatch ----------

test('findMatch hits by PDF fingerprint with reason pdf', function () {
  const fp = 'a'.repeat(64);
  const target = p({ id: 't1', title: 'Some Title Here', pdfFingerprint: fp });
  const index = LitDedupe.createMatchIndex([target]);
  const hit = LitDedupe.findMatch(index, p({ title: 'Other Title Entirely', pdfFingerprint: fp }));
  assert.equal(hit.paper.id, 't1');
  assert.equal(hit.reason, 'pdf');
});

test('findMatch hits by DOI case-insensitively', function () {
  const target = p({ id: 't1', title: 'Some Title', doi: '10.1000/ABC' });
  const index = LitDedupe.createMatchIndex([target]);
  const hit = LitDedupe.findMatch(index, p({ title: 'Different Title', doi: '10.1000/abc' }));
  assert.equal(hit.paper.id, 't1');
  assert.equal(hit.reason, 'metadata');
});

test('normDoi aligns case and doi.org URL after trimming whitespace', function () {
  assert.equal(LitDedupe.normDoi('  https://doi.org/10.1039/C5EE00111K  '),
    LitDedupe.normDoi('10.1039/c5ee00111k'));
  assert.notEqual(LitDedupe.normDoi('10.1039/C5EE00111K'),
    LitDedupe.normDoi('10.1039/c5ee00111x'));
});

test('findMatch does not auto-match by normalized title', function () {
  const target = p({ id: 't1', title: 'Attention Is All You Need', year: 2017, authors: ['Ashish Vaswani'] });
  const index = LitDedupe.createMatchIndex([target]);
  const hit = LitDedupe.findMatch(index, p({ title: 'attention is ALL you need!', year: 2017 }));
  assert.equal(hit, null);
});

test('findMatch respects DOI hard veto on title candidates', function () {
  const target = p({ id: 't1', title: 'A Shared Research Title', doi: '10.1/aaa' });
  const index = LitDedupe.createMatchIndex([target]);
  const hit = LitDedupe.findMatch(index, p({ title: 'A Shared Research Title', doi: '10.1/bbb' }));
  assert.equal(hit, null);
});

test('findMatch ignores placeholder/short titles', function () {
  const target = p({ id: 't1', title: '(未识别标题)' });
  const index = LitDedupe.createMatchIndex([target]);
  assert.equal(LitDedupe.findMatch(index, p({ title: '(未识别标题)' })), null);
});

test('findMatch ignores trashed papers', function () {
  const target = p({ id: 't1', title: 'Deleted Paper', doi: '10.1000/deleted', deletedAt: Date.now() });
  const index = LitDedupe.createMatchIndex([target]);
  assert.equal(LitDedupe.findMatch(index, p({ doi: '10.1000/deleted' })), null);
});

test('findMatch checks all PDF attachments, not only legacy primary fingerprint', function () {
  const fp = 'b'.repeat(64);
  const target = p({
    id: 't1',
    title: 'Paper With Secondary PDF',
    attachments: [
      att({ id: 'main', fileName: 'main.pdf', fingerprint: 'c'.repeat(64) }),
      att({ id: 'supp', fileName: 'accepted.pdf', fingerprint: fp })
    ]
  });
  const index = LitDedupe.createMatchIndex([target]);
  const hit = LitDedupe.findMatch(index, p({
    attachments: [att({ id: 'incoming', fileName: 'copy.pdf', fingerprint: fp })]
  }));
  assert.equal(hit.paper.id, 't1');
  assert.equal(hit.reason, 'pdf');
});

test('findMatch returns null when nothing matches', function () {
  const index = LitDedupe.createMatchIndex([p({ title: 'Existing Paper', doi: '10.1/x' })]);
  assert.equal(LitDedupe.findMatch(index, p({ title: 'Brand New Paper', doi: '10.1/y' })), null);
});

test('indexPaper makes newly added papers matchable', function () {
  const index = LitDedupe.createMatchIndex([]);
  const added = p({ id: 'n1', title: 'Freshly Imported Paper', doi: '10.1/new' });
  LitDedupe.indexPaper(index, added);
  const hit = LitDedupe.findMatch(index, p({ title: 'Anything', doi: '10.1/NEW' }));
  assert.equal(hit.paper.id, 'n1');
});

// ---------- mergeAttachments ----------

test('mergeAttachments is a no-op when candidate has no attachments (bib/ris/json import)', function () {
  const target = p({ attachments: [att({ id: 'a1', path: 'C:/lib/old.pdf' })] });
  const merged = LitDedupe.mergeAttachments(target, p({}));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'a1');
});

test('mergeAttachments makes incoming PDF the primary when target has no PDF', function () {
  const target = p({ attachments: [att({ id: 's1', kind: 'supp', fileName: 'supp.zip' })] });
  const incoming = p({ attachments: [att({ id: 'n1', path: 'C:/new.pdf', fingerprint: 'b'.repeat(64) })] });
  const merged = LitDedupe.mergeAttachments(target, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'n1');
  assert.equal(merged[0].kind, 'pdf');
});

test('mergeAttachments appends PDF as extra attachment when target already has a primary', function () {
  const target = p({ attachments: [att({ id: 'a1', path: 'C:/lib/main.pdf', fingerprint: 'c'.repeat(64) })] });
  const incoming = p({ attachments: [att({ id: 'n1', path: 'C:/dl/version2.pdf', fingerprint: 'd'.repeat(64) })] });
  const merged = LitDedupe.mergeAttachments(target, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'a1'); // 主 PDF 不动
  assert.equal(merged[1].id, 'n1');
});

test('mergeAttachments dedupes by fingerprint, path (case-insensitive) and id', function () {
  const fp = 'e'.repeat(64);
  const target = p({ attachments: [att({ id: 'a1', path: 'C:/Lib/Main.pdf', fingerprint: fp })] });
  const incoming = p({ attachments: [
    att({ id: 'x1', path: 'D:/elsewhere/copy.pdf', fingerprint: fp }),      // 同指纹 → 丢
    att({ id: 'x2', path: 'c:/lib/main.pdf' }),                             // 同路径（大小写不同）→ 丢
    att({ id: 'a1', path: 'D:/other.pdf' }),                                // 同 id → 丢
    att({ id: 'x3', path: 'D:/really-new.pdf', fingerprint: 'f'.repeat(64) })
  ] });
  const merged = LitDedupe.mergeAttachments(target, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, 'x3');
});

test('mergeAttachmentsDetailed collapses duplicate PDFs already on the same entry', function () {
  const fingerprint = 'g'.repeat(64);
  const target = p({ attachments: [
    att({ id: 'keep', path: 'C:/library/paper.pdf', fingerprint: fingerprint }),
    att({ id: 'duplicate', path: 'D:/folder/copy.pdf', fingerprint: fingerprint })
  ] });

  const merged = LitDedupe.mergeAttachmentsDetailed(target, p({}));

  assert.deepEqual(merged.attachments.map(function (item) { return item.id; }), ['keep']);
  assert.equal(merged.aliases.duplicate, 'keep');
  assert.deepEqual(merged.added, []);
  assert.equal(target.attachments.length, 2, '不得修改原条目');
});

test('mergeAttachmentsDetailed keeps different PDF versions on one entry', function () {
  const target = p({ attachments: [att({ id: 'v1', fingerprint: 'h'.repeat(64) })] });
  const incoming = p({ attachments: [att({ id: 'v2', fingerprint: 'i'.repeat(64) })] });

  const merged = LitDedupe.mergeAttachmentsDetailed(target, incoming);

  assert.deepEqual(merged.attachments.map(function (item) { return item.id; }), ['v1', 'v2']);
});

test('mergeAttachments does not mutate inputs', function () {
  const target = p({ attachments: [att({ id: 'a1', path: 'C:/lib/main.pdf' })] });
  const incoming = p({ attachments: [att({ id: 'n1', path: 'C:/new.pdf' })] });
  const merged = LitDedupe.mergeAttachments(target, incoming);
  assert.equal(target.attachments.length, 1);
  assert.equal(incoming.attachments.length, 1);
  assert.equal(merged.length, 2);
});
