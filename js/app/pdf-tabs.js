/* PDF 阅读标签身份工具：一个文献的不同 PDF 附件必须拥有独立标签。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitPdfTabs = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function key(paperId, attachmentId) {
    return String(paperId || '') + ':' + String(attachmentId || '');
  }

  function find(tabs, paperId, attachmentId) {
    var wanted = key(paperId, attachmentId);
    for (var i = 0; i < (tabs || []).length; i++) {
      if (tabs[i] && tabs[i].key === wanted) return tabs[i];
    }
    return null;
  }

  return { key: key, find: find };
});
