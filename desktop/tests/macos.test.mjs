import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calls } from "./tauri.mjs";

// Exercise the real default path of a Mac WKWebView, not only explicit os args.
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
  platform: "MacIntel",
} });
const { HOST_OS, detectHostOs, platformCapabilities } = await import("../src/core/platform.ts");
const { PILL_CATALOG, availablePills, mainPillChoices, sanitizeDeclared, toggleDeclared } = await import("../src/core/pills.ts");
const { DEFAULT_SETTINGS, State } = await import("../src/core/state.ts");
const { Spotify, IDLE_SPOTIFY } = await import("../src/core/spotify.ts");
const { applySpotify, registerSpotifyHandlers } = await import("../src/island/spotify.ts");
const { activeKeys, availableShortcuts, displayKeys, islandKeyAction, islandShortcuts, recordPress } = await import("../src/core/shortcuts.ts");
const { updateAction, RELEASES_URL } = await import("../src/core/updater.ts");

const musicIds = ["integration_spotify", "integration_qqmusic", "integration_cloudmusic"];
const press = (key, code, overrides = {}) => ({ key, code, ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, ...overrides });

beforeEach(() => {
  State.os = "macos";
  State.tasks = [];
  State.focusId = null;
  State.mode = "hidden";
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [] };
  Spotify.state = { ...IDLE_SPOTIFY };
  calls.length = 0;
});

test("macOS is detected separately from Linux, including Apple Silicon WKWebView", () => {
  assert.equal(HOST_OS, "macos");
  assert.equal(detectHostOs("Mozilla Macintosh; Intel Mac OS X", "MacIntel"), "macos");
  assert.equal(detectHostOs("", "MacIntel"), "macos");
  assert.equal(detectHostOs("Mozilla Windows NT 10.0", "Win32"), "windows");
  assert.equal(detectHostOs("Mozilla X11 Linux x86_64", "Linux"), "linux");
  assert.equal(detectHostOs("", ""), "linux");
});

test("Mac capabilities hide unsupported music/desktop and manual install only", () => {
  assert.deepEqual(platformCapabilities("macos"), {
    music: false, musicLikeHotkeys: false, globalShortcuts: true, desktopMochi: false,
    directUpdateInstall: false, primaryModifier: "Command",
  });
  assert.equal(platformCapabilities("windows").musicLikeHotkeys, true);
  assert.equal(platformCapabilities("linux").musicLikeHotkeys, false);
  assert.equal(platformCapabilities("windows").directUpdateInstall, true);
});

test("all Mac music pills are hidden, without changing catalog IDs or Windows/Linux offers", () => {
  assert.deepEqual(PILL_CATALOG.filter((p) => p.mediaApp).map((p) => p.id), musicIds);
  assert.deepEqual(availablePills().filter((p) => p.mediaApp), []);
  assert.deepEqual(availablePills("windows").filter((p) => p.mediaApp).map((p) => p.id), musicIds);
  assert.deepEqual(availablePills("linux").filter((p) => p.mediaApp).map((p) => p.id), ["integration_spotify"]);
  assert.deepEqual(mainPillChoices().map((p) => p.id), [
    "integration_claude", "agent_cursor", "agent_dsh", "agent_codex",
  ]);
  const persisted = { mainPill: "agent_codex", activeIntegrations: [...musicIds, "integration_github", "integration_github", "agent_dsh"] };
  assert.deepEqual(sanitizeDeclared(persisted), { mainPill: "agent_codex", activeIntegrations: ["integration_github", "agent_dsh"] });
  assert.deepEqual(persisted.activeIntegrations.slice(0, 3), musicIds, "sanitize does not mutate its input");
  for (const id of musicIds) assert.equal(toggleDeclared(persisted, id), null);
});

test("Mac runtime drops persisted and already-busy unsupported tasks, fixing focus", () => {
  State.settings.activeIntegrations = [...musicIds, "integration_github"];
  State.tasks = musicIds.map((id) => ({ id, state: "working", steps: ["old track"], color: "#fff" }));
  State.focusId = musicIds[0];
  State.loadIntegrationTasks();
  assert.deepEqual(State.settings.activeIntegrations, ["integration_github"]);
  assert.deepEqual(State.tasks.map((t) => t.id), ["agent_dsh", "integration_github"]);
  assert.equal(State.focusId, "agent_dsh");
});

test("Mac ignores late music events and does not register an unsupported music poller", () => {
  let reveals = 0;
  const host = { revealSilently: () => { reveals++; } };
  registerSpotifyHandlers(host);
  applySpotify(host, { ...IDLE_SPOTIFY, playing: true, track: { title: "Song" }, pillId: musicIds[0] });
  assert.equal(Spotify.state.playing, false);
  assert.equal(State.spotifyPlaying, false);
  assert.equal(reveals, 0);
  assert.deepEqual(calls, []);
});

