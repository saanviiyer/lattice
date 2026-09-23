// Suggests papers to read next, from the papers a project already contains.
//
// The signal is bibliographic coupling: take the project's papers as seeds, ask
// OpenAlex what each one cites and what it is related to, and rank the results by how
// many separate seeds point at the same work. A paper three of your seeds cite is a
// paper you are missing; a paper one seed cites is just a reference.
//
// That ranking is also the explanation. A recommendation with no reason attached is
// noise a researcher cannot act on, so every suggestion carries the seeds that
// produced it and the reader can judge it without trusting the score.
//
// Nothing here is a language model. These are citation links the literature already
// contains, which is why a suggestion can be justified rather than merely asserted.

import { USER_AGENT, cacheGet, cacheSet, rateLimited, clean } from "./http.js";
import { normalizeDoi } from "./crossref.js";

const CONTACT_EMAIL = process.env.OA_CONTACT_EMAIL || "hello@lattice.app";
const API = "https://api.openalex.org/works";
// OpenAlex allows 10 requests a second with a mailto. This runs a handful of requests
// per suggestion pass, so it stays well inside that with room for the rest of the app.
const MIN_INTERVAL_MS = 150;
// Enough seeds to make a coupling count meaningful, few enough to stay one request.
const MAX_SEEDS = 40;
const MAX_CANDIDATE_LOOKUP = 50;
// Below this, "how many of your papers point at it" is not a measurement. One seed
// makes every entry in its bibliography score 1, which is a reading list for that one
// paper, not a suggestion drawn from the project.
const MIN_SEEDS = 3;
// With enough seeds, a suggestion has to be reached from at least two of them. This is
// the whole idea: a work two of your papers cite is one you are missing, a work one of
// them cites is just a reference.
const MIN_COUPLING = 2;

/**
 * arXiv preprints get a DOI of the form 10.48550/arXiv.<id>, which lets them go
 * through the same batch lookup as everything else. OpenAlex's mapping for these is
 * not always correct, so the title check below is what makes using them safe.
 */
function seedDoi(seed) {
  const doi = normalizeDoi(seed?.doi);
  if (doi) return doi;
  const arxiv = String(seed?.arxivId || "").trim().replace(/^arxiv:/i, "").replace(/v\d+$/i, "");
  return /^\d{4}\.\d{4,5}$/.test(arxiv) ? `10.48550/arxiv.${arxiv}` : "";
}

function shortId(id) {
  // OpenAlex ids arrive as full URLs; the filter syntax wants the bare W-number.
  const match = /\/(W\d+)$/.exec(String(id || ""));
  return match ? match[1] : "";
}

