# 第三方组件台账（THIRD-PARTY）

> 开源分发义务的唯一核对表：每个随应用分发的第三方组件——**版本、来源、哈希、许可证、NOTICE 义务**。
> 哈希为 SHA-256（完整值见 `vendor/` 旁的 `SHA256SUMS` 校验文件，由 `scripts/vendor-hashes.js` 生成）。
> 新增 vendor 文件时：登记本表 + 把哈希加进 `SHA256SUMS` + 在 README 的许可一节补一行
> （中文 `README.zh-CN.md`「第三方组件与许可」／英文 `README.md`「License」两处同步）。

## 运行时随应用分发的组件

| 组件 | 版本 | 来源 | 许可证 | 主要文件（SHA-256 前 16 位） |
|---|---|---|---|---|
| MuPDF.js | 1.28.1 | https://github.com/ArtifexSoftware/mupdf.js（官方 npm 产物） | AGPL-3.0-or-later | `mupdf.js` / `mupdf-wasm.js` / `mupdf-wasm.wasm`（完整值见 SHA256SUMS） |
| PaddleOCR.js SDK（@paddleocr/paddleocr-js，esbuild 0.25.12 构建；内含 OpenCV.js 4.10 与 clipper-lib / js-yaml） | 0.4.2 | 源码 scripts/ocr-bundle/（复现构建见其注释）；上游 https://github.com/PaddlePaddle/PaddleOCR（paddleocr-js） | Apache-2.0（钉版信息见 `vendor/paddleocr/package.paddleocr-js.json`） | `paddleocr.js`（主线程驱动，OpenCV 已 stub 剥离）；`worker-entry.js`（module worker，含 OpenCV；已 patch 浏览器 file: 守卫，见构建脚本） |
| onnxruntime-web（OCR 推理 wasm） | 1.24.3 | https://github.com/microsoft/onnxruntime | MIT（指津见 `vendor/paddleocr/LICENSE.onnxruntime-web.txt`） | `ort/ort-wasm-simd-threaded{,.jsep}.{mjs,wasm}`（完整值见 SHA256SUMS） |
| PP-OCRv5 mobile 模型（det/rec，运行时下载） | paddle3.0.0 官方导出 | https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/ | Apache-2.0（tar 内 README 声明） | 不随安装包分发；运行时下载到用户配置目录 `ocr/paddle/` |
| foliate-js（EPUB 内核；esbuild 0.25.12 构建，内含上游 vendor 的 zip.js 与 fflate） | 钉 commit 78914aef4466eb960965702401634c2cb348e9b1（2026-05-01） | 源码 scripts/foliate-bundle/（复现构建见其 build.js）；上游 https://github.com/johnfactotum/foliate-js | MIT（© John Factotum，完整文本见 `vendor/foliate/LICENSE.foliate-js`）；vendored deps：@zip.js/zip.js BSD-3、fflate MIT（随 bundle 内联，版本见 scripts/foliate-bundle/package.json） | `foliate.min.js`（完整值见 SHA256SUMS） |
| JSZip | 3.10.1 | https://github.com/Stuk/jszip | MIT 或 GPLv3（本项目以 MIT 使用） | `vendor/jszip/jszip.min.js` 8d2c73c115c5b5c8（EPUB 解包 + docx ZIP 容器 + 网页快照 stored-ZIP 共用） |
| citeproc-js | 1.4.61 | https://github.com/Juris-M/citeproc-js | CPAL-1.0 / AGPL-3.0 双许可（本项目以 CPAL 使用，完整文本见 `vendor/citeproc/LICENSE.CPAL`，署名 © Frank Bennett） | `citeproc.js` 55abba1a8b8b48c1 |
| CSL 样式 / 语言环境 | 随仓库快照 | https://github.com/citation-style-language/styles 、 /locales | CC BY-SA 3.0（完整文本见 `vendor/citeproc/LICENSE.CC-BY-SA-3.0`） | `vendor/citeproc/styles/*.csl`、`locales/*.xml` |
| bibtex-parse | 上游版（未在文件头标注） | https://github.com/noahfalk/（PEG.js 生成解析器，MIT） | MIT | `bibtex-parse.js` 041dc7977d34e890 |
| assistant-ui 对话层 bundle（react 18.3.1 + react-dom 18.3.1 + @assistant-ui/react 0.11.58，esbuild 0.25.12 构建） | 0.11.58 | 源码 scripts/agent-ui-bundle/（复现构建见其 README）；上游 https://github.com/assistant-ui/assistant-ui 、 https://github.com/facebook/react | react / react-dom：MIT；@assistant-ui/react：MIT（内嵌许可声明已随 legalComments:inline 保留在产物内） | `agent-chat.js`（完整值见 SHA256SUMS） |
| vis-network | 9.1.9（standalone UMD） | https://github.com/visjs/vis-network（官方 standalone 产物） | MIT（完整文本见 `vendor/vis-network/LICENSE`；上游亦提供 Apache-2.0） | `vis-network.min.js` f53f833ddb9bf97e |
| MathJax（tex-svg 单文件组件） | 3.2.2 | https://github.com/mathjax/MathJax（官方 es5/tex-svg.js 产物） | Apache-2.0（完整文本随 `vendor/mathjax/LICENSE`） | `tex-svg.js` d4295dc337448369 |
| pinyin-pro（中文转拼音） | 3.29.4 | https://github.com/zh-lx/pinyin-pro（npm 官方发布产物） | MIT（完整文本随 `vendor/pinyin-pro/LICENSE`） | `pinyin-pro.js` 1f660d2a52b762a |
| markdown-it | 14.3.2 | https://github.com/markdown-it/markdown-it（官方 npm 产物 `dist/markdown-it.min.js`） | MIT（完整文本见 `vendor/markdown-it/LICENSE`） | `markdown-it.min.js` e32488403e2e565a |

## 构建工具（不随应用分发，装在 %LOCALAPPDATA%\LitBoardBuildTools）

| 组件 | 版本（唯一真源：package.json devDependencies） | 来源 | 许可证 |
|---|---|---|---|
| Electron | 44.4.3 | https://www.electronjs.org/ | MIT |
| electron-builder | 26.15.3 | https://www.electron.build/ | MIT |
| ESLint | ^10.10.0 | https://eslint.org/ | MIT |

## NOTICE 汇总

本应用分发时须随附（安装包内已含根目录 `LICENSE` 与各 vendor 目录下的 LICENSE 文件）：

1. AGPL-3.0-or-later（MuPDF.js）：随应用分发完整 LICENSE；LitBoard 以 AGPL-3.0 兼容方式分发源码。
2. Apache-2.0 组件（PaddleOCR.js SDK / PP-OCRv5 模型）：钉版信息与许可来源随 `vendor/paddleocr/` 分发。
3. CPAL-1.0（citeproc-js）：署名 Frank Bennett；源码获取途径随仓库公开即满足。
4. BSD / MIT 组件：保留版权与许可声明（各 vendor 目录内 LICENSE 文件）。
5. CC BY-SA 3.0（CSL 样式）：署名 Citation Style Language 项目；样式文件随应用原样分发。

## 版本漂移与升级流程

- 上游有安全修复时，替换对应 vendor 文件后**必须**重跑 `node scripts/vendor-hashes.js` 刷新
  `SHA256SUMS`，并更新本表版本列；CI 不自动检查上游（ vendored 策略有意的取舍）。
- 上游 translator 漂移检查：`npm run check-translators`（手动）。
