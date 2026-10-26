# 源仓库同步跟踪

本文件记录本 Fork 与源仓库之间的功能同步边界、最近一次对比基线和每次同步决策。

## 仓库身份

- 当前 Fork：`https://github.com/Nomit8088/coucou`
- 源仓库：`https://github.com/Louis-CFM/coucou`
- 当前 Fork 的活动桌面端：`desktop/`（Tauri，Windows / macOS / Linux 共用）
- 源仓库对应目录：历史上主要使用 `windows/`；不能假定路径可直接 cherry-pick
- 原生 Swift 工程：`NotchBuddy/`，不是本 Fork 活动桌面端的实现目标

## 最近一次同步基线

> 基线是“已完成比较并作出决策”的位置，不代表 Fork 已经合并源仓库提交。

| 项目 | Commit | 说明 |
|---|---|---|
| 源仓库上游已比较 | `47d1c2da12bf1dce8fb28b825757d497c1e1d88d` | `Louis-CFM/coucou` `main`，2026-10-23；上一轮基线 `47e4da35…` 之后的 99 个提交已逐项分类，其中 3 项已移植（见「本轮同步（2026-10-26）」） |
| Fork 记录快照 | `7401530b70e3870cb525e5d2b36307ae20365ece` | 本轮完成 DPI 修复、蓝 Mochi、What's new 卡（去 Flow），版本 0.3.2 |
| 共同祖先 | `c946650bec0e37fd902322c8f149b7e83f06d22f` | 本轮比较使用的 merge-base（未变） |
| 比较结果 | 源仓库前移 99 commits（含 Mac 0.5.3、Windows/Linux 0.5.2~0.5.3、Android 0.3.0~0.3.7） | `compare/47e4da35...47d1c2da` |
| 记录时间 | 2026-10-26 11:40（Asia/Shanghai） | 本文档本轮更新时间 |

下次同步从源仓库 `47d1c2da…` 之后的提交开始检查，而不是从 Fork 的 HEAD 猜测。

> 2026-10-26 补记：`47e4da35…` → `47d1c2da12bf1dce8fb28b825757d497c1e1d88d` 的 99 个提交已完成逐项分类，其中 #1/#2/#3 已移植并验证（见「本轮同步（2026-10-26）」），基线前移到 `47d1c2da…`。

推荐定位命令：

```sh
git fetch --no-tags https://github.com/Louis-CFM/coucou.git main
git log --oneline 0dffbafcc0014d29e3e4af6fe9ba3a4ca063e105..FETCH_HEAD
git diff --stat 0dffbafcc0014d29e3e4af6fe9ba3a4ca063e105...FETCH_HEAD
```

## 本轮同步决策（2026-10-12 / 2026-10-13）

### 已同步或按本 Fork 逻辑移植

1. **权限请求 FIFO 队列**
   - 参考源仓库 `e391a142c98fae8c6d26f6fef5695a5b5ec8c368` 的语义，而不是复制 Swift socket 实现。
   - 当前 Tauri 前端最多排队 5 条请求，按 `requestId` 去重；当前请求结束后展示下一条。
   - 队列满、超时、会话结束和新一轮对话均采用 fail-closed 处理。
   - 实现位置：`desktop/src/core/state.ts`、`desktop/src/island/hooks.ts`、`desktop/src/island/island.ts`。

2. **多 session 隔离**
   - 参考源仓库 `5652ea8f9e6277c187683d1b12938e171b37fc7f` 的 registry 思路。
   - 当前按 `pillId -> sessionId -> state` 记录并发会话；一个 session 结束不会清掉兄弟 session。
   - 最后一个 session 结束时才清理 pill、diff 和 session owner。
   - 实现位置同上，回归测试在 `desktop/tests/hooks.test.mjs`。

### 本轮明确不做

