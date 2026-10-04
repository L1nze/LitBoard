'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLibraryDb } = require('../electron/db.js');
const { createBridgeServer } = require('../electron/bridge-server.js');

async function makeBridge(t, fetchImpl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-bridge-'));
  const db = createLibraryDb(dir);
  await db.open();
  const saved = [];
  const bridge = createBridgeServer({
    libraryDb: db,
    downloadsDir: dir,
    fetch: fetchImpl || (async function () { throw new Error('offline'); }),
    pdfFetch: fetchImpl || (async function () { throw new Error('offline'); }),
    onSaved: function (info) { saved.push(info); }
  });
  t.after(async function () {
    await bridge.stop();
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { bridge, db, saved };
}

test('bridge server serves ping, saves papers with token auth, dedupes by DOI', async function (t) {
  const { bridge, db, saved } = await makeBridge(t, async function (url) {
    // 模拟 OpenAlex 响应
    return new Response(JSON.stringify({
      title: 'Attention Is All You Need',
      publication_year: 2017,
      doi: 'https://doi.org/10.48550/arXiv.1706.03762',
      authorships: [{ author: { display_name: 'Ashish Vaswani' } }],
      primary_location: { source: { display_name: 'NeurIPS' } },
      cited_by_count: 90000
    }), { status: 200 });
  });
  const status = await bridge.start();
  assert.equal(status.running, true);
  const base = 'http://127.0.0.1:' + status.port;

  const ping = await fetch(base + '/ping').then(function (r) { return r.json(); });
  assert.equal(ping.ok, true);

  // 无令牌 → 401
  const unauthorized = await fetch(base + '/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x' })
  });
  assert.equal(unauthorized.status, 401);

  // 正常保存（联网补全被 mock 拦截）
  const save = await fetch(base + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ doi: '10.48550/arXiv.1706.03762', url: 'https://arxiv.org/abs/1706.03762' })
  }).then(function (r) { return r.json(); });
  assert.equal(save.ok, true);
  assert.equal(save.duplicated, false);
  assert.match(save.title, /Attention/);
  assert.equal(saved.length, 1);

  // 同 DOI 再存 → 合并去重
  const again = await fetch(base + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ doi: '10.48550/arxiv.1706.03762' })
  }).then(function (r) { return r.json(); });
  assert.equal(again.duplicated, true);

  const state = await db.loadState();
  assert.equal(state.papers.length, 1);
  assert.equal(state.papers[0].authors[0], 'Vaswani, Ashish');
  assert.equal(state.papers[0].citations, 90000);
});

test('bridge rejects private PDF URLs without sending them to its metadata transport', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-bridge-security-'));
  const db = createLibraryDb(dir);
  await db.open();
  const calls = [];
  const bridge = createBridgeServer({
    libraryDb: db, downloadsDir: dir,
    fetch: async function (url) {
      calls.push(url);
      return new Response(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048)]));
    }
  });
  t.after(async function () {
    await bridge.stop(); await db.close(); await fs.rm(dir, { recursive: true, force: true });
  });
  const status = await bridge.start();
  for (const pdfUrl of ['http://127.0.0.1/private.pdf', 'https://192.168.1.1/private.pdf']) {
    const result = await fetch('http://127.0.0.1:' + status.port + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
      body: JSON.stringify({ title: pdfUrl, pdfUrl: pdfUrl,
        attachments: [{ url: 'http://169.254.169.254/metadata.pdf' }] })
    }).then(r => r.json());
    assert.equal(result.ok, true);
    assert.equal(result.pdfAttached, false);
  }
  assert.deepEqual(calls, []);
});

test('bridge rejects non-object JSON on both write endpoints', async function (t) {
  const { bridge } = await makeBridge(t);
  const status = await bridge.start();
  for (const endpoint of ['/save', '/attach-pdf']) {
    for (const body of ['null', '[]', '"text"', '123']) {
      const response = await fetch('http://127.0.0.1:' + status.port + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token }, body: body
      });
      assert.equal(response.status, 400, endpoint + ': ' + body);
    }
  }
});

