// The library's records (papers, notes, collections, questions) in IndexedDB.
//
// These used to live in localStorage, whose ~5 MB cap put a hard ceiling of roughly
// 2,000 papers on a library -- and, worse, was enforced by a write that failed
// silently, so everything added past the limit was simply lost. IndexedDB has no
// comparable ceiling and reports its failures.
//
// Reads happen once at boot; the repository keeps the arrays in memory, so every
// caller stays synchronous. Writes are coalesced per key: a bulk import touches the
// papers array hundreds of times, and only the last value matters.

import { tx, RECORD_STORE } from "./blobStore";

export async function readRecord<T>(key: string): Promise<T | undefined> {
  try {
    return await tx<T | undefined>("readonly", (store) => store.get(key), RECORD_STORE);
  } catch {
    return undefined;
  }
}

const pending = new Map<string, unknown>();
let flushing: ReturnType<typeof setTimeout> | null = null;
let onFailure: ((key: string, error: unknown) => void) | null = null;

export function setRecordFailureHandler(fn: ((key: string, error: unknown) => void) | null) {
  onFailure = fn;
}

async function flush(): Promise<void> {
  flushing = null;
  const batch = [...pending.entries()];
  pending.clear();
  for (const [key, value] of batch) {
    try {
      await tx("readwrite", (store) => store.put(value, key), RECORD_STORE);
    } catch (error) {
      onFailure?.(key, error);
    }
  }
}

export function writeRecord(key: string, value: unknown): void {
  // structuredClone detaches the value from the live in-memory array, so a later
  // mutation cannot change what this write is about to store.
  pending.set(key, structuredClone(value));
  if (flushing === null) flushing = setTimeout(flush, 150);
}

/** Force any queued writes out — used before export, share, and on page hide. */
export async function flushRecords(): Promise<void> {
  if (flushing !== null) {
    clearTimeout(flushing);
    flushing = null;
  }
  await flush();
}
