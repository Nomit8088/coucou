// The chat view (src/views/chat.ts) on a fake DOM, through the real bridge:
// the model switcher asks for a provider's models only once it is picked and
// has a key, picking saves the settings, and a streamed answer grows in place.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { calls, emit, internals, sent } from "./tauri.mjs";

installFakeDom();
const { buildPrompt } = await import("../src/views/chat.ts");
const { DEFAULT_SETTINGS, State } = await import("../src/core/state.ts");
const { ensureProviders, DEEPSEEK } = await import("../src/core/providers.ts");

/** DeepSeek plus one custom provider, as the settings window would leave them. */
const providers = () => ensureProviders([
  { ...DEEPSEEK },
  {
    id: "c-local",
    name: "Local gateway",
    baseUrl: "http://127.0.0.1:8000/v1",
    keyName: "chat-c-local",
    defaultModel: "local-model",
    builtin: false,
  },
]);

/** What the mocked Rust side answers, by command. */
let answers;
const plainInvoke = internals.invoke;
internals.invoke = async (cmd, args) => {
  const result = await plainInvoke(cmd, args);
  if (cmd in answers) return typeof answers[cmd] === "function" ? answers[cmd](args) : answers[cmd];
  return result;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let view;
beforeEach(() => {
  calls.length = 0;
  answers = {};
  State.settings = { ...DEFAULT_SETTINGS, chatModels: {}, chatProviders: providers() };
  State.chatHistory = [];
  State.stateOverride = null;
  State.view = "prompt";
  State.droppedFile = null;
  view = buildPrompt(() => {});
  view.sync();
});

const $ = (cls) => view.el.querySelector(cls);
const chips = () => view.el.find(".picker-chip").map((c) => c.textContent);
const models = () => view.el.find(".picker-model").map((m) => m.textContent);

test("the model button shows the active provider's model", () => {
  assert.equal($(".model-name").textContent, "deepseek-chat");
  State.settings = { ...State.settings, chatProvider: "c-local" };
  view.sync();
  assert.equal($(".model-name").textContent, "local-model");
});

test("a provider without a key is never asked for its models", async () => {
  answers.secret_present = false;
  $(".model-btn").fire("click");
  await flush();
  assert.ok($(".chat-body").classList.contains("picking"));
  // Only the loopback provider shows without a stored key.
  assert.deepEqual(chips(), ["Local gateway"]);
  assert.deepEqual(sent("chat_models"), []);
});

test("with a key, the provider's models are listed and picking one saves it", async () => {
  answers.secret_present = (args) => args.key === "deepseek-api-key";
  answers.chat_models = [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ];
  $(".model-btn").fire("click");
  await flush();
  assert.deepEqual(chips(), ["DeepSeek", "Local gateway"]);
  view.el.find(".picker-chip")[0].fire("click");
  await flush();
  assert.deepEqual(sent("chat_models"), [{ provider: "deepseek" }]);
  assert.deepEqual(models(), ["DeepSeek Chat", "DeepSeek Reasoner"]);
  view.el.find(".picker-model")[1].fire("click");
  assert.equal(State.settings.chatModels.deepseek, "deepseek-reasoner");
  assert.equal(sent("save_settings").at(-1).settings.chatModels.deepseek, "deepseek-reasoner");
  assert.ok(!$(".chat-body").classList.contains("picking"));
  assert.equal($(".model-name").textContent, "deepseek-reasoner");
});

test("switching provider saves it and asks the new provider only", async () => {
  answers.secret_present = (args) => args.key === "deepseek-api-key";
  answers.chat_models = (args) => (args.provider === "c-local" ? [{ id: "local-2", label: "local-2" }] : []);
  $(".model-btn").fire("click");
  await flush();
  view.el.find(".picker-chip")[1].fire("click");
  await flush();
  assert.equal(State.settings.chatProvider, "c-local");
  // The switch asks the new provider (the opening had asked the first one).
  assert.ok(sent("chat_models").some((c) => c.provider === "c-local"), JSON.stringify(sent("chat_models")));
  // The default model was not offered: the first one is kept instead, and saved.
  assert.equal(State.settings.chatModels["c-local"], "local-2");
  assert.deepEqual(models(), ["local-2"]);
});

test("a local answer streams into one reply, then the finished text replaces it", async () => {
  let finish;
  answers.chat_send = () => new Promise((resolve) => (finish = resolve));
  const input = $(".chat-input");
  input.value = "hello";
  $(".send-btn").fire("click");
  await flush();
  view.sync(); // what State.notify() does in the island
  assert.ok($(".model-btn").disabled, "no switching mid-answer");
  assert.ok($(".typing"), "dots until the first visible text");

  emit("chat-delta", ""); // still thinking
  assert.ok($(".typing"));
  emit("chat-delta", "Hel");
  emit("chat-delta", "Hello **there**");
  view.sync(); // another view update mid-stream must not wipe the live answer
  assert.equal($(".typing"), null);
  const replies = view.el.find(".reply");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].find("STRONG")[0].textContent, "there");

  finish({ text: "Hello **there**!" });
  await flush();
  view.sync();
  assert.equal(view.el.find(".reply").length, 1);
  assert.equal(view.el.find(".reply")[0].textContent, "Hello there!");
  assert.deepEqual(State.chatHistory.map((m) => m.role), ["user", "assistant"]);
  assert.ok(!$(".model-btn").disabled);
});
