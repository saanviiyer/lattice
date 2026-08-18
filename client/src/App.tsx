import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Collection, Note, Paper, PaperMetadata } from "./types";
import { repo } from "./lib/repository";
import { deletePdf, putPdf } from "./lib/blobStore";
import { getHealth } from "./lib/api";
import { buildGraph } from "./lib/graph";
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  workspaceBackupFilename,
} from "./lib/workspaceBackup";
const AddPaper = lazy(() => import("./components/AddPaper"));
const PaperView = lazy(() => import("./components/PaperView"));
const NoteEditor = lazy(() => import("./components/NoteEditor"));
const GraphView = lazy(() => import("./components/GraphView"));
import {
  IconGraph,
  IconLibrary,
  IconNote,
  IconPlus,
  IconSearch,
  IconTrash,
} from "./components/Icons";

type View =
  | { kind: "library" }
  | { kind: "paper"; id: string }
  | { kind: "note"; id: string }
  | { kind: "graph" };

export default function App() {
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const [view, setView] = useState<View>({ kind: "library" });
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [health, setHealth] = useState<{ mockMode: boolean; model: string } | null>(
    null
  );
  const [backupStatus, setBackupStatus] = useState("");

  useEffect(() => {
    getHealth()
      .then((h) => setHealth({ mockMode: h.mockMode, model: h.model }))
      .catch(() => setHealth(null));
  }, []);

  // Read current state from the repository on every render (cheap; localStorage).
  const papers = repo.listPapers();
  const collections = repo.listCollections();
  const notes = repo.listNotes();
  const tags = repo.allTags();

  const filteredPapers = useMemo(() => {
    const q = query.toLowerCase().trim();
    return papers.filter((p) => {
      if (collectionFilter && !p.collectionIds.includes(collectionFilter)) return false;
      if (tagFilter && !p.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.authors.join(" ").toLowerCase().includes(q) ||
        p.abstract.toLowerCase().includes(q) ||
        p.tags.join(" ").toLowerCase().includes(q)
      );
    });
  }, [papers, query, collectionFilter, tagFilter]);

  const standaloneNotes = useMemo(() => notes.filter((n) => !n.paperId), [notes]);
  const graphData = useMemo(() => buildGraph(papers, notes), [papers, notes]);

  // ---- Actions ----
  async function handleAdd(meta: PaperMetadata, opts: { pdfBlob?: Blob }) {
    const paper = repo.addPaper(meta, {
      collectionIds: collectionFilter ? [collectionFilter] : [],
      hasPdf: !!opts.pdfBlob,
    });
    if (opts.pdfBlob) {
      try {
        await putPdf(paper.id, opts.pdfBlob);
        repo.updatePaper(paper.id, { hasPdf: true });
      } catch {
        repo.updatePaper(paper.id, { hasPdf: false });
      }
    }
    setShowAdd(false);
    refresh();
  }

  function deletePaper(p: Paper) {
    if (!confirm(`Remove "${p.title}" from the library?`)) return;
    repo.deletePaper(p.id);
    if (p.hasPdf) void deletePdf(p.id);
    if (view.kind === "paper" && view.id === p.id) setView({ kind: "library" });
    refresh();
  }

  function openPaperNote(paperId: string) {
    const existing = repo.getPaperNote(paperId);
    const paper = repo.getPaper(paperId);
    if (existing) {
      setView({ kind: "note", id: existing.id });
      return;
    }
    const n = repo.createNote({
      title: `Notes: ${paper?.title || "paper"}`.slice(0, 80),
      body: paper ? `# Notes on [[${paper.title}]]\n\n` : "",
      paperId,
    });
    refresh();
    setView({ kind: "note", id: n.id });
  }

  function newNote(title = "Untitled note") {
    const n = repo.createNote({ title, body: "" });
    refresh();
    setView({ kind: "note", id: n.id });
  }

  function createCollection() {
    const name = prompt("New collection name")?.trim();
    if (!name) return;
    repo.createCollection(name);
    refresh();
  }

  function deleteCollection(c: Collection) {
    if (!confirm(`Delete collection "${c.name}"? Papers are kept.`)) return;
    repo.deleteCollection(c.id);
    if (collectionFilter === c.id) setCollectionFilter(null);
    refresh();
  }

  async function exportWorkspace() {
    setBackupStatus("Exporting…");
    try {
      const backup = await createWorkspaceBackup();
      const url = URL.createObjectURL(backup);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = workspaceBackupFilename();
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setBackupStatus("Backup saved");
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Backup failed");
    }
  }

  async function importWorkspace(file: File) {
    if (!confirm("Replace this browser's entire lattice workspace with this backup?")) return;
    setBackupStatus("Restoring…");
    try {
      const snapshot = await restoreWorkspaceBackup(file);
      setView({ kind: "library" });
      setCollectionFilter(null);
      setTagFilter(null);
      refresh();
      setBackupStatus(`Restored ${snapshot.papers.length} papers`);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Restore failed");
    }
  }

  // ---- Render helpers ----
  const activeNote =
    view.kind === "note" ? repo.getNote(view.id) : undefined;
  const activePaper =
    view.kind === "paper" ? repo.getPaper(view.id) : undefined;

  return (
    <div className="h-full flex text-slate-200">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="text-indigo-400">▚</span> lattice
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            annotate · link · see the graph
          </p>
        </div>

        <div className="p-3 space-y-2">
          <button
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-3 py-2 text-sm font-medium"
          >
            <IconPlus /> Add paper
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => newNote()}
              className="flex-1 flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 rounded-lg px-2 py-1.5 text-sm"
            >
              <IconNote /> Note
            </button>
            <button
              onClick={() => setView({ kind: "graph" })}
              className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-sm ${
                view.kind === "graph"
                  ? "bg-indigo-600"
                  : "bg-slate-800 hover:bg-slate-700"
              }`}
            >
              <IconGraph /> Graph
            </button>
          </div>
        </div>

        <div className="px-3">
          <button
            onClick={() => {
              setView({ kind: "library" });
              setCollectionFilter(null);
              setTagFilter(null);
            }}
            className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              view.kind === "library" && !collectionFilter && !tagFilter
                ? "bg-slate-800"
                : "hover:bg-slate-800/60"
            }`}
          >
            <IconLibrary /> All papers
            <span className="ml-auto text-xs text-slate-500">{papers.length}</span>
          </button>
        </div>

        {/* Collections */}
        <div className="px-3 mt-3">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              Collections
            </span>
            <button
              onClick={createCollection}
              className="text-slate-500 hover:text-slate-300"
              title="New collection"
            >
              <IconPlus width={14} height={14} />
            </button>
          </div>
          <ul className="space-y-0.5">
            {collections.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button
                  onClick={() => {
                    setView({ kind: "library" });
                    setCollectionFilter(c.id);
                    setTagFilter(null);
                  }}
                  className={`flex-1 text-left rounded-md px-3 py-1.5 text-sm truncate ${
                    collectionFilter === c.id ? "bg-slate-800" : "hover:bg-slate-800/60"
                  }`}
                >
                  {c.name}
                </button>
                <button
                  onClick={() => deleteCollection(c)}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 px-1"
                >
                  <IconTrash width={13} height={13} />
                </button>
              </li>
            ))}
            {collections.length === 0 && (
              <li className="text-xs text-slate-600 px-3 py-1">No collections yet</li>
            )}
          </ul>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="px-3 mt-3">
            <span className="text-[11px] uppercase tracking-wide text-slate-500 px-1">
              Tags
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setView({ kind: "library" });
                    setTagFilter(tagFilter === t ? null : t);
                    setCollectionFilter(null);
                  }}
                  className={`text-xs rounded-full px-2 py-0.5 ${
                    tagFilter === t
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="px-3 mt-3 flex-1 min-h-0 overflow-auto">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 px-1">
            Notes
          </span>
          <ul className="space-y-0.5 mt-1">
            {standaloneNotes.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setView({ kind: "note", id: n.id })}
                  className={`w-full text-left rounded-md px-3 py-1.5 text-sm truncate ${
                    view.kind === "note" && view.id === n.id
                      ? "bg-slate-800"
                      : "hover:bg-slate-800/60"
                  }`}
                >
                  {n.title || "Untitled note"}
                </button>
              </li>
            ))}
            {standaloneNotes.length === 0 && (
              <li className="text-xs text-slate-600 px-3 py-1">No notes yet</li>
            )}
          </ul>
        </div>

        <div className="px-3 py-2 border-t border-slate-800 text-[11px] text-slate-500 space-y-2">
          <div className="flex gap-1">
            <button
              onClick={exportWorkspace}
              className="flex-1 bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 text-slate-300"
            >
              Backup
            </button>
            <label className="flex-1 text-center bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 text-slate-300 cursor-pointer">
              Restore
              <input
                type="file"
                accept=".lattice,application/zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importWorkspace(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {backupStatus && <div className="truncate" title={backupStatus}>{backupStatus}</div>}
          {health
            ? health.mockMode
              ? "AI: mock mode (no key)"
              : `AI: ${health.model}`
            : "AI: offline"}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        <Suspense fallback={<LoadingView />}>
        {view.kind === "paper" && activePaper ? (
          <PaperView
            paper={activePaper}
            collections={collections}
            onBack={() => setView({ kind: "library" })}
            onOpenPaperNote={openPaperNote}
            onNoteCreated={refresh}
            onPaperUpdated={refresh}
          />
        ) : view.kind === "note" && activeNote ? (
          <NoteView
            note={activeNote}
            papers={papers}
            notes={notes}
            onChange={() => refresh()}
            onOpenPaper={(id) => setView({ kind: "paper", id })}
            onOpenNote={(id) => setView({ kind: "note", id })}
            onCreateNoteByTitle={(title) => {
              const n = repo.createNote({ title, body: "" });
              refresh();
              setView({ kind: "note", id: n.id });
            }}
            onBack={() => setView({ kind: "library" })}
            onDelete={() => {
              repo.deleteNote(activeNote.id);
              refresh();
              setView({ kind: "library" });
            }}
          />
        ) : view.kind === "graph" ? (
          <div className="flex flex-col h-full">
            <div className="px-4 py-2 border-b border-slate-800 font-medium">
              Knowledge graph
              <span className="ml-2 text-xs text-slate-500">
                {graphData.nodes.length} nodes · {graphData.edges.length} links
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <GraphView
                data={graphData}
                onOpenNode={(id) => {
                  if (repo.getPaper(id)) setView({ kind: "paper", id });
                  else if (repo.getNote(id)) setView({ kind: "note", id });
                }}
              />
            </div>
          </div>
        ) : (
          <Library
            papers={filteredPapers}
            collections={collections}
            query={query}
            onQuery={setQuery}
            onOpen={(id) => setView({ kind: "paper", id })}
            onDelete={deletePaper}
            onAdd={() => setShowAdd(true)}
            heading={
              collectionFilter
                ? collections.find((c) => c.id === collectionFilter)?.name || "Collection"
                : tagFilter
                ? `#${tagFilter}`
                : "All papers"
            }
          />
        )}
        </Suspense>
      </main>

      {showAdd && (
        <Suspense fallback={null}>
          <AddPaper onAdd={handleAdd} onClose={() => setShowAdd(false)} />
        </Suspense>
      )}
    </div>
  );
}

