// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";
import {
  DEFAULT_MAIN_PILL, HOST_OS, MAX_DECLARED, availablePills, orderPills, pillDefinition, sanitizeDeclared,
  toggleDeclared, type HostOs, type PillDefinition,
} from "./pills";
import type { CodexPlanUsage, PlanUsage } from "./plan";
import type { ChatProviderConfig } from "./providers";
import type { FileDiff } from "./diff";
import type { Bindings } from "./shortcuts";
import { DEFAULT_OUTFIT, type Outfit } from "../mochi/wardrobe";
import { pillColor } from "./pill-colors";
import { Spotify, musicPlaying } from "./spotify";

export type AgentSource = "claudeCode" | "n8n" | "agent";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  /**
   * Position of the newest step in the whole session. `steps` is capped, so
   * `stepIndex` stops moving once it is full; this keeps counting.
   */
  stepSeq?: number;
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
  /** Claude Code's display-owner session, so "Open terminal" can find its window. */
  sessionId?: string | null;
  /** Claude's final message after Stop, one line; cleared when a new turn starts. */
  finalLine?: string | null;
  /**
   * The answer as it is being written, one short line. A preview only: it is
   * replaced in place and never pushed into `steps`, so a token-by-token feed
   * cannot grow the ticker's history. Cleared at the next step or turn end.
   */
  liveLine?: string | null;
}

export interface SessionRecord {
  id: string;
  state: BotStateName;
  projectName?: string;
  cwd?: string;
  lastWorked: number;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  /** The pill the request belongs to: VS Code's or Cursor's (Claude Code), or an agent's (Codex…). */
  pillId: string;
  tool: string;
  command: string;
  /** Set when Claude Code is asking a question rather than for a permission. */
  questions?: AskedQuestion[];
  /** Set when Claude Code has finished a plan (ExitPlanMode) and asks how to proceed. */
  isPlan?: boolean;
}

/** One question of an AskUserQuestion call. */
export interface AskedQuestion {
  /** DSH question id, when the request came from user-questions. */
  id?: string;
  question: string;
  header?: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

/** A fresh, idle task for a catalog pill, in the colour the user gave it if any. */
function taskFor(def: PillDefinition, colors: unknown, name = def.name): AgentTask {
  return {
    id: def.id, name, color: pillColor(def.id, def.color, colors), state: "idle", stepIndex: 0, steps: [],
    source: def.source, isIntegration: true,
  };
}

/** What an integration poller last reported. */
export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  /** Hovering the island opens it all the way (off: hovering only peeks). */
  openOnHover: boolean;
  /** Date and time in the middle of the compact island. */
  showClock: boolean;
  absenceInterval: number;
  /** Declared pills next to the main one (at most 4), in the order they were added. */
  activeIntegrations: string[];
  /** The always-on workspace pill: VS Code, Cursor, Codex or Antigravity. */
  mainPill: string;
  /** "primary", "cursor", or `at:<x>,<y>` for one display (logical origin). */
  screen: string;
  autostart: boolean;
  /**
   * Nothing opens the island on its own while this is on, and minimizing takes
   * it off the screen instead of folding it: only the tray's Open (or a
   * shortcut the user presses) brings it back.
   */
  doNotDisturb: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat. */
  model: string;
  /** Show the Claude plan pill (5 h and weekly limits) in the island's header. */
  showPlanInNotch: boolean;
  /** Coucou's status line relay is installed in Claude Code's settings. */
  planRelayInstalled: boolean;
  /** Show the Codex plan pill in the island's header. */
  showCodexPlanInNotch: boolean;
  /** Who the chat talks to: a chatProviders id. */
  chatProvider: string;
  /** DeepSeek plus any OpenAI-compatible provider the user added. */
  chatProviders: ChatProviderConfig[];
  /** DeepSeek Harness profile directory. Empty means ~/.dsh/profiles/web. */
  dshProfile: string;
  /** The model picked for each provider other than Anthropic, by provider id. */
  chatModels: Record<string, string>;
  /** Model server addresses once connected; empty means not connected. */
  ollamaUrl: string;
  lmstudioUrl: string;
  customUrl: string;
  /** Global shortcuts the user changed, by action id (see core/shortcuts.ts). */
  shortcuts: Bindings;
  /**
   * Mochi's outfit: "auto" (dresses for the season), "none" or an outfit id.
   * Same raw values as the Mac's "mochiOutfit"; read it through parseOutfit.
   */
  mochiOutfit: string;
  /**
   * A colour of the user's own for a pill's Mochi, by pill ID ("#RRGGBB").
   * Empty means the catalog's colours; read it through core/pill-colors.ts.
   * Same key and values as the Mac's "pillColors".
   */
  pillColors: Record<string, string>;
  /**
   * Interface language: "" follows the system (when Coucou has its language,
   * else English), or one of src/i18n's ten codes ("fr", "pt-BR", "zh-Hans"…).
   */
  language: string;
  /** Custom global hotkey to send when liking a track, by pill id ("integration_qqmusic": "Ctrl+Alt+V"). */
  musicLikeHotkeys: Record<string, string>;
  /** Which GitHub PRs the island watches. */
  githubWatch: GitWatch;
  /** Which GitLab MRs the island watches. */
  gitlabWatch: GitWatch;
  /**
   * A new mail opens the island on its notice card. Off: only the chime and
   * the pill badge (which is invisible while the island is compact).
   */
  mailPopup: boolean;
  /** Mochi on the desktop. Rust owns it: whatever the page sends back is ignored. */
  desktopMochi?: {
    onDesktop: boolean;
    spot: { x: number; y: number; space: string } | null;
  };
}

