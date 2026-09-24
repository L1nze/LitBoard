'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDataPathManager, LOCATOR_FILE } = require('../electron/data-paths.js');
const { createLibraryDb } = require('../electron/db.js');

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-paths-'));
  t.after(function () { return fs.rm(root, { recursive: true, force: true }); });
  return root;
}

test('data paths default to the bootstrap directory', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const manager = createDataPathManager({ defaultDir: defaults });
  const state = manager.prepareAtStartup();
  assert.equal(state.configDir, defaults);
  assert.equal(state.libraryDir, defaults);
  assert.equal(state.migrationError, '');
});

test('staged path changes move config and library data and clear the originals after rebase', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const configTarget = path.join(root, 'config');
  const libraryTarget = path.join(root, 'library');
  await fs.mkdir(path.join(defaults, 'Local Storage'), { recursive: true });
  await fs.mkdir(configTarget);
  await fs.mkdir(libraryTarget);
  await fs.writeFile(path.join(defaults, 'integrations.json'), '{"ok":true}');
  await fs.writeFile(path.join(defaults, 'Local Storage', 'prefs'), 'theme=dark');
  await fs.mkdir(path.join(defaults, 'Cache'), { recursive: true });
  await fs.writeFile(path.join(defaults, 'Cache', 'stale.bin'), 'runtime-cache');
  await fs.writeFile(path.join(defaults, 'litboard.sqlite'), 'database');
  await fs.writeFile(path.join(defaults, 'litboard.sqlite.bak'), 'backup');

  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  const staged = manager.stage({ configDir: configTarget, libraryDir: libraryTarget });
  assert.equal(staged.changed, true);

  const restarted = createDataPathManager({ defaultDir: defaults });
  const state = restarted.prepareAtStartup();
  assert.equal(state.configDir, configTarget);
  assert.equal(state.libraryDir, libraryTarget);
  assert.equal(await fs.readFile(path.join(configTarget, 'integrations.json'), 'utf8'), '{"ok":true}');
  assert.equal(await fs.readFile(path.join(configTarget, 'Local Storage', 'prefs'), 'utf8'), 'theme=dark');
  await assert.rejects(fs.access(path.join(configTarget, 'Cache', 'stale.bin')));
  await assert.rejects(fs.access(path.join(configTarget, 'litboard.sqlite')));
  assert.equal(await fs.readFile(path.join(libraryTarget, 'litboard.sqlite'), 'utf8'), 'database');
  // 配置目录搬移后，旧目录要等 rebase 完成才清空（托管附件引用的最后兜底）
  assert.equal(state.cleanupPending, true);
  assert.equal(await fs.readFile(path.join(defaults, 'litboard.sqlite'), 'utf8'), 'database');
  const locator = JSON.parse(await fs.readFile(path.join(defaults, LOCATOR_FILE), 'utf8'));
  assert.equal(locator.configDir, configTarget);
  assert.equal(locator.libraryDir, libraryTarget);
  assert.equal(locator.pendingRebase.fromConfigDir, defaults);
  assert.ok(locator.pendingCleanup);

  restarted.completeRebase();
  assert.equal(restarted.getState().cleanupPending, false);
  const after = JSON.parse(await fs.readFile(path.join(defaults, LOCATOR_FILE), 'utf8'));
  assert.equal(after.pendingCleanup, undefined);
  assert.deepEqual(await fs.readdir(defaults), [LOCATOR_FILE]);
});

test('managed attachment paths are rebased while external paths stay unchanged', async function (t) {
  const root = await tempRoot(t);
  const from = path.join(root, 'old-config');
  const to = path.join(root, 'new-config');
  const external = path.join(root, 'papers', 'external.pdf');
  const manager = createDataPathManager({ defaultDir: path.join(root, 'default') });
  const workspace = {
    papers: [{
      id: 'p1',
      pdfPath: path.join(from, 'synced-attachments', 'items', 'p1', 'a1.pdf'),
      attachments: [
        { id: 'a1', kind: 'pdf', path: path.join(from, 'synced-attachments', 'items', 'p1', 'a1.pdf') },
        { id: 'a2', kind: 'supp', path: external }
      ],
      pdfAnnotations: [
        { id: 'n1', imagePath: path.join(from, 'annotation-images', 'n1.png') },
        { id: 'n2', imagePath: external }
      ]
    }]
  };
  const result = manager.rebaseWorkspacePaths(workspace, from, to);
  assert.equal(result.changed, 3);
  assert.equal(workspace.papers[0].pdfPath, path.join(to, 'synced-attachments', 'items', 'p1', 'a1.pdf'));
  assert.equal(workspace.papers[0].attachments[0].path, path.join(to, 'synced-attachments', 'items', 'p1', 'a1.pdf'));
  assert.equal(workspace.papers[0].attachments[1].path, external);
  assert.equal(workspace.papers[0].pdfAnnotations[0].imagePath, path.join(to, 'annotation-images', 'n1.png'));
  assert.equal(workspace.papers[0].pdfAnnotations[1].imagePath, external);
});

