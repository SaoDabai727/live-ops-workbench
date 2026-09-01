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
  shouldReloadPreloaded,
  normalizeUrlForCompare
};
