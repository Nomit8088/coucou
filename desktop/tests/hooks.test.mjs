// Hook events → island state (src/island/hooks.ts), driven through the real
// bridge.
//
// This fork has no Claude Code pill: an event without a valid `coucou_agent` is
// discarded. Only Codex and DSH reach the island, and only they get cards.

import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { calls, emit, sent } from "./tauri.mjs";
import { registerHookHandlers } from "../src/island/hooks.ts";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";

const DSH = "agent_dsh";
const CODEX = "agent_codex";

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
  State.settings = { ...DEFAULT_SETTINGS };
  State.loadIntegrationTasks();
});

afterEach(() => {
  mock.timers.runAll();
  mock.timers.reset();
});

// ── Routing ───────────────────────────────────────────────────────────────────

test("an event with no agent tag is discarded", () => {
  hook({ hook_event_name: "SessionStart", cwd: "C:\\Users\\me\\proj" });
  hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
  assert.deepEqual(asked, []);
  assert.deepEqual(calls, []);
  // Only the pills the settings declare: nothing was made for the session.
  assert.equal(State.tasks.some((t) => t.id.startsWith("agent_") && t.id !== DSH), false);
});

test("an invalid or reserved agent tag is discarded too", () => {
  for (const tag of ["claude", "Gemini", "has space", "a".repeat(25), ""]) {
    hook({ hook_event_name: "SessionStart", cwd: "/p/proj", coucou_agent: tag });
  }
  assert.deepEqual(asked, []);
  assert.equal(State.tasks.some((t) => t.id.startsWith("agent_") && t.id !== DSH), false);
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
  // Codex keeps its PascalCase names.
  hook({ hook_event_name: "PreToolUse", cwd: "/p", coucou_agent: "codex", tool_name: "Bash", tool_input: { command: "ls" } });
  assert.equal(task(CODEX).steps.at(-1), "Runs · ls");
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

test("a session end clears the session id so the pill can no longer be steered", () => {
  dsh({ hook_event_name: "SessionStart", session_id: "s1" });
  assert.equal(task().sessionId, "s1");
  dsh({ hook_event_name: "SessionEnd", session_id: "s1" });
  assert.equal(task().state, "idle");
  assert.deepEqual(task().steps, []);
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

test("only DSH's questions become a question card", () => {
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

test("a second request never replaces the card: it goes back to the agent", () => {
  dsh({ hook_event_name: "PermissionRequest", request_id: "r1", session_id: "s1", tool_name: "write" });
  dsh({ hook_event_name: "PermissionRequest", request_id: "r2", session_id: "s1", tool_name: "pwsh" });
  assert.equal(State.pendingApproval.requestId, "r1");
  assert.deepEqual(sent("approval_decline"), [{ requestId: "r2" }]);
  assert.deepEqual(sent("approval_ack"), [{ requestId: "r1" }]);
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
