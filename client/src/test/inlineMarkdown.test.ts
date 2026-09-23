import { describe, it, expect } from "vitest";
import { parseInlineMarkdown } from "../lib/inlineMarkdown";

describe("parseInlineMarkdown", () => {
  it("returns plain text as a single token", () => {
    expect(parseInlineMarkdown("no marks here")).toEqual([
      { type: "text", value: "no marks here" },
    ]);
  });

  it("splits bold out of surrounding text", () => {
    expect(parseInlineMarkdown("see **Attention** now")).toEqual([
      { type: "text", value: "see " },
      { type: "bold", value: "Attention" },
      { type: "text", value: " now" },
    ]);
  });

  it("prefers bold over italic for a double star", () => {
    expect(parseInlineMarkdown("**x**")).toEqual([{ type: "bold", value: "x" }]);
  });

  it("reads single stars as italic", () => {
    expect(parseInlineMarkdown("an *aside* here")).toEqual([
      { type: "text", value: "an " },
      { type: "italic", value: "aside" },
      { type: "text", value: " here" },
    ]);
  });

  it("reads backticks as code", () => {
    expect(parseInlineMarkdown("run `npm test`")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "npm test" },
    ]);
  });

  it("handles several marks in one string", () => {
    expect(parseInlineMarkdown("**a** and **b**")).toEqual([
      { type: "bold", value: "a" },
      { type: "text", value: " and " },
      { type: "bold", value: "b" },
    ]);
  });

  it("leaves an unclosed mark as literal text", () => {
    expect(parseInlineMarkdown("**unclosed")).toEqual([
      { type: "text", value: "**unclosed" },
    ]);
  });

  it("does not let an italic run across a line break", () => {
    expect(parseInlineMarkdown("*a\nb*")).toEqual([{ type: "text", value: "*a\nb*" }]);
  });

  it("returns nothing for an empty string", () => {
    expect(parseInlineMarkdown("")).toEqual([]);
  });
});
