import type { Paper, PaperMetadata } from "../types";

export function mergeImportedMetadata(
  existing: Paper,
  incoming: PaperMetadata,
  additions: { collectionIds?: string[]; tags?: string[]; hasPdf?: boolean } = {}
): Partial<Paper> {
  return {
    title: existing.title || incoming.title,
    authors: existing.authors.length ? existing.authors : incoming.authors,
    year: existing.year ?? incoming.year,
    venue: existing.venue || incoming.venue,
    abstract: existing.abstract || incoming.abstract,
    doi: existing.doi || incoming.doi,
    url: existing.url || incoming.url,
    arxivId: existing.arxivId || incoming.arxivId,
    pdfText: existing.pdfText || incoming.pdfText,
    itemType: existing.itemType || incoming.itemType,
    source: existing.source === "manual" && incoming.source !== "manual" ? incoming.source : existing.source,
    collectionIds: Array.from(new Set([...existing.collectionIds, ...(additions.collectionIds || [])])),
    tags: Array.from(new Set([...existing.tags, ...(additions.tags || [])])),
    hasPdf: existing.hasPdf || additions.hasPdf || false,
  };
}
