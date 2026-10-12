// Integration cards shown in the overview's left card — DOM ports of
// IntegrationCardView and friends from IslandViewContent.swift.
//
// Cal.com is the one simplification: macOS shows a three-level calendar
// (month → day → booking); here it is the list of upcoming bookings.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { State, type AgentTask } from "../core/state";
import { Bridge } from "../core/bridge";
import { isComingSoon, pillDefinition } from "../core/pills";
import { refreshHookPills } from "../island/integrations";
import { readActivity, readPulse, readStats } from "../core/github";
import { githubDetail, githubPulseCard } from "./github";
import { N_, language, t } from "../i18n/i18n";

/** Same shape as the Swift `timeAgo` computed properties. */
export function timeAgo(value: unknown): string {
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  const diff = (Date.now() - date.getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return t("just now");
  if (diff < 3600) return t("{n}m", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("{n}h", { n: Math.floor(diff / 3600) });
  return t("{n}d", { n: Math.floor(diff / 86400) });
}

function header(color: string, name: string, kind: string, extra?: Node): HTMLElement {
  const row = h("div", { class: "int-head" }, dot(color, 7), h("b", { text: name }), h("span", { text: kind }));
  if (extra) row.append(extra);
  return row;
}

/** Highlighted first row + plain rows, the layout every list card shares. */
function listRow(accent: string, first: boolean, ...children: Node[]): HTMLElement {
  const row = h("div", { class: first ? "int-row first" : "int-row" }, dot(accent, 5), ...children);
  if (first) row.style.background = `${accent}14`;
  return row;
}

function get(id: string): Record<string, unknown> {
  return (State.integrations[id]?.data ?? {}) as Record<string, unknown>;
}

function arr(id: string, key: string): Record<string, unknown>[] {
  const v = get(id)[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

// ── Not configured / idle ─────────────────────────────────────────────────────

const OPEN_URLS: Record<string, string> = {
  integration_resend: "https://resend.com/emails",
  integration_vercel: "https://vercel.com/dashboard",
  integration_github: "https://github.com",
  integration_stripe: "https://dashboard.stripe.com/payments",
  integration_notion: "https://notion.so",
  integration_calcom: "https://app.cal.com/bookings",
  integration_qqmail: "https://wx.mail.qq.com/",
  integration_kingeye: "https://devops.cwoa.net/vteam/",
};

/** IntegrationCardView.statusLabel on macOS. */
export function idleStatus(
  id: string,
  info: { configured: boolean; error: string | null } | undefined,
): { label: string; color: string } {
  if (isComingSoon(id)) return { label: t("Coming soon"), color: "#6B7079" };
  if (info?.error) return { label: info.error, color: "#F4505E" };
  const configured = info?.configured ?? false;
  const def = pillDefinition(id);
  const ok = (label: string) => ({ label, color: "#22C55E" });
  const missing = (label: string) => ({ label, color: "#F4505E" });
  // Pills driven by hooks never have a key: they are connected once the hooks
  // are in place (Mac #183). A session replaces this card; nothing is loading.
  if (def?.connect.kind === "hooks") return configured ? ok(t("Hooks installed")) : missing(t("Hooks not installed"));
  if (def?.connect.kind === "none") return ok(t("Ready · no setup needed"));
  return configured ? ok(t("Connected · loading…")) : missing(t("Key not configured"));
}

function idleCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const info = State.integrations[task.id];
  const configured = info?.configured ?? false;
  const def = pillDefinition(task.id);
  const status = idleStatus(task.id, info);

  const actions = h("div", { class: "int-actions" });
  if (OPEN_URLS[task.id]) {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}d9`,
        text: t("Open {name}", { name: task.name }),
        onclick: () => void Bridge.openUrl(OPEN_URLS[task.id]),
      }),
    );
  }
  const hookPill = def?.connect.kind === "hooks";
  if (isComingSoon(task.id) || def?.connect.kind === "none") {
    // Nothing to set up, and nothing to refresh.
  } else if (configured && hookPill) {
    actions.append(
      h("button", {
        class: "link-btn",
        style: `color:${task.color}d9`,
        text: t("Refresh"),
        // A hook pill has nothing to poll: look at its hooks again instead.
        onclick: () => void refreshHookPills(),
      }),
    );
  } else if (!configured) {
    actions.append(
      h("button", { class: "link-btn", style: "color:#8e939c", text: t("Settings…"), onclick: openSettings }),
    );
  }

  return h(
    "div",
    { class: "int-card" },
    header(task.color, task.name, t(def?.subtitle ?? N_("Integration"))),
    h("div", { class: "int-status" }, dot(status.color, 5), h("span", { text: status.label })),
    actions,
  );
}

// ── Vercel ────────────────────────────────────────────────────────────────────

function vercelCard(onDetail: () => void): HTMLElement {
  const deployments = arr("integration_vercel", "deployments");
  const rows = h("div", { class: "int-rows" });
  deployments.slice(0, 3).forEach((d, i) => {
    const accent = d.state === "READY" ? "#22C55E" : "#F4505E";
    const name = h("span", { class: "int-name", text: String(d.projectName ?? "") });
    const ago = h("span", { class: "int-ago", text: timeAgo(d.createdAt) });
    if (i === 0) {
      const more = h(
        "button",
        { class: "int-more", title: t("Details"), onclick: onDetail },
        svg(ICONS.ellipsis, 8),
      );
      rows.append(listRow(accent, true, name, ago, more));
    } else {
      rows.append(listRow(accent, false, name, ago));
    }
  });
  return h("div", { class: "int-card" }, header("#7C5CFF", "Vercel", t("Deployments")), rows);
}

function vercelDetail(onBack: () => void): HTMLElement {
  const d = arr("integration_vercel", "deployments")[0] ?? {};
  const success = d.state === "READY";
  const accent = success ? "#22C55E" : "#F4505E";
  const status = success ? t("Ready") : d.state === "CANCELED" ? t("Canceled") : t("Error");
  const body = h("div", { class: "int-detail-body" });
  if (d.commitMessage) body.append(h("div", { class: "int-commit", text: String(d.commitMessage) }));
  const meta = h("div", { class: "int-meta" });
  if (d.branch) meta.append(h("span", { text: String(d.branch) }));
  meta.append(h("span", { text: t("{time} ago", { time: timeAgo(d.createdAt) }) }));
  body.append(meta);
  if (d.url) {
    body.append(
      h("button", {
        class: "int-link",
        text: String(d.url),
        onclick: () => void Bridge.openUrl(`https://${d.url}`),
      }),
    );
  }
  return h(
    "div",
    { class: "int-card detail" },
    h(
      "div",
      { class: "int-detail-head" },
      h("button", { class: "int-back", onclick: onBack }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 })),
      dot(accent, 6),
      h("b", { text: String(d.projectName ?? t("Deployment")) }),
      h("span", { class: "int-badge", style: `color:${accent};background:${accent}24`, text: status }),
    ),
    body,
  );
}