test('paths restored into restored-assets are rebased like other managed dirs', async function (t) {
  const root = await tempRoot(t);
  const from = path.join(root, 'old-config');
  const to = path.join(root, 'new-config');
  const manager = createDataPathManager({ defaultDir: path.join(root, 'default') });
  const restored = path.join(from, 'restored-assets', '20260910-120000-ab12cd', 'assets', 'p1', 'a1-paper.pdf');
  const workspace = {
    papers: [{
      id: 'p1',
      pdfPath: restored,
      attachments: [{ id: 'a1', kind: 'pdf', path: restored }],
      pdfAnnotations: [{
        id: 'n1', imagePath: path.join(from, 'restored-assets', '20260910-120000-ab12cd', 'assets', 'p1', 'n1.png')
      }]
    }]
  };
  const result = manager.rebaseWorkspacePaths(workspace, from, to);
  assert.equal(result.changed, 3);
  assert.equal(workspace.papers[0].attachments[0].path,
    path.join(to, 'restored-assets', '20260910-120000-ab12cd', 'assets', 'p1', 'a1-paper.pdf'));
  assert.equal(workspace.papers[0].pdfPath,
    path.join(to, 'restored-assets', '20260910-120000-ab12cd', 'assets', 'p1', 'a1-paper.pdf'));
  assert.equal(workspace.papers[0].pdfAnnotations[0].imagePath,
    path.join(to, 'restored-assets', '20260910-120000-ab12cd', 'assets', 'p1', 'n1.png'));
});

test('a real migrated database persists rebased LitBoard-managed paths', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const configTarget = path.join(root, 'config');
  const libraryTarget = path.join(root, 'library');
  const managedPdf = path.join(defaults, 'synced-attachments', 'p1.pdf');
  const managedImage = path.join(defaults, 'annotation-images', 'n1.png');
  const external = path.join(root, 'external.pdf');
  await fs.mkdir(path.dirname(managedPdf), { recursive: true });
  await fs.mkdir(path.dirname(managedImage), { recursive: true });
  await fs.mkdir(configTarget);
  await fs.mkdir(libraryTarget);
  await fs.writeFile(managedPdf, '%PDF-managed');
  await fs.writeFile(managedImage, 'png');

  const sourceDb = createLibraryDb(defaults);
  await sourceDb.open();
  sourceDb.saveState({ papers: [{
    id: 'p1', title: 'Managed paths',
    attachments: [
      { id: 'a1', kind: 'pdf', fileName: 'p1.pdf', path: managedPdf },
      { id: 'a2', kind: 'supp', fileName: 'external.pdf', path: external }
    ],
    pdfAnnotations: [{
      id: 'n1', type: 'snapshot', imagePath: managedImage,
      position: { pageIndex: 0, rects: [[0, 0, 10, 10]] },
      createdAt: 1, updatedAt: 1
    }]
  }], folders: [] });
  await sourceDb.close();

  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  manager.stage({ configDir: configTarget, libraryDir: libraryTarget });
  const restarted = createDataPathManager({ defaultDir: defaults });
  restarted.prepareAtStartup();

  const targetDb = createLibraryDb(libraryTarget);
  await targetDb.open();
  const pending = restarted.pendingRebase();
  assert.ok(pending);
  const rebased = restarted.rebaseWorkspacePaths(targetDb.loadState(), pending.fromConfigDir, pending.toConfigDir);
  assert.equal(rebased.changed, 3);
  targetDb.saveState(rebased.workspace);
  restarted.completeRebase();
  const paper = targetDb.loadState().papers[0];
  assert.equal(paper.pdfPath, path.join(configTarget, 'synced-attachments', 'p1.pdf'));
  assert.equal(paper.attachments[1].path, external);
  assert.equal(paper.pdfAnnotations[0].imagePath, path.join(configTarget, 'annotation-images', 'n1.png'));
  assert.equal(await fs.readFile(path.join(configTarget, 'synced-attachments', 'p1.pdf'), 'utf8'), '%PDF-managed');
  assert.equal(await fs.readFile(path.join(configTarget, 'annotation-images', 'n1.png'), 'utf8'), 'png');
  assert.equal(restarted.pendingRebase(), null);
  await targetDb.close();
  // 搬移语义：rebase 完成后旧目录只剩定位文件，库与受管资产全部只在新位置
  assert.deepEqual(await fs.readdir(defaults), [LOCATOR_FILE]);
});