test("Mac local shortcuts use Command, while Windows and Linux keep Ctrl", () => {
  const ctx = { view: "overview", inTextField: false };
  for (const [key, code, action] of [
    ["ArrowRight", "ArrowRight", { kind: "cycle", delta: 1 }],
    ["ArrowDown", "ArrowDown", { kind: "list", delta: 1 }],
    ["2", "Digit2", { kind: "pill", number: 2 }],
    ["o", "KeyO", { kind: "openSelection" }],
    ["e", "KeyE", { kind: "diff" }],
    [",", "Comma", { kind: "settings" }],
    ["p", "KeyP", { kind: "pin" }],
  ]) {
    assert.deepEqual(islandKeyAction(press(key, code), ctx), action);
    assert.equal(islandKeyAction(press(key, code, { metaKey: false, ctrlKey: true }), ctx), null);
    for (const os of ["windows", "linux"]) {
      assert.deepEqual(islandKeyAction(press(key, code, { metaKey: false, ctrlKey: true }), ctx, os), action);
      assert.equal(islandKeyAction(press(key, code), ctx, os), null);
    }
  }
  assert.deepEqual(islandKeyAction(press("k", "KeyK"), { ...ctx, view: "prompt" }), { kind: "newChat" });
  assert.equal(islandKeyAction(press("k", "KeyK"), ctx), null);
  assert.equal(islandKeyAction(press("e", "KeyE"), { ...ctx, view: "prompt" }), null);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    assert.equal(islandKeyAction(press(key, key), { ...ctx, inTextField: true }), null);
  }
  for (const mods of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }]) {
    assert.equal(islandKeyAction(press("p", "KeyP", mods), ctx), null);
  }
  assert.match(islandShortcuts()[0].keys, /Command/);
  assert.match(islandShortcuts("windows")[0].keys, /Ctrl/);
  assert.equal(displayKeys("Super+Right"), "Command+→");
  assert.equal(displayKeys("Super+Right", "windows"), "Win+→");
  assert.equal(displayKeys("CmdOrCtrl+Right"), "Command+→");
  assert.equal(displayKeys("CmdOrCtrl+Right", "windows"), "Ctrl+→");
});

test("Mac global settings retain supported actions, but not desktop or unported actions", () => {
  const ids = availableShortcuts().map((d) => d.id);
  assert.ok(ids.includes("openChat") && ids.includes("jumpToTerminal"));
  assert.ok(!ids.includes("desktopToggle") && !ids.includes("attachFrontWindow"));
  assert.ok(availableShortcuts("windows").some((d) => d.id === "desktopToggle"));
  assert.ok(!activeKeys({ desktopToggle: { keys: "Super+D", enabled: true } }).some(([id]) => id === "desktopToggle"));
  assert.deepEqual(recordPress(press("d", "KeyD")), { kind: "keys", keys: "Super+D" });
  assert.deepEqual(recordPress(press("€", "KeyE", { ctrlKey: true, altKey: true, metaKey: false })), { kind: "keys", keys: "Ctrl+Alt+E" });
});

test("Mac update UI chooses manual DMG or release page, never Windows installation", () => {
  const info = { downloadUrl: "https://github.com/Nomit8088/coucou/releases/download/v1/Coucou_aarch64.dmg", releaseUrl: "https://github.com/Nomit8088/coucou/releases/tag/v1" };
  assert.deepEqual(updateAction(info), { kind: "download", url: info.downloadUrl });
  assert.deepEqual(updateAction({ ...info, downloadUrl: "https://github.com/Nomit8088/coucou/releases/download/v1/Coucou-setup.exe" }), { kind: "release", url: info.releaseUrl });
  assert.deepEqual(updateAction({ downloadUrl: null, releaseUrl: "" }), { kind: "release", url: RELEASES_URL });
  assert.deepEqual(updateAction(info, "linux"), { kind: "release", url: info.releaseUrl });
  const windows = { ...info, downloadUrl: "https://github.com/Nomit8088/coucou/releases/download/v1/Coucou-setup.exe" };
  assert.deepEqual(updateAction(windows, "windows"), { kind: "install", url: windows.downloadUrl });
});

test("native updater isolates executable IO under Windows cfg before any download", () => {
  const rust = readFileSync(new URL("../src-tauri/src/updater.rs", import.meta.url), "utf8");
  const command = rust.slice(rust.indexOf("pub async fn download_and_install_update"), rust.indexOf("#[cfg(test)]"));
  const mac = command.slice(command.indexOf('#[cfg(target_os = "macos")]'));
  assert.match(command, /#\[cfg\(windows\)\]\s*\{/);
  assert.doesNotMatch(mac, /temp_dir|std::fs::write|\.bytes\(\)|Client::builder/);
  assert.match(mac, /Command::new\("\/usr\/bin\/open"\)/);
  assert.match(command, /release_link\(&download_url, true\)/);
});
