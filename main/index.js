// index.js — 主入口
// 对应设计文档第 12 节开发路线图：Electron 主进程结构、窗口管理
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { registerPrivilegedSchemes, installProtocolGuard } = require('./protocolGuard');
const { createWindowManager } = require('./windowManager');
const { createUpdater } = require('./updater');

// 必须在 app.ready 之前注册，才能接管 bytedance:// 等协议
registerPrivilegedSchemes();

let mainWindow = null;
let windowManager = null;
let updater = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    useContentSize: true,
    backgroundColor: '#080D16',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.once('ready-to-show', () => {
    try { mainWindow.maximize(); } catch (e) {}
    mainWindow.show();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  installProtocolGuard();

  // 自定义中文应用菜单（替代默认英文菜单）
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件(&F)',
      submenu: [
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: '编辑(&E)',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' }
      ]
    },
    {
      label: '视图(&V)',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口(&W)',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭' }
      ]
    },
    {
      label: '帮助(&H)',
      submenu: [
        { label: '检查更新', click: () => { if (updater) updater.check({ userTriggered: true }); } },
        { type: 'separator' },
        { label: '关于', click: () => {
          const { dialog } = require('electron');
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '关于',
            message: '直播运营助手',
            detail: '版本 v' + app.getVersion() + '\n多直播间监控与日报生成一体工作台\n\n支持云端升级：帮助 → 检查更新\n整合：黑蛋助手 v1.2.0 + 巨量百应工作台 v1.0.24',
            buttons: ['检查更新', '确定'],
            defaultId: 1,
            cancelId: 1
          }).then((box) => {
            if (box.response === 0 && updater) updater.check({ userTriggered: true });
          });
        }}
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  createMainWindow();
  updater = createUpdater({ getMainWindow: () => mainWindow });
  updater.init();
  windowManager = createWindowManager({ mainWindow });
  windowManager.init();
});

app.on('window-all-closed', () => {
  if (windowManager && windowManager.dispose) windowManager.dispose();
  if (updater && updater.dispose) updater.dispose();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    if (!updater) {
      updater = createUpdater({ getMainWindow: () => mainWindow });
      updater.init();
    }
    windowManager = createWindowManager({ mainWindow });
    windowManager.init();
  }
});
