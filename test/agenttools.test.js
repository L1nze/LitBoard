'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LitAgent = require('../js/agenttools.js');

function makeDeps(overrides) {
  const papers = [
    { id: 'p1', title: 'Battery health estimation', authors: ['Zhang'], venue: 'Nature', year: 2023, tags: ['soc'], doi: '10.1/a' },
    { id: 'p2', title: 'Ultrasonic monitoring', authors: ['Li', 'Wang'], venue: '', year: 2021, tags: [], doi: '' },
    { id: 'p3', title: '电池 健康评估 中文', authors: [], venue: '', year: 2020, tags: ['综述'], doi: '' },
    { id: 'p4', title: 'deleted one', deletedAt: 'x' }
  ];
  return Object.assign({
    desktop: {
      researchQuery: async () => ({ total: 1, works: [{ id: 'W1', title: 'r', year: 2024, doi: '', sourceName: 'S', citedBy: 1 }] }),
      researchSearchOpenalex: async () => ({ count: 2, stored: 2, works: [{ id: 'W2', title: 'x' }, { id: 'W3', title: 'y' }] }),
      researchGetWorks: async (ids) => [{ id: ids[0], title: 'Full', abstract: 'A'.repeat(5000), authors: [{ name: 'Au' }], keywords: ['k'] }],
      pdfSearchQuery: async () => [{ paperId: 'p1', pages: [3, 7], snippets: [{ page: 3, text: '…battery…' }] }]
    },
    getPapers: () => papers,
    getPaperById: (id) => papers.find((p) => p.id === id) || null
  }, overrides);
}

test('research plans validate progress and follow successful history, including compacted records', async () => {
  const t = LitAgent.createTools(makeDeps());
  const plan = { goal: 'review', steps: [{ content: 'read', status: 'in_progress', note: 'W1 page 3' }] };
  const saved = await t.execute('update_research_plan', plan, { messages: [] });
  const messages = [{ role: 'tool', name: 'update_research_plan', content: saved, compacted: true },
    { role: 'tool', name: 'update_research_plan', content: '{"bad":true}', error: true }];
  assert.deepEqual(JSON.parse(await t.execute('read_research_plan', {}, { messages })), JSON.parse(saved));
  assert.equal(LitAgent.getResearchPlan([]), null);
  assert.throws(() => LitAgent.validateResearchPlan({ goal: 'x', steps: [plan.steps[0], plan.steps[0]] }));
  assert.throws(() => LitAgent.validateResearchPlan({ goal: '\u0000'.repeat(300), steps: Array.from({ length: 12 }, () => ({ content: '\u0000'.repeat(180), status: 'pending', note: '\u0000'.repeat(300) })) }));
});

test('read_session_file preserves JSON and exact cursor for escape-heavy text', async () => {
  const t = LitAgent.createTools(makeDeps({ desktop: { sessionReadReference: async () => ({ status: 'ready', offset: 9, totalChars: 30000, text: '\u0000'.repeat(6000) }) } }));
  const raw = await t.execute('read_session_file', { file: '附件/a.txt', fromChar: 9 }, { sessionId: 's' });
  const result = JSON.parse(raw);
  assert.ok(raw.length <= 10000);
  assert.equal(result.nextFromChar, 9 + result.text.length);
});

test('read_session_file revalidates PDF registry on cached reads and gates images by frozen vision', async () => {
  let reads = 0, extracts = 0;
  const t = LitAgent.createTools(makeDeps({ desktop: { sessionReadReference: async (_id, file) => {
    reads++;
    return file.endsWith('.png') ? { status: 'vision' } : { status: 'requires_pdf_extraction', path: '/authorized/a.pdf' };
  } }, extractPdfText: async () => { extracts++; return '【第 1 页】\n' + 'text'.repeat(5000); } }));
  const first = JSON.parse(await t.execute('read_session_file', { file: '附件/a.pdf' }, { sessionId: 's' }));
  const second = JSON.parse(await t.execute('read_session_file', { file: '附件/a.pdf', fromChar: first.nextFromChar }, { sessionId: 's' }));
  assert.equal(extracts, 1);
  assert.equal(reads, 2);
  assert.equal(second.offset, first.nextFromChar);
  assert.match(first.note, /400/);
  const image = JSON.parse(await t.execute('read_session_file', { file: '附件/a.png' }, { sessionId: 's', vision: false }));
  assert.ok(image.error);
  const visual = await t.execute('read_session_file', { file: '附件/a.png' }, { sessionId: 's', vision: true });
  assert.equal(visual.images[0].ref, 'session:s|附件/a.png');
});

test('tool schemas cover the base read-only tools with valid shape', function () {
  const t = LitAgent.createTools(makeDeps());
  assert.equal(t.tools.length, 20); // 计划读写与会话参考读取常驻
  const names = t.tools.map((x) => x.function.name);
  ['search_library', 'search_research', 'search_openalex', 'get_research_work', 'get_paper', 'fulltext_search', 'read_pdf_pages', 'summarize_paper', 'list_pdf_annotations',
    'find_literature',
    // R18（对照 literature-mcp 补齐）：精确解析 / 实体联想 / 摘要回填 / 库内引文邻接
    'get_work', 'autocomplete_entity', 'backfill_abstracts', 'graph_neighbors']
    .forEach((n) => assert.ok(names.includes(n), n));
  t.tools.forEach((s) => {
    assert.equal(s.type, 'function');
    assert.equal(typeof s.function.description, 'string');
    assert.ok(s.function.description.length > 10);
    assert.equal(s.function.parameters.type, 'object');
  });
});

test('build_graph passes its originating session to the graph panel', async function () {
  const shown = [];
  const graph = { meta: { nodeCount: 1, edgeCount: 0, depth: 1, maxNodes: 60, communityCount: 1 } };
  const t = LitAgent.createTools(makeDeps({
    includeWrite: true,
    buildGraph: true,
    desktop: { researchGraph: async () => graph },
    openGraphPanel: (data, sessionId) => shown.push({ data, sessionId })
  }));
  await t.execute('build_graph', { workIds: ['W1'] }, { sessionId: 'session-a' });
  assert.deepEqual(shown, [{ data: graph, sessionId: 'session-a' }]);
});

test('search_library matches multi-term AND, skips deleted, caps results', async function () {
  const t = LitAgent.createTools(makeDeps());
  const out = JSON.parse(await t.execute('search_library', { query: 'battery 2023' }));
  assert.equal(out.count, 1);
  assert.equal(out.papers[0].id, 'p1');
  const zh = JSON.parse(await t.execute('search_library', { query: '电池' }));
  assert.equal(zh.count, 1);
  assert.equal(zh.papers[0].id, 'p3');
  const none = JSON.parse(await t.execute('search_library', { query: '不存在的词' }));
  assert.equal(none.count, 0);
});

test('get_research_work truncates abstract at source', async function () {
  const t = LitAgent.createTools(makeDeps());
  const out = JSON.parse(await t.execute('get_research_work', { workId: 'W9' }));
  assert.equal(out.abstract.length, 2000);
  assert.equal(out.authors[0], 'Au');
});

test('fulltext_search maps paper titles into hits', async function () {
  const t = LitAgent.createTools(makeDeps());
  const out = JSON.parse(await t.execute('fulltext_search', { query: 'battery' }));
  assert.equal(out.count, 1);
  assert.equal(out.hits[0].title, 'Battery health estimation');
  assert.deepEqual(out.hits[0].pages, [3, 7]);
});

