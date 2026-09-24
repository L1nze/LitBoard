'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLibraryDb } = require('../electron/db.js');
const fsSync = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

async function tempDb(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-db-'));
  const db = createLibraryDb(dir);
  await db.open();
  t.after(async function () {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return db;
}

test('db save/load round-trips a normalized workspace', async function (t) {
  const db = await tempDb(t);
  await db.saveState({
    papers: [
      { id: 'p1', title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], year: 2017,
        doi: '10.48550/arXiv.1706.03762', tags: ['transformer'], pdfPath: 'D:\\pdfs\\a.pdf',
        pdfAnnotations: [{ id: 'a1', type: 'highlight', color: '#ffd400', text: 'q', comment: '',
          position: { pageIndex: 0, rects: [[10, 10, 60, 25]] }, createdAt: 1, updatedAt: 1 }] },
      { id: 'p2', title: 'Second', status: 'read', rating: 4, deletedAt: 1234567890000 }
    ],
    folders: [{ id: 'f1', name: 'NLP' }],
    savedSearches: [{ id: 's1', name: '近年', query: 'year>=2020' }],
    tagColors: { transformer: '#5aa9ff' }
  });
  const state = await db.loadState();
  assert.equal(state.papers.length, 2);
  const p1 = state.papers.find(function (p) { return p.id === 'p1'; });
  assert.equal(p1.title, 'Attention Is All You Need');
  assert.deepEqual(p1.authors, ['Vaswani, Ashish']);
  assert.deepEqual(p1.tags, ['transformer']);
  assert.equal(p1.attachments.length, 1);
  assert.equal(p1.attachments[0].kind, 'pdf');
  assert.equal(p1.pdfAnnotations.length, 1);
  const p2 = state.papers.find(function (p) { return p.id === 'p2'; });
  assert.equal(p2.deletedAt, 1234567890000); // 墓碑保留
  assert.equal(state.folders[0].name, 'NLP');
  assert.equal(state.savedSearches[0].query, 'year>=2020');
  assert.deepEqual(state.tagColors, { transformer: '#5aa9ff' });
});

test('db incremental save only rewrites changed rows', async function (t) {
  const db = await tempDb(t);
  const base = {
    papers: [
      { id: 'p1', title: 'One' },
      { id: 'p2', title: 'Two' },
      { id: 'p3', title: 'Three' }
    ],
    folders: [{ id: 'f1', name: 'A' }]
  };
  const first = await db.saveState(base);
  assert.equal(first.papersWritten, 3);
  const second = await db.saveState(base);
  assert.equal(second.papersWritten, 0); // 内容未变：零写入
  base.papers[1].notes = 'user note';
  const third = await db.saveState(base);
  assert.equal(third.papersWritten, 1); // 只写脏行
  assert.equal(third.foldersWritten, 0);
  // 普通保存从 payload 移除条目不再硬删（删除一律走墓碑）：
  base.papers.splice(0, 1);
  const fourth = await db.saveState(base);
  assert.equal(fourth.papersDeleted, 0);
  let state = await db.loadState();
  assert.equal(state.papers.length, 3);
  // 显式整库替换（library:replace 语义）才允许硬删：
  const replaced = await db.replaceState({ papers: base.papers, folders: base.folders });
  assert.equal(replaced.papersDeleted, 1);
  state = await db.loadState();
  assert.equal(state.papers.length, 2);
});

test('db baseSignatures protocol preserves extension-written changes', async function (t) {
  const db = await tempDb(t);
  const LitModel = require('../js/model.js');
  await db.saveState({ papers: [{ id: 'p1', title: 'One' }] });
  const baseState = await db.loadState();
  const baseSignatures = LitModel.workspaceSignatures(baseState);
  // 扩展直接写入新文献（绕过渲染层）
  const ext = await db.bridgeUpsertPaper({ title: 'Extension Paper', doi: '10.1000/ext-1' });
  assert.equal(ext.duplicated, false);
  // 旧界面保存：payload 只有 p1（本地未改，内容即 loadState 确认版），baseSignatures 为确认时的签名
  const saved = await db.saveState({
    papers: [baseState.papers[0]],
    baseSignatures: baseSignatures
  });
  assert.equal(saved.papersWritten, 0);
  assert.equal(saved.conflicts.length, 0);
  const state = await db.loadState();
  assert.equal(state.papers.length, 2); // 扩展新增的文献不被删除
  assert.ok(state.papers.some(function (p) { return p.title === 'Extension Paper'; }));
});

test('db baseSignatures protocol reports concurrent edits as conflicts', async function (t) {
  const db = await tempDb(t);
  const LitModel = require('../js/model.js');
  await db.saveState({ papers: [{ id: 'p1', title: 'One' }] });
  const baseState = await db.loadState();
  const baseSignatures = LitModel.workspaceSignatures(baseState);
  // 外部写入：改 notes（无 baseSignatures 的保存 = 外部直接写入）
  await db.saveState({ papers: [Object.assign({}, baseState.papers[0], { notes: 'external note' })] });
  // 本地同时修改 title
  const saved = await db.saveState({
    papers: [LitModel.normalizePaper(Object.assign({}, baseState.papers[0], { title: 'Local Title', notes: '' }))],
    baseSignatures: baseSignatures
  });
  assert.equal(saved.papersWritten, 0);
  assert.equal(saved.conflicts.length, 1);
  assert.equal(saved.conflicts[0].id, 'p1');
  assert.equal(saved.conflicts[0].collection, 'papers');
  assert.equal(saved.conflicts[0].entity.notes, 'external note');
  // 以返回的库签名作为新 base 重提合并结果 → 无冲突写入
  const resubmit = await db.saveState({
    papers: [LitModel.normalizePaper(Object.assign({}, saved.conflicts[0].entity, { title: 'Local Title' }))],
    baseSignatures: saved.signatures
  });
  assert.equal(resubmit.conflicts.length, 0);
  const state = await db.loadState();
  assert.equal(state.papers[0].title, 'Local Title');
  assert.equal(state.papers[0].notes, 'external note');
});

test('db replaceState supports explicit full-library replace', async function (t) {
  const db = await tempDb(t);
  await db.saveState({ papers: [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }] });
  const stats = await db.replaceState({ papers: [{ id: 'p9', title: 'Restored' }] });
  assert.equal(stats.papersDeleted, 2);
  const state = await db.loadState();
  assert.equal(state.papers.length, 1);
  assert.equal(state.papers[0].title, 'Restored');
});

