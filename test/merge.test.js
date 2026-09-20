'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitMerge = require('../js/merge.js');

const NOW = 1700000000000;

function merge(base, local, remote, spec) {
  return LitMerge.mergeEntity(base, local, remote, spec || LitMerge.PAPER_SPEC, { now: NOW });
}

test('non-overlapping scalar edits merge automatically without conflicts', function () {
  const base = { id: 'p1', title: 'Old Title', venue: 'Old Venue', year: 2020 };
  const local = { id: 'p1', title: 'New Title', venue: 'Old Venue', year: 2020 };
  const remote = { id: 'p1', title: 'Old Title', venue: 'New Venue', year: 2020 };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.title, 'New Title');
  assert.equal(merged.venue, 'New Venue');
  assert.equal(merged.year, 2020);
});

test('both sides editing the same scalar differently yields one scalar conflict', function () {
  const base = { id: 'p1', title: 'Base Title' };
  const local = { id: 'p1', title: 'Local Title' };
  const remote = { id: 'p1', title: 'Remote Title' };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'scalar');
  assert.equal(conflicts[0].field, 'title');
  assert.equal(conflicts[0].label, 'title');
  assert.equal(conflicts[0].base, 'Base Title');
  assert.equal(conflicts[0].local, 'Local Title');
  assert.equal(conflicts[0].remote, 'Remote Title');
  assert.equal(merged.title, 'Local Title');

  const pickedLocal = LitMerge.applyChoice(merged, conflicts[0], 'local');
  assert.equal(pickedLocal.title, 'Local Title');
  const pickedRemote = LitMerge.applyChoice(merged, conflicts[0], 'remote');
  assert.equal(pickedRemote.title, 'Remote Title');
});

test('nested object fields compare as whole scalars', function () {
  const base = { id: 'p1', journalRank: { tier: 'A', score: 1 } };
  const local = { id: 'p1', journalRank: { tier: 'A', score: 1 } };
  const remote = { id: 'p1', journalRank: { score: 2, tier: 'A' } };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(merged.journalRank, { tier: 'A', score: 2 });
});

