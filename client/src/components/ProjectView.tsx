// A project's front page.
//
// Not a filtered paper list — that already exists in the library. This is the page
// you open when you want to think about one idea: what you believe, what you do not
// know yet, what evidence you have, what you have written, and — the part that makes
// it a thinking tool rather than a shelf — what is missing.
//
// The order of the page is the order of the argument. Premise first, because
// without it nothing below can be judged. Questions next, because evidence with no
// question behind it is just reading. Then the evidence and the writing. The gaps
// panel sits alongside the premise, where it is impossible to ignore.

import { useEffect, useState } from "react";
import type { Collection, Note, Paper, ProjectStatus, ResearchQuestion } from "../types";
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES } from "../types";
import { collectionPath } from "../lib/collectionTree";
import { projectContents, projectGaps, projectPulse } from "../lib/projectWorkspace";
import { projectAsContext } from "../lib/projectContext";
import { labelSwatches } from "../lib/labelColor";
import {
  IconArrowRight,
  IconFile,
  IconCopy,
  IconCheck,
  IconFolder,
  IconGraph,
  IconLibrary,
  IconNote,
  IconPlus,
  IconQuestion,
  IconShare,
  IconSparkle,
  IconStar,
} from "./Icons";

interface Props {
  project: Collection;
  collections: Collection[];
  papers: Paper[];
  notes: Note[];
  questions: ResearchQuestion[];
  onOpenPaper: (id: string) => void;
  onOpenNote: (id: string) => void;
  /** Quick-file a paper or note — the same double-click gesture as the library. */
  onFilePaper: (id: string) => void;
  onFileNote: (id: string) => void;
  onOpenSubproject: (id: string) => void;
  onOpenAsList: () => void;
  onOpenGraph: () => void;
  onAddPaper: () => void;
  onUpdateProject: (patch: Partial<Collection>) => void;
  onCreateSubproject: (name: string) => void;
  onCreateNote: () => void;
  onShare: () => void;
  onExport: () => void;
  /** Bind every paper in the project into one PDF. */
  onCombinePdfs: () => void;
  /** Open this project's proposal, drafting one first if there is none. */
  onOpenProposal?: () => void;
  hasProposal?: boolean;
  /** Non-empty while that PDF is being built, e.g. "12 / 30". */
  combining?: string;
  onCreateQuestion: (title: string) => void;
  onUpdateQuestion: (id: string, patch: Partial<ResearchQuestion>) => void;
}

