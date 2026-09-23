# 贡献指南 · Contributing to LitBoard

> **English TL;DR** — LitBoard is a local-first literature manager for Windows (Electron 44 + framework-free
> frontend). Run `npm test` before every PR; the suite is pure Node and needs no `npm install`. Do not add
> `node_modules` dependencies — vendor single-file libraries into `vendor/`. The architecture
> invariants are summarized under 「代码约定」 and 「新增功能前请先确认硬性约束」 below. The UI is
> currently Chinese-only. Full guide below is in Chinese.

---

几条「改了就会出事」的红线集中在下面「代码约定」与「新增功能前请先确认硬性约束」两节，**动手前请先读**。

## 环境要求

| 项目 | 要求 | 说明 |
|---|---|---|
| Node.js | **≥ 22.13.0** | 存储层用 `node:sqlite`，22.13 之前该模块需要 `--experimental-sqlite` 且不可用；24.x 为当前验证版本（见 `.nvmrc`） |
| 操作系统 | Windows 10/11 | **应用只在 Windows 上构建**（打包脚本为 PowerShell，产物为 NSIS + Portable EXE） |
| 依赖 | **无需 `npm install`** | 见下 |

macOS / Linux 可以运行测试套件（CI 已覆盖 `ubuntu-latest`），但**不能构建或运行应用本体**——窗口控制、数据目录、打包链路都是 Windows 专属的。

## 两条开发路径（二选一）

### A. 外置工具链（默认，推荐）

项目目录**保持零 `node_modules`**。Electron 与 electron-builder 由脚本装到用户目录：

```powershell
npm test               # 纯 Node 测试，不需要任何安装
npm run lint           # ESLint；eslint 缺失时会自动装到 %LOCALAPPDATA%\LitBoardLintTools
npm start              # 首次会自动下载外置 Electron 到 %LOCALAPPDATA%\LitBoardBuildTools
npm run dist           # 打 NSIS + Portable 到 dist/（自动把版本 patch +1）
npm run dist:nobump    # 同上但不动版本号
npm run pack-extension # 打浏览器扩展到 dist/LitBoard-Extension.zip
```

想用国内镜像加速首次下载，自行设置环境变量即可（不再写死默认值）：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm start
```

### B. 标准 npm 流程（可选）

`package.json` 里已声明 `devDependencies`（electron / electron-builder / eslint），方便 CI 与习惯常规流程的贡献者：

```powershell
npm install --ignore-scripts   # 阻止 Electron 下载二进制；仅在需要 npx electron 时才省略
npx electron .                 # 启动
npx electron-builder --win nsis portable --x64
```

`node_modules/` 已被 `.gitignore` 忽略，但**不要把它提交进仓库，也不要在 PR 里新增运行时依赖**。

## 测试

```powershell
npm test
```

- 纯 Node（`node:test`），**不加载 Electron**，秒级跑完，可用 `node --test --watch` 或 `--test-only` 加快迭代；
- 新写的共享逻辑必须有对应测试。可被 Node 直接测试的逻辑放 `js/*.js`，用 UMD 双出口（照抄 `js/model.js` 的写法）并配 `test/*.test.js`；
- 涉及 UI 结构的改动，需同步更新 `electron/main.js` 里的 smoke 断言；
- **绝不要读写 `%APPDATA%\LitBoard`**——那是真实用户数据。开发、测试、smoke 一律用隔离目录：

```powershell
$env:LITBOARD_SMOKE_TEST = '1'
$env:LITBOARD_SMOKE_RESULT = "$env:TEMP\smoke.json"
npx electron . --user-data-dir="$env:TEMP\litboard-smoke"
```

## 代码检查

```powershell
npm run lint          # 或 npm run lint -- --fix
```

- 配置是自包含的扁平配置 [`eslint.config.js`](eslint.config.js)，不依赖 `@eslint/js` / `globals` 包；
- 只启用「真 bug」类规则（未定义标识符、重复声明、不可达代码、`eval`、危险正则等），**不做风格审查**；
- 目前 **0 error / 19 warning**，CI 以 error 为门槛。`no-unused-vars` 等存量问题按 warning 起步，欢迎逐条清理后把规则升为 `error`；
- 需要临时压制时请写 `// eslint-disable-next-line <rule> -- <原因>`，不要整文件禁用。

## 代码约定

- **依赖**：不引 `node_modules`。需要第三方库时找可 vendor 的单文件实现放进 `vendor/`，并在 README「第三方组件与许可」一节登记（库名、版本、来源、许可）；
- **网络出口**：主进程发起请求必须走 `electron/main.js` 的 `ALLOWED_API_HOSTS` 白名单或 `integrations.js` 内的固定 URL；新增主机要同步加白名单和 `index.html` 的 CSP `connect-src`；
- **数据模型**：`js/model.js` 是唯一校验权威，所有进出库数据都过 `normalize*`。附件一律走 `attachments`，**不要直接写 `pdfPath` 等旧字段**；
- **弹窗**：禁止原生 `alert/confirm/prompt`，统一用 `#dlg-mask` 的 `dlgConfirm / dlgPrompt / dlgPick`；
- **行尾**：LF（`.gitattributes` 会自动处理）。**`.ps1` 必须带 UTF-8 BOM**：Windows PowerShell 5.1 在 GB2312 代码页下会把无 BOM 脚本里的中文注释解析错乱，吞掉紧随其后的那行代码；
- **注释与 UI 文案**：目前统一为中文。这是已知的国际化缺口，语言方案确认前请沿用中文。

## 提交与 PR

- 提交信息建议 `type(scope): 摘要`，类型用 `feat` / `fix` / `refactor` / `docs` / `chore` / `test` / `perf`，与 `CHANGELOG.md` 的分类对齐；
- PR 请填满模板里的自查清单，并说明**怎么验证**（复现步骤、截图或测试输出）；
- 一个 PR 只做一件事。重命名、格式化、跨文件重构请单独提；
- 不确定的取舍先开 issue 讨论，别直接写 500 行。

## 新增功能前请先确认硬性约束

1. 能完全离线工作，或只访问已有白名单主机（OpenAlex / Semantic Scholar / Crossref / PubMed / OpenLibrary）；
2. 不需要项目自建服务器（本项目管理上就不存在服务端）；
3. 不引入运行时第三方依赖；
4. 数据可迁移：任何新字段都要能在 `model.js` 的 schema 里被校验和迁移，且不破坏旧库。

## 许可

贡献即表示你同意以本项目的许可证发布你的代码。第三方组件许可见 README；`vendor/` 下的代码各自遵循其原始许可。
