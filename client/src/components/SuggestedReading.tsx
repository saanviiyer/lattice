// "What to read next", on the research desk.
//
// A project's papers cite things. A paper several of them cite, that the library does
// not have, is a gap -- and the count of how many cite it is both the ranking and the
// reason. Every suggestion here can be checked: it names the papers of yours that
// point at it, so a wrong one is visibly wrong rather than quietly wrong.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Collection, Paper } from "../types";
import { suggestPapers, type SuggestResult, type SuggestedPaper } from "../lib/api";
import { collectionPath } from "../lib/collectionTree";
import { normalizeDoi } from "../lib/duplicates";
import { labelSwatches } from "../lib/labelColor";

interface Props {
  papers: Paper[];
  collections: Collection[];
  /** Cached per project for the session, so revisiting the desk is not a new request. */
  cache: Map<string, SuggestResult>;
  onCache: (projectId: string, result: SuggestResult) => void;
  onAdd: (suggestion: SuggestedPaper, projectId: string) => Promise<void>;
  onOpenProject: (id: string) => void;
}

const WHY_EMPTY: Record<NonNullable<SuggestResult["reason"]>, string> = {
  "no-identifiers": "None of these papers have a DOI or arXiv id to look up.",
  "not-enough-seeds":
    "Needs at least three papers with a DOI or arXiv id — below that this is one paper's bibliography, not a pattern.",
  "no-citation-data":
    "These are indexed, but their bibliographies are not. That is normal for recent preprints.",
  "no-overlap": "No paper is cited by more than one of these.",
  "no-candidates": "Nothing here that the library does not already have.",
};

export function SuggestedReading({
  papers, collections, cache, onCache, onAdd, onOpenProject,
}: Props) {
  // Projects worth asking about, best-stocked first: more papers, better suggestions.
  const projects = useMemo(() => {
    return collections
      .map((collection) => {
        const inProject = papers.filter((paper) =>
          (paper.collectionIds || []).includes(collection.id)
        );
        const seeds = inProject.filter((paper) => paper.doi?.trim() || paper.arxivId?.trim());
        return { collection, count: inProject.length, seeds };
      })
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.seeds.length - a.seeds.length || b.count - a.count);
  }, [collections, papers]);

  const [activeId, setActiveId] = useState<string>(() => projects[0]?.collection.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string>("");

  // A project can disappear underneath the selection (deleted, or emptied).
  useEffect(() => {
    if (projects.length && !projects.some((p) => p.collection.id === activeId)) {
      setActiveId(projects[0].collection.id);
    }
  }, [projects, activeId]);

  const active = projects.find((entry) => entry.collection.id === activeId);
  const result = active ? cache.get(active.collection.id) : undefined;

  const run = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const found = await suggestPapers({
        seeds: active.seeds.map((paper) => ({
          doi: paper.doi,
          arxivId: paper.arxivId,
          title: paper.title,
        })),
        // Everything the library holds, so nothing already owned is suggested back.
        exclude: papers.map((paper) => paper.doi).filter((doi): doi is string => !!doi),
        limit: 6,
      });
      onCache(active.collection.id, found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch suggestions.");
    } finally {
      setBusy(false);
    }
  }, [active, papers, onCache]);

  if (!projects.length) return null;

  const owned = new Set(papers.map((paper) => normalizeDoi(paper.doi)).filter(Boolean));

  return (
    <section className="lat-panel">
      <div className="lat-panel-header">
        <div>
          <div className="lat-kicker">What to read next</div>
          <h2 className="mt-1 text-sm font-medium text-slate-100">
            Papers your projects cite but your library does not have
          </h2>
        </div>
        <button
          onClick={run}
          disabled={busy || !active}
          className="lat-secondary shrink-0 px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {busy ? "Looking…" : result ? "Refresh" : "Find papers"}
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {projects.slice(0, 8).map(({ collection, seeds, count }) => {
            const on = collection.id === activeId;
            const dot = collection.color ? labelSwatches()[collection.color].dot : undefined;
            return (
              <button
                key={collection.id}
                onClick={() => setActiveId(collection.id)}
                title={`${collectionPath(collections, collection.id).join(" / ")} — ${seeds.length} of ${count} papers can be looked up`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  on
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                    : "border-veil/[.09] text-slate-400 hover:text-slate-200"
                }`}
              >
                {dot && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                )}
                {collection.name}
                <span className={on ? "text-cyan-300" : "text-slate-600"}>{seeds.length}</span>
              </button>
            );
          })}
        </div>

        {error && <p className="text-xs text-rose-300">{error}</p>}

        {!result && !busy && !error && (
          <p className="text-xs text-slate-500">
            Reads the bibliographies of the {active?.seeds.length ?? 0} papers in{" "}
            <span className="text-slate-400">{active?.collection.name}</span> that have a DOI
            or arXiv id, and ranks what they cite in common.
          </p>
        )}

        {result && !result.suggestions.length && (
          <p className="text-xs text-slate-500">
            {WHY_EMPTY[result.reason || "no-candidates"]}
          </p>
        )}

        {result && result.suggestions.length > 0 && (
          <ul className="space-y-2.5">
            {result.suggestions.map((paper) => {
              const isAdded = added.has(paper.doi) || owned.has(normalizeDoi(paper.doi));
              const isAdding = adding.has(paper.doi);
              const showWhy = expanded === paper.doi;
              return (
                <li
                  key={paper.doi}
                  className="rounded-lg border border-veil/[.07] bg-surface-card p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-slate-100">{paper.title}</h3>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {[
                          paper.authors[0] &&
                            `${paper.authors[0]}${paper.authors.length > 1 ? " et al." : ""}`,
                          paper.year,
                          paper.venue,
                          paper.citedByCount
                            ? `${paper.citedByCount.toLocaleString()} citations`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <button
                        onClick={() => setExpanded(showWhy ? "" : paper.doi)}
                        className="mt-1.5 text-[11px] text-cyan-300 hover:text-cyan-200"
                      >
                        Cited by {paper.seedCount} of your papers{showWhy ? " ▾" : " ▸"}
                      </button>
                      {showWhy && (
                        <ul className="mt-1.5 space-y-0.5 border-l border-veil/10 pl-2.5">
                          {paper.because.map((title) => (
                            <li key={title} className="text-[11px] text-slate-400">
                              {title}
                            </li>
                          ))}
                        </ul>
                      )}
                      {paper.abstract && (
                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                          {paper.abstract}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        disabled={isAdded || isAdding}
                        onClick={async () => {
                          setAdding((set) => new Set(set).add(paper.doi));
                          try {
                            await onAdd(paper, activeId);
                            setAdded((set) => new Set(set).add(paper.doi));
                          } finally {
                            setAdding((set) => {
                              const next = new Set(set);
                              next.delete(paper.doi);
                              return next;
                            });
                          }
                        }}
                        className="lat-primary px-2.5 py-1 text-xs disabled:opacity-40"
                      >
                        {isAdded ? "Added" : isAdding ? "Adding…" : "Add"}
                      </button>
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Open
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {result && result.suggestions.length > 0 && (
          <p className="text-[11px] text-slate-600">
            From the bibliographies of {result.seedsUsed} papers in{" "}
            <button
              onClick={() => onOpenProject(activeId)}
              className="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
            >
              {active?.collection.name}
            </button>
            . Added papers go into that project.
          </p>
        )}
      </div>
    </section>
  );
}
