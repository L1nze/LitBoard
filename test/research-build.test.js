'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResearchEmbedder } = require('../electron/research-build.js');
const LitResearch = require('../js/research.js');
const LitEmbedCfg = require('../js/embedcfg.js');

/** 假调研库：pending 由哈希集合驱动，vecPut 记录已嵌 */
function fakeDb(workIds, opts) {
  const embedded = new Map();
  const works = workIds.map(function (id) {
    return { id: id, title: 'Title ' + id, abstract: 'Abstract ' + id, concepts: [], keywords: [] };
  });
  return {
    works: works,
    pendingEmbeddings: function (options) {
      const model = options.model, recipe = options.recipe;
      return works.filter(function (w) {
        const hash = LitResearch.embeddingHash(w);
        const have = embedded.get(w.id);
        return !have || have.hash !== hash || have.model !== model || have.recipe !== recipe;
      }).slice(0, options.limit || 5000).map(function (w) {
        return { work: w, hash: LitResearch.embeddingHash(w) };
      });
    },
    vecPut: function (batch) {
      batch.forEach(function (item) {
        embedded.set(item.workId, { hash: item.hash, model: item.model, recipe: item.recipe });
      });
      return { count: batch.length };
    },
    embeddedCount: function () { return embedded.size; }
  };
}

/** 假向量模型出网层：resolveTarget 走真实解析规则（js/embedcfg.js），出网部分按批计数。
 *  接口与 electron/embed-net.js 一致：resolveTarget + embedTexts。 */
function fakeEmbed(cfg, failAtBatch) {
  let calls = 0;
  const config = cfg || { agentBaseUrl: 'https://api.test', agentApiKey: 'K', embedModel: 'emb-m' };
  return {
    calls: function () { return calls; },
    resolveTarget: async function () { return LitEmbedCfg.resolveTarget(config); },
    embedTexts: async function (input) {
      calls++;
      if (failAtBatch != null && calls === failAtBatch) throw new Error('quota exceeded');
      return {
        model: config.embedModel,
        vectors: input.texts.map(function () { return [0.1, 0.2, 0.3]; }),
        usage: { total_tokens: input.texts.length * 10 }
      };
    }
  };
}

const cfg = { agentBaseUrl: 'https://api.test', agentApiKey: 'K', embedModel: 'emb-m' };

test('runBuild embeds all pending in batches and reports done', async function () {
  const db = fakeDb(['W1', 'W2', 'W3']);
  const net = fakeEmbed(cfg);
  const progress = [];
  const e = createResearchEmbedder({
    researchDb: db, embed: net,
    notify: function (_ch, p) { progress.push(p); }
  });
  const r = await e.runBuild();
  assert.equal(r.done, true);
  assert.equal(r.embedded, 3);
  assert.equal(db.embeddedCount(), 3);
  assert.ok(progress.length >= 1 && progress[0].done === 3);
  // 二次构建：零待嵌（hash 增量跳过）
  const r2 = await e.runBuild();
  assert.equal(r2.embedded, 0);
});

test('estimate reports pending count and token estimate', async function () {
  const db = fakeDb(['W1', 'W2']);
  const e = createResearchEmbedder({
    researchDb: db, embed: fakeEmbed(cfg)
  });
  const est = await e.estimate();
  assert.equal(est.count, 2);
  assert.ok(est.approxTokens > 0);
  assert.equal(est.model, 'emb-m');
  assert.equal(est.source, 'legacy-chat'); // 未填专用配置 → 沿用 AI 助手端点
});

test('专用向量模型配置优先于 AI 助手端点（estimate 带出来源）', async function () {
  const dedicated = {
    agentBaseUrl: 'https://api.test', agentApiKey: 'K',
    embedProvider: 'openai', embedBaseUrl: 'https://api.openai.com/v1', embedApiKey: 'sk', embedModel: 'text-embedding-3-small'
  };
  const db = fakeDb(['W1']);
  const e = createResearchEmbedder({
    researchDb: db, embed: fakeEmbed(dedicated)
  });
  const est = await e.estimate();
  assert.equal(est.model, 'text-embedding-3-small');
  assert.equal(est.source, 'configured');
});

test('batch failure stops the build without retry (billing red line)', async function () {
  const db = fakeDb(['W1', 'W2', 'W3', 'W4']);
  const net = fakeEmbed(cfg, 1);
  const e = createResearchEmbedder({
    researchDb: db, embed: net
  });
  const r = await e.runBuild();
  assert.ok(r.error && r.error.indexOf('quota') !== -1);
  assert.equal(net.calls(), 1); // 不重试
  assert.equal(db.embeddedCount(), 0); // 全部保持 pending
  // 修好网络后自然续跑
  const net2 = fakeEmbed(cfg);
  const e2 = createResearchEmbedder({
    researchDb: db, embed: net2
  });
  const r2 = await e2.runBuild();
  assert.equal(r2.embedded, 4);
});

test('busy library pauses between batches', async function () {
  const db = fakeDb(['W1', 'W2']);
  let idle = true;
  const e = createResearchEmbedder({
    researchDb: db, embed: fakeEmbed(cfg),
    isIdle: function () { return idle; }
  });
  idle = false;
  const r = await e.runBuild();
  assert.equal(r.stopped, 'busy');
  assert.equal(r.embedded, 0);
});

test('未配置向量模型时拒绝构建（零出网请求）', async function () {
  const empty = { agentBaseUrl: '', agentApiKey: '', embedModel: '' };
  const net = fakeEmbed(empty);
  const e = createResearchEmbedder({
    researchDb: fakeDb(['W1']), embed: net
  });
  await assert.rejects(() => e.runBuild(), /向量模型未配置/);
  assert.equal(net.calls(), 0);
});

