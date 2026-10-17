'use strict';

/* 聊天富内容后处理模块（js/agentchatrich.js，2026-10 自 agentui 拆出）的回归：
 * mermaid 主题预设必须双份（明/暗）、背景透明融入气泡、字体族与文字色齐备，
 * 且节点文字色 ≠ 节点底色（图框文字与背景的最低对比护栏——曾用内置主题导致对照失衡）。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Rich = require('../js/agentchatrich.js');

const PRESETS = Rich.mermaidThemePresets;

test('mermaid 主题预设：明暗双份、背景透明、字体与文字色齐备', () => {
  assert.ok(PRESETS && PRESETS.light && PRESETS.dark, '明暗两套预设都在');
  for (const [key, preset] of Object.entries(PRESETS)) {
    const v = preset.variables;
    assert.equal(v.background, 'transparent', key + '：背景透明，融入聊天气泡底色');
    assert.ok(v.fontFamily && v.fontFamily.includes('Segoe UI'), key + '：字体族跟随应用界面');
    assert.ok(v.fontSize, key + '：字号显式设定');
    assert.ok(v.primaryColor && v.primaryTextColor && v.textColor, key + '：节点底色与文字色齐备');
    assert.notEqual(v.primaryColor, v.primaryTextColor, key + '：节点文字色不得等于节点底色');
    assert.ok(v.lineColor && v.edgeLabelBackground, key + '：连线与边标签衬底齐备');
  }
});

test('mermaid 主题预设：暗色文字色按 Catppuccin Mocha 提亮，与节点底色拉开层次', () => {
  const dark = PRESETS.dark.variables;
  assert.equal(dark.primaryColor, '#313244');   // Mocha surface0
  assert.equal(dark.primaryTextColor, '#e2e8f7'); // 应用 --text-primary（暗）
  assert.equal(dark.edgeLabelBackground, '#1e1e2e'); // Mocha base = 气泡底
  const light = PRESETS.light.variables;
  assert.equal(light.primaryTextColor, '#0f172a');  // 应用 --text-primary（亮）
});

test('模块面：typesetMath/watchChatRich 存在（LitAgentUi.typesetMath 的实现端）', () => {
  assert.equal(typeof Rich.typesetMath, 'function');
  assert.equal(typeof Rich.watchChatRich, 'function');
});
