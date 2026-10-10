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

test('planCompaction：未超阈值 null / 超阈值边界 user 起头且最新真人提问留尾、头部含完整轮 / 只一轮或头部过小 null / 二次压缩跳过已压缩并带回上一份摘要', () => {
  { // 未超阈值 → null
    const state = buildConversation();
    const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 999999 });
    assert.equal(plan, null);
  }
  { // 超阈值 → 边界在 user 起头、最新真人提问留在尾部、头部含完整轮
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
  }
  { // 只有一轮 / 头部过小 → null（不值得摘要）
    const state = Core.initState();
    Core.appendUser(state, '问');
    Core.appendAssistant(state, { content: '答' });
    assert.equal(Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 1 }), null);
    // 两轮但头部极小：minHeadTokens 拦截
    const state2 = Core.initState();
    Core.appendUser(state2, 'a'); Core.appendAssistant(state2, { content: 'b' });
    Core.appendUser(state2, big(40000)); Core.appendAssistant(state2, { content: big(40000) });
    assert.equal(Ctx.planCompaction(state2.messages, { estimate: est, thresholdTokens: 1, minHeadTokens: 5000 }), null);
  }
  { // 跳过已压缩消息（二次压缩只看活历史，并带回上一份摘要）
    const state = buildConversation();
    const first = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 3000, preserveRecentTokens: 2000 });
    Ctx.applyCompaction(state, first, '第一份摘要内容', { estimate: est });
    // 追加新一轮把活历史再次顶过阈值
    Core.appendUser(state, big(20000));
    Core.appendAssistant(state, { content: big(20000) });
    const second = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 5000, preserveRecentTokens: 2000 });
    assert.ok(second, '二次压缩应可行');
    assert.equal(second.previousSummaryText, '第一份摘要内容', '上一份摘要文本被带回供合并');
    assert.ok(second.headMessages.some((m) => m.kind === 'compaction'));
    assert.ok(second.headMessages.every((m) => m.compacted !== true));
  }
});

test('applyCompaction：头部打标记、摘要消息落在边界、消息总数不变；空计划拒绝应用（不动历史）', () => {
  { // 头部打标记、摘要消息落在边界、消息总数不变
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
  }
  { // 空计划拒绝应用（不动历史）
    const state = buildConversation();
    const before = state.messages.length;
    assert.equal(Ctx.applyCompaction(state, null, 'x', { estimate: est }), null);
    assert.equal(state.messages.length, before);
  }
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
  assert.deepEqual(toolIds, ['c2']);
  assert.notEqual(body.messages[0].role, 'tool', '窗口不从孤儿 tool 开始');
  // serialize 往返：compacted 标记与 lastInputTokens 持久化
  const restored = Core.deserialize(JSON.parse(JSON.stringify(Core.serialize(state))));
  assert.ok(restored.messages.some((m) => m.compacted === true));
  assert.ok(restored.messages.some((m) => m.kind === 'compaction'));
});

test('serializeForSummary 工具结果按字符封顶、超总预算时最旧部分省略并注明；summarizerBody system+user 双消息、无工具、max_tokens 夹在 1024-2048', () => {
  { // serializeForSummary：工具结果按字符封顶、超总预算时最旧部分省略并注明
    const msgs = [];
    for (let i = 0; i < 200; i++) {
      msgs.push({ role: 'user', content: '问题' + i + ' ' + big(500) });
    }
    const text = Ctx.serializeForSummary(msgs, { charCap: 4000 });
    assert.ok(text.indexOf('（更早的') === 0, '最旧部分被省略且注明');
    assert.ok(text.length < 6000);
    // 单条 tool 结果封顶
    const t = Ctx.serializeForSummary([{ role: 'tool', name: 'search', content: big(10000) }], {});
    assert.ok(t.indexOf('【工具结果 search】') === 0 && t.length < 2100);
  }
  { // summarizerBody：system+user 双消息、无工具、max_tokens 夹在 1024-2048
    const body = Ctx.summarizerBody({ historyText: 'H', previousSummary: 'P', tailText: 'T', maxOutputTokens: 999999 });
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[0].content.indexOf('对话历史压缩器') !== -1);
    assert.ok(body.messages[1].content.indexOf('【上一份摘要') !== -1);
    assert.ok(body.messages[1].content.indexOf('【最近保留段') !== -1);
    assert.ok(!body.tools);
    assert.equal(body.max_tokens, 2048);
    assert.equal(Ctx.summarizerBody({}).max_tokens, 2048);
  }
});

