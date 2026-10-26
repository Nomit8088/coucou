// What's new after an update — when the card opens: once per version, a few
// seconds after Coucou starts (after the greeting), and only when nothing waits
// in the island: a permission or a question always comes first, and another
// card the user is reading is never replaced. The rules are in whats-new.ts;
// the card is views/whatsnew.ts.
//
// Trimmed from the upstream controller: no Flow/Notetaker numbers, so there is
// only one step.

import type { IslandViewName } from "../core/layout";
import { State } from "../core/state";
import FILE from "./whats-new.json";
import { decideOnLaunch, releaseFor, type WhatsNewFile, type WhatsNewRelease } from "./whats-new";

/** What the card needs from the island. */
export interface WhatsNewHost {
  alert(view: IslandViewName): void;
  collapse(): void;
}

/** The last version this install saw. A convenience of this install. */
const LAST_KEY = "coucou.whatsNew.lastVersion";

/** After the greeting, so the two never meet; then every few seconds while the island is busy. */
const FIRST_DELAY_MS = 3000;
const RETRY_MS = 5000;
const RETRIES = 24;

/** Views the card may replace: the island at rest. */
const QUIET_VIEWS: ReadonlySet<IslandViewName> = new Set(["overview", "empty"]);

function readLast(): string | null {
  try {
    return window.localStorage?.getItem(LAST_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLast(version: string) {
  try {
    window.localStorage?.setItem(LAST_KEY, version);
  } catch {
    // Storage refused: the card may come once more, never more than that per launch.
  }
}

class WhatsNewController {
  /** The release the card shows (null: no card). */
  release: WhatsNewRelease | null = null;
  /** Bumped when the card opens, so the view rebuilds. */
  generation = 0;
  private host: WhatsNewHost | null = null;
  private started = false;

  /**
   * At launch, once: show the card if Coucou was just updated. `firstRun` is
   * true for a fresh install (no settings file before this launch), which says
   * hello with the greeting rather than with release notes.
   */
  launch(host: WhatsNewHost, facts: { version: string; firstRun: boolean }) {
    if (this.started) return;
    this.started = true;
    this.host = host;

    const current = facts.version;
    const lastSeen = readLast();
    // Most launches this is all that runs.
    if (!current || lastSeen === current) return;

    const release = releaseFor(FILE as WhatsNewFile, current);
    const decision = decideOnLaunch({
      current,
      lastSeen,
      usedBefore: !facts.firstRun,
      hasEntry: release != null,
    });
    if (!decision.show || !release) {
      if (decision.record) writeLast(current);
      return;
    }
    this.release = release;
    this.generation++;
    this.openWhenQuiet(current, 0);
  }

  private openWhenQuiet(version: string, attempt: number) {
    window.setTimeout(() => {
      if (!this.quiet()) {
        if (attempt < RETRIES) this.openWhenQuiet(version, attempt + 1);
        // Busy for two minutes: next launch, then (the version is not recorded).
        return;
      }
      writeLast(version);
      this.host?.alert("whatsnew");
    }, attempt === 0 ? FIRST_DELAY_MS : RETRY_MS);
  }

  private quiet(): boolean {
    if (State.paused || State.pendingApproval) return false;
    return State.mode !== "expanded" || QUIET_VIEWS.has(State.view);
  }

  close() {
    this.host?.collapse();
  }
}

export const WhatsNew = new WhatsNewController();