// ── Resend ────────────────────────────────────────────────────────────────────

function resendCard(): HTMLElement {
  const emails = arr("integration_resend", "emails");
  const total = get("integration_resend").total;
  const extra =
    total != null
      ? h("span", { class: "int-total" }, h("i", { class: "pulse" }), h("span", { text: String(total) }))
      : undefined;
  const rows = h("div", { class: "int-rows" });
  emails.slice(0, 3).forEach((e, i) => {
    const delivered = e.lastEvent === "delivered";
    const accent = delivered ? "#22C55E" : "#F4505E";
    const to = Array.isArray(e.to) ? String(e.to[0] ?? "?") : "?";
    const short = to.split("@")[0];
    const cells: Node[] = [
      h("span", { class: "int-name", text: short }),
      h("span", { class: "int-ago", text: timeAgo(e.createdAt) }),
    ];
    if (i === 0 && e.subject) cells.push(h("span", { class: "int-sub", text: String(e.subject) }));
    rows.append(listRow(accent, i === 0, ...cells));
  });
  return h("div", { class: "int-card" }, header("#22C55E", "Resend", t("Emails"), extra), rows);
}

// ── GitHub ────────────────────────────────────────────────────────────────────

function statRow(icon: string, color: string, label: string, value: string): HTMLElement {
  return h(
    "div",
    { class: "int-stat" },
    h("i", { class: "int-stat-icon", style: `color:${color}` }, svg(icon, 10)),
    h("span", { class: "int-stat-label", text: label }),
    h("span", { class: "int-stat-value", text: value }),
  );
}

