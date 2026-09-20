/* LitBoard PDF 重命名模板引擎（ZotFile 风格；浏览器 / Node 共用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitRename = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULT_TEMPLATE = '{author} - {year} - {title}';

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  function familyName(author) {
    var name = text(author).trim();
    if (!name) return '';
    if (name.indexOf(',') !== -1) return name.split(',')[0].trim();
    var parts = name.split(/\s+/);
    return parts[parts.length - 1] || '';
  }

  function sanitize(value, maxLength) {
    var out = text(value)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/[. ]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    var limit = maxLength || 120;
    return out.length > limit ? out.slice(0, limit).replace(/[. ]+$/g, '') : out;
  }

  function tokenValue(paper, token) {
    var authors = paper && Array.isArray(paper.authors) ? paper.authors : [];
    switch (token) {
      case 'author': return familyName(authors[0]) || 'anon';
      case 'authors3': {
        if (!authors.length) return 'anon';
        var names = authors.slice(0, 3).map(familyName);
        return names.join(', ') + (authors.length > 3 ? ' et al.' : '');
      }
      case 'year': return paper && paper.year != null ? String(paper.year) : 'nodate';
      case 'title': return text(paper && paper.title) || 'untitled';
      case 'venue': return text(paper && paper.venue);
      case 'citekey': return text(paper && paper.key);
      default: return null; // 未知 token 原样保留
    }
  }

  /**
   * 按模板生成文件主名（不含扩展名）。
   * 模板 token：{author} {authors3} {year} {title} {venue} {citekey}；未知 token 原样输出。
   */
  function buildName(paper, template, maxLength) {
    var tpl = text(template).trim() || DEFAULT_TEMPLATE;
    var name = tpl.replace(/\{([a-zA-Z0-9]+)\}/g, function (match, token) {
      var value = tokenValue(paper || {}, token);
      return value == null ? match : value;
    });
    return sanitize(name, maxLength) || 'paper';
  }

  return { DEFAULT_TEMPLATE: DEFAULT_TEMPLATE, buildName: buildName, sanitize: sanitize };
});
