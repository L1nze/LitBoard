'use strict';

// Shared by tool IPC and agent:cancel. Turn keys prevent late cancellation from
// affecting the next request in the same session.
const active = new Map();
const stopped = new Map();
function key(input) { return String(input && input.sessionId || '') + '|' + String(input && input.turnId || ''); }
function check(signal) {
  if (signal.aborted) { const error = new Error('该轮已停止，操作未执行'); error.name = 'AbortError'; throw error; }
}
async function run(input, task) {
  const id = key(input), controller = new AbortController();
  if (stopped.has(id)) controller.abort();
  let controllers = active.get(id);
  if (!controllers) { controllers = new Set(); active.set(id, controllers); }
  controllers.add(controller);
  try { check(controller.signal); return await task(controller.signal); }
  finally { controllers.delete(controller); if (!controllers.size) active.delete(id); }
}
function cancel(sessionId, turnId) {
  const id = key({ sessionId: sessionId, turnId: turnId });
  stopped.set(id, true);
  while (stopped.size > 100) stopped.delete(stopped.keys().next().value);
  active.forEach(function (controllers, operationKey) {
    if (operationKey === id || (!turnId && operationKey.startsWith(String(sessionId) + '|'))) {
      controllers.forEach(function (controller) { controller.abort(); });
    }
  });
}
module.exports = { run: run, cancel: cancel, check: check };
