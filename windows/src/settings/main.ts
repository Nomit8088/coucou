// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type HookStatus, type ShortcutsReport } from "../core/bridge";
import { ensureProviders, newProviderId, urlAllowed } from "../core/providers";
import {
  ISLAND_SHORTCUTS, SHORTCUTS, SHORTCUT_TEXT, activeKeys, displayKeys, duplicates, effective,
  recordPress, type Binding,
} from "../core/shortcuts";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { SOUND_NAMES } from "../core/sound";
import {
  MAX_DECLARED, PILL_CATEGORIES, availablePills, chooseMainPill, isComingSoon, mainPillChoices,
  sanitizeDeclared, toggleDeclared, type PillDefinition,
} from "../core/pills";
import { h, clear } from "../views/dom";
import { agentsSection } from "./agents";
import { colorDot } from "./colors";
import { statusDot } from "./parts";
import {
  LANGUAGES, N_, isRtl, onLanguageChange, resolveLanguage, setLanguage, systemLanguages, t,
} from "../i18n/i18n";

/** Where secrets.rs keeps the keys on this OS. */
const KEY_STORE = navigator.userAgent.includes("Windows")
  ? "Windows Credential Manager"
  : "Secret Service (GNOME Keyring, KWallet)";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

/** A colour was picked for a pill's Mochi (see ./colors.ts): the island follows. */
function pickColor(next: Record<string, string>) {
  settings.pillColors = next;
  void save();
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

// ── Plan usage section ────────────────────────────────────────────────────────

/**
 * Codex's weekly limit in the island's header. Nothing is installed for it:
 * Coucou asks the Codex CLI when the pill shows. Claude Code's status line is
 * not part of this fork.
 */
const PLAN_SETTINGS_TEXT = {
  get codex() { return t("Shows your Codex plan usage (weekly limit and free resets left) in the island's header. Coucou asks the Codex CLI (codex app-server) when the pill shows; nothing is installed. Codex must be signed in with ChatGPT."); },
  get showCodex() { return t("Show Codex plan in the notch"); },
};

function planSection(_status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h("section", {}, h("h2", {}, h("span", { text: t("Plan usage") })), body);

  function draw() {
    body.append(
      h("div", { class: "hint", text: PLAN_SETTINGS_TEXT.codex }),
      h("div", { class: "row" },
        h("label", { text: PLAN_SETTINGS_TEXT.showCodex }),
        toggle(settings.showCodexPlanInNotch, (on) => {
          settings.showCodexPlanInNotch = on;
          void save();
        }),
      ),
    );
  }

  draw();
  return section;
}

// ── Active pills section ──────────────────────────────────────────────────────

/**
 * The tools you use (Mac 0.1.1–0.1.2): pick the main workspace tool, which is
 * always on and takes no slot, and declare the agents and chat providers you
 * want as pills. Services are declared in Integrations below, next to their keys.
 */
function activePillsSection(connected: Record<string, boolean>): HTMLElement {
  const slots = h("div", { class: "hint" });
  const main = h("select", {}) as HTMLSelectElement;
  for (const def of mainPillChoices()) main.append(h("option", { value: def.id, text: def.name }));
  main.addEventListener("change", () => {
    const next = chooseMainPill(settings, main.value);
    if (!next) return;
    settings.mainPill = next.mainPill;
    settings.activeIntegrations = next.activeIntegrations;
    declaredChanged();
  });
  const groups = h("div", { style: "display:flex;flex-direction:column;gap:12px" });

  /** Why a pill would show nothing yet, as on the Mac's row. */
  function hint(def: PillDefinition): string | null {
    if (isComingSoon(def.id)) return t("Coming soon");
    if (def.connect.kind === "hooks" && !connected[def.id]) return t("Hooks not installed");
    if (def.connect.kind === "key" && !connected[def.id]) return t("Key not configured");
    return null;
  }

  function row(def: PillDefinition): HTMLElement {
    const isMain = def.id === settings.mainPill;
    const on = settings.activeIntegrations.includes(def.id);
    const full = !isMain && !on && settings.activeIntegrations.length >= MAX_ACTIVE;
    const el = h("div", { class: full ? "pill-row full" : "pill-row" },
      colorDot(def, "width:10px;height:10px", () => settings.pillColors, pickColor),
      h("span", { class: "name", text: def.name }),
    );
    if (isMain) {
      el.append(h("span", { class: "state", text: t("Main") }));
      return el;
    }
    const why = hint(def);
    el.append(h("span", { class: "state", text: why ?? "" }));
    const sw = h("button", { class: on ? "switch on" : "switch" }) as HTMLButtonElement;
    sw.disabled = full;
    sw.addEventListener("click", () => {
      const next = toggleDeclared(settings, def.id);
      if (!next) return;
      settings.activeIntegrations = next;
      declaredChanged();
    });
    el.append(sw);
    return el;
  }

  function draw() {
    const used = settings.activeIntegrations.length;
    slots.textContent = t("{used}/{max} slots in use — the main tool doesn't take one.", { used, max: MAX_ACTIVE });
    slots.classList.toggle("full", used >= MAX_ACTIVE);
    main.value = settings.mainPill;
    clear(groups);
    for (const cat of PILL_CATEGORIES) {
      if (cat.id === "service") continue;
      const pills = availablePills().filter((p) => p.category === cat.id);
      if (pills.length === 0) continue;
      groups.append(h("div", { class: "pill-group" }, h("h3", { text: t(cat.title) }), ...pills.map(row)));
    }
  }
  declaredViews.push(draw);
  draw();

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Active pills") })),
    h("div", { class: "hint", text: t("Choose the tools you use. Coucou only shows what you declare here.") }),
    slots,
    h("div", { class: "row" }, h("label", { text: t("Main tool") }), main),
    groups,
  );
}

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
  /** What the key needs, shown under its field. */
  hint?: string;
  /** A music pill: the player's Windows media-session id (core/pills.ts). */
  mediaApp?: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: N_("Token"), placeholder: "ghp_…", secret: true }],
    hint: N_("Classic token with the repo scope, or fine-grained with read access to Pull requests, Commit statuses and Actions.") },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: N_("API key"), placeholder: "re_…", secret: true }] },
  { id: "integration_gitlab", name: "GitLab", color: "#FC6D26",
    fields: [
      { key: "gitlab-url", label: N_("Base URL"), placeholder: "https://gitlab.company.com", secret: false },
      { key: "gitlab-token", label: N_("Access token"), placeholder: "glpat-…", secret: true },
    ],
    hint: N_("Sent as PRIVATE-TOKEN. The card lists your open merge requests, reviews, and the default-branch pipeline.") },
  { id: "integration_qqmail", name: "QQ Mail", color: "#12B7F5",
    fields: [
      { key: "qqmail-address", label: N_("Email address"), placeholder: "you@qq.com", secret: false },
      { key: "qqmail-auth-code", label: N_("Authorisation code"), placeholder: "16 characters", secret: true },
    ],
    hint: N_("Turn on IMAP in QQ Mail's settings and paste the 16-character authorisation code it gives you. Coucou only reads your unread count and subjects — it never sends, marks or deletes anything.") },
  // The music pills carry no key: the player is the connection.
  { id: "integration_spotify", name: "Spotify", color: "#1DB954",
    fields: [], mediaApp: "Spotify.exe" },
  { id: "integration_qqmusic", name: "QQ Music", color: "#31C27C",
    fields: [], mediaApp: "QQMusic.exe" },
];

