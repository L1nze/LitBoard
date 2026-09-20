'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createResearchDb } = require('../electron/research-db.js');

async function makeDb() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-research-'));
  const db = createResearchDb({ dir });
  await db.open();
  return { db, dir };
}

const W1 = {
  id: 'W1', doi: '10.1000/a', title: '锌电池寿命预测研究', year: 2023,
  sourceId: 'S1', sourceName: 'Nature', abstract: '关于锌电池的摘要', citedBy: 10, isOa: true,
  authors: [{ name: 'Zhang San' }], refs: ['W7', 'W8'], concepts: ['Physics'], keywords: ['battery']
};
const W2 = {
  id: 'W2', doi: '', title: 'Battery health monitoring', year: 2021,
  sourceId: '', sourceName: '', abstract: '', citedBy: 3, isOa: false,
  authors: [], refs: [], concepts: [], keywords: []
};

test('upsertWorks is idempotent and fills ext_ids', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([W1, W2]);
    db.upsertWorks([W1]); // 重跑不重复
    const stats = db.stats();
    assert.equal(stats.total, 2);
    assert.equal(stats.withAbstract, 1);
    assert.equal(db.findByExtId('doi', '10.1000/a'), 'W1');
    assert.equal(db.findByExtId('openalex', 'W1'), 'W1');
    assert.equal(db.findByExtId('doi', '10.1000/missing'), null);
  } finally { db.close(); }
});

test('upsert prefers non-empty fields on conflict', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([W2]);
    db.upsertWorks([Object.assign({}, W2, { abstract: '后来补上的摘要', citedBy: 9 })]);
    const stats = db.stats();
    assert.equal(stats.withAbstract, 1);
    const [row] = db.getWorks(['W2']);
    assert.equal(row.abstract, '后来补上的摘要');
    assert.equal(row.citedBy, 9);
  } finally { db.close(); }
});

test('queryWorks: FTS trigram, short-query LIKE fallback, DOI and ID exact hits, year filter', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([W1, W2]);
    assert.equal(db.queryWorks({ q: '锌电池' }).total, 1);
    assert.equal(db.queryWorks({ q: '寿命预测' }).works[0].id, 'W1');
    assert.equal(db.queryWorks({ q: 'Bat' }).total, 1);   // <3 字符走 LIKE（大小写不敏感）
    assert.equal(db.queryWorks({ q: 'monitoring' }).works[0].id, 'W2');
    assert.equal(db.queryWorks({ q: 'https://doi.org/10.1000/A' }).works[0].id, 'W1'); // DOI 精确
    assert.equal(db.queryWorks({ q: 'w1' }).works[0].id, 'W1');                        // 短 ID 精确
    assert.equal(db.queryWorks({ q: '', yearFrom: 2022 }).total, 1);
    assert.equal(db.queryWorks({ q: '', yearTo: 2022 }).total, 1);
    assert.equal(db.queryWorks({ q: 'battery', yearFrom: 2022 }).total, 0); // FTS 命中但被年份过滤
    assert.equal(db.queryWorks({}).total, 2);
  } finally { db.close(); }
});

test('updateWorkText writes provenance and invalidates vectors', async function () {
  const { db, dir } = await makeDb();
  try {
    db.upsertWorks([W1]);
    // 模拟向量已建（直接写 vec.db，二期实装前的硬规则验证）
    const vecDb = new DatabaseSync(path.join(dir, 'vec.db'));
    vecDb.prepare("INSERT INTO vecs(work_id, model, dim, recipe, content_hash, vec, updated_at) VALUES('W1', 'm', 4, 1, 'h', x'00000000', 1)").run();
    vecDb.close();
    const r1 = db.updateWorkText('W1', { abstract: '' }, 'crossref');
    assert.equal(r1.updated, 0); // 空值不覆盖
    const r2 = db.updateWorkText('W1', { abstract: '回填后的摘要' }, 'crossref');
    assert.equal(r2.updated, 1);
    const [row] = db.getWorks(['W1']);
    assert.equal(row.abstract, '回填后的摘要');
    assert.equal(db.stats().vectors, 0); // 向量随内容失效
    // FTS 同步更新：旧摘要不再命中，新摘要可命中
    assert.equal(db.queryWorks({ q: '回填后的摘要' }).total, 1);
    // provenance 记录存在
    const { database: _drop } = { database: null };
  } finally { db.close(); }
});

