/* LitBoard 库内查重与合并：按 PDF 内容 / DOI 分组，合并保最完整（浏览器 / Node 共用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitDedupe = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function normTitle(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
  }

  function normAuthor(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
  }

  function normDoi(value) {
    return String(value || '').trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').toLowerCase();
  }

  function validFingerprint(value) {
    var fp = String(value || '').toLowerCase();
    return /^[a-f0-9]{64}$/.test(fp) ? fp : '';
  }

  function pdfFingerprints(paper) {
    var seen = {}, result = [];
    function add(value) {
      var fp = validFingerprint(value);
      if (fp && !seen[fp]) { seen[fp] = true; result.push(fp); }
    }
    add(paper && paper.pdfFingerprint);
    (paper && paper.attachments || []).forEach(function (att) {
      if (att && att.kind === 'pdf') add(att.fingerprint);
    });
    return result;
  }

  function isDuplicate(a, b) {
    var fpsA = pdfFingerprints(a), fpsB = pdfFingerprints(b);
    for (var i = 0; i < fpsA.length; i++) {
      if (fpsB.indexOf(fpsA[i]) !== -1) return true;
    }
    var doiA = normDoi(a && a.doi);
    var doiB = normDoi(b && b.doi);
    if (doiA && doiB && doiA === doiB) return true;
    return false;
  }

  function isTitleCandidate(a, b) {
    var doiA = normDoi(a && a.doi);
    var doiB = normDoi(b && b.doi);
    if (doiA && doiB) return false;
    var titleA = normTitle(a && a.title), titleB = normTitle(b && b.title);
    if (!titleA || titleA.length < 6 || titleA !== titleB) return false;
    if (a && b && a.year != null && b.year != null && a.year !== b.year) return false;
    var authorA = normAuthor((a && a.authors || [])[0]);
    var authorB = normAuthor((b && b.authors || [])[0]);
    return !(authorA && authorB && authorA !== authorB);
  }

  var STATUS_RANK = { unread: 0, reading: 1, read: 2 };

  /** 完整度评分：非空字段越多越完整 */
  function completeness(p) {
    var s = 0;
    ['doi', 'abstract', 'venue', 'url', 'oaUrl', 'openalexId', 'pdfPath', 'pdfFingerprint', 'key', 'volume', 'pages'].forEach(function (f) {
      if (p[f]) s++;
    });
    if (p.year != null) s++;
    if (p.citations != null) s++;
    if (p.authors && p.authors.length) s += Math.min(p.authors.length, 3);
    if (p.notes) s += 2; // 用户笔记权重高
    return s;
  }

  /**
   * 找重复组：同 PDF 指纹或同 DOI（忽略大小写）。
   * 返回 [[paper, ...], ...]，每组按完整度降序（组内第一个 = 合并时保留的基准）。
   */
  function findGroups(papers) {
    var parent = papers.map(function (_, i) { return i; });
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    var byDoi = {}, byFingerprint = {};
    papers.forEach(function (p, i) {
      pdfFingerprints(p).forEach(function (fingerprint) {
        if (byFingerprint[fingerprint] != null) union(byFingerprint[fingerprint], i);
        else byFingerprint[fingerprint] = i;
      });
      var doi = normDoi(p.doi);
      if (doi) {
        if (byDoi[doi] != null) union(byDoi[doi], i);
        else byDoi[doi] = i;
      }
    });
    var buckets = {};
    papers.forEach(function (p, i) {
      var r = find(i);
      (buckets[r] = buckets[r] || []).push(p);
    });
    return Object.keys(buckets).map(function (k) { return buckets[k]; })
      .filter(function (g) { return g.length > 1; })
      .map(function (g) {
        return g.slice().sort(function (a, b) {
          var d = completeness(b) - completeness(a);
          if (d) return d;
          return (a.addedAt || 0) - (b.addedAt || 0); // 同分保留更早加入的
        });
      });
  }

  /**
   * 合并一组重复文献 → 单条（保留组内第一条的 id）：
   * 文本字段取第一个非空；年份取非空；被引取最大；作者取最长列表；
   * 标签并集；状态取进度最远；评分取最高；笔记去重拼接；addedAt 取最早。
   */
  function merge(group) {
    var sorted = group.slice().sort(function (a, b) {
      var d = completeness(b) - completeness(a);
      if (d) return d;
      return (a.addedAt || 0) - (b.addedAt || 0);
    });
    var base = sorted[0];
    var m = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) m[k] = base[k];
    m.authors = (base.authors || []).slice();
    m.tags = (base.tags || []).slice();
    m.folderIds = (base.folderIds || []).slice();
    m.pdfAnnotations = (base.pdfAnnotations || []).slice();
    m.relatedIds = (base.relatedIds || []).slice();
    m.attachments = (base.attachments || []).slice();

    var TEXT_FIELDS = ['key', 'entryType', 'doi', 'url', 'abstract', 'venue', 'volume', 'issue', 'pages',
      'publisher', 'issn', 'isbn', 'edition', 'language',
      'oaUrl', 'openalexId', 'pdfFileName', 'pdfPath', 'pdfFingerprint', 'pdfCloudName', 'pdfSyncSignature',
      'zoteroKey', 'zoteroAttachmentKey'];
    var notesList = [];
    if (base.notes) notesList.push(base.notes);
    var tagSet = {};
    var folderSet = {};
    var annotationById = {};
    var relatedSet = {};
    var attachmentById = {};
    m.tags.forEach(function (t) { tagSet[t] = true; });
    m.folderIds.forEach(function (id) { folderSet[id] = true; });
    m.pdfAnnotations.forEach(function (annotation, index) { annotationById[annotation.id] = index; });
    m.relatedIds.forEach(function (id) { relatedSet[id] = true; });
    m.attachments.forEach(function (attachment, index) { attachmentById[attachment.id] = index; });

    sorted.slice(1).forEach(function (p) {
      TEXT_FIELDS.forEach(function (f) { if (!m[f] && p[f]) m[f] = p[f]; });
      if (m.year == null && p.year != null) m.year = p.year;
      if (p.citations != null && (m.citations == null || p.citations > m.citations)) {
        m.citations = p.citations;
        if (p.citationSource) m.citationSource = p.citationSource;
        if (p.citationUpdatedAt) m.citationUpdatedAt = p.citationUpdatedAt;
      }
      if ((p.authors || []).length > m.authors.length) m.authors = p.authors.slice();
      (p.tags || []).forEach(function (t) {
        if (!tagSet[t]) { tagSet[t] = true; m.tags.push(t); }
      });
      (p.folderIds || []).forEach(function (id) {
        if (!folderSet[id]) { folderSet[id] = true; m.folderIds.push(id); }
      });
      (p.pdfAnnotations || []).forEach(function (annotation) {
        var index = annotationById[annotation.id];
        if (index == null) {
          annotationById[annotation.id] = m.pdfAnnotations.length;
          m.pdfAnnotations.push(annotation);
        } else if ((annotation.updatedAt || 0) > (m.pdfAnnotations[index].updatedAt || 0)) {
          m.pdfAnnotations[index] = annotation;
        }
      });
      (p.relatedIds || []).forEach(function (id) {
        if (!relatedSet[id]) { relatedSet[id] = true; m.relatedIds.push(id); }
      });
      (p.attachments || []).forEach(function (attachment) {
        var index = attachmentById[attachment.id];
        if (index == null) {
          attachmentById[attachment.id] = m.attachments.length;
          m.attachments.push(attachment);
        } else {
          // 同 id 附件：优先保留有本地路径/指纹的版本
          var kept = m.attachments[index];
          if (!kept.path && attachment.path) m.attachments[index] = attachment;
        }
      });
      if (p.keyPinned) m.keyPinned = true;
      if ((p.updatedAt || 0) > (m.updatedAt || 0)) m.updatedAt = p.updatedAt;
      if ((STATUS_RANK[p.status] || 0) > (STATUS_RANK[m.status] || 0)) m.status = p.status;
      if ((p.rating || 0) > (m.rating || 0)) m.rating = p.rating;
      if (p.notes && notesList.indexOf(p.notes) === -1) notesList.push(p.notes);
      if (p.addedAt && (!m.addedAt || p.addedAt < m.addedAt)) m.addedAt = p.addedAt;
    });
    m.deletedAt = null; // 合并后的幸存条目始终为活跃状态
    m.notes = notesList.join('\n\n— — — 合并自重复条目 — — —\n\n');
    return m;
  }

  /**
   * 匹配索引：整库一次建索引 O(n)，之后每次查询 O(1)，供导入去重使用。
   * { byFingerprint: fp(lower)→paper, byDoi: doi(lower)→paper }
   * 回收站墓碑不参与自动导入匹配；用户选择新建可见条目时不自动恢复旧记录。
   */
  function createMatchIndex(papers) {
    var index = { byFingerprint: {}, byDoi: {} };
    (papers || []).forEach(function (p) { indexPaper(index, p); });
    return index;
  }

  /** 把新条目登记进索引（导入循环中保持索引新鲜；同键首个条目优先） */
  function indexPaper(index, p) {
    if (!index || !p || p.deletedAt) return;
    pdfFingerprints(p).forEach(function (fingerprint) {
      if (fingerprint && !index.byFingerprint[fingerprint]) index.byFingerprint[fingerprint] = p;
    });
    var doi = normDoi(p.doi);
    if (doi && !index.byDoi[doi]) index.byDoi[doi] = p;
  }

  /**
   * 在索引中找 candidate 的匹配条目：指纹 → DOI。
   * 返回 { paper, reason: 'pdf'|'metadata' } 或 null。
   */
  function findMatch(index, candidate) {
    if (!index || !candidate) return null;
    var fingerprints = pdfFingerprints(candidate);
    for (var i = 0; i < fingerprints.length; i++) {
      if (index.byFingerprint[fingerprints[i]]) {
        return { paper: index.byFingerprint[fingerprints[i]], reason: 'pdf' };
      }
    }
    var doi = normDoi(candidate.doi);
    if (doi && index.byDoi[doi]) return { paper: index.byDoi[doi], reason: 'metadata' };
    return null;
  }

  /** 合并附件并给被合并副本返回保留附件 ID；不会修改任一输入。 */
  function mergeAttachmentsDetailed(target, candidate) {
    var existing = target && target.attachments || [];
    var incoming = candidate && candidate.attachments || [];
    var keptExisting = [], keptIncoming = [], aliases = Object.create(null);
    var byFingerprint = Object.create(null), byPath = Object.create(null), byId = Object.create(null);

    function addKeys(attachment, canonical) {
      if (attachment.fingerprint) {
        var fingerprint = String(attachment.fingerprint).toLowerCase();
        if (!byFingerprint[fingerprint]) byFingerprint[fingerprint] = canonical;
      }
      if (attachment.path) {
        var path = String(attachment.path).toLowerCase();
        if (!byPath[path]) byPath[path] = canonical;
      }
      if (attachment.id && !byId[attachment.id]) byId[attachment.id] = canonical;
    }

    function append(attachment, isIncoming) {
      if (!attachment) return;
      var fingerprint = String(attachment.fingerprint || '').toLowerCase();
      var path = String(attachment.path || '').toLowerCase();
      var canonical = (fingerprint && byFingerprint[fingerprint]) ||
        (path && byPath[path]) || (attachment.id && byId[attachment.id]);
      if (canonical) {
        if (attachment.id && canonical.id && attachment.id !== canonical.id) aliases[attachment.id] = canonical.id;
        // 让通过不同键连起来的后续副本也归到同一份附件。
        addKeys(attachment, canonical);
        return;
      }
      (isIncoming ? keptIncoming : keptExisting).push(attachment);
      addKeys(attachment, attachment);
    }

    existing.forEach(function (attachment) { append(attachment, false); });
    incoming.forEach(function (attachment) { append(attachment, true); });

    var targetHasPdf = existing.some(function (attachment) { return attachment && attachment.kind === 'pdf'; });
    if (targetHasPdf) return {
      attachments: keptExisting.concat(keptIncoming), aliases: aliases, added: keptIncoming
    };

    // 首个新 PDF 置首位，normalizePaper 重投影后成为主 PDF。
    for (var i = 0; i < keptIncoming.length; i++) {
      if (keptIncoming[i] && keptIncoming[i].kind === 'pdf') {
        keptIncoming.unshift(keptIncoming.splice(i, 1)[0]);
        break;
      }
    }
    return { attachments: keptIncoming.concat(keptExisting), aliases: aliases, added: keptIncoming };
  }

  /**
   * 把 candidate 的附件并入 target（Zotero 式导入：命中已有条目时挂 PDF）。
   * 按指纹 > 路径（忽略大小写）> id 合并 target 自身和新附件中的副本，
   * 返回新数组，不改动入参；candidate 无附件且 target 无副本时保持原样。
   */
  function mergeAttachments(target, candidate) {
    return mergeAttachmentsDetailed(target, candidate).attachments;
  }

  return { findGroups: findGroups, merge: merge, completeness: completeness, isDuplicate: isDuplicate,
    createMatchIndex: createMatchIndex, indexPaper: indexPaper, findMatch: findMatch,
    mergeAttachments: mergeAttachments, mergeAttachmentsDetailed: mergeAttachmentsDetailed,
    pdfFingerprints: pdfFingerprints, normDoi: normDoi,
    isTitleCandidate: isTitleCandidate };
});