const MAX_ACTIVE = MAX_DECLARED;

/** Everything that shows the declared pills, redrawn when any of them changes. */
const declaredViews: (() => void)[] = [];

function declaredChanged() {
  for (const redraw of declaredViews) redraw();
  void save();
}

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = t("Pick up to {max} pills to show next to Mochi — {used}/{max} in use. Keys are stored in the {store}, never on disk.", { max: MAX_ACTIVE, used, store: KEY_STORE });
  }
  declaredViews.push(updateNote);

  const offered = new Set(availablePills().map((p) => p.id));
  for (const def of INTEGRATIONS.filter((d) => offered.has(d.id))) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) return;
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      declaredChanged();
    });

    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? t("(stored)") : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: t("Save") });
      const dotEl = statusDot(present[field.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? t("(stored)") : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
        } catch {
          dotEl.style.background = "#f5a524";
        }
      });
      rows.append(
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: t(field.label) }),
          input, saveBtn, dotEl,
        ),
      );
    }

    if (def.hint) rows.append(h("div", { class: "hint", text: t(def.hint) }));
    if (def.mediaApp != null) {
      // As on the Mac's row: said only when there is no player to launch.
      const hint = h("div", { class: "hint", style: "padding-top:5px" });
      rows.append(hint);
      void Bridge.spotifyInstalled(def.id).then((ok) => {
        hint.textContent = ok === false ? t("Not installed") : "";
      });
    }

    list.append(
      h("div", { style: "display:flex;gap:12px;align-items:flex-start" },
        h("div", { style: "display:flex;align-items:center;gap:8px;min-width:132px;padding-top:4px" },
          sw,
          colorDot(def, "", () => settings.pillColors, pickColor),
          h("span", { style: "font-size:12.5px", text: def.name }),
        ),
        rows,
      ),
    );
  }

  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: t("Integrations") })), note, list);
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  // Your own sounds: the folder, a reload, and how many are replaced.
  const customCount = h("span", { class: "hint" });
  const countCustom = () =>
    void Bridge.customSounds(SOUND_NAMES).then((own) => {
      const n = own?.length ?? 0;
      customCount.textContent = n > 0 ? t("{0} custom", { 0: n }) : "";
    });
  countCustom();
  const soundsFolder = h("button", { text: t("Open sounds folder"), onclick: () => void Bridge.revealSoundsFolder() });
  const reloadSounds = h("button", {
    text: t("Reload sounds"),
    onclick: () => void Bridge.reloadSounds().then(() => window.setTimeout(countCustom, 300)),
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: t("Main display") }),
    h("option", { value: "cursor", text: t("Display under the cursor") }),
  );
  screen.value = settings.screen;
  void Bridge.listMonitors().then((list) => {
    for (const m of list ?? []) screen.append(h("option", { value: m.key, text: m.label }));
    // Set again now the option exists. A display saved under an older key (moved,
    // resized, or saved before names were kept) is shown by its place or its
    // name; one that is gone shows as the main one.
    const saved = settings.screen;
    const [place, name] = saved.split("|");
    const keys = (list ?? []).map((m) => m.key);
    screen.value =
      keys.find((k) => k === saved) ??
      (saved.startsWith("at:") ? keys.find((k) => k.split("|")[0] === place) : undefined) ??
      (name ? keys.find((k) => k.split("|")[1] === name) : undefined) ??
      saved;
    if (!screen.value) screen.value = "primary";
  });
  screen.addEventListener("change", () => {
    settings.screen = screen.value;
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("General") })),
    h("div", { class: "row" },
      h("label", { text: t("Sound") }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" }, soundsFolder, reloadSounds, customCount),
    h("div", { class: "hint", text: t("Drop a file named like one of Mochi's sounds (finish.wav, approval.mp3, greet.m4a…) in the sounds folder to replace it, then Reload.") }),
    h("div", { class: "row" },
      h("label", { text: t("Open on hover") }),
      toggle(settings.openOnHover, (v) => { settings.openOnHover = v; void save(); }),
    ),
    h("div", { class: "hint", text: t("Hovering the island opens it; it folds again shortly after the pointer leaves. Click inside to keep it open.") }),
    h("div", { class: "row" },
      h("label", { text: t("Auto-close") }),
      autoClose,
      h("span", { class: "hint", text: t("seconds after you leave the island") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Island lives on") }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: t("Launch at startup") }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
    ...recapRows(),
    languageRow(),
  );
}

/**
 * Settings → General → Language, as on the Mac: "System" follows the
 * system's language when Coucou has it (else English), or one of the ten.
 * Both windows and the tray switch in place, without a restart.
 */
function languageRow(): HTMLElement {
  const select = h("select", {}) as HTMLSelectElement;
  select.append(h("option", { value: "", text: t("System") }));
  for (const { code, name } of LANGUAGES) select.append(h("option", { value: code, text: name, lang: code }));
  select.value = LANGUAGES.some((l) => l.code === settings.language) ? settings.language : "";
  select.addEventListener("change", () => {
    settings.language = select.value;
    void save();
    applyLanguage();
  });
  return h("div", { class: "row" }, h("label", { text: t("Language") }), select);
}

// ── Shortcuts section ─────────────────────────────────────────────────────────

const SHORTCUTS_UI = {
  get title() { return t("Shortcuts"); },
  get hint() { return t("Work from any app. Click a shortcut to change it, then press the new keys — Esc cancels, Backspace removes it."); },
  get global() { return t("From anywhere"); },
  get island() { return t("In the open island"); },
  get recording() { return t("Press keys…"); },
  get none() { return t("None"); },
  get reset() { return t("Reset to defaults"); },
  get inUse() { return t("In use by another app"); },
  get duplicate() { return t("Used twice"); },
  get invalid() { return t("Not a valid shortcut"); },
  get unavailable() { return t("Not available"); },
  types: (ch: string) => t("Types “{char}”", { char: ch }),
  typesNote: (keys: string, ch: string) =>
    t("{keys} types “{char}” on your keyboard, so it can't be a shortcut. Pick another key.", { keys, char: ch }),
  get needsModifier() { return t("Hold Ctrl, Alt or the Windows key with it."); },
  get unsupportedKey() { return t("That key can't be used in a shortcut."); },
  get wayland() {
    return t("Your Wayland desktop doesn't let apps listen for keys outside their own windows. Add the shortcuts in your system's keyboard settings instead, with these commands:");
  },
  get noDisplay() { return t("No display server was found, so global shortcuts are off."); },
  get portalPending() {
    return t("Asking your desktop to register the shortcuts. It may show its own window to confirm them.");
  },
  get portalActive() {
    return t("These shortcuts are registered with your desktop. It may ask you to confirm them or to pick other keys; when it says which keys it uses, they show next to each shortcut.");
  },
  get portalFallback() {
    return t("If one doesn't work, you can also add it in your system's keyboard settings with these commands:");
  },
  desktopKeys: (keys: string) => t("Desktop: {keys}", { keys }),
  get refused() { return t("Not set by your desktop"); },
};

function shortcutsSection(initial: ShortcutsReport | null): HTMLElement {
  let report = initial;
  const list = h("div", { class: "shortcut-list" });
  const feedback = h("div", {});
  const blockedNote = h("div", {});

  let stopRecording: (() => void) | null = null;

  function store(id: string, binding: Binding) {
    settings.shortcuts = { ...settings.shortcuts, [id]: binding };
    void save();
  }

  function tagFor(id: string, dups: Set<string>): HTMLElement | null {
    if (dups.has(id)) return h("span", { class: "tag err", text: SHORTCUTS_UI.duplicate });
    const st = report?.actions.find((a) => a.id === id);
    switch (st?.status) {
      case "inUse": return h("span", { class: "tag warn", text: SHORTCUTS_UI.inUse });
      case "duplicate": return h("span", { class: "tag err", text: SHORTCUTS_UI.duplicate });
      case "invalid": return h("span", { class: "tag err", text: SHORTCUTS_UI.invalid });
      case "typesCharacter": return h("span", { class: "tag warn", text: SHORTCUTS_UI.types(st.typed ?? "?") });
      case "unsupported": return h("span", { class: "tag", text: SHORTCUTS_UI.unavailable });
      case "refused": return h("span", { class: "tag warn", text: SHORTCUTS_UI.refused });
      // Wayland: the desktop may run it on other keys than the ones asked for.
      case "active": return st.trigger ? h("span", { class: "tag", text: SHORTCUTS_UI.desktopKeys(st.trigger) }) : null;
      default: return null;
    }
  }

  function record(id: string, binding: Binding, button: HTMLButtonElement) {
    stopRecording?.();
    clear(feedback);
    button.classList.add("recording");
    button.textContent = SHORTCUTS_UI.recording;
    void Bridge.shortcutsSuspend(true);

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const result = recordPress(e);
      switch (result.kind) {
        case "pending":
          return;
        case "keys":
          finish();
          store(id, { keys: result.keys, enabled: true });
          return;
        case "clear":
          finish();
          store(id, { keys: "", enabled: binding.enabled });
          return;
        case "typesCharacter":
          finish();
          feedback.append(h("div", {
            class: "notice warn",
            text: SHORTCUTS_UI.typesNote(displayKeys(result.keys), result.typed),
          }));
          return;
        case "needsModifier":
          feedback.replaceChildren(h("div", { class: "notice warn", text: SHORTCUTS_UI.needsModifier }));
          return;
        case "unsupported":
          feedback.replaceChildren(h("div", { class: "notice warn", text: SHORTCUTS_UI.unsupportedKey }));
          return;
        case "cancel":
          finish();
          return;
      }
    };
    const onBlur = () => finish();

    function finish() {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      stopRecording = null;
      // Takes the global shortcuts back, from what is saved by now.
      void Bridge.shortcutsSuspend(false);
      draw();
    }
    stopRecording = finish;
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
  }

  function draw() {
    clear(list);
    const dups = duplicates(activeKeys(settings.shortcuts));
    for (const d of SHORTCUTS) {
      if (!d.ported) continue;
      const binding = effective(d, settings.shortcuts);
      const keycap = h("button", {
        class: "keycap",
        text: binding.keys ? displayKeys(binding.keys) : SHORTCUTS_UI.none,
      }) as HTMLButtonElement;
      keycap.disabled = !binding.enabled;
      keycap.addEventListener("click", () => record(d.id, binding, keycap));
      const sw = toggle(binding.enabled, (on) => store(d.id, { keys: binding.keys, enabled: on }));
      const tag = binding.enabled ? tagFor(d.id, dups) : null;
      list.append(h("div", { class: binding.enabled ? "row shortcut" : "row shortcut off" },
        sw,
        h("span", { class: "shortcut-name", text: t(SHORTCUT_TEXT[d.id]) }),
        ...(tag ? [tag] : []),
        keycap,
      ));
    }

    clear(blockedNote);
    const commands = (command: string) => {
      const list = h("div", { class: "diff" });
      for (const d of SHORTCUTS) {
        if (d.ported) list.append(h("div", { class: "ctx", text: `${command} ${d.id}` }));
      }
      return list;
    };
    if (report?.portal) {
      // Wayland, through the desktop's GlobalShortcuts portal; the commands
      // stay as a way around a shortcut the desktop didn't take.
      const active = report.portal === "active";
      blockedNote.append(
        h("div", {
          class: active ? "notice ok" : "notice",
          text: active ? SHORTCUTS_UI.portalActive : SHORTCUTS_UI.portalPending,
        }),
        h("div", { class: "hint", text: SHORTCUTS_UI.portalFallback }),
        commands(report.command),
      );
    } else if (report?.blocked === "wayland") {
      blockedNote.append(h("div", { class: "notice warn", text: SHORTCUTS_UI.wayland }), commands(report.command));
    } else if (report?.blocked) {
      blockedNote.append(h("div", { class: "notice warn", text: SHORTCUTS_UI.noDisplay }));
    }
  }

  const islandList = h("div", { class: "shortcut-list" });
  for (const row of ISLAND_SHORTCUTS) {
    islandList.append(h("div", { class: "row shortcut" },
      h("span", { class: "shortcut-name", text: t(row.description) }),
      h("span", { class: "keycap static", text: row.keys }),
    ));
  }

  const reset = h("button", {
    text: SHORTCUTS_UI.reset,
    onclick: () => {
      stopRecording?.();
      settings.shortcuts = {};
      clear(feedback);
      void save();
      draw();
    },
  });

  // The events are listened to once (see main); only the section on screen redraws.
  shortcutsListener = {
    report(fresh) {
      report = fresh;
      if (!stopRecording) draw();
    },
    settingsChanged() {
      if (!stopRecording) draw();
    },
  };

  draw();
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: SHORTCUTS_UI.title })),
    h("div", { class: "hint", text: SHORTCUTS_UI.hint }),
    h("div", { class: "subhead", text: SHORTCUTS_UI.global }),
    list,
    blockedNote,
    feedback,
    h("div", { class: "row" }, reset),
    h("div", { class: "subhead", text: SHORTCUTS_UI.island }),
    islandList,
  );
}

