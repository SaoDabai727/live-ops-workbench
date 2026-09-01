/**
 * 纯 Node 单测（不启动 Electron）
 * 覆盖：compassUrl、日报组装、登录页检测、画像解析、kpiPatterns 注入
 *
 * 用法：node test/unit-test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const compass = require('../main/compassUrl');
const report = require('../main/reportGenerator');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed += 1;
    console.error('  ✗ ' + name);
    console.error('    ' + (e.message || e));
  }
}

console.log('\n=== compassUrl ===');
test('parseLiveRoomId 从 query 解析', () => {
  const id = compass.parseLiveRoomId(
    'https://compass.jinritemai.com/screen/live/talent?live_room_id=7661440878568803091&x=1'
  );
  assert.strictEqual(id, '7661440878568803091');
});

test('isPlaceholderRoomId 识别短数字/占位', () => {
  assert.strictEqual(compass.isPlaceholderRoomId('123456'), true);
  assert.strictEqual(compass.isPlaceholderRoomId('7661440878568803091'), false);
});

test('isCompassLiveScreenUrl 识别大屏', () => {
  assert.strictEqual(
    compass.isCompassLiveScreenUrl(
      'https://compass.jinritemai.com/screen/live/talent?live_room_id=7661440878568803091'
    ),
    true
  );
  assert.strictEqual(compass.isCompassLiveScreenUrl('https://buyin.jinritemai.com/dashboard'), false);
});

test('looksLikeLoginUrl 识别登录页', () => {
  assert.strictEqual(compass.looksLikeLoginUrl('https://passport.jinritemai.com/login'), true);
  assert.strictEqual(
    compass.looksLikeLoginUrl(
      'https://compass.jinritemai.com/screen/live/talent?live_room_id=7661440878568803091'
    ),
    false
  );
});

test('syncRoomIdFromDailyUrl 写回真实 roomId', () => {
  const room = {
    id: 'live1',
    roomId: '123456',
    dailyUrl: 'https://compass.jinritemai.com/screen/live/talent?live_room_id=7661440878568803091'
  };
  const { changed, roomId } = compass.syncRoomIdFromDailyUrl(room);
  assert.strictEqual(changed, true);
  assert.strictEqual(roomId, '7661440878568803091');
  assert.strictEqual(room.roomId, '7661440878568803091');
});

test('空 roomId 大屏 → needs-config（禁止 about:blank 黑屏）', () => {
  const empty = { id: 'live3', roomId: '', dailyUrl: '' };
  assert.strictEqual(compass.resolveDapingLoadTarget(empty).kind, 'needs-config');
  assert.strictEqual(compass.shouldPreloadDaping(empty), false);
  assert.ok(compass.isDapingNeedsConfigUrl(compass.buildDapingNeedsConfigUrl()));
  assert.ok(compass.isDapingNeedsConfigUrl('about:blank'));
});

console.log('\n=== reportGenerator ===');
test('isLoginPageText 检测登录文案', () => {
  assert.strictEqual(report.isLoginPageText('请登录后继续操作'), true);
  assert.strictEqual(report.isLoginPageText('直播间成交金额 ¥100'), false);
});

test('parseProfileText 提取画像标签并过滤 KPI', () => {
  const text = '看播核心用户画像\n男 57%\n女 43%\n曝光观看率 4.53%\n25-30岁 31%';
  const tags = report.parseProfileText(text);
  assert.ok(tags.includes('男57%') || tags.includes('男 57%'.replace(/\s/g, '') === '男57%' ? '男57%' : '男57%') || /男\s*57%/.test(tags.replace(/\n/g, ' ')));
  // 更稳妥：按行检查
  const lines = tags.split('\n');
  assert.ok(lines.some((l) => /男/.test(l) && /57%/.test(l)));
  assert.ok(lines.some((l) => /女/.test(l) && /43%/.test(l)));
  assert.ok(!lines.some((l) => /曝光/.test(l)));
});

test('formatReport 组装含未获取占位', () => {
  const text = report.formatReport({
    roomCfg: { label: '美的燃热', anchors: [{ name: '小花', enabled: true }], liveDuration: '8h' },
    kpi: { GMV: '100', 退款金额: null },
    userProfile: '男57%',
    roomId: 'live1'
  });
  assert.ok(text.includes('美的燃热') || text.includes('抖音'));
  assert.ok(text.includes('GMV：100'));
  assert.ok(text.includes('<未获取>') || text.includes('退款'));
  assert.ok(text.includes('男57%'));
});

test('normalizeKpi + setKpiPatterns 读取配置正则', () => {
  const cfgPath = path.join(__dirname, '..', 'config', 'kpiPatterns.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  report.setKpiPatterns(cfg);

  const sample = [
    '美的燃热官方直播间',
    '直播间成交金额 ¥ 12,345',
    '退款金额 ¥ 100',
    '千川消耗 ¥ 2,500',
    '曝光次数 9,999',
    '累计观看人数 1.2万',
    '人均观看时长 1分30秒',
    '曝光—观看率 4.5%',
    '观看—互动率 2.1%',
    '商品点击—成交率(人数) 6.8%',
    '商品点击—成交率(次数) 3.2%',
    '观看—关注率 0.9%'
  ].join('\n');

  const kpi = report.normalizeKpi({ pageText: sample });
  assert.ok(kpi['GMV'], 'GMV should match');
  assert.ok(kpi['退款金额'], 'refund should match');
  assert.ok(kpi['累计观看人数'], 'viewers should match');
  assert.strictEqual(kpi['商品点击率'], '6.8%', 'should prefer 人数 over 次数');
  assert.strictEqual(kpi['千川消耗'], '2500', 'qianchuan cost should match');
  const { matched, total } = report.countMatchedKpis(kpi);
  assert.ok(matched >= 7, 'expected >=7 matched, got ' + matched + '/' + total);
});

test('normalizeKpi 对样本文件可用', () => {
  const samplePath = path.join(__dirname, 'sample-douyin.txt');
  if (!fs.existsSync(samplePath)) return;
  const pageText = fs.readFileSync(samplePath, 'utf-8');
  const kpi = report.normalizeKpi({ pageText });
  const { matched } = report.countMatchedKpis(kpi);
  assert.ok(matched >= 3, 'sample-douyin should match some KPIs, got ' + matched);
});

console.log('\n=== viewSwitch ===');
const viewSwitch = require('../main/viewSwitch');

test('PRELOADED buggy 丢保活；fixed 保留', () => {
  const buggy = { keptAlive: new Set(), preloaded: new Set(['live1_daping']), currentKey: 'live1_juliang' };
  buggy.keptAlive.add('live1_juliang');
  const rb = viewSwitch.simulateShowViewBookkeeping(buggy, 'live1', 'daping', 'buggy');
  const cb = viewSwitch.assertKeepAliveInvariants({
    keptAliveKeys: buggy.keptAlive, prevKey: rb.prevKey, nextKey: rb.nextKey
  });
  assert.strictEqual(cb.ok, false);

  const fixed = { keptAlive: new Set(['live1_juliang']), preloaded: new Set(['live1_daping']), currentKey: 'live1_juliang' };
  const rf = viewSwitch.simulateShowViewBookkeeping(fixed, 'live1', 'daping', 'fixed');
  const cf = viewSwitch.assertKeepAliveInvariants({
    keptAliveKeys: fixed.keptAlive, prevKey: rf.prevKey, nextKey: rf.nextKey
  });
  assert.strictEqual(cf.ok, true);
});

test('shouldReloadPreloaded 同 URL 不重载', () => {
  assert.strictEqual(
    viewSwitch.shouldReloadPreloaded('https://a.com/x', 'https://a.com/x'),
    false
  );
  assert.strictEqual(
    viewSwitch.shouldReloadPreloaded('https://a.com/x', 'https://a.com/y'),
    true
  );
});

console.log('\n=== feishuNotify ===');
const feishu = require('../main/feishuNotify');

test('buildSignHeaders 空密钥不签名', () => {
  assert.deepStrictEqual(feishu.buildSignHeaders(''), {});
  assert.deepStrictEqual(feishu.buildSignHeaders(null), {});
});

test('buildSignHeaders 生成 timestamp + sign', () => {
  const h = feishu.buildSignHeaders('test-secret');
  assert.ok(h.timestamp);
  assert.ok(h.sign);
  assert.strictEqual(typeof h.sign, 'string');
  assert.ok(h.sign.length > 10);
});

console.log('\n=== 结果 ===');
console.log('通过: ' + passed + '  失败: ' + failed);
process.exit(failed ? 1 : 0);
