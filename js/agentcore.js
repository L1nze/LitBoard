/* LitBoard Agent 核心循环：纯函数状态机（浏览器 / Node 共用，零依赖）
 *
 * 职责边界：本模块只做「给定模型输出，推进会话状态」——
 * - 消息采用 OpenAI chat/completions 形态（role/content/tool_calls/tool_call_id）；
 * - SSE 解析在主进程（electron/agent-net.js），DOM 与工具执行在渲染层；
 * - 护栏：步数上限、单工具输出截断、上下文预算（估算 token，可配置）、卡死检测
 *   （同工具+同参数连续重复）、token 估算；
 * - serialize/deserialize 支撑会话跨重启恢复续聊。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULTS = {
    // 单轮对话内「模型→工具→模型」步数上限。主流 agent（pi 无步数护栏、opencode 默认不限、
    // Claude Code 以预算而非步数收束）都不过早硬停；真正的失控护栏是卡死检测 + token 预算，
    // 这里保留偏高的硬顶只作最后保险。临近上限时编排层会注入收尾提示（见 agentloop），
    // 让模型基于已有信息给出阶段性回答，而不是被拦腰截断。
    maxSteps: 40,
    toolOutputCap: 12000,   // 单个工具结果进上下文的字符上限
    historyMessageCap: 40,  // 消息条数窗口下限（实际窗口见 historyCapFor）
    // 上下文预算与单轮输出上限（估算 token），可在 设置 → AI 助手 自定义；
    // 设置留空即这里的默认值——**默认值唯一权威在本文件**，别在别处再写一份数字。
    contextTokens: 256000,
    maxOutputTokens: 12800
  };

  /** 上下文预算 → 消息条数窗口。固定 40 条在 256k 预算下会先于 token 预算把历史截掉
   *  （一轮工具链约 9 条消息，40 条只够 4 轮），故按「1 条消息 ≈ 1000 token 预算」
   *  放大，上限 400 条（token 预算才是硬约束，条数只是防病态窗口的兜底）。 */
  function historyCapFor(contextTokens) {
    var tokens = Number(contextTokens) > 0 ? Number(contextTokens) : DEFAULTS.contextTokens;
    return Math.max(DEFAULTS.historyMessageCap, Math.min(400, Math.round(tokens / 1000)));
  }

  function initState(options) {
    var opts = options || {};
    return {
      messages: [],
      steps: 0,
      tokens: { in: 0, out: 0 },
      done: false,
      stopReason: '',
      recentToolSignatures: [],
      maxSteps: Math.max(1, Number(opts.maxSteps) || DEFAULTS.maxSteps),
      toolOutputCap: Math.max(500, Number(opts.toolOutputCap) || DEFAULTS.toolOutputCap),
      historyMessageCap: Math.max(2, Number(opts.historyMessageCap) || DEFAULTS.historyMessageCap)
    };
  }

  /**
   * 工具参数解析（防御式）：
   * - 主流端点返回 JSON 字符串；
   * - DashScope 多轮回放存在 function.arguments 双重 JSON 编码的已知问题——
   *   parse 出来还是字符串就再 parse 一次，两层都不是对象则报参数错误。
   */
  function parseToolArgs(raw) {
    if (raw == null || raw === '') return {};
    if (typeof raw === 'object') return raw;
    var text = String(raw);
    var first = tryParse(text);
    if (first && typeof first === 'object') return first;
    var second = typeof first === 'string' ? tryParse(first) : null;
    if (second && typeof second === 'object') return second;
    var err = new Error('工具参数不是合法 JSON');
    err.code = 'BAD_TOOL_ARGS';
    throw err;
  }

  function tryParse(text) {
    try { return JSON.parse(text); } catch (e) { return undefined; }
  }

  /** 开始新的一轮提问：单轮预算（steps / 重复检测）按轮清零，token 用量跨轮累计（A13） */
  function beginTurn(state) {
    state.steps = 0;
    state.recentToolSignatures = [];
    state.turnId = genId('turn');
    return state;
  }

  /**
   * 追加用户消息。text 支持 string 或 { text, images }：
   * - images 是图像**引用**数组（{ type:'image', ref, label }），不是内联 base64——
   *   会话 JSON 只存引用，实际读取与编码在主进程发送前完成（多模态消息链 M9-5）；
   * - 旧调用（纯字符串）行为不变。
   */
  function appendUser(state, input) {
    beginTurn(state); // 每条用户消息开启新一轮：单轮预算清零、生成新 turnId
    var text = typeof input === 'object' && input !== null ? input.text : input;
    var msg = { role: 'user', content: String(text == null ? '' : text), turnId: state.turnId, ts: nowTs() };
    var images = typeof input === 'object' && input !== null ? input.images : null;
    var refs = normalizeImageRefs(images);
    if (refs.length) msg.images = refs;
    state.messages.push(msg);
    state.done = false;
    state.stopReason = '';
    state.endReason = '';
    return state;
  }

  /** 图像引用校验：只接受 { type:'image', ref } 形态（ref 为文件引用字符串）；
   *  data: URL / 无 ref 的条目一律丢弃——存储层绝不落内联 base64（会话文件防膨胀）。 */
  function normalizeImageRefs(images) {
    return (Array.isArray(images) ? images : []).filter(function (item) {
      return item && typeof item === 'object' && item.type === 'image' &&
        typeof item.ref === 'string' && item.ref && item.ref.indexOf('data:') !== 0;
    }).slice(0, 8).map(function (item) {
      var out = { type: 'image', ref: String(item.ref) };
      if (item.label) out.label = String(item.label).slice(0, 200);
      return out;
    });
  }

  /** 模型一轮输出落账：content + tool_calls（已是解析后的对象数组）+ 用量 + 推理内容（A02） */
  function appendAssistant(state, message, usage) {
    var msg = {
      role: 'assistant',
      content: String(message && message.content || ''),
      turnId: state.turnId || '',
      ts: nowTs()
    };
    // 推理内容（reasoning_content / reasoning）：展示与会话存档用。
    // 回放规则按 provider 适配（R01）：DeepSeek 官方要求「带 tools 的请求必须完整回传
    // reasoning_content，否则 400」——由 buildRequestBody 的 opts.replayReasoning 控制；
    // 其余端点不回传（未知字段可能被严格端点拒绝）。
    var reasoning = String((message && (message.reasoning_content != null ? message.reasoning_content : message.reasoning)) || '');
    if (reasoning) msg.reasoning = reasoning;
    var calls = Array.isArray(message && message.tool_calls) ? message.tool_calls : [];
    if (calls.length) {
      msg.tool_calls = calls.map(function (call) {
        return {
          id: String(call && call.id || genId('call')),
          type: 'function',
          function: {
            name: String(call && call.function && call.function.name || ''),
            arguments: String(call && call.function && call.function.arguments || '')
          }
        };
      });
      state.steps++;
      msg.tool_calls.forEach(function (call) {
        state.recentToolSignatures.push(signature(call.function.name, call.function.arguments));
      });
      if (state.recentToolSignatures.length > 8) {
        state.recentToolSignatures = state.recentToolSignatures.slice(-8);
      }
    }
    state.messages.push(msg);
    if (usage) addTokens(state, usage);
    return state;
  }

  /** 工具执行结果落账：每条对应一个 tool_call（OpenAI 的 role:'tool' 形态） */
  function appendToolResults(state, results) {
    var calls = [];
    // 每个工具独立落盘时，最后一条可能已经是同批的 tool 结果。
    for (var i = state.messages.length - 1; i >= 0; i--) {
      var previous = state.messages[i];
      if (previous.role === 'assistant') { calls = previous.toolCalls || []; break; }
      if (previous.role === 'user' && !previous.synthetic) break;
    }
    (Array.isArray(results) ? results : []).forEach(function (item) {
      var call = item || {};
      var content = truncateOutput(
        typeof call.result === 'string' ? call.result : JSON.stringify(call.result == null ? '' : call.result),
        state.toolOutputCap
      );
      state.messages.push({
        role: 'tool',
        tool_call_id: String(call.callId || ''),
        name: String(call.name || ''),
        content: content,
        error: call.error === true,
        turnId: state.turnId || '',
        ts: nowTs()
      });
      var meta = calls.filter(function (c) { return c && c.callId === call.callId; })[0];
      if (meta) {
        meta.status = call.error === true ? 'error' : 'ok';
        meta.result = content;
      }
    });
    return state;
  }

  /** 给渲染层用的展示元数据挂在最后一条 assistant 消息上（不进模型上下文） */
  function decorateToolCalls(state, calls) {
    var last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'assistant') return state;
    last.toolCalls = (Array.isArray(calls) ? calls : []).map(function (call) {
      var c = call || {};
      return {
        callId: c.callId || c.id || '',
        name: String(c.name || ''),
        args: c.args || {},
        status: c.status || 'running',
        result: c.result || ''
      };
    });
    return state;
  }

  /** 最后一条 assistant 消息的待执行工具调用（无则空数组 = 本轮结束） */
  function pendingToolCalls(state) {
    var last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.tool_calls)) return [];
    return last.tool_calls.map(function (call) {
      return {
        callId: call.id,
        name: call.function.name,
        args: parseToolArgs(call.function.arguments)
      };
    });
  }

  /** 同 pendingToolCalls，但参数解析失败不抛：坏参数调用归入 invalid，由调用方以
   *  错误工具结果回喂模型重新发起（流式截断产出坏 JSON 时不能让整轮失败——
   *  对照 pi 的 failToolCallsFromTruncatedMessage：不执行残缺参数，要求重发完整调用）。 */
  function safePendingToolCalls(state) {
    var last = state.messages[state.messages.length - 1];
    var out = { calls: [], invalid: [] };
    if (!last || last.role !== 'assistant' || !Array.isArray(last.tool_calls)) return out;
    last.tool_calls.forEach(function (call) {
      var item = { callId: call.id, name: call.function && call.function.name };
      try {
        item.args = parseToolArgs(call.function && call.function.arguments);
        out.calls.push(item);
      } catch (error) {
        out.invalid.push(item);
      }
    });
    return out;
  }

  function signature(name, argsText) {
    return String(name || '') + '#' + String(argsText || '');
  }

  /** 卡死检测：最近 4 个工具调用里同一签名出现 ≥2 次 */
  function isStuck(state) {
    var recent = state.recentToolSignatures.slice(-4);
    if (recent.length < 2) return false;
    var counts = {};
    for (var i = 0; i < recent.length; i++) {
      counts[recent[i]] = (counts[recent[i]] || 0) + 1;
      if (counts[recent[i]] >= 2) return true;
    }
    return false;
  }

  /**
   * 编排循环的续跑判定（A01 修正：按「最后一条消息的角色」区分阶段）：
   * - 刚落账完工具结果（last=tool）→ 必须回到模型消费结果，continue（受步数/卡死护栏约束）；
   *   旧实现在这里用 pendingToolCalls 判定，工具落账后必然误判为 done，导致模型永远
   *   没机会总结工具结果；
   * - 模型刚产出工具调用但结果未落账（last=assistant 带 tool_calls）→ pending_tools，
   *   编排层负责执行并落账，绝不能直接再请求模型；
   * - 模型给出最终回答（无调用）→ done；
   * - 护栏：单轮步数超限 → max_steps；重复调用卡死 → stuck。
   */
  function shouldContinue(state) {
    var last = state.messages[state.messages.length - 1];
    if (last && last.role === 'tool') {
      if (state.steps >= state.maxSteps) return { continue: false, reason: 'max_steps' };
      if (isStuck(state)) return { continue: false, reason: 'stuck' };
      return { continue: true, reason: '' };
    }
    // R11：工具注入的合成 user 消息（页面截图）——模型必须消费它，按 tool 阶段继续
    if (last && last.role === 'user' && last.synthetic === true) {
      if (state.steps >= state.maxSteps) return { continue: false, reason: 'max_steps' };
      return { continue: true, reason: '' };
    }
    if (last && last.role === 'assistant' && Array.isArray(last.tool_calls) && last.tool_calls.length) {
      return { continue: false, reason: 'pending_tools' };
    }
    return { continue: false, reason: 'done' };
  }

  /** 单工具输出截断（进上下文前；截断点附加标记让模型知道信息不完整） */
  function truncateOutput(text, cap) {
    var s = String(text == null ? '' : text);
    var limit = Number(cap) || DEFAULTS.toolOutputCap;
    if (s.length <= limit) return s;
    return s.slice(0, limit) + '\n…[结果过长已截断]';
  }

  /**
   * 组装请求体：系统提示 + 消息窗口 + 工具 schema。
   * 窗口裁剪两条铁律（A04）：
   * 1. 按完整对话组（user 起头）截断——先把超预算的**最旧整组**丢弃，再按条数截尾，
   *    保证窗口不会从 tool / assistant(tool_calls) 这类「半轮」开始；
   * 2. 任何 tool 消息的先行 assistant 调用必须还在窗口内（孤儿的直接丢弃）；
   *    assistant 的调用若结果被截掉则摘除该调用（已有行为）。
   * provider 适配（R01 / M9-5）：
   * - opts.replayReasoning：assistant 重放时带上 reasoning_content（DeepSeek 带 tools 的
   *   链式调用硬性要求；仅在该端点开启，不全局发送）；
   * - opts.sendImages：user 消息带 images 引用时以 content parts 形态发出（图像引用
   *   原样传递，由主进程在出网前解析成 image_url；关闭时退回纯文本，不丢消息）。
   * 预算（token 估算，设置 → AI 助手 可改；留空 = DEFAULTS）：
   * - opts.maxContextTokens：**整份请求**的上下文预算。系统提示与工具 schema 也占上下文，
   *   所以先扣掉它们再裁消息窗口——否则实发量会比设置值大一截（工具 schema 就有几千 token）；
   * - opts.maxOutputTokens：单轮输出上限，落成 body.max_tokens（协议层按形态改写字段名：
   *   responses → max_output_tokens，messages 必填且另有默认兜底）；
   * - opts.historyMessageCap：条数窗口，默认取 state.historyMessageCap。
   */
  function buildRequestBody(state, options) {
    var opts = options || {};
    var requestEstimate = function (msg) { return estimateMessageTokens(msg, opts); };
    var messages = [];
    if (opts.system) messages.push({ role: 'system', content: String(opts.system) });
    var budget = Number(opts.maxContextTokens) > 0 ? Number(opts.maxContextTokens) : 0;
    if (budget > 0) {
      var overhead = estimateTokens(opts.system || '');
      if (Array.isArray(opts.tools) && opts.tools.length) overhead += estimateTokens(JSON.stringify(opts.tools));
      budget = Math.max(1, budget - overhead - (Number(opts.maxOutputTokens) || 0));
    }
    // 上下文压缩（js/agentcontext）：compacted 标记的消息已被摘要替代，不进请求窗口；
    // maskToolResults（条数）+ maskToolMessage（占位串构造器，由调用方注入）：
    // 较旧 tool 消息的 content 换占位行——请求视图专用，存储不动、配对不破坏
    var source = (Array.isArray(state.messages) ? state.messages : []).filter(function (msg) {
      return !(msg && msg.compacted === true);
    });
    if (budget > 0 && typeof opts.compactToolView === 'function') {
      source = opts.compactToolView(source, { budgetTokens: budget, estimate: requestEstimate });
    }
    var window_ = trimWindowToBudget(source, budget, requestEstimate);
    var messageCap = Number(opts.historyMessageCap) > 0 ? Number(opts.historyMessageCap) : state.historyMessageCap;
    if (messageCap > 0 && window_.length > messageCap) {
      var starts = [];
      window_.forEach(function (msg, index) { if (msg.role === 'user' && !msg.synthetic) starts.push(index); });
      var cutoff = starts.find(function (index) { return index >= window_.length - messageCap; });
      // 条数限制也按完整轮裁剪；最新轮过长时保留真人问题。
      if (cutoff == null && starts.length) cutoff = starts[starts.length - 1];
      window_ = window_.slice(cutoff || 0);
    }
    // 头部孤儿 tool 消息：其先行 assistant 调用已被截掉，直接丢弃（顺序保证孤儿只出现在头部）
    while (window_.length && window_[0].role === 'tool') window_.shift();
    var maskKeep = Number(opts.maskToolResults) || 0;
    if (maskKeep > 0 && typeof opts.maskToolMessage === 'function') {
      window_ = window_.map(function (msg, index) {
        if (!msg || msg.role !== 'tool' || index >= window_.length - maskKeep) return msg;
        return Object.assign({}, msg, { content: opts.maskToolMessage(msg.content, msg) });
      });
    }
    // 尾部轮边界（R11 图像成本闸）：图像只从「最后一个真人 user 消息」起发送——
    // 截图在它所属的轮内可见；后续轮回退纯文本（引用仍留档，重跑该轮可再发出）
    var trailingStart = window_.length;
    for (var ti = window_.length - 1; ti >= 0; ti--) {
      if (window_[ti].role === 'user' && window_[ti].synthetic !== true) { trailingStart = ti; break; }
    }
    var callsById = collectCallIds(window_);
    messages = messages.concat(window_.map(function (msg, index) {
      if (msg.role === 'tool') {
        return { role: 'tool', tool_call_id: msg.tool_call_id, content: msg.content };
      }
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        // 只回放窗口内仍被后续 tool 消息引用的调用（防止悬挂 tool_call_id）
        var live = msg.tool_calls.filter(function (call) { return callsById.has(call.id); });
        if (!live.length && !msg.content) {
          return { role: 'assistant', content: '(工具调用已随窗口截断)' };
        }
        var out = { role: 'assistant', content: msg.content || '' };
        if (live.length) out.tool_calls = live;
        if (opts.replayReasoning && msg.reasoning) out.reasoning_content = msg.reasoning;
        return out;
      }
      if (msg.role === 'error') return null; // 展示用错误卡不进模型上下文
      if (msg.role === 'user' && opts.sendImages && index >= trailingStart && Array.isArray(msg.images) && msg.images.length) {
        return {
          role: 'user',
          content: [{ type: 'text', text: String(msg.content || '') }].concat(msg.images.map(function (img) {
            return { type: 'image', ref: String(img.ref || ''), label: String(img.label || '') };
          }))
        };
      }
      if (msg.role === 'assistant' && opts.replayReasoning && msg.reasoning) {
        var plain = { role: 'assistant', content: String(msg.content || '') };
        plain.reasoning_content = msg.reasoning;
        return plain;
      }
      return { role: msg.role, content: msg.content };
    }).filter(Boolean));
    var body = {
      messages: messages,
      stream: true
    };
    if (opts.model) body.model = String(opts.model);
    // 单轮输出上限：协议层按形态落到 max_tokens / max_output_tokens（agentproto 负责）
    if (Number(opts.maxOutputTokens) > 0) body.max_tokens = Math.floor(Number(opts.maxOutputTokens));
    if (Array.isArray(opts.tools) && opts.tools.length) body.tools = opts.tools;
    return body;
  }

  function collectCallIds(messages) {
    var ids = new Set();
    messages.forEach(function (msg) {
      if (msg.role === 'tool' && msg.tool_call_id) ids.add(msg.tool_call_id);
    });
    return ids;
  }

  /** 按完整对话组裁剪：估算 token 总量 > 预算时，从最旧的「user 起头组」整组丢弃
   *  （A04/A11 的上下文预算；0 = 不按预算裁剪） */
  function trimWindowToBudget(messages, maxTokens, estimator) {
    var list = Array.isArray(messages) ? messages.slice() : [];
    var cap = Number(maxTokens) || 0;
    var estimate = typeof estimator === 'function' ? estimator : estimateMessageTokens;
    if (cap <= 0) return list;
    var groupStarts = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].role === 'user' && list[i].synthetic !== true) groupStarts.push(i);
    }
    if (!groupStarts.length) return list;
    var total = 0;
    for (var j = 0; j < list.length; j++) total += estimate(list[j]);
    var cut = 0;
    while (groupStarts.length > 1 && total > cap) {
      var previousCut = cut;
      cut = groupStarts[1]; // 保留至少一组：丢到第二个真人 user 为止
      var dropped = 0;
      for (var k = previousCut; k < cut; k++) dropped += estimate(list[k]);
      total -= dropped;
      groupStarts.shift();
    }
    return cut > 0 ? list.slice(cut) : list;
  }

  /** 粗略 token 估算（展示用）：CJK 记 ~1 token/字，其余 ~1 token/4 字符 */
  function estimateTokens(text) {
    var s = String(text == null ? '' : text);
    var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) || []).length;
    return Math.ceil(cjk + (s.length - cjk) / 4);
  }

  // 请求预算只计算协议字段，排除工具卡复制的 result 与持久化元数据。
  function estimateMessageTokens(msg, options) {
    var m = msg || {}, opts = options || {};
    if (m.role === 'error') return 0;
    var wire = { role: m.role, content: m.content || '' }, images = 0;
    if (Array.isArray(wire.content)) {
      wire.content = wire.content.filter(function (part) {
        if (part && (part.type === 'image' || part.type === 'image_url')) { images++; return false; }
        return true;
      });
    }
    if (m.role === 'tool') wire.tool_call_id = m.tool_call_id;
    if (m.role === 'assistant' && m.tool_calls) wire.tool_calls = m.tool_calls;
    if (m.role === 'assistant' && opts.replayReasoning && (m.reasoning || m.reasoning_content)) wire.reasoning_content = m.reasoning || m.reasoning_content;
    if (m.role === 'user' && opts.sendImages && m.images) images += m.images.length;
    // Image token accounting depends on model/resolution; use a nominal per-image estimate (not a provider upper bound)
    // rather than counting the tiny local reference (or the entire base64 string).
    return estimateTokens(JSON.stringify(wire)) + images * 1600;
  }

  function estimateRequestTokens(body) {
    var request = body || {}, total = 0;
    (request.messages || []).forEach(function (msg) { total += estimateMessageTokens(msg, { replayReasoning: true, sendImages: true }); });
    if (request.tools && request.tools.length) total += estimateTokens(JSON.stringify(request.tools));
    return total;
  }

  function recordInputUsage(state, usage, body) {
    var tokens = Number(usage && usage.prompt_tokens);
    if (!(tokens > 0) || usage.estimated === true) return;
    state.lastInputTokens = tokens;
    state.inputUsageBaseline = { tokens: tokens, estimate: estimateRequestTokens(body) };
  }

  function currentInputTokens(state, body) {
    var estimated = estimateRequestTokens(body), baseline = state.inputUsageBaseline;
    // Provider usage calibrates the previous request; add newly appended content.
    // A successful compaction invalidates the baseline, so stale usage cannot pin it.
    return baseline && baseline.tokens > 0 ? Math.max(estimated, baseline.tokens + estimated - baseline.estimate) : estimated;
  }

  function addTokens(state, usage) {
    if (!usage) return state;
    var inTok = Number(usage.prompt_tokens);
    var outTok = Number(usage.completion_tokens);
    if (isFinite(inTok) && inTok > 0) state.tokens.in += inTok;
    if (isFinite(outTok) && outTok > 0) state.tokens.out += outTok;
    return state;
  }

  /** 会话落盘/恢复：状态是纯 JSON（工具结果已在 append 时截断；compacted 标记随消息保留） */
  function serialize(state) {
    return JSON.parse(JSON.stringify({
      messages: state.messages,
      steps: state.steps,
      tokens: state.tokens,
      done: state.done,
      stopReason: state.stopReason,
      endReason: state.endReason || '',
      turnId: state.turnId || '',
      recentToolSignatures: state.recentToolSignatures,
      // 最近一次端点回报的输入 token（压缩触发的可信地板值；估算偏差靠它纠正）
      lastInputTokens: Number(state.lastInputTokens) || 0,
      inputUsageBaseline: state.inputUsageBaseline || null
    }));
  }

  function deserialize(data, options) {
    var state = initState(options);
    if (data && typeof data === 'object') {
      state.messages = Array.isArray(data.messages) ? data.messages : [];
      state.steps = Number(data.steps) || 0;
      state.tokens = data.tokens || { in: 0, out: 0 };
      state.done = data.done === true;
      state.stopReason = String(data.stopReason || '');
      state.endReason = String(data.endReason || '');
      state.turnId = String(data.turnId || '');
      state.recentToolSignatures = Array.isArray(data.recentToolSignatures) ? data.recentToolSignatures : [];
      state.lastInputTokens = Number(data.lastInputTokens) || 0;
      state.inputUsageBaseline = data.inputUsageBaseline || null;
    }
    return state;
  }

  function nowTs() { return new Date().toISOString(); }
  function genId(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 10);
  }

  return {
    DEFAULTS: DEFAULTS,
    initState: initState,
    parseToolArgs: parseToolArgs,
    beginTurn: beginTurn,
    appendUser: appendUser,
    appendAssistant: appendAssistant,
    appendToolResults: appendToolResults,
    decorateToolCalls: decorateToolCalls,
    pendingToolCalls: pendingToolCalls,
    safePendingToolCalls: safePendingToolCalls,
    shouldContinue: shouldContinue,
    isStuck: isStuck,
    truncateOutput: truncateOutput,
    buildRequestBody: buildRequestBody,
    normalizeImageRefs: normalizeImageRefs,
    estimateTokens: estimateTokens,
    estimateMessageTokens: estimateMessageTokens,
    estimateRequestTokens: estimateRequestTokens,
    recordInputUsage: recordInputUsage,
    currentInputTokens: currentInputTokens,
    addTokens: addTokens,
    trimWindowToBudget: trimWindowToBudget,
    historyCapFor: historyCapFor,
    serialize: serialize,
    deserialize: deserialize
  };
});
