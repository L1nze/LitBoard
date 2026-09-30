'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOCATOR_FILE = 'data-paths.json';
const LOCATOR_VERSION = 1;
const MANAGED_CONFIG_DIRS = Object.freeze([
  'annotation-images',
  'attachments',
  // 从完整备份恢复出来的附件会落到 <configDir>/restored-assets/<snapshotId>/，
  // 同样属于受管目录：漏了它，迁移配置目录后这些附件路径不会被重写，链接就断了。
  'restored-assets',
  'synced-attachments',
  'note-assets',   // 笔记内嵌图片等资产（Zotero 导入的笔记图片落在这里）
  'zotero-migrated-attachments',
  // 开放获取 PDF 的默认落盘目录（未设置「PDF 自动下载目录」时，桌面下载与扩展抓取都落这里）
  'open-access-pdf',
  // AI 调研助手的调研库（research.db + vec.db 向量缓存；vec 可再生不进快照）
  'research'
]);
const RUNTIME_CONFIG_ENTRIES = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache',
  'ShaderCache', 'Crashpad', 'blob_storage', 'SingletonCookie',
  'SingletonLock', 'SingletonSocket', 'LOCK',
  // Chromium 的进程单例锁（Windows 形态就是 userData 根下的一个 0 字节 lockfile）。
  // 它每次启动重建、迁移过去只会变成死文件，删不掉也不该算清理失败——但也不能就此不管，
  // 否则旧目录会永久留一个 lockfile 小尾巴（见 runRuntimeSweep 的补偿删除）。
  'lockfile',
  // 应用自动更新的安装包缓存（update-check.js）：可再下载的运行时产物——迁移不复制
  // （上百 MB 没必要跟着搬），旧目录清扫时按运行时条目删除，不做完整性记账。
  'update-cache'
]);
// 这些名字在当前进程运行期间被自己持有：当被清理的目录正是默认目录时既不删也不记账
// （删掉会让第二个实例误判自己独占，且它必然删不动）。
const LIVE_SINGLETON_ENTRIES = new Set(['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']);

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try { return fs.realpathSync.native(resolved); } catch (error) {}
  let cursor = resolved;
  const suffix = [];
  while (cursor && !fs.existsSync(cursor)) {
    suffix.unshift(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  try { return path.join(fs.realpathSync.native(cursor), ...suffix); } catch (error) { return resolved; }
}

function samePath(left, right) {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function insidePath(parent, child) {
  if (samePath(parent, child)) return false;
  const relative = path.relative(canonicalPath(parent), canonicalPath(child));
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// 手输路径时允许 %USERPROFILE% 这类 Windows 环境变量写法；解析不出来就原样保留
function expandEnvVars(value) {
  if (process.platform !== 'win32') return value;
  return value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, function (match, name) {
    const replacement = process.env[name];
    return replacement ? path.resolve(replacement) : match;
  });
}

function validDirectory(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const resolved = expandEnvVars(value.trim());
  return path.isAbsolute(resolved) ? path.resolve(resolved) : '';
}

function isManagedConfigPath(value, configDir) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return false;
  const relative = path.relative(canonicalPath(configDir), canonicalPath(value));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
  return MANAGED_CONFIG_DIRS.includes(relative.split(path.sep)[0]);
}

function rebaseManagedPath(value, fromConfigDir, toConfigDir) {
  if (!isManagedConfigPath(value, fromConfigDir)) return value;
  const relative = path.relative(canonicalPath(fromConfigDir), canonicalPath(value));
  return path.join(path.resolve(toConfigDir), relative);
}

function rebaseWorkspacePaths(workspace, fromConfigDir, toConfigDir) {
  const result = workspace && typeof workspace === 'object' ? workspace : {};
  let changed = 0;
  (Array.isArray(result.papers) ? result.papers : []).forEach(function (paper) {
    if (!paper || typeof paper !== 'object') return;
    (Array.isArray(paper.attachments) ? paper.attachments : []).forEach(function (attachment) {
      if (!attachment || typeof attachment !== 'object') return;
      const next = rebaseManagedPath(attachment.path, fromConfigDir, toConfigDir);
      if (next !== attachment.path) { attachment.path = next; changed++; }
    });
    const nextPdf = rebaseManagedPath(paper.pdfPath, fromConfigDir, toConfigDir);
    if (nextPdf !== paper.pdfPath) { paper.pdfPath = nextPdf; changed++; }
    const primary = (Array.isArray(paper.attachments) ? paper.attachments : []).find(function (attachment) {
      return attachment && attachment.kind === 'pdf';
    });
    if (primary && primary.path !== paper.pdfPath) paper.pdfPath = primary.path;
    (Array.isArray(paper.pdfAnnotations) ? paper.pdfAnnotations : []).forEach(function (annotation) {
      if (!annotation || typeof annotation !== 'object') return;
      const next = rebaseManagedPath(annotation.imagePath, fromConfigDir, toConfigDir);
      if (next !== annotation.imagePath) { annotation.imagePath = next; changed++; }
    });
  });
  // 笔记资产（note-assets/）同样受管，迁移配置目录时一并重写
  (Array.isArray(result.notes) ? result.notes : []).forEach(function (note) {
    if (!note || typeof note !== 'object') return;
    (Array.isArray(note.assets) ? note.assets : []).forEach(function (asset) {
      if (!asset || typeof asset !== 'object') return;
      const next = rebaseManagedPath(asset.path, fromConfigDir, toConfigDir);
      if (next !== asset.path) { asset.path = next; changed++; }
    });
  });
  return { workspace: result, changed: changed };
}

function isLibraryEntry(name) {
  return name === 'litboard.sqlite' || name.startsWith('litboard.sqlite.') || name.startsWith('litboard.sqlite-') ||
    name === 'library.v1.json' || name.startsWith('library.v1.json.') ||
    name === 'pdftext.v1.json' || name.startsWith('pdftext.v1.json.');
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.copyFileSync(temp, file);
    fs.rmSync(temp, { force: true });
  }
}

