# 第三方组件台账（THIRD-PARTY）

> 开源分发义务的唯一核对表：每个随应用分发的第三方组件——**版本、来源、哈希、许可证、NOTICE 义务**。
> 哈希为 SHA-256（完整值见 `vendor/` 旁的 `SHA256SUMS` 校验文件，由 `scripts/vendor-hashes.js` 生成）。
> 新增 vendor 文件时：登记本表 + 把哈希加进 `SHA256SUMS` + 在 README 的许可一节补一行
> （中文 `README.zh-CN.md`「第三方组件与许可」／英文 `README.md`「License」两处同步）。

## 运行时随应用分发的组件

| 组件 | 版本 | 来源 | 许可证 | 主要文件（SHA-256 前 16 位） |
|---|---|---|---|---|
| PDF.js | 5.7.284 | https://github.com/mozilla/pdf.js（官方 release 产物） | Apache-2.0 | `pdf.min.mjs` b0fc97331dc1fc03；`pdf.worker.min.mjs` 52fadd5b81b6abd1 |
| PDF.js 资源 | 同上 | 同上（standard_fonts / cmaps / wasm / iccs 随发行包） | Apache-2.0；字体见 `vendor/pdfjs/standard_fonts/LICENSE_FOXIT`、`LICENSE_LIBERATION`；cmaps 见 `vendor/pdfjs/cmaps/LICENSE` | 目录整体 |
| PDFium（WASM） | pdfium-binaries 构建版 | https://github.com/bblanchon/pdfium-binaries | BSD-3（Apache-2.0 部分，见 `vendor/pdfium/LICENSE*`） | `pdfium.js` e24557e912298bce；`pdfium.wasm` c0af5a6aca30d7e5 |
| pdf-lib | 1.17.x 系列（未在文件头标注） | https://github.com/Hopding/pdf-lib | MIT | `pdf-lib.min.js` 0f9a5cad07941f08 |
| tesseract.js | 5.x 系列（未在文件头标注） | https://github.com/naptha/tesseract.js | Apache-2.0 | `tesseract.min.js` a8e29918d098b2b0；`worker.min.js` aca1229639fc9907；`tesseract-core.wasm(.js)` b47a852b19181ae0 / 2b8c8c92b8788807 |
| OCR 语言包 | tessdata_fast（运行时下载） | https://github.com/tesseract-ocr/tessdata_fast | Apache-2.0 | 不随安装包分发；运行时下载到用户配置目录 `ocr/` |
| epub.js | 0.3.93 | https://github.com/futurepress/epub.js | BSD-2-Clause（© FuturePress） | `epub.min.js` ee1c5c592e19f0dd |
| JSZip | 3.10.1 | https://github.com/Stuk/jszip | MIT 或 GPLv3（本项目以 MIT 使用） | `jszip.min.js` 8d2c73c115c5b5c8 |
| citeproc-js | 1.4.61 | https://github.com/Juris-M/citeproc-js | CPAL-1.0 / AGPL-3.0 双许可（本项目以 CPAL 使用，署名 © Frank Bennett） | `citeproc.js` 55abba1a8b8b48c1 |
| CSL 样式 / 语言环境 | 随仓库快照 | https://github.com/citation-style-language/styles 、 /locales | CC BY-SA 3.0 | `vendor/citeproc/styles/*.csl`、`locales/*.xml` |
| bibtex-parse | 上游版（未在文件头标注） | https://github.com/noahfalk/（PEG.js 生成解析器，MIT） | MIT | `bibtex-parse.js` 041dc7977d34e890 |
| assistant-ui 对话层 bundle（react 18.3.1 + react-dom 18.3.1 + @assistant-ui/react 0.11.58，esbuild 0.25.12 构建） | 0.11.58 | 源码 scripts/agent-ui-bundle/（复现构建见其 README）；上游 https://github.com/assistant-ui/assistant-ui 、 https://github.com/facebook/react | react / react-dom：MIT；@assistant-ui/react：MIT（内嵌许可声明已随 legalComments:inline 保留在产物内） | `agent-chat.js`（完整值见 SHA256SUMS） |
| vis-network | 9.1.9（standalone UMD） | https://github.com/visjs/vis-network（官方 standalone 产物） | Apache-2.0 / MIT 双许可（本项目以 MIT 使用） | `vis-network.min.js` f53f833ddb9bf97e |
| MathJax（tex-svg 单文件组件） | 3.2.2 | https://github.com/mathjax/MathJax（官方 es5/tex-svg.js 产物） | Apache-2.0（完整文本随 `vendor/mathjax/LICENSE`） | `tex-svg.js` d4295dc337448369 |

## 构建工具（不随应用分发，装在 %LOCALAPPDATA%\LitBoardBuildTools）

| 组件 | 版本（唯一真源：package.json devDependencies） | 来源 | 许可证 |
|---|---|---|---|
| Electron | 39.2.7 | https://www.electronjs.org/ | MIT |
| electron-builder | 26.0.12 | https://www.electron.build/ | MIT |
| ESLint | ^10.10.0 | https://eslint.org/ | MIT |

## NOTICE 汇总

本应用分发时须随附（安装包内已含根目录 `LICENSE` 与各 vendor 目录下的 LICENSE 文件）：

1. Apache-2.0 组件（PDF.js、tesseract.js、pdf-lib 内嵌 tslib）：保留其 LICENSE 与 NOTICE 声明。
2. CPAL-1.0（citeproc-js）：署名 Frank Bennett；源码获取途径随仓库公开即满足。
3. BSD / MIT 组件：保留版权与许可声明（各 vendor 目录内 LICENSE 文件）。
4. CC BY-SA 3.0（CSL 样式）：署名 Citation Style Language 项目；样式文件随应用原样分发。

## 版本漂移与升级流程

- 上游有安全修复时，替换对应 vendor 文件后**必须**重跑 `node scripts/vendor-hashes.js` 刷新
  `SHA256SUMS`，并更新本表版本列；CI 不自动检查上游（ vendored 策略有意的取舍）。
- 上游 translator 漂移检查：`npm run check-translators`（手动）。
