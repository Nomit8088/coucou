# packaging/

Distribution recipes that live **outside** the app, for packagers rather than for
the build.

- `linux/arch/` — the Arch Linux `PKGBUILD` and the `.desktop` entry it installs
  (contributed upstream by @FabioLukas123). It clones this repository and builds
  `desktop/`.

Tauri's own per-OS bundle configuration is deliberately *inside* the app:
`desktop/src-tauri/tauri.conf.json` plus the auto-merged
`tauri.macos.conf.json` / `tauri.linux.conf.json`, the icons and the Mac
`Info.macos.plist`. A recipe belongs here only when a distribution publishes it.

No CI workflow builds from this folder yet; `desktop/README.md` explains how to
use the PKGBUILD by hand.
