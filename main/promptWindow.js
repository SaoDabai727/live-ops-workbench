// promptWindow.js — 创建独立的 URL 输入对话框窗口
// 为什么不用渲染进程的 HTML 弹窗：Electron 的 BrowserView 是原生窗口层，
// 永远覆盖在 HTML 之上，渲染进程内的 z-index 无效。
// 用独立的 BrowserWindow 才能保证对话框始终可见。
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createPromptWindow({ onSubmit, onCancel }) {
  const win = new BrowserWindow({
    width: 460,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: '设置文档链接',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'prompt.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'prompt.html'));

  const submitHandler = (event, url) => {
    if (event.sender !== win.webContents) return;
    if (typeof onSubmit === 'function') onSubmit(url);
    win.close();
  };
  const cancelHandler = (event) => {
    if (event.sender !== win.webContents) return;
    if (typeof onCancel === 'function') onCancel();
    win.close();
  };
  ipcMain.on('prompt-submit', submitHandler);
  ipcMain.on('prompt-cancel', cancelHandler);

  win.on('closed', () => {
    ipcMain.removeListener('prompt-submit', submitHandler);
    ipcMain.removeListener('prompt-cancel', cancelHandler);
  });
}

module.exports = { createPromptWindow };