// 回归：渲染层 applySyncedWorkspace 曾把「新工作区自身的签名」当 base 提交，
// 导致每个条目都被判为「本地未改」而跳过写入（同步落库 / Zotero 导入静默丢失）。
// 这里的契约：base 必须是应用前数据库已确认内容的签名。
test('db save persists sync-applied content when base is the pre-apply confirmed state', async function (t) {
  const db = await tempDb(t);
  const LitModel = require('../js/model.js');
  await db.saveState({ papers: [{ id: 'p-old', title: 'Old' }] });
  const confirmed = await db.loadState();
  const sigsBeforeApply = LitModel.workspaceSignatures(confirmed);
  const applied = LitModel.normalizeWorkspace({
    papers: [confirmed.papers[0], { id: 'p-new', title: 'From Remote', zoteroKey: 'K1' }]
  });
  const saved = await db.saveState(Object.assign({}, applied, { baseSignatures: sigsBeforeApply }));
  assert.equal(saved.papersWritten, 1, '只有真正新增的 p-new 应写入，p-old 未变跳过');
  const state = await db.loadState();
  assert.equal(state.papers.length, 2);
});

test('db save with base equal to incoming signatures skips everything (hazard contract)', async function (t) {
  const db = await tempDb(t);
  const LitModel = require('../js/model.js');
  const applied = LitModel.normalizeWorkspace({ papers: [{ id: 'p1', title: 'One' }] });
  const selfSigs = LitModel.workspaceSignatures(applied);
  const saved = await db.saveState(Object.assign({}, applied, { baseSignatures: selfSigs }));
  assert.equal(saved.papersWritten, 0, 'base=incoming 必然全 skip——渲染层不得这样调用');
  assert.equal((await db.loadState()).papers.length, 0);
});

test('db preserves entity timestamps supplied by the sync layer', async function (t) {
  const db = await tempDb(t);
  await db.saveState({
    papers: [{ id: 'p1', title: 'Remote Paper', updatedAt: 100 }],
    folders: [{ id: 'f1', name: 'Remote Folder', updatedAt: 200 }]
  });
  const state = await db.loadState();
  assert.equal(state.papers[0].updatedAt, 100);
  assert.equal(state.folders[0].updatedAt, 200);
});

test('db permits attachment and annotation ids to repeat across papers', async function (t) {
  const db = await tempDb(t);
  const annotation = {
    id: 'shared', type: 'highlight', color: '#ffd400', text: 'q', comment: '',
    position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, createdAt: 1, updatedAt: 1
  };
  await db.saveState({
    papers: [
      { id: 'p1', title: 'One', attachments: [{ id: 'shared', kind: 'pdf', fileName: 'one.pdf', path: 'D:\\one.pdf' }],
        pdfAnnotations: [annotation] },
      { id: 'p2', title: 'Two', attachments: [{ id: 'shared', kind: 'pdf', fileName: 'two.pdf', path: 'D:\\two.pdf' }],
        pdfAnnotations: [annotation] }
    ]
  });
  const state = await db.loadState();
  assert.equal(state.papers.length, 2);
  assert.equal(state.papers[0].attachments[0].id, 'shared');
  assert.equal(state.papers[1].attachments[0].id, 'shared');
  assert.equal(state.papers[0].pdfAnnotations[0].id, 'shared');
  assert.equal(state.papers[1].pdfAnnotations[0].id, 'shared');
});

test('db settings round-trip', async function (t) {
  const db = await tempDb(t);
  assert.equal(await db.getSetting('readpos:p1'), null);
  await db.setSetting('readpos:p1', { page: 12, scale: 1.5 });
  assert.deepEqual(await db.getSetting('readpos:p1'), { page: 12, scale: 1.5 });
});

test('db full-text index supports latin, CJK and short queries', async function (t) {
  const db = await tempDb(t);
  await db.pdfTextPut({
    paperId: 'p1', fingerprint: 'fp1',
    pages: ['Attention is all you need. Transformer architecture.', '第二页讨论深度学习与神经网络。']
  });
  await db.pdfTextPut({ paperId: 'p2', fingerprint: 'fp2', pages: ['Nothing relevant here.'] });
  // 拉丁子串（非整词）
  let hits = await db.pdfTextQuery('ransform');
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].pages, [0]);
  assert.ok(hits[0].snippets[0].text.includes('⟪'));
  // 中文 ≥3 字（trigram 路径）
  hits = await db.pdfTextQuery('神经网络');
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].pages, [1]);
  // 中文 2 字（LIKE 回退路径）
  hits = await db.pdfTextQuery('深度');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].paperId, 'p1');
  // 无命中
  hits = await db.pdfTextQuery('quantum');
  assert.equal(hits.length, 0);
  // meta / invalidate / stats / clear
  const meta = await db.pdfTextMeta();
  assert.equal(Object.keys(meta).length, 2);
  assert.equal(meta.p1.fingerprint, 'fp1');
  const stats = await db.pdfTextStats();
  assert.equal(stats.entries, 2);
  await db.pdfTextInvalidate('p1');
  hits = await db.pdfTextQuery('ransform');
  assert.equal(hits.length, 0);
  await db.pdfTextClear();
  assert.equal((await db.pdfTextStats()).entries, 0);
  // 清空走的是 DROP + 重建（DELETE 不回收 FTS5 空间），所以要确认索引表仍然可用
  await db.pdfTextPut({ paperId: 'p9', fingerprint: 'fp9', method: 'pdfjs', pages: ['after clear zebra text'] });
  hits = await db.pdfTextQuery('zebra');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].paperId, 'p9');
});

