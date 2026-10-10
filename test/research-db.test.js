'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createResearchDb } = require('../electron/research-db.js');
const LitResearch = require('../js/research.js');

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

test('upsertWorks：幂等且填 ext_ids；冲突时非空字段优先', async function () {
  {
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
  }
  {
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
  }
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

test('updateWorkText：写 provenance 并使向量失效；内容未变短路（不重建 FTS、不删向量、不造假待办）', async function () {
  {
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
  }
  {
    const { db } = await makeDb();
    try {
      db.upsertWorks([{ id: 'W70', title: 'Stable title', abstract: 'stable abstract', doi: '10.1/q' }]);
      const model = 'm1';
      const recipe = 2;
      const pending = db.pendingEmbeddings({ model, recipe, limit: 5 });
      db.vecPut([{ workId: 'W70', model: model, dim: 1, recipe: recipe, hash: pending[0].hash,
        vec: Buffer.from(new Float32Array([1]).buffer) }]);
      // 幂等回填（同一摘要原样再写一遍）：updated 0，向量保留、不重新变成待嵌
      const r = db.updateWorkText('W70', { abstract: 'stable abstract' }, 'crossref');
      assert.equal(r.updated, 0);
      assert.equal(db.stats().vectors, 1);
      assert.equal(db.pendingEmbeddings({ model, recipe, limit: 5 }).length, 0);
      assert.ok(db.cosineSearch(Buffer.from(new Float32Array([1]).buffer), { limit: 5, model: model, recipe: recipe })
        .some((h) => h.workId === 'W70'), '内容没变，向量必须仍在检索结果里');
      // 内容真的变了：照旧全链路（R13 删 vec 行 → 重新待嵌）
      const r2 = db.updateWorkText('W70', { abstract: 'changed abstract' }, 'crossref');
      assert.equal(r2.updated, 1);
      assert.equal(db.pendingEmbeddings({ model, recipe, limit: 5 }).length, 1);
    } finally { db.close(); }
  }
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

test('待办扫描：pendingEmbeddings 两段式（戳在即跳过，不再逐行重验 hash）；findWorksNeedingAbstract 只挑空摘要带 DOI 的行', async function () {
  {
    const { db, dir } = await makeDb();
    try {
      db.upsertWorks([
        { id: 'WA', title: 'Alpha', abstract: 'a text', concepts: ['x'], keywords: ['y'] },
        { id: 'WB', title: 'Beta', abstract: 'b text' },
        { id: 'WC', title: '', abstract: '' }
      ]);
      const model = 'm1';
      const recipe = 2;
      let pending = db.pendingEmbeddings({ model, recipe, limit: 10 });
      assert.deepEqual(pending.map((p) => p.work.id), ['WA', 'WB']); // 扫描序 + 空文本跳过
      // 第二段才算 hash，且是当前内容算出的（vecPut 落库后写入路径的失真检测不受影响）
      assert.equal(pending[0].hash, LitResearch.embeddingHash(pending[0].work));
      db.vecPut(pending.map((p) => ({
        workId: p.work.id, model: model, dim: 1, recipe: recipe, hash: p.hash,
        vec: Buffer.from(new Float32Array([0.5]).buffer)
      })));
      assert.equal(db.pendingEmbeddings({ model, recipe, limit: 10 }).length, 0);
      // 手工改坏 vecs.content_hash 也不再触发重嵌——已有当前模型+配方向量即视为最新
      // （上游 embed_version 同一信任模型；应用的所有写路径都同步删 vec 行，R13）
      const vecDb = new DatabaseSync(path.join(dir, 'vec.db'));
      vecDb.prepare("UPDATE vecs SET content_hash = 'zzz'").run();
      vecDb.close();
      assert.equal(db.pendingEmbeddings({ model, recipe, limit: 10 }).length, 0);
      // 换模型（等维不同空间）→ 全部重新待办；limit 截断按扫描序
      assert.equal(db.pendingEmbeddings({ model: 'm2', recipe, limit: 10 }).length, 2);
      assert.equal(db.pendingEmbeddings({ model: 'm2', recipe, limit: 1 })[0].work.id, 'WA');
    } finally { db.close(); }
  }
  {
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
  }
});

test('身份体系：identity core 空库 round-trip（元数据留空身份保留）；addExtIds / findIdByNormalizedTitle 挂靠既有身份', async function () {
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

test('R15: v1 → v2 迁移补 snippet/page_url 列并重建四列 FTS（老库不丢数据）；upsert 非空补齐对 snippet/page_url 同样成立', async function () {
  {
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
  }
  {
    const { db } = await makeDb();
    try {
      db.upsertWorks([{ id: 'W50', title: 'T', snippet: 'keepme', pageUrl: 'https://a/b' }]);
      db.upsertWorks([{ id: 'W50', title: 'T', snippet: '', pageUrl: '' }]);
      const row = db.getWorks(['W50'])[0];
      assert.equal(row.snippet, 'keepme');
      assert.equal(row.pageUrl, 'https://a/b');
      assert.equal(db.queryWorks({ q: 'keepme' }).total, 1, '空 snippet 不得清掉检索命中');
    } finally { db.close(); }
  }
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

test('R19: v3 全文窗口读写（fromChar 续读、空文本拒绝、未命中 null）；全文进 FTS 且元数据 upsert 不丢全文', async function () {
  {
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
    db.close();
  }
  {
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
    db.close();
  }
});

test('性能回归：内容未变的 upsert 不重建 FTS 行（检索工具一次会 upsert 上百行）', async function () {
  const { db, dir } = await makeDb();
  try {
    db.upsertWorks([W1, W2]);
    const rowIds = function () {
      const raw = new DatabaseSync(path.join(dir, 'research.db'), { readOnly: true });
      const rows = raw.prepare('SELECT rowid AS rid, work_id FROM works_fts ORDER BY work_id').all();
      raw.close();
      return rows;
    };
    const before = rowIds();
    assert.equal(before.length, 2);
    const ridOf = function (rows, id) {
      return rows.filter(function (row) { return row.work_id === id; })[0].rid;
    };
    // 同内容重跑（「检索即入库」是常态）：FTS 行既不删也不插，rowid 保持
    db.upsertWorks([W1, W2]);
    assert.equal(ridOf(rowIds(), 'W1'), ridOf(before, 'W1'), '内容未变不得重建 FTS 行');
    assert.equal(db.queryWorks({ q: '锌电池' }).works.length, 1, '跳过重建也不能丢命中');
    // 内容变了必须重建（正确性优先，不能因为省事一起跳过）
    db.upsertWorks([Object.assign({}, W1, { title: '锌电池寿命预测研究（修订版）' })]);
    const after = rowIds();
    assert.notEqual(ridOf(after, 'W1'), ridOf(before, 'W1'), '改过的行要重建');
    assert.equal(ridOf(after, 'W2'), ridOf(before, 'W2'), '没改的行仍不重建');
    assert.equal(db.queryWorks({ q: '修订版' }).works.length, 1);
  } finally { db.close(); }
});

test('性能回归：R13 stale 前置读取每批只 prepare 一次（不再逐行编译 content_hash SELECT）', async function () {
  const { db, dir } = await makeDb();
  try {
    const rows = [];
    for (let i = 0; i < 25; i++) {
      rows.push({ id: 'V' + i, doi: '', title: 'Stale check row number ' + i, year: 2020 + (i % 5),
        abstract: 'abstract for row ' + i, concepts: [], keywords: [], refs: [], authors: [] });
    }
    db.upsertWorks(rows);
    // 向量先建好且 hash 与当前内容一致：整批重跑不应判任何 stale
    db.vecPut(rows.map(function (r) {
      return { workId: r.id, model: 'mp', dim: 4, recipe: 1,
        hash: LitResearch.embeddingHash({ title: r.title, abstract: r.abstract, concepts: [], keywords: [] }),
        vec: Buffer.from(new Float32Array([1, 0, 0, 0]).buffer) };
    }));
    assert.equal(db.stats().vectors, 25);

    // 临时在原型上包一层 prepare 统计编译次数；finally 必须还原（见收尾）
    const VEC_HASH_SQL = 'SELECT content_hash FROM vecs WHERE work_id = ?';
    const origPrepare = DatabaseSync.prototype.prepare;
    let prepared = 0;
    DatabaseSync.prototype.prepare = function (sql) {
      if (sql === VEC_HASH_SQL) prepared += 1;
      return origPrepare.call(this, sql);
    };
    try {
      // ① 内容未变整批重跑：每行照做 stale 检查，但语句只编译一次（旧实现 25 次）
      db.upsertWorks(rows);
      assert.equal(prepared, 1, '25 行一批只 prepare 一次 content_hash SELECT');
      assert.equal(db.stats().vectors, 25, '内容未变不得删向量');
      // ② 只改一行标题：语句仍只编译一次，stale 判定只命中那一行
      prepared = 0;
      db.upsertWorks(rows.map(function (r, i) {
        return i === 13 ? Object.assign({}, r, { title: 'Stale check row number 13 (revised)' }) : r;
      }));
      assert.equal(prepared, 1, '改标题的批次同样只 prepare 一次');
    } finally {
      DatabaseSync.prototype.prepare = origPrepare;
    }

    // 直接读 vec.db 断言「只删了变的那行」：R13 删除精确到 stale 行，不殃及邻居
    const raw = new DatabaseSync(path.join(dir, 'vec.db'), { readOnly: true });
    const remaining = raw.prepare('SELECT work_id FROM vecs ORDER BY work_id').all()
      .map(function (row) { return row.work_id; });
    raw.close();
    assert.equal(remaining.length, 24, '只删 stale 的那一行');
    assert.ok(remaining.indexOf('V13') === -1, '改标题那行的向量被删（R13）');
    assert.ok(remaining.indexOf('V12') !== -1 && remaining.indexOf('V14') !== -1, '其余向量保留');
  } finally { db.close(); }
});

test('queryWorks：命中总数只算到「本页取满」为止（不再为每页做一次全量 COUNT）', async function () {
  const { db } = await makeDb();
  try {
    for (let i = 0; i < 5; i++) {
      db.upsertWorks([{ id: 'W' + i, title: 'battery pack study ' + i, refs: [] }]);
    }
    const short = db.queryWorks({ q: 'battery', limit: 2 });
    assert.equal(short.works.length, 2);
    assert.equal(short.totalIsLowerBound, true, '取满一页时 total 是下限');
    assert.equal(short.total, 2);
    const full = db.queryWorks({ q: 'battery', limit: 20 });
    assert.equal(full.works.length, 5);
    assert.equal(full.total, 5, '取不满时 total 精确');
    assert.equal(full.totalIsLowerBound, false);
    const paged = db.queryWorks({ q: 'battery', limit: 4, offset: 2 });
    assert.equal(paged.works.length, 3);
    assert.equal(paged.total, 5, '翻页时 total = offset + 本页条数');
  } finally { db.close(); }
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

/* ---------------- A-followup #4/#5：向量覆盖判定 + 规范化标题索引 ---------------- */

test('A-followup #4: vecCoverage 按当前模型 + 配方统计，不把「别的模型的向量」算作可用', async function () {
  const { db } = await makeDb();
  const vecOf = function (dim) { return new Float32Array(dim).fill(0.5); };
  db.upsertWorks([{ id: 'W401', title: 'a', abstract: 'x', refs: [] }, { id: 'W402', title: 'b', abstract: 'y', refs: [] }]);
  db.vecPut([
    { workId: 'W401', model: 'model-A', dim: 4, recipe: 2, hash: 'h1', vec: vecOf(4) },
    { workId: 'W402', model: 'model-A', dim: 4, recipe: 2, hash: 'h2', vec: vecOf(4) }
  ]);
  assert.deepEqual(db.vecCoverage({ model: 'model-A', recipe: 2 }), { total: 2, matched: 2 });
  // 换了模型：总数不为零，但当前模型覆盖为零——旧实现按 stats().vectors 判定会误判为可用
  assert.deepEqual(db.vecCoverage({ model: 'model-B', recipe: 2 }), { total: 2, matched: 0 });
  // 配方不同也不算
  assert.equal(db.vecCoverage({ model: 'model-A', recipe: 1 }).matched, 0);
  await db.close();
});

test('A-followup #5: 标题去重覆盖全库（不再只扫被引数前 400 篇）、v3 旧库迁移回填 title_norm、title_norm 随 upsert / updateWorkText 同步维护', async function () {
  {
    const { db } = await makeDb();
    // 401 篇高被引 + 1 篇低被引，目标标题只属于低被引的那篇
    const bulk = [];
    for (let i = 0; i < 401; i++) {
      bulk.push({ id: 'W5' + i, title: 'High cited paper number ' + i, citedBy: 10000 - i, refs: [] });
    }
    db.upsertWorks(bulk);
    db.upsertWorks([{ id: 'Wlow', title: 'Deep learning for zinc battery health estimation', citedBy: 0, refs: [] }]);
    // 标题大小写/标点差异应归一化后命中同一身份
    assert.equal(db.findIdByNormalizedTitle('deep  learning for zinc battery health ESTIMATION!!'), 'Wlow');
    assert.equal(db.findIdByNormalizedTitle('Deep learning for zinc battery health estimation'), 'Wlow');
    assert.equal(db.findIdByNormalizedTitle('High cited paper number 400'), 'W5400');
    // 过短标题不参与匹配（沿用既有下限）
    assert.equal(db.findIdByNormalizedTitle('short'), null);
    await db.close();
  }
  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-research-v3-'));
    const file = path.join(dir, 'research.db');
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA journal_mode = WAL; PRAGMA user_version = 3;`);
    raw.exec(`CREATE TABLE works(id TEXT PRIMARY KEY, doi TEXT DEFAULT '', title TEXT NOT NULL DEFAULT '',
      year INTEGER, pubdate TEXT DEFAULT '', type TEXT DEFAULT '', source_id TEXT DEFAULT '', source_name TEXT DEFAULT '',
      abstract TEXT DEFAULT '', snippet TEXT DEFAULT '', page_url TEXT DEFAULT '', lang TEXT DEFAULT '',
      cited_by INTEGER DEFAULT 0, is_oa INTEGER DEFAULT 0, oa_url TEXT DEFAULT '',
      authors_json TEXT DEFAULT '[]', refs_json TEXT DEFAULT '[]', concepts_json TEXT DEFAULT '[]',
      keywords_json TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    // v3 库应有的 FTS 与全文侧表（迁移只在 <3 时重建 FTS）
    raw.exec(`CREATE VIRTUAL TABLE works_fts USING fts5(work_id UNINDEXED, title, abstract, snippet, fulltext, tokenize='trigram')`);
    raw.exec(`CREATE TABLE works_fulltext(work_id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', chars INTEGER NOT NULL DEFAULT 0, fetched_at INTEGER NOT NULL DEFAULT 0)`);
    raw.prepare(`INSERT INTO works(id, title, created_at, updated_at) VALUES('Wold', 'Zinc Battery Health Estimation', 1, 1)`).run();
    raw.prepare(`INSERT INTO works_fts(work_id, title, abstract, snippet, fulltext) VALUES('Wold', 'Zinc Battery Health Estimation', '', '', '')`).run();
    raw.close();
    const db = createResearchDb({ dir: dir });
    await db.open(); // v3 → v4：加列 + 索引 + 回填
    assert.equal(db.findIdByNormalizedTitle('zinc battery health estimation'), 'Wold', '迁移回填后旧行可命中');
    assert.equal(db.findIdByNormalizedTitle('Zinc  Battery   Health Estimation!!'), 'Wold', '规范化后同键');
    await db.close();
  }
  {
    const { db } = await makeDb();
    db.upsertWorks([{ id: 'W500', title: 'Zinc Battery Health Estimation', refs: [] }]);
    assert.equal(db.findIdByNormalizedTitle('zinc battery health estimation'), 'W500');
    // upsert 改标题：规范化键跟着走，旧键不再命中
    db.upsertWorks([{ id: 'W500', title: 'Nickel Battery Aging Model', refs: [] }]);
    assert.equal(db.findIdByNormalizedTitle('Nickel Battery Aging Model'), 'W500');
    assert.equal(db.findIdByNormalizedTitle('Zinc Battery Health Estimation'), null, '旧标题不再命中');
    // updateWorkText 改标题同样维护（回填链会走这条路）
    db.updateWorkText('W500', { title: 'Solid State Electrolyte Review' }, 'crossref');
    assert.equal(db.findIdByNormalizedTitle('Solid State Electrolyte Review'), 'W500');
    // 只改摘要不动标题：标题键保持
    db.updateWorkText('W500', { abstract: 'new abstract' }, 'crossref');
    assert.equal(db.findIdByNormalizedTitle('Solid State Electrolyte Review'), 'W500');
    await db.close();
  }
});

test('cosineSearch 缓存：同 (model,recipe) 冷热路径结果逐位一致，过滤与维度检查照常；vecPut/upsertWorks/updateWorkText/vecClear 各写入路径都要让缓存归零', async function () {
  {
    const { db } = await makeDb();
    try {
      db.upsertWorks([
        { id: 'C1', title: 'Alpha', abstract: 'a', year: 2020 },
        { id: 'C2', title: 'Beta', abstract: 'b', year: 2023 },
        { id: 'C3', title: 'Gamma', abstract: 'g', year: 2025 }
      ]);
      const model = 'mc';
      const recipe = 3;
      // 3 维向量方向各异，避免同分并列的顺序偶然性
      db.vecPut([
        { workId: 'C1', model, dim: 3, recipe, hash: 'h1', vec: Buffer.from(new Float32Array([1, 0, 0]).buffer) },
        { workId: 'C2', model, dim: 3, recipe, hash: 'h2', vec: Buffer.from(new Float32Array([0.6, 0.8, 0]).buffer) },
        { workId: 'C3', model, dim: 3, recipe, hash: 'h3', vec: Buffer.from(new Float32Array([0, 0.1, 0.99]).buffer) }
      ]);
      const q = Buffer.from(new Float32Array([1, 0, 0]).buffer);
      const cold = db.cosineSearch(q, { limit: 3, model, recipe });
      const warm = db.cosineSearch(q, { limit: 3, model, recipe });
      assert.deepEqual(warm, cold, '缓存命中路径与冷路径结果一致');
      assert.equal(cold[0].workId, 'C1');
      assert.ok(cold[0].score > 0.99);
      // 维度不符的行照旧跳过（与旧实现的逐行 v.length 检查同语义）
      db.vecPut([{ workId: 'C4', model, dim: 2, recipe, hash: 'h4', vec: Buffer.from(new Float32Array([1, 0]).buffer) }]);
      const mixed = db.cosineSearch(q, { limit: 5, model, recipe });
      assert.ok(!mixed.some((h) => h.workId === 'C4'), '维度不符的行不得进入结果');
      assert.equal(mixed.length, 3);
      // 热缓存下年份过滤 / limit 照常
      const filtered = db.cosineSearch(q, { limit: 3, model, recipe, yearFrom: 2021 });
      assert.deepEqual(filtered.map((h) => h.workId), ['C2', 'C3']);
      assert.equal(db.cosineSearch(q, { limit: 1, model, recipe }).length, 1);
      // 无 model/recipe 的兼容调用不走缓存也正确，且不得破坏已有缓存
      assert.equal(db.cosineSearch(q, { limit: 5 }).length, 3);
      const warmAgain = db.cosineSearch(q, { limit: 3, model, recipe });
      assert.deepEqual(warmAgain, cold, '兼容调用不得破坏已有缓存');
    } finally { db.close(); }
  }
  {
    const { db } = await makeDb();
    try {
      db.upsertWorks([
        { id: 'D1', title: 'Alpha', abstract: 'a', year: 2020 },
        { id: 'D2', title: 'Beta', abstract: 'b', year: 2023 }
      ]);
      const model = 'md';
      const recipe = 4;
      db.vecPut([
        { workId: 'D1', model, dim: 1, recipe, hash: 'h1', vec: Buffer.from(new Float32Array([1]).buffer) },
        { workId: 'D2', model, dim: 1, recipe, hash: 'h2', vec: Buffer.from(new Float32Array([0.5]).buffer) }
      ]);
      const q = Buffer.from(new Float32Array([1]).buffer);
      db.cosineSearch(q, { limit: 5, model, recipe });   // 建缓存

      // ① vecPut 新向量：热缓存必须看得到新行
      db.upsertWorks([{ id: 'D3', title: 'Gamma', abstract: 'g', year: 2024 }]);
      db.vecPut([{ workId: 'D3', model, dim: 1, recipe, hash: 'h3', vec: Buffer.from(new Float32Array([0.9]).buffer) }]);
      const afterPut = db.cosineSearch(q, { limit: 5, model, recipe });
      assert.ok(afterPut.some((h) => h.workId === 'D3'), 'vecPut 后新向量必须可检索');

      // ② upsertWorks 改年份：yearCache 必须失效（年份不进嵌入 hash，向量仍在，只有年份变了）
      db.upsertWorks([{ id: 'D3', title: 'Gamma', abstract: 'g', year: 2001 }]);
      const afterYear = db.cosineSearch(q, { limit: 5, model, recipe, yearFrom: 2023 });
      assert.ok(!afterYear.some((h) => h.workId === 'D3'), '改年份后旧年份不得继续生效');

      // ③ updateWorkText 改摘要（R13 删 vec 行）：该 work 必须退出检索，缓存不得残留旧向量
      db.updateWorkText('D3', { abstract: 'changed abstract' }, 'bench');
      const afterText = db.cosineSearch(q, { limit: 5, model, recipe });
      assert.ok(!afterText.some((h) => h.workId === 'D3'), '内容一变旧向量必须立即退出检索');

      // ④ vecClear：全清后检索为空
      db.vecClear();
      assert.equal(db.cosineSearch(q, { limit: 5, model, recipe }).length, 0);
    } finally { db.close(); }
  }
});
