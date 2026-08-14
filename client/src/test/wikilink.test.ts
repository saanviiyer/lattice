import { describe, it, expect } from "vitest";
import {
  matchWikilinks,
  parseWikilinks,
  normalizeTitle,
} from "../lib/wikilink";

describe("parseWikilinks", () => {
  it("extracts a single link target", () => {
    expect(parseWikilinks("See [[Attention Is All You Need]] for details.")).toEqual([
      "Attention Is All You Need",
    ]);
  });

  it("extracts multiple targets in order", () => {
    const body = "Compare [[BERT]] and [[GPT-3]] and also [[BERT]] again.";
    expect(parseWikilinks(body)).toEqual(["BERT", "GPT-3"]);
  });

  it("handles the [[Target|Alias]] form and returns the target, not the alias", () => {
    expect(parseWikilinks("Read [[Deep Residual Learning|ResNet]].")).toEqual([
      "Deep Residual Learning",
    ]);
  });

  it("deduplicates case- and whitespace-insensitively", () => {
    expect(parseWikilinks("[[Graph  Nets]] and [[graph nets]]")).toEqual([
      "Graph  Nets",
    ]);
  });

  it("ignores empty and unterminated links", () => {
    expect(parseWikilinks("[[]] and [[ unclosed and [[ok]]")).toEqual(["ok"]);
  });

  it("returns [] for text with no links", () => {
    expect(parseWikilinks("plain text, no links")).toEqual([]);
  });
});

describe("matchWikilinks", () => {
  it("captures raw text, alias, and index", () => {
    const matches = matchWikilinks("x [[A|a]] y [[B]]");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ target: "A", alias: "a", raw: "[[A|a]]", index: 2 });
    expect(matches[1]).toMatchObject({ target: "B", alias: undefined, raw: "[[B]]" });
  });
});

describe("normalizeTitle", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeTitle("  The   Bitter  Lesson ")).toBe("the bitter lesson");
  });
});
