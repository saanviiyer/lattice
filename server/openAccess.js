// Finds a legally downloadable PDF for a paper the user added by DOI or arXiv id,
// so adding a reference and being able to annotate it are the same step.
//
// Only open-access copies are resolved. The order is cheapest-and-most-reliable
// first:
//   1. arXiv        — the id maps straight to a PDF URL, no lookup needed.
//   2. Unpaywall    — the canonical index of OA copies for a DOI.
//   3. OpenAlex     — a second opinion, and it covers records Unpaywall misses.
//   4. CrossRef     — the publisher's own PDF link, when they register one.
// A paywalled paper simply has no result: nothing here circumvents access control,
// and the user is told to attach the PDF themselves.
//
// The fetch itself happens here rather than in the browser because publisher and
// repository hosts do not send CORS headers, so a page-side fetch cannot read the
// bytes even when the file is public.

import { USER_AGENT, cacheGet, cacheSet, rateLimited, clean, cooldownRemaining } from "./http.js";
import { normalizeDoi, looksLikeDoi } from "./crossref.js";
import {
  ARXIV_QUEUE,
  arxivIntervalMs,
  arxivWaitSeconds,
  extractArxivId,
  isArxivHost,
  noteArxivResponse,
} from "./arxiv.js";

export const MAX_PDF_BYTES = 40 * 1024 * 1024; // 40 MB: past this it is a book scan
const FETCH_TIMEOUT_MS = 25_000;
// Unpaywall requires an email in the query string. It identifies the caller; it is
// not authentication. Deployments should set their own.
const CONTACT_EMAIL = process.env.OA_CONTACT_EMAIL || "hello@lattice.app";

/** A DOI minted by arXiv itself: 10.48550/arXiv.2401.01234 */
function arxivIdFromDoi(doi) {
  const m = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
  return m ? m[1].replace(/v\d+$/i, "") : "";
}

// ---------------------------------------------------------------------------
// Candidate discovery
// ---------------------------------------------------------------------------

