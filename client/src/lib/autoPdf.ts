// Bringing in the PDF for a paper that was added by DOI or arXiv id.
//
// Adding a reference and being able to read it were two separate errands before
// this: look the paper up, then go and find the file, then come back and attach
// it. When an open-access copy exists, the app does that second trip itself.
//
// The result is indistinguishable from a file the user attached by hand — the
// bytes land in IndexedDB, the searchable text is extracted the same way, and the
// annotation surface opens on it. Only open-access copies are reachable; a
// paywalled paper still needs the user's own file.

import { canFetchPdf, fetchOpenAccessPdf, metadataFromPdf } from "./api";
import { putPdf } from "./blobStore";
import { repo } from "./repository";

export interface AttachedPdf {
  /** The URL the file came from, for the confirmation message. */
  source: string;
  /** Which index found it: arxiv, unpaywall, openalex, crossref, record. */
  via: string;
}

/** Whether this paper is a candidate for an automatic fetch. */
export function canAutoAttach(paperId: string): boolean {
  const paper = repo.getPaper(paperId);
  return !!paper && !paper.hasPdf && canFetchPdf(paper);
}

/**
 * Fetch and attach an open-access PDF for a paper. Throws with a message worth
 * showing when there is nothing to fetch.
 */
export async function attachOpenAccessPdf(paperId: string): Promise<AttachedPdf> {
  const paper = repo.getPaper(paperId);
  if (!paper) throw new Error("That paper is no longer in the library.");
  if (paper.hasPdf) throw new Error("This paper already has a PDF attached.");
  if (!canFetchPdf(paper)) {
    throw new Error("This paper has no DOI or arXiv id, so there is nothing to look up.");
  }

  const found = await fetchOpenAccessPdf(paper);
  await putPdf(paperId, found.blob);

  // The same text extraction a hand-attached PDF gets, so search and the AI
  // actions work on it. A failure here costs searchable text, not the document.
  let pdfText = paper.pdfText;
  try {
    const file = new File([found.blob], `${paperId}.pdf`, { type: "application/pdf" });
    pdfText = (await metadataFromPdf(file)).paper.pdfText || pdfText;
  } catch {
    // Offline, or a scanned PDF with no text layer. Annotation still works.
  }

  repo.updatePaper(paperId, { hasPdf: true, pdfText });
  return { source: found.source, via: found.via };
}

/**
 * Attach PDFs for many papers, one at a time.
 *
 * Sequential on purpose: these calls hit shared public indexes that ask to be
 * treated politely, and a parallel burst across a whole collection is exactly
 * what their rate limits are there to stop. `onProgress` reports after each so a
 * long backfill can show where it has got to.
 */
export async function attachOpenAccessPdfs(
  paperIds: string[],
  onProgress?: (done: number, total: number, attached: number) => void
): Promise<{ attached: number; skipped: number }> {
  let attached = 0;
  let done = 0;
  for (const id of paperIds) {
    try {
      await attachOpenAccessPdf(id);
      attached += 1;
    } catch {
      // A paper with no open-access copy is skipped, not an error for the batch.
    }
    done += 1;
    onProgress?.(done, paperIds.length, attached);
  }
  return { attached, skipped: paperIds.length - attached };
}
