'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamAccumulator, validateBaseUrl, chatUrl, createAgentNet } = require('../electron/agent-net.js');

test('stream accumulator merges content deltas and tool call fragments, ignores junk lines, and surfaces upstream errors', function () {
  {
    const acc = createStreamAccumulator();
    const all = [];
    const lines = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{"content":"，文献"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search_openalex","arguments":"{\\"qu"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ery\\":\\"电池\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":31,"completion_tokens":7}}',
      'data: [DONE]'
    ];
    lines.forEach(function (line) { all.push.apply(all, acc.pushLine(line)); });
    assert.ok(all.some(function (e) { return e.type === 'delta' && e.text === '你好'; }));
    assert.ok(all.some(function (e) { return e.type === 'tool_call' && e.name === 'search_openalex'; }));
    const msg = acc.message();
    assert.equal(msg.content, '你好，文献');
    assert.equal(msg.tool_calls.length, 1);
    assert.equal(msg.tool_calls[0].function.name, 'search_openalex');
    assert.equal(msg.tool_calls[0].function.arguments, '{"query":"电池"}');
    assert.equal(acc.getUsage().prompt_tokens, 31);
    assert.equal(acc.getFinishReason(), 'tool_calls');
  }
  {
    const acc = createStreamAccumulator();
    assert.deepEqual(acc.pushLine(''), []);
    assert.deepEqual(acc.pushLine(': keep-alive'), []);
    assert.deepEqual(acc.pushLine('data: not-json'), []);
    assert.throws(function () {
      acc.pushLine('data: {"error":{"message":"invalid api key"}}');
    }, /invalid api key/);
  }
});

test('validateBaseUrl enforces https except localhost; chatUrl appends path unless already complete', function () {
  {
    assert.equal(validateBaseUrl('https://api.deepseek.com/'), 'https://api.deepseek.com');
    assert.equal(validateBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
    assert.equal(validateBaseUrl('http://127.0.0.1:8000'), 'http://127.0.0.1:8000');
    assert.throws(function () { validateBaseUrl('http://evil.example.com'); }, /https/);
    assert.throws(function () { validateBaseUrl('ftp://x'); }, /无效/);
    assert.throws(function () { validateBaseUrl(''); }, /未配置/);
  }
  {
    assert.equal(chatUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
    assert.equal(chatUrl('https://x/v1/'), 'https://x/v1/chat/completions');
    assert.equal(chatUrl('https://x/v1/chat/completions'), 'https://x/v1/chat/completions');
  }
});

/* 用假 fetch 走一遍 chatStream：SSE 解析 + 停止 + 未配置报错 */
function sseResponse(lines) {
  const encoder = new TextEncoder();
  const body = lines.join('\n') + '\n';
  return {
    ok: true,
    status: 200,
    text: async function () { return body; },
    body: {
      getReader: function () {
        let done = false;
        return {
          read: async function () {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: encoder.encode(body) };
          }
        };
      }
    }
  };
}

test('chatStream parses SSE end to end and emits done; HTTP error surfaces without retry; unconfigured agent rejects', async function () {
  {
    const events = [];
    const net = createAgentNet({
      fetch: async function () {
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"答"}}]}',
          'data: {"choices":[{"delta":{"content":"案"}}]}',
          'data: [DONE]'
        ]);
      },
      getConfig: async function () {
        return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' };
      },
      notify: function (_channel, payload) { events.push(payload); }
    });
    const result = await net.chatStream({
      sessionId: 's1',
      body: { messages: [{ role: 'user', content: '问' }], stream: true }
    });
    assert.equal(result.message.content, '答案');
    assert.ok(events.some(function (e) { return e.type === 'delta'; }));
    assert.ok(events.some(function (e) { return e.type === 'done' && e.sessionId === 's1'; }));
  }
  {
    let calls = 0;
    const net = createAgentNet({
      fetch: async function () { calls++; return { ok: false, status: 401, text: async function () { return '{"error":"bad key"}'; } }; },
      getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
      notify: function () {}
    });
    await assert.rejects(function () {
      return net.chatStream({ sessionId: 's1', body: { messages: [{ role: 'user', content: 'x' }] } });
    }, /HTTP 401/);
    assert.equal(calls, 1);
  }
  {
    const net = createAgentNet({
      fetch: async function () { throw new Error('should not be called'); },
      getConfig: async function () { return {}; },
      notify: function () {}
    });
    await assert.rejects(function () {
      return net.chatStream({ sessionId: 's1', body: { messages: [{ role: 'user', content: 'x' }] } });
    }, /未配置/);
  }
});

