// Minimal inline Markdown tokenizer for text that arrives already formatted (the
// library Q and A answer, for one). It covers the marks a model actually emits in a
// sentence: **bold**, *italic*, and `code`. Block structure is left alone, because
// the surfaces that use this render with whitespace preserved.

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string };

// Order matters: ** must be tried before *, or bold is read as two italics.
const PATTERN = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*\n]+)\*)/g;

export function parseInlineMarkdown(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;

  for (const match of input.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push({ type: "text", value: input.slice(cursor, start) });

    if (match[2] != null) tokens.push({ type: "bold", value: match[2] });
    else if (match[4] != null) tokens.push({ type: "code", value: match[4] });
    else if (match[6] != null) tokens.push({ type: "italic", value: match[6] });

    cursor = start + match[0].length;
  }

  if (cursor < input.length) tokens.push({ type: "text", value: input.slice(cursor) });
  return tokens;
}
