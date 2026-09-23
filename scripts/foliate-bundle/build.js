'use strict';

/**
 * LitBoard EPUB 内核 vendor 构建脚本（一次性外置构建，仓库保持零 node_modules）。
 *
 * 源码：johnfactotum/foliate-js 钉 commit（版本唯一真源：本目录 package.json 的 foliatejs.commit；
 * 该项目无版本线，npm 上的 foliate-js@1.0.1 是第三方快照，不采用）。clone 到外置目录：
 *   %LOCALAPPDATA%\LitBoardFoliateSrc\repo（含上游 vendor/zip.js、vendor/fflate.js）
 * 用法：node scripts/foliate-bundle/build.js
 * 产物：vendor/foliate/foliate.min.js（IIFE，挂 window.LitFoliate：makeBook/CFI/Overlayer，
 *       并注册 <foliate-view> 自定义元素）
 *
 * 升级 commit 后必须重跑 vendor-hashes 并更新 docs/THIRD-PARTY.md。
 */
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const srcRoot = process.env.LITBOARD_FOLIATE_SRC
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LitBoardFoliateSrc');
const cloneDir = path.join(srcRoot, 'repo');
const toolsDir = process.env.LITBOARD_AUI_TOOLS
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LitBoardAuiTools');

const pinned = JSON.parse(fsSync.readFileSync(path.join(scriptDir, 'package.json'), 'utf8')).foliatejs;
const esbuild = require(path.join(toolsDir, 'node_modules', 'esbuild'));

function ensureSource() {
  const git = function (args, opts) {
    execFileSync('git', args, Object.assign({ stdio: 'inherit' }, opts));
  };
  if (!fsSync.existsSync(path.join(cloneDir, '.git'))) {
    fsSync.mkdirSync(srcRoot, { recursive: true });
    console.log('[foliate-bundle] cloning ' + pinned.source + ' ...');
    git(['clone', pinned.source, cloneDir]);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cloneDir }).toString().trim();
  if (head !== pinned.commit) {
    console.log('[foliate-bundle] checkout pinned commit ' + pinned.commit.slice(0, 12) + ' (HEAD=' + head.slice(0, 12) + ')');
    git(['fetch', 'origin', 'main'], { cwd: cloneDir });
    git(['checkout', pinned.commit], { cwd: cloneDir });
  }
}

async function build() {
  // 入口放 clone 内：view.js 的动态 import('./vendor/zip.js') 等按相对路径解析
  const entryInRepo = path.join(cloneDir, '_litboard_entry.mjs');
  fsSync.writeFileSync(entryInRepo, fsSync.readFileSync(path.join(scriptDir, 'entry.mjs')));

  const outfile = path.join(repoRoot, 'vendor', 'foliate', 'foliate.min.js');
  fsSync.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [entryInRepo],
    bundle: true,
    format: 'iife',
    globalName: 'LitFoliateBundle',
    target: 'es2022',
    minify: true,
    outfile: outfile,
    // 只保留 EPUB 链路：pdf/mobi/fb2/comic-book/dict 是 view.js 的动态 import，
    // LitBoard 的 PDF 走 MuPDF——external 保留惰性调用，EPUB 流程不触发
    plugins: [{
      name: 'litboard-epub-only',
      setup: function (build) {
        build.onResolve({ filter: /^\.(\/pdf|mobi|fb2|comic-book|dict)\.js$/ },
          function (args) { return { path: args.path, external: true }; });
      }
    }],
    logLevel: 'warning'
  });
  // 许可文件随包分发（THIRD-PARTY 台账引用）
  fsSync.copyFileSync(path.join(cloneDir, 'LICENSE'), path.join(path.dirname(outfile), 'LICENSE.foliate-js'));
  const size = fsSync.statSync(outfile).size;
  console.log('[foliate-bundle] built vendor/foliate/foliate.min.js (' + Math.round(size / 1024) + ' KB) @ ' + pinned.commit.slice(0, 12));
  console.log('[foliate-bundle] next: node scripts/vendor-hashes.js && update docs/THIRD-PARTY.md');
}

ensureSource();
build().catch(function (err) { console.error(err); process.exit(1); });
