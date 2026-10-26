// The update card, opened by clicking the blue Mochi: "Coucou X is out" with
// Download and install · All changes · Later. Upstream's card also asks the
// one-time question, shows the download's progress and the phases Rust reports;
// this fork's updater is a plain command that returns once the installer has
// started, so the card only says that it is fetching.
//
// Same left inset as the other cards, Mochi on the left.

import { h } from "./dom";
import { washRGBA } from "../core/layout";
import { HOST_OS, platformCapabilities } from "../core/platform";
import { Updates } from "../island/update";
import type { ViewActions, ViewHost } from "./views";
import { language, t } from "../i18n/i18n";

export function buildUpdate(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title one-line" });
  const line = h("div", { class: "sub update-line" });
  const primary = h("button", { class: "btn primary" }, h("span"));
  const changes = h("button", { class: "btn secondary", onclick: () => Updates.openPage() }, h("span"));
  const later = h("button", {
    class: "btn secondary",
    onclick: () => {
      Updates.later();
      actions.collapse();
    },
  }, h("span"));
  const row = h("div", { class: "actions" }, primary, changes, later);
  const stack = h("div", { class: "stack" }, title, line, row);
  stack.style.padding = "4px 16px 4px 116px";
  const card = h("div", { class: "card wash" }, stack);
  card.style.setProperty("--wash", washRGBA("green"));
  const el = h("div", { class: "view" }, card);

  const set = (el2: HTMLElement, text: string) => {
    const span = el2.firstElementChild as HTMLElement | null;
    if (span && span.textContent !== text) span.textContent = text;
  };

  // Only the labels that changed are rewritten: rebuilding the buttons between
  // a mouse-down and a mouse-up would swallow the click.
  let key = "";

  return {
    el,
    sync() {
      const info = Updates.info;
      const next = `${info?.latestVersion ?? ""}~${Updates.installing}~${language()}`;
      if (next === key) return;
      key = next;

      title.textContent = info ? t("Coucou {version} is out", { version: info.latestVersion }) : "";
      title.title = title.textContent;
      line.textContent = info
        ? Updates.installing
          ? t("Downloading installer…")
          : t("You have {version}", { version: info.currentVersion })
        : "";
      line.style.display = line.textContent ? "" : "none";

      const canInstall = !!info?.downloadUrl && platformCapabilities(HOST_OS).directUpdateInstall;
      primary.style.display = canInstall ? "" : "none";
      primary.toggleAttribute("disabled", Updates.installing);
      primary.style.opacity = Updates.installing ? "0.55" : "";
      set(primary, t("Download and install"));
      primary.onclick = () => void Updates.install();

      set(changes, t("All changes"));
      set(later, t("Later"));
      // Nothing to install here (a Mac, or no asset on this release): "All changes" is the way out.
      changes.classList.toggle("primary", !canInstall);
      changes.classList.toggle("secondary", canInstall);
    },
  };
}
