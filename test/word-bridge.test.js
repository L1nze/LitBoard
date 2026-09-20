'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createWordBridge } = require('../electron/word-bridge.js');

function b64(value) {
  return Buffer.from(String(value == null ? '' : value), 'utf8').toString('base64');
}
function unb64(value) {
  return Buffer.from(String(value || ''), 'base64').toString('utf8');
}

/** v3 响应：RES|1|b64(requestId)|b64(sessionId)|b64(result)|（5 字段，末段 error 为空） */
function response(child, requestId, sessionId, result) {
  const wire = 'RES|1|' + b64(requestId) + '|' + b64(sessionId) + '|' + b64(result) + '|\n';
  child.stdout.emit('data', Buffer.from(wire, 'utf8'));
}

function makeChild(onLine) {
  const child = new EventEmitter();
  child.killed = false;
  child.stdin = {
    write: function (line) { onLine(String(line).trim(), child); },
    end: function () {}
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = function () {
    child.killed = true;
    child.emit('exit', null, 'SIGTERM');
    return true;
  };
  return child;
}

/** v3 请求：REQ|b64(requestId)|b64(sessionId)|b64(documentId)|b64(line) */
function decodeRequest(line) {
  assert.match(line, /^REQ\|/);
  const fields = line.slice(4).split('|');
  assert.ok(fields.length >= 4, 'request carries 4 fields');
  return {
    requestId: unb64(fields[0]),
    sessionId: unb64(fields[1]),
    documentId: unb64(fields[2]),
    line: unb64(fields[3])
  };
}

test('Word bridge sends structured requests and correlates responses by request id', async function () {
  const children = [];
  const bridge = createWordBridge({
    scriptPath: path.join('word', 'wordbridge.js'),
    spawn: function () {
      const child = makeChild(function (line, current) {
        const request = decodeRequest(line);
        response(current, request.requestId, request.sessionId, 'echo:' + request.line);
      });
      children.push(child);
      return child;
    }
  });

  const result = await bridge.invoke({ command: 'PING', args: { unicode: '中文 “quote” 𠀀' } }, 100);
  assert.equal(result, 'echo:PING');
  assert.equal(children.length, 1);
  bridge.stop();
});

test('Word bridge composes legacy command lines from command + documentId + args', async function () {
  let seen = null;
  const bridge = createWordBridge({
    scriptPath: 'word/wordbridge.js',
    spawn: function () {
      return makeChild(function (line, child) {
        seen = decodeRequest(line);
        response(child, seen.requestId, seen.sessionId, '');
      });
    }
  });

  await bridge.invoke({ command: 'INSERT', documentId: 'D:\\文档 \\练习.docx', args: { payload: 'P1', text: 'T1' } }, 100);
  // b64 不含 '|'：行内参数按 b64 段切开后逐一解码核对
  const insertParts = seen.line.split('|');
  assert.equal(insertParts[0], 'INSERT');
  assert.equal(unb64(insertParts[1]), 'P1');
  assert.equal(unb64(insertParts[2]), 'T1');
  assert.equal(seen.documentId, 'D:\\文档 \\练习.docx');

  await bridge.invoke({ command: 'BIB', documentId: 'd.docx', args: { entries: 'E1;E2' } }, 100);
  assert.equal(seen.line, 'BIB|E1;E2|');
  // 参考文献段落格式（rtf 模式 + 缩进/制表位 twips）随行尾传入
  await bridge.invoke({ command: 'BIB', documentId: 'd.docx', args: { entries: 'E1;E2', format: 'rtf,384,-384,0,1,384' } }, 100);
  assert.equal(seen.line, 'BIB|E1;E2|rtf,384,-384,0,1,384');

  await bridge.invoke({ command: 'APPLY', documentId: 'd.docx', args: { results: 'T1', bibliography: 'B1', codes: 'C1', format: 'rtf,384,-384,0,1,384' } }, 100);
  assert.equal(seen.line, 'APPLY|' + b64('d.docx') + '|T1|B1|C1|rtf,384,-384,0,1,384');

  await bridge.invoke({ command: 'FIELDS', documentId: 'd.docx' }, 100);
  assert.equal(seen.line, 'FIELDS|' + b64('d.docx'));
  bridge.stop();
});

test('Word bridge ignores a response for another request id', async function () {
  const bridge = createWordBridge({
    scriptPath: 'word/wordbridge.js',
    spawn: function () {
      return makeChild(function (line, child) {
        const request = decodeRequest(line);
        response(child, 'wrong-request', request.sessionId, 'wrong');
        setImmediate(function () {
          response(child, request.requestId, request.sessionId, 'right');
        });
      });
    }
  });

  assert.equal(await bridge.invoke({ command: 'INFO' }, 100), 'right');
  bridge.stop();
});

test('Word bridge decodes base64 results with unicode text', async function () {
  const bridge = createWordBridge({
    scriptPath: 'word/wordbridge.js',
    spawn: function () {
      return makeChild(function (line, child) {
        const request = decodeRequest(line);
        response(child, request.requestId, request.sessionId, '16.0|2|D:\\论文 一.docx;D:\\论文 二.docx');
      });
    }
  });

  assert.equal(await bridge.invoke({ line: 'INFO' }, 100), '16.0|2|D:\\论文 一.docx;D:\\论文 二.docx');
  bridge.stop();
});

test('Word bridge surfaces JScript-side error text from RES failure responses', async function () {
  const bridge = createWordBridge({
    scriptPath: 'word/wordbridge.js',
    spawn: function () {
      return makeChild(function (line, child) {
        const request = decodeRequest(line);
        const wire = 'RES|0|' + b64(request.requestId) + '|' + b64(request.sessionId) + '||' +
          b64('Microsoft Word is not running') + '\n';
        child.stdout.emit('data', Buffer.from(wire, 'utf8'));
      });
    }
  });

  await assert.rejects(bridge.invoke({ command: 'APPLY' }, 100), /Microsoft Word is not running/);
  bridge.stop();
});

test('Word bridge starts timeout when a request begins execution and rejects queued work after timeout', async function () {
  let writes = 0;
  let child;
  const bridge = createWordBridge({
    scriptPath: 'word/wordbridge.js',
    spawn: function () {
      child = makeChild(function () { writes++; });
      return child;
    }
  });

  const first = bridge.invoke({ command: 'APPLY' }, 25);
  const second = bridge.invoke({ command: 'BIB' }, 25);
  await assert.rejects(first, /timed out|超时/i);
  await assert.rejects(second, /timeout|stopped|退出|Word bridge/i);
  assert.equal(writes, 1);
  assert.equal(child.killed, true);
  bridge.stop();
});

test('Word bridge rejects queued and active requests on stop', async function () {
  const bridge = createWordBridge({
    scriptPath: 'word/wordbridge.js',
    spawn: function () { return makeChild(function () {}); }
  });
  const first = bridge.invoke({ command: 'FIELDS' }, 1000);
  const second = bridge.invoke({ command: 'UNLINK' }, 1000);
  bridge.stop();
  await assert.rejects(first, /stopped|停止/i);
  await assert.rejects(second, /stopped|停止/i);
});

test('Word bridge helper source is pure ASCII for Windows cscript', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'word', 'wordbridge.js'));
  for (const byte of source) assert.ok(byte < 0x80, 'non-ASCII byte in wordbridge.js');
  // v3 契约：JScript 侧不得调用 JSON（cscript 宿主不保证有原生 JSON）
  assert.doesNotMatch(source.toString('ascii'), /JSON\s*\.\s*(parse|stringify)/, 'wordbridge.js must not use JSON');
  // Quit 契约：word.Quit 只允许出现在 quitGhost（幽灵实例清理）里——隐藏且 0 文档的
  // 残留实例抢占 ROT 后 GetObject 永远命不中用户真正的实例，必须清掉；其余任何
  // 路径（UNLINK/SAVECOPY/停桥等）都不得 Quit 用户的 Word。
  const ascii = source.toString('ascii');
  const ghostFn = /function quitGhost\(\) \{[\s\S]*?\n\}/.exec(ascii);
  assert.ok(ghostFn, 'quitGhost helper missing');
  assert.match(ghostFn[0], /\.Quit\s*\(/i, 'quitGhost must be the Quit call site');
  assert.doesNotMatch(ascii.replace(ghostFn[0], ''), /\.Quit\s*\(/i, 'word.Quit is only allowed inside quitGhost');
});
