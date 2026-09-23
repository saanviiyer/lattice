// The research brain: what lattice has worked out about the researcher's interests,
// what they have told it directly, papers from outside the library that fit, and the
// proposals they are building. Every inference on this page shows its evidence.

import { useMemo, useState } from "react";
import type { Collection, Paper } from "../types";
import { suggestPapers, type SuggestResult, type SuggestedPaper } from "../lib/api";
import { normalizeDoi } from "../lib/duplicates";
import {
  forYouSeeds,
  interestFit,
  suggestionKey,
  type BrainPrefs,
  type InterestProfile,
  type InterestTopic,
} from "../lib/researchBrain";
import type { ResearchPlan } from "../lib/researchPlan";
import { IconArrowRight, IconBrain, IconPlus, IconSparkle } from "./Icons";

interface Props {
  profile: InterestProfile;
  prefs: BrainPrefs;
  papers: Paper[];
  collections: Collection[];
  plans: ResearchPlan[];
  onUpdatePrefs: (patch: Partial<BrainPrefs>) => void;
  onOpenPaper: (id: string) => void;
  onOpenPlan: (id: string) => void;
  onDraftPlan: (projectId: string) => void;
  onSaveSuggestion: (suggestion: SuggestedPaper) => Promise<void>;
}

const KIND_LABEL: Record<InterestTopic["kind"], string> = {
  method: "method",
  domain: "subject",
  theme: "theme",
  stated: "you said",
};

const WHY_EMPTY: Record<NonNullable<SuggestResult["reason"]>, string> = {
  "no-identifiers": "None of your most-used papers has a DOI or arXiv id to look up.",
  "not-enough-seeds": "This needs at least three papers with a DOI or arXiv id that you've worked with.",
  "no-citation-data": "Your papers are indexed, but their reference lists aren't yet. That's normal for recent preprints.",
  "no-overlap": "Nothing is cited by more than one of your papers yet.",
  "no-candidates": "Everything they point to is already in your library.",
};

// Kept for the session, so coming back to the page is not a new search.
let lastForYou: { result: SuggestResult; at: number } | null = null;

interface Ranked extends SuggestedPaper {
  matches: string[];
  rank: number;
}