async function openAlex(params) {
  const url = `${API}?${params}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
  const cached = cacheGet(url);
  if (cached) return cached;
  const res = await rateLimited("openalex-suggest", MIN_INTERVAL_MS, () =>
    fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } })
  );
  if (!res.ok) throw new Error(`OpenAlex returned ${res.status}`);
  const body = await res.json();
  cacheSet(url, body);
  return body;
}

/** Words that carry identity, for checking a lookup returned the paper we asked for. */
function titleKey(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3)
  );
}

/**
 * True when two titles are plausibly the same paper.
 *
 * This guard exists because OpenAlex's arXiv DOI mappings are not always right: at the
 * time of writing, doi:10.48550/arXiv.2212.08073 resolves to a paper that is not the
 * one arXiv serves under that id. Seeding a project's recommendations from somebody
 * else's paper would be worse than returning nothing, and it would be invisible --
 * the suggestions would simply be quietly about the wrong subject.
 */
function samePaper(asked, got) {
  const a = titleKey(asked);
  const b = titleKey(got);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size) >= 0.6;
}

/** OpenAlex stores abstracts as a word -> positions map. Put the words back in order. */
function abstractFromIndex(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) words[position] = word;
  }
  return clean(words.join(" "));
}

function doiOf(work) {
  return normalizeDoi(String(work?.doi || "").replace(/^https?:\/\/doi\.org\//i, ""));
}

/**
 * Resolve the seeds to OpenAlex works, keeping only those that came back as the paper
 * we asked for. Returns the verified works plus the titles that could not be matched,
 * so the caller can say how much of the project actually contributed.
 */
async function resolveSeeds(seeds) {
  const withDoi = seeds.filter((seed) => seedDoi(seed)).slice(0, MAX_SEEDS);
  if (!withDoi.length) return { works: [], unresolved: seeds.map((s) => s.title) };

  const filter = withDoi.map((seed) => seedDoi(seed)).join("|");
  const body = await openAlex(
    `filter=doi:${encodeURIComponent(filter)}` +
      `&select=id,doi,title,referenced_works&per-page=${withDoi.length}`
  );

  const byDoi = new Map();
  for (const work of body.results || []) {
    const doi = doiOf(work);
    if (doi) byDoi.set(doi, work);
  }

  const works = [];
  const unresolved = [];
  for (const seed of withDoi) {
    const work = byDoi.get(seedDoi(seed));
    if (!work) {
      unresolved.push(seed.title);
      continue;
    }
    // A title we were not given cannot be checked; trust the DOI in that case only.
    if (seed.title && !samePaper(seed.title, work.title)) {
      unresolved.push(seed.title);
      continue;
    }
    // How much the researcher has worked with this seed, when the caller says. A paper
    // two heavily-read seeds cite outranks one two skimmed seeds cite.
    const weight = Number(seed.weight);
    works.push({
      ...work,
      seedTitle: seed.title || work.title,
      seedWeight: Number.isFinite(weight) && weight > 0 ? Math.min(weight, 10) : 1,
    });
  }
  return { works, unresolved };
}

/**
 * Rank what the seeds cite.
 *
 * Only real citations count. OpenAlex also exposes a `related_works` field, and it was
 * used here until it was tried against a real library: for recent preprints -- which
 * have no reference data of their own -- it returned a Kazakh pedagogy journal and a
 * 1998 paper on parallelising compilers as neighbours of a paper about on-device
 * language models. A citation is a claim the authors made and a reader can check; that
 * similarity score is not, and one bad entry discredits the whole list.
 */
function tally(works, excludeIds) {
  const scores = new Map();
  for (const work of works) {
    const seen = new Set();
    const add = (id, weight) => {
      const key = shortId(id);
      if (!key || excludeIds.has(key) || seen.has(key)) return;
      seen.add(key);
      const entry = scores.get(key) || { id: key, seeds: [], weight: 0 };
      entry.seeds.push(work.seedTitle);
      entry.weight += weight;
      scores.set(key, entry);
    };
    for (const id of work.referenced_works || []) add(id, work.seedWeight || 1);
  }
  return [...scores.values()].sort(
    (a, b) => b.seeds.length - a.seeds.length || b.weight - a.weight
  );
}

/**
 * Suggest papers for a set of seeds.
 *
 * `exclude` is the DOIs already in the library: a suggestion the user owns is worse
 * than no suggestion, because it makes the whole list look untrustworthy.
 */
export async function suggestPapers({ seeds = [], exclude = [], limit = 6 } = {}) {
  const usable = seeds.filter((seed) => seed && seedDoi(seed));
  if (!usable.length) {
    return { suggestions: [], seedsUsed: 0, reason: "no-identifiers" };
  }

  const { works, unresolved } = await resolveSeeds(usable);
  if (works.length < MIN_SEEDS) {
    // Saying so is better than showing a list built from one bibliography, which looks
    // like a recommendation but is not one.
    return { suggestions: [], seedsUsed: works.length, unresolved, reason: "not-enough-seeds" };
  }

  const excludedDois = new Set(exclude.map((doi) => normalizeDoi(doi)).filter(Boolean));
  const excludeIds = new Set(works.map((work) => shortId(work.id)).filter(Boolean));

  // Over-fetch: some candidates drop out once their DOI turns out to be owned already.
  const ranked = tally(works, excludeIds)
    .filter((entry) => new Set(entry.seeds).size >= MIN_COUPLING)
    .slice(0, MAX_CANDIDATE_LOOKUP);
  if (!ranked.length) {
    // Common for a project of recent preprints: OpenAlex has the papers but not their
    // bibliographies yet, so there is genuinely nothing to couple on.
    const anyReferences = works.some((work) => (work.referenced_works || []).length);
    return {
      suggestions: [],
      seedsUsed: works.length,
      unresolved,
      reason: anyReferences ? "no-overlap" : "no-citation-data",
    };
  }

  const detail = await openAlex(
    `filter=openalex_id:${ranked.map((entry) => entry.id).join("|")}` +
      "&select=id,doi,title,publication_year,authorships,primary_location," +
      "cited_by_count,abstract_inverted_index" +
      `&per-page=${ranked.length}`
  );

  const byId = new Map();
  for (const work of detail.results || []) byId.set(shortId(work.id), work);

  const suggestions = [];
  for (const entry of ranked) {
    if (suggestions.length >= limit) break;
    const work = byId.get(entry.id);
    if (!work) continue;
    const doi = doiOf(work);
    // Without a DOI the user cannot add it in one step, and we cannot tell whether
    // they already have it.
    if (!doi || excludedDois.has(doi)) continue;

    suggestions.push({
      doi,
      title: clean(work.title || ""),
      authors: (work.authorships || [])
        .map((a) => clean(a?.author?.display_name || ""))
        .filter(Boolean)
        .slice(0, 8),
      year: work.publication_year || null,
      venue: clean(work.primary_location?.source?.display_name || ""),
      citedByCount: work.cited_by_count || 0,
      abstract: abstractFromIndex(work.abstract_inverted_index),
      // The justification. Deduplicated: one seed citing a work twice is still one.
      because: [...new Set(entry.seeds)].slice(0, 4),
      seedCount: new Set(entry.seeds).size,
    });
  }

  return { suggestions, seedsUsed: works.length, unresolved };
}
