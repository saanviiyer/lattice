// Which papers in the library are about the same thing, and which project a paper
// belongs in.
//
// This runs on the library alone, with no network and no model, so it works on a
// plane and on a paper added a second ago. Each paper becomes a tf-idf vector of its
// title, tags, abstract and, where the reader has done the work, their takeaway and
// highlights: what you marked in a paper is a better description of why it matters to
// you than its abstract is.
//
// Every match carries the phrases the two papers share, so "similar" is something the
// reader can check rather than a score to take on trust.

import type { Collection, Highlight, Paper } from "../types";
import { GENERIC_WORDS } from "./researchBrain";
import { tokenize } from "./subjectGroups";

type Vector = Map<string, number>;

export interface PaperIndex {
  vectors: Map<string, Vector>;
  surface: Map<string, string>;
  papers: Map<string, Paper>;
  /** How many papers use each term, for telling a specific term from a common one. */
  df: Map<string, number>;
}

export interface SimilarPaper {
  paper: Paper;
  score: number;
  /** Readable phrases the two share, most telling first. */
  shared: string[];
}

// The shared stemmer takes "-es" off "ripples" but leaves "ripple" alone, so the
// singular and plural would never meet. Dropping a final "e" here puts both on
// "rippl". Only matching uses these; labels come from `surface`.
function fold(term: string): string {
  return term
    .split(" ")
    .map((word) => (word.length > 4 && word.endsWith("e") ? word.slice(0, -1) : word))
    .join(" ");
}

function addText(counts: Map<string, number>, surface: Map<string, string>, text: string, weight: number) {
  if (!text) return;
  const tokens = tokenize(text);
  for (const [term, word] of tokens.surface) if (!surface.has(fold(term))) surface.set(fold(term), word);
  for (const term of tokens.terms) counts.set(fold(term), (counts.get(fold(term)) || 0) + weight);
}

export function buildPaperIndex(papers: Paper[], highlights: Highlight[] = []): PaperIndex {
  const surface = new Map<string, string>();
  const marked = new Map<string, string>();
  for (const highlight of highlights) {
    marked.set(highlight.paperId, `${marked.get(highlight.paperId) || ""} ${highlight.text} ${highlight.note || ""}`);
  }

  const raw = new Map<string, Map<string, number>>();
  for (const paper of papers) {
    const counts = new Map<string, number>();
    for (const tag of paper.tags) addText(counts, surface, tag.replace(/-/g, " "), 4);
    addText(counts, surface, paper.title || "", 3);
    addText(counts, surface, (paper.abstract || "").slice(0, 1500), 1);
    addText(counts, surface, paper.takeaway || "", 2);
    addText(counts, surface, (marked.get(paper.id) || "").slice(0, 2000), 1.5);
    raw.set(paper.id, counts);
  }

  // Inverse document frequency: a term in every paper says nothing about any of them,
  // so it gets next to no weight (no +1 floor, or a tag on every paper would make
  // every paper look alike).
  const df = new Map<string, number>();
  for (const counts of raw.values()) for (const term of counts.keys()) df.set(term, (df.get(term) || 0) + 1);
  const n = Math.max(1, raw.size);

  const vectors = new Map<string, Vector>();
  for (const [id, counts] of raw) {
    const vector: Vector = new Map();
    let norm = 0;
    for (const [term, count] of counts) {
      const idf = Math.log((n + 1) / (df.get(term) || 1));
      // Bigrams are rarer and far more specific than single words.
      const weight = (1 + Math.log(count)) * idf * (term.includes(" ") ? 1.5 : 1);
      vector.set(term, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [term, weight] of vector) vector.set(term, weight / norm);
    vectors.set(id, vector);
  }

  return { vectors, surface, papers: new Map(papers.map((paper) => [paper.id, paper])), df };
}

function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) sum += weight * other;
  }
  return sum;
}

