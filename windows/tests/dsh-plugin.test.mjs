// The DSH Cordis plugin (dsh-plugin/index.js), driven for real.
//
// This is the only place the two halves of the DSH integration meet: the plugin
// is loaded as the module DSH would load, given a stand-in `ctx`, and it talks
// over a real Windows named pipe that the test listens on. What it writes on
// that pipe is exactly what the Rust relay would read, so the contract the
// island depends on — event names, `coucou_agent`, refusal to decide on its own
// — is asserted against the shipping plugin rather than a copy of it.
//
// No DSH process is needed: the `ctx` stand-in records listeners and lets the
// test fire them, which is how the plugin's behaviour is reached.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(here, "..", "dsh-plugin", "index.js");

/** Windows named pipes need the `\\.\pipe\` prefix; this one is per test run. */
const isWindows = process.platform === "win32";
const PIPE = isWindows
  ? `\\\\.\\pipe\\coucou-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  : join(process.env.XDG_RUNTIME_DIR ?? "/tmp", `coucou-test-${process.pid}.sock`);

/** Every JSON line the plugin wrote, in order. */
const written = [];
/** Resolvers waiting for the next line, so a test never busy-waits. */
const waiters = [];

function onLine(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  written.push(payload);
  const woken = waiters.splice(0);
  for (const wake of woken) wake();
}

let server;
let sockets = [];
/**
 * What the fake island answers a permission request with. `null` means silence,
 * which is the "nobody clicked" case the plugin must treat as no decision.
 */
let decide = "deny";

before(async () => {
  server = net.createServer((socket) => {
    sockets.push(socket);
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        onLine(line);
        // A permission request keeps the connection open for the answer.
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.hook_event_name === "PermissionRequest" && decide != null) {
          socket.write(`${decide}\n`);
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PIPE, resolve);
  });
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

/**
 * The plugin's `apply` is called with a stand-in Cordis context: `on` records
 * the listener under its event name, `effect` runs nothing, and `inject` is
 * deliberately absent so the optional token-meter path stays unloaded (the
 * plugin must work without it, which is the case this exercises).
 */
function loadPlugin() {
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
      return () => {};
    },
    effect() {
      return () => {};
    },
  };
  return { ctx, listeners };
}

/** Loads the plugin, runs `apply`, and clears whatever it wrote at load time. */
async function startPlugin(config = {}) {
  written.length = 0;
  waiters.length = 0;
  const mod = await import(`${pathToFileURL(PLUGIN).href}?t=${Math.random()}`);
  const { ctx, listeners } = loadPlugin();
  mod.apply(ctx, { pipe: PIPE, steerPipe: "", ...config });
  return { listeners, written };
}

/** Waits until at least `n` lines have arrived, or fails the test. */
async function waitFor(n, what) {
  const deadline = Date.now() + 5_000;
  while (written.length < n) {
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for ${what}: got ${written.length} line(s): ${JSON.stringify(written)}`);
    }
    await new Promise((resolve) => {
      waiters.push(resolve);
      setTimeout(resolve, 50);
    });
  }
}

const fire = (listeners, name, ...args) => {
  for (const fn of listeners.get(name) ?? []) fn(...args);
};

/** A session id and agent object shaped like DSH's, as the plugin reads them. */
const session = (id) => ({ id, header: { cwd: "D:\\dev\\proj" } });
const agent = (id) => ({ id, session: session(id) });

test("a session start reports the agent, its folder and a valid tag", async () => {
  const { listeners } = await startPlugin();
  const a = agent("sess-1");
  fire(listeners, "agent/created", { agent: a });
  await waitFor(1, "SessionStart");

  const ev = written[0];
  assert.equal(ev.hook_event_name, "SessionStart");
  assert.equal(ev.session_id, "sess-1");
  assert.equal(ev.coucou_agent, "dsh");
  assert.equal(ev.cwd, "D:\\dev\\proj");
  // The island only routes a tag matching ^[a-z0-9-]{1,24}$.
  assert.match(ev.coucou_agent, /^[a-z0-9-]{1,24}$/);
});