test('get_paper reports missing id gracefully', async function () {
  const t = LitAgent.createTools(makeDeps());
  const out = await t.execute('get_paper', { paperId: 'nope' });
  assert.ok(out.indexOf('未找到') !== -1);
});

test('unknown tool throws', async function () {
  const t = LitAgent.createTools(makeDeps());
  await assert.rejects(() => t.execute('rm_rf', {}));
});

test('A16: search_library folder scoping by name, with unknown-folder report', async function () {
  const deps = makeDeps();
  deps.getFolders = () => [{ id: 'f1', name: 'PINN' }, { id: 'f2', name: 'SOH' }];
  deps.getPapersInFolder = (fid) => fid === 'f1' ? [{ id: 'p1', title: 'PINN paper battery', year: 2024, tags: [] }] : [];
  const t = LitAgent.createTools(deps);
  const hit = JSON.parse(await t.execute('search_library', { query: 'battery', folder: 'PINN' }));
  assert.equal(hit.count, 1);
  assert.ok(hit.source.indexOf('PINN') !== -1);
  const miss = JSON.parse(await t.execute('search_library', { query: 'battery', folder: '不存在' }));
  assert.ok(miss.error.indexOf('不存在') !== -1);
  assert.deepEqual(miss.knownFolders, ['PINN', 'SOH']);
});

test('phase 2: write tools registered only with includeWrite; semantic only with includeSemantic', function () {
  const base = makeDeps();
  const ro = LitAgent.createTools(Object.assign({}, base, { includeWrite: false, includeSemantic: false }));
  const names = ro.tools.map((x) => x.function.name);
  assert.ok(!names.includes('collect_papers') && !names.includes('download_pdfs') && !names.includes('add_pdfs_to_folder'));
  assert.ok(!names.includes('semantic_search'));
  const rw = LitAgent.createTools(Object.assign({}, base, { includeWrite: true, includeSemantic: true }));
  const names2 = rw.tools.map((x) => x.function.name);
  ['collect_papers', 'download_pdfs', 'add_pdfs_to_folder', 'semantic_search'].forEach((n) => assert.ok(names2.includes(n), n));
  assert.deepEqual(LitAgent.WRITE_TOOLS, { collect_papers: true, download_pdfs: true, add_pdfs_to_folder: true });
});

test('collect_papers delegates to deps.collectWorks with folder passthrough', async function () {
  const t = LitAgent.createTools(makeDeps({
    includeWrite: true,
    collectWorks: async (ids, folderId) => {
      assert.deepEqual(ids, ['W1', 'W2']);
      assert.equal(folderId, 'f9');
      return { added: 1, merged: 1 };
    }
  }));
  const out = JSON.parse(await t.execute('collect_papers', { workIds: ['W1', 'W2'], folderId: 'f9' }, {}));
  assert.equal(out.added, 1);
  assert.equal(out.merged, 1);
  // 用户取消
  const t2 = LitAgent.createTools(makeDeps({ includeWrite: true, collectWorks: async () => ({ canceled: true }) }));
  const out2 = await t2.execute('collect_papers', { workIds: ['W1'] }, {});
  assert.ok(out2.indexOf('取消') !== -1);
});

test('download_pdfs passes session context; add_pdfs_to_folder stages then imports', async function () {
  const desktop = {
    researchDownloadPdfs: async (input) => {
      assert.equal(input.sessionId, 's1');
      return { results: [{ workId: 'W1', file: '附件/a.pdf', title: 'A' }] };
    },
    researchStagePdfs: async (input) => {
      assert.equal(input.sessionId, 's1');
      return { results: [{ workId: 'W1', fileName: 'z1.pdf', path: '/m/z1.pdf' }] };
    }
  };
  const t = LitAgent.createTools(makeDeps({
    includeWrite: true, desktop: desktop,
    importStagedPdfs: async (stored, folderId) => {
      assert.equal(stored[0].path, '/m/z1.pdf');
      return { added: 1, merged: 0 };
    }
  }));
  const dl = JSON.parse(await t.execute('download_pdfs', { workIds: ['W1'] }, { sessionId: 's1' }));
  assert.equal(dl.results[0].file, '附件/a.pdf');
  const add = JSON.parse(await t.execute('add_pdfs_to_folder', { files: [{ file: '附件/a.pdf', workId: 'W1' }] }, { sessionId: 's1' }));
  assert.equal(add.staged, 1);
  assert.equal(add.added, 1);
  // 无会话上下文 → 明确报错而非静默
  const err = await t.execute('download_pdfs', { workIds: ['W1'] }, {});
  assert.ok(err.indexOf('会话') !== -1);
});

test('semantic_search formats score', async function () {
  const t = LitAgent.createTools(makeDeps({
    includeSemantic: true,
    desktop: {
      researchSemanticSearch: async () => ({ works: [{ id: 'W5', title: 't', year: 2020, doi: '', sourceName: 'S', score: 0.83421 }] })
    }
  }));
  const out = JSON.parse(await t.execute('semantic_search', { query: 'q' }, {}));
  assert.equal(out.works[0].score, 0.834);
  assert.equal(out.works[0].workId, 'W5');
});

test('reading assistant: read_pdf_pages caps range at 8 pages and reports limits', async function () {
  const deps = makeDeps();
  let lastCall = null;
  deps.desktop.pdfSearchGetPageRange = async (input) => {
    lastCall = input;
    return {
      paperId: input.paperId, attachmentId: input.attachmentId,
      method: 'pdfjs', total: 30, from: input.from, to: Math.min(input.to, 30),
      pages: Array.from({ length: Math.min(input.to, 30) - input.from + 1 }, (_, i) => ({ page: input.from + i, text: 'p' + (input.from + i) }))
    };
  };
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('read_pdf_pages', { paperId: 'p1', from: 10, to: 99 }));
  assert.equal(lastCall.from, 10);
  assert.equal(lastCall.to, 17, 'range must be capped at 8 pages (10..17)');
  assert.equal(out.totalPages, 30);
  assert.equal(out.pages.length, 8);
  assert.ok(out.note.indexOf('公式') !== -1);
  // 无索引
  deps.desktop.pdfSearchGetPageRange = async () => null;
  const miss = await t.execute('read_pdf_pages', { paperId: 'px', from: 1, to: 2 });
  assert.ok(miss.indexOf('全文索引') !== -1);
});

test('summarize_paper reads in batches, preserves page cursor, and marks completion only at the end', async function () {
  const calls = [];
  const deps = makeDeps();
  deps.getPaperById = () => ({ id: 'p1', attachments: [{ id: 'att-main', kind: 'pdf', fileName: 'paper.pdf' }] });
  deps.desktop.pdfSearchGetPageRange = async (input) => {
    calls.push(input);
    const to = Math.min(input.to, 10);
    return {
      paperId: input.paperId, attachmentId: input.attachmentId, total: 10, from: input.from, to,
      pages: Array.from({ length: to - input.from + 1 }, (_, i) => ({ page: input.from + i, text: 'Page ' + (input.from + i) }))
    };
  };
  const t = LitAgent.createTools(deps);
  const first = JSON.parse(await t.execute('summarize_paper', { paperId: 'p1' }));
  assert.equal(calls[0].attachmentId, 'att-main');
  assert.equal(first.complete, false);
  assert.ok(first.taskPrompt.includes('研究背景与缺口'));
  assert.deepEqual(first.nextCall, { paperId: 'p1', attachmentId: 'att-main', from: 9, fromChar: 0 });
  const second = JSON.parse(await t.execute('summarize_paper', first.nextCall));
  assert.equal(second.complete, true);
  assert.equal(second.pages[0].page, 9);
  assert.equal(second.nextCall, undefined);
  assert.equal(second.taskPrompt, undefined);
});

