import { describe, it, expect } from "vitest";
import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { projectContents, projectCounts, projectGaps, projectPulse } from "../lib/projectWorkspace";

const NOW = "2026-01-01T00:00:00.000Z";

function project(id: string, name: string, parentId: string | null = null, extra: Partial<Collection> = {}): Collection {
  return { id, name, parentId, createdAt: NOW, ...extra };
}

function paper(id: string, title: string, collectionIds: string[], extra: Partial<Paper> = {}): Paper {
  return {
    id, title, authors: [], year: 2026, venue: "", abstract: "", doi: "", source: "manual",
    tags: [], collectionIds, addedAt: NOW, readingStatus: "read", ...extra,
  };
}

function note(id: string, title: string, body: string, extra: Partial<Note> = {}): Note {
  return { id, title, body, createdAt: NOW, updatedAt: NOW, ...extra };
}

function question(id: string, title: string, extra: Partial<ResearchQuestion> = {}): ResearchQuestion {
  return { id, title, detail: "", status: "open", linkedPaperIds: [], createdAt: NOW, updatedAt: NOW, ...extra };
}

// Thesis
//   Chapter 1
const COLLECTIONS = [project("thesis", "Thesis", null, { premise: "Replay causes consolidation." }), project("ch1", "Chapter 1", "thesis")];