test('path staging rejects non-empty and nested targets', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const nonEmpty = path.join(root, 'occupied');
  const empty = path.join(root, 'empty');
  await fs.mkdir(defaults);
  await fs.mkdir(nonEmpty);
  await fs.mkdir(empty);
  await fs.writeFile(path.join(nonEmpty, 'other.txt'), 'keep');
  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  assert.throws(function () {
    manager.stage({ configDir: nonEmpty, libraryDir: empty });
  }, /目标目录必须为空/);
  assert.throws(function () {
    manager.stage({ configDir: path.join(defaults, 'nested'), libraryDir: empty });
  }, /不能放在当前目录/);
  assert.throws(function () {
    manager.stage({ configDir: empty, libraryDir: path.join(empty, 'library') });
  }, /不能互相嵌套/);
});

test('migration backs up an existing trusted target library before replacement', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const library = path.join(root, 'library');
  await fs.mkdir(defaults);
  await fs.mkdir(library);
  await fs.writeFile(path.join(defaults, 'litboard.sqlite'), 'current');
  await fs.writeFile(path.join(library, 'litboard.sqlite'), 'older');
  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  await fs.writeFile(path.join(defaults, LOCATOR_FILE), JSON.stringify({
    version: 1,
    configDir: defaults,
    libraryDir: library,
    pending: { configDir: defaults, libraryDir: defaults }
  }));
  const restarted = createDataPathManager({ defaultDir: defaults });
  restarted.prepareAtStartup();
  const backups = (await fs.readdir(defaults)).filter(function (name) {
    return /^litboard\.sqlite\.pre-path-change-\d+\.bak$/.test(name);
  });
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(defaults, backups[0]), 'utf8'), 'current');
  assert.equal(await fs.readFile(path.join(defaults, 'litboard.sqlite'), 'utf8'), 'older');
  // 搬移语义：配置目录未动，旧库目录立即清空
  await assert.rejects(fs.access(path.join(library, 'litboard.sqlite')));
  await assert.rejects(fs.access(library));
});

test('split data paths cannot be crossed during a later migration', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const config = path.join(root, 'config');
  const library = path.join(root, 'library');
  const nextLibrary = path.join(root, 'next-library');
  await Promise.all([defaults, config, library, nextLibrary].map(function (directory) {
    return fs.mkdir(directory, { recursive: true });
  }));
  await fs.writeFile(path.join(defaults, LOCATOR_FILE), JSON.stringify({ configDir: config, libraryDir: library }));
  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  assert.throws(function () {
    manager.stage({ configDir: library, libraryDir: nextLibrary });
  }, /不能覆盖或嵌套当前文献库目录/);
});

test('missing migration source fails closed and keeps the current locator', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const missingConfig = path.join(root, 'missing-config');
  const missingLibrary = path.join(root, 'missing-library');
  const target = path.join(root, 'target');
  await fs.mkdir(defaults, { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(defaults, LOCATOR_FILE), JSON.stringify({
    configDir: missingConfig,
    libraryDir: missingLibrary,
    pending: { configDir: target, libraryDir: target }
  }));
  const manager = createDataPathManager({ defaultDir: defaults });
  const state = manager.prepareAtStartup();
  assert.match(state.migrationError, /当前数据目录不存在或不可用|配置的数据目录不可用/);
  assert.equal(state.fatalError, true);
  assert.equal(state.configDir, missingConfig);
  assert.equal(state.libraryDir, missingLibrary);
  const locator = JSON.parse(await fs.readFile(path.join(defaults, LOCATOR_FILE), 'utf8'));
  assert.equal(locator.configDir, missingConfig);
  assert.equal(locator.libraryDir, missingLibrary);
  assert.ok(locator.pending);
});

