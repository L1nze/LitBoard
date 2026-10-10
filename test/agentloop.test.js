'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/agentcore.js');
const Loop = require('../js/agentloop.js');

/** mock 依赖：chat 按脚本依次返回；记录调用轨迹 */
function makeHooks(script, overrides) {
  const calls = { chat: [], tools: [], persists: 0, events: [] };
  let step = 0;
  const hooks = Object.assign({
    core: Core,
    chat: async function (input) {
      calls.chat.push(input.body);
      const item = script[Math.min(step++, script.length - 1)];
      if (item instanceof Error) throw item;
      return typeof item === 'function' ? await item(calls) : item;
    },
    executeTool: async function (name, args) {
      calls.tools.push({ name: name, args: args });
      return '{"mock":true}';
    },
    buildBody: function (run) {
      return Core.buildRequestBody(run.core, { system: 'SYS', tools: [{ type: 'function', function: { name: 't' } }] });
    },
    persist: function (run) { calls.persists++; },
    emit: function (id, payload) { calls.events.push(payload); },
    cancelChat: function () { calls.cancelled = true; }
  }, overrides);
  return { hooks: hooks, calls: calls };
}

function makeRun() {
  const core = Core.initState();
  const doc = { v: 1, id: 'r1', title: 't', messages: core.messages, tokens: core.tokens, attachments: [] };
  const run = { id: 'r1', doc: doc, core: core, streaming: false, endReason: '' };
  return run;
}

const toolCall = (id, name, args) => ({ message: { content: '', tool_calls: [{ id: id, function: { name: name, arguments: JSON.stringify(args) } }] } });

test('each tool result commits before the next side effect and recovers pending image refs; invalid tool image refs never remove their committed result', async () => {
  const snapshots = [];
  const { hooks } = makeHooks([{ message: { content: '', tool_calls: [toolCall('a', 't', {}).message.tool_calls[0], toolCall('b', 't2', {}).message.tool_calls[0]] } }, { message: { content: 'done' } }]);
  hooks.persist = (run) => snapshots.push(JSON.parse(JSON.stringify({ messages: run.core.messages, streaming: run.doc.streaming, turnId: run.core.turnId })));
  hooks.executeTool = async (name) => {
    if (name === 't2') assert.ok(snapshots.at(-1).messages.some((m) => m.tool_call_id === 'a' && m.pendingImages));
    return name === 't' ? { text: 'saved', images: [{ type: 'image', ref: 'session:r1|附件/a.png' }] } : 'second';
  };
  const runner = Loop.createRunner(hooks), run = makeRun();
  Core.appendUser(run.core, 'go');
  await runner.runTurn(run);
  const interrupted = snapshots.find((snap) => snap.messages.some((m) => m.pendingImages));
  const restored = { id: 'r1', doc: interrupted, core: Core.deserialize(interrupted) };
  assert.equal(runner.restoreInterrupted(restored), true);
  assert.equal(restored.core.messages.filter((m) => m.tool_call_id === 'a').length, 1);
  assert.match(restored.core.messages.find((m) => m.tool_call_id === 'b').content, /未确认/);
  assert.equal(restored.core.messages.filter((m) => m.images).length, 1);
  assert.equal(restored.core.messages.some((m) => m.pendingImages), false);
  // invalid tool image refs never remove their committed result
  const { hooks: hooks2 } = makeHooks([toolCall('a', 't', {}), { message: { content: 'done' } }]);
  hooks2.executeTool = async () => ({ text: 'keep this', images: [{ type: 'image', ref: 'data:bad' }] });
  const run2 = makeRun();
  Core.appendUser(run2.core, 'go');
  await Loop.createRunner(hooks2).runTurn(run2);
  assert.equal(run2.core.messages.find((m) => m.tool_call_id === 'a').content, 'keep this');
});

test('cancel during overflow recovery persistence prevents another model request; cancel on the final allowed tool step takes priority over max_steps', async function () {
  const { hooks, calls } = makeHooks([
    new Error('prompt is too long: 90000 tokens > 8192 maximum'),
    { message: { content: 'must not request this answer' } }
  ]);
  hooks.context = require('../js/agentcontext.js');
  hooks.persist = function () {
    calls.persists++;
    if (calls.persists === 2) runner.cancel('r1');
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'go');
  assert.equal(await runner.runTurn(run), 'stopped');
  assert.equal(calls.chat.length, 1);
  // cancel on the final allowed tool step takes priority over max_steps
  const { hooks: hooks2 } = makeHooks([toolCall('c1', 't', {})]);
  hooks2.executeTool = async function () {
    runner2.cancel('r1');
    return 'late result';
  };
  const runner2 = Loop.createRunner(hooks2);
  const run2 = makeRun();
  run2.core.maxSteps = 1;
  Core.appendUser(run2.core, 'go');
  assert.equal(await runner2.runTurn(run2), 'stopped');
  assert.equal(run2.core.messages.filter((message) => message.role === 'tool').length, 1);
  assert.equal(run2.core.messages.some((message) => message.role === 'error'), false);
});

test('A01/A17: orchestration runs model → tools → model → final answer; A03: cancel during tool wait stops the loop and pads tool results', async function () {
  const { hooks, calls } = makeHooks([
    toolCall('c1', 'search_openalex', { query: 'battery' }),
    toolCall('c2', 'get_research_work', { workId: 'W1' }),
    { message: { content: '总结完毕' } }
  ]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, '调研电池');
  const endReason = await runner.runTurn(run);
  assert.equal(endReason, 'done');
  assert.equal(calls.chat.length, 3);        // 两次工具轮 + 最终回答
  assert.equal(calls.tools.length, 2);
  assert.equal(run.core.messages[run.core.messages.length - 1].content, '总结完毕');
  // 最后一条 assistant 消息带展示元数据（工具步骤）
  const lastToolCall = run.core.messages[3].toolCalls;
  assert.equal(lastToolCall[0].status, 'ok');
  // A03：工具等待期取消——停止循环并补占位工具结果
  const { hooks: hooks2, calls: calls2 } = makeHooks([
    toolCall('c1', 'slow_tool', {}),
    { message: { content: 'should not be reached' } }
  ]);
  // 工具执行期间触发取消
  hooks2.executeTool = async function () {
    runner2.cancel('r1');
    return 'late result';
  };
  const runner2 = Loop.createRunner(hooks2);
  const run2 = makeRun();
  Core.appendUser(run2.core, 'go');
  const endReason2 = await runner2.runTurn(run2);
  assert.equal(endReason2, 'stopped');
  assert.equal(calls2.chat.length, 1); // 取消后不再发起下一次模型请求
  // tool_calls 与 tool 消息仍配对（占位结果已补）
  const toolMsgs = run2.core.messages.filter(function (m) { return m.role === 'tool'; });
  assert.equal(toolMsgs.length, 1);
  assert.ok(toolMsgs[0].content.indexOf('已停止') !== -1 || toolMsgs[0].content === 'late result');
});

