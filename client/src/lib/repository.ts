// Data-access abstraction. The entire UI talks to `repo` (a Repository) and never
// touches localStorage directly. To move persistence to Supabase later, implement this
// same interface against Postgres/RLS and swap the export — no UI changes required.
// See README "Supabase upgrade path". PDF blobs live in IndexedDB (see blobStore.ts),
// not here.

import type {
  Collection,
  Highlight,
  Note,
  Paper,
  PaperMetadata,
} from "../types";

export interface Repository {
  // Papers
  listPapers(): Paper[];
  getPaper(id: string): Paper | undefined;
  addPaper(
    meta: PaperMetadata,
    opts?: { collectionIds?: string[]; tags?: string[]; hasPdf?: boolean }
  ): Paper;
  updatePaper(id: string, patch: Partial<Paper>): void;
  deletePaper(id: string): void;

  // Collections
  listCollections(): Collection[];
  getCollection(id: string): Collection | undefined;
  createCollection(name: string): Collection;
  renameCollection(id: string, name: string): void;
  deleteCollection(id: string): void;
  setPaperCollections(paperId: string, collectionIds: string[]): void;

  // Tags
  setPaperTags(paperId: string, tags: string[]): void;
  allTags(): string[];

  // Highlights (per paper)
  listHighlights(paperId: string): Highlight[];
  addHighlight(h: Omit<Highlight, "id" | "createdAt">): Highlight;
  updateHighlight(id: string, patch: Partial<Highlight>): void;
  deleteHighlight(id: string): void;

  // Notes (standalone + per-paper docs)
  listNotes(): Note[];
  getNote(id: string): Note | undefined;
  getPaperNote(paperId: string): Note | undefined;
  createNote(input: { title: string; body?: string; paperId?: string }): Note;
  updateNote(id: string, patch: Partial<Note>): void;
  deleteNote(id: string): void;
}

const PAPERS_KEY = "lattice.papers.v1";
const COLLECTIONS_KEY = "lattice.collections.v1";
const HIGHLIGHTS_KEY = "lattice.highlights.v1";
const NOTES_KEY = "lattice.notes.v1";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private-mode failures
  }
}

// Two papers are "the same" if they share a DOI, an arXiv id, or a normalized title.
function sameKey(p: PaperMetadata): string {
  if (p.doi) return `doi:${p.doi.toLowerCase()}`;
  if (p.arxivId) return `arxiv:${p.arxivId.toLowerCase()}`;
  return `title:${(p.title || "").toLowerCase().replace(/\s+/g, " ").trim()}`;
}

class LocalStorageRepository implements Repository {
  private papers: Paper[] = read<Paper[]>(PAPERS_KEY, []);
  private collections: Collection[] = read<Collection[]>(COLLECTIONS_KEY, []);
  private highlights: Highlight[] = read<Highlight[]>(HIGHLIGHTS_KEY, []);
  private notes: Note[] = read<Note[]>(NOTES_KEY, []);

  private persistPapers() {
    write(PAPERS_KEY, this.papers);
  }
  private persistCollections() {
    write(COLLECTIONS_KEY, this.collections);
  }
  private persistHighlights() {
    write(HIGHLIGHTS_KEY, this.highlights);
  }
  private persistNotes() {
    write(NOTES_KEY, this.notes);
  }

  // ---- Papers ----
  listPapers() {
    return [...this.papers];
  }
  getPaper(id: string) {
    return this.papers.find((p) => p.id === id);
  }
  addPaper(
    meta: PaperMetadata,
    opts: { collectionIds?: string[]; tags?: string[]; hasPdf?: boolean } = {}
  ) {
    const key = sameKey(meta);
    const existing = this.papers.find((p) => sameKey(p) === key);
    if (existing) {
      const collectionIds = Array.from(
        new Set([...existing.collectionIds, ...(opts.collectionIds || [])])
      );
      const tags = Array.from(new Set([...existing.tags, ...(opts.tags || [])]));
      Object.assign(existing, {
        collectionIds,
        tags,
        pdfText: existing.pdfText || meta.pdfText,
        abstract: existing.abstract || meta.abstract,
        hasPdf: existing.hasPdf || opts.hasPdf || false,
      });
      this.persistPapers();
      return existing;
    }
    const paper: Paper = {
      ...meta,
      id: uid(),
      tags: opts.tags || [],
      collectionIds: opts.collectionIds || [],
      addedAt: new Date().toISOString(),
      hasPdf: opts.hasPdf || false,
    };
    this.papers = [paper, ...this.papers];
    this.persistPapers();
    return paper;
  }
  updatePaper(id: string, patch: Partial<Paper>) {
    const p = this.getPaper(id);
    if (!p) return;
    Object.assign(p, patch);
    this.persistPapers();
  }
  deletePaper(id: string) {
    this.papers = this.papers.filter((p) => p.id !== id);
    this.highlights = this.highlights.filter((h) => h.paperId !== id);
    // Detach any paper-notes doc, but keep standalone note content.
    for (const n of this.notes) if (n.paperId === id) n.paperId = undefined;
    this.persistPapers();
    this.persistHighlights();
    this.persistNotes();
  }

