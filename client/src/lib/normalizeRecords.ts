// Records read from storage are untyped JSON. They may predate a field, arrive from a
// share bundle, or come from a bibliography import that had nothing to put in a
// column. TypeScript cannot help at that boundary: `venue: string` is a promise about
// code, not about disk.
//
// One missing field used to take the whole app down -- `paper.venue.trim()` on a
// record without a venue blanks the screen, and a blank screen has no export button,
// so the user cannot even rescue their library. Everything read from storage is
// filled to shape here instead, once, so nothing downstream has to be defensive.

import type { Collection, Note, Paper, ResearchQuestion, SavedSearch } from "../types";

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const now = () => new Date().toISOString();

export function normalizePaper(raw: any): Paper {
  return {
    ...raw,
    id: str(raw?.id) || `p${Math.random().toString(36).slice(2, 10)}`,
    title: str(raw?.title, "Untitled paper"),
    authors: list<string>(raw?.authors).filter((a) => typeof a === "string"),
    venue: str(raw?.venue),
    abstract: str(raw?.abstract),
    doi: str(raw?.doi),
    tags: list<string>(raw?.tags).filter((t) => typeof t === "string"),
    collectionIds: list<string>(raw?.collectionIds),
    addedAt: str(raw?.addedAt) || now(),
    year: typeof raw?.year === "number" ? raw.year : raw?.year ?? null,
  } as Paper;
}

export function normalizeNote(raw: any): Note {
  const createdAt = str(raw?.createdAt) || str(raw?.updatedAt) || now();
  return {
    ...raw,
    id: str(raw?.id) || `n${Math.random().toString(36).slice(2, 10)}`,
    title: str(raw?.title, "Untitled note"),
    body: str(raw?.body),
    collectionIds: list<string>(raw?.collectionIds),
    createdAt,
    updatedAt: str(raw?.updatedAt) || createdAt,
  } as Note;
}

export function normalizeCollection(raw: any): Collection {
  return {
    ...raw,
    id: str(raw?.id) || `c${Math.random().toString(36).slice(2, 10)}`,
    name: str(raw?.name, "Untitled project"),
    createdAt: str(raw?.createdAt) || now(),
  } as Collection;
}

export function normalizeQuestion(raw: any): ResearchQuestion {
  return {
    ...raw,
    id: str(raw?.id) || `q${Math.random().toString(36).slice(2, 10)}`,
    title: str(raw?.title, "Untitled question"),
    detail: str(raw?.detail),
    linkedPaperIds: list<string>(raw?.linkedPaperIds),
    createdAt: str(raw?.createdAt) || now(),
  } as ResearchQuestion;
}

export function normalizeSavedSearch(raw: any): SavedSearch {
  return {
    ...raw,
    id: str(raw?.id) || `s${Math.random().toString(36).slice(2, 10)}`,
    name: str(raw?.name, "Saved search"),
    query: str(raw?.query),
  } as SavedSearch;
}

/** Drops anything that is not an object, so a corrupt array cannot crash a map(). */
export function normalizeAll<T>(value: unknown, fn: (raw: any) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object").map(fn);
}