/** Settings → General → Weekly recap. The prefs live with the history in Rust. */
function recapRows(): HTMLElement[] {
  const T = {
    label: t("Weekly recap"),
    keep: t("Keep a history of my coding sessions"),
    clear: t("Clear history"),
    cleared: t("History cleared."),
    about: t("Counts and project names only — never commands, files or prompts. Kept on this computer for 12 weeks."),
  };
  const feedback = h("span", { class: "hint" });
  const sw = toggle(true, (v) => { void Bridge.recapSetEnabled(v); });
  void Bridge.recapPrefs().then((prefs) => {
    if (prefs) sw.classList.toggle("on", prefs.enabled);
  });
  const clearBtn = h("button", {
    class: "danger",
    text: T.clear,
    onclick: async () => {
      clearBtn.disabled = true;
      await Bridge.recapClear();
      feedback.textContent = T.cleared;
      window.setTimeout(() => {
        clearBtn.disabled = false;
        feedback.textContent = "";
      }, 2400);
    },
  }) as HTMLButtonElement;
  return [
    h("div", { class: "row" },
      h("label", { text: T.label }),
      sw,
      h("span", { class: "hint", text: T.keep }),
    ),
    h("div", { class: "row" },
      h("label", {}),
      clearBtn,
      feedback,
    ),
    h("div", { class: "row" },
      h("label", {}),
      h("span", { class: "hint", style: "flex:1 1 0;min-width:0", text: T.about }),
    ),
  ];
}

