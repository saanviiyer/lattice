import { describe, it, expect } from "vitest";
import {
  rectToQuad,
  quadToRect,
  serializeQuadpoints,
  deserializeQuadpoints,
  screenRectToNorm,
  normToPixels,
} from "../lib/highlightAnchor";
import type { NormRect } from "../types";

// Dyadic fractions (denominators are powers of two) so that x+w and y+h are exact in
// IEEE-754 and the round-trip is bit-for-bit lossless.
const rects: NormRect[] = [
  { x: 0.125, y: 0.25, w: 0.25, h: 0.0625 },
  { x: 0.5, y: 0.5, w: 0.25, h: 0.125 },
  { x: 0.0, y: 0.75, w: 1.0, h: 0.03125 },
];

describe("quadpoint round-trip", () => {
  it("rectToQuad then quadToRect restores a single rect exactly", () => {
    for (const r of rects) {
      expect(quadToRect(rectToQuad(r))).toEqual(r);
    }
  });

  it("serialize then deserialize restores the full rect list exactly", () => {
    const quad = serializeQuadpoints(rects);
    expect(quad).toHaveLength(rects.length * 8);
    expect(deserializeQuadpoints(quad)).toEqual(rects);
  });

  it("produces 8 numbers per rect in the documented corner order", () => {
    const q = rectToQuad({ x: 0.125, y: 0.25, w: 0.25, h: 0.0625 });
    // top-left, top-right, bottom-left, bottom-right
    expect(q).toEqual([0.125, 0.25, 0.375, 0.25, 0.125, 0.3125, 0.375, 0.3125]);
  });

  it("rejects a malformed quad", () => {
    expect(() => quadToRect([1, 2, 3])).toThrow();
    expect(() => deserializeQuadpoints([1, 2, 3, 4])).toThrow();
  });
});

describe("screen <-> normalized conversions", () => {
  it("screenRectToNorm normalizes against the page box and size", () => {
    const norm = screenRectToNorm(
      { left: 150, top: 300, width: 200, height: 20 },
      { left: 100, top: 200 },
      400, // page width px
      800 // page height px
    );
    expect(norm).toEqual({ x: 0.125, y: 0.125, w: 0.5, h: 0.025 });
  });

  it("normToPixels is the inverse of screenRectToNorm (about the page origin)", () => {
    const pageW = 640;
    const pageH = 480;
    const norm: NormRect = { x: 0.25, y: 0.5, w: 0.1, h: 0.2 };
    const px = normToPixels(norm, pageW, pageH);
    expect(px).toEqual({ left: 160, top: 240, width: 64, height: 96 });
    // Re-normalize (page box at origin) and confirm we land back on the same rect.
    const back = screenRectToNorm(px, { left: 0, top: 0 }, pageW, pageH);
    expect(back).toEqual(norm);
  });
});
