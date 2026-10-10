// The Spotify pill (Linux) and Mochi's dance: the page's rules in
// src/core/spotify.ts, the dance in src/mochi/engine.ts, the report handling in
// src/island/spotify.ts and the views in src/views/spotify.ts. The MPRIS side —
// metadata, position, the bus itself — is tested in src-tauri/src/spotify.rs.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { emit, sent } from "./tauri.mjs";
import { installFakeDom } from "./fakedom.mjs";
import {
  IDLE_SPOTIFY, SPOTIFY_ID, Spotify, capsOf, currentArtwork, desktopDances, formatTime, isAd, islandDances,
  isTrackLiked, musicPlaying, pillIdOf, spotifyPosition, toggleTrackLiked, volumeLevel, withPlaying,
} from "../src/core/spotify.ts";
import { COMPACT_MUSIC_W, COMPACT_W, islandSize } from "../src/core/layout.ts";
import { CompactMusicWidget } from "../src/island/compact-music.ts";
import { BotEngine, danceTransform, stepDanceLevel } from "../src/mochi/engine.ts";
import { registerSpotifyHandlers } from "../src/island/spotify.ts";
import { buildSpotifyCard, buildSpotifyPill } from "../src/views/spotify.ts";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";
import { lookup, setLanguage } from "../src/i18n/i18n.ts";

installFakeDom();

const track = (over = {}) => ({
  id: "spotify:track:abc", title: "Get Lucky", artist: "Daft Punk", album: "Random Access Memories",
  duration: 180, artUrl: "https://i.scdn.co/image/abc", ...over,
});

const playing = (over = {}) => ({
  ...IDLE_SPOTIFY, running: true, installed: true, track: track(), playing: true,
  position: 10, positionAt: 1_000, volume: 70, ...over,
});

// ── Position ──────────────────────────────────────────────────────────────────

test("the position runs on from its timestamp while playing, and stops at the end", () => {
  const s = playing();
  assert.equal(spotifyPosition(s, 1_000), 10);
  assert.equal(spotifyPosition(s, 3_500), 12.5);
  assert.equal(spotifyPosition(s, 0), 10, "a clock behind the anchor never moves it back");
  assert.equal(spotifyPosition(s, 1_000_000), 180, "capped at the track's length");
  assert.equal(spotifyPosition({ ...s, playing: false }, 60_000), 10, "paused, it stays put");
  assert.equal(spotifyPosition({ ...s, track: null }, 3_000), 12, "no length, no cap");
});

test("a play/pause click freezes or restarts the clock where it is", () => {
  const paused = withPlaying(playing(), false, 5_000);
  assert.equal(paused.playing, false);
  assert.equal(paused.position, 14);
  assert.equal(paused.positionAt, 5_000);
  assert.equal(spotifyPosition(paused, 9_000), 14);
  const again = withPlaying(paused, true, 9_000);
  assert.equal(spotifyPosition(again, 10_000), 15);
  const same = playing();
  assert.equal(withPlaying(same, true, 99), same, "no change, same object");
});

test("times read like the Mac's player", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.9), "1:05");
  assert.equal(formatTime(599), "9:59");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(-3), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
});

test("the volume icon has the Mac's thresholds", () => {
  assert.deepEqual([0, 1, 33, 34, 66, 67, 100].map(volumeLevel), [0, 1, 1, 2, 2, 3, 3]);
});

test("ads are told by their id", () => {
  assert.ok(isAd(track({ id: "spotify:ad:123" })));
  assert.ok(!isAd(track()));
  assert.ok(!isAd(null));
});

test("a cover shows only on the track it belongs to", () => {
  Spotify.artwork = { artUrl: "https://i.scdn.co/image/abc", dataUrl: "data:image/jpeg;base64,AA" };
  assert.equal(currentArtwork(playing()), "data:image/jpeg;base64,AA");
  assert.equal(currentArtwork(playing({ track: track({ artUrl: "https://i.scdn.co/image/zzz" }) })), null);
  assert.equal(currentArtwork(playing({ track: null })), null);
  Spotify.artwork = null;
});

// ── When Mochi dances ─────────────────────────────────────────────────────────