test('bridge server honors the disabled setting and offline enrichment still saves', async function (t) {
  const { bridge, db } = await makeBridge(t);
  await db.setSetting('bridgeEnabled', false);
  const stopped = await bridge.start();
  assert.equal(stopped.running, false);

  await db.setSetting('bridgeEnabled', true);
  const status = await bridge.start();
  assert.equal(status.running, true);
  const save = await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ title: '离线标题入库', url: 'https://example.com/paper' })
  }).then(function (r) { return r.json(); });
  assert.equal(save.ok, true);
  assert.equal(save.title, '离线标题入库');
});

test('CNKI page metadata repairs a malformed PDF journal name for the same DOI', async function (t) {
  const { bridge, db } = await makeBridge(t);
  db.bridgeUpsertPaper({
    doi: '10.3901/JME.260773', title: '保障数据隐私的锂电池多用户协同智能健康监测通用基础模型',
    venue: '机械工程学报第', year: 2026
  });
  const status = await bridge.start();
  const response = await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({
      doi: '10.3901/JME.260773', title: '保障数据隐私的锂电池多用户协同智能健康监测通用基础模型',
      venue: '机械工程学报', authors: ['张微', '常希鹏', '李响', '杨绍杰'],
      volume: '62', issue: '11', issn: '0577-6686', sourceType: 'translator:cnki'
    })
  }).then(r => r.json());
  assert.equal(response.duplicated, true);
  const papers = db.loadState().papers;
  assert.equal(papers.length, 1);
  assert.equal(papers[0].venue, '机械工程学报');
  assert.equal(papers[0].issn, '0577-6686');
  assert.deepEqual(papers[0].authors, ['张微', '常希鹏', '李响', '杨绍杰']);

  db.bridgeUpsertPaper({ doi: '10.1234/hv-tech', title: '储能电池荷电状态评估',
    venue: '高电压技术 · 查看该刊数据库收录来源' });
  const repaired = await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ doi: '10.1234/hv-tech', title: '储能电池荷电状态评估',
      venue: '高电压技术', sourceType: 'translator:cnki' })
  }).then(r => r.json());
  assert.equal(repaired.duplicated, true);
  assert.equal(db.loadState().papers.find(p => p.doi === '10.1234/hv-tech').venue, '高电压技术');
});

test('bridge start is idempotent and stop releases its only listener', async function (t) {
  const { bridge } = await makeBridge(t);
  const first = await bridge.start();
  const second = await bridge.start();
  assert.equal(second.port, first.port);
  await bridge.stop();
  await assert.rejects(fetch('http://127.0.0.1:' + first.port + '/ping'));
  assert.deepEqual(bridge.status(), { running: false, port: null });
});

test('bridge serializes interleaved lifecycle operations', async function (t) {
  const { bridge } = await makeBridge(t);
  const firstStart = bridge.start();
  const firstStop = bridge.stop();
  const secondStart = bridge.start();
  const finalStop = bridge.stop();
  await Promise.all([firstStart, firstStop, secondStart, finalStop]);
  assert.deepEqual(bridge.status(), { running: false, port: null });
});

test('bridge saving a trashed DOI creates a new visible paper instead of restoring it', async function (t) {
  const { bridge, db } = await makeBridge(t);
  const deletedAt = Date.now();
  await db.saveState({ papers: [{
    id: 'p1', title: 'Trashed Paper', doi: '10.1000/trashed', deletedAt: deletedAt, updatedAt: deletedAt
  }] });
  const status = await bridge.start();
  const result = await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ title: 'Trashed Paper', doi: '10.1000/trashed' })
  }).then(function (response) { return response.json(); });
  assert.equal(result.ok, true);
  assert.equal(result.duplicated, false);
  const papers = (await db.loadState()).papers;
  const trashed = papers.find(function (paper) { return paper.id === 'p1'; });
  const visible = papers.find(function (paper) { return paper.id !== 'p1'; });
  assert.equal(trashed.deletedAt, deletedAt);
  assert.equal(visible.deletedAt, null);
  assert.equal(visible.doi, '10.1000/trashed');
});

