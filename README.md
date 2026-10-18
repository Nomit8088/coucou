<div align="center">

<img src="desktop/src-tauri/icons/128x128.png" width="96" alt="Coucou icon">

# Coucou — DSH Enhanced Edition

**屏幕顶部的 AI 开发助手：Windows、macOS、Linux 共用一套 Tauri 增强版。**

[![Latest Release](https://img.shields.io/github/v/release/Nomit8088/coucou?label=version&color=0A84FF)](https://github.com/Nomit8088/coucou/releases)
![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4)
![macOS 13+](https://img.shields.io/badge/macOS-13%2B-333333)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131)
![Code: MIT](https://img.shields.io/badge/code-MIT-green)

<img src="docs/media/demo.gif" width="760" alt="Coucou in action">

</div>

## 这个 Fork 做什么

由 [@Nomit8088](https://github.com/Nomit8088) 基于 [Louis Raillé 的 Coucou](https://github.com/Louis-CFM/coucou) 增强，重点服务 DeepSeek Harness（DSH）开发场景。

- **DSH 双向交互**：灵动岛与 Web GUI 同时显示权限请求/问题，明确点击后作出决策；继续输入、取消、权限预设、上下文占用、后台任务、定时提醒与会话状态。
- **AI 会话与聊天**：Claude Code（hooks 安装、权限审批与提问、套餐用量）、DSH / Codex hook 与 plugin 集成；DeepSeek 内置及自定义 OpenAI-compatible provider，支持本地模型服务。
- **开发服务**：GitHub / GitLab 流水线与请求通知、QQ 邮箱等可选集成。凭据进入系统安全存储，不写入普通设置。
- **Mochi**：保留现有角色、灵动岛、换装、声音、文件拖入、差异展示和周报，不重做已发布界面。
- **Windows 音乐增强**：网易云音乐、QQ 音乐、Spotify 系统媒体会话、播放控制与舞蹈动效；独立安装包 / 绿色便携版。

**macOS 使用同一套 `desktop/` TypeScript / Rust 代码，不是原生 Swift 版本。** Apple Music、iPhone / iCloud 同步、语音听写、贴附前台窗口等原生版本专属能力不属于此版。Mac 上没有后端实现的音乐与桌面悬浮入口会隐藏；完整差异与验收见 [macOS 适配说明](<desktop/MACOS.md>)。

## 安装与运行

### Windows

从 [本 Fork Releases](https://github.com/Nomit8088/coucou/releases) 下载对应版本的 `Coucou-Windows-setup.exe`、`.msi` 或 `Coucou-Windows-portable.zip`，不需要 Node / Rust 开发环境。设置和托盘菜单可以检查更新。

未签名包可能触发 SmartScreen；请先确认来源可信，再根据系统提示决定是否运行。也可以自行从源码构建。详见 [Windows / Linux 使用说明](<desktop/README.md>)。

### macOS（Tauri 增强版）

要求 macOS 13+。当前适配尚未发布正式 Mac 安装包，**不要把上游原生 `Coucou.zip` 当成本 Fork 的 DSH 增强版**。

在 Mac 上构建，或在 [macOS CI](<.github/workflows/macos-tauri.yml>) 运行后下载对应 Apple Silicon / Intel 的 DMG artifact。安装时将 `Coucou.app` 拖入 Applications。CI artifact 未经 Developer ID 公证；正式分发需配置 Apple 签名/公证。

Mac 更新为明确的对应架构 DMG 下载 / 手动安装，不执行 Windows 安装程序。源码和实机检查步骤见 [Mac 指南](<desktop/MACOS.md>)。

### Linux

继续使用同一个 Tauri 工程及现有 AppImage / deb / rpm 打包配置；系统依赖和 Wayland 差异见 [Linux 说明](<desktop/README.md#linux>)。上游的发行包不一定包含这个 Fork 的最新 DSH 增强。

## 从源码构建

共同要求 Node.js 24、Rust stable；Windows 还需 MSVC Build Tools，Mac 需 Xcode Command Line Tools（无需 XcodeGen），Linux 需 WebKitGTK / GTK 等开发库。

```sh
git clone https://github.com/Nomit8088/coucou.git
cd coucou/desktop
npm ci
npm run tauri dev
```

打包：

```sh
npm run pack
```

Tauri 自动采用对应操作系统配置。Mac 的 DMG 输出为 `Coucou-macOS-<version>-aarch64.dmg` 或 `Coucou-macOS-<version>-x86_64.dmg`，放在 `desktop/release/`；请分别在对应架构的 Mac 构建，hook 必须与主程序架构一致。

## 配置与安全

- 打开系统托盘 / Mac 菜单栏中的 Coucou → Settings。
- 在 Agents 中安装 DSH 插件或相应 Agent hooks：先看差异、备份，再明确确认写入，不覆盖已有配置。
- DSH 默认 profile 是 `~/.dsh/profiles/web`；安装后重启 DSH。
- 密钥使用 Windows Credential Manager / macOS Keychain / Linux Secret Service；普通设置与日志留在本机。
- 不自动同意权限，不自动发送邮件，不添加遥测。应用未启动或连接超时时，hook 退出并交回 Agent 自己处理。

## Versions

| Version | Date | Highlights |
|---|---|---|
| [v0.2.2](https://github.com/Nomit8088/coucou/releases/tag/v0.2.2) | Oct 18, 2026 | 恢复 Claude Code 接入（hooks 安装、权限/提问卡片、Cursor 标签、套餐用量）；同步上游错误卡片真实原因；新增 hooks 自检、诊断信息复制与审批队列提示 |
| [v0.2.1](https://github.com/Nomit8088/coucou/releases/tag/v0.2.1) | Oct 14, 2026 | 修复 GitHub / GitLab 新评论不弹灵动岛；未开启的 Codex 不再占用岛上的格子 |
| [v0.2.0](https://github.com/Nomit8088/coucou/releases/tag/v0.2.0) | Oct 12, 2026 | macOS（Tauri 增强版）首批正式包：Apple Silicon / Intel DMG、私有 Unix socket 双向 DSH、Keychain、Finder 拖拽；同一个 Release 同时提供 Windows 安装包与 Mac DMG。另含多会话隔离与权限请求队列 |
| [v0.1.1](https://github.com/Nomit8088/coucou/releases/tag/v0.1.1) | Oct 10, 2026 | Windows 托盘与设置内更新检测、一键拉起安装包 |
| [v0.1.0](https://github.com/Nomit8088/coucou/releases/tag/v0.1.0) | Oct 10, 2026 | DSH 深度适配、Windows 原生媒体控制、独立安装包 |

当前源码版本为 0.2.2。历史上游版本见 [CHANGELOG](<CHANGELOG.md>)。

## 代码位置与验证

- [Tauri 工程](<desktop/Cargo.toml>)：共享前端、Rust 后端及 hook；[Mac 指南](<desktop/MACOS.md>)。
- [macOS CI](<.github/workflows/macos-tauri.yml>)：分别检查 Intel / Apple Silicon，生成 DMG，不自动发布。
- 原生 Swift / iPhone / relay 源码只作为历史项目保留，不参与本 Fork 的 Mac Tauri 构建；相关旧文档不代表此版功能。

```sh
cd desktop
node scripts/prepare-build.mjs
npx tsc --noEmit
npm test
npx vite build
cargo test --workspace --locked
```

Windows 回归通过不等同于 Mac 验收完成：Mac 后端编译、WKWebView / AppKit 窗口、混合缩放多屏、全屏 Space、开机启动与签名/公证仍需 Mac CI 和实机确认。

## Credits & License

原始项目由 [Louis Raillé](https://louisraille.fr) 使用 Claude Code 构建，本 Fork 由 [@Nomit8088](https://github.com/Nomit8088) 增强。项目独立于 notch-companion 设计概念所属工作室。

- **代码**：[MIT](<LICENSE>)，保留版权声明。
- **名称、Mochi、图标、声音与媒体**：© Louis Raillé，保留所有权利；见 [LICENSE-ASSETS](<LICENSE-ASSETS.md>)。分发自己的 Fork 时请遵守资产许可要求。