test('maskToolMessage：只换 content，配对字段不动（经 buildRequestBody 的 maskToolResults 生产路径）', () => {
  // buildRequestBody 联动（注入 maskToolMessage）：较旧工具结果换占位行，最近 keepLast 条原样
  const state = Core.initState();
  Core.appendUser(state, 'q');
  Core.appendAssistant(state, { content: '', tool_calls: [
    { id: 'c1', function: { name: 't', arguments: '{}' } },
    { id: 'c2', function: { name: 't', arguments: '{}' } }
  ] });
  Core.appendToolResults(state, [
    { callId: 'c1', name: 't', result: big(1000) },
    { callId: 'c2', name: 't', result: big(1000) }
  ]);
  Core.appendUser(state, 'q2');
  const body = Core.buildRequestBody(state, { maskToolResults: 2, maskToolMessage: Ctx.maskToolMessage });
  const toolOut = body.messages.filter((m) => m.role === 'tool');
  assert.equal(toolOut.length, 2);
  assert.ok(toolOut[0].content.indexOf('旧工具结果已清除') !== -1);
  assert.ok(toolOut[0].content.indexOf('1000') !== -1, '占位行注明原长度');
  assert.equal(toolOut[0].tool_call_id, 'c1', 'tool_call_id 保留，配对不破坏');
  assert.equal(toolOut[1].content, big(1000), '窗口尾部 keepLast 条消息内的工具结果不掩码');
});

test('isContextOverflowError 多家中英文措辞命中、普通错误不误判；emergencyBudget 减半且有下限', () => {
  assert.ok(Ctx.isContextOverflowError('AI 服务返回 HTTP 400：{"error":{"code":"context_length_exceeded"}}'));
  assert.ok(Ctx.isContextOverflowError("This model's maximum context length is 4096 tokens"));
  assert.ok(Ctx.isContextOverflowError('prompt is too long: 215000 tokens > 200000 maximum'));
  assert.ok(Ctx.isContextOverflowError('请求体过长：输入超过模型上下文窗口'));
  assert.ok(Ctx.isContextOverflowError('Please reduce the length of the messages'));
  assert.ok(!Ctx.isContextOverflowError('AI 服务返回 HTTP 401：invalid api key'));
  assert.ok(!Ctx.isContextOverflowError('流空闲超时（120 秒无数据）'));
  assert.ok(!Ctx.isContextOverflowError(''));
  // emergencyBudget：减半且有下限
  assert.equal(Ctx.emergencyBudget(256000), 128000);
  assert.equal(Ctx.emergencyBudget(10000), 5000 + 3000); // max(8000, 5000)
  assert.equal(Ctx.emergencyBudget(10000), 8000);
  assert.equal(Ctx.emergencyBudget(0), 128000);
});

test('maxOutputTokensLimit：报文明示 max_tokens 上限时解析出数字，未提及或无数字时返回 0', () => {
  // ZCode 网关：「限制数值范围[1,131072]」
  assert.equal(Ctx.maxOutputTokensLimit('AI 服务返回 HTTP 400: {"error":{"message":"ZCode: [1210][max_tokens参数非法：限制数值范围[1,131072]]","type":"invalid_request_error"}}'), 131072);
  // OpenAI 系措辞
  assert.equal(Ctx.maxOutputTokensLimit("Invalid 'max_tokens': must be less than or equal to 8192"), 8192);
  assert.equal(Ctx.maxOutputTokensLimit('max_tokens is too large: maximum allowed value is 16384'), 16384);
  assert.equal(Ctx.maxOutputTokensLimit('max_output_tokens 不得超过 64000'), 64000);
  // max_completion_tokens 改写后的形态也认
  assert.equal(Ctx.maxOutputTokensLimit('max_completion_tokens: at most 32768'), 32768);
  // 不提 max_tokens / 没给出数字 → 0（不拿猜测值重试）
  assert.equal(Ctx.maxOutputTokensLimit('AI 服务返回 HTTP 401：invalid api key'), 0);
  assert.equal(Ctx.maxOutputTokensLimit('context_length_exceeded: prompt is too long'), 0);
  assert.equal(Ctx.maxOutputTokensLimit('max_tokens 参数非法'), 0);
  assert.equal(Ctx.maxOutputTokensLimit(''), 0);
  assert.equal(Ctx.maxOutputTokensLimit(null), 0);
});

