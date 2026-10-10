'use strict';

/**
 * LitBoard AI 助手网络层（主进程专用）：自配端点 + SSE 流式。
 *
 * 设计要点：
 * - 「OpenAI 兼容」不止一种协议形态：chat/completions（默认）、Responses API、
 *   Anthropic Messages——三者的 URL、鉴权头、请求体、SSE 事件都不同，全部由纯函数层
 *   `js/agentproto.js` 适配；本文件只管网络、流读取与错误语义；
 * - OpenCode Zen / Go 端点要求 `x-opencode-session`（每会话稳定 ID），由 agentproto 注入；
 * - Base URL 校验：https 必须；仅 localhost / 127.0.0.1 / [::1] 豁免 http（给 ollama）；
 * - 流式 delta 经 notify('agent:event') 增量推送，最终消息作为 invoke 返回值；
 * - AbortController 按 sessionId 记账，渲染层可随时停止；
 * - 只对明确 HTTP 暂态拒绝或连接建立前失败有限重试；已流出内容绝不自动重发。
 */
const LitAgentCore = require('../js/agentcore.js');
const LitAgentProto = require('../js/agentproto.js');

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** 校验并规范化用户自配 Base URL（roadmap 网络出口红线的落点：显式校验，不静默放行） */
function validateBaseUrl(raw) {
  const input = String(raw == null ? '' : raw).trim();
  if (!input) throw new Error('AI 助手 Base URL 未配置');
  let url = null;
  try { url = new URL(input); } catch (error) {}
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) {
    throw new Error('AI 助手 Base URL 无效：' + input);
  }
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    throw new Error('AI 助手 Base URL 必须使用 https（本地服务可用 http）');
  }
  return input.replace(/\/+$/, '');
}

/** 从 /models 响应中提取模型 id（兼容 OpenAI {data:[{id}]} 与裸数组两种形态） */
function extractModelIds(payload) {
  const list = payload && Array.isArray(payload.data) ? payload.data
    : (Array.isArray(payload) ? payload : (payload && Array.isArray(payload.models) ? payload.models : []));
  const ids = [];
  list.forEach(function (item) {
    const id = typeof item === 'string' ? item : (item && (item.id || item.model || item.name));
    if (id && ids.indexOf(String(id)) === -1) ids.push(String(id));
  });
  return ids.sort();
}