test('summarize_paper resumes within a long page without losing text', async function () {
  const deps = makeDeps();
  deps.desktop.pdfSearchGetPageRange = async (input) => ({
    paperId: input.paperId, attachmentId: 'att', total: 1, from: 1, to: 1,
    pages: [{ page: 1, charOffset: input.fromChar, charTotal: 14000, text: 'x'.repeat(14000 - input.fromChar) }]
  });
  const t = LitAgent.createTools(deps);
  const first = JSON.parse(await t.execute('summarize_paper', { paperId: 'p1' }));
  assert.equal(first.complete, false);
  assert.ok(first.nextCall.fromChar > 0);
  assert.ok(JSON.stringify(first).length < 12000);
  const second = JSON.parse(await t.execute('summarize_paper', first.nextCall));
  assert.equal(second.complete, true);
  assert.equal(first.pages[0].text.length + second.pages[0].text.length, 14000);
});

test('summarize_paper follows database-level page truncation, including a short remainder', async function () {
  const deps = makeDeps();
  deps.desktop.pdfSearchGetPageRange = async (input) => {
    const raw = 'x'.repeat(10002);
    const tail = raw.slice(input.fromChar);
    const cap = input.capChars || 3500;
    return {
      paperId: input.paperId, attachmentId: 'att', total: 1, from: 1, to: 1,
      pages: [{ page: 1, charOffset: input.fromChar || 0, charTotal: raw.length,
        text: tail.length > cap ? tail.slice(0, cap) + '…[截断]' : tail }]
    };
  };
  const t = LitAgent.createTools(deps);
  const first = JSON.parse(await t.execute('summarize_paper', { paperId: 'p1' }));
  assert.equal(first.complete, false);
  assert.equal(first.nextCall.fromChar, 10000);
  assert.equal(first.pages[0].text.length, 10000);
  const second = JSON.parse(await t.execute('summarize_paper', first.nextCall));
  assert.equal(second.complete, true);
  assert.equal(second.pages[0].text, 'xx');
});

test('reading assistant: list_pdf_annotations maps page/type/text/comment', async function () {
  const deps = makeDeps();
  deps.getPapers = () => [{
    id: 'pa', title: 'Ann', pdfAnnotations: [
      { type: 'highlight', color: '#ffd400', text: '重要结论', comment: '', position: { pageIndex: 2, rects: [[0, 0, 1, 1]] } },
      { type: 'note', color: '#ff0000', text: '', comment: '这里的推导有疑问', position: { pageIndex: 5, rects: [[0, 0, 1, 1]] } }
    ]
  }];
  deps.getPaperById = (id) => deps.getPapers().find((p) => p.id === id) || null;
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('list_pdf_annotations', { paperId: 'pa' }));
  assert.equal(out.count, 2);
  assert.equal(out.annotations[0].page, 3); // 1 基页码
  assert.equal(out.annotations[0].text, '重要结论');
  assert.equal(out.annotations[1].comment, '这里的推导有疑问');
  // 无文献：纯文本错误串（与 get_paper 同风格）
  const miss = await t.execute('list_pdf_annotations', { paperId: 'missing' });
  assert.ok(String(miss).indexOf('未找到') !== -1);
});

test('search_scopus registers only with includeScopus and maps Scopus fields', async function () {
  const deps = makeDeps();
  deps.desktop.researchSearchScopus = async () => ({
    count: 2, stored: 1,
    works: [
      // A-followup #3：existed=调研库已有；inLibrary=正式库已收藏（正式库反查）——两者独立
      { id: 'W7', title: 'S paper', year: 2024, doi: '10.1016/j.t.2024.01', sourceName: 'J X', citedBy: 17, existed: true, inLibrary: false },
      { id: 'W8', title: 'Collected', year: 2023, doi: '10.1016/j.t.2023.01', sourceName: 'J Y', citedBy: 5, existed: true, inLibrary: true }
    ]
  });
  const t = LitAgent.createTools(deps);
  assert.ok(!t.tools.map((x) => x.function.name).includes('search_scopus'), '未配置 includeScopus 时不得注册');
  const t2 = LitAgent.createTools(Object.assign(deps, { includeScopus: true }));
  const schemaNames = t2.tools.map((x) => x.function.name);
  assert.ok(schemaNames.includes('search_scopus'));
  const out = JSON.parse(await t2.execute('search_scopus', { query: 'battery' }));
  assert.equal(out.total, 2);
  assert.equal(out.works[0].citedByScopus, 17);
  assert.equal(out.works[0].alreadyInLibrary, false, '调研库命中不得冒充正式库收藏');
  assert.equal(out.works[0].inResearch, true);
  assert.equal(out.works[1].alreadyInLibrary, true, '正式库反查命中才是已收藏');
  assert.ok(out.note.indexOf('摘要') !== -1);
});

test('A-followup #3: web_search 分开回报「调研库已有」与「正式库已收藏」', async function () {
  const deps = makeDeps({ includeWebSearch: true });
  deps.desktop.researchWebSearch = async () => ({
    total: 2, matched: 1, created: 1,
    works: [
      { workId: 'local:a', isNew: false, inResearch: true, inLibrary: false, title: 'In research only', url: 'https://x.edu/a' },
      { workId: 'local:b', isNew: true, inResearch: false, inLibrary: true, title: 'Collected', url: 'https://x.edu/b' }
    ]
  });
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('web_search', { query: 'q' }));
  assert.equal(out.works[0].collected, false, '调研库已有 ≠ 已收藏到正式库');
  assert.equal(out.works[0].inResearch, true);
  assert.equal(out.works[1].collected, true, '正式库反查命中才是已收藏');
  assert.equal(out.works[1].inResearch, false);
});

test('R10: read_pdf_pages 省略 attachmentId 时自动解析主 PDF', async function () {
  const deps = makeDeps();
  deps.getPapers = () => [{
    id: 'p1', title: 'T', attachments: [
      { id: 'att-snap', kind: 'snapshot', fileName: 'snap' },
      { id: 'att-pdf', kind: 'pdf', fileName: 'main.pdf' }
    ]
  }];
  deps.getPaperById = (id) => deps.getPapers().find((p) => p.id === id) || null;
  let lastCall = null;
  deps.desktop.pdfSearchGetPageRange = async (input) => {
    lastCall = input;
    return { paperId: input.paperId, attachmentId: input.attachmentId, total: 5, from: input.from, to: input.to,
      pages: [{ page: input.from, text: 'x' }] };
  };
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('read_pdf_pages', { paperId: 'p1', from: 2, to: 2 }));
  assert.equal(lastCall.attachmentId, 'att-pdf', '空 attachmentId 应回退到主 PDF 附件');
  assert.equal(out.attachmentId, 'att-pdf');
  assert.ok(out.resolvedAttachment.indexOf('主 PDF') !== -1);
});

