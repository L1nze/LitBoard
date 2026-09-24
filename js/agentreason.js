/* LitBoard 推理强度适配（浏览器 / Node 共用，纯函数）
 *
 * 各服务商的推理控制参数、合法取值、甚至「能否关闭思考」都不一致；统一档位直接下发
 * 会造成静默降级（medium 被归一到 high，用户以为降了实际没降）或直接 400。
 * 本模块只按模型 ID 识别能力；服务商容器可能承载其他系列模型。
 *
 * 官方取值（2026-09-20 逐家核对官方文档）：
 * - DeepSeek（api-docs.deepseek.com）：reasoning_effort = low|high|max（默认 high）；
 *   关闭思考用 thinking.type = disabled（OpenAI 格式开关，reasoning_effort 不接受 none——
 *   2026-09-20 核对官方 thinking 文档）。兼容映射 minimal→low、medium/xhigh→high
 *   （**没有 medium 档**）。带 tools 时链式调用必须回传 reasoning_content（见 agentcore）。
 * - Kimi / Moonshot（platform.kimi.com）：K2.x 用 thinking.type = enabled(默认)|disabled，
 *   thinking.keep = null|"all"；kimi-k2.7-code 始终思考、不可关闭；kimi-k3 用顶层
 *   reasoning_effort = low|high|max（默认 max），不使用 thinking。
 * - 智谱 GLM（docs.bigmodel.cn）：thinking.type = enabled(默认)|disabled；reasoning_effort
 *   仅 GLM-5.2 及以上支持（max|high|low，GLM-5.2 另接受 xhigh/medium/minimal 并归一到
 *   max/high/none）；GLM-5.3/5.3-FLASH **不允许 disabled**（传了报错）。
 * - Qwen3.8：reasoning_effort = none|low|medium|xhigh；其他已识别 Qwen 使用
 *   enable_thinking 开关。不同托管端点的兼容性仍需以实际 API 为准。
 * - GPT-5：按型号限制 reasoning_effort 档位；GPT-4o/4.1 不提供推理强度。
 * - Claude：支持 effort 的型号按 ID 开放档位；Messages API 发送 output_config.effort。
 * - 未知模型（本地 ollama / vLLM / 自建模型）：官方取值未知，**一律不下发推理参数**，
 *   宁可少一个开关，也不制造 400 或伪造控制力。
 *
 * 注意：输出上限（max_tokens）不由本模块决定——它来自 设置 → AI 助手 → 最大输出
 * （默认值在 js/agentcore 的 DEFAULTS.maxOutputTokens）。Kimi 思考模型做多步工具调用时
 * 官方要求 max_tokens ≥ 16000，而默认是 12800：用这类模型请把「最大输出」调到 16000 以上，
 * 否则工具调用可能被截断（该边界写在设置页提示里，不静默抬值）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentReason = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // 全部档位（UI 按能力裁剪展示；'' = 默认，不下发任何参数）
  var ALL_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

  // 参数形态：effort → reasoning_effort；thinking → thinking.type；switch → enable_thinking
  var PARAM_KINDS = { EFFORT: 'effort', THINKING: 'thinking', SWITCH: 'enable_thinking' };

  function capability(provider, label, param, levels, official, remap, notes, extra) {
    return {
      provider: provider,
      label: label,
      param: param,
      levels: levels,
      official: official,
      remap: remap || {},
      notes: notes || {},
      vision: !!(extra && extra.vision),
      offViaThinking: !!(extra && extra.offViaThinking)
    };
  }

  function deepseek() {
    return capability('deepseek', 'DeepSeek', PARAM_KINDS.EFFORT,
      ['off', 'low', 'high', 'max'],
      { off: 'disabled', low: 'low', high: 'high', max: 'max' },
      { medium: 'high' },
      { medium: 'DeepSeek 官方无 medium 档（会被映射为 high），已按 high 下发' },
      // 2026-09-20 核对官方 thinking 文档：OpenAI 格式下关闭思考走 thinking.type=disabled，
      // reasoning_effort 只接受 low/high/max——不能拿 'none' 冒充关闭参数。
      { offViaThinking: true });
  }

  function qwen(model) {
    if (/^qwen3\.8(?:-|$)/.test(model)) {
      return capability('qwen', 'Qwen 3.8', PARAM_KINDS.EFFORT,
        ['off', 'low', 'medium', 'xhigh'],
        { off: 'none', low: 'low', medium: 'medium', xhigh: 'xhigh' },
        { high: 'xhigh', max: 'xhigh' });
    }
    return capability('qwen', '通义千问 / DashScope', PARAM_KINDS.SWITCH,
      ['off', 'high'],
      { off: 'false', high: 'true' },
      { low: 'high', medium: 'high', max: 'high' },
      {
        low: 'Qwen 官方以 enable_thinking 开关控制，无离散档位，已按「开」下发',
        medium: 'Qwen 官方以 enable_thinking 开关控制，无离散档位，已按「开」下发',
        max: 'Qwen 官方以 enable_thinking 开关控制，无离散档位，已按「开」下发'
      });
  }

  /** Kimi / Moonshot：按模型细分（k3 用 effort、k2.7-code 不可关、其余用 thinking.type） */
  function kimi(model) {
    if (/k3/.test(model)) {
      return capability('kimi', 'Kimi（k3）', PARAM_KINDS.EFFORT,
        ['low', 'high', 'max'],
        { low: 'low', high: 'high', max: 'max' },
        {},
        { off: 'kimi-k3 始终思考，无法关闭' });
    }
    if (/k2\.7-code/.test(model)) {
      return capability('kimi', 'Kimi（k2.7-code）', PARAM_KINDS.THINKING,
        [],
        {},
        {},
        { off: 'kimi-k2.7-code 始终思考，无法关闭', low: '该模型始终思考，无可调档位', medium: '该模型始终思考，无可调档位', high: '该模型始终思考，无可调档位', max: '该模型始终思考，无可调档位' });
    }
    return capability('kimi', 'Kimi', PARAM_KINDS.THINKING,
      ['off', 'high'],
      { off: 'disabled', high: 'enabled' },
      { low: 'high', medium: 'high', max: 'high' },
      {
        low: 'Kimi 官方以 thinking.type 开关控制，已按「开」下发',
        medium: 'Kimi 官方以 thinking.type 开关控制，已按「开」下发',
        max: 'Kimi 官方以 thinking.type 开关控制，已按「开」下发'
      });
  }

  /** 智谱 GLM：5.3 起不能关闭思考；5.2 起有 reasoning_effort；4.x 只有 thinking.type */
  function glm(model) {
    if (/glm-5\.3/.test(model)) {
      return capability('glm', '智谱 GLM-5.3', PARAM_KINDS.EFFORT,
        ['low', 'high', 'max'],
        { low: 'low', high: 'high', max: 'max' },
        {},
        { off: 'GLM-5.3 不允许关闭思考（官方传 disabled 会报错）' });
    }
    if (/glm-5\.[2-9]|glm-5$/.test(model)) {
      return capability('glm', '智谱 GLM-5.2+', PARAM_KINDS.EFFORT,
        ['off', 'low', 'high', 'max'],
        { off: 'none', low: 'low', high: 'high', max: 'max' },
        { medium: 'high' },
        { medium: 'GLM-5.2 起 medium 归一到 high，已按 high 下发' });
    }
    return capability('glm', '智谱 GLM', PARAM_KINDS.THINKING,
      ['off', 'high'],
      { off: 'disabled', high: 'enabled' },
      { low: 'high', medium: 'high', max: 'high' },
      {
        low: '该 GLM 版本不支持 reasoning_effort（GLM-5.2 起才有），已按 thinking 开关下发',
        medium: '该 GLM 版本不支持 reasoning_effort（GLM-5.2 起才有），已按 thinking 开关下发',
        max: '该 GLM 版本不支持 reasoning_effort（GLM-5.2 起才有），已按 thinking 开关下发'
      });
  }

  function openai(model) {
    if (/^gpt-5\.[45]-pro(?:-|$)/.test(model)) return capability('openai', 'GPT-5 Pro', PARAM_KINDS.EFFORT,
      ['medium', 'high', 'xhigh'], { medium: 'medium', high: 'high', xhigh: 'xhigh' });
    if (/^gpt-5\.[4-9](?:-|$)/.test(model)) return capability('openai', 'GPT-5.4+', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high', 'xhigh'],
      { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' });
    if (/^gpt-5\.1(?:-|$)/.test(model)) return capability('openai', 'GPT-5.1', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high'],
      { off: 'none', low: 'low', medium: 'medium', high: 'high' });
    return capability('openai', 'OpenAI', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high'],
      { off: 'minimal', low: 'low', medium: 'medium', high: 'high' },
      { max: 'high' },
      { max: 'OpenAI 无 max 档，已按 high 下发' });
  }

  function claude(model) {
    if (/^claude-(?:opus-(?:4-[678]|5)|sonnet-(?:4-6|5))(?:-|$)/.test(model)) {
      var extended = /^claude-(?:opus-(?:4-[78]|5)|sonnet-5)(?:-|$)/.test(model);
      var levels = extended ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'max'];
      var official = { low: 'low', medium: 'medium', high: 'high', max: 'max' };
      if (extended) official.xhigh = 'xhigh';
      return capability('claude', 'Claude', PARAM_KINDS.EFFORT, levels, official);
    }
    return generic();
  }

  /** 未知模型：不下发任何推理参数 */
  function generic() {
    return capability('generic', '未知模型', PARAM_KINDS.EFFORT,
      [],
      {},
      { off: '', low: 'high', medium: 'high', high: 'high', max: 'high' },
      {
        off: '该模型未识别，推理参数不会下发',
        low: '该模型未识别，推理参数不会下发',
        medium: '该模型未识别，推理参数不会下发',
        high: '该模型未识别，推理参数不会下发',
        max: '该模型未识别，推理参数不会下发'
      });
  }

  /** 模型名粗判是否接受图像输入（M9-5 多模态消息链的发送开关）。
   *  保守取向：认不准的一律 false（退回纯文本，宁可不发图也不打 400）。
   *  视觉系命名惯例：vl / vision / omni / 4o / o 系多模态 / qvq / 4v / flash（DeepSeek
   *  官方 Vision 文档的图像输入示例即 deepseek-flash）。 */
  function modelLooksVisionCapable(model) {
    return /(^|[^a-z])(vl|qvq|vision|omni|4v)([^a-z]|$)|flash|gpt-4o|gpt-4\.1|gpt-5|^o[134]|gemini|claude|glm-4(\.|$)/
      .test(String(model || '').toLowerCase());
  }

  /** 只按模型 ID 识别能力；未知 ID 保持默认，不猜测托管服务商的参数兼容性。 */
  function detect(input) {
    var model = String(input && input.model || '').trim().toLowerCase().split('/').pop();
    var cap;
    if (/^deepseek(?:-|$)/.test(model)) cap = deepseek();
    else if (/^kimi(?:-|$)/.test(model)) cap = kimi(model);
    else if (/^glm(?:-|$)/.test(model)) cap = glm(model);
    else if (/^(qwen|qwq)(?:[\d.-]|$)/.test(model)) cap = qwen(model);
    else if (/^claude(?:-|$)/.test(model)) cap = claude(model);
    else if (/^gpt-5(?:[.-]|$)|^o[134](?:-|$)/.test(model)) cap = openai(model);
    else if (/^gpt-4(?:o|\.1)(?:-|$)/.test(model)) cap = capability('openai', 'GPT-4', PARAM_KINDS.EFFORT, [], {});
    else cap = generic();
    // vision：已知服务商 × 模型名粗判；未知端点一律 false（宁可不发图）
    cap.vision = cap.provider !== 'generic' && modelLooksVisionCapable(model);
    return cap;
  }

  /** 用户档位 → 实际生效档位（不支持的按 remap 归一；'' = 默认不传参） */
  function normalize(cap, level) {
    var value = String(level == null ? '' : level);
    if (!value) return { level: '', remapped: false, note: '' };
    if (cap.levels.indexOf(value) !== -1) return { level: value, remapped: false, note: '' };
    var fallback = cap.remap[value];
    if (fallback && cap.levels.indexOf(fallback) !== -1) {
      return { level: fallback, remapped: true, note: cap.notes[value] || '' };
    }
    return { level: '', remapped: true, note: cap.notes[value] || '' };
  }

  /** 该档位实际下发的请求参数（空对象 = 不下发，用服务商默认）。
   *  offViaThinking 的端点（DeepSeek）：off 档走 thinking.type=disabled 开关，
   *  其余档位走 reasoning_effort——两种参数形态不混用。 */
  function buildBody(cap, level) {
    var normalized = normalize(cap, level);
    if (!normalized.level) return {};
    var official = cap.official[normalized.level];
    if (official == null) return {};
    if (normalized.level === 'off' && cap.offViaThinking) return { thinking: { type: 'disabled' } };
    if (cap.param === PARAM_KINDS.THINKING) return { thinking: { type: official } };
    if (cap.param === PARAM_KINDS.SWITCH) return { enable_thinking: official === 'true' };
    return { reasoning_effort: official };
  }

  /** UI 展示用可选档位：第一项恒为「默认」，其余按官方支持裁剪 */
  function options(cap) {
    var out = [{ value: '', official: '', enabled: true }];
    ALL_LEVELS.forEach(function (level) {
      if (cap.levels.indexOf(level) === -1) return;
      out.push({ value: level, official: cap.official[level] || '', enabled: true });
    });
    return out;
  }

  return {
    ALL_LEVELS: ALL_LEVELS,
    PARAM_KINDS: PARAM_KINDS,
    detect: detect,
    normalize: normalize,
    buildBody: buildBody,
    options: options
  };
});