| 源仓库功能 / 提交 | 决策 | 原因 |
|---|---|---|
| Voice / Jarvis 系列 | **暂不做** | 依赖 Swift/AppKit、原生音频、VAD、TTS；当前 Tauri 桌面端没有对应语音引擎，跨平台移植成本高 |
| Crypto pill `d18e06e0d987c2da7b0ce5cd05e6a27719274047` | 暂不做 | Swift/AppKit 专属；需要重新设计 Tauri 数据层、凭据和 UI，不属于本轮同步目标 |
| Apple Mail `32565c52f52654ecb74235d53d215959da1a64af` / `69e8617d819ced85737dd2276121b4e0890e4211` | 暂不做 | AppleScript/Apple Mail 专属；Tauri 现有邮件集成是 QQ IMAP，语义和平台均不同 |
| Mochi 动画 `1fb21e8b1ed2d77f2e0f3ba30b631d850335b9a4` / `61ee8df17b40ab4af3fe4adcdf448fd3923c021f` / `956413fbd460c5e1c41305711234070998ef960d` | 不同步 | 源仓库是 Swift TimelineView 的连续调整；Tauri 已采用 RAF + `dt` 和睡眠节流模型 |
| 上游 0.4.0 整体合并 | 不做整体 merge | 上游包含 Android、Swift 原生版及 `windows/` 路径；本 Fork 已重命名为 `desktop/` 并有 DSH 定制 |
| Android Phone Link `0d0a543fade26e07a2b43596e8b0909d95a21c0d` | 后续单独评估 | 价值高但涉及约万行 Rust/TS/Kotlin、配对、TLS、Relay 和新的安全边界，不能顺手合并 |

## 本轮同步决策（2026-10-18）

范围：源仓库 `0dffbafcc0014d29e3e4af6fe9ba3a4ca063e105` → `434d6a2b4af2e5ce117fa425170abe25620130b9`（97 个非合并提交；其中 2026-10-16 16:06 之后 6 个 PR）。

### 已移植（逻辑移植，不直接 cherry-pick）

| 源提交 | 内容 | Fork 落地 | 验证 |
|---|---|---|---|
| `69e2231ccb2f450d8d3a1670b999bd40d7c67cc3`（#718）<br>`c7c36c5071fc1c58a971b568ff1e9a5c6ff9a136`（#781） | 错误岛显示 StopFailure 的真实错误；`error_type` 分类文案；`unknown` 时用最后消息 | `desktop/src/island/hooks.ts`（`stopFailureDetail`、StopFailure）、`desktop/src/views/views.ts`（错误卡片详情与按钮） | `desktop/tests/hooks.test.mjs` 4 组用例 |
| `2fb18a5c0125480f1651a2a63c7c0a67ef1ccd26`（#522） | 标签文字为 Mochi 留左边距 | `desktop/src/style.css` 的 `.pill .lbl` | 视觉检查 |
| #718 附带的错误文案 | 10 种语言 | `desktop/src/i18n/extra.json`（新增 30 条键） | `desktop/tests/i18n.test.mjs` |

### 本 Fork 自建：把 Claude Code 重新接回

`64c8c2b` 曾主动移除 Claude Code 标签；本轮按需求恢复并适配：

- `desktop/src/core/pills.ts`：新增 `integration_claude`（Claude Code）与 `agent_cursor`（Cursor）；`sessionSubtitle` 同步。
- `desktop/src/island/hooks.ts`：无 `coucou_agent` 的事件按 `term_editor` 路由到 `agent_cursor` 或 `integration_claude`；未声明的标签直接丢弃事件、权限请求立即退回终端；PermissionRequest / AskUserQuestion 复用现有卡片与队列。
- `desktop/src-tauri/src/agent_hooks.rs`：`agent_hooks_status` 增加 `integration_claude` 与 `agent_cursor`（Claude Code 的 hooks 存在即视为连接）。
- `desktop/src/settings/main.ts`：恢复「Claude Code」hooks 安装/卸载（差异预览、日期备份、显式确认）与「Claude 套餐」状态栏中继开关；安装/卸载只改 Coucou 自己的条目。
- `desktop/src/views/`：Claude Code 标签名、空闲卡片上的「Open Visual Studio Code」、错误/完成卡片的终端入口。