function githubCard(): HTMLElement {
  const d = get("integration_github");
  const stars = Number(d.totalStars ?? 0);
  const repos = Number(d.totalRepos ?? 0);
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return h(
    "div",
    { class: "int-card" },
    header("#F4505E", "GitHub", t("Overview")),
    h(
      "div",
      { class: "int-stats" },
      statRow(ICONS.star, "#F5A524", t("Total stars"), fmt(stars)),
      statRow(ICONS.stack, "#6B7079", t("Repositories"), String(repos)),
    ),
  );
}

// ── Stripe ────────────────────────────────────────────────────────────────────

function stripeCard(): HTMLElement {
  const d = get("integration_stripe");
  const balance = (Number(d.balance ?? 0) / 100).toFixed(2);
  const currency = String(d.currency ?? "eur").toUpperCase();
  const rows = h("div", { class: "int-rows tight" });
  for (const p of arr("integration_stripe", "payments")) {
    const success = p.status === "succeeded";
    const accent = success ? "#22C55E" : "#F4505E";
    rows.append(
      h(
        "div",
        { class: "int-row" },
        dot(accent, 5),
        h("span", { class: "int-name", text: String(p.description ?? t("Payment")) }),
        h("span", {
          class: "int-amount",
          style: "color:#22c55e",
          text: `+${(Number(p.amount ?? 0) / 100).toFixed(2)}`,
        }),
        h("span", { class: "int-ago", text: timeAgo(p.createdAt) }),
      ),
    );
  }
  return h(
    "div",
    { class: "int-card" },
    header("#0570DE", "Stripe", t("Payments")),
    h("div", { class: "int-balance" }, h("span", { text: balance }), h("i", { text: currency })),
    rows,
  );
}

// ── Notion ────────────────────────────────────────────────────────────────────

function notionCard(): HTMLElement {
  const rows = h("div", { class: "int-rows tight" });
  for (const p of arr("integration_notion", "pages").slice(0, 3)) {
    rows.append(
      h(
        "button",
        {
          class: "int-page",
          onclick: () => {
            if (typeof p.url === "string") void Bridge.openUrl(p.url);
          },
        },
        p.emoji
          ? h("span", { class: "int-emoji", text: String(p.emoji) })
          : h("i", { class: "int-emoji" }, svg(ICONS.doc, 9)),
        h("span", { class: "int-name", text: String(p.title ?? t("Untitled")) }),
        h("span", { class: "int-ago", text: timeAgo(p.lastEditedAt) }),
      ),
    );
  }
  return h("div", { class: "int-card" }, header("#E8E8E8", "Notion", t("Recent")), rows);
}

// ── Cal.com ───────────────────────────────────────────────────────────────────

function calcomCard(): HTMLElement {
  const bookings = arr("integration_calcom", "bookings")
    .slice()
    .sort((a, b) => new Date(String(a.start)).getTime() - new Date(String(b.start)).getTime());
  const rows = h("div", { class: "int-rows tight" });
  if (bookings.length === 0) {
    rows.append(h("div", { class: "int-empty", text: t("No calls scheduled") }));
  }
  for (const b of bookings.slice(0, 3)) {
    const when = new Date(String(b.start));
    const day = when.toLocaleDateString(language(), { day: "2-digit", month: "2-digit" });
    const time = when.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
    rows.append(
      h(
        "div",
        { class: "int-row" },
        dot("#C9956A", 4),
        h("span", { class: "int-time", text: `${day} ${time}` }),
        h("span", { class: "int-name", text: String(b.title ?? t("Meeting")) }),
      ),
    );
  }
  return h("div", { class: "int-card" }, header("#C9956A", "Cal.com", t("Schedule")), rows);
}

