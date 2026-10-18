// Settings → Diagnostics: the text that goes on the clipboard. It has to name
// the moving parts of an install (paths, versions, hook state) so a bug report
// can be acted on, and it must never carry anything secret.

import { test } from "node:test";
import assert from "node:assert/strict";

const { formatDiagnostics } = await import("../src/core/diagnostics.ts");

const HOOK = {
  installed: true,
  planRelayInstalled: false,
  settingsPath: "C:\\Users\\me\\.claude\\settings.json",
  settingsExists: true,
  settingsError: null,
  hookPath: "C:\\Users\\me\\AppData\\Local\\Coucou\\bin\\coucou-hook.exe",
  hookReady: true,
  events: ["SessionStart", "PreToolUse"],
  expectedEvents: ["SessionStart", "PreToolUse", "Stop"],
  missingEvents: ["Stop"],
  stalePath: false,
};

const INFO = {
  appVersion: "0.2.1",
  identifier: "fr.louisraille.NotchBuddy",
  os: "windows",
  arch: "x86_64",
  settingsPath: "C:\\Users\\me\\.claude\\settings.json",
  localDir: "C:\\Users\\me\\AppData\\Local\\Coucou",
  logPath: "C:\\Users\\me\\AppData\\Local\\Coucou\\coucou.log",
  logTail: "2026-10-18 09:00:00 hook started",
  hook: HOOK,
  settings: {
    language: "zh-Hans",
    mainPill: "integration_claude",
    activeIntegrations: ["integration_claude"],
    screen: "primary",
    soundEnabled: true,
    soundVolume: 0.55,
    autostart: true,
    hooksInstalled: true,
    planRelayInstalled: false,
    showPlanInNotch: false,
    showCodexPlanInNotch: false,
    chatProvider: "deepseek",
    model: "deepseek-chat",
    dshProfile: "",
  },
};

const NOW = new Date("2026-10-18T09:30:00Z");
const format = (info = INFO) => formatDiagnostics(info, "Mozilla/5.0 Edg/123", NOW);

test("the summary names the app, the host and every path a report needs", () => {
  const text = format();
  assert.match(text, /Coucou 0\.2\.1 \(fr\.louisraille\.NotchBuddy\)/);
  assert.match(text, /Host: windows x86_64/);
  assert.match(text, /WebView: Mozilla\/5\.0 Edg\/123/);
  assert.ok(text.includes("Settings: C:\\Users\\me\\.claude\\settings.json"), text);
  assert.ok(text.includes("Log: C:\\Users\\me\\AppData\\Local\\Coucou\\coucou.log"), text);
  assert.match(text, /Language: zh-Hans/);
  assert.match(text, /sound: on \(55%\)/);
  assert.match(text, /Chat: deepseek \(deepseek-chat\)/);
  assert.match(text, /Generated: 2026-10-18T09:30:00\.000Z/);
});

test("the hooks section says what is connected and what is missing", () => {
  const text = format();
  assert.match(text, /Hooks installed: yes/);
  assert.match(text, /Hook entries: 2\/3 events/);
  assert.match(text, /Missing events: Stop/);
  assert.match(text, /Status line relay: no/);
  assert.match(text, /Relay: present \(C:\\Users\\me\\AppData\\Local\\Coucou\\bin\\coucou-hook\.exe\)/);
});

test("another build's relay and an unreadable settings.json are called out", () => {
  const text = format({ ...INFO, hook: { ...HOOK, stalePath: true, settingsError: "not JSON" } });
  assert.match(text, /Entries point at another Coucou build's relay/);
  assert.match(text, /settings\.json could not be read: not JSON/);
});

test("an install that was never made reads as 'no', not as a missing file", () => {
  const text = format({
    ...INFO,
    hook: {
      ...HOOK,
      installed: false,
      settingsExists: false,
      settingsError: null,
      hookReady: false,
      events: [],
      missingEvents: ["SessionStart", "PreToolUse", "Stop"],
    },
  });
  assert.match(text, /Hooks installed: no/);
  assert.match(text, /settings\.json: not created yet/);
  assert.match(text, /Hook entries: 0\/3 events/);
  assert.match(text, /Relay: missing/);
});

test("the log tail is fenced and never invents a log", () => {
  const text = format();
  assert.match(text, /### Log tail \(C:\\Users\\me\\AppData\\Local\\Coucou\\coucou\.log\)/);
  assert.match(text, /```text\n2026-10-18 09:00:00 hook started\n```/);
  assert.match(format({ ...INFO, logTail: "" }), /\(no log yet\)/);
  // Trailing blank lines in the file are trimmed, not copied into the report.
  assert.match(format({ ...INFO, logTail: "line\n\n" }), /```text\nline\n```/);
});
