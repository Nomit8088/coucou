// Pill catalog for this personal Windows fork. IDs are contract values
// (settings, hook routing, credentials). New IDs written here do not change:
// agent_dsh, integration_gitlab, integration_qqmusic. Official Mac catalog pills
// that this fork does not use are absent on purpose — do not add them back for
// parity.

import type { AgentSource } from "./state";
import { N_ } from "../i18n/i18n";

export type PillCategory = "workspace" | "agent" | "ai" | "service";

/** Section titles (English keys, shown with `t()`), in display order. */
export const PILL_CATEGORIES: { id: PillCategory; title: string }[] = [
  { id: "workspace", title: N_("Where you code") },
  { id: "service", title: N_("Services") },
];

export type PillSupport = "yes" | "windows" | "linux" | "soon" | "no";

export type PillConnect =
  | { kind: "hooks" }
  | { kind: "key"; key: string }
  | { kind: "none" };

export interface PillDefinition {
  id: string;
  name: string;
  color: string;
  category: PillCategory;
  subtitle: string;
  source: AgentSource;
  support: PillSupport;
  connect: PillConnect;
  /**
   * A music pill: the player's application id as Windows' media session reports
   * it (SMTC's SourceAppUserModelId). `src-tauri/src/spotify.rs` follows the
   * sessions of these pills, and `core/spotify.ts` is the one that reads it.
   */
  mediaApp?: string;
}

export type HostOs = "windows" | "linux";

const hooks: PillConnect = { kind: "hooks" };
const key = (k: string): PillConnect => ({ kind: "key", key: k });
const none: PillConnect = { kind: "none" };

export const PILL_CATALOG: readonly PillDefinition[] = [
  { id: "agent_dsh", name: "DeepSeek Harness", color: "#4D6BFE", category: "workspace",
    subtitle: N_("Agent"), source: "agent", support: "yes", connect: hooks },
  { id: "agent_codex", name: "Codex", color: "#2DD4BF", category: "workspace",
    subtitle: N_("Integration"), source: "agent", support: "yes", connect: hooks },
  { id: "integration_github", name: "GitHub", color: "#F4505E", category: "service",
    subtitle: N_("Integration"), source: "n8n", support: "yes", connect: key("github-token") },
  { id: "integration_resend", name: "Resend", color: "#22C55E", category: "service",
    subtitle: N_("Integration"), source: "n8n", support: "yes", connect: key("resend-api-key") },
  { id: "integration_gitlab", name: "GitLab", color: "#FC6D26", category: "service",
    subtitle: N_("Integration"), source: "n8n", support: "yes", connect: key("gitlab-token") },
  // Spotify's MPRIS interface on the session bus (src-tauri/src/spotify.rs), and
  // its media session on Windows (the same file, SMTC).
  { id: "integration_spotify", name: "Spotify", color: "#1DB954", category: "service",
    subtitle: N_("Integration"), source: "n8n", support: "yes", connect: none, mediaApp: "Spotify.exe" },
  // QQ Music on Windows, through the media session its PC client registers.
  { id: "integration_qqmusic", name: "QQ Music", color: "#31C27C", category: "service",
    subtitle: N_("Integration"), source: "n8n", support: "windows", connect: none, mediaApp: "QQMusic.exe" },
  // NetEase Cloud Music on Windows, through the media session its PC client registers.
  { id: "integration_cloudmusic", name: "CloudMusic", color: "#C20C0C", category: "service",
    subtitle: N_("Integration"), source: "n8n", support: "windows", connect: none, mediaApp: "cloudmusic.exe" },
  // The mailbox: read over IMAP with the account's authorisation code, never a
  // password, and never written to.
  { id: "integration_qqmail", name: "QQ Mail", color: "#12B7F5", category: "service",
    subtitle: N_("Integration"), source: "n8n", support: "yes", connect: key("qqmail-auth-code") },
];

/** The always-on pill unless the user picks another workspace tool. */
export const DEFAULT_MAIN_PILL = "agent_dsh";

/** How many declared pills may sit next to the main one. */
export const MAX_DECLARED = 4;

export const HOST_OS: HostOs =
  typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent ?? "") ? "windows" : "linux";

export function pillDefinition(id: string): PillDefinition | undefined {
  return PILL_CATALOG.find((p) => p.id === id);
}

function offeredOn(def: PillDefinition, os: HostOs): boolean {
  return def.support === "yes" || def.support === "soon" || def.support === os;
}

export function availablePills(os: HostOs = HOST_OS): PillDefinition[] {
  return PILL_CATALOG.filter((p) => offeredOn(p, os));
}

export function isComingSoon(id: string): boolean {
  return pillDefinition(id)?.support === "soon";
}

export function isHookPill(id: string): boolean {
  return pillDefinition(id)?.connect.kind === "hooks";
}

export function mainPillChoices(os: HostOs = HOST_OS): PillDefinition[] {
  return availablePills(os).filter((p) => p.category === "workspace" && p.support !== "soon");
}

export function sessionSubtitle(id: string): string {
  switch (id) {
    case "agent_dsh": return "DeepSeek Harness";
    case "agent_codex": return "Codex";
    default: return N_("Agent");
  }
}

export interface Declared {
  mainPill: string;
  activeIntegrations: string[];
}

export function sanitizeDeclared(d: Declared, os: HostOs = HOST_OS): Declared {
  const mains = new Set(mainPillChoices(os).map((p) => p.id));
  const mainPill = mains.has(d.mainPill) ? d.mainPill : DEFAULT_MAIN_PILL;
  const offered = new Set(availablePills(os).map((p) => p.id));
  const activeIntegrations: string[] = [];
  for (const id of d.activeIntegrations ?? []) {
    if (id !== mainPill && offered.has(id) && !activeIntegrations.includes(id)) {
      activeIntegrations.push(id);
    }
  }
  return { mainPill, activeIntegrations };
}

export function toggleDeclared(d: Declared, id: string, os: HostOs = HOST_OS): string[] | null {
  if (id === d.mainPill) return null;
  if (!availablePills(os).some((p) => p.id === id)) return null;
  if (d.activeIntegrations.includes(id)) return d.activeIntegrations.filter((x) => x !== id);
  if (d.activeIntegrations.length >= MAX_DECLARED) return null;
  return [...d.activeIntegrations, id];
}

export function chooseMainPill(d: Declared, id: string, os: HostOs = HOST_OS): Declared | null {
  if (!mainPillChoices(os).some((p) => p.id === id)) return null;
  return { mainPill: id, activeIntegrations: d.activeIntegrations.filter((x) => x !== id) };
}

export function orderPills<T extends { id: string }>(tasks: T[], mainPill: string): T[] {
  const index = new Map(PILL_CATALOG.map((p, i) => [p.id, i]));
  const rank = (t: T) => (t.id === mainPill ? -2 : index.has(t.id) ? index.get(t.id)! : -1);
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map(({ t }) => t);
}
