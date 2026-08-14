// CrossRef metadata client. Resolves a DOI to structured paper metadata via the
// public REST API (no key needed). Docs: https://api.crossref.org
//
// We follow CrossRef's "polite pool" guidance: a descriptive User-Agent and a
// short minimum interval between requests, plus a brief cache.
import { USER_AGENT, cacheGet, cacheSet, rateLimited, clean } from "./http.js";

const ENDPOINT = "https://api.crossref.org/works/";
const MIN_INTERVAL_MS = 1000;

// Normalize a raw DOI string or a doi.org URL into a bare DOI.
export function normalizeDoi(input = "") {
  let s = String(input).trim();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  s = s.replace(/^doi:\s*/i, "");
  return s.trim();
}

export function looksLikeDoi(input = "") {
  return /10\.\d{4,9}\/\S+/.test(normalizeDoi(input));
}

// CrossRef abstracts are often JATS XML. Strip tags to plain text.
function stripJats(abstract = "") {
  if (!abstract) return "";
  return clean(
    abstract
      .replace(/<jats:title>[\s\S]*?<\/jats:title>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function pickYear(msg) {
  const parts =
    msg?.published?.["date-parts"] ||
    msg?.["published-print"]?.["date-parts"] ||
    msg?.["published-online"]?.["date-parts"] ||
    msg?.issued?.["date-parts"] ||
    msg?.created?.["date-parts"];
  const y = parts && parts[0] && parts[0][0];
  return typeof y === "number" ? y : null;
}

function mapWork(msg) {
  const title = clean((msg.title && msg.title[0]) || "");
  const authors = (msg.author || [])
    .map((a) => clean([a.given, a.family].filter(Boolean).join(" ") || a.name || ""))
    .filter(Boolean);
  const venue = clean(
    (msg["container-title"] && msg["container-title"][0]) ||
      msg["publisher"] ||
      ""
  );
  const doi = clean(msg.DOI || "");
  return {
    title,
    authors,
    year: pickYear(msg),
    venue,
    abstract: stripJats(msg.abstract || ""),
    doi,
    url: clean(msg.URL || (doi ? `https://doi.org/${doi}` : "")),
    source: "doi",
  };
}

export async function fetchByDoi(rawDoi) {
  const doi = normalizeDoi(rawDoi);
  if (!looksLikeDoi(doi)) {
    throw new Error("That does not look like a valid DOI.");
  }

  const cached = cacheGet("crossref", doi);
  if (cached) return { ...cached, cached: true };

  const url = `${ENDPOINT}${encodeURIComponent(doi)}`;
  const res = await rateLimited("crossref", MIN_INTERVAL_MS, () =>
    fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } })
  );

  if (res.status === 404) throw new Error(`No CrossRef record found for DOI ${doi}.`);
  if (!res.ok) throw new Error(`CrossRef responded ${res.status}.`);

  const body = await res.json();
  if (!body || body.status !== "ok" || !body.message) {
    throw new Error("CrossRef returned an unexpected response.");
  }

  const paper = mapWork(body.message);
  if (!paper.title) throw new Error("CrossRef record had no usable title.");
  cacheSet("crossref", doi, paper);
  return { ...paper, cached: false };
}
