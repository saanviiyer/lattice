// Which projects a record belongs to, as a row of coloured dots.
//
// Every project is given a colour when it is created, which makes the colour a
// usable shorthand for the project itself. This is what turns that into something
// you can read at a glance from the library: a paper's dots say which lines of
// inquiry it is part of without opening anything.
//
// Deliberately dots and not chips. A paper in three projects is common, and three
// name chips would crowd out the title they are describing.

import type { Collection } from "../types";
import { collectionPath } from "../lib/collectionTree";
import { labelSwatches } from "../lib/labelColor";
import { IconPlus } from "./Icons";

interface Props {
  collections: Collection[];
  collectionIds: string[] | undefined;
  /** Beyond this many, the rest are summarised as "+N". */
  max?: number;
  size?: number;
}

export default function ProjectDots({ collections, collectionIds, max = 4, size = 6 }: Props) {
  const filed = (collectionIds || [])
    .map((id) => collections.find((collection) => collection.id === id))
    .filter((collection): collection is Collection => !!collection);
  if (filed.length === 0) return null;

  const shown = filed.slice(0, max);
  const hidden = filed.length - shown.length;
  // The full path, so two subprojects called "Methods" under different parents are
  // still tellable apart in the tooltip.
  const label = filed.map((c) => collectionPath(collections, c.id).join(" / ")).join(", ");

  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={`In ${label}`}>
      {shown.map((collection) => (
        <span
          key={collection.id}
          aria-hidden="true"
          className="rounded-full"
          style={{
            width: size,
            height: size,
            background: collection.color
              ? labelSwatches()[collection.color].dot
              : "rgba(148,163,184,.4)",
          }}
        />
      ))}
      {hidden > 0 && <span className="text-[10px] leading-none text-slate-700">+{hidden}</span>}
      <span className="sr-only">In {label}</span>
    </span>
  );
}

/**
 * A record's projects, as a control you can always see and click.
 *
 * The dots alone are invisible on a paper that is not filed anywhere — which is
 * every paper in a library that has not been organised yet, i.e. exactly when
 * someone is looking for the way to organise it. So an unfiled record shows an
 * explicit invitation instead of nothing at all.
 */
export function ProjectLabel({
  collections,
  collectionIds,
  onClick,
  label,
}: {
  collections: Collection[];
  collectionIds: string[] | undefined;
  onClick: () => void;
  /** What is being filed, for the accessible name. */
  label: string;
}) {
  const filed = (collectionIds || [])
    .map((id) => collections.find((collection) => collection.id === id))
    .filter((collection): collection is Collection => !!collection);

  const names = filed.map((c) => collectionPath(collections, c.id).join(" / "));
  const extra = filed.length - 1;

  return (
    <button
      onClick={onClick}
      className="group/proj flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-veil/[.05]"
      title={filed.length ? `In ${names.join(", ")} — click to change` : `File ${label} into a project`}
      aria-label={filed.length ? `Projects for ${label}: ${names.join(", ")}` : `File ${label} into a project`}
    >
      {filed.length > 0 ? (
        <>
          <ProjectDots collections={collections} collectionIds={collectionIds} max={3} />
          <span className="truncate text-slate-400">{filed[0].name}</span>
          {extra > 0 && <span className="shrink-0 text-slate-700">+{extra}</span>}
        </>
      ) : (
        <span className="flex items-center gap-1 text-slate-700 group-hover/proj:text-cyan-300">
          <IconPlus width={11} /> Project
        </span>
      )}
    </button>
  );
}
