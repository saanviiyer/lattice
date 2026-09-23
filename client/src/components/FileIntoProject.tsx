// The quick-file dialog: double-click a paper or a note, choose its projects.
//
// A centred dialog rather than a popover anchored to the row, for one practical
// reason: the surfaces this is opened from — the library table, the sidebar, a
// project page — are all scroll containers, and an anchored panel would be clipped
// by whichever one it was opened in.
//
// It can also create a project on the spot. Filing something into a project that
// does not exist yet is the common case when an idea is still forming: the paper
// you just read is the reason the project should exist at all.

import { useEffect, useRef, useState } from "react";
import type { Collection } from "../types";
import { buildCollectionTree, flattenCollectionTree } from "../lib/collectionTree";
import { labelSwatches } from "../lib/labelColor";
import { IconCheck, IconFolder, IconPlus } from "./Icons";
import { useModalFocus } from "./useModalFocus";

export interface FilingTarget {
  kind: "paper" | "note";
  id: string;
  title: string;
  collectionIds: string[];
}

interface Props {
  target: FilingTarget;
  collections: Collection[];
  onChange: (collectionIds: string[]) => void;
  /** Create a project and return its id, so the dialog can file into it at once. */
  onCreateProject: (name: string, parentId: string | null) => string;
  onClose: () => void;
}

export default function FileIntoProject({
  target,
  collections,
  onChange,
  onCreateProject,
  onClose,
}: Props) {
  const [draft, setDraft] = useState("");
  const [showNew, setShowNew] = useState(collections.length === 0);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useModalFocus(panelRef);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The dialog is opened by a gesture, so focus has to be moved into it explicitly
  // for anyone not using a mouse to carry on from where they were.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const selected = new Set(target.collectionIds);
  const rows = flattenCollectionTree(buildCollectionTree(collections));

  function toggle(id: string) {
    onChange(
      selected.has(id)
        ? target.collectionIds.filter((item) => item !== id)
        : [...target.collectionIds, id]
    );
  }

  function createAndFile() {
    const name = draft.trim();
    if (!name) return;
    const id = onCreateProject(name, null);
    onChange([...target.collectionIds, id]);
    setDraft("");
    setShowNew(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-24 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`File ${target.title} into a project`}
    >
      <div ref={panelRef} className="lat-panel w-full max-w-md p-4 shadow-2xl">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-slate-500">
            <IconFolder width={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-slate-100">File into a project</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500" title={target.title}>
              {target.kind === "paper" ? "Paper" : "Note"} · {target.title || "Untitled"}
            </p>
          </div>
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-200">
            Done
          </button>
        </div>

        {rows.length > 0 && (
          <ul className="lat-scroll mt-3 max-h-72 overflow-y-auto border-t border-veil/5 pt-2">
            {rows.map(({ collection, depth }, index) => (
              <li key={collection.id}>
                <label
                  className="flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-2 text-sm text-slate-300 hover:bg-veil/[.05]"
                  style={{ paddingLeft: 8 + depth * 16 }}
                >
                  <input
                    ref={index === 0 ? firstFieldRef : undefined}
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

        <div className="mt-3 border-t border-veil/5 pt-3">
          {showNew ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                createAndFile();
              }}
              className="flex gap-2"
            >
              <input
                autoFocus={rows.length > 0}
                ref={rows.length === 0 ? firstFieldRef : undefined}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setShowNew(collections.length === 0);
                    setDraft("");
                  }
                }}
                placeholder="New project name"
                aria-label="Name of the new project"
                className="lat-input min-w-0 flex-1 px-3 py-1.5 text-sm"
              />
              <button disabled={!draft.trim()} className="lat-primary px-3 py-1.5 text-sm disabled:opacity-40">
                <IconCheck width={13} /> File
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-300"
            >
              <IconPlus width={12} /> New project for this
            </button>
          )}
          {rows.length === 0 && !showNew && (
            <p className="mt-2 text-xs text-slate-600">No projects yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
