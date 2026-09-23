// What the researcher is into, worked out from what they actually do.
//
// Saving a paper is a weak signal: libraries fill up with things people meant to
// read. Highlighting it, writing a takeaway, attaching it to a question, opening it
// again last week are strong ones. So every paper gets an engagement weight built
// from those actions, fading with time, and interests are the topics that weight
// piles up on.
//
// Everything carries its evidence. An interest is shown with the papers that put it
// there, and each paper with the actions that counted, so the profile can be checked
// and argued with. The researcher can also say what they care about in their own
// words, and mute what they don't: those override anything inferred.

import type { Collection, Highlight, Note, Paper, ResearchQuestion } from "../types";
import { FIELDS } from "./fieldLexicon";
import { AMBIGUOUS, isAbout, paperText } from "./researchProposals";
import { tokenize } from "./subjectGroups";

export interface DismissedSuggestion {
  /** DOI when there is one, otherwise the normalised title. */
  key: string;
  title: string;
  at: string;
}

/** What the researcher has told lattice directly. */
export interface BrainPrefs {
  /** In their own words: "place cells in virtual reality", "protein design with LMs". */
  interests: string[];
  /** Topic keys to leave out of the profile and the suggestions. */
  muted: string[];
  /** Suggestions they said no to. Never shown again. */
  dismissed: DismissedSuggestion[];
}

export const EMPTY_BRAIN: BrainPrefs = { interests: [], muted: [], dismissed: [] };

export function normalizeBrain(raw: unknown): BrainPrefs {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<BrainPrefs>;
  const strings = (list: unknown) =>
    Array.isArray(list)
      ? [...new Set(list.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()))]
      : [];
  return {
    interests: strings(value.interests),
    muted: strings(value.muted),
    dismissed: Array.isArray(value.dismissed)
      ? value.dismissed.filter(
          (item): item is DismissedSuggestion =>
            !!item && typeof item.key === "string" && typeof item.title === "string"
        )
      : [],
  };
}

export interface Engagement {
  paper: Paper;
  weight: number;
  /** The actions that counted, as a reader would say them. */
  reasons: string[];
  lastActive: string;
}

export type TopicKind = "method" | "domain" | "theme" | "stated";
export type Trend = "rising" | "steady" | "fading";

export interface InterestTopic {
  key: string;
  label: string;
  kind: TopicKind;
  /** 0..1, relative to the strongest topic. */
  score: number;
  /** Fraction of all engagement that lands on this topic's papers. */
  share: number;
  trend: Trend;
  /** Evidence, most engaged first. */
  paperIds: string[];
}

export interface InterestProfile {
  topics: InterestTopic[];
  muted: InterestTopic[];
  engaged: Engagement[];
  totalWeight: number;
}

// Words every field uses about its own work. Fine inside a phrase, meaningless as an
// interest on their own.
export const GENERIC_WORDS = new Set(`control controls effect effects evidence response responses
activity change changes role level levels performance process processes system systems
factor factors impact impacts measure measures measurement condition conditions task tasks
result finding findings difference differences increase decrease signal signals behavior
behaviour dynamics mechanism mechanisms framework property properties problem problems`.split(/\s+/).filter(Boolean));

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 90;
const RECENT_DAYS = 45;
const STALE_DAYS = 150;

function daysSince(iso: string | undefined, now: number): number {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(time) ? Math.max(0, (now - time) / DAY) : Infinity;
}

