'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/litsearch.js');

const work = (o) => Object.assign({
  workId: 'W1', doi: '', title: '', year: 2024, sourceName: '', abstract: '',
  snippet: '', pageUrl: '', oaUrl: '', citedBy: 0, sources: ['library']
}, o);

test('termsOf/splitClaims：论点文本切词（拉丁≥3 且挡停用词、CJK 单字与 bigram）与断句（过滤碎片、合并高重叠句、上限）', function () {
  const terms = S.termsOf('A study of lithium battery 电池寿命');
  assert.ok(terms.includes('lithium'));
  assert.ok(terms.includes('battery'));
  assert.ok(!terms.includes('the'), '停用词被挡');
  assert.ok(terms.includes('电'), 'CJK 单字');
  assert.ok(terms.includes('电池'), 'CJK bigram');
  assert.ok(terms.includes('寿命'));
  const claims = S.splitClaims('锂离子电池的健康状态估计是储能系统的核心问题。温度会显著影响估计精度。温度对估计精度有显著影响。短。');
  const texts = claims.map((c) => c.text);
  assert.equal(texts.length, 2, '第 2、3 句高度重叠应合并为一条（取更长者）');
  assert.ok(texts[0].indexOf('健康状态估计') !== -1);
  assert.ok(texts[1].length > 0);
  // 上限生效（用互不重叠的句子，否则会被合并）
  const distinct = ['锂电池的热失控会引发连锁反应。', '固态电解质的离子电导率仍然偏低。',
    '超声检测可识别电池内部缺陷。', '数据驱动方法依赖足够的标注样本。', '低温环境会降低可用容量。'];
  const many = S.splitClaims(distinct.join(''), { limit: 3 });
  assert.equal(many.length, 3);
  assert.equal(S.splitClaims(distinct.join(''), { limit: 99 }).length, 5);
});

test('assessEvidence: 命中论点词的摘要句子 → supports 并给出原句；无命中句 → none（主题相近不得当依据）', function () {
  const claim = '温度会显著影响锂离子电池健康状态估计的精度';
  const w = work({
    title: '温度对电池健康状态估计的影响',
    abstract: '本文研究电动汽车场景。高温会显著影响锂离子电池健康状态估计的精度，其他因素也有影响。',
    snippet: ''
  });
  const ev = S.assessEvidence(claim, w);
  assert.equal(ev.verdict, 'supports');
  assert.equal(ev.best.source, 'abstract');
  assert.ok(ev.best.text.indexOf('精度') !== -1, '证据句应含命中内容');
  const w2 = work({
    title: '锂离子电池正极材料综述',
    abstract: '本文回顾正极材料与电解液添加剂的研究进展，并详细讨论制造成本。'
  });
  const ev2 = S.assessEvidence(claim, w2);
  assert.equal(ev2.verdict, 'none');
  assert.equal(ev2.best, null);
  assert.ok(ev2.note.indexOf('摘要') !== -1);
});

test('assessEvidence: 跨语言时不冒充「已判定」而是如实标注；无摘要时如实说明而不是硬判', function () {
  const claim = '温度会显著影响锂离子电池健康状态估计的精度';
  const w = work({
    title: 'Temperature effects on battery SOH estimation',
    abstract: 'High temperature significantly affects the accuracy of lithium battery state of health estimation.'
  });
  const ev = S.assessEvidence(claim, w);
  assert.equal(ev.verdict, 'none');
  assert.ok(ev.note.indexOf('语言不同') !== -1, '跨语言必须如实说明，不能让模型以为「确实没有」');
  // 同义英文论点 → 正常命中（词面匹配的能力边界）
  const en = S.assessEvidence('temperature affects the accuracy of lithium battery state of health estimation', w);
  assert.equal(en.verdict, 'supports');
  const ev2 = S.assessEvidence('电池健康状态估计', work({ title: 'Battery health estimation methods' }));
  assert.equal(ev2.verdict, 'none');
  assert.ok(ev2.note.indexOf('无摘要') !== -1);
});

test('assessEvidence: 否定极性相反 → partial + polarityMismatch（矛盾证据不当支持）；只有标题级命中 → partial', function () {
  const claim = '数据增强不能提升小样本故障诊断的准确率';
  const w = work({
    title: '小样本故障诊断中的数据增强',
    abstract: '所提数据增强方法在所有测试场景中都明显提升了小样本故障诊断的准确率。'
  });
  const ev = S.assessEvidence(claim, w);
  assert.equal(ev.polarityMismatch, true);
  assert.equal(ev.verdict, 'partial', '极性相反时不得标为 supports');
  const w2 = work({ title: 'Lithium battery state of health estimation review', abstract: '' });
  const ev2 = S.assessEvidence('lithium battery state of health estimation', w2);
  assert.equal(ev2.best.source, 'title');
  assert.equal(ev2.verdict, 'partial');
  assert.ok(ev2.note.indexOf('标题') !== -1);
  // 即便标题逐字命中，也绝不给 supports
  const exact = S.assessEvidence('Lithium battery state of health estimation review', w2);
  assert.equal(exact.verdict, 'partial');
});

