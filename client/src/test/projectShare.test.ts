import { describe, it, expect, beforeEach } from "vitest";
import type { Collection, Highlight, Note, Paper, ResearchQuestion } from "../types";
import { repo } from "../lib/repository";
import {
  buildProjectShare,
  createProjectShare,
  importProjectShare,
  readProjectShare,
  parseProjectShare,
  projectShareFilename,
  type ShareOptions,
} from "../lib/projectShare";

const NOW = "2026-01-01T00:00:00.000Z";
const FULL: ShareOptions = { sharedBy: "Alice", includeThinking: true, includePdfs: false };

function reset() {
  repo.replaceWorkspace({
    version: 3, exportedAt: NOW, papers: [], collections: [],
    highlights: [], notes: [], questions: [], savedSearches: [],
  });
}

// ---- The sender's library, built by hand so the share is deterministic ----
const SENDER = (() => {
  const collections: Collection[] = [
    { id: "replay", name: "Replay", parentId: null, createdAt: NOW, color: "red",
      premise: "Replay consolidates memory.", status: "active" },
    { id: "ripple", name: "Ripple detection", parentId: "replay", createdAt: NOW, color: "yellow" },
    { id: "other", name: "Unrelated project", parentId: null, createdAt: NOW },
  ];
  const papers: Paper[] = [
    { id: "p1", title: "Sharp-wave ripples", authors: ["Ada Lovelace"], year: 2019, venue: "Neuron",
      abstract: "Ripples recur.", doi: "10.1/ripples", source: "manual", tags: ["replay"],
      collectionIds: ["replay", "other"], addedAt: NOW, readingStatus: "read",
      takeaway: "Ripple rate predicts recall.", hasPdf: true, pdfText: "bulky extracted text",
      relatedPaperIds: ["p2", "pX"] },
    { id: "p2", title: "Decoding spike trains", authors: ["Grace Hopper"], year: 2017, venue: "JNeuro",
      abstract: "", doi: "", arxivId: "1701.00001", source: "arxiv", tags: [],
      collectionIds: ["ripple"], addedAt: NOW, readingStatus: "inbox" },
    { id: "pX", title: "Not in this project", authors: [], year: 2020, venue: "", abstract: "",
      doi: "10.1/other", source: "manual", tags: [], collectionIds: ["other"], addedAt: NOW },
  ];
  const notes: Note[] = [
    { id: "n1", title: "Synthesis", body: "Rests on [[Sharp-wave ripples]].",
      collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
    { id: "n2", title: "Elsewhere", body: "Different project.", collectionIds: ["other"],
      createdAt: NOW, updatedAt: NOW },
  ];
  const questions: ResearchQuestion[] = [
    { id: "q1", title: "Does replay cause consolidation?", detail: "Needs a control.",
      status: "exploring", linkedPaperIds: ["p1", "pX"], collectionIds: ["replay"],
      createdAt: NOW, updatedAt: NOW },
  ];
  const highlights: Highlight[] = [
    { id: "h1", paperId: "p1", page: 4, color: "yellow", text: "Ripple density correlated with recall.",
      note: "The number to reproduce.", rects: [], createdAt: NOW },
    { id: "h2", paperId: "pX", page: 1, color: "blue", text: "Out of scope.", rects: [], createdAt: NOW },
  ];
  return { collections, papers, notes, questions, highlights };
})();

function share(options: ShareOptions = FULL) {
  return buildProjectShare(
    SENDER.collections[0], SENDER.collections, SENDER.papers, SENDER.notes,
    SENDER.questions, SENDER.highlights, options, new Date(NOW)
  );
}

describe("buildProjectShare", () => {
  it("takes the project and its subprojects, and nothing else", () => {
    expect(share().collections.map((c) => c.id)).toEqual(["replay", "ripple"]);
  });

  it("takes the papers of the project and its subprojects", () => {
    expect(share().papers.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("strips membership of projects that are not travelling", () => {
    const paper = share().papers.find((p) => p.id === "p1")!;
    expect(paper.collectionIds).toEqual(["replay"]);
  });

  it("drops relations pointing outside the shared project", () => {
    expect(share().papers.find((p) => p.id === "p1")!.relatedPaperIds).toEqual(["p2"]);
  });

  it("drops questions' links to papers that are not travelling", () => {
    expect(share().questions[0].linkedPaperIds).toEqual(["p1"]);
  });

  it("leaves bulky extracted PDF text out of the bundle", () => {
    expect(share().papers.find((p) => p.id === "p1")!.pdfText).toBeUndefined();
  });

  it("marks papers as having no PDF when the files are not included", () => {
    expect(share().papers.every((p) => !p.hasPdf)).toBe(true);
  });

  it("omits notes, takeaways, and highlights when sharing just the reading list", () => {
    const listOnly = share({ ...FULL, includeThinking: false });
    expect(listOnly.notes).toEqual([]);
    expect(listOnly.highlights).toEqual([]);
    expect(listOnly.papers.every((p) => p.takeaway === undefined)).toBe(true);
    // The questions are the shape of the inquiry, so they still travel.
    expect(listOnly.questions).toHaveLength(1);
  });

  it("carries the sender's name and the project's premise", () => {
    const bundle = share();
    expect(bundle.sharedBy).toBe("Alice");
    expect(bundle.collections[0].premise).toBe("Replay consolidates memory.");
  });
});

describe("parseProjectShare", () => {
  it("accepts a well-formed share", () => {
    expect(parseProjectShare(JSON.parse(JSON.stringify(share()))).rootId).toBe("replay");
  });

  it("rejects anything else, including a workspace backup", () => {
    for (const bad of [null, {}, { kind: "lattice.workspace", version: 1 }, { ...share(), version: 9 }]) {
      expect(() => parseProjectShare(bad)).toThrow(/not a lattice shared project/);
    }
  });

  it("rejects a share whose root is not among its projects", () => {
    expect(() => parseProjectShare({ ...share(), rootId: "missing" })).toThrow();
  });
});

describe("importProjectShare into an empty library", () => {
  beforeEach(reset);

  it("recreates the project tree with fresh ids", async () => {
    const summary = await importProjectShare(share());
    const projects = repo.listCollections();
    expect(summary.projects).toBe(2);
    const root = projects.find((c) => c.name === "Replay")!;
    const child = projects.find((c) => c.name === "Ripple detection")!;
    expect(root.id).not.toBe("replay");
    expect(child.parentId).toBe(root.id);
    expect(root.premise).toBe("Replay consolidates memory.");
    expect(root.status).toBe("active");
    expect(root.color).toBe("red");
  });

  it("brings the papers, notes, questions, and highlights", async () => {
    const summary = await importProjectShare(share());
    expect(summary.papersAdded).toBe(2);
    expect(summary.papersAlreadyHad).toBe(0);
    expect(repo.listNotes()).toHaveLength(1);
    expect(repo.listQuestions()).toHaveLength(1);
    const paper = repo.listPapers().find((p) => p.title === "Sharp-wave ripples")!;
    expect(paper.takeaway).toBe("Ripple rate predicts recall.");
    expect(repo.listHighlights(paper.id)).toHaveLength(1);
    expect(summary.highlights).toBe(1);
  });

  it("remaps question links to the local copies of the papers", async () => {
    await importProjectShare(share());
    const paper = repo.listPapers().find((p) => p.title === "Sharp-wave ripples")!;
    expect(repo.listQuestions()[0].linkedPaperIds).toEqual([paper.id]);
    expect(repo.listQuestions()[0].status).toBe("exploring");
  });

  it("files the imported records into the imported project", async () => {
    await importProjectShare(share());
    const root = repo.listCollections().find((c) => c.name === "Replay")!;
    const paper = repo.listPapers().find((p) => p.title === "Sharp-wave ripples")!;
    expect(paper.collectionIds).toContain(root.id);
    expect(repo.listNotes()[0].collectionIds).toContain(root.id);
    expect(repo.listQuestions()[0].collectionIds).toContain(root.id);
  });

  it("attaches PDFs only when the bundle carries them", async () => {
    const summary = await importProjectShare(share(), {});
    expect(summary.pdfs).toBe(0);
  });
});

describe("importProjectShare into a library that overlaps", () => {
  beforeEach(reset);

  it("does not duplicate a paper the recipient already has", async () => {
    const mine = repo.addPaper({
      title: "Sharp-wave ripples", authors: ["Ada Lovelace"], year: 2019, venue: "Neuron",
      abstract: "", doi: "10.1/ripples", source: "manual",
    });
    const summary = await importProjectShare(share());
    expect(summary.papersAlreadyHad).toBe(1);
    expect(summary.papersAdded).toBe(1);
    expect(repo.listPapers().filter((p) => p.doi === "10.1/ripples")).toHaveLength(1);
    // My copy is now also filed in the imported project.
    const root = repo.listCollections().find((c) => c.name === "Replay")!;
    expect(repo.getPaper(mine.id)!.collectionIds).toContain(root.id);
  });

  it("never overwrites my own takeaway with the sender's", async () => {
    const mine = repo.addPaper({
      title: "Sharp-wave ripples", authors: [], year: 2019, venue: "", abstract: "",
      doi: "10.1/ripples", source: "manual",
    });
    repo.updatePaper(mine.id, { takeaway: "My own reading of this." });
    await importProjectShare(share());
    expect(repo.getPaper(mine.id)!.takeaway).toBe("My own reading of this.");
  });

  it("does not drop the sender's highlights onto a paper I have already annotated", async () => {
    const mine = repo.addPaper({
      title: "Sharp-wave ripples", authors: [], year: 2019, venue: "", abstract: "",
      doi: "10.1/ripples", source: "manual",
    });
    repo.addHighlight({ paperId: mine.id, page: 1, color: "green", text: "Mine.", rects: [] });
    const summary = await importProjectShare(share());
    expect(summary.highlights).toBe(0);
    const highlights = repo.listHighlights(mine.id);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].text).toBe("Mine.");
  });

  it("renames the incoming project when I already have one by that name", async () => {
    repo.createCollection("Replay");
    await importProjectShare(share());
    const names = repo.listCollections().map((c) => c.name);
    expect(names).toContain("Replay");
    expect(names).toContain("Replay (from Alice)");
    // The subproject keeps its own name; it is distinguished by its parent.
    expect(names).toContain("Ripple detection");
  });

  it("reports the id of the project it created, not one that already existed", async () => {
    const mine = repo.createCollection("Replay");
    const summary = await importProjectShare(share());
    // The obvious lookup — first project whose name starts with "Replay" — would
    // return the recipient's own project and send them to the wrong page.
    expect(summary.projectId).not.toBe(mine.id);
    expect(repo.getCollection(summary.projectId)!.name).toBe("Replay (from Alice)");
    expect(summary.projectName).toBe("Replay (from Alice)");
  });

  it("renames an incoming note whose title I already use, so wikilinks stay unambiguous", async () => {
    repo.createNote({ title: "Synthesis", body: "Mine." });
    await importProjectShare(share());
    const titles = repo.listNotes().map((n) => n.title);
    expect(titles).toContain("Synthesis");
    expect(titles).toContain("Synthesis (from Alice)");
    expect(repo.listNotes().find((n) => n.title === "Synthesis")!.body).toBe("Mine.");
  });

  it("leaves my unrelated records completely alone", async () => {
    const untouched = repo.addPaper({
      title: "Something else entirely", authors: [], year: 2001, venue: "", abstract: "",
      doi: "10.9/mine", source: "manual",
    });
    const myNote = repo.createNote({ title: "My private note", body: "Untouched." });
    await importProjectShare(share());
    expect(repo.getPaper(untouched.id)!.title).toBe("Something else entirely");
    expect(repo.getNote(myNote.id)!.body).toBe("Untouched.");
  });

  it("is idempotent enough that importing twice does not duplicate the papers", async () => {
    await importProjectShare(share());
    await importProjectShare(share());
    expect(repo.listPapers()).toHaveLength(2);
    // The projects do come again, which is right: a second import is a second copy
    // of somebody's project, and merging them silently would be a guess.
    expect(repo.listCollections().filter((c) => c.name.startsWith("Replay"))).toHaveLength(2);
  });
});

describe("projectShareFilename", () => {
  it("slugs the project name and dates the file", () => {
    expect(projectShareFilename("Replay & Consolidation", new Date(NOW)))
      .toBe("lattice-replay-consolidation-2026-01-01.latticeproject");
  });

  it("falls back when the name has nothing sluggable in it", () => {
    expect(projectShareFilename("!!!", new Date(NOW)))
      .toBe("lattice-project-2026-01-01.latticeproject");
  });
});

describe("the share file itself", () => {
  beforeEach(reset);

  it("round-trips through a real .latticeproject archive", async () => {
    // Build a sender's library in the repository, so createProjectShare reads it
    // the way it does in the app.
    const replay = repo.createCollection("Replay");
    repo.updateCollection(replay.id, { premise: "Replay consolidates memory.", status: "active" });
    const ripple = repo.createCollection("Ripple detection", replay.id);
    const p1 = repo.addPaper(
      { title: "Sharp-wave ripples", authors: ["Ada Lovelace"], year: 2019, venue: "Neuron",
        abstract: "Ripples recur.", doi: "10.1/ripples", source: "manual" },
      { collectionIds: [replay.id] }
    );
    repo.updatePaper(p1.id, { takeaway: "Ripple rate predicts recall." });
    repo.addPaper(
      { title: "Decoding spike trains", authors: ["Grace Hopper"], year: 2017, venue: "JNeuro",
        abstract: "", doi: "10.2/decoding", source: "manual" },
      { collectionIds: [ripple.id] }
    );
    repo.createNote({ title: "Synthesis", body: "Rests on [[Sharp-wave ripples]].", collectionIds: [replay.id] });
    repo.createQuestion({ title: "Does replay cause consolidation?", linkedPaperIds: [p1.id], collectionIds: [replay.id] });
    repo.addHighlight({ paperId: p1.id, page: 4, color: "yellow", text: "Density correlated with recall.", rects: [] });

    const blob = await createProjectShare(repo.getCollection(replay.id)!, {
      sharedBy: "Alice", includeThinking: true, includePdfs: false,
    });
    expect(blob.size).toBeGreaterThan(0);

    // Now be the recipient: a completely separate library.
    reset();
    const { share: parsed, pdfs } = await readProjectShare(blob);
    expect(parsed.sharedBy).toBe("Alice");
    expect(pdfs).toEqual({});

    const summary = await importProjectShare(parsed, pdfs);
    expect(summary.projectName).toBe("Replay");
    expect(summary.sharedBy).toBe("Alice");
    expect(summary.projects).toBe(2);
    expect(summary.papersAdded).toBe(2);
    expect(summary.notes).toBe(1);
    expect(summary.questions).toBe(1);
    expect(summary.highlights).toBe(1);

    const root = repo.listCollections().find((c) => c.name === "Replay")!;
    expect(root.premise).toBe("Replay consolidates memory.");
    expect(repo.listCollections().find((c) => c.name === "Ripple detection")!.parentId).toBe(root.id);
    const landed = repo.listPapers().find((p) => p.doi === "10.1/ripples")!;
    expect(landed.takeaway).toBe("Ripple rate predicts recall.");
    expect(repo.listHighlights(landed.id)).toHaveLength(1);
    // The wikilink in the imported note resolves to the imported paper by title.
    expect(repo.listNotes()[0].body).toContain("[[Sharp-wave ripples]]");
  });

  it("refuses a workspace backup with a clear message", async () => {
    const { strToU8, zipSync } = await import("fflate");
    const notAShare = new Blob([
      Uint8Array.from(zipSync({ "project.json": strToU8(JSON.stringify({ version: 3, papers: [] })) })).buffer,
    ]);
    await expect(readProjectShare(notAShare)).rejects.toThrow(/not a lattice shared project/);
  });

  it("refuses an archive with no manifest in it", async () => {
    const { strToU8, zipSync } = await import("fflate");
    const empty = new Blob([Uint8Array.from(zipSync({ "readme.txt": strToU8("hello") })).buffer]);
    await expect(readProjectShare(empty)).rejects.toThrow(/missing project\.json/);
  });
});
