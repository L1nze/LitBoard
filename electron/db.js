'use strict';

/**
 * LitBoard SQLite 存储层（主进程专用）。
 *
 * 设计要点：
 * - 基于 Electron/Node 内置 node:sqlite，零外部依赖，FTS5(trigram) 全文索引；
 * - papers.data 存 normalize 后的完整 JSON（保真往返），常用字段冗余为列；
 * - 实体级保存：渲染层发送全量工作区 + 最近确认签名的 baseSignatures，
 *   只写「相对 base 有本地修改」的实体；本地未改的实体绝不覆盖库内（可能是扩展新写入的）版本，
 *   双方同时修改则返回冲突由渲染层三方合并后重提；
 * - replaceState 保留「整库镜像替换」语义，仅供 JSON 整库恢复等显式场景使用；
 * - 墓碑（deletedAt）照常入库并随 loadState 返回，供回收站与同步删除传播使用；
 * - 损坏即失败：打开时检测到损坏只报告（LITBOARD_DB_CORRUPT），绝不删除主库/WAL/SHM，
 *   也不创建空库掩盖故障；恢复由 electron/backup.js 的完整快照流程负责。
 */
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const LitModel = require('../js/model.js');

// zlib 的 promise 化包装（zlib.promises 在 Node 24 已移除；回调式 API 跨版本最稳）
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

const DB_VERSION = 7;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// node:sqlite 的在线备份 API（Node ≥ 23.8）；不存在时回退为 WAL 归档检查点 + 文件复制
let sqliteBackup = null;
try { sqliteBackup = require('node:sqlite').backup || null; } catch (error) { sqliteBackup = null; }

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function (key) {
    return JSON.stringify(key) + ':' + stableStringify(value[key]);
  }).join(',') + '}';
}

/** 内容 hash：剔除 updatedAt/addedAt（它们只代表"何时"，不代表内容本身）与
 *  lastReadAt（高频阅读统计字段，避免每次阅读都触发整篇脏写/同步） */
function hashEntity(entity) {
  const copy = Object.assign({}, entity);
  delete copy.updatedAt;
  delete copy.addedAt;
  delete copy.lastReadAt;
  return crypto.createHash('sha1').update(stableStringify(copy)).digest('hex');
}

