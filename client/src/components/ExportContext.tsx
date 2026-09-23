// Handing one or more projects to an assistant.
//
// The useful thing here is not the copying, it is the size. A library of five
// hundred papers makes a document no chat window will take, and finding that out
// after pasting is a waste of everybody's time — so the estimate is shown before
// you commit, and the options that shrink it are next to it.
//
// Claude and ChatGPT are opened in a tab rather than pre-filled: neither accepts a
// document of this size through a URL, so the honest flow is copy, then paste.

import { useMemo, useRef, useState } from "react";
import type { Collection, Note, Paper, ResearchQuestion } from "../types";
import { buildCollectionTree, flattenCollectionTree } from "../lib/collectionTree";
import { estimateTokens, projectsAsContext, type ContextDetail } from "../lib/projectContext";
import { projectsAsAgentBrief } from "../lib/agentBrief";
import { labelSwatches } from "../lib/labelColor";
import { saveFileAs } from "../lib/desktop";
import { useModalFocus } from "./useModalFocus";
import { IconArrowRight, IconCopy, IconDownload } from "./Icons";

interface Props {
  collections: Collection[];
  papers: Paper[];
  notes: Note[];
  questions: ResearchQuestion[];
  /** Pre-ticked when opened from a project's own page. */
  initialIds?: string[];
  onClose: () => void;
  onNotice: (message: string, tone?: "done" | "problem") => void;
}

