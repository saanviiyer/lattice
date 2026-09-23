// The shared colour palette, in one place, so a colour reads the same on a paper
// row, a note in the sidebar, and a project in the tree.
//
// Colours are stored as names (see LabelColor in types.ts), never as hex, so the
// palette can be retuned for contrast without rewriting anybody's library.

import type { Collection, LabelColor } from "../types";
import { LABEL_COLORS } from "../types";

interface Swatch {
  label: string;
  /** The dot / left rule. Solid enough to read at 8px against the dark canvas. */
  dot: string;
  /** A translucent fill for chips and selected rows. */
  soft: string;
  /** Border for chips drawn on the soft fill. */
  border: string;
  /** Text colour for a chip. */
  text: string;
}

const DARK_SWATCHES: Record<LabelColor, Swatch> = {
  red: { label: "Red", dot: "#f87171", soft: "rgba(248,113,113,.13)", border: "rgba(248,113,113,.32)", text: "#fca5a5" },
  orange: { label: "Orange", dot: "#fb923c", soft: "rgba(251,146,60,.13)", border: "rgba(251,146,60,.32)", text: "#fdba74" },
  yellow: { label: "Yellow", dot: "#facc15", soft: "rgba(250,204,21,.13)", border: "rgba(250,204,21,.3)", text: "#fde047" },
  green: { label: "Green", dot: "#4ade80", soft: "rgba(74,222,128,.13)", border: "rgba(74,222,128,.3)", text: "#86efac" },
  teal: { label: "Teal", dot: "#2dd4bf", soft: "rgba(45,212,191,.13)", border: "rgba(45,212,191,.3)", text: "#5eead4" },
  blue: { label: "Blue", dot: "#60a5fa", soft: "rgba(96,165,250,.13)", border: "rgba(96,165,250,.32)", text: "#93c5fd" },
  purple: { label: "Purple", dot: "#a78bfa", soft: "rgba(167,139,250,.13)", border: "rgba(167,139,250,.32)", text: "#c4b5fd" },
  pink: { label: "Pink", dot: "#f472b6", soft: "rgba(244,114,182,.13)", border: "rgba(244,114,182,.32)", text: "#f9a8d4" },
};

// The same eight hues at a weight that reads on white. A pastel chosen to glow
// against near-black (#facc15 yellow, #4ade80 green) is close to invisible on a light
// ground, so light gets its own values rather than an algorithmic tint of these.
const LIGHT_SWATCHES: Record<LabelColor, Swatch> = {
  red: { label: "Red", dot: "#dc2626", soft: "rgba(220,38,38,.10)", border: "rgba(220,38,38,.30)", text: "#b91c1c" },
  orange: { label: "Orange", dot: "#ea580c", soft: "rgba(234,88,12,.10)", border: "rgba(234,88,12,.30)", text: "#c2410c" },
  yellow: { label: "Yellow", dot: "#ca8a04", soft: "rgba(202,138,4,.12)", border: "rgba(202,138,4,.30)", text: "#a16207" },
  green: { label: "Green", dot: "#16a34a", soft: "rgba(22,163,74,.10)", border: "rgba(22,163,74,.30)", text: "#15803d" },
  teal: { label: "Teal", dot: "#0d9488", soft: "rgba(13,148,136,.10)", border: "rgba(13,148,136,.30)", text: "#0f766e" },
  blue: { label: "Blue", dot: "#2563eb", soft: "rgba(37,99,235,.10)", border: "rgba(37,99,235,.30)", text: "#1d4ed8" },
  purple: { label: "Purple", dot: "#7c3aed", soft: "rgba(124,58,237,.10)", border: "rgba(124,58,237,.30)", text: "#6d28d9" },
  pink: { label: "Pink", dot: "#db2777", soft: "rgba(219,39,119,.10)", border: "rgba(219,39,119,.30)", text: "#be185d" },
};

/**
 * The palette for the theme currently on screen. A function rather than a constant
 * because these end up in inline styles, which no stylesheet can reach.
 */
export function labelSwatches(): Record<LabelColor, Swatch> {
  const light =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";
  return light ? LIGHT_SWATCHES : DARK_SWATCHES;
}

/** The dark palette, for code that runs without a document (tests, exports). */
export const LABEL_SWATCHES = DARK_SWATCHES;

/** The dot colour for a record, or a neutral placeholder when it has no colour. */
export function dotColor(color: LabelColor | undefined): string {
  return color ? LABEL_SWATCHES[color].dot : "transparent";
}

/** Inline chip styling for a colour, for the small "Red"/"Blue" pills. */
export function chipStyle(color: LabelColor): React.CSSProperties {
  const swatch = LABEL_SWATCHES[color];
  return { background: swatch.soft, borderColor: swatch.border, color: swatch.text };
}

/** Human-readable name, used in titles and aria labels. */
export function colorLabel(color: LabelColor | undefined): string {
  return color ? LABEL_SWATCHES[color].label : "No colour";
}


/**
 * The colour to give a project being created.
 *
 * Every project gets one automatically, so colour means "which project" from the
 * first moment rather than only after someone remembers to set it. Two rules keep
 * the palette legible as it fills up: never repeat a sibling's colour, since
 * siblings are the ones read side by side; and otherwise take the least-used
 * colour in the whole tree, so the eight spread evenly instead of clustering.
 */
export function nextProjectColor(
  collections: Collection[],
  parentId: string | null
): LabelColor {
  const siblingColors = new Set(
    collections
      .filter((collection) => (collection.parentId ?? null) === (parentId ?? null))
      .map((collection) => collection.color)
      .filter(Boolean)
  );

  const usage = new Map<LabelColor, number>(LABEL_COLORS.map((color) => [color, 0]));
  for (const collection of collections) {
    if (collection.color) usage.set(collection.color, (usage.get(collection.color) || 0) + 1);
  }

  const free = LABEL_COLORS.filter((color) => !siblingColors.has(color));
  // Once every colour is taken by a sibling there is nothing left to avoid, so fall
  // back to the whole palette rather than returning nothing.
  const candidates = free.length ? free : [...LABEL_COLORS];
  return candidates.reduce((best, color) =>
    (usage.get(color) || 0) < (usage.get(best) || 0) ? color : best
  );
}