test('A03: cancel while waiting for the model keeps partial output and marks stopped; A05: partial (truncated stream) lands message plus retryable error card', async function () {
  let releaseChat = null;
  const { hooks, calls } = makeHooks([
    function () {
      return new Promise(function (resolve) {
        releaseChat = function () { resolve({ aborted: true, message: { role: 'assistant', content: '半截回答' } }); };
      });
    },
    { message: { content: 'never' } }
  ]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'go');
  const p = runner.runTurn(run);
  await new Promise(function (r) { setTimeout(r, 10); });
  runner.cancel('r1');
  if (releaseChat) releaseChat();
  const endReason = await p;
  assert.equal(endReason, 'stopped');
  assert.equal(calls.chat.length, 1);
  const last = run.core.messages[run.core.messages.length - 1];
  assert.equal(last.content, '半截回答'); // 半截输出保留
  // A05：partial（截断流）落部分消息 + 可重试错误卡，按轮重跑成功
  const { hooks: hooks2 } = makeHooks([
    { partial: true, message: { role: 'assistant', content: '截断的内容' }, errorText: '连接在回复结束前中断' },
    { message: { content: 'retry answer' } }
  ]);
  const runner2 = Loop.createRunner(hooks2);
  const run2 = makeRun();
  Core.appendUser(run2.core, 'q');
  const endReason2 = await runner2.runTurn(run2);
  assert.equal(endReason2, 'failed');
  const msgs = run2.core.messages;
  assert.equal(msgs[1].content, '截断的内容');       // 部分内容已落账
  assert.equal(msgs[2].role, 'error');
  assert.equal(msgs[2].retry, true);
  // 按轮重试：截断到 user，重跑成功
  const turnId = msgs[0].turnId;
  const end2 = await runner2.rerunTurn(run2, turnId);
  assert.equal(end2, 'done');
  assert.equal(run2.core.messages.length, 2);
  assert.equal(run2.core.messages[1].content, 'retry answer');
});

