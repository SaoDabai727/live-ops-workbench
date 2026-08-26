// reportScraper.js — 移植自 A 的 dom_selectors.py
// 提供抓取 JS 脚本（v7 整页 innerText 策略）和对指定 BrowserView 执行抓取

const DEFAULT_SCRAPE_JS = `
(() => {
    return JSON.stringify({
        url: location.href,
        title: document.title,
        _jsver: "v7-unified",
        pageText: document.body.innerText,
    });
})()
`;

// 抓取用户画像：取"看播核心用户画像"区域的完整文本
const PROFILE_SCRAPE_JS = `
(() => {
    let scopeEl = null;
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
        const t = el.innerText || '';
        if (t.includes('看播核心用户画像') && t.length < 3000 && t.length > 20) {
            if (!scopeEl || t.length < scopeEl.innerText.length) {
                scopeEl = el;
            }
        }
    }
    const text = (scopeEl || document.body).innerText;
    return JSON.stringify({
        url: location.href,
        title: document.title,
        _jsver: "v7-unified",
        profileText: text,
    });
})()
`;

// 一键抓取：KPI + 自动切到人群标签页抓画像再切回
const COMBINED_SCRAPE_JS = `
(async () => {
    // 1. 先抓取当前页的 KPI 文本
    const kpiText = document.body.innerText;

    // 2. 查找并点击「人群」标签
    let profileText = '';
    const tabs = document.querySelectorAll('[class*="tab"], [class*="Tab"], [class*="menu"], [class*="Menu"], [role="tab"], [role="menuitem"]');
    let crowdTab = null;
    for (const tab of tabs) {
        if (tab.innerText && tab.innerText.includes('人群') && tab.innerText.length < 8) {
            crowdTab = tab;
            break;
        }
    }
    // 兜底：搜所有包含"人群"的元素，取最小的可点击元素
    if (!crowdTab) {
        const all = document.querySelectorAll('*');
        let best = null;
        for (const el of all) {
            const t = el.innerText || '';
            if (t.trim() === '人群' || (t.includes('人群') && t.length < 6)) {
                if (!best || el.offsetWidth < best.offsetWidth) best = el;
            }
        }
        crowdTab = best;
    }

    if (crowdTab) {
        crowdTab.click();
        // 等待人群页数据加载
        await new Promise(r => setTimeout(r, 2500));
        // 再等一下确认
        for (let i = 0; i < 10; i++) {
            if (document.body.innerText.includes('看播核心用户画像')) break;
            await new Promise(r => setTimeout(r, 500));
        }
        profileText = document.body.innerText;
    }

    return JSON.stringify({
        url: location.href,
        title: document.title,
        _jsver: "v7-combined",
        pageText: kpiText,
        profileText: profileText,
    });
})()
`;

/**
 * 对指定 BrowserView 执行抓取 JS，带超时。
 * @param {import('electron').BrowserView} view
 * @param {'kpi'|'profile'|'combined'} type
 * @param {number} timeoutMs - 超时（默认 15000ms，combined 30000ms）
 * @returns {Promise<object>} 抓取结果
 */
function executeScrape(view, type = 'kpi', timeoutMs = 15000) {
  const jsMap = { kpi: DEFAULT_SCRAPE_JS, profile: PROFILE_SCRAPE_JS, combined: COMBINED_SCRAPE_JS };
  const js = jsMap[type] || DEFAULT_SCRAPE_JS;
  const ms = type === 'combined' ? (timeoutMs >= 15000 ? timeoutMs : 30000) : timeoutMs;
  return new Promise((resolve, reject) => {
    if (!view || !view.webContents) {
      return reject(new Error('BrowserView 不存在或已销毁'));
    }
    if (view.webContents.isDestroyed()) {
      return reject(new Error('BrowserView webContents 已销毁'));
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('抓取超时'));
      }
    }, ms);

    view.webContents.executeJavaScript(js).then(result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // 兼容两种返回：dict 或 JSON 字符串
      if (typeof result === 'object' && result !== null) {
        resolve(result);
      } else if (typeof result === 'string') {
        try {
          resolve(JSON.parse(result));
        } catch (e) {
          reject(new Error('JS 返回非合法 JSON: ' + (result.slice(0, 80))));
        }
      } else {
        reject(new Error('JS 返回未知类型: ' + typeof result));
      }
    }).catch(err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('executeJavaScript 失败: ' + (err.message || err)));
    });
  });
}

module.exports = { DEFAULT_SCRAPE_JS, PROFILE_SCRAPE_JS, executeScrape };