test('A02: reasoning deltas are captured, emitted and attached to the message', async function () {
  const events = [];
  const net = createAgentNet({
    fetch: async function () {
      return sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"思考A"}}]}',
        'data: {"choices":[{"delta":{"reasoning_content":"思考B"}}]}',
        'data: {"choices":[{"delta":{"content":"答案"}}]}',
        'data: [DONE]'
      ]);
    },
    getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
    notify: function (_c, payload) { events.push(payload); }
  });
  const result = await net.chatStream({ sessionId: 's', body: { messages: [{ role: 'user', content: 'q' }] } });
  assert.equal(result.message.reasoning_content, '思考A思考B');
  assert.equal(result.message.content, '答案');
  assert.ok(events.some(function (e) { return e.type === 'reasoning_delta' && e.text === '思考A'; }));
});

test('A05: EOF without [DONE] returns partial with truncation notice; finish_reason=length reported as truncated; final line without trailing newline still processed', async function () {
  {
    const events = [];
    const net = createAgentNet({
      fetch: async function () {
        return sseResponse(['data: {"choices":[{"delta":{"content":"partial answer"}}]}']);
      },
      getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
      notify: function (_c, payload) { events.push(payload); }
    });
    const result = await net.chatStream({ sessionId: 's', body: { messages: [{ role: 'user', content: 'q' }] } });
    assert.equal(result.partial, true);
    assert.equal(result.message.content, 'partial answer'); // 已见内容不丢
    assert.ok(/中断/.test(result.errorText));
    assert.ok(events.some(function (e) { return e.type === 'stream_incomplete'; }));
  }
  {
    const net = createAgentNet({
      fetch: async function () {
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"cut"},"finish_reason":"length"}]}',
          'data: [DONE]'
        ]);
      },
      getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
      notify: function () {}
    });
    const result = await net.chatStream({ sessionId: 's', body: { messages: [{ role: 'user', content: 'q' }] } });
    assert.equal(result.partial, true);
    assert.ok(/长度上限/.test(result.errorText));
  }
  {
    // 无结尾换行的响应体：最后一行 data: [DONE] 不带 \n
    const encoder = new TextEncoder();
    const raw = 'data: {"choices":[{"delta":{"content":"hi"}}]}\ndata: [DONE]';
    const rawBody = { ok: true, status: 200, text: async function () { return raw; }, body: { getReader: function () {
      let done = false;
      return { read: async function () {
        if (done) return { done: true, value: undefined };
        done = true;
        return { done: false, value: encoder.encode(raw) };
      } };
    } } };
    const net = createAgentNet({
      fetch: async function () { return rawBody; },
      getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
      notify: function () {}
    });
    const result = await net.chatStream({ sessionId: 's', body: { messages: [{ role: 'user', content: 'q' }] } });
    assert.equal(result.message.content, 'hi');
    assert.equal(result.partial, undefined);
  }
});

test('A14: estimated usage scales with real input size, counts tools schema', async function () {
  const net = createAgentNet({
    fetch: async function () {
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']);
    },
    getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
    notify: function () {}
  });
  const bigText = 'a'.repeat(10000);
  const result = await net.chatStream({
    sessionId: 's',
    body: { messages: [{ role: 'user', content: bigText }], tools: [{ type: 'function', function: { name: 't', description: 'd'.repeat(500) } }] }
  });
  assert.ok(result.usage.estimated === true);
  assert.ok(result.usage.prompt_tokens > 2000, '10000 ASCII chars + tools schema should estimate >2000 tokens, got ' + result.usage.prompt_tokens);
});

const { modelsUrl, extractModelIds } = require('../electron/agent-net.js');

