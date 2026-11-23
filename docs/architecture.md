# 架构与模块契约

版本以模块常量为准；这里只保留入口和容易破坏的数据、交互契约。同步与 AI 分别见[同步](sync.md)、[调研助手](agent.md)。

## 数据、存储与检索

| 模块 | 入口与契约 |
|---|---|
| 数据模型 | `js/model.js` 是校验权威，进出库经 `normalize*`；附件、创作者、日期、笔记分别以 `attachments / creators / date / 顶层 notes` 为准，旧字段只是兼容投影。 |
| 主库 | `electron/db.js`：SQLite WAL、冗余列与 JSON、按内容签名增量保存；迁移走 `PRAGMA user_version`，v4+ 迁移前备份。 |
| 保存基线 | `saveState.baseSignatures` 必须来自应用变更前已确认的数据库状态；批量应用前快照 `persistedWorkspaceSignatures`，应用后还原再保存。 |
| 删除 | `deletePaper` 同时清文献、全文索引与附属笔记。 |
| 数据目录 | 新配置子目录登记 `electron/data-paths.js` 的 `MANAGED_CONFIG_DIRS`；更换数据目录按搬移语义处理。 |
| 备份 | `listSnapshots` 默认只读 manifest；恢复或显式 verify 才深检。记账写入不进数据库；份数读取 `keepLimit()`，不写死。 |
| 查询 | `js/query.js` 的版本化 AST；智能文件夹以 `savedSearch.ast` 为准；`ann(...)`、`note(...)` 组内条件须由同一对象满足。 |
| 撤销 | 会话级快照对；永久删除、PDF 写回、远端同步写入不入撤销栈。 |

性能：`pdf_fts` 不对整批命中计算 `snippet()`；短于 3 字符的 LIKE 回退分批让出。调研库内容不变不重建 `works_fts`，重建须带 `fulltext`；`queryWorks` 不全量计数；`inLibraryIndex` 按 `lastLibraryWriteAt` 缓存。护栏见 `test/db.test.js`、`test/research-db.test.js`。

## 导入

- `js/zotero.js`：以 `sourceLibraryId + zoteroKey` 匹配；幂等、补缺、不覆盖本地编辑。
- `addPapers / LitDedupe`：指纹 → DOI → 规范化标题，一次建立全库索引；重复条目经 `mergeAttachmentsDetailed` 挂附件。
- PDF 解析使用 3 个 worker；整棵文件夹一次 `addPapers`、一次保存。
- 浏览器扩展：MV3 → `electron/bridge-server.js`，仅本机监听并验证 token；先注入 translators，再 content；专用 translator 优先。

## 界面与 IPC

- `js/app.js` 负责工作区状态与编排，域模块见 `js/app/`。
- 右栏三面板互斥：用户打开文献走 `openDrawerAndReveal`，内部刷新走 `openDrawer`。
- 顶栏菜单登记 `registerTopbarMenu`，遵守全局浮层顺序；弹窗统一 `#dlg-mask`，不使用原生 confirm/prompt/alert。
- Word 与扩展为顶栏独立弹窗。无边框窗口控制位于 `#window-controls`，走 `window:*` IPC。
- IPC 按域放 `electron/ipc/`；`registerAll()` 仅调用一次。共享状态在 `ipc/context.js`；handler 执行时读 `ctx.X`，不解构捕获。
- IPC 校验受信窗口与顶层 frame；preload 通道对等由 `test/ipc-parity.test.js` 检查。

## PDF、OCR 与 EPUB

- MuPDF.js 单内核：`mupdf-worker` 独占 WASM，`mupdf-client` RPC，`pdfimport` 门面；光栅、文本与批注读写使用同一内核。
- 文本几何保持 `text.length === quads.length / 8`；搜索与文本层使用相同 items 过滤规则，空串占位保留，`fragment.itemIndex` 对应 textDivs 下标。
- 缩放、版式通过 `handle.relayout` 原位重排；换查询重画全部已渲染页；渲染页码为 1 基物理页，多页截图用 `LitPdf.renderPagesToPng`。
- 默认位图对齐设备像素；显式离屏倍率与 Canvas 像素上限保留。
- OCR：PaddleOCR；`js/ocr.js` 保持 dataStatus/ensureData/ocrPages/cancel 门面。输入及结果页索引为 0 基，进度 page 为 1 基；异步读写冻结目标附件身份。
- EPUB：foliate-js 钉 commit，`js/epub.js` 适配；旧 CFI 失败走 textAnchor，再走章节定位兜底。CSP 保留所需 `blob:`。
- 引擎迁移结论与复核项见[阅读内核迁移](handoff-ocr-epub.md)。

## 引用、Word 与笔记

- 引用统一 citeproc CSL（`js/cslcite.js / js/cite.js`）；GB/T 7714 两变体按现有定制省略 DOI/URL。
- `js/docx.js` 使用 vendored JSZip 确定性输出；引文域指令独立命名、版本化。
- `word/wordbridge.js` 是常驻 JScript COM：纯 ASCII、ES3、无原生 JSON 依赖；写入用 RTF，先 wdFieldQuote 占位再重写 Code.Text。修改后重启应用。
- 摘录块遵循 `js/excerpt.js` 的 `<!--lbex-->` 与 sourceUpdatedAt 判旧规则。
- 笔记 Markdown 保留数学边界；AI 对话由 MathJax 排版。富文本走 `js/noteml.js` 白名单，图片存受管 `note-assets/`。
