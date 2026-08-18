import { describe, expect, it } from "vitest";
import {
  buildClipping,
  isValidClipping,
  normalizeExcerpt,
  validateClipping,
} from "../src/lib/clipping.js";

describe("buildClipping", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");

  it("normalizes fields and stamps savedAt", () => {
    const c = buildClipping(
      {
        url: "  https://example.com/post  ",
        title: "  A Great Article  ",
        excerpt: "  the   selected    text  ",
        collection: "  Reading list ",
        note: "  worth revisiting ",
      },
      now
    );
    expect(c).toEqual({
      url: "https://example.com/post",
      title: "A Great Article",
      excerpt: "the selected text",
      collection: "Reading list",
      note: "worth revisiting",
      savedAt: "2026-08-17T12:00:00.000Z",
    });
  });

  it("prefers the selection but falls back to the page description", () => {
    const withSel = buildClipping(
      { url: "https://x.io", title: "T", excerpt: "chosen", description: "page summary" },
      now
    );
    expect(withSel.excerpt).toBe("chosen");

    const noSel = buildClipping(
      { url: "https://x.io", title: "T", excerpt: "   ", description: "page summary" },
      now
    );
    expect(noSel.excerpt).toBe("page summary");
  });

  it("falls back to the URL when the title is empty", () => {
    const c = buildClipping({ url: "https://x.io/a", title: "" }, now);
    expect(c.title).toBe("https://x.io/a");
  });
});

describe("normalizeExcerpt", () => {
  it("collapses whitespace and truncates long text", () => {
    expect(normalizeExcerpt("a\n\n  b\tc")).toBe("a b c");
    const long = "x".repeat(2500);
    const out = normalizeExcerpt(long, 100);
    expect(out.length).toBe(101); // 100 chars + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("validateClipping", () => {
  const base = {
    url: "https://example.com",
    title: "T",
    excerpt: "",
    note: "",
    collection: "",
    savedAt: "2026-08-17T12:00:00.000Z",
  };

  it("accepts a well-formed clipping", () => {
    expect(validateClipping(base)).toEqual([]);
    expect(isValidClipping(base)).toBe(true);
  });

  it("rejects a missing or non-http url", () => {
    expect(validateClipping({ ...base, url: "" })).toContain("A URL is required.");
    expect(validateClipping({ ...base, url: "ftp://nope" })).toContain(
      "URL must start with http:// or https://."
    );
  });

  it("rejects a missing title", () => {
    expect(validateClipping({ ...base, title: "  " })).toContain("A title is required.");
  });
});
