// The personal-fork pill catalog and declared-pill rules.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAIN_PILL, MAX_DECLARED, PILL_CATALOG, availablePills, chooseMainPill,
  isHookPill, mainPillChoices, orderPills, pillDefinition, sanitizeDeclared, sessionSubtitle,
  toggleDeclared,
} from "../src/core/pills.ts";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";
import { isMusicPill } from "../src/core/spotify.ts";

test("the catalog is the personal fork set, with stable new ids", () => {
  assert.deepEqual(
    PILL_CATALOG.map((p) => [p.id, p.name, p.color]),
    [
      ["agent_dsh", "DeepSeek Harness", "#4D6BFE"],
      ["agent_codex", "Codex", "#2DD4BF"],
      ["integration_github", "GitHub", "#F4505E"],
      ["integration_resend", "Resend", "#22C55E"],
      ["integration_gitlab", "GitLab", "#FC6D26"],
      ["integration_spotify", "Spotify", "#1DB954"],
      ["integration_qqmusic", "QQ Music", "#31C27C"],
      ["integration_cloudmusic", "CloudMusic", "#C20C0C"],
      ["integration_qqmail", "QQ Mail", "#12B7F5"],
    ],
  );
  assert.equal(DEFAULT_MAIN_PILL, "agent_dsh");
  assert.equal(pillDefinition("integration_gitlab").connect.key, "gitlab-token");
  // Spotify is read over MPRIS on Linux and over a media session on Windows.
  assert.equal(pillDefinition("integration_spotify").support, "yes");
  // QQ Music and CloudMusic PC clients only exist on Windows.
  assert.equal(pillDefinition("integration_qqmusic").support, "windows");
  assert.equal(pillDefinition("integration_qqmusic").mediaApp, "QQMusic.exe");
  assert.equal(pillDefinition("integration_cloudmusic").support, "windows");
  assert.equal(pillDefinition("integration_cloudmusic").mediaApp, "cloudmusic.exe");
  assert.equal(pillDefinition("integration_spotify").mediaApp, "Spotify.exe");
  assert.equal(pillDefinition("integration_qqmail").connect.key, "qqmail-auth-code");
  for (const gone of ["integration_claude", "agent_cursor", "ai_anthropic", "integration_stripe", "integration_music"]) {
    assert.equal(pillDefinition(gone), undefined, gone);
  }
});

test("a music pill is one that follows a player, not one that takes a key", () => {
  assert.ok(isMusicPill("integration_spotify"));
  assert.ok(isMusicPill("integration_qqmusic"));
  assert.ok(isMusicPill("integration_cloudmusic"));
  assert.ok(!isMusicPill("integration_qqmail"));
  assert.ok(!isMusicPill("integration_github"));
  assert.ok(!isMusicPill(null) && !isMusicPill(undefined));
});

test("IDs are unique", () => {
  const ids = PILL_CATALOG.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("the main pill is DeepSeek or Codex", () => {
  assert.deepEqual(mainPillChoices("windows").map((p) => p.id), ["agent_dsh", "agent_codex"]);
  assert.deepEqual(mainPillChoices("linux").map((p) => p.id), ["agent_dsh", "agent_codex"]);
});

test("hook pills are DSH and Codex", () => {
  assert.equal(isHookPill("agent_dsh"), true);
  assert.equal(isHookPill("agent_codex"), true);
  assert.equal(isHookPill("integration_github"), false);
});

test("a live session names its tool", () => {
  assert.equal(sessionSubtitle("agent_dsh"), "DeepSeek Harness");
  assert.equal(sessionSubtitle("agent_codex"), "Codex");
});

test("an old settings file falls back to DeepSeek and drops removed pills", () => {
  const d = sanitizeDeclared({
    mainPill: "integration_claude",
    activeIntegrations: ["integration_n8n", "integration_github", "integration_stripe", "integration_github"],
  });
  assert.equal(d.mainPill, "agent_dsh");
  assert.deepEqual(d.activeIntegrations, ["integration_github"]);
});

test("up to four pills next to the main one", () => {
  const start = { mainPill: "agent_dsh", activeIntegrations: [] };
  assert.deepEqual(toggleDeclared(start, "integration_github"), ["integration_github"]);
  assert.equal(toggleDeclared(start, "agent_dsh"), null);
  assert.equal(toggleDeclared(start, "integration_stripe"), null);
  const full = {
    mainPill: "agent_dsh",
    activeIntegrations: ["agent_codex", "integration_github", "integration_resend", "integration_gitlab"],
  };
  assert.equal(full.activeIntegrations.length, MAX_DECLARED);
  assert.equal(toggleDeclared(full, "agent_codex")?.includes("agent_codex"), false);
});

test("picking Codex as main removes it from the declared list", () => {
  const next = chooseMainPill(
    { mainPill: "agent_dsh", activeIntegrations: ["agent_codex", "integration_github"] },
    "agent_codex",
  );
  assert.deepEqual(next, { mainPill: "agent_codex", activeIntegrations: ["integration_github"] });
  assert.equal(chooseMainPill({ mainPill: "agent_dsh", activeIntegrations: [] }, "integration_github"), null);
});

test("pills are ordered main first, then outsiders, then the catalog", () => {
  const ordered = orderPills(
    [{ id: "integration_github" }, { id: "agent_mine" }, { id: "agent_dsh" }],
    "agent_dsh",
  ).map((p) => p.id);
  assert.deepEqual(ordered, ["agent_dsh", "agent_mine", "integration_github"]);
});

beforeEach(() => {
  State.tasks = [];
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [], mainPill: DEFAULT_MAIN_PILL };
  State.os = "windows";
});

test("the main pill always loads", () => {
  State.settings.activeIntegrations = ["integration_github"];
  State.loadIntegrationTasks();
  assert.deepEqual(State.tasks.map((t) => t.id), ["agent_dsh", "integration_github"]);
  assert.equal(State.focusId, "agent_dsh");
});
