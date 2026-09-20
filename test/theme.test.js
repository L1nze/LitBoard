const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CSS_PATH = path.join(ROOT_DIR, 'css', 'style.css');
const HTML_PATH = path.join(ROOT_DIR, 'index.html');
const APP_JS_PATH = path.join(ROOT_DIR, 'js', 'app.js');

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

test('theme system: app.js defines comprehensive themes, metadata, and menu', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');

  assert.ok(appJs.includes("'light-github'"), 'app.js includes light-github');
  assert.ok(appJs.includes("'light-catppuccin'"), 'app.js includes light-catppuccin');
  assert.ok(appJs.includes("'light-solarized'"), 'app.js includes light-solarized');
  assert.ok(appJs.includes("'light-onelight'"), 'app.js includes light-onelight');
  assert.ok(appJs.includes("'light-gruvbox'"), 'app.js includes light-gruvbox');
  assert.ok(appJs.includes("'dark-catppuccin'"), 'app.js includes dark-catppuccin');
  assert.ok(appJs.includes("'dark-dracula'"), 'app.js includes dark-dracula');
  assert.ok(appJs.includes("'dark-tokyonight'"), 'app.js includes dark-tokyonight');
  assert.ok(appJs.includes("'dark-nord'"), 'app.js includes dark-nord');
  assert.ok(appJs.includes("'dark-onedark'"), 'app.js includes dark-onedark');

  assert.ok(appJs.includes('function showThemeMenu()'), 'app.js defines showThemeMenu()');
  assert.ok(appJs.includes('function setTheme('), 'app.js defines setTheme()');
  assert.ok(appJs.includes('sync-theme-select'), 'app.js binds sync-theme-select');
});
