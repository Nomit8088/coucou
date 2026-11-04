// The closed island that stays on screen on a PC (src/core/closed.ts).
// Ported from upstream #1016: values written by a newer build must not break
// the window size, and a style with nothing to show falls back to the time.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED_H, CLOSED_MAX_W, CLOSED_MIN_W, CLOSED_PAD, CLOSED_ISLANDS,
  closedContent, closedIsland, closedWidth,
} from "../src/core/closed.ts";

const now = new Date("2026-11-04T14:30:00");
const input = (extra = {}) => ({ now, locale: "en", planUsage: null, music: null, ...extra });

test("an unknown or missing style reads as the default", () => {
  for (const style of CLOSED_ISLANDS) assert.equal(closedIsland(style), style);
  assert.equal(closedIsland("written-by-a-newer-build"), "mochi");
  assert.equal(closedIsland(null), "mochi");
  assert.equal(closedIsland(42), "mochi");
});

test("Mochi, empty and hidden draw no text", () => {
  for (const style of ["mochi", "empty", "hidden"]) {
    assert.equal(closedContent(style, input()), null);
  }
});

test("the time and the date are plain text", () => {
  const time = closedContent("time", input());
  assert.equal(time.dot, null);
  assert.equal(time.note, false);
  assert.match(time.text, /\d{1,2}:\d{2}/);
  const datetime = closedContent("datetime", input());
  assert.ok(datetime.text.length > time.text.length);
  assert.match(datetime.text, /\d{1,2}:\d{2}/);
});

test("usage and music fall back to the time when there is nothing to show", () => {
  assert.match(closedContent("claude", input()).text, /\d{1,2}:\d{2}/);
  assert.match(closedContent("music", input()).text, /\d{1,2}:\d{2}/);
});

test("usage shows the higher percentage and its colour", () => {
  const planUsage = {
    fiveHour: { usedPct: 42, resetsAt: now.getTime() + 3_600_000 },
    sevenDay: { usedPct: 20, resetsAt: now.getTime() + 86_400_000 },
    updatedAt: now.getTime(),
  };
  const content = closedContent("claude", input({ planUsage }));
  assert.equal(content.text, "Claude 42%");
  assert.equal(content.dot, "#22C55E");
});

test("a song keeps its artist and asks for the note glyph", () => {
  const content = closedContent("music", input({ music: { title: "Song", artist: "Artist" } }));
  assert.equal(content.text, "Song · Artist");
  assert.equal(content.note, true);
  assert.equal(closedContent("music", input({ music: { title: "Song", artist: "" } })).text, "Song");
});

test("a closed island is never narrower than Mochi nor wider than the cap", () => {
  assert.equal(closedWidth(0), CLOSED_MIN_W);
  assert.equal(closedWidth(100), 100 + CLOSED_PAD * 2);
  assert.equal(closedWidth(100, 12), 100 + 12 + CLOSED_PAD * 2);
  assert.equal(closedWidth(10_000), CLOSED_MAX_W);
  assert.ok(CLOSED_H > 0);
});
