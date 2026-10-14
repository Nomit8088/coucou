// Integration events → island state. Port of the `handle…` methods in the Swift
// pollers: a genuinely new item flips the pill to finished/error, badges it when
// the pill isn't focused, plays a sound, and clears itself after 60 s.

import { onEvent, Bridge, type IntegrationUpdate } from "../core/bridge";
import { gitHubAlert, gitNotice, type GitHubEvent } from "../core/github";
import { availablePills } from "../core/pills";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { Island } from "./island";

const GITHUB = "integration_github";

const clearTimers = new Map<string, number>();
/** A comment/pipeline notice arrived while a permission card was up. Show it when that card leaves. */
let deferredNotice = false;

/** Tests start from a clean notice, including one deferred by an earlier case. */
export function clearDeferredNotice() {
  deferredNotice = false;
}

/** The approval card is gone and a notice was waiting. Opens it, or returns false. */
export function presentDeferredNotice(island: Island): boolean {
  if (!deferredNotice || !State.notice || State.pendingApproval) return false;
  deferredNotice = false;
  State.setFocus(State.notice.pillId);
  island.alert("notice");
  return true;
}

function showNotice(island: Island, notice: GitNotice) {
  State.notice = notice;
  if (State.pendingApproval) {
    deferredNotice = true;
    return;
  }
  deferredNotice = false;
  State.setFocus(notice.pillId);
  island.alert("notice");
}

export function registerIntegrationHandlers(island: Island) {
  void onEvent<IntegrationUpdate>("integration", (update) => handle(island, update));
  void onEvent<GitHubEvent[]>("github-alerts", (events) => handleGitAlerts(island, events, GITHUB, false));
  void onEvent<GitHubEvent[]>("gitlab-alerts", (events) => handleGitAlerts(island, events, "integration_gitlab", true));
  void refreshConfigured();
  State.subscribe(refreshGitHubWhenShown);
  State.subscribe(refreshGitLabWhenShown);
}

/**
 * AppState.handleGitHubEvents: the loudest event sets the badge — only while the
 * GitHub pill isn't the one on screen — and plays its sound. Unlike the other
 * integrations it leaves Mochi's state alone and the badge stays until the pill
 * is focused, as on macOS.
 */
export function handleGitHubAlerts(events: GitHubEvent[]) {
  handleGitAlerts({ alert() {}, setView() {}, reveal() {} } as unknown as Island, events, GITHUB, false);
}

function handleGitAlerts(island: Island, events: GitHubEvent[], pillId: string, gitlab: boolean) {
  if (State.paused) return;
  const alert = gitHubAlert(events);
  if (!alert) return;
  const task = State.tasks.find((t) => t.id === pillId);
  if (!task) return;
  if (State.focusId !== pillId) task.pillBadge = alert.badge;
  Sound.play(alert.sound);
  const notice = gitNotice(events, pillId, gitlab);
  if (notice) showNotice(island, notice);
  State.notify();
}

let gitHubShown = false;
let gitLabShown = false;

function refreshGitLabWhenShown() {
  const shown = State.mode === "expanded" && State.focusTask?.id === "integration_gitlab";
  if (shown && !gitLabShown) void Bridge.gitlabRefresh();
  gitLabShown = shown;
}

/** The GitHub card just came on screen (focused, island opened): refresh it if stale. */
function refreshGitHubWhenShown() {
  const shown = State.mode === "expanded" && State.focusTask?.id === GITHUB;
  if (shown && !gitHubShown) void Bridge.githubRefresh("pulse");
  gitHubShown = shown;
}

/**
 * Whether each pill is connected, so its idle card can say so: a key in the
 * credential store for a service or a chat provider, the hooks in place for a
 * pill fed by hook events (Mac #183), nothing at all for Claude Desktop.
 */
export async function refreshConfigured() {
  const hooks = (await Bridge.agentHooksStatus()) ?? null;
  for (const def of availablePills(State.os)) {
    let configured: boolean;
    switch (def.connect.kind) {
      case "key":
        configured = (await Bridge.secretPresent(def.connect.key)) ?? false;
        break;
      case "hooks":
        configured = hooks?.[def.id] ?? false;
        break;
      case "none":
        configured = true;
        break;
    }
    const info = State.integrations[def.id] ?? { data: {}, error: null, loaded: false, configured: false };
    State.integrations[def.id] = { ...info, configured };
  }
  State.notify();
}

/** Only the hook-driven pills, for when the island opens: a few small file reads. */
export async function refreshHookPills() {
  const hooks = await Bridge.agentHooksStatus();
  if (!hooks) return;
  for (const [id, present] of Object.entries(hooks)) {
    const info = State.integrations[id] ?? { data: {}, error: null, loaded: false, configured: false };
    State.integrations[id] = { ...info, configured: present };
  }
  State.notify();
}

function handle(island: Island, update: IntegrationUpdate) {
  if (State.paused) return;

  const previous = State.integrations[update.id];
  State.integrations[update.id] = {
    data: update.error ? (previous?.data ?? {}) : update.data,
    error: update.error,
    loaded: update.error ? (previous?.loaded ?? false) : true,
    configured: previous?.configured ?? true,
  };

  const event = update.event;
  if (event) {
    const task = State.tasks.find((t) => t.id === update.id);
    if (task) {
      task.state = event.success ? "finished" : "error";
      task.steps = event.detail ? [event.label, event.detail] : [event.label];
      task.stepIndex = task.steps.length - 1;
      if (State.focusId !== update.id) {
        task.pillBadge = event.success ? "finished" : "error";
      }
      Sound.play(event.success ? "finish" : "error");
      // Same as the Swift pollers: show the compact island so the badge is seen,
      // but never steal the screen for a successful deploy.
      island.reveal();

      const existing = clearTimers.get(update.id);
      if (existing != null) window.clearTimeout(existing);
      clearTimers.set(
        update.id,
        window.setTimeout(() => {
          clearTimers.delete(update.id);
          const t = State.tasks.find((x) => x.id === update.id);
          if (!t || (t.state !== "finished" && t.state !== "error")) return;
          t.state = "idle";
          t.steps = [];
          t.stepIndex = 0;
          t.pillBadge = null;
          State.notify();
        }, 60_000),
      );
    }
  }

  State.notify();
}
