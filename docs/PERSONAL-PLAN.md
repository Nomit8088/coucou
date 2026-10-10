# Coucou 个人 fork 方案（Windows）

写于 2026-10-09。仓库上游是 [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou)，个人 fork 是 [Nomit8088/coucou](https://github.com/Nomit8088/coucou)。本文件是个性化改造的唯一施工依据；官方 `docs/SPEC.md` / `docs/AGENTS.md` / `docs/INTEGRATIONS.md` 描述的是上游产品，不要按它们恢复已删功能。

**本轮只做 Windows**（`windows/`）。Mac（`NotchBuddy/`）、iPhone、`relay/` 不改；Mac 适配备忘见文末。

---

## 1. 产品范围

### 保留（壳）

岛、Mochi、服装、桌面拖出、声音、周报 recap、快捷键、10 语、文件拖放、Demo（按新 pill 改脚本）。壳不精简。

### 编码 Agent

只留 **DSH** 和 **Codex**。

- 默认主 pill：`agent_dsh`
- 旁边最多 4 个声明 pill：`agent_codex`、`integration_github`、`integration_resend`、`integration_gitlab`
- `coucou-hook` + named pipe 留下（两条 Agent 都走它）
- 无 `coucou_agent` 的 hook 事件直接丢弃，不再进 Claude Code pill
- `takes_decisions` / `APPROVAL_AGENTS` 只认 `codex` 和 `dsh`

### 岛内 API 问答

现有 Anthropic / Google / OpenAI / OpenRouter / Ollama / LM Studio **全部删除**。换成：

- **DeepSeek 预设**
- **任意 OpenAI 兼容提供商**（名称 / Base URL / API Key / 模型）

岛内聊天是 Coucou 自己打 HTTP，**不是** DSH 会话，聊天框不调用 `steer()`。

### 服务 pill

留 **GitHub**、**Resend**，新增 **GitLab**。删除 Stripe / n8n / Vercel / Notion / Cal.com / Apple Music。

GitHub = 个人项目（现有逻辑不动）。GitLab = 企业私有部署（新写）。

---

## 2. 从 Windows 删除的东西

从设置 UI、pill 目录、轮询、安装器、测试里拿掉，不只是藏按钮。

| 删除 | 备注 |
|---|---|
| Claude Code 安装器、套餐 statusLine、`integration_claude` 主 pill | hook 可执行文件留下 |
| Cursor / Gemini CLI / Antigravity / Copilot CLI / Muse / OpenCode / Amp / Hermes / Claude Desktop | 安装器 + `KNOWN_AGENTS` + 目录项 |
| `ai_anthropic` / `ai_google` / `ai_openai` / Ollama / LM Studio、`claude.rs` Messages 路径 | 聊天整表替换 |
| n8n / Vercel / Stripe / Notion / Cal.com / Music 的 poller 与卡片 | `integrations.rs` 不再 spawn |
| Claude 套餐用量 | Codex 套餐用量保留 |

Demo 改为：DSH 会话 + Codex 批准 + GitHub / GitLab / Resend 假数据 + DeepSeek 流式聊天。

---

## 3. Codex（几乎不改）

现有路径保留：

- Settings → Agents → Codex → 写 `%USERPROFILE%\.codex\hooks.json`，`--agent codex`
- 岛上 Allow / Deny（无 Always）
- Codex 套餐用量 pill 可继续
- ↗ 仍是把会话窗口提到前台（`openSession`），**不**往 Codex 注入文本

Codex 不走 DSH 插件。

---

## 4. 岛内问答：DeepSeek + 动态提供商

参考 DSH 模型选择器的交互（先提供商、再模型），不搬 DSH 进程内 `ModelSelection`。

### 设置 → 聊天提供商

可增删的列表：

1. **内置 DeepSeek**（不可删名称）
   - 默认 Base URL：`https://api.deepseek.com/v1`
   - Credential 条目：`deepseek-api-key`
   - `GET /models` 拉列表；默认模型 `deepseek-chat`
   - `deepseek-reasoner` 的 `<think>` 继续隐藏
2. **自定义 OpenAI 兼容**
   - 字段：名称、Base URL、API Key（各一条 Credential）、默认模型
   - 协议：`POST /chat/completions`（stream）+ `GET /models`
   - 覆盖企业网关、硅基流动、OneAPI、vLLM 等
   - 不单独做 Ollama；若要用，用户自己填 `http://127.0.0.1:11434/v1`

### 聊天框

- 芯片两级：提供商 → 模型。无 key / URL 的提供商不出现
- 无 tools、无 web search
- 拖入文本文件最多 24k 内联（保持现状）
- Base URL 只允许 `https://`，或指向本机的 `http://`
- key 不进 settings JSON、不进日志、不进界面明文（Credential Manager）

实现落点（Windows）：重写 `windows/src/core/providers.ts`、`windows/src-tauri/src/openai_compat.rs`、设置页 Chat 段；删除 Anthropic 专用 Messages 客户端作为默认聊天路径。

---

## 5. GitLab（企业）

新 pill：`integration_gitlab`，颜色 `#FC6D26`。

设置两项：

- Base URL（如 `https://gitlab.company.com`）
- Access token（Credential；请求头 `PRIVATE-TOKEN`）

卡片只要 MR + pipeline，**不要**贡献格子：

| 行 | API |
|---|---|
| My MRs | `GET /api/v4/merge_requests?state=opened&scope=created_by_me` |
| To review | `scope=to_be_reviewed`；旧版没有则退回 `reviewer_id=me` |
| Default branch CI | 最近活跃项目默认分支的 `pipelines`（pending / running / success / failed） |

规则：

- 打开链接只用配置的 host，不要写死 `github.com` 或 `gitlab.com`
- 轮询抄 GitHub：5 分钟；有 pipeline 在跑 1 分钟；打开卡片且数据旧于 1 分钟立刻拉
- Pause 或没勾 pill 不请求
- 某块 API 失败只空那一块，不把整颗 pill 打成 error

GitHub 个人项目：现有 GraphQL pulse、贡献格子、token `github-token` **不动**。

实现落点：`windows/src-tauri/src/integrations.rs` 新 poller、`windows/src/views/` 新卡片、`pills.ts` / Settings Integrations 增一项。不要改 GitHub poller 打补丁。

---

## 6. DSH 完整集成

**不要**再写 `dsh-hooks.json`，**不要**把展示和批准拆成两期。只装一个 Cordis 插件。

背景（已核对 DSH 0.2.x 与 Coucou 源码）：

- Coucou 是 hook JSON 消费者；`coucou_agent` 须匹配 `^[a-z0-9-]{1,24}$`，名字用 `dsh`，pill 为 `agent_dsh`
- `@deepseek-ai/dsh-hooks-claude-code` 能转发展示事件，但 **没有** `PermissionRequest`、`SessionEnd`、`last_assistant_message`；`approval/request` 只有 `toolName` / `callId?` / `reason`，没有参数
- `allow` 不会预批准；`ask` 只会交给 DSH 自己的 UI
- DSH 工具名是小写：`pwsh`、`bash`、`read`、`write`、`edit`、`grep`、`glob`、`web_search`、`web_fetch`；参数形状与 Claude Code 类似（`file_path`、`old_string`、`new_string`、`content`、`command`）
- **不要**把 `ask_user_question` 别名成 `AskUserQuestion`
- **不要**把 DSH `configPath` 指到 `~/.claude/settings.json`
- `steer()` 只在 DSH 进程内；从岛上发指令必须走插件
- 配置只在 DSH 启动时读一次，改完必须重启 DSH
- 不要在 DSH 会话里挂长期 `npm run tauri dev`（重启 DSH 会杀掉子进程树）

### 6.1 安装

Settings → Agents → DeepSeek Harness：

1. 把插件写到 `%LOCALAPPDATA%\Coucou\dsh-plugin\`
2. 在当前 profile 的 `cordis.patch.yml` 里 `insert` 一段，**固定 id** `coucou`；卸载只删这一段
3. 预览 diff、dated backup、确认后写（与 Codex 同一套 `config_file` 纪律；YAML 是新能力）
4. 提示必须重启 DSH
5. 默认 profile：`%USERPROFILE%\.dsh\profiles\web`；设置里可改路径

检测已安装：patch 里有 id `coucou` 且插件文件存在。

### 6.2 插件职责

**展示（不阻塞 DSH）**

| DSH | 岛上 |
|---|---|
| `agent/created` | `SessionStart` → 出现 `agent_dsh` |
| 用户消息 | `UserPromptSubmit`（thinking，ticker 是 prompt） |
| `tools/pre-execute` | `PreToolUse` + **缓存 `callId → 参数`** |
| `tools/post-execute` | `PostToolUse`（`edit` / `write` 出 diff） |
| `agent/turn-stopping` | `Stop`；尽量带上最后一句助手文本 |
| 子代理起停 | ticker 一行 |
| agent 销毁 | `SessionEnd` |

IPC：Windows 上插件直接写 `\\.\pipe\coucou-<SID>`（与 hook 同一行 JSON）。Coucou 没开就丢掉，DSH 继续。展示路径不得对工具返回 `deny` / `ask`。

小写工具名：`windows/src/island/hooks.ts`、`windows/src/core/diff.ts`、**以及** `windows/hook/src/main.rs` 的 `DIFF_TOOLS`（必须同时认 `edit` / `write` 与 `Edit` / `Write`）。Codex 仍是 PascalCase，两套都留。

**批准**

- 做 `approval/request` 的 answerer
- 用 `callId` 从缓存补全参数，岛上显示 `write · C:\…\.env`，不能只有工具名
- Allow → `allowed-once`，Deny → `rejected`（DSH 没有 Always）
- Coucou 与 Web GUI 同时问：插件立刻 `next()`，也把请求打到岛上；先点的算数，后点的忽略。Coucou 没开或超时不单独劫持，Web 继续等
- **禁止**默认放行；没有人工点击不得 `allowed-once`
- `dsh` 加入 `takes_decisions`（`windows/hook/src/reply.rs`）和 `APPROVAL_AGENTS`（`windows/src/island/agents.ts`）

**提问**

- 做 `user-questions/request` 的 answerer
- DSH 形状：`{ id, question, header?, options?, multiSelect? }`，不要当成 Claude 的 `AskUserQuestion`
- 岛上现有提问卡可复用展示；回传按 id 填 `answers`
- 失败不单独劫持：Web GUI 与岛上同时问，先答的算数

**从岛上发下一句 / 拖文件（反向通道）**

Coucou 现在的 Ask 页只打 HTTP 聊天；↗ 只提窗口。DSH 注入必须走进程内 `steer()` / `followup()`。

- 插件听本机 named pipe（例如 `coucou-dsh-<SID>`）
- **DSH pill 在前且会话活着：** 输入框和拖文件走这条通道
- **否则：** 走岛内 DeepSeek / 自定义聊天
- DSH 没在跑：输入仍走岛内聊天，不报「注入失败」

已知限制：所有 `coucou_agent: dsh` 的会话共用一颗 `agent_dsh`；两个并行会话会互相覆盖 `sessionId`。steer 打到插件记下的「当前 session」。不做一会话一 pill。

### 6.3 红线

- 不要让 hook / 插件展示路径等待，也不要用 `PreToolUse` 的 `ask` / `allow` 代替批准卡
- 不要把 DSH 的 `configPath` 指到用户现有的 Claude `settings.json`
- 不要在 DSH 会话里用 `npm run tauri dev` 当长期运行的 Coucou；独立终端或计划任务启动
- 改 `cordis.patch.yml` 必须重启 DSH，当前进程不会中途加载

---

## 7. 实现顺序

一次交付，按风险排：

1. 砍目录 / 安装器 / 轮询 / 测试，主 pill 改 `agent_dsh`
2. 聊天：DeepSeek + 动态提供商，去掉旧四家和 Ollama
3. GitLab MR + pipeline；GitHub / Resend 不动
4. DSH 插件：展示 + Settings 安装（YAML insert）
5. DSH 批准（callId 关联）+ 提问适配
6. DSH steer + 拖文件
7. 回归：Codex 批准、GitHub 卡片、Resend、暂停时零出站

### 验收

- 只装 DSH：岛上 DeepSeek pill，工具步骤 / diff 正常；Stop 尽量有一句摘要
- 危险工具：岛上出现带路径的批准卡；点 Deny 后 DSH 不执行；Coucou 退出时 DSH 网页仍能批
- 提问：岛上选项可点，答案回到模型
- 岛上输入进入当前 DSH 回合，而不是误打到聊天 API
- Codex 的 Allow / Deny 与安装器仍可用
- GitLab 企业 URL + token 能列出 MR；GitHub 个人 token 不受影响
- 未勾选的服务 pill、Pause 时不发对应网络请求

---

## 8. Pill / Credential 契约

新 ID 一旦写出不要再改名：

| ID | 含义 |
|---|---|
| `agent_dsh` | DeepSeek Harness |
| `agent_codex` | Codex（已有） |
| `integration_github` | GitHub（已有） |
| `integration_resend` | Resend（已有） |
| `integration_gitlab` | 企业 GitLab |
| `deepseek-api-key` | DeepSeek 聊天 key |
| `github-token` | 已有 |
| `resend-api-key` | 已有 |

DSH 颜色：`#4D6BFE`。GitLab 颜色：`#FC6D26`。

---

## 9. 以后适配 Mac（本轮不实现）

| Windows | Mac 以后 |
|---|---|
| `windows/src/core/pills.ts` 等 | `NotchBuddy/Sources/CoucouKit/PillCatalog.swift` 同一套 ID / 颜色 |
| `agents.rs` 只剩 Codex + DSH | `HookServer` 安装检测对齐 |
| GitLab poller in `integrations.rs` | `GitlabPoller.swift`，卡片抄 GitHub pulse 结构 |
| 插件写 named pipe | 同一插件改写 `nb.sock`（或调 Mac relay） |
| Credential Manager | Keychain，条目名保持一致 |
| 无 iPhone | 不必把 GitLab / DSH 同步到 CloudKit，除非以后明确要 |

插件逻辑尽量纯 Node；OS 只出现在「怎么连上 Coucou」。

---

## 10. 工作方式

- 远程：`origin` = `https://github.com/Nomit8088/coucou.git`（个人 fork）；`upstream` = `https://github.com/Louis-CFM/coucou.git`
- 不要往 upstream 提这些个性化删除 / DSH / GitLab 的 PR
- 不要长期 rebase upstream：删除面大，冲突会很烦
- 开发：在**独立终端或计划任务**里 `cd windows && npm run tauri dev`，不要挂在 DSH 进程树下
- 日志：`%LOCALAPPDATA%\Coucou\coucou.log`
