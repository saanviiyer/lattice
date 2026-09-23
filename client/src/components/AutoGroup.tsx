// Proposing collections from what the papers are about.
//
// The point of this screen is that it proposes and does not act. Every group is
// shown with its size, the terms that produced it, and a few of the papers that
// landed in it, and nothing is created until specific groups are ticked. An
// automatic filing you cannot inspect is worse than no filing, because you end up
// distrusting the whole library.

import { useMemo, useRef, useState } from "react";
import type { Paper } from "../types";
import { proposeSubjectGroups, type SubjectGroup } from "../lib/subjectGroups";
import { useModalFocus } from "./useModalFocus";
import { IconCheck, IconSparkle } from "./Icons";

interface Props {
  papers: Paper[];
  /** Existing project names, so a proposal that duplicates one can say so. */
  existingNames: string[];
  onCreate: (groups: SubjectGroup[]) => void;
  onClose: () => void;
}

type Granularity = "broad" | "balanced" | "fine";

// Coarser groups mean fewer, larger themes; finer means more, tighter ones.
const GRANULARITY: Record<Granularity, { threshold: number; maxGroups: number; maxGroupSize: number }> = {
  broad: { threshold: 0.11, maxGroups: 10, maxGroupSize: 90 },
  balanced: { threshold: 0.15, maxGroups: 20, maxGroupSize: 45 },
  fine: { threshold: 0.22, maxGroups: 32, maxGroupSize: 25 },
};

export default function AutoGroup({ papers, existingNames, onCreate, onClose }: Props) {
  const [granularity, setGranularity] = useState<Granularity>("balanced");
  const [unfiledOnly, setUnfiledOnly] = useState(true);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef);

  const source = useMemo(
    () => (unfiledOnly ? papers.filter((paper) => paper.collectionIds.length === 0) : papers),
    [papers, unfiledOnly]
  );

  const proposal = useMemo(
    () =>
      proposeSubjectGroups(
        source.map((paper) => ({
          id: paper.id,
          title: paper.title || "",
          tags: paper.tags,
          abstract: paper.abstract || "",
        })),
        GRANULARITY[granularity]
      ),
    [source, granularity]
  );

  // Everything is selected by default; unticking is the deliberate act.
  const selected = chosen ?? new Set(proposal.groups.map((group) => group.id));
  const byId = new Map(papers.map((paper) => [paper.id, paper]));
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  }

  const picked = proposal.groups.filter((group) => selected.has(group.id));
  const paperCount = picked.reduce((total, group) => total + group.documentIds.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-12 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Group papers into projects automatically"
    >
      <div ref={panelRef} className="lat-panel flex max-h-[86vh] w-full max-w-2xl flex-col p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-medium text-slate-100">
              <IconSparkle width={15} /> Group papers by theme
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Themes read off the titles, tags, and abstracts of {source.length} paper
              {source.length === 1 ? "" : "s"}. Nothing is created until you choose.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-slate-500 hover:text-slate-200">
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-veil/5 py-3">
          <div className="flex rounded-lg border border-veil/[.07] bg-well/20 p-0.5 text-xs">
            {(["broad", "balanced", "fine"] as const).map((option) => (
              <button
                key={option}
                onClick={() => {
                  setGranularity(option);
                  setChosen(null);
                }}
                className={`rounded-md px-2.5 py-1 capitalize ${
                  granularity === option ? "bg-veil/10 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={unfiledOnly}
              onChange={(event) => {
                setUnfiledOnly(event.target.checked);
                setChosen(null);
              }}
              className="accent-cyan-400"
            />
            Only papers not already in a project
          </label>
        </div>

        <div className="lat-scroll mt-3 min-h-0 flex-1 overflow-y-auto">
          {proposal.groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-veil/[.08] px-4 py-8 text-center text-xs leading-5 text-slate-600">
              {source.length < 3
                ? "Not enough papers here to find a theme. Add a few more, or untick the filter above."
                : "These papers have too little in common to group. Try a broader setting."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {proposal.groups.map((group) => {
                const clash = taken.has(group.label.toLowerCase());
                return (
                  <li key={group.id}>
                    <label
                      className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                        selected.has(group.id)
                          ? "border-cyan-400/25 bg-cyan-400/[.04]"
                          : "border-veil/[.07] bg-well/20"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(group.id)}
                        onChange={() => toggle(group.id)}
                        className="mt-0.5 accent-cyan-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-medium text-slate-100">{group.label}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
                            {group.documentIds.length} papers
                          </span>
                          {clash && (
                            <span className="shrink-0 text-[11px] text-amber-400/80">name already used</span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] leading-4 text-slate-600">
                          Grouped on: {group.terms.slice(0, 5).join(", ")}
                        </p>
                        <p className="mt-1 truncate text-[11px] leading-4 text-slate-500">
                          {group.documentIds
                            .slice(0, 3)
                            .map((id) => byId.get(id)?.title || "Untitled")
                            .join(" · ")}
                          {group.documentIds.length > 3 ? " · …" : ""}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {proposal.ungroupedIds.length > 0 && (
            <p className="mt-3 px-1 text-[11px] leading-4 text-slate-600">
              {proposal.ungroupedIds.length} paper{proposal.ungroupedIds.length === 1 ? "" : "s"} had
              too little in common with the rest to place. They stay where they are.
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-veil/5 pt-4">
          <span className="mr-auto text-xs text-slate-600">
            {picked.length
              ? `${picked.length} project${picked.length === 1 ? "" : "s"}, ${paperCount} papers`
              : "Nothing selected"}
          </span>
          <button onClick={onClose} className="lat-secondary px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={() => onCreate(picked)}
            disabled={picked.length === 0}
            className="lat-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            <IconCheck width={13} /> Create {picked.length || ""} project{picked.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
