// What's new after an update and the blue Mochi while one waits
// (src/whats-new/whats-new.ts): which entry, when the card shows, and when
// Mochi is blue. Ported from upstream minus the "Your Coucou so far" numbers
// (they counted Flow dictations, which this fork doesn't have).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BotEngine } from "../src/mochi/engine.ts";
import { WHATS_NEW_ICONS } from "../src/whats-new/icons.ts";
import {
  ICON_NAMES, LATER_MS, compareVersions, decideOnLaunch, iconName, localized, releaseFor,
  releasePage, showsUpdateHint, updateWaiting,
} from "../src/whats-new/whats-new.ts";

const FILE = JSON.parse(readFileSync(new URL("../src/whats-new/whats-new.json", import.meta.url), "utf8"));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const LANGS = ["en", "zh-Hans", "hi", "es", "ar", "fr", "bn", "pt-BR", "ru", "id"];

test("versions compare as numbers", () => {
  assert.equal(compareVersions("0.10.0", "0.9.3"), 1);
  assert.equal(compareVersions("0.5.1", "0.5"), 1);
  assert.equal(compareVersions("0.5", "0.5.0"), 0);
  assert.equal(compareVersions("0.5.0", "0.5.1"), -1);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
});

test("the entry of exactly the running version", () => {
  const file = { releases: [{ version: "0.6.0", items: [{ icon: "bell", title: { en: "A" }, detail: { en: "a" } }] }, { version: "0.5.9", items: [] }] };
  assert.equal(releaseFor(file, "0.6.0")?.version, "0.6.0");
  assert.equal(releaseFor(file, "0.6"), file.releases[0], "0.6 is 0.6.0");
  assert.equal(releaseFor(file, "0.5.9"), null, "an entry without items is no card");
  assert.equal(releaseFor(file, "0.7.0"), null);
  assert.equal(releaseFor(null, "0.6.0"), null);
  assert.equal(releaseFor({}, "0.6.0"), null);
});

test("the version this app ships has its entry, in every language", () => {
  const release = releaseFor(FILE, PKG.version);
  assert.ok(release, `whats-new.json has no entry for ${PKG.version} — add one before releasing`);
  assert.ok(release.items.length >= 1 && release.items.length <= 4, "1 to 4 items fit the card");
  for (const item of release.items) {
    assert.ok(ICON_NAMES.includes(item.icon), item.icon);
    for (const lang of LANGS) {
      assert.ok(item.title[lang]?.trim(), `${item.icon} title ${lang}`);
      assert.ok(item.detail[lang]?.trim(), `${item.icon} detail ${lang}`);
    }
  }
});

test("every icon name has its drawing", () => {
  for (const name of ICON_NAMES) assert.ok(WHATS_NEW_ICONS[name], name);
  assert.equal(iconName("bell"), "bell");
  assert.equal(iconName("rocket"), "sparkles", "an unknown icon draws the sparkles");
});

test("the user's language, else English", () => {
  assert.equal(localized({ en: "Hello", fr: "Bonjour" }, "fr"), "Bonjour");
  assert.equal(localized({ en: "Hello", fr: " " }, "fr"), "Hello");
  assert.equal(localized({ en: "Hello" }, "id"), "Hello");
  assert.equal(localized(null, "fr"), "");
});

test("at launch: an update shows the card once, a first install never", () => {
  const base = { current: "0.3.2", usedBefore: true, hasEntry: true };
  assert.deepEqual(decideOnLaunch({ ...base, lastSeen: "0.3.1" }), { show: true, record: true });
  assert.deepEqual(decideOnLaunch({ ...base, lastSeen: "0.3.2" }), { show: false, record: false }, "same version: nothing");
  assert.deepEqual(decideOnLaunch({ ...base, lastSeen: "0.3.3" }), { show: false, record: true }, "an older build: remember, say nothing");
  assert.deepEqual(decideOnLaunch({ ...base, lastSeen: "0.3.1", hasEntry: false }), { show: false, record: true }, "no entry: no card");
  // Coming from a build that stored no version (before this card existed).
  assert.deepEqual(decideOnLaunch({ ...base, lastSeen: null }), { show: true, record: true });
  assert.deepEqual(decideOnLaunch({ ...base, lastSeen: null, usedBefore: false }), { show: false, record: true }, "a first install");
  assert.deepEqual(decideOnLaunch({ ...base, current: "", lastSeen: null }), { show: false, record: false });
});

const found = (version = "0.3.2") => ({
  hasUpdate: true,
  currentVersion: "0.3.1",
  latestVersion: version,
  releaseNotes: "",
  releaseUrl: `https://github.com/Nomit8088/coucou/releases/tag/v${version}`,
  downloadUrl: "https://github.com/Nomit8088/coucou/releases/download/v0.3.2/Coucou-Windows-setup.exe",
  fileName: "Coucou-Windows-setup.exe",
  repo: "Nomit8088/coucou",
});

test("Mochi is blue while a version waits", () => {
  const now = 1_800_000_000_000;
  assert.equal(updateWaiting(found(), null, now), true);
  assert.equal(updateWaiting({ ...found(), hasUpdate: false }, null, now), false, "up to date");
  assert.equal(updateWaiting(null, null, now), false, "no check yet");
  assert.equal(updateWaiting({ ...found(), latestVersion: "" }, null, now), false, "no version to name");
  assert.equal(updateWaiting(found(), { version: "0.3.2", at: now - 3600_000 }, now), false, "Later an hour ago");
  assert.equal(updateWaiting(found(), { version: "0.3.2", at: now - LATER_MS - 1 }, now), true, "Later yesterday: blue again");
  assert.equal(updateWaiting(found(), { version: "0.3.1", at: now - 60_000 }, now), true, "Later on another version");
  assert.equal(updateWaiting(found(), { version: "0.3.2", at: now + 3600_000 }, now), true, "a clock that went back");
});

test("the engine wears the arrow badge only over an idle or sleeping Mochi", () => {
  const engine = new BotEngine();
  engine.setUpdateHint([0.231, 0.51, 0.965]);
  assert.equal(engine.showsUpdateHint, true);
  engine.setState("working");
  assert.equal(engine.showsUpdateHint, false, "work in progress comes first");
  engine.setState("sleeping");
  assert.equal(engine.showsUpdateHint, true);
  engine.setUpdateHint(null);
  assert.equal(engine.showsUpdateHint, false);
});

test("the blue only when Mochi has nothing else to say", () => {
  assert.equal(showsUpdateHint(true, "idle", false), true);
  assert.equal(showsUpdateHint(true, "sleeping", false), true);
  assert.equal(showsUpdateHint(true, "working", false), false);
  assert.equal(showsUpdateHint(true, "approval", false), false);
  assert.equal(showsUpdateHint(true, "idle", true), false, "a waiting permission comes first");
  assert.equal(showsUpdateHint(false, "idle", false), false);
});

test("All changes opens the release page of this version", () => {
  assert.equal(releasePage("Nomit8088/coucou", "0.3.2"), "https://github.com/Nomit8088/coucou/releases/tag/v0.3.2");
});
