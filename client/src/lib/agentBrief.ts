// A project as a CLAUDE.md — an instruction file for a coding agent.
//
// This is a different document from the chat export, and the difference matters.
// A chat paste is read once by a person's assistant and can be enormous. A
// CLAUDE.md sits in a repository and is read at the top of every single turn, so
// it has to stay small, stay stable, and be written as instructions rather than
// as a conversation opener.
//
// It is also written knowing that an agent can fetch more: where the lattice MCP
// server is available, the brief names the tools instead of inlining the whole
// library, which is both smaller and fresher than a snapshot would be.

import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { citationKey } from "./citations";
import { collectionPath } from "./collectionTree";
import { projectContents, projectGaps } from "./projectWorkspace";
import type { ContextDetail } from "./projectContext";

export interface AgentBriefOptions {
  /** Mention the lattice MCP tools, for an agent that has them. */
  mentionMcp?: boolean;
  /** Include the body of each note. Off by default: this file is read every turn. */
  fullNotes?: boolean;
  /** Papers listed in full before the rest are summarised as a count. */
  paperLimit?: number;
  /** How much of each paper travels. See ContextDetail. */
  detail?: ContextDetail;
  /** Characters of abstract per paper. This file is read every turn. */
  abstractChars?: number;
  /** Characters of extracted PDF text per paper, when detail is "full". */
  fullTextChars?: number;
}

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function paperLine(
  paper: Paper,
  detail: ContextDetail,
  abstractChars: number,
  fullTextChars: number
): string {
  const year = paper.year ? ` (${paper.year})` : "";
  const identifier = paper.doi ? ` doi:${paper.doi}` : paper.arxivId ? ` arXiv:${paper.arxivId}` : "";
  const lines = [
    `- \`${citationKey(paper)}\` — ${oneLine(paper.title || "Untitled", 110)}${year}${identifier}`,
  ];

  const takeaway = paper.takeaway?.trim();
  if (takeaway) lines.push(`  - User's takeaway: ${oneLine(takeaway, 200)}`);

  // Truncated harder than in the chat export: this file is read at the top of
  // every turn, so an abstract's opening — which is where the claim is — earns
  // its place, and the methods paragraph does not.
  const abstract = paper.abstract?.trim();
  if (detail !== "brief" && abstract) {
    lines.push(`  - Abstract: ${oneLine(abstract, abstractChars)}`);
  }
  if (detail === "full") {
    const body = paper.pdfText?.trim();
    if (body) lines.push(`  - Full text (excerpt): ${oneLine(body, fullTextChars)}`);
  }
  return lines.join("\n");
}

/**
 * One or more projects as a CLAUDE.md.
 *
 * The rules section is the point of the file. Everything else is context an
 * agent could get elsewhere; the rules are what stop it inventing a citation
 * that looks exactly like the real ones.
 */
