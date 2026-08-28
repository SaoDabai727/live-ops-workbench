// protocolGuard.js — 吞掉 bytedance:// 等自定义协议，防止 Windows「需要新应用打开此链接」弹窗
const { app, protocol, session } = require('electron');
const debugLog = require('./debugLog');

const CUSTOM_SCHEMES = [
  'bytedance', 'snssdk', 'sslocal', 'aweme', 'jinnianjin', 'toutiao',
  'iesrd', 'bdvideo', 'ishuidian', 'taobao', 'alipays', 'weixin', 'alipay',
  'fb-messenger', 'ms-windows-store'
];

const BLOCKED_URL = new RegExp(
  `^(${CUSTOM_SCHEMES.join('|')}|javascript):`,
  'i'
);

const patchedSessions = new WeakSet();

function isExternalProtocol(url) {
  if (!url) return false;
  if (/^https?:\/\//i.test(url)) return false;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('file:') || url.startsWith('about:')) {
    return false;
  }
  return true;
}

function isBlockedUrl(url) {
  return isExternalProtocol(url) || BLOCKED_URL.test(String(url || ''));
}

/** 必须在 app.ready 之前调用 */
function registerPrivilegedSchemes() {
  try {
    protocol.registerSchemesAsPrivileged(
      CUSTOM_SCHEMES.map((scheme) => ({
        scheme,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
      }))
    );
  } catch (e) {
    debugLog.log('[protocolGuard] registerSchemesAsPrivileged: ' + (e && e.message));
  }
}

function swallowScheme(scheme) {
  try {
    if (protocol.handle) {
      protocol.handle(scheme, () => new Response('', { status: 204 }));
      return;
    }
  } catch (e) {}
  try {
    protocol.registerStringProtocol(scheme, (request, callback) => {
      callback({ data: '' });
    });
  } catch (e) {
    debugLog.log('[protocolGuard] swallow ' + scheme + ' failed: ' + (e && e.message));
  }
}

function installSessionBlocker(ses) {
  if (!ses || patchedSessions.has(ses)) return;
  patchedSessions.add(ses);
  try {
    // 不传 urls 过滤，才能拦到 bytedance:// 等自定义协议
    ses.webRequest.onBeforeRequest((details, callback) => {
      const u = details.url || '';
      if (!/^https?:\/\//i.test(u) && !u.startsWith('data:') && !u.startsWith('blob:') &&
          !u.startsWith('file:') && !u.startsWith('about:') && !u.startsWith('devtools:') &&
          !u.startsWith('chrome-extension:')) {
        if (isExternalProtocol(u) || BLOCKED_URL.test(u)) {
          debugLog.log('[protocolGuard] webRequest cancel: ' + u.slice(0, 120));
          callback({ cancel: true });
          return;
        }
      }
      callback({});
    });
  } catch (e) {
    debugLog.log('[protocolGuard] webRequest install failed: ' + (e && e.message));
  }
}

function guardWebContents(contents) {
  if (!contents || contents.isDestroyed()) return;
  try {
    contents.setWindowOpenHandler(({ url }) => {
      if (isBlockedUrl(url)) {
        debugLog.log('[protocolGuard] windowOpen deny: ' + String(url).slice(0, 120));
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  } catch (e) {}

  const blockNav = (event, url) => {
    if (isBlockedUrl(url) && !/^https?:\/\//i.test(url) && !String(url).startsWith('__RELOAD_ACTION__')) {
      event.preventDefault();
      debugLog.log('[protocolGuard] navigate deny: ' + String(url).slice(0, 120));
    }
  };
  try { contents.on('will-navigate', blockNav); } catch (e) {}
  try { contents.on('will-frame-navigate', (event) => blockNav(event, event.url)); } catch (e) {}
  try {
    contents.on('will-redirect', (event, url) => {
      if (isBlockedUrl(url) && !/^https?:\/\//i.test(url)) {
        event.preventDefault();
        debugLog.log('[protocolGuard] redirect deny: ' + String(url).slice(0, 120));
      }
    });
  } catch (e) {}
}

/** app.ready 之后调用 */
function installProtocolGuard() {
  CUSTOM_SCHEMES.forEach(swallowScheme);
  installSessionBlocker(session.defaultSession);

  app.on('web-contents-created', (_e, contents) => {
    guardWebContents(contents);
    try {
      const ses = contents.session;
      if (ses) installSessionBlocker(ses);
    } catch (e) {}
  });

  debugLog.log('[protocolGuard] installed schemes=' + CUSTOM_SCHEMES.length);
}

function ensurePartitionGuarded(partition) {
  try {
    installSessionBlocker(session.fromPartition(partition));
  } catch (e) {}
}

module.exports = {
  CUSTOM_SCHEMES,
  isBlockedUrl,
  isExternalProtocol,
  registerPrivilegedSchemes,
  installProtocolGuard,
  ensurePartitionGuarded,
  guardWebContents
};
