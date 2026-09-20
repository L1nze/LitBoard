'use strict';

/* agent:* + session:* —— AI 助手运行时：LLM 流式出网与会话存储（自 main.js registerIpc 平移）。
 * agentSessionsRoot 导出给 main.js 启动装配 createSessions 用。 */

const { app, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const ctx = require('./context.js');

module.exports = { register: register, agentSessionsRoot: agentSessionsRoot };

/* AI 会话根目录：设置键 agentSessionRoot（默认 文档\LitBoard）下的 会话记录/ 子树。
 * 会话是用户长期成果——不落配置目录（不随数据目录迁移），用户可自选任意位置。
 * 注意：createSessions 在启动时以此定根；改设置需重启生效（既有语义保持）。 */
function agentSessionsRoot() {
  let root = '';
  try { root = String(ctx.libraryDb && ctx.libraryDb.getSetting('agentSessionRoot') || '').trim(); } catch (error) {}
  if (!root || !path.isAbsolute(root)) root = path.join(app.getPath('documents'), 'LitBoard');
  return path.join(root, '会话记录');
}

/* M9-5 多模态消息链：渲染层消息里的图像以**引用**形态传递（{type:'image', ref}），
 * 出网前在主进程解析成 OpenAI image_url data URL——渲染层不接触文件字节，会话 JSON
 * 只存引用不存 base64。ref 形态：session:<会话ID>|<附件相对路径>（会话附件）；
 * config:<configDir 下相对路径>（note-assets 等受管目录，拒绝越界）。解析失败丢弃该图，
 * 不打断请求。 */
const IMAGE_MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function resolveImageRef(ref) {
  const raw = String(ref || '');
  let file = null;
  try {
    if (raw.indexOf('session:') === 0 && ctx.agentSessions) {
      const rest = raw.slice('session:'.length);
      const split = rest.indexOf('|');
      if (split > 0) file = await ctx.agentSessions.attachmentPath(rest.slice(0, split), rest.slice(split + 1));
    } else if (raw.indexOf('config:') === 0) {
      const rel = path.normalize(decodeURIComponent(raw.slice('config:'.length)));
      const abs = path.resolve(ctx.dataPathState.configDir, rel);
      const root = path.resolve(ctx.dataPathState.configDir);
      if (abs !== root && abs.indexOf(root + path.sep) === 0) file = abs;
    }
  } catch (error) { return null; }
  if (!file) return null;
  const mime = IMAGE_MIME_BY_EXT[path.extname(file).toLowerCase()];
  if (!mime) return null;
  try {
    const bytes = await fs.readFile(file);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
    return { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + bytes.toString('base64') } };
  } catch (error) { return null; }
}

async function resolveBodyImages(body) {
  for (const message of (body && body.messages) || []) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    const parts = [];
    for (const part of message.content) {
      if (part && part.type === 'text') parts.push({ type: 'text', text: String(part.text || '') });
      else if (part && part.type === 'image' && part.ref) {
        const resolved = await resolveImageRef(part.ref);
        if (resolved) parts.push(resolved);
      }
    }
    message.content = parts.length ? parts : partsFallbackText(message.content);
  }
}

function partsFallbackText(parts) {
  return (Array.isArray(parts) ? parts : []).map(function (part) {
    return part && typeof part.text === 'string' ? part.text : '';
  }).join('');
}

function register() {
  ctx.handle('agent:chat', async function (_event, input) {
    if (!ctx.agentNet) throw new Error(ctx.T('AI 助手未就绪'));
    await resolveBodyImages(input && input.body);
    return ctx.agentNet.chatStream(input);
  });
  ctx.handle('agent:cancel', function (_event, sessionId) {
    return ctx.agentNet ? ctx.agentNet.cancel(sessionId) : false;
  });
  ctx.handle('agent:test', function (_event, input) {
    if (!ctx.agentNet) throw new Error(ctx.T('AI 助手未就绪'));
    return ctx.agentNet.testConnection(input || {});
  });
  ctx.handle('agent:list-models', function (_event, input) {
    if (!ctx.agentNet) throw new Error(ctx.T('AI 助手未就绪'));
    return ctx.agentNet.listModels(input || {});
  });

  ctx.handle('session:create', function (_event, input) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.create(input || {});
  });
  ctx.handle('session:list', function () {
    return ctx.agentSessions ? ctx.agentSessions.list() : [];
  });
  ctx.handle('session:read', function (_event, id) {
    return ctx.agentSessions ? ctx.agentSessions.read(id) : null;
  });
  ctx.handle('session:set-data', function (_event, payload) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.setData(payload && payload.id, payload && payload.data);
  });
  /* R04 关键事件落盘：立即写盘并等待完成；回传主进程登记的附件集合（R05 同步用） */
  ctx.handle('session:commit', function (_event, payload) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.commit(payload && payload.id, payload && payload.data);
  });
  /* R05：打开会话附件（主进程解析受控路径，渲染层不接触绝对路径） */
  ctx.handle('session:open-attachment', async function (_event, payload) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    const abs = await ctx.agentSessions.attachmentPath(payload && payload.id, payload && payload.file);
    await shell.openPath(abs);
    return { ok: true, path: abs };
  });
  ctx.handle('session:rename', function (_event, payload) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.rename(payload && payload.id, payload && payload.title);
  });
  ctx.handle('session:delete', function (_event, id) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.remove(id);
  });
  ctx.handle('session:delete-many', function (_event, ids) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.removeMany(ids);
  });
  ctx.handle('session:export-md', function (_event, id) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.exportMarkdown(id);
  });
  ctx.handle('session:save-attachment', function (_event, payload) {
    if (!ctx.agentSessions) throw new Error(ctx.T('会话存储未就绪'));
    return ctx.agentSessions.saveAttachment(payload && payload.id, payload || {});
  });
  ctx.handle('session:open-root', async function () {
    const root = agentSessionsRoot();
    await fs.mkdir(root, { recursive: true });
    await shell.openPath(root);
    return { ok: true, root: root };
  });
  ctx.handle('session:root', function () { return agentSessionsRoot(); });
}
