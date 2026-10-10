/* LitBoard Agent 编排层：模型↔工具循环（浏览器 / Node 共用，零依赖）
 *
 * 职责：把「请求模型 → 执行工具 → 回填结果 → 再请求」的编排从 UI 里抽出来，
 * 依赖全部注入（chat / executeTool / persist / emit），node:test 用 mock 驱动真实循环。
 *
 * 护栏语义：
 * - A03 取消贯穿：cancel() 同时置取消标记并取消在途网络；模型返回、每个工具执行前、
 *   每步循环开头都检查——取消后不再发起下一次模型请求，未执行的工具补「已停止」占位
 *   保持 tool_calls 与 tool 消息严格配对；
 * - A05 分级落地：aborted（用户停止，保留半截输出）/ partial（截断、空闲超时、流中断——
 *   内容保留 + 错误卡 + 手动重试）/ failed（异常，错误卡）/ done / max_steps / stuck；
 * - A06 崩溃恢复（2026-09-20 按业界实践重做）：流式增量**只进内存**，不落盘；
 *   落盘只在四个事件点——轮开始（写运行标记）、**执行工具前**（assistant 消息必须先落盘）、
 *   工具结果、轮收尾。事件点一律 await persist（R04：persist 返回「磁盘已提交」的
 *   Promise，缓存 1 秒防抖只覆盖高频 delta；保存失败停止本轮，副作用不得跨过失败检查点）；
 *   硬崩溃丢当前未完成的半截（业界一致取舍），运行标记留真时按
 *   LibreChat 式「unfinished 行」在下次打开时恢复为「已中断」+ 手动重试；
 * - A13 按轮重试：错误卡绑定 turnId；retry/edit 都定位到具体 user 消息截断重跑，
 *   beginTurn 重置单轮预算（steps / 重复检测），token 用量跨轮累计。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LitAgentLoop = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';


  function createRunner(options) {
    var opts = options || {};
    var Core = opts.core; // LitAgentCore
    var Context = opts.context || null; // LitAgentContext（压缩/溢出判定；未注入则跳过相关能力）
    var Dispatch = opts.dispatch || (typeof module === 'object' && module.exports ? require('./agentdispatch.js') : window.LitAgentDispatch);
    var chat = opts.chat;
    var executeTool = opts.executeTool;
    var buildBody = opts.buildBody;
    var persist = opts.persist || function () {};
    var emit = opts.emit || function () {};
    var maybeCompact = typeof opts.maybeCompact === 'function' ? opts.maybeCompact : null;
    var runners = new Map(); // runId → run

    async function checkpoint(run) {
      var saved = await persist(run);
      if (saved === null || saved === false) throw new Error('会话检查点保存失败，本轮已停止');
      return saved;
    }

    function register(run) { runners.set(run.id, run); }

    function cancel(runId) {
      var run = runners.get(String(runId || ''));
      if (!run || !run.streaming) return false;
      run.cancelRequested = true;
      if (typeof opts.cancelChat === 'function') opts.cancelChat(run.id, run.core.turnId);
      return true;
    }

    async function enqueue(runId, text) {
      var run = runners.get(String(runId || '')), value = String(text || '').trim();
      if (!run || !run.streaming || !value) return false;
      if (value.length > 10000) throw new Error('补充要求过长（最多 10000 字符）');
      var queue = run.doc.queuedInputs || (run.doc.queuedInputs = []);
      if (queue.length >= 10) throw new Error('补充要求队列已满（最多 10 条）');
      queue.push({ text: value, queuedAt: new Date().toISOString() });
      try { await checkpoint(run); } catch (error) { run.persistenceFailed = true; throw error; }
      emit(run.id, { type: 'queue_changed', count: queue.length });
      return true;
    }

    async function clearQueue(runId) {
      var run = runners.get(String(runId || ''));
      if (!run) return false;
      run.doc.queuedInputs = [];
      await checkpoint(run);
      emit(run.id, { type: 'queue_changed', count: 0 });
      return true;
    }

    async function drainQueue(run) {
      var queue = run.doc.queuedInputs || [];
      if (!queue.length) return;
      queue.splice(0).forEach(function (input) {
        run.core.messages.push({ role: 'user', content: '[补充要求]\n' + input.text, synthetic: true, kind: 'steering', turnId: run.core.turnId, ts: input.queuedAt });
      });
      await checkpoint(run);
      // 队列被消费后立刻通知：否则「已排队 n 条」要等到下一个流式增量才消失
      emit(run.id, { type: 'queue_changed', count: 0 });
    }

    function isStreaming(runId) {
      var run = runners.get(String(runId || ''));
      return !!(run && run.streaming);
    }

    /** UI 把主进程推送的流事件转发进来：流式增量**只进内存**，供实时渲染用。
     * 不落盘——业界（Cline / Roo / Cherry / Jan / Lobe / LibreChat / Open WebUI）
     * 一致的做法是「partial 不进存储」，落盘只发生在事件点（见 runTurn）。
     * 逐秒全量重写会话文件曾造成写放大，还会留下「缓冲与正式消息并存」的窗口期。 */
    function handleStreamEvent(runId, payload) {
      var run = runners.get(String(runId || ''));
      if (!run || !run.streaming || !payload) return;
      if (payload.type === 'delta' && typeof payload.text === 'string') {
        run.streamText = (run.streamText || '') + payload.text;
      } else if (payload.type === 'reasoning_delta' && typeof payload.text === 'string') {
        run.streamReasoning = (run.streamReasoning || '') + payload.text;
      } else if (payload.type === 'tool_call') {
        run.streamToolName = String(payload.name || run.streamToolName || '');
      } else {
        return; // done/aborted/error 等终止类事件由 runTurn 的返回值处理
      }
      run.phase = run.streamToolName && !run.streamText ? 'tools' : (run.streamText ? 'answering' : 'waiting');
    }

    /** 恢复会话时的中断处理（LibreChat 式「unfinished 行」）：
     * 上一次运行**确实没收尾**（doc.streaming 为真，只在事件点落盘后才会是终态）时，
     * 把残留缓冲（若崩溃前已落过则可能为空）恢复为「已中断」+ 可重试错误卡。
     * 恢复后调一次 persist 让终态落盘，避免下次启动重复恢复。 */
    function restoreInterrupted(run) {
      var doc = run.doc || {};
      var text = String(doc.streamText || '');
      var reason = String(doc.streamReasoning || '');
      var wasRunning = doc.streaming === true;
      // 残留缓冲一律清掉：留着会让下一次恢复误判为「中断」
      doc.streaming = false;
      doc.streamText = '';
      doc.streamReasoning = '';
      if (!wasRunning) return false;
      var messages = run.core.messages || [];
      // 崩溃时工具可能已产生副作用，但结果尚未提交：标为未知，绝不自动重放。
      // 已提交的结果保留；只补齐最后一批未配对调用，保证恢复后协议完整。
      var lastAssistant = -1;
      for (var a = messages.length - 1; a >= 0; a--) {
        if (messages[a].role === 'assistant') { lastAssistant = a; break; }
        if (messages[a].role === 'user' && !messages[a].synthetic) break;
      }
      if (lastAssistant >= 0) {
        var finished = new Set(messages.slice(lastAssistant + 1).filter(function (m) { return m.role === 'tool'; }).map(function (m) { return m.tool_call_id; }));
        var missing = (messages[lastAssistant].tool_calls || []).filter(function (call) { return !finished.has(call.id); });
        Core.appendToolResults(run.core, missing.map(function (call) {
          return { callId: call.id, name: call.function && call.function.name,
            result: '执行被中断，结果未确认。先核对现有数据；不要自动重复收藏、下载或写入。', error: true };
        }));
      }
      var recoveredImages = [];
      messages.forEach(function (msg) {
        if (msg.pendingImages) { recoveredImages.push(msg.pendingImages); delete msg.pendingImages; }
      });
      recoveredImages.forEach(function (msg) { messages.push(msg); });
      if (text) {
        // 防御：缓冲内容若已作为最近一条助手消息落账，就不再重复追加
        var duplicated = false;
        for (var i = messages.length - 1; i >= 0; i--) {
          var msg = messages[i];
          if (msg.role === 'user') break;
          if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content &&
              (msg.content === text || msg.content.indexOf(text) !== -1)) {
            duplicated = true;
            break;
          }
        }
        if (!duplicated) {
          run.core.messages.push({
            role: 'assistant',
            content: text,
            reasoning: reason,
            turnId: run.core.turnId || '',
            ts: new Date().toISOString()
          });
        }
      }
      run.core.messages.push({
        role: 'error',
        content: text
          ? '上次回复在此中断（应用退出或崩溃），以上为已保存的部分内容。'
          : '上一次请求未完成（应用退出或崩溃），该轮没有产生可保留的内容。',
        turnId: run.core.turnId || '',
        retry: true
      });
      run.doc.requestResume = { turnId: run.core.turnId || '', partial: true };
      return true;
    }

    /** 单轮编排：模型 → 工具 → 模型 → …… → 最终回答 / 护栏终止 / 取消 / 失败。
     *  对外入口把轮次 Promise 记到 run._turnPromise——waitIdle（R08 删除会话前等待
     *  活动操作收尾）靠它等「确认链/工具写入」真正落地，而不是只看取消标记。 */
    function runTurn(run) {
      var p = runTurnInner(run);
      run._turnPromise = p;
      return p;
    }

    async function runTurnInner(run) {
      register(run);
      var normalMaxSteps = run.core.maxSteps;
      run.streaming = true;
      run.cancelRequested = false;
      run.persistenceFailed = false;
      run.phase = 'waiting';
      run.streamText = '';
      run.streamReasoning = '';
      run.streamToolName = '';
      run.endReason = '';
      run.doc.streaming = true;   // 运行中标记：异常退出后据此判定「中断」（不能只看缓冲非空）
      run.forceContextTokens = 0; // 溢出减半预算只在本轮内生效，新一轮恢复用户设置的预算
      run.forceMaxOutputTokens = 0; // 输出上限降额同理（端点报 max_tokens 超上限时按报文给的上限重试一次）
      run.stepNoticeGiven = false; // 单轮只注入一次「步数将尽」收尾提示
      try {
        await checkpoint(run);
        while (true) {
          if (run.persistenceFailed) throw new Error('会话检查点保存失败，本轮已停止');
          if (run.cancelRequested) { run.endReason = 'stopped'; break; }
          await drainQueue(run);
          run.phase = 'waiting';
          // 上下文压缩钩子（R17）：发送前检查——活历史超阈值时先把旧对话摘要成一条
          // （agentui 注入：读设置、发 quiet 摘要请求、落盘；失败则本轮改走裁剪，不阻塞）
          if (maybeCompact) {
            await maybeCompact(run);
            if (run.cancelRequested) { run.endReason = 'stopped'; break; }
          }
          var body = buildBody(run);
          // R03：turnId 随请求送主进程——同一轮的续请求固定用轮开始时的端点凭据。
          // 溢出自救（R17）：端点报「上下文超长」→ 预算减半（确定性裁剪）重建请求体重试一次；
          // 重试不再依赖另一次成功的模型请求，仍失败则如实走错误路径（不无限重试）
          var result = null;
          var overflowRetried = false;
          var maxTokensRetried = false;
          while (true) {
            if (run.cancelRequested) { result = { aborted: true }; break; }
            try {
              result = await chat({ sessionId: run.id, turnId: run.core.turnId || '', body: body });
              break;
            } catch (error) {
              var errorText = String(error && error.message || error);
              if (!overflowRetried && Context && Context.isContextOverflowError(errorText)) {
                overflowRetried = true;
                run.forceContextTokens = Context.emergencyBudget(run.appliedContextTokens);
                run.core.messages.push({
                  role: 'error',
                  content: '上下文超出模型限制，已裁剪最旧历史并重试一次；若仍失败，请在设置里调小「模型上下文（tokens）」。',
                  turnId: run.core.turnId || ''
                });
                await checkpoint(run);
                body = buildBody(run);
                continue;
              }
              // 输出上限自救：端点 400 明示 max_tokens 上限（各模型不同，应用不猜）时，
              // 按报文里的上限降额重建请求体重试一次；只在报文给出的上限低于当前下发值时
              // 重试，重试仍失败则如实走错误路径（不无限重试）
              var maxTokensLimit = Context && !maxTokensRetried ? Context.maxOutputTokensLimit(errorText) : 0;
              if (maxTokensLimit > 0 && maxTokensLimit < (Number(body.max_tokens) || Infinity)) {
                maxTokensRetried = true;
                run.forceMaxOutputTokens = maxTokensLimit;
                run.core.messages.push({
                  role: 'error',
                  content: '单次回复上限超过该模型的最大值（' + maxTokensLimit + ' tokens），已按上限调低并重试一次；若仍失败，请在设置里调小「最大输出（tokens）」。',
                  turnId: run.core.turnId || ''
                });
                await checkpoint(run);
                body = buildBody(run);
                continue;
              }
              throw error;
            }
          }
          // 模型已返回：其输出即将落账为正式消息，流式缓冲使命结束——
          // 立刻清空（而非等到 finally），避免「正式回答 + 同段缓冲」在同一份 doc 里并存；
          // 工具卡一并交还给正式消息（decorateToolCalls 标 running，UI 照常显示执行中）
          run.streamText = '';
          run.streamReasoning = '';
          run.streamToolName = '';
          if (run.cancelRequested || (result && result.aborted)) {
            // 用户停止：保留已生成的半截内容（若有），保证 tool_calls/tool 配对不被破坏
            if (result && result.message && (result.message.content || result.message.reasoning_content || (result.message.tool_calls || []).length)) {
              Core.appendAssistant(run.core, result.message, result.usage);
              // 停止路径同样用安全解析：坏参数调用（流式截断）不抛异常，占位结果照补
              var stopParsed = Core.safePendingToolCalls(run.core);
              Core.appendToolResults(run.core, stopParsed.calls.concat(stopParsed.invalid).map(function (call) { return { callId: call.callId, name: call.name, result: '（已停止，未执行）', error: true }; }));
            }
            run.endReason = 'stopped';
            break;
          }
          if (result && result.partial) {
            // A05：截断 / 空闲超时 / 流中断——部分内容保留 + 错误卡（手动重试，不自动重发）
            Core.appendAssistant(run.core, result.message, result.usage);
            run.core.messages.push({
              role: 'error',
              content: result.errorText || '回复可能被截断',
              turnId: run.core.turnId || '',
              retry: true
            });
            var partialCalls = (result.message.tool_calls || []).map(function (call) { return { callId: call.id, name: call.function.name }; });
            Core.appendToolResults(run.core, partialCalls.map(function (call) { return { callId: call.callId, name: call.name, result: '回复中断，工具未执行；请继续核对。', error: true }; }));
            run.doc.requestResume = { turnId: run.core.turnId, partial: true };
            run.endReason = 'failed';
            break;
          }
          Core.appendAssistant(run.core, result.message, result.usage);
          // 用量回喂（R17）：端点回报的 prompt_tokens 是「下一次请求规模」最可信的地板值，
          // 压缩触发的估算偏差靠它纠正（估算值只会在没有真实值时兜底）
          var reportedIn = result && result.usage && Number(result.usage.prompt_tokens);
          if (isFinite(reportedIn) && reportedIn > 0) Core.recordInputUsage(run.core, result.usage, body);
          // 坏参数（流式截断产出非法 JSON）不执行残缺调用：以错误工具结果回喂，
          // 模型看到后重新发起完整调用——不让整轮失败（用户重试整轮重计费）
          var parsed = Core.safePendingToolCalls(run.core);
          if (parsed.calls.length + parsed.invalid.length) {
            var byId = {};
            parsed.calls.forEach(function (call) { byId[call.callId] = call; });
            parsed.invalid.forEach(function (call) { byId[call.callId] = call; });
            Core.decorateToolCalls(run.core, ((result.message && result.message.tool_calls) || []).map(function (call) {
              var item = byId[call && call.id] || {};
              return item.args != null
                ? { callId: item.callId, name: item.name, args: item.args }
                : { callId: call && call.id, name: item.name || (call && call.function && call.function.name), args: {}, status: 'error', result: '参数不是合法 JSON，未执行' };
            }));
          }
          if (parsed.invalid.length) {
            Core.appendToolResults(run.core, parsed.invalid.map(function (call) {
              return {
                callId: call.callId, name: call.name, error: true,
                result: '工具调用参数不是合法 JSON（可能被流式输出截断），本次未执行。请重新发起该调用并给出完整参数，不要沿用原参数。'
              };
            }));
            await checkpoint(run);
          }
          var pending = parsed.calls;
          if (!pending.length) {
            if (parsed.invalid.length) continue; // 本批全部坏参数：模型看完错误结果后重新发起
            if ((run.doc.queuedInputs || []).length) continue;
            run.endReason = 'done'; break;
          }
          // 【关键事件点】执行工具之前先把 assistant 消息落盘：
          // 用户随时可能退出/崩溃，此刻不写就会连同已生成的回复一起丢
          // （Cline/Roo 源码注释里点名的同一条纪律）。R04：await 到磁盘提交
          await checkpoint(run);
          // 工具执行阶段（A03：每个工具前检查取消）
          run.phase = 'tools';
          var results = [];
          var imageMessages = [];

          var startedCallIds = new Set();
          await Dispatch.dispatchBatch(pending, {
            maxConcurrency: 3,
            canParallel: function (call) { return typeof opts.canParallel === 'function' && opts.canParallel(call, run); },
            isCancelled: function () { return run.cancelRequested || run.persistenceFailed; },
            cancelActive: function () { if (opts.cancelTools) return opts.cancelTools(run.id, run.core.turnId); },
            execute: async function (call) {
              startedCallIds.add(call.callId);
              if (call.name === 'summarize_paper') run.core.maxSteps = Math.max(run.core.maxSteps, 48);
              var out = await executeTool(call.name, call.args, run), record = { callId: call.callId, name: call.name };
              if (out && typeof out === 'object' && !Array.isArray(out) && (out.text != null || Array.isArray(out.images))) {
                record.result = out.text; record.images = out.images || [];
              } else record.result = out;
              return record;
            },
            commit: async function (record, index) {
              results[index] = record;
              Core.appendToolResults(run.core, [record]);
              if (record.images && record.images.length) {
                var imageMessage = appendSyntheticImages(run, record.images);
                if (imageMessage) {
                  imageMessages.push(run.core.messages.pop());
                  run.core.messages[run.core.messages.length - 1].pendingImages = imageMessages[imageMessages.length - 1];
                }
              }
              await checkpoint(run);
            }
          });
          for (var j = 0; j < pending.length; j++) {
            if (!results[j]) {
              Core.appendToolResults(run.core, [{ callId: pending[j].callId, name: pending[j].name, result: '（已停止，未执行）', error: true }]);
            }
          }
          // R11：工具渲染的页面截图以合成 user 消息注入本轮（vision 模型下一请求可见）
          run.core.messages.forEach(function (msg) { if (msg.pendingImages) delete msg.pendingImages; });
          imageMessages.forEach(function (msg) { run.core.messages.push(msg); });
          // 【关键事件点】工具结果落盘（含截断后的内容；截断在工具层完成，
          // 存储层不二次截断——Cline/Roo 同策略）；await 到磁盘提交（R04）
          await checkpoint(run);
          if (run.cancelRequested) { run.endReason = 'stopped'; break; }
          var verdict = Core.shouldContinue(run.core);
          if (!verdict.continue) {
            run.endReason = verdict.reason === 'done' ? 'done' : verdict.reason;
            break;
          }
          // 步数将尽的收尾提示（opencode MAX_STEPS_PROMPT 模式）：还有最后一步时注入
          // 系统提示，让模型停止发起新工具、基于已有信息给出回答——比到顶硬停
          // （工具链拦腰截断 + 错误卡）体面得多；模型若仍发起工具，硬顶照常兜底。
          if (!run.stepNoticeGiven && run.core.steps >= run.core.maxSteps - 1) {
            run.stepNoticeGiven = true;
            run.core.messages.push({
              role: 'user',
              content: '[系统提示] 本轮工具步数即将用尽（这是最后一步）：请不要再发起新的工具调用，立即基于已获得的信息完成最终回答或给出阶段性总结；未完成的部分在回答中说明，用户可继续提问接力。',
              synthetic: true,
              kind: 'step_notice',
              turnId: run.core.turnId || '',
              ts: new Date().toISOString()
            });
            await checkpoint(run);
          }
        }
      } catch (error) {
        run.endReason = 'failed';
        run.doc.requestResume = { turnId: run.core.turnId, partial: false };
        var completedIds = new Set(run.core.messages.filter(function (msg) { return msg.role === 'tool'; }).map(function (msg) { return msg.tool_call_id; }));
        var unpaired = (pending || []).filter(function (call) { return !completedIds.has(call.callId); });
        Core.appendToolResults(run.core, unpaired.map(function (call) {
          return { callId: call.callId, name: call.name, result: startedCallIds && startedCallIds.has(call.callId) ? '执行结果未保存，先核对现有数据；不要自动重复写入。' : '检查点保存失败或请求中断，工具未执行。', error: true };
        }));
        var savedImages = [];
        run.core.messages.forEach(function (msg) { if (msg.pendingImages) { savedImages.push(msg.pendingImages); delete msg.pendingImages; } });
        savedImages.forEach(function (msg) { run.core.messages.push(msg); });
        run.core.messages.push({
          role: 'error',
          content: '请求失败：' + String(error && error.message || error),
          turnId: run.core.turnId || '',
          retry: true
        });
      } finally {
        if (run.endReason === 'done') delete run.doc.requestResume;
        run.core.maxSteps = normalMaxSteps;
        run.streaming = false;
        run.doc.streaming = false;
        run.core.endReason = run.endReason;
        if (run.endReason === 'max_steps') {
          run.core.messages.push({ role: 'error', content: '已达到单轮最大步数限制，已停止；可继续提问让它接着做。', turnId: run.core.turnId || '' });
        } else if (run.endReason === 'stuck') {
          run.core.messages.push({ role: 'error', content: '检测到重复的工具调用（可能卡住了），已停止。', turnId: run.core.turnId || '' });
        }
        run.doc.streamText = '';
        run.doc.streamReasoning = '';
        // 轮收尾也是事件点：终态（endReason / 运行标记清除）必须先落盘再报 run_end（R04）
        try { await checkpoint(run); } catch (saveError) {
          run.endReason = 'failed';
          run.core.endReason = 'failed';
          run.core.messages.push({ role: 'error', content: String(saveError.message || saveError), turnId: run.core.turnId || '', retry: true });
        }
        emit(run.id, { type: 'run_end', endReason: run.endReason });
      }
      return run.endReason;
    }

    function retryTurn(run, turnId) {
      var resume = run.doc.requestResume;
      if (run.streaming) return Promise.resolve('busy');
      if (!resume || resume.turnId !== turnId || run.core.turnId !== turnId) return rerunTurn(run, turnId);
      run.core.messages = run.core.messages.filter(function (msg) { return !(msg.role === 'error' && msg.turnId === turnId); });
      if (resume.partial) run.core.messages.push({ role: 'user', content: '[上一回复中断，请从已保存的内容继续。已完成的工具结果仍有效，不要重复执行收藏、下载或写入。]', synthetic: true, kind: 'continuation', turnId: turnId });
      delete run.doc.requestResume;
      return runTurn(run);
    }

    /** 按轮重试 / 重新生成 / 编辑重发：定位 user 消息 → 截断 → 以新文本重跑（A13）。
     * turnId 定位出错轮次；newText 传入即为「编辑重发」。
     * R02：截断前把被移除的历史存进 doc.editHistory（留在会话文件里可恢复，不进模型上下文），
     * 编辑定位错误最坏也只是「历史藏起来了」，不会再造成不可逆丢失。 */
    function rerunTurn(run, turnId, newText) {
      if (run.streaming) return Promise.resolve('busy');
      if (!turnId) return Promise.resolve('not_found');
      var messages = run.core.messages;
      var idx = -1;
      // A-followup #1：只认「真实用户消息」——上下文摘要与工具注入的截图都是 synthetic
      // user 消息，若被当成轮次入口，重跑的内容就不是用户的问题
      for (var i = 0; i < messages.length; i++) {
        var candidate = messages[i];
        if (candidate.role === 'user' && candidate.synthetic !== true && candidate.turnId === turnId) { idx = i; break; }
      }
      if (idx < 0) return Promise.resolve('not_found');
      var original = messages[idx];
      var input = newText != null
        ? String(newText)
        : { text: String(original.content || ''), images: original.images };
      stashEditHistory(run, turnId, messages.slice(idx));
      run.doc.queuedInputs = [];
      delete run.doc.requestResume;
      // 修回复核：若目标轮已经被压缩，截断会同时移除位于它后面的摘要，而目标之前的
      // 原始消息仍带 compacted 标记，最终请求只剩当前问题。恢复目标之前的原始历史，
      // 并继续屏蔽旧摘要，避免「原文 + 摘要」重复进入模型上下文。
      if (original.compacted === true) {
        for (var r = 0; r < idx; r++) {
          if (messages[r] && messages[r].kind === 'compaction') messages[r].compacted = true;
          else if (messages[r]) delete messages[r].compacted;
        }
      }
      run.core.inputUsageBaseline = null;
      run.core.lastInputTokens = 0;
      messages.length = idx; // 截掉该轮与其后所有内容（含历史错误卡）
      Core.appendUser(run.core, input);
      // R03：重试/编辑沿用原轮冻结上下文（模型/思考档/文献/选区）——重启后重试 PDF
      // 选区问题仍带原附件与页码；turnMeta 按新 turnId 重新登记，frozen 即时生效
      var savedMeta = run.doc && run.doc.turnMeta ? run.doc.turnMeta[turnId] : null;
      if (savedMeta) {
        run.doc.turnMeta = run.doc.turnMeta || {};
        run.doc.turnMeta[run.core.turnId] = savedMeta;
      }
      run.frozen = savedMeta || null;
      // persist 可能不返回 Promise（简版 mock），统一包一层再链 runTurn
      return Promise.resolve(persist(run)).then(function () { return runTurn(run); });
    }

    /** 被截断历史的可恢复副本（按 turnId 存最近 20 份；toolCalls 展示元数据不入档减重） */
    function stashEditHistory(run, turnId, removed) {
      if (!removed || !removed.length) return;
      var doc = run.doc;
      if (!doc || typeof doc !== 'object') return;
      if (!doc.editHistory || typeof doc.editHistory !== 'object') doc.editHistory = {};
      try {
        doc.editHistory[turnId] = {
          savedAt: new Date().toISOString(),
          messages: JSON.parse(JSON.stringify(removed)).map(function (msg) {
            delete msg.toolCalls;
            return msg;
          })
        };
      } catch (error) { return; /* 不可序列化就不存副本，截断照常进行 */ }
      var keys = Object.keys(doc.editHistory);
      if (keys.length > 20) keys.slice(0, keys.length - 20).forEach(function (key) { delete doc.editHistory[key]; });
    }

    /** R11：工具渲染的页面截图以合成 user 消息注入本轮——OpenAI 兼容端点的图像只能
     *  进 user 消息，工具结果本身是纯文本。合成消息带 synthetic 标记：UI 可区分展示、
     *  buildRequestBody 的尾部轮策略只在当前轮真正发出图像（后续轮退回文本，控 token）。 */
    function appendSyntheticImages(run, images) {
      var refs = Core.normalizeImageRefs(images);
      if (!refs.length) return;
      var labels = refs.map(function (img) { return img.label || img.ref; }).join('、');
      run.core.messages.push({
        role: 'user',
        content: '[已附加页面截图：' + labels + '（由工具渲染，供视觉理解）]',
        images: refs,
        synthetic: true,
        turnId: run.core.turnId || '',
        ts: new Date().toISOString()
      });
      return run.core.messages[run.core.messages.length - 1];
    }

    /** 最近一轮重试（错误卡「重试」按钮的缺省行为） */
    function retryLast(run) {
      var messages = run.core.messages;
      var turnId = '';
      // 同样只看真实用户消息：轮末注入的截图/摘要是合成 user 消息
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && messages[i].synthetic !== true) { turnId = messages[i].turnId; break; }
      }
      return turnId ? retryTurn(run, turnId) : Promise.resolve('not_found');
    }

    /** R08：等待某会话当前轮收尾（先 cancel 后用）；超时返回 false——调用方如实决定是否继续。
     *  只等「已经发出」的这一轮；确认框挂着但模型未返回时 streaming 仍为真，同样等得住。 */
    function waitIdle(runId, timeoutMs) {
      var run = runners.get(String(runId || ''));
      if (!run || !run.streaming) return Promise.resolve(true);
      return Promise.race([
        Promise.resolve(run._turnPromise).then(function () { return true; }),
        new Promise(function (resolve) {
          var timer = setTimeout(function () { resolve(false); }, Number(timeoutMs) || 3000);
          if (timer.unref) timer.unref();
        })
      ]);
    }

    return {
      register: register,
      runTurn: runTurn,
      cancel: cancel,
      isStreaming: isStreaming,
      waitIdle: waitIdle,
      handleStreamEvent: handleStreamEvent,
      restoreInterrupted: restoreInterrupted,
      rerunTurn: rerunTurn,
      retryTurn: retryTurn,
      enqueue: enqueue,
      clearQueue: clearQueue,
      flushQueue: drainQueue,
      retryLast: retryLast
    };
  }

  return { createRunner: createRunner };
});
