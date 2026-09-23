// Data-access abstraction. The entire UI talks to `repo` (a Repository) and never
// touches localStorage directly. To move persistence to Supabase later, implement this
// same interface against Postgres/RLS and swap the export — no UI changes required.
// See README "Supabase upgrade path". PDF blobs live in IndexedDB (see blobStore.ts),
// not here.

import { normalizeBrain, type BrainPrefs } from "./researchBrain";
import { normalizePlans, type ResearchPlan } from "./researchPlan";
import type {
  Collection,
  Highlight,
  Note,
  Paper,
  PaperMetadata,
  ResearchQuestion,
  SavedSearch,
} from "../types";
import { canReparent } from "./collectionTree";
import { nextProjectColor } from "./labelColor";
import { mergeImportedMetadata } from "./paperMerge";
import { normalizeArxivId, normalizeDoi } from "./duplicates";
import { putPaperText, deletePaperText, allPaperText } from "./blobStore";
import { readRecord, writeRecord, flushRecords, setRecordFailureHandler } from "./recordStore";
import {
  normalizeAll, normalizePaper, normalizeNote, normalizeCollection,
  normalizeQuestion, normalizeSavedSearch,
} from "./normalizeRecords";

export interface Repository {
  // Papers
  listPapers(): Paper[];
  getPaper(id: string): Paper | undefined;
  addPaper(
    meta: PaperMetadata,
    opts?: { collectionIds?: string[]; tags?: string[]; hasPdf?: boolean }
  ): Paper;
  updatePaper(id: string, patch: Partial<Paper>): void;
  /** Move embedded full text into IndexedDB and reattach what is stored there. */
  syncPaperText(): Promise<number>;
  /** Load the library from IndexedDB. Must resolve before the UI reads anything. */
  load(): Promise<void>;
  deletePaper(id: string): void;
  mergePapers(primaryId: string, duplicateIds: string[]): void;

  // Collections (a.k.a. projects; they nest via parentId)
  listCollections(): Collection[];
  getCollection(id: string): Collection | undefined;
  createCollection(name: string, parentId?: string | null): Collection;
  renameCollection(id: string, name: string): void;
  updateCollection(id: string, patch: Partial<Omit<Collection, "id" | "createdAt">>): void;
  /** Move a project under another, or to the top level with null. */
  moveCollection(id: string, parentId: string | null): void;
  deleteCollection(id: string): void;
  setPaperCollections(paperId: string, collectionIds: string[]): void;
  setNoteCollections(noteId: string, collectionIds: string[]): void;
  setQuestionCollections(questionId: string, collectionIds: string[]): void;

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
  createNote(input: { title: string; body?: string; paperId?: string; collectionIds?: string[] }): Note;
  updateNote(id: string, patch: Partial<Note>): void;
  deleteNote(id: string): void;

  // Research questions (the durable thread that connects reading sessions)
  listQuestions(): ResearchQuestion[];
  createQuestion(input: { title: string; detail?: string; linkedPaperIds?: string[]; collectionIds?: string[] }): ResearchQuestion;
  updateQuestion(id: string, patch: Partial<ResearchQuestion>): void;
  deleteQuestion(id: string): void;

  // Saved structured searches
  listSavedSearches(): SavedSearch[];
  createSavedSearch(name: string, query: string): SavedSearch;
  deleteSavedSearch(id: string): void;

  // The research brain: what the researcher has said about their interests.
  getBrain(): BrainPrefs;
  updateBrain(patch: Partial<BrainPrefs>): BrainPrefs;

  // Proposals with their agent plans
  listPlans(): ResearchPlan[];
  getPlan(id: string): ResearchPlan | undefined;
  /** Insert or replace, stamping updatedAt. */
  savePlan(plan: ResearchPlan): ResearchPlan;
  deletePlan(id: string): void;

  // Complete metadata/annotation/note snapshots for portable backups.
  exportWorkspace(): WorkspaceSnapshot;
  replaceWorkspace(snapshot: WorkspaceSnapshot): void;
}

export interface WorkspaceSnapshot {
  version: 3;
  exportedAt: string;
  papers: Paper[];
  collections: Collection[];
  highlights: Highlight[];
  notes: Note[];
  questions: ResearchQuestion[];
  savedSearches: SavedSearch[];
  /** Added without a version bump: older readers ignore them, older backups lack them. */
  plans?: ResearchPlan[];
  brain?: BrainPrefs;
}

