'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSessions } = require('../electron/sessions.js');

async function makeSessions(trashed) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sessions-'));
  const trashedDirs = [];
  const s = createSessions({
    rootDir: path.join(root, '会话记录'),
    trashItem: async function (dir) { trashedDirs.push(dir); },
    flushDelayMs: 10
  });
  return { s, root, trashedDirs };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('create lays out dated folder, session.json and index entry', async function () {
  const { s, root } = await makeSessions();
  const created = await s.create({ title: '锂电池寿命预测 Review' });
  assert.match(created.dir, /^\d{8}\\锂电池寿命预测 Review 01$/);
  const sessionFile = path.join(root, '会话记录', created.dir, 'session.json');
  const data = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
  assert.equal(data.id, created.id);
  assert.equal(data.title, '锂电池寿命预测 Review');
  const list = await s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
});

test('collision numbering across same-title sessions', async function () {
  const { s } = await makeSessions();
  const a = await s.create({ title: '同名会话' });
  const b = await s.create({ title: '同名会话' });
  assert.notEqual(a.dir, b.dir);
  assert.ok(b.dir.indexOf('同名会话 02') !== -1);
});

test('setData debounced flush survives restart-by-cache-drop', async function () {
  const { s, root } = await makeSessions();
  const created = await s.create({ title: 't' });
  const data = await s.read(created.id);
  data.messages.push({ role: 'user', content: 'hello' });
  await s.setData(created.id, data);
  // 防抖落盘是异步的：全量测试并行跑时 10ms 定时器会被拖后，固定 sleep(60) 会偶发早于落盘。
  // 改为轮询等待（有上限），超时后再断言——失败时输出的仍是真实落盘状态。
  const sessionFile = path.join(root, '会话记录', created.dir, 'session.json');
  const deadline = Date.now() + 5000;
  let onDisk = null;
  let list = [];
  for (;;) {
    try { onDisk = JSON.parse(await fs.readFile(sessionFile, 'utf8')); } catch (error) { onDisk = null; }
    list = await s.list();
    if (onDisk && Array.isArray(onDisk.messages) && onDisk.messages.length === 1 &&
        list[0] && list[0].msgCount === 1) break;
    if (Date.now() > deadline) break;
    await sleep(20);
  }
  assert.ok(onDisk, 'session.json 应在防抖窗口后落盘');
  assert.equal(onDisk.messages.length, 1);
  assert.equal(list[0] && list[0].msgCount, 1);
});

test('rename moves folder, keeps stable id, updates index', async function () {
  const { s, root } = await makeSessions();
  const created = await s.create({ title: '旧标题' });
  await s.rename(created.id, '新标题');
  const list = await s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
  assert.equal(list[0].title, '新标题');
  assert.ok(list[0].dir.indexOf('新标题 01') !== -1);
  const data = await s.read(created.id);
  assert.equal(data.title, '新标题');
  // 旧目录不复存在
  await assert.rejects(() => fs.access(path.join(root, '会话记录', created.dir)));
});

test('remove sends folder to recycle bin and drops index entry', async function () {
  const { s, trashedDirs } = await makeSessions();
  const created = await s.create({ title: '要删的' });
  await s.remove(created.id);
  assert.equal(trashedDirs.length, 1);
  assert.equal((await s.list()).length, 0);
  assert.equal(await s.read(created.id), null);
});

test('attachments sanitize names, dedupe, and register in session data', async function () {
  const { s } = await makeSessions();
  const created = await s.create({ title: 't' });
  const r1 = await s.saveAttachment(created.id, { name: '报告<1>.pdf', label: 'x', dataBase64: Buffer.from('abc').toString('base64') });
  const r2 = await s.saveAttachment(created.id, { name: '报告<1>.pdf', dataBase64: Buffer.from('def').toString('base64') });
  assert.equal(r1.file, '附件/报告 1.pdf');
  assert.ok(r2.file.indexOf(' 2.pdf') !== -1);
  const data = await s.read(created.id);
  assert.equal(data.attachments.length, 2);
  assert.equal(data.attachments[0].label, 'x');
});

test('exportMarkdown writes readable transcript next to session.json', async function () {
  const { s } = await makeSessions();
  const created = await s.create({ title: '调研' });
  const data = await s.read(created.id);
  data.messages.push({ role: 'user', content: '找文献' });
  data.messages.push({ role: 'assistant', content: '好的', toolCalls: [{ name: 'search_openalex', status: 'ok', summary: 'q=电池' }] });
  await s.setData(created.id, data);
  await sleep(60);
  const r = await s.exportMarkdown(created.id);
  const md = await fs.readFile(r.path, 'utf8');
  assert.ok(md.indexOf('# 调研') !== -1);
  assert.ok(md.indexOf('找文献') !== -1);
  assert.ok(md.indexOf('openalex') !== -1);
});

test('index corruption triggers rescan and recovery', async function () {
  const { s, root } = await makeSessions();
  const a = await s.create({ title: 'A' });
  const b = await s.create({ title: 'B' });
  await fs.writeFile(path.join(root, '会话记录', 'index.json'), 'not json', 'utf8');
  const list = await s.list();
  assert.equal(list.length, 2);
  const ids = list.map((x) => x.id).sort();
  assert.deepEqual(ids, [a.id, b.id].sort());
  // 读会话仍能命中磁盘
  const data = await s.read(a.id);
  assert.equal(data.id, a.id);
});

