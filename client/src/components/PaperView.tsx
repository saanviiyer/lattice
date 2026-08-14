// A paper's workspace: the PDF annotation surface on the left, a highlights/notes
// sidebar on the right, plus AI actions (explain a highlight, synthesize highlights
// into a note).

import { useEffect, useState } from "react";
import type { Highlight, HighlightColor, Paper } from "../types";
import { HIGHLIGHT_COLORS } from "../types";
import { repo } from "../lib/repository";
import { getPdf } from "../lib/blobStore";
import { explainHighlight, synthesizeNote } from "../lib/api";
import PdfReader from "./PdfReader";
import { IconSparkle, IconTrash, IconNote, IconBack } from "./Icons";

interface Props {
  paper: Paper;
  onBack: () => void;
  onOpenPaperNote: (paperId: string) => void;
  onNoteCreated: () => void;
}

const COLOR_SWATCH: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#22c55e",
  blue: "#3b82f6",
  pink: "#ec4899",
  orange: "#f97316",
};

export default function PaperView({
  paper,
  onBack,
  onOpenPaperNote,
  onNoteCreated,
}: Props) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobState, setBlobState] = useState<"loading" | "none" | "ready">(
    "loading"
  );
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [activeColor, setActiveColor] = useState<HighlightColor>("yellow");
  const [scale, setScale] = useState(1.3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [aiText, setAiText] = useState<{ id: string; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  function refreshHighlights() {
    setHighlights(repo.listHighlights(paper.id));
  }

  useEffect(() => {
    refreshHighlights();
    setBlobState("loading");
    let cancelled = false;
    getPdf(paper.id)
      .then((b) => {
        if (cancelled) return;
        setBlob(b);
        setBlobState(b ? "ready" : "none");
      })
      .catch(() => {
        if (!cancelled) setBlobState("none");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.id]);

  function createHighlight(h: { page: number; text: string; rects: Highlight["rects"] }) {
    const created = repo.addHighlight({
      paperId: paper.id,
      page: h.page,
      text: h.text,
      rects: h.rects,
      color: activeColor,
    });
    refreshHighlights();
    setSelectedId(created.id);
  }

  function updateNote(id: string, note: string) {
    repo.updateHighlight(id, { note });
    refreshHighlights();
  }
  function setColor(id: string, color: HighlightColor) {
    repo.updateHighlight(id, { color });
    refreshHighlights();
  }
  function remove(id: string) {
    repo.deleteHighlight(id);
    if (selectedId === id) setSelectedId(null);
    refreshHighlights();
  }

  async function explain(h: Highlight) {
    setAiBusy(true);
    setAiText(null);
    try {
      const context = (paper.abstract || paper.pdfText || "").slice(0, 1500);
      const { explanation } = await explainHighlight(h.text, context);
      setAiText({ id: h.id, text: explanation });
    } catch (e) {
      setAiText({ id: h.id, text: e instanceof Error ? e.message : "Explain failed." });
    } finally {
      setAiBusy(false);
    }
  }

  async function synthesize() {
    if (highlights.length === 0) return;
    setAiBusy(true);
    try {
      const { note } = await synthesizeNote(
        paper.title,
        highlights.map((h) => ({ text: h.text, note: h.note, page: h.page }))
      );
      repo.createNote({
        title: `Synthesis: ${paper.title}`.slice(0, 80),
        body: note,
        paperId: paper.id,
      });
      onNoteCreated();
      setStatus("Created a synthesis note from your highlights.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Synthesize failed.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-900">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-sm"
        >
          <IconBack /> Library
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{paper.title || "Untitled paper"}</div>
          <div className="truncate text-xs text-slate-500">
            {paper.authors.slice(0, 4).join(", ")}
            {paper.year ? ` · ${paper.year}` : ""}
            {paper.venue ? ` · ${paper.venue}` : ""}
          </div>
        </div>
        <button
          onClick={() => onOpenPaperNote(paper.id)}
          className="text-sm flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-md px-3 py-1.5"
        >
          <IconNote /> Notes
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* PDF surface */}
        <div className="flex-1 min-w-0 flex flex-col">
          {blobState === "ready" ? (
            <>
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-slate-800 bg-slate-900/70 text-sm">
                <span className="text-slate-400">Highlight color</span>
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setActiveColor(c)}
                    title={c}
                    className={`w-5 h-5 rounded-full border-2 ${
                      activeColor === c ? "border-white" : "border-transparent"
                    }`}
                    style={{ background: COLOR_SWATCH[c] }}
                  />
                ))}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => setScale((s) => Math.max(0.6, s - 0.15))}
                    className="px-2 py-0.5 bg-slate-800 rounded"
                  >
                    −
                  </button>
                  <span className="text-slate-400 w-10 text-center">
                    {Math.round(scale * 100)}%
                  </span>
                  <button
                    onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
                    className="px-2 py-0.5 bg-slate-800 rounded"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <PdfReader
                  blob={blob}
                  highlights={highlights}
                  activeColor={activeColor}
                  scale={scale}
                  onCreate={createHighlight}
                  onSelectHighlight={(id) => {
                    setSelectedId(id);
                    setScrollTarget(id);
                  }}
                  scrollTargetId={scrollTarget}
                  onStatus={setStatus}
                />
              </div>
              <div className="px-4 py-1 text-xs text-slate-500 border-t border-slate-800">
                {status}
              </div>
            </>
          ) : blobState === "loading" ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              Loading PDF…
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 gap-2 p-8">
              <p className="max-w-sm">
                No PDF is stored for this paper. It was added by DOI or arXiv (metadata
                only). PDF annotation needs an uploaded PDF file.
              </p>
              <p className="text-xs">
                You can still write linked notes for it from the Notes button.
              </p>
            </div>
          )}
        </div>

        {/* Highlights sidebar */}
        <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-900 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <h3 className="font-medium text-sm">
              Highlights ({highlights.length})
            </h3>
            <button
              onClick={synthesize}
              disabled={aiBusy || highlights.length === 0}
              className="text-xs flex items-center gap-1 bg-indigo-600/80 hover:bg-indigo-600 disabled:opacity-40 rounded px-2 py-1"
              title="Synthesize highlights into a note"
            >
              <IconSparkle /> Synthesize
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            {highlights.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                Select text in the PDF to create a highlight.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {highlights.map((h) => (
                  <li
                    key={h.id}
                    className={`p-3 ${
                      selectedId === h.id ? "bg-slate-800/70" : ""
                    }`}
                  >
                    <button
                      className="text-left w-full"
                      onClick={() => {
                        setSelectedId(h.id);
                        setScrollTarget(h.id);
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ background: COLOR_SWATCH[h.color] }}
                        />
                        <span className="text-xs text-slate-500">p.{h.page}</span>
                      </div>
                      <p className="text-sm text-slate-200 line-clamp-3">{h.text}</p>
                    </button>

                    {selectedId === h.id && (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center gap-1">
                          {HIGHLIGHT_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => setColor(h.id, c)}
                              className={`w-4 h-4 rounded-full border ${
                                h.color === c ? "border-white" : "border-transparent"
                              }`}
                              style={{ background: COLOR_SWATCH[c] }}
                            />
                          ))}
                          <button
                            onClick={() => remove(h.id)}
                            className="ml-auto text-slate-500 hover:text-rose-400"
                            title="Delete highlight"
                          >
                            <IconTrash />
                          </button>
                        </div>
                        <textarea
                          value={h.note || ""}
                          onChange={(e) => updateNote(h.id, e.target.value)}
                          placeholder="Add a note…"
                          className="w-full text-sm bg-slate-800 border border-slate-700 rounded p-2 resize-y min-h-[52px] outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={() => explain(h)}
                          disabled={aiBusy}
                          className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
                        >
                          <IconSparkle /> Explain this
                        </button>
                        {aiText && aiText.id === h.id && (
                          <div className="text-xs text-slate-300 bg-slate-800/70 border border-slate-700 rounded p-2 whitespace-pre-wrap">
                            {aiText.text}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
