'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitQuery = require('../js/query.js');

const papers = [
  { id: 'p1', title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017,
    entryType: 'article', venue: 'NeurIPS', tags: ['transformer', 'nlp'], citations: 90000, rating: 5,
    status: 'read', doi: '10.1/abc', abstract: 'self-attention', notes: '里程碑', key: 'vaswani2017' },
  { id: 'p2', title: '深度学习综述', authors: ['Yann LeCun'], year: 2015,
    entryType: 'article', venue: 'Nature', tags: ['综述'], citations: 30000, rating: 4,
    status: 'reading', doi: '', abstract: 'deep learning review', notes: '', key: 'lecun2015' },
  { id: 'p3', title: 'Some obscure draft', authors: [], year: null, venue: '',
    entryType: 'preprint', tags: [], citations: null, rating: 0, status: 'unread', notes: 'todo', key: 'anonnodate',
    pdfPath: 'D:\\x.pdf', deletedAt: 123 }
];

function match(query) {
  const result = LitQuery.parse(query);
  assert.equal(result.error, null, 'parse error: ' + result.error);
  return papers.filter(result.matcher).map(function (p) { return p.id; });
}

test('bare words search across text fields', function () {
  assert.deepEqual(match('attention'), ['p1']);
  assert.deepEqual(match('深度学习'), ['p2']);
  assert.deepEqual(match('lecun'), ['p2']);
  assert.deepEqual(match('综述'), ['p2']); // 命中标签
  assert.deepEqual(match('里程碑'), ['p1']); // 命中笔记
});

test('implicit AND and explicit boolean operators', function () {
  assert.deepEqual(match('attention vaswani'), ['p1']);
  assert.deepEqual(match('attention AND lecun'), []);
  assert.deepEqual(match('attention OR 深度'), ['p1', 'p2']);
  assert.deepEqual(match('attention NOT vaswani'), []);
  assert.deepEqual(match('transformer -vaswani'), []);
  assert.deepEqual(match('(attention OR 深度) NOT lecun'), ['p1']);
});

test('field matching and numeric comparisons', function () {
  assert.deepEqual(match('venue:Nature'), ['p2']);
  assert.deepEqual(match('author:vaswani'), ['p1']);
  assert.deepEqual(match('tag:综述'), ['p2']);
  assert.deepEqual(match('year>=2016'), ['p1']);
  assert.deepEqual(match('citations>50000'), ['p1']);
  assert.deepEqual(match('rating>=4'), ['p1', 'p2']);
  assert.deepEqual(match('year<2016'), ['p2']);
  assert.deepEqual(match('status:reading'), ['p2']);
  assert.deepEqual(match('key:lecun2015'), ['p2']);
  assert.deepEqual(match('type:article status:read'), ['p1']);
});

test('has:/is: flags', function () {
  assert.deepEqual(match('has:doi'), ['p1']);
  assert.deepEqual(match('has:notes'), ['p1', 'p3']);
  assert.deepEqual(match('has:pdf'), ['p3']);
  assert.deepEqual(match('is:trash'), ['p3']);
  assert.deepEqual(match('NOT is:trash has:abstract'), ['p1', 'p2']);
});

test('quoted phrases and regex', function () {
  assert.deepEqual(match('"all you need"'), ['p1']);
  assert.deepEqual(match('/obscure/'), ['p3']); // 正则作用于合并文本域
  assert.deepEqual(match('type:preprint'), ['p3']);
});

test('parse errors are reported not thrown', function () {
  assert.ok(LitQuery.parse('(unbalanced').error);
  assert.ok(LitQuery.parse('"unclosed').error);
  assert.ok(LitQuery.parse('year>abc').error);
  assert.ok(LitQuery.parse('/[invalid/').error);
  assert.equal(LitQuery.parse('').matcher(papers[0]), true);
});

test('isPlainText detects simple queries', function () {
  assert.equal(LitQuery.isPlainText('深度学习'), true);
  assert.equal(LitQuery.isPlainText('year>=2020'), false);
  assert.equal(LitQuery.isPlainText('a OR b'), false);
});

/* ---------- 阶段四：AST / 新字段 / 跨层级组 / Unicode 规范化 ---------- */