test('maybeAutoBuild honors enabled flag and running state', async function () {
  const db = fakeDb(['W1']);
  const e = createResearchEmbedder({
    researchDb: db, embed: fakeEmbed(cfg)
  });
  assert.ok((await e.maybeAutoBuild(false)).skipped);
  const r = await e.maybeAutoBuild(true);
  assert.equal(r.embedded, 1);
});

test('R14: 失败批次写持久标记，巡检零新增请求；手动构建清除标记续跑', async function () {
  const store = new Map();
  const db = fakeDb(['W1', 'W2', 'W3']);
  const net = fakeEmbed(cfg, 1); // 第 1 批失败
  const e = createResearchEmbedder({
    researchDb: db, embed: net,
    getSetting: async function (k) { return store.get(k) || null; },
    setSetting: async function (k, v) { store.set(k, v); },
    isIdle: function () { return true; }
  });
  const r1 = await e.maybeAutoBuild(true);
  assert.ok(r1.error);
  assert.ok(r1.failed && r1.failed.pending === 3);
  assert.ok(store.get('embedFailedBatch'), '失败标记已持久化');
  // 巡检两次：见标记即跳过，零新增嵌入请求（计费红线）
  const callsAfterFirst = net.calls();
  assert.equal((await e.maybeAutoBuild(true)).skipped, 'failed');
  assert.equal((await e.maybeAutoBuild(true)).skipped, 'failed');
  assert.equal(net.calls(), callsAfterFirst);
  // 手动构建 = 明确的人工恢复：清除标记并跑完
  const r2 = await e.runBuild();
  assert.equal(r2.done, true);
  assert.equal(store.get('embedFailedBatch'), null);
  assert.equal(db.embeddedCount(), 3);
  // 恢复后巡检正常通过
  assert.equal((await e.maybeAutoBuild(true)).done, true);
});

test('查询路径按需补齐：一次最多 50 篇、只补缺的、第二次零请求', async function () {
  const ids = [];
  for (let i = 1; i <= 120; i++) ids.push('W' + i);
  const db = fakeDb(ids);
  const net = fakeEmbed(cfg);
  const e = createResearchEmbedder({ researchDb: db, embed: net });
  const r1 = await e.topUp();
  assert.equal(r1.embedded, 50, '单次补齐上限 50 篇（对齐上游 ≤256 的收紧版）');
  assert.equal(net.calls(), 1, '50 篇恰好一批');
  assert.equal(db.embeddedCount(), 50);
  // 再来一次补齐下一批；已嵌条目不会被重嵌（hash 增量）
  const r2 = await e.topUp(50);
  assert.equal(r2.embedded, 50);
  assert.equal(db.embeddedCount(), 100);
  // 最后一批只剩 20 篇：按实际待嵌数返回，不硬凑 50
  assert.equal((await e.topUp(50)).embedded, 20);
  assert.equal(db.embeddedCount(), 120);
  // 全部补齐后：零待嵌、零新增请求
  const before = net.calls();
  assert.equal((await e.topUp(50)).embedded, 0);
  assert.equal(net.calls(), before, '没有待嵌条目时一次请求都不发');
});

test('查询路径按需补齐：失败写持久标记且不再自动重试（计费红线）', async function () {
  const store = new Map();
  const db = fakeDb(['W1', 'W2']);
  const net = fakeEmbed(cfg, 1);
  const e = createResearchEmbedder({
    researchDb: db, embed: net,
    getSetting: async function (k) { return store.get(k) || null; },
    setSetting: async function (k, v) { store.set(k, v); }
  });
  const r1 = await e.topUp();
  assert.ok(r1.error, '失败如实上抛');
  assert.ok(store.get('embedFailedBatch'), '失败标记已持久化');
  assert.equal(db.embeddedCount(), 0);
  // 后续查询路径补齐：见标记即跳过，零新增请求
  const callsAfterFirst = net.calls();
  assert.equal((await e.topUp()).skipped, 'failed');
  assert.equal(net.calls(), callsAfterFirst);
  // 手动构建 = 明确的人工恢复
  const r2 = await e.runBuild();
  assert.equal(r2.done, true);
  assert.equal(db.embeddedCount(), 2);
});

test('查询路径按需补齐：向量模型未配 / 构建器在跑时跳过（零出网）', async function () {
  const empty = { agentBaseUrl: '', agentApiKey: '', embedModel: '' };
  const net = fakeEmbed(empty);
  const e = createResearchEmbedder({ researchDb: fakeDb(['W1']), embed: net });
  assert.equal((await e.topUp()).skipped, 'unconfigured');
  assert.equal(net.calls(), 0);

  // 构建器在跑：补齐不插队（避免同一批重复计费）
  const db2 = fakeDb(['W1', 'W2']);
  let release = null;
  const gate = new Promise(function (resolve) { release = resolve; });
  const slowNet = {
    calls: 0,
    resolveTarget: async function () { return LitEmbedCfg.resolveTarget(cfg); },
    embedTexts: async function (input) {
      slowNet.calls++;
      await gate;
      return { model: cfg.embedModel, vectors: input.texts.map(function () { return [0.1, 0.2]; }) };
    }
  };
  const e2 = createResearchEmbedder({ researchDb: db2, embed: slowNet });
  const building = e2.runBuild();
  await new Promise(function (r) { setImmediate(r); });
  const skipped = await e2.topUp();
  assert.equal(skipped.skipped, 'running');
  assert.equal(slowNet.calls, 1, '补齐没有发起第二次嵌入请求');
  release();
  await building;
});
