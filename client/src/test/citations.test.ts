import { describe, expect, it } from "vitest";
import type { Paper } from "../types";
import { bibliographyFilename, citationKey, papersToBibTeX } from "../lib/citations";

const paper: Paper = {
  id: "p1", title: "Attention & Research", authors: ["Ada Lovelace", "Grace Hopper"],
  year: 2026, venue: "Journal of Tests", abstract: "", doi: "10.1/test", url: "https://example.test",
  source: "doi", tags: [], collectionIds: [], addedAt: "2026-01-01T00:00:00Z",
};

describe("BibTeX export", () => {
  it("creates useful, escaped citations", () => {
    expect(citationKey(paper)).toBe("Lovelace2026attention");
    const bib = papersToBibTeX([paper]);
    expect(bib).toContain("@article{Lovelace2026attention,");
    expect(bib).toContain("author = {Ada Lovelace and Grace Hopper}");
    expect(bib).toContain("title = {Attention \\& Research}");
    expect(bib).toContain("doi = {10.1/test}");
  });

  it("deduplicates colliding keys and sanitizes filenames", () => {
    const bib = papersToBibTeX([paper, { ...paper, id: "p2" }]);
    expect(bib).toContain("@article{Lovelace2026attention2,");
    expect(bibliographyFilename("My Reading List")).toBe("lattice-my-reading-list.bib");
  });
});