export interface GitWatch {
  created: boolean;
  assigned: boolean;
  review: boolean;
}

export interface GitNotice {
  pillId: string;
  /** Said next to the pill's name — "New email" on the mailbox's notice. */
  label?: string;
  title: string;
  detail: string;
  url: string;
  action: string;
  tone: "success" | "error" | "info";
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  openOnHover: false,
  showClock: false,
  absenceInterval: 180,
  activeIntegrations: ["integration_github", "integration_resend"],
  mainPill: DEFAULT_MAIN_PILL,
  screen: "primary",
  autostart: false,
  doNotDisturb: false,
  hooksInstalled: false,
  model: "deepseek-chat",
  showPlanInNotch: false,
  planRelayInstalled: false,
  showCodexPlanInNotch: false,
  chatProvider: "deepseek",
  chatProviders: [],
  dshProfile: "",
  chatModels: {},
  musicLikeHotkeys: {},
  ollamaUrl: "",
  lmstudioUrl: "",
  customUrl: "",
  shortcuts: {},
  mochiOutfit: DEFAULT_OUTFIT,
  pillColors: {},
  language: "",
  githubWatch: { created: true, assigned: true, review: true },
  gitlabWatch: { created: true, assigned: true, review: true },
  mailPopup: true,
};

type Listener = () => void;

/** Live diffs kept per pill (oldest dropped first) — same cap as macOS. */
export const MAX_DIFFS_PER_PILL = 50;
/** A pill's diffs are forgotten after an hour without a new one, as on macOS. */
export const DIFF_TTL_MS = 3_600_000;

/**
 * Which state a pill shows when several live sessions share it. A Record rather
 * than a list so TypeScript refuses a new BotStateName that has no rank; with an
 * array, indexOf's -1 sorted an unranked state ahead of "error".
 */
