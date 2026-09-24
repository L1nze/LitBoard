/* LitBoard 期刊分区：SciGreat/EasyScholar 等级归一、详情面板渲染、
 * 文件夹自动补查与「补查缺失分区」队列（串行 + 间隔，可暂停续跑）。
 * 补查期间的 pending/冻结行序状态归本模块，表格渲染经访问器读取。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitJournalRank = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function create(options) {
    var T = options.T;
    var $ = options.$;
    var toast = options.toast;
    var save = options.save;
    var renderTable = options.renderTable;
    var getById = options.getById;
    var drawerId = options.drawerId || function () { return null; };
    var filteredPapers = options.filteredPapers || function () { return []; };
    var state = options.state;
    var desktop = options.desktop();
    var isArxivPaper = options.isArxivPaper || function () { return false; };
    var journalRankTier = options.journalRankTier || function () { return ''; };
    var rankXrValue = options.rankXrValue || function (v) { return v; };
    var TABLE_PAGE_SIZE = options.tablePageSize || 100;

    var journalRankPending = Object.create(null);   // venueKey → true，正在查询的期刊
    var journalRankFreezeOrder = null;              // 分区补查期间冻结的行顺序（paper id 数组）
    var LitModel = options.model || (typeof window !== 'undefined' ? window.LitModel : null);

    function addJournalRankItem(container, label, value, kind) {
      if (value == null || value === '') return;
      var item = document.createElement('span');
      item.className = 'journal-rank-item' + (kind ? ' ' + kind : '');
      var title = document.createElement('strong');
      title.textContent = label + ' ';
      item.appendChild(title);
      item.appendChild(document.createTextNode(String(value)));
      container.appendChild(item);
    }
    function addJournalRankFlag(container, label, kind) {
      var item = document.createElement('span');
      item.className = 'journal-rank-item' + (kind ? ' ' + kind : '');
      item.textContent = label;
      container.appendChild(item);
    }
    function renderJournalRank(paper, message) {
      var wrap = $('#d-journal-rank');
      var values = $('#d-journal-rank-values');
      values.innerHTML = '';
      if (!paper || !paper.venue) { wrap.hidden = true; return; }
      var rank = paper.journalRank;
      if (rank) {
        if (rank.beihe) addJournalRankFlag(values, T('北核'), 'rank-core');
        if (rank.xr) addJournalRankItem(values, T('新锐'), rankXrValue(rank.xr), journalRankTier(rank.xr));
        if (rank.xrTop) addJournalRankFlag(values, 'Top', 'rank-top');
        if (rank.jcr) addJournalRankItem(values, 'JCR', rank.jcr, 'rank-jcr');
        if (rank.imf != null) addJournalRankItem(values, 'IF', rank.imf, 'rank-if');
      }
      if (!values.childNodes.length && message) {
        var empty = document.createElement('span');
        empty.className = 'journal-rank-empty';
        empty.textContent = message;
        values.appendChild(empty);
      }
      wrap.hidden = !values.childNodes.length;
    }
    /** 统一取期刊等级数据：兼容 SciGreat({results:[{data}]}) 与 EasyScholar({code,msg,data}) */
    function rankResultData(response) {
      if (!response) return null;
      if (Array.isArray(response.results)) {
        var result = response.results[0];
        return result && result.data && typeof result.data === 'object' ? result.data : null;
      }
      if (Number(response.code) === 200 && response.data && typeof response.data === 'object') return response.data;
      return null;
    }
    /** 把不同提供商的等级数据归一为 journalRank 模型字段 */
    function journalRankFromData(data) {
    if (!data || !LitModel) return null;
    var o = data.officialRank && data.officialRank.all ? data.officialRank.all : data;
    return LitModel.normalizeJournalRank({
        abbr: data.abbr || o.abbr || '',
        jcr: data.jcr || o.sci || '',
        cas: data.cas || o.sciBase || o.sciUp || '',
        casTop: data.cas_top || o.sciUpTop || '',
        xr: data.xr || o.xr || '',
        xrTop: data.xr_top || o.xrTop || '',
        beihe: data.pku || data.pku_core || data.beihe || data.beida_core || data.core || o.pku || '',
        imf: data.imf != null ? data.imf : o.sciif,
        jci: data.jci != null ? data.jci : o.jci,
        updatedAt: Date.now()
      });
    }
    function journalRankSummary(data) {
      var rank = journalRankFromData(data);
      if (!rank) return T('无分区数据');
      var parts = [];
      if (rank.xr) parts.push(T('新锐 ') + rank.xr);
      if (rank.xrTop) parts.push('Top');
      if (rank.beihe) parts.push(T('北核'));
      if (rank.cas) parts.push(T('中科院 ') + rank.cas);
      if (rank.imf != null) parts.push('IF ' + rank.imf);
      return parts.length ? parts.join(' · ') : T('有数据');
    }
    function shouldRefreshJournalRank(paper) {
      var checkedAt = Number(paper && paper.journalRankCheckedAt) || 0;
      return !!(paper && paper.venue) && (!checkedAt || Date.now() - checkedAt > 7 * 24 * 60 * 60 * 1000);
    }
    function journalRankInput(paper) {
      var input = { journal: paper.venue };
      var issn = String(paper.issn || '').trim();
      if (issn) input.issn = [issn];
      return input;
    }
    // 文件夹切换时自动查询当前列表；同一期刊在一次刷新中只请求一次。
    var journalRankRequests = Object.create(null);
    var journalRankAutoRun = 0;
    function requestFolderJournalRank(paper) {
      if (!desktop || !desktop.getScigreatRank || !paper || !paper.venue) return Promise.resolve(null);
      var key = String(paper.venue).trim().toLowerCase();
      if (!key) return Promise.resolve(null);
      if (!journalRankRequests[key]) {
        journalRankRequests[key] = Promise.resolve()
          .then(function () { return desktop.getScigreatRank(journalRankInput(paper)); })
          .finally(function () { delete journalRankRequests[key]; });
      }
      return journalRankRequests[key].then(function (response) {
        var data = rankResultData(response);
        paper.journalRankCheckedAt = Date.now();
        paper.journalRank = journalRankFromData(data);
        return response;
      });
    }
    function refreshFolderJournalRanks(folderId) {
      if (!desktop || !desktop.getScigreatRank) return Promise.resolve();
      var run = ++journalRankAutoRun;
      var list = filteredPapers();
      var start = state.tablePage * TABLE_PAGE_SIZE;
      var papers = list.slice(start, start + TABLE_PAGE_SIZE).filter(function (paper) { return !!paper.venue; });
      if (!papers.length) return Promise.resolve();
      var groups = Object.create(null);
      var venueKeys = [];
      papers.forEach(function (paper) {
        var key = String(paper.venue).trim().toLowerCase();
        if (!groups[key]) { groups[key] = []; venueKeys.push(key); }
        groups[key].push(paper);
      });
      var changed = false;
      var cursor = 0;
      function updateGroup(group, source, forceRender) {
        var groupChanged = false;
        group.forEach(function (paper) {
          if (paper !== source && (paper.journalRank !== source.journalRank ||
              paper.journalRankCheckedAt !== source.journalRankCheckedAt)) {
            changed = true;
            groupChanged = true;
          }
          paper.journalRank = source.journalRank;
          paper.journalRankCheckedAt = source.journalRankCheckedAt;
          if (drawerId() === paper.id) renderJournalRank(paper);
        });
        if ((forceRender || groupChanged) && run === journalRankAutoRun && state.activeFolderId === folderId) renderTable();
      }
      function worker() {
        if (run !== journalRankAutoRun || state.activeFolderId !== folderId) return Promise.resolve();
        var key = venueKeys[cursor++];
        if (key == null) return Promise.resolve();
        var group = groups[key];
        var cached = group.find(function (paper) { return !shouldRefreshJournalRank(paper); });
        if (cached) {
          var stale = group.filter(shouldRefreshJournalRank);
          if (stale.length) updateGroup(stale, cached);
          return worker();
        }
        journalRankPending[key] = true;
        if (run === journalRankAutoRun && state.activeFolderId === folderId) renderTable();
        return requestFolderJournalRank(group[0]).then(function () {
          changed = true;
          delete journalRankPending[key];
          updateGroup(group, group[0], true);
        }).catch(function () {
          delete journalRankPending[key];
          if (run === journalRankAutoRun && state.activeFolderId === folderId) renderTable();
          /* 自动刷新保持静默，保留已有缓存 */
        }).then(worker);
      }
      var workerCount = Math.min(3, venueKeys.length);
      var workers = [];
      for (var i = 0; i < workerCount; i++) workers.push(worker());
      return Promise.all(workers).then(function () {
        if (changed && run === journalRankAutoRun) save();
      });
    }
    var journalRankRefreshBusy = false;
    function refreshJournalRank(silent) {
      var paper = getById(drawerId());
      if (!paper || !paper.venue) return;
      if (!desktop || !desktop.getScigreatRank) { toast(T('期刊分区查询仅在桌面版可用')); return; }
      if (journalRankRefreshBusy) return;
      journalRankRefreshBusy = true;
      var button = $('#d-journal-rank-refresh');
      button.disabled = true;
      renderJournalRank(paper, T('正在查询期刊分区…'));
      desktop.getScigreatRank(journalRankInput(paper)).then(function (response) {
        var data = rankResultData(response);
        paper.journalRankCheckedAt = Date.now();
        if (!data) {
          paper.journalRank = null;
          save();
          renderTable();
          if (drawerId() === paper.id) renderJournalRank(paper, T('未找到该期刊的分区信息'));
          return;
        }
        paper.journalRank = journalRankFromData(data);
        save();
        renderTable();
        if (drawerId() === paper.id) renderJournalRank(paper);
      }).catch(function (error) {
        // 错误也必须落错误态：否则详情面板永远停在「正在查询期刊分区…」。
        // 主进程抛出的消息带 Electron IPC 包装前缀（Error invoking remote method '…': Error: …），
        // 直接显示给用户既难懂又占满截断预算，先剥掉包装只留可读正文。
        // 手动刷新（非 silent）时另给 toast 提示。
        if (drawerId() === paper.id) {
          var msg = ((error && error.message) || String(error || ''))
            .replace(/^Error invoking remote method '[^']*':\s*/, '')
            .replace(/^Error:\s*/, '')
            .trim();
          if (!msg) msg = T('分区查询失败，请检查分区服务配置');
          if (msg.length > 80) msg = msg.slice(0, 80) + '…';
          renderJournalRank(paper, msg);
        }
        if (!silent) toast(T('分区查询失败，请检查分区服务配置'));
      }).finally(function () { journalRankRefreshBusy = false; button.disabled = false; });
    }

    /**
     * 仅补查"没有分区数据"的期刊，严格控制 API 访问次数：
     * - 已有分区数据的（=有分区标签）一律跳过，不重刷
     * - 近 7 天内已查过但仍无数据的也跳过（避免反复请求空结果）
     * - 同期刊只请求一次；串行 + 每批 600ms 间隔，避免服务商限流
     * 表头那颗圆圈按钮是开关：点一下开始，跑的时候再点一下暂停（队列与进度留着），
     * 再点继续。因此运行期间按钮**不能** disabled——否则第二次点击根本不会触发。
     */
    var rankRefreshRun = null;          // { venues, cursor, done, total, failed, paused }
    var rankRefreshInterval = 600;      // 串行批间隔：EasyScholar（≤2 次/秒）等契约下绝对安全

    function updateRankRefreshUi() {
      var run = rankRefreshRun;
      var stateName = !run ? 'idle' : (run.paused ? 'paused' : 'running');
      var button = $('#rank-refresh-all');
      if (button) {
        button.disabled = false;        // 运行中也必须可点：点一下就是暂停
        button.dataset.rankState = stateName;
        var label = stateName === 'running' ? T('正在补查期刊分区（点一下暂停）')
          : stateName === 'paused' ? T('分区补查已暂停（点一下继续）')
            : T('补查当前文件夹缺失的期刊分区');
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', stateName === 'running' ? 'true' : 'false');
        var icon = button.querySelector('use');
        if (icon) {
          icon.setAttribute('href', stateName === 'running' ? '#lb-i-pause'
            : (stateName === 'paused' ? '#lb-i-play' : '#lb-i-refresh'));
        }
      }
      var progress = $('#rank-refresh-progress');
      if (progress) {
        progress.hidden = !run;
        progress.classList.toggle('paused', stateName === 'paused');
        progress.textContent = run ? run.done + '/' + run.total : '';
      }
    }

    function delayThenRankRefresh(fn, ms) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(fn()); }, ms);
      });
    }

    function finishRankRefresh() {
      var run = rankRefreshRun;
      rankRefreshRun = null;
      journalRankFreezeOrder = null;
      updateRankRefreshUi();
      save();
      renderTable();
      if (!run) return;
      toast(run.failed
        ? T('当前文件夹分区补查完成：') + (run.total - run.failed) + T(' 成功，') + run.failed + T(' 无数据')
        : T('✓ 当前文件夹分区补查完成：') + run.total + T(' 个期刊'));
    }

    function pauseRankRefresh() {
      var run = rankRefreshRun;
      if (!run) return;
      run.paused = true;
      // 冻结只在跑的时候有意义：暂停后让表格回到常规排序，同时把已查到的结果落盘
      journalRankFreezeOrder = null;
      save();
      renderTable();
      updateRankRefreshUi();
      toast(T('已暂停分区补查：') + run.done + '/' + run.total + T('（再点一下继续）'));
    }

    function runRankRefreshStep() {
      var run = rankRefreshRun;
      if (!run || run.paused) return Promise.resolve();
      if (run.stepActive) return Promise.resolve();
      if (run.cursor >= run.venues.length) { finishRankRefresh(); return Promise.resolve(); }
      run.stepActive = true;
      var entry = run.venues[run.cursor++];
      var key = entry.key;
      journalRankPending[key] = true;
      renderTable();
      return desktop.getScigreatRank(journalRankInput(entry)).then(function (response) {
        var data = rankResultData(response);
        var now = Date.now();
        state.papers.forEach(function (paper) {
          if (paper.deletedAt || !paper.venue) return;
          if (String(paper.venue).trim().toLowerCase() !== key) return;
          paper.journalRankCheckedAt = now;
          paper.journalRank = data ? journalRankFromData(data) : null;
        });
        if (!data) run.failed++;
      }).catch(function () { run.failed++; })
        .finally(function () {
          delete journalRankPending[key];
          run.done++;
          updateRankRefreshUi();
          renderTable();
          if (rankRefreshRun === run && run.paused) {
            save();                     // 暂停瞬间正在飞的那次请求也要落地，别随进程丢掉
          } else {
            toast(T('分区补查中 ') + run.done + '/' + run.total + (run.failed ? T('，失败 ') + run.failed : '') + '…', 1200);
          }
        })
        .then(function () {
          return delayThenRankRefresh(function () {
            run.stepActive = false;
            if (rankRefreshRun === run) return runRankRefreshStep();
          }, rankRefreshInterval);
        });
    }

    function refreshAllJournalRanks() {
      if (!desktop || !desktop.getScigreatRank) { toast(T('期刊分区查询仅在桌面版可用')); return Promise.resolve(); }
      if (rankRefreshRun) {
        // 已有任务：这一下是暂停；暂停中则是继续（队列接着跑，不重新扫描文件夹）
        if (rankRefreshRun.paused) {
          rankRefreshRun.paused = false;
          journalRankFreezeOrder = Array.prototype.map.call(
            document.querySelectorAll('#table-body tr.lit-row'), function (tr) { return tr.dataset.id; }
          );
          updateRankRefreshUi();
          toast(T('继续分区补查：') + rankRefreshRun.done + '/' + rankRefreshRun.total);
          return runRankRefreshStep();
        }
        pauseRankRefresh();
        return Promise.resolve();
      }
      var oneWeek = 7 * 24 * 60 * 60 * 1000;
      var seen = Object.create(null);
      var venues = [];
      // 只补查当前文件夹（当前视图）下没有分区数据的期刊，不做全库扫描
      filteredPapers().forEach(function (paper) {
        if (paper.deletedAt || !paper.venue) return;
        if (isArxivPaper(paper)) return;
        if (paper.journalRank) return;                     // 已有分区数据 → 不刷
        var checkedAt = Number(paper.journalRankCheckedAt) || 0;
        if (Date.now() - checkedAt < oneWeek) return;      // 近 7 天查过仍无数据 → 不刷
        var key = String(paper.venue).trim().toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        venues.push({ key: key, venue: paper.venue, issn: paper.issn || '' });
      });
      if (!venues.length) {
        toast(T('当前文件夹没有需要补查的期刊（已有分区数据或近 7 天查过）'));
        return Promise.resolve();
      }
      rankRefreshRun = { venues: venues, cursor: 0, done: 0, total: venues.length, failed: 0, paused: false };
      // 冻结当前显示顺序（按分区列排序时数据更新也不会让行跳位）
      journalRankFreezeOrder = Array.prototype.map.call(
        document.querySelectorAll('#table-body tr.lit-row'), function (tr) { return tr.dataset.id; }
      );
      updateRankRefreshUi();
      return runRankRefreshStep();
    }


    function bind() {
      $('#d-journal-rank-refresh').addEventListener('click', refreshJournalRank);
      // 这颗按钮住在可排序的表头里：不拦住冒泡的话，点一下开始/暂停会顺带把表格按分区重排
      $('#rank-refresh-all').addEventListener('click', function (event) {
        event.stopPropagation();
        refreshAllJournalRanks();
      });
      updateRankRefreshUi();   // 先落一次初始态：data-rank-state/图标不依赖第一次点击
    }

    var api = {
      bind: bind,
      clearFrozenOrder: function () { journalRankFreezeOrder = null; },
      frozenOrder: function () { return journalRankFreezeOrder; },
      isPending: function (key) { return !!journalRankPending[key]; },
      refresh: refreshJournalRank,
      refreshAll: refreshAllJournalRanks,
      refreshFolder: refreshFolderJournalRanks,
      renderRank: renderJournalRank,
      resultData: rankResultData,
      shouldRefresh: shouldRefreshJournalRank,
      summary: journalRankSummary,
      stateForTest: function () {
        return { pending: journalRankPending, frozen: journalRankFreezeOrder, run: rankRefreshRun, busy: journalRankRefreshBusy };
      }
    };
    return api;
  }

  return { create: create };
});
