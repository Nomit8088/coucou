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
| 源仓库上次已比较 | `0dffbafcc0014d29e3e4af6fe9ba3a4ca063e105` | `Louis-CFM/coucou` `main`，2026-10-12；邮件详情角落布局修复之后 |
| Fork 记录快照 | `7b10f80d242507b0c527cc80d91c98adcacf4f6f` | 当前 Fork 文档建立时的 `main` |
| 共同祖先 | `c946650bec0e37fd902322c8f149b7e83f06d22f` | 本轮比较使用的 merge-base |
| 比较结果 | Fork 独有 28，源仓库独有 132 | `git rev-list --left-right --count HEAD...FETCH_HEAD` |
| 记录时间 | 2026-10-13 01:05（Asia/Shanghai） | 本文档建立时间 |

下次同步从源仓库当前 `main` 与 **`0dffbaf...` 之后**的提交开始检查，而不是从 Fork 的 HEAD 猜测。

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
| 上游 0.4.0 整体合并 | 不做整体 merge | 上游包含 Android、Swift 原生版及 `windows/` 路径；本 Fork 已重命名为 `desktop/` 并有 DSH/Cteams 定制 |
| Android Phone Link `0d0a543fade26e07a2b43596e8b0909d95a21c0d` | 后续单独评估 | 价值高但涉及约万行 Rust/TS/Kotlin、配对、TLS、Relay 和新的安全边界，不能顺手合并 |

## 功能状态总表

| 领域 | 源仓库近期状态 | 本 Fork 状态 | 同步策略 |
|---|---|---|---|
| 权限请求 | FIFO queue | 已移植为 Tauri 状态模型 | 保持独立，继续补场景测试 |
| 多 Claude / Agent session | session registry | 已移植为 per-session 状态 | 以后新增事件必须带 session 维度 |
| Android 手机连接 | 已有 Phone Link | 未实现 | 另立设计和安全评审 |
| Voice | macOS 原生完整功能 | 未实现 | 暂不做 |
| Mail | Apple Mail | QQ IMAP / Web 邮件卡片 | 不直接同步 |
| Crypto | Coinbase / OKX | 未实现 | 暂不做 |
| Mochi 动画 | Swift display-rate 调整 | Tauri RAF + `dt` | 不 cherry-pick |
| 发布流程 | 上游 `windows-v0.4.0` | Fork 自有版本/CI | 只选择性吸收 CI 修复 |

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
