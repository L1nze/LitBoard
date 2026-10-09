(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LitAgentDispatch = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // The caller owns tool policy and persistence. This module only schedules calls.
  async function dispatchBatch(calls, options) {
    var list = Array.isArray(calls) ? calls : [], opts = options || {};
    var results = new Array(list.length), cursor = 0, failure = null;
    var commitTail = Promise.resolve(), cancellation = Promise.resolve();
    var concurrency = Math.max(1, Math.min(3, Math.floor(Number(opts.maxConcurrency) || 3)));
    function stopped() { return failure !== null || !!(opts.isCancelled && opts.isCancelled()); }
    function fail(error) {
      if (failure !== null) return;
      failure = error;
      if (opts.cancelActive) {
        try { cancellation = Promise.resolve(opts.cancelActive()).catch(function () {}); } catch (_) { /* Preserve the persistence error. */ }
      }
    }
    async function run(index) {
      var result;
      try { result = await opts.execute(list[index], index); }
      catch (error) {
        var call = list[index] || {};
        result = { callId: call.callId || call.id || '', name: call.name || (call.function && call.function.name) || '', error: true, result: JSON.stringify({ error: String(error && error.message || error) }) };
      }
      results[index] = result;
      var saving = commitTail.then(async function () {
        if (failure !== null) return;
        try { await opts.commit(result, index); } catch (error) { fail(error); }
      });
      commitTail = saving;
      await saving;
    }
    while (cursor < list.length && !stopped()) {
      var end = cursor + 1;
      var parallel = opts.canParallel && opts.canParallel(list[cursor], cursor) === true;
      if (parallel) while (end < list.length && opts.canParallel(list[end], end) === true) end++;
      var next = cursor;
      async function worker() {
        while (next < end && !stopped()) {
          var index = next++;
          await run(index);
        }
      }
      var workers = [];
      for (var w = 0; w < (parallel ? Math.min(concurrency, end - cursor) : 1); w++) workers.push(worker());
      await Promise.all(workers);
      cursor = end;
    }
    await commitTail;
    await cancellation;
    if (failure !== null) throw failure;
    return results;
  }
  return { dispatchBatch: dispatchBatch };
});
