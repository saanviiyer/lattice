// Shared domain types for lattice.

// Metadata as returned by the server (DOI / arXiv / PDF endpoints).
export interface PaperMetadata {
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

// A saved paper in the library.
export interface Paper extends PaperMetadata {
  id: string;
  tags: string[];
  collectionIds: string[];
  addedAt: string;
  // True when a PDF blob for this paper is stored in IndexedDB (see blobStore).
  hasPdf?: boolean;
}

export interface Collection {
  id: string;
  name: string;
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
  createdAt: string;
  updatedAt: string;
}

// A resolved link edge in the knowledge graph.
export interface LinkEdge {
  sourceId: string; // note id
  targetId: string; // paper id or note id
  kind: "wikilink" | "paper-note"; // wikilink vs the implicit paper<->note relation
}

// Graph node/edge shapes for the force-directed view.
export interface GraphNode {
  id: string;
  label: string;
  type: "paper" | "note";
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "wikilink" | "paper-note";
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
