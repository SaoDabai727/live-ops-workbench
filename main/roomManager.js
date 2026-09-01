// roomManager.js — 创建独立的直播间管理对话框子窗口
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createRoomManagerWindow({ mainWindow, rooms, notify, onSave }) {
  const win = new BrowserWindow({
    width: 720,
    height: 720,
    minWidth: 580,
    minHeight: 480,
    resizable: true,
    minimizable: false,
    parent: mainWindow,
    modal: true,
    title: '直播间管理',
    autoHideMenuBar: true,
    useContentSize: true,
    backgroundColor: '#161310',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'room-mgr.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'room-mgr.html'));

  // 等待页面就绪后发送当前房间列表 + 飞书配置
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('room-mgr-init', {
      rooms,
      notify: notify || {
        feishuWebhook: '',
        feishuAppId: '',
        feishuAppSecret: '',
        feishuSignSecret: ''
      }
    });
  });

  // 保存按钮 → 主进程写配置
  ipcMain.on('room-mgr-save', (event, payload) => {
    if (event.sender !== win.webContents) return;
    const updatedRooms = Array.isArray(payload) ? payload : (payload && payload.rooms);
    const updatedNotify = Array.isArray(payload) ? null : (payload && payload.notify);
    if (typeof onSave === 'function' && Array.isArray(updatedRooms)) {
      onSave(updatedRooms, updatedNotify || null);
    }
    win.close();
  });

  // 取消
  ipcMain.on('room-mgr-cancel', (event) => {
    if (event.sender !== win.webContents) return;
    win.close();
  });

  win.on('closed', () => {
    ipcMain.removeAllListeners('room-mgr-save');
    ipcMain.removeAllListeners('room-mgr-cancel');
  });
}

module.exports = { createRoomManagerWindow };
