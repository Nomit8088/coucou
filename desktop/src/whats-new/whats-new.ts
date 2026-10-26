// What's new after an update, and the blue Mochi while one waits — the rules,
// pure, so tests/whats-new.test.mjs checks them. The island side is in
// controller.ts, the card in views/whatsnew.ts.
//
// The entries come from whats-new.json, one per release, in the languages this
// fork ships. Ported from the upstream module and trimmed: this fork has no
// Flow dictation and no Notetaker, so there is no "Your Coucou so far" step
// (its numbers came from Flow) and no "buy Mochi a coffee" link.

import type { UpdateInfo } from "../core/bridge";
import type { BotStateName } from "../core/layout";

/** The icons an entry may use. */
export const ICON_NAMES = [
  "update", "languages", "terminal", "checklist", "bell", "chat", "mic", "phone", "shield",
  "sparkles", "bolt", "puzzle", "paint", "eye", "keyboard", "heart", "clock", "download", "bug",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export interface WhatsNewItem {
  icon: string;
  title: Record<string, string>;
  detail: Record<string, string>;
}

export interface WhatsNewRelease {
  version: string;
  items: WhatsNewItem[];
}

export interface WhatsNewFile {
  releases: WhatsNewRelease[];
}

// ── Versions ──────────────────────────────────────────────────────────────────

/** -1, 0 or 1, numerically: 0.10.0 is after 0.9.3, 0.5 equals 0.5.0. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const y = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const l = x[i] ?? 0;
    const r = y[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/** The entry of exactly this version, or null (then there is no card). */
export function releaseFor(file: WhatsNewFile | null | undefined, version: string): WhatsNewRelease | null {
  const list = file?.releases;
  if (!Array.isArray(list) || !version) return null;
  const found = list.find((r) => r && compareVersions(r.version, version) === 0);
  if (!found || !Array.isArray(found.items) || found.items.length === 0) return null;
  return found;
}

/** The text in `lang`, else English, else nothing. */
export function localized(texts: Record<string, string> | null | undefined, lang: string): string {
  if (!texts) return "";
  const v = texts[lang];
  if (typeof v === "string" && v.trim()) return v;
  const en = texts.en;
  return typeof en === "string" ? en : "";
}

/** An unknown icon name draws the sparkles rather than nothing. */
export function iconName(name: string): IconName {
  return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : "sparkles";
}

// ── At launch: show it, or only remember the version ─────────────────────────

export interface LaunchFacts {
  /** The version running. */
  current: string;
  /** The last version this install saw (null: none stored yet). */
  lastSeen: string | null;
  /**
   * Signs that Coucou ran here before, for installs from before this card
   * existed: they stored no version, and a first install says hello with the
   * greeting instead of release notes.
   */
  usedBefore: boolean;
  /** whats-new.json has an entry for `current`. */
  hasEntry: boolean;
}

export interface LaunchDecision {
  /** Open the card once. */
  show: boolean;
  /** Store `current` as the version seen. */
  record: boolean;
}

export function decideOnLaunch(f: LaunchFacts): LaunchDecision {
  if (!f.current) return { show: false, record: false };
  if (f.lastSeen == null) {
    // A first install says hello with the greeting, not with release notes.
    return { show: f.usedBefore && f.hasEntry, record: true };
  }
  const cmp = compareVersions(f.current, f.lastSeen);
  if (cmp === 0) return { show: false, record: false };
  // Going back to an older build: remember it, say nothing.
  return { show: cmp > 0 && f.hasEntry, record: true };
}

// ── The blue Mochi while a version waits ──────────────────────────────────────

/** "Later" keeps the version quiet for a day, the blue included. */
export const LATER_MS = 24 * 3600 * 1000;

export interface Later {
  version: string;
  /** Epoch milliseconds. */
  at: number;
}

/**
 * A newer version is out, a check found it, and "Later" was not pressed for it
 * in the last day. Nothing is installed on its own: the blue only says so.
 */
export function updateWaiting(info: UpdateInfo | null, later: Later | null, nowMs: number): boolean {
  if (!info || !info.hasUpdate || !info.latestVersion) return false;
  if (later && later.version === info.latestVersion && nowMs >= later.at && nowMs - later.at < LATER_MS) {
    return false;
  }
  return true;
}

/** Mochi turns blue only when he has nothing else to say. */
export function showsUpdateHint(waiting: boolean, state: BotStateName, pending: boolean): boolean {
  return waiting && !pending && (state === "idle" || state === "sleeping");
}

/** The release page of this version, for "All changes". */
export function releasePage(repo: string, version: string): string {
  return `https://github.com/${repo}/releases/tag/v${encodeURIComponent(version)}`;
}

/** The blue of an update, and of the arrow badge. */
export const UPDATE_BLUE = "#3B82F6";
