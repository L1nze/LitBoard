"use strict";
const crypto = require('node:crypto');
const Mirror = require('../js/cloudmirror.js');
const T = require('../js/i18n.js').t;

// Explicit preview/apply only. Extra objects are moved to a recoverable archive, never deleted.
function createCloudMirror(hooks) {
  const plans = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const strong = etag => !!etag && !/^W\//i.test(etag);
  // PROPFIND getetag 与 HTTP ETag 在部分服务端引号形态不同，核对时按去引号等价比较
  const sameEtag = (a, b) => a === b || String(a).replace(/"/g, '') === String(b).replace(/"/g, '');
  const fail = message => { throw new Error(message); };
  const checkResponse = response => {
    hooks.rateLimit(response);
    if (!response.ok) fail(T('云端整理请求失败（HTTP ') + response.status + T('），请重新预览'));
  };
  async function assertLocal(plan, supplied) {
    const current = hooks.readWorkspace ? await hooks.readWorkspace() : supplied;
    if (!current || Mirror.signature(current) !== plan.localSignature) {
      const error = new Error(T('本机文献库已变化，请重新预览整理计划'));
      error.code = 'LOCAL_MIRROR_STALE';
      throw error;
    }
    hooks.checkCancelled();
  }
  async function assertRemote(plan, expected) {
    const current = await hooks.readLibrary(plan.options);
    hooks.checkCancelled();
    if (current.exists !== expected.exists || current.etag !== expected.etag ||
        hooks.hash(current.remote) !== hooks.hash(expected.remote)) fail(T('云端文献库已变化，请重新预览整理计划'));
    return current;
  }
  async function head(options, name) {
    const response = await hooks.request(hooks.join(options.attachmentsUrl, name), { method: 'HEAD', headers: options.headers });
    hooks.rateLimit(response);
    hooks.checkCancelled();
    if (!response.ok) fail(T('无法核对云端文件：') + name + '（HTTP ' + response.status + '）');
    return response.headers.get('etag') || '';
  }
  async function create(input) {
    if (!input.workspace || !Array.isArray(input.workspace.papers)) fail(T('本机文献库未加载，不能生成整理计划'));
    const options = await hooks.resolveOptions(input);
    options.headers['Cache-Control'] = 'no-cache';
    return hooks.withSession(options, async function () {
      const progress = (phase, message) => hooks.progress({ scope: 'plan', phase: phase, message: message });
      progress('library', T('正在读取云端文献库…'));
      const baseline = await hooks.readLibrary(options);
      if (baseline.exists && !strong(baseline.etag)) fail(T('云端不提供可靠的版本标识，不能安全整理'));
      const built = Mirror.build(input.workspace, baseline.remote || {}, Date.now());
      progress('inventory', T('正在列出云端文件清单…'));
      const inventory = await hooks.listAssets(options, true);
      if (inventory === null) fail(T('无法取得完整云端文件清单，不能生成整理计划'));
      const names = new Set(Mirror.activeAssets(built.workspace).map(a => a.cloudName).filter(Boolean));
      const candidates = [];
      for (const name of inventory) {
        if (names.has(name)) continue;
        if (hooks.safeName(name) !== name) fail(T('云端文件名无法安全处理，请先检查：') + name);
        candidates.push(name);
      }
      // 多余文件的 ETag 优先取自清单 PROPFIND 的 getetag（坚果云 HEAD 不返回 ETag，
      // 逐文件 HEAD 既拿不到版本标识、又受节流间隔拖慢预览）；清单未提供时回退 HEAD。
      const etags = hooks.listAssetEtags ? await hooks.listAssetEtags(options, true) : null;
      const extras = [];
      for (let i = 0; i < candidates.length; i++) {
        hooks.checkCancelled();
        const name = candidates[i];
        progress('extras', T('正在核对多余文件（') + (i + 1) + '/' + candidates.length + '）：' + name);
        const listed = etags ? etags.get(name) : '';
        extras.push({ name: name, etag: strong(listed) ? listed : await head(options, name) });
      }
      const missing = Mirror.activeAssets(built.workspace).filter(a => !a.cloudName || !inventory.has(a.cloudName))
        .map(a => ({ name: a.cloudName || a.fileName || a.id || '', hasLocalPath: !!(a.path || a.imagePath) }));
      const id = crypto.randomUUID();
      const plan = { id: id, options: options, baseline: baseline, localSignature: Mirror.signature(input.workspace),
        workspace: built.workspace, inventory: inventory, extras: extras };
      await assertLocal(plan, input.workspace);
      await assertRemote(plan, baseline);
      plans.set(id, plan);
      return { planId: id, mode: 'mirror', remoteExists: baseline.exists, remoteCount: built.remoteCount,
        localCount: built.localCount, changes: built.changes, extras: extras.map(a => ({ name: a.name })), missing: missing,
        cleanupSupported: extras.every(a => strong(a.etag)), remoteEtag: baseline.etag,
        archivePath: 'backups/cleanup-' + id + '/', conflicts: [], localOnly: [], remoteOnly: [] };
    });
  }
  async function apply(input) {
    const plan = plans.get(input.planId);
    if (!plan) fail(T('整理计划不存在或已过期，请重新预览'));
    if (!input.resolutions || input.resolutions['mirror:confirm'] !== 'local') fail(T('请先明确确认以本机文献库为准'));
    const cleanup = input.resolutions['mirror:cleanup'];
    if (cleanup !== 'local' && cleanup !== 'remote') fail(T('请先选择是否归档多余文件'));
    if (cleanup === 'local' && !plan.extras.every(a => strong(a.etag))) fail(T('部分文件缺少可靠版本标识，只能同步文献而不清理文件'));
    await assertLocal(plan, input.workspace);
    return hooks.withSession(plan.options, async function (session) {
      const progress = (phase, message) => hooks.progress({ scope: 'apply-plan', planId: plan.id, phase: phase, message: message });
      let written = null, workspace = clone(plan.workspace), moved = 0;
      const archivePath = 'backups/cleanup-' + plan.id + '/';
      const archiveUrl = hooks.join(plan.options.folderUrl, archivePath.replace(/\/$/, ''));
      try {
        const current = await assertRemote(plan, plan.baseline);
        // Every object in the reviewed removal list must still be the same object, before any mutation.
        if (cleanup === 'local') {
          const fresh = hooks.listAssetEtags ? await hooks.listAssetEtags(plan.options, true) : null;
          for (const asset of plan.extras) {
            const listed = fresh ? fresh.get(asset.name) : '';
            const current = listed || await head(plan.options, asset.name);
            if (!sameEtag(current, asset.etag)) fail(T('云端文件已变化，请重新预览：') + asset.name);
          }
        }
        await assertLocal(plan, input.workspace);
        progress('backup', T('正在保存整理前的云端清单…'));
        await hooks.ensureFolder(plan.options.url, plan.options.folderName + '/' + archivePath, plan.options.headers);
        hooks.checkCancelled();
        const manifest = JSON.stringify({ version: 1, createdAt: Date.now(), library: current.remote,
          objects: plan.extras.map((a, i) => ({ source: a.name, etag: a.etag, archived: String(i) + '.asset' })) });
        const manifestUrl = hooks.join(archiveUrl, 'manifest.json');
        const saved = await hooks.request(manifestUrl, { method: 'PUT', headers: Object.assign({}, plan.options.headers,
          { 'Content-Type': 'application/json', 'If-None-Match': '*' }), body: manifest });
        checkResponse(saved);
        const verify = await hooks.request(manifestUrl, { method: 'GET', headers: plan.options.headers });
        checkResponse(verify);
        if (await verify.text() !== manifest) fail(T('整理备份校验失败，已停止'));
        hooks.checkCancelled();
        progress('assets', T('正在补齐当前文献库的附件…'));
        const inventory = await hooks.listAssets(plan.options, true);
        if (inventory === null) fail(T('云端文件清单不可用，已停止整理'));
        const assets = await hooks.syncAssets(workspace, plan.options, { strict: false, remoteAssets: inventory,
          ledger: session.ledger, verifiedNames: session.verifiedNames,
          onProgress: function (assetProgress) {
            const current = assetProgress.current || '';
            hooks.progress({ scope: 'apply-plan', planId: plan.id, phase: 'assets',
              done: assetProgress.done, total: assetProgress.total, current: current,
              message: assetProgress.total > 0
                ? T('正在补齐当前文献库的附件（') + assetProgress.done + '/' + assetProgress.total + '）' +
                  (current ? ' · ' + current : '') + '…'
                : T('正在补齐当前文献库的附件…') });
          } });
        hooks.checkCancelled();
        if ((assets.failures || []).length || assets.pendingUpload || assets.missingOnCloud) {
          const details = (assets.failures || []).slice(0, 3).map(error => error.message).join('；');
          fail(T('当前文献库仍有附件未完成，未替换云端清单，也未清理文件；请补齐后重新预览') + (details ? ' · ' + details : ''));
        }
        await assertLocal(plan, input.workspace);
        await assertRemote(plan, current);
        written = await hooks.writeLibrary(plan.options, workspace, current, progress, session);
        // Persist the completed metadata reconciliation before cleanup; a partial cleanup must not repeat it.
        await hooks.writeBase({ version: 1, savedAt: Date.now(), remoteKey: plan.options.user + '\n' + plan.options.fileUrl,
          etag: written.current.etag || '', workspace: hooks.syncWorkspace(workspace), pins: {} });
        const keep = new Set(Mirror.activeAssets(workspace).map(a => a.cloudName).filter(Boolean));
        if (cleanup === 'local') for (let i = 0; i < plan.extras.length; i++) {
          const asset = plan.extras[i];
          if (keep.has(asset.name)) continue; // Upload may have reused an object previously classified as extra.
          await assertLocal(plan, input.workspace);
          await assertRemote(plan, written.current);
          hooks.checkCancelled();
          progress('cleanup', T('正在归档多余文件（') + (i + 1) + '/' + plan.extras.length + '）：' + asset.name);
          const destination = hooks.join(archiveUrl, String(i) + '.asset');
          const response = await hooks.request(hooks.join(plan.options.attachmentsUrl, asset.name), { method: 'MOVE',
            headers: Object.assign({}, plan.options.headers, { Destination: destination, Overwrite: 'F', 'If-Match': asset.etag }) });
          checkResponse(response);
          moved++;
          try { await assertRemote(plan, written.current); }
          catch (error) {
            // Another device may have referenced this object during MOVE. Restore without overwriting a new upload.
            if (error.code !== 'SYNC_CANCELLED') {
              const restore = await hooks.request(destination, { method: 'MOVE', headers: Object.assign({}, plan.options.headers,
                { Destination: hooks.join(plan.options.attachmentsUrl, asset.name), Overwrite: 'F' }) });
              if (restore.ok) moved--;
            }
            throw error;
          }
        }
        await assertRemote(plan, written.current);
        await assertLocal(plan, input.workspace);
        plans.delete(plan.id);
        return { workspace: workspace, assets: assets, mirror: { complete: true, moved: moved, archivePath: archivePath } };
      } catch (error) {
        plans.delete(plan.id); // Interrupted destructive plans are never auto-replayed.
        if (!written) throw error;
        return { workspace: error.code === 'LOCAL_MIRROR_STALE' ? null : workspace, mirror: { complete: false, moved: moved, archivePath: archivePath,
          message: String(error.message || error) } };
      }
    });
  }
  return { create: create, apply: apply, has: id => plans.has(String(id || '')) };
}
module.exports = { createCloudMirror };
