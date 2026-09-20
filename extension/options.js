/* LitBoard 保存助手 — 选项页 */
'use strict';

const portEl = document.getElementById('port');
const tokenEl = document.getElementById('token');
const statusEl = document.getElementById('status');

async function load() {
  const cfg = await chrome.storage.sync.get(['port', 'token']);
  portEl.value = cfg.port || 24117;
  tokenEl.value = cfg.token || '';
}

document.getElementById('save').addEventListener('click', async function () {
  await chrome.storage.sync.set({
    port: Number(portEl.value) || 24117,
    token: tokenEl.value.trim()
  });
  statusEl.style.color = '#2f8f4e';
  statusEl.textContent = '已保存 ✓';
});

document.getElementById('test').addEventListener('click', async function () {
  statusEl.style.color = '#666';
  statusEl.textContent = '连接中…';
  try {
    const response = await fetch('http://127.0.0.1:' + (Number(portEl.value) || 24117) + '/ping');
    const data = await response.json();
    statusEl.style.color = data.ok ? '#2f8f4e' : '#c25050';
    statusEl.textContent = data.ok ? '连接成功 ✓（LitBoard 运行中）' : '桌面端响应异常';
  } catch (error) {
    statusEl.style.color = '#c25050';
    statusEl.textContent = '连接失败：LitBoard 桌面端未运行或端口错误';
  }
});

load();
