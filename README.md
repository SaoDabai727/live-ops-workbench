# 直播运营助手（live-ops-workbench）

多直播间监控 + Compass 大屏 KPI 抓取 + 日报生成一体的 Electron 桌面工作台。

## 功能概览

- 多直播间切换（分区会话，减少重复登录）
- 子页：巨量百应 / 直播大屏 / 直播日报 / 后台私信 / 损益表 / 保价表（**Tab 可拖拽排序**）
- 一键生成日报（整页文本 + 可配置正则）
- 用户画像抓取与回填
- 应用内检查更新（GitHub Releases，可选国内镜像；发现新版本时 Toast + 系统通知）
- 登录态健康提示（大屏 / 百应疑似掉登录时横幅提醒）
- `dailyUrl` → `roomId` 自动同步（避免占位 ID 误导航）

## 环境要求

- Windows 10+
- Node.js 18+（开发）
- 依赖见 `package.json`（Electron 28）

## 开发

```bash
npm install
npm start
```

### 常用脚本

| 命令 | 说明 |
|------|------|
| `npm start` | 启动开发态 Electron |
| `npm test` | 纯 Node 单测（compassUrl / 日报 / 登录检测 / 画像 / kpiPatterns） |
| `npm run test-regex` | 对 compass 样本文本跑正则预览 |
| `npm run test-regex:douyin` | 对抖音样本跑正则预览 |
| `npm run build` | 打 NSIS + 便携版（`--publish never`） |
| `npm run build:portable` | 仅便携版 |

## 配置

开发态读仓库 `config/`；打包后优先读 `%APPDATA%/live-ops-workbench/config/`。

| 文件 | 作用 |
|------|------|
| `rooms.json` | 直播间列表（`roomId` / `dailyUrl` / 主播 / 画像 / 时长） |
| `subPages.json` | 子页定义、布局、URL 白名单 |
| `kpiPatterns.json` | KPI / 画像正则（**会被真正加载**，改完重启生效） |
| `updater.json` | 更新源 / 镜像 |

大屏地址优先用房间的 `dailyUrl`；若其中的 `live_room_id` 有效，会自动写回 `roomId`。

## 日报抓取说明

1. 先打开该房间「直播大屏」并完成登录  
2. 切到「直播日报」点「生成日报」  
3. 若字段大量 `<未获取>`：用 DevTools 拷贝 `document.body.innerText` 到 `test/` 样本，跑 `npm run test-regex` 校准 `config/kpiPatterns.json`

## 安全基线

见 [docs/adr/0001-electron-security-baseline.md](docs/adr/0001-electron-security-baseline.md)：壳窗口 `sandbox: true`；BrowserView 因分区会话暂保持 `sandbox: false`。

## 文档

- 变更记录：`CHANGELOG.md`
- Agent 协作：`AGENTS.md`、`docs/agents/`
- 历史合并/审查材料：`docs/archive/`

## 版本

当前版本见 `package.json` 的 `version` 字段。
