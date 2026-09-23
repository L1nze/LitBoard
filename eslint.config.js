'use strict';

/*
 * LitBoard ESLint 扁平配置。
 *
 * 设计取舍：
 * 1) 本文件自包含 —— 不 require('globals') / require('@eslint/js')，因此
 *    「项目目录零 node_modules」路径下（eslint 装在 %LOCALAPPDATA%\LitBoardLintTools，
 *    见 scripts/lint.js）也能直接加载。
 * 2) 只拦真 bug 一类的问题（未定义标识符、重复声明、不可达代码、错误的正则/字符类……），
 *    不做风格审查：代码库是无框架的 ES5 风格 vanilla JS，风格统一交给 .editorconfig 与 AGENTS.md。
 * 3) 存量代码量大（js/ + electron/ 约 1.9 万行），因此 no-unused-vars 等规则按 warning 起步，
 *    CI 只以 error 为门槛；想收紧时逐个改成 error 即可。
 */

const ecmaVersion = 2022;

// js/*.js 之间通过全局名字互调（UMD 双出口：浏览器挂 window.LitXxx，Node 走 module.exports）
const UMD_GLOBALS = {
  LitAgent: 'readonly',
  LitGraphGen: 'readonly',
  LitWebFetch: 'readonly',
  LitGraphView: 'readonly',
  LitAgentChat: 'readonly',
  LitAgentCore: 'readonly',
  LitAgentCfg: 'readonly',
  LitAgentProto: 'readonly',
  LitEmbedCfg: 'readonly',
  LitAgentLoop: 'readonly',
  LitAgentReason: 'readonly',
  LitAgentUi: 'readonly',
  LitResearch: 'readonly',
  LitAuthors: 'readonly',
  LitBib: 'readonly',
  LitCite: 'readonly',
  LitCsl: 'readonly',
  LitCslJson: 'readonly',
  LitDedupe: 'readonly',
  LitEnrich: 'readonly',
  LitFolderImport: 'readonly',
  LitMarkdown: 'readonly',
  LitMerge: 'readonly',
  LitModel: 'readonly',
  LitOcr: 'readonly',
  LitPdf: 'readonly',
  LitPdfSearch: 'readonly',
  LitQuery: 'readonly',
  LitRename: 'readonly',
  LitRis: 'readonly',
  LitSync: 'readonly',
  // electron/preload.js 经 contextBridge 暴露的桥接对象（渲染层唯一的主进程入口）
  litboardDesktop: 'readonly',
  // 挂在 window 上的第三方运行时 / 主进程注入的标记
  CSL: 'readonly',
  Tesseract: 'readonly',
  vis: 'readonly',
  litboardReadyAt: 'writable',
  litboardSqliteReady: 'writable',
};

const BROWSER_GLOBALS = {
  window: 'readonly',
  self: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  screen: 'readonly',
  console: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  indexedDB: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  fetch: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileList: 'readonly',
  FileReader: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  XMLHttpRequest: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  PointerEvent: 'readonly',
  DragEvent: 'readonly',
  WheelEvent: 'readonly',
  TouchEvent: 'readonly',
  ClipboardEvent: 'readonly',
  DataTransfer: 'readonly',
  EventTarget: 'readonly',
  Node: 'readonly',
  NodeFilter: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLSelectElement: 'readonly',
  HTMLAnchorElement: 'readonly',
  HTMLImageElement: 'readonly',
  Image: 'readonly',
  ImageData: 'readonly',
  CanvasRenderingContext2D: 'readonly',
  OffscreenCanvas: 'readonly',
  DOMParser: 'readonly',
  DOMPoint: 'readonly',
  DOMRect: 'readonly',
  DOMException: 'readonly',
  Range: 'readonly',
  Selection: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  BroadcastChannel: 'readonly',
  MessageChannel: 'readonly',
  MessagePort: 'readonly',
  Worker: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  ReadableStream: 'readonly',
  WebAssembly: 'readonly',
  TextMetrics: 'readonly',
  getComputedStyle: 'readonly',
  getSelection: 'readonly',
  matchMedia: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  requestIdleCallback: 'readonly',
  cancelIdleCallback: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  scrollTo: 'readonly',
  scrollBy: 'readonly',
  open: 'readonly',
  devicePixelRatio: 'readonly',
  innerWidth: 'readonly',
  innerHeight: 'readonly',
  // 项目自身禁用原生弹窗（AGENTS.md），登记为存在但不鼓励使用
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
};

