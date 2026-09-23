// A paper's workspace: the PDF annotation surface on the left, a highlights/notes
// sidebar on the right, plus AI actions (explain a highlight, synthesize highlights
// into a note).

import type { ProjectFit, SimilarPaper } from "../lib/paperSimilarity";
import { useEffect, useState } from "react";
import type { Collection, Highlight, HighlightColor, Paper, ResearchQuestion } from "../types";
import { HIGHLIGHT_COLORS, ITEM_TYPE_LABELS } from "../types";
import { repo } from "../lib/repository";
import { getPdf, putPdf } from "../lib/blobStore";
import { canFetchPdf, explainHighlight, metadataFromPdf, synthesizeNote } from "../lib/api";
import { annotatedPdfFilename, createAnnotatedPdf } from "../lib/annotatedPdf";
import { citationKey } from "../lib/citations";
import PdfReader from "./PdfReader";
import { ProjectLabel } from "./ProjectDots";
import { IconCopy, IconSparkle, IconStar, IconTrash, IconNote, IconBack } from "./Icons";

interface Props {
  paper: Paper;
  papers: Paper[];
  collections: Collection[];
  questions: ResearchQuestion[];
  /** True while an open-access PDF is being fetched for this paper. */
  fetchingPdf: boolean;
  onFetchPdf: () => void;
  /** Open the quick-file dialog for this paper. */
  onFile: () => void;
  onBack: () => void;
  onOpenPaperNote: (paperId: string) => void;
  onNoteCreated: () => void;
  onPaperUpdated: () => void;
  onQuestionUpdated: () => void;
  /** Papers in the library about the same thing, with what they share. */
  similar?: SimilarPaper[];
  /** Projects this paper sits close to but is not filed in. */
  projectFits?: ProjectFit[];
  onOpenPaper?: (id: string) => void;
  onAddToProject?: (projectId: string) => void;
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
  papers,
  collections,
  questions,
  fetchingPdf,
  onFetchPdf,
  onFile,
  onBack,
  onOpenPaperNote,
  onNoteCreated,
  onPaperUpdated,
  onQuestionUpdated,
  similar = [],
  projectFits = [],
  onOpenPaper,
  onAddToProject,
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
  const [exportBusy, setExportBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showAbstract, setShowAbstract] = useState(false);
  const [tagDraft, setTagDraft] = useState(paper.tags.join(", "));
  const [pdfBusy, setPdfBusy] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState(() => metadataDraft(paper));
  const [takeawayDraft, setTakeawayDraft] = useState(paper.takeaway || "");

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

  useEffect(() => {
    setTagDraft(paper.tags.join(", "));
    setDetailsDraft(metadataDraft(paper));
    setTakeawayDraft(paper.takeaway || "");
  }, [paper.id, paper.tags]);