test('parseAst returns versioned AST and serialize round-trips', function () {
  const ast = LitQuery.parseAst('tag:综述 year>=2020 AND has:pdf');
  assert.equal(ast.v, 3);
  assert.ok(ast.root);
  const text = LitQuery.astToText(ast);
  const again = LitQuery.parseAst(text);
  assert.equal(again.error, undefined);
  const paper = { tags: ['综述'], year: 2021, pdfPath: '/x.pdf' };
  const m1 = LitQuery.compile(ast).matcher;
  const m2 = LitQuery.compile(JSON.parse(LitQuery.serializeAst(ast))).matcher;
  assert.equal(m1(paper), true);
  assert.equal(m2(paper), true);
});

test('ann() group requires the SAME annotation to satisfy all inner conditions', function () {
  const paper = {
    pdfAnnotations: [
      { id: 'a1', type: 'highlight', text: '量子纠缠', comment: '', color: '#ffd400', position: { pageIndex: 2 }, tags: [] },
      { id: 'a2', type: 'highlight', text: '量子计算', comment: '重要', color: '#ff6b6b', position: { pageIndex: 4 }, tags: [] }
    ]
  };
  // 同一批注：量子 + 黄色 → 只有 a1 满足
  let compiled = LitQuery.compile(LitQuery.parseAst('ann("量子" color:#ffd400)'));
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('ann("量子" color:#5aa9ff)'));
  assert.equal(compiled.matcher(paper), false);
  // 同一批注：量子 + 评论含「重要」→ a2 满足（a1 无评论）
  compiled = LitQuery.compile(LitQuery.parseAst('ann("量子" comment:重要)'));
  assert.equal(compiled.matcher(paper), true);
  // 两个独立 ann 组 = 不同批注各满足：量子(两条都有) + 黄色(a1) → 命中
  compiled = LitQuery.compile(LitQuery.parseAst('ann("量子") ann(color:#ff6b6b)'));
  assert.equal(compiled.matcher(paper), true);
  // 组内数值比较：page:5 → a2 在第 5 页
  compiled = LitQuery.compile(LitQuery.parseAst('ann(page:5)'));
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('ann(page:6)'));
  assert.equal(compiled.matcher(paper), false);
});

test('note() group matches notes of the paper via ctx', function () {
  const notes = [
    { id: 'n1', paperId: 'p1', title: '方法笔记', content: '用了材料模拟', deletedAt: null },
    { id: 'n2', paperId: 'p2', title: '其他', content: '无关', deletedAt: null }
  ];
  const ctx = { notes: notes, folders: [] };
  const paper = { id: 'p1' };
  let compiled = LitQuery.compile(LitQuery.parseAst('note("材料")'), ctx);
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('note(title:方法)'), ctx);
  assert.equal(compiled.matcher(paper), true);
  compiled = LitQuery.compile(LitQuery.parseAst('note("不存在的词")'), ctx);
  assert.equal(compiled.matcher(paper), false);
  // 另一篇的笔记不影响
  compiled = LitQuery.compile(LitQuery.parseAst('note("材料")'), ctx);
  assert.equal(compiled.matcher({ id: 'p2' }), false);
});

test('unicode normalization matches accents, curly quotes, fullwidth and superscripts', function () {
  const paper = { title: 'Café “深度学习” 模型 ¹²', authors: [], tags: [] };
  const hay = (q) => {
    const compiled = LitQuery.compile(LitQuery.parseAst('"' + q + '"'));
    return compiled.matcher(paper);
  };
  const hayRaw = (query) => LitQuery.compile(LitQuery.parseAst(query)).matcher(paper);
  assert.equal(hay('cafe'), true);           // 重音折叠
  assert.equal(hay('CAFÉ'), true);           // 大小写 + 重音
  assert.equal(hayRaw('“深度学习”'), true);   // 弯引号
  assert.equal(hayRaw('"深度学习"'), true);   // 直引号（规范化后相同）
  assert.equal(hay('12'), true);             // 上标折叠
  assert.equal(hay('ｃａｆｅ'), true);       // 全角折叠
  // 原文显示不被修改
  assert.equal(paper.title, 'Café “深度学习” 模型 ¹²');
  // 正则不规范化
  const reCompiled = LitQuery.compile(LitQuery.parseAst('/café/'));
  assert.equal(reCompiled.matcher(paper), true);
});

