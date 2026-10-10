/* LitBoard 远端同步对照：冲突决议、仅本机条目处置、远端检查/恢复/应用。
 * 弹窗状态机与全部绑定归本模块；同步管线经注入回调回写 app.js。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitRemotePlan = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var T = options.T;
    var $ = options.$;
    var esc = options.esc;
    var toast = options.toast;
    var debounce = options.debounce;
    var desktop = options.desktop();
    var syncFormValue = options.syncFormValue;
    var workspacePayload = options.workspacePayload;
    var setSyncInlineStatus = options.setSyncInlineStatus;
    var applySyncedWorkspace = options.applySyncedWorkspace;
    var applyPortableConfigRuntime = options.applyPortableConfigRuntime;
    var fillSyncForm = options.fillSyncForm;
    var setSyncIndicator = options.setSyncIndicator;
    var isSyncBusy = options.isSyncBusy || function () { return false; };
    var setSyncBusy = options.setSyncBusy || function () {};
    var download = options.download;
    var stamp = options.stamp || function () { return new Date().toISOString().slice(0, 10); };
    var refreshSyncFormAfterSync = false;

    function showSyncConflicts(conflicts) {
      toast(T('同步冲突：') + conflicts.length + T(' 条本地修改被云端版本覆盖'), 9000, {
        label: T('查看'), fn: function () {
          var list = $('#sync-conflict-list');
          list.innerHTML = '';
          conflicts.forEach(function (c) {
            var row = document.createElement('div');
            row.className = 'sync-conflict-row';
            row.innerHTML = '<span class="sync-conflict-title">' + esc(c.title || c.id) + '</span>' +
              T('<span class="sync-conflict-dir">以云端版本为准</span>');
            list.appendChild(row);
          });
          $('#sync-conflict-mask').hidden = false;
          pendingConflictExport = conflicts;
        }
      });
    }
    var pendingConflictExport = [];
    var pendingRemotePlan = null;
    var mirrorLocalSnapshot = null;
    var pendingRemoteResolutions = {};
    var LOCAL_EMPTY_RESET_KEY = 'plan:local-empty-reset'; // 与主进程 integrations.js 保持一致
    var MASS_DROP_RESET_KEY = 'plan:mass-drop-reset';     // 合并将大批移除云端词条的强制确认
    var FIRST_UPLOAD_KEY = 'plan:first-upload';           // 云端无库、本机非空的首传确认
    var remotePlanApplying = false;
    var remotePlanStopping = false;
    // 计划生成进行中：生成占用主进程同步槽位（runSyncTask 串行），渲染层必须
    // 同步置 busy——否则编辑防抖/15 分钟定时/限流续传的后台同步会插队，一边在
    // 主进程撞车报「已有同步任务正在进行」，一边递增 inspectionRevision 把刚
    // 生成的对照静默作废，状态行永远停在「正在读取云端并生成对照…」。
    var remotePlanCreating = false;

    function remotePlanId(plan) {
      return plan && (plan.planId || plan.id || plan.token) || '';
    }

    function remotePlanConflicts(plan) {
      return plan && (Array.isArray(plan.conflicts) ? plan.conflicts :
        Array.isArray(plan.fieldConflicts) ? plan.fieldConflicts : []) || [];
    }

    function remotePlanLocalOnly(plan) {
      return plan && (Array.isArray(plan.localOnly) ? plan.localOnly :
        Array.isArray(plan.localOnlyEntities) ? plan.localOnlyEntities : []) || [];
    }

    function remoteConflictKey(conflict, index) {
      return String(conflict && (conflict.conflictId || conflict.id) ||
        (conflict && conflict.collection || 'papers') + ':' + (conflict && conflict.entityId || conflict && conflict.itemId || '') + ':' +
        (conflict && conflict.field || '') + ':' + index);
    }

    function remoteConflictLabel(conflict) {
      var collection = conflict && conflict.collection || 'papers';
      var id = conflict && (conflict.entityId || conflict.id || conflict.itemId) || '';
      var field = conflict && (conflict.field || conflict.label) || T('实体');
      return collection + ' · ' + (conflict && (conflict.title || id) || id) + ' · ' + field;
    }

    var remotePlanModel = {
      items: [],
      requiredKeys: new Set(),
      resolvedKeys: new Set(),
      filteredItems: [],
      renderedCount: 0,
      filterText: '',
      chunkSize: 60,
      rowMap: new Map(),
      scrollTicking: false
    };

    function remotePlanValue(value) {
      if (value === undefined || value === null) return T('（不存在 / 删除）');
      if (typeof value === 'string') return value.length > 1500 ? (value.slice(0, 1500) + T('…（长文本截断）')) : (value || T('（空）'));
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      try {
        var s = JSON.stringify(value, null, 2);
        return s.length > 1500 ? (s.slice(0, 1500) + T('\n…（超长结构截断）')) : s;
      } catch (error) {
        return String(value);
      }
    }

    function updateRemotePlanRowVisual(row, choice) {
      var buttons = row.querySelectorAll('[data-remote-choice]');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var isSel = (btn.dataset.remoteChoice === choice);
        btn.classList.toggle('selected', isSel);
        if (btn.parentElement && btn.parentElement.classList.contains('remote-plan-value')) {
          btn.parentElement.classList.toggle('selected', isSel);
        }
      }
    }

    function updateRemotePlanApplyButton() {
      var isComplete = (remotePlanModel.resolvedKeys.size >= remotePlanModel.requiredKeys.size);
      var applyBtn = $('#sync-remote-plan-apply');
      if (applyBtn) applyBtn.disabled = !isComplete;
    }

    function updateRemotePlanSummary() {
      if (!pendingRemotePlan) return;
      var totalRequired = remotePlanModel.requiredKeys.size;
      var resolvedCount = remotePlanModel.resolvedKeys.size;
      if (pendingRemotePlan.mode === 'mirror') {
        $('#sync-remote-plan-summary').textContent = T('以本机为准整理云端') + ' · ' +
          T('本机有效文献：') + pendingRemotePlan.localCount + T(' 篇') + ' · ' +
          T('云端有效文献：') + pendingRemotePlan.remoteCount + T(' 篇') + ' · ' +
          T('多余文件：') + (pendingRemotePlan.extras || []).length + ' · ' + T('待补齐附件：') + (pendingRemotePlan.missing || []).length +
          ' · ' + T('备份目录：') + pendingRemotePlan.archivePath +
          (pendingRemotePlan.cleanupSupported ? '' : ' · ' + T('部分文件缺少版本标识，暂不可归档，只能同步文献'));
        return;
      }
      var localOnlyCount = remotePlanModel.items.filter(function (item) { return item.kind === 'local-only'; }).length;
      var remoteState = pendingRemotePlan.remoteExists === false
        ? T('云端库文件不存在')
        : T('云端 ') + (pendingRemotePlan.remoteCount == null ? T('未知') : pendingRemotePlan.remoteCount) + T(' 篇');
      var summary = (pendingRemotePlan.mode === 'restore' ? T('云端恢复') : T('普通同步')) +
        ' · ' + remoteState +
        T(' · 待选择 ') + totalRequired + T(' 项（已选 ') + resolvedCount + '/' + totalRequired + '）' +
        (localOnlyCount ? T('，仅本机 ') + localOnlyCount + T(' 项') : '') + '。' +
        T('采用本机＝本机保留；云端无此条目时会重新上传，云端已有另一版本时保持云端副本不变。') +
        T('采用云端＝本机改用云端内容。') +
        (pendingRemotePlan.localEmptyReset ? T('检测到本机文献为 0 而同步基线仍有内容（常见于本机读取失败或切换过数据目录），已暂停自动同步，请先选择处理方式。') :
          (pendingRemotePlan.remoteResetSuspected ? T('检测到云端库从非空突然变为 0 篇，已暂停自动同步，请确认保留本机。') :
            (pendingRemotePlan.massDropSuspected ? T('检测到本次合并会把云端 ') + pendingRemotePlan.massDropCount + T(' 篇文献移除（常见于本机数据目录切换或整批丢失），已暂停自动写入，请先在顶部确认。') : ''))) +
        (pendingRemotePlan.firstUploadSuspected ? T('云端还没有文献库文件，将把本机 ') + (pendingRemotePlan.localPaperCount == null ? '' : pendingRemotePlan.localPaperCount) + T(' 篇上传为新云端库；如非预期请检查账号与同步目录名。') : '') +
        (pendingRemotePlan.remoteEtag ? T('云端内容在应用前会再次核对。') : '');
      $('#sync-remote-plan-summary').textContent = summary;
    }

    function setRemotePlanChoice(key, choice) {
      pendingRemoteResolutions[key] = choice;
      if (remotePlanModel.requiredKeys.has(key)) {
        if (choice === 'local' || choice === 'remote') {
          remotePlanModel.resolvedKeys.add(key);
        } else {
          remotePlanModel.resolvedKeys.delete(key);
        }
        updateRemotePlanApplyButton();
      }
      var row = remotePlanModel.rowMap.get(key) || (typeof window !== 'undefined' && window.CSS && window.CSS.escape ? document.querySelector('[data-remote-conflict-key="' + window.CSS.escape(key) + '"]') : null);
      if (row) {
        updateRemotePlanRowVisual(row, choice);
      }
      updateRemotePlanBulkButtons();
    }

    // 批量按钮的「已应用」态由未决项的实际选择反推：全部未决项都指向同一侧才算生效，
    // 逐项改过就自动熄灭——既是点击反馈，也不会显示过期的状态。
    function uniformRemotePlanChoice() {
      var keys = remotePlanModel.requiredKeys;
      if (!keys.size) return '';
      var first = '';
      keys.forEach(function (key) { if (!first) first = pendingRemoteResolutions[key]; });
      if (first !== 'local' && first !== 'remote') return '';
      var uniform = true;
      keys.forEach(function (key) { if (pendingRemoteResolutions[key] !== first) uniform = false; });
      return uniform ? first : '';
    }

    function updateRemotePlanBulkButtons() {
      var applied = uniformRemotePlanChoice();
      [['#sync-remote-choose-local', 'local'], ['#sync-remote-choose-remote', 'remote']].forEach(function (pair) {
        var btn = $(pair[0]);
        if (!btn) return;
        var on = (applied === pair[1]);
        btn.classList.toggle('selected', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.title = on ? T('全部未决项当前都采用这一侧（逐项改动后会取消）') : '';
      });
    }

    function batchSetRemotePlanChoices(choice) {
      if (!pendingRemotePlan) return;
      var label = choice === 'local' ? T('采用本机版本') : T('采用云端版本');
      var changed = 0;
      var undecided = 0;
      for (var i = 0; i < remotePlanModel.items.length; i++) {
        var item = remotePlanModel.items[i];
        if (item.kind === 'info') continue;
        if (pendingRemoteResolutions[item.key] !== choice) changed++;
        pendingRemoteResolutions[item.key] = choice;
        if (item.isRequired) {
          if (!remotePlanModel.resolvedKeys.has(item.key)) undecided++;
          remotePlanModel.resolvedKeys.add(item.key);
        }
      }
      updateRemotePlanApplyButton();
      remotePlanModel.rowMap.forEach(function (row) {
        updateRemotePlanRowVisual(row, choice);
      });
      updateRemotePlanSummary();
      updateRemotePlanBulkButtons();
      // 列表可能滚在别处、行也未必在视口里，点完必须当场有回音
      toast(changed
        ? T('✓ 已将 ') + changed + T(' 项设为「') + label + '」' + (undecided ? T('，未决项已全部有选择') : '')
        : T('所有条目本来就是「') + label + '」');
    }

    function createRemotePlanRow(item) {
      var key = item.key;
      var row = document.createElement('div');
      row.className = 'remote-plan-row';
      row.dataset.remoteConflictKey = key;
      var head = document.createElement('div');
      head.className = 'remote-plan-row-head';
      head.textContent = item.label;
      var hint = document.createElement('small');
      hint.textContent = item.hint;
      head.appendChild(hint);
      row.appendChild(head);

      if (item.kind === 'info') return row;
      var curChoice = pendingRemoteResolutions[key];

      if (item.kind === 'conflict') {
        var values = document.createElement('div');
        values.className = 'remote-plan-values';
        var localBox = document.createElement('div');
        localBox.className = 'remote-plan-value' + (curChoice === 'local' ? ' selected' : '');
        var localText = document.createElement('div');
        localText.textContent = remotePlanValue(item.localVal);
        localBox.appendChild(localText);
        var localBtn = document.createElement('button');
        localBtn.type = 'button';
        localBtn.className = 'btn' + (curChoice === 'local' ? ' selected' : '');
        localBtn.dataset.remoteChoice = 'local';
        localBtn.textContent = T('采用本机版本');
        localBox.appendChild(localBtn);
        values.appendChild(localBox);

        var remoteBox = document.createElement('div');
        remoteBox.className = 'remote-plan-value' + (curChoice === 'remote' ? ' selected' : '');
        var remoteText = document.createElement('div');
        remoteText.textContent = remotePlanValue(item.remoteVal);
        remoteBox.appendChild(remoteText);
        var remoteBtn = document.createElement('button');
        remoteBtn.type = 'button';
        remoteBtn.className = 'btn' + (curChoice === 'remote' ? ' selected' : '');
        remoteBtn.dataset.remoteChoice = 'remote';
        remoteBtn.textContent = T('采用云端版本');
        remoteBox.appendChild(remoteBtn);
        values.appendChild(remoteBox);

        row.appendChild(values);
      } else {
        var buttons = document.createElement('div');
        buttons.className = 'remote-plan-toolbar';
        var keepBtn = document.createElement('button');
        keepBtn.type = 'button';
        keepBtn.className = 'btn' + (curChoice === 'local' ? ' selected' : '');
        keepBtn.dataset.remoteChoice = 'local';
        keepBtn.textContent = item.localLabel || T('保留本机');
        buttons.appendChild(keepBtn);

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn' + (curChoice === 'remote' ? ' selected' : '');
        removeBtn.dataset.remoteChoice = 'remote';
        removeBtn.textContent = item.remoteLabel || T('从本机移除');
        buttons.appendChild(removeBtn);

        row.appendChild(buttons);
      }
      return row;
    }

    function appendRemotePlanChunk() {
      var list = $('#sync-remote-plan-list');
      if (!list) return;
      var filtered = remotePlanModel.filteredItems;
      var start = remotePlanModel.renderedCount;
      if (start >= filtered.length) return;
      var end = Math.min(filtered.length, start + remotePlanModel.chunkSize);
      var frag = document.createDocumentFragment();
      for (var i = start; i < end; i++) {
        var item = filtered[i];
        var row = createRemotePlanRow(item);
        remotePlanModel.rowMap.set(item.key, row);
        frag.appendChild(row);
      }
      list.appendChild(frag);
      remotePlanModel.renderedCount = end;

      var oldMore = list.querySelector('.remote-plan-more-hint');
      if (oldMore) oldMore.remove();
      if (end < filtered.length) {
        var moreHint = document.createElement('div');
        moreHint.className = 'remote-plan-more-hint';
        moreHint.style.cssText = 'text-align:center;padding:8px;font-size:12px;color:var(--text-muted);cursor:pointer;';
        moreHint.textContent = T('已显示 ') + end + T(' / 共 ') + filtered.length + T(' 项（向下滚动继续加载，或点击此处全部加载）');
        moreHint.addEventListener('click', function () {
          remotePlanModel.chunkSize = filtered.length;
          appendRemotePlanChunk();
        });
        list.appendChild(moreHint);
      }
    }

    function applyRemotePlanFilter(query) {
      remotePlanModel.filterText = String(query || '').trim().toLowerCase();
      if (!remotePlanModel.filterText) {
        remotePlanModel.filteredItems = remotePlanModel.items;
      } else {
        var q = remotePlanModel.filterText;
        remotePlanModel.filteredItems = remotePlanModel.items.filter(function (item) {
          return (item.label && item.label.toLowerCase().indexOf(q) !== -1) ||
            (item.localText && item.localText.toLowerCase().indexOf(q) !== -1) ||
            (item.remoteText && item.remoteText.toLowerCase().indexOf(q) !== -1);
        });
      }
      var list = $('#sync-remote-plan-list');
      if (list) {
        list.innerHTML = '';
        remotePlanModel.renderedCount = 0;
        remotePlanModel.rowMap.clear();
        appendRemotePlanChunk();
      }
    }

    function renderRemotePlan(plan) {
      pendingRemotePlan = plan;
      pendingRemoteResolutions = {};
      remotePlanModel.items = [];
      remotePlanModel.requiredKeys.clear();
      remotePlanModel.resolvedKeys.clear();
      remotePlanModel.renderedCount = 0;
      remotePlanModel.rowMap.clear();
      remotePlanModel.filterText = '';
      remotePlanModel.chunkSize = 60;

      var isMirror = plan.mode === 'mirror';
      $('#sync-mirror-options').hidden = !isMirror;
      $('#sync-mirror-confirm').checked = false;
      var cleanupBox = $('#sync-mirror-cleanup');
      cleanupBox.checked = false;
      cleanupBox.disabled = !plan.cleanupSupported;
      // 禁用必须当场说明原因：顶部摘要距勾选框隔了整个清单，用户只看到「点不动」
      var cleanupBlock = plan.cleanupSupported ? '' :
        T('云端未提供这些文件的可靠版本标识（ETag），归档已停用，本次仅同步文献条目');
      cleanupBox.title = cleanupBlock;
      var cleanupHint = $('#sync-mirror-cleanup-hint');
      if (cleanupHint) {
        cleanupHint.hidden = plan.cleanupSupported;
        cleanupHint.textContent = cleanupBlock;
      }
      $('#sync-remote-choose-local').hidden = isMirror;
      $('#sync-remote-choose-remote').hidden = isMirror;
      $('#sync-remote-plan-title').textContent = isMirror ? T('以本机为准整理云端') : T('云端同步对照');
      if (isMirror) {
        remotePlanModel.requiredKeys.add('mirror:confirm');
        pendingRemoteResolutions['mirror:cleanup'] = 'remote';
        (plan.changes || []).forEach(function (change, index) {
          var action = change.action === 'remove' ? T('从云端库移除') : change.action === 'upload' ? T('上传本机条目') : T('以本机内容更新');
          remotePlanModel.items.push({ key: 'mirror-change:' + index, kind: 'info', label: action + ' · ' + ({ papers: T('文献'), notes: T('笔记'), folders: T('文件夹'), savedSearches: T('智能文件夹'), tagColorRecords: T('标签颜色') }[change.collection] || '') + ' · ' + change.title, hint: '', localText: change.title });
        });
        (plan.extras || []).forEach(function (asset, index) {
          remotePlanModel.items.push({ key: 'mirror-extra:' + index, kind: 'info', label: T('多余文件 · ') + asset.name,
            hint: T('仅勾选归档时移动；未勾选则保留原文件'), remoteText: asset.name });
        });
        (plan.missing || []).forEach(function (asset, index) {
          remotePlanModel.items.push({ key: 'mirror-missing:' + index, kind: 'info', label: T('待补齐附件 · ') + asset.name,
            hint: asset.hasLocalPath ? T('执行时核对本机文件并补传') : T('本机未登记文件路径；无法补齐时会停止整理'), localText: asset.name });
        });
      }

      var allConflicts = remotePlanConflicts(plan);
      var conflicts = allConflicts.filter(function (conflict) { return conflict.direction !== 'local-only'; });
      var localOnly = remotePlanLocalOnly(plan);

      // 「本机为空疑似重置」：作为必选决议置顶——不选就不能应用，避免把
      // 「读不到」静默当成「已删除」清空远端。
      if (plan.localEmptyReset) {
        remotePlanModel.requiredKeys.add(LOCAL_EMPTY_RESET_KEY);
        remotePlanModel.items.push({
          key: LOCAL_EMPTY_RESET_KEY,
          kind: 'conflict',
          label: T('⚠ 本机工作区为空（0 篇），同步基线仍有内容'),
          hint: T('本机为空常见于数据库读取失败或切换过数据目录；正常删除的条目仍会留下占位记录，不会整库消失'),
          localVal: T('本机：空库（0 篇）——选择将按空库覆盖云端'),
          remoteVal: plan.baseRecoveryAvailable
            ? T('上次同步基线：') + plan.baseRecoveryCount + T(' 篇——选择将从本机同步基线恢复双方元数据')
            : T('云端：') + (plan.remoteCount == null ? T('未知') : plan.remoteCount) + T(' 篇——选择将把云端内容拉回本机'),
          localText: T('本机为空库'),
          remoteText: plan.baseRecoveryAvailable ? T('同步基线恢复') : T('云端完整库'),
          isRequired: true
        });
      }

      // 「合并会大批移除云端词条」断路器：本地整批缺失被当成删除传播时强制确认，
      // 杜绝「本地 4 篇覆盖云端 210 篇」式静默事故。
      if (plan.massDropSuspected) {
        remotePlanModel.requiredKeys.add(MASS_DROP_RESET_KEY);
        remotePlanModel.items.push({
          key: MASS_DROP_RESET_KEY,
          kind: 'conflict',
          label: T('⚠ 本次同步会把云端 ') + plan.massDropCount + T(' 篇文献移除'),
          hint: T('常见原因：本机切换过数据目录或部分数据读取失败。真删了这么多也在这里确认。'),
          localVal: T('确认删除：合并结果将移除云端这些词条（不可撤销，云端备份链保留最近 5 份）'),
          remoteVal: T('放弃删除：把云端被移除的 ') + plan.massDropCount + T(' 篇恢复回来'),
          localText: T('确认删除'),
          remoteText: T('放弃删除'),
          isRequired: true
        });
      }

      // 「云端无库 + 本机非空」首传确认：防账号/目录填错建出第二个空库。
      if (plan.firstUploadSuspected) {
        remotePlanModel.requiredKeys.add(FIRST_UPLOAD_KEY);
        remotePlanModel.items.push({
          key: FIRST_UPLOAD_KEY,
          kind: 'conflict',
          label: T('⚠ 云端还没有文献库文件'),
          hint: T('将把本机内容上传为新云端库；账号或同步目录名填错（大小写不同即另一个目录）会建出第二个库'),
          localVal: T('确认上传：以本机 ') + (plan.localPaperCount == null ? '' : plan.localPaperCount) + T(' 篇新建云端库'),
          remoteVal: T('取消：先检查账号与同步目录名是否正确'),
          localText: T('确认上传'),
          remoteText: T('取消上传'),
          isRequired: true
        });
      }

      conflicts.forEach(function (conflict, index) {
        var key = remoteConflictKey(conflict, index);
        remotePlanModel.requiredKeys.add(key);
        remotePlanModel.items.push({
          key: key,
          kind: 'conflict',
          label: remoteConflictLabel(conflict),
          hint: T('请选择一个版本'),
          localVal: conflict.local,
          remoteVal: conflict.remote,
          localText: typeof conflict.local === 'string' ? conflict.local : (conflict.local && (conflict.local.title || conflict.local.name) || ''),
          remoteText: typeof conflict.remote === 'string' ? conflict.remote : (conflict.remote && (conflict.remote.title || conflict.remote.name) || ''),
          isRequired: true
        });
      });

      localOnly.forEach(function (entity, index) {
        var collection = entity && entity.collection || 'papers';
        var value = entity && (entity.entity || entity.value || entity) || {};
        var id = entity && (entity.id || entity.entityId) || value.id || index;
        var key = entity && entity.conflictId || 'local-only:' + collection + ':' + id;
        remotePlanModel.items.push({
          key: key,
          kind: 'local-only',
          label: T('仅本机 · ') + (value.title || value.name || id),
          hint: T('默认保留'),
          localLabel: T('保留本机'),
          remoteLabel: T('从本机移除'),
          localVal: value,
          remoteVal: null,
          localText: value.title || value.name || '',
          remoteText: '',
          isRequired: false
        });
      });

      (plan.remoteOnly || []).forEach(function (marker, index) {
        var entity = marker.entity || marker.value || {};
        if (entity.deletedAt) return;
        remotePlanModel.items.push({ key: 'remote-info:' + index, kind: 'info',
          label: T('仅云端 · ') + (entity.title || entity.name || marker.id),
          hint: T('普通同步按合并计划处理；要使云端与本机一致，请使用「以本机为准整理云端」'),
          remoteText: entity.title || entity.name || marker.id });
      });

      remotePlanModel.filteredItems = remotePlanModel.items;

      var filterInput = $('#sync-remote-plan-filter');
      if (filterInput) filterInput.value = '';

      resetRemotePlanProgressUi();
      var list = $('#sync-remote-plan-list');
      list.innerHTML = '';
      appendRemotePlanChunk();

      updateRemotePlanSummary();
      updateRemotePlanApplyButton();
      updateRemotePlanBulkButtons();
      $('#sync-remote-plan-mask').hidden = false;
    }

    var inspectionRevision = 0;

    function inspectRemote() {
      if (remotePlanCreating) return; // 生成中的计划占用状态行与同步槽位，手动检查顺延
      if (!desktop || !desktop.inspectNutstoreRemote) { setSyncInlineStatus('sync-remote-status', T('当前版本不支持云端检查'), 'error'); return; }
      var revision = ++inspectionRevision;
      var config = syncFormValue();
      var configKey = JSON.stringify(config);
      setSyncInlineStatus('sync-remote-status', T('正在只读检查云端…'), 'pending');
      return desktop.inspectNutstoreRemote({ config: config, verifyAssets: true }).then(function (info) {
        if (revision !== inspectionRevision || JSON.stringify(syncFormValue()) !== configKey) return;
        if (info && info.exists === false) {
          var missing = T('未找到云端库文件 · ') + (info.fileUrl || 'litboard-library.json') +
            (info.status ? ' · HTTP ' + info.status : '');
          setSyncInlineStatus('sync-remote-status', missing, 'warning');
          return;
        }
        var counts = info && info.counts || {};
        var localCount = (workspacePayload().papers || []).filter(function (paper) { return paper && !paper.deletedAt; }).length;
        var text = T('本机有效文献：') + localCount + T(' 篇') + ' · ' + T('云端有效文献：') +
          (counts.papers == null ? T('文献数未知') : counts.papers + T(' 篇'));
        var warning = counts.papers == null || counts.papers !== localCount;
        if (counts.attachments != null) {
          text += ' · ' + T('云端库附件：') + counts.attachments;
          if (counts.pdfs != null) text += '（PDF ' + counts.pdfs + ' · ' + T('网页快照：') + (counts.webSnapshots || 0) +
            ' · ' + T('其他：') + (counts.attachments - counts.pdfs - (counts.webSnapshots || 0)) + '）';
        }
        var check = info && info.assetCheck;
        if (check && check.existing != null) {
          text += ' · ' + T('已核验存在：') + check.existing + '/' + check.registered +
            ' · ' + T('缺失文件：') + check.missing;
          warning = warning || check.missing > 0;
        } else {
          text += ' · ' + T('附件文件尚未核验');
          warning = true;
        }
        if (check && check.unregistered) {
          text += ' · ' + T('未登记云端文件：') + check.unregistered;
          warning = true;
        }
        if (info && info.checkedAt) text += ' · ' + T('核验时间：') + new Date(info.checkedAt).toLocaleTimeString();
        setSyncInlineStatus('sync-remote-status', text, warning ? 'warning' : 'success');
      }).catch(function (error) {
        if (revision !== inspectionRevision || JSON.stringify(syncFormValue()) !== configKey) return;
        setSyncInlineStatus('sync-remote-status', error && error.message || String(error), 'error');
      });
    }

    function createRemotePlan(mode) {
      if (remotePlanApplying || remotePlanCreating) return;
      if (isSyncBusy()) { setSyncInlineStatus('sync-remote-status', T('后台同步正在进行，请稍后再试'), 'warning'); return; }
      if (!desktop || !desktop.createNutstoreSyncPlan) { setSyncInlineStatus('sync-remote-status', T('当前版本不支持云端恢复计划'), 'error'); return; }
      var requestRevision = ++inspectionRevision;
      remotePlanCreating = true;
      setSyncBusy(true);
      setSyncInlineStatus('sync-remote-status', T('正在读取云端并生成对照…'), 'pending');
      var currentWorkspace = workspacePayload();
      var snapshot = JSON.stringify(currentWorkspace);
      var stopButton = $('#sync-stop');
      if (mode === 'mirror' && stopButton) { stopButton.hidden = false; stopButton.disabled = false; }
      Promise.resolve().then(function () {
        return desktop.createNutstoreSyncPlan({ config: syncFormValue(), workspace: currentWorkspace, mode: mode });
      }).then(function (plan) {
        if (requestRevision !== inspectionRevision) {
          // 被更新的请求取代：必须明确告知并复位，不能让状态行悬挂在「正在生成」
          setSyncInlineStatus('sync-remote-status', T('云端状态已变化，本次对照已作废，请重试'), 'warning');
          return;
        }
        if (mode === 'mirror' && JSON.stringify(workspacePayload()) !== snapshot) throw new Error(T('本机文献库已变化，请重新预览整理计划'));
        mirrorLocalSnapshot = mode === 'mirror' ? snapshot : null;
        renderRemotePlan(plan || {});
        setSyncInlineStatus('sync-remote-status', T('已生成对照，请完成选择后应用'), 'warning');
      }).catch(function (error) {
        setSyncInlineStatus('sync-remote-status', error && error.message || String(error), 'error');
      }).finally(function () {
        remotePlanCreating = false;
        setSyncBusy(false);
        if (mode === 'mirror' && stopButton) stopButton.hidden = true;
      });
    }

    function closeRemotePlanDialog() {
      if (remotePlanApplying) return; // 应用进行中不允许关闭，避免同步落库到一半丢 UI
      $('#sync-remote-plan-mask').hidden = true;
      pendingRemotePlan = null;
      pendingRemoteResolutions = {};
      remotePlanModel.items = [];
      remotePlanModel.filteredItems = [];
      remotePlanModel.rowMap.clear();
      remotePlanModel.requiredKeys.clear();
      remotePlanModel.resolvedKeys.clear();
      var planList = $('#sync-remote-plan-list');
      if (planList) planList.innerHTML = '';
      var filterInput = $('#sync-remote-plan-filter');
      if (filterInput) filterInput.value = '';
    }

    function setRemotePlanApplying(applying) {
      remotePlanApplying = applying;
      $('#sync-mirror-confirm').disabled = applying;
      $('#sync-mirror-cleanup').disabled = applying || !(pendingRemotePlan && pendingRemotePlan.cleanupSupported);
      var progress = $('#sync-remote-plan-progress');
      var list = $('#sync-remote-plan-list');
      var filterInput = $('#sync-remote-plan-filter');
      var toolbar = filterInput && filterInput.parentElement;
      if (progress) progress.hidden = !applying;
      if (list) list.hidden = applying;
      if (toolbar) toolbar.hidden = applying;
    }

    function setRemotePlanProgress(payload) {
      if (!payload) return;
      var text = $('#sync-remote-plan-progress-text');
      var percent = $('#sync-remote-plan-progress-percent');
      var bar = $('#sync-remote-plan-progress-bar');
      if (text && payload.message) text.textContent = payload.message;
      if (!bar) return;
      bar.hidden = payload.phase === 'error';
      if (payload.phase === 'assets' && payload.total > 0) {
        bar.max = payload.total;
        bar.value = Math.max(0, Math.min(payload.done, payload.total));
        if (percent) percent.textContent = Math.round((bar.value / bar.max) * 100) + '%';
      } else if (payload.phase === 'done') {
        bar.max = 100;
        bar.value = 100;
        if (percent) percent.textContent = '100%';
      } else {
        // 校验/写入/配置阶段总量未知：进度条走不确定态动画
        bar.removeAttribute('value');
        if (percent) percent.textContent = '';
      }
    }

    function resetRemotePlanProgressUi() {
      setRemotePlanApplying(false);
      remotePlanStopping = false;
      var cancelButton = $('#sync-remote-plan-cancel');
      if (cancelButton) {
        cancelButton.disabled = false;
        cancelButton.textContent = T('取消');
      }
      var applyButton = $('#sync-remote-plan-apply');
      if (applyButton) {
        applyButton.hidden = false;
        applyButton.textContent = T('应用对照并同步');
      }
    }

    function setRemotePlanCompleted(message) {
      remotePlanApplying = false;
      remotePlanStopping = false;
      $('#sync-mirror-options').hidden = true;
      var progress = $('#sync-remote-plan-progress');
      var list = $('#sync-remote-plan-list');
      var filterInput = $('#sync-remote-plan-filter');
      var toolbar = filterInput && filterInput.parentElement;
      if (progress) progress.hidden = false;
      if (list) list.hidden = true;
      if (toolbar) toolbar.hidden = true;
      setRemotePlanProgress({ phase: 'done', message: message || T('同步完成') });
      var cancelButton = $('#sync-remote-plan-cancel');
      if (cancelButton) {
        cancelButton.disabled = false;
        cancelButton.textContent = T('关闭');
      }
      var applyButton = $('#sync-remote-plan-apply');
      if (applyButton) applyButton.hidden = true;
    }

    function handleSyncProgress(payload) {
      if (!payload) return;
      if (remotePlanApplying) {
        if (payload.scope === 'apply-plan' && payload.planId === remotePlanId(pendingRemotePlan)) {
          setRemotePlanProgress(payload);
        }
        return;
      }
      // 计划生成中的只读预览可能长达数分钟（逐文件 HEAD 受节流间隔限制），
      // 阶段进度必须透到对照状态行，否则看起来与卡死无异。
      if (remotePlanCreating && payload.scope === 'plan') {
        if (payload.message) setSyncInlineStatus('sync-remote-status', payload.message, 'pending');
        return;
      }
      // 后台自动同步：设置弹窗开着时把阶段信息透出到状态行
      if (payload.message && isSyncBusy()) {
        var status = $('#sync-status');
        var mask = $('#sync-mask');
        if (status && mask && !mask.hidden) status.textContent = payload.message;
      }
    }

    function applyRemotePlan() {
      inspectionRevision++;
      if (!pendingRemotePlan || !desktop || !desktop.applyNutstoreSyncPlan) return;
      if (remotePlanApplying || remotePlanCreating) return;
      // 首传确认选了「取消」：云端本来就没有库文件，直接关弹窗即可，无需调后端
      if (pendingRemotePlan.firstUploadSuspected &&
          String(pendingRemoteResolutions[FIRST_UPLOAD_KEY]).toLowerCase() === 'remote') {
        closeRemotePlanDialog();
        setSyncInlineStatus('sync-remote-status', T('已取消首次上传：云端未做任何修改'), 'warning');
        return;
      }
      var planMode = pendingRemotePlan.mode;
      if (planMode === 'mirror' && (pendingRemoteResolutions['mirror:confirm'] !== 'local' || mirrorLocalSnapshot !== JSON.stringify(workspacePayload()))) {
        setSyncInlineStatus('sync-remote-status', T('请核对确认；本机内容变化后需重新预览整理计划'), 'warning');
        return;
      }
      var button = $('#sync-remote-plan-apply'); button.disabled = true;
      remotePlanStopping = false;
      var cancelButton = $('#sync-remote-plan-cancel');
      if (cancelButton) { cancelButton.disabled = false; cancelButton.textContent = T('停止同步'); }
      setRemotePlanApplying(true);
      setSyncBusy(true); // 应用同样占用主进程同步槽位，后台同步不得插队撞车
      setRemotePlanProgress({ phase: 'verify', message: T('正在校验云端版本…') });
      setSyncInlineStatus('sync-remote-status', T('正在校验云端版本并应用…'), 'pending');
      var applyAssetFailures = 0;
      var applyPaused = null;
      var mirrorResult = null;
      Promise.resolve().then(function () {
        return desktop.applyNutstoreSyncPlan({ planId: remotePlanId(pendingRemotePlan), resolutions: pendingRemoteResolutions, workspace: workspacePayload() });
      }).then(function (result) {
        var workspace = result && result.workspace ? result.workspace : result;
        mirrorResult = result && result.mirror;
        if (mirrorResult && mirrorLocalSnapshot !== JSON.stringify(workspacePayload())) {
          workspace = null;
          mirrorResult.complete = false;
          mirrorResult.message = T('本机已有新修改，未用整理结果覆盖；请重新对照');
        }
        var assets = result && result.assets || {};
        applyAssetFailures = (assets.failures || []).length;
        if (result && result.paused) applyPaused = result;
        if (workspace && workspace.papers) {
          // 暂停时也落库：用户已经做出的决议不能丢，附件续传交给限流调度
          return applySyncedWorkspace(workspace, true).then(function () {
            setSyncIndicator('ok');
            if (desktop.getIntegrationConfig) return desktop.getIntegrationConfig().catch(function () { return null; });
            return null;
          });
        }
        if (desktop.getIntegrationConfig) return desktop.getIntegrationConfig().catch(function () { return null; });
        return null;
      }).then(function (config) {
        if (config) {
          applyPortableConfigRuntime(config);
          fillSyncForm(config);
        }
        if (applyPaused) {
          var pausedLabel = applyPaused.message || T('同步已因限流暂停');
          if (options.scheduleSyncResume) options.scheduleSyncResume(applyPaused.resumeAt);
          setSyncInlineStatus('sync-remote-status', pausedLabel, 'warning');
          setRemotePlanCompleted(pausedLabel);
          toast('⚠ ' + pausedLabel);
          return;
        }
        var label = planMode === 'mirror' ? T('云端整理完成') : planMode === 'merge' ? T('同步对照已应用') : T('云端恢复完成');
        if (mirrorResult) {
          label = (mirrorResult.complete ? T('云端整理完成') : T('文献清单已更新，文件整理未完成，请重新预览')) +
            ' · ' + T('已归档文件：') + mirrorResult.moved + ' · ' + T('备份目录：') + mirrorResult.archivePath +
            (mirrorResult.message ? ' · ' + mirrorResult.message : '');
          if (!mirrorResult.complete) applyAssetFailures++;
        }
        if (applyAssetFailures && !mirrorResult) label += '（' + applyAssetFailures + T(' 个附件未完成，下次同步自动续传）');
        setSyncInlineStatus('sync-remote-status', label, applyAssetFailures ? 'warning' : 'success');
        setRemotePlanCompleted(label);
        toast(label);
        if (!mirrorResult || mirrorResult.complete) inspectRemote();
      }).catch(function (error) {
        var stopped = error && (error.code === 'SYNC_CANCELLED' || String(error.message || error).indexOf('同步已停止') !== -1);
        resetRemotePlanProgressUi();
        button.disabled = planMode === 'mirror';
        var message = stopped ? T('同步已停止；已上传附件下次可续传') : error && error.message || String(error);
        setRemotePlanProgress({ phase: 'error', message: message });
        $('#sync-remote-plan-progress').hidden = false;
        $('#sync-remote-plan-cancel').textContent = T('关闭');
        setSyncInlineStatus('sync-remote-status', message, stopped ? 'warning' : 'error');
      }).finally(function () {
        setSyncBusy(false);
      });
    }

    function cancelOrCloseRemotePlan() {
      if (!remotePlanApplying) { closeRemotePlanDialog(); return; }
      if (remotePlanStopping || !desktop || !desktop.cancelNutstoreSync) return;
      remotePlanStopping = true;
      var button = $('#sync-remote-plan-cancel');
      if (button) { button.disabled = true; button.textContent = T('正在停止…'); }
      setRemotePlanProgress({ message: T('正在停止同步…') });
      desktop.cancelNutstoreSync().catch(function (error) {
        remotePlanStopping = false;
        if (button) { button.disabled = false; button.textContent = T('停止同步'); }
        setSyncInlineStatus('sync-remote-status', error && error.message || String(error), 'error');
      });
    }


    function bind() {
      $('#sync-remote-inspect').addEventListener('click', api.inspect);
      $('#sync-remote-restore').addEventListener('click', function () { api.createPlan('restore'); });
      $('#sync-remote-merge').addEventListener('click', function () { api.createPlan('merge'); });
      $('#sync-remote-mirror').addEventListener('click', function () { api.createPlan('mirror'); });
      $('#sync-mirror-confirm').addEventListener('change', function () {
        setRemotePlanChoice('mirror:confirm', this.checked ? 'local' : '');
        updateRemotePlanSummary();
      });
      $('#sync-mirror-cleanup').addEventListener('change', function () {
        pendingRemoteResolutions['mirror:cleanup'] = this.checked ? 'local' : 'remote';
      });
      $('#sync-remote-plan-cancel').addEventListener('click', cancelOrCloseRemotePlan);
      $('#sync-remote-plan-apply').addEventListener('click', api.apply);
      $('#sync-remote-choose-local').addEventListener('click', function () {
        batchSetRemotePlanChoices('local');
      });
      $('#sync-remote-choose-remote').addEventListener('click', function () {
        batchSetRemotePlanChoices('remote');
      });

      var planList = $('#sync-remote-plan-list');
      if (planList) {
        planList.addEventListener('click', function (event) {
          var btn = event.target.closest('[data-remote-choice]');
          if (!btn) return;
          var row = btn.closest('[data-remote-conflict-key]');
          if (!row) return;
          var key = row.dataset.remoteConflictKey;
          var choice = btn.dataset.remoteChoice;
          setRemotePlanChoice(key, choice);
        });
        planList.addEventListener('scroll', function () {
          if (remotePlanModel.scrollTicking) return;
          remotePlanModel.scrollTicking = true;
          requestAnimationFrame(function () {
            remotePlanModel.scrollTicking = false;
            if (planList.scrollTop + planList.clientHeight >= planList.scrollHeight - 200) {
              appendRemotePlanChunk();
            }
          });
        });
      }

      var planFilter = $('#sync-remote-plan-filter');
      if (planFilter) {
        planFilter.addEventListener('input', debounce(function () {
          applyRemotePlanFilter(planFilter.value);
        }, 150));
      }
      $('#sync-conflict-close').addEventListener('click', function () { $('#sync-conflict-mask').hidden = true; });
      $('#sync-conflict-export').addEventListener('click', function () {
        if (!pendingConflictExport.length) return;
        download('litboard-sync-conflicts-' + stamp() + '.json', JSON.stringify(pendingConflictExport.map(function (c) {
          return { id: c.id, title: c.title, direction: c.direction, overwrittenLocalVersion: c.overwritten };
        }), null, 2), 'application/json');
      });
    }

    var api = {
      apply: applyRemotePlan,
      bind: bind,
      close: closeRemotePlanDialog,
      createPlan: createRemotePlan,
      handleProgress: handleSyncProgress,
      inspect: inspectRemote,
      invalidateInspection: function () {
        inspectionRevision++;
        setSyncInlineStatus('sync-remote-status', T('云端状态待刷新'), 'pending');
      },
      show: renderRemotePlan,
      showConflicts: showSyncConflicts,
      clearRefreshFormFlag: function () { refreshSyncFormAfterSync = false; },
      markRefreshFormAfterSync: function () { refreshSyncFormAfterSync = true; },
      shouldRefreshForm: function () { return refreshSyncFormAfterSync; },
      stateForTest: function () {
        return { model: remotePlanModel, plan: pendingRemotePlan, resolutions: pendingRemoteResolutions,
          applying: remotePlanApplying, creating: remotePlanCreating };
      }
    };
    return api;
  }

  return { create: create };
});