### 明确不做 / 不适用

| 源提交 | 原因 |
|---|---|
| #702 Flow prompt/翻译、#707 Notetaker 回声、#697 Mochi 生命体征与截图、`f931645e`、`b7e6c4b3` | Swift/AppKit 的 Mac 原生功能；Fork 的 Tauri 端没有对应实现，也不能宣称等价 |
| #782 / #783 `scripts/dev-install.sh` | macOS Swift 开发脚本；Fork 的 Mac 走 `npm run tauri dev` |
| `3b14a8fd90e615d49042eaeefa048ca8b32d92c3`（#530 OpenCode v2 插件） | `agents.rs` 的 `Agent::ALL` 只有 Codex，OpenCode 插件常量尚未接线，修了没有用户可见收益 |
| `355e02d5c94f6359a3fd5141a2da67d477d9792f`（#417 Claude Desktop MSIX 协议） | `open_claude_desktop` 在本 Fork 没有调用方；Claude Desktop 会话作为带标签的外部 agent 显示 |
| `35b662b3c7aa56be1577751fa8da3f8a0c9ccb59`（#409 文案统一） | 恢复的标签直接使用上游定稿名称 `Claude Code`，无需再改名 |
| i18n 重生成（`fad7cc41`、`6d6e52ba`、`f622b8b5`、`fddcdac2`、`8ab1fbaa`） | 生成物；Fork 的 `strings.json` 来自自己的历史 xcstrings，整体覆盖会带入不存在功能的文案。本轮只把新增的手写文案补进 `extra.json` |
| `d1ea8e39b2822dbd4d8dec47e1f46e1d37723d36`、`cb46e736422788532e3ef03e307db9d0d4d0da8a`、`d775e813a11a3c2a7d74635fbd3fad20abfe7800`、`b7205e6db71276967943e7e946f1bd2b7fe2ed23`（Windows/Linux 0.5.0） | `windows/` 约 1.5 万行新增，依赖 sherpa-onnx、音频抓取与 700 MB 模型下载链路，且与 Fork 的 DSH 定位冲突；维持「延期评估」 |
| `b9b92170a4db577940fb242ae15608faf5a6437d`（#467 WebView2 zoom/窗口尺寸同步） | 需在 125% / 150% 缩放屏实测裁剪问题；本轮不动窗口几何，单独立项验证 |

## 本轮同步决策（2026-10-20）

范围：源仓库 `434d6a2b4af2e5ce117fa425170abe25620130b9` → `47e4da358ca932867c1b7c84dba5275ae7375535`（66 个提交，覆盖 Mac 0.5.0~0.5.2 与 Windows/Linux 0.5.1）。

### 已移植（逻辑移植）

| 源提交 | 内容 | Fork 落地 | 验证 |
|---|---|---|---|
| `61d4156542acb2e4b87fae9c46a7b02f345b6e1c`（#709）<br>`acb4135c` / `ae05c037` | Antigravity 提问（`ask_question` / `default_api:ask_question`）状态识别、问题 Ticker 提取与响铃通知 | `desktop/src/island/hooks.ts`、`desktop/src/i18n/extra.json` | `desktop/tests/hooks.test.mjs` |
| `5d0b9bdadec0553f7c99d9ef5141097e6f8c3527`（#703）<br>`8d2632ca` / `db85ab40` | Claude Code 计划审批卡片（`ExitPlanMode`），计划首行作为标题展示，提供 Auto mode / Manual / Change plan 三分支选择，并透传 updatedInput 与 setMode | `desktop/src/views/views.ts`、`desktop/src/island/hooks.ts`、`desktop/src/island/island.ts`、`desktop/src/core/bridge.ts`、`desktop/src-tauri/src/pipe.rs`、`desktop/hook/src/` | `desktop/tests/hooks.test.mjs` |
| `8c812a9f72f17050f636c58e1b5c58745b4cd9e7`（#761）<br>`f90ec24d` / `aa6d34fb` | 胶囊展示名优化与工作会话动态绑定：优先取 `session_title`（`/rename`）与启动根目录 `session_root`，并发多会话时胶囊展示名自动跟随当前 working 的活跃会话 | `desktop/src/core/state.ts`、`desktop/src/island/hooks.ts` | `desktop/tests/hooks.test.mjs` |
| `1cb7b954b92025791bfcf4ee4d1e1e1815e6e18d`（#788）<br>`e67198eb` | 紧凑灵动岛居中时钟（Island clock），设置项开关、多语言与 10s 平滑刷新 | `desktop/src-tauri/src/settings.rs`、`desktop/src/core/state.ts`、`desktop/src/island/island.ts`、`desktop/src/settings/main.ts`、`desktop/src/style.css`、`desktop/src/i18n/extra.json` | `desktop/tests/i18n.test.mjs`、`tsc --noEmit` |

