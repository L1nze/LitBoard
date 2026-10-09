'use strict';

const { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createLibraryStorage } = require('./storage.js');
const { createLibraryDb } = require('./db.js');
const { createIntegrations } = require('./integrations.js');
const { createBridgeServer } = require('./bridge-server.js');
const { createResearchDb } = require('./research-db.js');
const { createResearchNet } = require('./research-net.js');
const { createResearchEmbedder } = require('./research-build.js');
const { createAgentNet } = require('./agent-net.js');
const { createEmbedService } = require('./embed-net.js');
const { createSessions } = require('./sessions.js');
const { createDataPathManager } = require('./data-paths.js');
const { createBackupManager } = require('./backup.js');
const { createWebFetchNet } = require('./webfetch-net.js');
const { createUpdateManager } = require('./update-check.js');
/* 界面语言：与渲染层共用 js/i18n.js + js/i18n-en.js（UMD 双出口）。
 * 键 = 中文源串；语言存 settings 表 uiLang（渲染层切换时经 settings:set 写入）。 */
const LitI18n = require('../js/i18n.js');
require('../js/i18n-en.js');
const T = LitI18n.t.bind(LitI18n);

/* IPC 域模块：全部 handler 注册按域拆在 electron/ipc/ 下（通道/行为与拆分前逐字一致）。
 * ctx 是跨模块共享的可变状态单例——main.js 启动装配写入、域模块在 handler 被调用时读取
 * （晚绑定约定与理由见 ipc/context.js 头注释）。 */
const ctx = require('./ipc/context.js');
const { registerAll } = require('./ipc');
const { agentSessionsRoot } = require('./ipc/agent.js');
const { scheduleAutoEmbed } = require('./ipc/research.js');
const { openAccessPdfDir } = require('./ipc/api.js');
const { itemAttachmentDir } = require('./item-storage.js');
const startupLog = ctx.startupLog;

function ignoreBrokenPipe(stream) {
  stream.on('error', function (error) {
    if (error && error.code === 'EPIPE') return;
    throw error;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

const SMOKE_TEST = process.env.LITBOARD_SMOKE_TEST === '1';
// 生命周期冒烟模式：write（写入并真实关闭）/ verify（重启后校验）
const LIFECYCLE_MODE = process.env.LITBOARD_SMOKE_LIFECYCLE || '';
// M4 分段计时起点：主进程模块加载时刻
const BOOT_T0 = Date.now();
const SMOKE_PDF = process.env.LITBOARD_SMOKE_PDF || '';
const SMOKE_FOLDER = process.env.LITBOARD_SMOKE_FOLDER || '';
const SMOKE_EPUB = process.env.LITBOARD_SMOKE_EPUB || '';
// 可选：把 smoke 渲染的 PDF 页截图到指定文件（肉眼检查渲染效果用）
const SMOKE_SHOT = process.env.LITBOARD_SMOKE_SHOT || '';
const SMOKE_SCALE = Number(process.env.LITBOARD_SMOKE_SCALE) || 0.2; // 截图目检时可调大
const SMOKE_EXPECT_RENDERER = 'mupdf';

// 启动诊断日志的实现随 IPC 域拆分移至 ipc/context.js（全进程唯一实例：
// 整文件重写式日志，两份实例会互相覆盖）；main.js 经上方 ctx.startupLog 别名调用。

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let bootstrapUserData = '';
if (!hasSingleInstanceLock) {
  startupLog(T('single-instance lock NOT acquired（已有实例在运行或残留），本次启动静默退出'));
  app.quit();
} else {
  startupLog('single-instance lock acquired');
  bootstrapUserData = app.getPath('userData');
  ctx.dataPathManager = createDataPathManager({ defaultDir: bootstrapUserData });
  ctx.dataPathState = ctx.dataPathManager.prepareAtStartup();
  ctx.setStartupLogFile(path.join(ctx.dataPathState.configDir, 'litboard-startup.log'));
  startupLog('data paths ready, config=' + ctx.dataPathState.configDir + ' library=' + ctx.dataPathState.libraryDir +
    (ctx.dataPathState.fatalError ? ' FATAL: ' + ctx.dataPathState.migrationError : ''));
  if (!ctx.dataPathState.fatalError) {
    // 必须在 ready/BrowserWindow 之前设置，Chromium 的 Local Storage、Preferences
    // 与 session 数据才会随“配置目录”一起迁移。
    app.setPath('userData', ctx.dataPathState.configDir);
    app.setPath('sessionData', ctx.dataPathState.configDir);
  }
}

/* 子系统实例统一挂在 ctx（ipc/ipc 域模块调用时读取）；main.js 侧只有 mainWindow
 * 保留本地引用——createWindow 是唯一赋值点，与 ctx.mainWindow 同时写入（单点镜像）。 */
let mainWindow = null;

/* litboard:// 深链：仅允许 open/paper/<id> 形态（+ attachment/annotation/page 查询），
 * 其余形态一律拒绝。返回 { paperId, attachmentId, annotationId, page } 或 null。 */
function parseLitboardUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'litboard:') return null;
    if (url.hostname.toLowerCase() !== 'open') return null;
    const match = /^\/paper\/([A-Za-z0-9_-]{1,120})$/.exec(url.pathname);
    if (!match) return null;
    const validId = function (v) { return /^[A-Za-z0-9_-]{1,120}$/.test(String(v || '')) ? String(v) : ''; };
    const page = Number(url.searchParams.get('page'));
    return {
      paperId: match[1],
      attachmentId: validId(url.searchParams.get('attachment')),
      annotationId: validId(url.searchParams.get('annotation')),
      page: Number.isFinite(page) && page > 0 ? Math.trunc(page) : 0
    };
  } catch (error) { return null; }
}

function openLitboardTarget(raw) {
  const target = parseLitboardUrl(raw);
  if (!target) return false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:open-target', target);
    return true;
  }
  pendingOpenTarget = target;
  return true;
}

let pendingOpenTarget = null;

