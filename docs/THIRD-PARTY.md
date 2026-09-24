# 第三方组件（THIRD-PARTY）

> 开源分发义务的核对表：列明随应用分发的第三方组件的**版本、来源、哈希、许可证、NOTICE 义务**；未随包分发的设计来源另列说明。
> 哈希为 SHA-256（完整值见 `vendor/SHA256SUMS`，由 `scripts/vendor-hashes.js` 生成）。
> 新增 vendor 文件时：登记本表，并把哈希加进 `SHA256SUMS`。
> README 的许可章节分别为中文 `README.zh-CN.md`「许可证与第三方组件」和英文 `README.md`「License and third-party components」。
> 仓库根目录的 `LICENSE` 当前为 MIT，适用于 LitBoard 自有代码；随包第三方组件保留各自的许可证。

## 运行时随应用分发的组件

| 组件 | 版本 | 来源 | 许可证 | 主要文件（SHA-256 前 16 位） |
|---|---|---|---|---|
| MuPDF.js | 1.28.1 | https://github.com/ArtifexSoftware/mupdf.js （官方 npm 产物） | AGPL-3.0-or-later | `mupdf.js` / `mupdf-wasm.js` / `mupdf-wasm.wasm`（完整值见 SHA256SUMS） |
| PaddleOCR.js SDK（@paddleocr/paddleocr-js，esbuild 0.25.12 构建；内含 OpenCV.js 4.10 与 clipper-lib / js-yaml） | 0.4.2 | 源码 scripts/ocr-bundle/（复现构建见其注释）；上游 https://github.com/PaddlePaddle/PaddleOCR（paddleocr-js） | Apache-2.0（钉版信息见 `vendor/paddleocr/package.paddleocr-js.json`） | `paddleocr.js`（主线程驱动，OpenCV 已 stub 剥离）；`worker-entry.js`（module worker，含 OpenCV；已 patch 浏览器 file: 守卫，见构建脚本） |
| onnxruntime-web（OCR 推理 wasm） | 1.24.3 | https://github.com/microsoft/onnxruntime | MIT（指津见 `vendor/paddleocr/LICENSE.onnxruntime-web.txt`） | `ort/ort-wasm-simd-threaded{,.jsep}.{mjs,wasm}`（完整值见 SHA256SUMS） |
| PP-OCRv5 mobile 模型（det/rec，运行时下载） | paddle3.0.0 官方导出 | https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/ | Apache-2.0（tar 内 README 声明） | 不随安装包分发；运行时下载到用户配置目录 `ocr/paddle/` |
| foliate-js（EPUB 内核；esbuild 0.25.12 构建，内含上游 vendor 的 zip.js 与 fflate） | 钉 commit 78914aef4466eb960965702401634c2cb348e9b1（2026-05-01） | 源码 scripts/foliate-bundle/（复现构建见其 build.js）；上游 https://github.com/johnfactotum/foliate-js | MIT（© John Factotum，完整文本见 `vendor/foliate/LICENSE.foliate-js`）；vendored deps：@zip.js/zip.js BSD-3、fflate MIT（随 bundle 内联，版本见 scripts/foliate-bundle/package.json） | `foliate.min.js`（完整值见 SHA256SUMS） |
| JSZip | 3.10.1 | https://github.com/Stuk/jszip | MIT 或 GPLv3（本项目以 MIT 使用） | `vendor/jszip/jszip.min.js` 8d2c73c115c5b5c8（EPUB 解包 + docx ZIP 容器 + 网页快照 stored-ZIP 共用） |
| citeproc-js | 1.4.61 | https://github.com/Juris-M/citeproc-js | CPAL-1.0 / AGPL-3.0 双许可（本项目以 CPAL 使用，完整文本见 `vendor/citeproc/LICENSE.CPAL`，署名 © Frank Bennett） | `citeproc.js` 55abba1a8b8b48c1 |
| CSL 样式 / 语言环境 | 随仓库快照 | https://github.com/citation-style-language/styles 、 /locales | CC BY-SA 3.0（完整文本见 `vendor/citeproc/LICENSE.CC-BY-SA-3.0`） | `vendor/citeproc/styles/*.csl`、`locales/*.xml` |
| bibtex-parse | 上游版（未在文件头标注） | https://github.com/noahfalk/ （PEG.js 生成解析器，MIT） | MIT | `bibtex-parse.js` 041dc7977d34e890 |
| assistant-ui 对话层 bundle（react 18.3.1 + react-dom 18.3.1 + @assistant-ui/react 0.11.58，esbuild 0.25.12 构建） | 0.11.58 | 源码 scripts/agent-ui-bundle/（复现构建见其 README）；上游 https://github.com/assistant-ui/assistant-ui 、 https://github.com/facebook/react | react / react-dom：MIT；@assistant-ui/react：MIT（内嵌许可声明已随 legalComments:inline 保留在产物内） | `agent-chat.js`（完整值见 SHA256SUMS） |
| vis-network | 9.1.9（standalone UMD） | https://github.com/visjs/vis-network （官方 standalone 产物） | MIT（完整文本见 `vendor/vis-network/LICENSE`；上游亦提供 Apache-2.0） | `vis-network.min.js` f53f833ddb9bf97e |
| MathJax（tex-svg 组件及 boldsymbol 扩展） | 3.2.2 | https://github.com/mathjax/MathJax （官方 es5 产物） | Apache-2.0（完整文本随 `vendor/mathjax/LICENSE`） | `tex-svg.js` d4295dc337448369；`input/tex/extensions/boldsymbol.js` d6771fee0772db26 |
| pinyin-pro（中文转拼音） | 3.29.4 | https://github.com/zh-lx/pinyin-pro （npm 官方发布产物） | MIT（完整文本随 `vendor/pinyin-pro/LICENSE`） | `pinyin-pro.js` 1f660d2a52b762a |
| markdown-it | 14.3.2 | https://github.com/markdown-it/markdown-it （官方 npm 产物 `dist/markdown-it.min.js`） | MIT（完整文本见 `vendor/markdown-it/LICENSE`） | `markdown-it.min.js` e32488403e2e565a |
| LitGraph 图谱计算内核（**自研**，非第三方：Rust/napi-rs 预编译，源码随仓库） | 0.1.0 | 源码 `scripts/litgraph-bundle/rust/`（复现构建：`node scripts/litgraph-bundle/build.js`，需 Rust stable-msvc 工具链） | 本项目许可证（同仓库 LICENSE） | `litgraph.win32-x64-msvc.node`（完整值见 SHA256SUMS；构建期引入 napi-rs（MIT/Apache-2.0），产物静态自包含） |

