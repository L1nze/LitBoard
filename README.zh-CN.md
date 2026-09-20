<div align="center">

<img src="build/icon-256.png" width="128" height="128" alt="LitBoard 图标">

# LitBoard · 文献阅读仪表盘

**本地优先的文献管理与阅读工作台（Windows）**

收藏、阅读、批注、笔记、检索、引用 —— 全部装在本机的一个 SQLite 文件里。

[English](README.md) · **简体中文**

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D6.svg)](#环境要求)
[![Electron 39](https://img.shields.io/badge/Electron-39-47848F.svg)](#开发与构建)
[![UI: bilingual](https://img.shields.io/badge/UI-bilingual%20(zh--CN%20%2F%20en)-green.svg)](#界面语言)
[![Data: local SQLite](https://img.shields.io/badge/data-local%20SQLite%20only-informational.svg)](#联网与隐私)

</div>

LitBoard 是本地优先的个人文献管理工具。文献库就是本机的一个 SQLite 数据库——没有账号、没有服务端、没有遥测——
却覆盖了完整的科研闭环：收集文献、阅读 PDF/EPUB/扫描件、做「不脱离原文」的批注与笔记、按子串全文检索，
最后从同一个库里把引文写进 Word、LaTeX 或 Typst。云同步是可选项，而且用的是你自己的坚果云 WebDAV 账号。

> **界面语言**：简体中文 / English，设置 → 偏好切换，即时生效。文档以中文为主，英文入口见 [README.md](README.md)。

## 主要特色

- **本地优先**：文献、笔记、批注与索引都住在 `%APPDATA%\LitBoard\litboard.sqlite`。不上传任何 LitBoard 服务器——
  因为项目根本没有服务器。
- **能读你手上的东西**：PDF（含无文本层扫描件）、EPUB、Zotero 网页快照，同一个多标签阅读器 + 同一个搜索框。
- **批注能写回 PDF**：高亮/下划线/便签/区域截图/手写一律写回为标准 PDF 批注，外部阅读器可见；
  文件里已有的批注打开时自动导入。
- **笔记不脱离出处**：每个摘录块都记着它来自哪条批注，来源一改就出现 stale 徽标，让你「采用更新 / 保留 / 移除」，
  而不是把过期的引文静默留在正文里。
- **按子串检索**：FTS5 trigram 索引直接搜中英文子串，不需要分词；在此之上还有高级检索语法与智能文件夹。
- **引用不必离开文献库**：内置 11 种 CSL 样式（GB/T 7714、APA 7、MLA 9、Nature、IEEE、Vancouver、Elsevier、Chicago…），
  可在线拉取官方样式库，保存即自动导出 `.bib`，Word 集成零安装零宏。
- **同步与备份归你自己管**：坚果云 WebDAV 多设备同步（冲突可逐字段对照），加上内容寻址的每日完整快照。
- **可选的 AI 调研助手**跑在**独立的调研库**里，实验再野也碰不到你的正式库。

## 功能

### 收集

- 导入 `.bib`、`.bibtex`、`.txt`、`.json`（LitBoard 备份 / CSL-JSON）、`.ris` 和 `.pdf`；文件可直接拖进窗口。
  EndNote 用户请先导出 RIS 再导入。
- **浏览器扩展（Chrome/Edge，MV3）**：出版社页、arXiv、PubMed、Google Scholar、bioRxiv/medRxiv、PLOS、
  **知网 CNKI** 等 15+ 站点一键保存（自动保存，无需再点按钮），自动抓取元数据并下载开放获取 PDF；
  保存位置可选文件夹（默认当前查看的文件夹，如 Zotero）；页面缺失的 DOI 走 OpenAlex → Crossref 补全，
  知网 PDF 凭浏览器登录态下载后挂入附件。
- **快速添加**：粘贴 DOI / arXiv 编号 / PMID / ISBN / 标题即可联网抓取全部元数据入库。
- PDF 前两页提取 DOI/标题，并记录本地 PDF 路径。
- **一键下载 PDF**：从 OpenAlex / Semantic Scholar 查找开放获取全文；支持机构代理（EZproxy）前缀访问。
- **Zotero 导入**：本机 `zotero.sqlite` 只读导入（含快照回退）+ Zotero 云附件迁移；文件夹按 id 合并并保留本地重命名，
  已有条目补缺不覆盖。
- OpenAlex、Semantic Scholar、Crossref、PubMed、OpenLibrary 元数据补全（支持批量与单条）；
  按 DOI / 规范化标题 / PDF 内容指纹查重去重。
- 12 种条目类型；手动新建与编辑任意字段（卷/期/页/出版社/ISSN/ISBN/语言/citekey 等）。

### 阅读

- **内置 PDF 阅读器**：多标签、大纲/缩略图侧栏、阅读位置记忆、双栏、旋转、文内词级搜索。
- **EPUB 阅读器**（同一条标签栏）：章节导航、字号与主题、可点击跳转的进度条，阅读位置按附件存 CFI。
- **PDF 重排模式**：把页面重建为干净的纯文本流，窄窗口与小屏幕友好。。
- **扫描件 OCR**：整页/全文识别（中英双语），结果直接进入全文索引。
- 缩放、版式、旋转**原位重排**：旧位图先作预览拉伸，新位图渲染完成原子替换，不闪白屏。
- 拖选走几何管线：所见高亮、复制文本与批注坐标三者一致。

### 批注与摘录

- 高亮、下划线、批注、区域截图、手写。
- **批注写回 PDF 文件**（标准批注，外部阅读器可见）；**导入 PDF 内已有的标准批注**。
- 单条批注、按颜色/标签筛出的批注组、或整篇批注，一键作为**摘录块**进入笔记。
- 摘录块是稳定契约（`<!--lbex {json} -->`），携带 paperId/attachmentId/annotationId/页码、来源时间戳与引用快照，
  Markdown ↔ 富文本 ↔ Word 往返不丢出处。
- 出处定位协议：`litboard://open/paper/<id>?attachment=&annotation=&page=`，从笔记、浏览器扩展或外部程序直达那条高亮。

### 笔记

- **富文本笔记**：宽弹窗 contenteditable 编辑器（标题/列表/表格/图片），白名单 sanitize 是唯一进出通道。
- 图片落在受管 `note-assets/` 目录，随备份与同步一起走。
- 旧的 Markdown 笔记打开即单向迁移，原文保留在 `note.sourceMarkdown`，导出不失真。
- 笔记是一等实体：稳定 ID、主题笔记（无 paperId）、删除墓碑；`paper.notes` 只是首条笔记的兼容投影。
- 侧栏「导出 Word」：引用与参考文献与 Word 插件同一套 CSL 渲染口径，直接产出 `.docx`。
- Markdown 预览支持笔记图片与 `litboard://` 内部链接。

### 整理与检索

- 文件夹拖拽归类（多选整批拖入）、`父/子` 层级标签与颜色、五星评分、未读/在读/已读状态。
- **高级检索语法**：`tag:综述 year>=2020 AND has:pdf`、引号短语、`/正则/`、括号分组、`folder:"名称"`（含子文件夹下钻）、
  `missing:doi`、`has:epub|snapshot|supp|attachment`，以及跨层级条件组 `ann(text:"量子" color:#ffd400)`
  （组内条件必须由同一条批注满足）。任意查询可存为**智能文件夹**（版本化 AST，铅笔按钮可编辑）。
- 文件夹与智能文件夹 **Ctrl+点击 = 多选联合**；切换视图**保留筛选条件**，不再清空搜索框。
- **全文搜索**：SQLite FTS5 trigram 索引（`pdf_fts`），中英文子串秒搜、命中页跳转；重排模式下同样可搜。
- 结果实体视图横跨四类实体——文献 / 批注 / 笔记 / 附件——支持规范化子串过滤与点击跳转。
- 回收站：删除进回收站，可恢复/彻底清除，保留天数可配置。
- 批量多选：改状态 / 加标签 / 编辑字段 / 补全 / 重命名 / 导出 / 删除；`Ctrl`/`Shift` 多选。
- **会话级撤销/重做**（`Ctrl+Z` / `Ctrl+Y`）：只对受影响实体拍快照，历史 ≤100 步。
- 库内查重与合并（保留最完整条目）、作者合并工具（同名不同写法归一）、相关文献互链、阅读统计与发表年份分布图。
- ZotFile 式模板批量重命名 PDF。
- 键盘快捷键（`?` 查看）与删除撤销。

### 引用与写作

- **手写 APA / GB-T / MLA** 渲染器（快、零依赖），外加完整 **CSL 引擎**（citeproc-js）与 **11 种内置样式**：
  GB/T 7714 顺序编码与著者-出版年（按国内论文惯例定制）、APA 7th、MLA 9th、Nature、IEEE、Vancouver、
  Elsevier ×2、Chicago ×2；其余样式可从官方 CSL 样式库在线拉取，或本地导入 `.csl`。
- citekey 可编辑钉住；**保存后自动同步导出 `.bib`**（Overleaf / Typst / LaTeX 工作流）；导出格式另有 JSON、CSV、RIS
  （Zotero / EndNote 互通）。
- **有状态的引文文档**（`js/csldoc.js`）：CitationCluster 可序列化、重新关联与整篇重编号，每条引文自带 CSL 快照，
  文献暂不在库也能渲染。
- **Word 写作零安装零宏**：常驻 JScript 桥经 COM 驱动 Word。插入引文（多选弹窗检索、勾选顺序即合并顺序、
  插入后按文档序重算编号）、按文档切换格式、刷新、参考文献表、解除关联副本；已实测 Word 2016 全链路。
- 域指令版本化且独立命名（` ADDIN LitBoard.Citation.1 "{json}"`，**不冒充 Zotero 域**）；
  转换器可把文档里已有的 `ZOTERO_ITEM CSL_CITATION` 域原位换成 LitBoard 域（只生成新副本，未匹配项保留域结果）。
- 排版口径统一：引文文本与参考文献经同一套 HTML 词法转成 RTF run（写进 Word）或 docx run（导出），
  上标、斜体、悬挂缩进在两边完全一致。
- 引文渲染双语：条目除「等」外无 CJK 字符即视为西文条目，自动改用 et al.

### 同步与备份

- **坚果云 WebDAV 同步（协议 v5）**：实体级 LWW + 墓碑、v4 起计划式三方合并、ETag 条件写、删除传播、
  冲突暂停与字段/附件级对照（对照弹窗内带进度条）。
- **可逐实体选择采信哪一侧**：「采用本机版本」让云端保持远端值，两侧快照登记进 sync base 的 pins，
  任一侧再变化即解除登记回到正常合并。
- 附件与批注快照按 SHA-256 校验并原子恢复；本机签名（cloudHash + size + mtime）让未变化的附件免读盘重哈希，
  上传台账让中断的传输下一轮续传而不重传。
- 每次被覆盖的版本记入 `sync-conflicts.jsonl`。
- **每日完整快照**到独立目录：数据库（含全文/语义索引，压缩存储）+ 全部本地附件，按内容去重进 `objects/`
  内容寻址仓；内容完全相同的状态不重复保存，保留份数可配（1–30，默认 7）。
- 恢复先校验哈希；**数据库损坏时绝不删除、覆盖或静默重建**——优先用最新有效快照自动恢复，
  原库/WAL/SHM 改名 `*.corrupt-*` 保留。
- 配置/缓存目录与文献库目录可分别搬到别的盘。这是**搬移**语义：复制 → 逐项按字节量校验 → 切换定位文件 →
  清空旧目录，失败下次启动重试，保留项在设置页如实列出。

### AI 调研助手（可选）

- **独立的调研库**（配置目录 `research/`，随数据目录迁移）：身份是永不变更的代理键，
  除非你显式收藏，实验不会碰你的正式库。
- 接任意自配端点——OpenAI 兼容（DashScope/Qwen、OpenAI、DeepSeek、OpenRouter、本机 ollama）与
  Anthropic 兼容（Claude，以及 DeepSeek、智谱 GLM、Z.ai 的 `/anthropic` 端点）都可：流式输出、工具调用、
  思考过程折叠、编辑重发、重新生成、按轮重试；协议形态（Chat Completions / Responses / Messages）
  按 Base URL 自动判定并在设置里显示实际发包地址，OpenCode Zen/Go 端点还会附上其要求的
  `x-opencode-session` 头；失败**不自动重发**，不会产生无感知计费。
- 工具集先只读（库内检索、调研库检索、OpenAlex 发现（关键词 + 语义）、Semantic Scholar、调研库语义检索、取详情、全文命中），
  三个写类工具（收藏入库、下载 PDF、收入 PDF）一律先经确认才动你的库。
- **引文网络构建**：按 OpenAlex `referenced_works` BFS 扩边（深度 1–3、节点 10–500），度统计 + PageRank，
  vis-network 交互视图，可导出为离线自包含 HTML 快照。
- **科研网页检索（TinyFish）**：默认关闭，首次开启需确认数据出境告知；抓到的网页存为本地快照附件并进入全文索引。
- 会话按 `会话记录/<日期>/<标题>/` 存放，`session.json` 是唯一事实源，`会话记录.md` 是生成物；
  删除进系统回收站。流式增量只在内存，落盘发生在轮开始/工具执行前/工具结果/轮收尾四个事件点——
  强杀只会丢当前未完成的半截（重开标记为「已中断」并提供手动重试）。

### 界面语言

- 简体中文 / English，设置 → 偏好即时切换（`auto` 跟随系统）。词典键 = 中文源串，未命中回退原文，界面永不出现空洞。
  **存库/出库数据不翻译**——界面语言 ≠ 引文语言 ≠ 你的数据。

### 主题

- 浅色 / 深色 / 跟随系统，另有 10 套精选主题：GitHub Light、Catppuccin Latte / Mocha、Solarized Light、
  One Light、Gruvbox Light、Dracula、Tokyo Night、Nord、One Dark。

## 联网与隐私

文献库和笔记不会上传到 LitBoard 服务器，因为项目没有自己的服务器。以下操作会联网：

- 元数据补全会把 DOI 或标题发送给 OpenAlex、Semantic Scholar、Crossref、PubMed、OpenLibrary。
- 「下载 PDF」会把该条目的 DOI 或标题发送给 OpenAlex、Semantic Scholar 以查找开放获取全文，PDF 由你选择保存位置后直接下载到本机。
- 浏览器扩展保存时向 `127.0.0.1` 本机端口发送元数据（不离开本机）；DOI 补全走 OpenAlex。知网页面从知网导出接口取元数据，知网 PDF 由浏览器（带你的登录会话）下载后传到本机桌面端，仅本机。
- OCR 首次使用会从 jsDelivr 下载 tesseract 语言包（约 15MB）到本机；识别完全在本机进行。
- 坚果云同步会把 LitBoard 文献元数据、附件和批注截图写入你配置的 WebDAV 目录；坚果云账号、应用密码、本机路径和扩展令牌不会进入远端文件。WebDAV 地址要求使用 HTTPS（本机回环地址可用于测试）。
- 语义检索只作为 AI 助手的工具：配好「向量嵌入（调研库）」的服务商与凭据后，助手可调用语义检索（标题+摘要会发送给该嵌入服务商）；不配置则零外呼。
- 划词翻译、期刊分区查询与 AI 助手只会联系你自己配置的服务商。
- DOI、开放获取全文和 Google 学术按钮会打开相应网站。

PDF.js、PDFium、citeproc、tesseract、epub.js、vis-network 均已随程序本地打包。**桌面版与浏览器直接打开模式都不依赖任何 CDN**：pdf.js 一律从本地 `vendor/` 加载（`index.html` 的 CSP 只放行 `'self'` 与元数据 API 主机）。网络服务可能限流；纯浏览、筛选、笔记和导出可离线使用。

## 安装与快速开始

1. 从 Release（或 `dist/` 本地构建）下载 `LitBoard-Setup-<版本>-x64.exe` 安装运行；免安装场景用 `LitBoard-Portable-<版本>-x64.exe`。
2. 点「导入文件」装入 `.bib` / `.ris` / `.json` / `.pdf`，或直接把文件拖进窗口；也可以在「添加」里粘贴 DOI / arXiv 编号 / PMID / ISBN / 标题联网抓取元数据。
3. 双击条目打开 PDF 开始阅读：高亮、批注、区域截图、一键摘录进笔记。
4. 到「设置 → 数据与备份」选一个独立目录开启每日完整备份（建议 OneDrive 或外接盘）。

首次启动会创建：

```text
%APPDATA%\LitBoard\litboard.sqlite        主数据库（文献/文件夹/批注/索引/设置）
%APPDATA%\LitBoard\litboard.sqlite.bak    每日自动备份（兼容性兜底）
```

在「设置 → 数据与备份 → 本地数据位置」中可以分别更改：

- 配置与缓存目录：应用设置、界面偏好、OCR/CSL 缓存、同步附件与批注图片；
- 文献库目录：SQLite 数据库、全文/语义索引及数据库备份。

应用会先保存当前文献库，重启时复制数据并切换目录；路径既可直接输入也可点「选择…」。这是**搬移**：复制后逐项按字节量校验，
确认无误才把新位置写进定位文件，随后清空旧目录——旧目录里最终只留一个 `data-paths.json`（告诉下次启动去哪儿找数据，
它永远住在默认目录），以及少数刻意保留的项（新目录中没有对应副本的文件，在设置页会如实列出）。新目标应为空目录或当前目录，
两个目录可以相同，但不能互相嵌套。用户自行选择在其他位置保存的 PDF/附件不会被移动。

从旧版升级时，原有 `library.v1.json` 与 `pdftext.v1.json` 会在首次启动时自动迁移进 SQLite，原文件改名为 `*.migrated` 保留，不会删除。

安装包未做代码签名，首次运行 SmartScreen 提示「未知发布者」时选择「仍要运行」即可。

## 完整备份与数据库安全

在「设置 → 完整备份」中选择独立备份目录（建议 OneDrive 或外接盘上的专用目录，不能与配置/文献库目录相同或互相嵌套）：

- 每份快照包含数据库（含全文/语义索引，压缩存储）与全部本地附件（托管 PDF、外部 PDF、补充材料、批注截图）；
- 附件按内容（SHA-256）去重存入 `objects/`，同一文件跨快照只占一份；新目录首次设置时创建快照，已有快照目录只读挂载，不会先写入空库；之后距上次成功超过 24 小时自动备份；保留份数可在「设置 → 完整备份」里改（1–30，默认 7），删除旧快照后自动清理不再被引用的对象；
- 与最近一份快照内容完全相同的状态（数据库字节与附件集合都一致）不会重复保存，轮换位留给真正不同的版本；列出快照只读清单，逐项哈希校验只在恢复时或你主动要求时进行；
- 备份不包含 WebDAV/API 凭据；快照数据库中的浏览器扩展令牌会被剥离，恢复后需重新配置扩展；
- 任一引用文件缺失或哈希不匹配时，该次备份不发布（旧快照保留），界面给出缺失清单；
- 数据库损坏时**绝不删除、覆盖或“静默重建”**：启动时优先验证最新完整快照并自动恢复（原库/WAL/SHM 改名为 `*.corrupt-*` 保留件），无有效快照时提供原生对话框让用户选择备份目录或退出；旧的 `litboard.sqlite.bak` 仅作兼容性兜底；
- 恢复的附件统一落到配置目录受管 `restored-assets/<snapshotId>/`，据 manifest 重写库内路径，不覆盖原始外部文件。

长期运行还会在库目录、配置目录与备份目录里留下若干“保留件”：崩溃残留的暂存快照、恢复后保留的上一代附件、迁移数据目录时的旧库副本、损坏库的隔离副本。「设置 → 完整备份 → 清理遗留文件…」会**先扫描并列出可清理项与体积，确认后**只删除已确认无用的部分：当前数据库、全部快照、内容寻址对象仓与仍在被引用的附件一律不动；隔离的数据库副本是损坏库的最后一份拷贝，保留 30 天后才纳入清理。

仍建议定期通过“导出 → JSON”另行备份。

## API 凭据申请

在桌面版「设置」中可配置划词翻译、SciGreat 期刊分区、向量嵌入等。元数据补全与联网检索使用 OpenAlex、Semantic Scholar、Crossref，不需要 API Key。

### 划词翻译 / 向量嵌入

- Qwen / DashScope：到阿里云百炼获取 API Key：<https://help.aliyun.com/zh/model-studio/get-api-key>
- 阿里云机器翻译：先开通机器翻译服务：<https://help.aliyun.com/zh/machine-translation/getting-started/activate-machine-translation-for-developers>；再创建 AccessKey：<https://help.aliyun.com/zh/machine-translation/getting-started/prepare-accounts-for-developers>
- OpenAI：在 API keys 页面创建 Key：<https://platform.openai.com/api-keys>
- DeepSeek：在 API keys 页面创建 Key：<https://platform.deepseek.com/api_keys>（仅翻译，不支持嵌入）

阿里云机器翻译的凭据填写格式为 `AccessKey ID@AccessKey Secret`，其他翻译服务商填写单个 API Key。语义检索只作 AI 助手的工具，其向量模型在 设置 → 集成与服务 → 向量嵌入（调研库）里单独配置（服务商 / Base URL / API Key / 模型名）。

### SciGreat 期刊分区

- OneScholar 设置页：<https://www.scigreat.com/s/app/?t=onescholar-info>
- OneScholar 主页：<https://www.scigreat.com/s/app/?t=onescholar>
- SCI Great 官网：<https://www.scigreat.com/>

该 Key 用于查询期刊分区、影响因子、JCR / 中科院等等级数据；设置页里的「测试 API」会用 Nature 做一次连通性查询。

## 浏览器扩展安装

1. 打开 LitBoard「设置 → 浏览器扩展」，确认服务已启用并复制令牌。
2. Chrome/Edge 打开 `chrome://extensions`，开启「开发者模式」→「加载已解压的扩展程序」→ 选择项目 `extension/` 目录（打包版在安装目录的 `resources/app/extension/`）。
3. 扩展选项页填入端口（默认 24117）与令牌，「测试连接」通过后即可在文献页一键保存。

`npm run pack-extension` 可把扩展打成 `dist/LitBoard-Extension.zip`。

## 环境要求

- **应用只在 Windows x64 上构建与运行**：打包脚本是 PowerShell，产物为 NSIS 安装版与 Portable EXE；
  Word 写作集成另需本机 Word（COM 自动化，实测 Word 2016+）。
- **开发需要 Node.js ≥ 22.13.0**：存储层使用 `node:sqlite`，该模块在 22.13 之前须加 `--experimental-sqlite` 才能加载。
  `.nvmrc` 固定为 24，`package.json` 的 `engines` 声明了下限。
- 测试套件是纯 Node，可在 macOS / Linux 上运行 —— CI 已覆盖 Windows / Ubuntu × Node 22 / 24。

## 开发与构建

项目目录保持零 `node_modules`。Electron 和 electron-builder 由脚本安装到：

```text
%LOCALAPPDATA%\LitBoardBuildTools
```

运行测试（纯 Node，不需要任何安装）：

```powershell
npm.cmd test
```

代码检查（同样支持零 `node_modules`：eslint 缺失时会自动装到外置工具目录）：

```powershell
npm.cmd run lint
```

启动开发版与打包：

```powershell
npm.cmd start
npm.cmd run dist
```

发布与验证辅助脚本（均使用隔离目录，绝不触碰真实用户库）：

```powershell
npm.cmd run smoke             # 标准功能冒烟（隔离目录启动 Electron）
npm.cmd run smoke:lifecycle   # 生命周期冒烟：写入 → 真实关闭 → 重启 → 数据一致
npm.cmd run perf              # 冷启动/加载/保存分段计时（默认 5 轮，输出 P50/P95）
npm.cmd run vendor-hashes     # 重生成 vendor/SHA256SUMS（升级第三方库后必须跑）
node scripts/release-checksums.js   # dist/ 发布包校验和（npm run dist 之后）
```

构建完成后，`dist` 目录包含（`npm run dist` 每次会自动把 `package.json` 的 patch 号 +1，所以版本号逐次递增）：

```text
LitBoard-Setup-1.2.14-x64.exe
LitBoard-Portable-1.2.14-x64.exe
```

应用图标由 `scripts/gen-icons.ps1` 生成 `build/icon.ico`、`build/icon-*.png` 与 `extension/icons/*`（改图标后重新运行该脚本再构建即可）。

首次执行 `start`、`dist` 或 `lint` 需要联网下载工具；想让 Electron 走国内镜像，自行设置环境变量 `$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'`（脚本已不再写死镜像地址）。

生成的 EXE 未进行商业代码签名，Windows SmartScreen 可能显示未知发布者。

## 文件结构

```text
index.html             页面结构
css/style.css          浅色/深色样式
js/model.js            数据校验与版本化模型（schema v13：多附件/创作者/笔记实体/墓碑/citekey 钉住/BibTeX extras…）
js/bibtex.js           BibTeX 解析与生成
js/cite.js             APA / GB-T 7714 / MLA 引文与 RIS 生成
js/cslcite.js          CSL 引擎封装（paper → CSL-JSON → citeproc 渲染）
js/csldoc.js           有状态引文文档（引文簇/快照/重新关联）
js/docx.js             最小 docx 读写（自写 stored-ZIP + CRC32，零依赖）
js/csljson.js          CSL-JSON 导入
js/ris.js              RIS 导入
js/query.js            高级检索语法（字段/布尔/比较/正则）
js/authors.js          作者归并
js/rename.js           PDF 命名模板引擎
js/dedupe.js           库内查重分组与合并策略
js/enrich.js           五个元数据源的补全逻辑（OpenAlex/S2/Crossref/PubMed/OpenLibrary）
js/pdfimport.js        PDF DOI/标题提取、阅读器渲染与页内搜索
js/pdfannot.js         批注写回 PDF / 读取 PDF 标准批注（pdf-lib）
js/ocr.js              扫描件 OCR（tesseract.js）
js/pdfsearch.js        跨库 PDF 全文索引与检索
js/epub.js             EPUB 阅读器封装（epub.js + JSZip）
js/reflow.js           PDF 重排分析（行聚簇/栏检测）
js/excerpt.js          摘录块契约（构建/解析/stale/替换）
js/noteml.js           富文本笔记契约（sanitize / 摘录节点 / 引用节点）
js/noteeditor.js       富文本笔记编辑器
js/agentcore.js        AI 助手状态机
js/agentproto.js       端点协议适配（chat / responses / messages）
js/agentloop.js        AI 助手循环编排
js/graphgen.js         引文网络构建与离线 HTML 导出
js/graphview.js        引文网络面板
js/sync.js             同步合并 v5（计划式三方合并 + ETag 条件写 + 冲突报告）
js/i18n.js             界面双语核心（zh-CN 源串为键；t/applyStatic/setLang）
js/i18n-en.js          英文词典（键 = 中文源串）
js/app.js              页面状态、渲染和交互
electron/main.js       Electron 主进程（IPC/迁移/备份/自动导出）
electron/db.js         SQLite 存储层（node:sqlite，FTS5 trigram 全文索引，增量保存）
electron/backup.js     快照创建、校验与恢复
electron/integrations.js   坚果云同步、翻译、分区、嵌入、Zotero 导入
electron/research-db.js    调研库存储
electron/research-net.js   OpenAlex 客户端与摘要回填
electron/research-build.js 向量构建器
electron/word-bridge.js    Word COM 桥（驱动 word/wordbridge.js）
electron/bridge-server.js  浏览器扩展接收服务（127.0.0.1）
electron/preload.js    安全桌面桥接
electron/data-paths.js 配置目录/文献库目录定位与安全迁移
electron/storage.js    旧 JSON 存储（仅迁移用）
vendor/pdfjs/          离线 PDF.js 运行资源
vendor/pdfium/         PDFium WASM 渲染器
vendor/pdflib/         pdf-lib（批注写回）
vendor/citeproc/       citeproc-js + CSL 样式/语言环境
vendor/tesseract/      tesseract.js 核心（语言包按需下载）
vendor/epub/           epub.js + JSZip
vendor/vis-network/    引文网络可视化
vendor/assistant-ui/   AI 对话层构建产物
word/wordbridge.js     常驻 JScript Word COM 桥
extension/             Chrome/Edge 浏览器扩展
scripts/               外置工具启动与构建脚本（lint.js 兼容零 node_modules）
eslint.config.js       代码检查配置（自包含扁平配置，只启用「真 bug」类规则）
.github/               CI（Node 22/24 × Windows/Ubuntu）、issue/PR 模板、Dependabot
CONTRIBUTING.md        贡献流程、代码约定与工程红线
test/                  数据模型、存储、同步、引用等测试
```

浏览器版仍可直接打开 `index.html`，但桌面版具备更可靠的文件、剪贴板、网络和数据存储能力。

## 第三方组件与许可

LitBoard 自有代码按 AGPL-3.0-only 发布，完整项目许可见根目录 `LICENSE`。
`vendor/` 下的第三方组件继续按各自许可证发布，不因本项目许可证改变。

- PDF.js（Apache-2.0）、PDFium（BSD）、pdf-lib（MIT）、tesseract.js（Apache-2.0）、bibtex-parse（MIT）、assistant-ui 对话层 bundle（MIT，经外置 esbuild 构建为单文件，见 scripts/agent-ui-bundle/）、vis-network（Apache-2.0 / MIT 双许可，本程序以 MIT 使用，© Almende B.V. 与 visjs contributors）
- epub.js（BSD-2-Clause，© FuturePress）、JSZip（MIT 或 GPLv3 双许可，本程序以 MIT 使用）
- citeproc-js（CPAL-1.0 / AGPL-3.0 双许可，本程序以 CPAL 使用并在此署名：© Frank Bennett）
- CSL 样式与语言环境文件（CC BY-SA 3.0，citation-style-language 项目）

## 更多文档

- [README.md](README.md) — English README（英文说明）
- [CONTRIBUTING.md](CONTRIBUTING.md) — 贡献流程、代码约定与硬性约束
- [AGENTS.md](AGENTS.md) — 架构要点与红线
- [CHANGELOG.md](CHANGELOG.md) — 变更记录
- [docs/roadmap.md](docs/roadmap.md) — 路线图（开源前完善与长期演进，M0–M8）
- [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md) — 第三方组件台账（版本/来源/哈希/许可）
- [docs/audit-baseline.md](docs/audit-baseline.md) — 审查基线与性能基准数据
- [docs/releasing.md](docs/releasing.md) — 维护者发布清单
- [SECURITY.md](SECURITY.md) — 安全政策