async function unpaywallCandidates(doi) {
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(CONTACT_EMAIL)}`;
  const res = await rateLimited("unpaywall", 1000, () =>
    fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } })
  );
  if (!res.ok) return [];
  const body = await res.json();
  const locations = [body.best_oa_location, ...(body.oa_locations || [])].filter(Boolean);
  return locations.flatMap((location) => {
    const found = [];
    if (location.url_for_pdf) found.push({ url: location.url_for_pdf, via: "unpaywall" });
    // A landing page is worth trying only when it is itself a PDF link.
    if (location.url && /\.pdf($|\?)/i.test(location.url)) {
      found.push({ url: location.url, via: "unpaywall" });
    }
    return found;
  });
}

async function openAlexCandidates(doi) {
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
  const res = await rateLimited("openalex", 1000, () =>
    fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } })
  );
  if (!res.ok) return [];
  const body = await res.json();
  const locations = [body.best_oa_location, body.primary_location, ...(body.locations || [])].filter(Boolean);
  return locations
    .filter((location) => location.pdf_url)
    .map((location) => ({ url: location.pdf_url, via: "openalex" }));
}

async function crossrefCandidates(doi) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const res = await rateLimited("crossref", 1000, () =>
    fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } })
  );
  if (!res.ok) return [];
  const body = await res.json();
  const links = body?.message?.link || [];
  return links
    .filter((link) => /pdf/i.test(link["content-type"] || "") || /\.pdf($|\?)/i.test(link.URL || ""))
    .map((link) => ({ url: clean(link.URL || ""), via: "crossref" }))
    .filter((candidate) => candidate.url);
}

/**
 * Every PDF URL worth trying for this paper, best first and de-duplicated.
 * Sources that fail are skipped: one index being down should not stop the others.
 */
export async function pdfCandidates({ doi = "", arxivId = "", url = "" } = {}) {
  const candidates = [];
  const cleanDoi = normalizeDoi(doi);
  const cleanArxiv = extractArxivId(arxivId) || arxivIdFromDoi(cleanDoi);

  if (cleanArxiv) {
    candidates.push({ url: `https://arxiv.org/pdf/${cleanArxiv}`, via: "arxiv" });
  }
  if (looksLikeDoi(cleanDoi)) {
    for (const lookup of [unpaywallCandidates, openAlexCandidates, crossrefCandidates]) {
      try {
        candidates.push(...(await lookup(cleanDoi)));
      } catch {
        // An index that is unreachable or rate-limiting just contributes nothing.
      }
    }
  }
  // A URL the user already has, when it is unmistakably a file rather than a page.
  if (url && /\.pdf($|\?)/i.test(url)) candidates.push({ url, via: "record" });

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.url.replace(/^http:/, "https:");
    if (seen.has(key) || !isFetchableUrl(candidate.url)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Whether a URL handed to us by an upstream index is safe to request.
 *
 * The candidate URLs are not user input, but they are third-party input, so the
 * server must not be talked into requesting its own network: only http(s), and
 * never a loopback, link-local, or private address.
 */
export function isFetchableUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false; // cloud metadata endpoints
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

async function downloadPdf(url) {
  const request = () =>
    fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  // arXiv counts PDF downloads against the same per-network allowance as its API, so
  // they wait in the same queue. Unpaced, "Fetch PDFs" over a project of preprints
  // was enough to get the whole network refused, metadata lookups included.
  const arxiv = isArxivHost(url);
  const res = arxiv ? await rateLimited(ARXIV_QUEUE, arxivIntervalMs(), request) : await request();
  if (arxiv && noteArxivResponse(res)) {
    const err = new Error(`Responded ${res.status}.`);
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Responded ${res.status}.`);

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > MAX_PDF_BYTES) throw new Error("That PDF is too large to store.");

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) throw new Error("That PDF is too large to store.");
  // Repositories routinely answer a PDF request with an HTML interstitial or a
  // login wall and a 200, so the bytes themselves decide, not the content type.
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("That link returned a web page rather than a PDF.");
  }
  return bytes;
}

/**
 * The first candidate that actually yields a PDF.
 * Returns { bytes, url, via }, or throws when no open-access copy is reachable.
 */
export async function fetchOpenAccessPdf(record) {
  const key = JSON.stringify([record.doi || "", record.arxivId || "", record.url || ""]);
  const cachedFailure = cacheGet("oa-miss", key);
  if (cachedFailure) throw new Error(cachedFailure);

  const candidates = await pdfCandidates(record);
  if (!candidates.length) {
    const message =
      "No open-access PDF is listed for this paper. If you have access, attach the file yourself.";
    cacheSet("oa-miss", key, message);
    throw new Error(message);
  }

  const failures = [];
  let arxivBusy = false;
  let transient = false;
  for (const candidate of candidates) {
    // While arXiv is backing off its copy is skipped, not requested: asking would only
    // extend the limit, and another index may still have the paper.
    if (isArxivHost(candidate.url) && cooldownRemaining(ARXIV_QUEUE) > 0) {
      arxivBusy = true;
      failures.push(`${candidate.via}: skipped while arXiv is backing off`);
      continue;
    }
    try {
      const bytes = await downloadPdf(candidate.url);
      return { bytes, url: candidate.url, via: candidate.via };
    } catch (error) {
      if (error.rateLimited) arxivBusy = true;
      if (error.rateLimited || error.name === "TimeoutError") transient = true;
      failures.push(`${candidate.via}: ${error.message}`);
    }
  }
  console.error("open-access pdf:", failures.join(" | "));

  // Neither of these is cached. The paper has a copy; it just could not be reached
  // this minute, and remembering that as "no PDF" would block the retry that works.
  if (arxivBusy) {
    const wait = arxivWaitSeconds();
    const err = new Error(
      "arXiv is limiting requests from your network right now, so the PDF could not be " +
        `fetched. Try again in ${wait > 0 ? `about ${wait} seconds` : "a minute"}.`
    );
    err.status = 503;
    throw err;
  }
  if (transient) {
    const err = new Error("The PDF host did not respond in time. Try again shortly.");
    err.status = 503;
    throw err;
  }

  // The usual cause is a link that resolves to a publisher's paywall or a login
  // page, so the message says what the user can actually do about it.
  const message =
    "The links listed for this paper led to a paywall or a login page rather than a PDF. Attach your own copy if you have access.";
  cacheSet("oa-miss", key, message);
  throw new Error(message);
}
