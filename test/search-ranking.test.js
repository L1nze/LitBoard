'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');

test('普通关键词检索接入相关度排序与命中原因展示', function () {
  assert.match(app, /LitQuery\.rankPlainText\(p, f\.q\)/);
  assert.match(app, /plainSearchMatches\[b\.id\].*\.score/s);
  assert.match(app, /search-match-reason/);
  assert.match(css, /\.search-match-reason/);
});

test('全文检索默认按实际命中次数排序，点表头可覆盖', function () {
  assert.match(app, /state\.ftHits\[b\.id\].*\.count/s);
  assert.match(app, /searchSortOverride/);
});
