import { describe, it, expect, beforeEach } from "vitest";
import { repo } from "../lib/repository";

// The repository degrades to memory when localStorage is absent (its reads and
// writes are guarded), which is exactly what the node test environment gives us.
// Each test starts from an empty workspace so the shared singleton cannot leak
// state between them.
function reset() {
  repo.replaceWorkspace({
    version: 3,
    exportedAt: "2026-01-01T00:00:00.000Z",
    papers: [],
    collections: [],
    highlights: [],
    notes: [],
    questions: [],
    savedSearches: [],
  });
}

describe("projects and subprojects", () => {
  beforeEach(reset);

  it("creates a subproject under an existing project", () => {
    const thesis = repo.createCollection("Thesis");
    const chapter = repo.createCollection("Chapter 1", thesis.id);
    expect(chapter.parentId).toBe(thesis.id);
  });

  it("ignores a parent that does not exist rather than hiding the project", () => {
    const orphan = repo.createCollection("Loose end", "no-such-id");
    expect(orphan.parentId).toBeNull();
    expect(repo.listCollections().map((c) => c.id)).toContain(orphan.id);
  });

  it("moves a project to another parent and back to the top level", () => {
    const thesis = repo.createCollection("Thesis");
    const reading = repo.createCollection("Reading group");
    repo.moveCollection(reading.id, thesis.id);
    expect(repo.getCollection(reading.id)?.parentId).toBe(thesis.id);
    repo.moveCollection(reading.id, null);
    expect(repo.getCollection(reading.id)?.parentId).toBeNull();
  });

  it("refuses a move that would put a project inside its own subtree", () => {
    const thesis = repo.createCollection("Thesis");
    const chapter = repo.createCollection("Chapter 1", thesis.id);
    const pilot = repo.createCollection("Pilot study", chapter.id);
    repo.moveCollection(thesis.id, pilot.id);
    // Unchanged: the branch stays reachable from the top level.
    expect(repo.getCollection(thesis.id)?.parentId).toBeNull();
    expect(repo.getCollection(pilot.id)?.parentId).toBe(chapter.id);
  });

  it("lifts subprojects up a level when their parent is deleted", () => {
    const thesis = repo.createCollection("Thesis");
    const chapter = repo.createCollection("Chapter 1", thesis.id);
    const pilot = repo.createCollection("Pilot study", chapter.id);
    repo.deleteCollection(chapter.id);
    expect(repo.getCollection(chapter.id)).toBeUndefined();
    // The pilot study survives, now directly under the thesis.
    expect(repo.getCollection(pilot.id)?.parentId).toBe(thesis.id);
  });

  it("un-files papers from a deleted project but keeps the papers", () => {
    const thesis = repo.createCollection("Thesis");
    const paper = repo.addPaper(
      { title: "A paper", authors: [], year: 2026, venue: "", abstract: "", doi: "10.1/abc", source: "manual" },
      { collectionIds: [thesis.id] }
    );
    repo.deleteCollection(thesis.id);
    expect(repo.getPaper(paper.id)?.collectionIds).toEqual([]);
  });

  it("stores a colour on a project", () => {
    const thesis = repo.createCollection("Thesis");
    repo.updateCollection(thesis.id, { color: "teal" });
    expect(repo.getCollection(thesis.id)?.color).toBe("teal");
    repo.updateCollection(thesis.id, { color: undefined });
    expect(repo.getCollection(thesis.id)?.color).toBeUndefined();
  });

  it("applies a rename and a move given together", () => {
    const thesis = repo.createCollection("Thesis");
    const reading = repo.createCollection("Reading group");
    repo.updateCollection(reading.id, { name: "Journal club", parentId: thesis.id });
    expect(repo.getCollection(reading.id)?.name).toBe("Journal club");
    expect(repo.getCollection(reading.id)?.parentId).toBe(thesis.id);
  });
});

describe("a project holds papers, notes, and questions", () => {
  beforeEach(reset);

  function samplePaper(title: string, collectionIds: string[]) {
    return repo.addPaper(
      { title, authors: [], year: 2026, venue: "", abstract: "", doi: "", source: "manual" },
      { collectionIds }
    );
  }

  it("files a note into projects and back out again", () => {
    const thesis = repo.createCollection("Thesis");
    const note = repo.createNote({ title: "Synthesis", collectionIds: [thesis.id] });
    expect(repo.getNote(note.id)?.collectionIds).toEqual([thesis.id]);
    repo.setNoteCollections(note.id, []);
    expect(repo.getNote(note.id)?.collectionIds).toEqual([]);
  });

  it("files a question into a project", () => {
    const thesis = repo.createCollection("Thesis");
    const question = repo.createQuestion({ title: "Does it?", collectionIds: [thesis.id] });
    expect(repo.listQuestions()[0].collectionIds).toEqual([thesis.id]);
    repo.setQuestionCollections(question.id, []);
    expect(repo.listQuestions()[0].collectionIds).toEqual([]);
  });

  it("drops a project id that does not exist rather than storing a dangling link", () => {
    const note = repo.createNote({ title: "Loose", collectionIds: ["ghost"] });
    expect(repo.getNote(note.id)?.collectionIds).toEqual([]);
  });

  it("releases papers, notes, and questions when the project is deleted", () => {
    const thesis = repo.createCollection("Thesis");
    const paper = samplePaper("Ripples", [thesis.id]);
    const note = repo.createNote({ title: "Synthesis", collectionIds: [thesis.id] });
    const question = repo.createQuestion({ title: "Does it?", collectionIds: [thesis.id] });

    repo.deleteCollection(thesis.id);

    // All three survive; none still points at the deleted project.
    expect(repo.getPaper(paper.id)?.collectionIds).toEqual([]);
    expect(repo.getNote(note.id)?.collectionIds).toEqual([]);
    expect(repo.listQuestions().find((q) => q.id === question.id)?.collectionIds).toEqual([]);
  });

  it("keeps a project's premise and status", () => {
    const thesis = repo.createCollection("Thesis");
    repo.updateCollection(thesis.id, { premise: "Replay causes consolidation.", status: "active" });
    expect(repo.getCollection(thesis.id)?.premise).toBe("Replay causes consolidation.");
    expect(repo.getCollection(thesis.id)?.status).toBe("active");
  });

  it("survives a backup round trip with the new fields intact", () => {
    const thesis = repo.createCollection("Thesis");
    repo.updateCollection(thesis.id, { premise: "X causes Y.", status: "writing", color: "blue" });
    repo.createCollection("Chapter 1", thesis.id);
    repo.createNote({ title: "Synthesis", collectionIds: [thesis.id] });
    repo.createQuestion({ title: "Does it?", collectionIds: [thesis.id] });

    const snapshot = repo.exportWorkspace();
    reset();
    repo.replaceWorkspace(snapshot);

    const restored = repo.getCollection(thesis.id);
    expect(restored?.premise).toBe("X causes Y.");
    expect(restored?.status).toBe("writing");
    expect(restored?.color).toBe("blue");
    expect(repo.listCollections().find((c) => c.name === "Chapter 1")?.parentId).toBe(thesis.id);
    expect(repo.listNotes()[0].collectionIds).toEqual([thesis.id]);
    expect(repo.listQuestions()[0].collectionIds).toEqual([thesis.id]);
  });
});