// ── Language ──────────────────────────────────────────────────────────────────

/** The shortcuts section on screen, told about the events listened to once in main. */
let shortcutsListener: { report(fresh: ShortcutsReport): void; settingsChanged(): void } | null = null;

/**
 * Shows the language Settings asks for. A change redraws the window in place,
 * where it was scrolled to: nothing reloads, nothing is written.
 */
function applyLanguage() {
  setLanguage(resolveLanguage(settings.language, systemLanguages()));
}

function applyDirection() {
  document.documentElement.dir = isRtl() ? "rtl" : "ltr";
  document.title = t("Settings — Coucou");
}

let rendering: Promise<void> | null = null;
let renderAgain = false;

/** Redraws every section from fresh state, keeping the scroll position. */
async function rerender() {
  if (rendering) {
    renderAgain = true;
    return;
  }
  const scroll = document.scrollingElement?.scrollTop ?? 0;
  rendering = render();
  try {
    await rendering;
  } finally {
    rendering = null;
  }
  if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
  if (renderAgain) {
    renderAgain = false;
    await rerender();
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  setLanguage(resolveLanguage(settings.language, systemLanguages()));
  applyDirection();
  onLanguageChange(() => {
    applyDirection();
    void rerender();
  });
  await render();

  void onEvent<ShortcutsReport>("shortcuts-status", (fresh) => shortcutsListener?.report(fresh));
  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
    shortcutsListener?.settingsChanged();
    for (const redraw of declaredViews) redraw();
    applyLanguage();
  });
}

