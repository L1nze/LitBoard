'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createSessions } = require('../electron/sessions.js');
const { createReferences } = require('../electron/agent-reference.js');

test('reference import copies only selected supported files and reads registered windows after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-reference-'));
  let sessions = createSessions({ rootDir: path.join(root, 'sessions') });
  const refs = createReferences(() => sessions);
  try {
    const session = await sessions.create({ title: 'reference test' });
    const text = path.join(root, 'reference.md'), zip = path.join(root, 'archive.zip');
    await fs.writeFile(text, '内容\n'.repeat(4000));
    await fs.writeFile(zip, 'unsupported');
    const result = await refs.importFiles(session.id, [text, zip]);
    assert.equal(result.imported.length, 1);
    assert.equal(result.failed.length, 1);
    await fs.writeFile(text, 'original changed');
    const first = await refs.readFile(session.id, result.imported[0].file, 0);
    assert.match(first.text, /内容/);
    assert.equal(first.nextOffset, 6000);
    assert.equal(first.totalChars, 12000);
    const listing = await refs.listFiles(session.id);
    assert.equal(listing.files[0].file, result.imported[0].file);
    assert.equal(listing.files[0].name, 'reference.md');
    assert.equal(listing.files[0].kind, 'text');
    const search = await refs.searchFile(session.id, result.imported[0].file, '内容', { limit: 2, context: 0 });
    assert.equal(search.status, 'ready');
    assert.equal(search.matches.length, 2);
    assert.equal(search.matches[0].matchOffset, 0);
    assert.equal(search.nextOffset, 6);
    await assert.rejects(() => refs.searchFile(session.id, '附件/unregistered.txt', '内容'), /not registered/);
    await assert.rejects(() => refs.readFile(session.id, '附件/unregistered.txt', 0), /not registered/);
    await assert.rejects(() => refs.readFile(session.id, '../outside.txt', 0), /Invalid/);
    await sessions.flushAll();
    sessions = createSessions({ rootDir: path.join(root, 'sessions') });
    const next = await refs.readFile(session.id, result.imported[0].file, first.nextOffset);
    assert.equal(next.offset, 6000);
    assert.equal(next.nextOffset, null);
    assert.equal(next.text, first.text);
    const attachment = await sessions.attachmentPath(session.id, result.imported[0].file);
    await fs.rm(attachment);
    await assert.rejects(() => refs.readFile(session.id, result.imported[0].file, 0), /ENOENT/);
  } finally { await sessions.flushAll(); await fs.rm(root, { recursive: true, force: true }); }
});

test('reference imports enforce 10-file and image-byte limits with explicit failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-reference-limits-'));
  const sessions = createSessions({ rootDir: path.join(root, 'sessions') }), refs = createReferences(() => sessions);
  try {
    const session = await sessions.create({ title: 'limits' });
    await assert.rejects(() => refs.importFiles(session.id, Array(11).fill('x')), /10/);
    const image = path.join(root, 'large.png');
    await fs.writeFile(image, Buffer.alloc(8 * 1024 * 1024 + 1));
    const result = await refs.importFiles(session.id, [image]);
    assert.equal(result.imported.length, 0);
    assert.match(result.failed[0].error, /8 MiB/);
    assert.equal((await sessions.read(session.id)).attachments.length, 0);
  } finally { await sessions.flushAll(); await fs.rm(root, { recursive: true, force: true }); }
});