### 明确拒绝 / 暂不做

| 源提交 | 决策 | 原因 |
|---|---|---|
| `5658ef1bbc4fc328be67d344850139fe66b68cf7`（#822 Windows Updater） | **明确拒绝** | 上游更新器硬编码拉取源仓库 release 安装包，静默升级会直接覆盖冲掉本 Fork 的 DSH 增强特性，危及仓库定位 |
| `6a8ed6dd3d6224ec10beb377e51d1ed7fba50934`（#798 / #800 WhatsApp pill） | 暂不做 | Swift/AppKit 原生网关实现，Tauri 桌面端暂不适用 |
| `d7f6c060d418728a2a890987c2688f01f70fe87a`（#817 Linux idle CPU） | 不适用 | 针对源仓库 0.5.0 新增的 hub 大模型窗口（本 Fork 尚未引入该模块，无此问题） |
| `869298f11de361a0c8c8d6dd6e373d27d68ea982`（#719 终端前台静音） | 参考不落地 | 依赖 macOS 原生 `NSWorkspace` 前台窗口进程 API，跨平台实现成本高 |
| `e70ea42f7a689d1eec1610a5d40a42c73bbeb326`（#823 Alerts from every pill） | 延期评估 | Swift 原生端实现，且跨胶囊强行弹岛可能打扰用户工作，维持现有徽标方案 |
| `e6b8dfdfc830a6f0c7e90e368bcd822543ebf713`（#821 德语/土耳其语/泰语等） | 按需吸收 | 本 Fork 仅增补移植特性所需的 7 条多语言字段至 `extra.json`，不整体覆盖 strings 生成物 |

### 本轮验证

- `desktop` 测试：`node node_modules/typescript/bin/tsc --noEmit` 0 错误通过。
- `desktop` 单元测试：`node --import ./tests/setup.mjs tests/hooks.test.mjs` 53 passed，0 failed；`tests/i18n.test.mjs` 16 passed，0 failed；`tests/pills.test.mjs` 14 passed，0 failed；`tests/fsm.test.mjs` 52 passed，0 failed；`tests/agents.test.mjs` 4 passed，0 failed。

## 本轮同步（2026-10-26）

- 源仓库范围：`47e4da358ca932867c1b7c84dba5275ae7375535`(Mac 0.5.2 / Win-Linux 0.5.1) → `47d1c2da12bf1dce8fb28b825757d497c1e1d88d`(Mac 0.5.3 / Win-Linux 0.5.3 / Android 0.3.0)
- 提交规模：99 个（80 个非合并 + 19 个合并），覆盖 Mac 0.5.3、Windows/Linux 0.5.2~0.5.3、Android 0.3.0~0.3.7
- Fork 快照：`dd467b95040ebd2eed728c2cac6f474bcc981c97`（`main`，领先 `origin/main` 2 个提交）
- 共同祖先：`c946650bec0e37fd902322c8f149b7e83f06d22f`（未变）
- 平台分布：44 个提交只动 `android/`（另 9 个同时动文档/CI），5 个只动 `NotchBuddy/`，17 个动 `windows/`（对应本 Fork 的 `desktop/`），其余为 CHANGELOG/README/Homebrew cask/CI
- 决策：**已移植 #1 / #2 / #3**（逻辑移植，非 cherry-pick）；同步游标前移到 `47d1c2da…`。`#4` 延期、`#5` 参考不落地，均为已决策项，不算跳过

