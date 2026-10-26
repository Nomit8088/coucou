// What's new after an update (whats-new/controller.ts decides when): what this
// version brings — an icon, a title and a line per item. Same left inset as the
// other cards, Mochi on the left.
//
// One step only: the upstream card's "Your Coucou so far" counted Flow
// dictations and transcribed calls, which this fork doesn't have.

import { h, clear, svg } from "./dom";
import { Bridge } from "../core/bridge";
import { washRGBA } from "../core/layout";
import { DEFAULT_REPO } from "../core/updater";
import { Updates } from "../island/update";
import { WHATS_NEW_ICONS } from "../whats-new/icons";
import { WhatsNew } from "../whats-new/controller";
import { iconName, localized, releasePage } from "../whats-new/whats-new";
import type { ViewHost } from "./views";
import { language, t } from "../i18n/i18n";

export function buildWhatsNew(): ViewHost {
  const stack = h("div", { class: "stack whatsnew-stack" });
  const card = h("div", { class: "card wash" }, stack);
  card.style.setProperty("--wash", washRGBA("indigo"));
  const el = h("div", { class: "view" }, card);

  // Rebuilt only when what it shows changes: rebuilding between a mouse-down
  // and a mouse-up would swallow the click.
  let key = "";

  function paint() {
    const release = WhatsNew.release;
    if (!release) return;
    const lang = language();
    const grid = h("div", { class: "whatsnew-items" });
    for (const item of release.items.slice(0, 4)) {
      const title = localized(item.title, lang);
      const detail = localized(item.detail, lang);
      grid.append(
        h("div", { class: "whatsnew-item" },
          h("span", { class: "whatsnew-icon" }, svg(WHATS_NEW_ICONS[iconName(item.icon)], 16, { stroke: 1.8 })),
          h("div", { class: "whatsnew-text" },
            h("div", { class: "whatsnew-item-title", text: title, title }),
            h("div", { class: "whatsnew-item-detail", text: detail, title: detail }),
          ),
        ),
      );
    }
    const repo = Updates.info?.repo ?? DEFAULT_REPO;
    const page = releasePage(repo, release.version);
    stack.append(
      h("div", { class: "title one-line", text: t("You're on Coucou {version}", { version: release.version }) }),
      grid,
      h("div", { class: "actions" },
        h("button", { class: "btn primary", onclick: () => WhatsNew.close() }, h("span", { text: t("OK") })),
        h("button", {
          class: "btn secondary",
          onclick: () => void Bridge.openUrl(page),
        }, h("span", { text: t("All changes") })),
      ),
    );
  }

  return {
    el,
    sync() {
      const next = `${WhatsNew.generation}~${language()}`;
      if (next === key) return;
      key = next;
      clear(stack);
      paint();
    },
  };
}