  function saveDetails() {
    const title = detailsDraft.title.trim();
    if (!title) {
      setStatus("A paper title is required.");
      return;
    }
    const parsedYear = detailsDraft.year.trim() ? Number(detailsDraft.year) : null;
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1000 || parsedYear > 9999)) {
      setStatus("Year must be a four-digit number.");
      return;
    }
    repo.updatePaper(paper.id, {
      title,
      itemType: detailsDraft.itemType,
      authors: detailsDraft.authors.split("\n").map((author) => author.trim()).filter(Boolean),
      year: parsedYear,
      venue: detailsDraft.venue.trim(),
      doi: detailsDraft.doi.trim(),
      url: detailsDraft.url.trim(),
      abstract: detailsDraft.abstract.trim(),
    });
    onPaperUpdated();
    setStatus("Paper details saved.");
  }

  async function attachPdf(file: File) {
    setPdfBusy(true);
    setStatus(paper.hasPdf ? "Replacing PDF…" : "Attaching PDF…");
    try {
      const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Choose a PDF file.");
      }
      if (signature !== "%PDF-") throw new Error("That file does not appear to be a valid PDF.");
      await putPdf(paper.id, file);
      let extractedText = "";
      try {
        const result = await metadataFromPdf(file);
        extractedText = result.paper.pdfText || "";
      } catch {
        // The PDF remains usable even when text extraction is unavailable/offline.
      }
      repo.updatePaper(paper.id, { hasPdf: true, pdfText: extractedText || paper.pdfText });
      setBlob(file);
      setBlobState("ready");
      onPaperUpdated();
      setStatus(extractedText
        ? "PDF attached and searchable text extracted."
        : "PDF attached. Text extraction was unavailable; annotations still work.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not attach the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  function saveTags() {
    const tags = tagDraft
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean);
    repo.setPaperTags(paper.id, tags);
    setTagDraft(repo.getPaper(paper.id)?.tags.join(", ") || "");
    onPaperUpdated();
  }

  function toggleCollection(id: string) {
    const next = paper.collectionIds.includes(id)
      ? paper.collectionIds.filter((collectionId) => collectionId !== id)
      : [...paper.collectionIds, id];
    repo.setPaperCollections(paper.id, next);
    onPaperUpdated();
  }

  function updateWorkflow(patch: Partial<Paper>) {
    repo.updatePaper(paper.id, patch);
    onPaperUpdated();
  }

  function toggleQuestion(question: ResearchQuestion) {
    const linkedPaperIds = question.linkedPaperIds.includes(paper.id)
      ? question.linkedPaperIds.filter((id) => id !== paper.id)
      : [...question.linkedPaperIds, paper.id];
    repo.updateQuestion(question.id, { linkedPaperIds });
    onQuestionUpdated();
  }

  function toggleRelated(related: Paper) {
    const isLinked = (paper.relatedPaperIds || []).includes(related.id);
    repo.updatePaper(paper.id, {
      relatedPaperIds: isLinked
        ? (paper.relatedPaperIds || []).filter((id) => id !== related.id)
        : [...(paper.relatedPaperIds || []), related.id],
    });
    repo.updatePaper(related.id, {
      relatedPaperIds: isLinked
        ? (related.relatedPaperIds || []).filter((id) => id !== paper.id)
        : [...(related.relatedPaperIds || []), paper.id],
    });
    onPaperUpdated();
  }

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

  async function exportAnnotatedPdf() {
    if (!blob) return;
    setExportBusy(true);
    setStatus("Creating annotated PDF…");
    try {
      const output = await createAnnotatedPdf(blob, highlights);
      const url = URL.createObjectURL(output);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = annotatedPdfFilename(paper.title);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setStatus(
        `Exported ${highlights.length} highlight${highlights.length === 1 ? "" : "s"} as PDF annotations.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PDF export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  async function copyCitationKey() {
    await navigator.clipboard.writeText(citationKey(paper));
    setStatus(`Copied citation key: ${citationKey(paper)}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 px-3 md:px-4 py-2 border-b border-slate-800 bg-slate-900">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-sm"
        >
          <IconBack /> Library
        </button>
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate font-medium">{paper.title || "Untitled paper"}</div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="truncate">
              {paper.authors.slice(0, 4).join(", ")}
              {paper.year ? ` · ${paper.year}` : ""}
              {paper.venue ? ` · ${paper.venue}` : ""}
            </span>
            <span className="shrink-0 text-slate-800">·</span>
            <span className="max-w-48 shrink-0">
              <ProjectLabel
                collections={collections}
                collectionIds={paper.collectionIds}
                onClick={onFile}
                label={paper.title || "this paper"}
              />
            </span>
          </div>
        </div>
        <select
          value={paper.readingStatus || "inbox"}
          onChange={(event) => updateWorkflow({ readingStatus: event.target.value as Paper["readingStatus"] })}
          className={`lat-status status-${paper.readingStatus || "inbox"} bg-transparent outline-none`}
          title="Reading status"
        >
          <option value="inbox">To read</option>
          <option value="reading">In progress</option>
          <option value="read">Read</option>
        </select>
        <button onClick={() => updateWorkflow({ favorite: !paper.favorite })} className={`rounded-md p-1.5 ${paper.favorite ? "text-amber-300" : "text-slate-600 hover:text-amber-300"}`} aria-label={paper.favorite ? "Remove from favorites" : "Add to favorites"}><IconStar filled={paper.favorite} /></button>
        <button
          onClick={() => setShowAbstract((visible) => !visible)}
          aria-expanded={showAbstract}
          className={`text-sm rounded-md px-3 py-1.5 ${showAbstract ? "bg-slate-700 text-slate-100" : "bg-slate-800 hover:bg-slate-700"}`}
          title={paper.abstract ? "Show the abstract" : "No abstract was captured for this paper"}
        >
          Abstract
        </button>
        <button onClick={() => void copyCitationKey()} className="hidden xl:flex items-center gap-1.5 rounded-md border border-veil/[.07] bg-veil/[.03] px-2.5 py-1.5 font-mono text-[11px] text-slate-500 hover:text-cyan-300" title="Copy citation key">{citationKey(paper)} <IconCopy width={12} /></button>
        <button
          onClick={() => setShowDetails((visible) => !visible)}
          className={`text-sm rounded-md px-3 py-1.5 ${
            showDetails ? "bg-indigo-600 text-white" : "bg-slate-800 hover:bg-slate-700"
          }`}
        >
          Organize
        </button>
        <label className="text-sm bg-slate-800 hover:bg-slate-700 rounded-md px-3 py-1.5 cursor-pointer">
          {pdfBusy ? "Attaching…" : paper.hasPdf ? "Replace PDF" : "Attach PDF"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={pdfBusy}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void attachPdf(file);
              event.target.value = "";
            }}
          />
        </label>
        <button
          onClick={() => onOpenPaperNote(paper.id)}
          className="text-sm flex items-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-md px-3 py-1.5"
        >
          <IconNote /> Notes
        </button>
        {blob && (
          <button
            onClick={exportAnnotatedPdf}
            disabled={exportBusy}
            className="text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-md px-3 py-1.5"
            title="Download the PDF with portable highlight annotations"
          >
            {exportBusy ? "Exporting…" : "Export annotated PDF"}
          </button>
        )}
      </div>

      {/* Where this paper sits in the library: its nearest neighbours, and projects it
          looks like it belongs in. Each shows what it shares, so it can be checked. */}
      {(similar.length > 0 || projectFits.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-800 bg-slate-900/40 px-4 py-2 text-xs">
          {similar.length > 0 && (
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-slate-500">Similar in your library:</span>
              {similar.slice(0, 3).map((item) => (
                <button
                  key={item.paper.id}
                  onClick={() => onOpenPaper?.(item.paper.id)}
                  className="lat-chip max-w-[16rem] truncate !py-0.5"
                  title={`${item.paper.title}\nShares: ${item.shared.join(", ") || "vocabulary"}`}
                >
                  {item.paper.title}
                </button>
              ))}
            </span>
          )}
          {projectFits.map((fit) => (
            <span key={fit.project.id} className="flex items-center gap-1.5">
              <span className="text-slate-500">Looks like it belongs in</span>
              <button
                onClick={() => onAddToProject?.(fit.project.id)}
                className="lat-chip !py-0.5"
                title={`Closest to: ${fit.closest.map((p) => p.title).join("; ")}. Click to file it there.`}
              >
                {fit.project.name} +
              </button>
            </span>
          ))}
        </div>
      )}

      {/* The abstract, on demand: enough to remember what a paper is without
          opening the PDF, and out of the way the rest of the time. */}
      {showAbstract && (
        <div className="border-b border-slate-800 bg-slate-900/70 px-4 py-3">
          <div className="flex items-baseline justify-between">
            <h2 className="lat-kicker">Abstract</h2>
            <button onClick={() => setShowAbstract(false)} className="text-[11px] text-slate-500 hover:text-slate-300">Hide</button>
          </div>
          {paper.abstract ? (
            <p className="lat-scroll mt-2 max-h-[28vh] max-w-3xl overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
              {paper.abstract}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              No abstract was captured for this paper. You can paste one under Organize.
            </p>
          )}
        </div>
      )}

      {showDetails && (
        <div className="border-b border-slate-800 bg-slate-900/70 px-4 py-3 space-y-4 max-h-[46vh] overflow-auto">
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-xs text-slate-400">Item type
              <select value={detailsDraft.itemType} onChange={(event) => setDetailsDraft({ ...detailsDraft, itemType: event.target.value as NonNullable<Paper["itemType"]> })} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-500">{Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
            <label className="text-xs text-slate-400">Title
              <input value={detailsDraft.title} onChange={(event) => setDetailsDraft({ ...detailsDraft, title: event.target.value })} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500" />
            </label>
            <label className="text-xs text-slate-400">Authors <span className="text-slate-600">(one per line)</span>
              <textarea value={detailsDraft.authors} onChange={(event) => setDetailsDraft({ ...detailsDraft, authors: event.target.value })} rows={2} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500 resize-y" />
            </label>
            <label className="text-xs text-slate-400">Year
              <input inputMode="numeric" value={detailsDraft.year} onChange={(event) => setDetailsDraft({ ...detailsDraft, year: event.target.value })} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500" />
            </label>
            <label className="text-xs text-slate-400">Venue
              <input value={detailsDraft.venue} onChange={(event) => setDetailsDraft({ ...detailsDraft, venue: event.target.value })} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500" />
            </label>
            <label className="text-xs text-slate-400">DOI
              <input value={detailsDraft.doi} onChange={(event) => setDetailsDraft({ ...detailsDraft, doi: event.target.value })} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500" />
            </label>
            <label className="text-xs text-slate-400">URL
              <input type="url" value={detailsDraft.url} onChange={(event) => setDetailsDraft({ ...detailsDraft, url: event.target.value })} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500" />
            </label>
          </div>
          <label className="block text-xs text-slate-400">Abstract
            <textarea value={detailsDraft.abstract} onChange={(event) => setDetailsDraft({ ...detailsDraft, abstract: event.target.value })} rows={3} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500 resize-y" />
          </label>
          <button onClick={saveDetails} className="text-sm bg-indigo-600 text-white hover:bg-indigo-500 rounded px-3 py-1.5">Save details</button>
          <div className="grid gap-4 lg:grid-cols-2">
          <label className="text-xs text-slate-400">
            Tags <span className="text-slate-600">(comma separated)</span>
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={saveTags}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="methods, transformers, to-read"
              className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
            />
          </label>
          <fieldset>
            <legend className="text-xs text-slate-400 mb-1">Projects</legend>
            <div className="flex flex-wrap gap-2">
              {collections.map((collection) => (
                <label
                  key={collection.id}
                  className="flex items-center gap-1.5 bg-slate-800 rounded px-2 py-1 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={paper.collectionIds.includes(collection.id)}
                    onChange={() => toggleCollection(collection.id)}
                    className="accent-indigo-500"
                  />
                  {collection.name}
                </label>
              ))}
              {collections.length === 0 && (
                <span className="text-xs text-slate-600">Create a project in the sidebar first.</span>
              )}
            </div>
          </fieldset>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Reading priority
                <select value={paper.priority || "later"} onChange={(event) => updateWorkflow({ priority: event.target.value as Paper["priority"] })} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-500">
                  <option value="later">Later</option>
                  <option value="next">Read next</option>
                  <option value="deep-dive">Deep dive</option>
                </select>
              </label>
              <label className="mt-3 block text-xs text-slate-400">My one-line takeaway
                <textarea value={takeawayDraft} onChange={(event) => setTakeawayDraft(event.target.value)} onBlur={() => updateWorkflow({ takeaway: takeawayDraft.trim() })} placeholder="What should future-you remember?" rows={3} className="mt-1 block w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 resize-y" />
              </label>
            </div>
            <fieldset>
              <legend className="text-xs text-slate-400 mb-1">Related research questions</legend>
              <div className="space-y-1.5 max-h-36 overflow-auto">
                {questions.map((question) => (
                  <label key={question.id} className="flex items-start gap-2 rounded bg-slate-800 px-2.5 py-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={question.linkedPaperIds.includes(paper.id)} onChange={() => toggleQuestion(question)} className="mt-0.5 accent-cyan-400" />
                    <span>{question.title}</span>
                  </label>
                ))}
                {questions.length === 0 && <p className="text-xs text-slate-600">Capture a question from the research desk, then link this paper to it here.</p>}
              </div>
            </fieldset>
          </div>
          <fieldset>
            <legend className="text-xs text-slate-400 mb-1">Related papers <span className="text-slate-600">· appears in the knowledge graph</span></legend>
            <div className="grid max-h-32 gap-1.5 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
              {papers.filter((item) => item.id !== paper.id).map((item) => (
                <label key={item.id} className="flex items-start gap-2 rounded bg-slate-800 px-2.5 py-2 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={(paper.relatedPaperIds || []).includes(item.id)} onChange={() => toggleRelated(item)} className="mt-0.5 accent-cyan-400" />
                  <span className="line-clamp-2">{item.title}</span>
                </label>
              ))}
              {papers.length <= 1 && <p className="text-xs text-slate-600">Add another paper to build an explicit relationship.</p>}
            </div>
          </fieldset>
        </div>
      )}

      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
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
                      activeColor === c ? "border-slate-100" : "border-transparent"
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
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 gap-3 p-8">
              <p className="max-w-sm">
                {fetchingPdf
                  ? "Looking for an open-access copy of this paper…"
                  : "No PDF is stored for this paper yet — it was added as metadata only, and annotating needs the file itself."}
              </p>
              {canFetchPdf(paper) && (
                <button
                  onClick={onFetchPdf}
                  disabled={fetchingPdf}
                  className="lat-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {fetchingPdf ? "Searching…" : "Find the PDF for me"}
                </button>
              )}
              <p className="max-w-sm text-xs leading-5">
                {canFetchPdf(paper)
                  ? "Checks arXiv, Unpaywall, OpenAlex, and the publisher's own link. Behind a paywall, attach your own copy with Attach PDF above."
                  : "Add a DOI or arXiv id under Organize and lattice can try to find the file itself. Otherwise use Attach PDF above."}
              </p>
              <p className="text-xs">
                You can write linked notes for it either way, from the Notes button.
              </p>
            </div>
          )}
        </div>

        {/* Highlights sidebar */}
        <aside className="w-full lg:w-80 max-h-[42vh] lg:max-h-none shrink-0 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <h3 className="font-medium text-sm">
              Highlights ({highlights.length})
            </h3>
            <button
              onClick={synthesize}
              disabled={aiBusy || highlights.length === 0}
              className="text-xs flex items-center gap-1 bg-indigo-600/80 text-white hover:bg-indigo-600 disabled:opacity-40 rounded px-2 py-1"
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
                                h.color === c ? "border-slate-100" : "border-transparent"
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

function metadataDraft(paper: Paper) {
  return {
    itemType: paper.itemType || "journalArticle" as NonNullable<Paper["itemType"]>,
    title: paper.title,
    authors: paper.authors.join("\n"),
    year: paper.year?.toString() || "",
    venue: paper.venue,
    doi: paper.doi,
    url: paper.url || "",
    abstract: paper.abstract,
  };
}
