// A Notion-style block editor for lattice notes.
//
// The note body is a list of typed blocks (paragraph, H1/H2/H3, bulleted list,
// numbered list, to-do, quote, code, divider). Pressing Enter creates a new block; a
// "/" slash menu inserts or turns the current block into a type; each block is its own
// editable element with a light hover affordance. [[wikilink]] autocomplete works
// inside every block. This is a lightweight, self-contained block model (not TipTap):
// blocks serialize to Markdown so backlinks, the graph, and the Supabase path all keep
// working on the same string form. See lib/blocks.ts.
//
// Markdown shortcuts work the way they do in Notion: typing "- " or "* " at the start
// of a line turns it into a bullet immediately (likewise "1. ", "# ", "> ", "[] "),
// and Tab / Shift+Tab nests and un-nests a list item, carrying its own nested items
// with it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note, Paper } from "../types";
import {
  blocksToMarkdown,
  clampIndent,
  emptyBlock,
  isListType,
  listNumbering,
  markdownShortcut,
  markdownToBlocks,
  MAX_INDENT,
  SLASH_COMMANDS,
  type Block,
  type BlockType,
} from "../lib/blocks";
import { backlinksFor, buildTitleIndex } from "../lib/graph";
import { markForShortcut, toggleMark, toggleWikilink, type InlineMark } from "../lib/inlineFormat";
import { parseInlineMarkdown } from "../lib/inlineMarkdown";
import { normalizeTitle, parseWikilinks } from "../lib/wikilink";

interface LinkTarget {
  id: string;
  title: string;
  type: "paper" | "note";
}

interface Props {
  note: Note;
  papers: Paper[];
  notes: Note[];
  onChangeBody: (body: string) => void;
  onChangeTitle: (title: string) => void;
  onOpenTarget: (target: LinkTarget) => void;
}

type Menu =
  | { kind: "slash"; blockId: string; query: string }
  | { kind: "link"; blockId: string; query: string }
  | null;

