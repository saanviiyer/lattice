// Import a paper by DOI, arXiv id/URL, or PDF upload. A DOI or arXiv lookup first shows
// what was found - including the abstract behind a toggle - so you can check it is the right
// paper before saving. On confirm the paper metadata is saved via the repository; an uploaded
// PDF's bytes are stored in IndexedDB.

import { useState } from "react";
import type { PaperMetadata } from "../types";
import { ITEM_TYPE_LABELS } from "../types";
import { metadataByArxiv, metadataByDoi, metadataFromPdf } from "../lib/api";
import { parseBibliography, type BibliographyRecord } from "../lib/bibliographyImport";

interface Props {
  onAdd: (meta: PaperMetadata, opts: { pdfBlob?: Blob }) => void;
  onImport: (records: BibliographyRecord[]) => void;
  onClose: () => void;
}

type Mode = "doi" | "arxiv" | "pdf" | "manual" | "import";

export default function AddPaper({ onAdd, onImport, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("doi");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PaperMetadata | null>(null);
  const [showAbstract, setShowAbstract] = useState(false);
  const [manual, setManual] = useState({ itemType: "journalArticle" as NonNullable<PaperMetadata["itemType"]>, title: "", authors: "", year: "", venue: "", doi: "", url: "", abstract: "" });

  async function submitText() {
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setShowAbstract(false);
    try {
      const { paper } =
        mode === "doi"
          ? await metadataByDoi(value.trim())
          : await metadataByArxiv(value.trim());
      setPreview(paper);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  function confirmPreview() {
    if (!preview) return;
    onAdd(preview, {});
    setPreview(null);
    setShowAbstract(false);
    setValue("");
  }

  function discardPreview() {
    setPreview(null);
    setShowAbstract(false);
  }

  async function submitPdf(file: File) {
    setBusy(true);
    setError("");
    try {
      const { paper } = await metadataFromPdf(file);
      onAdd(paper, { pdfBlob: file });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitBibliography(file: File) {
    setBusy(true);
    setError("");
    try {
      const records = parseBibliography(await file.text(), file.name);
      if (!records.length) throw new Error("No valid BibTeX or RIS records were found in that file.");
      onImport(records);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bibliography import failed.");
    } finally {
      setBusy(false);
    }
  }

  function submitManual() {
    if (!manual.title.trim()) {
      setError("A title is required.");
      return;
    }
    const year = manual.year.trim() ? Number(manual.year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 9999)) {
      setError("Enter a four-digit year.");
      return;
    }
    onAdd({
      itemType: manual.itemType,
      title: manual.title.trim(),
      authors: manual.authors.split(/\n|;/).map((author) => author.trim()).filter(Boolean),
      year,
      venue: manual.venue.trim(),
      abstract: manual.abstract.trim(),
      doi: manual.doi.trim(),
      url: manual.url.trim(),
      source: "manual",
    }, {});
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-start justify-center overflow-auto p-4 pt-10 md:pt-20">
      <div className="w-full max-w-xl lat-panel p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add a paper</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-sm"
          >
            Close
          </button>
        </div>

        <div className="flex gap-1 mb-4 bg-slate-800 rounded-lg p-1 text-sm">
          {(["doi", "arxiv", "pdf", "import", "manual"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError("");
                discardPreview();
              }}
              className={`flex-1 rounded-md py-1.5 capitalize ${
                mode === m ? "bg-cyan-400 text-slate-950" : "text-slate-400"
              }`}
            >
              {m === "doi" ? "DOI" : m === "arxiv" ? "arXiv" : m === "pdf" ? "PDF" : m === "import" ? "Bib / RIS" : "Manual"}
            </button>
          ))}
        </div>

        {mode === "import" ? (
          <label className="block rounded-xl border-2 border-dashed border-slate-700 p-8 text-center cursor-pointer hover:border-cyan-400/50">
            <input type="file" accept=".bib,.ris,.txt,application/x-bibtex,application/x-research-info-systems" className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void submitBibliography(file); event.target.value = ""; }} />
            <span className="block text-sm font-medium text-slate-300">{busy ? "Reading bibliography…" : "Choose a BibTeX or RIS file"}</span>
            <span className="mt-2 block text-xs leading-5 text-slate-600">Import hundreds of references at once. Existing DOI, arXiv, and title matches are merged instead of duplicated.</span>
          </label>
        ) : mode === "manual" ? (
          <div className="space-y-3">
            <label className="block text-xs text-slate-500">Item type<select value={manual.itemType} onChange={(event) => setManual({ ...manual, itemType: event.target.value as NonNullable<PaperMetadata["itemType"]> })} className="lat-input mt-1 w-full px-3 py-2 text-sm">{Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-xs text-slate-500">Title *<input autoFocus value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} className="lat-input mt-1 w-full px-3 py-2 text-sm" placeholder="Paper or book title" /></label>
            <label className="block text-xs text-slate-500">Authors <span className="text-slate-700">(one per line or separated by semicolons)</span><textarea value={manual.authors} onChange={(event) => setManual({ ...manual, authors: event.target.value })} rows={2} className="lat-input mt-1 w-full resize-y px-3 py-2 text-sm" placeholder="Ada Lovelace; Alan Turing" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-slate-500">Year<input inputMode="numeric" value={manual.year} onChange={(event) => setManual({ ...manual, year: event.target.value })} className="lat-input mt-1 w-full px-3 py-2 text-sm" /></label>
              <label className="block text-xs text-slate-500">Venue<input value={manual.venue} onChange={(event) => setManual({ ...manual, venue: event.target.value })} className="lat-input mt-1 w-full px-3 py-2 text-sm" placeholder="Journal or conference" /></label>
              <label className="block text-xs text-slate-500">DOI<input value={manual.doi} onChange={(event) => setManual({ ...manual, doi: event.target.value })} className="lat-input mt-1 w-full px-3 py-2 text-sm" /></label>
              <label className="block text-xs text-slate-500">URL<input type="url" value={manual.url} onChange={(event) => setManual({ ...manual, url: event.target.value })} className="lat-input mt-1 w-full px-3 py-2 text-sm" /></label>
            </div>
            <label className="block text-xs text-slate-500">Abstract or summary<textarea value={manual.abstract} onChange={(event) => setManual({ ...manual, abstract: event.target.value })} rows={3} className="lat-input mt-1 w-full resize-y px-3 py-2 text-sm" /></label>
            <div className="flex justify-end"><button onClick={submitManual} disabled={!manual.title.trim()} className="lat-primary px-4 py-2 text-sm disabled:opacity-40">Add to library</button></div>
          </div>
        ) : mode === "pdf" ? (
          <label className="block border-2 border-dashed border-slate-700 rounded-lg p-8 text-center cursor-pointer hover:border-cyan-400/50">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) submitPdf(f);
              }}
            />
            <span className="text-slate-300 text-sm">
              {busy ? "Processing…" : "Click to choose a PDF. Its bytes stay in your browser (IndexedDB)."}
            </span>
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  discardPreview();
                }}
                onKeyDown={(e) => e.key === "Enter" && submitText()}
                placeholder={
                  mode === "doi"
                    ? "10.1038/nature14539"
                    : "2401.01234 or an arxiv.org/abs URL"
                }
                className="lat-input flex-1 px-3 py-2 text-sm"
              />
              <button
                onClick={submitText}
                disabled={busy || !value.trim()}
                className="lat-primary px-4 text-sm disabled:opacity-50"
              >
                {busy ? "…" : preview ? "Look up again" : "Look up"}
              </button>
            </div>

            {preview && (
              <div className="rounded-xl border border-veil/[.08] bg-well/20 p-4">
                <p className="text-sm font-medium leading-5 text-slate-100">{preview.title || "Untitled paper"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {[preview.authors.join(", "), preview.venue, preview.year ?? ""].filter(Boolean).join(" · ") || "No publication details"}
                </p>
                {preview.doi && <p className="mt-1 text-xs text-slate-600">{preview.doi}</p>}

                <div className="mt-3 border-t border-veil/[.06] pt-3">
                  {preview.abstract ? (
                    <>
                      <button
                        onClick={() => setShowAbstract((open) => !open)}
                        aria-expanded={showAbstract}
                        className="flex w-full items-center justify-between text-xs font-medium text-cyan-300 hover:text-cyan-200"
                      >
                        <span>Abstract</span>
                        <span aria-hidden="true">{showAbstract ? "Hide" : "Show"}</span>
                      </button>
                      {showAbstract && (
                        <p className="lat-scroll mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-400">
                          {preview.abstract}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-600">No abstract was returned for this record.</p>
                  )}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={discardPreview} className="lat-secondary px-3 py-1.5 text-sm">
                    Discard
                  </button>
                  <button onClick={confirmPreview} className="lat-primary px-4 py-1.5 text-sm">
                    Add to library
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
