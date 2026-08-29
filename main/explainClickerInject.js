// explainClickerInject.js — 读取可注入到页面主世界的自动点讲解脚本
const fs = require('fs');
const path = require('path');

const PAGE_SCRIPT = path.join(__dirname, 'explainClicker.page.js');
let cached = '';

function getInjectSource() {
  // 开发时每次读盘，避免改完浮层样式仍命中旧缓存
  cached = fs.readFileSync(PAGE_SCRIPT, 'utf8');
  return cached;
}

/** 强制显示面板时追加的尾调用（幂等：已安装则走 ForceShow） */
function getForceShowTail() {
  return ';try{window.__explainAutoClickForceShow&&window.__explainAutoClickForceShow();}catch(e){}';
}

module.exports = { getInjectSource, getForceShowTail, PAGE_SCRIPT };