function LoadingView() {
  return (
    <div className="h-full grid place-items-center text-sm text-slate-500" role="status">
      Loading…
    </div>
  );
}

// ---- Library panel (paper list) ----
function Library({
  papers,
  collections,
  query,
  onQuery,
  onOpen,
  onDelete,
  onAdd,
  heading,
}: {
  papers: Paper[];
  collections: Collection[];
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onDelete: (p: Paper) => void;
  onAdd: () => void;
  heading: string;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3">
        <h1 className="text-lg font-semibold">{heading}</h1>
        <div className="ml-auto relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500">
            <IconSearch />
          </span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search papers…"
            className="bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-sm w-64 outline-none focus:border-indigo-500"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {papers.length === 0 ? (
          <div className="text-center text-slate-500 mt-20">
            <p className="mb-3">No papers here yet.</p>
            <button
              onClick={onAdd}
              className="bg-indigo-600 hover:bg-indigo-500 rounded-lg px-4 py-2 text-sm"
            >
              Add your first paper
            </button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {papers.map((p) => (
              <li
                key={p.id}
                className="group border border-slate-800 bg-slate-900 rounded-xl p-4 hover:border-slate-600 transition-colors"
              >
                <button onClick={() => onOpen(p.id)} className="text-left w-full">
                  <div className="flex items-start gap-2">
                    <h3 className="font-medium leading-snug line-clamp-3 flex-1">
                      {p.title || "Untitled paper"}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                    {p.authors.slice(0, 4).join(", ")}
                    {p.year ? ` · ${p.year}` : ""}
                  </p>
                  {p.abstract && (
                    <p className="text-sm text-slate-400 mt-2 line-clamp-3">
                      {p.abstract}
                    </p>
                  )}
                </button>
                <div className="flex items-center gap-2 mt-3">
                  <span
                    className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                      p.hasPdf
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {p.hasPdf ? "PDF" : p.source}
                  </span>
                  {p.collectionIds
                    .map((cid) => collections.find((c) => c.id === cid)?.name)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((name) => (
                      <span
                        key={name}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                      >
                        {name}
                      </span>
                    ))}
                  <button
                    onClick={() => onDelete(p)}
                    className="ml-auto opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400"
                    title="Remove"
                  >
                    <IconTrash />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---- Note view wrapper (header + editor) ----
function NoteView({
  note,
  papers,
  notes,
  onChange,
  onOpenPaper,
  onOpenNote,
  onCreateNoteByTitle,
  onBack,
  onDelete,
}: {
  note: Note;
  papers: Paper[];
  notes: Note[];
  onChange: () => void;
  onOpenPaper: (id: string) => void;
  onOpenNote: (id: string) => void;
  onCreateNoteByTitle: (title: string) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-slate-200">
          ← Library
        </button>
        {note.paperId && (
          <button
            onClick={() => onOpenPaper(note.paperId!)}
            className="text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1"
          >
            Open paper
          </button>
        )}
        <button
          onClick={onDelete}
          className="ml-auto text-sm text-slate-500 hover:text-rose-400"
        >
          Delete note
        </button>
      </div>
      <div className="flex-1 min-h-0 p-4">
        <Suspense fallback={<LoadingView />}>
          <NoteEditor
            note={note}
            papers={papers}
            notes={notes}
            onChangeBody={(body) => {
              repo.updateNote(note.id, { body });
              onChange();
            }}
            onChangeTitle={(title) => {
              repo.updateNote(note.id, { title });
              onChange();
            }}
            onOpenTarget={(t) => {
              if (t.id && t.type === "paper") onOpenPaper(t.id);
              else if (t.id && t.type === "note") onOpenNote(t.id);
              else if (!t.id) onCreateNoteByTitle(t.title);
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
