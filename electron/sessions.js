'use strict';

/**
 * LitBoard AI 会话存储（主进程专用）：磁盘布局与会话生命周期。
 *
 * 布局（用户约定）：<root>/会话记录/<YYYYMMDD>/<标题 NN>/{session.json, 会话记录.md, 附件/}
 * - session.json 是唯一事实源（稳定 ID + 消息 + 工具调用 + 附件映射）；
 *   会话记录.md 永远是生成物（导出时渲染），两者不会双向同步；
 * - 根目录 index.json 是轻量索引（损坏/缺失时全盘扫描重建）；
 * - 写入一律「temp + rename」（Windows 下 rename 失败回退 copy，比照 integrations 惯例）；
 * - 流式期间 setData 只标脏，1s 防抖落盘；关键事件（工具执行前/轮收尾等）走 commit——
 *   立即写盘并等待完成（按会话串行 + revision 防在途写误标 clean），返回时已在磁盘；
 * - attachments 字段归主进程所有（saveAttachment 是唯一写入口）：渲染层 setData/commit
 *   的快照不覆盖主进程登记的附件集合，commit 把当前登记回传给渲染层同步副本；
 * - 删除走回收站（shell.trashItem 由调用方注入），会话是用户长期成果，不做硬删。
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const LitResearch = require('../js/research.js');

const FLUSH_DELAY_MS = 1000;
// 聚合索引的写盘防抖（真相源即时写、聚合数据防抖——Roo Code TaskHistoryStore 同策略）。
// index.json 是「会话列表」这份聚合缓存的镜像，每次消息落盘都跟着全量重写纯属浪费；
// 结构性变更（新建/改名/删除）仍强制立即写，且 list() 会滤掉磁盘上已消失的目录自愈。
const INDEX_WRITE_DELAY_MS = 2000;

function createSessions(options) {
  const opts = options || {};
  const rootDir = opts.rootDir;                       // <root>/会话记录
  const trashItem = opts.trashItem || null;           // async (dir) => void（shell.trashItem）
  const flushDelayMs = Number(opts.flushDelayMs) || FLUSH_DELAY_MS;
  const indexWriteDelayMs = opts.indexWriteDelayMs == null ? INDEX_WRITE_DELAY_MS : Number(opts.indexWriteDelayMs);
  const log = opts.log || function () {};
  const cache = new Map();                            // id → { data, dir, timer, dirty }
  let indexCache = null;
  let indexDirty = false;
  let indexTimer = null;

  function indexPath() { return path.join(rootDir, 'index.json'); }
  function sessionPath(dir) { return path.join(rootDir, dir, 'session.json'); }

  async function atomicWrite(file, content) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.tmp-' + process.pid + '-' + Date.now();
    await fs.writeFile(temp, content, 'utf8');
    try {
      await fs.rename(temp, file);
    } catch (error) {
      try { await fs.copyFile(temp, file); }
      finally { await fs.rm(temp, { force: true }).catch(function () {}); }
    }
  }

  function newSessionData(id, title) {
    const now = new Date().toISOString();
    return {
      v: 1,
      id: id,
      title: title || '新会话',
      createdAt: now,
      updatedAt: now,
      model: '',
      messages: [],
      attachments: []
    };
  }

  function dateFolderName(when) {
    const d = when ? new Date(when) : new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return '' + d.getFullYear() + mm + dd;
  }

  /** 在日期目录里找第一个空闲的「标题 NN」目录名 */
  async function freeDirName(dateDir, title) {
    for (let n = 1; n < 1000; n++) {
      const candidate = LitResearch.sessionDirName(title, n);
      try {
        await fs.access(path.join(rootDir, dateDir, candidate));
      } catch (error) {
        return candidate;
      }
    }
    return LitResearch.sessionDirName(title, Date.now() % 1000);
  }

  async function ensureRoot() {
    await fs.mkdir(rootDir, { recursive: true });
  }

  async function readIndex() {
    if (indexCache) return indexCache;
    try {
      const parsed = JSON.parse(await fs.readFile(indexPath(), 'utf8'));
      if (parsed && parsed.version === 1 && Array.isArray(parsed.sessions)) {
        indexCache = parsed;
        return parsed;
      }
    } catch (error) { /* 损坏则重建 */ }
    indexCache = await rebuildIndex();
    return indexCache;
  }

  /** 索引写盘：默认防抖（高频消息落盘只标脏），immediate=true 用于结构变更/收尾 */
  async function flushIndex(immediate) {
    if (indexTimer) {
      if (!immediate) return;            // 已有排期，等它写
      clearTimeout(indexTimer);
      indexTimer = null;
    }
    if (!indexDirty || !indexCache) return;
    indexDirty = false;
    try {
      await atomicWrite(indexPath(), JSON.stringify(indexCache, null, 2));
    } catch (error) {
      indexDirty = true;                 // 写失败留脏，下次再试
      throw error;
    }
  }

  function scheduleIndexWrite() {
    indexDirty = true;
    if (indexTimer) return;
    indexTimer = setTimeout(function () {
      indexTimer = null;
      flushIndex(true).catch(function (error) { log('index flush failed: ' + error); });
    }, indexWriteDelayMs);
    // 主进程里这个定时器不该拖住退出：退出前有 flushAll 兜底强制写
    if (indexTimer.unref) indexTimer.unref();
  }

  function writeIndex(index) {
    indexCache = index;
    scheduleIndexWrite();
  }

  /** 全盘扫描重建索引（index.json 缺失/损坏，或目录里出现索引外的会话） */
  async function rebuildIndex() {
    await ensureRoot();
    const sessions = [];
    let dateDirs = [];
    try { dateDirs = await fs.readdir(rootDir); } catch (error) {}
    for (const dateDir of dateDirs) {
      if (!/^\d{8}$/.test(dateDir)) continue;
      let titles = [];
      try { titles = await fs.readdir(path.join(rootDir, dateDir)); } catch (error) { continue; }
      for (const title of titles) {
        const file = path.join(rootDir, dateDir, title, 'session.json');
        try {
          const data = JSON.parse(await fs.readFile(file, 'utf8'));
          if (data && data.id) {
            sessions.push({
              id: String(data.id),
              title: String(data.title || title),
              dir: dateDir + path.sep + title,
              createdAt: data.createdAt || '',
              updatedAt: data.updatedAt || '',
              msgCount: Array.isArray(data.messages) ? data.messages.length : 0
            });
          }
        } catch (error) { /* 非会话目录，跳过 */ }
      }
    }
    sessions.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    const index = { version: 1, sessions: sessions };
    indexCache = index;
    indexDirty = true;
    await flushIndex(true);
    return index;
  }

  /** 更新索引条目：immediate 只在结构变更（新建/改名）时为真；
   * 高频的消息落盘路径必须走防抖——否则每次落盘都强制写索引，防抖形同虚设。 */
  async function upsertIndexEntry(entry, immediate) {
    const index = await readIndex();
    const rest = index.sessions.filter(function (s) { return s.id !== entry.id; });
    rest.unshift(entry);
    rest.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    writeIndex({ version: 1, sessions: rest });
    if (immediate) await flushIndex(true);
  }

  async function create(input) {
    await ensureRoot();
    const title = LitResearch.sessionTitleFrom(input && input.title);
    const dateDir = dateFolderName();
    await fs.mkdir(path.join(rootDir, dateDir), { recursive: true });
    const dirName = await freeDirName(dateDir, title);
    const dir = dateDir + path.sep + dirName;
    const id = 's' + crypto.randomBytes(8).toString('hex');
    const data = newSessionData(id, title);
    if (input && input.model) data.model = String(input.model);
    await atomicWrite(sessionPath(dir), JSON.stringify(data, null, 2));
    cache.set(id, { data: data, dir: dir, timer: null, dirty: false });
    await upsertIndexEntry({
      id: id, title: data.title, dir: dir,
      createdAt: data.createdAt, updatedAt: data.updatedAt, msgCount: 0
    }, true); // 新建：结构变更，立即写索引
    return { id: id, dir: dir, data: data };
  }

  function entryOf(id) {
    return cache.get(String(id || ''));
  }

  async function loadEntry(id) {
    const cached = cache.get(String(id || ''));
    if (cached) return cached;
    const index = await readIndex();
    const meta = index.sessions.filter(function (s) { return s.id === String(id); })[0];
    if (!meta) return null;
    let data = null;
    try { data = JSON.parse(await fs.readFile(sessionPath(meta.dir), 'utf8')); } catch (error) { return null; }
    const entry = { data: data, dir: meta.dir, timer: null, dirty: false };
    cache.set(data.id, entry);
    return entry;
  }

  async function read(id) {
    const entry = await loadEntry(id);
    return entry ? JSON.parse(JSON.stringify(entry.data)) : null;
  }

  /** 整体替换会话内容（渲染层是状态持有方）；1s 防抖落盘，返回前不阻塞调用方 */
  async function setData(id, data) {
    const entry = await loadEntry(id);
    if (!entry) throw new Error('会话不存在：' + id);
    applyIncomingData(entry, data, String(id));
    entry.revision = (entry.revision || 0) + 1;
    entry.dirty = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(function () { flush(id).catch(function (error) { log('session flush failed: ' + error); }); }, flushDelayMs);
    return { ok: true };
  }

  /**
   * 关键事件落盘（R04）：整体替换 + **立即写盘并等待完成**，返回时 session.json 已提交。
   * 与 setData 共用合并规则；写盘按会话串行（写队列），并用 revision 防止在途写把
   * 后到的修改误标 clean。返回当前附件登记（R05：渲染层据此同步自己的 doc 副本）。
   */
  async function commit(id, data) {
    const entry = await loadEntry(id);
    if (!entry) throw new Error('会话不存在：' + id);
    applyIncomingData(entry, data, String(id));
    entry.revision = (entry.revision || 0) + 1;
    entry.dirty = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    await flush(id);
    return { ok: true, attachments: Array.isArray(entry.data.attachments) ? entry.data.attachments.slice() : [] };
  }

  /**
   * 渲染层快照合并进主进程条目（R05 字段所有权）：
   * attachments 归主进程管理（saveAttachment 是唯一写入口）——渲染层持有的旧副本
   * 一律以主进程当前登记为准，防止下一次 setData/commit 把附件登记整体覆盖掉。
   */
  function applyIncomingData(entry, data, id) {
    const incoming = data && typeof data === 'object' ? data : entry.data;
    if (Array.isArray(entry.data.attachments) && entry.data.attachments.length) {
      incoming.attachments = entry.data.attachments.slice();
    } else if (!Array.isArray(incoming.attachments)) {
      incoming.attachments = [];
    }
    incoming.id = id;
    incoming.updatedAt = new Date().toISOString();
    entry.data = incoming;
  }

  async function flush(id) {
    const entry = entryOf(id) || await loadEntry(id);
    if (!entry || !entry.dirty) return;
    // 同一会话的写盘严格串行；revision 快照保证「写盘期间又来了新修改」不会丢脏标
    const write = (entry.chain || Promise.resolve()).then(async function () {
      if (!entry.dirty) return;
      const rev = entry.revision || 0;
      const clean = LitResearch.sanitizeSessionForDisk(entry.data);
      await atomicWrite(sessionPath(entry.dir), JSON.stringify(clean, null, 2));
      if ((entry.revision || 0) === rev) entry.dirty = false;
      await upsertIndexEntry({
        id: entry.data.id, title: entry.data.title || '未命名会话', dir: entry.dir,
        createdAt: entry.data.createdAt, updatedAt: entry.data.updatedAt,
        msgCount: Array.isArray(entry.data.messages) ? entry.data.messages.length : 0
      });
    });
    entry.chain = write.catch(function (error) { log('session flush failed: ' + error); });
    await write;
  }

  async function flushAll() {
    const ids = Array.from(cache.keys());
    for (const id of ids) {
      const entry = cache.get(id);
      if (entry && entry.timer) clearTimeout(entry.timer);
      try { await flush(id); } catch (error) { log('session flushAll failed: ' + error); }
    }
    try { await flushIndex(true); } catch (error) { log('index flushAll failed: ' + error); }
  }

  async function list() {
    const index = await readIndex();
    // 索引可能落后于磁盘（外部改动/上次写失败）：过滤已消失的目录。
    // 纯存在性检查互相独立，全量并发（结果按索引序落位）；几百个会话时
    // 串行 access 是会话面板打开的主要等待
    const checks = await Promise.all(index.sessions.map(async function (s) {
      try {
        await fs.access(path.join(rootDir, s.dir));
        return s;
      } catch (error) { return null; /* 目录没了，剔除 */ }
    }));
    const alive = checks.filter(function (s) { return s; });
    if (alive.length !== index.sessions.length) {
      writeIndex({ version: 1, sessions: alive });
      await flushIndex(true);
    }
    return alive;
  }

  /** 重命名 = 磁盘目录改名 + session.json/index 同步；稳定 ID 不变，关联不断 */
  async function rename(id, newTitle) {
    const entry = await loadEntry(id);
    if (!entry) throw new Error('会话不存在：' + id);
    await flush(id);
    const dateDir = entry.dir.split(path.sep)[0];
    const title = LitResearch.sessionTitleFrom(newTitle);
    const dirName = await freeDirName(dateDir, title);
    const oldDir = path.join(rootDir, entry.dir);
    const newDirRel = dateDir + path.sep + dirName;
    const newDir = path.join(rootDir, newDirRel);
    await fs.mkdir(path.dirname(newDir), { recursive: true });
    await fs.rename(oldDir, newDir);
    entry.dir = newDirRel;
    entry.data.title = title;
    entry.dirty = true;
    await flush(id);
    await flushIndex(true); // 改名：结构变更，立即写索引
    return { ok: true, dir: newDirRel, title: title };
  }

  /** 删除 = 进系统回收站（trashItem 由 main 注入；未注入时报不支持） */
  async function remove(id) {
    const entry = await loadEntry(id);
    if (!entry) throw new Error('会话不存在：' + id);
    await flush(id);
    if (typeof trashItem !== 'function') throw new Error('回收站不可用');
    await trashItem(path.join(rootDir, entry.dir));
    cache.delete(String(id));
    const index = await readIndex();
    writeIndex({ version: 1, sessions: index.sessions.filter(function (s) { return s.id !== String(id); }) });
    await flushIndex(true);
    return { ok: true };
  }

  /** 附件落盘：消毒文件名 + 碰撞后缀；返回相对路径（存进 session.json 的附件映射） */
  async function saveAttachment(id, input) {
    const entry = await loadEntry(id);
    if (!entry) throw new Error('会话不存在：' + id);
    const rawName = String(input && input.name || 'file');
    const ext = (path.extname(rawName).match(/\.[A-Za-z0-9]{1,10}/) || [''])[0];
    const stem = LitResearch.sanitizeFileStem(path.basename(rawName, ext), 60);
    const attDir = path.join(rootDir, entry.dir, '附件');
    const buffer = Buffer.from(String(input && input.dataBase64 || ''), 'base64');
    if (!buffer.length) throw new Error('附件内容为空');
    await fs.mkdir(attDir, { recursive: true });
    let target = path.join(attDir, stem + ext);
    let suffix = 1;
    while (true) {
      try {
        await fs.writeFile(target, buffer, { flag: 'wx' });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        suffix++;
        target = path.join(attDir, stem + ' ' + suffix + ext);
      }
    }
    const rel = '附件/' + path.basename(target);
    if (!Array.isArray(entry.data.attachments)) entry.data.attachments = [];
    entry.data.attachments.push({ file: rel, label: String(input && input.label || '') });
    entry.revision = (entry.revision || 0) + 1;
    entry.dirty = true;
    await flush(id);
    return { file: rel, path: target };
  }

  /** 会话内附件的绝对路径（PDF 第二步复制进受管目录用）；拒绝越出附件目录的相对路径 */
  async function attachmentPath(id, relFile) {
    const entry = await loadEntry(id);
    if (!entry) throw new Error('会话不存在：' + id);
    const rel = String(relFile || '').replace(/^附件[/\\]/, '');
    if (!rel || rel.indexOf('..') !== -1 || path.isAbsolute(rel)) throw new Error('无效的附件路径');
    return path.join(rootDir, entry.dir, '附件', rel);
  }

  /** 批量删除（多选场景）：逐个进回收站，返回成功/失败明细与刷新后的索引，
   * 单个失败不中断其余——调用方据 failed 如实提示，不静默吞掉。 */
  async function removeMany(ids) {
    const list = (Array.isArray(ids) ? ids : [])
      .filter(function (id) { return id != null && id !== ''; })
      .map(String)
      .slice(0, 200);
    const deleted = [];
    const failed = [];
    for (const id of list) {
      try {
        await remove(id);
        deleted.push(id);
      } catch (error) {
        failed.push({ id: id, error: String(error && error.message || error) });
      }
    }
    const index = await readIndex();
    return { deleted: deleted, failed: failed, sessions: index.sessions };
  }

  /** 导出/刷新 会话记录.md（生成物） */
  async function exportMarkdown(id) {
    const entry = await loadEntry(id);
    if (!entry) throw new Error('会话不存在：' + id);
    await flush(id);
    const md = LitResearch.renderSessionMarkdown(LitResearch.sanitizeSessionForDisk(entry.data));
    const file = path.join(rootDir, entry.dir, '会话记录.md');
    await atomicWrite(file, md);
    return { ok: true, path: file };
  }

  return {
    create: create,
    list: list,
    read: read,
    setData: setData,
    commit: commit,
    flush: flush,
    flushAll: flushAll,
    rename: rename,
    remove: remove,
    removeMany: removeMany,
    saveAttachment: saveAttachment,
    attachmentPath: attachmentPath,
    exportMarkdown: exportMarkdown,
    rebuildIndex: rebuildIndex
  };
}

module.exports = { createSessions: createSessions };
