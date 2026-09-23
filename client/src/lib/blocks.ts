// Lightweight block model for the Notion-style note editor.
//
// A note body is a series of typed blocks. We DID NOT pull in full TipTap/ProseMirror
// (many packages, heavier to finish reliably on a constrained machine); instead this is
// a small, self-contained block model. Blocks serialize to/from Markdown so the stored
// note body stays a plain string — which keeps [[wikilink]] parsing, backlinks, the
// graph, and the Supabase upgrade path all working on the same text form.

export type BlockType =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "number"
  | "todo"
  | "quote"
  | "code"
  | "divider";

export interface Block {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean; // for todo blocks
  /**
   * Nesting depth for list blocks, 0 for a top-level item. Only list types carry
   * an indent: an indented paragraph is ambiguous in Markdown (four spaces is a
   * code block), so Tab only nests the block types where the meaning is clear.
   */
  indent?: number;
}

/** Deepest nesting Tab will produce. Past this the line has no room left to read. */
export const MAX_INDENT = 6;

/** Whether this block type can be nested with Tab. */
export function isListType(type: BlockType): boolean {
  return type === "bullet" || type === "number" || type === "todo";
}

/** An indent clamped to the legal range, treating undefined as 0. */
export function clampIndent(indent: number | undefined): number {
  if (!indent || indent < 0) return 0;
  return Math.min(Math.round(indent), MAX_INDENT);
}

export function blockId(): string {
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function emptyBlock(type: BlockType = "p"): Block {
  return { id: blockId(), type, text: "" };
}

// The slash-menu command set. `label` shows in the menu; `keywords` widen matching.
export interface SlashCommand {
  type: BlockType;
  label: string;
  hint: string;
  keywords: string[];
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { type: "p", label: "Text", hint: "Plain paragraph", keywords: ["text", "paragraph", "plain"] },
  { type: "h1", label: "Heading 1", hint: "Large heading", keywords: ["h1", "heading", "title"] },
  { type: "h2", label: "Heading 2", hint: "Medium heading", keywords: ["h2", "heading"] },
  { type: "h3", label: "Heading 3", hint: "Small heading", keywords: ["h3", "heading"] },
  { type: "bullet", label: "Bulleted list", hint: "Unordered item", keywords: ["bullet", "list", "ul"] },
  { type: "number", label: "Numbered list", hint: "Ordered item", keywords: ["number", "ordered", "ol"] },
  { type: "todo", label: "To-do", hint: "Checkbox item", keywords: ["todo", "task", "checkbox", "check"] },
  { type: "quote", label: "Quote", hint: "Blockquote", keywords: ["quote", "blockquote"] },
  { type: "code", label: "Code", hint: "Monospace block", keywords: ["code", "monospace", "pre"] },
  { type: "divider", label: "Divider", hint: "Horizontal rule", keywords: ["divider", "hr", "rule", "line"] },
];

// ---- Markdown input rules ----
// The Notion behaviour: typing "- " at the start of a line turns it into a bullet
// there and then, rather than waiting for the note to be re-parsed. The marker is
// consumed and the block changes type.

export interface MarkdownShortcut {
  type: BlockType;
  /** What is left of the line once the marker has been eaten. */
  text: string;
  checked?: boolean;
}

/**
 * The block a line has just become, if its opening characters are a Markdown
 * marker. Returns null for ordinary text.
 *
 * Only matches at the very start of a line, so "5 - 3" and a hyphen mid-sentence
 * are left alone.
 */
export function markdownShortcut(text: string): MarkdownShortcut | null {
  let m: RegExpMatchArray | null;
  // "- [ ] " and "- [x] " are checked before the plain bullet marker, which would
  // otherwise swallow the "- " and leave a literal "[ ]" behind.
  if ((m = text.match(/^[-*+] \[([ xX])\] (.*)$/))) {
    return { type: "todo", text: m[2], checked: m[1].toLowerCase() === "x" };
  }
  if ((m = text.match(/^\[([ xX]?)\] (.*)$/))) {
    return { type: "todo", text: m[2], checked: m[1].toLowerCase() === "x" };
  }
  if (text === "---" || text === "***") return { type: "divider", text: "" };
  if (text === "```") return { type: "code", text: "" };
  if ((m = text.match(/^([-*+]) (.*)$/))) return { type: "bullet", text: m[2] };
  if ((m = text.match(/^\d+[.)] (.*)$/))) return { type: "number", text: m[1] };
  if ((m = text.match(/^(#{1,3}) (.*)$/))) {
    return { type: (["h1", "h2", "h3"] as const)[m[1].length - 1], text: m[2] };
  }
  if ((m = text.match(/^> ?(.*)$/))) return { type: "quote", text: m[1] };
  return null;
}

// ---- Markdown serialization ----
// Nested list items are written with two spaces of indent per level, which is what
// every Markdown renderer reads back as a nested list.
export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  const numbering = listNumbering(blocks);
  for (const b of blocks) {
    const indent = isListType(b.type) ? clampIndent(b.indent) : 0;
    const pad = "  ".repeat(indent);
    const num = numbering.get(b.id) || 1;
    switch (b.type) {
      case "h1":
        out.push(`# ${b.text}`);
        break;
      case "h2":
        out.push(`## ${b.text}`);
        break;
      case "h3":
        out.push(`### ${b.text}`);
        break;
      case "bullet":
        out.push(`${pad}- ${b.text}`);
        break;
      case "number":
        out.push(`${pad}${num}. ${b.text}`);
        break;
      case "todo":
        out.push(`${pad}- [${b.checked ? "x" : " "}] ${b.text}`);
        break;
      case "quote":
        out.push(`> ${b.text}`);
        break;
      case "code":
        out.push("```");
        out.push(b.text);
        out.push("```");
        break;
      case "divider":
        out.push("---");
        break;
      default:
        out.push(b.text);
    }
  }
  return out.join("\n");
}

/**
 * The number shown against each ordered-list block, keyed by block id.
 *
 * The editor and the Markdown serializer have to agree on this, so both read it
 * from here: counting restarts when a run goes deeper and resumes when it comes
 * back out, so 1. / 2. at the top level survives a nested a. b. c. in between.
 */
export function listNumbering(blocks: Block[]): Map<string, number> {
  const map = new Map<string, number>();
  const counters: number[] = [];
  for (const b of blocks) {
    const indent = isListType(b.type) ? clampIndent(b.indent) : 0;
    if (b.type === "number") {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] || 0) + 1;
      map.set(b.id, counters[indent]);
    } else if (b.type === "bullet" || b.type === "todo") {
      counters.length = indent;
    } else {
      counters.length = 0;
    }
  }
  return map;
}

