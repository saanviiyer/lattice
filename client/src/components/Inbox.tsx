// Web clippings Inbox: pulls the queue the browser extension fills, lets the
// user file each clipping into a collection (its own suggested one, an existing
// one, or a new name), imports it into the repository, then acks it server-side.

import { useCallback, useEffect, useState } from "react";
import type { Collection } from "../types";
import { repo } from "../lib/repository";
import {
  ackClipping,
  dismissClipping,
  fetchPendingClippings,
  importClipping,
  type Clipping,
} from "../lib/clippings";

export default function Inbox({
  collections,
  onImported,
}: {
  collections: Collection[];
  onImported: () => void;
}) {
  const [clippings, setClippings] = useState<Clipping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Per-clipping chosen collection name (defaults to the clipping's own).
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await fetchPendingClippings();
      setClippings(items);
      setTargets((prev) => {
        const next = { ...prev };
        for (const c of items) if (next[c.id] === undefined) next[c.id] = c.collection;
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}. Is the lattice server running?`
          : "Could not load clippings."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function doImport(clipping: Clipping) {
    setBusy((b) => ({ ...b, [clipping.id]: true }));
    try {
      importClipping(repo, clipping, targets[clipping.id] ?? clipping.collection);
      await ackClipping(clipping.id);
      setClippings((cs) => cs.filter((c) => c.id !== clipping.id));
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy((b) => ({ ...b, [clipping.id]: false }));
    }
  }

  async function doDismiss(clipping: Clipping) {
    setBusy((b) => ({ ...b, [clipping.id]: true }));
    try {
      await dismissClipping(clipping.id);
      setClippings((cs) => cs.filter((c) => c.id !== clipping.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dismiss failed.");
    } finally {
      setBusy((b) => ({ ...b, [clipping.id]: false }));
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Web clippings</h1>
        <span className="text-xs text-slate-500">
          {clippings.length} waiting to import
        </span>
        <button
          onClick={() => void load()}
          className="ml-auto text-sm bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-slate-500 mt-20" role="status">
            Loading clippings…
          </div>
        ) : clippings.length === 0 ? (
          <div className="text-center text-slate-500 mt-20">
            <p className="mb-2">No web clippings waiting.</p>
            <p className="text-xs text-slate-600">
              Save an article with the lattice browser clipper and it shows up here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3 max-w-3xl">
            {clippings.map((c) => (
              <li
                key={c.id}
                className="border border-slate-800 bg-slate-900 rounded-xl p-4"
              >
                <div className="flex items-start gap-2">
                  <h3 className="font-medium leading-snug flex-1">
                    {c.title || "Untitled clipping"}
                  </h3>
                  <button
                    onClick={() => void doDismiss(c)}
                    disabled={busy[c.id]}
                    className="text-xs text-slate-500 hover:text-rose-400 disabled:opacity-50"
                    title="Dismiss without importing"
                  >
                    Dismiss
                  </button>
                </div>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 break-all"
                >
                  {c.url}
                </a>
                {c.excerpt && (
                  <p className="text-sm text-slate-400 mt-2 line-clamp-4">{c.excerpt}</p>
                )}
                {c.note && (
                  <p className="text-sm text-slate-300 mt-2 border-l-2 border-slate-700 pl-2">
                    <span className="text-[10px] uppercase text-slate-500 mr-1">Note</span>
                    {c.note}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-3">
                  <input
                    list={`collections-${c.id}`}
                    value={targets[c.id] ?? ""}
                    onChange={(e) =>
                      setTargets((t) => ({ ...t, [c.id]: e.target.value }))
                    }
                    placeholder="Collection (optional)"
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm w-56 outline-none focus:border-indigo-500"
                  />
                  <datalist id={`collections-${c.id}`}>
                    {collections.map((col) => (
                      <option key={col.id} value={col.name} />
                    ))}
                  </datalist>
                  <button
                    onClick={() => void doImport(c)}
                    disabled={busy[c.id]}
                    className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-50"
                  >
                    {busy[c.id] ? "Importing…" : "Import"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
