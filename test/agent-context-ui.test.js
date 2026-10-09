
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Core = require('../js/agentcore.js'), Context = require('../js/agentcontext.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/agentui.js'), 'utf8');
test('context UI drops immediately after compaction while cumulative billing remains', async () => {
  const run = { id: 's', frozen: { model: 'frozen-model' }, core: Core.initState() };
  run.core.messages = [{ role: 'user', content: 'a'.repeat(30000) }, { role: 'assistant', content: 'b'.repeat(30000) }, { role: 'user', content: 'latest'.repeat(15000) }];
  run.core.tokens = { in: 700000, out: 14000 };
  const node = { textContent: '' }, statuses = [];
  const ctx = { autoCompactEnabled: true, current: 's', runs: new Map([['s', run]]), tools: { tools: [] }, shouldMaskToolResults: () => false, MASK_KEEP_LAST: 3, window: { LitAgentCore: Core, LitAgentContext: Context },
    T: s => s, $: () => node, systemPrompt: () => 'system', agentLimits: () => ({ contextTokens: 100000, maxOutputTokens: 1000 }),
    estimateMessageTokens: Core.estimateMessageTokens, setStatus: s => statuses.push(s), persistRun: async () => true, bump() {},
    desk: { agentChat: async input => { assert.equal(input.body.model, 'frozen-model'); return { message: { content: 'concise summary' }, usage: { prompt_tokens: 100, completion_tokens: 20 } }; } } };
  vm.runInNewContext(source.slice(source.indexOf('  function buildAgentBody('), source.indexOf('  /** 工具集按配置重建')) + source.slice(source.indexOf('  function contextBody('), source.indexOf('  /** agentloop 发送前钩子')) +
    source.slice(source.indexOf('  function updateTokens('), source.indexOf('  /* ---------------- 对话模式')), ctx);
  ctx.updateTokens(); const before = ctx.liveContextTokens(run); assert.match(node.textContent, /当前上下文占用/); assert.equal(node.textContent.includes('714'), false);
  await ctx.compactRun(run, true);
  assert.ok(ctx.liveContextTokens(run) < before); assert.ok(statuses.at(-1).includes('→'));
  assert.equal(run.core.tokens.in, 700100); assert.equal(run.core.tokens.out, 14020);
  assert.match(node.textContent, /当前上下文占用/);
});