test('normalizeSelectionContext：无效输入返回 null、空白折叠 / 超长截断并如实标记、页码钳制 / EPUB 形态（cfi/章节/进度），无页码', () => {
  { // 无效输入返回 null，空白折叠
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
  }
  { // 超长截断并如实标记，页码钳制
    const long = Ctx.normalizeSelectionContext({ page: 5, text: 'x'.repeat(Ctx.SELECTION_TEXT_MAX + 100) });
    assert.equal(long.text.length, Ctx.SELECTION_TEXT_MAX);
    assert.equal(long.truncated, true);
    // 页码缺省/倒挂都钳成合法区间（pageTo ≥ page ≥ 1）
    const clamped = Ctx.normalizeSelectionContext({ text: '句', page: 0, pageTo: -2 });
    assert.equal(clamped.page, 1);
    assert.equal(clamped.pageTo, 1);
    const single = Ctx.normalizeSelectionContext({ text: '句', page: 7 });
    assert.equal(single.pageTo, 7);
  }
  { // EPUB 形态（cfi/章节/进度），无页码
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
  }
});

test('planCompaction：两轮即可压缩第一轮、估算器接收消息对象且只序列化一次 / synthetic 图像消息不能成为边界、工具配对和最新用户轮完整保留 / 手动 force 忽略触发阈值，仍保护只有一轮的长任务', () => {
  { // 两轮即可压缩第一轮，估算器接收消息对象且只序列化一次
    const state = buildConversation();
    state.messages.splice(8);
    const estimate = (message) => {
      assert.equal(typeof message, 'object');
      return est(message);
    };
    const plan = Ctx.planCompaction(state.messages, { estimate, thresholdTokens: 1, preserveRecentTokens: 2000 });
    assert.ok(plan);
    assert.equal(plan.boundaryIndex, 4);
    assert.deepEqual(plan.headMessages, state.messages.slice(0, 4));
    assert.equal(plan.totalLiveTokens, state.messages.reduce((sum, message) => sum + est(message), 0));
  }
  { // synthetic 图像消息不能成为边界，工具配对和最新用户轮完整保留
    const state = buildConversation();
    state.messages.splice(8);
    const image = { role: 'user', synthetic: true, content: '第 3 页截图', images: [{ type: 'image', ref: 'session:abc|page3.png' }] };
    state.messages.splice(7, 0, image);
    state.messages[8].content = big(9000);
    const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 1, preserveRecentTokens: 2000 });
    assert.equal(plan.boundaryIndex, 4);
    const tail = state.messages.slice(plan.boundaryIndex);
    const lastTurnId = tail[0].turnId;
    const info = Ctx.applyCompaction(state, plan, '保留第一轮文献检索结论', { estimate: est });
    assert.ok(info);
    assert.deepEqual(state.messages.slice(plan.boundaryIndex + 1), tail);
    assert.equal(state.messages[plan.boundaryIndex + 1].turnId, lastTurnId);
    const body = Core.buildRequestBody(state, {});
    assert.equal(body.messages.find((m) => m.role === 'tool').tool_call_id, 'c1');
    assert.equal(body.messages.find((m) => m.tool_calls).tool_calls[0].id, 'c1');
  }
  { // 手动 force 忽略触发阈值，仍保护只有一轮的长任务
    const state = buildConversation();
    const plan = Ctx.planCompaction(state.messages, { estimate: est, force: true, thresholdTokens: 999999, preserveRecentTokens: 2000 });
    assert.ok(plan);
    state.messages.splice(4);
    state.messages.push({ role: 'user', synthetic: true, content: big(20000) });
    state.messages.push({ role: 'assistant', content: big(20000) });
    assert.equal(Ctx.planCompaction(state.messages, { estimate: est, force: true, preserveRecentTokens: 1000 }), null);
  }
});

