// The projects section of the sidebar.
//
// A project is a Collection; a subproject is a Collection with a parentId. They
// nest to any depth, which is what makes the sidebar usable once a library is
// organised around real work: "Thesis" holds "Chapter 2" holds "Pilot study",
// and selecting the parent shows everything underneath it.
//
// Every control here expands in place rather than opening a popover, because this
// column is itself a scroll container and a floating panel would be clipped by it.

import { useEffect, useRef, useState } from "react";
import type { Collection, LabelColor, Note, Paper, ResearchQuestion } from "../types";
import { buildCollectionTree, canReparent, collectionPath, type CollectionNode } from "../lib/collectionTree";
import { projectCounts } from "../lib/projectWorkspace";
import { labelSwatches } from "../lib/labelColor";
import { ColorSwatchRow } from "./ProjectColorRow";
import { IconChevron, IconImport, IconPlus, IconShare, IconSparkle, IconTrash } from "./Icons";
import {
  isProjectDrag,
  isRecordDrag,
  readRecordDrag,
  setProjectDrag,
  type RecordDrag,
} from "./dragTypes";

interface Props {
  collections: Collection[];
  papers: Paper[];
  notes: Note[];
  questions: ResearchQuestion[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string, parentId: string | null) => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: LabelColor | undefined) => void;
  onMove: (id: string, parentId: string | null) => void;
  onDelete: (collection: Collection) => void;
  /** Import a `.latticeproject` file someone shared. */
  onImportShared: (file: File) => void;
  /** File papers and notes dropped onto a project. */
  onDropRecords: (target: Collection, records: RecordDrag) => void;
  onAutoGroup: () => void;
  onExport: () => void;
  /** Remove every project, keeping the papers. */
  onClearAll: () => void;
}