test("a user prompt becomes UserPromptSubmit carrying the text", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "agent/pre-step", {
    agent: agent("s1"),
    // A real prompt, as DSH stores one: a user-role message whose source says a
    // human sent it. `source.kind` is what tells it apart from injected context.
    messages: [{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "Fix the relay" }] }],
  }, () => Promise.resolve());
  await waitFor(2, "UserPromptSubmit");

  const ev = written.at(-1);
  assert.equal(ev.hook_event_name, "UserPromptSubmit");
  assert.equal(ev.prompt, "Fix the relay");
});

// The island reads UserPromptSubmit as "the turn that asked is over" and drops a
// waiting permission or question card. DSH puts its own injected context in the
// same user-role batch, so reporting those as prompts cancelled cards that were
// still on screen — the request then fell back to DSH's own UI and the session
// looked stuck.
test("DSH's own injected context is not reported as a user prompt", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "agent/pre-step", {
    agent: agent("s1"),
    messages: [
      {
        role: "user",
        source: { kind: "tool-jobs", form: "notice", summary: "job finished" },
        content: [{ type: "text", text: "background job pwsh-5 (pwsh) finished" }],
      },
      {
        role: "user",
        source: { kind: "user-approval" },
        content: [{ type: "text", text: "The approval policy changed" }],
      },
    ],
  }, () => Promise.resolve());

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    written.some((e) => e.hook_event_name === "UserPromptSubmit"),
    false,
    `injected context became a prompt: ${JSON.stringify(written)}`,
  );
});

test("a step carrying both a real prompt and a notice reports only the prompt", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "agent/pre-step", {
    agent: agent("s1"),
    messages: [
      { role: "user", source: { kind: "tool-jobs", form: "notice" }, content: [{ type: "text", text: "job done" }] },
      { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "Now do the other thing" }] },
    ],
  }, () => Promise.resolve());
  await waitFor(2, "UserPromptSubmit");

  const prompts = written.filter((e) => e.hook_event_name === "UserPromptSubmit");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].prompt, "Now do the other thing");
});

test("a tool call is display-only: the plugin never decides anything", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  let verdict;
  fire(listeners, "tools/pre-execute", {
    callId: "c1",
    name: "pwsh",
    arguments: { command: "npm test" },
    agent: agent("s1"),
  }, () => {
    verdict = "next";
    return Promise.resolve();
  });
  await waitFor(2, "PreToolUse");

  const ev = written.at(-1);
  assert.equal(ev.hook_event_name, "PreToolUse");
  assert.equal(ev.tool_name, "pwsh");
  assert.deepEqual(ev.tool_input, { command: "npm test" });
  // The display path always defers; it must never allow or deny.
  assert.equal(verdict, "next");
  assert.equal(JSON.stringify(written).includes("deny"), false);
});

test("a failed tool is reported as a failure, not a success", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "tools/post-execute", { callId: "c1", name: "pwsh", agent: agent("s1") },
    { isError: true }, () => Promise.resolve());
  await waitFor(2, "PostToolUseFailure");

  assert.equal(written.at(-1).hook_event_name, "PostToolUseFailure");
  assert.equal(written.at(-1).tool_name, "pwsh");
});

test("an agent error is a StopFailure, so the island can go red", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "agent/error", {
    agent: agent("s1"),
    error: new Error("sandbox refused the command"),
  });
  await waitFor(2, "StopFailure");

  const ev = written.at(-1);
  assert.equal(ev.hook_event_name, "StopFailure");
  assert.equal(ev.session_id, "s1");
  assert.match(ev.message, /sandbox refused/);
});

test("a failed model request is a warning line, not the red state", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  let delegated = false;
  fire(listeners, "agent/request-error", {
    agent: agent("s1"),
    failure: { message: "connection reset" },
  }, () => {
    delegated = true;
    return Promise.resolve();
  });
  await waitFor(2, "Warning");

  const ev = written.at(-1);
  assert.equal(ev.hook_event_name, "Warning");
  assert.match(ev.message, /connection reset/);
  // The loop may still retry, so the plugin must hand the decision back.
  assert.equal(delegated, true);
});

test("a turn that stops carries the last assistant text", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "session/event", session("s1"), {
    type: "assistant/message",
    data: { message: { content: [{ type: "text", text: "All done." }] } },
  });
  fire(listeners, "agent/turn-stopping", { agent: agent("s1") });
  await waitFor(2, "Stop");

  const ev = written.at(-1);
  assert.equal(ev.hook_event_name, "Stop");
  assert.equal(ev.last_assistant_message, "All done.");
});

