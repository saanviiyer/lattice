// The whole library as sections for one bound PDF: every project in sidebar order,
// each subproject under its parent, and the papers filed nowhere at the end.
//
// A section holds only the papers filed directly in it. A paper filed in a project
// and in one of its subprojects is listed in both, and the binder binds it once, the
// first time it appears, so the file is not padded with copies.

import type { Collection, Paper } from "../types";
import type { MergeSection } from "./mergedPdf";
import { buildCollectionTree, collectionPath, flattenCollectionTree } from "./collectionTree";

export const UNFILED_SECTION = "Not in a project";

const byTitle = (a: Paper, b: Paper) => (a.title || "").localeCompare(b.title || "");

export function librarySections(collections: Collection[], papers: Paper[]): MergeSection[] {
  const roots = buildCollectionTree(collections);
  const nodes = flattenCollectionTree(roots);
  const known = new Set(collections.map((collection) => collection.id));

  const direct = new Map<string, Paper[]>();
  const unfiled: Paper[] = [];
  for (const paper of papers) {
    const homes = paper.collectionIds.filter((id) => known.has(id));
    if (!homes.length) unfiled.push(paper);
    for (const id of homes) direct.set(id, [...(direct.get(id) || []), paper]);
  }

  // A project with nothing in it or anywhere beneath it would be an empty heading.
  const filled = new Set<string>();
  const fill = (node: (typeof nodes)[number]): boolean => {
    const below = node.children.map(fill).some(Boolean);
    const any = below || !!direct.get(node.collection.id)?.length;
    if (any) filled.add(node.collection.id);
    return any;
  };
  roots.forEach(fill);

  const sections: MergeSection[] = nodes
    .filter((node) => filled.has(node.collection.id))
    .map((node) => ({
      title: node.collection.name,
      label: node.depth > 0 ? "SUBPROJECT" : "PROJECT",
      depth: node.depth,
      context: collectionPath(collections, node.collection.id).slice(0, -1).join(" / ") || undefined,
      premise: node.collection.premise,
      papers: [...(direct.get(node.collection.id) || [])].sort(byTitle),
    }));

  if (unfiled.length) {
    sections.push({ title: UNFILED_SECTION, depth: 0, papers: [...unfiled].sort(byTitle) });
  }
  return sections;
}
