// A user's library was in localStorage before records moved to IndexedDB. Losing it
// on the upgrade would be the worst possible outcome, so the move is tested directly.
import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";

const KEYS = [
  "lattice.papers.v1", "lattice.collections.v1", "lattice.highlights.v1",
  "lattice.notes.v1", "lattice.questions.v1", "lattice.saved-searches.v1",
];

function seedLegacyLibrary() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  store.set("lattice.papers.v1", JSON.stringify([
    { id: "p1", title: "Attention is all you need", authors: ["A"], tags: [], collectionIds: [],
      addedAt: "2024-01-01T00:00:00Z", takeaway: "mine", pdfText: "full text of the paper" },
  ]));
  store.set("lattice.notes.v1", JSON.stringify([
    { id: "n1", title: "Reading log", body: "- point one", collectionIds: [], updatedAt: "2024-01-01T00:00:00Z" },
  ]));
  store.set("lattice.collections.v1", JSON.stringify([{ id: "c1", name: "Transformers" }]));
  return store;
}

describe("moving a library from localStorage to IndexedDB", () => {
  it("carries every record across, and only clears the old copy once they are stored", async () => {
    const store = seedLegacyLibrary();
    const { repo } = await import("../lib/repository");

    await repo.load();

    expect(repo.listPapers().map((p) => p.title)).toEqual(["Attention is all you need"]);
    expect(repo.listNotes().map((n) => n.title)).toEqual(["Reading log"]);
    expect(repo.listCollections().map((c) => c.name)).toEqual(["Transformers"]);
    // The user's own takeaway survives the move.
    expect(repo.listPapers()[0].takeaway).toBe("mine");
    // Full text is reattached from its own store, not lost with the localStorage copy.
    expect(repo.listPapers()[0].pdfText).toBe("full text of the paper");
    // The old copy is gone, so the quota it occupied is returned.
    for (const key of KEYS) expect(store.get(key)).toBeUndefined();
  });

  it("survives a reload: the records come back from IndexedDB, not localStorage", async () => {
    const { readRecord } = await import("../lib/recordStore");
    const papers = await readRecord<any[]>("lattice.papers.v1");
    expect(papers?.[0]?.title).toBe("Attention is all you need");
    // ...and the record written there does not carry the bulky text.
    expect(papers?.[0]?.pdfText).toBeUndefined();
  });
});