describe("projectContents", () => {
  it("gathers papers, notes, and questions from the project and its subprojects", () => {
    const papers = [
      paper("p1", "Ripples", ["thesis"], { takeaway: "Ripples matter." }),
      paper("p2", "Decoding", ["ch1"], { takeaway: "Decoding works." }),
      paper("p3", "Unrelated", ["other"]),
    ];
    const notes = [
      note("n1", "Synthesis", "[[Ripples]] and [[Decoding]]", { collectionIds: ["thesis"] }),
      note("n2", "Elsewhere", "nothing", { collectionIds: ["other"] }),
    ];
    const questions = [
      question("q1", "Does replay cause it?", { collectionIds: ["ch1"], linkedPaperIds: ["p1"] }),
      question("q2", "Something else", { collectionIds: ["other"] }),
    ];
    const contents = projectContents(COLLECTIONS[0], COLLECTIONS, papers, notes, questions);
    expect(contents.papers.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(contents.notes.map((n) => n.id)).toEqual(["n1"]);
    expect(contents.questions.map((q) => q.id)).toEqual(["q1"]);
    expect(contents.subprojects.map((c) => c.id)).toEqual(["ch1"]);
  });

  it("brings a paper's own notes doc along with the paper", () => {
    const papers = [paper("p1", "Ripples", ["thesis"])];
    const notes = [note("n1", "Notes: Ripples", "", { paperId: "p1" })];
    const contents = projectContents(COLLECTIONS[0], COLLECTIONS, papers, notes, []);
    expect(contents.notes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("keeps a filed question out of another project that shares its papers", () => {
    // The question belongs to "Chapter 1". The paper it cites is filed at the top
    // level of the thesis as well, but that must not drag the question along.
    const papers = [paper("p1", "Ripples", ["thesis", "ch1"])];
    const questions = [question("q1", "Filed in the chapter", { collectionIds: ["ch1"], linkedPaperIds: ["p1"] })];
    const sibling = project("other", "Unrelated", null);
    const collections = [...COLLECTIONS, sibling];
    // Visible in the project it was filed in, and in that project's ancestors.
    expect(projectContents(COLLECTIONS[1], collections, papers, [], questions).questions.map((q) => q.id)).toEqual(["q1"]);
    // Not visible in a project it was never filed in, despite the shared paper.
    const elsewhere = [paper("p1", "Ripples", ["thesis", "ch1", "other"])];
    expect(projectContents(sibling, collections, elsewhere, [], questions).questions).toEqual([]);
  });

  it("includes an unfiled question reached only through a paper in the project", () => {
    const papers = [paper("p1", "Ripples", ["thesis"])];
    const questions = [question("q1", "Reached by evidence", { linkedPaperIds: ["p1"] })];
    const contents = projectContents(COLLECTIONS[0], COLLECTIONS, papers, [], questions);
    expect(contents.questions.map((q) => q.id)).toEqual(["q1"]);
  });

  it("is empty for a project nothing is filed under", () => {
    const contents = projectContents(COLLECTIONS[1], COLLECTIONS, [], [], []);
    expect(contents.papers).toEqual([]);
    expect(contents.notes).toEqual([]);
    expect(contents.questions).toEqual([]);
  });
});

describe("projectPulse", () => {
  it("counts progress across the project", () => {
    const papers = [
      paper("p1", "Read with takeaway", ["thesis"], { takeaway: "Yes." }),
      paper("p2", "Queued", ["thesis"], { readingStatus: "inbox" }),
    ];
    const questions = [
      question("q1", "Evidenced", { collectionIds: ["thesis"], linkedPaperIds: ["p1"] }),
      question("q2", "Bare", { collectionIds: ["thesis"] }),
    ];
    const pulse = projectPulse(projectContents(COLLECTIONS[0], COLLECTIONS, papers, [], questions));
    expect(pulse).toEqual({
      papers: 2, papersRead: 1, takeaways: 1, notes: 0, questions: 2, questionsWithEvidence: 1,
    });
  });
});

describe("projectGaps", () => {
  function gapKinds(proj: Collection, papers: Paper[], notes: Note[], questions: ResearchQuestion[], collections = COLLECTIONS) {
    return projectGaps(proj, projectContents(proj, collections, papers, notes, questions), collections).map((g) => g.kind);
  }

  it("asks for a premise first on an empty new project", () => {
    const bare = project("new", "A hunch");
    const kinds = gapKinds(bare, [], [], [], [bare]);
    expect(kinds[0]).toBe("no-premise");
    expect(kinds).toContain("no-questions");
  });

  it("does not ask for a premise once there is one", () => {
    expect(gapKinds(COLLECTIONS[0], [], [], [])).not.toContain("no-premise");
  });

  it("flags a question with no evidence in this project", () => {
    const papers = [paper("p1", "Ripples", ["thesis"], { takeaway: "Yes." })];
    const questions = [question("q1", "Bare", { collectionIds: ["thesis"] })];
    expect(gapKinds(COLLECTIONS[0], papers, [], questions)).toContain("questions-without-evidence");
  });

  it("does not flag a question whose evidence is in the project", () => {
    const papers = [paper("p1", "Ripples", ["thesis"], { takeaway: "Yes." })];
    const questions = [question("q1", "Evidenced", { collectionIds: ["thesis"], linkedPaperIds: ["p1"] })];
    expect(gapKinds(COLLECTIONS[0], papers, [], questions)).not.toContain("questions-without-evidence");
  });

  it("separates papers never opened from papers read but not digested", () => {
    const papers = [
      paper("p1", "Queued", ["thesis"], { readingStatus: "inbox" }),
      paper("p2", "Opened", ["thesis"], { readingStatus: "reading" }),
    ];
    const kinds = gapKinds(COLLECTIONS[0], papers, [], []);
    expect(kinds).toContain("unread-papers");
    expect(kinds).toContain("papers-without-takeaway");
  });

  it("flags a note that links to nothing, but spares a paper's own notes doc", () => {
    const papers = [paper("p1", "Ripples", ["thesis"], { takeaway: "Yes." })];
    const notes = [
      note("n1", "Loose thought", "no links here", { collectionIds: ["thesis"] }),
      note("n2", "Notes: Ripples", "also no links", { paperId: "p1" }),
    ];
    const gaps = projectGaps(COLLECTIONS[0], projectContents(COLLECTIONS[0], COLLECTIONS, papers, notes, []), COLLECTIONS);
    const inert = gaps.find((g) => g.kind === "notes-linking-nothing");
    expect(inert?.count).toBe(1);
  });

  it("flags a paper nothing in the project refers to", () => {
    const papers = [
      paper("p1", "Ripples", ["thesis"], { takeaway: "Yes." }),
      paper("p2", "Stranded", ["thesis"], { takeaway: "Yes." }),
    ];
    const notes = [note("n1", "Synthesis", "About [[Ripples]]", { collectionIds: ["thesis"] })];
    const gaps = projectGaps(COLLECTIONS[0], projectContents(COLLECTIONS[0], COLLECTIONS, papers, notes, []), COLLECTIONS);
    const stranded = gaps.find((g) => g.kind === "papers-linked-to-nothing");
    expect(stranded?.count).toBe(1);
  });

  it("counts a paper as placed when a related-paper link reaches it", () => {
    const papers = [
      paper("p1", "Ripples", ["thesis"], { takeaway: "Yes.", relatedPaperIds: ["p2"] }),
      paper("p2", "Decoding", ["thesis"], { takeaway: "Yes.", relatedPaperIds: ["p1"] }),
    ];
    expect(gapKinds(COLLECTIONS[0], papers, [], [])).not.toContain("papers-linked-to-nothing");
  });

  it("does not call a lone paper stranded", () => {
    const papers = [paper("p1", "Only one", ["thesis"], { takeaway: "Yes." })];
    expect(gapKinds(COLLECTIONS[0], papers, [], [])).not.toContain("papers-linked-to-nothing");
  });

  it("does not call a subproject empty when the work sits one level below it", () => {
    // Thesis > Chapter 1 > Pilot study. Chapter 1 holds nothing directly, but the
    // pilot study under it is where the reading is.
    const deep = [...COLLECTIONS, project("pilot", "Pilot study", "ch1")];
    const papers = [paper("p1", "Ripples", ["pilot"], { takeaway: "Yes." })];
    const gaps = projectGaps(COLLECTIONS[0], projectContents(COLLECTIONS[0], deep, papers, [], []), deep);
    expect(gaps.find((g) => g.kind === "empty-subprojects")).toBeUndefined();
  });

  it("flags an empty subproject", () => {
    const papers = [paper("p1", "Ripples", ["thesis"], { takeaway: "Yes." })];
    const gaps = projectGaps(COLLECTIONS[0], projectContents(COLLECTIONS[0], COLLECTIONS, papers, [], []), COLLECTIONS);
    expect(gaps.find((g) => g.kind === "empty-subprojects")?.count).toBe(1);
  });

  it("has nothing to say about a project in good shape", () => {
    const collections = [project("solo", "Tight project", null, { premise: "X causes Y." })];
    const papers = [
      paper("p1", "Ripples", ["solo"], { takeaway: "Yes." }),
      paper("p2", "Decoding", ["solo"], { takeaway: "Yes." }),
    ];
    const notes = [note("n1", "Synthesis", "[[Ripples]] against [[Decoding]]", { collectionIds: ["solo"] })];
    const questions = [question("q1", "Does it?", { collectionIds: ["solo"], linkedPaperIds: ["p1", "p2"] })];
    expect(gapKinds(collections[0], papers, notes, questions, collections)).toEqual([]);
  });
});


// projectCounts is a fast path for the sidebar. It must agree with projectContents
// exactly, or a project shows a number its own page contradicts.
describe("projectCounts agrees with projectContents", () => {
  const collections = [
    project("thesis", "Thesis"),
    project("ch1", "Chapter 1", "thesis"),
    project("pilot", "Pilot study", "ch1"),
    project("other", "Unrelated"),
  ];
  const papers = [
    paper("p1", "Filed at the top", ["thesis"]),
    paper("p2", "Filed deep", ["pilot"]),
    paper("p3", "In two branches", ["thesis", "other"]),
    paper("p4", "Filed nowhere", []),
    // Filed in a parent and its own child: must count once, not twice.
    paper("p5", "Parent and child", ["thesis", "ch1"]),
  ];
  const notes = [
    note("n1", "Filed note", "text", { collectionIds: ["ch1"] }),
    note("n2", "Notes on a deep paper", "text", { paperId: "p2" }),
    note("n3", "Unfiled and unattached", "text"),
    // Filed in one branch while documenting a paper in another: belongs to both.
    note("n4", "Filed here, about a paper there", "x", { collectionIds: ["other"], paperId: "p2" }),
  ];
  const questions = [
    question("q1", "Filed question", { collectionIds: ["pilot"] }),
    question("q2", "Unfiled, reached by evidence", { linkedPaperIds: ["p1"] }),
    question("q3", "Unfiled and unevidenced"),
  ];

  it("matches the canonical contents for every project", () => {
    const fast = projectCounts(collections, papers, notes, questions);
    for (const collection of collections) {
      const slow = projectContents(collection, collections, papers, notes, questions);
      expect({ project: collection.name, ...fast.get(collection.id)! }).toEqual({
        project: collection.name,
        papers: slow.papers.length,
        notes: slow.notes.length,
        questions: slow.questions.length,
      });
    }
  });

  it("counts a paper filed in both a parent and its child only once", () => {
    const fast = projectCounts(collections, papers, notes, questions);
    // p1, p3, p5 at the top level, plus p2 through the pilot study beneath it.
    expect(fast.get("thesis")!.papers).toBe(4);
  });
});