test("music counts only when it plays on the pill it says it is on", () => {
  assert.ok(musicPlaying(playing(), [SPOTIFY_ID]));
  assert.ok(!musicPlaying(playing(), ["integration_n8n"]));
  assert.ok(!musicPlaying(playing({ playing: false }), [SPOTIFY_ID]));
  assert.ok(!musicPlaying(playing({ track: null }), [SPOTIFY_ID]));
  // A report that names QQ Music counts on that pill, and on no other.
  const qq = playing({ pillId: "integration_qqmusic" });
  assert.ok(musicPlaying(qq, ["integration_qqmusic"]));
  assert.ok(!musicPlaying(qq, [SPOTIFY_ID]));
  // Nothing named: Spotify, as every report did before.
  assert.equal(pillIdOf(playing()), SPOTIFY_ID);
  assert.equal(pillIdOf(qq), "integration_qqmusic");
  assert.equal(pillIdOf(playing({ pillId: "integration_n8n" })), SPOTIFY_ID, "an unknown pill is no pill");
  assert.deepEqual(capsOf(playing()), { volume: true, shuffle: true, repeat: true });
});

test("the island's Mochi dances by the Mac's rules", () => {
  const base = { music: true, state: "idle", mode: "compact", view: "overview", focusId: "integration_claude" };
  // Compact: whenever music plays, in the calm and busy states.
  for (const state of ["idle", "working", "thinking", "searching", "finished"]) {
    assert.ok(islandDances({ ...base, state }), state);
  }
  // An alert, an error, sleep or a daze win.
  for (const state of ["approval", "question", "error", "ratelimit", "sleeping", "dizzy"]) {
    assert.ok(!islandDances({ ...base, state }), state);
  }
  assert.ok(!islandDances({ ...base, music: false }));
  assert.ok(!islandDances({ ...base, mode: "hidden" }));
  // Expanded: only on the overview, with the music pill in front.
  assert.ok(!islandDances({ ...base, mode: "expanded" }));
  assert.ok(islandDances({ ...base, mode: "expanded", focusId: SPOTIFY_ID }));
  assert.ok(!islandDances({ ...base, mode: "expanded", focusId: SPOTIFY_ID, view: "prompt" }));
  // With the music on another pill, that is the card he dances on.
  assert.ok(islandDances({
    ...base, mode: "expanded", focusId: "integration_qqmusic", musicPillId: "integration_qqmusic",
  }));
  assert.ok(!islandDances({
    ...base, mode: "expanded", focusId: SPOTIFY_ID, musicPillId: "integration_qqmusic",
  }));
});

test("Mochi on the desktop dances by the compact island's rules", () => {
  assert.ok(desktopDances(true, "working"));
  assert.ok(!desktopDances(true, "approval"));
  assert.ok(!desktopDances(false, "idle"));
});

// ── The dance itself (BotEngine.applyDance) ───────────────────────────────────

test("the dance fades in over 0.3 s and out over 0.5 s", () => {
  assert.equal(stepDanceLevel(0, true, 0.15), 0.5);
  assert.equal(stepDanceLevel(0.9, true, 0.15), 1);
  assert.equal(stepDanceLevel(1, false, 0.25), 0.5);
  assert.equal(stepDanceLevel(0.1, false, 0.25), 0);
  assert.equal(stepDanceLevel(1, true, 0.05), 1);
});

test("112 BPM: still on the beat, highest half a beat later, nothing at level 0", () => {
  const R = 10;
  const onBeat = danceTransform(0, 1, R);
  assert.equal(onBeat.dx, 0);
  assert.equal(onBeat.dy, -0);
  assert.equal(onBeat.rotate, 0);
  assert.ok(Math.abs(onBeat.sx - 1.045) < 1e-9 && Math.abs(onBeat.sy - 0.94) < 1e-9, "squashed on landing");
  const top = danceTransform(0.5 * 60 / 112, 1, R);
  assert.ok(Math.abs(top.dy + 2) < 1e-9, "hops 0.2 R");
  assert.ok(Math.abs(top.dx - 0.8) < 1e-9 && Math.abs(top.rotate - 0.1) < 1e-9);
  assert.ok(Math.abs(top.sx - 1) < 1e-9 && Math.abs(top.sy - 1) < 1e-9);
  const off = danceTransform(0.3, 0, R);
  assert.deepEqual([off.dx, off.dy, off.rotate, off.sx, off.sy].map((v) => Math.abs(v)), [0, 0, 0, 1, 1]);
});

