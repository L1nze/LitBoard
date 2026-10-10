'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('窗口裁剪：预算按组只扣一次且保最新真人与截图 / 条数上限不拆最新工具轮、不丢其真实提问 / 微压缩按真实协议字段计预算', () => {
  { // budget trimming subtracts each group once and preserves the latest real question with images
    const messages = Array.from({ length: 5 }, (_, index) => ({ role: 'user', content: 'x'.repeat(3000), turnId: 't' + index }));
    messages.push({ role: 'user', content: 'screenshot', synthetic: true });
    const kept = Core.trimWindowToBudget(messages, 1000);
    assert.equal(kept.length, 2);
    assert.equal(kept[0].turnId, 't4');
    const state = Core.initState();
    state.messages = messages;
    const body = Core.buildRequestBody(state, { maxContextTokens: 4500, maxOutputTokens: 3500 });
    assert.equal(body.messages.filter((m) => m.role === 'user').length, 2);
  }
  { // message count cap never splits the latest long tool turn or drops its real user question
    const state = Core.initState();
    Core.appendUser(state, 'old');
    Core.appendAssistant(state, { content: 'old answer' });
    Core.appendUser(state, 'latest real question');
    for (let i = 0; i < 45; i++) {
      Core.appendAssistant(state, { tool_calls: [{ id: 'c' + i, function: { name: 'read', arguments: '{}' } }] });
      Core.appendToolResults(state, [{ callId: 'c' + i, result: 'evidence' }]);
    }
    state.messages.push({ role: 'user', content: 'screenshot', synthetic: true });
    const body = Core.buildRequestBody(state, { historyMessageCap: 40 });
    assert.equal(body.messages[0].content, 'latest real question');
    assert.equal(body.messages.length, 92);
    assert.equal(body.messages.filter((m) => m.role === 'tool').length, 45);
  }
  { // request micro compaction budgets actual protocol fields even with duplicated tool card results
    const Context = require('../js/agentcontext.js');
    const state = Core.initState();
    Core.appendUser(state, 'latest question');
    Core.appendAssistant(state, { tool_calls: [{ id: 'c', function: { name: 'read_pdf_pages', arguments: '{}' } }] });
    Core.decorateToolCalls(state, [{ callId: 'c', name: 'read_pdf_pages' }]);
    Core.appendToolResults(state, [{ callId: 'c', name: 'read_pdf_pages', result: '正文'.repeat(5000) }]);
    const stored = JSON.stringify(state.messages);
    assert.ok(state.messages[1].toolCalls[0].result.length > 9000);
    assert.ok(Core.estimateMessageTokens(state.messages[1]) < 100);
    const body = Core.buildRequestBody(state, { maxContextTokens: 1500, maxOutputTokens: 300, compactToolView: Context.compactToolView });
    assert.equal(body.messages[0].content, 'latest question');
    assert.equal(body.messages[2].tool_call_id, 'c');
    assert.ok(body.messages[2].content.length < 5000);
    assert.ok(body.messages.reduce((sum, msg) => sum + Core.estimateMessageTokens(msg), 0) <= 1200);
    assert.equal(JSON.stringify(state.messages), stored);
  }
});
const Core = require('../js/agentcore.js');

test('parseToolArgs handles plain, double-encoded and broken JSON', function () {
  assert.deepEqual(Core.parseToolArgs('{"q":"电池"}'), { q: '电池' });
  assert.deepEqual(Core.parseToolArgs('"{\\"q\\":\\"电池\\"}"'), { q: '电池' }); // DashScope 双重编码
  assert.deepEqual(Core.parseToolArgs(''), {});
  assert.deepEqual(Core.parseToolArgs(null), {});
  assert.deepEqual(Core.parseToolArgs({ q: 1 }), { q: 1 });
  assert.throws(function () { Core.parseToolArgs('not json'); }, function (e) {
    return e.code === 'BAD_TOOL_ARGS';
  });
});

