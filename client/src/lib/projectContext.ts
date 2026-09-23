// A project, rendered as text you can paste into an LLM chat.
//
// The point is to hand a model the same thing a colleague would need: what you
// think might be true, what you do not know yet, what you have read and what you
// concluded from each, and what you have written. Abstracts are deliberately left
// out — your takeaway is the signal, the abstract is the paper's own marketing —
// which also keeps the block small enough to paste without truncation.
//
// Every paper carries its citation key, so anything the model drafts can be traced
// back to a record in your library rather than to a title it may have invented.

import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { citationKey } from "./citations";
import { collectionPath } from "./collectionTree";
import { projectContents, projectGaps, projectPulse } from "./projectWorkspace";

/** Trim a note body to something quotable without dumping a whole document. */
function excerpt(body: string, limit: number): string {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (text.length <= limit) return text;
  // Cut at a paragraph break where possible, so the excerpt ends on a thought.
  const cut = text.slice(0, limit);
  const lastBreak = cut.lastIndexOf("\n\n");
  return `${(lastBreak > limit * 0.5 ? cut.slice(0, lastBreak) : cut).trimEnd()}\n\n…[note continues]`;
}

export type ContextDetail = "brief" | "abstracts" | "full";

function paperLine(paper: Paper, detail: ContextDetail = "abstracts", fullTextChars = 6000): string {
  const authors =
    paper.authors.length > 3
      ? `${paper.authors.slice(0, 3).join(", ")} et al.`
      : paper.authors.join(", ") || "Unknown author";
  const where = [paper.venue, paper.year].filter(Boolean).join(", ");
  const identifier = paper.doi ? `doi:${paper.doi}` : paper.arxivId ? `arXiv:${paper.arxivId}` : "";
  const head = `- **${paper.title || "Untitled"}** — ${authors}${where ? ` (${where})` : ""} [${citationKey(paper)}]${identifier ? ` ${identifier}` : ""}`;
  const lines = [head];

  const takeaway = paper.takeaway?.trim();
  if (takeaway) lines.push(`  - My takeaway: ${takeaway}`);

  // The abstract is the paper's own account of itself. It used to be left out on
  // the grounds that the user's takeaway is the better signal — which is true
  // when a takeaway exists, and useless when it does not: a library with no
  // takeaways written exported as a list of bare titles.
  const abstract = paper.abstract?.trim();
  if (detail !== "brief" && abstract) {
    lines.push(`  - Abstract: ${abstract.replace(/\s+/g, " ")}`);
  } else if (!takeaway && !abstract) {
    lines.push("  - _No takeaway or abstract recorded for this one._");
  }

  // Extracted PDF text, for the cases where the abstract is not enough to answer
  // the question being asked of it. Truncated, because a handful of full papers
  // will exhaust any context window on their own.
  if (detail === "full") {
    const body = paper.pdfText?.trim();
    if (body) {
      const excerpt = body.replace(/\s+/g, " ").slice(0, fullTextChars);
      lines.push(
        `  - Full text${body.length > fullTextChars ? ` (first ${fullTextChars} characters of ${body.length})` : ""}: ${excerpt}`
      );
    }
  }

  return lines.join("\n");
}

export interface ProjectContextOptions {
  /** Characters of each note to include. Notes are the long part of the output. */
  noteLimit?: number;
  /**
   * How much of each paper travels. "brief" is titles and takeaways only,
   * "abstracts" adds the paper's own account of itself, "full" adds as much of
   * the extracted PDF text as the limit allows.
   */
  detail?: ContextDetail;
  /** Characters of extracted PDF text per paper, when detail is "full". */
  fullTextChars?: number;
}

/**
 * A project as Markdown, ready to paste into a chat.
 *
 * The gap list is included on purpose: telling a model what the project is missing
 * is often more useful than telling it what the project has, because it is the part
 * you actually want help with.
 */
