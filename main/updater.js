// updater.js — 云端升级（GitHub Releases / generic 静态资源，可选国内镜像）
// 改 config/updater.json 即可切换升级源，无需改代码。
const { app, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const debugLog = require('./debugLog');

const DEFAULT_CFG = {
  enabled: true,
  provider: 'generic',
  feedUrl: '',
  mirror: '',
  owner: 'SaoDabai727',
  repo: 'live-ops-workbench',
  channel: 'latest',
  autoCheckOnStartup: true,
  autoDownload: false,
  autoInstallOnAppQuit: true,
  checkDelayMs: 5000,
  allowDevCheck: false,
  // 版本发布通知
  notifyOnRelease: true,
  nativeNotify: true,
  checkIntervalMs: 4 * 60 * 60 * 1000
};

function log(msg) {
  debugLog.log('[updater] ' + msg);
}

function readJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    log('读取配置失败 ' + p + ': ' + (e && e.message));
    return null;
  }
}

function packagedUpdaterPath() {
  const asarPath = path.join(__dirname, '..', 'config', 'updater.json');
  const unpackedPath = asarPath.replace('app.asar', 'app.asar.unpacked');
  if (unpackedPath !== asarPath && fs.existsSync(unpackedPath)) return unpackedPath;
  return asarPath;
}

function loadUpdaterConfig() {
  const cfg = Object.assign({}, DEFAULT_CFG);
  const packaged = readJson(packagedUpdaterPath());
  if (packaged) Object.assign(cfg, packaged);
  const userOverride = path.join(app.getPath('userData'), 'config', 'updater.json');
  const userCfg = readJson(userOverride);
  if (userCfg) Object.assign(cfg, userCfg);
  if (process.env.LIVEOPS_UPDATE_URL) {
    cfg.feedUrl = process.env.LIVEOPS_UPDATE_URL;
    cfg.provider = 'generic';
    cfg.enabled = true;
  }
  delete cfg._readme;
  delete cfg.version;
  cfg.feedUrl = String(cfg.feedUrl || '').trim().replace(/\/+$/, '');
  cfg.mirror = normalizeMirror(cfg.mirror);
  if (!Array.isArray(cfg.mirrors)) cfg.mirrors = [];
  cfg.mirrorRace = cfg.mirrorRace !== false;
  return cfg;
}

function githubLatestDownloadUrl(owner, repo) {
  return 'https://github.com/' + owner + '/' + repo + '/releases/latest/download';
}

function normalizeMirror(m) {
  let s = String(m || '').trim();
  if (!s) return '';
  if (!/\/$/.test(s)) s += '/';
  return s;
}

function mirrorList(cfg) {
  const list = [];
  const push = (m) => {
    const n = normalizeMirror(m);
    if (n && !list.includes(n)) list.push(n);
  };
  if (Array.isArray(cfg.mirrors)) cfg.mirrors.forEach(push);
  push(cfg.mirror);
  return list;
}

async function raceMirrors(mirrors, owner, repo, timeoutMs) {
  if (!mirrors.length) return '';
  if (mirrors.length === 1) return mirrors[0];
  const testPath = githubLatestDownloadUrl(owner, repo) + '/latest.yml';
  const ms = Math.max(1500, Number(timeoutMs) || 5000);

  const probes = mirrors.map(async (mirror) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) {} }, ms);
    const t0 = Date.now();
    try {
      const res = await fetch(mirror + testPath, {
        method: 'GET',
        signal: ctrl ? ctrl.signal : undefined,
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await res.arrayBuffer();
      return { mirror, ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { mirror, ok: false, ms: Date.now() - t0, err: e && e.message };
    } finally {
      clearTimeout(timer);
    }
  });

  const results = await Promise.all(probes);
  const ok = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
  if (ok.length) {
    log('镜像竞速选用 ' + ok[0].mirror + ' (' + ok[0].ms + 'ms) candidates=' +
      results.map((r) => (r.ok ? 'OK' : 'FAIL') + ':' + r.ms + '@' + r.mirror).join(' | '));
    return ok[0].mirror;
  }
  log('镜像竞速全部失败，回退 ' + mirrors[0]);
  return mirrors[0];
}

