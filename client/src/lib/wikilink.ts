// Wikilink parsing. lattice notes link papers and other notes with [[Target]] or
// [[Target|Alias]] syntax (Obsidian-style). These helpers are pure so they can be
// unit-tested and reused by the editor, the backlinks panel, and the graph builder.

// Matches [[Target]] and [[Target|Alias]]. The target is everything up to a "|" or
// the closing "]]". We deliberately do not match across "]]", "[", or newlines, so an
// unterminated "[[ ..." is skipped rather than swallowing a later valid link.
const WIKILINK_RE = /\[\[([^\][|\n]+?)(?:\|([^\][\n]*?))?\]\]/g;

export interface WikilinkMatch {
  target: string; // the link target (trimmed), before any "|alias"
  alias?: string; // optional display alias
  raw: string; // the full "[[...]]" text
  index: number; // start offset in the source string
}

// Return every wikilink match in order of appearance (including duplicates).
export function matchWikilinks(text: string): WikilinkMatch[] {
  const out: WikilinkMatch[] = [];
  if (!text) return out;
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    const alias = m[2] != null ? m[2].trim() : undefined;
    out.push({ target, alias: alias || undefined, raw: m[0], index: m.index });
  }
  return out;
}

// Return the unique set of link targets, in first-seen order (case preserved).
export function parseWikilinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { target } of matchWikilinks(text)) {
    const key = normalizeTitle(target);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

// Normalize a title/target for case- and whitespace-insensitive matching.
export function normalizeTitle(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
