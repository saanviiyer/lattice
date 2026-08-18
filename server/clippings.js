// File-backed queue for web clippings sent by the lattice browser extension.
//
// Clippings live in server/data/clippings.json as a flat array. Each entry is a
// pending reference the web app pulls from its Inbox, imports into a collection,
// and then acks (marks imported). This is deliberately simple, single-file, and
// consistent with the app's "local-first" persistence story; a multi-user
// deployment would move this to the same Postgres described in the README.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STORE = path.join(DATA_DIR, "clippings.json");

// Serialize writes so concurrent POSTs cannot clobber each other's read-modify-write.
let writeChain = Promise.resolve();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function readAll() {
  try {
    const raw = await readFile(STORE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    // A corrupted file should not take the whole endpoint down.
    console.error("clippings read error:", err.message);
    return [];
  }
}

async function writeAll(list) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE, JSON.stringify(list, null, 2), "utf8");
}

// Run a read-modify-write atomically with respect to other mutations.
function mutate(fn) {
  const next = writeChain.then(async () => {
    const list = await readAll();
    const { list: updated, result } = await fn(list);
    if (updated) await writeAll(updated);
    return result;
  });
  // Keep the chain alive even if this mutation rejects.
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function str(value, max = 20000) {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

// Normalize an incoming payload into a stored clipping. Returns null if there is
// nothing usable to save (no URL).
export function normalizeIncoming(body, now = new Date()) {
  const url = str(body?.url, 4000).trim();
  if (!url) return null;
  const title = str(body?.title, 2000).trim() || url;
  return {
    id: uid(),
    url,
    title,
    excerpt: str(body?.excerpt).trim(),
    note: str(body?.note, 8000).trim(),
    collection: str(body?.collection, 500).trim(),
    savedAt: str(body?.savedAt, 40).trim() || now.toISOString(),
    receivedAt: now.toISOString(),
    imported: false,
  };
}

export async function addClipping(body) {
  const clipping = normalizeIncoming(body);
  if (!clipping) return null;
  return mutate(async (list) => ({
    list: [...list, clipping],
    result: clipping,
  }));
}

export async function listClippings({ pendingOnly = false } = {}) {
  const list = await readAll();
  return pendingOnly ? list.filter((c) => !c.imported) : list;
}

// Mark a clipping imported (ack). Returns the updated clipping, or null if the
// id is unknown.
export async function markImported(id) {
  return mutate(async (list) => {
    const target = list.find((c) => c.id === id);
    if (!target) return { list: null, result: null };
    const updated = list.map((c) =>
      c.id === id ? { ...c, imported: true, importedAt: new Date().toISOString() } : c
    );
    return { list: updated, result: { ...target, imported: true } };
  });
}

// Remove a clipping outright (a hard clear/ack). Returns true if one was removed.
export async function deleteClipping(id) {
  return mutate(async (list) => {
    const exists = list.some((c) => c.id === id);
    if (!exists) return { list: null, result: false };
    return { list: list.filter((c) => c.id !== id), result: true };
  });
}