function latest(...dates: (string | undefined)[]): string {
  return dates.filter((date): date is string => !!date && Number.isFinite(Date.parse(date))).sort().pop() || "";
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export interface BrainInputs {
  papers: Paper[];
  highlights: Highlight[];
  notes: Note[];
  questions: ResearchQuestion[];
  collections: Collection[];
  prefs?: BrainPrefs;
  now?: number;
}

/** How much each paper has actually been worked with, strongest first. */
export function paperEngagement(inputs: BrainInputs): Engagement[] {
  const now = inputs.now ?? Date.now();
  const highlightsBy = groupBy(inputs.highlights, (highlight) => highlight.paperId);
  const noteBy = new Map(inputs.notes.filter((note) => note.paperId).map((note) => [note.paperId!, note]));
  const activeProjects = new Set(
    inputs.collections.filter((c) => c.status === "active" || c.status === "writing").map((c) => c.id)
  );
  const questionsBy = new Map<string, number>();
  for (const question of inputs.questions) {
    if (question.status === "resolved") continue;
    for (const id of question.linkedPaperIds) questionsBy.set(id, (questionsBy.get(id) || 0) + 1);
  }

  return inputs.papers
    .map((paper) => {
      let weight = 1;
      const reasons: string[] = [];
      const add = (amount: number, reason: string) => {
        weight += amount;
        reasons.push(reason);
      };
      if (paper.readingStatus === "read") add(1.5, "read");
      else if (paper.readingStatus === "reading") add(1, "reading now");
      if (paper.favorite) add(2, "favourite");
      if (paper.priority === "deep-dive") add(1, "marked for a deep dive");
      if (paper.takeaway?.trim()) add(2, "wrote a takeaway");
      const highlights = highlightsBy.get(paper.id) || [];
      if (highlights.length) {
        add(Math.min(3, 0.75 * highlights.length), `${highlights.length} highlight${highlights.length === 1 ? "" : "s"}`);
      }
      const note = noteBy.get(paper.id);
      if (note?.body.trim()) add(1.5, "notes");
      const asked = questionsBy.get(paper.id) || 0;
      if (asked) add(Math.min(3, 1.5 * asked), `evidence for ${asked} open question${asked === 1 ? "" : "s"}`);
      if (paper.collectionIds.some((id) => activeProjects.has(id))) add(1, "in an active project");

      const lastActive = latest(
        paper.addedAt,
        paper.lastOpenedAt,
        note?.updatedAt,
        ...highlights.map((highlight) => highlight.createdAt)
      );
      // Old work still says something about a person, so it fades to a floor rather
      // than to nothing.
      const age = daysSince(lastActive, now);
      const recency = 0.35 + 0.65 * Math.pow(0.5, (Number.isFinite(age) ? age : 365) / HALF_LIFE_DAYS);
      return { paper, weight: weight * recency, reasons, lastActive };
    })
    .sort((a, b) => b.weight - a.weight);
}

/** Text a paper is matched on: what it says, and what the reader said about it. */
function engagedText(paper: Paper, highlights: Highlight[]): string {
  const marked = highlights
    .map((highlight) => `${highlight.text} ${highlight.note || ""}`)
    .join(" ")
    .slice(0, 2000);
  return `${paperText(paper)} ${paper.takeaway || ""} ${marked}`.toLowerCase();
}

function stems(text: string): Set<string> {
  return new Set(tokenize(text).terms.filter((term) => !term.includes(" ")));
}

/** Whether text is about something the researcher described in their own words. */
export function matchesStatement(text: string, statement: string): boolean {
  const wanted = [...stems(statement)];
  if (!wanted.length) return false;
  const have = stems(text);
  const hits = wanted.filter((term) => have.has(term)).length;
  return hits >= Math.min(2, wanted.length);
}

export function topicKey(kind: TopicKind, label: string): string {
  return `${kind === "method" || kind === "domain" ? "field" : kind}:${label.toLowerCase()}`;
}

function total(entries: Engagement[]): number {
  return entries.reduce((sum, entry) => sum + entry.weight, 0);
}

export function buildInterestProfile(inputs: BrainInputs): InterestProfile {
  const now = inputs.now ?? Date.now();
  const prefs = inputs.prefs || EMPTY_BRAIN;
  const engaged = paperEngagement(inputs);
  const totalWeight = total(engaged);
  const recentWeight = total(engaged.filter((entry) => daysSince(entry.lastActive, now) <= RECENT_DAYS));

  const highlightsBy = groupBy(inputs.highlights, (highlight) => highlight.paperId);
  const texts = new Map(
    engaged.map((entry) => [entry.paper.id, engagedText(entry.paper, highlightsBy.get(entry.paper.id) || [])])
  );
  const textOf = (entry: Engagement) => texts.get(entry.paper.id) || "";

  const candidates: { key: string; label: string; kind: TopicKind; members: Engagement[] }[] = [];

  // Named fields, from the shared vocabulary.
  for (const field of FIELDS) {
    const members = engaged.filter((entry) => isAbout(textOf(entry), field));
    if (members.length >= 2) {
      candidates.push({ key: topicKey(field.kind, field.name), label: field.name, kind: field.kind, members });
    }
  }

  // Phrases the reader's papers keep using, for interests no vocabulary names. A phrase
  // counts across abstracts too, but it has to appear somewhere a person chose the
  // words (a title, a tag, a takeaway), or abstract boilerplate like "recent work"
  // would qualify. Single words are allowed on a stricter footing: chosen words in at
  // least two papers, specific enough to mean something, and not in most of the
  // library, where they would describe everything and so nothing.
  const phraseMembers = new Map<string, Set<string>>();
  const named = new Set<string>();
  const surface = new Map<string, string>();
  const collect = (paperId: string, text: string, chosen: boolean) => {
    const tokens = tokenize(text);
    for (const [term, word] of tokens.surface) if (!surface.has(term)) surface.set(term, word);
    for (const term of new Set(tokens.terms)) {
      const ids = phraseMembers.get(term) || new Set<string>();
      ids.add(paperId);
      phraseMembers.set(term, ids);
      if (chosen) named.add(term);
    }
  };
  for (const entry of engaged) {
    const paper = entry.paper;
    collect(paper.id, `${paper.title || ""}. ${paper.tags.join(". ")}. ${paper.takeaway || ""}`, true);
    collect(paper.id, (paper.abstract || "").slice(0, 1200), false);
  }
  const byId = new Map(engaged.map((entry) => [entry.paper.id, entry]));
  const fieldNames = candidates.map((candidate) => candidate.label.toLowerCase());
  // Which chosen words each paper used, so a single word is only counted where a
  // person wrote it, not where an abstract happened to.
  const namedBy = new Map<string, Set<string>>();
  for (const entry of engaged) {
    const paper = entry.paper;
    for (const term of new Set(tokenize(`${paper.title || ""}. ${paper.tags.join(". ")}. ${paper.takeaway || ""}`).terms)) {
      const ids = namedBy.get(term) || new Set<string>();
      ids.add(paper.id);
      namedBy.set(term, ids);
    }
  }
  const everywhere = Math.max(3, engaged.length * 0.5);
  const phrases = [...phraseMembers.entries()].filter(([term, ids]) => {
    if (!named.has(term) || ids.size < 2) return false;
    if (term.includes(" ")) return true;
    const word = surface.get(term) || term;
    return (namedBy.get(term)?.size || 0) >= 2 && word.length >= 6 && !AMBIGUOUS.has(term) && !AMBIGUOUS.has(word) && !GENERIC_WORDS.has(word) && ids.size <= everywhere;
  });
  const themes = phrases
    .map(([term, ids]) => ({
      term,
      members: [...(term.includes(" ") ? ids : namedBy.get(term)!)].map((id) => byId.get(id)!).filter(Boolean),
    }))
    .filter(({ term }) => !fieldNames.some((name) => name.includes(surface.get(term) || term)))
    // A two-word phrase says more than either word, so it wins a tie.
    .sort((a, b) => total(b.members) * (b.term.includes(" ") ? 1.25 : 1) - total(a.members) * (a.term.includes(" ") ? 1.25 : 1))
    .filter((theme, index, all) =>
      // Drop a word already inside a stronger phrase.
      theme.term.includes(" ") || !all.slice(0, index).some((other) => other.term.split(" ").includes(theme.term))
    )
    .slice(0, 8);
  for (const theme of themes) {
    const label = surface.get(theme.term) || theme.term;
    candidates.push({ key: topicKey("theme", label), label, kind: "theme", members: theme.members });
  }

  // What they said, always shown, even with no papers behind it yet: that is exactly
  // when suggestions help most.
  for (const statement of prefs.interests) {
    const members = engaged.filter((entry) => matchesStatement(textOf(entry), statement));
    candidates.push({ key: topicKey("stated", statement), label: statement, kind: "stated", members });
  }

  const scored = candidates.map((candidate) => {
    const weight = total(candidate.members);
    const share = totalWeight ? weight / totalWeight : 0;
    const recent = total(candidate.members.filter((entry) => daysSince(entry.lastActive, now) <= RECENT_DAYS));
    const recentShare = recentWeight ? recent / recentWeight : 0;
    const freshest = Math.min(...candidate.members.map((entry) => daysSince(entry.lastActive, now)));
    const trend: Trend =
      candidate.members.length && freshest > STALE_DAYS
        ? "fading"
        : recent > 0 && recentShare > share * 1.3
          ? "rising"
          : "steady";
    return {
      key: candidate.key,
      label: candidate.label,
      kind: candidate.kind,
      weight,
      share,
      trend,
      paperIds: candidate.members.map((entry) => entry.paper.id),
    };
  });

  const top = Math.max(0, ...scored.map((topic) => topic.weight));
  const muted = new Set(prefs.muted);
  const topics: InterestTopic[] = scored
    .map(({ weight, ...topic }) => ({
      ...topic,
      // Something the researcher stated counts as at least a middling interest.
      score: Math.max(topic.kind === "stated" ? 0.5 : 0, top ? weight / top : 0),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return {
    topics: topics.filter((topic) => !muted.has(topic.key)).slice(0, 14),
    muted: topics.filter((topic) => muted.has(topic.key)),
    engaged,
    totalWeight,
  };
}

export interface InterestFit {
  /** 0..1. How much of the profile this lands on. */
  score: number;
  /** Labels of the interests it matches, strongest first. */
  matches: string[];
  /** Labels of muted topics it matches. */
  muted: string[];
}

/** How well a piece of text (a suggested paper, say) fits the profile. */
export function interestFit(item: { title?: string; abstract?: string }, profile: InterestProfile): InterestFit {
  const text = `${item.title || ""} ${(item.abstract || "").slice(0, 800)}`.toLowerCase();
  const terms = new Set(tokenize(text).terms);
  const fields = new Map(FIELDS.map((field) => [field.name.toLowerCase(), field]));

  const hits = (topic: InterestTopic) => {
    if (topic.kind === "stated") return matchesStatement(text, topic.label);
    if (topic.kind === "theme") {
      const own = tokenize(topic.label).terms;
      const phrase = own.find((term) => term.includes(" ")) || own[0];
      return !!phrase && terms.has(phrase);
    }
    const field = fields.get(topic.label.toLowerCase());
    return !!field && isAbout(text, field);
  };

  const matched = profile.topics.filter(hits);
  const mutedTopics = profile.muted.filter(hits);
  const score = Math.min(1, matched.reduce((sum, topic) => sum + topic.score, 0) / 1.5);
  return {
    score: mutedTopics.length ? score * 0.25 : score,
    matches: matched.map((topic) => topic.label),
    muted: mutedTopics.map((topic) => topic.label),
  };
}

/** Key a suggestion is remembered by when dismissed. */
export function suggestionKey(item: { doi?: string; title?: string }): string {
  const doi = (item.doi || "").trim().toLowerCase();
  return doi || `title:${(item.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/** The papers to seed library-wide suggestions from: the most worked-with, with an identifier. */
export function forYouSeeds(
  profile: InterestProfile,
  limit = 30
): { doi?: string; arxivId?: string; title: string; weight: number }[] {
  return profile.engaged
    .filter((entry) => entry.paper.doi?.trim() || entry.paper.arxivId?.trim())
    .slice(0, limit)
    .map((entry) => ({
      doi: entry.paper.doi || undefined,
      arxivId: entry.paper.arxivId || undefined,
      title: entry.paper.title,
      weight: Math.round(entry.weight * 100) / 100,
    }));
}
