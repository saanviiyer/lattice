// Shared domain types for lattice.

// Metadata as returned by the server (DOI / arXiv / PDF endpoints).
export interface PaperMetadata {
  itemType?: "journalArticle" | "conferencePaper" | "preprint" | "book" | "thesis" | "webpage";
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  abstract: string;
  doi: string;
  url?: string;
  arxivId?: string;
  source: "doi" | "arxiv" | "pdf" | "manual";
  pdfText?: string;
}

export const ITEM_TYPE_LABELS = {
  journalArticle: "Journal article",
  conferencePaper: "Conference paper",
  preprint: "Preprint",
  book: "Book",
  thesis: "Thesis",
  webpage: "Webpage",
} as const;

// ---- Colour coding ----
// One shared palette for papers, notes, and projects, so a colour means the same
// thing everywhere in the app. "none" is the absence of a colour, stored as an
// undefined `color` field rather than a value, so existing records need no migration.
export const LABEL_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

// A saved paper in the library.
export interface Paper extends PaperMetadata {
  id: string;
  tags: string[];
  collectionIds: string[];
  addedAt: string;
  // True when a PDF blob for this paper is stored in IndexedDB (see blobStore).
  hasPdf?: boolean;
  // Companion workflow fields. Optional for backwards compatibility with v1 backups.
  readingStatus?: "inbox" | "reading" | "read";
  priority?: "later" | "next" | "deep-dive";
  takeaway?: string;
  lastOpenedAt?: string;
  favorite?: boolean;
  relatedPaperIds?: string[];
}

// The lifecycle of a line of inquiry. A project should be cheap to start from a
// hunch and cheap to put down again, so "idea" and "parked" are first-class rather
// than something you fake with a naming convention.
export const PROJECT_STATUSES = ["idea", "active", "writing", "parked"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idea",
  active: "Active",
  writing: "Writing up",
  parked: "Parked",
};

// A project: one line of inquiry, holding the papers, notes, and open questions
// that belong to it.
//
// Projects nest: a project with a parentId is a subproject of that parent, to any
// depth. The flat list is the stored form; lib/collectionTree.ts derives the tree,
// the descendants of a project, and the guards that keep the parent links acyclic.
export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  parentId?: string | null;
  color?: LabelColor;
  /**
   * What you think might be true. One sentence, stated so it could turn out to be
   * wrong — the thing that separates a project from a topic.
   */
  premise?: string;
  status?: ProjectStatus;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}

// A normalized rectangle: fractions (0..1) of the page's rendered width/height.
// Storing fractions makes highlights re-anchor correctly at any zoom/scale.
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Highlight {
  id: string;
  paperId: string;
  page: number; // 1-indexed page number
  color: HighlightColor;
  text: string; // the selected text
  note?: string; // an optional note attached to the highlight
  rects: NormRect[]; // one or more normalized rects (multi-line selections)
  createdAt: string;
}

// A standalone or per-paper note. paperId is set for a paper's notes doc.
export interface Note {
  id: string;
  title: string;
  body: string; // Markdown with [[wikilink]] syntax
  paperId?: string; // set when this is a paper's dedicated notes doc
  // The projects this note belongs to. Thinking is evidence too, so a project
  // collects notes alongside the papers rather than only the papers.
  collectionIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchQuestion {
  id: string;
  title: string;
  detail: string;
  status: "open" | "exploring" | "resolved";
  linkedPaperIds: string[];
  // The projects this question belongs to. A question is where a project usually
  // starts, so it files into one directly rather than only through its papers.
  collectionIds?: string[];
  createdAt: string;
  updatedAt: string;
}

// A resolved link edge in the knowledge graph.
export interface LinkEdge {
  sourceId: string; // note id
  targetId: string; // paper id or note id
  kind: "wikilink" | "paper-note" | "related" | "question-paper"; // explicit and implicit knowledge relations
}

// Graph node/edge shapes for the force-directed view.
export type GraphNodeType = "paper" | "note" | "question";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "wikilink" | "paper-note" | "related" | "question-paper";
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
