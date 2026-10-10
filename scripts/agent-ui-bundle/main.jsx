/**
 * LitBoard AI 助手对话层（assistant-ui）打包入口。
 *
 * 本文件是「一次性外置构建」的源码：node_modules 永不进仓库，构建产物
 * vendor/assistant-ui/agent-chat.js 为自包含 IIFE，挂 window.LitAgentChat。
 * 复现构建：见同目录 build.js 与 README.md。
 *
 * 桥接契约（mount 时由 js/agentui.js 注入 bridge）：
 * - getSnapshot(): { messages: ThreadMessageLike[], isRunning: boolean, empty: boolean,
 *                    showSuggestions: boolean, queueEnabled: boolean }
 * - subscribe(cb): 订阅快照更新，返回退订函数
 * - onNew({text}) / onEdit({turnId, text}) / onReload({turnId}) / onCancel()
 * - sendSuggestion(text): 空态建议点击直接发送
 * - queueMessage(text) / clearQueue(): 生成中在**同一输入框**排队补充要求
 *   （运行中的上箭头按钮与 Enter 都走这里；queueEnabled=false 时不显示排队按钮、不接受排队）
 * - retry(turnId): 错误卡重试
 * - onFork({messageId}): 从指定消息创建独立会话
 * - composerSlotReady(el): 输入行宿主插槽挂载完成，宿主把模型/推理等控件移入 el
 * - composerSlotPark(el): 插槽即将随组件卸载销毁，宿主把控件移回预备行（否则被连带销毁）
 * - T(s): i18n；openPaper(id): 来源卡跳转
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  useMessage,
  useComposerRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive
} from '@assistant-ui/react';

function makeT(bridge) {
  return function T(s) {
    if (bridge && typeof bridge.T === 'function') return bridge.T(s);
    return (typeof window !== 'undefined' && window.LitI18n && window.LitI18n.t) ? window.LitI18n.t(s) : s;
  };
}

/** 正文 Markdown 渲染：复用宿主的 LitMarkdown（先转义后回填，安全）。
 * 注意：Part 组件的 props 是「展开的 part 字段」（{type,text,status,...}），不是 {part}。 */
