import type { Paper } from "../types";

function clean(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function escapeBib(value: string): string {
  return clean(value).replace(/([&%#$])/g, "\\$1");
}

export function citationKey(paper: Pick<Paper, "authors" | "year" | "title">): string {
  const authorParts = paper.authors[0]?.trim().split(/\s+/) || [];
  const surname = authorParts[authorParts.length - 1] || "unknown";
  const word = clean(paper.title).toLowerCase().match(/[a-z0-9]{3,}/)?.[0] || "paper";
  return `${surname}${paper.year || "nd"}${word}`.replace(/[^a-z0-9]/gi, "");
}

export function paperToBibTeX(paper: Paper): string {
  const fields = [
    `  title = {${escapeBib(paper.title || "Untitled paper")}}`,
    paper.authors.length ? `  author = {${paper.authors.map(escapeBib).join(" and ")}}` : "",
    paper.year ? `  year = {${paper.year}}` : "",
    paper.venue ? `  journal = {${escapeBib(paper.venue)}}` : "",
    paper.doi ? `  doi = {${clean(paper.doi)}}` : "",
    paper.url ? `  url = {${paper.url.trim()}}` : "",
  ].filter(Boolean);
  return `@article{${citationKey(paper)},\n${fields.join(",\n")}\n}`;
}

export function papersToBibTeX(papers: Paper[]): string {
  const seen = new Map<string, number>();
  return papers.map((paper) => {
    const base = citationKey(paper);
    const number = (seen.get(base) || 0) + 1;
    seen.set(base, number);
    const key = number === 1 ? base : `${base}${number}`;
    return paperToBibTeX(paper).replace(`@article{${base},`, `@article{${key},`);
  }).join("\n\n") + (papers.length ? "\n" : "");
}

export function bibliographyFilename(label: string): string {
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `lattice-${safe || "library"}.bib`;
}
