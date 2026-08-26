// danmaku.js — 弹幕窗口 preload
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('danmakuApi', {
  onRoom: (cb) => ipcRenderer.on('danmaku-room', (_e, roomId) => cb(roomId)),
  onPush: (cb) => ipcRenderer.on('danmaku-push', (_e, msg) => cb(msg)),
});

window.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const title = document.getElementById('title');
  const btnClear = document.getElementById('btn-clear');
  const MAX_ITEMS = 500;

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  ipcRenderer.on('danmaku-room', (_e, roomId) => {
    // 房间切换不清理已有弹幕，仅更新标题
  });

  ipcRenderer.on('danmaku-push', (_e, msg) => {
    if (empty) { empty.remove(); }
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML =
      '<span class="nick">' + escapeHtml(msg.nickname) + '</span>' +
      '<span class="content">: ' + escapeHtml(msg.content) + '</span>' +
      '<span class="time">' + escapeHtml(msg.time) + '</span>';
    list.appendChild(el);
    // 限制条数
    while (list.children.length > MAX_ITEMS) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  });

  btnClear.addEventListener('click', () => {
    list.innerHTML = '<div class="empty">已清除</div>';
  });
});
