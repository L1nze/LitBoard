/* LitBoard 保存助手 — Popup：打开即提取，点击插件即自动保存（保存位置与标签可选） */
'use strict';

let currentTabId = null;
let currentMeta = null;
let lastSavedId = null;
let savePromise = null;
let folderItems = [];          // /folders 返回的扁平树
let selectedFolderId = '';
let batchItems = [];           // 列表页收集到的 DOI 条目

function $(id) { return document.getElementById(id); }

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.style.color = isError ? '#c25050' : '#666';
}

function userTags() {
  return $('tags-input').value.split(/[,，;；]/).map(function (t) { return t.trim(); }).filter(Boolean);
}

// ---------- 文件夹下拉（自绘，Zotero 式） ----------
function folderDisplayName(folder) {
  return '　'.repeat(Math.min(folder.depth || 0, 10)) + folder.name;
}

function currentFolderLabel() {
  if (!selectedFolderId) return '未分类（不放入文件夹）';
  const folder = folderItems.find(function (f) { return f.id === selectedFolderId; });
  return folder ? folder.name : '未分类（不放入文件夹）';
}

function refreshFolderToggle() {
  $('folder-current-name').textContent = currentFolderLabel();
  $('folder-current-ico').className = 'folder-ico ' + (selectedFolderId ? 'folder-ico-folder' : 'folder-ico-unfiled');
}

function closeFolderMenu() {
  $('folder-menu').hidden = true;
  $('folder-toggle').setAttribute('aria-expanded', 'false');
}

function selectFolder(id) {
  selectedFolderId = id || '';
  refreshFolderToggle();
  closeFolderMenu();
  // 已保存过一次：重新保存到新选的文件夹（桌面端去重后会并入新文件夹）
  if (lastSavedId) doSave();
}

function buildFolderMenu(folders, preferredFolderId) {
  folderItems = folders || [];
  const menu = $('folder-menu');
  menu.innerHTML = '';
  const all = [{ id: '', name: '未分类（不放入文件夹）', depth: 0 }].concat(folderItems);
  all.forEach(function (folder) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.folderId = folder.id;
    const ico = document.createElement('span');
    ico.className = 'folder-ico ' + (folder.id ? 'folder-ico-folder' : 'folder-ico-unfiled');
    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.id ? folderDisplayName(folder) : folder.name;
    name.title = folder.name;
    li.appendChild(ico);
    li.appendChild(name);
    li.addEventListener('click', function () { selectFolder(folder.id); });
    menu.appendChild(li);
  });
  const found = folderItems.some(function (f) { return f.id === preferredFolderId; });
  selectedFolderId = found ? preferredFolderId : '';
  refreshFolderToggle();
  markSelectedFolder();
}

function markSelectedFolder() {
  Array.prototype.forEach.call($('folder-menu').children, function (li) {
    li.classList.toggle('selected', li.dataset.folderId === selectedFolderId);
  });
}

$('folder-toggle').addEventListener('click', function () {
  const menu = $('folder-menu');
  const open = menu.hidden;
  menu.hidden = !open;
  $('folder-toggle').setAttribute('aria-expanded', String(open));
  if (open) markSelectedFolder();
});
document.addEventListener('click', function (e) {
  if (!e.target.closest('.folder-picker')) closeFolderMenu();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeFolderMenu();
});

// ---------- 保存 ----------
async function doSave() {
  if (!currentMeta) return;
  if (!currentMeta.doi && !currentMeta.title) { setStatus('页面缺少标题与 DOI', true); return; }
  // 文件夹列表为空（如桌面端刚从旧版重启）：再取一次
  if (!folderItems.length) {
    try {
      const folders = await chrome.runtime.sendMessage({ type: 'litboard-get-folders' });
      if (folders && folders.ok) buildFolderMenu(folders.folders || [], folders.currentFolderId || selectedFolderId);
    } catch (e) {}
  }
  $('save').disabled = true;
  setStatus('保存中…');
  const meta = Object.assign({}, currentMeta, {
    folderId: selectedFolderId,
    tags: (currentMeta.tags || []).concat(userTags())
  });
  savePromise = chrome.runtime.sendMessage({
    type: 'litboard-save',
    tabId: currentTabId,
    meta: meta
  }).then(function (result) {
    if (result && result.ok) {
      lastSavedId = result.id;
      setStatus((result.duplicated ? '已存在，已并入文件夹“' : '已保存到“')
        + currentFolderLabel() + '”' + (result.pdfAttached ? '，PDF 已附加 ✓' : '（PDF 未能附加：桌面端需可访问该链接）'));
      chrome.action.setBadgeText({ tabId: currentTabId, text: '✓' }).catch(function () {});
      chrome.action.setBadgeBackgroundColor({ tabId: currentTabId, color: '#2f8f4e' }).catch(function () {});
      setTimeout(function () { chrome.action.setBadgeText({ tabId: currentTabId, text: '' }).catch(function () {}); }, 4000);
    } else {
      setStatus('保存失败：' + (result && result.error || '未知错误'), true);
    }
  }).catch(function () {
    setStatus('无法连接 LitBoard 桌面端（请确认应用已启动、端口与令牌正确）', true);
  }).finally(function () {
    $('save').disabled = false;
  });
  return savePromise;
}

