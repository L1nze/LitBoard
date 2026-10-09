
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Operations = require('../electron/agent-operations.js');
test('cancel aborts in-flight operations and rejects late operations only for that turn', async () => {
  let activeSignal;
  const operation = Operations.run({ sessionId: 's', turnId: 't' }, async signal => { activeSignal = signal; await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); Operations.check(signal); });
  Operations.cancel('s', 't');
  assert.equal(activeSignal.aborted, true); await assert.rejects(operation, /已停止/);
  await assert.rejects(Operations.run({ sessionId: 's', turnId: 't' }, () => assert.fail('late side effect')), /已停止/);
  assert.equal(await Operations.run({ sessionId: 's', turnId: 't2' }, async signal => !signal.aborted), true);
});