test('modelsUrl derives /models from various base forms; extractModelIds handles OpenAI, bare array and {models} shapes; dedupes and sorts', function () {
  {
    assert.equal(modelsUrl('https://api.moonshot.cn/v1'), 'https://api.moonshot.cn/v1/models');
    assert.equal(modelsUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/models');
    assert.equal(modelsUrl('https://x/v1/chat/completions'), 'https://x/v1/models');
  }
  {
    assert.deepEqual(extractModelIds({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }), ['a', 'b']);
    assert.deepEqual(extractModelIds(['z', 'y']), ['y', 'z']);
    assert.deepEqual(extractModelIds({ models: [{ name: 'kimi-k2.7-code' }] }), ['kimi-k2.7-code']);
    assert.deepEqual(extractModelIds(null), []);
  }
});

test('listModels fetches with auth and maps ids; reports 404 as "no /models endpoint" and empty lists clearly', async function () {
  {
    let seenUrl = '';
    let seenAuth = '';
    const net = createAgentNet({
      fetch: async function (url, init) {
        seenUrl = url;
        seenAuth = init.headers.Authorization;
        return { ok: true, status: 200, json: async function () { return { data: [{ id: 'kimi-k2.6' }, { id: 'kimi-k2.7-code' }] }; } };
      },
      getConfig: async function () { return { agentBaseUrl: 'https://api.moonshot.cn/v1', agentApiKey: 'K' }; },
      notify: function () {}
    });
    const result = await net.listModels({});
    assert.deepEqual(result.models, ['kimi-k2.6', 'kimi-k2.7-code']);
    assert.equal(seenUrl, 'https://api.moonshot.cn/v1/models');
    assert.equal(seenAuth, 'Bearer K');
  }
  {
    const net404 = createAgentNet({
      fetch: async function () { return { ok: false, status: 404, text: async function () { return 'not found'; } }; },
      getConfig: async function () { return { agentBaseUrl: 'https://x/v1', agentApiKey: 'K' }; },
      notify: function () {}
    });
    await assert.rejects(function () { return net404.listModels({}); }, /未提供 \/models 接口/);

    const netEmpty = createAgentNet({
      fetch: async function () { return { ok: true, status: 200, json: async function () { return { data: [] }; } }; },
      getConfig: async function () { return { agentBaseUrl: 'https://x/v1', agentApiKey: 'K' }; },
      notify: function () {}
    });
    await assert.rejects(function () { return netEmpty.listModels({}); }, /未返回任何模型/);
  }
});

test('R03: 同一 turn 的续请求固定轮开始时的 Base URL + Key；新轮读新配置', async function () {
  const seen = [];
  let cfgState = { agentBaseUrl: 'https://a.example/v1', agentApiKey: 'KA', agentModel: 'ma' };
  const net = createAgentNet({
    fetch: async function (url, init) {
      seen.push({ url: url, auth: init.headers.Authorization, model: JSON.parse(init.body).model });
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']);
    },
    getConfig: async function () { return cfgState; },
    notify: function () {}
  });
  // 轮 T1 的第一次请求（固定 A 端点）
  await net.chatStream({ sessionId: 's1', turnId: 'T1', body: { messages: [{ role: 'user', content: 'q' }] } });
  // 配置中途被改成 B（模型/端点/Key 全换）
  cfgState = { agentBaseUrl: 'https://b.example/v1', agentApiKey: 'KB', agentModel: 'mb' };
  // 同轮续请求：仍用 A 端点 + A Key；模型以 body.model（冻结值）优先
  await net.chatStream({ sessionId: 's1', turnId: 'T1', body: { messages: [{ role: 'user', content: 'q' }], model: 'ma' } });
  assert.equal(seen[1].url, 'https://a.example/v1/chat/completions');
  assert.equal(seen[1].auth, 'Bearer KA');
  assert.equal(seen[1].model, 'ma');
  // 新轮 T2：读新配置
  await net.chatStream({ sessionId: 's1', turnId: 'T2', body: { messages: [{ role: 'user', content: 'q2' }] } });
  assert.equal(seen[2].url, 'https://b.example/v1/chat/completions');
  assert.equal(seen[2].auth, 'Bearer KB');
  assert.equal(seen[2].model, 'mb');
  // 无 turnId（旧调用方）：行为同前，不做固定
  await net.chatStream({ sessionId: 's1', body: { messages: [{ role: 'user', content: 'q3' }] } });
  assert.equal(seen[3].url, 'https://b.example/v1/chat/completions');
});

/* ---- 端点协议适配（chat / responses / messages）与 OpenCode 会话头 ---- */

function messagesSse(lines) {
  const encoder = new TextEncoder();
  const body = lines.join('\n') + '\n';
  return {
    ok: true,
    status: 200,
    text: async function () { return body; },
    body: { getReader: function () {
      let done = false;
      return { read: async function () {
        if (done) return { done: true, value: undefined };
        done = true;
        return { done: false, value: encoder.encode(body) };
      } };
    } }
  };
}

test('OpenCode 端点必须带 x-opencode-session（真机 400 MissingSessionID 的回归防线）；Qwen 系模型自动改走 Anthropic Messages（/v1/messages）', async function () {
  {
    let seen = null;
    const net = createAgentNet({
      fetch: async function (url, init) {
        seen = { url: url, headers: init.headers, body: JSON.parse(init.body) };
        return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}', 'data: [DONE]']);
      },
      getConfig: async function () {
        return { agentBaseUrl: 'https://opencode.ai/zen/go/v1', agentApiKey: 'K', agentModel: 'deepseek-flash' };
      },
      notify: function () {},
      userAgent: 'LitBoard/9.9'
    });
    const result = await net.chatStream({ sessionId: 'sess-42', body: { messages: [{ role: 'user', content: 'q' }] } });
    assert.equal(seen.url, 'https://opencode.ai/zen/go/v1/chat/completions');
    assert.equal(seen.headers['x-opencode-session'], 'litboard-sess-42');
    assert.equal(seen.headers['User-Agent'], 'LitBoard/9.9');
    assert.equal(seen.headers.Authorization, 'Bearer K');
    assert.equal(seen.body.model, 'deepseek-flash');
    assert.equal(result.message.content, 'ok');
  }
  {
    let seen = null;
    const net = createAgentNet({
      fetch: async function (url, init) {
        seen = { url: url, headers: init.headers, body: JSON.parse(init.body) };
        return messagesSse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答"}}',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
          'data: {"type":"message_stop"}'
        ]);
      },
      getConfig: async function () {
        return { agentBaseUrl: 'https://opencode.ai/zen/go/v1', agentApiKey: 'K', agentModel: 'qwen3-max' };
      },
      notify: function () {}
    });
    const result = await net.chatStream({
      sessionId: 's1',
      body: {
        messages: [
          { role: 'system', content: '你是助手' },
          { role: 'user', content: '问' }
        ],
        tools: [{ type: 'function', function: { name: 't', parameters: { type: 'object' } } }]
      }
    });
    assert.equal(seen.url, 'https://opencode.ai/zen/go/v1/messages');
    assert.equal(seen.headers['x-api-key'], 'K');
    assert.equal(seen.headers.Authorization, undefined);
    assert.equal(seen.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen.headers['x-opencode-session'], 'litboard-s1');
    // Anthropic 形态请求体：system 提顶层、max_tokens 必填、工具用 input_schema
    assert.equal(seen.body.system, '你是助手');
    assert.equal(typeof seen.body.max_tokens, 'number');
    assert.equal(seen.body.messages[0].role, 'user');
    assert.equal(seen.body.tools[0].input_schema.type, 'object');
    assert.equal(result.message.content, '答');
    assert.equal(result.partial, undefined);
  }
});

