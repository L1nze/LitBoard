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
