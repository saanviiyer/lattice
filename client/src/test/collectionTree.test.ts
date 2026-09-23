import { describe, it, expect } from "vitest";
import type { Collection } from "../types";
import {
  buildCollectionTree,
  canReparent,
  collectionPath,
  descendantIds,
  flattenCollectionTree,
} from "../lib/collectionTree";

function project(id: string, name: string, parentId?: string | null): Collection {
  return { id, name, parentId: parentId ?? null, createdAt: "2026-01-01T00:00:00.000Z" };
}

// Thesis
//   Chapter 1
//     Pilot study
//   Chapter 2
// Reading group
const SAMPLE: Collection[] = [
  project("thesis", "Thesis"),
  project("ch1", "Chapter 1", "thesis"),
  project("pilot", "Pilot study", "ch1"),
  project("ch2", "Chapter 2", "thesis"),
  project("reading", "Reading group"),
];

describe("buildCollectionTree", () => {
  it("nests subprojects under their parent", () => {
    const roots = buildCollectionTree(SAMPLE);
    expect(roots.map((node) => node.collection.id)).toEqual(["thesis", "reading"]);
    expect(roots[0].children.map((node) => node.collection.id)).toEqual(["ch1", "ch2"]);
    expect(roots[0].children[0].children.map((node) => node.collection.id)).toEqual(["pilot"]);
  });

  it("assigns a depth per level", () => {
    const flat = flattenCollectionTree(buildCollectionTree(SAMPLE));
    expect(flat.map((node) => [node.collection.id, node.depth])).toEqual([
      ["thesis", 0],
      ["ch1", 1],
      ["pilot", 2],
      ["ch2", 1],
      ["reading", 0],
    ]);
  });

  it("shows a project whose parent no longer exists as a root", () => {
    const orphaned = [project("thesis", "Thesis"), project("ghost", "Ghost", "deleted-id")];
    const roots = buildCollectionTree(orphaned);
    expect(roots.map((node) => node.collection.id)).toEqual(["thesis", "ghost"]);
  });

  it("does not lose or loop on a cycle in the parent links", () => {
    const cyclic = [
      project("a", "A", "b"),
      project("b", "B", "a"),
      project("c", "C", "a"),
    ];
    const flat = flattenCollectionTree(buildCollectionTree(cyclic));
    expect(flat.map((node) => node.collection.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("treats a project that is its own parent as a root", () => {
    const roots = buildCollectionTree([project("self", "Self", "self")]);
    expect(roots.map((node) => node.collection.id)).toEqual(["self"]);
  });
});

describe("descendantIds", () => {
  it("includes the project itself and every level beneath it", () => {
    expect(descendantIds(SAMPLE, "thesis").sort()).toEqual(["ch1", "ch2", "pilot", "thesis"]);
    expect(descendantIds(SAMPLE, "ch1").sort()).toEqual(["ch1", "pilot"]);
    expect(descendantIds(SAMPLE, "reading")).toEqual(["reading"]);
  });
});

describe("collectionPath", () => {
  it("reads from the root down to the project", () => {
    expect(collectionPath(SAMPLE, "pilot")).toEqual(["Thesis", "Chapter 1", "Pilot study"]);
    expect(collectionPath(SAMPLE, "reading")).toEqual(["Reading group"]);
  });

  it("stops instead of looping on a cyclic path", () => {
    const cyclic = [project("a", "A", "b"), project("b", "B", "a")];
    const path = collectionPath(cyclic, "a");
    expect(path).toHaveLength(2);
    expect(path[path.length - 1]).toBe("A");
  });
});

describe("canReparent", () => {
  it("allows a move to an unrelated project or to the top level", () => {
    expect(canReparent(SAMPLE, "reading", "ch2")).toBe(true);
    expect(canReparent(SAMPLE, "pilot", null)).toBe(true);
  });

  it("refuses a move that would detach the branch from the tree", () => {
    expect(canReparent(SAMPLE, "thesis", "pilot")).toBe(false);
    expect(canReparent(SAMPLE, "ch1", "ch1")).toBe(false);
  });
});
