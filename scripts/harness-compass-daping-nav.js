/**
 * 反馈环：断言调度器不得用占位 roomId / 错误 URL 去硬导航已打开的大屏。
 * 红：旧逻辑 currentUrl !== expectedUrl → 会导航到 789012
 * 绿：shouldNavigateDaping 对同 room / 占位 ID 返回 false；getDefaultUrl 优先 dailyUrl
 */
const assert = require('assert');
const {
  parseLiveRoomId,
  isPlaceholderRoomId,
  shouldNavigateDaping,
  looksLikeCompassAccessDeniedPage,
  isCompassLiveScreenUrl,
  resolveDapingLoadTarget,
  buildDapingNeedsConfigUrl,
  isDapingNeedsConfigUrl,
  shouldPreloadDaping
} = require('../main/compassUrl');

const real = 'https://compass.jinritemai.com/screen/live/talent?live_room_id=7679252648081378094&live_app_id=1128&from_page=%2Ftalent#data';
const realExpected = 'https://compass.jinritemai.com/screen/live/talent?live_room_id=7679252648081378094';
const placeholderExpected = 'https://compass.jinritemai.com/screen/live/talent?live_room_id=789012';
const home = 'https://compass.jinritemai.com/talent';

assert.strictEqual(parseLiveRoomId(real), '7679252648081378094');
assert.strictEqual(isPlaceholderRoomId('789012'), true);
assert.strictEqual(isPlaceholderRoomId('7679252648081378094'), false);
assert.strictEqual(isCompassLiveScreenUrl(real), true);
assert.strictEqual(looksLikeCompassAccessDeniedPage(home), true);
assert.strictEqual(looksLikeCompassAccessDeniedPage(real), false);

assert.strictEqual(
  shouldNavigateDaping(real, realExpected),
  false,
  'same live_room_id must NOT navigate (old bug: string inequality)'
);
assert.strictEqual(
  shouldNavigateDaping(real, placeholderExpected),
  false,
  'placeholder expected roomId must NEVER navigate'
);
assert.strictEqual(
  shouldNavigateDaping('about:blank', realExpected),
  true,
  'blank page may navigate to real room'
);
assert.strictEqual(
  shouldNavigateDaping(real, 'https://compass.jinritemai.com/screen/live/talent?live_room_id=9999999999999999999'),
  true,
  'different real room id may navigate'
);

function resolveDapingUrl(room) {
  const t = resolveDapingLoadTarget(room);
  if (t.kind === 'needs-config') return buildDapingNeedsConfigUrl();
  return t.url;
}
const live2 = {
  roomId: '789012',
  dailyUrl: 'https://compass.jinritemai.com/screen/live/talent?live_room_id=7661811119568554758'
};
assert.ok(resolveDapingUrl(live2).includes('7661811119568554758'), 'dailyUrl must win over placeholder roomId');
assert.ok(!resolveDapingUrl(live2).includes('789012'), 'must not emit placeholder 789012');

// 美的油烟机二号：空 roomId + 无 dailyUrl → 旧逻辑 about:blank 黑屏；新逻辑 needs-config 说明页
const live3Empty = { id: 'live3', label: '美的油烟机二号', roomId: '', dailyUrl: '' };
const emptyTarget = resolveDapingLoadTarget(live3Empty);
assert.strictEqual(emptyTarget.kind, 'needs-config', 'empty live3 must not invent a compass URL');
const emptyUrl = resolveDapingUrl(live3Empty);
assert.ok(isDapingNeedsConfigUrl(emptyUrl), 'empty room must load needs-config page, not silent blank');
assert.ok(!/^about:blank$/i.test(emptyUrl), 'RED was: about:blank → dark BrowserView = 黑屏');
assert.strictEqual(shouldPreloadDaping(live3Empty), false, 'must not preload blank daping for empty room');

const live3Filled = {
  ...live3Empty,
  roomId: '7680535457544948499',
  dailyUrl: 'https://compass.jinritemai.com/screen/live/talent?live_room_id=7680535457544948499'
};
assert.strictEqual(resolveDapingLoadTarget(live3Filled).kind, 'url');
assert.ok(resolveDapingUrl(live3Filled).includes('7680535457544948499'));
assert.strictEqual(shouldPreloadDaping(live3Filled), true);
assert.strictEqual(isDapingNeedsConfigUrl(resolveDapingUrl(live3Filled)), false);

console.log('ok: compass-daping-nav harness green');