test('A01: full agentic loop keeps going after tool results until final answer; maxSteps guard fires after results are consumed; stuck detection fires on repeated identical tool call', function () {
  { // full agentic loop keeps going after tool results until final answer
    let state = Core.initState();
    Core.appendUser(state, '找文献并总结');
    Core.appendAssistant(state, {
      content: '',
      tool_calls: [{ id: 'c1', function: { name: 'search_openalex', arguments: '{"query":"battery"}' } }]
    }, { prompt_tokens: 10, completion_tokens: 5 });
    assert.equal(state.steps, 1);
    assert.equal(state.tokens.in, 10);
    let pending = Core.pendingToolCalls(state);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].name, 'search_openalex');

    // 工具结果落账后必须回到模型（A01：旧的 pendingToolCalls 判定在这里误返回 done）
    Core.decorateToolCalls(state, [{ callId: 'c1', name: 'search_openalex', args: pending[0].args }]);
    Core.appendToolResults(state, [{ callId: 'c1', name: 'search_openalex', result: '{"works":[1]}' }]);
    let verdict = Core.shouldContinue(state);
    assert.deepEqual(verdict, { continue: true, reason: '' });

    // 模型再次调用工具 → 再执行 → 再落账 → 仍继续
    Core.appendAssistant(state, {
      content: '',
      tool_calls: [{ id: 'c2', function: { name: 'get_research_work', arguments: '{"workId":"W1"}' } }]
    });
    verdict = Core.shouldContinue(state);
    assert.equal(verdict.reason, 'pending_tools'); // 结果未落账前不允许直接请求模型
    Core.appendToolResults(state, [{ callId: 'c2', name: 'get_research_work', result: '{"title":"T"}' }]);
    verdict = Core.shouldContinue(state);
    assert.deepEqual(verdict, { continue: true, reason: '' });

    // 模型给出最终回答 → done
    Core.appendAssistant(state, { content: '总结：……' });
    verdict = Core.shouldContinue(state);
    assert.deepEqual(verdict, { continue: false, reason: 'done' });
  }
  // maxSteps guard：原用例以 return 提前收束，包一层函数保持「命中即止」语义
  const maxStepsGuard = function () {
    const state = Core.initState({ maxSteps: 2 });
    Core.appendUser(state, 'go');
    for (let round = 0; round < 3; round++) {
      Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c' + round, function: { name: 't', arguments: '{"n":' + round + '}' } }] });
      Core.appendToolResults(state, [{ callId: 'c' + round, name: 't', result: 'ok' }]);
      const verdict = Core.shouldContinue(state);
      if (round >= 1) {
        assert.equal(verdict.continue, false);
        assert.equal(verdict.reason, 'max_steps');
        return;
      }
      assert.equal(verdict.continue, true);
    }
    assert.fail('should have stopped');
  };
  maxStepsGuard();
  { // stuck detection fires on repeated identical tool call (after results)
    const state = Core.initState();
    Core.appendUser(state, 'go');
    for (let i = 0; i < 2; i++) {
      Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c' + i, function: { name: 'same', arguments: '{"x":1}' } }] });
      Core.appendToolResults(state, [{ callId: 'c' + i, name: 'same', result: 'nope' }]);
      const verdict = Core.shouldContinue(state);
      if (i === 1) {
        assert.equal(verdict.continue, false);
        assert.equal(verdict.reason, 'stuck');
        return;
      }
      assert.equal(verdict.continue, true);
    }
  }
});

test('A13: beginTurn resets per-turn budgets; tokens keep accumulating', function () {
  const state = Core.initState({ maxSteps: 1 });
  Core.appendUser(state, '第一轮');
  Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] }, { prompt_tokens: 10 });
  Core.appendToolResults(state, [{ callId: 'c1', name: 't', result: 'ok' }]);
  assert.equal(Core.shouldContinue(state).reason, 'max_steps'); // 第 1 轮步数已用完
  // 第二轮提问：预算清零，用量累计
  Core.appendUser(state, '第二轮');
  assert.equal(state.steps, 0);
  assert.deepEqual(state.recentToolSignatures, []);
  assert.equal(state.tokens.in, 10);
  const firstTurnId = state.messages[0].turnId;
  assert.notEqual(state.messages[3].turnId, firstTurnId); // 新 turnId
});