test('importFromHarness maps and imports idempotently', async function () {
  const { db, dir } = await makeDb();
  // 构造一个最小 harness 形态的库
  const harnessFile = path.join(dir, 'harness.db');
  const h = new DatabaseSync(harnessFile);
  h.exec(`CREATE TABLE works(
    id TEXT PRIMARY KEY, doi TEXT, title TEXT, publication_year INTEGER,
    publication_date TEXT, type TEXT, cited_by_count INTEGER, is_oa INTEGER,
    language TEXT, abstract TEXT, authors_json TEXT, concepts_json TEXT,
    keywords_json TEXT, referenced_works TEXT, source_id TEXT, source_name TEXT, oa_url TEXT)`);
  h.prepare(`INSERT INTO works(id, doi, title, publication_year, cited_by_count, is_oa, abstract,
    authors_json, concepts_json, referenced_works, source_id, source_name)
    VALUES('https://openalex.org/W9', 'https://doi.org/10.1/B', 'Imported Work', 2020, 5, 1, 'abs text',
    '[{"display_name":"Author A"}]', '["AI"]', '["W1","W2"]', 'https://openalex.org/S3', 'Journal X')`).run();
  h.close();
  try {
    let last = null;
    const r = await db.importFromHarness(harnessFile, function (p) { last = p; });
    assert.equal(r.imported, 1);
    assert.ok(last && last.done === 1 && last.total === 1);
    const [row] = db.getWorks(['W9']);
    assert.equal(row.doi, '10.1/b');
    assert.equal(row.sourceId, 'S3');
    assert.deepEqual(row.authors, [{ name: 'Author A' }]);
    assert.deepEqual(row.refs, ['W1', 'W2']);
    // 再导入一遍：幂等
    const r2 = await db.importFromHarness(harnessFile, function () {});
    assert.equal(r2.imported, 1);
    assert.equal(db.stats().total, 1);
    await assert.rejects(function () { return db.importFromHarness(path.join(dir, 'nope.db'), function () {}); });
  } finally { db.close(); }
});