test('new fields: folder / lastread compare / missing / has:epub', function () {
  const folders = [
    { id: 'f1', name: '方法', parentId: '' },
    { id: 'f2', name: '实验', parentId: 'f1' }
  ];
  const day = Date.UTC(2024, 0, 15);
  const paper = {
    id: 'p1', folderIds: ['f2'], lastReadAt: day + 3 * 3600 * 1000,
    attachments: [{ kind: 'epub', path: '/x.epub' }], venue: '', tags: []
  };
  const ctx = { notes: [], folders: folders };
  assert.equal(LitQuery.compile(LitQuery.parseAst('folder:"方法"'), ctx).matcher(paper), true); // 子文件夹下钻
  assert.equal(LitQuery.compile(LitQuery.parseAst('lastread:2024-01-15'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('lastread>=2024-01-01'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('lastread>2024-01-15'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('missing:lastread'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('missing:lastread'), ctx).matcher({ id: 'p2' }), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('missing:venue'), ctx).matcher(paper), true); // 空字符串算缺失
  assert.equal(LitQuery.compile(LitQuery.parseAst('has:epub'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('has:snapshot'), ctx).matcher(paper), false);
});

test('legacy query strings still parse (backward compatibility)', function () {
  const paper = { title: 'Alpha', year: 2021, tags: ['x'], status: 'read', pdfPath: '/a.pdf', authors: [] };
  const cases = ['alpha', 'year>=2020', 'tag:x', 'has:pdf AND is:read', '(alpha OR beta) NOT gamma'];
  cases.forEach(function (q) {
    const parsed = LitQuery.parse(q);
    assert.equal(parsed.error, null, q);
    assert.equal(parsed.matcher(paper), true, q);
  });
});

test('rowsToText builds queries shared with the text syntax evaluator', function () {
  const rows = [
    { kind: 'field', field: 'tag', cmp: ':', value: '综述' },
    { kind: 'field', field: 'year', cmp: '>=', value: '2020' },
    { kind: 'flag', value: 'pdf' }
  ];
  const text = LitQuery.rowsToText(rows);
  assert.equal(text, 'tag:综述 year>=2020 has:pdf');
  const compiled = LitQuery.compile(LitQuery.parseAst(text));
  assert.equal(compiled.matcher({ tags: ['综述'], year: 2021, pdfPath: '/x' }), true);
  assert.equal(compiled.matcher({ tags: ['综述'], year: 2019, pdfPath: '/x' }), false);
  // OR 连接 + 批注组 + 空值判断 + 短语
  const rows2 = [
    { kind: 'text', value: '深度学习' },
    { join: 'OR', kind: 'ann', value: '"量子" color:#ffd400' },
    { kind: 'missing', field: 'doi' }
  ];
  const text2 = LitQuery.rowsToText(rows2);
  assert.match(text2, /^深度学习 OR ann\("量子" color:#ffd400\) missing:doi$/);
  const compiled2 = LitQuery.compile(LitQuery.parseAst(text2), { notes: [], folders: [] });
  assert.equal(compiled2.matcher({ title: '深度学习', doi: '' }), true);
});

test('AST v3 counts complete notes and attachments and supports stable folder ids', function () {
  const folders = [
    { id: 'f1', name: '同名', parentId: '' },
    { id: 'f2', name: '同名', parentId: 'f1' },
    { id: 'f3', name: '同名', parentId: '' }
  ];
  const notes = [
    { id: 'n1', paperId: 'p1', content: 'first body', deletedAt: null },
    { id: 'n2', paperId: 'p1', content: 'second body', deletedAt: null },
    { id: 'n3', paperId: 'p1', content: 'deleted body', deletedAt: 10 },
    { id: 'n4', paperId: '', content: 'topic body', deletedAt: null }
  ];
  const ctx = { notes: notes, folders: folders };
  const paper = {
    id: 'p1', title: 'Paper', notes: '', folderIds: ['f2'], pdfAnnotations: [],
    attachments: [
      { id: 'a1', kind: 'pdf', fileName: 'main.pdf', path: '/main.pdf' },
      { id: 'a2', kind: 'supp', fileName: 'supp.zip', path: '/supp.zip' }
    ]
  };
  assert.equal(LitQuery.compile(LitQuery.parseAst('has:notes'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('notes>=2'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('notes>=3'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('"second body"'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('attachments=2'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('attachment(kind:pdf)'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('attachment(kind:epub)'), ctx).matcher(paper), false);
  assert.equal(LitQuery.compile(LitQuery.parseAst('folderid:f1'), ctx).matcher(paper), true);
  assert.equal(LitQuery.compile(LitQuery.parseAst('folderid:f3'), ctx).matcher(paper), false);
});

test('entity search returns attachment-scoped navigable hits', function () {
  const workspace = {
    papers: [{ id: 'p1', title: 'Paper', attachments: [
      { id: 'a1', kind: 'pdf', fileName: 'main.pdf', path: '/main.pdf' },
      { id: 'a2', kind: 'supp', fileName: 'supp.zip', path: '/supp.zip' }
    ], pdfAnnotations: [
      { id: 'ann1', type: 'highlight', text: 'quantum', comment: '', attachmentId: 'a1', position: { pageIndex: 4 } },
      { id: 'ann2', type: 'highlight', text: 'other', comment: '', attachmentId: 'a2', position: { pageIndex: 1 } }
    ] }],
    notes: [{ id: 'n1', paperId: '', title: 'Topic', content: 'quantum note', deletedAt: null }], folders: []
  };
  const annotations = LitQuery.searchEntities('ann("quantum")', workspace, { scope: 'annotation', pageSize: 1 });
  assert.equal(annotations.total, 1);
  assert.equal(annotations.items[0].entityId, 'ann1');
  assert.equal(annotations.items[0].attachmentId, 'a1');
  assert.deepEqual(annotations.items[0].target, { paperId: 'p1', attachmentId: 'a1', annotationId: 'ann1', page: 5 });
  const topics = LitQuery.searchEntities('quantum', workspace, { scope: 'note' });
  assert.equal(topics.total, 1);
  assert.equal(topics.items[0].paperId, '');
  assert.equal(topics.items[0].target.noteId, 'n1');
});

test('F07 回归：author+ann 混合条件实体命中不为空', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [{ id: 'p1', title: 'X', authors: ['Smith'], pdfAnnotations: [
    { id: 'a1', color: '#ffd400', text: 'hello', comment: '', position: { pageIndex: 0 }, attachmentId: 'att1' }
  ] }], notes: [], folders: [] };
  const r = Q.searchEntities('author:Smith ann(color:#ffd400)', ws, { scope: 'annotation' });
  assert.deepEqual(r.items.map(function (i) { return i.entityId; }), ['a1']);
  // author 不匹配时 paper 级不命中 → 无实体
  const r2 = Q.searchEntities('author:Jones ann(color:#ffd400)', ws, { scope: 'annotation' });
  assert.equal(r2.items.length, 0);
});

test('F07 回归：多个独立 ann 组分别命中不同批注（组间独立 ∃）', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [{ id: 'p1', title: 'X', pdfAnnotations: [
    { id: 'a1', color: '#ffd400', text: 'hello', position: { pageIndex: 0 }, attachmentId: 'att1' },
    { id: 'a2', color: '#5aa9ff', text: 'world', position: { pageIndex: 1 }, attachmentId: 'att1' }
  ] }], notes: [], folders: [] };
  // 同一批注不可能同时 color=黄 且 text:world；独立组应命中两条不同批注
  const r = Q.searchEntities('ann(color:#ffd400) ann(text:world)', ws, { scope: 'annotation' });
  assert.deepEqual(r.items.map(function (i) { return i.entityId; }).sort(), ['a1', 'a2']);
});

test('F07 回归：主题笔记查询 has:pdf 不抛异常；纯文本可命中主题笔记', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [], notes: [
    { id: 'n1', paperId: '', title: '主题笔记', content: '机器学习' }
  ], folders: [] };
  const r = Q.searchEntities('has:pdf', ws, { scope: 'note' });
  assert.equal(r.items.length, 0); // 不抛 TypeError
  const r2 = Q.searchEntities('机器学习', ws, { scope: 'note' });
  assert.deepEqual(r2.items.map(function (i) { return i.entityId; }), ['n1']);
});

test('F05 回归：EPUB 批注实体命中 target 携带 epubcfi', function () {
  const Q = require('../js/query.js');
  const ws = { papers: [{ id: 'p1', title: 'X', pdfAnnotations: [
    { id: 'a2', color: '#5aa9ff', text: 'world', position: { cfi: 'epubcfi(/6/4!/2)' }, attachmentId: 'attE1' }
  ] }], notes: [], folders: [] };
  const r = Q.searchEntities('ann(text:world)', ws, { scope: 'annotation' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].target.epubcfi, 'epubcfi(/6/4!/2)');
});
