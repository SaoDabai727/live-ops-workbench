// webviewFactory.js — BrowserView 创建 / 销毁 / 对象池复用 / 保活 / 分区 / 事件拦截
// 对应设计文档第 4、5 节
const { BrowserView } = require('electron');
const path = require('path');
const { config, getDefaultUrl } = require('./config');
const debugLog = require('./debugLog');
const { ensurePartitionGuarded, isBlockedUrl, isExternalProtocol } = require('./protocolGuard');

const WEBVIEW_PRELOAD = path.join(__dirname, 'webviewPreload.js');

// 所有由本 factory 创建的 webContents.id（用于 webRequest 范围过滤）
const ourWebContentsIds = new Set();

function createWebViewFactory({ authManager, onViewEvent } = {}) {
  // 对象池按 partition 分组，避免跨直播间/功能页串号（修正文档中"复用即清状态"的隐患）
  const viewPool = new Map();        // partition -> BrowserView[]
  const keptAliveViews = new Map();  // `${roomId}_${subPage}` -> { view, meta }
  const preloadedViews = new Map();  // `${roomId}_${subPage}` -> BrowserView (后台预加载)
  const viewRegistry = new Map();    // webContents.id -> { roomId, subPage, partition }
  let currentView = null;
  let currentMeta = null;

  const partitionName = (roomId, subPage) => `persist:${roomId}_${subPage}`;

  function registerViewMeta(view, roomId, subPage) {
    const partition = partitionName(roomId, subPage);
    ensurePartitionGuarded(partition);
    viewRegistry.set(view.webContents.id, { roomId, subPage, partition });
    ourWebContentsIds.add(view.webContents.id);
    if (authManager && authManager.registerViewMeta) {
      authManager.registerViewMeta(view.webContents.id, { roomId, subPage, partition });
    }
  }

  function bindEvents(view, roomId, subPage) {
    // window.open / target=_blank：协议拦截；http(s) 在当前视图打开
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isBlockedUrl(url) || isExternalProtocol(url)) {
        debugLog.log(`[WF] window.open BLOCKED: "${String(url).slice(0, 120)}"`);
        return { action: 'deny' };
      }
      if (/^https?:\/\//i.test(url)) {
        try { view.webContents.loadURL(url); } catch (e) {}
      }
      return { action: 'deny' };
    });

    // 拦截 OAuth 回调（第 5.1 节），同时处理错误页重试请求 / 自定义协议
    view.webContents.on('will-navigate', (event, url) => {
      // 0. 错误页重试：__RELOAD_ACTION__?url=xxx
      if (url.startsWith('__RELOAD_ACTION__?url=')) {
        event.preventDefault();
        isErrorPage = false;
        const original = decodeURIComponent(url.split('__RELOAD_ACTION__?url=')[1]);
        if (original) view.webContents.loadURL(original);
        return;
      }
      // 1. OAuth 回调：拦截并交给 authManager
      if (config.authCallbackSchemes.some(s => url.startsWith(s))) {
        event.preventDefault();
        if (authManager && authManager.handleAuthCallback) {
          authManager.handleAuthCallback(url, roomId, subPage, view);
        }
        return;
      }
      // 2. 非 http(s) 协议一律阻止（bytedance:// 等），避免 Windows 系统弹窗
      if (!/^https?:\/\//i.test(url)) {
        event.preventDefault();
        debugLog.log(`[WF] will-navigate BLOCKED: "${String(url).slice(0, 120)}"`);
      }
    });

    try {
      view.webContents.on('will-frame-navigate', (event) => {
        const url = event.url || '';
        if (url && !/^https?:\/\//i.test(url) && !url.startsWith('__RELOAD_ACTION__') &&
            !url.startsWith('about:') && !url.startsWith('data:') && !url.startsWith('blob:')) {
          event.preventDefault();
          debugLog.log(`[WF] will-frame-navigate BLOCKED: "${url.slice(0, 120)}"`);
        }
      });
    } catch (e) {}

    // 加载失败内嵌错误页（第 9.1 节）
    let isErrorPage = false;  // 防止错误页加载自身时递归
    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      // ERR_ABORTED = 前一个导航被取消（非真正错误），忽略
      if (errorCode === -3) return;
      // 已显示错误页时不再重复注入
      if (isErrorPage) return;
      const cur = view.webContents.getURL();
      if (cur === 'about:blank') return;
      // 已经是错误页？跳过
      if (cur.startsWith('data:text/html')) return;
      // 自定义协议失败不展示错误页
      if (validatedURL && isExternalProtocol(validatedURL)) return;
      isErrorPage = true;
      const originalUrl = encodeURIComponent(validatedURL || cur);
      const html = 'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<meta charset="utf-8">' +
          '<style>body{font-family:sans-serif;text-align:center;padding:40px;color:#E2E8F0;background:#0A0E1A}</style>' +
          '<h2>加载失败</h2>' +
          '<p style="color:#94A3B8;font-size:13px">' + errorDescription + '</p>' +
          '<button onclick="location.href=\'__RELOAD_ACTION__?url=' + originalUrl + '\'" ' +
          'style="margin-top:16px;padding:6px 20px;border:1px solid #00E5C0;border-radius:6px;background:transparent;color:#00E5C0;cursor:pointer">重试</button>'
        );
      view.webContents.loadURL(html).catch(() => {});
    });

    // 渲染进程崩溃自动恢复（第 9.2 节）
    view.webContents.on('render-process-gone', (event, details) => {
      console.error('[webviewFactory] 渲染进程崩溃：', details.reason);
      try { view.webContents.reload(); } catch (e) {}
    });

    // 加载状态变化 → 通知 UI 显示加载进度条
    view.webContents.on('did-start-loading', () => {
      if (onViewEvent && onViewEvent.onLoadingChange) onViewEvent.onLoadingChange(roomId, subPage, true);
    });
    view.webContents.on('did-stop-loading', () => {
      if (onViewEvent && onViewEvent.onLoadingChange) onViewEvent.onLoadingChange(roomId, subPage, false);
    });

    // 成功加载后回调：更新 lastUrl / 登录态（第 6 节）
    view.webContents.on('did-finish-load', () => {
      const url = view.webContents.getURL();
      if (config.authCallbackSchemes.some(s => url.startsWith(s))) return;
      // 过滤内部页（about:blank / data:），防止回收流程覆盖用户的真实浏览 URL
      if (url === 'about:blank' || url.startsWith('data:')) return;
      // 仅当前活跃视图才更新 lastUrl，防止预加载/后台视图覆盖真实 URL
      if (!currentView || view.webContents.id !== currentView.webContents.id) return;
      debugLog.log(`[WF] did-finish-load roomId=${roomId} subPage=${subPage} url="${url}"`);
      if (onViewEvent && onViewEvent.onPageLoaded) onViewEvent.onPageLoaded(roomId, subPage, url);
    });

    // 监听 SPA 客户端路由变化（pushState / replaceState / hash），
    // 解决巨量百应等 SPA 内部导航不触发 did-finish-load 导致 lastUrl 不更新的问题
    view.webContents.on('did-navigate-in-page', (event, url) => {
      if (url === 'about:blank' || url.startsWith('data:')) return;
      // 仅当前活跃视图才更新 lastUrl，防止预加载/后台视图覆盖真实 URL
      if (!currentView || view.webContents.id !== currentView.webContents.id) return;
      debugLog.log(`[WF] did-navigate-in-page roomId=${roomId} subPage=${subPage} url="${url}"`);
      if (onViewEvent && onViewEvent.onPageLoaded) onViewEvent.onPageLoaded(roomId, subPage, url);
    });
  }

  function getPooledView(partition) {
    const list = viewPool.get(partition);
    if (list && list.length) {
      return list.pop();
    }
    return null;
  }

  function recycleView(view, roomId, subPage) {
    const partition = partitionName(roomId, subPage);
    const list = viewPool.get(partition) || [];
    if (list.length < config.viewPoolSize) {
      hideView(view);  // 隐到屏幕外即可，不加载 about:blank（避免覆盖 lastUrl）
      list.push(view);
      viewPool.set(partition, list);
    } else {
      destroyView(view);
    }
  }

  function destroyView(view) {
    try { viewRegistry.delete(view.webContents.id); } catch (e) {}
    try { ourWebContentsIds.delete(view.webContents.id); } catch (e) {}
    try { view.webContents.destroy(); } catch (e) {}
  }

  function hideView(view) {
    try { view.setBounds({ x: -10000, y: -10000, width: 0, height: 0 }); } catch (e) {}
  }

  function createView(roomId, subPage, { lastUrl } = {}) {
    const partition = partitionName(roomId, subPage);
    // 对象池按 partition 分组，复用的必为同分区（同 roomId+subPage）
    let view = getPooledView(partition);
    const isNew = !view;
    if (isNew) {
      view = new BrowserView({
        webPreferences: {
          partition,
          preload: WEBVIEW_PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      });
    }
    // 仅新建时绑定事件：避免池化复用导致重复监听，且闭包会捕获旧 roomId/subPage
    if (isNew) {
      registerViewMeta(view, roomId, subPage);
      bindEvents(view, roomId, subPage);
    }
    // 导航状态保持：优先使用上次访问的 URL，过滤 about:blank（防御性保护）
    const finalUrl = (lastUrl && lastUrl !== 'about:blank') ? lastUrl : getDefaultUrl(roomId, subPage);
    debugLog.log(`[WF] createView roomId=${roomId} subPage=${subPage} lastUrl="${lastUrl}" isNew=${isNew} loadURL="${finalUrl}"`);
    view.webContents.loadURL(finalUrl);
    return view;
  }

  // 保活模式（V1.10：全页面常驻，不再限制数量）
  function setKeepAlive(roomId, subPage, enabled) {
    const key = `${roomId}_${subPage}`;
    if (enabled) {
      if (currentView && currentMeta && currentMeta.roomId === roomId && currentMeta.subPage === subPage) {
        keptAliveViews.set(key, { view: currentView, meta: { roomId, subPage } });
      } else if (!keptAliveViews.has(key)) {
        const v = createView(roomId, subPage);
        hideView(v);
        keptAliveViews.set(key, { view: v, meta: { roomId, subPage } });
      }
      return { ok: true };
    } else {
      if (keptAliveViews.has(key)) {
        const { view } = keptAliveViews.get(key);
        keptAliveViews.delete(key);
        if (!(currentView === view)) destroyView(view);
      }
      return { ok: true };
    }
  }

  /** 后台预加载：创建并加载目标页面，置于屏幕外，切换时直接使用 */
  function preloadView(roomId, subPage) {
    const key = `${roomId}_${subPage}`;
    if (keptAliveViews.has(key) || preloadedViews.has(key)) return; // 已有无需重复
    const view = createView(roomId, subPage);
    hideView(view);
    preloadedViews.set(key, view);
  }

  function showView(roomId, subPage, { keepAlive = false, lastUrl = '' } = {}) {
    const key = `${roomId}_${subPage}`;
    let target;
    let branch = 'UNKNOWN';
    // 优先级：预加载 > 保活 > 新建
    if (preloadedViews.has(key)) {
      branch = 'PRELOADED';
      target = preloadedViews.get(key);
      preloadedViews.delete(key);
      // 预加载视图加载的是默认 URL；若用户曾导航到其他页面，恢复到上次 URL
      if (lastUrl && lastUrl !== 'about:blank') {
        debugLog.log(`[WF] showView PRELOADED, restoring lastUrl="${lastUrl}"`);
        target.webContents.loadURL(lastUrl);
      } else {
        debugLog.log(`[WF] showView PRELOADED, keeping default (lastUrl empty)`);
      }
    } else if (keptAliveViews.has(key)) {
      branch = 'KEEPALIVE';
      target = keptAliveViews.get(key).view;
      // 保活视图保留原有状态，无需额外导航
    } else {
      branch = 'NEW';
      // V1.10 全页常驻：旧视图不销毁，移入 keepAlive 持久化
      if (currentView && currentMeta) {
        const oldKey = `${currentMeta.roomId}_${currentMeta.subPage}`;
        if (!keptAliveViews.has(oldKey)) {
          hideView(currentView);
          keptAliveViews.set(oldKey, { view: currentView, meta: { ...currentMeta } });
        } else {
          hideView(currentView);
        }
      }
      target = createView(roomId, subPage, { lastUrl });
      // 新视图立刻加入保活
      keptAliveViews.set(key, { view: target, meta: { roomId, subPage } });
    }
    debugLog.log(`[WF] showView branch=${branch} roomId=${roomId} subPage=${subPage} lastUrl="${lastUrl}" keepAlive=${keepAlive}`);
    currentView = target;
    currentMeta = { roomId, subPage, keepAlive };
    return target;
  }

  function recycleOrDestroy(view, meta) {
    if (!meta) { destroyView(view); return; }
    recycleView(view, meta.roomId, meta.subPage);
  }

  function setBounds(b) {
    if (currentView) {
      try { currentView.setBounds(b); } catch (e) {}
    }
  }

  function getCurrentView() { return currentView; }
  function getKeepAliveCount() { return keptAliveViews.size; }
  function getRoomMeta(webContentsId) { return viewRegistry.get(webContentsId); }

  // V1.38：后台专用 —— 不改 currentView / 不隐藏用户当前视图
  // 复用 keepAlive 视图但不会主动导航（避免 pushState 副作用污染用户界面）
  function getOrCreateHiddenView(roomId, subPage) {
    const key = `${roomId}_${subPage}`;
    let view = keptAliveViews.get(key)?.view;
    if (!view || view.webContents.isDestroyed()) {
      view = createView(roomId, subPage);
      keptAliveViews.set(key, { view, meta: { roomId, subPage } });
    }
    hideView(view);
    return view;
  }

  return {
    createView, showView, setKeepAlive, setBounds,
    getCurrentView, getKeepAliveCount, destroyView, hideView,
    registerViewMeta, preloadView, getRoomMeta, getOrCreateHiddenView
  };
}

module.exports = { createWebViewFactory };
