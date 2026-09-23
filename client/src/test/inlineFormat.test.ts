import { describe, it, expect } from "vitest";
import { markForShortcut, toggleMark, toggleWikilink } from "../lib/inlineFormat";

/** Write a case as "before" with the selection marked by | … |. */
function run(input: string, mark: Parameters<typeof toggleMark>[3]) {
  const start = input.indexOf("|");
  const end = input.lastIndexOf("|") - 1;
  const text = input.replace(/\|/g, "");
  const result = toggleMark(text, start, end, mark);
  const marked =
    result.text.slice(0, result.selectionStart) +
    "|" + result.text.slice(result.selectionStart, result.selectionEnd) + "|" +
    result.text.slice(result.selectionEnd);
  return marked;
}

describe("toggleMark", () => {
  it("bolds a selection and keeps it selected", () => {
    expect(run("the |quick| fox", "bold")).toBe("the **|quick|** fox");
  });

  it("italicises and codes a selection", () => {
    expect(run("the |quick| fox", "italic")).toBe("the *|quick|* fox");
    expect(run("the |quick| fox", "code")).toBe("the `|quick|` fox");
  });

  it("removes the mark when the selection includes the delimiters", () => {
    expect(run("the |**quick**| fox", "bold")).toBe("the |quick| fox");
  });

  it("removes the mark when the delimiters sit just outside the selection", () => {
    expect(run("the **|quick|** fox", "bold")).toBe("the |quick| fox");
  });

  it("does not read bold as italic and half-undo it", () => {
    // The selection sits inside **…**; asking for italic must add italic, not
    // strip one asterisk from each side and leave broken markup.
    expect(run("the **|quick|** fox", "italic")).toBe("the ***|quick|*** fox");
  });

  it("keeps trailing spaces outside the marks", () => {
    // "** bold **" is not bold in any renderer.
    expect(run("the |quick |fox", "bold")).toBe("the **|quick|** fox");
  });

  it("inserts an empty pair and puts the caret inside for an empty selection", () => {
    const result = toggleMark("abc", 1, 1, "bold");
    expect(result.text).toBe("a****bc");
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(3);
  });

  it("leaves a whitespace-only selection alone", () => {
    const result = toggleMark("a   b", 1, 4, "bold");
    expect(result.text).toBe("a   b");
  });

  it("round-trips: marking then unmarking restores the original", () => {
    const original = "the quick fox";
    const on = toggleMark(original, 4, 9, "bold");
    const off = toggleMark(on.text, on.selectionStart, on.selectionEnd, "bold");
    expect(off.text).toBe(original);
    expect(off.selectionStart).toBe(4);
    expect(off.selectionEnd).toBe(9);
  });
});

describe("toggleWikilink", () => {
  it("wraps a selection", () => {
    const result = toggleWikilink("see Attention here", 4, 13);
    expect(result.text).toBe("see [[Attention]] here");
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe("Attention");
  });

  it("unwraps when the brackets are inside or outside the selection", () => {
    expect(toggleWikilink("see [[Attention]] here", 4, 17).text).toBe("see Attention here");
    expect(toggleWikilink("see [[Attention]] here", 6, 15).text).toBe("see Attention here");
  });

  it("inserts empty brackets with the caret between them", () => {
    const result = toggleWikilink("see ", 4, 4);
    expect(result.text).toBe("see [[]]");
    expect(result.selectionStart).toBe(6);
  });
});

describe("markForShortcut", () => {
  it("maps the keys people already know", () => {
    expect(markForShortcut("b")).toBe("bold");
    expect(markForShortcut("I")).toBe("italic");
    expect(markForShortcut("e")).toBe("code");
    expect(markForShortcut("k")).toBe("link");
    expect(markForShortcut("q")).toBeNull();
  });
});
