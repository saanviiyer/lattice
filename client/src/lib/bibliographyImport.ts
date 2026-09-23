import type { PaperMetadata } from "../types";

export interface BibliographyRecord {
  metadata: PaperMetadata;
  tags: string[];
}

function clean(value = "") {
  return value
    .replace(/[{}]/g, "")
    .replace(/\\([&%#$])/g, "$1")
    .replace(/\\textit|\\emph/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthor(author: string) {
  const parts = clean(author).split(",").map((part) => part.trim());
  return parts.length === 2 ? `${parts[1]} ${parts[0]}`.trim() : parts[0];
}

function itemTypeFromBib(type: string): PaperMetadata["itemType"] {
  if (type === "inproceedings" || type === "conference") return "conferencePaper";
  if (type === "book" || type === "inbook") return "book";
  if (type === "phdthesis" || type === "mastersthesis") return "thesis";
  if (type === "misc" || type === "online") return "webpage";
  return "journalArticle";
}

function parseBibFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let cursor = body.indexOf(",") + 1;
  while (cursor > 0 && cursor < body.length) {
    while (/[,\s]/.test(body[cursor] || "")) cursor += 1;
    const keyStart = cursor;
    while (/[a-z0-9_-]/i.test(body[cursor] || "")) cursor += 1;
    const key = body.slice(keyStart, cursor).toLowerCase();
    while (/\s/.test(body[cursor] || "")) cursor += 1;
    if (!key || body[cursor] !== "=") break;
    cursor += 1;
    while (/\s/.test(body[cursor] || "")) cursor += 1;
    let value = "";
    if (body[cursor] === "{") {
      cursor += 1;
      const start = cursor;
      let depth = 1;
      while (cursor < body.length && depth > 0) {
        if (body[cursor] === "{") depth += 1;
        else if (body[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      value = body.slice(start, cursor - 1);
    } else if (body[cursor] === '"') {
      cursor += 1;
      const start = cursor;
      while (cursor < body.length && (body[cursor] !== '"' || body[cursor - 1] === "\\")) cursor += 1;
      value = body.slice(start, cursor);
      cursor += 1;
    } else {
      const start = cursor;
      while (cursor < body.length && body[cursor] !== ",") cursor += 1;
      value = body.slice(start, cursor);
    }
    fields[key] = clean(value);
  }
  return fields;
}

export function parseBibTeX(input: string): BibliographyRecord[] {
  const records: BibliographyRecord[] = [];
  let cursor = 0;
  while ((cursor = input.indexOf("@", cursor)) !== -1) {
    const typeMatch = input.slice(cursor).match(/^@([a-z]+)\s*[{(]/i);
    if (!typeMatch) { cursor += 1; continue; }
    const type = typeMatch[1].toLowerCase();
    const open = cursor + typeMatch[0].length - 1;
    const openChar = input[open];
    const closeChar = openChar === "{" ? "}" : ")";
    let depth = 1;
    let end = open + 1;
    while (end < input.length && depth > 0) {
      if (input[end] === openChar) depth += 1;
      else if (input[end] === closeChar) depth -= 1;
      end += 1;
    }
    const fields = parseBibFields(input.slice(open + 1, end - 1));
    if (fields.title) {
      const venue = fields.journal || fields.booktitle || fields.publisher || fields.school || "";
      const yearMatch = (fields.year || fields.date || "").match(/\d{4}/);
      records.push({
        metadata: {
          itemType: type === "misc" && (fields.eprint || fields.archiveprefix) ? "preprint" : itemTypeFromBib(type),
          title: fields.title,
          authors: (fields.author || "").split(/\s+and\s+/i).map(normalizeAuthor).filter(Boolean),
          year: yearMatch ? Number(yearMatch[0]) : null,
          venue,
          abstract: fields.abstract || fields.annote || "",
          doi: fields.doi || "",
          url: fields.url || "",
          arxivId: fields.eprint || undefined,
          source: "manual",
        },
        tags: (fields.keywords || "").split(/[,;]/).map(clean).filter(Boolean),
      });
    }
    cursor = Math.max(end, cursor + 1);
  }
  return records;
}

function itemTypeFromRis(type: string): PaperMetadata["itemType"] {
  if (["CPAPER", "CONF"].includes(type)) return "conferencePaper";
  if (["BOOK", "CHAP"].includes(type)) return "book";
  if (["THES"].includes(type)) return "thesis";
  if (["ELEC", "WEB"].includes(type)) return "webpage";
  if (["UNPB"].includes(type)) return "preprint";
  return "journalArticle";
}

export function parseRis(input: string): BibliographyRecord[] {
  const records: BibliographyRecord[] = [];
  let fields = new Map<string, string[]>();
  function finish() {
    const first = (...keys: string[]) => keys.flatMap((key) => fields.get(key) || [])[0] || "";
    const title = first("TI", "T1", "CT");
    if (title) {
      const rawYear = first("PY", "Y1", "DA");
      const year = rawYear.match(/\d{4}/)?.[0];
      records.push({
        metadata: {
          itemType: itemTypeFromRis(first("TY").toUpperCase()),
          title: clean(title),
          authors: [...(fields.get("AU") || []), ...(fields.get("A1") || [])].map(normalizeAuthor),
          year: year ? Number(year) : null,
          venue: clean(first("JO", "JF", "T2", "PB")),
          abstract: clean(first("AB", "N2")),
          doi: clean(first("DO")),
          url: clean(first("UR", "L1")),
          source: "manual",
        },
        tags: (fields.get("KW") || []).map(clean).filter(Boolean),
      });
    }
    fields = new Map();
  }
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9]{2})\s{0,2}-\s?(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "ER") { finish(); continue; }
    fields.set(key, [...(fields.get(key) || []), value]);
  }
  if (fields.size) finish();
  return records;
}

export function parseBibliography(input: string, filename = ""): BibliographyRecord[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ris") || /^TY\s{0,2}-/m.test(input)) return parseRis(input);
  return parseBibTeX(input);
}
