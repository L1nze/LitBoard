/* LitBoard 作者实体管理：相似名归并与批量改写（浏览器 / Node 共用） */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAuthors = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function text(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  /**
   * 作者名 → 归一化键。支持 "Family, Given"、"Given Family"、CJK 全名。
   * 键 = family 小写 + given 各段首字母（去点号），对缩写/全拼差异敏感但容错大小写与标点。
   */
  function nameKey(name) {
    var value = text(name).trim().replace(/\s+/g, ' ');
    if (!value) return '';
    // CJK 全名（无空格无逗号）直接小写
    if (/^[㐀-鿿·]+$/.test(value)) return value.toLowerCase();
    var family = '', given = '';
    if (value.indexOf(',') !== -1) {
      var parts = value.split(',');
      family = parts[0].trim();
      given = parts.slice(1).join(' ').trim();
    } else {
      var tokens = value.split(' ');
      family = tokens.pop() || '';
      given = tokens.join(' ');
    }
    var initials = given.split(/\s+/).map(function (token) {
      return token.charAt(0).toLowerCase();
    }).join('');
    return family.toLowerCase() + '|' + initials;
  }

  /**
   * 扫描全库，找出"同一人多种写法"的分组。
   * 返回 [{ key, suggested, variants: [{ name, count }] }]，suggested 取出现最多（平手取更长）的写法。
   */
  function findMergeGroups(papers) {
    var groups = {};
    (papers || []).forEach(function (paper) {
      if (paper && paper.deletedAt) return;
      (paper.authors || []).forEach(function (raw) {
        var name = text(raw).trim();
        var key = nameKey(name);
        if (!key) return;
        if (!groups[key]) groups[key] = {};
        groups[key][name] = (groups[key][name] || 0) + 1;
      });
    });
    return Object.keys(groups).map(function (key) {
      var variants = Object.keys(groups[key]).map(function (name) {
        return { name: name, count: groups[key][name] };
      }).sort(function (a, b) { return b.count - a.count || b.name.length - a.name.length; });
      return { key: key, suggested: variants[0].name, variants: variants };
    }).filter(function (group) { return group.variants.length > 1; })
      .sort(function (a, b) {
        var totalA = a.variants.reduce(function (s, v) { return s + v.count; }, 0);
        var totalB = b.variants.reduce(function (s, v) { return s + v.count; }, 0);
        return totalB - totalA;
      });
  }

  /**
   * 把 fromNames 精确替换为 toName（就地修改 papers 的 authors 数组并去重）。
   * 返回 { papersChanged, occurrences }。
   */
  function mergeAuthors(papers, fromNames, toName) {
    var target = text(toName).trim();
    var fromSet = {};
    (fromNames || []).forEach(function (name) { fromSet[text(name).trim()] = true; });
    var papersChanged = 0, occurrences = 0;
    if (!target) return { papersChanged: 0, occurrences: 0 };
    (papers || []).forEach(function (paper) {
      var authors = paper && paper.authors;
      if (!Array.isArray(authors) || !authors.length) return;
      var changed = false, seen = {};
      var next = [];
      authors.forEach(function (raw) {
        var name = text(raw).trim();
        if (fromSet[name]) { name = target; occurrences++; changed = true; }
        if (!name || seen[name]) { changed = true; return; }
        seen[name] = true;
        next.push(name);
      });
      if (changed) {
        paper.authors = next;
        papersChanged++;
      }
    });
    return { papersChanged: papersChanged, occurrences: occurrences };
  }

  return { nameKey: nameKey, findMergeGroups: findMergeGroups, mergeAuthors: mergeAuthors };
});
