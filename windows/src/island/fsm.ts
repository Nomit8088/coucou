// Island open/close FSM — port of IslandStateMachine.swift.
// No DOM, no Tauri: it only reports transitions.

export type FsmState = "hidden" | "petit" | "home" | "coucou";

export class IslandStateMachine {
  state: FsmState = "hidden";

  onTransition: ((from: FsmState, to: FsmState) => void) | null = null;

  /**
   * home → petit delay, seconds: the auto-close preference. Changing it while a
   * countdown runs starts that countdown again with the new delay, so an edit in
   * Settings applies at once (IslandStateMachine.homeToPetitDelay on macOS).
   */
  get homeToPetitDelay(): number {
    return this.homeDelay;
  }
  set homeToPetitDelay(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds === this.homeDelay) return;
    this.homeDelay = seconds;
    if (this.state === "home" && this.homeCollapse != null) this.scheduleHomeCollapse();
    if (this.state === "petit") {
      if (!this.canPetitHide()) this.clear("petitHide");
      else if (this.petitHide == null) this.schedulePetitHide();
    }
  }
  /**
   * Predicate deciding whether the compact island should stay on screen
   * instead of timing out to hidden after 60s (e.g. music is active or stay open is set).
   */
  shouldKeepPetit: (() => boolean) | null = null;

  /** Whether the compact island is allowed to fold to hidden automatically. */
  canPetitHide(): boolean {
    if (this.homeDelay === 0) return false;
    if (this.shouldKeepPetit?.()) return false;
    return true;
  }
  /** petit → hidden delay, seconds. */
  petitToHiddenDelay = 60;
  /** coucou → petit once the greeting animation ends (no hover). */
  greetAutoCollapseDelay = 0.6;
  /** coucou → petit while the mouse hovers the greeting. */
  greetHoverCollapseDelay = 10;
  /** An alert waiting for an answer stays open, even when the mouse leaves. */
  pinned = false;
  /**
   * The compact island's − was clicked: the island left the screen and the
   * pointer alone must not bring it back — only a real event does (an agent
   * starting work, an alert, the tray's Open or a shortcut), see `dismiss()`.
   */
  dismissed = false;
  /**
   * Hovering opens the island all the way instead of peeking (Settings →
   * General → Open on hover, off by default), as IslandStateMachine.openOnHover.
   */
  openOnHover = false;
  /** Grace period after the pointer leaves a hover-opened island, seconds. */
  hoverCloseDelay = 0.6;
  /** Open because of a hover, until the user clicks inside it. */
  get openedByHover(): boolean {
    return this.byHover;
  }

  /**
   * When the open island will fold, on the performance.now() clock, while the
   * mouse-leave countdown runs; null otherwise. The island draws its countdown
   * bar from it.
   */
  homeCollapseDueAt: number | null = null;

  private homeDelay = 15;
  private byHover = false;
  private petitHide: number | null = null;
  private homeCollapse: number | null = null;
  private greetCollapse: number | null = null;

  // ── Inputs ──────────────────────────────────────────────────────────────────

  launch() {
    this.dismissed = false;
    this.cancelTimers();
    this.transition("coucou");
  }

  mouseEntered() {
    // A dismissed island is not there: hovering the top of the screen does
    // nothing until something real happens.
    if (this.dismissed) return;
    if (this.openOnHover && (this.state === "hidden" || this.state === "petit") && !this.pinned) {
      this.cancelTimers();
      this.byHover = true;
      this.transition("home");
      return;
    }
    switch (this.state) {
      case "hidden":
        this.cancelTimers();
        this.transition("petit");
        break;
      case "petit":
        this.clear("petitHide");
        break;
      case "home":
        this.clear("homeCollapse");
        break;
      case "coucou":
        this.scheduleGreetCollapse(this.greetHoverCollapseDelay);
        break;
    }
  }

  mouseLeft() {
    switch (this.state) {
      case "hidden":
        break;
      case "petit":
        this.schedulePetitHide();
        break;
      case "home":
        this.scheduleHomeCollapse();
        break;
      case "coucou":
        this.clear("greetCollapse");
        this.transition("petit");
        break;
    }
  }

  click() {
    this.byHover = false;
    if (this.state !== "petit") return;
    this.cancelTimers();
    this.transition("home");
  }

  /** Greeting animation finished (T.end). Doesn't override a running hover timer. */
  greetComplete() {
    if (this.state !== "coucou") return;
    if (this.greetCollapse == null) this.scheduleGreetCollapse(this.greetAutoCollapseDelay);
  }

  /** Non-alert work event: show compact from hidden. */
  reveal() {
    this.dismissed = false;
    if (this.state !== "hidden") return;
    this.cancelTimers();
    this.transition("petit");
    this.schedulePetitHide();
  }

  /**
   * The user clicked inside the island: a hover-opened island now stays like
   * any open island (normal auto-close) instead of folding once the pointer leaves.
   */
  userInteracted() {
    if (!this.byHover) return;
    this.byHover = false;
    // The short countdown already running becomes the normal one.
    if (this.state === "home" && this.homeCollapse != null) this.scheduleHomeCollapse();
  }

  /** Alert or explicit request: open straight to expanded. */
  forceHome() {
    this.dismissed = false;
    this.byHover = false;
    this.cancelTimers();
    this.transition("home");
  }

  /// Explicit close (OK button, Escape, an alert being answered).
  forcePetit() {
    this.dismissed = false;
    this.byHover = false;
    this.cancelTimers();
    this.transition("petit");
  }

  forceHidden() {
    this.dismissed = false;
    this.byHover = false;
    this.cancelTimers();
    this.transition("hidden");
  }

  /**
   * The compact island's − was clicked: off the screen until something happens.
   * The usual exit path (petit) is deliberately not used: a dismissed island is
   * not merely folded, and a pointer passing the top of the screen must not
   * bring it back.
   */
  dismiss() {
    this.dismissed = true;
    this.byHover = false;
    this.cancelTimers();
    this.transition("hidden");
  }

  /** A click that missed the island while it was open: fold it back to compact. */
  clickedOutside() {
    if (this.state !== "home") return;
    this.forcePetit();
  }

  /**
   * Re-evaluates whether the compact island should hold its position or start/cancel
   * its hide timer (e.g. when music playback starts or stops).
   */
  syncPetitHold() {
    if (this.state !== "petit" || this.dismissed) return;
    if (!this.canPetitHide()) {
      this.clear("petitHide");
    } else if (this.petitHide == null && !this.pinned) {
      this.schedulePetitHide();
    }
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  private schedulePetitHide() {
    this.clear("petitHide");
    // A card folded away while it waits for an answer keeps the compact island
    // on screen, so it can be reopened (isHeldOpen on macOS).
    if (this.pinned) return;
    if (!this.canPetitHide()) return;
    this.petitHide = window.setTimeout(() => {
      this.petitHide = null;
      if (this.state === "petit" && !this.pinned && this.canPetitHide()) {
        this.transition("hidden");
      }
    }, this.petitToHiddenDelay * 1000);
  }

  private scheduleHomeCollapse() {
    this.clear("homeCollapse");
    if (this.pinned) return;
    if (this.homeDelay === 0 && !this.byHover) {
      this.homeCollapseDueAt = null;
      return;
    }
    const ms = (this.byHover ? this.hoverCloseDelay : this.homeDelay) * 1000;
    this.homeCollapseDueAt = performance.now() + ms;
    this.homeCollapse = window.setTimeout(() => {
      this.homeCollapse = null;
      this.homeCollapseDueAt = null;
      // An alert pinned while the countdown ran keeps the island open.
      if (this.state === "home" && !this.pinned) {
        this.byHover = false;
        this.transition("petit");
      }
    }, ms);
  }

  private scheduleGreetCollapse(delay: number) {
    this.clear("greetCollapse");
    this.greetCollapse = window.setTimeout(() => {
      this.greetCollapse = null;
      if (this.state === "coucou") this.transition("petit");
    }, delay * 1000);
  }

  private clear(which: "petitHide" | "homeCollapse" | "greetCollapse") {
    const id = this[which];
    if (id != null) window.clearTimeout(id);
    this[which] = null;
    if (which === "homeCollapse") this.homeCollapseDueAt = null;
  }

  cancelTimers() {
    this.clear("petitHide");
    this.clear("homeCollapse");
    this.clear("greetCollapse");
  }

  private transition(next: FsmState) {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.onTransition?.(from, next);
  }
}
