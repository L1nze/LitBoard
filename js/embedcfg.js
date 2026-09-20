/* LitBoard 向量模型配置（浏览器 / Node 共用，纯函数）
 *
 * 范围：**调研库向量**（AI 助手的 semantic_search 工具、段落找文献的本地向量召回、库空闲时的
 * 增量构建）。语义检索只作为 AI 助手的工具存在——正式库那条 `semantic:` 搜索链（借翻译服务商
 * 凭据 + 主库 paper_vec 索引）已随 schema v7 一并删除。
 *
 * 过去这一段的向量模型没有自己的 provider / API Key：只有「嵌入模型名」是可填的，
 * Base URL 与 Key 借用 **AI 助手**的端点（且模型名与聊天模型混在同一份配置里）。现在给它
 * 一套独立配置，主进程（embed-net）与设置页（即时提示）都调本模块解析，规则只有一份、可直测。
 *
 * 解析优先级（resolveTarget）：
 * 1. 专用配置齐备（Base URL + API Key + 模型名）→ 'configured'；
 * 2. 只填了专用 Base URL / Key 但没填齐 → 直接报「配置不完整」，**不静默回退**
 *    （半填状态下偷偷用别的账号计费比报错更糟）；
 * 3. 未配置专用端点：AI 助手端点 + 嵌入模型名 → 'legacy-chat'（历史路径：既有向量
 *    仍由同一个模型构建，保持索引不失效）。
 *
 * 单批条数：服务商限制不一（DashScope 系 10 条，OpenAI 可上千），按预设 → 主机名 → 默认
 * 16 推断（遇更严限制需在预设表增补）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitEmbedCfg = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULT_BATCH = 16;

  /** 常用预设：只填 Base URL + 模型名（任何 OpenAI 兼容 /embeddings 端点都可手填） */
  var PRESETS = {
    dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3', batch: 10 },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', batch: 50 },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text', batch: 16 }
  };

  /** 单批条数受限的主机（DashScope 兼容模式 10 条/次） */
  var STRICT_BATCH_HOSTS = [/dashscope/, /aliyuncs/];

  function str(value) { return String(value == null ? '' : value); }

  function hostOf(baseUrl) {
    try { return new URL(str(baseUrl).trim()).hostname.toLowerCase(); } catch (error) { return ''; }
  }

  /** 单批条数：预设优先，其次按主机，最后默认 */
  function batchFor(baseUrl, providerId) {
    var preset = PRESETS[str(providerId).trim().toLowerCase()];
    if (preset) return preset.batch;
    var host = hostOf(baseUrl);
    for (var i = 0; i < STRICT_BATCH_HOSTS.length; i++) {
      if (STRICT_BATCH_HOSTS[i].test(host)) return 10;
    }
    return DEFAULT_BATCH;
  }

  /**
   * 解析当前生效的嵌入目标（纯函数，不碰 IO）。
   * config 里 Key 只判「有没有」——主进程传解密后的真 Key，渲染层传 'set' 占位，
   * 规则因此对两侧一致。返回 {ok, source, baseUrl, apiKey, model, batch, reason}。
   */
  function resolveTarget(config) {
    var cfg = config || {};
    var baseUrl = str(cfg.embedBaseUrl).trim();
    var key = str(cfg.embedApiKey).trim();
    var model = str(cfg.embedModel).trim();
    var provider = str(cfg.embedProvider).trim().toLowerCase();
    if (baseUrl || key) {
      if (baseUrl && key && model) {
        return {
          ok: true, source: 'configured', baseUrl: baseUrl, apiKey: key, model: model,
          batch: batchFor(baseUrl, provider), reason: ''
        };
      }
      return {
        ok: false, source: 'configured', baseUrl: baseUrl, apiKey: '', model: model, batch: 0,
        reason: '嵌入服务配置不完整：Base URL、API Key、模型名三项都要填'
      };
    }
    var agentBase = str(cfg.agentBaseUrl).trim();
    var agentKey = str(cfg.agentApiKey).trim();
    if (agentBase && agentKey && model) {
      return {
        ok: true, source: 'legacy-chat', baseUrl: agentBase, apiKey: agentKey, model: model,
        batch: batchFor(agentBase, ''), reason: ''
      };
    }
    return {
      ok: false, source: '', baseUrl: '', apiKey: '', model: model, batch: 0,
      reason: '未配置向量模型：请在设置 → 集成与服务 →「向量嵌入（调研库）」里填服务商、Base URL、API Key 与模型名'
    };
  }

  return {
    DEFAULT_BATCH: DEFAULT_BATCH,
    PRESETS: PRESETS,
    hostOf: hostOf,
    batchFor: batchFor,
    resolveTarget: resolveTarget
  };
});
