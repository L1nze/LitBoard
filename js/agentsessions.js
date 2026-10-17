/* LitBoard AI 会话存储（渲染层 / Node 共用）：runs 驻留（LRU 上限）、会话生命周期
 * （新建/打开/持久化/分叉/重命名/删除/批量删除）与历史视图。从 agentui.js 拆出
 * （2026-10 架构整理）——会话状态机与 UI 装配解耦：本模块持有 runs/current 等
 * 全部会话状态，UI 侧效应（面板刷新/附件条/chips/提示）经 host 注入回调。
 *
 * host 契约（agentui init 时装配）：
 *   desk            桥（sessionCreate/Read/SetData/Commit/Fork/Rename/Delete/DeleteMany/List）
 *   T               翻译包装（参数透传）
 *   $ / el          DOM helpers
 *   deps            app.js 注入项（confirm / prompt / showCtxMenu）
 *   core            LitAgentCore（浏览器缺省读 window.LitAgentCore；Node 测试注入）
 *   runner()        调用时返回编排器（init 后才创建，禁止捕获）
 *   isUploadBusy() / isCompactBusy()  互斥标志在 agentui，调用时读取
 *   setStatus(text) / renderAttachments(run) / renderChips() / renderMode() / bump()
 *   toastText(text) / toastError(error)
 * 「禁止解构捕获」同 IPC 域约定：runner 与互斥标志都是可变状态，一律调用时读。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentSessions = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  function createSessionStore(host) {
    var desk = host.desk;
    var T = host.T;
    var $ = host.$;
    var el = host.el;
    var deps = host.deps || {};

    function coreApi() { return host.core || (root && root.LitAgentCore) || null; }
    function runner() { return host.runner ? host.runner() : null; }

    var store = {
      runs: new Map(),      // sessionId → run（活跃会话，含流式状态）；驻留上限见 RUNS_LIMIT
      RUNS_LIMIT: 12,       // runs 的 LRU 上限：超出时驱逐最久未打开的空闲 run（防内存随会话数线性涨）
      persistWarned: {},    // sessionId → 已提示过保存失败
      sessionsIndex: [],
      historySelectMode: false,   // 历史会话多选删除
      historySelected: {},        // sessionId → true
      forkBusy: false
    };
    var openSeq = 0;               // A09：会话打开请求序号，慢返回不覆盖新选择
    var pendingNewSession = null;
    Object.defineProperty(store, 'current', {
      get: function () { return store._current || null; },
      set: function (value) { store._current = value; },
      enumerable: true
    });

    function loadSessions() {
      if (!desk.sessionList) return;
      desk.sessionList().then(function (list) {
        store.sessionsIndex = list || [];
        renderHistory();
      }).catch(function () {});
    }

    function blankDoc(id) {
      return {
        v: 2, id: id, title: T('新会话'), createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), model: '', attachments: [],
        turnMeta: {}, messages: [], steps: 0, tokens: { in: 0, out: 0 },
        recentToolSignatures: [], done: false, stopReason: '', endReason: '', turnId: '',
        lastInputTokens: 0
      };
    }

    function makeRun(id, doc) {
      var Core = coreApi();
      var core = Core.deserialize(doc || blankDoc(id));
      // R03：重开/重启后，恢复上一轮的冻结上下文（模型/思考档/文献/选区）——
      // 紧接着的重试/重跑沿用原上下文，不拿当前界面状态顶替
      var lastMeta = doc && doc.turnMeta ? doc.turnMeta[core.turnId || ''] : null;
      return {
        id: id,
        doc: doc || blankDoc(id),
        core: core,
        streaming: false,
        phase: '',
        streamText: '',
        streamReasoning: '',
        streamToolName: '',
        endReason: '',
        frozen: lastMeta || null,
        toolSnapshot: null
      };
    }

    /** LRU 记录最近使用：把 run 挪到 Map 末尾（Map 迭代即插入序），驱逐从头部取。 */
    function touchRun(id) {
      var run = store.runs.get(id);
      if (run) { store.runs.delete(id); store.runs.set(id, run); }
    }

    /** runs 上限控制：只驱逐空闲 run——当前打开的会话、生成中（streaming，含确认门挂起：
     *  门开在轮次中途）永不驱逐；agentloop 侧 unregister 再兜一道（排队输入未消费等拒绝）。
     *  被逐出的会话走既有回退：openSession 对未驻留会话从磁盘重新 deserialize（含
     *  restoreInterrupted 恢复中断），功能无损，只是重开时多读一次盘。
     *  全部在运行/当前会话时如实超限，不强逐。 */
    function evictIdleRuns() {
      if (store.runs.size <= store.RUNS_LIMIT) return;
      var overflow = store.runs.size - store.RUNS_LIMIT;
      store.runs.forEach(function (run, id) {
        if (overflow <= 0) return;
        if (id === store.current) return;
        if (run && run.streaming) return;
        if (run && run.persistenceError) return; // 保存失败的内存历史必须保留，不能被旧磁盘内容替换。
        var r = runner();
        if (r && r.unregister && !r.unregister(id)) return;
        store.runs.delete(id);
        delete store.persistWarned[id];
        overflow--;
      });
    }

    function newSession() {
      if (pendingNewSession) return pendingNewSession;
      pendingNewSession = desk.sessionCreate({ title: T('新会话') }).then(function (created) {
        var run = makeRun(created.id, created.data);
        store.runs.set(created.id, run);
        openSession(created.id);
        loadSessions();
        return run;
      }).catch(function (error) { host.toastError(error); return null; }).finally(function () { pendingNewSession = null; });
      return pendingNewSession;
    }

    function openSession(id) {
      var seq = ++openSeq; // A09：仅最新一次打开生效
      desk.sessionRead(id).then(function (doc) {
        if (seq !== openSeq) return;
        if (!doc) { host.toastText(T('会话不存在或已删除')); loadSessions(); return; }
        var run = store.runs.get(id);
        // 驻留 run 始终是内存权威：读盘请求发出后本轮可能已完成或保存失败，
        // 不能只凭回调时 streaming=false 就用旧快照覆盖刚生成的内容。
        if (!run) {
          run = makeRun(id, doc);
          store.runs.set(id, run);
          // A06：上次运行没收尾 → 恢复中断内容；恢复结果立即落盘（checkpoint），
          // 否则「运行标记」只在内存复位，再重启会被重复恢复一次。
          // persistRun 失败返回 null（不 reject）——重试一次，仍失败则留给后续
          // 事件点自愈，但不静默（persistRun 内部已设 persistenceError 状态）
          var r = runner();
          if (r && r.restoreInterrupted(run)) {
            persistRun(run, true).then(function (saved) {
              if (!saved) return persistRun(run, true);
              return saved;
            });
          }
        }
        touchRun(id);
        store.current = id;
        evictIdleRuns();
        var history = $('agent-history');
        if (history) history.hidden = true;
        var title = $('agent-cur-title');
        if (title) title.textContent = run.doc.title || T('新会话');
        host.renderMode();
        host.renderAttachments(run);
        host.renderChips(); // 换了会话：chips 不能残留上一个会话的冻结/上下文显示
        host.bump();
        renderHistory();
      }).catch(function (error) { host.toastError(error); });
    }

    /** 会话持久化：普通路径走 1s 防抖 setData；checkpoint=true 走主进程 commit——
     *  立即写盘并等待完成（R04 关键事件），返回的附件登记回写本地副本（R05）。
     *  保存失败返回 null，并在 run 上保留具体原因供编排层的错误卡显示。 */
    function persistRun(run, checkpoint) {
      run.doc.messages = run.core.messages;
      run.doc.steps = run.core.steps;
      run.doc.tokens = run.core.tokens;
      run.doc.recentToolSignatures = run.core.recentToolSignatures;
      run.doc.done = run.core.done;
      run.doc.stopReason = run.core.stopReason;
      run.doc.endReason = run.endReason || run.core.endReason || '';
      run.doc.turnId = run.core.turnId || '';
      // H4：真实输入 token 地板（压缩/掩码判定依据）随会话落盘——漏写这一行，
      // 重载会话后就退回纯估算，预算判定偏差回来
      run.doc.lastInputTokens = Number(run.core.lastInputTokens) || 0;
      run.doc.inputUsageBaseline = run.core.inputUsageBaseline || null;
      run.doc.updatedAt = new Date().toISOString();
      var task = checkpoint && desk.sessionCommit
        ? desk.sessionCommit(run.id, run.doc)
        : desk.sessionSetData(run.id, run.doc);
      return task.then(function (result) {
        run.persistenceError = null;
        delete store.persistWarned[run.id];
        if (result && Array.isArray(result.attachments) && result.attachments.length) {
          run.doc.attachments = result.attachments;
          if (run.id === store.current) host.renderAttachments(run);
        }
        return result;
      }, function (error) {
        run.persistenceError = new Error(T('会话保存失败：') + String(error && error.message || error));
        if (!store.persistWarned[run.id]) {
          store.persistWarned[run.id] = true;
          host.setStatus(T('会话保存失败：') + String(error && error.message || error));
        }
        return null; // 保存失败不虚报：返回 null，调用方据需呈现
      });
    }

    /** 分叉前提交当前内存历史；主进程复制消息与附件，原会话继续保留。 */
    function forkSession(id, messageIndex) {
      if (host.isUploadBusy()) { host.setStatus(T('请等待参考文件上传结束')); return Promise.resolve(); }
      var run = store.runs.get(id);
      if (store.forkBusy) return Promise.resolve();
      if (host.isCompactBusy() || (run && run.streaming)) {
        host.toastText(T('请等待生成或压缩结束后再分叉'));
        return Promise.resolve();
      }
      store.forkBusy = true;
      var ready = run ? persistRun(run, true).then(function (result) {
        if (!result) throw new Error(T('会话保存失败，未创建分支'));
        return run.doc;
      }) : desk.sessionRead(id);
      return ready.then(function (doc) {
        if (!doc) throw new Error(T('会话不存在或已删除'));
        return desk.sessionFork(id, { title: (doc.title || T('新会话')) + T('（分支）'), messageIndex: messageIndex });
      }).then(function (created) {
        // 由 openSession 从新文档恢复 frozen 等运行上下文。
        openSession(created.id);
        loadSessions();
      }).catch(function (error) {
        host.toastText(T('分叉失败：') + String(error && error.message || error));
      }).then(function () { store.forkBusy = false; });
    }

    function renameSession(s) {
      if (host.isUploadBusy()) { host.setStatus(T('请等待参考文件上传结束')); return; }
      if (!deps.prompt) return;
      deps.prompt(T('重命名会话'), s.title || '').then(function (title) {
        if (host.isUploadBusy()) { host.setStatus(T('请等待参考文件上传结束')); return; }
        if (!title || !title.trim() || title.trim() === s.title) return;
        desk.sessionRename(s.id, title.trim()).then(function () {
          var run = store.runs.get(s.id);
          if (run) run.doc.title = title.trim(); // A10：运行中文档同步改名
          if (store.current === s.id) {
            var node = $('agent-cur-title');
            if (node) node.textContent = title.trim();
          }
          loadSessions();
        }).catch(function (error) { host.toastText(T('重命名失败：') + String(error && error.message || error)); });
      }).catch(function () {});
    }

    function deleteSession(s) {
      if (host.isUploadBusy()) { host.setStatus(T('请等待参考文件上传结束')); return; }
      if (!deps.confirm) return;
      deps.confirm(T('删除会话'), T('会话「') + (s.title || '') + T('」将移入系统回收站（含对话与附件）。')).then(function (yes) {
        if (host.isUploadBusy()) { host.setStatus(T('请等待参考文件上传结束')); return; }
        if (!yes) return;
        var run = store.runs.get(s.id);
        var r = runner();
        var stopped = !!(run && r) && r.cancel(s.id); // A03：删除运行中会话先取消循环
        // R08：取消后等当前轮真正收尾（挂着确认框/在途工具写入完成），超时 3s 如实继续
        var settle = stopped && r.waitIdle ? r.waitIdle(s.id, 3000) : Promise.resolve(true);
        settle.then(function () {
          if (host.isUploadBusy()) throw new Error(T('请等待参考文件上传结束'));
          return desk.sessionDelete(s.id);
        }).then(function () {
          store.runs.delete(s.id);
          // 内存泄露出口：agentloop 注册表同步移除（settle 已等收尾；force 兜底 3s 超时
          // 仍在飞的边缘），persistWarned 记账一并清
          var r2 = runner();
          if (r2 && r2.unregister) r2.unregister(s.id, true);
          delete store.persistWarned[s.id];
          if (store.current === s.id) {
            store.current = null;
            var node = $('agent-cur-title');
            if (node) node.textContent = T('AI 助手');
            host.renderChips(); // 不残留已删会话的冻结/上下文显示
            host.bump();
          }
          loadSessions();
        }).catch(function (error) { host.toastText(T('删除失败：') + String(error && error.message || error)); });
      }).catch(function () {});
    }

    /* ---------------- 历史视图 ---------------- */

    /** 当前过滤条件下可见的会话（全选/计数都以它为准） */
    function visibleHistoryItems() {
      var filterBox = $('agent-history-filter');
      var filter = (filterBox && filterBox.value || '').toLowerCase();
      return store.sessionsIndex.filter(function (s) {
        return !filter || (s.title || '').toLowerCase().indexOf(filter) !== -1;
      });
    }

    function toggleSelectMode(on) {
      store.historySelectMode = on;
      store.historySelected = {};
      var btn = $('agent-history-select');
      if (btn) btn.textContent = on ? T('完成') : T('多选');
      if (btn) btn.classList.toggle('active', on);
      var bulkAll = $('agent-history-bulk-all');
      if (bulkAll) bulkAll.textContent = T('全选');
      renderHistory();
    }

    function updateBulkBar() {
      var ids = Object.keys(store.historySelected);
      var bar = $('agent-history-bulk');
      if (bar) bar.hidden = !store.historySelectMode;
      var count = $('agent-history-bulk-count');
      if (count) count.textContent = T('已选 ') + ids.length + T(' 项');
      var del = $('agent-history-bulk-delete');
      if (del) del.disabled = !ids.length;
    }

    /** 批量删除：逐个进系统回收站；失败明细如实报出（不静默吞） */
    function deleteSelectedSessions() {
      if (host.isUploadBusy()) { host.setStatus(T('请等待参考文件上传结束')); return; }
      var ids = Object.keys(store.historySelected);
      if (!ids.length || !deps.confirm) return;
      var hasRunning = ids.some(function (id) { var r = store.runs.get(id); return r && r.streaming; });
      deps.confirm(
        T('删除会话'),
        T('将删除 ') + ids.length + T(' 个会话（移入系统回收站，可恢复）。') +
          (hasRunning ? T('其中包含正在生成的会话，删除会先停止它。') : '')
      ).then(function (yes) {
        if (host.isUploadBusy()) { host.setStatus(T('请等待参考文件上传结束')); return; }
        if (!yes) return;
        var r = runner();
        ids.forEach(function (id) { var run = store.runs.get(id); if (run && r) r.cancel(id); });
        // R08：等被取消的运行中会话收尾（在途确认/工具写入），超时 3s 如实继续
        var settle = r && r.waitIdle
          ? Promise.all(ids.map(function (id) { return r.waitIdle(id, 3000); }))
          : Promise.resolve([]);
        var task = settle.then(function () {
          if (host.isUploadBusy()) throw new Error(T('请等待参考文件上传结束'));
          return desk.sessionDeleteMany ? desk.sessionDeleteMany(ids) : Promise.reject(new Error(T('当前版本不支持批量删除')));
        });
        task.then(function (result) {
          var deleted = (result && result.deleted) || [];
          deleted.forEach(function (id) {
            store.runs.delete(id);
            var r2 = runner();
            if (r2 && r2.unregister) r2.unregister(id, true); // 同单删：settle 后移除注册表
            delete store.persistWarned[id];
            if (store.current === id) store.current = null;
          });
          if (store.current === null) {
            var node = $('agent-cur-title');
            if (node) node.textContent = T('AI 助手');
            host.bump();
          }
          var failed = (result && result.failed) || [];
          if (failed.length) {
            host.toastText(T('已删除 ') + deleted.length + T(' 个，') + failed.length + T(' 个失败：') + failed[0].error);
          } else {
            host.toastText(T('✓ 已删除 ') + deleted.length + T(' 个会话（可在系统回收站恢复）'));
          }
          store.historySelected = {};
          toggleSelectMode(false);
          if (Array.isArray(result && result.sessions)) {
            store.sessionsIndex = result.sessions;
            renderHistory();
          } else {
            loadSessions();
          }
        }).catch(function (error) { host.toastText(T('删除失败：') + String(error && error.message || error)); });
      }).catch(function () {});
    }

    function renderHistory() {
      var list = $('agent-history-list');
      var box = $('agent-history');
      if (!list || (box && box.hidden)) return;
      list.innerHTML = '';
      var items = visibleHistoryItems();
      if (!items.length) {
        list.appendChild(el('div', 'agent-history-empty', T('暂无历史会话')));
        updateBulkBar();
        return;
      }
      var groups = { today: [], yesterday: [], earlier: [] };
      var today = new Date();
      var yesterday = new Date(Date.now() - 86400000);
      var sameDay = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
      items.forEach(function (s) {
        var when = new Date(s.updatedAt || s.createdAt || 0);
        if (sameDay(when, today)) groups.today.push(s);
        else if (sameDay(when, yesterday)) groups.yesterday.push(s);
        else groups.earlier.push(s);
      });
      [['today', T('今天')], ['yesterday', T('昨天')], ['earlier', T('更早')]].forEach(function (pair) {
        if (!groups[pair[0]].length) return;
        list.appendChild(el('div', 'agent-history-group', pair[1]));
        groups[pair[0]].forEach(function (s) {
          var run = store.runs.get(s.id);
          var selected = store.historySelected[s.id] === true;
          var item = el('div', 'agent-history-item' + (s.id === store.current ? ' active' : '') +
            (store.historySelectMode ? ' selecting' : '') + (selected ? ' selected' : ''));
          if (store.historySelectMode) {
            var box2 = el('span', 'agent-history-check');
            box2.textContent = selected ? '☑' : '☐';
            item.appendChild(box2);
          }
          if (run && run.streaming) item.appendChild(el('span', 'spin'));
          item.appendChild(el('span', 'agent-history-title', s.title || T('未命名会话')));
          item.appendChild(el('span', 'agent-history-time', relativeTime(s.updatedAt || s.createdAt)));
          item.addEventListener('click', function () {
            if (store.historySelectMode) {
              if (store.historySelected[s.id]) delete store.historySelected[s.id];
              else store.historySelected[s.id] = true;
              renderHistory();
              return;
            }
            openSession(s.id);
          });
          item.addEventListener('contextmenu', function (event) {
            if (store.historySelectMode) return; // 多选模式下不弹单项菜单，避免误操作
            event.preventDefault();
            deps.showCtxMenu && deps.showCtxMenu(event.clientX, event.clientY, [
              { label: T('分叉会话'), fn: function () { forkSession(s.id); } },
              { label: T('重命名…'), fn: function () { renameSession(s); } },
              { label: T('删除（进回收站）'), fn: function () { deleteSession(s); } },
              { label: T('导出 会话记录.md'), fn: function () {
                desk.sessionExportMarkdown(s.id).then(function (r) {
                  host.toastText(T('✓ 已导出：') + (r && r.path || ''));
                }).catch(function (error) { host.toastText(T('导出失败：') + String(error && error.message || error)); });
              } }
            ]);
          });
          list.appendChild(item);
        });
      });
      updateBulkBar();
    }

    function relativeTime(iso) {
      var t = new Date(iso || 0).getTime();
      if (!isFinite(t)) return '';
      var diff = Date.now() - t;
      if (diff < 60000) return T('刚刚');
      if (diff < 3600000) return Math.floor(diff / 60000) + T(' 分钟前');
      if (diff < 86400000) return Math.floor(diff / 3600000) + T(' 小时前');
      return new Date(t).toLocaleDateString();
    }

    store.loadSessions = loadSessions;
    store.blankDoc = blankDoc;
    store.makeRun = makeRun;
    store.touchRun = touchRun;
    store.evictIdleRuns = evictIdleRuns;
    store.newSession = newSession;
    store.openSession = openSession;
    store.persistRun = persistRun;
    store.forkSession = forkSession;
    store.renameSession = renameSession;
    store.deleteSession = deleteSession;
    store.visibleHistoryItems = visibleHistoryItems;
    store.toggleSelectMode = toggleSelectMode;
    store.updateBulkBar = updateBulkBar;
    store.deleteSelectedSessions = deleteSelectedSessions;
    store.renderHistory = renderHistory;
    return store;
  }

  return { createSessionStore: createSessionStore };
});
