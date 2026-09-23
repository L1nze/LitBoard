'use strict';

/* js/agentcfg.js：AI 助手「服务商 + 模型」配置纯函数层。
 * 这里是配置的语义权威（旧扁平字段 ↔ 服务商清单的迁移、镜像、选择、增删），
 * 主进程 integrations/agent-net 与渲染层都消费它，所以断言直接写在语义上。 */

const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/agentcfg.js');
const Proto = require('../js/agentproto.js');

test('normalizeConfig：老配置（只有扁平字段）合成内置服务商，扁平值不丢', () => {
  const cfg = C.normalizeConfig({
    agentBaseUrl: 'https://api.deepseek.com/anthropic',
    agentApiDialect: 'messages',
    agentApiKey: '<enc>',
    agentModel: 'deepseek-flash'
  });
  assert.strictEqual(cfg.providers.length, 1);
  const p = cfg.providers[0];
  assert.strictEqual(p.id, C.DEFAULT_PROVIDER_ID);
  assert.strictEqual(p.baseUrl, 'https://api.deepseek.com/anthropic');
  assert.strictEqual(p.dialect, 'messages');
  assert.strictEqual(p.apiKey, '<enc>');
  assert.deepStrictEqual(p.models, ['deepseek-flash']);
  assert.strictEqual(p.activeModel, 'deepseek-flash');
  assert.strictEqual(cfg.activeId, C.DEFAULT_PROVIDER_ID);
  // 空配置也要有内置服务商（界面与发送路径都假定「至少一个」）
  assert.strictEqual(C.normalizeConfig({}).providers.length, 1);
  assert.strictEqual(C.normalizeConfig(null).activeId, C.DEFAULT_PROVIDER_ID);
});