// ── n8n ───────────────────────────────────────────────────────────────────────

function n8nCard(task: AgentTask, onDetail: () => void, openSettings: () => void): HTMLElement {
  const hasActivity = task.steps.length > 0 && (task.state === "finished" || task.state === "error");
  if (!hasActivity) return idleCard(task, openSettings);
  const success = task.state === "finished";
  const accent = success ? "#22C55E" : "#F4505E";
  return h(
    "div",
    { class: "int-card" },
    header("#F29B38", "n8n", t("Workflow")),
    h(
      "div",
      { class: "int-actions" },
      h(
        "button",
        {
          class: "int-pill",
          style: `background:${accent}1a;border-color:${accent}38`,
          onclick: onDetail,
        },
        dot(accent, 5),
        h("span", { class: "int-name", text: task.steps[0] ?? t("Workflow") }),
        svg(ICONS.ellipsis, 8),
      ),
    ),
  );
}

function n8nDetail(task: AgentTask, onBack: () => void): HTMLElement {
  const success = task.state === "finished";
  const accent = success ? "#22C55E" : "#F4505E";
  const detail = task.steps[1];
  return h(
    "div",
    { class: "int-card detail" },
    h(
      "div",
      { class: "int-detail-head" },
      h("button", { class: "int-back", onclick: onBack }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 })),
      dot(accent, 6),
      h("b", { text: task.steps[0] ?? t("Workflow") }),
      h("span", {
        class: "int-badge",
        style: `color:${accent};background:${accent}24`,
        text: success ? t("Success") : t("Failed"),
      }),
    ),
    detail
      ? h("pre", { class: "int-detail-text", text: detail })
      : h("div", {
          class: "int-status",
          text: success ? t("Completed successfully.") : t("No error details available."),
        }),
  );
}

// ── QQ Mail ───────────────────────────────────────────────────────────────────

const QQMAIL_BLUE = "#12B7F5";
/** The mailbox's web page: a row has no deep link to open instead. */
const QQMAIL_URL = "https://wx.mail.qq.com/";

/** The unseen count, and the newest of them — newest first, as mail reads. */
function qqmailCard(): HTMLElement {
  const d = get("integration_qqmail");
  const unread = Number(d.unread ?? 0);
  const messages = arr("integration_qqmail", "messages").slice().reverse();
  const extra = h("span", { class: "int-total" }, h("i", { class: "pulse" }), h("span", { text: String(unread) }));
  const rows = h("div", { class: "int-rows tight" });
  if (messages.length === 0) {
    rows.append(h("div", { class: "int-empty", text: t("No unread mail") }));
  }
  messages.slice(0, 3).forEach((m, i) => {
    const cells: Node[] = [
      h("span", { class: "int-name", text: String(m.from ?? "") }),
      h("span", { class: "int-ago", text: timeAgo(m.date) }),
    ];
    if (i === 0 && m.subject) cells.push(h("span", { class: "int-sub", text: String(m.subject) }));
    const row = listRow(QQMAIL_BLUE, i === 0, ...cells);
    row.style.cursor = "pointer";
    row.addEventListener("click", () => void Bridge.openUrl(QQMAIL_URL));
    rows.append(row);
  });
  return h("div", { class: "int-card" }, header(QQMAIL_BLUE, "QQ Mail", t("Inbox"), extra), rows);
}

// ── Kingeye (CTeam DevOps) ────────────────────────────────────────────────────

const KINGEYE_BLUE = "#2F6BFF";

let kingeyeTab: "DEMAND" | "BUG" = "DEMAND";