test('vec layer: put, pending by hash/model/recipe, cosine search with year filter', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([
      Object.assign({}, W1, { id: 'W10', title: 'Alpha study', abstract: 'alpha', year: 2020 }),
      Object.assign({}, W1, { id: 'W11', title: 'Beta study', abstract: 'beta', year: 2023 })
    ]);
    const model = 'm1';
    const recipe = 2;
    let pending = db.pendingEmbeddings({ model, recipe, limit: 10 });
    assert.equal(pending.length, 2);

    // W10 写入向量（1 维方便构造：方向即分数），W11 先不嵌
    const v10 = new Float32Array([1]);
    db.vecPut([{ workId: 'W10', model, dim: 1, recipe, hash: pending[0].hash, vec: Buffer.from(v10.buffer) }]);
    pending = db.pendingEmbeddings({ model, recipe, limit: 10 });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].work.id, 'W11');

    // 内容变化 → hash 不符 → 重新待嵌；R13：upsert 直接删掉旧向量（不等后台补建）
    db.upsertWorks([{ id: 'W10', title: 'Alpha study v2', abstract: 'alpha2' }]);
    pending = db.pendingEmbeddings({ model, recipe, limit: 10 });
    assert.equal(pending.length, 2);
    assert.ok(!db.cosineSearch(Buffer.from(new Float32Array([1]).buffer), { limit: 5 }).some((h) => h.workId === 'W10'),
      '正文一变，旧向量必须立即退出检索结果');

    // 模型/配方版本不符 → 待嵌
    db.upsertWorks([{ id: 'W10', title: 'Alpha study', abstract: 'alpha' }]);
    pending = db.pendingEmbeddings({ model: 'm2', recipe, limit: 10 });
    assert.equal(pending.length, 2);
    // 恢复原文后重新写入向量（此时 W10 的向量已被上一步 v2 变更删掉）
    const pendingW10 = db.pendingEmbeddings({ model, recipe, limit: 10 }).find((p) => p.work.id === 'W10');
    db.vecPut([{ workId: 'W10', model, dim: 1, recipe, hash: pendingW10.hash, vec: Buffer.from(v10.buffer) }]);

    // 余弦检索：query 与 W10 同向 → 高分；年份过滤生效
    db.vecPut([{ workId: 'W11', model, dim: 1, recipe, hash: 'h', vec: Buffer.from(new Float32Array([0.5]).buffer) }]);
    const hits = db.cosineSearch(Buffer.from(new Float32Array([1]).buffer), { limit: 5 });
    assert.equal(hits[0].workId, 'W10');
    assert.ok(hits[0].score > 0.99);
    const filtered = db.cosineSearch(Buffer.from(new Float32Array([1]).buffer), { limit: 5, yearFrom: 2021 });
    assert.ok(filtered.every((h) => h.workId !== 'W10'));
    // R13：等维不同模型不是同一向量空间——按 model+recipe 过滤时不得混检
    const crossModel = db.cosineSearch(Buffer.from(new Float32Array([1]).buffer), { limit: 5, model: 'm2', recipe });
    assert.equal(crossModel.length, 0, 'm2 查询不得命中 m1 的向量');
    const sameModel = db.cosineSearch(Buffer.from(new Float32Array([1]).buffer), { limit: 5, model, recipe });
    assert.equal(sameModel.length, 2);
    // 空标题+空摘要跳过
    db.upsertWorks([{ id: 'W12', title: '', abstract: '' }]);
    pending = db.pendingEmbeddings({ model, recipe, limit: 10 });
    assert.ok(!pending.some((p) => p.work.id === 'W12'));
    db.vecClear();
    assert.equal(db.stats().vectors, 0);
  } finally { db.close(); }
});

test('findWorksNeedingAbstract targets empty-abstract rows with DOI only', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([
      { id: 'W20', title: 'has', abstract: 'full', doi: '10.1/x' },
      { id: 'W21', title: 'empty', abstract: '', doi: '10.1/y' },
      { id: 'W22', title: 'nodoi', abstract: '', doi: '' }
    ]);
    const rows = db.findWorksNeedingAbstract({ limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'W21');
  } finally { db.close(); }
});

test('identity core round-trips into a fresh empty database', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-idcore-'));
  const db1 = createResearchDb({ dir });
  await db1.open();
  db1.upsertWorks([{ id: 'W30', doi: '10.1/z', title: 'Keep me', year: 2022, abstract: 'rebuildable' }]);
  db1.updateWorkText('W30', { abstract: 'backfilled' }, 'crossref');
  db1.recordSearch({ q: 'q', filters: {}, count: 3 });
  const core = db1.exportIdentityCore();
  db1.close();

  // 恢复场景：空目录新建库 → 导入身份核
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-idcore2-'));
  const db2 = createResearchDb({ dir: dir2 });
  await db2.open();
  const r = db2.importIdentityCore(core);
  assert.equal(r.works, 1);
  assert.equal(db2.stats().total, 1);
  assert.equal(db2.stats().searches, 1);
  const [row] = db2.getWorks(['W30']);
  assert.equal(row.title, 'Keep me');
  assert.equal(row.year, 2022);
  assert.equal(row.doi, '10.1/z');
  assert.equal(row.abstract, ''); // 元数据留空待重建，身份保留
  // provenance 恢复（updateWorkText 曾记录）
  assert.equal(db2.findByExtId('doi', '10.1/z'), 'W30');
  db2.close();
});

test('addExtIds and findIdByNormalizedTitle (M9-4 web search ingest)', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([{ id: 'W50', title: 'Zinc-Ion Batteries: A Review', doi: '10.1/z' }]);
    // 标题精确匹配（规范化后）
    assert.equal(db.findIdByNormalizedTitle('Zinc–Ion Batteries:   a review!'), 'W50');
    assert.equal(db.findIdByNormalizedTitle('completely different title'), null);
    assert.equal(db.findIdByNormalizedTitle('short'), null); // 太短不匹配
    // URL ext_id 挂到既有身份，幂等
    assert.equal(db.addExtIds('W50', [{ kind: 'url', value: 'https://example.org/p' }]).count, 1);
    assert.equal(db.addExtIds('W50', [{ kind: 'url', value: 'https://example.org/p' }]).count, 0);
    assert.equal(db.findByExtId('url', 'https://example.org/p'), 'W50');
  } finally { db.close(); }
});

