/* LitBoard 端点协议适配层（纯函数，浏览器 / Node 共用，零依赖）
 *
 * 用户自配的「OpenAI 兼容」端点并不只有一种协议形态，同一个网关常按模型系列分流：
 * - chat      ：OpenAI Chat Completions（POST {base}/chat/completions）——绝大多数服务商；
 * - responses ：OpenAI Responses API（POST {base}/responses）——OpenAI 官方新面、
 *               OpenCode Zen/Go 上承载 Grok / GPT 系模型；
 * - messages  ：Anthropic Messages（POST {base}/v1/messages）——Anthropic 官方与
 *               「anthropic 兼容」网关（DeepSeek `…/anthropic`、智谱 `api/anthropic`、
 *               OpenCode `…/go/v1/messages`）。
 *
 * 本模块只做「给定协议形态，怎么发、怎么读」的纯计算：URL、请求头、请求体转换、
 * SSE 累积器。网络、配置、UI 都在别处——所以这三种形态都能用 node:test 直接覆盖。
 *
 * 两处端点硬要求（真机踩坑，写在这里免得再犯）：
 * 1. OpenCode Zen / Go 要求 `x-opencode-session` 带上**每会话稳定**的 ID，否则返回
 *    HTTP 400 `MissingSessionID`（"Request is missing x-opencode-session and cannot be
 *    routed efficiently"）；同时要求客户端自带 User-Agent 而非通用 HTTP 库名。
 * 2. Anthropic Messages 的 `max_tokens` 是**必填**；system 不是消息角色而是顶层字段；
 *    工具结果是 user 消息里的 `tool_result` 块，且相邻同角色消息必须合并。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentProto = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DIALECTS = { CHAT: 'chat', RESPONSES: 'responses', MESSAGES: 'messages' };
  var DIALECT_VALUES = ['chat', 'responses', 'messages'];
  var ANTHROPIC_VERSION = '2023-06-01';
  // Anthropic Messages 必填 max_tokens。对话请求的值来自渲染层的「最大输出」设置
  // （js/agentcore DEFAULTS.maxOutputTokens），这里只是给不带该字段的内部调用（连接测试等）兜底。
  var DEFAULT_MAX_TOKENS = 8192;
  var OPENCODE_HOST = /(^|\.)opencode\.ai$/;
  var ANTHROPIC_HOST = /(^|\.)anthropic\.com$/;
  var ANTHROPIC_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  /* OpenCode Zen / Go 官方文档把模型系列分到不同协议面（/responses 承载 Grok、GPT 系，
   * /messages 承载 MiniMax、Qwen，其余走 /chat/completions）。家族归属由上游调整，
   * 所以这层只在「没显式指定协议」时兜底，设置里的「接口格式」永远优先。 */
  var MODEL_DIALECT_RULES = [
    { dialect: DIALECTS.RESPONSES, pattern: /^(grok|gpt-5|gpt5|muse)/ },
    { dialect: DIALECTS.MESSAGES, pattern: /^(minimax|qwen|qwq)/ }
  ];

  function str(value) { return String(value == null ? '' : value); }

  function trimSlashes(value) { return str(value).trim().replace(/\/+$/, ''); }

  function parseUrl(value) {
    try { return new URL(str(value).trim()); } catch (error) { return null; }
  }

  function hostOf(baseUrl) {
    var url = parseUrl(baseUrl);
    return url ? url.hostname.toLowerCase() : '';
  }

  /** 路径（去掉尾部斜杠、小写）；非 URL 形态返回空串 */
  function pathOf(baseUrl) {
    var url = parseUrl(baseUrl);
    if (!url) return '';
    return url.pathname.replace(/\/+$/, '').toLowerCase();
  }

  function isOpenCodeHost(baseUrl) { return OPENCODE_HOST.test(hostOf(baseUrl)); }

  function isDialect(value) { return DIALECT_VALUES.indexOf(str(value).toLowerCase()) !== -1; }

  /** 模型名 → 协议面（仅 OpenCode 分流用；未识别返回空串 = 交给默认 chat） */
  function dialectForModel(model) {
    var tail = modelTail(model);
    if (!tail) return '';
    for (var i = 0; i < MODEL_DIALECT_RULES.length; i++) {
      if (MODEL_DIALECT_RULES[i].pattern.test(tail)) return MODEL_DIALECT_RULES[i].dialect;
    }
    return '';
  }

  /**
   * 判定协议形态。
   * options.dialect 为用户显式指定（'' / 'auto' = 自动）；options.model 参与 OpenCode 分流。
   * 自动判定顺序：显式指定 → URL 尾段（/messages、/responses、/anthropic）→ Anthropic 官方
   * 域名 → OpenCode 按模型系列 → chat。
   */
  function detectDialect(baseUrl, options) {
    var opts = options || {};
    var override = str(opts.dialect).trim().toLowerCase();
    if (isDialect(override)) return override;
    var path = pathOf(baseUrl);
    if (/\/messages$/.test(path)) return DIALECTS.MESSAGES;
    if (/\/responses$/.test(path)) return DIALECTS.RESPONSES;
    if (/\/anthropic$/.test(path)) return DIALECTS.MESSAGES;
    if (ANTHROPIC_HOST.test(hostOf(baseUrl))) return DIALECTS.MESSAGES;
    if (isOpenCodeHost(baseUrl)) {
      var byModel = dialectForModel(opts.model);
      if (byModel) return byModel;
    }
    return DIALECTS.CHAT;
  }

  /** 对话端点：base 已含该协议的完整尾段时原样使用，否则按协议补全路径 */
  function endpointFor(baseUrl, dialect) {
    var base = trimSlashes(baseUrl);
    var path = pathOf(base);
    var kind = isDialect(dialect) ? str(dialect).toLowerCase() : DIALECTS.CHAT;
    if (kind === DIALECTS.MESSAGES) {
      if (/\/messages$/.test(path)) return base;
      return (/\/v1$/.test(path) ? base : base + '/v1') + '/messages';
    }
    if (kind === DIALECTS.RESPONSES) {
      if (/\/responses$/.test(path)) return base;
      return (/\/v1$/.test(path) ? base : base + '/v1') + '/responses';
    }
    if (/\/chat\/completions$/.test(path)) return base;
    return base + '/chat/completions';
  }

  /** 模型清单端点：三种协议的 base 都收敛到 {prefix}/models */
  function modelsEndpointFor(baseUrl, dialect) {
    var base = trimSlashes(baseUrl);
    var path = pathOf(base);
    if (/\/(chat\/completions|responses|messages)$/.test(path)) {
      return base.replace(/\/(chat\/completions|responses|messages)$/i, '/models');
    }
    var kind = isDialect(dialect) ? str(dialect).toLowerCase() : DIALECTS.CHAT;
    // Anthropic 系的 base 惯例是服务根（api.anthropic.com / …/anthropic），清单在 /v1/models；
    // OpenAI 兼容的 base 惯例自带 /v1，直接接 /models。
    if (kind !== DIALECTS.CHAT && !/\/v1$/.test(path)) return base + '/v1/models';
    return base + '/models';
  }

  /** 嵌入端点（只有 OpenAI 兼容形态）：去掉对话尾段再拼 /embeddings */
  function embeddingsEndpointFor(baseUrl) {
    return trimSlashes(baseUrl).replace(/\/(chat\/completions|responses|messages)$/i, '') + '/embeddings';
  }

  /**
   * 请求头。三种协议的鉴权形态不同（Bearer / x-api-key + anthropic-version）。
   * OpenCode 端点额外带 `x-opencode-session`：同一会话内必须稳定，用于其路由与
   * prompt 缓存——缺了会 400 MissingSessionID。
   */
  function buildHeaders(input) {
    var opts = input || {};
    var dialect = isDialect(opts.dialect) ? str(opts.dialect).toLowerCase() : DIALECTS.CHAT;
    var headers = { 'Content-Type': 'application/json' };
    if (dialect === DIALECTS.MESSAGES) {
      headers['x-api-key'] = str(opts.apiKey);
      headers['anthropic-version'] = str(opts.anthropicVersion) || ANTHROPIC_VERSION;
    } else {
      headers.Authorization = 'Bearer ' + str(opts.apiKey);
    }
    var userAgent = str(opts.userAgent).trim();
    if (userAgent) headers['User-Agent'] = userAgent;
    if (isOpenCodeHost(opts.baseUrl)) {
      headers['x-opencode-session'] = str(opts.sessionId).trim() || 'litboard';
    }
    return headers;
  }

  /* ------------------------------------------------------------------
   * 请求体转换：内部消息一律 OpenAI chat 形态（agentcore 的契约），发往非 chat 协议时转换
   * ------------------------------------------------------------------ */

  function textOf(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(function (part) {
        return part && typeof part.text === 'string' ? part.text : '';
      }).join('');
    }
    return content == null ? '' : str(content);
  }

  function parseJsonObject(text) {
    if (text && typeof text === 'object') return text;
    if (typeof text !== 'string' || !text.trim()) return {};
    try {
      var parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) { return {}; }
  }

  /** 内部 user 内容（字符串或 parts）→ Responses 输入内容 */
  function responsesUserContent(content) {
    if (!Array.isArray(content)) return textOf(content);
    var parts = [];
    content.forEach(function (part) {
      if (!part) return;
      if (part.type === 'text') parts.push({ type: 'input_text', text: str(part.text) });
      else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
        parts.push({ type: 'input_image', image_url: str(part.image_url.url) });
      }
    });
    return parts.length ? parts : textOf(content);
  }

  /** data URL → { mediaType, data }；非 data URL 返回 null */
  function splitDataUrl(url) {
    var match = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(str(url));
    if (!match) return null;
    var mime = match[1].toLowerCase();
    if (!match[2]) return null; // 只接受 base64 形态
    return { mediaType: mime, data: match[3] };
  }

  /** 内部 user 内容 → Anthropic content 块数组（图像走 base64 / url source） */
  function messagesUserBlocks(content) {
    if (!Array.isArray(content)) {
      var text = textOf(content);
      return text ? [{ type: 'text', text: text }] : [];
    }
    var blocks = [];
    content.forEach(function (part) {
      if (!part) return;
      if (part.type === 'text') { blocks.push({ type: 'text', text: str(part.text) }); return; }
      if (part.type !== 'image_url' || !part.image_url || !part.image_url.url) return;
      var url = str(part.image_url.url);
      var data = splitDataUrl(url);
      if (data) {
        if (ANTHROPIC_IMAGE_MIME.indexOf(data.mediaType) === -1) return; // 不支持的媒体类型直接丢
        blocks.push({ type: 'image', source: { type: 'base64', media_type: data.mediaType, data: data.data } });
        return;
      }
      if (/^https?:\/\//i.test(url)) blocks.push({ type: 'image', source: { type: 'url', url: url } });
    });
    return blocks;
  }

  /** 追加一个角色消息；相邻同角色合并（Anthropic 要求消息交替，工具结果也并进 user） */
  function pushBlocks(list, role, blocks) {
    if (!blocks || !blocks.length) return;
    var last = list[list.length - 1];
    if (last && last.role === role) {
      last.content = last.content.concat(blocks);
      return;
    }
    list.push({ role: role, content: blocks.slice() });
  }

  /** 模型名的家族段（网关惯用 `vendor/model` 前缀） */
  function modelTail(model) {
    var name = str(model).trim().toLowerCase();
    return name.indexOf('/') >= 0 ? name.slice(name.lastIndexOf('/') + 1) : name;
  }

  /** OpenAI 官方推理系模型（o 系 / gpt-5）在 chat/completions 上**拒收** `max_tokens`
   *  （HTTP 400 Unsupported parameter），必须改发 `max_completion_tokens`；其余模型按旧字段发
   *  （第三方兼容网关普遍只认 `max_tokens`，不能一律改名）。 */
  var OPENAI_REASONING_MODEL = /^(o[1-9]|gpt-5|gpt5)/;

  /** → OpenAI Chat Completions（原样透传 + 输出上限的字段名适配） */
  function toChatBody(body) {
    var src = body || {};
    if (!(Number(src.max_tokens) > 0) || !OPENAI_REASONING_MODEL.test(modelTail(src.model))) return src;
    var out = {};
    Object.keys(src).forEach(function (key) { if (key !== 'max_tokens') out[key] = src[key]; });
    out.max_completion_tokens = Math.floor(Number(src.max_tokens));
    return out;
  }

  /** → OpenAI Responses API（input items + 扁平工具 schema；store:false 不留给上游持久化） */
  function toResponsesBody(body, options) {
    var src = body || {};
    var opts = options || {};
    var out = { store: false, stream: opts.stream !== false };
    if (src.model) out.model = src.model;
    if (src.max_tokens) out.max_output_tokens = Number(src.max_tokens);
    if (src.reasoning_effort) out.reasoning = { effort: str(src.reasoning_effort) };
    var instructions = [];
    var input = [];
    (Array.isArray(src.messages) ? src.messages : []).forEach(function (message) {
      if (!message) return;
      if (message.role === 'system') { instructions.push(textOf(message.content)); return; }
      if (message.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: str(message.tool_call_id),
          output: message.content == null ? '' : str(message.content)
        });
        return;
      }
      if (message.role === 'assistant') {
        if (message.content) input.push({ role: 'assistant', content: textOf(message.content) });
        (Array.isArray(message.tool_calls) ? message.tool_calls : []).forEach(function (call) {
          if (!call) return;
          input.push({
            type: 'function_call',
            call_id: str(call.id),
            name: str(call.function && call.function.name),
            arguments: str(call.function && call.function.arguments) || '{}'
          });
        });
        return;
      }
      input.push({ role: 'user', content: responsesUserContent(message.content) });
    });
    if (instructions.length) out.instructions = instructions.join('\n\n');
    out.input = input;
    if (Array.isArray(src.tools) && src.tools.length) {
      out.tools = src.tools.map(function (tool) {
        var fn = (tool && tool.function) || {};
        var flat = { type: 'function', name: str(fn.name), parameters: fn.parameters || { type: 'object', properties: {} } };
        if (fn.description) flat.description = str(fn.description);
        return flat;
      });
    }
    return out;
  }

  /**
   * → Anthropic Messages。差异都在这里抹平：
   * system 提到顶层；工具结果并进紧随其后的 user 消息块；工具 schema 用 input_schema；
   * max_tokens 必填；推理参数只透传 Anthropic 自己的 `thinking:{type:'enabled',…}` 形态
   * （OpenAI 形态的 reasoning_effort / thinking.type='disabled' 在这里丢弃——发过去只会 400，
   * 该端点的思考开关由服务商默认值决定）。
   */
  function toMessagesBody(body, options) {
    var src = body || {};
    var opts = options || {};
    var out = {
      stream: opts.stream !== false,
      max_tokens: Number(src.max_tokens) > 0 ? Number(src.max_tokens) : DEFAULT_MAX_TOKENS
    };
    if (src.model) out.model = src.model;
    if (src.temperature != null) out.temperature = src.temperature;
    if (src.thinking && src.thinking.type === 'enabled') {
      out.thinking = {
        type: 'enabled',
        budget_tokens: Number(src.thinking.budget_tokens) > 0 ? Number(src.thinking.budget_tokens) : 4096
      };
    }
    var systems = [];
    var messages = [];
    (Array.isArray(src.messages) ? src.messages : []).forEach(function (message) {
      if (!message) return;
      if (message.role === 'system') { systems.push(textOf(message.content)); return; }
      if (message.role === 'tool') {
        pushBlocks(messages, 'user', [{
          type: 'tool_result',
          tool_use_id: str(message.tool_call_id),
          content: message.content == null ? '' : str(message.content)
        }]);
        return;
      }
      if (message.role === 'assistant') {
        var blocks = [];
        if (message.content) blocks.push({ type: 'text', text: textOf(message.content) });
        (Array.isArray(message.tool_calls) ? message.tool_calls : []).forEach(function (call) {
          if (!call) return;
          blocks.push({
            type: 'tool_use',
            id: str(call.id),
            name: str(call.function && call.function.name),
            input: parseJsonObject(call.function && call.function.arguments)
          });
        });
        pushBlocks(messages, 'assistant', blocks);
        return;
      }
      pushBlocks(messages, 'user', messagesUserBlocks(message.content));
    });
    if (systems.length) out.system = systems.join('\n\n');
    out.messages = messages;
    if (Array.isArray(src.tools) && src.tools.length) {
      out.tools = src.tools.map(function (tool) {
        var fn = (tool && tool.function) || {};
        var converted = { name: str(fn.name), input_schema: fn.parameters || { type: 'object', properties: {} } };
        if (fn.description) converted.description = str(fn.description);
        return converted;
      });
    }
    return out;
  }

  /** 内部 OpenAI 形态请求体 → 目标协议请求体 */
  function convertBody(body, dialect) {
    var kind = isDialect(dialect) ? str(dialect).toLowerCase() : DIALECTS.CHAT;
    if (kind === DIALECTS.MESSAGES) return toMessagesBody(body, {});
    if (kind === DIALECTS.RESPONSES) return toResponsesBody(body, {});
    return toChatBody(body);
  }

  /* ------------------------------------------------------------------
   * SSE 累积器：三种协议都归一成同一份产物
   * { content, reasoning_content?, tool_calls[{id,type,function{name,arguments}}] }
   * 事件词表与 chat 一致（delta / reasoning_delta / tool_call / _closed），
   * 渲染层与 agentloop 不需要知道背后是哪种协议。
   * ------------------------------------------------------------------ */

  /** OpenAI Chat Completions（原实现，逐字保留行为） */
  function createChatAccumulator() {
    var state = { content: '', reasoning: '', toolCalls: {}, usage: null, finishReason: '', sawDone: false };

    function pushLine(line) {
      var events = [];
      var trimmed = str(line == null ? '' : line).trim();
      if (!trimmed || trimmed.indexOf('data:') !== 0) return events;
      var payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        state.sawDone = true;
        events.push({ type: '_closed' });
        return events;
      }
      var json = null;
      try { json = JSON.parse(payload); } catch (error) { return events; }
      if (json && json.error) {
        var err = new Error(str(json.error.message || JSON.stringify(json.error)));
        err.upstream = true;
        throw err;
      }
      var choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
      var delta = choice && choice.delta;
      if (choice && choice.finish_reason) state.finishReason = str(choice.finish_reason);
      if (json && json.usage) state.usage = json.usage;
      if (delta && typeof delta.content === 'string' && delta.content) {
        state.content += delta.content;
        events.push({ type: 'delta', text: delta.content });
      }
      // 推理增量：DeepSeek 用 reasoning_content，OpenRouter 等用 reasoning
      var reasoningText = delta && (typeof delta.reasoning_content === 'string' ? delta.reasoning_content
        : (typeof delta.reasoning === 'string' ? delta.reasoning : ''));
      if (reasoningText) {
        state.reasoning += reasoningText;
        events.push({ type: 'reasoning_delta', text: reasoningText });
      }
      if (delta && Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach(function (fragment) {
          var index = Number(fragment && fragment.index) || 0;
          if (!state.toolCalls[index]) {
            state.toolCalls[index] = { id: '', name: '', args: '' };
          }
          var slot = state.toolCalls[index];
          if (fragment.id) slot.id = str(fragment.id);
          if (fragment.function && fragment.function.name) slot.name += str(fragment.function.name);
          if (fragment.function && typeof fragment.function.arguments === 'string') {
            slot.args += fragment.function.arguments;
          }
          if (slot.name && !slot.announced) {
            slot.announced = true;
            events.push({ type: 'tool_call', name: slot.name });
          }
        });
      }
      return events;
    }

    function message() {
      var indexes = Object.keys(state.toolCalls).map(Number).sort(function (a, b) { return a - b; });
      var out = { role: 'assistant', content: state.content };
      if (state.reasoning) out.reasoning_content = state.reasoning;
      if (indexes.length) {
        out.tool_calls = indexes.map(function (index) {
          var slot = state.toolCalls[index];
          return {
            id: slot.id || ('call_' + index),
            type: 'function',
            function: { name: slot.name, arguments: slot.args || '{}' }
          };
        });
      }
      return out;
    }

    return {
      state: state,
      pushLine: pushLine,
      message: message,
      getUsage: function () { return state.usage; },
      getFinishReason: function () { return state.finishReason; },
      sawDone: function () { return state.sawDone; }
    };
  }

  /** 归一化槽位表（responses 按 item id 记账、messages 按 content block index） */
  function createSlots() {
    var slots = {};
    var order = [];
    return {
      at: function (key) {
        if (!slots[key]) { slots[key] = { id: '', name: '', args: '', announced: false }; order.push(key); }
        return slots[key];
      },
      list: function () {
        return order.map(function (key) { return slots[key]; }).filter(function (slot) { return slot.name; });
      }
    };
  }

  function normalizeUsage(usage) {
    if (!usage) return null;
    var inTokens = Number(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
    var outTokens = Number(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens);
    if (!isFinite(inTokens) && !isFinite(outTokens)) return null;
    return {
      prompt_tokens: isFinite(inTokens) ? inTokens : 0,
      completion_tokens: isFinite(outTokens) ? outTokens : 0,
      total_tokens: isFinite(inTokens) && isFinite(outTokens) ? inTokens + outTokens : undefined
    };
  }

  /** OpenAI Responses API 流（response.* 事件） */
  function createResponsesAccumulator() {
    var state = { content: '', reasoning: '', usage: null, finishReason: '', sawDone: false };
    var slots = createSlots();
    var hasCalls = false;
    var byItem = {};

    function close(finishReason) {
      state.sawDone = true;
      if (finishReason) state.finishReason = finishReason;
      else if (hasCalls) state.finishReason = 'tool_calls';
      else state.finishReason = 'stop';
    }

    function pushLine(line) {
      var events = [];
      var trimmed = str(line == null ? '' : line).trim();
      if (!trimmed || trimmed.indexOf('data:') !== 0) return events;
      var payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { close(); events.push({ type: '_closed' }); return events; }
      var json = null;
      try { json = JSON.parse(payload); } catch (error) { return events; }
      var type = str(json && json.type);
      if (json && json.error && !type) {
        var bad = new Error(str(json.error.message || JSON.stringify(json.error)));
        bad.upstream = true;
        throw bad;
      }
      if (type === 'error' || type === 'response.failed') {
        var detail = json.error || (json.response && json.response.error);
        var failed = new Error(str((detail && detail.message) || 'Responses API 返回失败'));
        failed.upstream = true;
        throw failed;
      }
      if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
        var text = str(json.delta);
        if (text) { state.content += text; events.push({ type: 'delta', text: text }); }
        return events;
      }
      if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        var thinking = str(json.delta);
        if (thinking) { state.reasoning += thinking; events.push({ type: 'reasoning_delta', text: thinking }); }
        return events;
      }
      if (type === 'response.output_item.added' && json.item && json.item.type === 'function_call') {
        var item = json.item;
        var key = str(item.id || item.call_id || json.output_index);
        byItem[str(item.id || '')] = key;
        var slot = slots.at(key);
        slot.id = str(item.call_id || item.id);
        slot.name = str(item.name);
        slot.args = str(item.arguments);
        hasCalls = true;
        if (slot.name && !slot.announced) { slot.announced = true; events.push({ type: 'tool_call', name: slot.name }); }
        return events;
      }
      if (type === 'response.function_call_arguments.delta') {
        var target = slots.at(byItem[str(json.item_id)] || str(json.item_id));
        target.args += str(json.delta);
        return events;
      }
      if (type === 'response.function_call_arguments.done') {
        // done 事件带权威全量参数：以它为准，避免分片丢包后拼出坏 JSON
        slots.at(byItem[str(json.item_id)] || str(json.item_id)).args = str(json.arguments);
        return events;
      }
      if (type === 'response.completed') {
        var response = json.response || {};
        state.usage = normalizeUsage(response.usage) || state.usage;
        close('');
        events.push({ type: '_closed' });
        return events;
      }
      if (type === 'response.incomplete') {
        var incomplete = json.response || {};
        state.usage = normalizeUsage(incomplete.usage) || state.usage;
        close('length'); // 归一成 OpenAI 口径，上游按「截断」呈现并可手动重试
        events.push({ type: '_closed' });
        return events;
      }
      return events;
    }

    function message() {
      var out = { role: 'assistant', content: state.content };
      if (state.reasoning) out.reasoning_content = state.reasoning;
      var calls = slots.list();
      if (calls.length) {
        out.tool_calls = calls.map(function (slot) {
          return {
            id: slot.id || 'call_0',
            type: 'function',
            function: { name: slot.name, arguments: slot.args || '{}' }
          };
        });
      }
      return out;
    }

    return {
      state: state,
      pushLine: pushLine,
      message: message,
      getUsage: function () { return state.usage; },
      getFinishReason: function () { return state.finishReason; },
      sawDone: function () { return state.sawDone; }
    };
  }

  /** Anthropic Messages 流（message_start / content_block_* / message_delta / message_stop） */
  function createMessagesAccumulator() {
    var state = { content: '', reasoning: '', usage: null, finishReason: '', sawDone: false };
    var slots = createSlots();
    var hasCalls = false;
    var inTokens = 0;

    // Anthropic stop_reason → OpenAI finish_reason（上游按同一套口径判定截断/工具）
    function mapStopReason(reason) {
      var value = str(reason);
      if (value === 'max_tokens') return 'length';
      if (value === 'tool_use') return 'tool_calls';
      if (value === 'end_turn' || value === 'stop_sequence' || value === 'refusal') return 'stop';
      return value;
    }

    function pushLine(line) {
      var events = [];
      var trimmed = str(line == null ? '' : line).trim();
      if (!trimmed || trimmed.indexOf('data:') !== 0) return events;
      var payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { state.sawDone = true; events.push({ type: '_closed' }); return events; }
      var json = null;
      try { json = JSON.parse(payload); } catch (error) { return events; }
      var type = str(json && json.type);
      if (type === 'error') {
        var detail = json.error || {};
        var failed = new Error(str(detail.message || JSON.stringify(json.error || {})));
        failed.upstream = true;
        throw failed;
      }
      if (type === 'message_start') {
        var startUsage = (json.message && json.message.usage) || {};
        inTokens = Number(startUsage.input_tokens) || 0;
        state.usage = normalizeUsage({
          prompt_tokens: inTokens,
          completion_tokens: Number(startUsage.output_tokens) || 0
        }) || state.usage;
        return events;
      }
      if (type === 'content_block_start') {
        var block = json.content_block || {};
        var key = 'block_' + str(json.index);
        if (block.type === 'tool_use') {
          var slot = slots.at(key);
          slot.id = str(block.id);
          slot.name = str(block.name);
          slot.args = block.input && Object.keys(block.input).length ? JSON.stringify(block.input) : '';
          hasCalls = true;
          if (slot.name && !slot.announced) { slot.announced = true; events.push({ type: 'tool_call', name: slot.name }); }
        }
        return events;
      }
      if (type === 'content_block_delta') {
        var delta = json.delta || {};
        if (delta.type === 'text_delta' && delta.text) {
          state.content += str(delta.text);
          events.push({ type: 'delta', text: str(delta.text) });
          return events;
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
          state.reasoning += str(delta.thinking);
          events.push({ type: 'reasoning_delta', text: str(delta.thinking) });
          return events;
        }
        if (delta.type === 'input_json_delta' && delta.partial_json) {
          var target = slots.at('block_' + str(json.index));
          if (target.args && target.args !== '{}') target.args += str(delta.partial_json);
          else target.args = str(delta.partial_json);
          return events;
        }
        return events;
      }
      if (type === 'message_delta') {
        var deltaPayload = json.delta || {};
        if (deltaPayload.stop_reason) state.finishReason = mapStopReason(deltaPayload.stop_reason);
        var usage = json.usage || {};
        if (usage.output_tokens != null || usage.input_tokens != null) {
          state.usage = normalizeUsage({
            prompt_tokens: Number(usage.input_tokens != null ? usage.input_tokens : inTokens) || 0,
            completion_tokens: Number(usage.output_tokens) || 0
          }) || state.usage;
        }
        return events;
      }
      if (type === 'message_stop') {
        state.sawDone = true;
        if (!state.finishReason) state.finishReason = hasCalls ? 'tool_calls' : 'stop';
        events.push({ type: '_closed' });
        return events;
      }
      return events;
    }

    function message() {
      var out = { role: 'assistant', content: state.content };
      if (state.reasoning) out.reasoning_content = state.reasoning;
      var calls = slots.list();
      if (calls.length) {
        out.tool_calls = calls.map(function (slot) {
          return {
            id: slot.id || 'call_0',
            type: 'function',
            function: { name: slot.name, arguments: slot.args || '{}' }
          };
        });
      }
      return out;
    }

    return {
      state: state,
      pushLine: pushLine,
      message: message,
      getUsage: function () { return state.usage; },
      getFinishReason: function () { return state.finishReason; },
      sawDone: function () { return state.sawDone; }
    };
  }

  function createAccumulator(dialect) {
    var kind = isDialect(dialect) ? str(dialect).toLowerCase() : DIALECTS.CHAT;
    if (kind === DIALECTS.MESSAGES) return createMessagesAccumulator();
    if (kind === DIALECTS.RESPONSES) return createResponsesAccumulator();
    return createChatAccumulator();
  }

  return {
    DIALECTS: DIALECTS,
    DIALECT_VALUES: DIALECT_VALUES,
    ANTHROPIC_VERSION: ANTHROPIC_VERSION,
    DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS,
    detectDialect: detectDialect,
    dialectForModel: dialectForModel,
    isOpenCodeHost: isOpenCodeHost,
    endpointFor: endpointFor,
    modelsEndpointFor: modelsEndpointFor,
    embeddingsEndpointFor: embeddingsEndpointFor,
    buildHeaders: buildHeaders,
    convertBody: convertBody,
    toChatBody: toChatBody,
    toResponsesBody: toResponsesBody,
    toMessagesBody: toMessagesBody,
    createAccumulator: createAccumulator,
    createChatAccumulator: createChatAccumulator,
    createResponsesAccumulator: createResponsesAccumulator,
    createMessagesAccumulator: createMessagesAccumulator
  };
});
