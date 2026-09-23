// Thin fetch wrappers around the server API. All calls go through /api, which Vite
// proxies to the Express server in dev and the same origin in production.

import type { Highlight, Paper, PaperMetadata } from "../types";

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export interface Health {
  ok: boolean;
  mockMode: boolean;
  model: string;
  /** Whether the server can draft proposals with Claude. */
  planning?: boolean;
  planModel?: string;
}

export function getHealth(): Promise<Health> {
  return fetch("/api/health").then((r) => r.json());
}

export function metadataByDoi(doi: string): Promise<{ paper: PaperMetadata }> {
  return jsonPost("/api/metadata/doi", { doi });
}

export function metadataByArxiv(id: string): Promise<{ paper: PaperMetadata }> {
  return jsonPost("/api/metadata/arxiv", { id });
}

export interface PdfMetaResult {
  paper: PaperMetadata;
  via: "crossref" | "heuristic";
  filename: string;
  chars: number;
}

export async function metadataFromPdf(file: File): Promise<PdfMetaResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/metadata/pdf", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((data as { error?: string }).error || "Upload failed");
  return data as PdfMetaResult;
}

export interface FetchedPdf {
  blob: Blob;
  /** Where the file actually came from, for the confirmation message. */
  source: string;
  via: string;
}

/**
 * Ask the server for an open-access PDF of a paper that was added by DOI or arXiv
 * id, so the user does not have to go and download it themselves.
 *
 * Rejects when no open-access copy exists — a paywalled paper still needs the
 * user to attach their own file.
 */
export async function fetchOpenAccessPdf(record: {
  doi?: string;
  arxivId?: string;
  url?: string;
}): Promise<FetchedPdf> {
  const res = await fetch("/api/pdf/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doi: record.doi || "",
      arxivId: record.arxivId || "",
      url: record.url || "",
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || "No open-access PDF was found.");
  }
  return {
    blob: await res.blob(),
    source: res.headers.get("X-Lattice-Pdf-Source") || "",
    via: res.headers.get("X-Lattice-Pdf-Via") || "",
  };
}

/** Whether it is even worth asking: a record with no identifier cannot be resolved. */
export function canFetchPdf(record: { doi?: string; arxivId?: string; url?: string }): boolean {
  return !!(record.doi?.trim() || record.arxivId?.trim() || /\.pdf($|\?)/i.test(record.url || ""));
}

export interface ExplainResult {
  mockMode: boolean;
  explanation: string;
}

export function explainHighlight(text: string, context: string): Promise<ExplainResult> {
  return jsonPost<ExplainResult>("/api/ai/explain", { text, context });
}

export interface SynthesizeResult {
  mockMode: boolean;
  note: string;
}

export function synthesizeNote(
  paperTitle: string,
  highlights: Pick<Highlight, "text" | "note" | "page">[]
): Promise<SynthesizeResult> {
  return jsonPost<SynthesizeResult>("/api/ai/synthesize", { paperTitle, highlights });
}

export interface AskLibraryResult {
  mockMode: boolean;
  answer: string;
  sourceIds: string[];
}

export function askLibrary(question: string, papers: Paper[]): Promise<AskLibraryResult> {
  return jsonPost<AskLibraryResult>("/api/ai/ask", {
    question,
    sources: papers.map(({ id, title, authors, year, abstract, takeaway }) => ({
      id, title, authors, year, abstract, takeaway: takeaway || "",
    })),
  });
}

/** A paper the library does not have, reached from papers a project does have. */
export interface SuggestedPaper {
  doi: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  citedByCount: number;
  abstract: string;
  /** Titles of the user's own papers that cite this one -- the justification. */
  because: string[];
  seedCount: number;
}

export interface SuggestResult {
  suggestions: SuggestedPaper[];
  seedsUsed: number;
  unresolved?: string[];
  /**
   * Why the list is empty, when it is. Worth showing: "these preprints have no
   * bibliographies indexed yet" is useful, "no suggestions" is not.
   */
  reason?:
    | "no-identifiers"
    | "not-enough-seeds"
    | "no-citation-data"
    | "no-overlap"
    | "no-candidates";
}

export function suggestPapers(payload: {
  /** weight: how much the researcher has worked with the seed. Optional. */
  seeds: { doi?: string; arxivId?: string; title: string; weight?: number }[];
  exclude: string[];
  limit?: number;
}): Promise<SuggestResult> {
  return jsonPost("/api/suggest", payload);
}

export interface PlanDraftResult {
  /** The model's plan, citations already limited to the papers sent. */
  plan: unknown;
  droppedCitations: number;
  model: string;
}

/** Claude drafts a proposal and agent plan from one project's contents. */
export function draftPlanWithClaude(payload: {
  project: { name: string; premise?: string };
  papers: { id: string; title: string; year: number | null; abstract?: string; takeaway?: string }[];
  questions: { title: string; detail?: string }[];
  notes: { title: string; body: string }[];
  interests: string[];
}): Promise<PlanDraftResult> {
  return jsonPost("/api/plan", payload);
}
