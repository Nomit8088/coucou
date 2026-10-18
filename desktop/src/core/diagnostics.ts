// The text Settings → Diagnostics copies, for a GitHub issue.
//
// English on purpose: it is read by whoever maintains the app, not by the
// user's locale. Nothing secret is in it — no Keychain value, no message
// content, no chat history — and the settings snapshot is the subset
// src-tauri/src/diagnostics.rs picks for a bug report.

import type { DiagnosticsInfo } from "./bridge";

export function formatDiagnostics(info: DiagnosticsInfo, userAgent: string, now = new Date()): string {
  const s = info.settings;
  const h = info.hook;
  const lines: string[] = [
    "## Coucou diagnostics",
    "",
    `- Generated: ${now.toISOString()}`,
    `- App: Coucou ${info.appVersion} (${info.identifier})`,
    `- Host: ${info.os} ${info.arch}`,
    `- WebView: ${userAgent || "unknown"}`,
    `- Settings: ${info.settingsPath}`,
    `- Log: ${info.logPath}`,
    "",
    "### Preferences",
    "",
    `- Language: ${s.language || "system"} · main pill: ${s.mainPill || "none"}`,
    `- Active pills: ${s.activeIntegrations.length ? s.activeIntegrations.join(", ") : "none"}`,
    `- Screen: ${s.screen || "primary"} · sound: ${s.soundEnabled ? `on (${Math.round(s.soundVolume * 100)}%)` : "muted"}`,
    `- Launch at login: ${s.autostart ? "yes" : "no"}`,
    `- Chat: ${s.chatProvider || "none"}${s.model ? ` (${s.model})` : ""} · DSH profile: ${s.dshProfile || "default"}`,
    "",
    "### Claude Code hooks",
    "",
    `- Hooks installed: ${h.installed ? "yes" : "no"}`,
    `- settings.json: ${h.settingsExists ? "present" : "not created yet"}`,
  ];
  if (h.settingsError) lines.push(`- settings.json could not be read: ${h.settingsError}`);
  lines.push(`- Hook entries: ${h.events.length}/${h.expectedEvents.length} events`);
  if (h.missingEvents.length) lines.push(`- Missing events: ${h.missingEvents.join(", ")}`);
  if (h.stalePath) lines.push("- Entries point at another Coucou build's relay");
  lines.push(`- Status line relay: ${h.planRelayInstalled ? "yes" : "no"}`);
  lines.push(`- Relay: ${h.hookReady ? "present" : "missing"} (${h.hookPath})`);
  lines.push("");
  lines.push(`### Log tail (${info.logPath})`);
  lines.push("");
  lines.push("```text");
  lines.push(info.logTail.trimEnd() || "(no log yet)");
  lines.push("```");
  return `${lines.join("\n")}\n`;
}
