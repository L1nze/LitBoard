/* LitBoard 主题与界面语言：主题清单、切换菜单与语言即时生效。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitTheme = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var THEME_KEY = 'litboard.theme';
  var PDF_THEME_KEY = 'litboard.pdfTheme';
  var PDF_ORIGINAL_KEY = 'litboard.pdfOriginalColors';
  // Paper/ink endpoints from upstream palettes; the surround is slightly darker.
  var PDF_THEMES = [
    { id: 'original', name: '', group: 'light', paper: '#ffffff', ink: '#000000', surround: '#eaecf0' },
    { id: 'vitesse-light-soft', name: 'Vitesse Light Soft', group: 'light', paper: '#f1f0e9', ink: '#393a34', surround: '#e3e2da' },
    { id: 'easyread-light', name: 'EasyRead Paper', group: 'light', paper: '#f6f3ec', ink: '#23211d', surround: '#e8e3d8' },
    { id: 'solarized-light', name: 'Solarized Light', group: 'light', paper: '#fdf6e3', ink: '#586e75', surround: '#eee8d5' },
    { id: 'everforest-light', name: 'Everforest Light', group: 'light', paper: '#f3ead3', ink: '#5c6a72', surround: '#e5dfc5' },
    { id: 'catppuccin-latte', name: 'Catppuccin Latte', group: 'light', paper: '#eff1f5', ink: '#4c4f69', surround: '#dce0e8' },
    { id: 'vitesse-dark-soft', name: 'Vitesse Dark Soft', group: 'dark', paper: '#222222', ink: '#d4d0c4', surround: '#191919' },
    { id: 'easyread-dark', name: 'EasyRead Charcoal', group: 'dark', paper: '#1a1917', ink: '#ddd7cb', surround: '#12110f' },
    { id: 'nord', name: 'Nord', group: 'dark', paper: '#2e3440', ink: '#d8dee9', surround: '#242933' },
    { id: 'gruvbox-dark', name: 'Gruvbox Dark Soft', group: 'dark', paper: '#32302f', ink: '#ebdbb2', surround: '#242322' }
  ];

  function pdfTheme(id) {
    return PDF_THEMES.find(function (preset) { return preset.id === id; }) || PDF_THEMES[1];
  }

  function pdfColorTransfer(preset) {
    return [0, 1, 2].map(function (channel) {
      var offset = 1 + channel * 2;
      var ink = parseInt(preset.ink.slice(offset, offset + 2), 16) / 255;
      var paper = parseInt(preset.paper.slice(offset, offset + 2), 16) / 255;
      return { slope: paper - ink, intercept: ink };
    });
  }

  function create(options) {
    var T = options.T;
    var $ = options.$;
    var doc = options.document || document;
    var store = options.localStorage || localStorage;
    var raf = options.raf || requestAnimationFrame;
    var svgUse = options.svgUse;
    var toast = options.toast || function () {};
    var showCtxMenu = options.showCtxMenu;
    var desktop = options.desktop || function () { return null; };
    var i18n = options.i18n || (typeof window !== 'undefined' ? window.LitI18n : null);

    function currentPdfTheme() {
      return pdfTheme(store.getItem(PDF_THEME_KEY)).id;
    }

    function applyPdfTheme() {
      var overlay = $('#pdf-overlay');
      if (!overlay) return;
      var preset = pdfTheme(currentPdfTheme());
      var original = store.getItem(PDF_ORIGINAL_KEY) === '1';
      overlay.setAttribute('data-reading-theme', preset.id);
      overlay.setAttribute('data-reading-scheme', preset.group);
      overlay.setAttribute('data-original-colors', original ? 'true' : 'false');
      overlay.style.setProperty('--pdf-surround', preset.surround);
      overlay.style.setProperty('--pdf-paper', original ? '#ffffff' : preset.paper);
      overlay.style.setProperty('--pdf-swatch', preset.paper);
      overlay.style.setProperty('--pdf-ink', preset.ink);
      // Compensate the dark transfer's hue inversion without changing black/white endpoints.
      var hue = $('#pdf-tone-hue');
      if (hue) hue.setAttribute('values', preset.group === 'dark' ? '180' : '0');
      pdfColorTransfer(preset).forEach(function (transfer, channel) {
        var func = $('#pdf-tone-' + channel);
        if (!func) return;
        func.setAttribute('slope', transfer.slope);
        func.setAttribute('intercept', transfer.intercept);
      });
      var btn = $('#pdf-theme');
      if (btn) {
        btn.title = T('PDF 阅读主题：') + (preset.name || T('原始白纸'));
        btn.setAttribute('aria-label', btn.title);
      }
      var originalBtn = $('#pdf-original-colors');
      if (originalBtn) originalBtn.setAttribute('aria-pressed', original ? 'true' : 'false');
    }

    function setPdfTheme(id) {
      store.setItem(PDF_THEME_KEY, pdfTheme(id).id);
      applyPdfTheme();
    }

    function togglePdfOriginalColors() {
      store.setItem(PDF_ORIGINAL_KEY, store.getItem(PDF_ORIGINAL_KEY) === '1' ? '0' : '1');
      applyPdfTheme();
    }

    function showPdfMenu() {
      var btn = $('#pdf-theme');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      var cur = currentPdfTheme();
      var items = [];
      ['light', 'dark'].forEach(function (group) {
        if (items.length) items.push('sep');
        items.push({ header: group === 'light' ? T('浅色阅读背景') : T('深色阅读背景') });
        PDF_THEMES.filter(function (preset) { return preset.group === group; }).forEach(function (preset) {
          items.push({
            label: (preset.name || T('原始白纸')) + (cur === preset.id ? '  ✓' : ''),
            dot: 'pdf-' + preset.id,
            fn: function () { setPdfTheme(preset.id); }
          });
        });
      });
      showCtxMenu(rect.left - 120, rect.bottom + 6, items);
    }

    var THEMES = [
      'auto',
      'light-github', 'light-catppuccin', 'light-solarized', 'light-onelight', 'light-gruvbox',
      'dark-catppuccin', 'dark-dracula', 'dark-tokyonight', 'dark-nord', 'dark-onedark'
    ];
    var THEME_INFO = {
      'auto':             { label: T('跟随系统'), group: 'auto', icon: 'lb-i-theme-auto' },
      'light':            { label: 'GitHub Light', group: 'light', dot: 'theme-github', icon: 'lb-i-sun' },
      'light-github':     { label: 'GitHub Light', group: 'light', dot: 'theme-github', icon: 'lb-i-sun' },
      'light-catppuccin': { label: 'Catppuccin Latte', group: 'light', dot: 'theme-catppuccin-latte', icon: 'lb-i-sun' },
      'light-solarized':  { label: 'Solarized Light', group: 'light', dot: 'theme-solarized-light', icon: 'lb-i-sun' },
      'light-onelight':   { label: 'One Light', group: 'light', dot: 'theme-onelight', icon: 'lb-i-sun' },
      'light-gruvbox':    { label: 'Gruvbox Light', group: 'light', dot: 'theme-gruvbox-light', icon: 'lb-i-sun' },
      'dark':             { label: 'Catppuccin Mocha', group: 'dark', dot: 'theme-catppuccin-mocha', icon: 'lb-i-moon' },
      'dark-catppuccin':  { label: 'Catppuccin Mocha', group: 'dark', dot: 'theme-catppuccin-mocha', icon: 'lb-i-moon' },
      'dark-dracula':     { label: 'Dracula', group: 'dark', dot: 'theme-dracula', icon: 'lb-i-moon' },
      'dark-tokyonight':  { label: 'Tokyo Night', group: 'dark', dot: 'theme-tokyonight', icon: 'lb-i-moon' },
      'dark-nord':        { label: 'Nord', group: 'dark', dot: 'theme-nord', icon: 'lb-i-moon' },
      'dark-onedark':     { label: 'One Dark', group: 'dark', dot: 'theme-onedark', icon: 'lb-i-moon' }
    };
    var THEME_LABEL = {
      auto: T('跟随系统'),
      light: 'GitHub Light',
      'light-github': 'GitHub Light',
      'light-catppuccin': 'Catppuccin Latte',
      'light-solarized': 'Solarized Light',
      'light-onelight': 'One Light',
      'light-gruvbox': 'Gruvbox Light',
      dark: 'Catppuccin Mocha',
      'dark-catppuccin': 'Catppuccin Mocha',
      'dark-dracula': 'Dracula',
      'dark-tokyonight': 'Tokyo Night',
      'dark-nord': 'Nord',
      'dark-onedark': 'One Dark'
    };
    var THEME_ICON = {
      auto: 'lb-i-theme-auto',
      light: 'lb-i-sun',
      'light-github': 'lb-i-sun',
      'light-catppuccin': 'lb-i-sun',
      'light-solarized': 'lb-i-sun',
      'light-onelight': 'lb-i-sun',
      'light-gruvbox': 'lb-i-sun',
      dark: 'lb-i-moon',
      'dark-catppuccin': 'lb-i-moon',
      'dark-dracula': 'lb-i-moon',
      'dark-tokyonight': 'lb-i-moon',
      'dark-nord': 'lb-i-moon',
      'dark-onedark': 'lb-i-moon'
    };

    function current() {
      return store.getItem(THEME_KEY) || 'auto';
    }

    function apply(t) {
      var root = doc.documentElement;
      // 切换瞬间禁用过渡：Chromium 下仅 color-scheme 变化时，带 background-color
      // 过渡的元素不会重解析 light-dark()，会整片卡在旧色（css 里有 .theme-switching 说明）
      root.classList.add('theme-switching');
      if (t === 'auto') {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', t);
      }
      var info = THEME_INFO[t] || THEME_INFO.auto;
      var themeBtn = $('#btn-theme');
      if (themeBtn) {
        themeBtn.innerHTML = svgUse(info.icon || THEME_ICON[t] || THEME_ICON.auto);
        themeBtn.title = T('主题：') + (info.label || THEME_LABEL[t] || THEME_LABEL.auto) + T('（点击切换）');
      }
      var syncThemeSelect = $('#sync-theme-select');
      if (syncThemeSelect && syncThemeSelect.value !== t) {
        syncThemeSelect.value = t;
      }
      raf(function () {
        raf(function () { root.classList.remove('theme-switching'); });
      });
    }

    function set(t) {
      store.setItem(THEME_KEY, t);
      apply(t);
      var info = THEME_INFO[t] || THEME_INFO.auto;
      toast(T('已应用主题：') + (info.label || THEME_LABEL[t] || t));
    }

    /* 语言切换：词典 + 静态骨架即时重译，动态区域走全量重渲染；无需重启。
     * 同时把解析后的语言镜像进 settings 表，主进程原生对话框据此取文案。 */
    function applyLanguage(value) {
      if (!i18n) return;
      i18n.setLang(value);
      doc.documentElement.lang = i18n.getLang();
      i18n.applyStatic(doc);
      if (options.renderAll) options.renderAll();
      if (options.renderPdfTabs) options.renderPdfTabs();
      applyPdfTheme();
      var bridge = desktop();
      if (bridge && bridge.setSetting) {
        bridge.setSetting('uiLang', i18n.getLang()).catch(function () {});
      }
      toast(i18n.getLang() === 'en' ? 'Interface language: English' : '界面语言：简体中文');
    }

    function cycle() {
      var cur = current();
      var idx = THEMES.indexOf(cur);
      if (idx === -1) {
        if (cur === 'light') idx = THEMES.indexOf('light-github');
        else if (cur === 'dark') idx = THEMES.indexOf('dark-catppuccin');
        else idx = 0;
      }
      set(THEMES[(idx + 1) % THEMES.length]);
    }

    function showMenu() {
      var cur = current();
      var btn = $('#btn-theme');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();

      var isCur = function (key) {
        if (cur === key) return true;
        if (key === 'light-github' && cur === 'light') return true;
        if (key === 'dark-catppuccin' && cur === 'dark') return true;
        return false;
      };

      var items = [
        { header: T('界面与主题') },
        {
          label: T('跟随系统 (Auto)') + (cur === 'auto' ? '  ✓' : ''),
          icon: 'lb-i-theme-auto',
          fn: function () { set('auto'); }
        },
        'sep',
        { header: T('浅色主题 (GitHub Top 5)') },
        {
          label: T('GitHub Light（经典白）') + (isCur('light-github') ? '  ✓' : ''),
          dot: 'theme-github',
          fn: function () { set('light-github'); }
        },
        {
          label: T('Catppuccin Latte（柔和浅色）') + (isCur('light-catppuccin') ? '  ✓' : ''),
          dot: 'theme-catppuccin-latte',
          fn: function () { set('light-catppuccin'); }
        },
        {
          label: T('Solarized Light（日耀米黄）') + (isCur('light-solarized') ? '  ✓' : ''),
          dot: 'theme-solarized-light',
          fn: function () { set('light-solarized'); }
        },
        {
          label: T('One Light（原子浅灰）') + (isCur('light-onelight') ? '  ✓' : ''),
          dot: 'theme-onelight',
          fn: function () { set('light-onelight'); }
        },
        {
          label: T('Gruvbox Light（复古羊皮）') + (isCur('light-gruvbox') ? '  ✓' : ''),
          dot: 'theme-gruvbox-light',
          fn: function () { set('light-gruvbox'); }
        },
        'sep',
        { header: T('深色主题（GitHub 热门）') },
        {
          label: T('Catppuccin Mocha（经典摩卡）') + (isCur('dark-catppuccin') ? '  ✓' : ''),
          dot: 'theme-catppuccin-mocha',
          fn: function () { set('dark-catppuccin'); }
        },
        {
          label: T('Dracula（德古拉紫）') + (isCur('dark-dracula') ? '  ✓' : ''),
          dot: 'theme-dracula',
          fn: function () { set('dark-dracula'); }
        },
        {
          label: T('Tokyo Night（东京夜色）') + (isCur('dark-tokyonight') ? '  ✓' : ''),
          dot: 'theme-tokyonight',
          fn: function () { set('dark-tokyonight'); }
        },
        {
          label: T('Nord（极光冷灰）') + (isCur('dark-nord') ? '  ✓' : ''),
          dot: 'theme-nord',
          fn: function () { set('dark-nord'); }
        },
        {
          label: T('One Dark（原子深灰）') + (isCur('dark-onedark') ? '  ✓' : ''),
          dot: 'theme-onedark',
          fn: function () { set('dark-onedark'); }
        }
      ];

      showCtxMenu(rect.left - 120, rect.bottom + 6, items);
    }

    return {
      THEMES: THEMES,
      THEME_INFO: THEME_INFO,
      apply: apply,
      applyLanguage: applyLanguage,
      current: current,
      cycle: cycle,
      set: set,
      showMenu: showMenu,
      applyPdfTheme: applyPdfTheme,
      currentPdfTheme: currentPdfTheme,
      setPdfTheme: setPdfTheme,
      showPdfMenu: showPdfMenu,
      togglePdfOriginalColors: togglePdfOriginalColors
    };
  }

  return { create: create, THEME_KEY: THEME_KEY, PDF_THEMES: PDF_THEMES, pdfTheme: pdfTheme, pdfColorTransfer: pdfColorTransfer };
});
