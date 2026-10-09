'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/agentui.js'), 'utf8');

function harness(options) {
  const opts = options || {};
  const calls = [];
  const run = {
    id: 'original', doc: { title: 'Conversation' }, streaming: !!opts.streaming,
    core: { messages: [
      { role: 'user', turnId: 't', content: 'question' },
      { role: 'user', turnId: 't', synthetic: true, content: 'screenshot' },
      { role: 'assistant', turnId: 't', content: 'answer' },
      { role: 'user', kind: 'compaction', synthetic: true, content: 'summary' },
      { role: 'error', turnId: 't', content: 'error' }
    ] }
  };
  const context = {
    current: run.id, runs: new Map([[run.id, run]]), forkBusy: false, compactBusy: !!opts.compactBusy, uploadBusy: false,
    T: (s) => s, toastText: (s) => calls.push(['toast', s]),
    persistRun: async (_run, checkpoint) => { calls.push(['persist', checkpoint]); return opts.saveFailed ? null : { ok: true }; },
    desk: { sessionFork: async (id, input) => { calls.push(['fork', id, input.messageIndex, input.title]); return { id: 'branch' }; } },
    openSession: (id) => calls.push(['open', id]), loadSessions: () => calls.push(['list']),
    getSnapshot() {}, fillComposerSlot() {}, sendText() {}, turnIdAfterParent() {}, subscriber: null,
    setTimeout() {}, runner: {}
  };
  const forkStart = source.indexOf('  function forkSession(');
  const convertStart = source.indexOf('  function messageDisplayKey(');
  const bridgeStart = source.indexOf('  function bridge()');
  vm.runInNewContext(
    source.slice(forkStart, source.indexOf('  function renameSession(', forkStart)) +
    source.slice(convertStart, source.indexOf('  function getSnapshot()', convertStart)) +
    source.slice(bridgeStart, source.indexOf('  /* ---------------- 历史视图', bridgeStart)), context);
  return { context, calls, run, bridge: context.bridge() };
}

test('消息分叉桥按展示 ID 找到原始历史下标，先提交再打开独立会话', async () => {
  const h = harness();
  await h.bridge.onFork({ messageId: 't:a3' });
  assert.deepEqual(h.calls, [
    ['persist', true], ['fork', 'original', 2, 'Conversation（分支）'], ['open', 'branch'], ['list']
  ]);
  assert.equal(h.context.forkBusy, false);
  assert.equal(h.run.core.messages.length, 5);
});

test('合成消息、摘要、错误卡与无效 ID 不触发分叉', async () => {
  const h = harness();
  for (const message of h.context.convertRun(h.run)) {
    if (Number.isInteger(message.metadata.custom.forkIndex)) continue;
    await h.bridge.onFork({ messageId: message.id });
  }
  await h.bridge.onFork({ messageId: 'missing' });
  assert.deepEqual(h.calls, []);
});

test('生成、压缩或保存失败不创建分支', async () => {
  for (const options of [{ streaming: true }, { compactBusy: true }, { saveFailed: true }]) {
    const h = harness(options);
    await h.bridge.onFork({ messageId: 't:u1' });
    assert.equal(h.calls.some((call) => call[0] === 'fork'), false);
    assert.equal(h.calls.some((call) => call[0] === 'toast'), true);
    assert.equal(h.context.forkBusy, false);
  }
});
