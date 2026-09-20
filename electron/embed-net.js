'use strict';

/**
 * LitBoard 向量模型出网层（主进程专用）：调研库向量专用的嵌入客户端。
 *
 * 覆盖三条消费链：AI 助手的 `semantic_search` 工具、段落找文献的本地向量召回、库空闲时的
 * 增量构建（electron/research-build.js）。它过去借 AI 助手的端点与凭据（`agent-net.embedTexts`），
 * 现在有独立的 provider / Base URL / API Key / 模型名——配置解析在 `js/embedcfg.js`（纯函数），
 * 本文件只负责：分批请求、按 index 对齐、错误如实上抛、用量记账。
 *
 * 注意：正式库那条 `semantic:` 搜索链（`integrations.embedTexts` + 主库 paper_vec 索引）
 * 已删除——语义检索现在只剩这一条链，配置与索引都在调研库侧。
 *
 * 纪律（与 AI 助手一致）：
 * - 失败不自动重试（计费红线）：一次成败上抛，由调用方决定停批/提示；
 * - 改模型即换向量空间：向量行按 model 记录，检索只命中同模型（research-db.cosineSearch），
 *   换模型后需重建索引，不会与旧向量混检出虚假高分。
 */
const LitEmbedCfg = require('../js/embedcfg.js');
const LitAgentProto = require('../js/agentproto.js');

// 单条文本进模型前的截断（原实现切 3000，沿用；调用方已按自己的预算预截断，这里只是兜底）
const MAX_TEXT_CHARS = 3000;
// 单次调用最多接收的文本条数（分批由服务内部完成）
const MAX_TEXTS = 512;

/** 分批：把文本切成不超过 batch 的若干批（batch 兜底 DEFAULT_BATCH） */
function chunkTexts(texts, batch) {
  const size = Math.max(1, Number(batch) || LitEmbedCfg.DEFAULT_BATCH);
  const out = [];
  for (let i = 0; i < texts.length; i += size) out.push(texts.slice(i, i + size));
  return out;
}

function normalizeTexts(input) {
  return (Array.isArray(input) ? input : [])
    .map(function (text) { return String(text == null ? '' : text).slice(0, MAX_TEXT_CHARS); })
    .filter(Boolean)
    .slice(0, MAX_TEXTS);
}