test('A06: stream deltas stay in memory and never touch the session document; turn persists only at event points (start / before tools / tool results / end)', async function () {
  const { hooks, calls } = makeHooks([{ message: { content: 'final' } }]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  runner.register(run);
  run.streaming = true; // 模拟流进行中
  runner.handleStreamEvent('r1', { type: 'delta', text: 'partial' });
  runner.handleStreamEvent('r1', { type: 'delta', text: ' more' });
  runner.handleStreamEvent('r1', { type: 'reasoning_delta', text: 'think' });
  // 缓冲只进内存（供实时渲染），文档不动、也不触发落盘
  assert.equal(run.streamText, 'partial more');
  assert.equal(run.streamReasoning, 'think');
  assert.equal(run.doc.streamText, undefined);
  assert.equal(run.doc.streamReasoning, undefined);
  assert.equal(calls.persists, 0);
  // 轮次只在事件点落盘
  const { hooks: hooks2, calls: calls2 } = makeHooks([
    toolCall('c1', 'search_openalex', { query: 'x' }),
    { message: { content: 'done' } }
  ]);
  const run2 = makeRun();
  let persistsWhileStreaming = 0;
  // 流式期间不应发生任何落盘
  const origChat = hooks2.chat;
  const runnerHooks = Object.assign({}, hooks2, {
    chat: async function (input) {
      run2.streaming = true;
      const r = await origChat(input);
      return r;
    },
    persist: function (target) {
      if (target.streaming && target.streamText) persistsWhileStreaming++;
      calls2.persists++;
    }
  });
  const runner2 = Loop.createRunner(runnerHooks);
  Core.appendUser(run2.core, 'q');
  await runner2.runTurn(run2);
  assert.equal(persistsWhileStreaming, 0);
  // 一次工具轮 = 开始 1 + 工具前 1 + 工具结果 1 + 收尾 1（+ 循环中的续跑判定不再落盘）
  assert.ok(calls2.persists <= 6, 'persists should be O(events), got ' + calls2.persists);
  assert.ok(calls2.persists >= 3, 'at least start/before-tools/tool-results/end, got ' + calls2.persists);
});

test('restoreInterrupted salvages only unfinished runs, dedupes committed text and resets buffers', function () {
  const cases = [
    { name: 'no prior messages', streaming: true, text: '崩溃前的半截回复', reasoning: '推理片段', restored: true, count: 2, assistantIndex: 0 },
    { name: 'finished run', streaming: false, text: '答案正文', restored: false, count: 0 },
    { name: 'already committed', user: true, committed: '完整答案', streaming: true, text: '完整答案', restored: true, count: 3, assistantIndex: 1 },
    { name: 'no salvageable text', user: true, streaming: true, text: '', restored: true, count: 2, errorText: '未完成' },
    { name: 'partial stream', user: true, streaming: true, text: '写到一半就断了', reasoning: '推理片段', restored: true, count: 3, assistantIndex: 1, retry: true }
  ];
  for (const scenario of cases) {
    const runner = Loop.createRunner(makeHooks([]).hooks);
    const run = makeRun();
    if (scenario.user) Core.appendUser(run.core, 'q');
    if (scenario.committed) Core.appendAssistant(run.core, { content: scenario.committed });
    run.doc.streaming = scenario.streaming;
    run.doc.streamText = scenario.text;
    run.doc.streamReasoning = scenario.reasoning || '';
    assert.equal(runner.restoreInterrupted(run), scenario.restored, scenario.name);
    assert.equal(run.core.messages.length, scenario.count, scenario.name);
    if (scenario.assistantIndex !== undefined) {
      const assistant = run.core.messages[scenario.assistantIndex];
      assert.equal(assistant.content, scenario.text, scenario.name);
      if (scenario.reasoning) assert.equal(assistant.reasoning, scenario.reasoning, scenario.name);
    }
    if (scenario.restored) {
      const error = run.core.messages.at(-1);
      assert.equal(error.role, 'error', scenario.name);
      assert.ok(error.content.includes(scenario.errorText || '中断'), scenario.name);
      if (scenario.retry) assert.equal(error.retry, true, scenario.name);
    }
    assert.equal(run.doc.streaming, false, scenario.name);
    assert.equal(run.doc.streamText, '', scenario.name);
    assert.equal(runner.restoreInterrupted(run), false, scenario.name + ': repeat restoration');
  }
});

test('A13: rerunTurn edits a specific user message and reruns only that turn', async function () {
  const { hooks, calls } = makeHooks([
    { message: { content: 'first answer' } },
    { message: { content: 'second answer' } },
    { message: { content: 'edited answer' } }
  ]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, '第一问');
  await runner.runTurn(run);
  Core.appendUser(run.core, '第二问');
  await runner.runTurn(run);
  assert.equal(calls.chat.length, 2);
  // 编辑第一问重发：第二问及其后被截掉
  const firstTurnId = run.core.messages[0].turnId;
  const end = await runner.rerunTurn(run, firstTurnId, '第一问（改）');
  assert.equal(end, 'done');
  assert.equal(calls.chat.length, 3);
  assert.equal(run.core.messages.length, 2);
  assert.equal(run.core.messages[0].content, '第一问（改）');
  assert.equal(run.core.messages[1].content, 'edited answer');
});

test('A13: max_steps termination adds explainer error note; summarize_paper extends the step budget only for its current turn', async function () {
  const { hooks } = makeHooks([
    toolCall('c1', 't', {}),
    toolCall('c2', 't', {}),
    toolCall('c3', 't', {})
  ]);
  const runner = Loop.createRunner(Object.assign({}, hooks, {
    buildBody: function (run) { return Core.buildRequestBody(run.core, {}); }
  }));
  const run = makeRun();
  run.core.maxSteps = 2;
  Core.appendUser(run.core, 'go');
  const endReason = await runner.runTurn(run);
  assert.equal(endReason, 'max_steps');
  const last = run.core.messages[run.core.messages.length - 1];
  assert.equal(last.role, 'error');
  assert.ok(last.content.indexOf('最大步数') !== -1);
  // summarize_paper 只为当前轮扩展步数预算
  const script = Array.from({ length: 14 }, (_, i) => toolCall('review-' + i, 'summarize_paper', { paperId: 'p1', from: i * 8 + 1 }));
  script.push({ message: { content: '全文梳理完成' } });
  const { hooks: hooks2, calls: calls2 } = makeHooks(script);
  const runner2 = Loop.createRunner(hooks2);
  const run2 = makeRun();
  run2.core.maxSteps = 2;
  Core.appendUser(run2.core, '梳理整篇文献');
  assert.equal(await runner2.runTurn(run2), 'done');
  assert.equal(calls2.tools.length, 14);
  assert.equal(run2.core.maxSteps, 2);
});

test('run_end event carries endReason; runTurn marks doc.streaming and clears buffers; R04: persist 在事件点被 await（工具执行前 assistant 已落盘）', async function () {
  const { hooks, calls } = makeHooks([{ message: { content: 'done' } }]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  await runner.runTurn(run);
  const endEvent = calls.events.filter(function (e) { return e.type === 'run_end'; })[0];
  assert.equal(endEvent.endReason, 'done');
  // runTurn 运行期间标记 doc.streaming，模型返回后清缓冲
  const { hooks: hooks2 } = makeHooks([{ message: { content: 'final' } }]);
  let streamingSeenDuringRun = null;
  const origPersist = hooks2.persist;
  const runner2 = Loop.createRunner(Object.assign({}, hooks2, {
    persist: function (run) {
      if (run.streaming) streamingSeenDuringRun = run.doc.streaming;
      origPersist(run);
    }
  }));
  const run2 = makeRun();
  Core.appendUser(run2.core, 'q');
  await runner2.runTurn(run2);
  assert.equal(streamingSeenDuringRun, true);   // 运行期间标记为真
  assert.equal(run2.doc.streaming, false);       // 收尾后复位
  assert.equal(run2.doc.streamText, '');         // 缓冲已清
  // R04：persist 在事件点被 await——工具执行前 assistant 必须已完成落盘
  const order = [];
  const { hooks: hooks3 } = makeHooks([
    toolCall('c1', 't', {}),
    { message: { content: 'done!' } }
  ], {
    persist: function (run) {
      const tag = run.core.messages.filter(function (m) { return m.role === 'assistant'; }).length + 'a/' +
        run.core.messages.filter(function (m) { return m.role === 'tool'; }).length + 't';
      return new Promise(function (resolve) {
        setTimeout(function () { order.push('persisted:' + tag); resolve(); }, 1);
      });
    },
    executeTool: async function () { order.push('tool-ran'); return 'ok'; }
  });
  const runner3 = Loop.createRunner(hooks3);
  const run3 = makeRun();
  Core.appendUser(run3.core, 'q');
  assert.equal(await runner3.runTurn(run3), 'done');
  // 关键断言：带 assistant 消息的 checkpoint 完成先于工具执行
  assert.ok(order.indexOf('persisted:1a/0t') !== -1);
  assert.ok(order.indexOf('tool-ran') > order.indexOf('persisted:1a/0t'));
  assert.ok(order.indexOf('persisted:1a/1t') > order.indexOf('tool-ran'), '工具结果也要等下一次 checkpoint');
});

test('R02: rerunTurn 截断前把被移除历史存进 doc.editHistory（可恢复副本）', async function () {
  const script = [{ message: { content: 'a1' } }];
  const { hooks } = makeHooks(script);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'first');
  await runner.runTurn(run);
  script.push({ message: { content: 'a2' } });
  Core.appendUser(run.core, 'second');
  await runner.runTurn(run);
  const firstTurnId = run.core.messages[0].turnId;
  script.push({ message: { content: 'a1-edited' } });
  assert.equal(await runner.rerunTurn(run, firstTurnId, 'edited first'), 'done');
  // 会话主线上：第一轮被替换，第二轮整体让位
  assert.equal(run.core.messages.length, 2);
  assert.equal(run.core.messages[0].content, 'edited first');
  assert.equal(run.core.messages[1].content, 'a1-edited');
  // 被截掉的历史留有可恢复副本（不进模型上下文）
  const stash = run.doc.editHistory && run.doc.editHistory[firstTurnId];
  assert.ok(stash, 'editHistory 已登记');
  assert.equal(stash.messages.length, 4); // first + a1 + second + a2 全部进了副本
  assert.equal(stash.messages[0].content, 'first');
  assert.equal(stash.messages[1].content, 'a1');
  assert.equal(stash.messages[2].content, 'second');
  assert.equal(stash.messages[3].content, 'a2');
  assert.equal(Core.buildRequestBody(run.core, {}).messages.filter(function (m) { return m.role === 'user'; }).length, 1);
});

test('R11: 工具返回 {text, images} 时注入合成 user 消息，模型继续消费', async function () {
  const { hooks } = makeHooks([
    toolCall('c1', 'render_pdf_pages', { paperId: 'p1', pages: [3] }),
    { message: { content: '看到图了' } }
  ]);
  hooks.executeTool = async function () {
    return {
      text: '{"rendered":1,"pages":[3]}',
      images: [{ type: 'image', ref: 'session:s1|附件/page-3.png', label: '第 3 页' }]
    };
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, '讲讲第 3 页的图');
  assert.equal(await runner.runTurn(run), 'done');
  const roles = run.core.messages.map(function (m) { return m.role; });
  assert.deepEqual(roles, ['user', 'assistant', 'tool', 'user', 'assistant']);
  const synthetic = run.core.messages[3];
  assert.equal(synthetic.synthetic, true);
  assert.equal(synthetic.images.length, 1);
  assert.equal(synthetic.images[0].ref, 'session:s1|附件/page-3.png');
  assert.ok(synthetic.content.indexOf('第 3 页') !== -1);
  assert.equal(run.core.messages[4].content, '看到图了', '合成消息后模型继续应答');
});

test('R08/R03: rerunTurn 恢复原轮冻结上下文；waitIdle 等当前轮收尾', async function () {
  const { hooks } = makeHooks([{ message: { content: 'a1' } }]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  run.doc.turnMeta = {};
  Core.appendUser(run.core, 'first');
  run.frozen = { model: 'modelA', thinking: 'high', paper: { id: 'p1' } };
  run.doc.turnMeta[run.core.turnId] = run.frozen;
  await runner.runTurn(run);
  const firstTurnId = run.core.messages[0].turnId;
  // 模拟「重启后重试」：frozen 丢失，靠 rerunTurn 从 turnMeta 恢复
  run.frozen = null;
  assert.equal(await runner.rerunTurn(run, firstTurnId), 'done');
  assert.ok(run.frozen, 'frozen 从 turnMeta 恢复');
  assert.equal(run.frozen.model, 'modelA');
  assert.equal(run.doc.turnMeta[run.core.turnId].model, 'modelA', '新 turnId 重新登记了原上下文');
  assert.notEqual(run.core.turnId, firstTurnId);

  // waitIdle：非流式立即真；流式中取消后等收尾
  assert.equal(await runner.waitIdle('r1', 100), true);
  const slowHooks = makeHooks([function () {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve({ message: { content: 'slow' } }); }, 30);
    });
  }]);
  const slowRunner = Loop.createRunner(slowHooks);
  const run2 = makeRun();
  run2.id = 'r2';
  Core.appendUser(run2.core, 'slow q');
  const p = slowRunner.runTurn(run2);
  assert.equal(slowRunner.isStreaming('r2'), true, '流式中');
  assert.equal(slowRunner.cancel('r2'), true);
  assert.equal(await slowRunner.waitIdle('r2', 2000), true, '取消后 waitIdle 等到轮收尾');
  await p;
});

