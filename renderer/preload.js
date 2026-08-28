// preload.js — 主窗口渲染进程的上下文桥接层
// 安全策略：contextIsolation=true, nodeIntegration=false
// 仅向页面暴露受控的 ipc API，禁止直接访问 Node / Electron 内部。
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // 切换直播间
  switchRoom: (roomId) => ipcRenderer.send('switch-room', roomId),
  // 切换二级功能页
  switchSubPage: (subPage) => ipcRenderer.send('switch-subpage', subPage),
  // 刷新当前页
  refreshCurrent: () => ipcRenderer.send('refresh-current'),
  // 暂停/恢复自动刷新（传 true 暂停）
  togglePauseRefresh: (paused) => ipcRenderer.send('toggle-pause-refresh', paused),
  // 复位到默认页
  resetToDefault: (roomId, subPage) => ipcRenderer.send('reset-to-default', { roomId, subPage }),
  // 保存自定义 URL（如文档链接）
  saveCustomUrl: (roomId, subPage, url) =>
    ipcRenderer.invoke('save-custom-url', { roomId, subPage, url }),
  // 清除自定义 URL
  clearCustomUrl: (roomId, subPage) =>
    ipcRenderer.invoke('clear-custom-url', { roomId, subPage }),
  // 弹出飞书文档链接输入子窗口（损益表 / 保价表）
  openUrlPrompt: (roomId, subPage) => ipcRenderer.invoke('open-url-prompt', { roomId, subPage }),
  // 兼容旧 API
  openDocPrompt: (roomId) => ipcRenderer.invoke('open-url-prompt', { roomId, subPage: 'doc' }),
  // 打开直播间管理对话框
  openRoomManager: () => ipcRenderer.send('open-room-manager'),
  setKeepAlive: (roomId, subPage, keepAlive) =>
    ipcRenderer.send('set-keepalive', { roomId, subPage, keepAlive }),
  // 上报内容区实测尺寸，供 BrowserView 自适应
  reportLayoutBounds: (rect) => ipcRenderer.send('layout-bounds', rect),
  // 主进程推送的状态更新
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (_e, s) => cb(s)),
  // 新私信角标
  onNewMessage: (cb) => ipcRenderer.on('new-message', (_e, p) => cb(p)),
  // 网络状态
  onNetworkStatus: (cb) => ipcRenderer.on('network-status', (_e, p) => cb(p)),
  // 自动刷新暂停状态
  onRefreshPaused: (cb) => ipcRenderer.on('refresh-paused', (_e, p) => cb(p)),
  // 测试私信通告（开发调试用）
  testNewMessage: (roomId, count) => ipcRenderer.send('test-new-message', { roomId, count }),
  // 设置未读消息基线（用户进入私信页时调用，后续仅报告增量）
  setMsgBaseline: (roomId) => ipcRenderer.send('private-msg-baseline', { roomId }),

  // ====== 日报系统（融合 A 的日报助手） ======
  generateReport: (roomId) =>
    ipcRenderer.invoke('generate-report', { roomId }),
  scrapeProfile: (roomId) =>
    ipcRenderer.invoke('scrape-profile', { roomId }),
  saveReport: (roomId, reportText) =>
    ipcRenderer.invoke('save-report', { roomId, reportText }),
  copyReport: (reportText) =>
    ipcRenderer.invoke('copy-report', { reportText }),
  // 自动日报完成通知
  onAutoReportDone: (cb) => ipcRenderer.on('auto-report-done', (_e, p) => cb(p)),

  // 云端升级
  getAppInfo: () => ipcRenderer.invoke('app-get-info'),
  getUpdaterState: () => ipcRenderer.invoke('updater-get-state'),
  checkUpdate: () => ipcRenderer.invoke('updater-check'),
  downloadUpdate: () => ipcRenderer.invoke('updater-download'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
  onUpdaterStatus: (cb) => ipcRenderer.on('updater-status', (_e, s) => cb(s)),
};

contextBridge.exposeInMainWorld('workbench', api);
