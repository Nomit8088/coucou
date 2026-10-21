# Changelog

## 0.2.6 — October 21, 2026

- **鲸鱼娘头型更圆，转头真正生效**：整颗头原本是 607 × 590 的近正方形，在灵动岛尺寸下读起来像一块竖着的牌子。现在整头纵向压到 86%（宽高比 1.03 → 1.20），各图层一起压缩，不会互相错位或露出浅色接缝；眼睛按 1/86 的倒数预补偿，压扁后仍是圆形。
- **转头不再只是眼球平移**：渲染拆成三层——后发、发饰与耳鳍固定不动（视为头骨）；脸与头发主体随视线侧移并横向收窄；刘海、鬓发、蝴蝶结与呆毛半速跟随形成视差。于是 yaw 变化终于读成转头，而不是眼球在平脸上滑动。
- **图标同步新头型**：图标母版此前仍是旧比例，与桌宠不一致。现在把同一个压缩变换烘焙进 `blue-maid.svg`（外层 `head` 组统一缩放，眼睛反向补偿），并重新导出整套图标（Windows `.ico`、macOS `.icns`、Web、Android、iOS 及 16–1024 各档 PNG）。

## 0.2.5 — October 20, 2026

- **修复鲸鱼娘左右扫视时眼睛被鬓发遮住**：鼠标左右移动时，外侧眼睛会滑进两侧鬓发与内侧刘海下面，看起来像少了一只眼。现在为鲸鱼娘单独收窄了视线的横向移动范围（眼心限制在 ±0.52R），并降低横向视线增益：头部仍跟着光标转，但两眼始终完整露在脸上。原版圆形 Mochi 不受影响。

## 0.2.4 — October 20, 2026

- **全新 DeepSeek 鲸鱼娘桌宠形象**：
  - 基于分层矢量（Path2D）纯代码 Canvas 实时重绘，融合了标志性的深蓝秀发、圆润小脸蛋、两侧下垂鲸鱼耳鳍、白色女仆荷叶边发饰、右侧蓝色蝴蝶结与头顶呆毛。
  - **动态神态与二次元表现系统**：
    - 视线舒适区保护：解决视线上翻被刘海发尖腰斩的怪异遮挡问题，限制眼动在黄金区间内，保持大眼始终圆润清澈；
    - 呆萌歪头杀思考（Thinking）：在思考状态下角色自然侧倾歪头，呆毛顺应重力自然微垂，配合右上方跳动的思考三点徽章；
    - 眼神追踪与眨眼呼吸：保留实时的鼠标光标跟随、自然眨眼、害羞/工作状态动态腮红泛红与 10 余种表情切换。
- **全套应用与托盘图标更新**：
  - 桌面应用、任务栏与托盘图标全面升级为 DeepSeek 鲸鱼娘高清图标集（含 512px 原图、Retina 多倍图及 Windows 专属多尺寸 `.ico`）。

## 0.2.3 — October 20, 2026

- **Claude Code 计划审批卡片（ExitPlanMode）**（逻辑移植上游 #703）：当 Claude Code 处于 Plan 模式准备好计划时，卡片顶部提示切换为「计划已就绪（has a plan ready）」，并提取计划第一行作为标题展示。底部按钮提供与终端对齐的 3 个专属选项：
  - **自动模式（Auto mode）**：批准并自动应用修改（返回 `setMode: auto`）；
  - **手动（Manual）**：批准并保持每次手动确认修改（返回 `setMode: default`）；
  - **修改计划（Change plan）**：中断当前计划并自动唤起终端，方便用户直接在终端内敲入计划调整要求。