function renderKingeyeList(
  items: Record<string, unknown>[],
  activeTab: "DEMAND" | "BUG",
  container: HTMLElement,
) {
  container.innerHTML = "";
  const filtered = items.filter((i) => i.classify === activeTab);
  if (filtered.length === 0) {
    container.append(h("div", { class: "int-empty", text: t("Nothing here") }));
    return;
  }
  for (const item of filtered) {
    const defect = item.classify === "BUG";
    const accent = defect ? "#F4505E" : KINGEYE_BLUE;
    const number = String(item.number ?? "");
    const title = String(item.title ?? "");
    const state = String(item.state ?? "");
    const url = String(item.url ?? "");

    const stateSpan = state
      ? h("span", {
          style: `font-size:10px;padding:1px 5px;border-radius:4px;background:${accent}18;color:${accent};white-space:nowrap;margin-right:4px;font-weight:500;`,
          text: state,
        })
      : h("span");

    const line = listRow(
      accent,
      false,
      h("span", { class: "int-ago", text: number }),
      stateSpan,
      h("span", { class: "int-name", text: title || t("Nothing here") }),
    );
    if (url) {
      line.style.cursor = "pointer";
      line.addEventListener("click", () => void Bridge.openUrl(url));
    }
    container.append(line);
  }
}

function kingeyeTabBar(
  requirements: number,
  defects: number,
  onSwitch: (tab: "DEMAND" | "BUG") => void,
): HTMLElement {
  const bar = h("div", {
    style: "display:flex;gap:6px;padding:2px 0 6px 0;align-items:center;",
  });

  const makeBtn = (type: "DEMAND" | "BUG", label: string, count: number, color: string) => {
    const active = kingeyeTab === type;
    const el = h("button", {
      type: "button",
      style: active
        ? `background:${color}20;color:${color};font-weight:600;border:1px solid ${color}40;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer;`
        : `background:transparent;color:var(--text-secondary,#888);border:1px solid transparent;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer;`,
      text: `${label} (${count})`,
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      kingeyeTab = type;
      onSwitch(type);
    });
    return el;
  };

  bar.append(
    makeBtn("DEMAND", t("Requirements"), requirements, KINGEYE_BLUE),
    makeBtn("BUG", t("Defects"), defects, "#F4505E"),
  );
  return bar;
}

function kingeyeContent(
  items: Record<string, unknown>[],
  requirements: number,
  defects: number,
  isDetail: boolean,
  openSettings: () => void,
): HTMLElement {
  const info = State.integrations["integration_kingeye"];
  if (!info?.configured) {
    return h(
      "div",
      {
        class: "int-idle",
        style: "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100px;gap:8px;",
      },
      h("span", { style: "color:var(--dim-2);font-size:12px;", text: "未配置个人访问令牌" }),
      h("button", {
        class: "link-btn",
        style: `color:${KINGEYE_BLUE}d9;cursor:pointer;`,
        text: "打开设置",
        onclick: openSettings,
      }),
    );
  }
  if (info.error) {
    return h(
      "div",
      {
        class: "int-idle",
        style: "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100px;gap:8px;padding:0 12px;text-align:center;",
      },
      h("span", { style: "color:#F4505E;font-size:12px;word-break:break-all;", text: info.error }),
      h("button", {
        class: "link-btn",
        style: `color:${KINGEYE_BLUE}d9;cursor:pointer;`,
        text: "检查设置",
        onclick: openSettings,
      }),
    );
  }
  if (!info.loaded) {
    return h(
      "div",
      {
        class: "int-idle",
        style: "display:flex;align-items:center;justify-content:center;height:100px;gap:6px;color:var(--dim-2);font-size:12px;",
      },
      dot(KINGEYE_BLUE, 6),
      h("span", { text: "正在加载 Cteams 数据…" }),
    );
  }

  const hasReqs = items.some((i) => i.classify === "DEMAND");
  const hasBugs = items.some((i) => i.classify === "BUG");
  if (kingeyeTab === "DEMAND" && !hasReqs && hasBugs) {
    kingeyeTab = "BUG";
  } else if (kingeyeTab === "BUG" && !hasBugs && hasReqs) {
    kingeyeTab = "DEMAND";
  }

  const maxH = isDetail ? "185px" : "85px";
  const rows = h("div", {
    class: "int-rows tight",
    style: `max-height:${maxH};overflow-y:auto;overflow-x:hidden;padding-right:2px;`,
  });
  renderKingeyeList(items, kingeyeTab, rows);

  let barEl: HTMLElement;
  const updateTab = (type: "DEMAND" | "BUG") => {
    kingeyeTab = type;
    renderKingeyeList(items, type, rows);
    const newBar = kingeyeTabBar(requirements, defects, updateTab);
    barEl.replaceWith(newBar);
    barEl = newBar;
  };

  barEl = kingeyeTabBar(requirements, defects, updateTab);
  return h("div", { style: "display:flex;flex-direction:column;" }, barEl, rows);
}

