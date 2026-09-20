'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bump = require('../scripts/bump-version.js');

const ROOT = path.join(__dirname, '..');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'litboard-version-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

/** 用仓库真实的 package.json / package-lock.json 做一份可改的副本 */
function seedRepo(t) {
  const root = tempRoot(t);
  ['package.json', 'package-lock.json'].forEach(function (name) {
    fs.copyFileSync(path.join(ROOT, name), path.join(root, name));
  });
  return root;
}

test('nextVersion: patch/minor/major 各自进位并清零低位', function () {
  assert.equal(bump.nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bump.nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bump.nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(bump.nextVersion('0.0.9', 'patch'), '0.0.10');
  assert.equal(bump.nextVersion('1.9.9', 'minor'), '1.10.0');
  assert.equal(bump.nextVersion('1.2.0', 'patch'), '1.2.1');
});

test('nextVersion: 非法版本与级别一律抛错（不猜）', function () {
  assert.throws(function () { bump.nextVersion('1.2', 'patch'); }, /必须是 x\.y\.z/);
  assert.throws(function () { bump.nextVersion('v1.2.3', 'patch'); }, /必须是 x\.y\.z/);
  assert.throws(function () { bump.nextVersion('1.2.3-beta.1', 'patch'); }, /必须是 x\.y\.z/);
  assert.throws(function () { bump.nextVersion('', 'patch'); }, /必须是 x\.y\.z/);
  assert.throws(function () { bump.nextVersion(null, 'patch'); }, /必须是 x\.y\.z/);
  assert.throws(function () { bump.nextVersion('1.2.3', 'none'); }, /未知的版本级别/);
  assert.throws(function () { bump.nextVersion('1.2.3', 'build'); }, /未知的版本级别/);
});

test('bumpVersionFiles: x.y.z 两处同时更新，lock 里依赖版本一个都不许动', function (t) {
  const root = seedRepo(t);
  const lockBefore = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const pkgBefore = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const result = bump.bumpVersionFiles({ root: root, level: 'patch' });
  assert.equal(result.from, pkgBefore.version);
  assert.equal(result.to, bump.nextVersion(pkgBefore.version, 'patch'));
  assert.equal(result.changed, true);

  const pkgAfter = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkgAfter.version, result.to);
  // 除 version 之外 package.json 一字不动
  assert.deepEqual(pkgAfter, Object.assign({}, pkgBefore, { version: result.to }));

  const lockAfter = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  // lock 只允许顶层与 packages[""] 两处变化：把期望值构造出来逐项比对
  const expected = JSON.parse(JSON.stringify(lockBefore));
  expected.version = result.to;
  expected.packages[''].version = result.to;
  assert.deepEqual(lockAfter, expected);
  assert.equal(lockAfter.packages['node_modules/electron'].version, lockBefore.packages['node_modules/electron'].version);
});

test('bumpVersionFiles: 保持 2 空格缩进、LF 行尾与结尾换行（不重排文件）', function (t) {
  const root = seedRepo(t);
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  bump.bumpVersionFiles({ root: root, level: 'patch' });
  const after = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.equal(/\r/.test(after), false, '不得引入 CRLF');
  assert.equal(after.endsWith('\n'), true);
  assert.equal(after.split('\n').length, before.split('\n').length, '行数不应变化');
  assert.match(after, /\n {2}"version": "\d+\.\d+\.\d+",\n/);
  const lockAfter = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  assert.equal(/\r/.test(lockAfter), false);
  assert.match(lockAfter, /\n {6}"version": "\d+\.\d+\.\d+",\n/);   // packages[""] 那一处
});

