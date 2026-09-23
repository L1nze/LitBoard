'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { releaseFiles } = require('../scripts/release-checksums.js');

test('releaseFiles only selects current installers and extension', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'litboard-release-'));
  fs.writeFileSync(path.join(dir, 'LitBoard-Setup-1.2.14-x64.exe'), 'setup');
  fs.writeFileSync(path.join(dir, 'LitBoard-Portable-1.2.14-x64.exe'), 'portable');
  fs.writeFileSync(path.join(dir, 'LitBoard-Setup-1.2.13-x64.exe'), 'old');
  fs.writeFileSync(path.join(dir, 'LitBoard-Portable-1.2.13-x64.exe.blockmap'), 'old');
  fs.writeFileSync(path.join(dir, 'LitBoard-Extension-1.2.14.zip'), 'extension');
  fs.writeFileSync(path.join(dir, 'LitBoard-Extension-1.2.13.zip'), 'old extension');

  assert.deepEqual(releaseFiles(dir, '1.2.14'), [
    'LitBoard-Setup-1.2.14-x64.exe',
    'LitBoard-Portable-1.2.14-x64.exe',
    'LitBoard-Extension-1.2.14.zip'
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('releaseFiles fails when a current installer is missing', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'litboard-release-'));
  fs.writeFileSync(path.join(dir, 'LitBoard-Setup-1.2.14-x64.exe'), 'setup');
  assert.throws(() => releaseFiles(dir, '1.2.14'), /缺少当前版本安装包/);
  fs.rmSync(dir, { recursive: true, force: true });
});
