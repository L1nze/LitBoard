<div align="center">

<img src="build/icon-256.png" width="96" height="96" alt="LitBoard 图标">

# LitBoard

**把文献收集、阅读和引用写作放在同一个本地工作台**

[English](README.md) · **简体中文** · [发布与下载](docs/release.html)

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D6.svg)](#安装)

</div>

LitBoard 是 Windows 上的本地文献工作台。资料库、PDF 与 EPUB 阅读、批注、笔记、检索和 Word 引用集中在一个应用里。文献库保存在自己的电脑上；WebDAV 同步和 AI 调研助手可按需启用。

## 从文献到写作

| 步骤 | LitBoard 可以做什么 |
| --- | --- |
| 收集 | 导入 PDF、BibTeX、RIS、CSL-JSON、整棵 PDF 文件夹或本机 Zotero 资料库；通过 Chrome / Edge 扩展保存受支持学术网站的条目。 |
| 阅读 | 在标签页中打开 PDF、EPUB 和网页快照；检索 PDF 内容、浏览目录，并对扫描页做 OCR。 |
| 批注 | 在 PDF 中高亮、加下划线和写评论；把批注摘录到可跳回原文的笔记，并可将批注写回 PDF 文件。 |
| 查找 | 检索元数据、笔记、批注和已索引的文档正文；组合筛选条件，并保存为智能文件夹。 |
| 写作 | 用 CSL 样式向 Microsoft Word 插入和刷新引文、参考文献表，或导出 BibTeX 供 LaTeX 与 Typst 使用。 |

## AI 调研助手

例如，把引言中的一段论述交给助手，它可以先拆出具体论点，再逐条找文献、查看摘要里的相关证据，并把“有支持”“仅部分相关”“未找到依据”区分开。你可以继续追问某篇论文的方法、某个图表，或它与其他工作的关系。

- **发现文献**：检索正式库和独立调研库，并从 OpenAlex、Semantic Scholar 等来源发现新文献；配置 Elsevier Key 后也可检索 Scopus。支持关键词与段落语义检索。
- **核对论述**：为一段文字逐条寻找候选文献，展示摘要中的证据句与出处。标题相近但证据不足的结果不会算作已证实。
- **细读原文**：按页读取已有 PDF 或 EPUB 的索引正文；对开放获取文献可临时提取全文。公式、图表或扫描页可在支持图像的模型下渲染页面辅助理解，并标明实际读取范围。
- **梳理脉络**：从文献的引用关系扩展为可交互网络，沿着相关工作继续查找。
- **留下结果**：对话和工具过程可留存、继续或重试；选中的文献、下载的 PDF 收入正式库前会先让你确认，并按库内规则去重。

调研过程与正式文献库分开保存。模型端点、向量模型及凭据由你配置；不配置 AI 服务仍可使用手动文献检索。模型请求和在线检索会访问相应外部服务，离线时本机文献库仍可使用。

## 安装

目前提供 Windows x64 安装版与便携版。可在[发布与下载页](docs/release.html)查看可用文件和校验方法。

1. 运行安装包，或直接启动便携版。
2. 拖入 PDF、BibTeX、RIS 或 CSL-JSON 文件；也可以把 PDF 文件夹拖入左侧文件夹栏。
3. 如需迁移 Zotero，打开“设置 → 集成与服务 → Zotero 本机资料库”。
4. 开始积累重要资料前，在“设置 → 数据与备份”选择快照位置。

使用打包版无需安装 Node.js。只有直接向 Word 插入引文时才需要 Microsoft Word。

### 浏览器扩展

Chrome / Edge 扩展通过 LitBoard 内的接收服务连接。先在应用顶栏打开“扩展”，启用接收服务并复制令牌；再到浏览器扩展管理页开启开发者模式，加载解压后的 `extension/` 目录，并在扩展选项页填写端口和令牌。

## 数据、同步与更新

- 主文献库、笔记和受管附件默认保存在 `%APPDATA%\LitBoard`，也可选择其他数据目录。
- 多机同步可使用自己的坚果云 WebDAV 账号；“数据与备份”提供快照和恢复。
- 目前没有自动更新。下载新版后可覆盖安装；资料重要时建议先做一次快照。
- 安装包尚未做代码签名，Windows SmartScreen 可能提示“未知应用”。运行前可用发布的 SHA-256 校验值核对文件。

## 从源码运行

开发环境需要 Node.js 22.13.0 或更高版本。项目脚本把 Electron 与构建工具安装在仓库外，不在项目目录生成 `node_modules`。

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd start
npm.cmd run dist:nobump
```

`npm run dist` 会在打包前自动将 patch 版本号加一；若要按当前版本构建，请使用 `dist:nobump`。

LitBoard 自有代码采用 [AGPL-3.0-only](LICENSE) 许可证；随应用分发的第三方组件沿用各自许可证。
