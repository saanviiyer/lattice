// The colour control for a project.
//
// Colour in lattice belongs to a project and to nothing else: it is the grouping
// made visible, so this is the only place a colour is ever chosen. A project is
// given one automatically when it is created; this exists so you can change it.
//
// Laid out flat rather than behind a popover because the only place it appears is
// the sidebar, which is itself a scroll container that would clip one.

import type { LabelColor } from "../types";
import { LABEL_COLORS } from "../types";
import { labelSwatches } from "../lib/labelColor";

/** The palette laid out flat, for panels that are already open. */
export function ColorSwatchRow({
  value,
  onChange,
  label,
}: {
  value: LabelColor | undefined;
  onChange: (color: LabelColor | undefined) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Colour for ${label}`}>
      {LABEL_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          title={labelSwatches()[color].label}
          aria-label={labelSwatches()[color].label}
          aria-pressed={value === color}
          className={`h-4 w-4 rounded-full border ${value === color ? "border-slate-100" : "border-transparent"}`}
          style={{ background: labelSwatches()[color].dot }}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange(undefined)}
        title="No colour"
        aria-label={`Remove the colour from ${label}`}
        aria-pressed={!value}
        className={`grid h-4 w-4 place-items-center rounded-full border ${value ? "border-veil/20" : "border-slate-100"}`}
      >
        <span className="block h-[1px] w-[60%] rotate-45 bg-veil/40" />
      </button>
    </div>
  );
}