- **智能体提问通知与响铃**（移植上游 #709）：支持识别 Antigravity 等智能体的提问工具（`ask_question` / `default_api:ask_question`），在 Ticker 中展示提取的问题内容（`需要输入 · <问题>`），并将任务状态置为 `question` 播放提示音，回答后平滑切回工作态。
- **多会话名称与当前工作会话动态绑定**（逻辑移植上游 #761）：胶囊展示名优先采用会话的 `/rename` 标题或初次启动根目录，避免在子目录下 `cd` 时篡改名字；并发多会话时，胶囊展示名与控制终端自动跟随当前正在工作的活跃会话，工作结束时平滑交接。
- **紧凑灵动岛居中时钟**（移植上游 #788）：设置 → 通用新增「在灵动岛中显示时钟（Show clock in the island）」开关（默认关闭）。在 PC 端收起紧凑状态下居中呈现系统日期与时间，每 10 秒刷新一次，展开时淡出，收起时淡入。
- **播放器与时钟互斥及进度条拖拽修复**：修复在小岛紧凑态下播放器正在播放（或悬停音乐栏）时与时钟日期重叠冲突的问题，音乐播放中自动隐藏时钟，暂停后平滑恢复；紧凑态与展开态播放器进度条支持全窗口范围平滑拖拽与单击跳转，拖拽时进度实时跟随光标，松手即时向媒体播放器（Spotify / QQ音乐 / 网易云音乐等）提交定位。
- **DSH Subagent 隔离优化**：DSH 子智能体（subagent）产生的会话、中间步骤与工具调用只作为 Ticker 步骤呈现，不再作为主会话强行弹岛或打断正在展示的卡片。

## 0.2.2 — October 18, 2026

- **Claude Code 接入**：设置里新增「Claude Code」区，安装/卸载 hooks 前先展示 `~/.claude/settings.json` 的完整差异并写日期备份，只增删 Coucou 自己的条目。安装后会话、工具调用、权限请求、AskUserQuestion 提问、最终消息与实时 diff 都显示在岛上，可直接 Allow / Deny 或在岛上选题。Cursor 终端里的 Claude Code 使用独立的 Cursor 标签。标签默认关闭，需要在「活动标签」里勾选；未开启时权限请求会立刻退回终端，不会让 Claude Code 空等。
- **错误卡片显示真实原因**（逻辑移植上游 `69e2231c` / `c7c36c50`，即 PR #718 / #781）：StopFailure 时优先显示 Claude Code 发来的 `error_message` / `error.message`，否则把 `rate_limit`、`overloaded`、未登录、账单、服务器错误、输出截断、模型不存在等错误类型翻成一句人话（10 种语言）。只有 `unknown` 或裸状态码时退回最后一条消息，最后才退回最后一步；错误卡片的按钮改为「打开终端 / 确定」，n8n 卡片仍打开 n8n。
- **Claude 套餐用量**：设置里恢复「Claude 套餐」开关，以及状态栏中继的安装/卸载——同样是先看差异、备份、再明确点击写入。打开后在岛顶栏显示 5 小时 / 每周限额；只使用 Claude 桌面版时数字不会出现。
- **小修**：岛上的标签文字为小 Mochi 留出左边距，不再被盖住（上游 #522）；新增的界面文案随附 10 种语言翻译。
- **Claude Code 自检**：设置 → Claude Code 区现在额外做一次只读自检——Coucou 的 hooks 覆盖了哪些事件（x/y）、这些条目是否指向另一份安装/旧版本的中继路径（例如从别的机器拷来的 `settings.json`）、`settings.json` 能否解析、`coucou-hook` 是否就位；其中一项不对时直接在区内提示「重新安装」。不写任何文件。
- **诊断信息一键复制**：设置新增「诊断」区，复制应用/系统/WebView 版本、配置路径、Claude Code hooks 状态与日志尾部，不含 API 密钥、消息内容或会话记录，可直接贴进 GitHub issue。
- **审批队列可见**：等待卡片会在标题旁显示「N 个排队中」。多会话并发时能看到后面还有多少权限请求/提问在排队，不再像答完一张就凭空冒出下一张。

## 0.2.1 — October 14, 2026