test('serializeForSummary：硬字符预算包含省略说明和截断标记、正文尾部 ID 可恢复 / 工具调用 ID 和参数尾部保留、上一份摘要只由独立字段提供；summarizerBody 小上下文包含输出预留、超大上下文仍受历史硬封顶', () => {
  { // serializeForSummary：硬字符预算包含省略说明和截断标记，正文尾部 ID 可恢复
    const messages = [
      { role: 'user', content: '旧请求'.repeat(1000) },
      { role: 'tool', name: 'read_file', tool_call_id: 'read-42', content: '正文'.repeat(2000) + ' attachmentId=A42 nextOffset=9000' }
    ];
    for (const cap of [1, 4, 6, 100, 2000]) {
      const text = Ctx.serializeForSummary(messages, { charCap: cap });
      assert.ok(text.length <= cap, '所有标记计入预算 ' + cap);
    }
    const text = Ctx.serializeForSummary(messages, { charCap: 2100 });
    assert.ok(text.includes('id=read-42'));
    assert.ok(text.includes('attachmentId=A42 nextOffset=9000'));
    assert.ok(text.includes('截断'));
  }
  { // serializeForSummary：工具调用 ID 和参数尾部保留，上一份摘要只由独立字段提供
    const text = Ctx.serializeForSummary([
      { role: 'user', kind: 'compaction', synthetic: true, content: '不可重复的旧摘要' },
      { role: 'assistant', tool_calls: [{ id: 'call-8', function: { name: 'read_reference_file', arguments: 'x'.repeat(3000) + '"attachmentId":"A8"}' } }] }
    ]);
    assert.ok(text.includes('id=call-8'));
    assert.ok(text.includes('"attachmentId":"A8"}'));
    assert.ok(!text.includes('不可重复的旧摘要'));
    const body = Ctx.summarizerBody({ historyText: text, previousSummary: '不可重复的旧摘要' });
    assert.equal(body.messages[1].content.split('不可重复的旧摘要').length - 1, 1);
  }
  { // summarizerBody：小上下文包含输出预留，超大上下文仍受历史硬封顶
    for (const contextTokens of [512, 1024, 2048, 4096, 8192]) {
      const body = Ctx.summarizerBody({
        contextTokens, historyText: big(100000, true), previousSummary: big(10000, true), tailText: big(5000, true)
      });
      const tokens = Core.estimateTokens(JSON.stringify(body.messages)) + body.max_tokens;
      assert.ok(tokens <= contextTokens, '摘要输入和输出预留不能超过 ' + contextTokens);
      assert.ok(body.max_tokens > 0);
    }
    const body = Ctx.summarizerBody({ contextTokens: 1000000, historyText: big(100000), previousSummary: big(10000), tailText: big(5000) });
    assert.ok(body.messages[1].content.length <= Ctx.HISTORY_CHAR_CAP);
  }
});

