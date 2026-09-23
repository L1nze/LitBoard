/* LitBoard 拖入文件夹导入的规划层（纯函数，浏览器 / Node 共用）：
 * 输入主进程 files:scan-folder 的目录清单与当前 folders，输出「建哪些文件夹、复用哪些、
 * 每个 PDF 归哪个文件夹」的导入计划。语义对照 zotero-folder-drop-importer：
 * - 拖入的文件夹本身在目标位置建为一个 LitBoard 文件夹（拖到空白 = 根级，拖到某文件夹行 = 它内部）；
 * - 只保留「有 PDF 后代」的目录链（空分支剪枝，避免导入空壳）；
 * - 同父层同名文件夹复用（大小写不敏感、精确大小写优先），重复拖入幂等不重不漏。
 * 文件夹本体不落磁盘：目录树以 folders 实体表达，PDF 由调用方拷入受管附件目录。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitFolderImport = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var NAME_MAX = 80; // 与 normalizeFolders 同限

  function dirOf(rel) {
    var idx = rel.lastIndexOf('/');
    return idx === -1 ? '' : rel.slice(0, idx);
  }

  function cleanName(name) {
    var n = String(name || '').trim();
    return (n ? n : '(未命名)').slice(0, NAME_MAX);
  }

  /** 同父层同名匹配：大小写不敏感（与建文件夹查重同语义），精确大小写优先 */
  function findSibling(list, name) {
    var lower = name.toLowerCase();
    var fallback = null;
    for (var i = 0; i < list.length; i++) {
      var candidate = list[i];
      if (!candidate || candidate.deletedAt) continue;
      var cname = String(candidate.name || '');
      if (cname.toLowerCase() !== lower) continue;
      if (cname === name) return candidate;
      if (!fallback) fallback = candidate;
    }
    return fallback;
  }

  /**
   * planFolderImport({ scan, folders, targetFolderId }) → 导入计划。
   * scan   = files:scan-folder 返回值（ok/rootName/files[{rel,name,ext,abs,size}]）
   * folders = 当前 state.folders（含墓碑也无妨，墓碑不参与复用）
   * targetFolderId = 落点文件夹 id（'' = 根级）
   * 返回 { root:{ id, name }, createList:[{key,name,parentKey}], reuseMap:{key:id},
   *        pdfs:[{rel,name,abs,size,dirRel}], createdCount, reusedCount, skippedNonPdf }
   * createList 按深度 BFS 排序，parentKey '' 指向 root（root.id 可能为空串 = 待新建，由调用方建后回填）。
   */
  function planFolderImport(options) {
    var scan = options && options.scan || {};
    var folders = (options && options.folders) || [];
    var targetFolderId = options && options.targetFolderId || '';
    var liveTarget = null;
    for (var i = 0; i < folders.length; i++) {
      if (folders[i] && folders[i].id === targetFolderId && !folders[i].deletedAt) liveTarget = folders[i];
    }
    if (!liveTarget) targetFolderId = '';

    var all = (scan.files || []).map(function (f) {
      return {
        rel: String(f && f.rel || '').replace(/\\/g, '/'),
        name: String(f && f.name || ''),
        ext: String(f && f.ext || '').toLowerCase(),
        abs: String(f && f.abs || ''),
        size: f && f.size || 0
      };
    });
    var pdfs = [];
    var skippedNonPdf = 0;
    all.forEach(function (f) {
      if (f.ext === '.pdf' || /\.pdf$/i.test(f.name)) pdfs.push(f);
      else skippedNonPdf++;
    });

    // 剪枝：目录集合只从 PDF 的 rel 推导，空分支自然不出现
    var dirSet = {};
    pdfs.forEach(function (f) {
      var dir = dirOf(f.rel);
      while (dir) {
        dirSet[dir] = true;
        dir = dirOf(dir);
      }
    });
    var dirs = Object.keys(dirSet).sort(function (a, b) {
      var da = a.split('/').length, db = b.split('/').length;
      return da !== db ? da - db : (a < b ? -1 : a > b ? 1 : 0);
    });

    // 落点直接子级 → 复用拖入根（重复拖入同一文件夹时幂等）
    var childrenOf = {};
    folders.forEach(function (f) {
      if (!f || f.deletedAt) return;
      var parent = f.parentId || '';
      (childrenOf[parent] = childrenOf[parent] || []).push(f);
    });
    var rootName = cleanName(scan.rootName);
    var rootHit = findSibling(childrenOf[targetFolderId] || [], rootName);
    var root = rootHit ? { id: rootHit.id, name: rootName } : { id: '', name: rootName };

    // 逐层解析：父层已复用 → 本层可继续复用既有同名子级；父层待新建 → 本层只能新建
    var reuseMap = {};
    var createList = [];
    dirs.forEach(function (key) {
      var parentKey = dirOf(key);
      var parentId = parentKey ? (reuseMap[parentKey] || '') : root.id;
      var name = cleanName(key.slice(key.lastIndexOf('/') + 1));
      if (parentId) {
        var hit = findSibling(childrenOf[parentId] || [], name);
        if (hit) { reuseMap[key] = hit.id; return; }
      }
      createList.push({ key: key, name: name, parentKey: parentKey });
    });

    return {
      root: root,
      createList: createList,
      reuseMap: reuseMap,
      pdfs: pdfs.map(function (f) { return { rel: f.rel, name: f.name, abs: f.abs, size: f.size, dirRel: dirOf(f.rel) }; }),
      createdCount: createList.length + (!root.id && pdfs.length ? 1 : 0),
      reusedCount: Object.keys(reuseMap).length + (root.id ? 1 : 0),
      skippedNonPdf: skippedNonPdf
    };
  }

  return { planFolderImport: planFolderImport };
});
