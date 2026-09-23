/* LitBoard Agent 上下文管理（压缩 / 掩码 / 溢出判定）：纯函数层（浏览器 / Node 共用，零依赖）
 *
 * 背景（2026-09-20 对照 Claude Code / Cline / Roo / OpenHands 等主流 harness 后补齐）：
 * 此前唯一的上下文手段是「静默截断」——超预算直接丢最旧整轮，用户与模型都不知道丢了什么。
 * 本模块实现业界通行的两档结构：
 * - **压缩（compact）**：把较旧的历史交给模型摘要成一条「上下文摘要」消息，摘要之后的轮次
 *   原样保留；被压缩的消息只打 `compacted:true` 标记（**存储不删**，会话存档与撤销完整，
 *   请求组装时跳过）——Roo 的非破坏式 condense 同路线；
 * - **掩码（mask）**：不开压缩时的零成本降级——请求组装时把较旧的工具结果换成占位行
 *   （保留 tool_call_id，配对不破坏），JetBrains《The Complexity Trap》实测掩码的
 *   性价比不低于摘要压缩；
 * - **溢出自救**：端点报「上下文超长」类错误时，预算减半（确定性裁剪）重试一次，
 *   不依赖另一次成功的 LLM 请求（Cline overflowRecovery 同纪律）。
 *
 * 触发与预算都按「估算 token」（与 agentcore.estimateTokens 同一套口径）；上一轮端点回报的
 * prompt_tokens 是更可信的地板值，由调用方（agentloop）回喂到 state.lastInputTokens。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentContext = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // 触发阈值：活消息估算 token ≥ 可用输入的 80% 即压缩（Claude Code / Cline / Roo 都在 0.8-0.9 档）
  var THRESHOLD_RATIO = 0.8;
  // 尾部原样保留的 token 预算：太少会让模型丢掉「手头正在做什么」，太多则压缩无意义
  // （上限对齐 Cline preserveRecentTokens=20k / minimax-code keepRecentTokens=20k）
  var PRESERVE_MIN = 2000;
  var PRESERVE_MAX = 20000;
  var PRESERVE_RATIO = 0.25;
  // 摘要产物与摘要请求的封顶
  var SUMMARY_MAX_CHARS = 8000;
  var SUMMARIZE_MAX_TOKENS = 2048;
  // 序列化进摘要请求的字符预算（约 2-5 万 token，摘要请求自身必须放得下）
  var HISTORY_CHAR_CAP = 48000;
  var TAIL_CHAR_CAP = 2000;
  // 溢出重试的预算下限：再小连最新一轮都装不下，重试没有意义
  var EMERGENCY_BUDGET_MIN = 8000;

  /** 可用输入预算 = 上下文预算 − 单轮输出预留 − 少量缓冲（负数兜底 1000） */
  function usableInputTokens(contextTokens, maxOutputTokens) {
    var usable = Math.floor(Number(contextTokens) || 0) - Math.floor(Number(maxOutputTokens) || 0) - 1000;
    return Math.max(1000, usable);
  }

  function preserveRecentTokens(usable) {
    var byRatio = Math.floor((Number(usable) || 0) * PRESERVE_RATIO);
    return Math.max(PRESERVE_MIN, Math.min(PRESERVE_MAX, byRatio || PRESERVE_MIN));
  }

  /**
   * 制定压缩计划（未超阈值 / 无法安全切分时返回 null）。
   * 切分铁律（与 trimWindowToBudget 同源，A04）：
   * - 边界必须是某条 user 消息（活消息里），保证请求窗口永远从 user 起头，不产生孤儿 tool；
   * - 尾部（boundary 及之后）至少保留 preserveTokens 估算 token；
   * - 最新一条真人 user 消息必须落在尾部（绝不被摘要）；
   * - 头部（被压缩部分）必须至少含一个完整轮，且估算 token ≥ minHeadTokens，否则不值得摘要。
   * 返回的 boundaryIndex / droppedCount 都基于**原始 state.messages 下标**（含已压缩消息）。
   */
  function planCompaction(messages, opts) {
    var options = opts || {};
    var estimate = options.estimate || function () { return 0; };
    var list = Array.isArray(messages) ? messages : [];
    var live = [];
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].compacted === true) continue;
      var tokens = estimate(JSON.stringify(list[i] || {}));
      live.push({ index: i, msg: list[i], tokens: tokens });
      total += tokens;
    }
    if (total <= (Number(options.thresholdTokens) || 0)) return null;

    var groupStarts = [];
    for (var g = 0; g < live.length; g++) {
      if (live[g].msg && live[g].msg.role === 'user') groupStarts.push(g);
    }
    // 最新真人提问（非 synthetic / 非摘要）所在位置：它及之后的消息一律不压缩
    var protectedStart = -1;
    for (var p = live.length - 1; p >= 0; p--) {
      var pm = live[p].msg;
      if (pm && pm.role === 'user' && pm.synthetic !== true) { protectedStart = p; break; }
    }
    if (protectedStart <= 0) return null;
    // 候选边界 = 保护位之前的组起点（边界必是 user 起头 → 请求窗口永不以孤儿 tool 开头）
    var candidates = groupStarts.filter(function (gs) { return gs < protectedStart; });
    if (!candidates.length) return null;

    // 从尾部累计到 preserve 预算：reach 是尾部至少要覆盖到的最早活消息位置
    var preserve = Number(options.preserveRecentTokens) || preserveRecentTokens(total);
    var acc = 0;
    var reach = 0;
    for (var k = live.length - 1; k >= 0; k--) {
      acc += live[k].tokens;
      reach = k;
      if (acc >= preserve) break;
    }
    // 边界 = ≤ reach 的最大候选；都不满足时退到最早候选（尾部覆盖全部历史，仅头部极小的情况）
    var boundaryLive = -1;
    for (var c = candidates.length - 1; c >= 0; c--) {
      if (candidates[c] <= reach) { boundaryLive = candidates[c]; break; }
    }
    if (boundaryLive < 0) boundaryLive = candidates[0];
    if (boundaryLive <= 0) return null; // 头部为空，无可压缩内容

    var headTokens = 0;
    var headMessages = [];
    var previousSummaryText = '';
    for (var h = 0; h < boundaryLive; h++) {
      headTokens += live[h].tokens;
      headMessages.push(live[h].msg);
      if (live[h].msg && live[h].msg.kind === 'compaction') {
        previousSummaryText = String(live[h].msg.content || '').replace(/^\[[^\]]*\]\s*/, '');
      }
    }
    var minHead = Number(options.minHeadTokens) || 1000;
    if (headTokens < minHead || !headMessages.length) return null;

    return {
      boundaryIndex: live[boundaryLive].index,
      headMessages: headMessages,
      headTokens: headTokens,
      totalLiveTokens: total,
      droppedCount: headMessages.length,
      previousSummaryText: previousSummaryText
    };
  }

  function clip(text, cap) {
    var s = String(text == null ? '' : text);
    if (s.length <= cap) return s;
    return s.slice(0, cap) + '…[截断]';
  }

  /** 历史消息 → 摘要请求用的文本（从新到旧装填，超出字符预算的最旧部分省略并注明） */
  function serializeForSummary(headMessages, opts) {
    var options = opts || {};
    var charCap = Number(options.charCap) || HISTORY_CHAR_CAP;
    var list = Array.isArray(headMessages) ? headMessages : [];
    var kept = [];
    var used = 0;
    var omitted = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var line = summarizeLine(list[i]);
      if (used + line.length > charCap && kept.length) { omitted = i + 1; break; }
      kept.push(line);
      used += line.length;
    }
    kept.reverse();
    var out = omitted > 0 ? ['（更早的 ' + omitted + ' 条已省略）'] : [];
    return out.concat(kept).join('\n');
  }

  function summarizeLine(msg) {
    var m = msg || {};
    if (m.kind === 'compaction') return '【上一份上下文摘要】\n' + clip(m.content, 3000);
    if (m.role === 'user') return '【用户】' + clip(m.content, 4000);
    if (m.role === 'tool') return '【工具结果' + (m.name ? ' ' + m.name : '') + '】' + clip(m.content, 600);
    if (m.role === 'error') return '【系统提示】' + clip(m.content, 200);
    if (m.role === 'assistant') {
      var calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      if (calls.length) {
        var names = calls.map(function (call) {
          return (call && call.function && call.function.name || '?') + '(' + clip(call && call.function && call.function.arguments, 200) + ')';
        }).join('、');
        return '【助手·调用工具】' + names + (m.content ? '\n【助手】' + clip(m.content, 1000) : '');
      }
      return '【助手】' + clip(m.content, 1000);
    }
    return '【' + String(m.role || '消息') + '】' + clip(m.content, 400);
  }

  var SUMMARIZE_SYSTEM = [
    '你是对话历史压缩器。把「待压缩对话历史」改写成一份紧凑摘要，供同一个科研文献助手在上下文被压缩后继续服务用户。输出纯文本，按以下分节：',
    '1. 用户目标与约束',
    '2. 已完成 / 进行中的工作（用了哪些工具、关键结论）',
    '3. 涉及的文献与文件（paperId / workId / attachmentId、页码、文件名等标识原样保留）',
    '4. 待办与下一步',
    '5. 用户的偏好与纠正',
    '规则：只保留对话中存在的信息，不推测不补充；所有 id、数字、页码、文件名保持原样；若给了「上一份摘要」，与其合并并剔除已过时内容；连同「最近保留段」理解现状，但不要把最近段复述进摘要；总长不超过 500 字。'
  ].join('\n');

  /** 摘要请求体：独立的小请求（无工具、流式由主进程照常处理，渲染层 quiet 不上屏） */
  function summarizerBody(opts) {
    var options = opts || {};
    var parts = [];
    if (options.previousSummary) parts.push('【上一份摘要（请合并进新摘要）】\n' + String(options.previousSummary));
    parts.push('【待压缩对话历史】\n' + String(options.historyText || ''));
    if (options.tailText) parts.push('【最近保留段（仅供理解现状）】\n' + String(options.tailText));
    return {
      stream: true,
      max_tokens: Math.min(SUMMARIZE_MAX_TOKENS, Math.max(1024, Number(options.maxOutputTokens) || SUMMARIZE_MAX_TOKENS)),
      messages: [
        { role: 'system', content: SUMMARIZE_SYSTEM },
        { role: 'user', content: parts.join('\n\n') }
      ]
    };
  }

  /**
   * 应用压缩：头部消息打 compacted 标记（存储保留），在边界处插入一条「上下文摘要」
   * user 消息（synthetic，kind='compaction'）。请求组装（agentcore.buildRequestBody）会
   * 跳过 compacted 消息、保留摘要消息——模型视角里旧历史被这条摘要替代。
   */
  function applyCompaction(state, plan, summaryText, opts) {
    if (!plan || !(plan.boundaryIndex > 0)) return null; // 没有有效计划/头部为空：不动历史
    var estimate = (opts || {}).estimate || function () { return 0; };
    var text = clip(String(summaryText || '').trim(), SUMMARY_MAX_CHARS);
    if (!text) return null;
    var boundary = Number(plan.boundaryIndex) || 0;
    var messages = state.messages;
    for (var i = 0; i < boundary && i < messages.length; i++) messages[i].compacted = true;
    var header = '[上下文摘要｜' + plan.droppedCount + ' 条历史已压缩为下文，原文保留在会话存档]\n';
    var msg = {
      role: 'user',
      content: header + text,
      synthetic: true,
      kind: 'compaction',
      // 摘要不承担业务轮次入口（A-followup #1）：带 state.turnId 会让「同 turnId 的第一条
      // user」变成这条摘要——rerunTurn 于是截断整条保留尾并拿摘要当问题重跑。独立身份
      // （空 turnId）后，重试/编辑定位只会命中真实提问。
      turnId: '',
      ts: new Date().toISOString()
    };
    messages.splice(boundary, 0, msg);
    return {
      dropped: plan.droppedCount,
      freedTokens: plan.headTokens,
      summaryTokens: estimate(JSON.stringify(msg))
    };
  }

  /** 掩码占位串（单一权威；agentcore.buildRequestBody 经 opts.maskToolMessage 注入使用） */
  function maskToolMessage(content) {
    var original = String(content == null ? '' : content);
    return '[旧工具结果已清除（原约 ' + original.length + ' 字符）；需要时请重新调用工具获取]';
  }

  /**
   * 掩码（请求视图专用，不落盘）：仅替换较旧 tool 消息的 content 为占位行，
   * tool_call_id / name 原样保留——工具配对不变，端点不会因孤儿调用报 400。
   */
  function maskOldToolResults(messages, keepLast) {
    var list = Array.isArray(messages) ? messages : [];
    var keep = Math.max(0, Number(keepLast) || 0);
    if (!keep) return list;
    return list.map(function (msg, index) {
      if (!msg || msg.role !== 'tool' || index >= list.length - keep) return msg;
      return Object.assign({}, msg, { content: maskToolMessage(msg.content) });
    });
  }

  /** 端点「上下文超长」类报错识别（多家中英文措辞保守匹配；宁可漏判走正常错误路径，不误重试） */
  var OVERFLOW_RE = /context[_ ]length|context_length_exceeded|context window|maximum context|prompt is too long|too many tokens|request too large|reduce the length|exceeds? (?:the )?(?:maximum|context|model)|上下文.{0,8}(超|过长|超出)|输入.{0,8}(超|过长)|超过.{0,10}(上限|长度)/i;

  function isContextOverflowError(text) {
    return OVERFLOW_RE.test(String(text == null ? '' : text));
  }

  /** 溢出重试预算：减半，下限 EMERGENCY_BUDGET_MIN（连最新一轮都装不下时不再重试，如实报错） */
  function emergencyBudget(previous) {
    var prev = Number(previous) || 0;
    return Math.max(EMERGENCY_BUDGET_MIN, Math.floor((prev > 0 ? prev : 256000) / 2));
  }

  /* 划词上下文（阅读器选区 → agent 轮次冻结）：选中文字进系统提示前的唯一整形点。
   * 整页拖选可能上万字符，全量进提示词会挤爆预算——折叠空白、封顶并如实标记截断。 */
  var SELECTION_TEXT_MAX = 1500;

  /** 阅读器选区 → 冻结进轮次的 selection 对象；无有效选区返回 null。
   *  PDF：{ kind:'pdf', paperId, attachmentId, page, pageTo, text }（页码已是 1 基物理页）；
   *  EPUB：{ kind:'epub', paperId, attachmentId, cfi, chapter, progress, text }——流式排版没有
   *  固定页码（字号/窗口一变分页就变），位置身份 = CFI + 章节名 + 进度百分比。 */
  function normalizeSelectionContext(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var text = String(raw.text == null ? '' : raw.text).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    var truncated = text.length > SELECTION_TEXT_MAX;
    if (truncated) text = text.slice(0, SELECTION_TEXT_MAX);
    var out = {
      paperId: raw.paperId || '',
      attachmentId: raw.attachmentId || '',
      text: text,
      truncated: truncated
    };
    if (raw.kind === 'epub') {
      out.kind = 'epub';
      out.cfi = String(raw.cfi || '').slice(0, 2000);
      out.chapter = String(raw.chapter || '').slice(0, 120);
      out.progress = typeof raw.progress === 'number' && isFinite(raw.progress)
        ? Math.max(0, Math.min(100, Math.round(raw.progress))) : null;
    } else {
      out.kind = 'pdf';
      var page = Math.max(1, Number(raw.page) || 1);
      out.page = page;
      out.pageTo = Math.max(page, Number(raw.pageTo) || page);
    }
    return out;
  }

  return {
    THRESHOLD_RATIO: THRESHOLD_RATIO,
    SUMMARY_MAX_CHARS: SUMMARY_MAX_CHARS,
    HISTORY_CHAR_CAP: HISTORY_CHAR_CAP,
    TAIL_CHAR_CAP: TAIL_CHAR_CAP,
    usableInputTokens: usableInputTokens,
    preserveRecentTokens: preserveRecentTokens,
    planCompaction: planCompaction,
    serializeForSummary: serializeForSummary,
    summarizerBody: summarizerBody,
    applyCompaction: applyCompaction,
    maskToolMessage: maskToolMessage,
    maskOldToolResults: maskOldToolResults,
    isContextOverflowError: isContextOverflowError,
    emergencyBudget: emergencyBudget,
    SELECTION_TEXT_MAX: SELECTION_TEXT_MAX,
    normalizeSelectionContext: normalizeSelectionContext
  };
});
