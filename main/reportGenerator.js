// reportGenerator.js — 移植自 A 的 scraper/translator.py
// 功能：整页文本 → KPI 正则提取 → 日报组装 → 画像标签解析
// KPI 正则优先读 config/kpiPatterns.json（经 setKpiPatterns），否则用内置默认。

// ---------- 文本预处理 ----------
const MERGE_SPACE_RE = /([¥￥\d,.分秒])\s+([¥￥\d,.万亿%分秒])/g;

function flattenPageText(text) {
  let prev = null;
  let flat = text;
  while (prev !== flat) {
    prev = flat;
    flat = flat.replace(MERGE_SPACE_RE, '$1$2');
  }
  flat = flat.replace(/[ \t]+/g, ' ');
  return flat;
}

// ---------- 金额清洗 ----------
const CURRENCY_CLEAN_RE = /[¥￥,\s元万亿]/g;

function cleanCurrency(text) {
  if (!text) return null;
  const cleaned = text.replace(CURRENCY_CLEAN_RE, '');
  return cleaned || null;
}

// ---------- 默认 KPI 正则（与 kpiPatterns.json 同步；配置缺失时兜底） ----------
const DEFAULT_SCRAPE_REGEX = {
  gmv: [
    '直播间成交金额\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '成交金额\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '支付\\s*GMV\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '结算金额\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)'
  ],
  refund: ['退款金额\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)'],
  gsv: ['(?:实际成交|销售总额)\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)'],
  exposure_total: [
    '曝光次数\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '曝光量\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)'
  ],
  cumulative_viewers: [
    '累计观看人数\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '累计观看\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '观看人数\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '观看量\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)'
  ],
  avg_watch_duration: ['人均观看时长\\s*(\\d+分(?:钟)?\\d+秒|\\d+秒|\\d+分(?:钟)?)'],
  exposure_view_rate: [
    '曝光[—\\-]观看率[^\\d%]*([\\d.]+%)',
    '曝光观看率[^\\d%]*([\\d.]+%)'
  ],
  interaction_rate: [
    '观看[—\\-]互动率[^\\d%]*([\\d.]+%)',
    '观看互动率[^\\d%]*([\\d.]+%)'
  ],
  product_click_rate: [
    '商品点击[—\\-]成交率\\s*[\\(（]\\s*人数\\s*[\\)）][^\\d%]*([\\d.]+%)',
    '商品点击成交率\\s*[\\(（]\\s*人数\\s*[\\)）][^\\d%]*([\\d.]+%)',
    '商品点击[—\\-]成交率[^\\d%]*([\\d.]+%)',
    '商品点击成交率[^\\d%]*([\\d.]+%)'
  ],
  follow_rate: [
    '观看[—\\-]关注率[^\\d%]*([\\d.]+%)',
    '观看关注率[^\\d%]*([\\d.]+%)'
  ],
  qianchuan_cost: [
    '千川消耗\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)',
    '广告消耗\\s*[¥￥]?\\s*([\\d,]+\\.?\\d*\\s*[万亿]?)'
  ],
  room_name: ['([\\u4e00-\\u9fa5]{2,30}(?:官方|旗舰)?直播间)']
};

const DEFAULT_PROFILE_TAG = '([\\d\\u4e00-\\u9fa5a-zA-Z][\\u4e00-\\u9fa5a-zA-Z0-9:\\-]*?)\\s*(\\d+(?:\\.\\d+)?%)';

let scrapeRegex = { ...DEFAULT_SCRAPE_REGEX };
let profileTagSource = DEFAULT_PROFILE_TAG;

function asPatternList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((s) => typeof s === 'string' && s);
  if (typeof value === 'string' && value) return [value];
  return [];
}

/** 注入 kpiPatterns.json（或测试用覆盖）；缺项回退内置默认 */
function setKpiPatterns(cfg) {
  const src = (cfg && cfg.scrape_regex) || {};
  const next = {};
  Object.keys(DEFAULT_SCRAPE_REGEX).forEach((key) => {
    const list = asPatternList(src[key]);
    next[key] = list.length ? list : DEFAULT_SCRAPE_REGEX[key];
  });
  scrapeRegex = next;
  const tag = cfg && cfg.profile_regex && cfg.profile_regex.tag_format;
  profileTagSource = (typeof tag === 'string' && tag) ? tag : DEFAULT_PROFILE_TAG;
}

function matchFirst(flatText, key, flags) {
  const list = scrapeRegex[key] || [];
  for (let i = 0; i < list.length; i++) {
    try {
      const m = flatText.match(new RegExp(list[i], flags || ''));
      if (m && m[1] != null) return m[1].trim();
    } catch (e) {
      // 忽略非法正则，继续下一条备选
    }
  }
  return null;
}

// ---------- KPI 正则提取 ----------
function extractKpis(flatText) {
  const results = {};
  const gmv = matchFirst(flatText, 'gmv', 'i');
  if (gmv) results.gmv = gmv;
  const refund = matchFirst(flatText, 'refund');
  if (refund) results.refund = refund;
  const gsv = matchFirst(flatText, 'gsv');
  if (gsv) results.gsv = gsv;
  const exposureTotal = matchFirst(flatText, 'exposure_total');
  if (exposureTotal) results.exposureTotal = exposureTotal;
  const cumulativeViewers = matchFirst(flatText, 'cumulative_viewers');
  if (cumulativeViewers) results.cumulativeViewers = cumulativeViewers;
  const avgWatchDuration = matchFirst(flatText, 'avg_watch_duration');
  if (avgWatchDuration) results.avgWatchDuration = avgWatchDuration;
  const exposureViewRate = matchFirst(flatText, 'exposure_view_rate');
  if (exposureViewRate) results.exposureViewRate = exposureViewRate;
  const interactionRate = matchFirst(flatText, 'interaction_rate');
  if (interactionRate) results.interactionRate = interactionRate;
  const productClickRate = matchFirst(flatText, 'product_click_rate');
  if (productClickRate) results.productClickRate = productClickRate;
  const followRate = matchFirst(flatText, 'follow_rate');
  if (followRate) results.followRate = followRate;
  const qianchuanCost = matchFirst(flatText, 'qianchuan_cost');
  if (qianchuanCost) results.qianchuanCost = qianchuanCost;
  const roomName = matchFirst(flatText, 'room_name');
  if (roomName) results.roomName = roomName;
  return results;
}

