'use strict';
/* 上游 translator 漂移检查（阶段五收尾工具，手动运行，不进 CI）。
 *
 * LitBoard 的 js/translators.js 是自维护实现（未复用 Zotero 源码），但站点 dialect 以
 * Zotero translators 仓库为参照系。本脚本查询 zotero/translators 上游每个对应文件的
 * 最后提交时间，报告「上游近期有变动」的 translator，提醒人工核对我们自己的选择器。
 *
 * 用法：
 *   node scripts/check-translator-upstream.js           # 默认 90 天阈值，表格输出
 *   node scripts/check-translator-upstream.js --days 30 # 自定义阈值
 *   node scripts/check-translator-upstream.js --json    # 机器可读输出
 *
 * 退出码：0 正常（含「无漂移」）；2 网络/接口错误。
 * 注意：GitHub 匿名 API 限速 60 次/小时，本脚本约 20 次请求。
 */
const https = require('node:https');

const SITES = [
  { id: 'arxiv', label: 'arXiv', keywords: ['arxiv'] },
  { id: 'pubmed', label: 'PubMed', keywords: ['pubmed'] },
  { id: 'cnki', label: 'CNKI', keywords: ['cnki'] },
  { id: 'google-scholar', label: 'Google Scholar', keywords: ['google scholar'] },
  { id: 'sciencedirect', label: 'ScienceDirect', keywords: ['sciencedirect', 'science direct'] },
  { id: 'springer', label: 'SpringerLink', keywords: ['springer'] },
  { id: 'wiley', label: 'Wiley', keywords: ['wiley'] },
  { id: 'tandf', label: 'Taylor & Francis', keywords: ['taylor', 'francis'] },
  { id: 'acs', label: 'ACS', keywords: ['acs.js', 'acs'] },  { id: 'ieee', label: 'IEEE', keywords: ['ieee xplore', 'ieee'] },
  { id: 'acm', label: 'ACM', keywords: ['acm digital', 'acm'] },
  { id: 'plos', label: 'PLOS', keywords: ['plos journals', 'plos'] },
  { id: 'frontiers', label: 'Frontiers', keywords: ['frontiers'] },
  { id: 'oxford', label: 'Oxford', keywords: ['oxford academic', 'oxford university press', 'oxford'] },
  { id: 'cambridge', label: 'Cambridge', keywords: ['cambridge core', 'cambridge'] },
  { id: 'nature', label: 'Nature', keywords: ['nature publishing group', 'nature'] },
  { id: 'science', label: 'Science', keywords: ['science magazine', 'aaas', 'science.js'] },
  { id: 'biorxiv', label: 'bioRxiv', keywords: ['biorxiv'] },
  { id: 'medrxiv', label: 'medRxiv', keywords: ['medrxiv'] }
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { days: 90, json: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days') { out.days = Math.max(1, Number(args[i + 1]) || 90); i++; }
    else if (args[i] === '--json') out.json = true;
  }
  return out;
}

function getJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'LitBoard-translator-drift-check', 'Accept': 'application/vnd.github+json' } }, function (res) {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' @ ' + url));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const opts = parseArgs();
  const cutoff = Date.now() - opts.days * 24 * 3600 * 1000;
  const contents = await getJson('https://api.github.com/repos/zotero/translators/contents/');
  if (!Array.isArray(contents)) throw new Error('上游目录响应异常');
  const files = contents.map(function (e) { return e.name; }).filter(function (n) { return /\.js$/.test(n); });

  const rows = [];
  // 评分匹配：全等 > 前缀 > 包含（避免 PubMed Central 抢先 PubMed、CLACSO 抢先 ACS 之类错位）
  function score(nameLower, kw) {
    const base = nameLower.replace(/\.js$/, '');
    if (base === kw) return 100;
    if (base.indexOf(kw + ' ') === 0 || base.indexOf(kw + '-') === 0) return 80;
    if (base.indexOf(' ' + kw) !== -1 || base.indexOf(kw) === 0) return 60;
    // 词边界包含（30）优先于裸子串（5）：避免 CLACSO 抢先 ACS、arXiv 抢先 rxiv
    if (new RegExp('(^|[\\s_-])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s_-]|$)').test(base)) return 30;
    if (base.indexOf(kw) !== -1) return 5;
    return -1;
  }
  for (const site of SITES) {
    let best = '';
    let bestScore = -1;
    files.forEach(function (name) {
      const lower = name.toLowerCase();
      site.keywords.forEach(function (kw) {
        const s = score(lower, kw);
        if (s > bestScore) { bestScore = s; best = name; }
      });
    });
    const match = bestScore >= 60 ? best : ''; // 只接受全等/前缀/词首匹配，避免子串误配（CLACSO≠ACS）
    if (!match) {
      rows.push({ id: site.id, label: site.label, file: '', lastCommit: '', days: null, drift: false, note: '上游无对应 translator' });
      continue;
    }
    const commits = await getJson('https://api.github.com/repos/zotero/translators/commits?path=' + encodeURIComponent(match) + '&per_page=1');
    const dateStr = commits && commits[0] && commits[0].commit && commits[0].commit.committer
      ? commits[0].commit.committer.date : '';
    const t = dateStr ? Date.parse(dateStr) : NaN;
    const days = Number.isFinite(t) ? Math.floor((Date.now() - t) / (24 * 3600 * 1000)) : null;
    rows.push({ id: site.id, label: site.label, file: match, lastCommit: dateStr.slice(0, 10), days: days,
      drift: days != null && t > cutoff, note: '' });
  }

  if (opts.json) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), thresholdDays: opts.days, rows: rows }, null, 2));
    return;
  }
  console.log('上游仓库：zotero/translators · 阈值：' + opts.days + ' 天内有上游变动即提示核对\n');
  const drifted = rows.filter(function (r) { return r.drift; });
  rows.forEach(function (r) {
    const flag = r.drift ? ' [!] 上游有变动，需核对我们的选择器' : (r.note || '');
    console.log((r.days == null ? '  ???' : String(r.days).padStart(5) + 'd') + '  ' +
      r.label.padEnd(16) + ' ' + (r.file || '(无对应)').padEnd(28) + ' ' + (r.lastCommit || '-').padEnd(12) + flag);
  });
  console.log('\n共 ' + rows.length + ' 站：' + drifted.length + ' 站上游近期有变动' +
    (drifted.length ? ' → ' + drifted.map(function (r) { return r.label; }).join('、') : ''));
}

main().catch(function (e) {
  console.error('漂移检查失败：' + (e && e.message || e));
  process.exit(2);
});