test('a failed target migration keeps the valid current paths available for recovery', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const nestedTarget = path.join(defaults, 'nested');
  await fs.mkdir(defaults, { recursive: true });
  await fs.writeFile(path.join(defaults, 'integrations.json'), '{}');
  await fs.writeFile(path.join(defaults, LOCATOR_FILE), JSON.stringify({
    configDir: defaults,
    libraryDir: defaults,
    pending: { configDir: nestedTarget, libraryDir: nestedTarget }
  }));
  const manager = createDataPathManager({ defaultDir: defaults });
  const state = manager.prepareAtStartup();
  assert.match(state.migrationError, /不能放在当前目录/);
  assert.equal(state.fatalError, false);
  assert.equal(state.configDir, defaults);
  assert.equal(state.libraryDir, defaults);
  const canceled = manager.stage({ configDir: defaults, libraryDir: defaults });
  assert.equal(canceled.changed, false);
  assert.equal(canceled.migrationError, '');
  assert.equal(canceled.restartRequired, false);
});

test('a damaged locator fails closed instead of opening the default directory', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  await fs.mkdir(defaults, { recursive: true });
  await fs.writeFile(path.join(defaults, LOCATOR_FILE), '{not-json');
  const manager = createDataPathManager({ defaultDir: defaults });
  const state = manager.prepareAtStartup();
  assert.equal(state.fatalError, true);
  assert.match(state.migrationError, /路径定位文件无法读取/);
});

test('invalid current paths in an otherwise valid locator fail closed', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  await fs.mkdir(defaults, { recursive: true });
  await fs.writeFile(path.join(defaults, LOCATOR_FILE), JSON.stringify({
    configDir: 'relative-config',
    libraryDir: defaults
  }));
  const state = createDataPathManager({ defaultDir: defaults }).prepareAtStartup();
  assert.equal(state.fatalError, true);
  assert.match(state.migrationError, /当前数据目录无效/);
});

test('note asset paths under note-assets are rebased while external paths stay unchanged', async function (t) {
  const root = await tempRoot(t);
  const from = path.join(root, 'old-config');
  const to = path.join(root, 'new-config');
  const external = path.join(root, 'outside', 'img.png');
  const manager = createDataPathManager({ defaultDir: path.join(root, 'default') });
  const managedImg = path.join(from, 'note-assets', 'n1', 'img.png');
  const workspace = {
    papers: [],
    notes: [{
      id: 'n1',
      assets: [
        { fileName: 'img.png', path: managedImg },
        { fileName: 'ext.png', path: external }, // 非受管外部路径不动
        { fileName: 'cloud-only.png' } // 无 path 的云端资产不报错
      ]
    }]
  };
  const result = manager.rebaseWorkspacePaths(workspace, from, to);
  assert.equal(result.changed, 1);
  assert.equal(workspace.notes[0].assets[0].path, path.join(to, 'note-assets', 'n1', 'img.png'));
  assert.equal(workspace.notes[0].assets[1].path, external);
  assert.equal(workspace.notes[0].assets[2].path, undefined);
});

test('moving only the library clears the old shared directory right away', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const libraryTarget = path.join(root, 'library');
  await fs.mkdir(defaults);
  await fs.mkdir(libraryTarget);
  await fs.writeFile(path.join(defaults, 'litboard.sqlite'), 'database');
  await fs.writeFile(path.join(defaults, 'integrations.json'), '{"ok":true}');

  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  manager.stage({ configDir: defaults, libraryDir: libraryTarget });
  const restarted = createDataPathManager({ defaultDir: defaults });
  const state = restarted.prepareAtStartup();
  assert.equal(state.configDir, defaults);
  assert.equal(state.libraryDir, libraryTarget);
  assert.equal(state.restartRequired, false);
  assert.equal(state.cleanupPending, false);
  assert.equal(await fs.readFile(path.join(libraryTarget, 'litboard.sqlite'), 'utf8'), 'database');
  // 配置目录原地不动（配置文件保留），旧库文件立即从共享目录清走
  assert.deepEqual((await fs.readdir(defaults)).sort(), [LOCATOR_FILE, 'integrations.json']);
});

