/**
 * LitBoard AI 助手对话层（assistant-ui）打包入口。
 *
 * 本文件是「一次性外置构建」的源码：node_modules 永不进仓库，构建产物
 * vendor/assistant-ui/agent-chat.js 为自包含 IIFE，挂 window.LitAgentChat。
 * 复现构建：见同目录 build.js 与 README.md。
 *
 * 桥接契约（mount 时由 js/agentui.js 注入 bridge）：
 * - getSnapshot(): { messages: ThreadMessageLike[], isRunning: boolean, empty: boolean }
 * - subscribe(cb): 订阅快照更新，返回退订函数
 * - onNew({text}) / onEdit({turnId, text}) / onReload({turnId}) / onCancel()
 * - sendSuggestion(text): 空态建议点击直接发送
 * - retry(turnId): 错误卡重试
 * - composerSlotReady(el): 输入行宿主插槽挂载完成，宿主把模型/推理等控件移入 el
 * - T(s): i18n；openPaper(id): 来源卡跳转
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  useMessage,
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

/** 消息组件：无 props 渲染，通过 useMessage() 取消息（assistant-ui 0.11 契约） */
function UserMessage() {
  const bridge = bridgeRef;
  const message = useMessage();
  const turnId = message.metadata && message.metadata.custom && message.metadata.custom.turnId;
  // 合成消息（工具注入的截图/上下文摘要等）不是用户的发言：不给「编辑重发」入口
  const synthetic = !!(message.metadata && message.metadata.custom && message.metadata.custom.synthetic);
  return (
    <div className="aui-msg user">
      <div className="aui-bubble">
        <MessagePrimitive.Root>
          <MessagePrimitive.Parts />
        </MessagePrimitive.Root>
      </div>
      <div className="aui-actions">
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <ActionBarPrimitive.Copy className="aui-act">{makeT(bridge)('复制')}</ActionBarPrimitive.Copy>
          {!synthetic && <ActionBarPrimitive.Edit className="aui-act">{makeT(bridge)('编辑')}</ActionBarPrimitive.Edit>}
        </ActionBarPrimitive.Root>
      </div>
    </div>
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
    <div className="aui-msg assistant">
      <div className="aui-bubble">
        <MessagePrimitive.Root>
          <MessagePrimitive.Parts components={{
            Text: MarkdownText,
            Reasoning: ReasoningBlock,
            tools: { Fallback: ToolCard }
          }} />
        </MessagePrimitive.Root>
      </div>
      <div className="aui-actions">
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <ActionBarPrimitive.Copy className="aui-act">{T('复制')}</ActionBarPrimitive.Copy>
          <ActionBarPrimitive.Reload className="aui-act">{T('重新生成')}</ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
      </div>
    </div>
  );
}

/** 底部输入区：发送与停止合并为**一个**图标按钮，不再出现「发送」文字。
 *  未运行 = 向上箭头（发送），运行中 = 方块（停止）——按钮形态与当前能做的事严格一一对应，
 *  避免两个按钮同时挂在行尾时「哪个能点」要靠猜。（编辑态 composer 仍保留文字按钮。）
 *  行内不再显示「Enter 发送」提示（占位符里已有）；aui-host-slot 是宿主插槽——
 *  agentui 挂载后把模型/推理/状态/token 等 plain-DOM 控件移进来（发送按钮旁），
 *  React 不接管槽内节点（槽自身无 React 子节点，重渲染不会清掉外部插入的 DOM）。 */
function ComposerArea({ bridge, isRunning }) {
  const T = makeT(bridge);
  const label = isRunning ? T('停止') : T('发送');
  const slotRef = React.useRef(null);
  useEffect(() => {
    if (slotRef.current && bridge.composerSlotReady) bridge.composerSlotReady(slotRef.current);
  }, []);
  return (
    <div className="aui-composer-wrap">
      <ComposerPrimitive.Root className="aui-composer">
        <ComposerPrimitive.Input className="aui-input" autoFocus rows={1} placeholder={T('问点什么…（Enter 发送，Shift+Enter 换行）')} />
        <div className="aui-composer-row">
          <div className="aui-host-slot" ref={slotRef} />
          {isRunning ? (
            <ComposerPrimitive.Cancel className="aui-send primary aui-icon-btn" title={label} aria-label={label}>
              <svg className="aui-ic" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.6" fill="currentColor" />
              </svg>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send className="aui-send primary aui-icon-btn" title={label} aria-label={label}>
              <svg className="aui-ic" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 13.1V3.5M8 3.5 4.3 7.2M8 3.5l3.7 3.7"
                  fill="none" stroke="currentColor" strokeWidth="1.7"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}

function App({ bridge }) {
  const T = makeT(bridge);
  const [snap, setSnap] = useState(() => bridge.getSnapshot());
  useEffect(() => bridge.subscribe(setSnap), []);
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
                <div className="aui-suggest">
                  {[
                    T('帮我调研「」主题的近年文献'),
                    T('在我库里找关于「」的文献并总结'),
                    T('哪些论文的全文提到了「」？')
                  ].map((tip) => (
                    <button key={tip} className="aui-act left" onClick={() => bridge.sendSuggestion(tip.replace(/「」/g, ''))}>{tip}</button>
                  ))}
                </div>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{
              UserMessage: UserMessage,
              UserEditComposer: UserEditComposer,
              AssistantMessage: AssistantMessage
            }} />
            <ThreadPrimitive.ScrollToBottom className="aui-jump">{T('↓ 回到底部')}</ThreadPrimitive.ScrollToBottom>
          </ThreadPrimitive.Viewport>
          <ComposerArea bridge={bridge} isRunning={snap.isRunning} />
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