/* ---------------- R17：上下文压缩钩子 / 溢出减半重试 / 用量回喂 ---------------- */
const Context = require('../js/agentcontext.js');

test('R17: maybeCompact 在每次模型请求前被 await（压缩后重建请求体）；端点报上下文超长 → 预算减半重建请求体重试一次，成功后继续', async function () {
  let compacted = 0;
  const seen = [];
  const { hooks } = makeHooks([{ message: { content: '答' } }]);
  hooks.maybeCompact = async function (run) {
    compacted++;
    // 模拟压缩：把第一条 user 消息标记 + 插入摘要（真实路径由 agentui 走 LitAgentContext）
    run.core.messages[0].compacted = true;
    run.core.messages.splice(1, 0, { role: 'user', content: '[上下文摘要｜1 条历史已压缩为下文，原文保留在会话存档]\n结论：用户在问电池', synthetic: true, kind: 'compaction', turnId: 't1' });
  };
  hooks.buildBody = function (run) { const b = Core.buildRequestBody(run.core, {}); seen.push(b); return b; };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, '调研电池');
  await runner.runTurn(run);
  assert.equal(compacted, 1);
  assert.equal(run.endReason, 'done');
  // 请求体里：被压缩的原提问不在，摘要在
  const sent = seen[0].messages.map((m) => String(m.content || '')).join('\n');
  assert.ok(sent.indexOf('调研电池') === -1, '被压缩消息不进请求');
  assert.ok(sent.indexOf('上下文摘要') !== -1, '摘要进入请求');
  // 端点报上下文超长 → 预算减半重建请求体重试一次，成功后继续
  const seen2 = [];
  const { hooks: hooks2, calls: calls2 } = makeHooks([
    new Error('AI 服务返回 HTTP 400：{"error":{"code":"context_length_exceeded","message":"This model\'s maximum context length is 8192 tokens"}}'),
    { message: { content: '减半后的回答' } }
  ]);
  hooks2.context = Context;
  hooks2.buildBody = function (run) {
    const budget = Number(run.forceContextTokens) > 0 ? Number(run.forceContextTokens) : 256000;
    run.appliedContextTokens = budget;
    seen2.push(budget);
    return Core.buildRequestBody(run.core, { system: 'SYS', maxContextTokens: budget });
  };
  const runner2 = Loop.createRunner(hooks2);
  const run2 = makeRun();
  Core.appendUser(run2.core, '问');
  const endReason2 = await runner2.runTurn(run2);
  assert.equal(endReason2, 'done');
  assert.equal(calls2.chat.length, 2, '重试了一次');
  assert.deepEqual(seen2, [256000, 128000], '第二次请求用减半预算');
  assert.ok(run2.core.messages.some((m) => m.role === 'error' && String(m.content).indexOf('上下文超出模型限制') === 0), '插入可见的错误卡说明发生了什么');
  assert.equal(run2.core.messages[run2.core.messages.length - 1].content, '减半后的回答');
});

