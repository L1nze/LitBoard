'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Reason = require('../js/agentreason.js');

const cap = (o) => Reason.detect(o);

test('DeepSeek: 官方四档，无 medium/xhigh，归一到 high', function () {
  const c = cap({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
  assert.equal(c.provider, 'deepseek');
  assert.deepEqual(c.levels, ['off', 'low', 'high', 'max']);
  assert.deepEqual(Reason.buildBody(c, 'high'), { reasoning_effort: 'high' });
  assert.deepEqual(Reason.buildBody(c, 'low'), { reasoning_effort: 'low' });
  // R01：关闭思考走 thinking.type=disabled 开关（官方 reasoning_effort=none 同样支持，
  // 这里沿用开关形态）；reasoning_effort 档位只发 low/high/max
  assert.deepEqual(Reason.buildBody(c, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(Reason.buildBody(c, 'max'), { reasoning_effort: 'max' });
  assert.deepEqual(Reason.buildBody(c, ''), {});
  // 关键：medium/xhigh 不原样下发（官方兼容映射为 high），且如实标注
  const r = Reason.normalize(c, 'medium');
  assert.equal(r.level, 'high');
  assert.equal(r.remapped, true);
  assert.ok(r.note.indexOf('medium') !== -1);
  assert.deepEqual(Reason.buildBody(c, 'medium'), { reasoning_effort: 'high' });
  assert.deepEqual(Reason.buildBody(c, 'xhigh'), { reasoning_effort: 'high' });
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

test('Kimi Code 订阅端点：独立模型 ID，kimi-for-coding/k3 可关可降档', function () {
  // 订阅端点（api.kimi.com/coding）的模型 ID 与开放平台不同源：
  // kimi-for-coding / k3 / k3-256k 走 reasoning_effort none|low|high|max（none = 关思考）
  for (const model of ['kimi-for-coding', 'k3', 'k3-256k']) {
    const c = cap({ baseUrl: 'https://api.kimi.com/coding/v1', model });
    assert.equal(c.provider, 'kimi', model);
    assert.deepEqual(c.levels, ['off', 'low', 'high', 'max'], model);
    assert.deepEqual(Reason.buildBody(c, 'off'), { reasoning_effort: 'none' });
    assert.deepEqual(Reason.buildBody(c, 'low'), { reasoning_effort: 'low' });
    // 官方别名归一：medium→high、xhigh→max（未知取值官方 400，不原样下发）
    assert.deepEqual(Reason.buildBody(c, 'medium'), { reasoning_effort: 'high' });
    assert.deepEqual(Reason.buildBody(c, 'xhigh'), { reasoning_effort: 'max' });
    const r = Reason.normalize(c, 'medium');
    assert.equal(r.remapped, true);
    assert.ok(r.note.indexOf('归一为 high') !== -1);
  }
  // 高速版固定思考，无任何档位
  const hs = cap({ baseUrl: 'https://api.kimi.com/coding/v1', model: 'kimi-for-coding-highspeed' });
  assert.deepEqual(hs.levels, []);
  assert.deepEqual(Reason.buildBody(hs, 'off'), {});
  assert.ok(Reason.normalize(hs, 'off').note.indexOf('固定开启思考') !== -1);
});

test('GLM: 4.5~5.1 只有 thinking 开关，5.2 有效档 off/high/max，5.3 不能关', function () {
  const g46 = cap({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' });
  assert.equal(g46.provider, 'glm');
  assert.deepEqual(g46.levels, ['off', 'high']);
  assert.deepEqual(Reason.buildBody(g46, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(Reason.buildBody(g46, 'max'), { thinking: { type: 'enabled' } }); // 4.6 无 effort → 开关

  // glm-5 / 5.1 官方无 reasoning_effort（5.2 起才有）→ thinking 开关
  const g5 = cap({ model: 'glm-5' });
  assert.deepEqual(g5.levels, ['off', 'high']);
  assert.deepEqual(Reason.buildBody(g5, 'off'), { thinking: { type: 'disabled' } });

  // GLM-4.5 以下官方无 thinking 参数 → 不下发
  const g4 = cap({ model: 'glm-4-flash' });
  assert.equal(g4.provider, 'glm');
  assert.deepEqual(g4.levels, []);
  assert.deepEqual(Reason.buildBody(g4, 'off'), {});
  assert.deepEqual(Reason.buildBody(g4, 'high'), {});

  // 5.2 官方把 low/medium 归一为 high、xhigh 归一为 max——UI 只展示有效档
  const g52 = cap({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2' });
  assert.deepEqual(g52.levels, ['off', 'high', 'max']);
  assert.deepEqual(Reason.buildBody(g52, 'off'), { reasoning_effort: 'none' });
  assert.deepEqual(Reason.buildBody(g52, 'high'), { reasoning_effort: 'high' });
  assert.deepEqual(Reason.buildBody(g52, 'low'), { reasoning_effort: 'high' });
  const g52r = Reason.normalize(g52, 'medium');
  assert.equal(g52r.level, 'high');
  assert.ok(g52r.note.indexOf('归一为 high') !== -1);
  assert.deepEqual(Reason.buildBody(g52, 'xhigh'), { reasoning_effort: 'max' });

  const g53 = cap({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash' });
  assert.deepEqual(g53.levels, ['low', 'high', 'max']);   // 不能关
  const off53 = Reason.normalize(g53, 'off');
  assert.equal(off53.level, '');
  assert.ok(off53.note.indexOf('不允许关闭') !== -1);
  assert.deepEqual(Reason.buildBody(g53, 'low'), { reasoning_effort: 'low' });
  // 5.3 仅 low/high/max，medium/xhigh 归一而不是原样下发（官方会报错）
  assert.deepEqual(Reason.buildBody(g53, 'medium'), { reasoning_effort: 'high' });
  assert.deepEqual(Reason.buildBody(g53, 'xhigh'), { reasoning_effort: 'max' });
});

test('Qwen: 旧系列开关，3.8 按官方档位，qwq/3.8-2.4t 仅思考；能力只取决于模型 ID', function () {
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
  const q38r = Reason.normalize(q38, 'high');
  assert.equal(q38r.level, 'xhigh');
  assert.ok(q38r.note.indexOf('xhigh') !== -1);
  // 仅思考模式：不下发任何参数
  const qwq = cap({ model: 'qwq-plus' });
  assert.equal(qwq.provider, 'qwen');
  assert.deepEqual(qwq.levels, []);
  assert.deepEqual(Reason.buildBody(qwq, 'off'), {});
  assert.ok(Reason.normalize(qwq, 'off').note.indexOf('仅思考') !== -1);
  assert.deepEqual(cap({ model: 'qwen3.8-2.4t-a95b' }).levels, []);
  // 能力识别跨服务商（同模型 ID 在任何端点同一能力）
  assert.equal(cap({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'glm-5.3' }).provider, 'glm');
  assert.equal(cap({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'ZHIPU/GLM-5.3' }).provider, 'glm');
  assert.equal(cap({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'kimi-k3' }).provider, 'kimi');
  assert.equal(cap({ baseUrl: 'https://api.deepseek.com', model: 'qwen3.8-flash' }).provider, 'qwen');
});

test('MiMo: 官方只有 thinking.type 开关，没有力度档', function () {
  const m = cap({ baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-pro' });
  assert.equal(m.provider, 'mimo');
  assert.deepEqual(m.levels, ['off', 'high']);
  assert.deepEqual(Reason.buildBody(m, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(Reason.buildBody(m, 'high'), { thinking: { type: 'enabled' } });
  const r = Reason.normalize(m, 'medium');
  assert.equal(r.level, 'high');
  assert.ok(r.note.indexOf('不支持调节') !== -1);
  assert.deepEqual(Reason.buildBody(m, 'max'), { thinking: { type: 'enabled' } });
  // flash 是尺寸档不是视觉标识：MiMo 只认明确的 vl/omni 才发图
  assert.equal(cap({ model: 'mimo-v2.6-flash' }).vision, false);
  assert.equal(cap({ model: 'mimo-v2-omni' }).vision, true);
});

test('OpenAI: 按型号裁剪档位，pro 仅 high，gpt-6 有 max，o 系三档不可关', function () {
  const o = cap({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' });
  assert.equal(o.provider, 'openai');
  assert.deepEqual(o.levels, ['off', 'low', 'medium', 'high']);
  assert.deepEqual(Reason.buildBody(o, 'off'), { reasoning_effort: 'minimal' });
  assert.deepEqual(Reason.buildBody(o, 'medium'), { reasoning_effort: 'medium' });
  assert.deepEqual(Reason.buildBody(o, 'max'), { reasoning_effort: 'high' });

  const g51 = cap({ model: 'gpt-5.1' });
  assert.deepEqual(g51.levels, ['off', 'low', 'medium', 'high']);
  assert.deepEqual(Reason.buildBody(g51, 'off'), { reasoning_effort: 'none' });

  const current = cap({ baseUrl: 'https://proxy.example.com/v1', model: 'gpt-5.5' });
  assert.deepEqual(current.levels, ['off', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(Reason.buildBody(current, 'off'), { reasoning_effort: 'none' });

  const g56 = cap({ model: 'gpt-5.6' });
  assert.deepEqual(g56.levels, ['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(Reason.buildBody(g56, 'max'), { reasoning_effort: 'max' });

  // pro 官方仅支持 high：其余档位归一到 high 并说明
  const pro = cap({ model: 'gpt-5.5-pro' });
  assert.deepEqual(pro.levels, ['high']);
  assert.deepEqual(Reason.buildBody(pro, 'high'), { reasoning_effort: 'high' });
  const proOff = Reason.normalize(pro, 'off');
  assert.equal(proOff.level, 'high');
  assert.ok(proOff.note.indexOf('仅支持 high') !== -1);
  assert.deepEqual(Reason.buildBody(pro, 'off'), { reasoning_effort: 'high' });

  // gpt-6 主力：none..max；astra / 6.1-sol 无 none（官方 400）
  const g6 = cap({ model: 'gpt-6-luna' });
  assert.deepEqual(g6.levels, ['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(Reason.buildBody(g6, 'off'), { reasoning_effort: 'none' });
  const astra = cap({ model: 'gpt-6-astra' });
  assert.deepEqual(astra.levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(Reason.buildBody(astra, 'off'), {});
  assert.ok(Reason.normalize(astra, 'off').note.indexOf('400') !== -1);
  assert.deepEqual(cap({ model: 'gpt-6.1-sol' }).levels, ['low', 'medium', 'high', 'xhigh', 'max']);

  // o 系：low/medium/high 三档，不可关闭
  const o3 = cap({ model: 'o3' });
  assert.deepEqual(o3.levels, ['low', 'medium', 'high']);
  assert.deepEqual(Reason.buildBody(o3, 'max'), { reasoning_effort: 'high' });
  assert.deepEqual(Reason.buildBody(o3, 'off'), {});
});

test('Claude: 支持的型号显示 effort 档位，Fable/Mythos 入列，Haiku 走 thinking 开关', function () {
  const opus = cap({ baseUrl: 'https://proxy.example.com/v1', model: 'claude-opus-4-7' });
  assert.deepEqual(opus.levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(Reason.buildBody(opus, 'xhigh'), { reasoning_effort: 'xhigh' });

  const sonnet = cap({ model: 'claude-sonnet-4-6' });
  assert.deepEqual(sonnet.levels, ['low', 'medium', 'high', 'max']);
  // 无 xhigh 档的型号归一到 max 并说明
  assert.deepEqual(Reason.buildBody(sonnet, 'xhigh'), { reasoning_effort: 'max' });

  // 新型号家族：Fable 5.x / Mythos 5.x 有 xhigh，Mythos Preview 到 max 止
  assert.deepEqual(cap({ model: 'claude-fable-5-1' }).levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(cap({ model: 'claude-mythos-5-1' }).levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(cap({ model: 'claude-mythos-preview' }).levels, ['low', 'medium', 'high', 'max']);
  assert.deepEqual(cap({ model: 'claude-opus-5-5' }).levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(cap({ model: 'claude-sonnet-5-5' }).levels, ['low', 'medium', 'high', 'xhigh', 'max']);

  // Haiku 4.5 官方不支持 effort：思考走 thinking 开关（协议层默认预算 4096）
  const haiku = cap({ model: 'claude-haiku-4-5' });
  assert.deepEqual(haiku.levels, ['off', 'high']);
  assert.deepEqual(Reason.buildBody(haiku, 'high'), { thinking: { type: 'enabled' } });
  assert.deepEqual(Reason.buildBody(haiku, 'off'), { thinking: { type: 'disabled' } });
  assert.ok(Reason.normalize(haiku, 'max').note.indexOf('不支持 effort') !== -1);

  // 未识别旧型号仍只显示默认
  assert.deepEqual(Reason.options(cap({ model: 'claude-3-5-sonnet' })).map((o) => o.value), ['']);
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
  const mimo = Reason.options(cap({ model: 'mimo-v2.6-pro' }));
  assert.deepEqual(mimo.map((o) => o.value), ['', 'off', 'high']);
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
