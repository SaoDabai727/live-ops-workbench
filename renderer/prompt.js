// prompt.js — 文档链接输入弹窗 preload
// 通过 contextBridge 向页面暴露 API（页面脚本可调用）
// 同时直接操作 DOM 并走 ipcRenderer 发送消息（preload 上下文内）
const { contextBridge, ipcRenderer } = require('electron');

// 1. 向页面暴露 invoke 方法（将来如果页面脚本需要，可通过此处）
contextBridge.exposeInMainWorld('promptApi', {
  submit: (url) => ipcRenderer.send('prompt-submit', url),
  cancel: () => ipcRenderer.send('prompt-cancel')
});

// 2. DOM 加载完成后绑定事件（在 preload 上下文内，直接用 ipcRenderer）
window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('url-input');
  const btnSave = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');

  btnSave.onclick = () => {
    const url = input.value.trim();
    if (url) ipcRenderer.send('prompt-submit', url);
  };
  btnCancel.onclick = () => ipcRenderer.send('prompt-cancel');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSave.click();
    else if (e.key === 'Escape') btnCancel.click();
  });
  setTimeout(() => input.focus(), 50);
});
