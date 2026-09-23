// Projects are stored flat (a list of Collections, each with an optional parentId)
// and read as a tree. Keeping the stored form flat means the repository, the backup
// format, and the desktop mirror all stay unchanged; everything hierarchical is
// derived here.
//
// The functions below are defensive about the parent links, because a restored
// backup or a hand-edited workspace.json can contain a parentId that points at a
// deleted project, or — worse — a cycle. Both are treated as "no parent" rather
// than being allowed to hide projects from the sidebar or hang the renderer.

import type { Collection } from "../types";

export interface CollectionNode {
  collection: Collection;
  depth: number;
  children: CollectionNode[];
}

/** A project's parent, or null when it is a root (including broken/cyclic links). */
function resolvedParentId(
  collection: Collection,
  byId: Map<string, Collection>,
  seenCycle: Set<string>
): string | null {
  const parentId = collection.parentId;
  if (!parentId || parentId === collection.id) return null;
  if (!byId.has(parentId)) return null; // parent was deleted out from under it
  if (seenCycle.has(collection.id)) return null;
  return parentId;
}

/** Ids that sit on a cycle of parent links, so they can be shown as roots instead. */
function cyclicIds(collections: Collection[]): Set<string> {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const cyclic = new Set<string>();
  const settled = new Set<string>();
  for (const start of collections) {
    if (settled.has(start.id)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: Collection | undefined = start;
    while (current && !settled.has(current.id)) {
      if (onPath.has(current.id)) {
        // Everything from the repeat onwards is part of the loop.
        for (const id of path.slice(path.indexOf(current.id))) cyclic.add(id);
        break;
      }
      path.push(current.id);
      onPath.add(current.id);
      const parentId: string | null | undefined = current.parentId;
      current = parentId && parentId !== current.id ? byId.get(parentId) : undefined;
    }
    for (const id of path) settled.add(id);
  }
  return cyclic;
}

/**
 * The project forest, in creation order at each level. Every project appears
 * exactly once: one whose parent is missing or cyclic surfaces as a root.
 */
export function buildCollectionTree(collections: Collection[]): CollectionNode[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const cyclic = cyclicIds(collections);
  const nodes = new Map<string, CollectionNode>(
    collections.map((c) => [c.id, { collection: c, depth: 0, children: [] }])
  );

  const roots: CollectionNode[] = [];
  for (const collection of collections) {
    const node = nodes.get(collection.id)!;
    const parentId = resolvedParentId(collection, byId, cyclic);
    if (parentId) nodes.get(parentId)!.children.push(node);
    else roots.push(node);
  }

  // Depth is assigned by walking down from the roots, so it is always consistent
  // with where the node actually ended up.
  const assign = (list: CollectionNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      assign(node.children, depth + 1);
    }
  };
  assign(roots, 0);
  return roots;
}

/** The tree flattened depth-first — the order the sidebar renders. */
export function flattenCollectionTree(nodes: CollectionNode[]): CollectionNode[] {
  return nodes.flatMap((node) => [node, ...flattenCollectionTree(node.children)]);
}

/**
 * A project and every project beneath it. This is what "filter by project" means:
 * selecting a parent shows the papers of its subprojects too.
 */
export function descendantIds(collections: Collection[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  const cyclic = cyclicIds(collections);
  const byId = new Map(collections.map((c) => [c.id, c]));
  for (const collection of collections) {
    const parentId = resolvedParentId(collection, byId, cyclic);
    if (!parentId) continue;
    const siblings = childrenOf.get(parentId) || [];
    siblings.push(collection.id);
    childrenOf.set(parentId, siblings);
  }
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(childrenOf.get(id) || []));
  }
  return out;
}

/** Names from the root down to this project, for a breadcrumb heading. */
export function collectionPath(collections: Collection[], id: string): string[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    const parentId = current.parentId;
    current = parentId ? byId.get(parentId) : undefined;
  }
  return names;
}

/**
 * Whether `id` may be moved under `parentId`. A project cannot become its own
 * parent, nor be moved beneath one of its own descendants — either would detach
 * that whole branch from the tree.
 */
export function canReparent(
  collections: Collection[],
  id: string,
  parentId: string | null
): boolean {
  if (!parentId) return true;
  if (parentId === id) return false;
  return !descendantIds(collections, id).includes(parentId);
}