- **修复 GitHub / GitLab 新评论不弹灵动岛**：GitLab 为兼容企业版去掉了会让整次查询失败的 `notes(filter:)`，评论字段也被一起拿掉了，所以别人的评论永远产生不了事件。现在用独立查询读 notes，失败再走 REST，并且不会把历史评论当成新评论重放。GitHub 此前只看会话评论和带正文的 review，行内评论（review 正文为空）被跳过；现在会计入行内评论和 thread 回复。自己的评论仍不弹，启动后第一次轮询仍只建立基线。权限卡片占着岛时，评论提示会等卡片结束后再弹出。同一轮轮询里的多条评论合并成一次提示。
- **活跃标签页**：未在设置里开启的 Codex 不再占用岛上的 4 个格子（套餐用量查询触发的幽灵会话也不会再把 QQ Mail 挤掉）。顶栏「Codex 套餐」只在 Codex 是主要工具或已开启的标签时显示。

## 0.2.0 — October 12, 2026

- **macOS（Tauri 增强版）**：以现有 Windows 版为基础，新增 AppKit/CoreGraphics 窗口适配、macOS Keychain、Finder 原生拖拽及 Retina 坐标转换；DSH 事件与反向指令通过当前用户的私有 Unix socket 通信，保留双端审批和提问。Mac 隐藏未实现的音乐、模拟点赞热键与桌面悬浮入口；局部快捷键采用 Command。新增 Intel / Apple Silicon DMG 打包与 Mac CI，更新仅打开对应架构 DMG / Release 页面，不下载 Windows 安装程序。原生 Swift 工程不参与此版构建；Mac 实机验收尚待完成。

- **GitHub / GitLab 灵动岛通知**：流水线成功或失败会展开灵动岛，主按钮可跳转到流水线（对标 DSH「打开终端」）。关联的 PR/MR（我创建的 / 指派给我的 / 请我审的，设置里可分别开关）有新条目时提示——自己开的不弹。关联请求上的新评论会合并成一次提示，并忽略自己的评论。GitLab 改为走 GraphQL 读取 MR 的 head pipeline 与评论。

- **修复 macOS CI 前端单测失败**：Node 21+ 提供全局 `navigator`，其 `userAgent`/`platform` 反映的是**宿主机**，而 `src/core/platform.ts` 用它判定平台，于是 Windows 取向的测试在 macOS runner 上以 Mac 语义运行（`shortcuts` / `spotify` 共 13 个断言失败，Windows runner 上则通过）。`tests/setup.mjs` 现在固定测试的基准宿主与语言；`tests/macos*.test.mjs` 仍自行固定 Mac 环境。

- **仓库布局整理（无行为变化）**：`windows/` 改名为 `desktop/`——它是 Windows / macOS / Linux 共用的 Tauri 应用，旧名字容易让人误以为只支持 Windows；根目录 `linux/` 的打包文件移到 `packaging/linux/arch/`。macOS 新增 tag 触发（共享 `v*` 与 `macos-v*`）：`v*` 会把两个架构的 DMG 附到同一个 Release，这样一个 Release 同时提供 Windows 安装包与 Mac DMG，`/releases/latest` 才能同时服务两端的更新器；DMG 仍未签名/未公证，决策见 `desktop/MACOS.md`。遗留 Swift 工程与其 CI 明确归入历史目标：`build.yml` 只在 `NotchBuddy/`、`tests/`、`scripts/` 变化时运行，不再每次 push 都跑一次 Xcode 构建。Windows / Linux 的 tag 名与 `windows-latest` / `linux-latest` 发布名保持不变。

- **多会话隔离与权限请求队列**：同一个 pill 可能同时有多个会话（同一个 agent 开两个终端）。状态现在按「pill + 会话」记录并按优先级聚合：某个会话 Stop / SessionEnd 不再把仍在工作的兄弟会话打成 idle 或清掉 pill，「打开终端」也不会被最后一个说话者覆盖。卡片显示期间到达的第二个权限请求改为**按到达顺序排队**（上限 5，队满仍立刻退回终端），当前卡片答复后自动提升下一张。审计后补强：110 秒超时统一由 hooks.ts 持有（此前 island 另起一个定时器，提前答复会把下一张卡按上一张的截止时间拒掉）；会话结束时丢弃并拒绝它排队的请求；SessionEnd 对未登记的会话（应用中途重启）也会清掉 pill；聚合优先级改为 `Record<BotStateName, number>`，新增状态漏配会直接编译报错（此前漏掉的状态因 `indexOf` 返回 -1 反而排在 `error` 前面）。

