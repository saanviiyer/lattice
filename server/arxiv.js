// arXiv metadata client. Resolves an arXiv id (or abs/pdf URL) to structured paper
// metadata via the public Atom API (no key needed). We parse the feed with a small
// dependency-free parser and stay polite with a min interval + brief cache.
//
// arXiv limits automated access per network, API calls and PDF downloads alike, and
// answers an over-eager client with 429s that take the better part of a minute to
// clear. So beyond pacing requests, this client:
//   - backs off after a 429 instead of asking again, which only extends the limit;
//   - shares its queue with PDF downloads from arxiv.org (see openAccess.js), since
//     arXiv counts those against the same allowance;
//   - while arXiv is unavailable, resolves new-style ids from the record arXiv itself
//     registers with DataCite, so adding a paper keeps working.
//
// Docs: https://info.arxiv.org/help/api/user-manual.html
import {
  USER_AGENT,
  cacheGet,
  cacheSet,
  rateLimited,
  clean,
  coolDown,
  cooldownRemaining,
} from "./http.js";

// https directly: the http endpoint answers with a redirect, which doubled every
// lookup and sent the second request outside the pacing below.
const ENDPOINT = "https://export.arxiv.org/api/query";
const DATACITE = "https://api.datacite.org/dois";
export const ARXIV_QUEUE = "arxiv";
const REQUEST_TIMEOUT_MS = 20_000;
// arXiv's 429 carries no Retry-After, and about a minute is how long its limit takes
// to clear. A timeout usually means it is struggling rather than refusing us.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const TIMEOUT_COOLDOWN_MS = 30_000;
// arXiv mints DOIs, and so DataCite records, only for ids in the post-2007 scheme.
const NEW_STYLE_ID = /^\d{4}\.\d{4,5}$/;

/** arXiv asks for about one request every three seconds. Overridable for tests. */
export function arxivIntervalMs() {
  const raw = process.env.LATTICE_ARXIV_INTERVAL_MS;
  const override = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(override) && override >= 0 ? override : 3000;
}

/** Whether a URL points at arXiv, whose requests all count against one allowance. */
export function isArxivHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "arxiv.org" || host.endsWith(".arxiv.org");
  } catch {
    return false;
  }
}

// What the last trouble with arXiv was, so a lookup made during the back-off can say
// why it did not ask.
let lastTrouble = "limited";

function retryAfterMs(res) {
  const raw = res.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : null;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > Date.now() ? at - Date.now() : null;
}

/**
 * Record what an arXiv response says about its load. Returns true when arXiv is
 * limiting us, having started the back-off every arXiv request then respects.
 */
export function noteArxivResponse(res) {
  if (res.status !== 429 && res.status !== 503) return false;
  coolDown(ARXIV_QUEUE, retryAfterMs(res) ?? RATE_LIMIT_COOLDOWN_MS);
  lastTrouble = "limited";
  return true;
}

/** Whole seconds until arXiv should be asked again; 0 when it is fine to ask. */
export function arxivWaitSeconds() {
  return Math.ceil(cooldownRemaining(ARXIV_QUEUE) / 1000);
}

