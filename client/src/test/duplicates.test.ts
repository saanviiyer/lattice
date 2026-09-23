import { describe, expect, it } from "vitest";
import type { Paper } from "../types";
import { choosePrimaryPaper, duplicateReason, findDuplicateGroups, normalizeDoi } from "../lib/duplicates";

function paper(id: string, patch: Partial<Paper> = {}): Paper {
  return {
    id, title: `Paper ${id}`, authors: [], year: null, venue: "", abstract: "", doi: "",
    source: "manual", tags: [], collectionIds: [], addedAt: `2026-01-0${id}T00:00:00Z`,
    ...patch,
  };
}

describe("duplicate detection", () => {
  it("normalizes DOI URLs and finds identifier duplicates", () => {
    expect(normalizeDoi("https://doi.org/10.1000/XYZ")).toBe("10.1000/xyz");
    expect(duplicateReason(
      paper("1", { doi: "10.1000/xyz" }),
      paper("2", { doi: "https://doi.org/10.1000/XYZ" }),
    )).toBe("Same DOI");
  });

  it("flags close title variants only when authors and years are compatible", () => {
    const original = paper("1", { title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017 });
    const variant = paper("2", { title: "Attention is all you need: an overview", authors: ["Vaswani, Ashish"], year: 2017 });
    expect(duplicateReason(original, variant)).toBe("Very similar title");
    expect(duplicateReason(original, paper("3", { ...variant, authors: ["Jane Smith"] }))).toBeNull();
  });

  it("groups transitive candidates and chooses the richest record", () => {
    const sparse = paper("1", { title: "A Study of Scientific Change", authors: ["T. Kuhn"], year: 1962 });
    const rich = paper("2", { title: "A study of scientific change", authors: ["Thomas Kuhn"], year: 1962, doi: "10.1/example", abstract: "Detailed", hasPdf: true });
    const groups = findDuplicateGroups([sparse, rich, paper("3")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(["1", "2"]);
    expect(choosePrimaryPaper([sparse, rich])?.id).toBe("2");
  });
});
