# macOS — Tauri 增强版

这是现有 Windows 增强版的 macOS 移植：仍使用同一套 TypeScript / Rust、DSH 插件和设置界面，不使用原生 Swift 应用。原有原生工程只作为历史源码保留，不进入此版的构建或安装包。

## 范围

- 保留 DSH 会话、双端审批/提问、继续输入、取消、权限预设，以及 DeepSeek / 自定义聊天、Cteams、GitHub、GitLab、QQ 邮箱等通用集成。
- 使用 macOS Keychain 保存凭据；普通设置、日志和 hook 位于 `~/Library/Application Support/Coucou/`。
- Finder 拖入文件走 Tauri 原生事件，不使用 Windows WebView2/OLE。
- 菜单栏应用；灵动岛放在所选屏幕顶部、菜单栏/刘海下方，避免卡片被硬件刘海遮住。支持 Retina、屏幕切换、点击穿透和闲置时暂停光标轮询。
- 局部快捷键使用 Command；全局快捷键保留 Ctrl+Option 默认组合，可在设置中修改。
- Mac 版隐藏没有后端实现的网易云、QQ 音乐、Spotify、音乐点赞模拟热键，以及桌面悬浮 Mochi / 贴附前台窗口入口。不移植 Windows 媒体接口，也不添加 Apple Music / iCloud / iPhone 等原生版本专属功能。
- “打开终端”目前回退为打开工作目录（优先 VS Code），不承诺定位到已有终端窗口。
- 更新按 Mac CPU 选择明确标识的 DMG（或 universal），由用户下载、拖入 Applications 覆盖安装；不会下载或运行 `.exe`，没有静默覆盖升级。

## 本地开发与打包

要求 **macOS 13+**、Node.js 24、Rust stable、Xcode Command Line Tools。不需要 XcodeGen，也不需要完整的 Swift 工程。

```sh
xcode-select --install
cd desktop
npm ci
npm run tauri dev
```

Tauri 自动合并 macOS 平台配置，无需手动带 `--config`。启动前会生成 Mac 图标并构建宿主架构的 `coucou-hook`。

```sh
cd desktop
npm run pack
```

产物位于 `desktop/release/`：

- Apple Silicon：`Coucou-macOS-0.2.1-aarch64.dmg`
- Intel：`Coucou-macOS-0.2.1-x86_64.dmg`

在对应 CPU 的 Mac 上分别构建。不直接使用 `--target universal-apple-darwin`：hook 资源也必须是对应架构，不能只把主程序合并为 universal 后忽略 relay。

开发/CI 包默认没有 Developer ID 公证。正式对外分发时通过 Tauri 的 Apple 签名/公证环境变量提供证书和公证凭据，敏感值只存本机钥匙串或 CI Secrets。未签名的下载包可能被 Gatekeeper 拦截；仅在确认源码/来源可信后按系统“隐私与安全性”提示允许打开，不建议关闭系统安全检查。

Mac bundle ID 保持 `fr.louisraille.NotchBuddy`。不要同时运行原生版本与此版；已有原生版本的偏好与钥匙串不会自动导入此版。

## DSH 接入

1. 启动 Coucou，在设置中选择 DSH profile（默认 `~/.dsh/profiles/web`）。
2. 点击安装插件，检查配置差异和备份路径，然后明确确认。
3. 重启 DSH，让它加载修改后的 profile。

事件 socket 为 `/tmp/coucou-<uid>/coucou.sock`，反向指令为同一目录下的 `coucou-dsh.sock`。目录必须归当前用户所有且为 `0700`，socket 为 `0600`；错误所有者、符号链接或开放权限会让通信关闭，而不是降级到共享 socket。relay 还检查服务端 UID。插件重启时仅清理自己拥有、已经没有服务监听的旧 socket，不覆盖存活的 DSH 实例。退出/超时不会代替用户批准工具。

如果目录被不正确的程序预先创建，请先退出 Coucou/DSH，确认所有者和用途后处理该目录；应用不会自动更改可疑目录的权限。

## 发布与签名（待决策）

`macos-v*` tag 会像 Windows / Linux 的 tag 一样触发 macOS 构建（见 [macos-tauri.yml](<../.github/workflows/macos-tauri.yml>)），但**只产出 DMG artifact，不创建 Release**：CI 与本地默认产物都没有 Developer ID 签名和公证，直接发布会让下载的人被 Gatekeeper 拦下。

要和另外两个平台在发布上对等，需要先定两件事：

1. 是否申请 Apple Developer ID 并为 CI 配置签名/公证凭据（Tauri 的 `APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`，只放 CI Secrets）；
2. 若决定长期不签名，是否接受在 Release 说明里显式标注“未签名”，并给出“隐私与安全性 → 仍要打开”的放行步骤。

决策落定前，`macos-v*` tag 只用于产出可供人工签名/验收的 DMG artifact。

## 验证

```sh
cd desktop
node scripts/prepare-build.mjs
npx tsc --noEmit
npm test
npx vite build
cargo test --workspace --locked
npm run pack
```

[macOS CI](<../.github/workflows/macos-tauri.yml>) 分别在 Apple Silicon / Intel Mac runner 上执行上述检查，提供 DMG artifacts，不自动发布 Release，也不调用原生 Swift 构建。

实机验收：

- 内置 Retina 屏幕与外接不同缩放屏幕：显示/隐藏、唤醒、选择屏幕、拔插屏幕、全屏 Space、外部点击不能被透明窗口吞掉。
- Finder 拖入单个文件：Mochi 动画、文件复制、DSH 文件上下文，包含空格和中文的路径。
- DSH 的 Allow / Deny / 提问：分别从岛和 Web GUI 回答、另一端收敛；继续输入、取消、预设切换；关闭应用后 Agent 正常继续；重启 DSH 后反向 socket 恢复。
- Keychain 存取与重启，设置只保存普通偏好；导入 Windows 设置后不出现无效音乐卡片。
- Command 编辑/发送、全局快捷键、菜单栏设置窗口开关、应用开机启动；从终端打开聊天再收起，键盘应回到原应用，不能由透明岛继续吞键。
- 更新页面只能提供对应架构 DMG 或 Release 页面，不能出现 Windows 安装按钮。

**验证边界：**这次适配的开发主机是 Windows。本地前端测试与 Windows Rust 回归可执行；macOS 特定代码、DMG 打包、WKWebView/AppKit 交互和签名/公证仍须由上述 Mac CI 与实机确认，不应将 Windows 测试通过视作 Mac 验收完成。
