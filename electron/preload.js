'use strict';

const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('litboardDesktop', {
  setZoomFactor: function (factor) { webFrame.setZoomFactor(factor); },
  loadLibrary: function () { return ipcRenderer.invoke('library:load'); },
  recordRead: function (value) { return ipcRenderer.invoke('library:record-read', value); },
  wordInvoke: function (value) { return ipcRenderer.invoke('word:invoke', value); },
  wordZoteroConvertRead: function (filePath) { return ipcRenderer.invoke('word:zotero-convert-read', filePath); },
  wordZoteroConvertWrite: function (value) { return ipcRenderer.invoke('word:zotero-convert-write', value); },
  saveLibrary: function (workspace, baseSignatures) {
    return ipcRenderer.invoke('library:save', { workspace: workspace, baseSignatures: baseSignatures || null });
  },
  replaceLibrary: function (workspace) { return ipcRenderer.invoke('library:replace', workspace); },
  getBackupStatus: function () { return ipcRenderer.invoke('backup:status'); },
  chooseBackupDir: function () { return ipcRenderer.invoke('backup:choose-dir'); },
  backupNow: function () { return ipcRenderer.invoke('backup:run'); },
  setBackupKeep: function (value) { return ipcRenderer.invoke('backup:set-keep', value); },
  scanBackupLeftovers: function () { return ipcRenderer.invoke('backup:scan-leftovers'); },
  cleanBackupLeftovers: function () { return ipcRenderer.invoke('backup:clean-leftovers'); },
  restoreBackup: function (snapshotId) { return ipcRenderer.invoke('backup:restore', snapshotId); },
  openBackupDir: function () { return ipcRenderer.invoke('backup:open-dir'); },
  getSetting: function (key) { return ipcRenderer.invoke('settings:get', key); },
  setSetting: function (key, value) { return ipcRenderer.invoke('settings:set', { key: key, value: value }); },
  getDataPaths: function () { return ipcRenderer.invoke('data-paths:get'); },
  stageDataPaths: function (value) { return ipcRenderer.invoke('data-paths:stage', value); },
  getAppVersion: function () { return ipcRenderer.invoke('app:get-version'); },
  relaunchApp: function () { return ipcRenderer.invoke('app:relaunch'); },
  chooseImportFiles: function () { return ipcRenderer.invoke('files:choose-import'); },
  saveFile: function (options) { return ipcRenderer.invoke('files:save', options); },
  readFileBytes: function (filePath) { return ipcRenderer.invoke('files:read-bytes', filePath); },
  openPath: function (filePath) { return ipcRenderer.invoke('files:open-path', filePath); },
  revealInFolder: function (filePath) { return ipcRenderer.invoke('files:reveal', filePath); },
  exportPdfs: function (options) { return ipcRenderer.invoke('files:export-pdfs', options); },
  storePdf: function (options) { return ipcRenderer.invoke('files:store-pdf', options); },
  scanFolder: function (options) { return ipcRenderer.invoke('files:scan-folder', options); },
  copyText: function (value) { return ipcRenderer.invoke('clipboard:write', value); },
  fetchJson: function (url) { return ipcRenderer.invoke('api:fetch-json', url); },
  getIntegrationConfig: function () { return ipcRenderer.invoke('integrations:get-config'); },
  saveIntegrationConfig: function (value) { return ipcRenderer.invoke('integrations:save-config', value); },
  revealIntegrationSecret: function (value) { return ipcRenderer.invoke('integrations:reveal-secret', value || {}); },
  copyIntegrationSecret: function (value) { return ipcRenderer.invoke('integrations:copy-secret', value || {}); },
  syncNutstore: function (workspace) { return ipcRenderer.invoke('integrations:sync-nutstore', workspace); },
  inspectNutstoreRemote: function (value) { return ipcRenderer.invoke('integrations:inspect-nutstore', value); },
  createNutstoreSyncPlan: function (value) { return ipcRenderer.invoke('integrations:create-sync-plan', value); },
  applyNutstoreSyncPlan: function (value) { return ipcRenderer.invoke('integrations:apply-sync-plan', value); },
  pullNutstoreConfig: function (value) { return ipcRenderer.invoke('integrations:pull-config', value); },
  testNutstoreConnection: function (config) { return ipcRenderer.invoke('integrations:test-nutstore', config); },
  translateSelection: function (value) { return ipcRenderer.invoke('integrations:translate', value); },
  testTranslationConnection: function (value) { return ipcRenderer.invoke('integrations:test-translation', value); },
  getScigreatRank: function (value) { return ipcRenderer.invoke('integrations:scigreat-rank', value); },
  testScigreatConnection: function (value) { return ipcRenderer.invoke('integrations:test-scigreat', value); },
  testSources: function () { return ipcRenderer.invoke('integrations:test-sources'); },
  detectZoteroDataDir: function () { return ipcRenderer.invoke('integrations:detect-zotero'); },
  chooseZoteroDataDir: function () { return ipcRenderer.invoke('integrations:choose-zotero'); },
  importZoteroLocal: function () { return ipcRenderer.invoke('integrations:import-zotero-local'); },
  scanZoteroLibrary: function (options) { return ipcRenderer.invoke('integrations:scan-zotero', options || {}); },
  importZoteroLibrary: function (options) { return ipcRenderer.invoke('integrations:import-zotero', options || {}); },
  onZoteroProgress: function (handler) {
    var listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on('integrations:zotero-progress', listener);
    return function () { ipcRenderer.removeListener('integrations:zotero-progress', listener); };
  },
  onSyncProgress: function (handler) {
    var listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on('integrations:sync-progress', listener);
    return function () { ipcRenderer.removeListener('integrations:sync-progress', listener); };
  },
  onOpenTarget: function (handler) {
    var listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on('app:open-target', listener);
    return function () { ipcRenderer.removeListener('app:open-target', listener); };
  },
  migrateZoteroCloudAttachments: function (workspace) { return ipcRenderer.invoke('integrations:migrate-zotero-cloud', workspace); },
  getPathForFile: function (file) { return webUtils.getPathForFile(file); },
  chooseDirectory: function (options) { return ipcRenderer.invoke('files:choose-directory', options); },
  chooseFiles: function (options) { return ipcRenderer.invoke('files:choose-files', options); },
  renameFile: function (options) { return ipcRenderer.invoke('files:rename', options); },
  writePdf: function (options) { return ipcRenderer.invoke('files:write-pdf', options); },
  saveAnnotationImage: function (options) { return ipcRenderer.invoke('files:save-annotation-image', options); },
  storeNoteImage: function (options) { return ipcRenderer.invoke('files:store-note-image', options); },
  pdfSearchMeta: function () { return ipcRenderer.invoke('pdfsearch:meta'); },
  pdfSearchPut: function (value) { return ipcRenderer.invoke('pdfsearch:put', value); },
  pdfSearchQuery: function (query) { return ipcRenderer.invoke('pdfsearch:query', query); },
  pdfSearchInvalidate: function (value) { return ipcRenderer.invoke('pdfsearch:invalidate', value); },
  pdfSearchClear: function () { return ipcRenderer.invoke('pdfsearch:clear'); },
  pdfSearchStats: function () { return ipcRenderer.invoke('pdfsearch:stats'); },
  /* 调研助手（一期）：调研库 / OpenAlex 检索 / LLM 流式 / 会话 */
  researchQuery: function (input) { return ipcRenderer.invoke('research:query', input); },
  researchSearchOpenalex: function (input) { return ipcRenderer.invoke('research:search-openalex', input); },
  researchSearchScopus: function (input) { return ipcRenderer.invoke('research:search-scopus', input); },
  researchGetWorks: function (ids) { return ipcRenderer.invoke('research:get-works', ids); },
  researchStats: function () { return ipcRenderer.invoke('research:stats'); },
  researchImportHarness: function () { return ipcRenderer.invoke('research:import-harness'); },
  onResearchImportProgress: function (handler) {
    var listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on('research:import-progress', listener);
    return function () { ipcRenderer.removeListener('research:import-progress', listener); };
  },
  agentChat: function (input) { return ipcRenderer.invoke('agent:chat', input); },
  agentCancel: function (sessionId) { return ipcRenderer.invoke('agent:cancel', sessionId); },
  agentTest: function (input) { return ipcRenderer.invoke('agent:test', input); },
  agentListModels: function (input) { return ipcRenderer.invoke('agent:list-models', input); },
  /* 对话面板底部切换服务商 / 模型（只改选中项，不打开设置） */
  agentSetSelection: function (input) { return ipcRenderer.invoke('agent:set-selection', input); },
  onAgentEvent: function (handler) {
    var listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on('agent:event', listener);
    return function () { ipcRenderer.removeListener('agent:event', listener); };
  },
  sessionCreate: function (input) { return ipcRenderer.invoke('session:create', input); },
  sessionList: function () { return ipcRenderer.invoke('session:list'); },
  sessionRead: function (id) { return ipcRenderer.invoke('session:read', id); },
  sessionSetData: function (id, data) { return ipcRenderer.invoke('session:set-data', { id: id, data: data }); },
  /* R04：关键事件落盘——返回时 session.json 已提交；回传主进程登记的附件（R05） */
  sessionCommit: function (id, data) { return ipcRenderer.invoke('session:commit', { id: id, data: data }); },
  sessionOpenAttachment: function (id, file) { return ipcRenderer.invoke('session:open-attachment', { id: id, file: file }); },
  sessionRename: function (id, title) { return ipcRenderer.invoke('session:rename', { id: id, title: title }); },
  sessionDelete: function (id) { return ipcRenderer.invoke('session:delete', id); },
  sessionDeleteMany: function (ids) { return ipcRenderer.invoke('session:delete-many', ids); },
  sessionExportMarkdown: function (id) { return ipcRenderer.invoke('session:export-md', id); },
  sessionSaveAttachment: function (id, input) { return ipcRenderer.invoke('session:save-attachment', { id: id, name: input.name, label: input.label, dataBase64: input.dataBase64 }); },
  sessionOpenRoot: function () { return ipcRenderer.invoke('session:open-root'); },
  sessionRoot: function () { return ipcRenderer.invoke('session:root'); },
  /* 调研助手二期：语义检索 / 回填 / 向量嵌入 / PDF 两步 / 补登记 */
  researchSemanticSearch: function (input) { return ipcRenderer.invoke('research:semantic-search', input); },
  researchBackfill: function (input) { return ipcRenderer.invoke('research:backfill', input); },
  onResearchBackfillProgress: function (handler) {
    var listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on('research:backfill-progress', listener);
    return function () { ipcRenderer.removeListener('research:backfill-progress', listener); };
  },
  researchEmbedEstimate: function () { return ipcRenderer.invoke('research:embed-estimate'); },
  researchEmbedBuild: function () { return ipcRenderer.invoke('research:embed-build'); },
  onEmbedProgress: function (handler) {
    var listener = function (_event, payload) { handler(payload); };
    ipcRenderer.on('research:embed-progress', listener);
    return function () { ipcRenderer.removeListener('research:embed-progress', listener); };
  },
  researchEmbedUsage: function () { return ipcRenderer.invoke('research:embed-usage'); },
  embedTest: function (input) { return ipcRenderer.invoke('embed:test', input || {}); },
  researchDownloadPdfs: function (input) { return ipcRenderer.invoke('research:download-pdfs', input); },
  researchStagePdfs: function (input) { return ipcRenderer.invoke('research:stage-pdfs', input); },
  researchRegister: function (input) { return ipcRenderer.invoke('research:register', input); },
  /* R18：精确取文献 / 实体联想 / 引文邻接（agent 工具与检索面板共用） */
  researchGetWork: function (input) { return ipcRenderer.invoke('research:get-work', input); },
  researchAutocomplete: function (input) { return ipcRenderer.invoke('research:autocomplete', input); },
  researchGraphNeighbors: function (input) { return ipcRenderer.invoke('research:graph-neighbors', input); },
  /* R19：临时全文链——读窗口/下载临时 PDF；存文本并删临时文件 */
  researchFulltextRead: function (input) { return ipcRenderer.invoke('research:fulltext-read', input); },
  researchFulltextStore: function (input) { return ipcRenderer.invoke('research:fulltext-store', input); },
  /* 三期：引文网络 */
  researchGraph: function (input) { return ipcRenderer.invoke('research:graph', input); },
  /* M9-4：科研网页检索（TinyFish；开关与出境告知在设置，双端把关） */
  researchWebSearch: function (input) { return ipcRenderer.invoke('research:web-search', input); },
  researchFetchPage: function (input) { return ipcRenderer.invoke('research:fetch-page', input); },
  /* R16：段落找文献 · 多源召回 + 证据归因；Semantic Scholar 相关度检索 */
  researchFindLiterature: function (input) { return ipcRenderer.invoke('research:find-literature', input); },
  researchSearchSemanticscholar: function (input) { return ipcRenderer.invoke('research:search-semanticscholar', input); },
  ocrStatus: function () { return ipcRenderer.invoke('ocr:status'); },
  ocrEnsureData: function () { return ipcRenderer.invoke('ocr:ensure-data'); },
  // legacyFallback：只有「读该文献主 PDF 的旧版单 PDF 索引」这一种场景传 true；
  // 省略即严格按附件身份匹配（A-followup #2）
  pdfSearchGetPages: function (paperId, attachmentId, legacyFallback) {
    return ipcRenderer.invoke('pdfsearch:get-pages', { paperId: paperId, attachmentId: attachmentId || '', legacyFallback: legacyFallback === true });
  },
  pdfSearchGetPageRange: function (input) { return ipcRenderer.invoke('pdfsearch:get-page-range', input); },
  chooseSavePath: function (options) { return ipcRenderer.invoke('files:choose-save-path', options); },
  fetchCslStyle: function (styleId) { return ipcRenderer.invoke('csl:fetch-style', styleId); },
  downloadPdf: function (options) { return ipcRenderer.invoke('pdf:download', options); },
  onDownloadProgress: function (callback) {
    return ipcRenderer.on('pdf:download-progress', function (_event, data) {
      if (typeof callback === 'function') callback(data);
    });
  },
  onBeforeQuit: function (callback) {
    return ipcRenderer.on('app:before-quit', function () {
      if (typeof callback === 'function') callback();
    });
  },
  quitAck: function () { ipcRenderer.send('app:quit-ack'); },
  /* M1 关闭收尾：主进程拦截窗口 close 后请求渲染层保存收尾，closeAck 回报「已持久化/失败」 */
  onCloseRequest: function (callback) {
    return ipcRenderer.on('app:close-request', function () {
      if (typeof callback === 'function') callback();
    });
  },
  closeAck: function (result) { ipcRenderer.send('app:close-ack', result || { ok: true }); },
  windowMinimize: function () { return ipcRenderer.invoke('window:minimize'); },
  windowToggleMaximize: function () { return ipcRenderer.invoke('window:toggle-maximize'); },
  windowClose: function () { return ipcRenderer.invoke('window:close'); },
  windowIsMaximized: function () { return ipcRenderer.invoke('window:is-maximized'); },
  onWindowMaximizeChanged: function (callback) {
    return ipcRenderer.on('window:maximize-changed', function (_event, maximized) {
      if (typeof callback === 'function') callback(!!maximized);
    });
  },
  bridgeStatus: function () { return ipcRenderer.invoke('bridge:status'); },
  bridgeSetEnabled: function (enabled) { return ipcRenderer.invoke('bridge:set-enabled', enabled); },
  bridgeSetCurrentFolder: function (folderId) { return ipcRenderer.invoke('bridge:set-current-folder', folderId); },
  onLibraryUpdated: function (callback) {
    return ipcRenderer.on('library:externally-updated', function (_event, info) {
      if (typeof callback === 'function') callback(info || {});
    });
  },
  /* 沙箱渲染进程没有 process.env，smoke 标志经此暴露（i18n 用它强制中文，见 js/i18n.js） */
  isSmokeTest: !!(process.env && process.env.LITBOARD_SMOKE_TEST),
  isDesktop: true
});