test("a workflow run reports its phases and its outcome", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "workflow/start", { id: "w1", meta: { name: "audit" } });
  fire(listeners, "workflow/phase", { id: "w1", meta: { name: "audit" } }, "Scanning");
  fire(listeners, "workflow/end", { id: "w1", meta: { name: "audit" } },
    { stopReason: "completed", agentsStarted: 4 });
  await waitFor(4, "workflow steps");

  const names = written.map((e) => e.hook_event_name);
  assert.deepEqual(names.slice(-3), ["SubagentStart", "SubagentStart", "SubagentStop"]);
  assert.match(written.at(-3).message, /audit/);
  assert.equal(written.at(-2).message, "▸ Scanning");
  assert.match(written.at(-1).message, /4 agents/);
});

test("the streaming preview is throttled instead of flooding the pipe", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "agent/assistant-stream", {
    agent: agent("s1"),
    frame: { type: "start" },
  });
  for (let i = 0; i < 50; i++) {
    fire(listeners, "agent/assistant-stream", {
      agent: agent("s1"),
      frame: { type: "chunk", chunk: { type: "text-delta", text: `word${i} ` } },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));

  const streams = written.filter((e) => e.hook_event_name === "StreamingText");
  // 50 chunks arrive within a millisecond of each other: the first is sent,
  // the rest are inside the throttle window and must be dropped.
  assert.ok(streams.length >= 1, "the first preview line is sent");
  assert.ok(streams.length <= 3, `expected a handful of lines, got ${streams.length}`);
  assert.match(streams[0].message, /word0/);
  // A preview is never a step: the island must not see it as history.
  assert.equal(streams[0].coucou_agent, "dsh");
});

test("an approval waits, and only a click decides", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "tools/pre-execute", {
    callId: "call-9",
    name: "pwsh",
    arguments: { command: "rm -rf build" },
    agent: agent("s1"),
  }, () => Promise.resolve());
  await waitFor(2, "PreToolUse");

  // The fake island answers "deny" (see the server above). The Web GUI is
  // asked at the same time but never answers here, so the click must win.
  decide = "deny";
  const outcome = await listeners.get("approval/request")[0]({
    agent: agent("s1"),
    toolName: "pwsh",
    callId: "call-9",
  }, () => new Promise(() => {}));

  assert.equal(outcome, "rejected", "a click on Deny must become a rejection");
  const asked = written.find((e) => e.hook_event_name === "PermissionRequest");
  assert.ok(asked, "the island was asked");
  assert.equal(asked.tool_name, "pwsh");
  assert.equal(asked.coucou_agent, "dsh");
  // The cached PreToolUse arguments are filled in: approving "pwsh" alone
  // would tell a human nothing.
  assert.deepEqual(asked.tool_input, { command: "rm -rf build" });
});

test("nobody clicking never turns into an allow", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  // Silence on both sides: the fake island writes no answer, and the Web GUI
  // never resolves either. The plugin's own budget is minutes long, so the
  // property under test is that the promise is still pending — it has produced
  // neither an allow nor a deny.
  decide = null;
  let nextCalled = false;
  let settled = null;
  void listeners.get("approval/request")[0]({
    agent: agent("s1"),
    toolName: "write",
  }, () => {
    nextCalled = true;
    return new Promise(() => {});
  }).then((outcome) => {
    settled = outcome;
  });

  await new Promise((resolve) => setTimeout(resolve, 500));
  decide = "deny";
  assert.equal(nextCalled, true, "the Web GUI must be asked while the island is waiting");
  assert.equal(settled, null, `a silent island decided ${settled}`);
  // The request was put to the island; nothing was decided for it.
  assert.equal(written.filter((e) => e.hook_event_name === "PermissionRequest").length, 1);
});

test("a Web GUI answer wins if the island has not clicked", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  decide = null;
  const outcome = await listeners.get("approval/request")[0]({
    agent: agent("s1"),
    toolName: "write",
  }, () => Promise.resolve("allowed-once"));

  assert.equal(outcome, "allowed-once", "the Web GUI's Allow must go through");
  await waitFor(2, "PermissionRequest");
  assert.equal(written.filter((e) => e.hook_event_name === "PermissionRequest").length, 1);
  await waitFor(3, "PermissionDismiss");
  assert.equal(written.some((e) => e.hook_event_name === "PermissionDismiss"), true);
});

