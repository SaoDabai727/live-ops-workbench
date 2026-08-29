# ADR-0001：Electron 安全基线

- 状态：已采纳
- 日期：2026-08-29

## 背景

壳窗口与内嵌 `BrowserView`（罗盘大屏 / 巨量百应）对安全策略要求不同：壳只需跑本地 UI；内嵌页需要分区会话、preload 注入与页面脚本执行。

## 决策

1. **本地 UI 窗口（主壳 / 直播间管理 / 飞书链接提示）**
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - `sandbox: true`
   - 仅通过 `preload` + `contextBridge` 暴露受控 IPC

2. **业务页（`BrowserView`）**
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - **`sandbox: false`（刻意保留）**
   - 原因：按直播间分区持久化 cookie、注入讲解/抓取脚本、与主进程协议拦截协同；在 Electron 28 上对分区 + preload 的 sandbox 兼容成本高于收益

3. **版本策略**
   - 当前钉在 Electron `^28.3.3`（与 electron-builder 24 已验证）
   - 升到 33+ 需单独回归：BrowserView 布局、自动更新、协议拦截、分区登录态
   - 不在本 ADR 范围内做大版本跳跃

## 后果

- 本地 UI 攻击面缩小；业务页仍依赖 Chromium 站点隔离与 URL 白名单
- 未来若 Electron 对 `partition + sandbox:true` 支持更稳，可再开 ADR 收紧 BrowserView