### 候选清单（按实施顺序）

| # | 源提交 | 内容 | 落地面 | 规模 | 决策 |
|---|---|---|---|---|---|
| 1 | `852df6f5729fbf342da1fbce2af87ae483ce58ee` | 换显示器（不同缩放比）后 Mochi 的 canvas 位图仍按旧 DPR 尺寸，被裁切或虚化；同时把 `resolution` 媒体查询改为每次变更后重新挂载 | `desktop/src/island/island.ts`（`canvasPx` → 增加 `canvasDpr`）、`desktop/src/desktop/main.ts`、`desktop/src/mochi/minibots.ts`、`desktop/src/views/wardrobe.ts`、`desktop/src/main.ts` | 5 文件 / 41 行 | **已直接移植**：`island.ts` 增加 `canvasDpr` 并在问候画布上按 DPR 重建位图；`desktop/main.ts`、`minibots.ts`、`wardrobe.ts` 三处画布跟随 DPR；`main.ts` 的 `screen-changed` 改为 `reposition` + `ensureRunning`，并按上游把 `resolution` 媒体查询改为每次变更后重新挂载。上游的 `checkZoom()` 未移植（本 Fork 从未做 #467 的窗口/缩放同步） |
| 2 | `dc672ba4d537b9a2c1f18820b32180ec621dff61`<br>`57063af97924aadd8406fbd755131e5a89a544bc`（仅 `mochi/engine.ts` 部分） | 有新版等待时 Mochi 变蓝并戴上箭头徽标，托盘图标同步变蓝 | `desktop/src/mochi/engine.ts`（新增 `arrow` 徽标 + `setUpdateHint`）、`desktop/src-tauri/src/tray.rs`（`tint_blue` / `tray_update_hint`）、`desktop/src/core/bridge.ts` | 约 150~200 行 | **已逻辑移植**：`engine.ts` 的 `arrow` 徽标 + `setUpdateHint`/`showsUpdateHint`/`stateBadge`、`tray.rs` 的 `tint_blue` + `tray_update_hint` 命令（含单测）、`bridge.ts` 的 `trayUpdateHint`。不引入上游 `update.rs`：`check_for_update` 增加 `AppHandle` 并向所有窗口发 `update-found`，`island/update.ts` 收下、持久化到 localStorage（版本比当前新才认），据此决定蓝色与托盘；「稍后」24 小时 |
| 3 | `5075a2041e8a27e6e3dd205aee84feed4e58845a`<br>`57063af…`（`whats-new/*`、`views/whatsnew.ts`、`island/update.ts`）<br>`b292400c839d0e93eaa9161ed7085367ed9b192b`<br>`d6cdc363141b42b3d94e9b1f05824f633cd69be7` | 更新后展示 What's new 卡（含发布数据与校验脚本） | 新增 `desktop/src/whats-new/`、`desktop/src/views/whatsnew.ts`、`desktop/src/island/update.ts`、`scripts/test-whats-new.py`、i18n | 约 800 行 + 数据文件 | **已逻辑移植并裁剪**：新增 `src/whats-new/{whats-new.ts,whats-new.json,icons.ts,controller.ts}`、`src/views/whatsnew.ts`、新增 `whatsnew` 视图与布局。去掉依赖 Flow/Notetaker 的「Your Coucou so far」第二步与咖啡链接（用户要求：不需要 Flow 的部分）；`scripts/test-whats-new.py` 未移植，改由 `tests/whats-new.test.mjs` 校验「当前版本有词条且十种语言齐全」。首装判定用 Rust `BootInfo.firstRun`（启动时 settings.json 不存在），替代上游的 `usedBefore(consent/history/flow/notes)` |
| 4 | `0453d296f7ebba569ee8e5556c5077d5617c7638`<br>`c5cea3f25f2bc2610ab9f178ca71aa0df45b2cdc`<br>`a7fe6ce318d6b3fbcc352cbb863187a8ba65c1c2` | WhatsApp 胶囊（实验性）：接收消息、会话列表、回复；一键安装 GOWA 网关并校验 SHA-256；可对接自建 GOWA / OpenWA | 新增 `desktop/src-tauri/src/whatsapp/`（9 文件）、`desktop/src/{core,island,views,settings}/whatsapp.ts`、`secrets.rs` 3 个内部 key、`Cargo.toml` 增加 `miniz_oxide`（已由 png 传递依赖） | 约 6.4k 行 | **延期评估（单独立项 + 安全评审）**：技术上比预期可移植——Rust 侧只依赖 serde/tauri/reqwest/tokio，不碰 `phone_link`/`voice`/`flow`；前端只依赖本 Fork 已有的 `bridge`/`state`/`sound`/`layout`/`i18n`/`views/dom`。代价是外部网关进程、本地 webhook 端口与凭据存储，需单独评审后再动 |
| 5 | `15a2be2bdd7f7a9af877bb5a9c9d4ef2640e8eac`（GitLab pulse）<br>`3a7416f54a2cb321a1b31e00ece29d43ddcb068a`（Gitea pulse）<br>`3b42d32c828e6b7bf60250c911a78fadf2b24f1c`<br>`0b536440b6032452718947dc2bd3cec58024b7f3` | 把 GitLab/Gitea 收进统一的 forge 卡（贡献日历、统计、列表），并修多 forge 卡片串状态 | 上游 `windows/src-tauri/src/integrations.rs` + `windows/src/views/github.ts` | 约 700 行 | **参考不落地**：本 Fork 的 GitLab 是独立的 `src-tauri/src/gitlab.rs` + 简化卡片，接受上游等于重写现有实现；Gitea 属新增第三方集成，按需另立 |