test('mergeCandidates: DOI/标题去重（无 DOI 时按规范化标题），字段级择优并记全 sources', function () {
  const merged = S.mergeCandidates([
    { provider: 'openalex-semantic', works: [{ id: 'W9', doi: '10.1/a', title: 'Same paper', abstract: '', citedBy: 3, sourceName: 'J1' }] },
    { provider: 'semanticscholar', works: [{ id: '', doi: '10.1/A', title: 'Same paper', abstract: 'Filled abstract', citedBy: 11, oaUrl: 'https://x/y.pdf' }] },
    { provider: 'library', works: [{ id: 'local:zz', title: 'Same paper', abstract: 'lib copy' }] }
  ]);
  assert.equal(merged.length, 1, '同一篇只留一行');
  assert.equal(merged[0].citedBy, 11, '被引取最大');
  assert.equal(merged[0].abstract, 'Filled abstract', '空摘要被补齐');
  assert.equal(merged[0].oaUrl, 'https://x/y.pdf', 'PDF 直链被补上');
  assert.deepEqual(merged[0].sources, ['openalex-semantic', 'semanticscholar', 'library']);
  const merged2 = S.mergeCandidates([
    { provider: 'a', works: [{ workId: 'l1', title: 'A Study of Lithium Batteries!' }] },
    { provider: 'b', works: [{ workId: 'l2', title: 'a study of lithium batteries' }] }
  ]);
  assert.equal(merged2.length, 1);
  assert.deepEqual(merged2[0].sources, ['a', 'b']);
});

test('buildFindings: 按 verdict 排序、summary 状态如实（supported/partial/not_found）；证据来源如实标注（snippet 不当摘要）', function () {
  const claims = ['温度显著影响锂离子电池健康状态估计精度'];
  const candidates = [
    work({ workId: 'Wsup', title: '温度与电池健康状态', abstract: '高温会显著影响锂离子电池健康状态估计精度。' }),
    work({ workId: 'Wnone', title: '电池材料综述', abstract: '本文只讨论制造成本与正极材料。' })
  ];
  const findings = S.buildFindings(claims, candidates, { perClaim: 5 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].summary.status, 'supported');
  assert.equal(findings[0].candidates[0].evidence.verdict, 'supports');
  assert.equal(findings[0].candidates[0].workId, 'Wsup', '有支撑证据的排前面');
  const none = findings[0].candidates.filter((c) => c.evidence.verdict === 'none');
  assert.equal(none.length, 1, '不隐藏 none 的候选（模型需要区分「召回到但不支撑」');

  // 完全没有候选 → not_found，且带明确说明
  const empty = S.buildFindings(['完全查不到依据的论点'], [], {});
  assert.equal(empty[0].summary.status, 'not_found');
  assert.ok(empty[0].summary.note.indexOf('不要用主题相近') !== -1);
  const findings2 = S.buildFindings(['某方法提升电池寿命预测精度'], [
    work({ workId: 'Wsnip', title: 't', snippet: '实验表明某方法提升电池寿命预测精度。', abstract: '' })
  ], {});
  const c = findings2[0].candidates[0];
  assert.equal(c.evidence.source, 'snippet');
  assert.equal(c.hasAbstract, false, '没有摘要必须如实报 false');
});

test('hasNegation: 中英否定标记都能识别；rankForClaim: 论点词覆盖优先于被引（未被引的新文献也能排前面）', function () {
  assert.equal(S.hasNegation('该策略无效'), true);
  assert.equal(S.hasNegation('the method did not improve accuracy'), true);
  assert.equal(S.hasNegation('no significant difference was observed'), true);
  assert.equal(S.hasNegation('该方法显著提升精度'), false);
  const terms = S.termsOf('lithium battery state of health estimation');
  const relevant = work({ title: 'lithium battery state of health estimation', abstract: 'lithium battery state of health estimation', citedBy: 0 });
  const citedButOff = work({ title: 'unrelated highly cited work', abstract: 'totally different topic', citedBy: 10000 });
  assert.ok(S.rankForClaim(terms, relevant) > S.rankForClaim(terms, citedButOff));
});

/* ---------------- S1：方向性核验（审计复现：increases vs decreases 曾误判 supports） ---------------- */

test('S1: 反向结论（提高 vs 降低）不得 supports——判 partial 且标记极性不符；同向结论仍 supports，方向性论点遇无方向词证据句降级 partial', function () {
  const reverse = S.assessEvidence(
    'Drug A increases survival in patients with lung cancer.',
    { abstract: 'Drug A decreases survival in patients with lung cancer.' }
  );
  assert.equal(reverse.verdict, 'partial');
  assert.equal(reverse.polarityMismatch, true);
  const zh = S.assessEvidence('该药物提高了患者的生存率', { abstract: '该药物降低了患者的生存率' });
  assert.equal(zh.verdict, 'partial');
  assert.equal(zh.polarityMismatch, true);
  const same = S.assessEvidence(
    'Drug A increases survival in patients with lung cancer.',
    { abstract: 'Drug A increases survival in patients with lung cancer.' }
  );
  assert.equal(same.verdict, 'supports');
  assert.equal(same.polarityMismatch, false);
  // 论点有方向、证据句没有任何方向词：仅词面相关，方向未经证实
  const noDir = S.assessEvidence(
    'X increases battery capacity in cells',
    { abstract: 'X affects battery capacity in cells under cycling tests.' }
  );
  assert.equal(noDir.verdict, 'partial');
  assert.ok(String(noDir.note).indexOf('方向') !== -1);
});
