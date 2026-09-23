// The share sheet: turn one project into a file you can send someone.
//
// The two choices here are the ones with consequences, so they are stated rather
// than buried. Your notes and takeaways are the most valuable part of a project and
// also the most personal, so sharing them is a decision. PDFs are usually the
// publisher's to distribute, not yours, so including them is off unless you say
// otherwise — and the recipient's own open-access fetch will fill in most of the
// gap legally.

import { useEffect, useRef, useState } from "react";
import type { Collection } from "../types";
import { createProjectShare, projectShareFilename, type ShareOptions } from "../lib/projectShare";
import { saveFileAs } from "../lib/desktop";
import { IconArrowRight, IconCheck } from "./Icons";
import { useModalFocus } from "./useModalFocus";

interface Props {
  project: Collection;
  /** What is in the project, for the summary line. */
  counts: { papers: number; notes: number; questions: number };
  onClose: () => void;
  onShared: (message: string) => void;
}

const SHARED_BY_KEY = "lattice.share.name";

export default function ShareProject({ project, counts, onClose, onShared }: Props) {
  const [sharedBy, setSharedBy] = useState(() => localStorage.getItem(SHARED_BY_KEY) || "");
  const [includeThinking, setIncludeThinking] = useState(true);
  const [includePdfs, setIncludePdfs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function share() {
    setBusy(true);
    setError("");
    try {
      const options: ShareOptions = { sharedBy, includeThinking, includePdfs };
      localStorage.setItem(SHARED_BY_KEY, sharedBy.trim());
      const bundle = await createProjectShare(project, options);
      const saved = await saveFileAs(bundle, projectShareFilename(project.name), [
        { name: "lattice project", extensions: ["latticeproject"] },
      ]);
      if (saved === null) {
        setBusy(false);
        return; // the save panel was cancelled
      }
      onShared(
        `Shared “${project.name}”. Send the file to a colleague and they can import it into their own lattice.`
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the share file.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-20 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Share the project ${project.name}`}
    >
      <div ref={panelRef} className="lat-panel w-full max-w-lg p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-slate-100">Share “{project.name}”</h2>
            <p className="mt-1 text-xs text-slate-500">
              {plural(counts.papers, "paper")} · {plural(counts.notes, "note")} ·{" "}
              {plural(counts.questions, "question")}, plus any subprojects. Saved as one file to
              send however you like.
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-200">
            Close
          </button>
        </div>

        <label className="mt-4 block text-xs text-slate-500">
          Your name <span className="text-slate-700">(optional — shown to whoever imports it)</span>
          <input
            value={sharedBy}
            onChange={(event) => setSharedBy(event.target.value)}
            placeholder="Ada Lovelace"
            className="lat-input mt-1 w-full px-3 py-2 text-sm"
          />
        </label>

        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-veil/[.07] bg-well/20 p-3">
            <input
              type="checkbox"
              checked={includeThinking}
              onChange={(event) => setIncludeThinking(event.target.checked)}
              className="mt-0.5 accent-cyan-400"
            />
            <span className="min-w-0">
              <span className="block text-sm text-slate-200">Include my notes, takeaways, and highlights</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                {includeThinking
                  ? "They get your reading of the papers, not just the list. This is usually the point of sharing a project."
                  : "They get the reading list and the questions only — the papers, with none of your commentary."}
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-veil/[.07] bg-well/20 p-3">
            <input
              type="checkbox"
              checked={includePdfs}
              onChange={(event) => setIncludePdfs(event.target.checked)}
              className="mt-0.5 accent-cyan-400"
            />
            <span className="min-w-0">
              <span className="block text-sm text-slate-200">Include the PDF files</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                Makes a much larger file, and most publisher PDFs are not yours to redistribute.
                Left off, lattice will fetch the open-access ones on their machine instead.
              </span>
            </span>
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="lat-secondary px-3 py-2 text-sm">
            Cancel
          </button>
          <button onClick={share} disabled={busy} className="lat-primary px-4 py-2 text-sm disabled:opacity-50">
            {busy ? "Preparing…" : <>Save the share file <IconArrowRight width={13} /></>}
          </button>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-slate-600">
          <span className="mt-0.5 text-slate-700"><IconCheck width={11} /></span>
          Importing merges into their library. Papers they already have are matched, not duplicated,
          and nothing of theirs is overwritten.
        </p>
      </div>
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
