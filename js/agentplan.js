/* 可核验的任务状态；证据存在不等于科学结论正确。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentPlan = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var statuses = ['pending', 'in_progress', 'completed', 'blocked'];
  function failedText(text) {
    return /^\s*[（([]?\s*(?:error\b|failed\b|cancel(?:led|ed)\b|not executed\b|the user cancel(?:led|ed)\b|错误|失败|已取消|已停止|未执行|用户取消了|当前环境不支持|工具执行失败|执行被中断|检查点保存失败|该轮已停止|缺少会话上下文|workIds 为空|files 为空)/i.test(text);
  }
  function fail(message) { throw new Error(message); }
  function strings(value, name) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 30 || value.some(function (v) { return typeof v !== 'string' || !v.trim() || v.length > 300; })) fail(name + ' 必须是最多 30 项的字符串数组');
    return Array.from(new Set(value.map(function (v) { return v.trim(); })));
  }
  function successfulResult(msg) {
    if (!msg || msg.role !== 'tool' || msg.error || msg.cancelled || msg.canceled || msg.name === 'update_research_plan' || msg.name === 'read_research_plan') return false;
    var content = msg.content;
    if (content == null || content === '') return false;
    var data = content;
    if (typeof content === 'string') {
      try { data = JSON.parse(content); } catch (_) {
        return !failedText(content);
      }
    }
    if (typeof data === 'string') return !!data.trim() && !failedText(data);
    if (data === false || data == null) return false;
    if (data && typeof data === 'object') {
      if (data.error || data.ok === false || data.success === false || data.cancelled || data.canceled || data.stopped === true) return false;
      if (/^(error|failed|cancelled|canceled|skipped|not_executed|unsupported|binary|too_large)$/i.test(String(data.status || ''))) return false;
      // 下载的每项都失败时，调用返回 JSON 也不算完成证据；空检索仍是成功查询。
      if (Array.isArray(data.results) && data.results.length && data.results.every(function (row) {
        return !row || row.error || row.ok === false || row.success === false || row.cancelled || row.canceled || /^(error|failed|cancelled|canceled|skipped|not_executed|unsupported|binary|too_large)$/i.test(String(row.status || ''));
      })) return false;
      if (Array.isArray(data.renderedPages) && !data.renderedPages.length && Array.isArray(data.failures) && data.failures.length) return false;
      if (Array.isArray(data.errors) && data.errors.length && data.staged === 0) return false;
    }
    return true;
  }
  /** 全历史中第 n 条 tool 结果（1 起）的短别名映射——模型引用证据时不必抄写
   *  长随机 id（实践中会编造 call_2 这类短 id 而被拒）。编号按存储顺序数
   *  role:'tool' 消息；agentcore.buildRequestBody 用同一编号在请求里给每条
   *  工具结果行首标注 [cN]，两处必须一致（test/agentplan.test.js 交叉校验）。 */
  function toolAliasMap(messages) {
    var byId = {}, byAlias = {}, seq = 0;
    (messages || []).forEach(function (msg) {
      if (msg && msg.role === 'tool' && msg.tool_call_id) {
        seq++;
        var id = String(msg.tool_call_id);
        byId[id] = 'c' + seq;
        byAlias['c' + seq] = id;
      }
    });
    return { byId: byId, byAlias: byAlias, count: seq };
  }
  /** 近期可作证据的成功调用提示（校验失败时教模型一次改对，而不是连猜六次后放弃） */
  function recentEvidenceHint(messages, ids, aliases, limit) {
    var hints = [];
    for (var i = (messages || []).length - 1; i >= 0 && hints.length < (limit || 6); i--) {
      var msg = messages[i];
      if (msg && msg.role === 'tool' && msg.tool_call_id && ids.has(String(msg.tool_call_id)) && msg.name) {
        hints.unshift((aliases.byId[String(msg.tool_call_id)] || '?') + '=' + msg.name);
      }
    }
    return hints.join('、');
  }
  function evidenceIds(messages) {
    var requested = new Map(), ids = new Set();
    (messages || []).forEach(function (msg) {
      if (msg && msg.role === 'assistant') (msg.tool_calls || []).forEach(function (call) {
        if (call && call.id) requested.set(String(call.id), call.function && call.function.name);
      });
      if (successfulResult(msg) && requested.has(msg.tool_call_id) && (!msg.name || requested.get(msg.tool_call_id) === msg.name)) ids.add(msg.tool_call_id);
    });
    return ids;
  }
  function shape(input) {
    if (!input || typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 300 || !Array.isArray(input.steps) || input.steps.length > 12) fail('计划需要 goal（1–300 字）与最多 12 个 steps');
    var used = new Set(), active = 0;
    var steps = input.steps.map(function (step, index) {
      if (!step || typeof step.content !== 'string' || !step.content.trim() || step.content.length > 180 || statuses.indexOf(step.status) < 0 || (step.note != null && (typeof step.note !== 'string' || step.note.length > 300))) fail('无效的计划步骤');
      var id = step.id == null ? 'step-' + (index + 1) : String(step.id).trim();
      // id 只是会话内依赖/证据的关联键（JSON 编码传输），字符集不限——模型常用中文短语
      // 当 id，此前只认 [a-zA-Z0-9_-] 会把整份计划更新拒之门外，面板于是永远停在旧进度。
      // 仍要求：非空、≤64 字符、不含空白（保持 token 形态）、不重复。
      if (!id || id.length > 64 || /\s/.test(id) || used.has(id)) fail('步骤 id 无效（需 1–64 个非空白字符且不重复）');
      used.add(id);
      if (step.status === 'in_progress') active++;
      return { id: id, content: step.content.trim(), status: step.status, note: step.note || '', dependsOn: strings(step.dependsOn, 'dependsOn'), evidenceCallIds: strings(step.evidenceCallIds, 'evidenceCallIds'), artifacts: strings(step.artifacts, 'artifacts') };
    });
    if (active > 1) fail('一次只能有一个 in_progress 步骤');
    var byId = new Map(steps.map(function (s) { return [s.id, s]; })), visiting = new Set(), visited = new Set();
    function visit(s) {
      if (visiting.has(s.id)) fail('计划依赖存在循环');
      if (visited.has(s.id)) return;
      visiting.add(s.id);
      s.dependsOn.forEach(function (id) { if (!byId.has(id)) fail('未知依赖：' + id); visit(byId.get(id)); });
      visiting.delete(s.id); visited.add(s.id);
    }
    steps.forEach(visit);
    var plan = { goal: input.goal.trim(), steps: steps };
    if (JSON.stringify(plan).length > 10000) fail('计划超过 10000 字符');
    return plan;
  }
  function validateResearchPlan(input, context) {
    var plan = shape(input), ctx = context || {}, ids = evidenceIds(ctx.messages), files = new Set((ctx.attachments || []).map(function (a) { return typeof a === 'string' ? a : a && a.file; }));
    // 证据引用接受 [cN] 短别名或完整 call id（别名编号见 toolAliasMap）
    var aliases = toolAliasMap(ctx.messages);
    var resolveEvidence = function (id) { return aliases.byAlias[String(id)] || String(id); };
    var byId = new Map(plan.steps.map(function (s) { return [s.id, s]; }));
    plan.steps.forEach(function (step) {
      if (step.status === 'in_progress' && step.dependsOn.some(function (id) { return byId.get(id).status !== 'completed'; })) fail('开始步骤的依赖尚未完成：' + step.id);
      step.evidenceCallIds.forEach(function (id) {
        if (ids.has(resolveEvidence(id))) return;
        // 报错带上近期可用的成功调用（短 id=工具名）：模型拿真实 id 一次改对。
        // 此前只报「不是成功工具结果」，模型连猜 call_2/call_4 五次全拒后放弃，
        // 计划永远停在上次状态（2026-10 真机会话复盘）。
        var hint = recentEvidenceHint(ctx.messages, ids, aliases);
        fail('证据不是当前会话成功工具结果：' + id + (hint ? '。近期可用：' + hint + '（引用 [cN] 短 id 或完整 call_… id 均可）' : ''));
      });
      step.artifacts.forEach(function (file) { if (!files.has(file)) fail('附件尚未登记：' + file); });
      if (step.status === 'completed') {
        // content 是可调整的描述；字面变化无法判定任务范围是否改变，完成依据由引用和依赖校验。
        if (!step.evidenceCallIds.length && !step.artifacts.length) fail('完成步骤需要成功工具证据或已登记附件：' + step.id);
        if (step.dependsOn.some(function (id) { return byId.get(id).status !== 'completed'; })) fail('完成步骤的依赖尚未完成：' + step.id);
      }
    });
    return plan;
  }
  function validateProposal(input, context) {
    try { return { ok: true, plan: validateResearchPlan(input, context) }; }
    catch (err) { return { ok: false, error: err.message }; }
  }
  function getResearchPlan(messages, attachments) {
    var list = Array.isArray(messages) ? messages : [], current = null;
    list.forEach(function (msg, index) {
      if (!msg || msg.role !== 'tool' || msg.name !== 'update_research_plan' || msg.error) return;
      try {
        var raw = JSON.parse(msg.content), plan = shape(raw);
        // 旧完成记录保留为待核验状态，先核对既有结果，禁止直接重做副作用。
        if (raw.steps.some(function (s) { return s.id == null; })) plan.steps.forEach(function (s) { if (s.status === 'completed') { s.status = 'blocked'; s.note = ('旧完成记录待核验；先核对已保存结果，禁止直接重复收藏、下载或写入。' + (s.note || '')).slice(0, 300); } });
        current = validateResearchPlan(plan, { messages: list.slice(0, index), attachments: attachments, previousPlan: current });
      } catch (_) { /* 损坏或无法核验的更新不覆盖最后有效计划。 */ }
    });
    return current;
  }
  /** 计划是否已全部完成（UI 据此自动收起计划面板；数据保留在会话消息里不删） */
  function isPlanCompleted(plan) {
    return !!(plan && Array.isArray(plan.steps) && plan.steps.length &&
      plan.steps.every(function (step) { return step && step.status === 'completed'; }));
  }
  return { normalizePlan: shape, validateResearchPlan: validateResearchPlan, validateProposal: validateProposal, getResearchPlan: getResearchPlan, isPlanCompleted: isPlanCompleted, successfulResult: successfulResult, evidenceIds: evidenceIds, toolAliasMap: toolAliasMap };
});
