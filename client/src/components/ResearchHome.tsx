import { useMemo, useState, type ReactNode } from "react";
import type { Note, Paper, ResearchQuestion } from "../types";
import { askLibrary } from "../lib/api";
import { parseInlineMarkdown } from "../lib/inlineMarkdown";
import type { ResearchProposal } from "../lib/researchProposals";
import {
  IconArrowRight,
  IconCheck,
  IconCompass,
  IconNote,
  IconPlus,
  IconQuestion,
  IconSparkle,
} from "./Icons";

interface Props {
  papers: Paper[];
  notes: Note[];
  questions: ResearchQuestion[];
  highlightCount: number;
  onOpenPaper: (id: string) => void;
  onOpenNote: (id: string) => void;
  onAddPaper: () => void;
  onOpenGuide: () => void;
  onNewNote: (title?: string, body?: string) => void;
  onCreateQuestion: (title: string) => void;
  onUpdateQuestion: (id: string, patch: Partial<ResearchQuestion>) => void;
  onDeleteQuestion: (id: string) => void;
  /** Suggested projects, derived from the library. */
  proposals: ResearchProposal[];
  onStartProposal: (proposal: ResearchProposal) => void;
  /**
   * "What to read next", passed in rather than built here: it talks to the network and
   * keeps a per-session cache, neither of which the desk should have to know about.
   */
  suggestedReading?: ReactNode;
}

// What kind of evidence produced a suggestion, so its weight can be judged.
const PROPOSAL_LABELS: Record<ResearchProposal["kind"], string> = {
  "method-transfer": "unexplored combination",
  "question-ready": "question with evidence",
  "unclaimed-reading": "reading with no question",
  "thin-premise": "claim needing evidence",
};

const statusLabel: Record<NonNullable<Paper["readingStatus"]>, string> = {
  inbox: "To read",
  reading: "In progress",
  read: "Read",
};

function dateLabel(iso?: string) {
  if (!iso) return "Not opened yet";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

// Answers come back as Markdown, so render the inline marks rather than showing
// their asterisks. Block structure is handled by whitespace-pre-wrap on the parent.
function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((token, i) => {
        if (token.type === "bold") return <strong key={i} className="font-semibold text-slate-100">{token.value}</strong>;
        if (token.type === "italic") return <em key={i}>{token.value}</em>;
        if (token.type === "code") return <code key={i} className="lat-code">{token.value}</code>;
        return <span key={i}>{token.value}</span>;
      })}
    </>
  );
}

