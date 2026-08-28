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
  cfg.mirror = String(cfg.mirror || '').trim();
  if (cfg.mirror && !/\/$/.test(cfg.mirror)) cfg.mirror += '/';
  return cfg;
}

function githubLatestDownloadUrl(owner, repo) {
  return 'https://github.com/' + owner + '/' + repo + '/releases/latest/download';
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

  function resolveFeed(cfgIn) {
    const provider = (cfgIn.provider || 'generic').toLowerCase();
    const owner = cfgIn.owner || 'SaoDabai727';
    const repo = cfgIn.repo || 'live-ops-workbench';
    const isGithub = provider === 'github';

    // 显式 generic feedUrl 优先
    if (!isGithub && cfgIn.feedUrl) {
      return { mode: 'generic', url: cfgIn.feedUrl, label: cfgIn.feedUrl, owner, repo };
    }
    if (isGithub && cfgIn.mirror) {
      const origin = githubLatestDownloadUrl(owner, repo);
      const url = cfgIn.mirror + origin;
      return { mode: 'generic', url, label: 'GitHub镜像 ' + cfgIn.mirror, owner, repo };
    }
    if (isGithub) {
      return { mode: 'github', owner, repo, label: 'GitHub ' + owner + '/' + repo };
    }
    return { mode: 'none', owner, repo, label: '' };
  }

  function applyFeed() {
    cfg = loadUpdaterConfig();
    state.enabled = !!cfg.enabled;
    state.currentVersion = app.getVersion();

    const feed = resolveFeed(cfg);
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
    if (!applyFeed()) {
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
    if (!applyFeed()) return snapshot();
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
    applyFeed();
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
    if (cfg.enabled && state.configured && cfg.autoCheckOnStartup) {
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