/**
 * The counts the task line shows, with Demand/Defect tabs and a scrollable list.
 */
function kingeyeCard(onDetail: () => void, openSettings: () => void): HTMLElement {
  const d = get("integration_kingeye");
  const requirements = Number(d.requirements ?? 0);
  const defects = Number(d.defects ?? 0);
  const items = arr("integration_kingeye", "items");

  const expandBtn = h(
    "button",
    {
      class: "int-toggle-btn",
      title: "展开至大窗口 (Detail)",
      onclick: onDetail,
    },
    svg(ICONS.arrowUpRight, 8, { stroke: 2 }),
    h("span", { text: "展开" }),
  );

  const left = h(
    "div",
    { style: "display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0;" },
    dot(KINGEYE_BLUE, 7),
    h("b", { text: "Cteams" }),
    expandBtn,
  );

  const head = h(
    "div",
    { class: "int-head", style: "display:flex;align-items:center;justify-content:space-between;" },
    left,
  );

  const cardBody = kingeyeContent(items, requirements, defects, false, openSettings);
  return h("div", { class: "int-card" }, head, cardBody);
}

function kingeyeDetail(onBack: () => void, openSettings: () => void): HTMLElement {
  const d = get("integration_kingeye");
  const requirements = Number(d.requirements ?? 0);
  const defects = Number(d.defects ?? 0);
  const items = arr("integration_kingeye", "items");

  const collapseBtn = h(
    "button",
    {
      class: "int-toggle-btn",
      title: "缩小至小窗口 (Esc)",
      onclick: onBack,
    },
    svg(ICONS.chevronLeft, 8, { stroke: 2.2 }),
    h("span", { text: "缩小" }),
  );

  const left = h(
    "div",
    { style: "display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0;" },
    dot(KINGEYE_BLUE, 7),
    h("b", { text: "Cteams" }),
    collapseBtn,
  );

  const collapseIcon = h(
    "button",
    {
      class: "icon-btn",
      title: "缩小至小窗口 (Esc)",
      style: "cursor:pointer;display:inline-flex;align-items:center;flex-shrink:0;",
      onclick: onBack,
    },
    svg(ICONS.chevronUp, 8, { stroke: 2.2 }),
  );

  const head = h(
    "div",
    { class: "int-detail-head", style: "display:flex;align-items:center;justify-content:space-between;" },
    left,
    collapseIcon,
  );

  const cardBody = kingeyeContent(items, requirements, defects, true, openSettings);
  return h("div", { class: "int-card detail" }, head, cardBody);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export interface IntegrationCardHooks {
  detailOpen: boolean;
  openDetail(): void;
  closeDetail(): void;
  openSettings(): void;
}

/** True when this integration has data worth showing instead of the idle card. */
export function hasIntegrationData(id: string): boolean {
  const info = State.integrations[id];
  if (!info || info.error) return false;
  switch (id) {
    case "integration_vercel":
      return arr(id, "deployments").length > 0;
    case "integration_resend":
      return arr(id, "emails").length > 0;
    case "integration_github":
      return get(id).totalRepos != null || readPulse(get(id)) != null;
    case "integration_gitlab":
      return info.loaded;
    case "integration_stripe":
      return info.loaded;
    case "integration_notion":
      return arr(id, "pages").length > 0;
    case "integration_calcom":
      return info.loaded;
    case "integration_qqmail":
      return info.loaded;
    case "integration_kingeye":
      return info.loaded;
    default:
      return false;
  }
}

export function renderIntegrationCard(task: AgentTask, hooks: IntegrationCardHooks): HTMLElement {
  if (task.id === "integration_n8n") {
    const hasActivity = task.steps.length > 0 && (task.state === "finished" || task.state === "error");
    return hooks.detailOpen && hasActivity
      ? n8nDetail(task, hooks.closeDetail)
      : n8nCard(task, hooks.openDetail, hooks.openSettings);
  }
  if (task.id === "integration_vercel" && hasIntegrationData(task.id)) {
    return hooks.detailOpen ? vercelDetail(hooks.closeDetail) : vercelCard(hooks.openDetail);
  }
  if (task.id === "integration_kingeye") {
    return hooks.detailOpen
      ? kingeyeDetail(hooks.closeDetail, hooks.openSettings)
      : kingeyeCard(hooks.openDetail, hooks.openSettings);
  }
  if (!hasIntegrationData(task.id)) return idleCard(task, hooks.openSettings);

  // With the pulse in, GitHub gets the Mac's richer card and its lists.
  if (task.id === "integration_github") {
    const d = get(task.id);
    const pulse = readPulse(d);
    if (pulse) {
      return hooks.detailOpen
        ? githubDetail(pulse, readStats(d), readActivity(d), hooks.closeDetail)
        : githubPulseCard(pulse, readStats(d), readActivity(d), hooks.openDetail);
    }
  }

  switch (task.id) {
    case "integration_resend":
      return resendCard();
    case "integration_gitlab":
      return gitlabCard();
    case "integration_github":
      return githubCard();
    case "integration_stripe":
      return stripeCard();
    case "integration_notion":
      return notionCard();
    case "integration_calcom":
      return calcomCard();
    case "integration_qqmail":
      return qqmailCard();
    default:
      return idleCard(task, hooks.openSettings);
  }
}

function gitlabLine(accent: string, tag: string, title: string, url: string): HTMLElement {
  const line = listRow(
    accent,
    false,
    h("span", { class: "int-ago", text: tag }),
    h("span", { class: "int-name", text: title || t("Nothing here") }),
  );
  if (url) {
    line.style.cursor = "pointer";
    line.addEventListener("click", () => void Bridge.openUrl(url));
  }
  return line;
}

function gitlabCard(): HTMLElement {
  const mine = arr("integration_gitlab", "mine");
  const review = arr("integration_gitlab", "review");
  const pipelines = arr("integration_gitlab", "pipelines");
  const rows = h("div", { class: "int-rows tight" });
  const mr = (tag: string, row: Record<string, unknown> | undefined) => {
    if (!row) return gitlabLine("#6B7079", tag, t("Nothing here"), "");
    const iid = row.iid != null ? `!${row.iid}` : tag;
    return gitlabLine("#FC6D26", iid, String(row.title ?? ""), String(row.url ?? ""));
  };
  rows.append(mr(t("My MRs"), mine[0]), mr(t("To review"), review[0]));
  const pipe = pipelines[0];
  if (!pipe) {
    rows.append(gitlabLine("#6B7079", t("My pipeline"), t("Nothing here"), ""));
  } else {
    const status = String(pipe.status ?? "");
    const accent = status === "success" ? "#22C55E" : status === "failed" ? "#F4505E" : "#FC6D26";
    const title = [status, pipe.project].filter(Boolean).join(" · ");
    rows.append(gitlabLine(accent, t("My pipeline"), title, String(pipe.url ?? "")));
  }
  const extra = mine.length + review.length > 0
    ? h("span", { class: "int-total" }, h("span", { text: String(mine.length + review.length) }))
    : undefined;
  return h("div", { class: "int-card" }, header("#FC6D26", "GitLab", t("Merge requests"), extra), rows);
}

export { clear };