test('bridge lists folders, saves into chosen folder, and reports current folder', async function (t) {
  const { bridge, db } = await makeBridge(t);
  await db.saveState({
    papers: [],
    folders: [
      { id: 'f1', name: '根目录', parentId: '', sortIndex: 0 },
      { id: 'f2', name: '子目录', parentId: 'f1', sortIndex: 0 }
    ]
  });
  const status = await bridge.start();
  const base = 'http://127.0.0.1:' + status.port;
  const headers = { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token };

  // 未设置当前文件夹时
  const foldersResp = await fetch(base + '/folders', { headers: { 'X-LitBoard-Token': status.token } })
    .then(function (r) { return r.json(); });
  assert.equal(foldersResp.ok, true);
  assert.equal(foldersResp.currentFolderId, '');
  assert.deepEqual(foldersResp.folders.map(function (f) { return f.id; }), ['f1', 'f2']);
  assert.equal(foldersResp.folders[1].depth, 1);

  // 渲染层回报当前查看文件夹为 f1
  bridge.setCurrentFolder('f1');
  const foldersResp2 = await fetch(base + '/folders', { headers: { 'X-LitBoard-Token': status.token } })
    .then(function (r) { return r.json(); });
  assert.equal(foldersResp2.currentFolderId, 'f1');

  // 保存进当前文件夹
  const save = await fetch(base + '/save', {
    method: 'POST', headers: headers,
    body: JSON.stringify({ title: '知网论文标题', doi: '10.1000/cnki-folder', venue: '科学通报', year: 2012, volume: '57', issue: '34', pages: '3219-3227', tags: ['实验'], folderId: 'f1' })
  }).then(function (r) { return r.json(); });
  assert.equal(save.ok, true);
  let paper = (await db.loadState()).papers[0];
  assert.deepEqual(paper.folderIds, ['f1']);
  assert.equal(paper.venue, '科学通报');
  assert.deepEqual(paper.tags, ['实验']);
  assert.equal(paper.pages, '3219-3227');

  // 重复保存并入新文件夹；未知文件夹 id 被忽略
  const again = await fetch(base + '/save', {
    method: 'POST', headers: headers,
    body: JSON.stringify({ title: '知网论文标题', doi: '10.1000/cnki-folder', folderId: 'f2' })
  }).then(function (r) { return r.json(); });
  assert.equal(again.duplicated, true);
  paper = (await db.loadState()).papers[0];
  assert.deepEqual(paper.folderIds, ['f1', 'f2']);

  const badFolder = await fetch(base + '/save', {
    method: 'POST', headers: headers,
    body: JSON.stringify({ title: '未知文件夹', folderId: 'nope' })
  }).then(function (r) { return r.json(); });
  assert.equal(badFolder.ok, true);
  paper = (await db.loadState()).papers.find(function (p) { return p.title === '未知文件夹'; });
  assert.deepEqual(paper.folderIds, []);
});

