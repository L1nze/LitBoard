'use strict';

/* 不可信 OA 链接的安全下载器：只连公共 HTTPS，DNS 解析结果在实际 TLS 连接中固定使用，
 * 避免「先查到公网 IP、连接时重新解析到内网」的 DNS rebinding 竞态。 */
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;

function ipv4Parts(host) {
  const parts = String(host).split('.');
  if (parts.length !== 4 || parts.some(function (part) { return !/^\d{1,3}$/.test(part); })) return null;
  const nums = parts.map(Number);
  return nums.every(function (n) { return n >= 0 && n <= 255; }) ? nums : null;
}

function ipv6Groups(input) {
  let host = String(input || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host.indexOf('%') !== -1 || host.split('::').length > 2) return null;
  const dotted = host.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4Parts(dotted[1]);
    if (!v4) return null;
    host = host.slice(0, host.length - dotted[1].length) +
      ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = host.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (left.concat(right).some(function (part) { return !/^[0-9a-f]{1,4}$/.test(part); })) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return left.concat(new Array(missing).fill('0'), right).map(function (part) { return parseInt(part, 16); });
}

function isPublicIpv4(parts) {
  const a = parts[0], b = parts[1], c = parts[2];
  return a !== 0 && a !== 10 && a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && b === 0 && c === 0) &&
    !(a === 192 && b === 0 && c === 2) &&
    !(a === 192 && b === 168) &&
    !(a === 198 && (b === 18 || b === 19)) &&
    !(a === 198 && b === 51 && c === 100) &&
    !(a === 203 && b === 0 && c === 113) &&
    a < 224;
}

function isPublicIp(address) {
  const host = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  const kind = net.isIP(host);
  if (kind === 4) return isPublicIpv4(ipv4Parts(host));
  if (kind !== 6) return false;
  const groups = ipv6Groups(host);
  if (!groups) return false;
  // IPv4-compatible / IPv4-mapped forms: apply the IPv4 policy to the embedded address.
  if (groups.slice(0, 5).every(function (n) { return n === 0; }) &&
      (groups[5] === 0 || groups[5] === 0xffff)) {
    return isPublicIpv4([groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255]);
  }
  const allZero = groups.every(function (n) { return n === 0; });
  const loopback = groups.slice(0, 7).every(function (n) { return n === 0; }) && groups[7] === 1;
  if (allZero || loopback) return false;
  if ((groups[0] & 0xfe00) === 0xfc00) return false; // unique-local fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((groups[0] & 0xffc0) === 0xfec0) return false; // deprecated site-local fec0::/10
  if ((groups[0] & 0xff00) === 0xff00) return false; // multicast
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  if (groups[0] === 0x2001 && (groups[1] & 0xffe0) === 0) return false; // special-use 2001:0::/27
  return true;
}

function validatePublicHttpsUrl(raw) {
  const url = new URL(String(raw || ''));
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('仅允许无凭据的公共 HTTPS 地址');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('禁止访问本机、内网或保留地址');
  if (net.isIP(host) && !isPublicIp(host)) throw new Error('禁止访问本机、内网或保留地址');
  return url;
}

async function resolvePublicAddresses(hostname, lookup) {
  const host = String(hostname).replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return [{ address: host, family: net.isIP(host) }];
  const resolved = await lookup(host, { all: true, verbatim: true });
  const list = Array.isArray(resolved) ? resolved : [resolved];
  if (!list.length || list.some(function (entry) {
    return !entry || !isPublicIp(typeof entry === 'string' ? entry : entry.address);
  })) throw new Error('目标域名解析到本机、内网或保留地址');
  return list.map(function (entry) {
    const address = typeof entry === 'string' ? entry : entry.address;
    return { address: address, family: (entry && entry.family) || net.isIP(address) };
  });
}

function nodeHttpsRequest(url, init, pinned) {
  const options = init || {};
  const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
  return new Promise(function (resolve, reject) {
    const req = https.request(url, {
      method: 'GET',
      headers: options.headers || {},
      signal: options.signal,
      // TLS 仍以 url.hostname 做 SNI/证书校验；这里只固定底层 socket 使用的已验证 IP。
      lookup: pinnedLookup(pinned)
    }, function (res) {
      const chunks = [];
      let size = 0;
      let consumed = false;
      resolve({
        status: Number(res.statusCode) || 0,
        ok: Number(res.statusCode) >= 200 && Number(res.statusCode) < 300,
        headers: { get: function (name) { return res.headers[String(name).toLowerCase()] || null; } },
        discard: function () { if (!consumed) { consumed = true; res.resume(); } },
        arrayBuffer: function () {
          if (consumed) return Promise.reject(new Error('响应正文已消费'));
          consumed = true;
          return new Promise(function (resolveBody, rejectBody) {
            res.on('data', function (chunk) {
              size += chunk.length;
              if (size > maxBytes) {
                req.destroy(new Error('下载内容超过大小上限'));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', function () {
              const body = Buffer.concat(chunks);
              resolveBody(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
            });
            res.on('error', rejectBody);
          });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function pinnedLookup(pinned) {
  return function (_hostname, lookupOptions, callback) {
    if (lookupOptions && lookupOptions.all === true) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };
}

function createSafePublicHttpsFetch(options) {
  const opts = options || {};
  const lookup = opts.lookup || function (host, input) { return dns.lookup(host, input); };
  const request = opts.request || nodeHttpsRequest;
  return async function safeFetch(rawUrl, init) {
    let url = validatePublicHttpsUrl(rawUrl);
    for (let redirects = 0; ; redirects++) {
      const addresses = await resolvePublicAddresses(url.hostname, lookup);
      const response = await request(url, init || {}, addresses[0]);
      const status = Number(response && response.status) || 0;
      if (status < 300 || status >= 400) return response;
      const location = response.headers && response.headers.get ? response.headers.get('location') : null;
      if (!location) return response;
      if (response.discard) response.discard();
      if (redirects >= MAX_REDIRECTS) throw new Error('重定向次数超过上限');
      url = validatePublicHttpsUrl(new URL(location, url).href);
    }
  };
}

module.exports = {
  MAX_REDIRECTS,
  isPublicIp,
  validatePublicHttpsUrl,
  resolvePublicAddresses,
  pinnedLookup,
  createSafePublicHttpsFetch
};