test('cleanup keeps an old .bak whose new copy has diverged (recovery point protection)', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const configTarget = path.join(root, 'config');
  const libraryTarget = path.join(root, 'library');
  await fs.mkdir(defaults, { recursive: true });
  await fs.mkdir(configTarget);
  await fs.mkdir(libraryTarget);
  await fs.writeFile(path.join(defaults, 'integrations.json'), '{"ok":true}');
  await fs.writeFile(path.join(defaults, 'litboard.sqlite'), 'database');
  await fs.writeFile(path.join(defaults, 'litboard.sqlite.bak'), 'healthy-backup');

  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  manager.stage({ configDir: configTarget, libraryDir: libraryTarget });
  const restarted = createDataPathManager({ defaultDir: defaults });
  restarted.prepareAtStartup();
  // 迁移完成后、清理发生前，新目录的 .bak 被轮换/覆盖成不同内容（如空库的新备份）
  await fs.writeFile(path.join(libraryTarget, 'litboard.sqlite.bak'), 'x');

  restarted.completeRebase();
  // 主库文件已按同名复制删除；旧 .bak 因内容不一致必须保留
  await assert.rejects(fs.access(path.join(defaults, 'litboard.sqlite')));
  assert.equal(await fs.readFile(path.join(defaults, 'litboard.sqlite.bak'), 'utf8'), 'healthy-backup');
  const locator = JSON.parse(await fs.readFile(path.join(defaults, LOCATOR_FILE), 'utf8'));
  assert.ok(locator.pendingCleanup, '清理未完成标记保留');
  assert.match(locator.lastCleanupError, /备份内容不一致/);
});

test('a failed copy leaves the old directories untouched and records no cleanup marker', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const target = path.join(root, 'target');
  await fs.mkdir(defaults);
  await fs.mkdir(target);
  await fs.writeFile(path.join(defaults, 'mystuff.txt'), 'user-file');

  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  manager.stage({ configDir: target, libraryDir: target });
  // 破坏复制：目标里预置与源文件同名的目录，cpSync 复制该文件时必然报错
  await fs.mkdir(path.join(target, 'mystuff.txt'));
  const restarted = createDataPathManager({ defaultDir: defaults });
  const state = restarted.prepareAtStartup();
  assert.match(state.migrationError, /数据目录迁移失败/);
  assert.equal(state.cleanupPending, false);
  assert.equal(state.configDir, defaults);
  assert.equal(state.libraryDir, defaults);
  assert.equal(await fs.readFile(path.join(defaults, 'mystuff.txt'), 'utf8'), 'user-file');
  const locator = JSON.parse(await fs.readFile(path.join(defaults, LOCATOR_FILE), 'utf8'));
  assert.ok(locator.pending);
  assert.equal(locator.pendingCleanup, undefined);

  // 解除破坏后再次启动即重试成功
  await fs.rm(path.join(target, 'mystuff.txt'), { recursive: true, force: true });
  const third = createDataPathManager({ defaultDir: defaults });
  const ok = third.prepareAtStartup();
  assert.equal(ok.configDir, target);
  assert.equal(ok.migrationError, '');
});

test('an interrupted cleanup keeps its marker, blocks re-staging, and retries on next startup',
  async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const libraryTarget = path.join(root, 'library');
  await fs.mkdir(defaults);
  await fs.mkdir(libraryTarget);
  await fs.writeFile(path.join(defaults, 'litboard.sqlite'), 'database');

  const manager = createDataPathManager({ defaultDir: defaults });
  manager.prepareAtStartup();
  manager.stage({ configDir: defaults, libraryDir: libraryTarget });
  // 模拟清理被占用打断：第一次删旧库文件时报错，其后恢复正常
  const realRmSync = fsSync.rmSync;
  let failedOnce = false;
  fsSync.rmSync = function (target, options) {
    if (!failedOnce && String(target) === path.join(defaults, 'litboard.sqlite')) {
      failedOnce = true;
      throw new Error('EBUSY: simulated resource busy');
    }
    return realRmSync(target, options);
  };
  let restarted;
  let state;
  try {
    restarted = createDataPathManager({ defaultDir: defaults });
    state = restarted.prepareAtStartup();
  } finally {
    fsSync.rmSync = realRmSync;
  }
  assert.equal(failedOnce, true);
  assert.equal(state.libraryDir, libraryTarget);
  assert.equal(state.cleanupPending, true);
  assert.match(state.cleanupError, /清理未完成/);
  assert.equal(await fs.readFile(path.join(libraryTarget, 'litboard.sqlite'), 'utf8'), 'database');
  assert.throws(function () {
    restarted.stage({ configDir: path.join(root, 'elsewhere'), libraryDir: path.join(root, 'elsewhere') });
  }, /尚未清理完成/);

  // 下次启动自动重试，成功后旧目录只剩定位文件
  const third = createDataPathManager({ defaultDir: defaults });
  const done = third.prepareAtStartup();
  assert.equal(done.cleanupPending, false);
  assert.deepEqual((await fs.readdir(defaults)).sort(), [LOCATOR_FILE]);
});

