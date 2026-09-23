'use strict';

/*
 * 设置页「改动即时保存」的静态护栏。
 *
 * 页脚写着「改动即时保存，关闭窗口也会保存」，而自动保存靠的是 app.js 里一份控件 id 清单
 * （change → queueSyncAutoSave）。清单漏项不会报错、不会崩：用户改完关窗，值就是没存，
 * 直到下次打开设置发现回显还是旧值。期刊分区服务商、检索/元数据服务、向量模型都栽在这上面，
 * 所以这里把「每个控件都得有自己的落盘通道」钉成断言。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

/** 设置弹窗（#sync-mask 到下一层 modal-mask 之间）里的输入控件 id */
function settingsControlIds() {
  const start = html.indexOf('id="sync-mask"');
  const end = html.indexOf('id="sync-conflict-mask"');
  assert.ok(start > 0 && end > start, 'index.html 里找不到设置弹窗边界');
  const segment = html.slice(start, end);
  return [...segment.matchAll(/<(?:input|select|textarea)\b[^>]*id="([^"]+)"/g)].map(function (m) { return m[1]; });
}

/** app.js 里挂到 queueSyncAutoSave 的控件清单（change 即自动保存） */
function autoSaveIds() {
  const match = app.match(
    /\['sync-nutstore-url',[\s\S]*?\]\.forEach\(function \(id\) \{\s*\$\('#' \+ id\)\.addEventListener\('change', queueSyncAutoSave\);/
  );
  assert.ok(match, 'app.js 里找不到自动保存控件清单');
  return [...match[0].matchAll(/'([a-z0-9-]+)'/g)]
    .map(function (m) { return m[1]; })
    .filter(function (id) { return id !== 'change'; });
}

/* 不走 change 清单、自带落盘通道的控件：各自有监听或按钮，改动同样会落地。 */
const SELF_SAVING = new Set([
  'sync-config-dir',          // 「选择」按钮 → 数据目录流程（改目录是搬移语义，独立通道）
  'sync-library-dir',
  'sync-backup-dir',
  'sync-theme-select',        // 立即生效，写 settings 表
  'sync-lang-select',
  'sync-translator-auto',     // 立即生效，写 settings 表
  'sync-web-search-enabled',  // 出境告知确认之后才落盘（见 change 监听）
  'sync-zotero-dir'           // readonly，由「自动检测 / 选择」按钮写值并触发保存
]);

test('设置页每个控件都有落盘通道：改了就得真保存', function () {
  const bound = new Set(autoSaveIds());
  const orphans = settingsControlIds().filter(function (id) {
    return !bound.has(id) && !SELF_SAVING.has(id);
  });
  assert.deepEqual(orphans, [],
    '这些控件改了不会保存（补进自动保存清单或写清自带通道）：' + orphans.join('、'));
});

test('自动保存清单里的 id 都真实存在：取不到元素就是启动即崩', function () {
  const declared = new Set([...html.matchAll(/id="([^"]+)"/g)].map(function (m) { return m[1]; }));
  const missing = autoSaveIds().filter(function (id) { return !declared.has(id); });
  assert.deepEqual(missing, [], 'index.html 里没有这些 id：' + missing.join('、'));
});

test('设置页未装载时提交空表单：不把 HTML 默认值写回配置', function () {
  // 打开设置页之前表单里全是 HTML 默认值（下拉首项、空输入框、默认勾选态）；
  // 此时若有别的通道触发自动保存（如 AI 对话面板底部切换模型），提交默认值会覆盖已存配置。
  assert.match(app, /if \(!syncFormLoaded\) return \{\};/, 'syncFormValue 缺少表单装载守卫');
  assert.match(app, /syncFormLoaded = true;/, 'fillSyncForm 没有置位表单装载标记');
});
