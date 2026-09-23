import type { Paper } from "../types";

function tokens(query: string): string[] {
  return [...query.matchAll(/(?:[^\s"]+|"[^"]*")+/g)]
    .map((match) => match[0].replace(/^"|"$/g, "").toLowerCase())
    .filter(Boolean);
}

function contains(values: Array<string | number | null | undefined>, needle: string) {
  return values.some((value) => String(value || "").toLowerCase().includes(needle));
}

export function matchesLibraryQuery(paper: Paper, query: string): boolean {
  return tokens(query.trim()).every((token) => {
    const separator = token.indexOf(":");
    const field = separator > 0 ? token.slice(0, separator) : "";
    const value = separator > 0 ? token.slice(separator + 1) : token;
    if (!value) return true;

    if (field === "author") return contains(paper.authors, value);
    if (field === "tag") return contains(paper.tags, value);
    if (field === "year") return String(paper.year || "") === value;
    if (field === "status") {
      const status = paper.readingStatus || "inbox";
      return status === value || (value === "to-read" && status === "inbox") || (value === "in-progress" && status === "reading");
    }
    if (field === "has") {
      if (value === "pdf") return !!paper.hasPdf;
      if (value === "notes") return !!paper.takeaway;
      if (value === "doi") return !!paper.doi;
      return false;
    }
    if (field === "is" && value === "favorite") return !!paper.favorite;
    if (field === "type") return (paper.itemType || "journalArticle").toLowerCase().includes(value.replace(/-/g, ""));
    if (field) return false;

    return contains([
      paper.title, ...paper.authors, paper.abstract, paper.venue, paper.doi,
      paper.arxivId, paper.takeaway, ...paper.tags,
    ], value);
  });
}
