const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT_DIR, 'css', 'style.css');
const HTML_PATH = path.join(ROOT_DIR, 'index.html');
const APP_JS_PATH = path.join(ROOT_DIR, 'js', 'app.js');
const THEME_JS_PATH = path.join(ROOT_DIR, 'js', 'app', 'theme.js');
const LitTheme = require('../js/app/theme.js');

test('theme system: CSS declarations and design tokens for GitHub Top 5 Light and Dark themes', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');

  // 1. color-scheme selectors
  assert.ok(css.includes(':root[data-theme="light"], :root[data-theme^="light-"]'), 'light color-scheme selector exists');
  assert.ok(css.includes(':root[data-theme="dark"],  :root[data-theme^="dark-"]'), 'dark color-scheme selector exists');

  // 2. Top 5 Light themes
  const expectedLightThemes = [
    'light-github',
    'light-catppuccin',
    'light-solarized',
    'light-onelight',
    'light-gruvbox'
  ];

  for (const theme of expectedLightThemes) {
    assert.ok(css.includes(`data-theme="${theme}"`), `CSS should declare light theme: ${theme}`);
  }

  // 3. Top 5 Dark themes
  const expectedDarkThemes = [
    'dark-catppuccin',
    'dark-dracula',
    'dark-tokyonight',
    'dark-nord',
    'dark-onedark'
  ];

  for (const theme of expectedDarkThemes) {
    assert.ok(css.includes(`data-theme="${theme}"`), `CSS should declare dark theme: ${theme}`);
  }

  // 4. Essential design tokens defined
  const requiredTokens = [
    '--page',
    '--surface-1',
    '--surface-2',
    '--surface-3',
    '--text-primary',
    '--accent',
    '--border'
  ];

  for (const theme of [...expectedLightThemes, ...expectedDarkThemes]) {
    const themeRegex = new RegExp(`:root\\[data-theme=["']${theme}["']\\][^{]*\\{([^}]+)\\}`, 'm');
    const match = css.match(themeRegex);
    assert.ok(match, `Should find CSS block for :root[data-theme="${theme}"]`);
    const block = match[1];
    for (const token of requiredTokens) {
      assert.ok(block.includes(token), `Theme ${theme} should define token ${token}`);
    }
  }

  // 5. Signature color dots for context menu
  const expectedDots = [
    'ctx-dot-theme-github',
    'ctx-dot-theme-catppuccin-latte',
    'ctx-dot-theme-solarized-light',
    'ctx-dot-theme-onelight',
    'ctx-dot-theme-gruvbox-light',
    'ctx-dot-theme-catppuccin-mocha',
    'ctx-dot-theme-dracula',
    'ctx-dot-theme-tokyonight',
    'ctx-dot-theme-nord',
    'ctx-dot-theme-onedark'
  ];

  for (const dot of expectedDots) {
    assert.ok(css.includes(`.${dot}`), `CSS should define signature dot class: .${dot}`);
  }
});

test('theme system: index.html preferences selector contains all 10 themes and auto', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  assert.ok(html.includes('id="sync-theme-select"'), 'index.html contains sync-theme-select');
  assert.ok(html.includes('value="auto"'), 'contains auto option');

  const themes = [
    'light-github', 'light-catppuccin', 'light-solarized', 'light-onelight', 'light-gruvbox',
    'dark-catppuccin', 'dark-dracula', 'dark-tokyonight', 'dark-nord', 'dark-onedark'
  ];

  for (const t of themes) {
    assert.ok(html.includes(`value="${t}"`), `index.html select should have option for ${t}`);
  }
});

