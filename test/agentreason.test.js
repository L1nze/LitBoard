'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Reason = require('../js/agentreason.js');

const cap = (o) => Reason.detect(o);

test('DeepSeek: 官方四档，无 medium，medium 归一到 high', function () {
  const c = cap({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
  assert.equal(c.provider, 'deepseek');
  assert.deepEqual(c.levels, ['off', 'low', 'high', 'max']);
  assert.deepEqual(Reason.buildBody(c, 'high'), { reasoning_effort: 'high' });
  assert.deepEqual(Reason.buildBody(c, 'low'), { reasoning_effort: 'low' });
  // R01（2026-09-20 核对官方 thinking 文档）：关闭思考走 thinking.type=disabled 开关，
  // reasoning_effort 只接受 low/high/max——'none' 不是合法关闭取值
  assert.deepEqual(Reason.buildBody(c, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(Reason.buildBody(c, 'max'), { reasoning_effort: 'max' });
  assert.deepEqual(Reason.buildBody(c, ''), {});
  // 关键：medium 不原样下发（官方会当 high），且如实标注
  const r = Reason.normalize(c, 'medium');
  assert.equal(r.level, 'high');
  assert.equal(r.remapped, true);
  assert.ok(r.note.indexOf('medium') !== -1);
  assert.deepEqual(Reason.buildBody(c, 'medium'), { reasoning_effort: 'high' });
  // 模型名识别（走代理、host 不含 deepseek）
  assert.equal(cap({ baseUrl: 'https://proxy.example.com/v1', model: 'deepseek-v4-pro' }).provider, 'deepseek');
});

test('Kimi: k2.x 用 thinking.type，k3 用 reasoning_effort，k2.7-code 不可关', function () {
  const k2 = cap({ baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6' });
  assert.equal(k2.provider, 'kimi');
  assert.deepEqual(k2.levels, ['off', 'high']);
  assert.deepEqual(Reason.buildBody(k2, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(Reason.buildBody(k2, 'high'), { thinking: { type: 'enabled' } });
  assert.deepEqual(Reason.buildBody(k2, 'low'), { thinking: { type: 'enabled' } }); // 归一为开

  const k3 = cap({ baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' });
  assert.deepEqual(k3.levels, ['low', 'high', 'max']);
  assert.deepEqual(Reason.buildBody(k3, 'max'), { reasoning_effort: 'max' });
  const offK3 = Reason.normalize(k3, 'off');
  assert.equal(offK3.level, '');                      // k3 始终思考，关不掉
  assert.ok(offK3.note.indexOf('无法关闭') !== -1);
  assert.deepEqual(Reason.buildBody(k3, 'off'), {});

  const code = cap({ baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.7-code' });
  assert.deepEqual(code.levels, []);
  assert.deepEqual(Reason.buildBody(code, 'high'), {});
});

test('GLM: 4.x 只有 thinking 开关，5.2+ 有 effort，5.3 不能关', function () {
  const g46 = cap({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' });
  assert.equal(g46.provider, 'glm');
  assert.deepEqual(g46.levels, ['off', 'high']);
  assert.deepEqual(Reason.buildBody(g46, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(Reason.buildBody(g46, 'max'), { thinking: { type: 'enabled' } }); // 4.6 无 effort → 开关

  const g52 = cap({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2' });
  assert.deepEqual(g52.levels, ['off', 'low', 'high', 'max']);
  assert.deepEqual(Reason.buildBody(g52, 'medium'), { reasoning_effort: 'high' });
  assert.deepEqual(Reason.buildBody(g52, 'off'), { reasoning_effort: 'none' });

  const g53 = cap({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash' });
  assert.deepEqual(g53.levels, ['low', 'high', 'max']);   // 不能关
  const off53 = Reason.normalize(g53, 'off');
  assert.equal(off53.level, '');
  assert.ok(off53.note.indexOf('不允许关闭') !== -1);
  assert.deepEqual(Reason.buildBody(g53, 'low'), { reasoning_effort: 'low' });
});

test('Qwen: 旧系列开关，3.8 按官方档位；能力只取决于模型 ID', function () {
  const q = cap({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' });
  assert.equal(q.provider, 'qwen');
  assert.deepEqual(q.levels, ['off', 'high']);
  assert.deepEqual(Reason.buildBody(q, 'off'), { enable_thinking: false });
  assert.deepEqual(Reason.buildBody(q, 'high'), { enable_thinking: true });
  assert.deepEqual(Reason.buildBody(q, 'medium'), { enable_thinking: true });
  const q38 = cap({ baseUrl: 'https://proxy.example.com/v1', model: 'qwen3.8-max' });
  assert.deepEqual(q38.levels, ['off', 'low', 'medium', 'xhigh']);
  assert.deepEqual(Reason.buildBody(q38, 'off'), { reasoning_effort: 'none' });
  assert.deepEqual(Reason.buildBody(q38, 'xhigh'), { reasoning_effort: 'xhigh' });
  assert.equal(cap({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'glm-5.3' }).provider, 'glm');
  assert.equal(cap({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'ZHIPU/GLM-5.3' }).provider, 'glm');
  assert.equal(cap({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'kimi-k3' }).provider, 'kimi');
  assert.equal(cap({ baseUrl: 'https://api.deepseek.com', model: 'qwen3.8-flash' }).provider, 'qwen');
});

test('OpenAI: minimal/low/medium/high，max 归一到 high', function () {
  const o = cap({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' });
  assert.equal(o.provider, 'openai');
  assert.deepEqual(o.levels, ['off', 'low', 'medium', 'high']);
  assert.deepEqual(Reason.buildBody(o, 'off'), { reasoning_effort: 'minimal' });
  assert.deepEqual(Reason.buildBody(o, 'medium'), { reasoning_effort: 'medium' });
  assert.deepEqual(Reason.buildBody(o, 'max'), { reasoning_effort: 'high' });
  const current = cap({ baseUrl: 'https://proxy.example.com/v1', model: 'gpt-5.5' });
  assert.deepEqual(current.levels, ['off', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(Reason.buildBody(current, 'off'), { reasoning_effort: 'none' });
  const pro = cap({ model: 'gpt-5.5-pro' });
  assert.deepEqual(pro.levels, ['medium', 'high', 'xhigh']);
  assert.deepEqual(Reason.buildBody(pro, 'off'), {});
});

test('Claude: 支持的型号显示 effort 档位，旧型号只显示默认', function () {
  const opus = cap({ baseUrl: 'https://proxy.example.com/v1', model: 'claude-opus-4-7' });
  assert.deepEqual(opus.levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(Reason.buildBody(opus, 'xhigh'), { reasoning_effort: 'xhigh' });
  const sonnet = cap({ model: 'claude-sonnet-4-6' });
  assert.deepEqual(sonnet.levels, ['low', 'medium', 'high', 'max']);
  assert.deepEqual(Reason.options(cap({ model: 'claude-haiku-4-5' })).map((o) => o.value), ['']);
});

test('未知端点不下发任何推理参数（不制造 400、不伪造控制力）', function () {
  for (const input of [
    { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
    { baseUrl: 'https://api.deepseek.com', model: 'internal-model-7b' },
    { baseUrl: '', model: '' },
    { baseUrl: 'https://my-proxy.example.com/v1', model: 'internal-model-7b' }
  ]) {
    const c = cap(input);
    assert.equal(c.provider, 'generic');
    assert.deepEqual(c.levels, []);
    for (const level of Reason.ALL_LEVELS) {
      assert.deepEqual(Reason.buildBody(c, level), {});
    }
  }
});

test('options() 只列出官方支持档位，且恒含「默认」首项', function () {
  const ds = Reason.options(cap({ model: 'deepseek-flash' }));
  assert.deepEqual(ds.map((o) => o.value), ['', 'off', 'low', 'high', 'max']);
  assert.equal(ds[3].official, 'high');
  const glm46 = Reason.options(cap({ model: 'glm-4.6' }));
  assert.deepEqual(glm46.map((o) => o.value), ['', 'off', 'high']);
  const gen = Reason.options(cap({ model: 'x' }));
  assert.deepEqual(gen.map((o) => o.value), ['']);
});

test('R01/M9-5: vision 识别保守取向——认不准的模型不发图', function () {
  // 已知视觉系命名 → vision true
  assert.equal(cap({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }).vision, true);
  assert.equal(cap({ model: 'qwen2.5-vl-72b' }).vision, true);
  assert.equal(cap({ model: 'gpt-4o' }).vision, true);
  assert.equal(cap({ model: 'glm-4v-flash' }).vision, true);
  // 文本系命名 → false
  assert.equal(cap({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' }).vision, false);
  assert.equal(cap({ model: 'qwen-plus' }).vision, false);
  // 未知端点即使模型名像视觉系也一律不发（provider 识别不出的恒 false）
  assert.equal(cap({ baseUrl: 'https://my-proxy.example.com/v1', model: 'vision-model-7b' }).vision, false);
});