const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  queueMicrotask: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  structuredClone: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  ReadableStream: 'readonly',
  WebAssembly: 'readonly',
};

// 以「真 bug」为准的门槛规则；风格类规则一律不启用
const BASE_RULES = {
  // 可能的错误
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-unreachable-loop': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-obj-calls': 'error',
  'no-setter-return': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-cond-assign': 'error',
  'no-constant-binary-expression': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-ex-assign': 'error',
  'no-fallthrough': 'error',
  'no-async-promise-executor': 'error',
  'no-irregular-whitespace': 'error',
  'no-loss-of-precision': 'error',
  'valid-typeof': 'error',
  'no-empty-character-class': 'error',
  'no-misleading-character-class': 'error',
  // 有意使用控制字符，属设计而非笔误：文件名清洗（\x00-\x1f）、
  // BOM 剥离等，见 electron/backup.js、js/rename.js
  'no-control-regex': 'off',
  'no-template-curly-in-string': 'error',
  'no-unexpected-multiline': 'error',
  'no-useless-backreference': 'error',
  'require-atomic-updates': 'off',
  'no-debugger': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-proto': 'error',
  'no-extend-native': 'error',
  'no-global-assign': 'error',

  // 存量代码暂按 warning，修完再逐条升为 error
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-useless-escape': 'warn',
  'no-regex-spaces': 'warn',
  'no-sparse-arrays': 'warn',
  'no-unsafe-finally': 'warn',
  'no-prototype-builtins': 'warn',
  'no-return-assign': 'warn',
  'no-throw-literal': 'warn',
  'no-unmodified-loop-condition': 'warn',
  'no-unused-private-class-members': 'warn',
  'no-useless-call': 'warn',
  'no-useless-catch': 'warn',
  'no-useless-concat': 'warn',
  'no-useless-return': 'warn',
  'no-warning-comments': 'off',
};

module.exports = [
  {
    // 第三方 vendor 代码、构建产物、生成的图标不在审查范围
    ignores: [
      'vendor/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'extension/icons/**',
      'extension/js/**', // 生成的共享 translator 拷贝（源在 js/translators.js，由 pack-extension.ps1 同步）
      '.tmp/**', // 本地临时产物（gitignore），不属审查范围
      'scripts/one-off/**/probe-dist/**', // 探针构建产物（第三方 SDK bundle/模型副本），不属审查范围
    ],
  },

  {
    // 渲染层：ES5 风格 classic script，UMD 双出口，浏览器与 Node 都要能加载
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion,
      sourceType: 'script',
      globals: Object.assign({}, BROWSER_GLOBALS, NODE_GLOBALS, UMD_GLOBALS),
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: BASE_RULES,
  },

  {
    // Electron 主进程 / preload：CommonJS + Node
    files: ['electron/**/*.js'],
    languageOptions: {
      ecmaVersion,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS,
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: BASE_RULES,
  },

  {
    // 浏览器扩展：MV3 service worker + content script + popup（均为 classic script）
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion,
      sourceType: 'script',
      globals: Object.assign({}, BROWSER_GLOBALS, {
        chrome: 'readonly',
        importScripts: 'readonly',
        self: 'readonly',
      }),
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: BASE_RULES,
  },

  {
    // 构建脚本与测试：纯 Node
    files: ['scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion,
      sourceType: 'commonjs',
      globals: NODE_GLOBALS,
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: BASE_RULES,
  },

  {
    // 测试会刻意构造危险输入（javascript: URL、畸形 bib/ris）来验证净化与容错逻辑，
    // 在这里关掉这类规则，避免把「测试数据」误判成「测试代码的问题」
    files: ['test/**/*.js'],
    rules: {
      'no-script-url': 'off',
    },
  },
];
