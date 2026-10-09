// A music player's reports → the page (src-tauri/src/spotify.rs: MPRIS on Linux,
// SMTC on Windows for Spotify and QQ Music). The parts of SpotifyController.swift
// that touch the app: the pill wears the track's title, music starting shows the
// compact island without a sound, and the card reads the player again whenever it
// comes on screen (seeks made in the player's own window are never signalled).

import { Bridge, onEvent } from "../core/bridge";
import { pillDefinition } from "../core/pills";
import { Spotify, isAd, pillIdOf, type SpotifyState } from "../core/spotify";
import { State } from "../core/state";
import { t } from "../i18n/i18n";

export interface SpotifyHost {
  /** Compact island from hidden, no peek sound. */
  revealSilently(): void;
}

export function registerSpotifyHandlers(island: SpotifyHost) {
  void onEvent<SpotifyState>("spotify", (s) => applySpotify(island, s));
  void onEvent<{ artUrl: string; dataUrl: string }>("spotify-artwork", (art) => {
    Spotify.artwork = art;
    State.notify();
  });
  State.subscribe(() => {
    syncPillName();
    refreshWhenShown();
  });
}

/** A report from Rust (or the answer to a refresh). */
export function applySpotify(island: SpotifyHost, next: SpotifyState) {
  const wasPlaying = State.spotifyPlaying;
  Spotify.state = next;
  syncPillName();
  // Only on not playing → playing (SpotifyController.setPlaying).
  if (!wasPlaying && State.spotifyPlaying && !State.paused && State.mode === "hidden") {
    island.revealSilently();
  }
  State.notify();
}

/** Which pill wore the title last, so the player it left gets its own name back. */
let named: string | null = null;

/** SpotifyController.syncTaskName: the track's title, else the pill's name. */
export function syncPillName() {
  const id = pillIdOf(Spotify.state);
  if (named != null && named !== id) {
    const left = State.tasks.find((x) => x.id === named);
    if (left) left.name = pillDefinition(named)?.name ?? "Spotify";
  }
  named = id;
  const task = State.tasks.find((x) => x.id === id);
  if (!task) return;
  const track = Spotify.state.track;
  const title = isAd(track) ? t("Advertisement") : (track?.title ?? "");
  const name = title || (pillDefinition(id)?.name ?? "Spotify");
  if (task.name !== name) task.name = name;
}

let shown = false;

function refreshWhenShown() {
  const now = State.mode === "expanded" && State.view === "overview" && State.focusTask?.id === pillIdOf(Spotify.state);
  if (now && !shown) void Bridge.spotifyRefresh();
  shown = now;
}
