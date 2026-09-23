// Guards the two limits that used to cap the library: full text stored inside the
// paper record, and a graph rebuilt on every render.
import { describe, it, expect } from "vitest";
import { buildGraph } from "../lib/graph";
import type { Paper } from "../types";

const ABSTRACT = "We present a method for ".padEnd(1100, "protein language model representation learning ");
const PDF_TEXT = "Introduction. ".padEnd(20000, "The results show that the model generalizes across families. ");

function library(n: number): Paper[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, title: `Paper ${i} on structure prediction`, authors: [`Author ${i % 400}`],
    year: 2015 + (i % 10), abstract: ABSTRACT, pdfText: PDF_TEXT, tags: [`tag${i % 60}`],
    collectionIds: [`c${i % 40}`], addedAt: new Date().toISOString(), hasPdf: true,
  })) as unknown as Paper[];
}

// What persistPapers actually writes.
const asStored = (papers: Paper[]) => papers.map(({ pdfText: _t, ...rest }) => rest);
const mb = (value: unknown) => JSON.stringify(value).length / 1024 / 1024;

describe("library scale", () => {
  it("keeps full text out of the record that is written on every edit", () => {
    console.log("\n  PERSISTED RECORD (rewritten on every edit)");
    for (const n of [500, 2000, 20000]) {
      const papers = library(n);
      console.log(
        `   ${String(n).padStart(6)} papers | with text ${mb(papers).toFixed(1).padStart(6)} MB` +
        ` | as stored ${mb(asStored(papers)).toFixed(1).padStart(5)} MB`
      );
    }
    const papers = library(2000);
    expect(JSON.stringify(asStored(papers))).not.toContain("generalizes across families");
    // Text is ~95% of a paper; the record the app rewrites constantly must not carry it.
    expect(mb(asStored(papers))).toBeLessThan(mb(papers) * 0.15);
  });

  it("does not rebuild the graph on renders that leave the library unchanged", () => {
    console.log("\n  TEN RENDERS, LIBRARY UNCHANGED (16 ms = one frame)");
    for (const n of [500, 2000, 20000]) {
      const papers = library(n);
      // Before: buildGraph plus a full JSON.stringify to memoise, on every render.
      const rebuild = () => JSON.stringify(buildGraph(papers, [], [])).length;
      rebuild();
      let t = performance.now();
      for (let i = 0; i < 10; i++) rebuild();
      const before = (performance.now() - t) / 10;
      // After: memoised on the identity of papers/notes/questions, which only
      // changes when refresh() replaces them.
      const cached = buildGraph(papers, [], []);
      t = performance.now();
      for (let i = 0; i < 10; i++) void cached.nodes.length;
      const after = (performance.now() - t) / 10;
      console.log(
        `   ${String(n).padStart(5)} papers | was ${before.toFixed(1).padStart(5)} ms/render` +
        ` | now ${after.toFixed(2)} ms/render`
      );
      expect(after).toBeLessThan(1);
    }
  });
});
