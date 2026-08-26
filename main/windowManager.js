// windowManager.js — 窗口与 BrowserView 编排、运行时状态、IPC 调度
// 对应设计文档第 2、3、8、12 节
const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const { config, getDefaultUrl, loadCustomUrls, saveCustomUrls } = require('./config');
const { createWebViewFactory } = require('./webviewFactory');
const { createAuthManager } = require('./authManager');
const { createRefreshManager } = require('./refreshManager');
const { createBackgroundServices } = require('./backgroundServices');
const { createPromptWindow } = require('./promptWindow');
const { createRoomManagerWindow } = require('./roomManager');
const { saveRooms, loadRooms, loadNavState, saveNavState, saveReport, loadLastReport } = require('./config');
const { generateReport, scrapeProfile } = require('./reportManager');
const { createReportScheduler } = require('./reportScheduler');
const { clipboard } = require('electron');
const debugLog = require('./debugLog');

function createWindowManager({ mainWindow }) {
  // 运行时状态（设计文档 3.3）
  const appState = {
    currentRoomId: config.liveRooms[0] ? config.liveRooms[0].id : 'live1',
    currentSubPage: 'juliang',
    pages: {},
    nextReportTime: null
  };
  config.liveRooms.forEach(r => {
    appState.pages[r.id] = {};
    Object.keys(config.subPages).forEach(sp => {
      appState.pages[r.id][sp] = { lastUrl: '', isLoggedIn: false };
    });
  });

  // 加载持久化的导航状态（跨会话 lastUrl 保持）
  // 清理跨会话失效参数（universal_page_params_id 是站点分配的会话级 UUID）
  function cleanUrl(url) {
    try {
      const u = new URL(url);
      u.searchParams.delete('universal_page_params_id');
      u.searchParams.delete('pre_universal_page_params_id');
      return u.toString();
    } catch { return url; }
  }
  const persistedNav = loadNavState();
  config.liveRooms.forEach(r => {
    Object.keys(config.subPages).forEach(sp => {
      const key = `${r.id}_${sp}`;
      if (persistedNav[key] && !persistedNav[key].includes('summon.bytedance.com')) {
        appState.pages[r.id][sp].lastUrl = cleanUrl(persistedNav[key]);
      }
    });
  });

  // 将当前 appState.pages 中的 lastUrl 写入磁盘持久化
  function persistNavState() {
    const state = {};
    Object.entries(appState.pages).forEach(([roomId, subs]) => {
      Object.entries(subs).forEach(([subPage, data]) => {
        if (data.lastUrl && data.lastUrl !== 'about:blank' && !data.lastUrl.includes('summon.bytedance.com')) {
          state[`${roomId}_${subPage}`] = data.lastUrl;
        }
      });
    });
    saveNavState(state);
  }

  // 加载用户自定义 URL（如文档链接）
  const customUrls = loadCustomUrls();
  // 启动时立即重写一次持久化文件，去掉 summon.bytedance.com 等污染 URL
  persistNavState();

  const bg = createBackgroundServices({ mainWindow });

  const authManager = createAuthManager({
    onLoginSuccess: (roomId, subPage, token) => {
      appState.pages[roomId][subPage].isLoggedIn = true;
      if (subPage === 'privateMsg') bg.startPrivateMsgService(roomId, token);
      pushState();
    }
  });
  authManager.setupTokenIPC();

  const refresh = createRefreshManager();

  const factory = createWebViewFactory({
    authManager,
    onViewEvent: {
      onPageLoaded: (roomId, subPage, url) => {
        // 过滤字节验证页（summon.bytedance.com），不参与持久化
        if (url && url.includes('summon.bytedance.com')) {
          debugLog.log(`[WM] onPageLoaded IGNORED (summon.bytedance): roomId=${roomId} subPage=${subPage}`);
          pushState();
          return;
        }
        debugLog.log(`[WM] onPageLoaded: roomId=${roomId} subPage=${subPage} -> lastUrl="${url}"`);
        appState.pages[roomId][subPage].lastUrl = url;
        persistNavState();
        pushState();
      },
      onLoadingChange: (roomId, subPage, loading) => {
        appState.loading = { roomId, subPage, loading };
        pushState();
      }
    }
  });

  // V1.22 全页常驻 + 定时抓取 + 弹幕独立窗口
  const keepAliveSet = new Set();
  const isKeepAlive = (roomId, subPage) => keepAliveSet.has(`${roomId}_${subPage}`);
  const scheduler = createReportScheduler({ factory, config, saveReport, mainWindow });
  scheduler.setOnTick((nextMs) => {
    appState.nextReportTime = nextMs;
    pushState();
  });
  // V1.28 弹幕窗口：声明在外层，dispose 才能访问
  let danmakuWin = null;

  function pushState() {
    if (mainWindow) {
      // 向渲染进程下发运行时状态 + 配置 + 自定义 URL
      const freshCustom = loadCustomUrls();
      mainWindow.webContents.send('state-update', {
        ...appState,
        liveRooms: config.liveRooms,
        subPages: config.subPages,
        layout: config.layout,
        customUrls: freshCustom
      });
    }
  }

  // 全局工具栏高度（与 renderer/styles.css 中 .toolbar 高度一致）
  const TOOLBAR_HEIGHT = 40;
  function bounds() {
    const b = mainWindow.getBounds();
    return {
      x: config.layout.sidebarWidth,
      y: TOOLBAR_HEIGHT + config.layout.tabBarHeight,
      width: Math.max(0, b.width - config.layout.sidebarWidth),
      height: Math.max(0, b.height - TOOLBAR_HEIGHT - config.layout.tabBarHeight)
    };
  }

  function showView(roomId, subPage) {
    // roomId 校验：防止无效 ID 导致崩溃（"BUG 3"）
    if (!appState.pages[roomId]) {
      console.error(`[windowManager] 无效 roomId: ${roomId}`);
      return;
    }
    const subCfg = config.subPages[subPage] || {};
    const isReportPage = subCfg.kind === 'report';

    appState.currentRoomId = roomId;
    appState.currentSubPage = subPage;

    // ---- report 子页：不加载 BrowserView，由渲染进程面板接管 ----
    if (isReportPage) {
      // 仅移除主窗口的 BrowserView 视觉层，保留视图实例（后续抓取仍可访问）
      const prev = factory.getCurrentView();
      if (prev) {
        try { mainWindow.removeBrowserView(prev); } catch (e) {}
      }
      refresh.stop();
      appState.lastReport = loadLastReport(roomId);
      pushState();
      return;
    }

    // ---- 常规子页：BrowserView 流程 ----
    const prev = factory.getCurrentView();
    // 导航状态保持：传递用户上次访问的 URL。过滤污染 URL（summon.bytedance.com 验证页）以避免死循环
    let lastUrl = appState.pages[roomId][subPage].lastUrl || '';
    if (lastUrl.includes('summon.bytedance.com')) {
      debugLog.log(`[WM] showView cleaning polluted lastUrl: roomId=${roomId} subPage=${subPage}`);
      lastUrl = '';
      appState.pages[roomId][subPage].lastUrl = '';  // 同步清理
    }
    debugLog.log(`[WM] showView roomId=${roomId} subPage=${subPage} lastUrl="${lastUrl}"`);
    const view = factory.showView(roomId, subPage, { keepAlive: isKeepAlive(roomId, subPage), lastUrl });
    if (prev && prev !== view) {
      try { mainWindow.removeBrowserView(prev); } catch (e) {}
    }
    view.setBounds(bounds());
    mainWindow.addBrowserView(view);
    refresh.start(view, subPage);
    // 私信页：进入时即尝试启动后台 WebSocket（不等 OAuth 回调）
    if (subPage === 'privateMsg') {
      const token = authManager.tokenStore.get(`persist:${roomId}_${subPage}`) || '';
      debugLog.log(`[WM] showView privateMsg: roomId=${roomId} tokenPresent=${!!token}`);
      bg.startPrivateMsgService(roomId, token);
    }
    pushState();
    schedulePreload(roomId, subPage);
  }

  // —— 后台预加载：停留当前页面 5 秒后，预测下一直播间，提前加载 ——
  let preloadTimer = null;
  function schedulePreload(roomId, subPage) {
    if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = null; }
    preloadTimer = setTimeout(() => {
      preloadTimer = null;
      // 预测策略：下一个直播间（成环形）
      const idx = config.liveRooms.findIndex(r => r.id === roomId);
      if (idx >= 0) {
        const nextIdx = (idx + 1) % config.liveRooms.length;
        const nextRoom = config.liveRooms[nextIdx];
        if (nextRoom && nextRoom.id !== roomId) {
          factory.preloadView(nextRoom.id, subPage);
        }
      }
    }, 5000);
  }

  let registered = false;
  function registerIpc() {
    if (registered) return;
    registered = true;
    // 去重计数器：记录每个房间 DOM 监控最后一次报告的数量，仅增量上报
    const msgLastCount = {}; // roomId → last DOM count

    // 测试通告
    ipcMain.on('test-new-message', (e, { roomId, count } = {}) => {
      const rid = roomId || config.liveRooms[0]?.id || 'live1';
      debugLog.log(`[WM] TEST-NEW-MESSAGE: roomId=${rid} count=${count || 1}`);
      mainWindow.webContents.send('new-message', { roomId: rid, subPage: 'privateMsg', count: count || 1 });
    });
    // 用户点击私信页 → 锁入当前 DOM 计数，防止已读消息被重复报告为未读
    ipcMain.on('private-msg-baseline', (e, { roomId }) => {
      debugLog.log(`[WM] MSG-BASELINE: roomId=${roomId} locked count=${msgLastCount[roomId] || 0}`);
    });
    // 私信页面 DOM 监控上报：严格增量 + 当前页抑制（双重去重，消除竞态）
    ipcMain.on('private-msg-count', (event, { count }) => {
      const meta = factory.getRoomMeta(event.sender.id);
      const roomId = meta ? meta.roomId : (config.liveRooms[0]?.id || 'live1');
      const c = count || 1;
      const last = msgLastCount[roomId] || 0;
      // 用户正在该房间私信页 → 抑制报告，但仍更新计数器
      const isViewing = appState.pages[roomId] && appState.currentRoomId === roomId && appState.currentSubPage === 'privateMsg';
      debugLog.log(`[WM] PRIVATE-MSG-COUNT: roomId=${roomId} count=${c} last=${last} viewing=${isViewing}`);
      msgLastCount[roomId] = c;
      if (isViewing) return;
      if (c > last) {
        const delta = last === 0 ? c : c - last;
        mainWindow.webContents.send('new-message', { roomId, subPage: 'privateMsg', count: delta });
      }
    });
    ipcMain.on('switch-room', (e, roomId) => showView(roomId, appState.currentSubPage));
    ipcMain.on('switch-subpage', (e, subPage) => {
      if (subPage === '_toggle_danmaku') {
        debugLog.log('[Danmaku] _toggle_danmaku received');
        if (danmakuWin && !danmakuWin.isDestroyed()) {
          if (danmakuWin.isVisible()) { danmakuWin.hide(); }
          else { danmakuWin.show(); }
        } else {
          createDanmakuWindow();
        }
        return;
      }
      showView(appState.currentRoomId, subPage);
    });
    ipcMain.on('refresh-current', () => {
      const v = factory.getCurrentView();
      if (v) v.webContents.reload();
    });
    ipcMain.on('toggle-pause-refresh', (e, paused) => {
      refresh.setPaused(!!paused);
      mainWindow.webContents.send('refresh-paused', !!paused);
    });
    ipcMain.on('reset-to-default', (e, { roomId, subPage }) => {
      appState.pages[roomId][subPage].lastUrl = '';
      // 文档页复位时同时清除自定义 URL，下次点击可重新输入
      if (subPage === 'doc') {
        const custom = loadCustomUrls();
        delete custom[`${roomId}_${subPage}`];
        saveCustomUrls(custom);
      }
      const v = factory.getCurrentView();
      if (v) v.webContents.loadURL(getDefaultUrl(roomId, subPage));
      pushState();
    });
    ipcMain.on('set-keepalive', (e, { roomId, subPage, keepAlive }) => {
      const res = factory.setKeepAlive(roomId, subPage, !!keepAlive);
      if (res && res.error) {
        mainWindow.webContents.send('keepalive-error', { roomId, subPage, error: res.error });
      } else {
        const key = `${roomId}_${subPage}`;
        if (keepAlive) keepAliveSet.add(key); else keepAliveSet.delete(key);
      }
    });
    // 保存自定义 URL（用户设置的文档链接等）
    ipcMain.handle('save-custom-url', (event, { roomId, subPage, url }) => {
      const custom = loadCustomUrls();
      custom[`${roomId}_${subPage}`] = url;
      saveCustomUrls(custom);
      pushState();
      return true;
    });
    // 清除自定义 URL
    ipcMain.handle('clear-custom-url', (event, { roomId, subPage }) => {
      const custom = loadCustomUrls();
      delete custom[`${roomId}_${subPage}`];
      saveCustomUrls(custom);
      pushState();
      return true;
    });
    // 弹出独立的子窗口用于输入文档链接（不被 BrowserView 遮挡）
    ipcMain.handle('open-doc-prompt', (event, { roomId }) => {
      return new Promise((resolve) => {
        createPromptWindow({
          onSubmit: (url) => {
            const custom = loadCustomUrls();
            custom[`${roomId}_doc`] = url;
            saveCustomUrls(custom);
            pushState();
            // 保存后自动切换到文档页
            setTimeout(() => showView(roomId, 'doc'), 50);
            resolve(true);
          },
          onCancel: () => {
            resolve(false);
          }
        });
      });
    });
    // ====== 日报系统（融合 A 的日报助手能力）======
    // 生成日报：抓取 KPI（画像来自房间配置，需先去人群页单独抓取）
    ipcMain.handle('generate-report', async (event, { roomId }) => {
      const rid = roomId || appState.currentRoomId;
      const roomCfg = config.liveRooms.find(r => r.id === rid) || {};
      let dapingView = factory.getCurrentView();
      if (dapingView && dapingView.webContents.isDestroyed()) dapingView = null;
      const result = await generateReport({ view: dapingView, roomCfg, factory, roomId: rid });
      if (result.report && !result.error) {
        saveReport(rid, result.report);
        appState.lastReport = result.report;
      }
      return result;
    });
    // 单独抓取用户画像（需先在 daping 内切换到「人群」标签页）
    ipcMain.handle('scrape-profile', async (event, { roomId }) => {
      const rid = roomId || appState.currentRoomId;
      let dapingView = factory.getCurrentView();
      if (dapingView && dapingView.webContents.isDestroyed()) dapingView = null;
      const result = await scrapeProfile({ view: dapingView, factory, roomId: rid });
      // 成功后保存到房间配置
      if (result.profile && !result.error) {
        const room = config.liveRooms.find(r => r.id === rid);
        if (room) {
          room.userProfileText = result.profile;
          saveRooms(config.liveRooms);
        }
      }
      return result;
    });
    // 保存日报到历史
    ipcMain.handle('save-report', (event, { roomId, reportText }) => {
      try {
        saveReport(roomId, reportText);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    // 复制日报到剪贴板
    ipcMain.handle('copy-report', (event, { reportText }) => {
      try {
        clipboard.writeText(reportText);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    // V1.35：danmaku-message 仅用于接收 juliang 页面弹幕数据
    ipcMain.on('danmaku-message', (event, { nickname, content, time }) => {
      const meta = factory.getRoomMeta(event.sender.id);
      const roomId = meta ? meta.roomId : (config.liveRooms[0]?.id || 'live1');
      if (danmakuWin && !danmakuWin.isDestroyed()) {
        danmakuWin.webContents.send('danmaku-push', { nickname, content, time });
      }
    });

    // ====== 原有 IPC ======

    // ====== 原有 IPC ======
    // 打开直播间管理对话框
    ipcMain.on('open-room-manager', () => {
      const roomData = loadRooms();
      createRoomManagerWindow({
        mainWindow,
        rooms: roomData,
        onSave: (updatedRooms) => {
          // 清理已删除房间的关联状态
          const oldRoomIds = new Set(config.liveRooms.map(r => r.id));
          const newRoomIds = new Set(updatedRooms.map(r => r.id));
          oldRoomIds.forEach(id => {
            if (!newRoomIds.has(id)) {
              bg.stopPrivateMsgService(id);
              Object.keys(config.subPages).forEach(sp => {
                keepAliveSet.delete(`${id}_${sp}`);
              });
            }
          });
          saveRooms(updatedRooms);
          // V1.37：saveRooms 已设置 config.liveRooms = updatedRooms，不再重复操作
          const newPages = {};
          updatedRooms.forEach(r => {
            newPages[r.id] = appState.pages[r.id] || {};
            Object.keys(config.subPages).forEach(sp => {
              if (!newPages[r.id][sp]) newPages[r.id][sp] = { lastUrl: '', isLoggedIn: false };
            });
          });
          appState.pages = newPages;
          if (!updatedRooms.find(r => r.id === appState.currentRoomId)) {
            showView(updatedRooms[0]?.id || 'live1', appState.currentSubPage);
          }
          pushState();
        }
      });
    });
  }

  function onResize() {
    const v = factory.getCurrentView();
    if (v) v.setBounds(bounds());
  }

  function init() {
    registerIpc();
    mainWindow.on('resize', onResize);
    mainWindow.webContents.on('did-finish-load', () => pushState());
    showView(appState.currentRoomId, appState.currentSubPage);
    scheduler.start();
    setTimeout(() => createDanmakuWindow(), 2000);
  }

  function createDanmakuWindow() {
    if (danmakuWin && !danmakuWin.isDestroyed()) return;
    try {
      const b = mainWindow.getBounds();
      debugLog.log('[Danmaku] auto-creating window, bounds=' + JSON.stringify(b));
      danmakuWin = new BrowserWindow({
        x: b.x + b.width + 4, y: b.y,
        width: 320, height: Math.max(400, b.height),
        title: '弹幕',
        autoHideMenuBar: true, resizable: true, alwaysOnTop: true,
        webPreferences: {
          preload: path.join(__dirname, '..', 'renderer', 'danmaku.js'),
          contextIsolation: true, nodeIntegration: false, sandbox: false
        }
      });
      danmakuWin.loadFile(path.join(__dirname, '..', 'renderer', 'danmaku.html'));
      danmakuWin.on('closed', () => { danmakuWin = null; });
      debugLog.log('[Danmaku] window auto-created, id=' + danmakuWin.id);
    } catch (e) {
      debugLog.log('[Danmaku] auto-create FAILED: ' + (e.message || String(e)));
    }
  }

  function dispose() {
    debugLog.log('[WM] dispose');
    scheduler.stop();
    if (danmakuWin && !danmakuWin.isDestroyed()) danmakuWin.close();
    if (bg && bg.dispose) bg.dispose();
    Object.keys(keepAliveSet).forEach(k => keepAliveSet.delete(k));
  }

  return { init, appState, dispose };
}

module.exports = { createWindowManager };