function createAgentNet(options) {
  const opts = options || {};
  const fetchImpl = opts.fetch;
  const getConfig = opts.getConfig || async function () { return {}; };
  const notify = opts.notify || function () {};
  // 出网身份：OpenCode 等网关要求客户端自带 User-Agent（不要通用 HTTP 库名）
  const userAgent = String(opts.userAgent || '').trim() || 'LitBoard';
  // 「服务商 + 模型」清单（设置页按 id 测试/拉取清单时解析该服务商自己那把 Key）
  const getProvider = opts.getProvider || async function () { return null; };
  const controllers = new Map();

  /* R03：按轮固定端点凭据——同一轮（sessionId|turnId）的续请求（模型→工具→模型…）
   * 即使配置中途被改，也继续用轮开始时的 Base URL + Key + 协议形态；新轮重读配置。
   * Key 只存主进程（渲染层只送 turnId，不接触凭据）。固定条目上限 50，超出按插入序淘汰。 */
  const turnPins = new Map();
  const TURN_PIN_CAP = 50;

  function emit(sessionId, payload) {
    notify('agent:event', Object.assign({ sessionId: sessionId }, payload));
  }

  /** 协议形态：显式设置优先，其次 URL 尾段 / 域名 / OpenCode 模型系列分流 */
  function resolveDialect(base, cfg, model, override) {
    const explicit = override != null && override !== '' ? override : cfg.agentApiDialect;
    return LitAgentProto.detectDialect(base, { dialect: explicit, model: model });
  }

  /** 流式对话：deltas 经 agent:event 推送；invoke 返回最终消息（或 aborted） */
  async function chatStream(input) {
    const sessionId = String(input && input.sessionId || '');
    const turnId = String(input && input.turnId || '');
    const body = input && input.body;
    if (!sessionId || !body || !Array.isArray(body.messages)) throw new Error('无效的对话请求');
    // R17：quiet = 内部调用（上下文压缩摘要）——不向渲染层推流式事件（摘要文本不该刷进对话），
    // 结果与用量照常经 invoke 返回，由调用方落账
    const pushEvent = input && input.quiet === true ? function () {} : emit;
    const cfg = await getConfig();
    let base = validateBaseUrl(cfg.agentBaseUrl);
    if (!cfg.agentApiKey) throw new Error('AI 助手 API Key 未配置');
    const model = String(body.model || cfg.agentModel || '');
    let dialect = resolveDialect(base, cfg, model);
    if (turnId) {
      const pinKey = sessionId + '|' + turnId;
      if (turnPins.has(pinKey)) {
        const pin = turnPins.get(pinKey);
        base = pin.baseUrl;                      // 本轮已固定：沿用轮开始时的端点与协议
        dialect = pin.dialect;
      } else {
        if (turnPins.size >= TURN_PIN_CAP) turnPins.delete(turnPins.keys().next().value);
        turnPins.set(pinKey, { baseUrl: base, apiKey: cfg.agentApiKey, dialect: dialect });
      }
    }
    const apiKey = turnId && turnPins.has(sessionId + '|' + turnId)
      ? turnPins.get(sessionId + '|' + turnId).apiKey
      : cfg.agentApiKey;
    const controller = new AbortController();
    controllers.set(sessionId, controller);
    const acc = LitAgentProto.createAccumulator(dialect);
    const requestBody = Object.assign({}, body);
    if (model) requestBody.model = model;
    try {
      let response;
      for (let attempt = 0; ; attempt++) {
        try { response = await fetchImpl(LitAgentProto.endpointFor(base, dialect), {
        method: 'POST',
        headers: LitAgentProto.buildHeaders({
          dialect: dialect,
          apiKey: apiKey,
          baseUrl: base,
          sessionId: 'litboard-' + sessionId,
          userAgent: userAgent
        }),
        body: JSON.stringify(LitAgentProto.convertBody(requestBody, dialect)),
        signal: controller.signal
        }); } catch (connectError) {
          const code = connectError && (connectError.code || connectError.cause && connectError.cause.code);
          if (attempt >= 2 || !['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code) || controller.signal.aborted) throw connectError;
          await retryDelay(500 * Math.pow(2, attempt), controller.signal);
          continue;
        }
        if (response.ok || attempt >= 2 || ![429, 502, 503, 504].includes(response.status)) break;
        const retryAfter = response.headers && response.headers.get ? response.headers.get('retry-after') : '';
        const afterMs = retryAfter ? (/^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : 0;
        // Large server delays are not shortened: surface the error for a later continuation.
        if (afterMs > 10000) break;
        await Promise.resolve(response.text()).catch(function () {});
        const delay = Math.max(500 * Math.pow(2, attempt), Number.isFinite(afterMs) ? afterMs : 0);
        pushEvent(sessionId, { type: 'retry_wait', attempt: attempt + 1, delayMs: delay });
        await retryDelay(delay, controller.signal);
      }
      if (!response.ok) {
        const text = await Promise.resolve(response.text()).catch(function () { return ''; });
        const snippet = String(text || '').slice(0, 300);
        throw new Error('AI 服务返回 HTTP ' + response.status + (snippet ? '：' + snippet : ''));
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        throw new Error('AI 服务未返回流式响应');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let closed = false;
      let idleTimedOut = false;
      // A05：流空闲超时——单个 read 迟迟不出数据（服务卡住/连接假死）时主动断开，
      // 避免界面永远停在「生成中」。超时按「已有部分内容」走 partial 返回，不丢已见文字。
      const IDLE_TIMEOUT_MS = 120000;
      let idleTimer = setTimeout(function () {
        idleTimedOut = true;
        controller.abort();
      }, IDLE_TIMEOUT_MS);
      const processLine = function (line) {
        const events = acc.pushLine(line);
        for (const ev of events) {
          if (ev.type === '_closed') { closed = true; }
          else pushEvent(sessionId, ev);
        }
      };
      try {
        while (true) {
          const chunk = await reader.read();
          clearTimeout(idleTimer);
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let at = -1;
          while ((at = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, at).replace(/\r$/, '');
            buffer = buffer.slice(at + 1);
            processLine(line);
          }
          idleTimer = setTimeout(function () {
            idleTimedOut = true;
            controller.abort();
          }, IDLE_TIMEOUT_MS);
        }
        clearTimeout(idleTimer);
        // 尾部无换行的最后一行也要处理（A05：部分服务不以 \n 结尾）
        if (buffer.trim()) processLine(buffer.replace(/\r$/, ''));
        buffer = '';
      } catch (readError) {
        clearTimeout(idleTimer);
        if (!controller.signal.aborted) throw readError;
      }
      const message = acc.message();
      const finishReason = acc.getFinishReason();
      if (controller.signal.aborted && !idleTimedOut) {
        // 用户主动停止：保留已生成的部分
        pushEvent(sessionId, { type: 'aborted' });
        return { aborted: true, message: message, finishReason: finishReason };
      }
      if (idleTimedOut) {
        pushEvent(sessionId, { type: 'error', errorText: '流空闲超时（120 秒无数据）' });
        return { partial: true, message: message, usage: acc.getUsage() || estimateUsage(body, message), errorText: '流空闲超时（120 秒无数据）', finishReason: finishReason };
      }
      const incomplete = !closed || finishReason === 'length';
      if (incomplete) {
        // 异常 EOF（没有 [DONE] 结束标记）或 finish_reason=length（模型输出被截断）：
        // 不算成功——内容保留但打上截断标记，交给上层以「可能被截断」呈现并允许手动重试
        const reason = finishReason === 'length'
          ? '模型输出达到长度上限，回复被截断'
          : '连接在回复结束前中断';
        pushEvent(sessionId, { type: 'stream_incomplete', errorText: reason });
        return { partial: true, message: message, usage: acc.getUsage() || estimateUsage(body, message), errorText: reason, finishReason: finishReason };
      }
      pushEvent(sessionId, { type: 'done', finishReason: finishReason });
      return { message: message, usage: acc.getUsage() || estimateUsage(body, message), finishReason: finishReason };
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        const partial = acc.message();
        pushEvent(sessionId, { type: 'aborted' });
        return { aborted: true, message: partial };
      }
      // 普通网络异常：若已经流出部分内容，一并带回（A05：不让已显示的文字消失）
      const partialMessage = acc.message();
      if (partialMessage.content || partialMessage.reasoning_content || (partialMessage.tool_calls && partialMessage.tool_calls.length)) {
        const errorText = String(error && error.message || error);
        pushEvent(sessionId, { type: 'error', errorText: errorText });
        return { partial: true, message: partialMessage, usage: acc.getUsage() || estimateUsage(body, partialMessage), errorText: errorText };
      }
      throw error;
    } finally {
      // H3：只删自己的控制器——被后写者顶掉的旧请求不得删掉别人的停止入口
      if (controllers.get(sessionId) === controller) controllers.delete(sessionId);
    }
  }

  function retryDelay(ms, signal) {
    if (opts.sleep) return opts.sleep(ms, signal);
    return new Promise(function (resolve, reject) {
      if (signal.aborted) { const error = new Error('已停止'); error.name = 'AbortError'; reject(error); return; }
      const timer = setTimeout(function () { signal.removeEventListener('abort', stopped); resolve(); }, ms);
      function stopped() { clearTimeout(timer); const error = new Error('已停止'); error.name = 'AbortError'; reject(error); }
      signal.addEventListener('abort', stopped, { once: true });
    });
  }

  /** 端点用量未知时的粗估（有 usage 时优先用真实值）。A14 修复：
   * 旧实现对「字符数这个数字的字符串」做估算；现在对完整请求文本估算，
   * 并计入工具 schema 与系统提示的开销，estimated:true 标注非端点实测值。 */
  function estimateUsage(body, message) {
    const outText = String(message && message.content || '') +
      (message && message.tool_calls ? JSON.stringify(message.tool_calls) : '');
    return {
      prompt_tokens: LitAgentCore.estimateRequestTokens(body),
      completion_tokens: LitAgentCore.estimateTokens(outText),
      estimated: true
    };
  }

  function cancel(sessionId) {
    const controller = controllers.get(String(sessionId || ''));
    if (controller) controller.abort();
    return !!controller;
  }

  /** 设置页按 providerId 调用（测试连接 / 拉取模型）时的目标解析：
   *  表单里刚敲的值优先 → 该服务商已存的凭据 → 当前生效配置。
   *  用户没重填 Key 时也要能测——所以由主进程解自己存的那把，明文不出主进程。 */
  async function resolveTarget(input, cfg) {
    const provider = input.providerId ? await getProvider(String(input.providerId)) : null;
    if (input.providerId && !provider) throw new Error('服务商不存在或已被删除，请重新选择');
    const base = validateBaseUrl(input.baseUrl || (provider && provider.baseUrl) || cfg.agentBaseUrl);
    // 指定了服务商就只用它自己的 Key：回落当前生效配置会把别的账号的凭据打到该端点上
    // （比报「Key 未配置」危险得多），所以这里没有跨服务商的兜底。
    const apiKey = input.apiKey || (provider ? provider.apiKey : cfg.agentApiKey) || '';
    const model = String(input.model || (provider && provider.model) || cfg.agentModel || '');
    const providerCfg = provider ? { agentApiDialect: provider.dialect } : cfg;
    return { base: base, apiKey: apiKey, model: model, dialect: resolveDialect(base, providerCfg, model, input.dialect) };
  }

  /** 连接测试：非流式最小请求，一次成败（不重试）。
   * 协议形态随 Base URL 判定（也可由设置显式指定）——Anthropic 兼容端点走 /v1/messages。 */
  async function testConnection(overrides) {
    const cfg = await getConfig();
    const input = overrides || {};
    const target = await resolveTarget(input, cfg);
    const base = target.base;
    const apiKey = target.apiKey;
    const model = target.model;
    if (!apiKey) throw new Error('AI 助手 API Key 未配置');
    const dialect = target.dialect;
    const body = LitAgentProto.convertBody({
      model: model || undefined,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 16
    }, dialect);
    body.stream = false;
    const response = await fetchImpl(LitAgentProto.endpointFor(base, dialect), {
      method: 'POST',
      headers: LitAgentProto.buildHeaders({
        dialect: dialect,
        apiKey: apiKey,
        baseUrl: base,
        sessionId: 'litboard-connection-test',
        userAgent: userAgent
      }),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await Promise.resolve(response.text()).catch(function () { return ''; });
      throw new Error('连接失败（HTTP ' + response.status + '）' + (text ? '：' + String(text).slice(0, 200) : ''));
    }
    return { ok: true, model: model || '', dialect: dialect };
  }

  /** 拉取可用模型清单（设置页「拉取模型」）：三种协议都收敛到 {prefix}/models，一次成败不重试 */
  async function listModels(overrides) {
    const cfg = await getConfig();
    const input = overrides || {};
    const target = await resolveTarget(input, cfg);
    const base = target.base;
    const apiKey = target.apiKey;
    if (!apiKey) throw new Error('AI 助手 API Key 未配置');
    const dialect = target.dialect;
    // OpenCode 的清单端点按官方 curl 惯例走 Bearer；此处不跟随对话协议形态——
    // 用户填了 Qwen 模型（messages）时清单仍应以 Bearer 鉴权，否则 401 而不是列表。
    const listDialect = LitAgentProto.isOpenCodeHost(base) ? LitAgentProto.DIALECTS.CHAT : dialect;
    const listHeaders = LitAgentProto.buildHeaders({
      dialect: listDialect,
      apiKey: apiKey,
      baseUrl: base,
      sessionId: 'litboard-models',
      userAgent: userAgent
    });
    listHeaders.Accept = 'application/json';
    const response = await fetchImpl(LitAgentProto.modelsEndpointFor(base, dialect), {
      method: 'GET',
      headers: listHeaders
    });
    if (!response.ok) {
      const text = await Promise.resolve(response.text()).catch(function () { return ''; });
      throw new Error('拉取模型失败（HTTP ' + response.status + '）' +
        (response.status === 404 ? '：该端点未提供 /models 接口，请手动填写模型名' : '') +
        (text ? '：' + String(text).slice(0, 200) : ''));
    }
    let payload = null;
    try { payload = await response.json(); } catch (error) { throw new Error('模型清单返回了无效 JSON'); }
    const models = extractModelIds(payload);
    if (!models.length) throw new Error('该端点未返回任何模型 id，请手动填写模型名');
    return { models: models };
  }

  /* 向量嵌入已迁出：调研库向量模型的唯一实现在 electron/embed-net.js（独立 provider /
   * Base URL / API Key / 模型名，模板解析见 js/embedcfg.js），本模块只负责对话协议。 */

  return {
    chatStream: chatStream,
    cancel: cancel,
    testConnection: testConnection,
    listModels: listModels,
    validateBaseUrl: validateBaseUrl
  };
}
module.exports = {
  createAgentNet: createAgentNet,
  validateBaseUrl: validateBaseUrl,
  extractModelIds: extractModelIds
};
