import { Fragment, useEffect, useMemo, useState } from "react";
import type { Collection, Paper } from "../types";
import { labelSwatches } from "../lib/labelColor";
import { citationKey, formatBibliography, papersToBibTeX, papersToRis, type CitationStyle } from "../lib/citations";
import { IconChevron, IconCopy, IconDownload, IconFile, IconGrid, IconList, IconPlus, IconSearch, IconStar, IconTrash } from "./Icons";
import { metadataIssues } from "../lib/metadataQuality";
import { setRecordDrag } from "./dragTypes";
import { ProjectLabel } from "./ProjectDots";

type Sort = "added" | "title" | "author" | "year" | "opened" | "project";
type Layout = "table" | "cards";

interface Props {
  papers: Paper[];
  collections: Collection[];
  query: string;
  isSearchSaved: boolean;
  heading: string;
  description?: string;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Paper>) => void;
  onAddToCollection: (ids: string[], collectionId: string) => void;
  onAddTags: (ids: string[], tags: string[]) => void;
  onDeleteMany: (papers: Paper[]) => void;
  onMergeMany?: (papers: Paper[]) => void | Promise<void>;
  /** Bind the selected papers into one PDF. */
  onCombinePdfs: (papers: Paper[]) => void;
  /** Bind the whole library into one PDF, grouped by project. Only on "All papers". */
  onCombineLibrary?: () => void;
  /** Non-empty while that PDF is being built. */
  combining?: string;
  /** Fetch open-access PDFs for the selected papers that do not have one. */
  onFetchPdfs: (papers: Paper[]) => void;
  /** Open the quick-file dialog for one paper (double-click, or the folder button). */
  onFile: (paperId: string) => void;
  searchFocusToken: number;
  onSaveSearch: (query: string) => void;
}

function authorLabel(paper: Paper) {
  if (!paper.authors.length) return "Unknown author";
  if (paper.authors.length === 1) return paper.authors[0];
  return `${paper.authors[0]} et al.`;
}

/**
 * A rule down the left edge in the colour of the paper's project.
 *
 * Read from the project rather than set on the paper: the colour is there to say
 * which group this belongs to, and a paper in no project has nothing to say.
 * An inset shadow rather than a border, so a coloured row is exactly as tall as
 * an uncoloured one and the table does not shift as papers are filed.
 */
function projectRule(paper: Paper, collections: Collection[]): React.CSSProperties | undefined {
  for (const id of paper.collectionIds) {
    const color = collections.find((collection) => collection.id === id)?.color;
    if (color) return { boxShadow: `inset 3px 0 0 ${labelSwatches()[color].dot}` };
  }
  return undefined;
}