export function ResearchBrain({
  profile, prefs, papers, collections, plans, onUpdatePrefs, onOpenPaper, onOpenPlan, onDraftPlan, onSaveSuggestion,
}: Props) {
  const byId = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);
  const [statement, setStatement] = useState("");
  const [forYou, setForYou] = useState(lastForYou);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [draftFor, setDraftFor] = useState("");

  const dismissed = useMemo(() => new Set(prefs.dismissed.map((item) => item.key)), [prefs.dismissed]);

  const ranked: Ranked[] = useMemo(() => {
    if (!forYou) return [];
    return forYou.result.suggestions
      .filter((item) => !dismissed.has(suggestionKey(item)))
      .map((item) => {
        const fit = interestFit(item, profile);
        // Citation overlap is the evidence; fit with stated and inferred interests
        // decides between papers that have the same amount of it.
        return { ...item, matches: fit.matches, rank: item.seedCount + fit.score * 2 - (fit.muted.length ? 2 : 0) };
      })
      .sort((a, b) => b.rank - a.rank);
  }, [forYou, profile, dismissed]);

  async function findPapers() {
    setSearching(true);
    setSearchError("");
    try {
      const seeds = forYouSeeds(profile, 30);
      if (!seeds.length) {
        // Nothing to look up; say why here rather than sending an empty request.
        lastForYou = { result: { suggestions: [], seedsUsed: 0, reason: "no-identifiers" }, at: Date.now() };
        setForYou(lastForYou);
        return;
      }
      const owned = papers.map((paper) => normalizeDoi(paper.doi || "")).filter(Boolean);
      const result = await suggestPapers({
        seeds,
        exclude: [...owned, ...prefs.dismissed.map((item) => item.key).filter((key) => !key.startsWith("title:"))],
        limit: 12,
      });
      lastForYou = { result, at: Date.now() };
      setForYou(lastForYou);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Couldn't reach the citation index.");
    } finally {
      setSearching(false);
    }
  }

  function addStatement() {
    const text = statement.trim();
    if (!text) return;
    onUpdatePrefs({ interests: [...prefs.interests, text] });
    setStatement("");
  }

  const projectsWithPapers = collections.filter((collection) => papers.some((paper) => paper.collectionIds.includes(collection.id)));

  if (!papers.length && !prefs.interests.length) {
    return (
      <div className="h-full overflow-auto bg-lattice-canvas">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <p className="lat-kicker">Research brain</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-100">Nothing to go on yet</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            This page works out what you're interested in from what you read, highlight and file. Add a few papers, or
            tell it directly.
          </p>
          <StatementInput value={statement} onChange={setStatement} onAdd={addStatement} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-lattice-canvas">
      <div className="mx-auto max-w-6xl px-5 py-7 lg:px-9 lg:py-9">
        <header>
          <p className="lat-kicker">Research brain</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-100">What you're working on</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Worked out from what you read, highlight, note and file, with recent work counting most. Each interest lists
            the papers behind it.
          </p>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="lat-panel">
            <div className="lat-panel-header">
              <h2 className="text-sm font-medium text-slate-200">Interests</h2>
              <span className="text-xs text-slate-600">{profile.topics.length} found</span>
            </div>
            <ul className="divide-y divide-veil/5">
              {profile.topics.map((topic) => (
                <li key={topic.key} className="group px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{topic.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-600">{KIND_LABEL[topic.kind]}</span>
                    {topic.trend !== "steady" && (
                      <span className={`lat-status ${topic.trend === "rising" ? "status-read" : "status-inbox"}`}>{topic.trend}</span>
                    )}
                    <button
                      onClick={() =>
                        topic.kind === "stated"
                          ? onUpdatePrefs({ interests: prefs.interests.filter((item) => item !== topic.label) })
                          : onUpdatePrefs({ muted: [...prefs.muted, topic.key] })
                      }
                      className="text-xs text-slate-600 opacity-0 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100"
                      title={topic.kind === "stated" ? "Remove" : "Mute: leave this out of the profile and suggestions"}
                    >
                      {topic.kind === "stated" ? "Remove" : "Mute"}
                    </button>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-veil/[.06]">
                    <div className="h-full rounded-full bg-cyan-400/70" style={{ width: `${Math.max(4, topic.score * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {topic.paperIds.length ? (
                      <>
                        {topic.paperIds.slice(0, 3).map((id, index) => (
                          <span key={id}>
                            {index > 0 && " · "}
                            <button onClick={() => onOpenPaper(id)} className="hover:text-cyan-300">
                              {shorten(byId.get(id)?.title || "", 60)}
                            </button>
                          </span>
                        ))}
                        {topic.paperIds.length > 3 && ` and ${topic.paperIds.length - 3} more`}
                      </>
                    ) : (
                      "No papers on this yet. Suggestions below will look for some."
                    )}
                  </p>
                </li>
              ))}
              {!profile.topics.length && (
                <li className="px-5 py-6 text-sm text-slate-500">Not enough overlap between papers to name an interest yet.</li>
              )}
            </ul>
            {profile.muted.length > 0 && (
              <div className="border-t border-veil/5 px-5 py-3 text-xs text-slate-600">
                Muted:{" "}
                {profile.muted.map((topic) => (
                  <button
                    key={topic.key}
                    onClick={() => onUpdatePrefs({ muted: prefs.muted.filter((key) => key !== topic.key) })}
                    className="lat-chip ml-1"
                    title="Unmute"
                  >
                    {topic.label} ×
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-6">
            <section className="lat-panel p-5">
              <h2 className="text-sm font-medium text-slate-200">Tell it directly</h2>
              <p className="mt-1 text-xs text-slate-500">Something you want to follow, in your own words. It counts even before you have papers on it.</p>
              <StatementInput value={statement} onChange={setStatement} onAdd={addStatement} />
            </section>

            <section className="lat-panel">
              <div className="lat-panel-header">
                <h2 className="text-sm font-medium text-slate-200">Most worked with</h2>
              </div>
              <ul className="divide-y divide-veil/5">
                {profile.engaged.slice(0, 6).map((entry) => (
                  <li key={entry.paper.id} className="px-5 py-3">
                    <button onClick={() => onOpenPaper(entry.paper.id)} className="text-left text-sm text-slate-200 hover:text-cyan-300">
                      {shorten(entry.paper.title, 90)}
                    </button>
                    <p className="mt-0.5 text-xs text-slate-600">{entry.reasons.length ? entry.reasons.join(", ") : "saved"}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <section className="lat-panel mt-6">
          <div className="lat-panel-header">
            <div>
              <h2 className="text-sm font-medium text-slate-200">Papers you don't have yet</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Cited by several of the papers you've worked with most, then ordered by how well they fit your interests.
              </p>
            </div>
            <button onClick={() => void findPapers()} disabled={searching} className="lat-secondary px-3 py-1.5 text-xs disabled:opacity-50">
              <IconSparkle width={13} /> {searching ? "Looking…" : forYou ? "Look again" : "Find papers"}
            </button>
          </div>
          {searchError && <p className="px-5 py-4 text-sm text-rose-300">{searchError}</p>}
          {forYou && !searchError && (
            ranked.length ? (
              <ul className="divide-y divide-veil/5">
                {ranked.map((item) => {
                  const key = suggestionKey(item);
                  return (
                    <li key={key} className="px-5 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-100">{item.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {[item.authors.slice(0, 3).join(", ") + (item.authors.length > 3 ? " et al." : ""), item.year, item.venue].filter(Boolean).join(" · ")}
                          </p>
                          <p className="mt-2 text-xs leading-5 text-slate-400">
                            Cited by {item.seedCount} of your papers: {item.because.map((title) => shorten(title, 50)).join("; ")}
                          </p>
                          {item.matches.length > 0 && (
                            <p className="mt-1 text-xs text-cyan-300/80">Fits: {item.matches.join(", ")}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={async () => {
                              await onSaveSuggestion(item);
                              setSaved((current) => new Set(current).add(key));
                            }}
                            disabled={saved.has(key)}
                            className="lat-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                          >
                            {saved.has(key) ? "Saved" : <><IconPlus width={13} /> Save</>}
                          </button>
                          <button
                            onClick={() =>
                              onUpdatePrefs({
                                dismissed: [...prefs.dismissed, { key, title: item.title, at: new Date().toISOString() }],
                              })
                            }
                            className="lat-secondary px-3 py-1.5 text-xs"
                            title="Don't suggest this again"
                          >
                            Not for me
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-500">
                {forYou.result.reason ? WHY_EMPTY[forYou.result.reason] : "Nothing new to suggest right now."}
              </p>
            )
          )}
          {!forYou && !searchError && (
            <p className="px-5 py-4 text-sm text-slate-500">
              Looks up the reference lists of your {Math.min(30, forYouSeeds(profile, 30).length)} most-used papers in OpenAlex.
            </p>
          )}
        </section>

        <section className="lat-panel mt-6">
          <div className="lat-panel-header">
            <div>
              <h2 className="text-sm font-medium text-slate-200">Proposals</h2>
              <p className="mt-0.5 text-xs text-slate-600">A proposal for a project, with the work split into tasks agents can run.</p>
            </div>
            <div className="flex gap-2">
              <select value={draftFor} onChange={(event) => setDraftFor(event.target.value)} className="lat-input px-2 py-1.5 text-xs" aria-label="Project to draft a proposal for">
                <option value="">Choose a project…</option>
                {projectsWithPapers.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
              <button onClick={() => draftFor && onDraftPlan(draftFor)} disabled={!draftFor} className="lat-primary px-3 py-1.5 text-xs disabled:opacity-40">
                Draft
              </button>
            </div>
          </div>
          {plans.length ? (
            <ul className="divide-y divide-veil/5">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button onClick={() => onOpenPlan(plan.id)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-veil/[.03]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">{plan.title}</span>
                      <span className="block truncate text-xs text-slate-600">{plan.question || plan.hypothesis || "No question yet"}</span>
                    </span>
                    <span className="text-xs text-slate-600">{plan.tasks.length} tasks</span>
                    <IconArrowRight width={14} className="text-slate-600" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-slate-500">
              No proposals yet. A draft starts from the project's premise, questions and your takeaways.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function StatementInput({ value, onChange, onAdd }: { value: string; onChange: (value: string) => void; onAdd: () => void }) {
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd();
      }}
    >
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. grid cells in virtual reality"
        className="lat-input min-w-0 flex-1 px-3 py-2 text-sm"
        aria-label="An interest, in your own words"
      />
      <button disabled={!value.trim()} className="lat-primary px-3 py-2 text-sm disabled:opacity-40">
        <IconBrain width={14} /> Add
      </button>
    </form>
  );
}

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

