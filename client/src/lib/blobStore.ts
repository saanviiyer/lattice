// PDF blob storage in IndexedDB. localStorage cannot hold large binary PDFs, so the
// file bytes live here keyed by paper id, while all metadata/annotations/notes/links
// live in the localStorage Repository. Kept deliberately small and promise-based.
//
// In the desktop build every write is mirrored to a real file in the workspace folder
// (workspace/pdfs/<id>.pdf) and a read that misses falls back to that file. That makes
// the folder self-contained enough to copy to another machine, and means a cleared
// browser store costs the index rather than the documents.

import { bridge } from "./desktop";

const DB_NAME = "lattice";
// v2 adds the "text" store. Extracted PDF text used to ride along inside the
// localStorage paper record, where it is by far the largest field: 500 papers with
// text needs about 10 MB against a ~5 MB cap, so a library would quietly stop
// saving. It lives here instead, where the quota is measured in hundreds of MB.
// v3 adds "records", which holds the papers/notes/collections/questions arrays.
// localStorage capped the whole library at roughly 2,000 papers even with the text
// removed, because abstracts alone pass 5 MB; IndexedDB has no comparable ceiling.
const DB_VERSION = 3;
const STORE = "pdfs";
export const TEXT_STORE = "text";
export const RECORD_STORE = "records";

// Long enough for a cold disk, short enough that a blocked open is not a dead app.
const OPEN_TIMEOUT_MS = 8000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // An open can block forever rather than failing: another window holding an older
    // version of the database, or a delete still pending, leaves the request simply
    // never firing. Nothing downstream can time that out for us -- the promise would
    // stay unsettled -- so it is bounded here, and the app opens degraded instead of
    // sitting on its loading screen for the rest of the session.
    const settle = setTimeout(() => {
      reject(new Error("Timed out opening local storage. Another lattice window may be open."));
    }, OPEN_TIMEOUT_MS);
    const done = <T,>(fn: (value: T) => void) => (value: T) => {
      clearTimeout(settle);
      fn(value);
    };
    req.onblocked = () =>
      done(reject)(new Error("Local storage is in use by another lattice window."));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(TEXT_STORE)) db.createObjectStore(TEXT_STORE);
      if (!db.objectStoreNames.contains(RECORD_STORE)) db.createObjectStore(RECORD_STORE);
    };
    req.onsuccess = () => done(resolve)(req.result);
    req.onerror = () =>
      done(reject)(req.error || new Error("Failed to open IndexedDB."));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

export function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  storeName: string = STORE
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB request failed."));
      })
  );
}

// Store a PDF blob for a paper.
export async function putPdf(paperId: string, blob: Blob): Promise<void> {
  await tx("readwrite", (store) => store.put(blob, paperId));
  const api = bridge();
  if (!api) return;
  try {
    await api.writePdf(paperId, await blob.arrayBuffer());
  } catch (error) {
    // The blob is already safe in IndexedDB, so a failed mirror is a degraded
    // backup rather than a lost document.
    console.error("lattice: could not mirror a PDF to the workspace folder", error);
  }
}

// Retrieve a PDF blob, or null if none is stored.
export async function getPdf(paperId: string): Promise<Blob | null> {
  const result = await tx<Blob | undefined>("readonly", (store) => store.get(paperId));
  if (result) return result;

  // Desktop only: the workspace folder is the fallback, and repopulates IndexedDB so
  // the next read is local again.
  const api = bridge();
  if (!api) return null;
  try {
    const bytes = await api.readPdf(paperId);
    if (!bytes) return null;
    const blob = new Blob([bytes], { type: "application/pdf" });
    await tx("readwrite", (store) => store.put(blob, paperId));
    return blob;
  } catch {
    return null;
  }
}

// Delete a stored PDF blob (used when a paper is removed).
export async function deletePdf(paperId: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(paperId));
  const api = bridge();
  if (!api) return;
  try {
    await api.deletePdf(paperId);
  } catch (error) {
    console.error("lattice: could not remove a PDF from the workspace folder", error);
  }
}

export async function clearPdfs(): Promise<void> {
  await tx("readwrite", (store) => store.clear());
}

// True if a PDF blob exists for this paper, in IndexedDB or in the workspace folder.
export async function hasPdf(paperId: string): Promise<boolean> {
  const key = await tx<IDBValidKey | undefined>("readonly", (store) =>
    store.getKey(paperId)
  );
  if (key != null) return true;
  const api = bridge();
  if (!api) return false;
  try {
    return (await api.readPdf(paperId)) != null;
  } catch {
    return false;
  }
}


// ---- Extracted PDF text ----
// Kept out of the localStorage record but attached to the in-memory Paper, so every
// synchronous consumer (exports, duplicate scoring, AI context) is unchanged.

export async function putPaperText(paperId: string, text: string): Promise<void> {
  await tx("readwrite", (store) => store.put(text, paperId), TEXT_STORE);
}

export async function deletePaperText(paperId: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(paperId), TEXT_STORE);
}

/** Every stored text, keyed by paper id, for reattaching on boot. */
export async function allPaperText(): Promise<Record<string, string>> {
  try {
    const keys = await tx<IDBValidKey[]>("readonly", (store) => store.getAllKeys(), TEXT_STORE);
    const values = await tx<string[]>("readonly", (store) => store.getAll(), TEXT_STORE);
    const out: Record<string, string> = {};
    keys.forEach((key, index) => {
      if (typeof key === "string" && typeof values[index] === "string") out[key] = values[index];
    });
    return out;
  } catch {
    // A browser with IndexedDB blocked still runs; it just has no full text.
    return {};
  }
}
