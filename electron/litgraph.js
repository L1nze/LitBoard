'use strict';
/* Rust 图谱计算内核（vendor/litgraph 预编译 .node，源码在 scripts/litgraph-bundle/rust/）。
 * 仅供主进程 require（渲染层 sandbox 无 Node 能力）；不可用（平台不符/未构建/ABI 不符）时
 * load() 返回 null，调用方（ipc/research.js 的 research:graph）回退 js/graphgen.js 纯 JS 路径。
 * 改内核源码后重跑 scripts/litgraph-bundle/build.js（cargo build + 拷贝 + 刷新哈希台账）。 */
const fsSync = require('node:fs');
const path = require('node:path');

let cached;
function load() {
  if (cached !== undefined) return cached;
  cached = null;
  const candidates = [];
  // 打包形态：asarUnpack 释出的 app.asar.unpacked（.node 不能留在 asar 里）
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'litgraph'));
  }
  // 开发形态：仓库 vendor 目录
  candidates.push(path.join(__dirname, '..', 'vendor', 'litgraph'));
  for (const dir of candidates) {
    const file = path.join(dir, 'litgraph.win32-x64-msvc.node');
    if (!fsSync.existsSync(file)) continue;
    try { cached = require(file); break; } catch (error) { /* 回退纯 JS */ }
  }
  return cached;
}

module.exports = { load };
