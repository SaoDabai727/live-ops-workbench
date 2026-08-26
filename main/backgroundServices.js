// backgroundServices.js — 私信 WebSocket 独立后台服务 + 登录态心跳
// 对应设计文档第 4.3 节
const WebSocket = require('ws');
const debugLog = require('./debugLog');

function createBackgroundServices({ mainWindow }) {
  const msgSockets = new Map(); // roomId -> ws
  const heartbeats = new Map(); // `${roomId}_${subPage}` -> interval

  // 私信 WebSocket：WebView 销毁后仍在主进程运行，新消息推送到渲染进程 UI
  function startPrivateMsgService(roomId, token) {
    if (msgSockets.has(roomId)) {
      debugLog.log(`[BG] startPrivateMsgService SKIP: roomId=${roomId} already connected`);
      return;
    }
    const url = `wss://im.jinritemai.com/ws?token=${encodeURIComponent(token || '')}`;
    debugLog.log(`[BG] startPrivateMsgService: roomId=${roomId} url=${url}`);
    try {
      const ws = new WebSocket(url);
      ws.on('open', () => {
        debugLog.log(`[BG] WebSocket OPEN: roomId=${roomId}`);
      });
      ws.on('message', (data) => {
        let count = 1;
        try {
          const payload = JSON.parse(data.toString());
          count = payload.count || 1;
        } catch (e) {}
        debugLog.log(`[BG] WebSocket MESSAGE: roomId=${roomId} count=${count}`);
        if (mainWindow) {
          mainWindow.webContents.send('new-message', { roomId, subPage: 'privateMsg', count });
        }
      });
      ws.on('error', (e) => {
        debugLog.log(`[BG] WebSocket ERROR: roomId=${roomId} msg=${e.message}`);
      });
      ws.on('close', (code) => {
        debugLog.log(`[BG] WebSocket CLOSE: roomId=${roomId} code=${code}`);
        msgSockets.delete(roomId);
      });
      msgSockets.set(roomId, ws);
    } catch (e) {
      debugLog.log(`[BG] WebSocket INIT FAILED: roomId=${roomId} error=${e.message}`);
    }
  }

  function stopPrivateMsgService(roomId) {
    const ws = msgSockets.get(roomId);
    if (ws) { try { ws.close(); } catch (e) {} msgSockets.delete(roomId); }
  }

  // 登录态心跳：定时对分区 session 发起轻量请求，防止 Cookie 过期
  // 仅在 isLoggedIn=true 且页面处于销毁态时由调用方触发
  function startHeartbeat(roomId, subPage) {
    const key = `${roomId}_${subPage}`;
    if (heartbeats.has(key)) return;
    const hb = setInterval(() => {
      if (mainWindow) mainWindow.webContents.send('heartbeat-tick', { roomId, subPage });
    }, 10 * 60 * 1000);
    heartbeats.set(key, hb);
  }

  function stopHeartbeat(roomId, subPage) {
    const key = `${roomId}_${subPage}`;
    const hb = heartbeats.get(key);
    if (hb) { clearInterval(hb); heartbeats.delete(key); }
  }

  function dispose() {
    msgSockets.forEach(ws => { try { ws.close(); } catch (e) {} });
    msgSockets.clear();
    heartbeats.forEach(hb => clearInterval(hb));
    heartbeats.clear();
  }

  return { startPrivateMsgService, stopPrivateMsgService, startHeartbeat, stopHeartbeat, dispose };
}

module.exports = { createBackgroundServices };
