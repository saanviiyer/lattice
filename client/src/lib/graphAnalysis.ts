// Structural analysis of the knowledge graph. Pure functions over GraphData (no
// storage, no DOM, no d3) so the graph view, the insights panel, and the unit tests
// all read the same numbers.
//
// The questions these answer, in a researcher's terms:
//   degreeMap        which pieces of my thinking are load bearing
//   neighborhood     what sits within N hops of this paper
//   shortestPath     how do these two ideas connect at all
//   orphanNodes      what have I saved but never connected to anything
//   componentsOf     is my library one body of work or several disjoint islands
//   graphInsights    the above, packaged for the sidebar

import type { GraphData, GraphEdge, GraphNode } from "../types";

export type Adjacency = Map<string, Set<string>>;

// Undirected adjacency. Every node id appears as a key, including isolated ones.
export function adjacency(data: GraphData): Adjacency {
  const adj: Adjacency = new Map();
  for (const n of data.nodes) adj.set(n.id, new Set());
  for (const e of data.edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  return adj;
}

// Number of distinct neighbours per node id.
export function degreeMap(data: GraphData): Map<string, number> {
  const adj = adjacency(data);
  const degrees = new Map<string, number>();
  for (const [id, neighbours] of adj) degrees.set(id, neighbours.size);
  return degrees;
}

// Every node id within `depth` hops of rootId, inclusive of rootId itself.
// depth 0 is the node alone; depth 1 is the node plus its direct links.
export function neighborhood(data: GraphData, rootId: string, depth: number): Set<string> {
  const adj = adjacency(data);
  const seen = new Set<string>();
  if (!adj.has(rootId)) return seen;
  seen.add(rootId);
  let frontier = [rootId];
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adj.get(id) || []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return seen;
}

// Shortest chain of node ids from a to b inclusive, or [] when they are unconnected.
// A node's path to itself is just itself.
export function shortestPath(data: GraphData, aId: string, bId: string): string[] {
  const adj = adjacency(data);
  if (!adj.has(aId) || !adj.has(bId)) return [];
  if (aId === bId) return [aId];

  const cameFrom = new Map<string, string>();
  const seen = new Set<string>([aId]);
  const queue = [aId];

  while (queue.length) {
    const current = queue.shift()!;
    for (const neighbour of adj.get(current) || []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      cameFrom.set(neighbour, current);
      if (neighbour === bId) {
        const path = [bId];
        let step = bId;
        while (step !== aId) {
          step = cameFrom.get(step)!;
          path.unshift(step);
        }
        return path;
      }
      queue.push(neighbour);
    }
  }
  return [];
}

// Connected components as arrays of node ids, largest first.
export function componentsOf(data: GraphData): string[][] {
  const adj = adjacency(data);
  const seen = new Set<string>();
  const groups: string[][] = [];

  for (const node of data.nodes) {
    if (seen.has(node.id)) continue;
    const group: string[] = [];
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length) {
      const current = stack.pop()!;
      group.push(current);
      for (const neighbour of adj.get(current) || []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    groups.push(group);
  }

  return groups.sort((a, b) => b.length - a.length);
}

// Nodes with no links at all: saved, but not yet part of anyone's thinking.
export function orphanNodes(data: GraphData): GraphNode[] {
  const degrees = degreeMap(data);
  return data.nodes.filter((n) => (degrees.get(n.id) || 0) === 0);
}

export interface GraphHub {
  node: GraphNode;
  degree: number;
}

export interface GraphInsights {
  nodeCount: number;
  edgeCount: number;
  hubs: GraphHub[];
  orphans: GraphNode[];
  componentCount: number;
  largestComponentSize: number;
  // Questions with no evidence attached yet: open threads with nothing under them.
  unevidencedQuestions: GraphNode[];
}

export function graphInsights(data: GraphData, hubLimit = 5): GraphInsights {
  const degrees = degreeMap(data);
  const groups = componentsOf(data);

  const hubs = data.nodes
    .map((node) => ({ node, degree: degrees.get(node.id) || 0 }))
    .filter((h) => h.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.node.label.localeCompare(b.node.label))
    .slice(0, hubLimit);

  return {
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
    hubs,
    orphans: orphanNodes(data),
    componentCount: groups.length,
    largestComponentSize: groups[0]?.length || 0,
    unevidencedQuestions: data.nodes.filter(
      (n) => n.type === "question" && (degrees.get(n.id) || 0) === 0
    ),
  };
}

// Edge kinds present in the data, in a stable display order.
const EDGE_KIND_ORDER: GraphEdge["kind"][] = ["wikilink", "paper-note", "related", "question-paper"];

export function edgeKindsPresent(data: GraphData): GraphEdge["kind"][] {
  const present = new Set(data.edges.map((e) => e.kind));
  return EDGE_KIND_ORDER.filter((kind) => present.has(kind));
}
