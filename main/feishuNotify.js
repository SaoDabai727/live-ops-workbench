// feishuNotify.js — 飞书自定义机器人推送（文本 + 大屏截图）
// 文本：直接 POST webhook
// 图片：需开放平台 App 上传拿 image_key，再经 webhook 发图
// 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

const crypto = require('crypto');
const debugLog = require('./debugLog');

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const IMAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/images';

let cachedToken = { token: '', expireAt: 0 };

function trim(s) {
  return String(s || '').trim();
}

function buildSignHeaders(signSecret) {
  const secret = trim(signSecret);
  if (!secret) return {};
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = timestamp + '\n' + secret;
  const sign = crypto.createHmac('sha256', stringToSign).update('').digest('base64');
  return { timestamp, sign };
}

async function postWebhook(webhook, body, signSecret) {
  const url = trim(webhook);
  if (!url) throw new Error('未配置飞书 Webhook');
  const sign = buildSignHeaders(signSecret);
  const payload = Object.keys(sign).length ? { ...body, ...sign } : body;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    const msg = data.msg || data.StatusMessage || text || ('HTTP ' + res.status);
    throw new Error('飞书推送失败：' + msg);
  }
  return data;
}

async function sendText({ webhook, text, signSecret }) {
  const content = String(text || '').trim();
  if (!content) throw new Error('日报内容为空');
  // 飞书文本单条上限约 30KB，截断保底
  const clipped = content.length > 28000 ? content.slice(0, 28000) + '\n…(已截断)' : content;
  return postWebhook(webhook, {
    msg_type: 'text',
    content: { text: clipped }
  }, signSecret);
}

async function sendImage({ webhook, imageKey, signSecret }) {
  if (!imageKey) throw new Error('缺少 image_key');
  return postWebhook(webhook, {
    msg_type: 'image',
    content: { image_key: imageKey }
  }, signSecret);
}

async function getTenantToken(appId, appSecret) {
  const id = trim(appId);
  const secret = trim(appSecret);
  if (!id || !secret) throw new Error('未配置飞书 App ID / App Secret（发截图必需）');
  const now = Date.now();
  if (cachedToken.token && cachedToken.expireAt > now + 60000) {
    return cachedToken.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: id, app_secret: secret })
  });
  const data = await res.json();
  if (!data.tenant_access_token) {
    throw new Error('获取飞书 token 失败：' + (data.msg || JSON.stringify(data)));
  }
  const expireSec = Number(data.expire) || 7200;
  cachedToken = {
    token: data.tenant_access_token,
    expireAt: now + expireSec * 1000
  };
  return cachedToken.token;
}

async function uploadImage({ appId, appSecret, pngBuffer }) {
  if (!pngBuffer || !pngBuffer.length) throw new Error('截图为空');
  const token = await getTenantToken(appId, appSecret);
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([pngBuffer], { type: 'image/png' }), 'daping.png');
  const res = await fetch(IMAGE_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
  const data = await res.json();
  const key = data && data.data && data.data.image_key;
  if (!key) {
    throw new Error('上传截图失败：' + (data.msg || JSON.stringify(data)));
  }
  return key;
}

/**
 * 推送日报文本到群；若有 App 凭证则再上传并发送截图。
 * @returns {{ textSent: boolean, imageSent: boolean, imageSkippedReason?: string }}
 */
async function pushReportToFeishu({ notify, reportText, pngBuffer, roomLabel }) {
  const webhook = trim(notify && notify.feishuWebhook);
  const signSecret = trim(notify && notify.feishuSignSecret);
  const appId = trim(notify && notify.feishuAppId);
  const appSecret = trim(notify && notify.feishuAppSecret);

  if (!webhook) {
    throw new Error('未配置飞书 Webhook，请在「直播间管理」填写');
  }

  const header = roomLabel ? ('【' + roomLabel + '】直播日报\n') : '直播日报\n';
  const body = header + String(reportText || '').trim();
  await sendText({ webhook, text: body, signSecret });
  debugLog.log('[feishu] text sent');

  const result = { textSent: true, imageSent: false };

  if (!pngBuffer || !pngBuffer.length) {
    result.imageSkippedReason = '无截图数据';
    return result;
  }
  if (!appId || !appSecret) {
    result.imageSkippedReason =
      '截图未上传：请在「直播间管理」填写飞书 App ID / App Secret（开放平台应用需开通上传图片权限）';
    return result;
  }

  try {
    const imageKey = await uploadImage({ appId, appSecret, pngBuffer });
    await sendImage({ webhook, imageKey, signSecret });
    result.imageSent = true;
    debugLog.log('[feishu] image sent key=' + imageKey);
  } catch (e) {
    result.imageSkippedReason = e.message || String(e);
    debugLog.log('[feishu] image failed: ' + result.imageSkippedReason);
  }
  return result;
}

module.exports = {
  sendText,
  sendImage,
  uploadImage,
  getTenantToken,
  pushReportToFeishu,
  buildSignHeaders
};
