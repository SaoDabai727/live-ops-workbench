// room-mgr.js — 直播间管理弹窗（主播逐条管理 + 飞书推送配置）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roomMgrApi', {
  init: (cb) => ipcRenderer.on('room-mgr-init', (_e, data) => cb(data)),
  save: (payload) => ipcRenderer.send('room-mgr-save', payload),
  cancel: () => ipcRenderer.send('room-mgr-cancel'),
  testFeishu: (notify) => ipcRenderer.invoke('test-feishu-notify', notify)
});

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('room-list');
  const btnAdd = document.getElementById('btn-add');
  const btnSave = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');
  const feishuWebhook = document.getElementById('feishu-webhook');
  const feishuAppId = document.getElementById('feishu-app-id');
  const feishuAppSecret = document.getElementById('feishu-app-secret');
  const feishuSignSecret = document.getElementById('feishu-sign-secret');
  const btnTestFeishu = document.getElementById('btn-test-feishu');
  const feishuTestStatus = document.getElementById('feishu-test-status');
  let rooms = [];
  let notify = {
    feishuWebhook: '',
    feishuAppId: '',
    feishuAppSecret: '',
    feishuSignSecret: ''
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fillNotifyForm() {
    if (feishuWebhook) feishuWebhook.value = notify.feishuWebhook || '';
    if (feishuAppId) feishuAppId.value = notify.feishuAppId || '';
    if (feishuAppSecret) feishuAppSecret.value = notify.feishuAppSecret || '';
    if (feishuSignSecret) feishuSignSecret.value = notify.feishuSignSecret || '';
  }

  function readNotifyForm() {
    return {
      feishuWebhook: (feishuWebhook && feishuWebhook.value || '').trim(),
      feishuAppId: (feishuAppId && feishuAppId.value || '').trim(),
      feishuAppSecret: (feishuAppSecret && feishuAppSecret.value || '').trim(),
      feishuSignSecret: (feishuSignSecret && feishuSignSecret.value || '').trim()
    };
  }

  function render() {
    container.innerHTML = '';
    rooms.forEach((room, i) => {
      const card = document.createElement('div');
      card.className = 'room-card';

      if (!Array.isArray(room.anchors)) room.anchors = [];

      const header = document.createElement('div');
      header.className = 'card-header';
      header.innerHTML =
        '<span class="card-num">#' + (i + 1) + '</span>' +
        '<input class="input-name" value="' + escapeHtml(room.label) + '" placeholder="直播间名" />' +
        '<input class="input-id" value="' + escapeHtml(room.roomId) + '" placeholder="Room ID" />' +
        (rooms.length > 1 ? '<button class="card-del" title="删除直播间">×</button>' : '<span></span>');

      const nameInput = header.querySelector('.input-name');
      const idInput = header.querySelector('.input-id');
      const delBtn = header.querySelector('.card-del');

      nameInput.addEventListener('input', () => { room.label = nameInput.value; });
      idInput.addEventListener('input', () => { room.roomId = idInput.value; });
      if (delBtn) {
        delBtn.addEventListener('click', () => { rooms.splice(i, 1); render(); });
      }

      const fields = document.createElement('div');
      fields.className = 'meta-row';
      fields.innerHTML =
        '<div class="field duration">' +
          '<span class="field-label">直播时长</span>' +
          '<input class="input-duration" value="' + escapeHtml(room.liveDuration || '15h') + '" placeholder="15h" />' +
        '</div>' +
        '<div class="field profile">' +
          '<span class="field-label">看播核心用户画像</span>' +
          '<textarea class="input-profile" rows="3" placeholder="例如：女 63% · 25-35岁为主…">' + escapeHtml(room.userProfileText || '') + '</textarea>' +
        '</div>';

      const durationInput = fields.querySelector('.input-duration');
      const profileInput = fields.querySelector('.input-profile');
      durationInput.addEventListener('input', () => { room.liveDuration = durationInput.value; });
      profileInput.addEventListener('input', () => { room.userProfileText = profileInput.value; });

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
        if (!room.anchors.length) {
          const empty = document.createElement('div');
          empty.className = 'anchor-empty';
          empty.textContent = '暂无主播，点击右上角添加';
          anchorList.appendChild(empty);
          return;
        }
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
        const lastInput = anchorList.querySelector('.anchor-row:last-child .anchor-name');
        if (lastInput) lastInput.focus();
      });

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
      userProfileText: ''
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
      // 保留已有 dailyUrl，避免管理窗保存时冲掉场次地址
      ...(r.dailyUrl ? { dailyUrl: r.dailyUrl } : {})
    }));
    ipcRenderer.send('room-mgr-save', {
      rooms: clean,
      notify: readNotifyForm()
    });
  });

  btnCancel.addEventListener('click', () => ipcRenderer.send('room-mgr-cancel'));

  if (btnTestFeishu) {
    btnTestFeishu.addEventListener('click', async () => {
      const current = readNotifyForm();
      if (!current.feishuWebhook) {
        if (feishuTestStatus) {
          feishuTestStatus.textContent = '请先填写 Webhook';
          feishuTestStatus.className = 'feishu-test-status err';
        }
        return;
      }
      btnTestFeishu.disabled = true;
      if (feishuTestStatus) {
        feishuTestStatus.textContent = '发送中…';
        feishuTestStatus.className = 'feishu-test-status';
      }
      try {
        const res = await ipcRenderer.invoke('test-feishu-notify', current);
        if (feishuTestStatus) {
          if (res && res.ok) {
            feishuTestStatus.textContent = res.message || '已发送';
            feishuTestStatus.className = 'feishu-test-status ok';
          } else {
            feishuTestStatus.textContent = (res && res.error) || '发送失败';
            feishuTestStatus.className = 'feishu-test-status err';
          }
        }
      } catch (e) {
        if (feishuTestStatus) {
          feishuTestStatus.textContent = e.message || '发送异常';
          feishuTestStatus.className = 'feishu-test-status err';
        }
      }
      btnTestFeishu.disabled = false;
    });
  }

  ipcRenderer.on('room-mgr-init', (_e, data) => {
    rooms = (data.rooms || []).map(r => ({ ...r, anchors: (r.anchors || []).map(a => ({ ...a })) }));
    notify = {
      feishuWebhook: '',
      feishuAppId: '',
      feishuAppSecret: '',
      feishuSignSecret: '',
      ...(data.notify || {})
    };
    fillNotifyForm();
    render();
  });
});
