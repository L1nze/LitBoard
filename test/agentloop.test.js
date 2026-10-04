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

test('cancel during overflow recovery persistence prevents another model request', async function () {
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
});

test('cancel on the final allowed tool step takes priority over max_steps', async function () {
  const { hooks } = makeHooks([toolCall('c1', 't', {})]);
  hooks.executeTool = async function () {
    runner.cancel('r1');
    return 'late result';
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  run.core.maxSteps = 1;
  Core.appendUser(run.core, 'go');
  assert.equal(await runner.runTurn(run), 'stopped');
  assert.equal(run.core.messages.filter((message) => message.role === 'tool').length, 1);
  assert.equal(run.core.messages.some((message) => message.role === 'error'), false);
});

test('A01/A17: orchestration runs model → tools → model → final answer', async function () {
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
});

test('A03: cancel during tool wait stops the loop and pads tool results', async function () {
  const { hooks, calls } = makeHooks([
    toolCall('c1', 'slow_tool', {}),
    { message: { content: 'should not be reached' } }
  ]);
  // 工具执行期间触发取消
  hooks.executeTool = async function () {
    runner.cancel('r1');
    return 'late result';
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'go');
  const endReason = await runner.runTurn(run);
  assert.equal(endReason, 'stopped');
  assert.equal(calls.chat.length, 1); // 取消后不再发起下一次模型请求
  // tool_calls 与 tool 消息仍配对（占位结果已补）
  const toolMsgs = run.core.messages.filter(function (m) { return m.role === 'tool'; });
  assert.equal(toolMsgs.length, 1);
  assert.ok(toolMsgs[0].content.indexOf('已停止') !== -1 || toolMsgs[0].content === 'late result');
});

test('A03: cancel while waiting for the model keeps partial output and marks stopped', async function () {
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
});

test('A05: partial (truncated stream) lands message plus retryable error card', async function () {
  const { hooks } = makeHooks([
    { partial: true, message: { role: 'assistant', content: '截断的内容' }, errorText: '连接在回复结束前中断' },
    { message: { content: 'retry answer' } }
  ]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  const endReason = await runner.runTurn(run);
  assert.equal(endReason, 'failed');
  const msgs = run.core.messages;
  assert.equal(msgs[1].content, '截断的内容');       // 部分内容已落账
  assert.equal(msgs[2].role, 'error');
  assert.equal(msgs[2].retry, true);
  // 按轮重试：截断到 user，重跑成功
  const turnId = msgs[0].turnId;
  const end2 = await runner.rerunTurn(run, turnId);
  assert.equal(end2, 'done');
  assert.equal(run.core.messages.length, 2);
  assert.equal(run.core.messages[1].content, 'retry answer');
});

test('A06: stream deltas stay in memory and never touch the session document', async function () {
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
});

test('A06: turn persists only at event points (start / before tools / tool results / end)', async function () {
  const { hooks, calls } = makeHooks([
    toolCall('c1', 'search_openalex', { query: 'x' }),
    { message: { content: 'done' } }
  ]);
  const run = makeRun();
  let persistsWhileStreaming = 0;
  // 流式期间不应发生任何落盘
  const origChat = hooks.chat;
  const runnerHooks = Object.assign({}, hooks, {
    chat: async function (input) {
      run.streaming = true;
      const r = await origChat(input);
      return r;
    },
    persist: function (target) {
      if (target.streaming && target.streamText) persistsWhileStreaming++;
      calls.persists++;
    }
  });
  const runner2 = Loop.createRunner(runnerHooks);
  Core.appendUser(run.core, 'q');
  await runner2.runTurn(run);
  assert.equal(persistsWhileStreaming, 0);
  // 一次工具轮 = 开始 1 + 工具前 1 + 工具结果 1 + 收尾 1（+ 循环中的续跑判定不再落盘）
  assert.ok(calls.persists <= 6, 'persists should be O(events), got ' + calls.persists);
  assert.ok(calls.persists >= 3, 'at least start/before-tools/tool-results/end, got ' + calls.persists);
});

test('A06: restoreInterrupted converts leftover stream buffer into interrupted turn', function () {
  const runner = Loop.createRunner(makeHooks([]).hooks);
  const run = makeRun();
  run.doc.streaming = true; // 上一次运行确实没收尾（新契约：中断以运行标记判定）
  run.doc.streamText = '崩溃前的半截回复';
  run.doc.streamReasoning = '推理片段';
  const restored = runner.restoreInterrupted(run);
  assert.equal(restored, true);
  const msgs = run.core.messages;
  assert.equal(msgs[0].content, '崩溃前的半截回复');
  assert.equal(msgs[0].reasoning, '推理片段');
  assert.equal(msgs[1].role, 'error');
  assert.ok(msgs[1].content.indexOf('中断') !== -1);
  assert.equal(run.doc.streamText, '');
  assert.equal(runner.restoreInterrupted(run), false); // 无缓冲时不再追加
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

test('A13: max_steps termination adds explainer error note', async function () {
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
});

test('summarize_paper extends the step budget only for its current turn', async function () {
  const script = Array.from({ length: 14 }, (_, i) => toolCall('review-' + i, 'summarize_paper', { paperId: 'p1', from: i * 8 + 1 }));
  script.push({ message: { content: '全文梳理完成' } });
  const { hooks, calls } = makeHooks(script);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  run.core.maxSteps = 2;
  Core.appendUser(run.core, '梳理整篇文献');
  assert.equal(await runner.runTurn(run), 'done');
  assert.equal(calls.tools.length, 14);
  assert.equal(run.core.maxSteps, 2);
});

test('run_end event carries endReason for the UI', async function () {
  const { hooks, calls } = makeHooks([{ message: { content: 'done' } }]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  await runner.runTurn(run);
  const endEvent = calls.events.filter(function (e) { return e.type === 'run_end'; })[0];
  assert.equal(endEvent.endReason, 'done');
});

test('restoreInterrupted ignores leftover buffer when the run actually finished (no false 中断卡)', function () {
  const runner = Loop.createRunner(makeHooks([]).hooks);
  const run = makeRun();
  // 正常收尾的运行：streaming 标记为 false，但缓冲可能因窗口期残留
  run.doc.streaming = false;
  run.doc.streamText = '答案正文';
  assert.equal(runner.restoreInterrupted(run), false);
  assert.equal(run.core.messages.length, 0);      // 不追加任何消息
  assert.equal(run.doc.streamText, '');           // 残留缓冲仍被清掉
});

test('restoreInterrupted does not duplicate content already committed as a message', function () {
  const runner = Loop.createRunner(makeHooks([]).hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  Core.appendAssistant(run.core, { content: '完整答案' });
  run.doc.streaming = true;                       // 真中断（例如落账后立即被杀）
  run.doc.streamText = '完整答案';                 // 缓冲与已落账内容相同
  assert.equal(runner.restoreInterrupted(run), true);
  assert.equal(run.core.messages.length, 3);      // 不追加重复的助手消息，只补一张中断卡
  assert.equal(run.core.messages[1].content, '完整答案');
  assert.equal(run.core.messages[2].role, 'error');
  assert.equal(run.doc.streaming, false);         // 标记已复位
});

test('restoreInterrupted still reports a genuine interruption with no salvageable text', function () {
  const runner = Loop.createRunner(makeHooks([]).hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  run.doc.streaming = true;   // 流式期间硬崩：缓冲从未落盘
  run.doc.streamText = '';
  assert.equal(runner.restoreInterrupted(run), true);
  assert.equal(run.core.messages.length, 2);
  assert.equal(run.core.messages[1].role, 'error');
  assert.ok(run.core.messages[1].content.indexOf('未完成') !== -1);
});

test('restoreInterrupted still recovers a genuinely interrupted partial stream', function () {
  const runner = Loop.createRunner(makeHooks([]).hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  run.doc.streaming = true;
  run.doc.streamText = '写到一半就断了';
  run.doc.streamReasoning = '推理片段';
  assert.equal(runner.restoreInterrupted(run), true);
  const msgs = run.core.messages;
  assert.equal(msgs[1].content, '写到一半就断了');
  assert.equal(msgs[1].reasoning, '推理片段');
  assert.equal(msgs[2].role, 'error');
  assert.equal(msgs[2].retry, true);
  assert.equal(run.doc.streaming, false);
  assert.equal(run.doc.streamText, '');
});

test('runTurn marks doc.streaming while running and clears buffers once the model returns', async function () {
  const { hooks } = makeHooks([{ message: { content: 'final' } }]);
  let streamingSeenDuringRun = null;
  const origPersist = hooks.persist;
  const runner = Loop.createRunner(Object.assign({}, hooks, {
    persist: function (run) {
      if (run.streaming) streamingSeenDuringRun = run.doc.streaming;
      origPersist(run);
    }
  }));
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  await runner.runTurn(run);
  assert.equal(streamingSeenDuringRun, true);   // 运行期间标记为真
  assert.equal(run.doc.streaming, false);       // 收尾后复位
  assert.equal(run.doc.streamText, '');         // 缓冲已清
});

test('R04: persist 在事件点被 await——工具执行前 assistant 必须已完成落盘', async function () {
  const order = [];
  const { hooks } = makeHooks([
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
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'q');
  assert.equal(await runner.runTurn(run), 'done');
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

test('R17: maybeCompact 在每次模型请求前被 await（压缩后重建请求体）', async function () {
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
});

test('R17: 端点报上下文超长 → 预算减半重建请求体重试一次，成功后继续', async function () {
  const seen = [];
  const { hooks, calls } = makeHooks([
    new Error('AI 服务返回 HTTP 400：{"error":{"code":"context_length_exceeded","message":"This model\'s maximum context length is 8192 tokens"}}'),
    { message: { content: '减半后的回答' } }
  ]);
  hooks.context = Context;
  hooks.buildBody = function (run) {
    const budget = Number(run.forceContextTokens) > 0 ? Number(run.forceContextTokens) : 256000;
    run.appliedContextTokens = budget;
    seen.push(budget);
    return Core.buildRequestBody(run.core, { system: 'SYS', maxContextTokens: budget });
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, '问');
  const endReason = await runner.runTurn(run);
  assert.equal(endReason, 'done');
  assert.equal(calls.chat.length, 2, '重试了一次');
  assert.deepEqual(seen, [256000, 128000], '第二次请求用减半预算');
  assert.ok(run.core.messages.some((m) => m.role === 'error' && String(m.content).indexOf('上下文超出模型限制') === 0), '插入可见的错误卡说明发生了什么');
  assert.equal(run.core.messages[run.core.messages.length - 1].content, '减半后的回答');
});

test('R17: 溢出重试仍失败 → 如实失败，不无限重试；未注入 context 时不重试', async function () {
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
});

test('R17: 端点回报 usage.prompt_tokens 回喂 state.lastInputTokens（跨 serialize 持久化）', async function () {
  const { hooks } = makeHooks([{ message: { content: '答' }, usage: { prompt_tokens: 54321, completion_tokens: 77 } }]);
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, '问');
  await runner.runTurn(run);
  assert.equal(run.core.lastInputTokens, 54321);
  const restored = Core.deserialize(JSON.parse(JSON.stringify(Core.serialize(run.core))));
  assert.equal(restored.lastInputTokens, 54321);
});

/* ---------------- A-followup #1：压缩摘要不得抢占重试/编辑重发的目标 ---------------- */

test('A-followup #1: 压缩后重试当前轮，重跑的是真实提问而不是上下文摘要', async function () {
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
});

test('A-followup #1: retryLast 跳过合成 user 消息（工具注入截图），定位到真实提问', async function () {
  const { hooks } = makeHooks([toolCall('c1', 'render_pdf_pages', {}), { message: { content: '看完了' } }, { message: { content: '重跑答案' } }]);
  hooks.executeTool = async function () {
    return { text: '{"rendered":1}', images: [{ type: 'image', ref: 'session:s1|a.png', label: '第 3 页' }] };
  };
  const runner = Loop.createRunner(hooks);
  const run = makeRun();
  Core.appendUser(run.core, 'REAL QUESTION');
  await runner.runTurn(run);
  const synthetic = run.core.messages.filter((m) => m.role === 'user' && m.synthetic === true);
  assert.equal(synthetic.length, 1, '截图合成消息确实存在（且是最后一条 user）');
  assert.equal(run.core.messages[run.core.messages.length - 1].role, 'assistant');
  assert.equal(await runner.retryLast(run), 'done');
  const userMsgs = run.core.messages.filter((m) => m.role === 'user');
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
