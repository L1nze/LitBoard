'use strict';
/* 快照目录入口解析（F12 回归） */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveSnapshotEntry } = require('../electron/integrations.js');

test('resolveSnapshotEntry：目录 → index.html 优先，其次首个 .html，文件原样返回', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lb-snap-'));
  // 纯文件
  const file = path.join(dir, 'page.html');
  await fs.writeFile(file, '<html></html>');
  assert.equal(await resolveSnapshotEntry(file), file);
  // 目录：无 index → 首个 .html
  const snap1 = path.join(dir, 'snap1');
  await fs.mkdir(snap1);
  await fs.writeFile(path.join(snap1, 'a.html'), '<html>a</html>');
  assert.equal(await resolveSnapshotEntry(snap1), path.join(snap1, 'a.html'));
  // 目录：index.html 优先
  const snap2 = path.join(dir, 'snap2');
  await fs.mkdir(snap2);
  await fs.writeFile(path.join(snap2, 'zzz.html'), '<html>z</html>');
  await fs.writeFile(path.join(snap2, 'index.html'), '<html>main</html>');
  assert.equal(await resolveSnapshotEntry(snap2), path.join(snap2, 'index.html'));
  // 空目录 → 明确错误
  const snap3 = path.join(dir, 'snap3');
  await fs.mkdir(snap3);
  await assert.rejects(resolveSnapshotEntry(snap3), /没有可读的 HTML/);
  await fs.rm(dir, { recursive: true, force: true });
});
