// prompt.js — 飞书文档链接输入弹窗 preload
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptApi', {
  submit: (url) => ipcRenderer.send('prompt-submit', url),
  cancel: () => ipcRenderer.send('prompt-cancel')
});

window.addEventListener('DOMContentLoaded', () => {
  const titleEl = document.getElementById('prompt-title');
  const hintEl = document.getElementById('prompt-hint');
  const input = document.getElementById('url-input');
  const btnSave = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');

  ipcRenderer.on('prompt-init', (_e, meta = {}) => {
    if (meta.title) {
      document.title = meta.title;
      if (titleEl) titleEl.textContent = meta.title;
    }
    if (meta.hint && hintEl) hintEl.textContent = meta.hint;
    if (meta.placeholder && input) input.placeholder = meta.placeholder;
  });

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
