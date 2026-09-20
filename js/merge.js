/* LitBoard 三方合并：解决渲染层本地编辑与浏览器扩展/外部写入的并发冲突（浏览器 / Node 共用）
 *
 * 语义：
 * - 所有比较基于稳定 JSON 序列化（对象键排序后 stringify）；
 * - 未列入 spec 的字段一律按标量整体深比较；
 * - setFields：基础类型数组按三方集合合并（一侧删除且另一侧未改 → 删除；任一侧新增 → 保留）；
 * - idFields：对象数组按 id 对齐三方合并，逐 id 自动合并或产生 item 冲突；
 * - updatedAt / addedAt 永不参与比较：updatedAt 取 options.now || Date.now()，
 *   addedAt 取三方中最早的有效值；
 * - merged 以 local 的浅拷贝为基础再覆盖合并结果；conflicts 每项附带 label。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitMerge = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var PLAIN_SPEC = {};

  var PAPER_SPEC = {
    setFields: ['tags', 'folderIds', 'relatedIds', 'researchIds'],
    idFields: { attachments: 'id', pdfAnnotations: 'id' }
  };

  var SKIP_FIELDS = { updatedAt: true, addedAt: true };

  /* 稳定 JSON 序列化：对象键排序；undefined 返回 undefined（与任何字符串不等） */
  function stableStringify(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      var parts = [];
      for (var i = 0; i < value.length; i++) {
        var item = stableStringify(value[i]);
        parts.push(item === undefined ? 'null' : item);
      }
      return '[' + parts.join(',') + ']';
    }
    var keys = Object.keys(value).sort();
    var out = [];
    for (var j = 0; j < keys.length; j++) {
      var sv = stableStringify(value[keys[j]]);
      if (sv === undefined) continue;
      out.push(JSON.stringify(keys[j]) + ':' + sv);
    }
    return '{' + out.join(',') + '}';
  }

  function stableEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  function keySet(arr) {
    var set = Object.create(null);
    for (var i = 0; i < arr.length; i++) set[stableStringify(arr[i])] = true;
    return set;
  }

  function setOrDelete(obj, field, value) {
    if (value === undefined) delete obj[field];
    else obj[field] = value;
  }

  /* 标量三方合并 */
  function mergeScalarField(merged, conflicts, field, b, l, r) {
    if (stableEqual(l, b)) { setOrDelete(merged, field, r); return; }
    if (stableEqual(r, b)) { setOrDelete(merged, field, l); return; }
    if (stableEqual(l, r)) { setOrDelete(merged, field, l); return; }
    conflicts.push({ field: field, kind: 'scalar', base: b, local: l, remote: r, label: field });
    setOrDelete(merged, field, l);
  }

  /* 集合三方合并：(base∩local∩remote) ∪ (local−base) ∪ (remote−base)，local 顺序优先 */
  function mergeSetField(baseArr, localArr, remoteArr) {
    var b = Array.isArray(baseArr) ? baseArr : [];
    var l = Array.isArray(localArr) ? localArr : [];
    var r = Array.isArray(remoteArr) ? remoteArr : [];
    var baseKeys = keySet(b);
    var remoteKeys = keySet(r);
    var result = [];
    var resultKeys = Object.create(null);
    var i, k;
    for (i = 0; i < l.length; i++) {
      k = stableStringify(l[i]);
      if (baseKeys[k] && !remoteKeys[k]) continue; /* remote 删除且 local 未改 */
      if (resultKeys[k]) continue;
      resultKeys[k] = true;
      result.push(l[i]);
    }
    for (i = 0; i < r.length; i++) {
      k = stableStringify(r[i]);
      if (baseKeys[k] || resultKeys[k]) continue;
      resultKeys[k] = true;
      result.push(r[i]);
    }
    return result;
  }

  function indexById(arr, idKey) {
    var map = Object.create(null);
    var rawIds = Object.create(null);
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var id = item && item[idKey];
      var key = id === undefined || id === null ? ' noid:' + stableStringify(item) : String(id);
      if (map[key] === undefined) {
        map[key] = item;
        rawIds[key] = id;
      }
    }
    return { map: map, rawIds: rawIds };
  }

  /* 按 id 对齐的三方合并 */
  function mergeIdField(field, idKey, baseArr, localArr, remoteArr, conflicts) {
    var b = Array.isArray(baseArr) ? baseArr : [];
    var l = Array.isArray(localArr) ? localArr : [];
    var r = Array.isArray(remoteArr) ? remoteArr : [];
    var bi = indexById(b, idKey);
    var li = indexById(l, idKey);
    var ri = indexById(r, idKey);
    var result = [];
    var seen = Object.create(null);

    function resolve(key) {
      if (seen[key]) return;
      seen[key] = true;
      var hasB = bi.map[key] !== undefined;
      var hasL = li.map[key] !== undefined;
      var hasR = ri.map[key] !== undefined;
      var bv = bi.map[key], lv = li.map[key], rv = ri.map[key];
      var rawId = hasL ? li.rawIds[key] : (hasR ? ri.rawIds[key] : bi.rawIds[key]);
      var label = field + '#' + rawId;
      if (hasB && hasL && hasR) {
        if (stableEqual(lv, bv)) { result.push(rv); return; }
        if (stableEqual(rv, bv)) { result.push(lv); return; }
        if (stableEqual(lv, rv)) { result.push(lv); return; }
        conflicts.push({ field: field, kind: 'item', idKey: idKey, itemId: rawId, base: bv, local: lv, remote: rv, label: label });
        result.push(lv);
        return;
      }
      if (hasB && hasR && !hasL) {
        if (stableEqual(rv, bv)) return; /* local 删除且 remote 未改 */
        conflicts.push({ field: field, kind: 'item', idKey: idKey, itemId: rawId, deletedBy: 'local', base: bv, local: undefined, remote: rv, label: label });
        return; /* merged 暂按 local（已删除） */
      }
      if (hasB && hasL && !hasR) {
        if (stableEqual(lv, bv)) return; /* remote 删除且 local 未改 */
        conflicts.push({ field: field, kind: 'item', idKey: idKey, itemId: rawId, deletedBy: 'remote', base: bv, local: lv, remote: undefined, label: label });
        result.push(lv);
        return;
      }
      if (hasB) return; /* 两侧都删除 */
      if (hasL && hasR) {
        if (stableEqual(lv, rv)) { result.push(lv); return; }
        conflicts.push({ field: field, kind: 'item', idKey: idKey, itemId: rawId, base: undefined, local: lv, remote: rv, label: label });
        result.push(lv);
        return;
      }
      result.push(hasL ? lv : rv); /* base 没有、仅一侧有 */
    }

    var i, key;
    for (i = 0; i < l.length; i++) {
      var lItem = l[i];
      var lId = lItem && lItem[idKey];
      key = lId === undefined || lId === null ? ' noid:' + stableStringify(lItem) : String(lId);
      resolve(key);
    }
    for (i = 0; i < r.length; i++) {
      var rItem = r[i];
      var rId = rItem && rItem[idKey];
      key = rId === undefined || rId === null ? ' noid:' + stableStringify(rItem) : String(rId);
      resolve(key);
    }
    /* base 中有而两侧都没有的 id 也需要标记删除（resolve 里 hasB 分支返回 null） */
    for (key in bi.map) resolve(key);
    return result;
  }

  function earliestAddedAt(base, local, remote, now) {
    var best = null;
    var sources = [base, local, remote];
    for (var i = 0; i < sources.length; i++) {
      var v = sources[i] && sources[i].addedAt;
      if (typeof v === 'number' && isFinite(v) && (best === null || v < best)) best = v;
    }
    return best === null ? now : best;
  }

  function mergeEntity(base, local, remote, spec, options) {
    base = base || {};
    local = local || {};
    remote = remote || {};
    spec = spec || PLAIN_SPEC;
    options = options || {};
    var now = options.now || Date.now();
    var setFields = Object.create(null);
    var list = Array.isArray(spec.setFields) ? spec.setFields : [];
    var i;
    for (i = 0; i < list.length; i++) setFields[list[i]] = true;
    var idFields = spec.idFields || {};

    var merged = {};
    for (var lk in local) {
      if (Object.prototype.hasOwnProperty.call(local, lk)) merged[lk] = local[lk];
    }
    var conflicts = [];

    var fields = Object.create(null);
    var sources = [base, local, remote];
    for (i = 0; i < sources.length; i++) {
      for (var key in sources[i]) {
        if (Object.prototype.hasOwnProperty.call(sources[i], key) && !SKIP_FIELDS[key]) fields[key] = true;
      }
    }

    for (var field in fields) {
      if (setFields[field]) {
        merged[field] = mergeSetField(base[field], local[field], remote[field]);
      } else if (idFields[field]) {
        merged[field] = mergeIdField(field, idFields[field], base[field], local[field], remote[field], conflicts);
      } else {
        mergeScalarField(merged, conflicts, field, base[field], local[field], remote[field]);
      }
    }

    merged.updatedAt = now;
    merged.addedAt = earliestAddedAt(base, local, remote, now);
    return { merged: merged, conflicts: conflicts };
  }

  /* 把冲突项按用户选择（'local' | 'remote'）落进 merged，允许就地修改 */
  function applyChoice(merged, conflict, choice) {
    var value = choice === 'remote' ? conflict.remote : conflict.local;
    if (conflict.kind === 'scalar') {
      setOrDelete(merged, conflict.field, value);
      return merged;
    }
    if (conflict.kind === 'item') {
      var arr = Array.isArray(merged[conflict.field]) ? merged[conflict.field] : [];
      var idKey = conflict.idKey || 'id';
      var idx = -1;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && String(arr[i][idKey]) === String(conflict.itemId)) { idx = i; break; }
      }
      if (value === undefined) {
        if (idx >= 0) arr.splice(idx, 1);
      } else if (idx >= 0) {
        arr[idx] = value;
      } else {
        arr.push(value);
      }
      merged[conflict.field] = arr;
      return merged;
    }
    return merged;
  }

  return {
    PAPER_SPEC: PAPER_SPEC,
    PLAIN_SPEC: PLAIN_SPEC,
    stableStringify: stableStringify,
    stableEqual: stableEqual,
    mergeEntity: mergeEntity,
    applyChoice: applyChoice
  };
});
