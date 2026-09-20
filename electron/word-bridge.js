'use strict';

/**
 * LitBoard Word 桥（主进程）：cscript 常驻子进程管理 + 行协议收发。
 * - lazy start keeps one cscript helper process alive
 * - 串行队列：Word COM 单线程，命令逐个执行（默认 30s 超时，超时/崩溃整体失败并重建）
 * - 协议 v3（见 word/wordbridge.js 头部注释）：
 *     请求  REQ|b64(requestId)|b64(sessionId)|b64(documentId)|b64(line)
 *     响应  RES|1|b64(requestId)|b64(sessionId)|b64(result)   （ERR 时第 2 段为 0，末段为 b64(error)）
 *     兼容  裸命令行（legacy）→ OK|rest / ERR|b64(msg)
 *   载荷只用 base64(UTF-8) 字段，**不使用 JSON**——WSH 的 cscript 宿主不保证有原生 JSON
 *   对象（实测 Win10/11 机器上 `JSON` 未定义，且 //B 模式下静默死亡），这是 v2 的真 bug。
 * - line 由本侧按命令组装（与 legacy 行格式完全一致）；所有字符串参数 base64(UTF-8)。
 */

const { spawn: defaultSpawn } = require('node:child_process');

const PROTOCOL_VERSION = 3;

function wordBridgeId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function wordBridgeEncode(value) {
  return Buffer.from(String(value == null ? '' : value), 'utf8').toString('base64');
}
function wordBridgeDecode(value) {
  return Buffer.from(String(value || ''), 'base64').toString('utf8');
}
function wordBridgeError(message, code, status) {
  const error = new Error(String(message || 'Word bridge error'));
  if (code) error.code = code;
  if (status) error.status = status;
  return error;
}

/** 把 command + documentId + args 组装成 legacy 命令行（wordbridge.js 的分派格式） */
function composeCommandLine(command, documentId, args) {
  const a = args && typeof args === 'object' ? args : {};
  const doc = String(documentId || '');
  switch (String(command || '').toUpperCase()) {
    case 'FIELDS':
    case 'UNLINK':
      return command + '|' + wordBridgeEncode(doc);
    case 'SAVECOPY':
      return command + '|' + wordBridgeEncode(doc) + '|' + wordBridgeEncode(a.target || a.newPath || '');
    case 'INSERT':
      return command + '|' + wordBridgeEncode(a.payload || '') + '|' + wordBridgeEncode(a.text || '');
    case 'APPLY':
      return command + '|' + wordBridgeEncode(doc) + '|' + String(a.results || '') + '|' +
        String(a.bibliography || '') + '|' + String(a.codes || '') + '|' + String(a.format || '');
    case 'BIB':
      return command + '|' + String(a.entries || '') + '|' + String(a.format || '');
    default:
      return String(command || '');
  }
}

