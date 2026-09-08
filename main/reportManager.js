// reportManager.js — 日报编排器 + 画像独立抓取
// KPI 和用户画像分离抓取（画像来自 compass 大屏「人群」二级标签页）

const { executeScrape } = require('./reportScraper');
const { normalizeKpi, formatReport, parseProfileText, isLoginPageText } = require('./reportGenerator');
const debugLog = require('./debugLog');

const DAPING = 'daping';

/** 确保 daping 视图存在且可用（优先已打开/保活的页，避免再开一整份 Chromium） */
async function ensureDapingView(factory, roomId, providedView = null) {
  let view = providedView;
  let ephemeral = false;
  if (!view || view.webContents.isDestroyed()) {
    view = factory.findView ? factory.findView(roomId, DAPING) : null;
  }
  if (!view || view.webContents.isDestroyed()) {
    view = factory.getCurrentView && factory.getCurrentView();
  }
  if (!view || view.webContents.isDestroyed()) {
    view = factory.createView(roomId, DAPING);
    ephemeral = true;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('加载超时')), 30000);
        view.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      });
    } catch (e) {
      if (factory.releaseEphemeralView) factory.releaseEphemeralView(view);
      throw e;
    }
  }
  if (view.webContents.isLoading()) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 20000);
      const check = setInterval(() => {
        if (!view.webContents.isLoading()) { clearInterval(timer); clearInterval(check); resolve(); }
      }, 200);
    });
  }
  return { view, ephemeral };
}

/**
 * 抓取 KPI + 组装日报（不含画像，画像来自房间配置）
 */
async function generateReport({ view, roomCfg, factory, roomId }) {
  let ephemeral = false;
  try {
    const ensured = await ensureDapingView(factory, roomId, view);
    view = ensured.view;
    ephemeral = ensured.ephemeral;
  } catch (e) {
    return { report: '', kpi: {}, error: '直播大屏视图创建失败：' + e.message };
  }

  const release = () => {
    if (ephemeral && factory && factory.releaseEphemeralView) factory.releaseEphemeralView(view);
  };

  try {
    const raw = await executeScrape(view, 'combined', 35000);
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
  } catch (e) {
    return { report: '', kpi: {}, error: '抓取失败：' + e.message };
  } finally {
    release();
  }
}

/**
 * 单独抓取「看播核心用户画像」（需用户先将 daping 切换到人群标签页）
 */
async function scrapeProfile({ view, factory, roomId }) {
  let ephemeral = false;
  try {
    const ensured = await ensureDapingView(factory, roomId, view);
    view = ensured.view;
    ephemeral = ensured.ephemeral;
  } catch (e) {
    return { profile: '', error: '视图创建失败：' + e.message };
  }

  try {
    const raw = await executeScrape(view, 'profile', 10000);
    const rawText = raw.profileText || '';
    const parsed = parseProfileText(rawText);
    if (parsed) {
      debugLog.log('[reportManager] 画像抓取成功 roomId=' + roomId + ' tags=' + parsed.split('\n').length);
      if (ephemeral && factory.releaseEphemeralView) factory.releaseEphemeralView(view);
      return { profile: parsed, error: null };
    }
    // 未解析到标签，返回原始文本
    const clean = rawText.replace(/看播核心用户画像/g, '').trim();
    if (clean.length > 10) {
      if (ephemeral && factory.releaseEphemeralView) factory.releaseEphemeralView(view);
      return { profile: clean, error: null };
    }
    if (ephemeral && factory.releaseEphemeralView) factory.releaseEphemeralView(view);
    return { profile: '', error: '未检测到画像数据。\n\n请确认已在「直播大屏」内切换到「人群」标签页，\n等待数据加载完成后再抓取。' };
  } catch (e) {
    if (ephemeral && factory.releaseEphemeralView) factory.releaseEphemeralView(view);
    return { profile: '', error: '画像抓取失败：' + e.message };
  }
}

module.exports = { generateReport, scrapeProfile };
