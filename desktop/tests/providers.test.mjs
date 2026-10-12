import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEEPSEEK, activeModel, ensureProviders, isLoopbackHost, pickModel, providerDef, urlAllowed, visibleProviders, withModel,
} from "../src/core/providers.ts";
import { DEFAULT_SETTINGS } from "../src/core/state.ts";

const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, chatProviders: ensureProviders([]), ...over });

test("DeepSeek is always present and cannot lose its credential name", () => {
  const list = ensureProviders([{ id: "deepseek", name: "", baseUrl: "", keyName: "other", defaultModel: "", builtin: false }]);
  assert.equal(list[0].keyName, "deepseek-api-key");
  assert.equal(list[0].name, "DeepSeek");
  assert.equal(list[0].baseUrl, DEEPSEEK.baseUrl);
  assert.equal(providerDef("missing", settings()).id, "deepseek");
});

test("the active model is the saved one, else the provider default", () => {
  assert.equal(activeModel(settings()), "deepseek-chat");
  const next = withModel(settings(), "deepseek", "deepseek-reasoner");
  assert.equal(activeModel(next), "deepseek-reasoner");
  assert.equal(DEFAULT_SETTINGS.chatModels.deepseek, undefined);
});

test("a provider chip needs a key, unless the URL is loopback http", () => {
  const custom = {
    id: "c-local",
    name: "Local",
    baseUrl: "http://127.0.0.1:8000/v1",
    keyName: "chat-c-local",
    defaultModel: "local",
    builtin: false,
  };
  const s = settings({ chatProviders: ensureProviders([custom]) });
  assert.deepEqual(visibleProviders(s, {}).map((p) => p.id), ["c-local"]);
  assert.deepEqual(visibleProviders(s, { "deepseek-api-key": true }).map((p) => p.id), ["deepseek", "c-local"]);
});

test("https is allowed, clear-text only to this machine", () => {
  assert.equal(urlAllowed("https://api.deepseek.com/v1"), true);
  assert.equal(urlAllowed("http://127.0.0.1:11434/v1"), true);
  assert.equal(urlAllowed("http://example.com/v1"), false);
  assert.equal(isLoopbackHost("localhost"), true);
});

test("pickModel keeps the current model when it is offered", () => {
  const p = providerDef("deepseek", settings());
  assert.equal(pickModel(p, ["deepseek-chat", "deepseek-reasoner"], "deepseek-reasoner"), "deepseek-reasoner");
  assert.equal(pickModel(p, ["other"], "missing"), "other");
});