export default function ResearchHome({
  papers,
  notes,
  questions,
  highlightCount,
  onOpenPaper,
  onOpenNote,
  onAddPaper,
  onOpenGuide,
  onNewNote,
  onCreateQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  proposals,
  onStartProposal,
  suggestedReading,
}: Props) {
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState<{ text: string; sourceIds: string[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [showAllQuestions, setShowAllQuestions] = useState(false);

  const queue = useMemo(() => [...papers]
    .filter((paper) => (paper.readingStatus || "inbox") !== "read")
    .sort((a, b) => {
      const weight = { "deep-dive": 0, next: 1, later: 2 } as const;
      return weight[a.priority || "later"] - weight[b.priority || "later"] ||
        (b.lastOpenedAt || b.addedAt).localeCompare(a.lastOpenedAt || a.addedAt);
    })
    .slice(0, 4), [papers]);

  const recentNotes = useMemo(() => [...notes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4), [notes]);
  const activeQuestions = questions.filter((question) => question.status !== "resolved");
  const visibleQuestions = showAllQuestions ? questions : activeQuestions.slice(0, 3);
  const readCount = papers.filter((paper) => paper.readingStatus === "read").length;
  const takeawayCount = papers.filter((paper) => paper.takeaway?.trim()).length;

  async function submitAsk(event: React.FormEvent) {
    event.preventDefault();
    if (!ask.trim() || papers.length === 0) return;
    setAsking(true);
    setAskError("");
    try {
      const result = await askLibrary(ask, papers);
      setAnswer({ text: result.answer, sourceIds: result.sourceIds });
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Could not ask the library.");
    } finally {
      setAsking(false);
    }
  }

  function saveAnswer() {
    if (!answer) return;
    const links = answer.sourceIds
      .map((id) => papers.find((paper) => paper.id === id))
      .filter((paper): paper is Paper => !!paper)
      .map((paper) => `[[${paper.title}]]`).join(" · ");
    onNewNote(`Research: ${ask}`.slice(0, 80), `# ${ask}\n\n${answer.text}\n\n## Sources\n\n${links}`);
  }

  function addQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (!questionDraft.trim()) return;
    onCreateQuestion(questionDraft);
    setQuestionDraft("");
  }

  if (papers.length === 0 && notes.length === 0 && questions.length === 0) {
    return (
      <div className="h-full overflow-auto bg-lattice-canvas">
        <div className="max-w-5xl mx-auto px-6 py-16 md:py-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-1 text-xs text-cyan-300">
            <IconCompass width={14} /> Your thinking space
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl md:text-6xl font-semibold tracking-tight text-slate-100">
            Read with purpose.<br /><span className="text-slate-500">Keep what matters.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-400">
            Lattice connects papers, questions, highlights, and notes so every reading session moves your research forward.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <button onClick={onAddPaper} className="lat-primary px-5 py-3 text-sm"><IconPlus /> Add your first paper</button>
            <button onClick={() => onNewNote()} className="lat-secondary px-5 py-3 text-sm"><IconNote /> Start a note</button>
          </div>
          <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-veil/5 bg-veil/5 md:grid-cols-3">
            {[
              ["01", "Collect", "Import by DOI, arXiv, PDF, or save from the web."],
              ["02", "Understand", "Highlight, annotate, and ask for grounded explanations."],
              ["03", "Connect", "Turn evidence into linked notes and durable questions."],
            ].map(([number, title, body]) => (
              <div key={number} className="bg-slate-950/80 p-6">
                <span className="font-mono text-xs text-cyan-400">{number}</span>
                <h2 className="mt-5 text-lg font-medium text-slate-100">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-lattice-canvas">
      <div className="max-w-7xl mx-auto px-5 py-7 lg:px-9 lg:py-9">
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="lat-kicker">Research desk · {new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date())}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-100">Where should we go next?</h1>
            <p className="mt-2 text-sm text-slate-500">Your evidence, questions, and next reads, together.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onOpenGuide} className="lat-secondary px-3.5 py-2 text-sm"><IconCompass /> Guide</button>
            <button onClick={() => onNewNote()} className="lat-secondary px-3.5 py-2 text-sm"><IconNote /> Quick note</button>
            <button onClick={onAddPaper} className="lat-primary px-3.5 py-2 text-sm"><IconPlus /> Add paper</button>
          </div>
        </header>

        <section className="mt-8 lat-panel p-1">
          <form onSubmit={submitAsk} className="p-5 md:p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-cyan-300"><IconSparkle /> Ask your library</div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input value={ask} onChange={(event) => setAsk(event.target.value)} placeholder="What does my library say about…" className="lat-input flex-1 px-4 py-3.5 text-base" />
              <button disabled={asking || !ask.trim() || papers.length === 0} className="lat-primary justify-center px-5 py-3 disabled:opacity-40">
                {asking ? "Reading…" : <>Explore <IconArrowRight /></>}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">Answers are grounded in your saved abstracts and takeaways.</p>
          </form>
          {(answer || askError) && (
            <div className="border-t border-veil/5 bg-slate-950/40 p-5 md:p-6">
              {askError ? <p className="text-sm text-rose-300">{askError}</p> : answer && <>
                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-300"><InlineMarkdown text={answer.text} /></div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {answer.sourceIds.map((id) => {
                    const paper = papers.find((item) => item.id === id);
                    return paper ? <button key={id} onClick={() => onOpenPaper(id)} className="lat-chip max-w-xs truncate">{paper.title}</button> : null;
                  })}
                  <button onClick={saveAnswer} className="ml-auto text-xs text-cyan-300 hover:text-cyan-200">Save as linked note →</button>
                </div>
              </>}
            </div>
          )}
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [papers.length, "papers", `${queue.length} in your queue`],
            [readCount, "papers read", papers.length ? `${Math.round(readCount / papers.length * 100)}% of library` : "Start reading"],
            [highlightCount, "highlights", "Evidence captured"],
            [takeawayCount, "takeaways", `${activeQuestions.length} active questions`],
          ].map(([value, label, sub]) => (
            <div key={label} className="lat-panel px-4 py-4">
              <div className="text-2xl font-semibold tracking-tight text-slate-100">{value}</div>
              <div className="mt-0.5 text-xs font-medium text-slate-400">{label}</div>
              <div className="mt-2 text-[11px] text-slate-600">{sub}</div>
            </div>
          ))}
        </section>

        {proposals.length > 0 && (
          <section className="mt-5 lat-panel overflow-hidden">
            <div className="lat-panel-header">
              <div>
                <p className="lat-kicker">Suggested projects</p>
                <h2 className="mt-1 font-medium text-slate-100">Things your library is pointing at</h2>
              </div>
              <span className="max-w-xs text-right text-[11px] leading-4 text-slate-600">
                Counted from what you have read, not generated. Every one says why.
              </span>
            </div>
            <ul className="divide-y divide-veil/[.045]">
              {proposals.map((proposal) => (
                <li key={proposal.id} className="group flex flex-wrap items-start gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-sm font-medium text-slate-100">{proposal.title}</h3>
                      <span className="lat-chip !py-0.5 text-[10px]">{PROPOSAL_LABELS[proposal.kind]}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{proposal.premise}</p>
                    <p className="mt-1.5 text-[11px] leading-4 text-slate-600">
                      {proposal.rationale}
                    </p>
                  </div>
                  <button
                    onClick={() => onStartProposal(proposal)}
                    className="lat-secondary shrink-0 px-3 py-1.5 text-xs"
                    title={`Create a project from this and file its ${proposal.paperIds.length} papers into it`}
                  >
                    Start it <IconArrowRight width={12} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {suggestedReading && <div className="mt-5">{suggestedReading}</div>}

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
          <section className="lat-panel overflow-hidden">
            <div className="lat-panel-header"><div><p className="lat-kicker">Focus queue</p><h2 className="mt-1 font-medium text-slate-100">Continue reading</h2></div><span className="text-xs text-slate-600">Priority first</span></div>
            {queue.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">Your reading queue is clear.</div> :
              <div className="divide-y divide-veil/5">{queue.map((paper, index) => (
                <button key={paper.id} onClick={() => onOpenPaper(paper.id)} className="group flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-veil/[.025]">
                  <span className="font-mono text-xs text-slate-700">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-medium text-slate-200 group-hover:text-slate-100">{paper.title}</h3><p className="mt-1 truncate text-xs text-slate-600">{paper.authors.slice(0, 2).join(", ") || paper.venue || "No author"} · {dateLabel(paper.lastOpenedAt)}</p></div>
                  <span className={`lat-status status-${paper.readingStatus || "inbox"}`}>{statusLabel[paper.readingStatus || "inbox"]}</span>
                  <IconArrowRight className="text-slate-700 group-hover:text-cyan-400" />
                </button>
              ))}</div>}
          </section>

          <section className="lat-panel overflow-hidden">
            <div className="lat-panel-header"><div><p className="lat-kicker">Research threads</p><h2 className="mt-1 font-medium text-slate-100">Open questions</h2></div><IconQuestion className="text-slate-600" /></div>
            <form onSubmit={addQuestion} className="flex gap-2 border-b border-veil/5 p-4"><input value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} className="lat-input min-w-0 flex-1 px-3 py-2 text-sm" placeholder="Capture a question…" /><button className="lat-secondary px-3" aria-label="Add question"><IconPlus /></button></form>
            <div className="divide-y divide-veil/5">
              {visibleQuestions.length === 0 ? <p className="p-6 text-sm text-slate-600">Questions give your reading a direction.</p> : visibleQuestions.map((question) => (
                <article key={question.id} className="group p-4">
                  <div className="flex items-start gap-3"><button onClick={() => onUpdateQuestion(question.id, { status: question.status === "resolved" ? "open" : "resolved" })} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${question.status === "resolved" ? "border-emerald-400 bg-emerald-400 text-slate-950" : "border-slate-700 text-transparent hover:border-cyan-400"}`}><IconCheck width={12} /></button><div className="min-w-0 flex-1"><p className={`text-sm leading-5 ${question.status === "resolved" ? "text-slate-600 line-through" : "text-slate-300"}`}>{question.title}</p><div className="mt-2 flex items-center gap-2"><select value={question.status} onChange={(event) => onUpdateQuestion(question.id, { status: event.target.value as ResearchQuestion["status"] })} className="bg-transparent text-[11px] text-slate-600 outline-none"><option value="open">Open</option><option value="exploring">Exploring</option><option value="resolved">Resolved</option></select><span className="text-[11px] text-slate-700">{question.linkedPaperIds.length} linked papers</span><button onClick={() => onDeleteQuestion(question.id)} className="ml-auto opacity-0 text-[11px] text-slate-600 hover:text-rose-400 group-hover:opacity-100">Remove</button></div></div></div>
                </article>
              ))}
            </div>
            {questions.length > 3 && <button onClick={() => setShowAllQuestions((value) => !value)} className="w-full border-t border-veil/5 px-4 py-3 text-xs text-slate-500 hover:text-slate-300">{showAllQuestions ? "Show active only" : `View all ${questions.length} questions`}</button>}
          </section>
        </div>

        <section className="mt-5 lat-panel overflow-hidden">
          <div className="lat-panel-header"><div><p className="lat-kicker">Recent thinking</p><h2 className="mt-1 font-medium text-slate-100">Notes you touched lately</h2></div><button onClick={() => onNewNote()} className="text-xs text-cyan-400 hover:text-cyan-300">New note +</button></div>
          {recentNotes.length === 0 ? <div className="p-8 text-center text-sm text-slate-600">Your notes will collect here as you read.</div> : <div className="grid gap-px bg-veil/5 sm:grid-cols-2 xl:grid-cols-4">{recentNotes.map((note) => (
            <button key={note.id} onClick={() => onOpenNote(note.id)} className="min-h-36 bg-slate-950/80 p-5 text-left hover:bg-slate-900"><IconNote className="text-slate-600" /><h3 className="mt-5 line-clamp-2 text-sm font-medium text-slate-200">{note.title}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{note.body.replace(/[#*_[\]]/g, " ") || "Empty note"}</p><p className="mt-4 text-[11px] text-slate-700">Edited {dateLabel(note.updatedAt)}</p></button>
          ))}</div>}
        </section>
      </div>
    </div>
  );
}
