'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/agentcore.js');
const Sessions = require('../js/agentsessions.js');
const source = fs.readFileSync(path.join(__dirname, '../js/agentui.js'), 'utf8');
const sendTextSlice = source.slice(source.indexOf('  function sendText('), source.indexOf('  /* ---------------- 快照推送'));
const tick = () => new Promise(resolve => setImmediate(resolve));

/* 会话生命周期（open/new/LRU）已拆至 js/agentsessions.js：直接用真 store；
 * sendText 仍在 agentui.js，继续切片注入。 */
function makeStore(desk, runner) {
  return Sessions.createSessionStore({
    desk: desk, T: (s) => s, $: () => ({ appendChild() {}, classList: { toggle() {} } }), el: () => ({ appendChild() {} }), deps: {},
    core: Core, runner: () => runner,
    isUploadBusy: () => false, isCompactBusy: () => false,
    setStatus() {}, renderAttachments() {}, renderChips() {}, renderMode() {}, bump() {},
    toastText() {}, toastError(e) { throw e; }
  });
}

function sendCtx(store, runner) {
  const ctx = {
    S: store, runner: runner, desk: { sessionRename: () => Promise.resolve() },
    tools: { tools: [] }, window: { LitAgentCore: Core, LitResearch: { sessionTitleFrom: (t) => t } },
    T: (s) => s, $: () => ({}), uploadBusy: false, compactBusy: false,
    freezeContext: () => ({ model: 'test' }), thinkingCapability: () => ({ vision: false }),
    renderPendingReferences() {}, setStatus() {}, bump() {}, renderChips() {}, toastText() {}
  };
  vm.runInNewContext(sendTextSlice, ctx);
  return ctx;
}

test('late sessionRead cannot roll back a completed reply or unsaved in-memory messages', async () => {
  const desk = {};
  const store = makeStore(desk, { restoreInterrupted: () => false });
  const doc = { title: 'topic', messages: [{ role: 'user', content: 'question' }] };
  const run = store.makeRun('s', structuredClone(doc));
  store.runs.set('s', run);
  run.streaming = true;
  let release;
  desk.sessionRead = () => new Promise(resolve => { release = () => resolve(structuredClone(doc)); });
  store.openSession('s');
  run.core.messages.push({ role: 'assistant', content: 'completed while read was pending' });
  run.streaming = false;
  release();
  await tick();
  assert.equal(run.core.messages.length, 2);
  assert.equal(run.core.messages[1].content, 'completed while read was pending');
});

test('send binds to the selected session before asynchronous work starts', async () => {
  const runner = { isStreaming: () => false, runTurn: (run) => { run.streaming = true; } };
  const store = makeStore({}, runner);
  const started = [];
  runner.runTurn = (run) => { run.streaming = true; started.push(run.id); };
  const a = store.makeRun('a', { title: 'A' }), b = store.makeRun('b', { title: 'B' });
  store.runs.set('a', a); store.runs.set('b', b);
  store.current = 'a';
  const ctx = sendCtx(store, runner);
  ctx.sendText('belongs to A');
  ctx.S.current = 'b';
  await tick();
  assert.deepEqual(started, ['a']);
  assert.equal(a.core.messages[0].content, 'belongs to A');
  assert.equal(b.core.messages.length, 0);
});

test('rapid sends before session creation resolves share one session and one turn', async () => {
  let release, creates = 0, starts = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const desk = {
    sessionCreate: async () => { creates++; await gate; return { id: 'new-' + creates, data: { title: 'topic' } }; },
    sessionRead: async () => ({ title: 'topic' })
  };
  const store = makeStore(desk, {});
  const runner = {
    isStreaming: (id) => !!(store.runs.get(id) && store.runs.get(id).streaming),
    runTurn: (run) => { run.streaming = true; starts++; }
  };
  const ctx = sendCtx(store, runner);
  ctx.sendText('one'); ctx.sendText('two');
  release();
  await tick();
  assert.equal(creates, 1);
  assert.equal(starts, 1);
});

test('cache eviction retains unsaved conversation history', () => {
  const failed = { id: 'failed', persistenceError: new Error('disk full') };
  const idle = { id: 'idle' };
  const currentRun = { id: 'current' };
  const removed = [];
  const store = makeStore({}, { unregister: (id) => { removed.push(id); return true; } });
  store.runs.set(failed.id, failed);
  store.runs.set(idle.id, idle);
  store.runs.set(currentRun.id, currentRun);
  store.current = currentRun.id;
  store.RUNS_LIMIT = 2;
  store.evictIdleRuns();
  assert.ok(store.runs.get(failed.id) === failed, '保存失败的内存历史不得被驱逐');
  assert.deepEqual(removed, [idle.id]);
});
