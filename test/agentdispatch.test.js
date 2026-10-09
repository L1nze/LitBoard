'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchBatch } = require('../js/agentdispatch.js');
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('fast parallel result commits immediately while slow call remains active; results retain input order', async () => {
  const slow = deferred(), saved = [];
  const batch = dispatchBatch(['slow', 'fast'], { canParallel: () => true, execute: async (c) => c === 'slow' ? slow.promise : c, commit: async (r, i) => saved.push([r, i]) });
  await tick();
  assert.deepEqual(saved, [['fast', 1]]);
  slow.resolve('slow');
  assert.deepEqual(await batch, ['slow', 'fast']);
  assert.deepEqual(saved, [['fast', 1], ['slow', 0]]);
});

test('parallel concurrency never exceeds three; commits use one serial chain', async () => {
  let active = 0, maxActive = 0, saves = 0, maxSaves = 0;
  const results = await dispatchBatch([0, 1, 2, 3, 4, 5], {
    maxConcurrency: 99, canParallel: () => true,
    execute: async (c) => { active++; maxActive = Math.max(maxActive, active); await tick(); active--; return c; },
    commit: async () => { saves++; maxSaves = Math.max(maxSaves, saves); await tick(); saves--; }
  });
  assert.equal(maxActive, 3);
  assert.equal(maxSaves, 1);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
});

test('serial call is a barrier between parallel groups and all prior commits', async () => {
  const events = [];
  await dispatchBatch(['a', 'b', 'write', 'c', 'd'], {
    canParallel: (c) => c !== 'write',
    execute: async (c) => { events.push('start:' + c); await tick(); return c; },
    commit: async (c) => { await tick(); events.push('save:' + c); }
  });
  assert.ok(events.indexOf('start:write') > events.indexOf('save:a'));
  assert.ok(events.indexOf('start:write') > events.indexOf('save:b'));
  assert.ok(events.indexOf('start:c') > events.indexOf('save:write'));
  assert.ok(events.indexOf('start:d') > events.indexOf('save:write'));
});

test('cancellation stops queued calls and leaves their output slots empty', async () => {
  let cancelled = false;
  const started = [];
  const out = await dispatchBatch([0, 1, 2], {
    maxConcurrency: 1, canParallel: () => true, isCancelled: () => cancelled,
    execute: async (c) => { started.push(c); return c; },
    commit: async () => { cancelled = true; }
  });
  assert.deepEqual(started, [0]);
  assert.equal(out.length, 3);
  assert.equal(1 in out, false);
});

test('commit failure cancels active calls, waits for their settlement and prevents further dispatch', async () => {
  const pending = deferred(), saveError = new Error('disk full');
  const started = [], saved = [];
  let cancelCount = 0, settled = false;
  const batch = dispatchBatch([0, 1, 2, 3], {
    maxConcurrency: 2, canParallel: () => true,
    execute: async (c) => { started.push(c); if (c === 1) { await pending.promise; settled = true; } return c; },
    commit: async (r) => { saved.push(r); throw saveError; },
    cancelActive: () => { cancelCount++; pending.resolve(); }
  });
  await assert.rejects(batch, (error) => error === saveError);
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(saved, [0]);
  assert.equal(cancelCount, 1);
  assert.equal(settled, true);
});

test('execution failure becomes an error result and conservative policy keeps unknown calls serial', async () => {
  const events = [];
  const out = await dispatchBatch([{ callId: 'a', name: 'read' }, { callId: 'b' }], {
    canParallel: () => 'truthy',
    execute: async (c) => { events.push(c.callId); if (c.callId === 'a') throw new Error('timeout'); return 'ok'; },
    commit: async (r, i) => { events.push('save:' + i); }
  });
  assert.equal(out[0].error, true);
  assert.equal(out[0].callId, 'a');
  assert.match(out[0].result, /timeout/);
  assert.equal(out[1], 'ok');
  assert.deepEqual(events, ['a', 'save:0', 'b', 'save:1']);
});
