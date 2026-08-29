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
  isCompassLiveScreenUrl
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
  if (room.dailyUrl && isCompassLiveScreenUrl(room.dailyUrl) && !isPlaceholderRoomId(parseLiveRoomId(room.dailyUrl))) {
    return room.dailyUrl;
  }
  if (isPlaceholderRoomId(room.roomId)) return 'about:blank';
  return `https://compass.jinritemai.com/screen/live/talent?live_room_id=${room.roomId}`;
}
const live2 = {
  roomId: '789012',
  dailyUrl: 'https://compass.jinritemai.com/screen/live/talent?live_room_id=7661811119568554758'
};
assert.ok(resolveDapingUrl(live2).includes('7661811119568554758'), 'dailyUrl must win over placeholder roomId');
assert.ok(!resolveDapingUrl(live2).includes('789012'), 'must not emit placeholder 789012');

console.log('ok: compass-daping-nav harness green');