test('theme system: theme module defines comprehensive themes, metadata, and menu', () => {
  const themeJs = fs.readFileSync(THEME_JS_PATH, 'utf8');

  assert.ok(themeJs.includes("'light-github'"), 'theme.js includes light-github');
  assert.ok(themeJs.includes("'light-catppuccin'"), 'theme.js includes light-catppuccin');
  assert.ok(themeJs.includes("'light-solarized'"), 'theme.js includes light-solarized');
  assert.ok(themeJs.includes("'light-onelight'"), 'theme.js includes light-onelight');
  assert.ok(themeJs.includes("'light-gruvbox'"), 'theme.js includes light-gruvbox');
  assert.ok(themeJs.includes("'dark-catppuccin'"), 'theme.js includes dark-catppuccin');
  assert.ok(themeJs.includes("'dark-dracula'"), 'theme.js includes dark-dracula');
  assert.ok(themeJs.includes("'dark-tokyonight'"), 'theme.js includes dark-tokyonight');
  assert.ok(themeJs.includes("'dark-nord'"), 'theme.js includes dark-nord');
  assert.ok(themeJs.includes("'dark-onedark'"), 'theme.js includes dark-onedark');

  assert.ok(themeJs.includes('function showMenu()'), 'theme.js defines showMenu()');
  assert.ok(themeJs.includes('function set(t)'), 'theme.js defines set()');
  assert.ok(themeJs.includes('sync-theme-select'), 'theme.js syncs sync-theme-select');

  // app.js 保留适配层与设置页绑定
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
  assert.ok(appJs.includes('window.LitTheme'), 'app.js wires the theme module');
  assert.ok(appJs.includes('sync-theme-select'), 'app.js binds sync-theme-select');
});

/* ---- LitTheme 模块单元级：create(options) 全注入，Node 可测 ---- */

function makeThemeHarness() {
  const applied = [];
  const toasts = [];
  const storage = new Map();
  const reader = {
    attrs: {},
    props: {},
    setAttribute: function (k, v) { this.attrs[k] = v; },
    style: { setProperty: function (k, v) { reader.props[k] = v; } }
  };
  const tone = [0, 1, 2].map(function () {
    return { attrs: {}, setAttribute: function (k, v) { this.attrs[k] = v; } };
  });
  const originalBtn = { setAttribute: function (k, v) { this[k] = v; } };
  const docEl = {
    lang: '',
    attrs: {},
    classes: new Set(),
    setAttribute: function (k, v) { this.attrs[k] = v; },
    removeAttribute: function (k) { delete this.attrs[k]; },
    classList: {
      add: function (c) { docEl.classes.add(c); },
      remove: function (c) { docEl.classes.delete(c); }
    }
  };
  const btn = {
    innerHTML: '',
    title: '',
    getBoundingClientRect: function () { return { left: 100, bottom: 40 }; }
  };
  const api = LitTheme.create({
    T: function (s) { return s; },
    $: function (sel) {
      if (sel === '#btn-theme' || sel === '#pdf-theme') return btn;
      if (sel === '#pdf-overlay') return reader;
      if (sel === '#pdf-original-colors') return originalBtn;
      if (sel.indexOf('#pdf-tone-') === 0) return tone[Number(sel.slice(-1))];
      return null;
    },
    document: { documentElement: docEl },
    localStorage: {
      getItem: function (k) { return storage.has(k) ? storage.get(k) : null; },
      setItem: function (k, v) { storage.set(k, v); }
    },
    raf: function (fn) { fn(); },
    svgUse: function (id) { return '<svg data-icon="' + id + '"/>'; },
    toast: function (msg) { toasts.push(msg); },
    showCtxMenu: function (x, y, items) { api._menu = items; },
    renderAll: function () {},
    renderPdfTabs: function () {},
    desktop: function () { return null; },
    i18n: null
  });
  btn.setAttribute = function (k, v) { this[k] = v; };
  return { api: api, applied: applied, toasts: toasts, storage: storage, docEl: docEl, reader: reader, tone: tone, originalBtn: originalBtn };
}

test('LitTheme：apply 设置 data-theme；auto 移除；切换类最终被清掉', () => {
  const h = makeThemeHarness();
  h.api.apply('dark-dracula');
  assert.strictEqual(h.docEl.attrs['data-theme'], 'dark-dracula');
  assert.strictEqual(h.docEl.classes.size, 0, 'theme-switching 应在 raf 后移除');
  h.api.apply('auto');
  assert.ok(!('data-theme' in h.docEl.attrs), 'auto 应移除 data-theme');
});

test('LitTheme：set 持久化并提示；cycle 沿清单环切（legacy light/dark 归位）', () => {
  const h = makeThemeHarness();
  h.api.set('light-gruvbox');
  assert.strictEqual(h.api.current(), 'light-gruvbox');
  assert.ok(h.toasts.some(function (m) { return m.indexOf('Gruvbox Light') !== -1; }));
  h.api.cycle();
  assert.strictEqual(h.api.current(), 'dark-catppuccin', '浅色末位环切到深色首位');

  const h2 = makeThemeHarness();
  h2.storage.set('litboard.theme', 'dark'); // 旧版别名
  h2.api.cycle();
  assert.strictEqual(h2.api.current(), 'dark-dracula', 'legacy dark 归位到 dark-catppuccin 后再环切');
});

