/**
 * compass 直播大屏 URL 工具（纯函数，便于单测）
 * 大屏硬刷新 / 用错误 roomId 导航会导致「账号无权访问」弹窗。
 */

function parseLiveRoomId(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    return u.searchParams.get('live_room_id') || '';
  } catch {
    const m = String(url).match(/[?&]live_room_id=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
}

/** URL 是否像登录 / 鉴权页（用于登录态健康检查） */
function looksLikeLoginUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.toLowerCase();
  if (s === 'about:blank' || s.startsWith('data:')) return false;
  return /passport|\/login|\/signin|sso\.|auth\.|accounts\.|oauth\/authorize/i.test(s);
}

/**
 * 从 dailyUrl / 当前大屏 URL 写回房间 roomId（占位或不同场次时更新）。
 * @returns {{ changed: boolean, roomId?: string }}
 */
function syncRoomIdFromDailyUrl(room, url) {
  if (!room || typeof room !== 'object') return { changed: false };
  const source = url || room.dailyUrl || '';
  const liveId = parseLiveRoomId(source);
  if (!liveId || isPlaceholderRoomId(liveId)) return { changed: false };
  let changed = false;
  if (String(room.roomId || '') !== liveId) {
    room.roomId = liveId;
    changed = true;
  }
  if (source && isCompassLiveScreenUrl(source)) {
    const prevId = parseLiveRoomId(room.dailyUrl || '');
    if (!room.dailyUrl || prevId !== liveId) {
      room.dailyUrl = source;
      changed = true;
    }
  }
  return { changed, roomId: liveId };
}

/** 配置里常见的占位 / 无效 roomId，不可用来导航真实大屏 */
function isPlaceholderRoomId(roomId) {
  if (roomId == null) return true;
  const s = String(roomId).trim();
  if (!s) return true;
  if (/^(0+|123456|789012|111111|999999|placeholder|test|todo)$/i.test(s)) return true;
  // 真实抖音直播间 ID 一般为较长数字
  if (/^\d+$/.test(s) && s.length < 10) return true;
  return false;
}

/** 是否为罗盘直播大屏页（含 live_room_id） */
function isCompassLiveScreenUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    if (!/compass\.jinritemai\.com$/i.test(u.hostname) && !/\.compass\.jinritemai\.com$/i.test(u.hostname)) {
      return false;
    }
    return u.pathname.includes('/screen/live');
  } catch {
    return /compass\.jinritemai\.com\/screen\/live/i.test(url);
  }
}

/** 大屏是否已落在「无权访问 / 返回首页」类错误态（供切回时自愈） */
function looksLikeCompassAccessDeniedPage(url) {
  if (!url || typeof url !== 'string') return false;
  if (/summon\.bytedance\.com/i.test(url)) return true;
  try {
    const u = new URL(url);
    if (!/compass\.jinritemai\.com/i.test(u.hostname)) return false;
    // 掉到罗盘首页 /talent 且无 live_room_id
    if (/\/talent\/?$/i.test(u.pathname) && !u.searchParams.get('live_room_id')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 调度器是否应强制导航到 expectedUrl。
 * 仅当当前页没有目标 live_room_id（或 roomId 不同）时才导航。
 */
function shouldNavigateDaping(currentUrl, expectedUrl) {
  const expectedId = parseLiveRoomId(expectedUrl);
  if (isPlaceholderRoomId(expectedId)) return false;
  const currentId = parseLiveRoomId(currentUrl);
  if (currentId && currentId === expectedId) return false;
  return true;
}

const DAPING_NEEDS_CONFIG_MARK = 'daping-needs-config';
const DAPING_DEFAULT_TEMPLATE =
  'https://compass.jinritemai.com/screen/live/talent?live_room_id={roomId}';

/**
 * 解析大屏应加载的目标。
 * 无有效 dailyUrl / roomId 时返回 needs-config（禁止 about:blank 黑屏）。
 * @returns {{ kind: 'url', url: string } | { kind: 'needs-config' }}
 */
function resolveDapingLoadTarget(room, template) {
  if (room && room.dailyUrl && isCompassLiveScreenUrl(room.dailyUrl)
      && !isPlaceholderRoomId(parseLiveRoomId(room.dailyUrl))) {
    return { kind: 'url', url: room.dailyUrl };
  }
  const rid = room ? room.roomId : '';
  if (!isPlaceholderRoomId(rid)) {
    const tpl = template || DAPING_DEFAULT_TEMPLATE;
    return { kind: 'url', url: String(tpl).replace('{roomId}', rid) };
  }
  return { kind: 'needs-config' };
}

/** 未配置 Room ID / dailyUrl 时的内嵌说明页（替代 about:blank） */
function buildDapingNeedsConfigUrl() {
  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<title>' + DAPING_NEEDS_CONFIG_MARK + '</title>' +
    '<style>' +
    'html,body{height:100%;margin:0;background:#161310;color:#E8E0D5;' +
    'font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}' +
    '.wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:32px}' +
    '.box{max-width:420px;line-height:1.55}' +
    'h1{font-size:18px;font-weight:600;margin:0 0 12px;color:#F5E6D3}' +
    'p{margin:0 0 10px;font-size:14px;color:#C4B8A8}' +
    'ol{margin:8px 0 0;padding-left:1.2em;font-size:13px;color:#A89888}' +
    'li{margin:6px 0}' +
    'code{font-size:12px;color:#E8A87C}' +
    '</style><div class="wrap"><div class="box" data-page="' + DAPING_NEEDS_CONFIG_MARK + '">' +
    '<h1>直播大屏尚未配置</h1>' +
    '<p>当前直播间没有有效的 Room ID / 本场大屏链接，所以无法打开罗盘大屏。</p>' +
    '<ol>' +
    '<li>打开左侧「直播间管理」</li>' +
    '<li>为该房间填写今日 <code>Room ID</code>（罗盘地址里的 <code>live_room_id</code>）</li>' +
    '<li>保存后再点「直播大屏」</li>' +
    '</ol></div></div>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function isDapingNeedsConfigUrl(url) {
  if (!url || typeof url !== 'string') return true;
  if (url === 'about:blank') return true;
  if (url.startsWith('data:') && url.includes(DAPING_NEEDS_CONFIG_MARK)) return true;
  return false;
}

/** 无有效配置时不要后台预加载大屏（否则预加载 about:blank，切过去就是黑屏） */
function shouldPreloadDaping(room) {
  return resolveDapingLoadTarget(room).kind === 'url';
}

module.exports = {
  parseLiveRoomId,
  isPlaceholderRoomId,
  isCompassLiveScreenUrl,
  looksLikeCompassAccessDeniedPage,
  looksLikeLoginUrl,
  syncRoomIdFromDailyUrl,
  shouldNavigateDaping,
  resolveDapingLoadTarget,
  buildDapingNeedsConfigUrl,
  isDapingNeedsConfigUrl,
  shouldPreloadDaping,
  DAPING_NEEDS_CONFIG_MARK
};
