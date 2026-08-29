// renderer.js — UI 逻辑：左侧直播间标签、顶部二级功能标签、全局工具栏
// 通过 window.workbench（preload 桥接）与主进程通信
(function () {
  const api = window.workbench;
  const sidebar = document.getElementById('sidebar');
  const sidebarRooms = document.getElementById('sidebar-rooms') || sidebar;
  const tabbar = document.getElementById('tabbar');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');
  const btnManage = document.getElementById('btn-manage');
  const netStatus = document.getElementById('net-status');
  const loadingBar = document.getElementById('loading-bar');
  const toastContainer = document.getElementById('toast-container');
  const btnQuickReport = document.getElementById('btn-quick-report');
  const btnExplainPanel = document.getElementById('btn-explain-panel');
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

  const loginHealthBanner = document.getElementById('login-health-banner');
  const loginHealthText = document.getElementById('login-health-text');
  const btnLoginHealthDismiss = document.getElementById('btn-login-health-dismiss');
  let loginHealthDismissedKey = '';

  function renderLoginHealth() {
    if (!loginHealthBanner) return;
    const health = state && state.loginHealth;
    const warnings = (health && health.warnings) || [];
    const currentRoomId = state && state.currentRoomId;
    const relevant = warnings.filter(w => w.roomId === currentRoomId);
    if (!relevant.length) {
      loginHealthBanner.hidden = true;
      return;
    }
    const key = relevant.map(w => w.roomId + ':' + w.subPage).join('|');
    if (key === loginHealthDismissedKey) {
      loginHealthBanner.hidden = true;
      return;
    }
    const names = relevant.map(w => w.subLabel || w.subPage).join('、');
    const roomLabel = relevant[0].label || currentRoomId;
    loginHealthText.textContent = '「' + roomLabel + '」的 ' + names + ' 疑似未登录或登录失效，请先扫码登录后再抓取日报。';
    loginHealthBanner.hidden = false;
  }

  if (btnLoginHealthDismiss) {
    btnLoginHealthDismiss.addEventListener('click', () => {
      const health = state && state.loginHealth;
      const warnings = (health && health.warnings) || [];
      const relevant = warnings.filter(w => w.roomId === (state && state.currentRoomId));
      loginHealthDismissedKey = relevant.map(w => w.roomId + ':' + w.subPage).join('|');
      loginHealthBanner.hidden = true;
      if (typeof scheduleLayoutReport === 'function') scheduleLayoutReport();
    });
  }

  function render() {
    if (!state) return;
    renderSidebar();
    renderTabbar();
    renderReportPanel();
    renderLoginHealth();
  }

  function renderReportPanel() {
    const isReport = state.currentSubPage === 'report';
    reportPanel.style.display = isReport ? 'flex' : 'none';
    // 切换时恢复上次日报
    if (isReport && state.lastReport && !reportEditor.value) {
      reportEditor.value = state.lastReport;
    }
    // 工具栏按钮：report 页隐藏刷新/暂停/复位；非巨量百应隐藏讲解面板
    const isReportPage = state.currentSubPage === 'report';
    const isJuliang = state.currentSubPage === 'juliang';
    btnRefresh.style.display = isReportPage ? 'none' : '';
    btnPause.style.display = isReportPage ? 'none' : '';
    btnReset.style.display = isReportPage ? 'none' : '';
    if (btnExplainPanel) btnExplainPanel.style.display = isJuliang ? '' : 'none';
  }


  function fitSidebarWidth() {
    // 按最长房间名自动调宽（108–260），避免固定宽度截断或留白过多
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font:500 13px "Segoe UI","PingFang SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif';
    document.body.appendChild(probe);
    let maxText = 0;
    state.liveRooms.forEach((room) => {
      probe.textContent = room.label || '';
      maxText = Math.max(maxText, probe.offsetWidth);
    });
    probe.textContent = '直播间';
    const headLabelW = probe.offsetWidth;
    probe.remove();
    // 左右内边距 + 左边框 + 角标预留 + 标题区计数徽标
    const chrome = 14 + 12 + 3 + 8 + 32;
    const headChrome = 14 + 14 + 28;
    const next = Math.min(260, Math.max(108, Math.max(maxText + chrome, headLabelW + headChrome)));
    sidebar.style.setProperty('--sidebar-w', next + 'px');
    if (typeof scheduleLayoutReport === 'function') scheduleLayoutReport();
  }

  function renderSidebar() {
    sidebarRooms.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sidebar-head';
    head.innerHTML = '<span class="sidebar-label">直播间</span><span class="sidebar-count">' + state.liveRooms.length + '</span>';
    sidebarRooms.appendChild(head);

    state.liveRooms.forEach(room => {
      const el = document.createElement('div');
      el.className = 'room-item' + (room.id === state.currentRoomId ? ' active' : '');
      const name = document.createElement('span');
      name.className = 'room-name';
      name.textContent = room.label;
      el.appendChild(name);
      const cnt = msgCounts[room.id] || 0;
      if (cnt > 0) {
        const badge = document.createElement('span');
        badge.className = 'room-badge';
        badge.textContent = cnt > 99 ? '99+' : String(cnt);
        el.appendChild(badge);
      }
      el.onclick = () => api.switchRoom(room.id);
      sidebarRooms.appendChild(el);
    });
    requestAnimationFrame(fitSidebarWidth);
  }

  function renderTabbar() {
    tabbar.innerHTML = '';
    Object.entries(state.subPages).forEach(([key, cfg]) => {
      const el = document.createElement('div');
      el.className = 'tab-item' + (key === state.currentSubPage ? ' active' : '');
      el.textContent = cfg.label;
      el.onclick = () => {
        // 飞书文档类：首次进入需填写链接
        if (cfg.kind === 'feishuDoc') {
          const urlKey = `${state.currentRoomId}_${key}`;
          const hasUrl = state.customUrls && state.customUrls[urlKey];
          if (!hasUrl) {
            api.openUrlPrompt(state.currentRoomId, key);
            return;
          }
        }
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
      tabbar.appendChild(el);
    });
  }

  // —— 工具栏 ——
  btnQuickReport.onclick = () => {
    // 快捷入口：切到直播日报子页（用户自行点击「生成日报」）
    api.switchSubPage('report');
  };
  if (btnExplainPanel) {
    btnExplainPanel.onclick = async () => {
      if (!api.forceExplainPanel) return;
      btnExplainPanel.disabled = true;
      try {
        const res = await api.forceExplainPanel();
        if (!res || !res.ok) {
          alert((res && res.message) || '无法打开讲解面板');
        }
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        btnExplainPanel.disabled = false;
      }
    };
  }
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

  // —— 日报按钮 ——
  btnScrapeReport.onclick = async () => {
    btnScrapeReport.disabled = true;
    reportStatus.textContent = '正在抓取直播大屏数据...';
    reportStatus.style.color = '#E8873A';
    try {
      const result = await api.generateReport(state.currentRoomId);
      if (result.error) {
        reportEditor.value = '错误：' + result.error;
        reportStatus.textContent = '抓取失败';
        reportStatus.style.color = '#EF4444';
      } else {
        reportEditor.value = result.report;
        reportStatus.textContent = '生成完成 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
        reportStatus.style.color = '#E8873A';
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
    reportStatus.style.color = '#E8873A';
    try {
      const res = await api.scrapeProfile(state.currentRoomId);
      if (res.error) {
        reportStatus.textContent = res.error;
        reportStatus.style.color = '#EF4444';
      } else {
        reportStatus.textContent = '画像已抓取，点击「生成日报」更新日报';
        reportStatus.style.color = '#E8873A';
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
      reportStatus.style.color = '#E8873A';
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
        reportStatus.style.color = '#E8873A';
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
    // 切换房间时清空日报编辑器，并重置登录提示关闭状态
    if (prevRoom && prevRoom !== s.currentRoomId) {
      reportEditor.value = '';
      reportStatus.textContent = '';
      loginHealthDismissedKey = '';
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

  // —— 版本号 + 侧栏底部云端升级 ——
  const titleEl = document.querySelector('#toolbar .title');
  const btnCheckUpdate = document.getElementById('btn-check-update');
  const updateBanner = document.getElementById('update-banner');
  const updateIcon = document.getElementById('update-banner-icon');
  const updateText = document.getElementById('update-banner-text');
  const updateMeta = document.getElementById('update-banner-meta');
  const updateAction = document.getElementById('btn-update-action');
  const updateDismiss = document.getElementById('btn-update-dismiss');
  const updateProgressWrap = document.getElementById('update-progress-wrap');
  const updateProgressBar = document.getElementById('update-progress-bar');
  const updateProgressPct = document.getElementById('update-progress-pct');
  let updateDismissed = false;
  let updateHideTimer = null;

  function setAppTitle(version) {
    const label = version ? ('直播运营助手 v' + version) : '直播运营助手';
    if (titleEl) titleEl.textContent = label;
    document.title = label;
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v.toFixed(0) + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB';
    return (v / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function formatSpeed(bps) {
    return formatBytes(bps) + '/s';
  }

  function clearUpdateHideTimer() {
    if (updateHideTimer) {
      clearTimeout(updateHideTimer);
      updateHideTimer = null;
    }
  }

  function syncUpdateFooter(showBanner) {
    if (btnCheckUpdate) btnCheckUpdate.hidden = !!showBanner;
    if (updateBanner) updateBanner.hidden = !showBanner;
  }

  function scheduleUpdateHide(ms) {
    clearUpdateHideTimer();
    updateHideTimer = setTimeout(() => {
      updateHideTimer = null;
      syncUpdateFooter(false);
    }, ms);
  }

  function setUpdateMeta(text, show) {
    if (!updateMeta) return;
    if (!show || !text) {
      updateMeta.hidden = true;
      updateMeta.textContent = '';
      return;
    }
    updateMeta.hidden = false;
    updateMeta.textContent = text;
  }

  function setBannerTone(tone) {
    if (!updateBanner) return;
    updateBanner.classList.remove('is-error', 'is-ok', 'is-checking');
    if (tone) updateBanner.classList.add(tone);
  }

  function renderUpdateBanner(s) {
    if (!s || !updateBanner) return;
    const sticky = s.status === 'downloading' || s.status === 'downloaded' || s.status === 'checking';
    if (updateDismissed && !sticky && s.status !== 'available') {
      syncUpdateFooter(false);
      return;
    }

    clearUpdateHideTimer();
    updateProgressWrap.hidden = true;
    updateAction.hidden = false;
    updateAction.disabled = false;
    updateDismiss.hidden = false;
    updateDismiss.textContent = '稍后';
    if (updateIcon) updateIcon.textContent = '↑';

    if (s.status === 'checking') {
      updateDismissed = false;
      syncUpdateFooter(true);
      setBannerTone('is-checking');
      if (updateIcon) updateIcon.textContent = '↻';
      updateText.textContent = '正在检查更新…';
      setUpdateMeta('当前 v' + (s.currentVersion || ''), true);
      updateAction.hidden = true;
      updateDismiss.textContent = '隐藏';
    } else if (s.status === 'available') {
      updateDismissed = false;
      syncUpdateFooter(true);
      setBannerTone('');
      updateText.textContent = '发现新版本 v' + s.version;
      setUpdateMeta('当前 v' + s.currentVersion + ' → v' + s.version, true);
      updateAction.textContent = '立即下载';
      updateAction.dataset.act = 'download';
      updateDismiss.textContent = '稍后';
    } else if (s.status === 'downloading') {
      updateDismissed = false;
      syncUpdateFooter(true);
      setBannerTone('');
      const pct = Math.max(0, Math.min(100, s.percent || 0));
      updateProgressWrap.hidden = false;
      updateProgressBar.style.width = pct.toFixed(1) + '%';
      if (updateProgressPct) updateProgressPct.textContent = Math.floor(pct) + '%';
      updateText.textContent = '正在下载 v' + (s.version || '');
      const parts = [];
      if (s.total > 0) parts.push(formatBytes(s.transferred) + ' / ' + formatBytes(s.total));
      if (s.bytesPerSecond > 0) parts.push(formatSpeed(s.bytesPerSecond));
      setUpdateMeta(parts.join(' · ') || '连接中…', true);
      updateAction.hidden = true;
      updateDismiss.hidden = true;
    } else if (s.status === 'downloaded') {
      updateDismissed = false;
      syncUpdateFooter(true);
      setBannerTone('is-ok');
      if (updateIcon) updateIcon.textContent = '✓';
      updateText.textContent = 'v' + s.version + ' 已就绪';
      setUpdateMeta('重启后完成安装', true);
      updateAction.textContent = '立即重启安装';
      updateAction.dataset.act = 'install';
      updateDismiss.textContent = '稍后重启';
    } else if (s.status === 'not-available') {
      syncUpdateFooter(true);
      setBannerTone('is-ok');
      if (updateIcon) updateIcon.textContent = '✓';
      updateText.textContent = '已是最新版本';
      setUpdateMeta('当前 v' + (s.currentVersion || ''), true);
      updateAction.hidden = true;
      updateDismiss.textContent = '知道了';
      scheduleUpdateHide(3200);
    } else if (s.status === 'error' && s.error) {
      syncUpdateFooter(true);
      setBannerTone('is-error');
      if (updateIcon) updateIcon.textContent = '!';
      updateText.textContent = '更新失败';
      setUpdateMeta(String(s.error).slice(0, 120), true);
      updateAction.textContent = '重试';
      updateAction.dataset.act = 'check';
      updateDismiss.textContent = '关闭';
    } else {
      syncUpdateFooter(false);
    }
    // 侧栏宽度变化时同步内容区（一般不影响高度，仍保险上报）
    requestAnimationFrame(() => {
      if (typeof scheduleLayoutReport === 'function') scheduleLayoutReport();
    });
  }

  if (btnCheckUpdate) {
    btnCheckUpdate.onclick = () => {
      updateDismissed = false;
      btnCheckUpdate.disabled = true;
      api.checkUpdate().finally(() => { btnCheckUpdate.disabled = false; });
    };
  }
  updateAction.onclick = () => {
    const act = updateAction.dataset.act;
    updateAction.disabled = true;
    if (act === 'download') api.downloadUpdate();
    else if (act === 'install') api.installUpdate();
    else api.checkUpdate().finally(() => { updateAction.disabled = false; });
  };
  updateDismiss.onclick = () => {
    updateDismissed = true;
    clearUpdateHideTimer();
    syncUpdateFooter(false);
    if (api.dismissUpdate) api.dismissUpdate();
    requestAnimationFrame(() => {
      if (typeof scheduleLayoutReport === 'function') scheduleLayoutReport();
    });
  };

  if (api.getAppInfo) {
    api.getAppInfo().then((info) => {
      if (info && info.version) setAppTitle(info.version);
      if (info && info.updater) renderUpdateBanner(info.updater);
    }).catch(() => {});
  }
  if (api.onUpdaterStatus) api.onUpdaterStatus(renderUpdateBanner);

  // —— BrowserView 内容区自适应：按 #content-slot 实测尺寸上报 ——
  const contentSlot = document.getElementById('content-slot');
  const mainEl = document.getElementById('main');
  let layoutRaf = 0;
  function reportLayoutBounds() {
    if (!api.reportLayoutBounds) return;
    const el = contentSlot || mainEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 槽位尚未完成布局时跳过，避免上报 0 尺寸
    if (rect.width < 40 || rect.height < 40) return;
    api.reportLayoutBounds({
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    });
  }
  function scheduleLayoutReport() {
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      reportLayoutBounds();
      // 再补一帧，覆盖 maximize 后的二次回流
      requestAnimationFrame(reportLayoutBounds);
    });
  }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(scheduleLayoutReport);
    if (contentSlot) ro.observe(contentSlot);
    if (mainEl) ro.observe(mainEl);
    ro.observe(document.documentElement);
  }
  window.addEventListener('resize', scheduleLayoutReport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleLayoutReport);
    window.visualViewport.addEventListener('scroll', scheduleLayoutReport);
  }
  if (api.onLayoutSync) api.onLayoutSync(scheduleLayoutReport);
  api.onStateUpdate(() => scheduleLayoutReport());
  [0, 50, 150, 400, 1000].forEach((ms) => setTimeout(reportLayoutBounds, ms));
})();