test('R12: read_pdf_pages 超预算裁页并给出 nextFrom 续读，整体不越过 12000 截断线', async function () {
  const deps = makeDeps();
  deps.desktop.pdfSearchGetPageRange = async (input) => ({
    paperId: input.paperId, attachmentId: input.attachmentId || '', total: 20,
    from: input.from, to: Math.min(input.to, 20),
    pages: Array.from({ length: Math.min(input.to, 20) - input.from + 1 }, (_, i) => ({ page: input.from + i, text: 'x'.repeat(3000) }))
  });
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('read_pdf_pages', { paperId: 'p1', from: 1, to: 8 }));
  // 预算 10000：3 整页 + 第 4 页页内截断；nextFrom 指回第 4 页
  assert.equal(out.truncated, true);
  assert.equal(out.pages.length, 4);
  assert.equal(out.nextFrom, 4);
  assert.equal(out.pages[3].truncatedInCall, true);
  assert.ok(out.coverageNote.indexOf('续读') !== -1);
  assert.ok(JSON.stringify(out).length < 12000, '结果 JSON 必须完整落在 core 截断线内');
});

test('R10: get_paper 返回附件清单；fulltext_search 命中带 attachmentId', async function () {
  const deps = makeDeps();
  deps.getPapers = () => [{ id: 'p1', title: 'T', attachments: [{ id: 'att1', kind: 'pdf', fileName: 'a.pdf' }], tags: [] }];
  deps.getPaperById = (id) => deps.getPapers().find((p) => p.id === id) || null;
  deps.desktop.pdfSearchQuery = async () => [{ paperId: 'p1', attachmentId: 'att1', pages: [2], snippets: [{ page: 2, text: 's' }] }];
  const t = LitAgent.createTools(deps);
  const gp = JSON.parse(await t.execute('get_paper', { paperId: 'p1' }));
  assert.equal(gp.attachments[0].id, 'att1');
  assert.equal(gp.attachments[0].kind, 'pdf');
  const ft = JSON.parse(await t.execute('fulltext_search', { query: 'q' }));
  assert.equal(ft.hits[0].attachmentId, 'att1');
});

test('R12: fetch_page 透传 offset 续读字段', async function () {
  const deps = makeDeps({ includeWebSearch: true });
  let lastInput = null;
  deps.desktop.researchFetchPage = async (input) => {
    lastInput = input;
    return { ok: true, title: 'T', finalUrl: 'https://arxiv.org/abs/1',
      markdownExcerpt: 'chunk', offset: input.offset || 0, totalLength: 9000, nextOffset: 4000 };
  };
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('fetch_page', { url: 'https://arxiv.org/abs/1', offset: 4000 }, { sessionId: 's1' }));
  assert.equal(lastInput.offset, 4000);
  assert.equal(out.nextOffset, 4000);
  assert.equal(out.truncated, true);
  assert.equal(out.excerpt, 'chunk');
});

test('R08: isWriteTool 动态判定——fetch_page 带 paperId 才算写正式库', function () {
  assert.equal(LitAgent.isWriteTool('collect_papers', {}), true);
  assert.equal(LitAgent.isWriteTool('download_pdfs', {}), true);
  assert.equal(LitAgent.isWriteTool('add_pdfs_to_folder', {}), true);
  assert.equal(LitAgent.isWriteTool('fetch_page', { url: 'https://arxiv.org/abs/1' }), false, '纯读取不设门');
  assert.equal(LitAgent.isWriteTool('fetch_page', { url: 'https://arxiv.org/abs/1', paperId: 'p1' }), true, '写快照附件必须先确认');
  assert.equal(LitAgent.isWriteTool('search_library', {}), false);
});

test('R08: fetch_page 提交前复核取消状态——已取消的轮不得写入正式库', async function () {
  const deps = makeDeps({ includeWebSearch: true });
  let called = 0;
  deps.desktop.researchFetchPage = async () => { called++; return { ok: true, title: 't', finalUrl: 'u', markdownExcerpt: 'x', offset: 0, totalLength: 1, nextOffset: null }; };
  const t = LitAgent.createTools(deps);
  const out = await t.execute('fetch_page', { url: 'https://arxiv.org/abs/1', paperId: 'p1' }, {
    sessionId: 's1',
    cancelRequested: () => true
  });
  assert.ok(String(out).indexOf('未写入正式库') !== -1);
  assert.equal(called, 0, '取消后不得发起抓取');
});

test('R11: render_pdf_pages 仅视觉能力下注册；渲染→存会话附件→返回图像引用', async function () {
  const deps = makeDeps();
  assert.ok(!LitAgent.createTools(deps).tools.map((x) => x.function.name).includes('render_pdf_pages'),
    '未注入渲染能力时不得注册');
  deps.includeVisionRender = true;
  const seenPages = [];
  deps.renderPageImage = async (input) => {
    assert.ok(input.path.indexOf('main.pdf') !== -1, '解析到主 PDF 附件路径');
    // R1 回归：工具传出的就是请求的 1 基物理页——适配器曾在此 +1 把第 1 页渲染成第 2 页
    seenPages.push(input.pageIndex);
    return { dataUrl: 'data:image/png;base64,QUJD', width: 800, height: 1100 };
  };
  deps.getPapers = () => [{
    id: 'p1', title: 'Vision paper',
    attachments: [{ id: 'att-snap', kind: 'snapshot' }, { id: 'att-pdf', kind: 'pdf', fileName: 'main.pdf', path: 'C:/m/main.pdf' }]
  }];
  deps.getPaperById = (id) => deps.getPapers().find((p) => p.id === id) || null;
  deps.desktop.sessionSaveAttachment = async (sid, input) => {
    assert.equal(sid, 's1');
    assert.equal(input.dataBase64, 'QUJD');
    return { file: '附件/page-3-1.png' };
  };
  const t = LitAgent.createTools(deps);
  assert.ok(t.tools.map((x) => x.function.name).includes('render_pdf_pages'));
  const out = await t.execute('render_pdf_pages', { paperId: 'p1', pages: [3, 3, 9, 12, 15] }, { sessionId: 's1' });
  // [3,3,9,12,15] → 去重 [3,9,12,15] → 单次上限 3 → [3,9,12]
  assert.equal(out.images.length, 3);
  assert.equal(out.images[0].ref, 'session:s1|附件/page-3-1.png');
  assert.equal(out.images[0].label, '第 3 页');
  assert.equal(JSON.parse(out.text).rendered, 3);
  assert.deepEqual(seenPages, [3, 9, 12], '渲染页码 = 请求页码（1 基，无偏移）');
  // 缺会话上下文
  const noCtx = await t.execute('render_pdf_pages', { paperId: 'p1', pages: [3] }, {});
  assert.ok(String(noCtx).indexOf('会话上下文') !== -1);
});

test('性能回归：render_pdf_pages 走批量口子（文档只开一次，不逐页重读整份 PDF）', async function () {
  const deps = makeDeps();
  deps.includeVisionRender = true;
  let batchCalls = 0;
  let singleCalls = 0;
  deps.renderPagesImage = async (input) => {
    batchCalls += 1;
    assert.deepEqual(input.pages, [2, 4]);
    return [
      { page: 2, dataUrl: 'data:image/png;base64,QUJD' },
      { page: 4, error: '页码超出范围：4 / 3' }
    ];
  };
  deps.renderPageImage = async () => { singleCalls += 1; return { dataUrl: 'data:image/png;base64,QUJD' }; };
  deps.getPapers = () => [{
    id: 'p1', title: 'Vision paper',
    attachments: [{ id: 'att-pdf', kind: 'pdf', fileName: 'main.pdf', path: 'C:/m/main.pdf' }]
  }];
  deps.getPaperById = (id) => deps.getPapers().find((p) => p.id === id) || null;
  deps.desktop.sessionSaveAttachment = async () => ({ file: '附件/page-2.png' });
  const t = LitAgent.createTools(deps);
  const out = await t.execute('render_pdf_pages', { paperId: 'p1', pages: [2, 4] }, { sessionId: 's1' });
  assert.equal(batchCalls, 1, '一次批量调用');
  assert.equal(singleCalls, 0, '不得再逐页渲染');
  assert.equal(out.images.length, 1);
  // 逐页失败如实回报，不静默吞掉
  assert.equal(JSON.parse(out.text).failures.length, 1);
  assert.equal(JSON.parse(out.text).failures[0].page, 4);
});