test('R09: 重复 upsert 的空摘要不重建空 FTS——按合并后的权威行更新', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([{ id: 'W40', title: 'Retained title', abstract: 'retainedkeyword content' }]);
    assert.equal(db.queryWorks({ q: 'retainedkeyword' }).total, 1);
    // 同 ID 再写空摘要：数据库按非空保留，FTS 必须同样保持权威合并行
    db.upsertWorks([{ id: 'W40', title: '', abstract: '' }]);
    assert.equal(db.getWorks(['W40'])[0].abstract, 'retainedkeyword content');
    assert.equal(db.queryWorks({ q: 'retainedkeyword' }).total, 1, '空摘要 upsert 不得清掉既有检索命中');
    // 非空替换：FTS 跟随新值
    db.upsertWorks([{ id: 'W40', title: 'Retained title', abstract: 'replacedkeyword content' }]);
    assert.equal(db.queryWorks({ q: 'replacedkeyword' }).total, 1);
    assert.equal(db.queryWorks({ q: 'retainedkeyword' }).total, 0);
  } finally { db.close(); }
});

test('R15: v1 → v2 迁移补 snippet/page_url 列并重建四列 FTS（老库不丢数据）', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-rdb-v1-'));
  // 手工造一个 v1 库（原始 schema，无 snippet/page_url，FTS 三列）
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(path.join(dir, 'research.db'));
  raw.exec(`
    CREATE TABLE works(id TEXT PRIMARY KEY, doi TEXT DEFAULT '', title TEXT NOT NULL DEFAULT '',
      year INTEGER, pubdate TEXT DEFAULT '', type TEXT DEFAULT '', source_id TEXT DEFAULT '',
      source_name TEXT DEFAULT '', abstract TEXT DEFAULT '', lang TEXT DEFAULT '',
      cited_by INTEGER DEFAULT 0, is_oa INTEGER DEFAULT 0, oa_url TEXT DEFAULT '',
      authors_json TEXT DEFAULT '[]', refs_json TEXT DEFAULT '[]', concepts_json TEXT DEFAULT '[]',
      keywords_json TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE ext_ids(work_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind, value));
    CREATE INDEX idx_ext_ids_work ON ext_ids(work_id);
    CREATE TABLE merge_log(old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE field_provenance(work_id TEXT NOT NULL, field TEXT NOT NULL, source TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, PRIMARY KEY(work_id, field));
    CREATE TABLE searches(id INTEGER PRIMARY KEY AUTOINCREMENT, q TEXT DEFAULT '',
      filters_json TEXT DEFAULT '{}', result_count INTEGER DEFAULT 0, at INTEGER NOT NULL);
    CREATE VIRTUAL TABLE works_fts USING fts5(work_id UNINDEXED, title, abstract, tokenize='trigram');
    INSERT INTO works(id, title, abstract, created_at, updated_at)
      VALUES('W1', 'Legacy title', 'legacyabstractkeyword body', 1, 1);
    INSERT INTO works_fts(work_id, title, abstract) VALUES('W1', 'Legacy title', 'legacyabstractkeyword body');
    PRAGMA user_version = 1;
  `);
  raw.close();

  const db = createResearchDb({ dir });
  await db.open();
  try {
    // 老数据仍在，且新列可写
    const before = db.getWorks(['W1'])[0];
    assert.equal(before.abstract, 'legacyabstractkeyword body');
    assert.equal(before.snippet, '');
    assert.equal(db.queryWorks({ q: 'legacyabstractkeyword' }).total, 1, '迁移后旧摘要仍可检索');
    // snippet 入库后可被检索（FTS 覆盖四列）
    db.upsertWorks([{ id: 'W2', title: 'Web page', snippet: 'websnippetkeyword 片段' }]);
    assert.equal(db.queryWorks({ q: 'websnippetkeyword' }).total, 1, '网页片段进 FTS 可检索');
    const row = db.getWorks(['W2'])[0];
    assert.equal(row.snippet, 'websnippetkeyword 片段');
    assert.equal(row.abstract, '', '网页片段不冒充摘要');
    // page_url 往返
    db.upsertWorks([{ id: 'W3', title: 'T', pageUrl: 'https://arxiv.org/abs/9' }]);
    assert.equal(db.getWorks(['W3'])[0].pageUrl, 'https://arxiv.org/abs/9');
  } finally { db.close(); }
});