test('bridge attach-pdf accepts base64 PDF bytes from the extension', async function (t) {
  const { bridge, db } = await makeBridge(t);
  const status = await bridge.start();
  const base = 'http://127.0.0.1:' + status.port;
  const headers = { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token };

  await fetch(base + '/save', {
    method: 'POST', headers: headers,
    body: JSON.stringify({ title: '带附件论文', doi: '10.1000/attach-test' })
  });
  const paper = (await db.loadState()).papers[0];

  const fakePdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 0x25)]).toString('base64');
  const attach = await fetch(base + '/attach-pdf', {
    method: 'POST', headers: headers,
    body: JSON.stringify({ paperId: paper.id, pdfBase64: fakePdf, fileName: 'litboard-cnki-test.pdf' })
  }).then(function (r) { return r.json(); });
  assert.equal(attach.ok, true);

  const updated = (await db.loadState()).papers[0];
  assert.equal(updated.attachments.length, 1);
  assert.equal(updated.attachments[0].kind, 'pdf');
  assert.match(updated.attachments[0].fileName, /litboard-cnki-test\.pdf$/);
  const onDisk = await fs.readFile(updated.attachments[0].path);
  assert.ok(onDisk.subarray(0, 5).toString() === '%PDF-');

  // 非法 base64 / 非 PDF 被拒绝
  const bad = await fetch(base + '/attach-pdf', {
    method: 'POST', headers: headers,
    body: JSON.stringify({ paperId: paper.id, pdfBase64: 'aGVsbG8=', fileName: 'x.pdf' })
  }).then(function (r) { return r.json(); });
  assert.equal(bad.attached, false);
});

test('bridge falls back to Crossref when OpenAlex misses', async function (t) {
  const { bridge, db } = await makeBridge(t, async function (url) {
    if (url.indexOf('api.openalex.org') !== -1) return new Response('not found', { status: 404 });
    if (url.indexOf('api.crossref.org') !== -1) {
      return new Response(JSON.stringify({ message: {
        title: ['Crossref Only Paper'],
        author: [{ given: 'Ada', family: 'Lovelace' }],
        issued: { 'date-parts': [[1843]] },
        'container-title': ['Notes by the Translator'],
        volume: '1', issue: '2', page: '10-20',
        DOI: '10.1000/crossref-only',
        'is-referenced-by-count': 42,
        abstract: '<jats:p>Abstract text.</jats:p>'
      } }), { status: 200 });
    }
    throw new Error('unexpected url: ' + url);
  });
  const status = await bridge.start();
  const save = await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ doi: '10.1000/crossref-only' })
  }).then(function (r) { return r.json(); });
  assert.equal(save.ok, true);
  const paper = (await db.loadState()).papers[0];
  assert.equal(paper.title, 'Crossref Only Paper');
  assert.deepEqual(paper.authors, ['Lovelace, Ada']);
  assert.equal(paper.year, 1843);
  assert.equal(paper.venue, 'Notes by the Translator');
  assert.equal(paper.pages, '10-20');
  assert.equal(paper.citations, 42);
  assert.equal(paper.citationSource, 'Crossref');
  assert.equal(paper.abstract, 'Abstract text.');
});

test('bridge downloads the open-access PDF when the page has no direct pdfUrl', async function (t) {
  const { bridge, db } = await makeBridge(t, async function (url) {
    if (url.indexOf('api.openalex.org') !== -1) {
      return new Response(JSON.stringify({
        title: 'OA Paper',
        doi: 'https://doi.org/10.1000/oa-test',
        open_access: { oa_url: 'https://example.org/oa.pdf' }
      }), { status: 200 });
    }
    if (url === 'https://example.org/oa.pdf') {
      const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]);
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    throw new Error('unexpected url: ' + url);
  });
  const status = await bridge.start();
  const save = await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ doi: '10.1000/oa-test', title: 'OA Paper' })
  }).then(function (r) { return r.json(); });
  assert.equal(save.ok, true);
  assert.equal(save.pdfAttached, true);
  const paper = (await db.loadState()).papers[0];
  assert.equal(paper.oaUrl, 'https://example.org/oa.pdf');
  assert.equal(paper.attachments.length, 1);
  const onDisk = await fs.readFile(paper.attachments[0].path);
  assert.equal(onDisk.subarray(0, 5).toString(), '%PDF-');
});

