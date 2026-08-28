# CHANGELOG

## V1.50 (2026-08-28)

### 新增
- 云端升级：填写 `config/updater.json` 的 `feedUrl` 后，安装包即可从 OSS/静态服务器自动检查、下载并重启安装
- 菜单「帮助 → 检查更新」；发现新版本时顶部横幅提示下载/重启
- 支持 `%APPDATA%/live-ops-workbench/config/updater.json` 覆盖升级地址（无需重装）

### 优化
- BrowserView 按内容区实测尺寸自适应，修正窗口最大化/缩放时页面显示不全
- 主窗口默认最大化，直播间管理窗口可调整大小

### 移除
- 弹幕面板及相关后台监控逻辑

## V1.02 (2026-07-18)

### UI 美化
- 色板升级：更深的背景 `#080D16`、更细腻的表面色阶、新增青色亮调和琥珀强调色
- 字体：改用系统原生字体栈（`system-ui` + `Microsoft YaHei` + 抗锯齿）
- 侧栏：加宽至 128px、渐变激活态、自定义滚动条、3px 左指示条
- 工具栏：42px 增高、渐变背景、标题改用青蓝渐变
- Tab：减小间距、统过渡速度 200ms
- 报告面板：增加顶部径向光晕、编辑器用等宽字体（`Cascadia Code`/`Fira Code`）、focus 环形光晕、按钮统一圆角 6px
- 徽章/标签：胶囊圆角 `20px`、字间距微调

## V1.01 (2026-07-18)

### 新增
- 工具栏「📋 日报」快捷入口（一键切到日报子页）
- 命令行脱机正则测试：`npm run test-regex:douyin` / `npm run test-regex`
- 迁移完成后 `.migration_done` 标记，避免重复迁移

### 修复
- 切到「直播日报」时 tabbar 被面板遮挡 → 改为 flex 布局
- daping 视图登录态丢失（导致"检测到登录页"错误） → 保留视图实例不销毁
- 用户画像解析混入 KPI 标签 → 过滤率/金额/次数等关键词
- 累计观看人数字段针对 compass 大屏增加备选正则
- GMV 字段针对 compass 增加「支付GMV」「结算金额」备选标签
- 窗口关闭时未清理 WebSocket → `windowManager.dispose()`
- 未使用的 `nativeImage` 导入
- saveReport/copyReport 缺少 catch 错误处理
- `#main` 缺 `position:relative`（影响子元素定位）
- 关于对话框仍显示旧品牌名

### 变更
- 配置目录从 `juliang-workbench` / `BlackEggAssistant` 迁移到统一 `live-ops-workbench`
- 配置 JSON 引入版本号字段（rooms=v2.0）
- debugLog 日志路径从硬编码 `D:\美的抖音直播间项目` 改为 `userData/logs`
- electron-builder 打包配置就绪（NSIS 安装包 + 便携版 + 目录版）

## V1.00 (2026-07-18)

### 初始合并
- 以巨量百应多直播间工作台（Electron）为外壳基座
- 移植黑蛋助手日报能力：KPI 抓取、正则提取、日报拼装、用户画像
- 统一配置层（含旧 A/B 配置自动迁移）
- 新增「直播日报」子页 + 报告面板
- 直播间管理扩展（主播/时长/用户画像字段）
- 整套异常路径处理（视哉不存在/加载中/超时/登录页/空页）
