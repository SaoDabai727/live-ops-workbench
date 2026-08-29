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

module.exports = {
  parseLiveRoomId,
  isPlaceholderRoomId,
  isCompassLiveScreenUrl,
  looksLikeCompassAccessDeniedPage,
  looksLikeLoginUrl,
  syncRoomIdFromDailyUrl,
  shouldNavigateDaping
};