  // ---- Collections ----
  listCollections() {
    return [...this.collections];
  }
  getCollection(id: string) {
    return this.collections.find((c) => c.id === id);
  }
  createCollection(name: string) {
    const c: Collection = {
      id: uid(),
      name: name.trim() || "Untitled collection",
      createdAt: new Date().toISOString(),
    };
    this.collections = [...this.collections, c];
    this.persistCollections();
    return c;
  }
  renameCollection(id: string, name: string) {
    const c = this.getCollection(id);
    if (c) {
      c.name = name.trim() || c.name;
      this.persistCollections();
    }
  }
  deleteCollection(id: string) {
    this.collections = this.collections.filter((c) => c.id !== id);
    for (const p of this.papers) {
      if (p.collectionIds.includes(id)) {
        p.collectionIds = p.collectionIds.filter((cid) => cid !== id);
      }
    }
    this.persistCollections();
    this.persistPapers();
  }
  setPaperCollections(paperId: string, collectionIds: string[]) {
    const p = this.getPaper(paperId);
    if (!p) return;
    p.collectionIds = Array.from(new Set(collectionIds));
    this.persistPapers();
  }

  // ---- Tags ----
  setPaperTags(paperId: string, tags: string[]) {
    const p = this.getPaper(paperId);
    if (!p) return;
    p.tags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
    this.persistPapers();
  }
  allTags() {
    const set = new Set<string>();
    for (const p of this.papers) for (const t of p.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ---- Highlights ----
  listHighlights(paperId: string) {
    return this.highlights
      .filter((h) => h.paperId === paperId)
      .sort((a, b) => (a.page - b.page) || (a.createdAt < b.createdAt ? -1 : 1));
  }
  addHighlight(h: Omit<Highlight, "id" | "createdAt">) {
    const full: Highlight = { ...h, id: uid(), createdAt: new Date().toISOString() };
    this.highlights = [...this.highlights, full];
    this.persistHighlights();
    return full;
  }
  updateHighlight(id: string, patch: Partial<Highlight>) {
    const h = this.highlights.find((x) => x.id === id);
    if (!h) return;
    Object.assign(h, patch);
    this.persistHighlights();
  }
  deleteHighlight(id: string) {
    this.highlights = this.highlights.filter((h) => h.id !== id);
    this.persistHighlights();
  }

  // ---- Notes ----
  listNotes() {
    return [...this.notes];
  }
  getNote(id: string) {
    return this.notes.find((n) => n.id === id);
  }
  getPaperNote(paperId: string) {
    return this.notes.find((n) => n.paperId === paperId);
  }
  createNote(input: { title: string; body?: string; paperId?: string }) {
    const now = new Date().toISOString();
    const n: Note = {
      id: uid(),
      title: input.title.trim() || "Untitled note",
      body: input.body || "",
      paperId: input.paperId,
      createdAt: now,
      updatedAt: now,
    };
    this.notes = [n, ...this.notes];
    this.persistNotes();
    return n;
  }
  updateNote(id: string, patch: Partial<Note>) {
    const n = this.getNote(id);
    if (!n) return;
    Object.assign(n, patch, { updatedAt: new Date().toISOString() });
    this.persistNotes();
  }
  deleteNote(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.persistNotes();
  }
}

// The single shared instance the UI imports.
export const repo: Repository = new LocalStorageRepository();
