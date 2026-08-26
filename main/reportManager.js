// reportManager.js — 日报编排器 + 画像独立抓取
// KPI 和用户画像分离抓取（画像来自 compass 大屏「人群」二级标签页）

const { executeScrape } = require('./reportScraper');
const { normalizeKpi, formatReport, parseProfileText, isLoginPageText } = require('./reportGenerator');
const debugLog = require('./debugLog');

const DAPING = 'daping';

/** 确保 daping 视图存在且可用（V1.25：优先用传入视图，回退 getCurrentView） */
async function ensureDapingView(factory, roomId, providedView = null) {
  let view = providedView;
  if (!view || view.webContents.isDestroyed()) {
    view = factory.getCurrentView();
  }
  if (!view || view.webContents.isDestroyed()) {
    view = factory.createView(roomId, DAPING);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('加载超时')), 30000);
      view.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
    });
  }
  if (view.webContents.isLoading()) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 20000);
      const check = setInterval(() => {
        if (!view.webContents.isLoading()) { clearInterval(timer); clearInterval(check); resolve(); }
      }, 200);
    });
  }
  return view;
}

/**
 * 抓取 KPI + 组装日报（不含画像，画像来自房间配置）
 */
async function generateReport({ view, roomCfg, factory, roomId }) {
  try {
    view = await ensureDapingView(factory, roomId, view);
  } catch (e) {
    return { report: '', kpi: {}, error: '直播大屏视图创建失败：' + e.message };
  }

  // 抓取 KPI + 画像（一键合并：先取 KPI，再自动切到人群标签页抓画像）
  let raw;
  try {
    raw = await executeScrape(view, 'combined', 35000);
  } catch (e) {
    return { report: '', kpi: {}, error: '抓取失败：' + e.message };
  }

  const pageText = raw.pageText || '';
  if (isLoginPageText(pageText)) {
    return {
      report: '', kpi: {},
      error: '检测到登录页面。\n\n请先切换到「直播大屏」子页，在页面内完成扫码登录，\n然后再回到「直播日报」点击"生成日报"。'
    };
  }
  if (!pageText || pageText.length < 50) {
    return { report: '', kpi: {}, error: '页面内容为空或未加载完成，请检查直播大屏' };
  }

  const kpi = normalizeKpi(raw);

  // 用户画像：优先用抓取结果，其次用房间配置
  let profileText = '';
  if (raw.profileText) {
    profileText = parseProfileText(raw.profileText) || raw.profileText.replace(/看播核心用户画像/g, '').trim();
  }
  if (!profileText) {
    profileText = roomCfg.userProfileText || roomCfg.user_profile_text || '';
  }

  const report = formatReport({
    roomCfg, kpi,
    userProfile: profileText,
    liveDuration: roomCfg.liveDuration || roomCfg.live_duration || null,
    roomId
  });

  debugLog.log('[reportManager] KPI 日报生成 roomId=' + roomId + ' matched=' + Object.keys(kpi).filter(k => kpi[k]).length);
  return { report, kpi, profile: profileText, error: null };
}

/**
 * 单独抓取「看播核心用户画像」（需用户先将 daping 切换到人群标签页）
 */
async function scrapeProfile({ view, factory, roomId }) {
  try {
    view = await ensureDapingView(factory, roomId, view);
  } catch (e) {
    return { profile: '', error: '视图创建失败：' + e.message };
  }

  try {
    const raw = await executeScrape(view, 'profile', 10000);
    const rawText = raw.profileText || '';
    const parsed = parseProfileText(rawText);
    if (parsed) {
      debugLog.log('[reportManager] 画像抓取成功 roomId=' + roomId + ' tags=' + parsed.split('\n').length);
      return { profile: parsed, error: null };
    }
    // 未解析到标签，返回原始文本
    const clean = rawText.replace(/看播核心用户画像/g, '').trim();
    if (clean.length > 10) {
      return { profile: clean, error: null };
    }
    return { profile: '', error: '未检测到画像数据。\n\n请确认已在「直播大屏」内切换到「人群」标签页，\n等待数据加载完成后再抓取。' };
  } catch (e) {
    return { profile: '', error: '画像抓取失败：' + e.message };
  }
}

module.exports = { generateReport, scrapeProfile };