test('LitTheme：showMenu 产出三段结构；当前主题打勾；菜单项可触发 set', () => {
  const h = makeThemeHarness();
  h.api.set('dark-nord');
  h.api.showMenu();
  const items = h.api._menu;
  const headers = items.filter(function (it) { return it && it.header; });
  assert.strictEqual(headers.length, 3, '界面与主题 / 浅色 / 深色 三段');
  const clickable = items.filter(function (it) { return it && typeof it === 'object' && typeof it.fn === 'function'; });
  assert.strictEqual(clickable.length, 11, 'auto + 5 浅色 + 5 深色');
  const nord = clickable.find(function (it) { return it.label.indexOf('Nord') !== -1; });
  assert.ok(nord.label.indexOf('✓') !== -1, '当前主题应打勾');
  const dracula = clickable.find(function (it) { return it.label.indexOf('Dracula') !== -1; });
  dracula.fn();
  assert.strictEqual(h.api.current(), 'dark-dracula');
});

test('LitTheme：applyLanguage 未注入 i18n 时静默返回（不抛错）', () => {
  const h = makeThemeHarness();
  assert.doesNotThrow(function () { h.api.applyLanguage('en'); });
});

test('PDF 主题：默认 Vitesse；独立持久化；未知旧值回退；原色开关保留外围主题', () => {
  const h = makeThemeHarness();
  h.api.applyPdfTheme();
  assert.equal(h.api.currentPdfTheme(), 'vitesse-light-soft');
  assert.equal(h.reader.props['--pdf-paper'], '#f1f0e9');
  h.api.setPdfTheme('nord');
  assert.equal(h.storage.get('litboard.pdfTheme'), 'nord');
  assert.equal(h.reader.attrs['data-reading-scheme'], 'dark');
  h.api.set('light-github');
  assert.equal(h.api.currentPdfTheme(), 'nord');
  h.api.togglePdfOriginalColors();
  assert.equal(h.reader.props['--pdf-paper'], '#ffffff');
  assert.equal(h.reader.props['--pdf-surround'], '#242933');
  assert.equal(h.reader.props['--pdf-swatch'], '#2e3440');
  assert.equal(h.originalBtn['aria-pressed'], 'true');
  h.api.togglePdfOriginalColors();
  assert.equal(h.reader.props['--pdf-paper'], '#2e3440');
  h.storage.set('litboard.pdfTheme', 'retired-preset');
  h.api.applyPdfTheme();
  assert.equal(h.api.currentPdfTheme(), 'vitesse-light-soft');
});

test('PDF 主题：黑白像素精确映射到文字和纸面颜色；所有主题正文对比度至少 4.5', () => {
  const channels = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const luminance = hex => channels(hex).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const preset of LitTheme.PDF_THEMES) {
    LitTheme.pdfColorTransfer(preset).forEach((transfer, i) => {
      assert.ok(Math.abs(transfer.intercept - channels(preset.ink)[i]) < 1e-10);
      assert.ok(Math.abs(transfer.slope + transfer.intercept - channels(preset.paper)[i]) < 1e-10);
    });
    const [lo, hi] = [luminance(preset.paper), luminance(preset.ink)].sort((a, b) => a - b);
    assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5, preset.id + ' readable contrast');
  }
});

test('PDF 主题菜单：浅暗分组；当前项标记；色板选择即时生效', () => {
  const h = makeThemeHarness();
  h.api.showPdfMenu();
  assert.equal(h.api._menu.filter(item => item.header).length, 2);
  const items = h.api._menu.filter(item => typeof item.fn === 'function');
  assert.equal(items.length, LitTheme.PDF_THEMES.length);
  assert.ok(items.find(item => item.label.includes('Vitesse Light Soft')).label.includes('✓'));
  items.find(item => item.label.includes('EasyRead Charcoal')).fn();
  assert.equal(h.api.currentPdfTheme(), 'easyread-dark');
  assert.equal(h.reader.props['--pdf-paper'], '#1a1917');
});