test('R17: 溢出重试仍失败 → 如实失败，不无限重试；未注入 context 时不重试；usage.prompt_tokens 回喂 state.lastInputTokens（跨 serialize 持久化）', async function () {
  const overflow = () => new Error('AI 服务返回 HTTP 400：prompt is too long: 90000 tokens > 8192 maximum');
  const a = makeHooks([overflow(), overflow(), { message: { content: 'x' } }]);
  a.hooks.context = Context;
  a.hooks.buildBody = function (run) {
    const budget = Number(run.forceContextTokens) > 0 ? Number(run.forceContextTokens) : 256000;
    run.appliedContextTokens = budget;
    return Core.buildRequestBody(run.core, { system: 'SYS', maxContextTokens: budget });
  };
  const runnerA = Loop.createRunner(a.hooks);
  const runA = makeRun();
  Core.appendUser(runA.core, '问');
  const reasonA = await runnerA.runTurn(runA);
  assert.equal(reasonA, 'failed');
  assert.equal(a.calls.chat.length, 2, '只重试一次');

  const b = makeHooks([overflow()]);
  const runnerB = Loop.createRunner(b.hooks); // 未注入 context：保持旧行为，直接失败
  const runB = makeRun();
  Core.appendUser(runB.core, '问');
  const reasonB = await runnerB.runTurn(runB);
  assert.equal(reasonB, 'failed');
  assert.equal(b.calls.chat.length, 1, '无 context 模块时不重试');
  // 端点回报 usage.prompt_tokens 回喂 state.lastInputTokens
  const { hooks: hooks2 } = makeHooks([{ message: { content: '答' }, usage: { prompt_tokens: 54321, completion_tokens: 77 } }]);
  const runner2 = Loop.createRunner(hooks2);
  const run2 = makeRun();
  Core.appendUser(run2.core, '问');
  await runner2.runTurn(run2);
  assert.equal(run2.core.lastInputTokens, 54321);
  const restored = Core.deserialize(JSON.parse(JSON.stringify(Core.serialize(run2.core))));
  assert.equal(restored.lastInputTokens, 54321);
});

test('输出上限自救：端点报 max_tokens 超上限 → 按报文给出的上限降额重试一次；上限不低于当前下发值时不重试', async function () {
  const seen = [];
  const { hooks, calls } = makeHooks([
    new Error('AI 服务返回 HTTP 400: {"error":{"message":"ZCode: [1210][max_tokens参数非法：限制数值范围[1,131072]]","type":"invalid_request_error"}}'),
    { message: { content: '降额后的回答' } }
  ]);
  hooks.context = Context;
  hooks.buildBody = function (run) {
    const out = Number(run.forceMaxOutputTokens) > 0 ? Number(run.forceMaxOutputTokens) : 200000;
    seen.push(out);
    return Core.buildRequestBody(run.core, { system: 'SYS', maxOutputTokens: out });
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, '问');
  const end = await runner.runTurn(run);
  assert.equal(end, 'done');
  assert.equal(calls.chat.length, 2, '重试了一次');
  assert.deepEqual(seen, [200000, 131072], '第二次请求用端点报文给出的上限');
  assert.ok(run.core.messages.some((m) => m.role === 'error' && String(m.content).indexOf('单次回复上限超过') === 0), '插入可见的错误卡说明发生了什么');
  assert.equal(run.core.messages[run.core.messages.length - 1].content, '降额后的回答');

  // 报文上限（131072）不低于当前下发值（12800）→ 不是「设大了」的问题，不重试，如实失败
  const low = makeHooks([new Error("Invalid 'max_tokens': must be less than or equal to 131072")]);
  low.hooks.context = Context;
  low.hooks.buildBody = function (run) {
    return Core.buildRequestBody(run.core, { system: 'SYS', maxOutputTokens: 12800 });
  };
  const runLow = makeRun();
  Core.appendUser(runLow.core, '问');
  const reasonLow = await Loop.createRunner(low.hooks).runTurn(runLow);
  assert.equal(reasonLow, 'failed');
  assert.equal(low.calls.chat.length, 1, '上限不低于当前下发值时不重试');
});

/* ---------------- A-followup #1：压缩摘要不得抢占重试/编辑重发的目标 ---------------- */

test('A-followup #1: 压缩后重试当前轮，重跑的是真实提问而不是上下文摘要；retryLast 跳过合成 user 消息（工具注入截图），定位到真实提问', async function () {
  const script = [{ message: { content: 'a1' } }, { message: { content: 'a2' } }];
  const { hooks, calls } = makeHooks(script);
  // 真实压缩路径（LitAgentContext.applyCompaction）：摘要带 synthetic + kind=compaction
  hooks.maybeCompact = async function (run) {
    if (run.core.messages.length < 3) return; // 只在「已有历史 + 当前提问」时压缩
    const plan = {
      boundaryIndex: 2, droppedCount: 2, headTokens: 100,
      headMessages: run.core.messages.slice(0, 2)
    };
    Context.applyCompaction(run.core, plan, 'SUMMARY：用户在问电池', { estimate: () => 10 });
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'old question');
  await runner.runTurn(run);
  script.push({ message: { content: 'a2-answer' } });
  Core.appendUser(run.core, 'CURRENT QUESTION');
  await runner.runTurn(run);

  const currentTurn = run.core.messages[run.core.messages.length - 1].turnId;
  // 摘要发生在当前轮请求前，但必须使用独立身份；旧实现复用当前 turnId，重试会命中摘要。
  const summary = run.core.messages.filter((m) => m.kind === 'compaction')[0];
  assert.ok(summary, '压缩确实发生');
  assert.equal(summary.synthetic, true);
  assert.notEqual(summary.turnId, currentTurn, '摘要不占用业务轮次 ID');

  script.push({ message: { content: 'rerun-answer' } });
  assert.equal(await runner.rerunTurn(run, currentTurn), 'done');
  const rerunBody = calls.chat[calls.chat.length - 1];
  // 旧实现会定位到摘要（同 turnId 且更靠前），于是截断点落在摘要处、重跑的问题变成摘要——
  // 请求体里根本不会出现 CURRENT QUESTION。断言最后一条 user 消息就是真实提问。
  const lastUser = rerunBody.messages.filter((m) => m.role === 'user').pop();
  assert.equal(String(lastUser.content), 'CURRENT QUESTION', '重跑的输入是当前提问，不是摘要');
  // retryLast 跳过合成 user 消息（工具注入截图），定位到真实提问
  const { hooks: hooks2 } = makeHooks([toolCall('c1', 'render_pdf_pages', {}), { message: { content: '看完了' } }, { message: { content: '重跑答案' } }]);
  hooks2.executeTool = async function () {
    return { text: '{"rendered":1}', images: [{ type: 'image', ref: 'session:s1|a.png', label: '第 3 页' }] };
  };
  const runner2 = Loop.createRunner(hooks2);
  const run2 = makeRun();
  Core.appendUser(run2.core, 'REAL QUESTION');
  await runner2.runTurn(run2);
  const synthetic = run2.core.messages.filter((m) => m.role === 'user' && m.synthetic === true);
  assert.equal(synthetic.length, 1, '截图合成消息确实存在（且是最后一条 user）');
  assert.equal(run2.core.messages[run2.core.messages.length - 1].role, 'assistant');
  assert.equal(await runner2.retryLast(run2), 'done');
  const userMsgs = run2.core.messages.filter((m) => m.role === 'user');
  assert.equal(userMsgs.length, 1);
  assert.equal(userMsgs[0].content, 'REAL QUESTION');
});