## 界面图标（内嵌于 index.html 的 SVG sprite）

左侧边栏等处的部分 `lb-i-*` 图标（folder / folder-new / inbox / trash / search / books / history）采用 [Tabler Icons](https://github.com/tabler/tabler-icons) 的 outline 路径（v3.35.0，MIT 许可证，© Paweł Kuna）。图标以 `<symbol>` 形式直接内嵌在 `index.html` 中，不是独立 vendor 文件，因此无 SHA-256 条目；其余 `lb-i-*` 图标为项目手绘（同风格）。

## 文献调研模块的设计来源（不随应用分发）

LitBoard 文献Agent调研模块的核心工作流以 [PAPER-SQL](https://github.com/galois-yan/PAPER-SQL) 为设计基础，包括检索结果写入本地调研库、缺失摘要回填、语义检索和引文关系分析。感谢该项目作者，我的导师严寅中老师（Yinzhong Yan，西北工业大学）。PAPER-SQL 的[许可证为 MIT](https://github.com/galois-yan/PAPER-SQL/blob/master/LICENSE)，版权声明为 © 2026 严寅中。

这里登记的是方法与设计来源；LitBoard 的对应功能由本项目的 JavaScript / Electron 模块实现，PAPER-SQL 的 Python 包不作为运行时组件随应用分发，因此不列入上表的随包文件哈希。若后续直接引入其源代码，应按 MIT 许可证保留版权和许可声明，并在本台账登记具体文件。

## 构建工具（不随应用分发，装在 %LOCALAPPDATA%\LitBoardBuildTools）

| 组件 | 版本（唯一真源：package.json devDependencies） | 来源 | 许可证 |
|---|---|---|---|
| Electron | 44.4.3 | https://www.electronjs.org/ | MIT |
| electron-builder | 26.15.3 | https://www.electron.build/ | MIT |
| ESLint | ^10.10.0 | https://eslint.org/ | MIT |

## NOTICE 汇总

当前打包配置包含根目录 `LICENSE`、`vendor/**/*` 和本清单；各组件的许可证与声明按上表和仓库实际文件分别核对：

1. **MuPDF.js**：`vendor/mupdf/LICENSE` 为 AGPL-3.0 文本；根目录的 MIT 许可证不改变 MuPDF.js 的许可条款。
2. **PaddleOCR.js SDK / PP-OCRv5 模型**：SDK 的 Apache-2.0 标识见 `vendor/paddleocr/package.paddleocr-js.json`；模型运行时下载，不在安装包中。
3. **citeproc-js**：CPAL-1.0 文本与 Frank Bennett 署名见 `vendor/citeproc/LICENSE.CPAL`。
4. **其他随包组件**：MIT、BSD-3-Clause、Apache-2.0 和 CC BY-SA 3.0 等许可分别适用；对应声明和文件位置见上表。

## 版本漂移与升级流程

- 上游有安全修复时，替换对应 vendor 文件后**必须**重跑 `node scripts/vendor-hashes.js` 刷新
  `SHA256SUMS`，并更新本表版本列；CI 不自动检查上游（ vendored 策略有意的取舍）。
- 上游 translator 漂移检查：`npm run check-translators`（手动）。