function createWordBridgeV2(options) {
  options = options || {};
  const scriptPath = String(options.scriptPath || '');
  const spawnProcess = options.spawn || defaultSpawn;
  const cscriptPath = options.cscriptPath || 'cscript.exe';
  const sessionId = String(options.sessionId || wordBridgeId('ws-'));
  const defaultTimeout = Number(options.defaultTimeout) > 0 ? Number(options.defaultTimeout) : 30000;
  let proc = null;
  let starting = null;
  let queue = [];
  let pending = null;
  let buffer = '';
  let generation = 0;

  function makeRequest(value, timeoutMs) {
    const requestId = wordBridgeId('wr-');
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : defaultTimeout;
    if (typeof value === 'string') value = { line: String(value) };
    value = value && typeof value === 'object' ? value : {};
    const command = String(value.command || '').toUpperCase();
    let line = value.line == null ? '' : String(value.line);
    if (!line) {
      if (!/^[A-Z][A-Z0-9_-]*$/.test(command)) throw new Error('Invalid Word bridge command');
      line = composeCommandLine(command, value.documentId, value.args);
    } else if (!/^[A-Z]+(?:\|.*)?$/.test(line)) {
      throw new Error('Invalid Word bridge command');
    }
    const documentId = value.documentId == null ? '' : String(value.documentId);
    return { requestId: requestId, sessionId: sessionId, timeout: timeout,
      wire: 'REQ|' + [requestId, sessionId, documentId, line].map(wordBridgeEncode).join('|') };
  }

  function rejectItem(item, error) {
    if (!item) return;
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    item.reject(error);
  }
  function rejectAll(error) {
    const active = pending;
    const queued = queue;
    pending = null;
    queue = [];
    rejectItem(active, error);
    queued.forEach(function (item) { rejectItem(item, error); });
  }
  function terminate(child) {
    if (!child) return;
    try { if (child.stdin) child.stdin.end(); } catch (error) {}
    try { if (typeof child.kill === 'function' && !child.killed) child.kill(); } catch (error) {}
  }
  function fail(error, child) {
    if (child && proc !== child) return;
    const old = proc;
    proc = null;
    starting = null;
    buffer = '';
    generation++;
    rejectAll(error);
    terminate(old);
  }

  function settle(payload, legacy) {
    const item = pending;
    if (!item) return;
    if (!legacy && (payload.requestId !== item.requestId ||
        (payload.sessionId && payload.sessionId !== item.sessionId))) return;
    pending = null;
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    if (legacy) {
      if (payload.ok) item.resolve(payload.result);
      else item.reject(wordBridgeError(payload.error || 'Word bridge returned an error', 'WORD_BRIDGE_REMOTE'));
    } else if (payload.ok) {
      item.resolve(payload.result);
    } else {
      item.reject(wordBridgeError(payload.error || 'Word bridge returned an error', 'WORD_BRIDGE_REMOTE'));
    }
    pump();
  }

  function onLine(line, child, childGeneration) {
    if (child !== proc || childGeneration !== generation) return;
    if (line.indexOf('RES|') === 0) {
      const fields = line.slice(4).split('|');
      if (fields.length < 5) {
        fail(wordBridgeError('Invalid Word bridge response', 'WORD_BRIDGE_PROTOCOL'), child);
        return;
      }
      settle({
        ok: fields[0] === '1',
        requestId: wordBridgeDecode(fields[1]),
        sessionId: wordBridgeDecode(fields[2]),
        result: wordBridgeDecode(fields[3]),
        error: wordBridgeDecode(fields[4])
      }, false);
      return;
    }
    const separator = line.indexOf('|');
    const head = separator === -1 ? line : line.slice(0, separator);
    const rest = separator === -1 ? '' : line.slice(separator + 1);
    if (head !== 'OK' && head !== 'ERR') return;
    let message = rest;
    if (head === 'ERR') {
      try { message = wordBridgeDecode(rest); } catch (error) {}
    }
    settle({ ok: head === 'OK', result: rest, error: message }, true);
  }

  function startProcess() {
    if (proc && !proc.killed) return Promise.resolve(proc);
    if (starting) return starting;
    starting = new Promise(function (resolve, reject) {
      let child;
      try {
        child = spawnProcess(cscriptPath, ['//Nologo', '//B', scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch (error) {
        starting = null;
        reject(wordBridgeError('Unable to start Word bridge: ' + error.message, 'WORD_BRIDGE_START'));
        return;
      }
      if (!child || !child.stdin || !child.stdout || !child.stderr || typeof child.on !== 'function') {
        starting = null;
        reject(wordBridgeError('Invalid Word bridge process', 'WORD_BRIDGE_START'));
        return;
      }
      const childGeneration = generation;
      buffer = '';
      child.stdout.on('data', function (chunk) {
        buffer += chunk.toString('utf8');
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line) onLine(line, child, childGeneration);
        }
      });
      child.stderr.on('data', function () {});
      child.on('error', function (error) {
        const wrapped = wordBridgeError('Unable to start Word bridge: ' + error.message, 'WORD_BRIDGE_START', 'unknown');
        if (proc === child && starting) {
          proc = null;
          starting = null;
          generation++;
          reject(wrapped);
          rejectAll(wrapped);
        } else fail(wrapped, child);
      });
      child.on('exit', function () {
        if (proc !== child) return;
        proc = null;
        starting = null;
        buffer = '';
        generation++;
        rejectAll(wordBridgeError('Word bridge process exited', 'WORD_BRIDGE_EXIT', 'unknown'));
      });
      proc = child;
      resolve(child);
    });
    return starting;
  }

  function pump() {
    if (pending || !proc) return;
    const item = queue.shift();
    if (!item) return;
    pending = item;
    item.startedAt = Date.now();
    item.timer = setTimeout(function () {
      if (pending !== item) return;
      fail(wordBridgeError('Word bridge request timed out after ' + item.timeout + 'ms', 'WORD_BRIDGE_TIMEOUT', 'unknown'), proc);
    }, item.timeout);
    try { proc.stdin.write(item.wire + '\n'); }
    catch (error) { fail(wordBridgeError('Unable to write to Word bridge: ' + error.message, 'WORD_BRIDGE_WRITE', 'unknown'), proc); }
  }

  function invoke(value, timeoutMs) {
    let request;
    try { request = makeRequest(value, timeoutMs); }
    catch (error) { return Promise.reject(error); }
    return new Promise(function (resolve, reject) {
      queue.push({ requestId: request.requestId, sessionId: request.sessionId, wire: request.wire,
        timeout: request.timeout, resolve: resolve, reject: reject, timer: null, startedAt: 0 });
      startProcess().then(pump, function (error) { fail(error); });
    });
  }

  function stop() {
    fail(wordBridgeError('Word bridge stopped', 'WORD_BRIDGE_STOPPED', 'unknown'));
  }

  function status() {
    return { running: !!(proc && !proc.killed), queued: queue.length + (pending ? 1 : 0),
      sessionId: sessionId, protocolVersion: PROTOCOL_VERSION };
  }

  return { invoke: invoke, stop: stop, status: status, protocolVersion: PROTOCOL_VERSION };
}

module.exports = { createWordBridge: createWordBridgeV2, PROTOCOL_VERSION: PROTOCOL_VERSION };