test('set fields merge concurrently: local delete + remote add', function () {
  const base = { id: 'p1', tags: ['A', 'B'], folderIds: ['f1'] };
  const local = { id: 'p1', tags: ['B'], folderIds: ['f1'] };
  const remote = { id: 'p1', tags: ['A', 'B', 'C'], folderIds: ['f1', 'f2'] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(merged.tags, ['B', 'C']);
  assert.deepEqual(merged.folderIds, ['f1', 'f2']);
});

test('set field deleted on both sides stays deleted; duplicate adds dedupe', function () {
  const base = { id: 'p1', tags: ['A', 'B'] };
  const local = { id: 'p1', tags: ['B', 'N'] };
  const remote = { id: 'p1', tags: ['B', 'N'] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(merged.tags, ['B', 'N']);
});

test('attachments merge by id: remote add + local delete of another', function () {
  const base = {
    id: 'p1',
    attachments: [
      { id: 'a1', path: 'one.pdf' },
      { id: 'a2', path: 'two.pdf' }
    ]
  };
  const local = { id: 'p1', attachments: [{ id: 'a1', path: 'one.pdf' }] };
  const remote = {
    id: 'p1',
    attachments: [
      { id: 'a1', path: 'one.pdf' },
      { id: 'a2', path: 'two.pdf' },
      { id: 'a3', path: 'three.pdf' }
    ]
  };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(merged.attachments.map(function (a) { return a.id; }), ['a1', 'a3']);
});

test('same attachment edited differently on both sides yields an item conflict', function () {
  const base = { id: 'p1', attachments: [{ id: 'a1', path: 'old.pdf', label: 'old' }] };
  const local = { id: 'p1', attachments: [{ id: 'a1', path: 'old.pdf', label: 'local' }] };
  const remote = { id: 'p1', attachments: [{ id: 'a1', path: 'old.pdf', label: 'remote' }] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'item');
  assert.equal(conflicts[0].field, 'attachments');
  assert.equal(conflicts[0].itemId, 'a1');
  assert.equal(conflicts[0].label, 'attachments#a1');
  assert.equal(merged.attachments[0].label, 'local');

  const picked = LitMerge.applyChoice(merged, conflicts[0], 'remote');
  assert.equal(picked.attachments.length, 1);
  assert.equal(picked.attachments[0].label, 'remote');
});

test('delete-vs-edit on the same attachment yields a deletedBy conflict', function () {
  const base = { id: 'p1', attachments: [{ id: 'a1', path: 'x.pdf', label: 'base' }] };
  const local = { id: 'p1', attachments: [] };
  const remote = { id: 'p1', attachments: [{ id: 'a1', path: 'x.pdf', label: 'edited' }] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'item');
  assert.equal(conflicts[0].deletedBy, 'local');
  assert.equal(conflicts[0].local, undefined);
  assert.deepEqual(conflicts[0].remote, { id: 'a1', path: 'x.pdf', label: 'edited' });
  assert.equal(merged.attachments.length, 0);

  const kept = LitMerge.applyChoice(merged, conflicts[0], 'remote');
  assert.equal(kept.attachments.length, 1);
  assert.equal(kept.attachments[0].label, 'edited');

  const { merged: merged2, conflicts: conflicts2 } = merge(base, local, remote);
  const dropped = LitMerge.applyChoice(merged2, conflicts2[0], 'local');
  assert.equal(dropped.attachments.length, 0);
});

test('delete-vs-edit mirrored: remote deletes while local edits', function () {
  const base = { id: 'p1', attachments: [{ id: 'a1', path: 'x.pdf', label: 'base' }] };
  const local = { id: 'p1', attachments: [{ id: 'a1', path: 'x.pdf', label: 'edited' }] };
  const remote = { id: 'p1', attachments: [] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].deletedBy, 'remote');
  assert.equal(merged.attachments.length, 1);

  const dropped = LitMerge.applyChoice(merged, conflicts[0], 'remote');
  assert.equal(dropped.attachments.length, 0);
});

test('pdfAnnotations merge by id with item conflict resolution', function () {
  const base = { id: 'p1', pdfAnnotations: [{ id: 'n1', page: 1, text: 'base note' }] };
  const local = { id: 'p1', pdfAnnotations: [{ id: 'n1', page: 1, text: 'local note' }, { id: 'n2', page: 2, text: 'new local' }] };
  const remote = { id: 'p1', pdfAnnotations: [{ id: 'n1', page: 3, text: 'base note' }] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'pdfAnnotations');
  assert.equal(conflicts[0].itemId, 'n1');
  assert.equal(merged.pdfAnnotations.length, 2);
  assert.equal(merged.pdfAnnotations[0].text, 'local note');

  const picked = LitMerge.applyChoice(merged, conflicts[0], 'remote');
  assert.equal(picked.pdfAnnotations[0].page, 3);
  assert.equal(picked.pdfAnnotations[0].text, 'base note');
});

test('null base with equal sides merges cleanly without conflicts', function () {
  const local = { id: 'p1', title: 'Same', tags: ['a'], attachments: [{ id: 'a1', path: 'x.pdf' }] };
  const remote = { id: 'p1', title: 'Same', tags: ['a'], attachments: [{ id: 'a1', path: 'x.pdf' }] };
  const { merged, conflicts } = merge(null, local, remote);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.title, 'Same');
  assert.deepEqual(merged.tags, ['a']);
  assert.equal(merged.attachments.length, 1);
});

test('updatedAt/addedAt never participate in comparison', function () {
  const base = { id: 'p1', title: 'T', updatedAt: 100, addedAt: 50 };
  const local = { id: 'p1', title: 'T', updatedAt: 999999, addedAt: 50 };
  const remote = { id: 'p1', title: 'T', updatedAt: 888888, addedAt: 50 };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.title, 'T');
  assert.equal(merged.updatedAt, NOW);
  assert.equal(merged.addedAt, 50);
});

