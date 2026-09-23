// Proposing subject areas from what papers are about.
//
// A knowledge graph of an unorganised library is 500 disconnected dots: nothing
// links to anything until you have done the filing, which is the work you wanted
// help with. So when papers are not grouped, the app proposes groups itself, from
// the only evidence available — their titles, tags, and abstracts.
//
// The method is deliberately plain tf-idf and cosine similarity rather than
// anything learned. It has to run in the browser on every library, be identical
// every time it runs, and — most importantly — be explainable: every group is
// labelled with the terms that actually defined it, so a proposal you disagree
// with tells you why it was made.

import { matchField } from "./fieldLexicon";

export interface GroupableDocument {
  id: string;
  title: string;
  tags?: string[];
  abstract?: string;
  venue?: string;
}

export interface SubjectGroup {
  id: string;
  /** Read from the terms that define the group, e.g. "protein language models". */
  label: string;
  /** The defining terms, most distinctive first — the group's justification. */
  terms: string[];
  documentIds: string[];
}

export interface SubjectGroupingOptions {
  /** Cosine similarity a document needs to join a group. */
  threshold?: number;
  /** Groups smaller than this are not worth proposing. */
  minSize?: number;
  maxGroups?: number;
  /**
   * A group larger than this is split again at a stricter threshold. Without it,
   * a library that shares one vocabulary collapses into a single bucket holding
   * half of everything, which tells you no more than no grouping at all.
   */
  maxGroupSize?: number;
  /** Characters of the abstract to read. The opening is where the topic is. */
  abstractChars?: number;
}

// Ordinary English, plus the words every academic title uses. These carry no
// subject signal; idf would discount them anyway, but dropping them early keeps
// the labels readable.
const STOPWORDS = new Set(`a an and are as at be been but by can for from has have
if in into is it its of on or that the their there these this to via with within
we our using use used toward towards approach approaches based new novel study
studies method methods paper preprint results analysis case show shows showing
improve improved improving efficient effective accurate accurately fast rapid
general generalizable scale large small high low better best more most non over
under between across through during without about against than then when where
which while who whom whose what how why all any both each few other some such no
nor not only own same so too very just also both`.split(/\s+/).filter(Boolean));

/**
 * Words reduced to a common stem so "learning", "learned", and "learns" match.
 *
 * The stem is for matching only; it is unreadable ("supervis", "direct"), so the
 * surface form each stem came from is recorded separately and used in labels.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  return word.replace(/(?:ational|ization|isation|ing|ions|ion|ed|es|s)$/, (suffix, offset: number) =>
    offset >= 3 ? "" : suffix
  );
}

export interface Tokens {
  /** Stemmed terms: unigrams, plus bigrams of genuinely adjacent words. */
  terms: string[];
  /** stem -> the surface form it was seen as, for readable labels. */
  surface: Map<string, string>;
}

export function tokenize(text: string): Tokens {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

  const terms: string[] = [];
  const surface = new Map<string, string>();
  // Adjacency is tracked on the original word sequence. Forming bigrams after
  // dropping stopwords would invent phrases: "prediction of protein" would become
  // "prediction protein", which is not a phrase anybody wrote.
  let previous: { term: string; word: string } | null = null;
  for (const word of words) {
    const keep = word.length > 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word);
    if (!keep) {
      previous = null;
      continue;
    }
    const term = stem(word);
    if (!surface.has(term)) surface.set(term, word);
    terms.push(term);
    if (previous) {
      const bigram = `${previous.term} ${term}`;
      if (!surface.has(bigram)) surface.set(bigram, `${previous.word} ${word}`);
      terms.push(bigram);
    }
    previous = { term, word };
  }
  return { terms, surface };
}

type Vector = Map<string, number>;

function buildVector(
  document: GroupableDocument,
  abstractChars: number,
  surface: Map<string, string>
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (text: string, weight: number) => {
    const tokens = tokenize(text);
    for (const [term, word] of tokens.surface) if (!surface.has(term)) surface.set(term, word);
    for (const term of tokens.terms) counts.set(term, (counts.get(term) || 0) + weight);
  };
  // A tag is a human's own summary of the topic, so it counts for most; a title
  // next; the abstract is the noisiest and counts for least.
  for (const tag of document.tags || []) add(tag.replace(/-/g, " "), 4);
  add(document.title || "", 3);
  if (document.abstract) add(document.abstract.slice(0, abstractChars), 1);
  return counts;
}