if (hasSingleInstanceLock) {
  app.on('second-instance', function (event, argv) {
    startupLog(T('second-instance：另一次启动被本实例接管') +
      (mainWindow && !mainWindow.isDestroyed() ? '' : T('（但本实例当前没有窗口！）')));
    // Windows 下 litboard:// 拉起经 second-instance argv 传入
    (Array.isArray(argv) ? argv : []).forEach(function (arg) {
      if (String(arg).indexOf('litboard://') === 0) openLitboardTarget(arg);
    });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

async function finishSmokeTest(payload, exitCode) {
  if (process.env.LITBOARD_SMOKE_RESULT) {
    await fs.writeFile(process.env.LITBOARD_SMOKE_RESULT, JSON.stringify(payload, null, 2), 'utf8');
  }
  app.exit(exitCode);
}

function safeExternalUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch (error) { return ''; }
}

function createWindow() {
  mainWindow = ctx.mainWindow = new BrowserWindow({
    show: !SMOKE_TEST,
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 600,
    backgroundColor: '#f9f9f7',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !SMOKE_TEST // smoke 截图需要隐藏窗口也正常绘制
    }
  });

  mainWindow.webContents.once('did-finish-load', function () {
    // 启动时经命令行传入的 litboard:// 深链：窗口与渲染层就绪后派发
    if (pendingOpenTarget) {
      mainWindow.webContents.send('app:open-target', pendingOpenTarget);
      pendingOpenTarget = null;
    }
  });

  if (SMOKE_TEST && LIFECYCLE_MODE) {
    // 生命周期冒烟（M1-4 / M5）：write 阶段写入一条文献后**真实关闭窗口**（走 close 拦截收尾），
    // 由外部脚本重启进入 verify 阶段校验数据仍在。证明「正常关闭→重启后数据一致」。
    mainWindow.webContents.once('did-finish-load', async function () {
      try {
        if (LIFECYCLE_MODE === 'write') {
          const result = await mainWindow.webContents.executeJavaScript(`(async function () {
            const workspace = window.LitModel.normalizeWorkspace(await window.litboardDesktop.loadLibrary());
            workspace.papers.push(window.LitModel.normalizePaper({
              id: 'lifecyclepaper', title: 'Lifecycle Consistency Paper', entryType: 'article'
            }));
            const stats = await window.litboardDesktop.saveLibrary(workspace);
            const reloaded = await window.litboardDesktop.loadLibrary();
            return { written: stats.papersWritten, countAfterSave: reloaded.papers.length };
          })()`);
          result.closedCleanly = await new Promise(function (resolve) {
            let settled = false;
            const closeT0 = Date.now(); // M4：关闭收尾（close 拦截 → 保存落库 → ack）耗时
            const finish = function (value) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              ipcMain.removeListener('app:close-ack', onAck);
              result.closeAckMs = Date.now() - closeT0;
              resolve(value);
            };
            const onAck = function (_event, payload) { finish(!!payload && payload.ok !== false); };
            const timer = setTimeout(function () { finish(false); }, 5000);
            ipcMain.on('app:close-ack', onAck);
            mainWindow.close(); // 真实关闭：主进程 close 拦截 → 渲染层保存收尾 → ack 放行
          });
          console.log('LITBOARD_LIFECYCLE_WRITE ' + JSON.stringify(result));
          if (process.env.LITBOARD_SMOKE_RESULT) {
            await fs.writeFile(process.env.LITBOARD_SMOKE_RESULT, JSON.stringify(result, null, 2), 'utf8');
          }
          // 关闭收尾通过后窗口已进入关闭流程，window-all-closed 会触发 app.quit()
          if (!result.closedCleanly) app.exit(1);
          return;
        }
        // verify 阶段
        const result = await mainWindow.webContents.executeJavaScript(`(async function () {
          const workspace = await window.litboardDesktop.loadLibrary();
          const paper = workspace.papers.find(function (p) { return p.id === 'lifecyclepaper'; });
          return {
            paperCount: workspace.papers.filter(function (p) { return !p.deletedAt; }).length,
            title: paper && paper.title || ''
          };
        })()`);
        result.consistent = result.paperCount === 1 && result.title === 'Lifecycle Consistency Paper';
        console.log('LITBOARD_LIFECYCLE_VERIFY ' + JSON.stringify(result));
        await finishSmokeTest(result, result.consistent ? 0 : 1);
      } catch (error) {
        console.error('LITBOARD_LIFECYCLE_ERROR', error);
        await finishSmokeTest({ error: String(error && error.message || error) }, 1);
      }
    });
    mainWindow.webContents.once('did-fail-load', async function (_event, code, description) {
      await finishSmokeTest({ error: description, code: code }, 1);
    });
  } else if (SMOKE_TEST) {
    mainWindow.webContents.once('did-finish-load', async function () {
      try {
        mainWindow.setContentSize(1080, 720);
        const result = await mainWindow.webContents.executeJavaScript(`(async function () {
          const pdfResourceRequests = [];
          const pdfPath = ${JSON.stringify(SMOKE_PDF)};
          const folderPath = ${JSON.stringify(SMOKE_FOLDER)};
          const secondPdfPath = ${JSON.stringify(process.env.LITBOARD_SMOKE_PDF_SECOND || '')};
          const epubPath = ${JSON.stringify(SMOKE_EPUB)};
          const shotWanted = ${SMOKE_SHOT ? 'true' : 'false'};
            await window.LitPdf.load();
          const result = {
            desktopBridge: !!window.litboardDesktop,
            modelLoaded: !!window.LitModel,
            tablePresent: !!document.querySelector('#lit-table'),
            pdfColumnPresent: !!document.querySelector('.col-attachment'),
            tableColumnsPresent: !!document.querySelector('#table-columns-btn') &&
              !!document.querySelector('#table-columns-btn .ic use[href="#lb-i-columns"]') &&
              !!document.querySelector('#table-columns-btn')?.closest('.table-footer-actions') &&
              !!document.querySelector('#lit-table th[data-column="status"]') &&
              !!document.querySelector('#lit-table th[data-column="tags"]') &&
              !!document.querySelector('#lit-table th[data-column="title"] .column-resizer'),
            markdownLoaded: !!window.LitMarkdown,
            syncUiPresent: !!document.querySelector('#sync-mask'),
            syncNavGroups: document.querySelectorAll('#sync-mask .sync-nav-btn').length,
            dataPathUiPresent: !!document.querySelector('#sync-config-dir') &&
              !!document.querySelector('#sync-library-dir') && !!document.querySelector('#sync-data-paths-apply'),
            // 路径要能直接手输（不只靠「选择…」按钮），别被改回 readonly
            dataPathTypable: !!document.querySelector('#sync-config-dir') &&
              !document.querySelector('#sync-config-dir').readOnly &&
              !document.querySelector('#sync-library-dir').readOnly,
            dataPathApiPresent: !!window.litboardDesktop.getDataPaths &&
              !!window.litboardDesktop.stageDataPaths && !!window.litboardDesktop.relaunchApp,
            nutstoreTestPresent: !!document.querySelector('#sync-test-nutstore'),
            nutstoreFolderPresent: !!document.querySelector('#sync-nutstore-folder'),
            remoteRecoveryUiPresent: !!document.querySelector('#sync-remote-inspect') && !document.querySelector('#sync-remote-config') &&
              !!document.querySelector('#sync-remote-restore') && !!document.querySelector('#sync-remote-merge') &&
              !!document.querySelector('#sync-remote-plan-mask'),
            remotePlanProgressPresent: !!document.querySelector('#sync-remote-plan-progress') &&
              !!document.querySelector('#sync-remote-plan-progress-bar') && !!document.querySelector('#sync-remote-plan-progress-text') &&
              !!window.litboardDesktop.onSyncProgress,
            syncStopPresent: !!document.querySelector('#sync-stop') && !!window.litboardDesktop.cancelNutstoreSync &&
              !!document.querySelector('#sync-remote-plan-cancel'),
            autoSyncTogglePresent: !!document.querySelector('#sync-auto-sync') && !!window.litboardDesktop.getSetting &&
              !!window.litboardDesktop.setSetting,
            // 「立即同步」按钮归属云同步分组，不再挂在弹窗页脚（改动本就即时保存，
            // 页脚再放一个「保存并同步」会让人以为不点就丢设置）
            syncNowInCloudPresent: !!document.querySelector('#sync-run') &&
              !!document.querySelector('#sync-run').closest('.sync-section[data-sync-group="cloud"]') &&
              !document.querySelector('.sync-modal-actions #sync-run'),
            remoteRecoveryApiPresent: !!window.litboardDesktop.inspectNutstoreRemote && !window.litboardDesktop.pullNutstoreConfig &&
              !!window.litboardDesktop.createNutstoreSyncPlan && !!window.litboardDesktop.applyNutstoreSyncPlan,
            // 「数据与备份」的排列：本地数据位置 → 会话记录 → Zotero 文献库 → 完整备份…
            // 前三个都是「数据落在哪」，排在备份/索引等维护动作之前
            dataSectionOrderPresent: (function () {
              var secs = document.querySelectorAll('.sync-section[data-sync-group="storage"]');
              return !!secs[0] && !!secs[0].querySelector('#sync-config-dir') &&
                !!secs[1] && !!secs[1].querySelector('#sync-agent-session-root') &&
                !!secs[2] && !!secs[2].querySelector('#sync-zotero-dir');
            })(),
            inlineTestStatusPresent: !!document.querySelector('#sync-nutstore-test-status') && !!document.querySelector('#sync-scigreat-test-status'),
            nestedFolderUiPresent: !!document.querySelector('#folder-create-parent'),
            folderTreeModulePresent: !!window.LitFolderTree,
            muPdfLoaded: !!window.LitMuPdf,
            pdfLayoutTogglePresent: !!document.querySelector('#pdf-layout-toggle'),
            translationUiPresent: !!document.querySelector('#pdf-translate-selection') && !!document.querySelector('#sync-translator-provider'),
            // 检索语法速查：占位符不再罗列语法，帮助必须有看得见的入口（? 按钮 + 浮层可开）
            searchHelpUiPresent: !!document.querySelector('#btn-search-help') && !!document.querySelector('#search-help-pop'),
            // 「插入引文」的检索框与主检索框同构：内嵌放大镜 + 语法速查入口 + 语法错误提示
            wordCiteSearchUiPresent: !!document.querySelector('#word-cite-search').closest('.search-wrap') &&
              !!document.querySelector('#word-cite-search').closest('.search-wrap').querySelector('.search-icon') &&
              !!document.querySelector('#btn-word-cite-help') && !!document.querySelector('#word-cite-hint'),
            // AI 调研助手（一期）：抽屉 + 顶栏入口 + 设置区（AI 助手/检索服务/调研库/会话记录）+ IPC 面
            agentDrawerPresent: !!document.querySelector('#agent-drawer') && !!document.querySelector('#agent-chat-root') &&
              !!document.querySelector('#agent-history') && !!document.querySelector('#btn-agent') &&
              !!document.querySelector('#agent-model') && !!document.querySelector('#agent-thinking') &&
              // 模型徽标是可点开的切换按钮（分组菜单 + 「管理模型…」）
              !!document.querySelector('#agent-model-btn') && !!window.LitAgentCfg &&
              !!document.querySelector('#agent-provider-items') && !!document.querySelector('#agent-provider-detail') &&
              !!document.querySelector('#agent-provider-add') &&
              !!window.litboardDesktop.agentSetSelection &&
              !!document.querySelector('#sync-openalex-email') &&
              !!document.querySelector('#sync-agent-session-root'),
            agentApiPresent: !!window.litboardDesktop.agentChat && !!window.litboardDesktop.agentCancel &&
              !!window.litboardDesktop.researchQuery && !!window.litboardDesktop.researchSearchOpenalex &&
              !!window.litboardDesktop.sessionList && !!window.litboardDesktop.sessionFork && !!window.litboardDesktop.onAgentEvent,
            // M9 二期：向量嵌入区 / Elsevier 凭据 / 回填 / 补登记 / 语义检索与 PDF 两步 IPC 面
            agentPhase2Present: !!document.querySelector('#sync-embed-model') && !!document.querySelector('#sync-embed-build') &&
              !!document.querySelector('#sync-embed-provider') && !!document.querySelector('#sync-embed-base-url') &&
              !!document.querySelector('#sync-embed-api-key') && !!document.querySelector('#sync-embed-test') &&
              !!window.litboardDesktop.embedTest &&
              !!document.querySelector('#sync-elsevier-key') && !!document.querySelector('#sync-research-backfill') &&
              !!document.querySelector('#sync-research-register') &&
              !!window.litboardDesktop.researchSemanticSearch && !!window.litboardDesktop.researchBackfill &&
              !!window.litboardDesktop.researchEmbedBuild && !!window.litboardDesktop.researchDownloadPdfs &&
              !!window.litboardDesktop.researchStagePdfs && !!window.litboardDesktop.researchRegister,
            // M9 三期：引文网络面板 + vis 库 + 组装模块 + IPC 面 + 双入口菜单项
            // （版式对照 literature-mcp：三栏 = 本图论文 / 画布 / 详情 + 图例）
            agentGraphPresent: !!document.querySelector('#graph-mask') && !!document.querySelector('#graph-canvas') &&
              !!document.querySelector('#graph-resize-grip') &&
              !!document.querySelector('.graph-modal') &&
              getComputedStyle(document.querySelector('.graph-modal')).position === 'relative' &&
              !!document.querySelector('#graph-export') &&
              !!document.querySelector('#graph-list') && !!document.querySelector('#graph-detail') &&
              !!document.querySelector('#graph-legend') && !!document.querySelector('#graph-meta') &&
              !!window.vis && !!window.vis.Network && !!window.LitGraphGen && !!window.LitGraphView &&
              !!window.litboardDesktop.researchGraph,
            // 引文网络三栏端到端：纯函数建图 → 面板渲染 → 左列表/右详情/图例/画布都真的产出
            // （不联网、不碰调研库：数据源注入内存库）
            graphViewerWorks: await (async function () {
              try {
                const G = window.LitGraphGen;
                if (!G || !window.LitGraphView || !G.viewerData || !G.buildGraphData) return false;
                const lib = {};
                for (let i = 0; i < 24; i++) {
                  lib['W' + i] = {
                    id: 'W' + i, title: 'Smoke paper ' + i, year: 2000 + (i % 12), citedBy: i * 5,
                    authors: [{ name: 'Author' + i + ' Surname' }], sourceName: 'Journal',
                    abstract: 'abstract ' + i, refs: []
                  };
                }
                for (let i = 0; i < 24; i++) lib['W' + i].refs = ['W' + ((i + 1) % 24), 'W0'];
                const graph = await G.buildGraphData(Object.keys(lib), { depth: 0, maxNodes: 120 }, {
                  getWorks: async function (ids) { return ids.map(function (id) { return lib[id]; }).filter(Boolean); }
                });
                window.LitGraphView.showData(graph, '冒烟引文网络');
                const view = G.viewerData(graph, { palette: 'light' });
                const rows = document.querySelectorAll('#graph-list .paper-row').length;
                const detail = document.querySelector('#graph-detail');
                const legend = document.querySelector('#graph-legend');
                const meta = document.querySelector('#graph-meta');
                const labels = view.nodes.filter(function (n) { return n.label; }).length;
                const ok = rows === 24 && graph.meta.nodeCount === 24 && graph.meta.edgeCount > 0 &&
                  !!document.querySelector('#graph-canvas canvas') &&
                  !!detail && detail.textContent.indexOf('Smoke paper') !== -1 &&
                  !!legend && legend.innerHTML.indexOf('yearbar') !== -1 &&
                  !!document.querySelector('#physicsToggle') &&
                  !!meta && meta.textContent.indexOf('节点 24') !== -1 &&
                  labels > 0 && labels < 24;   // 标签必须稀疏（每个节点都挂标签就是那团毛线球）
                window.LitGraphView.close();
                return ok;
              } catch (error) { return String(error && error.message || error); }
            })(),
            // M9-4：科研网页检索——设置 UI + IPC 面 + 纯函数模块 + 工具门控（默认关：未传 includeWebSearch 不注册）
            agentWebSearchPresent: !!document.querySelector('#sync-web-search-enabled') &&
              !!document.querySelector('#sync-tinyfish-key') &&
              !!window.litboardDesktop.researchWebSearch && !!window.litboardDesktop.researchFetchPage &&
              !!window.LitWebFetch &&
              !window.LitAgent.createTools({ desktop: {} }).tools.some(function (t) { return t.function.name === 'web_search'; }) &&
              window.LitAgent.createTools({ desktop: {}, includeWebSearch: true }).tools.some(function (t) { return t.function.name === 'web_search'; }),
            sourceApiLinksPresent: !!document.querySelector('a[href="https://openalex.org/settings/api"]') &&
              !!document.querySelector('a[href="https://dev.elsevier.com/apikey/create"]') &&
              !!document.querySelector('a[href="https://agent.tinyfish.ai/"]'),
            updateCheckPresent: !!window.litboardDesktop.checkAppUpdate &&
              !!window.litboardDesktop.getAppUpdateStatus &&
              !!window.litboardDesktop.applyAppUpdate &&
              !!document.querySelector('#topbar-check-update') &&
              !!document.querySelector('#topbar-version'),
            // PDF 阅读助手（期一）：agent 的按页读取/批注工具 + 页区间 IPC
            //（阅读器「AI 解释」按钮已于 2026-09-20 整体移除，用户反馈无实际作用）
            agentReaderPresent: !!window.litboardDesktop.pdfSearchGetPageRange,
            // R16：段落找文献——IPC 面 + 纯函数层 + 工具常驻注册；
            // 语义检索只作为 agent 工具（供应商开关与手动模式「语义检索」按钮已移除）；
            // Semantic Scholar Key 输入框已从设置页移除（共享池够用），故不再断言该元素
            agentFindLiteraturePresent: !!window.LitLitSearch &&
              !!window.litboardDesktop.researchFindLiterature &&
              !!window.litboardDesktop.researchSearchSemanticscholar &&
              window.LitAgent.createTools({ desktop: {} }).tools.some(function (t) {
                return t.function.name === 'find_literature';
              }),
            // 上下文 / 输出预算（设置 → AI 助手）：两项设置 UI + 预算真的落进请求体
            agentBudgetSettingsPresent: !!document.querySelector('#sync-agent-context-tokens') &&
              !!document.querySelector('#sync-agent-max-output-tokens') &&
              window.LitAgentCore.DEFAULTS.contextTokens === 256000 &&
              window.LitAgentCore.DEFAULTS.maxOutputTokens === 12800 &&
              window.LitAgentCore.buildRequestBody({ messages: [] }, { maxOutputTokens: 4321 }).max_tokens === 4321,
            // R17/R18：上下文压缩 + 文献检索能力补齐——设置/按钮 UI、纯函数层、
            // buildRequestBody 真的跳过已压缩消息，新工具（get_work 等）已注册
            agentExecutablePlanPresent: !!window.LitAgentPlan && !!window.LitAgentDispatch &&
              window.LitAgentPlan.validateProposal({ goal: 'x', steps: [{ content: 'read', status: 'completed' }] }, {}).ok === false,
            agentSteeringPresent: typeof window.LitAgentLoop.createRunner({ core: window.LitAgentCore }).enqueue === 'function' &&
              !!window.LitAgentChat && !!document.querySelector('.aui-composer-wrap'),
            agentReferenceSearchPresent: !!window.LitAgentFileContext &&
              !!window.litboardDesktop.sessionListReferences && !!window.litboardDesktop.sessionSearchReference &&
              window.LitAgent.createTools({ desktop: {} }).tools.some(function (t) { return t.function.name === 'search_session_file'; }),
            agentContextUsagePresent: !!document.querySelector('#agent-tokens') &&
              typeof window.LitAgentCore.currentInputTokens === 'function' &&
              window.LitAgentCore.currentInputTokens({ tokens: { in: 700000, out: 14000 } }, { messages: [{ role: 'user', content: 'hello' }] }) < 100,
            agentContextMgmtPresent: !!document.querySelector('#agent-compact-btn') &&
              !!document.querySelector('#sync-agent-autocompact') &&
              !!window.LitAgentContext && window.LitAgentContext.isContextOverflowError('context_length_exceeded') &&
              (function () {
                const msgs = [
                  { role: 'user', content: 'x'.repeat(20000) },
                  { role: 'assistant', content: 'y'.repeat(20000) },
                  { role: 'user', content: 'w'.repeat(20000) },
                  { role: 'assistant', content: 'v'.repeat(20000) },
                  { role: 'user', content: '最新问题' },
                  { role: 'assistant', content: 'z'.repeat(20000) }
                ];
                const est = function (msg) { return window.LitAgentCore.estimateTokens(JSON.stringify(msg || {})); };
                const plan = window.LitAgentContext.planCompaction(msgs, { estimate: est, thresholdTokens: 1000, preserveRecentTokens: 500 });
                if (!plan) return false;
                window.LitAgentContext.applyCompaction({ messages: msgs, turnId: 't' }, plan, '摘要', { estimate: est });
                const body = window.LitAgentCore.buildRequestBody({ messages: msgs, historyMessageCap: 40 }, {});
                return msgs.some(function (m) { return m.compacted === true; }) &&
                  body.messages.some(function (m) { return String(m.content || '').indexOf('摘要') !== -1; });
              })(),
            agentReferenceUiPresent: !!document.querySelector('#agent-upload-btn') &&
              !!document.querySelector('#agent-pending-references') && !!window.litboardDesktop.sessionReadReference &&
              (function () {
                const holder = document.querySelector('#agent-plan');
                const run = { core: { messages: [{ role: 'tool', name: 'update_research_plan', content: JSON.stringify({ goal: '<img src=x onerror=alert(1)>', steps: [{ content: '<script>x</script>', status: 'pending', note: 'file=附件/test.txt' }] }) }] }, streaming: false };
                window.LitAgentUi.renderPlan(run);
                const safe = !holder.hidden && holder.textContent.includes('<script>x</script>') && !holder.querySelector('img, script') && !!holder.querySelector('button');
                window.LitAgentUi.renderPlan(null);
                return safe;
              })(),
            agentLitSearchToolsPresent: ['read_research_plan', 'update_research_plan', 'read_session_file', 'get_work', 'autocomplete_entity', 'backfill_abstracts', 'graph_neighbors', 'read_work_fulltext'].every(function (name) {
              return window.LitAgent.createTools({ desktop: {} }).tools.some(function (t) { return t.function.name === name; });
            }) && !!window.litboardDesktop.researchGetWork &&
              !!window.litboardDesktop.researchAutocomplete && !!window.litboardDesktop.researchGraphNeighbors &&
              !!window.litboardDesktop.researchFulltextRead && !!window.litboardDesktop.researchFulltextStore,
            agentCoreLoaded: !!window.LitResearch && !!window.LitAgentCore && !!window.LitAgentLoop &&
              !!window.LitAgent && !!window.LitAgentUi && !!window.LitAgentChat,
            // 右栏图标轨（Zotero 式）：AI 与详情共用同一栏宽度，点击图标互相切换。
            // 断言用真实可见性（offsetParent），不只看 hidden 属性——嵌套错误会让
            // 「hidden=false 但被祖先隐藏」这类问题漏网。
            rightRailPresent: !!document.querySelector('#right-rail') && !!document.querySelector('#rail-detail') &&
              !!document.querySelector('#panel-detail') && !!document.querySelector('#agent-drawer') &&
              document.querySelector('#agent-drawer').parentElement.classList.contains('detail-sidebar') &&
              !!document.querySelector('#btn-right-sidebar-toggle') && !!document.querySelector('#btn-left-sidebar-collapse') &&
              !!document.querySelector('#btn-left-sidebar-open'),
            railToggleAtBottom: (function () {
              const rail = document.querySelector('#right-rail');
              const toggle = document.querySelector('#btn-right-sidebar-toggle');
              if (!rail || !toggle || !toggle.closest('.right-rail-footer')) return false;
              const railRect = rail.getBoundingClientRect();
              const toggleRect = toggle.getBoundingClientRect();
              return toggleRect.width <= 36 && toggleRect.top > railRect.top + railRect.height / 2 &&
                railRect.bottom - toggleRect.bottom <= 12;
            })(),
            sidebarCollapseWorks: (function () {
              try {
                const ws = document.querySelector('.workspace');
                const leftClose = document.querySelector('#btn-left-sidebar-collapse');
                const leftOpen = document.querySelector('#btn-left-sidebar-open');
                const rightToggle = document.querySelector('#btn-right-sidebar-toggle');
                const sidebarRect = document.querySelector('#library-sidebar').getBoundingClientRect();
                const closeRect = leftClose.getBoundingClientRect();
                const closeAtTop = closeRect.top >= sidebarRect.top && closeRect.bottom <= sidebarRect.top + 42;
                leftClose.click();
                const leftOnly = ws.classList.contains('left-collapsed') && !ws.classList.contains('rail-collapsed');
                const openRect = leftOpen.getBoundingClientRect();
                const openAtTop = Math.abs(openRect.top - (sidebarRect.top + 12)) <= 2;
                rightToggle.click();
                const both = ws.classList.contains('left-collapsed') && ws.classList.contains('rail-collapsed');
                leftOpen.click();
                const rightOnly = !ws.classList.contains('left-collapsed') && ws.classList.contains('rail-collapsed');
                rightToggle.click();
                const expanded = !ws.classList.contains('left-collapsed') && !ws.classList.contains('rail-collapsed');
                return closeAtTop && openAtTop && leftOnly && both && rightOnly && expanded;
              } catch (error) { return String(error && error.message || error); }
            })(),
            railSwitchWorks: (function () {
              try {
                const railAi = document.querySelector('#btn-agent');
                const railDetail = document.querySelector('#rail-detail');
                const aiPane = document.querySelector('#agent-drawer');
                const detailPane = document.querySelector('#panel-detail');
                if (!railAi || !railDetail || !aiPane || !detailPane) return false;
                const visible = (node) => !!node.offsetParent && node.getBoundingClientRect().height > 0;
                railAi.click();
                const toAi = visible(aiPane) && !visible(detailPane) && railAi.classList.contains('active');
                railDetail.click();
                const toDetail = !visible(aiPane) && visible(detailPane) && railDetail.classList.contains('active');
                return toAi && toDetail;
              } catch (error) { return String(error && error.message || error); }
            })(),
            // 三栏和图标轨共用工作区的上下边界。
            workspacePanesAligned: (function () {
              try {
                const workspace = document.querySelector('.workspace').getBoundingClientRect();
                return ['#library-sidebar', '.center-pane', '#detail-sidebar', '.right-rail'].every(function (selector) {
                  const pane = document.querySelector(selector).getBoundingClientRect();
                  return Math.abs(pane.top - workspace.top) <= 1 && Math.abs(pane.bottom - workspace.bottom) <= 1;
                });
              } catch (error) { return String(error && error.message || error); }
            })(),
            // AI 对话层渲染冒烟：隔离容器强制挂载 assistant-ui（无需 Key），用含
            // text/reasoning/tool-call 三种 part 的真实消息驱动渲染——组件 API 漂移、
            // part props 形态错误、渲染崩溃都在这里拦截（必须渲染出消息 DOM）
            agentChatRendered: await (async function () {
              try {
                if (!window.LitAgentChat) return false;
                const probe = document.createElement('div');
                document.body.appendChild(probe);
                const messages = [
                  {
                    id: 't1:u1', role: 'user',
                    content: [{ type: 'text', text: '找电池文献' }],
                    metadata: { custom: { turnId: 't1', forkIndex: 0 } }
                  },
                  {
                    // H1 回归：同轮第二条 user 消息（工具注入的截图形态）——快照 id 必须唯一，
                    // 重复 id 会让 MessageRepository 抛错进错误边界
                    id: 't1:u2', role: 'user',
                    content: [{ type: 'text', text: '[已附加页面截图]' }],
                    metadata: { custom: { turnId: 't1', synthetic: true } }
                  },
                  {
                    id: 't1:a1', role: 'assistant',
                    content: [
                      { type: 'reasoning', text: '先检索……' },
                      { type: 'text', text: '**结果**如下' },
                      { type: 'tool-call', toolCallId: 'c1', toolName: 'search_openalex', args: { query: 'x' }, argsText: '{"query":"x"}', result: '{"works":[]}' }
                    ],
                    metadata: { custom: { turnId: 't1', forkIndex: 2 } }
                  }
                ];
                const forkedMessages = [];
                window.LitAgentChat.mount(probe, {
                  getSnapshot: function () { return { messages: messages, isRunning: false }; },
                  subscribe: function (cb) {
                    setTimeout(function () { cb({ messages: messages, isRunning: false }); }, 0);
                    return function () {};
                  },
                  T: function (s) { return s; },
                  sendSuggestion: function () {}, retry: function () {},
                  onFork: function (input) { forkedMessages.push(input.messageId); },
                  onCancel: function () {}, onNew: function () {}, onEdit: function () {}, onReload: function () {}
                });
                await new Promise(function (resolve) { setTimeout(resolve, 500); });
                let ok = !!probe.querySelector('.aui-root') && !!probe.querySelector('.aui-composer') &&
                  !!probe.querySelector('.aui-md') &&            // 正文 part 真的渲染了
                  !!probe.querySelector('.aui-tool-name') &&     // 工具卡渲染了
                  !probe.querySelector('.aui-crash');            // 没有落到错误边界
                // H2 端到端：悬停消息 →「编辑」可见 → 点击必须出现编辑输入框（此前只挂了
                // 按钮没挂编辑组件，点了原文仍只读、编辑重发走不通）；合成消息不出现编辑钮。
                // autohide 的 hover 态挂在 MessagePrimitive.Root 元素上（enter 类事件不冒泡，
                // 模拟悬停要发到它本人而不是外层容器）
                if (ok) {
                  const userRoot = probe.querySelector('.aui-msg.user .aui-bubble > div') ||
                    probe.querySelector('.aui-msg.user .aui-bubble');
                  if (userRoot) {
                    userRoot.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
                    userRoot.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                    userRoot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
                  }
                  await new Promise(function (resolve) { setTimeout(resolve, 400); });
                  const editBtn = Array.prototype.slice.call(probe.querySelectorAll('.aui-msg.user .aui-act'))
                    .find(function (btn) { return btn.textContent === '编辑'; });
                  ok = !!editBtn;                                  // 真人消息悬停后有编辑钮
                  if (ok) {
                    const buttons = Array.from(probe.querySelectorAll('.aui-fork'));
                    buttons.forEach(function (button) { button.click(); });
                    ok = buttons.length === 2 && forkedMessages.join(',') === 't1:u1,t1:a1' &&
                      buttons.every(function (button) { return button.textContent === '从此处分叉'; });
                  }
                  if (ok) {
                    editBtn.click();
                    await new Promise(function (resolve) { setTimeout(resolve, 400); });
                    ok = !!probe.querySelector('.aui-edit-wrap textarea'); // 编辑框真的出现
                    const cancelBtn = probe.querySelector('.aui-edit-wrap .aui-send');
                    if (cancelBtn) { cancelBtn.click(); await new Promise(function (r) { setTimeout(r, 200); }); }
                  }
                }
                // 输入区必须钉在面板底部：曾因 .agent-body 自身滚动 + 高度按内容收缩，
                // 输入框浮在半空、下面留一大片空白。这里用**真实样式链**量几何：
                // 给探针加 .agent-chat-root 并固定高度，输入区底边须与容器底边基本齐平
                // （若 composer 落回滚动视口内、或链上某层不再拉伸，gap 会立刻变大）。
                if (ok) {
                  try {
                    const box = document.createElement('div');
                    box.className = 'agent-chat-root';
                    box.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:600px;';
                    document.body.appendChild(box);
                    const unmountProbe = window.LitAgentChat.mount(box, {
                      getSnapshot: function () { return { messages: messages, isRunning: false }; },
                      subscribe: function () { return function () {}; },
                      T: function (s) { return s; },
                      sendSuggestion: function () {}, retry: function () {},
                      onCancel: function () {}, onNew: function () {}, onEdit: function () {}, onReload: function () {}
                    });
                    await new Promise(function (resolve) { setTimeout(resolve, 400); });
                    const wrap = box.querySelector('.aui-composer-wrap');
                    const gap = wrap
                      ? Math.abs(box.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom)
                      : NaN;
                    ok = !!wrap && gap <= 3;
                    unmountProbe();
                    box.remove();
                  } catch (error) { ok = false; }
                }
                probe.remove();
                return ok;
              } catch (error) { return String(error && error.message || error); }
            })(),
            // 聊天公式渲染端到端：LitMarkdown 出 .lb-math/.lb-math-block → agentui 的
            // typesetMath 懒加载 vendor/mathjax/tex-svg.js；SVG 引用的字形必须在 SVG 内有定义，
            // 否则只生成空壳节点，隐藏辅助 MathML 后公式会彻底不可见。
            chatMathRendered: await (async function () {
              try {
                if (!window.LitAgentUi || !window.LitAgentUi.typesetMath || !window.LitMarkdown) return false;
                const probe = document.createElement('div');
                probe.className = 'aui-md';
                const slash = String.fromCharCode(92);
                probe.innerHTML = window.LitMarkdown.render('行内 $x_1 + y_2 = z_3$ 与块级 $$E = mc^2$$ 结束') +
                  window.LitMarkdown.render('粗体 $' + slash + 'boldsymbol{' + slash + 'sigma}$');
                document.body.appendChild(probe);
                const done = await window.LitAgentUi.typesetMath(probe);
                const inline = probe.querySelector('.lb-math:not(.lb-math-block) mjx-container');
                const svg = inline && inline.querySelector('svg');
                const boldSvg = probe.querySelector('p:last-child .lb-math svg');
                const glyphsVisible = Array.from(probe.querySelectorAll('.lb-math svg')).every(function (formula) {
                  const ids = new Set(Array.from(formula.querySelectorAll('defs [id]')).map(function (node) { return node.id; }));
                  const uses = Array.from(formula.querySelectorAll('use'));
                  return uses.length > 0 && uses.every(function (node) {
                    return ids.has(String(node.getAttribute('xlink:href') || '').slice(1));
                  });
                });
                const ok = done === true &&
                  !!inline && !!svg &&
                  Math.abs(inline.getBoundingClientRect().width - svg.getBoundingClientRect().width) < 2 &&
                  !!probe.querySelector('.lb-math-block mjx-container') && glyphsVisible &&
                  !!boldSvg && !!boldSvg.querySelector('defs path[id*="-TEX-BI-"]');
                probe.remove();
                return ok;
              } catch (error) { return false; }
            })(),
            // 对话体是纵向 flex 容器（自身不滚动）：输入区与模型行才能钉在面板底部
            chatBodyIsFlexColumn: (function () {
              const body = document.querySelector('.agent-body');
              if (!body) return false;
              const style = getComputedStyle(body);
              return style.display === 'flex' && style.flexDirection === 'column' && style.overflowY === 'hidden';
            })(),
            translationAutoTogglePresent: !!document.querySelector('#pdf-auto-translate') && !!document.querySelector('#sync-translator-auto'),
            journalRankUiPresent: !!document.querySelector('#d-journal-rank') && !!document.querySelector('#d-journal-rank-refresh'),
            journalRankColumnPresent: !!document.querySelector('.col-rank[data-sort="journalRank"]'),
            readingStatusUiPresent: !!document.querySelector('#status-seg [data-status="reading"]') &&
              !document.querySelector('#status-seg [data-status="read"]') &&
              !!document.querySelector('#d-status option[value="reading"]') &&
              !document.querySelector('#d-status option[value="read"]'),
            tagsColumnRemoved: !document.querySelector('.col-tags'),
            // 分区列那颗圆圈按钮是「开始/暂停」开关：三种状态的图标与进度指示都必须就位
            rankRefreshTogglePresent: !!document.querySelector('#rank-refresh-all') &&
              !!document.querySelector('#lb-i-pause') && !!document.querySelector('#lb-i-play') &&
              !!document.querySelector('#rank-refresh-progress'),
            // 顶栏补全 = 开始/暂停开关 + 独立中断按钮（运行中才显示），缺一会退回「每次整批重跑」
            enrichControlsPresent: !!document.querySelector('#btn-enrich') &&
              !!document.querySelector('#btn-enrich-stop') && !!document.querySelector('#btn-enrich-stop').hidden &&
              !!document.querySelector('#lb-i-pause') && !!document.querySelector('#lb-i-play'),
            scigreatTestPresent: !!document.querySelector('#sync-scigreat-api-key') && !!document.querySelector('#sync-test-scigreat'),
            easyscholarTestPresent: !!document.querySelector('#sync-rank-provider') && !!document.querySelector('#sync-easyscholar-api-key'),
            // 检索与元数据服务：测试三个可配置源（结果区同批就位）
            sourcesTestPresent: !!document.querySelector('#sync-test-sources') &&
              !!document.querySelector('#sync-sources-test-status') &&
              !!document.querySelector('#sync-sources-test-result'),
            pdfAnnotationUiPresent: !!document.querySelector('#pdf-annotations') && !!document.querySelector('#pdf-add-highlight') &&
              !!document.querySelector('#pdf-add-underline') && !!document.querySelector('#pdf-add-note'),
            pdfDownloadButtonPresent: !!document.querySelector('#d-fetch-pdf'),
            detailActionsCompact: !!document.querySelector('#d-more') &&
              !document.querySelector('#d-enrich, #d-copy-bib, #d-delete') &&
              document.querySelectorAll('.drawer-head-actions > button:not([hidden])').length === 5,
            // 目录导入落点在侧栏；旧全局提示胶囊和统计区导入框应已移除。
            simpleFolderDropUi: !document.querySelector('#drag-hint-pill') &&
              !document.querySelector('#stats-drop-hint'),
            statsOverviewPresent: document.querySelectorAll('.stats-summary > .tile').length === 4 &&
              !!document.querySelector('.stats-summary > .chart-card:last-child #year-chart') &&
              !!document.querySelector('#chart-range') && !!document.querySelector('#chart-peak'),
            sidebarTagPanelPresent: !!document.querySelector('#tag-chips')?.closest('.library-sidebar') &&
              !!document.querySelector('#btn-manage-tags')?.closest('.library-sidebar') &&
              document.querySelector('#sidebar-tag-panel')?.parentElement?.id === 'library-sidebar' &&
              !!document.querySelector('#btn-tag-collapse') &&
              document.querySelector('#btn-tag-collapse').getAttribute('aria-controls') === 'tag-chips' &&
              document.querySelector('#tag-list-resize')?.closest('#sidebar-tag-panel') &&
              document.querySelector('#tag-list-resize').getAttribute('aria-valuemax') === '180',
            // 拖入文件夹导入：规划模块 + 更多菜单兜底入口（落区高亮是运行时行为，行为探针在下方补）
            folderImportPresent: !!window.LitFolderImport && !!document.querySelector('#more-import-folder') &&
              !!document.querySelector('#folder-empty'),
            removedSettingsAbsent: !document.querySelector('#sync-pdf-download-dir') &&
              !document.querySelector('#sync-rename-template') && !document.querySelector('#sync-bib-export-path') &&
              !document.querySelector('#sync-proxy-prefix') && !document.querySelector('#sync-trash-days'),
            simplifiedBackupUiPresent: !!document.querySelector('#sync-backup-dir') &&
              !!document.querySelector('#sync-backup-choose') && !!document.querySelector('#sync-backup-now') &&
              !!document.querySelector('#sync-backup-restore') && !!document.querySelector('#sync-backup-open') &&
              !!document.querySelector('#sync-backup-status') && !document.querySelector('#sync-backup-keep') &&
              !document.querySelector('#sync-backup-cleanup'),
            pdfSearchUiPresent: !!document.querySelector('#pdf-search') && !!document.querySelector('#btn-ft') &&
              !!document.querySelector('#ft-status') && !!window.LitPdfSearch,
            ocrEnginePresent: !!window.LitOcr && typeof window.LitOcr.ocrPages === 'function' &&
              typeof window.LitOcr.dataStatus === 'function' && typeof window.LitOcr.ensureData === 'function' &&
              typeof window.LitOcr.cancel === 'function',
            pdfSearchTogglePresent: !!document.querySelector('#pdf-search-toggle'),
            pdfSearchOptionsPresent: !!document.querySelector('#pdf-search-case') &&
              !!document.querySelector('#pdf-search-word') &&
              document.querySelector('#pdf-search-case').getAttribute('aria-pressed') === 'false' &&
              document.querySelector('#pdf-search-word').getAttribute('aria-pressed') === 'false',
            issuesCenterPresent: !!document.querySelector('#btn-issues') && !!document.querySelector('#issues-menu') &&
              !!document.querySelector('#issues-list'),
            onboardPresent: !!document.querySelector('#onboard-steps') && !!document.querySelector('#onboard-import') &&
              !!document.querySelector('#onboard-skip') && !!document.querySelector('#onboard-short'),
            pdfNavigationUiPresent: !!document.querySelector('#pdf-page-number') && !!document.querySelector('#pdf-search') &&
              !!document.querySelector('#pdf-fit-width') && !!document.querySelector('#pdf-rotate'),
            paginationPresent: !!document.querySelector('#table-pagination'),
            sqliteStorageReady: !!window.litboardSqliteReady,
            trashNavPresent: !!document.querySelector('[data-folder="trash"]'),
            smartFolderUiAbsent: !document.querySelector('#saved-search-list') && !document.querySelector('#btn-save-search'),
            tagManagePresent: !!document.querySelector('#btn-manage-tags') && !!document.querySelector('#tags-mask'),
            cslUiPresent: !!document.querySelector('#cite-csl-style') && !!window.LitCsl,
            syncIndicatorPresent: !!document.querySelector('#sync-indicator'),
            bridgeUiPresent: !!document.querySelector('#sync-bridge-enabled'),
            pdfReaderExtrasPresent: !!document.querySelector('#pdf-tabs') && !!document.querySelector('#pdf-side') &&
              !!document.querySelector('#pdf-ocr-banner') && !!document.querySelector('#rail-translation') &&
              !!document.querySelector('#rail-anno') && !document.querySelector('#pdf-reflow-toggle') &&
              !document.querySelector('#pdf-snapshot-toggle') && !document.querySelector('#pdf-ink-toggle') &&
              !document.querySelector('#pdf-write-back') && !document.querySelector('#pdf-tts') &&
              !document.querySelector('#pdf-translation-settings') && !document.querySelector('#pdf-annotations-toggle'),
            pdfSideControlsWork: (function () {
              const side = document.querySelector('#pdf-side');
              const toggle = document.querySelector('#pdf-side-toggle');
              const collapse = document.querySelector('#pdf-side-collapse');
              const open = document.querySelector('#pdf-side-open');
              const grip = document.querySelector('#pdf-side-resizer');
              const thumbs = document.querySelector('#pdf-side-tab-thumbs');
              const outline = document.querySelector('#pdf-side-tab-outline');
              if (!side || !toggle || !collapse || !open || !grip || !thumbs || !outline) return false;
              if (side.hidden) open.click();
              outline.click();
              const outlineShown = !document.querySelector('#pdf-outline').hidden && document.querySelector('#pdf-thumbs').hidden;
              thumbs.click();
              const thumbsShown = !document.querySelector('#pdf-thumbs').hidden && document.querySelector('#pdf-outline').hidden;
              collapse.click();
              const collapsed = side.hidden && !open.hidden && grip.hidden && toggle.getAttribute('aria-pressed') === 'false';
              open.click();
              return outlineShown && thumbsShown && collapsed && !side.hidden && open.hidden && !grip.hidden;
            })(),
            pdfTopTabsPresent: !!document.querySelector('#pdf-tabs .pdf-tab .pdf-tab-title') &&
              Array.prototype.some.call(document.querySelectorAll('#pdf-tabs .pdf-tab-title'), function (el) {
                return el.textContent.indexOf('文献库') !== -1;
              }),
            title: document.title,
            titlebarControlsPresent: !!document.querySelector('#win-min') &&
              !!document.querySelector('#win-max') && !!document.querySelector('#win-close'),
            dialogUiPresent: !!document.querySelector('#dlg-mask') && !!document.querySelector('#dlg-ok') &&
              !!document.querySelector('#dlg-cancel') && !!document.querySelector('#dlg-input') &&
              !!document.querySelector('#dlg-list'),
            zoteroWizardPresent: !!document.querySelector('#zotero-import-mask') &&
              !!document.querySelector('#zotero-wiz-dir') && !!document.querySelector('#zotero-wiz-next'),
            docxExportPresent: !!document.querySelector('#btn-export-docx'),
            readerNotePanelPresent: !!document.querySelector('#pdf-note-editor') &&
              !!document.querySelector('#pdf-note-select') && !!document.querySelector('#pdf-annotations-to-note') &&
              !!document.querySelector('#excerpt-mask'),
            epubReaderPresent: !!document.querySelector('#epub-overlay') &&
              !!document.querySelector('#epub-view') && !!document.querySelector('#epub-toc') &&
              !!document.querySelector('#epub-annotation-list') && !!document.querySelector('#epub-note-editor') &&
              !!document.querySelector('#epub-sel-popover'),
            noteEditorPresent: !!document.querySelector('#note-edit-mask') &&
              !!document.querySelector('#note-edit-area') && !!document.querySelector('#note-edit-save') &&
              !!document.querySelector('#note-edit-status'),
            resultViewPresent: !!document.querySelector('#result-view') &&
              !!document.querySelector('#entity-hits') && !!document.querySelector('#library-count-recent'),
            wordSectionPresent: !!document.querySelector('#word-detect') &&
              !!document.querySelector('#word-refresh') && !!document.querySelector('#word-convert-zotero'),
            // Word 写作与浏览器扩展面板已从设置里搬出：顶栏要有直达按钮，弹窗壳要存在，
            // 且它们不再挂在设置弹窗的分组里
            integrationPanelsPresent: !!document.querySelector('#btn-word') && !!document.querySelector('#word-panel-mask') &&
              !!document.querySelector('#btn-bridge') && !!document.querySelector('#bridge-panel-mask') &&
              !document.querySelector('#word-panel-mask').closest('#sync-mask') &&
              !document.querySelector('#bridge-panel-mask').closest('#sync-mask'),
            queryBuilderPresent: !!document.querySelector('#query-builder-mask') &&
              !!document.querySelector('#qb-rows') && !!document.querySelector('#qb-apply') &&
              document.querySelector('#btn-query-builder use')?.getAttribute('href') === '#lb-i-query-builder' &&
              document.querySelector('#btn-query-builder')?.textContent.trim() === '条件检索',
            // 检索引擎脚本本体必须已加载：index.html 曾漏掉 js/query.js 的 script 标签，
            // 导致 field:value / missing: 等 AST 查询语法静默退化为子串搜索
            queryEnginePresent: typeof window.LitQuery === 'object' && !!window.LitQuery &&
              typeof window.LitQuery.parseAst === 'function' && typeof window.LitQuery.compile === 'function',
            bulkEditPresent: !!document.querySelector('#bulk-edit-mask') &&
              !!document.querySelector('#bulk-edit-field') && !!document.querySelector('#bulk-edit-confirm'),
            undoPresent: !!document.querySelector('#btn-undo') && !!document.querySelector('#btn-redo')
          };
          document.querySelector('#btn-new-folder').click();
          result.folderCreateOpens = !document.querySelector('#folder-create-form').hidden;
          document.querySelector('#folder-create-cancel').click();
          // 内置视图右键菜单（全部文献/未分类/最近阅读/回收站）：集合级操作与文件夹菜单对齐，
          // 回收站换成「恢复全部 / 清空回收站」；菜单必须在点击后关闭（不留残影）
          result.libraryNavContextMenu = await (async function () {
            const nav = (id) => document.querySelector('#library-nav [data-folder="' + id + '"]');
            const openMenu = (id) => {
              nav(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 150 }));
              const el = document.querySelector('#ctx-menu');
              const text = el ? el.textContent : '';
              document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              return { text: text, closed: !document.querySelector('#ctx-menu') };
            };
            const all = openMenu('all');
            const recent = openMenu('recent');
            const trash = openMenu('trash');
            nav('all').click();
            return all.closed && recent.closed && trash.closed &&
              all.text.indexOf('导出 BibTeX') !== -1 && all.text.indexOf('构建引文网络') !== -1 &&
              all.text.indexOf('清空回收站') === -1 &&
              recent.text.indexOf('导出 PDF') !== -1 &&
              trash.text.indexOf('恢复全部') !== -1 && trash.text.indexOf('清空回收站') !== -1;
          })();
          result.folderCrudAndDragWorks = await (async function () {
            const query = (s) => document.querySelector(s);
            const waitFor = async (check) => {
              for (let i = 0; i < 60; i++) {
                if (await check()) return true;
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              return false;
            };
            const ids = [];
            result.folderCrudStep = 'create';
            for (const name of ['smoke-folder-A', 'smoke-folder-B', 'smoke-folder-C']) {
              query('#btn-new-folder').click();
              query('#folder-name-input').value = name;
              query('#folder-create-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              const row = Array.from(document.querySelectorAll('#folder-list .folder-item')).find(el => el.querySelector('.folder-item-label').textContent === name);
              if (!row) return false;
              ids.push(row.dataset.folder);
            }
            const row = id => query('#folder-list .folder-item[data-folder="' + id + '"]');
            row(ids[0]).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 120 }));
            result.folderImportContextAction = !!query('#ctx-menu') &&
              query('#ctx-menu').textContent.indexOf('在此导入文件夹') !== -1;
            document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const click = (id, opts) => row(id).querySelector('.folder-select').dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true }, opts)));
            const selected = () => ids.filter(id => row(id).getAttribute('aria-selected') === 'true');
            click(ids[0]); click(ids[1], { ctrlKey: true });
            result.folderCrudStep = 'ctrl-select';
            if (selected().length !== 2) return false;
            click(ids[0]); click(ids[2], { shiftKey: true });
            result.folderCrudStep = 'shift-select';
            if (selected().length !== 3) return false;
            const drag = (from, to, ratio) => {
              click(from);
              const transfer = new DataTransfer();
              row(from).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
              const target = to ? row(to) : query('#library-nav [data-folder="all"]');
              const rect = target.getBoundingClientRect();
              const opts = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 20, clientY: rect.top + rect.height * ratio };
              target.dispatchEvent(new DragEvent('dragover', opts));
              target.dispatchEvent(new DragEvent('drop', opts));
              query('#folder-list').dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
            };
            const persisted = async (id, parent) => {
              const data = await window.litboardDesktop.loadLibrary();
              return data.folders.some(f => f.id === id && !f.deletedAt && (f.parentId || '') === parent);
            };
            drag(ids[1], ids[0], 0.5);
            result.folderCrudStep = 'drag-inside';
            if (!await waitFor(() => persisted(ids[1], ids[0]))) return false;
            drag(ids[1], null, 0.9);
            result.folderCrudStep = 'drag-root';
            if (!await waitFor(() => persisted(ids[1], ''))) return false;
            drag(ids[2], ids[0], 0.05);
            result.folderCrudStep = 'drag-sort';
            if (!await waitFor(async () => {
              const data = await window.litboardDesktop.loadLibrary();
              const a = data.folders.find(f => f.id === ids[0]);
              const c = data.folders.find(f => f.id === ids[2]);
              return a && c && c.sortIndex < a.sortIndex;
            })) return false;
            drag(ids[2], ids[0], 0.5);
            result.folderCrudStep = 'drag-child';
            if (!await waitFor(() => persisted(ids[2], ids[0]))) return false;
            drag(ids[1], ids[2], 0.5);
            result.folderCrudStep = 'drag-grandchild';
            if (!await waitFor(() => persisted(ids[1], ids[2]))) return false;
            for (const id of ids) {
              result.folderCrudStep = 'delete';
              if (!row(id)) continue; // 删除父集合必须一并删除两层子集合。
              row(id).querySelector('.folder-delete').click();
              query('#dlg-ok').click();
              if (!await waitFor(() => !row(id))) return false;
              if (id === ids[0] && (row(ids[1]) || row(ids[2]))) return false;
            }
            if (!await waitFor(async () => {
              const data = await window.litboardDesktop.loadLibrary();
              return ids.every(id => data.folders.some(f => f.id === id && f.deletedAt));
            })) return false;
            query('#btn-undo').click();
            result.folderCrudStep = 'undo';
            if (!await waitFor(async () => {
              const data = await window.litboardDesktop.loadLibrary();
              const a = data.folders.find(f => f.id === ids[0] && !f.deletedAt);
              const c = data.folders.find(f => f.id === ids[2] && !f.deletedAt);
              const b = data.folders.find(f => f.id === ids[1] && !f.deletedAt);
              return a && c && b && c.parentId === a.id && b.parentId === c.id;
            })) return false;
            query('#btn-redo').click();
            result.folderCrudStep = 'redo';
            return waitFor(async () => {
              const data = await window.litboardDesktop.loadLibrary();
              return ids.every(id => data.folders.some(f => f.id === id && f.deletedAt));
            });
          })();
          // 拖入文件夹导入落区行为：合成 dragover（DataTransfer 带 Files 类型）应点亮列表空白
          // （根级导入）与文件夹行（导入到该文件夹内，行悬停时列表空白高亮退位），dragleave 收起
          result.folderImportDropHighlight = await (async function () {
            try {
              const list = document.querySelector('#folder-list');
              if (!list) return false;
              const dt = new DataTransfer();
              dt.items.add(new File(['x'], 'x.pdf'));
              const evOver = function (target) {
                target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
              };
              evOver(list);
              const okList = list.classList.contains('folder-file-drop');
              const rootNav = document.querySelector('#library-nav [data-folder="all"]');
              evOver(rootNav);
              const okRoot = rootNav.classList.contains('folder-file-drop');
              const row = document.createElement('div');
              row.className = 'folder-item';
              row.dataset.folder = 'smoke-probe';
              list.appendChild(row);
              evOver(row);
              const okRow = row.classList.contains('folder-file-drop') && !list.classList.contains('folder-file-drop');
              list.dispatchEvent(new DragEvent('dragleave', {
                dataTransfer: dt, bubbles: true, clientX: -1000, clientY: -1000
              }));
              const okClear = !list.classList.contains('folder-file-drop') && !row.classList.contains('folder-file-drop');
              row.remove();
              return okList && okRoot && okRow && okClear;
            } catch (error) { return false; }
          })();
          // 弹窗栈：嵌套打开时后开者必须盖住先开者（设置 → Zotero 导入向导），与 DOM 顺序无关
          const zIndexOf = function (el) { return Number(getComputedStyle(el).zIndex) || 0; };
          const settle = function () { return new Promise(function (resolve) { requestAnimationFrame(resolve); }); };
          // 检索语法速查：? 按钮能开浮层（常用层 + 折叠的高级层），示例点选即填入搜索框
          document.querySelector('#btn-search-help').click();
          await settle();
          const helpPop = document.querySelector('#search-help-pop');
          result.searchHelpOpens = !!helpPop && !helpPop.hidden &&
            helpPop.textContent.indexOf('常用') !== -1 &&
            helpPop.textContent.indexOf('高级语法') !== -1 &&
            helpPop.querySelectorAll('.search-help-try').length >= 15;
          result.searchHelpDiag = {
            hidden: helpPop ? helpPop.hidden : 'missing',
            tries: helpPop ? helpPop.querySelectorAll('.search-help-try').length : -1,
            hasCommon: helpPop ? helpPop.textContent.indexOf('常用') !== -1 : false,
            hasAdv: helpPop ? helpPop.textContent.indexOf('高级语法') !== -1 : false
          };
          helpPop.querySelector('.search-help-try').click();
          await settle();
          result.searchHelpTryWorks = document.querySelector('#search-help-pop').hidden &&
            document.querySelector('#search').value.length > 0;
          document.querySelector('#search').value = '';
          document.querySelector('#search').dispatchEvent(new Event('input', { bubbles: true }));
          // 「插入引文」的检索框共用同一个速查浮层：示例要写回弹窗自己的输入框，不是主搜索框。
          // 直接显示弹窗（不经顶栏按钮——那条路要求真机装着 Word 且开着文档）。
          const wordCiteMask = document.querySelector('#word-cite-mask');
          const wordCiteInput = document.querySelector('#word-cite-search');
          wordCiteMask.hidden = false;
          await settle();
          document.querySelector('#btn-word-cite-help').click();
          await settle();
          result.wordCiteHelpOpens = !document.querySelector('#search-help-pop').hidden;
          document.querySelector('#search-help-pop').querySelector('.search-help-try').click();
          await settle();
          result.wordCiteHelpTryWorks = document.querySelector('#search-help-pop').hidden &&
            wordCiteInput.value.length > 0 &&
            document.querySelector('#search').value === '';
          // 语法走 js/query.js：写错的语法挂出提示（与主检索框同一条反馈），写对了收回
          wordCiteInput.value = '(';
          wordCiteInput.dispatchEvent(new Event('input', { bubbles: true }));
          await settle();
          result.wordCiteSyntaxHintWorks = !document.querySelector('#word-cite-hint').hidden;
          wordCiteInput.value = 'tag:综述';
          wordCiteInput.dispatchEvent(new Event('input', { bubbles: true }));
          await settle();
          result.wordCiteSyntaxHintClears = document.querySelector('#word-cite-hint').hidden;
          wordCiteInput.value = '';
          wordCiteInput.dispatchEvent(new Event('input', { bubbles: true }));
          wordCiteMask.hidden = true;
          await settle();
          document.querySelector('#btn-sync').click();
          await settle();
          const settingsMask = document.querySelector('#sync-mask');
          // 设置框拖右下角手柄改尺寸：拖小 → 拖大（撞视口上限即钳制）→ 双击复位回默认
          const settingsModal = settingsMask.querySelector('.sync-modal');
          const grip = document.querySelector('#sync-resize-grip');
          // 弹窗有 .18s 入场动画（transform: scale(.98)）；隐藏窗口里合成器出帧时机不定，
          // 量基准尺寸前必须等动画真的结束，否则基准是缩放中间态（745×764 而不是 760×780）
          for (let i = 0; i < 40 && getComputedStyle(settingsModal).transform !== 'none'; i++) {
            await new Promise(function (resolve) { setTimeout(resolve, 50); });
          }
          const modalRect = settingsModal.getBoundingClientRect();
          result.settingsResizeUiPresent = !!grip &&
            getComputedStyle(settingsModal).position === 'relative' &&
            getComputedStyle(grip).cursor === 'nwse-resize';
          if (grip) {
            // 弹窗由遮罩居中，尺寸 = 指针到中心的距离 ×2；合成 PointerEvent 走同一条链路
            const cx = modalRect.left + modalRect.width / 2;
            const cy = modalRect.top + modalRect.height / 2;
            const pointer = function (type, x, y) {
              grip.dispatchEvent(new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y
              }));
            };
            pointer('pointerdown', cx + modalRect.width / 2, cy + modalRect.height / 2);
            pointer('pointermove', cx + 300, cy + 180);
            pointer('pointerup', cx + 300, cy + 180);
            await settle();
            const small = settingsModal.getBoundingClientRect();
            pointer('pointerdown', cx + small.width / 2, cy + small.height / 2);
            pointer('pointermove', cx + 900, cy + 450);
            pointer('pointerup', cx + 900, cy + 450);
            await settle();
            const big = settingsModal.getBoundingClientRect();
            result.settingsResizeDiag = {
              before: [Math.round(modalRect.width), Math.round(modalRect.height)],
              small: [Math.round(small.width), Math.round(small.height)],
              big: [Math.round(big.width), Math.round(big.height)],
              viewport: [window.innerWidth, window.innerHeight]
            };
            result.settingsResizes = small.width < modalRect.width - 100 && small.height < modalRect.height - 100 &&
              big.width > small.width + 100 && big.height > small.height + 100;
            grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            await settle();
            const reset = settingsModal.getBoundingClientRect();
            result.settingsResizeDiag.reset = [Math.round(reset.width), Math.round(reset.height)];
            result.settingsResizeResets = !settingsModal.style.width &&
              Math.abs(reset.width - modalRect.width) < 1 && Math.abs(reset.height - modalRect.height) < 1;
          }
          document.querySelector('#sync-import-zotero').click();
          await settle();
          const wizardMask = document.querySelector('#zotero-import-mask');
          const nestedVisibleStacked = !settingsMask.hidden && !wizardMask.hidden &&
            zIndexOf(wizardMask) > zIndexOf(settingsMask) && zIndexOf(settingsMask) > 0;
          document.querySelector('#zotero-wiz-cancel').click();
          await settle();
          // 关掉向导后设置框重新成为最上层
          const parentRestored = !settingsMask.hidden && zIndexOf(settingsMask) > 0 && zIndexOf(wizardMask) === 210;
          document.querySelector('#sync-close').click();
          await settle();
          // 全部关闭后内联 z-index 复位回 css 默认，不留长期覆盖
          result.nestedModalStacking = nestedVisibleStacked && parentRestored &&
            zIndexOf(wizardMask) === 210 && zIndexOf(settingsMask) === 210;
          // AI 助手「服务商 + 模型」编辑器（设置 → 集成与服务）：加一个服务商 → 加一个模型 →
          // 自动保存落盘 → 底部模型菜单能列出它（配置读写与切换入口的完整链路）
          document.querySelector('#btn-sync').click();
          await settle();
          document.querySelector('#sync-nav .sync-nav-btn[data-sync-group="integrations"]').click();
          await settle();
          const providerRows = function () { return document.querySelectorAll('#agent-provider-items .agent-provider-row'); };
          const providersBefore = providerRows().length;
          document.querySelector('#agent-provider-add').click();
          await settle();
          const providerRowAdded = providerRows().length === providersBefore + 1;
          const pName = document.querySelector('#agent-p-name');
          pName.value = 'Smoke Provider';
          pName.dispatchEvent(new Event('input', { bubbles: true }));
          const pBase = document.querySelector('#agent-p-base-url');
          pBase.value = 'https://api.deepseek.com/anthropic';
          pBase.dispatchEvent(new Event('change', { bubbles: true }));
          const pModel = document.querySelector('#agent-p-model-input');
          pModel.value = 'deepseek-smoke';
          document.querySelector('#agent-p-model-add').click();
          await settle();
           const modelRowAdded = document.querySelectorAll('#agent-p-models .agent-model-row').length === 1 &&
             document.querySelector('#agent-p-models .agent-model-row').className.indexOf('active') !== -1 &&
             document.querySelector('#agent-p-dialect-hint').textContent.indexOf('api.deepseek.com/anthropic/v1/messages') !== -1;
          const providerDetailRect = document.querySelector('#agent-provider-detail').getBoundingClientRect();
          const modelBlockRect = document.querySelector('.agent-model-block').getBoundingClientRect();
          result.agentProviderWideLayout = Math.abs(modelBlockRect.left - providerDetailRect.left) <= 1 &&
            Math.abs(modelBlockRect.width - providerDetailRect.width) <= 1;
          result.embeddingZhipuPresetPresent = !!document.querySelector('#sync-embed-provider option[value="zhipu"]');
          // 内联状态框在纵向 flex 容器（服务商详情的 .agent-model-block）里必须是内容高度：
          // 曾因全局 flex:1 1 240px 变成「高 240px 且继续撑满」，一行提示占掉大半个面板
          const inlineStatus = document.querySelector('#agent-p-status');
          inlineStatus.textContent = '✓ 拉取到 33 个模型，其中 25 个已加入清单';
          inlineStatus.className = 'sync-inline-status success';
          await settle();
          const inlineStatusRect = inlineStatus.getBoundingClientRect();
          result.inlineStatusCompact = inlineStatusRect.height > 0 && inlineStatusRect.height <= 60 &&
            inlineStatusRect.width > 200;
          result.inlineStatusDiag = {
            height: Math.round(inlineStatusRect.height),
            width: Math.round(inlineStatusRect.width),
            flex: getComputedStyle(inlineStatus).flex
          };
          inlineStatus.textContent = '';
          inlineStatus.className = 'sync-inline-status';
          document.querySelector('#sync-close').click();
          await settle();
          // 自动保存是 600ms 防抖：等它落盘再核对配置文件（凭据按 id 合并、扁平镜像随选中项）
          await new Promise(function (resolve) { setTimeout(resolve, 900); });
          const savedAgentCfg = await window.litboardDesktop.getIntegrationConfig();
          const savedProviders = savedAgentCfg.agentProviders || [];
          const smokeProvider = savedProviders.filter(function (p) { return p.name === 'Smoke Provider'; })[0];
          result.agentProviderEditorWorks = providerRowAdded && modelRowAdded &&
            !!smokeProvider && smokeProvider.models.length === 1 &&
            smokeProvider.activeModel === 'deepseek-smoke' &&
            smokeProvider.baseUrl === 'https://api.deepseek.com/anthropic' &&
            savedAgentCfg.agentActiveProviderId === smokeProvider.id &&
            savedAgentCfg.agentBaseUrl === 'https://api.deepseek.com/anthropic' &&
            savedAgentCfg.agentModel === 'deepseek-smoke';
          // 「立即同步」在未配置坚果云时必须是可见的失败提示，而不是未捕获的 promise rejection
          // （曾如此：控制台报错，界面上却停在「配置已保存」，看着像点了没反应）
          const syncRejections = [];
          const syncRejectionHook = function (e) {
            syncRejections.push(String(e && e.reason && (e.reason.message || e.reason) || 'unknown'));
          };
          window.addEventListener('unhandledrejection', syncRejectionHook);
          document.querySelector('#btn-sync').click();
          await settle();
          document.querySelector('#sync-nav .sync-nav-btn[data-sync-group="cloud"]').click();
          await settle();
          document.querySelector('#sync-run').click();
          await settle();
          await new Promise(function (resolve) { setTimeout(resolve, 800); });
          const syncRunStatus = document.querySelector('#sync-status');
          result.syncRunUnconfiguredGuarded = syncRunStatus.textContent.indexOf('请先配置坚果云') !== -1 &&
            syncRunStatus.classList.contains('error') && syncRejections.length === 0;
          result.syncRunUnconfiguredDiag = {
            status: syncRunStatus.textContent,
            errorClass: syncRunStatus.classList.contains('error'),
            rejections: syncRejections
          };
          window.removeEventListener('unhandledrejection', syncRejectionHook);
          document.querySelector('#sync-close').click();
          await settle();
          for (let i = 0; i < 600 && !window.litboardReadyAt; i++) {
            await new Promise(function (resolve) { requestAnimationFrame(resolve); });
          }
          // M4 分段计时：库加载 / 全量保存（毫秒；与功能断言同轮收集，作为基准数据源）
          const perfLoadT0 = performance.now();
          const smokeWorkspace = await window.litboardDesktop.loadLibrary();
          result.loadLibraryMs = Math.round(performance.now() - perfLoadT0);
          const perfSaveT0 = performance.now();
          const saveStats = await window.litboardDesktop.saveLibrary(smokeWorkspace);
          result.saveLibraryMs = Math.round(performance.now() - perfSaveT0);
          result.saveLibraryWorks = !!saveStats && typeof saveStats.papersWritten === 'number';
          const dataPaths = await window.litboardDesktop.getDataPaths();
          const unchangedPaths = await window.litboardDesktop.stageDataPaths({
            configDir: dataPaths.configDir,
            libraryDir: dataPaths.libraryDir
          });
          result.dataPathApiWorks = !!dataPaths.configDir && !!dataPaths.libraryDir &&
            unchangedPaths.changed === false && unchangedPaths.restartRequired === false;
          const cslFiles = await Promise.all([
            fetch('vendor/citeproc/styles/apa.csl').then(function (response) {
              if (!response.ok) throw new Error('CSL style load failed');
              return response.text();
            }),
            fetch('vendor/citeproc/locales/en-US.xml').then(function (response) {
              if (!response.ok) throw new Error('CSL locale load failed');
              return response.text();
            })
          ]);
          const cslOutput = await window.LitCsl.renderBibliography([
            { id: 'smoke-csl', entryType: 'article', title: 'Smoke CSL Citation', authors: ['Test Author'], year: 2026 }
          ], cslFiles[0], cslFiles[1]);
          result.cslVendorRender = Array.isArray(cslOutput) && /Smoke CSL Citation/.test(cslOutput[0] || '');
          result.libraryLoadMs = Math.round(window.litboardReadyAt || performance.now());
          result.renderedRows = document.querySelectorAll('#table-body tr').length;
          result.domNodes = document.getElementsByTagName('*').length;
          const nextPage = document.querySelector('#table-page-next');
          const pageInfo = document.querySelector('#table-page-info');
          const initialPage = pageInfo.textContent;
          if (nextPage && !nextPage.disabled) {
            nextPage.click();
            await new Promise(function (resolve) { requestAnimationFrame(resolve); });
          }
          result.paginationWorks = !!nextPage && (nextPage.disabled || (pageInfo.textContent !== initialPage && document.querySelectorAll('#table-body tr').length > 0));
          if (pdfPath) {
            result.workerSrc = 'mupdf-worker';
            const container = document.createElement('div');
            if (shotWanted) {
              // pointer-events:none：这层只给截图用，不参与命中测试，免得挡住 elementFromPoint 探针
              container.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#777;overflow:auto;padding:24px;pointer-events:none;';
              document.body.appendChild(container);
              window.__smokeShotContainer = container;
            }
            const handle = window.LitPdf.renderPdf(pdfPath, container, {
              scale: ${JSON.stringify(SMOKE_SCALE)},
              textLayer: true,
              annotations: [{ id: 'smokeannotation', type: 'highlight', color: '#ffd400', text: 'test', comment: '',
                position: { pageIndex: 0, rects: [[10, 10, 60, 25]] }, createdAt: 1, updatedAt: 1 }]
            });
            try {
              const doc = await handle.promise;
              const canvas = container.querySelector('canvas');
              result.pdfRender = {
                pages: doc && doc.numPages,
                canvases: container.querySelectorAll('canvas').length,
                pixelRatio: canvas ? Number(canvas.dataset.pixelRatio) : 0,
                // 1:1 物理像素不变量：位图边长 = CSS 尺寸 × dpr（±1px 取整误差）
                // 默认冒烟容器未挂 DOM，getBoundingClientRect().width 会是 0；读取实际设置的 CSS 宽度。
                dprAligned: canvas ? Math.abs(canvas.width - Math.round(parseFloat(canvas.style.width) * (Number(window.devicePixelRatio) || 1))) <= 1 : false,
                renderer: canvas ? canvas.dataset.renderer || 'mupdf' : '',
                opaqueCanvas: canvas ? canvas.getContext('2d').getContextAttributes().alpha === false : false,
                renderingProfile: { engine: window.LitPdf.engine },
                textLayer: !!container.querySelector('.pdf-text-layer'),
                annotationLayer: !!container.querySelector('.pdf-annotation-mark')
              };
              const outline = await doc.getOutline();
              const thumbPage = await doc.getPage(1);
              const thumbCanvas = document.createElement('canvas');
              await thumbPage.renderToCanvas(thumbCanvas, 0.2, 0);
              result.pdfRender.outlineReadable = Array.isArray(outline);
              result.pdfRender.thumbnailRendered = thumbCanvas.width > 0 && thumbCanvas.height > 0;
              result.pdfRender.pageError = (container.querySelector('.pdf-page-sheet') || {}).dataset
                ? (container.querySelector('.pdf-page-sheet').dataset.renderError || '') : '';
              // relayout（缩放原位重排）：复用文档、旧 canvas 原子替换，数量不增不减
              const firstPageCanvas = container.querySelector('canvas.pdf-page');
              const widthBefore = firstPageCanvas ? firstPageCanvas.width : 0;
              const relaidOut = handle.relayout ? handle.relayout({ scale: ${JSON.stringify(SMOKE_SCALE)} + 0.3 }) : false;
              let relayoutOk = false;
              if (relaidOut) {
                await handle.goToPage(1); // 触发第 1 页按新缩放重绘
                const reCanvas = container.querySelector('canvas.pdf-page');
                relayoutOk = !!reCanvas && container.querySelectorAll('canvas.pdf-page').length === 1 &&
                  reCanvas.width > widthBefore && reCanvas.dataset.renderer === ${JSON.stringify(SMOKE_EXPECT_RENDERER)};
              }
              result.pdfRender.relayout = relaidOut;
              result.pdfRender.relayoutOk = relayoutOk;
              // 模拟把窗口从低 DPI 屏幕移到高 DPI 屏幕：现有文档原位重绘位图。
              const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
              const originalDpr = Number(window.devicePixelRatio) || 1;
              try {
                Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: Math.max(2, originalDpr + 1) });
                const beforeDprCanvas = container.querySelector('canvas.pdf-page');
                window.dispatchEvent(new Event('resize'));
                await handle.goToPage(1);
                const afterDprCanvas = container.querySelector('canvas.pdf-page');
                result.pdfRender.dprRefresh = !!afterDprCanvas && afterDprCanvas !== beforeDprCanvas &&
                  Math.abs(Number(afterDprCanvas.dataset.pixelRatio) - window.LitPdf.renderPixelRatio(
                    afterDprCanvas.parentElement._litViewport, window.devicePixelRatio)) < 0.02;
              } finally {
                if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
                else delete window.devicePixelRatio;
                window.dispatchEvent(new Event('resize'));
              }
              result.pdfResourceRequests = pdfResourceRequests;
              const writeBytes = await window.litboardDesktop.readFileBytes(pdfPath);
              const writeResult = await window.LitPdf.writeAnnotations(new Uint8Array(writeBytes), [{
                id: 'smoke-mupdf-annotation', type: 'highlight', color: '#ffd400', text: 'test', comment: 'smoke',
                position: { pageIndex: 0, rects: [[20, 20, 100, 40]] }, createdAt: 1, updatedAt: 1
              }]);
              const readBack = await window.LitPdf.readAnnotations(null, new Uint8Array(writeResult.bytes));
              result.pdfWrite = { written: writeResult.written, found: readBack.some(function (item) { return item.id === 'smoke-mupdf-annotation'; }) };
            } catch (error) {
              result.pdfRender = { error: String(error && error.message || error) };
            }
          } else {
            await new Promise(function (resolve) { setTimeout(resolve, 300); });
          }
          // EPUB 阅读链（foliate-js）：打开 → 翻页 → 进度 → 批注高亮 → 恢复阅读位置
          result.epubEnginePresent = !!window.LitFoliate && !!window.LitEpub;
          if (epubPath && result.epubEnginePresent) {
            const epubHost = document.createElement('div');
            epubHost.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:800px;';
            document.body.appendChild(epubHost);
            try {
              const epubBytes = await window.litboardDesktop.readFileBytes(epubPath);
              let relocated = 0;
              let lastCfi = '';
              const epubApi = window.LitEpub.openEpub(epubBytes, {
                container: epubHost,
                onRelocated: function (cfi) { relocated++; lastCfi = cfi; }
              });
              await epubApi.display();
              const tocList = await epubApi.toc();
              await epubApi.next();
              await new Promise(function (resolve) { setTimeout(resolve, 300); });
              const progAfterNext = epubApi.progress();
              const visibleAfterNext = epubApi.visibleText();
              // 批注高亮：add 后 overlayer 应有 SVG 绘制内容
              if (lastCfi) epubApi.rendition.annotations.add('highlight', lastCfi, { id: 'smoke-epub-ann' }, null, 'lb-epub-ann', { fill: '#ffd400' });
              await new Promise(function (resolve) { setTimeout(resolve, 400); });
              let overlayDrawings = 0;
              try {
                const fv = epubHost.querySelector('foliate-view');
                const c = fv && fv.renderer && fv.renderer.getContents ? fv.renderer.getContents() : [];
                const ol = c.find(function (x) { return x.overlayer; });
                overlayDrawings = ol ? ol.overlayer.element.childElementCount : 0;
              } catch (e) {}
              // 恢复阅读位置（goTo 上一处 cfi）
              const gone = lastCfi ? await epubApi.goTo(lastCfi) : null;

              await new Promise(function (resolve) { setTimeout(resolve, 300); });
              result.epubReader = {
                relocations: relocated,
                hasCfi: !!lastCfi,
                tocItems: tocList.length,
                progressPercent: progAfterNext ? Math.round(progAfterNext.percent) : null,
                visibleTextPreview: (visibleAfterNext || '').slice(0, 24),
                overlayDrawings: overlayDrawings,
                goToResolved: !!gone
              };
              epubApi.destroy();
            } catch (error) {
              result.epubReader = { error: String(error && error.message || error) };
            } finally {
              if (epubHost.parentNode) epubHost.parentNode.removeChild(epubHost);
            }
          }
          // 顶栏「设置」必须挂在明面上：语言切换在 设置 → 偏好，而设置本身此前只藏在「···」溢出菜单里，
          // 等于双语界面根本没有可见入口（同 Word/扩展面板当年被投诉「看不到」的坑）
          const settingsBtn = document.querySelector('#btn-sync');
          const settingsRect = settingsBtn && settingsBtn.getBoundingClientRect();
          result.settingsEntryInTopbar = !!settingsBtn && !settingsBtn.hidden &&
            settingsBtn.closest('.menu') === null && !!settingsBtn.closest('.topbar') &&
            !!settingsRect && settingsRect.width > 0 && settingsRect.height > 0;
          // 阅读模式右栏可达且可拖宽：PDF 层打开时轨栏/侧栏浮到遮罩上，把手贴住侧栏左缘，
          // PDF 让位宽度 = 轨栏 + 侧栏实际渲染宽（CSS 的 vw 视觉钳制后也必须贴合，不留缝隙）
          const smokePdfOverlay = document.querySelector('#pdf-overlay');
          smokePdfOverlay.hidden = false;
          await new Promise(function (resolve) { setTimeout(resolve, 80); });
          result.pdfReadingThemesWork = (function () {
            const btn = document.querySelector('#pdf-theme');
            const originalBtn = document.querySelector('#pdf-original-colors');
            if (!btn || !originalBtn || !window.LitTheme) return false;
            const saved = localStorage.getItem('litboard.pdfTheme');
            const raster = document.createElement('canvas');
            raster.className = 'pdf-page';
            const mark = document.createElement('i');
            mark.className = 'pdf-search-mark';
            smokePdfOverlay.append(raster, mark);
            let ok = true;
            try {
              for (const preset of window.LitTheme.PDF_THEMES) {
                btn.click();
                const menu = document.querySelector('#ctx-menu');
                const item = Array.from(menu.querySelectorAll('button')).find(function (el) {
                  return preset.name ? el.textContent.includes(preset.name) : el.textContent.includes('原始白纸');
                });
                if (!item) { ok = false; break; }
                const rect = menu.getBoundingClientRect();
                ok = ok && rect.bottom <= innerHeight + 1 && rect.top >= 0;
                item.click();
                ok = ok && smokePdfOverlay.getAttribute('data-reading-theme') === preset.id &&
                  document.querySelector('#pdf-tone-hue').getAttribute('values') === (preset.group === 'dark' ? '180' : '0') &&
                  localStorage.getItem('litboard.pdfTheme') === preset.id &&
                  (getComputedStyle(raster).filter !== 'none') === (preset.id !== 'original') &&
                  getComputedStyle(mark).mixBlendMode === (preset.group === 'dark' ? 'screen' : 'multiply');
              }
              originalBtn.click();
              ok = ok && originalBtn.getAttribute('aria-pressed') === 'true' && getComputedStyle(raster).filter === 'none';
              originalBtn.click();
              return ok && originalBtn.getAttribute('aria-pressed') === 'false' && getComputedStyle(raster).filter !== 'none';
            } finally {
              raster.remove(); mark.remove();
              const menu = document.querySelector('#ctx-menu');
              if (menu) menu.remove();
              const api = window.LitTheme.create({ T: function (s) { return s; }, $: function (s) { return document.querySelector(s); } });
              if (saved === null) localStorage.removeItem('litboard.pdfTheme');
              else localStorage.setItem('litboard.pdfTheme', saved);
              api.applyPdfTheme();
            }
          })();
          (function () {
            const wsEl = document.querySelector('.workspace');
            const rail = document.querySelector('.right-rail');
            const sidebar = document.querySelector('.detail-sidebar');
            const resizer = document.querySelector('#resizer-right');
            const railRect = rail.getBoundingClientRect();
            const sideRect = sidebar.getBoundingClientRect();
            const resizerRect = resizer.getBoundingClientRect();
            const giveW = parseFloat(document.body.style.getPropertyValue('--reading-rail-w')) || 0;
            const checks = {
              readingOn: document.body.classList.contains('reading-open') && !wsEl.classList.contains('rail-collapsed'),
              // 固定定位的参照是「布局视口」（不含经典滚动条）——用 clientWidth 而不是 innerWidth，
              // 否则文档一旦出现滚动条，innerWidth 多出滚动条宽度，这条断言会假红
              railFloats: getComputedStyle(rail).position === 'fixed' &&
                Math.abs(railRect.right - document.documentElement.clientWidth) < 1,
              sidebarFloats: getComputedStyle(sidebar).position === 'fixed' && sideRect.width > 40,
              handleFloats: getComputedStyle(resizer).position === 'fixed' && resizerRect.height > 0,
              handleAtSidebarEdge: Math.abs(resizerRect.left + resizerRect.width / 2 - sideRect.left) < 4,
              giveMatches: Math.abs(giveW - (railRect.width + sideRect.width)) < 3
            };
            checks.ok = checks.readingOn && checks.railFloats && checks.sidebarFloats &&
              checks.handleFloats && checks.handleAtSidebarEdge && checks.giveMatches;
            result.readingRail = checks;
          })();
          // 顶栏下拉：同时只允许一个展开，且阅读模式下展开的面板必须完整可见（不被浮层右栏裁掉）。
          // 回归背景：菜单按钮的 click 都 stopPropagation（否则 document 级 dismiss 会把刚展开的
          // 面板立刻关掉），于是「先开导出、再点通知」两个面板都留着——它们同在一个 .menu-wrap 内、
          // 都是 right:0 / top:100%，直接叠在一起；阅读模式下浮层侧栏 z-index 又高于顶栏，面板被裁一半。
          // 逐一点开每个下拉（前一个还开着，正是出问题的时序），检查：只开一个 + 菜单矩形内每点都命中自己。
          await (async function () {
            const toggles = Array.prototype.map.call(
              document.querySelectorAll('.topbar .menu-wrap > button'),
              function (button) { return { button: button, menu: button.nextElementSibling }; }
            ).filter(function (entry) { return !!entry.menu && entry.menu.classList.contains('menu'); });
            const rectOf = function (el) {
              const r = el.getBoundingClientRect();
              return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right),
                bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
            };
            const openCount = function () {
              return Array.prototype.filter.call(document.querySelectorAll('.topbar .menu'),
                function (m) { return !m.hidden; }).length;
            };
            document.querySelector('#btn-issues').hidden = false; // 无问题记录时通知中心按钮是 hidden
            const diag = { toggles: toggles.length, openCounts: [], covered: [], probeHits: [] };
            let exclusive = toggles.length >= 2;
            let onTop = true;
            for (const entry of toggles) {
              entry.button.click();
              await new Promise(function (resolve) { setTimeout(resolve, 40); });
              const count = openCount();
              diag.openCounts.push(count);
              if (count !== 1 || entry.menu.hidden) exclusive = false;
              const rect = rectOf(entry.menu);
              let miss = 0;
              for (let row = 1; row <= 3; row++) {
                const y = Math.round(rect.top + rect.height * row / 4);
                for (let col = 1; col <= 4; col++) {
                  const x = Math.round(rect.left + rect.width * col / 5);
                  const hit = document.elementFromPoint(x, y);
                  if (!hit || !(hit === entry.menu || entry.menu.contains(hit))) {
                    miss++;
                    diag.probeHits.push((entry.menu.id || 'menu') + ' ' + x + ',' + y + '=>' +
                      (hit ? (hit.id || String(hit.className).slice(0, 30) || hit.tagName) : 'null'));
                  }
                }
              }
              diag.covered.push(miss);
              if (miss) onTop = false;
            }
            diag.sidebarRect = rectOf(document.querySelector('.detail-sidebar'));
            diag.railRect = rectOf(document.querySelector('.right-rail'));
            diag.z = {
              topbar: getComputedStyle(document.querySelector('.topbar')).zIndex,
              sidebar: getComputedStyle(document.querySelector('.detail-sidebar')).zIndex,
              rail: getComputedStyle(document.querySelector('.right-rail')).zIndex
            };
            result.topbarMenuExclusive = exclusive;
            result.topbarMenuOnTop = onTop;
            result.topbarMenuDiag = diag;
            Array.prototype.forEach.call(document.querySelectorAll('.topbar .menu'), function (m) { m.hidden = true; });
            await new Promise(function (resolve) { setTimeout(resolve, 20); });
          })();
          smokePdfOverlay.hidden = true;
          await new Promise(function (resolve) { setTimeout(resolve, 80); });
          result.readingRail.restores = !document.body.classList.contains('reading-open');
          result.readingRailOk = result.readingRail.ok && result.readingRail.restores;
          // 右栏停在 AI 面板时点中间列表的条目 → 必须切回详情页；否则详情写进了隐藏面板，看着像「点了没反应」
          document.querySelector('#btn-agent').click();
          await settle();
          const agentPaneShown = !document.querySelector('#agent-drawer').hidden &&
            document.querySelector('#panel-detail').hidden;
          // 离线造一条数据（粘贴 BibTeX）：冒烟库初始为空，没有行就测不了「点行」
          document.querySelector('#btn-paste').click();
          document.querySelector('#paste-area').value =
            '@article{smokeRailPane1, title={Rail Pane Smoke Entry}, author={Doe, Jane}, year={2026}, journal={Smoke}}';
          document.querySelector('#paste-ok').click();
          await settle();
          document.querySelector('#import-folder-ok').click();
          for (let i = 0; i < 60 && !document.querySelector('#table-body tr.lit-row'); i++) await settle();
          const railSeedRow = document.querySelector('#table-body tr.lit-row');
          result.railSeedRow = !!railSeedRow;
          if (railSeedRow) {
            const titleCell = railSeedRow.querySelector('.t-title');
            result.compactTableRows = !!titleCell && getComputedStyle(titleCell).whiteSpace === 'nowrap' &&
              railSeedRow.getBoundingClientRect().height <= 36 &&
              railSeedRow.cells.length === document.querySelectorAll('#lit-table thead th').length;
            const pdfColumnWidth = document.querySelector('#lit-table th[data-column="attachment"]').getBoundingClientRect().width;
            const yearColumnWidth = document.querySelector('#lit-table th[data-column="year"]').getBoundingClientRect().width;
            result.tableNarrowColumnsKeepWidth = Math.abs(pdfColumnWidth - 38) < 2 && Math.abs(yearColumnWidth - 64) < 2;
            result.tableColumnWidthDiag = { viewport: innerWidth, pdf: pdfColumnWidth, year: yearColumnWidth };
            document.querySelector('#table-columns-btn').click();
            const tagsChoice = Array.from(document.querySelectorAll('#ctx-menu .menu-item'))
              .find(function (item) { return item.textContent.trim() === '标签'; });
            if (tagsChoice) tagsChoice.click();
            result.tableColumnPickerWorks = !!tagsChoice &&
              !document.querySelector('#lit-table th[data-column="tags"]').hidden &&
              !!document.querySelector('#table-body tr[data-id] td[data-column="tags"]');
            const titleGrip = document.querySelector('#lit-table th[data-column="title"] .column-resizer');
            const titleWidthBefore = titleGrip.parentElement.getBoundingClientRect().width;
            const widthBefore = JSON.parse(localStorage.getItem('litboard.tableColumns') || '{"title":{"width":260}}').title.width;
            titleGrip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200 }));
            document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 230 }));
            document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            result.tableColumnResizeWorks = JSON.parse(localStorage.getItem('litboard.tableColumns') || '{"title":{"width":0}}').title.width > widthBefore &&
              titleGrip.parentElement.getBoundingClientRect().width > titleWidthBefore;
            const sortedBeforeResizeClick = titleGrip.parentElement.classList.contains('sorted');
            titleGrip.parentElement.click(); // 浏览器可能把拖拽收尾 click 派给表头本身
            result.tableResizeDoesNotSort = titleGrip.parentElement.classList.contains('sorted') === sortedBeforeResizeClick;
            titleGrip.parentElement.click();
            result.tableHeaderStillSorts = titleGrip.parentElement.classList.contains('sorted') !== sortedBeforeResizeClick;
            const currentRailSeedRow = document.querySelector('#table-body tr.lit-row');
            (currentRailSeedRow.querySelector('td') || currentRailSeedRow).click();
            await settle();
            result.railPaneSwitchesToDetail = agentPaneShown &&
              document.querySelector('#agent-drawer').hidden &&
              !document.querySelector('#panel-detail').hidden &&
              !document.querySelector('#drawer').hidden &&
              // 切过去还得是「被点那一条」的详情，不能只是面板翻过来了
              String(document.querySelector('#d-title').textContent).indexOf('Rail Pane Smoke Entry') >= 0;
          } else {
            result.railPaneSwitchesToDetail = false;
          }
          // 阅读标签切换必须同步详情抽屉：先分别打开 A/B，再通过顶部标签回切。
          // 这只在传入真实 PDF 的 smoke 中运行，避免标准启动冒烟额外加载 PDF。
          result.pdfTabDetailFollowsActive = !pdfPath;
          result.multiAttachmentTabsWork = !secondPdfPath;
          if (pdfPath) {
            try {
              const smokePdfPath = String(pdfPath).split(String.fromCharCode(92)).join('/');
              const tabTitleA = 'Smoke PDF Tab A';
              const tabTitleB = 'Smoke PDF Tab B';
              document.querySelector('#btn-paste').click();
              document.querySelector('#paste-area').value =
                '@article{smokePdfTabA, title={' + tabTitleA + '}, author={Doe, Jane}, year={2026}, journal={Smoke}, file={' + smokePdfPath +
                  (secondPdfPath ? ';' + String(secondPdfPath).split(String.fromCharCode(92)).join('/') : '') + '}}' + String.fromCharCode(10) +
                '@article{smokePdfTabB, title={' + tabTitleB + '}, author={Doe, John}, year={2026}, journal={Smoke}, file={' + smokePdfPath + '}}';
              document.querySelector('#paste-ok').click();
              await settle();
              document.querySelector('#import-folder-ok').click();
              for (let i = 0; i < 60 && !Array.prototype.some.call(document.querySelectorAll('#table-body tr.lit-row'), function (row) {
                return row.textContent.indexOf(tabTitleB) !== -1;
              }); i++) await settle();
              const waitFor = async function (predicate) {
                for (let i = 0; i < 120; i++) {
                  if (predicate()) return true;
                  await new Promise(function (resolve) { setTimeout(resolve, 25); });
                }
                return false;
              };
              const selectAndOpen = async function (title) {
                const row = Array.prototype.find.call(document.querySelectorAll('#table-body tr.lit-row'), function (item) {
                  return item.textContent.indexOf(title) !== -1;
                });
                if (!row) return false;
                (row.querySelector('td') || row).click();
                await settle();
                const readButton = document.querySelector('#d-links [data-act="read-pdf"]');
                if (!readButton) return false;
                readButton.click();
                return waitFor(function () {
                  return !document.querySelector('#pdf-overlay').hidden &&
                    document.querySelector('#pdf-title').textContent.indexOf(title) !== -1;
                });
              };
              const firstOpened = await selectAndOpen(tabTitleA);
              // 划词翻译浮层必须收在阅读视图内：它 z-index 低于右栏浮层与顶栏，越界的部分会被压住
              // （真机截图里顶栏菜单就是这样被右栏裁掉的）。造一个真实选区触发它，再量四个边。
              result.selectionPopoverInsideReading = false;
              result.selectionPopoverDiag = 'skipped';
              if (firstOpened) {
                const scroll = document.querySelector('#pdf-scroll');
                // 先把页面放大几档：小页面上「最右的文本」离阅读区右缘还很远，浮层根本不会越界，
                // 断言就没有咬合力；放大到文本贴住右缘，不钳制时浮层必然伸到侧栏底下。
                for (let i = 0; i < 3; i++) {
                  document.querySelector('#pdf-zoom-in').click();
                  await new Promise(function (resolve) { setTimeout(resolve, 120); });
                }
                // 文本层是渲染完成后异步挂上的（缩放会重建）：span 要等 MuPDF 把整页
                // 结构文本走完才写进 DOM，大文档首屏能差出几百毫秒。必须等到层里真的有
                // span 再取样，否则量到的是刚建出来的空层，断言恒假。
                let layer = scroll && scroll.querySelector('.pdf-text-layer');
                for (let i = 0; i < 120 && !(layer && layer.querySelector('span')); i++) {
                  await new Promise(function (resolve) { setTimeout(resolve, 50); });
                  layer = scroll.querySelector('.pdf-text-layer');
                }
                const walker = layer ? document.createTreeWalker(layer, NodeFilter.SHOW_TEXT) : null;
                // 挑「最靠右的一行文本」并选它的尾部：只有选区贴着阅读区右缘，浮层才有越界风险
                // （不钳制时会伸到浮层侧栏底下 / 顶栏之上），断言才有咬合力
                let textNode = null;
                let bestRight = -Infinity;
                let node = walker ? walker.nextNode() : null;
                while (node) {
                  if (String(node.textContent || '').trim()) {
                    const probeRange = document.createRange();
                    probeRange.selectNodeContents(node);
                    const probeRect = probeRange.getBoundingClientRect();
                    if (probeRect.width > 0 && probeRect.right > bestRight) {
                      bestRight = probeRect.right;
                      textNode = node;
                    }
                  }
                  node = walker.nextNode();
                }
                if (!textNode) {
                  result.selectionPopoverDiag = layer ? 'no-text-node' : 'no-text-layer';
                } else {
                  const range = document.createRange();
                  range.setStart(textNode, Math.max(0, textNode.textContent.length - 8));
                  range.setEnd(textNode, textNode.textContent.length);
                  const selection = window.getSelection();
                  selection.removeAllRanges();
                  selection.addRange(range);
                  const selectionRect = range.getBoundingClientRect();
                  scroll.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                  const popover = document.querySelector('#pdf-translation-popover');
                  for (let i = 0; i < 40 && popover.hidden; i++) {
                    await new Promise(function (resolve) { setTimeout(resolve, 25); });
                  }
                  if (popover.hidden) {
                    result.selectionPopoverDiag = 'not-shown';
                  } else {
                    const popRect = popover.getBoundingClientRect();
                    const viewRect = document.querySelector('#pdf-overlay').getBoundingClientRect();
                    const inside = popRect.left >= viewRect.left - 1 && popRect.right <= viewRect.right + 1 &&
                      popRect.top >= viewRect.top - 1 && popRect.bottom <= viewRect.bottom + 1;
                    const hit = document.elementFromPoint(Math.round(popRect.left + popRect.width / 2), Math.round(popRect.top + 16));
                    const uncovered = !!hit && (hit === popover || popover.contains(hit));
                    // 模拟选区靠近底部时的初始落点，再让异步译文撑高弹层。
                    // 旧实现只在选区出现时定位一次，译文填入后会越过阅读区底边。
                    popover.style.top = Math.max(viewRect.top + 12, viewRect.bottom - popRect.height - 12) + 'px';
                    const translation = document.querySelector('#pdf-translation-result');
                    translation.hidden = false;
                    translation.textContent = 'Translated passage. '.repeat(200);
                    await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
                    const expandedRect = popover.getBoundingClientRect();
                    const expandedInside = expandedRect.top >= viewRect.top - 1 && expandedRect.bottom <= viewRect.bottom + 1;
                    result.selectionPopoverInsideReading = inside && uncovered && expandedInside;
                    result.selectionPopoverDiag = {
                      inside: inside, uncovered: uncovered, expandedInside: expandedInside,
                      pop: [Math.round(popRect.left), Math.round(popRect.top), Math.round(popRect.right), Math.round(popRect.bottom)],
                      expanded: [Math.round(expandedRect.top), Math.round(expandedRect.bottom)],
                      view: [Math.round(viewRect.left), Math.round(viewRect.top), Math.round(viewRect.right), Math.round(viewRect.bottom)],
                      selection: [Math.round(selectionRect.left), Math.round(selectionRect.right)]
                    };
                    selection.removeAllRanges();
                    popover.hidden = true;
                  }
                }
              }
              document.querySelector('#pdf-tabs .pdf-tab:first-child .pdf-tab-title').click();
              await settle();
              const secondOpened = await selectAndOpen(tabTitleB);
              const tabButton = function (title) {
                return Array.prototype.find.call(document.querySelectorAll('#pdf-tabs .pdf-tab-title'), function (button) {
                  return button.title === title;
                });
              };
              const tabA = tabButton(tabTitleA);
              if (tabA) tabA.click();
              const switchedToA = await waitFor(function () {
                return document.querySelector('#pdf-title').textContent.indexOf(tabTitleA) !== -1 &&
                  document.querySelector('#d-title').textContent === tabTitleA;
              });
              const tabB = tabButton(tabTitleB);
              if (tabB) tabB.click();
              const switchedToB = await waitFor(function () {
                return document.querySelector('#pdf-title').textContent.indexOf(tabTitleB) !== -1 &&
                  document.querySelector('#d-title').textContent === tabTitleB;
              });
              result.pdfTabDetailFollowsActive = firstOpened && secondOpened && switchedToA && switchedToB;
              if (secondPdfPath) {
                document.querySelector('#pdf-tabs .pdf-tab:first-child .pdf-tab-title').click();
                await selectAndOpen(tabTitleA);
                const opens = Array.from(document.querySelectorAll('#drawer [data-att-action="open"]'));
                result.multiAttachmentDiag = { opens: opens.length };
                if (opens.length === 2) {
                  const secondId = opens[1].dataset.attId;
                  opens[1].click();
                  const openedSecond = await waitFor(() => document.querySelector('#pdf-title').textContent.indexOf('B.pdf') !== -1 &&
                    !!document.querySelector('#pdf-scroll canvas'));
                  const samePaperTabs = Array.from(document.querySelectorAll('#pdf-tabs .pdf-tab-title')).filter(button => button.title === tabTitleA);
                  result.multiAttachmentDiag.openedSecond = openedSecond;
                  result.multiAttachmentDiag.tabs = samePaperTabs.length;
                  result.multiAttachmentDiag.title = document.querySelector('#pdf-title').textContent;
                  if (samePaperTabs.length === 2) {
                    samePaperTabs[0].click();
                    const restoredFirst = await waitFor(() => document.querySelector('#pdf-title').textContent.indexOf('A.pdf') !== -1);
                    samePaperTabs[1].click();
                    const restoredSecond = await waitFor(() => document.querySelector('#pdf-title').textContent.indexOf('B.pdf') !== -1);
                    const stored = await window.litboardDesktop.loadLibrary();
                    const papers = stored.papers.filter(p => p.title === tabTitleA && !p.deletedAt);
                    Object.assign(result.multiAttachmentDiag, { restoredFirst, restoredSecond, papers: papers.length,
                      attachments: papers.map(p => p.attachments.map(a => ({ id: a.id, fileName: a.fileName }))) });
                    result.multiAttachmentTabsWork = openedSecond && restoredFirst && restoredSecond && papers.length === 1 &&
                      papers[0].attachments.length === 2 && papers[0].attachments.some(a => a.id === secondId);
                  }
                }
              }
            } catch (error) {
              result.pdfTabDetailFollowsActive = false;
              result.pdfTabDetailDiag = String(error && error.message || error);
            }
          }
          // 底部模型徽标 = 切换入口：点开必须列出刚在设置里加的服务商与模型（分组菜单 + 管理模型…）
          document.querySelector('#btn-agent').click();
          await settle();
          document.querySelector('#agent-model-btn').click();
          await settle();
          const modelMenu = document.querySelector('#ctx-menu');
          const menuText = modelMenu ? modelMenu.textContent : '';
          result.agentModelMenuWorks = !!modelMenu &&
            menuText.indexOf('Smoke Provider') !== -1 && menuText.indexOf('deepseek-smoke') !== -1 &&
            menuText.indexOf('管理模型…') !== -1;
          // 诊断留痕：菜单没出来时能直接看出是「徽标文案不对」还是「菜单根本没开」
          result.agentModelMenuDiag = {
            button: document.querySelector('#agent-model-btn') ? 'ok' : 'missing',
            label: String(document.querySelector('#agent-model').textContent),
            menu: menuText.slice(0, 200)
          };
          // 点菜单外任意处即收起（app.js 的全局 click 监听）
          document.querySelector('.workspace').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await settle();
          result.folderImportEndToEnd = !folderPath;
          if (folderPath && window.litboardSmokeImportFolder) {
            const scanned = await window.litboardDesktop.scanFolder({ path: folderPath });
            const planned = window.LitFolderImport.planFolderImport({ scan: scanned, folders: [], targetFolderId: '' });
            await window.litboardSmokeImportFolder(folderPath, '');
            const loaded = await window.litboardDesktop.loadLibrary();
            const root = loaded.folders.find(folder => folder.name === 'folder-import-fixture' && !folder.deletedAt);
            const child = root && loaded.folders.find(folder => folder.name === 'Nested' && folder.parentId === root.id);
            const titles = ['smoke-folder-alpha', 'smoke-folder-beta'];
            const papers = loaded.papers.filter(paper => titles.includes(paper.title) && !paper.deletedAt);
            const firstPass = scanned.ok && scanned.hiddenSkipped === 1 && scanned.files.length === 3 &&
              scanned.files.every(file => /^[a-f0-9]{64}$/.test(file.sourceKey)) &&
              planned.files.length === 2 && planned.skippedUnsupported === 1 &&
              !!child && papers.length === 2 && papers.every(paper =>
              paper.folderIds.includes(child.id) && paper.attachments.length === 1 &&
              paper.attachments[0].path && paper.sourceMeta.folderImportKey);
            await window.litboardSmokeImportFolder(folderPath, '');
            const reloaded = await window.litboardDesktop.loadLibrary();
            result.folderImportEndToEnd = firstPass &&
              reloaded.folders.filter(folder => !folder.deletedAt && (folder.id === root.id || folder.id === child.id)).length === 2 &&
              reloaded.papers.filter(paper => titles.includes(paper.title) && !paper.deletedAt).length === 2;
          }
          return result;
        })()`);
        // M4 分段计时：主进程启动 → 窗口 did-finish-load（含渲染层脚本求值完成）
        result.mainBootMs = Date.now() - BOOT_T0;
        // 顶栏在最小窗宽（minWidth 1080）下必须仍单行且不横向溢出——顶栏加按钮后守住这条
        const sizeBefore = mainWindow.getContentSize();
        mainWindow.setContentSize(1080, sizeBefore[1]);
        await new Promise(function (resolve) { setTimeout(resolve, 300); });
        result.topbarNarrow = await mainWindow.webContents.executeJavaScript(`(function () {
          const bar = document.querySelector('.topbar');
          const actions = Array.prototype.slice.call(document.querySelectorAll('.topbar-actions'));
          const tops = Array.prototype.slice.call(document.querySelectorAll('.topbar .btn'))
            .filter(function (b) { return !b.hidden && b.getBoundingClientRect().height > 0; })
            .map(function (b) { return b.getBoundingClientRect().top; });
          return {
            innerWidth: window.innerWidth,
            overflow: bar.scrollWidth - bar.clientWidth,
            // 换行会让两行按钮的 top 相差约一行高（30px 上下）；未换行时各按钮高度不同，
            // 居中后 top 仍有 ±1px 出入，故用「最大间距」判定而不是去重计数
            topSpread: Math.round(Math.max.apply(null, tops) - Math.min.apply(null, tops)),
            noWrap: actions.every(function (a) { return getComputedStyle(a).flexWrap === 'nowrap'; })
          };
        })()`);
        // 最小窗宽下正文不得横向溢出（三栏网格 + 轨栏的宽度预算必须落在 1080 内）——仍处于上面的 1080 尺寸
        result.bodyOverflowAtMinWidth = await mainWindow.webContents.executeJavaScript(`(function () {
          var ws = document.querySelector('.workspace');
          return {
            innerWidth: window.innerWidth,
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            workspaceOverflow: ws ? ws.scrollWidth - ws.clientWidth : 0
          };
        })()`);
        mainWindow.setContentSize(sizeBefore[0], sizeBefore[1]);
        // 弹窗栈覆盖：DOM 里每个 .modal-mask 都必须在 LitModal 登记（漏登记 = Esc 关不掉 + 单键快捷键穿透）
        result.modalStackCoverage = await mainWindow.webContents.executeJavaScript(`(function () {
          var api = window.LitModal;
          if (!api) return { skipped: true };
          var stack = api._stack || api;
          if (typeof stack.list !== 'function') return { skipped: true };
          var registered = stack.list().map(function (entry) { return entry.id; });
          var ids = Array.prototype.map.call(document.querySelectorAll('.modal-mask'), function (el) { return el.id; })
            .filter(function (id) { return !!id; });
          return {
            maskCount: ids.length,
            unregistered: ids.filter(function (id) { return registered.indexOf(id) === -1; })
          };
        })()`);
        // Esc 必须关掉最顶层弹窗（含曾经漏登记的引文网络面板）
        result.escClosesTopModal = await mainWindow.webContents.executeJavaScript(`new Promise(function (resolve) {
          var mask = document.querySelector('#graph-mask');
          if (!mask || !window.LitModal) return resolve(false);
          mask.hidden = false;
          setTimeout(function () {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            setTimeout(function () { resolve(mask.hidden === true); }, 200);
          }, 200);
        })`);
        if (SMOKE_SHOT && result.pdfRender && !result.pdfRender.error) {
          // 隐藏窗口不触发重绘，capturePage 只能拿到旧帧；截图前临时显示窗口
          mainWindow.show();
          await new Promise(function (resolve) { setTimeout(resolve, 1000); });
          const image = await mainWindow.webContents.capturePage();
          await fs.writeFile(SMOKE_SHOT, image.toPNG());
          mainWindow.hide();
          result.shotSaved = true;
        }
        result.quitAckWorks = await new Promise(function (resolve) {
          let settled = false;
          const finish = function (value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            ipcMain.removeListener('app:quit-ack', onAck);
            resolve(value);
          };
          const onAck = function () { finish(true); };
          const timer = setTimeout(function () { finish(false); }, 1500);
          ipcMain.once('app:quit-ack', onAck);
          mainWindow.webContents.send('app:before-quit');
        });
        // M1 关闭收尾：close-request → 渲染层等待本地保存落库 → close-ack(ok)
        result.closeRequestAckWorks = await new Promise(function (resolve) {
          let settled = false;
          const finish = function (value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            ipcMain.removeListener('app:close-ack', onAck);
            resolve(value);
          };
          const onAck = function (_event, payload) { finish(!!payload && payload.ok !== false); };
          const timer = setTimeout(function () { finish(false); }, 3000);
          ipcMain.on('app:close-ack', onAck);
          mainWindow.webContents.send('app:close-request');
        });
        console.log('LITBOARD_SMOKE ' + JSON.stringify(result));
        const pdfPassed = !SMOKE_PDF || (result.pdfRender && !result.pdfRender.error && result.pdfRender.canvases > 0 &&
          result.pdfRender.pixelRatio >= 1 && result.pdfRender.dprAligned && result.pdfRender.renderer === SMOKE_EXPECT_RENDERER && result.pdfRender.opaqueCanvas &&
          result.pdfRender.textLayer && result.pdfRender.annotationLayer &&
          result.pdfRender.outlineReadable && result.pdfRender.thumbnailRendered &&
          result.pdfRender.relayout && result.pdfRender.relayoutOk && result.pdfRender.dprRefresh &&
          result.pdfRender.renderingProfile && result.pdfRender.renderingProfile.engine === 'mupdf');
        const pdfWritePassed = !SMOKE_PDF || (result.pdfWrite && result.pdfWrite.written === 1 && result.pdfWrite.found === true);
        const pdfTabDetailPassed = !SMOKE_PDF || (result.pdfTabDetailFollowsActive === true && result.multiAttachmentTabsWork === true);
        // EPUB（foliate-js）：引擎常驻 + 传入真实 EPUB 时全链路（打开/翻页/进度/批注/恢复）
        const epubPassed = result.epubEnginePresent === true && (!SMOKE_EPUB || (
          result.epubReader && !result.epubReader.error && result.epubReader.relocations > 0 &&
          result.epubReader.hasCfi && result.epubReader.progressPercent != null &&
          result.epubReader.overlayDrawings >= 1 && result.epubReader.goToResolved === true));
        // 划词浮层只在传入真实 PDF 的分支里量得到（需要真实文本层造选区）
        const selectionPopoverPassed = !SMOKE_PDF || result.selectionPopoverInsideReading === true;
        const passed = result.desktopBridge && result.modelLoaded && result.tablePresent && result.pdfColumnPresent &&
          result.tableColumnsPresent && result.compactTableRows && result.tableNarrowColumnsKeepWidth && result.tableColumnPickerWorks &&
          result.tableColumnResizeWorks && result.tableResizeDoesNotSort && result.tableHeaderStillSorts &&
           result.markdownLoaded && result.syncUiPresent && result.syncNavGroups === 4 && result.nutstoreTestPresent && result.nutstoreFolderPresent &&
           result.remoteRecoveryUiPresent && result.remoteRecoveryApiPresent && result.remotePlanProgressPresent && result.syncStopPresent &&
           result.autoSyncTogglePresent && result.syncNowInCloudPresent && result.syncRunUnconfiguredGuarded === true &&
          result.dataPathUiPresent && result.dataPathApiPresent && result.dataPathApiWorks && result.dataPathTypable &&
          result.inlineTestStatusPresent && result.nestedFolderUiPresent && result.folderTreeModulePresent &&
          result.muPdfLoaded && result.pdfLayoutTogglePresent && result.pdfReadingThemesWork && result.translationUiPresent && result.journalRankUiPresent &&
          result.searchHelpUiPresent && result.searchHelpOpens === true && result.searchHelpTryWorks === true &&
          result.wordCiteSearchUiPresent && result.wordCiteHelpOpens === true && result.wordCiteHelpTryWorks === true &&
          result.wordCiteSyntaxHintWorks === true && result.wordCiteSyntaxHintClears === true &&
          result.settingsResizeUiPresent && result.settingsResizes === true && result.settingsResizeResets === true &&
          result.bodyOverflowAtMinWidth && result.bodyOverflowAtMinWidth.docOverflow <= 1 &&
          result.modalStackCoverage && result.modalStackCoverage.unregistered && result.modalStackCoverage.unregistered.length === 0 &&
          result.escClosesTopModal === true &&
          result.agentDrawerPresent && result.agentApiPresent && result.agentCoreLoaded &&
          result.agentProviderEditorWorks === true && result.agentProviderWideLayout === true &&
          result.embeddingZhipuPresetPresent === true && result.inlineStatusCompact === true && result.agentModelMenuWorks === true &&
          result.agentPhase2Present && result.agentGraphPresent && result.graphViewerWorks === true &&
          result.agentWebSearchPresent && result.sourceApiLinksPresent && result.updateCheckPresent &&
          result.agentReaderPresent && result.agentFindLiteraturePresent &&
          result.agentChatRendered === true && result.chatBodyIsFlexColumn === true &&
          result.chatMathRendered === true &&
          result.rightRailPresent && result.railToggleAtBottom && result.railSwitchWorks === true && result.sidebarCollapseWorks === true &&
          result.workspacePanesAligned === true &&
          result.readingRailOk === true &&
          result.journalRankColumnPresent && result.rankRefreshTogglePresent &&
          result.scigreatTestPresent && result.easyscholarTestPresent && result.sourcesTestPresent &&
          result.pdfAnnotationUiPresent &&
          result.pdfDownloadButtonPresent && result.detailActionsCompact && result.simpleFolderDropUi && result.statsOverviewPresent && result.sidebarTagPanelPresent &&
          result.folderImportPresent && result.folderImportContextAction && result.folderImportDropHighlight === true &&
          result.folderImportEndToEnd === true &&
          result.pdfSearchUiPresent && result.pdfSearchTogglePresent && result.pdfSearchOptionsPresent &&
          result.issuesCenterPresent && result.onboardPresent &&
          result.pdfNavigationUiPresent && result.paginationPresent &&
          result.paginationWorks && result.folderCreateOpens && result.folderCrudAndDragWorks && result.renderedRows <= 100 && result.sqliteStorageReady &&
          result.libraryNavContextMenu === true &&
          result.trashNavPresent && result.smartFolderUiAbsent && result.tagManagePresent && result.cslUiPresent &&
          result.syncIndicatorPresent && result.bridgeUiPresent && result.pdfReaderExtrasPresent && result.pdfSideControlsWork &&
          result.pdfTopTabsPresent && result.titlebarControlsPresent && result.dialogUiPresent && result.zoteroWizardPresent &&
          result.docxExportPresent && result.readerNotePanelPresent && result.epubReaderPresent && result.noteEditorPresent && result.resultViewPresent && result.wordSectionPresent && result.integrationPanelsPresent && result.queryBuilderPresent && result.bulkEditPresent && result.undoPresent &&
          result.queryEnginePresent &&
          result.nestedModalStacking &&
          result.settingsEntryInTopbar && result.railSeedRow && result.railPaneSwitchesToDetail &&
          result.topbarMenuExclusive === true && result.topbarMenuOnTop === true &&
          result.topbarNarrow && result.topbarNarrow.noWrap === true && result.topbarNarrow.topSpread <= 3 &&
          result.topbarNarrow.overflow <= 1 && result.topbarNarrow.innerWidth <= 1090 &&
          result.removedSettingsAbsent && result.simplifiedBackupUiPresent &&
          result.saveLibraryWorks && result.cslVendorRender && result.quitAckWorks && result.closeRequestAckWorks && pdfPassed && pdfWritePassed && pdfTabDetailPassed && epubPassed &&
          selectionPopoverPassed;
        await finishSmokeTest(result, passed ? 0 : 1);
      } catch (error) {
        console.error('LITBOARD_SMOKE_ERROR', error);
        await finishSmokeTest({ error: String(error && error.message || error) }, 1);
      }
    });
    mainWindow.webContents.once('did-fail-load', async function (_event, code, description) {
      console.error('LITBOARD_SMOKE_LOAD_FAILED', code, description);
      await finishSmokeTest({ error: description, code: code }, 1);
    });
  }

  // 无边框窗口：把最大化状态推给渲染层，用于切换窗口控制按钮图标
  mainWindow.on('maximize', function () {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window:maximize-changed', true);
  });
  mainWindow.on('unmaximize', function () {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window:maximize-changed', false);
  });
  // M1：关闭前让渲染层完成本地保存收尾（见 askRendererToFinishBeforeClose）
  mainWindow.on('close', function (event) {
    if (quitApproved || ctx.forceQuitNext) return;
    event.preventDefault();
    if (closeWaiter) return; // 已有收尾在途，等它的结果
    askRendererToFinishBeforeClose();
  });

  mainWindow.webContents.setWindowOpenHandler(function (details) {
    const url = safeExternalUrl(details.url);
    if (url) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', function (event, url) {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      const external = safeExternalUrl(url);
      if (external) shell.openExternal(external);
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}


let quitting = false;

/* M1 关闭收尾：窗口 close 被拦截后向渲染层请求保存收尾（等待「已持久化」而非「已入队」）。
 * app:close-ack 回报结果：ok=false 保存失败保留窗口（渲染层负责向用户确认）；用户在失败
 * 弹窗里确认放弃强退时，渲染层同样以 close-ack ok=true 放行（app.js → closeAck({ok:!!force})）。
 * 渲染层崩溃/无响应超时放行，避免出现无法退出的死锁。
 * 内部 relaunch（数据目录切换 / 备份恢复重启）置 forceQuitNext 直接放行——彼时数据库已切换，
 * 渲染层的保存收尾不再有意义。 */
let quitApproved = false;
let closeWaiter = null;
let sessionsFlushPromise = null; // R04：关闭时的会话冲刷，will-quit 清理链等待它
const CLOSE_ACK_TIMEOUT = 8000;

function proceedClose() {
  quitApproved = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  else app.quit();
}

ipcMain.on('app:close-ack', function (_event, payload) {
  if (!closeWaiter) return;
  const waiter = closeWaiter;
  closeWaiter = null;
  clearTimeout(waiter.timer);
  if (payload && payload.ok === false) return; // 保存失败：窗口保留，渲染层负责向用户确认
  proceedClose();
});

function askRendererToFinishBeforeClose() {
  // 关闭收尾窗口期顺带冲刷 AI 会话（1s 防抖外的兜底；会话是用户成果，尽力不丢）。
  // R04：flushPromise 交给 will-quit 的清理链等待——冲刷失败/超时由既有的 8s 强退兜底，
  // 不再 fire-and-forget（否则「清理完成」可能先于磁盘写入发生）。
  sessionsFlushPromise = ctx.agentSessions ? ctx.agentSessions.flushAll().catch(function (error) {
    startupLog('session flushAll on close failed: ' + (error && error.message || error));
  }) : null;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    proceedClose();
    return;
  }
  const timer = setTimeout(function () {
    if (!closeWaiter) return;
    closeWaiter = null;
    proceedClose();
  }, CLOSE_ACK_TIMEOUT);
  closeWaiter = { timer: timer };
  mainWindow.webContents.send('app:close-request');
}

app.on('will-quit', function (event) {
  if (quitting || !ctx.libraryDb) return;
  quitting = true;
  event.preventDefault();
  startupLog('will-quit: closing (db checkpoint / backup / bridge stop)');
  if (ctx.wordBridgeInstance) ctx.wordBridgeInstance.stop();
  let finished = false;
  const done = function () {
    if (finished) return;
    finished = true;
    startupLog('will-quit: cleanup done, exiting');
    const closeDb = function () { ctx.libraryDb.close().finally(function () { app.exit(0); }); };
    // R04：等关闭窗口期启动的会话冲刷完成（有 8s 强退兜底，不会无限等）
    const afterSessions = function () {
      if (ctx.bridgeServer) ctx.bridgeServer.stop().then(closeDb, closeDb);
      else closeDb();
    };
    if (sessionsFlushPromise) sessionsFlushPromise.then(afterSessions, afterSessions);
    else afterSessions();
  };
  // 硬兜底：cleanup 若因文件锁/IO 永不结束，8 秒后强制退出，
  // 绝不留下「进程活着但没有窗口」的僵尸占着单实例锁
  const killTimer = setTimeout(function () {
    startupLog('will-quit: cleanup timed out after 8s, force exit');
    app.exit(0);
  }, 8000);
  if (typeof killTimer.unref === 'function') killTimer.unref();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const timer = setTimeout(done, 5000);
    ipcMain.once('app:quit-ack', function () { clearTimeout(timer); done(); });
    mainWindow.webContents.send('app:before-quit');
  } else {
    done();
  }
});