/** Reads what the sections show and draws them all. */
async function render() {
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, planRelayInstalled: false, settingsPath: "", hookPath: "", hookReady: false,
  };
  const agents = await Bridge.agentHooksList();

  const shortcutReport = await Bridge.shortcutsStatus();

  const keys = [
    "github-token", "resend-api-key", "gitlab-url", "gitlab-token",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  // A main pill this build can run, and no pill declared twice.
  settings = { ...settings, ...sanitizeDeclared(settings) };
  const connected: Record<string, boolean> = { ...((await Bridge.agentHooksStatus()) ?? {}) };
  for (const def of availablePills()) {
    if (def.connect.kind === "key") {
      connected[def.id] = present[def.connect.key] ?? (await Bridge.secretPresent(def.connect.key)) ?? false;
    }
  }
  /** A chat provider's key was saved or removed: its pill's row says so at once. */
  const keyChanged = (key: string, on: boolean) => {
    for (const def of availablePills()) {
      if (def.connect.kind === "key" && def.connect.key === key) connected[def.id] = on;
    }
    for (const redraw of declaredViews) redraw();
  };
  const chatKeys: Record<string, boolean> = {};
  for (const provider of ensureProviders(settings.chatProviders)) {
    chatKeys[provider.keyName] = (await Bridge.secretPresent(provider.keyName)) ?? false;
  }

  declaredViews.length = 0;
  shortcutsListener = null;
  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Coucou" }), h("span", { class: "version", text: version })),
    agentsSection(agents),
    planSection(status),
    personalChatSection(chatKeys, keyChanged),
    activePillsSection(connected),
    integrationsSection(present),
    generalSection(),
    shortcutsSection(shortcutReport),
    h("div", {
      class: "hint",
      text: t("No telemetry. Network requests only go to the services you configure yourself."),
    }),
  );
}