test('修回复核: 重试已压缩旧轮时恢复该轮之前的原始上下文', async function () {
  const { hooks, calls } = makeHooks([{ message: { content: 'rerun answer' } }]);
  const builtBodies = [];
  hooks.buildBody = function (run) {
    const body = Core.buildRequestBody(run.core, {});
    builtBodies.push(body);
    return body;
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'Q1 IMPORTANT CONTEXT');
  const q1 = run.core.turnId;
  Core.appendAssistant(run.core, { content: 'A1' });
  Core.appendUser(run.core, 'Q2 DEPENDS ON Q1');
  const q2 = run.core.turnId;
  Core.appendAssistant(run.core, { content: 'A2' });
  Core.appendUser(run.core, 'Q3');
  Core.appendAssistant(run.core, { content: 'A3' });
  Context.applyCompaction(run.core, {
    boundaryIndex: 4, droppedCount: 4, headTokens: 100,
    headMessages: run.core.messages.slice(0, 4)
  }, 'SUMMARY OF Q1 AND Q2', { estimate: () => 10 });
  assert.equal(run.core.messages.filter((m) => m.turnId === q1)[0].compacted, true);
  assert.equal(run.core.messages.filter((m) => m.turnId === q2)[0].compacted, true);

  assert.equal(await runner.rerunTurn(run, q2), 'done');
  assert.equal(calls.chat.length, 1, '重试只发起一次模型请求');
  const built = builtBodies[0];
  const sent = built.messages.map((m) => String(m.content || '')).join('\n');
  assert.match(sent, /Q1 IMPORTANT CONTEXT/, '目标轮之前的原始背景重新进入请求');
  assert.match(sent, /Q2 DEPENDS ON Q1/, '重试目标仍是原问题');
  assert.doesNotMatch(sent, /SUMMARY OF Q1 AND Q2/, '覆盖目标轮的旧摘要不重复进入请求');
});

test('checkpoint failures stop at start, before tools, after results and at final save', async () => {
  const twoTools = { message: { content: '', tool_calls: [
    toolCall('a', 'write', {}).message.tool_calls[0], toolCall('b', 'write2', {}).message.tool_calls[0]
  ] } };
  const cases = [
    { name: 'start', failAt: 1, script: [{ message: { content: 'no' } }], chats: 0, tools: 0 },
    { name: 'before tools', failAt: 2, script: [toolCall('a', 'write', {})], chats: 1, tools: 0, unexecuted: 'a' },
    { name: 'after result', failAt: 3, script: [twoTools], chats: 1, tools: 1, completed: 'a', unexecuted: 'b' },
    { name: 'final save', failAt: 2, throws: true, script: [{ message: { content: 'answer' } }], chats: 1, tools: 0 }
  ];
  for (const scenario of cases) {
    let saves = 0;
    const { hooks, calls } = makeHooks(scenario.script, { persist: async () => {
      if (++saves !== scenario.failAt) return true;
      if (scenario.throws) throw new Error('disk full');
      return null;
    } });
    const run = makeRun();
    Core.appendUser(run.core, 'go');
    assert.equal(await Loop.createRunner(hooks).runTurn(run), 'failed', scenario.name);
    assert.equal(calls.chat.length, scenario.chats, scenario.name);
    assert.equal(calls.tools.length, scenario.tools, scenario.name);
    assert.equal(run.streaming, false, scenario.name);
    assert.equal(run.doc.streaming, false, scenario.name);
    assert.equal(calls.events.at(-1).endReason, 'failed', scenario.name);
    if (scenario.unexecuted) {
      assert.match(run.core.messages.find(m => m.tool_call_id === scenario.unexecuted).content, /未执行/, scenario.name);
    }
    if (scenario.completed) {
      assert.equal(run.core.messages.filter(m => m.tool_call_id === scenario.completed).length, 1, scenario.name);
    }
  }
});

test('request retry resumes after saved tools without replaying side effects (incl. reloaded sessions); partial request retry keeps prior tools and pairs partial calls as unexecuted', async () => {
  const { hooks, calls } = makeHooks([toolCall('a', 'write', {}), new Error('HTTP 503'), { message: { content: 'continued' } }]);
  const runner = Loop.createRunner(hooks), run = makeRun(); Core.appendUser(run.core, 'go');
  const turnId = run.core.turnId;
  assert.equal(await runner.runTurn(run), 'failed');
  const restored = { id: run.id, doc: structuredClone(run.doc), core: Core.deserialize(Core.serialize(run.core)), streaming: false };
  restored.doc.requestResume = structuredClone(run.doc.requestResume);
  assert.equal(await runner.retryTurn(restored, turnId), 'done'); assert.equal(calls.tools.length, 1);
  assert.equal(restored.core.messages.filter(m => m.role === 'user' && !m.synthetic).length, 1);
  assert.equal(restored.core.messages.filter(m => m.tool_call_id === 'a').length, 1);
  // partial request retry keeps prior tools and pairs partial calls as unexecuted
  const { hooks: hooks2, calls: calls2 } = makeHooks([toolCall('a', 'write', {}), { partial: true, message: { content: 'partial', tool_calls: toolCall('b', 'write2', {}).message.tool_calls }, errorText: 'network lost' }, { message: { content: 'continue' } }]);
  const runner2 = Loop.createRunner(hooks2), run2 = makeRun(); Core.appendUser(run2.core, 'go');
  assert.equal(await runner2.runTurn(run2), 'failed');
  assert.match(run2.core.messages.find(m => m.tool_call_id === 'b').content, /未执行/);
  assert.equal(await runner2.retryLast(run2), 'done'); assert.equal(calls2.tools.length, 1);
  assert.ok(calls2.chat.at(-1).messages.some(m => String(m.content).includes('已完成的工具结果仍有效')));
});