- **macOS CI 预检与首批 Mac 安装包**：Mac runner 上新增预检步骤，实际挂载 DMG 并校验 `.app` 的 bundle id（`fr.louisraille.NotchBuddy`）、`LSUIElement`、最低系统版本、版本号与 DMG 文件名一致，以及主程序与随包 `coucou-hook` 是否都含本 runner 架构的切片；`codesign` / `spctl` 结果打印但不作为失败条件（未配置 Apple 凭据前必然被 Gatekeeper 拒绝）。同时新增 tag 与三个版本文件的一致性校验，DMG 的 SHA256 在 CI 内自校验。`v0.2.0` 起 Release 同时提供 Windows 安装包与两个架构的 DMG。

## 0.1.1 — October 10, 2026

- **应用内在线更新**：
  - 新增系统托盘菜单「检查更新…」快捷入口。
  - 设置页面顶部新增「检查更新」按钮与新版本提示卡片，自动比对 GitHub 最新发布版本。
  - 支持一键在后台静默下载最新 Windows 安装包（Setup.exe）并自动拉起安装程序，实现平滑覆盖升级。
  - 提供 Release Notes 查看及浏览器直达下载通道。

## 0.1.0 — October 10, 2026

### DeepSeek Harness (DSH) 适配与增强
- **DSH 深度交互集成**：
  - 灵动岛与 Web GUI 双向协同：权限确认与问题在灵动岛与 Web 界面同时展示，任意一侧作出的决策均可即时同步生效。
  - 修复灵动岛中确认授权（Allow/Deny）与问题选择能准确送达 Agent，解决管道提早关闭导致的卡住或终端重复提示问题。
  - 解决 DSH 内部上下文注入事件误触发 `UserPromptSubmit` 导致权限/提问卡片提前关闭的 Bug。
  - 优化 DSH 会话卡片尺寸与排版：灵动岛展开高度自适应，上下文 Gauge、后台任务、定时提醒、权限预设芯片整齐排列且不遮挡 Mochi，输入框完全可见。
  - 提问匹配优化：即使提问缺少显式 id，也能通过文本匹配准确传回用户回答。
  - 完善 DSH 插件事件流、状态同步与错误提示。

### Windows 功能与多媒体
- **音乐控制与动效**：
  - Windows 原生系统媒体会话集成，支持网易云音乐（NetEase Cloud Music）、QQ 音乐和 Spotify PC 客户端。
  - 紧凑型灵动岛音乐控制组件，支持播放/暂停、切歌、进度调节，Mochi 随音乐节奏律动。
  - 新增音乐卡片保持展开（Stay-open）设置项。
- **QQ 邮箱支持**：通过 IMAP 协议只读轮询未读邮件数量与最新邮件概览，有新邮件时发出提示音与徽标。
- **交互与界面优化**：
  - 点击灵动岛外部自动折叠至微型模式。
  - 灵动岛新增最小化（`-`）按钮，隐藏后直到新事件触发才重新出现。
  - 自动化构建：新增 GitHub Actions 自动编译与 Release 流水线，支持打 tag 自动生成 Windows 安装包（.exe / .msi）及免安装便携版。

## Windows and Linux 0.3.0 — October 9, 2026

The first Linux release since 0.1.1, so on Linux it also brings everything in Windows and Linux 0.2.0 below.

