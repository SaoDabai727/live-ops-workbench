// debugLog.js — 主进程诊断日志（修正硬编码路径，改用 userData/logs）
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getLogDir() {
  try {
    const p = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
  } catch (e) {
    // 回退：开发模式
    const fallback = path.join(__dirname, '..', 'logs');
    try { if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true }); } catch (_) {}
    return fallback;
  }
}

const LOG_DIR = getLogDir();
const LOG_PATH = path.join(LOG_DIR, 'debug.log');

function log(msg) {
  try {
    const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
    fs.appendFileSync(LOG_PATH, line, 'utf-8');
  } catch (e) {
    // 静默忽略
  }
}

function getLogPath() {
  return LOG_PATH;
}

module.exports = { log, getLogPath };
