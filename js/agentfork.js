/* AI 会话分支：纯 JSON 历史复制与运行状态隔离。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentFork = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function forkDocument(source, options) {
    var opts = options || {};
    if (!source || !source.id || !opts.id || opts.id === source.id) throw new Error('Invalid fork identity');
    if (source.streaming === true || source.compactBusy === true) throw new Error('Session is busy');
    var doc = JSON.parse(JSON.stringify(source));
    var messages = Array.isArray(doc.messages) ? doc.messages : [];
    var selected = opts.messageIndex;
    var cutoff = messages.length - 1;
    if (selected !== undefined) {
      if (!Number.isInteger(selected) || selected < 0 || selected >= messages.length) throw new Error('Invalid message index');
      cutoff = selected;
      // 工具响应必须紧跟调用；在其中任一消息处分支都保留整个响应组。
      while (cutoff + 1 < messages.length && messages[cutoff + 1].role === 'tool') cutoff++;
    }
    doc.messages = messages.slice(0, cutoff + 1);
    var pending = [];
    doc.messages.forEach(function (msg) {
      if (msg.role === 'tool') {
        var position = pending.indexOf(msg.tool_call_id);
        if (position < 0) throw new Error('Unpaired tool result');
        pending.splice(position, 1);
      } else {
        if (pending.length) throw new Error('Incomplete tool calls');
        if (msg.role === 'assistant') {
          pending = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map(function (call) { return call.id; });
          // toolCalls 是 UI 展示元数据，不作为协议配对权威。
        }
      }
    });
    if (pending.length) throw new Error('Incomplete tool calls');
    if (selected !== undefined) {
      doc.messages = doc.messages.filter(function (msg) { return msg.kind !== 'compaction'; });
      doc.messages.forEach(function (msg) { delete msg.compacted; });
    }
    var keptTurns = {};
    doc.messages.forEach(function (msg) { if (msg.turnId) keptTurns[msg.turnId] = true; });
    var meta = doc.turnMeta || {};
    doc.turnMeta = {};
    Object.keys(meta).forEach(function (key) { if (keptTurns[key]) doc.turnMeta[key] = meta[key]; });
    doc.id = opts.id;
    doc.title = opts.title || source.title;
    doc.createdAt = doc.updatedAt = opts.now || new Date().toISOString();
    doc.forkedFrom = { sessionId: source.id, messageIndex: cutoff };
    doc.editHistory = {};
    doc.streaming = false;
    doc.streamText = doc.streamReasoning = doc.streamToolName = '';
    doc.done = false;
    doc.stopReason = doc.endReason = doc.turnId = '';
    doc.steps = doc.lastInputTokens = 0;
    doc.inputUsageBaseline = null;
    doc.queuedInputs = [];
    delete doc.requestResume;
    doc.recentToolSignatures = [];
    doc.tokens = { in: 0, out: 0 };
    delete doc.compactBusy;
    delete doc.live;
    function rewrite(value) {
      if (typeof value === 'string') return value.split('session:' + source.id + '|').join('session:' + opts.id + '|');
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === 'object') Object.keys(value).forEach(function (key) { value[key] = rewrite(value[key]); });
      return value;
    }
    return rewrite(doc);
  }
  return { forkDocument: forkDocument };
});
