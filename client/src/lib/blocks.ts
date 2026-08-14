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

// ---- Markdown serialization ----
export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  let num = 0;
  for (const b of blocks) {
    num = b.type === "number" ? num + 1 : 0;
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
        out.push(`- ${b.text}`);
        break;
      case "number":
        out.push(`${num}. ${b.text}`);
        break;
      case "todo":
        out.push(`- [${b.checked ? "x" : " "}] ${b.text}`);
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
    } else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      blocks.push({
        id: blockId(),
        type: "todo",
        text: m[2],
        checked: m[1].toLowerCase() === "x",
      });
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      blocks.push({ id: blockId(), type: "bullet", text: m[1] });
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      blocks.push({ id: blockId(), type: "number", text: m[1] });
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
