// danmakuManager.js — 独立弹幕窗口管理（V1.22）

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const debugLog = require('./debugLog');

function createDanmakuManager({ mainWindow }) {
  let danmakuWin = null;
  let currentRoomId = null;

  function show() {
    if (danmakuWin && !danmakuWin.isDestroyed()) {
      danmakuWin.show();
      danmakuWin.focus();
      debugLog.log('[Danmaku] 已聚焦已有窗口');
      return;
    }
    const mainBounds = mainWindow.getBounds();
    const x = Math.max(0, mainBounds.x + mainBounds.width + 4);
    const y = mainBounds.y;
    debugLog.log('[Danmaku] show() mainBounds=' + JSON.stringify(mainBounds) + ' x=' + x + ' y=' + y);
    try {
      danmakuWin = new BrowserWindow({
        x, y,
        width: 320,
        height: Math.max(400, mainBounds.height),
        title: '弹幕',
        autoHideMenuBar: true,
        resizable: true,
        alwaysOnTop: true,
        webPreferences: {
          preload: path.join(__dirname, '..', 'renderer', 'danmaku.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
      danmakuWin.loadFile(path.join(__dirname, '..', 'renderer', 'danmaku.html'));
      danmakuWin.on('closed', () => { danmakuWin = null; });
      if (currentRoomId) {
        danmakuWin.webContents.on('did-finish-load', () => {
          danmakuWin.webContents.send('danmaku-room', currentRoomId);
        });
      }
      debugLog.log('[Danmaku] 窗口创建成功 id=' + danmakuWin.id);
    } catch (e) {
      console.error('[Danmaku] 创建窗口异常:', e);
      debugLog.log('[Danmaku] 创建失败: ' + (e.message || String(e)));
    }
  }

  function hide() {
    if (danmakuWin && !danmakuWin.isDestroyed()) danmakuWin.close();
    danmakuWin = null;
  }

  function toggle() {
    if (danmakuWin && !danmakuWin.isDestroyed()) { hide(); return false; }
    show(); return true;
  }

  function setRoomId(roomId, roomLabel) {
    currentRoomId = roomId;
    if (danmakuWin && !danmakuWin.isDestroyed()) {
      danmakuWin.setTitle(roomLabel + ' · 弹幕');
      danmakuWin.webContents.send('danmaku-room', roomId);
    }
  }

  function pushMessage(msg) {
    if (danmakuWin && !danmakuWin.isDestroyed()) {
      danmakuWin.webContents.send('danmaku-push', msg);
    }
  }

  function saveBounds() {
    // 可后续实现窗口位置记忆
  }

  function dispose() {
    hide();
  }

  return { show, hide, toggle, setRoomId, pushMessage, dispose };
}

module.exports = { createDanmakuManager };
