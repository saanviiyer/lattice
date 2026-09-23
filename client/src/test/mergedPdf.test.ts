// The merge's contract: page numbers that match where the reader actually lands, and
// an honest account of what could not be bound in.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import type { Paper } from "../types";

// Stand-ins for the two browser-only modules the merge touches.
const pdfs = new Map<string, Blob>();
vi.mock("../lib/blobStore", () => ({
  getPdf: async (id: string) => pdfs.get(id) ?? null,
}));
vi.mock("../lib/annotatedPdf", () => ({
  createAnnotatedPdf: async (blob: Blob) => blob,
}));

const { buildMergedPdf, buildGroupedPdf } = await import("../lib/mergedPdf");
const { librarySections, UNFILED_SECTION } = await import("../lib/librarySections");

async function makePdf(pages: number): Promise<Blob> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595, 842]);
  const bytes = await doc.save();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
}

function paper(id: string, title: string, hasPdf = true): Paper {
  return {
    id, title, authors: ["Ada Lovelace"], year: 2021, venue: "Nature", abstract: "",
    doi: `10.1/${id}`, tags: [], collectionIds: [], addedAt: "2024-01-01T00:00:00Z", hasPdf,
  } as unknown as Paper;
}

beforeEach(() => pdfs.clear());

describe("binding a project into one PDF", () => {
  it("gives each paper the page the reader actually lands on", async () => {
    pdfs.set("a", await makePdf(3));
    pdfs.set("b", await makePdf(5));
    pdfs.set("c", await makePdf(2));

    const result = await buildMergedPdf(
      [paper("a", "First"), paper("b", "Second"), paper("c", "Third")],
      { title: "Test project" }
    );

    // cover + one contents page = 2, so the first divider is page 3.
    expect(result.included.map((e) => e.page)).toEqual([3, 7, 13]);
    // Each divider sits exactly one page plus the previous paper after the last.
    for (let i = 1; i < result.included.length; i += 1) {
      const previous = result.included[i - 1];
      expect(result.included[i].page).toBe(previous.page + 1 + previous.pages);
    }
    expect(result.totalPages).toBe(2 + 3 * 1 + 3 + 5 + 2);
  });

  it("keeps the numbering right when the contents spills onto a second page", async () => {
    // Enough papers that the contents cannot fit on one page.
    const many: Paper[] = [];
    for (let i = 0; i < 40; i += 1) {
      const id = `p${i}`;
      pdfs.set(id, await makePdf(1));
      many.push(paper(id, `Paper number ${i} with a reasonably long title to wrap`));
    }

    const result = await buildMergedPdf(many, { title: "Big project" });
    const doc = await PDFDocument.load(await result.blob.arrayBuffer());

    // Whatever the front matter grew to, the first divider is right after it, and the
    // recorded numbers still step correctly.
    const front = result.included[0].page - 1;
    expect(front).toBeGreaterThan(2); // cover + at least two contents pages
    expect(doc.getPageCount()).toBe(front + many.length * 2);
    for (let i = 1; i < result.included.length; i += 1) {
      expect(result.included[i].page).toBe(result.included[i - 1].page + 2);
    }
  });

  it("reports the papers it could not include instead of dropping them", async () => {
    pdfs.set("ok", await makePdf(2));
    pdfs.set("broken", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/pdf" }));

    const result = await buildMergedPdf(
      [paper("ok", "Fine"), paper("broken", "Corrupt"), paper("none", "No file", false)],
      { title: "Mixed" }
    );

    expect(result.included.map((e) => e.paper.title)).toEqual(["Fine"]);
    expect(result.missing.map((p) => p.title)).toEqual(["No file"]);
    expect(result.failed.map((f) => f.paper.title)).toEqual(["Corrupt"]);
  });

  it("writes bookmarks that chain all the way through", async () => {
    for (const id of ["a", "b", "c"]) pdfs.set(id, await makePdf(2));
    const result = await buildMergedPdf(
      [paper("a", "Alpha"), paper("b", "Beta"), paper("c", "Gamma")],
      { title: "Outlined" }
    );

    const doc = await PDFDocument.load(await result.blob.arrayBuffer());
    const outlines = doc.catalog.get(PDFName.of("Outlines"));
    expect(outlines).toBeTruthy();

    const dict: any = doc.context.lookup(outlines!);
    let ref = dict.get(PDFName.of("First"));
    const titles: string[] = [];
    while (ref && titles.length < 10) {
      const item: any = doc.context.lookup(ref);
      if (!item) break;
      titles.push(item.get(PDFName.of("Title")).decodeText());
      ref = item.get(PDFName.of("Next"));
    }
    expect(titles).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("does not fail on titles the PDF standard fonts cannot encode", async () => {
    // Curly quotes, an en dash, Greek and an accent — all routine in paper titles, and
    // all of which make pdf-lib throw on the whole document if drawn raw.
    pdfs.set("x", await makePdf(1));
    const result = await buildMergedPdf(
      [paper("x", "α-helix “folding” — Kraüt et al., 20 °C…")],
      { title: "Ünicode ‘project’ — β" }
    );
    expect(result.included).toHaveLength(1);
    const doc = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(doc.getPageCount()).toBeGreaterThan(2);
  });
});

describe("binding the whole library, grouped by project", () => {
  function filed(id: string, title: string, collectionIds: string[], hasPdf = true): Paper {
    return { ...paper(id, title, hasPdf), collectionIds } as Paper;
  }

  const collections = [
    { id: "proteins", name: "Proteins", createdAt: "", premise: "Folding is mostly local." },
    { id: "folding", name: "Folding", createdAt: "", parentId: "proteins" },
    { id: "empty", name: "Empty", createdAt: "" },
    { id: "brains", name: "Brains", createdAt: "" },
  ] as any[];

  it("lists every project, subprojects under their parent, and the unfiled papers last", () => {
    const sections = librarySections(collections, [
      filed("b", "Beta", ["proteins"]),
      filed("a", "Alpha", ["proteins", "folding"]),
      filed("n", "Neuron", ["brains"]),
      filed("u", "Loose", []),
      filed("g", "Ghost", ["deleted-project"]),
    ]);
    expect(sections.map((s) => [s.title, s.depth, s.papers.map((p) => p.title)])).toEqual([
      ["Proteins", 0, ["Alpha", "Beta"]],
      ["Folding", 1, ["Alpha"]],
      ["Brains", 0, ["Neuron"]],
      [UNFILED_SECTION, 0, ["Ghost", "Loose"]],
    ]);
    expect(sections[1]!.context).toBe("Proteins");
  });

  it("keeps a parent heading when only its subprojects hold papers", () => {
    const sections = librarySections(collections, [filed("a", "Alpha", ["folding"])]);
    expect(sections.map((s) => [s.title, s.papers.length])).toEqual([["Proteins", 0], ["Folding", 1]]);
  });

  it("binds a paper filed in two places once, and gives headings real page numbers", async () => {
    pdfs.set("a", await makePdf(3));
    pdfs.set("b", await makePdf(2));
    pdfs.set("u", await makePdf(1));
    const sections = librarySections(collections, [
      filed("a", "Alpha", ["proteins", "folding"]),
      filed("b", "Beta", ["folding"]),
      filed("u", "Loose", []),
      filed("x", "No file", ["folding"], false),
    ]);

    const result = await buildGroupedPdf(sections, { title: "Library" });
    const doc = await PDFDocument.load(await result.blob.arrayBuffer());

    expect(result.included.map((e) => e.paper.title)).toEqual(["Alpha", "Beta", "Loose"]);
    expect(result.missing.map((p) => p.title)).toEqual(["No file"]);
    // cover, contents, then: Proteins heading (3), Alpha divider (4) + 3 pages,
    // Folding heading (8), Beta divider (9) + 2 pages, unfiled heading (12), Loose (13) + 1.
    expect(result.sections.map((s) => [s.title, s.page])).toEqual([
      ["Proteins", 3], ["Folding", 8], [UNFILED_SECTION, 12],
    ]);
    expect(result.included.map((e) => e.page)).toEqual([4, 9, 13]);
    expect(doc.getPageCount()).toBe(14);
    expect(result.totalPages).toBe(14);
  });

  it("nests each project's papers inside its bookmark", async () => {
    pdfs.set("a", await makePdf(1));
    pdfs.set("n", await makePdf(1));
    const sections = librarySections(collections, [
      filed("a", "Alpha", ["proteins", "folding"]),
      filed("n", "Neuron", ["brains"]),
    ]);
    const result = await buildGroupedPdf(sections, { title: "Library" });
    const doc = await PDFDocument.load(await result.blob.arrayBuffer());

    const walk = (ref: any): any[] => {
      const out: any[] = [];
      while (ref) {
        const item: any = doc.context.lookup(ref);
        const first = item.get(PDFName.of("First"));
        const title = item.get(PDFName.of("Title")).decodeText();
        out.push(first ? [title, walk(first)] : title);
        ref = item.get(PDFName.of("Next"));
      }
      return out;
    };
    const root: any = doc.context.lookup(doc.catalog.get(PDFName.of("Outlines"))!);
    expect(walk(root.get(PDFName.of("First")))).toEqual([
      ["Proteins", ["Alpha", ["Folding", ["Alpha"]]]],
      ["Brains", ["Neuron"]],
    ]);
  });
});
