// chrome.storage-backed settings. Imports chrome, so not used by unit tests.

import { DEFAULT_SETTINGS, type Settings } from "./types.js";

const KEY = "lattice:settings";

// Strip a trailing slash so we can safely append "/api/...".
export function normalizeBaseUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = (stored?.[KEY] ?? {}) as Partial<Settings>;
  return {
    baseUrl: normalizeBaseUrl(raw.baseUrl || DEFAULT_SETTINGS.baseUrl),
    defaultCollection: (raw.defaultCollection ?? DEFAULT_SETTINGS.defaultCollection).trim(),
  };
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    baseUrl: normalizeBaseUrl(partial.baseUrl ?? current.baseUrl) || DEFAULT_SETTINGS.baseUrl,
    defaultCollection: (partial.defaultCollection ?? current.defaultCollection).trim(),
  };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
