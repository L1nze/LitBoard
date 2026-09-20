'use strict';

const { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } = require('electron');
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
// 可选：把 smoke 渲染的 PDF 页截图到指定文件（肉眼检查渲染效果用）
const SMOKE_SHOT = process.env.LITBOARD_SMOKE_SHOT || '';
const SMOKE_SCALE = Number(process.env.LITBOARD_SMOKE_SCALE) || 0.2; // 截图目检时可调大
const SMOKE_EXPECT_RENDERER = process.env.LITBOARD_SMOKE_EXPECT_RENDERER === 'pdfjs' ? 'pdfjs' : 'pdfium';

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
              // 底部服务商徽标（由 Base URL 判定）：DOM 必须在，否则「当前经谁的端点」不可见
              !!document.querySelector('#agent-provider') &&
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
            // 检索与元数据服务：一次测四个源（结果区同批就位，缺一即回归）
            sourcesTestPresent: !!document.querySelector('#sync-test-sources') &&
              !!document.querySelector('#sync-sources-test-status') &&
              !!document.querySelector('#sync-sources-test-result'),
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
          result.agentChatRendered === true && result.chatBodyIsFlexColumn === true &&
          result.rightRailPresent && result.railSwitchWorks === true &&
          result.journalRankColumnPresent && result.rankRefreshTogglePresent &&
          result.scigreatTestPresent && result.easyscholarTestPresent && result.sourcesTestPresent &&
          result.pdfAnnotationUiPresent &&
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
 * app:close-ack 回报结果（ok=false → 保留窗口）；app:close-force 是用户在失败确认弹窗中
 * 明确放弃后的强制放行。渲染层崩溃/无响应超时放行，避免出现无法退出的死锁。
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
  createWindow();
  startupLog('main window created');
  // 浏览器扩展桥接服务（仅 127.0.0.1）
  // 主进程网络出口：OpenAlex DOI 补全（api.openalex.org）；知网 PDF 走的浏览器会话，不直连知网。
  ctx.bridgeServer = createBridgeServer({
    libraryDb: ctx.libraryDb,
    fetch: function (url, init) { return net.fetch(url, init); },
    // 扩展抓取条目的 PDF 落盘目录：跟随「PDF 自动下载目录」设置（每次保存时现读），
    // 未设置时与桌面下载一致，落配置目录下的 open-access-pdf 受管目录。
    resolveDownloadDir: async function () {
      let configured = '';
      try {
        configured = String((await ctx.integrations.getConfig()).pdfDownloadDir || '').trim();
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
