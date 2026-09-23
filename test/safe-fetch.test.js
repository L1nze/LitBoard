'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSafePublicHttpsFetch, isPublicIp, pinnedLookup } = require('../electron/safe-fetch.js');

test('safe fetch rejects private, reserved and disguised loopback addresses', function () {
  for (const ip of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    'fc00::1', 'fe80::1', '2001:db8::1'
  ]) assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
});

test('safe fetch pins the vetted DNS answer into the request', async function () {
  const seen = [];
  const fetcher = createSafePublicHttpsFetch({
    lookup: async function () { return [{ address: '8.8.8.8', family: 4 }]; },
    request: async function (url, init, pinned) {
      seen.push({ url: url.href, pinned: pinned });
      return { status: 200, ok: true, headers: { get: function () { return null; } } };
    }
  });
  await fetcher('https://papers.example/file.pdf');
  assert.deepEqual(seen, [{ url: 'https://papers.example/file.pdf', pinned: { address: '8.8.8.8', family: 4 } }]);
});

test('pinned lookup supports Node single-address and all-address callback shapes', async function () {
  const lookup = pinnedLookup({ address: '8.8.8.8', family: 4 });
  const one = await new Promise(function (resolve, reject) {
    lookup('ignored.example', {}, function (error, address, family) {
      if (error) reject(error); else resolve({ address: address, family: family });
    });
  });
  assert.deepEqual(one, { address: '8.8.8.8', family: 4 });
  const all = await new Promise(function (resolve, reject) {
    lookup('ignored.example', { all: true }, function (error, addresses) {
      if (error) reject(error); else resolve(addresses);
    });
  });
  assert.deepEqual(all, [{ address: '8.8.8.8', family: 4 }]);
});

test('safe fetch rejects a hostname if any DNS answer is private', async function () {
  let requested = false;
  const fetcher = createSafePublicHttpsFetch({
    lookup: async function () { return [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]; },
    request: async function () { requested = true; }
  });
  await assert.rejects(() => fetcher('https://papers.example/file.pdf'), /本机、内网/);
  assert.equal(requested, false);
});

test('safe fetch validates and pins every redirect hop', async function () {
  const lookups = [];
  const requests = [];
  const fetcher = createSafePublicHttpsFetch({
    lookup: async function (host) {
      lookups.push(host);
      return [{ address: host === 'first.example' ? '8.8.8.8' : '1.1.1.1', family: 4 }];
    },
    request: async function (url, init, pinned) {
      requests.push({ host: url.hostname, pinned: pinned.address });
      if (url.hostname === 'first.example') {
        return { status: 302, discard: function () {}, headers: { get: function () { return 'https://second.example/p.pdf'; } } };
      }
      return { status: 200, ok: true, headers: { get: function () { return null; } } };
    }
  });
  await fetcher('https://first.example/start');
  assert.deepEqual(lookups, ['first.example', 'second.example']);
  assert.deepEqual(requests, [{ host: 'first.example', pinned: '8.8.8.8' }, { host: 'second.example', pinned: '1.1.1.1' }]);
});

test('safe fetch follows at most five redirects and rejects unsafe redirect targets', async function () {
  let count = 0;
  const looping = createSafePublicHttpsFetch({
    lookup: async function () { return [{ address: '8.8.8.8', family: 4 }]; },
    request: async function () {
      count++;
      return { status: 302, discard: function () {}, headers: { get: function () { return 'https://example.com/' + count; } } };
    }
  });
  await assert.rejects(() => looping('https://example.com/start'), /重定向次数/);
  assert.equal(count, 6);

  const privateRedirect = createSafePublicHttpsFetch({
    lookup: async function () { return [{ address: '8.8.8.8', family: 4 }]; },
    request: async function () {
      return { status: 302, discard: function () {}, headers: { get: function () { return 'https://[::ffff:7f00:1]/x'; } } };
    }
  });
  await assert.rejects(() => privateRedirect('https://example.com/start'), /本机、内网/);
  await assert.rejects(() => privateRedirect('http://example.com/start'), /公共 HTTPS/);
});
