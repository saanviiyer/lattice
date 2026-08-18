// chrome.storage.local wrapper around the pure queue logic in clipping.ts.

import {
  addToQueue,
  removeFromQueue,
  sanitizeQueue,
  toQueued,
} from "./clipping.js";
import type { ClippingPayload, QueuedClipping } from "./types.js";

const KEY = "lattice:queue";

export async function readQueue(): Promise<QueuedClipping[]> {
  const stored = await chrome.storage.local.get(KEY);
  return sanitizeQueue(stored?.[KEY]);
}

async function writeQueue(queue: QueuedClipping[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: queue });
}

export async function enqueue(payload: ClippingPayload): Promise<QueuedClipping> {
  const queued = toQueued(payload);
  const next = addToQueue(await readQueue(), queued);
  await writeQueue(next);
  return queued;
}

export async function dequeue(localId: string): Promise<void> {
  const next = removeFromQueue(await readQueue(), localId);
  await writeQueue(next);
}

export async function queueSize(): Promise<number> {
  return (await readQueue()).length;
}
