// Default model for a chat provider, discovered from its /v1/models endpoint.
//
// The chat view already offers the same list while you talk; here the choice is
// kept as the provider's default. Nothing is requested until Refresh is clicked:
// opening Settings must not send the API key anywhere on its own. Credentials
// stay in the native client (chat::compat_server reads the keychain itself).

import { Bridge } from "../core/bridge";
import { clear, h } from "../views/dom";
import { t } from "../i18n/i18n";

export interface ModelPicker {
  element: HTMLElement;
}

/**
 * A drop-down of the provider's models plus a Refresh button. `current()` is
 * the model saved now; `save(id)` persists the choice. An unknown id (typed by
 * hand, or written by a newer build) stays in the list rather than vanishing.
 */
export function modelPicker(current: () => string, save: (id: string) => void, providerId: () => string): ModelPicker {
  const select = h("select", { "aria-label": t("Default model") }) as HTMLSelectElement;
  const refresh = h("button", { text: t("Refresh") }) as HTMLButtonElement;
  const feedback = h("div", { class: "hint", role: "status" });
  const element = h("div", {}, h("div", { class: "row" }, select, refresh), feedback);

  let models: string[] = [];
  let loading = false;
  let generation = 0;

  function render() {
    clear(select);
    const choices = new Set(models);
    const active = current();
    if (active) choices.add(active);
    for (const id of choices) select.append(h("option", { value: id, text: id }));
    select.value = active;
    if (!active && choices.size) select.value = [...choices][0];
    refresh.disabled = loading;
    feedback.textContent = loading ? t("Loading models…") : "";
  }

  async function reload() {
    const request = ++generation;
    loading = true;
    feedback.textContent = t("Loading models…");
    refresh.disabled = true;
    try {
      const received = await Bridge.chatModels(providerId());
      if (request !== generation) return;
      models = received.map((m) => m.id);
    } catch (err) {
      if (request !== generation) return;
      feedback.textContent = String(err).replace(/^Error:\s*/, "");
    } finally {
      if (request === generation) {
        loading = false;
        render();
      }
    }
  }

  select.addEventListener("change", () => {
    const id = select.value;
    if (id && id !== current()) save(id);
  });
  refresh.addEventListener("click", () => { if (!refresh.disabled) void reload(); });

  render();
  return { element };
}
