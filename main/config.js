// config.js — 统一配置层（移植自 A 的 config/ + B 的 config.js）
// 数据根：%APPDATA%/live-ops-workbench/config/
// 含：路径解析、配置读写、旧 A/B 配置迁移
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { isPlaceholderRoomId, isCompassLiveScreenUrl, parseLiveRoomId, syncRoomIdFromDailyUrl } = require('./compassUrl');
const { setKpiPatterns } = require('./reportGenerator');

// ====== 路径 ======
const IS_PACKAGED = app && app.isPackaged;

function configDir() {
  if (IS_PACKAGED) {
    return path.join(app.getPath('userData'), 'config');
  }
  return path.join(__dirname, '..', 'config');
}

function reportsDir() {
  const base = IS_PACKAGED ? app.getPath('userData') : path.join(__dirname, '..');
  return path.join(base, 'reports');
}

function logsDir() {
  const base = IS_PACKAGED ? app.getPath('userData') : path.join(__dirname, '..');
  return path.join(base, 'logs');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function saveJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

// ====== 配置加载 ======
function initConfig() {
  const userDir = configDir();
  const srcDir = path.join(__dirname, '..', 'config');
  ensureDir(userDir);
  ['rooms.json', 'subPages.json', 'kpiPatterns.json', 'customUrls.json'].forEach(f => {
    const dest = path.join(userDir, f);
    if (!fs.existsSync(dest)) {
      const src = path.join(srcDir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    }
  });
  // 打包升级后：把内置 subPages / kpiPatterns 的新增项合并进用户配置
  syncSubPagesFromBundle(srcDir, userDir);
  syncKpiPatternsFromBundle(srcDir, userDir);
}

function syncKpiPatternsFromBundle(srcDir, userDir) {
  const srcPath = path.join(srcDir, 'kpiPatterns.json');
  const destPath = path.join(userDir, 'kpiPatterns.json');
  if (!fs.existsSync(srcPath)) return;
  try {
    const bundled = loadJson(srcPath);
    if (!bundled) return;
    if (!fs.existsSync(destPath)) {
      saveJson(destPath, bundled);
      return;
    }
    const user = loadJson(destPath);
    if (!user) {
      saveJson(destPath, bundled);
      return;
    }
    // 用户未改或仍是旧单字符串结构时，用内置完整备选表覆盖
    const userGmv = user.scrape_regex && user.scrape_regex.gmv;
    const needsUpgrade = !user.version || typeof userGmv === 'string' || !Array.isArray(userGmv);
    if (needsUpgrade) {
      saveJson(destPath, bundled);
    }
  } catch (e) {}
}

function syncSubPagesFromBundle(srcDir, userDir) {
  const srcPath = path.join(srcDir, 'subPages.json');
  const destPath = path.join(userDir, 'subPages.json');
  if (!fs.existsSync(srcPath) || !fs.existsSync(destPath)) return;
  try {
    const bundled = loadJson(srcPath);
    const user = loadJson(destPath);
    if (!bundled || !bundled.subPages || !user || !user.subPages) return;
    let changed = false;
    Object.entries(bundled.subPages).forEach(([key, cfg]) => {
      if (!user.subPages[key]) {
        user.subPages[key] = cfg;
        changed = true;
      } else {
        // 同步标签与 kind（保留用户可能改过的 defaultUrl）
        if (cfg.label && user.subPages[key].label !== cfg.label) {
          user.subPages[key].label = cfg.label;
          changed = true;
        }
        if (cfg.kind && user.subPages[key].kind !== cfg.kind) {
          user.subPages[key].kind = cfg.kind;
          changed = true;
        }
        // 同步刷新策略（大屏禁止硬刷新等关键行为）
        if (typeof cfg.refreshInterval === 'number' && user.subPages[key].refreshInterval !== cfg.refreshInterval) {
          user.subPages[key].refreshInterval = cfg.refreshInterval;
          changed = true;
        }
      }
    });
    // 移除内置清单中已删除的子页（如误加的讲解台）
    Object.keys(user.subPages).forEach((key) => {
      if (!bundled.subPages[key] && (key === 'explain' || user.subPages[key].kind === 'explainDesk')) {
        delete user.subPages[key];
        changed = true;
      }
    });
    // 合并飞书白名单域名
    if (Array.isArray(bundled.urlWhitelist)) {
      const set = new Set(user.urlWhitelist || []);
      bundled.urlWhitelist.forEach((d) => {
        if (!set.has(d)) {
          set.add(d);
          changed = true;
        }
      });
      user.urlWhitelist = Array.from(set);
    }
    // 维护子页拖拽顺序：保留用户排序，追加新页、去掉已删页
    const normalized = normalizeSubPageOrder(user.subPageOrder, user.subPages);
    if (JSON.stringify(normalized) !== JSON.stringify(user.subPageOrder || [])) {
      user.subPageOrder = normalized;
      changed = true;
    }
    if (changed) saveJson(destPath, user);
  } catch (e) {}
}

/** 校验并补全子页顺序（已知页按 order，未知页追加到末尾） */
function normalizeSubPageOrder(order, subPages) {
  const keys = Object.keys(subPages || {});
  const keySet = new Set(keys);
  const seen = new Set();
  const out = [];
  (Array.isArray(order) ? order : []).forEach((k) => {
    if (keySet.has(k) && !seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  });
  keys.forEach((k) => {
    if (!seen.has(k)) out.push(k);
  });
  return out;
}

// ------ 迁移旧 A/B 配置（首次运行时执行）------
const MIGRATION_FLAG = path.join(configDir(), '.migration_done');

function migrateOldConfigs() {
  if (fs.existsSync(MIGRATION_FLAG)) return; // 已迁移过

  const appdata = process.env.APPDATA || '';
  const oldAPath = path.join(appdata, 'BlackEggAssistant', 'config.json');
  const oldBPath = path.join(appdata, 'juliang-workbench', 'config');
  const newRoomsPath = path.join(configDir(), 'rooms.json');

  const rooms = loadJson(newRoomsPath) || { version: '2.0', liveRooms: [] };

  // 迁移 A 的配置（日报助手房间 → 注入 anchors/profile/duration）
  const oldA = loadJson(oldAPath);
  if (oldA && oldA.rooms) {
    Object.entries(oldA.rooms).forEach(([name, acfg], idx) => {
      // 匹配：按索引顺序或 label 模糊匹配
      const target = rooms.liveRooms[idx] || null;
      if (target) {
        target.anchors = acfg.anchors || target.anchors || [];
        target.userProfileText = acfg.user_profile_text || target.userProfileText || '';
        target.liveDuration = acfg.live_duration || target.liveDuration || '15h';
        if (acfg.daily_url) target.dailyUrl = acfg.daily_url;
      }
    });

    // 迁移 A 的历史日报
    const oldHistoryDir = path.join(appdata, 'BlackEggAssistant', 'history');
    if (fs.existsSync(oldHistoryDir)) {
      const entries = fs.readdirSync(oldHistoryDir, { withFileTypes: true });
      entries.forEach(entry => {
        if (entry.isDirectory()) {
          const roomIdx = rooms.liveRooms.findIndex(r =>
            r.label && r.label.includes(entry.name)
          );
          const targetId = roomIdx >= 0 ? rooms.liveRooms[roomIdx].id : entry.name;
          const destDir = path.join(reportsDir(), targetId);
          ensureDir(destDir);
          const srcDir = path.join(oldHistoryDir, entry.name);
          if (fs.existsSync(srcDir)) {
            fs.readdirSync(srcDir).forEach(f => {
              if (f.endsWith('.txt')) {
                fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
              }
            });
          }
        }
      });
    }
  }

  // 迁移 B 的旧配置（liveRooms）
  const oldBRooms = loadJson(path.join(oldBPath, 'rooms.json'));
  if (oldBRooms && oldBRooms.liveRooms) {
    oldBRooms.liveRooms.forEach(bRoom => {
      const exists = rooms.liveRooms.find(r => r.id === bRoom.id);
      if (!exists) rooms.liveRooms.push(bRoom);
    });
  }

  rooms.version = '2.0';
  saveJson(newRoomsPath, rooms);
  // 迁移完成标记
  fs.writeFileSync(MIGRATION_FLAG, Date.now().toString(), 'utf-8');
}

// ====== 主配置对象 ======
initConfig();
migrateOldConfigs();

const roomsCfg = loadJson(path.join(configDir(), 'rooms.json')) || { liveRooms: [] };
const subCfg = loadJson(path.join(configDir(), 'subPages.json')) || {};
const kpiCfg = loadJson(path.join(configDir(), 'kpiPatterns.json')) || {};
setKpiPatterns(kpiCfg);

const config = {
  liveRooms: roomsCfg.liveRooms || [],
  subPages: subCfg.subPages || {},
  subPageOrder: normalizeSubPageOrder(subCfg.subPageOrder, subCfg.subPages || {}),
  layout: subCfg.layout || { sidebarWidth: 148, toolbarHeight: 46, tabBarHeight: 40 },
  urlWhitelist: subCfg.urlWhitelist || [],
  authCallbackSchemes: subCfg.authCallbackSchemes || ['myapp://callback'],
  keepAliveMax: subCfg.keepAliveMax || 2,
  viewPoolSize: subCfg.viewPoolSize || 2,
  preloadDelayMs: subCfg.preloadDelayMs || 5000,
  tokenExchangeEndpoint: subCfg.tokenExchangeEndpoint || '',
  kpiPatterns: kpiCfg || {}
};

// 启动时：从已有 dailyUrl 写回真实 roomId（去掉占位 123456 等）
(function syncRoomIdsAtBoot() {
  let changed = false;
  (config.liveRooms || []).forEach((room) => {
    if (syncRoomIdFromDailyUrl(room).changed) changed = true;
  });
  if (changed) {
    saveJson(path.join(configDir(), 'rooms.json'), { version: '2.0', liveRooms: config.liveRooms });
  }
})();

// ====== 辅助函数（保留 B 原有接口） ======
const CUSTOM_URLS_PATH = path.join(configDir(), 'customUrls.json');

function loadCustomUrls() {
  try { return JSON.parse(fs.readFileSync(CUSTOM_URLS_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveCustomUrls(data) {
  fs.writeFileSync(CUSTOM_URLS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getSubPageConfig(subPage) { return config.subPages[subPage]; }

function getOrderedSubPageKeys() {
  return normalizeSubPageOrder(config.subPageOrder, config.subPages);
}

const SUBPAGES_PATH = path.join(configDir(), 'subPages.json');

/** 持久化子页拖拽顺序（仅改 order，不动各页配置） */
function saveSubPageOrder(order) {
  const next = normalizeSubPageOrder(order, config.subPages);
  let data = loadJson(SUBPAGES_PATH) || {};
  data.subPages = data.subPages || config.subPages;
  data.subPageOrder = next;
  if (!data.layout) data.layout = config.layout;
  if (!data.urlWhitelist) data.urlWhitelist = config.urlWhitelist;
  saveJson(SUBPAGES_PATH, data);
  config.subPageOrder = next;
  return next;
}

function getDefaultUrl(roomId, subPage) {
  const custom = loadCustomUrls();
  const customKey = `${roomId}_${subPage}`;
  if (custom[customKey]) return custom[customKey];

  // report 子页不加载 URL
  const sp = config.subPages[subPage];
  if (!sp || sp.kind === 'report') return 'about:blank';

  const room = config.liveRooms.find(r => r.id === roomId);

  // 直播大屏：dailyUrl 优先（配置里 roomId 常为占位 123456/789012，不能用来拼 compass）
  if (subPage === 'daping' && room && room.dailyUrl && isCompassLiveScreenUrl(room.dailyUrl)
      && !isPlaceholderRoomId(parseLiveRoomId(room.dailyUrl))) {
    return room.dailyUrl;
  }

  if (sp.defaultUrlTemplate) {
    const rid = room ? room.roomId : roomId;
    // 占位 roomId 不要拼出错误大屏地址（否则调度器/复位会把已登录页冲掉）
    if (subPage === 'daping' && isPlaceholderRoomId(rid)) {
      return 'about:blank';
    }
    return sp.defaultUrlTemplate.replace('{roomId}', rid);
  }
  return sp.defaultUrl || 'about:blank';
}

function isUrlAllowed(url) {
  if (!config.urlWhitelist || config.urlWhitelist.length === 0) return true;
  try {
    const host = new URL(url).host;
    return config.urlWhitelist.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

// ------ 房间配置读写 ------
const ROOMS_PATH = path.join(configDir(), 'rooms.json');

function loadRooms() {
  try { return JSON.parse(fs.readFileSync(ROOMS_PATH, 'utf-8')).liveRooms || []; }
  catch { return config.liveRooms || []; }
}

function saveRooms(liveRooms) {
  const cleaned = (liveRooms || []).map((r) => {
    const { autoReport, ...rest } = r || {};
    syncRoomIdFromDailyUrl(rest);
    return rest;
  });
  saveJson(ROOMS_PATH, { version: '2.0', liveRooms: cleaned });
  config.liveRooms = cleaned;
}

// ------ 导航状态持久化 ------
const NAV_STATE_PATH = path.join(configDir(), 'navigationState.json');

function loadNavState() {
  try { return JSON.parse(fs.readFileSync(NAV_STATE_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveNavState(state) {
  ensureDir(configDir());
  fs.writeFileSync(NAV_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// ------ 日报保存 ------
function saveReport(roomId, reportText) {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(reportsDir(), roomId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, date + '.txt'), reportText, 'utf-8');
  // 同时保存 last_report 用于恢复
  ensureDir(logsDir());
  fs.writeFileSync(path.join(logsDir(), 'last_report_' + roomId + '.txt'), reportText, 'utf-8');
}

function loadLastReport(roomId) {
  const p = path.join(logsDir(), 'last_report_' + roomId + '.txt');
  try { return fs.readFileSync(p, 'utf-8'); }
  catch { return ''; }
}

function reportDir(roomId) {
  const dir = path.join(reportsDir(), roomId);
  ensureDir(dir);
  return dir;
}

module.exports = {
  config, configDir, reportsDir, logsDir,
  getSubPageConfig, getDefaultUrl, isUrlAllowed,
  getOrderedSubPageKeys, saveSubPageOrder, normalizeSubPageOrder,
  loadCustomUrls, saveCustomUrls,
  loadRooms, saveRooms,
  loadNavState, saveNavState,
  saveReport, loadLastReport, reportDir,
  syncRoomIdFromDailyUrl
};