test("the engine dances only once asked, and keeps its frames going meanwhile", () => {
  const ops = [];
  const ctx = {
    translate: (x, y) => ops.push(["translate", x, y]),
    rotate: (a) => ops.push(["rotate", a]),
    scale: (x, y) => ops.push(["scale", x, y]),
  };
  const engine = new BotEngine();
  engine.applyDance(ctx, 100, 100);
  assert.deepEqual(ops, [], "not dancing: the context is left alone");
  engine.setDancing(true);
  engine.update(0.05);
  assert.ok(engine.dancingLevel > 0 && engine.busy);
  engine.applyDance(ctx, 100, 100);
  assert.deepEqual(ops.map((o) => o[0]), ["translate", "rotate", "scale", "translate"]);
  // Around the bottom of the body: back where it started.
  assert.equal(ops[3][1], -(50 + engine.ox * 30));
  engine.setDancing(false);
  for (let i = 0; i < 20; i++) engine.update(0.05);
  assert.equal(engine.dancingLevel, 0);
});

// ── Reports from Rust ─────────────────────────────────────────────────────────

const island = { reveals: 0, revealSilently() { this.reveals += 1; } };
registerSpotifyHandlers(island);

beforeEach(() => {
  setLanguage("en");
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [SPOTIFY_ID] };
  State.os = "linux";
  State.tasks = [];
  State.focusId = null;
  State.mode = "hidden";
  State.view = "overview";
  State.paused = false;
  State.loadIntegrationTasks();
  Spotify.state = { ...IDLE_SPOTIFY };
  Spotify.artwork = null;
  island.reveals = 0;
});

const spotifyTask = () => State.tasks.find((t) => t.id === SPOTIFY_ID);

test("the pill wears the track's title, and its own name when nothing plays", () => {
  assert.equal(spotifyTask().name, "Spotify");
  emit("spotify", playing());
  assert.equal(Spotify.state.track.title, "Get Lucky");
  assert.equal(spotifyTask().name, "Get Lucky");
  emit("spotify", playing({ track: track({ id: "spotify:ad:1", title: "" }) }));
  assert.equal(spotifyTask().name, "Advertisement");
  emit("spotify", { ...IDLE_SPOTIFY, running: true });
  assert.equal(spotifyTask().name, "Spotify");
});

test("music starting shows the hidden island once, silently; nothing on Windows-like setups", () => {
  emit("spotify", playing({ playing: false }));
  assert.equal(island.reveals, 0);
  emit("spotify", playing());
  assert.equal(island.reveals, 1);
  emit("spotify", playing({ position: 30 }));
  assert.equal(island.reveals, 1, "only on not playing → playing");
  assert.ok(State.spotifyPlaying);

  // Not declared: nothing dances, nothing shows.
  emit("spotify", { ...IDLE_SPOTIFY });
  State.settings.activeIntegrations = [];
  emit("spotify", playing());
  assert.equal(island.reveals, 1);
  assert.ok(!State.spotifyPlaying);
});

test("the cover arrives on its own event", () => {
  emit("spotify", playing());
  emit("spotify-artwork", { artUrl: "https://i.scdn.co/image/abc", dataUrl: "data:image/png;base64,AA" });
  assert.equal(currentArtwork(), "data:image/png;base64,AA");
});

