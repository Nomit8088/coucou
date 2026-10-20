// Hook events → island state (src/island/hooks.ts), driven through the real
// bridge.
//
// An event without a valid `coucou_agent` is Claude Code's: it goes to the
// Claude Code pill (or Cursor's, when the relay says it runs there), which the
// user declares in Settings exactly like any other tool. Tagged agents (DSH,
// Codex, unknown tools) get their own `agent_<name>` pill — and only the ones
// the island can answer for get a card.

import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { calls, emit, sent } from "./tauri.mjs";
import { registerHookHandlers, stopFailureDetail } from "../src/island/hooks.ts";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";
import { Sound } from "../src/core/sound.ts";
import { setLanguage } from "../src/i18n/i18n.ts";

const DSH = "agent_dsh";
const CODEX = "agent_codex";
const CLAUDE = "integration_claude";
const CURSOR = "agent_cursor";

/** What the handler asked the island to do, in order. */
let asked;
const island = {
  alert: (view) => asked.push(`alert:${view}`),
  setView: (view) => asked.push(`setView:${view}`),
  reveal: () => asked.push("reveal"),
  dropPin: () => asked.push("dropPin"),
};
registerHookHandlers(island);

const hook = (payload) => emit("hook", payload);
const dsh = (payload) => hook({ coucou_agent: "dsh", ...payload });
const task = (id = DSH) => State.tasks.find((t) => t.id === id);
const seconds = (n) => mock.timers.tick(n * 1000);
/** Declares pills the way Settings does, then loads their idle cards. */
const declare = (...ids) => {
  State.settings.activeIntegrations = ids;
  State.loadIntegrationTasks();
};

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  asked = [];
  calls.length = 0;
  State.tasks = [];
  State.focusId = null;
  State.mode = "hidden";
  State.view = "overview";
  State.paused = false;
  State.isPinned = false;
  State.pendingApproval = null;
  State.approvalQueue = [];
  State.resetLiveSessions();
  State.settings = { ...DEFAULT_SETTINGS };
  State.loadIntegrationTasks();
});

afterEach(() => {
  mock.timers.runAll();
  mock.timers.reset();
});

// ── Routing ───────────────────────────────────────────────────────────────────

