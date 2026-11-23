# 开发约定

LitBoard 是 Windows 优先、本地优先的 Electron 文献管理应用。主界面采用原生 JavaScript；AI 对话组件独立构建为 vendor bundle。

## 环境与命令

Node 下限、应用与工具版本以 [package.json](../package.json) 为准。仓库保持零 `node_modules`；构建工具由 `scripts/ensure-tools.ps1` 安装到 `%LOCALAPPDATA%\LitBoardBuildTools`。

| 命令 | 用途 |
|---|---|
| `npm start` | 开发启动 |
| `npm test` / `npm run lint` | Node 测试 / 静态检查 |
| `npm run smoke` | 自动创建隔离目录的功能冒烟 |
| `npm run smoke:lifecycle` | 写入、真实关闭、重启校验 |
| `npm run perf` | 性能基准 |
| `npm run diag:word` | Word 桥诊断 |
| `npm run dist:nobump` | 按当前版本打包；发版见[发布流程](releasing.md) |
| `npm run pack-extension` | 打包浏览器扩展 |
| `npm run check-translators` | 手动检查 translator 漂移 |

## 实现边界

- 共享可测逻辑采用 UMD 双出口，放 `js/`，配 `test/*.test.js`；前端域模块放 `js/app/`，依赖通过 `create(options)` 注入。
- 第三方库放 `vendor/`；需要打包时依赖装到仓库外，产物回存 vendor。更新[第三方清单](THIRD-PARTY.md)与 `vendor/SHA256SUMS`。
- 固定网络服务走 `electron/ipc/api.js` 主机白名单或 integrations 固定 URL；新增主机同步核对 CSP `connect-src`。不可信 OA 直链走 `electron/safe-fetch.js`。
- 主进程长任务分批让出或交给 Worker，避免阻塞窗口消息泵；性能契约见[架构](architecture.md)。
- 新界面文案用中文键经 `T()` 包裹并补词典；存库与导出数据不翻译。新增前端模块登记 i18n 扫描清单。
- 文件使用 LF；PowerShell 脚本使用 UTF-8 BOM。代码规模、命名和说明遵循全局约束。

## 验证

- 开发和测试使用隔离目录，真实数据目录 `%APPDATA%\LitBoard` 不用于验证。
- UI 结构改动同步更新 `electron/main.js` 冒烟断言；生命周期改动运行关闭、重启冒烟。
- 标准冒烟可用 `LITBOARD_SMOKE_PDF` / `LITBOARD_SMOKE_EPUB` 指定样本，`LITBOARD_SMOKE_SHOT` 指定截图，`LITBOARD_SMOKE_SCALE` 指定缩放。
- 手动启动冒烟时同时设置 `LITBOARD_SMOKE_TEST=1`、`LITBOARD_SMOKE_RESULT`，并传 `--user-data-dir=<隔离目录>`。
- 文档修改检查链接、路径、命令与事实来源；产品代码提交前运行全量测试和 lint。
