import { describe, expect, it } from "vitest";
import type { Paper } from "../types";
import { matchesLibraryQuery } from "../lib/librarySearch";

const paper: Paper = {
  id: "p1", title: "Attention Is All You Need", authors: ["Ashish Vaswani"],
  year: 2017, venue: "NeurIPS", abstract: "A transformer architecture.", doi: "",
  source: "manual", tags: ["transformers", "foundational"], collectionIds: [],
  addedAt: "2026-01-01T00:00:00Z", hasPdf: true, readingStatus: "reading", favorite: true,
};

describe("library search", () => {
  it("matches free text across bibliographic fields", () => {
    expect(matchesLibraryQuery(paper, "attention transformer")).toBe(true);
    expect(matchesLibraryQuery(paper, "diffusion")).toBe(false);
  });

  it("supports structured power filters", () => {
    expect(matchesLibraryQuery(paper, "author:vaswani tag:found year:2017")).toBe(true);
    expect(matchesLibraryQuery(paper, "status:in-progress has:pdf is:favorite")).toBe(true);
    expect(matchesLibraryQuery(paper, "year:2020")).toBe(false);
  });

});