const PAPERS_KEY = "lattice.papers.v1";
const COLLECTIONS_KEY = "lattice.collections.v1";
const HIGHLIGHTS_KEY = "lattice.highlights.v1";
const NOTES_KEY = "lattice.notes.v1";
const QUESTIONS_KEY = "lattice.questions.v1";
const SAVED_SEARCHES_KEY = "lattice.saved-searches.v1";
const PLANS_KEY = "lattice.plans.v1";
const BRAIN_KEY = "lattice.brain.v1";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// localStorage is now read only to migrate a library saved before records moved to
// IndexedDB; nothing is written back to it.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Reported when a save fails so the UI can tell the user their work is not being
// stored. Swallowing this was the worst bug in the app: past the quota, every paper
// added afterwards was lost with no sign anything was wrong.
type StorageFailure = { key: string; quotaExceeded: boolean; error: unknown };

export function setStorageFailureHandler(fn: ((failure: StorageFailure) => void) | null) {
  setRecordFailureHandler(
    fn ? (key, error) => fn({ key, quotaExceeded: isQuotaError(error), error }) : null
  );
}

function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    // Safari reports 22, Firefox 1014, and the modern name is QuotaExceededError.
    return error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014;
  }
  return false;
}

// Two papers are "the same" if they share a DOI, an arXiv id, or a normalized title.
function sameKey(p: PaperMetadata): string {
  if (normalizeDoi(p.doi)) return `doi:${normalizeDoi(p.doi)}`;
  if (normalizeArxivId(p.arxivId)) return `arxiv:${normalizeArxivId(p.arxivId)}`;
  return `title:${(p.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

class LocalStorageRepository implements Repository {
  private papers: Paper[] = normalizeAll(read<unknown[]>(PAPERS_KEY, []), normalizePaper);
  private collections: Collection[] = normalizeAll(read<unknown[]>(COLLECTIONS_KEY, []), normalizeCollection);
  private highlights: Highlight[] = read<Highlight[]>(HIGHLIGHTS_KEY, []);
  private notes: Note[] = normalizeAll(read<unknown[]>(NOTES_KEY, []), normalizeNote);
  private questions: ResearchQuestion[] = normalizeAll(read<unknown[]>(QUESTIONS_KEY, []), normalizeQuestion);
  private savedSearches: SavedSearch[] = normalizeAll(read<unknown[]>(SAVED_SEARCHES_KEY, []), normalizeSavedSearch);
  // Never stored in localStorage, so there is nothing to migrate: they start empty.
  private plans: ResearchPlan[] = [];
  private brain: BrainPrefs = normalizeBrain(null);

  private persistPapers() {
    // pdfText is stripped here and stored in IndexedDB instead. It dominates the
    // record — a library of 500 papers with text needs ~10 MB against a ~5 MB cap —
    // so keeping it out is what lets a real library fit at all.
    writeRecord(
      PAPERS_KEY,
      this.papers.map(({ pdfText: _pdfText, ...rest }) => rest)
    );
  }

  /**
   * Reattach extracted text loaded from IndexedDB. Called once on boot; papers are
   * fully usable before it resolves, they just have no full text until it does.
   */
  /**
   * One-time move of any text still embedded in the localStorage record into
   * IndexedDB, then reattach everything stored there. Existing libraries free the
   * space on first boot; new ones just load their text.
   */
  /**
   * Load the library from IndexedDB, migrating a localStorage library on first run.
   * Until this resolves the repository is empty, so the UI waits on it at boot.
   */
  async load(): Promise<void> {
    const stored = await Promise.all([
      readRecord<Paper[]>(PAPERS_KEY),
      readRecord<Collection[]>(COLLECTIONS_KEY),
      readRecord<Highlight[]>(HIGHLIGHTS_KEY),
      readRecord<Note[]>(NOTES_KEY),
      readRecord<ResearchQuestion[]>(QUESTIONS_KEY),
      readRecord<SavedSearch[]>(SAVED_SEARCHES_KEY),
    ]);
    const [plans, brain] = await Promise.all([readRecord<unknown>(PLANS_KEY), readRecord<unknown>(BRAIN_KEY)]);
    this.plans = normalizePlans(plans);
    this.brain = normalizeBrain(brain);

    if (stored.some((value) => value !== undefined)) {
      const [papers, collections, highlights, notes, questions, savedSearches] = stored;
      // Filled to shape on the way in: a record missing a field it was written
      // before, or arriving from a share bundle, must not reach the UI half-formed.
      this.papers = papers ? normalizeAll(papers, normalizePaper) : this.papers;
      this.collections = collections ? normalizeAll(collections, normalizeCollection) : this.collections;
      this.highlights = highlights ?? this.highlights;
      this.notes = notes ? normalizeAll(notes, normalizeNote) : this.notes;
      this.questions = questions ? normalizeAll(questions, normalizeQuestion) : this.questions;
      this.savedSearches = savedSearches ? normalizeAll(savedSearches, normalizeSavedSearch) : this.savedSearches;
    } else if (this.papers.length || this.notes.length || this.collections.length) {
      // First run after the move: the constructor already read the old localStorage
      // library, so persisting it writes it into IndexedDB.
      this.persistAll();
      await flushRecords();
      // Only drop the old copy once the new one is definitely on disk, so an
      // interrupted migration falls back to localStorage rather than losing the library.
      for (const key of [PAPERS_KEY, COLLECTIONS_KEY, HIGHLIGHTS_KEY, NOTES_KEY, QUESTIONS_KEY, SAVED_SEARCHES_KEY]) {
        try {
          localStorage.removeItem(key);
        } catch {
          // A blocked store is fine; the data is already in IndexedDB.
        }
      }
    }

    await this.syncPaperText();
  }

  private persistAll() {
    this.persistPapers();
    this.persistCollections();
    this.persistHighlights();
    this.persistNotes();
    this.persistQuestions();
    this.persistSavedSearches();
    this.persistPlans();
    this.persistBrain();
  }

  async syncPaperText(): Promise<number> {
    const embedded = this.papers.filter((paper) => paper.pdfText);
    for (const paper of embedded) {
      try {
        await putPaperText(paper.id, paper.pdfText as string);
      } catch {
        // Keep the text on the in-memory record; it is still usable this session.
      }
    }
    if (embedded.length) this.persistPapers(); // rewrites without text, freeing the quota
    return this.hydratePaperText(await allPaperText());
  }

  hydratePaperText(byId: Record<string, string>) {
    let attached = 0;
    this.papers = this.papers.map((paper) => {
      const text = byId[paper.id];
      if (!text || paper.pdfText) return paper;
      attached += 1;
      return { ...paper, pdfText: text };
    });
    return attached;
  }
  private persistCollections() {
    writeRecord(COLLECTIONS_KEY, this.collections);
  }
  private persistHighlights() {
    writeRecord(HIGHLIGHTS_KEY, this.highlights);
  }
  private persistNotes() {
    writeRecord(NOTES_KEY, this.notes);
  }
  private persistQuestions() {
    writeRecord(QUESTIONS_KEY, this.questions);
  }
  private persistSavedSearches() {
    writeRecord(SAVED_SEARCHES_KEY, this.savedSearches);
  }
  private persistPlans() {
    writeRecord(PLANS_KEY, this.plans);
  }
  private persistBrain() {
    writeRecord(BRAIN_KEY, this.brain);
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
      Object.assign(existing, mergeImportedMetadata(existing, meta, opts));
      this.persistPapers();
      return existing;
    }
    const paper: Paper = {
      ...meta,
      itemType: meta.itemType || (meta.source === "arxiv" ? "preprint" : "journalArticle"),
      id: uid(),
      tags: opts.tags || [],
      collectionIds: opts.collectionIds || [],
      addedAt: new Date().toISOString(),
      hasPdf: opts.hasPdf || false,
      readingStatus: "inbox",
      priority: "later",
      favorite: false,
      relatedPaperIds: [],
    };
    this.papers = [paper, ...this.papers];
    this.persistPapers();
    return paper;
  }
  updatePaper(id: string, patch: Partial<Paper>) {
    const p = this.getPaper(id);
    if (!p) return;
    Object.assign(p, patch);
    // Text goes to IndexedDB, since persistPapers deliberately drops it. Fire and
    // forget: the in-memory record already has it, so the UI is correct either way.
    if (typeof patch.pdfText === "string") {
      void putPaperText(id, patch.pdfText).catch(() => {});
    }
    this.persistPapers();
  }
  deletePaper(id: string) {
    void deletePaperText(id).catch(() => {});
    this.papers = this.papers.filter((p) => p.id !== id);
    this.highlights = this.highlights.filter((h) => h.paperId !== id);
    // Detach any paper-notes doc, but keep standalone note content.
    for (const n of this.notes) if (n.paperId === id) n.paperId = undefined;
    for (const question of this.questions) {
      question.linkedPaperIds = question.linkedPaperIds.filter((paperId) => paperId !== id);
    }
    for (const paper of this.papers) {
      paper.relatedPaperIds = (paper.relatedPaperIds || []).filter((paperId) => paperId !== id);
    }
    this.persistPapers();
    this.persistHighlights();
    this.persistNotes();
    this.persistQuestions();
  }
  mergePapers(primaryId: string, duplicateIds: string[]) {
    const primary = this.getPaper(primaryId);
    const duplicates = duplicateIds
      .filter((id) => id !== primaryId)
      .map((id) => this.getPaper(id))
      .filter((paper): paper is Paper => !!paper);
    if (!primary || !duplicates.length) return;

    const statusRank = { inbox: 0, reading: 1, read: 2 } as const;
    const priorityRank = { later: 0, next: 1, "deep-dive": 2 } as const;
    for (const duplicate of duplicates) {
      Object.assign(primary, mergeImportedMetadata(primary, duplicate, {
        collectionIds: duplicate.collectionIds,
        tags: duplicate.tags,
        hasPdf: duplicate.hasPdf,
      }));
      if ((statusRank[duplicate.readingStatus || "inbox"] || 0) > (statusRank[primary.readingStatus || "inbox"] || 0)) {
        primary.readingStatus = duplicate.readingStatus;
      }
      if ((priorityRank[duplicate.priority || "later"] || 0) > (priorityRank[primary.priority || "later"] || 0)) {
        primary.priority = duplicate.priority;
      }
      primary.favorite = primary.favorite || duplicate.favorite;
      primary.takeaway ||= duplicate.takeaway;
      const openedDates = [primary.lastOpenedAt, duplicate.lastOpenedAt].filter((value): value is string => !!value).sort();
      primary.lastOpenedAt = openedDates[openedDates.length - 1];
      primary.relatedPaperIds = Array.from(new Set([
        ...(primary.relatedPaperIds || []),
        ...(duplicate.relatedPaperIds || []),
      ])).filter((id) => id !== primaryId && !duplicates.some((paper) => paper.id === id));
    }

    const duplicateIdSet = new Set(duplicates.map((paper) => paper.id));
    for (const highlight of this.highlights) {
      if (duplicateIdSet.has(highlight.paperId)) highlight.paperId = primaryId;
    }

    let primaryNote = this.notes.find((note) => note.paperId === primaryId);
    for (const duplicate of duplicates) {
      for (const note of this.notes.filter((item) => item.paperId === duplicate.id)) {
        if (!primaryNote) {
          note.paperId = primaryId;
          primaryNote = note;
        } else if (note.id !== primaryNote.id) {
          primaryNote.body = `${primaryNote.body.trim()}\n\n---\n\n## Merged notes: ${duplicate.title}\n\n${note.body.trim()}`.trim();
          primaryNote.updatedAt = new Date().toISOString();
          this.notes = this.notes.filter((item) => item.id !== note.id);
        }
      }
    }

    for (const question of this.questions) {
      if (question.linkedPaperIds.some((id) => duplicateIdSet.has(id))) {
        question.linkedPaperIds = Array.from(new Set([
          ...question.linkedPaperIds.filter((id) => !duplicateIdSet.has(id)),
          primaryId,
        ]));
        question.updatedAt = new Date().toISOString();
      }
    }
    for (const paper of this.papers) {
      if (paper.id === primaryId) continue;
      const related = paper.relatedPaperIds || [];
      if (related.some((id) => duplicateIdSet.has(id))) {
        paper.relatedPaperIds = Array.from(new Set([
          ...related.filter((id) => !duplicateIdSet.has(id)),
          primaryId,
        ])).filter((id) => id !== paper.id);
      }
    }

    this.papers = this.papers.filter((paper) => !duplicateIdSet.has(paper.id));
    this.persistPapers();
    this.persistHighlights();
    this.persistNotes();
    this.persistQuestions();
  }

  // ---- Collections ----
  listCollections() {
    return [...this.collections];
  }
  getCollection(id: string) {
    return this.collections.find((c) => c.id === id);
  }
  createCollection(name: string, parentId: string | null = null) {
    const resolvedParent = parentId && this.getCollection(parentId) ? parentId : null;
    const c: Collection = {
      id: uid(),
      name: name.trim() || "Untitled project",
      createdAt: new Date().toISOString(),
      // A parent that does not exist would hide the new project, so it is dropped.
      parentId: resolvedParent,
      // Colour is assigned on creation rather than left blank, so a project is
      // distinguishable in the tree and on its papers from the moment it exists.
      // It stays editable: this is a starting point, not a decision.
      color: nextProjectColor(this.collections, resolvedParent),
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
  updateCollection(id: string, patch: Partial<Omit<Collection, "id" | "createdAt">>) {
    const c = this.getCollection(id);
    if (!c) return;
    if (patch.parentId !== undefined) {
      this.moveCollection(id, patch.parentId ?? null);
      const { parentId: _ignored, ...rest } = patch;
      if (Object.keys(rest).length === 0) return;
      Object.assign(c, rest);
    } else {
      Object.assign(c, patch);
    }
    this.persistCollections();
  }
  moveCollection(id: string, parentId: string | null) {
    const c = this.getCollection(id);
    if (!c) return;
    // Refuse a move that would put a project inside its own subtree: that branch
    // would become unreachable from the sidebar.
    if (parentId && !canReparent(this.collections, id, parentId)) return;
    c.parentId = parentId && this.getCollection(parentId) ? parentId : null;
    this.persistCollections();
  }
  deleteCollection(id: string) {
    const removed = this.getCollection(id);
    // Subprojects outlive their parent: they move up a level rather than being
    // deleted along with it, so deleting "Thesis" never silently loses "Chapter 1".
    const inheritedParentId = removed?.parentId ?? null;
    this.collections = this.collections.filter((c) => c.id !== id);
    for (const c of this.collections) {
      if (c.parentId === id) c.parentId = inheritedParentId;
    }
    for (const p of this.papers) {
      if (p.collectionIds.includes(id)) {
        p.collectionIds = p.collectionIds.filter((cid) => cid !== id);
      }
    }
    // Notes and questions belong to projects too, so a deleted project has to let
    // go of all three or they keep pointing at something that is gone.
    for (const note of this.notes) {
      if (note.collectionIds?.includes(id)) {
        note.collectionIds = note.collectionIds.filter((cid) => cid !== id);
      }
    }
    for (const question of this.questions) {
      if (question.collectionIds?.includes(id)) {
        question.collectionIds = question.collectionIds.filter((cid) => cid !== id);
      }
    }
    this.persistCollections();
    this.persistPapers();
    this.persistNotes();
    this.persistQuestions();
  }
  setPaperCollections(paperId: string, collectionIds: string[]) {
    const p = this.getPaper(paperId);
    if (!p) return;
    p.collectionIds = this.knownCollectionIds(collectionIds);
    this.persistPapers();
  }
  setNoteCollections(noteId: string, collectionIds: string[]) {
    const note = this.getNote(noteId);
    if (!note) return;
    note.collectionIds = this.knownCollectionIds(collectionIds);
    this.persistNotes();
  }
  setQuestionCollections(questionId: string, collectionIds: string[]) {
    const question = this.questions.find((item) => item.id === questionId);
    if (!question) return;
    question.collectionIds = this.knownCollectionIds(collectionIds);
    this.persistQuestions();
  }
  /** De-duplicated, and with any project that no longer exists dropped. */
  private knownCollectionIds(collectionIds: string[]): string[] {
    return Array.from(new Set(collectionIds)).filter((id) => !!this.getCollection(id));
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
  createNote(input: { title: string; body?: string; paperId?: string; collectionIds?: string[] }) {
    const now = new Date().toISOString();
    const n: Note = {
      id: uid(),
      title: input.title.trim() || "Untitled note",
      body: input.body || "",
      paperId: input.paperId,
      collectionIds: this.knownCollectionIds(input.collectionIds || []),
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

  // ---- Research questions ----
  listQuestions() {
    return [...this.questions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  createQuestion(input: { title: string; detail?: string; linkedPaperIds?: string[]; collectionIds?: string[] }) {
    const now = new Date().toISOString();
    const question: ResearchQuestion = {
      id: uid(),
      title: input.title.trim() || "Untitled question",
      detail: input.detail?.trim() || "",
      status: "open",
      linkedPaperIds: Array.from(new Set(input.linkedPaperIds || [])),
      collectionIds: this.knownCollectionIds(input.collectionIds || []),
      createdAt: now,
      updatedAt: now,
    };
    this.questions = [question, ...this.questions];
    this.persistQuestions();
    return question;
  }
  updateQuestion(id: string, patch: Partial<ResearchQuestion>) {
    const question = this.questions.find((item) => item.id === id);
    if (!question) return;
    Object.assign(question, patch, { updatedAt: new Date().toISOString() });
    question.linkedPaperIds = Array.from(new Set(question.linkedPaperIds));
    this.persistQuestions();
  }
  deleteQuestion(id: string) {
    this.questions = this.questions.filter((item) => item.id !== id);
    this.persistQuestions();
  }

  // ---- Saved searches ----
  listSavedSearches() {
    return [...this.savedSearches];
  }
  createSavedSearch(name: string, query: string) {
    const existing = this.savedSearches.find((search) => search.query === query.trim());
    if (existing) return existing;
    const search: SavedSearch = {
      id: uid(),
      name: name.trim() || query.trim() || "Saved search",
      query: query.trim(),
      createdAt: new Date().toISOString(),
    };
    this.savedSearches = [...this.savedSearches, search];
    this.persistSavedSearches();
    return search;
  }
  deleteSavedSearch(id: string) {
    this.savedSearches = this.savedSearches.filter((search) => search.id !== id);
    this.persistSavedSearches();
  }

  // ---- Research brain ----
  getBrain() {
    return structuredClone(this.brain);
  }
  updateBrain(patch: Partial<BrainPrefs>) {
    this.brain = normalizeBrain({ ...this.brain, ...patch });
    this.persistBrain();
    return this.getBrain();
  }

  // ---- Proposals and agent plans ----
  listPlans() {
    return [...this.plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getPlan(id: string) {
    return this.plans.find((plan) => plan.id === id);
  }
  savePlan(plan: ResearchPlan) {
    const stored = { ...structuredClone(plan), updatedAt: new Date().toISOString() };
    const index = this.plans.findIndex((item) => item.id === plan.id);
    this.plans = index === -1 ? [stored, ...this.plans] : this.plans.map((item, i) => (i === index ? stored : item));
    this.persistPlans();
    return stored;
  }
  deletePlan(id: string) {
    this.plans = this.plans.filter((plan) => plan.id !== id);
    this.persistPlans();
  }

  exportWorkspace(): WorkspaceSnapshot {
    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      papers: structuredClone(this.papers),
      collections: structuredClone(this.collections),
      highlights: structuredClone(this.highlights),
      notes: structuredClone(this.notes),
      questions: structuredClone(this.questions),
      savedSearches: structuredClone(this.savedSearches),
      plans: structuredClone(this.plans),
      brain: structuredClone(this.brain),
    };
  }
  replaceWorkspace(snapshot: WorkspaceSnapshot) {
    this.papers = structuredClone(snapshot.papers);
    this.collections = structuredClone(snapshot.collections);
    this.highlights = structuredClone(snapshot.highlights);
    this.notes = structuredClone(snapshot.notes);
    this.questions = structuredClone(snapshot.questions);
    this.savedSearches = structuredClone(snapshot.savedSearches);
    this.plans = normalizePlans(snapshot.plans);
    this.brain = normalizeBrain(snapshot.brain);
    this.persistPlans();
    this.persistBrain();
    this.persistPapers();
    this.persistCollections();
    this.persistHighlights();
    this.persistNotes();
    this.persistQuestions();
    this.persistSavedSearches();
  }
}

// The single shared instance the UI imports.
export const repo: Repository = new LocalStorageRepository();