test('db full-text query reports truncation only when the 2000-page cap is exceeded', async function (t) {
  const db = await tempDb(t);
  for (let i = 0; i < 6; i++) {
    await db.pdfTextPut({
      paperId: 'cap' + i, attachmentId: 'pdf' + i, fingerprint: 'f' + i,
      pages: Array(400).fill('distinctive capquery phrase')
    });
  }
  const limited = await db.pdfTextQuery('capquery');
  assert.equal(limited.reduce(function (sum, hit) { return sum + hit.count; }, 0), 2000);
  assert.equal(limited.every(function (hit) { return hit.truncated === true; }), true);
  const oneAttachment = await db.pdfTextQuery('capquery', 'pdf0');
  assert.equal(oneAttachment.length, 1);
  assert.equal(oneAttachment[0].count, 400);
  assert.equal(oneAttachment[0].truncated, false);
});

test('db text replacement updates the index', async function (t) {
  const db = await tempDb(t);
  await db.pdfTextPut({ paperId: 'p1', fingerprint: 'a', pages: ['old content alpha'] });
  await db.pdfTextPut({ paperId: 'p1', fingerprint: 'b', pages: ['new content beta'] });
  assert.equal((await db.pdfTextQuery('alpha')).length, 0);
  assert.equal((await db.pdfTextQuery('beta')).length, 1);
  assert.equal((await db.pdfTextMeta()).p1.fingerprint, 'b');
});

