// arXiv metadata client. Resolves an arXiv id (or abs/pdf URL) to structured paper
// metadata via the public Atom API (no key needed). We parse the feed with a small
// dependency-free parser and stay polite with a min interval + brief cache.
//
// Docs: https://info.arxiv.org/help/api/user-manual.html
import { USER_AGENT, cacheGet, cacheSet, rateLimited, clean } from "./http.js";

const ENDPOINT = "http://export.arxiv.org/api/query";
const MIN_INTERVAL_MS = 3000; // arXiv asks for ~1 request / 3s

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

export async function fetchByArxiv(rawId) {
  const id = extractArxivId(rawId);
  if (!id) throw new Error("Could not find an arXiv id in that input.");

  const cached = cacheGet("arxiv", id);
  if (cached) return { ...cached, cached: true };

  const params = new URLSearchParams({ id_list: id, max_results: "1" });
  const url = `${ENDPOINT}?${params.toString()}`;
  const res = await rateLimited("arxiv", MIN_INTERVAL_MS, () =>
    fetch(url, { headers: { "User-Agent": USER_AGENT } })
  );
  if (!res.ok) throw new Error(`arXiv responded ${res.status}.`);

  const xml = await res.text();
  const entry = allTags(xml, "entry")[0];
  if (!entry) throw new Error(`No arXiv record found for ${id}.`);

  const paper = parseEntry(entry, id);
  if (!paper.title) throw new Error(`arXiv record for ${id} had no usable title.`);
  cacheSet("arxiv", id, paper);
  return { ...paper, cached: false };
}