test('bumpVersionFiles: level=none 与 dry-run 都不改文件', function (t) {
  const root = seedRepo(t);
  const pkgFile = path.join(root, 'package.json');
  const original = fs.readFileSync(pkgFile, 'utf8');

  const none = bump.bumpVersionFiles({ root: root, level: 'none' });
  assert.equal(none.changed, false);
  assert.equal(none.to, none.from);
  assert.deepEqual(none.files, []);
  assert.equal(fs.readFileSync(pkgFile, 'utf8'), original);

  const dry = bump.bumpVersionFiles({ root: root, level: 'minor', dryRun: true });
  assert.equal(dry.changed, true);
  assert.notEqual(dry.to, dry.from);
  assert.deepEqual(dry.files, []);
  assert.equal(fs.readFileSync(pkgFile, 'utf8'), original, 'dry-run 不得写盘');
});

test('连续打包每次都推进一个 patch（同一目录连打两次）', function (t) {
  const root = seedRepo(t);
  const first = bump.bumpVersionFiles({ root: root, level: 'patch' });
  const second = bump.bumpVersionFiles({ root: root, level: 'patch' });
  assert.equal(second.from, first.to);
  assert.equal(second.to, bump.nextVersion(first.to, 'patch'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, second.to);
});

test('replaceLockVersions: 版本对不上或结构缺失时抛错而不是乱改', function () {
  assert.throws(function () { bump.replaceLockVersions('{}\n', '1.2.0', '1.2.1'); }, /缺少顶层 version/);
  assert.throws(function () {
    bump.replaceLockVersions('{\n  "version": "9.9.9"\n}\n', '1.2.0', '1.2.1');
  }, /与 package.json 不一致/);
  assert.throws(function () {
    bump.replaceLockVersions('{\n  "version": "1.2.0",\n  "packages": {\n    "node_modules/x": {\n      "version": "1.2.0"\n    }\n  }\n}\n', '1.2.0', '1.2.1');
  }, /缺少 packages\[""\]/);
});

test('replacePackageVersion: 顶层 version 键异常时抛错（防止改到别处）', function () {
  assert.throws(function () {
    bump.replacePackageVersion('{\n  "name": "x"\n}\n', '1.2.0', '1.2.1');
  }, /数量异常/);
  assert.throws(function () {
    bump.replacePackageVersion('{\n  "version": "2.0.0"\n}\n', '1.2.0', '1.2.1');
  }, /与预期不符/);
});

test('CLI: 参数解析（默认 patch；未知参数报错）', function () {
  assert.deepEqual(bump.parseArgs([]), { level: 'patch', dryRun: false, quiet: false, root: '' });
  assert.deepEqual(bump.parseArgs(['--level=minor']), { level: 'minor', dryRun: false, quiet: false, root: '' });
  assert.deepEqual(bump.parseArgs(['--level=none', '--dry-run', '--quiet']),
    { level: 'none', dryRun: true, quiet: true, root: '' });
  assert.equal(bump.parseArgs(['--root=C:\\tmp\\x']).root, 'C:\\tmp\\x');
  assert.throws(function () { bump.parseArgs(['--level']); }, /未知参数/);
  assert.throws(function () { bump.parseArgs(['--nope']); }, /未知参数/);
});

test('CLI: --root 指向副本时只改副本；--dry-run 走到底也不写盘', function (t) {
  const root = seedRepo(t);
  const pkgFile = path.join(root, 'package.json');
  const original = fs.readFileSync(pkgFile, 'utf8');

  const dry = bump.main(['--level=patch', '--dry-run', '--quiet', '--root=' + root]);
  assert.equal(dry.changed, true);
  assert.deepEqual(dry.files, []);
  assert.equal(fs.readFileSync(pkgFile, 'utf8'), original, 'dry-run 不得写盘');

  const real = bump.main(['--level=patch', '--quiet', '--root=' + root]);
  assert.deepEqual(real.files, [pkgFile, path.join(root, 'package-lock.json')].filter(function (file) {
    return fs.existsSync(file);
  }));
  assert.equal(JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version, real.to);
  // 仓库自身的版本不受影响（CLI 只在指定的 root 上动手）
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, original.match(/"version": "([^"]+)"/)[1]);
});
