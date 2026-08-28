// promptWindow.js — 创建独立的 URL 输入对话框窗口
// 为什么不用渲染进程的 HTML 弹窗：Electron 的 BrowserView 是原生窗口层，
// 永远覆盖在 HTML 之上，渲染进程内的 z-index 无效。
// 用独立的 BrowserWindow 才能保证对话框始终可见。
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createPromptWindow({
  title = '设置飞书文档链接',
  hint = '请输入飞书文档链接',
  placeholder = 'https://xxx.feishu.cn/...',
  onSubmit,
  onCancel
} = {}) {
  const win = new BrowserWindow({
    width: 460,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#080D16',
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'prompt.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'prompt.html'));

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('prompt-init', { title, hint, placeholder });
  });

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
