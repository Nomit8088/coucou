# Changelog

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
