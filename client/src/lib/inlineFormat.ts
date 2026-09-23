// Applying and removing inline marks on a selection.
//
// The note body stays plain Markdown — that is what keeps wikilinks, backlinks,
// the graph, and every export working on one string — so bolding a selection
// means editing the characters around it. This does that, and does the part
// people notice: pressing bold on already-bold text takes the bold off again,
// and the selection still covers the same words afterwards.

export type InlineMark = "bold" | "italic" | "code";

const DELIMITERS: Record<InlineMark, string> = {
  bold: "**",
  italic: "*",
  code: "`",
};

export interface MarkResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Whether the selection already carries this mark, either inside it or around it. */
function marked(text: string, start: number, end: number, delimiter: string): "inside" | "around" | null {
  const selected = text.slice(start, end);
  if (
    selected.length >= delimiter.length * 2 &&
    selected.startsWith(delimiter) &&
    selected.endsWith(delimiter)
  ) {
    return "inside";
  }
  if (
    text.slice(Math.max(0, start - delimiter.length), start) === delimiter &&
    text.slice(end, end + delimiter.length) === delimiter
  ) {
    return "around";
  }
  return null;
}

/**
 * Toggle a mark over [start, end).
 *
 * With an empty selection the delimiters are inserted and the caret is placed
 * between them, so pressing bold and then typing does what you expect.
 */
export function toggleMark(
  text: string,
  start: number,
  end: number,
  mark: InlineMark
): MarkResult {
  const delimiter = DELIMITERS[mark];
  const width = delimiter.length;

  if (start === end) {
    return {
      text: `${text.slice(0, start)}${delimiter}${delimiter}${text.slice(start)}`,
      selectionStart: start + width,
      selectionEnd: start + width,
    };
  }

  // Italic is a single asterisk, which is also the first character of bold. A
  // selection sitting inside **bold** must not be read as italic and half-undone.
  if (mark === "italic") {
    const bold = DELIMITERS.bold;
    const insideBold =
      text.slice(Math.max(0, start - bold.length), start) === bold &&
      text.slice(end, end + bold.length) === bold;
    if (!insideBold) {
      const state = marked(text, start, end, delimiter);
      if (state) return unmark(text, start, end, delimiter, state);
    }
    return applyMark(text, start, end, delimiter);
  }

  const state = marked(text, start, end, delimiter);
  if (state) return unmark(text, start, end, delimiter, state);
  return applyMark(text, start, end, delimiter);
}

function applyMark(text: string, start: number, end: number, delimiter: string): MarkResult {
  // Trailing spaces inside the marks produce "** bold **", which no Markdown
  // renderer treats as bold. Move them outside.
  const raw = text.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  const from = start + leading;
  const to = end - trailing;
  if (from >= to) {
    return { text, selectionStart: start, selectionEnd: end };
  }
  return {
    text: `${text.slice(0, from)}${delimiter}${text.slice(from, to)}${delimiter}${text.slice(to)}`,
    selectionStart: from + delimiter.length,
    selectionEnd: to + delimiter.length,
  };
}

function unmark(
  text: string,
  start: number,
  end: number,
  delimiter: string,
  state: "inside" | "around"
): MarkResult {
  const width = delimiter.length;
  if (state === "inside") {
    const inner = text.slice(start + width, end - width);
    return {
      text: `${text.slice(0, start)}${inner}${text.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  const before = text.slice(0, start - width);
  const inner = text.slice(start, end);
  return {
    text: `${before}${inner}${text.slice(end + width)}`,
    selectionStart: start - width,
    selectionEnd: end - width,
  };
}

/** Wrap a selection as a [[wikilink]], or unwrap one. */
export function toggleWikilink(text: string, start: number, end: number): MarkResult {
  const selected = text.slice(start, end);
  if (selected.startsWith("[[") && selected.endsWith("]]")) {
    const inner = selected.slice(2, -2);
    return {
      text: `${text.slice(0, start)}${inner}${text.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  if (text.slice(Math.max(0, start - 2), start) === "[[" && text.slice(end, end + 2) === "]]") {
    return {
      text: `${text.slice(0, start - 2)}${selected}${text.slice(end + 2)}`,
      selectionStart: start - 2,
      selectionEnd: end - 2,
    };
  }
  const inner = selected || "";
  return {
    text: `${text.slice(0, start)}[[${inner}]]${text.slice(end)}`,
    selectionStart: start + 2,
    selectionEnd: start + 2 + inner.length,
  };
}

/** The keyboard shortcut a key event is asking for, if any. */
export function markForShortcut(key: string): InlineMark | "link" | null {
  switch (key.toLowerCase()) {
    case "b":
      return "bold";
    case "i":
      return "italic";
    case "e":
      return "code";
    case "k":
      return "link";
    default:
      return null;
  }
}
