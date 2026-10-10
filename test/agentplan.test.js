'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/agentplan');
const messages = [
  { role: 'assistant', tool_calls: [{ id: 'call1', function: { name: 'search_library' } }] },
  { role: 'tool', name: 'search_library', tool_call_id: 'call1', content: '{"papers":[]}' }
];
function plan(step) { return { goal: '调研', steps: [{ id: 'a', content: '检索', status: 'completed', evidenceCallIds: ['call1'], ...step }] }; }
test('成功工具调用存在于当前分支才可完成；压缩标记不破坏证据', () => {
  assert.equal(P.validateProposal(plan(), { messages }).ok, true);
  assert.equal(P.validateProposal(plan(), { messages: messages.map(m => ({ ...m, compacted: true })) }).ok, true);
  assert.equal(P.validateProposal(plan(), { messages: [] }).ok, false);
  assert.equal(P.validateProposal(plan({ evidenceCallIds: [] }), { messages }).ok, false);
});
test('失败、取消、未执行与伪造的孤立结果不作为证据', () => {
  for (const content of ['{"error":"bad"}', '{"error":true}', '{"ok":false}', '{"status":"cancelled"}', '工具执行失败：bad', '已取消', '未执行', 'Error: bad', '用户取消了操作', '用户取消了收藏', '当前环境不支持页面渲染', '{"results":[{"error":"无 OA"},{"error":"下载失败"}]}']) {
    assert.equal(P.validateProposal(plan(), { messages: [messages[0], { ...messages[1], content }] }).ok, false, content);
  }
  assert.equal(P.validateProposal(plan(), { messages: [{ ...messages[1], error: true }] }).ok, false);
  assert.equal(P.validateProposal(plan(), { messages: [messages[1]] }).ok, false);
});
test('登记附件可作为产物，未知附件不被接受', () => {
  const input = plan({ evidenceCallIds: [], artifacts: ['report.md'] });
  assert.equal(P.validateProposal(input, { attachments: [{ file: 'report.md' }] }).ok, true);
  assert.equal(P.validateProposal(input, { attachments: [] }).ok, false);
});
test('依赖必须存在、无循环且完成状态可核验', () => {
  assert.equal(P.validateProposal(plan({ dependsOn: ['unknown'] }), { messages }).ok, false);
  assert.equal(P.validateProposal(plan({ dependsOn: ['a'] }), { messages }).ok, false);
  const input = plan({ dependsOn: ['b'] });
  input.steps.push({ id: 'b', content: '阅读', status: 'pending' });
  assert.equal(P.validateProposal(input, { messages }).ok, false);
  input.steps[0].status = 'in_progress';
  assert.equal(P.validateProposal(input, { messages }).ok, false);
  input.steps[0].status = 'pending'; input.steps[1].dependsOn = ['a'];
  assert.equal(P.validateProposal(input, { messages }).ok, false);
});
test('明确新课题允许复用步骤编号，但仍要求真实证据', () => {
  const previousPlan = P.validateResearchPlan(plan(), { messages });
  const next = { ...plan({ content: '新课题检索' }), goal: '新课题' };
  assert.equal(P.validateProposal(next, { messages, previousPlan }).ok, true);
  assert.equal(P.validateProposal(next, { messages: [], previousPlan }).ok, false);
});
test('稳定 id 内容变化后不能维持完成，重复 id 拒绝', () => {
  const previousPlan = P.validateResearchPlan(plan(), { messages });
  assert.equal(P.validateProposal(plan({ content: '重新阅读' }), { messages, previousPlan }).ok, false);
  assert.equal(P.validateProposal(plan({ content: '重新阅读', status: 'pending' }), { messages, previousPlan }).ok, true);
  const input = plan(); input.steps.push({ ...input.steps[0] });
  assert.equal(P.validateProposal(input, { messages }).ok, false);
});
test('旧计划升级保留内容和稳定 id，历史损坏更新不覆盖有效更新', () => {
  const old = { goal: '调研', steps: [{ content: '检索', status: 'completed' }] };
  const oldMessage = { role: 'tool', name: 'update_research_plan', content: JSON.stringify(old) };
  const upgraded = P.getResearchPlan([oldMessage]);
  assert.equal(upgraded.steps[0].id, 'step-1');
  assert.equal(upgraded.steps[0].status, 'blocked');
  assert.match(upgraded.steps[0].note, /禁止直接重复/);
  const update = { role: 'tool', name: 'update_research_plan', content: JSON.stringify(plan()) };
  assert.equal(P.getResearchPlan([...messages, update]).steps[0].status, 'completed');
  assert.equal(P.getResearchPlan([update]), null);
  assert.deepEqual(P.getResearchPlan([oldMessage, { ...update, content: '{"error":true}' }]), upgraded);
});


test('unsupported references and empty failed rendering are not successful evidence', () => {
  for (const data of [{ status: 'unsupported' }, { status: 'binary' }, { status: 'too_large' }, { renderedPages: [], failures: [{ page: 1, error: 'bad' }] }]) assert.equal(P.successfulResult({ role: 'tool', name: 'read_session_file', content: JSON.stringify(data) }), false);
  assert.equal(P.successfulResult({ role: 'tool', name: 'search_library', content: '{"papers":[]}' }), true);
});