function createDataPathManager(options) {
  const defaultDir = path.resolve(options.defaultDir);
  const locatorFile = path.join(defaultDir, LOCATOR_FILE);
  let runtimeState = null;

  function readRaw() {
    try {
      const value = JSON.parse(fs.readFileSync(locatorFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('路径定位文件的内容格式无效');
      }
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      return {
        lastError: '路径定位文件无法读取：' + String(error && error.message || error),
        fatalReadError: true
      };
    }
  }

  function rawCurrent(raw) {
    return {
      configDir: validDirectory(raw.configDir) || defaultDir,
      libraryDir: validDirectory(raw.libraryDir) || defaultDir
    };
  }

  function publicState(raw, current) {
    const pending = raw.pending && typeof raw.pending === 'object' ? raw.pending : null;
    const rebase = raw.pendingRebase && typeof raw.pendingRebase === 'object' ? raw.pendingRebase : null;
    return {
      defaultConfigDir: defaultDir,
      defaultLibraryDir: defaultDir,
      configDir: current.configDir,
      libraryDir: current.libraryDir,
      pendingConfigDir: pending ? validDirectory(pending.configDir) : '',
      pendingLibraryDir: pending ? validDirectory(pending.libraryDir) : '',
      migrationError: String(raw.lastError || ''),
      fatalError: !!(raw.fatalReadError || raw.fatalError),
      rebasePending: !!rebase,
      restartRequired: !!pending,
      cleanupPending: !!(raw.pendingCleanup && typeof raw.pendingCleanup === 'object'),
      cleanupError: String(raw.lastCleanupError || ''),
      cleanupPreserved: Array.isArray(raw.cleanupPreserved) ? raw.cleanupPreserved.slice(0, 20) : [],
      runtimeSweepPending: !!(raw.runtimeSweep && typeof raw.runtimeSweep === 'object'),
      runtimeSweepFailed: Number(raw.runtimeSweep && raw.runtimeSweep.failed) || 0,
      backupDir: validDirectory(raw.backupDir),
      backupKeep: Number(raw.backupKeep) || 0,
      backupLastAt: Number(raw.backupLastAt) || 0,
      backupLastSnapshotId: String(raw.backupLastSnapshotId || ''),
      locatorFile: locatorFile
    };
  }

  function ensureWritableDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const probe = path.join(directory, '.litboard-write-test-' + process.pid + '-' + Date.now());
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.rmSync(probe, { force: true });
  }

  function trustedTargets(raw, current) {
    const targets = [defaultDir, current.configDir, current.libraryDir];
    if (raw.pending) {
      const pendingConfig = validDirectory(raw.pending.configDir);
      const pendingLibrary = validDirectory(raw.pending.libraryDir);
      if (pendingConfig) targets.push(pendingConfig);
      if (pendingLibrary) targets.push(pendingLibrary);
    }
    return targets;
  }

  function assertAvailableTarget(directory, raw, current) {
    ensureWritableDirectory(directory);
    if (trustedTargets(raw, current).some(function (candidate) { return samePath(candidate, directory); })) return;
    const entries = fs.readdirSync(directory).filter(function (name) { return name.toLowerCase() !== 'desktop.ini'; });
    if (entries.length) throw new Error('目标目录必须为空，请新建一个专用目录：' + directory);
  }

  function assertSafeRelationship(source, target, label) {
    if (samePath(source, target)) return;
    if (insidePath(source, target) || insidePath(target, source)) {
      throw new Error(label + '不能放在当前目录的内部或外层，请选择独立目录');
    }
  }

  function copyConfig(source, target, sourceLibrary) {
    if (samePath(source, target) || !fs.existsSync(source)) return;
    fs.mkdirSync(target, { recursive: true });
    const libraryInsideConfig = !samePath(source, sourceLibrary) && insidePath(source, sourceLibrary);
    const sharedSource = samePath(source, sourceLibrary);
    fs.readdirSync(source, { withFileTypes: true }).forEach(function (entry) {
      const from = path.join(source, entry.name);
      if (samePath(from, locatorFile)) return;
      if (sharedSource && isLibraryEntry(entry.name)) return;
      if (RUNTIME_CONFIG_ENTRIES.has(entry.name)) return;
      if (libraryInsideConfig && (samePath(from, sourceLibrary) || insidePath(from, sourceLibrary) || insidePath(sourceLibrary, from))) return;
      fs.cpSync(from, path.join(target, entry.name), {
        recursive: true,
        force: true,
        filter: function (candidate) {
          const name = path.basename(candidate);
          return !RUNTIME_CONFIG_ENTRIES.has(name) && (!sharedSource || !isLibraryEntry(name)) && !samePath(candidate, locatorFile);
        }
      });
    });
  }

  function backupTargetLibrary(target) {
    const database = path.join(target, 'litboard.sqlite');
    if (!fs.existsSync(database)) return;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    fs.copyFileSync(database, path.join(target, 'litboard.sqlite.pre-path-change-' + stamp + '.bak'));
  }

  function copyLibrary(source, target) {
    if (samePath(source, target) || !fs.existsSync(source)) return;
    fs.mkdirSync(target, { recursive: true });
    backupTargetLibrary(target);
    fs.readdirSync(source, { withFileTypes: true }).forEach(function (entry) {
      if (!entry.isFile() || !isLibraryEntry(entry.name)) return;
      fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
    });
  }

  function dirTreeBytes(dir) {
    let total = 0;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirTreeBytes(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    });
    return total;
  }

  function assertCopiedEntry(from, to) {
    const sourceStat = fs.statSync(from);
    const targetStat = fs.statSync(to);
    if (sourceStat.isDirectory() !== targetStat.isDirectory() ||
        (!sourceStat.isDirectory() && sourceStat.size !== targetStat.size) ||
        (sourceStat.isDirectory() && dirTreeBytes(from) !== dirTreeBytes(to))) {
      throw new Error('数据目录复制校验失败：' + to);
    }
  }

  // 搬移语义下旧目录随后会被清空，复制结果必须先核对一遍（按字节量比对，控制成本）。
  // 目标目录在迁移前必须为空，所以遍历目标条目即可覆盖全部被复制的内容。
  function verifyMigratedCopy(current, target) {
    if (!samePath(current.configDir, target.configDir)) {
      fs.readdirSync(target.configDir, { withFileTypes: true }).forEach(function (entry) {
        assertCopiedEntry(path.join(current.configDir, entry.name), path.join(target.configDir, entry.name));
      });
    }
    if (!samePath(current.libraryDir, target.libraryDir)) {
      fs.readdirSync(current.libraryDir, { withFileTypes: true }).forEach(function (entry) {
        if (!entry.isFile() || !isLibraryEntry(entry.name)) return;
        const from = fs.statSync(path.join(current.libraryDir, entry.name));
        const to = fs.statSync(path.join(target.libraryDir, entry.name));
        if (from.size !== to.size) throw new Error('文献库复制校验失败：' + entry.name);
      });
    }
  }

  function rmdirIfEmpty(dir) {
    try { fs.rmdirSync(dir); } catch (error) {}
  }

  // 只判「目录树下没有任何文件」：用于收尾删除旧库目录嵌套在配置目录里时留下的空壳
  function dirIsEmpty(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).every(function (entry) {
      return entry.isDirectory() && dirIsEmpty(path.join(dir, entry.name));
    });
  }

  // 旧配置目录清理：只删「新目录里确实存在同名内容」的条目（证明已复制成功；库文件对照新库目录）
  // 和可再生的运行时缓存；定位文件永远只住在默认目录，绝不能动。
  // 返回是否全部清空，未清空则保留标记下次重试。
  // runtime 收集「删不动」的运行时缓存（多半被别的进程短暂占用，交给 runRuntimeSweep 补偿重试），
  // preserved 收集「新目录里没有对应副本」而原地保留的条目。后者不能静默放过：那正是「既不搬走
  // 也不提示」的小尾巴（例如会在原地自我更新的 litboard.sqlite-wal），要记账报给 UI。
  function cleanupOldConfigDir(dir, currentConfigDir, currentLibraryDir, failures, runtime, preserved) {
    let complete = true;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      if (entry.name === LOCATOR_FILE) return;
      const full = path.join(dir, entry.name);
      const isRuntime = RUNTIME_CONFIG_ENTRIES.has(entry.name);
      if (isRuntime && LIVE_SINGLETON_ENTRIES.has(entry.name) && samePath(dir, defaultDir)) return;
      try {
        if (!isRuntime) {
          const referenceDir = isLibraryEntry(entry.name) ? currentLibraryDir : currentConfigDir;
          // 参照目录就是被清理的目录本身 = 这些文件此刻仍在使用（典型是「只搬配置目录、文献库
          // 留在原处」，旧共享目录同时还是当前的库目录），绝不能按「参照存在」当作副本删掉。
          if (samePath(referenceDir, dir)) return;
          const reference = path.join(referenceDir, entry.name);
          if (!fs.existsSync(reference)) {
            // 空目录（旧库目录嵌套在配置目录里时留下的外壳）可以直接删，其余留在原处记账
            if (entry.isDirectory() && dirIsEmpty(full)) { fs.rmSync(full, { recursive: true, force: true }); return; }
            preserved.push(entry.name);
            return;
          }
          // 备份文件（*.bak）必须与新副本字节一致才算「已复制」；同名但内容不同
          // （例如新目录里的空库 .bak）不能当作已迁移——它是数据损坏时最后的恢复点
          if (/\.bak$/i.test(entry.name)) {
            let sameSize = false;
            try { sameSize = fs.statSync(reference).size === fs.statSync(full).size; } catch (error) {}
            if (!sameSize) { complete = false; failures.push(entry.name + '（备份内容不一致，保留）'); return; }
          }
        }
        fs.rmSync(full, { recursive: true, force: true });
      } catch (error) {
        if (isRuntime) { runtime.push(entry.name); return; }
        complete = false;
        failures.push(entry.name);
      }
    });
    rmdirIfEmpty(dir);
    return complete;
  }

  // 旧库目录清理：只删受管库文件（同名字件必须已在新库目录出现），来源不明的文件一律不碰。
  function cleanupOldLibraryDir(dir, currentLibraryDir, failures, runtime, preserved) {
    let complete = true;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
      if (!entry.isFile() || !isLibraryEntry(entry.name)) return;
      const full = path.join(dir, entry.name);
      try {
        const reference = path.join(currentLibraryDir, entry.name);
        // -wal / -shm 这类伴生文件会随新库打开自我更新甚至消失，不能当作「没迁过去」
        if (!fs.existsSync(reference)) { preserved.push(entry.name); return; }
        // 备份文件（*.bak）须与新副本字节一致；否则保留作为恢复点
        if (/\.bak$/i.test(entry.name)) {
          let sameSize = false;
          try { sameSize = fs.statSync(reference).size === fs.statSync(full).size; } catch (error) {}
          if (!sameSize) { complete = false; failures.push(entry.name + '（备份内容不一致，保留）'); return; }
        }
        fs.rmSync(full, { force: true });
      } catch (error) {
        if (RUNTIME_CONFIG_ENTRIES.has(entry.name)) { runtime.push(entry.name); return; }
        complete = false;
        failures.push(entry.name);
      }
    });
    rmdirIfEmpty(dir);
    return complete;
  }

  // 记账：删不动的运行时缓存登记给 runRuntimeSweep 在启动后与运行期补删——不这么做，旧目录
  // 会永久留下一个 0 字节 lockfile 之类的小尾巴（清空标记一删就再没人管它们了）。
  // 原地保留的条目（新目录无对应副本）只在状态里如实列出，不阻塞任何操作。
  function recordCleanupNotes(raw, dirs, runtime, preserved) {
    if (runtime.length) {
      const sweepDirs = raw.runtimeSweep && Array.isArray(raw.runtimeSweep.dirs) ? raw.runtimeSweep.dirs.slice() : [];
      dirs.forEach(function (dir) {
        if (!dir || !fs.existsSync(dir)) return;
        if (sweepDirs.some(function (existing) { return samePath(existing, dir); })) return;
        sweepDirs.push(dir);
      });
      if (sweepDirs.length) raw.runtimeSweep = { dirs: sweepDirs, failed: 0, names: runtime.slice(0, 10) };
    }
    if (preserved.length) raw.cleanupPreserved = preserved.slice(0, 20);
    else delete raw.cleanupPreserved;
  }

  // 运行时缓存的补偿清理：只碰可再生的缓存名字（绝不碰数据文件与定位文件），删不掉就留着下次再试。
  // 返回是否改动过 raw（调用方据此决定要不要落盘）。
  function runRuntimeSweep(raw) {
    const sweep = raw.runtimeSweep && typeof raw.runtimeSweep === 'object' ? raw.runtimeSweep : null;
    if (!sweep) return false;
    const dirs = (Array.isArray(sweep.dirs) ? sweep.dirs : []).map(validDirectory).filter(Boolean);
    const remaining = [];
    const failedNames = [];
    dirs.forEach(function (dir) {
      if (!fs.existsSync(dir)) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        failedNames.push(dir);
        remaining.push(dir);
        return;
      }
      let stuck = false;
      entries.forEach(function (entry) {
        if (!RUNTIME_CONFIG_ENTRIES.has(entry.name)) return;
        // 默认目录里的单例锁由当前进程自己持有，删不掉也不该删
        if (LIVE_SINGLETON_ENTRIES.has(entry.name) && samePath(dir, defaultDir)) return;
        try {
          fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
        } catch (error) {
          stuck = true;
          failedNames.push(entry.name);
        }
      });
      if (stuck) remaining.push(dir);
      else rmdirIfEmpty(dir);
    });
    if (remaining.length) {
      raw.runtimeSweep = { dirs: remaining, failed: failedNames.length, names: failedNames.slice(0, 10) };
    } else {
      delete raw.runtimeSweep;
    }
    return true;
  }

  // 清空迁移前记录的旧目录。配置目录搬移必须在路径重定位（rebase）成功之后才允许调用，
  // 否则附件引用还指着旧目录时清空它就丢了兜底。
  function runPendingCleanup(raw) {
    const pending = raw.pendingCleanup && typeof raw.pendingCleanup === 'object' ? raw.pendingCleanup : null;
    if (!pending) return;
    const current = rawCurrent(raw);
    const oldConfig = validDirectory(pending.configDir);
    const oldLibrary = validDirectory(pending.libraryDir);
    const failures = [];
    const runtime = [];
    const preserved = [];
    let complete = true;
    try {
      const configMoved = !!(oldConfig && !samePath(oldConfig, current.configDir) && fs.existsSync(oldConfig));
      const libraryMoved = !!(oldLibrary && !samePath(oldLibrary, current.libraryDir) && fs.existsSync(oldLibrary));
      // 两个旧目录同址且都搬走时，配置目录那一遍已经按 currentLibraryDir 比对过库文件，不必重复；
      // 只搬库（配置原地不动）或旧库嵌套在旧配置目录里时，必须先走库目录这一遍：
      // 前者是唯一会清库的路径，后者要先把嵌套目录掏空，配置目录里那一层才会变成可删的空壳。
      const sharedOldDir = !!(oldConfig && oldLibrary && samePath(oldConfig, oldLibrary));
      if (libraryMoved && !(sharedOldDir && configMoved)) {
        complete = cleanupOldLibraryDir(oldLibrary, current.libraryDir, failures, runtime, preserved) && complete;
      }
      if (configMoved) {
        complete = cleanupOldConfigDir(oldConfig, current.configDir, current.libraryDir, failures, runtime, preserved) && complete;
      }
    } catch (error) {
      complete = false;
      failures.push(String(error && error.message || error));
    }
    if (complete) {
      delete raw.pendingCleanup;
      delete raw.lastCleanupError;
      // 标记一删就再没有别的机制盯着这些残留了，此刻必须记账
      recordCleanupNotes(raw, [oldConfig, oldLibrary], runtime, preserved);
    } else {
      const unique = failures.filter(function (name, index) { return failures.indexOf(name) === index; });
      raw.lastCleanupError = '旧数据目录清理未完成（将在下次启动自动重试）：' + unique.join('；');
    }
  }

  function migrate(current, target) {
    [current.configDir, current.libraryDir].forEach(function (directory) {
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        throw new Error('当前数据目录不存在或不可用：' + directory);
      }
    });
    ensureWritableDirectory(target.configDir);
    if (!samePath(target.configDir, target.libraryDir)) ensureWritableDirectory(target.libraryDir);
    assertSafeRelationship(current.configDir, target.configDir, '配置目录');
    assertSafeRelationship(current.libraryDir, target.libraryDir, '文献库目录');
    copyConfig(current.configDir, target.configDir, current.libraryDir);
    copyLibrary(current.libraryDir, target.libraryDir);
    verifyMigratedCopy(current, target);
  }

  function assertTargetsDoNotCrossSources(current, target) {
    // 首次安装时配置与文献库共用一个目录；把其中一类拆到新目录时，
    // 保留另一类在原目录是安全的，不应被“交叉源”规则误拦截。
    if (samePath(current.configDir, current.libraryDir)) return;
    // 两个目标明确选择同一目录时属于显式合并，可以复用任一当前目录。
    if (samePath(target.configDir, target.libraryDir) &&
        (samePath(target.configDir, current.configDir) || samePath(target.configDir, current.libraryDir))) return;
    const sources = [
      { name: '配置目录', value: current.configDir },
      { name: '文献库目录', value: current.libraryDir }
    ];
    const targets = [
      { name: '配置目录', value: target.configDir },
      { name: '文献库目录', value: target.libraryDir }
    ];
    targets.forEach(function (candidate) {
      sources.forEach(function (source) {
        if (candidate.name === source.name) return;
        if (samePath(candidate.value, source.value) || insidePath(candidate.value, source.value) || insidePath(source.value, candidate.value)) {
          throw new Error(candidate.name + '不能覆盖或嵌套当前' + source.name);
        }
      });
    });
  }

  function prepareAtStartup() {
    fs.mkdirSync(defaultDir, { recursive: true });
    const raw = readRaw();
    let current = rawCurrent(raw);
    if (raw.fatalReadError) {
      runtimeState = publicState(raw, current);
      return runtimeState;
    }
    if ((Object.prototype.hasOwnProperty.call(raw, 'configDir') && !validDirectory(raw.configDir)) ||
        (Object.prototype.hasOwnProperty.call(raw, 'libraryDir') && !validDirectory(raw.libraryDir))) {
      raw.lastError = '路径定位文件中的当前数据目录无效';
      raw.fatalError = true;
      writeJsonAtomic(locatorFile, raw);
      runtimeState = publicState(raw, current);
      return runtimeState;
    }
    const pendingConfig = raw.pending && validDirectory(raw.pending.configDir);
    const pendingLibrary = raw.pending && validDirectory(raw.pending.libraryDir);
    let invalidPending = false;
    if (raw.pending && (!pendingConfig || !pendingLibrary)) {
      invalidPending = true;
      raw.lastError = '待迁移的数据目录配置无效，请重新选择两个绝对路径';
      writeJsonAtomic(locatorFile, raw);
    } else if (pendingConfig && pendingLibrary) {
      const target = { configDir: pendingConfig, libraryDir: pendingLibrary };
      try {
        assertTargetsDoNotCrossSources(current, target);
        migrate(current, target);
        if (!samePath(current.configDir, target.configDir)) {
          raw.pendingRebase = { fromConfigDir: current.configDir, toConfigDir: target.configDir };
        }
        // 搬移语义：迁移成功即记下旧目录，等到安全时机清空——配置目录搬移必须等
        // 路径重定位（rebase）完成，否则 rebase 失败时旧目录是附件引用的最后兜底。
        if (!samePath(current.configDir, target.configDir) || !samePath(current.libraryDir, target.libraryDir)) {
          raw.pendingCleanup = {
            configDir: current.configDir,
            libraryDir: current.libraryDir,
            requestedAt: new Date().toISOString()
          };
        }
        raw.version = LOCATOR_VERSION;
        raw.configDir = target.configDir;
        raw.libraryDir = target.libraryDir;
        raw.lastMigrationAt = new Date().toISOString();
        delete raw.pending;
        delete raw.lastError;
        delete raw.fatalError;
        writeJsonAtomic(locatorFile, raw);
        current = target;
      } catch (error) {
        raw.lastError = '数据目录迁移失败：' + String(error && error.message || error);
        delete raw.fatalError;
        writeJsonAtomic(locatorFile, raw);
      }
    }
    try {
      if (!fs.statSync(current.configDir).isDirectory() || !fs.statSync(current.libraryDir).isDirectory()) {
        throw new Error('配置的数据目录不是文件夹');
      }
      if (!raw.pending && !invalidPending) {
        delete raw.lastError;
      }
      delete raw.fatalError;
      writeJsonAtomic(locatorFile, raw);
    } catch (error) {
      raw.lastError = '配置的数据目录不可用：' + String(error && error.message || error);
      raw.fatalError = true;
      writeJsonAtomic(locatorFile, raw);
    }
    // 搬移收尾：没有待重定位任务时立即清空旧目录（库目录单独搬移、或上次清理中断的重试）；
    // 配置目录搬移的清理由 main.js 在 rebase 成功后经 completeRebase() 触发。
    // 运行时缓存的补偿删除放在最后：上一轮迁移可能只差一个 lockfile 没删掉。
    if (!raw.pendingRebase && (raw.pendingCleanup || raw.runtimeSweep)) {
      if (raw.pendingCleanup) runPendingCleanup(raw);
      runRuntimeSweep(raw);
      writeJsonAtomic(locatorFile, raw);
    }
    runtimeState = publicState(raw, current);
    return runtimeState;
  }

  function getState() {
    const raw = readRaw();
    const current = runtimeState || publicState(raw, rawCurrent(raw));
    return publicState(raw, { configDir: current.configDir, libraryDir: current.libraryDir });
  }

  function stage(value) {
    const raw = readRaw();
    const current = runtimeState || publicState(raw, rawCurrent(raw));
    if (current.fatalError || (current.migrationError && !raw.pending)) throw new Error(current.migrationError);
    if (raw.pendingRebase) throw new Error('上一次目录迁移尚未完成，请重启 LitBoard 后再试');
    const configDir = validDirectory(value && value.configDir);
    const libraryDir = validDirectory(value && value.libraryDir);
    if (!configDir || !libraryDir) throw new Error('请选择有效的绝对目录');
    if (!samePath(configDir, libraryDir) && (insidePath(configDir, libraryDir) || insidePath(libraryDir, configDir))) {
      throw new Error('配置目录和文献库目录应相同或彼此独立，不能互相嵌套');
    }
    assertSafeRelationship(current.configDir, configDir, '配置目录');
    assertSafeRelationship(current.libraryDir, libraryDir, '文献库目录');
    if (samePath(configDir, current.configDir) && samePath(libraryDir, current.libraryDir)) {
      delete raw.pending;
      delete raw.lastError;
      writeJsonAtomic(locatorFile, raw);
      return Object.assign({ changed: false }, getState());
    }
    // 上一轮搬移的旧目录还没清空时再次改路径，会让 pendingCleanup 指向被覆盖而永远泄漏
    if (raw.pendingCleanup) {
      throw new Error('上一次迁移的旧目录尚未清理完成，请重启 LitBoard 后再试');
    }
    assertTargetsDoNotCrossSources(current, { configDir: configDir, libraryDir: libraryDir });
    assertAvailableTarget(configDir, raw, current);
    if (!samePath(libraryDir, configDir)) assertAvailableTarget(libraryDir, raw, current);
    raw.version = LOCATOR_VERSION;
    raw.pending = { configDir: configDir, libraryDir: libraryDir, requestedAt: new Date().toISOString() };
    delete raw.lastError;
    writeJsonAtomic(locatorFile, raw);
    return Object.assign({ changed: true }, getState());
  }

  function pendingRebase() {
    const raw = readRaw();
    if (!raw.pendingRebase) return null;
    const fromConfigDir = validDirectory(raw.pendingRebase.fromConfigDir);
    const toConfigDir = validDirectory(raw.pendingRebase.toConfigDir);
    return fromConfigDir && toConfigDir ? { fromConfigDir: fromConfigDir, toConfigDir: toConfigDir } : null;
  }

  function completeRebase() {
    const raw = readRaw();
    delete raw.pendingRebase;
    // 路径重定位成功，旧配置目录里的受管文件不再是引用兜底，此刻才允许清空旧目录
    if (raw.pendingCleanup) runPendingCleanup(raw);
    // 紧接着补一次运行时缓存删除并记账：此刻多半正被上一个正在退出的进程占用（Chromium 的
    // lockfile），删不掉就登记下来交给 retryCleanup 在运行期继续补删。
    runRuntimeSweep(raw);
    writeJsonAtomic(locatorFile, raw);
    runtimeState = publicState(raw, rawCurrent(raw));
    return runtimeState;
  }

  /**
   * 运行期补偿清理：迁移刚完成时，旧目录里往往还剩被别的进程短暂占用的运行时缓存
   * （典型就是 Chromium 的 lockfile），隔几秒再删就没了。main.js 在启动后按几次延时调用它。
   * 无待处理事项时不落盘，直接返回当前状态。
   */
  function retryCleanup() {
    const raw = readRaw();
    if (raw.pendingRebase) return publicState(raw, rawCurrent(raw));
    let touched = false;
    if (raw.pendingCleanup) { runPendingCleanup(raw); touched = true; }
    if (runRuntimeSweep(raw)) touched = true;
    if (touched) writeJsonAtomic(locatorFile, raw);
    runtimeState = publicState(raw, rawCurrent(raw));
    return runtimeState;
  }

  /**
   * 设置完整备份根目录（持久化到 data-paths.json）。
   * 约束：绝对路径、必须可写、不能与配置目录/文献库目录相同或互相嵌套。
   */
  function stageBackupDir(directory) {
    const raw = readRaw();
    const current = runtimeState || publicState(raw, rawCurrent(raw));
    const target = validDirectory(directory);
    if (!target) throw new Error('请选择有效的绝对目录');
    ensureWritableDirectory(target);
    // 备份目录必须与配置目录/文献库目录相互独立：相同或互相嵌套都拒绝
    if (samePath(current.configDir, target) || samePath(current.libraryDir, target)) {
      throw new Error('备份目录不能与配置目录或文献库目录相同，请选择独立目录');
    }
    assertSafeRelationship(current.configDir, target, '备份目录');
    assertSafeRelationship(current.libraryDir, target, '备份目录');
    raw.backupDir = target;
    raw.version = LOCATOR_VERSION;
    writeJsonAtomic(locatorFile, raw);
    runtimeState = publicState(raw, rawCurrent(raw));
    return runtimeState;
  }

  /**
   * 设置完整备份保留份数（1–30；传 0 或 null 表示恢复默认）。
   * 只改轮换上限，不触发任何删除：多出来的旧快照要等下一次成功发布新快照时才被清理。
   */
  function stageBackupKeep(value) {
    const raw = readRaw();
    const current = runtimeState || publicState(raw, rawCurrent(raw));
    if (!current.backupDir) throw new Error('请先设置完整备份目录');
    const count = value == null || value === '' ? 0 : Number(value);
    if (count !== 0 && (!Number.isFinite(count) || count < 1 || count > 30)) {
      throw new Error('保留份数需要在 1–30 之间');
    }
    if (count === 0) delete raw.backupKeep;
    else raw.backupKeep = Math.round(count);
    raw.version = LOCATOR_VERSION;
    writeJsonAtomic(locatorFile, raw);
    runtimeState = publicState(raw, rawCurrent(raw));
    return runtimeState;
  }

  /** 记录最近一次成功快照（备份管理模块发布后调用） */
  function markBackupSuccess(at, snapshotId) {
    const raw = readRaw();
    raw.backupLastAt = Number(at) || Date.now();
    raw.backupLastSnapshotId = String(snapshotId || '');
    writeJsonAtomic(locatorFile, raw);
    return publicState(raw, rawCurrent(raw));
  }

  return {
    prepareAtStartup: prepareAtStartup,
    getState: getState,
    stage: stage,
    stageBackupDir: stageBackupDir,
    stageBackupKeep: stageBackupKeep,
    markBackupSuccess: markBackupSuccess,
    pendingRebase: pendingRebase,
    completeRebase: completeRebase,
    retryCleanup: retryCleanup,
    rebaseWorkspacePaths: rebaseWorkspacePaths,
    paths: { defaultDir: defaultDir, locatorFile: locatorFile }
  };
}

module.exports = { createDataPathManager, LOCATOR_FILE, isLibraryEntry, samePath, insidePath };