// 迁移源的准备：定位文件放在独立的默认目录里，真正的旧配置/旧库目录另建一份
// （真实场景里默认目录往往就是当年的配置目录，而默认目录里的 lockfile 是本进程持有的单例锁，
// 不该由迁移去删——这一点单独在下面的用例里验证）。
async function seedLocator(defaults, current, pending) {
  await fs.mkdir(defaults, { recursive: true });
  await fs.writeFile(path.join(defaults, LOCATOR_FILE), JSON.stringify(
    Object.assign({ configDir: current.configDir, libraryDir: current.libraryDir }, pending ? { pending: pending } : {})
  ));
}

test('chromium runtime entries are not copied over and the old config dir ends up empty', async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const oldConfig = path.join(root, 'old-config');
  const oldLibrary = path.join(root, 'old-library');
  const configTarget = path.join(root, 'config');
  const libraryTarget = path.join(root, 'library');
  await Promise.all([oldConfig, oldLibrary, configTarget, libraryTarget].map(function (dir) {
    return fs.mkdir(dir, { recursive: true });
  }));
  await fs.mkdir(path.join(oldConfig, 'Local Storage'), { recursive: true });
  await fs.mkdir(path.join(oldConfig, 'Cache'), { recursive: true });
  await fs.writeFile(path.join(oldConfig, 'lockfile'), '');
  await fs.writeFile(path.join(oldConfig, 'Cache', 'stale.bin'), 'runtime-cache');
  await fs.writeFile(path.join(oldConfig, 'Preferences'), '{"theme":"dark"}');
  await fs.writeFile(path.join(oldConfig, 'Local Storage', 'prefs'), 'theme=dark');
  await fs.writeFile(path.join(oldLibrary, 'litboard.sqlite'), 'database');
  await seedLocator(defaults, { configDir: oldConfig, libraryDir: oldLibrary },
    { configDir: configTarget, libraryDir: libraryTarget });

  const restarted = createDataPathManager({ defaultDir: defaults });
  const state = restarted.prepareAtStartup();
  assert.equal(state.configDir, configTarget);
  restarted.completeRebase();

  // 真数据（界面偏好、localStorage）照常搬过去
  assert.equal(await fs.readFile(path.join(configTarget, 'Preferences'), 'utf8'), '{"theme":"dark"}');
  assert.equal(await fs.readFile(path.join(configTarget, 'Local Storage', 'prefs'), 'utf8'), 'theme=dark');
  // 单例锁与运行时缓存是可再生产物：既不复制，也不在旧目录留下
  await assert.rejects(fs.access(path.join(configTarget, 'lockfile')));
  await assert.rejects(fs.access(path.join(configTarget, 'Cache')));
  assert.equal(restarted.getState().cleanupPending, false);
  assert.equal(restarted.getState().runtimeSweepPending, false);
  await assert.rejects(fs.access(oldConfig));
  await assert.rejects(fs.access(oldLibrary));
});