// Pull a bare arXiv id out of a raw id, an abs URL, or a pdf URL. Handles both the
// new scheme (2401.01234) and the old scheme (math.GT/0309136), with optional version.
export function extractArxivId(input = "") {
  let s = String(input).trim();
  const m = s.match(
    /(?:arxiv\.org\/(?:abs|pdf)\/)?((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(v\d+)?/i
  );
  if (m) return m[1];
  return s.replace(/^arxiv:/i, "").replace(/v\d+$/i, "").trim();
}

function firstTag(xml, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1] : "";
}

function allTags(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function attr(fragment, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(fragment);
  return m ? clean(m[1]) : "";
}

function parseEntry(entryXml, fallbackId) {
  const authors = allTags(entryXml, "author")
    .map((a) => clean(firstTag(a, "name")))
    .filter(Boolean);

  const published = clean(firstTag(entryXml, "published"));
  const year = published ? Number(published.slice(0, 4)) : null;

  // arXiv may include a DOI via <arxiv:doi> when the paper is also published.
  const arxivDoi = clean(firstTag(entryXml, "arxiv:doi"));
  const journalRef = clean(firstTag(entryXml, "arxiv:journal_ref"));

  let absUrl = "";
  const linkRe = /<link\b[^>]*\/?>/g;
  let lm;
  while ((lm = linkRe.exec(entryXml)) !== null) {
    const rel = attr(lm[0], "rel");
    const type = attr(lm[0], "type");
    if (rel === "alternate" || type === "text/html") absUrl = attr(lm[0], "href");
  }

  const id = fallbackId;
  return {
    title: clean(firstTag(entryXml, "title")),
    authors,
    year: Number.isFinite(year) ? year : null,
    venue: journalRef || "arXiv",
    abstract: clean(firstTag(entryXml, "summary")),
    doi: arxivDoi,
    url: absUrl || (id ? `https://arxiv.org/abs/${id}` : ""),
    arxivId: id,
    source: "arxiv",
  };
}

function notFound(id) {
  const err = new Error(`No arXiv record found for ${id}.`);
  err.notFound = true;
  err.status = 404;
  return err;
}

async function fromArxivApi(id) {
  const params = new URLSearchParams({ id_list: id, max_results: "1" });
  const res = await rateLimited(ARXIV_QUEUE, arxivIntervalMs(), () =>
    fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  );
  noteArxivResponse(res);
  if (!res.ok) throw new Error(`arXiv responded ${res.status}.`);

  const xml = await res.text();
  const entry = allTags(xml, "entry")[0];
  // A malformed id comes back as a feed whose one entry is an error report titled
  // "Error" -- which, parsed naively, is a paper called "Error".
  if (!entry || /\/api\/errors/.test(firstTag(entry, "id"))) throw notFound(id);

  const paper = parseEntry(entry, id);
  if (!paper.title) throw new Error(`arXiv record for ${id} had no usable title.`);
  return paper;
}

/**
 * The record arXiv registers with DataCite when it mints a paper's DOI
 * (10.48550/arXiv.<id>). It is arXiv's own metadata published through a second
 * service, which is what makes it safe to substitute -- unlike OpenAlex's mapping for
 * the same DOIs, which has returned the wrong paper.
 */
async function fromDataCite(id) {
  if (!NEW_STYLE_ID.test(id)) return null;
  const doi = encodeURIComponent(`10.48550/arxiv.${id}`);
  const res = await rateLimited("datacite", 100, () =>
    fetch(`${DATACITE}/${doi}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.api+json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  );
  if (!res.ok) return null;
  const attributes = (await res.json())?.data?.attributes;
  const title = clean(attributes?.titles?.[0]?.title || "");
  if (!title) return null;

  const authors = (attributes.creators || [])
    .map((creator) => {
      if (creator.givenName && creator.familyName) {
        return clean(`${creator.givenName} ${creator.familyName}`);
      }
      // "Vaswani, Ashish" for a person; an organisation's name stays as written.
      const name = clean(creator.name || "");
      if (creator.nameType === "Organizational" || !name.includes(",")) return name;
      const [family, ...given] = name.split(",");
      return clean(`${given.join(",")} ${family}`);
    })
    .filter(Boolean);

  const abstract = (attributes.descriptions || []).find(
    (description) => description.descriptionType === "Abstract"
  );
  const year = Number(attributes.publicationYear);

  return {
    title,
    authors,
    year: Number.isFinite(year) && year > 0 ? year : null,
    venue: "arXiv",
    abstract: clean(abstract?.description || ""),
    // Empty, as on the arXiv path when a paper is unpublished: doi means the published
    // version's DOI, and filing the arXiv DOI there would stop this record matching
    // the same paper added straight from arXiv.
    doi: "",
    url: attributes.url || `https://arxiv.org/abs/${id}`,
    arxivId: id,
    source: "arxiv",
  };
}

function unavailable(id, trouble) {
  const opening = {
    limited: "arXiv is limiting requests from your network right now",
    slow: "arXiv is not responding right now",
    error: "arXiv could not be reached",
  }[trouble] || "arXiv could not be reached";
  const backup = NEW_STYLE_ID.test(id)
    ? "and the backup copy of its record could not be reached either"
    : `and older ids like ${id} have no backup record to fall back on`;
  const wait = arxivWaitSeconds();
  const retry = wait > 0 ? `Try again in about ${wait} seconds.` : "Try again shortly.";
  const err = new Error(`${opening}, ${backup}. ${retry}`);
  err.status = 503;
  return err;
}

export async function fetchByArxiv(rawId) {
  const id = extractArxivId(rawId);
  if (!id) throw new Error("Could not find an arXiv id in that input.");

  const cached = cacheGet("arxiv", id);
  if (cached) return { ...cached, cached: true };

  let trouble;
  if (cooldownRemaining(ARXIV_QUEUE) > 0) {
    // Backing off: asking arXiv now would only extend the limit.
    trouble = lastTrouble;
  } else {
    try {
      const paper = await fromArxivApi(id);
      cacheSet("arxiv", id, paper);
      return { ...paper, cached: false };
    } catch (err) {
      // arXiv positively saying there is no such paper is an answer, not an outage.
      if (err.notFound) throw err;
      if (err.name === "TimeoutError") {
        coolDown(ARXIV_QUEUE, TIMEOUT_COOLDOWN_MS);
        lastTrouble = "slow";
        trouble = "slow";
      } else {
        trouble = cooldownRemaining(ARXIV_QUEUE) > 0 ? "limited" : "error";
      }
    }
  }

  const fallback = await fromDataCite(id).catch(() => null);
  if (fallback) {
    cacheSet("arxiv", id, fallback);
    return { ...fallback, cached: false };
  }
  throw unavailable(id, trouble);
}