test('applyCompaction：拒绝边界移位和头部原地编辑后的过期计划，不污染历史；摘要变大或加上 header 后无节约时拒绝，成功后重置旧用量', () => {
  { // 拒绝边界移位和头部原地编辑后的过期计划，不污染历史
    for (const edit of [
      (state) => state.messages.unshift({ role: 'user', content: '插入新问题' }),
      (state) => { state.messages[0].content = '编辑后的真实意图'; },
      (state) => { state.messages[0].compacted = true; }
    ]) {
      const state = buildConversation();
      state.lastInputTokens = 99000;
      const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 1, preserveRecentTokens: 2000 });
      edit(state);
      const before = JSON.stringify(state);
      assert.equal(Ctx.applyCompaction(state, plan, '原问题的摘要', { estimate: est }), null);
      assert.equal(JSON.stringify(state), before);
    }
  }
  { // 摘要变大或加上 header 后无节约时拒绝，成功后重置旧用量
    const state = buildConversation();
    const plan = Ctx.planCompaction(state.messages, { estimate: est, thresholdTokens: 1, preserveRecentTokens: 2000 });
    const before = JSON.stringify(state);
    const estimate = (message) => message.kind === 'compaction' ? plan.headTokens : 1;
    assert.equal(Ctx.applyCompaction(state, plan, '短文本但 header 后没有节约', { estimate }), null);
    assert.equal(JSON.stringify(state), before);
    assert.equal(Ctx.applyCompaction(state, plan, big(8000, true), { estimate: () => plan.headTokens + 1 }), null);
    assert.equal(JSON.stringify(state), before);
    state.lastInputTokens = 99000;
    const info = Ctx.applyCompaction(state, plan, '压缩后的结论', { estimate: est });
    assert.ok(info.summaryTokens < info.freedTokens);
    assert.equal(state.lastInputTokens, 0);
  }
});

function microConversation(contents) {
  return [
    { role: 'user', turnId: 'latest', content: '查清证据；不要自动收藏或重复写入。' },
    { role: 'assistant', content: '', tool_calls: contents.map((_, i) => ({ id: 't' + i, function: { name: 'read_session_file', arguments: '{"file":"附件/evidence.txt"}' } })) },
    ...contents.map((content, i) => ({ role: 'tool', name: 'read_session_file', tool_call_id: 't' + i, content, error: i === 0 }))
  ];
}

test('compactToolView：单长轮仅缩短工具结果、保留首尾引用和最新用户要求且不写存档 / 预算足时保留全部正文、超预算先缩旧结果并保留最近三条 / 预算紧时可清正文但不删配对、短结果和计划不扩大或掩掉 / 旧工具清正文已够预算时，不提前缩短最近结果', () => {
  { // 单长轮仅缩短工具结果，保留首尾引用和最新用户要求且不写存档
    const messages = microConversation(['正文起点 ' + big(10000, true) + ' attachmentId=A42 nextOffset=9000']);
    const snapshot = JSON.stringify(messages);
    assert.equal(Ctx.planCompaction(messages, { estimate: est, thresholdTokens: 1, preserveRecentTokens: 100 }), null);
    const view = Ctx.compactToolView(messages, { estimate: est, budgetTokens: 1000 });
    assert.ok(view.reduce((sum, m) => sum + est(m), 0) <= 1000);
    assert.equal(view[0], messages[0], '不截用户问题与授权要求');
    assert.equal(view[1], messages[1], '不改工具调用');
    assert.equal(view[2].tool_call_id, 't0');
    assert.equal(view[2].name, 'read_session_file');
    assert.equal(view[2].error, true);
    assert.ok(view[2].content.includes('已缩短'));
    assert.ok(view[2].content.includes('正文起点'));
    assert.ok(view[2].content.includes('attachmentId=A42 nextOffset=9000'));
    assert.equal(JSON.stringify(messages), snapshot);
    const body = Core.buildRequestBody({ messages: view, historyMessageCap: 100 }, {});
    assert.equal(body.messages.find((m) => m.tool_calls).tool_calls[0].id, 't0');
    assert.equal(body.messages.find((m) => m.role === 'tool').tool_call_id, 't0');
  }
  { // 预算足时保留全部正文，超预算先缩旧结果并保留最近三条
    const messages = microConversation([big(10000), big(10000), 'recent one', 'recent two', 'recent three']);
    assert.equal(Ctx.compactToolView(messages, { estimate: est, budgetTokens: 99999 }), messages);
    const view = Ctx.compactToolView(messages, { estimate: est, budgetTokens: 1700 });
    assert.ok(view.reduce((sum, m) => sum + est(m), 0) <= 1700);
    assert.notEqual(view[2], messages[2]);
    for (let i = 4; i < view.length; i++) assert.equal(view[i], messages[i]);
    assert.deepEqual(view.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), ['t0', 't1', 't2', 't3', 't4']);
  }
  { // 预算紧时可清正文但不删配对，短结果和计划不扩大或掩掉
    const messages = microConversation(Array.from({ length: 8 }, () => big(5000)));
    const plan = { role: 'tool', name: 'update_research_plan', tool_call_id: 'plan-1', content: '{"goal":"核查","steps":[]}' };
    messages.push(plan);
    const snapshot = JSON.stringify(messages);
    const view = Ctx.compactToolView(messages, { estimate: est, budgetTokens: 850, keepRecentTools: 3 });
    assert.ok(view.reduce((sum, m) => sum + est(m), 0) <= 850);
    assert.ok(view.some((m) => m.content && m.content.includes('已清除')));
    assert.equal(view.at(-1), plan, '结构化计划仍原样保留');
    assert.equal(view.length, messages.length);
    assert.equal(JSON.stringify(messages), snapshot);
    const short = microConversation(['OK']);
    const tight = Ctx.compactToolView(short, { estimate: est, budgetTokens: 1 });
    assert.equal(tight[2], short[2], '短工具正文不能换成更长的掩码');
    assert.equal(tight[0], short[0], '不可满足的预算也不改真人指令');
  }
  { // 旧工具清正文已够预算时，不提前缩短最近结果
    const messages = microConversation([big(10000), big(10000), big(1000), big(1000), big(1000)]);
    const clearedOld = messages.map((m, index) => index === 2 || index === 3 ? Object.assign({}, m, { content: Ctx.maskToolMessage(m.content) }) : m);
    const budget = clearedOld.reduce((sum, m) => sum + est(m), 0);
    const view = Ctx.compactToolView(messages, { estimate: est, budgetTokens: budget });
    assert.ok(view.reduce((sum, m) => sum + est(m), 0) <= budget);
    for (let i = 4; i < view.length; i++) assert.equal(view[i], messages[i]);
  }
});


