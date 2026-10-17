'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Core = require('../js/agentcore.js');
const Loop = require('../js/agentloop.js');
const { createSessionStore } = require('../js/agentsessions.js');
const { createSessions } = require('../electron/sessions.js');

/* persistRun 已拆至 js/agentsessions.js（2026-10）：直接用真 store，不再切片 agentui 源码 */
async function persistenceUi(desk) {
  return createSessionStore({
    desk, T: s => s, $: () => null, el: () => ({ appendChild() {} }), deps: {}, core: Core,
    runner: () => null, isUploadBusy: () => false, isCompactBusy: () => false,
    setStatus() {}, renderAttachments() {}, renderChips() {}, renderMode() {}, bump() {},
    toastText() {}, toastError() {}
  });
}

test('first-turn checkpoint waits for the automatic session directory rename even under cache pressure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-checkpoint-'));
  const sessions = createSessions({ rootDir: root, cacheLimit: 1 });
  const created = await sessions.create({ title: '新会话' });
  const run = { id: created.id, doc: structuredClone(created.data), core: Core.initState() };
  Core.appendUser(run.core, '调研一下锂电池超声/导波状态监测的研究现状');
  let chatCalls = 0;
  const ui = await persistenceUi({ sessionCommit: (id, data) => sessions.commit(id, structuredClone(data)) });
  const runner = Loop.createRunner({ core: Core, persist: r => ui.persistRun(r, true),
    buildBody: () => ({}), chat: async () => { chatCalls++; return { message: { content: '完成' } }; } });

  let entered, release, moved;
  const renameEntered = new Promise(resolve => { entered = resolve; });
  const renameRelease = new Promise(resolve => { release = resolve; });
  const renameMoved = new Promise(resolve => { moved = resolve; });
  const realRename = fs.rename, realWrite = fs.writeFile;
  const oldDir = path.join(root, created.dir);
  let moving = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from !== oldDir) return realRename(from, to);
    moving = true;
    entered();
    await renameRelease;
    try { return await realRename(from, to); }
    finally { moving = false; moved(); }
  });
  // Slow disk schedule: a checkpoint targeting the old directory reaches its write
  // just after the directory has moved. No filesystem error is fabricated.
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    if (moving && path.dirname(file) === oldDir) await renameMoved;
    return realWrite(file, ...args);
  });
  let renaming, turning;
  try {
    renaming = sessions.rename(run.id, '锂电池超声调研');
    await renameEntered;
    const other = await sessions.create({ title: 'another session' });
    const otherDoc = structuredClone(other.data);
    otherDoc.messages = [{ role: 'user', content: 'must survive cache pressure' }];
    await sessions.commit(other.id, otherDoc);
    const otherDisk = JSON.parse(await fs.readFile(path.join(root, other.dir, 'session.json'), 'utf8'));
    assert.equal(otherDisk.messages[0] && otherDisk.messages[0].content, 'must survive cache pressure');
    turning = runner.runTurn(run);
    await new Promise(resolve => setTimeout(resolve, 40));
    release();
    const renamed = await renaming;
    assert.equal(await turning, 'done', JSON.stringify(run.core.messages.filter(m => m.role === 'error')));
    assert.equal(chatCalls, 1);
    const disk = JSON.parse(await fs.readFile(path.join(root, renamed.dir, 'session.json'), 'utf8'));
    assert.deepEqual(disk.messages.map(m => m.content), [run.core.messages[0].content, '完成']);
    assert.equal(disk.streaming, false);
    await assert.rejects(fs.access(oldDir), { code: 'ENOENT' });
  } finally {
    release();
    await Promise.allSettled([renaming, turning]);
    t.mock.restoreAll();
    await sessions.flushAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('checkpoint disk errors retain the underlying reason and stop before model calls', async () => {
  const ui = await persistenceUi({ sessionCommit: async () => { throw new Error('ENOSPC: no space left on device'); } });
  const run = { id: 's', doc: {}, core: Core.initState() };
  Core.appendUser(run.core, 'hello');
  let calls = 0;
  const runner = Loop.createRunner({ core: Core, persist: r => ui.persistRun(r, true),
    buildBody: () => ({}), chat: async () => { calls++; return {}; } });
  assert.equal(await runner.runTurn(run), 'failed');
  assert.equal(calls, 0);
  assert.ok(run.core.messages.some(m => m.role === 'error' && /ENOSPC/.test(m.content)),
    JSON.stringify(run.core.messages));
});

test('rename waits for an in-flight checkpoint; failed rename does not poison later commits', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-checkpoint-order-'));
  const sessions = createSessions({ rootDir: root });
  const created = await sessions.create({ title: 'original' });
  const doc = structuredClone(created.data);
  doc.messages = [{ role: 'user', content: 'saved before rename' }];
  let entered, release;
  const writing = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const realWrite = fs.writeFile, realRename = fs.rename;
  let paused = false;
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    if (!paused && path.basename(file).startsWith('session.json.tmp-')) {
      paused = true;
      entered();
      await gate;
    }
    return realWrite(file, ...args);
  });
  let commit, rename;
  try {
    commit = sessions.commit(created.id, doc);
    await writing;
    rename = sessions.rename(created.id, 'renamed');
    release();
    await commit;
    const result = await rename;
    const file = path.join(root, result.dir, 'session.json');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).messages[0].content, 'saved before rename');
    t.mock.method(fs, 'rename', async (from, to) => {
      if (from === path.join(root, result.dir)) throw Object.assign(new Error('EPERM: directory locked'), { code: 'EPERM' });
      return realRename(from, to);
    });
    await assert.rejects(sessions.rename(created.id, 'locked'), { code: 'EPERM' });
    const next = await sessions.read(created.id);
    next.messages.push({ role: 'assistant', content: 'saved after failed rename' });
    await sessions.commit(created.id, next);
    const disk = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(disk.title, 'renamed');
    assert.equal(disk.messages[1].content, 'saved after failed rename');
  } finally {
    release();
    await Promise.allSettled([commit, rename]);
    t.mock.restoreAll();
    await sessions.flushAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('successful checkpoint clears the previous persistence error without changing the null failure contract', async () => {
  let fail = true;
  const ui = await persistenceUi({ sessionCommit: async () => {
    if (fail) throw new Error('EACCES: permission denied');
    return { ok: true };
  } });
  const run = { id: 's', doc: {}, core: Core.initState() };
  assert.equal(await ui.persistRun(run, true), null);
  assert.match(run.persistenceError.message, /EACCES/);
  assert.equal(ui.persistWarned.s, true);
  fail = false;
  assert.equal((await ui.persistRun(run, true)).ok, true);
  assert.equal(run.persistenceError, null);
  assert.equal(ui.persistWarned.s, undefined);
});

test('concurrent same-title sessions have independent directories and survive index reload', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-session-create-'));
  const sessions = createSessions({ rootDir: root });
  try {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => sessions.create({ title: '新会话' })));
    assert.equal(results.filter(r => r.status === 'rejected').length, 0, JSON.stringify(results));
    const created = results.map(r => r.value);
    assert.equal(new Set(created.map(s => s.dir)).size, 5);
    await sessions.flushAll();
    const restarted = createSessions({ rootDir: root });
    assert.equal((await restarted.list()).length, 5);
    for (const session of created) assert.equal((await restarted.read(session.id)).id, session.id);
    await restarted.flushAll();
  } finally {
    await sessions.flushAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('concurrent cold loads share one session entry and retain both attachment registrations', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-session-load-'));
  const sessions = createSessions({ rootDir: root });
  const created = await sessions.create({ title: 'cold' });
  const restarted = createSessions({ rootDir: root });
  const realRead = fs.readFile;
  let reads = 0;
  t.mock.method(fs, 'readFile', async (file, ...args) => {
    const result = await realRead(file, ...args);
    if (file === path.join(root, created.dir, 'session.json')) {
      reads++;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return result;
  });
  try {
    const saved = await Promise.all(['a', 'b'].map(name => restarted.saveAttachment(created.id, {
      name: name + '.txt', dataBase64: Buffer.from(name).toString('base64')
    })));
    assert.equal(reads, 1, 'cold IPC requests must not create independent write queues');
    const doc = await restarted.read(created.id);
    assert.deepEqual(doc.attachments.map(a => a.file).sort(), saved.map(a => a.file).sort());
    const disk = JSON.parse(await realRead(path.join(root, created.dir, 'session.json'), 'utf8'));
    assert.equal(disk.attachments.length, 2);
  } finally {
    t.mock.restoreAll();
    await restarted.flushAll();
    await sessions.flushAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('attachment saves use the renamed directory instead of writing to a stale path', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-session-attachment-'));
  const sessions = createSessions({ rootDir: root });
  const created = await sessions.create({ title: 'original' });
  const oldDir = path.join(root, created.dir);
  let entered, release, moved, moving = false;
  const enteredGate = new Promise(resolve => { entered = resolve; });
  const releaseGate = new Promise(resolve => { release = resolve; });
  const movedGate = new Promise(resolve => { moved = resolve; });
  const realRename = fs.rename, realWrite = fs.writeFile;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from !== oldDir) return realRename(from, to);
    moving = true; entered(); await releaseGate;
    try { return await realRename(from, to); }
    finally { moving = false; moved(); }
  });
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    if (moving && path.dirname(file) === path.join(oldDir, '附件')) await movedGate;
    return realWrite(file, ...args);
  });
  let renaming, saving;
  try {
    renaming = sessions.rename(created.id, 'renamed');
    await enteredGate;
    saving = sessions.saveAttachment(created.id, { name: 'reference.txt', dataBase64: Buffer.from('reference').toString('base64') });
    await new Promise(resolve => setTimeout(resolve, 40));
    release();
    await renaming;
    const result = await saving;
    assert.equal(await fs.readFile(await sessions.attachmentPath(created.id, result.file), 'utf8'), 'reference');
    assert.equal((await sessions.read(created.id)).attachments.length, 1);
    await assert.rejects(fs.access(oldDir), { code: 'ENOENT' });
  } finally {
    release();
    await Promise.allSettled([renaming, saving]);
    t.mock.restoreAll();
    await sessions.flushAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('finishing an initial index rebuild cannot overwrite sessions registered while it was writing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-index-rebuild-'));
  const sessions = createSessions({ rootDir: root });
  let entered, release, paused = false;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const realWrite = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    if (!paused && path.basename(file).startsWith('index.json.tmp-')) {
      paused = true; entered(); await gate;
    }
    return realWrite(file, ...args);
  });
  let initializing, creating;
  try {
    initializing = sessions.list();
    await started;
    creating = Promise.all([sessions.create({ title: 'A' }), sessions.create({ title: 'B' })]);
    const deadline = Date.now() + 5000;
    while ((await sessions.list()).length < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal((await sessions.list()).length, 2);
    release();
    await Promise.all([initializing, creating]);
    await sessions.flushAll();
    const restarted = createSessions({ rootDir: root });
    assert.equal((await restarted.list()).length, 2);
    await restarted.flushAll();
  } finally {
    release();
    await Promise.allSettled([initializing, creating]);
    t.mock.restoreAll();
    await sessions.flushAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});
