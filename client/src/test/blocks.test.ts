import { describe, it, expect } from "vitest";
import {
  blocksToMarkdown,
  markdownToBlocks,
  type Block,
} from "../lib/blocks";

// Strip the random ids so we can compare block structure/content directly.
function shape(blocks: Block[]) {
  return blocks.map(({ type, text, checked }) =>
    checked === undefined ? { type, text } : { type, text, checked }
  );
}

describe("markdownToBlocks", () => {
  it("parses each block type", () => {
    const md = [
      "# Title",
      "## Sub",
      "### Small",
      "- a bullet",
      "1. first",
      "2. second",
      "- [ ] open task",
      "- [x] done task",
      "> a quote",
      "```",
      "const x = 1;",
      "```",
      "---",
      "plain paragraph",
    ].join("\n");
    expect(shape(markdownToBlocks(md))).toEqual([
      { type: "h1", text: "Title" },
      { type: "h2", text: "Sub" },
      { type: "h3", text: "Small" },
      { type: "bullet", text: "a bullet" },
      { type: "number", text: "first" },
      { type: "number", text: "second" },
      { type: "todo", text: "open task", checked: false },
      { type: "todo", text: "done task", checked: true },
      { type: "quote", text: "a quote" },
      { type: "code", text: "const x = 1;" },
      { type: "divider", text: "" },
      { type: "p", text: "plain paragraph" },
    ]);
  });

  it("returns a single empty paragraph for empty input", () => {
    expect(shape(markdownToBlocks(""))).toEqual([{ type: "p", text: "" }]);
  });

  it("preserves a wikilink in a paragraph", () => {
    expect(shape(markdownToBlocks("See [[Transformers]] here"))).toEqual([
      { type: "p", text: "See [[Transformers]] here" },
    ]);
  });
});

describe("blocks <-> markdown round-trip", () => {
  it("markdown -> blocks -> markdown is stable", () => {
    const md = [
      "# Notes on [[Attention]]",
      "",
      "- point one",
      "- [x] did it",
      "1. step",
      "> quoted",
      "```",
      "code line",
      "```",
      "---",
      "closing text",
    ].join("\n");
    const round = blocksToMarkdown(markdownToBlocks(md));
    expect(round).toBe(md);
  });

  it("numbers consecutive ordered items on serialization", () => {
    const blocks = markdownToBlocks("3. a\n7. b\n9. c");
    expect(blocksToMarkdown(blocks)).toBe("1. a\n2. b\n3. c");
  });
});
