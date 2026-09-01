/**
 * 反馈环：切页保活书签不变式
 * 红：buggy 模式（模拟旧 showView）切走预加载页后 prev/next 不在 keepalive
 * 绿：fixed 模式始终 park 旧页并登记目标
 *
 * 用法：node scripts/harness-view-switch.js
 */
const assert = require('assert');
const {
  simulateShowViewBookkeeping,
  assertKeepAliveInvariants,
  shouldReloadPreloaded
} = require('../main/viewSwitch');

function fresh() {
  return { keptAlive: new Set(), preloaded: new Set(), currentKey: null };
}

console.log('\n=== view switch bookkeeping (buggy must fail) ===');

{
  const state = fresh();
  // 先 NEW 打开 juliang
  simulateShowViewBookkeeping(state, 'live1', 'juliang', 'buggy');
  // 预加载 daping，再切过去（旧 bug 路径）
  state.preloaded.add('live1_daping');
  const r = simulateShowViewBookkeeping(state, 'live1', 'daping', 'buggy');
  const check = assertKeepAliveInvariants({
    keptAliveKeys: state.keptAlive,
    prevKey: r.prevKey,
    nextKey: r.nextKey
  });
  assert.strictEqual(check.ok, false, 'buggy PRELOADED switch must violate invariants');
  assert.ok(check.errors.some(e => e.includes('prevKey') || e.includes('nextKey')));
  console.log('  ✓ buggy PRELOADED leaves keepalive broken:', check.errors.join('; '));
}

{
  const state = fresh();
  simulateShowViewBookkeeping(state, 'live1', 'juliang', 'buggy');
  state.keptAlive.add('live1_daping'); // 已在保活
  const r = simulateShowViewBookkeeping(state, 'live1', 'daping', 'buggy');
  const check = assertKeepAliveInvariants({
    keptAliveKeys: state.keptAlive,
    prevKey: r.prevKey,
    nextKey: r.nextKey
  });
  // prev juliang 可能仍在（NEW 时加过）；但若从另一条线来可能丢。此处 juliang 仍在。
  // 构造更狠：从 preloaded 出来的 orphan 再切 keepalive
  const s2 = fresh();
  s2.preloaded.add('live1_juliang');
  simulateShowViewBookkeeping(s2, 'live1', 'juliang', 'buggy'); // orphan current, not in keepalive
  s2.keptAlive.add('live1_daping');
  const r2 = simulateShowViewBookkeeping(s2, 'live1', 'daping', 'buggy');
  const c2 = assertKeepAliveInvariants({
    keptAliveKeys: s2.keptAlive,
    prevKey: r2.prevKey,
    nextKey: r2.nextKey
  });
  assert.strictEqual(c2.ok, false, 'orphan→KEEPALIVE must drop prevKey');
  console.log('  ✓ buggy orphan→KEEPALIVE drops prev:', c2.errors.join('; '));
  void check; void r;
}

console.log('\n=== view switch bookkeeping (fixed must pass) ===');

{
  const state = fresh();
  simulateShowViewBookkeeping(state, 'live1', 'juliang', 'fixed');
  state.preloaded.add('live1_daping');
  const r = simulateShowViewBookkeeping(state, 'live1', 'daping', 'fixed');
  const check = assertKeepAliveInvariants({
    keptAliveKeys: state.keptAlive,
    prevKey: r.prevKey,
    nextKey: r.nextKey
  });
  assert.strictEqual(check.ok, true, check.errors.join('; '));
  assert.ok(state.keptAlive.has('live1_juliang'));
  assert.ok(state.keptAlive.has('live1_daping'));
  console.log('  ✓ fixed PRELOADED parks prev + registers target');
}

{
  const s2 = fresh();
  s2.preloaded.add('live1_juliang');
  simulateShowViewBookkeeping(s2, 'live1', 'juliang', 'fixed');
  s2.keptAlive.add('live1_daping');
  const r2 = simulateShowViewBookkeeping(s2, 'live1', 'daping', 'fixed');
  const c2 = assertKeepAliveInvariants({
    keptAliveKeys: s2.keptAlive,
    prevKey: r2.prevKey,
    nextKey: r2.nextKey
  });
  assert.strictEqual(c2.ok, true, c2.errors.join('; '));
  console.log('  ✓ fixed orphan→KEEPALIVE keeps prev');
}

console.log('\n=== shouldReloadPreloaded ===');
assert.strictEqual(
  shouldReloadPreloaded('https://a.com/x', 'https://a.com/x'),
  false
);
assert.strictEqual(
  shouldReloadPreloaded('https://a.com/x', 'https://a.com/y'),
  true
);
assert.strictEqual(shouldReloadPreloaded('', 'https://a.com/x'), false);
assert.strictEqual(shouldReloadPreloaded('https://a.com/x', 'about:blank'), true);
console.log('  ✓ reload only when URL actually differs');

console.log('\nAll harness checks passed.\n');
