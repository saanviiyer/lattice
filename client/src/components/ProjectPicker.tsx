// File a record into projects.
//
// The same control wherever something can belong to a project: a chip showing
// current membership, opening the project tree as checkboxes. Indented, so filing
// into "Chapter 2" rather than "Thesis" is a visible choice rather than a guess
// from a flat list of similar-sounding names.

import { useEffect, useRef, useState } from "react";
import type { Collection } from "../types";
import { buildCollectionTree, flattenCollectionTree } from "../lib/collectionTree";
import { labelSwatches } from "../lib/labelColor";
import { IconFolder } from "./Icons";

interface Props {
  collections: Collection[];
  selectedIds: string[];
  onChange: (collectionIds: string[]) => void;
  /** What is being filed, for the accessible name. */
  label: string;
}

export default function ProjectPicker({ collections, selectedIds, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = new Set(selectedIds);
  const rows = flattenCollectionTree(buildCollectionTree(collections));
  const chosen = collections.filter((collection) => selected.has(collection.id));

  function toggle(id: string) {
    onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((visible) => !visible)}
        aria-expanded={open}
        aria-label={`Projects for ${label}`}
        className="flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
      >
        <IconFolder width={13} />
        {chosen.length === 0 ? (
          <span className="text-slate-500">No project</span>
        ) : chosen.length === 1 ? (
          <span className="max-w-40 truncate">{chosen[0].name}</span>
        ) : (
          <span>{chosen.length} projects</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-veil/10 bg-surface-raised p-1.5 shadow-2xl shadow-black/50">
          {rows.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] leading-4 text-slate-600">
              No projects yet. Create one in the sidebar, then file this into it.
            </p>
          ) : (
            <ul className="lat-scroll max-h-64 overflow-y-auto">
              {rows.map(({ collection, depth }) => (
                <li key={collection.id}>
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-300 hover:bg-veil/[.05]"
                    style={{ paddingLeft: 8 + depth * 14 }}
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
      )}
    </div>
  );
}
