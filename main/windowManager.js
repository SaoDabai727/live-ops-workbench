// windowManager.js — 窗口与 BrowserView 编排、运行时状态、IPC 调度
// 对应设计文档第 2、3、8、12 节
const { ipcMain } = require('electron');
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
const { forceExplainPanel } = require('./explainManager');
const { clipboard } = require('electron');
const debugLog = require('./debugLog');
const { cssRectToViewBounds } = require('./layoutBounds');

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

  // V1.22 全页常驻 + 定时抓取
  const keepAliveSet = new Set();
  const isKeepAlive = (roomId, subPage) => keepAliveSet.has(`${roomId}_${subPage}`);
  const scheduler = createReportScheduler({ factory, config, saveReport, mainWindow });
  scheduler.setOnTick((nextMs) => {
    appState.nextReportTime = nextMs;
    pushState();
  });

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

  // BrowserView 可视区域：优先用渲染进程实测槽位（CSS px），按 shell zoom 转成 DIP
  let measuredCssRect = null;
  function shellZoom() {
    try {
      const z = mainWindow.webContents.getZoomFactor();
      return Number.isFinite(z) && z > 0 ? z : 1;
    } catch (e) {
      return 1;
    }
  }
  function bounds() {
    const z = shellZoom();
    if (measuredCssRect && measuredCssRect.width > 0 && measuredCssRect.height > 0) {
      return cssRectToViewBounds(measuredCssRect, z);
    }
    const b = mainWindow.getContentBounds();
    const sidebarW = (config.layout.sidebarWidth || 128) * z;
    const toolbarH = (config.layout.toolbarHeight || 42) * z;
    const tabH = (config.layout.tabBarHeight || 40) * z;
    return {
      x: Math.round(sidebarW),
      y: Math.round(toolbarH + tabH),
      width: Math.max(0, Math.round(b.width - sidebarW)),
      height: Math.max(0, Math.round(b.height - toolbarH - tabH))
    };
  }

  function syncViewZoom(view) {
    const z = shellZoom();
    const target = view || factory.getCurrentView();
    if (!target || target.webContents.isDestroyed()) return;
    try {
      if (Math.abs(target.webContents.getZoomFactor() - z) > 0.001) {
        target.webContents.setZoomFactor(z);
      }
    } catch (e) {}
  }

  function applyViewBounds() {
    const v = factory.getCurrentView();
    if (!v || v.webContents.isDestroyed()) return;
    // 切到日报页时视图已从窗口移除，无需设置
    const attached = mainWindow.getBrowserViews && mainWindow.getBrowserViews().includes(v);
    if (!attached) return;
    const b = bounds();
    try {
      // 不用 setAutoResize：它按整窗增量缩放，会与侧栏/工具栏布局错位
      v.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });
      syncViewZoom(v);
      v.setBounds(b);
    } catch (e) {}
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
    try {
      view.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });
      syncViewZoom(view);
    } catch (e) {}
    mainWindow.addBrowserView(view);
    // addBrowserView 后再设一次，避免初始尺寸被覆盖
    applyViewBounds();
    // 下一帧再同步，适配 maximize / DPI
    setTimeout(applyViewBounds, 0);
    setTimeout(applyViewBounds, 100);
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
    ipcMain.on('layout-bounds', (e, rect) => {
      if (!rect || typeof rect !== 'object') return;
      const x = Number(rect.x) || 0;
      const y = Number(rect.y) || 0;
      const width = Number(rect.width) || 0;
      const height = Number(rect.height) || 0;
      if (width < 1 || height < 1) return;
      measuredCssRect = { x, y, width, height };
      // 始终重算：CSS 槽位或壳层 zoom（视图放大/缩小）任一变化都需同步
      applyViewBounds();
    });
    ipcMain.on('switch-subpage', (e, subPage) => {
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
      // 飞书文档类子页复位时清除自定义 URL，下次点击可重新输入
      const spCfg = config.subPages[subPage] || {};
      if (spCfg.kind === 'feishuDoc' || subPage === 'doc' || subPage === 'baojia') {
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
    // 弹出独立子窗口输入飞书文档链接（损益表 / 保价表等）
    function openFeishuPrompt(roomId, subPage) {
      const sp = config.subPages[subPage] || {};
      const label = sp.label || '飞书文档';
      return new Promise((resolve) => {
        createPromptWindow({
          title: '设置' + label + '链接',
          hint: '请输入「' + label + '」的飞书文档网页地址',
          placeholder: 'https://xxx.feishu.cn/...',
          onSubmit: (url) => {
            const custom = loadCustomUrls();
            custom[`${roomId}_${subPage}`] = url;
            saveCustomUrls(custom);
            pushState();
            setTimeout(() => showView(roomId, subPage), 50);
            resolve(true);
          },
          onCancel: () => resolve(false)
        });
      });
    }
    ipcMain.handle('open-url-prompt', (event, { roomId, subPage }) => openFeishuPrompt(roomId, subPage));
    ipcMain.handle('open-doc-prompt', (event, { roomId }) => openFeishuPrompt(roomId, 'doc'));
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
    // 工具栏「讲解面板」：强制向当前 BrowserView 注入/显示自动点讲解浮层
    ipcMain.handle('explain-force-panel', async () => {
      if (appState.currentSubPage !== 'juliang') {
        return {
          ok: false,
          reason: 'not-juliang',
          message: '请先切换到「巨量百应」子页，进入直播中控台后再打开讲解面板。'
        };
      }
      const v = factory.getCurrentView();
      if (!v || v.webContents.isDestroyed()) {
        return { ok: false, reason: 'no-view', message: '当前没有可操作的页面，请先打开巨量百应中控台。' };
      }
      const result = await forceExplainPanel(v);
      if (!result.ok) {
        const hint =
          result.reason === 'host-mismatch'
            ? '请先打开百应「直播中控台」页面，再点「讲解面板」。'
            : '注入失败，请刷新中控台页面后重试。';
        return { ok: false, reason: result.reason || 'failed', message: hint, url: result.url };
      }
      return { ok: true, injected: result.injected, url: result.url };
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
    applyViewBounds();
  }

  function syncLayout() {
    onResize();
    try {
      mainWindow.webContents.send('layout-sync');
    } catch (e) {}
  }

  function init() {
    registerIpc();
    mainWindow.on('resize', onResize);
    mainWindow.on('resized', onResize);
    mainWindow.on('maximize', () => { setTimeout(onResize, 0); setTimeout(onResize, 100); });
    mainWindow.on('unmaximize', () => { setTimeout(onResize, 0); setTimeout(onResize, 100); });
    mainWindow.on('enter-full-screen', onResize);
    mainWindow.on('leave-full-screen', onResize);
    mainWindow.webContents.on('did-finish-load', () => {
      pushState();
      // 页面加载后稍后再量一次，确保布局稳定
      setTimeout(onResize, 50);
      setTimeout(onResize, 300);
    });
    // 视图菜单 / Ctrl± 缩放：同步 BrowserView 尺寸与页面缩放
    mainWindow.webContents.on('zoom-changed', () => {
      setTimeout(syncLayout, 0);
      setTimeout(syncLayout, 50);
    });
    showView(appState.currentRoomId, appState.currentSubPage);
    scheduler.start();
  }

  function dispose() {
    debugLog.log('[WM] dispose');
    scheduler.stop();
    if (bg && bg.dispose) bg.dispose();
    Object.keys(keepAliveSet).forEach(k => keepAliveSet.delete(k));
  }

  return { init, appState, dispose, syncLayout };
}

module.exports = { createWindowManager };
