'use strict';

/* electron/integrations.js 的 AI 助手「服务商 + 模型」配置面（配置语义的纯函数部分在
 * test/agentcfg.test.js）。这里盯的是**凭据落盘与镜像**这几条不能出错的行为：
 * 每服务商一把 Key、留空不覆盖、扁平字段是当前生效服务商的镜像（agent-net 与
 * js/embedcfg 的 legacy-chat 回退都读它，镜像错了就是「换了模型还在打老端点」）。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createIntegrations } = require('../electron/integrations.js');

// 与 test/sync.test.js 同款假 safeStorage：明文可回转，便于断言密文里没有原文
function fakeSafeStorage() {
  return {
    isEncryptionAvailable: function () { return true; },
    encryptString: function (value) { return Buffer.from('enc:' + value, 'utf8'); },
    decryptString: function (value) { return value.toString('utf8').replace(/^enc:/, ''); }
  };
}

async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-agentprov-'));
  t.after(function () { return fs.rm(dir, { recursive: true, force: true }); });
  const integrations = createIntegrations({
    baseDir: dir, homeDir: dir, safeStorage: fakeSafeStorage(),
    fetch: async function () { throw new Error('本测试不联网'); }
  });
  return { dir: dir, integrations: integrations };
}

async function rawConfig(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, 'integrations.json'), 'utf8'));
}

test('老配置（只有扁平字段）读取时合成内置服务商，会话运行期配置不变', async function (t) {
  const { dir, integrations } = await setup(t);
  await integrations.saveConfig({
    agentBaseUrl: 'https://api.deepseek.com/anthropic',
    agentApiDialect: 'messages',
    agentApiKey: 'sk-old',
    agentModel: 'deepseek-chat'
  });
  const config = await integrations.getConfig();
  assert.equal(config.agentProviders.length, 1);
  assert.equal(config.agentProviders[0].id, 'default');
  assert.equal(config.agentProviders[0].hasApiKey, true);
  assert.deepEqual(config.agentProviders[0].models, ['deepseek-chat']);
  assert.equal(config.agentActiveProviderId, 'default');
  // 扁平字段仍是老消费方（agent-net / 设置页就绪判定）的输入
  assert.equal(config.agentBaseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(config.agentApiDialect, 'messages');
  assert.equal(config.agentModel, 'deepseek-chat');
  assert.equal(config.hasAgentApiKey, true);
  const runtime = await integrations.getResearchRuntimeConfig();
  assert.equal(runtime.agentBaseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(runtime.agentApiKey, 'sk-old');
  // 密文落盘：配置文件里没有明文 Key
  const raw = await rawConfig(dir);
  assert.equal(raw.agentProviders[0].apiKey.indexOf('sk-old'), -1);
  assert.equal(JSON.stringify(raw).indexOf('sk-old'), -1);
});

test('API Key 常规配置只返回脱敏提示，用户显式请求时才按需解密', async function (t) {
  const { integrations } = await setup(t);
  await integrations.saveConfig({
    openalexApiKey: 'sk_secretf328',
    agentProviders: [{ id: 'default', name: 'Main', baseUrl: 'https://api.example/v1', models: ['m'], activeModel: 'm', apiKey: 'ak_agent9876' }],
    agentActiveProviderId: 'default'
  });
  const config = await integrations.getConfig();
  assert.equal(config.openalexApiKeyHint, 'sk_****f328');
  assert.equal(config.agentProviders[0].apiKeyHint, 'ak_****9876');
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'openalexApiKey'), false, '常规配置不得泄露明文');
  assert.equal(await integrations.revealSecret({ kind: 'openalex' }), 'sk_secretf328');
  assert.equal(await integrations.revealSecret({ kind: 'agent', providerId: 'default' }), 'ak_agent9876');
  assert.equal(await integrations.revealSecret({ kind: 'unknown' }), '');
});

test('提交服务商清单：明文加密落盘；未重填的服务商沿用已存 Key（绝不二次加密）', async function (t) {
  const { dir, integrations } = await setup(t);
  const first = await integrations.saveConfig({
    agentProviders: [
      { id: 'default', name: '', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'], activeModel: 'deepseek-chat', apiKey: 'sk-default' },
      { id: 'p1', name: 'DS', baseUrl: 'https://api.deepseek.com/anthropic', dialect: 'messages', models: ['deepseek-v4-pro'], activeModel: 'deepseek-v4-pro', apiKey: 'sk-p1' }
    ],
    agentActiveProviderId: 'p1'
  });
  assert.equal(first.agentActiveProviderId, 'p1');
  assert.equal(first.agentBaseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(first.agentModel, 'deepseek-v4-pro');
  assert.equal(first.hasAgentApiKey, true);
  let raw = await rawConfig(dir);
  assert.equal(raw.agentProviders.length, 2);
  const storedP1 = raw.agentProviders[1].apiKey;

  // 渲染层从不持有密文：第二次提交不带 apiKey → 沿用旧密文（而不是清空或加密密文）
  const second = await integrations.saveConfig({
    agentProviders: [
      { id: 'default', name: '', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'], activeModel: 'deepseek-chat' },
      { id: 'p1', name: 'DS 改', baseUrl: 'https://api.deepseek.com/anthropic', dialect: 'messages', models: ['deepseek-v4-pro', 'deepseek-flash'], activeModel: 'deepseek-v4-pro' }
    ],
    agentActiveProviderId: 'p1'
  });
  assert.equal(second.agentProviders[1].hasApiKey, true);
  raw = await rawConfig(dir);
  assert.equal(raw.agentProviders[1].apiKey, storedP1);
  assert.equal(raw.agentProviders[1].name, 'DS 改');
  assert.deepEqual(raw.agentProviders[1].models, ['deepseek-v4-pro', 'deepseek-flash']);
  assert.equal(raw.agentProviders[0].apiKey.indexOf('enc:'), -1); // 服务商密文本身就带 enc: 前缀，明文里不该出现

  // clearApiKey 是「真清空」的唯一入口
  const third = await integrations.saveConfig({
    agentProviders: raw.agentProviders.map(function (p) {
      return { id: p.id, name: p.name, baseUrl: p.baseUrl, dialect: p.dialect, models: p.models, activeModel: p.activeModel, clearApiKey: p.id === 'p1' };
    }),
    agentActiveProviderId: 'p1'
  });
  assert.equal(third.agentProviders[1].hasApiKey, false);
  assert.equal(third.hasAgentApiKey, false);
});

test('setAgentSelection：切换当前服务商与模型，凭据按 id 保留（不写回密文）', async function (t) {
  const { dir, integrations } = await setup(t);
  await integrations.saveConfig({
    agentProviders: [
      { id: 'default', name: '', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max'], activeModel: 'qwen-plus', apiKey: 'sk-qwen' },
      { id: 'p1', name: 'DS', baseUrl: 'https://api.deepseek.com/anthropic', dialect: 'messages', models: ['deepseek-flash'], activeModel: 'deepseek-flash', apiKey: 'sk-ds' }
    ],
    agentActiveProviderId: 'default'
  });
  const before = await rawConfig(dir);
  const switched = await integrations.setAgentSelection({ providerId: 'p1', model: 'deepseek-flash' });
  assert.equal(switched.agentActiveProviderId, 'p1');
  assert.equal(switched.agentBaseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(switched.agentApiDialect, 'messages');
  assert.equal(switched.agentModel, 'deepseek-flash');
  const runtime = await integrations.getResearchRuntimeConfig();
  assert.equal(runtime.agentApiKey, 'sk-ds');
  const after = await rawConfig(dir);
  // 两把 Key 都没被动过（密文逐字节相同 → 没有二次加密、也没有被覆盖）
  assert.equal(after.agentProviders[0].apiKey, before.agentProviders[0].apiKey);
  assert.equal(after.agentProviders[1].apiKey, before.agentProviders[1].apiKey);
  // 回到内置服务商：模型按服务商各自记忆
  const back = await integrations.setAgentSelection({ providerId: 'default', model: 'qwen-max' });
  assert.equal(back.agentActiveProviderId, 'default');
  assert.equal(back.agentModel, 'qwen-max');
  assert.equal((await integrations.getResearchRuntimeConfig()).agentApiKey, 'sk-qwen');
  assert.equal((await integrations.setAgentSelection({ providerId: 'p1', model: 'deepseek-flash' })).agentModel, 'deepseek-flash');
});

test('getAgentProviderRuntime：只解请求的那一个服务商；未知 id 返回 null', async function (t) {
  const { integrations } = await setup(t);
  await integrations.saveConfig({
    agentProviders: [
      { id: 'default', name: '', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'], activeModel: 'deepseek-chat', apiKey: 'sk-default' },
      { id: 'p1', name: 'Km', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.7-code'], activeModel: 'kimi-k2.7-code' }
    ],
    agentActiveProviderId: 'p1'
  });
  const provider = await integrations.getAgentProviderRuntime('default');
  assert.equal(provider.baseUrl, 'https://api.deepseek.com');
  assert.equal(provider.apiKey, 'sk-default');
  assert.equal(provider.model, 'deepseek-chat');
  // 没配 Key 的服务商也要能取到（设置页「测试连接」会给出「Key 未配置」而不是崩溃）
  const noKey = await integrations.getAgentProviderRuntime('p1');
  assert.equal(noKey.apiKey, '');
  assert.equal(noKey.dialect, '');
  assert.equal(await integrations.getAgentProviderRuntime('nope'), null);
  assert.equal(await integrations.getAgentProviderRuntime(''), null);
});

test('删除服务商：连带它的 Key 一起消失；当前选中项回落内置服务商', async function (t) {
  const { dir, integrations } = await setup(t);
  await integrations.saveConfig({
    agentProviders: [
      { id: 'default', name: '', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'], activeModel: 'deepseek-chat', apiKey: 'sk-default' },
      { id: 'p1', name: 'DS', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-v4-pro'], activeModel: 'deepseek-v4-pro', apiKey: 'sk-gone' }
    ],
    agentActiveProviderId: 'p1'
  });
  const after = await integrations.saveConfig({
    agentProviders: [{ id: 'default', name: '', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'], activeModel: 'deepseek-chat' }]
  });
  assert.deepEqual(after.agentProviders.map(function (p) { return p.id; }), ['default']);
  assert.equal(after.agentActiveProviderId, 'default');
  assert.equal(after.agentBaseUrl, 'https://api.deepseek.com');
  const raw = await rawConfig(dir);
  assert.equal(JSON.stringify(raw).indexOf('sk-gone'), -1);
  assert.equal(raw.agentProviders.length, 1);
});

test('旧契约兼容：直接提交扁平字段（老渲染层 / 测试）落到当前生效服务商，模型一并进清单', async function (t) {
  const { dir, integrations } = await setup(t);
  await integrations.saveConfig({ agentBaseUrl: 'https://api.deepseek.com', agentApiKey: 'sk-a', agentModel: 'deepseek-chat' });
  const config = await integrations.saveConfig({ agentModel: 'deepseek-v4-pro', agentApiDialect: 'messages' });
  assert.equal(config.agentModel, 'deepseek-v4-pro');
  assert.equal(config.agentApiDialect, 'messages');
  assert.equal(config.hasAgentApiKey, true);
  assert.deepEqual(config.agentProviders[0].models, ['deepseek-chat', 'deepseek-v4-pro']);
  assert.equal(config.agentProviders[0].activeModel, 'deepseek-v4-pro');
  assert.equal((await integrations.getResearchRuntimeConfig()).agentApiKey, 'sk-a');
  // 落盘形态只留已知字段 + 密文 apiKey：渲染层占位（hasApiKey）不得写进配置文件
  const raw = await rawConfig(dir);
  assert.deepEqual(Object.keys(raw.agentProviders[0]).sort(),
    ['activeModel', 'apiKey', 'baseUrl', 'dialect', 'id', 'models', 'name']);
  assert.equal(raw.agentProviders[0].hasApiKey, undefined);
});
