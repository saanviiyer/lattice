import { describe, it, expect } from "vitest";
import {
  buildTitleIndex,
  resolveLinks,
  backlinksFor,
  buildGraph,
} from "../lib/graph";
import type { Note, Paper } from "../types";

function paper(id: string, title: string): Paper {
  return {
    id,
    title,
    authors: [],
    year: null,
    venue: "",
    abstract: "",
    doi: "",
    source: "manual",
    tags: [],
    collectionIds: [],
    addedAt: "2026-01-01T00:00:00.000Z",
  };
}

function note(
  id: string,
  title: string,
  body: string,
  paperId?: string
): Note {
  return {
    id,
    title,
    body,
    paperId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// A small sample workspace used across the graph tests.
//   p1 "Transformers"      <- linked by n1 and n2
//   p2 "Diffusion Models"  <- linked by n2
//   n1 "Reading log"       -> [[Transformers]]
//   n2 "Comparison"        -> [[Transformers]], [[Diffusion Models]]
//   n3 "Notes on Transformers" (paperId p1)  -> [[Comparison]]
const papers = [paper("p1", "Transformers"), paper("p2", "Diffusion Models")];
const notes = [
  note("n1", "Reading log", "I keep coming back to [[Transformers]]."),
  note("n2", "Comparison", "Contrast [[Transformers]] with [[Diffusion Models]]."),
  note("n3", "Notes on Transformers", "See [[Comparison]] for the tradeoffs.", "p1"),
];

describe("resolveLinks", () => {
  it("resolves wikilinks to node ids and drops unknown targets", () => {
    const index = buildTitleIndex(papers, notes);
    const withUnknown = note("x", "x", "[[Transformers]] and [[Nonexistent]]");
    expect(resolveLinks(withUnknown.id, withUnknown.body, index)).toEqual(["p1"]);
  });

  it("drops self-links", () => {
    const index = buildTitleIndex(papers, notes);
    const selfy = note("n2", "Comparison", "[[Comparison]] links itself");
    expect(resolveLinks(selfy.id, selfy.body, index)).toEqual([]);
  });
});

describe("backlinksFor", () => {
  it("finds every note that links a target", () => {
    const index = buildTitleIndex(papers, notes);
    const backs = backlinksFor("p1", notes, index).map((n) => n.id).sort();
    expect(backs).toEqual(["n1", "n2"]);
  });

  it("returns [] when nothing links the target", () => {
    const index = buildTitleIndex(papers, notes);
    // p2 (Diffusion Models) is linked by n2 only.
    expect(backlinksFor("p2", notes, index).map((n) => n.id)).toEqual(["n2"]);
    // A lonely paper with no inbound links.
    const lonely = [...papers, paper("p3", "Untouched")];
    expect(backlinksFor("p3", notes, buildTitleIndex(lonely, notes))).toEqual([]);
  });
});

describe("buildGraph", () => {
  it("creates a node per paper and note", () => {
    const g = buildGraph(papers, notes);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2", "n3", "p1", "p2"]);
    expect(g.nodes.find((n) => n.id === "p1")).toMatchObject({
      type: "paper",
      label: "Transformers",
    });
  });

  it("creates wikilink and paper-note edges, deduplicated and undirected", () => {
    const g = buildGraph(papers, notes);
    const key = (e: { source: string; target: string }) =>
      [e.source, e.target].sort().join("::");
    const keys = g.edges.map(key).sort();
    // n1->p1, n2->p1, n2->p2, n3->n2 (wikilink), n3->p1 (paper-note)
    expect(keys).toEqual(["n1::p1", "n2::n3", "n2::p1", "n2::p2", "n3::p1"]);
  });

  it("collapses a duplicate relation (attached-to AND links) into one edge", () => {
    // n4 both is attached to p1 and links [[Transformers]] -> single edge.
    const n4 = note("n4", "Dup", "Notes about [[Transformers]].", "p1");
    const g = buildGraph(papers, [n4]);
    const p1Edges = g.edges.filter(
      (e) => e.source === "n4" || e.target === "n4"
    );
    expect(p1Edges).toHaveLength(1);
  });
});