const COLLAPSED_KEY = "lattice.projects.collapsed";

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export default function ProjectTree({
  collections,
  papers,
  notes,
  questions,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onRecolor,
  onMove,
  onDelete,
  onImportShared,
  onDropRecords,
  onAutoGroup,
  onExport,
  onClearAll,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  // Which node has its "new subproject" input open, "" for a new root project,
  // null for none.
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // The row a drag is currently hovering, and what kind of drag it is, so the
  // row can show what dropping would actually do.
  const [dropTarget, setDropTarget] = useState<{ id: string; kind: "project" | "records" } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // The same value in a ref. dragover fires before React has re-rendered from
  // dragstart, and dataTransfer.getData is deliberately blank until the drop, so
  // state alone cannot answer "what is being dragged?" at the moment it matters.
  const draggingRef = useRef<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ collection: Collection; x: number; y: number } | null>(null);

  // A context menu must not outlive the next click or key anywhere else.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menuFor]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // A lost collapse state is not worth failing over.
    }
  }, [collapsed]);

  const roots = buildCollectionTree(collections);

  // Everything filed under a project or anything beneath it — papers, notes, and
  // questions alike, because all three are what a project holds. Counting only the
  // papers would make a project that is all thinking and no reading look empty.
  //
  // Counted for the whole tree in one pass: this runs on every render of the app,
  // including every keystroke in the library search box.
  const counts = projectCounts(collections, papers, notes, questions);
  function countFor(collection: Collection): number {
    const count = counts.get(collection.id);
    return count ? count.papers + count.notes + count.questions : 0;
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitNew(parentId: string | null) {
    const name = draft.trim();
    if (name) onCreate(name, parentId);
    setDraft("");
    setAddingUnder(null);
    // A new subproject is invisible if its parent is collapsed.
    if (parentId) {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
  }

  function startEditing(collection: Collection) {
    setEditingId(collection.id === editingId ? null : collection.id);
    setRenameDraft(collection.name);
  }

  function submitRename(id: string) {
    const name = renameDraft.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  }

  function renderNode(node: CollectionNode) {
    const { collection, children, depth } = node;
    const isCollapsed = collapsed.has(collection.id);
    const isActive = activeId === collection.id;
    const count = countFor(collection);

    return (
      <li key={collection.id}>
        <div
          draggable
          onDragStart={(event) => {
            setProjectDrag(event.dataTransfer, collection.id);
            draggingRef.current = collection.id;
            setDraggingId(collection.id);
          }}
          onDragEnd={() => {
            draggingRef.current = null;
            setDraggingId(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            // Only accept what this row can actually take. A project cannot be
            // dropped inside its own subtree, so that row never lights up.
            event.stopPropagation();
            if (isProjectDrag(event.dataTransfer)) {
              const dragged = draggingRef.current;
              if (!dragged || dragged === collection.id) return;
              if (!canReparent(collections, dragged, collection.id)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget({ id: collection.id, kind: "project" });
            } else if (isRecordDrag(event.dataTransfer)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropTarget({ id: collection.id, kind: "records" });
            }
          }}
          onDragLeave={(event) => {
            event.stopPropagation();
            setDropTarget((current) => (current?.id === collection.id ? null : current));
          }}
          onDrop={(event) => {
            event.preventDefault();
            // The tree body behind this row is itself a drop zone meaning "move to
            // the top level". Without this the drop would land on both, and the
            // container would immediately undo the nesting.
            event.stopPropagation();
            setDropTarget(null);
            if (isProjectDrag(event.dataTransfer)) {
              const moved = event.dataTransfer.getData("application/x-lattice-project") || draggingRef.current;
              if (moved && moved !== collection.id && canReparent(collections, moved, collection.id)) {
                onMove(moved, collection.id);
                // A project dropped into a collapsed one would vanish.
                setCollapsed((current) => {
                  const next = new Set(current);
                  next.delete(collection.id);
                  return next;
                });
              }
            } else {
              const records = readRecordDrag(event.dataTransfer);
              if (records) onDropRecords(collection, records);
            }
            draggingRef.current = null;
            setDraggingId(null);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuFor({ collection, x: event.clientX, y: event.clientY });
          }}
          className={`group flex items-center rounded-md ${
            dropTarget?.id === collection.id
              ? dropTarget.kind === "project"
                ? "bg-cyan-400/10 ring-1 ring-cyan-400/50"
                : "bg-emerald-400/10 ring-1 ring-emerald-400/50"
              : isActive
              ? "bg-veil/[.06]"
              : "hover:bg-veil/[.035]"
          } ${draggingId === collection.id ? "opacity-40" : ""}`}
          // Each level steps in, with the disclosure triangle sitting in the gutter.
          style={{ paddingLeft: depth * 12 }}
        >
          {children.length > 0 ? (
            <button
              onClick={() => toggleCollapsed(collection.id)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${collection.name}`}
              className="grid h-5 w-5 shrink-0 place-items-center text-slate-600 hover:text-slate-300"
            >
              <IconChevron open={!isCollapsed} width={12} />
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}

          <span
            aria-hidden="true"
            className="mr-1.5 h-2 w-2 shrink-0 rounded-full border"
            style={{
              background: collection.color ? labelSwatches()[collection.color].dot : "transparent",
              borderColor: collection.color ? "transparent" : "rgba(148,163,184,.35)",
            }}
          />

          <button
            onClick={() => onSelect(collection.id)}
            className={`min-w-0 flex-1 truncate py-1.5 text-left text-sm ${isActive ? "text-slate-100" : "text-slate-400"}`}
            title={collection.name}
          >
            {collection.name}
          </button>

          <span
            className="px-1 text-[11px] tabular-nums text-slate-700"
            title={count ? `${count} papers, notes, and questions` : "Nothing filed here yet"}
          >
            {count || ""}
          </span>
          <button
            onClick={() => {
              setAddingUnder(addingUnder === collection.id ? null : collection.id);
              setDraft("");
            }}
            className="px-1 text-slate-700 opacity-0 hover:text-cyan-300 group-hover:opacity-100 focus:opacity-100"
            title={`New subproject in ${collection.name}`}
            aria-label={`New subproject in ${collection.name}`}
          >
            <IconPlus width={13} />
          </button>
          <button
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuFor({ collection, x: rect.left, y: rect.bottom + 4 });
            }}
            // Always present rather than revealed on hover: this is the only way
            // to rename, move, or delete a project, and an action nobody can find
            // is an action that does not exist.
            className="px-1 pr-1.5 text-slate-600 hover:text-slate-200"
            title={`Actions for ${collection.name}`}
            aria-label={`Actions for ${collection.name}`}
          >
            <span aria-hidden="true" className="text-[13px] leading-none tracking-tight">⋯</span>
          </button>
        </div>

        {editingId === collection.id && (
          <div
            className="my-1 space-y-2 rounded-lg border border-veil/[.07] bg-well/25 p-2"
            style={{ marginLeft: depth * 12 + 20 }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitRename(collection.id);
              }}
            >
              <input
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitRename(collection.id);
                  }
                  if (event.key === "Escape") setEditingId(null);
                }}
                aria-label={`Rename ${collection.name}`}
                className="lat-input w-full px-2 py-1 text-xs"
              />
            </form>

            <ColorSwatchRow
              value={collection.color}
              onChange={(color) => onRecolor(collection.id, color)}
              label={collection.name}
            />

            <label className="block text-[11px] text-slate-600">
              Nested under
              <select
                value={collection.parentId || ""}
                onChange={(event) => onMove(collection.id, event.target.value || null)}
                className="lat-input mt-1 w-full px-2 py-1 text-xs"
              >
                <option value="">Top level</option>
                {collections
                  .filter(
                    (candidate) =>
                      candidate.id !== collection.id &&
                      canReparent(collections, collection.id, candidate.id)
                  )
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>

            <div className="flex items-center justify-between pt-0.5">
              <button
                onClick={() => submitRename(collection.id)}
                className="lat-primary px-2.5 py-1 text-[11px]"
              >
                Done
              </button>
              <button
                onClick={() => {
                  setEditingId(null);
                  onDelete(collection);
                }}
                className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-rose-400"
              >
                <IconTrash width={12} /> Delete
              </button>
            </div>
          </div>
        )}

        {addingUnder === collection.id && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitNew(collection.id);
            }}
            className="my-1 flex gap-1"
            style={{ marginLeft: depth * 12 + 20 }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Explicit, rather than relying on the form's implicit submission:
                // the input is one of several in the sidebar and this is the only
                // behaviour that reads as obvious here.
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitNew(collection.id);
                }
                if (event.key === "Escape") {
                  setAddingUnder(null);
                  setDraft("");
                }
              }}
              placeholder={`Subproject of ${collection.name}`}
              aria-label={`Name of the new subproject in ${collection.name}`}
              className="lat-input min-w-0 flex-1 px-2 py-1 text-xs"
            />
            <button disabled={!draft.trim()} className="lat-primary px-2 disabled:opacity-40" aria-label="Create subproject">
              <IconPlus width={12} />
            </button>
          </form>
        )}

        {children.length > 0 && !isCollapsed && (
          <ul className="space-y-0.5">{children.map(renderNode)}</ul>
        )}
      </li>
    );
  }

  return (
    <div className="px-3 mt-3">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="lat-kicker">Projects</span>
        <span className="flex items-center gap-1.5">
        <button
          onClick={onAutoGroup}
          className="text-slate-500 hover:text-cyan-300"
          title="Group papers into projects by theme"
          aria-label="Group papers into projects by theme"
        >
          <IconSparkle width={14} height={14} />
        </button>
        <button
          onClick={onExport}
          className="text-slate-500 hover:text-cyan-300"
          title="Send projects to Claude or ChatGPT"
          aria-label="Send projects to an assistant"
        >
          <IconShare width={14} height={14} />
        </button>
        {collections.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-slate-600 hover:text-rose-400"
            title="Remove all projects — every paper, note, and question is kept"
            aria-label="Remove all projects, keeping the papers"
          >
            <IconTrash width={13} height={13} />
          </button>
        )}
        <label
          className="grid cursor-pointer place-items-center text-slate-500 hover:text-cyan-300"
          title="Import a project someone shared with you"
        >
          <IconImport width={14} height={14} />
          <span className="sr-only">Import a shared project</span>
          <input
            type="file"
            accept=".latticeproject,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportShared(file);
              event.target.value = "";
            }}
          />
        </label>
        <button
          onClick={() => {
            setAddingUnder(addingUnder === "" ? null : "");
            setDraft("");
          }}
          className="text-slate-500 hover:text-cyan-300"
          title="New project"
          aria-label="New project"
        >
          <IconPlus width={14} height={14} />
        </button>
        </span>
      </div>

      {addingUnder === "" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitNew(null);
          }}
          className="mb-2 flex gap-1"
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitNew(null);
              }
              if (event.key === "Escape") {
                setAddingUnder(null);
                setDraft("");
              }
            }}
            placeholder="Project name"
            aria-label="Name of the new project"
            className="lat-input min-w-0 flex-1 px-2 py-1.5 text-xs"
          />
          <button disabled={!draft.trim()} className="lat-primary px-2 disabled:opacity-40" aria-label="Create project">
            <IconPlus width={13} />
          </button>
        </form>
      )}

      {/* Bounded so a deep project tree cannot push the notes list off the
          bottom of the sidebar: the tree scrolls within its own space. */}
      <div
        className={`lat-scroll max-h-[42vh] overflow-y-auto rounded-md pr-0.5 ${
          dropTarget?.id === "__root__" ? "bg-cyan-400/[.06] ring-1 ring-cyan-400/40" : ""
        }`}
        // Dropping on the empty space below the tree lifts a project back to the
        // top level, which is otherwise only reachable through the menu.
        onDragOver={(event) => {
          const dragged = draggingRef.current;
          if (!isProjectDrag(event.dataTransfer) || !dragged) return;
          const collection = collections.find((item) => item.id === dragged);
          if (!collection || (collection.parentId ?? null) === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget({ id: "__root__", kind: "project" });
        }}
        onDragLeave={() => setDropTarget((current) => (current?.id === "__root__" ? null : current))}
        onDrop={(event) => {
          if (!isProjectDrag(event.dataTransfer)) return;
          event.preventDefault();
          const moved = event.dataTransfer.getData("application/x-lattice-project") || draggingRef.current;
          if (moved) onMove(moved, null);
          setDropTarget(null);
          draggingRef.current = null;
          setDraggingId(null);
        }}
      >
        <ul className="space-y-0.5">{roots.map(renderNode)}</ul>
        {menuFor && (
          <div
            role="menu"
            aria-label={`Actions for ${menuFor.collection.name}`}
            // Fixed to the viewport so the sidebar's own scrolling cannot clip it.
            style={{
              position: "fixed",
              left: Math.min(menuFor.x, window.innerWidth - 210),
              top: Math.min(menuFor.y, window.innerHeight - 250),
              zIndex: 60,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="w-52 rounded-lg border border-veil/10 bg-surface-raised p-1 shadow-2xl shadow-black/60"
          >
            {[
              {
                label: "Rename",
                run: () => startEditing(menuFor.collection),
              },
              {
                label: "New subproject",
                run: () => {
                  setAddingUnder(menuFor.collection.id);
                  setDraft("");
                  setCollapsed((current) => {
                    const next = new Set(current);
                    next.delete(menuFor.collection.id);
                    return next;
                  });
                },
              },
              {
                label: "Move to top level",
                run: () => onMove(menuFor.collection.id, null),
                disabled: (menuFor.collection.parentId ?? null) === null,
              },
            ].map((item) => (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.run();
                  setMenuFor(null);
                }}
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-slate-300 hover:bg-veil/[.06] hover:text-slate-100 disabled:cursor-default disabled:text-slate-700 disabled:hover:bg-transparent"
              >
                {item.label}
              </button>
            ))}

            <div className="mt-1 border-t border-veil/[.06] px-2.5 pb-1 pt-2">
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-600">Move into</p>
              <select
                value=""
                onChange={(event) => {
                  if (event.target.value) onMove(menuFor.collection.id, event.target.value);
                  setMenuFor(null);
                }}
                className="lat-input w-full px-2 py-1 text-xs"
                aria-label={`Move ${menuFor.collection.name} into another project`}
              >
                <option value="">Choose a project…</option>
                {collections
                  .filter(
                    (candidate) =>
                      candidate.id !== menuFor.collection.id &&
                      candidate.id !== (menuFor.collection.parentId ?? null) &&
                      canReparent(collections, menuFor.collection.id, candidate.id)
                  )
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {collectionPath(collections, candidate.id).join(" / ")}
                    </option>
                  ))}
              </select>
            </div>

            <div className="mt-1 border-t border-veil/[.06] pt-1">
              <button
                role="menuitem"
                onClick={() => {
                  const target = menuFor.collection;
                  setMenuFor(null);
                  onDelete(target);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
              >
                <IconTrash width={12} /> Delete project
              </button>
            </div>
          </div>
        )}

        {collections.length === 0 && (
          <p className="px-3 py-1 text-xs text-slate-600">
            No projects yet. Group papers by the work they belong to, then nest
            subprojects inside them.
          </p>
        )}
      </div>
    </div>
  );
}
