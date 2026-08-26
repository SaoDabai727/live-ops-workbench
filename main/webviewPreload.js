// webviewPreload.js — 注入到每个 WebView（巨量百应/直播大屏/私信/文档）的桥接层
// 用途：在受控前提下，让第三方页面能经 IPC 向主进程安全索取 token（不注入全局变量、不改写页面逻辑）。
// 安全约束：主进程 authManager 在返回 token 前会校验 webContents.id 与分区匹配性。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbenchAuth', {
  // 页面主动请求 token；主进程验证来源后才返回
  getToken: () => ipcRenderer.invoke('get-token')
});

// ====== 拦截自定义协议点击（仅黑名单：bytedance:// 等会触发 Windows 弹窗的协议）======
(function interceptProtocolLinks() {
  // 等待页面加载后判断域名，避免干扰其他页面（compass/buyin/feishu）
  function startIntercept() {
    if (!window.location.hostname.includes('douyin.com')) return;

    // 黑名单：仅拦截会触发 Windows 应用选择弹窗的协议
    const BLOCKED = /^(bytedance|ms-windows-store|snssdk|sslocal|jinnianjin|toutiao|iesrd|bdvideo|ishuidian|taobao|alipays|weixin|alipay|fb-messenger):\/\//i;
    function isBlocked(href) {
      if (!href) return false;
      try {
        // 相对路径、hash、纯 query 都放行
        if (href.startsWith('#') || href.startsWith('/') || href.startsWith('?')) return false;
        // 非 http(s) 协议才需要检查白名单黑名单
        if (/^https?:\/\//i.test(href)) return false;
        return BLOCKED.test(href);
      } catch (e) { return false; }
    }
    function block(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    }
    // 1) 拦截 <a> 点击
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a) {
        const href = a.href || a.getAttribute('href') || '';
        if (isBlocked(href)) block(e);
      }
    }, true);
    // 2) 拦截 auxiliary 点击（中键/右键）
    document.addEventListener('auxclick', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a) {
        const href = a.href || a.getAttribute('href') || '';
        if (isBlocked(href)) block(e);
      }
    }, true);
    // 3) 拦截 window.open
    const origOpen = window.open;
    window.open = function (url, ...args) {
      if (isBlocked(url)) return null;
      return origOpen.apply(this, [url, ...args]);
    };
    // 4) 拦截 location.href 赋值
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
    // 5) 拦截表单提交到黑名单协议
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
          // 数量增加 → 报告增量
          ipcRenderer.send('private-msg-count', { count: current - lastUnreadCount });
        } else if (force) {
          // 首扫：仅当已有未读时才报告基线
          if (current > 0) ipcRenderer.send('private-msg-count', { count: current });
        }
      }
      lastUnreadCount = current;
    }

    // MutationObserver 去抖 1 秒
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

    // 备选定期扫
    setInterval(() => checkAndReport(false), 10000);

    // 首扫
    setTimeout(() => checkAndReport(true), 3000);
  }

  // 等待页面加载后运行（此时 window.location 已不是 about:blank）
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startMonitor();
  } else {
    window.addEventListener('DOMContentLoaded', startMonitor);
  }
})();

