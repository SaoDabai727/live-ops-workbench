// reportScheduler.js — 定时自动抓取日报（V1.10）
// 每小时自动拉取每房间 KPI 数据，含失败重试 + 数据缓存

const { generateReport } = require('./reportManager');
const { getDefaultUrl } = require('./config');
const { shouldNavigateDaping, parseLiveRoomId, isPlaceholderRoomId } = require('./compassUrl');
const debugLog = require('./debugLog');

const INTERVAL_MS = 60 * 60 * 1000;      // 每小时
const RETRY_DELAY_MS = 5 * 60 * 1000;    // 失败后 5 分钟重试
const MAX_RETRIES = 3;

function createReportScheduler({ factory, config, saveReport, mainWindow }) {
  let timer = null;
  let paused = false;
  let lastRunTime = null;
  let nextRunTime = null;
  const retryState = new Map();
  let onTick = null;

  async function runForRoom(roomId) {
    const roomCfg = config.liveRooms.find(r => r.id === roomId);
    if (!roomCfg) return;

    // 后台抓取：专用 scrape 视图，绝不碰用户正在看的大屏保活实例
    let dapingView;
    try {
      dapingView = factory.getOrCreateScrapeView
        ? factory.getOrCreateScrapeView(roomId, 'daping')
        : factory.getOrCreateHiddenView(roomId, 'daping');
      const expectedUrl = getDefaultUrl(roomId, 'daping');
      const currentUrl = dapingView.webContents.getURL();
      const expectedId = parseLiveRoomId(expectedUrl);

      if (!expectedUrl || expectedUrl === 'about:blank' || isPlaceholderRoomId(expectedId)) {
        debugLog.log('[Scheduler] 跳过导航：房间缺少有效 live_room_id roomId=' + roomId);
      } else if (shouldNavigateDaping(currentUrl, expectedUrl)) {
        debugLog.log('[Scheduler] scrape 导航 roomId=' + roomId + ' -> ' + expectedUrl.slice(0, 120));
        try {
          dapingView.webContents.loadURL(expectedUrl);
          await new Promise((resolve) => {
            const settle = () => { clearTimeout(t); resolve(); };
            const t = setTimeout(settle, 25000);
            dapingView.webContents.once('did-finish-load', settle);
            dapingView.webContents.once('did-fail-load', settle);
          });
        } catch (e) {}
      } else {
        debugLog.log('[Scheduler] 复用已有大屏 URL roomId=' + roomId + ' live_room_id=' + parseLiveRoomId(currentUrl));
      }
    } catch (e) {
      debugLog.log('[Scheduler] 创建 daping 视图失败 roomId=' + roomId + ': ' + e.message);
      scheduleRetry(roomId);
      return;
    }

    const result = await generateReport({
      view: dapingView,
      roomCfg,
      factory,
      roomId
    });

    if (result.report && !result.error) {
      saveReport(roomId, result.report);
      retryState.delete(roomId);
      debugLog.log('[Scheduler] 自动日报成功 roomId=' + roomId + ' matched=' + Object.keys(result.kpi).filter(k => result.kpi[k]).length);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auto-report-done', {
          roomId,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          report: result.report
        });
      }
    } else {
      const err = result.error || '未知错误';
      debugLog.log('[Scheduler] 自动日报失败 roomId=' + roomId + ': ' + err);
      scheduleRetry(roomId);
    }
  }

  function scheduleRetry(roomId) {
    const s = retryState.get(roomId) || { retries: 0, timer: null };
    if (s.timer) clearTimeout(s.timer);
    s.retries++;
    if (s.retries > MAX_RETRIES) {
      debugLog.log('[Scheduler] 重试耗尽 roomId=' + roomId + ' maxRetries=' + MAX_RETRIES);
      retryState.delete(roomId);
      return;
    }
    debugLog.log('[Scheduler] 安排重试 roomId=' + roomId + ' attempt=' + s.retries + '/' + MAX_RETRIES);
    s.timer = setTimeout(() => {
      retryState.delete(roomId);
      runForRoom(roomId);
    }, RETRY_DELAY_MS);
    retryState.set(roomId, s);
  }

  async function runAll() {
    if (paused) return;
    debugLog.log('[Scheduler] 定时抓取开始...');
    lastRunTime = Date.now();
    nextRunTime = lastRunTime + INTERVAL_MS;
    if (onTick) onTick(nextRunTime);
    for (const room of config.liveRooms) {
      if (room.autoReport === false) continue;
      await runForRoom(room.id);
    }
    debugLog.log('[Scheduler] 定时抓取完成');
  }

  function start() {
    stop();
    debugLog.log('[Scheduler] 启动，间隔=' + (INTERVAL_MS / 60000) + '分钟');
    nextRunTime = Date.now() + 30000;
    if (onTick) onTick(nextRunTime);
    setTimeout(() => runAll(), 30000);
    timer = setInterval(runAll, INTERVAL_MS);
  }

  function getNextRunMs() { return nextRunTime ? Math.max(0, nextRunTime - Date.now()) : 0; }
  function setOnTick(fn) { onTick = fn; }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    retryState.forEach(s => { if (s.timer) clearTimeout(s.timer); });
    retryState.clear();
  }

  function setPaused(p) { paused = !!p; }

  return { start, stop, setPaused, getNextRunMs, setOnTick };
}

module.exports = { createReportScheduler };
