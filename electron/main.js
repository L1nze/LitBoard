'use strict';

const { app, BrowserWindow, clipboard, dialog, ipcMain, net, safeStorage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createLibraryStorage } = require('./storage.js');
const { createLibraryDb } = require('./db.js');
const { createIntegrations, storeFileInto, resolveSnapshotEntry } = require('./integrations.js');
const { createWordBridge } = require('./word-bridge.js');
const { downloadPdfToFile, safePdfFileName, composeAutoDownloadPath } = require('./pdfdownload.js');
const { createBridgeServer } = require('./bridge-server.js');
const { createResearchDb } = require('./research-db.js');
const { createResearchNet } = require('./research-net.js');
const { createResearchEmbedder } = require('./research-build.js');
const { createAgentNet } = require('./agent-net.js');
const { createEmbedService } = require('./embed-net.js');
const { createSessions } = require('./sessions.js');
const { createDataPathManager } = require('./data-paths.js');
const { createBackupManager } = require('./backup.js');
const LitBib = require('../js/bibtex.js');
const LitResearch = require('../js/research.js');
const LitGraphGen = require('../js/graphgen.js');
const LitLitSearch = require('../js/litsearch.js');
const LitWebFetch = require('../js/webfetch.js');
const LitMarkdown = require('../js/markdown.js');
const { createWebFetchNet } = require('./webfetch-net.js');
/* 界面语言：与渲染层共用 js/i18n.js + js/i18n-en.js（UMD 双出口）。
 * 键 = 中文源串；语言存 settings 表 uiLang（渲染层切换时经 settings:set 写入）。 */
const LitI18n = require('../js/i18n.js');
require('../js/i18n-en.js');
const T = LitI18n.t.bind(LitI18n);