export function projectsAsAgentBrief(
  projects: Collection[],
  collections: Collection[],
  papers: Paper[],
  notes: Note[],
  questions: ResearchQuestion[],
  options: AgentBriefOptions = {}
): string {
  const mentionMcp = options.mentionMcp ?? true;
  const fullNotes = options.fullNotes ?? false;
  const paperLimit = options.paperLimit ?? 60;
  const detail = options.detail ?? "abstracts";
  const abstractChars = options.abstractChars ?? 500;
  const fullTextChars = options.fullTextChars ?? 4000;

  if (projects.length === 0) return "";
  const out: string[] = [];

  const title =
    projects.length === 1
      ? collectionPath(collections, projects[0].id).join(" / ")
      : `${projects.length} research projects`;
  out.push(`# ${title}`, "");
  out.push(
    "Research context exported from lattice, a reference library. The papers below " +
      "are ones the user has read. Any takeaway and any note is the user's own words; " +
      "abstracts and full-text excerpts are the papers' own, quoted as recorded.",
    ""
  );

  // ---- The rules. First, because they govern everything after them. ----
  out.push("## How to use this");
  out.push(
    "- Ground claims about this literature in the records below. If something is not here, say so rather than filling the gap from memory.",
    "- Cite papers by their citation key in backticks, exactly as written — `Smith2024title`. Never invent a key, a title, or an author; a fabricated citation that matches the format of the real ones is the worst possible failure here.",
    "- The user's takeaway is their own reading of a paper. Treat it as their position, and distinguish it from what the paper itself claims and from its abstract.",
    "- Abstracts and full-text excerpts are truncated. If a claim turns on something past the cut, say that you cannot see it rather than guessing what follows.",
    "- A premise is a working claim, not a settled result. It is written so it could turn out to be wrong; say when the evidence here does not support it.",
    "- Where a question is marked as having no evidence attached, that is a real gap, not an oversight to paper over."
  );
  out.push("");

  const seenPapers = new Set<string>();
  for (const project of projects) {
    const contents = projectContents(project, collections, papers, notes, questions);
    const gaps = projectGaps(project, contents, collections);
    const heading = projects.length === 1 ? "##" : "##";

    if (projects.length > 1) out.push(`---`, "", `## ${project.name}`, "");

    out.push(`${projects.length > 1 ? "###" : heading} Premise`);
    const premise = project.premise?.trim();
    // A premise lattice wrote when it grouped the papers is a description of what
    // they have in common, not a claim the user is making. Handing it to an agent
    // as the project's position would put words in their mouth.
    const isPlaceholder = !!premise && /^(Grouped|Proposed) (automatically )?from/.test(premise);
    if (!premise) out.push("_Not stated yet: the user has not said what they think might be true._");
    else if (isPlaceholder) {
      out.push(
        `_No premise stated yet. lattice grouped these papers automatically and left a placeholder: "${oneLine(premise, 160)}" — treat it as a description of the contents, not as the user's claim._`
      );
    } else out.push(premise);
    out.push("");

    out.push(`${projects.length > 1 ? "###" : heading} Open questions`);
    if (contents.questions.length === 0) out.push("_None recorded._");
    else {
      const paperIds = new Set(contents.papers.map((paper) => paper.id));
      for (const question of contents.questions) {
        const evidence = question.linkedPaperIds
          .map((id) => contents.papers.find((paper) => paper.id === id))
          .filter((paper): paper is Paper => !!paper)
          .map((paper) => `\`${citationKey(paper)}\``);
        void paperIds;
        out.push(
          `- **${question.title}** (${question.status})` +
            (evidence.length ? ` — evidence: ${evidence.join(", ")}` : " — **no evidence attached**")
        );
      }
    }
    out.push("");

    out.push(`${projects.length > 1 ? "###" : heading} Papers (${contents.papers.length})`);
    const fresh = contents.papers.filter((paper) => !seenPapers.has(paper.id));
    for (const paper of fresh.slice(0, paperLimit)) {
      seenPapers.add(paper.id);
      out.push(paperLine(paper, detail, abstractChars, fullTextChars));
    }
    if (fresh.length > paperLimit) {
      out.push(
        `- _…and ${fresh.length - paperLimit} more. ` +
          (mentionMcp ? "Use the lattice tools below for the rest." : "Export again to include them.") +
          "_"
      );
    }
    out.push("");

    if (contents.notes.length) {
      out.push(`${projects.length > 1 ? "###" : heading} The user's notes (${contents.notes.length})`);
      for (const note of contents.notes) {
        if (fullNotes) {
          out.push(`#### ${note.title || "Untitled note"}`, note.body.trim() || "_Empty._", "");
        } else {
          const first =
            note.body
              .split("\n")
              .map((line) => line.replace(/^[#>\-*\s]+/, "").trim())
              .find(Boolean) || "empty";
          out.push(`- **${note.title || "Untitled note"}** — ${oneLine(first, 160)}`);
        }
      }
      out.push("");
    }

    if (gaps.length) {
      out.push(`${projects.length > 1 ? "###" : heading} Known gaps`);
      out.push("_Computed by lattice from the project's own contents._");
      for (const gap of gaps) out.push(`- ${gap.title}`);
      out.push("");
    }
  }

  if (mentionMcp) {
    out.push("---", "");
    out.push("## Getting more from the library");
    out.push(
      "If the lattice MCP server is connected, prefer it over this file for anything " +
        "not written above — it reads the live library, so it is never out of date:",
      "",
      "- `list_projects` — every project, its premise, and how much is filed under it",
      "- `get_project` — one project in full, including notes and what it is still missing",
      "- `search_library` — papers, the user's notes, and their PDF highlights, with filters like `author:`, `year:`, `tag:`",
      "- `get_paper` — one paper's metadata, abstract, takeaway, and every passage the user highlighted",
      "- `get_note` — the full text of one note",
      "- `list_questions` — open questions across the whole library",
      ""
    );
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