test('removeMany trashes each session, reports failures without aborting the rest', async function () {
  const { s, trashedDirs } = await makeSessions();
  const a = await s.create({ title: 'A' });
  const b = await s.create({ title: 'B' });
  const c = await s.create({ title: 'C' });
  const result = await s.removeMany([a.id, 'nonexistent-id', b.id]);
  assert.deepEqual(result.deleted, [a.id, b.id]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].id, 'nonexistent-id');
  assert.equal(trashedDirs.length, 2);          // 两个成功项都进了回收站
  assert.deepEqual(result.sessions.map((x) => x.id), [c.id]); // 返回刷新后的索引
  assert.equal((await s.list()).length, 1);
});

test('removeMany caps batch size and tolerates empty input', async function () {
  const { s } = await makeSessions();
  assert.deepEqual((await s.removeMany([])).deleted, []);
  assert.deepEqual((await s.removeMany(null)).deleted, []);
  const created = await s.create({ title: 'X' });
  const result = await s.removeMany([created.id, '', null]);
  assert.deepEqual(result.deleted, [created.id]);
  assert.deepEqual(result.failed, []);
});

test('index.json writes are debounced for message flushes but forced on structural changes', async function () {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-sessions-idx-'));
  const sessionRoot = path.join(root, '会话记录');
  const s = createSessions({
    rootDir: sessionRoot,
    trashItem: async function () {},
    flushDelayMs: 5,
    indexWriteDelayMs: 400   // 拉长防抖窗口，便于确定性观察
  });
  const created = await s.create({ title: 'idx' });
  const idxPath = path.join(sessionRoot, 'index.json');
  // 新建属于结构变更：索引已立即落盘
  assert.equal(JSON.parse(await fs.readFile(idxPath, 'utf8')).sessions.length, 1);

  // 写消息：session.json 落盘，但索引只标脏、不立即重写
  const data = await s.read(created.id);
  data.messages.push({ role: 'user', content: 'hi' });
  await s.setData(created.id, data);
  await sleep(30);                       // > flushDelay(5ms)，< indexWriteDelay(400ms)
  assert.equal(JSON.parse(await fs.readFile(idxPath, 'utf8')).sessions.length, 1);
  const stale = JSON.parse(await fs.readFile(idxPath, 'utf8'));
  stale.sessions = [];
  await fs.writeFile(idxPath, JSON.stringify(stale), 'utf8');   // 人为置旧
  await sleep(30);
  assert.equal(JSON.parse(await fs.readFile(idxPath, 'utf8')).sessions.length, 0,
    '防抖窗口内不应重写索引');

  // 防抖到期后自动补写（自愈）
  await sleep(450);
  assert.equal(JSON.parse(await fs.readFile(idxPath, 'utf8')).sessions.length, 1);

  // 改名属结构变更：立即写
  await s.rename(created.id, '改名后');
  assert.equal(JSON.parse(await fs.readFile(idxPath, 'utf8')).sessions[0].title, '改名后');
});

test('R04: commit 立即写盘并等待完成（不等防抖），链住未落盘的防抖修改', async function () {
  const { s, root } = await makeSessions();
  const created = await s.create({ title: 't' });
  // 先走防抖路径写入第一条（模拟流式中的普通 persist）
  const data = await s.read(created.id);
  data.messages.push({ role: 'user', content: 'first' });
  await s.setData(created.id, data);
  // 立即 checkpoint：防抖 timer 被清，最新数据（含第一条）直接落盘
  const data2 = await s.read(created.id);
  data2.messages.push({ role: 'user', content: 'second' });
  const r = await s.commit(created.id, data2);
  assert.equal(r.ok, true);
  const onDisk = JSON.parse(await fs.readFile(
    path.join(root, '会话记录', created.dir, 'session.json'), 'utf8'));
  assert.deepEqual(onDisk.messages.map((m) => m.content), ['first', 'second'],
    'commit 返回时磁盘必须已有全部已提交内容');
});

test('R05: 渲染层旧快照不覆盖主进程登记的附件；commit 回传当前登记', async function () {
  const { s } = await makeSessions();
  const created = await s.create({ title: 't' });
  await s.saveAttachment(created.id, { name: 'a.pdf', label: 'L', dataBase64: Buffer.from('x').toString('base64') });
  // 模拟渲染层 IPC 深拷贝提交：本地 doc 的 attachments 还是旧的空数组
  const stale = await s.read(created.id);
  stale.attachments = [];
  stale.messages.push({ role: 'user', content: 'hi' });
  const r = await s.commit(created.id, JSON.parse(JSON.stringify(stale)));
  assert.equal(r.attachments.length, 1, '主进程登记的附件必须保留并回传');
  assert.equal(r.attachments[0].label, 'L');
  const after = await s.read(created.id);
  assert.equal(after.attachments.length, 1);
  assert.equal(after.messages.length, 1);
  // flushAll（退出路径）后仍在
  await s.flushAll();
  const final = await s.read(created.id);
  assert.equal(final.attachments.length, 1);
});