test('queued steering persists and enters the request only after all tools are paired; queue submitted during a final response is consumed before the run finishes', async () => {
  const { hooks, calls } = makeHooks([{ message: { content: '', tool_calls: [toolCall('a', 't', {}).message.tool_calls[0], toolCall('b', 't2', {}).message.tool_calls[0]] } }, { message: { content: 'done' } }]);
  let runner; const run = makeRun(); Core.appendUser(run.core, 'go');
  hooks.executeTool = async name => { if (name === 't') await runner.enqueue(run.id, 'focus on 2024'); return name; };
  runner = Loop.createRunner(hooks);
  assert.equal(await runner.runTurn(run), 'done');
  const steering = run.core.messages.findIndex(m => m.kind === 'steering');
  assert.ok(steering > run.core.messages.findIndex(m => m.tool_call_id === 'b'));
  assert.ok(calls.chat.at(-1).messages.some(m => String(m.content).includes('focus on 2024')));
  assert.equal(run.doc.queuedInputs.length, 0);
  // queue submitted during a final response is consumed before the run finishes
  const { hooks: hooks2, calls: calls2 } = makeHooks([async () => { await runner2.enqueue('r1', 'also include caveats'); return { message: { content: 'first answer' } }; }, { message: { content: 'caveats' } }]);
  const runner2 = Loop.createRunner(hooks2), run2 = makeRun(); Core.appendUser(run2.core, 'go');
  assert.equal(await runner2.runTurn(run2), 'done'); assert.equal(calls2.chat.length, 2);
  assert.equal(run2.core.messages.filter(m => m.kind === 'steering').length, 1);
});

test('parallel local readers commit the fast result while slow reader is still active; parallel persistence failure prevents further local reads and every write barrier', async () => {
  const calls = ['slow', 'fast', 'last'].map((name, i) => toolCall('parallel-' + i, name, {}).message.tool_calls[0]);
  const snapshots = []; let releaseSlow, fastSaved;
  const slowGate = new Promise(resolve => { releaseSlow = resolve; }), fastCheckpoint = new Promise(resolve => { fastSaved = resolve; });
  const { hooks } = makeHooks([{ message: { content: '', tool_calls: calls } }, { message: { content: 'done' } }]);
  hooks.canParallel = () => true;
  hooks.executeTool = async name => { if (name === 'slow') await slowGate; return name; };
  hooks.persist = async run => { snapshots.push(structuredClone(run.core.messages)); if (run.core.messages.some(m => m.tool_call_id === 'parallel-1')) fastSaved(); return true; };
  const run = makeRun(); Core.appendUser(run.core, 'go'); const runner = Loop.createRunner(hooks), running = runner.runTurn(run);
  await fastCheckpoint;
  assert.equal(run.streaming, true); assert.equal(snapshots.at(-1).some(m => m.tool_call_id === 'parallel-0'), false);
  releaseSlow(); assert.equal(await running, 'done');
  for (const call of calls) assert.equal(run.core.messages.filter(m => m.tool_call_id === call.id).length, 1);
  // parallel persistence failure prevents further local reads and every write barrier
  const toolCalls = ['read1', 'read2', 'read3', 'read4', 'write'].map((name, i) => toolCall('failure-' + i, name, {}).message.tool_calls[0]);
  const started = []; let saveCount = 0, cancellations = 0;
  const { hooks: hooks2 } = makeHooks([{ message: { content: '', tool_calls: toolCalls } }]);
  hooks2.canParallel = call => call.name !== 'write'; hooks2.cancelTools = async () => { cancellations++; };
  hooks2.executeTool = async name => { started.push(name); return name; };
  hooks2.persist = async () => ++saveCount === 3 ? null : true;
  const run2 = makeRun(); Core.appendUser(run2.core, 'go');
  assert.equal(await Loop.createRunner(hooks2).runTurn(run2), 'failed');
  assert.equal(started.includes('write'), false); assert.equal(started.includes('read4'), false); assert.equal(cancellations, 1);
  for (const call of toolCalls) assert.equal(run2.core.messages.filter(m => m.tool_call_id === call.id).length, 1);
});

