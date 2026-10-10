// Island open/close state machine (src/island/fsm.ts).

import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { IslandStateMachine } from "../src/island/fsm.ts";

let fsm;
let transitions;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  fsm = new IslandStateMachine();
  transitions = [];
  fsm.onTransition = (from, to) => transitions.push(`${from}>${to}`);
});

afterEach(() => mock.timers.reset());

const seconds = (n) => mock.timers.tick(n * 1000);

test("starts hidden and opens on the greeting at launch", () => {
  assert.equal(fsm.state, "hidden");
  fsm.launch();
  assert.equal(fsm.state, "coucou");
  assert.deepEqual(transitions, ["hidden>coucou"]);
});

test("the greeting collapses to the compact island 0.6 s after it ends", () => {
  fsm.launch();
  fsm.greetComplete();
  seconds(0.5);
  assert.equal(fsm.state, "coucou");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
});

test("a hovered greeting stays for 10 s, whatever the animation does", () => {
  fsm.launch();
  fsm.mouseEntered();
  fsm.greetComplete();
  seconds(9.9);
  assert.equal(fsm.state, "coucou");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
});

test("leaving the greeting collapses it at once", () => {
  fsm.launch();
  fsm.mouseEntered();
  fsm.mouseLeft();
  assert.equal(fsm.state, "petit");
});

test("the mouse wakes a hidden island, which stays while it is hovered", () => {
  fsm.mouseEntered();
  assert.equal(fsm.state, "petit");
  seconds(600);
  assert.equal(fsm.state, "petit");
});

test("the compact island hides 60 s after the mouse leaves", () => {
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(59);
  assert.equal(fsm.state, "petit");
  seconds(1);
  assert.equal(fsm.state, "hidden");
});

test("coming back before the 60 s are up cancels the hide", () => {
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(59);
  fsm.mouseEntered();
  seconds(600);
  assert.equal(fsm.state, "petit");
});

test("a click opens the compact island, and only the compact island", () => {
  fsm.click();
  assert.equal(fsm.state, "hidden");
  fsm.mouseEntered();
  fsm.click();
  assert.equal(fsm.state, "home");
  fsm.click();
  assert.equal(fsm.state, "home");
  assert.deepEqual(transitions, ["hidden>petit", "petit>home"]);
});

test("the open island collapses 15 s after the mouse leaves", () => {
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(14);
  assert.equal(fsm.state, "home");
  seconds(1);
  assert.equal(fsm.state, "petit");
});