export function projectAsContext(
  project: Collection,
  collections: Collection[],
  papers: Paper[],
  notes: Note[],
  questions: ResearchQuestion[],
  options: ProjectContextOptions = {}
): string {
  const noteLimit = options.noteLimit ?? 1500;
  const detail = options.detail ?? "abstracts";
  const fullTextChars = options.fullTextChars ?? 6000;
  const contents = projectContents(project, collections, papers, notes, questions);
  const pulse = projectPulse(contents);
  const gaps = projectGaps(project, contents, collections);
  const paperIds = new Set(contents.papers.map((paper) => paper.id));
  const path = collectionPath(collections, project.id);

  const out: string[] = [];
  out.push(`# Research project: ${project.name}`);
  if (path.length > 1) out.push(`_Part of: ${path.slice(0, -1).join(" / ")}_`);
  out.push("");
  out.push(
    "This is an export from my reference library. The papers below are ones I have actually read; " +
      "any takeaways and notes are my own words, while abstracts and full text are the papers' own. " +
      "Please ground anything you say about this project in these records, cite papers by their " +
      "[citation key], and say so plainly when the answer is not in here rather than filling the gap."
  );
  out.push("");

  out.push("## What I think might be true");
  out.push(project.premise?.trim() || "_Not stated yet._");
  out.push("");

  out.push("## Open questions");
  if (contents.questions.length === 0) {
    out.push("_None recorded yet._");
  } else {
    for (const question of contents.questions) {
      const evidence = question.linkedPaperIds.filter((id) => paperIds.has(id));
      const cited = evidence
        .map((id) => contents.papers.find((paper) => paper.id === id))
        .filter((paper): paper is Paper => !!paper)
        .map((paper) => citationKey(paper));
      out.push(
        `- **${question.title}** (${question.status})${cited.length ? ` — evidence: ${cited.join(", ")}` : " — _no evidence attached yet_"}`
      );
      if (question.detail.trim()) out.push(`  - ${question.detail.trim()}`);
    }
  }
  out.push("");

  out.push(`## Papers (${contents.papers.length}, ${pulse.papersRead} read)`);
  if (contents.papers.length === 0) out.push("_None filed yet._");
  else for (const paper of contents.papers) out.push(paperLine(paper, detail, fullTextChars));
  out.push("");

  out.push(`## My notes (${contents.notes.length})`);
  if (contents.notes.length === 0) {
    out.push("_None written yet._");
  } else {
    for (const note of contents.notes) {
      out.push(`### ${note.title || "Untitled note"}`);
      out.push(excerpt(note.body, noteLimit) || "_Empty._");
      out.push("");
    }
  }

  if (contents.subprojects.length) {
    out.push("## Subprojects");
    for (const child of contents.subprojects) out.push(`- ${child.name}`);
    out.push("");
  }

  if (gaps.length) {
    out.push("## What this project is still missing");
    out.push("_Computed by lattice, not by me. Useful context for what I need help with._");
    for (const gap of gaps) out.push(`- ${gap.title} — ${gap.detail}`);
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}


/** Roughly how many tokens a block of context will cost. */
export function estimateTokens(text: string): number {
  // ~4 characters per token is close enough for English prose to warn on.
  return Math.round(text.length / 4);
}

/**
 * Several projects as one document, for handing a whole line of work to an
 * assistant in a single paste.
 *
 * Each project keeps its own heading and its own gap list rather than being
 * merged into one flat pile, because which project a paper belongs to is part of
 * what you are telling the model.
 */
export function projectsAsContext(
  projects: Collection[],
  collections: Collection[],
  papers: Paper[],
  notes: Note[],
  questions: ResearchQuestion[],
  options: ProjectContextOptions = {}
): string {
  if (projects.length === 0) return "";
  if (projects.length === 1) {
    return projectAsContext(projects[0], collections, papers, notes, questions, options);
  }

  const parts = [
    `# Research context: ${projects.length} projects`,
    "",
    "This is an export from my reference library, covering more than one project. " +
      "The papers below are ones I have actually read; the takeaways and notes are my " +
      "own words. Please ground anything you say in these records, cite papers by their " +
      "[citation key], say which project a point comes from when it matters, and say so " +
      "plainly when the answer is not in here rather than filling the gap.",
    "",
    "Projects included: " + projects.map((project) => project.name).join("; "),
    "",
    "---",
    "",
  ];

  for (const project of projects) {
    // The per-project heading level is pushed down one, so the combined document
    // has a single top-level title rather than several competing ones.
    const body = projectAsContext(project, collections, papers, notes, questions, options)
      .split("\n")
      .map((line) => (line.startsWith("#") ? `#${line}` : line))
      .join("\n");
    parts.push(body, "", "---", "");
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