test('addedAt falls back to the earliest valid value across sides, then now', function () {
  const { merged } = merge({ id: 'p1' }, { id: 'p1', addedAt: 300 }, { id: 'p1', addedAt: 200 });
  assert.equal(merged.addedAt, 200);
  const fresh = merge({ id: 'p1' }, { id: 'p1' }, { id: 'p1' });
  assert.equal(fresh.merged.addedAt, NOW);
});

test('both sides adding same id with different content conflicts', function () {
  const base = { id: 'p1', attachments: [] };
  const local = { id: 'p1', attachments: [{ id: 'a9', path: 'local.pdf' }] };
  const remote = { id: 'p1', attachments: [{ id: 'a9', path: 'remote.pdf' }] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'item');
  assert.equal(conflicts[0].itemId, 'a9');
  assert.equal(conflicts[0].base, undefined);
  assert.equal(merged.attachments[0].path, 'local.pdf');

  const picked = LitMerge.applyChoice(merged, conflicts[0], 'remote');
  assert.equal(picked.attachments.length, 1);
  assert.equal(picked.attachments[0].path, 'remote.pdf');
});

test('both sides adding identical new attachment merges without conflict', function () {
  const base = { id: 'p1', attachments: [] };
  const local = { id: 'p1', attachments: [{ id: 'a9', path: 'same.pdf' }] };
  const remote = { id: 'p1', attachments: [{ id: 'a9', path: 'same.pdf' }] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.attachments.length, 1);
});

test('PLAIN_SPEC treats every field as scalar, including arrays', function () {
  const base = { id: 'p1', tags: ['a'] };
  const local = { id: 'p1', tags: ['a', 'b'] };
  const remote = { id: 'p1', tags: ['a', 'c'] };
  const { conflicts } = merge(base, local, remote, LitMerge.PLAIN_SPEC);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'scalar');
  assert.equal(conflicts[0].field, 'tags');
});

test('merged is based on a shallow copy of local', function () {
  const local = { id: 'p1', title: 'L', extra: 'only-local' };
  const { merged } = merge({ id: 'p1' }, local, { id: 'p1' });
  assert.equal(merged.extra, 'only-local');
  assert.notEqual(merged, local);
});

test('stableStringify sorts object keys and stableEqual matches', function () {
  assert.equal(LitMerge.stableStringify({ b: 1, a: [2, { d: 4, c: 3 }] }), '{"a":[2,{"c":3,"d":4}],"b":1}');
  assert.ok(LitMerge.stableEqual({ x: 1, y: 2 }, { y: 2, x: 1 }));
  assert.ok(!LitMerge.stableEqual({ x: 1 }, { x: 2 }));
  assert.ok(LitMerge.stableEqual(undefined, undefined));
  assert.ok(!LitMerge.stableEqual(undefined, null));
});

test('v12 creators array conflicts as a scalar field and resolves by choice', function () {
  const base = { id: 'p1', creators: [{ creatorType: 'author', family: 'A', given: 'X', name: '' }] };
  const local = { id: 'p1', creators: [{ creatorType: 'author', family: 'B', given: 'Y', name: '' }] };
  const remote = { id: 'p1', creators: [{ creatorType: 'author', family: 'C', given: 'Z', name: '' }] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'scalar');
  assert.equal(conflicts[0].field, 'creators');
  assert.equal(LitMerge.applyChoice(merged, conflicts[0], 'remote').creators[0].family, 'C');
  assert.equal(LitMerge.applyChoice(merged, conflicts[0], 'local').creators[0].family, 'B');
});

test('v12 one-sided creators edit merges without conflict', function () {
  const base = { id: 'p1', creators: [{ creatorType: 'author', family: 'A', given: 'X', name: '' }] };
  const local = { id: 'p1', creators: base.creators };
  const remote = { id: 'p1', creators: [{ creatorType: 'author', family: 'C', given: 'Z', name: '' }] };
  const { merged, conflicts } = merge(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.creators[0].family, 'C');
});
