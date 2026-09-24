/* LitBoard 检索语法速查：主检索与 Word 引文检索共用一个浮层。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitSearchHelp = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var target = null;
    function commonRows() {
      var T = options.T;
      return [
        { syntax: T('关键词'), desc: T('直接输入即搜标题 / 作者 / 期刊 / 摘要 / 笔记 / 标签'), example: '锂电池 综述' },
        { syntax: '"精确短语"', desc: T('引号包住整句，词序不拆'), example: '"solid state"' },
        { syntax: 'tag:标签名', desc: T('按标签筛选'), example: 'tag:综述' },
        { syntax: 'year>=2023', desc: T('年份比较（也支持 > < <=，citations、rating 同理）'), example: 'year>=2023' },
        { syntax: 'has:pdf', desc: T('有某种东西：pdf / epub / snapshot / notes / doi / abstract / annotations'), example: 'has:pdf' },
        { syntax: 'missing:doi', desc: T('缺某字段（与 has: 相反）'), example: 'missing:doi' },
        { syntax: 'is:unread', desc: T('阅读状态：unread / reading / read / trash'), example: 'is:unread' },
        { syntax: 'AND / OR / NOT', desc: T('组合条件（必须大写）；相邻条件默认 AND'), example: 'tag:电池 AND year>2022 NOT is:read' }
      ];
    }
    function advancedRows() {
      var T = options.T;
      return [
        { syntax: 'title: author: venue: type: doi: key: …', desc: T('按指定字段匹配，值可加引号（title / author / venue / tag / type / status / rating / year / citations / doi / key / notes / abstract / publisher / place / series / sourcetype）'), example: 'venue:"Nature Energy"' },
        { syntax: 'citations>50', desc: T('数值比较：year / citations / rating'), example: 'citations>50' },
        { syntax: 'annotations>=2', desc: T('数量比较：annotations / notes / attachments / pdfs（必须带比较符）'), example: 'annotations>=2' },
        { syntax: 'folder:"名称"', desc: T('某文件夹（自动包含其全部子文件夹）'), example: 'folder:"课题A"' },
        { syntax: 'lastread>=2024-01-01', desc: T('最近阅读时间（YYYY[-MM[-DD]]）；missing:lastread = 从未读过'), example: 'lastread>=2024-01-01' },
        { syntax: 'ann(text:"量子" color:#ffd400)', desc: T('批注组：组内条件须由同一条批注满足（字段 text / comment / color / page / type / tag）'), example: 'ann(text:"量子" color:#ffd400)' },
        { syntax: 'note("材料" title:方法)', desc: T('笔记组（字段 title / content / format）'), example: 'note("实验材料")' },
        { syntax: 'att(kind:supp)', desc: T('附件组（字段 kind / name / path / zotero）'), example: 'att(kind:supp)' },
        { syntax: '/正则/', desc: T('正则匹配：不区分大小写、不做 Unicode 规范化，仅文献级'), example: '/perovskite.*stab/' },
        { syntax: '( ) 与 ! 取反', desc: T('括号分组、! 或 - 前缀取反；语法解析失败自动退回普通子串搜索'), example: '(tag:电池 OR tag:锂) !is:trash' }
      ];
    }
    function popover() { return options.$('#search-help-pop'); }
    function render() {
      var pop = popover();
      if (!pop) return;
      var T = options.T;
      var esc = options.esc;
      function rows(list) {
        return list.map(function (row) {
          return '<div class="search-help-row"><code>' + esc(row.syntax) + '</code><span class="search-help-desc">' +
            esc(row.desc) + '</span><button type="button" class="search-help-try" data-try="' + esc(row.example) +
            '" title="' + esc(T('点此把示例填进搜索框')) + '">' + esc(row.example) + '</button></div>';
        }).join('');
      }
      pop.innerHTML = '<div class="search-help-head"><span>' + esc(T('检索语法速查')) + '</span>' +
        '<button type="button" class="btn btn-ghost btn-icon" id="search-help-close" title="' + esc(T('关闭')) + '">✕</button></div>' +
        '<p class="search-help-lead">' + esc(T('大多数时候直接输入关键词就够了；要精确一点时用下面几条。点右侧示例立即试用。')) + '</p>' +
        '<div class="search-help-section">' + esc(T('常用')) + '</div><div>' + rows(commonRows()) + '</div>' +
        '<details class="search-help-adv"><summary>' + esc(T('高级语法（字段全表 · 批注/笔记/附件组 · 正则）')) +
        '</summary>' + rows(advancedRows()) + '</details><div class="search-help-foot">' +
        T('不想记语法：点筛选行右侧的放大镜按钮用「可视化构建器」点选条件。') + '</div>';
    }
    function close() {
      var pop = popover();
      if (pop) pop.hidden = true;
    }
    function open(input) {
      var pop = popover();
      if (!pop || !input) return;
      render();
      target = input;
      pop.hidden = false;
      var rect = input.getBoundingClientRect();
      pop.style.left = options.clamp(rect.left, 8, Math.max(8, window.innerWidth - pop.offsetWidth - 8)) + 'px';
      pop.style.top = options.clamp(rect.bottom + 6, 8, Math.max(8, window.innerHeight - pop.offsetHeight - 8)) + 'px';
    }
    function bindButton(input, button) {
      if (!input || !button) return;
      function toggle(event) {
        if (event) event.stopPropagation();
        if (popover().hidden) open(input); else close();
      }
      button.addEventListener('click', toggle);
      input.addEventListener('keydown', function (event) {
        if (event.key === '?' || event.key === '？') { event.preventDefault(); toggle(null); }
      });
    }
    function bind() {
      var pop = popover();
      if (!pop || pop.dataset.bound === '1') return;
      pop.dataset.bound = '1';
      bindButton(options.$('#search'), options.$('#btn-search-help'));
      bindButton(options.$('#word-cite-search'), options.$('#btn-word-cite-help'));
      pop.addEventListener('click', function (event) {
        if (event.target.closest('#search-help-close')) { close(); return; }
        var button = event.target.closest('.search-help-try');
        if (!button || !button.dataset.try || !target) return;
        target.value = button.dataset.try;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        close();
        target.focus();
      });
      document.addEventListener('click', function (event) {
        if (!pop.hidden && !event.target.closest('#search-help-pop') && !event.target.closest('.search-help-btn')) close();
      });
    }
    return { bind: bind, close: close, isOpen: function () { var pop = popover(); return !!pop && !pop.hidden; } };
  }

  return { create: create };
});
