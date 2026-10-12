// The now-playing pill on the page: what src-tauri/src/spotify.rs reports (MPRIS
// on Linux, Windows' SMTC for Spotify and QQ Music), and the pure rules the views
// and Mochi follow — ports of SpotifyController.swift, NowPlayingViews.swift and
// the Mac's dance rules (BotCanvasView, DesktopMochi.swift).
//
// A report names the pill it belongs to (`pillId`): one player is on screen at a
// time, so the same state, card and dance serve every music pill.

import type { BotStateName, IslandMode, IslandViewName } from "./layout";
import { pillDefinition } from "./pills";

export const SPOTIFY_ID = "integration_spotify";
/** SpotifyController.green. */
export const SPOTIFY_GREEN = "#1DB954";

export interface SpotifyTrack {
  /** spotify:track:…, spotify:episode:…, spotify:ad:… */
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Seconds. */
  duration: number;
  artUrl: string | null;
}

/** What the player behind the state can actually do. */
export interface MusicCaps {
  volume: boolean;
  shuffle: boolean;
  repeat: boolean;
}

/** MPRIS answers all three; Windows' media session answers none of them. */
export const FULL_CAPS: MusicCaps = { volume: true, shuffle: true, repeat: true };

export interface SpotifyState {
  /** The player is running. */
  running: boolean;
  /** There is a player to launch. */
  installed: boolean;
  track: SpotifyTrack | null;
  playing: boolean;
  /** Seconds at `positionAt` (Unix ms); while playing it runs on from there. */
  position: number;
  positionAt: number;
  shuffle: boolean;
  repeat: boolean;
  /** 0…100. */
  volume: number;
  /**
   * The pill this player belongs to (`integration_spotify`, `integration_qqmusic`…):
   * one player is on screen at a time, so the report says which one it is. Absent
   * means Spotify, as every report did before.
   */
  pillId?: string;
  /** What the player can do; the card hides what it cannot. */
  caps?: MusicCaps;
}

export const IDLE_SPOTIFY: SpotifyState = {
  running: false, installed: false, track: null, playing: false,
  position: 0, positionAt: 0, shuffle: false, repeat: false, volume: 50,
  pillId: SPOTIFY_ID, caps: FULL_CAPS,
};

/** The page's copy of the player, and the cover of the track that has one. */
export const Spotify = {
  state: { ...IDLE_SPOTIFY } as SpotifyState,
  artwork: null as { artUrl: string; dataUrl: string } | null,
};

/** Whether a pill is one of the players this state can belong to (pills.ts `mediaApp`). */
export function isMusicPill(id: string | null | undefined): boolean {
  return !!id && pillDefinition(id)?.mediaApp != null;
}

/** The pill the current report belongs to; Spotify when the player says nothing. */
export function pillIdOf(s: SpotifyState = Spotify.state): string {
  return isMusicPill(s.pillId) ? (s.pillId as string) : SPOTIFY_ID;
}

/** What the player can do — everything, unless it said otherwise (SMTC says none). */
export function capsOf(s: SpotifyState = Spotify.state): MusicCaps {
  return s.caps ?? FULL_CAPS;
}

/** The cover to show for the current track, if it has arrived. */
export function currentArtwork(s: SpotifyState = Spotify.state): string | null {
  const art = Spotify.artwork;
  return art && s.track?.artUrl && art.artUrl === s.track.artUrl ? art.dataUrl : null;
}

/** SpotifyController.position(at:): extrapolated while playing, capped at the end. */
export function spotifyPosition(s: SpotifyState, nowMs: number): number {
  const elapsed = s.playing ? Math.max(0, (nowMs - s.positionAt) / 1000) : 0;
  const p = s.position + elapsed;
  const d = s.track?.duration ?? 0;
  return d > 0 ? Math.min(p, d) : p;
}

/**
 * The clock frozen or restarted where it is now — what a play/pause click
 * does at once, before Spotify confirms it (SpotifyController.setPlaying).
 */
export function withPlaying(s: SpotifyState, playing: boolean, nowMs: number): SpotifyState {
  if (s.playing === playing) return s;
  return { ...s, position: spotifyPosition(s, nowMs), positionAt: nowMs, playing };
}

export function isAd(track: SpotifyTrack | null | undefined): boolean {
  return track?.id.startsWith("spotify:ad:") ?? false;
}

/** NowPlayingProgress.format: m:ss, or h:mm:ss past an hour. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** NowPlayingVolume.icon: 0 = muted, then one, two or three waves. */
export function volumeLevel(volume: number): 0 | 1 | 2 | 3 {
  if (volume <= 0) return 0;
  if (volume < 34) return 1;
  if (volume < 67) return 2;
  return 3;
}

/** Music is playing on a declared player pill (Spotify, QQ Music…). */
export function musicPlaying(s: SpotifyState, activeIntegrations: readonly string[]): boolean {
  return s.playing && s.track != null && activeIntegrations.includes(pillIdOf(s));
}

/** The states Mochi dances in; the rest (an alert, an error, sleep) win. */
const DANCE_STATES: ReadonlySet<BotStateName> = new Set(["idle", "working", "thinking", "searching", "finished"]);

/**
 * The island's Mochi (BotCanvasView, macOS): in the compact island whenever
 * music plays, expanded only on the overview with the music pill in front.
 */
export function islandDances(o: {
  music: boolean;
  state: BotStateName;
  mode: IslandMode;
  view: IslandViewName;
  focusId: string | null | undefined;
  /** The pill the music is on; Spotify when nobody says (the Mac's rule). */
  musicPillId?: string;
}): boolean {
  if (!o.music || !DANCE_STATES.has(o.state)) return false;
  if (o.mode === "compact") return true;
  return o.mode === "expanded" && o.view === "overview" && o.focusId === (o.musicPillId ?? SPOTIFY_ID);
}

/** Mochi on the desktop: the compact island's rules (DesktopMochi.swift). */
export function desktopDances(music: boolean, state: BotStateName): boolean {
  return music && DANCE_STATES.has(state);
}

// ── Liked tracks ─────────────────────────────────────────────────────────────

const LIKED_KEY = "coucou:liked_tracks";
let likedTracks = new Set<string>();

export function initLikedTracks() {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(LIKED_KEY);
      if (raw) likedTracks = new Set(JSON.parse(raw));
    }
  } catch {}
}
initLikedTracks();

export function likedTrackKey(track: SpotifyTrack | null | undefined): string {
  if (!track || !track.title) return "";
  return `${track.title.trim().toLowerCase()}|${track.artist.trim().toLowerCase()}`;
}

export function isTrackLiked(track: SpotifyTrack | null | undefined): boolean {
  const k = likedTrackKey(track);
  return k ? likedTracks.has(k) : false;
}

export function toggleTrackLiked(track: SpotifyTrack | null | undefined): boolean {
  const k = likedTrackKey(track);
  if (!k) return false;
  const next = !likedTracks.has(k);
  if (next) {
    likedTracks.add(k);
  } else {
    likedTracks.delete(k);
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LIKED_KEY, JSON.stringify([...likedTracks]));
    }
  } catch {}
  return next;
}