test('R16: search_openalex 透传 mode（keyword/semantic），source 里如实标明', async function () {
  const deps = makeDeps();
  let seen = null;
  deps.desktop.researchSearchOpenalex = async (input) => {
    seen = input;
    return { count: 1, stored: 1, mode: input.mode, works: [{ id: 'W1', title: 't' }] };
  };
  const t = LitAgent.createTools(deps);
  const sem = JSON.parse(await t.execute('search_openalex', { query: '一段话', mode: 'semantic' }, {}));
  assert.equal(seen.mode, 'semantic');
  assert.ok(sem.source.indexOf('语义检索') !== -1);
  const kw = JSON.parse(await t.execute('search_openalex', { query: 'x' }, {}));
  assert.equal(seen.mode, 'keyword', '未指定时默认关键词');
  assert.ok(kw.source.indexOf('关键词检索') !== -1);
});

test('R16: search_semanticscholar 仅在注入能力时注册，并如实声明它不是向量语义检索', async function () {
  const base = makeDeps();
  assert.ok(!LitAgent.createTools(base).tools.map((x) => x.function.name).includes('search_semanticscholar'));
  const deps = makeDeps({
    includeSemanticscholar: true,
    desktop: {
      researchSearchSemanticscholar: async (input) => {
        assert.equal(input.openAccessOnly, true);
        return {
          count: 5, stored: 2, hasMore: true,
          works: [{ id: 'W7', title: 'T', year: 2024, doi: '10.1/a', sourceName: 'J', citedBy: 3, hasAbstract: true, oaUrl: 'https://x/y.pdf', existed: true }]
        };
      }
    }
  });
  const t = LitAgent.createTools(deps);
  assert.ok(t.tools.map((x) => x.function.name).includes('search_semanticscholar'));
  const out = JSON.parse(await t.execute('search_semanticscholar', { query: 'q', openAccessOnly: true }, {}));
  assert.equal(out.total, 5);
  assert.equal(out.works[0].oaPdf, 'https://x/y.pdf');
  assert.equal(out.works[0].alreadyInResearch, true);
  assert.ok(out.note.indexOf('没有文本→向量') !== -1 || out.note.indexOf('无文本→向量') !== -1,
    '必须如实说明 S2 没有向量语义检索端点');
});

test('R16: find_literature 结构化返回 verdict/证据/来源，并如实报召回覆盖', async function () {
  const deps = makeDeps({
    desktop: {
      researchFindLiterature: async (input) => {
        assert.deepEqual(input.claims, ['论点一', '论点二']);
        assert.deepEqual(input.claimsEn, ['claim one']);
        assert.equal(input.remoteClaimBudget, 2);
        return {
          providerStats: { localVector: false, openalex: true, semanticscholar: true, web: false },
          remoteClaimsCovered: 2, remoteClaimsSkipped: 0, candidateTotal: 3,
          routeFailures: [{ claim: '论点一', route: 'semanticscholar', error: 'HTTP 429' }],
          notes: ['本地向量检索未启用或索引为空：本地召回走关键词。'],
          claims: [
            {
              claim: '论点一', summary: { status: 'supported' },
              candidates: [{
                workId: 'W1', doi: '10.1/a', title: 'P', year: 2024, venue: 'J', citedBy: 5, inLibrary: true,
                sources: ['openalex-semantic', 'library'], oaUrl: '', pageUrl: 'https://x/p',
                evidence: { verdict: 'supports', source: 'abstract', text: '证据原句', polarityMismatch: false, note: '' }
              }]
            },
            { claim: '论点二', summary: { status: 'not_found', note: '未找到支撑该论点的可引用证据' }, candidates: [] }
          ]
        };
      }
    }
  });
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('find_literature', {
    text: '', claims: ['论点一', '论点二'], claimsEn: ['claim one'], remoteClaimBudget: 2
  }, {}));
  assert.equal(out.claimCount, 2);
  assert.equal(out.claims[0].status, 'supported');
  assert.equal(out.claims[0].candidates[0].evidence.verdict, 'supports');
  assert.equal(out.claims[0].candidates[0].evidence.text, '证据原句');
  assert.equal(out.claims[0].candidates[0].evidence.source, 'abstract');
  assert.equal(out.claims[0].candidates[0].inLibrary, true);
  assert.deepEqual(out.claims[0].candidates[0].foundIn, ['openalex-semantic', 'library']);
  assert.equal(out.claims[1].status, 'not_found');
  assert.equal(out.routeFailures[0].route, 'semanticscholar');
  assert.ok(out.notes.length);
  assert.ok(JSON.stringify(out.claimKey).indexOf('supports') !== -1, '必须带 verdict 语义说明给模型');
  // 既没 text 又没 claims → 明确报错
  const empty = await t.execute('find_literature', { text: '' }, {});
  assert.ok(String(empty).indexOf('至少要有一个') !== -1);
});

test('联网检索默认偏新文献：不传 yearFrom 时补 2022，传 0 表示不限年份（对齐上游 >2021）', async function () {
  const deps = makeDeps({
    includeSemanticscholar: true,
    desktop: {
      researchSearchOpenalex: async (input) => ({ count: 0, stored: 0, mode: input.mode, works: [] }),
      researchSearchSemanticscholar: async (input) => ({ count: 0, stored: 0, hasMore: false, works: [] })
    }
  });
  const t = LitAgent.createTools(deps);
  const calls = [];
  const origOa = deps.desktop.researchSearchOpenalex;
  const origS2 = deps.desktop.researchSearchSemanticscholar;
  deps.desktop.researchSearchOpenalex = async (input) => { calls.push(input); return origOa(input); };
  deps.desktop.researchSearchSemanticscholar = async (input) => { calls.push(input); return origS2(input); };

  const dflt = JSON.parse(await t.execute('search_openalex', { query: 'x' }, {}));
  assert.equal(calls[0].yearFrom, 2022, '默认只看 2022 年以后');
  assert.ok(dflt.note.indexOf('2022') !== -1, '默认生效时如实回报（免得模型说「没有早期文献」）');
  assert.equal(dflt.yearFrom, 2022);

  await t.execute('search_openalex', { query: 'x', yearFrom: 0 }, {});
  assert.equal(calls[1].yearFrom, null, 'yearFrom: 0 = 不限年份');
  await t.execute('search_openalex', { query: 'x', yearFrom: 1998 }, {});
  assert.equal(calls[2].yearFrom, 1998, '显式年份照传');

  const s2 = JSON.parse(await t.execute('search_semanticscholar', { query: 'x' }, {}));
  assert.equal(calls[3].yearFrom, 2022, 'S2 走同一默认');
  assert.ok(s2.note.indexOf('2022') !== -1 && s2.note.indexOf('相关度排序') !== -1, '年份说明与 S2 事实边界同时保留');

  // 本地库检索与段落找文献不加这个默认（用户自己的库/论点证据不该被静默裁掉早期文献）
  let localSeen = null;
  deps.desktop.researchQuery = async (input) => { localSeen = input; return { total: 0, works: [] }; };
  await t.execute('search_research', { query: 'x' }, {});
  assert.equal(localSeen.yearFrom, null, 'search_research 不套联网默认');
});

