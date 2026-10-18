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
| 源仓库上游已比较 | `434d6a2b4af2e5ce117fa425170abe25620130b9` | `Louis-CFM/coucou` `main`，2026-10-17 04:53（Asia/Shanghai）；上一轮基线 `0dffbaf…` 之后的 97 个非合并提交已逐项分类（见下） |
| Fork 记录快照 | `b4054f08eb9abcbaa564b5dfdb38affa7f6a3dbb` + 2026-10-18 工作区改动 | 本轮在 `main` 之上恢复 Claude Code 适配并移植错误卡片逻辑 |
| 共同祖先 | `c946650bec0e37fd902322c8f149b7e83f06d22f` | 本轮比较使用的 merge-base（未变） |
| 比较结果 | 源仓库独有 276，Fork 独有 33 | `git rev-list --left-right --count fork/main...upstream/main` |
| 记录时间 | 2026-10-18 16:30（Asia/Shanghai） | 本文档本轮更新时间 |

下次同步从源仓库 `434d6a2b…` 之后的提交开始检查，而不是从 Fork 的 HEAD 猜测。

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

### 本轮验证

- `desktop` 测试：25 个测试文件通过；`dsh-plugin.test.mjs` 与 `dsh-questions.test.mjs` 在本机沙箱中无法运行（禁止进程打开命名管道，失败特征为管道连接超时，与本次改动无关）。
- `node node_modules/typescript/bin/tsc --noEmit` 通过。
- Rust：`cargo test --workspace --locked`（临时 `CARGO_TARGET_DIR`）：253 passed，1 failed——`files::tests::ingest_copies_and_never_overwrites` 在沙箱里无法在系统临时目录建目录（os error 5），与本轮改动无关；`agent_hooks` 模块 6 个测试全部通过。

## 功能状态总表

| 领域 | 源仓库近期状态 | 本 Fork 状态 | 同步策略 |
|---|---|---|---|
| 权限请求 | FIFO queue | 已移植为 Tauri 状态模型 | 保持独立，继续补场景测试 |
| 多 Claude / Agent session | session registry | 已移植为 per-session 状态 | 以后新增事件必须带 session 维度 |
| Claude Code | Mac 原生完整；Windows/Linux 走 hooks | 已恢复：hooks 安装/卸载、会话、权限与提问卡片、错误详情、Claude 套餐用量、Cursor 标签 | 与上游 Windows 行为保持一致 |
| Android 手机连接 | 已有 Phone Link | 未实现 | 另立设计和安全评审 |
| Voice | macOS 原生完整功能 | 未实现 | 暂不做 |
| Mail | Apple Mail | QQ IMAP / Web 邮件卡片 | 不直接同步 |
| Crypto | Coinbase / OKX | 未实现 | 暂不做 |
| Mochi 动画 | Swift display-rate 调整 | Tauri RAF + `dt` | 不 cherry-pick |
| 发布流程 | 上游 `windows-v0.5.0` | Fork 自有版本/CI（v0.2.1） | 只选择性吸收 CI 修复 |

## 本轮验证

- `cd desktop && npm test`：395 passed，2 skipped，0 failed。
- `cd desktop && npm run build`：TypeScript、Vite 和 Rust hook 构建通过。
- 本轮未直接合并源仓库分支；已按 Tauri 逻辑重新实现队列和 session 隔离。

## 下次同步的入口

1. 读取本文件的“最近一次同步基线”。
2. fetch 源仓库，但不要直接 merge `main`。
3. 只查看基线之后的提交，按 `desktop/`、Rust、前端、relay、Swift、Android 分类。
4. 对每个候选提交记录：功能摘要、涉及平台、与 Fork 的对应文件、是否移植、理由和测试要求。
5. 完成后更新本文件的基线、决策表和功能状态；如有行为变化，补 `CHANGELOG.md`。
6. 修改基线前必须运行测试并记录结果。

同步流程和文档格式要求见 [同步与文档规范](SYNC-GUIDELINES.md)。
