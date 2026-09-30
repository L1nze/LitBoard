/* GitHub Release 更新判定：浏览器与主进程共用，保持无运行时依赖。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitUpdate = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function versionParts(value) {
    var match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''));
    return match ? match.slice(1).map(Number) : null;
  }

  function newer(remote, current) {
    var a = versionParts(remote);
    var b = versionParts(current);
    if (!a || !b) return false;
    for (var i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
  }

  function releaseInfo(release, currentVersion, portable) {
    if (!release || release.draft || release.prerelease || !newer(release.tag_name, currentVersion)) return null;
    var version = versionParts(release.tag_name).join('.');
    var expectedName = 'LitBoard-' + (portable ? 'Portable-' : 'Setup-') + version + '-x64.exe';
    var asset = Array.isArray(release.assets) && release.assets.find(function (item) {
      return item && item.name === expectedName && item.state === 'uploaded' &&
        item.browser_download_url === 'https://github.com/L1nze/LitBoard/releases/download/' +
          encodeURIComponent(release.tag_name) + '/' + expectedName;
    });
    if (!asset) return null;
    return { version: version, url: asset.browser_download_url, tagName: release.tag_name, fileName: asset.name };
  }

  /* 同 Release 的 SHA256SUMS.txt 直链（发布链 release-checksums 产出），用于下载后校验安装包。 */
  function sumsUrl(tagName) {
    return 'https://github.com/L1nze/LitBoard/releases/download/' + encodeURIComponent(tagName) + '/SHA256SUMS.txt';
  }

  /** SHA256SUMS.txt → { 文件名: 哈希 }；# 注释行与空行跳过 */
  function parseSha256Sums(text) {
    var map = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = /^([0-9a-fA-F]{64})\s+(\S.*)$/.exec(line.trim());
      if (m) map[m[2].trim()] = m[1].toLowerCase();
    });
    return map;
  }

  /** 更新缓存清扫计划：entries 里只留 keepNames（state.json 与当前唯一就绪安装包），其余列出待删 */
  function cacheSweepPlan(entries, keepNames) {
    var keep = {};
    (keepNames || []).forEach(function (name) { if (name) keep[name] = true; });
    var remove = [];
    (entries || []).forEach(function (name) { if (!keep[name]) remove.push(name); });
    return {
      keep: (entries || []).filter(function (name) { return keep[name]; }),
      remove: remove
    };
  }

  return { newer: newer, releaseInfo: releaseInfo, sumsUrl: sumsUrl, parseSha256Sums: parseSha256Sums, cacheSweepPlan: cacheSweepPlan };
});