const STATE_PRIORITY: Record<BotStateName, number> = {
  error: 0, approval: 1, question: 2, working: 3, thinking: 4, searching: 5,
  ratelimit: 6, finished: 7, sleeping: 8, dizzy: 9, idle: 10,
};

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;
  /** Requests waiting behind the visible card, in arrival order. */
  approvalQueue: ApprovalInfo[] = [];
  /** The pill that was in front when the card came up; it comes back after. */
  focusBeforeApproval: string | null = null;

  /** Session records currently contributing state and display identity to each agent pill. */
  private liveSessions = new Map<string, Map<string, SessionRecord>>();

  integrations: Record<string, IntegrationInfo> = {};

  /** Claude's 5 h / weekly limits, from the status line (null until the first call). */
  planUsage: PlanUsage | null = null;
  /** Codex's limits, from `codex app-server` (null until it has answered). */
  codexPlanUsage: CodexPlanUsage | null = null;
  /**
   * The DSH session's context pressure, by pill, as the plugin reported it:
   * how many tokens the request now carries and the window it must fit in.
   * Empty until the plugin reports one — a profile without the token meter
   * simply never fills it.
   */
  contextUsage = new Map<string, { tokens: number; window: number; updatedAt: number }>();
  /**
   * The DSH session's background jobs, by pill, as the plugin reported them.
   * Counts, a producer label and its own progress line — never a job's output.
   */
  jobInfo = new Map<string, { running: number; total: number; label: string; progress: string }>();
  /** DSH's host-wide scheduled reminders (0 active until the plugin says). */
  scheduleInfo: { active: number; total: number; next: string } = { active: 0, total: 0, next: "" };
  /** DSH permission presets per session: current preset name and available presets. */
  permissionPresets = new Map<string, { current: string; available: string[] }>();
  /** A plan card is open in place of the overview's left card. */
  showingPlanDetail = false;
  /** Which one: the Codex card rather than Claude's. */
  planDetailIsCodex = false;
  /** Per-pill file diffs, in order of reception. Steps carry their ids. */
  sessionDiffs = new Map<string, FileDiff[]>();
  /** The overview is showing the full-width editor-style diff detail. */
  showingDiffDetail = false;
  /** The overview is showing a full-width integration detail (e.g. GitLab). */
  showingIntegrationDetail = false;
  private sessionDiffTimers = new Map<string, number>();
  /** Never reset, so an id can never point at a newer diff than the one tapped. */
  private nextDiffId = 0;
  /** Ctrl+↑ / Ctrl+↓: the highlighted row of the card's list (AppState.cardSelection). */
  cardSelection: number | null = null;
  /** Rows in the list on screen, 0 when there is none (AppState.cardItemCount). */
  cardItemCount = 0;
  /**
   * Mochi is out of the island — on the desktop, flying, or being dragged
   * there — so the island's own Mochi is hidden (AppState.mochiOnDesktop).
   */
  mochiOnDesktop = false;

  /** Outfit shown on Mochi while the pointer rests on a wardrobe button. */
  wardrobePreview: Outfit | null = null;

  lastActivity = performance.now();

  /** GitHub/GitLab island notice (pipeline, new PR/MR, comments). */
  notice: GitNotice | null = null;

  settings: Settings = { ...DEFAULT_SETTINGS };

  /** Which pills this build offers depends on it (Claude Desktop is Windows only). */
  os: HostOs = HOST_OS;

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  /** Spotify plays on a declared pill: Mochi dances (Linux; never on Windows yet). */
  get spotifyPlaying(): boolean {
    return musicPlaying(Spotify.state, sanitizeDeclared(this.settings, this.os).activeIntegrations);
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  /**
   * The up-to-four pills next to the focused one. Declared tools keep their
   * slots; a live session of something the user did not turn on (Codex with
   * hooks installed, an unknown agent…) only fills a leftover slot.
   */
  get visibleOtherPills(): AgentTask[] {
    const others = this.otherTasks;
    const kept = others.filter((t) => this.isKept(t.id));
    const extra = others.filter((t) => !this.isKept(t.id));
    const declared = sanitizeDeclared(this.settings, this.os).activeIntegrations.length;
    const extraSlots = Math.max(0, MAX_DECLARED - declared);
    return [...kept, ...extra.slice(0, extraSlots)];
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    this.showingPlanDetail = false;
    t.pillBadge = null;
    this.notify();
  }

  /**
   * A permission card or a question comes up: its pill comes to the front, and
   * the pill that was there is remembered (HookServer.focusBeforeApproval).
   */
  beginApproval(info: ApprovalInfo) {
    this.pendingApproval = info;
    this.isPinned = true;
    if (this.focusBeforeApproval == null) this.focusBeforeApproval = this.focusId;
    this.setFocus(info.pillId);
  }

  /** Adds a request once; returns true when it became the visible card. */
  enqueueApproval(info: ApprovalInfo): boolean {
    if (!info.requestId) return false;
    if (this.pendingApproval?.requestId === info.requestId || this.approvalQueue.some((x) => x.requestId === info.requestId)) return false;
    if (this.pendingApproval || this.approvalQueue.length > 0) {
      if (this.approvalQueue.length >= 5) return false;
      this.approvalQueue.push(info);
      this.notify();
      return false;
    }
    this.beginApproval(info);
    return true;
  }

  /**
   * The card has its answer, or is withdrawn. Promote the next queued request
   * and return it so the island can display it immediately.
   */
  endApproval(): ApprovalInfo | null {
    const req = this.pendingApproval;
    if (!req) return null;
    this.pendingApproval = null;
    this.isPinned = false;
    if (req.sessionId && this.hasSession(req.pillId, req.sessionId)) this.sessionState(req.pillId, req.sessionId, "working");
    else this.updateTask(req.pillId, "working");
    this.setPillBadge(req.pillId, null);
    const next = this.approvalQueue.shift() ?? null;
    const previous = this.focusBeforeApproval;
    this.focusBeforeApproval = null;
    if (next) {
      this.beginApproval(next);
    } else if (previous && this.focusId === req.pillId && this.tasks.some((t) => t.id === previous)) {
      this.focusId = previous;
    }
    this.notify();
    return next;
  }

  hasApproval(requestId: string): boolean {
    return this.pendingApproval?.requestId === requestId || this.approvalQueue.some((x) => x.requestId === requestId);
  }

  /** Remove queued requests invalidated by a turn/session ending. */
  discardQueuedApprovals(pillId: string, sessionId: string): string[] {
    const removed = this.approvalQueue.filter((x) => x.pillId === pillId && x.sessionId === sessionId).map((x) => x.requestId);
    if (removed.length) {
      this.approvalQueue = this.approvalQueue.filter((x) => !(x.pillId === pillId && x.sessionId === sessionId));
      this.notify();
    }
    return removed;
  }

  registerSession(id: string, sessionId: string, projectName?: string, cwd?: string) {
    if (!sessionId) return;
    const sessions = this.liveSessions.get(id) ?? new Map<string, SessionRecord>();
    const existing = sessions.get(sessionId);
    if (!existing) {
      sessions.set(sessionId, {
        id: sessionId,
        state: "idle",
        projectName,
        cwd,
        lastWorked: 0,
      });
    } else {
      if (projectName && !existing.projectName) existing.projectName = projectName;
      if (cwd && !existing.cwd) existing.cwd = cwd;
    }
    this.liveSessions.set(id, sessions);
    this.applyDisplayOwner(id);
  }

  hasSession(id: string, sessionId: string): boolean {
    return !!sessionId && this.liveSessions.get(id)?.has(sessionId) === true;
  }

  /** True while any registered session still owns this pill. */
  hasAnySession(id: string): boolean {
    return (this.liveSessions.get(id)?.size ?? 0) > 0;
  }

  /** Test/restart boundary: forget live session ownership without touching pills. */
  resetLiveSessions() {
    this.liveSessions.clear();
  }

  /**
   * The session whose project name and cwd the pill shows, so the name matches
   * the activity under it: the oldest session that is mid-turn, else the session
   * that worked last. Port of HookServer.applyDisplayOwner (#761).
   */
  applyDisplayOwner(id: string) {
    const task = this.tasks.find((x) => x.id === id);
    if (!task) return;
    const sessions = this.liveSessions.get(id);
    if (!sessions || sessions.size === 0) return;

    const isWorking = (s: BotStateName) =>
      s === "working" || s === "thinking" || s === "question" || s === "ratelimit" || s === "approval";

    // 1. Pick the oldest session that is mid-turn
    let owner: SessionRecord | null = null;
    for (const s of sessions.values()) {
      if (isWorking(s.state)) {
        owner = s;
        break;
      }
    }

    // 2. If no session is working, pick the session that worked last
    if (!owner) {
      let newest = -1;
      for (const s of sessions.values()) {
        if (s.lastWorked > newest) {
          newest = s.lastWorked;
          owner = s;
        }
      }
    }

    // 3. Fallback to the first live session
    if (!owner) {
      owner = sessions.values().next().value ?? null;
    }

    if (owner) {
      task.sessionId = owner.id;
      if (owner.projectName) task.name = owner.projectName;
      if (owner.cwd) task.sessionCwd = owner.cwd;
    }
  }

  sessionState(id: string, sessionId: string, state: BotStateName) {
    if (!sessionId) return this.updateTask(id, state);
    this.registerSession(id, sessionId);
    const s = this.liveSessions.get(id)!.get(sessionId)!;
    s.state = state;
    const isWorking =
      state === "working" || state === "thinking" || state === "question" || state === "ratelimit" || state === "approval";
    if (isWorking) s.lastWorked = performance.now();

    const aggregate = [...this.liveSessions.get(id)!.values()]
      .map((r) => r.state)
      .reduce<BotStateName>((worst, cur) => (STATE_PRIORITY[cur] < STATE_PRIORITY[worst] ? cur : worst), "idle");
    this.updateTask(id, aggregate);
    this.applyDisplayOwner(id);
  }

  removeSession(id: string, sessionId: string): boolean {
    const sessions = this.liveSessions.get(id);
    if (!sessions || !sessionId) return true;
    sessions.delete(sessionId);
    if (!sessions.size) {
      this.liveSessions.delete(id);
      const task = this.tasks.find((x) => x.id === id);
      if (task) task.sessionId = null;
    } else {
      this.applyDisplayOwner(id);
      const remainingStates = [...sessions.values()].map((r) => r.state);
      const aggregate = remainingStates.reduce<BotStateName>(
        (worst, cur) => (STATE_PRIORITY[cur] < STATE_PRIORITY[worst] ? cur : worst),
        "idle",
      );
      this.updateTask(id, aggregate);
    }
    return (sessions.size ?? 0) === 0;
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const newest = t.stepSeq ?? t.steps.length - 1;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    t.stepSeq = newest + 1;
    // A real step supersedes the streaming preview: the row goes back to
    // showing steps, and the next preview line starts a new one.
    t.liveLine = null;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** Stores a diff for a pill and returns its id (for the ticker step). */
  appendSessionDiff(pillId: string, diff: FileDiff): number {
    const id = this.nextDiffId++;
    const list = this.sessionDiffs.get(pillId) ?? [];
    list.push({ ...diff, id });
    while (list.length > MAX_DIFFS_PER_PILL) list.shift();
    this.sessionDiffs.set(pillId, list);
    // One timer per pill, re-armed on every diff — nothing polls.
    const prev = this.sessionDiffTimers.get(pillId);
    if (prev != null) window.clearTimeout(prev);
    this.sessionDiffTimers.set(
      pillId,
      window.setTimeout(() => this.clearSessionDiffs(pillId), DIFF_TTL_MS),
    );
    return id;
  }

  findDiff(pillId: string, id: number): FileDiff | null {
    return this.sessionDiffs.get(pillId)?.find((d) => d.id === id) ?? null;
  }

  clearSessionDiffs(pillId: string) {
    const timer = this.sessionDiffTimers.get(pillId);
    if (timer != null) window.clearTimeout(timer);
    this.sessionDiffTimers.delete(pillId);
    this.sessionDiffs.delete(pillId);
  }

  /** The always-on workspace pill, once the setting has been checked. */
  get mainPillId(): string {
    return sanitizeDeclared(this.settings, this.os).mainPill;
  }

  /**
   * True for a pill that stays when its session ends: the main pill and the
   * declared ones go back to idle instead of going away.
   */
  isKept(id: string): boolean {
    const d = sanitizeDeclared(this.settings, this.os);
    return id === d.mainPill || d.activeIntegrations.includes(id);
  }

  /**
   * Loads the catalog pills: the main pill always, the declared ones, and none
   * of the others. A catalog tool the user turned off does not keep a slot
   * because a session is mid-flight — that used to let undeclared Codex push
   * QQ Mail off the island. Unknown (non-catalog) agents still stay until
   * their session ends. Safe to call any number of times.
   */
  loadIntegrationTasks() {
    const d = sanitizeDeclared(this.settings, this.os);
    this.settings.mainPill = d.mainPill;
    this.settings.activeIntegrations = d.activeIntegrations;
    // Unsupported catalog pills cannot survive an imported preference or a
    // stale runtime task, even when that task previously looked busy.
    const offered = new Set(availablePills(this.os).map((p) => p.id));
    this.tasks = this.tasks.filter((t) => !pillDefinition(t.id) || offered.has(t.id));
    for (const def of availablePills(this.os)) {
      const shouldLoad = def.id === d.mainPill || d.activeIntegrations.includes(def.id);
      const idx = this.tasks.findIndex((t) => t.id === def.id);
      if (shouldLoad && idx < 0) this.tasks.push(taskFor(def, this.settings.pillColors));
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // A colour picked in Settings reaches the pills that are already up.
    for (const t of this.tasks) {
      const def = pillDefinition(t.id);
      if (def) t.color = pillColor(def.id, def.color, this.settings.pillColors);
    }
    this.tasks = orderPills(this.tasks, d.mainPill);
    if (!this.focusId || !this.tasks.some((t) => t.id === this.focusId)) this.focusId = d.mainPill;
    this.notify();
  }

  /**
   * A session is over. The main and declared pills are put back as they were;
   * any other pill goes away (AppState.removeTask on macOS).
   */
  removeTask(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    if (this.isKept(id)) {
      const t = this.tasks[idx];
      t.state = "idle";
      t.steps = [];
      t.stepIndex = 0;
      delete t.stepSeq;
      t.pillBadge = null;
      t.finalLine = null;
      // The session is over: its id must not outlive it, or a steer would go to
      // a turn that has already ended.
      t.sessionId = null;
      t.sessionCwd = undefined;
      const def = pillDefinition(id);
      if (def) t.name = def.name;
      this.clearSessionDiffs(id);
      this.notify();
      return;
    }
    this.tasks.splice(idx, 1);
    this.clearSessionDiffs(id);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? this.mainPillId;
    this.notify();
  }

  /**
   * Creates the pill of a tagged agent on its first event; no-op if it exists.
   * Catalog tools the user turned off stay off (`evenIfOff` is for a permission
   * card that still needs a face). Unknown agents are inserted after the main
   * pill and only fill a leftover slot among the visible four.
   */
  upsertExternalAgent(id: string, name: string, color: string, evenIfOff = false) {
    if (this.tasks.some((t) => t.id === id)) return;
    if (!evenIfOff && pillDefinition(id) && !this.isKept(id)) return;
    const def = pillDefinition(id);
    this.insertAfterMain({
      id, name, color: def ? pillColor(def.id, def.color, this.settings.pillColors) : color,
      state: "idle", stepIndex: 0, steps: [],
      source: "agent", isIntegration: false,
    });
  }

  /**
   * The pill a Claude Code session belongs to (VS Code or Cursor). It is made
   * for the session when it is already the main pill or declared — a catalog
   * tool the user turned off must not appear because a session started.
   */
  upsertWorkspacePill(id: string, name: string, cwd: string): AgentTask | null {
    let t = this.tasks.find((x) => x.id === id);
    if (!t) {
      const def = pillDefinition(id);
      if (!def || !this.isKept(id)) return null;
      t = taskFor(def, this.settings.pillColors, name);
      this.insertAfterMain(t);
    }
    t.name = name;
    if (cwd) t.sessionCwd = cwd;
    return t;
  }

  private insertAfterMain(t: AgentTask) {
    const at = this.tasks.findIndex((x) => x.id === this.mainPillId) + 1;
    this.tasks.splice(at, 0, t);
    if (!this.focusId) this.focusId = t.id;
    this.notify();
  }

  /** Declares or undeclares a pill (max 4 next to the main one). */
  toggleIntegration(id: string) {
    const next = toggleDeclared(sanitizeDeclared(this.settings, this.os), id, this.os);
    if (!next) return;
    this.settings.activeIntegrations = next;
    if (!next.includes(id) && this.focusId === id) this.focusId = this.mainPillId;
    this.loadIntegrationTasks();
  }

  /**
   * What the island opens on. A card waiting for an answer comes first, so
   * reopening a folded island shows it again (Mac #117, #290).
   */
  defaultView(): IslandViewName {
    if (this.pendingApproval) return this.pendingApproval.questions ? "question" : "approval";
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