test('an undeletable runtime entry does not block the move and is swept right afterwards',
  async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const oldDir = path.join(root, 'old-dir');
  const target = path.join(root, 'target');
  await fs.mkdir(oldDir);
  await fs.mkdir(target);
  await fs.writeFile(path.join(oldDir, 'lockfile'), '');
  await fs.writeFile(path.join(oldDir, 'integrations.json'), '{"ok":true}');
  await seedLocator(defaults, { configDir: oldDir, libraryDir: oldDir },
    { configDir: target, libraryDir: target });

  // 模拟迁移那会儿 lockfile 还被上一个进程攥着（Windows 上删除会 EBUSY）
  const realRmSync = fsSync.rmSync;
  fsSync.rmSync = function (candidate, options) {
    if (path.basename(String(candidate)) === 'lockfile') throw new Error('EBUSY: simulated lock');
    return realRmSync(candidate, options);
  };
  let restarted;
  let state;
  try {
    restarted = createDataPathManager({ defaultDir: defaults });
    state = restarted.prepareAtStartup();
    restarted.completeRebase();
  } finally {
    fsSync.rmSync = realRmSync;
  }

  // 搬家本身算完成：这不是「清理未完成」错误，也不再需要用户重启去碰运气
  assert.equal(state.configDir, target);
  assert.equal(restarted.getState().cleanupPending, false);
  assert.equal(restarted.getState().cleanupError, '');
  // 但 0 字节小尾巴不能就这么算了：登记补偿清理，等占用解除后补删
  assert.equal(restarted.getState().runtimeSweepPending, true);
  assert.equal(restarted.getState().runtimeSweepFailed, 1);
  assert.equal(await fs.readFile(path.join(oldDir, 'lockfile'), 'utf8'), '');

  restarted.retryCleanup();
  assert.equal(restarted.getState().runtimeSweepPending, false);
  assert.equal(restarted.getState().runtimeSweepFailed, 0);
  await assert.rejects(fs.access(path.join(oldDir, 'lockfile')));
  await assert.rejects(fs.access(oldDir));
});

test('the default directory keeps its own live lockfile when it was the old config dir',
  async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const target = path.join(root, 'target');
  await fs.mkdir(defaults, { recursive: true });
  await fs.mkdir(target);
  await fs.mkdir(path.join(defaults, 'Cache'), { recursive: true });
  // 默认目录同时是旧配置目录：lockfile 是当前进程持有的单例锁，Cache 是可再生的
  await fs.writeFile(path.join(defaults, 'lockfile'), '');
  await fs.writeFile(path.join(defaults, 'Cache', 'stale.bin'), 'runtime-cache');
  await fs.writeFile(path.join(defaults, 'integrations.json'), '{"ok":true}');
  await seedLocator(defaults, { configDir: defaults, libraryDir: defaults },
    { configDir: target, libraryDir: target });

  const restarted = createDataPathManager({ defaultDir: defaults });
  restarted.prepareAtStartup();
  restarted.completeRebase();
  assert.equal(restarted.getState().cleanupPending, false);
  // 单例锁留着（删了会让第二个实例误判独占），可再生缓存与已迁移的数据清掉
  assert.equal(await fs.readFile(path.join(defaults, 'lockfile'), 'utf8'), '');
  await assert.rejects(fs.access(path.join(defaults, 'Cache')));
  await assert.rejects(fs.access(path.join(defaults, 'integrations.json')));
  assert.deepEqual((await fs.readdir(defaults)).sort(), [LOCATOR_FILE, 'lockfile']);
});

test('a file that shows up in the old directory after the copy is preserved and reported',
  async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const oldConfig = path.join(root, 'old-config');
  const configTarget = path.join(root, 'config');
  const libraryTarget = path.join(root, 'library');
  await fs.mkdir(oldConfig, { recursive: true });
  await fs.mkdir(configTarget);
  await fs.mkdir(libraryTarget);
  await fs.writeFile(path.join(oldConfig, 'integrations.json'), '{"ok":true}');
  await fs.writeFile(path.join(oldConfig, 'litboard.sqlite'), 'database');
  await seedLocator(defaults, { configDir: oldConfig, libraryDir: oldConfig },
    { configDir: configTarget, libraryDir: libraryTarget });

  const restarted = createDataPathManager({ defaultDir: defaults });
  restarted.prepareAtStartup();
  // 迁移之后旧目录里又冒出个文件（例如旧版本的实例仍在往里写）
  await fs.writeFile(path.join(oldConfig, 'late.json'), '{}');
  restarted.completeRebase();

  const after = restarted.getState();
  assert.equal(after.cleanupPending, false);
  assert.deepEqual(after.cleanupPreserved, ['late.json']);
  // 来源不明的文件保留原处并在设置里报出来，不再静默留在旧目录里当小尾巴
  assert.equal(await fs.readFile(path.join(oldConfig, 'late.json'), 'utf8'), '{}');
  await assert.rejects(fs.access(path.join(oldConfig, 'integrations.json')));
});

