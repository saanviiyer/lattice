import { describe, expect, it } from "vitest";
import type { Paper } from "../types";
import { metadataIssues, metadataScore } from "../lib/metadataQuality";

const complete: Paper = {
  id: "p", title: "Complete", authors: ["Ada Lovelace"], year: 2026,
  venue: "Test Journal", abstract: "A useful abstract.", doi: "10.1/test",
  source: "doi", tags: [], collectionIds: [], addedAt: "2026-01-01T00:00:00Z",
};

describe("metadata quality", () => {
  it("scores complete records", () => {
    expect(metadataIssues(complete)).toEqual([]);
    expect(metadataScore(complete)).toBe(100);
  });

  it("identifies actionable missing fields", () => {
    const issues = metadataIssues({ ...complete, authors: [], abstract: "", doi: "" });
    expect(issues).toEqual(["authors", "abstract", "identifier"]);
    expect(metadataScore({ ...complete, authors: [], abstract: "", doi: "" })).toBe(40);
  });
});