test('normalizeConfig：已有自定义服务商时也一定补上内置服务商（旧字段仍有消费方）', () => {
  const cfg = C.normalizeConfig({
    agentBaseUrl: 'https://api.deepseek.com',
    agentModel: 'deepseek-chat',
    agentActiveProviderId: 'p1',
    agentProviders: [{ id: 'p1', name: 'DS', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-v4-pro'], activeModel: 'deepseek-v4-pro' }]
  });
  assert.deepStrictEqual(cfg.providers.map((p) => p.id), ['default', 'p1']);
  assert.strictEqual(cfg.activeId, 'p1');
  // activeId 指向不存在的服务商时回落内置（配置文件被手改过的场景）
  assert.strictEqual(C.normalizeConfig({ agentProviders: [{ id: 'x', baseUrl: 'https://a/v1' }], agentActiveProviderId: 'zzz' }).activeId, C.DEFAULT_PROVIDER_ID);
  // 重复 id 只留第一条，服务商数量有上限
  const dup = C.normalizeConfig({ agentProviders: [{ id: 'a', baseUrl: 'https://a' }, { id: 'a', baseUrl: 'https://b' }] });
  assert.strictEqual(dup.providers.filter((p) => p.id === 'a').length, 1);
});

test('normalizeProvider：模型去空去重、接口格式白名单、activeModel 随清单回落', () => {
  const p = C.normalizeProvider({ id: 'p', dialect: 'MESSAGES', models: [' a ', '', 'a', 'b', null], activeModel: 'gone' });
  assert.deepStrictEqual(p.models, ['a', 'b']);
  assert.strictEqual(p.dialect, 'messages');
  // 选中的模型被删掉 → 落回首项，而不是留一个不存在的名字
  assert.strictEqual(p.activeModel, 'a');
  // 清单为空时保留用户刚填的名字（还没点「添加模型」）
  assert.strictEqual(C.normalizeProvider({ models: [], activeModel: 'typed' }).activeModel, 'typed');
  assert.strictEqual(C.normalizeProvider({ dialect: 'bogus' }).dialect, '');
  assert.strictEqual(C.normalizeProvider(null, 'fallback').id, 'fallback');
});

test('mirror：把当前服务商写成扁平字段（agent-net / embedcfg 回退的输入）', () => {
  const cfg = {
    agentActiveProviderId: 'p1',
    agentProviders: [
      { id: 'default', baseUrl: '', models: [], activeModel: '' },
      { id: 'p1', baseUrl: 'https://api.moonshot.cn/v1', dialect: 'chat', models: ['kimi-k2.7-code'], activeModel: 'kimi-k2.7-code' }
    ]
  };
  assert.deepStrictEqual(C.mirror(cfg), {
    agentBaseUrl: 'https://api.moonshot.cn/v1',
    agentApiDialect: 'chat',
    agentModel: 'kimi-k2.7-code'
  });
  assert.deepStrictEqual(C.selectionOf(cfg), { providerId: 'p1', model: 'kimi-k2.7-code' });
});

test('selectModel / upsertProvider / removeProvider：纯函数，不改入参', () => {
  const cfg = {
    agentActiveProviderId: 'p1',
    agentProviders: [
      { id: 'default', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat'], activeModel: 'deepseek-chat' },
      { id: 'p1', name: 'DS', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-flash', 'deepseek-v4-pro'], activeModel: 'deepseek-flash' }
    ]
  };
  const frozen = JSON.stringify(cfg);
  const switched = C.selectModel(cfg, 'p1', 'deepseek-v4-pro');
  assert.strictEqual(switched.activeId, 'p1');
  assert.strictEqual(switched.providers[1].activeModel, 'deepseek-v4-pro');
  const back = C.selectModel(switched, C.DEFAULT_PROVIDER_ID, 'deepseek-chat');
  assert.strictEqual(back.activeId, C.DEFAULT_PROVIDER_ID);
  // 当前模型按服务商各自记忆：切回来仍是各自上次选的那个
  assert.strictEqual(C.selectModel(back, 'p1', '').providers[1].activeModel, 'deepseek-v4-pro');
  assert.strictEqual(JSON.stringify(cfg), frozen, '入参被就地改动');

  const added = C.upsertProvider(cfg, { id: 'p2', name: 'Km', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.7-code'] });
  assert.deepStrictEqual(added.providers.map((p) => p.id), ['default', 'p1', 'p2']);
  assert.strictEqual(added.providers[2].activeModel, 'kimi-k2.7-code');
  // 同 id 覆盖（设置页「保存该服务商」走的就是这条）
  const replaced = C.upsertProvider(added, { id: 'p2', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.7-code', 'kimi-latest'] });
  assert.strictEqual(replaced.providers.length, 3);
  assert.strictEqual(replaced.providers[2].name, 'Kimi');
  assert.deepStrictEqual(replaced.providers[2].models, ['kimi-k2.7-code', 'kimi-latest']);

  // 内置服务商删不掉；删掉当前选中的服务商 → 回落内置
  assert.strictEqual(C.removeProvider(replaced, C.DEFAULT_PROVIDER_ID).providers.length, 3);
  const removed = C.removeProvider(C.selectModel(replaced, 'p2', 'kimi-latest'), 'p2');
  assert.deepStrictEqual(removed.providers.map((p) => p.id), ['default', 'p1']);
  assert.strictEqual(removed.activeId, C.DEFAULT_PROVIDER_ID);
});

test('newProviderId：确定性、重名加后缀', () => {
  const id = C.newProviderId([], 1700000000000);
  assert.ok(/^p[0-9a-z]+$/.test(id));
  assert.strictEqual(C.newProviderId([], 1700000000000), id);
  assert.notStrictEqual(C.newProviderId([{ id: id }], 1700000000000), id);
});

test('providerLabel：自定义名 → 协议层服务商名 → 主机名 → 空串', () => {
  assert.strictEqual(C.providerLabel({ name: 'DS' }, Proto), 'DS');
  assert.strictEqual(C.providerLabel({ baseUrl: 'https://opencode.ai/zen/go/v1' }, Proto), 'OpenCode Go');
  assert.strictEqual(C.providerLabel({ baseUrl: 'https://example.org/v1' }, Proto), 'example.org');
  assert.strictEqual(C.providerLabel({}, Proto), '');
  // 协议层缺失时也不能抛（渲染层脚本顺序变化时仍可显示）
  assert.strictEqual(C.providerLabel({ baseUrl: 'https://example.org/v1' }, null), 'example.org');
});

test('providerStatus：状态点只判「有没有」（有效性交给「测试连接」）', () => {
  assert.strictEqual(C.providerStatus({ baseUrl: '', hasApiKey: true }), 'empty');
  assert.strictEqual(C.providerStatus({ baseUrl: 'https://a/v1', hasApiKey: false }), 'partial');
  assert.strictEqual(C.providerStatus({ baseUrl: 'https://a/v1', hasApiKey: true, models: ['m'] }), 'ready');
  assert.strictEqual(C.providerStatus({ baseUrl: 'https://a/v1', hasApiKey: true, models: [], activeModel: 'm' }), 'ready');
  assert.strictEqual(C.providerStatus({ baseUrl: 'https://a/v1', apiKey: 'plain' }), 'partial');
});

test('menuGroups：按服务商分组、标出当前项；没有模型的服务商不占位', () => {
  const groups = C.menuGroups({
    agentActiveProviderId: 'p1',
    agentProviders: [
      { id: 'default', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus'], activeModel: 'qwen-plus' },
      { id: 'p1', name: 'DS', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-flash', 'deepseek-v4-pro'], activeModel: 'deepseek-flash' },
      { id: 'p2', name: '空壳', baseUrl: 'https://api.moonshot.cn/v1', models: [] }
    ]
  }, Proto);
  assert.deepStrictEqual(groups.map((g) => g.id), ['default', 'p1']);
  assert.strictEqual(groups[0].label, 'DashScope');
  assert.strictEqual(groups[0].active, false);
  assert.deepStrictEqual(groups[1].models.map((m) => m.id), ['deepseek-flash', 'deepseek-v4-pro']);
  assert.deepStrictEqual(groups[1].models.map((m) => m.active), [true, false]);
  assert.strictEqual(groups[1].current, 'deepseek-flash');
  // 当前服务商只有「填了没添加」的模型名时也要可见（否则底部徽标无处对应）
  const onlyTyped = C.menuGroups({ agentProviders: [{ id: 'default', baseUrl: 'https://a/v1', models: [], activeModel: 'typed-m' }] }, Proto);
  assert.deepStrictEqual(onlyTyped[0].models.map((m) => m.id), ['typed-m']);
});
