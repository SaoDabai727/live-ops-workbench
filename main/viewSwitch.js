/**
 * BrowserView 切换书签（纯函数）：切页时必须把旧视图入保活，目标也必须入保活。
 * 旧逻辑：PRELOADED / KEEPALIVE 分支不 park 旧视图、不登记目标 →
 *  orphan → 下次 NEW 重建 loadURL → 黑屏闪烁 + 导航历史丢失（无法后退）。
 */

function resolveShowBranch({ hasPreloaded, hasKeepAlive }) {
  if (hasPreloaded) return 'PRELOADED';
  if (hasKeepAlive) return 'KEEPALIVE';
  return 'NEW';
}

/**
 * 切换后保活表应满足的不变式（用于 harness / 回归）。
 * @param {object} opts
 * @param {Set<string>|Map} opts.keptAliveKeys 切换后的保活 key 集合
 * @param {string|null} opts.prevKey 切换前当前页 key（无则 null）
 * @param {string} opts.nextKey 切换后目标 key
 */
function assertKeepAliveInvariants({ keptAliveKeys, prevKey, nextKey }) {
  const has = (k) => {
    if (!k) return true;
    if (keptAliveKeys instanceof Map) return keptAliveKeys.has(k);
    if (keptAliveKeys instanceof Set) return keptAliveKeys.has(k);
    return !!keptAliveKeys[k];
  };
  const errors = [];
  if (prevKey && prevKey !== nextKey && !has(prevKey)) {
    errors.push('prevKey missing from keepalive: ' + prevKey);
  }
  if (!has(nextKey)) {
    errors.push('nextKey missing from keepalive: ' + nextKey);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 模拟一次 showView 书签更新（不含真实 BrowserView）。
 * @param {'buggy'|'fixed'} mode
 */
function simulateShowViewBookkeeping(state, roomId, subPage, mode) {
  const key = `${roomId}_${subPage}`;
  const hasPreloaded = state.preloaded.has(key);
  const hasKeepAlive = state.keptAlive.has(key);
  const branch = resolveShowBranch({ hasPreloaded, hasKeepAlive });

  const prevKey = state.currentKey;

  if (mode === 'fixed') {
    // 任意分支：先把旧当前页收入保活
    if (prevKey && prevKey !== key) {
      state.keptAlive.add(prevKey);
    }
  }

  if (branch === 'PRELOADED') {
    state.preloaded.delete(key);
    if (mode === 'fixed') {
      state.keptAlive.add(key);
    }
    // buggy: 不 park prev，不 add target
  } else if (branch === 'KEEPALIVE') {
    if (mode === 'fixed') {
      state.keptAlive.add(key);
    }
    // buggy: 不 park prev
  } else {
    // NEW：新旧都入保活（旧行为与 fixed 一致）
    if (prevKey && prevKey !== key) state.keptAlive.add(prevKey);
    state.keptAlive.add(key);
  }

  state.currentKey = key;
  return { branch, prevKey, nextKey: key };
}

/**
 * LRU 保活淘汰：始终保留 current + pinned，再从最近使用的 key 补齐到 max。
 * max 含当前页。pinned + current 超过 max 时仍不淘汰 pinned。
 * @param {object} opts
 * @param {string[]} opts.lruOldestFirst
 * @param {string|null} opts.currentKey
 * @param {Iterable<string>} [opts.pinnedKeys]
 * @param {number} opts.max
 * @returns {{ keepKeys: string[], evictKeys: string[] }}
 */
function pickKeepAliveEvictions({ lruOldestFirst, currentKey, pinnedKeys, max }) {
  const order = Array.isArray(lruOldestFirst) ? lruOldestFirst.filter(Boolean) : [];
  const cap = Math.max(1, Number(max) || 1);
  const keep = new Set();
  if (currentKey) keep.add(currentKey);
  if (pinnedKeys) {
    for (const k of pinnedKeys) {
      if (k) keep.add(k);
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    if (keep.size >= cap) break;
    keep.add(order[i]);
  }
  const evictKeys = order.filter((k) => !keep.has(k));
  return { keepKeys: [...keep], evictKeys };
}

/** 预加载页是否应再 loadURL（同 URL 再 load 会清历史并黑屏） */
function shouldReloadPreloaded(lastUrl, currentUrl) {
  if (!lastUrl || lastUrl === 'about:blank') return false;
  if (!currentUrl || currentUrl === 'about:blank') return true;
  return normalizeUrlForCompare(lastUrl) !== normalizeUrlForCompare(currentUrl);
}

function normalizeUrlForCompare(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '');
  }
}

module.exports = {
  resolveShowBranch,
  assertKeepAliveInvariants,
  simulateShowViewBookkeeping,
  pickKeepAliveEvictions,
  shouldReloadPreloaded,
  normalizeUrlForCompare
};