test('bridge prefers the page pdfUrl over the OA fallback', async function (t) {
  const fetched = [];
  const { bridge } = await makeBridge(t, async function (url) {
    fetched.push(url);
    if (url.indexOf('api.openalex.org') !== -1) {
      return new Response(JSON.stringify({
        title: 'Both Sources', doi: 'https://doi.org/10.1000/both',
        open_access: { oa_url: 'https://example.org/oa.pdf' }
      }), { status: 200 });
    }
    if (/\.pdf$/.test(url)) {
      const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    throw new Error('unexpected url: ' + url);
  });
  const status = await bridge.start();
  await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ doi: '10.1000/both', title: 'Both Sources', pdfUrl: 'https://publisher.example/direct.pdf' })
  });
  const pdfFetches = fetched.filter(function (url) { return /\.pdf$/.test(url); });
  assert.deepEqual(pdfFetches, ['https://publisher.example/direct.pdf']);

});

test('bridge Origin 策略：扩展来源反射 Origin，网页来源不授予 CORS', async function (t) {
  const { bridge } = await makeBridge(t);
  const status = await bridge.start();
  assert.equal(status.running, true);
  const base = 'http://127.0.0.1:' + status.port;

  // chrome-extension 来源：反射 Origin
  const extPing = await fetch(base + '/ping', { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdef' } });
  assert.equal(extPing.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdef');

  // 普通网页来源：不回 Access-Control-Allow-Origin（跨站读取无许可）
  const webPing = await fetch(base + '/ping', { headers: { Origin: 'https://evil.example' } });
  assert.equal(webPing.headers.get('access-control-allow-origin'), null);

  // 无 Origin（同机直连进程）：同样不回 *
  const plainPing = await fetch(base + '/ping');
  assert.equal(plainPing.headers.get('access-control-allow-origin'), null);

  // token 鉴权不因来源放宽：扩展来源无 token 仍 401
  const extNoToken = await fetch(base + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnopabcdef' },
    body: JSON.stringify({ title: 'x' })
  });
  assert.equal(extNoToken.status, 401);
});

test('bridge resolves the download dir per save (mkdir included) and reports paperId', async function (t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'litboard-bridge-'));
  const db = createLibraryDb(dir);
  await db.open();
  const targetDir = path.join(dir, 'nested', 'oa-pdf'); // 不存在的目录，验证自动创建
  const saved = [];
  const bridge = createBridgeServer({
    libraryDb: db,
    resolveDownloadDir: async function () { return targetDir; },
    pdfFetch: async function (url) {
      assert.equal(url, 'https://example.org/resolver.pdf');
      const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]);
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    },
    fetch: async function (url) {
      if (url.indexOf('api.openalex.org') !== -1) {
        return new Response(JSON.stringify({
          title: 'Resolver Paper',
          doi: 'https://doi.org/10.1000/resolver-test',
          open_access: { oa_url: 'https://example.org/resolver.pdf' }
        }), { status: 200 });
      }
      if (url === 'https://example.org/resolver.pdf') {
        const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]);
        return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      throw new Error('unexpected url: ' + url);
    },
    onSaved: function (info) { saved.push(info); }
  });
  t.after(async function () {
    await bridge.stop();
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const status = await bridge.start();
  const save = await fetch('http://127.0.0.1:' + status.port + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': status.token },
    body: JSON.stringify({ doi: '10.1000/resolver-test', title: 'Resolver Paper' })
  }).then(function (r) { return r.json(); });
  assert.equal(save.ok, true);
  assert.equal(save.pdfAttached, true);

  const paper = (await db.loadState()).papers[0];
  assert.equal(paper.attachments.length, 1);
  assert.equal(path.dirname(paper.attachments[0].path), targetDir);
  const onDisk = await fs.readFile(paper.attachments[0].path);
  assert.equal(onDisk.subarray(0, 5).toString(), '%PDF-');

  // onSaved 带 paperId：渲染层靠它定位条目做后台补下载与全文索引
  assert.equal(saved.length, 1);
  assert.equal(saved[0].paperId, paper.id);
  assert.equal(saved[0].pdfAttached, true);
});
