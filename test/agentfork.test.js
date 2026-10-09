'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { forkDocument } = require('../js/agentfork.js');

test('historical fork restores original context, pairs tools and isolates metadata', function () {
  const source = {
    id: 'old', messages: [
      { role: 'user', turnId: 'a', content: 'question', compacted: true },
      { role: 'assistant', turnId: 'a', tool_calls: [{ id: 'c' }] },
      { role: 'tool', turnId: 'a', tool_call_id: 'c', content: '{"ref":"session:old|附件/x.png"}' },
      { role: 'user', kind: 'compaction', content: 'future summary' },
      { role: 'user', turnId: 'b', content: 'future' }
    ],
    turnMeta: { a: { model: 'frozen' }, b: { model: 'future' } },
    editHistory: { a: ['future'] }, tokens: { in: 9, out: 8 },
    streaming: false, streamText: 'stale', steps: 12, lastInputTokens: 100
  };
  const original = JSON.stringify(source);
  const doc = forkDocument(source, { id: 'new', title: 'branch', messageIndex: 1, now: 'date' });
  assert.equal(doc.messages.length, 3);
  assert.equal(doc.messages[0].compacted, undefined);
  assert.match(doc.messages[2].content, /session:new\|/);
  assert.deepEqual(doc.turnMeta, { a: { model: 'frozen' } });
  assert.deepEqual(doc.editHistory, {});
  assert.deepEqual(doc.tokens, { in: 0, out: 0 });
  assert.equal(doc.steps, 0);
  assert.equal(doc.createdAt, 'date');
  assert.deepEqual(doc.forkedFrom, { sessionId: 'old', messageIndex: 2 });
  const laterCutoff = forkDocument(source, { id: 'another', messageIndex: 4 });
  assert.equal(laterCutoff.messages.some((msg) => msg.kind === 'compaction'), false);
  assert.equal(laterCutoff.messages.some((msg) => msg.compacted), false);
  doc.turnMeta.a.model = 'changed';
  assert.equal(JSON.stringify(source), original);
});

test('full fork retains valid summary and rewrites image references', function () {
  const source = { id: 'old', messages: [
    { role: 'user', compacted: true, images: [{ ref: 'session:old|附件/a.png' }] },
    { role: 'user', kind: 'compaction', content: 'summary' }
  ] };
  const doc = forkDocument(source, { id: 'new' });
  assert.equal(doc.messages[0].compacted, true);
  assert.equal(doc.messages[1].kind, 'compaction');
  assert.equal(doc.messages[0].images[0].ref, 'session:new|附件/a.png');
});

test('fork refuses busy sessions, invalid cutoffs and incomplete tools', function () {
  assert.throws(() => forkDocument({ id: 's', streaming: true }, { id: 'n' }), /busy/);
  assert.throws(() => forkDocument({ id: 's', messages: [] }, { id: 'n', messageIndex: 0 }), /index/);
  assert.throws(() => forkDocument({ id: 's', messages: [{ role: 'assistant', tool_calls: [{ id: 'c' }] }] }, { id: 'n' }), /Incomplete/);
  assert.throws(() => forkDocument({ id: 's', messages: [{ role: 'tool', tool_call_id: 'c' }] }, { id: 'n' }), /Unpaired/);
});