export default function ProjectView({
  project,
  collections,
  papers,
  notes,
  questions,
  onOpenPaper,
  onOpenNote,
  onFilePaper,
  onFileNote,
  onOpenSubproject,
  onOpenAsList,
  onOpenGraph,
  onAddPaper,
  onUpdateProject,
  onCreateSubproject,
  onCreateNote,
  onShare,
  onExport,
  onCombinePdfs,
  onOpenProposal,
  hasProposal,
  combining,
  onCreateQuestion,
  onUpdateQuestion,
}: Props) {
  const [premiseDraft, setPremiseDraft] = useState(project.premise || "");
  const [questionDraft, setQuestionDraft] = useState("");
  const [subprojectDraft, setSubprojectDraft] = useState("");
  const [showSubprojectInput, setShowSubprojectInput] = useState(false);
  const [copied, setCopied] = useState(false);

  // Switching projects clears everything in progress: an unsaved premise or a
  // half-typed question belongs to the project it was typed on.
  useEffect(() => {
    setQuestionDraft("");
    setSubprojectDraft("");
    setShowSubprojectInput(false);
  }, [project.id]);

  // The premise tracks the stored value separately. Folding this into the effect
  // above would mean saving the premise wiped a question you were part-way through
  // typing, since saving changes project.premise and would re-run the whole reset.
  useEffect(() => {
    setPremiseDraft(project.premise || "");
  }, [project.id, project.premise]);

  const contents = projectContents(project, collections, papers, notes, questions);
  const pulse = projectPulse(contents);
  const gaps = projectGaps(project, contents, collections);
  const path = collectionPath(collections, project.id);
  const paperIds = new Set(contents.papers.map((paper) => paper.id));
  const accent = project.color ? labelSwatches()[project.color].dot : "#22d3ee";

  // The project as Markdown, on the clipboard, for pasting into a chat.
  async function copyForChat() {
    await navigator.clipboard.writeText(
      projectAsContext(project, collections, papers, notes, questions)
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  function savePremise() {
    const premise = premiseDraft.trim();
    if (premise !== (project.premise || "")) onUpdateProject({ premise });
  }

  function submitQuestion() {
    const title = questionDraft.trim();
    if (!title) return;
    onCreateQuestion(title);
    setQuestionDraft("");
  }

  function submitSubproject() {
    const name = subprojectDraft.trim();
    if (!name) return;
    onCreateSubproject(name);
    setSubprojectDraft("");
    setShowSubprojectInput(false);
  }

  return (
    <div className="lat-scroll h-full overflow-y-auto bg-lattice-canvas">
      <div className="mx-auto max-w-5xl px-5 py-6 md:px-8">
        {/* ---- Header ---- */}
        <header className="flex flex-wrap items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
            style={{ background: accent }}
          />
          {/* On a narrow screen the title takes its own row: sharing it with the
              controls squeezes it into a one-word-per-line wrap. */}
          <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto">
            <p className="lat-kicker">
              {path.length > 1 ? path.slice(0, -1).join(" / ") : "Project"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">{project.name}</h1>
          </div>
          <select
            value={project.status || "idea"}
            onChange={(event) => onUpdateProject({ status: event.target.value as ProjectStatus })}
            className="lat-input px-2.5 py-1.5 text-xs"
            aria-label="Project status"
          >
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <button onClick={onOpenGraph} className="lat-secondary px-3 py-1.5 text-xs">
            <IconGraph width={13} /> Graph
          </button>
          <button onClick={onOpenAsList} className="lat-secondary px-3 py-1.5 text-xs">
            <IconLibrary width={13} /> Papers as a list
          </button>
          {onOpenProposal && (
            <button
              onClick={onOpenProposal}
              className="lat-secondary px-3 py-1.5 text-xs"
              title="A research proposal for this project, with the work split into tasks agents can run"
            >
              <IconSparkle width={13} /> {hasProposal ? "Proposal" : "Draft a proposal"}
            </button>
          )}
          <button
            onClick={onShare}
            className="lat-secondary px-3 py-1.5 text-xs"
            title="Save this project as a file another researcher can import into their own lattice"
          >
            <IconShare width={13} /> Share
          </button>
          <button
            onClick={onCombinePdfs}
            disabled={!!combining}
            className="lat-secondary px-3 py-1.5 text-xs disabled:opacity-50"
            title="Bind every paper in this project into a single PDF, with a contents page, dividers and bookmarks"
          >
            <IconFile width={13} />{" "}
            {combining ? `Combining ${combining}` : "Combine PDFs"}
          </button>
          <button
            onClick={copyForChat}
            className="lat-secondary px-3 py-1.5 text-xs"
            title="Copy this project — premise, questions, papers with takeaways, and notes — straight to the clipboard"
          >
            <IconCopy width={13} /> {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={onExport}
            className="lat-secondary px-3 py-1.5 text-xs"
            title="Send this project, or several, to Claude or ChatGPT"
          >
            <IconSparkle width={13} /> Ask an AI
          </button>
          <button onClick={onAddPaper} className="lat-primary px-3 py-1.5 text-xs">
            <IconPlus width={13} /> Add paper
          </button>
        </header>

        {/* ---- Premise + gaps ---- */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="lat-panel p-4">
            <label htmlFor="lattice-project-premise" className="lat-kicker">
              What you think might be true
            </label>
            <textarea
              id="lattice-project-premise"
              value={premiseDraft}
              onChange={(event) => setPremiseDraft(event.target.value)}
              onBlur={savePremise}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.blur();
              }}
              rows={3}
              placeholder="Replay during quiet rest is what consolidates the memory, not just a correlate of it."
              className="mt-2 w-full resize-y bg-transparent text-[15px] leading-6 text-slate-200 outline-none placeholder:text-slate-700"
            />
            <p className="mt-1 text-[11px] text-slate-600">
              One sentence, stated so it could turn out to be wrong. If it cannot be wrong, it is a
              topic — and topics belong in tags, not projects.
            </p>

            {/* The pulse: how far this has actually got. */}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-veil/5 pt-3 sm:grid-cols-4">
              <Stat label="Questions" value={`${pulse.questionsWithEvidence}/${pulse.questions}`} hint="with evidence" />
              <Stat label="Papers" value={`${pulse.papersRead}/${pulse.papers}`} hint="read" />
              <Stat label="Takeaways" value={`${pulse.takeaways}/${pulse.papers}`} hint="written" />
              <Stat label="Notes" value={String(pulse.notes)} hint="in your own words" />
            </dl>
          </section>

          <section className="lat-panel p-4">
            <h2 className="lat-kicker">
              {gaps.length ? `What this needs (${gaps.length})` : "Nothing missing"}
            </h2>
            {gaps.length === 0 ? (
              <p className="mt-2 flex items-start gap-2 text-sm text-slate-400">
                <span className="mt-0.5 text-emerald-400"><IconCheck width={14} /></span>
                Every question has evidence, every paper has a takeaway, and everything here is
                connected to something else. Go and write.
              </p>
            ) : (
              <ol className="mt-2 space-y-3">
                {gaps.map((gap, index) => (
                  <li key={gap.kind} className="flex gap-2.5">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-veil/[.08] bg-veil/[.04] text-[10px] tabular-nums text-slate-500">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-5 text-slate-200">{gap.title}</p>
                      <p className="mt-0.5 text-[11px] leading-[1.45] text-slate-600">{gap.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* ---- Questions ---- */}
        <Section
          icon={<IconQuestion width={15} />}
          title="Open questions"
          count={contents.questions.length}
          hint="What you do not know yet. This is where a project starts."
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitQuestion();
            }}
            className="mb-3 flex gap-2"
          >
            <input
              value={questionDraft}
              onChange={(event) => setQuestionDraft(event.target.value)}
              placeholder="What would falsify this?"
              aria-label="New question in this project"
              className="lat-input min-w-0 flex-1 px-3 py-2 text-sm"
            />
            <button disabled={!questionDraft.trim()} className="lat-primary px-3 py-2 text-sm disabled:opacity-40">
              <IconPlus width={13} /> Ask
            </button>
          </form>
          {contents.questions.length === 0 ? (
            <Empty>No questions yet. Write the vaguest version of the thing you are curious about.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {contents.questions.map((question) => {
                const evidence = question.linkedPaperIds.filter((id) => paperIds.has(id)).length;
                return (
                  <li key={question.id} className="lat-panel flex flex-wrap items-center gap-3 p-3">
                    <span className="min-w-0 flex-1 text-sm text-slate-200">{question.title}</span>
                    <span
                      className={`shrink-0 text-[11px] ${evidence ? "text-cyan-300" : "text-amber-400/80"}`}
                      title={evidence ? "Papers in this project bearing on it" : "Nothing here bears on it yet"}
                    >
                      {evidence ? `${evidence} paper${evidence === 1 ? "" : "s"}` : "no evidence"}
                    </span>
                    <select
                      value={question.status}
                      onChange={(event) =>
                        onUpdateQuestion(question.id, {
                          status: event.target.value as ResearchQuestion["status"],
                        })
                      }
                      className="lat-input shrink-0 px-2 py-1 text-[11px]"
                      aria-label={`Status of "${question.title}"`}
                    >
                      <option value="open">Open</option>
                      <option value="exploring">Exploring</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* ---- Evidence ---- */}
        <Section
          icon={<IconLibrary width={15} />}
          title="Evidence"
          count={contents.papers.length}
          hint="The papers, and what you concluded from each."
          action={
            contents.papers.length > 0 ? (
              <button onClick={onOpenAsList} className="lat-chip">
                Open as a list <IconArrowRight width={11} />
              </button>
            ) : undefined
          }
        >
          {contents.papers.length === 0 ? (
            <Empty>
              Nothing filed here yet. Add a paper while this project is selected and it lands here,
              or file existing papers into it from the library.
            </Empty>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {contents.papers.map((paper) => (
                <li key={paper.id} onDoubleClick={() => onFilePaper(paper.id)}>
                  <button
                    onClick={() => onOpenPaper(paper.id)}
                    title="Double-click to move this paper between projects"
                    className="lat-panel h-full w-full p-3 text-left hover:border-veil/[.14]"
                  >
                    <div className="flex items-start gap-2">
                      <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 text-slate-200">
                        {paper.title || "Untitled paper"}
                      </span>
                      {paper.favorite && <IconStar filled width={13} className="mt-0.5 shrink-0 text-amber-300" />}
                    </div>
                    <p
                      className={`mt-1.5 line-clamp-2 text-xs leading-5 ${
                        paper.takeaway?.trim() ? "text-slate-400" : "text-slate-700 italic"
                      }`}
                    >
                      {paper.takeaway?.trim() || "No takeaway written yet."}
                    </p>
                    <span className={`lat-status status-${paper.readingStatus || "inbox"} mt-2`}>
                      {paper.readingStatus === "read"
                        ? "Read"
                        : paper.readingStatus === "reading"
                        ? "In progress"
                        : "To read"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---- Thinking ---- */}
        <Section
          icon={<IconNote width={15} />}
          title="Thinking"
          count={contents.notes.length}
          hint="Your own words. A note earns its place when it puts two of these papers in one sentence."
          action={
            <button onClick={onCreateNote} className="lat-chip">
              <IconPlus width={11} /> New note here
            </button>
          }
        >
          {contents.notes.length === 0 ? (
            <Empty>Nothing written yet. The first note is usually the one that connects two papers.</Empty>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {contents.notes.map((note) => (
                <li key={note.id} onDoubleClick={() => onFileNote(note.id)}>
                  <button
                    onClick={() => onOpenNote(note.id)}
                    title="Double-click to move this note between projects"
                    className="lat-panel h-full w-full p-3 text-left hover:border-veil/[.14]"
                  >
                    <p className="truncate text-sm font-medium text-slate-200">
                      {note.title || "Untitled note"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                      {note.body.replace(/[#>*_`[\]]/g, "").trim().slice(0, 160) || "Empty note."}
                    </p>
                    {note.paperId && (
                      <span className="lat-kicker mt-2 block">Notes on a paper</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---- Subprojects ---- */}
        <Section
          icon={<IconFolder width={15} />}
          title="Subprojects"
          count={contents.subprojects.length}
          hint="The parts of the argument, not subtopics. A chapter, an experiment, a control you owe reviewers."
          action={
            <button onClick={() => setShowSubprojectInput((open) => !open)} className="lat-chip">
              <IconPlus width={11} /> New subproject
            </button>
          }
        >
          {showSubprojectInput && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitSubproject();
              }}
              className="mb-3 flex gap-2"
            >
              <input
                autoFocus
                value={subprojectDraft}
                onChange={(event) => setSubprojectDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setShowSubprojectInput(false);
                    setSubprojectDraft("");
                  }
                }}
                placeholder={`Part of ${project.name}`}
                aria-label="Name of the new subproject"
                className="lat-input min-w-0 flex-1 px-3 py-2 text-sm"
              />
              <button disabled={!subprojectDraft.trim()} className="lat-primary px-3 py-2 text-sm disabled:opacity-40">
                Create
              </button>
            </form>
          )}
          {contents.subprojects.length === 0 ? (
            <Empty>
              None yet, and that is usually right. Split a project only once you can name the parts
              of the argument.
            </Empty>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {contents.subprojects.map((child) => {
                const childContents = projectContents(child, collections, papers, notes, questions);
                const total =
                  childContents.papers.length + childContents.notes.length + childContents.questions.length;
                return (
                  <li key={child.id}>
                    <button
                      onClick={() => onOpenSubproject(child.id)}
                      className="lat-secondary px-3 py-2 text-sm"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: child.color ? labelSwatches()[child.color].dot : "rgba(148,163,184,.4)",
                        }}
                      />
                      {child.name}
                      <span className="text-[11px] text-slate-600">{total || "empty"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="lat-kicker">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-slate-200">
        {value} <span className="font-sans text-[11px] text-slate-600">{hint}</span>
      </dd>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  hint,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium text-slate-100">
          <span className="text-slate-500">{icon}</span>
          {title}
          <span className="text-xs tabular-nums text-slate-600">{count}</span>
        </h2>
        <p className="min-w-0 flex-1 text-[11px] text-slate-600">{hint}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-veil/[.08] px-4 py-5 text-center text-xs leading-5 text-slate-600">
      {children}
    </p>
  );
}
