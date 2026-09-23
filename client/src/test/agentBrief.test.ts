import { describe, it, expect } from "vitest";
import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { projectsAsAgentBrief } from "../lib/agentBrief";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT: Collection = {
  id: "replay", name: "Replay", parentId: null, createdAt: NOW,
  premise: "Replay during quiet rest consolidates the memory.",
};
const COLLECTIONS = [PROJECT, { id: "sub", name: "Ripples", parentId: "replay", createdAt: NOW }];
const PAPERS: Paper[] = [
  {
    id: "p1", title: "Sharp-wave ripples during quiet rest", authors: ["Ada Lovelace"],
    year: 2019, venue: "Neuron", abstract: "Long abstract that should not be inlined.",
    doi: "10.1/ripples", source: "manual", tags: [], collectionIds: ["replay"],
    addedAt: NOW, readingStatus: "read", takeaway: "Ripple rate predicts next-day recall.",
  },
  {
    id: "p2", title: "Decoding population spike trains", authors: ["Grace Hopper"],
    year: 2017, venue: "JNeuro", abstract: "", doi: "", arxivId: "1701.00001",
    source: "arxiv", tags: [], collectionIds: ["replay"], addedAt: NOW, readingStatus: "inbox",
  },
];
const NOTES: Note[] = [
  { id: "n1", title: "Synthesis", body: "The causal claim rests on ripple timing.\nSecond line.", collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
];
const QUESTIONS: ResearchQuestion[] = [
  { id: "q1", title: "Does replay cause consolidation?", detail: "", status: "exploring", linkedPaperIds: ["p1"], collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
  { id: "q2", title: "Is it sleep-specific?", detail: "", status: "open", linkedPaperIds: [], collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
];

const brief = (options = {}) =>
  projectsAsAgentBrief([PROJECT], COLLECTIONS, PAPERS, NOTES, QUESTIONS, options);

describe("projectsAsAgentBrief", () => {
  it("leads with the rules, before any of the content they govern", () => {
    const out = brief();
    expect(out.indexOf("## How to use this")).toBeLessThan(out.indexOf("## Premise"));
  });

  it("forbids inventing a citation, which is the failure that matters", () => {
    expect(brief()).toMatch(/[Nn]ever invent a key/);
    expect(brief()).toMatch(/fabricated citation/i);
  });

  it("tells the agent to say when something is not in the library", () => {
    expect(brief()).toMatch(/not here, say so/i);
  });

  it("carries the premise, citation keys, and the user's takeaways", () => {
    const out = brief();
    expect(out).toContain("Replay during quiet rest consolidates the memory.");
    expect(out).toContain("`Lovelace2019sharp`");
    expect(out).toContain("Ripple rate predicts next-day recall.");
  });

  it("distinguishes a question with evidence from one without", () => {
    const out = brief();
    expect(out).toMatch(/Does replay cause consolidation\?\*\* \(exploring\) — evidence: `Lovelace2019sharp`/);
    expect(out).toMatch(/Is it sleep-specific\?\*\* \(open\) — \*\*no evidence attached\*\*/);
  });

  it("summarises notes by default, because this file is read every turn", () => {
    const out = brief();
    expect(out).toContain("**Synthesis** — The causal claim rests on ripple timing.");
    expect(out).not.toContain("Second line.");
  });

  it("includes note bodies when asked", () => {
    expect(brief({ fullNotes: true })).toContain("Second line.");
  });

  it("includes the papers' own abstracts, truncated for a file read every turn", () => {
    expect(brief()).toContain("Long abstract that should not be inlined.");
    const long = [{ ...PAPERS[0], abstract: "X".repeat(2000) }];
    const out = projectsAsAgentBrief([PROJECT], COLLECTIONS, long, [], [], { abstractChars: 120 });
    expect(out).toMatch(/X{100,120}…/);
  });

  it("can be cut back to takeaways only", () => {
    expect(brief({ detail: "brief" })).not.toContain("Long abstract that should not be inlined.");
  });

  it("warns that excerpts are truncated rather than letting them be read as whole", () => {
    expect(brief()).toMatch(/truncated/);
    expect(brief()).toMatch(/cannot see it rather than guessing/);
  });

  it("points at the live MCP tools rather than inlining everything", () => {
    const out = brief();
    expect(out).toContain("list_projects");
    expect(out).toContain("search_library");
    expect(out).toMatch(/never out of date/);
  });

  it("can leave the MCP section out for an agent that has no tools", () => {
    expect(brief({ mentionMcp: false })).not.toContain("list_projects");
  });

  it("caps the paper list and says how many it left out", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...PAPERS[0], id: `x${i}`, title: `Paper ${i}` }));
    const out = projectsAsAgentBrief([PROJECT], COLLECTIONS, many, [], [], { paperLimit: 5 });
    expect(out).toMatch(/…and 25 more/);
  });

  it("stays small enough to sit at the top of every turn", () => {
    // The whole point of the format: a chat paste can be huge, this cannot.
    expect(brief().length).toBeLessThan(4000);
  });

  it("returns nothing when no project is chosen", () => {
    expect(projectsAsAgentBrief([], COLLECTIONS, PAPERS, NOTES, QUESTIONS)).toBe("");
  });
});

describe("a premise lattice wrote itself", () => {
  it("is not presented as the user's claim", () => {
    const auto: Collection = {
      ...PROJECT,
      premise: "Grouped automatically from shared content: proteins, language. Replace this with what you actually think might be true.",
    };
    const out = projectsAsAgentBrief([auto], [auto], PAPERS, NOTES, QUESTIONS);
    expect(out).toMatch(/No premise stated yet/);
    expect(out).toMatch(/not as the user's claim/);
  });

  it("says plainly when there is no premise at all", () => {
    const bare: Collection = { ...PROJECT, premise: undefined };
    expect(projectsAsAgentBrief([bare], [bare], PAPERS, NOTES, QUESTIONS)).toMatch(/has not said what they think/);
  });
});
