# 发布流程（releasing）

> 面向维护者的手动发布清单。首版策略：**手动升级、本地可审核的发布候选包**；
> 代码签名、商店分发、自动更新均未启用（后续另立任务）。

## 前置门槛（对应 docs/roadmap.md M5）

- [ ] `npm test` 与 `npm run lint` 全绿；CI 的 `package-smoke` job 通过（含打包产物冒烟与生命周期冒烟）。
- [ ] `npm run smoke`（标准断言）与 `npm run smoke:lifecycle`（写入→真实关闭→重启→校验）本机通过。
- [ ] 无未解决的数据丢失或高风险安全问题；备份恢复流程（设置 → 数据与备份 → 恢复）验证通过。
- [ ] CHANGELOG.md 已更新本版本条目。

## 构建与校验

1. 版本号：`package.json` 的 `version`（唯一真源）。`npm run dist` 会在打包前**自动把 patch +1**
   （同时同步 `package-lock.json` 的顶层与 `packages[""]` 两处），所以每次重新打包都会得到新的
   安装包名与校验和，不用手动改。要发 minor/major 就先手动抬一次，再照常打包：

   ```powershell
   npm run bump-version -- --level=minor   # 加 --dry-run 可先看效果（不写文件）
   ```

   想用当前版本打包（不改文件）用 `npm run dist:nobump`——CI 走的就是这条：CI 无法把版本提交回
   仓库，产物版本必须与仓库一致。
2. 构建发布包（NSIS 安装器 + Portable）：

   ```powershell
   npm run dist
   ```

   产物在 `dist/`：`LitBoard-Setup-<版本>-x64.exe`、`LitBoard-Portable-<版本>-x64.exe`；
   `<版本>` 是本次自动迭代后的版本号，构建日志首行会打印改动（如 `LitBoard 版本：1.2.0 → 1.2.1`）。
3. 生成校验和（连同安装包一起发布）：

   ```powershell
   npm run release-checksums
   ```

   产出 `dist/SHA256SUMS.txt`，含哈希、文件大小与构建环境（Electron / electron-builder 版本）。
4. 记录本次构建的依赖指纹：`vendor/SHA256SUMS`（`npm run vendor-hashes` 可重生成）应与仓库一致。
5. 打包会让 `package.json` / `package-lock.json` 变脏（版本 +1）：确认无误后把它们连同
   `CHANGELOG.md` 的本版本条目一起提交，别把版本改动留在未提交的工作区里。

## 发布前人工验收（每次必做）

- [ ] 全新安装：在干净虚拟机/沙盒安装 Setup 版，走一次「导入 → 阅读 → 批注 → 笔记 → 导出 → 备份」。
- [ ] 覆盖升级：在装有旧版本的机器上直接安装新版，确认库数据、附件、设置完整保留。
- [ ] Portable：解压/拷贝到非系统盘运行，确认配置目录写入位置正确（不污染安装目录）。
- [ ] 卸载保留：卸载 NSIS 版后确认 `%APPDATA%`（或自定义配置目录）数据原样保留。
- [ ] 打包产物冒烟：`node scripts/smoke.js dist\win-unpacked\LitBoard.exe`（若 win-unpacked 已被清理，
    重新以 `--win portable` 调 electron-builder 生成后再测）。

## 发布渠道

- 首版：GitHub Release（源码归档 + 两个安装包 + SHA256SUMS.txt）。Release Notes 从 CHANGELOG 摘录。
- 用户升级：手动下载新安装包覆盖安装；README（中文版 `README.zh-CN.md`）「完整备份与数据库安全」一节说明升级前可先手动备份。

## 明确不做（本轮约束）

- 不自动 commit / push / 发布；Release 由维护者在 GitHub 上手动创建。
- 不做代码签名（用户首次运行会遇 SmartScreen 提示——在 README 已说明）。
- 不做自动更新通道；不做商店分发。
