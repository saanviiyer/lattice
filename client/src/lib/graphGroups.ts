// What the knowledge graph should colour and cluster by.
//
// Colour in the graph is not decoration and is not a preference: it is the
// grouping, drawn. Two nodes share a colour exactly when they belong to the same
// group, and the legend beside the graph says what each colour means.
//
// Two ways to group. "Project" uses the filing you have actually done. "Subject"
// proposes groups from what the papers are about, for the ordinary case where the
// filing has not been done yet — which is when a graph of unlinked nodes is least
// use and most in need of structure.

import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { LABEL_SWATCHES } from "./labelColor";
import { collectionPath } from "./collectionTree";
import { proposeSubjectGroups } from "./subjectGroups";

export type GroupingMode = "project" | "subject" | "none";

export interface GraphGroup {
  id: string;
  label: string;
  color: string;
  nodeIds: string[];
  /** Set for a proposed subject group: the terms that defined it. */
  terms?: string[];
  /** True when this group exists in the library rather than being a proposal. */
  isProject?: boolean;
}

export interface GraphGrouping {
  groups: GraphGroup[];
  /** node id -> group id. Nodes missing from this belong to no group. */
  groupOf: Map<string, string>;
}

// A spread of hues for proposed groups, which have no colour of their own.
// Ordered so adjacent groups in the legend do not get adjacent hues.
const PROPOSED_COLORS = [
  "#22d3ee", "#f472b6", "#a3e635", "#c084fc", "#fb923c", "#38bdf8",
  "#fbbf24", "#4ade80", "#f87171", "#2dd4bf", "#818cf8", "#e879f9",
];

const UNGROUPED_COLOR = "#475569";

function paperText(paper: Paper) {
  return { id: paper.id, title: paper.title || "", tags: paper.tags, abstract: paper.abstract || "" };
}

/**
 * Group the graph's nodes.
 *
 * Notes and questions follow the papers they are about, so a project's or a
 * subject's cluster holds the whole thread — the evidence, the thinking, and the
 * open question — rather than the papers on their own.
 */
export function computeGraphGrouping(
  mode: GroupingMode,
  papers: Paper[],
  notes: Note[],
  questions: ResearchQuestion[],
  collections: Collection[]
): GraphGrouping {
  if (mode === "none") return { groups: [], groupOf: new Map() };

  const groupOf = new Map<string, string>();
  const groups: GraphGroup[] = [];

  if (mode === "project") {
    // Deepest-first, so a paper filed in both a project and its subproject is
    // shown under the more specific of the two.
    const depth = new Map(collections.map((c) => [c.id, collectionPath(collections, c.id).length]));
    const ordered = [...collections].sort((a, b) => (depth.get(b.id) || 0) - (depth.get(a.id) || 0));

    for (const collection of ordered) {
      const nodeIds: string[] = [];
      for (const paper of papers) {
        if (!groupOf.has(paper.id) && paper.collectionIds.includes(collection.id)) nodeIds.push(paper.id);
      }
      for (const note of notes) {
        if (groupOf.has(note.id)) continue;
        if (note.collectionIds?.includes(collection.id)) nodeIds.push(note.id);
      }
      for (const question of questions) {
        if (groupOf.has(question.id)) continue;
        if (question.collectionIds?.includes(collection.id)) nodeIds.push(question.id);
      }
      if (!nodeIds.length) continue;
      const id = `project:${collection.id}`;
      for (const nodeId of nodeIds) groupOf.set(nodeId, id);
      groups.push({
        id,
        label: collection.name,
        color: collection.color ? LABEL_SWATCHES[collection.color].dot : UNGROUPED_COLOR,
        nodeIds,
        isProject: true,
      });
    }
  } else {
    const proposal = proposeSubjectGroups(papers.map(paperText));
    proposal.groups.forEach((group, index) => {
      const id = `subject:${group.id}`;
      for (const nodeId of group.documentIds) groupOf.set(nodeId, id);
      groups.push({
        id,
        label: group.label,
        color: PROPOSED_COLORS[index % PROPOSED_COLORS.length],
        nodeIds: [...group.documentIds],
        terms: group.terms,
      });
    });
  }

  // A paper's own notes doc, and a question whose evidence sits in one group,
  // join that group so a cluster is a whole thread rather than papers alone.
  const byGroup = new Map(groups.map((group) => [group.id, group]));
  for (const note of notes) {
    if (groupOf.has(note.id) || !note.paperId) continue;
    const owner = groupOf.get(note.paperId);
    if (!owner) continue;
    groupOf.set(note.id, owner);
    byGroup.get(owner)?.nodeIds.push(note.id);
  }
  for (const question of questions) {
    if (groupOf.has(question.id)) continue;
    const owners = question.linkedPaperIds.map((id) => groupOf.get(id)).filter(Boolean) as string[];
    if (!owners.length) continue;
    // Whichever group holds most of its evidence.
    const tally = new Map<string, number>();
    for (const owner of owners) tally.set(owner, (tally.get(owner) || 0) + 1);
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    groupOf.set(question.id, best);
    byGroup.get(best)?.nodeIds.push(question.id);
  }

  return { groups: groups.sort((a, b) => b.nodeIds.length - a.nodeIds.length), groupOf };
}

/** The colour to draw a node, given the grouping. */
export function nodeColor(nodeId: string, grouping: GraphGrouping): string {
  const groupId = grouping.groupOf.get(nodeId);
  if (!groupId) return UNGROUPED_COLOR;
  return grouping.groups.find((group) => group.id === groupId)?.color || UNGROUPED_COLOR;
}

export { UNGROUPED_COLOR };
