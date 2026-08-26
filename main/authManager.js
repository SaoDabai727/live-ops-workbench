// authManager.js — 登录拦截、code 换 token、token 安全 IPC
// 对应设计文档第 5 节
const { ipcMain } = require('electron');
const { config, getDefaultUrl } = require('./config');

function createAuthManager({ onLoginSuccess } = {}) {
  // token 仅存于主进程内存，按 partition 索引
  const tokenStore = new Map();          // partition -> token
  const viewMetaLookup = new Map();      // webContents.id -> { roomId, subPage, partition }

  function registerViewMeta(webContentsId, meta) {
    viewMetaLookup.set(webContentsId, meta);
  }

  function extractCode(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get('code') || u.pathname.split('/').pop() || '';
    } catch {
      return '';
    }
  }

  // 占位实现：真实环境需向巨量百应 OAuth 端点交换 token
  async function exchangeCodeForToken(code) {
    if (!config.tokenExchangeEndpoint) {
      return { accessToken: 'MOCK_' + code, expiresIn: 7200 };
    }
    // 真实场景示例：
    // const res = await fetch(config.tokenExchangeEndpoint, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ code, grant_type: 'authorization_code' })
    // });
    // return res.json();
    return { accessToken: 'MOCK_' + code, expiresIn: 7200 };
  }

  async function handleAuthCallback(callbackUrl, roomId, subPage, view) {
    const code = extractCode(callbackUrl);
    view.webContents.loadURL('about:blank'); // 显示等待
    const token = await exchangeCodeForToken(code);
    const partition = `persist:${roomId}_${subPage}`;
    tokenStore.set(partition, token.accessToken);
    if (onLoginSuccess) onLoginSuccess(roomId, subPage, token.accessToken);
    // 加载工作页面
    view.webContents.loadURL(getDefaultUrl(roomId, subPage));
  }

  // 页面经预加载桥接调用 getToken；主进程校验来源 webContents 与分区匹配性
  function setupTokenIPC() {
    ipcMain.handle('get-token', (event) => {
      const meta = viewMetaLookup.get(event.sender.id);
      if (!meta) return null;
      return tokenStore.get(meta.partition) || null;
    });
  }

  return { registerViewMeta, handleAuthCallback, setupTokenIPC, tokenStore };
}

module.exports = { createAuthManager };