function ignoreBrokenPipe(stream) {
  stream.on('error', function (error) {
    if (error && error.code === 'EPIPE') return;
    throw error;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

const ALLOWED_API_HOSTS = new Set([
  'api.openalex.org',
  'api.semanticscholar.org',
  'api.crossref.org',
  'eutils.ncbi.nlm.nih.gov',
  'openlibrary.org'
]);
const SMOKE_TEST = process.env.LITBOARD_SMOKE_TEST === '1';
// 生命周期冒烟模式：write（写入并真实关闭）/ verify（重启后校验）
const LIFECYCLE_MODE = process.env.LITBOARD_SMOKE_LIFECYCLE || '';
// M4 分段计时起点：主进程模块加载时刻
const BOOT_T0 = Date.now();
const SMOKE_PDF = process.env.LITBOARD_SMOKE_PDF || '';
// 可选：把 smoke 渲染的 PDF 页截图到指定文件（肉眼检查渲染效果用）
const SMOKE_SHOT = process.env.LITBOARD_SMOKE_SHOT || '';
const SMOKE_SCALE = Number(process.env.LITBOARD_SMOKE_SCALE) || 0.2; // 截图目检时可调大
const SMOKE_EXPECT_RENDERER = process.env.LITBOARD_SMOKE_EXPECT_RENDERER === 'pdfjs' ? 'pdfjs' : 'pdfium';

// 启动诊断日志：打包版没有控制台，「进程在但窗口没出来」这类问题无从查看。
// 把启动里程碑（锁、数据目录、开库、建窗、退出）落到 litboard-startup.log，
// 出问题时按最后一条即可定位卡在哪一步。每条都整体重写文件，失败静默（诊断不能反噬启动）。
let startupLogBuffer = [];
let startupLogFile = '';
function startupLog(message) {
  startupLogBuffer.push(new Date().toISOString() + ' ' + message);
  if (startupLogBuffer.length > 400) startupLogBuffer.splice(0, startupLogBuffer.length - 400);
  const target = startupLogFile || path.join(app.getPath('userData'), 'litboard-startup.log');
  fs.writeFile(target, startupLogBuffer.join('\n') + '\n', 'utf8').catch(function () {});
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let bootstrapUserData = '';
let dataPathManager = null;
let dataPathState = null;
if (!hasSingleInstanceLock) {
  startupLog(T('single-instance lock NOT acquired（已有实例在运行或残留），本次启动静默退出'));
  app.quit();
} else {
  startupLog('single-instance lock acquired');
  bootstrapUserData = app.getPath('userData');
  dataPathManager = createDataPathManager({ defaultDir: bootstrapUserData });
  dataPathState = dataPathManager.prepareAtStartup();
  startupLogFile = path.join(dataPathState.configDir, 'litboard-startup.log');
  startupLog('data paths ready, config=' + dataPathState.configDir + ' library=' + dataPathState.libraryDir +
    (dataPathState.fatalError ? ' FATAL: ' + dataPathState.migrationError : ''));
  if (!dataPathState.fatalError) {
    // 必须在 ready/BrowserWindow 之前设置，Chromium 的 Local Storage、Preferences
    // 与 session 数据才会随“配置目录”一起迁移。
    app.setPath('userData', dataPathState.configDir);
    app.setPath('sessionData', dataPathState.configDir);
  }
}

let mainWindow = null;
let libraryDb = null;
let integrations = null;
let bridgeServer = null;
let wordBridgeInstance = null;
let backupManager = null;
// 调研助手子系统（一期：调研库 / OpenAlex 检索 / LLM 流式 / 会话目录；二期：向量/回填/PDF/补登记）
let researchDb = null;
let researchNet = null;
let researchEmbedder = null;
let embedService = null;
let agentNet = null;
let agentSessions = null;
let webFetchNet = null;
// 向量空闲调度的「库空闲」判定：距上次保存 >8s 且无进行中同步（近似，够用——批间还会复检）
let lastLibraryWriteAt = 0;
let syncInFlight = false;

/**
 * 语义检索是 AI 助手的工具（正式库那条 `semantic:` 搜索链已移除，没有用户侧开关）：
 * 向量模型配置就绪即视为可用。巡检与检索入库后都走这里，配置不齐直接跳过
 * （不调用 maybeAutoBuild，免得每 60s 往日志里写一条「未配置」的失败）。
 */
function scheduleAutoEmbed() {
  if (!researchEmbedder || researchEmbedder.isRunning()) return;
  Promise.resolve()
    .then(function () { return researchEmbedder.resolveTarget(); })
    .then(function (target) {
      if (!target || target.ok !== true) return null;
      return researchEmbedder.maybeAutoBuild(true);
    })
    .catch(function () {});
}

// 开放获取 PDF 的默认落盘目录：配置目录下的受管子目录（未设置「PDF 自动下载目录」时，
// 桌面下载与扩展抓取都落到这里）。已登记进 MANAGED_CONFIG_DIRS，迁移配置目录时随迁。
function openAccessPdfDir() {
  return path.join(dataPathState.configDir, 'open-access-pdf');
}

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
  mainWindow = new BrowserWindow({
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
        const result = await mainWindow.webContents.executeJavaScript(`(async function () {
          const pdfResourceRequests = [];
          const originalXhrOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function (method, url) {
            if (/\\/vendor\\/pdfjs\\/(?:standard_fonts|cmaps|wasm|iccs)\\//.test(String(url))) pdfResourceRequests.push(String(url));
            return originalXhrOpen.apply(this, arguments);
          };
          const pdfPath = ${JSON.stringify(SMOKE_PDF)};
          const shotWanted = ${SMOKE_SHOT ? 'true' : 'false'};
          const pdfjsLib = pdfPath ? await window.LitPdf.load() : await import('./vendor/pdfjs/pdf.min.mjs');
          const result = {
            desktopBridge: !!window.litboardDesktop,
            modelLoaded: !!window.LitModel,
            tablePresent: !!document.querySelector('#lit-table'),
            pdfColumnPresent: !!document.querySelector('.col-attachment'),
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
            remoteRecoveryUiPresent: !!document.querySelector('#sync-remote-inspect') && !!document.querySelector('#sync-remote-config') &&
              !!document.querySelector('#sync-remote-restore') && !!document.querySelector('#sync-remote-merge') &&
              !!document.querySelector('#sync-remote-plan-mask'),
            remotePlanProgressPresent: !!document.querySelector('#sync-remote-plan-progress') &&
              !!document.querySelector('#sync-remote-plan-progress-bar') && !!document.querySelector('#sync-remote-plan-progress-text') &&
              !!window.litboardDesktop.onSyncProgress,
            autoSyncTogglePresent: !!document.querySelector('#sync-auto-sync') && !!window.litboardDesktop.getSetting &&
              !!window.litboardDesktop.setSetting,
            remoteRecoveryApiPresent: !!window.litboardDesktop.inspectNutstoreRemote && !!window.litboardDesktop.pullNutstoreConfig &&
              !!window.litboardDesktop.createNutstoreSyncPlan && !!window.litboardDesktop.applyNutstoreSyncPlan,
            inlineTestStatusPresent: !!document.querySelector('#sync-nutstore-test-status') && !!document.querySelector('#sync-scigreat-test-status'),
            nestedFolderUiPresent: !!document.querySelector('#folder-create-parent'),
            pdfJsLoaded: !!pdfjsLib.getDocument,
            pdfLayoutTogglePresent: !!document.querySelector('#pdf-layout-toggle') && !!document.querySelector('#pdf-renderer-toggle') &&
              !!document.querySelector('#pdf-reflow-toggle'),
            translationUiPresent: !!document.querySelector('#pdf-translate-selection') && !!document.querySelector('#sync-translator-provider'),
            // AI 调研助手（一期）：抽屉 + 顶栏入口 + 设置区（AI 助手/检索服务/调研库/会话记录）+ IPC 面
            agentDrawerPresent: !!document.querySelector('#agent-drawer') && !!document.querySelector('#agent-chat-root') &&
              !!document.querySelector('#agent-history') && !!document.querySelector('#btn-agent') &&
              !!document.querySelector('#agent-model') && !!document.querySelector('#agent-thinking') &&
              !!document.querySelector('#sync-agent-base-url') && !!document.querySelector('#sync-openalex-email') &&
              !!document.querySelector('#sync-research-import') && !!document.querySelector('#sync-agent-session-root'),
            agentApiPresent: !!window.litboardDesktop.agentChat && !!window.litboardDesktop.agentCancel &&
              !!window.litboardDesktop.researchQuery && !!window.litboardDesktop.researchSearchOpenalex &&
              !!window.litboardDesktop.sessionList && !!window.litboardDesktop.onAgentEvent,
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
            agentGraphPresent: !!document.querySelector('#graph-mask') && !!document.querySelector('#graph-canvas') &&
              !!document.querySelector('#graph-export') &&
              !!window.vis && !!window.vis.Network && !!window.LitGraphGen && !!window.LitGraphView &&
              !!window.litboardDesktop.researchGraph,
            // M9-4：科研网页检索——设置 UI + IPC 面 + 纯函数模块 + 工具门控（默认关：未传 includeWebSearch 不注册）
            agentWebSearchPresent: !!document.querySelector('#sync-web-search-enabled') &&
              !!document.querySelector('#sync-tinyfish-key') &&
              !!window.litboardDesktop.researchWebSearch && !!window.litboardDesktop.researchFetchPage &&
              !!window.LitWebFetch &&
              !window.LitAgent.createTools({ desktop: {} }).tools.some(function (t) { return t.function.name === 'web_search'; }) &&
              window.LitAgent.createTools({ desktop: {}, includeWebSearch: true }).tools.some(function (t) { return t.function.name === 'web_search'; }),
            // PDF 阅读助手（期一）：agent 的按页读取/批注工具 + 页区间 IPC
            //（阅读器「AI 解释」按钮已于 2026-09-20 整体移除，用户反馈无实际作用）
            agentReaderPresent: !!window.litboardDesktop.pdfSearchGetPageRange,
            // R16：段落找文献——S2 Key 设置项 + IPC 面 + 纯函数层 + 工具常驻注册；
            // 语义检索只作为 agent 工具（供应商开关与手动模式「语义检索」按钮已移除）
            agentFindLiteraturePresent: !!document.querySelector('#sync-semanticscholar-key') &&
              !!window.LitLitSearch &&
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
                const est = window.LitAgentCore.estimateTokens;
                const plan = window.LitAgentContext.planCompaction(msgs, { estimate: est, thresholdTokens: 1000, preserveRecentTokens: 500 });
                if (!plan) return false;
                window.LitAgentContext.applyCompaction({ messages: msgs, turnId: 't' }, plan, '摘要', { estimate: est });
                const body = window.LitAgentCore.buildRequestBody({ messages: msgs, historyMessageCap: 40 }, {});
                return msgs.some(function (m) { return m.compacted === true; }) &&
                  body.messages.some(function (m) { return String(m.content || '').indexOf('摘要') !== -1; });
              })(),
            agentLitSearchToolsPresent: ['get_work', 'autocomplete_entity', 'backfill_abstracts', 'graph_neighbors', 'read_work_fulltext'].every(function (name) {
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
              document.querySelector('#agent-drawer').parentElement.classList.contains('detail-sidebar'),
            railSwitchWorks: (function () {
              try {
                const railAi = document.querySelector('#btn-agent');
                const railDetail = document.querySelector('#rail-detail');
                const railSearch = document.querySelector('#rail-search');
                const aiPane = document.querySelector('#agent-drawer');
                const detailPane = document.querySelector('#panel-detail');
                const manualPane = document.querySelector('#manual-panel');
                if (!railAi || !railDetail || !railSearch || !aiPane || !detailPane || !manualPane) return false;
                const visible = (node) => !!node.offsetParent && node.getBoundingClientRect().height > 0;
                railAi.click();
                const toAi = visible(aiPane) && !visible(detailPane) && !visible(manualPane) && railAi.classList.contains('active');
                railDetail.click();
                const toDetail = !visible(aiPane) && visible(detailPane) && !visible(manualPane) && railDetail.classList.contains('active');
                // 手动检索：独立栏位，无需任何 AI 配置即可用（含检索输入框）
                railSearch.click();
                const toManual = visible(manualPane) && !visible(aiPane) && railSearch.classList.contains('active') &&
                  !!manualPane.querySelector('input');
                railDetail.click();
                return toAi && toDetail && toManual;
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
                    metadata: { custom: { turnId: 't1' } }
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
                    metadata: { custom: { turnId: 't1' } }
                  }
                ];
                window.LitAgentChat.mount(probe, {
                  getSnapshot: function () { return { messages: messages, isRunning: false }; },
                  subscribe: function (cb) {
                    setTimeout(function () { cb({ messages: messages, isRunning: false }); }, 0);
                    return function () {};
                  },
                  T: function (s) { return s; },
                  sendSuggestion: function () {}, retry: function () {},
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
                    editBtn.click();
                    await new Promise(function (resolve) { setTimeout(resolve, 400); });
                    ok = !!probe.querySelector('.aui-edit-wrap textarea'); // 编辑框真的出现
                    const cancelBtn = probe.querySelector('.aui-edit-wrap .aui-send');
                    if (cancelBtn) { cancelBtn.click(); await new Promise(function (r) { setTimeout(r, 200); }); }
                  }
                }
                probe.remove();
                return ok;
              } catch (error) { return String(error && error.message || error); }
            })(),
            translationAutoTogglePresent: !!document.querySelector('#pdf-auto-translate') && !!document.querySelector('#sync-translator-auto'),
            journalRankUiPresent: !!document.querySelector('#d-journal-rank') && !!document.querySelector('#d-journal-rank-refresh'),
            journalRankColumnPresent: !!document.querySelector('.col-rank[data-sort="journalRank"]'),
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
            pdfAnnotationUiPresent: !!document.querySelector('#pdf-annotations') && !!document.querySelector('#pdf-add-highlight') &&
              !!document.querySelector('#pdf-add-underline') && !!document.querySelector('#pdf-add-note'),
            pdfDownloadButtonPresent: !!document.querySelector('#d-fetch-pdf'),
            // 拖放落点：全局拖入提示胶囊 + 统计仪表盘导入落区（条目行落点是运行时行为无静态标记）
            importDropZonesPresent: !!document.querySelector('#drag-hint-pill') &&
              !!document.querySelector('#stats-drop-hint'),
            pdfAutoDownloadUiPresent: !!document.querySelector('#sync-pdf-download-dir') &&
              !!document.querySelector('#sync-pdf-download-dir-choose') && !!document.querySelector('#sync-pdf-download-dir-clear'),
            pdfSearchUiPresent: !!document.querySelector('#pdf-search') && !!document.querySelector('#btn-ft') &&
              !!document.querySelector('#ft-status') && !!window.LitPdfSearch,
            pdfSearchTogglePresent: !!document.querySelector('#pdf-search-toggle'),
            issuesCenterPresent: !!document.querySelector('#btn-issues') && !!document.querySelector('#issues-menu') &&
              !!document.querySelector('#issues-list'),
            onboardPresent: !!document.querySelector('#onboard-steps') && !!document.querySelector('#onboard-import') &&
              !!document.querySelector('#onboard-skip') && !!document.querySelector('#onboard-short'),
            pdfNavigationUiPresent: !!document.querySelector('#pdf-page-number') && !!document.querySelector('#pdf-search') &&
              !!document.querySelector('#pdf-fit-width') && !!document.querySelector('#pdf-rotate'),
            paginationPresent: !!document.querySelector('#table-pagination'),
            sqliteStorageReady: !!window.litboardSqliteReady,
            trashNavPresent: !!document.querySelector('[data-folder="trash"]'),
            savedSearchUiPresent: !!document.querySelector('#saved-search-list') && !!document.querySelector('#btn-save-search'),
            tagManagePresent: !!document.querySelector('#btn-manage-tags') && !!document.querySelector('#tags-mask'),
            cslUiPresent: !!document.querySelector('#cite-csl-style') && !!window.LitCsl,
            syncIndicatorPresent: !!document.querySelector('#sync-indicator'),
            bridgeUiPresent: !!document.querySelector('#sync-bridge-enabled'),
            pdfReaderExtrasPresent: !!document.querySelector('#pdf-tabs') && !!document.querySelector('#pdf-side') &&
              !!document.querySelector('#pdf-snapshot-toggle') && !!document.querySelector('#pdf-ink-toggle') &&
              !!document.querySelector('#pdf-write-back') && !!document.querySelector('#pdf-ocr-banner'),
            pdfTopTabsPresent: !!document.querySelector('#pdf-tabs .pdf-tab .pdf-tab-title') &&
              Array.prototype.some.call(document.querySelectorAll('#pdf-tabs .pdf-tab-title'), function (el) {
                return el.textContent.indexOf('资料库') !== -1;
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
              !!document.querySelector('#qb-rows') && !!document.querySelector('#qb-apply'),
            // 检索引擎脚本本体必须已加载：index.html 曾漏掉 js/query.js 的 script 标签，
            // 导致全部 field:value / missing: / 智能文件夹 AST 语法静默退化为子串搜索
            queryEnginePresent: typeof window.LitQuery === 'object' && !!window.LitQuery &&
              typeof window.LitQuery.parseAst === 'function' && typeof window.LitQuery.compile === 'function',
            bulkEditPresent: !!document.querySelector('#bulk-edit-mask') &&
              !!document.querySelector('#bulk-edit-field') && !!document.querySelector('#bulk-edit-confirm'),
            undoPresent: !!document.querySelector('#btn-undo') && !!document.querySelector('#btn-redo'),
            backupUiPresent: !!document.querySelector('#sync-backup-dir') &&
              !!document.querySelector('#sync-backup-now') && !!document.querySelector('#sync-backup-restore') &&
              !!document.querySelector('#sync-backup-open') && !!document.querySelector('#sync-backup-status') &&
              !!document.querySelector('#sync-backup-keep') && !!document.querySelector('#sync-backup-keep-apply') &&
              !!document.querySelector('#sync-backup-cleanup'),
            backupApiPresent: !!window.litboardDesktop.getBackupStatus &&
 !!window.litboardDesktop.chooseBackupDir && !!window.litboardDesktop.backupNow &&
 !!window.litboardDesktop.setBackupKeep &&
 !!window.litboardDesktop.scanBackupLeftovers && !!window.litboardDesktop.cleanBackupLeftovers &&
 !!window.litboardDesktop.restoreBackup && !!window.litboardDesktop.replaceLibrary
          };
          document.querySelector('#btn-new-folder').click();
          result.folderCreateOpens = !document.querySelector('#folder-create-form').hidden;
          document.querySelector('#folder-create-cancel').click();
          // 弹窗栈：嵌套打开时后开者必须盖住先开者（设置 → Zotero 导入向导），与 DOM 顺序无关
          const zIndexOf = function (el) { return Number(getComputedStyle(el).zIndex) || 0; };
          const settle = function () { return new Promise(function (resolve) { requestAnimationFrame(resolve); }); };
          document.querySelector('#btn-sync').click();
          await settle();
          const settingsMask = document.querySelector('#sync-mask');
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
            result.workerSrc = pdfjsLib.GlobalWorkerOptions.workerSrc || '';
            const container = document.createElement('div');
            if (shotWanted) {
              container.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#777;overflow:auto;padding:24px;';
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
                renderer: canvas ? canvas.dataset.renderer || 'pdfjs' : '',
                opaqueCanvas: canvas ? canvas.getContext('2d').getContextAttributes().alpha === false : false,
                renderingProfile: window.LitPdf.renderingProfile,
                textLayer: !!container.querySelector('.pdf-text-layer'),
                annotationLayer: !!container.querySelector('.pdf-annotation-mark')
              };
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
              result.pdfResourceRequests = pdfResourceRequests;
            } catch (error) {
              result.pdfRender = { error: String(error && error.message || error) };
            }
          } else {
            await new Promise(function (resolve) { setTimeout(resolve, 300); });
          }
          // 顶栏「设置」必须挂在明面上：语言切换在 设置 → 偏好，而设置本身此前只藏在「···」溢出菜单里，
          // 等于双语界面根本没有可见入口（同 Word/扩展面板当年被投诉「看不到」的坑）
          const settingsBtn = document.querySelector('#btn-sync');
          const settingsRect = settingsBtn && settingsBtn.getBoundingClientRect();
          result.settingsEntryInTopbar = !!settingsBtn && !settingsBtn.hidden &&
            settingsBtn.closest('.menu') === null && !!settingsBtn.closest('.topbar') &&
            !!settingsRect && settingsRect.width > 0 && settingsRect.height > 0;
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
            (railSeedRow.querySelector('td') || railSeedRow).click();
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
        mainWindow.setContentSize(sizeBefore[0], sizeBefore[1]);
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
          result.pdfRender.pixelRatio >= 2 && result.pdfRender.renderer === SMOKE_EXPECT_RENDERER && result.pdfRender.opaqueCanvas &&
          result.pdfRender.textLayer && result.pdfRender.annotationLayer &&
          result.pdfRender.relayout && result.pdfRender.relayoutOk &&
          result.pdfRender.renderingProfile && result.pdfRender.renderingProfile.disableFontFace === false &&
          result.pdfRender.renderingProfile.useSystemFonts === false && result.pdfRender.renderingProfile.isEvalSupported === false);
        const passed = result.desktopBridge && result.modelLoaded && result.tablePresent && result.pdfColumnPresent &&
           result.markdownLoaded && result.syncUiPresent && result.syncNavGroups === 4 && result.nutstoreTestPresent && result.nutstoreFolderPresent &&
           result.remoteRecoveryUiPresent && result.remoteRecoveryApiPresent && result.remotePlanProgressPresent &&
           result.autoSyncTogglePresent &&
          result.dataPathUiPresent && result.dataPathApiPresent && result.dataPathApiWorks && result.dataPathTypable &&
          result.inlineTestStatusPresent && result.nestedFolderUiPresent &&
          result.pdfJsLoaded && result.pdfLayoutTogglePresent && result.translationUiPresent && result.journalRankUiPresent &&
          result.agentDrawerPresent && result.agentApiPresent && result.agentCoreLoaded &&
          result.agentPhase2Present && result.agentGraphPresent && result.agentWebSearchPresent &&
          result.agentReaderPresent && result.agentFindLiteraturePresent &&
          result.agentChatRendered === true && result.rightRailPresent && result.railSwitchWorks === true &&
          result.journalRankColumnPresent && result.rankRefreshTogglePresent &&
          result.scigreatTestPresent && result.easyscholarTestPresent && result.pdfAnnotationUiPresent &&
          result.pdfDownloadButtonPresent && result.importDropZonesPresent &&
          result.pdfSearchUiPresent && result.pdfSearchTogglePresent && result.issuesCenterPresent && result.onboardPresent &&
          result.pdfNavigationUiPresent && result.paginationPresent &&
          result.paginationWorks && result.folderCreateOpens && result.renderedRows <= 100 && result.sqliteStorageReady &&
          result.trashNavPresent && result.savedSearchUiPresent && result.tagManagePresent && result.cslUiPresent &&
          result.syncIndicatorPresent && result.bridgeUiPresent && result.pdfReaderExtrasPresent &&
          result.pdfTopTabsPresent && result.titlebarControlsPresent && result.dialogUiPresent && result.zoteroWizardPresent &&
          result.docxExportPresent && result.readerNotePanelPresent && result.epubReaderPresent && result.noteEditorPresent && result.resultViewPresent && result.wordSectionPresent && result.integrationPanelsPresent && result.queryBuilderPresent && result.bulkEditPresent && result.undoPresent &&
          result.queryEnginePresent &&
          result.nestedModalStacking &&
          result.settingsEntryInTopbar && result.railSeedRow && result.railPaneSwitchesToDetail &&
          result.topbarNarrow && result.topbarNarrow.noWrap === true && result.topbarNarrow.topSpread <= 3 &&
          result.topbarNarrow.overflow <= 1 && result.topbarNarrow.innerWidth <= 1090 &&
          result.backupUiPresent && result.backupApiPresent &&
          result.saveLibraryWorks && result.cslVendorRender && result.quitAckWorks && result.closeRequestAckWorks && pdfPassed;
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
    if (quitApproved || forceQuitNext) return;
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

let bibExportTimer = null;
/** 自动同步导出 .bib（Overleaf / Typst 工作流）：保存后防抖 2s 全量重写目标文件 */
function scheduleBibExport() {
  if (!integrations) return;
  clearTimeout(bibExportTimer);
  bibExportTimer = setTimeout(async function () {
    try {
      const config = await integrations.getConfig();
      if (!config.bibExportPath) return;
      const state = await libraryDb.loadState();
      const live = state.papers.filter(function (p) { return !p.deletedAt; });
      const content = live.map(LitBib.paperToBibtex).join('\n\n') + '\n';
      const temp = config.bibExportPath + '.littmp';
      await fs.writeFile(temp, content, 'utf8');
      await fs.rm(config.bibExportPath, { force: true });
      await fs.rename(temp, config.bibExportPath);
    } catch (error) {
      console.error('LitBoard auto .bib export failed:', error);
    }
  }, 2000);
}

/* AI 会话根目录：设置键 agentSessionRoot（默认 文档\LitBoard）下的 会话记录/ 子树。
 * 会话是用户长期成果——不落配置目录（不随数据目录迁移），用户可自选任意位置。 */
function agentSessionsRoot() {
  let root = '';
  try { root = String(libraryDb && libraryDb.getSetting('agentSessionRoot') || '').trim(); } catch (error) {}
  if (!root || !path.isAbsolute(root)) root = path.join(app.getPath('documents'), 'LitBoard');
  return path.join(root, '会话记录');
}

/* 自动摘要回填（M9-6：替代设置页手动按钮）：检索入库 / 导入完成后，对本批缺摘要且有
 * DOI 的条目后台跑 Crossref → Elsevier（同一节流队列与配额记账护栏），单批 ≤25 条。
 * fire-and-forget：不阻塞检索返回；失败仅记启动日志，缺摘要条目下次检索仍会被选中。 */
function scheduleAutoBackfill(rows) {
  if (!researchDb || !researchNet || !Array.isArray(rows)) return;
  const list = rows
    .filter(function (r) { return r && r.id && r.doi && !(r.abstract && r.abstract.length); })
    .slice(0, 25)
    .map(function (r) { return { id: r.id, doi: r.doi }; });
  if (!list.length) return;
  researchNet.backfillAbstracts(list, {}).then(function (result) {
    (result.results || []).forEach(function (row) {
      if (row.abstract) researchDb.updateWorkText(row.id, { abstract: row.abstract }, row.source);
    });
    startupLog('auto-backfill: ' + (result.updated || 0) + '/' + list.length +
      (result.stopped ? ' (rate-limited, will resume next round)' : ''));
  }).catch(function (error) {
    startupLog('auto-backfill failed: ' + (error && error.message || error));
  });
}

function registerIpc() {
  /* M2 IPC 加固：统一校验调用来源——只接受主窗口顶层 frame 的调用。
   * 渲染层进程被攻破时，子 frame / 伪造 sender 无法直接触达文件与数据库通道。
   * （sandbox+contextIsolation 已开启；这里补的是纵深防御。） */
  function isTrustedSender(event) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (event.sender !== mainWindow.webContents) return false;
    const frame = event.senderFrame;
    if (frame && frame.parent) return false; // 拒绝子 iframe
    return true;
  }
  function handle(channel, fn) {
    ipcMain.handle(channel, function (event, ...args) {
      if (!isTrustedSender(event)) throw new Error(T('LitBoard: 非受信调用来源（') + channel + '）');
      return fn(event, ...args);
    });
  }

  // 无边框窗口的自绘窗口控制
  handle('window:minimize', function () { if (mainWindow) mainWindow.minimize(); });
  handle('window:toggle-maximize', function () {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  handle('window:close', function () { if (mainWindow) mainWindow.close(); });
  handle('window:is-maximized', function () {
    return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized());
  });

  // Word 桥（COM 自动化）：渲染层经 word:invoke 下发协议命令，主进程转发 cscript 常驻进程
  const wordScriptCandidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'word', 'wordbridge.js'),
    path.join(__dirname, '..', 'word', 'wordbridge.js'),
    path.join(process.resourcesPath || '', 'word', 'wordbridge.js')
  ];
  const wordScriptPath = wordScriptCandidates.find(function (candidate) {
    try { return require('node:fs').existsSync(candidate); } catch (error) { return false; }
  }) || wordScriptCandidates[1];
  const wordBridge = createWordBridge({ scriptPath: wordScriptPath });
  wordBridgeInstance = wordBridge;
  handle('word:invoke', function (_event, value) {
    const input = value && typeof value === 'object' ? value : { line: String(value || '') };
    const line = String(input.line || '');
    const command = String(input.command || '').toUpperCase();
    if (line && !/^[A-Z]+(?:\|.*)?$/.test(line)) throw new Error(T('无效的 Word 命令'));
    if (!line && !/^[A-Z][A-Z0-9_-]*$/.test(command)) throw new Error(T('无效的 Word 命令'));
    return wordBridge.invoke(input, Number(input.timeout) || 30000);
  });
  handle('word:zotero-convert-read', async function (_event, filePath) {
    const fs = require('node:fs/promises');
    const LitDocx = require('../js/docx.js');
    const bytes = new Uint8Array(await fs.readFile(String(filePath || '')));
    return (LitDocx.readDocxFieldsAll || LitDocx.readDocxFields)(bytes);
  });
  handle('word:zotero-convert-write', async function (_event, value) {
    const fs = require('node:fs/promises');
    const LitDocx = require('../js/docx.js');
    const sourceInput = String(value && value.source || '');
    const targetInput = String(value && value.target || '');
    if (!sourceInput || !targetInput) throw new Error(T('必须提供源文件和目标文件'));
    const source = path.resolve(sourceInput);
    const target = path.resolve(targetInput);
    if (source.toLowerCase() === target.toLowerCase()) throw new Error(T('源文件与目标文件必须不同'));
    try {
      await fs.access(target);
      throw new Error(T('目标文件已存在，为避免覆盖未执行转换'));
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
    const bytes = new Uint8Array(await fs.readFile(source));
    const entries = LitDocx.zipRead(bytes);
    const docEntry = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
    if (!docEntry) throw new Error(T('docx 缺少 word/document.xml'));
    const fields = value.fields || [];
    const out = entries.map(function (e) {
      if (['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'].indexOf(e.name) === -1) {
        return { name: e.name, data: e.data };
      }
      const xml = Buffer.from(e.data).toString('utf8');
      const partFields = fields.filter(function (field) { return !field.part || field.part === e.name; });
      return { name: e.name, data: LitDocx.convertZoteroDocxXml(xml, partFields) };
    });
    const temp = target + '.litboard-tmp-' + process.pid + '-' + Date.now();
    try {
      await fs.writeFile(temp, Buffer.from(LitDocx.zipStore(out)));
      const verified = new Uint8Array(await fs.readFile(temp));
      if (!LitDocx.zipRead(verified).some(function (entry) { return entry.name === 'word/document.xml'; })) {
        throw new Error(T('转换结果缺少 word/document.xml'));
      }
      await fs.rename(temp, target);
      return { ok: true, target: target };
    } finally {
      await fs.rm(temp, { force: true }).catch(function () {});
    }
  });
  handle('library:load', function () { return libraryDb.loadState(); });
  // 阅读时间轻量落盘（不参与内容 hash，不触发同步脏写）
  handle('library:record-read', function (_event, value) {
    return libraryDb.recordReadAt(String(value && value.paperId || ''), Number(value && value.at) || Date.now());
  });
  // 实体级保存协议：payload = { workspace, baseSignatures }；旧调用（直接传 workspace）自动兼容
  handle('library:save', function (_event, value) {
    const payload = value && value.workspace && typeof value.workspace === 'object'
      ? value : { workspace: value || {} };
    const result = libraryDb.saveState(Object.assign({}, payload.workspace, {
      baseSignatures: payload.baseSignatures || null
    }));
    lastLibraryWriteAt = Date.now();
    scheduleBibExport();
    return result;
  });
  // 整库替换（仅供 JSON 整库恢复等显式场景）
  handle('library:replace', function (_event, value) {
    const result = libraryDb.replaceState(value || {});
    scheduleBibExport();
    return result;
  });
  handle('settings:get', function (_event, key) { return libraryDb.getSetting(key); });
  handle('settings:set', function (_event, payload) {
    // uiLang 变化时让主进程的原生对话框立即跟随（不落 localStorage，仅内存）
    if (payload && payload.key === 'uiLang') {
      LitI18n.setLang(String(payload.value || ''), { persist: false });
    }
    return libraryDb.setSetting(payload && payload.key, payload && payload.value);
  });
  handle('backup:status', function () { return backupManager.status(); });
  handle('backup:choose-dir', async function () {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: T('选择 LitBoard 完整备份目录（独立于配置与文献库目录，建议放 OneDrive 或外接盘）'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const directory = result.filePaths[0];
    try {
      dataPathManager.stageBackupDir(directory);
      dataPathState = dataPathManager.getState();
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
    // 已有快照目录只读挂载，不先写入空库快照，避免首次恢复触发轮换删除历史版本。
    const existing = await backupManager.listSnapshots(directory);
    const backup = existing.some(function (item) { return item.valid; })
      ? { ok: false, skipped: true, existing: true }
      : await backupManager.createSnapshot();
    return { backupDir: directory, backup: backup };
  });
  handle('backup:run', function () { return backupManager.createSnapshot(); });
  handle('backup:set-keep', function (_event, value) {
    try {
      dataPathState = dataPathManager.stageBackupKeep(value);
      return { ok: true, keepSnapshots: dataPathState.backupKeep };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  // 遗留文件清理：扫描只读，清理只删扫描列出的东西（详见 backup.js 的 scanLeftovers 注释）
  handle('backup:scan-leftovers', function () { return backupManager.scanLeftovers(); });
  handle('backup:clean-leftovers', function () { return backupManager.cleanLeftovers(); });
  handle('backup:restore', async function (_event, snapshotId) {
    // 手动恢复：先以当前库成功创建紧急快照，再校验所选快照、还原并重启应用
    // 紧急快照不参与本次轮换，确保用户选择的旧快照不会在恢复前被删掉。
    const emergency = await backupManager.createSnapshot(null, { skipRotation: true, skipIfUnchanged: false });
    if (!emergency.ok) {
      return { ok: false, error: T('恢复前必须能成功创建当前库的紧急快照：') + (emergency.error || T('备份目录不可用')) };
    }
    const state = dataPathManager.getState();
    if (!state || !state.backupDir) return { ok: false, error: T('尚未配置备份目录') };
    await libraryDb.close();
    const restored = await backupManager.restoreSnapshot({
      snapshotId: String(snapshotId || ''), quarantineTag: 'before-restore'
    });
    if (!restored.ok) {
      const dbPath = libraryDb && libraryDb.paths && libraryDb.paths.file;
      let originalPresent = false;
      try { await fs.access(dbPath); originalPresent = true; } catch (error) {}
      if (originalPresent) {
        try { await libraryDb.open(); }
        catch (error) {
          setImmediate(function () { app.exit(1); });
          return { ok: false, error: restored.error + T('；原库重新打开失败：') + String(error && error.message || error) };
        }
      }
      if (!originalPresent) setImmediate(function () { app.exit(1); });
      return { ok: false, error: restored.error + (originalPresent ? '' : T('；原库文件不存在，已停止继续打开空库')) };
    }
    // 数据库已切换到历史状态，旧的远端基线不再可信；下次同步必须重新建立基线。
    await fs.rm(path.join(dataPathState.configDir, 'sync-base.json'), { force: true }).catch(function () {});
    // 还原成功：重启应用，让渲染层从新库重新加载（跳过关闭收尾：数据库已切换）
    setImmediate(function () {
      forceQuitNext = true;
      app.relaunch();
      app.quit();
    });
    return { ok: true, snapshotId: restored.snapshotId, assets: restored.assets };
  });
  handle('backup:open-dir', async function () {
    const state = dataPathManager.getState();
    if (!state || !state.backupDir) return T('尚未配置备份目录');
    return shell.openPath(state.backupDir);
  });
  handle('data-paths:get', function () {
    return dataPathManager.getState();
  });
  handle('data-paths:stage', function (_event, value) {
    const result = dataPathManager.stage(value || {});
    dataPathState = dataPathManager.getState();
    return result;
  });
  handle('app:relaunch', function () {
    const current = dataPathManager.getState();
    if (!current.restartRequired) return false;
    setImmediate(function () {
      forceQuitNext = true; // 数据目录切换重启：跳过渲染层保存收尾
      app.relaunch();
      app.quit();
    });
    return true;
  });
  handle('bridge:status', async function () {
    const status = bridgeServer ? bridgeServer.status() : { running: false, port: null };
    return {
      running: status.running,
      port: status.port,
      token: bridgeServer ? await bridgeServer.getToken() : ''
    };
  });
  handle('bridge:set-enabled', async function (_event, enabled) {
    await libraryDb.setSetting('bridgeEnabled', !!enabled);
    if (!bridgeServer) return { running: false };
    if (enabled) await bridgeServer.start();
    else await bridgeServer.stop();
    return bridgeServer.status();
  });
  handle('bridge:set-current-folder', function (_event, folderId) {
    if (bridgeServer) bridgeServer.setCurrentFolder(folderId);
  });
  handle('integrations:get-config', function () { return integrations.getConfig(); });
  handle('integrations:save-config', function (_event, value) { return integrations.saveConfig(value || {}); });
  async function getPortableSyncSettings() {
    const keys = ['trashRetentionDays', 'autoWriteBack', 'renameTemplate', 'proxyPrefix'];
    const settings = {};
    for (const key of keys) {
      const value = await libraryDb.getSetting(key);
      if (value !== null && value !== undefined) settings[key] = value;
    }
    return settings;
  }
  async function applyPortableSyncSettings(config) {
    if (!config || typeof config !== 'object') return;
    const values = {
      trashRetentionDays: config.trashRetentionDays,
      autoWriteBack: config.autoWriteBack
    };
    for (const key of Object.keys(values)) {
      if (values[key] !== null && values[key] !== undefined) await libraryDb.setSetting(key, values[key]);
    }
  }
  handle('integrations:sync-nutstore', async function (_event, value) {
    const input = value || {};
    const workspace = input && input.workspace && typeof input.workspace === 'object' ? input.workspace : input;
    syncInFlight = true;
    let result = null;
    try {
      result = await integrations.nutstoreSync(Object.assign({}, workspace, {
        portableSettings: await getPortableSyncSettings()
      }));
    } finally {
      syncInFlight = false;
    }
    await applyPortableSyncSettings(result && result.config);
    return result;
  });
  handle('integrations:inspect-nutstore', function (_event, value) {
    if (!integrations.inspectNutstoreRemote) throw new Error(T('当前版本不支持远端检查'));
    return integrations.inspectNutstoreRemote(value || {});
  });
  handle('integrations:create-sync-plan', async function (_event, value) {
    if (!integrations.createNutstoreSyncPlan) throw new Error(T('当前版本不支持远端同步计划'));
    return integrations.createNutstoreSyncPlan(Object.assign({}, value || {}, { portableSettings: await getPortableSyncSettings() }));
  });
  handle('integrations:apply-sync-plan', function (_event, value) {
    if (!integrations.applyNutstoreSyncPlan) throw new Error(T('当前版本不支持应用远端同步计划'));
    return integrations.applyNutstoreSyncPlan(value || {}).then(async function (result) {
      await applyPortableSyncSettings(result && result.config);
      return result;
    });
  });
  handle('integrations:pull-config', function (_event, value) {
    if (!integrations.pullNutstoreConfig) throw new Error(T('当前版本不支持远端配置恢复'));
    return integrations.pullNutstoreConfig(value || {}).then(async function (result) {
      await applyPortableSyncSettings(result && result.config);
      return result;
    });
  });
  handle('integrations:test-nutstore', function (_event, value) { return integrations.testNutstoreConnection(value || {}); });
  handle('integrations:translate', function (_event, value) { return integrations.translateText(value || {}); });
  handle('integrations:test-translation', function (_event, value) { return integrations.testTranslationConnection(value || {}); });
  handle('integrations:scigreat-rank', function (_event, value) { return integrations.getJournalRank(value || {}); });
  handle('integrations:test-scigreat', function (_event, value) { return integrations.testJournalRankConnection(value || {}); });
  handle('integrations:detect-zotero', function () { return integrations.detectZoteroDataDir(); });
  handle('integrations:choose-zotero', async function () {
    const result = await dialog.showOpenDialog(mainWindow, { title: T('选择 Zotero 数据目录'), properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return '';
    return integrations.setZoteroDataDir(result.filePaths[0]);
  });
  handle('integrations:import-zotero-local', function () { return integrations.importZoteroLocal(); });
  handle('integrations:scan-zotero', function (_event, value) { return integrations.scanZoteroLibrary(value || {}); });
  handle('integrations:import-zotero', function (_event, value) { return integrations.importZoteroLibrary(value || {}); });
  handle('integrations:migrate-zotero-cloud', function (_event, value) {
    return integrations.migrateZoteroCloudAttachments(value || {});
  });

  function decodeImportText(bytes) {
    const buffer = Buffer.from(bytes || []);
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      const swapped = Buffer.alloc(Math.max(0, buffer.length - 2));
      for (let i = 2; i + 1 < buffer.length; i += 2) {
        swapped[i - 2] = buffer[i + 1];
        swapped[i - 1] = buffer[i];
      }
      return swapped.toString('utf16le');
    }
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return buffer.subarray(3).toString('utf8');
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }

  handle('files:choose-import', async function () {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: T('导入文献'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: T('支持的文献文件'), extensions: ['bib', 'bibtex', 'txt', 'json', 'ris', 'xml', 'pdf'] },
        { name: T('所有文件'), extensions: ['*'] }
      ]
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async function (filePath) {
      const ext = path.extname(filePath).toLowerCase();
      const item = { name: path.basename(filePath), path: filePath, extension: ext };
      try {
        if (ext !== '.pdf') item.text = decodeImportText(await fs.readFile(filePath));
      } catch (error) {
        item.error = String(error && error.message || error);
      }
      return item;
    }));
  });

  handle('files:save', async function (_event, options) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: T('导出 LitBoard 数据'),
      defaultPath: options && options.name ? options.name : 'litboard-export.txt',
      filters: options && Array.isArray(options.filters) ? options.filters : undefined
    });
    if (result.canceled || !result.filePath) return false;
    // 二进制导出（docx 等）走 bytes；文本走 content
    if (options && options.bytes && options.bytes.length) await fs.writeFile(result.filePath, Buffer.from(options.bytes));
    else await fs.writeFile(result.filePath, String(options.content || ''), 'utf8');
    return true;
  });

  handle('files:open-path', async function (_event, filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return T('无效的文件路径');
    return shell.openPath(filePath);
  });
  // 在系统文件管理器中定位（并选中）文件：Zotero「Show File」式
  handle('files:reveal', async function (_event, filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return T('无效的文件路径');
    try {
      await fs.access(filePath);
    } catch (error) {
      return T('文件不存在：') + filePath;
    }
    shell.showItemInFolder(filePath);
    return '';
  });
  handle('files:read-bytes', async function (_event, filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error(T('无效的文件路径'));
    // 目录 → 找快照主入口（Zotero 快照是目录型附件，入口为 index.html；F12）
    filePath = await resolveSnapshotEntry(filePath);
    return new Uint8Array(await fs.readFile(filePath));
  });
  handle('clipboard:write', function (_event, value) {
    clipboard.writeText(String(value || ''));
    return true;
  });

  handle('files:choose-directory', async function (_event, options) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options && options.title ? String(options.title) : T('选择目录'),
      defaultPath: options && options.defaultPath && path.isAbsolute(String(options.defaultPath))
        ? String(options.defaultPath) : undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || !result.filePaths[0] ? '' : result.filePaths[0];
  });

  // 通用文件选择（添加附件用）
  handle('files:choose-files', async function (_event, options) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options && options.title ? String(options.title) : T('选择文件'),
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths.map(function (filePath) {
      return { name: path.basename(filePath), path: filePath, extension: path.extname(filePath).toLowerCase() };
    });
  });

  // 按模板重命名附件：同目录改名，冲突自动加 -2 后缀，不覆盖任何现有文件
  handle('files:rename', async function (_event, options) {
    try {
      const oldPath = String(options && options.path || '');
      const base = String(options && options.baseName || '').trim();
      let illegal = !base || base !== base.trim();
      for (let i = 0; i < base.length && !illegal; i++) {
        const code = base.charCodeAt(i);
        if (code < 0x20 || '\\/:*?"<>|'.indexOf(base[i]) !== -1) illegal = true;
      }
      if (!path.isAbsolute(oldPath) || illegal) return { error: T('无效的重命名请求') };
      const dir = path.dirname(oldPath);
      const ext = path.extname(oldPath);
      let target = path.join(dir, base + ext);
      if (path.resolve(target) === path.resolve(oldPath)) {
        return { path: oldPath, name: path.basename(oldPath), unchanged: true };
      }
      let counter = 2;
      while (true) {
        try {
          await fs.access(target);
          target = path.join(dir, base + '-' + counter + ext);
          counter++;
        } catch (error) { break; }
      }
      await fs.rename(oldPath, target);
      return { path: target, name: path.basename(target) };
    } catch (error) { return { error: String(error && error.message || error) }; }
  });

  // 批量导出 PDF：把 sources 逐个复制到目标目录，重名自动加 -2/-3 后缀，不覆盖现有文件
  handle('files:export-pdfs', async function (_event, options) {
    try {
      const dir = String(options && options.dir || '');
      const files = Array.isArray(options && options.files) ? options.files : [];
      if (!path.isAbsolute(dir)) return { error: T('无效的目标目录') };
      if (!files.length) return { copied: [], failed: [] };
      await fs.mkdir(dir, { recursive: true });
      const copied = [];
      const failed = [];
      for (const file of files) {
        const src = String(file && file.path || '');
        let base = String(file && file.name || '').trim();
        if (!base) base = 'paper';
        if (!/\.pdf$/i.test(base)) base += '.pdf';
        if (!path.isAbsolute(src)) { failed.push({ name: base, reason: T('无效源路径') }); continue; }
        try { await fs.access(src); } catch (error) { failed.push({ name: base, reason: T('源文件不存在') }); continue; }
        const ext = path.extname(base);
        const stem = base.slice(0, base.length - ext.length);
        let target = path.join(dir, base);
        let counter = 2;
        while (true) {
          try { await fs.access(target); target = path.join(dir, stem + '-' + counter + ext); counter++; }
          catch (error) { break; }
        }
        try {
          await fs.copyFile(src, target);
          copied.push({ name: path.basename(target) });
        } catch (error) {
          failed.push({ name: base, reason: String(error && error.message || error) });
        }
      }
      return { copied: copied, failed: failed };
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  });

  // 把导入的 PDF 拷进配置目录/synced-attachments，按该目录惯例命名（z + 8 位随机键），保留原文件
  handle('files:store-pdf', async function (_event, options) {
    try {
      const src = String(options && options.path || '');
      if (!path.isAbsolute(src)) return { error: T('无效的源文件路径') };
      try { await fs.access(src); } catch (error) { return { error: T('源文件不存在：') + src }; }
      const dir = path.join(dataPathState.configDir, 'synced-attachments');
      return await storeFileInto(dir, src, '.pdf');
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  });

  // 选择自动导出 .bib 的目标文件
  handle('files:choose-save-path', async function (_event, options) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options && options.title ? String(options.title) : T('选择文件'),
      defaultPath: options && options.name ? options.name : 'library.bib',
      filters: options && Array.isArray(options.filters) ? options.filters : undefined
    });
    return result.canceled || !result.filePath ? '' : result.filePath;
  });

  // 在线获取 CSL 样式（缓存到配置目录/csl-styles/）
  handle('csl:fetch-style', async function (_event, styleId) {
    const id = String(styleId || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) throw new Error(T('无效的样式名'));
    const dir = path.join(dataPathState.configDir, 'csl-styles');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, id + '.csl');
    try {
      return await fs.readFile(target, 'utf8');
    } catch (error) {}
    const response = await net.fetch('https://www.zotero.org/styles/' + encodeURIComponent(id));
    if (!response.ok) throw new Error(T('样式下载失败（') + response.status + '）');
    const text = await response.text();
    if (!/^\s*<\?xml[\s\S]*<style[\s>]/.test(text)) throw new Error(T('下载到的不是有效 CSL 样式'));
    await fs.writeFile(target, text, 'utf8');
    return text;
  });

  // 把修改后的 PDF 字节写回原文件（批注写回用；首次写前保留 .litbak 备份）
  handle('files:write-pdf', async function (_event, options) {
    const filePath = String(options && options.path || '');
    if (!path.isAbsolute(filePath) || !/\.pdf$/i.test(filePath)) return { error: T('无效的 PDF 路径') };
    const bytes = options && options.bytes;
    if (!bytes || !bytes.length) return { error: T('没有可写入的内容') };
    try {
      const backup = filePath + '.litbak';
      try {
        await fs.access(backup);
      } catch (error) {
        await fs.copyFile(filePath, backup); // 首次写回前留底
      }
      const temp = filePath + '.litwrite';
      await fs.writeFile(temp, Buffer.from(bytes));
      await fs.rm(filePath, { force: true });
      await fs.rename(temp, filePath);
      return { ok: true, backup: backup };
    } catch (error) {
      return { error: String(error && error.message || error) };
    }
  });

  // 批注截图等图片附件保存到配置目录/annotation-images/
  handle('files:save-annotation-image', async function (_event, options) {
    try {
      const name = String(options && options.name || '').replace(/[^A-Za-z0-9_-]/g, '');
      const dataUrl = String(options && options.dataUrl || '');
      const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (!name || !match) return { error: T('无效的图片数据') };
      const dir = path.join(dataPathState.configDir, 'annotation-images');
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, name + '.png');
      await fs.writeFile(target, Buffer.from(match[1], 'base64'));
      return { path: target };
    } catch (error) { return { error: String(error && error.message || error) }; }
  });

  // 笔记图片入库：复制/解码写入 <配置目录>/note-assets/<noteId>/（受管目录，登记过路径迁移/备份/同步）
  handle('files:store-note-image', async function (_event, options) {
    try {
      const noteId = String(options && options.noteId || '').replace(/[^A-Za-z0-9_-]/g, '');
      if (!noteId) return { error: T('无效的笔记 ID') };
      const dir = path.join(dataPathState.configDir, 'note-assets', noteId);
      await fs.mkdir(dir, { recursive: true });
      let buffer = null;
      let baseName = 'image';
      const dataUrl = String(options && options.dataUrl || '');
      if (dataUrl) {
        const match = dataUrl.match(/^data:image\/([a-z0-9+.-]+);base64,(.+)$/i);
        if (!match) return { error: T('无效的图片数据') };
        buffer = Buffer.from(match[2], 'base64');
        baseName = 'image.' + (/^svg/i.test(match[1]) ? 'svg' : match[1].replace(/\+/g, '.').replace(/[^a-z0-9.]/g, '') || 'png');
      } else {
        const src = String(options && options.path || '');
        if (!path.isAbsolute(src)) return { error: T('无效的源文件路径') };
        try { buffer = await fs.readFile(src); } catch (error) { return { error: T('源文件不存在：') + src }; }
        baseName = path.basename(src);
      }
      const safe = baseName.replace(/[\\/:*"<>\u0000-\u001f|-]/g, '_').slice(-80) || 'image.png';
      let target = path.join(dir, safe);
      let suffix = 0;
      while (true) {
        try { await fs.access(target); suffix++; target = path.join(dir, suffix + '-' + safe); }
        catch (error) { break; }
      }
      await fs.writeFile(target, buffer);
      const rel = 'note-assets/' + noteId + '/' + path.basename(target);
      return { path: target, rel: rel };
    } catch (error) { return { error: String(error && error.message || error) }; }
  });

  // PDF 全文索引（SQLite + FTS5 trigram；增量构建，随条目独立失效）
  // OCR 语言包：按需下载到配置目录/ocr（tessdata_fast，eng + chi_sim）
  const OCR_LANGS = {
    'eng.traineddata': 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/eng.traineddata',
    'chi_sim.traineddata': 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/chi_sim.traineddata'
  };
  handle('ocr:status', async function () {
    const dir = path.join(dataPathState.configDir, 'ocr');
    const missing = [];
    for (const name of Object.keys(OCR_LANGS)) {
      try { await fs.access(path.join(dir, name)); } catch (error) { missing.push(name); }
    }
    return { ready: missing.length === 0, dir: dir, missing: missing };
  });
  handle('ocr:ensure-data', async function (event) {
    const dir = path.join(dataPathState.configDir, 'ocr');
    await fs.mkdir(dir, { recursive: true });
    for (const name of Object.keys(OCR_LANGS)) {
      const target = path.join(dir, name);
      try { await fs.access(target); continue; } catch (error) {}
      const response = await net.fetch(OCR_LANGS[name]);
      if (!response.ok) throw new Error(T('语言包下载失败（') + response.status + '）');
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('ocr:data-progress', { name: name });
      }
    }
    return { ready: true, dir: dir };
  });

  handle('pdfsearch:get-pages', async function (_event, value) {
    const paperId = value && typeof value === 'object' ? value.paperId : value;
    const attachmentId = value && typeof value === 'object' ? value.attachmentId : '';
    const entry = await libraryDb.pdfTextGet(paperId, attachmentId);
    return entry ? entry.pages : null;
  });
  // AI 阅读助手：按页区间读取（每页封顶，避免大文档整篇过 IPC）
  handle('pdfsearch:get-page-range', async function (_event, value) {
    const input = value && typeof value === 'object' ? value : {};
    return libraryDb.pdfTextGetRange(input.paperId, input.attachmentId || '', input.from, input.to, input.capChars, input.fromChar);
  });
  handle('pdfsearch:meta', function () { return libraryDb.pdfTextMeta(); });
  handle('pdfsearch:put', function (_event, value) { return libraryDb.pdfTextPut(value || {}); });
  handle('pdfsearch:query', function (_event, query) { return libraryDb.pdfTextQuery(String(query || '')); });
  handle('pdfsearch:invalidate', function (_event, value) {
    if (value && typeof value === 'object') return libraryDb.pdfTextInvalidate(value.paperId, value.attachmentId);
    return libraryDb.pdfTextInvalidate(value);
  });
  handle('pdfsearch:clear', function () { return libraryDb.pdfTextClear(); });
  handle('pdfsearch:stats', function () { return libraryDb.pdfTextStats(); });

  // ===== 调研助手（一期）：调研库 / OpenAlex 检索 / LLM 流式 / 会话 =====
  handle('research:query', function (_event, input) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    return researchDb.queryWorks(input || {});
  });
  handle('research:get-works', function (_event, ids) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    return researchDb.getWorks(ids);
  });
  handle('research:stats', function () {
    return researchDb ? researchDb.stats() : { error: T('调研库未就绪') };
  });
  handle('research:search-openalex', async function (_event, input) {
    if (!researchDb || !researchNet) throw new Error(T('调研库未就绪'));
    const req = input || {};
    // mode='semantic' 走 OpenAlex 的 search.semantic（整段自然语言，1 req/s）
    const result = await researchNet.searchOpenAlex(req);
    const upserted = researchDb.upsertWorks(result.results);
    researchDb.recordSearch({ q: req.query, filters: { yearFrom: req.yearFrom, yearTo: req.yearTo, mode: result.mode }, count: result.count });
    scheduleAutoBackfill(result.results); // 本批缺摘要的新条目自动回填（后台，不阻塞返回）
    // 检索结果自动嵌入（向量模型就绪 + 构建器空闲）：走 maybeAutoBuild——
    // 失败批次有持久 failed 标记时不再自动发起（R14 计费红线），手动构建才会清除标记
    scheduleAutoEmbed();
    return {
      mode: result.mode,
      count: result.count,
      stored: upserted.count,
      works: result.results.slice(0, 50).map(function (row) {
        return {
          id: row.id, doi: row.doi, title: row.title, year: row.year,
          sourceName: row.sourceName, citedBy: row.citedBy, isOa: row.isOa,
          hasAbstract: !!(row.abstract && row.abstract.length)
        };
      })
    };
  });
  /* Scopus 检索（Elsevier Search API）：作为 OpenAlex 的互补发现源——Scopus 引用数、
   * 独立召回；结果按 DOI 归并进调研库（已存在→标注；OpenAlex 反查到 W-id→以 OpenAlex
   * 元数据入库；查不到→建 local: 身份兜底）。检索结果本身不含摘要（API 限制）。 */
  handle('research:search-scopus', async function (_event, input) {
    if (!researchDb || !researchNet) throw new Error(T('调研库未就绪'));
    const req = input || {};
    const result = await researchNet.searchScopus(req);
    const hits = result.hits || [];
    const byDoi = {};
    const missing = [];
    hits.forEach(function (hit) {
      if (hit.doi) {
        const existing = researchDb.findByExtId('doi', hit.doi);
        if (existing) byDoi[hit.doi] = existing;
        else missing.push(hit.doi);
      }
    });
    let resolved = [];
    if (missing.length) {
      try { resolved = await researchNet.fetchWorksByDois(missing); } catch (error) { /* 反查失败不阻断，走 local 兜底 */ }
    }
    const resolvedDoi = {};
    resolved.forEach(function (row) { if (row.doi) resolvedDoi[row.doi] = row; });
    if (resolved.length) researchDb.upsertWorks(resolved);
    // OpenAlex 也没有的（无 DOI 或反查未命中）：local 身份兜底，标题/来源/Scopus 引用数入库
    const locals = hits.filter(function (hit) {
      if (hit.doi && (byDoi[hit.doi] || resolvedDoi[hit.doi])) return false;
      return !!(hit.title);
    }).map(function (hit) {
      return {
        id: 'local:' + require('node:crypto').createHash('sha1').update(hit.eid || hit.doi || hit.title).digest('hex').slice(0, 12),
        doi: hit.doi || '', title: hit.title, year: hit.year,
        sourceName: hit.source, citedBy: hit.citedByScopus,
        isOa: false, authors: hit.authors, refs: []
      };
    });
    if (locals.length) researchDb.upsertWorks(locals);
    scheduleAutoBackfill(resolved.concat(locals)); // 本批缺摘要条目自动回填（后台）
    researchDb.recordSearch({ q: req.query, filters: { source: 'scopus', yearFrom: req.yearFrom, yearTo: req.yearTo }, count: result.count });
    return {
      count: result.count,
      stored: resolved.length + locals.length,
      works: hits.map(function (hit) {
        const workId = (hit.doi && (byDoi[hit.doi] || (resolvedDoi[hit.doi] && resolvedDoi[hit.doi].id))) ||
          (hit.title && 'local:' + require('node:crypto').createHash('sha1').update(hit.eid || hit.doi || hit.title).digest('hex').slice(0, 12)) || '';
        return {
          id: workId, doi: hit.doi, title: hit.title, year: hit.year,
          sourceName: hit.source, citedBy: hit.citedByScopus, isOa: false,
          existed: !!(hit.doi && byDoi[hit.doi]),
          hasAbstract: false
        };
      }).filter(function (w) { return w.id; })
    };
  });

  handle('research:import-harness', async function (event) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    let file = path.join(app.getPath('home'), '.AI-CACHE', 'openalex', 'library.db');
    try { require('node:fs').accessSync(file); } catch (error) {
      const picked = await dialog.showOpenDialog(mainWindow, {
        title: T('选择 literature-mcp 调研库文件（library.db）'),
        properties: ['openFile'],
        filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }]
      });
      if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
      file = picked.filePaths[0];
    }
    const result = await researchDb.importFromHarness(file, function (progress) {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('research:import-progress', progress);
      }
    });
    startupLog('research harness import done: ' + JSON.stringify(result));
    // 导入后的存量清扫：历史遗留缺摘要条目（含本次导入）也进自动回填（按引用数优先，≤25/批）
    scheduleAutoBackfill(researchDb.findWorksNeedingAbstract({ limit: 25 }));
    return result;
  });

  /* M9-5 多模态消息链：渲染层消息里的图像以**引用**形态传递（{type:'image', ref}），
   * 出网前在主进程解析成 OpenAI image_url data URL——渲染层不接触文件字节，会话 JSON
   * 只存引用不存 base64。ref 形态：session:<会话ID>|<附件相对路径>（会话附件）；
   * config:<configDir 下相对路径>（note-assets 等受管目录，拒绝越界）。解析失败丢弃该图，
   * 不打断请求。 */
  const IMAGE_MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  async function resolveImageRef(ref) {
    const raw = String(ref || '');
    let file = null;
    try {
      if (raw.indexOf('session:') === 0 && agentSessions) {
        const rest = raw.slice('session:'.length);
        const split = rest.indexOf('|');
        if (split > 0) file = await agentSessions.attachmentPath(rest.slice(0, split), rest.slice(split + 1));
      } else if (raw.indexOf('config:') === 0) {
        const rel = path.normalize(decodeURIComponent(raw.slice('config:'.length)));
        const abs = path.resolve(dataPathState.configDir, rel);
        const root = path.resolve(dataPathState.configDir);
        if (abs !== root && abs.indexOf(root + path.sep) === 0) file = abs;
      }
    } catch (error) { return null; }
    if (!file) return null;
    const mime = IMAGE_MIME_BY_EXT[path.extname(file).toLowerCase()];
    if (!mime) return null;
    try {
      const bytes = await fs.readFile(file);
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
      return { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + bytes.toString('base64') } };
    } catch (error) { return null; }
  }
  async function resolveBodyImages(body) {
    for (const message of (body && body.messages) || []) {
      if (message.role !== 'user' || !Array.isArray(message.content)) continue;
      const parts = [];
      for (const part of message.content) {
        if (part && part.type === 'text') parts.push({ type: 'text', text: String(part.text || '') });
        else if (part && part.type === 'image' && part.ref) {
          const resolved = await resolveImageRef(part.ref);
          if (resolved) parts.push(resolved);
        }
      }
      message.content = parts.length ? parts : partsFallbackText(message.content);
    }
  }
  function partsFallbackText(parts) {
    return (Array.isArray(parts) ? parts : []).map(function (part) {
      return part && typeof part.text === 'string' ? part.text : '';
    }).join('');
  }

  handle('agent:chat', async function (_event, input) {
    if (!agentNet) throw new Error(T('AI 助手未就绪'));
    await resolveBodyImages(input && input.body);
    return agentNet.chatStream(input);
  });
  /* Semantic Scholar 相关度检索（R16）：结果按 DOI/s2 标识归位后入库调研库，
   * 与 OpenAlex 互补（S2 的引用数与被引语境常与 OpenAlex 不同；OA PDF 直链来自 openAccessPdf）。 */
  handle('research:search-semanticscholar', async function (_event, input) {
    if (!researchDb || !researchNet) throw new Error(T('调研库未就绪'));
    const req = input || {};
    const result = await researchNet.searchSemanticScholar(req);
    const before = researchDb.getWorks((result.results || []).map(function (row) {
      return row.doi ? researchDb.findByExtId('doi', row.doi) : null;
    }).filter(Boolean));
    const existedIds = {};
    before.forEach(function (row) { existedIds[row.id] = true; });
    const candidates = ingestCandidates(result.results);
    const works = candidates.filter(Boolean).map(function (c) {
      return {
        id: c.workId, doi: c.doi, title: c.title, year: c.year,
        sourceName: c.sourceName, citedBy: c.citedBy, oaUrl: c.oaUrl,
        hasAbstract: !!c.abstract, existed: !!existedIds[c.workId]
      };
    });
    researchDb.recordSearch({ q: req.query, filters: { source: 'semanticscholar' }, count: works.length });
    return { count: result.total, stored: works.length, hasMore: result.hasMore, works: works };
  });
  /* 语义检索（库内相似文献，R16 入口一）：向量可用则走向量，否则**降级为关键词**——
   * 用户没配 embedding 时这个按钮不该变成摆设，只是召回质量如实降级并说明。
   * mode: 'auto'（默认）| 'vector' | 'keyword' */
  handle('research:semantic-search', async function (_event, input) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    const query = String(input && input.query || '').trim();
    if (!query) return { works: [], mode: 'empty', note: '' };
    const limit = Number(input && input.limit) || 20;
    const requested = String(input && input.mode || 'auto');
    const embedTarget = await embedService.resolveTarget();
    // 查询路径按需补齐（比照上游 literature-mcp 的 library_query + semantic_query）：最多 50 篇/次，
    // 让「刚检索入库、还没轮到空闲构建」的库这次就能走向量。失败标记存在时 topUp 自行跳过（不重试计费）。
    let topUp = null;
    if (embedTarget.ok && requested !== 'keyword' && researchEmbedder) {
      topUp = await researchEmbedder.topUp();
    }
    const vectorPossible = embedTarget.ok && Number(researchDb.stats().vectors) > 0;
    const useVector = requested === 'vector' ? vectorPossible : (requested === 'auto' && vectorPossible);
    if (!useVector) {
      // 关键词降级：LLM 无嵌入服务时的可用路径（不是「功能不可用」）
      const r = researchDb.queryWorks({ q: query, limit: limit, yearFrom: input && input.yearFrom, yearTo: input && input.yearTo });
      const rows = researchDb.getWorks((r.works || []).map(function (w) { return w.id; }));
      const topUpFailed = !!(topUp && topUp.skipped === 'failed');
      return {
        mode: requested === 'vector' ? 'vector_unavailable' : 'keyword',
        note: topUpFailed
          ? T('向量构建上次失败（待手动重试），本次已按关键词检索')
          : requested === 'vector'
            ? T('未配置嵌入模型或向量索引为空，无法按向量检索')
            : T('未配置嵌入模型或向量索引为空，已按关键词检索；配置后可用语义检索'),
        total: r.total,
        works: rows.map(function (w) {
          return {
            id: w.id, doi: w.doi, title: w.title, year: w.year, sourceName: w.sourceName,
            citedBy: w.citedBy, isOa: w.isOa, hasAbstract: !!w.abstract, abstract: w.abstract,
            snippet: w.snippet, score: 0
          };
        })
      };
    }
    const result = await embedService.embedTexts({ texts: [query] });
    const vec = new Float32Array(result.vectors[0]);
    // R13：检索只命中「同一嵌入模型 + 同一配方」的向量——等维不同模型的向量
    // 不是同一空间，混检会给出虚假的满分命中
    const hits = researchDb.cosineSearch(Buffer.from(vec.buffer), {
      limit: limit,
      yearFrom: input && input.yearFrom,
      yearTo: input && input.yearTo,
      model: result.model,
      recipe: LitResearch.EMBED_RECIPE
    });
    const works = researchDb.getWorks(hits.map(function (h) { return h.workId; }));
    const scoreOf = {};
    hits.forEach(function (h) { scoreOf[h.workId] = h.score; });
    return {
      mode: 'vector',
      note: '',
      works: works.map(function (w) {
        return {
          id: w.id, doi: w.doi, title: w.title, year: w.year, sourceName: w.sourceName,
          citedBy: w.citedBy, isOa: w.isOa, hasAbstract: !!w.abstract, abstract: w.abstract,
          snippet: w.snippet, score: scoreOf[w.id] || 0
        };
      })
    };
  });
  /* 摘要回填：OpenAlex 缺摘要 → Crossref → Elsevier abstract；字段级 provenance；429 记账停批 */
  handle('research:backfill', async function (event, input) {
    if (!researchDb || !researchNet) throw new Error(T('调研库未就绪'));
    const rows = researchDb.findWorksNeedingAbstract({ limit: Number(input && input.limit) || 100 });
    if (!rows.length) return { updated: 0, done: 0, total: 0, stopped: false, reason: '' };
    const result = await researchNet.backfillAbstracts(rows, {
      onProgress: function (p) {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('research:backfill-progress', p);
        }
      }
    });
    result.results.forEach(function (row) {
      if (row.abstract) researchDb.updateWorkText(row.id, { abstract: row.abstract }, row.source);
    });
    return result;
  });
  /* 向量嵌入：估价（确认框）/ 手动或空闲触发构建 / 用量 */
  handle('research:embed-estimate', function () {
    if (!researchEmbedder) throw new Error(T('向量嵌入未就绪'));
    return researchEmbedder.estimate();
  });
  handle('research:embed-build', function () {
    if (!researchEmbedder) throw new Error(T('向量嵌入未就绪'));
    return researchEmbedder.runBuild();
  });
  /* 向量模型连通性：沿用设置表单里尚未保存的值（与 AI 助手测试同约定） */
  handle('embed:test', function (_event, input) {
    if (!embedService) throw new Error(T('向量嵌入未就绪'));
    return embedService.test(input || {});
  });
  handle('research:embed-usage', function () {
    return embedService ? embedService.getUsage() : { requests: 0, tokens: 0 };
  });
  /* PDF 两步（用户确认后由 agent 工具触发）：
   * 第一步：OpenAlex oaUrl → 下载进当前会话附件目录并登记附件↔身份映射；
   * 第二步：会话附件复制进受管目录（storeFileInto），返回存储路径供渲染层建条目挂附件。 */
  handle('research:download-pdfs', async function (_event, input) {
    if (!researchDb || !agentSessions) throw new Error(T('会话存储未就绪'));
    const sessionId = String(input && input.sessionId || '');
    const workIds = (Array.isArray(input && input.workIds) ? input.workIds : []).map(String).slice(0, 20);
    if (!sessionId || !workIds.length) throw new Error(T('无效的下载请求'));
    const works = researchDb.getWorks(workIds);
    // 4 路并发下载（各自独立出版商域名，无共享限流）；落盘写经单一链串行化，
    // 规避 sanitize 后同名的两个标题在 saveAttachment 的存在性检查上竞态
    const out = new Array(works.length);
    let cursor = 0;
    let saveChain = Promise.resolve();
    const runDownload = async function () {
      while (cursor < works.length) {
        const i = cursor++;
        const work = works[i];
        if (!work.oaUrl) { out[i] = { workId: work.id, file: '', error: T('无开放获取链接') }; continue; }
        try {
          const response = await net.fetch(work.oaUrl, { headers: { Accept: 'application/pdf,*/*' } });
          if (!response.ok) { out[i] = { workId: work.id, file: '', error: T('下载失败（HTTP ') + response.status + '）' }; continue; }
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 1000 || bytes[0] !== 0x25) { out[i] = { workId: work.id, file: '', error: T('返回内容不是 PDF') }; continue; }
          const name = LitResearch.sanitizeFileStem(work.title || work.id, 60) + '.pdf';
          const saved = await (saveChain = saveChain.then(function () {
            return agentSessions.saveAttachment(sessionId, {
              name: name, label: work.title || work.id, dataBase64: bytes.toString('base64')
            });
          }));
          out[i] = { workId: work.id, file: saved.file, title: work.title };
        } catch (error) {
          out[i] = { workId: work.id, file: '', error: String(error && error.message || error) };
        }
      }
    };
    await Promise.all([runDownload(), runDownload(), runDownload(), runDownload()]);
    return { results: out };
  });
  handle('research:stage-pdfs', async function (_event, input) {
    if (!researchDb || !agentSessions) throw new Error(T('会话存储未就绪'));
    const sessionId = String(input && input.sessionId || '');
    const files = (Array.isArray(input && input.files) ? input.files : []).slice(0, 20);
    if (!sessionId || !files.length) throw new Error(T('无效的暂存请求'));
    const attachmentsDir = path.join(dataPathState.configDir, 'attachments');
    // 独立本地复制（storeFileInto 随机 z 键命名，无碰撞）：4 路并发，结果按输入序落位
    const out = new Array(files.length);
    let stageCursor = 0;
    const runStage = async function () {
      while (stageCursor < files.length) {
        const i = stageCursor++;
        const item = files[i];
        try {
          // R06：attachmentPath 是 async（读索引解析目录），必须 await——
          // 旧代码把 Promise 直接传给 storeFileInto，报「paths[0] must be string」
          const abs = await agentSessions.attachmentPath(sessionId, String(item.file || ''));
          const stored = await storeFileInto(attachmentsDir, abs, '.pdf');
          out[i] = { workId: String(item.workId || ''), fileName: stored.name, path: stored.path };
        } catch (error) {
          out[i] = { workId: String(item.workId || ''), fileName: '', path: '', error: String(error && error.message || error) };
        }
      }
    };
    await Promise.all([runStage(), runStage(), runStage(), runStage()]);
    return { results: out };
  });
  /* R19 临时全文链（对照 literature-mcp 的 fetch_fulltext，按用户决定走「仅文本参考」路线）：
   * agent 要方法学/实验细节时，下载 OA PDF 到临时目录 → 渲染层抽取文本 → 文本入调研库
   * （works_fulltext 侧表 + FTS，可检索可续读）→ 临时 PDF 立即删除。
   * 与 download_pdfs（保留 PDF 本体、写类确认门）互补：仅参考不留文件、不经确认门。 */
  const FULLTEXT_TMP = 'tmp-fulltext';
  handle('research:fulltext-read', async function (_event, input) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    const workId = String((input && input.workId) || '');
    if (!workId) throw new Error(T('缺少 workId'));
    // 已有全文（上次拉取的缓存）：直接给窗口，不再联网
    const cached = researchDb.getFulltextWindow(workId, input && input.fromChar, input && input.length);
    if (cached) return { cached: true, window: cached };
    const rows = researchDb.getWorks([workId]);
    const work = rows && rows[0];
    if (!work) throw new Error(T('未找到该调研文献：') + workId);
    if (!work.oaUrl) {
      return { cached: false, error: '该文献没有开放获取链接（oaUrl 为空），无法拉取全文；请改用摘要证据或让用户以其他途径获取原文' };
    }
    const response = await net.fetch(work.oaUrl, { headers: { Accept: 'application/pdf,*/*' } });
    if (!response.ok) return { cached: false, error: '全文下载失败（HTTP ' + response.status + '）' };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 80 * 1024 * 1024) return { cached: false, error: 'PDF 过大（>80MB），已跳过' };
    if (bytes.length < 1000 || bytes[0] !== 0x25) return { cached: false, error: '返回内容不是 PDF（OA 链接可能指向落地页）' };
    const dir = path.join(dataPathState.configDir, FULLTEXT_TMP);
    await fs.mkdir(dir, { recursive: true });
    const safeId = workId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    const tempPath = path.join(dir, safeId + '-' + Date.now() + '-' + require('node:crypto').randomBytes(4).toString('hex') + '.pdf');
    await fs.writeFile(tempPath, bytes);
    return { cached: false, tempPath: tempPath, workId: workId, title: work.title || '' };
  });
  handle('research:fulltext-store', async function (_event, input) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    const workId = String((input && input.workId) || '');
    const text = String((input && input.text) || '');
    const tempPath = String((input && input.tempPath) || '');
    // 只删自己临时目录里的文件：tempPath 不接受任意路径（防把删除原语暴露给渲染层）
    const dir = path.join(dataPathState.configDir, FULLTEXT_TMP);
    const insideTmp = tempPath && path.dirname(tempPath) === dir;
    try {
      if (insideTmp) await fs.rm(tempPath, { force: true });
    } catch (error) { /* 删除失败不阻断：启动清扫兜底 */ }
    if (!workId || !text.trim()) return { stored: 0 };
    const stored = researchDb.upsertFulltext(workId, text);
    // 存完即回首个窗口，工具侧一次往返拿到正文
    return { stored: stored, window: stored ? researchDb.getFulltextWindow(workId, 0, input && input.length) : null };
  });
  /* ===== M9-4 科研网页检索（TinyFish；默认关 + 出境告知，双端把关） ===== */
  async function webSearchGateOk() {
    try {
      return libraryDb.getSetting('webSearchEnabled') === true &&
        libraryDb.getSetting('webSearchEgressAcknowledged') === true;
    } catch (error) { return false; }
  }
  /* R12：抓取正文的内存缓存（url → markdown），fetch_page 的 offset 续读命中缓存
   * 不再发网络请求；上限 8 条（超出按插入序淘汰），只缓存最近一次会话进程内使用。 */
  const fetchedPageCache = new Map();
  const FETCH_PAGE_EXCERPT = 4000;
  function cacheFetchPage(key, entry) {
    if (fetchedPageCache.size >= 8) {
      fetchedPageCache.delete(fetchedPageCache.keys().next().value);
    }
    fetchedPageCache.set(key, entry);
  }
  /* R15/R16：正式库已收藏索引（researchId + DOI 两路）——「调研库已有」与「正式库已收藏」
   * 是两件事，旧实现用一个 collected=!isNew 把前者冒充后者，模型据此误报「已在你库里」。 */
  async function inLibraryIndex() {
    const out = new Set();
    try {
      const state = await libraryDb.loadState();
      (state.papers || []).forEach(function (p) {
        if (!p || p.deletedAt) return;
        (Array.isArray(p.researchIds) ? p.researchIds : []).forEach(function (id) {
          if (id) out.add(String(id));
        });
        if (p.doi) out.add('doi:' + LitResearch.normalizeDoi(p.doi));
      });
    } catch (error) { /* 正式库读不到就报「未知已收藏」= 全部未命中，不阻断检索 */ }
    return out;
  }

  /* 检索：结果规范化后入库调研库——DOI 直查 → 规范化标题匹配 → local: 本地身份 + URL ext_id。
   * R15 元数据保真：pageUrl（网页地址）/ pdfUrl（PDF 直链）/ venue / snippet 各归各位，
   * type 按证据推断（不再一律 web），并如实回报「调研库已有」与「正式库已收藏」。 */
  handle('research:web-search', async function (_event, input) {
    if (!researchDb || !webFetchNet) throw new Error(T('调研库未就绪'));
    if (!(await webSearchGateOk())) throw new Error(T('科研网页检索未开启（含出境告知确认）'));
    const normalized = await webFetchNet.webSearch(input || {});
    if (!normalized.shapeOk) throw new Error(T('网页检索响应形状异常，已放弃入库'));
    const inLibrary = await inLibraryIndex();
    const out = [];
    let matched = 0;
    for (const r of normalized.results) {
      let workId = r.doi ? researchDb.findByExtId('doi', r.doi) : null;
      let isNew = false;
      if (!workId) workId = researchDb.findIdByNormalizedTitle(r.title);
      const exts = [{ kind: 'url', value: r.url }].concat(r.doi ? [{ kind: 'doi', value: r.doi }] : []);
      if (workId) {
        researchDb.addExtIds(workId, exts);
        matched++;
        // 已存在的身份也要补这次才拿到的元数据（PDF 直链 / venue / snippet）
        researchDb.upsertWorks([Object.assign(LitWebFetch.workFromSearchResult(r), { id: workId })]);
      } else {
        workId = 'local:' + require('node:crypto').randomBytes(8).toString('hex');
        const draft = LitWebFetch.workFromSearchResult(r);
        draft.id = workId;
        researchDb.upsertWorks([draft]);
        researchDb.addExtIds(workId, exts);
        isNew = true;
      }
      out.push({
        workId: workId, isNew: isNew, title: r.title, url: r.url, pdfUrl: r.pdfUrl || '',
        siteName: r.siteName, venue: r.venue || '', entryType: r.entryType || 'web',
        year: r.year, snippet: r.snippet.slice(0, 300), citations: r.citations, doi: r.doi,
        inResearch: !isNew,
        inLibrary: inLibrary.has(workId) || !!(r.doi && inLibrary.has('doi:' + r.doi))
      });
    }
    researchDb.recordSearch({ q: input && input.query, filters: { source: 'web', mode: normalized.mode || 'paper' }, count: out.length });
    return {
      total: normalized.total, works: out, mode: normalized.mode || 'paper',
      matched: matched, created: out.filter(function (w) { return w.isNew; }).length
    };
  });
  /* 抓取：仅学术域；markdown → 已收藏条目落 snapshot 目录附件并入 pdf_fts（消掉「快照不可全文检索」），
   * 未收藏条目落当前会话附件目录；final_url 越域在解析层已丢弃。 */
  handle('research:fetch-page', async function (_event, input) {
    if (!webFetchNet) throw new Error(T('调研库未就绪'));
    if (!(await webSearchGateOk())) throw new Error(T('科研网页检索未开启（含出境告知确认）'));
    const url = String(input && input.url || '');
    const offset = Math.max(0, Number(input && input.offset) || 0);
    // R12：续读（offset>0）优先走缓存——长正文分块读完不再重复抓取
    let markdown = '';
    let parsed = null;
    if (offset > 0 && fetchedPageCache.has(url)) {
      parsed = fetchedPageCache.get(url);
      markdown = parsed.markdown;
    } else {
      parsed = await webFetchNet.fetchPage({ url: url });
      if (!parsed.ok) {
        return { ok: false, partial: !!parsed.partial, error: parsed.error };
      }
      markdown = parsed.markdown;
      cacheFetchPage(url, { ok: true, markdown: markdown, title: parsed.title, finalUrl: parsed.finalUrl });
    }
    const result = {
      ok: true,
      title: parsed.title,
      finalUrl: parsed.finalUrl,
      markdownExcerpt: markdown.slice(offset, offset + FETCH_PAGE_EXCERPT),
      offset: offset,
      totalLength: markdown.length,
      nextOffset: offset + FETCH_PAGE_EXCERPT < markdown.length ? offset + FETCH_PAGE_EXCERPT : null
    };
    const paperId = String(input && input.paperId || '');
    const sessionId = String(input && input.sessionId || '');
    // 续读（offset>0）只取正文片段：快照附件在首次抓取（offset=0）时创建，不重复挂载
    if (paperId && offset === 0) {
      const state = await libraryDb.loadState();
      const paper = (state.papers || []).filter(function (p) { return p.id === paperId && !p.deletedAt; })[0];
      if (!paper) return { ok: false, error: T('未找到该正式库文献：') + paperId };
      const crypto = require('node:crypto');
      const attId = 'att' + crypto.randomBytes(10).toString('hex');
      const dirName = crypto.randomBytes(10).toString('hex');
      const dir = path.join(dataPathState.configDir, 'attachments', dirName);
      await fs.mkdir(dir, { recursive: true });
      const titleText = String(parsed.title || '网页快照').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
      const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + titleText + '</title>' +
        '<style>body{max-width:860px;margin:24px auto;padding:0 16px;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;}' +
        'img{max-width:100%}pre{overflow-x:auto;background:#f6f7f9;padding:10px;border-radius:6px;}</style></head><body>' +
        LitMarkdown.render(markdown) + '</body></html>';
      await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8');
      await fs.writeFile(path.join(dir, 'page.md'), markdown, 'utf8');
      const fingerprint = crypto.createHash('sha256').update(markdown, 'utf8').digest('hex');
      // R07：必须 await 索引写入完成——渲染层挂载附件后不再清索引，这里的写入就是最终态
      await libraryDb.pdfTextPut({
        paperId: paperId, attachmentId: attId, fingerprint: fingerprint,
        method: 'snapshot', pages: [markdown]
      });
      result.attachment = {
        id: attId, kind: 'snapshot',
        fileName: (parsed.title || '网页快照').slice(0, 80),
        path: dir, fingerprint: fingerprint
      };
    } else if (sessionId && offset === 0) {
      const saved = await agentSessions.saveAttachment(sessionId, {
        name: (parsed.title || '网页正文').slice(0, 60) + '.md',
        label: parsed.title || String(input && input.url || ''),
        dataBase64: Buffer.from(markdown, 'utf8').toString('base64')
      });
      result.file = saved && saved.file || '';
    }
    return result;
  });
  /* ===== R16 段落找文献（大模型 tool 的服务端实现） =====
   * 契约：给定一段话（或模型拆好的论点），多路召回 → 合并去重 → 逐论点做摘要级证据归因。
   * 三条纪律：
   * - **主题相近 ≠ 支撑论点**：没有命中论点的证据句就诚实地报 not_found（纯函数层保证）；
   * - **召回范围如实回报**：远端召回有预算（默认前 4 条论点），被跳过的论点明确列出，
   *   不允许把「只查了前几条」说成「整段都查过了」；
   * - **每条线路独立成败**：某一路（S2 限流 / 网络 / 未配置）失败不影响其余，失败原因逐路回报。 */
  const FIND_MAX_CLAIMS = 12;
  const FIND_REMOTE_CLAIM_BUDGET = 4;
  const FIND_PER_CLAIM = 5;

  /**
   * 把一批候选（我们的调研行形态）归位入库，并返回**顺序一一对应**的合并层输入。
   * 身份解析顺序：既有 id（OpenAlex 的 W…）→ DOI → S2 paperId → 规范化标题 → 新建 local:。
   * 检索即入库：幂等 UPSERT，重复检索只刷新记录，不产生重复行（literature-mcp 同策略）。
   */
  function ingestCandidates(rows) {
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || !row.title) { out.push(null); return; }
      let workId = String(row.id || '');
      if (!workId && row.doi) workId = researchDb.findByExtId('doi', row.doi) || '';
      if (!workId && row.s2Id) workId = researchDb.findByExtId('s2', row.s2Id) || '';
      if (!workId) workId = researchDb.findIdByNormalizedTitle(row.title) || '';
      if (!workId) workId = 'local:' + require('node:crypto').randomBytes(8).toString('hex');
      const draft = Object.assign({}, row, { id: workId });
      delete draft.s2Id;
      researchDb.upsertWorks([draft]);
      const exts = LitResearch.extIdsForRow({ id: workId, doi: draft.doi, s2Id: row.s2Id, pageUrl: draft.pageUrl });
      if (exts.length) researchDb.addExtIds(workId, exts);
      out.push({
        workId: workId, id: workId, doi: draft.doi || '', title: draft.title,
        year: draft.year == null ? null : draft.year,
        sourceName: draft.sourceName || '', venue: draft.sourceName || '',
        abstract: draft.abstract || '', snippet: draft.snippet || '',
        pageUrl: draft.pageUrl || '', oaUrl: draft.oaUrl || '',
        citedBy: Number(draft.citedBy) || 0, type: draft.type || ''
      });
    });
    return out;
  }

  /**
   * 单条论点的多路召回。claim 可以是字符串或 { text, variants }——variants 是同一论点的
   * 多语言版本，各版本都查一遍（中文论点查中文库、英文论点查英文库）。
   * 返回 { candidates, routes }——routes 逐路记成败，供工具层如实呈现「哪些线路查过、哪些没查/失败」。
   */
  async function recallForClaim(claim, ctx) {
    const routes = [];
    const groups = [];
    const queries = (claim && Array.isArray(claim.variants) && claim.variants.length)
      ? claim.variants.slice(0, 2)
      : [String(claim && claim.text != null ? claim.text : claim || '')];
    // S2：年份约束贯穿每条召回路线（工具接收了就必须生效，不能只存在参数里）
    const yearFrom = isFinite(ctx.yearFrom) && ctx.yearFrom > 1000 ? Math.floor(ctx.yearFrom) : null;
    const yearTo = isFinite(ctx.yearTo) && ctx.yearTo > 1000 ? Math.floor(ctx.yearTo) : null;
    const inYear = (w) => {
      if (w && w.year != null && Number.isFinite(Number(w.year))) {
        const y = Number(w.year);
        if (yearFrom != null && y < yearFrom) return false;
        if (yearTo != null && y > yearTo) return false;
      }
      return true; // 年份未知不剔除（在 notes 里说明），只剔除明确越界的
    };

    // ① 本地调研库关键词（FTS/LIKE）：无任何外部依赖，永远可用
    queries.forEach(function (q) {
      try {
        const local = researchDb.queryWorks({ q: q, limit: 12, yearFrom: yearFrom, yearTo: yearTo });
        const rows = researchDb.getWorks((local.works || []).map(function (w) { return w.id; }));
        groups.push({ provider: 'library', works: rows });
        routes.push({ id: 'library', ok: true, count: rows.length, query: q });
      } catch (error) {
        routes.push({ id: 'library', ok: false, count: 0, query: q, error: String(error && error.message || error) });
      }
    });

    // ② 本地调研库向量（需已配置嵌入模型且有向量）——cosineSearch 无年份参数，取回后过滤
    if (ctx.vectorReady) {
      for (const q of queries) {
        try {
          const embedded = await embedService.embedTexts({ texts: [q] });
          const vec = new Float32Array(embedded.vectors[0]);
          const hits = researchDb.cosineSearch(Buffer.from(vec.buffer), {
            limit: 24, model: embedded.model, recipe: LitResearch.EMBED_RECIPE
          });
          const rows = researchDb.getWorks(hits.map(function (h) { return h.workId; })).filter(inYear);
          groups.push({ provider: 'library-vector', works: rows });
          routes.push({ id: 'library-vector', ok: true, count: rows.length, query: q });
        } catch (error) {
          routes.push({ id: 'library-vector', ok: false, count: 0, query: q, error: String(error && error.message || error) });
        }
      }
    }

    // ③ 远端召回（受预算控制；超出预算的论点只走本地，如实标记）
    if (!ctx.remote) {
      routes.push({ id: 'remote', ok: true, count: 0, skipped: 'over_budget' });
      return { candidates: LitLitSearch.mergeCandidates(groups), routes: routes };
    }
    const remoteRoutes = [
      {
        id: 'openalex-semantic', enabled: ctx.providers.openalexSemantic,
        run: async function (q) {
          const r = await researchNet.searchOpenAlex({ query: q, mode: 'semantic', limit: 15, yearFrom: yearFrom, yearTo: yearTo });
          return { rows: r.results || [], total: r.count };
        }
      },
      {
        id: 'openalex-keyword', enabled: ctx.providers.openalexKeyword,
        run: async function (q) {
          const r = await researchNet.searchOpenAlex({ query: q, mode: 'keyword', limit: 15, yearFrom: yearFrom, yearTo: yearTo });
          return { rows: r.results || [], total: r.count };
        }
      },
      {
        id: 'semanticscholar', enabled: ctx.providers.semanticscholar,
        run: async function (q) {
          const r = await researchNet.searchSemanticScholar({ query: q, limit: 15, yearFrom: yearFrom, yearTo: yearTo });
          return { rows: r.results || [], total: r.total };
        }
      },
      {
        id: 'web', enabled: ctx.providers.web,
        run: async function (q) {
          const r = await webFetchNet.webSearch({ query: q, mode: 'paper', limit: 10, yearFrom: yearFrom, yearTo: yearTo });
          if (!r.shapeOk) throw new Error('网页检索响应形状异常');
          return { rows: (r.results || []).map(LitWebFetch.workFromSearchResult), total: r.total };
        }
      }
    ];
    for (const route of remoteRoutes) {
      if (!route.enabled) continue;
      // 同一路线的多个语言版本合并成一条 route 记录（成败按最后一次为准，count 累加）
      let ok = true;
      let count = 0;
      let total = 0;
      let error = '';
      for (const q of queries) {
        try {
          const r = await route.run(q);
          const candidates = ingestCandidates(r.rows);
          const works = candidates.filter(Boolean);
          groups.push({ provider: route.id, works: works });
          count += works.length;
          total = Math.max(total, Number(r.total) || 0);
        } catch (err) {
          ok = false;
          error = String(err && err.message || err);
        }
      }
      routes.push(ok
        ? { id: route.id, ok: true, count: count, total: total }
        : { id: route.id, ok: false, count: count, total: total, error: error });
    }
    return { candidates: LitLitSearch.mergeCandidates(groups), routes: routes };
  }

  handle('research:find-literature', async function (_event, input) {
    if (!researchDb || !researchNet) throw new Error(T('调研库未就绪'));
    const req = input || {};
    const text = String(req.text || '').trim();
    const provided = Array.isArray(req.claims)
      ? req.claims.map(function (c) { return String(c == null ? '' : c).trim(); }).filter(Boolean)
      : [];
    if (!text && !provided.length) throw new Error(T('没有可检索的内容'));
    const providedEn = Array.isArray(req.claimsEn)
      ? req.claimsEn.map(function (c) { return String(c == null ? '' : c).trim(); })
      : [];
    const primary = (provided.length
      ? provided
      : LitLitSearch.splitClaims(text).map(function (c) { return c.text; })
    ).slice(0, FIND_MAX_CLAIMS);
    if (!primary.length) throw new Error(T('没有可检索的论点'));
    // 跨语言：模型可给同一批论点的英文版（一一对应）。召回与证据判定都用两版，
    // 否则中文论点在英文摘要上必然落空（词面匹配的硬边界）。
    const claims = primary.map(function (cn, index) {
      const en = providedEn[index];
      const variants = en && en !== cn ? [cn, en] : [cn];
      return { text: cn, variants: variants };
    });
    // 预算：远端召回只覆盖前 N 条论点（OpenAlex 语义 1 req/s，条数一多会拖很久）
    const budget = Math.max(1, Math.min(FIND_MAX_CLAIMS, Number(req.remoteClaimBudget) || FIND_REMOTE_CLAIM_BUDGET));
    const stats = researchDb.stats();
    const webOk = await webSearchGateOk();
    // 召回源：OpenAlex（关键词 + 语义）与 Semantic Scholar 常开——语义检索只作为 agent 工具
    // 存在，没有用户侧供应商开关；学术网页仍受开关 + 出境告知双重门控
    const providers = {
      openalexKeyword: true,
      openalexSemantic: true,
      semanticscholar: true,
      web: webOk
    };
    const findEmbedTarget = await embedService.resolveTarget();
    const vectorReady = findEmbedTarget.ok && Number(stats.vectors) > 0;

    const perClaim = [];
    for (let i = 0; i < claims.length; i++) {
      perClaim.push(await recallForClaim(claims[i], {
        providers: providers, vectorReady: vectorReady, remote: i < budget,
        yearFrom: Number(req.yearFrom) || null, yearTo: Number(req.yearTo) || null
      }));
    }
    // 跨论点统一合并（同一条被多条论点召回只留一行），证据归因在纯函数层完成；
    // S2 收口：即使某条路线漏了年份（上游忽略参数），最终候选再按年份统一过滤一次
    const findYearFrom = Number(req.yearFrom) || null;
    const findYearTo = Number(req.yearTo) || null;
    let yearDropped = 0;
    let yearUnknown = 0;
    const yearOk = (w) => {
      const y = Number(w && w.year);
      if (w && w.year != null && Number.isFinite(y) && y > 1000) {
        if (findYearFrom != null && y < findYearFrom) return false;
        if (findYearTo != null && y > findYearTo) return false;
        return true;
      }
      yearUnknown++;
      return true;
    };
    const mergedAll = LitLitSearch.mergeCandidates([{
      provider: 'all',
      works: perClaim.reduce(function (acc, item) { return acc.concat(item.candidates); }, [])
    }]);
    const hasYearFilter = (findYearFrom != null && findYearFrom > 1000) || (findYearTo != null && findYearTo > 1000);
    const merged = hasYearFilter
      ? mergedAll.filter(function (w) { const ok = yearOk(w); if (!ok) yearDropped++; return ok; })
      : mergedAll;
    const findings = LitLitSearch.buildFindings(claims, merged, {
      perClaim: Math.max(1, Math.min(10, Number(req.perClaim) || FIND_PER_CLAIM))
    });
    const inLibrary = await inLibraryIndex();
    const routeFailures = [];
    findings.forEach(function (finding, index) {
      const routes = perClaim[index] ? perClaim[index].routes : [];
      finding.routes = routes;
      finding.candidates.forEach(function (c) {
        c.inLibrary = inLibrary.has(c.workId) || !!(c.doi && inLibrary.has('doi:' + c.doi));
        c.inResearch = true;
      });
      routes.forEach(function (route) {
        if (!route.ok && routeFailures.length < 6) {
          routeFailures.push({ claim: finding.claim.slice(0, 60), route: route.id, error: route.error });
        }
      });
    });
    researchDb.recordSearch({
      q: text.slice(0, 500),
      filters: { source: 'find-literature', claims: claims.length },
      count: merged.length
    });
    const notes = [];
    if (!vectorReady) notes.push(T('本地向量检索未启用或索引为空：本地召回走关键词。配置嵌入模型并构建索引可提升同义改写召回。'));
    if (!webOk) notes.push(T('科研网页检索未开启，未参与召回。'));
    if (claims.length > budget) {
      notes.push(T('远端召回只覆盖前 ') + budget + T(' 条论点（其余仅查本地库）；需要更多时把 text 拆小分次调用。'));
    }
    // S2：年份约束如实回报——剔了多少、多少未知年份未过滤
    if (hasYearFilter) {
      let yearNote = T('年份约束 ') + (findYearFrom || '') + '–' + (findYearTo || '') + T(' 已应用于全部召回路线与最终候选（越界已剔除 ') + yearDropped + T(' 条）');
      if (yearUnknown > 0) yearNote += '；' + yearUnknown + T(' 条候选年份未知，保留未过滤');
      notes.push(yearNote + '。');
    }
    return {
      claims: findings,
      providerStats: {
        localVector: vectorReady,
        openalex: providers.openalexKeyword,
        semanticscholar: providers.semanticscholar,
        web: webOk
      },
      remoteClaimsCovered: Math.min(budget, claims.length),
      remoteClaimsSkipped: Math.max(0, claims.length - budget),
      candidateTotal: merged.length,
      routeFailures: routeFailures,
      notes: notes
    };
  });
  handle('research:graph', async function (event, input) {
    if (!researchDb || !researchNet) throw new Error(T('调研库未就绪'));
    const seeds = (Array.isArray(input && input.workIds) ? input.workIds : []).map(String).filter(Boolean).slice(0, 50);
    if (!seeds.length) throw new Error(T('没有可作为种子的调研身份'));
    return LitGraphGen.buildGraphData(seeds, {
      depth: input && input.depth,
      maxNodes: input && input.maxNodes
    }, {
      getWorks: async function (ids) { return researchDb.getWorks(ids); },
      fetchMissing: async function (ids) {
        const rows = await researchNet.fetchWorksByIds(ids);
        researchDb.upsertWorks(rows);
        return rows;
      }
    });
  });
  /* 补登记：正式库条目 ↔ 调研库身份。主进程只产提案（DOI 直查 + 无 DOI 建本地身份）；
   * 写回 paper.researchIds 由渲染层完成（save 管线与同步语义归渲染层所有）。 */
  handle('research:register', async function (_event, input) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    const limit = Math.max(1, Math.min(500, Number(input && input.limit) || 200));
    const state = await libraryDb.loadState();
    const candidates = (state.papers || []).filter(function (p) {
      return p && !p.deletedAt && !(Array.isArray(p.researchIds) && p.researchIds.length);
    }).slice(0, limit);
    const proposals = [];
    for (const paper of candidates) {
      const doi = paper.doi ? LitResearch.normalizeDoi(paper.doi) : '';
      let researchId = doi ? researchDb.findByExtId('doi', doi) : null;
      let createdLocal = false;
      if (!researchId && !doi && paper.title) {
        // 无 DOI：分配本地身份（代理键永不变更；日后匹配合并走 merge_log 重定向）
        researchId = 'local:' + require('node:crypto').randomBytes(8).toString('hex');
        researchDb.upsertWorks([{ id: researchId, title: paper.title, year: paper.year || null, doi: '' }]);
        createdLocal = true;
      }
      if (researchId) {
        proposals.push({ paperId: paper.id, researchId: researchId, title: paper.title || '', createdLocal: createdLocal });
      }
    }
    return { proposals: proposals, scanned: candidates.length };
  });
  /* R18 文献检索能力补齐（对照 literature-mcp）：精确取文献（DOI / OpenAlex ID / 标题精确）、
   * 实体名 → OpenAlex ID 联想、库内引文邻接。三个都是「检索即入库」幂等语义，不动正式库。 */
  handle('research:get-work', async function (_event, input) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    const raw = String((input && input.query) || '').trim();
    if (!raw) throw new Error(T('缺少检索词'));
    const doiMatch = raw.match(/(10\.\d{4,9}\/[^\s"'<>]+)/i);
    const doi = doiMatch ? LitResearch.normalizeDoi(doiMatch[1]) : '';
    const idMatch = raw.match(/(W\d{4,})/i);
    const workId = idMatch ? 'W' + idMatch[1].slice(1) : '';
    let row = null;
    let origin = 'local';
    if (doi) row = researchDb.getWorks([researchDb.findByExtId('doi', doi)].filter(Boolean))[0] || null;
    if (!row && workId) row = researchDb.getWorks([workId])[0] || null;
    if (!row && (doi || workId) && researchNet) {
      const fetched = workId ? await researchNet.fetchWorksByIds([workId]) : await researchNet.fetchWorksByDois([doi]);
      if (fetched.length) {
        researchDb.upsertWorks(fetched);
        row = researchDb.getWorks([fetched[0].id])[0] || null;
        origin = 'openalex';
      }
    }
    if (!row) {
      const byTitle = researchDb.findIdByNormalizedTitle(raw);
      if (byTitle) row = researchDb.getWorks([byTitle])[0] || null;
    }
    if (!row) return { found: false, note: '本地与 OpenAlex 均未精确命中；模糊/主题检索请改用 search_openalex 或 search_research' };
    return {
      found: true,
      origin: origin,
      work: {
        id: row.id, doi: row.doi || '', title: row.title || '', year: row.year || null,
        sourceName: row.sourceName || '', citedBy: row.citedBy || 0, isOa: row.isOa === true,
        oaUrl: row.oaUrl || '', hasAbstract: !!row.abstract,
        abstract: String(row.abstract || '').slice(0, 1500)
      }
    };
  });
  handle('research:autocomplete', async function (_event, input) {
    if (!researchNet) throw new Error(T('调研库未就绪'));
    return researchNet.autocomplete(input && input.entity, input && input.query);
  });
  handle('research:graph-neighbors', function (_event, input) {
    if (!researchDb) throw new Error(T('调研库未就绪'));
    const seeds = Array.from(new Set((Array.isArray(input && input.workIds) ? input.workIds : [])
      .map(String).filter(Boolean))).slice(0, 20);
    if (!seeds.length) throw new Error(T('缺少 workIds'));
    const direction = ['in', 'out', 'both'].indexOf(String((input && input.direction) || 'both')) >= 0
      ? String((input && input.direction) || 'both') : 'both';
    const snapshot = researchDb.getRefsSnapshot();
    const refsById = new Map();
    const citingOf = new Map(); // 被引方 → 引用它的库内文献
    snapshot.forEach(function (entry) {
      refsById.set(entry.id, entry.refs);
      entry.refs.forEach(function (ref) {
        if (!citingOf.has(ref)) citingOf.set(ref, []);
        citingOf.get(ref).push(entry.id);
      });
    });
    const pick = function (ids, cap) {
      const inLibrary = Array.from(new Set(ids)).filter(function (id) { return refsById.has(id); });
      const external = ids.length - inLibrary.length;
      const rows = researchDb.getWorks(inLibrary.slice(0, 200));
      rows.sort(function (a, b) { return (b.citedBy || 0) - (a.citedBy || 0); });
      return {
        works: rows.slice(0, cap).map(function (w) {
          return { workId: w.id, title: w.title || '', year: w.year || null, citedBy: w.citedBy || 0 };
        }),
        externalNotInLibrary: external
      };
    };
    const out = direction !== 'in'
      ? pick(seeds.reduce(function (acc, id) { return acc.concat(refsById.get(id) || []); }, []), 30)
      : null;
    const inn = direction !== 'out'
      ? pick(seeds.reduce(function (acc, id) { return acc.concat(citingOf.get(id) || []); }, []), 30)
      : null;
    return { seeds: seeds, direction: direction, out: out, in: inn };
  });
  handle('agent:cancel', function (_event, sessionId) {
    return agentNet ? agentNet.cancel(sessionId) : false;
  });
  handle('agent:test', function (_event, input) {
    if (!agentNet) throw new Error(T('AI 助手未就绪'));
    return agentNet.testConnection(input || {});
  });
  handle('agent:list-models', function (_event, input) {
    if (!agentNet) throw new Error(T('AI 助手未就绪'));
    return agentNet.listModels(input || {});
  });

  handle('session:create', function (_event, input) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.create(input || {});
  });
  handle('session:list', function () {
    return agentSessions ? agentSessions.list() : [];
  });
  handle('session:read', function (_event, id) {
    return agentSessions ? agentSessions.read(id) : null;
  });
  handle('session:set-data', function (_event, payload) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.setData(payload && payload.id, payload && payload.data);
  });
  /* R04 关键事件落盘：立即写盘并等待完成；回传主进程登记的附件集合（R05 同步用） */
  handle('session:commit', function (_event, payload) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.commit(payload && payload.id, payload && payload.data);
  });
  /* R05：打开会话附件（主进程解析受控路径，渲染层不接触绝对路径） */
  handle('session:open-attachment', async function (_event, payload) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    const abs = await agentSessions.attachmentPath(payload && payload.id, payload && payload.file);
    await shell.openPath(abs);
    return { ok: true, path: abs };
  });
  handle('session:rename', function (_event, payload) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.rename(payload && payload.id, payload && payload.title);
  });
  handle('session:delete', function (_event, id) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.remove(id);
  });
  handle('session:delete-many', function (_event, ids) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.removeMany(ids);
  });
  handle('session:export-md', function (_event, id) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.exportMarkdown(id);
  });
  handle('session:save-attachment', function (_event, payload) {
    if (!agentSessions) throw new Error(T('会话存储未就绪'));
    return agentSessions.saveAttachment(payload && payload.id, payload || {});
  });
  handle('session:open-root', async function () {
    const root = agentSessionsRoot();
    await fs.mkdir(root, { recursive: true });
    await shell.openPath(root);
    return { ok: true, root: root };
  });
  handle('session:root', function () { return agentSessionsRoot(); });

  handle('api:fetch-json', async function (_event, rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch (error) { throw new Error(T('无效的 API 地址')); }
    if (url.protocol !== 'https:' || !ALLOWED_API_HOSTS.has(url.hostname)) {
      throw new Error(T('不允许访问该 API 地址'));
    }
    // 15s 硬超时兜底：fetch 的 AbortSignal 只覆盖到响应头，body 读取挂起时仍可能永不返回，
    // 这里用 race 包住「请求 + 读 body」全程，确保 IPC 一定会 settle。
    let timer = null;
    const timeout = new Promise(function (_resolve, reject) {
      timer = setTimeout(function () { reject(new Error(T('请求超时（15s）：') + url.hostname)); }, 15000);
    });
    const work = (async function () {
      const response = await net.fetch(url.href, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      });
      if (process.env.LITBOARD_DEBUG_FETCH) console.log('[fetch-json] HTTP', response.status, url.hostname);
      let data = null;
      // 仅对成功响应解析 JSON；限流(429)、5xx 等错误响应常返回 HTML/纯文本，
      // 此时保留原始 status 交给渲染层处理（重试 / 退避），不要因解析失败而丢掉状态码。
      if (response.ok) {
        const body = await response.text();
        if (body) {
          try { data = JSON.parse(body); } catch (error) { throw new Error(T('API 返回了无效 JSON')); }
        }
      }
      return { status: response.status, ok: response.ok, data };
    })();
    try {
      return await Promise.race([work, timeout]);
    } catch (error) {
      if (process.env.LITBOARD_DEBUG_FETCH) console.log('[fetch-json] FAIL', url.hostname, String(error && error.message || error));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });

  // 下载一篇开放获取 PDF：渲染层提供直链 + 建议文件名。
  // 落盘目录 = 渲染层传来的 pdfDownloadDir 设置；未设置时落到配置目录下的 open-access-pdf
  // 受管目录（不再弹保存框），都按命名模板重命名（同名覆盖，幂等重下）。
  handle('pdf:download', async function (event, options) {
    let url;
    try { url = new URL(String(options && options.url || '')); } catch (error) { return { error: T('无效的下载地址') }; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: T('无效的下载地址') };

    const suggestedName = safePdfFileName(options && options.name || 'paper.pdf');
    const autoDir = String(options && options.dir || '').trim() || openAccessPdfDir();
    if (!path.isAbsolute(autoDir)) return { error: T('PDF 下载目录必须是绝对路径') };
    try {
      await fs.mkdir(autoDir, { recursive: true });
    } catch (error) {
      return { error: T('PDF 下载目录不可用：') + String(error && error.message || error) };
    }
    const target = composeAutoDownloadPath(autoDir, suggestedName);

    return downloadPdfToFile(url.href, target, {
      fetch: function (href, init) { return net.fetch(href, init); },
      onProgress: function (received, total) {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('pdf:download-progress', { received: received, total: total });
        }
      }
    });
  });

}

let quitting = false;

/* M1 关闭收尾：窗口 close 被拦截后向渲染层请求保存收尾（等待「已持久化」而非「已入队」）。
 * app:close-ack 回报结果（ok=false → 保留窗口）；app:close-force 是用户在失败确认弹窗中
 * 明确放弃后的强制放行。渲染层崩溃/无响应超时放行，避免出现无法退出的死锁。
 * 内部 relaunch（数据目录切换 / 备份恢复重启）置 forceQuitNext 直接放行——彼时数据库已切换，
 * 渲染层的保存收尾不再有意义。 */
let quitApproved = false;
let forceQuitNext = false;
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
ipcMain.on('app:close-force', function () {
  if (!closeWaiter) return;
  const waiter = closeWaiter;
  closeWaiter = null;
  clearTimeout(waiter.timer);
  proceedClose();
});

function askRendererToFinishBeforeClose() {
  // 关闭收尾窗口期顺带冲刷 AI 会话（1s 防抖外的兜底；会话是用户成果，尽力不丢）。
  // R04：flushPromise 交给 will-quit 的清理链等待——冲刷失败/超时由既有的 8s 强退兜底，
  // 不再 fire-and-forget（否则「清理完成」可能先于磁盘写入发生）。
  sessionsFlushPromise = agentSessions ? agentSessions.flushAll().catch(function (error) {
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
  if (quitting || !libraryDb) return;
  quitting = true;
  event.preventDefault();
  startupLog('will-quit: closing (db checkpoint / backup / bridge stop)');
  if (wordBridgeInstance) wordBridgeInstance.stop();
  let finished = false;
  const done = function () {
    if (finished) return;
    finished = true;
    startupLog('will-quit: cleanup done, exiting');
    const closeDb = function () { libraryDb.close().finally(function () { app.exit(0); }); };
    // R04：等关闭窗口期启动的会话冲刷完成（有 8s 强退兜底，不会无限等）
    const afterSessions = function () {
      if (bridgeServer) bridgeServer.stop().then(closeDb, closeDb);
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
        if (!dataPathManager) return;
        const state = dataPathManager.getState();
        if (!state.cleanupPending && !state.runtimeSweepPending) return;
        dataPathState = dataPathManager.retryCleanup();
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
  if (dataPathState.fatalError) {
    const message = dataPathState.migrationError + T('\n\n为避免打开错误或空白文献库，LitBoard 已停止启动。请恢复原目录后重试。');
    if (SMOKE_TEST) {
      await finishSmokeTest({ error: message }, 1);
    } else {
      dialog.showErrorBox(T('LitBoard 数据目录不可用'), message);
      app.exit(1);
    }
    return;
  }
  const configDir = dataPathState.configDir;
  const libraryDir = dataPathState.libraryDir;
  libraryDb = createLibraryDb(libraryDir);
  backupManager = createBackupManager({
    libraryDir: libraryDir,
    configDir: configDir,
    dataPathManager: dataPathManager,
    getDb: function () { return libraryDb; },
    // M9 二期：快照附带调研库身份核（getter 延迟到创建快照时才读 researchDb）
    getResearchIdentity: function () { return researchDb ? researchDb.exportIdentityCore() : null; }
  });
  try {
    await libraryDb.open();
    startupLog('database open done in ' + (Date.now() - dbOpenT0) + 'ms');
    // 主进程界面语言跟随上次保存的选择（渲染层启动后也会实时推 uiLang）
    LitI18n.setLang(String(libraryDb.getSetting('uiLang') || ''), { persist: false });
  } catch (error) {
    startupLog('database open FAILED: ' + (error && error.message || error));
    if (error.code !== 'LITBOARD_DB_CORRUPT') throw error;
    // 数据库损坏：绝不删除/覆盖损坏文件；按「最新完整快照 → .bak 兼容兜底 → 用户选目录/退出」恢复
    console.error('LitBoard database corrupted:', error.message);
    let recovered = false;
    const attempt = await backupManager.restoreLatestValid();
    if (attempt.ok) { recovered = true; }
    else {
      const legacy = await backupManager.restoreLegacyBak();
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
      const restored = await backupManager.restoreLatestValid(picked.filePaths[0]);
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
      await libraryDb.open();
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
  integrations = createIntegrations({
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
    researchDb = createResearchDb({ dir: path.join(configDir, 'research') });
    researchNet = createResearchNet({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return integrations.getResearchRuntimeConfig(); }
    });
    // M9-4：科研网页检索（TinyFish；默认关 + 出境告知确认后才可用，双端把关）
    webFetchNet = createWebFetchNet({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return integrations.getResearchRuntimeConfig(); }
    });
    agentNet = createAgentNet({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return integrations.getResearchRuntimeConfig(); },
      // 出网身份：OpenCode 等网关要求客户端自带 User-Agent（通用 HTTP 库名会被区别对待）
      userAgent: 'LitBoard/' + app.getVersion(),
      notify: function (channel, payload) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
      },
    });
    // 调研库向量模型的统一出网层（AI 助手语义检索工具 / 段落找文献向量召回 / 空闲增量构建
    // 三条链共用；用量记账随服务走，重启从 settings 恢复）
    embedService = createEmbedService({
      fetch: function (url, init) { return net.fetch(url, init); },
      getConfig: function () { return integrations.getResearchRuntimeConfig(); },
      userAgent: 'LitBoard/' + app.getVersion(),
      initialUsage: (function () {
        try { return JSON.parse(libraryDb.getSetting('embedUsageTotals') || 'null'); } catch (error) { return null; }
      })(),
      persistUsage: function (totals) {
        try { libraryDb.setSetting('embedUsageTotals', JSON.stringify(totals)); } catch (error) {}
        return Promise.resolve();
      }
    });
    agentSessions = createSessions({
      rootDir: agentSessionsRoot(),
      trashItem: function (dir) { return shell.trashItem(dir); },
      log: function (message) { startupLog('sessions: ' + message); }
    });
    await researchDb.open();
    // R19 临时全文链：清扫上次异常退出可能残留的临时 PDF（正常路径抽取完即删，目录应为空）
    await fs.rm(path.join(dataPathState.configDir, 'tmp-fulltext'), { recursive: true, force: true }).catch(function () {});
    // 二期：调研库向量构建器（空闲调度；向量模型配置就绪即由 60s 巡检自动增量构建）
    researchEmbedder = createResearchEmbedder({
      researchDb: researchDb,
      embed: embedService,
      // R14：失败批次的持久标记存 settings 表——巡检/入库触发改走 maybeAutoBuild，
      // 见到标记就跳过，直到用户手动「构建」清除（失败不自动重试计费）
      getSetting: function (key) { return libraryDb.getSetting(key); },
      setSetting: function (key, value) { return libraryDb.setSetting(key, value); },
      isIdle: function () { return (Date.now() - lastLibraryWriteAt > 8000) && !syncInFlight; },
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
    researchDb = null;
  }
  // 旧 JSON 存储 / 旧全文缓存 → SQLite（一次性迁移，旧文件改名留底）
  try {
    const config = await integrations.getConfig();
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
      migrated.push(...await libraryDb.migrateLegacy(createLibraryStorage(directory), null));
    }
    seenPaths.clear();
    const cacheFiles = uniquePaths([customCacheDir && path.join(customCacheDir, 'pdftext.v1.json')]
      .concat(legacyDirs.map(function (directory) { return path.join(directory, 'pdftext.v1.json'); })));
    for (const cacheFile of cacheFiles) {
      migrated.push(...await libraryDb.migrateLegacy(null, cacheFile));
    }
    if (migrated.length) console.log('LitBoard migrated legacy stores:', migrated.join(', '));
  } catch (error) {
    console.error('LitBoard legacy migration failed:', error);
  }
  const pendingRebase = dataPathManager.pendingRebase();
  if (pendingRebase) {
    try {
      const rebased = dataPathManager.rebaseWorkspacePaths(
        libraryDb.loadState(), pendingRebase.fromConfigDir, pendingRebase.toConfigDir);
      if (rebased.changed) libraryDb.saveState(rebased.workspace);
      dataPathState = dataPathManager.completeRebase();
    } catch (error) {
      // 保留 pendingRebase；下次启动会重试，原目录也仍保留，避免丢失附件引用。
      console.error('LitBoard managed path rebase failed:', error);
      dataPathState = dataPathManager.getState();
    }
  }
  libraryDb.backupIfDue(false).catch(function () {});
  scheduleDataDirCleanupRetries();
  // 完整备份：启动时检查一次，之后每小时检查；距上次成功超过 24 小时则自动备份
  backupManager.maybeAutoBackup().catch(function (error) {
    console.error('LitBoard auto backup at startup failed:', error);
  });
  setInterval(function () {
    backupManager.maybeAutoBackup().catch(function (error) {
      console.error('LitBoard auto backup failed:', error);
    });
  }, 60 * 60 * 1000);
  registerIpc();
  createWindow();
  startupLog('main window created');
  // 浏览器扩展桥接服务（仅 127.0.0.1）
  // 主进程网络出口：OpenAlex DOI 补全（api.openalex.org）；知网 PDF 走的浏览器会话，不直连知网。
  bridgeServer = createBridgeServer({
    libraryDb: libraryDb,
    fetch: function (url, init) { return net.fetch(url, init); },
    // 扩展抓取条目的 PDF 落盘目录：跟随「PDF 自动下载目录」设置（每次保存时现读），
    // 未设置时与桌面下载一致，落配置目录下的 open-access-pdf 受管目录。
    resolveDownloadDir: async function () {
      let configured = '';
      try {
        configured = String((await integrations.getConfig()).pdfDownloadDir || '').trim();
      } catch (error) { /* 配置读取失败按未设置处理 */ }
      return configured || openAccessPdfDir();
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
  bridgeServer.start().then(function (status) {
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