test("coming back to the open island cancels the collapse", () => {
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(14);
  fsm.mouseEntered();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("a pinned island stays open when the mouse leaves", () => {
  fsm.forceHome();
  fsm.pinned = true;
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("the collapse delay is the configured one", () => {
  fsm.homeToPetitDelay = 5;
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(5);
  assert.equal(fsm.state, "petit");
});

test("a zero delay means stay open (never auto-close) when the mouse leaves", () => {
  fsm.homeToPetitDelay = 0;
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "home");
  assert.equal(fsm.homeCollapseDueAt, null);
});

test("reveal shows the compact island from hidden and hides it again after 60 s", () => {
  fsm.reveal();
  assert.equal(fsm.state, "petit");
  seconds(60);
  assert.equal(fsm.state, "hidden");
});

test("reveal leaves an island that is already showing alone", () => {
  fsm.forceHome();
  fsm.reveal();
  assert.equal(fsm.state, "home");
  assert.deepEqual(transitions, ["hidden>home"]);
});

test("forcing the island open cancels a pending hide", () => {
  fsm.reveal();
  fsm.forceHome();
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("an explicit close goes to the compact island and cancels the collapse", () => {
  fsm.forceHome();
  fsm.mouseLeft();
  fsm.forcePetit();
  assert.equal(fsm.state, "petit");
  seconds(600);
  assert.equal(fsm.state, "petit");
});

test("forceHidden hides from any state", () => {
  fsm.forceHome();
  fsm.forceHidden();
  assert.equal(fsm.state, "hidden");
});

test("a transition to the current state is not reported", () => {
  fsm.forceHome();
  fsm.forceHome();
  assert.deepEqual(transitions, ["hidden>home"]);
});

// ── Auto-close delay from Settings (IslandAutoCloseTests.swift) ──────────────

/** Opened by a click, the way the Mac tests open theirs. */
function opened(delay) {
  fsm.homeToPetitDelay = delay;
  fsm.mouseEntered();
  fsm.click();
  assert.equal(fsm.state, "home");
}

test("a configured 2-second delay replaces the default 15 seconds", () => {
  opened(2);
  fsm.mouseLeft();
  seconds(1.9);
  assert.equal(fsm.state, "home");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
});

test("editing the delay during a countdown replaces its timer", () => {
  opened(15);
  fsm.mouseLeft();
  fsm.homeToPetitDelay = 0.05;
  seconds(0.05);
  assert.equal(fsm.state, "petit");
});

test("a longer delay also cancels the shorter timer that was running", () => {
  opened(0.05);
  fsm.mouseLeft();
  fsm.homeToPetitDelay = 0.25;
  seconds(0.1);
  assert.equal(fsm.state, "home");
  seconds(0.15);
  assert.equal(fsm.state, "petit");
});

test("coming back cancels the countdown, and leaving again starts it with the delay", () => {
  opened(0.05);
  fsm.mouseLeft();
  fsm.mouseEntered();
  seconds(0.1);
  assert.equal(fsm.state, "home");
  fsm.mouseLeft();
  seconds(0.05);
  assert.equal(fsm.state, "petit");
});

test("a delay edit while the island is hovered starts no countdown", () => {
  opened(15);
  fsm.homeToPetitDelay = 0.05;
  seconds(600);
  assert.equal(fsm.state, "home");
  fsm.mouseLeft();
  seconds(0.05);
  assert.equal(fsm.state, "petit");
});

test("the greeting keeps its own timing whatever the auto-close delay", () => {
  fsm.greetAutoCollapseDelay = 0.15;
  fsm.launch();
  fsm.greetComplete();
  fsm.homeToPetitDelay = 0.01;
  seconds(0.05);
  assert.equal(fsm.state, "coucou");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
});

test("an alert waiting for an answer stays open through a delay edit", () => {
  opened(0.05);
  fsm.pinned = true;
  fsm.mouseLeft();
  fsm.homeToPetitDelay = 0.01;
  seconds(600);
  assert.equal(fsm.state, "home");
  fsm.pinned = false;
  fsm.mouseLeft();
  seconds(0.01);
  assert.equal(fsm.state, "petit");
});

test("an alert pinned during a countdown blocks the old timer and its replacement", () => {
  opened(0.2);
  fsm.mouseLeft();
  fsm.pinned = true;
  fsm.homeToPetitDelay = 0.01;
  seconds(600);
  assert.equal(fsm.state, "home");
  fsm.pinned = false;
  fsm.mouseLeft();
  seconds(0.01);
  assert.equal(fsm.state, "petit");
});

test("a pin that arrives after the timer was armed still holds the island", () => {
  opened(1);
  fsm.mouseLeft();
  fsm.pinned = true;
  seconds(600);
  assert.equal(fsm.state, "home");
});

test("the deadline the countdown bar reads follows the delay and clears with the timer", () => {
  opened(15);
  assert.equal(fsm.homeCollapseDueAt, null);
  fsm.mouseLeft();
  const first = fsm.homeCollapseDueAt;
  assert.ok(first != null);
  fsm.homeToPetitDelay = 5;
  assert.ok(fsm.homeCollapseDueAt < first);
  fsm.mouseEntered();
  assert.equal(fsm.homeCollapseDueAt, null);
});

// ── A card folded away while it waits (Mac #290) ─────────────────────────────

test("a folded card keeps the compact island on screen until it is answered", () => {
  fsm.forceHome();
  fsm.pinned = true;
  fsm.forcePetit();
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "petit");
  // Reopening brings it back open, and the mouse leaving does not fold it.
  fsm.mouseEntered();
  fsm.click();
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "home");
  // Answered: the usual timers again.
  fsm.pinned = false;
  fsm.mouseLeft();
  seconds(15);
  assert.equal(fsm.state, "petit");
  fsm.mouseLeft();
  seconds(60);
  assert.equal(fsm.state, "hidden");
});

test("an unusable delay is ignored", () => {
  for (const bad of [NaN, -1, Infinity]) fsm.homeToPetitDelay = bad;
  assert.equal(fsm.homeToPetitDelay, 15);
});

// ── The compact island's − (dismiss) ─────────────────────────────────────────
//
// The island leaves the screen and stays away until something happens: an agent
// starting work, an alert, the tray's Open or a shortcut. Hovering the top of
// the screen is not "something happening" — the pointer crosses it all day.

test("the − takes the island off the screen", () => {
  fsm.mouseEntered();
  fsm.dismiss();
  assert.equal(fsm.state, "hidden");
  assert.equal(fsm.dismissed, true);
});

test("a dismissed island ignores the pointer passing the top of the screen", () => {
  fsm.mouseEntered();
  fsm.dismiss();
  for (const _ of [0, 1, 2]) {
    fsm.mouseEntered();
    seconds(600);
    assert.equal(fsm.state, "hidden");
  }
});

test("open on hover does not defeat a dismissed island either", () => {
  fsm.openOnHover = true;
  fsm.mouseEntered();
  fsm.dismiss();
  fsm.mouseEntered();
  assert.equal(fsm.state, "hidden");
  assert.equal(fsm.openedByHover, false);
});

test("an alert brings a dismissed island back", () => {
  fsm.mouseEntered();
  fsm.dismiss();
  fsm.forceHome();
  assert.equal(fsm.state, "home");
  assert.equal(fsm.dismissed, false);
  // Back to normal: the pointer wakes it again.
  fsm.mouseLeft();
  seconds(15);
  assert.equal(fsm.state, "petit");
});

test("an agent starting work brings a dismissed island back", () => {
  fsm.mouseEntered();
  fsm.dismiss();
  fsm.reveal();
  assert.equal(fsm.state, "petit");
  assert.equal(fsm.dismissed, false);
  seconds(60);
  assert.equal(fsm.state, "hidden");
});

test("the launch greeting brings a dismissed island back", () => {
  fsm.mouseEntered();
  fsm.dismiss();
  fsm.launch();
  assert.equal(fsm.state, "coucou");
  assert.equal(fsm.dismissed, false);
});

test("an explicit close lifts the dismissal, as any ordinary island", () => {
  fsm.mouseEntered();
  fsm.dismiss();
  fsm.forcePetit();
  assert.equal(fsm.state, "petit");
  assert.equal(fsm.dismissed, false);
});

test("Pause lifts the dismissal too: hiding and dismissing are not the same", () => {
  fsm.mouseEntered();
  fsm.dismiss();
  fsm.forceHidden();
  assert.equal(fsm.dismissed, false);
});

// ── A click that missed the island ───────────────────────────────────────────

test("a click outside the open island folds it", () => {
  fsm.forceHome();
  fsm.clickedOutside();
  assert.equal(fsm.state, "petit");
  assert.deepEqual(transitions, ["hidden>home", "home>petit"]);
});

test("a click outside folds a waiting card too, without answering it", () => {
  fsm.forceHome();
  fsm.pinned = true;
  fsm.clickedOutside();
  // Folded, not answered: the card is still waiting (Island.foldApproval).
  assert.equal(fsm.state, "petit");
  assert.equal(fsm.pinned, true);
  // And it stays on screen until it is answered.
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "petit");
});

test("a click outside does nothing when the island is not open", () => {
  fsm.forcePetit();
  fsm.clickedOutside();
  assert.equal(fsm.state, "petit");
  fsm.forceHidden();
  fsm.clickedOutside();
  assert.equal(fsm.state, "hidden");
});

test("folding on a click outside cancels the countdown that was running", () => {
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(14);
  fsm.clickedOutside();
  seconds(600);
  assert.equal(fsm.state, "petit");
});

// ── Open on hover (IslandHoverTests.swift) ────────────────────────────────────

test("open on hover off: hovering only peeks", () => {
  fsm.mouseEntered();
  assert.equal(fsm.state, "petit");
  assert.equal(fsm.openedByHover, false);
});

test("open on hover: hovering opens, leaving folds after the short grace period", () => {
  fsm.openOnHover = true;
  fsm.mouseEntered();
  assert.equal(fsm.state, "home");
  assert.equal(fsm.openedByHover, true);
  fsm.mouseLeft();
  seconds(0.5);
  assert.equal(fsm.state, "home");
  seconds(0.1);
  assert.equal(fsm.state, "petit");
  assert.equal(fsm.openedByHover, false);
  // From the compact island it opens again.
  fsm.mouseEntered();
  assert.equal(fsm.state, "home");
});

test("open on hover: coming back before the grace period keeps it open", () => {
  fsm.openOnHover = true;
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(0.3);
  fsm.mouseEntered();
  seconds(5);
  assert.equal(fsm.state, "home");
});

test("open on hover: a click inside makes it an ordinary open island", () => {
  fsm.openOnHover = true;
  fsm.homeToPetitDelay = 3;
  fsm.mouseEntered();
  fsm.mouseLeft();
  fsm.userInteracted();          // the short countdown becomes the normal one
  seconds(1);
  assert.equal(fsm.state, "home");
  seconds(2);
  assert.equal(fsm.state, "petit");
});

test("open on hover: a waiting card holds the island, hover neither opens nor folds it", () => {
  fsm.openOnHover = true;
  fsm.pinned = true;
  fsm.mouseEntered();
  assert.equal(fsm.state, "petit");
  assert.equal(fsm.openedByHover, false);
  fsm.forceHome();
  fsm.mouseLeft();
  seconds(5);
  assert.equal(fsm.state, "home");
});

test("open on hover: an island opened by an alert keeps the normal delay", () => {
  fsm.openOnHover = true;
  fsm.homeToPetitDelay = 3;
  fsm.forceHome();
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(1);
  assert.equal(fsm.state, "home");
  seconds(2);
  assert.equal(fsm.state, "petit");
});

// ── Stay open / music hold (petitToHidden disabled) ──────────────────────────

test("when stay open is set (0 delay), the compact island never hides after the mouse leaves", () => {
  fsm.homeToPetitDelay = 0;
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(60);
  assert.equal(fsm.state, "petit");
  seconds(600);
  assert.equal(fsm.state, "petit");
});

test("when shouldKeepPetit is true (e.g. music playing), the compact island never hides", () => {
  let musicPlaying = true;
  fsm.shouldKeepPetit = () => musicPlaying;
  fsm.mouseEntered();
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "petit");

  // Stopping music resumes the 60s hide countdown
  musicPlaying = false;
  fsm.syncPetitHold();
  seconds(59);
  assert.equal(fsm.state, "petit");
  seconds(1);
  assert.equal(fsm.state, "hidden");
});

test("dismissing the compact island hides it even when stay open / music is active", () => {
  fsm.homeToPetitDelay = 0;
  fsm.shouldKeepPetit = () => true;
  fsm.mouseEntered();
  fsm.mouseLeft();
  assert.equal(fsm.state, "petit");

  // Manual minimize/dismiss
  fsm.dismiss();
  assert.equal(fsm.state, "hidden");
  assert.equal(fsm.dismissed, true);

  // Hovering top of screen does not bring it back while dismissed
  fsm.mouseEntered();
  assert.equal(fsm.state, "hidden");

  // A new notification/alert arrives: wakes up and clears dismissal
  fsm.forceHome();
  assert.equal(fsm.state, "home");
  assert.equal(fsm.dismissed, false);

  // Closing alert back to compact restores the stay-open behavior
  fsm.forcePetit();
  fsm.mouseLeft();
  seconds(600);
  assert.equal(fsm.state, "petit");
});

