# 源仓库同步与文档规范

本规范适用于 `Nomit8088/coucou` 从 `Louis-CFM/coucou` 选择性吸收改动。目标是可追溯、可复现、可回退，而不是追求 Fork 与源仓库的提交线完全一致。

## 一、同步规范

### 1. 先确认边界

- 源仓库固定为 `https://github.com/Louis-CFM/coucou.git`。
- 当前活动桌面端固定为 `desktop/`；源仓库的 `windows/` 只是历史路径，移植时按功能映射。
- `NotchBuddy/`、`android/`、relay 和网站必须分别判断，不能因为同名文件就直接覆盖。
- 不直接 merge 源仓库 `main`，除非先完成完整冲突、平台和安全评审。

### 2. 以 commit 为同步游标

每轮同步必须记录：

- 源仓库完整 commit hash（禁止只记录短 hash）；
- Fork 当时的完整 HEAD hash；
- merge-base；
- fetch 时间（使用北京时间）；
- 比较命令和测试命令。

同步游标只在“候选改动已完成决策、文档已更新、验证已完成”后前移。未决定或延期的提交不能被悄悄跳过，应在状态文档中注明。

标准命令：

```sh
git fetch --no-tags https://github.com/Louis-CFM/coucou.git main
git merge-base HEAD FETCH_HEAD
git rev-list --left-right --count HEAD...FETCH_HEAD
git log --no-merges --date=short --format="%H %ad %s" <last-upstream>..FETCH_HEAD
git diff --stat <last-upstream>...FETCH_HEAD
```

### 3. 逐提交分类

每个候选提交至少归入一类：

- **直接移植**：路径、平台和架构兼容；
- **逻辑移植**：只吸收行为/算法，重新按 Tauri 实现；
- **参考不落地**：记录设计，但当前没有实现计划；
- **明确拒绝**：平台冲突、安全风险、重复实现或维护成本不合理；
- **延期评估**：价值明确，但需要单独设计、依赖或安全评审。

对“逻辑移植”必须写明源提交、目标文件、行为差异和回归测试；禁止只写“已同步”。

### 4. 安全与行为要求

- 不同步会改变权限默认值、自动批准、凭据存储或网络暴露面的代码，除非完成安全评审。
- 权限请求必须 fail-closed；队列满、超时、断线和未知请求不得自动 Allow。
- 不覆盖用户配置文件；安装器、hook 和设置写入必须保留备份、预览和明确确认。
- 不把 Swift/macOS 特有能力宣传为 Windows/Linux/macOS Tauri 已支持。
- 任何跨端协议变更都要检查 Rust、TS、hook、测试和文档的兼容性。

### 5. 验证要求

最少执行：

```sh
cd desktop
npm test
npm run build
```

涉及 Rust 协议、hook 或权限流时，还应执行：

```sh
cargo test --workspace --locked
```

验证失败时不得推进同步游标；必须记录失败命令、失败原因和后续处理。

## 二、同步记录规范

推荐在 `docs/SYNC-STATUS.md` 中维护总表；每次较大的专题同步可以建立独立记录，例如 `docs/sync/2026-10-phone-link.md`。

每个记录至少包含：

```markdown
## YYYY-MM-DD — 简短主题

- 源仓库范围：`<old-full-hash>..<new-full-hash>`
- Fork 快照：`<full-hash>`
- 决策：直接移植 / 逻辑移植 / 参考 / 拒绝 / 延期
- 影响平台：Windows / macOS / Linux / Android / Swift 原生
- 涉及文件：源路径 → Fork 路径
- 理由：平台、架构、安全和维护成本
- 验证：命令与结果
- 后续：明确下一步或“无”
```

## 三、文档规范

### 文件和链接

- 文档标题使用中文，专有名词、路径、命令和 commit 保留原文。
- 文件名使用大写短横线风格，例如 `SYNC-STATUS.md`、`SYNC-GUIDELINES.md`。
- 引用仓库文件使用相对链接；引用行号时使用 `path#L10-L20`。
- 外部仓库、提交和 Release 使用完整 URL。
- 不在多个文档复制易过期的完整功能表；总状态放在 `SYNC-STATUS.md`，规则放在本文件。

### 版本和时间

- commit 必须使用完整 40 位 hash；表格中可同时显示短 hash，但完整 hash 必须可查。
- 不使用“最近”“之前”等无基准表述；写明日期、时区和 commit 范围。
- “已同步”只表示代码或逻辑已经进入 Fork 并通过验证；“已评估”不等于“已实现”。
- 延期或拒绝必须写理由，避免下次重复调查同一功能。

### 变更纪律

- 功能实现变更更新对应专题文档；发布行为变更更新 `CHANGELOG.md`。
- 文档新增或改写后检查链接、命令、路径和版本号是否仍准确。
- 不把临时研究输出、未经核实的上游描述或猜测写成事实。
- 删除旧决策时，应把原因迁移到新的记录，而不是无痕删除。

## 四、每轮同步检查清单

- [ ] 已读取 `docs/SYNC-STATUS.md` 的上次源仓库完整 hash。
- [ ] 已 fetch 源仓库并记录新的完整 hash、Fork HEAD 和 merge-base。
- [ ] 已逐提交分类，没有直接 merge 未审查的上游分支。
- [ ] 每个重要决策都有理由和目标平台说明。
- [ ] 已检查 `desktop/` 路径重命名及 Swift/Android 平台差异。
- [ ] 权限、凭据、网络和配置写入变化完成安全检查。
- [ ] 已运行相关测试和构建，并记录结果。
- [ ] 已更新同步状态文档；必要时更新 CHANGELOG、README 或专题文档。
- [ ] 同步游标只前移到本轮实际完成决策的源仓库 commit。