test('image result checkpoint failure followed by successful final save retains images for resumed requests; canceled model result retains complete unexecuted tool pairing', async () => {
  let saves = 0;
  const { hooks, calls } = makeHooks([toolCall('image', 'image_reader', {}), { message: { content: 'continued' } }]);
  hooks.executeTool = async () => ({ text: 'page attached', images: [{ type: 'image', ref: 'session:r1|附件/page.png' }] });
  hooks.persist = async () => ++saves === 3 ? null : true;
  hooks.buildBody = run => Core.buildRequestBody(run.core, { sendImages: true });
  const runner = Loop.createRunner(hooks), run = makeRun(); Core.appendUser(run.core, 'go');
  assert.equal(await runner.runTurn(run), 'failed');
  assert.equal(run.core.messages.some(m => m.pendingImages), false); assert.equal(run.core.messages.filter(m => m.images).length, 1);
  const restored = { id: run.id, doc: structuredClone(run.doc), core: Core.deserialize(Core.serialize(run.core)), streaming: false };
  assert.equal(await runner.retryLast(restored), 'done');
  assert.ok(calls.chat.at(-1).messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image')));
  // canceled model result retains complete unexecuted tool pairing
  const { hooks: hooks2 } = makeHooks([{ aborted: true, message: { content: 'partial text', tool_calls: toolCall('not-run', 'write', {}).message.tool_calls } }]);
  const run2 = makeRun(); Core.appendUser(run2.core, 'go');
  assert.equal(await Loop.createRunner(hooks2).runTurn(run2), 'stopped');
  assert.match(run2.core.messages.find(m => m.tool_call_id === 'not-run').content, /未执行/);
});

test('queued steering inputs are drained into the turn and broadcast queue_changed immediately', async () => {
  const { hooks, calls } = makeHooks([{ message: { content: 'done' } }]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  run.doc.queuedInputs = [{ text: '再详细些', queuedAt: new Date().toISOString() }];
  Core.appendUser(run.core, 'go');
  assert.equal(await runner.runTurn(run), 'done');
  assert.equal(run.doc.queuedInputs.length, 0);
  assert.ok(run.core.messages.some((m) => m.role === 'user' && m.kind === 'steering' && m.content.includes('再详细些')));
  // 队列被消费的瞬间就广播：渲染层的「已排队 n 条」不能等下一个流式增量才消失
  assert.ok(calls.events.some((e) => e.type === 'queue_changed' && e.count === 0));
});

test('畸形工具参数（流式截断的坏 JSON）转为错误工具结果回喂模型重新发起，不让整轮失败', async () => {
  const badCall = { id: 'bad1', type: 'function', function: { name: 'search_library', arguments: '{"query": "pinn' } };
  const { hooks, calls } = makeHooks([
    { message: { content: '我先查一下', tool_calls: [badCall, toolCall('ok1', 'search_library', { query: 'x' }).message.tool_calls[0]] } },
    toolCall('retry1', 'search_library', { query: 'pinn' }),
    { message: { content: '查到了' } }
  ]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'go');
  const end = await runner.runTurn(run);
  assert.equal(end, 'done');
  // 坏参数调用获得 error 工具结果（协议配对完整），好调用照常执行
  const badResult = run.core.messages.find((m) => m.tool_call_id === 'bad1');
  assert.ok(badResult, '坏参数调用有配对的 tool 消息');
  assert.equal(badResult.error, true);
  assert.match(badResult.content, /JSON/);
  assert.equal(calls.tools.map((t) => t.name).join(','), 'search_library,search_library');
  // 第二次模型请求带着坏调用的错误结果（模型据此重新发起）
  assert.ok(calls.chat[1].messages.some((m) => m.role === 'tool' && m.tool_call_id === 'bad1'));
  // 全部坏参数时同样回喂后继续（模型重新发起而不是整轮失败）
  const { hooks: hooks2 } = makeHooks([
    { message: { content: '', tool_calls: [{ id: 'bad2', type: 'function', function: { name: 't', arguments: 'not json at all' } }] } },
    { message: { content: '改用文字回答' } }
  ]);
  const run2 = makeRun();
  Core.appendUser(run2.core, 'q');
  assert.equal(await Loop.createRunner(hooks2).runTurn(run2), 'done');
  assert.equal(run2.core.messages.find((m) => m.tool_call_id === 'bad2').error, true);
});

test('停止时带畸形参数的调用同样补「已停止」占位，半截内容保留且整轮按 stopped 收尾', async () => {
  const badCall = { id: 'bad1', type: 'function', function: { name: 'write', arguments: '{"q": ' } };
  const { hooks } = makeHooks([{ aborted: true, message: { content: '半截回答', tool_calls: [badCall] } }]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'go');
  const end = await runner.runTurn(run);
  assert.equal(end, 'stopped');
  const messages = run.core.messages;
  assert.equal(messages[messages.length - 2].content, '半截回答', '半截输出保留');
  assert.match(messages.find((m) => m.tool_call_id === 'bad1').content, /已停止/);
});

test('步数将尽注入收尾提示：模型据此给最终回答（done）；无视提示继续调工具时硬顶照常兜底', async () => {
  // maxSteps=3：两轮工具后 steps=2 触发提示注入，第三轮模型收尾作答
  const { hooks, calls } = makeHooks([
    toolCall('c1', 't', { n: 1 }),
    toolCall('c2', 't', { n: 2 }),
    { message: { content: '基于以上结果，阶段性总结如下' } }
  ]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  run.core.maxSteps = 3;
  Core.appendUser(run.core, 'go');
  assert.equal(await runner.runTurn(run), 'done');
  const notice = run.core.messages.find((m) => m.kind === 'step_notice');
  assert.ok(notice, '注入了收尾提示');
  assert.equal(notice.synthetic, true);
  // 第三次请求携带提示（模型看到的是「不要再用工具，给最终回答」）
  assert.ok(calls.chat[2].messages.some((m) => String(m.content || '').indexOf('步数即将用尽') !== -1));
  assert.equal(run.core.messages.some((m) => m.role === 'error'), false, '体面收尾没有错误卡');
  // 模型无视提示继续发起工具：到顶后按 max_steps 停止（硬顶兜底不变）
  const { hooks: hooks2 } = makeHooks([toolCall('k1', 't', { n: 1 }), toolCall('k2', 't', { n: 2 }), toolCall('k3', 't', { n: 3 })]);
  const run2 = makeRun();
  run2.core.maxSteps = 3;
  Core.appendUser(run2.core, 'go');
  assert.equal(await Loop.createRunner(hooks2).runTurn(run2), 'max_steps');
  assert.ok(run2.core.messages.some((m) => m.role === 'error' && String(m.content).indexOf('最大步数') !== -1));
  assert.equal(run2.core.messages.filter((m) => m.kind === 'step_notice').length, 1, '单轮只提示一次');
});

test('model return clears all three stream buffers so the live bubble drops the stale tool card', async () => {
  const holder = {};
  const { hooks } = makeHooks([
    async function () {
      holder.runner.handleStreamEvent('r1', { type: 'tool_call', name: 'search_openalex' });
      holder.duringStream = holder.run.streamToolName;
      return toolCall('c1', 'search_openalex', {});
    },
    async function () {
      holder.atSecondRequest = holder.run.streamToolName; // 下一次模型请求开始时必须已清空
      return { message: { content: 'done' } };
    }
  ]);
  const runner = Loop.createRunner(hooks);
  holder.runner = runner;
  const run = makeRun();
  holder.run = run;
  Core.appendUser(run.core, 'go');
  assert.equal(await runner.runTurn(run), 'done');
  assert.equal(holder.duringStream, 'search_openalex');
  assert.equal(holder.atSecondRequest, '');
});
