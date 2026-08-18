// Pure clipping logic: build a normalized payload from a raw capture, validate
// it, and maintain the offline queue as plain array operations. No chrome, no
// DOM, no network here, so this module is fully unit-testable.

import type { ClipInput, ClippingPayload, QueuedClipping } from "./types.js";

function trim(value: string | undefined): string {
  return (value ?? "").trim();
}

// Collapse runs of whitespace and cap the length so an accidental full-page
// selection does not become an enormous excerpt.
export function normalizeExcerpt(value: string | undefined, max = 2000): string {
  const collapsed = trim(value).replace(/\s+/g, " ");
  return collapsed.length > max ? collapsed.slice(0, max).trimEnd() + "…" : collapsed;
}

// A short, dependency-free id for offline queue entries.
export function makeLocalId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Build a normalized payload from a raw capture. The excerpt prefers the user's
// selection, falling back to the page description / first paragraph. The title
// falls back to the URL so a clipping is never nameless.
export function buildClipping(input: ClipInput, now: Date = new Date()): ClippingPayload {
  const url = trim(input.url);
  const title = trim(input.title) || url;
  const excerpt = normalizeExcerpt(input.excerpt) || normalizeExcerpt(input.description);
  return {
    url,
    title,
    excerpt,
    note: trim(input.note),
    collection: trim(input.collection),
    savedAt: now.toISOString(),
  };
}

// Validate a payload before sending or queueing. Returns the list of problems;
// an empty list means the clipping is valid.
export function validateClipping(payload: ClippingPayload): string[] {
  const errors: string[] = [];
  const url = trim(payload.url);
  if (!url) {
    errors.push("A URL is required.");
  } else if (!/^https?:\/\/\S+/i.test(url)) {
    errors.push("URL must start with http:// or https://.");
  }
  if (!trim(payload.title)) errors.push("A title is required.");
  return errors;
}

export function isValidClipping(payload: ClippingPayload): boolean {
  return validateClipping(payload).length === 0;
}

// ---- Offline queue (pure array operations) --------------------------------

export function toQueued(payload: ClippingPayload, localId: string = makeLocalId()): QueuedClipping {
  return { ...payload, localId };
}

// Append a clipping to the queue, replacing any existing entry with the same
// localId so re-enqueueing is idempotent.
export function addToQueue(queue: QueuedClipping[], clipping: QueuedClipping): QueuedClipping[] {
  const rest = queue.filter((c) => c.localId !== clipping.localId);
  return [...rest, clipping];
}

export function removeFromQueue(queue: QueuedClipping[], localId: string): QueuedClipping[] {
  return queue.filter((c) => c.localId !== localId);
}

// Coerce arbitrary stored JSON back into a clean QueuedClipping[], dropping any
// entries that are not usable. Defends against a corrupted chrome.storage value.
export function sanitizeQueue(raw: unknown): QueuedClipping[] {
  if (!Array.isArray(raw)) return [];
  const out: QueuedClipping[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Partial<QueuedClipping>;
    const payload: ClippingPayload = {
      url: trim(c.url),
      title: trim(c.title),
      excerpt: trim(c.excerpt),
      note: trim(c.note),
      collection: trim(c.collection),
      savedAt: trim(c.savedAt) || new Date(0).toISOString(),
    };
    if (!isValidClipping(payload)) continue;
    out.push({ ...payload, localId: trim(c.localId) || makeLocalId() });
  }
  return out;
}
