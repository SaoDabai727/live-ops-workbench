// reportGenerator.js — 移植自 A 的 scraper/translator.py
// 功能：整页文本 → KPI 正则提取 → 日报组装 → 画像标签解析

// ---------- 文本预处理 ----------
// 合并数字间的空白（抖音逐位渲染导致 "3 1 , 4 9 0 万" → "31,490万"）
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

function cleanText(text) {
  if (text == null) return null;
  const s = String(text).trim();
  return s || null;
}

// ---------- KPI 正则提取（移植 A 的 _extract_kpis） ----------
function extractKpis(flatText) {
  const results = {};

  // GMV — 兼容巨量百应 compass 大屏（标签可能为"成交金额"/"支付GMV"/"直播间成交金额"）
  let m = flatText.match(/直播间成交金额\s*[¥￥]?\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (!m) m = flatText.match(/成交金额\s*[¥￥]?\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (!m) m = flatText.match(/支付\s*GMV\s*[¥￥]?\s*([\d,]+\.?\d*\s*[万亿]?)/i);
  if (!m) m = flatText.match(/结算金额\s*[¥￥]?\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (m) results.gmv = m[1].trim();

  // 退款金额
  m = flatText.match(/退款金额\s*[¥￥]?\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (m) results.refund = m[1].trim();

  // GSV / 实际成交
  m = flatText.match(/(?:实际成交|销售总额)\s*[¥￥]?\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (m) results.gsv = m[1].trim();

  // 曝光次数
  m = flatText.match(/曝光次数\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (!m) m = flatText.match(/曝光量\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (m) results.exposureTotal = m[1].trim();

  // 累计观看人数 — 兼容 compass 大屏（标签可能为"累计观看"/"观看人数"/"观看量"）
  m = flatText.match(/累计观看人数\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (!m) m = flatText.match(/累计观看\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (!m) m = flatText.match(/观看人数\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (!m) m = flatText.match(/观看量\s*([\d,]+\.?\d*\s*[万亿]?)/);
  if (m) results.cumulativeViewers = m[1].trim();

  // 人均观看时长
  m = flatText.match(/人均观看时长\s*(\d+分(?:钟)?\d+秒|\d+秒|\d+分(?:钟)?)/);
  if (m) results.avgWatchDuration = m[1].trim();

  // 曝光-观看率
  m = flatText.match(/曝光[—\-]观看率[^\d%]*([\d.]+%)/);
  if (!m) m = flatText.match(/曝光观看率[^\d%]*([\d.]+%)/);
  if (m) results.exposureViewRate = m[1].trim();

  // 观看-互动率
  m = flatText.match(/观看[—\-]互动率[^\d%]*([\d.]+%)/);
  if (!m) m = flatText.match(/观看互动率[^\d%]*([\d.]+%)/);
  if (m) results.interactionRate = m[1].trim();

  // 商品点击率
  m = flatText.match(/商品点击[—\-]成交率[^\d%]*([\d.]+%)/);
  if (!m) m = flatText.match(/商品点击成交率[^\d%]*([\d.]+%)/);
  if (m) results.productClickRate = m[1].trim();

  // 观看-关注率
  m = flatText.match(/观看[—\-]关注率[^\d%]*([\d.]+%)/);
  if (!m) m = flatText.match(/观看关注率[^\d%]*([\d.]+%)/);
  if (m) results.followRate = m[1].trim();

  // 直播间名称
  m = flatText.match(/([\u4e00-\u9fa5]{2,30}(?:官方|旗舰)?直播间)/);
  if (m) results.roomName = m[1].trim();

  return results;
}

// ---------- KPI 标准化 ----------
function normalizeKpi(raw) {
  const pageText = raw.pageText || '';
  if (!pageText) {
    return {
      '直播间名称': null, 'GMV': null, '退款金额': null, 'GSV': null,
      '总曝光次数': null, '累计观看人数': null, '人均观看时长': null,
      '曝光观看率': null, '观看互动率': null, '商品点击率': null, '观看关注率': null
    };
  }

  const flat = flattenPageText(pageText);
  const matched = extractKpis(flat);

  let gmv = cleanCurrency(matched.gmv);
  let refund = cleanCurrency(matched.refund);
  let gsv = cleanCurrency(matched.gsv);

  // GSV = GMV - 退款（若大屏没直接抓到）
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
    '总曝光次数': matched.exposureTotal || null,
    '累计观看人数': matched.cumulativeViewers || null,
    '人均观看时长': matched.avgWatchDuration || null,
    '曝光观看率': matched.exposureViewRate || null,
    '观看互动率': matched.interactionRate || null,
    '商品点击率': matched.productClickRate || null,
    '观看关注率': matched.followRate || null
  };
}

// ---------- 日报组装 ----------
function formatReport({ roomCfg = {}, kpi = {}, userProfile = '', liveDuration = null, roomId = '' } = {}) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');

  // V1.40：scraper 从 daping 提取的直播间名称仅当包含房间配置 label 时才采纳（防止 placeholder roomId 匹配到无关文本）
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

// ---------- 用户画像标签解析（移植 A 的 parse_profile_text） ----------
const TAG_RE = /([\d\u4e00-\u9fa5a-zA-Z][\u4e00-\u9fa5a-zA-Z0-9:\-]*?)\s*(\d+(?:\.\d+)?%)/g;

function parseProfileText(rawText) {
  const flat = flattenPageText(rawText).replace(/看播核心用户画像/g, '');

  const tags = [];
  const seen = new Set();
  let m;
  while ((m = TAG_RE.exec(flat)) !== null) {
    const label = m[1].trim();
    const percent = m[2].trim();
    if (label.length < 1 || /^\d+$/.test(label)) continue;
    // 过滤 KPI 指标标签（率、金额、人数等不应出现在画像中）
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
  isLoginPageText
};