// ---------- KPI 标准化 ----------
function emptyKpi() {
  return {
    '直播间名称': null, 'GMV': null, '退款金额': null, 'GSV': null, '千川消耗': null,
    '总曝光次数': null, '累计观看人数': null, '人均观看时长': null,
    '曝光观看率': null, '观看互动率': null, '商品点击率': null, '观看关注率': null
  };
}

function normalizeKpi(raw) {
  const pageText = raw.pageText || '';
  if (!pageText) return emptyKpi();

  const flat = flattenPageText(pageText);
  const matched = extractKpis(flat);

  let gmv = cleanCurrency(matched.gmv);
  let refund = cleanCurrency(matched.refund);
  let gsv = cleanCurrency(matched.gsv);

  if (gsv == null && gmv != null && refund != null) {
    try {
      const gsvValue = parseFloat(gmv) - parseFloat(refund);
      gsv = Number.isInteger(gsvValue) ? String(gsvValue) : String(gsvValue);
    } catch (e) {
      gsv = null;
    }
  }

  return {
    '直播间名称': matched.roomName || null,
    'GMV': gmv,
    '退款金额': refund,
    'GSV': gsv,
    '千川消耗': cleanCurrency(matched.qianchuanCost),
    '总曝光次数': matched.exposureTotal || null,
    '累计观看人数': matched.cumulativeViewers || null,
    '人均观看时长': matched.avgWatchDuration || null,
    '曝光观看率': matched.exposureViewRate || null,
    '观看互动率': matched.interactionRate || null,
    '商品点击率': matched.productClickRate || null,
    '观看关注率': matched.followRate || null
  };
}

function countMatchedKpis(kpi) {
  const keys = Object.keys(emptyKpi());
  let n = 0;
  keys.forEach((k) => {
    if (kpi[k] != null && kpi[k] !== '') n += 1;
  });
  return { matched: n, total: keys.length };
}

// ---------- 日报组装 ----------
function formatReport({ roomCfg = {}, kpi = {}, userProfile = '', liveDuration = null, roomId = '' } = {}) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');

  const scrapedRoom = kpi['直播间名称'];
  const configLabel = roomCfg.label || '';
  const trustedScraped = scrapedRoom && configLabel && scrapedRoom.includes(configLabel) ? scrapedRoom : null;
  const rawRoom = trustedScraped || roomCfg.room_name || configLabel || (roomId + '直播间');
  const roomDisplay = rawRoom.startsWith('抖音：') ? rawRoom : '抖音：' + rawRoom;

  const anchors = (roomCfg.anchors || []).filter(a => a.enabled !== false).map(a => a.name);
  const anchorStr = anchors.length ? anchors.join('  ') : '未设置';
  const duration = liveDuration || roomCfg.liveDuration || roomCfg.live_duration || '未设置';

  const val = (v) => (v == null || v === '') ? '<未获取>' : String(v);

  return [
    roomDisplay,
    '日期：' + today,
    '直播时长：' + duration,
    '主播：' + anchorStr,
    'GMV：' + val(kpi['GMV']),
    '退款金额：' + val(kpi['退款金额']),
    'GSV：' + val(kpi['GSV']),
    '千川消耗：' + val(kpi['千川消耗']),
    '总曝光次数：' + val(kpi['总曝光次数']),
    '累计观看人数：' + val(kpi['累计观看人数']),
    '人均观看时长：' + val(kpi['人均观看时长']),
    '曝光观看率：' + val(kpi['曝光观看率']),
    '观看互动率：' + val(kpi['观看互动率']),
    '商品点击率：' + val(kpi['商品点击率']),
    '观看关注率：' + val(kpi['观看关注率']),
    '看播核心用户画像',
    (userProfile && userProfile.trim() ? userProfile.trim() : '<请补充>') + '。'
  ].join('\n');
}

// ---------- 用户画像标签解析 ----------
function parseProfileText(rawText) {
  const flat = flattenPageText(rawText).replace(/看播核心用户画像/g, '');
  let tagRe;
  try {
    tagRe = new RegExp(profileTagSource, 'g');
  } catch (e) {
    tagRe = new RegExp(DEFAULT_PROFILE_TAG, 'g');
  }

  const tags = [];
  const seen = new Set();
  let m;
  while ((m = tagRe.exec(flat)) !== null) {
    const label = m[1].trim();
    const percent = m[2].trim();
    if (label.length < 1 || /^\d+$/.test(label)) continue;
    if (/[率金额数次量比对比]/.test(label)) continue;
    const key = label + '|' + percent;
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(label + percent);
  }
  return tags.join('\n');
}

// ---------- 登录页检测 ----------
function isLoginPageText(pageText) {
  if (!pageText) return false;
  const lower = pageText.toLowerCase();
  return /(?:请登录|扫码登录|登录.*账号|passport|auth.*login)/i.test(lower);
}

module.exports = {
  normalizeKpi,
  formatReport,
  parseProfileText,
  flattenPageText,
  isLoginPageText,
  setKpiPatterns,
  countMatchedKpis,
  DEFAULT_SCRAPE_REGEX
};
