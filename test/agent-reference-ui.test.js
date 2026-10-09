'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const Core = require('../js/agentcore.js');
const Agent = require('../js/agenttools.js');
const { createReferences } = require('../electron/agent-reference.js');
const { createSessions } = require('../electron/sessions.js');
const source = fs.readFileSync(path.join(__dirname, '../js/agentui.js'), 'utf8');

function node(tag, text) {
  return { tag, text, children: [], hidden: false, dataset: {},
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    addEventListener(name, callback) { this[name] = callback; } };
}
function harness(run, desktop) {
  const nodes = new Map(), statuses = [];
  const context = {
    uploadBusy: false, compactBusy: false, forkBusy: false, current: run.id, runs: new Map([[run.id, run]]),
    T: (s) => s, $: (id) => { if (!nodes.has(id)) nodes.set(id, node('div')); return nodes.get(id); },
    el: (tag, _cls, text) => node(tag, text), setStatus: (text) => statuses.push(text), toastText: (text) => statuses.push(text), toastError: (e) => statuses.push(e.message),
    desk: desktop, window: { LitAgentCore: Core, LitAgent: Agent }, freezeContext: () => ({ model: 'text-model' }),
    thinkingCapability: () => ({ vision: false }), renderAttachments() {}, renderChips() {}, persistRun() {},
    bump() {}, tools: Agent.createTools({ desktop: desktop }), runner: { isStreaming: () => false, runTurn: async () => {} }
  };
  vm.runInNewContext(source.slice(source.indexOf('  function uploadReferences('), source.indexOf('  function renderAttachments(')) +
    source.slice(source.indexOf('  function sendText('), source.indexOf('  /* ---------------- core.messages')), context);
  return { context, nodes, statuses };
}

test('upload → pending references → user request → actual file read and restored plan form a complete bridge', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'litboard-reference-ui-'));
  const sessions = createSessions({ rootDir: path.join(root, 'sessions') }), references = createReferences(() => sessions);
  try {
    const created = await sessions.create({ title: 'existing' });
    const run = { id: created.id, doc: created.data, core: Core.initState(), pendingReferences: [], streaming: false };
    const desktop = { sessionImportReference: (id, paths) => references.importFiles(id, paths), sessionReadReference: (id, file, offset) => references.readFile(id, file, offset) };
    const { context, nodes } = harness(run, desktop);
    const fixture = path.join(root, 'notes.txt');
    await fsp.writeFile(fixture, 'verified reference evidence');
    await context.uploadReferences([fixture]);
    assert.equal(run.pendingReferences.length, 1);
    assert.equal(nodes.get('agent-pending-references').hidden, false);
    let finish;
    const sent = new Promise((resolve) => { finish = resolve; });
    context.runner.runTurn = (r) => { finish(r); };
    context.sendText('summarize the reference');
    await sent;
    assert.equal(run.pendingReferences.length, 0);
    const body = Core.buildRequestBody(run.core, { tools: context.tools.tools });
    assert.match(body.messages[0].content, /file=附件\/notes.txt/);
    assert.equal(body.messages[0].content.includes('verified reference evidence'), false);
    const read = JSON.parse(await context.tools.execute('read_session_file', { file: '附件/notes.txt' }, { sessionId: run.id }));
    assert.equal(read.text, 'verified reference evidence');
    const plan = { goal: '<img onerror=x>', steps: [{ content: 'verify reference', status: 'in_progress', note: 'file=附件/notes.txt' }] };
    Core.appendAssistant(run.core, { tool_calls: [{ id: 'p', function: { name: 'update_research_plan', arguments: JSON.stringify(plan) } }] });
    const output = await context.tools.execute('update_research_plan', plan, { messages: run.core.messages });
    Core.appendToolResults(run.core, [{ callId: 'p', name: 'update_research_plan', result: output }]);
    await sessions.commit(run.id, Object.assign(run.doc, Core.serialize(run.core)));
    const saved = await sessions.read(run.id);
    const restored = { core: Core.deserialize(saved), streaming: false };
    context.renderPlan(restored);
    const holder = nodes.get('agent-plan');
    assert.equal(holder.hidden, false);
    assert.equal(holder.children[0].children[0].text.includes('<img onerror=x>'), true);
    assert.equal(holder.children[1].text, '继续任务');
    assert.deepEqual(Agent.getResearchPlan(saved.messages), JSON.parse(output));
  } finally { await sessions.flushAll(); await fsp.rm(root, { recursive: true, force: true }); }
});

test('pending references can be removed and excess uploads fail without losing the previous choice', async () => {
  const run = { id: 's', doc: {}, core: Core.initState(), pendingReferences: [{ name: 'first', file: '附件/first.txt' }] };
  let imports = 0;
  const { context, nodes, statuses } = harness(run, { sessionImportReference: async () => { imports++; return { imported: [], failed: [{ name: 'bad.doc', error: 'unsupported' }] }; } });
  await context.uploadReferences(Array(10).fill('more.txt'));
  assert.equal(imports, 0);
  assert.equal(run.pendingReferences.length, 1);
  assert.match(statuses.at(-1), /10/);
  context.renderPendingReferences(run);
  nodes.get('agent-pending-references').children[0].children[0].click();
  assert.equal(run.pendingReferences.length, 0);
  await context.uploadReferences(['bad.doc']);
  assert.match(statuses.at(-1), /未上传成功/);
  assert.equal(context.uploadBusy, false);
});

test('unsuccessful automatic summaries do not charge again on each tool loop in the same turn', async () => {
  const run = { core: Core.initState(), frozen: {} };
  run.core.turnId = 't';
  let summaries = 0;
  const context = {
    window: { LitAgentCore: Core, LitAgentContext: { usableInputTokens: () => 1000, preserveRecentTokens: () => 100, THRESHOLD_RATIO: 0.8,
      planCompaction: () => ({ boundaryIndex: 1, headMessages: [{}] }), serializeForSummary: () => '', summarizerBody: () => ({}), applyCompaction: () => null } },
    autoCompactEnabled: true, desk: { agentChat: async () => { summaries++; return { message: { content: 'non-saving summary' }, usage: { prompt_tokens: 5, completion_tokens: 3 } }; } },
    agentLimits: () => ({ contextTokens: 1000, maxOutputTokens: 100 }), estimateMessageTokens: Core.estimateMessageTokens,
    T: (s) => s, liveContextTokens: () => 900, setStatus() {}, persistRun: async () => {}, bump() {}
  };
  vm.runInNewContext(source.slice(source.indexOf('  function compactRun('), source.indexOf('  /** 手动「压缩上下文」')), context);
  await context.maybeCompactRun(run);
  await context.maybeCompactRun(run);
  assert.equal(summaries, 1);
  assert.equal(run.compactionFailedTurn, 't');
  assert.equal(run.core.tokens.in, 5);
});