test('中文/非 ASCII 步骤 id 合法（模型常用中文短语当 id），空白、超长、重复仍拒绝', () => {
  const chinese = plan({ id: '检索文献' });
  assert.equal(P.validateProposal(chinese, { messages }).ok, true);
  // 中文 id 的依赖与证据链路完整走通
  const two = { goal: '调研', steps: [
    { id: '检索文献', content: '检索', status: 'completed', evidenceCallIds: ['call1'] },
    { id: '归纳结论', content: '归纳', status: 'in_progress', dependsOn: ['检索文献'] }
  ] };
  assert.equal(P.validateProposal(two, { messages }).ok, true);
  assert.equal(P.getResearchPlan([...messages, { role: 'tool', name: 'update_research_plan', content: JSON.stringify(two) }]).steps[1].id, '归纳结论');
  // 边界仍然生效
  assert.equal(P.validateProposal(plan({ id: ' ' }), { messages }).ok, false, '纯空白 id');
  assert.equal(P.validateProposal(plan({ id: 'a b' }), { messages }).ok, false, '含空格 id');
  assert.equal(P.validateProposal(plan({ id: 'x'.repeat(65) }), { messages }).ok, false, '超长 id');
});
test('isPlanCompleted：全部完成才算完成，供 UI 自动收起面板', () => {
  assert.equal(P.isPlanCompleted(null), false);
  assert.equal(P.isPlanCompleted({ goal: 'g', steps: [] }), false);
  assert.equal(P.isPlanCompleted(P.validateResearchPlan(plan(), { messages })), true);
  const pending = plan(); pending.steps.push({ id: 'b', content: '阅读', status: 'pending' });
  assert.equal(P.isPlanCompleted(P.validateResearchPlan(pending, { messages })), false);
  assert.equal(P.isPlanCompleted(P.validateResearchPlan(plan({ status: 'blocked' }), { messages })), false);
});

/* ---------------- 证据短别名（2026-10 真机会话复盘） ----------------
 * 模型标记步骤完成时编造 call_2/call_4 这类短 id，连续 5 次被
 * 「证据不是当前会话成功工具结果」拒绝后放弃作答，计划永远停在初版。
 * 修复：请求里每条工具结果行首标注 [cN]；校验接受 cN 别名或完整 id；
 * 拒绝时报错附带近期可用调用（cN=工具名），一次改对。 */
const multi = [
  { role: 'assistant', tool_calls: [
    { id: 'call_4c60566058ae49a9a67c760a', function: { name: 'search_library' } },
    { id: 'call_f0c4255d92e14b6daaa5753b', function: { name: 'get_paper' } }
  ] },
  { role: 'tool', name: 'search_library', tool_call_id: 'call_4c60566058ae49a9a67c760a', content: '{"papers":[1]}' },
  { role: 'tool', name: 'get_paper', tool_call_id: 'call_f0c4255d92e14b6daaa5753b', content: '{"id":"p1"}' }
];
test('evidenceCallIds 接受 [cN] 短别名（编号 = 存储顺序的 tool 消息序号）', () => {
  const alias = P.toolAliasMap(multi);
  assert.equal(alias.byId['call_4c60566058ae49a9a67c760a'], 'c1');
  assert.equal(alias.byId['call_f0c4255d92e14b6daaa5753b'], 'c2');
  assert.equal(P.validateProposal(plan({ evidenceCallIds: ['c1'] }), { messages: multi }).ok, true);
  assert.equal(P.validateProposal(plan({ evidenceCallIds: ['c2'] }), { messages: multi }).ok, true);
  assert.equal(P.validateProposal(plan({ evidenceCallIds: ['call_4c60566058ae49a9a67c760a'] }), { messages: multi }).ok, true);
});
test('编造的 call_N 被 rejected 且报错附带近期可用调用提示', () => {
  const result = P.validateProposal(plan({ evidenceCallIds: ['call_4'] }), { messages: multi });
  assert.equal(result.ok, false);
  assert.match(result.error, /证据不是当前会话成功工具结果：call_4/);
  assert.match(result.error, /近期可用：c1=search_library、c2=get_paper/);
  assert.match(result.error, /\[cN\] 短 id/);
});
test('agentcore 请求渲染的 [cN] 前缀与 agentplan 别名编号一致', () => {
  const Core = require('../js/agentcore');
  const state = { messages: multi, historyMessageCap: 0 };
  const body = Core.buildRequestBody(state, {});
  const tools = body.messages.filter((m) => m.role === 'tool');
  assert.equal(tools.length, 2);
  assert.match(tools[0].content, /^\[c1\] /);
  assert.match(tools[1].content, /^\[c2\] /);
  // 模型引用渲染里看到的 c2 → 校验侧解析为同一调用
  assert.equal(P.validateProposal(plan({ evidenceCallIds: ['c2'] }), { messages: multi }).ok, true);
});