function downloadBibliography(papers: Paper[], label: string, format: "bib" | "ris") {
  const contents = format === "bib" ? papersToBibTeX(papers) : papersToRis(papers);
  const url = URL.createObjectURL(new Blob([contents], { type: format === "bib" ? "application/x-bibtex" : "application/x-research-info-systems" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lattice-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "library"}.${format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function LibraryView({
  papers, collections, query, isSearchSaved, heading, description, onQuery, onOpen, onAdd,
  onUpdate, onAddToCollection, onAddTags, onDeleteMany, onMergeMany, onFetchPdfs, onFile,
  onCombinePdfs, onCombineLibrary, combining,
  searchFocusToken,
  onSaveSearch,
}: Props) {
  const [layout, setLayout] = useState<Layout>(() => (localStorage.getItem("lattice.library.layout") as Layout) || "table");
  const [sort, setSort] = useState<Sort>("added");
  const [descending, setDescending] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState("");
  const [copied, setCopied] = useState("");
  const [citationStyle, setCitationStyle] = useState<CitationStyle>("apa");
  const [citationCopied, setCitationCopied] = useState(false);
  const [exportFormat, setExportFormat] = useState<"bib" | "ris">("bib");
  // Papers whose abstract is expanded in place. Reading one is a glance, not a
  // reason to lose your position in the list, so it opens inline rather than
  // navigating into the paper.
  const [openAbstracts, setOpenAbstracts] = useState<Set<string>>(new Set());

  function toggleAbstract(id: string) {
    setOpenAbstracts((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => papers.some((paper) => paper.id === id))));
  }, [papers]);

  useEffect(() => {
    if (searchFocusToken > 0) document.getElementById("lattice-library-search")?.focus();
  }, [searchFocusToken]);

  const sorted = useMemo(() => [...papers].sort((a, b) => {
    let value = 0;
    if (sort === "project") {
      // Unfiled papers sort together at one end rather than scattering through
      // the list, which is what makes this useful for triage.
      const nameOf = (paper: Paper) => {
        const first = paper.collectionIds
          .map((id) => collections.find((collection) => collection.id === id)?.name)
          .filter(Boolean)
          .sort()[0];
        return first || "\uffff";
      };
      value = nameOf(a).localeCompare(nameOf(b)) || a.title.localeCompare(b.title);
    }
    else if (sort === "title") value = a.title.localeCompare(b.title);
    else if (sort === "author") value = authorLabel(a).localeCompare(authorLabel(b));
    else if (sort === "year") value = (a.year || 0) - (b.year || 0);
    else if (sort === "opened") value = (a.lastOpenedAt || "").localeCompare(b.lastOpenedAt || "");
    else value = a.addedAt.localeCompare(b.addedAt);
    return descending ? -value : value;
  }), [papers, sort, descending, collections]);

  const selectedPapers = sorted.filter((paper) => selected.has(paper.id));
  const allSelected = sorted.length > 0 && selected.size === sorted.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setLayoutAndPersist(next: Layout) {
    setLayout(next);
    localStorage.setItem("lattice.library.layout", next);
  }

  async function copyKey(paper: Paper) {
    await navigator.clipboard.writeText(citationKey(paper));
    setCopied(paper.id);
    window.setTimeout(() => setCopied(""), 1_200);
  }

  async function copyCitations(items: Paper[]) {
    if (!items.length) return;
    await navigator.clipboard.writeText(formatBibliography(items, citationStyle));
    setCitationCopied(true);
    window.setTimeout(() => setCitationCopied(false), 1_500);
  }

  return (
    <div className="flex h-full flex-col bg-lattice-canvas">
      <header className="border-b border-veil/5 bg-surface-header/90 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="lat-kicker">Library · {papers.length} {papers.length === 1 ? "item" : "items"}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">{heading}</h1>
            {description && <p className="mt-1 text-xs text-slate-600">{description}</p>}
          </div>
          <div className="relative order-last w-full md:order-none md:ml-auto md:w-72">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input id="lattice-library-search" value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { onQuery(""); event.currentTarget.blur(); } }} placeholder="Search or try author:, tag:, color:…" className="lat-input w-full py-2 pl-9 pr-14 text-sm" />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-veil/[.07] bg-veil/[.03] px-1.5 py-0.5 font-sans text-[10px] text-slate-700">⌘K</kbd>
          </div>
          {query.trim() && <button onClick={() => onSaveSearch(query)} disabled={isSearchSaved} className="lat-secondary px-3 py-2 text-xs disabled:cursor-default disabled:text-cyan-300"><IconSearch width={13} /> {isSearchSaved ? "Saved" : "Save search"}</button>}
          <button onClick={onAdd} className="lat-primary px-3.5 py-2 text-sm"><IconPlus /> Add</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="lat-input px-2.5 py-1.5 text-xs">
            <option value="added">Date added</option><option value="opened">Last opened</option><option value="project">Project</option><option value="title">Title</option><option value="author">First author</option><option value="year">Year</option>
          </select>
          <button onClick={() => setDescending((value) => !value)} className="lat-secondary px-2.5 py-1.5 text-xs" title="Reverse sort">{descending ? "Newest first ↓" : "Oldest first ↑"}</button>
          <div className="flex"><select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as "bib" | "ris")} className="lat-input rounded-r-none px-2 py-1.5 text-xs" aria-label="Export format"><option value="bib">BibTeX</option><option value="ris">RIS</option></select><button onClick={() => downloadBibliography(sorted, heading, exportFormat)} disabled={!sorted.length} className="lat-secondary rounded-l-none px-2.5 py-1.5 text-xs disabled:opacity-40">Export</button></div>
          <div className="flex">
            <select value={citationStyle} onChange={(event) => setCitationStyle(event.target.value as CitationStyle)} className="lat-input rounded-r-none px-2 py-1.5 text-xs" aria-label="Citation style"><option value="apa">APA</option><option value="mla">MLA</option><option value="chicago">Chicago</option></select>
            <button onClick={() => void copyCitations(sorted)} disabled={!sorted.length} className="lat-secondary rounded-l-none px-2.5 py-1.5 text-xs disabled:opacity-40">{citationCopied ? "Copied!" : "Copy citations"}</button>
          </div>
          {onCombineLibrary && (
            <button
              onClick={onCombineLibrary}
              disabled={!!combining || !papers.some((paper) => paper.hasPdf)}
              className="lat-secondary px-2.5 py-1.5 text-xs disabled:opacity-40"
              title="Bind every paper into one PDF: a section for each project and subproject, then the papers not in any project"
            >
              <IconFile width={13} /> {combining ? `Combining ${combining}` : "Combine all PDFs"}
            </button>
          )}
          <div className="ml-auto flex rounded-lg border border-veil/[.07] bg-well/20 p-0.5">
            <button onClick={() => setLayoutAndPersist("table")} aria-label="Table view" className={`rounded-md p-1.5 ${layout === "table" ? "bg-veil/10 text-cyan-300" : "text-slate-600"}`}><IconList /></button>
            <button onClick={() => setLayoutAndPersist("cards")} aria-label="Card view" className={`rounded-md p-1.5 ${layout === "cards" ? "bg-veil/10 text-cyan-300" : "text-slate-600"}`}><IconGrid /></button>
          </div>
        </div>
      </header>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-cyan-400/10 bg-cyan-400/[.04] px-4 py-2.5 md:px-6">
          <span className="mr-1 text-xs font-medium text-cyan-200">{selected.size} selected</span>
          <select defaultValue="" onChange={(event) => { if (event.target.value) { selectedPapers.forEach((paper) => onUpdate(paper.id, { readingStatus: event.target.value as Paper["readingStatus"] })); event.target.value = ""; } }} className="lat-input px-2 py-1.5 text-xs"><option value="" disabled>Set status…</option><option value="inbox">To read</option><option value="reading">In progress</option><option value="read">Read</option></select>
          <select defaultValue="" onChange={(event) => { if (event.target.value) { onAddToCollection([...selected], event.target.value); event.target.value = ""; } }} className="lat-input px-2 py-1.5 text-xs"><option value="" disabled>Add to project…</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select>
          <div className="flex"><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && tagDraft.trim()) { onAddTags([...selected], tagDraft.split(",")); setTagDraft(""); } }} placeholder="Add tags…" className="lat-input w-28 rounded-r-none px-2 py-1.5 text-xs" /><button onClick={() => { if (tagDraft.trim()) { onAddTags([...selected], tagDraft.split(",")); setTagDraft(""); } }} className="lat-secondary rounded-l-none px-2 text-xs">Apply</button></div>
          <button onClick={() => onFetchPdfs(selectedPapers)} className="lat-secondary px-2.5 py-1.5 text-xs" title="Look for an open-access PDF for each selected paper that has none"><IconDownload width={13} /> Fetch PDFs</button>
          <button
            onClick={() => onCombinePdfs(selectedPapers)}
            disabled={!!combining || !selectedPapers.some((paper) => paper.hasPdf)}
            className="lat-secondary px-2.5 py-1.5 text-xs disabled:opacity-40"
            title="Bind the selected papers into a single PDF, with a contents page and bookmarks"
          >
            <IconFile width={13} /> {combining ? `Combining ${combining}` : "Combine PDFs"}
          </button>
          <button onClick={() => downloadBibliography(selectedPapers, "selection", exportFormat)} className="lat-secondary px-2.5 py-1.5 text-xs">Export {exportFormat.toUpperCase()}</button>
          <button onClick={() => void copyCitations(selectedPapers)} className="lat-secondary px-2.5 py-1.5 text-xs">Copy {citationStyle.toUpperCase()}</button>
          {onMergeMany && selectedPapers.length > 1 && <button onClick={() => void onMergeMany(selectedPapers)} className="lat-secondary border-cyan-400/20 px-2.5 py-1.5 text-xs text-cyan-200">Merge duplicates</button>}
          <button onClick={() => onDeleteMany(selectedPapers)} className="ml-auto text-slate-600 hover:text-rose-400" title="Remove selected"><IconTrash /></button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-slate-600 hover:text-slate-300">Clear</button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <div className="mx-auto mt-24 max-w-sm text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-veil/[.07] bg-veil/[.03] text-slate-600"><IconFile /></div><h2 className="mt-4 font-medium text-slate-300">Nothing here yet</h2><p className="mt-2 text-sm text-slate-600">Import a paper or choose another smart view.</p><button onClick={onAdd} className="lat-primary mt-5 px-4 py-2 text-sm"><IconPlus /> Add paper</button></div>
        ) : layout === "table" ? (
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-surface-header text-[10px] uppercase tracking-[.14em] text-slate-600"><tr className="border-b border-veil/5"><th className="w-12 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(sorted.map((paper) => paper.id)))} className="accent-cyan-400" aria-label="Select all papers" /></th><th className="w-8"></th><th className="w-9"></th><th className="px-3 py-3">Title</th><th className="px-3 py-3">Creator</th><th className="w-20 px-3 py-3">Year</th><th className="w-28 px-3 py-3">Status</th><th className="w-44 px-3 py-3">Project</th><th className="w-36 px-3 py-3">Citation key</th><th className="w-16 px-3 py-3">File</th></tr></thead>
            <tbody className="divide-y divide-veil/[.045]">{sorted.map((paper) => (
              <Fragment key={paper.id}>
              <tr
                draggable
                onDragStart={(event) => {
                  // Dragging one of several selected rows drags the selection, the
                  // way it does in a file manager.
                  const ids = selected.has(paper.id) ? [...selected] : [paper.id];
                  setRecordDrag(event.dataTransfer, { papers: ids, notes: [] });
                }}
                onDoubleClick={() => onFile(paper.id)}
                title="Double-click to file this paper into a project"
                className={`group hover:bg-veil/[.025] ${selected.has(paper.id) ? "bg-cyan-400/[.035]" : ""}`}
                style={projectRule(paper, collections)}
              >
                <td className="px-4 py-3"><input type="checkbox" checked={selected.has(paper.id)} onChange={() => toggle(paper.id)} className="accent-cyan-400" aria-label={`Select ${paper.title}`} /></td>
                <td><button onClick={() => toggleAbstract(paper.id)} aria-expanded={openAbstracts.has(paper.id)} className="grid h-6 w-6 place-items-center rounded text-slate-700 hover:bg-veil/[.06] hover:text-slate-300" aria-label={`${openAbstracts.has(paper.id) ? "Hide" : "Show"} the abstract of ${paper.title}`} title="Show the abstract"><IconChevron open={openAbstracts.has(paper.id)} width={14} /></button></td>
                <td><button onClick={() => onUpdate(paper.id, { favorite: !paper.favorite })} className={paper.favorite ? "text-amber-300" : "text-slate-800 group-hover:text-slate-600"} aria-label={`${paper.favorite ? "Unfavorite" : "Favorite"} ${paper.title}`}><IconStar filled={paper.favorite} width={15} /></button></td>
                <td className="max-w-md px-3 py-3"><button onClick={() => onOpen(paper.id)} className="block w-full text-left"><span className="line-clamp-1 text-sm font-medium text-slate-200 group-hover:text-slate-100">{paper.title || "Untitled paper"}</span><span className="mt-1 flex items-center gap-2 text-xs text-slate-700"><span className="truncate">{paper.venue || paper.doi || paper.abstract || "No publication details"}</span>{metadataIssues(paper).length > 0 && <span className="shrink-0 text-amber-500/70">{metadataIssues(paper).length} missing</span>}</span></button></td>
                <td className="max-w-48 px-3 py-3 text-xs text-slate-500"><span className="line-clamp-1">{authorLabel(paper)}</span></td>
                <td className="px-3 py-3 font-mono text-xs text-slate-600">{paper.year || "—"}</td>
                <td className="px-3 py-3"><select value={paper.readingStatus || "inbox"} onChange={(event) => onUpdate(paper.id, { readingStatus: event.target.value as Paper["readingStatus"] })} className={`lat-status status-${paper.readingStatus || "inbox"} bg-transparent outline-none`} aria-label={`Reading status for ${paper.title}`}><option value="inbox">To read</option><option value="reading">In progress</option><option value="read">Read</option></select></td>
                <td className="px-3 py-3"><ProjectLabel collections={collections} collectionIds={paper.collectionIds} onClick={() => onFile(paper.id)} label={paper.title || "this paper"} /></td>
                <td className="px-3 py-3"><button onClick={() => void copyKey(paper)} className="flex max-w-32 items-center gap-1.5 truncate font-mono text-[11px] text-slate-600 hover:text-cyan-300" title="Copy citation key"><span className="truncate">{citationKey(paper)}</span><IconCopy width={12} />{copied === paper.id && <span className="sr-only">Copied</span>}</button></td>
                <td className="px-3 py-3 text-xs">{paper.hasPdf ? <span className="text-emerald-400">PDF</span> : <span className="text-slate-800">—</span>}</td>
              </tr>
              {openAbstracts.has(paper.id) && (
                <tr className={selected.has(paper.id) ? "bg-cyan-400/[.035]" : ""} style={projectRule(paper, collections)}>
                  <td colSpan={10} className="px-4 pb-4 pt-0">
                    <div className="ml-8 max-w-3xl rounded-lg border border-veil/[.06] bg-well/25 p-3">
                      <p className="lat-kicker">Abstract</p>
                      <p className="lat-scroll mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-400">
                        {paper.abstract || "No abstract was captured for this paper. Open it and paste one under Organize."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}</tbody>
          </table>
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{sorted.map((paper) => (
            <li key={paper.id} draggable onDragStart={(event) => setRecordDrag(event.dataTransfer, { papers: selected.has(paper.id) ? [...selected] : [paper.id], notes: [] })} onDoubleClick={() => onFile(paper.id)} title="Double-click to file this paper into a project" className={`group relative overflow-hidden rounded-xl border p-4 ${selected.has(paper.id) ? "border-cyan-400/30 bg-cyan-400/[.035]" : "border-veil/[.07] bg-surface-card hover:border-veil/[.14]"}`} style={projectRule(paper, collections)}>
              <div className="flex items-start gap-2"><input type="checkbox" checked={selected.has(paper.id)} onChange={() => toggle(paper.id)} className="mt-1 accent-cyan-400" aria-label={`Select ${paper.title}`} /><button onClick={() => onOpen(paper.id)} className="min-w-0 flex-1 text-left"><h3 className="line-clamp-3 text-sm font-medium leading-5 text-slate-200">{paper.title}</h3><p className="mt-2 truncate text-xs text-slate-600">{authorLabel(paper)}{paper.year ? ` · ${paper.year}` : ""}</p></button><button onClick={() => onUpdate(paper.id, { favorite: !paper.favorite })} className={paper.favorite ? "text-amber-300" : "text-slate-700 hover:text-amber-300"} aria-label={`${paper.favorite ? "Unfavorite" : "Favorite"} ${paper.title}`}><IconStar filled={paper.favorite} width={15} /></button></div>
              {openAbstracts.has(paper.id) ? (
                <p className="lat-scroll mt-4 max-h-40 min-h-[3.75rem] overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-400">{paper.abstract || "No abstract was captured for this paper."}</p>
              ) : (
                <p className="mt-4 line-clamp-3 min-h-[3.75rem] text-xs leading-5 text-slate-600">{paper.takeaway || paper.abstract || "No abstract captured."}</p>
              )}
              <div className="mt-3"><ProjectLabel collections={collections} collectionIds={paper.collectionIds} onClick={() => onFile(paper.id)} label={paper.title || "this paper"} /></div>
              <button onClick={() => toggleAbstract(paper.id)} aria-expanded={openAbstracts.has(paper.id)} className="mt-2 flex items-center gap-1 text-[11px] text-slate-600 hover:text-cyan-300"><IconChevron open={openAbstracts.has(paper.id)} width={12} />{openAbstracts.has(paper.id) ? "Hide abstract" : "Read abstract"}</button>
              <div className="mt-3 flex items-center gap-2"><span className={`lat-status status-${paper.readingStatus || "inbox"}`}>{paper.readingStatus === "read" ? "Read" : paper.readingStatus === "reading" ? "In progress" : "To read"}</span><button onClick={() => void copyKey(paper)} className="flex items-center gap-1 font-mono text-[10px] text-slate-700 hover:text-cyan-300"><span className="max-w-24 truncate">{citationKey(paper)}</span><IconCopy width={11} /></button></div>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}
