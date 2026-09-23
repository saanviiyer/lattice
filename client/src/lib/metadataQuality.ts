import type { Paper } from "../types";

export type MetadataIssue = "authors" | "year" | "venue" | "abstract" | "identifier";

export function metadataIssues(paper: Paper): MetadataIssue[] {
  const issues: MetadataIssue[] = [];
  if (!paper.authors.length) issues.push("authors");
  if (!paper.year) issues.push("year");
  if (!paper.venue.trim()) issues.push("venue");
  if (!paper.abstract.trim()) issues.push("abstract");
  if (!paper.doi.trim() && !paper.arxivId?.trim() && !paper.url?.trim()) issues.push("identifier");
  return issues;
}

export function metadataScore(paper: Paper): number {
  return Math.round((5 - metadataIssues(paper).length) / 5 * 100);
}