test('db reports corruption without deleting anything and never opens an empty db', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-db-corrupt-'));
  const dbs = [];
  t.after(async function () {
    for (const handle of dbs) await handle.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const db = createLibraryDb(dir);
  dbs.push(db);
  await db.open();
  await db.saveState({ papers: [{ id: 'p1', title: 'Precious', notes: 'keep me' }] });
  await db.close();
  // 制造并行的 WAL/SHM 残留（模拟崩溃现场），再写坏主文件
  await fs.writeFile(db.paths.file + '-wal', 'FAKE WAL CONTENT', 'utf8');
  await fs.writeFile(db.paths.file + '-shm', 'FAKE SHM CONTENT', 'utf8');
  const broken = 'this is not a sqlite database at all'.repeat(50);
  await fs.writeFile(db.paths.file, broken, 'utf8');
  // 打开必须失败并标记损坏，且绝不删除/覆盖任何数据文件、绝不创建空库
  const db2 = createLibraryDb(dir);
  dbs.push(db2);
  await assert.rejects(db2.open(), function (error) {
    assert.equal(error.code, 'LITBOARD_DB_CORRUPT');
    return true;
  });
  assert.equal(await fs.readFile(db.paths.file, 'utf8'), broken);            // 主库原样
  assert.equal(await fs.readFile(db.paths.file + '-wal', 'utf8'), 'FAKE WAL CONTENT'); // WAL 原样
  // SHM 是 SQLite 管理的共享内存缓存，打开时允许其重建（持久数据不在其中），但必须仍然存在
  const shmStat = await fs.stat(db.paths.file + '-shm');
  assert.ok(shmStat.isFile());
});

test('db refuses to open when the main file is missing but WAL remains', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-db-wal-only-'));
  const dbs = [];
  t.after(async function () {
    for (const handle of dbs) await handle.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const db = createLibraryDb(dir);
  dbs.push(db);
  await fs.writeFile(path.join(dir, 'litboard.sqlite-wal'), 'orphan wal', 'utf8');
  await assert.rejects(db.open(), function (error) {
    assert.equal(error.code, 'LITBOARD_DB_CORRUPT');
    return true;
  });
  assert.equal(await fs.readFile(path.join(dir, 'litboard.sqlite-wal'), 'utf8'), 'orphan wal');
});

test('db treats unparseable papers.data as corruption instead of filtering it out', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-db-baddata-'));
  const dbs = [];
  t.after(async function () {
    for (const handle of dbs) await handle.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const db = createLibraryDb(dir);
  dbs.push(db);
  await db.open();
  await db.saveState({ papers: [{ id: 'p1', title: 'Fine' }] });
  // 直接把某行 data 写坏
  const d = new (require('node:sqlite').DatabaseSync)(db.paths.file);
  d.exec("UPDATE papers SET data = '{broken json' WHERE id = 'p1'");
  d.close();
  // loadState 为同步函数：用 assert.throws 验证损坏即失败
  assert.throws(function () { db.loadState(); }, function (error) {
    assert.equal(error.code, 'LITBOARD_DB_CORRUPT');
    return true;
  });
});

test('hard-deleting a paper purges its full-text index rows', async function (t) {
  const db = await tempDb(t);
  await db.saveState({ papers: [{ id: 'p1', title: 'Gone' }] });
  await db.pdfTextPut({ paperId: 'p1', fingerprint: 'fp1', method: 'pdfjs', pages: ['orphan full text ABC'] });
  assert.equal(db.pdfTextStats().entries, 1);
  assert.equal((await db.pdfTextQuery('orphan full text')).length, 1);

  // 整库替换 = 硬删除（payload 里没有的条目被真正移除）
  await db.replaceState({ papers: [] });

  assert.equal((await db.loadState()).papers.length, 0);
  assert.equal(db.pdfTextStats().entries, 0, 'pdf_text 不应留下孤儿行');
  assert.equal((await db.pdfTextQuery('orphan full text')).length, 0, '已删除的文献不应还能被搜到');
});

/* ---------- DB v4：迁移前备份 + notes 表 + 批注附件关联 ---------- */

test('db save/load round-trips notes and skips unchanged notes', async function (t) {
  const db = await tempDb(t);
  const first = await db.saveState({
    papers: [{ id: 'p1', title: 'T' }],
    notes: [
      { id: 'n1', paperId: 'p1', content: 'hello', createdAt: 1, updatedAt: 1 },
      { id: 'n2', paperId: '', title: '主题', content: 'topic', createdAt: 2, updatedAt: 2 }
    ]
  });
  assert.equal(first.notesWritten, 2);
  const state = await db.loadState();
  assert.equal(state.notes.length, 2);
  const n1 = state.notes.find(function (n) { return n.id === 'n1'; });
  assert.equal(n1.content, 'hello');
  assert.equal(n1.paperId, 'p1');
  // 内容未变 + base 已确认 → 幂等跳过
  const second = await db.saveState({
    papers: state.papers, notes: state.notes, folders: state.folders,
    savedSearches: state.savedSearches, tagColorRecords: state.tagColorRecords,
    baseSignatures: first.signatures
  });
  assert.equal(second.notesWritten, 0);
  assert.equal(second.papersWritten, 0);
  // 修改内容 → 只写脏行
  n1.content = 'edited';
  const third = await db.saveState({
    papers: state.papers, notes: state.notes, folders: state.folders,
    savedSearches: state.savedSearches, tagColorRecords: state.tagColorRecords,
    baseSignatures: second.signatures
  });
  assert.equal(third.notesWritten, 1);
  const reloaded = await db.loadState();
  assert.equal(reloaded.notes.find(function (n) { return n.id === 'n1'; }).content, 'edited');
});

test('replaceState hard-deletes notes of removed papers but keeps standalone notes', async function (t) {
  const db = await tempDb(t);
  await db.saveState({
    papers: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B' }],
    notes: [
      { id: 'n1', paperId: 'p1', content: 'a' },
      { id: 'n9', paperId: '', title: '主题', content: 'topic' }
    ]
  });
  await db.replaceState({
    papers: [{ id: 'p2', title: 'B' }],
    notes: [{ id: 'n9', paperId: '', title: '主题', content: 'topic' }]
  });
  const state = await db.loadState();
  assert.equal(state.papers.length, 1);
  assert.deepEqual(state.notes.map(function (n) { return n.id; }), ['n9']);
});

test('db migrates v3 to v4 with a pre-migration backup and preserves data', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-db-v3-'));
  const file = path.join(dir, 'litboard.sqlite');
  // 手工构造 v3 形态的库（v3 复合主键、annotations 无 attachment_id、无 notes 表）
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE papers(id TEXT PRIMARY KEY, citekey TEXT, entry_type TEXT, title TEXT, year INTEGER,
      venue TEXT, doi TEXT, citations INTEGER, rating INTEGER, status TEXT,
      added_at INTEGER, updated_at INTEGER, deleted_at INTEGER, hash TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE authors(paper_id TEXT NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY(paper_id, ord));
    CREATE TABLE tags(paper_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(paper_id, tag));
    CREATE TABLE tag_colors(tag TEXT PRIMARY KEY, color TEXT NOT NULL, updated_at INTEGER, deleted_at INTEGER);
    CREATE TABLE folders(id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
      sort_index INTEGER, updated_at INTEGER, deleted_at INTEGER, hash TEXT NOT NULL);
    CREATE TABLE folder_items(paper_id TEXT NOT NULL, folder_id TEXT NOT NULL, PRIMARY KEY(paper_id, folder_id));
    CREATE TABLE attachments(paper_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT,
      file_name TEXT, path TEXT, fingerprint TEXT, cloud_name TEXT,
      sync_signature TEXT, added_at INTEGER, PRIMARY KEY(paper_id, id));
    CREATE TABLE annotations(paper_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT, color TEXT,
      page_index INTEGER, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(paper_id, id));
    CREATE TABLE saved_searches(id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL,
      sort_index INTEGER, updated_at INTEGER, deleted_at INTEGER);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE pdf_text(paper_id TEXT PRIMARY KEY, fingerprint TEXT, method TEXT, pages TEXT, updated_at INTEGER);
    CREATE VIRTUAL TABLE pdf_fts USING fts5(paper_id UNINDEXED, page UNINDEXED, text, tokenize='trigram');
    CREATE TABLE paper_vec(paper_id TEXT PRIMARY KEY, model TEXT, dim INTEGER, vec BLOB, updated_at INTEGER);
    INSERT INTO paper_vec(paper_id, model, dim, vec, updated_at) VALUES ('p1', 'legacy-embed', 1, X'0000803F', 1);
    INSERT INTO papers(id, title, hash, data) VALUES
      ('p1', 'Legacy', 'h1', '{"id":"p1","title":"Legacy","authors":["Jane Doe"],"notes":"旧笔记","pdfAnnotations":[{"id":"a1","type":"highlight","position":{"pageIndex":0,"rects":[[0,0,1,1]]}}]}');
    INSERT INTO annotations(paper_id, id, type, page_index) VALUES ('p1', 'a1', 'highlight', 0);
    PRAGMA user_version = 3;
  `);
  raw.close();

  const db = createLibraryDb(dir);
  await db.open();
  t.after(async function () {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  assert.ok(fsSync.existsSync(file + '.pre-v4.bak')); // 迁移前备份已生成
  assert.ok(fsSync.existsSync(file + '.pre-v7.bak')); // v7（删 paper_vec）也留了备份
  const state = await db.loadState();
  assert.equal(state.papers.length, 1);
  assert.equal(state.papers[0].title, 'Legacy');
  assert.equal(state.notes.length, 1); // 旧 notes 字段迁移为 Note 实体
  assert.equal(state.notes[0].content, '旧笔记');
  assert.equal(state.notes[0].paperId, 'p1');
  assert.equal(state.papers[0].pdfAnnotations[0].attachmentId, ''); // 无附件：留空保留
  // 迁移后的库可正常读写（annotations 表已有 attachment_id 列）
  await db.saveState({
    papers: state.papers, notes: state.notes, folders: [], savedSearches: [], tagColorRecords: [],
    baseSignatures: null
  });
  const probe = new DatabaseSync(file, { readOnly: true });
  const version = probe.prepare('PRAGMA user_version').get();
  const paperVec = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paper_vec'").get();
  probe.close();
  assert.equal(Object.values(version)[0], 8);
  assert.equal(paperVec, undefined, 'v7 应把正式库语义索引表（paper_vec）删掉');
});

test('hashEntity excludes lastReadAt so reading alone never dirties the paper row', async function (t) {
  const db = await tempDb(t);
  const first = await db.saveState({ papers: [{ id: 'p1', title: 'T' }] });
  assert.equal(first.papersWritten, 1);
  // 仅阅读（lastReadAt 变化）→ 不脏；配合 db.recordReadAt 轻量落盘
  const paper = (await db.loadState()).papers[0];
  paper.lastReadAt = Date.now();
  await db.recordReadAt('p1', paper.lastReadAt);
  const second = await db.saveState({
    papers: [paper], notes: [], folders: [], savedSearches: [], tagColorRecords: [],
    baseSignatures: first.signatures
  });
  assert.equal(second.papersWritten, 0);
  // 但 recordReadAt 已把 lastReadAt 写进库（最近阅读视图可用）
  const reloaded = (await db.loadState()).papers[0];
  assert.equal(Number(reloaded.lastReadAt), Number(paper.lastReadAt));
  assert.equal(second.conflicts.length, 0);
});

test('pdf text index isolates attachments and invalidates one attachment only', async function (t) {
  const db = await tempDb(t);
  await db.pdfTextPut({ paperId: 'p1', attachmentId: 'a1', fingerprint: 'fp-a', pages: ['alpha text'] });
  await db.pdfTextPut({ paperId: 'p1', attachmentId: 'a2', fingerprint: 'fp-b', pages: ['beta text'] });
  const alpha = await db.pdfTextQuery('alpha');
  const beta = await db.pdfTextQuery('beta');
  assert.deepEqual(alpha.map(function (hit) { return hit.attachmentId; }), ['a1']);
  assert.deepEqual(beta.map(function (hit) { return hit.attachmentId; }), ['a2']);
  assert.equal((await db.pdfTextQuery('beta', 'a1')).length, 0);
  assert.ok((await db.pdfTextMeta())['p1:a2']);
  await db.pdfTextInvalidate('p1', 'a1');
  assert.equal((await db.pdfTextQuery('alpha')).length, 0);
  assert.equal((await db.pdfTextQuery('beta')).length, 1);
});

// ---------- 阶段三回归网：签名缓存快路径 + pdf_text 压缩 ----------

const LitModel = require('../js/model.js');
const zlib = require('node:zlib');

test('saveState signatures match loadState recomputation and unchanged resubmission is a full skip', async function (t) {
  const db = await tempDb(t);
  const workspace = {
    papers: [
      { id: 'p1', title: 'Canary', authors: ['Ada Lovelace'], year: 1843, tags: ['x'],
        folderIds: ['f1'],
        pdfAnnotations: [{ id: 'an1', type: 'highlight', color: '#ffd400', text: 'q', comment: '',
          position: { pageIndex: 0, rects: [[1, 1, 9, 9]] }, createdAt: 5, updatedAt: 5 }] },
      { id: 'p2', title: 'Other' }
    ],
    notes: [{ id: 'n1', paperId: 'p1', title: 'Note', content: 'c', format: 'markdown', createdAt: 3, updatedAt: 3 }],
    folders: [{ id: 'f1', name: 'F' }],
    savedSearches: [{ id: 's1', name: 'S', query: 'year>=1800' }],
    tagColorRecords: [{ tag: 'x', color: '#ffffff', updatedAt: 1 }]
  };
  const first = await db.saveState(workspace);
  assert.equal(first.papersWritten, 2);
  assert.equal(first.notesWritten, 1);

  // 返回的签名表必须与 loadState 全量重算逐实体一致（渲染层 persistedWorkspaceSignatures 的锚点）
  const sigs = LitModel.workspaceSignatures(await db.loadState());
  for (const collection of ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords']) {
    assert.deepEqual(first.signatures[collection], sigs[collection], collection + ' 签名应与全量重算一致');
  }

  // 以返回签名为 base 重提同一工作区：走缓存快路径，必须全部 skip 且零冲突
  const again = await db.saveState(Object.assign({}, workspace, { baseSignatures: first.signatures }));
  assert.equal(again.papersWritten, 0);
  assert.equal(again.notesWritten, 0);
  assert.equal(again.foldersWritten, 0);
  assert.equal(again.searchesWritten, 0);
  assert.equal(again.tagColorsWritten, 0);
  assert.equal(again.conflicts.length, 0);
});

test('bridge writes invalidate the signature cache so concurrent edits become conflicts', async function (t) {
  const db = await tempDb(t);
  const first = await db.saveState({ papers: [{ id: 'p1', title: 'Base', doi: '10.1/x' }] });
  assert.equal(first.papersWritten, 1);

  // 扩展桥接在渲染层不知情时改了库（绕过 saveState，必须让签名缓存失效）
  const bridged = await db.bridgeUpsertPaper({ doi: '10.1/x', venue: 'Bridged Venue' });
  assert.equal(bridged.duplicated, true);

  // 渲染层带旧 base、同时改了同一篇：必须判冲突（若缓存未失效会误判「库未变」直接覆盖）
  const result = await db.saveState({
    papers: [{ id: 'p1', title: 'Local Edit', doi: '10.1/x' }],
    notes: [], folders: [], savedSearches: [], tagColorRecords: [],
    baseSignatures: first.signatures
  });
  assert.equal(result.papersWritten, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].collection, 'papers');
  assert.equal(result.conflicts[0].entity.title, 'Base');
  assert.equal(result.conflicts[0].entity.venue, 'Bridged Venue'); // 随冲突返回库内当前版本

  // 冲突解决后重提（新 base）恢复正常写入
  const resolved = await db.saveState({
    papers: [{ id: 'p1', title: 'Merged', doi: '10.1/x', venue: 'Bridged Venue' }],
    notes: [], folders: [], savedSearches: [], tagColorRecords: [],
    baseSignatures: result.signatures
  });
  assert.equal(resolved.papersWritten, 1);
  assert.equal(resolved.conflicts.length, 0);
});

test('v5 to v6 migration compresses pdf_text pages and keeps a pre-migration backup', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-db-v6-'));
  const dbs = [];
  t.after(async function () {
    for (const handle of dbs) await handle.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'litboard.sqlite');

  // 先用当前代码造库并写入全文，然后退回 v5 形态（未压缩 TEXT pages + user_version=5）
  const seed = createLibraryDb(dir);
  dbs.push(seed);
  await seed.open();
  await seed.saveState({ papers: [{ id: 'p1', title: 'Legacy Text' }] });
  await seed.pdfTextPut({ paperId: 'p1', fingerprint: 'fp1', method: 'pdfjs', pages: ['压缩前的全文 transformers'] });
  await seed.close();
  const revert = new DatabaseSync(file);
  const rows = revert.prepare('SELECT paper_id, attachment_id, fingerprint, method, pages, updated_at FROM pdf_text').all();
  revert.exec('BEGIN');
  revert.exec(`CREATE TABLE pdf_text_v5(paper_id TEXT NOT NULL, attachment_id TEXT NOT NULL DEFAULT '', fingerprint TEXT, method TEXT, pages TEXT, updated_at INTEGER, PRIMARY KEY(paper_id, attachment_id))`);
  const ins = revert.prepare('INSERT INTO pdf_text_v5(paper_id, attachment_id, fingerprint, method, pages, updated_at) VALUES(?, ?, ?, ?, ?, ?)');
  for (const row of rows) {
    ins.run(row.paper_id, row.attachment_id || '', row.fingerprint || '', row.method || '',
      zlib.gunzipSync(row.pages).toString('utf8'), row.updated_at);
  }
  revert.exec('DROP TABLE pdf_text');
  revert.exec('ALTER TABLE pdf_text_v5 RENAME TO pdf_text');
  revert.exec('CREATE INDEX idx_pdf_text_paper ON pdf_text(paper_id)');
  revert.exec('PRAGMA user_version = 5');
  revert.exec('COMMIT');
  revert.close();

  const db = createLibraryDb(dir);
  dbs.push(db);
  await db.open();
  assert.ok(fsSync.existsSync(file + '.pre-v6.bak'), '迁移前备份已生成');
  // pages 已是压缩 BLOB，内容往返无损，检索照常
  const probe = new DatabaseSync(file, { readOnly: true });
  const kindRow = probe.prepare("SELECT typeof(pages) AS kind FROM pdf_text WHERE paper_id = 'p1'").get();
  probe.close();
  assert.equal(kindRow.kind, 'blob');
  const entry = await db.pdfTextGet('p1', '');
  assert.deepEqual(entry.pages, ['压缩前的全文 transformers']);
  assert.equal(entry.fingerprint, 'fp1');
  assert.equal((await db.pdfTextQuery('transformers')).length, 1);
  const state = await db.loadState();
  assert.equal(state.papers.length, 1);
  assert.equal(state.papers[0].title, 'Legacy Text');
  // 迁移后的库可正常写入
  await db.pdfTextPut({ paperId: 'p2', pages: ['new compressed text zebra'] });
  assert.equal((await db.pdfTextQuery('zebra')).length, 1);
});

test('v7 to v8 migration adds the has_cjk column with a pre-v8 backup', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-db-v8-'));
  const dbs = [];
  t.after(async function () {
    for (const handle of dbs) await handle.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'litboard.sqlite');

  const seed = createLibraryDb(dir);
  dbs.push(seed);
  await seed.open();
  await seed.saveState({ papers: [{ id: 'p1', title: 'Legacy Text' }] });
  await seed.pdfTextPut({ paperId: 'p1', pages: ['存量正文 transformers'] });
  await seed.close();

  // 退回 v7 形态：撤掉 has_cjk 列、版本号回拨
  const revert = new DatabaseSync(file);
  revert.exec('ALTER TABLE pdf_text DROP COLUMN has_cjk');
  revert.exec('PRAGMA user_version = 7');
  revert.close();

  const db = createLibraryDb(dir);
  dbs.push(db);
  await db.open();
  assert.ok(fsSync.existsSync(file + '.pre-v8.bak'), '迁移前备份已生成');
  const probe = new DatabaseSync(file, { readOnly: true });
  const cols = probe.prepare('PRAGMA table_info(pdf_text)').all().map(function (row) { return row.name; });
  const flag = probe.prepare("SELECT has_cjk FROM pdf_text WHERE paper_id = 'p1'").get();
  probe.close();
  assert.ok(cols.indexOf('has_cjk') !== -1, 'has_cjk 列已补上');
  assert.equal(flag.has_cjk, null, '存量行回填前保持 NULL（未知哨兵）');
  const entry = await db.pdfTextGet('p1', '');
  assert.deepEqual(entry.pages, ['存量正文 transformers']);
  // 迁移后新写入直接带标志；查询扫描到存量行（含中文 → 回填 1，但不命中）时惰性回填
  await db.pdfTextPut({ paperId: 'p2', pages: ['量子计算 new entry'] });
  const hits = await db.pdfTextQuery('量子');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].paperId, 'p2');
  const after = new DatabaseSync(file, { readOnly: true });
  const backfilled = after.prepare("SELECT has_cjk FROM pdf_text WHERE paper_id = 'p1'").get();
  after.close();
  assert.equal(backfilled.has_cjk, 1, '存量中文行被扫描时回填为 1');
});

test('pdfTextGet tolerates legacy uncompressed TEXT rows at runtime', async function (t) {
  const db = await tempDb(t);
  const d = new DatabaseSync(db.paths.file);
  d.prepare("INSERT INTO pdf_text(paper_id, attachment_id, fingerprint, method, pages, updated_at) VALUES('pOld', '', 'fp', 'pdfjs', ?, 1)")
    .run(JSON.stringify(['legacy plain text']));
  d.close();
  const entry = await db.pdfTextGet('pOld', '');
  assert.deepEqual(entry.pages, ['legacy plain text']);
  // 未压缩行也可被 <3 字符的全表回退路径检索（≥3 字符走 FTS，需 pdf_fts 有索引行）
  assert.equal((await db.pdfTextQuery('la')).length, 1);
});

test('性能回归：短词回退的全表扫描分批让出事件循环，主进程不会长时间「未响应」', async function (t) {
  const db = await tempDb(t);
  // ~12MB 正文（每篇 200KB），全部不含查询词：旧实现一次性 gunzipSync 全表会把窗口冻住。
  // 语料用裸 INSERT 写入（has_cjk=NULL，等同 v8 之前的存量行）——pdfTextPut 会直接写好
  // 标志，CJK 查询词随即跳过纯拉丁行，那样就测不到「全表回退扫描的让出」本身。
  const chunk = 'lorem ipsum dolor sit amet '.repeat(8000);   // ≈200KB
  const pack = function (pages) { return zlib.gzipSync(Buffer.from(JSON.stringify(pages), 'utf8'), { level: 1 }); };
  const raw = new DatabaseSync(db.paths.file);
  const ins = raw.prepare("INSERT INTO pdf_text(paper_id, attachment_id, fingerprint, method, pages, updated_at) VALUES(?, '', ?, 'pdfjs', ?, 1)");
  for (let i = 0; i < 60; i++) ins.run('p' + i, 'fp' + i, pack([chunk, chunk]));
  ins.run('hit', 'fphit', pack(['量子纠缠与超声成像']));
  raw.close();
  let maxGap = 0;
  let last = Date.now();
  const heartbeat = setInterval(function () {
    const now = Date.now();
    if (now - last > maxGap) maxGap = now - last;
    last = now;
  }, 10);
  let hits = null;
  try {
    hits = await db.pdfTextQuery('量子');
  } finally {
    clearInterval(heartbeat);
  }
  assert.equal(hits.length, 1, '短词命中要能查出来（trigram 覆盖不到的 2 字词走这条路）');
  assert.equal(hits[0].snippets.length, 1);
  assert.ok(hits[0].snippets[0].text.indexOf('⟪量子⟫') !== -1, '命中处要用标记括出：' + hits[0].snippets[0].text);
  // 事件循环心跳连续：任何一次同步块都不该超过这个量级（旧实现一次性解压全表，实测 0.6–1.3s 卡死）
  assert.ok(maxGap < 300, '最长同步块 ' + maxGap + 'ms（分批让出后应远小于整表解压）');
});

test('短词回退按 has_cjk 跳过纯拉丁行，扫描存量行时惰性回填标志', async function (t) {
  const db = await tempDb(t);
  await db.pdfTextPut({ paperId: 'en', pages: ['plain latin text about sensors and imaging'] });
  await db.pdfTextPut({ paperId: 'zh', pages: ['量子计算综述正文'] });
  // v8 之前的存量行：裸 INSERT，has_cjk 为 NULL（未知哨兵）
  const pack = function (pages) { return zlib.gzipSync(Buffer.from(JSON.stringify(pages), 'utf8'), { level: 1 }); };
  const raw = new DatabaseSync(db.paths.file);
  const ins = raw.prepare("INSERT INTO pdf_text(paper_id, attachment_id, fingerprint, method, pages, updated_at) VALUES(?, '', 'fp', 'pdfjs', ?, 1)");
  ins.run('legacyZh', pack(['旧库里的中文行，含量子一词']));
  ins.run('legacyEn', pack(['legacy english only row']));
  raw.close();

  const first = await db.pdfTextQuery('量子');
  assert.deepEqual(first.map(function (hit) { return hit.paperId; }).sort(), ['legacyZh', 'zh']);
  // 写入路径直接落标志（en=0/zh=1）；存量行按解压后的真实内容回填（legacyZh=1、legacyEn=0）
  const probe = new DatabaseSync(db.paths.file, { readOnly: true });
  const flags = {};
  probe.prepare('SELECT paper_id, has_cjk FROM pdf_text').all().forEach(function (row) { flags[row.paper_id] = row.has_cjk; });
  probe.close();
  assert.deepEqual(flags, { en: 0, zh: 1, legacyZh: 1, legacyEn: 0 });
  // 回填后再查：被跳过的行本来就不含查询词，结果与第一次完全一致
  const second = await db.pdfTextQuery('量子');
  assert.deepEqual(second, first);
  // 拉丁短词不带行过滤，行为不变（命中 en 的 'latin'）
  const latinHits = await db.pdfTextQuery('la');
  assert.equal(latinHits.length, 1);
  assert.equal(latinHits[0].paperId, 'en');
});

test('性能回归：超过同步阈值的单行（一本书）走异步解压，同步块仍在护栏内', async function (t) {
  const db = await tempDb(t);
  // 高熵随机词（gzip 压不动）× 20 页 × ~200k 字符 ≈ 4MB 正文，压缩后远超 512KB 同步阈值
  let rngState = 42;
  const rnd = function () { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; };
  const pages = [];
  for (let p = 0; p < 20; p++) {
    let s = '';
    while (s.length < 200000) s += Math.floor(rnd() * 1e12).toString(36) + ' ';
    pages.push(s);
  }
  const raw = new DatabaseSync(db.paths.file);
  raw.prepare("INSERT INTO pdf_text(paper_id, attachment_id, fingerprint, method, pages, updated_at) VALUES('book', '', 'fp', 'pdfjs', ?, 1)")
    .run(zlib.gzipSync(Buffer.from(JSON.stringify(pages), 'utf8'), { level: 1 }));
  raw.close();
  let maxGap = 0;
  let last = Date.now();
  const heartbeat = setInterval(function () {
    const now = Date.now();
    if (now - last > maxGap) maxGap = now - last;
    last = now;
  }, 10);
  let hits = null;
  try {
    hits = await db.pdfTextQuery('ＱＫ');   // 全角词不含 CJK 字符：不带行过滤，必扫大行
  } finally {
    clearInterval(heartbeat);
  }
  assert.equal(hits.length, 0);
  assert.ok(maxGap < 300, '最长同步块 ' + maxGap + 'ms（大行必须走异步解压）');
});

test('性能回归：FTS 路径不再整批取 snippet，片段只对前若干篇现算', async function (t) {
  const db = await tempDb(t);
  for (let i = 0; i < 40; i++) {
    await db.pdfTextPut({
      paperId: 'q' + i, fingerprint: 'f' + i, method: 'pdfjs',
      pages: ['transformers and attention mechanisms ' + i, 'unrelated page']
    });
  }
  const hits = await db.pdfTextQuery('transformers');
  assert.equal(hits.length, 40);
  // 每篇都命中页码；片段只为排在前面的若干篇生成（界面不展示片段，agent 每篇最多用 2 条）
  assert.ok(hits.every(function (hit) { return hit.pages.length === 1 && hit.count === 1; }));
  const withSnippets = hits.filter(function (hit) { return hit.snippets.length; });
  assert.ok(withSnippets.length > 0 && withSnippets.length <= 24, '片段篇数 = ' + withSnippets.length);
  assert.ok(withSnippets[0].snippets[0].text.indexOf('⟪transformers⟫') !== -1, withSnippets[0].snippets[0].text);
});

test('F04 回归：补全只写投影字段时 saveState 返回的签名对不上渲染层，重规范化后对齐', async function (t) {
  const LitModel = require('../js/model.js');
  const db = await tempDb(t);
  const uid = function () { return 'x'; };
  const first = await db.saveState({ papers: [{ id: 'p1', title: 'Deep Learning' }] });
  const base = first.signatures;
  // 渲染层内存里的条目就是 loadState 的规范化结果
  const loaded = await db.loadState();
  const paper = loaded.papers[0];
  const payload = function () {
    return {
      papers: loaded.papers, notes: loaded.notes, folders: loaded.folders,
      savedSearches: loaded.savedSearches, tagColorRecords: loaded.tagColorRecords
    };
  };
  // 同 app.js signaturesContain：库内签名必须覆盖渲染层 payload 的每个实体
  const signaturesContain = function (actual, expected) {
    return ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'].every(function (name) {
      const expectedMap = expected[name] || {}, actualMap = actual[name] || {};
      return Object.keys(expectedMap).every(function (key) { return actualMap[key] === expectedMap[key]; });
    });
  };
  // 补全命中：只写投影字段（修复前 applyPatch 的行为）
  paper.year = 2015;
  paper.authors = ['Yoshua Bengio'];
  const staleSigs = LitModel.workspaceSignatures(payload());
  const broken = await db.saveState(Object.assign({}, payload(), { baseSignatures: base }));
  assert.equal(signaturesContain(broken.signatures, staleSigs), false);
  // 修复后（applyPatch 同 addPapers：touch + normalizePaper + 放回）：库内签名与渲染层一致
  const norm = LitModel.normalizePaper(paper, uid);
  norm.id = paper.id;
  loaded.papers[0] = norm;
  const nextSigs = LitModel.workspaceSignatures(payload());
  const fixed = await db.saveState(Object.assign({}, payload(), { baseSignatures: base }));
  assert.equal(signaturesContain(fixed.signatures, nextSigs), true);
  // 权威字段由重规范化补齐，且补全结果确实落库
  assert.equal(norm.date, '2015');
  assert.equal(norm.creators.length, 1);
  const after = await db.loadState();
  assert.equal(after.papers[0].year, 2015);
  assert.equal(after.papers[0].date, '2015');
  assert.equal(after.papers[0].authors[0], 'Bengio, Yoshua');
});

test('pdfTextGetRange returns a bounded page slice for the reading assistant', async function (t) {
  const db = await tempDb(t);
  const pages = [];
  for (let i = 1; i <= 20; i++) pages.push('第' + i + '页内容 ' + 'x'.repeat(100));
  await db.pdfTextPut({ paperId: 'pr', fingerprint: 'fp', pages: pages });
  // 常规区间：闭区间、1 基页码
  const r1 = await db.pdfTextGetRange('pr', '', 3, 5);
  assert.equal(r1.total, 20);
  assert.equal(r1.from, 3);
  assert.equal(r1.to, 5);
  assert.deepEqual(r1.pages.map((p) => p.page), [3, 4, 5]);
  assert.ok(r1.pages[0].text.startsWith('第3页内容'));
  // 越界收敛
  const r2 = await db.pdfTextGetRange('pr', '', 18, 99);
  assert.equal(r2.to, 20);
  const r3 = await db.pdfTextGetRange('pr', '', -5, 2);
  assert.equal(r3.from, 1);
  // 单页截断
  await db.pdfTextPut({ paperId: 'pl', fingerprint: 'fp', pages: ['y'.repeat(5000)] });
  const r4 = await db.pdfTextGetRange('pl', '', 1, 1, 1000);
  assert.ok(r4.pages[0].text.length < 1100);
  assert.ok(r4.pages[0].text.indexOf('截断') !== -1);
  // 不存在的文献
  assert.equal(await db.pdfTextGetRange('nope', '', 1, 1), null);
  // 多附件：attachmentId 精确命中（A-followup #2：指定附件查不到时不得回退其它附件）
  await db.pdfTextPut({ paperId: 'pa', attachmentId: 'a1', fingerprint: 'f1', pages: ['att one', 'att two'] });
  const r5 = await db.pdfTextGetRange('pa', 'a1', 2, 2);
  assert.equal(r5.pages[0].text, 'att two');
});

test('A-followup #2: 显式附件查询不越界回退到该文献其它附件的索引', async function (t) {
  const db = await tempDb(t);
  // 旧版单 PDF 时代的行写在 attachment_id='' 上
  await db.pdfTextPut({ paperId: 'p1', attachmentId: '', fingerprint: 'legacy', pages: ['MAIN PDF PAGE 1'] });
  await db.pdfTextPut({ paperId: 'p1', attachmentId: 'supp-1', fingerprint: 'supp', pages: ['SUPP PAGE 1'] });
  // 指定附件有索引：严格命中
  assert.equal((await db.pdfTextGet('p1', 'supp-1')).pages[0], 'SUPP PAGE 1');
  // 指定附件没有索引：null（旧实现返回主 PDF 旧行，调用方以为读到了所请求的附件）
  assert.equal(await db.pdfTextGet('p1', 'supp-2'), null);
  assert.equal(await db.pdfTextGetRange('p1', 'supp-2', 1, 1), null);
  // 空 attachmentId（调用方明确问「该文献的旧版主行」）：照常命中
  assert.equal((await db.pdfTextGet('p1', '')).pages[0], 'MAIN PDF PAGE 1');
  // 兼容回退只在调用方显式选择时生效，且读回的行如实带空 attachmentId
  const legacy = await db.pdfTextGet('p1', 'supp-2', { legacyFallback: true });
  assert.equal(legacy.attachmentId, '');
  assert.equal(legacy.pages[0], 'MAIN PDF PAGE 1');
  const legacyRange = await db.pdfTextGetRange('p1', 'supp-2', 1, 1, 3500, 0, { legacyFallback: true });
  assert.equal(legacyRange.pages[0].text, 'MAIN PDF PAGE 1');
});
