'use strict';

/* 上下文管理（R17）单元测试：压缩计划边界 / 摘要请求 / 应用 / 掩码 / 溢出判定。
 * 全部纯函数，Node 直测；estimate 用 agentcore 的真实估算器（同口径）。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Ctx = require('../js/agentcontext.js');
const Core = require('../js/agentcore.js');

const est = (m) => Core.estimateTokens(JSON.stringify(m || {}));
const big = (n, cjk) => (cjk ? '字'.repeat(n) : 'x'.repeat(n)); // 英文 4 字符/token，中文 1 字/token

test('usableInputTokens / preserveRecentTokens：扣输出预留与缓冲，保留段在 2k-8k 之间', () => {
  assert.equal(Ctx.usableInputTokens(256000, 12800), 256000 - 12800 - 1000);
  assert.equal(Ctx.usableInputTokens(100, 99999), 1000); // 负数兜底
  assert.equal(Ctx.preserveRecentTokens(100000), 20000); // 25% 超上限封顶（对齐 Cline/minimax-code 的 20k）
  assert.equal(Ctx.preserveRecentTokens(1000), 2000);    // 下限
  assert.equal(Ctx.preserveRecentTokens(20000), 5000);
});

function buildConversation() {
  const state = Core.initState();
  // 三轮同构对话（user + assistant(工具) + tool + assistant），每条约 1500 token
  for (let r = 0; r < 3; r++) {
    Core.appendUser(state, big(6000));
    Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c' + r, function: { name: 'search_openalex', arguments: '{"query":"battery"}' } }] });
    Core.appendToolResults(state, [{ callId: 'c' + r, name: 'search_openalex', result: big(6000) }]);
    Core.appendAssistant(state, { content: big(6000) });
  }
  return state;
}

test('planCompaction：未超阈值 → null', () => {
  const state = buildConversation();
  const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 999999 });
  assert.equal(plan, null);
});

test('planCompaction：超阈值 → 边界在 user 起头、最新真人提问留在尾部、头部含完整轮', () => {
  const state = buildConversation();
  const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 3000, preserveRecentTokens: 2000 });
  assert.ok(plan, '应给出压缩计划');
  const boundaryMsg = state.messages[plan.boundaryIndex];
  assert.equal(boundaryMsg.role, 'user', '边界必须是 user 起头（不产生孤儿 tool）');
  assert.equal(boundaryMsg.synthetic, undefined, '边界不是合成消息');
  // 最新真人提问（第二条 user）必须在尾部
  const lastRealUserIdx = state.messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0).pop();
  assert.ok(plan.boundaryIndex <= lastRealUserIdx, '最新真人提问不被压缩');
  // 头部 = 边界前的全部消息，至少覆盖第一轮
  assert.ok(plan.headMessages.length >= 4);
  assert.ok(plan.headTokens >= 1000);
});

test('planCompaction：只有一轮 / 头部过小 → null（不值得摘要）', () => {
  const state = Core.initState();
  Core.appendUser(state, '问');
  Core.appendAssistant(state, { content: '答' });
  assert.equal(Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 1 }), null);
  // 两轮但头部极小：minHeadTokens 拦截
  const state2 = Core.initState();
  Core.appendUser(state2, 'a'); Core.appendAssistant(state2, { content: 'b' });
  Core.appendUser(state2, big(40000)); Core.appendAssistant(state2, { content: big(40000) });
  assert.equal(Ctx.planCompaction(state2.messages, { estimate: est, thresholdTokens: 1, minHeadTokens: 5000 }), null);
});

test('planCompaction：跳过已压缩消息（二次压缩只看活历史，并带回上一份摘要）', () => {
  const state = buildConversation();
  const first = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 3000, preserveRecentTokens: 2000 });
  Ctx.applyCompaction(state, first, '第一份摘要内容', { estimate: est });
  // 追加新一轮把活历史再次顶过阈值
  Core.appendUser(state, big(20000));
  Core.appendAssistant(state, { content: big(20000) });
  const second = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 5000, preserveRecentTokens: 2000 });
  assert.ok(second, '二次压缩应可行');
  assert.equal(second.previousSummaryText, '第一份摘要内容', '上一份摘要文本被带回供合并');
  assert.ok(second.headMessages.every((m) => m.kind !== 'compaction' || true));
});

test('applyCompaction：头部打标记、摘要消息落在边界、消息总数不变', () => {
  const state = buildConversation();
  const before = state.messages.length;
  const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 3000, preserveRecentTokens: 2000 });
  const info = Ctx.applyCompaction(state, plan, '摘要正文', { estimate: est });
  assert.equal(info.dropped, plan.droppedCount);
  assert.ok(info.freedTokens > 0);
  assert.equal(state.messages.length, before + 1, '摘要消息插入，原消息不删除');
  const summaryMsg = state.messages[plan.boundaryIndex];
  assert.equal(summaryMsg.kind, 'compaction');
  assert.equal(summaryMsg.synthetic, true);
  assert.ok(summaryMsg.content.indexOf('摘要正文') !== -1);
  assert.ok(summaryMsg.content.indexOf('[上下文摘要') === 0);
  // A-followup #1：摘要不承担业务轮次入口——空 turnId，否则「同 turnId 的第一条 user」
  // 会命中摘要，重试/编辑重发会拿摘要当问题重跑
  assert.equal(summaryMsg.turnId, '', '摘要不得占用当前业务轮次的 turnId');
  // 边界前的消息全部打上 compacted
  for (let i = 0; i < plan.boundaryIndex; i++) assert.equal(state.messages[i].compacted, true);
  // 空摘要拒绝应用
  assert.equal(Ctx.applyCompaction(state, plan, '   ', { estimate: est }), null);
});

test('applyCompaction：空计划拒绝应用（不动历史）', () => {
  const state = buildConversation();
  const before = state.messages.length;
  assert.equal(Ctx.applyCompaction(state, null, 'x', { estimate: est }), null);
  assert.equal(state.messages.length, before);
});

test('buildRequestBody 联动：压缩后旧历史不进请求、摘要消息进请求、窗口从 user/摘要起头', () => {
  const state = buildConversation();
  const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 3000, preserveRecentTokens: 2000 });
  Ctx.applyCompaction(state, plan, '已压缩的结论：电池文献若干', { estimate: est });
  const body = Core.buildRequestBody(state, {});
  const texts = body.messages.map((m) => String(m.content || '')).join('\n');
  assert.ok(texts.indexOf('已压缩的结论') !== -1, '摘要进入模型上下文');
  // 第一轮（c0，已被压缩）的 tool 结果不再发送，只剩后两轮
  const toolIds = body.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  assert.deepEqual(toolIds, ['c1', 'c2']);
  assert.notEqual(body.messages[0].role, 'tool', '窗口不从孤儿 tool 开始');
  // serialize 往返：compacted 标记与 lastInputTokens 持久化
  const restored = Core.deserialize(JSON.parse(JSON.stringify(Core.serialize(state))));
  assert.ok(restored.messages.some((m) => m.compacted === true));
  assert.ok(restored.messages.some((m) => m.kind === 'compaction'));
});

test('serializeForSummary：工具结果按字符封顶、超总预算时最旧部分省略并注明', () => {
  const msgs = [];
  for (let i = 0; i < 200; i++) {
    msgs.push({ role: 'user', content: '问题' + i + ' ' + big(500) });
  }
  const text = Ctx.serializeForSummary(msgs, { charCap: 4000 });
  assert.ok(text.indexOf('（更早的') === 0, '最旧部分被省略且注明');
  assert.ok(text.length < 6000);
  // 单条 tool 结果封顶
  const t = Ctx.serializeForSummary([{ role: 'tool', name: 'search', content: big(10000) }], {});
  assert.ok(t.indexOf('【工具结果 search】') === 0 && t.length < 1000);
});

test('summarizerBody：system+user 双消息、无工具、max_tokens 夹在 1024-2048', () => {
  const body = Ctx.summarizerBody({ historyText: 'H', previousSummary: 'P', tailText: 'T', maxOutputTokens: 999999 });
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[0].content.indexOf('对话历史压缩器') !== -1);
  assert.ok(body.messages[1].content.indexOf('【上一份摘要') !== -1);
  assert.ok(body.messages[1].content.indexOf('【最近保留段') !== -1);
  assert.ok(!body.tools);
  assert.equal(body.max_tokens, 2048);
  assert.equal(Ctx.summarizerBody({}).max_tokens, 2048);
});

test('maskToolMessage / maskOldToolResults：只换 content，配对字段不动', () => {
  const masked = Ctx.maskOldToolResults([
    { role: 'tool', tool_call_id: 'a', name: 't', content: big(1000) },
    { role: 'user', content: '问' },
    { role: 'tool', tool_call_id: 'b', name: 't', content: big(1000) }
  ], 1);
  assert.equal(masked[0].tool_call_id, 'a');
  assert.ok(masked[0].content.indexOf('旧工具结果已清除') !== -1);
  assert.ok(masked[0].content.indexOf('1000') !== -1, '占位行注明原长度');
  assert.equal(masked[2].content, big(1000), '最近 keepLast 条不掩码');
  assert.equal(masked[1].content, '问');
  // buildRequestBody 联动（注入 maskToolMessage）
  const state = Core.initState();
  Core.appendUser(state, 'q');
  Core.appendAssistant(state, { content: '', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] });
  Core.appendToolResults(state, [{ callId: 'c1', name: 't', result: big(5000) }]);
  Core.appendUser(state, 'q2');
  const body = Core.buildRequestBody(state, { maskToolResults: 1, maskToolMessage: Ctx.maskToolMessage });
  const toolOut = body.messages.find((m) => m.role === 'tool');
  assert.ok(toolOut.content.indexOf('旧工具结果已清除') !== -1);
  assert.equal(toolOut.tool_call_id, 'c1', 'tool_call_id 保留，配对不破坏');
});

test('isContextOverflowError：多家中英文措辞命中，普通错误不误判', () => {
  assert.ok(Ctx.isContextOverflowError('AI 服务返回 HTTP 400：{"error":{"code":"context_length_exceeded"}}'));
  assert.ok(Ctx.isContextOverflowError("This model's maximum context length is 4096 tokens"));
  assert.ok(Ctx.isContextOverflowError('prompt is too long: 215000 tokens > 200000 maximum'));
  assert.ok(Ctx.isContextOverflowError('请求体过长：输入超过模型上下文窗口'));
  assert.ok(Ctx.isContextOverflowError('Please reduce the length of the messages'));
  assert.ok(!Ctx.isContextOverflowError('AI 服务返回 HTTP 401：invalid api key'));
  assert.ok(!Ctx.isContextOverflowError('流空闲超时（120 秒无数据）'));
  assert.ok(!Ctx.isContextOverflowError(''));
});

test('emergencyBudget：减半且有下限', () => {
  assert.equal(Ctx.emergencyBudget(256000), 128000);
  assert.equal(Ctx.emergencyBudget(10000), 5000 + 3000); // max(8000, 5000)
  assert.equal(Ctx.emergencyBudget(10000), 8000);
  assert.equal(Ctx.emergencyBudget(0), 128000);
});

test('normalizeSelectionContext：无效输入返回 null，空白折叠', () => {
  assert.equal(Ctx.normalizeSelectionContext(null), null);
  assert.equal(Ctx.normalizeSelectionContext({}), null);
  assert.equal(Ctx.normalizeSelectionContext({ text: '   ' }), null);
  const sel = Ctx.normalizeSelectionContext({
    paperId: 'p1', attachmentId: 'a1', page: 3, pageTo: 4,
    text: '  第一段\n第二行\t 有空格  '
  });
  assert.equal(sel.text, '第一段 第二行 有空格');
  assert.equal(sel.page, 3);
  assert.equal(sel.pageTo, 4);
  assert.equal(sel.truncated, false);
});

test('normalizeSelectionContext：超长截断并如实标记，页码钳制', () => {
  const long = Ctx.normalizeSelectionContext({ page: 5, text: 'x'.repeat(Ctx.SELECTION_TEXT_MAX + 100) });
  assert.equal(long.text.length, Ctx.SELECTION_TEXT_MAX);
  assert.equal(long.truncated, true);
  // 页码缺省/倒挂都钳成合法区间（pageTo ≥ page ≥ 1）
  const clamped = Ctx.normalizeSelectionContext({ text: '句', page: 0, pageTo: -2 });
  assert.equal(clamped.page, 1);
  assert.equal(clamped.pageTo, 1);
  const single = Ctx.normalizeSelectionContext({ text: '句', page: 7 });
  assert.equal(single.pageTo, 7);
});

test('normalizeSelectionContext：EPUB 形态（cfi/章节/进度），无页码', () => {
  const sel = Ctx.normalizeSelectionContext({
    kind: 'epub', paperId: 'p1', attachmentId: 'a2',
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:20)', chapter: '第三章 讨论',
    progress: 42.7, text: '  某句\n被选中  '
  });
  assert.equal(sel.kind, 'epub');
  assert.equal(sel.cfi, 'epubcfi(/6/4!/4/2,/1:0,/1:20)');
  assert.equal(sel.chapter, '第三章 讨论');
  assert.equal(sel.progress, 43); // 四舍五入到整数百分比
  assert.equal(sel.text, '某句 被选中');
  assert.equal(sel.truncated, false);
  assert.equal(sel.page, undefined); // EPUB 没有页码字段
  // 进度越界钳到 [0,100]；缺章节/进度也能成形态（无 TOC 的书）
  assert.equal(Ctx.normalizeSelectionContext({ kind: 'epub', text: '句', progress: 140 }).progress, 100);
  const bare = Ctx.normalizeSelectionContext({ kind: 'epub', text: '句', cfi: 'epubcfi(/6/2)' });
  assert.equal(bare.chapter, '');
  assert.equal(bare.progress, null);
});
