// Agents the island shows. Pill ids are `agent_<id>`. Only Codex and DSH
// get an Allow / Deny card; that set must match `takes_decisions` in the relay.

export interface KnownAgent {
  name: string;
  color: string;
}

export const KNOWN_AGENTS: Record<string, KnownAgent> = {
  dsh: { name: "DeepSeek", color: "#4D6BFE" },
  codex: { name: "Codex", color: "#2DD4BF" },
};

/**
 * Agents whose permission requests get an Allow / Deny card.
 * Must match `takes_decisions` in the relay (hook/src/reply.rs).
 */
export const APPROVAL_AGENTS = new Set(["codex", "dsh"]);

/** Same rule as the relay. "claude" is reserved and never routed. */
export function validateAgent(raw: string | undefined): string | null {
  if (!raw || raw.length > 24 || raw === "claude") return null;
  if (!/^[a-z0-9-]+$/.test(raw)) return null;
  return raw;
}

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function agentColor(id: string): string {
  const known = KNOWN_AGENTS[id];
  if (known) return known.color;
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

export function agentName(id: string): string {
  return KNOWN_AGENTS[id]?.name ?? id;
}
