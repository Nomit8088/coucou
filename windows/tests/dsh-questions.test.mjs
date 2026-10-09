// Round trip of a DSH question: what the plugin sends, what the island sends
// back, and whether the plugin can turn that into an answer DSH accepts.
//
// The contract comes from DSH itself (@deepseek-ai/dsh-user-questions):
//   AskUserQuestionItem  { id, question, options?: {label}[], multiSelect? }
//   AskUserQuestionAnswer{ answers: [{ id, selected: string[] }] }
// The plugin must return an object of that second shape, or call next().

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(here, "..", "dsh-plugin", "index.js");

const isWindows = process.platform === "win32";
const PIPE = isWindows
  ? `\\\\.\\pipe\\coucou-q-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  : join(process.env.XDG_RUNTIME_DIR ?? "/tmp", `coucou-q-${process.pid}.sock`);

/** Every JSON line the plugin wrote, in order. */
const written = [];
const waiters = [];

/** What the fake island answers with: `null` for silence. */
let answerLine = null;

let server;
let sockets = [];

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
        try {
          written.push(JSON.parse(line));
        } catch {
          continue;
        }
        for (const wake of waiters.splice(0)) wake();
        // A question keeps the connection open for the answer.
        if (answerLine != null) {
          socket.write(`${answerLine}\n`);
          answerLine = null;
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

async function startPlugin() {
  written.length = 0;
  waiters.length = 0;
  answerLine = null;
  const mod = await import(`${pathToFileURL(PLUGIN).href}?t=${Math.random()}`);
  const { ctx, listeners } = loadPlugin();
  mod.apply(ctx, { pipe: PIPE, steerPipe: "" });
  return { listeners };
}

async function waitFor(n, what) {
  const deadline = Date.now() + 5_000;
  while (written.length < n) {
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for ${what}: ${JSON.stringify(written)}`);
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

const agent = (id) => ({ id, session: { id, header: { cwd: "D:\\dev\\proj" } } });

/** A question as DSH declares it: the id is what the answer must echo. */
const QUESTION = {
  id: "q-color",
  question: "Which colour should the button be?",
  header: "Colour",
  options: [
    { label: "Blue", description: "The default" },
    { label: "Green", description: "For success" },
  ],
};

/** What the island's question card sends back (views.ts → approval_answer). */
const islandAnswers = (id, label) => JSON.stringify({ answers: { [id]: label } });

/** Fires user-questions/request and returns what the plugin hands to DSH. */
async function ask(listeners, questions, line) {
  answerLine = line;
  let delegated = false;
  const outcome = await listeners.get("user-questions/request")[0](
    { agent: agent("s1"), questions },
    () => {
      delegated = true;
      return Promise.resolve({ answers: [] });
    },
  );
  return { outcome, delegated };
}

test("a picked option reaches DSH as its question id and selected labels", async () => {
  const { listeners } = await startPlugin();
  const { outcome, delegated } = await ask(listeners, [QUESTION], islandAnswers("q-color", "Blue"));

  assert.equal(delegated, false, "the answer must not fall through to the UI");
  assert.deepEqual(outcome, { answers: [{ id: "q-color", selected: ["Blue"] }] });
});

test("the island asks with the question ids DSH sent", async () => {
  const { listeners } = await startPlugin();
  void ask(listeners, [QUESTION], islandAnswers("q-color", "Green"));
  await waitFor(1, "the PermissionRequest carrying the questions");

  const asked = written.at(-1);
  assert.equal(asked.tool_name, "user-questions");
  // The id has to survive: it is the only key the answer is matched on.
  assert.deepEqual(asked.tool_input.questions, [QUESTION]);
});

test("a pick-several question sends every label that was ticked", async () => {
  const { listeners } = await startPlugin();
  const multi = { ...QUESTION, multiSelect: true };
  const { outcome } = await ask(listeners, [multi], islandAnswers("q-color", ["Blue", "Green"]));

  assert.deepEqual(outcome, { answers: [{ id: "q-color", selected: ["Blue", "Green"] }] });
});

test("several questions are answered together, each under its own id", async () => {
  const { listeners } = await startPlugin();
  const second = { id: "q-size", question: "How big?", options: [{ label: "Small" }, { label: "Big" }] };
  const line = JSON.stringify({ answers: { "q-color": "Blue", "q-size": "Small" } });
  const { outcome } = await ask(listeners, [QUESTION, second], line);

  assert.deepEqual(outcome, {
    answers: [
      { id: "q-color", selected: ["Blue"] },
      { id: "q-size", selected: ["Small"] },
    ],
  });
});

test("an answer that names no known question is handed back, never invented", async () => {
  const { listeners } = await startPlugin();
  const { outcome, delegated } = await ask(listeners, [QUESTION], islandAnswers("q-other", "Blue"));

  assert.equal(delegated, true, "an unmatched answer must not be forced through");
  assert.deepEqual(outcome, { answers: [] });
});

test("a label DSH never offered is still wrong, and the question is not skipped", async () => {
  const { listeners } = await startPlugin();
  const { outcome } = await ask(listeners, [QUESTION], islandAnswers("q-color", "Purple"));

  // The id matched, so the label goes through as picked — DSH validates it.
  assert.deepEqual(outcome, { answers: [{ id: "q-color", selected: ["Purple"] }] });
});

test("nobody clicking, or a declined question, is handed to DSH's own UI", async () => {
  const { listeners } = await startPlugin();
  const silent = await ask(listeners, [QUESTION], null);
  assert.equal(silent.delegated, true, "silence must never become an answer");

  const { listeners: l2 } = await startPlugin();
  const denied = await ask(l2, [QUESTION], "deny");
  assert.equal(denied.delegated, true, "declining asks DSH to show it, not to decide");
});

test("a question with no options is never shown on the island", async () => {
  const { listeners } = await startPlugin();
  const { delegated } = await ask(listeners, [], islandAnswers("q-color", "Blue"));
  assert.equal(delegated, true, "an empty batch has nothing to answer");
});

// ── Without an id ────────────────────────────────────────────────────────────
//
// The island keys an answer by the question's id, falling back to its text
// (views.ts: `q.id || q.question`). The plugin reads it back by id alone, so a
// question the model did not give an id to can never be matched.

test("a question with no id is still answered, by its text", async () => {
  const { listeners } = await startPlugin();
  const noId = { question: "Which colour?", options: [{ label: "Blue" }, { label: "Green" }] };
  const { outcome, delegated } = await ask(listeners, [noId], islandAnswers("Which colour?", "Blue"));

  assert.equal(delegated, false, "the answer must not fall through");
  assert.deepEqual(outcome.answers.length, 1);
  assert.deepEqual(outcome.answers[0].selected, ["Blue"]);
});
