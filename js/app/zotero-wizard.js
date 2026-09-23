/* LitBoard Zotero 导入向导：选择来源 → 扫描预览 → 导入 → 核对报告（四步）。
 * 状态与全部向导事件绑定归本模块；工作区合并走注入的 mergeZoteroImport / applySyncedWorkspace。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitZoteroWizard = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var T = options.T;
    var $ = options.$;
    var $all = options.$all;
    var esc = options.esc;
    var toast = options.toast;
    var desktop = options.desktop || function () { return null; };
    var state = options.state || function () { return { papers: [], notes: [], folders: [], folderTombstones: [], tagColorRecords: [] }; };
    var mergeZoteroImport = options.mergeZoteroImport;
    var applySyncedWorkspace = options.applySyncedWorkspace;
    var download = options.download;
    var stamp = options.stamp || function () { return new Date().toISOString().slice(0, 10); };

    var zoteroWiz = { step: 'source', dir: '', scan: null, report: null, busy: false, offProgress: null };
    var ZOTERO_WIZ_LABELS = { source: T('选择来源'), preview: T('扫描预览'), progress: T('导入'), report: T('核对报告') };
    var ZOTERO_WIZ_ORDER = ['source', 'preview', 'progress', 'report'];

    function zoteroWizRender() {
      var index = ZOTERO_WIZ_ORDER.indexOf(zoteroWiz.step);
      $('#zotero-wiz-step-label').textContent = T('第 ') + (index + 1) + T(' 步 / 共 4 步：') + ZOTERO_WIZ_LABELS[zoteroWiz.step];
      $all('#zotero-import-mask .zotero-wiz-step').forEach(function (el) {
        el.hidden = el.dataset.zoteroStep !== zoteroWiz.step;
      });
      $('#zotero-wiz-back').hidden = zoteroWiz.step !== 'preview' || zoteroWiz.busy;
      $('#zotero-wiz-cancel').textContent = zoteroWiz.step === 'report' ? T('关闭') : T('取消');
      $('#zotero-wiz-cancel').disabled = zoteroWiz.busy;
      $('#zotero-wiz-export').hidden = zoteroWiz.step !== 'report';
      var next = $('#zotero-wiz-next');
      next.disabled = zoteroWiz.busy || (zoteroWiz.step === 'source' && !zoteroWiz.dir);
      next.hidden = zoteroWiz.step === 'progress';
      next.textContent = zoteroWiz.step === 'report' ? T('完成')
        : zoteroWiz.step === 'preview' ? T('开始导入') : T('下一步');
      if (zoteroWiz.step === 'preview' && zoteroWiz.scan) {
        var s = zoteroWiz.scan.stats;
        $('#zotero-wiz-stats').innerHTML = '<table class="zotero-report-table">' +
          T('<tr><td>条目</td><td>') + s.source.items + '</td></tr>' +
          T('<tr><td>笔记</td><td>') + s.source.notes + '</td></tr>' +
          T('<tr><td>附件</td><td>') + s.source.attachments + '</td></tr>' +
          T('<tr><td>批注</td><td>') + s.source.annotations + '</td></tr>' +
          T('<tr><td>文件夹</td><td>') + s.source.collections + '</td></tr>' +
          T('<tr><td>标签</td><td>') + s.source.tags + '</td></tr>' +
          (s.missing ? T('<tr><td>缺失/未下载附件</td><td>') + s.missing + '</td></tr>' : '') +
          (s.unconverted ? T('<tr><td>保留原始表示的内容</td><td>') + s.unconverted + '</td></tr>' : '') +
          (s.failures ? T('<tr><td>无法读取的条目</td><td>') + s.failures + '</td></tr>' : '') +
          '</table>';
      }
    }

    function zoteroWizGo(step) { zoteroWiz.step = step; zoteroWizRender(); }

    function open() {
      if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
      zoteroWiz = { step: 'source', dir: $('#sync-zotero-dir').value.trim(), scan: null, report: null, busy: false, offProgress: null };
      $('#zotero-wiz-dir').value = zoteroWiz.dir;
      $('#zotero-wiz-source-status').textContent = '';
      $('#zotero-import-mask').hidden = false;
      zoteroWizRender();
    }

    function close() {
      if (zoteroWiz.busy) return;
      if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
      $('#zotero-import-mask').hidden = true;
    }

    function zoteroWizFail(message) {
      zoteroWiz.busy = false;
      $('#zotero-wiz-source-status').textContent = message;
      zoteroWizRender();
      toast('⚠ ' + message);
    }

    function zoteroWizScan() {
      var bridge = desktop();
      if (!bridge) return;
      zoteroWiz.busy = true;
      $('#zotero-wiz-source-status').textContent = T('正在只读扫描 Zotero 库…');
      zoteroWizRender();
      bridge.scanZoteroLibrary({ dir: zoteroWiz.dir }).then(function (result) {
        zoteroWiz.busy = false;
        zoteroWiz.scan = result;
        zoteroWizGo('preview');
      }).catch(function (error) {
        zoteroWizFail(error && error.message || String(error));
      });
    }

    function zoteroWizReportGroup(title, items, format) {
      if (!items || !items.length) return '';
      return '<details class="zotero-report-group"><summary>' + esc(title) + '（' + items.length + '）</summary>' +
        '<ul class="zotero-report-list">' + items.slice(0, 500).map(function (item) {
          return '<li>' + esc(format(item)) + '</li>';
        }).join('') + (items.length > 500 ? T('<li>…（其余 ') + (items.length - 500) + T(' 条见导出报告）</li>') : '') +
        '</ul></details>';
    }

    function zoteroWizShowReport(importResult, mergeResult) {
      var report = importResult.report;
      var imp = report.imported;
      var stats = mergeResult.stats;
      var html = '<table class="zotero-report-table">' +
        T('<tr><td>新增条目</td><td>') + stats.papersAdded + '</td></tr>' +
        T('<tr><td>补缺更新条目</td><td>') + stats.papersUpdated + '</td></tr>' +
        T('<tr><td>新增附件</td><td>') + stats.attachmentsAdded + T('（复制文件 ') + imp.assetsCopied +
          (imp.assetsSkipped ? T('，跳过已存在 ') + imp.assetsSkipped : '') + '）</td></tr>' +
        T('<tr><td>新增笔记</td><td>') + stats.notesAdded + (stats.notesSkipped ? T('（已有 ') + stats.notesSkipped + T(' 条未覆盖）') : '') + '</td></tr>' +
        T('<tr><td>导入批注</td><td>') + (imp.annotations + stats.annotationsAdded) + '</td></tr>' +
        T('<tr><td>文件夹 / 标签颜色</td><td>') + imp.folders + ' / ' + imp.tagColors + '</td></tr>' +
        '</table>';
      html += zoteroWizReportGroup(T('缺失 / 未下载的附件（可稍后用「导入 Zotero 云端 PDF」补齐）'), report.missing, function (m) {
        return (m.fileName || m.zoteroKey) + ' — ' + ({ 'not-found': T('源文件不存在'), 'relative-no-base': T('相对路径缺少基准目录'), 'annotation-orphan': T('批注找不到所属附件') })[m.reason] || m.reason;
      });
      html += zoteroWizReportGroup(T('失败项（不影响其余内容导入）'), report.failures, function (f) {
        return '[' + f.kind + '] ' + f.key + ' — ' + f.message;
      });
      html += zoteroWizReportGroup(T('保留原始表示的内容'), report.unconverted, function (u) {
        return '[' + u.kind + '] ' + u.key + (u.detail ? ' — ' + u.detail : '');
      });
      html += zoteroWizReportGroup(T('字段差异（已保留本地值，未覆盖）'), mergeResult.conflicts, function (c) {
        return c.field + T('：本地「') + (c.localValue || T('（空）')) + '」 ≠ Zotero「' + (c.zoteroValue || T('（空）')) + '」';
      });
      $('#zotero-wiz-report').innerHTML = html || T('<p class="field-hint">没有可导入的内容。</p>');
      zoteroWiz.report = { import: report, merge: { stats: mergeResult.stats, conflicts: mergeResult.conflicts } };
      zoteroWizGo('report');
    }

    function zoteroWizImport() {
      var bridge = desktop();
      if (!bridge) return;
      zoteroWiz.busy = true;
      zoteroWizGo('progress');
      var ws = state();
      var existing = { attachmentKeys: [], noteKeys: [], paperKeys: [] };
      ws.papers.forEach(function (p) {
        if (p.zoteroKey) existing.paperKeys.push(p.zoteroKey);
        (p.attachments || []).forEach(function (a) {
          if (a.zoteroKey && a.path && String(a.path).trim()) existing.attachmentKeys.push(a.zoteroKey);
        });
      });
      (ws.notes || []).forEach(function (n) { if (n.zoteroKey) existing.noteKeys.push(n.zoteroKey); });
      if (bridge.onZoteroProgress) {
        zoteroWiz.offProgress = bridge.onZoteroProgress(function (payload) {
          if (!payload || zoteroWiz.step !== 'progress') return;
          var total = payload.total || 0, done = payload.done || 0;
          $('#zotero-wiz-progress').max = Math.max(total, 1);
          $('#zotero-wiz-progress').value = done;
          $('#zotero-wiz-progress-text').textContent = T('正在复制附件文件… ') + done + ' / ' + total;
        });
      }
      bridge.importZoteroLibrary({
        dir: zoteroWiz.dir,
        copyFiles: $('#zotero-wiz-copy').checked,
        existing: existing
      }).then(function (result) {
        var mergeResult = mergeZoteroImport({
          papers: ws.papers, notes: ws.notes, folders: ws.folders.concat(ws.folderTombstones),
          tagColorRecords: ws.tagColorRecords
        }, result.workspace);
        return applySyncedWorkspace(mergeResult.workspace).then(function () {
          zoteroWiz.busy = false;
          if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
          zoteroWizShowReport(result, mergeResult);
          toast(T('✓ Zotero 导入完成：新增 ') + mergeResult.stats.papersAdded + T(' 篇'));
        });
      }).catch(function (error) {
        if (zoteroWiz.offProgress) { zoteroWiz.offProgress(); zoteroWiz.offProgress = null; }
        zoteroWizGo('source');
        zoteroWizFail(error && error.message || String(error));
      });
    }

    function bind() {
      $('#zotero-wiz-detect').addEventListener('click', function () {
        $('#zotero-wiz-source-status').textContent = T('正在检测…');
        desktop().detectZoteroDataDir().then(function (dir) {
          zoteroWiz.dir = dir || '';
          $('#zotero-wiz-dir').value = zoteroWiz.dir;
          $('#zotero-wiz-source-status').textContent = dir ? T('已找到：') + dir : T('未找到 Zotero 数据目录');
          zoteroWizRender();
        });
      });
      $('#zotero-wiz-choose').addEventListener('click', function () {
        desktop().chooseZoteroDataDir().then(function (dir) {
          if (dir) {
            zoteroWiz.dir = dir;
            $('#zotero-wiz-dir').value = dir;
            $('#zotero-wiz-source-status').textContent = T('已选择：') + dir;
            zoteroWizRender();
          } else {
            $('#zotero-wiz-source-status').textContent = T('所选目录不是有效的 Zotero 数据目录');
          }
        });
      });
      $('#zotero-wiz-next').addEventListener('click', function () {
        if (zoteroWiz.step === 'source') zoteroWizScan();
        else if (zoteroWiz.step === 'preview') zoteroWizImport();
        else if (zoteroWiz.step === 'report') close();
      });
      $('#zotero-wiz-back').addEventListener('click', function () {
        if (zoteroWiz.step === 'preview') zoteroWizGo('source');
      });
      $('#zotero-wiz-cancel').addEventListener('click', close);
      $('#zotero-wiz-export').addEventListener('click', function () {
        if (!zoteroWiz.report) return;
        download('zotero-import-report-' + stamp() + '.json', JSON.stringify(zoteroWiz.report, null, 2), 'application/json');
      });
      $('#sync-import-zotero').addEventListener('click', function () {
        open();
      });
    }

    return {
      bind: bind,
      close: close,
      open: open,
      stateForTest: function () { return zoteroWiz; }
    };
  }

  return { create: create };
});