test('semantic_search 如实回报实际路径（关键词降级不再被吞掉）', async function () {
  const deps = makeDeps({
    desktop: {
      researchSemanticSearch: async () => ({
        mode: 'keyword',
        note: '未配置嵌入模型或向量索引为空，已按关键词检索；配置后可用语义检索',
        works: [{ id: 'W1', title: 't', score: 0 }]
      })
    }
  });
  const t = LitAgent.createTools(deps);
  const out = JSON.parse(await t.execute('semantic_search', { query: 'x' }, {}));
  assert.equal(out.mode, 'keyword');
  assert.ok(out.note.indexOf('关键词') !== -1, 'note 必须带给模型');
});

/* ---------------- R18：文献检索能力补齐（对照 literature-mcp） ---------------- */

test('R18: get_work 精确解析并如实回报（未命中给出替代建议）', async function () {
  const t = LitAgent.createTools(makeDeps({
    desktop: {
      researchGetWork: async (input) => input.query.indexOf('10.') === 0
        ? { found: true, origin: 'local', work: { id: 'W9', doi: input.query, title: 'Resolved', year: 2025, sourceName: 'J', citedBy: 7, isOa: true, oaUrl: 'https://oa', hasAbstract: true, abstract: 'abs' } }
        : { found: false, note: '本地与 OpenAlex 均未精确命中；模糊/主题检索请改用 search_openalex 或 search_research' }
    }
  }));
  const hit = JSON.parse(await t.execute('get_work', { query: '10.1038/abc' }));
  assert.equal(hit.found, true);
  assert.equal(hit.workId, 'W9');
  assert.equal(hit.note, '');
  const miss = JSON.parse(await t.execute('get_work', { query: '根本不存在的标题' }));
  assert.equal(miss.found, false);
  assert.ok(miss.note.indexOf('search_openalex') !== -1);
});

test('R18: autocomplete_entity 透传候选；graph_neighbors 原样返回主进程结构', async function () {
  const t = LitAgent.createTools(makeDeps({
    desktop: {
      researchAutocomplete: async () => [{ id: 'I123', name: 'Tsinghua University', citedBy: 999, hint: 'institution' }],
      researchGraphNeighbors: async (input) => ({ seeds: input.workIds, direction: input.direction, out: { works: [{ workId: 'W2', title: 'b', year: 2020, citedBy: 3 }], externalNotInLibrary: 12 }, in: { works: [], externalNotInLibrary: 0 } })
    }
  }));
  const ac = JSON.parse(await t.execute('autocomplete_entity', { entity: 'institutions', query: 'tsinghua' }));
  assert.equal(ac.count, 1);
  assert.equal(ac.results[0].id, 'I123');
  const gn = JSON.parse(await t.execute('graph_neighbors', { workIds: ['W1'], direction: 'out' }));
  assert.equal(gn.out.works[0].workId, 'W2');
  assert.equal(gn.out.externalNotInLibrary, 12);
});

test('R18: backfill_abstracts 返回回填统计与停止原因', async function () {
  const t = LitAgent.createTools(makeDeps({
    desktop: { researchBackfill: async (input) => ({ updated: 5, done: input.limit, total: input.limit, stopped: true, reason: 'Elsevier 429' }) }
  }));
  const out = JSON.parse(await t.execute('backfill_abstracts', { limit: 20 }));
  assert.equal(out.updated, 5);
  assert.equal(out.stopped, true);
  assert.equal(out.reason, 'Elsevier 429');
});

test('R18: get_paper 带阅读进度（lastReadAt），辅助阅读先对齐用户进度', async function () {
  const t = LitAgent.createTools({
    getPapers: () => [],
    getPaperById: (id) => (id === 'p1' ? { id: 'p1', title: 'T', lastReadAt: '2026-09-01T00:00:00Z', attachments: [] } : null)
  });
  const out = JSON.parse(await t.execute('get_paper', { paperId: 'p1' }));
  assert.equal(out.lastReadAt, '2026-09-01T00:00:00Z');
});

/* ---------------- R3/R4：批注附件身份 + 页内续读 ---------------- */

test('R3: list_pdf_annotations 带 id/attachmentId、真实 total 与 nextOffset', async function () {
  const many = [];
  for (let i = 0; i < 120; i++) {
    many.push({ id: 'ann' + i, attachmentId: i < 60 ? 'attMain' : 'attSupp',
      type: 'highlight', color: '#ffd400', text: 't' + i, comment: '',
      position: { pageIndex: i % 10 } });
  }
  const t = LitAgent.createTools({
    desktop: {},
    getPapers: () => [],
    getPaperById: (id) => (id === 'p1' ? { id: 'p1', title: 'T', pdfAnnotations: many } : null)
  });
  const first = JSON.parse(await t.execute('list_pdf_annotations', { paperId: 'p1' }));
  assert.equal(first.total, 120, '总数如实，不是截断后的长度');
  assert.equal(first.count, 50);
  assert.equal(first.truncated, true);
  assert.equal(first.nextOffset, 50);
  assert.equal(first.annotations[0].attachmentId, 'attMain');
  assert.equal(first.annotations[0].id, 'ann0');
  const second = JSON.parse(await t.execute('list_pdf_annotations', { paperId: 'p1', offset: 60 }));
  assert.equal(second.annotations[0].id, 'ann60');
  assert.equal(second.annotations[0].attachmentId, 'attSupp', '补充材料的批注不再与主 PDF 混淆');
  const last = JSON.parse(await t.execute('list_pdf_annotations', { paperId: 'p1', offset: 100 }));
  assert.equal(last.truncated, false);
  assert.equal(last.nextOffset, null);
});

test('R4: 页内截断给出 fromChar 续读（同页码 + fromChar 拿到余下文字）', async function () {
  // db 层行为：fromChar 只作用于起始页；每页带 charOffset/charTotal
  const longPage = 'A'.repeat(9000);
  const range = await (function () {
    // 直接驱动纯逻辑太绕——这里用与 agenttools 相同的契约 mock 主进程返回
    return Promise.resolve({
      paperId: 'p1', attachmentId: 'att1', total: 2, from: 1, to: 1,
      pages: [{ page: 1, charOffset: 3500, charTotal: 9000, text: longPage.slice(3500, 3500 + 3500) + '…[截断]' }]
    });
  })();
  assert.equal(range.pages[0].charOffset, 3500);
  assert.equal(range.pages[0].charTotal, 9000);
  // 工具层：页内截断时 nextFromChar 指向「charOffset + 本次取到的长度」
  const t = LitAgent.createTools({
    desktop: {
      pdfSearchGetPageRange: async (input) => ({
        paperId: 'p1', attachmentId: 'att1', total: 3, from: input.from, to: input.to,
        pages: [{ page: input.from, charOffset: Number(input.fromChar) || 0, charTotal: 20000,
          text: 'B'.repeat(20000) }]
      })
    },
    getPapers: () => [],
    getPaperById: () => null
  });
  const out = JSON.parse(await t.execute('read_pdf_pages', { paperId: 'p1', from: 2, to: 2 }));
  assert.equal(out.truncated, true);
  assert.equal(out.nextFrom, 2);
  assert.equal(out.nextFromChar, 10000, '续读位置 = 起始偏移 + 本次取到的字符数（预算 10000）');
  assert.ok(out.coverageNote.indexOf('fromChar=10000') !== -1, '提示里给出续读用法');
  // 带 fromChar 续读：mock 回传偏移后的文本，工具如实转发
  const cont = JSON.parse(await t.execute('read_pdf_pages', { paperId: 'p1', from: 2, to: 2, fromChar: 10000 }));
  assert.equal(cont.pages[0].charOffset, 10000, 'fromChar 透传到 db 层（只作用于起始页）');
});

