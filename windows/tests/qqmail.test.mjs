// The QQ Mail pill: the card in src/views/integrations.ts, fed by what the Rust
// poller emits (src-tauri/src/integrations.rs, over the IMAP client in mail.rs,
// whose protocol and header parsing are tested there).

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { sent } from "./tauri.mjs";
import { installFakeDom } from "./fakedom.mjs";
import { DEFAULT_SETTINGS, State } from "../src/core/state.ts";
import { renderIntegrationCard } from "../src/views/integrations.ts";
import { lookup, setLanguage } from "../src/i18n/i18n.ts";

installFakeDom();

const QQMAIL = "integration_qqmail";
const hooks = () => ({ detailOpen: false, openDetail() {}, closeDetail() {}, openSettings() {} });

/** The pill's task, declared in Settings. */
function task() {
  State.loadIntegrationTasks();
  return State.tasks.find((t) => t.id === QQMAIL);
}

function mailbox(data, over = {}) {
  State.integrations[QQMAIL] = { data, error: null, loaded: true, configured: true, ...over };
}

const message = (uid, from, subject, date) => ({ uid, from, subject, date });

beforeEach(() => {
  setLanguage("en");
  State.settings = { ...DEFAULT_SETTINGS, activeIntegrations: [QQMAIL], mainPill: "agent_dsh" };
  State.os = "windows";
  State.tasks = [];
  State.integrations = {};
});

test("a mailbox with no authorisation code asks for one", () => {
  State.integrations[QQMAIL] = { data: {}, error: null, loaded: false, configured: false };
  const card = renderIntegrationCard(task(), hooks());
  assert.match(card.textContent, /QQ Mail.*Integration.*Key not configured/);
  // Both ways out: the settings window, and the mailbox itself.
  assert.match(card.textContent, /Settings…/);
  assert.match(card.textContent, /Open QQ Mail/);
});

test("the card shows the unseen count, newest first", () => {
  mailbox({
    unread: 3,
    messages: [
      message(1, "Older Sender", "Older subject", "Mon, 6 Oct 2025 09:00:00 +0800"),
      message(2, "Newest Sender", "Newest subject", "Mon, 6 Oct 2025 10:00:00 +0800"),
    ],
  });
  const card = renderIntegrationCard(task(), hooks());
  const text = card.textContent;
  assert.match(text, /Inbox/);
  assert.ok(text.includes("3"), "the unseen count");
  // Newest first, and only the first row carries its subject, as Resend's does.
  assert.ok(text.includes("Newest Sender") && text.includes("Newest subject"));
  assert.ok(text.includes("Older Sender"));
  assert.ok(!text.includes("Older subject"), "a row after the first shows its sender only");
  assert.ok(text.indexOf("Newest Sender") < text.indexOf("Older Sender"), "newest first");
  // The first row is the highlighted one, and it opens the mailbox.
  const rows = card.querySelector("int-rows").children;
  assert.equal(rows.length, 2);
  assert.ok(rows[0].classList.contains("first"));
  assert.ok(!rows[1].classList.contains("first"));
  const before = sent("open_url").length;
  rows[0].fire("click");
  assert.deepEqual(sent("open_url").slice(before), [{ url: "https://wx.mail.qq.com/" }]);
});

test("an empty mailbox says so instead of showing the idle card", () => {
  mailbox({ unread: 0, messages: [] });
  const card = renderIntegrationCard(task(), hooks());
  assert.match(card.textContent, /Inbox.*0.*No unread mail/);
});

test("only the three newest are listed", () => {
  mailbox({
    unread: 9,
    messages: [1, 2, 3, 4, 5].map((n) => message(n, `Sender ${n}`, `Subject ${n}`, "Mon, 6 Oct 2025 10:00:00 +0800")),
  });
  const card = renderIntegrationCard(task(), hooks());
  assert.equal(card.querySelector("int-rows").children.length, 3);
  assert.ok(card.textContent.includes("Subject 5"));
  assert.ok(!card.textContent.includes("Subject 2"));
});

test("a refused sign-in is said in one line instead of the list", () => {
  State.integrations[QQMAIL] = {
    data: {}, error: "Sign-in refused — check the authorisation code", loaded: false, configured: true,
  };
  // The line arrives translated: the poller is what looks the key up.
  const card = renderIntegrationCard(task(), hooks());
  assert.match(card.textContent, /QQ Mail.*Sign-in refused — check the authorisation code/);
  assert.ok(!card.textContent.includes("Inbox"), "no list while it cannot read the mailbox");
});
