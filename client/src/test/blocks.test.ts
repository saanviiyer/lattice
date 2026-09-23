import { describe, it, expect } from "vitest";
import {
  blocksToMarkdown,
  clampIndent,
  listNumbering,
  markdownShortcut,
  markdownToBlocks,
  MAX_INDENT,
  type Block,
} from "../lib/blocks";

// Strip the random ids so we can compare block structure/content directly.
function shape(blocks: Block[]) {
  return blocks.map(({ type, text, checked }) =>
    checked === undefined ? { type, text } : { type, text, checked }
  );
}

// Same, but keeping the nesting depth, for the indentation tests.
function nesting(blocks: Block[]) {
  return blocks.map(({ type, text, indent }) => ({ type, text, indent: indent || 0 }));
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

describe("nested lists", () => {
  it("reads two spaces per level as one indent level", () => {
    const md = ["- top", "  - child", "    - grandchild", "- back to top"].join("\n");
    expect(nesting(markdownToBlocks(md))).toEqual([
      { type: "bullet", text: "top", indent: 0 },
      { type: "bullet", text: "child", indent: 1 },
      { type: "bullet", text: "grandchild", indent: 2 },
      { type: "bullet", text: "back to top", indent: 0 },
    ]);
  });

  it("reads tabs and four-space indents written by other editors", () => {
    expect(nesting(markdownToBlocks("- a\n\t- b\n    - c"))).toEqual([
      { type: "bullet", text: "a", indent: 0 },
      { type: "bullet", text: "b", indent: 1 },
      { type: "bullet", text: "c", indent: 2 },
    ]);
  });

  it("nests to-dos and numbered items too", () => {
    expect(nesting(markdownToBlocks("1. one\n  1. sub\n- [x] done\n  - [ ] subtask"))).toEqual([
      { type: "number", text: "one", indent: 0 },
      { type: "number", text: "sub", indent: 1 },
      { type: "todo", text: "done", indent: 0 },
      { type: "todo", text: "subtask", indent: 1 },
    ]);
  });

  it("round-trips a nested list unchanged", () => {
    const md = [
      "- outer",
      "  - inner",
      "    - deepest",
      "  - inner again",
      "- outer again",
    ].join("\n");
    expect(blocksToMarkdown(markdownToBlocks(md))).toBe(md);
  });

  it("clamps an indent past the maximum", () => {
    expect(clampIndent(99)).toBe(MAX_INDENT);
    expect(clampIndent(-3)).toBe(0);
    expect(clampIndent(undefined)).toBe(0);
  });

  it("ignores an indent on a block type that cannot nest", () => {
    const blocks: Block[] = [
      { id: "a", type: "h2", text: "Heading", indent: 3 },
      { id: "b", type: "quote", text: "Quoted", indent: 2 },
    ];
    expect(blocksToMarkdown(blocks)).toBe("## Heading\n> Quoted");
  });
});

describe("ordered-list numbering", () => {
  it("restarts a nested run and resumes the outer one after it", () => {
    const blocks = markdownToBlocks(
      ["1. first", "  1. nested one", "  2. nested two", "2. second"].join("\n")
    );
    expect([...listNumbering(blocks).values()]).toEqual([1, 1, 2, 2]);
    expect(blocksToMarkdown(blocks)).toBe(
      ["1. first", "  1. nested one", "  2. nested two", "2. second"].join("\n")
    );
  });

  it("keeps the outer count across a nested bullet", () => {
    const blocks = markdownToBlocks(["1. first", "  - a note", "2. second"].join("\n"));
    expect(blocksToMarkdown(blocks)).toBe(["1. first", "  - a note", "2. second"].join("\n"));
  });

  it("restarts the count after a paragraph breaks the list", () => {
    const blocks = markdownToBlocks(["1. first", "prose", "1. fresh start"].join("\n"));
    expect(blocksToMarkdown(blocks)).toBe(["1. first", "prose", "1. fresh start"].join("\n"));
  });
});

describe("markdownShortcut", () => {
  it("turns a dash or a star into a bullet", () => {
    expect(markdownShortcut("- ")).toEqual({ type: "bullet", text: "" });
    expect(markdownShortcut("* ")).toEqual({ type: "bullet", text: "" });
    expect(markdownShortcut("- already typed")).toEqual({ type: "bullet", text: "already typed" });
  });

  it("recognises the other block markers", () => {
    expect(markdownShortcut("# ")).toEqual({ type: "h1", text: "" });
    expect(markdownShortcut("### heading")).toEqual({ type: "h3", text: "heading" });
    expect(markdownShortcut("1. ")).toEqual({ type: "number", text: "" });
    expect(markdownShortcut("2) second")).toEqual({ type: "number", text: "second" });
    expect(markdownShortcut("> quoted")).toEqual({ type: "quote", text: "quoted" });
    expect(markdownShortcut("---")).toEqual({ type: "divider", text: "" });
    expect(markdownShortcut("```")).toEqual({ type: "code", text: "" });
  });

  it("recognises both to-do spellings and keeps the checked state", () => {
    expect(markdownShortcut("[] task")).toEqual({ type: "todo", text: "task", checked: false });
    expect(markdownShortcut("[ ] task")).toEqual({ type: "todo", text: "task", checked: false });
    expect(markdownShortcut("[x] task")).toEqual({ type: "todo", text: "task", checked: true });
    expect(markdownShortcut("- [x] task")).toEqual({ type: "todo", text: "task", checked: true });
  });

  it("leaves ordinary text alone", () => {
    expect(markdownShortcut("just typing")).toBeNull();
    expect(markdownShortcut("5 - 3 = 2")).toBeNull();
    expect(markdownShortcut("-no space")).toBeNull();
    expect(markdownShortcut("")).toBeNull();
    expect(markdownShortcut("#### too deep")).toBeNull();
  });
});
