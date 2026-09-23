import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Collection, Note, Paper, PaperMetadata } from "./types";
import { repo, setStorageFailureHandler } from "./lib/repository";
import { flushRecords } from "./lib/recordStore";
import { ThemeToggle } from "./components/ThemeToggle";
import { SuggestedReading } from "./components/SuggestedReading";
import { useResolvedTheme } from "./lib/theme";
import { deletePdf, getPdf, putPdf } from "./lib/blobStore";
import { draftPlanWithClaude, getHealth, metadataByDoi, metadataFromPdf, type SuggestResult, type SuggestedPaper } from "./lib/api";
import { attachOpenAccessPdf, attachOpenAccessPdfs, canAutoAttach } from "./lib/autoPdf";
import { buildGraph } from "./lib/graph";
import { matchesLibraryQuery } from "./lib/librarySearch";
import { metadataIssues } from "./lib/metadataQuality";
import { choosePrimaryPaper, findDuplicateGroups } from "./lib/duplicates";
import type { BibliographyRecord } from "./lib/bibliographyImport";
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  workspaceBackupFilename,
} from "./lib/workspaceBackup";
import { fetchPendingClippings } from "./lib/clippings";
import { confirmAction, bridge, isDesktop, saveFileAs } from "./lib/desktop";
import {
  adoptWorkspaceFromDisk,
  flushWorkspaceMirror,
  scheduleWorkspaceMirror,
} from "./lib/workspaceMirror";
import { collectionPath, descendantIds } from "./lib/collectionTree";
import { computeGraphGrouping, type GraphGroup, type GroupingMode } from "./lib/graphGroups";
import {
  hasSampleWorkspace,
  removeSampleWorkspace,
  seedSampleWorkspace,
} from "./lib/sampleWorkspace";
const AddPaper = lazy(() => import("./components/AddPaper"));
const PaperView = lazy(() => import("./components/PaperView"));
const NoteEditor = lazy(() => import("./components/NoteEditor"));
const GraphView = lazy(() => import("./components/GraphView"));
const Inbox = lazy(() => import("./components/Inbox"));
const ResearchHome = lazy(() => import("./components/ResearchHome"));
const LibraryView = lazy(() => import("./components/LibraryView"));
const ProjectView = lazy(() => import("./components/ProjectView"));
const Guide = lazy(() => import("./components/Guide"));
import ProjectTree from "./components/ProjectTree";
import ProjectPicker from "./components/ProjectPicker";
import ProjectDots from "./components/ProjectDots";
import FileIntoProject, { type FilingTarget } from "./components/FileIntoProject";
import ShareProject from "./components/ShareProject";
import AutoGroup from "./components/AutoGroup";
import ExportContext from "./components/ExportContext";
import { proposeSubjectGroups, type SubjectGroup } from "./lib/subjectGroups";
import { proposeResearch, type ResearchProposal } from "./lib/researchProposals";
import { importProjectShare, readProjectShare } from "./lib/projectShare";
import { projectContents } from "./lib/projectWorkspace";
import { buildInterestProfile, paperEngagement } from "./lib/researchBrain";
import { buildPaperIndex, projectsForPaper, similarPapers } from "./lib/paperSimilarity";
import { draftPlan, planAsMarkdown, sanitizePlan, type ResearchPlan } from "./lib/researchPlan";
import { ResearchBrain } from "./components/ResearchBrain";
import { PlanView } from "./components/PlanView";
import { librarySections } from "./lib/librarySections";
import type { MergeOptions, MergeSection } from "./lib/mergedPdf";
import {
  IconClose,
  IconFolder,
  IconGraph,
  IconMenu,
  IconLatticeMark,
  IconInbox,
  IconHome,
  IconLibrary,
  IconBrain,
  IconNote,
  IconPlus,
  IconTrash,
  IconStar,
  IconFile,
  IconQuestion,
  IconSearch,
  IconCopy,
  IconCompass,
} from "./components/Icons";

type SmartFilter = "favorites" | "inbox" | "reading" | "unfiled" | "no-pdf" | "incomplete" | "duplicates" | null;

type View =
  | { kind: "home" }
  | { kind: "library" }
  | { kind: "project"; id: string }
  | { kind: "paper"; id: string }
  | { kind: "note"; id: string }
  | { kind: "graph" }
  | { kind: "inbox" }
  | { kind: "guide" }
  | { kind: "brain" }
  | { kind: "plan"; id: string };

