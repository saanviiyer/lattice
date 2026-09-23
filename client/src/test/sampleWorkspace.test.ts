import { describe, it, expect } from "vitest";
import {
  hasSampleWorkspace,
  removeSampleWorkspace,
  SAMPLE_TAG,
  seedSampleWorkspace,
} from "../lib/sampleWorkspace";
import type { Repository } from "../lib/repository";
import { buildGraph } from "../lib/graph";
import { graphInsights } from "../lib/graphAnalysis";
import type { Collection, Note, Paper, PaperMetadata, ResearchQuestion } from "../types";

// A memory-backed stand-in covering only the methods the seeder touches. Cast at the
// end so the test does not have to implement the whole Repository surface.
function fakeRepo() {
  let n = 0;
  const uid = () => `id${++n}`;
  const papers: Paper[] = [];
  const collections: Collection[] = [];
  const notes: Note[] = [];
  const questions: ResearchQuestion[] = [];
  const now = "2026-01-01T00:00:00.000Z";

  const store = {
    papers,
    collections,
    notes,
    questions,
    listPapers: () => [...papers],
    getPaper: (id: string) => papers.find((p) => p.id === id),
    addPaper: (meta: PaperMetadata, opts: { tags?: string[]; collectionIds?: string[] } = {}) => {
      const paper: Paper = {
        ...meta,
        id: uid(),
        tags: opts.tags || [],
        collectionIds: opts.collectionIds || [],
        addedAt: now,
        readingStatus: "inbox",
        relatedPaperIds: [],
      };
      papers.push(paper);
      return paper;
    },
    updatePaper: (id: string, patch: Partial<Paper>) => {
      const paper = papers.find((p) => p.id === id);
      if (paper) Object.assign(paper, patch);
    },
    deletePaper: (id: string) => {
      const i = papers.findIndex((p) => p.id === id);
      if (i >= 0) papers.splice(i, 1);
    },
    listCollections: () => [...collections],
    createCollection: (name: string) => {
      const collection = { id: uid(), name, createdAt: now };
      collections.push(collection);
      return collection;
    },
    deleteCollection: (id: string) => {
      const i = collections.findIndex((c) => c.id === id);
      if (i >= 0) collections.splice(i, 1);
    },
    listNotes: () => [...notes],
    createNote: (input: { title: string; body?: string; paperId?: string }) => {
      const note: Note = {
        id: uid(),
        title: input.title,
        body: input.body || "",
        paperId: input.paperId,
        createdAt: now,
        updatedAt: now,
      };
      notes.push(note);
      return note;
    },
    deleteNote: (id: string) => {
      const i = notes.findIndex((x) => x.id === id);
      if (i >= 0) notes.splice(i, 1);
    },
    listQuestions: () => [...questions],
    createQuestion: (input: { title: string; detail?: string; linkedPaperIds?: string[] }) => {
      const question: ResearchQuestion = {
        id: uid(),
        title: input.title,
        detail: input.detail || "",
        status: "open",
        linkedPaperIds: input.linkedPaperIds || [],
        createdAt: now,
        updatedAt: now,
      };
      questions.push(question);
      return question;
    },
    updateQuestion: (id: string, patch: Partial<ResearchQuestion>) => {
      const question = questions.find((q) => q.id === id);
      if (question) Object.assign(question, patch);
    },
    deleteQuestion: (id: string) => {
      const i = questions.findIndex((q) => q.id === id);
      if (i >= 0) questions.splice(i, 1);
    },
  };

  return { store, repo: store as unknown as Repository };
}

describe("sample workspace", () => {
  it("seeds papers, notes, and questions, all tagged so they stay identifiable", () => {
    const { store, repo } = fakeRepo();
    expect(hasSampleWorkspace(repo)).toBe(false);

    const added = seedSampleWorkspace(repo);
    expect(added).toBe(store.papers.length);
    expect(store.papers.every((p) => p.tags.includes(SAMPLE_TAG))).toBe(true);
    expect(store.notes.length).toBeGreaterThan(0);
    expect(store.questions.length).toBe(2);
    expect(hasSampleWorkspace(repo)).toBe(true);
  });

  // The whole point of the sample is that the guide's graph section has something to
  // point at. If an edit flattens the shape, this test fails rather than the demo.
  it("produces a graph that demonstrates every feature the guide describes", () => {
    const { store, repo } = fakeRepo();
    seedSampleWorkspace(repo);
    const graph = buildGraph(store.papers, store.notes, store.questions);
    const insights = graphInsights(graph);

    // Each node kind is represented.
    const types = new Set(graph.nodes.map((n) => n.type));
    expect(types).toEqual(new Set(["paper", "note", "question"]));

    // Each edge kind is represented.
    const kinds = new Set(graph.edges.map((e) => e.kind));
    expect(kinds).toEqual(
      new Set(["wikilink", "paper-note", "related", "question-paper"])
    );

    // A hub worth pointing at, at least one orphan, more than one island, and exactly
    // one question still lacking evidence.
    expect(insights.hubs[0].degree).toBeGreaterThanOrEqual(3);
    expect(insights.orphans.length).toBeGreaterThan(0);
    expect(insights.componentCount).toBeGreaterThan(1);
    expect(insights.unevidencedQuestions).toHaveLength(1);
  });

  it("removes cleanly and leaves unrelated records alone", () => {
    const { store, repo } = fakeRepo();
    const mine = repo.createNote({ title: "My own note", body: "untouched" });
    seedSampleWorkspace(repo);

    removeSampleWorkspace(repo);
    expect(hasSampleWorkspace(repo)).toBe(false);
    expect(store.papers).toHaveLength(0);
    expect(store.questions).toHaveLength(0);
    expect(store.notes.map((x) => x.id)).toEqual([mine.id]);
    expect(store.collections).toHaveLength(0);
  });

  it("keeps a collection that still holds a paper of the user's own", () => {
    const { store, repo } = fakeRepo();
    seedSampleWorkspace(repo);
    const methods = store.collections.find((c) => c.name === "Methods")!;
    repo.addPaper(
      {
        title: "My own paper",
        authors: [],
        year: null,
        venue: "",
        abstract: "",
        doi: "",
        source: "manual",
      },
      { collectionIds: [methods.id] }
    );

    removeSampleWorkspace(repo);
    expect(store.collections.map((c) => c.name)).toEqual(["Methods"]);
    expect(store.papers.map((p) => p.title)).toEqual(["My own paper"]);
  });
});
