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
    function persistDesktop(skipSync, desktop) {
      var workspace = payload();
      if (persistedSignatures) model.touchWorkspaceChanges(workspace, persistedSignatures, Date.now());
      workspace = JSON.parse(JSON.stringify(workspace));
      // 与 saveState 同口径归一化后再签名/发送：库端落库前会跑同一套 normalizeWorkspace
      // （重投影 paper.notes、过滤墓碑文件夹的 folderIds、迁移旧笔记等），若用内存原始
      // 状态算签名，任何兼容投影漂移都会让写后校验误判失败且锚点停摆、后续保存全挂。
      // 不传 idFactory，与 db.js saveState 的 normalizeWorkspace(value) 完全一致。
      workspace = model.normalizeWorkspace(workspace);
      var nextSignatures = model.workspaceSignatures(workspace);
      var oldBase = persistedSignatures;
      return desktop.saveLibrary(workspace, oldBase).then(function (result) {
        if (result && result.conflicts && result.conflicts.length) {
          persistedSignatures = result.signatures || oldBase;
          refreshBase(workspace, oldBase);
          return options.resolveConflicts(result.conflicts, baseEntities).then(function (resolved) {
            if (!resolved) {
              options.toast(options.T('⚠ 保存冲突未解决，本地修改已保留，请重试'));
              return false;
            }
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
    function save(skipSync) {
      ++revision;
      model.assignCitationKeys(options.state.papers);
      if (options.clearQueryCache) options.clearQueryCache();
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
      return save(skipSync).then(function (ok) {
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
      waitForIdle: function () { return saveChain; }
    };
  }

  return { create: create };
});
