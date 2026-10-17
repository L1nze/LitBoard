'use strict';

/**
 * LitBoard 调研库存储层（主进程专用，node:sqlite，零外部依赖）。
 *
 * 设计要点：
 * - 双文件：research.db（身份/元数据/引用边/检索史，durable）+ vec.db（向量缓存，
 *   可再生——损坏删除即可重建，不进快照不同步）。身份 id 为代理键永不变更，
 *   DOI / OpenAlex ID 等外部标识进 ext_ids 索引（kind+value 唯一）；
 * - works_fts 为 FTS5 trigram 全文索引（标题+摘要），<3 字符回退 LIKE（比照主库 pdf_fts 惯例）；
 * - 硬规则：任何改写 title/abstract 的路径（回填等）必须同时删除 vec.db 对应行，
 *   否则「摘要已更新、向量还是旧的」会静默失真（上游 harness 实测踩过的坑）；
 * - 幂等：upsertWorks 按 id UPSERT，重复导入/重复检索结果不产生重复行。
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const LitResearch = require('../js/research.js');

const RESEARCH_DB_VERSION = 5;

function createResearchDb(options) {
  const dir = options.dir;
  let works = null;
  let vec = null;
  // cosineSearch 的进程内缓存（闭包状态，随实例生命周期）：
  // - vecCache：单一 (model, recipe) 的平铺向量 + id 列表——语义检索 / find-literature
  //   （最坏 12 论点 × 2 变体连发）反复全扫时，免掉整批 BLOB 读取与对象物化
  //   （实测 20k×1024d 时读库占 ~57%）；年份过滤的全表 id→year 一并缓存（替代逐批 IN 回查，
  //   两库连接本就无法 SQL join）。两者都只加速，不改语义：冷热路径结果逐位一致。
  // 失效钩子挂在所有写 works/vecs 的路径上（upsertWorks / updateWorkText / vecPut /
  // vecDelete / vecClear）。漏挂一处 = 「库里删了向量、缓存里还在」，会绕过 R13 硬规则
  // 静默给出过期命中——动这两个变量前先读这段。
  let vecCache = null;
  let yearCache = null;
  const VEC_CACHE_MAX_BYTES = 256 * 1024 * 1024;

  function invalidateVecCache(withYears) {
    vecCache = null;
    if (withYears) yearCache = null;
  }

  function applyPragmas(db) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA busy_timeout = 5000');
  }

  function userVersionOf(db) {
    const row = db.prepare('PRAGMA user_version').get();
    return row && (row.user_version != null ? row.user_version : Object.values(row)[0]) || 0;
  }

  function columnNames(db, table) {
    const out = {};
    db.prepare('PRAGMA table_info(' + table + ')').all().forEach(function (row) {
      out[String(row.name)] = true;
    });
    return out;
  }

  function addColumnIfMissing(db, table, column, decl) {
    if (columnNames(db, table)[column]) return;
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + decl);
  }

  /**
   * 分步迁移（每步只加不删，老库照常走）：
   * - v1：基础表（works / ext_ids / merge_log / field_provenance / searches / works_fts）；
   * - v2（R15 元数据保真）：works 增 snippet / page_url 两列——网页片段的溯源信息，
   *   旧实现把 snippet 塞进 abstract 之后，调研库里再也分不清「真摘要」与「网页片段」；
   *   works_fts 随之重建为四列（title/abstract/snippet），让网页片段仍然可检索，
   *   而不是靠「污染 abstract」换取可检索性。
   * - v3（R19 临时全文链，对照 literature-mcp 的 fulltext 列）：新增 works_fulltext 侧表
   *   （正文文本与 works 行分离——元数据 upsert 不必反复重写几十万字符的大文本），
   *   works_fts 重建为五列（title/abstract/snippet/fulltext），全文文本进调研库可检索；
   *   全文不属于嵌入配方（title+abstract），不触碰 vec 行。
   * - v4（A-followup #5）：works 增 title_norm 列 + 索引，规范化标题随写入维护、迁移时
   *   一次性回填。旧实现按「被引数前 400 篇」扫标题去重，低被引的既有条目永远匹配不到，
   *   反复检索会为同一篇论文造出重复身份（身份分裂）。
   */
  function migrateWorks(db) {
    const version = userVersionOf(db);
    if (version >= RESEARCH_DB_VERSION) return;
    db.exec('BEGIN');
    try {
      if (version < 1) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS works(
            id TEXT PRIMARY KEY,
            doi TEXT DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            year INTEGER,
            pubdate TEXT DEFAULT '',
            type TEXT DEFAULT '',
            source_id TEXT DEFAULT '',
            source_name TEXT DEFAULT '',
            abstract TEXT DEFAULT '',
            lang TEXT DEFAULT '',
            cited_by INTEGER DEFAULT 0,
            is_oa INTEGER DEFAULT 0,
            oa_url TEXT DEFAULT '',
            authors_json TEXT DEFAULT '[]',
            refs_json TEXT DEFAULT '[]',
            concepts_json TEXT DEFAULT '[]',
            keywords_json TEXT DEFAULT '[]',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_works_doi ON works(doi);
          CREATE INDEX IF NOT EXISTS idx_works_year ON works(year);
          CREATE TABLE IF NOT EXISTS ext_ids(
            work_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY(kind, value)
          );
          CREATE INDEX IF NOT EXISTS idx_ext_ids_work ON ext_ids(work_id);
          CREATE TABLE IF NOT EXISTS merge_log(
            old_id TEXT PRIMARY KEY,
            new_id TEXT NOT NULL,
            at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS field_provenance(
            work_id TEXT NOT NULL,
            field TEXT NOT NULL,
            source TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY(work_id, field)
          );
          CREATE TABLE IF NOT EXISTS searches(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            q TEXT DEFAULT '',
            filters_json TEXT DEFAULT '{}',
            result_count INTEGER DEFAULT 0,
            at INTEGER NOT NULL
          );
          CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
            work_id UNINDEXED, title, abstract, tokenize='trigram'
          );
        `);
      }
      if (version < 2) {
        addColumnIfMissing(db, 'works', 'snippet', "TEXT DEFAULT ''");
        addColumnIfMissing(db, 'works', 'page_url', "TEXT DEFAULT ''");
      }
      if (version < 2 || version < 3) {
        // v2 起四列；v3 起五列（含 fulltext）。重建幂等：FTS 内容全部可从 works + 侧表回填
        db.exec(`
          CREATE TABLE IF NOT EXISTS works_fulltext(
            work_id TEXT PRIMARY KEY,
            content TEXT NOT NULL DEFAULT '',
            chars INTEGER NOT NULL DEFAULT 0,
            fetched_at INTEGER NOT NULL DEFAULT 0
          );
        `);
        db.exec('DROP TABLE IF EXISTS works_fts');
        db.exec("CREATE VIRTUAL TABLE works_fts USING fts5(work_id UNINDEXED, title, abstract, snippet, fulltext, tokenize='trigram')");
        db.exec(`
          INSERT INTO works_fts(work_id, title, abstract, snippet, fulltext)
          SELECT w.id, w.title, w.abstract, w.snippet, COALESCE(f.content, '')
          FROM works w LEFT JOIN works_fulltext f ON f.work_id = w.id
        `);
      }
      if (version < 4) {
        addColumnIfMissing(db, 'works', 'title_norm', "TEXT DEFAULT ''");
        db.exec('CREATE INDEX IF NOT EXISTS idx_works_title_norm ON works(title_norm)');
        // 规范化在 JS 侧算（Unicode 属性类 SQL 表达不了）：迁移时一次性回填，之后随写入维护
        const backfill = db.prepare("SELECT id, title FROM works WHERE title != ''").all();
        const setNorm = db.prepare('UPDATE works SET title_norm = ? WHERE id = ?');
        backfill.forEach(function (row) {
          const norm = LitResearch.normalizeTitleKey(row.title);
          if (norm) setNorm.run(norm, row.id);
        });
      }
      if (version < 5) {
        // v5：存量身份分裂一次性清理（同 DOI 双行合流，详见 dedupeWorksByIdentity）
        dedupeWorksByIdentity(db);
      }
      db.exec('PRAGMA user_version = ' + RESEARCH_DB_VERSION);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  /** v5 迁移：清理历史身份分裂——同一 DOI（大小写不敏感）在 works 落了两行
   *  （DOI 归属汇聚上线前，三处「带 DOI 建 local:」+ W-id 直插造成的存量）。
   *  存活者选择：ext_ids 里该 DOI 的归属行优先（身份可解析），其次非 local: 行，
   *  最后按 id 排序取首个。被并行按「非空字段优先」并入存活者，ext_ids / 全文 /
   *  溯源随行搬家，FTS 重建，旧 id → 新 id 写入 merge_log（getWorks 查询按它
   *  重定向，旧引用不断链）。吸收可能改变存活者文本 → 向量 hash 自然失配，走
   *  既有后台重嵌；被并行在 vec.db 的孤儿向量查不到 works 行，惰性无害。 */
  function dedupeWorksByIdentity(db) {
    // 手搓的旧版本夹具库可能只建了部分表：身份相关表缺任一张就无从合流，跳过
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    const required = ['works', 'ext_ids', 'works_fulltext', 'field_provenance', 'works_fts', 'merge_log'];
    if (required.some(function (name) { return !tableExists.get(name); })) return;
    const groups = new Map();
    db.prepare("SELECT id, doi FROM works WHERE doi != ''").all().forEach(function (row) {
      const key = String(row.doi).toLowerCase();
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(row.id);
    });
    db.prepare("SELECT work_id, value FROM ext_ids WHERE kind = 'doi'").all().forEach(function (ext) {
      const key = String(ext.value).toLowerCase();
      if (groups.has(key)) groups.get(key).add(ext.work_id);
    });
    const extOwnerOf = db.prepare("SELECT work_id FROM ext_ids WHERE kind = 'doi' AND lower(value) = ? LIMIT 1");
    const absorb = db.prepare(`
      UPDATE works AS s SET
        doi = CASE WHEN s.doi = '' AND d.doi != '' THEN d.doi ELSE s.doi END,
        title = CASE WHEN s.title = '' AND d.title != '' THEN d.title ELSE s.title END,
        title_norm = CASE WHEN s.title_norm = '' AND d.title_norm != '' THEN d.title_norm ELSE s.title_norm END,
        year = CASE WHEN s.year IS NULL THEN d.year ELSE s.year END,
        pubdate = CASE WHEN s.pubdate = '' AND d.pubdate != '' THEN d.pubdate ELSE s.pubdate END,
        type = CASE WHEN s.type = '' AND d.type != '' THEN d.type ELSE s.type END,
        source_id = CASE WHEN s.source_id = '' AND d.source_id != '' THEN d.source_id ELSE s.source_id END,
        source_name = CASE WHEN s.source_name = '' AND d.source_name != '' THEN d.source_name ELSE s.source_name END,
        abstract = CASE WHEN s.abstract = '' AND d.abstract != '' THEN d.abstract ELSE s.abstract END,
        snippet = CASE WHEN s.snippet = '' AND d.snippet != '' THEN d.snippet ELSE s.snippet END,
        page_url = CASE WHEN s.page_url = '' AND d.page_url != '' THEN d.page_url ELSE s.page_url END,
        lang = CASE WHEN s.lang = '' AND d.lang != '' THEN d.lang ELSE s.lang END,
        cited_by = MAX(s.cited_by, d.cited_by),
        is_oa = MAX(s.is_oa, d.is_oa),
        oa_url = CASE WHEN s.oa_url = '' AND d.oa_url != '' THEN d.oa_url ELSE s.oa_url END,
        authors_json = CASE WHEN s.authors_json = '[]' AND d.authors_json != '[]' THEN d.authors_json ELSE s.authors_json END,
        refs_json = CASE WHEN s.refs_json = '[]' AND d.refs_json != '[]' THEN d.refs_json ELSE s.refs_json END,
        concepts_json = CASE WHEN s.concepts_json = '[]' AND d.concepts_json != '[]' THEN d.concepts_json ELSE s.concepts_json END,
        keywords_json = CASE WHEN s.keywords_json = '[]' AND d.keywords_json != '[]' THEN d.keywords_json ELSE s.keywords_json END
      FROM works AS d WHERE s.id = ? AND d.id = ?`);
    // ext 行搬家是「改指向」不是复制：PK(kind, value) 下同键插入会被 IGNORE，
    // 旧指向留着会指向已删除的并行（findByExtId 解析回死 id）
    const moveExts = db.prepare('UPDATE ext_ids SET work_id = ? WHERE work_id = ?');
    const moveFulltext = db.prepare(`INSERT OR IGNORE INTO works_fulltext(work_id, content, chars, fetched_at)
      SELECT ?, content, chars, fetched_at FROM works_fulltext WHERE work_id = ?`);
    const moveProvenance = db.prepare(`INSERT OR REPLACE INTO field_provenance(work_id, field, source, fetched_at)
      SELECT ?, field, source, fetched_at FROM field_provenance WHERE work_id = ?`);
    const dropFts = db.prepare('DELETE FROM works_fts WHERE work_id = ?');
    const rebuildFts = db.prepare(`INSERT INTO works_fts(work_id, title, abstract, snippet, fulltext)
      SELECT w.id, w.title, w.abstract, w.snippet, COALESCE(f.content, '') FROM works w
      LEFT JOIN works_fulltext f ON f.work_id = w.id WHERE w.id = ?`);
    const dropWork = db.prepare('DELETE FROM works WHERE id = ?');
    const logMerge = db.prepare('INSERT OR REPLACE INTO merge_log(old_id, new_id, at) VALUES(?, ?, ?)');
    const now = Date.now();
    groups.forEach(function (members, key) {
      if (members.size < 2) return;
      const list = Array.from(members);
      const extOwner = (extOwnerOf.get(key) || {}).work_id;
      const survivor = (extOwner && list.indexOf(extOwner) >= 0 ? extOwner : '') ||
        list.find(function (id) { return id.indexOf('local:') !== 0; }) ||
        list.slice().sort()[0];
      const touchedFts = new Set([survivor]);
      list.forEach(function (dup) {
        if (dup === survivor) return;
        absorb.run(survivor, dup);
        moveExts.run(survivor, dup);
        moveFulltext.run(survivor, dup);
        moveProvenance.run(survivor, dup);
        dropFts.run(dup);
        dropWork.run(dup);
        logMerge.run(dup, survivor, now);
        touchedFts.add(survivor);
      });
      touchedFts.forEach(function (id) {
        dropFts.run(id);
        rebuildFts.run(id);
      });
    });
  }

  function migrateVec(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vecs(
        work_id TEXT PRIMARY KEY,
        model TEXT DEFAULT '',
        dim INTEGER DEFAULT 0,
        recipe INTEGER DEFAULT 0,
        content_hash TEXT DEFAULT '',
        vec BLOB,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  async function open() {
    await fs.mkdir(dir, { recursive: true });
    vecCache = null;
    yearCache = null;
    works = new DatabaseSync(path.join(dir, 'research.db'));
    applyPragmas(works);
    migrateWorks(works);
    vec = new DatabaseSync(path.join(dir, 'vec.db'));
    applyPragmas(vec);
    migrateVec(vec);
  }

  function ensureOpen() {
    if (!works) throw new Error('research db not opened');
  }

  function rowToWork(row) {
    if (!row) return null;
    return {
      id: row.id,
      doi: row.doi || '',
      title: row.title || '',
      year: row.year == null ? null : Number(row.year),
      pubdate: row.pubdate || '',
      type: row.type || '',
      sourceId: row.source_id || '',
      sourceName: row.source_name || '',
      abstract: row.abstract || '',
      snippet: row.snippet || '',
      pageUrl: row.page_url || '',
      lang: row.lang || '',
      citedBy: Number(row.cited_by) || 0,
      isOa: !!row.is_oa,
      oaUrl: row.oa_url || '',
      authors: parseJsonArray(row.authors_json),
      refs: parseJsonArray(row.refs_json),
      concepts: parseJsonArray(row.concepts_json),
      keywords: parseJsonArray(row.keywords_json),
      // v3 临时全文链：字符数即「有没有全文」的信号（正文本体只在 works_fulltext 侧表）
      fulltextChars: Number(row.fulltext_chars) || 0
    };
  }

  function parseJsonArray(value) {
    try {
      const parsed = JSON.parse(value == null ? '[]' : value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) { return []; }
  }

  function workToColumns(row) {
    const now = Date.now();
    return {
      id: String(row.id || ''),
      doi: String(row.doi || ''),
      title: String(row.title || '').slice(0, 4000),
      // v4：规范化标题随行写入（findIdByNormalizedTitle 走这个索引列精确命中）
      title_norm: LitResearch.normalizeTitleKey(row.title).slice(0, 4000),
      year: Number(row.year) || null,
      pubdate: String(row.pubdate || '').slice(0, 10),
      type: String(row.type || '').slice(0, 60),
      source_id: String(row.sourceId || '').slice(0, 60),
      source_name: String(row.sourceName || '').slice(0, 400),
      abstract: String(row.abstract || '').slice(0, 200000),
      snippet: String(row.snippet || '').slice(0, 2000),
      page_url: String(row.pageUrl || '').slice(0, 1000),
      lang: String(row.lang || '').slice(0, 12),
      cited_by: Number(row.citedBy) || 0,
      is_oa: row.isOa === true ? 1 : 0,
      oa_url: String(row.oaUrl || '').slice(0, 1000),
      authors_json: JSON.stringify(Array.isArray(row.authors) ? row.authors : []),
      refs_json: JSON.stringify(Array.isArray(row.refs) ? row.refs.map(String) : []),
      concepts_json: JSON.stringify(Array.isArray(row.concepts) ? row.concepts.map(String) : []),
      keywords_json: JSON.stringify(Array.isArray(row.keywords) ? row.keywords.map(String) : []),
      now: now
    };
  }

  /** vec 整行快照 / 回填：works 事务回滚时恢复跨库已删的向量（见 upsertWorks
   *  内 vecBackup 注释）。回填用 ON CONFLICT DO NOTHING——回滚路径上 vec 行
   *  若仍在（删除语句本身失败），保持原行不动。 */
  function snapshotVecRows(ids) {
    if (!vec || !ids || !ids.length) return [];
    const stmt = vec.prepare('SELECT work_id, model, dim, recipe, content_hash, vec, updated_at FROM vecs WHERE work_id = ?');
    return ids.map(function (id) { return stmt.get(id); }).filter(Boolean);
  }

  function restoreVecRows(rows) {
    if (!vec || !rows || !rows.length) return;
    const stmt = vec.prepare(`INSERT INTO vecs(work_id, model, dim, recipe, content_hash, vec, updated_at)
      VALUES(@work_id, @model, @dim, @recipe, @content_hash, @vec, @updated_at)
      ON CONFLICT(work_id) DO NOTHING`);
    vec.exec('BEGIN');
    try {
      rows.forEach(function (row) { stmt.run(row); });
      vec.exec('COMMIT');
    } catch (error) {
      vec.exec('ROLLBACK');
      throw error;
    }
  }

  /** 身份纪律（代理键永不变更）的入库汇聚侧：行带 DOI 时先解析归属——
   *  ext_ids 已绑定的 owner 或 works.doi 列先到者。归属存在且不是自己 → 该行
   *  并入 owner（以 owner 为 id 更新字段、DOI 与原 W-id 注册为 owner 的 ext_ids），
   *  不另开新行。效果：新纪律下「DOI 只进列不进 ext_ids」的 local 行，与存量
   *  已分裂的库（doi 已绑 local:）在下次 OpenAlex/S2 入库时都合流到单行。
   *  opts.suppressDoiExt：创建侧专用——新建 local: 行不把 DOI 绑进 ext_ids
   *  （绑了会挡住日后的真实身份解析），DOI 只留在 works.doi 列等待汇聚。
   *  返回 { count, redirects }：redirects[原id] = 归并后的 id，创建侧据此回传真实身份。 */
  function upsertWorks(rows, opts) {
    ensureOpen();
    const options = opts && typeof opts === 'object' ? opts : {};
    const list = (Array.isArray(rows) ? rows : []).filter(function (row) { return row && row.id; });
    if (!list.length) return { count: 0, redirects: {} };
    const redirects = {}; // try 块外声明：return 在 catch 之后仍可见
    let vecBackup = null; // vec 删除前的整行快照，works 回滚时回填
    works.exec('BEGIN');
    try {
      const upsert = works.prepare(`
        INSERT INTO works(id, doi, title, title_norm, year, pubdate, type, source_id, source_name,
          abstract, snippet, page_url, lang, cited_by, is_oa, oa_url, authors_json, refs_json,
          concepts_json, keywords_json, created_at, updated_at)
        VALUES(@id, @doi, @title, @title_norm, @year, @pubdate, @type, @source_id, @source_name,
          @abstract, @snippet, @page_url, @lang, @cited_by, @is_oa, @oa_url, @authors_json, @refs_json,
          @concepts_json, @keywords_json, @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          doi = CASE WHEN excluded.doi != '' THEN excluded.doi ELSE works.doi END,
          title = CASE WHEN excluded.title != '' THEN excluded.title ELSE works.title END,
          title_norm = CASE WHEN excluded.title != '' THEN excluded.title_norm ELSE works.title_norm END,
          year = COALESCE(excluded.year, works.year),
          pubdate = CASE WHEN excluded.pubdate != '' THEN excluded.pubdate ELSE works.pubdate END,
          type = CASE WHEN excluded.type != '' THEN excluded.type ELSE works.type END,
          source_id = CASE WHEN excluded.source_id != '' THEN excluded.source_id ELSE works.source_id END,
          source_name = CASE WHEN excluded.source_name != '' THEN excluded.source_name ELSE works.source_name END,
          abstract = CASE WHEN excluded.abstract != '' THEN excluded.abstract ELSE works.abstract END,
          snippet = CASE WHEN excluded.snippet != '' THEN excluded.snippet ELSE works.snippet END,
          page_url = CASE WHEN excluded.page_url != '' THEN excluded.page_url ELSE works.page_url END,
          lang = CASE WHEN excluded.lang != '' THEN excluded.lang ELSE works.lang END,
          cited_by = MAX(excluded.cited_by, works.cited_by),
          is_oa = MAX(excluded.is_oa, works.is_oa),
          oa_url = CASE WHEN excluded.oa_url != '' THEN excluded.oa_url ELSE works.oa_url END,
          authors_json = CASE WHEN excluded.authors_json != '[]' THEN excluded.authors_json ELSE works.authors_json END,
          refs_json = CASE WHEN excluded.refs_json != '[]' THEN excluded.refs_json ELSE works.refs_json END,
          concepts_json = CASE WHEN excluded.concepts_json != '[]' THEN excluded.concepts_json ELSE works.concepts_json END,
          keywords_json = CASE WHEN excluded.keywords_json != '[]' THEN excluded.keywords_json ELSE works.keywords_json END,
          updated_at = excluded.updated_at
      `);
      const ftsDelete = works.prepare('DELETE FROM works_fts WHERE work_id = ?');
      // v3：FTS 行的 fulltext 列来自 works_fulltext 侧表（元数据刷新不重写大文本，FTS 仍可见）
      const ftsInsert = works.prepare(`INSERT INTO works_fts(work_id, title, abstract, snippet, fulltext)
        VALUES(?, ?, ?, ?, COALESCE((SELECT content FROM works_fulltext WHERE work_id = ?), ''))`);
      const readMerged = works.prepare('SELECT title, abstract, snippet, concepts_json, keywords_json FROM works WHERE id = ?');
      // 变前镜像：FTS 只是 works 的镜像，内容没变就不重建——重建要删行 + 对 title/abstract/snippet
      // 重新分词，且 fulltext 列还要回读侧表（最多 40 万字符）。检索类工具一次调用会 upsert
      // 上百行（find_literature 的每条召回都过这里），这笔开销是「Agent 一调工具就卡」的主要来源之一
      const readPrevious = works.prepare('SELECT title, abstract, snippet FROM works WHERE id = ?');
      const vecHashRead = vec ? vec.prepare('SELECT content_hash FROM vecs WHERE work_id = ?') : null;
      const extInsert = works.prepare('INSERT OR IGNORE INTO ext_ids(work_id, kind, value) VALUES(?, ?, ?)');
      const doiOwnerByExt = works.prepare("SELECT work_id AS wid FROM ext_ids WHERE kind = 'doi' AND lower(value) = lower(?) LIMIT 1");
      const doiOwnerByColumn = works.prepare("SELECT id AS wid FROM works WHERE doi != '' AND lower(doi) = lower(?) AND id != ? LIMIT 1");
      const staleVecIds = [];
      list.forEach(function (row) {
        // DOI 归属重定向（见函数头注释）：同一论文绝不落两行。
        // ext_ids / works.doi 存的都是调用方给的原始串——裸 DOI 与 URL 形式
        // （https://doi.org/…）、大小写差异都会让 lower() 直比落空，两种形态各试一次
        let target = row;
        const doi = String(row.doi || '').trim();
        if (doi) {
          const normDoi = LitResearch.normalizeDoi(doi);
          const variants = normDoi && normDoi !== doi.toLowerCase() ? [doi, normDoi] : [doi];
          let owner = '';
          for (const candidate of variants) {
            owner = (doiOwnerByExt.get(candidate) || {}).wid ||
              (doiOwnerByColumn.get(candidate, row.id) || {}).wid || '';
            if (owner) break;
          }
          if (owner && owner !== row.id) {
            target = Object.assign({}, row, { id: owner });
            redirects[row.id] = owner;
          }
        }
        const c = workToColumns(target);
        const previous = readPrevious.get(c.id) || null;
        upsert.run(c);
        // R09：FTS 用「UPSERT 后数据库实际保留的合并行」重建——UPSERT 是非空补齐语义，
        // 直接拿输入值写 FTS 会把「空摘要不覆盖」变成「空摘要清掉检索命中」
        const merged = readMerged.get(c.id) || { title: '', abstract: '', snippet: '' };
        const ftsUnchanged = !!previous &&
          String(previous.title || '') === String(merged.title || '') &&
          String(previous.abstract || '') === String(merged.abstract || '') &&
          String(previous.snippet || '') === String(merged.snippet || '');
        if (!ftsUnchanged) {
          ftsDelete.run(c.id);
          ftsInsert.run(c.id, merged.title || '', merged.abstract || '', merged.snippet || '', c.id);
        }
        // R13：嵌入相关文本（title/abstract/concepts/keywords）的 hash 变了 → 旧向量立即失效
        const hash = LitResearch.embeddingHash({
          title: merged.title || '', abstract: merged.abstract || '',
          concepts: parseJsonArray(merged.concepts_json), keywords: parseJsonArray(merged.keywords_json)
        });
        const before = vecHashRead ? vecHashRead.get(c.id) : null;
        if (before && before.content_hash !== hash) staleVecIds.push(c.id);
        // ext_ids：重定向发生时说明 owner 实际存在，DOI 如实绑定（不受 suppress 影响），
        // 原身份（OpenAlex W-id）也登记到 owner 供日后按 W-id 反查；suppressDoiExt
        // 只对「没有 owner 的新建 local 行」生效——DOI 留在列上等未来汇聚认领
        const bindDoi = c.doi && (!options.suppressDoiExt || redirects[row.id]);
        const exts = LitResearch.extIdsForRow({ id: c.id, doi: bindDoi ? c.doi : '' });
        if (redirects[row.id] && String(row.id).indexOf('local:') !== 0) {
          exts.push({ kind: 'openalex', value: String(row.id) });
        }
        exts.forEach(function (ext) {
          extInsert.run(c.id, ext.kind, ext.value);
        });
      });
      if (vec && staleVecIds.length) {
        // vec 与 works 是两个独立 SQLite 连接：vec 删除无法随 works 事务回滚。
        // 删前快照整行，works ROLLBACK 时原样回填——否则 COMMIT 失败会把
        // 「内容没变」的向量也丢掉，下次构建白付一次嵌入计费
        vecBackup = snapshotVecRows(staleVecIds);
        const vecDeleteStmt = vec.prepare('DELETE FROM vecs WHERE work_id = ?');
        staleVecIds.forEach(function (id) { vecDeleteStmt.run(id); });
      }
      works.exec('COMMIT');
      // 新增 id / 年份变化 / stale 向量删除都发生在这里：向量与年份缓存一起失效
      invalidateVecCache(true);
    } catch (error) {
      works.exec('ROLLBACK');
      if (vecBackup && vecBackup.length) {
        try { restoreVecRows(vecBackup); invalidateVecCache(true); }
        catch (restoreError) { /* 回填失败保持旧语义：下次构建重新嵌入 */ }
      }
      throw error;
    }
    return { count: list.length, redirects: redirects };
  }

  function workSummary(row) {
    return {
      id: row.id,
      doi: row.doi || '',
      title: row.title || '',
      year: row.year == null ? null : Number(row.year),
      sourceName: row.source_name || '',
      citedBy: Number(row.cited_by) || 0,
      isOa: !!row.is_oa,
      oaUrl: row.oa_url || '',
      type: row.type || '',
      // R15：摘要与网页片段分开返回——界面上「网页片段」不能显示成摘要
      abstract: row.abstract || '',
      snippet: row.snippet || '',
      pageUrl: row.page_url || '',
      hasAbstract: !!(row.abstract && row.abstract.length)
    };
  }

  function buildFilterClause(filters) {
    const where = [];
    const params = {};
    if (filters.yearFrom != null && isFinite(Number(filters.yearFrom))) {
      where.push('year >= @yearFrom');
      params.yearFrom = Number(filters.yearFrom);
    }
    if (filters.yearTo != null && isFinite(Number(filters.yearTo))) {
      where.push('year <= @yearTo');
      params.yearTo = Number(filters.yearTo);
    }
    return { where: where, params: params };
  }

  function queryWorks(input) {
    ensureOpen();
    const q = String((input && input.q) || '').trim();
    const limit = Math.max(1, Math.min(100, Number(input && input.limit) || 20));
    const offset = Math.max(0, Number(input && input.offset) || 0);
    const filter = buildFilterClause(input || {});
    const where = filter.where.slice();
    const params = Object.assign({}, filter.params);
    let from = 'works';

    // DOI 精确命中优先（调研场景里贴一个 DOI 直接定位一篇）
    const doi = LitResearch.normalizeDoi(q);
    if (doi && /^10\.\d{4,9}\//.test(doi)) {
      where.push('doi = @doiExact');
      params.doiExact = doi;
    } else if (q && /^[WSIACPF]\d+$/i.test(q)) {
      where.push('id = @idExact');
      params.idExact = q.toUpperCase();
    } else if (q && [...q].length >= 3) {
      // S3：空格分词 = AND 语义（工具与面板都这么声明）——每个词各自命中才返回；
      // 连续短语需显式引号（"deep learning"）。trigram 只能匹配 ≥3 字符的词，
      // 更短的词走 LIKE 兜底（中文按字符数，[...t] 计码点）
      const tokens = (q.match(/"[^"]+"|\S+/g) || []).map(function (t) { return t.replace(/^"|"$/g, ''); }).filter(Boolean);
      const ftsTokens = [];
      const likeTokens = [];
      tokens.forEach(function (t) {
        const norm = '"' + t.replace(/"/g, '""') + '"';
        // LIKE 用裸词（不带 FTS 引号）——旧写法从带引号的 norm 反剥，无内嵌引号时
        // 反剥不动，'%\"词\"%' 永远匹配不上（混词分支的潜伏 bug，短词一多即现形）
        ([...t].length >= 3 ? ftsTokens : likeTokens).push({ norm: norm, bare: t });
      });
      if (!ftsTokens.length && likeTokens.length) {
        // 全是短词：同样保持逐词 AND（S3 语义声明），只是全部走 LIKE——
        // 旧写法对整串 q 做单个 %q%，"AI 模型" 会要求连续子串而非两词各命中
        likeTokens.forEach(function (token, idx) {
          where.push("(works.title LIKE @likeS" + idx + " OR works.abstract LIKE @likeS" + idx + ")");
          params['likeS' + idx] = '%' + token.bare + '%';
        });
      } else {
        from = 'works JOIN works_fts ON works.id = works_fts.work_id';
        where.push('works_fts MATCH @fts');
        params.fts = ftsTokens.map(function (token) { return token.norm; }).join(' AND ');
        likeTokens.forEach(function (token, idx) {
          where.push("(works.title LIKE @likeS" + idx + " OR works.abstract LIKE @likeS" + idx + ")");
          params['likeS' + idx] = '%' + token.bare + '%';
        });
      }
    } else if (q) {
      where.push("(works.title LIKE @like OR works.abstract LIKE @like)");
      params.like = '%' + q + '%';
    }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const columns = 'works.id AS id, works.doi AS doi, works.title AS title, works.year AS year, ' +
      'works.source_name AS source_name, works.cited_by AS cited_by, works.is_oa AS is_oa, ' +
      'works.abstract AS abstract, works.snippet AS snippet, works.page_url AS page_url, ' +
      'works.type AS type, works.oa_url AS oa_url';
    // 命中总数不再单独 COUNT：trigram 命中多时 COUNT 要把全部命中枚举一遍（实测万级库 ~74ms，
    // 每次检索白付一次）。这里只需要「够不够翻页」——取满一页就回报「至少 N 条」并打上
    // totalIsLowerBound，取不满时 offset + rows.length 就是精确值
    const rows = works.prepare(
      'SELECT ' + columns + ' FROM ' + from + whereSql +
      ' ORDER BY works.cited_by DESC, works.id ASC LIMIT @limit OFFSET @offset'
    ).all(Object.assign({}, params, { limit: limit, offset: offset }));
    return {
      total: offset + rows.length,
      totalIsLowerBound: rows.length >= limit,
      works: rows.map(workSummary)
    };
  }

  function getWorks(ids) {
    ensureOpen();
    // 上限 500：引文网络按「请求的文献集合」建图（诱导子图）时要一次装整批种子；
    // 卡在 50 会让「>120 篇按被引/PageRank 择优截取」这条可读性路径永远无法触发
    const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 500);
    if (!list.length) return [];
    // 旧 id 先经 merge_log 重定向（v5 身份合流后，会话/历史里存的旧 id 仍可用）
    const redirect = works.prepare('SELECT new_id FROM merge_log WHERE old_id = ?');
    const resolve = function (id) {
      let current = id;
      for (let hops = 0; hops < 8; hops++) {
        const row = redirect.get(current);
        if (!row) break;
        current = row.new_id;
      }
      return current;
    };
    const resolved = list.map(resolve);
    const placeholders = resolved.map(function () { return '?'; }).join(',');
    const stmt = works.prepare(`SELECT works.*, (SELECT chars FROM works_fulltext f WHERE f.work_id = works.id) AS fulltext_chars FROM works WHERE works.id IN (${placeholders})`);
    const rows = stmt.all(...resolved);
    return rows.map(rowToWork);
  }

  /**
   * v3 临时全文链（R19，对照 literature-mcp 的 fulltext）：正文窗口读取。
   * 返回 { workId, charTotal, fromChar, text }；无全文时返回 null。
   * 窗口化在库侧完成——几十万字符的正文不整段过 IPC。
   */
  function getFulltextWindow(workId, fromChar, length) {
    ensureOpen();
    const row = works.prepare('SELECT content, chars FROM works_fulltext WHERE work_id = ?')
      .get(String(workId || ''));
    if (!row || !row.content) return null;
    const total = Number(row.chars) || row.content.length;
    const from = Math.max(0, Math.min(Math.floor(Number(fromChar) || 0), Math.max(0, total - 1)));
    const len = Math.max(200, Math.min(20000, Math.floor(Number(length) || 10000)));
    return {
      workId: String(workId || ''),
      charTotal: total,
      fromChar: from,
      text: row.content.slice(from, from + len)
    };
  }

  /**
   * 存全文文本并重建该行的 FTS（fulltext 列可见）；元数据 upsert 不触碰这里。
   * 嵌入配方不含全文，无需失效向量。空文本拒绝写入（抽取失败不该清掉已有全文）。
   */
  function upsertFulltext(workId, text, fetchedAt) {
    ensureOpen();
    const id = String(workId || '');
    const content = String(text == null ? '' : text);
    if (!id || !content.trim()) return 0;
    const capped = content.length > 400000 ? content.slice(0, 400000) : content;
    works.prepare(`INSERT INTO works_fulltext(work_id, content, chars, fetched_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(work_id) DO UPDATE SET content = excluded.content, chars = excluded.chars, fetched_at = excluded.fetched_at`)
      .run(id, capped, capped.length, Math.floor(Number(fetchedAt) || Date.now()));
    const merged = works.prepare('SELECT title, abstract, snippet FROM works WHERE id = ?').get(id);
    if (merged) {
      works.prepare('DELETE FROM works_fts WHERE work_id = ?').run(id);
      works.prepare(`INSERT INTO works_fts(work_id, title, abstract, snippet, fulltext) VALUES(?, ?, ?, ?, ?)`)
        .run(id, merged.title || '', merged.abstract || '', merged.snippet || '', capped);
    }
    return capped.length;
  }

  function findByExtId(kind, value) {
    ensureOpen();
    const row = works.prepare('SELECT work_id FROM ext_ids WHERE kind = ? AND value = ?')
      .get(String(kind || ''), String(value || ''));
    return row ? row.work_id : null;
  }

  /** 引文邻接快照（R18 graph_neighbors 工具）：全库 (id → 它引用的 workId 列表)。
   *  只取两列，不做 rowToWork 的全文解析——万级文献也在毫秒量级。 */
  function getRefsSnapshot() {
    ensureOpen();
    const rows = works.prepare('SELECT id, refs_json FROM works').all();
    const out = [];
    for (const row of rows) {
      const refs = parseJsonArray(row.refs_json);
      if (refs.length) out.push({ id: row.id, refs: refs });
    }
    return out;
  }

  /** 给既有身份追加外部标识（网页检索结果的 URL 归属；kind+value 唯一，重复静默忽略） */
  function addExtIds(workId, items) {
    ensureOpen();
    const id = String(workId || '');
    if (!id) return { count: 0 };
    const stmt = works.prepare('INSERT OR IGNORE INTO ext_ids(work_id, kind, value) VALUES(?, ?, ?)');
    let count = 0;
    works.exec('BEGIN');
    try {
      (Array.isArray(items) ? items : []).forEach(function (item) {
        if (item && item.kind && item.value) {
          const r = stmt.run(id, String(item.kind), String(item.value));
          count += Number(r.changes) || 0;
        }
      });
      works.exec('COMMIT');
    } catch (error) {
      works.exec('ROLLBACK');
      throw error;
    }
    return { count: count };
  }

  /** 标题精确匹配（规范化后）：网页检索结果按标题补身份归属用。
   *  A-followup #5：走 v4 的 title_norm 索引——旧实现「按被引数取前 400 篇再逐行比对」，
   *  低被引的既有条目永远匹配不到，同一篇论文会被反复建成新的 local: 身份。 */
  function findIdByNormalizedTitle(title) {
    ensureOpen();
    const norm = LitResearch.normalizeTitleKey(title);
    if (norm.length < 8) return null;
    const row = works.prepare('SELECT id FROM works WHERE title_norm = ? LIMIT 1').get(norm);
    return row ? row.id : null;
  }

  function recordSearch(input) {
    ensureOpen();
    works.prepare('INSERT INTO searches(q, filters_json, result_count, at) VALUES(?, ?, ?, ?)')
      .run(String((input && input.q) || '').slice(0, 500),
        JSON.stringify((input && input.filters) || {}),
        Number((input && input.count) || 0), Date.now());
  }

  /**
   * 改写 title/abstract（回填链等）：
   * - 空值不覆盖（回填失败绝不能清掉已有内容）；
   * - 写 field_provenance 记录来源与时间；
   * - 【硬规则】同时删除 vec.db 对应行——向量必须随内容失效。
   */
  function updateWorkText(workId, patch, source) {
    ensureOpen();
    const id = String(workId || '');
    if (!id) return { updated: 0 };
    const sets = [];
    const params = { id: id, now: Date.now() };
    if (patch && patch.title) {
      sets.push('title = @title');
      // v4：title_norm 必须跟着 title 一起改，否则改过标题的行再也匹配不到（身份去重失效）
      sets.push('title_norm = @title_norm');
      params.title = String(patch.title).slice(0, 4000);
      params.title_norm = LitResearch.normalizeTitleKey(patch.title).slice(0, 4000);
    }
    if (patch && patch.abstract) { sets.push('abstract = @abstract'); params.abstract = String(patch.abstract).slice(0, 200000); }
    if (!sets.length) return { updated: 0 };
    // 内容未变短路（2026-10 对照上游 literature-mcp works_fts_update 触发器的 WHEN 守卫）：
    // 相同文本再写一遍不做任何事——FTS 删插（fulltext 列要回读侧表最多 40 万字符）、
    // vec 行删除（下次构建会把没变的内容白重新计费嵌入一遍）、provenance 重写全省掉。
    // 幂等回填（同一摘要写两次）不再制造「删了向量又重嵌」的假待办。
    const current = works.prepare('SELECT title, abstract FROM works WHERE id = ?').get(id);
    if (!current) return { updated: 0 };
    const titleUnchanged = !params.title || String(current.title || '') === params.title;
    const abstractUnchanged = !params.abstract || String(current.abstract || '') === params.abstract;
    if (titleUnchanged && abstractUnchanged) return { updated: 0 };
    sets.push('updated_at = @now');
    works.exec('BEGIN');
    let vecBackup = null;
    try {
      const result = works.prepare('UPDATE works SET ' + sets.join(', ') + ' WHERE id = @id').run(params);
      const changed = Number(result.changes) || 0;
      if (changed) {
        // FTS 行必须带 fulltext 列（v3 五列）：只写四列会把该文献的正文从检索索引里抹掉
        // （works_fts.fulltext 来自 works_fulltext 侧表，元数据更新不该动它）
        const ftsInsert = works.prepare(`INSERT INTO works_fts(work_id, title, abstract, snippet, fulltext)
          VALUES(?, ?, ?, ?, COALESCE((SELECT content FROM works_fulltext WHERE work_id = ?), ''))`);
        const row = works.prepare('SELECT title, abstract, snippet FROM works WHERE id = ?').get(id);
        works.prepare('DELETE FROM works_fts WHERE work_id = ?').run(id);
        ftsInsert.run(id, row.title || '', row.abstract || '', row.snippet || '', id);
        const prov = works.prepare(`
          INSERT INTO field_provenance(work_id, field, source, fetched_at) VALUES(@id, @field, @source, @now)
          ON CONFLICT(work_id, field) DO UPDATE SET source = excluded.source, fetched_at = excluded.fetched_at
        `);
        if (params.title) prov.run({ id: id, field: 'title', source: String(source || ''), now: params.now });
        if (params.abstract) prov.run({ id: id, field: 'abstract', source: String(source || ''), now: params.now });
        // vec 删除同样跨库：删前快照，works 回滚时回填（同 upsertWorks）
        if (vec) {
          vecBackup = snapshotVecRows([id]);
          vec.prepare('DELETE FROM vecs WHERE work_id = ?').run(id);
        }
      }
      works.exec('COMMIT');
      invalidateVecCache(true);
      return { updated: changed };
    } catch (error) {
      works.exec('ROLLBACK');
      if (vecBackup && vecBackup.length) {
        try { restoreVecRows(vecBackup); invalidateVecCache(true); }
        catch (restoreError) { /* 回填失败保持旧语义：下次构建重新嵌入 */ }
      }
      throw error;
    }
  }

  function stats() {
    ensureOpen();
    const row = works.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN abstract != '' THEN 1 ELSE 0 END) AS withAbstract,
        COUNT(DISTINCT source_id) AS sources,
        MIN(year) AS minYear, MAX(year) AS maxYear,
        (SELECT COUNT(*) FROM searches) AS searches
      FROM works
    `).get();
    const vecCount = vec ? Number(vec.prepare('SELECT COUNT(*) AS n FROM vecs').get().n) || 0 : 0;
    return {
      total: Number(row.total) || 0,
      withAbstract: Number(row.withAbstract) || 0,
      sources: Number(row.sources) || 0,
      minYear: row.minYear == null ? null : Number(row.minYear),
      maxYear: row.maxYear == null ? null : Number(row.maxYear),
      searches: Number(row.searches) || 0,
      vectors: vecCount
    };
  }

  function close() {
    if (works) { try { works.close(); } catch (error) {} works = null; }
    if (vec) { try { vec.close(); } catch (error) {} vec = null; }
    vecCache = null;
    yearCache = null;
  }

  /* ---------------- 向量层（vec.db；可再生缓存，损坏删库重建即可） ---------------- */

  function vecEnsure() { ensureOpen(); if (!vec) throw new Error('vec db not opened'); }

  /** 批量写入向量（UPSERT；content_hash 记录配方内容指纹） */
  function vecPut(batch) {
    vecEnsure();
    const list = (Array.isArray(batch) ? batch : []).filter(function (item) {
      return item && item.workId && item.vec;
    });
    if (!list.length) return { count: 0 };
    vec.exec('BEGIN');
    try {
      const stmt = vec.prepare(`
        INSERT INTO vecs(work_id, model, dim, recipe, content_hash, vec, updated_at)
        VALUES(@workId, @model, @dim, @recipe, @hash, @vec, @now)
        ON CONFLICT(work_id) DO UPDATE SET
          model = excluded.model, dim = excluded.dim, recipe = excluded.recipe,
          content_hash = excluded.content_hash, vec = excluded.vec, updated_at = excluded.updated_at
      `);
      const now = Date.now();
      list.forEach(function (item) {
        stmt.run({
          workId: String(item.workId),
          model: String(item.model || ''),
          dim: Number(item.dim) || 0,
          recipe: Number(item.recipe) || 0,
          hash: String(item.hash || ''),
          vec: item.vec,
          now: now
        });
      });
      vec.exec('COMMIT');
      invalidateVecCache(false);
    } catch (error) {
      vec.exec('ROLLBACK');
      throw error;
    }
    return { count: list.length };
  }

  function vecDelete(workIds) {
    vecEnsure();
    const list = (Array.isArray(workIds) ? workIds : []).map(String).filter(Boolean);
    if (!list.length) return;
    const stmt = vec.prepare('DELETE FROM vecs WHERE work_id = ?');
    vec.exec('BEGIN');
    try {
      list.forEach(function (id) { stmt.run(id); });
      vec.exec('COMMIT');
      invalidateVecCache(false);
    } catch (error) {
      vec.exec('ROLLBACK');
      throw error;
    }
  }

  function vecClear() {
    vecEnsure();
    vec.exec('DELETE FROM vecs');
    invalidateVecCache(false);
  }

  /**
   * 待嵌入清单：无向量 / 模型或配方版本不符 → 待办（2026-10 对照上游 literature-mcp 的
   * get_work_ids_missing_embeddings + get_works_for_embedding 改为两段式）。
   * 空标题且空摘要的条目没有嵌入意义，跳过。分批扫描，limit 封顶单批。
   *
   * 第一段只扫 id 与「有无可嵌文本」两个小信号——已有当前模型+配方向量的行**不再逐条
   * JSON.parse + SHA-1 验 hash**：所有改 title/abstract 的写路径（upsertWorks /
   * updateWorkText）都同步删 vec 行（R13），戳在内容就在（上游 embed_version 同一信任
   * 模型；绕过应用直改数据库不在支持面内，vec.db 本就是可删了重建的缓存）。旧实现对
   * 全库每行重算 hash——topUp 在每次语义检索前都要跑一遍预检，万级库已嵌满时这是白付的
   * 大头。hash 只对真正要嵌的 ≤ limit 条在第二段算（vecPut 存的还是当前内容的 hash，
   * 写入路径的失真检测不受影响）。
   */
  function pendingEmbeddings(options) {
    ensureOpen();
    vecEnsure();
    const opts = options || {};
    const model = String(opts.model || '');
    const recipe = Number(opts.recipe) || 0;
    const limit = Math.max(1, Math.min(5000, Number(opts.limit) || 500));
    const currentIds = new Set();
    // 只取「当前模型 + 当前配方」的 work_id 集合（SQLite 侧过滤掉旧模型行，JS 侧免存整行对象）
    vec.prepare('SELECT work_id FROM vecs WHERE model = ? AND recipe = ?').all(model, recipe)
      .forEach(function (row) {
        currentIds.add(row.work_id);
      });
    const picked = [];
    const CHUNK = 500;
    // keyset 分页（WHERE id > ?）：OFFSET 版每片都要重走跳过的行，万级库全扫是平方级
    let lastId = '';
    while (picked.length < limit) {
      const rows = works.prepare(`
        SELECT id, (COALESCE(title, '') != '' OR COALESCE(abstract, '') != '') AS has_text
        FROM works WHERE id > ? ORDER BY id LIMIT ?
      `).all(lastId, CHUNK);
      if (!rows.length) break;
      lastId = rows[rows.length - 1].id;
      for (const row of rows) {
        if (picked.length >= limit) break;
        if (!row.has_text) continue;
        if (currentIds.has(row.id)) continue;
        picked.push(row.id);
      }
      if (rows.length < CHUNK) break;
    }
    if (!picked.length) return [];
    // 第二段：只对挑出的条目取嵌入配方需要的瘦身列，并保持第一段的扫描序
    // （limit 截断先挑谁与旧实现一致）
    const byId = new Map();
    for (let start = 0; start < picked.length; start += CHUNK) {
      const slice = picked.slice(start, start + CHUNK);
      const placeholders = slice.map(function () { return '?'; }).join(',');
      works.prepare(`SELECT id, title, abstract, concepts_json, keywords_json FROM works WHERE id IN (${placeholders})`)
        .all(...slice).forEach(function (row) { byId.set(row.id, row); });
    }
    const out = [];
    picked.forEach(function (id) {
      const row = byId.get(id);
      if (!row) return;
      const work = {
        id: row.id,
        title: row.title || '',
        abstract: row.abstract || '',
        concepts: parseJsonArray(row.concepts_json),
        keywords: parseJsonArray(row.keywords_json)
      };
      if (!work.title && !work.abstract) return;
      out.push({ work: work, hash: LitResearch.embeddingHash(work) });
    });
    return out;
  }

  /**
   * 向量覆盖度（A-followup #4）：按**当前模型 + 配方**统计可用向量数。
   * 「全库向量总数 > 0」不能当可用性判据——换了嵌入模型后旧模型的向量还在，总数不为零，
   * 但 cosineSearch 只认同模型同配方，检索会一篇都命不中；用户看到的像是「没有相关文献」，
   * 实际是当前向量空间尚未构建。matched = 当前模型 + 配方下的向量数。
   */
  function vecCoverage(options) {
    ensureOpen();
    if (!vec) return { total: 0, matched: 0 };
    const opts = options || {};
    const model = String(opts.model || '');
    const recipe = Number(opts.recipe) || 0;
    const total = Number(vec.prepare('SELECT COUNT(*) AS n FROM vecs').get().n) || 0;
    const matched = (model || recipe)
      ? Number(vec.prepare('SELECT COUNT(*) AS n FROM vecs WHERE model = ? AND recipe = ?').get(model, recipe).n) || 0
      : total;
    return { total: total, matched: matched };
  }

  /**
   * 余弦相似度检索（暴力全扫，1 万篇毫秒级——与上游 harness 同路线，无 ANN）。
   * vec.db 与 research.db 是两个独立连接，无法 SQL 跨库 join——先取候选再在 works 库过滤年份。
   * R13：传入 model/recipe 时只检索同模型同配方的向量——相同维度不代表同一向量空间，
   * 不筛会混用不同模型的向量给出虚假满分；不传（旧调用）保持全量（兼容存量索引）。
   * 带 model/recipe 的调用走进程内缓存（见 createResearchDb 顶部的失效钩子说明）；
   * 冷热路径的候选顺序都来自同一条 SELECT 的读出顺序，结果逐位一致。
   */
  function cosineSearch(queryVec, options) {
    vecEnsure();
    ensureOpen();
    const opts = options || {};
    const limit = Math.max(1, Math.min(50, Number(opts.limit) || 20));
    const q = new Float32Array(queryVec.buffer || queryVec, queryVec.byteOffset || 0);
    let qNorm = 0;
    for (let i = 0; i < q.length; i++) qNorm += q[i] * q[i];
    qNorm = Math.sqrt(qNorm) || 1;
    const model = String(opts.model || '');
    const recipe = Number(opts.recipe) || 0;
    const cacheable = !!(model || recipe);
    let ids = null;
    let flat = null;
    if (cacheable && vecCache && vecCache.model === model && vecCache.recipe === recipe) {
      ids = vecCache.ids;
      flat = vecCache.flat;
    } else {
      const candidates = (model || recipe
        ? vec.prepare('SELECT work_id AS id, vec AS vec FROM vecs WHERE model = ? AND recipe = ?').all(model, recipe)
        : vec.prepare('SELECT work_id AS id, vec AS vec FROM vecs').all());
      if (!candidates.length) return [];
      // 平铺成连续 Float32Array：维度不符的行在这里剔除（与旧的逐行 v.length 检查同语义），
      // 之后的点积都在连续内存上跑
      const usable = candidates.filter(function (row) {
        return row.vec && (row.vec.byteLength || 0) === q.byteLength;
      });
      ids = usable.map(function (row) { return row.id; });
      flat = new Float32Array(usable.length * q.length);
      usable.forEach(function (row, index) {
        flat.set(new Float32Array(row.vec.buffer || row.vec, row.vec.byteOffset || 0), index * q.length);
      });
      if (cacheable && flat.byteLength <= VEC_CACHE_MAX_BYTES) {
        vecCache = { model: model, recipe: recipe, ids: ids, flat: flat };
      }
    }
    // 年份过滤：works 全表 id→year 一次读取建缓存（随 works 写入失效，见顶部钩子）
    if (!yearCache) {
      yearCache = new Map();
      works.prepare('SELECT id, year FROM works').all().forEach(function (row) { yearCache.set(row.id, row.year); });
    }
    const yearFrom = opts.yearFrom != null && isFinite(Number(opts.yearFrom)) ? Number(opts.yearFrom) : null;
    const yearTo = opts.yearTo != null && isFinite(Number(opts.yearTo)) ? Number(opts.yearTo) : null;
    const dim = q.length;
    const scored = [];
    for (let n = 0; n < ids.length; n++) {
      const year = yearCache.get(ids[n]);
      if (yearFrom != null && (year == null || year < yearFrom)) continue;
      if (yearTo != null && (year == null || year > yearTo)) continue;
      const base = n * dim;
      let dot = 0, norm = 0;
      for (let i = 0; i < dim; i++) {
        const x = flat[base + i];
        dot += x * q[i];
        norm += x * x;
      }
      norm = Math.sqrt(norm);
      if (!norm) continue;
      scored.push({ workId: ids[n], score: dot / (norm * qNorm) });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit);
  }

  /** 缺摘要且有 DOI 的条目（回填链的目标集） */
  function findWorksNeedingAbstract(options) {
    ensureOpen();
    const limit = Math.max(1, Math.min(500, Number(options && options.limit) || 100));
    return works.prepare(`
      SELECT id, doi, title FROM works
      WHERE (abstract IS NULL OR abstract = '') AND doi != ''
      ORDER BY cited_by DESC LIMIT ?
    `).all(limit).map(function (row) {
      return { id: row.id, doi: row.doi, title: row.title || '' };
    });
  }

  /* ---------------- 身份核（快照导出/恢复：不可重建部分的小体积镜像） ---------------- */

  function exportIdentityCore() {
    ensureOpen();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      works: works.prepare('SELECT id, doi, title, year FROM works ORDER BY id').all(),
      extIds: works.prepare('SELECT work_id, kind, value FROM ext_ids ORDER BY kind, value').all(),
      mergeLog: works.prepare('SELECT old_id, new_id, at FROM merge_log ORDER BY at').all(),
      provenance: works.prepare('SELECT work_id, field, source, fetched_at FROM field_provenance').all(),
      searches: works.prepare('SELECT q, filters_json, result_count, at FROM searches ORDER BY at').all()
    };
  }

  return {
    open: open,
    close: close,
    upsertWorks: upsertWorks,
    queryWorks: queryWorks,
    getWorks: getWorks,
    findByExtId: findByExtId,
    getRefsSnapshot: getRefsSnapshot,
    getFulltextWindow: getFulltextWindow,
    upsertFulltext: upsertFulltext,
    addExtIds: addExtIds,
    findIdByNormalizedTitle: findIdByNormalizedTitle,
    recordSearch: recordSearch,
    updateWorkText: updateWorkText,
    stats: stats,
    vecPut: vecPut,
    vecDelete: vecDelete,
    vecClear: vecClear,
    pendingEmbeddings: pendingEmbeddings,
    cosineSearch: cosineSearch,
    vecCoverage: vecCoverage,
    findWorksNeedingAbstract: findWorksNeedingAbstract,
    exportIdentityCore: exportIdentityCore
  };
}

module.exports = { createResearchDb };
