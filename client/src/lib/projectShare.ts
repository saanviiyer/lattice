// Sharing one project with another researcher.
//
// lattice is local-first: there is no server holding anybody's library, so sharing
// is a file you send — email, Slack, a shared drive — and the other person imports
// into their own library.
//
// The important difference from a workspace backup is that a backup *replaces* a
// workspace and a share *merges* into one. Nothing the recipient already has may be
// overwritten by an import, which drives most of the decisions below:
//
//   - Papers go through repo.addPaper, which already dedupes on DOI, arXiv id, or
//     normalised title. A paper you both have ends up filed in the new project too,
//     not duplicated.
//   - Projects are always created fresh. Merging by name would silently pour
//     somebody else's reading into a project of yours that happens to share a title.
//   - Highlights land only on papers the import actually introduced. Dropping another
//     person's annotations onto a PDF you have already marked up would corrupt the
//     one thing in the app that is unambiguously yours.
//   - A note whose title you already use is renamed on the way in, because
//     [[wikilink]] resolution is by title and two notes with one title makes every
//     link to it ambiguous.
//
// PDFs are opt-in and off by default. A reading list is yours to pass on; the
// publisher's files usually are not. The recipient's own open-access fetch can fill
// most of them in legally on arrival.

import type { Collection, Highlight, Note, Paper, ResearchQuestion } from "../types";
import { repo } from "./repository";
import { getPdf, putPdf } from "./blobStore";
import { descendantIds } from "./collectionTree";
import { projectContents } from "./projectWorkspace";

const MANIFEST = "project.json";
const KIND = "lattice.project-share";

export interface ProjectShare {
  kind: typeof KIND;
  version: 1;
  exportedAt: string;
  /** Optional name the sender put on it, used for attribution on import. */
  sharedBy?: string;
  /** Which of the bundled collections is the project itself. */
  rootId: string;
  collections: Collection[];
  papers: Paper[];
  notes: Note[];
  questions: ResearchQuestion[];
  highlights: Highlight[];
}

export interface ShareOptions {
  sharedBy?: string;
  /** Your notes, takeaways, and highlights. Off means "just the reading list". */
  includeThinking: boolean;
  includePdfs: boolean;
}

/**
 * The share as a plain object. Pure, so what goes into a bundle can be tested
 * without touching storage.
 */
export function buildProjectShare(
  project: Collection,
  collections: Collection[],
  papers: Paper[],
  notes: Note[],
  questions: ResearchQuestion[],
  highlights: Highlight[],
  options: ShareOptions,
  now = new Date()
): ProjectShare {
  const contents = projectContents(project, collections, papers, notes, questions);
  const inProject = new Set(descendantIds(collections, project.id));
  const paperIds = new Set(contents.papers.map((paper) => paper.id));

  // Only the membership that travels: a paper filed in three of the sender's
  // projects must not arrive pointing at two projects the recipient never got.
  const scopedPapers = contents.papers.map((paper) => ({
    ...paper,
    collectionIds: paper.collectionIds.filter((id) => inProject.has(id)),
    // A takeaway is the sender's own words, so it follows the same rule as notes.
    takeaway: options.includeThinking ? paper.takeaway : undefined,
    hasPdf: options.includePdfs ? paper.hasPdf : false,
    // Extracted PDF text is bulky and re-derivable; it never needs to travel.
    pdfText: undefined,
    // Relations to papers outside the project would dangle.
    relatedPaperIds: (paper.relatedPaperIds || []).filter((id) => paperIds.has(id)),
  }));

  return {
    kind: KIND,
    version: 1,
    exportedAt: now.toISOString(),
    sharedBy: options.sharedBy?.trim() || undefined,
    rootId: project.id,
    collections: collections.filter((collection) => inProject.has(collection.id)),
    papers: scopedPapers,
    notes: options.includeThinking
      ? contents.notes.map((note) => ({
          ...note,
          collectionIds: (note.collectionIds || []).filter((id) => inProject.has(id)),
        }))
      : [],
    questions: contents.questions.map((question) => ({
      ...question,
      collectionIds: (question.collectionIds || []).filter((id) => inProject.has(id)),
      linkedPaperIds: question.linkedPaperIds.filter((id) => paperIds.has(id)),
    })),
    highlights: options.includeThinking
      ? highlights.filter((highlight) => paperIds.has(highlight.paperId))
      : [],
  };
}

