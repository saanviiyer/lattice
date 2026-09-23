// Records on disk are untyped. A field missing because the record predates it, or
// because an import had nothing to put there, used to blank the whole app.
import { describe, it, expect } from "vitest";
import {
  normalizeAll, normalizePaper, normalizeNote, normalizeCollection, normalizeQuestion,
} from "../lib/normalizeRecords";
import { metadataIssues } from "../lib/metadataQuality";

describe("filling stored records to shape", () => {
  it("makes a paper with no venue safe for code that trims it", () => {
    const paper = normalizePaper({ id: "p1", title: "A paper", abstract: "x" });
    // This exact call blanked the app on a record written without a venue.
    expect(() => metadataIssues(paper)).not.toThrow();
    expect(metadataIssues(paper)).toContain("venue");
  });

  it("never invents content over something the user wrote", () => {
    const paper = normalizePaper({
      id: "p1", title: "Real title", takeaway: "my own note", venue: "NeurIPS", year: 2021,
    });
    expect(paper.title).toBe("Real title");
    expect((paper as any).takeaway).toBe("my own note");
    expect(paper.venue).toBe("NeurIPS");
    expect(paper.year).toBe(2021);
  });

  it("drops corrupt entries instead of letting one poison the array", () => {
    const papers = normalizeAll([{ id: "p1" }, null, "garbage", 42, { id: "p2" }], normalizePaper);
    expect(papers.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("gives a note without timestamps a coherent pair", () => {
    const note = normalizeNote({ id: "n1", title: "T", body: "b", updatedAt: "2024-01-01T00:00:00Z" });
    expect(note.createdAt).toBe("2024-01-01T00:00:00Z");
    const bare = normalizeNote({ id: "n2" });
    expect(bare.createdAt).toBe(bare.updatedAt);
    expect(bare.title).toBe("Untitled note");
  });

  it("keeps arrays as arrays so .length and .map cannot throw", () => {
    const paper = normalizePaper({ id: "p1", authors: "not an array", tags: null });
    expect(paper.authors).toEqual([]);
    expect(paper.tags).toEqual([]);
    const question = normalizeQuestion({ id: "q1", linkedPaperIds: undefined });
    expect(question.linkedPaperIds).toEqual([]);
    expect(normalizeCollection({ id: "c1" }).name).toBe("Untitled project");
  });
});
