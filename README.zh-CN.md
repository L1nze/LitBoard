<div align="center">

<img src="build/icon-256.png" width="96" height="96" alt="LitBoard 图标">

# LitBoard

**面向文献收集、阅读与引用写作的本地工作台**

[English](README.md) · **简体中文** · [功能导览](docs/feature-tour.md) · [发布与下载](docs/release.md)

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D6.svg)](#安装)

</div>

LitBoard 是适用于 Windows 的本地文献管理应用，集文献库、PDF 与 EPUB 阅读、批注、笔记、检索和 Word 引用功能于一体。文献库保存在本机；WebDAV 同步与 AI 调研助手均为可选功能。

## 从文献到写作

| 环节 | 功能 |
| --- | --- |
| 收集 | 导入 PDF、BibTeX、RIS、CSL-JSON、PDF 文件夹或本机 Zotero 文献库；通过 Chrome / Edge 扩展保存受支持学术网站的文献记录。 |
| 阅读 | 在标签页中打开 PDF、EPUB 和网页快照；检索 PDF 正文、浏览文档目录，并对扫描页进行 OCR。 |
| 批注 | 在 PDF 中添加高亮、下划线和评论；将批注摘录到可定位原文的笔记，并可将批注写回 PDF 文件。 |
| 检索 | 检索元数据、笔记、批注及已建立索引的文档正文；组合筛选条件，并将查询保存为智能文件夹。 |
| 写作 | 使用 CSL 样式在 Microsoft Word 中插入和更新引文及参考文献表，或导出 BibTeX 供 LaTeX 与 Typst 使用。 |

## AI 调研助手

调研助手可将一段论文论述拆分为具体论点，分别检索候选文献，并根据摘要中的相关内容区分有证据支持、仅部分相关和未找到依据的结果。用户还可以就论文方法、图表及相关研究继续提问。

- **发现文献**：检索主文献库和独立调研库，并通过 OpenAlex、Semantic Scholar 发现新文献；配置 Elsevier API Key 后可检索 Scopus。支持关键词检索和段落级语义检索。
- **核对论述**：逐条检索候选文献，展示摘要中的相关语句及其来源；不将仅标题相似的文献视为充分证据。
- **阅读原文**：按页或章节读取已建立索引的 PDF、EPUB 正文，并可临时提取开放获取文献的全文。使用支持图像输入的模型时，可渲染含公式、图表或扫描内容的页面，并标明实际读取的范围。
- **梳理关联**：根据文献的引用关系生成交互式网络，以便查找相关研究。
- **保存结果**：保留对话和工具调用记录，支持继续会话或重试。将发现的文献或下载的 PDF 收入主文献库前需经用户确认，并执行库内去重检查。

调研数据与主文献库分开保存。模型服务端点、向量模型及访问凭据由用户配置；未配置 AI 服务时，仍可使用手动文献检索。模型请求和在线检索会访问相应的外部服务；本地文献库可离线使用。

## 安装

Windows x64 安装版和便携版的获取方式及校验方法见[发布与下载说明](docs/release.md)；实际可下载文件以仓库发布页为准。

1. 运行安装程序，或启动便携版。
2. 导入 PDF、BibTeX、RIS 或 CSL-JSON 文件；也可将 PDF 文件夹拖入左侧文件夹栏。
3. 如需导入现有 Zotero 文献库，打开“设置 → 集成与服务 → Zotero 本机资料库”。
4. 在积累重要资料前，通过“设置 → 数据与备份”选择快照保存位置。

安装版和便携版均无需另行安装 Node.js。仅在直接向 Word 插入引文时需要 Microsoft Word。

### 浏览器扩展

Chrome / Edge 扩展通过 LitBoard 内置的接收服务连接应用。在应用顶栏打开“扩展”，启用接收服务并复制令牌；随后在浏览器的扩展管理页面启用开发者模式，加载解压后的扩展目录：安装版位于应用目录的 `resources/extension/`，开发环境位于项目根目录的 `extension/`。最后在扩展选项页面填写端口和令牌。

## 数据、同步与更新

- 主文献库、笔记和受管附件默认存储在 `%APPDATA%\LitBoard`，也可使用用户指定的数据目录。
- 多设备同步可使用用户自己的坚果云 WebDAV 账号；“数据与备份”提供快照和恢复功能。
- 应用目前不提供自动更新。下载新版本后可覆盖安装；建议在升级前创建数据快照。
- 构建产物尚未进行代码签名，Windows SmartScreen 可能显示“未知应用”提示。运行前可使用发布的 SHA-256 校验值验证文件。

## 从源码运行

开发环境需要 Node.js 22.13.0 或更高版本。项目脚本将 Electron 和构建工具安装在仓库外，项目目录不使用 `node_modules`。

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd start
npm.cmd run dist:nobump
```

`npm run dist` 会在打包前自动递增补丁版本号；如需按当前版本构建，请使用 `npm run dist:nobump`。

## 许可证与第三方组件

LitBoard 自有代码采用 [AGPL-3.0-only](LICENSE) 许可证。随应用分发的第三方组件适用各自的许可证；组件清单及相关许可信息见[第三方组件清单](docs/THIRD-PARTY.md)。