### 明确不做 / 不适用

| 源提交 | 原因 |
|---|---|
| 44 个只动 `android/` 的提交（Android 0.3.0~0.3.7：主题、TalkBack、语言、周报、快捷方式、Share target 等） | 本 Fork 没有 `android/`，全部不适用 |
| 5 个只动 `NotchBuddy/` 的提交（Mac 蓝 Mochi、WhatsApp Status、What's new 数据） | Swift 原生端；即便做 #2，也只移植 Tauri 侧逻辑 |
| `55e6b64` / `326ddef`（Phone link 周报能力） | 本 Fork 无 `phone_link` 模块 |
| `45d4bd6` / `6c4c8b6` / `ddc1685` / `5b6f213`（版本号、README、Homebrew cask、CHANGELOG） | 本 Fork 自有发布流程与版本线 |

### 待决与隐患

- 待用户确认：#4（WhatsApp 胶囊）是否立项。
- 版本号随本轮升到 `0.3.2`（`package.json`、`package-lock.json`、`Cargo.toml`、`Cargo.lock`、`tauri.conf.json`），`whats-new.json` 已按 `0.3.2` 写了词条；发版打 tag 前若改版本号，必须同步改词条的 `version`。
- `57063af` 中 `windows/src/i18n/extra.json` 有 10496 行变更，绝大部分是重排噪声；本 Fork 的 `extra.json` 是手写维护的，只能按 key 增补，禁止整文件覆盖（本轮新增 5 条）。
- `desktop/src/views/github.ts` 的 `openSection` 仍是模块级单例（上游在 `3b42d32` 改为 per-provider `Map`）。本 Fork 目前只有一张 forge 卡，暂无用户可见问题；引入第二张卡前必须先按上游改法拆分。

### 本轮验证