function createLibraryDb(baseDir) {
  const file = path.join(baseDir, 'litboard.sqlite');
  const backupFile = file + '.bak';
  // .bak 的节流时间戳单独存文件，不写进数据库：往库里写记账数据会让「内容没变」的
  // 两次快照在字节层面永远不同，于是完整备份永远认不出“无变化”，每天白占一个轮换位。
  const backupStampFile = backupFile + '.stamp';
  let db = null;

  function applyPragmas() {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
  }

  function migrateSchema() {
    const row = db.prepare('PRAGMA user_version').get();
    const version = row && (row.user_version != null ? row.user_version : Object.values(row)[0]);
    if (version < 1) {
      db.exec(`
      CREATE TABLE IF NOT EXISTS papers(
        id TEXT PRIMARY KEY,
        citekey TEXT, entry_type TEXT, title TEXT, year INTEGER, venue TEXT, doi TEXT,
        citations INTEGER, rating INTEGER, status TEXT,
        added_at INTEGER, updated_at INTEGER, deleted_at INTEGER,
        hash TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
      CREATE INDEX IF NOT EXISTS idx_papers_deleted ON papers(deleted_at);
      CREATE TABLE IF NOT EXISTS authors(
        paper_id TEXT NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL,
        PRIMARY KEY(paper_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_authors_name ON authors(name);
      CREATE TABLE IF NOT EXISTS tags(
        paper_id TEXT NOT NULL, tag TEXT NOT NULL,
        PRIMARY KEY(paper_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
      CREATE TABLE IF NOT EXISTS tag_colors(tag TEXT PRIMARY KEY, color TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS folders(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
        sort_index INTEGER, updated_at INTEGER, deleted_at INTEGER, hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS folder_items(
        paper_id TEXT NOT NULL, folder_id TEXT NOT NULL,
        PRIMARY KEY(paper_id, folder_id)
      );
      CREATE INDEX IF NOT EXISTS idx_folder_items_folder ON folder_items(folder_id);
      CREATE TABLE IF NOT EXISTS attachments(
        id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, kind TEXT,
        file_name TEXT, path TEXT, fingerprint TEXT, cloud_name TEXT,
        sync_signature TEXT, added_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_paper ON attachments(paper_id);
      CREATE TABLE IF NOT EXISTS annotations(
        id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, type TEXT, color TEXT,
        page_index INTEGER, created_at INTEGER, updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_annotations_paper ON annotations(paper_id);
      CREATE TABLE IF NOT EXISTS saved_searches(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, ast TEXT NOT NULL DEFAULT '', sort_index INTEGER
      );
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS pdf_text(
        paper_id TEXT PRIMARY KEY, fingerprint TEXT, method TEXT,
        pages TEXT, updated_at INTEGER
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS pdf_fts USING fts5(
        paper_id UNINDEXED, page UNINDEXED, text, tokenize='trigram'
      );
      `);
    }
    if (version < 3) {
      db.exec('BEGIN');
      try {
        db.exec(`
        CREATE TABLE attachments_v3(
          paper_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT,
          file_name TEXT, path TEXT, fingerprint TEXT, cloud_name TEXT,
          sync_signature TEXT, added_at INTEGER,
          PRIMARY KEY(paper_id, id)
        );
        INSERT INTO attachments_v3(paper_id, id, kind, file_name, path, fingerprint, cloud_name, sync_signature, added_at)
          SELECT paper_id, id, kind, file_name, path, fingerprint, cloud_name, sync_signature, added_at FROM attachments;
        DROP TABLE attachments;
        ALTER TABLE attachments_v3 RENAME TO attachments;
        CREATE INDEX idx_attachments_paper ON attachments(paper_id);

        CREATE TABLE annotations_v3(
          paper_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT, color TEXT,
          page_index INTEGER, created_at INTEGER, updated_at INTEGER,
          PRIMARY KEY(paper_id, id)
        );
        INSERT INTO annotations_v3(paper_id, id, type, color, page_index, created_at, updated_at)
          SELECT paper_id, id, type, color, page_index, created_at, updated_at FROM annotations;
        DROP TABLE annotations;
        ALTER TABLE annotations_v3 RENAME TO annotations;
        CREATE INDEX idx_annotations_paper ON annotations(paper_id);

        ALTER TABLE saved_searches ADD COLUMN updated_at INTEGER;
        ALTER TABLE saved_searches ADD COLUMN deleted_at INTEGER;
        ALTER TABLE tag_colors ADD COLUMN updated_at INTEGER;
        ALTER TABLE tag_colors ADD COLUMN deleted_at INTEGER;
        `);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (rollbackError) {}
        throw error;
      }
    }
    if (version < 4) {
      // 迁移前显式备份（v12 起新增 Note 实体/批注附件关联）：先归档 WAL 再整文件复制，
      // 保证 pre-v4.bak 是自洽可恢复的时间点；已存在则不覆盖（保留最初升级前版本）。
      const preMigrationBackup = file + '.pre-v4.bak';
      if (version >= 1 && !fsSync.existsSync(preMigrationBackup)) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        fsSync.copyFileSync(file, preMigrationBackup);
      }
      db.exec('BEGIN');
      try {
        db.exec(`
        CREATE TABLE IF NOT EXISTS notes(
          id TEXT PRIMARY KEY, paper_id TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT 'markdown',
          created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,
          hash TEXT NOT NULL, data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_paper ON notes(paper_id);
        CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);
        ALTER TABLE annotations ADD COLUMN attachment_id TEXT NOT NULL DEFAULT '';
        `);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (rollbackError) {}
        throw error;
      }
    }
    if (version < 5) {
      const preMigrationBackup = file + '.pre-v5.bak';
      if (version >= 1 && !fsSync.existsSync(preMigrationBackup)) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        fsSync.copyFileSync(file, preMigrationBackup);
      }
      const hasColumn = function (table, column) {
        return db.prepare('PRAGMA table_info(' + table + ')').all()
          .some(function (row) { return row.name === column; });
      };
      db.exec('BEGIN');
      try {
        if (!hasColumn('saved_searches', 'ast')) db.exec('ALTER TABLE saved_searches ADD COLUMN ast TEXT NOT NULL DEFAULT \'\'');
        if (!hasColumn('attachments', 'source_library_id')) {
          db.exec('ALTER TABLE attachments ADD COLUMN source_library_id TEXT NOT NULL DEFAULT \'\'');
        }
        if (!hasColumn('annotations', 'source_library_id')) {
          db.exec('ALTER TABLE annotations ADD COLUMN source_library_id TEXT NOT NULL DEFAULT \'\'');
        }
        if (!hasColumn('annotations', 'zotero_key')) {
          db.exec('ALTER TABLE annotations ADD COLUMN zotero_key TEXT NOT NULL DEFAULT \'\'');
        }
        if (!hasColumn('annotations', 'source_status')) {
          db.exec('ALTER TABLE annotations ADD COLUMN source_status TEXT NOT NULL DEFAULT \'\'');
        }
        if (!hasColumn('notes', 'source_library_id')) {
          db.exec('ALTER TABLE notes ADD COLUMN source_library_id TEXT NOT NULL DEFAULT \'\'');
        }
        if (!hasColumn('notes', 'source_html')) {
          db.exec('ALTER TABLE notes ADD COLUMN source_html TEXT NOT NULL DEFAULT \'\'');
        }
        if (!hasColumn('notes', 'source_meta')) {
          db.exec('ALTER TABLE notes ADD COLUMN source_meta TEXT NOT NULL DEFAULT \'{}\'');
        }
        db.exec('CREATE TABLE pdf_text_v5(paper_id TEXT NOT NULL, attachment_id TEXT NOT NULL DEFAULT \'\', fingerprint TEXT, method TEXT, pages TEXT, updated_at INTEGER, PRIMARY KEY(paper_id, attachment_id))');
        db.exec('INSERT INTO pdf_text_v5(paper_id, attachment_id, fingerprint, method, pages, updated_at) SELECT paper_id, \'\', fingerprint, method, pages, updated_at FROM pdf_text');
        db.exec('DROP TABLE pdf_text');
        db.exec('ALTER TABLE pdf_text_v5 RENAME TO pdf_text');
        db.exec('CREATE INDEX idx_pdf_text_paper ON pdf_text(paper_id)');
        db.exec('CREATE VIRTUAL TABLE pdf_fts_v5 USING fts5(paper_id UNINDEXED, attachment_id UNINDEXED, page UNINDEXED, text, tokenize=\'trigram\')');
        db.exec('INSERT INTO pdf_fts_v5(paper_id, attachment_id, page, text) SELECT paper_id, \'\', page, text FROM pdf_fts');
        db.exec('DROP TABLE pdf_fts');
        db.exec('ALTER TABLE pdf_fts_v5 RENAME TO pdf_fts');
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (rollbackError) {}
        throw error;
      }
    }
    if (version < 6) {
      // v6：pdf_text.pages 由未压缩 JSON 文本改为 zlib(level 1) 压缩 BLOB。
      // 全文文本此前在库里存了两份（pdf_text.pages + pdf_fts 索引），压缩后体积约降一半，
      // 每日 .bak 与完整备份的 gzip 也随之缩小。level 1 对文本已有 ~3x 压缩且迁移够快。
      const preMigrationBackup = file + '.pre-v6.bak';
      if (version >= 1 && !fsSync.existsSync(preMigrationBackup)) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        fsSync.copyFileSync(file, preMigrationBackup);
      }
      const hasPdfText = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pdf_text'").get();
      if (hasPdfText) {
        db.exec('BEGIN');
        try {
          db.exec(`CREATE TABLE pdf_text_v6(paper_id TEXT NOT NULL, attachment_id TEXT NOT NULL DEFAULT '', fingerprint TEXT, method TEXT, pages BLOB, updated_at INTEGER, PRIMARY KEY(paper_id, attachment_id))`);
          const rows = db.prepare('SELECT paper_id, attachment_id, fingerprint, method, pages, updated_at FROM pdf_text').all();
          const insert = db.prepare('INSERT INTO pdf_text_v6(paper_id, attachment_id, fingerprint, method, pages, updated_at) VALUES(?, ?, ?, ?, ?, ?)');
          for (const row of rows) {
            const packed = row.pages instanceof Uint8Array
              ? row.pages // 已是 BLOB：原样搬运
              : zlib.gzipSync(Buffer.from(row.pages == null ? '' : String(row.pages), 'utf8'), { level: 1 });
            insert.run(row.paper_id, row.attachment_id || '', row.fingerprint || '', row.method || '', packed, row.updated_at);
          }
          db.exec('DROP TABLE pdf_text');
          db.exec('ALTER TABLE pdf_text_v6 RENAME TO pdf_text');
          db.exec('CREATE INDEX idx_pdf_text_paper ON pdf_text(paper_id)');
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch (rollbackError) {}
          throw error;
        }
      }
    }
    if (version < 7) {
      // v7：正式库那条语义搜索链（搜索框 semantic: 前缀 + paper_vec 索引）已删除——语义检索
      // 只作为 AI 助手的工具存在，向量落在调研库自己的库里（<configDir>/research/vec.db），
      // 与主库无关。这里只删表：旧向量行对任何代码都不再有意义，留着会被压进每一份完整快照。
      const preMigrationBackup = file + '.pre-v7.bak';
      if (version >= 1 && !fsSync.existsSync(preMigrationBackup)) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        fsSync.copyFileSync(file, preMigrationBackup);
      }
      const hasPaperVec = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paper_vec'").get();
      if (hasPaperVec) db.exec('DROP TABLE paper_vec');
    }
    db.exec('PRAGMA user_version = ' + DB_VERSION);
  }

  function corruptionError(message) {
    const error = new Error('LitBoard 数据库已损坏：' + message);
    error.code = 'LITBOARD_DB_CORRUPT';
    return error;
  }

  async function pathExists(target) {
    try { await fs.access(target); return true; } catch (error) { return false; }
  }

  /**
   * 打开数据库。损坏即失败关闭（fail-closed）：
   * - 绝不删除/改名主库、WAL 或 SHM；
   * - 绝不在损坏文件上创建空库掩盖故障；
   * - 主库缺失但存在 WAL 残留同样视为损坏（WAL 里可能还有未归档的数据）。
   * 恢复流程见 electron/backup.js（验证快照 → 隔离保留件 → 还原验证 → 替换）。
   */
  async function open() {
    await fs.mkdir(baseDir, { recursive: true });
    const mainExists = await pathExists(file);
    const walExists = await pathExists(file + '-wal');
    if (!mainExists && walExists) {
      throw corruptionError('主库文件缺失但存在 WAL 残留（已原样保留全部文件，未做任何改动）');
    }
    if (mainExists) {
      // 用只读探针做完整性检查：损坏时绝不执行 journal_mode 变更，
      // 且只读句柄关闭不会重建/丢弃 WAL、SHM（读写句柄关闭会清理它们）。
      // 启动只做页级 quick_check（大库跑完整 integrity_check + 索引核对会明显拖慢启动）；
      // 深度校验保留在备份/恢复路径（backup.js 与本模块的快照流程）。
      let healthy = false;
      let probe = null;
      try {
        probe = new DatabaseSync(file, { readOnly: true });
        const check = probe.prepare('PRAGMA quick_check').get();
        healthy = check && Object.values(check)[0] === 'ok';
      } catch (error) { healthy = false; }
      try { if (probe) probe.close(); } catch (error) {}
      if (!healthy) {
        throw corruptionError('quick_check 未通过（主库/WAL/SHM 均已原样保留）');
      }
      db = new DatabaseSync(file);
      applyPragmas();
    } else {
      db = new DatabaseSync(file);
      applyPragmas();
    }
    try {
      migrateSchema();
    } catch (error) {
      if (mainExists) {
        try { if (db) db.close(); } catch (closeError) {}
        db = null;
        throw corruptionError('schema 迁移失败：' + String(error && error.message || error));
      }
      throw error;
    }
    return { restoredFromBackup: false, created: !mainExists };
  }

  function requireDb() {
    if (!db) throw new Error('数据库未打开');
    return db;
  }

  // ---------- 工作区读写 ----------

  function loadState() {
    const d = requireDb();
    // 无法解析的 papers.data 视为损坏：失败关闭，绝不静默丢弃条目
    const rows = d.prepare('SELECT id, data FROM papers').all();
    const papers = rows.map(function (row) {
      try { return JSON.parse(row.data); } catch (error) {
        throw corruptionError('papers.data 无法解析（id=' + row.id + '）');
      }
    });
    const folders = d.prepare('SELECT id, name, parent_id, sort_index, updated_at, deleted_at FROM folders').all()
      .map(function (row) {
        return {
          id: row.id, name: row.name, parentId: row.parent_id || '',
          sortIndex: row.sort_index || 0, updatedAt: row.updated_at || 0,
          deletedAt: row.deleted_at != null ? row.deleted_at : null
        };
      });
    const savedSearches = d.prepare('SELECT id, name, query, ast, sort_index, updated_at, deleted_at FROM saved_searches ORDER BY sort_index').all()
      .map(function (row) {
        return {
          id: row.id, name: row.name, query: row.query, ast: row.ast || '', sortIndex: row.sort_index || 0,
          updatedAt: row.updated_at || 0,
          deletedAt: row.deleted_at != null ? row.deleted_at : null
        };
      });
    const tagColors = {};
    const tagColorRecords = d.prepare('SELECT tag, color, updated_at, deleted_at FROM tag_colors').all().map(function (row) {
      if (row.deleted_at == null) tagColors[row.tag] = row.color;
      return {
        tag: row.tag, color: row.color, updatedAt: row.updated_at || 0,
        deletedAt: row.deleted_at != null ? row.deleted_at : null
      };
    });
    // 与 papers 相同：无法解析的 notes.data 视为损坏，失败关闭
    const notes = d.prepare('SELECT id, data FROM notes').all().map(function (row) {
      try { return JSON.parse(row.data); } catch (error) {
        throw corruptionError('notes.data 无法解析（id=' + row.id + '）');
      }
    });
    return LitModel.normalizeWorkspace({
      papers: papers, notes: notes, folders: folders, savedSearches: savedSearches,
      tagColors: tagColors, tagColorRecords: tagColorRecords
    });
  }

  const upsertPaperSql = `
    INSERT INTO papers(id, citekey, entry_type, title, year, venue, doi, citations, rating, status,
      added_at, updated_at, deleted_at, hash, data)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      citekey=excluded.citekey, entry_type=excluded.entry_type, title=excluded.title,
      year=excluded.year, venue=excluded.venue, doi=excluded.doi, citations=excluded.citations,
      rating=excluded.rating, status=excluded.status, added_at=excluded.added_at,
      updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
      hash=excluded.hash, data=excluded.data`;

  // 子表语句缓存（按连接隔离）：writePaperChildren 每篇文献原本要 prepare 十来条语句，
  // 批量标记/同步应用时是纯编译开销；WeakMap 保证连接关闭即随对象回收，不会跨连接复用
  const paperChildStmtCache = new WeakMap();
  function childStmt(d, sql) {
    let bySql = paperChildStmtCache.get(d);
    if (!bySql) { bySql = new Map(); paperChildStmtCache.set(d, bySql); }
    let stmt = bySql.get(sql);
    if (!stmt) { stmt = d.prepare(sql); bySql.set(sql, stmt); }
    return stmt;
  }

  function writePaperChildren(d, paper) {
    childStmt(d, 'DELETE FROM authors WHERE paper_id = ?').run(paper.id);
    childStmt(d, 'DELETE FROM tags WHERE paper_id = ?').run(paper.id);
    childStmt(d, 'DELETE FROM folder_items WHERE paper_id = ?').run(paper.id);
    childStmt(d, 'DELETE FROM attachments WHERE paper_id = ?').run(paper.id);
    childStmt(d, 'DELETE FROM annotations WHERE paper_id = ?').run(paper.id);
    (paper.authors || []).forEach(function (name, ord) {
      childStmt(d, 'INSERT OR IGNORE INTO authors(paper_id, ord, name) VALUES(?, ?, ?)').run(paper.id, ord, name);
    });
    (paper.tags || []).forEach(function (tag) {
      childStmt(d, 'INSERT OR IGNORE INTO tags(paper_id, tag) VALUES(?, ?)').run(paper.id, tag);
    });
    (paper.folderIds || []).forEach(function (folderId) {
      childStmt(d, 'INSERT OR IGNORE INTO folder_items(paper_id, folder_id) VALUES(?, ?)').run(paper.id, folderId);
    });
    (paper.attachments || []).forEach(function (att) {
      childStmt(d, 'INSERT INTO attachments(id, paper_id, kind, file_name, path, fingerprint, cloud_name, sync_signature, added_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(att.id, paper.id, att.kind, att.fileName, att.path, att.fingerprint, att.cloudName, att.syncSignature, att.addedAt);
    });
    (paper.pdfAnnotations || []).forEach(function (ann) {
      childStmt(d, 'INSERT INTO annotations(id, paper_id, type, color, page_index, attachment_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ann.id, paper.id, ann.type, ann.color, ann.position.pageIndex, ann.attachmentId || '', ann.createdAt, ann.updatedAt);
    });
  }

  function writePaper(d, paper, now) {
    const hash = hashEntity(paper);
    const updatedAt = Number(paper.updatedAt) || now;
    const stored = Object.assign({}, paper, { updatedAt: updatedAt });
    d.prepare(upsertPaperSql).run(
      paper.id, paper.key, paper.entryType, paper.title, paper.year, paper.venue, paper.doi,
      paper.citations, paper.rating, paper.status, paper.addedAt, updatedAt, paper.deletedAt,
      hash, JSON.stringify(stored)
    );
    writePaperChildren(d, paper);
  }

  /**
   * 硬删除一篇文献（连同它的全部子表）。
   *
   * 索引表必须一起清：pdf_text / pdf_fts 都没有外键级联，留下孤儿行会让
   * 已删除的文献继续被全文检索命中，并永久占用数据库体积 —— 而数据库会被压缩进
   * 每一份完整快照，所以这份垃圾是按备份份数翻倍的。
   * 墓碑（deletedAt）走的是 saveState，不经过这里，所以撤销删除仍然有效。
   */
  function deletePaper(d, id) {
    d.prepare('DELETE FROM papers WHERE id = ?').run(id);
    d.prepare('DELETE FROM authors WHERE paper_id = ?').run(id);
    d.prepare('DELETE FROM tags WHERE paper_id = ?').run(id);
    d.prepare('DELETE FROM folder_items WHERE paper_id = ?').run(id);
    d.prepare('DELETE FROM attachments WHERE paper_id = ?').run(id);
    d.prepare('DELETE FROM annotations WHERE paper_id = ?').run(id);
    d.prepare('DELETE FROM notes WHERE paper_id = ?').run(id); // 该文献的附属笔记；主题笔记（paper_id=''）不受影响
    d.prepare('DELETE FROM pdf_text WHERE paper_id = ?').run(id);
    d.prepare('DELETE FROM pdf_fts WHERE paper_id = ?').run(id);
  }

  function writeNote(d, note) {
    const hash = hashEntity(note);
    const updatedAt = Number(note.updatedAt) || 0;
    const stored = Object.assign({}, note, { updatedAt: updatedAt || note.updatedAt });
    d.prepare(`INSERT INTO notes(id, paper_id, title, format, created_at, updated_at, deleted_at, hash, data)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET paper_id=excluded.paper_id, title=excluded.title,
        format=excluded.format, created_at=excluded.created_at, updated_at=excluded.updated_at,
        deleted_at=excluded.deleted_at, hash=excluded.hash, data=excluded.data`)
      .run(note.id, note.paperId || '', note.title || '', note.format || 'markdown',
        note.createdAt != null ? note.createdAt : null, note.updatedAt != null ? note.updatedAt : null,
        note.deletedAt != null ? note.deletedAt : null, hash, JSON.stringify(stored));
  }

  function writeFolder(d, folder, now) {
    const updatedAt = Number(folder.updatedAt) || now;
    d.prepare(`INSERT INTO folders(id, name, parent_id, sort_index, updated_at, deleted_at, hash)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id,
        sort_index=excluded.sort_index, updated_at=excluded.updated_at,
        deleted_at=excluded.deleted_at, hash=excluded.hash`)
      .run(folder.id, folder.name, folder.parentId, folder.sortIndex, updatedAt, folder.deletedAt, hashEntity(folder));
  }

  function writeSavedSearch(d, search) {
    d.prepare(`INSERT INTO saved_searches(id, name, query, ast, sort_index, updated_at, deleted_at) VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, query=excluded.query, ast=excluded.ast, sort_index=excluded.sort_index,
        updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`)
      .run(search.id, search.name, search.query, search.ast || '', search.sortIndex, Number(search.updatedAt) || 0,
        search.deletedAt != null ? search.deletedAt : null);
  }

  function writeTagColor(d, record) {
    d.prepare(`INSERT INTO tag_colors(tag, color, updated_at, deleted_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(tag) DO UPDATE SET color=excluded.color, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`)
      .run(record.tag, record.color, Number(record.updatedAt) || 0,
        record.deletedAt != null ? record.deletedAt : null);
  }

  /**
   * 记录阅读时间（lastReadAt）：高频统计字段，不参与内容 hash/签名（避免每次阅读触发
   * 整篇脏写与全库同步），经此专用轻量通道单独落盘。
   */
  function recordReadAt(paperId, at) {
    const d = requireDb();
    const row = d.prepare('SELECT data FROM papers WHERE id = ?').get(paperId);
    if (!row) return false;
    let paper;
    try { paper = JSON.parse(row.data); } catch (error) { return false; }
    if (Number(paper.lastReadAt) === Number(at)) return true;
    paper.lastReadAt = Number(at) || Date.now();
    d.prepare('UPDATE papers SET data = ? WHERE id = ?').run(JSON.stringify(paper), paperId);
    return true;
  }

  // ---------- 实体签名缓存（保存冲突裁决的快路径） ----------
  //
  // 裁决需要「库内当前签名」。早期实现每次 saveState 都 loadState() 全库解析一次，
  // 万篇级库每笔保存白付 O(全库)。改为缓存上一轮 saveState 确认后的签名表：
  // - 首轮保存（或缓存失效后）重算一次；
  // - 之后每次保存 O(1) 取用，写完以后 resultSigs 就是新签名表；
  // - 任何绕过 saveState 的实体写入（扩展桥接 / 整库替换）显式失效，
  //   下一次保存自动重算并重新锚定到库内真实状态（自愈）。
  // recordReadAt 不失效：lastReadAt 不参与 entitySignature，缓存仍然为真。
  let signaturesCache = null;
  function invalidateSignaturesCache() { signaturesCache = null; }

  /** 冲突裁决时按需回读单个实体（normalize 后，与 loadState 输出同构） */
  function loadEntityById(collection, key) {
    const d = requireDb();
    if (collection === 'papers') {
      const row = d.prepare('SELECT data FROM papers WHERE id = ?').get(key);
      if (!row) return null;
      try { return LitModel.normalizePaper(JSON.parse(row.data)); } catch (error) {
        throw corruptionError('papers.data 无法解析（id=' + key + '）');
      }
    }
    if (collection === 'notes') {
      const row = d.prepare('SELECT data FROM notes WHERE id = ?').get(key);
      if (!row) return null;
      try { return LitModel.normalizeNote(JSON.parse(row.data)); } catch (error) {
        throw corruptionError('notes.data 无法解析（id=' + key + '）');
      }
    }
    if (collection === 'folders') {
      const row = d.prepare('SELECT id, name, parent_id, sort_index, updated_at, deleted_at FROM folders WHERE id = ?').get(key);
      if (!row) return null;
      return LitModel.normalizeFolders([{ id: row.id, name: row.name, parentId: row.parent_id || '',
        sortIndex: row.sort_index || 0, updatedAt: row.updated_at || 0,
        deletedAt: row.deleted_at != null ? row.deleted_at : null }])[0];
    }
    if (collection === 'savedSearches') {
      const row = d.prepare('SELECT id, name, query, ast, sort_index, updated_at, deleted_at FROM saved_searches WHERE id = ?').get(key);
      if (!row) return null;
      return LitModel.normalizeSavedSearch({ id: row.id, name: row.name, query: row.query, ast: row.ast || '',
        sortIndex: row.sort_index || 0, updatedAt: row.updated_at || 0,
        deletedAt: row.deleted_at != null ? row.deleted_at : null });
    }
    const row = d.prepare('SELECT tag, color, updated_at, deleted_at FROM tag_colors WHERE tag = ?').get(key);
    if (!row) return null;
    return LitModel.normalizeTagColorRecord({ tag: row.tag, color: row.color,
      updatedAt: row.updated_at || 0, deletedAt: row.deleted_at != null ? row.deleted_at : null });
  }

  /**
   * 实体级保存协议：渲染层发送 { ...workspace, baseSignatures }。
   * baseSignatures 是渲染层最近一次被数据库确认的工作区签名：
   * - 本地未改（签名 == base）→ 跳过，绝不覆盖库内可能被扩展更新的版本；
   * - 库内未变（库签名 == base）→ 正常写入本地修改；
   * - 双方都变且不一致 → 记入 conflicts，不写入，由渲染层三方合并后带新 base 重提；
   * - payload 缺少某实体 → 一律保留库内记录（正常保存绝不硬删；删除走墓碑）。
   * 无 baseSignatures（旧渲染层/内部调用）时退化为「按差异写、不删除」。
   */
  function saveState(value) {
    const d = requireDb();
    const workspace = LitModel.normalizeWorkspace(value);
    const baseSignatures = value && value.baseSignatures && typeof value.baseSignatures === 'object'
      ? value.baseSignatures : null;
    const now = Date.now();
    const stats = {
      papersWritten: 0, papersDeleted: 0, notesWritten: 0,
      foldersWritten: 0, foldersDeleted: 0,
      searchesWritten: 0, tagColorsWritten: 0, conflicts: []
    };

    const currentSigs = signaturesCache || LitModel.workspaceSignatures(loadState());
    const incomingSigs = LitModel.workspaceSignatures(workspace);
    const resultSigs = {
      papers: Object.assign({}, currentSigs.papers),
      notes: Object.assign({}, currentSigs.notes),
      folders: Object.assign({}, currentSigs.folders),
      savedSearches: Object.assign({}, currentSigs.savedSearches),
      tagColorRecords: Object.assign({}, currentSigs.tagColorRecords)
    };

    // 单实体裁决：返回 'write' | 'skip' | 库内当前实体（= 并发冲突）
    function decide(collection, key, incomingSig) {
      const dbSig = currentSigs[collection][key];
      const base = baseSignatures && baseSignatures[collection]
        ? baseSignatures[collection][key] : undefined;
      if (base === undefined || base === null) {
        return (dbSig === undefined || dbSig !== incomingSig) ? 'write' : 'skip';
      }
      if (incomingSig === base) return 'skip'; // 本地未改
      if (dbSig === undefined) return 'write'; // 库里没有：直接写
      if (dbSig === base) return 'write';      // 库未变：正常写入
      if (dbSig === incomingSig) return 'skip'; // 双方已一致
      return 'conflict';
    }

    function applyEntity(collection, key, writeFn, incomingSig, title) {
      const verdict = decide(collection, key, incomingSig);
      if (verdict === 'skip') return;
      if (verdict === 'conflict') {
        stats.conflicts.push({
          collection: collection, id: key, title: title || '',
          entity: loadEntityById(collection, key)
        });
        return;
      }
      writeFn();
      resultSigs[collection][key] = incomingSig;
    }

    d.exec('BEGIN');
    try {
      workspace.papers.forEach(function (paper) {
        applyEntity('papers', paper.id, function () {
          writePaper(d, paper, now);
          stats.papersWritten++;
        }, incomingSigs.papers[paper.id], paper.title);
      });
      workspace.notes.forEach(function (note) {
        applyEntity('notes', note.id, function () {
          writeNote(d, note);
          stats.notesWritten++;
        }, incomingSigs.notes[note.id], note.title || note.content.slice(0, 40));
      });
      workspace.folders.forEach(function (folder) {
        applyEntity('folders', folder.id, function () {
          writeFolder(d, folder, now);
          stats.foldersWritten++;
        }, incomingSigs.folders[folder.id], folder.name);
      });
      workspace.savedSearches.forEach(function (search) {
        applyEntity('savedSearches', search.id, function () {
          writeSavedSearch(d, search);
          stats.searchesWritten++;
        }, incomingSigs.savedSearches[search.id], search.name);
      });
      workspace.tagColorRecords.forEach(function (record) {
        applyEntity('tagColorRecords', record.tag, function () {
          writeTagColor(d, record);
          stats.tagColorsWritten++;
        }, incomingSigs.tagColorRecords[record.tag], record.tag);
      });
      d.exec('COMMIT');
    } catch (error) {
      try { d.exec('ROLLBACK'); } catch (rollbackError) {}
      throw error;
    }
    // 本轮写完的签名表就是下一轮保存的「库内当前签名」
    signaturesCache = resultSigs;
    stats.signatures = resultSigs;
    return stats;
  }

  /**
   * 整库替换（仅供「JSON 整库恢复」等显式场景）：
   * payload 即完整目标状态；库内多余实体硬删，payload 中墓碑照常入库。
   */
  function replaceState(value) {
    const d = requireDb();
    const workspace = LitModel.normalizeWorkspace(value);
    const now = Date.now();
    const stats = { papersWritten: 0, papersDeleted: 0, notesWritten: 0, notesDeleted: 0, foldersWritten: 0, foldersDeleted: 0 };

    const existingPapers = {};
    d.prepare('SELECT id, hash FROM papers').all().forEach(function (row) { existingPapers[row.id] = row.hash; });
    const existingNotes = {};
    d.prepare('SELECT id, hash FROM notes').all().forEach(function (row) { existingNotes[row.id] = row.hash; });
    const existingFolders = {};
    d.prepare('SELECT id, hash FROM folders').all().forEach(function (row) { existingFolders[row.id] = row.hash; });

    d.exec('BEGIN');
    try {
      const seenPapers = {};
      workspace.papers.forEach(function (paper) {
        seenPapers[paper.id] = true;
        if (existingPapers[paper.id] === hashEntity(paper)) return; // 内容未变：跳过
        writePaper(d, paper, now);
        stats.papersWritten++;
      });
      Object.keys(existingPapers).forEach(function (id) {
        if (seenPapers[id]) return;
        deletePaper(d, id);
        stats.papersDeleted++;
      });

      const seenNotes = {};
      workspace.notes.forEach(function (note) {
        seenNotes[note.id] = true;
        if (existingNotes[note.id] === hashEntity(note)) return; // 内容未变：跳过
        writeNote(d, note);
        stats.notesWritten++;
      });
      Object.keys(existingNotes).forEach(function (id) {
        if (seenNotes[id]) return;
        d.prepare('DELETE FROM notes WHERE id = ?').run(id);
        stats.notesDeleted++;
      });

      const seenFolders = {};
      workspace.folders.forEach(function (folder) {
        seenFolders[folder.id] = true;
        if (existingFolders[folder.id] === hashEntity(folder)) return;
        writeFolder(d, folder, now);
        stats.foldersWritten++;
      });
      Object.keys(existingFolders).forEach(function (id) {
        if (seenFolders[id]) return;
        d.prepare('DELETE FROM folders WHERE id = ?').run(id);
        stats.foldersDeleted++;
      });

      // 小型附属实体：整体替换（行数小，代价可忽略）
      d.prepare('DELETE FROM saved_searches').run();
      workspace.savedSearches.forEach(function (search) {
        d.prepare('INSERT INTO saved_searches(id, name, query, ast, sort_index, updated_at, deleted_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
          .run(search.id, search.name, search.query, search.ast || '', search.sortIndex, Number(search.updatedAt) || 0,
            search.deletedAt != null ? search.deletedAt : null);
      });
      d.prepare('DELETE FROM tag_colors').run();
      const tagColorRecords = Array.isArray(workspace.tagColorRecords)
        ? workspace.tagColorRecords
        : Object.keys(workspace.tagColors).map(function (tag) {
          return { tag: tag, color: workspace.tagColors[tag], updatedAt: now, deletedAt: null };
        });
      tagColorRecords.forEach(function (record) {
        d.prepare('INSERT INTO tag_colors(tag, color, updated_at, deleted_at) VALUES(?, ?, ?, ?)')
          .run(record.tag, record.color, Number(record.updatedAt) || 0,
            record.deletedAt != null ? record.deletedAt : null);
      });
      d.exec('COMMIT');
    } catch (error) {
      try { d.exec('ROLLBACK'); } catch (rollbackError) {}
      throw error;
    }
    invalidateSignaturesCache();
    return stats;
  }

  // ---------- 浏览器扩展的原子桥接写入（专用事务，不经过整库读改存） ----------

  function normalizeDoiValue(doi) {
    return String(doi || '').replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').trim();
  }

  function folderExistsLive(d, folderId) {
    if (!folderId) return false;
    const row = d.prepare('SELECT id FROM folders WHERE id = ? AND deleted_at IS NULL').get(folderId);
    return !!row;
  }

  /**
   * 扩展保存文献：DOI 去重，存在则仅补缺字段，不存在则新建；单事务完成。
   * 返回 { paper, duplicated }（paper 为 normalize 后的最新版本）。
   */
  function bridgeUpsertPaper(input) {
    const d = requireDb();
    const now = Date.now();
    const doi = normalizeDoiValue(input && input.doi);
    const folderId = String(input && input.folderId || '');
    d.exec('BEGIN');
    try {
      let existing = null;
      if (doi) {
        const row = d.prepare('SELECT data FROM papers WHERE lower(doi) = lower(?) AND deleted_at IS NULL').get(doi);
        if (row) {
          try { existing = JSON.parse(row.data); } catch (error) {
            throw corruptionError('papers.data 无法解析（DOI=' + doi + '）');
          }
        }
      }
      const validFolder = folderExistsLive(d, folderId);
      if (existing) {
        let changed = false;
        ['abstract', 'doi', 'url', 'venue', 'oaUrl', 'openalexId', 'volume', 'issue', 'pages', 'issn',
          'date', 'publisher', 'isbn', 'language'].forEach(function (f) {
          if (!existing[f] && input[f]) { existing[f] = input[f]; changed = true; }
        });
        if (existing.entryType === 'misc' && input.entryType && input.entryType !== 'misc') {
          existing.entryType = input.entryType;
          changed = true;
        }
        if (existing.year == null && input.year != null) { existing.year = input.year; changed = true; }
        if (existing.citations == null && input.citations != null) {
          existing.citations = input.citations;
          existing.citationSource = input.citationSource || '';
          changed = true;
        }
        if ((!existing.authors || !existing.authors.length) && input.authors && input.authors.length) {
          existing.authors = input.authors;
          changed = true;
        }
        // 溯源：已有条目补记来源类型（不覆盖已有值）；translatorError 只记空（诊断信息不覆盖）
        if (input.sourceType && !existing.sourceType) { existing.sourceType = input.sourceType; changed = true; }
        if (validFolder && (existing.folderIds || []).indexOf(folderId) === -1) {
          existing.folderIds = (existing.folderIds || []).concat([folderId]);
          changed = true;
        }
        if (changed) {
          LitModel.touch(existing);
          const paper = LitModel.normalizePaper(existing);
          paper.id = existing.id;
          writePaper(d, paper, now);
          invalidateSignaturesCache();
          existing = paper;
        }
        d.exec('COMMIT');
        return { paper: LitModel.normalizePaper(existing), duplicated: true };
      }
      const paper = LitModel.normalizePaper(Object.assign({
        title: input.title || '(未命名)',
        doi: doi,
        url: input.url || '',
        authors: input.authors || [],
        year: input.year != null ? input.year : null,
        venue: input.venue || '',
        abstract: input.abstract || '',
        issn: input.issn || '',
        citations: input.citations != null ? input.citations : null,
        citationSource: input.citationSource || '',
        oaUrl: input.oaUrl || '',
        openalexId: input.openalexId || '',
        volume: input.volume || '',
        issue: input.issue || '',
        pages: input.pages || '',
        entryType: input.entryType || 'article',
        date: input.date || '',
        publisher: input.publisher || '',
        isbn: input.isbn || '',
        language: input.language || '',
        tags: input.tags || [],
        folderIds: validFolder ? [folderId] : [],
        sourceType: input.sourceType || '',
        bibtexExtra: input.translatorError ? { translatorError: String(input.translatorError).slice(0, 300) } : undefined
      }));
      writePaper(d, paper, now);
      invalidateSignaturesCache();
      d.exec('COMMIT');
      return { paper: paper, duplicated: false };
    } catch (error) {
      try { d.exec('ROLLBACK'); } catch (rollbackError) {}
      throw error;
    }
  }

  /**
   * 扩展挂载已下载的 PDF：把磁盘文件登记到 paper.attachments 首位，单事务。
   * 返回 normalize 后的 paper；文献不存在返回 null。
   */
  function bridgeAttachPdf(paperId, filePath, fileName) {
    const d = requireDb();
    const now = Date.now();
    d.exec('BEGIN');
    try {
      const row = d.prepare('SELECT data FROM papers WHERE id = ?').get(String(paperId));
      if (!row) { d.exec('COMMIT'); return null; }
      let paper;
      try { paper = JSON.parse(row.data); } catch (error) {
        throw corruptionError('papers.data 无法解析（id=' + paperId + '）');
      }
      paper.attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
      const exists = paper.attachments.some(function (att) {
        return att && att.kind === 'pdf' && att.path === filePath;
      });
      if (!exists) {
        paper.attachments.unshift(LitModel.normalizeAttachment({
          id: 'at' + crypto.randomBytes(8).toString('hex'),
          kind: 'pdf',
          fileName: fileName || path.basename(filePath),
          path: filePath,
          fingerprint: '',
          cloudName: '',
          syncSignature: '',
          addedAt: now
        }));
        LitModel.touch(paper);
        paper = LitModel.normalizePaper(paper);
        writePaper(d, paper, now);
        invalidateSignaturesCache();
      }
      d.exec('COMMIT');
      return LitModel.normalizePaper(paper);
    } catch (error) {
      try { d.exec('ROLLBACK'); } catch (rollbackError) {}
      throw error;
    }
  }

  /** 按 id 取单篇文献（normalize 后），不存在返回 null */
  function getPaper(paperId) {
    const row = requireDb().prepare('SELECT data FROM papers WHERE id = ?').get(String(paperId));
    if (!row) return null;
    try { return LitModel.normalizePaper(JSON.parse(row.data)); } catch (error) {
      throw corruptionError('papers.data 无法解析（id=' + paperId + '）');
    }
  }

  /**
   * 安全地把当前数据库快照到 targetPath（含全文/语义索引，同库单文件）：
   * 优先 node:sqlite backup() 在线备份；不支持时 WAL 归档检查点 + 文件复制。
   */
  async function snapshotTo(targetPath) {
    const d = requireDb();
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if (sqliteBackup) {
      await sqliteBackup(d, targetPath);
      return;
    }
    await fs.copyFile(file, targetPath);
  }

  // ---------- 设置（阅读位置、同步游标等） ----------

  function getSetting(key) {
    const row = requireDb().prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (error) { return null; }
  }
  function setSetting(key, value) {
    requireDb().prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(String(key), JSON.stringify(value == null ? null : value));
  }

  // ---------- PDF 全文索引 ----------
  //
  // pdf_text.pages 存 zlib(level 1) 压缩的 JSON BLOB（v6 起；旧库迁移时已转换）。
  // 全文文本在库里本就存了两份（pages + pdf_fts 索引原文），压缩让 pages 这份缩小 ~3x。

  async function pdfTextPut(entry) {
    const d = requireDb();
    const paperId = String(entry.paperId || '');
    const attachmentId = String(entry.attachmentId || '');
    if (!paperId) throw new Error('缺少 paperId');
    const pages = (Array.isArray(entry.pages) ? entry.pages : []).slice(0, 400).map(function (pageText) {
      const value = String(pageText || '');
      return value.length > 200000 ? value.slice(0, 200000) : value;
    });
    const packed = await gzipAsync(Buffer.from(JSON.stringify(pages), 'utf8'), { level: 1 });
    d.exec('BEGIN');
    try {
      d.prepare(`INSERT INTO pdf_text(paper_id, attachment_id, fingerprint, method, pages, updated_at) VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(paper_id, attachment_id) DO UPDATE SET fingerprint=excluded.fingerprint, method=excluded.method,
          pages=excluded.pages, updated_at=excluded.updated_at`)
        .run(paperId, attachmentId, String(entry.fingerprint || ''), String(entry.method || 'mupdf'),
          packed, Date.now());
      d.prepare('DELETE FROM pdf_fts WHERE paper_id = ? AND attachment_id = ?').run(paperId, attachmentId);
      const insert = d.prepare('INSERT INTO pdf_fts(paper_id, attachment_id, page, text) VALUES(?, ?, ?, ?)');
      pages.forEach(function (pageText, index) {
        if (pageText) insert.run(paperId, attachmentId, index, pageText);
      });
      d.exec('COMMIT');
    } catch (error) {
      try { d.exec('ROLLBACK'); } catch (rollbackError) {}
      throw error;
    }
    return { paperId: paperId, attachmentId: attachmentId, pages: pages.length };
  }

  /** pages 列双格式兼容：BLOB 解压、TEXT 原样（防御旧数据），解析失败返回空数组。
   *  node:sqlite 对 BLOB 返回 Uint8Array（Buffer 的基类），不能用 Buffer.isBuffer 判断 */
  async function unpackPages(value) {
    let raw;
    try {
      raw = value instanceof Uint8Array
        ? await gunzipAsync(value)
        : Buffer.from(value == null ? '' : String(value), 'utf8');
      return JSON.parse(raw.toString('utf8'));
    } catch (error) {
      return [];
    }
  }

  function pdfTextMeta() {
    const out = {};
    requireDb().prepare('SELECT paper_id, attachment_id, fingerprint, method, updated_at FROM pdf_text').all()
      .forEach(function (row) {
        const item = { paperId: row.paper_id, attachmentId: row.attachment_id || '', fingerprint: row.fingerprint || '',
          method: row.method || '', updatedAt: row.updated_at || 0 };
        out[row.paper_id + ':' + (row.attachment_id || '')] = item;
        if (!row.attachment_id) Object.defineProperty(out, row.paper_id, { value: item, enumerable: false });
      });
    return out;
  }

  /**
   * 读取某附件的全文索引：严格按 (paperId, attachmentId) 身份匹配。
   *
   * A-followup #2：旧版单 PDF 时代把索引写在 attachment_id='' 上，此前这里在「指定附件
   * 查不到」时无条件回退到空 ID 行——于是「读补充材料」会静默返回主文献正文，调用成功且
   * 没有任何提示。兼容回退改为**调用方显式选择**（options.legacyFallback === true）：
   * 显式附件查询保持严格匹配，只有调用方确知自己问的是「该文献的主 PDF 旧索引」时才开。
   */
  async function pdfTextGet(paperId, attachmentId, options) {
    const d = requireDb();
    const id = String(paperId);
    const att = String(attachmentId || '');
    const legacyOk = !!(options && options.legacyFallback === true);
    const row = d.prepare('SELECT attachment_id, fingerprint, method, pages FROM pdf_text WHERE paper_id = ? AND attachment_id = ?').get(id, att) ||
      (att && legacyOk ? d.prepare('SELECT attachment_id, fingerprint, method, pages FROM pdf_text WHERE paper_id = ? AND attachment_id = \'\'').get(id) : null);
    if (!row) return null;
    return { paperId: id, attachmentId: row.attachment_id || '', fingerprint: row.fingerprint || '', method: row.method || '', pages: await unpackPages(row.pages) };
  }

  /** 按页区间读取（AI 阅读助手用）：只解压一次、只返回 [from, to] 闭区间内的页，
   *  每页截断 capChars——大文档不必把整篇 pages 数组拉过 IPC。页码 1 基。
   *  R4：fromChar 只作用于起始页的页内偏移（高密度页 >capChars 时分次读完整页文字），
   *  每页带 charOffset/charTotal，调用方据此计算续读位置。
   *  options 透传给 pdfTextGet（legacyFallback 语义见上）。 */
  async function pdfTextGetRange(paperId, attachmentId, from, to, capChars, fromChar, options) {
    const full = await pdfTextGet(paperId, attachmentId, options);
    if (!full) return null;
    const total = full.pages.length;
    const start = Math.max(1, Number(from) || 1);
    const end = Math.min(total, Math.max(start, Number(to) || start));
    const cap = Math.max(200, Number(capChars) || 3500);
    const skip = Math.max(0, Math.floor(Number(fromChar) || 0));
    const pages = [];
    for (let i = start; i <= end; i++) {
      const raw = String(full.pages[i - 1] || '');
      const charOffset = i === start ? skip : 0;
      const text = raw.slice(charOffset);
      pages.push({
        page: i,
        charOffset: charOffset,
        charTotal: raw.length,
        text: text.length > cap ? text.slice(0, cap) + '…[截断]' : text
      });
    }
    return { paperId: full.paperId, attachmentId: full.attachmentId, method: full.method, total: total, from: start, to: end, pages: pages };
  }

  function pdfTextInvalidate(paperId, attachmentId) {
    const d = requireDb();
    const id = String(paperId);
    const att = String(attachmentId || '');
    if (attachmentId) {
      d.prepare('DELETE FROM pdf_text WHERE paper_id = ? AND attachment_id = ?').run(id, att);
      d.prepare('DELETE FROM pdf_fts WHERE paper_id = ? AND attachment_id = ?').run(id, att);
    } else {
      d.prepare('DELETE FROM pdf_text WHERE paper_id = ?').run(id);
      d.prepare('DELETE FROM pdf_fts WHERE paper_id = ?').run(id);
    }
    return true;
  }

  /**
   * 清空全文索引。
   *
   * FTS5 的 DELETE 只把行标记为删除、不回收索引块（实测：把 500 篇的索引删空后
   * `pdf_fts_data` 仍占 21.76 MB，文件体积几乎不变）。所以这里 DROP 后重建再 VACUUM，
   * 让「删除全文索引」真的把磁盘还回来 —— 否则用户点了按钮却看不到空间变化。
   */
  function pdfTextClear() {
    const d = requireDb();
    d.prepare('DELETE FROM pdf_text').run();
    d.exec('DROP TABLE IF EXISTS pdf_fts');
    d.exec("CREATE VIRTUAL TABLE pdf_fts USING fts5(paper_id UNINDEXED, attachment_id UNINDEXED, page UNINDEXED, text, tokenize='trigram')");
    d.exec('VACUUM');
    return true;
  }

  function pdfTextStats() {
    const d = requireDb();
    const row = d.prepare('SELECT COUNT(*) AS entries, SUM(LENGTH(pages)) AS chars FROM pdf_text').get();
    return { entries: row.entries || 0, chars: row.chars || 0 };
  }

  /**
   * 子串全文检索（与原渲染层 indexOf 语义一致）：
   * - 查询 ≥3 字符走 trigram FTS（等价子串语义，含中文）；
   * - 2 字符以内回退全表扫描（trigram 下限，中文短词如「量子」「算法」只能走这条）。
   * 返回 [{ paperId, pages:[页索引], count, snippets:[{page, text}] }]。
   *
   * 性能（主进程即窗口的消息泵，任何一段长同步工作都会让整个应用「未响应」）：
   * - FTS 路径不再取 snippet(...)——它要为最多 2000 行分词并构建片段，实测占该查询约 85% 耗时，
   *   而调用方（界面只显示页码；agent 工具每篇最多 2 条）用不到那么多片段：片段改为只对
   *   排在前面的若干篇按需现算；
   * - 短词路径的全表解压按批 await 让出事件循环（zlib.gunzip 异步 + 每 16 行一次让出），
   *   结果与逐行同步解压完全一致。
   */
  const QUERY_PAGE_LIMIT = 2000;
  const SNIPPET_PAPER_LIMIT = 24;
  const SNIPPET_PER_HIT = 3;
  // 短词回退全表扫描时的让出节奏：按「行数」或「已扫描字节」谁先到就让出一次。
  // 单看行数不够——有的行是一本书（数十 MB 解压后），十几行就能堵上几百毫秒
  const SCAN_YIELD_ROWS = 16;
  const SCAN_YIELD_BYTES = 8 * 1024 * 1024;

  function yieldToLoop() {
    return new Promise(function (resolve) { setImmediate(resolve); });
  }

  /** 解压 + 解析一行的 pages（BLOB 走 gunzip，历史 TEXT 行直接 JSON.parse）；失败返回 null */
  async function unpackPageRow(value) {
    try {
      const buffer = value instanceof Uint8Array
        ? await gunzipAsync(Buffer.from(value))
        : Buffer.from(value == null ? '' : String(value), 'utf8');
      const pages = JSON.parse(buffer.toString('utf8'));
      return Array.isArray(pages) ? pages : null;
    } catch (error) { return null; }
  }

  /** 命中片段：命中词两侧各 40 字，命中处用 ⟪⟫ 标出（与旧 FTS snippet 的可读性对齐） */
  function snippetAround(text, at, length) {
    const start = Math.max(0, at - 40);
    const end = Math.min(text.length, at + length + 40);
    return (start > 0 ? '…' : '') +
      text.slice(start, at).replace(/\s+/g, ' ') + '⟪' +
      text.slice(at, at + length).replace(/\s+/g, ' ') + '⟫' +
      text.slice(at + length, end).replace(/\s+/g, ' ') +
      (end < text.length ? '…' : '');
  }

  async function pdfTextQuery(query, attachmentId) {
    const d = requireDb();
    const needle = String(query || '').trim();
    const attachmentFilter = String(attachmentId || '');
    if (!needle) return [];
    const byPaper = {};
    function addHit(paperId, attachId, page, snippetText) {
      const key = paperId + ':' + attachId;
      if (!byPaper[key]) byPaper[key] = { paperId: paperId, attachmentId: attachId, pageSet: {}, snippets: [] };
      byPaper[key].pageSet[page] = true;
      if (snippetText && byPaper[key].snippets.length < SNIPPET_PER_HIT) {
        byPaper[key].snippets.push({ page: page, text: snippetText });
      }
    }
    if ([...needle].length >= 3) {
      const phrase = '"' + needle.replace(/"/g, '""') + '"';
      const statement = attachmentFilter
        ? d.prepare('SELECT paper_id, attachment_id, page FROM pdf_fts WHERE pdf_fts MATCH ? AND attachment_id = ? LIMIT ' + QUERY_PAGE_LIMIT)
        : d.prepare('SELECT paper_id, attachment_id, page FROM pdf_fts WHERE pdf_fts MATCH ? LIMIT ' + QUERY_PAGE_LIMIT);
      const rows = attachmentFilter ? statement.all(phrase, attachmentFilter) : statement.all(phrase);
      rows.forEach(function (row) { addHit(row.paper_id, row.attachment_id || '', row.page, ''); });
      await attachSnippets(d, byPaper, needle);
    } else {
      const lower = needle.toLowerCase();
      const textRows = attachmentFilter
        ? d.prepare('SELECT paper_id, attachment_id, pages FROM pdf_text WHERE attachment_id = ?').all(attachmentFilter)
        : d.prepare('SELECT paper_id, attachment_id, pages FROM pdf_text').all();
      let scannedBytes = 0;
      let rowsSinceYield = 0;
      for (const row of textRows) {
        scannedBytes += row.pages instanceof Uint8Array ? row.pages.byteLength : 0;
        rowsSinceYield += 1;
        const pages = await unpackPageRow(row.pages);
        if (pages) {
          pages.forEach(function (pageText, index) {
            const textValue = String(pageText || '');
            const at = textValue.toLowerCase().indexOf(lower);
            if (at === -1) return;
            addHit(row.paper_id, row.attachment_id || '', index, snippetAround(textValue, at, needle.length));
          });
        }
        if (rowsSinceYield >= SCAN_YIELD_ROWS || scannedBytes >= SCAN_YIELD_BYTES) {
          scannedBytes = 0;
          rowsSinceYield = 0;
          await yieldToLoop();
        }
      }
    }
    return Object.keys(byPaper).map(function (key) {
      const hit = byPaper[key];
      const pages = Object.keys(hit.pageSet).map(Number).sort(function (a, b) { return a - b; });
      return { paperId: hit.paperId, attachmentId: hit.attachmentId, pages: pages, count: pages.length, snippets: hit.snippets };
    });
  }

  /** 为前若干篇命中补片段：命中页正文单独取回（每篇一次解压），不做全库扫描 */
  async function attachSnippets(d, byPaper, needle) {
    const lower = needle.toLowerCase();
    let budget = SNIPPET_PAPER_LIMIT;
    const keys = Object.keys(byPaper);
    const readPages = d.prepare('SELECT pages FROM pdf_text WHERE paper_id = ? AND attachment_id = ?');
    for (let i = 0; i < keys.length && budget > 0; i++) {
      const hit = byPaper[keys[i]];
      if (hit.snippets.length) continue;
      budget -= 1;
      const row = readPages.get(hit.paperId, hit.attachmentId);
      if (!row) continue;
      const pages = await unpackPageRow(row.pages);
      if (!pages) continue;
      const wanted = Object.keys(hit.pageSet).map(Number).sort(function (a, b) { return a - b; });
      for (const page of wanted) {
        if (hit.snippets.length >= SNIPPET_PER_HIT) break;
        const textValue = String(pages[page] == null ? '' : pages[page]);
        const at = textValue.toLowerCase().indexOf(lower);
        if (at === -1) continue;
        hit.snippets.push({ page: page, text: snippetAround(textValue, at, needle.length) });
      }
    }
  }

  // ---------- 备份 ----------

  /** 读取 .bak 的节流时间戳（旧库里的 settings.lastBackupAt 仍读一次以兼容升级） */
  async function readBackupStamp() {
    try { return Number(await fs.readFile(backupStampFile, 'utf8')) || 0; } catch (error) { return 0; }
  }

  async function backupIfDue(force) {
    const d = requireDb();
    const last = (await readBackupStamp()) || Number(getSetting('lastBackupAt')) || 0;
    if (!force && Date.now() - last < BACKUP_INTERVAL_MS) return false;
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    await fs.copyFile(file, backupFile);
    try { await fs.writeFile(backupStampFile, String(Date.now()), 'utf8'); } catch (error) {}
    return true;
  }

  // ---------- 旧 JSON 存储迁移 ----------

  async function migrateLegacy(legacyStorage, pdfCacheFile) {
    const d = requireDb();
    const migrated = [];
    const paperCount = d.prepare('SELECT COUNT(*) AS c FROM papers').get().c;
    if (paperCount === 0 && legacyStorage) {
      const state = await legacyStorage.loadState();
      if (state.papers.length || state.folders.length) {
        saveState(state);
        migrated.push('library');
      }
      const paths = legacyStorage.paths || {};
      for (const candidate of [paths.file, paths.temp, paths.backup]) {
        if (candidate) await fs.rename(candidate, candidate + '.migrated').catch(function () {});
      }
    }
    if (pdfCacheFile) {
      try {
        const raw = await fs.readFile(pdfCacheFile, 'utf8');
        const value = JSON.parse(raw);
        const entries = Object.keys(value || {});
        if (entries.length) {
          for (const paperId of entries) {
            const entry = value[paperId];
            if (!entry || !Array.isArray(entry.pages)) continue;
            await pdfTextPut({
              paperId: paperId,
              fingerprint: entry.fingerprint || '',
              method: entry.method || 'mupdf',
              pages: entry.pages
            });
          }
          migrated.push('pdftext');
        }
        await fs.rename(pdfCacheFile, pdfCacheFile + '.migrated').catch(function () {});
      } catch (error) { /* 无缓存文件或已损坏：跳过即可 */ }
    }
    return migrated;
  }

  async function close() {
    if (!db) return;
    try { await backupIfDue(false); } catch (error) {}
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (error) {}
    try { db.close(); } catch (error) {}
    db = null;
  }

  return {
    open: open,
    loadState: loadState,
    saveState: saveState,
    replaceState: replaceState,
    bridgeUpsertPaper: bridgeUpsertPaper,
    bridgeAttachPdf: bridgeAttachPdf,
    getPaper: getPaper,
    recordReadAt: recordReadAt,
    snapshotTo: snapshotTo,
    getSetting: getSetting,
    setSetting: setSetting,
    pdfTextPut: pdfTextPut,
    pdfTextGet: pdfTextGet,
    pdfTextGetRange: pdfTextGetRange,
    pdfTextMeta: pdfTextMeta,
    pdfTextInvalidate: pdfTextInvalidate,
    pdfTextClear: pdfTextClear,
    pdfTextStats: pdfTextStats,
    pdfTextQuery: pdfTextQuery,
    backupIfDue: backupIfDue,
    migrateLegacy: migrateLegacy,
    close: close,
    paths: { file: file, backup: backupFile }
  };
}

module.exports = { createLibraryDb, hashEntity };
