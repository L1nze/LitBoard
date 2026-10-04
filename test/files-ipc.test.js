'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function handlersWith(overrides) {
  const filename = path.join(__dirname, '../electron/ipc/files.js');
  const realRequire = createRequire(filename);
  const handlers = {};
  const context = {
    module: { exports: {} }, Buffer, TextDecoder, process,
    require(request) {
      if (request === 'electron') return {};
      if (request === './context.js') return {
        T: text => text, handle: (channel, handler) => { handlers[channel] = handler; }
      };
      if (request === 'node:fs/promises') return Object.assign({}, fs, overrides);
      if (request === '../integrations.js') return {};
      return realRequire(request);
    }
  };
  vm.runInNewContext(fsSync.readFileSync(filename, 'utf8'), context, { filename });
  context.module.exports.register();
  return handlers;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-files-ipc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'paper.pdf');
  await fs.writeFile(source, '%PDF-original');
  return { root, source };
}

test('PDF 写回替换失败时原件仍可读取，首次备份保持不变', async t => {
  const { root, source } = await fixture(t);
  const handlers = handlersWith({
    rename: async () => { throw Object.assign(new Error('file locked'), { code: 'EPERM' }); }
  });
  const result = await handlers['files:write-pdf'](null, { path: source, bytes: Buffer.from('%PDF-new') });
  assert.match(result.error, /file locked/);
  assert.equal(await fs.readFile(source, 'utf8'), '%PDF-original');
  assert.equal(await fs.readFile(source + '.litbak', 'utf8'), '%PDF-original');
  assert.deepEqual((await fs.readdir(root)).sort(), ['paper.pdf', 'paper.pdf.litbak']);
});

test('并发 PDF 写回互不覆盖临时文件，首次备份只保存原件', async t => {
  const { root, source } = await fixture(t);
  const writes = [];
  const handlers = handlersWith({
    async writeFile(target, bytes, options) {
      writes.push(target);
      return fs.writeFile(target, bytes, options);
    }
  });
  const results = await Promise.all([
    handlers['files:write-pdf'](null, { path: source, bytes: Buffer.from('%PDF-first') }),
    handlers['files:write-pdf'](null, { path: source, bytes: Buffer.from('%PDF-second') })
  ]);
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(new Set(writes).size, 2, '每次写回必须独占自己的临时文件');
  assert.equal(await fs.readFile(source + '.litbak', 'utf8'), '%PDF-original');
  assert.equal(await fs.readFile(source, 'utf8'), '%PDF-second', '后发起的写入应最后落盘');
  assert.deepEqual((await fs.readdir(root)).sort(), ['paper.pdf', 'paper.pdf.litbak']);
});

test('并发导出同名 PDF 不覆盖文件，冲突时自动添加后缀', async t => {
  const { root, source } = await fixture(t);
  const second = path.join(root, 'second.pdf');
  const dir = path.join(root, 'exports');
  await fs.writeFile(second, '%PDF-second');
  await fs.mkdir(dir);
  let ready;
  const bothCopying = new Promise(resolve => { ready = resolve; });
  let copies = 0;
  const handlers = handlersWith({
    async copyFile(from, to, flags) {
      if (to === path.join(dir, 'same.pdf')) {
        copies++;
        if (copies === 2) ready();
        await bothCopying;
      }
      return fs.copyFile(from, to, flags);
    }
  });
  const results = await Promise.all([source, second].map(file =>
    handlers['files:export-pdfs'](null, { dir, files: [{ path: file, name: 'same.pdf' }] })));
  assert.ok(results.every(result => result.failed.length === 0));
  assert.deepEqual((await fs.readdir(dir)).sort(), ['same-2.pdf', 'same.pdf']);
  const contents = await Promise.all((await fs.readdir(dir)).map(name => fs.readFile(path.join(dir, name), 'utf8')));
  assert.deepEqual(contents.sort(), ['%PDF-original', '%PDF-second']);
});

test('PDF 导出拒绝带路径的文件名，不写入所选目录之外', async t => {
  const { root, source } = await fixture(t);
  const dir = path.join(root, 'exports');
  const handlers = handlersWith();
  for (const name of ['../escaped', '..\\escaped', 'folder/file', 'file:stream']) {
    const result = await handlers['files:export-pdfs'](null, { dir, files: [{ path: source, name }] });
    assert.equal(result.copied.length, 0, name);
    assert.equal(result.failed.length, 1, name);
  }
  assert.equal(fsSync.existsSync(path.join(root, 'escaped.pdf')), false);
  assert.deepEqual(await fs.readdir(dir), []);
});