/* ---------------- R19：临时全文链（read_work_fulltext） ---------------- */

test('R19: read_work_fulltext 缓存路径直接给窗口，带续读游标', async function () {
  const t = LitAgent.createTools({
    desktop: {
      researchFulltextRead: async (input) => ({ cached: true, window: { workId: input.workId, charTotal: 25000, fromChar: input.fromChar || 0, text: 'B'.repeat(10000) } }),
      researchFulltextStore: async () => ({ stored: 0 })
    }
  });
  const out = JSON.parse(await t.execute('read_work_fulltext', { workId: 'W1' }));
  assert.equal(out.cached, true);
  assert.equal(out.charTotal, 25000);
  assert.equal(out.nextFromChar, 10000, '没读完给续读游标');
  assert.ok(out.note.indexOf('已缓存') !== -1);
});

test('R19: 首次拉取走 下载→渲染层抽取→存库删文件→回窗口；无 OA 链接如实报错', async function () {
  const calls = { store: null, extracted: null };
  const t = LitAgent.createTools({
    desktop: {
      researchFulltextRead: async (input) => input.workId === 'W1'
        ? { cached: false, tempPath: 'C:/tmp/fulltext/W1-x.pdf', workId: 'W1', title: 'T1' }
        : { cached: false, error: '该文献没有开放获取链接（oaUrl 为空），无法拉取全文' },
      researchFulltextStore: async (input) => {
        calls.store = input;
        return { stored: 19, window: { workId: input.workId, charTotal: 19, fromChar: 0, text: '【第 1 页】methods text' } };
      }
    },
    extractPdfText: async (tempPath) => { calls.extracted = tempPath; return '【第 1 页】methods text'; }
  });
  const fresh = JSON.parse(await t.execute('read_work_fulltext', { workId: 'W1' }));
  assert.equal(fresh.cached, false);
  assert.equal(fresh.title, 'T1');
  assert.equal(fresh.charTotal, 19);
  assert.equal(fresh.nextFromChar, null, '一次读完');
  assert.equal(calls.extracted, 'C:/tmp/fulltext/W1-x.pdf', '渲染层抽取用的是临时文件');
  assert.equal(calls.store.tempPath, 'C:/tmp/fulltext/W1-x.pdf', '存库时带上临时路径供主进程删除');
  assert.equal(calls.store.text, '【第 1 页】methods text');
  const noOa = JSON.parse(await t.execute('read_work_fulltext', { workId: 'W2' }));
  assert.ok(noOa.error.indexOf('开放获取') !== -1);
});

test('R19: 抽取失败也要回收临时文件（store 收到空文本）', async function () {
  let stored = null;
  const t = LitAgent.createTools({
    desktop: {
      researchFulltextRead: async () => ({ cached: false, tempPath: 'C:/tmp/fulltext/W3.pdf', workId: 'W3', title: '' }),
      researchFulltextStore: async (input) => { stored = input; return { stored: 0 }; }
    },
    extractPdfText: async () => null
  });
  const out = JSON.parse(await t.execute('read_work_fulltext', { workId: 'W3' }));
  assert.ok(out.error.indexOf('抽取失败') !== -1);
  assert.equal(stored.tempPath, 'C:/tmp/fulltext/W3.pdf', '失败路径仍调用 store 让主进程删临时文件');
  assert.equal(stored.text, '');
});

/* ---------------- A-followup #2/#6：附件索引身份 + 取消边界 ---------------- */

test('A-followup #2: read_pdf_pages 未命中时报出所问附件，且声明不会回退其它附件', async function () {
  const deps = makeDeps();
  deps.getPapers = () => [{ id: 'p1', title: 'T', attachments: [
    { id: 'att-main', kind: 'pdf', fileName: 'main.pdf' },
    { id: 'att-supp', kind: 'supp', fileName: 'supp.pdf' }
  ] }];
  deps.getPaperById = (id) => deps.getPapers().find((p) => p.id === id) || null;
  const calls = [];
  deps.desktop.pdfSearchGetPageRange = async (input) => {
    calls.push(input);
    // 主 PDF 有索引、补充材料没有（旧实现在这里会静默返回主 PDF 的正文）
    return input.attachmentId === 'att-main'
      ? { paperId: 'p1', attachmentId: 'att-main', total: 3, from: 1, to: 1, pages: [{ page: 1, text: 'MAIN' }] }
      : null;
  };
  const t = LitAgent.createTools(deps);
  const miss = await t.execute('read_pdf_pages', { paperId: 'p1', attachmentId: 'att-supp', from: 1, to: 1 });
  assert.equal(calls[0].attachmentId, 'att-supp', '请求的附件身份原样下传，不得改写');
  assert.ok(String(miss).indexOf('att-supp') !== -1, '错误里必须写明问的是哪份附件');
  assert.ok(String(miss).indexOf('不会退回') !== -1, '必须声明不会回退该文献其它附件');
  // 显式指定主 PDF 时照常读到内容
  const hit = JSON.parse(await t.execute('read_pdf_pages', { paperId: 'p1', attachmentId: 'att-main', from: 1, to: 1 }));
  assert.equal(hit.pages[0].text, 'MAIN');
});

test('A-followup #6: add_pdfs_to_folder 在暂存前后复核取消状态', async function () {
  const deps = makeDeps();
  let staged = 0;
  let imported = 0;
  deps.desktop.researchStagePdfs = async () => { staged++; return { results: [{ workId: 'W1', fileName: 'a.pdf', path: '/managed/a.pdf' }] }; };
  deps.importStagedPdfs = async () => { imported++; return { added: 1, merged: 0 }; };
  const t = LitAgent.createTools(deps);

  // ① 进入工具前已取消：不发起暂存
  let out = await t.execute('add_pdfs_to_folder', { files: [{ file: 'a.pdf', workId: 'W1' }] }, {
    sessionId: 's1', cancelRequested: () => true
  });
  assert.ok(String(out).indexOf('已停止') !== -1);
  assert.equal(staged, 0);

  // ② 暂存期间被取消（下载/复制是长异步）：不得进入导入
  let stopped = false;
  deps.desktop.researchStagePdfs = async () => {
    staged++;
    stopped = true; // 暂存返回前用户点了停止
    return { results: [{ workId: 'W1', fileName: 'a.pdf', path: '/managed/a.pdf' }] };
  };
  out = await t.execute('add_pdfs_to_folder', { files: [{ file: 'a.pdf', workId: 'W1' }] }, {
    sessionId: 's1', cancelRequested: () => stopped
  });
  assert.ok(String(out).indexOf('已停止') !== -1);
  assert.equal(imported, 0, '暂存后被取消不得调用导入');

  // ③ 确认框挂着时被取消：取消信号透传给渲染层，由它在写库前复核
  let confirmStopped = false;
  let passedOpts = null;
  deps.desktop.researchStagePdfs = async () => { staged++; return { results: [{ workId: 'W1', fileName: 'a.pdf', path: '/managed/a.pdf' }] }; };
  deps.importStagedPdfs = async (_ok, _folder, opts) => {
    imported++;
    passedOpts = opts;
    return { canceled: true, stopped: true, added: 0, merged: 0 };
  };
  out = await t.execute('add_pdfs_to_folder', { files: [{ file: 'a.pdf', workId: 'W1' }] }, {
    sessionId: 's1', cancelRequested: () => confirmStopped
  });
  assert.equal(typeof passedOpts.isCancelled, 'function', 'isCancelled 必须交给渲染层');
  assert.ok(String(out).indexOf('已停止') !== -1, 'stopped 与「用户取消」要分开如实回报');
  assert.equal(imported, 1);
});

