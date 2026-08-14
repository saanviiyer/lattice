// Server-side PDF text extraction using unpdf (a serverless build of pdf.js — pure JS,
// no native deps). Also attempts metadata: a DOI regex on the text (which the caller
// can resolve via CrossRef), else first-page title/author heuristics.
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export async function extractPdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = typeof text === "string" ? text : (text || []).join("\n");
  return merged.trim();
}

// Find the first DOI mentioned in the text (common on the first page / header).
export function findDoi(text = "") {
  const m = text.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  if (!m) return "";
  // Trim trailing punctuation that regularly clings to inline DOIs.
  return m[0].replace(/[.,;)]+$/, "");
}

const NOISE_LINE =
  /^(abstract|introduction|arxiv|doi|https?:|www\.|keywords|index terms|\d+\s*$)/i;

// Heuristic title/author guess from the first page, used only when there is no DOI.
export function guessMetadata(text = "") {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Title: the first substantial, non-noise line near the top.
  let title = "";
  for (const line of lines.slice(0, 12)) {
    if (line.length >= 12 && line.length <= 220 && !NOISE_LINE.test(line)) {
      title = line;
      break;
    }
  }

  // Authors: a line shortly after the title that reads like a name list.
  let authors = [];
  const titleIdx = title ? lines.indexOf(title) : -1;
  if (titleIdx !== -1) {
    for (const line of lines.slice(titleIdx + 1, titleIdx + 6)) {
      const looksLikeNames =
        /,|\band\b/.test(line) &&
        !/\d/.test(line) &&
        !NOISE_LINE.test(line) &&
        line.length <= 200;
      if (looksLikeNames) {
        authors = line
          .split(/,|\band\b/)
          .map((a) => a.replace(/[\d*†‡§¶]/g, "").trim())
          .filter((a) => a.length >= 3 && a.split(/\s+/).length <= 5);
        if (authors.length) break;
      }
    }
  }

  return { title, authors };
}

// Build a short abstract preview from the extracted text (best-effort).
export function abstractPreview(text = "") {
  const lower = text.toLowerCase();
  const start = lower.indexOf("abstract");
  const slice =
    start !== -1 ? text.slice(start + "abstract".length) : text.slice(0, 1200);
  return slice.replace(/\s+/g, " ").trim().slice(0, 900);
}
