const { hostMatches } = require('../main/explainManager');
const { getInjectSource, getForceShowTail } = require('../main/explainClickerInject');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log('ok:', msg);
}

assert(hostMatches('https://buyin.jinritemai.com/dashboard'), 'buyin host');
assert(hostMatches('https://compass.jinritemai.com/screen/live/talent'), 'compass host');
assert(hostMatches('https://www.douyin.com/jingxuan'), 'douyin host');
assert(!hostMatches('https://www.feishu.cn/docx/x'), 'feishu rejected');
assert(!hostMatches('about:blank'), 'blank rejected');

const s = getInjectSource();
assert(!/\bchrome\./.test(s), 'no chrome.* API calls');
assert(s.includes('localStorage'), 'uses localStorage');
assert(s.includes('自动点讲解'), 'panel title present');
assert(s.includes('__explainAutoClickInstalled'), 'idempotent install flag');
assert(s.includes('LOCK_KEY'), 'cross-tab lock');
assert(s.includes("mode === '1'"), 'mode only-1');
assert(s.includes("mode === 'all'"), 'mode all');
assert(s.includes('1号↔2号轮流'), 'mode 1-2 UI');
assert(s.includes('取消讲解'), 'cancel-then-reclick path');
assert(s.includes('__explainAutoClickForceShow'), 'force show hook');
assert(getForceShowTail().includes('__explainAutoClickForceShow'), 'force tail');

try {
  // eslint-disable-next-line no-new-func
  new Function(s);
  assert(true, 'inject script parses');
} catch (e) {
  throw new Error('inject script parse failed: ' + e.message);
}

console.log('all smoke checks passed');
