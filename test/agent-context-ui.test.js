
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

test('renderPlan auto-hides a fully completed plan and keeps partial plans visible with resume', () => {
  const Plan = require('../js/agentplan.js');
  const planOf = (steps) => JSON.stringify({ goal: '调研', steps });
  const base = [
    { role: 'assistant', tool_calls: [{ id: 'call1', function: { name: 'search_library' } }] },
    { role: 'tool', name: 'search_library', tool_call_id: 'call1', content: '{"papers":[]}' },
    { role: 'tool', name: 'update_research_plan', content: planOf([{ id: 'a', content: '检索', status: 'completed', evidenceCallIds: ['call1'] }]) }
  ];
  const mkRun = (messages) => ({ core: { messages }, doc: { attachments: [] }, streaming: false, endReason: 'done' });
  const mkCtx = () => {
    const wrap = { dataset: {}, hidden: undefined, children: [], replaceChildren() { this.children = []; }, appendChild(n) { this.children.push(n); } };
    const node = (text) => ({ className: '', textContent: text || '', title: '', children: [], appendChild(n) { this.children.push(n); }, addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} } });
    const ctx = {
      T: s => s,
      $: id => (id === 'agent-plan' ? wrap : node()),
      el: (tag, cls, text) => node(text),
      window: { LitAgent: { getResearchPlan: (m, a) => Plan.getResearchPlan(m, a) }, LitAgentPlan: Plan }
    };
    return { ctx, wrap };
  };
  const slice = source.slice(source.indexOf('  function renderPlan('), source.indexOf('  function renderAttachments('));
  const { ctx: ctxDone, wrap: wrapDone } = mkCtx();
  vm.runInNewContext(slice, ctxDone);
  ctxDone.renderPlan(mkRun(base));
  assert.equal(wrapDone.hidden, true, '全部完成：面板自动收起');
  // 部分完成：保持可见并给出继续任务入口
  const partial = base.concat([
    { role: 'tool', name: 'update_research_plan', content: planOf([
      { id: 'a', content: '检索', status: 'completed', evidenceCallIds: ['call1'] },
      { id: 'b', content: '归纳', status: 'pending' }
    ]) }
  ]);
  const { ctx: ctxPartial, wrap: wrapPartial } = mkCtx();
  vm.runInNewContext(slice, ctxPartial);
  ctxPartial.renderPlan(mkRun(partial));
  assert.equal(wrapPartial.hidden, false, '部分完成：面板保留');
  const texts = wrapPartial.children.flatMap(n => [n.textContent || '', ...n.children.map(c => c.textContent || '')]);
  assert.ok(texts.some(t => t.includes('1/2')), '进度 1/2 可见');
  assert.ok(wrapPartial.children.some(n => (n.textContent || '').includes('继续任务')), '继续任务入口保留');
  // 无计划：隐藏
  const { ctx: ctxNone, wrap: wrapNone } = mkCtx();
  vm.runInNewContext(slice, ctxNone);
  ctxNone.renderPlan(mkRun(base.slice(0, 2)));
  assert.equal(wrapNone.hidden, true, '无计划：隐藏');
});