$('save').addEventListener('click', doSave);

// ---------- 批量保存（搜索结果/列表页） ----------
function renderBatchList(items) {
  const list = $('batch-list');
  list.innerHTML = '';
  items.forEach(function (item, index) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.index = String(index);
    const text = document.createElement('span');
    const title = document.createElement('div');
    title.textContent = item.title || item.doi;
    const doi = document.createElement('div');
    doi.className = 'batch-doi';
    doi.textContent = item.doi;
    text.appendChild(title);
    if (item.title) text.appendChild(doi);
    label.appendChild(box);
    label.appendChild(text);
    list.appendChild(label);
  });
  $('batch-summary').textContent = '本页检测到 ' + items.length + ' 个条目（含 DOI），可批量保存';
  $('batch-section').hidden = false;
}

$('batch-save').addEventListener('click', async function () {
  const boxes = Array.prototype.slice.call($('batch-list').querySelectorAll('input:checked'));
  if (!boxes.length) { setStatus('先勾选要保存的条目', true); return; }
  $('batch-save').disabled = true;
  let ok = 0, failed = 0;
  const failReasons = {};
  for (let i = 0; i < boxes.length; i++) {
    const item = batchItems[Number(boxes[i].dataset.index)];
    setStatus('批量保存中 ' + (i + 1) + '/' + boxes.length + '…');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'litboard-save',
        tabId: currentTabId,
        meta: { doi: item.doi, title: item.title, url: '', folderId: selectedFolderId, tags: userTags() }
      });
      if (result && result.ok) ok++;
      else {
        failed++;
        const reason = (result && result.error) || '未知错误';
        failReasons[reason] = (failReasons[reason] || 0) + 1;
      }
    } catch (e) { failed++; failReasons['扩展消息失败'] = (failReasons['扩展消息失败'] || 0) + 1; }
  }
  $('batch-save').disabled = false;
  let failDetail = Object.keys(failReasons).map(function (r) { return r + '×' + failReasons[r]; }).join('；');
  if (failDetail.length > 120) failDetail = failDetail.slice(0, 120) + '…';
  setStatus('批量保存完成：成功 ' + ok + ' 条' + (failed ? '，失败 ' + failed + ' 条（' + failDetail + '）' : '') + '（桌面端会自动联网补全元数据）', failed ? true : false);
});

$('options').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
$('open-options').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) { setStatus('无法读取当前标签页', true); return; }
  currentTabId = tab.id;
  let meta;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['js/translators.js'] }).catch(function () {}); // 老包缺该文件时静默回退
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    meta = await chrome.tabs.sendMessage(tab.id, { type: 'litboard-extract' });
  } catch (error) {
    $('title').textContent = '（该页面不支持提取）';
    setStatus('浏览器限制了此页面的脚本注入', true);
    return;
  }
  currentMeta = meta;
  $('title').textContent = meta.title || '（未识别标题）';
  $('doi').textContent = meta.doi || '未找到';
  $('pdf-badge').hidden = !meta.pdfUrl;
  $('cnki-badge').hidden = meta.source !== 'CNKI';
  // translator 失败原因透传展示（如 Google Scholar 无 meta、解析失败）
  if (meta.translatorError) {
    const err = document.createElement('div');
    err.className = 'translator-error';
    err.textContent = '采集器：' + meta.translatorError;
    err.title = meta.translatorError;
    $('title').after(err);
  }

  // 拉取桌面端文件夹（含当前正在查看的文件夹）
  let folders = { currentFolderId: '' };
  try {
    folders = await chrome.runtime.sendMessage({ type: 'litboard-get-folders' });
  } catch (error) { /* 桌面端未运行 */ }
  if (folders && folders.ok) {
    buildFolderMenu(folders.folders || [], folders.currentFolderId || '');
  } else {
    const reason = folders && folders.error ? '：' + folders.error : '（请确认桌面端已重启到最新版，且端口/令牌正确）';
    setStatus('⚠ 无法获取文件夹列表' + reason);
  }

  // 列表页批量保存：页面上有多个 DOI 条目时提供勾选保存
  try {
    const list = await chrome.tabs.sendMessage(tab.id, { type: 'litboard-list-dois' });
    batchItems = (list && list.items || []).filter(function (item) {
      return !meta.doi || item.doi.toLowerCase() !== String(meta.doi).toLowerCase();
    });
    if (batchItems.length >= 2) renderBatchList(batchItems);
  } catch (e) {}

  // 点击插件图标即自动保存（默认目标：桌面端当前查看的文件夹）
  // 例外：列表页（无强 meta 且检测到多个 DOI 条目）不自动保存，避免把搜索结果页存成垃圾条目
  const looksLikeListing = !meta.detailPage && meta.source !== 'CNKI' && batchItems.length >= 2;
  if ((meta.doi || meta.title) && !looksLikeListing) {
    await new Promise(resolve => setTimeout(resolve, 600)); // 给用户短暂选择文件夹的窗口
    if (!lastSavedId) doSave();
  } else if (looksLikeListing) {
    setStatus('检测到这是列表页：请在下方勾选要保存的条目');
    $('batch-section').open = true;
  } else {
    setStatus('页面缺少标题与 DOI，无法保存', true);
  }
}

init();
