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
    $: function (sel) { return sel === '#btn-theme' ? btn : null; },
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
  return { api: api, applied: applied, toasts: toasts, storage: storage, docEl: docEl };
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
