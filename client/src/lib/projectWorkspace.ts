// What a project actually contains, and what it is still missing.
//
// A project in lattice is one line of inquiry, not a folder: it holds the papers,
// the notes, and the open questions that belong to it, across the project and every
// subproject beneath it.
//
// The second half of this file is the part that matters for thinking rather than
// filing. `projectGaps` looks at a project and answers "what should I do next on
// this idea?" — a question with no evidence attached, a paper read but never
// digested, a note that connects nothing. A shelf of papers looks like progress; a
// gap list is honest about whether any of it is going anywhere.

import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { descendantIds } from "./collectionTree";
import { buildTitleIndex, resolveLinks } from "./graph";

export interface ProjectContents {
  /** The project itself plus every subproject id — what "in this project" means. */
  collectionIds: string[];
  /** Direct children only, for the subproject list. */
  subprojects: Collection[];
  papers: Paper[];
  notes: Note[];
  questions: ResearchQuestion[];
}

function belongs(ids: string[] | undefined, scope: Set<string>): boolean {
  return !!ids?.some((id) => scope.has(id));
}

/**
 * Everything filed under a project, including its subprojects.
 *
 * A paper's own notes doc comes along with it: filing a paper into a project and
 * then finding your notes on that paper somewhere else would be absurd.
 */
export function projectContents(
  project: Collection,
  collections: Collection[],
  papers: Paper[],
  notes: Note[],
  questions: ResearchQuestion[]
): ProjectContents {
  const collectionIds = descendantIds(collections, project.id);
  const scope = new Set(collectionIds);
  const projectPapers = papers.filter((paper) => belongs(paper.collectionIds, scope));
  const paperIds = new Set(projectPapers.map((paper) => paper.id));

  return {
    collectionIds,
    subprojects: collections.filter((item) => item.parentId === project.id),
    papers: projectPapers,
    notes: notes.filter(
      (note) => belongs(note.collectionIds, scope) || (note.paperId && paperIds.has(note.paperId))
    ),
    // An explicit filing is a statement and is honoured exclusively: a question
    // filed in one project must not also surface in another just because the two
    // share a paper. Reaching a question through its evidence stays as a fallback
    // for questions that were never filed anywhere — the ones captured on the
    // research desk before there was a project to put them in.
    questions: questions.filter((question) =>
      question.collectionIds?.length
        ? belongs(question.collectionIds, scope)
        : question.linkedPaperIds.some((id) => paperIds.has(id))
    ),
  };
}

export interface ProjectCount {
  papers: number;
  notes: number;
  questions: number;
}

/**
 * How much is filed under every project at once, in a single pass.
 *
 * The sidebar needs a count for every project on every render, and asking
 * `projectContents` once per project is quadratic — at a hundred projects and a few
 * thousand papers that is tens of milliseconds on every keystroke in the search
 * box. This walks the records once instead.
 *
 * It has to agree with `projectContents` exactly, or a project would show a number
 * that its own page contradicts. A test pins the two together on a fixture; if you
 * change what belongs to a project, change both.
 */
