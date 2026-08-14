// A Notion-style block editor for lattice notes.
//
// The note body is a list of typed blocks (paragraph, H1/H2/H3, bulleted list,
// numbered list, to-do, quote, code, divider). Pressing Enter creates a new block; a
// "/" slash menu inserts or turns the current block into a type; each block is its own
// editable element with a light hover affordance. [[wikilink]] autocomplete works
// inside every block. This is a lightweight, self-contained block model (not TipTap):
// blocks serialize to Markdown so backlinks, the graph, and the Supabase path all keep
// working on the same string form. See lib/blocks.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note, Paper } from "../types";
import {
  blocksToMarkdown,
  emptyBlock,
  markdownToBlocks,
  SLASH_COMMANDS,
  type Block,
  type BlockType,
} from "../lib/blocks";
import { backlinksFor, buildTitleIndex } from "../lib/graph";
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

  // ---- Change handler: text + menu detection ----
  function onChange(b: Block, e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const caret = e.target.selectionStart;
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
      const isList = b.type === "bullet" || b.type === "number" || b.type === "todo";
      // Enter on an empty list item ends the list (turns it into a paragraph).
      if (isList && b.text.trim() === "") {
        commit(blocks.map((x) => (x.id === b.id ? { ...x, type: "p" } : x)));
        return;
      }
      const before = b.text.slice(0, caret);
      const after = b.text.slice(caret);
      const nextType: BlockType = isList ? b.type : "p";
      const nb: Block = { ...emptyBlock(nextType), text: after };
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
      if (b.type !== "p") {
        // Backspace at the start of a styled block turns it back into a paragraph.
        e.preventDefault();
        setBlock(b.id, { type: "p", checked: undefined });
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

  // Running numbers for consecutive numbered-list blocks.
  const numbering = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const b of blocks) {
      if (b.type === "number") {
        n += 1;
        map.set(b.id, n);
      } else n = 0;
    }
    return map;
  }, [blocks]);

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
                  <div className="flex items-start gap-2">
                    {b.type === "bullet" && (
                      <span className="mt-2 text-slate-400 select-none leading-none">
                        •
                      </span>
                    )}
                    {b.type === "number" && (
                      <span className="mt-1 text-slate-400 select-none tabular-nums text-sm">
                        {numbering.get(b.id)}.
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
                      onBlur={() =>
                        setTimeout(() => {
                          setMenu((m) => (m && m.blockId === b.id ? null : m));
                        }, 150)
                      }
                      placeholder={
                        b.type === "p"
                          ? "Type text, or press / for blocks"
                          : b.type === "code"
                          ? "code"
                          : ""
                      }
                      spellCheck={b.type !== "code"}
                      className={blockClass(b)}
                    />
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
