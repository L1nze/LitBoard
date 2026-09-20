'use strict';

/* 端点协议适配层测试：三种协议形态的 URL / 请求头 / 请求体 / SSE 解析。
 * 其中 opencode 的 x-opencode-session 是真机 400（MissingSessionID）的回归防线。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/agentproto.js');

test('detectDialect: URL 尾段、域名与 opencode 模型系列分流', function () {
  // URL 尾段优先
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1'), 'chat');
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1/messages'), 'messages');
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1/responses'), 'responses');
  assert.equal(P.detectDialect('https://api.deepseek.com/anthropic'), 'messages');
  assert.equal(P.detectDialect('https://api.deepseek.com/'), 'chat');
  // Anthropic 官方域名
  assert.equal(P.detectDialect('https://api.anthropic.com'), 'messages');
  assert.equal(P.detectDialect('https://api.anthropic.com/v1'), 'messages');
  // opencode 按模型系列：Grok/GPT 系走 responses，MiniMax/Qwen 系走 messages
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1', { model: 'qwen3-max' }), 'messages');
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1', { model: 'minimax-m2' }), 'messages');
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1', { model: 'grok-4.6' }), 'responses');
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1', { model: 'gpt-5.6-luna' }), 'responses');
  // 网关惯用的 vendor/model 前缀按尾段判
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1', { model: 'alibaba/qwen3-max' }), 'messages');
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1', { model: 'deepseek-flash' }), 'chat');
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1', { model: 'kimi-k3' }), 'chat');
  // 非 opencode 主机不做模型分流（别的网关照旧走 chat）
  assert.equal(P.detectDialect('https://api.test/v1', { model: 'qwen3-max' }), 'chat');
  // 显式指定永远优先
  assert.equal(P.detectDialect('https://opencode.ai/zen/go/v1/messages', { dialect: 'chat' }), 'chat');
  assert.equal(P.detectDialect('https://api.deepseek.com', { dialect: 'responses', model: 'x' }), 'responses');
  assert.equal(P.detectDialect('https://api.deepseek.com', { dialect: 'auto' }), 'chat');
});

test('endpointFor: 三种协议补全路径，已含尾段时原样保留', function () {
  assert.equal(P.endpointFor('https://api.deepseek.com/', 'chat'), 'https://api.deepseek.com/chat/completions');
  assert.equal(P.endpointFor('https://x/v1/chat/completions', 'chat'), 'https://x/v1/chat/completions');
  // messages：base 自带 /v1 时只接 /messages（opencode / anthropic 系惯例）
  assert.equal(P.endpointFor('https://opencode.ai/zen/go/v1', 'messages'), 'https://opencode.ai/zen/go/v1/messages');
  assert.equal(P.endpointFor('https://api.anthropic.com', 'messages'), 'https://api.anthropic.com/v1/messages');
  assert.equal(P.endpointFor('https://open.bigmodel.cn/api/anthropic', 'messages'), 'https://open.bigmodel.cn/api/anthropic/v1/messages');
  assert.equal(P.endpointFor('https://opencode.ai/zen/go/v1/messages', 'messages'), 'https://opencode.ai/zen/go/v1/messages');
  // responses
  assert.equal(P.endpointFor('https://opencode.ai/zen/go/v1', 'responses'), 'https://opencode.ai/zen/go/v1/responses');
  assert.equal(P.endpointFor('https://api.openai.com/v1', 'responses'), 'https://api.openai.com/v1/responses');
  assert.equal(P.endpointFor('https://x/v1/responses', 'responses'), 'https://x/v1/responses');
});

test('modelsEndpointFor: 三种协议都收敛到 {prefix}/models', function () {
  assert.equal(P.modelsEndpointFor('https://api.moonshot.cn/v1', 'chat'), 'https://api.moonshot.cn/v1/models');
  assert.equal(P.modelsEndpointFor('https://x/v1/chat/completions', 'chat'), 'https://x/v1/models');
  assert.equal(P.modelsEndpointFor('https://opencode.ai/zen/go/v1', 'chat'), 'https://opencode.ai/zen/go/v1/models');
  assert.equal(P.modelsEndpointFor('https://opencode.ai/zen/go/v1/messages', 'messages'), 'https://opencode.ai/zen/go/v1/models');
  assert.equal(P.modelsEndpointFor('https://opencode.ai/zen/go/v1/responses', 'responses'), 'https://opencode.ai/zen/go/v1/models');
  assert.equal(P.modelsEndpointFor('https://api.anthropic.com', 'messages'), 'https://api.anthropic.com/v1/models');
});

test('buildHeaders: 鉴权形态随协议切换，opencode 端点附会话头', function () {
  const chat = P.buildHeaders({ dialect: 'chat', apiKey: 'K', baseUrl: 'https://api.test/v1', userAgent: 'LitBoard/1.0' });
  assert.equal(chat.Authorization, 'Bearer K');
  assert.equal(chat['x-api-key'], undefined);
  assert.equal(chat['User-Agent'], 'LitBoard/1.0');
  assert.equal(chat['x-opencode-session'], undefined);

  const messages = P.buildHeaders({ dialect: 'messages', apiKey: 'K', baseUrl: 'https://api.anthropic.com' });
  assert.equal(messages['x-api-key'], 'K');
  assert.equal(messages.Authorization, undefined);
  assert.equal(messages['anthropic-version'], P.ANTHROPIC_VERSION);

  const opencode = P.buildHeaders({
    dialect: 'chat', apiKey: 'K', baseUrl: 'https://opencode.ai/zen/go/v1', sessionId: 'litboard-s1'
  });
  assert.equal(opencode['x-opencode-session'], 'litboard-s1');
  assert.equal(opencode.Authorization, 'Bearer K');
});

test('toResponsesBody: system→instructions、工具扁平化、图像转 input_image', function () {
  const body = P.toResponsesBody({
    model: 'm',
    max_tokens: 256,
    reasoning_effort: 'high',
    messages: [
      { role: 'system', content: '你是一个助手' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
        ]
      },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '结果' }
    ],
    tools: [{ type: 'function', function: { name: 'search', description: 'd', parameters: { type: 'object' } } }]
  });
  assert.equal(body.instructions, '你是一个助手');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.max_output_tokens, 256);
  assert.deepEqual(body.reasoning, { effort: 'high' });
  assert.deepEqual(body.input[0], {
    role: 'user',
    content: [
      { type: 'input_text', text: '看这张图' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAA' }
    ]
  });
  assert.deepEqual(body.input[1], { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{"q":"x"}' });
  assert.deepEqual(body.input[2], { type: 'function_call_output', call_id: 'c1', output: '结果' });
  // 工具 schema 扁平化（Responses 不再有 function 嵌套层）
  assert.deepEqual(body.tools, [{ type: 'function', name: 'search', description: 'd', parameters: { type: 'object' } }]);
  assert.equal(body.messages, undefined);
});

test('toMessagesBody: system 提顶层、max_tokens 必填、工具结果并进 user、相邻同角色合并', function () {
  const body = P.toMessagesBody({
    model: 'claude',
    messages: [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '', tool_calls: [
        { id: 't1', type: 'function', function: { name: 'a', arguments: '{"x":1}' } },
        { id: 't2', type: 'function', function: { name: 'b', arguments: '{bad json' } }
      ] },
      { role: 'tool', tool_call_id: 't1', content: '结果A' },
      { role: 'tool', tool_call_id: 't2', content: '结果B' },
      { role: 'user', content: '追问' }
    ],
    tools: [{ type: 'function', function: { name: 'a', description: 'da', parameters: { type: 'object', properties: {} } } }]
  });
  assert.equal(body.system, '系统提示');
  assert.equal(body.max_tokens, P.DEFAULT_MAX_TOKENS);
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].role, 'user');
  assert.deepEqual(body.messages[0].content, [{ type: 'text', text: '第一问' }]);
  assert.equal(body.messages[1].role, 'assistant');
  assert.deepEqual(body.messages[1].content[0], { type: 'tool_use', id: 't1', name: 'a', input: { x: 1 } });
  // 坏 JSON 退化为空对象，不抛异常（否则整轮对话中断）
  assert.deepEqual(body.messages[1].content[1], { type: 'tool_use', id: 't2', name: 'b', input: {} });
  // 两条工具结果 + 后续 user 追问合并成一条 user 消息（Anthropic 要求角色交替）
  assert.equal(body.messages.length, 3);
  assert.equal(body.messages[2].role, 'user');
  assert.deepEqual(body.messages[2].content[0], { type: 'tool_result', tool_use_id: 't1', content: '结果A' });
  assert.deepEqual(body.messages[2].content[1], { type: 'tool_result', tool_use_id: 't2', content: '结果B' });
  assert.deepEqual(body.messages[2].content[2], { type: 'text', text: '追问' });
  assert.deepEqual(body.tools, [{ name: 'a', input_schema: { type: 'object', properties: {} }, description: 'da' }]);
});

test('toMessagesBody: 图像走 base64/url source，不支持的媒体类型丢弃；OpenAI 侧推理参数不透传', function () {
  const body = P.toMessagesBody({
    model: 'm',
    max_tokens: 100,
    reasoning_effort: 'high',
    thinking: { type: 'disabled' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
        { type: 'image_url', image_url: { url: 'data:image/bmp;base64,QQ==' } },
        { type: 'image_url', image_url: { url: 'https://x.test/a.png' } }
      ]
    }]
  });
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.thinking, undefined); // {type:'disabled'} 是 OpenAI 侧形态，发过去只会 400
  assert.equal(body.max_tokens, 100);
  assert.deepEqual(body.messages[0].content, [
    { type: 'text', text: '看图' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
    { type: 'image', source: { type: 'url', url: 'https://x.test/a.png' } }
  ]);
  // Anthropic 原生 thinking 形态原样透传
  const thinking = P.toMessagesBody({ model: 'm', thinking: { type: 'enabled', budget_tokens: 2048 }, messages: [{ role: 'user', content: 'q' }] });
  assert.deepEqual(thinking.thinking, { type: 'enabled', budget_tokens: 2048 });
});

test('convertBody: chat 原样返回', function () {
  const src = { model: 'm', messages: [{ role: 'user', content: 'q' }], tools: [{ type: 'function', function: { name: 't' } }] };
  assert.deepEqual(P.convertBody(src, 'chat'), src);
});

test('responses 累积器：文本 / 推理 / 函数调用分片 / completed 收尾与用量', function () {
  const acc = P.createResponsesAccumulator();
  const events = [];
  [
    'data: {"type":"response.output_text.delta","delta":"你"}',
    'data: {"type":"response.reasoning_summary_text.delta","delta":"想一下"}',
    'data: {"type":"response.output_text.delta","delta":"好"}',
    'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc1","call_id":"c1","name":"search_openalex","arguments":""}}',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc1","delta":"{\\"qu"}',
    'data: {"type":"response.function_call_arguments.done","item_id":"fc1","arguments":"{\\"query\\":\\"电池\\"}"}',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":31,"output_tokens":7}}}'
  ].forEach(function (line) { events.push.apply(events, acc.pushLine(line)); });
  assert.ok(events.some(function (e) { return e.type === 'delta' && e.text === '你'; }));
  assert.ok(events.some(function (e) { return e.type === 'reasoning_delta' && e.text === '想一下'; }));
  assert.ok(events.some(function (e) { return e.type === 'tool_call' && e.name === 'search_openalex'; }));
  assert.ok(events.some(function (e) { return e.type === '_closed'; }));
  const msg = acc.message();
  assert.equal(msg.content, '你好');
  assert.equal(msg.reasoning_content, '想一下');
  assert.equal(msg.tool_calls[0].id, 'c1');
  assert.equal(msg.tool_calls[0].function.arguments, '{"query":"电池"}');
  assert.equal(acc.getFinishReason(), 'tool_calls');
  assert.equal(acc.sawDone(), true);
  assert.deepEqual(acc.getUsage(), { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 });
});

test('responses 累积器：incomplete 归一为截断，failed 抛出上游错误', function () {
  const acc = P.createResponsesAccumulator();
  const events = acc.pushLine('data: {"type":"response.incomplete","response":{"usage":{"input_tokens":1,"output_tokens":2}}}');
  assert.equal(acc.getFinishReason(), 'length');
  assert.ok(events.some(function (e) { return e.type === '_closed'; }));

  const bad = P.createResponsesAccumulator();
  assert.throws(function () {
    bad.pushLine('data: {"type":"response.failed","response":{"error":{"message":"boom"}}}');
  }, /boom/);
  const err = P.createResponsesAccumulator();
  assert.throws(function () {
    err.pushLine('data: {"type":"error","error":{"message":"overloaded"}}');
  }, /overloaded/);
});

test('messages 累积器：文本 / 思考 / 工具调用分片 / stop_reason 映射', function () {
  const acc = P.createMessagesAccumulator();
  const events = [];
  [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"思考"}}',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"search_library","input":{}}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":"}}',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"量子\\"}"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}',
    'data: {"type":"message_stop"}'
  ].forEach(function (line) { events.push.apply(events, acc.pushLine(line)); });
  assert.ok(events.some(function (e) { return e.type === 'delta' && e.text === '答'; }));
  assert.ok(events.some(function (e) { return e.type === 'reasoning_delta' && e.text === '思考'; }));
  assert.ok(events.some(function (e) { return e.type === 'tool_call' && e.name === 'search_library'; }));
  assert.ok(events.some(function (e) { return e.type === '_closed'; }));
  const msg = acc.message();
  assert.equal(msg.content, '答');
  assert.equal(msg.reasoning_content, '思考');
  assert.equal(msg.tool_calls.length, 1);
  assert.equal(msg.tool_calls[0].id, 'toolu_1');
  assert.equal(msg.tool_calls[0].function.name, 'search_library');
  assert.equal(msg.tool_calls[0].function.arguments, '{"query":"量子"}');
  assert.equal(acc.getFinishReason(), 'tool_calls');
  assert.equal(acc.sawDone(), true);
  assert.equal(acc.getUsage().prompt_tokens, 12);
  assert.equal(acc.getUsage().completion_tokens, 9);
});

test('messages 累积器：max_tokens → length（截断），error 事件抛出', function () {
  const acc = P.createMessagesAccumulator();
  acc.pushLine('data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}');
  acc.pushLine('data: {"type":"message_stop"}');
  assert.equal(acc.getFinishReason(), 'length');

  const plain = P.createMessagesAccumulator();
  plain.pushLine('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}');
  assert.equal(plain.getFinishReason(), 'stop');

  const bad = P.createMessagesAccumulator();
  assert.throws(function () {
    bad.pushLine('data: {"type":"error","error":{"type":"overloaded_error","message":"服务过载"}}');
  }, /服务过载/);
});

test('createAccumulator: 未知协议回退 chat 形态', function () {
  const acc = P.createAccumulator('nonsense');
  acc.pushLine('data: {"choices":[{"delta":{"content":"x"}}]}');
  assert.equal(acc.message().content, 'x');
});

test('chat 形态：输出上限随模型改写字段名（o 系/gpt-5 用 max_completion_tokens）', function () {
  const body = { model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], max_tokens: 12800 };
  const out = P.toChatBody(body);
  assert.equal(out.max_completion_tokens, 12800);
  assert.equal(out.max_tokens, undefined);
  assert.equal(body.max_tokens, 12800, '不改原对象');

  // 网关惯用 vendor/model 前缀，按最后一段判家族
  assert.equal(P.toChatBody({ model: 'openai/o3-mini', max_tokens: 4096 }).max_completion_tokens, 4096);
  // 其余模型保持 max_tokens（第三方兼容网关普遍只认这个字段）
  assert.equal(P.toChatBody({ model: 'deepseek-chat', max_tokens: 12800 }).max_tokens, 12800);
  assert.equal(P.toChatBody({ model: 'gpt-4o', max_tokens: 12800 }).max_tokens, 12800);
  assert.equal(P.toChatBody({ model: 'gpt-4o', max_tokens: 12800 }).max_completion_tokens, undefined);
  // 没有输出上限时原样透传
  assert.deepEqual(P.toChatBody({ model: 'gpt-5', messages: [] }), { model: 'gpt-5', messages: [] });
});

test('convertBody: chat 形态带 max_tokens，responses/messages 各自映射字段', function () {
  const base = { model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 12800 };
  assert.equal(P.convertBody(base, 'chat').max_tokens, 12800);
  assert.equal(P.convertBody(base, 'responses').max_output_tokens, 12800);
  assert.equal(P.convertBody(base, 'responses').max_tokens, undefined);
  assert.equal(P.convertBody(base, 'messages').max_tokens, 12800);
  // messages 形态必须带 max_tokens：缺省时给内部默认值兜底
  assert.ok(P.convertBody({ model: 'm', messages: [] }, 'messages').max_tokens > 0);
});
