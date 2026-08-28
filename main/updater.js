// updater.js — 云端升级（electron-updater generic 静态资源）
// 改 config/updater.json 的 feedUrl 即可切换升级源，无需改代码。
const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const debugLog = require('./debugLog');

const DEFAULT_CFG = {
  enabled: true,
  provider: 'generic',
  feedUrl: '',
  channel: 'latest',
  autoCheckOnStartup: true,
  autoDownload: false,
  autoInstallOnAppQuit: true,
  checkDelayMs: 8000,
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
    cfg.enabled = true;
  }
  delete cfg._readme;
  delete cfg.version;
  cfg.feedUrl = String(cfg.feedUrl || '').trim().replace(/\/+$/, '');
  return cfg;
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
    packaged: app.isPackaged
  };

  let autoUpdater = null;
  let cfg = DEFAULT_CFG;
  let lastProgressAt = 0;
  let startupTimer = null;

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
      if (now - lastProgressAt < 250 && p.percent < 99) return;
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

  function applyFeed() {
    cfg = loadUpdaterConfig();
    state.enabled = !!cfg.enabled;
    state.currentVersion = app.getVersion();

    const provider = (cfg.provider || 'generic').toLowerCase();
    const isGithub = provider === 'github';
    const owner = cfg.owner || 'SaoDabai727';
    const repo = cfg.repo || 'live-ops-workbench';
    state.configured = !!(cfg.enabled && (isGithub ? (owner && repo) : cfg.feedUrl));

    if (!cfg.enabled) {
      send({ status: 'disabled', error: '云端升级未开启' });
      return false;
    }
    if (!isGithub && !cfg.feedUrl) {
      send({ status: 'disabled', error: '未配置 feedUrl' });
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
    if (isGithub) {
      updater.setFeedURL({
        provider: 'github',
        owner,
        repo,
        private: !!cfg.private
      });
    } else {
      updater.setFeedURL({
        provider: provider || 'generic',
        url: cfg.feedUrl
      });
    }
    return true;
  }

  async function check({ userTriggered } = {}) {
    if (!applyFeed()) {
      if (userTriggered) {
        const win = getMainWindow && getMainWindow();
        await dialog.showMessageBox(win || undefined, {
          type: 'info',
          title: '检查更新',
          message: '云端升级尚未就绪',
          detail: state.error + '\n\n默认使用 GitHub Releases 作为升级源。也可在 config/updater.json 改用 OSS 的 feedUrl。'
        });
      }
      return snapshot();
    }
    try {
      const updater = ensureUpdater();
      if (userTriggered) {
        const result = await updater.checkForUpdates();
        const info = result && result.updateInfo;
        if (state.status === 'available' || state.status === 'downloaded' || state.status === 'downloading') {
          if (userTriggered && state.status === 'available' && !cfg.autoDownload) {
            const win = getMainWindow && getMainWindow();
            const box = await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: '发现新版本',
              message: '发现新版本 ' + (state.version || (info && info.version) || ''),
              detail: '当前版本 ' + state.currentVersion + '\n是否立即下载？下载完成后可选择重启安装。',
              buttons: ['立即下载', '稍后'],
              defaultId: 0,
              cancelId: 1
            });
            if (box.response === 0) await download();
          } else if (userTriggered && state.status === 'downloaded') {
            const win = getMainWindow && getMainWindow();
            const box = await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: '更新已就绪',
              message: '新版本 ' + state.version + ' 已下载完成',
              detail: '重启后即可完成安装。',
              buttons: ['立即重启安装', '稍后'],
              defaultId: 0,
              cancelId: 1
            });
            if (box.response === 0) install();
          }
        } else if (state.status === 'not-available') {
          const win = getMainWindow && getMainWindow();
          await dialog.showMessageBox(win || undefined, {
            type: 'info',
            title: '检查更新',
            message: '已是最新版本',
            detail: '当前版本 ' + state.currentVersion
          });
        }
        return snapshot();
      }
      await updater.checkForUpdates();
      return snapshot();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      send({ status: 'error', error: msg });
      if (userTriggered) {
        const win = getMainWindow && getMainWindow();
        await dialog.showMessageBox(win || undefined, {
          type: 'error',
          title: '检查更新失败',
          message: '无法检查更新',
          detail: msg
        });
      }
      return snapshot();
    }
  }

  async function download() {
    if (!applyFeed()) return snapshot();
    if (state.status === 'downloaded') return snapshot();
    try {
      send({ status: 'downloading', percent: state.percent || 0, error: '' });
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

    if (cfg.enabled && cfg.feedUrl && cfg.autoCheckOnStartup) {
      const delay = Number(cfg.checkDelayMs) || 8000;
      startupTimer = setTimeout(() => {
        check({ userTriggered: false }).catch((e) => log('启动检查失败 ' + (e && e.message)));
      }, delay);
    }
  }

  function dispose() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
  }

  return { init, check, download, install, dispose, getState: snapshot };
}

module.exports = { createUpdater, loadUpdaterConfig };
