// Compact island music controller: displayed in compact mode between Mochi
// and the miniGrid when a music player is active.
//
// Shows:
// - Non-hover: track title & artist, glowing pill-colored dot, progress bar at bottom.
// - Hover: previous, play/pause and next buttons, seekable progress bar.

import { Bridge } from "../core/bridge";
import { ICONS } from "../views/icons";
import { svg } from "../views/dom";
import { pillDefinition } from "../core/pills";
import { Spotify, isAd, isTrackLiked, pillIdOf, spotifyPosition, toggleTrackLiked, withPlaying } from "../core/spotify";
import { State } from "../core/state";
import { t } from "../i18n/i18n";

export interface CompactMusicHost {
  onHoverChange(hovered: boolean): void;
  onExpand(): void;
  onLike?(liked: boolean): void;
}

export class CompactMusicWidget {
  readonly el: HTMLElement;
  private dotEl: HTMLElement;
  private titleEl: HTMLElement;
  private artistEl: HTMLElement;
  private likedBadge: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private playBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private likeBtn: HTMLButtonElement;
  private progressEl: HTMLElement;
  private fillEl: HTMLElement;

  private hovered = false;
  private lastTitle = "";
  private lastArtist = "";
  private lastPlaying: boolean | null = null;
  private lastPill = "";
  private host: CompactMusicHost;