test("a question is asked in the Web GUI at the same time as the island", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  decide = null;
  const questions = [{ id: "q1", question: "Which one?", options: [{ label: "A" }, { label: "B" }] }];
  const outcome = await listeners.get("user-questions/request")[0]({
    agent: agent("s1"),
    questions,
  }, () => Promise.resolve({ answers: [{ id: "q1", selected: ["B"] }] }));

  assert.deepEqual(outcome, { answers: [{ id: "q1", selected: ["B"] }] });
  await waitFor(2, "PermissionRequest");
  const asked = written.find((e) => e.hook_event_name === "PermissionRequest");
  assert.ok(asked, "the island was asked");
  assert.equal(asked.tool_name, "user-questions");
});

test("a turn that did no work does not report a finished turn", async () => {
  // Plan mode and friends open a turn and reject the step: the driver goes
  // idle with nothing done, and a "finished" card for that would be noise.
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "agent/pre-step", { agent: agent("s1"), messages: [] }, () => Promise.resolve());
  fire(listeners, "agent/status", { agent: agent("s1"), status: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 200));

  const stops = written.filter((e) => e.hook_event_name === "Stop");
  assert.deepEqual(stops, [], "an empty turn must not look finished");
});

test("a driver that goes idle mid-turn does report it", async () => {
  // A cancellation or a crash in a tool's own await: no turn-stopping edge
  // ever arrives, and the pill would stay "working" for ever without this.
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "agent/pre-step", { agent: agent("s1"), messages: [] }, () => Promise.resolve());
  fire(listeners, "tools/pre-execute", {
    callId: "c1", name: "pwsh", arguments: {}, agent: agent("s1"),
  }, () => Promise.resolve());
  fire(listeners, "agent/status", { agent: agent("s1"), status: "idle" });
  await waitFor(3, "the idle Stop");

  assert.equal(written.at(-1).hook_event_name, "Stop");
});

test("no meter in the profile means no usage event, and no crash", async () => {
  // `inject` is absent from the ctx stand-in, exactly like a profile that does
  // not load @deepseek-ai/dsh-token-meter. The plugin must still work.
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "session/event", session("s1"), {
    type: "assistant/message",
    data: { message: { content: [{ type: "text", text: "hello" }] } },
  });
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(written.some((e) => e.hook_event_name === "ContextUsage"), false);
  assert.equal(written.some((e) => e.hook_event_name === "SessionStart"), true);
});

/** `loadPlugin` plus an `inject` that actually runs the bodies it is given. */
function loadPluginWith(services) {
  const listeners = new Map();
  const ctx = {
    on(name, fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
      return () => {};
    },
    effect() {
      return () => {};
    },
    inject(names, body) {
      // Only the requested services that exist are handed over, exactly like a
      // profile where the others were never loaded.
      const given = names.every((n) => n in services);
      if (given) body(services);
    },
  };
  return { ctx, listeners };
}

async function startPluginWith(services) {
  written.length = 0;
  waiters.length = 0;
  const mod = await import(`${pathToFileURL(PLUGIN).href}?t=${Math.random()}`);
  const { ctx, listeners } = loadPluginWith(services);
  mod.apply(ctx, { pipe: PIPE, steerPipe: "" });
  return { listeners };
}

test("the token meter, when loaded, reports context usage", async () => {
  const { listeners } = await startPluginWith({
    tokenMeter: { measure: () => ({ totalTokens: 7_500 }) },
    sessionProjections: {
      stateOf: () => ({ pressureTokens: 51_200, contextWindow: 128_000 }),
    },
  });
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "session/event", session("s1"), {
    type: "assistant/message",
    data: { message: { content: [{ type: "text", text: "hi" }] } },
  });
  await waitFor(2, "ContextUsage");

  const ev = written.find((e) => e.hook_event_name === "ContextUsage");
  assert.ok(ev, "usage was reported");
  assert.equal(ev.used_tokens, 51_200);
  assert.equal(ev.context_window, 128_000);
  assert.equal(ev.coucou_agent, "dsh");
});