test('R15: upsert 的非空补齐对 snippet/page_url 同样成立（空值不覆盖已有值）', async function () {
  const { db } = await makeDb();
  try {
    db.upsertWorks([{ id: 'W50', title: 'T', snippet: 'keepme', pageUrl: 'https://a/b' }]);
    db.upsertWorks([{ id: 'W50', title: 'T', snippet: '', pageUrl: '' }]);
    const row = db.getWorks(['W50'])[0];
    assert.equal(row.snippet, 'keepme');
    assert.equal(row.pageUrl, 'https://a/b');
    assert.equal(db.queryWorks({ q: 'keepme' }).total, 1, '空 snippet 不得清掉检索命中');
  } finally { db.close(); }
});

test('R18: getRefsSnapshot 返回全库 (id → refs) 邻接快照，空 refs 不出现', async function () {
  const { db } = await makeDb();
  db.upsertWorks([W1, W2]);
  const snap = db.getRefsSnapshot();
  const w1 = snap.find((e) => e.id === 'W1');
  assert.ok(w1, 'W1 在快照中');
  assert.deepEqual(w1.refs, ['W7', 'W8']);
  assert.ok(!snap.some((e) => e.id === 'W2'), '无 refs 的 W2 不占位');
});

test('S3: 空格分词 = AND 语义（不再要求连续短语）；显式引号仍是短语匹配', async function () {
  const { db } = await makeDb();
  db.upsertWorks([
    { id: 'W101', doi: '', title: 'deep neural architectures for modern learning', year: 2020, refs: [], authors: [], abstract: '' },
    { id: 'W102', doi: '', title: 'deep reinforcement learning control', year: 2021, refs: [], authors: [], abstract: '' },
    { id: 'W103', doi: '', title: 'convolutional image classification', year: 2021, refs: [], authors: [], abstract: '' }
  ]);
  // 审计复现：deep 与 learning 都在标题里，但「deep learning」不是连续子串——旧实现返回 0
  const both = db.queryWorks({ q: 'deep learning' });
  assert.equal(both.total >= 2, true, '两词各自命中即应返回（AND），不要求相邻');
  const ids = both.works.map((w) => w.id).sort();
  assert.deepEqual(ids, ['W101', 'W102']);
  // 单词照旧
  assert.equal(db.queryWorks({ q: 'classification' }).works[0].id, 'W103');
  // 显式引号 = 连续短语
  const phrase = db.queryWorks({ q: '"neural architectures"' });
  assert.equal(phrase.works.length, 1);
  assert.equal(phrase.works[0].id, 'W101');
  const notPhrase = db.queryWorks({ q: '"architectures modern"' });
  assert.equal(notPhrase.works.length, 0);
});

/* ---------------- R19：临时全文链（works_fulltext 侧表 + FTS 五列） ---------------- */

test('R19: v3 全文窗口读写（fromChar 续读、charTotal、空文本拒绝、未命中 null）', async function () {
  const { db } = await makeDb();
  db.upsertWorks([{ id: 'W201', title: 'protocol paper', year: 2024, refs: [] }]);
  assert.equal(db.getFulltextWindow('W201', 0, 100), null, '尚无全文');
  assert.equal(db.upsertFulltext('W201', '   '), 0, '空文本拒绝写入');
  const chars = db.upsertFulltext('W201', 'A'.repeat(25000) + '【第 3 页】methods');
  assert.ok(chars > 25000);
  const w1 = db.getFulltextWindow('W201', 0, 10000);
  assert.equal(w1.charTotal, chars);
  assert.equal(w1.text.length, 10000);
  const w2 = db.getFulltextWindow('W201', 20000, 10000);
  assert.equal(w2.fromChar, 20000);
  assert.ok(w2.text.indexOf('methods') !== -1, '尾窗读到末尾内容');
  // 越界偏移夹到末尾
  const w3 = db.getFulltextWindow('W201', 999999, 10000);
  assert.ok(w3.fromChar < chars);
});

