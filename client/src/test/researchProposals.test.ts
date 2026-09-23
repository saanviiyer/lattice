import { describe, it, expect } from "vitest";
import type { Collection, Paper, ResearchQuestion } from "../types";
import { proposeResearch } from "../lib/researchProposals";

const NOW = "2026-01-01T00:00:00.000Z";

function paper(id: string, title: string, collectionIds: string[] = []): Paper {
  return {
    id, title, authors: [], year: 2026, venue: "", abstract: "", doi: `10.1/${id}`,
    source: "manual", tags: [], collectionIds, addedAt: NOW, readingStatus: "read",
  };
}
function question(id: string, title: string, extra: Partial<ResearchQuestion> = {}): ResearchQuestion {
  return { id, title, detail: "", status: "open", linkedPaperIds: [], createdAt: NOW, updatedAt: NOW, ...extra };
}
function project(id: string, name: string, extra: Partial<Collection> = {}): Collection {
  return { id, name, parentId: null, createdAt: NOW, ...extra };
}

// A method read about, and a domain read about, with no overlap between them.
const TRANSFER: Paper[] = [
  ...Array.from({ length: 6 }, (_, i) => paper(`m${i}`, `Active learning with an acquisition function for experimental design ${i}`)),
  ...Array.from({ length: 6 }, (_, i) => paper(`d${i}`, `Antibody epitope and paratope engineering study ${i}`)),
];

describe("proposeResearch", () => {
  it("suggests applying a method you read to a domain you read", () => {
    const found = proposeResearch(TRANSFER, [], []);
    const transfer = found.find((p) => p.kind === "method-transfer");
    expect(transfer).toBeDefined();
    expect(transfer!.title.toLowerCase()).toContain("antibody");
  });

  it("states its reason in terms of what is actually in the library", () => {
    const [first] = proposeResearch(TRANSFER, [], []);
    // The numbers are the point: a suggestion you cannot check is noise.
    expect(first.rationale).toMatch(/\d+ papers on/);
    expect(first.paperIds.length).toBeGreaterThan(0);
  });

  it("does not suggest a combination you have already made", () => {
    const already = Array.from({ length: 6 }, (_, i) =>
      paper(`b${i}`, `Active learning acquisition for antibody epitope engineering ${i}`)
    );
    const found = proposeResearch([...TRANSFER, ...already], [], []);
    const transfer = found.filter(
      (p) => p.kind === "method-transfer" && /antibody/i.test(p.title) && /active learning/i.test(p.title)
    );
    expect(transfer).toHaveLength(0);
  });

  it("surfaces a question that already has evidence behind it", () => {
    const papers = Array.from({ length: 4 }, (_, i) => paper(`q${i}`, `Some paper ${i}`));
    const questions = [question("qq", "Does replay cause consolidation?", {
      linkedPaperIds: papers.map((p) => p.id),
    })];
    const found = proposeResearch(papers, questions, []);
    const ready = found.find((p) => p.kind === "question-ready");
    expect(ready?.title).toBe("Does replay cause consolidation?");
    expect(ready?.questionIds).toEqual(["qq"]);
  });

  it("ignores a question that is already in a project", () => {
    const papers = Array.from({ length: 4 }, (_, i) => paper(`q${i}`, `Some paper ${i}`));
    const questions = [question("qq", "Already filed", {
      linkedPaperIds: papers.map((p) => p.id), collectionIds: ["proj"],
    })];
    const found = proposeResearch(papers, questions, [project("proj", "A project")]);
    expect(found.find((p) => p.kind === "question-ready")).toBeUndefined();
  });

  it("flags a premise with almost nothing behind it", () => {
    const papers = [paper("p1", "One lonely paper", ["proj"])];
    const projects = [project("proj", "Thesis", { premise: "Replay causes consolidation." })];
    const found = proposeResearch(papers, [], projects);
    const thin = found.find((p) => p.kind === "thin-premise");
    expect(thin?.rationale).toMatch(/only 1 paper/);
    expect(thin?.premise).toBe("Replay causes consolidation.");
  });

  it("does not flag a premise that is well evidenced", () => {
    const papers = Array.from({ length: 5 }, (_, i) => paper(`p${i}`, `Paper ${i}`, ["proj"]));
    const projects = [project("proj", "Thesis", { premise: "Replay causes consolidation." })];
    const found = proposeResearch(papers, [], projects);
    expect(found.find((p) => p.kind === "thin-premise")).toBeUndefined();
  });

  it("points at reading that no project or question claims", () => {
    const papers = Array.from({ length: 6 }, (_, i) =>
      paper(`u${i}`, `Cryo-EM tomography density map reconstruction ${i}`)
    );
    const found = proposeResearch(papers, [], []);
    expect(found.some((p) => p.kind === "unclaimed-reading")).toBe(true);
  });

  it("suggests nothing at all for a library too small to reason about", () => {
    expect(proposeResearch([paper("a", "One paper")], [], [])).toEqual([]);
  });

  it("never repeats a method or a domain across its suggestions", () => {
    const found = proposeResearch(TRANSFER, [], []).filter((p) => p.kind === "method-transfer");
    const halves = found.flatMap((p) => p.id.split(":").slice(1));
    expect(new Set(halves).size).toBe(halves.length);
  });

  it("is deterministic", () => {
    const a = proposeResearch(TRANSFER, [], []).map((p) => p.id);
    const b = proposeResearch([...TRANSFER].reverse(), [], []).map((p) => p.id);
    expect(b).toEqual(a);
  });
});
