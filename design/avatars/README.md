# 鲸鱼娘图标资源包

DeepSeek 鲸鱼娘头像的可复用资源。**矢量母版是 `blue-maid.svg`**，其余文件都由它导出。

![资源总览](<blue-maid-preview.png>)

---

## 怎么取用

### 方式一：直接用现成的（最快）

`bundle/` 里已经导出好各平台规格，按目标项目挑目录即可：

| 目标 | 取这个文件 |
|---|---|
| Windows 应用 / 托盘 | `bundle/windows/icon.ico`（16/24/32/48/64/128/256 内嵌） |
| macOS 应用 | `bundle/macos/icon.icns`（32…1024） |
| Web / PWA | `bundle/web/`：`favicon.ico`、`apple-touch-icon.png`、`icon-192.png`、`icon-512.png` |
| Android | `bundle/android/mipmap-*.png` + `play-store-512.png` |
| iOS / App Store | `bundle/ios/AppIcon-*.png` |
| 任意尺寸 PNG | `bundle/png/whale-maid-{16…1024}.png` |
| 最高清原图 | `bundle/whale-maid-1024.png`（透明背景 RGBA） |

Tauri 项目可直接把 `windows/icon.ico`、`macos/icon.icns`、`icon-512.png`（另存为 `icon.png`）和 `png/whale-maid-32.png`、`whale-maid-256.png` 放进 `src-tauri/icons/`。

### 方式二：改颜色 / 改造型再导出

直接编辑 `blue-maid.svg`。它按图层分组，改起来不会互相牵连：

| 图层 id | 内容 |
|---|---|
| `back-hair` | 后发与发尾高光 |
| `headband` | 白色荷叶边发饰 |
| `whale-ears` | 两侧鲸鱼耳鳍（`whale-ear-left` 是右侧的镜像） |
| `hair-crown` | 头发主体 |
| `fringe` | 刘海（含 `upper-left-lock` / `upper-right-lock` 分束） |
| `side-locks` | 两侧鬓发 |
| `ahoge` | 头顶呆毛 |
| `bow` | 右侧蝴蝶结 |
| `expression` | `eyes` 与 `blush`，表情替换改这里 |

配色集中在 `<defs>` 的渐变里（`hair` / `bangs` / `back` / `skin` / `lace` / `ribbon` / `fin` / `fin-belly`）。

改完重新导出：

```sh
python design/avatars/export_icons.py
```

脚本会重新渲染 SVG 并覆盖 `bundle/` 下的全部文件。依赖 Pillow 和 Chrome/Edge（用于把 SVG 光栅化成透明 PNG）。

### 方式三：在网页里直接用矢量

`blue-maid.svg` 可以直接当 `<img>`、内联进 HTML，或用 CSS `mask`/`background` 使用。它是 640×640 的 viewBox，缩放到任何尺寸都不糊：

```html
<img src="blue-maid.svg" alt="鲸鱼娘" width="128">
```

需要单独调某一部分做动画时，内联进 DOM 后按上面的图层 id 取元素即可：

```html
<object data="blue-maid.svg" type="image/svg+xml"></object>
```

---

## 导出脚本做了什么

1. 用 headless Chrome 分别以纯黑、纯白为底各渲染一次 1024px 的 SVG；
2. 用**差分抠图**（difference matting）反解出精确的 alpha 与真实颜色——不是阈值抠图，所以发丝边缘、半透明高光都能保住；
3. 由这张透明母版缩放生成所有平台规格。

所以 `bundle/` 里的每一份文件和 `blue-maid.svg` 永远一致，改完矢量重跑脚本即可。

---

## 说明

角色形象参考自 DeepSeek 鲸鱼娘，仅作个人项目的桌宠 / 图标使用。对外分发前请自行确认原形象的授权范围。