export default function NoteEditor({
  note,
  papers,
  notes,
  onChangeBody,
  onChangeTitle,
  onOpenTarget,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => markdownToBlocks(note.body));
  const [menu, setMenu] = useState<Menu>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // The block being edited shows its raw Markdown; every other block shows the
  // formatting rendered. This is what makes **bold** look bold while you work
  // without giving up a plain-Markdown note body.
  const [editingId, setEditingId] = useState<string | null>(null);
  // A non-empty selection inside a block, for the formatting toolbar.
  const [selection, setSelection] = useState<{ blockId: string; start: number; end: number } | null>(null);

  const taRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const focusReq = useRef<{ id: string; caret: number } | null>(null);
  // When true, an external note.body change should reset local blocks. We ignore the
  // echo of our own onChangeBody by tracking the last markdown we emitted.
  const lastEmitted = useRef<string>(note.body);

  // Reset blocks when switching to a different note (or an external body change).
  useEffect(() => {
    if (note.body !== lastEmitted.current) {
      setBlocks(markdownToBlocks(note.body));
      lastEmitted.current = note.body;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.body]);

  // ---- Link targets + resolution + backlinks (contextual panel) ----
  const targets = useMemo<LinkTarget[]>(
    () => [
      ...papers.map((p) => ({
        id: p.id,
        title: p.title || "Untitled paper",
        type: "paper" as const,
      })),
      ...notes
        .filter((n) => n.id !== note.id)
        .map((n) => ({
          id: n.id,
          title: n.title || "Untitled note",
          type: "note" as const,
        })),
    ],
    [papers, notes, note.id]
  );
  const index = useMemo(() => buildTitleIndex(papers, notes), [papers, notes]);
  const backlinks = useMemo(
    () => backlinksFor(note.id, notes, index),
    [note.id, notes, index]
  );
  const outgoing = useMemo(() => {
    return parseWikilinks(note.body).map((title) => {
      const id = index.byTitle.get(normalizeTitle(title));
      const t = id ? targets.find((x) => x.id === id) : undefined;
      return { title, target: t || null };
    });
  }, [note.body, index, targets]);

  // ---- Menu suggestions ----
  const slashItems = useMemo(() => {
    if (menu?.kind !== "slash") return [];
    const q = menu.query.toLowerCase();
    return SLASH_COMMANDS.filter(
      (c) =>
        !q ||
        c.label.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.includes(q))
    );
  }, [menu]);

  const linkItems = useMemo(() => {
    if (menu?.kind !== "link") return [];
    const q = normalizeTitle(menu.query);
    return targets.filter((t) => normalizeTitle(t.title).includes(q)).slice(0, 8);
  }, [menu, targets]);

  const menuLen = menu?.kind === "slash" ? slashItems.length : linkItems.length;

  // ---- Persist blocks ----
  function commit(next: Block[]) {
    setBlocks(next);
    const md = blocksToMarkdown(next);
    lastEmitted.current = md;
    onChangeBody(md);
  }

  // ---- Focus management ----
  useLayoutEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    focusReq.current = null;
    const ta = taRefs.current.get(req.id);
    if (ta) {
      ta.focus();
      const pos = Math.min(req.caret, ta.value.length);
      ta.setSelectionRange(pos, pos);
      autoGrow(ta);
    }
  });

  function autoGrow(ta: HTMLTextAreaElement) {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  function setBlock(id: string, patch: Partial<Block>) {
    commit(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  // ---- Change handler: markdown shortcuts + text + menu detection ----
  function onChange(b: Block, e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const caret = e.target.selectionStart;

    // "- " at the start of a paragraph becomes a bullet as you type it. Only when
    // the caret sits right after the marker, so pasting a whole Markdown list into
    // the middle of a line does not silently restyle the block.
    if (b.type === "p" && caret === value.length - lengthAfterMarker(value)) {
      const shortcut = markdownShortcut(value);
      if (shortcut) {
        applyShortcut(b, shortcut);
        autoGrow(e.target);
        return;
      }
    }

    const next = blocks.map((x) => (x.id === b.id ? { ...x, text: value } : x));
    commit(next);
    autoGrow(e.target);

    const before = value.slice(0, caret);
    const linkMatch = before.match(/\[\[([^\][\n]*)$/);
    if (linkMatch) {
      setMenu({ kind: "link", blockId: b.id, query: linkMatch[1] });
      setActiveIndex(0);
      return;
    }
    const slashMatch = b.type === "p" ? value.match(/^\/(\S*)$/) : null;
    if (slashMatch) {
      setMenu({ kind: "slash", blockId: b.id, query: slashMatch[1] });
      setActiveIndex(0);
      return;
    }
    setMenu(null);
  }

  // How much of the line survives the marker, so the caret check above can tell
  // "typing the marker" from "editing text that happens to start with one".
  function lengthAfterMarker(value: string): number {
    return markdownShortcut(value)?.text.length ?? -1;
  }

  // Turn a block into the type its Markdown marker names, eating the marker.
  function applyShortcut(b: Block, shortcut: ReturnType<typeof markdownShortcut>) {
    if (!shortcut) return;
    setMenu(null);
    if (shortcut.type === "divider") {
      const nb = emptyBlock("p");
      commit(blocks.flatMap((x) => (x.id === b.id ? [{ ...x, type: "divider" as BlockType, text: "" }, nb] : [x])));
      focusReq.current = { id: nb.id, caret: 0 };
      return;
    }
    commit(
      blocks.map((x) =>
        x.id === b.id
          ? { ...x, type: shortcut.type, text: shortcut.text, checked: shortcut.checked }
          : x
      )
    );
    focusReq.current = { id: b.id, caret: shortcut.text.length };
  }

  /**
   * Nest or un-nest a list item by one level (Tab / Shift+Tab).
   *
   * A block can only go one level deeper than the item above it — otherwise the
   * list would show a gap no renderer could represent — and its own nested items
   * move with it, so indenting a parent does not tear its children off.
   */
  function shiftIndent(b: Block, delta: 1 | -1, caret: number) {
    const idx = blocks.findIndex((x) => x.id === b.id);
    if (idx < 0 || !isListType(b.type)) return;
    const current = clampIndent(b.indent);
    if (delta > 0) {
      const previous = blocks[idx - 1];
      const ceiling = previous && isListType(previous.type) ? clampIndent(previous.indent) + 1 : 0;
      if (current >= Math.min(ceiling, MAX_INDENT)) return;
    } else if (current === 0) return;

    // Everything directly below at a deeper level belongs to this item.
    let end = idx + 1;
    while (
      end < blocks.length &&
      isListType(blocks[end].type) &&
      clampIndent(blocks[end].indent) > current
    ) {
      end += 1;
    }
    commit(
      blocks.map((x, i) =>
        i >= idx && i < end ? { ...x, indent: clampIndent(clampIndent(x.indent) + delta) } : x
      )
    );
    focusReq.current = { id: b.id, caret };
  }

  /** Apply a mark to the selection in a block, keeping the words selected after. */
  function applyMark(blockId: string, mark: InlineMark | "link") {
    const area = taRefs.current.get(blockId);
    const block = blocks.find((item) => item.id === blockId);
    if (!area || !block) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const result =
      mark === "link"
        ? toggleWikilink(block.text, start, end)
        : toggleMark(block.text, start, end, mark);
    commit(blocks.map((item) => (item.id === blockId ? { ...item, text: result.text } : item)));
    // Restore the selection after React has written the new value back.
    requestAnimationFrame(() => {
      const current = taRefs.current.get(blockId);
      if (!current) return;
      current.focus();
      current.setSelectionRange(result.selectionStart, result.selectionEnd);
      setSelection(
        result.selectionEnd > result.selectionStart
          ? { blockId, start: result.selectionStart, end: result.selectionEnd }
          : null
      );
    });
  }

  /** Remember a selection so the toolbar knows where to appear and what to act on. */
  function trackSelection(blockId: string, area: HTMLTextAreaElement) {
    const { selectionStart, selectionEnd } = area;
    setSelection(
      selectionEnd > selectionStart ? { blockId, start: selectionStart, end: selectionEnd } : null
    );
  }

  // ---- Menu selection ----
  function applySlash(type: BlockType) {
    if (!menu) return;
    const id = menu.blockId;
    setMenu(null);
    if (type === "divider") {
      // Turn the current block into a divider and add a fresh paragraph after it.
      const nb = emptyBlock("p");
      commit(
        blocks.flatMap((b) =>
          b.id === id ? [{ ...b, type, text: "" }, nb] : [b]
        )
      );
      focusReq.current = { id: nb.id, caret: 0 };
      return;
    }
    commit(blocks.map((b) => (b.id === id ? { ...b, type, text: "" } : b)));
    focusReq.current = { id, caret: 0 };
  }

  function applyLink(title: string) {
    if (menu?.kind !== "link") return;
    const id = menu.blockId;
    const ta = taRefs.current.get(id);
    const b = blocks.find((x) => x.id === id);
    if (!ta || !b) return;
    const caret = ta.selectionStart;
    const before = b.text.slice(0, caret);
    const after = b.text.slice(caret);
    const start = before.lastIndexOf("[[");
    if (start === -1) return;
    const text = `${before.slice(0, start)}[[${title}]]${after}`;
    setMenu(null);
    commit(blocks.map((x) => (x.id === id ? { ...x, text } : x)));
    focusReq.current = { id, caret: start + title.length + 4 };
  }

  function chooseActive() {
    if (menu?.kind === "slash") {
      const item = slashItems[activeIndex];
      if (item) applySlash(item.type);
    } else if (menu?.kind === "link") {
      const item = linkItems[activeIndex];
      if (item) applyLink(item.title);
    }
  }

  // ---- Keyboard ----
  function onKeyDown(b: Block, e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && menuLen > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % menuLen);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + menuLen) % menuLen);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        chooseActive();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }

    const ta = e.currentTarget;
    const caret = ta.selectionStart;
    const atStart = caret === 0 && ta.selectionEnd === 0;

    // The shortcuts everybody already has in their fingers.
    if (e.metaKey || e.ctrlKey) {
      const mark = markForShortcut(e.key);
      if (mark) {
        e.preventDefault();
        applyMark(b.id, mark);
        return;
      }
    }

    // Tab nests a list item; Shift+Tab lifts it back out. On anything else Tab is
    // left alone so it still moves focus out of the editor for keyboard users.
    if (e.key === "Tab" && isListType(b.type)) {
      e.preventDefault();
      shiftIndent(b, e.shiftKey ? -1 : 1, caret);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      // Code blocks: Enter inserts a newline; a trailing blank line exits the block.
      if (b.type === "code") {
        if (b.text.endsWith("\n") && caret === b.text.length) {
          e.preventDefault();
          const nb = emptyBlock("p");
          commit(
            blocks.flatMap((x) =>
              x.id === b.id ? [{ ...x, text: x.text.replace(/\n$/, "") }, nb] : [x]
            )
          );
          focusReq.current = { id: nb.id, caret: 0 };
        }
        return; // otherwise allow the default newline
      }

      e.preventDefault();
      const idx = blocks.findIndex((x) => x.id === b.id);
      const isList = isListType(b.type);
      // Enter on an empty list item steps back out one level at a time, and ends
      // the list once it is back at the margin.
      if (isList && b.text.trim() === "") {
        if (clampIndent(b.indent) > 0) shiftIndent(b, -1, 0);
        else commit(blocks.map((x) => (x.id === b.id ? { ...x, type: "p", indent: 0 } : x)));
        return;
      }
      const before = b.text.slice(0, caret);
      const after = b.text.slice(caret);
      const nextType: BlockType = isList ? b.type : "p";
      // A new item starts at the same depth as the one it was split from.
      const nb: Block = { ...emptyBlock(nextType), text: after, indent: isList ? clampIndent(b.indent) : 0 };
      const next = [
        ...blocks.slice(0, idx),
        { ...b, text: before },
        nb,
        ...blocks.slice(idx + 1),
      ];
      commit(next);
      focusReq.current = { id: nb.id, caret: 0 };
      return;
    }

    if (e.key === "Backspace" && atStart) {
      // Backspace at the start of a nested item lifts it one level first, so a
      // deeply nested bullet is not flattened to a paragraph in a single press.
      if (isListType(b.type) && clampIndent(b.indent) > 0) {
        e.preventDefault();
        shiftIndent(b, -1, 0);
        return;
      }
      if (b.type !== "p") {
        // Backspace at the start of a styled block turns it back into a paragraph.
        e.preventDefault();
        setBlock(b.id, { type: "p", checked: undefined, indent: 0 });
        return;
      }
      const idx = blocks.findIndex((x) => x.id === b.id);
      if (idx > 0) {
        e.preventDefault();
        const prev = blocks[idx - 1];
        if (prev.type === "divider") {
          // Remove the divider above.
          commit(blocks.filter((x) => x.id !== prev.id));
          focusReq.current = { id: b.id, caret: 0 };
          return;
        }
        const mergedCaret = prev.text.length;
        const merged = { ...prev, text: prev.text + b.text };
        const next = [
          ...blocks.slice(0, idx - 1),
          merged,
          ...blocks.slice(idx + 1),
        ];
        commit(next);
        focusReq.current = { id: prev.id, caret: mergedCaret };
      }
    }
  }

  // Insert a new empty paragraph after a block and focus it (hover "+" affordance).
  function addAfter(id: string) {
    const idx = blocks.findIndex((x) => x.id === id);
    const nb = emptyBlock("p");
    commit([...blocks.slice(0, idx + 1), nb, ...blocks.slice(idx + 1)]);
    focusReq.current = { id: nb.id, caret: 0 };
  }

  // Running numbers for ordered-list blocks, from the same helper the Markdown
  // serializer uses, so what you see is what gets written to the note body.
  const numbering = useMemo(() => listNumbering(blocks), [blocks]);

  const registerRef = (id: string) => (el: HTMLTextAreaElement | null) => {
    if (el) {
      taRefs.current.set(id, el);
      autoGrow(el);
    } else taRefs.current.delete(id);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 h-full">
      {/* Editor column */}
      <div className="min-h-0 overflow-auto">
        <input
          value={note.title}
          onChange={(e) => onChangeTitle(e.target.value)}
          placeholder="Untitled"
          className="w-full bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-slate-600 mb-4"
        />
        <div className="max-w-2xl">
          {blocks.map((b) => (
            <div key={b.id} className="group relative flex items-start gap-1">
              {/* Hover gutter */}
              <button
                onClick={() => addAfter(b.id)}
                title="Add block below"
                className="mt-1 w-5 shrink-0 text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-300 text-center select-none"
              >
                +
              </button>

              <div className="flex-1 min-w-0 relative">
                {b.type === "divider" ? (
                  <div className="py-2">
                    <hr className="border-slate-700" />
                  </div>
                ) : (
                  <div
                    className="flex items-start gap-2"
                    // 22px a level: enough to read the nesting, small enough that a
                    // deep list still has room for its text.
                    style={isListType(b.type) ? { paddingLeft: clampIndent(b.indent) * 22 } : undefined}
                  >
                    {b.type === "bullet" && <Bullet depth={clampIndent(b.indent)} />}
                    {b.type === "number" && (
                      <span className="mt-1 text-slate-400 select-none tabular-nums text-sm">
                        {orderedMarker(numbering.get(b.id) || 1, clampIndent(b.indent))}
                      </span>
                    )}
                    {b.type === "todo" && (
                      <input
                        type="checkbox"
                        checked={!!b.checked}
                        onChange={(e) => setBlock(b.id, { checked: e.target.checked })}
                        className="mt-1.5 accent-indigo-500"
                      />
                    )}
                    <textarea
                      ref={registerRef(b.id)}
                      value={b.text}
                      rows={1}
                      onChange={(e) => onChange(b, e)}
                      onKeyDown={(e) => onKeyDown(b, e)}
                      onFocus={() => setEditingId(b.id)}
                      // onSelect alone is unreliable across browsers for a
                      // textarea; mouse-up and key-up are what actually fire when
                      // a person drags or shift-arrows over a phrase.
                      onSelect={(e) => trackSelection(b.id, e.currentTarget)}
                      onMouseUp={(e) => trackSelection(b.id, e.currentTarget)}
                      onKeyUp={(e) => trackSelection(b.id, e.currentTarget)}
                      onBlur={() =>
                        setTimeout(() => {
                          setMenu((m) => (m && m.blockId === b.id ? null : m));
                          setEditingId((id) => (id === b.id ? null : id));
                          setSelection((sel) => (sel && sel.blockId === b.id ? null : sel));
                        }, 150)
                      }
                      placeholder={
                        b.type === "p"
                          ? "Type text, / for blocks, - for a bullet"
                          : b.type === "code"
                          ? "code"
                          : ""
                      }
                      spellCheck={b.type !== "code"}
                      className={`${blockClass(b)} ${
                        // Hidden rather than unmounted: the textarea keeps its
                        // scroll height, so swapping between the two never moves
                        // the line the cursor is about to land on.
                        editingId === b.id || !hasMarks(b.text) ? "" : "invisible absolute inset-0"
                      }`}
                    />
                    {editingId !== b.id && hasMarks(b.text) && (
                      <div
                        onMouseDown={(event) => {
                          // Put the caret where it was clicked, not at the end.
                          const offset = caretOffsetFromPoint(event);
                          setEditingId(b.id);
                          focusReq.current = { id: b.id, caret: offset ?? b.text.length };
                          event.preventDefault();
                        }}
                        className={`${blockClass(b)} cursor-text whitespace-pre-wrap`}
                      >
                        <FormattedText text={b.text} />
                      </div>
                    )}
                  </div>
                )}

                {/* Formatting toolbar, shown while text is selected in this block.
                    Above the line rather than over it, so it never covers the
                    words it is about to change. */}
                {selection && selection.blockId === b.id && (
                  <div className="absolute -top-9 left-0 z-30 flex items-center gap-0.5 rounded-lg border border-veil/10 bg-surface-raised p-1 shadow-2xl shadow-black/50">
                    {([
                      ["bold", "B", "Bold", "font-bold"],
                      ["italic", "I", "Italic", "italic font-serif"],
                      ["code", "<>", "Code", "font-mono text-[11px]"],
                      ["link", "[[ ]]", "Link to a paper or note", "font-mono text-[11px]"],
                    ] as const).map(([mark, glyph, title, className]) => (
                      <button
                        key={mark}
                        type="button"
                        // Keep the textarea's selection: a click that moves focus
                        // first would leave nothing to format.
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyMark(b.id, mark);
                        }}
                        title={`${title}${mark === "bold" ? " (⌘B)" : mark === "italic" ? " (⌘I)" : mark === "code" ? " (⌘E)" : " (⌘K)"}`}
                        aria-label={title}
                        className={`grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-slate-300 hover:bg-veil/[.08] hover:text-slate-100 ${className}`}
                      >
                        {glyph}
                      </button>
                    ))}
                  </div>
                )}

                {/* Contextual dropdown (slash / link) anchored under this block */}
                {menu && menu.blockId === b.id && menuLen > 0 && (
                  <ul className="absolute z-30 mt-1 w-72 max-h-72 overflow-auto bg-slate-800 border border-slate-600 rounded-lg shadow-2xl text-sm">
                    {menu.kind === "slash"
                      ? slashItems.map((c, i) => (
                          <li key={c.type}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlash(c.type);
                              }}
                              onMouseEnter={() => setActiveIndex(i)}
                              className={`w-full text-left px-3 py-2 flex flex-col ${
                                i === activeIndex ? "bg-slate-700" : ""
                              }`}
                            >
                              <span>{c.label}</span>
                              <span className="text-[11px] text-slate-400">
                                {c.hint}
                              </span>
                            </button>
                          </li>
                        ))
                      : linkItems.map((t, i) => (
                          <li key={`${t.type}:${t.id}`}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applyLink(t.title);
                              }}
                              onMouseEnter={() => setActiveIndex(i)}
                              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                                i === activeIndex ? "bg-slate-700" : ""
                              }`}
                            >
                              <span
                                className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                                  t.type === "paper"
                                    ? "bg-indigo-500/20 text-indigo-300"
                                    : "bg-emerald-500/20 text-emerald-300"
                                }`}
                              >
                                {t.type}
                              </span>
                              <span className="truncate">{t.title}</span>
                            </button>
                          </li>
                        ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contextual panel */}
      <aside className="min-h-0 overflow-auto border-l border-slate-800 pl-4">
        <section className="mb-5">
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
            Links ({outgoing.length})
          </h3>
          {outgoing.length === 0 ? (
            <p className="text-sm text-slate-600">
              Type <code className="bg-slate-800 px-1 rounded">[[</code> to link a
              paper or note.
            </p>
          ) : (
            <ul className="space-y-1">
              {outgoing.map((o, i) => (
                <li key={i}>
                  <button
                    onClick={() =>
                      onOpenTarget(
                        o.target || { id: "", title: o.title, type: "note" }
                      )
                    }
                    className={`text-sm text-left hover:underline ${
                      o.target ? "text-indigo-300" : "text-fuchsia-300"
                    }`}
                    title={o.target ? "Open" : "Create this note"}
                  >
                    {o.title}
                    {!o.target && " (new)"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">
            Backlinks ({backlinks.length})
          </h3>
          {backlinks.length === 0 ? (
            <p className="text-sm text-slate-600">
              Nothing links here yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {backlinks.map((bl) => (
                <li key={bl.id}>
                  <button
                    onClick={() =>
                      onOpenTarget({ id: bl.id, title: bl.title, type: "note" })
                    }
                    className="text-sm text-indigo-300 hover:underline text-left"
                  >
                    {bl.title || "Untitled note"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

/** Does this line contain anything worth rendering differently? */
function hasMarks(text: string): boolean {
  return /(\*\*[^*]+\*\*)|(`[^`]+`)|(\*[^*\n]+\*)|(\[\[[^\]]+\]\])/.test(text);
}

/** A line's inline Markdown, rendered. Wikilinks are shown without their brackets. */
function FormattedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  // Wikilinks first: they are the app's own syntax and sit outside Markdown.
  const segments = text.split(/(\[\[[^\]]+\]\])/g);
  segments.forEach((segment, index) => {
    const link = segment.match(/^\[\[([^\]]+)\]\]$/);
    if (link) {
      parts.push(
        <span key={`l${index}`} className="lat-wikilink">
          {link[1]}
        </span>
      );
      return;
    }
    for (const [i, token] of parseInlineMarkdown(segment).entries()) {
      const key = `${index}-${i}`;
      if (token.type === "bold") parts.push(<strong key={key} className="font-semibold text-slate-100">{token.value}</strong>);
      else if (token.type === "italic") parts.push(<em key={key}>{token.value}</em>);
      else if (token.type === "code") parts.push(<code key={key} className="lat-code">{token.value}</code>);
      else parts.push(<span key={key}>{token.value}</span>);
    }
  });
  return <>{parts}</>;
}

/** Character offset of a click inside rendered text, so the caret lands there. */
function caretOffsetFromPoint(event: React.MouseEvent<HTMLDivElement>): number | null {
  const target = event.currentTarget;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!range) return null;
  const measure = document.createRange();
  measure.selectNodeContents(target);
  try {
    measure.setEnd(range.startContainer, range.startOffset);
  } catch {
    return null;
  }
  // Length of the rendered text before the click. Close enough for a caret: the
  // delimiters are hidden, so this is the offset in the visible text.
  return measure.toString().length;
}

// The bullet changes shape with depth, the way it does in a word processor, so the
// level is readable even where the indent alone is ambiguous. Drawn rather than
// typed: the "•" character renders far too small next to body text at this size.
const BULLET_STYLES = ["solid", "hollow", "square"] as const;

function Bullet({ depth }: { depth: number }) {
  const style = BULLET_STYLES[depth % BULLET_STYLES.length];
  return (
    <span aria-hidden="true" className="mt-[0.55em] flex h-[7px] w-[7px] shrink-0 items-center justify-center">
      <span
        className={
          style === "square"
            ? "h-[6px] w-[6px] bg-slate-400"
            : style === "hollow"
            ? "h-[7px] w-[7px] rounded-full border-[1.5px] border-slate-400"
            : "h-[7px] w-[7px] rounded-full bg-slate-400"
        }
      />
    </span>
  );
}

// 1. / a. / i. by depth, cycling. Only the display changes: the note body is always
// written back as plain "1." Markdown.
function orderedMarker(n: number, indent: number): string {
  const style = indent % 3;
  if (style === 1) return `${toLetters(n)}.`;
  if (style === 2) return `${toRoman(n)}.`;
  return `${n}.`;
}

function toLetters(n: number): string {
  let out = "";
  let value = n;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    out = String.fromCharCode(97 + remainder) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out || "a";
}

function toRoman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let value = Math.max(1, Math.min(3999, n));
  let out = "";
  for (const [amount, numeral] of table) {
    while (value >= amount) {
      out += numeral;
      value -= amount;
    }
  }
  return out;
}

// Per-block-type styling for the textarea. Shared base keeps it a seamless block.
function blockClass(b: Block): string {
  const base =
    "w-full resize-none bg-transparent outline-none placeholder:text-slate-600 leading-relaxed overflow-hidden";
  switch (b.type) {
    case "h1":
      return `${base} text-2xl font-bold py-1`;
    case "h2":
      return `${base} text-xl font-bold py-1`;
    case "h3":
      return `${base} text-lg font-semibold py-0.5`;
    case "quote":
      return `${base} border-l-2 border-slate-600 pl-3 italic text-slate-300 py-0.5`;
    case "code":
      return `${base} font-mono text-sm bg-slate-900 border border-slate-800 rounded-md p-3 my-1`;
    case "todo":
      return `${base} ${b.checked ? "line-through text-slate-500" : ""}`;
    default:
      return `${base} py-0.5`;
  }
}
