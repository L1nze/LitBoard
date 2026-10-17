/* LitBoard 工作区装载与保存：持有已确认签名、三方合并 base 和保存队列。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitWorkspaceStore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var revision = 0;
    var persistedSignatures = null;
    var baseEntities = null;
    var saveChain = Promise.resolve(true);
    var model = options.model;
    // trailing 去抖：编辑风暴时把连续 save() 合并成一次落库（全库签名+序列化是大开销）。
    // maxWait 保证最长延迟；applyIncoming / waitForIdle 走立即路径，绝不因去抖丢数据。
    var SAVE_DEBOUNCE_MS = options.saveDebounceMs != null ? options.saveDebounceMs : 500;
    var SAVE_MAX_WAIT_MS = options.saveMaxWaitMs != null ? options.saveMaxWaitMs : 2000;
    var pendingSave = null; // { skipSyncAll, promise, resolve, timer, maxTimer }

    function payload() {
      var state = options.state;
      return {
        papers: state.papers,
        notes: state.notes,
        folders: state.folders.concat(state.folderTombstones),
        savedSearches: state.savedSearches.concat(state.savedSearchTombstones),
        tagColors: state.tagColors,
        tagColorRecords: state.tagColorRecords
      };
    }
    function cloneAll(workspace) {
      var out = { papers: {}, notes: {}, folders: {}, savedSearches: {}, tagColorRecords: {} };
      function cloneList(target, list, keyOf) {
        (list || []).forEach(function (item) {
          if (!item) return;
          try { target[keyOf(item)] = JSON.parse(JSON.stringify(item)); } catch (error) {}
        });
      }
      cloneList(out.papers, workspace && workspace.papers, function (item) { return item.id; });
      cloneList(out.notes, workspace && workspace.notes, function (item) { return item.id; });
      cloneList(out.folders, workspace && workspace.folders, function (item) { return item.id; });
      cloneList(out.savedSearches, workspace && workspace.savedSearches, function (item) { return item.id; });
      cloneList(out.tagColorRecords, workspace && workspace.tagColorRecords, function (item) { return item.tag; });
      return out;
    }
    function replaceMemory(workspace) {
      var state = options.state;
      state.papers = workspace.papers;
      state.notes = workspace.notes || [];
      state.folders = (workspace.folders || []).filter(function (folder) { return !folder.deletedAt; });
      state.folderTombstones = (workspace.folders || []).filter(function (folder) { return !!folder.deletedAt; });
      state.savedSearches = (workspace.savedSearches || []).filter(function (search) { return !search.deletedAt; });
      state.savedSearchTombstones = (workspace.savedSearches || []).filter(function (search) { return !!search.deletedAt; });
      state.tagColors = workspace.tagColors || {};
      state.tagColorRecords = workspace.tagColorRecords || [];
    }
    function confirmCurrent() {
      var workspace = payload();
      persistedSignatures = model.workspaceSignatures(workspace);
      baseEntities = cloneAll(workspace);
    }
    function refreshBase(workspace, oldBase) {
      if (!baseEntities) { baseEntities = cloneAll(workspace); return; }
      var signatures = model.workspaceSignatures(workspace);
      ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'].forEach(function (collection) {
        var keyOf = collection === 'tagColorRecords' ? function (item) { return item.tag; } : function (item) { return item.id; };
        var seen = {};
        (workspace[collection] || []).forEach(function (item) {
          var key = keyOf(item);
          seen[key] = true;
          if (oldBase && oldBase[collection] && oldBase[collection][key] === signatures[collection][key]) return;
          try { baseEntities[collection][key] = JSON.parse(JSON.stringify(item)); } catch (error) {}
        });
        Object.keys(baseEntities[collection]).forEach(function (key) {
          if (!seen[key]) delete baseEntities[collection][key];
        });
      });
    }
    function signaturesContain(actual, expected) {
      if (!actual || !expected) return false;
      var collections = ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'];
      for (var i = 0; i < collections.length; i++) {
        var name = collections[i];
        var expectedMap = expected[name] || {};
        var actualMap = actual[name] || {};
        var keys = Object.keys(expectedMap);
        for (var j = 0; j < keys.length; j++) {
          if (actualMap[keys[j]] !== expectedMap[keys[j]]) return false;
        }
      }
      return true;
    }
    function track(promise) {
      saveChain = saveChain.then(function () { return promise; }, function () { return promise; })
        .then(function (result) { return result !== false; }, function () { return false; });
      return promise;
    }
    /** 单遍完成「touch 脏实体 + 只深克隆脏实体」（取代 touchWorkspaceChanges + 全库 JSON 克隆）：
     *  - 脏判定与 model.touchWorkspaceChanges 同口径：无上次确认签名（首轮，与旧实现
     *    一致不 touch、全量克隆）或签名不一致；
     *  - 干净实体传引用即可——发送的是 normalizeWorkspace 的产物（全新对象图，它内部的
     *    migrateLegacyPaperNotes/projectPaperNotes 只作用于自建数组，不改写入参），内存态
     *    不会被改写；脏实体克隆一份再 touch，避免「已发送快照」与内存共享同一对象。
     *  克隆失败不吞错：payload 缺实体会被库端按「保留库内行」处理、静默丢本地修改，
     *  不如让整次保存失败并走 toast 上报。 */
    function cloneDirtyAndTouch(workspace, previous, now) {
      var out = {
        papers: [], notes: [], folders: [], savedSearches: [], tagColorRecords: [],
        tagColors: workspace.tagColors
      };
      ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'].forEach(function (collection) {
        var prevMap = previous && previous[collection];
        var keyOf = collection === 'tagColorRecords' ? function (item) { return item.tag; } : function (item) { return item.id; };
        (workspace[collection] || []).forEach(function (item) {
          if (!item) return;
          if (prevMap && prevMap[keyOf(item)] === model.entitySignature(item)) {
            out[collection].push(item); // 干净：传引用，normalize 会产出全新副本
            return;
          }
          if (previous) item.updatedAt = now;
          out[collection].push(JSON.parse(JSON.stringify(item)));
        });
      });
      return out;
    }
    function persistDesktop(skipSync, desktop) {
      var workspace = payload();
      workspace = cloneDirtyAndTouch(workspace, persistedSignatures, Date.now());
      // 与 saveState 同口径归一化后再签名/发送：库端落库前会跑同一套 normalizeWorkspace
      // （重投影 paper.notes、过滤墓碑文件夹的 folderIds、迁移旧笔记等），若用内存原始
      // 状态算签名，任何兼容投影漂移都会让写后校验误判失败且锚点停摆、后续保存全挂。
      // 不传 idFactory，与 db.js saveState 的 normalizeWorkspace(value) 完全一致。
      workspace = model.normalizeWorkspace(workspace);
      var nextSignatures = model.workspaceSignatures(workspace);
      // 签名直传：主进程校验通过则跳过整库重签（校验失败自动回退重算，不影响正确性）。
      // preload 的 saveLibrary 只透传 workspace/base 两个字段，因此捎带在 workspace 上
      // （ipc/library.js 会把它提升回顶层 nextSignatures 传给 db.saveState）。
      workspace.nextSignatures = nextSignatures;
      var oldBase = persistedSignatures;
      return desktop.saveLibrary(workspace, oldBase).then(function (result) {
        if (result && result.conflicts && result.conflicts.length) {
          // 解析前保留已确认祖先：未提交的本地内容不能成为三方合并的 base。
          // 取消时也不推进签名，否则重试会认为库端未变并直接覆盖外部修改。
          return options.resolveConflicts(result.conflicts, baseEntities).then(function (resolved) {
            if (!resolved) {
              options.toast(options.T('⚠ 保存冲突未解决，本地修改已保留，请重试'));
              return false;
            }
            // 本轮非冲突项已落库；冲突项的已确认内容则是库端返回的实体。
            // 先推进这两类祖先，再重提合并结果，采用库端版本时也不会遗留旧 base。
            refreshBase(workspace, oldBase);
            result.conflicts.forEach(function (conflict) {
              if (conflict.entity) {
                baseEntities[conflict.collection][conflict.id] = JSON.parse(JSON.stringify(conflict.entity));
              } else {
                delete baseEntities[conflict.collection][conflict.id];
              }
            });
            persistedSignatures = result.signatures || oldBase;
            return persistDesktop(skipSync, desktop);
          });
        }
        if (!result || !signaturesContain(result.signatures, nextSignatures)) {
          // saveState 已经提交，拒绝推进锚点只会死锁（每次保存都失败直到重启）：
          // 先把锚点推进到数据库返回的真实签名，让下一次保存有机会自愈，错误照常上报。
          if (result && result.signatures) persistedSignatures = result.signatures;
          throw new Error(options.T('SQLite 写入后校验失败：数据库返回的内容签名与当前工作区不一致'));
        }
        persistedSignatures = (result && result.signatures) || nextSignatures;
        refreshBase(workspace, oldBase);
        if (!skipSync) options.scheduleSync();
        return true;
      }).catch(function (error) {
        options.toast(options.T('⚠ 本地数据保存失败：') + (error && error.message || error));
        return false;
      });
    }
    function enqueuePersist(skipSync) {
      var desktop = options.desktop();
      if (desktop) {
        var pending = saveChain.then(function () { return persistDesktop(skipSync, desktop); });
        saveChain = pending.then(function (result) { return result !== false; }, function () { return false; });
        return pending;
      }
      var workspace = payload();
      if (persistedSignatures) model.touchWorkspaceChanges(workspace, persistedSignatures, Date.now());
      var oldBase = persistedSignatures;
      var ok = true;
      try {
        options.localStorage.setItem(options.storeKey, JSON.stringify(workspace));
        persistedSignatures = model.workspaceSignatures(workspace);
        refreshBase(workspace, oldBase);
        if (!skipSync) options.scheduleSync();
      } catch (error) {
        ok = false;
        options.toast(options.T('⚠ 本地存储已满，数据未能保存，请导出 JSON 备份'));
      }
      return track(Promise.resolve(ok));
    }
    /** 去抖冲刷：立即把挂起的合并保存入队（清除两个定时器）。同步入队，返回后
     *  saveChain 已包含本轮落库——waitForIdle 先调它再返回链条即可等完。 */
    function flushPendingSave() {
      if (!pendingSave) return;
      var pending = pendingSave;
      pendingSave = null;
      clearTimeout(pending.timer);
      clearTimeout(pending.maxTimer);
      try {
        var run = enqueuePersist(pending.skipSyncAll);
        run.then(function (result) { pending.resolve(result !== false); }, function () { pending.resolve(false); });
      } catch (error) {
        pending.resolve(false);
      }
    }
    function prepareForSave() {
      ++revision;
      model.assignCitationKeys(options.state.papers);
      if (options.clearQueryCache) options.clearQueryCache();
    }
    /** 立即落库（绕过去抖）：同步应用（applyIncoming）等不能延迟的路径用。 */
    function saveNow(skipSync) {
      prepareForSave();
      return enqueuePersist(skipSync);
    }
    function save(skipSync) {
      prepareForSave();
      if (SAVE_DEBOUNCE_MS > 0 && options.desktop()) {
        if (!pendingSave) {
          pendingSave = { skipSyncAll: true, resolve: null, promise: null, timer: 0, maxTimer: 0 };
          pendingSave.promise = new Promise(function (resolve) { pendingSave.resolve = resolve; });
          pendingSave.maxTimer = setTimeout(flushPendingSave, SAVE_MAX_WAIT_MS);
        }
        // skipSync 语义：合并窗口内只要有一次调用要触发同步，收尾就不跳过
        pendingSave.skipSyncAll = pendingSave.skipSyncAll && !!skipSync;
        clearTimeout(pendingSave.timer);
        pendingSave.timer = setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS);
        return pendingSave.promise;
      }
      return enqueuePersist(skipSync);
    }
    function load() {
      var desktop = options.desktop();
      if (desktop) {
        return desktop.loadLibrary().then(function (value) {
          replaceMemory(model.normalizeWorkspace(value, options.uid));
          confirmCurrent();
          options.onLoad(true);
        }).catch(function (error) {
          replaceMemory(model.normalizeWorkspace({}, options.uid));
          confirmCurrent();
          options.onLoad(false, error);
        });
      }
      try {
        var raw = options.localStorage.getItem(options.storeKey);
        replaceMemory(model.normalizeWorkspace(raw ? JSON.parse(raw) : {}, options.uid));
      } catch (error) {
        replaceMemory(model.normalizeWorkspace({}, options.uid));
      }
      confirmCurrent();
      options.onLoad(true);
      return Promise.resolve();
    }
    function applyIncoming(value, skipSync) {
      var workspace = model.normalizeWorkspace(value, options.uid);
      var previous = persistedSignatures;
      replaceMemory(workspace);
      persistedSignatures = previous;
      return saveNow(skipSync).then(function (ok) {
        if (!ok) throw new Error(options.T('同步结果未能写入本地 SQLite，已停止显示完成状态'));
        return workspace;
      });
    }
    function replace(workspace) {
      replaceMemory(model.normalizeWorkspace(workspace, options.uid));
      var desktop = options.desktop();
      if (desktop && desktop.replaceLibrary) {
        return desktop.replaceLibrary(payload()).then(function () {
          confirmCurrent();
          return true;
        });
      }
      return save(true);
    }
    return {
      applyIncoming: applyIncoming,
      getBase: function () { return baseEntities; },
      getRevision: function () { return revision; },
      load: load,
      payload: payload,
      replace: replace,
      save: save,
      saveNow: saveNow,
      // 等全部已排队的本地保存落库（before-quit / 批量导入收尾都靠它兜底）：
      // 先把去抖窗口里挂起的合并保存立即入队，再返回链条——绝不因去抖漏存。
      waitForIdle: function () { flushPendingSave(); return saveChain; }
    };
  }

  return { create: create };
});