test("an event with no tag goes to Claude Code's pill once it is declared", () => {
  declare(CLAUDE);
  hook({ hook_event_name: "SessionStart", session_id: "s1", cwd: "C:\\Users\\me\\proj" });
  assert.equal(task(CLAUDE).sessionId, "s1");
  assert.equal(task(CLAUDE).sessionCwd, "C:\\Users\\me\\proj");
  assert.deepEqual(asked, ["reveal"]);
  hook({ hook_event_name: "PreToolUse", session_id: "s1", tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(task(CLAUDE).state, "working");
  assert.deepEqual(task(CLAUDE).steps, ["Runs · ls"]);
});

test("without a declared Claude Code pill its events create nothing", () => {
  for (const event of ["SessionStart", "PreToolUse", "StopFailure"]) {
    hook({ hook_event_name: event, cwd: "/p/proj" });
  }
  assert.equal(task(CLAUDE), undefined);
  assert.equal(State.tasks.some((t) => t.id === CLAUDE), false);
  // Nothing is revealed and nothing is asked of the island for a pill it does
  // not show.
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

test("Claude Code in Cursor's terminal gets the Cursor pill", () => {
  declare(CLAUDE, CURSOR);
  hook({ hook_event_name: "SessionStart", session_id: "s1", cwd: "/p/proj", term_editor: "cursor" });
  assert.equal(task(CURSOR).sessionId, "s1");
  assert.equal(task(CLAUDE).sessionId ?? null, null);
});

test("the reserved 'claude' tag is Claude Code itself, not an external agent", () => {
  declare(CLAUDE);
  hook({ hook_event_name: "PreToolUse", cwd: "/p", coucou_agent: "claude", tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(task(CLAUDE).state, "working");
  assert.equal(task("agent_claude"), undefined);
});

test("an invalid tag is never an external agent", () => {
  for (const tag of ["Gemini", "has space", "a".repeat(25)]) {
    hook({ hook_event_name: "SessionStart", cwd: "/p/proj", coucou_agent: tag });
  }
  assert.equal(State.tasks.some((t) => t.id.startsWith("agent_") && t.id !== DSH), false);
  assert.deepEqual(asked, []);
});

test("the main pill exists from the start, idle", () => {
  assert.equal(task().name, "DeepSeek Harness");
  assert.equal(task().state, "idle");
});

test("a DSH session starts, names its folder and reveals the island", () => {
  dsh({ hook_event_name: "SessionStart", session_id: "s1", cwd: "C:\\Users\\me\\proj\\" });
  assert.equal(task().sessionId, "s1");
  assert.equal(task().sessionCwd, "C:\\Users\\me\\proj\\");
  assert.deepEqual(asked, ["reveal"]);
});

test("a tagged agent other than DSH or Codex still gets a pill", () => {
  hook({ hook_event_name: "PreToolUse", cwd: "/p/proj", coucou_agent: "my-tool", tool_name: "Bash", tool_input: { command: "ls" } });
  const other = task("agent_my-tool");
  assert.equal(other.name, "my-tool");
  assert.equal(other.state, "working");
  assert.deepEqual(other.steps, ["Runs · ls"]);
});

// ── Work events ───────────────────────────────────────────────────────────────

test("a submitted prompt shows as thinking, truncated to 60 characters", () => {
  dsh({ hook_event_name: "UserPromptSubmit", cwd: "/p", prompt: "x".repeat(80) });
  assert.equal(task().state, "thinking");
  assert.deepEqual(task().steps, ["x".repeat(60)]);
  dsh({ hook_event_name: "UserPromptSubmit", cwd: "/p", message: "older field" });
  assert.equal(task().steps.at(-1), "older field");
});

test("lowercase DSH tools are labelled like their PascalCase twins", () => {
  const step = (tool_name, tool_input) => {
    dsh({ hook_event_name: "PreToolUse", cwd: "/p", tool_name, tool_input });
    return task().steps.at(-1);
  };
  assert.equal(step("pwsh", { command: "npm run build" }), "Runs · npm run build");
  assert.equal(step("bash", { command: "ls -la" }), "Runs · ls -la");
  assert.equal(step("read", { file_path: "C:\\p\\.env" }), "Reads · .env");
  assert.equal(step("edit", { file_path: "C:\\p\\a.ts" }), "Edits · a.ts");
  assert.equal(step("write", { file_path: "C:\\p\\b.ts" }), "Writes · b.ts");
  assert.equal(step("grep", { pattern: "x", path: "src/island/" }), "Searches · island");
  assert.equal(task().state, "working");
  // Codex keeps its PascalCase names, and only once it is a declared pill.
  State.settings.activeIntegrations = ["agent_codex"];
  State.loadIntegrationTasks();
  hook({ hook_event_name: "PreToolUse", cwd: "/p", coucou_agent: "codex", tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(task(CODEX).steps.at(-1), "Runs · ls");
});

test("an undeclared Codex session does not take a pill", () => {
  hook({ hook_event_name: "SessionStart", cwd: "/p", coucou_agent: "codex" });
  hook({ hook_event_name: "PreToolUse", cwd: "/p", coucou_agent: "codex", tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(task(CODEX), undefined);
  assert.equal(State.tasks.some((t) => t.id === CODEX), false);
});

test("only the last 20 steps are kept", () => {
  for (let i = 0; i < 25; i++) {
    dsh({ hook_event_name: "PreToolUse", cwd: "/p", tool_name: "pwsh", tool_input: { command: `c${i}` } });
  }
  assert.equal(task().steps.length, 20);
  assert.equal(task().steps.at(-1), "Runs · c24");
});

test("a failed tool call and subagents leave their own steps", () => {
  dsh({ hook_event_name: "PostToolUseFailure" });
  dsh({ hook_event_name: "SubagentStart" });
  dsh({ hook_event_name: "SubagentStop" });
  assert.deepEqual(task().steps, ["⚠ failed", "+ subagent", "• subagent done"]);
  assert.equal(task().state, "working");
});

test("a subagent step says what it is when the plugin names it", () => {
  // The DSH plugin sends a workflow phase or a narration line as `message`.
  dsh({ hook_event_name: "SubagentStart", message: "▸ Research" });
  dsh({ hook_event_name: "SubagentStop", message: "✔ review · 3 agents" });
  assert.deepEqual(task().steps, ["▸ Research", "✔ review · 3 agents"]);
});

test("a warning is a ticker line, never the red state", () => {
  // A failed model request the loop will retry: the session carries on.
  dsh({ hook_event_name: "Warning", message: "⚠ Request failed" });
  assert.equal(task().state, "idle");
  assert.deepEqual(task().steps, ["⚠ Request failed"]);
  assert.deepEqual(asked, []);
  // An empty one leaves no blank step.
  dsh({ hook_event_name: "Warning", message: "" });
  assert.deepEqual(task().steps, ["⚠ Request failed"]);
});

test("a streaming preview replaces itself and never grows the ticker", () => {
  dsh({ hook_event_name: "StreamingText", message: "The relay is" });
  assert.equal(task().liveLine, "The relay is");
  dsh({ hook_event_name: "StreamingText", message: "The relay is a worker" });
  // Still no step: the preview is not history.
  assert.deepEqual(task().steps, []);
  assert.equal(task().liveLine, "The relay is a worker");
  // A real step supersedes it.
  dsh({ hook_event_name: "PreToolUse", tool_name: "pwsh", tool_input: { command: "ls" } });
  assert.equal(task().liveLine, null);
  assert.deepEqual(task().steps, ["Runs · ls"]);
});

test("the streaming preview is cleared when the turn ends", () => {
  dsh({ hook_event_name: "StreamingText", message: "half an answer" });
  dsh({ hook_event_name: "Stop", last_assistant_message: "The whole answer." });
  assert.equal(task().liveLine, null);
  assert.equal(task().finalLine, "The whole answer.");
});

test("context usage is kept per pill, and only when there are tokens", () => {
  dsh({ hook_event_name: "ContextUsage", used_tokens: 42_000, context_window: 100_000 });
  assert.deepEqual(State.contextUsage.get(DSH), {
    tokens: 42_000, window: 100_000, updatedAt: State.contextUsage.get(DSH).updatedAt,
  });
  // Nothing measured yet: no entry is invented.
  dsh({ hook_event_name: "ContextUsage", used_tokens: 0, context_window: 100_000 });
  assert.equal(State.contextUsage.size, 1);
  assert.equal(State.contextUsage.get(CODEX), undefined);
});

test("background jobs are counts and a producer line, never output", () => {
  dsh({ hook_event_name: "JobsChanged", jobs_running: 2, jobs_total: 5, jobs_label: "completed · build" });
  assert.deepEqual(State.jobInfo.get(DSH), { running: 2, total: 5, label: "completed · build", progress: "" });
  // A job with no owner still reports; a missing count is zero, not NaN.
  dsh({ hook_event_name: "JobsChanged", jobs_total: 1 });
  assert.deepEqual(State.jobInfo.get(DSH), { running: 0, total: 1, label: "", progress: "" });
  // Jobs never change the session's own state.
  assert.equal(task().state, "idle");
});

test("scheduled reminders are host-wide and keep the session alone", () => {
  dsh({ hook_event_name: "ScheduleChanged", reminders_active: 3, reminders_total: 4, reminders_next: "2026-10-10T08:00:00Z" });
  assert.deepEqual(State.scheduleInfo, { active: 3, total: 4, next: "2026-10-10T08:00:00Z" });
  // They are not a session's business: no reveal, no state change.
  assert.deepEqual(asked, []);
  assert.equal(task().state, "idle");
});

test("a notification is a rate limit, a question, or nothing", () => {
  dsh({ hook_event_name: "Notification", message: "Just so you know." });
  assert.equal(task().state, "idle");
  dsh({ hook_event_name: "Notification", message: "Shall I continue?" });
  assert.equal(task().state, "question");
  dsh({ hook_event_name: "Notification", message: "Usage Rate Limit reached" });
  assert.equal(task().state, "ratelimit");
});

// ── Stop and session end ──────────────────────────────────────────────────────

test("a finished turn opens the finished view, then goes idle after 5.2 s", () => {
  dsh({ hook_event_name: "Stop", message: "done" });
  assert.equal(task().state, "finished");
  assert.deepEqual(task().steps, ["done"]);
  assert.deepEqual(asked, ["alert:finished"]);
  seconds(5.1);
  assert.equal(task().state, "finished");
  seconds(0.1);
  assert.equal(task().state, "idle");
});

test("a finished turn behind another pill only badges its own, for 5.2 s", () => {
  State.setFocus("integration_github");
  dsh({ hook_event_name: "Stop" });
  assert.deepEqual(asked, []);
  assert.equal(task().pillBadge, "finished");
  seconds(5.2);
  assert.equal(task().pillBadge, null);
});

test("a failed turn shows the error view, or the error badge behind another pill", () => {
  dsh({ hook_event_name: "StopFailure" });
  assert.equal(task().state, "error");
  assert.deepEqual(asked, ["alert:error"]);
  State.setFocus("integration_github");
  dsh({ hook_event_name: "StopFailure" });
  assert.equal(task().pillBadge, "error");
});

// ── StopFailure: the card says what actually failed ───────────────────────────

test("a StopFailure keeps the API's own message for the error card", () => {
  declare(CLAUDE);
  hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
  hook({ hook_event_name: "StopFailure", error: { message: "API Error: 529 Overloaded. Try again." } });
  assert.equal(task(CLAUDE).state, "error");
  assert.equal(task(CLAUDE).finalLine, "API Error: 529 Overloaded. Try again.");
});

test("an error kind becomes a sentence in the interface language", () => {
  assert.equal(stopFailureDetail({ error_type: "rate_limit" }),
    "Claude's rate limit is reached. Try again in a moment.");
  assert.equal(stopFailureDetail({ error: "overloaded" }),
    "Claude is overloaded. Try again in a moment.");
  assert.equal(stopFailureDetail({ error_type: "authentication_failed" }),
    "Claude Code is not signed in, or its key is no longer valid.");
  assert.equal(stopFailureDetail({ error_type: "max_output_tokens" }),
    "The answer was too long and was cut.");
  // "unknown" and bare status codes say nothing: the card falls back to the last step.
  assert.equal(stopFailureDetail({ error: "unknown" }), null);
  assert.equal(stopFailureDetail({ error_type: "unknown" }), null);
  assert.equal(stopFailureDetail({ error: "500" }), null);
  assert.equal(stopFailureDetail({}), null);
});

test("Claude Code's 'unknown' error uses the last message when it carries the API's words", () => {
  assert.equal(
    stopFailureDetail({ error: "unknown", last_assistant_message: "API Error: 500 Internal Server Error" }),
    "API Error: 500 Internal Server Error",
  );
  // A last message without an error in it is the answer, not the failure.
  assert.equal(stopFailureDetail({ error: "unknown", last_assistant_message: "All done." }), null);
  // A readable error kind is shown as it is.
  assert.equal(stopFailureDetail({ error: "database is locked" }), "database is locked");
});

test("the error message is read from the first field that carries one", () => {
  assert.equal(stopFailureDetail({ error_message: "first", error_details: "second", message: "third" }), "first");
  assert.equal(stopFailureDetail({ error_details: "second", message: "third" }), "second");
  assert.equal(stopFailureDetail({ message: "third" }), "third");
});

test("a session end clears the session id so the pill can no longer be steered", () => {
  dsh({ hook_event_name: "SessionStart", session_id: "s1" });
  assert.equal(task().sessionId, "s1");
  dsh({ hook_event_name: "SessionEnd", session_id: "s1" });
  assert.equal(task().state, "idle");
  assert.deepEqual(task().steps, []);
});

test("ending one of two sessions does not clear the sibling session", () => {
  dsh({ hook_event_name: "SessionStart", session_id: "s1" });
  dsh({ hook_event_name: "SessionStart", session_id: "s2" });
  dsh({ hook_event_name: "PreToolUse", session_id: "s2", tool_name: "Bash", tool_input: { command: "build" } });
  dsh({ hook_event_name: "SessionEnd", session_id: "s1" });
  assert.equal(task().sessionId, "s2");
  assert.equal(task().state, "working");
  assert.deepEqual(task().steps, ["Runs · build"]);
});

test("a new turn within 5.2 s of a stop is not put back to idle", () => {
  dsh({ hook_event_name: "Stop" });
  seconds(1);
  dsh({ hook_event_name: "UserPromptSubmit", prompt: "next" });
  seconds(5);
  assert.equal(task().state, "thinking");
});

// ── Cards: only Codex and DSH ─────────────────────────────────────────────────

test("DSH's permission request gets a card with what it authorises", () => {
  dsh({
    hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1",
    cwd: "C:\\Users\\me\\proj", tool_name: "write",
    tool_input: { file_path: "C:\\Users\\me\\proj\\.env", content: "SECRET=1" },
  });
  assert.deepEqual(State.pendingApproval, {
    requestId: "r1",
    sessionId: "s1",
    pillId: DSH,
    tool: "write",
    command: "write · C:\\Users\\me\\proj\\.env",
  });
  assert.deepEqual(sent("approval_ack"), [{ requestId: "r1" }]);
  assert.deepEqual(sent("approval_decline"), []);
  assert.equal(task().state, "approval");
});

test("Codex's permission request gets the same card", () => {
  hook({
    hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1",
    coucou_agent: "codex", tool_name: "Bash", tool_input: { command: "npm publish" },
  });
  assert.equal(State.pendingApproval.pillId, CODEX);
  assert.deepEqual(sent("approval_ack"), [{ requestId: "r1" }]);
});

test("Claude Code's permission request gets a card and is never declined", () => {
  declare(CLAUDE);
  hook({
    hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1",
    cwd: "C:\\Users\\me\\proj", tool_name: "Bash", tool_input: { command: "npm publish" },
  });
  assert.deepEqual(State.pendingApproval, {
    requestId: "r1",
    sessionId: "s1",
    pillId: CLAUDE,
    tool: "Bash",
    command: "Bash · npm publish",
  });
  assert.deepEqual(sent("approval_ack"), [{ requestId: "r1" }]);
  assert.deepEqual(sent("approval_decline"), []);
  assert.equal(task(CLAUDE).state, "approval");
});

test("Claude Code's permission request is declined when its pill is off", () => {
  hook({ hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1", tool_name: "Bash" });
  assert.deepEqual(sent("approval_decline"), [{ requestId: "r1" }]);
  assert.deepEqual(sent("approval_ack"), []);
  assert.equal(State.pendingApproval, null);
});

test("Claude Code's AskUserQuestion becomes a question card", () => {
  declare(CLAUDE);
  hook({
    hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] }] },
  });
  assert.equal(State.pendingApproval.questions?.length, 1);
  assert.equal(State.defaultView(), "question");
});

test("every other agent's request is declined, never shown as a card", () => {
  for (const agent of ["my-tool", "gemini", "cursor"]) {
    calls.length = 0;
    State.pendingApproval = null;
    hook({ hook_event_name: "PermissionRequest", request_id: "r1", coucou_agent: agent, tool_name: "Bash" });
    assert.deepEqual(sent("approval_decline"), [{ requestId: "r1" }], agent);
    assert.deepEqual(sent("approval_ack"), [], agent);
    assert.equal(State.pendingApproval, null, agent);
  }
});

test("DSH's questions become a question card; Codex's do not", () => {
  dsh({
    hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1",
    tool_name: "user-questions",
    tool_input: { questions: [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] }] },
  });
  assert.equal(State.pendingApproval.questions?.length, 1);
  assert.equal(State.pendingApproval.questions[0].id, "q1");
  assert.equal(State.defaultView(), "question");

  // The same shape on Codex is not a question: it stays a plain approval.
  State.pendingApproval = null;
  hook({
    hook_event_name: "PermissionRequest", request_id: "r2", session_id: "s1",
    coucou_agent: "codex", tool_name: "user-questions",
    tool_input: { questions: [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] }] },
  });
  assert.equal(State.pendingApproval.questions, undefined);
});

test("permission requests queue in arrival order instead of replacing the card", () => {
  dsh({ hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1", tool_name: "write" });
  dsh({ hook_event_name: "PermissionRequest", request_id: "r2", session_id: "s1", tool_name: "pwsh" });
  assert.equal(State.pendingApproval.requestId, "r1");
  assert.deepEqual(State.approvalQueue.map((x) => x.requestId), ["r2"]);
  assert.deepEqual(sent("approval_decline"), []);
  assert.deepEqual(sent("approval_ack"), [{ requestId: "r1" }, { requestId: "r2" }]);
  State.endApproval();
  assert.equal(State.pendingApproval.requestId, "r2");
});

test("answering a card early never shortens the next queued card's window", () => {
  dsh({ hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1", tool_name: "write" });
  seconds(100);
  dsh({ hook_event_name: "PermissionRequest", request_id: "r2", session_id: "s1", tool_name: "pwsh" });
  assert.deepEqual(State.approvalQueue.map((x) => x.requestId), ["r2"]);
  State.endApproval(); // the human answers r1
  assert.equal(State.pendingApproval.requestId, "r2");
  // Past the deadline r1's own timer carried: r2 keeps its full 110 s.
  seconds(15);
  assert.equal(State.pendingApproval.requestId, "r2");
  assert.deepEqual(sent("approval_decline"), []);
});

test("a session ending declines the requests still queued behind another card", () => {
  dsh({ hook_event_name: "PermissionRequest", request_id: "r0", session_id: "s2", tool_name: "write" });
  dsh({ hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1", tool_name: "pwsh" });
  dsh({ hook_event_name: "PermissionRequest", request_id: "r2", session_id: "s1", tool_name: "Bash" });
  assert.equal(State.pendingApproval.requestId, "r0");
  assert.deepEqual(State.approvalQueue.map((x) => x.requestId), ["r1", "r2"]);
  dsh({ hook_event_name: "SessionEnd", session_id: "s1" });
  assert.deepEqual(State.approvalQueue, []);
  assert.deepEqual(sent("approval_decline").map((x) => x.requestId).sort(), ["r1", "r2"]);
  assert.equal(State.pendingApproval.requestId, "r0", "the other session's card stays");
});

test("a SessionEnd for a session we never registered still idles the pill", () => {
  dsh({ hook_event_name: "PreToolUse", session_id: "s1", tool_name: "Bash", tool_input: { command: "build" } });
  assert.equal(task().state, "working");
  State.resetLiveSessions(); // app restarted mid-session: the SessionStart was missed
  dsh({ hook_event_name: "SessionEnd", session_id: "s1" });
  assert.equal(task().state, "idle");
  assert.deepEqual(task().steps, []);
});

test("a state with no rank never outranks a live error on the same pill", () => {
  dsh({ hook_event_name: "SessionStart", session_id: "s1" });
  State.sessionState(DSH, "s1", "sleeping");
  State.sessionState(DSH, "s2", "error");
  assert.equal(task().state, "error");
});

test("an unanswered card is withdrawn after 110 s", () => {
  dsh({ hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1", tool_name: "write" });
  State.view = "approval";
  asked = [];
  seconds(110);
  assert.equal(State.pendingApproval, null);
  assert.equal(State.isPinned, false);
});

test("the end of the turn takes a waiting card down and releases the relay", () => {
  for (const end of ["Stop", "StopFailure", "UserPromptSubmit", "SessionEnd", "Interrupt"]) {
    State.pendingApproval = null;
    calls.length = 0;
    dsh({ hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1", tool_name: "write" });
    dsh({ hook_event_name: end, session_id: "other" });
    assert.equal(State.pendingApproval?.requestId, "r1", end);
    dsh({ hook_event_name: end, session_id: "s1" });
    assert.equal(State.pendingApproval, null, end);
    assert.deepEqual(sent("approval_decline"), [{ requestId: "r1" }], end);
    mock.timers.runAll();
  }
});

test("a paused island hands a permission request straight back", () => {
  State.paused = true;
  dsh({ hook_event_name: "PermissionRequest", request_id: "r1", tool_name: "write" });
  assert.deepEqual(sent("approval_decline"), [{ requestId: "r1" }]);
  assert.deepEqual(sent("approval_ack"), []);
  assert.equal(State.pendingApproval, null);
});

test("a paused island ignores every other event", () => {
  State.paused = true;
  dsh({ hook_event_name: "SessionStart", cwd: "C:\\Users\\me\\proj" });
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
});

for (const tool_name of ["ask_question", "default_api:ask_question"]) {
  test(`Antigravity ${tool_name} alerts and plays a sound until the question is answered`, (context) => {
    setLanguage("en");
    const sound = context.mock.method(Sound, "play", () => {});
    hook({
      hook_event_name: "PreToolUse",
      coucou_agent: "antigravity",
      tool_name,
      tool_input: { questions: [{ question: "Which deployment strategy should we use?" }] },
    });
    const active = task("agent_antigravity");
    assert.equal(active.state, "question");
    assert.equal(active.steps.at(-1), "Needs input · Which deployment strategy should we use?");
    assert.deepEqual(asked, ["alert:overview"]);
    assert.deepEqual(sound.mock.calls.map((call) => call.arguments), [["question"]]);
    assert.equal(State.pendingApproval, null, "the answer stays in Antigravity");

    hook({ hook_event_name: "PostToolUse", coucou_agent: "antigravity", tool_name });
    assert.equal(active.state, "working");
    assert.equal(sound.mock.callCount(), 1);
  });
}

test("Claude Code ExitPlanMode creates an approval card marked as isPlan with planTitle", () => {
  declare(CLAUDE);
  hook({
    hook_event_name: "PermissionRequest",
    request_id: "plan-1",
    session_id: "s1",
    tool_name: "ExitPlanMode",
    tool_input: { plan: "# Refactor Authentication\n\n1. Move tokens\n2. Add tests" },
  });
  assert.equal(State.pendingApproval?.isPlan, true);
  assert.equal(State.pendingApproval?.command, "Refactor Authentication");
  assert.equal(task(CLAUDE).state, "approval");
  assert.ok(asked.includes("alert:approval"));
});

test("session_title takes precedence over cwd for pill naming", () => {
  declare(CLAUDE);
  hook({
    hook_event_name: "SessionStart",
    session_id: "s-title",
    cwd: "D:\\dev\\proj\\submodule",
    session_root: "D:\\dev\\proj",
    session_title: "My Custom Feature",
  });
  assert.equal(task(CLAUDE).name, "My Custom Feature");
});

test("session_root takes precedence over cwd for pill naming when session_title is absent", () => {
  declare(CLAUDE);
  hook({
    hook_event_name: "SessionStart",
    session_id: "s-root",
    cwd: "D:\\dev\\proj\\submodule",
    session_root: "D:\\dev\\proj",
  });
  assert.equal(task(CLAUDE).name, "proj");
});

test("a shared pill shows the session that is working, not the oldest one", () => {
  declare(CLAUDE);
  hook({
    hook_event_name: "UserPromptSubmit",
    session_id: "s1",
    session_title: "Locker",
    prompt: "run task 1",
  });
  hook({
    hook_event_name: "UserPromptSubmit",
    session_id: "s2",
    session_title: "GA",
    prompt: "run task 2",
  });
  // Both working: oldest keeps the name
  assert.equal(task(CLAUDE).name, "Locker");
  assert.equal(task(CLAUDE).sessionId, "s1");

  // s1 finishes its turn, s2 is still working: name shifts to s2
  hook({ hook_event_name: "Stop", session_id: "s1" });
  seconds(6); // s1 goes idle
  assert.equal(task(CLAUDE).name, "GA");
  assert.equal(task(CLAUDE).sessionId, "s2");

  // s2 finishes too: last worked session (s2) keeps the name
  hook({ hook_event_name: "Stop", session_id: "s2" });
  seconds(6);
  assert.equal(task(CLAUDE).name, "GA");
  assert.equal(task(CLAUDE).sessionId, "s2");
});
