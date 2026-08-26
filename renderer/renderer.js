// renderer.js — UI 逻辑：左侧直播间标签、顶部二级功能标签、全局工具栏
// 通过 window.workbench（preload 桥接）与主进程通信
(function () {
  const api = window.workbench;
  const sidebar = document.getElementById('sidebar');
  const tabbar = document.getElementById('tabbar');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');
  const btnManage = document.getElementById('btn-manage');
  const netStatus = document.getElementById('net-status');
  const loadingBar = document.getElementById('loading-bar');
  const toastContainer = document.getElementById('toast-container');
  const btnQuickReport = document.getElementById('btn-quick-report');
  const btnDanmaku = document.getElementById('btn-danmaku');
  const reportCd = document.getElementById('report-cd');
  // 日报面板元素
  const reportPanel = document.getElementById('report-panel');
  const reportEditor = document.getElementById('report-editor');
  const btnScrapeReport = document.getElementById('btn-scrape-report');
  const btnScrapeProfile = document.getElementById('btn-scrape-profile');
  const btnCopyReport = document.getElementById('btn-copy-report');
  const btnSaveReport = document.getElementById('btn-save-report');
  const reportStatus = document.getElementById('report-status');

  let state = null;
  const msgCounts = {}; // roomId -> 未读私信数

  // —— 全局通告：任意直播间新私信时右上角 Toast 通知 ——
  function showToast(roomId, count) {
    if (!state) return;
    const room = state.liveRooms.find(r => r.id === roomId);
    const label = room ? room.label : roomId;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = '<div class="toast-title">' + label + ' · 新私信</div><div class="toast-body">收到 ' + count + ' 条消息</div>';
    toastContainer.appendChild(toast);
    // 自动消失
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  function render() {
    if (!state) return;
    renderSidebar();
    renderTabbar();
    renderReportPanel();
  }

  function renderReportPanel() {
    const isReport = state.currentSubPage === 'report';
    reportPanel.style.display = isReport ? 'flex' : 'none';
    // 切换时恢复上次日报
    if (isReport && state.lastReport && !reportEditor.value) {
      reportEditor.value = state.lastReport;
    }
    // 工具栏按钮：report 页隐藏刷新/暂停/复位
    const isReportPage = state.currentSubPage === 'report';
    btnRefresh.style.display = isReportPage ? 'none' : '';
    btnPause.style.display = isReportPage ? 'none' : '';
    btnReset.style.display = isReportPage ? 'none' : '';
  }


  function renderSidebar() {
    sidebar.innerHTML = '';
    state.liveRooms.forEach(room => {
      const el = document.createElement('div');
      el.className = 'room-item' + (room.id === state.currentRoomId ? ' active' : '');
      el.textContent = room.label;
      const cnt = msgCounts[room.id] || 0;
      if (cnt > 0) {
        const badge = document.createElement('span');
        badge.className = 'room-badge';
        badge.textContent = cnt > 99 ? '99+' : String(cnt);
        el.appendChild(badge);
      }
      el.onclick = () => api.switchRoom(room.id);
      sidebar.appendChild(el);
    });
  }

  function renderTabbar() {
    tabbar.innerHTML = '';
    Object.entries(state.subPages).forEach(([key, cfg]) => {
      const el = document.createElement('div');
      el.className = 'tab-item' + (key === state.currentSubPage ? ' active' : '');
      el.textContent = cfg.label;
      if (key === 'doc') {
        el.onclick = () => {
          const docKey = `${state.currentRoomId}_doc`;
          const hasUrl = state.customUrls && state.customUrls[docKey];
          if (!hasUrl) {
            // 通过 IPC 打开独立的子窗口输入 URL（不被 BrowserView 遮挡）
            api.openDocPrompt(state.currentRoomId);
          } else {
            api.switchSubPage('doc');
          }
        };
      } else {
        el.onclick = () => {
          // 进入后台私信 → 清零当前房间未读计数 + 设置消息基线
          if (key === 'privateMsg') {
            if (msgCounts[state.currentRoomId]) {
              delete msgCounts[state.currentRoomId];
              renderSidebar();
            }
            api.setMsgBaseline(state.currentRoomId);
          }
          api.switchSubPage(key);
        };
      }
      tabbar.appendChild(el);
    });
  }

  // —— 工具栏 ——
  btnQuickReport.onclick = () => {
    // 快捷入口：切到直播日报子页（用户自行点击「生成日报」）
    api.switchSubPage('report');
  };
  btnRefresh.onclick = () => api.refreshCurrent();
  btnPause.onclick = () => {
    const next = !(btnPause.dataset.paused === '1');
    btnPause.dataset.paused = next ? '1' : '0';
    btnPause.textContent = next ? '恢复刷新' : '暂停刷新';
    btnPause.classList.toggle('active', next);
    api.togglePauseRefresh(next);
  };
  btnReset.onclick = () => api.resetToDefault(state.currentRoomId, state.currentSubPage);
  btnManage.onclick = () => api.openRoomManager();

  // —— 弹幕独立窗口 V1.34: HTTP 直连 ——
  let danmakuOn = false;
  btnDanmaku.onclick = () => {
    api.switchSubPage('_toggle_danmaku');
  };

  // —— 日报按钮 ——
  btnScrapeReport.onclick = async () => {
    btnScrapeReport.disabled = true;
    reportStatus.textContent = '正在抓取直播大屏数据...';
    reportStatus.style.color = '#00E5C0';
    try {
      const result = await api.generateReport(state.currentRoomId);
      if (result.error) {
        reportEditor.value = '错误：' + result.error;
        reportStatus.textContent = '抓取失败';
        reportStatus.style.color = '#EF4444';
      } else {
        reportEditor.value = result.report;
        reportStatus.textContent = '生成完成 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
        reportStatus.style.color = '#00E5C0';
      }
    } catch (e) {
      reportEditor.value = '异常：' + (e.message || '未知错误');
      reportStatus.textContent = '异常';
      reportStatus.style.color = '#EF4444';
    }
    btnScrapeReport.disabled = false;
  };
  // 抓取用户画像（需先在「直播大屏」内切换到「人群」标签页）
  btnScrapeProfile.onclick = async () => {
    btnScrapeProfile.disabled = true;
    reportStatus.textContent = '正在从人群页抓取画像...';
    reportStatus.style.color = '#00E5C0';
    try {
      const res = await api.scrapeProfile(state.currentRoomId);
      if (res.error) {
        reportStatus.textContent = res.error;
        reportStatus.style.color = '#EF4444';
      } else {
        reportStatus.textContent = '画像已抓取，点击「生成日报」更新日报';
        reportStatus.style.color = '#00E5C0';
        // 房间配置已自动更新，下次生成日报会包含新画像
      }
    } catch (e) {
      reportStatus.textContent = '异常：' + (e.message || '');
      reportStatus.style.color = '#EF4444';
    }
    btnScrapeProfile.disabled = false;
  };
  btnCopyReport.onclick = async () => {
    const text = reportEditor.value;
    if (!text.trim()) return;
    try {
      await api.copyReport(text);
      reportStatus.textContent = '已复制到剪贴板';
      reportStatus.style.color = '#00E5C0';
    } catch (e) {
      reportStatus.textContent = '复制失败';
      reportStatus.style.color = '#EF4444';
    }
    setTimeout(() => { if (reportStatus.textContent.includes('已复制') || reportStatus.textContent === '复制失败') reportStatus.textContent = ''; }, 2000);
  };
  btnSaveReport.onclick = async () => {
    const text = reportEditor.value;
    if (!text.trim()) return;
    try {
      const res = await api.saveReport(state.currentRoomId, text);
      if (res.ok) {
        reportStatus.textContent = '已保存到历史';
        reportStatus.style.color = '#00E5C0';
      } else {
        reportStatus.textContent = '保存失败：' + (res.error || '未知');
        reportStatus.style.color = '#EF4444';
      }
    } catch (e) {
      reportStatus.textContent = '保存异常';
      reportStatus.style.color = '#EF4444';
    }
    setTimeout(() => { if (reportStatus.textContent.includes('已保存') || reportStatus.textContent.includes('保存失败') || reportStatus.textContent === '保存异常') reportStatus.textContent = ''; }, 2000);
  };

  // —— 主进程推送 ——
  api.onStateUpdate(s => {
    const prevRoom = state ? state.currentRoomId : null;
    state = s;
    // 切换房间时清空日报编辑器
    if (prevRoom && prevRoom !== s.currentRoomId) {
      reportEditor.value = '';
      reportStatus.textContent = '';
    }
    render();
    // 加载进度条
    if (s.loading && s.loading.roomId === s.currentRoomId && s.loading.subPage === s.currentSubPage) {
      loadingBar.classList.toggle('loading', !!s.loading.loading);
    } else {
      loadingBar.classList.remove('loading');
    }
  });
  api.onNewMessage(({ roomId, count }) => {
    // 用户当前在该房间的私信页时跳过计数和通告（避免反馈循环）
    if (state && state.currentRoomId === roomId && state.currentSubPage === 'privateMsg') {
      return;
    }
    msgCounts[roomId] = (msgCounts[roomId] || 0) + (count || 1);
    renderSidebar();
    showToast(roomId, count || 1);
  });
  api.onRefreshPaused(paused => {
    btnPause.dataset.paused = paused ? '1' : '0';
    btnPause.textContent = paused ? '恢复刷新' : '暂停刷新';
    btnPause.classList.toggle('active', paused);
  });
  api.onNetworkStatus(({ online }) => {
    netStatus.textContent = online ? '网络正常' : '网络断开';
    netStatus.className = 'net ' + (online ? 'online' : 'offline');
  });

  // V1.10 自动日报通知
  api.onAutoReportDone(({ roomId, time, report }) => {
    const room = state ? state.liveRooms.find(r => r.id === roomId) : null;
    const label = room ? room.label : roomId;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = '<div class="toast-title">' + label + ' · 自动日报</div><div class="toast-body">' + time + ' 已生成</div>';
    toastContainer.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; setTimeout(() => toast.remove(), 250); }, 4000);
    // 如果当前正在该房间的日报页，自动刷新
    if (state && state.currentRoomId === roomId && state.currentSubPage === 'report') {
      reportEditor.value = report;
      reportStatus.textContent = '自动更新 ' + time;
      reportStatus.style.color = '#00E5C0';
    }
  });

  // 渲染进程侧网络状态（主进程 onLine 事件补充）
  window.addEventListener('online', () => {
    netStatus.textContent = '网络正常';
    netStatus.className = 'net online';
  });
  window.addEventListener('offline', () => {
    netStatus.textContent = '网络断开';
    netStatus.className = 'net offline';
  });
  // 暴露测试入口：在 DevTools Console 输入 __testToast() 可手动触发通告
  window.__testToast = () => {
    const rid = state ? state.currentRoomId : 'live1';
    const cnt = Math.floor(Math.random() * 5) + 1;
    api.testNewMessage(rid, cnt);
  };

  // V1.22 日报倒计时（每秒更新）
  setInterval(() => {
    if (!state || !state.nextReportTime) { reportCd.innerHTML = ''; return; }
    const ms = state.nextReportTime - Date.now();
    if (ms <= 0) { reportCd.innerHTML = '<span class="time">抓取中...</span>'; return; }
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    reportCd.innerHTML = '下次日报: <span class="time">' + min + ':' + String(sec).padStart(2, '0') + '</span>';
  }, 1000);
})();
