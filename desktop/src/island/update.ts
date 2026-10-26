// A newer Coucou waits — the island side. Upstream runs a scheduler in Rust
// (update.rs) that offers the card by itself; this fork keeps the update check
// where it always was: a button in Settings, or the tray's "Check for updates…".
// Whatever that check answers is forwarded to the island as `update-found`
// (src-tauri/src/updater.rs), so Mochi and the tray icon can go blue, and the
// card can offer the installer. Nothing is downloaded until the user asks.
//
// The findings are kept for the next launch: without them a restart would drop
// the blue for no reason. The stored version is only trusted while it is newer
// than the one running, so installing the update clears it by itself.

import { Bridge, onEvent, type UpdateInfo } from "../core/bridge";
import { State } from "../core/state";
import { compareVersions, updateWaiting, type Later } from "../whats-new/whats-new";

/** "Later" for the blue Mochi: which version, and when. A per-install convenience. */
const LATER_KEY = "coucou.update.later";
/** What the last check found, so the blue survives a restart. */
const FOUND_KEY = "coucou.update.found";

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown | null) {
  try {
    if (value == null) window.localStorage?.removeItem(key);
    else window.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage refused: the blue only comes back sooner, or later.
  }
}

/** What the island needs from the window: one frame at the new colour. */
export interface UpdateHost {
  redraw(): void;
}

class UpdateController {
  info: UpdateInfo | null = null;
  /** The installer is being fetched: the card says so instead of offering it twice. */
  installing = false;
  private host: UpdateHost | null = null;
  private started = false;
  private laterMemo: Later | null | undefined;
  private trayBlue = false;

  /** Once, at launch: restore what the last check found, then listen. */
  async register(host: UpdateHost, currentVersion: string) {
    if (this.started) return;
    this.started = true;
    this.host = host;

    const found = readJson<UpdateInfo>(FOUND_KEY);
    if (found && found.latestVersion && compareVersions(found.latestVersion, currentVersion) > 0) {
      this.info = found;
    } else if (found) {
      writeJson(FOUND_KEY, null); // this build is that version or newer: nothing waits
    }

    await onEvent<UpdateInfo>("update-found", (info) => {
      this.info = info?.hasUpdate ? info : null;
      writeJson(FOUND_KEY, this.info);
      this.installing = false;
      State.notify();
      this.host?.redraw();
      this.syncTray();
    });

    this.syncTray();
    // A day after Later the blue comes back, island hidden or not: a look every half hour.
    const look = setInterval(() => this.syncTray(), 30 * 60 * 1000) as unknown as { unref?: () => void };
    look.unref?.(); // the tests run this in Node: the timer must not keep them alive
  }

  /** A newer version waits for the user (Mochi turns blue, the tray follows). */
  waiting(nowMs = Date.now()): boolean {
    if (this.laterMemo === undefined) this.laterMemo = readJson<Later>(LATER_KEY);
    return updateWaiting(this.info, this.laterMemo, nowMs);
  }

  /** The tray Mochi follows: blue while a new version waits, like the island's. */
  private syncTray() {
    const on = this.waiting();
    if (on === this.trayBlue) return;
    this.trayBlue = on;
    void Bridge.trayUpdateHint(on);
  }

  /** The card's "Later": a day of quiet, the blue included. */
  later() {
    const version = this.info?.latestVersion;
    if (version) {
      this.laterMemo = { version, at: Date.now() };
      writeJson(LATER_KEY, this.laterMemo);
    }
    State.notify();
    this.host?.redraw();
    this.syncTray();
  }

  /** "Download and install": the Rust side fetches the installer and starts it. */
  async install() {
    const url = this.info?.downloadUrl;
    if (!url || this.installing) return;
    this.installing = true;
    State.notify();
    const started = await Bridge.downloadAndInstallUpdate(url);
    if (!started) {
      // Nothing was started: the card offers the release page instead.
      this.installing = false;
      State.notify();
    }
  }

  /** The release page, for "All changes" and when there is nothing to install here. */
  openPage() {
    const url = this.info?.releaseUrl;
    if (url) void Bridge.openUrl(url);
  }
}

export const Updates = new UpdateController();
