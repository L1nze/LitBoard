'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/agentcore.js');
const source = fs.readFileSync(path.join(__dirname, '../js/agentui.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const ctx = {
    desk: {}, runs: new Map(), current: null, openSeq: 0, pendingNewSession: null,
    runner: { restoreInterrupted: () => false }, tools: { tools: [] },
    window: { LitAgentCore: Core }, T: s => s, $: () => ({}),
    touchRun() {}, evictIdleRuns() {}, renderMode() {}, renderAttachments() {}, renderChips() {},
    bump() {}, renderHistory() {}, loadSessions() {}, toastText() {}, toastError(e) { throw e; },
    uploadBusy: false, forkBusy: false, compactBusy: false, setStatus() {}, persistRun: async () => ({ ok: true }),
    renderPendingReferences() {}, freezeContext: () => ({ model: 'test' })
  };
  ctx.makeRun = (id, doc) => ({ id, doc, core: Core.deserialize(doc), streaming: false });
  vm.runInNewContext(source.slice(source.indexOf('  function newSession('), source.indexOf('  /** 会话持久化')) +
    source.slice(source.indexOf('  function sendText('), source.indexOf('  /* ---------------- core.messages')), ctx);
  return ctx;
}

test('late sessionRead cannot roll back a completed reply or unsaved in-memory messages', async () => {
  const ctx = harness();
  const doc = { title: 'topic', messages: [{ role: 'user', content: 'question' }] };
  const run = ctx.makeRun('s', structuredClone(doc));
  ctx.runs.set('s', run);
  run.streaming = true;
  let release;
  ctx.desk.sessionRead = () => new Promise(resolve => { release = () => resolve(structuredClone(doc)); });
  ctx.openSession('s');
  run.core.messages.push({ role: 'assistant', content: 'completed while read was pending' });
  run.streaming = false;
  release();
  await tick();
  assert.equal(run.core.messages.length, 2);
  assert.equal(run.core.messages[1].content, 'completed while read was pending');
});

test('send binds to the selected session before asynchronous work starts', async () => {
  const ctx = harness();
  const a = ctx.makeRun('a', { title: 'A' }), b = ctx.makeRun('b', { title: 'B' });
  ctx.runs.set('a', a); ctx.runs.set('b', b); ctx.current = 'a';
  const started = [];
  ctx.runner.isStreaming = () => false;
  ctx.runner.runTurn = run => { run.streaming = true; started.push(run.id); };
  ctx.sendText('belongs to A');
  ctx.current = 'b';
  await tick();
  assert.deepEqual(started, ['a']);
  assert.equal(a.core.messages[0].content, 'belongs to A');
  assert.equal(b.core.messages.length, 0);
});

test('rapid sends before session creation resolves share one session and one turn', async () => {
  const ctx = harness();
  let release, creates = 0, starts = 0;
  const gate = new Promise(resolve => { release = resolve; });
  ctx.desk.sessionCreate = async () => { creates++; await gate; return { id: 'new-' + creates, data: { title: 'topic' } }; };
  ctx.desk.sessionRead = async () => ({ title: 'topic' });
  ctx.runner.isStreaming = id => !!ctx.runs.get(id).streaming;
  ctx.runner.runTurn = run => { run.streaming = true; starts++; };
  ctx.sendText('one'); ctx.sendText('two');
  release();
  await tick();
  assert.equal(creates, 1);
  assert.equal(starts, 1);
});

test('cache eviction retains unsaved conversation history', () => {
  const failed = { id: 'failed', persistenceError: new Error('disk full') };
  const idle = { id: 'idle' };
  const current = { id: 'current' };
  const removed = [];
  const ctx = { runs: new Map([[failed.id, failed], [idle.id, idle], [current.id, current]]),
    current: current.id, RUNS_LIMIT: 2, persistWarned: {},
    runner: { unregister: id => { removed.push(id); return true; } } };
  vm.runInNewContext(source.slice(source.indexOf('  function touchRun('), source.indexOf('  function newSession(')), ctx);
  ctx.evictIdleRuns();
  assert.equal(ctx.runs.get(failed.id), failed);
  assert.deepEqual(removed, [idle.id]);
});