function sharedPhrases(index: PaperIndex, a: Vector, b: Vector, limit = 4): string[] {
  const surface = index.surface;
  // Only what is actually evidence: a tag on every paper is shared but says nothing.
  const overlap = [...a.entries()]
    .filter(([term]) => b.has(term) && isSpecific(index, term))
    .map(([term, weight]) => ({ term, weight: weight * b.get(term)! }))
    .sort((x, y) => y.weight - x.weight);
  const picked: string[] = [];
  for (const { term } of overlap) {
    // A word already inside a picked phrase adds nothing.
    if (picked.some((chosen) => chosen.split(" ").includes(term))) continue;
    picked.push(term);
    if (picked.length >= limit) break;
  }
  return picked.map((term) => surface.get(term) || term);
}

// A score alone does not separate a real match from noise: measured on small
// libraries, two papers on ripples scored 0.034 (0.020 when one had a long takeaway)
// while two unrelated papers sharing only "model" scored 0.028. What separates them
// is sharing a specific term, one most of the library does not use and that is not
// a word every field uses ("control"). So a match needs a small score and such a term.
const MIN_SCORE = 0.01;

/**
 * Whether a term says something particular. A two-word phrase can be used by a good
 * part of a small library and still count ("ring attractor" in a library about ring
 * attractors); a single word has to be rarer ("model" is in everything), and words
 * every field uses about its own work never count.
 */
function isSpecific(index: PaperIndex, term: string): boolean {
  if (GENERIC_WORDS.has(index.surface.get(term) || term)) return false;
  const n = index.papers.size;
  const limit = term.includes(" ") ? Math.max(3, Math.floor(n * 0.5)) : Math.max(2, Math.floor(n * 0.3));
  return (index.df.get(term) || 0) <= limit;
}

function sharesSpecificTerm(index: PaperIndex, a: Vector, b: Vector): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const term of small.keys()) if (large.has(term) && isSpecific(index, term)) return true;
  return false;
}

/** Papers in the library most like this one. */
export function similarPapers(index: PaperIndex, paperId: string, limit = 5): SimilarPaper[] {
  const vector = index.vectors.get(paperId);
  if (!vector) return [];
  const results: SimilarPaper[] = [];
  for (const [id, other] of index.vectors) {
    if (id === paperId) continue;
    const score = cosine(vector, other);
    if (score < MIN_SCORE || !sharesSpecificTerm(index, vector, other)) continue;
    results.push({ paper: index.papers.get(id)!, score, shared: [] });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((result) => ({
    ...result,
    shared: sharedPhrases(index, vector, index.vectors.get(result.paper.id)!),
  }));
}

export interface ProjectFit {
  project: Collection;
  score: number;
  /** The papers already in the project this one is closest to. */
  closest: Paper[];
}

/**
 * The projects a paper most plausibly belongs in, judged by how close it sits to the
 * papers already filed there. Projects it is already in are left out: the question
 * is where else it should go.
 */
export function projectsForPaper(
  index: PaperIndex,
  paperId: string,
  collections: Collection[],
  limit = 2
): ProjectFit[] {
  const vector = index.vectors.get(paperId);
  const paper = index.papers.get(paperId);
  if (!vector || !paper) return [];

  const fits: ProjectFit[] = [];
  for (const project of collections) {
    if (paper.collectionIds.includes(project.id)) continue;
    const members = [...index.papers.values()].filter(
      (other) => other.id !== paperId && other.collectionIds.includes(project.id)
    );
    if (members.length < 2) continue;
    // The mean of the best few matches, not of every member: a project is broad, and a
    // paper that fits one strand of it well belongs there.
    const scored = members
      .map((member) => {
        const other = index.vectors.get(member.id)!;
        const score = cosine(vector, other);
        return { member, score, specific: score >= MIN_SCORE && sharesSpecificTerm(index, vector, other) };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored.slice(0, 3);
    const score = best.reduce((sum, entry) => sum + entry.score, 0) / best.length;
    // At least two papers in the project have to be genuinely close to this one.
    const close = best.filter((entry) => entry.specific);
    if (close.length < 2 || score < 0.05) continue;
    fits.push({ project, score, closest: close.map((entry) => entry.member) });
  }
  return fits.sort((a, b) => b.score - a.score).slice(0, limit);
}