test('A04: orphan tool messages at window head are dropped; trimWindowToBudget drops whole oldest groups, never splits a turn', function () {
  { // orphan tool messages at window head are dropped
    const state = Core.initState({ historyMessageCap: 3 });
    state.messages.push({ role: 'user', content: 'u1', turnId: 't1' });
    state.messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'gone', type: 'function', function: { name: 't', arguments: '{}' } }], turnId: 't1' });
    state.messages.push({ role: 'tool', tool_call_id: 'gone', name: 't', content: 'r', turnId: 't1' });
    state.messages.push({ role: 'user', content: 'u2', turnId: 't2' });
    state.messages.push({ role: 'assistant', content: 'final', turnId: 't2' });
    const body = Core.buildRequestBody(state, { system: 'SYS' });
    const roles = body.messages.map(function (m) { return m.role; });
    // 窗口 cap=3 → [tool(gone), user, assistant]；头部孤儿 tool 必须被丢弃，窗口以 user 开头
    assert.deepEqual(roles, ['system', 'user', 'assistant']);
    assert.ok(body.messages.some(function (m) { return m.role === 'user' && m.content === 'u2'; }));
  }
  { // trimWindowToBudget drops whole oldest groups, never splits a turn
    const big = 'x'.repeat(9000); // ~2250 tokens each
    const msgs = [
      { role: 'user', content: big, turnId: 't1' },
      { role: 'assistant', content: big, turnId: 't1' },
      { role: 'user', content: big, turnId: 't2' },
      { role: 'assistant', content: big, turnId: 't2' },
      { role: 'user', content: 'latest question', turnId: 't3' },
      { role: 'assistant', content: 'ok', turnId: 't3' }
    ];
    const out = Core.trimWindowToBudget(msgs, 5000); // 预算只够最近两组
    assert.equal(out[0].turnId, 't2'); // 最旧一组整体丢弃
    assert.equal(out.length, 4);
    assert.equal(Core.trimWindowToBudget(msgs, 0).length, 6); // 0=不裁剪
  }
});

test('A02: reasoning content is stored on assistant messages but never replayed', function () {
  const state = Core.initState();
  Core.appendUser(state, 'think hard');
  Core.appendAssistant(state, { content: '答', reasoning_content: '思考过程……', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] });
  const msg = state.messages[1];
  assert.equal(msg.reasoning, '思考过程……');
  Core.appendToolResults(state, [{ callId: 'c1', name: 't', result: 'ok' }]);
  Core.appendAssistant(state, { content: 'done', reasoning: '也支持 reasoning 字段' });
  const body = Core.buildRequestBody(state, {});
  body.messages.forEach(function (m) {
    assert.equal(m.reasoning, undefined, 'reasoning must not be sent to the endpoint');
    assert.equal(m.reasoning_content, undefined, 'reasoning must not be sent to the endpoint');
  });
});

test('appendToolResults truncates long output to cap', function () {
  const state = Core.initState({ toolOutputCap: 1000 });
  Core.appendUser(state, 'go');
  Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] });
  Core.appendToolResults(state, [{ callId: 'c1', name: 't', result: 'x'.repeat(5000) }]);
  const toolMsg = state.messages.filter(function (m) { return m.role === 'tool'; })[0];
  assert.ok(toolMsg.content.length < 1100);
  assert.ok(toolMsg.content.indexOf('已截断') !== -1);
});

test('buildRequestBody：组装窗口、工具配对一致、丢弃错误卡；修复窗口边缘的悬挂 tool_calls', function () {
  { // assembles window, keeps tool pairing consistent, drops error cards
    const state = Core.initState({ historyMessageCap: 8 });
    Core.appendUser(state, 'u1');
    state.messages.push({ role: 'error', content: 'boom' });
    Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] });
    Core.appendToolResults(state, [{ callId: 'c1', name: 't', result: 'ok' }]);
    Core.appendAssistant(state, { content: 'final answer' });
    const body = Core.buildRequestBody(state, { system: 'SYS', model: 'm1', tools: [{ type: 'function', function: { name: 't' } }] });
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, 'SYS');
    assert.equal(body.model, 'm1');
    assert.equal(body.stream, true);
    assert.equal(body.tools.length, 1);
    const roles = body.messages.map(function (m) { return m.role; });
    assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant']);
    assert.ok(!body.messages.some(function (m) { return m.role === 'error'; }));
  }
  { // repairs dangling tool_calls at window edge
    const state = Core.initState({ historyMessageCap: 3 });
    // 造一个窗口截断后 assistant(tool_calls) 在、对应 tool 消息不在的序列
    state.messages.push({ role: 'user', content: 'old' });
    state.messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'gone', type: 'function', function: { name: 't', arguments: '{}' } }] });
    state.messages.push({ role: 'user', content: 'new' });
    const body = Core.buildRequestBody(state, {});
    const assistant = body.messages.filter(function (m) { return m.role === 'assistant'; })[0];
    assert.ok(assistant);
    assert.equal(assistant.tool_calls, undefined); // 悬挂调用被摘除，避免端点报 400
  }
});

