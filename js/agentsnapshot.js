/* LitBoard AI 会话展示快照（渲染层 / Node 共用）：core.messages → assistant-ui
 * ThreadMessageLike 的纯转换层。从 agentui.js 拆出（2026-10 架构整理）——展示 ID 的
 * 编码规则（turnId 前缀 + 角色计数后缀）是编辑定位 / 分叉定位 / assistant-ui
 * MessageRepository 稳定性的单一权威，多处消费（agentui 桥、分叉、测试），拆成
 * 无 DOM、无状态的独立模块后可直接 require 测试。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentSnapshot = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /** core 消息在 assistant-ui 中使用的稳定前缀。摘要没有业务 turnId，展示层以原始
   *  下标生成 tN；编辑回调给的是前驱消息的展示前缀，反向定位必须使用同一规则。 */
  function messageDisplayKey(msg, index) {
    return msg && msg.turnId ? msg.turnId : ('t' + index);
  }

  function convertRun(run) {
    var out = [];
    var messages = run.core.messages;
    var counters = {};
    messages.forEach(function (msg, index) {
      var turnId = messageDisplayKey(msg, index);
      if (msg.role === 'user' && msg.kind === 'compaction') {
        // R17 上下文摘要：以带标记的助手气泡呈现（📦 头部行说明压缩了什么），不是用户的发言
        var skey = turnId + ':c' + (counters[turnId] = (counters[turnId] || 0) + 1);
        out.push({
          id: skey,
          role: 'assistant',
          content: [{ type: 'text', text: '📦 ' + String(msg.content || '') }],
          metadata: { custom: { turnId: turnId, lbCompaction: true } }
        });
      } else if (msg.role === 'user') {
        // H1：每条 user 消息独立稳定 ID（轮内多条——工具注入的截图/合成消息——
        // 共用 turnId+':u' 会让 assistant-ui 的 MessageRepository 因重复 ID 报错进错误边界）
        var ukey = turnId + ':u' + (counters[turnId] = (counters[turnId] || 0) + 1);
        var uparts = [{ type: 'text', text: String(msg.content || '') }];
        if (Array.isArray(msg.images) && msg.images.length) {
          uparts.push({ type: 'text', text: '[📎 本条附带 ' + msg.images.length + ' 张图片]' });
        }
        out.push({
          id: ukey,
          role: 'user',
          content: uparts,
          // synthetic 标记下传给 bundle：合成消息（截图/摘要）不提供「编辑」入口
          metadata: { custom: { turnId: turnId, synthetic: msg.synthetic === true, forkIndex: msg.synthetic === true ? null : index } }
        });
      } else if (msg.role === 'assistant') {
        var key = turnId + ':a' + (counters[turnId] = (counters[turnId] || 0) + 1);
        var parts = [];
        if (msg.reasoning) parts.push({ type: 'reasoning', text: msg.reasoning }); // A02
        if (msg.content) parts.push({ type: 'text', text: msg.content });
        (Array.isArray(msg.toolCalls) ? msg.toolCalls : []).forEach(function (call) {
          parts.push({
            type: 'tool-call',
            toolCallId: call.callId || call.id || key,
            toolName: call.name || '',
            args: call.args || {},
            argsText: safeJson(call.args),
            result: call.status === 'running' ? undefined : (call.result != null ? call.result : undefined),
            isError: call.status === 'error'
          });
        });
        out.push({ id: key, role: 'assistant', content: parts, metadata: { custom: { turnId: turnId, forkIndex: index } } });
      } else if (msg.role === 'error') {
        var ekey = turnId + ':e' + (counters[turnId] = (counters[turnId] || 0) + 1);
        out.push({
          id: ekey,
          role: 'assistant',
          content: [{ type: 'text', text: String(msg.content || '') }],
          metadata: { custom: { turnId: turnId, lbError: { text: String(msg.content || ''), turnId: turnId, retry: msg.retry === true } } }
        });
      }
      // role:'tool' 的结果已并入前一条 assistant 的 tool-call part
    });
    // 流式中的 live assistant（A06/A07：由循环的流缓冲驱动）。
    // 整轮恒挂载（只看 run.streaming）：工具执行、等待下一句首个增量的间隙里缓冲
    // 暂时为空，此前条件渲染会把气泡整个卸载——下一批增量再来又重新挂载，
    // 表现为「对话到一半气泡消失/闪烁」。无内容时以「…」占位保持占位与滚动位置。
    if (run.streaming) {
      var liveParts = [];
      if (run.streamReasoning) liveParts.push({ type: 'reasoning', text: run.streamReasoning });
      if (run.streamToolName && !run.streamText) {
        liveParts.push({ type: 'tool-call', toolCallId: 'live', toolName: run.streamToolName, args: {}, argsText: '' });
      }
      if (run.streamText) liveParts.push({ type: 'text', text: run.streamText });
      if (!liveParts.length) liveParts.push({ type: 'text', text: '…' });
      out.push({
        id: (run.core.turnId || 'live') + ':live',
        role: 'assistant',
        content: liveParts,
        status: { type: 'running' }
      });
    }
    return out;
  }

  function safeJson(value) {
    try { return JSON.stringify(value || {}); } catch (error) { return '{}'; }
  }

  /**
   * R02：编辑定位。assistant-ui 的 onEdit 只给 appendMessage.parentId = 被编辑消息的
   * **前驱** id；bundle 侧已把前缀（前驱所属 turnId）传回来。由于线程是线性结构，
   * 「前驱属于 turn T」唯一确定「被编辑的是 T 之后的第一条 user 消息」——不猜、
   * 找不到就放弃（宁可不动也不能改错轮次把后面历史截掉）。
   */
  function turnIdAfterParent(run, parentTurnPrefix) {
    var messages = run.core.messages;
    var start = 0;
    if (parentTurnPrefix) {
      var last = -1;
      for (var i = 0; i < messages.length; i++) {
        if (messageDisplayKey(messages[i], i) === parentTurnPrefix) last = i;
      }
      if (last < 0) return '';
      start = last + 1;
    }
    // A-followup #1：与 rerunTurn 同一规则——合成 user 消息（上下文摘要 / 工具注入截图）
    // 不是轮次入口，编辑定位跳过它们，否则编辑重发会截到摘要那一轮
    for (var j = start; j < messages.length; j++) {
      if (messages[j].role === 'user' && messages[j].synthetic !== true) return messages[j].turnId || '';
    }
    return '';
  }

  return {
    messageDisplayKey: messageDisplayKey,
    convertRun: convertRun,
    safeJson: safeJson,
    turnIdAfterParent: turnIdAfterParent
  };
});