export default function ExportContext({
  collections,
  papers,
  notes,
  questions,
  initialIds = [],
  onClose,
  onNotice,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds));
  const [includeNotes, setIncludeNotes] = useState(true);
  // Two different documents. A chat paste is read once by a person's assistant and
  // can be long; a CLAUDE.md sits in a repository and is read at the top of every
  // turn, so it is written as instructions and kept small.
  const [format, setFormat] = useState<"chat" | "agent">("chat");
  // How much of each paper travels. Abstracts by default: a takeaway is the
  // better signal when one exists, and most libraries have plenty of papers
  // where none does.
  const [detail, setDetail] = useState<ContextDetail>("abstracts");
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef);

  const rows = flattenCollectionTree(buildCollectionTree(collections));
  const chosen = collections.filter((collection) => selected.has(collection.id));

  const context = useMemo(
    () =>
      format === "agent"
        ? projectsAsAgentBrief(chosen, collections, papers, notes, questions, {
            fullNotes: includeNotes,
            detail,
          })
        : projectsAsContext(chosen, collections, papers, notes, questions, {
            noteLimit: includeNotes ? 4000 : 0,
            detail,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, includeNotes, format, detail, collections, papers, notes, questions]
  );

  // What the chosen projects can actually supply, so the control says what each
  // level will really get you rather than what it would get in principle.
  const available = useMemo(() => {
    const ids = new Set(chosen.map((collection) => collection.id));
    const inScope = papers.filter((paper) => paper.collectionIds.some((id) => ids.has(id)));
    return {
      papers: inScope.length,
      takeaways: inScope.filter((paper) => paper.takeaway?.trim()).length,
      abstracts: inScope.filter((paper) => paper.abstract?.trim()).length,
      fullText: inScope.filter((paper) => paper.pdfText?.trim()).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, papers]);

  const tokens = estimateTokens(context);
  // Comfortably inside a normal chat turn; past this, paste starts to be refused.
  const heavy = tokens > 60_000;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(context);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  async function download() {
    const name =
      chosen.length === 1
        ? chosen[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
        : "projects";
    // CLAUDE.md has to be called CLAUDE.md: the filename is how an agent finds it.
    const filename = format === "agent" ? "CLAUDE.md" : `lattice-${name || "context"}.md`;
    const saved = await saveFileAs(new Blob([context], { type: "text/markdown" }), filename, [
      { name: "Markdown", extensions: ["md"] },
    ]);
    if (saved !== null) {
      onNotice(
        format === "agent"
          ? "Saved CLAUDE.md. Put it in the repository the agent works in."
          : "Saved the context as a Markdown file."
      );
    }
  }

  async function openIn(service: "claude" | "chatgpt") {
    // Copy first: the tab that opens is empty, and the whole point is the paste.
    await navigator.clipboard.writeText(context);
    window.open(service === "claude" ? "https://claude.ai/new" : "https://chatgpt.com/", "_blank", "noopener");
    onNotice(`Copied. Paste it into the ${service === "claude" ? "Claude" : "ChatGPT"} tab that just opened.`);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-12 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Send projects to an assistant"
    >
      <div ref={panelRef} className="lat-panel flex max-h-[86vh] w-full max-w-xl flex-col p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-slate-100">Send to an assistant</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Your premise, questions, papers with your own takeaways, and your notes — as one
              document to paste into a chat.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-slate-500 hover:text-slate-200">
            Close
          </button>
        </div>

        <div className="mt-4 flex rounded-lg border border-veil/[.07] bg-well/20 p-0.5 text-xs">
          {([
            ["chat", "Chat context", "One document to paste into a conversation."],
            ["agent", "CLAUDE.md", "An instruction file for a coding agent to read every turn."],
          ] as const).map(([value, label, hint]) => (
            <button
              key={value}
              onClick={() => setFormat(value)}
              title={hint}
              className={`flex-1 rounded-md px-2.5 py-1.5 ${
                format === value ? "bg-veil/10 text-cyan-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-slate-600">
          {format === "agent"
            ? "Written as instructions: how to cite, what not to invent, and where the gaps are. Points the agent at the lattice MCP tools for anything not inlined."
            : "Premise, questions, papers with your takeaways, and your notes, as one grounded document."}
        </p>

        <div className="lat-scroll mt-3 min-h-0 flex-1 overflow-y-auto border-y border-veil/5 py-2">
          {rows.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-600">
              No projects yet. Group some papers first, then send them here.
            </p>
          ) : (
            <ul>
              {rows.map(({ collection, depth }) => (
                <li key={collection.id}>
                  <label
                    className="flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-2 text-sm text-slate-300 hover:bg-veil/[.05]"
                    style={{ paddingLeft: 8 + depth * 16 }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(collection.id)}
                      onChange={() => toggle(collection.id)}
                      className="accent-cyan-400"
                    />
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: collection.color
                          ? labelSwatches()[collection.color].dot
                          : "rgba(148,163,184,.35)",
                      }}
                    />
                    <span className="truncate">{collection.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">How much of each paper</p>
          <div className="mt-1.5 flex rounded-lg border border-veil/[.07] bg-well/20 p-0.5 text-xs">
            {([
              ["brief", "Takeaways"],
              ["abstracts", "+ Abstracts"],
              ["full", "+ Full text"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setDetail(value)}
                className={`flex-1 rounded-md px-2 py-1.5 ${
                  detail === value ? "bg-veil/10 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-slate-600">
            {detail === "brief"
              ? `Your own one-line takeaways only — ${available.takeaways} of ${available.papers} chosen papers have one.`
              : detail === "abstracts"
              ? `The papers' own abstracts too — ${available.abstracts} of ${available.papers} have one recorded.`
              : `Everything, including extracted PDF text — ${available.fullText} of ${available.papers} have text stored. This gets large.`}
          </p>
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={includeNotes}
            onChange={(event) => setIncludeNotes(event.target.checked)}
            className="mt-0.5 accent-cyan-400"
          />
          <span>
            Include my notes in full
            <span className="block text-[11px] text-slate-600">
              {format === "agent"
                ? "Off lists each note by title and opening line — this file is read on every turn, so smaller is better."
                : "Off keeps the premise, questions, papers, and takeaways — much smaller."}
            </span>
          </span>
        </label>

        <div className="mt-3 flex items-center gap-2 rounded-lg border border-veil/[.07] bg-well/20 px-3 py-2 text-xs">
          <span className="text-slate-500">Roughly</span>
          <span className={`font-mono ${heavy ? "text-amber-300" : "text-slate-300"}`}>
            {tokens.toLocaleString()} tokens
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-600">{context.length.toLocaleString()} characters</span>
          {heavy && (
            <span className="ml-auto text-right text-[11px] leading-4 text-amber-400/80">
              Large for one chat message — untick notes, or pick fewer projects.
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={download}
            disabled={!chosen.length}
            className="lat-secondary mr-auto px-3 py-2 text-sm disabled:opacity-40"
          >
            <IconDownload width={13} /> {format === "agent" ? "Save CLAUDE.md" : "Save as .md"}
          </button>
          <button
            onClick={copy}
            disabled={!chosen.length}
            className="lat-secondary px-3 py-2 text-sm disabled:opacity-40"
          >
            <IconCopy width={13} /> {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => openIn("chatgpt")}
            disabled={!chosen.length}
            className="lat-secondary px-3 py-2 text-sm disabled:opacity-40"
          >
            ChatGPT <IconArrowRight width={12} />
          </button>
          <button
            onClick={() => openIn("claude")}
            disabled={!chosen.length}
            className="lat-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            Claude <IconArrowRight width={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
