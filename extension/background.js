/* LitBoard 保存助手 — Service Worker：右键菜单 + 保存中继 */
'use strict';

const DEFAULT_PORT = 24117;

async function getConfig() {
  const cfg = await chrome.storage.sync.get(['port', 'token']);
  return { port: cfg.port || DEFAULT_PORT, token: cfg.token || '' };
}

async function saveToLitboard(meta) {
  const { port, token } = await getConfig();
  const response = await fetch(`http://127.0.0.1:${port}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': token },
    body: JSON.stringify(meta)
  });
  return response.json();
}

async function getFolders() {
  const { port, token } = await getConfig();
  const response = await fetch(`http://127.0.0.1:${port}/folders`, {
    method: 'GET',
    headers: { 'X-LitBoard-Token': token }
  });
  return response.json();
}

async function attachPdf(base64, paperId, fileName) {
  const { port, token } = await getConfig();
  const response = await fetch(`http://127.0.0.1:${port}/attach-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LitBoard-Token': token },
    body: JSON.stringify({ paperId: paperId, pdfBase64: base64, fileName: fileName })
  });
  return response.json();
}

async function extractFromTab(tabId) {
  // 阶段五：专用 translators 先注入（纯静态、随版本发布，MV3 合规）
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['js/translators.js'] });
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
  return chrome.tabs.sendMessage(tabId, { type: 'litboard-extract' });
}

async function downloadPdfWithCookies(tabId, pdfUrl) {
  // 页面上下文 fetch（携带知网登录 cookie）→ base64
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: async function (url) {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
        const blob = await resp.blob();
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const head = String.fromCharCode.apply(null, bytes.subarray(0, 5));
        if (head.indexOf('%PDF-') !== 0) return { ok: false, error: blob && blob.size ? '服务器返回的不是 PDF' : '空文件' };
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return { ok: true, base64: btoa(binary), fileName: url.split('/').pop().split('?')[0] };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    },
    args: [pdfUrl]
  }).then(function (results) {
    return results && results[0] && results[0].result ? results[0].result : { ok: false, error: '注入失败' };
  }, function () {
    return { ok: false, error: '无法注入页面' };
  });
}

async function badge(tabId, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: color || '#4a90d9' });
    await chrome.action.setBadgeText({ tabId: tabId, text: text });
    setTimeout(function () { chrome.action.setBadgeText({ tabId: tabId, text: '' }).catch(function () {}); }, 4000);
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'litboard-save',
    title: '保存到 LitBoard',
    contexts: ['page', 'link']
  });
});

chrome.contextMenus.onClicked.addListener(async function (info, tab) {
  if (info.menuItemId !== 'litboard-save' || !tab || !tab.id) return;
  try {
    const meta = await extractFromTab(tab.id);
    if (info.linkUrl && !meta.pdfUrl && /\.pdf(\?|$)/i.test(info.linkUrl)) meta.pdfUrl = info.linkUrl;
    if (info.linkUrl && !meta.url) meta.url = info.linkUrl;
    const foldersResp = await getFolders().catch(function () { return { currentFolderId: '' }; });
    meta.folderId = foldersResp && foldersResp.currentFolderId || '';
    const result = await saveAndMaybePdf(tab.id, meta);
    badge(tab.id, result.ok ? '✓' : '!', result.ok ? '#2f8f4e' : '#c25050');
  } catch (error) {
    badge(tab.id, '!', '#c25050');
  }
});

async function saveAndMaybePdf(tabId, meta) {
  const result = await saveToLitboard(meta);
  if (!result.ok || result.pdfAttached) return result;
  // 知网 PDF（需登录 cookie）或页面给出的直链下载失败时，尝试浏览器会话下载
  if (meta.source === 'CNKI' && meta.pdfUrl && result.id) {
    const dl = await downloadPdfWithCookies(tabId, meta.pdfUrl);
    if (dl.ok) {
      const attached = await attachPdf(dl.base64, result.id, dl.fileName || '');
      result.pdfAttached = !!(attached && attached.attached);
    }
  }
  return result;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return;
  if (message.type === 'litboard-save') {
    saveAndMaybePdf(message.tabId, message.meta).then(sendResponse, function (error) {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });
    return true;
  }
  if (message.type === 'litboard-get-folders') {
    getFolders().then(sendResponse, function (error) {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });
    return true;
  }
  if (message.type === 'litboard-download-cnki-pdf') {
    // 知网 PDF：浏览器会话下载（登录态）→ 上传桌面端挂附件
    downloadPdfWithCookies(message.tabId, message.pdfUrl).then(async function (result) {
      if (!result.ok) { sendResponse(result); return; }
      const attached = await attachPdf(result.base64, message.paperId, result.fileName || message.fileName || '');
      sendResponse({ ok: attached.ok, pdfAttached: !!attached.attached, error: attached.error || '' });
    }, function (error) {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    });
    return true;
  }
});
