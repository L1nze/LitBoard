/* LitBoard PDF 批量解析：浏览器 / Node 共用，不管理 DOM、工作区或持久化。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitPdfImportFlow = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function parseMany(items, parse, options) {
    options = options || {};
    var concurrency = Math.max(1, Number(options.concurrency) || 3);
    var timeoutMs = Math.max(1, Number(options.timeoutMs) || 75000);
    var onError = typeof options.onError === 'function' ? options.onError : function () {};
    var next = 0;
    var results = new Array(items.length);

    function parseOne(item, index) {
      var timer = null;
      var task = Promise.resolve().then(function () { return parse(item, index); });
      var timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () { reject(new Error('timeout')); }, timeoutMs);
      });
      return Promise.race([task, timeout])
        .then(function (value) { results[index] = value; })
        .catch(function (error) { onError(item, error); })
        .finally(function () {
          if (timer) clearTimeout(timer);
          // 超时只结束结果等待；底层解析尚未停止，须等它退出才释放并发槽位。
          return task.catch(function () {});
        });
    }
    function worker() {
      var index = next++;
      if (index >= items.length) return Promise.resolve();
      return parseOne(items[index], index).then(worker);
    }
    var workers = [];
    for (var i = 0; i < Math.min(concurrency, items.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () { return results.filter(Boolean); });
  }

  /**
   * 选出确实需要复制进受管目录的主 PDF 附件。
   * 已在库中或同一导入批次中出现过的内容指纹直接复用 canonical paper 的附件，
   * 后续 addPapers 会把文件夹归属并入该条目；无指纹时保守复制，避免误判。
   */
  function pdfAttachmentsToStore(papers, existingPapers) {
    var seen = {};
    function remember(paper) {
      if (!paper || paper.deletedAt) return;
      if (paper && /^[a-f0-9]{64}$/i.test(String(paper.pdfFingerprint || ''))) {
        seen[String(paper.pdfFingerprint).toLowerCase()] = true;
      }
      (paper && paper.attachments || []).forEach(function (attachment) {
        if (attachment && attachment.kind === 'pdf' && /^[a-f0-9]{64}$/i.test(String(attachment.fingerprint || ''))) {
          seen[String(attachment.fingerprint).toLowerCase()] = true;
        }
      });
    }
    (existingPapers || []).forEach(remember);

    var result = [];
    (papers || []).forEach(function (paper) {
      var attachment = (paper && paper.attachments || []).find(function (item) {
        return item && item.kind === 'pdf';
      });
      if (!attachment || !attachment.path || !/\.pdf$/i.test(attachment.path)) return;
      var fingerprint = /^[a-f0-9]{64}$/i.test(String(attachment.fingerprint || ''))
        ? String(attachment.fingerprint).toLowerCase() : '';
      if (fingerprint && seen[fingerprint]) return;
      if (fingerprint) seen[fingerprint] = true;
      result.push(attachment);
    });
    return result;
  }

  function storePdfAttachments(papers, existingPapers, storePdf) {
    var tasks = pdfAttachmentsToStore(papers, existingPapers);
    var cursor = 0;
    var failure = null;
    function worker() {
      if (failure) return Promise.resolve();
      var att = tasks[cursor++];
      if (!att) return Promise.resolve();
      return Promise.resolve().then(function () { return storePdf(att.path); }).then(function (result) {
        if (!result || result.error) throw new Error(result && result.error || 'storePdf returned no result');
        if (!result.path) throw new Error('storePdf returned no path');
        att.path = result.path;
        att.fileName = result.name || att.fileName;
      }).catch(function (error) {
        failure = error;
      }).then(worker);
    }
    var workers = [];
    for (var i = 0; i < Math.min(4, tasks.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () { if (failure) throw failure; });
  }

  return { parseMany: parseMany, pdfAttachmentsToStore: pdfAttachmentsToStore,
    storePdfAttachments: storePdfAttachments };
});
