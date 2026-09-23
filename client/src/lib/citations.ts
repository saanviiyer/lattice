import type { Paper } from "../types";

export type CitationStyle = "apa" | "mla" | "chicago";

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
  const entryType = {
    journalArticle: "article",
    conferencePaper: "inproceedings",
    preprint: "misc",
    book: "book",
    thesis: "phdthesis",
    webpage: "misc",
  }[paper.itemType || "journalArticle"];
  const venueField = paper.itemType === "conferencePaper"
    ? "booktitle"
    : paper.itemType === "book" ? "publisher" : paper.itemType === "thesis" ? "school" : "journal";
  const fields = [
    `  title = {${escapeBib(paper.title || "Untitled paper")}}`,
    paper.authors.length ? `  author = {${paper.authors.map(escapeBib).join(" and ")}}` : "",
    paper.year ? `  year = {${paper.year}}` : "",
    paper.venue ? `  ${venueField} = {${escapeBib(paper.venue)}}` : "",
    paper.doi ? `  doi = {${clean(paper.doi)}}` : "",
    paper.url ? `  url = {${paper.url.trim()}}` : "",
  ].filter(Boolean);
  return `@${entryType}{${citationKey(paper)},\n${fields.join(",\n")}\n}`;
}

export function papersToBibTeX(papers: Paper[]): string {
  const seen = new Map<string, number>();
  return papers.map((paper) => {
    const base = citationKey(paper);
    const number = (seen.get(base) || 0) + 1;
    seen.set(base, number);
    const key = number === 1 ? base : `${base}${number}`;
    return paperToBibTeX(paper).replace(`{${base},`, `{${key},`);
  }).join("\n\n") + (papers.length ? "\n" : "");
}

export function bibliographyFilename(label: string): string {
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `lattice-${safe || "library"}.bib`;
}

function authorParts(author: string) {
  const parts = clean(author).split(/\s+/);
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] || "Unknown" };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => `${part[0].toUpperCase()}.`).join(" ");
}

function doiLink(paper: Paper) {
  return paper.doi ? `https://doi.org/${paper.doi}` : paper.url || "";
}

export function formatCitation(paper: Paper, style: CitationStyle): string {
  const people = paper.authors.map(authorParts);
  const year = paper.year || "n.d.";
  const venue = paper.venue ? ` ${paper.venue}.` : "";
  const link = doiLink(paper);

  if (style === "mla") {
    const authors = people.length === 0 ? "Unknown author" : people.length === 1
      ? `${people[0].last}, ${people[0].first}`
      : `${people[0].last}, ${people[0].first}, et al.`;
    return `${authors}. “${paper.title}.”${venue} ${year}.${link ? ` ${link}.` : ""}`.replace(/\s+/g, " ").trim();
  }
  if (style === "chicago") {
    const authors = people.length === 0 ? "Unknown author" : people.length === 1
      ? `${people[0].last}, ${people[0].first}`
      : `${people[0].last}, ${people[0].first}, et al.`;
    return `${authors}. “${paper.title}.”${venue} ${year}.${link ? ` ${link}.` : ""}`.replace(/\s+/g, " ").trim();
  }
  const authors = people.length === 0 ? "Unknown author" : people
    .map((person, index) => `${person.last}, ${initials(person.first)}${index === people.length - 1 && people.length > 1 ? "" : ","}`)
    .join(people.length > 1 ? " & " : "");
  return `${authors} (${year}). ${paper.title}.${venue}${link ? ` ${link}` : ""}`.replace(/\s+/g, " ").trim();
}

export function formatBibliography(papers: Paper[], style: CitationStyle): string {
  return [...papers]
    .sort((a, b) => (a.authors[0] || a.title).localeCompare(b.authors[0] || b.title))
    .map((paper) => formatCitation(paper, style))
    .join("\n\n");
}

function risType(paper: Paper) {
  return {
    journalArticle: "JOUR",
    conferencePaper: "CONF",
    preprint: "UNPB",
    book: "BOOK",
    thesis: "THES",
    webpage: "ELEC",
  }[paper.itemType || "journalArticle"];
}

export function paperToRis(paper: Paper): string {
  const lines = [`TY  - ${risType(paper)}`, `TI  - ${clean(paper.title || "Untitled paper")}`];
  for (const author of paper.authors) lines.push(`AU  - ${clean(author)}`);
  if (paper.year) lines.push(`PY  - ${paper.year}`);
  if (paper.venue) lines.push(`${paper.itemType === "book" ? "PB" : "JO"}  - ${clean(paper.venue)}`);
  if (paper.abstract) lines.push(`AB  - ${clean(paper.abstract)}`);
  if (paper.doi) lines.push(`DO  - ${clean(paper.doi)}`);
  if (paper.url) lines.push(`UR  - ${paper.url.trim()}`);
  for (const tag of paper.tags) lines.push(`KW  - ${clean(tag)}`);
  lines.push("ER  -");
  return lines.join("\r\n");
}

export function papersToRis(papers: Paper[]): string {
  return papers.map(paperToRis).join("\r\n\r\n") + (papers.length ? "\r\n" : "");
}
