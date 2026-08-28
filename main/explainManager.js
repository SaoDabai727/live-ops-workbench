// explainManager.js — 向匹配域名的 BrowserView 主帧/子帧注入「自动点讲解」
const debugLog = require('./debugLog');
const { getInjectSource, getForceShowTail } = require('./explainClickerInject');

const HOST_RE = /(^|\.)(jinritemai|douyin|douyinec)\.com$/i;

function hostMatches(url) {
  if (!url || typeof url !== 'string') return false;
  if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('chrome-error:')) return false;
  try {
    return HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function collectFrames(webContents) {
  const frames = [];
  try {
    const main = webContents.mainFrame;
    if (!main) return frames;
    frames.push(main);
    const tree = main.framesInSubtree;
    if (tree && typeof tree[Symbol.iterator] === 'function') {
      for (const f of tree) {
        if (f && f !== main) frames.push(f);
      }
    }
  } catch (e) {
    debugLog.log('[explain] collectFrames failed: ' + (e && e.message));
  }
  return frames;
}

function buildSource(force) {
  return getInjectSource() + (force ? getForceShowTail() : '');
}

/**
 * 向视图内所有匹配 host 的帧注入脚本。
 * @returns {{ ok: boolean, injected: number, reason?: string, url?: string }}
 */
async function injectIntoView(view, { force = false } = {}) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    return { ok: false, injected: 0, reason: 'no-view' };
  }
  const wc = view.webContents;
  const topUrl = wc.getURL();
  const source = buildSource(force);
  let injected = 0;
  const frames = collectFrames(wc);

  if (frames.length) {
    for (const frame of frames) {
      try {
        const url = frame.url || '';
        if (!hostMatches(url)) continue;
        await frame.executeJavaScript(source, true);
        injected += 1;
      } catch (e) {
        debugLog.log('[explain] frame inject failed: ' + (e && e.message));
      }
    }
  }

  // 无帧树或帧注入全失败时，回退主 webContents（仅 top host 匹配）
  if (injected === 0 && hostMatches(topUrl)) {
    try {
      await wc.executeJavaScript(source, true);
      injected = 1;
    } catch (e) {
      debugLog.log('[explain] top inject failed: ' + (e && e.message));
      return { ok: false, injected: 0, reason: 'inject-failed', url: topUrl };
    }
  }

  if (injected === 0) {
    return {
      ok: false,
      injected: 0,
      reason: force ? 'host-mismatch' : 'host-mismatch',
      url: topUrl
    };
  }

  debugLog.log(`[explain] injected=${injected} force=${force} url="${String(topUrl).slice(0, 120)}"`);
  return { ok: true, injected, url: topUrl };
}

function attachExplainAutoClick(view) {
  if (!view || !view.webContents) return;
  const wc = view.webContents;
  if (wc.__explainAutoClickAttached) return;
  wc.__explainAutoClickAttached = true;

  const tryInject = () => {
    injectIntoView(view, { force: false }).catch(() => {});
  };

  wc.on('did-finish-load', tryInject);
  try {
    wc.on('did-frame-finish-load', (_event, isMainFrame) => {
      // 子帧也可能承载中控台商品列表
      if (!isMainFrame) tryInject();
    });
  } catch (e) {
    /* older Electron may lack the event */
  }
  wc.on('did-navigate-in-page', tryInject);
}

async function forceExplainPanel(view) {
  return injectIntoView(view, { force: true });
}

module.exports = {
  attachExplainAutoClick,
  forceExplainPanel,
  injectIntoView,
  hostMatches
};