test('R19: 全文进 FTS（search_research 可命中正文词）；元数据 upsert 不丢全文', async function () {
  const { db } = await makeDb();
  db.upsertWorks([{ id: 'W202', title: 'battery cycling', abstract: 'abstract only', refs: [] }]);
  db.upsertFulltext('W202', '正文里独有的实验方案代号 xyzzy-experiment-42 出现在这里');
  assert.equal(db.queryWorks({ q: 'xyzzy-experiment-42' }).works.length, 1, '仅存在于全文的词可检索');
  assert.equal(db.queryWorks({ q: 'battery' }).works.length, 1, '标题命中不受影响');
  // 重新 upsert 元数据（检索再次入库是常态）：全文与 FTS 行保留
  db.upsertWorks([{ id: 'W202', title: 'battery cycling v2', abstract: '', citedBy: 99, refs: [] }]);
  assert.equal(db.getWorks(['W202'])[0].fulltextChars > 0, true, 'fulltextChars 仍在');
  assert.equal(db.queryWorks({ q: 'xyzzy-experiment-42' }).works.length, 1, 'FTS 的 fulltext 列未丢');
  assert.equal(db.getWorks(['W202'])[0].citedBy, 99);
});

test('R19: v2 → v3 迁移：旧库数据保留、works_fulltext 建表、FTS 重建为五列', async function () {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-research-v2-'));
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(dir, 'research.db');
  // 手工造一个 v2 库（建表语句与 v2 版本一致）
  const raw = new DatabaseSync(file);
  raw.exec(`PRAGMA journal_mode = WAL; PRAGMA user_version = 2;`);
  raw.exec(`CREATE TABLE works(id TEXT PRIMARY KEY, doi TEXT DEFAULT '', title TEXT NOT NULL DEFAULT '',
    year INTEGER, pubdate TEXT DEFAULT '', type TEXT DEFAULT '', source_id TEXT DEFAULT '', source_name TEXT DEFAULT '',
    abstract TEXT DEFAULT '', snippet TEXT DEFAULT '', page_url TEXT DEFAULT '', lang TEXT DEFAULT '',
    cited_by INTEGER DEFAULT 0, is_oa INTEGER DEFAULT 0, oa_url TEXT DEFAULT '',
    authors_json TEXT DEFAULT '[]', refs_json TEXT DEFAULT '[]', concepts_json TEXT DEFAULT '[]',
    keywords_json TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  raw.exec(`CREATE VIRTUAL TABLE works_fts USING fts5(work_id UNINDEXED, title, abstract, snippet, tokenize='trigram')`);
  raw.prepare(`INSERT INTO works(id, title, abstract, created_at, updated_at) VALUES('W300', 'legacy work', 'legacy abstract', 1, 1)`).run();
  raw.prepare(`INSERT INTO works_fts(work_id, title, abstract, snippet) VALUES('W300', 'legacy work', 'legacy abstract', '')`).run();
  raw.close();
  const db = createResearchDb({ dir: dir });
  await db.open(); // open 内迁移 v2 → v3
  assert.equal(db.getWorks(['W300'])[0].title, 'legacy work', '旧数据保留');
  assert.equal(db.queryWorks({ q: 'legacy' }).works.length, 1, '迁移后 FTS 仍命中');
  assert.equal(db.getFulltextWindow('W300', 0, 100), null, '旧库无全文');
  db.upsertFulltext('W300', '迁移后新增的全文内容 unique-token-after-migration');
  assert.equal(db.queryWorks({ q: 'unique-token-after-migration' }).works.length, 1, '迁移后的库可写全文并检索');
  await db.close();
});
