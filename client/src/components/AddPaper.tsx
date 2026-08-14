// Import a paper by DOI, arXiv id/URL, or PDF upload. On success the paper metadata is
// saved via the repository; an uploaded PDF's bytes are stored in IndexedDB.

import { useState } from "react";
import type { PaperMetadata } from "../types";
import { metadataByArxiv, metadataByDoi, metadataFromPdf } from "../lib/api";

interface Props {
  onAdd: (meta: PaperMetadata, opts: { pdfBlob?: Blob }) => void;
  onClose: () => void;
}

type Mode = "doi" | "arxiv" | "pdf";

export default function AddPaper({ onAdd, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("doi");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitText() {
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { paper } =
        mode === "doi"
          ? await metadataByDoi(value.trim())
          : await metadataByArxiv(value.trim());
      onAdd(paper, {});
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-start justify-center pt-24">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-2xl">
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
          {(["doi", "arxiv", "pdf"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className={`flex-1 rounded-md py-1.5 capitalize ${
                mode === m ? "bg-indigo-600 text-white" : "text-slate-300"
              }`}
            >
              {m === "doi" ? "DOI" : m === "arxiv" ? "arXiv" : "PDF upload"}
            </button>
          ))}
        </div>

        {mode === "pdf" ? (
          <label className="block border-2 border-dashed border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-500">
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
          <div className="flex gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitText()}
              placeholder={
                mode === "doi"
                  ? "10.1038/nature14539"
                  : "2401.01234 or an arxiv.org/abs URL"
              }
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={submitText}
              disabled={busy || !value.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg px-4 text-sm font-medium"
            >
              {busy ? "…" : "Add"}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