test('moving only the config directory never deletes the library that stays behind',
  async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const shared = path.join(root, 'shared');
  const configTarget = path.join(root, 'config');
  await fs.mkdir(shared, { recursive: true });
  await fs.mkdir(configTarget);
  await fs.writeFile(path.join(shared, 'integrations.json'), '{"ok":true}');
  await fs.writeFile(path.join(shared, 'litboard.sqlite'), 'database');
  await fs.writeFile(path.join(shared, 'litboard.sqlite-wal'), 'wal');
  await seedLocator(defaults, { configDir: shared, libraryDir: shared },
    { configDir: configTarget, libraryDir: shared });

  const restarted = createDataPathManager({ defaultDir: defaults });
  const state = restarted.prepareAtStartup();
  assert.equal(state.configDir, configTarget);
  assert.equal(state.libraryDir, shared);
  restarted.completeRebase();

  assert.equal(await fs.readFile(path.join(configTarget, 'integrations.json'), 'utf8'), '{"ok":true}');
  await assert.rejects(fs.access(path.join(shared, 'integrations.json')));
  // 文献库留在原处仍在使用：库文件与伴生文件都不是「旧副本」，一律不能删
  assert.equal(await fs.readFile(path.join(shared, 'litboard.sqlite'), 'utf8'), 'database');
  assert.equal(await fs.readFile(path.join(shared, 'litboard.sqlite-wal'), 'utf8'), 'wal');
  assert.equal(restarted.getState().cleanupPending, false);
});

test('a library nested inside the old config directory is cleaned and its empty shell removed',
  async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const oldConfig = path.join(root, 'old-config');
  const oldLibrary = path.join(oldConfig, 'library');
  const configTarget = path.join(root, 'config');
  const libraryTarget = path.join(root, 'library-target');
  await fs.mkdir(oldLibrary, { recursive: true });
  await fs.mkdir(configTarget);
  await fs.mkdir(libraryTarget);
  await fs.writeFile(path.join(oldConfig, 'integrations.json'), '{"ok":true}');
  await fs.writeFile(path.join(oldLibrary, 'litboard.sqlite'), 'database');
  await seedLocator(defaults, { configDir: oldConfig, libraryDir: oldLibrary },
    { configDir: configTarget, libraryDir: libraryTarget });

  const restarted = createDataPathManager({ defaultDir: defaults });
  restarted.prepareAtStartup();
  restarted.completeRebase();

  assert.equal(await fs.readFile(path.join(libraryTarget, 'litboard.sqlite'), 'utf8'), 'database');
  assert.equal(restarted.getState().cleanupPending, false);
  const after = restarted.getState();
  assert.deepEqual(after.cleanupPreserved, []);
  // 嵌套的旧库目录掏空后被删掉，配置目录里那一层空壳也跟着清掉
  await assert.rejects(fs.access(oldLibrary));
  await assert.rejects(fs.access(oldConfig));
});

test('a typed path may use %VAR% and is expanded on Windows',
  { skip: process.platform !== 'win32' }, async function (t) {
  const root = await tempRoot(t);
  const defaults = path.join(root, 'default');
  const target = path.join(root, 'target');
  await fs.mkdir(defaults, { recursive: true });
  await fs.mkdir(target);
  const key = 'LITBOARD_TEST_PATHS_ROOT';
  const previous = process.env[key];
  process.env[key] = root;
  try {
    const manager = createDataPathManager({ defaultDir: defaults });
    manager.prepareAtStartup();
    const staged = manager.stage({ configDir: '%' + key + '%\\target', libraryDir: '%' + key + '%\\target' });
    assert.equal(staged.restartRequired, true);
    assert.equal(staged.pendingConfigDir, target);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('open-access-pdf is a managed config dir and its attachment paths are rebased', async function (t) {
  const root = await tempRoot(t);
  const from = path.join(root, 'old-config');
  const to = path.join(root, 'new-config');
  const manager = createDataPathManager({ defaultDir: path.join(root, 'default') });
  const workspace = {
    papers: [{
      id: 'p1',
      attachments: [{ id: 'a1', kind: 'pdf', path: path.join(from, 'open-access-pdf', 'litboard-p1.pdf') }]
    }]
  };
  const result = manager.rebaseWorkspacePaths(workspace, from, to);
  assert.equal(result.changed, 1);
  assert.equal(workspace.papers[0].attachments[0].path, path.join(to, 'open-access-pdf', 'litboard-p1.pdf'));
});