test("jobs are reported as counts and a producer line, never output", async () => {
  const jobs = {
    list: () => [
      { id: "bash-1", kind: "bash", label: "npm test", status: "running", progress: "3/10" },
      { id: "bash-2", kind: "bash", label: "build", status: "completed" },
    ],
    events: { subscribe: () => () => {} },
  };
  const { listeners } = await startPluginWith({ jobs });
  fire(listeners, "agent/created", { agent: agent("s1") });
  await waitFor(2, "JobsChanged");

  const ev = written.find((e) => e.hook_event_name === "JobsChanged");
  assert.ok(ev, "jobs were reported");
  assert.equal(ev.jobs_running, 1);
  assert.equal(ev.jobs_total, 2);
  assert.match(ev.jobs_label, /bash-2|completed/);
  assert.equal(ev.jobs_progress, "3/10");
  // The job's own output is never part of the payload.
  assert.equal(JSON.stringify(ev).includes("output"), false);
});

test("a schedule change reports the active reminders", async () => {
  const schedule = {
    catalog: async () => [
      { id: "t1", title: "standup", status: "active", scheduledAt: "2026-10-10T08:00:00Z" },
      { id: "t2", title: "old", status: "inactive", scheduledAt: "2026-10-01T08:00:00Z" },
    ],
  };
  const { listeners } = await startPluginWith({ schedule });
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "schedule/changed");
  await waitFor(2, "ScheduleChanged");

  const ev = written.find((e) => e.hook_event_name === "ScheduleChanged");
  assert.ok(ev, "the reminder set was reported");
  assert.equal(ev.reminders_active, 1);
  assert.equal(ev.reminders_total, 2);
  assert.equal(ev.reminders_next, "2026-10-10T08:00:00Z");
});

test("a profile with neither jobs nor schedule still works", async () => {
  // Neither service exists: the inject bodies must simply never run.
  const { listeners } = await startPluginWith({});
  fire(listeners, "agent/created", { agent: agent("s1") });
  await waitFor(1, "SessionStart");
  assert.equal(written.some((e) => e.hook_event_name === "JobsChanged"), false);
  assert.equal(written.some((e) => e.hook_event_name === "ScheduleChanged"), false);
  assert.equal(written[0].hook_event_name, "SessionStart");
});

test("tools/result reports failed tool details as a warning", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "tools/result", { name: "bash", agent: agent("s1") }, {
    isError: true,
    error: { message: "command not found: foobar" },
  });
  await waitFor(2, "Warning for tools/result");

  const ev = written.find((e) => e.hook_event_name === "Warning" && e.message?.includes("foobar"));
  assert.ok(ev, "warning was reported");
  assert.equal(ev.message, "⚠ bash: command not found: foobar");
});

test("fs/observed reports missing files as warnings", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "fs/observed", { path: "C:\\dev\\missing.txt" }, { kind: "absent" });
  await waitFor(2, "Warning for fs/observed");

  const ev = written.find((e) => e.hook_event_name === "Warning" && e.message?.includes("missing.txt"));
  assert.ok(ev, "warning was reported");
  assert.equal(ev.message, "⚠ missing · missing.txt");
});

test("workspace/session-stop stops the running session", async () => {
  const { listeners } = await startPlugin();
  fire(listeners, "agent/created", { agent: agent("s1") });
  fire(listeners, "workspace/session-stop", { sessionId: "s1" });
  await waitFor(2, "Stop for workspace/session-stop");

  const ev = written.find((e) => e.hook_event_name === "Stop");
  assert.ok(ev, "stop was emitted");
  assert.equal(ev.session_id, "s1");
});

test("permissionPresets reports current preset on session start", async () => {
  let presetSet = "";
  const permService = {
    current: () => "workspace-write",
    names: ["workspace-write", "danger-full-access"],
    set: (sess, name) => { presetSet = name; },
  };
  const { listeners } = await startPluginWith({ permissionPresets: permService });
  fire(listeners, "agent/created", { agent: agent("s1") });
  await waitFor(2, "PresetChanged");

  const ev = written.find((e) => e.hook_event_name === "PresetChanged");
  assert.ok(ev, "preset changed was reported");
  assert.equal(ev.preset, "workspace-write");
  assert.deepEqual(ev.presets, ["workspace-write", "danger-full-access"]);
});