test('serialize/deserialize round-trips state；estimateTokens 对中文加权更重', function () {
  { // serialize/deserialize round-trips state
    let state = Core.initState();
    Core.appendUser(state, 'hi');
    Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] });
    Core.appendToolResults(state, [{ callId: 'c1', name: 't', result: 'ok' }]);
    const restored = Core.deserialize(JSON.parse(JSON.stringify(Core.serialize(state))), { maxSteps: 5 });
    assert.equal(restored.messages.length, 3);
    assert.equal(restored.steps, 1);
    assert.deepEqual(restored.tokens, { in: 0, out: 0 });
    assert.equal(Core.pendingToolCalls(restored).length, 0);
  }
  { // estimateTokens weights CJK heavier
    assert.ok(Core.estimateTokens('电池电池电池') > Core.estimateTokens('abcdefgh'));
  }
});

test('R01: replayReasoning 开启时回放 assistant 消息带 reasoning_content；默认不带', function () {
  const state = Core.initState();
  Core.appendUser(state, 'q');
  Core.appendAssistant(state, { content: '', reasoning_content: '思考链', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] });
  Core.appendToolResults(state, [{ callId: 'c1', name: 't', result: 'ok' }]);
  const withReplay = Core.buildRequestBody(state, { replayReasoning: true });
  const replayed = withReplay.messages.filter(function (m) { return m.role === 'assistant'; })[0];
  assert.equal(replayed.reasoning_content, '思考链');
  const without = Core.buildRequestBody(state, {});
  const plain = without.messages.filter(function (m) { return m.role === 'assistant'; })[0];
  assert.equal(plain.reasoning_content, undefined);
});

test('M9-5: appendUser 接受 {text, images}；引用原样保存、data: URL 拒收；sendImages 才发 parts', function () {
  const state = Core.initState();
  Core.appendUser(state, { text: '看这张图', images: [
    { type: 'image', ref: 'session:s1|附件/fig1.png', label: 'fig1' },
    { type: 'image', ref: 'data:image/png;base64,AAAA' }, // 内联 base64 不入存储
    { type: 'image' },                                     // 无 ref 拒收
    'junk'
  ] });
  const msg = state.messages[0];
  assert.equal(msg.content, '看这张图');
  assert.equal(msg.images.length, 1);
  assert.equal(msg.images[0].ref, 'session:s1|附件/fig1.png');
  const partsBody = Core.buildRequestBody(state, { sendImages: true });
  const userMsg = partsBody.messages.filter(function (m) { return m.role === 'user'; })[0];
  assert.deepEqual(userMsg.content, [
    { type: 'text', text: '看这张图' },
    { type: 'image', ref: 'session:s1|附件/fig1.png', label: 'fig1' }
  ]);
  const textBody = Core.buildRequestBody(state, {});
  assert.equal(textBody.messages.filter(function (m) { return m.role === 'user'; })[0].content, '看这张图');
  // 纯字符串调用行为不变（向后兼容）
  const s2 = Core.initState();
  Core.appendUser(s2, 'plain');
  assert.equal(s2.messages[0].content, 'plain');
  assert.equal(s2.messages[0].images, undefined);
});

