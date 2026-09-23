'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('右侧栏不再提供手动检索页签或面板', function () {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const agentUi = fs.readFileSync(path.join(root, 'js/agentui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.doesNotMatch(html, /manual-panel|rail-search|data-rail="manual"|手动检索/);
  assert.doesNotMatch(agentUi, /manual-panel|rail-search|agent-manual|buildManual|switchPane\(['"]manual/);
  assert.doesNotMatch(css, /agent-manual|manual-panel/);
});