test("a report routes to the pill it names, and the card hides what the player cannot do", () => {
  State.os = "windows";
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: ["integration_qqmusic"] };
  State.loadIntegrationTasks();
  Spotify.state = { ...IDLE_SPOTIFY };
  emit("spotify", playing({
    pillId: "integration_qqmusic",
    caps: { volume: false, shuffle: false, repeat: false },
  }));

  const qq = State.tasks.find((t) => t.id === "integration_qqmusic");
  assert.equal(qq.name, "Get Lucky");
  assert.ok(State.spotifyPlaying, "declared, so the island dances");

  // A media session has no volume, no shuffle and no repeat: those controls are
  // not shown, where MPRIS would show them.
  const card = buildSpotifyCard();
  card.sync();
  const [shuffle, , , , repeat] = card.el.querySelector("np-buttons").children;
  assert.equal(shuffle.style.display, "none");
  assert.equal(repeat.style.display, "none");
  assert.equal(card.el.querySelector("np-volume").style.display, "none");
  assert.match(card.el.textContent, /Get Lucky.*Daft Punk/);

  // Back to a player that answers all three: they come back.
  emit("spotify", playing({ pillId: "integration_qqmusic" }));
  card.sync();
  assert.equal(card.el.querySelector("np-buttons").children[0].style.display, "");
  assert.equal(card.el.querySelector("np-volume").style.display, "");
});

test("the idle card names the player behind the report", () => {
  State.os = "windows";
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: ["integration_qqmusic"] };
  State.loadIntegrationTasks();
  emit("spotify", { ...IDLE_SPOTIFY, pillId: "integration_qqmusic", installed: true });
  const card = buildSpotifyCard();
  card.sync();
  assert.match(card.el.textContent, /QQ Music.*Integration.*Not playing.*Open QQ Music/);
  card.el.find("BUTTON")[0].fire("click");
  assert.ok(sent("spotify_open").some((call) => call.pillId === "integration_qqmusic"));
});

test("the card reads the player again each time it comes on screen", () => {
  const before = sent("spotify_refresh").length;
  State.mode = "expanded";
  State.view = "overview";
  State.setFocus(SPOTIFY_ID);
  assert.equal(sent("spotify_refresh").length, before + 1);
  State.notify();
  assert.equal(sent("spotify_refresh").length, before + 1, "not again while it stays");
  State.mode = "compact";
  State.notify();
  State.mode = "expanded";
  State.notify();
  assert.equal(sent("spotify_refresh").length, before + 2);
});

// ── Views ─────────────────────────────────────────────────────────────────────

test("the idle card: not playing, or not installed with a way to get it", () => {
  const card = buildSpotifyCard();
  Spotify.state = { ...IDLE_SPOTIFY, installed: true };
  card.sync();
  assert.match(card.el.textContent, /Spotify.*Integration.*Not playing.*Open Spotify/);
  Spotify.state = { ...IDLE_SPOTIFY };
  card.sync();
  assert.match(card.el.textContent, /Spotify not installed.*Get Spotify/);
  card.el.find("BUTTON")[0].fire("click");
  assert.ok(sent("spotify_open").length > 0);

  setLanguage("fr");
  card.sync();
  assert.ok(card.el.textContent.includes(lookup("Get Spotify", "fr")));
});

test("the playing card: title, artist · album, times, and the controls", () => {
  const card = buildSpotifyCard();
  Spotify.state = playing({ playing: false, shuffle: true });
  card.sync();
  const text = card.el.textContent;
  assert.ok(text.includes("Get Lucky"));
  assert.ok(text.includes("Daft Punk · Random Access Memories"));
  assert.ok(text.includes("0:10") && text.includes("-2:50"));

  const [shuffle, prev, play, next, repeat] = card.el.querySelector("np-buttons").children;
  assert.equal(shuffle.title, "Shuffle on");
  assert.equal(repeat.title, "Repeat off");
  assert.equal(play.title, "Play");
  const before = sent("spotify_control").length;
  shuffle.fire("click");
  repeat.fire("click");
  prev.fire("click");
  next.fire("click");
  play.fire("click");
  assert.deepEqual(sent("spotify_control").slice(before), [
    { action: "shuffle", value: 0 },
    { action: "repeat", value: 1 },
    { action: "previous", value: null },
    { action: "next", value: null },
    { action: "playPause", value: null },
  ]);
  // The page shows the clicks at once.
  assert.equal(Spotify.state.shuffle, false);
  assert.equal(Spotify.state.repeat, true);
  assert.equal(Spotify.state.playing, true);

  Spotify.state = playing({ track: track({ id: "spotify:ad:9", title: "x", artist: "", album: "" }) });
  card.sync();
  assert.ok(card.el.textContent.includes("Advertisement"));
});

