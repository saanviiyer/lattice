import { describe, it, expect } from "vitest";
import type { Collection } from "../types";
import { LABEL_COLORS } from "../types";
import { nextProjectColor } from "../lib/labelColor";

function project(id: string, parentId: string | null, color?: Collection["color"]): Collection {
  return { id, name: id, parentId, createdAt: "2026-01-01T00:00:00.000Z", color };
}

describe("nextProjectColor", () => {
  it("gives the first project a colour rather than leaving it blank", () => {
    expect(LABEL_COLORS).toContain(nextProjectColor([], null));
  });

  it("never repeats a sibling's colour", () => {
    const siblings = [project("a", null, "red"), project("b", null, "orange")];
    const chosen = nextProjectColor(siblings, null);
    expect(chosen).not.toBe("red");
    expect(chosen).not.toBe("orange");
  });

  it("may reuse a colour that is only used elsewhere in the tree", () => {
    // "red" is used under a different parent, so it is free for these siblings —
    // and being the least used overall, it is the one picked.
    const collections = [project("parent", null, "blue"), project("child", "parent", "red")];
    expect(nextProjectColor(collections, null)).not.toBe("blue");
  });

  it("spreads the palette instead of clustering on one colour", () => {
    const collections: Collection[] = [];
    for (let index = 0; index < LABEL_COLORS.length; index += 1) {
      collections.push(project(`p${index}`, null, nextProjectColor(collections, null)));
    }
    // Eight projects, eight distinct colours.
    expect(new Set(collections.map((c) => c.color)).size).toBe(LABEL_COLORS.length);
  });

  it("still returns a colour once every colour is taken", () => {
    const siblings = LABEL_COLORS.map((color, index) => project(`p${index}`, null, color));
    expect(LABEL_COLORS).toContain(nextProjectColor(siblings, null));
  });
});