  constructor(host: CompactMusicHost) {
    this.host = host;

    this.dotEl = document.createElement("i");
    this.dotEl.className = "compact-music-dot";

    this.titleEl = document.createElement("span");
    this.titleEl.className = "compact-music-title";

    this.likedBadge = document.createElement("span");
    this.likedBadge.className = "compact-music-liked-badge";
    this.likedBadge.textContent = " ♥";
    this.likedBadge.style.color = "#FF4D6D";
    this.likedBadge.style.display = "none";

    const sepEl = document.createElement("span");
    sepEl.className = "compact-music-sep";
    sepEl.textContent = "·";

    this.artistEl = document.createElement("span");
    this.artistEl.className = "compact-music-artist";

    const textWrap = document.createElement("div");
    textWrap.className = "compact-music-text";
    textWrap.append(this.titleEl, this.likedBadge, sepEl, this.artistEl);

    const infoEl = document.createElement("div");
    infoEl.className = "compact-music-info";
    infoEl.append(this.dotEl, textWrap);

    // Clicking the track text area focuses the music pill and expands the island
    infoEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      State.setFocus(pillIdOf(Spotify.state));
      this.host.onExpand();
    });

    this.prevBtn = document.createElement("button");
    this.prevBtn.className = "compact-music-btn";
    this.prevBtn.title = t("Previous");
    this.prevBtn.append(svg(ICONS.backward, 10));
    this.prevBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    this.prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void Bridge.spotifyControl("previous");
    });

    this.playBtn = document.createElement("button");
    this.playBtn.className = "compact-music-btn compact-music-play";
    this.playBtn.title = t("Play");
    this.playBtn.append(svg(ICONS.play, 10));
    this.playBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    this.playBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextPlaying = !Spotify.state.playing;
      Spotify.state = withPlaying(Spotify.state, nextPlaying, Date.now());
      this.updatePlayIcon(nextPlaying);
      void Bridge.spotifyControl("playPause");
    });

    this.nextBtn = document.createElement("button");
    this.nextBtn.className = "compact-music-btn";
    this.nextBtn.title = t("Next");
    this.nextBtn.append(svg(ICONS.forward, 10));
    this.nextBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    this.nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void Bridge.spotifyControl("next");
    });

    this.likeBtn = document.createElement("button");
    this.likeBtn.className = "compact-music-btn compact-music-like";
    this.likeBtn.title = t("Like");
    this.likeBtn.append(svg(ICONS.heart, 10));
    this.likeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    this.likeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const track = Spotify.state.track;
      if (!track) return;
      const liked = toggleTrackLiked(track);
      this.updateLikeIcon(liked);
      this.host.onLike?.(liked);
      void Bridge.spotifyControl("like");
      State.notify();
    });

    const controlsEl = document.createElement("div");
    controlsEl.className = "compact-music-controls";
    controlsEl.append(this.prevBtn, this.playBtn, this.nextBtn, this.likeBtn);

    const bodyEl = document.createElement("div");
    bodyEl.className = "compact-music-body";
    bodyEl.append(infoEl, controlsEl);

    this.fillEl = document.createElement("i");
    this.fillEl.className = "compact-music-fill";

    this.progressEl = document.createElement("div");
    this.progressEl.className = "compact-music-progress";
    this.progressEl.append(this.fillEl);

    // Seeking on the progress bar
    this.progressEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this.handleSeek(e);
    });

    this.el = document.createElement("div");
    this.el.id = "compact-music";
    this.el.append(bodyEl, this.progressEl);

    this.el.addEventListener("mouseenter", () => {
      this.hovered = true;
      this.el.classList.add("hovered");
      this.host.onHoverChange(true);
    });
    this.el.addEventListener("mouseleave", () => {
      this.hovered = false;
      this.el.classList.remove("hovered");
      this.host.onHoverChange(false);
    });
  }

  get isHovered(): boolean {
    return this.hovered;
  }

  private handleSeek(e: MouseEvent) {
    const rect = this.progressEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = Spotify.state.track?.duration ?? 0;
    if (duration > 0) {
      const target = ratio * duration;
      Spotify.state.position = target;
      Spotify.state.positionAt = Date.now();
      this.fillEl.style.width = `${ratio * 100}%`;
      void Bridge.spotifyControl("seek", target);
    }
  }

  private updatePlayIcon(playing: boolean) {
    if (this.lastPlaying === playing) return;
    this.lastPlaying = playing;
    this.playBtn.replaceChildren(svg(playing ? ICONS.pause : ICONS.play, 10));
    this.playBtn.title = playing ? t("Pause") : t("Play");
  }

  private updateLikeIcon(liked: boolean) {
    this.likeBtn.replaceChildren(svg(liked ? ICONS.heartFill : ICONS.heart, 10));
    this.likeBtn.style.color = liked ? "#FF4D6D" : "#8e939c";
    this.likeBtn.title = liked ? t("Liked") : t("Like");
    this.likeBtn.style.filter = liked ? "drop-shadow(0 0 3px rgba(255, 77, 109, 0.6))" : "";
    this.likedBadge.style.display = liked ? "inline" : "none";
  }

  /** Called per frame to update progress bar smoothly. */
  tick(nowMs: number) {
    const track = Spotify.state.track;
    if (!track || track.duration <= 0) {
      this.fillEl.style.width = "0%";
      return;
    }
    const pos = spotifyPosition(Spotify.state, nowMs);
    const p = Math.min(100, Math.max(0, (pos / track.duration) * 100));
    this.fillEl.style.width = `${p}%`;
  }

  /** Synchronizes state from Spotify & State. */
  sync(active: boolean) {
    this.el.classList.toggle("on", active);
    if (!active) return;

    const s = Spotify.state;
    const track = s.track;
    const pill = pillIdOf(s);

    const title = isAd(track) ? t("Advertisement") : (track?.title || t("Music"));
    const artist = track?.artist || "";

    if (this.lastTitle !== title) {
      this.lastTitle = title;
      this.titleEl.textContent = title;
    }
    if (this.lastArtist !== artist) {
      this.lastArtist = artist;
      this.artistEl.textContent = artist;
    }

    this.updatePlayIcon(s.playing);
    this.updateLikeIcon(isTrackLiked(track));

    if (this.lastPill !== pill) {
      this.lastPill = pill;
      const def = pillDefinition(pill);
      const color = def?.color ?? "#31C27C";
      this.dotEl.style.background = color;
      this.dotEl.style.boxShadow = `0 0 6px ${color}99`;
      this.fillEl.style.background = color;
      this.fillEl.style.boxShadow = `0 0 6px ${color}99`;
    }
  }
}