export function parseProjectShare(value: unknown): ProjectShare {
  const share = value as Partial<ProjectShare> | null;
  if (
    !share ||
    share.kind !== KIND ||
    share.version !== 1 ||
    typeof share.rootId !== "string" ||
    !Array.isArray(share.collections) ||
    !Array.isArray(share.papers) ||
    !share.collections.some((collection) => collection.id === share.rootId)
  ) {
    throw new Error("This is not a lattice shared project.");
  }
  return {
    ...(share as ProjectShare),
    notes: share.notes || [],
    questions: share.questions || [],
    highlights: share.highlights || [],
  };
}

/** Zip the share, with the PDFs alongside it when the sender chose to include them. */
export async function createProjectShare(
  project: Collection,
  options: ShareOptions
): Promise<Blob> {
  const { strToU8, zipSync } = await import("fflate");
  const share = buildProjectShare(
    project,
    repo.listCollections(),
    repo.listPapers(),
    repo.listNotes(),
    repo.listQuestions(),
    repo.listPapers().flatMap((paper) => repo.listHighlights(paper.id)),
    options
  );

  const files: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(JSON.stringify(share, null, 2)),
  };
  if (options.includePdfs) {
    for (const paper of share.papers) {
      if (!paper.hasPdf) continue;
      const pdf = await getPdf(paper.id);
      if (pdf) files[`pdfs/${paper.id}.pdf`] = new Uint8Array(await pdf.arrayBuffer());
    }
  }
  const archive = zipSync(files, { level: 6 });
  return new Blob([Uint8Array.from(archive).buffer], {
    type: "application/vnd.lattice.project+zip",
  });
}

export interface ImportSummary {
  /** The id of the project this import created, for navigating straight to it. */
  projectId: string;
  projectName: string;
  sharedBy?: string;
  projects: number;
  papersAdded: number;
  papersAlreadyHad: number;
  notes: number;
  questions: number;
  highlights: number;
  pdfs: number;
}

/**
 * Merge a shared project into this library.
 *
 * Everything arriving is given fresh ids: the two libraries generated theirs
 * independently, so an incoming id could otherwise collide with an unrelated
 * record of the recipient's.
 */
