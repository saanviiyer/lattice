// Backlink and knowledge-graph construction from a set of papers and notes.
// Pure functions (no storage, no DOM) so they can be unit-tested and reused by the
// backlinks panel and the force-directed graph view.

import type { GraphData, GraphEdge, GraphNode, Note, Paper } from "../types";
import { normalizeTitle, parseWikilinks } from "./wikilink";

// A lightweight index mapping a normalized title -> node id, for resolving [[links]].
export interface TitleIndex {
  byTitle: Map<string, string>; // normalized title -> id
  labelOf: Map<string, string>; // id -> display label
  typeOf: Map<string, "paper" | "note">; // id -> node type
}

// Build a title index across all papers and notes. Later entries do not overwrite an
// earlier title (first registration wins), so titles resolve deterministically.
export function buildTitleIndex(papers: Paper[], notes: Note[]): TitleIndex {
  const byTitle = new Map<string, string>();
  const labelOf = new Map<string, string>();
  const typeOf = new Map<string, "paper" | "note">();

  const register = (id: string, title: string, type: "paper" | "note") => {
    labelOf.set(id, title);
    typeOf.set(id, type);
    const key = normalizeTitle(title);
    if (key && !byTitle.has(key)) byTitle.set(key, id);
  };

  for (const p of papers) register(p.id, p.title || "Untitled paper", "paper");
  for (const n of notes) register(n.id, n.title || "Untitled note", "note");

  return { byTitle, labelOf, typeOf };
}

// Resolve the wikilinks in a note body to target node ids (unique, self-links dropped).
export function resolveLinks(
  noteId: string,
  body: string,
  index: TitleIndex
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const target of parseWikilinks(body)) {
    const id = index.byTitle.get(normalizeTitle(target));
    if (id && id !== noteId && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

// Every note that links to targetId via a [[wikilink]].
export function backlinksFor(
  targetId: string,
  notes: Note[],
  index: TitleIndex
): Note[] {
  return notes.filter((n) => resolveLinks(n.id, n.body, index).includes(targetId));
}

// Build the full graph: papers + notes as nodes; wikilink edges plus the implicit
// paper<->note relation (a note with paperId is linked to its paper). Edges are
// de-duplicated so a note that both is-attached-to and links a paper yields one edge.
export function buildGraph(papers: Paper[], notes: Note[]): GraphData {
  const index = buildTitleIndex(papers, notes);
  const ids = new Set<string>([...papers.map((p) => p.id), ...notes.map((n) => n.id)]);

  const nodes: GraphNode[] = [
    ...papers.map((p) => ({
      id: p.id,
      label: p.title || "Untitled paper",
      type: "paper" as const,
    })),
    ...notes.map((n) => ({
      id: n.id,
      label: n.title || "Untitled note",
      type: "note" as const,
    })),
  ];

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: string, target: string, kind: GraphEdge["kind"]) => {
    if (source === target) return;
    if (!ids.has(source) || !ids.has(target)) return;
    // Undirected de-dup key so A-B and B-A collapse; keep the first-seen kind.
    const key = [source, target].sort().join("::");
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
  };

  for (const n of notes) {
    if (n.paperId && ids.has(n.paperId)) addEdge(n.id, n.paperId, "paper-note");
    for (const targetId of resolveLinks(n.id, n.body, index)) {
      addEdge(n.id, targetId, "wikilink");
    }
  }

  return { nodes, edges };
}