function MarkdownText(props) {
  const html = (typeof window !== 'undefined' && window.LitMarkdown && window.LitMarkdown.render)
    ? window.LitMarkdown.render(String(props.text || ''))
    : String(props.text || '');
  return <div className="aui-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 思考过程（reasoning part）：默认折叠，可展开查看 */
function ReasoningBlock(props) {
  const bridge = bridgeRef;
  const T = makeT(bridge);
  const [open, setOpen] = useState(false);
  const text = String(props.text || '');
  if (!text) return null;
  return (
    <details className={'aui-reasoning' + (open ? ' open' : '')} open={open}>
      <summary onClick={(e) => { e.preventDefault(); setOpen(!open); }}>{T('思考过程')}</summary>
      <div className="aui-reasoning-body">{text}</div>
    </details>
  );
}

/** 工具调用卡：参数摘要 + 可展开的参数/结果详情（A16） */
function ToolCard(props) {
  const [open, setOpen] = useState(false);
  const name = String(props.toolName || '');
  let argsText = '';
  try { argsText = JSON.stringify(props.args || {}); } catch (e) { argsText = '{}'; }
  const hasResult = props.result != null;
  const isError = props.isError === true;
  let resultText = '';
  if (hasResult) {
    resultText = typeof props.result === 'string' ? props.result : JSON.stringify(props.result);
  }
  const status = !hasResult ? 'running' : (isError ? 'error' : 'ok');
  return (
    <div className={'aui-tool open-' + open + ' status-' + status}>
      <div className="aui-tool-head" onClick={() => setOpen(!open)}>
        <span className={'aui-tool-dot status-' + status} />
        <span className="aui-tool-name">{name}</span>
        <span className="aui-tool-args">{argsText.slice(0, 80)}</span>
        <span className="aui-tool-toggle">{open ? '▾' : '▸'}</span>
      </div>
      {open ? (
        <div className="aui-tool-body">
          <pre>{'参数：' + argsText + '\n\n结果：' + (hasResult ? resultText : '（执行中）')}</pre>
        </div>
      ) : null}
    </div>
  );
}

/** 宿主桥的模块级引用：保证 Messages 组件映射的组件身份稳定（React 增量渲染的前提） */
let bridgeRef = null;

function ForkAction({ message }) {
  const bridge = bridgeRef;
  const T = makeT(bridge);
  const custom = (message.metadata && message.metadata.custom) || {};
  if (!bridge.onFork || !Number.isInteger(custom.forkIndex)) return null;
  return <button className="aui-act aui-fork" title={T('保留此前对话，在新会话中继续')} onClick={() => bridge.onFork({ messageId: message.id })}>{T('从此处分叉')}</button>;
}

/** 消息组件：无 props 渲染，通过 useMessage() 取消息（assistant-ui 0.11 契约）。
 *  外层容器直接用 MessagePrimitive.Root：autohide 操作栏的悬停态由 Root 元素上的
 *  mouseenter/mouseleave 跟踪，操作栏必须在 Root 内部——否则鼠标从气泡移向按钮的
 *  途中 hover 已解除、按钮被卸载，永远点不到。 */
function UserMessage() {
  const bridge = bridgeRef;
  const message = useMessage();
  const turnId = message.metadata && message.metadata.custom && message.metadata.custom.turnId;
  // 合成消息（工具注入的截图/上下文摘要等）不是用户的发言：不给「编辑重发」入口
  const synthetic = !!(message.metadata && message.metadata.custom && message.metadata.custom.synthetic);
  return (
    <MessagePrimitive.Root className="aui-msg user">
      <div className="aui-bubble">
        <MessagePrimitive.Parts />
      </div>
      <div className="aui-actions">
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <ActionBarPrimitive.Copy className="aui-act">{makeT(bridge)('复制')}</ActionBarPrimitive.Copy>
          {!synthetic && <ActionBarPrimitive.Edit className="aui-act">{makeT(bridge)('编辑')}</ActionBarPrimitive.Edit>}
          <ForkAction message={message} />
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

/** H2：用户消息的编辑态（点「编辑」后出现的输入框）。
 *  0.11 契约：ThreadPrimitive.Messages 的 UserEditComposer 挂点；同一 ComposerPrimitive
 *  组件族在编辑槽位内绑定 edit composer 运行时，提交触发外层 runtime.onEdit
 *  （宿主桥 onEdit → rerunTurn 截断重跑）。此前只挂了 ActionBar 的编辑按钮、
 *  没挂编辑组件——按钮点了没有输入框，编辑重发走不通。 */
function UserEditComposer() {
  const bridge = bridgeRef;
  const T = makeT(bridge);
  return (
    <div className="aui-edit-wrap">
      <ComposerPrimitive.Root className="aui-composer">
        <ComposerPrimitive.Input className="aui-input" autoFocus rows={2} placeholder={T('修改后重新发送…')} />
        <div className="aui-composer-row">
          <span className="aui-hint">{T('将截断该消息之后的对话并重跑')}</span>
          <ComposerPrimitive.Cancel className="aui-send">{T('取消')}</ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send className="aui-send primary">{T('保存并重发')}</ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}

function AssistantMessage() {
  const bridge = bridgeRef;
  const T = makeT(bridge);
  const message = useMessage();
  const custom = (message.metadata && message.metadata.custom) || {};
  // 错误卡（A05/A13）：内容 + 按轮重试
  if (custom.lbError) {
    return (
      <div className="aui-msg error">
        <div className="aui-bubble">{custom.lbError.text}</div>
        {custom.lbError.retry ? (
          <div className="aui-actions">
            <button className="aui-act" onClick={() => bridge.retry(custom.lbError.turnId)}>{T('重试')}</button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <MessagePrimitive.Root className="aui-msg assistant">
      <div className="aui-bubble">
        <MessagePrimitive.Parts components={{
          Text: MarkdownText,
          Reasoning: ReasoningBlock,
          tools: { Fallback: ToolCard }
        }} />
      </div>
      <div className="aui-actions">
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <ActionBarPrimitive.Copy className="aui-act">{T('复制')}</ActionBarPrimitive.Copy>
          <ActionBarPrimitive.Reload className="aui-act">{T('重新生成')}</ActionBarPrimitive.Reload>
          <ForkAction message={message} />
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

/** 底部输入区：同一个输入框承担「提问」与「生成中的补充要求排队」——不再另开排队框。
 *  未运行：向上箭头（发送，Enter 提交）；运行中：上箭头变「加入队列」（Enter 也排队，
 *  经 bridge.queueMessage 进队列），旁边保留方块（停止）——输入位置不变、不多个框。
 *  queueEnabled=false（设置关掉排队）时运行中只有停止按钮，输入不排队。
 *  aui-host-slot 是宿主插槽——agentui 挂载后把模型/推理/状态/token 等 plain-DOM 控件
 *  移进来（发送按钮旁），React 不接管槽内节点（槽自身无 React 子节点，重渲染不会清掉
 *  外部插入的 DOM）；已排队的存量以计数条显示并可清空。 */
function ComposerArea({ bridge, isRunning, queuedCount, queueEnabled }) {
  const T = makeT(bridge);
  const [queueBusy, setQueueBusy] = useState(false);
  const label = isRunning ? T('停止') : T('发送');
  const slotRef = React.useRef(null);
  const composerRuntime = useComposerRuntime();
  const canQueue = isRunning && queueEnabled;
  const queueSubmit = async () => {
    if (queueBusy) return;
    const text = String(composerRuntime.getState().text || '').trim();
    if (!text) return;
    setQueueBusy(true);
    try { if (await bridge.queueMessage(text)) await composerRuntime.reset(); }
    finally { setQueueBusy(false); }
  };
  // useLayoutEffect：卸载清理跑在 React 移除插槽 DOM 之前——把控件停回宿主预备行，
  // 否则旧插槽销毁时控件节点被连带销毁，新插槽（重挂载后 composerSlotReady）找不到它们
  React.useLayoutEffect(() => {
    const slot = slotRef.current;
    if (slot && bridge.composerSlotReady) bridge.composerSlotReady(slot);
    return () => { if (slot && bridge.composerSlotPark) bridge.composerSlotPark(slot); };
  }, []);
  const sendIcon = (
    <svg className="aui-ic" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 13.1V3.5M8 3.5 4.3 7.2M8 3.5l3.7 3.7"
        fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
  return (
    <div className="aui-composer-wrap">
      <ComposerPrimitive.Root className="aui-composer">
        <ComposerPrimitive.Input
          className="aui-input" autoFocus rows={1}
          placeholder={canQueue
            ? T('补充要求（Enter 加入队列，当前操作完成后处理）')
            : T('问点什么…（Enter 发送，Shift+Enter 换行）')}
          onKeyDown={canQueue ? (e) => {
            // Input 内部的 Enter 提交在 isRunning 时本就不动作；这里接管为排队提交
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            queueSubmit();
          } : undefined}
        />
        <div className="aui-composer-row">
          <div className="aui-host-slot" ref={slotRef} />
          {canQueue && (
            <button type="button" className="aui-send aui-icon-btn" onClick={queueSubmit} disabled={queueBusy} title={T('加入队列')} aria-label={T('加入队列')}>
              {sendIcon}
            </button>
          )}
          {isRunning ? (
            <ComposerPrimitive.Cancel className="aui-send primary aui-icon-btn" title={label} aria-label={label}>
              <svg className="aui-ic" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.6" fill="currentColor" />
              </svg>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send className="aui-send primary aui-icon-btn" title={label} aria-label={label}>
              {sendIcon}
            </ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.Root>
      {queuedCount > 0 && <div className="aui-queued">
        {T('已排队 {n} 条；停止后保留，下次继续处理').replace('{n}', String(queuedCount))}
        <button type="button" className="aui-act" onClick={() => bridge.clearQueue()}>{T('清空队列')}</button>
      </div>}
    </div>
  );
}

function App({ bridge }) {
  const T = makeT(bridge);
  const [snap, setSnap] = useState(() => bridge.getSnapshot());
  useEffect(() => bridge.subscribe(setSnap), []);
  const showSuggestions = snap.showSuggestions !== false; // 设置 → AI 助手：空态引导建议
  const runtime = useExternalStoreRuntime({
    isRunning: snap.isRunning,
    messages: snap.messages,
    convertMessage: (m) => m,
    onNew: async (appendMessage) => {
      const text = (appendMessage.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      bridge.onNew({ text });
    },
    onEdit: async (appendMessage) => {
      const text = (appendMessage.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      const turnId = appendMessage.parentId && String(appendMessage.parentId).split(':')[0];
      bridge.onEdit({ turnId: turnId || '', text });
    },
    onReload: async (parentId) => {
      const turnId = parentId && String(parentId).split(':')[0];
      bridge.onReload({ turnId: turnId || '' });
    },
    onCancel: async () => bridge.onCancel(),
    unstable_capabilities: { copy: true }
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="aui-root">
        <ThreadPrimitive.Root className="aui-thread">
          <ThreadPrimitive.Viewport autoScroll className="aui-viewport">
            <ThreadPrimitive.Empty>
              <div className="aui-empty">
                <div>{T('开始一段调研对话，或从历史会话继续。')}</div>
                {showSuggestions ? (
                  <div className="aui-suggest">
                    {[
                      T('帮我调研「」主题的近年文献'),
                      T('在我库里找关于「」的文献并总结'),
                      T('哪些论文的全文提到了「」？')
                    ].map((tip) => (
                      <button key={tip} className="aui-act" onClick={() => bridge.sendSuggestion(tip.replace(/「」/g, ''))}>{tip}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{
              UserMessage: UserMessage,
              UserEditComposer: UserEditComposer,
              AssistantMessage: AssistantMessage
            }} />
            <ThreadPrimitive.ScrollToBottom className="aui-jump">{T('↓ 回到底部')}</ThreadPrimitive.ScrollToBottom>
          </ThreadPrimitive.Viewport>
          <ComposerArea key={snap.sessionId} bridge={bridge} isRunning={snap.isRunning} queuedCount={snap.queuedCount} queueEnabled={snap.queueEnabled !== false} />
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}

/** 错误边界：渲染期异常显示为可见文本，绝不让面板黑屏（崩溃也要可诊断） */
class SafeBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="aui-crash">
          <div>对话渲染出错：</div>
          <pre>{String(this.state.error && this.state.error.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 挂载入口：container 为 DOM 节点，bridge 为宿主回调集合 */
export function mount(container, bridge) {
  bridgeRef = bridge;
  const root = createRoot(container);
  root.render(<SafeBoundary><App bridge={bridge} /></SafeBoundary>);
  return function unmount() { root.unmount(); };
}
