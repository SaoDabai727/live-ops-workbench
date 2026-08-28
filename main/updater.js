// updater.js — 云端升级（GitHub Releases / generic 静态资源，可选国内镜像）
// 改 config/updater.json 即可切换升级源，无需改代码。
const { app, ipcMain } = require('electron');
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
  allowDevCheck: false
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
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    error: '',
    configured: false,
    enabled: false,
    packaged: app.isPackaged,
    feedLabel: ''
  };

  let autoUpdater = null;
  let cfg = DEFAULT_CFG;
  let lastProgressAt = 0;
  let startupTimer = null;
  let checkingPromise = null;
  let chosenMirror = '';
  let racePromise = null;

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
      send({ status: 'checking', error: '' });
    });
    autoUpdater.on('update-available', (info) => {
      send({
        status: 'available',
        version: info && info.version ? info.version : '',
        releaseNotes: (info && info.releaseNotes) ? String(info.releaseNotes) : '',
        error: ''
      });
      log('发现新版本 ' + state.version);
    });
    autoUpdater.on('update-not-available', () => {
      send({ status: 'not-available', version: '', error: '' });
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
        total: p.total || 0
      });
    });
    autoUpdater.on('update-downloaded', (info) => {
      send({
        status: 'downloaded',
        version: info && info.version ? info.version : state.version,
        percent: 100,
        error: ''
      });
      log('新版本已下载 ' + state.version);
    });
    autoUpdater.on('error', (err) => {
      const msg = (err && (err.message || err.stack)) ? String(err.message || err) : '未知错误';
      send({ status: 'error', error: msg });
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
  }

  function dispose() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
  }

  return { init, check, download, install, dismiss, dispose, getState: snapshot };
}

module.exports = { createUpdater, loadUpdaterConfig };