test('R11: 图像只在尾部轮发送——旧轮的图像引用退回纯文本（token 成本闸）；shouldContinue 把合成截图消息按 tool 阶段处理（模型必须消费）', function () {
  { // 图像只在尾部轮发送——旧轮的图像引用退回纯文本（token 成本闸）
    const state = Core.initState();
    Core.appendUser(state, { text: '第一问', images: [{ type: 'image', ref: 'session:s1|old.png', label: '旧图' }] });
    Core.appendAssistant(state, { content: '第一答' });
    Core.appendUser(state, { text: '第二问', images: [{ type: 'image', ref: 'session:s1|new.png', label: '新图' }] });
    Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c9', function: { name: 'render_pdf_pages', arguments: '{}' } }] });
    Core.appendToolResults(state, [{ callId: 'c9', name: 'render_pdf_pages', result: 'rendered' }]);
    // 工具注入的合成消息（属于第二问的轮）
    state.messages.push({ role: 'user', content: '[已附加页面截图]', images: [{ type: 'image', ref: 'session:s1|tool.png' }], synthetic: true, turnId: state.turnId });
    const body = Core.buildRequestBody(state, { sendImages: true });
    const users = body.messages.filter(function (m) { return m.role === 'user'; });
    assert.equal(users.length, 3);
    assert.equal(typeof users[0].content, 'string', '旧轮图像不再以 parts 发出');
    assert.ok(Array.isArray(users[1].content), '尾部轮的真人消息以 parts 发出');
    assert.deepEqual(users[1].content[1], { type: 'image', ref: 'session:s1|new.png', label: '新图' });
    assert.ok(Array.isArray(users[2].content), '合成消息与真人消息同轮，图像发出');
    // 关闭 sendImages：全部退回纯文本
    const plain = Core.buildRequestBody(state, {});
    assert.ok(plain.messages.filter(function (m) { return m.role === 'user'; }).every(function (m) {
      return typeof m.content === 'string';
    }));
  }
  { // shouldContinue 把合成截图消息按 tool 阶段处理（模型必须消费）
    const state = Core.initState();
    Core.appendUser(state, 'q');
    Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c1', function: { name: 'render_pdf_pages', arguments: '{}' } }] });
    Core.appendToolResults(state, [{ callId: 'c1', name: 'render_pdf_pages', result: 'r' }]);
    state.messages.push({ role: 'user', content: '[截图]', images: [], synthetic: true, turnId: state.turnId });
    assert.deepEqual(Core.shouldContinue(state), { continue: true, reason: '' });
  }
});

test('输出预算：默认值上下文 256000 / 单轮输出 12800（设置留空即此；唯一权威在 agentcore）；maxOutputTokens 落成 body.max_tokens、不传则不下发（沿用端点默认）', function () {
  assert.equal(Core.DEFAULTS.contextTokens, 256000);
  assert.equal(Core.DEFAULTS.maxOutputTokens, 12800);
  const state = Core.initState();
  Core.appendUser(state, '你好');
  assert.equal(Core.buildRequestBody(state, {}).max_tokens, undefined);
  assert.equal(Core.buildRequestBody(state, { maxOutputTokens: 0 }).max_tokens, undefined);
  assert.equal(Core.buildRequestBody(state, { maxOutputTokens: 12800 }).max_tokens, 12800);
  assert.equal(Core.buildRequestBody(state, { maxOutputTokens: '32000' }).max_tokens, 32000);
  // 非整数（手输 12800.7）取整，避免端点拒收
  assert.equal(Core.buildRequestBody(state, { maxOutputTokens: 12800.7 }).max_tokens, 12800);
});