// ====== 弹幕监控 V1.23（巨量百应 buyin.jinritemai.com 重写） ======
(function setupDanmakuMonitor() {
  function startMonitor() {
    const host = window.location.hostname;
    const url = window.location.href;
    // V1.31：仅在巨量百应 buyin 域名运行；排除 compass 直播大屏
    if (!host.includes('buyin') && !host.includes('jinritemai.com/dashboard')) return;
    if (host.includes('compass') || url.includes('/compass/') || url.includes('live-data')) {
      console.log('[Danmaku] 跳过 compass 直播大屏页');
      return;
    }
    console.log('[Danmaku] 启动, host=' + host + ' url=' + url.slice(0, 80));

    let paused = false;
    const sentSet = []; // 滑动窗口去重
    const MAX_DEDUP = 500;
    let activeContainer = null;
    let activeObserver = null;

    // ====== 容器查找（V1.31：优先找"直播互动"区） ======
    function findContainer() {
      // 策略 1 (V1.31 新增)：找"直播互动"标题 → 同区域内列表容器
      const allEls = document.querySelectorAll('*');
      for (const h of allEls) {
        const t = (h.innerText || '').trim();
        if (t === '直播互动' || t === '互动消息' || t === '互动') {
          // 向上找包含列表的祖先容器
          let parent = h.parentElement;
          for (let i = 0; i < 6 && parent; i++) {
            const candidates = parent.querySelectorAll('div, ul, ol, section');
            for (const c of candidates) {
              // 必须是含 ≥2 个子项、可滚动、且不是 h 自身
              if (c !== h && c.children.length >= 2 && c.scrollHeight > 100) {
                // 验证：子项文本符合"用户名 + 短内容"模式
                const sample = Array.from(c.children).slice(0, 3).map(x => (x.innerText || '').trim());
                if (sample.every(s => s.length > 0 && s.length < 100)) {
                  console.log('[Danmaku] 找到直播互动区容器 class=' + (c.className || '').toString().slice(0, 60));
                  return c;
                }
              }
            }
            parent = parent.parentElement;
          }
        }
      }
      // 策略 2：class 关键词（v1.23 旧版）
      const sels1 = [
        '[class*="chatList"]', '[class*="chat-list"]', '[class*="messageList"]',
        '[class*="message-list"]', '[class*="commentList"]', '[class*="comment-list"]',
        '[class*="liveChat"]', '[class*="live-chat"]', '[class*="barrageList"]',
        '[class*="barrage-list"]', '[class*="danmu"]', '[class*="danmaku"]',
        '[class*="msgList"]', '[class*="msg-list"]', '[class*="semi-chat"]',
        '[class*="semi-list"]', '[class*="BytedanceIntersectList"]',
        '[class*="interactionList"]', '[class*="interaction-list"]',
        '[class*="commentListContainer"]'
      ];
      for (const sel of sels1) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.children.length >= 2 && el.scrollHeight > 100) return el;
        }
      }
      // 策略 3：兜底
      const allDivs = document.querySelectorAll('div');
      for (const d of allDivs) {
        if (d.children.length >= 3 && d.children.length <= 200) {
          const childTexts = Array.from(d.children).slice(0, 5).map(c => (c.innerText || '').trim());
          if (childTexts.every(t => t.length > 0 && t.length < 80) && d.scrollHeight > 200) {
            return d;
          }
        }
      }
      return null;
    }

    // ====== 单条弹幕解析（多策略） ======
    function parseItem(el) {
      if (!el || el.nodeType !== 1) return null;
      // 过滤掉自己过短或过长的项
      const directText = (el.innerText || '').trim();
      if (!directText || directText.length < 1 || directText.length > 200) return null;

      // 1) 找时间元素
      let time = '';
      const timeEl = el.querySelector('[class*="time" i], [class*="date" i], [class*="stamp" i], [class*="timestamp" i]');
      if (timeEl) time = timeEl.innerText.trim();

      // 2) 找昵称元素（避免宽泛的 [class*="name"]）
      let nick = '';
      const nickSel = [
        '[class*="nickname" i]', '[class*="nickName" i]', '[class*="userName" i]',
        '[class*="username" i]', '[class*="user-name" i]', '[class*="authorName" i]',
        '[class*="sender" i]', '[class*="from-user" i]'
      ];
      for (const sel of nickSel) {
        const e = el.querySelector(sel);
        if (e && e.innerText.trim()) { nick = e.innerText.trim(); break; }
      }

      // 3) 找内容元素
      let content = '';
      const contentSel = [
        '[class*="content" i]', '[class*="message-text" i]', '[class*="msgText" i]',
        '[class*="msg-text" i]', '[class*="commentText" i]', '[class*="comment-text" i]',
        '[class*="danmu-text" i]', '[class*="text" i]'
      ];
      for (const sel of contentSel) {
        const e = el.querySelector(sel);
        if (e && e.innerText.trim() && e.innerText.trim() !== nick) {
          content = e.innerText.trim();
          break;
        }
      }

      // 4) 兜底：从内文按行/冒号拆分（V1.31 适配巨量百应"标签 昵称 动作: 内容"格式）
      if (!content) {
        const text = directText;
        // 跳过常见的"非弹幕"系统提示
        if (/^(直播中|已结束|暂无|加载中|主播已|系统消息|请勿)/.test(text)) return null;

        // V1.32 标签集合：增加"潜在新客"
        const tags = /^(优质用户|优质|潜在新客|潜在新|潜在粉丝|潜在用户|新粉丝|新客户|铁粉|会员|粉丝团|路转粉|老粉|新粉|关注|超粉|团粉|已关注|主播|游客)\s*/;
        const stripped = text.replace(tags, '').trim();
        // V1.32 核心：取首部短 token (1-8 字符 中英数字) 作为昵称
        // 例："潜在新客 逆风(っ˘зʕ•̫͡•ʔ翻盘：用户的ID" → nick="逆风" content="(っ˘зʕ•̫͡•ʔ翻盘：用户的ID"
        const nickMatch = stripped.match(/^([\u4e00-\u9fa5a-zA-Z0-9_]{1,8})([\s\S]*)$/);
        if (nickMatch) {
          nick = nickMatch[1];
          content = (nickMatch[2] || '').replace(/^[：:\s]+/, '').trim();
        } else {
          content = stripped;
        }
        if (!content) return null;
      }

      // 清理：去掉前导的冒号/分隔符
      content = content.replace(/^[：:\s]+/, '').trim();
      if (!content) return null;
      // 过滤纯系统消息
      if (/^(系统消息|主播|运营|小二|助手)/.test(content)) return null;

      return {
        nickname: nick || '用户',
        content: content.slice(0, 200),
        time: time || new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    }

    // ====== 去重 ======
    function shouldSend(item) {
      const key = item.nickname + '|' + item.content;
      if (sentSet.includes(key)) return false;
      sentSet.push(key);
      if (sentSet.length > MAX_DEDUP) sentSet.shift();
      return true;
    }

    function sendToMain(item) {
      if (!shouldSend(item)) return;
      try { ipcRenderer.send('danmaku-message', item); } catch (e) {}
    }

    // ====== 观察器 ======
    function observe(container) {
      if (activeObserver) try { activeObserver.disconnect(); } catch (e) {}
      activeContainer = container;
      const observer = new MutationObserver(mutations => {
        if (paused) return;
        const batch = [];
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              const item = parseItem(node);
              if (item) batch.push(item);
            }
          }
        }
        if (batch.length > 0) {
          setTimeout(() => batch.forEach(sendToMain), 200);
          console.log('[Danmaku] 捕获', batch.length, '条');
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      activeObserver = observer;
      console.log('[Danmaku] 监听器已挂载:', container.tagName, container.className?.toString?.().slice(0, 80));
    }

    // ====== 启动 / 重启 ======
    function startOrRestart() {
      const container = findContainer();
      if (container && container !== activeContainer) {
        observe(container);
        return true;
      }
      return false;
    }

    if (startOrRestart()) return;

    // 重试 30 次（覆盖 SPA 路由切换、登录跳转等场景）
    let retries = 0;
    const retry = setInterval(() => {
      if (startOrRestart() || ++retries > 30) {
        clearInterval(retry);
        if (retries > 30) console.warn('[Danmaku] 30次重试未找到容器，请检查页面结构');
      }
    }, 1000);

    // 监听 URL 变化（SPA 路由）
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        retries = 0;
        startOrRestart();
      }
    }, 2000);

    // 暴露给 DevTools 手动调试
    window.__danmakuDebug = {
      findContainer, parseItem, observe,
      test: () => {
        const c = findContainer();
        console.log('container:', c);
        if (c) Array.from(c.children).slice(0, 5).forEach((child, i) => {
          const item = parseItem(child);
          console.log('item[' + i + ']:', item, 'innerText:', JSON.stringify(child.innerText?.slice(0, 50)));
        });
      }
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startMonitor();
  } else {
    window.addEventListener('DOMContentLoaded', startMonitor);
  }
})();