function createUpdater({ getMainWindow }) {
  const state = {
    status: 'idle',
    currentVersion: app.getVersion(),
    version: '',
    releaseNotes: '',
    releaseName: '',
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    error: '',
    configured: false,
    enabled: false,
    packaged: app.isPackaged,
    feedLabel: '',
    notify: false
  };

  let autoUpdater = null;
  let cfg = DEFAULT_CFG;
  let lastProgressAt = 0;
  let startupTimer = null;
  let intervalTimer = null;
  let checkingPromise = null;
  let chosenMirror = '';
  let racePromise = null;
  let lastNotifiedVersion = '';

  function notifyStatePath() {
    return path.join(app.getPath('userData'), 'config', 'update-notify.json');
  }

  function loadNotifyState() {
    const data = readJson(notifyStatePath()) || {};
    lastNotifiedVersion = String(data.lastNotifiedVersion || '');
  }

  function saveNotifyState() {
    try {
      const p = notifyStatePath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({
        lastNotifiedVersion,
        updatedAt: new Date().toISOString()
      }, null, 2), 'utf-8');
    } catch (e) {
      log('保存通知状态失败 ' + (e && e.message));
    }
  }

  function plainNotes(raw) {
    if (!raw) return '';
    let s = String(raw);
    // electron-updater 有时给数组
    if (Array.isArray(raw)) {
      s = raw.map((x) => (typeof x === 'string' ? x : (x && x.note) || '')).join('\n');
    }
    return s
      .replace(/\r\n/g, '\n')
      .replace(/^#+\s*/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function fetchGithubReleaseMeta(owner, repo, version) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'live-ops-workbench-updater'
    };
    const tryUrls = [
      'https://api.github.com/repos/' + owner + '/' + repo + '/releases/tags/v' + version,
      'https://api.github.com/repos/' + owner + '/' + repo + '/releases/tags/' + version,
      'https://api.github.com/repos/' + owner + '/' + repo + '/releases/latest'
    ];
    for (let i = 0; i < tryUrls.length; i++) {
      try {
        const res = await fetch(tryUrls[i], { headers });
        if (!res.ok) continue;
        const data = await res.json();
        const tag = String(data.tag_name || '').replace(/^v/i, '');
        if (version && tag && tag !== String(version).replace(/^v/i, '') && i < 2) continue;
        return {
          name: data.name || '',
          body: data.body || '',
          url: data.html_url || ''
        };
      } catch (e) {
        // try next
      }
    }
    return null;
  }

  function showNativeNotify(version, notes) {
    if (cfg.nativeNotify === false) return;
    try {
      if (!Notification.isSupported()) return;
      const bodyLines = plainNotes(notes).split('\n').filter(Boolean).slice(0, 3);
      const body = bodyLines.length
        ? ('v' + version + '\n' + bodyLines.join(' · ').slice(0, 160))
        : ('发现新版本 v' + version + '，点击查看并更新');
      const n = new Notification({
        title: '直播运营助手 · 新版本发布',
        body,
        silent: false
      });
      n.on('click', () => {
        const win = getMainWindow && getMainWindow();
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          win.webContents.send('updater-status', snapshot());
        }
      });
      n.show();
    } catch (e) {
      log('系统通知失败 ' + (e && e.message));
    }
  }

  async function announceRelease(info) {
    const version = info && info.version ? String(info.version) : state.version;
    if (!version) return;

    let notes = (info && info.releaseNotes) ? plainNotes(info.releaseNotes) : state.releaseNotes;
    let name = state.releaseName || '';
    if (!notes || notes.length < 8) {
      const meta = await fetchGithubReleaseMeta(cfg.owner || 'SaoDabai727', cfg.repo || 'live-ops-workbench', version);
      if (meta) {
        if (meta.body) notes = plainNotes(meta.body);
        if (meta.name) name = meta.name;
      }
    }

    const shouldNotify = cfg.notifyOnRelease !== false && lastNotifiedVersion !== version;
    if (shouldNotify) {
      lastNotifiedVersion = version;
      saveNotifyState();
      showNativeNotify(version, notes);
    }

    send({
      status: 'available',
      version,
      releaseNotes: notes || '',
      releaseName: name || '',
      error: '',
      notify: shouldNotify
    });
  }

  function snapshot() {
    return Object.assign({}, state);
  }

  function send(partial) {
    if (partial) Object.assign(state, partial);
    const win = getMainWindow && getMainWindow();
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('updater-status', snapshot());
    }
  }

  function ensureUpdater() {
    if (autoUpdater) return autoUpdater;
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.logger = {
      info: (m) => log(String(m)),
      warn: (m) => log('warn ' + String(m)),
      error: (m) => log('error ' + String(m)),
      debug: () => {}
    };
    autoUpdater.on('checking-for-update', () => {
      send({ status: 'checking', error: '', notify: false });
    });
    autoUpdater.on('update-available', (info) => {
      // 异步补全发布说明 + 推送通知
      announceRelease(info || {}).catch((e) => {
        log('发布通知失败 ' + (e && e.message));
        send({
          status: 'available',
          version: info && info.version ? info.version : '',
          releaseNotes: (info && info.releaseNotes) ? plainNotes(info.releaseNotes) : '',
          error: '',
          notify: false
        });
      });
      log('发现新版本 ' + ((info && info.version) || ''));
    });
    autoUpdater.on('update-not-available', () => {
      send({ status: 'not-available', version: '', error: '', notify: false });
    });
    autoUpdater.on('download-progress', (p) => {
      const now = Date.now();
      if (now - lastProgressAt < 200 && p.percent < 99) return;
      lastProgressAt = now;
      send({
        status: 'downloading',
        percent: p.percent || 0,
        bytesPerSecond: p.bytesPerSecond || 0,
        transferred: p.transferred || 0,
        total: p.total || 0,
        notify: false
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      send({
        status: 'downloaded',
        version: info && info.version ? info.version : state.version,
        percent: 100,
        error: '',
        notify: false
      });
      log('新版本已下载 ' + state.version);
    });
    autoUpdater.on('error', (err) => {
      const msg = (err && (err.message || err.stack)) ? String(err.message || err) : '未知错误';
      send({ status: 'error', error: msg, notify: false });
      log('错误 ' + msg);
    });
    return autoUpdater;
  }

  function resolveFeed(cfgIn, mirrorOverride) {
    const provider = (cfgIn.provider || 'generic').toLowerCase();
    const owner = cfgIn.owner || 'SaoDabai727';
    const repo = cfgIn.repo || 'live-ops-workbench';
    const isGithub = provider === 'github';
    const mirrors = mirrorList(cfgIn);
    const mirror = normalizeMirror(mirrorOverride) || mirrors[0] || '';

    // 自建 OSS/CDN 优先（国内带宽最好）
    if (cfgIn.feedUrl) {
      return { mode: 'generic', url: cfgIn.feedUrl, label: cfgIn.feedUrl, owner, repo };
    }
    if (isGithub && mirror) {
      const origin = githubLatestDownloadUrl(owner, repo);
      const url = mirror + origin;
      return { mode: 'generic', url, label: 'GitHub镜像 ' + mirror, owner, repo, mirrors };
    }
    if (isGithub) {
      return { mode: 'github', owner, repo, label: 'GitHub ' + owner + '/' + repo };
    }
    return { mode: 'none', owner, repo, label: '' };
  }

  async function ensureChosenMirror(cfgIn) {
    const mirrors = mirrorList(cfgIn);
    if (!mirrors.length) {
      chosenMirror = '';
      return '';
    }
    if (!cfgIn.mirrorRace || mirrors.length === 1) {
      chosenMirror = mirrors[0];
      return chosenMirror;
    }
    if (chosenMirror && mirrors.includes(chosenMirror)) return chosenMirror;
    if (!racePromise) {
      racePromise = raceMirrors(mirrors, cfgIn.owner || 'SaoDabai727', cfgIn.repo || 'live-ops-workbench', cfgIn.mirrorRaceTimeoutMs)
        .then((m) => { chosenMirror = m; return m; })
        .finally(() => { racePromise = null; });
    }
    return racePromise;
  }

  async function applyFeed() {
    cfg = loadUpdaterConfig();
    state.enabled = !!cfg.enabled;
    state.currentVersion = app.getVersion();

    let mirror = '';
    if ((cfg.provider || '').toLowerCase() === 'github' && !cfg.feedUrl) {
      mirror = await ensureChosenMirror(cfg);
    }

    const feed = resolveFeed(cfg, mirror);
    state.feedLabel = feed.label || '';
    state.configured = !!(cfg.enabled && feed.mode !== 'none');

    if (!cfg.enabled) {
      send({ status: 'disabled', error: '云端升级未开启' });
      return false;
    }
    if (feed.mode === 'none') {
      send({ status: 'disabled', error: '未配置升级源（GitHub 或 feedUrl）' });
      return false;
    }
    if (!app.isPackaged && !cfg.allowDevCheck) {
      send({ status: 'disabled', error: '开发模式不检查更新（打包安装后生效）' });
      return false;
    }

    const updater = ensureUpdater();
    updater.autoDownload = !!cfg.autoDownload;
    updater.autoInstallOnAppQuit = cfg.autoInstallOnAppQuit !== false;
    updater.channel = cfg.channel || 'latest';
    updater.forceDevUpdateConfig = !app.isPackaged && !!cfg.allowDevCheck;

    if (feed.mode === 'github') {
      updater.setFeedURL({
        provider: 'github',
        owner: feed.owner,
        repo: feed.repo,
        private: !!cfg.private
      });
    } else {
      updater.setFeedURL({
        provider: 'generic',
        url: feed.url
      });
    }
    log('升级源 ' + state.feedLabel);
    return true;
  }

  async function check({ userTriggered } = {}) {
    if (!(await applyFeed())) {
      return snapshot();
    }
    if (checkingPromise) return checkingPromise;

    checkingPromise = (async () => {
      try {
        send({ status: 'checking', error: '', percent: 0 });
        const updater = ensureUpdater();
        await updater.checkForUpdates();
        // 用户手动检查且已是最新：保留 not-available 状态，由渲染层短暂展示后收起
        if (userTriggered && state.status === 'available' && cfg.autoDownload) {
          await download();
        }
        return snapshot();
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        send({ status: 'error', error: msg });
        return snapshot();
      } finally {
        checkingPromise = null;
      }
    })();

    return checkingPromise;
  }

  async function download() {
    if (!(await applyFeed())) return snapshot();
    if (state.status === 'downloaded') return snapshot();
    try {
      send({
        status: 'downloading',
        percent: state.percent || 0,
        bytesPerSecond: 0,
        transferred: state.transferred || 0,
        total: state.total || 0,
        error: ''
      });
      await ensureUpdater().downloadUpdate();
      return snapshot();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      send({ status: 'error', error: msg });
      return snapshot();
    }
  }

  function install() {
    try {
      ensureUpdater().quitAndInstall(false, true);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      send({ status: 'error', error: msg });
      log('安装失败 ' + msg);
    }
  }

  function dismiss() {
    if (state.status === 'downloading') return snapshot();
    send({ status: 'idle', error: '' });
    return snapshot();
  }

  function init() {
    loadNotifyState();
    applyFeed().catch((e) => log('初始化升级源失败 ' + (e && e.message)));
    ipcMain.handle('app-get-info', () => ({
      version: app.getVersion(),
      name: app.getName(),
      packaged: app.isPackaged,
      updater: snapshot()
    }));
    ipcMain.handle('updater-get-state', () => snapshot());
    ipcMain.handle('updater-check', () => check({ userTriggered: true }));
    ipcMain.handle('updater-download', () => download());
    ipcMain.handle('updater-install', () => {
      install();
      return { ok: true };
    });
    ipcMain.handle('updater-dismiss', () => dismiss());

    // GitHub / generic 均可启动自动检查（原先误要求 feedUrl，导致 GitHub 模式从不自动检查）
    if (cfg.enabled && cfg.autoCheckOnStartup) {
      const delay = Number(cfg.checkDelayMs) || 5000;
      startupTimer = setTimeout(() => {
        check({ userTriggered: false }).catch((e) => log('启动检查失败 ' + (e && e.message)));
      }, delay);
    }

    // 运行期间定时复查，便于长开时收到版本发布通知
    const intervalMs = Number(cfg.checkIntervalMs);
    if (cfg.enabled && intervalMs > 0) {
      intervalTimer = setInterval(() => {
        if (state.status === 'downloading' || state.status === 'checking') return;
        check({ userTriggered: false }).catch((e) => log('定时检查失败 ' + (e && e.message)));
      }, Math.max(30 * 60 * 1000, intervalMs));
      if (intervalTimer.unref) intervalTimer.unref();
    }
  }

  function dispose() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    if (intervalTimer) clearInterval(intervalTimer);
    intervalTimer = null;
  }

  return { init, check, download, install, dismiss, dispose, getState: snapshot };
}

module.exports = { createUpdater, loadUpdaterConfig };