/* 数据目录迁移收尾：旧目录里常剩被别的进程短暂占用的运行时缓存（典型就是 Chromium 的
 * lockfile），启动那一刻删不掉。这里在运行期补删几次，通常几秒后就干净了——否则旧目录会
 * 永久留一个 0 字节小尾巴，用户只能靠反复重启去碰运气。 */
function scheduleDataDirCleanupRetries() {
  [3000, 10000, 30000, 90000, 240000].forEach(function (delay) {
    const timer = setTimeout(function () {
      try {
        if (!ctx.dataPathManager) return;
        const state = ctx.dataPathManager.getState();
        if (!state.cleanupPending && !state.runtimeSweepPending) return;
        ctx.dataPathState = ctx.dataPathManager.retryCleanup();
      } catch (error) {
        console.error('LitBoard pending data directory cleanup retry failed:', error);
      }
    }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
}

if (hasSingleInstanceLock) app.whenReady().then(async function () {
  const dbOpenT0 = Date.now();
  startupLog('app ready, opening database…');
  // litboard:// 深链：注册协议（用户级）；本次启动经命令行传入的深链在窗口就绪后派发
  try { app.setAsDefaultProtocolClient('litboard'); } catch (error) {}
  (Array.isArray(process.argv) ? process.argv : []).forEach(function (arg) {
    if (String(arg).indexOf('litboard://') === 0) openLitboardTarget(arg);
  });
  if (ctx.dataPathState.fatalError) {
    const message = ctx.dataPathState.migrationError + T('\n\n为避免打开错误或空白文献库，LitBoard 已停止启动。请恢复原目录后重试。');
    if (SMOKE_TEST) {
      await finishSmokeTest({ error: message }, 1);
    } else {
      dialog.showErrorBox(T('LitBoard 数据目录不可用'), message);
      app.exit(1);
    }
    return;
  }
  const configDir = ctx.dataPathState.configDir;
  const libraryDir = ctx.dataPathState.libraryDir;
  ctx.libraryDb = createLibraryDb(libraryDir);
  ctx.backupManager = createBackupManager({
    libraryDir: libraryDir,
    configDir: configDir,
    dataPathManager: ctx.dataPathManager,
    getDb: function () { return ctx.libraryDb; },
    // M9 二期：快照附带调研库身份核（getter 延迟到创建快照时才读 researchDb）
    getResearchIdentity: function () { return ctx.researchDb ? ctx.researchDb.exportIdentityCore() : null; }
  });
  try {
    await ctx.libraryDb.open();
    startupLog('database open done in ' + (Date.now() - dbOpenT0) + 'ms');
    // 主进程界面语言跟随上次保存的选择（渲染层启动后也会实时推 uiLang）
    LitI18n.setLang(String(ctx.libraryDb.getSetting('uiLang') || ''), { persist: false });
  } catch (error) {
    startupLog('database open FAILED: ' + (error && error.message || error));
    if (error.code !== 'LITBOARD_DB_CORRUPT') throw error;
    // 数据库损坏：绝不删除/覆盖损坏文件；按「最新完整快照 → .bak 兼容兜底 → 用户选目录/退出」恢复
    console.error('LitBoard database corrupted:', error.message);
    let recovered = false;
    const attempt = await ctx.backupManager.restoreLatestValid();
    if (attempt.ok) { recovered = true; }
    else {
      const legacy = await ctx.backupManager.restoreLegacyBak();
      if (legacy.ok) { recovered = true; }
    }
    while (!recovered) {
      if (SMOKE_TEST) {
        await finishSmokeTest({ error: T('数据库损坏且无有效备份：') + error.message }, 1);
        return;
      }
      const choice = await dialog.showMessageBox({
        type: 'error',
        title: T('LitBoard 数据库已损坏'),
        message: T('LitBoard 数据库已损坏，且没有找到可用的完整备份。\n\n') + error.message +
          T('\n\n您可以手动选择包含 LitBoard 备份快照的目录重试恢复，或退出应用。') +
          T('\n（损坏的主库/WAL/SHM 文件会原样保留，不会被删除或覆盖。）'),
        buttons: [T('选择备份目录…'), T('退出')],
        defaultId: 0,
        cancelId: 1
      });
      if (choice.response !== 0) { app.exit(1); return; }
      const picked = await dialog.showOpenDialog({
        title: T('选择包含 LitBoard 备份快照（snapshots 目录）的文件夹'),
        properties: ['openDirectory']
      });
      if (picked.canceled || !picked.filePaths[0]) { app.exit(1); return; }
      const restored = await ctx.backupManager.restoreLatestValid(picked.filePaths[0]);
      if (restored.ok) { recovered = true; }
      else {
        await dialog.showMessageBox({
          type: 'error', title: T('备份不可用'),
          message: T('所选目录中没有可用的备份快照：') + (restored.error || '') + T('\n\n可重新选择目录，或退出应用。')
        });
      }
    }
    if (recovered) await fs.rm(path.join(configDir, 'sync-base.json'), { force: true }).catch(function () {});
    // 还原成功后重新打开；仍失败则停止启动，绝不静默继续空白库
    try {
      await ctx.libraryDb.open();
    } catch (openError) {
      console.error('LitBoard database still unusable after restore:', openError);
      if (SMOKE_TEST) await finishSmokeTest({ error: String(openError && openError.message || openError) }, 1);
      else {
        dialog.showErrorBox(T('LitBoard 启动失败'),
          String(openError && openError.message || openError) + T('\n\n已停止启动；损坏文件保留在文献库目录中。'));
        app.exit(1);
      }
      return;
    }
    console.warn('LitBoard database was damaged and has been restored from a full snapshot.');
  }
  ctx.integrations = createIntegrations({
    baseDir: configDir,
    homeDir: app.getPath('home'),
    appDataDir: app.getPath('appData'),
    safeStorage: safeStorage,
    fetch: function (url, init) { return net.fetch(url, init); },
    notify: function (channel, payload) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    }
  });
  // 调研助手子系统：调研库（<configDir>/research，受管目录）+ 检索/LLM 网络 + 会话存储。
  // 初始化失败不阻断启动（handlers 带 null 守卫，设置页可见错误）。
  try {
    ctx.researchDb = createResearchDb({ dir: path.join(configDir, 'research') });
    ctx.researchNet = createResearchNet({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return ctx.integrations.getResearchRuntimeConfig(); }
    });
    // M9-4：科研网页检索（TinyFish；默认关 + 出境告知确认后才可用，双端把关）
    ctx.webFetchNet = createWebFetchNet({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return ctx.integrations.getResearchRuntimeConfig(); }
    });
    ctx.agentNet = createAgentNet({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return ctx.integrations.getResearchRuntimeConfig(); },
      // 「服务商 + 模型」清单：设置页按 providerId 测试连接/拉取模型时，由主进程解该服务商
      // 自己存的 Key（用户没重填也要能测；明文不出主进程）
      getProvider: function (id) { return ctx.integrations.getAgentProviderRuntime(id); },
      // 出网身份：OpenCode 等网关要求客户端自带 User-Agent（通用 HTTP 库名会被区别对待）
      userAgent: 'LitBoard/' + app.getVersion(),
      notify: function (channel, payload) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
      },
    });
    // 调研库向量模型的统一出网层（AI 助手语义检索工具 / 段落找文献向量召回 / 空闲增量构建
    // 三条链共用；用量记账随服务走，重启从 settings 恢复）
    ctx.embedService = createEmbedService({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return ctx.integrations.getResearchRuntimeConfig(); },
      userAgent: 'LitBoard/' + app.getVersion(),
      initialUsage: (function () {
        try { return JSON.parse(ctx.libraryDb.getSetting('embedUsageTotals') || 'null'); } catch (error) { return null; }
      })(),
      persistUsage: function (totals) {
        try { ctx.libraryDb.setSetting('embedUsageTotals', JSON.stringify(totals)); } catch (error) {}
        return Promise.resolve();
      }
    });
    ctx.agentSessions = createSessions({
      rootDir: agentSessionsRoot(),
      trashItem: function (dir) { return shell.trashItem(dir); },
      log: function (message) { startupLog('sessions: ' + message); }
    });
    await ctx.researchDb.open();
    // R19 临时全文链：清扫上次异常退出可能残留的临时 PDF（正常路径抽取完即删，目录应为空）
    await fs.rm(path.join(ctx.dataPathState.configDir, 'tmp-fulltext'), { recursive: true, force: true }).catch(function () {});
    // 二期：调研库向量构建器（空闲调度；向量模型配置就绪即由 60s 巡检自动增量构建）
    ctx.researchEmbedder = createResearchEmbedder({
      researchDb: ctx.researchDb,
      embed: ctx.embedService,
      // R14：失败批次的持久标记存 settings 表——巡检/入库触发改走 maybeAutoBuild，
      // 见到标记就跳过，直到用户手动「构建」清除（失败不自动重试计费）
      getSetting: function (key) { return ctx.libraryDb.getSetting(key); },
      setSetting: function (key, value) { return ctx.libraryDb.setSetting(key, value); },
      isIdle: function () { return (Date.now() - ctx.lastLibraryWriteAt > 8000) && !ctx.syncInFlight; },
      notify: function (channel, payload) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
      },
      log: function (message) { startupLog('embed: ' + message); }
    });
    setInterval(function () {
      scheduleAutoEmbed();
    }, 60000).unref();
  } catch (error) {
    startupLog('research subsystem init FAILED: ' + (error && error.message || error));
    ctx.researchDb = null;
  }
  // 旧 JSON 存储 / 旧全文缓存 → SQLite（一次性迁移，旧文件改名留底）
  try {
    const config = await ctx.integrations.getConfig();
    const customCacheDir = config.pdfCacheDir && path.isAbsolute(config.pdfCacheDir) ? config.pdfCacheDir : '';
    const seenPaths = new Set();
    const uniquePaths = function (values) {
      return values.filter(Boolean).filter(function (value) {
        const resolved = path.resolve(value);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (seenPaths.has(key)) return false;
        seenPaths.add(key);
        return true;
      });
    };
    const migrated = [];
    const legacyDirs = uniquePaths([libraryDir, configDir, bootstrapUserData]);
    for (const directory of legacyDirs) {
      migrated.push(...await ctx.libraryDb.migrateLegacy(createLibraryStorage(directory), null));
    }
    seenPaths.clear();
    const cacheFiles = uniquePaths([customCacheDir && path.join(customCacheDir, 'pdftext.v1.json')]
      .concat(legacyDirs.map(function (directory) { return path.join(directory, 'pdftext.v1.json'); })));
    for (const cacheFile of cacheFiles) {
      migrated.push(...await ctx.libraryDb.migrateLegacy(null, cacheFile));
    }
    if (migrated.length) console.log('LitBoard migrated legacy stores:', migrated.join(', '));
  } catch (error) {
    console.error('LitBoard legacy migration failed:', error);
  }
  const pendingRebase = ctx.dataPathManager.pendingRebase();
  if (pendingRebase) {
    try {
      const rebased = ctx.dataPathManager.rebaseWorkspacePaths(
        ctx.libraryDb.loadState(), pendingRebase.fromConfigDir, pendingRebase.toConfigDir);
      if (rebased.changed) ctx.libraryDb.saveState(rebased.workspace);
      ctx.dataPathState = ctx.dataPathManager.completeRebase();
    } catch (error) {
      // 保留 pendingRebase；下次启动会重试，原目录也仍保留，避免丢失附件引用。
      console.error('LitBoard managed path rebase failed:', error);
      ctx.dataPathState = ctx.dataPathManager.getState();
    }
  }
  ctx.libraryDb.backupIfDue(false).catch(function () {});
  scheduleDataDirCleanupRetries();
  // 完整备份：启动时检查一次，之后每小时检查；距上次成功超过 24 小时则自动备份
  ctx.backupManager.maybeAutoBackup().catch(function (error) {
    console.error('LitBoard auto backup at startup failed:', error);
  });
  setInterval(function () {
    ctx.backupManager.maybeAutoBackup().catch(function (error) {
      console.error('LitBoard auto backup failed:', error);
    });
  }, 60 * 60 * 1000);
  registerAll();
  // 应用自动更新：发现更高版本即后台预下载安装包（SHA-256 校验 + 单份缓存），
  // 就绪后通知渲染层；点「立即更新」直接拉起 NSIS 安装界面并退出本应用。
  ctx.updateManager = createUpdateManager({
    getConfigDir: function () { return ctx.dataPathState.configDir; },
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    isPortable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    fetchRelease: async function () {
      const response = await net.fetch('https://api.github.com/repos/L1nze/LitBoard/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LitBoard' },
        signal: AbortSignal.timeout(10000)
      });
      if (response.status === 404) return null; // 尚未发布正式 Release
      if (!response.ok) throw new Error('GitHub Release: HTTP ' + response.status);
      return response.json();
    },
    fetchText: async function (url) {
      const response = await net.fetch(url, { headers: { 'User-Agent': 'LitBoard' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.text();
    },
    netFetch: function (url, init) { return net.fetch(url, init); },
    spawnInstaller: function (file) {
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    },
    revealPath: function (file) { shell.showItemInFolder(file); },
    requestQuit: function () {
      setImmediate(function () {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        else app.quit();
      });
    },
    sendStatus: function (status) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
    },
    log: startupLog
  });
  // 启动清扫（含「装完新版自动删安装包」）后静默自检一次；离线/失败只落日志不打扰。
  // 之后每 6 小时复查一次：应用常开时新发布的版本也能在会话内发现并提示（含启动时离线、
  // 稍后才联网的场景）。checkNow 对「下载中/已就绪」自带去重不会重复下载，渲染层 toast
  // 按版本去重，复查不会重复打扰。
  ctx.updateManager.init().then(function () {
    const silentUpdateCheck = function () {
      ctx.updateManager.checkNow().catch(function (error) {
        startupLog('auto update check failed: ' + (error && error.message || error));
      });
    };
    const updateTimer = setTimeout(silentUpdateCheck, 8000);
    if (updateTimer.unref) updateTimer.unref();
    setInterval(silentUpdateCheck, 6 * 60 * 60 * 1000);
  }).catch(function (error) { startupLog('update manager init failed: ' + (error && error.message || error)); });
  // 浏览器扩展桥接服务（仅 127.0.0.1）
  // 主进程网络出口：OpenAlex DOI 补全（api.openalex.org）；知网 PDF 走的浏览器会话，不直连知网。
  ctx.bridgeServer = createBridgeServer({
    libraryDb: ctx.libraryDb,
    fetch: function (url, init) { return net.fetch(url, init); },
    // 扩展抓取的 PDF 一律落受管目录，避免把文献库附件散落到不受 LitBoard 管理的位置。
    resolveDownloadDir: async function (paperId) {
      return paperId ? itemAttachmentDir(ctx.dataPathState.configDir, paperId) : openAccessPdfDir();
    },
    onSaved: function (info) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('library:externally-updated', {
          paperId: info.paperId,
          title: info.paper && info.paper.title,
          duplicated: info.duplicated,
          pdfAttached: info.pdfAttached
        });
      }
    }
  });
  // 先建立桥接对象再加载渲染页：页面启动时的“当前文件夹”上报不能落到 null。
  createWindow();
  startupLog('main window created');
  ctx.bridgeServer.start().then(function (status) {
    if (status.running) console.log('LitBoard bridge listening on 127.0.0.1:' + status.port);
  }).catch(function (error) { console.error('LitBoard bridge failed:', error); });
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(function (error) {
  startupLog('startup FAILED: ' + (error && error.stack || error));
  console.error('LitBoard startup failed:', error);
  if (SMOKE_TEST) finishSmokeTest({ error: String(error && error.message || error) }, 1);
  else {
    dialog.showErrorBox(T('LitBoard 启动失败'), String(error && error.message || error));
    app.exit(1);
  }
});

app.on('window-all-closed', function () {
  startupLog('window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});
