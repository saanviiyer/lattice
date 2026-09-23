import { describe, it, expect } from "vitest";
import {
  adjacency,
  componentsOf,
  degreeMap,
  edgeKindsPresent,
  graphInsights,
  neighborhood,
  orphanNodes,
  shortestPath,
} from "../lib/graphAnalysis";
import type { GraphData, GraphNodeType } from "../types";

function node(id: string, type: GraphNodeType = "paper") {
  return { id, label: id.toUpperCase(), type };
}

// a - b - c , d - e , f isolated
const sample: GraphData = {
  nodes: [node("a"), node("b", "note"), node("c"), node("d"), node("e", "note"), node("f")],
  edges: [
    { source: "a", target: "b", kind: "wikilink" },
    { source: "b", target: "c", kind: "paper-note" },
    { source: "d", target: "e", kind: "related" },
  ],
};

describe("adjacency and degree", () => {
  it("is undirected and includes isolated nodes", () => {
    const adj = adjacency(sample);
    expect([...(adj.get("a") || [])]).toEqual(["b"]);
    expect([...(adj.get("b") || [])].sort()).toEqual(["a", "c"]);
    expect(adj.get("f")?.size).toBe(0);
  });

  it("counts distinct neighbours", () => {
    const degrees = degreeMap(sample);
    expect(degrees.get("b")).toBe(2);
    expect(degrees.get("a")).toBe(1);
    expect(degrees.get("f")).toBe(0);
  });

  it("ignores edges pointing at nodes that are not present", () => {
    const dangling: GraphData = {
      nodes: [node("a")],
      edges: [{ source: "a", target: "ghost", kind: "wikilink" }],
    };
    expect(degreeMap(dangling).get("a")).toBe(1);
    expect(adjacency(dangling).has("ghost")).toBe(false);
  });
});

describe("neighborhood", () => {
  it("depth 0 is the node alone", () => {
    expect([...neighborhood(sample, "b", 0)]).toEqual(["b"]);
  });

  it("depth 1 reaches direct links only", () => {
    expect([...neighborhood(sample, "a", 1)].sort()).toEqual(["a", "b"]);
  });

  it("depth 2 reaches across a hop", () => {
    expect([...neighborhood(sample, "a", 2).values()].sort()).toEqual(["a", "b", "c"]);
  });

  it("stops early rather than looping when the component is exhausted", () => {
    expect([...neighborhood(sample, "a", 99)].sort()).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for an unknown node", () => {
    expect(neighborhood(sample, "nope", 2).size).toBe(0);
  });
});

describe("shortestPath", () => {
  it("returns the chain of ids inclusive of both ends", () => {
    expect(shortestPath(sample, "a", "c")).toEqual(["a", "b", "c"]);
  });

  it("is symmetric", () => {
    expect(shortestPath(sample, "c", "a")).toEqual(["c", "b", "a"]);
  });

  it("returns the node itself for a self path", () => {
    expect(shortestPath(sample, "a", "a")).toEqual(["a"]);
  });

  it("returns empty when the two nodes are in different components", () => {
    expect(shortestPath(sample, "a", "e")).toEqual([]);
    expect(shortestPath(sample, "a", "f")).toEqual([]);
  });

  it("takes the shorter of two routes", () => {
    const withShortcut: GraphData = {
      ...sample,
      edges: [...sample.edges, { source: "a", target: "c", kind: "related" }],
    };
    expect(shortestPath(withShortcut, "a", "c")).toEqual(["a", "c"]);
  });
});

describe("componentsOf and orphans", () => {
  it("groups nodes into components, largest first", () => {
    const groups = componentsOf(sample);
    expect(groups.map((g) => g.length)).toEqual([3, 2, 1]);
    expect(groups[0].sort()).toEqual(["a", "b", "c"]);
  });

  it("reports only nodes with no links as orphans", () => {
    expect(orphanNodes(sample).map((n) => n.id)).toEqual(["f"]);
  });
});

describe("graphInsights", () => {
  it("summarizes the graph for the sidebar", () => {
    const insights = graphInsights(sample);
    expect(insights.nodeCount).toBe(6);
    expect(insights.edgeCount).toBe(3);
    expect(insights.componentCount).toBe(3);
    expect(insights.largestComponentSize).toBe(3);
    expect(insights.hubs[0].node.id).toBe("b");
    expect(insights.hubs[0].degree).toBe(2);
    expect(insights.hubs.every((h) => h.degree > 0)).toBe(true);
    expect(insights.orphans.map((n) => n.id)).toEqual(["f"]);
  });

  it("flags questions that have no evidence linked to them", () => {
    const withQuestions: GraphData = {
      nodes: [...sample.nodes, node("q1", "question"), node("q2", "question")],
      edges: [...sample.edges, { source: "q1", target: "a", kind: "question-paper" }],
    };
    const insights = graphInsights(withQuestions);
    expect(insights.unevidencedQuestions.map((n) => n.id)).toEqual(["q2"]);
  });

  it("honours the hub limit", () => {
    expect(graphInsights(sample, 1).hubs).toHaveLength(1);
  });
});

describe("edgeKindsPresent", () => {
  it("lists only the kinds actually in the data, in display order", () => {
    expect(edgeKindsPresent(sample)).toEqual(["wikilink", "paper-note", "related"]);
  });

  it("is empty for a graph with no edges", () => {
    expect(edgeKindsPresent({ nodes: [node("a")], edges: [] })).toEqual([]);
  });
});
