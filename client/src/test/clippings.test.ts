import { describe, expect, it } from "vitest";
import {
  clippingToPaperMetadata,
  clippingNoteBody,
  findOrCreateCollection,
  importClipping,
  type Clipping,
} from "../lib/clippings";
import type { Repository } from "../lib/repository";
import type { Collection, Note, Paper, PaperMetadata } from "../types";

function makeClipping(over: Partial<Clipping> = {}): Clipping {
  return {
    id: "c1",
    url: "https://example.com/article",
    title: "A Great Article",
    excerpt: "The opening paragraph.",
    note: "",
    collection: "",
    savedAt: "2026-08-17T12:00:00.000Z",
    receivedAt: "2026-08-17T12:00:01.000Z",
    imported: false,
    ...over,
  };
}

// A tiny in-memory repository covering just the methods importClipping touches.
function fakeRepo() {
  const collections: Collection[] = [];
  const papers: Paper[] = [];
  const notes: Note[] = [];
  let n = 0;
  const id = () => `id${++n}`;
  const repo = {
    listCollections: () => [...collections],
    createCollection: (name: string) => {
      const c: Collection = { id: id(), name, createdAt: "now" };
      collections.push(c);
      return c;
    },
    addPaper: (meta: PaperMetadata, opts?: { collectionIds?: string[] }) => {
      const p: Paper = {
        ...meta,
        id: id(),
        tags: [],
        collectionIds: opts?.collectionIds ?? [],
        addedAt: "now",
      };
      papers.push(p);
      return p;
    },
    createNote: (input: { title: string; body?: string; paperId?: string }) => {
      const note: Note = {
        id: id(),
        title: input.title,
        body: input.body ?? "",
        paperId: input.paperId,
        createdAt: "now",
        updatedAt: "now",
      };
      notes.push(note);
      return note;
    },
  } as unknown as Repository;
  return { repo, collections, papers, notes };
}

describe("clippingToPaperMetadata", () => {
  it("maps a clipping to a manual paper with the excerpt as abstract", () => {
    const meta = clippingToPaperMetadata(makeClipping());
    expect(meta).toMatchObject({
      title: "A Great Article",
      url: "https://example.com/article",
      abstract: "The opening paragraph.",
      source: "manual",
      authors: [],
      year: null,
      doi: "",
    });
  });

  it("falls back to the URL when the title is empty", () => {
    const meta = clippingToPaperMetadata(makeClipping({ title: "  " }));
    expect(meta.title).toBe("https://example.com/article");
  });
});

describe("clippingNoteBody", () => {
  it("includes the note text and the source URL", () => {
    const body = clippingNoteBody(makeClipping({ note: "revisit this" }));
    expect(body).toContain("revisit this");
    expect(body).toContain("Source: https://example.com/article");
  });
});

describe("findOrCreateCollection", () => {
  it("returns undefined for an empty name", () => {
    const { repo, collections } = fakeRepo();
    expect(findOrCreateCollection(repo, "  ")).toBeUndefined();
    expect(collections).toHaveLength(0);
  });

  it("creates a new collection once and reuses it case-insensitively", () => {
    const { repo, collections } = fakeRepo();
    const first = findOrCreateCollection(repo, "Reading list");
    const again = findOrCreateCollection(repo, "reading LIST");
    expect(first).toBe(again);
    expect(collections).toHaveLength(1);
  });
});

describe("importClipping", () => {
  it("imports into the clipping's own collection and attaches a note", () => {
    const { repo, collections, papers, notes } = fakeRepo();
    const paperId = importClipping(
      repo,
      makeClipping({ collection: "Neuro", note: "key result" })
    );
    expect(collections.map((c) => c.name)).toEqual(["Neuro"]);
    const paper = papers.find((p) => p.id === paperId)!;
    expect(paper.collectionIds).toEqual([collections[0].id]);
    expect(paper.source).toBe("manual");
    expect(notes).toHaveLength(1);
    expect(notes[0].paperId).toBe(paperId);
    expect(notes[0].body).toContain("key result");
  });

  it("honors a collection override picked at import time", () => {
    const { repo, collections, papers } = fakeRepo();
    const paperId = importClipping(repo, makeClipping({ collection: "Neuro" }), "Later");
    expect(collections.map((c) => c.name)).toEqual(["Later"]);
    const paper = papers.find((p) => p.id === paperId)!;
    expect(paper.collectionIds).toEqual([collections[0].id]);
  });

  it("imports uncollected and without a note when both are empty", () => {
    const { repo, collections, papers, notes } = fakeRepo();
    const paperId = importClipping(repo, makeClipping({ collection: "", note: "" }), "");
    const paper = papers.find((p) => p.id === paperId)!;
    expect(paper.collectionIds).toEqual([]);
    expect(collections).toHaveLength(0);
    expect(notes).toHaveLength(0);
  });
});
