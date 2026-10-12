# Contributing to Coucou

Thanks for wanting to help Mochi grow up! 🫶

## Two apps live here

- **`desktop/`** — the active app, and where almost every change belongs: one
  Tauri project (TypeScript front end in `src/`, Rust backend in `src-tauri/`,
  the `coucou-hook` relay in `hook/`) that builds for Windows, macOS and Linux.
- **`NotchBuddy/`**, the `*Tests.swift` files in `tests/` and the
  `scripts/test-*.sh` helpers — the legacy native macOS/iPhone app. Kept for
  history and the App Store build; it is **not** part of the enhanced edition,
  and its CI (`build.yml`, `release.yml`) only runs when those files change, or
  by hand.

## Getting started (desktop app)

```bash
cd desktop
npm ci
npm run tauri dev      # live-reloading development build
```

Never restyle a view that already ships: the house rules are in `CLAUDE.md`.

Check your work the way CI does:

```bash
cd desktop
node scripts/prepare-build.mjs
npx tsc --noEmit
npm test
cargo test --workspace --locked
```

`npm test` pins the host OS the suite answers for in `tests/setup.mjs` (Windows
by default; the `tests/macos*.test.mjs` files pin a Mac themselves). Keep it that
way: a suite that reads the developer's real OS passes on Windows and fails on
the macOS runner.

## Getting started (legacy Swift app)

```bash
brew install xcodegen
cd NotchBuddy && xcodegen && open NotchBuddy.xcodeproj
```

Never edit `NotchBuddy.xcodeproj` by hand: change `project.yml` and run `xcodegen`.

Check resting island dimensions on screens with and without a notch:

```bash
bash scripts/test-screen-geometry.sh
bash scripts/test-display-choice.sh
```

Check auto-close timing and live setting changes:

```bash
bash scripts/test-auto-close.sh
```

## Good first contributions (legacy Swift app)

- A new service integration (a poller + an entry in `PillCatalog.swift` in the `.service` category + a detail card). Look at `StripePoller.swift` for a compact example.
- A new agent: any agent already gets its own automatic pill by sending `coucou_agent` in its hook payload (see `docs/AGENTS.md`). Add an entry in `PillCatalog.swift` in the `.agent` or `.workspace` category only if you want it to be declarable in Settings → Active pills.
- A new emote or sound for Mochi.
- Bug fixes — please describe how to reproduce.

## Rules of the house

- Swift 6, SwiftUI + AppKit, **no third-party dependencies** unless there's really no other way.
- Secrets go in the Keychain, never on disk or in git.
- No telemetry, no network calls except to services the user configured.
- Never block Claude Code: if the app doesn't answer, the hook must exit right away.
- Never write `~/.claude/settings.json` without a backup and the user's confirmation.
- Keep it light: 0 % CPU when the island is hidden.

## Pull requests

- One topic per PR, with a short GIF or screenshot for anything visual.
- Build must pass with no new warnings.
