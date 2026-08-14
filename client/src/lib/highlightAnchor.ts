// Highlight anchoring: convert between normalized rects (fractions of a page's
// dimensions) and PDF-style quadpoints, and between screen rects and normalized rects.
//
// Why quadpoints: it is the same 8-numbers-per-rect encoding PDF text-markup
// annotations use, so a lattice highlight can round-trip through a portable, flat
// numeric form. Normalized rects (0..1) make a highlight re-anchor at any zoom.

import type { NormRect } from "../types";

// One quad = 4 corners (x,y) in the order: top-left, top-right, bottom-left,
// bottom-right — i.e. [x1,y1, x2,y1, x1,y2, x2,y2]. This mirrors the PDF QuadPoints
// convention closely enough for a lossless round-trip.
export function rectToQuad(r: NormRect): number[] {
  const x1 = r.x;
  const y1 = r.y;
  const x2 = r.x + r.w;
  const y2 = r.y + r.h;
  return [x1, y1, x2, y1, x1, y2, x2, y2];
}

export function quadToRect(q: number[]): NormRect {
  if (q.length !== 8) {
    throw new Error(`A quad must have 8 numbers, got ${q.length}.`);
  }
  const [x1, y1, , , , , x2, y2] = q;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Serialize a list of normalized rects into a single flat quadpoints array
// (8 numbers per rect), the form suitable for compact storage or PDF export.
export function serializeQuadpoints(rects: NormRect[]): number[] {
  const out: number[] = [];
  for (const r of rects) out.push(...rectToQuad(r));
  return out;
}

// Restore a list of normalized rects from a flat quadpoints array.
export function deserializeQuadpoints(quadpoints: number[]): NormRect[] {
  if (quadpoints.length % 8 !== 0) {
    throw new Error(
      `Quadpoints length must be a multiple of 8, got ${quadpoints.length}.`
    );
  }
  const rects: NormRect[] = [];
  for (let i = 0; i < quadpoints.length; i += 8) {
    rects.push(quadToRect(quadpoints.slice(i, i + 8)));
  }
  return rects;
}

// Convert a screen-space rectangle (relative to the page element's box) into a
// normalized rect. pageW/pageH are the rendered page dimensions in pixels.
export function screenRectToNorm(
  rect: { left: number; top: number; width: number; height: number },
  pageBox: { left: number; top: number },
  pageW: number,
  pageH: number
): NormRect {
  return {
    x: (rect.left - pageBox.left) / pageW,
    y: (rect.top - pageBox.top) / pageH,
    w: rect.width / pageW,
    h: rect.height / pageH,
  };
}

// Convert a normalized rect back to CSS pixel offsets for the given rendered page size.
export function normToPixels(
  r: NormRect,
  pageW: number,
  pageH: number
): { left: number; top: number; width: number; height: number } {
  return {
    left: r.x * pageW,
    top: r.y * pageH,
    width: r.w * pageW,
    height: r.h * pageH,
  };
}
