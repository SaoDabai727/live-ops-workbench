// room-mgr.js — 直播间管理弹窗（主播逐条管理版）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roomMgrApi', {
  init: (cb) => ipcRenderer.on('room-mgr-init', (_e, data) => cb(data)),
  save: (rooms) => ipcRenderer.send('room-mgr-save', rooms),
  cancel: () => ipcRenderer.send('room-mgr-cancel')
});

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('room-list');
  const btnAdd = document.getElementById('btn-add');
  const btnSave = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');
  let rooms = [];

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    container.innerHTML = '';
    rooms.forEach((room, i) => {
      const card = document.createElement('div');
      card.className = 'room-card';

      // 确保 anchors 数组存在
      if (!Array.isArray(room.anchors)) room.anchors = [];

      // ---- 卡片头部：名称 + Room ID + 删除 ----
      const header = document.createElement('div');
      header.className = 'card-header';
      header.innerHTML =
        '<span class="card-num">#' + (i + 1) + '</span>' +
        '<input class="input-name" value="' + escapeHtml(room.label) + '" placeholder="直播间名" />' +
        '<input class="input-id" value="' + escapeHtml(room.roomId) + '" placeholder="Room ID" />' +
        (rooms.length > 1 ? '<button class="card-del">×</button>' : '');

      const nameInput = header.querySelector('.input-name');
      const idInput = header.querySelector('.input-id');
      const delBtn = header.querySelector('.card-del');

      nameInput.addEventListener('input', () => { room.label = nameInput.value; });
      idInput.addEventListener('input', () => { room.roomId = idInput.value; });
      if (delBtn) {
        delBtn.addEventListener('click', () => { rooms.splice(i, 1); render(); });
      }

      // ---- 字段区：时长 + 用户画像 ----
      const fields = document.createElement('div');
      fields.className = 'card-fields';
      fields.innerHTML =
        '<div class="field duration">' +
          '<span class="field-label">直播时长</span>' +
          '<input class="input-duration" value="' + escapeHtml(room.liveDuration || '15h') + '" placeholder="15h" />' +
        '</div>' +
        '<div class="field auto-report">' +
          '<span class="field-label">自动日报</span>' +
          '<label class="switch-label"><input type="checkbox" class="input-autoReport"' + (room.autoReport !== false ? ' checked' : '') + ' /><span class="switch-track"></span></label>' +
        '</div>' +
        '<div class="field profile">' +
          '<span class="field-label">看播核心用户画像</span>' +
          '<textarea class="input-profile" placeholder="女性为主，25-35岁...">' + escapeHtml(room.userProfileText || '') + '</textarea>' +
        '</div>';

      const durationInput = fields.querySelector('.input-duration');
      const profileInput = fields.querySelector('.input-profile');
      const autoReportInput = fields.querySelector('.input-autoReport');
      durationInput.addEventListener('input', () => { room.liveDuration = durationInput.value; });
      profileInput.addEventListener('input', () => { room.userProfileText = profileInput.value; });
      autoReportInput.addEventListener('change', () => { room.autoReport = autoReportInput.checked; });

      // ---- 主播区域 ----
      const anchorSection = document.createElement('div');
      anchorSection.className = 'anchor-section';
      anchorSection.innerHTML =
        '<div class="anchor-header">' +
          '<span class="section-label">主播列表</span>' +
          '<button class="btn-add-anchor">＋ 添加主播</button>' +
        '</div>' +
        '<div class="anchor-list"></div>';

      const anchorList = anchorSection.querySelector('.anchor-list');
      const btnAddAnchor = anchorSection.querySelector('.btn-add-anchor');

      function renderAnchors() {
        anchorList.innerHTML = '';
        room.anchors.forEach((a, idx) => {
          a.enabled = a.enabled !== false;
          const row = document.createElement('div');
          row.className = 'anchor-row';
          row.innerHTML =
            '<span class="anchor-order">' + (idx + 1) + '</span>' +
            '<input class="anchor-name" value="' + escapeHtml(a.name || '') + '" placeholder="主播名字" />' +
            '<button class="anchor-toggle' + (a.enabled ? ' enabled' : '') + '" title="' + (a.enabled ? '启用中' : '已停用') + '"></button>' +
            '<button class="anchor-del" title="删除">×</button>';

          const nameEl = row.querySelector('.anchor-name');
          const toggleEl = row.querySelector('.anchor-toggle');
          const delEl = row.querySelector('.anchor-del');

          nameEl.addEventListener('input', () => { a.name = nameEl.value; });
          toggleEl.addEventListener('click', () => {
            a.enabled = !a.enabled;
            toggleEl.classList.toggle('enabled', a.enabled);
            toggleEl.title = a.enabled ? '启用中' : '已停用';
          });
          delEl.addEventListener('click', () => {
            room.anchors.splice(idx, 1);
            renderAnchors();
          });

          anchorList.appendChild(row);
        });
      }

      btnAddAnchor.addEventListener('click', () => {
        room.anchors.push({ name: '', enabled: true });
        renderAnchors();
        // 聚焦新主播的输入框
        const lastInput = anchorList.querySelector('.anchor-row:last-child .anchor-name');
        if (lastInput) lastInput.focus();
      });

      // 组装卡片
      card.appendChild(header);
      card.appendChild(fields);
      card.appendChild(anchorSection);
      renderAnchors();
      container.appendChild(card);
    });
  }

  btnAdd.addEventListener('click', () => {
    const count = rooms.length + 1;
    rooms.push({
      id: 'live' + count,
      label: '新直播间' + count,
      roomId: '',
      anchors: [],
      liveDuration: '15h',
      userProfileText: '',
      autoReport: true
    });
    render();
    setTimeout(() => { container.lastChild?.scrollIntoView({ behavior: 'smooth' }); }, 50);
  });

  btnSave.addEventListener('click', () => {
    const used = new Set();
    rooms.forEach(r => {
      if (!r.id || used.has(r.id)) r.id = 'live' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      used.add(r.id);
    });
    const clean = rooms.map(r => ({
      id: r.id,
      label: r.label || '未命名',
      roomId: r.roomId || '',
      anchors: (r.anchors || []).map(a => ({ name: a.name || '未命名', enabled: a.enabled !== false })),
      liveDuration: r.liveDuration || '15h',
      userProfileText: r.userProfileText || '',
      autoReport: r.autoReport !== false
    }));
    ipcRenderer.send('room-mgr-save', clean);
  });

  btnCancel.addEventListener('click', () => ipcRenderer.send('room-mgr-cancel'));

  ipcRenderer.on('room-mgr-init', (_e, data) => {
    rooms = data.rooms.map(r => ({ ...r, anchors: (r.anchors || []).map(a => ({ ...a })) }));
    render();
  });
});
