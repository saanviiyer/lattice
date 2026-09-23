import { describe, expect, it } from "vitest";
import type { Paper, PaperMetadata } from "../types";
import { mergeImportedMetadata } from "../lib/paperMerge";

const existing: Paper = {
  id: "p", title: "A Paper", authors: [], year: null, venue: "", abstract: "",
  doi: "", source: "manual", tags: ["saved"], collectionIds: ["c1"],
  addedAt: "2026-01-01T00:00:00Z", readingStatus: "reading", takeaway: "Keep this.",
};
const incoming: PaperMetadata = {
  title: "A Paper", authors: ["Ada Lovelace"], year: 2026, venue: "Test Journal",
  abstract: "Evidence.", doi: "10.1/test", url: "https://example.test", source: "doi",
};

describe("duplicate-safe metadata merging", () => {
  it("fills missing bibliography fields and unions organization", () => {
    const patch = mergeImportedMetadata(existing, incoming, { tags: ["imported"], collectionIds: ["c2"] });
    expect(patch.authors).toEqual(["Ada Lovelace"]);
    expect(patch.doi).toBe("10.1/test");
    expect(patch.tags).toEqual(["saved", "imported"]);
    expect(patch.collectionIds).toEqual(["c1", "c2"]);
    expect(patch.source).toBe("doi");
    expect(patch).not.toHaveProperty("readingStatus");
    expect(patch).not.toHaveProperty("takeaway");
  });

  it("does not overwrite stronger existing metadata", () => {
    const patch = mergeImportedMetadata({ ...existing, authors: ["Existing Author"], year: 2020 }, incoming);
    expect(patch.authors).toEqual(["Existing Author"]);
    expect(patch.year).toBe(2020);
  });
});
