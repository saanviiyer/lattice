import type { Paper } from "../types";

const TITLE_STOPWORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]);

export type DuplicateReason = "Same DOI" | "Same arXiv ID" | "Same title" | "Very similar title";

export function normalizeDoi(value = "") {
  return value.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
}

export function normalizeArxivId(value = "") {
  return value.trim().toLowerCase().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "").replace(/\.pdf$/, "").replace(/^arxiv:\s*/, "");
}

function titleTokens(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !TITLE_STOPWORDS.has(token));
}

function titleSimilarity(a: string, b: string) {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / (left.size + right.size - shared);
}

function firstAuthorTokens(paper: Paper) {
  return new Set((paper.authors[0]?.toLowerCase() || "").split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

export function duplicateReason(a: Paper, b: Paper): DuplicateReason | null {
  const aDoi = normalizeDoi(a.doi);
  const bDoi = normalizeDoi(b.doi);
  if (aDoi && bDoi && aDoi === bDoi) return "Same DOI";

  const aArxiv = normalizeArxivId(a.arxivId);
  const bArxiv = normalizeArxivId(b.arxivId);
  if (aArxiv && bArxiv && aArxiv === bArxiv) return "Same arXiv ID";

  const aTokens = titleTokens(a.title);
  const bTokens = titleTokens(b.title);
  if (aTokens.length && aTokens.join(" ") === bTokens.join(" ")) return "Same title";

  const yearsCompatible = !a.year || !b.year || Math.abs(a.year - b.year) <= 1;
  const aAuthor = firstAuthorTokens(a);
  const bAuthor = firstAuthorTokens(b);
  const authorsCompatible = !aAuthor.size || !bAuthor.size || [...aAuthor].some((token) => bAuthor.has(token));
  if (Math.min(aTokens.length, bTokens.length) >= 4 && yearsCompatible && authorsCompatible && titleSimilarity(a.title, b.title) >= 0.8) {
    return "Very similar title";
  }
  return null;
}

export interface DuplicateGroup {
  ids: string[];
  reason: DuplicateReason;
}

export function findDuplicateGroups(papers: Paper[]): DuplicateGroup[] {
  const parents = new Map(papers.map((paper) => [paper.id, paper.id]));
  const reasons = new Map<string, DuplicateReason>();
  const find = (id: string): string => {
    const parent = parents.get(id) || id;
    if (parent === id) return id;
    const root = find(parent);
    parents.set(id, root);
    return root;
  };
  const union = (a: string, b: string, reason: DuplicateReason) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parents.set(right, left);
    reasons.set(left, reasons.get(left) || reasons.get(right) || reason);
  };

  for (let i = 0; i < papers.length; i += 1) {
    for (let j = i + 1; j < papers.length; j += 1) {
      const reason = duplicateReason(papers[i], papers[j]);
      if (reason) union(papers[i].id, papers[j].id, reason);
    }
  }

  const grouped = new Map<string, string[]>();
  for (const paper of papers) {
    const root = find(paper.id);
    grouped.set(root, [...(grouped.get(root) || []), paper.id]);
  }
  return [...grouped.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([root, ids]) => ({ ids, reason: reasons.get(root) || "Same title" }));
}

export function paperCompletenessScore(paper: Paper) {
  return (paper.hasPdf ? 12 : 0)
    + (paper.doi ? 5 : 0)
    + (paper.arxivId ? 4 : 0)
    + (paper.abstract ? 4 : 0)
    + (paper.authors.length ? 3 : 0)
    + (paper.year ? 2 : 0)
    + (paper.venue ? 2 : 0)
    + (paper.url ? 1 : 0)
    + (paper.pdfText ? 2 : 0)
    + paper.tags.length
    + paper.collectionIds.length
    + (paper.takeaway ? 3 : 0);
}

export function choosePrimaryPaper(papers: Paper[]) {
  return [...papers].sort((a, b) =>
    paperCompletenessScore(b) - paperCompletenessScore(a)
    || a.addedAt.localeCompare(b.addedAt)
  )[0];
}