export async function importProjectShare(
  share: ProjectShare,
  pdfs: Record<string, Uint8Array> = {}
): Promise<ImportSummary> {
  const attribution = share.sharedBy?.trim();

  // ---- Projects ----
  // Created parents-first so a child always has somewhere to attach.
  const existingNames = new Set(repo.listCollections().map((c) => c.name.toLowerCase()));
  const collectionIdMap = new Map<string, string>();
  const ordered = orderByDepth(share.collections);
  for (const incoming of ordered) {
    const parentId = incoming.parentId ? collectionIdMap.get(incoming.parentId) ?? null : null;
    // Only the root is renamed on a clash: subprojects are already distinguished by
    // sitting under it, and renaming them all would be noise.
    const isRoot = incoming.id === share.rootId;
    const name =
      isRoot && existingNames.has(incoming.name.toLowerCase())
        ? `${incoming.name}${attribution ? ` (from ${attribution})` : " (shared)"}`
        : incoming.name;
    const created = repo.createCollection(name, parentId);
    if (incoming.color) repo.updateCollection(created.id, { color: incoming.color });
    repo.updateCollection(created.id, {
      premise: incoming.premise,
      status: incoming.status,
    });
    collectionIdMap.set(incoming.id, created.id);
  }

  // ---- Papers ----
  const knownBefore = new Set(repo.listPapers().map((paper) => paper.id));
  const paperIdMap = new Map<string, string>();
  let papersAdded = 0;
  let papersAlreadyHad = 0;
  for (const incoming of share.papers) {
    const collectionIds = incoming.collectionIds
      .map((id) => collectionIdMap.get(id))
      .filter((id): id is string => !!id);
    // addPaper merges into an existing record when the DOI, arXiv id, or title
    // matches, so a paper you both have is filed into the new project rather than
    // duplicated.
    const saved = repo.addPaper(incoming, { collectionIds, tags: incoming.tags });
    const isNew = !knownBefore.has(saved.id);
    if (isNew) papersAdded += 1;
    else {
      papersAlreadyHad += 1;
      // Merge the project membership onto the copy already here.
      repo.setPaperCollections(saved.id, [...saved.collectionIds, ...collectionIds]);
    }
    if (isNew && incoming.takeaway) repo.updatePaper(saved.id, { takeaway: incoming.takeaway });
    paperIdMap.set(incoming.id, saved.id);
  }

  // ---- PDFs (only for papers this import introduced) ----
  let attachedPdfs = 0;
  for (const [incomingId, bytes] of Object.entries(pdfs)) {
    const localId = paperIdMap.get(incomingId);
    if (!localId || knownBefore.has(localId)) continue;
    await putPdf(localId, new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" }));
    repo.updatePaper(localId, { hasPdf: true });
    attachedPdfs += 1;
  }

  // ---- Notes ----
  const takenTitles = new Set(repo.listNotes().map((note) => note.title.toLowerCase()));
  let notesAdded = 0;
  for (const incoming of share.notes) {
    // A paper's notes doc follows its paper; a standalone note stands alone.
    const paperId = incoming.paperId ? paperIdMap.get(incoming.paperId) : undefined;
    const title = takenTitles.has(incoming.title.toLowerCase())
      ? `${incoming.title}${attribution ? ` (from ${attribution})` : " (shared)"}`
      : incoming.title;
    takenTitles.add(title.toLowerCase());
    repo.createNote({
      title,
      body: incoming.body,
      paperId,
      collectionIds: (incoming.collectionIds || [])
        .map((id) => collectionIdMap.get(id))
        .filter((id): id is string => !!id),
    });
    notesAdded += 1;
  }

  // ---- Questions ----
  let questionsAdded = 0;
  for (const incoming of share.questions) {
    const created = repo.createQuestion({
      title: incoming.title,
      detail: incoming.detail,
      linkedPaperIds: incoming.linkedPaperIds
        .map((id) => paperIdMap.get(id))
        .filter((id): id is string => !!id),
      collectionIds: (incoming.collectionIds || [])
        .map((id) => collectionIdMap.get(id))
        .filter((id): id is string => !!id),
    });
    if (incoming.status !== "open") repo.updateQuestion(created.id, { status: incoming.status });
    questionsAdded += 1;
  }

  // ---- Highlights (new papers only) ----
  let highlightsAdded = 0;
  for (const incoming of share.highlights) {
    const localId = paperIdMap.get(incoming.paperId);
    if (!localId || knownBefore.has(localId)) continue;
    repo.addHighlight({
      paperId: localId,
      page: incoming.page,
      color: incoming.color,
      text: incoming.text,
      note: incoming.note,
      rects: incoming.rects,
    });
    highlightsAdded += 1;
  }

  const rootId = collectionIdMap.get(share.rootId)!;
  return {
    projectId: rootId,
    projectName: repo.getCollection(rootId)?.name || "Shared project",
    sharedBy: attribution,
    projects: collectionIdMap.size,
    papersAdded,
    papersAlreadyHad,
    notes: notesAdded,
    questions: questionsAdded,
    highlights: highlightsAdded,
    pdfs: attachedPdfs,
  };
}

/** Read a `.latticeproject` file back into a share plus its PDF bytes. */
export async function readProjectShare(
  file: Blob
): Promise<{ share: ProjectShare; pdfs: Record<string, Uint8Array> }> {
  const { strFromU8, unzipSync } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    // fflate's own message here is "invalid zip data", which tells a person nothing.
    throw new Error(
      "That file could not be read as a shared lattice project. Check it is the .latticeproject file you were sent and that it downloaded completely."
    );
  }
  const manifest = files[MANIFEST];
  if (!manifest) throw new Error("That file is missing project.json.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifest));
  } catch {
    throw new Error("The shared project's manifest is damaged and could not be read.");
  }
  const share = parseProjectShare(parsed);
  const pdfs: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    const match = /^pdfs\/(.+)\.pdf$/.exec(name);
    if (match) pdfs[match[1]] = bytes;
  }
  return { share, pdfs };
}

/** Parents before children, so the tree can be rebuilt in one pass. */
function orderByDepth(collections: Collection[]): Collection[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const depthOf = (collection: Collection): number => {
    let depth = 0;
    let current = collection;
    const seen = new Set<string>();
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentId)!;
      depth += 1;
    }
    return depth;
  };
  return [...collections].sort((a, b) => depthOf(a) - depthOf(b));
}

export function projectShareFilename(name: string, date = new Date()): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `lattice-${slug}-${date.toISOString().slice(0, 10)}.latticeproject`;
}