- **Open on hover**: the island opens when the pointer reaches it and folds again shortly after it leaves; a click inside keeps it open — Settings → General, off by default
- **Your own sounds**: put a file named like one of Mochi's sounds (`finish.wav`, `approval.mp3`, `greet.m4a`…) in the sounds folder to replace it — Settings → General → Open sounds folder, Reload sounds
- **A colour of your own for each Mochi**: click a pill's colour dot in Settings (#320 by @shakibbinkabir)
- **Mochi to the desktop from the keyboard**: `Ctrl+Alt+D` sends him out and brings him home, like ⌃⌥D on the Mac
- **Keyboard in the open island**: `Ctrl+↑` / `Ctrl+↓` move through the GitHub lists and `Ctrl+O` opens the row; `Ctrl+E` opens the latest diff
- **Spotify pill** *(Linux)*: the track, play/pause and next on the pill; the cover, progress with seek, shuffle, repeat and volume on the card, read from Spotify over MPRIS — and Mochi dances to it, in the island and on the desktop
- **Global shortcuts on Wayland** *(Linux)*: registered with the desktop through the GlobalShortcuts portal (KDE Plasma 6, GNOME 48+, Hyprland, COSMIC…); where there is none, the commands to bind by hand stay in Settings → Shortcuts
- **Open terminal brings the terminal forward** *(Linux)*: on X11 and KDE Plasma (Wayland too), and the right tab in kitty; GNOME on Wayland still opens the folder in VS Code
- Antigravity runs its tools again: Coucou answers "ask", so Antigravity keeps its own prompt and nothing is allowed on its own (#317 by @kobaltgit)

## Windows and Linux 0.2.0 — October 8, 2026

The Windows and Linux app catches up with the Mac, from 0.1.1 to 0.2.1 — everything except Apple Music and the iPhone, which depend on macOS and iCloud.

- **Agents**: Codex, GitHub Copilot CLI and Muse Code sessions with Allow / Deny in the island; Gemini CLI, Antigravity, Cursor Agent, OpenCode, Amp and Hermes sessions on their own pills; Claude Code sessions from the Claude app on Windows. Install them all from Settings → Agents, which shows the diff and takes a dated backup before writing — one hardened writer for every agent's config (#278 by @Totopo27, #298 by @kobaltgit, #231 by @BeyondBirthday07)
- **Questions**: answer Claude Code's multiple-choice questions from the island; answers are checked against the questions asked, and a question answered in the terminal takes the card down (#216 by @PythonTilk)
- **The permission card** comes up for every agent, brings its pill forward, can be folded without answering, and never decides on its own
- **Chat**: Anthropic, Google AI, OpenAI and OpenRouter, switchable by clicking the model name; local models through Ollama, LM Studio or any OpenAI-compatible server, streamed, thinking hidden; Markdown answers with a copy button; full answers; your first name in the greeting; `COUCOU_ANTHROPIC_BASE_URL` for a gateway, https only (#161 by @4rchila, #166 by @AlphaIsYour, #173 by @AinzDerErste, #206 by @Totopo27)
- **Plan usage**: Claude's 5-hour and weekly limits and Codex's, in the island header (#171 by @AinzDerErste)
- **Live diff**: each file Claude edits shows in the ticker with its +N −M, and a click opens the diff; the finished card shows Claude's final message
- **GitHub**: your pull requests with their CI, reviews waiting for you, the CI of your default branches, alerts when CI turns red or green, and your contribution grid
- **Mochi**: the wardrobe and seasonal outfits, the new greeting and its sound, and Mochi on the desktop (Windows, X11 and layer-shell compositors)
- **Keyboard shortcuts** from anywhere, changeable in Settings → Shortcuts; the defaults never type an AltGr character on French, German, Spanish, Italian or Portuguese keyboards
- **Weekly recap** on Monday mornings, shareable as an image; history stays on your computer
- **Pills**: declare the tools you use and pick your main one; hook-based pills no longer ask for a key; "Open terminal" brings the session's own window forward on Windows
- **10 languages**: English, 中文, हिन्दी, Español, العربية, Français, বাংলা, Português (Brasil), Русский, Bahasa Indonesia — Settings → General → Language (#228; picker from #226 by @alexisrja)
- **File drop** works from every Explorer view, and Cancel works (#240 by @KauaDc, #126); only files a real drop delivered can be read
- **Linux**: auto-close on KDE/Wayland and GNOME (#160 by @4rchila, #136), the island at the top on GNOME (#149 by @betodoescher), pinned to its display on Hyprland and Sway with a display picker (#227 by @chuxclay), GNOME large text no longer cuts the island (#122), an Arch Linux PKGBUILD (#299 by @FabioLukas123, #230)
- The step ticker no longer stops at a session's 20th step (#265 by @PythonTilk), ticker steps keep their own line (from #203 by @shakibbinkabir), `tauri dev` no longer crashes on EBUSY (#202 by @Andrev-91)

## 0.2.3 — October 8, 2026

- **Terminal sessions**: Claude Code sessions started in Warp, Terminal, iTerm, Ghostty, cmux or Orca show in the notch, and "Open terminal" brings back the app the session runs in. Answering their questions and permissions from the notch is opt-in — Settings → Agents (#282 by @guerraOrzc, #238 by @mateuslamaral)
- **Spotify pill**: what's playing in Spotify, with play/pause and skip (#246 by @JhoanG956)
- **A colour of your own for each Mochi**: click a pill's colour dot in Settings → Active pills (#320 by @shakibbinkabir)
- **Dictate in the chat** *(GitHub build)*: click the mic and talk in any of your languages — Coucou listens in your Mac's languages and keyboard layouts and keeps the one you spoke; right-click the mic to pick a language. On-device when the Mac supports it (#116 by @xynlaze234)
- **Open on hover**: the island opens when the pointer reaches the notch and closes when it leaves — Settings → General → Behavior, off by default (asked by felix11zx)
- **Your own sounds**: drop a file named after one of Mochi's sounds in the sounds folder to replace it — Settings → General → Sound (#116)
- Antigravity runs its tools again: Coucou answers "ask", so Antigravity keeps its own prompt and nothing is allowed on its own (#317 by @kobaltgit)

## 0.2.2 — October 8, 2026

- **Choose Mochi's screen**: the screen with the notch, the main screen, a specific display, or "Follow the mouse" — Settings → General → Display. The island moves right away and finds its place again when screens are plugged in or out; Mochi's gaze is right on any display arrangement (#236 by @steeven-th)
- **Claude Desktop pill**: Claude Code sessions started from the Claude app's Code tab get their own pill instead of being ignored; their permission prompts stay in the Claude app (#191 by @samuelmtz2000)
- **Codex plan usage**: a Codex pill next to the Claude one shows your Codex limits and free resets, read from the Codex CLI — Settings → Agents → Plan usage *(GitHub build)* (#244 by @Ace3Z)
- **Questions** show in full, with each option's description (#249 by @Mehdi-fsn)
- A pending permission can be folded away with Escape in the notch or the toggle shortcut, without answering it; Escape typed in another app never hides it (#290 by @jhannesreimann)
- Pills that run on hooks (Claude Code, Cursor, Codex, Gemini CLI, Antigravity, Copilot CLI, Muse Code, OpenCode, Amp, Hermes) say whether their hooks are installed instead of asking for a key (#183 by @TheodoreRiant)
- The chat keeps Claude's whole answer — web-search answers were cut after the first block (#67 by @RAMZI0TO99)
- `~/.claude/settings.json` is never rewritten from scratch when it can't be read, the backup must succeed before anything is written, and nothing is written if the file changed since the preview (#243 by @Fabian-2026)
- The auto-close delay set in Settings is respected (#25 by @Kamasoutra); reopening Coucou brings the island back (#270 by @AndersonPGS)
- Fixed a crash an hour after a file edit (#286 by @i87ce)
- Lighter when hidden: the island checks the pointer 8 times a second instead of 60 while it is hidden and the pointer is away from it

## 0.2.1 — October 7, 2026

- **Hermes Agent** (Nous Research, open-source): sessions appear in the notch — live tool steps, the final response when done, and the platform (Telegram, Discord…) when running via the gateway. Install from Settings → Agents → Hermes: it writes a small Python plugin to `~/.hermes/plugins/coucou/` and enables it in `~/.hermes/config.yaml`, with the same preview, backup and confirmation flow as other agents *(macOS, GitHub build)* (#288)
- Hermes approval requests show a "⏳ Approval pending in Hermes" step in the notch. Approving directly from the notch isn't supported yet — current Hermes versions (0.15.x) don't expose the transport API. The Approvals toggle in Settings will activate automatically once Hermes adds it (#288)
- Coucou never blocks Hermes: if the app is closed or unreachable, Hermes continues normally and handles approvals itself (#288)

## 0.2.0 — October 6, 2026
