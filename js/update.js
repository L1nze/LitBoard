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
    return { version: version, url: asset.browser_download_url };
  }

  return { newer: newer, releaseInfo: releaseInfo };
});
