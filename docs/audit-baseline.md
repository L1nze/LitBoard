# 审计基线（audit baseline）

> 记录每次审查与验收的**证据**：环境、版本、命令、结果数字。所有条目标注三态之一：
> **代码已确认**（读代码即可断定）/ **运行已复现**（在本机执行并观测）/ **待验证**（尚未运行验证）。

## 环境

- 项目：LitBoard 1.2.0（`package.json`），Node engines `>=22.13.0`
- 审计机：Windows 10.0.26100 x64，Git Bash；Node v24.x（见下）
- 真实用户数据位于 `%APPDATA%\LitBoard`，**全程未接触**；所有运行验证使用隔离目录。

## 2026-09-17 开源前审查（初次基线）

### 通过项（运行已复现）

| 项目 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npm test` | **387/387 通过**，0 失败，9.1 s |
| ESLint | `npm run lint` | 退出码 0 |

### 问题清单（本次输入）

| # | 问题 | 状态 | 证据 |
|---|---|---|---|
| 1 | 富文本笔记编辑器 `close()` 无条件清空内容，无 dirty 守卫；`save()` 直接改正式实体后关闭 | 代码已确认 | `js/noteeditor.js` `save()`/`close()`；`open()` 迁移时直写 `note.sourceMarkdown` |
| 2 | Esc 一次隐藏**所有**可见弹窗（固定列表 forEach），无栈语义 | 代码已确认 | `js/app.js` 全局 keydown（`'note-edit-mask'` 等列表逐个 hidden=true） |
| 3 | 退出握手在 `will-quit` 才发 `app:before-quit`；渲染层 `saveNotes.flush()` 触发的保存是异步的，`quitAck` 最多等 4 s 定时器，不等待数据库写完成 → 存在关闭时丢最近编辑的窄窗 | 代码已确认 | `electron/main.js` `will-quit`（5 s 超时）；`js/app.js` `onBeforeQuit` 处理器 |
| 4 | 宽度 ≤1220 时 `.pdf-search-box { display: none }`，而 Ctrl+F 仅 `focus()`（对隐藏元素无效）；窗口最小宽 1080 → 存在合法宽度下 PDF 搜索不可达 | 代码已确认 | `css/style.css` `@media (max-width: 1220px)`；`js/app.js` Ctrl+F 分支 |
| 5 | 实体结果（批注/笔记/附件）无分页，全部生成 DOM；每个命中 `papers.find()` 线性查文献 | 代码已确认 | `js/app.js` `renderEntityHits()` |
| 6 | `saveState` 每次保存 `loadState()` 全库读 + 两份全库签名计算（前端 + DB 各一次） | 代码已确认 | `electron/db.js` `saveState()`；`js/app.js` `save()`（`workspaceSignatures`） |
| 7 | 外置构建工具只检查文件存在，不核对版本 → 升级 `package.json` 后可能继续用旧 Electron | 代码已确认 | `scripts/ensure-tools.ps1`（仅 `Test-Path`） |
| 8 | `.git` 是空目录，Git 报 "not a git repository" → 无历史可审计，也无法版本化 | 运行已复现 | `git status` fatal；`ls .git/` 为空 |
| 9 | 桥接服务 CORS `Access-Control-Allow-Origin: *`（token 仍在，未见绕过证据） | 代码已确认 | `electron/bridge-server.js` `send()` |
| 10 | IPC 未校验调用来源窗口 / 顶层 frame | 代码已确认 | `electron/main.js` `registerIpc()`（所有 handler 直接信任 event） |
| 11 | 根目录存在调试残留 `repro-*.html/js/pdf` | 运行已复现 | 根目录列表（已移入 `.tmp/repro-artifacts/`） |
| 12 | SECURITY.md 安全联系邮箱是 `<TODO: 填写安全联系邮箱>` 占位 | 代码已确认 | `SECURITY.md` |
| 13 | toast 失败提示 2.6 s 后消失，不可找回 | 代码已确认 | `js/app.js` `toast()` |
| 14 | PDF 首屏串行等待、PDFium 位图渲染在 UI 线程同步执行 | 待验证（代码路径存在，未实测量化） | `js/pdfium.js` 渲染管线 |
| 15 | 启动 / 保存 / 检索等无分段计时，性能预算无从对照 | 代码已确认 | 全库无 `performance.mark` 分段记录 |

### 未验证事项（本轮不做、留待后续）

- GUI 实测（安装 / 升级 / 卸载保留 / 视觉评审）：无运行界面环境，标注**待验证**。
- 真实关闭→重启数据一致性：依赖 M1 改造完成后用隔离目录冒烟验证。
- 历史敏感信息扫描：`.git` 无历史（空仓库），**无对象可扫**；首次 commit 由维护者复核后创建。
- 五万篇压测与性能预算对照：待 M4 基准数据生成后回填本文件。

## 基线数据回填区

（M4 分段计时落地后，把真实 smoke / 基准数字写在这里，注明环境与命令。）

### 冷启动 + 空库基准（2026-09-17，运行已复现）

- 环境：Windows 10.0.26100 x64（审计机，笔记本级硬件），Node v24.14.1，Electron 39.2.7（外置工具，非打包产物），隔离 userData。
- 命令：`node scripts/perf-baseline.js 5`（每轮全新隔离目录，`LITBOARD_SMOKE_TEST=1` 隐藏窗口运行）。
- 指标口径：`mainBootMs` = 主进程模块加载 → 页面 did-finish-load（含渲染层脚本求值）；
  `libraryLoadMs` = 渲染层 load() 完成并 `renderAll()` 后的时刻（`litboardReadyAt`）；
  `loadLibraryMs` / `saveLibraryMs` = 渲染层在 smoke 中同步计时的整库读 / 全量写。
- 结果（n=5，0 失败）：

| 指标 | P50 | P95 | min | max |
|---|---|---|---|---|
| mainBootMs | 972 ms | 991 ms | 964 ms | 991 ms |
| libraryLoadMs | 248 ms | 259 ms | 240 ms | 259 ms |
| loadLibraryMs（空库） | 1 ms | 1 ms | 0 ms | 1 ms |
| saveLibraryMs（空库全量） | 1 ms | 1 ms | 1 ms | 1 ms |

- 生命周期冒烟（`npm run smoke:lifecycle`）：write 阶段真实关闭收尾 `closeAckMs`（close 拦截→保存→ack），
  首次实测 ≈0.1–0.3 s（空库、无待保存变更）。
- **注意**：这是空库相对基准，用于回归对比；不是计划第四节的正式验收（需 1 万篇确定性数据集、
  受控硬件、发布构建、冷/热启动各 20 次）。数据集生成器落地后重测并替换本节。