export function projectCounts(
  collections: Collection[],
  papers: Paper[],
  notes: Note[],
  questions: ResearchQuestion[]
): Map<string, ProjectCount> {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const counts = new Map<string, ProjectCount>(
    collections.map((collection) => [collection.id, { papers: 0, notes: 0, questions: 0 }])
  );

  // A project and every project above it: filing into a subproject counts towards
  // its parents too. Cached, since most records share a handful of projects.
  const ancestorCache = new Map<string, string[]>();
  function ancestors(id: string): string[] {
    const cached = ancestorCache.get(id);
    if (cached) return cached;
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    ancestorCache.set(id, chain);
    return chain;
  }

  /** Every project a record counts towards, deduped so it is never counted twice. */
  function scopeOf(collectionIds: string[] | undefined): Set<string> {
    const scope = new Set<string>();
    for (const id of collectionIds || []) for (const owner of ancestors(id)) scope.add(owner);
    return scope;
  }

  const paperScopes = new Map<string, Set<string>>();
  for (const paper of papers) {
    const scope = scopeOf(paper.collectionIds);
    paperScopes.set(paper.id, scope);
    for (const id of scope) counts.get(id)!.papers += 1;
  }

  for (const note of notes) {
    // Union, not either/or: projectContents counts a note that is filed somewhere
    // *and* documents a paper filed elsewhere as belonging to both.
    const scope = scopeOf(note.collectionIds);
    if (note.paperId) for (const id of paperScopes.get(note.paperId) || []) scope.add(id);
    for (const id of scope) counts.get(id)!.notes += 1;
  }

  for (const question of questions) {
    const scope = question.collectionIds?.length
      ? scopeOf(question.collectionIds)
      : // Unfiled questions are reached through their evidence.
        new Set(
          question.linkedPaperIds.flatMap((paperId) => [...(paperScopes.get(paperId) || [])])
        );
    for (const id of scope) counts.get(id)!.questions += 1;
  }

  return counts;
}

/** A one-line read on how far along a project is. */
export interface ProjectPulse {
  papers: number;
  papersRead: number;
  takeaways: number;
  notes: number;
  questions: number;
  questionsWithEvidence: number;
}

export function projectPulse(contents: ProjectContents): ProjectPulse {
  const paperIds = new Set(contents.papers.map((paper) => paper.id));
  return {
    papers: contents.papers.length,
    papersRead: contents.papers.filter((paper) => paper.readingStatus === "read").length,
    takeaways: contents.papers.filter((paper) => paper.takeaway?.trim()).length,
    notes: contents.notes.length,
    questions: contents.questions.length,
    questionsWithEvidence: contents.questions.filter((question) =>
      question.linkedPaperIds.some((id) => paperIds.has(id))
    ).length,
  };
}

export interface ProjectGap {
  kind:
    | "no-premise"
    | "no-questions"
    | "questions-without-evidence"
    | "papers-without-takeaway"
    | "unread-papers"
    | "no-notes"
    | "notes-linking-nothing"
    | "papers-linked-to-nothing"
    | "empty-subprojects";
  /** The prompt, written as the next move rather than as a complaint. */
  title: string;
  /** Why it is worth doing. */
  detail: string;
  /** How many records this applies to; absent when the gap is about the project itself. */
  count?: number;
}

/**
 * What this project still needs, most useful first.
 *
 * `collections` is the whole project list, not just this project's: judging whether
 * a subproject is empty means looking below it as well.
 *
 * The ordering is deliberate. A premise comes before anything else, because
 * without one there is no way to judge whether a paper belongs. Questions come
 * before evidence, because evidence with no question behind it is just reading.
 * Everything after that is the ordinary debt of an active project.
 */
