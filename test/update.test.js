'use strict';

/* js/update.js 纯函数：Release 判定、SHA256SUMS 解析、缓存清扫计划 */

const test = require('node:test');
const assert = require('node:assert/strict');
const LitUpdate = require('../js/update.js');

function fakeRelease(over) {
  return Object.assign({
    tag_name: 'v1.0.1',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'LitBoard-Setup-1.0.1-x64.exe', state: 'uploaded',
        browser_download_url: 'https://github.com/L1nze/LitBoard/releases/download/v1.0.1/LitBoard-Setup-1.0.1-x64.exe' },
      { name: 'LitBoard-Portable-1.0.1-x64.exe', state: 'uploaded',
        browser_download_url: 'https://github.com/L1nze/LitBoard/releases/download/v1.0.1/LitBoard-Portable-1.0.1-x64.exe' }
    ]
  }, over || {});
}

test('newer：三段版本严格更大才算新', function () {
  assert.equal(LitUpdate.newer('v1.0.1', '1.0.0'), true);
  assert.equal(LitUpdate.newer('1.0.0', '1.0.0'), false);   // 相等不算新（装完即清扫的依据）
  assert.equal(LitUpdate.newer('1.0.0', '1.0.1'), false);
  assert.equal(LitUpdate.newer('v2.0.0', '1.9.9'), true);
  assert.equal(LitUpdate.newer('abc', '1.0.0'), false);
  assert.equal(LitUpdate.newer('1.0', '1.0.0'), false);     // 非三段直接拒绝
});

test('releaseInfo：发布态 + 严格更新 + 资产名/直链匹配才返回；附带 tagName 与 fileName', function () {
  const info = LitUpdate.releaseInfo(fakeRelease(), '1.0.0', false);
  assert.equal(info.version, '1.0.1');
  assert.equal(info.tagName, 'v1.0.1');
  assert.equal(info.fileName, 'LitBoard-Setup-1.0.1-x64.exe');
  const portable = LitUpdate.releaseInfo(fakeRelease(), '1.0.0', true);
  assert.equal(portable.fileName, 'LitBoard-Portable-1.0.1-x64.exe');
  // draft / prerelease / 同版本 / 无 Release 一律 null
  assert.equal(LitUpdate.releaseInfo(fakeRelease({ draft: true }), '1.0.0', false), null);
  assert.equal(LitUpdate.releaseInfo(fakeRelease({ prerelease: true }), '1.0.0', false), null);
  assert.equal(LitUpdate.releaseInfo(fakeRelease(), '1.0.1', false), null);
  assert.equal(LitUpdate.releaseInfo(null, '1.0.0', false), null);
  // 资产名或直链被篡改（第三方镜像/伪造）不匹配
  const wrongHost = fakeRelease();
  wrongHost.assets[0] = Object.assign({}, wrongHost.assets[0], {
    browser_download_url: 'https://evil.example.com/LitBoard-Setup-1.0.1-x64.exe'
  });
  assert.equal(LitUpdate.releaseInfo(wrongHost, '1.0.0', false), null);
  const stillUploading = fakeRelease();
  stillUploading.assets[0] = Object.assign({}, stillUploading.assets[0], { state: 'starter' });
  assert.equal(LitUpdate.releaseInfo(stillUploading, '1.0.0', false), null);
});

test('sumsUrl：指向同 Release 的 SHA256SUMS.txt', function () {
  assert.equal(LitUpdate.sumsUrl('v1.0.1'),
    'https://github.com/L1nze/LitBoard/releases/download/v1.0.1/SHA256SUMS.txt');
});

test('parseSha256Sums：解析校验文件，注释与空行跳过，哈希统一小写', function () {
  const text = [
    '# LitBoard 1.0.1 — SHA-256 校验和',
    '',
    '57CDA0D57A6B1E9B1C3CB02255780A357AF18E0EA43B9A8DE0B22634576266C5  LitBoard-Setup-1.0.1-x64.exe',
    '64751f9c698dd9fc62487c590dd892d806d7408a2286cecbdb49e717a9a62e1c  LitBoard-Portable-1.0.1-x64.exe'
  ].join('\n');
  const map = LitUpdate.parseSha256Sums(text);
  assert.equal(map['LitBoard-Setup-1.0.1-x64.exe'],
    '57cda0d57a6b1e9b1c3cb02255780a357af18e0ea43b9a8de0b22634576266c5');
  assert.equal(map['LitBoard-Portable-1.0.1-x64.exe'],
    '64751f9c698dd9fc62487c590dd892d806d7408a2286cecbdb49e717a9a62e1c');
  assert.equal(Object.keys(map).length, 2);
  assert.deepEqual(LitUpdate.parseSha256Sums(''), {});
});

test('cacheSweepPlan：只留白名单，其余列入待删', function () {
  const plan = LitUpdate.cacheSweepPlan(
    ['state.json', 'LitBoard-Setup-1.0.1-x64.exe', 'old.exe', 'x.exe.part', 'junk'],
    ['state.json', 'LitBoard-Setup-1.0.1-x64.exe']
  );
  assert.deepEqual(plan.keep.sort(), ['LitBoard-Setup-1.0.1-x64.exe', 'state.json'].sort());
  assert.deepEqual(plan.remove.sort(), ['junk', 'old.exe', 'x.exe.part'].sort());
  assert.deepEqual(LitUpdate.cacheSweepPlan([], ['state.json']), { keep: [], remove: [] });
});