export default function App() {
  const [tick, setTick] = useState(0);
  // Every mutation in the app funnels through refresh(), which makes it the one
  // place the desktop build needs in order to keep its on-disk mirror current.
  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    scheduleWorkspaceMirror();
  }, []);

  const [view, setView] = useState<View>({ kind: "home" });
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [smartFilter, setSmartFilter] = useState<SmartFilter>(null);
  const [savedSearchId, setSavedSearchId] = useState<string | null>(null);
  const [health, setHealth] = useState<{ mockMode: boolean; model: string; planning?: boolean } | null>(
    null
  );
  const [backupStatus, setBackupStatus] = useState("");
  const [inboxCount, setInboxCount] = useState(0);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "done" | "problem";
    action?: { label: string; run: () => void };
  } | null>(null);
  const [noteFilter, setNoteFilter] = useState("");
  // On a narrow screen the sidebar is a drawer. Projects and notes live only in
  // that column, so without this they are unreachable on a phone entirely.
  const [navOpen, setNavOpen] = useState(false);
  // False until the library has been read out of IndexedDB.
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  // Reading suggestions, kept for the session so returning to the desk is not another
  // round of network requests. A ref plus a tick: the cache is written from a child.
  const suggestionCache = useRef(new Map<string, SuggestResult>());
  const [, setSuggestionTick] = useState(0);
  // Most of the theme lands through CSS variables, but project colours are written as
  // inline styles, which no stylesheet can reach. Subscribing here re-renders the tree
  // on a theme change so those pick up the right palette.
  useResolvedTheme();
  // How the knowledge graph is grouped. Remembered, because it is a way of
  // looking at the library rather than a one-off action.
  const [groupingMode, setGroupingMode] = useState<GroupingMode>(
    () => (localStorage.getItem("lattice.graph.grouping") as GroupingMode) || "project"
  );
  // The paper or note currently being filed by the double-click gesture.
  const [filingId, setFilingId] = useState<{ kind: "paper" | "note"; id: string } | null>(null);
  // The project whose share sheet is open.
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [showAutoGroup, setShowAutoGroup] = useState(false);
  // null when closed; an array of project ids to pre-tick when open.
  const [exportingIds, setExportingIds] = useState<string[] | null>(null);
  // Papers whose open-access PDF is being fetched right now, so the paper view can
  // show progress for one the user has already opened.
  const [pdfFetching, setPdfFetching] = useState<Set<string>>(new Set());

  useEffect(() => {
    getHealth()
      .then((h) => setHealth({ mockMode: h.mockMode, model: h.model, planning: !!h.planning }))
      .catch(() => setHealth(null));
  }, []);

  // A save that fails must never be silent: past the browser quota the library would
  // otherwise keep accepting papers and storing none of them.
  useEffect(() => {
    setStorageFailureHandler(({ quotaExceeded }) => {
      showNotice(
        quotaExceeded
          ? "Out of browser storage — recent changes were not saved. Export your library, then remove some papers."
          : "This browser is blocking storage, so changes are not being saved.",
        "problem"
      );
    });
    return () => setStorageFailureHandler(null);
  }, []);

  // The library lives in IndexedDB, so it arrives asynchronously. Rendering before it
  // does would show an empty library and invite the user to re-add what they already
  // have, so the UI waits.
  useEffect(() => {
    let cancelled = false;
    repo
      .load()
      .catch((error) => {
        // Opening blank without a word would read as "my library is gone", and the
        // user's next move would be to add everything again on top of data that is
        // still there. Say what happened instead.
        if (cancelled) return;
        showProblem(
          error,
          "Could not open your library from this browser's storage."
        );
      })
      .finally(() => {
        if (cancelled) return;
        refresh();
        setLibraryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Writes are coalesced, so a tab closed moments after an edit could drop it.
  // pagehide fires on close, navigation, and mobile backgrounding alike.
  useEffect(() => {
    const flush = () => void flushRecords();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Poll the web-clipping queue so the sidebar badge reflects pending imports.
  const refreshInboxCount = useCallback(() => {
    fetchPendingClippings()
      .then((items) => setInboxCount(items.length))
      .catch(() => setInboxCount(0));
  }, []);
  useEffect(() => {
    refreshInboxCount();
    const timer = window.setInterval(refreshInboxCount, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshInboxCount]);

  // Any navigation closes the drawer: on a phone the destination is behind it.
  useEffect(() => {
    setNavOpen(false);
  }, [view]);

  useEffect(() => {
    if (!navOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView({ kind: "library" });
        setCollectionFilter(null);
        setTagFilter(null);
        setSmartFilter(null);
        setSavedSearchId(null);
        setSearchFocusToken((value) => value + 1);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  // ---- Desktop shell ----
  // Menu commands and Finder file opens arrive from the main process. Both are held
  // in refs so the listeners can be installed once at mount and still call the
  // current handlers, rather than being torn down and rebuilt on every render.
  const commandsRef = useRef<Record<string, () => void>>({});
  const openPdfRef = useRef<(paths: string[]) => void>(() => {});
  const [workspacePath, setWorkspacePath] = useState("");

  useEffect(() => {
    const api = bridge();
    if (!api) return;
    // Must wait for the library to load. Both branches below read the live store to
    // decide what to do, and before the load resolves it is empty -- which would look
    // like a fresh install, adopt a stale snapshot over the real library, and then
    // mirror the empty store back over the workspace folder.
    if (!libraryLoaded) return;
    let cancelled = false;

    // A launch with an empty browser store but a populated workspace folder (a
    // reinstall, a cleared profile, a folder copied from another machine) recovers
    // from disk instead of opening blank.
    void adoptWorkspaceFromDisk().then((count) => {
      if (cancelled) return;
      if (count > 0) {
        refresh();
        showNotice(`Recovered ${count} papers from your workspace folder.`);
      }
      // Write once on launch so the folder exists and is populated before the user's
      // first edit. Otherwise Reveal Workspace Folder shows an empty directory on a
      // fresh install and looks broken.
      scheduleWorkspaceMirror(0);
    });

    void api.workspacePath().then((value) => {
      if (!cancelled) setWorkspacePath(value);
    });

    const offCommand = api.onCommand((command) => commandsRef.current[command]?.());
    const offOpenPdf = api.onOpenPdf((paths) => openPdfRef.current(paths));
    // A debounced mirror would lose the last few seconds on quit.
    const flush = () => void flushWorkspaceMirror();
    window.addEventListener("beforeunload", flush);
    api.ready();

    return () => {
      cancelled = true;
      offCommand();
      offOpenPdf();
      window.removeEventListener("beforeunload", flush);
    };
  }, [refresh, libraryLoaded]);

  // Read current state from the repository on every render (cheap; localStorage).
  const papers = repo.listPapers();
  const collections = repo.listCollections();
  const notes = repo.listNotes();
  const questions = repo.listQuestions();
  const savedSearches = repo.listSavedSearches();
  const brainPrefs = repo.getBrain();
  const plans = repo.listPlans();
  const [drafting, setDrafting] = useState(false);

  // The brain and the similarity index are rebuilt only on the screens that show them,
  // and only when something in the library changed (tick).
  const allHighlights = () => papers.flatMap((paper) => repo.listHighlights(paper.id));
  const brainInputs = () => ({ papers, highlights: allHighlights(), notes, questions, collections, prefs: brainPrefs });
  const interestProfile = useMemo(
    () => (view.kind === "brain" ? buildInterestProfile(brainInputs()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.kind, tick]
  );
  const paperIndex = useMemo(
    () => (view.kind === "paper" ? buildPaperIndex(papers, allHighlights()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.kind, tick]
  );
  const tags = repo.allTags();
  const duplicateGroups = useMemo(() => findDuplicateGroups(papers), [papers]);
  const duplicateCandidateIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.ids)),
    [duplicateGroups]
  );

  // Selecting a project shows its papers and every subproject's papers, which is
  // what makes nesting useful: "Thesis" is the whole thesis, not just the items
  // that happened to be filed at the top level.
  const activeCollectionIds = useMemo(
    () => (collectionFilter ? new Set(descendantIds(collections, collectionFilter)) : null),
    [collections, collectionFilter]
  );

  const filteredPapers = useMemo(() => {
    const q = query.trim();
    return papers.filter((p) => {
      if (activeCollectionIds && !p.collectionIds.some((id) => activeCollectionIds.has(id))) return false;
      if (tagFilter && !p.tags.includes(tagFilter)) return false;
      if (smartFilter === "favorites" && !p.favorite) return false;
      if (smartFilter === "inbox" && (p.readingStatus || "inbox") !== "inbox") return false;
      if (smartFilter === "reading" && p.readingStatus !== "reading") return false;
      if (smartFilter === "unfiled" && p.collectionIds.length > 0) return false;
      if (smartFilter === "no-pdf" && p.hasPdf) return false;
      if (smartFilter === "incomplete" && metadataIssues(p).length === 0) return false;
      if (smartFilter === "duplicates" && !duplicateCandidateIds.has(p.id)) return false;
      return !q || matchesLibraryQuery(p, q);
    });
  }, [papers, query, activeCollectionIds, tagFilter, smartFilter, duplicateCandidateIds]);

  const standaloneNotes = useMemo(() => notes.filter((n) => !n.paperId), [notes]);
  const visibleNotes = useMemo(() => {
    const needle = noteFilter.trim().toLowerCase();
    if (!needle) return standaloneNotes;
    return standaloneNotes.filter((note) => note.title.toLowerCase().includes(needle));
  }, [standaloneNotes, noteFilter]);
  // The repository hands back fresh arrays on every render, so memoizing on those
  // would hand GraphView a new object each time and restart its force simulation
  // (losing zoom, pan, and node positions). Memoize on the built graph's content
  // instead, so the reference only changes when the graph genuinely changes.
  // papers/notes/questions are state, replaced wholesale by refresh(), so their
  // identity is already the right cache key. Building the graph unconditionally and
  // stringifying it to memoise cost a full rebuild plus a full serialise on every
  // render — including every keystroke in the search box, which touches none of it.
  const graphData = useMemo(
    () => buildGraph(papers, notes, questions),
    [papers, notes, questions]
  );
  // Recomputed when the library or the mode changes. The subject proposal is the
  // expensive half, and it only runs when that mode is actually being looked at.
  const graphGrouping = useMemo(
    () => computeGraphGrouping(groupingMode, papers, notes, questions, collections),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupingMode, graphData, collections.length, view.kind === "graph"]
  );

  /**
   * Group the unfiled papers into themed projects, in one action.
   *
   * No confirmation and no review step: the whole point of the button is that it
   * is one click. What makes that safe is the undo — every project it creates is
   * new, so putting it back means deleting exactly those and nothing else.
   */
  function groupPapersNow() {
    if (papers.length < 3) {
      showNotice("Add a few more papers first — there is nothing to find a theme in yet.", "problem");
      return;
    }

    const describe = (paper: Paper) => ({
      id: paper.id,
      title: paper.title || "",
      tags: paper.tags,
      abstract: paper.abstract || "",
    });

    // Loose papers first, so an existing arrangement is left alone where it can
    // be. But a library that is already mostly filed has few loose papers and no
    // shared vocabulary among them, and refusing on that basis is unhelpful: the
    // ask was "group my papers", so it falls back to all of them.
    const unfiled = papers.filter((paper) => paper.collectionIds.length === 0);
    let groups = unfiled.length >= 3 ? proposeSubjectGroups(unfiled.map(describe)).groups : [];
    let wholeLibrary = false;
    if (groups.length === 0) {
      groups = proposeSubjectGroups(papers.map(describe)).groups;
      wholeLibrary = true;
    }

    if (groups.length === 0) {
      showNotice(
        "These papers have too little in common to group. They need titles or abstracts that overlap.",
        "problem"
      );
      return;
    }

    const createdIds: string[] = [];
    let filed = 0;
    for (const group of groups) {
      const project = repo.createCollection(group.label);
      repo.updateCollection(project.id, {
        premise: `Grouped automatically from shared content: ${group.terms.slice(0, 4).join(", ")}. Replace this with what you actually think might be true.`,
      });
      createdIds.push(project.id);
      for (const paperId of group.documentIds) {
        const paper = repo.getPaper(paperId);
        if (!paper) continue;
        repo.setPaperCollections(paperId, [...paper.collectionIds, project.id]);
        filed += 1;
      }
    }
    refresh();
    showNotice(
      `Grouped ${filed} papers into ${createdIds.length} project${createdIds.length === 1 ? "" : "s"}` +
        `${wholeLibrary ? ", across your whole library" : ""}.`,
      "done",
      {
        label: "Undo",
        run: () => {
          // Only the projects this action created are removed; the papers, and any
          // filing that existed before, are untouched.
          for (const id of createdIds) repo.deleteCollection(id);
          setNotice(null);
          refresh();
        },
      }
    );
  }

  /** Turn accepted theme proposals into projects, filing their papers. */
  function createProjectsFromGroups(groups: SubjectGroup[]) {
    let created = 0;
    let filed = 0;
    for (const group of groups) {
      const project = repo.createCollection(group.label);
      repo.updateCollection(project.id, {
        premise: `Grouped automatically from shared content: ${group.terms.slice(0, 4).join(", ")}. Replace this with what you actually think might be true.`,
      });
      created += 1;
      for (const paperId of group.documentIds) {
        const paper = repo.getPaper(paperId);
        if (!paper || paper.collectionIds.includes(project.id)) continue;
        repo.setPaperCollections(paperId, [...paper.collectionIds, project.id]);
        filed += 1;
      }
    }
    setShowAutoGroup(false);
    refresh();
    showNotice(`Created ${created} project${created === 1 ? "" : "s"} and filed ${filed} papers.`);
  }

  function adoptGroupAsProject(group: GraphGroup) {
    const created = repo.createCollection(group.label);
    const paperIds = new Set(group.nodeIds);
    let filed = 0;
    for (const paper of papers) {
      if (!paperIds.has(paper.id)) continue;
      repo.setPaperCollections(paper.id, [...paper.collectionIds, created.id]);
      filed += 1;
    }
    for (const note of notes) {
      if (!paperIds.has(note.id)) continue;
      repo.setNoteCollections(note.id, [...(note.collectionIds || []), created.id]);
    }
    repo.updateCollection(created.id, {
      premise: group.terms?.length
        ? `Proposed from the library by shared content: ${group.terms.slice(0, 4).join(", ")}. Replace this with what you actually think might be true.`
        : "",
    });
    refresh();
    showNotice(`Created “${created.name}” and filed ${filed} papers into it.`);
    setGroupingMode("project");
  }

  // Suggestions drawn from the library's own shape. Only computed on the desk,
  // where they are shown.
  const proposals = useMemo(
    () => (view.kind === "home" ? proposeResearch(papers, questions, collections) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.kind, graphData, collections.length]
  );

  /**
   * Remove every project, keeping every paper, note, and question.
   *
   * Worth having because the grouping is meant to be re-run: you try a set of
   * collections, decide it is not the right cut of the library, and want to start
   * again — without that being the same thing as losing the reading.
   *
   * A confirmation *and* an undo, unlike deleting a single project. Deleting one
   * destroys nothing, so it only needs an undo; this destroys every name,
   * premise, colour, and nesting you have written, and the undo is a twelve
   * second window against work that could be months old.
   */
  function clearAllProjects() {
    const existing = repo.listCollections();
    if (existing.length === 0) return;

    const filedPapers = papers.filter((paper) => paper.collectionIds.length > 0).length;
    if (
      !confirm(
        `Remove all ${existing.length} projects?\n\n` +
          `Your ${papers.length} papers, ${notes.length} notes, and ${questions.length} questions are all kept — ` +
          `${filedPapers} papers simply stop being filed anywhere.\n\n` +
          `What is lost is the projects themselves: their names, premises, colours, and nesting.`
      )
    ) {
      return;
    }

    // Enough to put it all back: the projects, and who was in them.
    const snapshot = existing.map((collection) => ({ ...collection }));
    const paperMembership = papers
      .filter((paper) => paper.collectionIds.length)
      .map((paper) => [paper.id, [...paper.collectionIds]] as const);
    const noteMembership = notes
      .filter((note) => note.collectionIds?.length)
      .map((note) => [note.id, [...(note.collectionIds || [])]] as const);
    const questionMembership = questions
      .filter((question) => question.collectionIds?.length)
      .map((question) => [question.id, [...(question.collectionIds || [])]] as const);

    for (const collection of snapshot) repo.deleteCollection(collection.id);
    if (view.kind === "project") setView({ kind: "library" });
    setCollectionFilter(null);
    refresh();

    showNotice(
      `Removed ${snapshot.length} projects. All ${papers.length} papers kept.`,
      "done",
      {
        label: "Undo",
        run: () => {
          // Parents before children, and old ids mapped to new ones so the
          // membership can be reattached to the projects that replace them.
          const idMap = new Map<string, string>();
          const depth = (collection: Collection) => collectionPath(snapshot, collection.id).length;
          for (const collection of [...snapshot].sort((a, b) => depth(a) - depth(b))) {
            const parentId = collection.parentId ? idMap.get(collection.parentId) ?? null : null;
            const restored = repo.createCollection(collection.name, parentId);
            repo.updateCollection(restored.id, {
              color: collection.color,
              premise: collection.premise,
              status: collection.status,
            });
            idMap.set(collection.id, restored.id);
          }
          const remap = (ids: readonly string[]) =>
            ids.map((id) => idMap.get(id)).filter((id): id is string => !!id);
          for (const [paperId, ids] of paperMembership) repo.setPaperCollections(paperId, remap(ids));
          for (const [noteId, ids] of noteMembership) repo.setNoteCollections(noteId, remap(ids));
          for (const [questionId, ids] of questionMembership) {
            repo.setQuestionCollections(questionId, remap(ids));
          }
          setNotice(null);
          refresh();
        },
      }
    );
  }

  /** Turn a suggestion into a real project, with its evidence already filed. */
  function startProposal(proposal: ResearchProposal) {
    const project = repo.createCollection(proposal.title);
    repo.updateCollection(project.id, { premise: proposal.premise, status: "idea" });
    for (const paperId of proposal.paperIds) {
      const paper = repo.getPaper(paperId);
      if (!paper || paper.collectionIds.includes(project.id)) continue;
      repo.setPaperCollections(paperId, [...paper.collectionIds, project.id]);
    }
    for (const questionId of proposal.questionIds) {
      const question = repo.listQuestions().find((item) => item.id === questionId);
      if (question) {
        repo.setQuestionCollections(questionId, [...(question.collectionIds || []), project.id]);
      }
    }
    refresh();
    openProject(project.id);
    showNotice(
      `Started “${project.name}” with ${proposal.paperIds.length} papers. The premise is a first draft — rewrite it.`,
      "done",
      {
        label: "Undo",
        run: () => {
          repo.deleteCollection(project.id);
          setNotice(null);
          setView({ kind: "home" });
          refresh();
        },
      }
    );
  }

  const highlightCount = useMemo(
    () => papers.reduce((count, paper) => count + repo.listHighlights(paper.id).length, 0),
    [papers]
  );

  /**
   * Add a suggested paper. The suggestion carries enough to file it immediately, but
   * the DOI lookup returns the full record (authors, venue, abstract as the publisher
   * has it), so the library never holds a thinner copy than adding it by hand would.
   * If the lookup fails -- offline, or the DOI is not registered where we ask -- what
   * the suggestion already told us is still worth keeping.
   */
  const addSuggestedPaper = useCallback(
    async (suggestion: SuggestedPaper, projectId: string) => {
      let meta: PaperMetadata;
      try {
        meta = (await metadataByDoi(suggestion.doi)).paper;
      } catch {
        meta = {
          title: suggestion.title,
          authors: suggestion.authors,
          year: suggestion.year,
          venue: suggestion.venue,
          abstract: suggestion.abstract,
          doi: suggestion.doi,
          url: `https://doi.org/${suggestion.doi}`,
          source: "doi",
        } as PaperMetadata;
      }
      const paper = repo.addPaper(meta, { collectionIds: projectId ? [projectId] : [] });
      showNotice(`Saved “${paper.title}” to your library.`);
      refresh();
    },
    [refresh]
  );

  /**
   * Bind a set of papers into one PDF. Slow enough to need a progress count, and the
   * result is worth reporting precisely: a dossier that silently left out eight papers
   * would be trusted and wrong.
   */
  const [combining, setCombining] = useState("");
  const combinePdfs = useCallback(
    async (chosen: Paper[], title: string, premise?: string, sections?: MergeSection[]) => {
      if (!chosen.length) {
        showNotice("Nothing selected to bind.", "problem");
        return;
      }
      if (!chosen.some((paper) => paper.hasPdf)) {
        showNotice("None of these papers have a PDF attached yet.", "problem");
        return;
      }

      // Everything is held in memory at once while the file is written, and papers in
      // a real library run to several megabytes each — so a big project produces a
      // file of a few hundred megabytes and a matching spike. Worth a word first
      // rather than a long wait that might end in a crash.
      const withPdf = chosen.filter((paper) => paper.hasPdf).length;
      if (withPdf > 25) {
        const go = await confirmAction(
          `Bind ${withPdf} papers into one PDF?`,
          "A file this size can run to several hundred megabytes, and the app will be " +
            "busy while it is written. Binding one project at a time is lighter.",
          "Bind them"
        );
        if (!go) return;
      }

      setCombining(`0 / ${chosen.length}`);
      try {
        // Kept out of the main bundle: it is only needed when someone exports.
        const { buildMergedPdf, buildGroupedPdf } = await import("./lib/mergedPdf");
        const options: MergeOptions = {
          title,
          premise,
          includeHighlights: true,
          highlightsFor: (paperId) => repo.listHighlights(paperId),
          onProgress: ({ done, total }) => setCombining(`${done} / ${total}`),
        };
        const result = sections
          ? await buildGroupedPdf(sections, options)
          : await buildMergedPdf(chosen, options);

        const name = `${title.replace(/[^\w\s-]/g, "").trim() || "papers"}.pdf`;
        const saved = await saveFileAs(result.blob, name, [{ name: "PDF", extensions: ["pdf"] }]);
        if (saved === null && bridge()) return; // the save dialog was cancelled

        const megabytes = result.blob.size / 1024 / 1024;
        const size = megabytes < 1 ? "under 1" : megabytes.toFixed(0);
        const left = result.missing.length + result.failed.length;
        showNotice(
          `Bound ${result.included.length} paper${result.included.length === 1 ? "" : "s"} into ` +
            `${result.totalPages} pages (${size} MB)` +
            (left ? `. ${left} could not be included — the contents page lists them.` : "."),
          left ? "problem" : "done"
        );
      } catch (error) {
        showProblem(error, "Could not build the PDF. A very large project may run out of memory.");
      } finally {
        setCombining("");
      }
    },
    []
  );

  // Every paper in the library in one file, each project and subproject under its
  // own heading and the unfiled papers last.
  const combineLibraryPdfs = useCallback(() => {
    return combinePdfs(papers, "Library", undefined, librarySections(collections, papers));
  }, [collections, papers, combinePdfs]);

  const combineProjectPdfs = useCallback(
    (project: Collection) => {
      const contents = projectContents(project, collections, papers, notes, questions);
      return combinePdfs(contents.papers, project.name, project.premise);
    },
    [collections, papers, notes, questions, combinePdfs]
  );

  // ---- Proposals ----
  /** Open a project's proposal, drafting one from the library if it has none. */
  function openProposalFor(projectId: string) {
    const existing = plans.find((plan) => plan.projectId === projectId);
    if (existing) {
      setView({ kind: "plan", id: existing.id });
      return;
    }
    const project = repo.getCollection(projectId);
    if (!project) return;
    const contents = projectContents(project, collections, papers, notes, questions);
    const engagementOrder = paperEngagement(brainInputs()).map((entry) => entry.paper.id);
    const plan = repo.savePlan(draftPlan(project, contents, { engagementOrder }));
    refresh();
    setView({ kind: "plan", id: plan.id });
  }

  async function draftProposalWithClaude(planId: string) {
    const plan = repo.getPlan(planId);
    const project = plan?.projectId ? repo.getCollection(plan.projectId) : undefined;
    if (!plan || !project) {
      showNotice("This proposal's project no longer exists, so there is nothing to draft from.", "problem");
      return;
    }
    const contents = projectContents(project, collections, papers, notes, questions);
    setDrafting(true);
    try {
      const profile = buildInterestProfile(brainInputs());
      const result = await draftPlanWithClaude({
        project: { name: project.name, premise: project.premise },
        papers: contents.papers.map((paper) => ({
          id: paper.id,
          title: paper.title,
          year: paper.year,
          abstract: paper.abstract?.slice(0, 1500),
          takeaway: paper.takeaway,
        })),
        questions: contents.questions
          .filter((question) => question.status !== "resolved")
          .map((question) => ({ title: question.title, detail: question.detail })),
        notes: contents.notes.slice(0, 6).map((note) => ({ title: note.title, body: note.body.slice(0, 1500) })),
        interests: profile.topics.map((topic) => topic.label),
      });
      // Checked again here against the whole library, and repaired where the task
      // graph does not hold together.
      const { plan: next, droppedCitations } = sanitizePlan(result.plan, papers.map((paper) => paper.id), {
        id: plan.id,
        projectId: plan.projectId,
        source: "claude",
        model: result.model,
      });
      repo.savePlan({ ...next, createdAt: plan.createdAt });
      refresh();
      const dropped = result.droppedCitations + droppedCitations;
      showNotice(
        dropped
          ? `Claude drafted the proposal. ${dropped} citation${dropped === 1 ? "" : "s"} to papers not in your library ${dropped === 1 ? "was" : "were"} removed.`
          : "Claude drafted the proposal."
      );
    } catch (error) {
      showProblem(error, "Could not draft the proposal with Claude.");
    } finally {
      setDrafting(false);
    }
  }

  /** Keep the proposal as a note in its project, updating the one saved before. */
  function saveProposalAsNote(plan: ResearchPlan) {
    const title = `Proposal: ${plan.title}`;
    const body = planAsMarkdown(plan, papers);
    const collectionIds = plan.projectId && repo.getCollection(plan.projectId) ? [plan.projectId] : [];
    const existing = notes.find(
      (note) => note.title === title && collectionIds.every((id) => note.collectionIds?.includes(id))
    );
    if (existing) repo.updateNote(existing.id, { body });
    else repo.createNote({ title, body, collectionIds });
    refresh();
    showNotice(existing ? `Updated the note “${title}”.` : `Saved as the note “${title}”.`);
  }

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
    showNotice(`Saved “${paper.title}” to your library.`);
    refresh();
    // A paper added by DOI or arXiv id arrives as metadata only. If an open-access
    // copy exists, fetch it now rather than leaving the user to go and download it:
    // in the background, so saving stays instant and a slow repository never blocks.
    if (!opts.pdfBlob) void autoAttachPdf(paper.id);
  }

  async function autoAttachPdf(paperId: string) {
    if (!canAutoAttach(paperId)) return;
    setPdfFetching((current) => new Set(current).add(paperId));
    try {
      await attachOpenAccessPdf(paperId);
      const title = repo.getPaper(paperId)?.title || "this paper";
      showNotice(`Attached the open-access PDF for “${title}”.`);
      refresh();
    } catch {
      // No open-access copy. Silent on an automatic attempt: the paper saved fine,
      // and the paper view offers an explicit retry that does report why.
    } finally {
      setPdfFetching((current) => {
        const next = new Set(current);
        next.delete(paperId);
        return next;
      });
    }
  }

  // Importing a project someone sent. This merges into the library rather than
  // replacing it, so unlike a workspace restore it needs no scary confirmation:
  // nothing already here can be overwritten by it.
  async function importSharedProject(file: File) {
    setBackupStatus("Reading shared project…");
    try {
      const { share, pdfs } = await readProjectShare(file);
      const summary = await importProjectShare(share, pdfs);
      setBackupStatus("");
      const from = summary.sharedBy ? ` from ${summary.sharedBy}` : "";
      const merged = summary.papersAlreadyHad
        ? `, ${summary.papersAlreadyHad} matched to papers you already had`
        : "";
      showNotice(
        `Imported “${summary.projectName}”${from}: ${summary.papersAdded} new papers${merged}, ` +
          `${summary.notes} notes, ${summary.questions} questions.`
      );
      refresh();
      openProject(summary.projectId);
    } catch (error) {
      setBackupStatus("");
      showProblem(error, "That file could not be imported.");
    }
  }

  // The same fetch, asked for deliberately. This one says why it failed.
  async function fetchPdfExplicitly(paperId: string) {
    setPdfFetching((current) => new Set(current).add(paperId));
    try {
      const found = await attachOpenAccessPdf(paperId);
      showNotice(`Attached the PDF from ${found.via === "arxiv" ? "arXiv" : hostOf(found.source)}.`);
      refresh();
    } catch (error) {
      showProblem(error, "No open-access PDF was found.");
    } finally {
      setPdfFetching((current) => {
        const next = new Set(current);
        next.delete(paperId);
        return next;
      });
    }
  }

  // Backfill a whole selection at once, for a library imported from BibTeX or built
  // up before this existed.
  async function fetchPdfsFor(items: Paper[]) {
    const targets = items.filter((paper) => canAutoAttach(paper.id)).map((paper) => paper.id);
    if (!targets.length) {
      showNotice("Every selected paper either has a PDF already or has no DOI to look one up by.", "problem");
      return;
    }
    setBackupStatus(`Looking for ${targets.length} PDF${targets.length === 1 ? "" : "s"}…`);
    const { attached } = await attachOpenAccessPdfs(targets, (done, total) => {
      setBackupStatus(`Looking for PDFs… ${done}/${total}`);
    });
    setBackupStatus("");
    showNotice(
      attached === 0
        ? `No open-access copies were available for those ${targets.length} papers.`
        : `Attached ${attached} of ${targets.length} PDFs. The rest have no open-access copy.`,
      attached === 0 ? "problem" : "done"
    );
    refresh();
  }

  function handleBibliographyImport(records: BibliographyRecord[]) {
    const before = repo.listPapers().length;
    for (const record of records) {
      repo.addPaper(record.metadata, {
        collectionIds: collectionFilter ? [collectionFilter] : [],
        tags: record.tags,
      });
    }
    const added = repo.listPapers().length - before;
    const merged = Math.max(0, records.length - added);
    setShowAdd(false);
    showNotice(`Imported ${records.length} reference${records.length === 1 ? "" : "s"}${merged ? ` · ${merged} merged with existing items` : ""}.`);
    refresh();
  }

  function showNotice(
    message: string,
    tone: "done" | "problem" = "done",
    action?: { label: string; run: () => void }
  ) {
    setNotice({ message, tone, action });
    // A problem is worth reading twice; a confirmation is not; and something you
    // might want to undo has to stay long enough to reach for.
    window.setTimeout(() => setNotice(null), action ? 12_000 : tone === "problem" ? 7_000 : 3_500);
  }

  /** Report a failed action, using the error's own message where it has one. */
  function showProblem(error: unknown, fallback: string) {
    showNotice(error instanceof Error && error.message ? error.message : fallback, "problem");
  }

  function deleteManyPapers(items: Paper[]) {
    if (!items.length || !confirm(`Remove ${items.length} selected paper${items.length === 1 ? "" : "s"} from the library?`)) return;
    for (const paper of items) {
      repo.deletePaper(paper.id);
      if (paper.hasPdf) void deletePdf(paper.id);
    }
    refresh();
  }

  // Papers and notes dropped onto a project in the sidebar.
  function fileDroppedRecords(target: Collection, records: { papers: string[]; notes: string[] }) {
    let filed = 0;
    for (const id of records.papers) {
      const paper = repo.getPaper(id);
      if (!paper || paper.collectionIds.includes(target.id)) continue;
      repo.setPaperCollections(id, [...paper.collectionIds, target.id]);
      filed += 1;
    }
    for (const id of records.notes) {
      const note = repo.getNote(id);
      if (!note || note.collectionIds?.includes(target.id)) continue;
      repo.setNoteCollections(id, [...(note.collectionIds || []), target.id]);
      filed += 1;
    }
    refresh();
    showNotice(
      filed === 0
        ? `Already in “${target.name}”.`
        : `Filed ${filed} item${filed === 1 ? "" : "s"} into “${target.name}”.`,
      filed === 0 ? "problem" : "done"
    );
  }

  function addPapersToCollection(ids: string[], collectionId: string) {
    for (const id of ids) {
      const paper = repo.getPaper(id);
      if (paper) repo.setPaperCollections(id, [...paper.collectionIds, collectionId]);
    }
    refresh();
  }

  function addPaperTags(ids: string[], nextTags: string[]) {
    const cleaned = nextTags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean);
    for (const id of ids) {
      const paper = repo.getPaper(id);
      if (paper) repo.setPaperTags(id, [...paper.tags, ...cleaned]);
    }
    refresh();
  }

  async function mergeDuplicatePapers(items: Paper[]) {
    if (items.length < 2) return;
    const primary = choosePrimaryPaper(items);
    if (!primary) return;
    const duplicates = items.filter((paper) => paper.id !== primary.id);
    if (!confirm(`Merge ${items.length} records into “${primary.title}”? Collections, tags, notes, highlights, questions, and the richest PDF are preserved.`)) return;
    try {
      let preservedPdf = await getPdf(primary.id);
      if (!preservedPdf) {
        for (const duplicate of duplicates) {
          preservedPdf = await getPdf(duplicate.id);
          if (preservedPdf) {
            await putPdf(primary.id, preservedPdf);
            break;
          }
        }
      }
      repo.mergePapers(primary.id, duplicates.map((paper) => paper.id));
      repo.updatePaper(primary.id, { hasPdf: !!preservedPdf });
      for (const duplicate of duplicates) await deletePdf(duplicate.id);
      showNotice(`Merged ${items.length} records into one complete reference.`);
      refresh();
    } catch (error) {
      showProblem(error, "Could not merge these records.");
    }
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

  // A note made while a project is open belongs to that project. Thinking is
  // evidence too, and having to file it by hand afterwards is how it gets lost.
  function newNote(title = "Untitled note", body = "") {
    const n = repo.createNote({
      title,
      body,
      collectionIds: collectionFilter ? [collectionFilter] : [],
    });
    refresh();
    setView({ kind: "note", id: n.id });
  }

  // Selecting a project opens its own page rather than a filtered paper list. The
  // filter is set alongside it so that adding a paper from here files it into this
  // project, and "Papers as a list" lands on the right library view.
  function openProject(id: string) {
    setCollectionFilter(id);
    setTagFilter(null);
    setSmartFilter(null);
    setSavedSearchId(null);
    setQuery("");
    setView({ kind: "project", id });
  }

  function openPaper(id: string) {
    repo.updatePaper(id, { lastOpenedAt: new Date().toISOString() });
    refresh();
    setView({ kind: "paper", id });
  }

  /**
   * Delete a project, with an undo rather than a confirmation.
   *
   * Nothing is destroyed by this — papers, notes, and questions are kept and
   * subprojects move up a level — so a modal asking "are you sure?" was making
   * the reversible feel dangerous. What is actually lost is the project's own
   * name, colour, premise, and the membership pointing at it, and all of that is
   * small enough to hold on to and put back.
   */
  function deleteCollection(c: Collection) {
    const children = collections.filter((item) => item.parentId === c.id).map((item) => item.id);
    const paperIds = papers.filter((paper) => paper.collectionIds.includes(c.id)).map((p) => p.id);
    const noteIds = notes.filter((note) => note.collectionIds?.includes(c.id)).map((n) => n.id);
    const questionIds = questions
      .filter((question) => question.collectionIds?.includes(c.id))
      .map((q) => q.id);
    const removed = { ...c };

    repo.deleteCollection(c.id);
    if (collectionFilter === c.id) setCollectionFilter(null);
    // Standing on the page of a project that no longer exists is a dead end.
    if (view.kind === "project" && view.id === c.id) setView({ kind: "library" });
    refresh();

    const scope = [
      paperIds.length && `${paperIds.length} paper${paperIds.length === 1 ? "" : "s"}`,
      children.length && `${children.length} subproject${children.length === 1 ? "" : "s"}`,
    ].filter(Boolean).join(" and ");

    showNotice(
      `Deleted “${removed.name}”.${scope ? ` ${scope[0].toUpperCase()}${scope.slice(1)} kept.` : ""}`,
      "done",
      {
        label: "Undo",
        run: () => {
          // Re-created rather than restored: the id is gone, so everything that
          // pointed at it is pointed at the new one instead.
          const restored = repo.createCollection(removed.name, removed.parentId ?? null);
          repo.updateCollection(restored.id, {
            color: removed.color,
            premise: removed.premise,
            status: removed.status,
          });
          for (const id of children) repo.moveCollection(id, restored.id);
          for (const id of paperIds) {
            const paper = repo.getPaper(id);
            if (paper) repo.setPaperCollections(id, [...paper.collectionIds, restored.id]);
          }
          for (const id of noteIds) {
            const note = repo.getNote(id);
            if (note) repo.setNoteCollections(id, [...(note.collectionIds || []), restored.id]);
          }
          for (const id of questionIds) {
            const question = repo.listQuestions().find((item) => item.id === id);
            if (question) repo.setQuestionCollections(id, [...(question.collectionIds || []), restored.id]);
          }
          setNotice(null);
          refresh();
          openProject(restored.id);
        },
      }
    );
  }

  async function exportWorkspace() {
    setBackupStatus("Exporting…");
    try {
      const backup = await createWorkspaceBackup();
      // A real save panel on the desktop, a download in a browser tab.
      const saved = await saveFileAs(backup, workspaceBackupFilename(), [
        { name: "lattice workspace", extensions: ["lattice"] },
      ]);
      if (saved === null) {
        setBackupStatus("");
        return;
      }
      setBackupStatus(saved ? `Saved to ${saved}` : "Backup saved");
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Backup failed");
    }
  }

  // Desktop: pick the archive through a native open panel rather than a file input.
  async function pickAndRestore() {
    const api = bridge();
    if (!api) return;
    const picked = await api.openFile({
      filters: [{ name: "lattice workspace", extensions: ["lattice", "zip"] }],
    });
    if (!picked) return;
    await importWorkspace(new File([picked.bytes], picked.name));
  }

  async function importWorkspace(file: File) {
    const ok = await confirmAction(
      "Replace your entire lattice workspace?",
      "Everything currently in lattice is replaced by the contents of this backup. This cannot be undone.",
      "Replace"
    );
    if (!ok) return;
    setBackupStatus("Restoring…");
    try {
      const snapshot = await restoreWorkspaceBackup(file);
      setView({ kind: "library" });
      setCollectionFilter(null);
      setTagFilter(null);
      setSmartFilter(null);
      setSavedSearchId(null);
      refresh();
      await flushWorkspaceMirror();
      setBackupStatus(`Restored ${snapshot.papers.length} papers`);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Restore failed");
    }
  }

  // Import one or more PDFs the user opened from Finder, the dock, or File > Open.
  async function importPdfPaths(paths: string[]) {
    const api = bridge();
    if (!api) return;
    for (const filePath of paths) {
      const picked = await api.readFile(filePath);
      if (!picked) {
        showNotice("That file could not be read.");
        continue;
      }
      const file = new File([picked.bytes], picked.name, { type: "application/pdf" });
      try {
        const result = await metadataFromPdf(file);
        await handleAdd(result.paper, { pdfBlob: file });
      } catch (error) {
        // Metadata extraction needs the embedded API. Losing it should not lose the
        // document, so the PDF is still saved with the filename as its title.
        await handleAdd(
          {
            title: picked.name.replace(/\.pdf$/i, ""),
            authors: [],
            year: null,
            venue: "",
            abstract: "",
            doi: "",
            source: "pdf",
          },
          { pdfBlob: file }
        );
        showNotice(
          error instanceof Error
            ? `Saved the PDF, but could not read its metadata: ${error.message}`
            : "Saved the PDF without metadata."
        );
      }
    }
  }
  openPdfRef.current = (paths) => void importPdfPaths(paths);

  // What each native menu item does. Assigned on every render so the handlers always
  // close over current state.
  commandsRef.current = {
    "add-paper": () => setShowAdd(true),
    "new-note": () => newNote(),
    "export-backup": () => void exportWorkspace(),
    "restore-backup": () => void pickAndRestore(),
    "view-home": () => setView({ kind: "home" }),
    "view-library": () => setView({ kind: "library" }),
    "view-graph": () => setView({ kind: "graph" }),
    "view-guide": () => setView({ kind: "guide" }),
    search: () => {
      setView({ kind: "library" });
      setCollectionFilter(null);
      setTagFilter(null);
      setSmartFilter(null);
      setSavedSearchId(null);
      setSearchFocusToken((value) => value + 1);
    },
  };

  // Double-clicking a paper or a note files it into a project. Resolved from the
  // repository on each render rather than captured at open time, so the dialog's
  // checkboxes track what has just been toggled.
  const filingTarget: FilingTarget | null = (() => {
    if (!filingId) return null;
    if (filingId.kind === "paper") {
      const paper = repo.getPaper(filingId.id);
      return paper
        ? { kind: "paper", id: paper.id, title: paper.title, collectionIds: paper.collectionIds }
        : null;
    }
    const note = repo.getNote(filingId.id);
    return note
      ? { kind: "note", id: note.id, title: note.title, collectionIds: note.collectionIds || [] }
      : null;
  })();

  function setFilingCollections(collectionIds: string[]) {
    if (!filingId) return;
    if (filingId.kind === "paper") repo.setPaperCollections(filingId.id, collectionIds);
    else repo.setNoteCollections(filingId.id, collectionIds);
    refresh();
  }

  const sharingProject = sharingId ? repo.getCollection(sharingId) : undefined;

  // ---- Render helpers ----
  const activeNote =
    view.kind === "note" ? repo.getNote(view.id) : undefined;
  const activePaper =
    view.kind === "paper" ? repo.getPaper(view.id) : undefined;

  // Reading the library takes a moment on a large one. Showing the empty state here
  // would read as "your papers are gone", so hold the shell instead.
  if (!libraryLoaded) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950 text-slate-500 text-sm">
        <span className="animate-pulse">Opening your library…</span>
      </div>
    );
  }

  return (
    <div className="h-full flex text-slate-200 bg-slate-950">
      {/* Sidebar */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border-r border-veil/5 bg-surface-rail transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Library navigation"
      >
        <div className="lat-titlebar relative px-4 py-4 border-b border-veil/5">
          <div className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-slate-100">
            <IconLatticeMark className="h-7 w-7 shrink-0 text-cyan-400" /> lattice
          </div>
          <p className="text-[11px] text-slate-600 mt-1 ml-9">
            AI-native research
          </p>
          <button
            onClick={() => setNavOpen(false)}
            className="absolute right-3 top-3 rounded-md p-1.5 text-slate-500 hover:bg-veil/[.06] hover:text-slate-200 md:hidden"
            aria-label="Close navigation"
          >
            <IconClose width={16} />
          </button>
        </div>

        {/* Everything between the title bar and the footer scrolls as one column. */}
        <div className="flex-1 min-h-0 overflow-y-auto lat-scroll">
          <div className="p-3 space-y-2">
            <button
              onClick={() => setShowAdd(true)}
              className="lat-primary w-full justify-center px-3 py-2 text-sm"
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
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 hover:bg-slate-700"
                }`}
              >
                <IconGraph /> Graph
              </button>
            </div>
          </div>

          <div className="px-3 space-y-0.5">
            <button
              onClick={() => setView({ kind: "home" })}
              className={`lat-nav ${view.kind === "home" ? "lat-nav-active" : ""}`}
            >
              <IconHome /> Research desk
            </button>
            <button
              onClick={() => setView({ kind: "brain" })}
              className={`lat-nav ${view.kind === "brain" || view.kind === "plan" ? "lat-nav-active" : ""}`}
            >
              <IconBrain /> Research brain
            </button>
            <button
              onClick={() => setView({ kind: "guide" })}
              className={`lat-nav ${view.kind === "guide" ? "lat-nav-active" : ""}`}
            >
              <IconCompass /> Guide
            </button>
            <button
              onClick={() => {
                setView({ kind: "library" });
                setCollectionFilter(null);
                setTagFilter(null);
                setSmartFilter(null);
                setSavedSearchId(null);
                setQuery("");
              }}
              className={`lat-nav ${
                view.kind === "library" && !collectionFilter && !tagFilter && !smartFilter && !savedSearchId
                  ? "lat-nav-active"
                  : ""
              }`}
            >
              <IconLibrary /> All papers
              <span className="ml-auto text-xs text-slate-500">{papers.length}</span>
            </button>
            <button
              onClick={() => {
                setView({ kind: "inbox" });
                refreshInboxCount();
              }}
              className={`lat-nav ${
                view.kind === "inbox" ? "lat-nav-active" : ""
              }`}
            >
              <IconInbox /> Web clippings
              {inboxCount > 0 && (
                <span className="ml-auto text-[11px] bg-indigo-600 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {inboxCount}
                </span>
              )}
            </button>
          </div>

          {/* Smart views */}
          <div className="px-3 mt-4">
            <span className="lat-kicker px-1">Smart views</span>
            <div className="mt-1 space-y-0.5">
              {([
                ["favorites", "Favorites", <IconStar key="favorites" width={14} />,
                  papers.filter((paper) => paper.favorite).length],
                ["inbox", "To read", <IconLibrary key="inbox" width={14} />,
                  papers.filter((paper) => (paper.readingStatus || "inbox") === "inbox").length],
                ["reading", "In progress", <IconNote key="reading" width={14} />,
                  papers.filter((paper) => paper.readingStatus === "reading").length],
                ["unfiled", "Unfiled", <IconInbox key="unfiled" width={14} />,
                  papers.filter((paper) => paper.collectionIds.length === 0).length],
                ["no-pdf", "Without PDF", <IconFile key="no-pdf" width={14} />,
                  papers.filter((paper) => !paper.hasPdf).length],
                ["incomplete", "Needs metadata", <IconQuestion key="incomplete" width={14} />,
                  papers.filter((paper) => metadataIssues(paper).length > 0).length],
                ["duplicates", "Duplicates", <IconCopy key="duplicates" width={14} />,
                  duplicateCandidateIds.size],
              ] as const).map(([id, label, icon, count]) => (
                <button key={id} onClick={() => { setView({ kind: "library" }); setSmartFilter(id); setCollectionFilter(null); setTagFilter(null); setSavedSearchId(null); setQuery(""); }} className={`lat-nav !py-1.5 ${smartFilter === id ? "lat-nav-active" : ""}`}>{icon}<span>{label}</span><span className="ml-auto text-[11px] text-slate-700">{count}</span></button>
              ))}
            </div>
          </div>

          {savedSearches.length > 0 && (
            <div className="px-3 mt-4">
              <span className="lat-kicker px-1">Saved searches</span>
              <ul className="mt-1 space-y-0.5">{savedSearches.map((search) => (
                <li key={search.id} className="group flex items-center">
                  <button onClick={() => { setView({ kind: "library" }); setQuery(search.query); setSavedSearchId(search.id); setSmartFilter(null); setCollectionFilter(null); setTagFilter(null); }} className={`lat-nav !py-1.5 min-w-0 flex-1 ${savedSearchId === search.id ? "lat-nav-active" : ""}`}><IconSearch width={14} /><span className="truncate">{search.name}</span></button>
                  <button onClick={() => { if (confirm(`Delete saved search “${search.name}”?`)) { repo.deleteSavedSearch(search.id); if (savedSearchId === search.id) setSavedSearchId(null); refresh(); } }} className="px-1 text-slate-800 opacity-0 group-hover:opacity-100 hover:text-rose-400" aria-label={`Delete saved search ${search.name}`}><IconTrash width={12} /></button>
                </li>
              ))}</ul>
            </div>
          )}

          {/* Projects (collections, nested) */}
          <ProjectTree
            collections={collections}
            papers={papers}
            notes={notes}
            questions={questions}
            activeId={collectionFilter}
            onSelect={(id) => openProject(id)}
            onCreate={(name, parentId) => { repo.createCollection(name, parentId); refresh(); }}
            onRename={(id, name) => { repo.renameCollection(id, name); refresh(); }}
            onRecolor={(id, color) => { repo.updateCollection(id, { color }); refresh(); }}
            onMove={(id, parentId) => { repo.moveCollection(id, parentId); refresh(); }}
            onDelete={deleteCollection}
            onImportShared={(file) => void importSharedProject(file)}
            onDropRecords={fileDroppedRecords}
            onAutoGroup={() => setShowAutoGroup(true)}
            onClearAll={clearAllProjects}
            onExport={() => setExportingIds([])}
          />

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
                      setSmartFilter(null);
                      setSavedSearchId(null);
                      setQuery("");
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

          {/* Notes. The list scrolls in its own right, so a long list of notes
              stays reachable without scrolling the whole sidebar past the
              projects and smart views above it. */}
          <div className="px-3 mt-3 pb-3">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="lat-kicker">Notes</span>
              <span className="text-[11px] text-slate-700 tabular-nums">{standaloneNotes.length || ""}</span>
            </div>
            {standaloneNotes.length > 6 && (
              <input
                value={noteFilter}
                onChange={(event) => setNoteFilter(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") setNoteFilter(""); }}
                placeholder="Filter notes"
                aria-label="Filter notes by title"
                className="lat-input mb-1.5 w-full px-2 py-1 text-xs"
              />
            )}
            <ul className="lat-scroll max-h-[34vh] space-y-0.5 overflow-y-auto pr-0.5">
              {visibleNotes.map((n) => (
                <li
                  key={n.id}
                  onDoubleClick={() => setFilingId({ kind: "note", id: n.id })}
                  className={`group flex items-center rounded-md ${
                    view.kind === "note" && view.id === n.id ? "bg-slate-800" : "hover:bg-slate-800/60"
                  }`}
                >
                  <button
                    onClick={() => setView({ kind: "note", id: n.id })}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm"
                    title={`${n.title || "Untitled note"} — double-click to file into a project`}
                  >
                    <span className="truncate">{n.title || "Untitled note"}</span>
                    <ProjectDots collections={collections} collectionIds={n.collectionIds} max={3} size={5} />
                  </button>
                  <button
                    onClick={() => setFilingId({ kind: "note", id: n.id })}
                    className="px-1.5 text-slate-700 opacity-0 hover:text-cyan-300 group-hover:opacity-100 focus:opacity-100"
                    title={n.collectionIds?.length ? `In ${n.collectionIds.length} project${n.collectionIds.length === 1 ? "" : "s"} — click to change` : "File into a project"}
                    aria-label={`File ${n.title || "this note"} into a project`}
                  >
                    <IconFolder width={13} />
                  </button>
                </li>
              ))}
              {standaloneNotes.length === 0 && (
                <li className="px-3 py-1 text-xs text-slate-600">No notes yet</li>
              )}
              {standaloneNotes.length > 0 && visibleNotes.length === 0 && (
                <li className="px-3 py-1 text-xs text-slate-600">No note matches “{noteFilter}”.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="px-3 py-2 border-t border-slate-800 text-[11px] text-slate-500 space-y-2">
          <div className="flex gap-1">
            <button
              onClick={exportWorkspace}
              className="flex-1 bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 text-slate-300"
            >
              Backup
            </button>
            {isDesktop() ? (
              <button
                onClick={() => void pickAndRestore()}
                className="flex-1 bg-slate-800 hover:bg-slate-700 rounded px-2 py-1 text-slate-300"
              >
                Restore
              </button>
            ) : (
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
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="lat-kicker">Appearance</span>
            <ThemeToggle />
          </div>
          {backupStatus && <div className="truncate" title={backupStatus}>{backupStatus}</div>}
          {workspacePath && (
            <div className="truncate" title={workspacePath}>
              Workspace: {workspacePath.split("/").slice(-2).join("/")}
            </div>
          )}
          {health
            ? health.mockMode
              ? "AI: mock mode (no key)"
              : `AI: ${health.model}`
            : "AI: offline"}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex h-14 shrink-0 items-center gap-1 border-b border-veil/5 bg-surface-rail px-3">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            className="lat-nav !w-auto !px-2.5"
          >
            <IconMenu />
          </button>
          <button onClick={() => setView({ kind: "home" })} aria-label="Research desk" className={`lat-nav !w-auto !px-2.5 ${view.kind === "home" ? "lat-nav-active" : ""}`}><IconHome /></button>
          <button onClick={() => setView({ kind: "brain" })} aria-label="Research brain" className={`lat-nav !w-auto !px-2.5 ${view.kind === "brain" || view.kind === "plan" ? "lat-nav-active" : ""}`}><IconBrain /></button>
          <button onClick={() => { setView({ kind: "library" }); setCollectionFilter(null); setTagFilter(null); setSmartFilter(null); setSavedSearchId(null); setQuery(""); }} aria-label="All papers" className={`lat-nav !w-auto !px-2.5 ${view.kind === "library" && !collectionFilter && !tagFilter && !smartFilter && !savedSearchId ? "lat-nav-active" : ""}`}><IconLibrary /></button>
          <span className="ml-1 font-semibold tracking-tight text-slate-100">lattice</span>
          <button onClick={() => newNote()} className="lat-secondary ml-auto px-2.5 py-2" aria-label="New note"><IconNote /></button>
          <button onClick={() => setShowAdd(true)} className="lat-primary px-2.5 py-2" aria-label="Add paper"><IconPlus /></button>
        </div>
        <Suspense fallback={<LoadingView />}>
        {view.kind === "paper" && activePaper ? (
          <PaperView
            paper={activePaper}
            papers={papers}
            collections={collections}
            questions={questions}
            fetchingPdf={pdfFetching.has(activePaper.id)}
            onFetchPdf={() => void fetchPdfExplicitly(activePaper.id)}
            onFile={() => setFilingId({ kind: "paper", id: activePaper.id })}
            onBack={() => setView({ kind: "library" })}
            onOpenPaperNote={openPaperNote}
            onNoteCreated={refresh}
            onPaperUpdated={refresh}
            onQuestionUpdated={refresh}
            similar={paperIndex ? similarPapers(paperIndex, activePaper.id, 3) : []}
            projectFits={paperIndex ? projectsForPaper(paperIndex, activePaper.id, collections, 1) : []}
            onOpenPaper={openPaper}
            onAddToProject={(projectId) => {
              addPapersToCollection([activePaper.id], projectId);
              showNotice(`Filed in “${repo.getCollection(projectId)?.name || "the project"}”.`);
            }}
          />
        ) : view.kind === "note" && activeNote ? (
          <NoteView
            note={activeNote}
            papers={papers}
            notes={notes}
            collections={collections}
            onChange={() => refresh()}
            onOpenPaper={openPaper}
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
        ) : view.kind === "inbox" ? (
          <Inbox
            collections={collections}
            onImported={() => {
              refresh();
              refreshInboxCount();
            }}
          />
        ) : view.kind === "guide" ? (
          <Guide
            hasSample={hasSampleWorkspace(repo)}
            onLoadSample={() => {
              const added = seedSampleWorkspace(repo);
              showNotice(`Loaded a sample workspace of ${added} papers. Open the graph to explore it.`);
              refresh();
            }}
            onRemoveSample={() => {
              removeSampleWorkspace(repo);
              showNotice("Removed the sample workspace. Your own records are untouched.");
              refresh();
            }}
            onOpenGraph={() => setView({ kind: "graph" })}
            onAddPaper={() => setShowAdd(true)}
          />
        ) : view.kind === "graph" ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 font-medium">
              Knowledge graph
              <span className="text-xs text-slate-500">
                Counts and structure are in the sidebar, and follow the filters.
              </span>
              <button
                onClick={() => setView({ kind: "guide" })}
                className="ml-auto lat-chip"
              >
                How to read this
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <GraphView
                data={graphData}
                grouping={graphGrouping}
                groupingMode={groupingMode}
                onGroupingMode={(mode) => {
                  setGroupingMode(mode);
                  localStorage.setItem("lattice.graph.grouping", mode);
                }}
                onAdoptGroup={adoptGroupAsProject}
                onOpenNode={(id) => {
                  if (repo.getPaper(id)) openPaper(id);
                  else if (repo.getNote(id)) setView({ kind: "note", id });
                  // A research question lives on the desk, not in its own view.
                  else if (repo.listQuestions().some((q) => q.id === id)) setView({ kind: "home" });
                }}
              />
            </div>
          </div>
        ) : view.kind === "project" && repo.getCollection(view.id) ? (
          <ProjectView
            project={repo.getCollection(view.id)!}
            collections={collections}
            papers={papers}
            notes={notes}
            questions={questions}
            onOpenPaper={openPaper}
            onOpenNote={(id) => setView({ kind: "note", id })}
            onFilePaper={(id) => setFilingId({ kind: "paper", id })}
            onFileNote={(id) => setFilingId({ kind: "note", id })}
            onOpenSubproject={openProject}
            onOpenAsList={() => setView({ kind: "library" })}
            onOpenGraph={() => setView({ kind: "graph" })}
            onAddPaper={() => setShowAdd(true)}
            onUpdateProject={(patch) => { repo.updateCollection(view.id, patch); refresh(); }}
            onCreateSubproject={(name) => { repo.createCollection(name, view.id); refresh(); }}
            onCreateNote={() => newNote()}
            onShare={() => setSharingId(view.id)}
            onExport={() => setExportingIds([view.id])}
            onCombinePdfs={() => void combineProjectPdfs(repo.getCollection(view.id)!)}
            onOpenProposal={() => openProposalFor(view.id)}
            hasProposal={plans.some((plan) => plan.projectId === view.id)}
            combining={combining}
            onCreateQuestion={(title) => { repo.createQuestion({ title, collectionIds: [view.id] }); refresh(); }}
            onUpdateQuestion={(id, patch) => { repo.updateQuestion(id, patch); refresh(); }}
          />
        ) : view.kind === "brain" && interestProfile ? (
          <ResearchBrain
            profile={interestProfile}
            prefs={brainPrefs}
            papers={papers}
            collections={collections}
            plans={plans}
            onUpdatePrefs={(patch) => { repo.updateBrain(patch); refresh(); }}
            onOpenPaper={openPaper}
            onOpenPlan={(id) => setView({ kind: "plan", id })}
            onDraftPlan={openProposalFor}
            onSaveSuggestion={(suggestion) => addSuggestedPaper(suggestion, "")}
          />
        ) : view.kind === "plan" && repo.getPlan(view.id) ? (
          <PlanView
            plan={repo.getPlan(view.id)!}
            papers={papers}
            projectName={repo.getCollection(repo.getPlan(view.id)!.projectId || "")?.name}
            canDraftWithClaude={!!health?.planning}
            drafting={drafting}
            onChange={(next) => { repo.savePlan(next); refresh(); }}
            onDraftWithClaude={() => void draftProposalWithClaude(view.id)}
            onSaveAsNote={() => saveProposalAsNote(repo.getPlan(view.id)!)}
            onDelete={async () => {
              const go = await confirmAction("Delete this proposal?", "The project and its papers stay as they are.", "Delete");
              if (!go) return;
              repo.deletePlan(view.id);
              refresh();
              setView({ kind: "brain" });
            }}
            onOpenPaper={openPaper}
            onOpenProject={() => {
              const projectId = repo.getPlan(view.id)?.projectId;
              if (projectId && repo.getCollection(projectId)) setView({ kind: "project", id: projectId });
            }}
            onBack={() => setView({ kind: "brain" })}
          />
        ) : view.kind === "home" ? (
          <ResearchHome
            papers={papers}
            notes={notes}
            questions={questions}
            highlightCount={highlightCount}
            onOpenPaper={openPaper}
            onOpenNote={(id) => setView({ kind: "note", id })}
            onAddPaper={() => setShowAdd(true)}
            onOpenGuide={() => setView({ kind: "guide" })}
            onNewNote={newNote}
            onCreateQuestion={(title) => { repo.createQuestion({ title }); refresh(); }}
            onUpdateQuestion={(id, patch) => { repo.updateQuestion(id, patch); refresh(); }}
            onDeleteQuestion={(id) => { repo.deleteQuestion(id); refresh(); }}
            proposals={proposals}
            onStartProposal={startProposal}
            suggestedReading={
              <SuggestedReading
                papers={papers}
                collections={collections}
                cache={suggestionCache.current}
                onCache={(projectId, result) => {
                  suggestionCache.current.set(projectId, result);
                  setSuggestionTick((n) => n + 1);
                }}
                onAdd={addSuggestedPaper}
                onOpenProject={(id) => setView({ kind: "project", id })}
              />
            }
          />
        ) : (
          <LibraryView
            papers={filteredPapers}
            collections={collections}
            query={query}
            isSearchSaved={!!savedSearchId}
            onQuery={(nextQuery) => { setQuery(nextQuery); setSavedSearchId(null); }}
            onSaveSearch={(searchQuery) => {
              const compactQuery = searchQuery.trim();
              const name = compactQuery.length > 38 ? `${compactQuery.slice(0, 38)}…` : compactQuery;
              const savedSearch = repo.createSavedSearch(name, compactQuery);
              setSavedSearchId(savedSearch.id);
              showNotice("Saved this search as a live library view.");
              refresh();
            }}
            onOpen={openPaper}
            onAdd={() => setShowAdd(true)}
            onUpdate={(id, patch) => { repo.updatePaper(id, patch); refresh(); }}
            onAddToCollection={addPapersToCollection}
            onAddTags={addPaperTags}
            onDeleteMany={deleteManyPapers}
            onFetchPdfs={(items) => void fetchPdfsFor(items)}
            onCombinePdfs={(chosen) =>
              void combinePdfs(
                chosen,
                (collectionFilter && repo.getCollection(collectionFilter)?.name) || "Selected papers"
              )
            }
            onCombineLibrary={
              !collectionFilter && !tagFilter && !smartFilter && !savedSearchId
                ? () => void combineLibraryPdfs()
                : undefined
            }
            combining={combining}
            onFile={(id) => setFilingId({ kind: "paper", id })}
            onMergeMany={smartFilter === "duplicates" ? mergeDuplicatePapers : undefined}
            heading={
              collectionFilter
                ? collectionPath(collections, collectionFilter).join(" / ") || "Project"
                : tagFilter
                ? `#${tagFilter}`
                : savedSearchId
                ? savedSearches.find((search) => search.id === savedSearchId)?.name || "Saved search"
                : smartFilter === "favorites" ? "Favorites"
                : smartFilter === "inbox" ? "To read"
                : smartFilter === "reading" ? "In progress"
                : smartFilter === "unfiled" ? "Unfiled papers"
                : smartFilter === "no-pdf" ? "Papers without PDFs"
                : smartFilter === "incomplete" ? "Needs metadata"
                : smartFilter === "duplicates" ? "Possible duplicates"
                : "All papers"
            }
            description={
              collectionFilter
                ? `Everything in this project${(activeCollectionIds?.size || 1) > 1 ? " and its subprojects" : ""}.`
                : smartFilter || savedSearchId
                ? "A live view that updates as you organize your library."
                : "Your complete research collection."
            }
            searchFocusToken={searchFocusToken}
          />
        )}
        </Suspense>
      </main>

      {showAdd && (
        <Suspense fallback={null}>
          <AddPaper onAdd={handleAdd} onImport={handleBibliographyImport} onClose={() => setShowAdd(false)} />
        </Suspense>
      )}
      {showAutoGroup && (
        <AutoGroup
          papers={papers}
          existingNames={collections.map((collection) => collection.name)}
          onCreate={createProjectsFromGroups}
          onClose={() => setShowAutoGroup(false)}
        />
      )}
      {exportingIds && (
        <ExportContext
          collections={collections}
          papers={papers}
          notes={notes}
          questions={questions}
          initialIds={exportingIds}
          onClose={() => setExportingIds(null)}
          onNotice={showNotice}
        />
      )}
      {sharingProject && (
        <ShareProject
          project={sharingProject}
          counts={(() => {
            const contents = projectContents(sharingProject, collections, papers, notes, questions);
            return {
              papers: contents.papers.length,
              notes: contents.notes.length,
              questions: contents.questions.length,
            };
          })()}
          onClose={() => setSharingId(null)}
          onShared={showNotice}
        />
      )}
      {filingTarget && (
        <FileIntoProject
          target={filingTarget}
          collections={collections}
          onChange={setFilingCollections}
          onCreateProject={(name, parentId) => {
            const created = repo.createCollection(name, parentId);
            refresh();
            return created.id;
          }}
          onClose={() => setFilingId(null)}
        />
      )}
      {/* One click, bottom right: the action people actually want from a pile of
          unfiled papers. Hidden while a dialog is open so it cannot sit on top of
          one, and while there is nothing loose to group. */}
      {papers.length >= 3 &&
        !showAdd && !showAutoGroup && !exportingIds && !filingTarget && !sharingProject && (
          <button
            onClick={groupPapersNow}
            className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-medium text-slate-950 shadow-2xl shadow-cyan-400/20 hover:bg-cyan-300"
            title="Sort the papers that are not in a project yet into projects by theme"
          >
            <span aria-hidden="true" className="text-base leading-none">💎</span> Group papers
          </button>
        )}
      {notice && (
        <div
          role="status"
          aria-live={notice.tone === "problem" ? "assertive" : "polite"}
          className={`fixed bottom-24 right-6 z-50 flex max-w-sm items-start gap-2 rounded-xl border bg-surface-notice px-4 py-3 text-sm text-slate-200 shadow-2xl shadow-black/40 ${
            notice.tone === "problem" ? "border-amber-400/30" : "border-cyan-400/20"
          }`}
        >
          <span className={`mt-0.5 shrink-0 ${notice.tone === "problem" ? "text-amber-300" : "text-cyan-300"}`}>
            {notice.tone === "problem" ? "!" : "✓"}
          </span>
          <span className="min-w-0">{notice.message}</span>
          {notice.action && (
            <button
              onClick={notice.action.run}
              className="ml-1 shrink-0 rounded-md border border-veil/[.12] px-2 py-0.5 text-xs font-medium text-cyan-300 hover:border-cyan-400/40 hover:bg-cyan-400/10"
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The site a fetched PDF came from, for a message the user can place. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "an open-access repository";
  }
}

function LoadingView() {
  return (
    <div className="h-full grid place-items-center text-sm text-slate-500" role="status">
      Loading…
    </div>
  );
}

// ---- Note view wrapper (header + editor) ----
function NoteView({
  note,
  papers,
  notes,
  collections,
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
  collections: Collection[];
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
        <ProjectPicker
          collections={collections}
          selectedIds={note.collectionIds || []}
          onChange={(collectionIds) => {
            repo.setNoteCollections(note.id, collectionIds);
            onChange();
          }}
          label={note.title || "this note"}
        />
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
