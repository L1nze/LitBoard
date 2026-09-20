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

const RESEARCH_DB_VERSION = 3;

function createResearchDb(options) {
  const dir = options.dir;
  let works = null;
  let vec = null;

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
      db.exec('PRAGMA user_version = ' + RESEARCH_DB_VERSION);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
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

  function upsertWorks(rows) {
    ensureOpen();
    const list = (Array.isArray(rows) ? rows : []).filter(function (row) { return row && row.id; });
    if (!list.length) return { count: 0 };
    works.exec('BEGIN');
    try {
      const upsert = works.prepare(`
        INSERT INTO works(id, doi, title, year, pubdate, type, source_id, source_name,
          abstract, snippet, page_url, lang, cited_by, is_oa, oa_url, authors_json, refs_json,
          concepts_json, keywords_json, created_at, updated_at)
        VALUES(@id, @doi, @title, @year, @pubdate, @type, @source_id, @source_name,
          @abstract, @snippet, @page_url, @lang, @cited_by, @is_oa, @oa_url, @authors_json, @refs_json,
          @concepts_json, @keywords_json, @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          doi = CASE WHEN excluded.doi != '' THEN excluded.doi ELSE works.doi END,
          title = CASE WHEN excluded.title != '' THEN excluded.title ELSE works.title END,
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
      const extInsert = works.prepare('INSERT OR IGNORE INTO ext_ids(work_id, kind, value) VALUES(?, ?, ?)');
      const staleVecIds = [];
      list.forEach(function (row) {
        const c = workToColumns(row);
        upsert.run(c);
        // R09：FTS 用「UPSERT 后数据库实际保留的合并行」重建——UPSERT 是非空补齐语义，
        // 直接拿输入值写 FTS 会把「空摘要不覆盖」变成「空摘要清掉检索命中」
        const merged = readMerged.get(c.id) || { title: '', abstract: '', snippet: '' };
        ftsDelete.run(c.id);
        ftsInsert.run(c.id, merged.title || '', merged.abstract || '', merged.snippet || '', c.id);
        // R13：嵌入相关文本（title/abstract/concepts/keywords）的 hash 变了 → 旧向量立即失效
        const hash = LitResearch.embeddingHash({
          title: merged.title || '', abstract: merged.abstract || '',
          concepts: parseJsonArray(merged.concepts_json), keywords: parseJsonArray(merged.keywords_json)
        });
        const before = vec ? vec.prepare('SELECT content_hash FROM vecs WHERE work_id = ?').get(c.id) : null;
        if (before && before.content_hash !== hash) staleVecIds.push(c.id);
        LitResearch.extIdsForRow({ id: c.id, doi: c.doi }).forEach(function (ext) {
          extInsert.run(c.id, ext.kind, ext.value);
        });
      });
      if (vec && staleVecIds.length) {
        const vecDeleteStmt = vec.prepare('DELETE FROM vecs WHERE work_id = ?');
        staleVecIds.forEach(function (id) { vecDeleteStmt.run(id); });
      }
      works.exec('COMMIT');
    } catch (error) {
      works.exec('ROLLBACK');
      throw error;
    }
    return { count: list.length };
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
        ([...t].length >= 3 ? ftsTokens : likeTokens).push(norm);
      });
      if (!ftsTokens.length && likeTokens.length) {
        // 全是短词：退 LIKE（与 <3 字符整查询的旧路径一致）
        where.push("(works.title LIKE @like OR works.abstract LIKE @like)");
        params.like = '%' + q + '%';
      } else {
        from = 'works JOIN works_fts ON works.id = works_fts.work_id';
        where.push('works_fts MATCH @fts');
        params.fts = ftsTokens.join(' AND ');
        likeTokens.forEach(function (t, idx) {
          const bare = t.replace(/""/g, '"');
          where.push("(works.title LIKE @likeS" + idx + " OR works.abstract LIKE @likeS" + idx + ")");
          params['likeS' + idx] = '%' + bare + '%';
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
    const total = works.prepare('SELECT COUNT(*) AS n FROM ' + from + whereSql).get(params).n;
    const rows = works.prepare(
      'SELECT ' + columns + ' FROM ' + from + whereSql +
      ' ORDER BY works.cited_by DESC, works.id ASC LIMIT @limit OFFSET @offset'
    ).all(Object.assign({}, params, { limit: limit, offset: offset }));
    return { total: Number(total) || 0, works: rows.map(workSummary) };
  }

  function getWorks(ids) {
    ensureOpen();
    const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 50);
    if (!list.length) return [];
    const placeholders = list.map(function () { return '?'; }).join(',');
    const stmt = works.prepare(`SELECT works.*, (SELECT chars FROM works_fulltext f WHERE f.work_id = works.id) AS fulltext_chars FROM works WHERE works.id IN (${placeholders})`);
    const rows = stmt.all(...list);
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

  /** 标题精确匹配（规范化后）：网页检索结果按标题补 DOI 归属用 */
  function findIdByNormalizedTitle(title) {
    ensureOpen();
    const norm = String(title == null ? '' : title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (norm.length < 8) return null;
    const rows = works.prepare(`
      SELECT id, title FROM works WHERE title != ''
      ORDER BY cited_by DESC LIMIT 400
    `).all();
    for (const row of rows) {
      const rowNorm = String(row.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (rowNorm && rowNorm === norm) return row.id;
    }
    return null;
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
    if (patch && patch.title) { sets.push('title = @title'); params.title = String(patch.title).slice(0, 4000); }
    if (patch && patch.abstract) { sets.push('abstract = @abstract'); params.abstract = String(patch.abstract).slice(0, 200000); }
    if (!sets.length) return { updated: 0 };
    sets.push('updated_at = @now');
    works.exec('BEGIN');
    try {
      const result = works.prepare('UPDATE works SET ' + sets.join(', ') + ' WHERE id = @id').run(params);
      const changed = Number(result.changes) || 0;
      if (changed) {
        const ftsDelete = works.prepare('DELETE FROM works_fts WHERE work_id = ?');
        const ftsInsert = works.prepare('INSERT INTO works_fts(work_id, title, abstract, snippet) VALUES(?, ?, ?, ?)');
        const row = works.prepare('SELECT title, abstract, snippet FROM works WHERE id = ?').get(id);
        ftsDelete.run(id);
        ftsInsert.run(id, row.title, row.abstract, row.snippet || '');
        const prov = works.prepare(`
          INSERT INTO field_provenance(work_id, field, source, fetched_at) VALUES(@id, @field, @source, @now)
          ON CONFLICT(work_id, field) DO UPDATE SET source = excluded.source, fetched_at = excluded.fetched_at
        `);
        if (params.title) prov.run({ id: id, field: 'title', source: String(source || ''), now: params.now });
        if (params.abstract) prov.run({ id: id, field: 'abstract', source: String(source || ''), now: params.now });
        if (vec) vec.prepare('DELETE FROM vecs WHERE work_id = ?').run(id);
      }
      works.exec('COMMIT');
      return { updated: changed };
    } catch (error) {
      works.exec('ROLLBACK');
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

  /** harness（literature-mcp）本地库一次性导入：只读连接，映射进调研 schema，幂等可重跑 */
  async function importFromHarness(harnessFile, onProgress) {
    ensureOpen();
    const file = String(harnessFile || '');
    if (!file) throw new Error('missing harness db path');
    let source = null;
    try {
      source = new DatabaseSync(file, { readOnly: true });
    } catch (error) {
      throw new Error('无法以只读方式打开调研缓存库：' + (error && error.message || error));
    }
    try {
      const table = source.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='works'"
      ).get();
      if (!table) throw new Error('所选文件不是 literature-mcp 调研库（缺少 works 表）');
      const total = Number(source.prepare('SELECT COUNT(*) AS n FROM works').get().n) || 0;
      const stmt = source.prepare(`
        SELECT id, doi, title, publication_year, publication_date, type, cited_by_count,
          is_oa, language, abstract, authors_json, concepts_json, keywords_json,
          referenced_works, source_id, source_name, oa_url
        FROM works ORDER BY rowid LIMIT ? OFFSET ?
      `);
      const batch = 500;
      let done = 0;
      while (done < total) {
        const rows = stmt.all(batch, done);
        if (!rows.length) break;
        upsertWorks(rows.map(harnessRowToWork));
        done += rows.length;
        if (typeof onProgress === 'function') onProgress({ done: done, total: total });
      }
      return { imported: done, total: total };
    } finally {
      try { source.close(); } catch (error) { /* 只读连接，关不掉也不影响 */ }
    }
  }

  /** harness works 行 → 调研行（防御式解析：上游 JSON 列形态不保证） */
  function harnessRowToWork(row) {
    const asNames = function (value) {
      return parseJsonArray(value).map(function (item) {
        if (typeof item === 'string') return { name: item };
        if (item && typeof item === 'object') {
          const name = item.display_name || item.name || item.raw_author_name || '';
          return name ? { name: String(name) } : null;
        }
        return null;
      }).filter(Boolean);
    };
    const asStrings = function (value) {
      return parseJsonArray(value).map(function (item) {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const s = item.display_name || item.keyword || item.name || '';
          return s ? String(s) : null;
        }
        return null;
      }).filter(Boolean);
    };
    return {
      id: LitResearch.shortWorkId(row.id),
      doi: LitResearch.normalizeDoi(row.doi),
      title: String(row.title || ''),
      year: Number(row.publication_year) || null,
      pubdate: String(row.publication_date || '').slice(0, 10),
      type: String(row.type || ''),
      sourceId: LitResearch.shortWorkId(row.source_id),
      sourceName: String(row.source_name || ''),
      abstract: String(row.abstract || ''),
      lang: String(row.language || ''),
      citedBy: Number(row.cited_by_count) || 0,
      isOa: row.is_oa === 1 || row.is_oa === true,
      oaUrl: String(row.oa_url || ''),
      authors: asNames(row.authors_json),
      refs: asStrings(row.referenced_works),
      concepts: asStrings(row.concepts_json),
      keywords: asStrings(row.keywords_json)
    };
  }

  function close() {
    if (works) { try { works.close(); } catch (error) {} works = null; }
    if (vec) { try { vec.close(); } catch (error) {} vec = null; }
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
    } catch (error) {
      vec.exec('ROLLBACK');
      throw error;
    }
  }

  function vecClear() {
    vecEnsure();
    vec.exec('DELETE FROM vecs');
  }

  /**
   * 待嵌入清单：无向量 / 内容 hash 变了 / 模型或配方版本不符 → 都视为待办。
   * 空标题且空摘要的条目没有嵌入意义，跳过。分批扫描，limit 封顶单批。
   */
  function pendingEmbeddings(options) {
    ensureOpen();
    vecEnsure();
    const opts = options || {};
    const model = String(opts.model || '');
    const recipe = Number(opts.recipe) || 0;
    const limit = Math.max(1, Math.min(5000, Number(opts.limit) || 500));
    const existing = new Map();
    vec.prepare('SELECT work_id, content_hash, model, recipe FROM vecs').all()
      .forEach(function (row) {
        existing.set(row.work_id, row);
      });
    const out = [];
    const CHUNK = 500;
    let offset = 0;
    while (out.length < limit) {
      const rows = works.prepare(`
        SELECT id, title, abstract, concepts_json, keywords_json
        FROM works ORDER BY id LIMIT ? OFFSET ?
      `).all(CHUNK, offset);
      if (!rows.length) break;
      offset += rows.length;
      for (const row of rows) {
        if (out.length >= limit) break;
        const work = {
          id: row.id,
          title: row.title || '',
          abstract: row.abstract || '',
          concepts: parseJsonArray(row.concepts_json),
          keywords: parseJsonArray(row.keywords_json)
        };
        if (!work.title && !work.abstract) continue;
        const hash = LitResearch.embeddingHash(work);
        const have = existing.get(row.id);
        if (have && have.content_hash === hash && have.model === model && Number(have.recipe) === recipe) continue;
        out.push({ work: work, hash: hash });
      }
      if (rows.length < CHUNK) break;
    }
    return out;
  }

  /**
   * 余弦相似度检索（暴力全扫，1 万篇毫秒级——与上游 harness 同路线，无 ANN）。
   * vec.db 与 research.db 是两个独立连接，无法 SQL 跨库 join——先取候选再在 works 库过滤年份。
   * R13：传入 model/recipe 时只检索同模型同配方的向量——相同维度不代表同一向量空间，
   * 不筛会混用不同模型的向量给出虚假满分；不传（旧调用）保持全量（兼容存量索引）。
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
    const candidates = (model || recipe
      ? vec.prepare('SELECT work_id AS id, vec AS vec FROM vecs WHERE model = ? AND recipe = ?').all(model, recipe)
      : vec.prepare('SELECT work_id AS id, vec AS vec FROM vecs').all());
    if (!candidates.length) return [];
    // 年份过滤：批量查 works 表（id → year）
    const yearOf = new Map();
    const CHUNK = 400;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const ids = candidates.slice(i, i + CHUNK).map(function (row) { return row.id; });
      const marks = ids.map(function () { return '?'; }).join(',');
      const stmt = works.prepare('SELECT id, year FROM works WHERE id IN (' + marks + ')');
      stmt.all(...ids).forEach(function (row) { yearOf.set(row.id, row.year); });
    }
    const yearFrom = opts.yearFrom != null && isFinite(Number(opts.yearFrom)) ? Number(opts.yearFrom) : null;
    const yearTo = opts.yearTo != null && isFinite(Number(opts.yearTo)) ? Number(opts.yearTo) : null;
    const scored = [];
    candidates.forEach(function (row) {
      const year = yearOf.get(row.id);
      if (yearFrom != null && (year == null || year < yearFrom)) return;
      if (yearTo != null && (year == null || year > yearTo)) return;
      const v = new Float32Array(row.vec.buffer || row.vec, row.vec.byteOffset || 0);
      if (v.length !== q.length) return;
      let dot = 0, norm = 0;
      for (let i = 0; i < v.length; i++) {
        dot += v[i] * q[i];
        norm += v[i] * v[i];
      }
      norm = Math.sqrt(norm);
      if (!norm) return;
      scored.push({ workId: row.id, score: dot / (norm * qNorm) });
    });
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

  /** 恢复身份核：空库/新库导入；元数据（摘要等）留空，由后台批量重拉补齐 */
  function importIdentityCore(data) {
    ensureOpen();
    const core = data && typeof data === 'object' ? data : {};
    const workRows = (Array.isArray(core.works) ? core.works : []).filter(function (w) { return w && w.id; });
    upsertWorks(workRows.map(function (w) {
      return {
        id: String(w.id), doi: String(w.doi || ''), title: String(w.title || ''),
        year: Number(w.year) || null
      };
    }));
    works.exec('BEGIN');
    try {
      const extStmt = works.prepare('INSERT OR IGNORE INTO ext_ids(work_id, kind, value) VALUES(?, ?, ?)');
      (Array.isArray(core.extIds) ? core.extIds : []).forEach(function (row) {
        if (row && row.work_id && row.kind && row.value) extStmt.run(String(row.work_id), String(row.kind), String(row.value));
      });
      const mergeStmt = works.prepare('INSERT OR IGNORE INTO merge_log(old_id, new_id, at) VALUES(?, ?, ?)');
      (Array.isArray(core.mergeLog) ? core.mergeLog : []).forEach(function (row) {
        if (row && row.old_id) mergeStmt.run(String(row.old_id), String(row.new_id || ''), Number(row.at) || 0);
      });
      const provStmt = works.prepare(`
        INSERT INTO field_provenance(work_id, field, source, fetched_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(work_id, field) DO UPDATE SET source = excluded.source, fetched_at = excluded.fetched_at
      `);
      (Array.isArray(core.provenance) ? core.provenance : []).forEach(function (row) {
        if (row && row.work_id && row.field) provStmt.run(String(row.work_id), String(row.field), String(row.source || ''), Number(row.fetched_at) || 0);
      });
      const searchStmt = works.prepare('INSERT INTO searches(q, filters_json, result_count, at) VALUES(?, ?, ?, ?)');
      (Array.isArray(core.searches) ? core.searches : []).forEach(function (row) {
        if (row) searchStmt.run(String(row.q || ''), String(row.filters_json || '{}'), Number(row.result_count) || 0, Number(row.at) || 0);
      });
      works.exec('COMMIT');
    } catch (error) {
      works.exec('ROLLBACK');
      throw error;
    }
    return { works: workRows.length };
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
    importFromHarness: importFromHarness,
    vecPut: vecPut,
    vecDelete: vecDelete,
    vecClear: vecClear,
    pendingEmbeddings: pendingEmbeddings,
    cosineSearch: cosineSearch,
    findWorksNeedingAbstract: findWorksNeedingAbstract,
    exportIdentityCore: exportIdentityCore,
    importIdentityCore: importIdentityCore
  };
}

module.exports = { createResearchDb };
