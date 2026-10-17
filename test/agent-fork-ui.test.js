'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/agentcore.js');
const Sessions = require('../js/agentsessions.js');
const Snapshot = require('../js/agentsnapshot.js');

const source = fs.readFileSync(path.join(__dirname, '../js/agentui.js'), 'utf8');

/* forkSession（含 persistRun/openSession）住在 js/agentsessions.js，convertRun 在
 * js/agentsnapshot.js——两者直接用真模块；bridge() 仍在 agentui.js，切片注入。 */
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
  const desk = {
    sessionFork: async (id, input) => { calls.push(['fork', id, input.messageIndex, input.title]); return { id: 'branch' }; },
    sessionCommit: async () => { calls.push(['persist', true]); return opts.saveFailed ? null : { ok: true }; },
    sessionRead: async (id) => { calls.push(['open', id]); return { title: 'Conversation（分支）', messages: [] }; },
    sessionList: async () => { calls.push(['list']); return []; }
  };
  const store = Sessions.createSessionStore({
    desk: desk, T: (s) => s,
    $: () => ({ appendChild() {}, classList: { toggle() {} } }),
    el: () => ({ appendChild() {} }),
    deps: {}, core: Core, runner: () => ({}),
    isUploadBusy: () => false, isCompactBusy: () => !!opts.compactBusy,
    setStatus() {}, renderAttachments() {}, renderChips() {}, renderMode() {}, bump() {},
    toastText: (s) => calls.push(['toast', s]), toastError() {}
  });
  store.runs.set(run.id, run);
  store.current = run.id;

  const context = {
    S: store, Snapshot: Snapshot, runner: {},
    T: (s) => s, toastText: (s) => calls.push(['toast', s]), setStatus() {}, bump() {},
    getSnapshot() {}, fillComposerSlot() {}, parkComposerControls() {}, sendText() {},
    subscriber: null, setTimeout() {}, compactBusy: !!opts.compactBusy, steeringEnabled: true
  };
  const bridgeStart = source.indexOf('  function bridge()');
  vm.runInNewContext(source.slice(bridgeStart, source.indexOf('  /* ---------------- 上下文 chips', bridgeStart)), context);
  context.convertRun = Snapshot.convertRun;
  return { context, calls, run, bridge: context.bridge() };
}

test('消息分叉桥按展示 ID 找到原始历史下标，先提交再打开独立会话', async () => {
  const h = harness();
  await h.bridge.onFork({ messageId: 't:a3' });
  assert.deepEqual(h.calls, [
    ['persist', true], ['fork', 'original', 2, 'Conversation（分支）'], ['open', 'branch'], ['list']
  ]);
  assert.equal(h.context.S.forkBusy, false);
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
    assert.equal(h.context.S.forkBusy, false);
  }
});

test('流式期间 live 气泡整轮保持挂载：缓冲清空的间隙以「…」占位，不再中途消失', () => {
  const h = harness({ streaming: true });
  h.run.core.turnId = 't';
  h.run.streamText = '';
  h.run.streamReasoning = '';
  h.run.streamToolName = '';
  const out = Snapshot.convertRun(h.run);
  const live = out[out.length - 1];
  assert.equal(live.id, 't:live');
  assert.equal(live.status.type, 'running');
  assert.equal(live.content.length, 1);
  assert.equal(live.content[0].type, 'text');
  assert.equal(live.content[0].text, '…');
  // 工具执行间隙（只有工具名、尚无文本）：工具卡占位而不是整个气泡消失
  h.run.streamToolName = 'search_openalex';
  assert.equal(Snapshot.convertRun(h.run).at(-1).content.some((p) => p.type === 'tool-call' && p.toolName === 'search_openalex'), true);
  // 正常流式：显示已到达的增量文本
  h.run.streamToolName = '';
  h.run.streamText = '部分回答';
  assert.equal(Snapshot.convertRun(h.run).at(-1).content.some((p) => p.type === 'text' && p.text === '部分回答'), true);
  // 轮结束（streaming=false）：live 气泡卸载，正式消息仍在
  h.run.streaming = false;
  assert.equal(Snapshot.convertRun(h.run).some((m) => m.id === 't:live'), false);
});