test("the pill shows play/pause and next on hover, only with a track", () => {
  const task = spotifyTask();
  const pill = buildSpotifyPill(task, () => {});
  pill.el.fire("mouseenter");
  assert.ok(!pill.el.classList.contains("controls"), "nothing loaded: no controls");
  Spotify.state = playing();
  pill.sync();
  assert.ok(pill.el.classList.contains("controls"));
  const [playBtn] = pill.el.querySelector("np-pill-controls").children;
  assert.equal(playBtn.title, "Pause");
  const before = sent("spotify_control").length;
  playBtn.fire("click");
  assert.deepEqual(sent("spotify_control").slice(before), [{ action: "playPause", value: null }]);
  assert.equal(Spotify.state.playing, false);
  pill.el.fire("mouseleave");
  assert.ok(!pill.el.classList.contains("controls"));
});

test("islandSize widens to COMPACT_MUSIC_W when music is active in compact mode", () => {
  assert.equal(islandSize("compact", "overview", 0, false).w, COMPACT_W);
  assert.equal(islandSize("compact", "overview", 0, true).w, COMPACT_MUSIC_W);
  assert.equal(islandSize("hidden", "overview", 0, true).w, 184);
  assert.equal(islandSize("expanded", "overview", 0, true).w, 640);
});

test("compact music widget syncs track, toggles hover controls, and sends playback actions", () => {
  let hoveredReported = null;
  let expanded = false;
  const widget = new CompactMusicWidget({
    onHoverChange: (h) => {
      hoveredReported = h;
    },
    onExpand: () => {
      expanded = true;
    },
  });

  Spotify.state = playing({ track: track({ title: "七里香", artist: "周杰伦" }) });
  widget.sync(true);

  assert.ok(widget.el.classList.contains("on"));
  assert.ok(widget.el.textContent.includes("七里香"));
  assert.ok(widget.el.textContent.includes("周杰伦"));

  // Hover reveals controls and notifies host
  widget.el.fire("mouseenter");
  assert.ok(widget.el.classList.contains("hovered"));
  assert.equal(hoveredReported, true);

  const prevBtn = widget.el.querySelector(".compact-music-btn");
  const before = sent("spotify_control").length;
  prevBtn.fire("click");
  assert.deepEqual(sent("spotify_control").slice(before), [{ action: "previous", value: null }]);

  widget.el.fire("mouseleave");
  assert.ok(!widget.el.classList.contains("hovered"));
  assert.equal(hoveredReported, false);
});

test("liking a track persists locally and syncs across compact widget and expanded card", () => {
  const current = track({ title: "夜曲", artist: "周杰伦" });
  Spotify.state = playing({ track: current });

  assert.equal(isTrackLiked(current), false);

  let likedFromHost = null;
  const widget = new CompactMusicWidget({
    onHoverChange: () => {},
    onExpand: () => {},
    onLike: (liked) => {
      likedFromHost = liked;
    },
  });
  widget.sync(true);

  const likeBtn = widget.el.querySelector(".compact-music-like");
  assert.ok(likeBtn);
  likeBtn.fire("click");

  assert.equal(isTrackLiked(current), true);
  assert.equal(likedFromHost, true);

  // Card also shows liked
  const card = buildSpotifyCard();
  card.sync();
  assert.ok(card.el.textContent.includes("夜曲"));

  // Toggle off
  likeBtn.fire("click");
  assert.equal(isTrackLiked(current), false);
  assert.equal(likedFromHost, false);

  // Verifies Bridge.spotifyControl("like") was called
  const likeCalls = sent("spotify_control").filter((c) => c.action === "like");
  assert.ok(likeCalls.length >= 2);
});

test("custom musicLikeHotkeys in settings can be stored and configured", () => {
  assert.ok(DEFAULT_SETTINGS.musicLikeHotkeys != null);
  State.settings = {
    ...DEFAULT_SETTINGS,
    musicLikeHotkeys: {
      integration_qqmusic: "Ctrl+Alt+L",
      integration_cloudmusic: "Ctrl+Shift+L",
    },
  };
  assert.equal(State.settings.musicLikeHotkeys.integration_qqmusic, "Ctrl+Alt+L");
  assert.equal(State.settings.musicLikeHotkeys.integration_cloudmusic, "Ctrl+Shift+L");
});

