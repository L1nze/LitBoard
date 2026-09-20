/* LitBoard 同步合并 v4：计划式三方合并 + v3 LWW 读取兼容（浏览器 / Node 共用）
 *
 * 规则：
 * - 每个实体按 updatedAt 取新者；deletedAt 参与比较（删除时间 > 对方更新时间则删除传播）；
 * - 文献由胜者整体覆盖，集合字段不做并集，避免已删除内容复活；
 * - 远端文献胜出时，仅按附件 id 回填本机 path / syncSignature；
 * - 文件夹、智能搜索、标签颜色记录均使用同一套 LWW 与墓碑规则；
 * - 远端覆盖本地时记录 conflict（含被覆盖的本地快照），供同步报告展示。
 */
(function (root, factory) {
  var model = typeof module === 'object' && module.exports ? require('./model.js') : root.LitModel;
  var merge = typeof module === 'object' && module.exports ? require('./merge.js') : root.LitMerge;
  var api = factory(model, merge);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitSync = api;
})(typeof window !== 'undefined' ? window : null, function (model, merge) {
  'use strict';
  var T = (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) || function (s) { return s == null ? '' : String(s); }; // i18n：中文源串为键，译文见 js/i18n-en.js

  var SYNC_VERSION = 6;
  var LEGACY_SYNC_VERSION = 3;

  function entityTime(entity) {
    return Math.max(entity && entity.updatedAt || 0, entity && entity.deletedAt || 0);
  }

  function lwwWinner(local, remote) {
    var localT = entityTime(local);
    var remoteT = entityTime(remote);
    if (localT !== remoteT) return localT > remoteT ? local : remote;
    if (!!local.deletedAt !== !!remote.deletedAt) return local.deletedAt ? local : remote;
    return local;
  }

  function withoutLocalAttachmentFields(paper) {
    var clean = Object.assign({}, paper, { pdfPath: '', pdfSyncSignature: '' });
    clean.attachments = (paper && paper.attachments || []).map(function (attachment) {
      return Object.assign({}, attachment, { path: '', syncSignature: '' });
    });
    clean.pdfAnnotations = (paper && paper.pdfAnnotations || []).map(function (annotation) {
      return annotation.type === 'snapshot' ? Object.assign({}, annotation, { imagePath: '' }) : annotation;
    });
    return clean;
  }

  function cloudPaper(paper) {
    var clean = Object.assign({}, paper);
    delete clean.pdfPath;
    delete clean.pdfSyncSignature;
    clean.attachments = (paper && paper.attachments || []).map(function (attachment) {
      var cloudAttachment = Object.assign({}, attachment);
      delete cloudAttachment.path;
      delete cloudAttachment.syncSignature;
      return cloudAttachment;
    });
    clean.pdfAnnotations = (paper && paper.pdfAnnotations || []).map(function (annotation) {
      if (annotation.type !== 'snapshot') return annotation;
      var cloudAnnotation = Object.assign({}, annotation);
      delete cloudAnnotation.imagePath;
      return cloudAnnotation;
    });
    return clean;
  }

  /* v4 比较时不重复比较由 attachments 投影得到的旧单 PDF 字段；应用
   * 结果仍交给 model.normalizePaper 重投影，保持旧调用方兼容。 */
  function planCloudPaper(paper) {
    var clean = cloudPaper(paper);
    delete clean.pdfFileName;
    delete clean.pdfFingerprint;
    delete clean.pdfCloudName;
    return clean;
  }

  /* notes（v5）：assets[].path 是本机路径，不上云；回灌时按 fileName+cloudName 恢复 */
  function cloudNote(note) {
    var clean = Object.assign({}, note);
    clean.assets = (note && note.assets || []).map(function (asset) {
      var cloudAsset = Object.assign({}, asset);
      delete cloudAsset.path;
      return cloudAsset;
    });
    return clean;
  }

  function restoreLocalNoteFields(remote, local) {
    var merged = Object.assign({}, remote);
    merged.assets = (remote.assets || []).map(function (asset) {
      var localAsset = ((local && local.assets) || []).find(function (candidate) {
        return candidate.fileName === asset.fileName && (candidate.cloudName || '') === (asset.cloudName || '');
      });
      return Object.assign({}, asset, { path: localAsset ? localAsset.path : '' });
    });
    return merged;
  }

  function restoreLocalAttachmentFields(remote, local) {
    var merged = Object.assign({}, remote, { pdfPath: '', pdfSyncSignature: '' });
    merged.attachments = (remote.attachments || []).map(function (attachment) {
      var localAttachment = (local.attachments || []).find(function (candidate) {
        return candidate.id === attachment.id;
      });
      return Object.assign({}, attachment, {
        path: localAttachment ? localAttachment.path : '',
        syncSignature: localAttachment ? localAttachment.syncSignature : ''
      });
    });
    merged.pdfAnnotations = (remote.pdfAnnotations || []).map(function (annotation) {
      if (annotation.type !== 'snapshot') return annotation;
      var localAnnotation = (local.pdfAnnotations || []).find(function (candidate) {
        return candidate.id === annotation.id;
      });
      return Object.assign({}, annotation, { imagePath: localAnnotation ? localAnnotation.imagePath : '' });
    });
    return merged;
  }

  /** 实体级合并：winner/loser 都是 normalize 后的 paper；冲突时记录被覆盖方 */
  function mergePaper(local, remote) {
    var winner = lwwWinner(local, remote);
    var loser = winner === local ? remote : local;
    var merged = winner === remote ? restoreLocalAttachmentFields(remote, local) : local;
    return { merged: merged, winner: winner, loser: loser };
  }

  function sameEntityContent(a, b) {
    var left = withoutLocalAttachmentFields(a);
    var right = withoutLocalAttachmentFields(b);
    // 直调 entitySignature：原来两次 workspaceSignatures({papers:[x]}) 各建五张
    // 空集合签名表，首次全库合并时按文献数放大
    return model.entitySignature(left) === model.entitySignature(right);
  }

  function mergeEntityLists(localList, remoteList, keyOf) {
    var entries = {}, result = [];
    (localList || []).forEach(function (entity) { entries[keyOf(entity)] = { local: entity }; });
    (remoteList || []).forEach(function (entity) {
      var key = keyOf(entity);
      if (entries[key]) entries[key].remote = entity;
      else entries[key] = { remote: entity };
    });
    Object.keys(entries).forEach(function (key) {
      var entry = entries[key];
      if (!entry.local) result.push(entry.remote);
      else if (!entry.remote) result.push(entry.local);
      else result.push(lwwWinner(entry.local, entry.remote));
    });
    return result;
  }

  function syncWorkspace(value) {
    var workspace = model.normalizeWorkspace(value);
    workspace.papers = workspace.papers.map(cloudPaper);
    workspace.notes = (workspace.notes || []).map(cloudNote);
    return workspace;
  }

  function syncEnvelope(value, options) {
    var version = options && options.version !== undefined ? Number(options.version) : LEGACY_SYNC_VERSION;
    if (version !== LEGACY_SYNC_VERSION && version !== 4 && version !== 5 && version !== SYNC_VERSION) version = SYNC_VERSION;
    var workspace = model.normalizeWorkspace(value);
    var envelope = Object.assign({ syncVersion: version }, model.envelope(workspace.papers, workspace.folders, {
      notes: workspace.notes,
      savedSearches: workspace.savedSearches,
      tagColors: workspace.tagColors,
      tagColorRecords: workspace.tagColorRecords
    }));
    envelope.papers = envelope.papers.map(cloudPaper);
    envelope.notes = (envelope.notes || []).map(cloudNote);
    return envelope;
  }

  function mergeWorkspaces(localValue, remoteValue) {
    // 注意：不能用 normalizeWorkspace 直接归一单侧数据——它会按单侧文件夹清掉对端引入的
    // folderIds（悬空过滤），破坏跨设备合并。这里分别归一，最后再做整库校验。
    var local = {
      papers: model.normalizeLibrary(localValue || []),
      notes: model.normalizeNotes(localValue && localValue.notes),
      folders: model.normalizeFolders(localValue && localValue.folders),
      savedSearches: model.normalizeSavedSearches(localValue && localValue.savedSearches),
      tagColorRecords: model.normalizeTagColorRecords(localValue && localValue.tagColorRecords, localValue && localValue.tagColors)
    };
    var remote = {
      papers: model.normalizeLibrary(remoteValue || []).map(withoutLocalAttachmentFields),
      notes: model.normalizeNotes(remoteValue && remoteValue.notes),
      folders: model.normalizeFolders(remoteValue && remoteValue.folders),
      savedSearches: model.normalizeSavedSearches(remoteValue && remoteValue.savedSearches),
      tagColorRecords: model.normalizeTagColorRecords(remoteValue && remoteValue.tagColorRecords, remoteValue && remoteValue.tagColors)
    };
    var conflicts = [];

    // ---- 文件夹：LWW ----
    var folders = mergeEntityLists(local.folders, remote.folders, function (folder) { return folder.id; });

    // ---- 文献：整体 LWW + 冲突记录 ----
    var papers = [], paperSeen = {};
    local.papers.forEach(function (paper) { paperSeen[paper.id] = { local: paper }; });
    remote.papers.forEach(function (paper) {
      if (paperSeen[paper.id]) paperSeen[paper.id].remote = paper;
      else paperSeen[paper.id] = { remote: paper };
    });
    Object.keys(paperSeen).forEach(function (id) {
      var entry = paperSeen[id];
      if (entry.local && !entry.remote) { papers.push(entry.local); return; }
      if (!entry.local && entry.remote) { papers.push(entry.remote); return; }
      var result = mergePaper(entry.local, entry.remote);
      // 远端覆盖本地且内容确有差异 → 冲突报告（本地被覆盖的内容可导出）
      if (result.winner === entry.remote && !sameEntityContent(entry.local, entry.remote)) {
        var localT = entityTime(entry.local);
        var remoteT = entityTime(entry.remote);
        if (remoteT > localT) {
          conflicts.push({
            id: id,
            title: entry.local.title || entry.remote.title,
            direction: 'remote-wins',
            overwritten: entry.local
          });
        }
      }
      papers.push(result.merged);
    });

    // ---- 智能文件夹 / 标签颜色 / 笔记 ----
    var savedSearches = mergeEntityLists(local.savedSearches, remote.savedSearches, function (search) { return search.id; });
    var tagColorRecords = mergeEntityLists(local.tagColorRecords, remote.tagColorRecords, function (record) { return record.tag; });
    var notes = mergeEntityLists(local.notes, remote.notes, function (note) { return note.id; });

    var workspace = model.normalizeWorkspace({
      papers: papers, notes: notes, folders: folders, savedSearches: savedSearches, tagColorRecords: tagColorRecords
    });
    return { workspace: workspace, conflicts: conflicts };
  }

  /* ----------------------------------------------------------------------
   * v4 计划式同步
   *
   * v3 的 mergeWorkspaces 仍保留给旧调用方读取旧库。新同步流程使用下面
   * 的 createSyncPlan/applySyncPlan：先用 base、local、remote 生成可审阅的
   * 计划，所有存在歧义的字段在计划中显式列出，调用方确认后再应用结果。
   * 这些函数只处理内存中的数据，不进行网络或文件操作。
   * -------------------------------------------------------------------- */

  var hasOwn = Object.prototype.hasOwnProperty;
  var COLLECTIONS = [
    { name: 'papers', key: 'id', spec: merge && merge.PAPER_SPEC ? merge.PAPER_SPEC : null },
    { name: 'notes', key: 'id', spec: merge && merge.PLAIN_SPEC ? merge.PLAIN_SPEC : null },
    { name: 'folders', key: 'id', spec: merge && merge.PLAIN_SPEC ? merge.PLAIN_SPEC : null },
    { name: 'savedSearches', key: 'id', spec: merge && merge.PLAIN_SPEC ? merge.PLAIN_SPEC : null },
    { name: 'tagColorRecords', key: 'tag', spec: merge && merge.PLAIN_SPEC ? merge.PLAIN_SPEC : null }
  ];

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!value || typeof value !== 'object') return value;
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = cloneValue(value[key]); });
    return result;
  }

  function stableValue(value) {
    if (merge && typeof merge.stableStringify === 'function') return merge.stableStringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableValue).join(',') + ']';
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableValue(value[key]);
    }).join(',') + '}';
  }

  function equalValue(left, right) {
    if (merge && typeof merge.stableEqual === 'function') return merge.stableEqual(left, right);
    return stableValue(left) === stableValue(right);
  }

  function contentValue(entity) {
    var out = {};
    Object.keys(entity || {}).forEach(function (key) {
      if (key === 'updatedAt' || key === 'addedAt') return;
      out[key] = entity[key];
    });
    return out;
  }

  function equalContent(left, right) {
    return equalValue(contentValue(left), contentValue(right));
  }

  function tagColorsFromRecords(records) {
    var colors = {};
    (records || []).forEach(function (record) {
      if (record && !record.deletedAt && record.color) colors[record.tag] = record.color;
    });
    return colors;
  }

  function workspaceParts(value) {
    var input = value && typeof value === 'object' ? value : {};
    var papersInput = Array.isArray(input) ? input : input.papers;
    var records = model.normalizeTagColorRecords(input.tagColorRecords, input.tagColors);
    return {
      papers: model.normalizeLibrary(papersInput || []),
      notes: model.normalizeNotes(input.notes),
      folders: model.normalizeFolders(input.folders),
      savedSearches: model.normalizeSavedSearches(input.savedSearches),
      tagColorRecords: records,
      tagColors: tagColorsFromRecords(records)
    };
  }

  function partsWorkspace(parts) {
    var records = parts && parts.tagColorRecords || [];
    return {
      papers: (parts && parts.papers || []).map(cloneValue),
      notes: (parts && parts.notes || []).map(cloneValue),
      folders: (parts && parts.folders || []).map(cloneValue),
      savedSearches: (parts && parts.savedSearches || []).map(cloneValue),
      tagColorRecords: records.map(cloneValue),
      tagColors: tagColorsFromRecords(records)
    };
  }

  function cloudWorkspaceParts(parts) {
    var source = parts || {};
    return {
      papers: (source.papers || []).map(planCloudPaper),
      notes: (source.notes || []).map(cloneValue),
      folders: (source.folders || []).map(cloneValue),
      savedSearches: (source.savedSearches || []).map(cloneValue),
      tagColorRecords: (source.tagColorRecords || []).map(cloneValue),
      tagColors: tagColorsFromRecords(source.tagColorRecords || [])
    };
  }

  function unwrapWorkspace(value) {
    if (value && typeof value === 'object' && value.workspace &&
        !Array.isArray(value.papers) && !Array.isArray(value.folders)) return value.workspace;
    return value;
  }

  function collectionMap(list, key) {
    var result = Object.create(null);
    (list || []).forEach(function (item) {
      if (!item) return;
      var raw = item[key];
      if (raw === undefined || raw === null || raw === '') return;
      result[String(raw)] = item;
    });
    return result;
  }

  function cloudEntity(collection, entity) {
    if (collection.name === 'papers') return planCloudPaper(entity);
    if (collection.name === 'notes') return cloudNote(entity);
    return cloneValue(entity);
  }

  function planConflictId(collection, id, kind, field, itemId) {
    var suffix = field || kind || 'entity';
    if (itemId !== undefined && itemId !== null) suffix += '#' + String(itemId);
    return String(collection) + ':' + String(id) + ':' + suffix;
  }

  function defaultChoiceFor(mode, conflict) {
    if (conflict && conflict.deletedBy === 'local') return 'local';
    if (conflict && conflict.deletedBy === 'remote') return mode === 'restore' ? 'remote' : 'local';
    return mode === 'restore' ? 'remote' : 'local';
  }

  function normalizeMode(value) {
    var mode = String(value || 'sync').toLowerCase();
    return mode === 'restore' || mode === 'recovery' || mode === 'pull' ? 'restore' : 'sync';
  }

  function normalizeNow(value) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? Math.trunc(number) : Date.now();
  }

  function makeConflict(collection, id, mode, rawConflict) {
    var itemId = rawConflict && rawConflict.itemId;
    var field = rawConflict && rawConflict.field;
    var kind = rawConflict && rawConflict.kind === 'item' ?
      (field === 'attachments' ? 'attachment' : (field === 'pdfAnnotations' ? 'annotation' : 'item')) : 'field';
    var conflict = {
      conflictId: planConflictId(collection.name, id, kind, field, itemId),
      id: String(id),
      entityId: String(id),
      collection: collection.name,
      kind: kind,
      type: kind,
      mergeKind: rawConflict && rawConflict.kind || 'scalar',
      field: field || null,
      itemId: itemId === undefined ? null : itemId,
      attachmentId: field === 'attachments' && itemId !== undefined ? itemId : null,
      base: cloneValue(rawConflict && rawConflict.base),
      local: cloneValue(rawConflict && rawConflict.local),
      remote: cloneValue(rawConflict && rawConflict.remote),
      label: rawConflict && rawConflict.label || field || String(id),
      deletedBy: rawConflict && rawConflict.deletedBy || null
    };
    conflict.defaultChoice = defaultChoiceFor(mode, conflict);
    conflict.path = field ? (itemId === undefined || itemId === null ? [field] : [field, itemId]) : [];
    return conflict;
  }

  function makeEntityConflict(collection, id, mode, base, local, remote, deletedBy) {
    var conflict = {
      conflictId: planConflictId(collection.name, id, 'entity'),
      id: String(id),
      entityId: String(id),
      collection: collection.name,
      kind: 'entity',
      type: 'entity',
      mergeKind: 'entity',
      field: null,
      itemId: null,
      base: cloneValue(base),
      local: cloneValue(local),
      remote: cloneValue(remote),
      label: String(id),
      deletedBy: deletedBy || null
    };
    conflict.defaultChoice = defaultChoiceFor(mode, conflict);
    conflict.path = [];
    return conflict;
  }

  function mergeComparableEntity(collection, base, local, remote, now) {
    var baseValue = base || {};
    var localValue = local || {};
    var remoteValue = remote || {};
    if (merge && typeof merge.mergeEntity === 'function') {
      return merge.mergeEntity(baseValue, localValue, remoteValue, collection.spec || {}, { now: now });
    }
    // 浏览器脚本异常缺少 merge.js 时仍然生成一个安全的、未决计划；不会 LWW 覆盖。
    var fallback = cloneValue(localValue);
    var fields = Object.create(null);
    [baseValue, localValue, remoteValue].forEach(function (item) {
      Object.keys(item || {}).forEach(function (key) {
        if (key !== 'updatedAt' && key !== 'addedAt') fields[key] = true;
      });
    });
    var conflicts = [];
    Object.keys(fields).forEach(function (field) {
      var b = baseValue[field], l = localValue[field], r = remoteValue[field];
      if (equalValue(l, b)) fallback[field] = cloneValue(r);
      else if (equalValue(r, b) || equalValue(l, r)) fallback[field] = cloneValue(l);
      else conflicts.push({ kind: 'scalar', field: field, base: b, local: l, remote: r, label: field });
    });
    fallback.updatedAt = now;
    return { merged: fallback, conflicts: conflicts };
  }

  function restoreLocalFieldsForPlan(collection, merged, local) {
    if (collection.name === 'papers') return restoreLocalAttachmentFields(merged, local || {});
    if (collection.name === 'notes') return restoreLocalNoteFields(merged, local || {});
    return cloneValue(merged);
  }

  function makeEntityPlan(collection, id, baseEntity, localEntityValue, remoteEntity, mode, now, baseProvided) {
    var hasBase = baseEntity !== undefined && baseEntity !== null;
    var hasLocal = localEntityValue !== undefined && localEntityValue !== null;
    var hasRemote = remoteEntity !== undefined && remoteEntity !== null;
    var localCloud = hasLocal ? cloudEntity(collection, localEntityValue) : undefined;
    var remoteCloud = hasRemote ? cloudEntity(collection, remoteEntity) : undefined;
    var baseCloud = hasBase ? cloudEntity(collection, baseEntity) : undefined;
    var entry = {
      collection: collection.name,
      id: String(id),
      key: collection.key,
      status: 'both',
      state: 'both',
      base: cloneValue(baseCloud),
      local: cloneValue(localEntityValue),
      remote: cloneValue(remoteCloud),
      cloudLocal: cloneValue(localCloud),
      cloudRemote: cloneValue(remoteCloud),
      hasBase: hasBase,
      hasLocal: hasLocal,
      hasRemote: hasRemote,
      conflicts: [],
      requiresResolution: false,
      defaultChoice: null,
      merged: null
    };

    if (!hasLocal && !hasRemote) {
      entry.status = entry.state = 'absent';
      return entry;
    }
    if (!hasLocal) {
      if (!hasBase || equalContent(remoteCloud, baseCloud)) {
        entry.status = entry.state = hasBase ? 'deleted-local' : 'remote-only';
        // base 存在且远端未改动时，缺失本地实体代表本地删除；普通同步应
        // 保持删除，恢复模式则以远端为准把实体拉回。
        entry.merged = hasBase && mode !== 'restore' ? undefined : cloneValue(remoteCloud);
        return entry;
      }
      entry.status = entry.state = 'deleted-local-conflict';
      entry.defaultChoice = 'local';
      entry.conflicts.push(makeEntityConflict(collection, id, mode, baseCloud, undefined, remoteCloud, 'local'));
      entry.requiresResolution = true;
      entry.merged = undefined;
      return entry;
    }
    if (!hasRemote) {
      if (!hasBase || equalContent(localCloud, baseCloud)) {
        entry.status = entry.state = hasBase ? 'deleted-remote' : 'local-only';
        // 远端删除且本地未改动时，两种模式都应尊重远端删除；没有
        // base 时才是单纯的本机独有实体。
        entry.merged = hasBase ? undefined : cloneValue(localEntityValue);
        if (mode === 'restore' && !hasBase) {
          entry.status = entry.state = 'local-only';
          entry.defaultChoice = 'local';
          entry.conflicts.push(makeEntityConflict(collection, id, mode, undefined, localCloud, undefined, 'remote'));
          entry.requiresResolution = true;
        }
        return entry;
      }
      entry.status = entry.state = 'deleted-remote-conflict';
      entry.defaultChoice = mode === 'restore' ? 'remote' : 'local';
      entry.conflicts.push(makeEntityConflict(collection, id, mode, baseCloud, localCloud, undefined, 'remote'));
      entry.requiresResolution = true;
      entry.merged = cloneValue(localEntityValue);
      return entry;
    }

    if (equalContent(localCloud, remoteCloud)) {
      entry.status = entry.state = 'unchanged';
      entry.merged = restoreLocalFieldsForPlan(collection, localCloud, localEntityValue);
      return entry;
    }

    var result = mergeComparableEntity(collection, baseCloud, localCloud, remoteCloud, now);
    entry.merged = restoreLocalFieldsForPlan(collection, result.merged, localEntityValue);
    (result.conflicts || []).forEach(function (rawConflict) {
      var conflict = makeConflict(collection, id, mode, rawConflict);
      entry.conflicts.push(conflict);
    });
    entry.requiresResolution = entry.conflicts.length > 0;
    entry.defaultChoice = entry.conflicts.length ? entry.conflicts[0].defaultChoice : null;
    entry.status = entry.state = entry.requiresResolution ? 'conflict' : 'merged';
    return entry;
  }

  function looksLikePlanInput(value) {
    return value && typeof value === 'object' &&
      (hasOwn.call(value, 'base') || hasOwn.call(value, 'local') || hasOwn.call(value, 'remote') ||
       hasOwn.call(value, 'mode') || hasOwn.call(value, 'baseWorkspace'));
  }

  /**
   * 创建 v4 同步计划。
   * 支持 createSyncPlan({base, local, remote, mode, now})，也支持
   * createSyncPlan(base, local, remote, options) 以便 Node/IPC 调用方传参。
   */
  function createSyncPlan(input, localArg, remoteArg, optionsArg) {
    var options;
    if (arguments.length === 1 && looksLikePlanInput(input)) options = input || {};
    else if (arguments.length >= 3) {
      options = Object.assign({}, optionsArg || {}, { base: input, local: localArg, remote: remoteArg });
    } else {
      options = Object.assign({}, optionsArg || {}, { local: input, remote: localArg });
    }
    var mode = normalizeMode(options.mode || options.syncMode);
    var now = normalizeNow(options.now);
    var hasExplicitBase = hasOwn.call(options, 'base') || hasOwn.call(options, 'baseWorkspace');
    var baseValue = hasOwn.call(options, 'baseWorkspace') ? options.baseWorkspace : options.base;
    var localValue = hasOwn.call(options, 'localWorkspace') ? options.localWorkspace : options.local;
    var remoteInput = hasOwn.call(options, 'remoteWorkspace') ? options.remoteWorkspace : options.remote;
    var remoteValue = unwrapWorkspace(remoteInput);
    var baseParts = workspaceParts(baseValue);
    var localParts = workspaceParts(localValue);
    var remoteParts = workspaceParts(remoteValue);
    var plan = {
      planVersion: 1,
      version: SYNC_VERSION,
      protocol: 'litboard-sync-v6',
      syncVersion: SYNC_VERSION,
      mode: mode,
      now: now,
      baseProvided: hasExplicitBase,
      base: hasExplicitBase ? partsWorkspace(cloudWorkspaceParts(baseParts)) : null,
      local: partsWorkspace(localParts),
      remote: partsWorkspace(cloudWorkspaceParts(remoteParts)),
      cloudLocal: partsWorkspace(cloudWorkspaceParts(localParts)),
      remoteVersion: Number(remoteInput && remoteInput.syncVersion) || LEGACY_SYNC_VERSION,
      remoteEtag: options.remoteEtag || options.etag || (remoteInput && (remoteInput.etag || remoteInput.ETag)) || null,
      entities: [],
      byCollection: {},
      conflicts: [],
      onlyLocal: [],
      onlyRemote: [],
      localOnly: [],
      remoteOnly: [],
      onlyLocalIds: [],
      onlyRemoteIds: [],
      defaultResolutions: {},
      requiresResolution: false,
      hasConflicts: false,
      needsResolution: false,
      remoteAuthoritative: mode === 'restore',
      recovery: mode === 'restore' ? {
        mode: 'restore',
        remoteAuthoritative: true,
        preserveLocalOnlyByDefault: true,
        requiresConfirmation: true
      } : null
    };

    COLLECTIONS.forEach(function (collection) {
      var baseMap = collectionMap(baseParts[collection.name], collection.key);
      var localMap = collectionMap(localParts[collection.name], collection.key);
      var remoteMap = collectionMap(remoteParts[collection.name], collection.key);
      var ids = Object.create(null);
      [baseMap, localMap, remoteMap].forEach(function (map) {
        Object.keys(map).forEach(function (id) { ids[id] = true; });
      });
      var list = [];
      Object.keys(ids).sort().forEach(function (id) {
        var entry = makeEntityPlan(collection, id, baseMap[id], localMap[id], remoteMap[id], mode, now, hasExplicitBase);
        if (entry.status === 'absent') return;
        list.push(entry);
        plan.entities.push(entry);
        if (!plan.byCollection[collection.name]) plan.byCollection[collection.name] = [];
        plan.byCollection[collection.name].push(entry);
        if (entry.status === 'local-only' || entry.status === 'deleted-remote') {
          var localMarker = { collection: collection.name, id: id, entity: cloneValue(localMap[id]), status: entry.status,
            requiresResolution: entry.requiresResolution };
          plan.onlyLocal.push(localMarker);
          plan.localOnly.push(localMarker);
          plan.onlyLocalIds.push(collection.name + ':' + id);
        }
        if (entry.status === 'remote-only' || entry.status === 'deleted-local') {
          var remoteMarker = { collection: collection.name, id: id, entity: cloneValue(remoteMap[id]), status: entry.status,
            requiresResolution: entry.requiresResolution };
          plan.onlyRemote.push(remoteMarker);
          plan.remoteOnly.push(remoteMarker);
          plan.onlyRemoteIds.push(collection.name + ':' + id);
        }
        (entry.conflicts || []).forEach(function (conflict) {
          plan.conflicts.push(conflict);
          plan.defaultResolutions[conflict.conflictId] = conflict.defaultChoice;
        });
      });
      if (!list.length) plan.byCollection[collection.name] = [];
    });
    plan.requiresResolution = plan.conflicts.length > 0;
    plan.hasConflicts = plan.requiresResolution;
    plan.needsResolution = plan.requiresResolution;
    plan.fieldConflicts = plan.conflicts.filter(function (conflict) { return conflict.kind === 'field'; });
    plan.attachmentConflicts = plan.conflicts.filter(function (conflict) {
      return conflict.kind === 'attachment' || conflict.kind === 'annotation';
    });
    plan.entityConflicts = plan.conflicts.filter(function (conflict) { return conflict.kind === 'entity'; });
    // 恢复模式下本机独有实体虽默认保留，也必须在 UI 中确认，避免误将本机数据
    // 当成远端数据上传/删除。
    if (mode === 'restore') {
      plan.onlyLocal.forEach(function (marker) {
        var entry = plan.byCollection[marker.collection].find(function (item) { return item.id === marker.id; });
        if (!entry) return;
        // 只有 base 中不存在的本机独有条目需要人工确认；远端明确删除
        // 的条目（deleted-remote）不应被误标成本机残留。
        if (entry.status === 'local-only' && !entry.conflicts.length) {
          var conflict = makeEntityConflict(COLLECTIONS.find(function (item) { return item.name === marker.collection; }),
            marker.id, mode, entry.base, entry.cloudLocal, undefined, 'remote');
          conflict.defaultChoice = 'local';
          entry.conflicts.push(conflict);
          entry.requiresResolution = true;
          plan.conflicts.push(conflict);
          plan.defaultResolutions[conflict.conflictId] = conflict.defaultChoice;
        }
        marker.requiresResolution = entry.requiresResolution;
      });
    }
    plan.requiresResolution = plan.conflicts.length > 0;
    plan.hasConflicts = plan.requiresResolution;
    plan.needsResolution = plan.requiresResolution;
    plan.fieldConflicts = plan.conflicts.filter(function (conflict) { return conflict.kind === 'field'; });
    plan.attachmentConflicts = plan.conflicts.filter(function (conflict) {
      return conflict.kind === 'attachment' || conflict.kind === 'annotation';
    });
    plan.entityConflicts = plan.conflicts.filter(function (conflict) { return conflict.kind === 'entity'; });
    plan.preview = applySyncPlan(plan, {}, { allowUnresolved: true, now: now });
    plan.merged = plan.preview.workspace;
    plan.result = plan.preview.workspace;
    return plan;
  }

  /* ----------------------------------------------------------------------
   * 本机保留登记（pin）
   *
   * 对照弹窗里用户选「采用本机版本」只表达「本机保留这份」，不应把本机
   * 内容推上云端覆盖远端副本。为此在应用计划时生成两份结果：本机工作区
   * （含用户选择）与云端工作区（被选「本机」的实体保持远端值），并把两
   * 侧快照登记进 sync base。后续同步在两侧都与登记一致时维持分叉（上传
   * 信封与本地应用各取所需）；任一侧发生变化即解除登记，回到正常合并流程。
   * -------------------------------------------------------------------- */

  var PIN_COLLECTIONS = ['papers', 'notes', 'folders', 'savedSearches', 'tagColorRecords'];

  function collectionKeyOf(name) {
    return name === 'tagColorRecords' ? 'tag' : 'id';
  }

  function pinKey(collection, id) {
    return String(collection) + ':' + String(id);
  }

  /* 登记快照一律存云端形态（剥离本机 path/syncSignature 等），比较时忽略
   * updatedAt/addedAt；absent 用 null 表示。 */
  function pinSnapshot(collection, entity) {
    if (entity === undefined || entity === null) return null;
    return cloneValue(cloudEntity(collection, entity));
  }

  function pinSame(a, b) {
    var left = a === undefined || a === null ? null : contentValue(a);
    var right = b === undefined || b === null ? null : contentValue(b);
    return stableValue(left) === stableValue(right);
  }

  /**
   * 从「应用后的本机工作区」与「云端保留工作区」的差异提取登记。
   * 两份工作区来自同一计划、仅冲突选择不同，因此差异恰好是用户选「本机」的部分。
   */
  function extractWorkspacePins(localWorkspace, cloudWorkspace, now) {
    var pins = {};
    PIN_COLLECTIONS.forEach(function (name) {
      var collection = { name: name };
      var key = collectionKeyOf(name);
      var localMap = collectionMap(localWorkspace && localWorkspace[name], key);
      var cloudMap = collectionMap(cloudWorkspace && cloudWorkspace[name], key);
      Object.keys(localMap).forEach(function (id) {
        var remote = hasOwn.call(cloudMap, id) ? cloudMap[id] : null;
        if (remote && equalContent(localMap[id], remote)) return;
        // 远端实体已不存在时，“采用本机”应把本机实体重新上传，而不是
        // 登记一个 remote:null 的分叉并永久阻止它上云。
        if (!remote) return;
        pins[pinKey(name, id)] = { savedAt: now, local: pinSnapshot(collection, localMap[id]), remote: pinSnapshot(collection, remote) };
      });
      Object.keys(cloudMap).forEach(function (id) {
        if (hasOwn.call(localMap, id)) return;
        pins[pinKey(name, id)] = { savedAt: now, local: null, remote: pinSnapshot(collection, cloudMap[id]) };
      });
    });
    return pins;
  }

  /** 合并登记表：同名键新登记覆盖旧登记 */
  function mergePinMaps(basePins, newPins) {
    var pins = {};
    Object.keys(basePins || {}).forEach(function (key) {
      if (basePins[key] && typeof basePins[key] === 'object') pins[key] = cloneValue(basePins[key]);
    });
    Object.keys(newPins || {}).forEach(function (key) {
      if (newPins[key] && typeof newPins[key] === 'object') pins[key] = cloneValue(newPins[key]);
    });
    return pins;
  }

  /**
   * 评估登记存续：本机与远端都与登记快照一致才继续维持分叉；
   * 任一侧被修改过（或实体彻底消失）即解除，回到正常三方合并流程。
   */
  function evaluateSyncPins(pins, corePlan) {
    var result = {};
    if (!pins || typeof pins !== 'object') return result;
    var entries = Object.create(null);
    (corePlan && corePlan.entities || []).forEach(function (entry) {
      if (entry && entry.collection && entry.id !== undefined) entries[pinKey(entry.collection, entry.id)] = entry;
    });
    Object.keys(pins).forEach(function (key) {
      var pin = pins[key];
      if (!pin || typeof pin !== 'object') return;
      // 旧版本可能写入过“本机有实体、远端为空”的登记。该登记会让
      // 用户明确选择本机后仍无法重建远端库，读取时直接淘汰。
      if (pin.local && !pin.remote) return;
      var entry = entries[key];
      if (!entry) return;
      var localOk = pinSame(pin.local, entry.hasLocal ? entry.cloudLocal : null);
      var remoteOk = pinSame(pin.remote, entry.hasRemote ? entry.cloudRemote : null);
      if (localOk && remoteOk) result[key] = pin;
    });
    return result;
  }

  /** 按登记调整上传工作区：被登记实体替换为远端快照（快照为 null 则剔除） */
  function applyPinsToWorkspace(workspace, pins) {
    if (!pins) return workspace;
    var hasPins = false;
    Object.keys(pins).forEach(function (key) { if (pins[key]) hasPins = true; });
    if (!hasPins) return workspace;
    var output = {};
    PIN_COLLECTIONS.forEach(function (name) {
      var key = collectionKeyOf(name);
      var list = [];
      ((workspace && workspace[name]) || []).forEach(function (entity) {
        if (!entity) return;
        var id = entity[key];
        var pin = id === undefined || id === null ? null : pins[pinKey(name, id)];
        if (pin) {
          if (pin.remote) list.push(cloneValue(pin.remote));
          return;
        }
        list.push(entity);
      });
      output[name] = list;
    });
    return output;
  }

  /** 把远端实体补回工作区（只补缺失项，不覆盖已有实体）：用于「本机为空疑似
   * 重置」时按用户选择把远端内容拉回本机，替代默认的「本地删除传播」。远端
   * 墓碑同样保留，避免已删除条目借恢复复活。 */
  function adoptRemoteEntities(workspace, remoteValue) {
    var parts = workspaceParts(remoteValue);
    var output = {};
    PIN_COLLECTIONS.forEach(function (name) {
      var key = collectionKeyOf(name);
      var current = ((workspace && workspace[name]) || []).map(cloneValue);
      var have = collectionMap(current, key);
      (parts[name] || []).forEach(function (entity) {
        if (!entity) return;
        var id = entity[key];
        if (id === undefined || id === null || hasOwn.call(have, String(id))) return;
        current.push(cloneValue(entity));
        have[String(id)] = entity;
      });
      output[name] = current;
    });
    return model.normalizeWorkspace(output);
  }

  /** 把显式选「本机」的选择改写为「远端」，用于生成云端保留工作区 */
  function invertLocalChoices(choices) {
    function flip(value) {
      var side = String(value || '').toLowerCase();
      if (side === 'local' || side === 'keep-local' || side === 'keep') return 'remote';
      if (side === 'remote' || side === 'keep-remote') return 'remote';
      return '';
    }
    if (Array.isArray(choices)) {
      return choices.map(function (item) {
        if (!item || typeof item !== 'object') return item;
        return Object.assign({}, item, { choice: flip(item.choice || item.resolution || item.value) });
      });
    }
    if (!choices || typeof choices !== 'object') return {};
    var result = {};
    Object.keys(choices).forEach(function (key) {
      var item = choices[key];
      if (item && typeof item === 'object') {
        result[key] = Object.assign({}, item, { choice: flip(item.choice || item.resolution || item.value) });
        return;
      }
      result[key] = flip(item);
    });
    return result;
  }

  function choiceMap(choices) {
    var result = Object.create(null);
    if (Array.isArray(choices)) {
      choices.forEach(function (item) {
        if (!item) return;
        var key = item.conflictId || item.id || item.key;
        var choice = item.choice || item.resolution || item.value;
        if (key && choice) result[String(key)] = choice;
      });
    } else if (choices && typeof choices === 'object') {
      Object.keys(choices).forEach(function (key) {
        var item = choices[key];
        if (item && typeof item === 'object') item = item.choice || item.resolution || item.value;
        if (item) result[String(key)] = item;
      });
    }
    return result;
  }

  function findChoice(map, conflict, options) {
    var keys = [conflict.conflictId, conflict.id];
    if (conflict.field) keys.push(conflict.collection + ':' + conflict.id + ':' + conflict.field);
    for (var i = 0; i < keys.length; i++) {
      if (hasOwn.call(map, keys[i])) return map[keys[i]];
    }
    if (options && options.useDefaults) return conflict.defaultChoice;
    return null;
  }

  function applyEntityChoice(entry, choice) {
    if (choice === 'remote') return entry.remote === undefined ? undefined : cloneValue(entry.remote);
    if (choice === 'local') return entry.local === undefined ? undefined : cloneValue(entry.local);
    return undefined;
  }

  function applySyncPlan(plan, choices, options) {
    options = options || {};
    if (!plan || !Array.isArray(plan.entities)) throw new TypeError(T('无效的同步计划'));
    var now = normalizeNow(options.now || plan.now);
    var map = choiceMap(choices);
    var unresolved = [];
    var appliedChoices = {};
    var output = { papers: [], notes: [], folders: [], savedSearches: [], tagColorRecords: [] };
    plan.entities.forEach(function (entry) {
      var collection = COLLECTIONS.find(function (item) { return item.name === entry.collection; });
      if (!collection || entry.status === 'absent') return;
      var selected;
      if (entry.status === 'remote-only') selected = entry.remote;
      else if (entry.status === 'local-only') {
        selected = entry.local;
        (entry.conflicts || []).forEach(function (conflict) {
          var choice = findChoice(map, conflict, options);
          if (choice !== 'local' && choice !== 'remote') {
            unresolved.push(conflict);
            return;
          }
          appliedChoices[conflict.conflictId] = choice;
          selected = applyEntityChoice(entry, choice);
        });
      }
      else if (entry.status === 'deleted-local') selected = plan.mode === 'restore' ? entry.remote : undefined;
      else if (entry.status === 'deleted-remote') selected = undefined;
      else if (entry.status === 'unchanged') selected = cloneValue(entry.merged);
      else if (entry.status === 'deleted-local-conflict' || entry.status === 'deleted-remote-conflict') {
        selected = entry.merged;
        (entry.conflicts || []).forEach(function (conflict) {
          var choice = findChoice(map, conflict, options);
          if (choice !== 'local' && choice !== 'remote') {
            unresolved.push(conflict);
            return;
          }
          appliedChoices[conflict.conflictId] = choice;
          selected = applyEntityChoice(entry, choice);
        });
      } else {
        var localCloud = entry.cloudLocal !== undefined ? entry.cloudLocal : cloudEntity(collection, entry.local);
        var remoteCloud = entry.cloudRemote !== undefined ? entry.cloudRemote : cloudEntity(collection, entry.remote);
        var baseCloud = entry.base !== undefined ? entry.base : {};
        var result = mergeComparableEntity(collection, baseCloud, localCloud, remoteCloud, now);
        selected = restoreLocalFieldsForPlan(collection, result.merged, entry.local);
        (entry.conflicts || []).forEach(function (conflict) {
          var choice = findChoice(map, conflict, options);
          if (choice !== 'local' && choice !== 'remote') {
            unresolved.push(conflict);
            return;
          }
          appliedChoices[conflict.conflictId] = choice;
          if (conflict.kind === 'entity') {
            selected = applyEntityChoice(entry, choice);
            if (selected && collection.name === 'papers') selected = model.normalizePaper(selected);
            return;
          }
          if (merge && typeof merge.applyChoice === 'function') {
            var comparable = cloudEntity(collection, selected);
            merge.applyChoice(comparable, {
              kind: conflict.mergeKind,
              field: conflict.field,
              idKey: conflict.kind === 'attachment' || conflict.kind === 'annotation' ? 'id' : undefined,
              itemId: conflict.itemId,
              local: conflict.local,
              remote: conflict.remote
            }, choice);
            selected = restoreLocalFieldsForPlan(collection, comparable, entry.local);
          } else {
            // fallback 只支持标量字段；缺少 merge.js 时让复杂冲突保持未决。
            if (conflict.kind !== 'field') {
              unresolved.push(conflict);
              return;
            }
            selected[conflict.field] = cloneValue(choice === 'remote' ? conflict.remote : conflict.local);
          }
        });
      }
      if (selected === undefined || selected === null) return;
      output[collection.name].push(cloneValue(selected));
    });
    var workspace = model.normalizeWorkspace(output);
    return {
      ok: unresolved.length === 0,
      applied: unresolved.length === 0,
      complete: unresolved.length === 0,
      requiresResolution: unresolved.length > 0,
      unresolved: unresolved,
      conflicts: unresolved,
      appliedChoices: appliedChoices,
      workspace: workspace,
      merged: workspace,
      envelope: syncEnvelope(workspace, { version: SYNC_VERSION })
    };
  }

  function isSupportedSyncVersion(value) {
    var version = Number(value);
    // 没有 syncVersion 的文件是 v3 最早格式，仍按 legacy 读取。
    // 接受 [LEGACY, SYNC] 闭区间内的所有历史版本；更大的版本号（如旧端读到
    // 本版本写出的 v6）一律拒绝，保证旧端不会把新格式改坏后写回。
    return value === undefined || value === null || value === '' ||
      (version >= LEGACY_SYNC_VERSION && version <= SYNC_VERSION);
  }

  function readSyncEnvelope(value) {
    var input = value && typeof value === 'object' ? value : {};
    var version = input.syncVersion === undefined || input.syncVersion === null || input.syncVersion === '' ?
      LEGACY_SYNC_VERSION : Number(input.syncVersion);
    if (!isSupportedSyncVersion(version)) throw new Error(T('不支持的 LitBoard 同步版本：') + input.syncVersion);
    var workspace = workspaceParts(input);
    return {
      syncVersion: version,
      legacy: version < SYNC_VERSION,
      supported: true,
      workspace: partsWorkspace(workspace),
      envelope: cloneValue(input)
    };
  }

  function createSyncEnvelope(value, options) {
    var opts = options || {};
    return syncEnvelope(value, Object.assign({}, opts, { version: SYNC_VERSION }));
  }

  return {
    SYNC_VERSION: SYNC_VERSION,
    LEGACY_SYNC_VERSION: LEGACY_SYNC_VERSION,
    SUPPORTED_SYNC_VERSIONS: [LEGACY_SYNC_VERSION, 4, 5, SYNC_VERSION],
    mergeWorkspaces: mergeWorkspaces,
    syncWorkspace: syncWorkspace,
    syncEnvelope: syncEnvelope,
    createSyncEnvelope: createSyncEnvelope,
    isSupportedSyncVersion: isSupportedSyncVersion,
    readSyncEnvelope: readSyncEnvelope,
    createSyncPlan: createSyncPlan,
    applySyncPlan: applySyncPlan,
    invertLocalChoices: invertLocalChoices,
    adoptRemoteEntities: adoptRemoteEntities,
    extractWorkspacePins: extractWorkspacePins,
    mergePinMaps: mergePinMaps,
    evaluateSyncPins: evaluateSyncPins,
    applyPinsToWorkspace: applyPinsToWorkspace
  };
});
