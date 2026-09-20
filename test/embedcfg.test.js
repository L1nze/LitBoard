'use strict';

/* 向量模型配置解析（js/embedcfg.js）：预设、单批条数、目标解析优先级。
 * 语义检索只有这一条链（正式库的 paper_vec / semantic: 已于 2026-09-20 删除）。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/embedcfg.js');

test('预设：DashScope / OpenAI / 本地 ollama，都自带 Base URL + 模型名 + 单批条数', function () {
  assert.equal(C.PRESETS.dashscope.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(C.PRESETS.dashscope.model, 'text-embedding-v3');
  assert.equal(C.PRESETS.openai.model, 'text-embedding-3-small');
  assert.equal(C.PRESETS.ollama.baseUrl, 'http://localhost:11434/v1');
  Object.keys(C.PRESETS).forEach(function (id) {
    const preset = C.PRESETS[id];
    assert.ok(preset.baseUrl && preset.model && preset.batch > 0, id + ' 预设字段不全');
  });
});

test('batchFor：预设优先，其次按主机（DashScope 系 10 条），未知端点默认 16', function () {
  assert.equal(C.batchFor('https://api.openai.com/v1', 'openai'), 50);
  assert.equal(C.batchFor('https://dashscope.aliyuncs.com/compatible-mode/v1', 'dashscope'), 10);
  // 没选预设也认主机：阿里云兼容模式一次最多 10 条
  assert.equal(C.batchFor('https://dashscope.aliyuncs.com/compatible-mode/v1', ''), 10);
  assert.equal(C.batchFor('https://api.siliconflow.cn/v1', ''), C.DEFAULT_BATCH);
  assert.equal(C.batchFor('不是 URL', ''), C.DEFAULT_BATCH);
});

test('resolveTarget：专用配置齐备 → configured（模型与批量都带出）', function () {
  const target = C.resolveTarget({
    embedProvider: 'dashscope',
    embedBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    embedApiKey: 'sk-x',
    embedModel: 'text-embedding-v3'
  });
  assert.equal(target.ok, true);
  assert.equal(target.source, 'configured');
  assert.equal(target.model, 'text-embedding-v3');
  assert.equal(target.apiKey, 'sk-x');
  assert.equal(target.batch, 10);
  assert.equal(target.reason, '');
});

test('resolveTarget：半填专用配置直接报错，绝不静默回退到别的账号', function () {
  const agentCreds = { agentBaseUrl: 'https://chat.example/v1', agentApiKey: 'k', embedModel: 'emb-m' };
  // 有 Base URL 没 Key：不拿 AI 助手的 Key 顶上
  const missingKey = C.resolveTarget(Object.assign({ embedBaseUrl: 'https://emb.example/v1' }, agentCreds));
  assert.equal(missingKey.ok, false);
  assert.equal(missingKey.source, 'configured');
  assert.ok(/配置不完整/.test(missingKey.reason));
  // 有 Base URL + Key 没模型名：同样报错（模型名不可省略）
  const missingModel = C.resolveTarget({
    embedBaseUrl: 'https://emb.example/v1', embedApiKey: 'k', agentBaseUrl: 'https://chat.example/v1', agentApiKey: 'k'
  });
  assert.equal(missingModel.ok, false);
  assert.ok(/配置不完整/.test(missingModel.reason));
  // 只填了 Key 也算「开始填专用配置」，不回退
  const keyOnly = C.resolveTarget(Object.assign({ embedApiKey: 'k' }, agentCreds));
  assert.equal(keyOnly.ok, false);
});

test('resolveTarget：未配置专用端点时回退 AI 助手端点 + 嵌入模型名（legacy-chat）', function () {
  const target = C.resolveTarget({
    agentBaseUrl: 'https://chat.example/v1',
    agentApiKey: 'k',
    embedModel: 'emb-m'
  });
  assert.equal(target.ok, true);
  assert.equal(target.source, 'legacy-chat');
  assert.equal(target.baseUrl, 'https://chat.example/v1');
  assert.equal(target.apiKey, 'k');
  assert.equal(target.model, 'emb-m');
});

test('resolveTarget：都没有配置 → 明确报未配置（并指出去哪填）', function () {
  const none = C.resolveTarget({});
  assert.equal(none.ok, false);
  assert.equal(none.source, '');
  assert.ok(/未配置向量模型/.test(none.reason));
  // 只有 AI 助手端点但没填模型名：仍然未就绪（嵌入模型名不可省略）
  const noModel = C.resolveTarget({ agentBaseUrl: 'https://chat.example/v1', agentApiKey: 'k' });
  assert.equal(noModel.ok, false);
});
