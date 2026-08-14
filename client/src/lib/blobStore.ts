// PDF blob storage in IndexedDB. localStorage cannot hold large binary PDFs, so the
// file bytes live here keyed by paper id, while all metadata/annotations/notes/links
// live in the localStorage Repository. Kept deliberately small and promise-based.

const DB_NAME = "lattice";
const DB_VERSION = 1;
const STORE = "pdfs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB."));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB request failed."));
      })
  );
}

// Store a PDF blob for a paper.
export async function putPdf(paperId: string, blob: Blob): Promise<void> {
  await tx("readwrite", (store) => store.put(blob, paperId));
}

// Retrieve a PDF blob, or null if none is stored.
export async function getPdf(paperId: string): Promise<Blob | null> {
  const result = await tx<Blob | undefined>("readonly", (store) => store.get(paperId));
  return result ?? null;
}

// Delete a stored PDF blob (used when a paper is removed).
export async function deletePdf(paperId: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(paperId));
}

// True if a PDF blob exists for this paper.
export async function hasPdf(paperId: string): Promise<boolean> {
  const key = await tx<IDBValidKey | undefined>("readonly", (store) =>
    store.getKey(paperId)
  );
  return key != null;
}
