'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function fixture(fetch) {
  const handlers = new Map(), writes = [];
  const operationsModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/agent-operations.js'), 'utf8'), { module: operationsModule, AbortController, Map, Set, Promise, Error });
  const operations = operationsModule.exports;
  const works = Array.from({ length: 5 }, (_, i) => ({ id: 'W' + i, title: 'Paper ' + i, oaUrl: 'https://publisher.example/' + i + '.pdf' }));
  const context = {
    handle: (name, handler) => handlers.set(name, handler), T: (s) => s,
    researchDb: { getWorks: () => works },
    agentSessions: { saveAttachment: async () => { writes.push('attachment'); return { file: '附件/a.pdf' }; } },
    libraryDb: { getSetting: () => true, getPaper: async () => ({ id: 'paper' }), pdfTextPut: async () => { writes.push('index'); } },
    dataPathState: { configDir: 'isolated-fixture' }
  };
  const fakeFs = { mkdir: async () => { writes.push('mkdir'); }, writeFile: async () => { writes.push('file'); } };
  const ipcModule = { exports: {} };
  const requireStub = (name) => {
    if (name === './context.js') return context;
    if (name === '../agent-operations.js') return operations;
    if (name === '../safe-fetch.js') return { createSafePublicHttpsFetch: () => fetch };
    if (name === '../../js/research.js') return { sanitizeFileStem: (s) => s };
    if (name === '../item-storage.js') return { itemAttachmentDir: () => 'isolated-fixture/attachments' };
    if (name === '../../js/markdown.js') return { render: (s) => s };
    if (name === 'node:fs/promises') return fakeFs;
    if (name.startsWith('node:')) return require(name);
    return {};
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/ipc/research.js'), 'utf8'), {
    module: ipcModule, require: requireStub, Buffer, Promise, Map, Set, Error, AbortController, console
  });
  ipcModule.exports.register();
  return { handlers, writes, operations, context };
}

test('real download handler aborts all four in-flight fetches and never dispatches fifth or saves attachments', async () => {
  const ready = deferred(), signals = [];
  let aborts = 0;
  const f = fixture((_url, options) => new Promise((_resolve, reject) => {
    signals.push(options.signal);
    options.signal.addEventListener('abort', () => { aborts++; reject(new Error('aborted')); }, { once: true });
    if (signals.length === 4) ready.resolve();
  }));
  const promise = f.handlers.get('research:download-pdfs')(null, { sessionId: 'session', turnId: 'turn', workIds: ['W0', 'W1', 'W2', 'W3', 'W4'] });
  await ready.promise;
  f.operations.cancel('session', 'turn');
  const result = await promise;
  assert.equal(aborts, 4);
  assert.equal(signals.length, 4);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(result.stopped, true);
  assert.equal(result.results.length, 5);
  assert.match(result.results[4].error, /未下载/);
  assert.equal(f.writes.length, 0);
});

test('cancellation across response arrayBuffer await prevents the attachment save chain from starting', async () => {
  const ready = deferred(), bodies = deferred();
  let fetches = 0, reading = 0;
  const bytes = Buffer.alloc(1001, 0x25);
  const f = fixture(async () => {
    fetches++;
    return { ok: true, arrayBuffer: async () => { reading++; if (reading === 4) ready.resolve(); return bodies.promise; } };
  });
  const promise = f.handlers.get('research:download-pdfs')(null, { sessionId: 'session', turnId: 'turn', workIds: ['W0', 'W1', 'W2', 'W3', 'W4'] });
  await ready.promise;
  f.operations.cancel('session', 'turn');
  bodies.resolve(bytes);
  const result = await promise;
  assert.equal(fetches, 4);
  assert.equal(result.stopped, true);
  assert.equal(f.writes.length, 0);
});

test('real fetch-page handler forwards abort signal and avoids snapshots and fulltext index writes after network cancellation', async () => {
  const ready = deferred();
  let aborted = false;
  const f = fixture(async () => { throw new Error('unexpected PDF request'); });
  f.context.webFetchNet = {
    fetchPage: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
      ready.resolve();
    })
  };
  const promise = f.handlers.get('research:fetch-page')(null, {
    sessionId: 'session', turnId: 'turn', paperId: 'paper', url: 'https://publisher.example/paper', offset: 0
  });
  const rejected = assert.rejects(promise, /aborted/);
  await ready.promise;
  f.operations.cancel('session', 'turn');
  await rejected;
  assert.equal(aborted, true);
  assert.deepEqual(f.writes, []);
});