function createEmbedService(options) {
  const opts = options || {};
  const fetchImpl = opts.fetch;
  const getConfig = opts.getConfig || async function () { return {}; };
  const persistUsage = opts.persistUsage;
  const userAgent = String(opts.userAgent || '').trim() || 'LitBoard';
  const usageTotals = { requests: 0, tokens: 0 };
  if (opts.initialUsage && typeof opts.initialUsage === 'object') {
    usageTotals.requests = Number(opts.initialUsage.requests) || 0;
    usageTotals.tokens = Number(opts.initialUsage.tokens) || 0;
  }
  let usagePersistTimer = null;

  function recordUsage(usage) {
    const total = Number(usage && usage.total_tokens) || 0;
    if (total > 0) {
      usageTotals.requests++;
      usageTotals.tokens += total;
    }
    if (typeof persistUsage === 'function') {
      clearTimeout(usagePersistTimer);
      usagePersistTimer = setTimeout(function () {
        persistUsage({ requests: usageTotals.requests, tokens: usageTotals.tokens }).catch(function () {});
      }, 2000);
    }
  }

  function getUsage() {
    return { requests: usageTotals.requests, tokens: usageTotals.tokens };
  }

  /** 当前生效目标（含来源：configured / legacy-chat / legacy-translation）+ 是否就绪 */
  async function resolveTarget() {
    const cfg = await getConfig().catch(function () { return {}; });
    return LitEmbedCfg.resolveTarget(cfg || {});
  }

  /** 嵌入一批文本：{ model, vectors, usage, source, batches }；失败不重试 */
  async function embedTexts(input) {
    const req = input || {};
    const texts = normalizeTexts(req.texts);
    if (!texts.length) throw new Error('没有可嵌入的文本');
    const target = await resolveTarget();
    if (!target.ok) throw new Error(target.reason);
    const model = String(req.model || target.model).trim() || target.model;
    const url = LitAgentProto.embeddingsEndpointFor(target.baseUrl);
    const headers = LitAgentProto.buildHeaders({
      dialect: LitAgentProto.DIALECTS.CHAT,
      apiKey: target.apiKey,
      baseUrl: target.baseUrl,
      sessionId: 'litboard-embed',
      userAgent: userAgent
    });
    const batches = chunkTexts(texts, target.batch);
    const vectors = [];
    let usage = null;
    for (const batch of batches) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ model: model, input: batch })
      });
      const raw = await Promise.resolve(response.text()).catch(function () { return ''; });
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (error) { throw new Error('嵌入服务返回了无效 JSON'); }
      if (!response.ok) {
        const message = (data.error && data.error.message) || ('嵌入服务请求失败（' + response.status + '）');
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      const rows = (Array.isArray(data.data) ? data.data : []).slice()
        .sort(function (a, b) { return a.index - b.index; });
      if (rows.length !== batch.length) throw new Error('嵌入服务返回数量不匹配（期望 ' + batch.length + '，得到 ' + rows.length + '）');
      rows.forEach(function (row) {
        if (!Array.isArray(row.embedding)) throw new Error('嵌入服务返回缺少向量');
        vectors.push(row.embedding);
      });
      if (data.usage) usage = data.usage;
      recordUsage(data.usage);
    }
    return { model: model, vectors: vectors, usage: usage, source: target.source, batches: batches.length };
  }

  /**
   * 连接测试：用当前配置（或设置表单里尚未保存的值）嵌入一句，返回模型与维度。
   * 表单值一旦提供了任一项专用字段，就按「专用配置」判定——与保存后的行为一致。
   */
  async function test(overrides) {
    const cfg = await getConfig().catch(function () { return {}; });
    const o = overrides || {};
    const merged = Object.assign({}, cfg || {});
    if (o.embedProvider != null) merged.embedProvider = o.embedProvider;
    if (o.embedBaseUrl != null) merged.embedBaseUrl = o.embedBaseUrl;
    if (o.embedModel != null) merged.embedModel = o.embedModel;
    if (o.embedApiKey) merged.embedApiKey = o.embedApiKey;
    const target = LitEmbedCfg.resolveTarget(merged);
    if (!target.ok) throw new Error(target.reason);
    const model = String(o.embedModel || target.model).trim() || target.model;
    const response = await fetchImpl(LitAgentProto.embeddingsEndpointFor(target.baseUrl), {
      method: 'POST',
      headers: LitAgentProto.buildHeaders({
        dialect: LitAgentProto.DIALECTS.CHAT,
        apiKey: target.apiKey,
        baseUrl: target.baseUrl,
        sessionId: 'litboard-embed-test',
        userAgent: userAgent
      }),
      body: JSON.stringify({ model: model, input: ['LitBoard 嵌入连通性测试'] })
    });
    const raw = await Promise.resolve(response.text()).catch(function () { return ''; });
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (error) { throw new Error('嵌入服务返回了无效 JSON'); }
    if (!response.ok) {
      throw new Error('嵌入服务连接失败（HTTP ' + response.status + '）' +
        ((data.error && data.error.message) ? '：' + data.error.message : ''));
    }
    const row = Array.isArray(data.data) ? data.data[0] : null;
    if (!row || !Array.isArray(row.embedding)) throw new Error('嵌入服务返回缺少向量');
    return { ok: true, model: model, dim: row.embedding.length, source: target.source };
  }

  return {
    embedTexts: embedTexts,
    resolveTarget: resolveTarget,
    test: test,
    getUsage: getUsage
  };
}

module.exports = {
  createEmbedService: createEmbedService,
  chunkTexts: chunkTexts,
  normalizeTexts: normalizeTexts,
  MAX_TEXT_CHARS: MAX_TEXT_CHARS,
  MAX_TEXTS: MAX_TEXTS
};
