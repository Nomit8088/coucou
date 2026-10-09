# 开工提示词（给新会话）

把下面整段复制到新会话。工作目录必须是本仓库。方案全文在 [`docs/PERSONAL-PLAN.md`](PERSONAL-PLAN.md)。

---

你在 Coucou 的个人 fork 里按已落盘方案做 Windows 个性化改造。不要问要不要做、不要另起方案、不要改 Mac / iPhone / relay。

## 仓库与远程

- 工作目录：本仓库根目录（Windows 路径形如 `D:\dev\agent_dev\coucou`）
- `origin` = https://github.com/Nomit8088/coucou.git （个人 fork，只往这里推）
- `upstream` = https://github.com/Louis-CFM/coucou.git （只读，不要提个性化 PR）
- 不要 rebase upstream

先读 [`docs/PERSONAL-PLAN.md`](PERSONAL-PLAN.md)，再读 `windows/README.md`、`windows/src-tauri/src/agents.rs`、`windows/src/core/pills.ts`、`windows/src/island/agents.ts`、`windows/hook/src/reply.rs`。施工以 PERSONAL-PLAN 为准，不以官方 SPEC / AGENTS 为准。

## 范围（锁死）

Windows only（`windows/`）。壳（岛、Mochi、服装、桌面、声音、周报、快捷键、10 语、文件拖放）不精简。

1. **删减**：去掉 Claude Code 安装器与主 pill、Cursor / Gemini / Antigravity / Copilot / Muse / OpenCode / Amp / Hermes / Claude Desktop；去掉 Anthropic / Google / OpenAI / OpenRouter / Ollama / LM Studio 聊天；去掉 Stripe / n8n / Vercel / Notion / Cal.com / Music。留下 `coucou-hook` + pipe。无 `coucou_agent` 的 hook 丢弃。`takes_decisions` / `APPROVAL_AGENTS` 只认 `codex` 和 `dsh`。
2. **Codex**：现有安装器、Allow/Deny、套餐用量保留。不往 Codex 注入文本。
3. **岛内聊天**：DeepSeek 预设（`https://api.deepseek.com/v1`，Credential `deepseek-api-key`，默认 `deepseek-chat`）+ 可增删的 OpenAI 兼容提供商（名称 / URL / Key / 模型）。聊天芯片两级：提供商 → 模型。无 tools。key 进 Credential Manager。聊天 ≠ DSH，禁止用聊天框 `steer()`。
4. **服务**：GitHub、Resend 不动。新增 `integration_gitlab`（`#FC6D26`）：Base URL + access token（`PRIVATE-TOKEN`），卡片只要 My MRs / To review / 默认分支 pipeline，不要贡献格子。
5. **DSH 一次做完**：不要写 `dsh-hooks.json`，不要把展示和批准拆成两期。Cordis 插件装到 `%LOCALAPPDATA%\Coucou\dsh-plugin\`，在 profile 的 `cordis.patch.yml` 里 insert 固定 id `coucou`。默认 profile `%USERPROFILE%\.dsh\profiles\web`。主 pill `agent_dsh`（`#4D6BFE`）。插件：展示（含小写工具名与 `DIFF_TOOLS`）、`approval/request`（callId 补全参数）、`user-questions/request`（不要别名 AskUserQuestion）、反向 pipe 做 steer / 拖文件。Coucou 没开则批准/提问 `next()` 给 Web GUI。禁止默认放行。禁止 configPath 指向 `~/.claude/settings.json`。改 patch 后必须提示重启 DSH。

## 实现顺序（严格按此）

1. 砍目录 / 安装器 / 轮询 / 测试，主 pill 改 `agent_dsh`
2. 聊天 DeepSeek + 动态提供商
3. GitLab MR + pipeline
4. DSH 插件展示 + Settings 安装
5. DSH 批准 + 提问
6. DSH steer + 拖文件
7. 回归 Codex / GitHub / Resend / Pause 零出站

每完成一步再开下一步。提交只推 `origin`。独立终端跑 `cd windows && npm run tauri dev`，不要挂在 DSH 进程树下。

## 红线

- 没有人工点击不得允许工具
- 密钥不落盘、不进 git、不进日志
- 新 pill ID 一旦写出不要改名：`agent_dsh`、`integration_gitlab`
- 不要为了「和上游一致」把已删功能加回来
- 不要实现 Mac 适配（方案第 9 节只是备忘）

做完用方案第 7 节验收清单自检，在回复里列出已完成项和未完成项。
