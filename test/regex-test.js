// test/regex-test.js — 命令行正则脱机测试
// 用途：不启动 Electron，喂一段页面 innerText，验证 KPI 提取 + 日报生成
// 用法：node test/regex-test.js <样本文件.txt>
//       或 echo "页面文本" | node test/regex-test.js --stdin

const fs = require('fs');
const path = require('path');
const { normalizeKpi, formatReport, parseProfileText, isLoginPageText } = require('../main/reportGenerator');

function main() {
  let pageText = '';
  const args = process.argv.slice(2);

  if (args.includes('--stdin')) {
    // 从标准输入读取
    pageText = fs.readFileSync(0, 'utf-8');
  } else if (args[0]) {
    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
      console.error('文件不存在: ' + filePath);
      process.exit(1);
    }
    pageText = fs.readFileSync(filePath, 'utf-8');
  } else {
    // 默认用样本文件
    const samplePath = path.join(__dirname, 'sample-douyin.txt');
    if (fs.existsSync(samplePath)) {
      pageText = fs.readFileSync(samplePath, 'utf-8');
    } else {
      console.error('请提供页面文本文件: node test/regex-test.js <文件.txt>');
      console.error('或使用管道: echo "页面文本" | node test/regex-test.js --stdin');
      process.exit(1);
    }
  }

  console.log('=== 输入文本长度: ' + pageText.length + ' 字符 ===\n');

  // 1. 登录页检测
  if (isLoginPageText(pageText)) {
    console.log('[!] 警告：检测到登录页文本，请确认已登录后再抓取\n');
  }

  // 2. KPI 提取
  const raw = { pageText };
  const kpi = normalizeKpi(raw);
  console.log('--- KPI 提取结果 ---');
  let matchCount = 0;
  let failCount = 0;
  for (const [key, value] of Object.entries(kpi)) {
    const status = (value !== null && value !== '') ? '✓' : '✗';
    if (value !== null && value !== '') matchCount++;
    else failCount++;
    console.log('  ' + status + ' ' + key + ': ' + (value || '<未获取>'));
  }
  console.log('\n匹配: ' + matchCount + '/' + (matchCount + failCount) + '  缺失: ' + failCount + '/' + (matchCount + failCount));

  // 3. 用户画像提取
  const profileRaw = pageText;
  const profileTags = parseProfileText(profileRaw);
  console.log('\n--- 用户画像标签 ---');
  if (profileTags) {
    profileTags.split('\n').forEach(tag => console.log('  ' + tag));
  } else {
    console.log('  <未检测到标签>');
  }

  // 4. 日报预览
  const report = formatReport({
    roomCfg: { label: '测试直播间', anchors: [{name:'主播1',enabled:true}], liveDuration: '8h' },
    kpi,
    userProfile: profileTags,
    liveDuration: '8h',
    roomId: 'test'
  });
  console.log('\n=== 日报预览 ===');
  console.log(report);

  // 5. 诊断建议
  console.log('\n=== 诊断 ===');
  if (failCount >= 8) {
    console.log('[!] 大部分字段未匹配。可能原因：');
    console.log('  1. compass 大屏标签文字与正则不匹配（见 main/reportGenerator.js extractKpis）');
    console.log('  2. 页面未完成加载（innerText 为空或不完整）');
    console.log('  3. 页面是登录页（请用 isLoginPageText 检查）');
    console.log('  → 建议：把本文件输出 + compass 页面文本截图一起发给开发者');
  } else if (failCount > 0 && failCount < 5) {
    console.log('[i] 部分字段未匹配。缺失字段可能在大屏上不存在或标签措辞不同。');
    console.log('  → 修改 main/reportGenerator.js 的 extractKpis() 正则，新增对应标签的备选模式。');
  } else {
    console.log('[✓] 正则匹配良好！');
  }
}

main();