test('maxContextTokens：系统提示与工具 schema 也占预算，先扣再裁消息窗口；budget 下限兜底——预算极小（小于系统提示开销）也留得住最新一轮', function () {
  { // maxContextTokens：系统提示与工具 schema 也占预算，先扣再裁消息窗口
    const unit = 'x'.repeat(4000); // ~1000 token
    const state = Core.initState({ historyMessageCap: 40 });
    Core.appendUser(state, unit);           // 组 1（最旧）
    Core.appendAssistant(state, { content: unit });
    Core.appendUser(state, unit);           // 组 2
    Core.appendAssistant(state, { content: unit });
    Core.appendUser(state, 'latest');       // 组 3（最新）
    Core.appendAssistant(state, { content: 'ok' });
    // 预算 3000 token、无系统提示/工具：装得下最近两组 → 最旧整组丢弃
    const tight = Core.buildRequestBody(state, { maxContextTokens: 3000 });
    assert.deepEqual(tight.messages.map(function (m) { return m.role; }), ['user', 'assistant', 'user', 'assistant']);
    assert.equal(tight.messages[0].content, unit);   // 第二组还在
    assert.equal(tight.messages[2].content, 'latest');
    // 同样的预算，但系统提示 + 工具 schema 吃掉 2200 token → 只剩最近一组
    const withOverhead = Core.buildRequestBody(state, {
      maxContextTokens: 3000,
      system: 'y'.repeat(8800),
      tools: [{ type: 'function', function: { name: 't', description: 'z'.repeat(400) } }]
    });
    assert.deepEqual(withOverhead.messages.map(function (m) { return m.role; }), ['system', 'user', 'assistant']);
    assert.equal(withOverhead.messages[1].content, 'latest');
  }
  { // budget 下限兜底：预算极小（小于系统提示开销）也留得住最新一轮
    const state = Core.initState();
    Core.appendUser(state, 'q');
    Core.appendAssistant(state, { content: 'a' });
    const body = Core.buildRequestBody(state, { maxContextTokens: 100, system: 'y'.repeat(40000) });
    assert.deepEqual(body.messages.map(function (m) { return m.role; }), ['system', 'user', 'assistant']);
  }
});

test('条数窗口：historyCapFor 随上下文预算放大（下限仍是 40 条、上限 400）；historyMessageCap 选项按次生效（不改 state，供按设置换算的调用方使用）', function () {
  assert.equal(Core.historyCapFor(256000), 256);
  assert.equal(Core.historyCapFor(128000), 128);
  assert.equal(Core.historyCapFor(24000), 40);   // 小预算维持旧窗口
  assert.equal(Core.historyCapFor(0), 256);      // 0 = 用默认值
  assert.equal(Core.historyCapFor(undefined), 256);
  assert.equal(Core.historyCapFor(99999999), 400); // 上限 400 条
  // historyMessageCap 选项按次生效（不改 state，供按设置换算的调用方使用）
  const state = Core.initState({ historyMessageCap: 2 });
  Core.appendUser(state, 'u1');
  Core.appendAssistant(state, { content: 'a1' });
  Core.appendUser(state, 'u2');
  Core.appendAssistant(state, { content: 'a2' });
  assert.equal(Core.buildRequestBody(state, {}).messages.length, 2);
  assert.equal(Core.buildRequestBody(state, { historyMessageCap: 4 }).messages.length, 4);
});


test('current context uses request schemas, reasoning and images, not cumulative billing; estimated endpoint usage cannot masquerade as a provider calibration', () => {
  { // current context uses request schemas, reasoning and images, not cumulative billing
    const state = Core.initState(); state.tokens = { in: 700000, out: 14000 };
    const plain = { messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }], tools: [{ type: 'function', function: { name: 'a', description: 'x'.repeat(2000) } }] };
    const full = structuredClone(plain); full.messages.push({ role: 'assistant', content: 'answer', reasoning_content: 'r'.repeat(4000) }, { role: 'user', content: [{ type: 'text', text: 'page' }, { type: 'image', ref: 'session:s|附件/a.png' }] });
    assert.ok(Core.currentInputTokens(state, full) > Core.currentInputTokens(state, plain) + 2500);
    assert.ok(Core.currentInputTokens(state, full) < 10000);
    Core.recordInputUsage(state, { prompt_tokens: 4000 }, plain);
    const growth = Core.estimateRequestTokens(full) - Core.estimateRequestTokens(plain);
    assert.equal(Core.currentInputTokens(state, full), 4000 + growth);
    assert.deepEqual(Core.deserialize(Core.serialize(state)).inputUsageBaseline, state.inputUsageBaseline);
  }
  { // estimated endpoint usage cannot masquerade as a provider calibration
    const state = Core.initState(); Core.recordInputUsage(state, { prompt_tokens: 9000, estimated: true }, { messages: [] });
    assert.equal(Core.currentInputTokens(state, { messages: [] }), 0);
  }
});