export function projectGaps(
  project: Collection,
  contents: ProjectContents,
  collections: Collection[]
): ProjectGap[] {
  const gaps: ProjectGap[] = [];
  const { papers, notes, questions, subprojects } = contents;
  const paperIds = new Set(papers.map((paper) => paper.id));

  if (!project.premise?.trim()) {
    gaps.push({
      kind: "no-premise",
      title: "Say what you think might be true",
      detail:
        "One sentence, stated so it could turn out to be wrong. Without it there is no way to tell whether the next paper belongs here.",
    });
  }

  if (questions.length === 0) {
    gaps.push({
      kind: "no-questions",
      title: "Ask the first question",
      detail:
        "A project with no question is a topic. Write down the thing you do not know yet, even badly.",
    });
  } else {
    const unevidenced = questions.filter(
      (question) => !question.linkedPaperIds.some((id) => paperIds.has(id))
    );
    if (unevidenced.length) {
      gaps.push({
        kind: "questions-without-evidence",
        title: `Attach evidence to ${unevidenced.length} question${unevidenced.length === 1 ? "" : "s"}`,
        detail:
          "A question with evidence attached is a thread you are pulling. A question with none is one you have only worried about.",
        count: unevidenced.length,
      });
    }
  }

  const undigested = papers.filter(
    (paper) => paper.readingStatus !== "inbox" && !paper.takeaway?.trim()
  );
  if (undigested.length) {
    gaps.push({
      kind: "papers-without-takeaway",
      title: `Write a takeaway for ${undigested.length} paper${undigested.length === 1 ? "" : "s"}`,
      detail:
        "Opened but never summarised. If you cannot write the one sentence, you have not finished reading it.",
      count: undigested.length,
    });
  }

  const unread = papers.filter((paper) => (paper.readingStatus || "inbox") === "inbox");
  if (unread.length) {
    gaps.push({
      kind: "unread-papers",
      title: `Read ${unread.length} paper${unread.length === 1 ? "" : "s"} in the queue`,
      detail: "Collected but not yet read. A shelf is not an argument.",
      count: unread.length,
    });
  }

  if (papers.length > 0 && notes.length === 0) {
    gaps.push({
      kind: "no-notes",
      title: "Write the first note",
      detail:
        "Nothing here is in your own words yet. The note that puts two of these papers in one sentence is where the project starts.",
    });
  }

  // Which project papers anything in the project actually points at.
  const index = buildTitleIndex(papers, notes, questions);
  const reached = new Set<string>();
  const inertNotes: Note[] = [];
  for (const note of notes) {
    const targets = resolveLinks(note.id, note.body, index);
    for (const id of targets) reached.add(id);
    if (note.paperId) reached.add(note.paperId);
    // A paper's own notes doc is about that paper by construction, so it is not
    // "linking nothing" just because it has no [[links]] in the body.
    if (targets.length === 0 && !note.paperId) inertNotes.push(note);
  }
  for (const paper of papers) {
    for (const id of paper.relatedPaperIds || []) {
      if (paperIds.has(id)) {
        reached.add(id);
        reached.add(paper.id);
      }
    }
  }
  for (const question of questions) {
    for (const id of question.linkedPaperIds) if (paperIds.has(id)) reached.add(id);
  }

  if (inertNotes.length) {
    gaps.push({
      kind: "notes-linking-nothing",
      title: `Connect ${inertNotes.length} note${inertNotes.length === 1 ? "" : "s"} to something`,
      detail:
        "These notes link to nothing. A note earns its place when it puts two things in the same sentence.",
      count: inertNotes.length,
    });
  }

  const stranded = papers.filter((paper) => !reached.has(paper.id));
  if (stranded.length && papers.length > 1) {
    gaps.push({
      kind: "papers-linked-to-nothing",
      title: `Place ${stranded.length} paper${stranded.length === 1 ? "" : "s"} in the argument`,
      detail:
        "No note, question, or related paper in this project refers to these. Either they belong to the story and nothing says how, or they do not belong here.",
      count: stranded.length,
    });
  }

  const emptySubprojects = subprojects.filter((child) => {
    // Against the real project list: a subproject holding nothing itself but with a
    // full sub-subproject under it is not empty, and telling someone to drop it
    // would be telling them to delete a live branch.
    const childContents = projectContents(child, collections, papers, notes, questions);
    return (
      childContents.papers.length === 0 &&
      childContents.notes.length === 0 &&
      childContents.questions.length === 0
    );
  });
  if (emptySubprojects.length) {
    gaps.push({
      kind: "empty-subprojects",
      title: `Fill or drop ${emptySubprojects.length} empty subproject${emptySubprojects.length === 1 ? "" : "s"}`,
      detail:
        "An empty subproject is a plan you have not started. Keep it only if you know what goes in it.",
      count: emptySubprojects.length,
    });
  }

  return gaps;
}
