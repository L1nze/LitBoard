#!/usr/bin/env node
'use strict';

/* M4 性能基准采集：在隔离目录重复运行功能冒烟，收集分段计时并输出 P50/P95。
 * 指标：mainBootMs（主进程启动→页面加载完成）、libraryLoadMs（渲染层就绪时刻）、
 *       loadLibraryMs（整库读取）、saveLibraryMs（全量保存）。
 * 用法：node scripts/perf-baseline.js [轮数=5] [electron.exe 路径]
 * 注意：这是「冷启动 + 空库」场景的相对基准，用于回归对比；不等于计划第四节的正式验收
 * （后者需要 1 万篇确定性数据集与受控硬件，见 docs/audit-baseline.md）。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const rounds = Math.max(1, Number(process.argv[2]) || 5);
const electronPath = process.argv[3] || path.join(
  process.env.LOCALAPPDATA || '', 'LitBoardBuildTools', 'node_modules', 'electron', 'dist', 'electron.exe');

if (!fs.existsSync(electronPath)) {
  console.error('perf-baseline: 找不到 electron.exe（%s）', electronPath);
  process.exit(2);
}

const METRICS = ['mainBootMs', 'libraryLoadMs', 'loadLibraryMs', 'saveLibraryMs'];
const samples = [];
let fails = 0;

for (let i = 0; i < rounds; i++) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'litboard-perf-'));
  const resultFile = path.join(workDir, 'result.json');
  const run = spawnSync(electronPath, ['.', '--user-data-dir=' + path.join(workDir, 'ud')], {
    cwd: projectRoot,
    env: Object.assign({}, process.env, {
      LITBOARD_SMOKE_TEST: '1',
      LITBOARD_SMOKE_RESULT: resultFile
    }),
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true
  });
  try {
    const payload = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (run.status !== 0) throw new Error('smoke failed');
    samples.push(payload);
    console.log('round %d: %s', i + 1, METRICS.map(function (m) { return m + '=' + payload[m]; }).join(' '));
  } catch (error) {
    fails++;
    console.error('round %d: FAILED (%s)', i + 1, error.message);
  }
  fs.rmSync(workDir, { recursive: true, force: true });
}

if (!samples.length) {
  console.error('perf-baseline: 无有效样本');
  process.exit(1);
}

function percentile(list, p) {
  const sorted = list.slice().sort(function (a, b) { return a - b; });
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

console.log('\n=== 基准汇总（n=%d，失败 %d）===', samples.length, fails);
for (const metric of METRICS) {
  const values = samples.map(function (s) { return Number(s[metric]); }).filter(Number.isFinite);
  if (!values.length) continue;
  const line = metric.padEnd(16) +
    ' P50=' + percentile(values, 50) + 'ms' +
    ' P95=' + percentile(values, 95) + 'ms' +
    ' min=' + Math.min.apply(null, values) +
    ' max=' + Math.max.apply(null, values);
  console.log(line);
}
process.exit(fails > 0 ? 1 : 0);