test('协议判定：设置里显式指定的接口格式优先于 URL 判定（responses 协议端到端）；testConnection 与列表端点同样跟随协议判定（Anthropic 兼容 base 用 x-api-key）', async function () {
  {
    let seen = null;
    const net = createAgentNet({
      fetch: async function (url, init) {
        seen = { url: url, body: JSON.parse(init.body) };
        return sseResponse([
          'data: {"type":"response.output_text.delta","delta":"好"}',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":1}}}'
        ]);
      },
      getConfig: async function () {
        return { agentBaseUrl: 'https://api.test/v1', agentApiKey: 'K', agentModel: 'm', agentApiDialect: 'responses' };
      },
      notify: function () {}
    });
    const result = await net.chatStream({ sessionId: 's1', body: { messages: [{ role: 'user', content: 'q' }] } });
    assert.equal(seen.url, 'https://api.test/v1/responses');
    assert.equal(seen.body.store, false);
    assert.deepEqual(seen.body.input, [{ role: 'user', content: 'q' }]);
    assert.equal(result.message.content, '好');
    assert.equal(result.usage.prompt_tokens, 5);
  }
  {
    const seen = [];
    const net = createAgentNet({
      fetch: async function (url, init) {
        seen.push({ url: url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
        return { ok: true, status: 200, json: async function () { return { data: [{ id: 'x' }] }; } };
      },
      getConfig: async function () {
        return { agentBaseUrl: 'https://api.deepseek.com/anthropic', agentApiKey: 'K', agentModel: 'deepseek-chat' };
      },
      notify: function () {}
    });
    const test_ = await net.testConnection({});
    assert.equal(test_.dialect, 'messages');
    assert.equal(seen[0].url, 'https://api.deepseek.com/anthropic/v1/messages');
    assert.equal(seen[0].headers['x-api-key'], 'K');
    assert.equal(seen[0].body.stream, false);
    const models = await net.listModels({});
    assert.equal(seen[1].url, 'https://api.deepseek.com/anthropic/v1/models');
    assert.deepEqual(models.models, ['x']);
  }
});

test('连接测试可用设置里未保存的 Base URL + 协议（表单实时覆盖）；OpenCode 模型清单固定走 Bearer（不随对话协议形态切到 x-api-key）', async function () {
  {
    let seen = null;
    const net = createAgentNet({
      fetch: async function (url, init) { seen = { url: url, headers: init.headers }; return { ok: true, status: 200 }; },
      getConfig: async function () { return {}; },
      notify: function () {}
    });
    const result = await net.testConnection({
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'K2',
      model: 'qwen3-max',
      dialect: 'messages'
    });
    assert.equal(result.dialect, 'messages');
    assert.equal(seen.url, 'https://opencode.ai/zen/go/v1/messages');
    assert.equal(seen.headers['x-opencode-session'], 'litboard-connection-test');
    assert.equal(seen.headers['x-api-key'], 'K2');
  }
  {
    let seen = null;
    const net = createAgentNet({
      fetch: async function (url, init) {
        seen = { url: url, headers: init.headers };
        return { ok: true, status: 200, json: async function () { return { data: [{ id: 'qwen3-max' }] }; } };
      },
      getConfig: async function () {
        return { agentBaseUrl: 'https://opencode.ai/zen/go/v1', agentApiKey: 'K', agentModel: 'qwen3-max' };
      },
      notify: function () {}
    });
    const result = await net.listModels({});
    assert.equal(seen.url, 'https://opencode.ai/zen/go/v1/models');
    assert.equal(seen.headers.Authorization, 'Bearer K');
    assert.equal(seen.headers['x-api-key'], undefined);
    assert.equal(seen.headers['x-opencode-session'], 'litboard-models');
    assert.deepEqual(result.models, ['qwen3-max']);
  }
});

/* 服务商清单（设置页按 providerId 测试连接 / 拉取模型）：用户没重填 Key 时，
 * 主进程按 id 取自己存的那把；表单里刚敲的值仍然优先。 */
test('providerId：测试连接与拉取模型按 id 取该服务商的端点、协议与 Key', async function () {
  const seen = [];
  const net = createAgentNet({
    fetch: async function (url, init) {
      seen.push({ url: url, headers: init.headers });
      return { ok: true, status: 200, json: async function () { return { data: [{ id: 'deepseek-v4-pro' }] }; } };
    },
    // 当前生效的是另一个服务商（内置）：providerId 必须胜过它，否则「测的是别人」
    getConfig: async function () {
      return { agentBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', agentApiKey: 'K-default', agentModel: 'qwen-plus' };
    },
    getProvider: async function (id) {
      if (id !== 'p1') return null;
      return {
        id: 'p1', name: 'DS', baseUrl: 'https://api.deepseek.com/anthropic', dialect: 'messages',
        model: 'deepseek-v4-pro', models: ['deepseek-v4-pro'], apiKey: 'K-provider'
      };
    },
    notify: function () {}
  });
  const test_ = await net.testConnection({ providerId: 'p1' });
  assert.equal(test_.dialect, 'messages');
  assert.equal(seen[0].url, 'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(seen[0].headers['x-api-key'], 'K-provider');
  const models = await net.listModels({ providerId: 'p1' });
  assert.deepEqual(models.models, ['deepseek-v4-pro']);
  assert.equal(seen[1].url, 'https://api.deepseek.com/anthropic/v1/models');
  // 表单里刚敲的 Base URL 优先于已存值（还没保存就能测）
  const draft = await net.testConnection({ providerId: 'p1', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'qwen3-max' });
  assert.equal(draft.dialect, 'messages'); // 已存协议仍然生效（表单没改协议）
  assert.equal(seen[2].url, 'https://opencode.ai/zen/go/v1/messages');
  // id 不存在 → 明确报错，而不是悄悄去测当前生效的另一个服务商
  await assert.rejects(function () { return net.testConnection({ providerId: 'gone' }); }, /服务商不存在/);
  // 没配 Key 的服务商：报「Key 未配置」，不是拿别的服务商的 Key 顶上
  const noKey = createAgentNet({
    fetch: async function () { throw new Error('不该出网'); },
    getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
    getProvider: async function () { return { id: 'p2', baseUrl: 'https://api.moonshot.cn/v1', dialect: '', model: 'kimi-k2.7-code', apiKey: '' }; },
    notify: function () {}
  });
  await assert.rejects(function () { return noKey.testConnection({ providerId: 'p2' }); }, /API Key 未配置/);
});

/* ---------------- H3：同会话并发请求的停止控制（审计复现场景） ---------------- */
test('H3: 同会话两个并发请求，先结束者不得删掉后者的控制器（cancel 仍有效）', async function () {
  let seq = 0;
  const gates = [];
  const net = createAgentNet({
    // 第一个请求立即完成；第二个请求挂住直到我们放行
    fetch: async function () {
      const n = ++seq;
      if (n === 1) return sseResponse(['data: {"choices":[{"delta":{"content":"一"}}]}', 'data: [DONE]']);
      await new Promise(function (resolve) { gates.push(resolve); });
      return sseResponse(['data: {"choices":[{"delta":{"content":"二"}}]}', 'data: [DONE]']);
    },
    getConfig: async function () { return { agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }; },
    notify: function () {}
  });
  const body = { messages: [{ role: 'user', content: 'q' }], stream: true };
  const first = net.chatStream({ sessionId: 's', turnId: 't1', body: body });
  const second = net.chatStream({ sessionId: 's', turnId: 't2', body: body });
  await first;                                   // 第一个结束：旧实现无条件删控制器
  const cancelResult = net.cancel('s');          // 第二个仍在途——必须还能停
  assert.equal(cancelResult, true, '第二个在途请求的停止入口还在');
  gates.forEach(function (resolve) { resolve(null); });
  const r2 = await second;
  assert.equal(r2.aborted, true, '第二个请求被取消（而非正常完成）');
});


test('transient HTTP rejection honors Retry-After with bounded retries and no tool replay; ambiguous failures and reasoning-only partial streams never auto retry', async () => {
  {
    let calls = 0; const waits = [];
    const net = createAgentNet({ getConfig: async () => ({ agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }), sleep: async ms => waits.push(ms),
      fetch: async () => { calls++; return { ok: false, status: 429, headers: { get: () => '2' }, text: async () => 'rate limited' }; } });
    await assert.rejects(net.chatStream({ sessionId: 'retry-s', turnId: 't', body: { messages: [{ role: 'user', content: 'go' }] } }), /HTTP 429/);
    assert.equal(calls, 3); assert.deepEqual(waits, [2000, 2000]);
  }
  {
    let calls = 0;
    const net = createAgentNet({ getConfig: async () => ({ agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }), fetch: async () => { calls++; throw new Error('socket reset after request'); } });
    await assert.rejects(net.chatStream({ sessionId: 'no-blind-retry', body: { messages: [] } }), /socket reset/); assert.equal(calls, 1);
    const streamNet = createAgentNet({ getConfig: async () => ({ agentBaseUrl: 'https://api.test', agentApiKey: 'K', agentModel: 'm' }), fetch: async () => ({ ok: true, body: { getReader: () => ({ read: async () => { if (calls++ === 1) return { value: new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n') }; throw new Error('lost'); } }) } }) });
    const result = await streamNet.chatStream({ sessionId: 'reasoning-partial', body: { messages: [] } });
    assert.equal(result.partial, true); assert.equal(result.message.reasoning_content, 'thinking');
  }
});
