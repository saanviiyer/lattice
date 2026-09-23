// The theme is a set of CSS variables, so the things worth testing are the choice
// logic and the invariant that every themed token exists in both themes -- a token
// defined only in dark silently falls back to the dark value on a white page.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTheme, readThemeChoice, applyTheme, THEME_CHOICES } from "../lib/theme";

const css = readFileSync(join(__dirname, "../index.css"), "utf8");

function tokensIn(selector: string): Set<string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no block for ${selector}`);
  const block = css.slice(start, css.indexOf("\n}", start));
  return new Set([...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
}

describe("theme tokens", () => {
  it("defines every token in both themes", () => {
    const dark = tokensIn(':root,\n:root[data-theme="dark"]');
    const light = tokensIn(':root[data-theme="light"]');
    // A token missing from light keeps its dark value against a white page.
    expect([...dark].filter((t) => !light.has(t))).toEqual([]);
    expect([...light].filter((t) => !dark.has(t))).toEqual([]);
    expect(dark.size).toBeGreaterThan(30);
  });

  it("uses no colour that only works against a dark ground", () => {
    // These two slipped through the first pass because the sweep that replaced them
    // ran over the components and not over this file. `hover:text-white` on
    // .lat-secondary put white text on a light button -- 1.15:1, invisible -- and it
    // is a class 28 components use.
    const body = css.slice(css.indexOf("@layer components"));
    expect(body.match(/\b(?:text|bg|border)-white\b/g)).toBeNull();
    // black/20-25 are recessed surfaces and must follow the theme; black/60+ are modal
    // backdrops, which are correctly dark in either theme.
    expect(body.match(/bg-black\/(?:[12]\d|\d)\b/g)).toBeNull();
  });

  it("leaves no themed colour hard-coded outside the token blocks", () => {
    // Everything below the token blocks should reference a variable. The PDF page is
    // the one exception: a page of a document is white in either theme.
    const body = css.slice(css.indexOf("@layer components"));
    const hex = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hex).toEqual(["#fff"]);
  });
});

describe("theme choice", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("document", { documentElement: { setAttribute: () => {} } });
  });

  it("defaults to following the system", () => {
    expect(readThemeChoice()).toBe("system");
  });

  it("stores the choice, not the colour it resolved to", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    applyTheme("system");
    // Storing "dark" here would freeze the app in whichever mode it first opened in.
    expect(store.get("lattice.theme.v1")).toBe("system");
    expect(resolveTheme("system")).toBe("dark");
  });

  it("resolves system from the OS but an explicit choice from itself", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(resolveTheme("system")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(resolveTheme("light")).toBe("light");
  });

  it("ignores a stored value that is not a theme", () => {
    store.set("lattice.theme.v1", "neon");
    expect(readThemeChoice()).toBe("system");
  });

  it("cycles through every choice and back", () => {
    let choice = THEME_CHOICES[0];
    const seen = [choice];
    for (let i = 0; i < THEME_CHOICES.length; i++) {
      choice = THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
      seen.push(choice);
    }
    expect(new Set(seen).size).toBe(THEME_CHOICES.length);
    expect(seen[seen.length - 1]).toBe(THEME_CHOICES[0]);
  });
});
