import { describe, it, expect } from "vitest";
import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { projectAsContext } from "../lib/projectContext";

const NOW = "2026-01-01T00:00:00.000Z";

const PROJECT: Collection = {
  id: "replay", name: "Replay", parentId: null, createdAt: NOW,
  premise: "Replay during quiet rest consolidates the memory.",
};
const COLLECTIONS = [PROJECT, { id: "ripple", name: "Ripple detection", parentId: "replay", createdAt: NOW }];

const PAPERS: Paper[] = [
  {
    id: "p1", title: "Sharp-wave ripples during quiet rest", authors: ["Ada Lovelace", "Alan Turing"],
    year: 2019, venue: "Neuron", abstract: "A long abstract that should not appear.", doi: "10.1/ripples",
    source: "manual", tags: [], collectionIds: ["replay"], addedAt: NOW, readingStatus: "read",
    takeaway: "Ripple rate predicts next-day recall.",
  },
  {
    id: "p2", title: "Decoding population spike trains", authors: ["Grace Hopper"],
    year: 2017, venue: "JNeuro", abstract: "", doi: "", arxivId: "1701.00001",
    source: "arxiv", tags: [], collectionIds: ["ripple"], addedAt: NOW, readingStatus: "inbox",
  },
];

const NOTES: Note[] = [
  { id: "n1", title: "Synthesis", body: "The causal claim rests on [[Sharp-wave ripples during quiet rest]].", collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
];

const QUESTIONS: ResearchQuestion[] = [
  { id: "q1", title: "Does replay cause consolidation?", detail: "Needs a matched-wake control.", status: "exploring", linkedPaperIds: ["p1"], collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
  { id: "q2", title: "Is the effect sleep-specific?", detail: "", status: "open", linkedPaperIds: [], collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
];

function context(options = {}) {
  return projectAsContext(PROJECT, COLLECTIONS, PAPERS, NOTES, QUESTIONS, options);
}

describe("projectAsContext", () => {
  it("leads with the premise", () => {
    expect(context()).toContain("Replay during quiet rest consolidates the memory.");
  });

  it("instructs the model to stay grounded and to admit gaps", () => {
    const out = context();
    expect(out).toMatch(/ground anything you say/i);
    expect(out).toMatch(/not in here/i);
  });

  it("lists papers with a citation key and an identifier", () => {
    const out = context();
    expect(out).toContain("[Lovelace2019sharp]");
    expect(out).toContain("doi:10.1/ripples");
    expect(out).toContain("arXiv:1701.00001");
  });

  it("carries my takeaway, and falls back to the abstract where none is written", () => {
    const out = context();
    expect(out).toContain("My takeaway: Ripple rate predicts next-day recall.");
    // p2 has no takeaway; without the abstract it would export as a bare title.
    expect(out).toContain("Abstract:");
  });

  it("includes the paper's own abstract by default", () => {
    // A takeaway is the better signal where one exists — and most libraries have
    // plenty of papers where none does, which used to export as a bare title.
    expect(context()).toContain("A long abstract that should not appear.");
  });

  it("can be cut back to takeaways only", () => {
    const out = context({ detail: "brief" });
    expect(out).not.toContain("A long abstract that should not appear.");
    expect(out).toContain("My takeaway: Ripple rate predicts next-day recall.");
  });

  it("says so when a paper has neither a takeaway nor an abstract", () => {
    expect(context()).toContain("_No takeaway or abstract recorded for this one._");
  });

  it("includes extracted PDF text only when asked, and says where it was cut", () => {
    const withText: Paper[] = [{ ...PAPERS[0], pdfText: "BODY ".repeat(3000) }];
    const brief = projectAsContext(PROJECT, COLLECTIONS, withText, [], [], { detail: "abstracts" });
    expect(brief).not.toContain("BODY BODY");
    const full = projectAsContext(PROJECT, COLLECTIONS, withText, [], [], { detail: "full", fullTextChars: 200 });
    expect(full).toContain("BODY BODY");
    expect(full).toMatch(/first 200 characters of \d+/);
  });

  it("marks which questions have evidence and which do not", () => {
    const out = context();
    expect(out).toContain("**Does replay cause consolidation?** (exploring) — evidence: Lovelace2019sharp");
    expect(out).toContain("**Is the effect sleep-specific?** (open) — _no evidence attached yet_");
  });

  it("includes the notes and the subprojects", () => {
    const out = context();
    expect(out).toContain("### Synthesis");
    expect(out).toContain("The causal claim rests on");
    expect(out).toContain("- Ripple detection");
  });

  it("includes what the project is missing, as lattice's own assessment", () => {
    const out = context();
    expect(out).toContain("## What this project is still missing");
    expect(out).toMatch(/Computed by lattice, not by me/);
  });

  it("truncates a long note instead of pasting an entire document", () => {
    const long: Note[] = [{ ...NOTES[0], body: "x".repeat(5000) }];
    const out = projectAsContext(PROJECT, COLLECTIONS, PAPERS, long, QUESTIONS, { noteLimit: 200 });
    expect(out).toContain("…[note continues]");
    expect(out.length).toBeLessThan(4000);
  });

  it("still produces usable context for an empty project", () => {
    const bare: Collection = { id: "new", name: "A hunch", parentId: null, createdAt: NOW };
    const out = projectAsContext(bare, [bare], [], [], []);
    expect(out).toContain("# Research project: A hunch");
    expect(out).toContain("_Not stated yet._");
    expect(out).toContain("_None recorded yet._");
  });
});
