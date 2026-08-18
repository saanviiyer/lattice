// Web clippings: fetch the queue the browser extension fills, map each clipping
// into lattice's own paper/collection/note model, and ack it once imported.
//
// The mapping helpers are pure (no fetch, no repo side effects beyond the passed
// repo) so they are unit tested directly.

import type { PaperMetadata } from "../types";
import type { Repository } from "./repository";

// A clipping as stored by the server (GET /api/clippings).
export interface Clipping {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  note: string;
  collection: string;
  savedAt: string;
  receivedAt: string;
  imported: boolean;
}

// A web clipping becomes a "manual" paper: title + URL, with the excerpt as the
// abstract. Authors/year/venue/doi are unknown for a generic web article.
export function clippingToPaperMetadata(c: Clipping): PaperMetadata {
  return {
    title: (c.title || "").trim() || c.url,
    authors: [],
    year: null,
    venue: "",
    abstract: (c.excerpt || "").trim(),
    doi: "",
    url: c.url,
    source: "manual",
  };
}

// Body of the paper-note doc created when a clipping carries a note.
export function clippingNoteBody(c: Clipping): string {
  const lines = [`# Clipped note`, ""];
  if (c.note.trim()) lines.push(c.note.trim(), "");
  lines.push(`Source: ${c.url}`);
  return lines.join("\n");
}

// Find a collection by name (case-insensitive), creating it if absent. Returns
// its id. An empty name yields undefined (the paper is imported uncollected).
export function findOrCreateCollection(repo: Repository, name: string): string | undefined {
  const trimmed = (name || "").trim();
  if (!trimmed) return undefined;
  const existing = repo
    .listCollections()
    .find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  return (existing ?? repo.createCollection(trimmed)).id;
}

// Import a clipping into the repository: create/find the target collection, add
// the paper, and attach the note as the paper's notes doc. `collectionName`
// overrides the clipping's own collection (used when the user picks on import).
// Returns the imported paper's id.
export function importClipping(
  repo: Repository,
  clipping: Clipping,
  collectionName?: string
): string {
  const name = collectionName !== undefined ? collectionName : clipping.collection;
  const collectionId = findOrCreateCollection(repo, name);
  const paper = repo.addPaper(clippingToPaperMetadata(clipping), {
    collectionIds: collectionId ? [collectionId] : [],
  });
  if (clipping.note.trim()) {
    repo.createNote({
      title: `Notes: ${paper.title}`.slice(0, 80),
      body: clippingNoteBody(clipping),
      paperId: paper.id,
    });
  }
  return paper.id;
}

// ---- Server calls ----------------------------------------------------------

export async function fetchPendingClippings(): Promise<Clipping[]> {
  const res = await fetch("/api/clippings?pending=1");
  if (!res.ok) throw new Error(`Could not load clippings (${res.status})`);
  const data = (await res.json()) as { clippings: Clipping[] };
  return data.clippings ?? [];
}

export async function ackClipping(id: string): Promise<void> {
  const res = await fetch(`/api/clippings/${encodeURIComponent(id)}/imported`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Could not update the clipping (${res.status})`);
}

export async function dismissClipping(id: string): Promise<void> {
  const res = await fetch(`/api/clippings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Could not dismiss the clipping (${res.status})`);
}