void main();

function personalChatSection(present: Record<string, boolean>, keyChanged: (key: string, on: boolean) => void): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Chat providers") })),
    h("div", { class: "hint", text: t("DeepSeek is built in. Add any OpenAI-compatible provider with a name, base URL, key and default model. Keys stay in the system keychain. Chat has no tools.") }),
    body,
  );
  const redraw = () => {
    clear(body);
    settings.chatProviders = ensureProviders(settings.chatProviders);
    for (const provider of settings.chatProviders) {
      body.append(providerRow(provider, present, keyChanged, redraw));
    }
    body.append(h("button", { class: "primary", text: t("Add provider"), onclick: () => {
      settings.chatProviders = [...ensureProviders(settings.chatProviders), {
        id: newProviderId(),
        name: t("Custom"),
        baseUrl: "https://",
        keyName: "",
        defaultModel: "",
        builtin: false,
      }];
      const added = settings.chatProviders[settings.chatProviders.length - 1];
      added.keyName = `chat-${added.id}`;
      void save();
      redraw();
    }}));
    const profile = h("input", {
      value: settings.dshProfile,
      placeholder: "%USERPROFILE%\\.dsh\\profiles\\web",
      style: "flex:1 1 auto;min-width:0",
    }) as HTMLInputElement;
    profile.addEventListener("change", () => {
      settings.dshProfile = profile.value.trim();
      void save();
    });
    body.append(
      h("div", { class: "hint", text: t("DeepSeek Harness profile. Empty uses the web profile. Restart Harness after installing the plugin.") }),
      h("div", { class: "row" }, h("label", { text: t("Profile path") }), profile),
    );
  };
  redraw();
  return section;
}

