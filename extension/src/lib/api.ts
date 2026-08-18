// Network calls to the lattice server. Kept thin; the service worker owns the
// fetch so page CORS never applies.

import { normalizeBaseUrl } from "./settings.js";
import type { ClippingPayload } from "./types.js";

// POST a clipping to the lattice server. Throws on any non-2xx or network error
// so the caller can fall back to the offline queue.
export async function postClipping(
  baseUrl: string,
  payload: ClippingPayload
): Promise<{ id: string }> {
  const base = normalizeBaseUrl(baseUrl);
  const res = await fetch(`${base}/api/clippings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    clipping?: { id: string };
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Save failed (${res.status})`);
  }
  return { id: data.clipping?.id || "" };
}

// Lightweight reachability probe used to decide whether to flush the queue.
export async function pingServer(baseUrl: string): Promise<boolean> {
  const base = normalizeBaseUrl(baseUrl);
  try {
    const res = await fetch(`${base}/api/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
