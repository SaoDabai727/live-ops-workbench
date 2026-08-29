// refreshManager.js — 智能自动刷新（空闲检测 + 全局暂停）
// 对应设计文档第 7 节
const { getSubPageConfig } = require('./config');
const { isCompassLiveScreenUrl } = require('./compassUrl');

function createRefreshManager() {
  let timer = null;
  let paused = false;
  let currentView = null;
  let currentSubPage = null;

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function start(view, subPage) {
    stop();
    currentView = view;
    currentSubPage = subPage;
    const sp = getSubPageConfig(subPage);
    const interval = (sp && sp.refreshInterval ? sp.refreshInterval : 0) * 1000;
    if (!interval) return; // 私信/文档页默认不刷新
    timer = setInterval(async () => {
      if (paused) return;
      if (!currentView || currentView.webContents.isLoading()) return;
      try {
        const url = currentView.webContents.getURL();
        // 罗盘直播大屏硬刷新会丢掉场次关联，弹出「账号无权访问」
        if (isCompassLiveScreenUrl(url) || currentSubPage === 'daping') {
          return;
        }
        const isIdle = await currentView.webContents.executeJavaScript(
          'document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA"'
        );
        if (isIdle && !currentView.webContents.isLoading()) {
          currentView.webContents.reload();
        }
      } catch (e) {
        // 页面尚未就绪或被替换，忽略
      }
    }, interval);
  }

  function setPaused(p) { paused = !!p; }
  function isPaused() { return paused; }

  return { start, stop, setPaused, isPaused };
}

module.exports = { createRefreshManager };