test('微压缩和掩码完整保留写入/下载/收藏回执，缺失内容只指导只读核对', () => {
  const names = ['collect_papers', 'download_pdfs', 'add_pdfs_to_folder', 'fetch_page', 'update_research_plan'];
  const protectedMessages = names.map((name, i) => ({ role: 'tool', name, tool_call_id: 'written-' + i, content: '已成功完成，勿重复 ' + big(2000), error: false }));
  const read = { role: 'tool', name: 'read_session_file', tool_call_id: 'read', content: big(20000) };
  const messages = [...protectedMessages, read];
  const before = JSON.stringify(messages);
  const view = Ctx.compactToolView(messages, { estimate: est, budgetTokens: 4000 });
  names.forEach((name, i) => {
    assert.equal(view[i], protectedMessages[i], name + ' 回执不能丢失');
    assert.equal(Ctx.maskToolMessage(protectedMessages[i].content, protectedMessages[i]), protectedMessages[i].content);
  });
  const maskedRead = Ctx.maskToolMessage(read.content, read);
  for (const content of [view.at(-1).content, maskedRead, Ctx.maskToolMessage('以前的读取结果')]) {
    assert.match(content, /只读/);
    assert.match(content, /不得因此重复写入、下载或收藏/);
    assert.ok(!content.includes('请重新调用工具获取'));
  }
  assert.equal(JSON.stringify(messages), before);
  const custom = { role: 'tool', name: 'export_evidence', content: big(10000) };
  assert.equal(Ctx.compactToolView([custom], { estimate: est, budgetTokens: 1, protectedToolNames: ['export_evidence'] })[0], custom);
});


test('provider calibrated liveTokens triggers compaction even below the text-only threshold', () => {
  const messages = [{ role: 'user', content: 'a'.repeat(12000) }, { role: 'assistant', content: 'b'.repeat(12000) }, { role: 'user', content: 'latest'.repeat(100) }];
  const estimate = Core.estimateMessageTokens;
  const plan = Ctx.planCompaction(messages, { estimate, thresholdTokens: 100000, preserveRecentTokens: 10, liveTokens: 110000 });
  assert.ok(plan); const state = { messages, inputUsageBaseline: { tokens: 110000, estimate: 6000 } };
  assert.ok(Ctx.applyCompaction(state, plan, 'short summary', { estimate }));
  assert.equal(state.inputUsageBaseline, null);
});