function cosine(a: Vector, b: Vector): number {
  // Walk the shorter vector; both are unit length already.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let total = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) total += weight * other;
  }
  return total;
}

/**
 * Group documents by what they are about.
 *
 * Returns the proposed groups plus whatever did not fit into one. Being left out
 * is a real answer: a paper with nothing in common with the rest of the library
 * should be visible as exactly that, not forced into the nearest group.
 */
export function proposeSubjectGroups(
  documents: GroupableDocument[],
  options: SubjectGroupingOptions = {}
): { groups: SubjectGroup[]; ungroupedIds: string[] } {
  // Tuned towards many narrow groups rather than a few broad ones. A collection
  // named for a field you recognise is useful at twelve papers and useless at
  // ninety, where it is just "the pile" again.
  const threshold = options.threshold ?? 0.19;
  const minSize = options.minSize ?? 3;
  const maxGroups = options.maxGroups ?? 40;
  // Scaled to the library. A cap of 22 is right for five hundred papers and far
  // too loose for forty, where a group of ten is a quarter of everything and gets
  // a name as vague as "Artificial intelligence".
  const maxGroupSize =
    options.maxGroupSize ?? Math.max(4, Math.min(22, Math.ceil(documents.length / 6)));
  const abstractChars = options.abstractChars ?? 600;

  // Sorted by id so the proposal is identical every time it is computed.
  const ordered = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  if (ordered.length < minSize) return { groups: [], ungroupedIds: ordered.map((d) => d.id) };

  const surface = new Map<string, string>();
  const rawCounts = ordered.map((document) => buildVector(document, abstractChars, surface));

  // Document frequency, for idf.
  const documentFrequency = new Map<string, number>();
  for (const counts of rawCounts) {
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  const total = ordered.length;
  // A term appearing in one document cannot group anything; one appearing in most
  // of them cannot separate anything.
  //
  // The upper limit only applies once there are enough documents for "most of
  // them" to mean something. In a handful of documents every shared term looks
  // ubiquitous, and discarding those leaves nothing at all to group on.
  const ceiling = total <= 8 ? total : Math.max(2, Math.floor(total * 0.5));

  const vectors: Vector[] = rawCounts.map((counts) => {
    const vector: Vector = new Map();
    for (const [term, count] of counts) {
      const frequency = documentFrequency.get(term) || 0;
      if (frequency < 2 || frequency > ceiling) continue;
      // Smoothed idf. The textbook log(N/df) is exactly zero for a term present
      // in every document, which would silently zero out the whole vocabulary of
      // a library that is all about one thing — the case where grouping by the
      // finer distinctions matters most.
      vector.set(term, (1 + Math.log(count)) * Math.log(1 + total / frequency));
    }
    let norm = 0;
    for (const weight of vector.values()) norm += weight * weight;
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [term, weight] of vector) vector.set(term, weight / norm);
    return vector;
  });

  // Inverted index, so a document is only ever compared with ones it shares a
  // term with rather than with the whole library.
  const postings = new Map<string, number[]>();
  vectors.forEach((vector, index) => {
    for (const term of vector.keys()) {
      const list = postings.get(term);
      if (list) list.push(index);
      else postings.set(term, [index]);
    }
  });

  function neighbours(index: number): number[] {
    const seen = new Set<number>();
    for (const term of vectors[index].keys()) {
      for (const other of postings.get(term) || []) if (other !== index) seen.add(other);
    }
    return [...seen];
  }

  const assigned = new Array(ordered.length).fill(false);
  // Seed with the document that has the most distinctive content, so groups form
  // around a clear centre rather than around whatever came first.
  const mass = vectors.map((vector) => {
    let strongest = 0;
    for (const weight of vector.values()) strongest = Math.max(strongest, weight);
    return strongest * Math.sqrt(vector.size);
  });
  const seedOrder = ordered
    .map((_, index) => index)
    .sort((a, b) => mass[b] - mass[a] || ordered[a].id.localeCompare(ordered[b].id));

  const groups: SubjectGroup[] = [];
  for (const seed of seedOrder) {
    if (groups.length >= maxGroups) break;
    if (assigned[seed] || vectors[seed].size === 0) continue;

    const candidates = neighbours(seed).filter((index) => !assigned[index]);
    let members = candidates.filter((index) => cosine(vectors[seed], vectors[index]) >= threshold);
    members.push(seed);
    if (members.length < minSize) continue;

    // Re-gather around the centre of what was found, so the group is defined by
    // the cluster rather than by whichever document happened to seed it.
    const centroid: Vector = new Map();
    for (const index of members) {
      for (const [term, weight] of vectors[index]) centroid.set(term, (centroid.get(term) || 0) + weight);
    }
    let norm = 0;
    for (const weight of centroid.values()) norm += weight * weight;
    norm = Math.sqrt(norm) || 1;
    for (const [term, weight] of centroid) centroid.set(term, weight / norm);

    members = [...new Set([...candidates, seed])].filter(
      (index) => !assigned[index] && cosine(centroid, vectors[index]) >= threshold
    );
    if (members.length < minSize) continue;
    for (const index of members) assigned[index] = true;

    const ranked = [...centroid.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.map(([term]) => term);
    // What the group is mostly *about*, by plain frequency across its members —
    // as opposed to the centroid above, which is weighted towards what makes it
    // distinctive. Distinctiveness is the right basis for separating clusters and
    // the wrong one for naming them: one title mentioning "artificial
    // intelligence" can dominate a centroid for nine papers that are all, plainly,
    // about protein engineering.
    const profile = new Map<string, number>();
    for (const index of members) {
      for (const [term, count] of rawCounts[index]) {
        profile.set(term, (profile.get(term) || 0) + count);
      }
    }
    const byFrequency = [...profile.entries()].sort((a, b) => b[1] - a[1]);
    groups.push({
      id: `subject-${groups.length + 1}`,
      label: labelFor(ranked, surface, byFrequency),
      terms: top.slice(0, 6).map((term) => surface.get(term) || term),
      documentIds: members.sort((a, b) => a - b).map((index) => ordered[index].id),
    });
  }

  const ungroupedIds = ordered.filter((_, index) => !assigned[index]).map((document) => document.id);

  // Split anything too big to be a subject, by re-grouping just its members at a
  // stricter threshold. One pass: a second would shred the groups into pairs.
  const byId = new Map(ordered.map((document) => [document.id, document]));
  const finalGroups: SubjectGroup[] = [];
  // A queue rather than a single pass: the remainder of a split can itself still
  // be too big, and leaving it is how you end up with one bucket holding a tenth
  // of the library under a name as vague as "Deep learning".
  const queue = groups.map((group) => ({ group, depth: 0 }));
  const MAX_SPLIT_DEPTH = 3;
  while (queue.length) {
    const { group, depth } = queue.shift()!;
    if (group.documentIds.length <= maxGroupSize || depth >= MAX_SPLIT_DEPTH) {
      finalGroups.push(group);
      continue;
    }
    const members = group.documentIds.map((id) => byId.get(id)!).filter(Boolean);
    const split = proposeSubjectGroups(members, {
      ...options,
      // Stricter each round, so a stubborn cluster is eventually prised apart —
      // but only a little stricter. Jumping straight to a demanding threshold
      // finds no sub-clusters at all, the split is abandoned, and the oversized
      // group survives with a name too vague to be worth having.
      threshold: Math.min(0.5, threshold * (1.35 + depth * 0.35)),
      maxGroups: Math.max(2, Math.ceil(members.length / maxGroupSize) + 2),
      maxGroupSize: Number.POSITIVE_INFINITY,
    });
    if (split.groups.length < 2) {
      finalGroups.push(group);
      continue;
    }
    for (const child of split.groups) queue.push({ group: child, depth: depth + 1 });
    // Whatever the stricter pass could not place stays in the parent group, so
    // nothing is silently dropped by the split.
    if (split.ungroupedIds.length >= minSize) {
      // Named from what is actually left, not from the parent: once the good
      // clusters have been lifted out, the parent's name no longer describes the
      // remainder. Forcing one group over the leftovers gets them a label of
      // their own through exactly the same machinery.
      const leftovers = split.ungroupedIds.map((id) => byId.get(id)!).filter(Boolean);
      const named = proposeSubjectGroups(leftovers, {
        ...options,
        threshold: 0,
        minSize: leftovers.length,
        maxGroups: 1,
        maxGroupSize: Number.POSITIVE_INFINITY,
      });
      queue.push({
        group: {
          ...group,
          label: named.groups[0]?.label || group.label,
          terms: named.groups[0]?.terms || group.terms,
          documentIds: split.ungroupedIds,
        },
        depth: depth + 1,
      });
    } else {
      ungroupedIds.push(...split.ungroupedIds);
    }
  }

  return {
    groups: disambiguate(finalGroups).map((group, index) => ({ ...group, id: `subject-${index + 1}` })),
    ungroupedIds,
  };
}

/**
 * Tell apart groups that landed on the same field name.
 *
 * Several clusters can legitimately belong to one field — six clusters of
 * structure-prediction papers really are six different corners of it — and six
 * collections all called "Protein structure prediction" is worse than one. Each
 * keeps the field name and gains the strongest term that its same-named siblings
 * do not have, so they read as "Protein structure prediction · contact maps".
 */
// Words that survive the stopword list because they carry meaning inside a title,
// but say nothing as the distinguishing half of a collection's name.
const WEAK_QUALIFIERS = new Set([
  "joint", "upon", "leveraging", "predicting", "prediction", "learning", "deep",
  "end", "single", "novel", "towards", "toward", "using", "via", "space", "data",
  "model", "models", "method", "methods", "analysis", "study", "approach", "level",
]);

function disambiguate(groups: SubjectGroup[]): SubjectGroup[] {
  const byLabel = new Map<string, SubjectGroup[]>();
  for (const group of groups) {
    const siblings = byLabel.get(group.label) || [];
    siblings.push(group);
    byLabel.set(group.label, siblings);
  }

  return groups.map((group) => {
    const siblings = byLabel.get(group.label) || [];
    if (siblings.length < 2) return group;
    const others = new Set(
      siblings.filter((sibling) => sibling !== group).flatMap((sibling) => sibling.terms)
    );
    const own = group.label.toLowerCase();
    const usable = (term: string) =>
      !others.has(term) &&
      !own.includes(term.toLowerCase()) &&
      !WEAK_QUALIFIERS.has(term.toLowerCase()) &&
      term.length > 3;
    // A phrase says more than a word: "· contact maps" beats "· maps", and
    // "· joint" says nothing at all.
    const distinguishing =
      group.terms.find((term) => term.includes(" ") && usable(term)) ||
      group.terms.find(usable);
    return distinguishing ? { ...group, label: `${group.label} · ${distinguishing}` } : group;
  });
}

/**
 * A readable name from the group's defining terms.
 *
 * Prefers a two-word phrase — "directed evolution" reads as a subject, "evolution
 * directed protein" reads as a search query — and avoids repeating a word that
 * the chosen phrase already contains.
 */
function labelFor(
  ranked: Array<[string, number]>,
  surface: Map<string, string>,
  byFrequency: Array<[string, number]> = ranked
): string {
  const read = (term: string) => surface.get(term) || term;

  // A recognised field, where the group's own vocabulary supports one. This is
  // what turns "reward, policy, safe" into "AI safety". Matched on what the group
  // is mostly about rather than on what sets it apart.
  const field = matchField(
    byFrequency.slice(0, 40).map(([term, weight]) => [read(term), weight] as [string, number])
  );
  if (field) return field.name;

  // Otherwise the strongest phrase the group actually contains. No second term
  // bolted on: "Sequence design & localization" was never a subject anybody has.
  const top = ranked.map(([term]) => term);
  // A phrase whose first word is a filler reads as a fragment: "end learning"
  // came from "end-to-end learning" and names nothing.
  const phrase =
    top.find((term) => term.includes(" ") && !WEAK_QUALIFIERS.has(read(term).split(" ")[0])) ||
    top.find((term) => term.includes(" "));
  const label = phrase ? read(phrase) : top.slice(0, 2).map(read).join(" ");
  if (!label) return "Unlabelled";
  return label.charAt(0).toUpperCase() + label.slice(1);
}
