'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const codemod = require('../scripts/i18n-codemod.js');
const LitI18n = require('../js/i18n.js');
require('../js/i18n-en.js'); // 注册 en 词典（register 幂等）

// Node 环境（无 window）init 恒为源语言 zh-CN；需要译文时显式 setLang(..., { persist: false })
const ROOT = path.join(__dirname, '..');

// 用 i18n-en.js 注册时的实参截获整本英文词典（register 幂等，重复加载无害）
let enDictCache = null;
function getEnDict() {
  if (enDictCache) return enDictCache;
  const orig = LitI18n.register;
  let captured = null;
  LitI18n.register = function (lang, dict) {
    if (lang === 'en') captured = dict;
    return orig.call(LitI18n, lang, dict);
  };
  delete require.cache[require.resolve('../js/i18n-en.js')];
  try { require('../js/i18n-en.js'); } finally { LitI18n.register = orig; }
  enDictCache = captured || {};
  return enDictCache;
}

test('normalizeLang：语言码归一化', () => {
  assert.strictEqual(LitI18n.normalizeLang('en'), 'en');
  assert.strictEqual(LitI18n.normalizeLang('en-US'), 'en');
  assert.strictEqual(LitI18n.normalizeLang('zh_TW'), 'zh-CN');
  assert.strictEqual(LitI18n.normalizeLang('zh-Hans-CN'), 'zh-CN');
  assert.strictEqual(LitI18n.normalizeLang('fr'), '');
  assert.strictEqual(LitI18n.normalizeLang(''), '');
  assert.strictEqual(LitI18n.normalizeLang(null), '');
});

test('t：zh-CN 恒等；未命中键回退原文', () => {
  LitI18n.setLang('zh-CN', { persist: false });
  assert.strictEqual(LitI18n.t('撤销'), '撤销');
  assert.strictEqual(LitI18n.t('彻底不存在的键'), '彻底不存在的键');
  assert.strictEqual(LitI18n.t(''), '');
  assert.strictEqual(LitI18n.t(null), '');
});

test('t：en 词典命中 + {name} 插值 + 缺参保留占位', () => {
  LitI18n.setLang('en', { persist: false });
  assert.strictEqual(LitI18n.t('撤销'), 'Undo');
  assert.strictEqual(LitI18n.t('彻底不存在的键'), '彻底不存在的键');
  assert.strictEqual(LitI18n.t('{n} 项', { n: 3 }), '3 项');
  assert.strictEqual(LitI18n.t('{x} + {y}', { x: 1 }), '1 + {y}');
  LitI18n.setLang('zh-CN', { persist: false });
});

test('setLang：切换通知监听器；同语重设不触发；auto 跟随系统', () => {
  const seen = [];
  const off = LitI18n.onChange((lang) => seen.push(lang));
  LitI18n.setLang('en', { persist: false });
  LitI18n.setLang('zh-CN', { persist: false });
  assert.deepStrictEqual(seen, ['en', 'zh-CN']);
  LitI18n.setLang('zh-CN', { persist: false });
  assert.deepStrictEqual(seen, ['en', 'zh-CN']);
  off();
  const auto = LitI18n.setLang('auto', { persist: false });
  assert.ok(auto === 'zh-CN' || auto === 'en');
  LitI18n.setLang('zh-CN', { persist: false });
});

test('pick：trim 后按键查译文；源语言或缺失返回 null', () => {
  LitI18n.setLang('en', { persist: false });
  assert.strictEqual(LitI18n.pick('删除', 'en'), 'Delete');
  assert.strictEqual(LitI18n.pick('不存在的键xyz', 'en'), null);
  assert.strictEqual(LitI18n.pick('删除', 'zh-CN'), null);
  LitI18n.setLang('zh-CN', { persist: false });
});

// electron/ipc/ 下的域模块自动枚举：新增 IPC 域文件无需改这里即进 T() 键覆盖门禁
const WRAPPED_FILES = [
  'js/app.js', 'js/app/note-panel.js', 'js/app/search-help.js', 'js/app/workspace-store.js', 'js/app/history.js', 'js/app/dialogs.js', 'js/app/theme.js', 'js/app/zotero-wizard.js', 'js/app/remote-plan.js', 'js/app/journal-rank.js', 'js/app/query-builder.js', 'js/app/word-panel.js', 'js/app/note-export.js', 'js/model.js', 'js/sync.js', 'js/query.js', 'js/zotero.js',
  'js/pdfimport.js', 'js/csldoc.js', 'js/cslcite.js', 'js/docx.js',
  'js/translators.js', 'js/noteeditor.js', 'js/epub.js', 'js/translate.js',
  'js/ocr.js', 'electron/main.js'
].concat(fs.readdirSync(path.join(ROOT, 'electron', 'ipc'))
  .filter(function (f) { return /\.js$/.test(f); })
  .map(function (f) { return 'electron/ipc/' + f; }));

test('词典覆盖：全部 T() 键都有非空英文译文', () => {
  const dict = getEnDict();
  const missing = [];
  for (const f of WRAPPED_FILES) {
    for (const key of codemod.extractKeys(path.join(ROOT, f))) {
      const v = dict[key];
      if (v === undefined || v === null || v === '') missing.push(f + ' :: ' + key);
    }
  }
  assert.strictEqual(missing.length, 0, '缺译：\n' + missing.slice(0, 20).join('\n'));
});

test('词典覆盖：index.html 静态文案都有英文译文', () => {
  const dict = getEnDict();
  const missing = [];
  for (const key of codemod.htmlKeys(path.join(ROOT, 'index.html'))) {
    const v = dict[key];
    if (v === undefined || v === null || v === '') missing.push(key);
  }
  assert.strictEqual(missing.length, 0, '缺译：\n' + missing.slice(0, 20).join('\n'));
});

test('词典健康：无恒等翻译（值不等于键）', () => {
  const dict = getEnDict();
  const identity = Object.keys(dict).filter((k) => dict[k] === k);
  assert.strictEqual(identity.length, 0, '恒等条目：' + identity.slice(0, 10).join(' | '));
});

test('词典健康：整段 HTML 键的译文保持标签结构', () => {
  const dict = getEnDict();
  const broken = [];
  for (const [k, v] of Object.entries(dict)) {
    if (!/^</.test(k)) continue;
    // 键可能是与动态内容拼接的 HTML 前半段（不以 > 结尾），但必须保留标签形态
    if (!/^</.test(v) || !v.includes('>')) broken.push(k + ' => ' + v);
  }
  assert.strictEqual(broken.length, 0, 'HTML 译文结构异常：\n' + broken.slice(0, 10).join('\n'));
});

// A-followup #7：渲染层模块自建的 T 包装必须把第二个参数（插值数据）透传给 LitI18n.t，
// 否则 T('第 {n} 页', {n: 7}) 会原样显示成「第 {n} 页」（阅读位置 chip 曾如此）。
test('词典健康：自建 T 包装透传插值参数（否则 {n} 类键显示成字面占位符）', () => {
  const broken = [];
  for (const f of ['js/agentui.js', 'js/graphview.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const def = src.match(/var T = function \(([^)]*)\)/);
    if (!def) continue;
    const params = def[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (params.length < 2) broken.push(f + '：包装只接受 ' + JSON.stringify(def[1]));
    // 调用点也必须真的把第二个参数传下去
    if (!/LitI18n\.t\(s,\s*params\)/.test(src)) broken.push(f + '：LitI18n.t 未收到插值参数');
  }
  assert.strictEqual(broken.length, 0, broken.join('\n'));
});
