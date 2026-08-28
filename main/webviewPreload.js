// webviewPreload.js — 注入到每个 WebView（巨量百应/直播大屏/私信/文档）的桥接层
// 用途：在受控前提下，让第三方页面能经 IPC 向主进程安全索取 token（不注入全局变量、不改写页面逻辑）。
// 安全约束：主进程 authManager 在返回 token 前会校验 webContents.id 与分区匹配性。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbenchAuth', {
  // 页面主动请求 token；主进程验证来源后才返回
  getToken: () => ipcRenderer.invoke('get-token')
});

// ====== 全站拦截自定义协议点击（bytedance:// 等），防止 Windows 系统弹窗 ======
(function interceptProtocolLinks() {
  const BLOCKED = /^(bytedance|ms-windows-store|snssdk|sslocal|aweme|jinnianjin|toutiao|iesrd|bdvideo|ishuidian|taobao|alipays|weixin|alipay|fb-messenger):\/\//i;

  function isBlocked(href) {
    if (!href) return false;
    try {
      if (href.startsWith('#') || href.startsWith('/') || href.startsWith('?')) return false;
      if (/^https?:\/\//i.test(href) || href.startsWith('data:') || href.startsWith('blob:') || href.startsWith('about:')) {
        return false;
      }
      // 任意非 http(s) 自定义协议都拦（比仅黑名单更稳）
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return true;
      return BLOCKED.test(href);
    } catch (e) {
      return false;
    }
  }

  function block(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  }

  function startIntercept() {
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a) {
        const href = a.href || a.getAttribute('href') || '';
        if (isBlocked(href)) block(e);
      }
    }, true);

    document.addEventListener('auxclick', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a) {
        const href = a.href || a.getAttribute('href') || '';
        if (isBlocked(href)) block(e);
      }
    }, true);

    const origOpen = window.open;
    window.open = function (url, ...args) {
      if (isBlocked(url)) return null;
      return origOpen.apply(this, [url, ...args]);
    };

    try {
      const desc = Object.getOwnPropertyDescriptor(window.Location.prototype, 'href');
      if (desc && desc.set) {
        const origSet = desc.set;
        Object.defineProperty(window.Location.prototype, 'href', {
          get: desc.get,
          set(v) { if (isBlocked(v)) return; origSet.call(this, v); },
          configurable: true
        });
      }
    } catch (e) {}

    document.addEventListener('submit', (e) => {
      const form = e.target;
      const action = form && form.action ? form.action : '';
      if (isBlocked(action)) block(e);
    }, true);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startIntercept();
  } else {
    window.addEventListener('DOMContentLoaded', startIntercept);
  }
})();

// ====== 私信页面消息监控（页面加载后判断域名，避免 about:blank 时误判）======
(function setupMessageMonitor() {

  function startMonitor() {
    // 只在 douyin.com 页面启用监控
    if (!window.location.hostname.includes('douyin.com')) return;

    let lastUnreadCount = 0;

    function scanUnread() {
      let count = 0;
      try {
        const elems = document.querySelectorAll(
          '[class*="unread"],[class*="badge"],[class*="red"],[class*="dot"],' +
          '[class*="notice"],[class*="count"],[class*="new"],[class*="num"],' +
          '[aria-label*="未读"],[aria-label*="消息"],[aria-label*="新"]'
        );
        count = elems.length;
      } catch (e) {}
      return Math.max(0, count);
    }

    function checkAndReport(force) {
      const current = scanUnread();
      if (current > lastUnreadCount || force) {
        if (current > lastUnreadCount && lastUnreadCount > 0) {
          ipcRenderer.send('private-msg-count', { count: current - lastUnreadCount });
        } else if (force) {
          if (current > 0) ipcRenderer.send('private-msg-count', { count: current });
        }
      }
      lastUnreadCount = current;
    }

    let timer = null;
    try {
      const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => checkAndReport(false), 1000);
      });
      observer.observe(document.documentElement || document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
      });
    } catch (e) {}

    setInterval(() => checkAndReport(false), 10000);
    setTimeout(() => checkAndReport(true), 3000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startMonitor();
  } else {
    window.addEventListener('DOMContentLoaded', startMonitor);
  }
})();