test('A-followup #6: collect_papers 同样在确认边界复核取消', async function () {
  const deps = makeDeps({ includeWrite: true });
  let passedOpts = null;
  deps.collectWorks = async (_ids, _folder, opts) => { passedOpts = opts; return { canceled: true, stopped: true, added: 0, merged: 0 }; };
  const t = LitAgent.createTools(deps);
  const out = await t.execute('collect_papers', { workIds: ['W1'] }, { sessionId: 's1', cancelRequested: () => false });
  assert.equal(typeof passedOpts.isCancelled, 'function');
  assert.ok(String(out).indexOf('已停止') !== -1);
  // 进入前已取消：不调用收藏桥
  let called = 0;
  deps.collectWorks = async () => { called++; return { added: 1, merged: 0 }; };
  const out2 = await t.execute('collect_papers', { workIds: ['W1'] }, { sessionId: 's1', cancelRequested: () => true });
  assert.ok(String(out2).indexOf('已停止') !== -1);
  assert.equal(called, 0);
});


test('reference file search feeds precise read cursors and restores real reading coverage', async () => {
  const text = 'intro\nneedle evidence\nend', file = '附件/report.pdf';
  const desktop = {
    sessionListReferences: async () => ({ files: [{ file, kind: 'pdf' }] }),
    sessionReadReference: async () => ({ status: 'requires_pdf_extraction', path: 'registered.pdf' }),
    sessionSearchReference: async () => ({ status: 'requires_pdf_extraction', path: 'registered.pdf' })
  };
  let extracted = 0;
  const tools = LitAgent.createTools({ desktop, extractPdfText: async () => { extracted++; return text; } });
  const ctx = { sessionId: 's', messages: [] };
  const hits = JSON.parse(await tools.execute('search_session_file', { file, query: 'needle' }, ctx));
  assert.equal(hits.matches[0].matchOffset, 6); assert.equal(hits.coverage.readChars, 0);
  const read = JSON.parse(await tools.execute('read_session_file', { file, fromChar: hits.matches[0].matchOffset }, ctx));
  ctx.messages.push({ role: 'tool', name: 'read_session_file', content: JSON.stringify(read), compacted: true });
  const list = JSON.parse(await tools.execute('list_session_files', {}, ctx));
  assert.equal(list.files[0].coverage.readChars, text.length - 6); assert.equal(list.files[0].coverage.textComplete, false); assert.equal(extracted, 1);
});

test('uploaded PDF visual reading gates frozen vision and attaches only successful physical pages', async () => {
  const saved = [], file = '附件/scanned.pdf';
  const tools = LitAgent.createTools({ includeVisionRender: true, renderPageImage: async () => null,
    renderPagesImage: async input => { assert.deepEqual(input.pages, [1, 3, 4]); return [{ page: 1, dataUrl: 'data:image/png;base64,YQ==' }, { page: 3, error: 'bad page' }]; },
    desktop: { sessionReadReference: async () => ({ status: 'requires_pdf_extraction', path: 'registered.pdf' }), sessionSaveAttachment: async (_id, data) => { saved.push(data); return { file: '附件/page1.png' }; } } });
  assert.ok(tools.tools.some(t => t.function.name === 'render_session_pdf_pages'));
  const args = { file, pages: [1, 3, 4, 5] };
  assert.match(await tools.execute('render_session_pdf_pages', args, { sessionId: 's', vision: false }), /不支持图片/);
  const result = await tools.execute('render_session_pdf_pages', args, { sessionId: 's', vision: true });
  assert.deepEqual(JSON.parse(result.text).renderedPages, [1]); assert.equal(result.images[0].ref, 'session:s|附件/page1.png'); assert.equal(saved.length, 1);
});


test('reference lists and escape-heavy search preserve valid JSON and continuation under tool caps', async () => {
  const FileContext = require('../js/agentfilecontext.js');
  const files = Array.from({ length: 80 }, (_, i) => ({ file: '附件/' + i + '-'.repeat(180) + '.txt', name: 'file', kind: 'text' }));
  const text = ('"\\\n'.repeat(100) + 'needle').repeat(12);
  const tools = LitAgent.createTools({ desktop: { sessionListReferences: async () => ({ files }), sessionSearchReference: async (_id, file, query, opts) => Object.assign({ file, status: 'ready' }, FileContext.searchTextWindows(text, query, opts)) } });
  const list = JSON.parse(await tools.execute('list_session_files', {}, { sessionId: 's' }));
  assert.ok(list.nextFromIndex > 0 && list.nextFromIndex < files.length); assert.ok(JSON.stringify(list).length < 12000);
  const first = JSON.parse(await tools.execute('search_session_file', { file: '附件/f.txt', query: 'needle', limit: 10 }, { sessionId: 's' }));
  assert.ok(JSON.stringify(first).length < 12000); assert.ok(first.nextOffset > 0);
  const next = JSON.parse(await tools.execute('search_session_file', { file: '附件/f.txt', query: 'needle', fromChar: first.nextOffset, limit: 10 }, { sessionId: 's' }));
  assert.equal(next.matches[0].matchOffset, first.nextOffset);
});


test('plan tool verifies actual successful execution and registered artifacts before completion', async () => {
  const tools = LitAgent.createTools({ desktop: { sessionListReferences: async () => ({ files: [{ file: '附件/result.md' }] }) } });
  const messages = [{ role: 'assistant', tool_calls: [{ id: 'read-ok', function: { name: 'search_library' } }] }, { role: 'tool', name: 'search_library', tool_call_id: 'read-ok', content: '{"papers":[]}' }];
  const plan = { goal: 'review', steps: [{ id: 'find', content: 'find source', status: 'completed', evidenceCallIds: ['read-ok'] }, { id: 'report', content: 'write report', status: 'in_progress', dependsOn: ['find'] }] };
  const saved = JSON.parse(await tools.execute('update_research_plan', plan, { sessionId: 's', messages }));
  assert.equal(saved.steps[0].id, 'find');
  await assert.rejects(tools.execute('update_research_plan', { goal: 'review', steps: [{ content: 'claim done', status: 'completed' }] }, { messages }), /需要成功工具证据/);
  await assert.rejects(tools.execute('update_research_plan', { goal: 'review', steps: [{ content: 'claim done', status: 'completed', artifacts: ['附件/missing.md'] }] }, { sessionId: 's', messages }), /尚未登记/);
  assert.equal(LitAgent.isParallelTool('search_library'), true); assert.equal(LitAgent.isParallelTool('search_openalex'), false); assert.equal(LitAgent.isParallelTool('collect_papers'), false);
});