function providerRow(
  provider: import("../core/providers").ChatProviderConfig,
  present: Record<string, boolean>,
  keyChanged: (key: string, on: boolean) => void,
  redraw: () => void,
): HTMLElement {
  const name = h("input", { value: provider.name, disabled: provider.builtin ? "true" : undefined }) as HTMLInputElement;
  const url = h("input", { value: provider.baseUrl, placeholder: "https://api.example.com/v1" }) as HTMLInputElement;
  const model = h("input", { value: provider.defaultModel, placeholder: "model-id" }) as HTMLInputElement;
  const key = h("input", { type: "password", placeholder: present[provider.keyName] ? "••••••••" : t("API key") }) as HTMLInputElement;
  const save = () => {
    provider.name = provider.builtin ? "DeepSeek" : name.value.trim() || provider.name;
    provider.baseUrl = url.value.trim();
    provider.defaultModel = model.value.trim() || provider.defaultModel;
    if (!urlAllowed(provider.baseUrl)) {
      StateNote(t("The address must use https://, or http:// on this computer."));
      return;
    }
    const idx = settings.chatProviders.findIndex((p) => p.id === provider.id);
    if (idx >= 0) settings.chatProviders[idx] = { ...provider };
    void saveSettings();
  };
  name.addEventListener("change", save);
  url.addEventListener("change", save);
  model.addEventListener("change", save);
  const row = h("div", { style: "display:flex;flex-direction:column;gap:6px" },
    h("div", { class: "row" }, h("label", { text: t("Name") }), name),
    h("div", { class: "row" }, h("label", { text: t("Base URL") }), url),
    h("div", { class: "row" }, h("label", { text: t("Default model") }), model),
    h("div", { class: "row" }, h("label", { text: t("API key") }), key, h("button", { class: "primary", text: t("Save"), onclick: () => {
      const value = key.value.trim();
      if (!value) return;
      void Bridge.secretSet(provider.keyName, value).then(() => {
        present[provider.keyName] = true;
        key.value = "";
        keyChanged(provider.keyName, true);
        save();
      });
    }})),
  );
  if (!provider.builtin) {
    row.append(h("button", { class: "danger", text: t("Remove"), onclick: () => {
      settings.chatProviders = settings.chatProviders.filter((p) => p.id !== provider.id);
      if (settings.chatProvider === provider.id) settings.chatProvider = "deepseek";
      void Bridge.secretClear(provider.keyName);
      void saveSettings();
      redraw();
    }}));
  }
  return row;
}

function StateNote(message: string): void {
  window.alert(message);
}

async function saveSettings(): Promise<void> {
  await save();
}
