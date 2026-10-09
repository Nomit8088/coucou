// Island chat providers: built-in DeepSeek plus OpenAI-compatible servers the
// user adds. Keys stay in the credential store; this module only knows the
// entry name.

import type { Settings } from "./state";

export interface ChatProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  keyName: string;
  defaultModel: string;
  builtin: boolean;
}

export interface ProviderDef {
  id: string;
  name: string;
  accent: string;
  key: string | null;
  urlField: null;
  defaultModel: string;
  prefer: string | null;
  baseUrl: string;
  builtin: boolean;
}

export const DEEPSEEK: ChatProviderConfig = {
  id: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  keyName: "deepseek-api-key",
  defaultModel: "deepseek-chat",
  builtin: true,
};

export function ensureProviders(list: ChatProviderConfig[] | undefined): ChatProviderConfig[] {
  const out = [...(list ?? [])];
  const existing = out.find((p) => p.id === "deepseek");
  if (!existing) out.unshift({ ...DEEPSEEK });
  else {
    existing.builtin = true;
    existing.keyName = DEEPSEEK.keyName;
    if (!existing.name.trim()) existing.name = DEEPSEEK.name;
    if (!existing.baseUrl.trim()) existing.baseUrl = DEEPSEEK.baseUrl;
    if (!existing.defaultModel.trim()) existing.defaultModel = DEEPSEEK.defaultModel;
  }
  return out;
}

export function providerDef(id: string, settings?: Settings): ProviderDef {
  const found = ensureProviders(settings?.chatProviders).find((p) => p.id === id) ?? DEEPSEEK;
  return {
    id: found.id,
    name: found.name,
    accent: found.id === "deepseek" ? "#4D6BFE" : "#10A37F",
    key: found.keyName,
    urlField: null,
    defaultModel: found.defaultModel,
    prefer: found.id === "deepseek" ? "chat" : null,
    baseUrl: found.baseUrl,
    builtin: found.builtin,
  };
}

export function activeModel(settings: Settings): string {
  const p = providerDef(settings.chatProvider, settings);
  return settings.chatModels[p.id] || p.defaultModel;
}

export function withModel(settings: Settings, provider: string, model: string): Settings {
  return { ...settings, chatProvider: provider, chatModels: { ...settings.chatModels, [provider]: model } };
}

/** Chips: a provider appears only when it has a URL and a stored key (or is loopback http). */
export function visibleProviders(settings: Settings, present: Record<string, boolean> = {}): ProviderDef[] {
  return ensureProviders(settings.chatProviders)
    .filter((p) => {
      if (!p.baseUrl.trim()) return false;
      if (present[p.keyName]) return true;
      return isLoopbackHttp(p.baseUrl);
    })
    .map((p) => providerDef(p.id, settings));
}

export function pickModel(provider: ProviderDef, offered: string[], current: string): string | null {
  if (offered.length === 0) return null;
  if (offered.includes(current)) return current;
  const preferred = provider.prefer ? offered.find((id) => id.includes(provider.prefer!)) : undefined;
  if (preferred) return preferred;
  return offered.includes(provider.defaultModel) ? provider.defaultModel : offered[0];
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return h === "0.0.0.0" || h === "::1" || h === "::" || h === "::ffff:127.0.0.1" || h === "::ffff:7f00:1";
}

export function isLoopbackHttp(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export function urlAllowed(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    if (url.username || url.password || !url.hostname) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/** Kept so older settings helpers still type-check. Not used for chat. */
export const CUSTOM_SERVER_KEY = "openai-compatible-key";

export type Exposure = "local" | "remote" | "remote-http" | "invalid";

export function urlExposure(raw: string): Exposure {
  const text = raw.trim();
  if (!text) return "local";
  if (!urlAllowed(text)) return text.startsWith("http:") ? "remote-http" : "invalid";
  if (isLoopbackHttp(text) || isLoopbackHost(safeHost(text))) return "local";
  return text.startsWith("https:") ? "remote" : "remote-http";
}

function safeHost(raw: string): string {
  try { return new URL(raw).hostname; } catch { return ""; }
}

export function newProviderId(): string {
  const n = Math.random().toString(36).slice(2, 10);
  return `c-${n}`.slice(0, 24);
}