// ---- Markdown parsing ----
export function markdownToBlocks(md: string): Block[] {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: consume until the closing fence.
    if (line.trim() === "```") {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "```") {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ id: blockId(), type: "code", text: body.join("\n") });
      continue;
    }

    if (line.trim() === "---" || line.trim() === "***") {
      blocks.push({ id: blockId(), type: "divider", text: "" });
      i++;
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const t = (["h1", "h2", "h3"] as const)[m[1].length - 1];
      blocks.push({ id: blockId(), type: t, text: m[2] });
    } else if ((m = line.match(/^([ \t]*)[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      blocks.push({
        id: blockId(),
        type: "todo",
        text: m[3],
        checked: m[2].toLowerCase() === "x",
        indent: indentOf(m[1]),
      });
    } else if ((m = line.match(/^([ \t]*)[-*]\s+(.*)$/))) {
      blocks.push({ id: blockId(), type: "bullet", text: m[2], indent: indentOf(m[1]) });
    } else if ((m = line.match(/^([ \t]*)\d+\.\s+(.*)$/))) {
      blocks.push({ id: blockId(), type: "number", text: m[2], indent: indentOf(m[1]) });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      blocks.push({ id: blockId(), type: "quote", text: m[1] });
    } else {
      blocks.push({ id: blockId(), type: "p", text: line });
    }
    i++;
  }

  if (blocks.length === 0) blocks.push(emptyBlock("p"));
  return blocks;
}

// Two spaces per level on the way out; on the way back in, accept anything a
// person or another editor might have written (tabs, four spaces, odd counts).
function indentOf(prefix: string): number {
  const columns = prefix.replace(/\t/g, "  ").length;
  return clampIndent(Math.floor(columns / 2));
}
