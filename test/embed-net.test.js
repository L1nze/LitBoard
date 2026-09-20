'use strict';

/* 向量模型出网层（electron/embed-net.js）：分批、按 index 对齐、用量记账、连通性测试。
 * 这几条测试原本挂在 agent-net（嵌入借 AI 助手端点那会儿），随实现一起搬过来。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmbedService, chunkTexts, normalizeTexts, MAX_TEXT_CHARS } = require('../electron/embed-net.js');

function stubFetch(handler) {
  const seen = [];
  return {
    seen: seen,
    fetch: async function (url, init) {
      seen.push({ url: url, headers: init.headers, body: JSON.parse(init.body) });
      return handler(url, init, seen.length);
    }
  };
}

function okResponse(payload) {
  return { ok: true, status: 200, text: async function () { return JSON.stringify(payload); } };
}

test('chunkTexts：按批量切分，batch 非法时退回默认', function () {
  assert.deepEqual(chunkTexts(['a', 'b', 'c', 'd', 'e'], 2), [['a', 'b'], ['c', 'd'], ['e']]);
  assert.equal(chunkTexts(['a'], 0).length, 1);
  assert.equal(MAX_TEXT_CHARS, 3000);
  assert.deepEqual(normalizeTexts(['a', '', null, 'b']), ['a', 'b']);
});

test('embedTexts：按专用配置分包并保持顺序（index 乱序也按 index 对齐）', async function () {
  const stub = stubFetch(function (url, init, call) {
    const inputs = JSON.parse(init.body).input;
    return okResponse({
      data: inputs.map(function (text, index) {
        return { index: inputs.length - 1 - index, embedding: [text.length, call] };
      }).reverse().map(function (row) { return row; }),
      usage: { total_tokens: 3 }
    });
  });
  const service = createEmbedService({
    fetch: stub.fetch,
    getConfig: async function () {
      return {
        embedProvider: 'dashscope',
        embedBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        embedApiKey: 'sk-x',
        embedModel: 'text-embedding-v3'
      };
    }
  });
  // 12 条 → DashScope 批量 10 → 两批
  const texts = [];
  for (let i = 0; i < 12; i++) texts.push('t' + i);
  const result = await service.embedTexts({ texts: texts });
  assert.equal(result.model, 'text-embedding-v3');
  assert.equal(result.source, 'configured');
  assert.equal(result.batches, 2);
  assert.equal(result.vectors.length, 12);
  assert.equal(stub.seen.length, 2);
  assert.equal(stub.seen[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
  assert.equal(stub.seen[0].headers.Authorization, 'Bearer sk-x');
  assert.equal(stub.seen[0].body.model, 'text-embedding-v3');
  assert.equal(stub.seen[0].body.input.length, 10);
  assert.equal(stub.seen[1].body.input.length, 2);
});

test('embedTexts：用量按请求累计并回调持久化（重启可恢复）', async function () {
  const persisted = [];
  const stub = stubFetch(function () { return okResponse({ data: [{ index: 0, embedding: [0.1] }], usage: { total_tokens: 42 } }); });
  const service = createEmbedService({
    fetch: stub.fetch,
    getConfig: async function () {
      return { embedBaseUrl: 'https://emb.example/v1', embedApiKey: 'k', embedModel: 'm' };
    },
    persistUsage: async function (totals) { persisted.push(totals); }
  });
  await service.embedTexts({ texts: ['a'] });
  assert.deepEqual(service.getUsage(), { requests: 1, tokens: 42 });
  await new Promise(function (resolve) { setTimeout(resolve, 2100); });
  assert.ok(persisted.length >= 1);
  assert.equal(persisted[persisted.length - 1].tokens, 42);
});

test('embedTexts：未配置 / 半配置时报可执行的错，且一次都不出网', async function () {
  const stub = stubFetch(function () { throw new Error('should not be called'); });
  const bare = createEmbedService({ fetch: stub.fetch, getConfig: async function () { return {}; } });
  await assert.rejects(function () { return bare.embedTexts({ texts: ['x'] }); }, /未配置向量模型/);
  const half = createEmbedService({
    fetch: stub.fetch,
    getConfig: async function () { return { embedBaseUrl: 'https://emb.example/v1' }; }
  });
  await assert.rejects(function () { return half.embedTexts({ texts: ['x'] }); }, /配置不完整/);
  const empty = createEmbedService({ fetch: stub.fetch, getConfig: async function () { return {}; } });
  await assert.rejects(function () { return empty.embedTexts({ texts: [] }); }, /没有可嵌入的文本/);
  assert.equal(stub.seen.length, 0);
});

test('embedTexts：上游错误如实上抛（含 HTTP 状态），不自动重试', async function () {
  let calls = 0;
  const stub = stubFetch(function () {
    calls++;
    return { ok: false, status: 429, text: async function () { return JSON.stringify({ error: { message: 'rate limited' } }); } };
  });
  const service = createEmbedService({
    fetch: stub.fetch,
    getConfig: async function () { return { embedBaseUrl: 'https://emb.example/v1', embedApiKey: 'k', embedModel: 'm' }; }
  });
  await assert.rejects(function () { return service.embedTexts({ texts: ['x'] }); }, /rate limited/);
  assert.equal(calls, 1);
});

test('embedTexts：返回条数与请求不符时明确报错（不静默错位）', async function () {
  const stub = stubFetch(function () { return okResponse({ data: [{ index: 0, embedding: [1] }] }); });
  const service = createEmbedService({
    fetch: stub.fetch,
    getConfig: async function () { return { embedBaseUrl: 'https://emb.example/v1', embedApiKey: 'k', embedModel: 'm' }; }
  });
  await assert.rejects(function () { return service.embedTexts({ texts: ['a', 'b'] }); }, /数量不匹配/);
});

test('test：连通性测试走当前配置，返回模型与维度；表单值覆盖未保存的配置', async function () {
  const stub = stubFetch(function () { return okResponse({ data: [{ index: 0, embedding: [1, 2, 3] }] }); });
  const service = createEmbedService({
    fetch: stub.fetch,
    getConfig: async function () { return { agentBaseUrl: 'https://chat.example/v1', agentApiKey: 'k', embedModel: 'legacy-m' }; },
    userAgent: 'LitBoard/test'
  });
  const legacy = await service.test({});
  assert.equal(legacy.source, 'legacy-chat');
  assert.equal(legacy.model, 'legacy-m');
  assert.equal(legacy.dim, 3);
  assert.equal(stub.seen[0].url, 'https://chat.example/v1/embeddings');
  // 设置表单里刚填的专用配置（尚未保存）
  const form = await service.test({
    embedProvider: 'openai',
    embedBaseUrl: 'https://api.openai.com/v1',
    embedApiKey: 'sk-new',
    embedModel: 'text-embedding-3-small'
  });
  assert.equal(form.source, 'configured');
  assert.equal(form.model, 'text-embedding-3-small');
  assert.equal(stub.seen[stub.seen.length - 1].url, 'https://api.openai.com/v1/embeddings');
  assert.equal(stub.seen[stub.seen.length - 1].headers.Authorization, 'Bearer sk-new');
  assert.equal(stub.seen[stub.seen.length - 1].headers['User-Agent'], 'LitBoard/test');
});

test('test：配置不完整 → 明确报错，不发起请求', async function () {
  const stub = stubFetch(function () { throw new Error('should not be called'); });
  const service = createEmbedService({ fetch: stub.fetch, getConfig: async function () { return {}; } });
  await assert.rejects(function () { return service.test({ embedBaseUrl: 'https://emb.example/v1' }); }, /配置不完整/);
  assert.equal(stub.seen.length, 0);
});
