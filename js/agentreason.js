/* LitBoard 推理强度适配（浏览器 / Node 共用，纯函数）
 *
 * 各服务商的推理控制参数、合法取值、甚至「能否关闭思考」都不一致；统一档位直接下发
 * 会造成静默降级（medium 被归一到 high，用户以为降了实际没降）或直接 400。
 * 本模块只按模型 ID 识别能力；服务商容器可能承载其他系列模型。
 *
 * 官方取值（2026-10-07 逐家核对官方文档）：
 * - DeepSeek（api-docs.deepseek.com）：reasoning_effort = none|low|high|max（默认 high；
 *   官方兼容映射 minimal→low、medium/xhigh→high——**没有 medium/xhigh 档**）；关闭思考用
 *   thinking.type = disabled（reasoning_effort=none 同样官方支持，这里沿用开关形态）。
 *   现役模型 deepseek-flash / deepseek-v4-pro。带 tools 时链式调用必须回传
 *   reasoning_content（见 agentcore）。
 * - Kimi（platform.kimi.com；platform.moonshot.cn 已 301 至该站）：kimi-k3 用顶层
 *   reasoning_effort = low|high|max（默认 max），始终思考、无关闭档；kimi-k2.7-code
 *   （含 -highspeed）始终思考、传 disabled 报错；kimi-k2.6 等用 thinking.type =
 *   enabled(默认)|disabled（thinking.keep = "all"|null 是跨轮保留思考，与档位无关，
 *   本模块不下发）。
 * - Kimi Code 订阅（www.kimi.com/code/docs，api.kimi.com/coding）：与开放平台**不同
 *   产品、不同模型 ID**——k3 / k3-256k / kimi-for-coding 用 reasoning_effort =
 *   none|low|high|max（默认 k3=high、kimi-for-coding=max；none = 关闭思考，关闭后由
 *   K2.8 Preview 无思考处理；官方别名归一 medium→high、xhigh/ultra→max，未知取值 400）；
 *   kimi-for-coding-highspeed 固定思考不可调。官方提醒：切换 effort 会使已建立的
 *   上下文缓存失效。
 * - 智谱 GLM（docs.bigmodel.cn）：reasoning_effort 仅 GLM-5.2 及以上支持。GLM-5.2
 *   名义上接受 none|minimal|low|medium|high|xhigh|max，但官方把 low/medium 归一为 high、
 *   xhigh 归一为 max——有效档只有 none/high/max，UI 只展示有效档（不拿「会被服务端归一」
 *   的档位冒充控制力）；GLM-5.3/5.3-FLASH 仅 low|high|max（默认 max），其余取值报错，
 *   且不允许关闭思考（thinking.type=disabled 会报错）。GLM-4.5~5.1 只有 thinking.type
 *   开关（enabled 时 4.5/4.6/5/5.1 自动判断是否思考，4.7/4.5V 官方归为强制思考、disabled
 *   后果文档口径不一，保守仍给开关）；GLM-4.5 以下不支持思考参数，不下发。
 * - Qwen（help.aliyun.com/zh/model-studio）：qwen3.8 系 reasoning_effort =
 *   low|medium|xhigh（默认 xhigh；none = 关闭并映射 enable_thinking=false，官方兼容
 *   映射 high/max→xhigh、minimal→low）；qwen3.8-2.4t 与 qwq-plus 为仅思考模式，
 *   enable_thinking / thinking_budget / reasoning_effort 均不适用；其余已识别 Qwen
 *   用 enable_thinking 开关（3.7/3.6/3.5 默认开，qwen3-max/plus/flash/turbo 默认关）。
 *   不同托管端点的兼容性仍需以实际 API 为准。
 * - 小米 MiMo（mimo.mi.com/docs）：官方原文「We currently do not support adjusting the
 *   effort level of thinking」——Chat/Anthropic 形态都只有 thinking.type =
 *   enabled(默认)|disabled 开关，无 reasoning_effort、无 enable_thinking。
 * - OpenAI（developers.openai.com）：Chat Completions 顶层 reasoning_effort，全枚举
 *   none|minimal|low|medium|high|xhigh|max，按型号裁剪——gpt-5 = minimal..high；
 *   gpt-5.1 = none..high；gpt-5.2/5.4/5.5 = none..xhigh；gpt-5.6 = none..max；
 *   gpt-5-pro 系仅 high；gpt-6-sol/luna 等 = none..max；gpt-6-astra 与 gpt-6.1-sol
 *   无 none（传了 400）；o 系 = low|medium|high 且不可关闭。GPT-4o/4.1 不提供推理强度。
 * - Claude（platform.claude.com）：Messages API 发送 output_config.effort =
 *   low|medium|high|xhigh|max；xhigh 与 max 按型号开放（Fable 5.x、Mythos 5.x、
 *   Opus 4.7+/5.x、Sonnet 5.x 有 xhigh；Mythos Preview、Opus 4.6、Sonnet 4.6 到 max 止）；
 *   Haiku 4.5 不支持 effort，思考只走 thinking 手动预算（协议层默认 budget 4096）。
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

  /** 始终思考、无任何可调档位的模型（Qwq / qwen3.8-2.4t / kimi-k2.7-code 等） */
  function alwaysThinking(provider, label, why) {
    var notes = {};
    ALL_LEVELS.forEach(function (level) { notes[level] = why + '，始终思考，无可调档位'; });
    notes.off = why + '，始终思考，无法关闭';
    return capability(provider, label, PARAM_KINDS.THINKING, [], {}, {}, notes);
  }

  /** 官方不提供任何思考控制的模型：不下发参数，选任何档都如实说明 */
  function noReasoningControl(provider, label, why) {
    var notes = {};
    ALL_LEVELS.forEach(function (level) { notes[level] = why; });
    return capability(provider, label, PARAM_KINDS.EFFORT, [], {}, {}, notes);
  }

  function deepseek() {
    return capability('deepseek', 'DeepSeek', PARAM_KINDS.EFFORT,
      ['off', 'low', 'high', 'max'],
      { off: 'disabled', low: 'low', high: 'high', max: 'max' },
      { medium: 'high', xhigh: 'high' },
      {
        medium: 'DeepSeek 官方无 medium 档（兼容映射为 high），已按 high 下发',
        xhigh: 'DeepSeek 官方无 xhigh 档（兼容映射为 high），已按 high 下发'
      },
      // 官方两种关闭方式（thinking.type=disabled / reasoning_effort=none）并存，
      // 这里沿用开关形态；reasoning_effort 档位只发 low/high/max
      { offViaThinking: true });
  }

  function qwen(model) {
    if (/^qwq(?:-|$)/.test(model)) {
      return alwaysThinking('qwen', 'QwQ', 'QwQ 为仅思考模式（官方不适用 enable_thinking / thinking_budget / reasoning_effort）');
    }
    if (/^qwen3\.8-2\.4t/.test(model)) {
      return alwaysThinking('qwen', 'Qwen 3.8（2.4T）', '该模型为仅思考模式');
    }
    if (/^qwen3\.8(?:-|$)/.test(model)) {
      return capability('qwen', 'Qwen 3.8', PARAM_KINDS.EFFORT,
        ['off', 'low', 'medium', 'xhigh'],
        { off: 'none', low: 'low', medium: 'medium', xhigh: 'xhigh' },
        { high: 'xhigh', max: 'xhigh' },
        {
          high: 'Qwen 3.8 官方无 high 档（兼容映射为 xhigh），已按 xhigh 下发',
          max: 'Qwen 3.8 官方无 max 档（兼容映射为 xhigh），已按 xhigh 下发'
        });
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

  /** Kimi / Moonshot：按模型细分（k3 用 effort、k2.7-code 不可关、其余用 thinking.type）。
   *  Kimi Code 订阅端点（api.kimi.com/coding）的模型 ID 与开放平台不同源，单独成支。 */
  function kimi(model) {
    if (/^kimi-for-coding-highspeed$/.test(model)) {
      return alwaysThinking('kimi', 'Kimi Code（高速版）', 'kimi-for-coding-highspeed 官方固定开启思考');
    }
    // Kimi Code 订阅：官方别名归一 medium→high、xhigh/ultra→max，none = 关闭思考
    if (/^kimi-for-coding$/.test(model) || /^k3(?:-256k)?$/.test(model)) {
      return capability('kimi', 'Kimi Code', PARAM_KINDS.EFFORT,
        ['off', 'low', 'high', 'max'],
        { off: 'none', low: 'low', high: 'high', max: 'max' },
        { medium: 'high', xhigh: 'max' },
        {
          medium: 'Kimi Code 官方把 medium 归一为 high，已按 high 下发',
          xhigh: 'Kimi Code 官方把 xhigh 归一为 max，已按 max 下发'
        });
    }
    if (/k3/.test(model)) {
      return capability('kimi', 'Kimi（k3）', PARAM_KINDS.EFFORT,
        ['low', 'high', 'max'],
        { low: 'low', high: 'high', max: 'max' },
        {},
        { off: 'kimi-k3 始终思考，无法关闭' });
    }
    if (/k2\.7-code/.test(model)) {
      return alwaysThinking('kimi', 'Kimi（k2.7-code）', 'kimi-k2.7-code 官方仅接受 thinking.type=enabled');
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

  /** 小米 MiMo：官方明说「暂不支持调节思考力度」，全接口只有 thinking.type 开关 */
  function mimo() {
    return capability('mimo', '小米 MiMo', PARAM_KINDS.THINKING,
      ['off', 'high'],
      { off: 'disabled', high: 'enabled' },
      { low: 'high', medium: 'high', max: 'high' },
      {
        low: 'MiMo 官方暂不支持调节思考力度（只有 thinking.type 开关），已按「开」下发',
        medium: 'MiMo 官方暂不支持调节思考力度（只有 thinking.type 开关），已按「开」下发',
        max: 'MiMo 官方暂不支持调节思考力度（只有 thinking.type 开关），已按「开」下发'
      });
  }

  /** 智谱 GLM：5.3 起不能关闭思考；5.2 起有 reasoning_effort；4.5~5.1 只有 thinking.type */
  function glm(model) {
    if (/glm-5\.3/.test(model)) {
      return capability('glm', '智谱 GLM-5.3', PARAM_KINDS.EFFORT,
        ['low', 'high', 'max'],
        { low: 'low', high: 'high', max: 'max' },
        { medium: 'high', xhigh: 'max' },
        {
          off: 'GLM-5.3 不允许关闭思考（官方传 disabled 会报错）',
          medium: 'GLM-5.3 官方仅支持 low/high/max，其余取值会报错，已按 high 下发',
          xhigh: 'GLM-5.3 官方仅支持 low/high/max，其余取值会报错，已按 max 下发'
        });
    }
    if (/glm-5\.2/.test(model)) {
      // 官方名义接受 none..max 七档，但 low/medium 服务端归一为 high、xhigh 归一为 max——
      // 有效档只有 none/high/max，UI 只展示有效档并在归一时如实说明
      return capability('glm', '智谱 GLM-5.2', PARAM_KINDS.EFFORT,
        ['off', 'high', 'max'],
        { off: 'none', high: 'high', max: 'max' },
        { low: 'high', medium: 'high', xhigh: 'max' },
        {
          low: 'GLM-5.2 官方把 low/medium 归一为 high，已按 high 下发',
          medium: 'GLM-5.2 官方把 low/medium 归一为 high，已按 high 下发',
          xhigh: 'GLM-5.2 官方把 xhigh 归一为 max，已按 max 下发'
        });
    }
    var glm4 = /^glm-4(?:\.(\d+))?/.exec(model);
    if (glm4 && Number(glm4[1] || 0) < 5) {
      // GLM-4.5 以下（glm-4 / glm-4v / glm-4-flash / glm-4.1 等）官方无 thinking 参数
      return noReasoningControl('glm', '智谱 GLM-4',
        'GLM-4.5 以下不支持思考控制（官方无 thinking 参数），推理强度不会下发');
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

  /** OpenAI：reasoning_effort 全枚举 none..max，按型号裁剪（2026-10-07 逐型号核对） */
  function openai(model) {
    if (/^gpt-5(?:\.\d+)?-pro(?:-|$)/.test(model)) return capability('openai', 'GPT-5 Pro', PARAM_KINDS.EFFORT,
      ['high'], { high: 'high' },
      { off: 'high', low: 'high', medium: 'high', xhigh: 'high', max: 'high' },
      {
        off: 'GPT-5 Pro 官方仅支持 high（默认且唯一档），不可关闭',
        low: 'GPT-5 Pro 官方仅支持 high，已按 high 下发',
        medium: 'GPT-5 Pro 官方仅支持 high，已按 high 下发',
        xhigh: 'GPT-5 Pro 官方仅支持 high，已按 high 下发',
        max: 'GPT-5 Pro 官方仅支持 high，已按 high 下发'
      });
    if (/^gpt-5\.6(?:-|$)/.test(model)) return capability('openai', 'GPT-5.6', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' });
    if (/^gpt-5\.1(?:-|$)/.test(model)) return capability('openai', 'GPT-5.1', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high'],
      { off: 'none', low: 'low', medium: 'medium', high: 'high' });
    // gpt-5.2 / 5.4 / 5.5 已核对为 none..xhigh；5.7+ 按同代主流档位归入此档
    if (/^gpt-5\.[2-9](?:-|$)/.test(model)) return capability('openai', 'GPT-5.2+', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high', 'xhigh'],
      { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' });
    if (/^gpt-6-astra(?:-|$)|^gpt-6\.1-sol(?:-|$)/.test(model)) return capability('openai', 'GPT-6（无 none）', PARAM_KINDS.EFFORT,
      ['low', 'medium', 'high', 'xhigh', 'max'],
      { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
      {},
      { off: '该型号官方不支持 none（传了会 400），最低为 low' });
    if (/^gpt-6(?:[.-]|$)/.test(model)) return capability('openai', 'GPT-6', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' });
    if (/^o[134](?:-|$)/.test(model)) return capability('openai', 'OpenAI o 系', PARAM_KINDS.EFFORT,
      ['low', 'medium', 'high'],
      { low: 'low', medium: 'medium', high: 'high' },
      { xhigh: 'high', max: 'high' },
      {
        off: 'o 系推理不可关闭，最低为 low',
        xhigh: 'o 系官方仅 low/medium/high，已按 high 下发',
        max: 'o 系官方仅 low/medium/high，已按 high 下发'
      });
    return capability('openai', 'OpenAI', PARAM_KINDS.EFFORT,
      ['off', 'low', 'medium', 'high'],
      { off: 'minimal', low: 'low', medium: 'medium', high: 'high' },
      { xhigh: 'high', max: 'high' },
      {
        xhigh: '该型号官方无 xhigh 档，已按 high 下发',
        max: '该型号官方无 max 档，已按 high 下发'
      });
  }

  function claude(model) {
    if (/^claude-haiku-4-5(?:-|$)/.test(model)) {
      // Haiku 4.5 官方不支持 effort；思考只有 thinking 手动预算（协议层默认 4096 tokens）
      return capability('claude', 'Claude Haiku', PARAM_KINDS.THINKING,
        ['off', 'high'],
        { off: 'disabled', high: 'enabled' },
        { low: 'high', medium: 'high', xhigh: 'high', max: 'high' },
        {
          low: 'Haiku 4.5 官方不支持 effort 档，思考走 thinking 开关（协议层默认预算 4096 tokens），已按「开」下发',
          medium: 'Haiku 4.5 官方不支持 effort 档，思考走 thinking 开关（协议层默认预算 4096 tokens），已按「开」下发',
          xhigh: 'Haiku 4.5 官方不支持 effort 档，思考走 thinking 开关（协议层默认预算 4096 tokens），已按「开」下发',
          max: 'Haiku 4.5 官方不支持 effort 档，思考走 thinking 开关（协议层默认预算 4096 tokens），已按「开」下发'
        });
    }
    if (/^claude-(?:opus-(?:4-[678]|5)|sonnet-(?:4-6|5)|fable-5|mythos-5|mythos-preview)(?:-|$)/.test(model)) {
      // xhigh 按型号开放：Mythos Preview、Opus 4.6、Sonnet 4.6 到 max 止
      var extended = /^claude-(?:opus-(?:4-[78]|5)|sonnet-5|fable-5|mythos-5)(?:-|$)/.test(model);
      var levels = extended ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'max'];
      var official = { low: 'low', medium: 'medium', high: 'high', max: 'max' };
      var remap = {}, notes = {};
      if (extended) official.xhigh = 'xhigh';
      else {
        remap.xhigh = 'max';
        notes.xhigh = '该型号官方支持到 max（无 xhigh 档），已按 max 下发';
      }
      return capability('claude', 'Claude', PARAM_KINDS.EFFORT, levels, official, remap, notes);
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
    else if (/^mimo(?:-|$)/.test(model)) cap = mimo();
    else if (/^kimi(?:-|$)|^k3(?:-|$)/.test(model)) cap = kimi(model);
    else if (/^glm(?:-|$)/.test(model)) cap = glm(model);
    else if (/^(qwen|qwq)(?:[\d.-]|$)/.test(model)) cap = qwen(model);
    else if (/^claude(?:-|$)/.test(model)) cap = claude(model);
    else if (/^gpt-5(?:[.-]|$)|^gpt-6(?:[.-]|$)|^o[134](?:-|$)/.test(model)) cap = openai(model);
    else if (/^gpt-4(?:o|\.1)(?:-|$)/.test(model)) cap = capability('openai', 'GPT-4', PARAM_KINDS.EFFORT, [], {});
    else cap = generic();
    // vision：已知服务商 × 模型名粗判；未知端点一律 false（宁可不发图）
    cap.vision = cap.provider !== 'generic' && modelLooksVisionCapable(model);
    // MiMo 视觉系命名未与官方文档核实（flash 只是尺寸档，不是视觉标识），只认明确的 vl/omni
    if (cap.provider === 'mimo') cap.vision = /(^|[^a-z])(vl|omni)([^a-z]|$)/.test(model);
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
