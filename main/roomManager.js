// roomManager.js — 创建独立的直播间管理对话框子窗口
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createRoomManagerWindow({ mainWindow, rooms, onSave }) {
  const win = new BrowserWindow({
    width: 580,
    height: 560,
    resizable: false,
    minimizable: false,
    parent: mainWindow,
    modal: true,
    title: '直播间管理',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'room-mgr.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'room-mgr.html'));

  // 等待页面就绪后发送当前房间列表
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('room-mgr-init', { rooms });
  });

  // 保存按钮 → 主进程写配置
  ipcMain.on('room-mgr-save', (event, updatedRooms) => {
    if (event.sender !== win.webContents) return;
    if (typeof onSave === 'function') onSave(updatedRooms);
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
