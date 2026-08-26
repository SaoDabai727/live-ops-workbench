// danmakuPreload.js 片段 — 合并到 webviewPreload.js
// 在 buyin.jinritemai.com 页面监听弹幕 DOM 变化，提取昵称+内容+时间

(function setupDanmakuMonitor() {
  function startMonitor() {
    if (!window.location.hostname.includes('jinritemai.com') &&
        !window.location.hostname.includes('buyin')) return;

    const { ipcRenderer } = require('electron');
    const roomId = '__DANMAKU_ROOM__'; // 由主进程注入时替换

    let paused = false;
    let sentSet = []; // 滑动窗口去重

    // ====== 弹幕 DOM 解析 ======
    function parseItem(el) {
      const text = (el.innerText || '').trim();
      if (!text || text.length > 200) return null;

      // 尝试从子元素提取
      const nickEl = el.querySelector('[class*="nick"], [class*="name"], [class*="user"], [class*="author"]');
      const timeEl = el.querySelector('[class*="time"], [class*="date"], [class*="timestamp"]');
      const nick = nickEl ? nickEl.innerText.trim() : '';
      const t = timeEl ? timeEl.innerText.trim() : '';

      // 昵称：若有 nickEl 用其文本，否则取 text 中第一个空格/冒号前的内容
      let nickname = nick;
      if (!nickname) {
        const idx = text.search(/[：: ]\s/);
        nickname = idx > 0 ? text.slice(0, idx).trim() : '';
      }

      // 内容：去掉昵称和时间的剩余部分
      let content = text;
      if (nickname) content = content.replace(nickname, '').trim();
      if (t) content = content.replace(t, '').trim();
      // 去掉开头的冒号/空格
      content = content.replace(/^[：:]\s*/, '').trim();

      if (!content) return null;

      return {
        nickname: nickname || '用户',
        content: content.slice(0, 100),
        time: t || new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    }

    function shouldSend(item) {
      const key = item.nickname + '|' + item.content;
      if (sentSet.includes(key)) return false;
      sentSet.push(key);
      if (sentSet.length > 300) sentSet.shift();
      return true;
    }

    function sendToMain(item) {
      if (!shouldSend(item)) return;
      ipcRenderer.send('danmaku-message', {
        roomId: roomId,
        nickname: item.nickname,
        content: item.content,
        time: item.time
      });
    }

    // ====== 容器查找（三阶回退） ======
    function findContainer() {
      const selectors = [
        '[class*="danmaku"]', '[class*="chat"]', '[class*="comment"]',
        '[class*="message-list"]', '[class*="bullet"]', '[class*="barrage"]',
        '[class*="live-chat"]', '[class*="room-chat"]', '[class*="msg-list"]',
        '[class*="chat-list"]', '[class*="chatroom"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.children.length > 0) return el;
      }
      return null;
    }

    // ====== MutationObserver ======
    function observe(container) {
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
        // 去抖合并：200ms 内的多条一次发
        if (batch.length > 0) {
          setTimeout(() => batch.forEach(sendToMain), 200);
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    // ====== 启动 ======
    let container = findContainer();
    if (container) {
      observe(container);
    } else {
      // 等页面渲染完成再试
      let retries = 0;
      const retry = setInterval(() => {
        container = findContainer();
        if (container) {
          clearInterval(retry);
          observe(container);
        }
        if (++retries > 20) clearInterval(retry);
      }, 1000);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startMonitor();
  } else {
    window.addEventListener('DOMContentLoaded', startMonitor);
  }
})();