- `node node_modules/typescript/bin/tsc --noEmit`：0 错误。
- `node --import ./tests/setup.mjs --test "tests/**/*.test.mjs"`：443 测试，441 passed、2 skipped、0 failed（新增 `tests/whats-new.test.mjs` 10 项，覆盖版本比较、词条与十种语言、图标、首装/升级/降级决策、蓝色规则与引擎徽标、release 页 URL）。
- `npm run build`：通过（82 modules，`dist/` 正常产出）。D 盘沙箱下需把 esbuild 二进制放到 C 盘并设 `ESBUILD_BINARY_PATH`。
- `CARGO_TARGET_DIR=<C 盘临时目录> cargo check -p coucou --offline`：通过（仅既有 warning）。
- `cargo test -p coucou --offline`：245 passed、0 failed、1 ignored（新增 `tray::tests::the_body_turns_blue_the_outline_stays`）。

## 功能状态总表

| 领域 | 源仓库近期状态 | 本 Fork 状态 | 同步策略 |
|---|---|---|---|
| 权限请求 | FIFO queue + Plan approval (#703) | 已移植：队列 + ExitPlanMode 计划卡片与三选项 | 保持独立逻辑，测试覆盖 |
| 多 Claude / Agent session | session registry + working owner (#761) | 已移植：per-session 状态 + 活跃工作会话动态绑定 | 已完成移植与单测 |
| Claude Code | Mac 原生完整；Windows/Linux 走 hooks | 已恢复并扩展：hooks 安装/卸载、ExitPlanMode 计划卡片、错误详情、用量、Cursor 标签 | 与上游行为保持一致并做跨平台适配 |
| 智能体提问 | Antigravity 提问通知 (#709) | 已移植：ask_question 识别、提问状态与响铃 | 已完成移植与单测 |
| 紧凑时钟 | Island clock (#788) | 已移植：紧凑灵动岛居中时钟与设置项 | 纯前端与 settings 扩展 |
| 自动更新 | 上游 Windows/Mac 自动更新器 (#822) | 明确拒绝（避免覆盖本 Fork 增强版本）；只吸收「有新版时 Mochi 与托盘变蓝」（2026-10-26） | 维持 Fork 独立发布流程，检查仍是手动的 |
| 更新说明卡 | What's new after update (#910 周期内) | 已移植（去掉依赖 Flow 的第二步） | 每版在 `whats-new.json` 补词条，测试会拦 |
| 多显示器 / DPI | 换屏后按新 DPR 重画 | 已移植（`canvasDpr` + 媒体查询重挂载） | 与上游一致 |
| Android 手机连接 | 已有 Phone Link | 未实现 | 另立设计和安全评审 |
| Voice | macOS 原生完整功能 | 未实现 | 暂不做 |
| Mail | Apple Mail | QQ IMAP / Web 邮件卡片 | 不直接同步 |
| Crypto | Coinbase / OKX | 未实现 | 暂不做 |
| Mochi 动画 | Swift display-rate 调整 | Tauri RAF + `dt` | 不 cherry-pick |
| 发布流程 | 上游 `windows-v0.5.1` / `mac-v0.5.2` | Fork 自有版本/CI（v0.2.2） | 只选择性吸收 CI 修复 |

## 本轮验证

- `cd desktop && npm test`：针对 `hooks`、`i18n`、`pills`、`fsm`、`agents` 单元测试全部通过。
- `node node_modules/typescript/bin/tsc --noEmit`：TypeScript 类型检查通过。
- 本轮未直接合并源仓库分支；已按 Tauri 跨平台架构完成 PR #709、PR #703、PR #761、PR #788 逻辑移植。

## 下次同步的入口

1. 读取本文件的“最近一次同步基线”。
2. fetch 源仓库，但不要直接 merge `main`。
3. 只查看基线之后的提交，按 `desktop/`、Rust、前端、relay、Swift、Android 分类。
4. 对每个候选提交记录：功能摘要、涉及平台、与 Fork 的对应文件、是否移植、理由和测试要求。
5. 完成后更新本文件的基线、决策表和功能状态；如有行为变化，补 `CHANGELOG.md`。
6. 修改基线前必须运行测试并记录结果。

同步流程和文档格式要求见 [同步与文档规范](SYNC-GUIDELINES.md)。
