# lattice

**An AI-native reference manager.**

Zotero keeps your papers. lattice reads with you: it files your library by research
field, tells you what your reading is missing, and hands the whole thing to Claude or
ChatGPT grounded in records you own. Local-first, open source, and fully functional
with no API key — because the organising, naming, gap-finding and project proposals
are all computed from your own library rather than generated.

The homepage lives in [`site/index.html`](site/index.html) and is served at `/home`
by the same server that serves the app.

## What it is underneath

A research knowledge workspace that combines the three tools researchers juggle:

- **Zotero** (a paper library): import papers by DOI, arXiv, or PDF upload; organize with collections and tags; search.
- **Obsidian** (linked notes plus a knowledge graph): write notes that link papers and other notes with `[[wikilinks]]`, see backlinks, and view a force directed graph of everything.
- **Notion** (a block editor): notes are made of typed blocks (headings, lists, to-dos, quotes, code) with a `/` slash menu.

The core loop is: import a paper, annotate its PDF (highlight plus attach notes), write linked block notes, and watch the knowledge graph and backlinks fill in.

The app now opens on a **Research desk** that turns that loop into a daily companion workflow: prioritize a reading queue, track papers from to-read through read, capture the one takeaway worth remembering, keep durable research questions linked to their evidence, and ask grounded questions across the saved library. Answers can be saved directly as linked notes.

This is a usable local-first research workspace, not a demo shell. The Feature status section below is explicit about what is fully working versus what remains intentionally lightweight.

---

## Quick start

Requirements: Node 18+ (Node 20 recommended).

```bash
npm install       # installs server deps and (via postinstall) client deps
npm run dev        # server on :3001, Vite client on :5173 (proxies /api)
```

Open http://localhost:5173.

To run it as a desktop application instead of a page in a browser tab:

```bash
npm run desktop
```

It runs **fully in mock mode with no API keys**. Metadata lookups (CrossRef, arXiv) need no key at all. The AI actions fall back to a realistic mock when `ANTHROPIC_API_KEY` is unset.

To use the live Anthropic model (`claude-sonnet-5`):

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=...
npm run dev
```

### Production (single origin)

```bash
npm run build      # builds the client to client/dist
npm start          # Express serves the built client + /api on one $PORT (default 3001)
```

Then open http://localhost:3001.

Production responses include baseline security headers, immutable caching for
hashed assets, same-origin CORS by default, request-size validation, and
per-instance rate limits on upstream and AI endpoints. They also enforce a
same-origin Content Security Policy, deny framing, isolate cross-origin resources,
validate the PDF file signature, and enable HSTS behind production HTTPS. When the UI is hosted on
a separate origin, set `CORS_ORIGIN` to that exact origin. For horizontally
scaled production deployments, enforce a shared rate limit at the hosting edge
as well.

### Tests and type checking

```bash
npm test           # vitest (client) + node:test (server AI mock, desktop request mapping)
npm run build      # runs tsc (strict, zero errors) then vite build
```

### Docker / Render

- `Dockerfile` is a multi stage build (build the client, then a slim runtime that serves API plus static client on `$PORT`).
- `render.yaml` deploys it with `ANTHROPIC_API_KEY` as a `sync: false` secret.

```bash
docker build -t lattice .
docker run -p 3001:3001 -e ANTHROPIC_API_KEY=... lattice
```

---

## Feature status

### Fully working

- **Desktop application.** A real Electron app with a native menu, a workspace folder
  on disk, native save/open panels, PDFs opened from Finder or the dock, persisted
  window state, and a single-instance lock. `npm run desktop` opens it;
  `npm run desktop:build` produces a `lattice.app`. See **Desktop app** below. A
  headless smoke test (`npm run desktop:smoke`) verifies the shell end to end, and
  passes against the packaged bundle as well as the dev shell.
- **Research companion desk.** A focused home surface shows the next papers to read, progress across the library, recent thinking, evidence counts, and open research questions. Every paper has a reading state, priority, last-opened timestamp, and a concise researcher takeaway. Research questions are first-class workspace records and can be linked to the papers investigating them.
- **Grounded library Q&A.** Ask a question across saved paper titles, abstracts, authors, years, and researcher takeaways. Live mode cites the provided sources inline; zero-key mock mode provides a deterministic relevance-ranked evidence map rather than inventing an answer. Results can be saved as a linked Markdown note.

- **Paper library (Zotero side).** Import by DOI (CrossRef), arXiv id or URL (arXiv API), or PDF upload (server extracts text with unpdf and guesses metadata, resolving an embedded DOI through CrossRef when present). A DOI or arXiv lookup shows the matched record first, with its abstract behind a Show/Hide toggle, so the wrong paper never reaches the library. Projects, editable per-paper tags and project membership, full text search over the library, and a library sidebar. Duplicate papers merge by DOI, arXiv id, or normalized title.
- **Automatic open-access PDFs.** A paper added by DOI or arXiv id fetches its own PDF where an open-access copy exists, so adding a reference and being able to annotate it are the same step rather than a trip to the publisher and back. The server resolves candidates through arXiv, Unpaywall, OpenAlex, and the publisher's own CrossRef link, verifies the bytes really are a PDF (repositories answer freely with login walls and a 200), and streams them back; the file is then stored client-side in IndexedDB and its text extracted exactly like one attached by hand. Nothing is persisted server-side, only open-access copies are reachable, and a paywalled paper says so and waits for your own file. A paper view offers **Find the PDF for me** on demand, and the library's bulk **Fetch PDFs** backfills a whole selection — sequentially, because the indexes it asks are shared and public. Set `OA_CONTACT_EMAIL` to identify your deployment to Unpaywall and OpenAlex.
- **Projects: one line of inquiry, in one place.** A project holds the **papers, the notes, and the open questions** for one idea — not a folder of PDFs. Selecting one opens a project page rather than a filtered list: a **premise** ("what you think might be true", stated so it could turn out to be wrong), a pulse of how far it has got, the open questions with their evidence counts, the evidence with each paper's takeaway, the writing, and the subprojects. A paper's own notes doc follows the paper into the project automatically, and a note or question made while a project is open is filed there without being asked.
- **What this project needs.** Every project page carries a ranked list of what is missing: no premise yet, a question with no evidence attached, a paper opened but never summarised, a paper still in the queue, a note that links to nothing, a paper nothing in the project refers to, an empty subproject. The order is deliberate — a premise before questions, questions before evidence — and when the list is empty the project is ready to write. This is the difference between a filing cabinet and a thinking tool: a shelf of papers looks like progress, and this list is the honest version.
- **Projects and subprojects.** Projects nest to any depth: `Thesis` holds `Chapter 2` holds `Pilot study`. A parent means the whole branch — its papers, notes, and questions and all of its subprojects'. Each row carries a colour, a live count across all three record kinds, and inline controls to rename, recolour, move, or add a subproject. Projects have a lifecycle (`Idea`, `Active`, `Writing up`, `Parked`) so a hunch can be put down without being deleted. Deleting a project keeps its papers, notes, and questions and lifts its subprojects up a level rather than deleting the branch; a project can never be moved inside its own subtree.
- **A visible Project column.** The library table and cards carry the paper's projects as a coloured dot and name — and, when it belongs to none, an explicit `+ Project` rather than blank space. The paper view shows the same chip beside the authors. Sorting by Project groups the library by line of inquiry and gathers the unfiled papers together, which is what makes it usable for triage. Colour is assigned to a project when it is created, so it means something from the first moment rather than only after someone remembers to set it.
- **Organise the way you would in Notion.** Drag a project onto another to nest it, drag it onto the empty space below the tree to lift it back to the top level, and drag papers from the library straight onto a project to file them (dragging one of several selected rows drags the selection). Right-click any project — or use the always-present `⋯` — for rename, new subproject, move, and delete. Deleting a project asks nothing and offers **Undo** instead: nothing is destroyed by it, so a confirmation was making the reversible feel dangerous.
- **Double-click to file.** Double-click any paper row or card, any note in the sidebar, or anything on a project page, and a small dialog files it into projects — showing the project tree indented, with what it already belongs to ticked. It can create a project on the spot and file into it in one step, which is the common case when an idea is still forming and the paper you just read is the reason the project should exist. A hover folder button on every row does the same thing, because single-click still opens a paper and a gesture nobody finds is not a feature.
- **Share a project with another researcher.** Projects export as a single `.latticeproject` file — papers, notes, questions, subprojects, highlights, and the premise — that you send however you like and the recipient imports into their own library. Two choices are put in front of you because they have consequences: whether to include **your notes, takeaways, and highlights** (usually the point of sharing, and also the personal part), and whether to include the **PDF files** (off by default: most publisher PDFs are not yours to redistribute, and the recipient's own open-access fetch fills in most of the gap legally).
- **Importing merges; it never overwrites.** This is the difference between a share and a workspace backup, and it drives the design. Papers go through the same DOI / arXiv / title matching the library already uses, so a paper you both have is filed into the new project rather than duplicated. Projects are always created fresh, because merging by name would silently pour someone else's reading into a project of yours that happens to share a title. Highlights land only on papers the import actually introduced, since dropping another person's annotations onto a PDF you have already marked up would corrupt the one thing that is unambiguously yours. And a note whose title you already use is renamed on the way in, because `[[wikilink]]` resolution is by title and two notes with one title makes every link to it ambiguous.
- **Start the filing over.** A trash icon in the Projects header removes every project while keeping every paper, note, and question — the grouping is meant to be re-run, and deciding a set of collections is the wrong cut of the library should not mean losing the reading. This one asks before it acts as well as offering an undo, unlike deleting a single project: deleting one destroys nothing, whereas this destroys every name, premise, colour, and nesting you have written, and a twelve-second undo is thin cover for work that could be months old. The undo restores the tree, the colours, the premises, and who was filed where.
- **Suggested projects.** The research desk proposes projects the library is already pointing at, and every suggestion is **derived, never invented** — it comes from counting what you have, and it carries the count with it: *"7 papers on representation learning and 9 on protein design, and none that do both."* A suggestion you can check is one you can disagree with; "have you considered combining machine learning and biology" is noise. Four kinds: a **method you read** applied to a **domain you read** that you have not yet combined (fields are marked as methods or things-studied in `fieldLexicon.ts`, which is what makes the suggestion concrete); a **question you already gathered evidence for** and never made a project; **reading no project or question claims**; and a **premise you stated but barely evidenced**. **Start it** creates the project, files the evidence, and seeds the premise as a first draft to be rewritten.
- **No model is called for this.** A proposal that cannot be traced back to records you own has no business in a library tool, and the app runs with no API key at all.
- **💎 Group papers.** One button, bottom right, whenever anything is unfiled: it reads the fields off those papers and makes the collections. No dialog and no confirmation — what makes that safe is the **Undo** in the confirmation, which removes exactly the projects it just created and touches nothing else. On a 495-paper import it files 448 papers into 74 collections in about a second; press it again and it picks up whatever was left over.
- **Collections named after fields, not word pairs.** Clustering tells you which papers go together and which words they share; it does not give you a name — the top terms of a cluster on safe RL are "reward, policy, safe", which reads as a search query. So a cluster's vocabulary is matched against a list of actual research fields (`lib/fieldLexicon.ts`) and takes the field's own name: **AI safety**, **Reinforcement learning**, **Antibody engineering**, **Molecular docking and binding**, **Cryo-EM and imaging**. Where two clusters land on one field — six corners of structure prediction really are six collections — each keeps the field name and gains what makes it different: *Protein structure prediction · protein folding*, *· secondary structure*, *· distance*. Where nothing fits well enough the group keeps a phrase from its own content, because a wrong name is worse than a plain one. Adding a field your library needs is one line in that file.
- **Many narrow collections, not a few broad ones.** The defaults are tuned that way, and any group too large to be a subject is split again at a stricter threshold — repeatedly, since the remainder of a split can still be too big. That is what stops one bucket called "Deep learning" quietly swallowing a tenth of the library.
- **Reviewing the grouping first.** A wand in the Projects sidebar opens the same grouping as a proposal instead: it reads the themes off your library — titles, tags, abstracts — and proposes projects to file them into. Every proposal shows its size, the terms that produced it, and a few of the papers that landed in it, at three levels of granularity, with nothing created until specific groups are ticked. On a 495-paper import it proposes 14 broad themes or 33 fine ones. An automatic filing you cannot inspect is worse than none, because you end up distrusting the whole library.
- **Export a project as a `CLAUDE.md`, for agents.** The same picker offers a second format written for a coding agent rather than for a chat. It is a different document on purpose: a chat paste is read once and can be long, while a `CLAUDE.md` sits in a repository and is read at the top of every turn, so this one stays small and is written as instructions. The rules come first, before the content they govern — cite by the exact key, **never invent a key, title, or author** (a fabricated citation matching the format of the real ones is the worst failure available here), treat a takeaway as the user's position rather than the paper's, and treat a question marked as having no evidence as a real gap. A premise lattice wrote itself when it grouped the papers is labelled as a placeholder rather than handed over as the user's claim. Instead of inlining the library it names the **lattice MCP tools**, which read the live workspace and so are never out of date. A twenty-paper project comes to about 1.3k tokens on takeaways alone, or 3.2k with abstracts — abstracts are truncated harder here than in the chat export, since an abstract's opening carries the claim and its methods paragraph does not. The rules tell the agent that excerpts are truncated, so it says it cannot see past the cut rather than guessing what follows.
- **Send projects to Claude or ChatGPT.** Pick one project or several and get them as a single grounded document: premise, open questions with their evidence, every paper with its citation key, and your notes.
- **How much of each paper travels is a choice, with the price shown.** Three levels — your **takeaways** only, **plus the papers' own abstracts** (the default), or **plus the extracted PDF text**. Abstracts are included by default because the earlier reasoning — that your takeaway is the better signal — is true only where a takeaway exists, and a library with none exported as a list of bare titles. The control says what is actually available in the projects you picked, not what would be available in principle: *"0 of 11 chosen papers have one"* is the fact that decides which level you want. On one 20-paper project the three levels are roughly 1.4k, 6k, and 21k tokens. It shows the size in tokens **before** you commit — a big library makes a document no chat window will accept, and finding that out after pasting wastes everybody's time — with the options that shrink it right beside the estimate. Copy, save as Markdown, or open Claude or ChatGPT with the text already on the clipboard.
- **How to structure projects.** The Guide states the rules the model is built around: a project is a **claim, not a topic** (if it cannot be wrong, it is a tag); start one **from a hunch, not from a shelf** (one question and no papers is a real project — forty papers and no question is a reading list in a costume); **subprojects are parts of the argument**, not subtopics; and **tags cut across while projects contain**.
- **Colour means grouping, and nothing else.** A colour is not a preference you apply to items: it belongs to a project, is assigned when the project is created, and is read from there wherever a paper or note appears. Two things share a colour exactly when they are in the same group. Colouring individual records freehand was possible for a while and meant nothing, so it is gone.
- **Reachable on a narrow screen.** The sidebar — projects, notes, smart views — becomes a drawer below the `md` breakpoint rather than being hidden, because projects are where the app's organisation lives and a phone that cannot open one is a phone that cannot use the app.
- **Abstracts on demand.** Every paper row and card expands its abstract in place, and the paper view has an Abstract panel next to Organize — enough to remember what a paper is without opening the PDF or losing your position in the list.
- **Power library workflow.** Switch between a dense bibliographic table and visual cards, sort by date/title/author/year/last-opened, favorite items, copy generated citation keys, and act on multi-selected papers in bulk (reading state, tags, collections, BibTeX export, or removal). Smart views keep Favorites, To read, In progress, Unfiled, and Without PDF live automatically. Search supports field filters such as `author:kuhn`, `tag:methods`, `year:2024`, `status:in-progress`, `has:pdf`, `is:favorite`, and `color:blue`; `⌘/Ctrl+K` opens library search from anywhere.
- **Real bibliographic item types and manual entry.** Add journal articles, conference papers, preprints, books, theses, and webpages even when no DOI exists. BibTeX export maps those types to appropriate entries and venue fields (`@article`, `@inproceedings`, `@book`, `@phdthesis`, or `@misc`).
- **Bibliography interchange and citation copy.** Import entire `.bib` or `.ris` libraries with tags and duplicate-safe metadata enrichment; export the current view or a multi-selected subset as BibTeX or RIS. Copy formatted APA, MLA, or Chicago bibliographies directly from the library toolbar.
- **Metadata audit and related papers.** A live Needs metadata view identifies incomplete records and shows missing-field counts inline. Papers can be related explicitly from the organizer; relationships are bidirectional, survive backup/restore, and appear as distinct links in the knowledge graph.
- **Complete paper lifecycle.** Correct imported titles, authors, year, venue, DOI, URL, and abstract in place. A DOI/arXiv-only record can later receive a PDF, and an existing PDF can be replaced without recreating the paper or losing its notes and organization. Attaching remains useful while offline: the PDF is stored even if server-side text extraction is unavailable.
- **Citation export.** Export the whole library or the currently filtered collection/tag/search result as a deduplicated BibTeX file.
- **PDF storage split.** Uploaded PDF file bytes are stored as a blob in **IndexedDB**; all metadata, annotations, notes, and links go through a single repository abstraction backed by **localStorage**. Nothing is uploaded to the server for persistence.
- **PDF annotation (the core).** A paper's PDF renders with pdf.js including the selectable text layer. Selecting text creates a highlight in one of five colors. Each highlight stores `{ paperId, page, rects, text, color, note }` with rects normalized as fractions of the page, so highlights **re-anchor at any zoom and persist across reloads**. A sidebar lists highlights; clicking one scrolls to it; clicking a highlight (or its list row) lets you add or edit a note and change its color.
- **Linked notes (Obsidian plus Notion sides).** A block editor (see below) for standalone notes and per paper notes docs, with `[[wikilink]]` autocomplete that suggests papers and notes. Links are parsed and a **backlinks panel** shows what links to the current note. Each paper has a dedicated notes doc (the Notes button).
- **A graph that groups.** The knowledge graph colours and clusters nodes by group, with the group's name drawn where its cluster settles — so a five-hundred-paper library reads as thirty named regions rather than five hundred unreadable titles. Group **by project** to see the filing you have done, or **by subject** to have lattice propose groups from what the papers are actually about (titles, tags, abstracts; plain tf-idf and cosine similarity, so every group is labelled with the terms that defined it and can be argued with). Nothing is filed by a proposal until you say so: each proposed group has a **+** that turns it into a real project and files its papers into it. This is what makes the graph useful on a library that has just been imported, which is exactly when a graph of unlinked nodes is least use.
- **Knowledge graph.** A force directed graph (d3-force on a canvas) of papers, notes, and research questions as nodes, joined by `[[wikilink]]` edges, the implicit paper to note relation, explicit related-paper links, and question to evidence links. Node radius scales with degree. Click to focus a node and dim everything outside its neighbourhood (1 or 2 hops), shift-click a second node to trace the shortest path between them and count the hops, double-click to open, drag to reposition, drag the background to pan, scroll to zoom, `Esc` to clear. A sidebar filters by node and edge kind, hides unconnected nodes, and reports the graph's shape: load-bearing hubs, questions with no evidence attached, nodes connected to nothing, and how many separate islands the library has split into. See **How a researcher uses lattice** below for what to do with all of that.
- **Annotated PDF export.** Download the original PDF with every lattice
  highlight embedded as a standard, portable PDF Highlight annotation. Attached
  notes are stored as annotation contents and appear in compatible PDF readers'
  comments sidebars; the original page text remains selectable.
- **Complete workspace backup and restore.** A single dated `.lattice` archive
  contains papers, collections, tags, notes, backlinks, highlights, and the
  original PDF blobs, reading workflow metadata, research questions, proposals, and research brain settings. Restore validates the archive and reconstructs both
  localStorage and IndexedDB, so a workspace can move between browsers or be
  kept as an offline backup.
- **AI actions (P2), with mock fallback.** Explain a highlight, and synthesize a paper's highlights into a Markdown note. Uses `claude-sonnet-5` when `ANTHROPIC_API_KEY` is set; otherwise a realistic structured mock. The synthesis is saved as a new note linked to the paper.
- **Research brain.** A page that works out what you're interested in from what you do: reading, takeaways, highlights, notes, linking papers to questions and filing them in active projects all count, recent work most. Interests are named fields, themes your papers share, and anything you type in your own words. Each lists the papers behind it, and any of them can be muted. "Papers you don't have yet" looks up the reference lists of your most-used papers in OpenAlex, keeps works cited by at least two of them, and orders them by fit with your interests. "Not for me" is remembered.
- **Similar papers.** Each paper shows up to three papers in your library about the same thing, and a project it looks like it belongs in, with one click to file it. Runs on the library alone, no network. A match needs a shared term that most of the library doesn't use, so a word like "model" doesn't count.
- **Proposals with an agent plan.** Every project can have a proposal: question, hypothesis, what would support it and what would count against it, what the library already says (each claim linked to its papers), the gap, aims, approach and risks. The work is split into tasks for seven roles (scout, reader, data, runner, analyst, auditor, writer), laid out in stages that can run in parallel, with the steps that spend compute or write claims marked to stop for your review. The first draft is built from the project alone and invents nothing; empty fields stay empty. With `ANTHROPIC_API_KEY` set, "Draft with Claude" writes one with `claude-opus-5` (override with `LATTICE_PLAN_MODEL`), and any citation to a paper not in your library is removed and counted. Copy it as Markdown with citation keys, copy the agent plan as a CLAUDE.md, copy one task as a prompt, or save it as a note in the project. Agents connected through the MCP server read it with `get_plan`. Proposals and brain settings are in backups and the desktop mirror.

### MVP level (works, but intentionally lightweight)

- **The block editor is a lightweight block model, not TipTap/ProseMirror.** It is genuinely block based: the note body is an array of typed blocks (paragraph, H1, H2, H3, bulleted list, numbered list, to-do checkbox, quote, code, divider). Enter creates a new block, Backspace at the start of a styled block turns it back into a paragraph (and merges into the previous block when already a paragraph), and a `/` slash menu inserts or converts the current block. **Markdown shortcuts** work as you type, the way they do in Notion: `- ` or `* ` starts a bullet, `1. ` a numbered item, `[] ` a to-do, `# ` through `### ` a heading, `> ` a quote, and `---` a divider — the marker is eaten and the block changes type. **Tab and Shift+Tab** nest and un-nest a list item, carrying its own nested items with it; a nested item can only go one level deeper than the one above it, the bullet glyph and the ordered marker change with depth (`•`/`◦`/`▪`, `1.`/`a.`/`i.`), and the nesting serializes as two spaces per level of ordinary Markdown so it round-trips through the note body unchanged. Enter on an empty nested item steps back out a level at a time before ending the list. Each block is its own auto growing editable element with a light hover affordance (a `+` in the gutter). `[[wikilink]]` autocomplete works inside every block. **Inline formatting** works the way it does in Notion: `⌘B`, `⌘I`, `⌘E`, and `⌘K` toggle bold, italic, code, and a wikilink over the selection, a small toolbar appears when text is selected, and a line renders its formatting as formatting — the raw `**` only appears on the line the cursor is actually in. The stored body is still plain Markdown throughout. We did **not** pull in full TipTap because of the package weight; instead blocks serialize to and from Markdown, which keeps wikilink parsing, backlinks, the graph, and the Supabase path all working on one plain string form. Trade offs: inline `[[links]]` show as raw source text while editing (navigation is via the contextual Links and Backlinks panel and the graph, not by clicking the inline text); rich inline marks beyond `[[links]]` are not styled in place.
- **PDF metadata heuristics.** For an uploaded PDF with no DOI, title and author guesses come from first page heuristics and can be imperfect. Scanned image PDFs with no text layer are flagged (the app still stores them, but there is no text for AI actions).
- **AI explain context** is the paper abstract or a slice of extracted text, not the full surrounding page.

### Not implemented (stubs / out of scope for this MVP)

- **Supabase / auth / multi device sync.** Documented below as the upgrade path; not implemented. In the web build all data is local to the browser; the desktop build additionally mirrors everything to a workspace folder on disk, which covers backup and moving between machines but not live multi-device sync. Collaboration is file-based rather than live: a project is shared by sending a `.latticeproject` file, which the recipient merges into their own library. Two people working on the same project stay in touch by re-sharing, not by syncing.
- **Rich collaborative editing, drag to reorder blocks, and inline images** in the note editor. (Nested lists are implemented — see the block editor note above.)

### An honest note on browser verification

The highlight **data model** and its re-anchoring math are covered by unit tests (serialize a highlight's rects to quadpoints and restore them). Live PDF text layer highlighting (select text with the mouse, get a colored highlight anchored to the page) genuinely needs a real browser with a real text selection; it was built against pdf.js's text layer and verified to render, but exercising the drag select gesture reliably requires a human browser session rather than an automated one.

---

## How a researcher uses lattice

The app ships an in-app **Guide** (sidebar, below Research desk) that covers this in
full, including a **Load sample workspace** button that seeds nine illustrative papers,
four notes, and two research questions so the knowledge graph has something to show on
a fresh install. The sample records are tagged `sample`, carry a
`lattice sample workspace` venue so they can never be mistaken for real citations, and
can be removed again exactly.

### The loop

1. **Collect, without deciding yet.** Import by DOI, arXiv id, or PDF, or bring a whole
   `.bib`/`.ris` library. Do not file carefully at this stage: the Unfiled and Needs
   metadata smart views will find the loose ends later.
2. **Read with a pen in your hand.** Highlight in five colours and keep a convention
   (one colour for citable claims, one for methods you would have to reproduce, one for
   disagreements). Attach the note when you have the reaction, not on a second pass.
3. **Capture one takeaway per paper.** One or two sentences for the version of you who
   has forgotten the paper. Takeaways are what the library Q and A searches over, so a
   library of empty takeaways answers nothing.
4. **Connect it.** Write notes that put two papers in the same sentence, linked with
   `[[wikilinks]]`. Promote durable uncertainties to research questions and attach the
   papers that bear on them.
5. **Ask the library, then check its work.** The Research desk answers across saved
   abstracts and takeaways and cites what it used. Treat the sources as the output and
   the sentences as a draft.

### Reading the knowledge graph

The graph is not a picture of your library. It is a picture of the connections you have
actually made, which is a smaller thing, and the gap between them is the work still to
do.

**Nodes.** Indigo circles are papers, green circles are notes, amber rings are research
questions. Radius grows with the number of connections, so hubs read as hubs.

**Edges.** Grey is a `[[wikilink]]` you wrote, indigo joins a paper to its own notes
doc, cyan is an explicit related-paper link, amber joins a question to its evidence.
Each kind can be switched off in the sidebar to see the graph without it.

**Gestures.**

| Gesture | Effect |
| --- | --- |
| Click | Focus a node; everything more than one hop away dims |
| 1 hop / 2 hops | Widen the focus to neighbours of neighbours |
| Shift-click | Trace the shortest path from the focused node to this one |
| Double-click | Open the paper, note, or question |
| Drag a node | Reposition it. Drag the background to pan, scroll to zoom |
| Esc | Clear the focus |

**Four questions worth asking it.**

- *What is my thinking resting on?* The **Load bearing** list ranks nodes by degree. A
  single note holding the whole argument together is worth rereading and probably worth
  splitting.
- *What have I saved and never used?* **Not yet connected** lists every node with no
  links at all. Clear it by writing the note that mentions the paper.
- *Is this one body of work or several?* **Separate islands** counts disconnected
  clusters. Two islands inside one project means you have not yet found the paper that
  joins them.
- *How are these two things related, if at all?* Focus one node, shift-click another,
  and read the chain. A long path through an unrelated note means the connection you
  assumed exists is one you never made. No route at all is a stronger signal.

**A weekly graph review** (about fifteen minutes): resolve every question with no
evidence; take the top three from Not yet connected and write one linking sentence for
each; split any hub past about a dozen links; then hide notes and look at papers plus
questions alone, which is roughly what a reader of your paper will see.

### Keeping links resolvable

A `[[wikilink]]` matches on title, so titles are the addressing scheme. Give notes
titles you would actually type, fix an imported paper title *before* linking it
(renaming later does not rewrite existing links, which then fall silently out of the
graph), and prefer the autocomplete over typing from memory since it only offers things
that exist.

---

## Desktop app

lattice runs as a real macOS/Linux/Windows application, not only as a page in a
browser tab.

```bash
npm run desktop
```

That builds the client and opens the app. `npm run desktop:dev` skips the rebuild.

### What the desktop build adds

- **A native menu.** File (Add Paper, New Note, Open PDF, Export Workspace Backup,
  Restore From Backup, Reveal Workspace Folder), Edit (with Find in Library), View
  (Research Desk, Library, Knowledge Graph, Guide on `Cmd 1` to `Cmd 4`, plus zoom and
  full screen), Window, and Help. The Guide is on `Cmd 4` and under Help, as well as
  in the sidebar and on the Research desk header.
- **A workspace folder on disk.** Every change is mirrored to
  `<userData>/lattice/workspace/`: `workspace.json` for papers, collections, notes,
  highlights, and research questions, and `pdfs/<id>.pdf` for the documents
  themselves. Reveal Workspace Folder opens it in Finder. It is a plain folder, so it
  copies to a backup drive or a synced directory without an export step.
- **Recovery from that folder.** On a launch where browser storage is empty but the
  folder is not (a reinstall, a cleared profile, a folder carried over from another
  machine), the app adopts what is on disk instead of opening blank. It refuses to do
  this when the live store already holds anything, so a stale mirror can never
  overwrite a real library.
- **Native file dialogs.** Backups go through a real save panel and land where you
  put them, instead of dropping into Downloads. Restore uses a real open panel, and
  the confirmation is a native sheet rather than a `window.confirm` strip.
- **Opening PDFs from the operating system.** Drop a PDF on the dock icon, choose
  lattice under Open With, or use File > Open PDF. Metadata is extracted and the paper
  is saved. If the metadata step fails the document is still saved, titled from the
  filename.
- **Window state.** Size, position, and maximized state persist across launches.
- **One instance.** A second launch focuses the running window rather than opening a
  rival copy writing to the same folder.

### How the shell is put together

Three things in `desktop/main.cjs` are load bearing:

1. **The UI is served over a custom `lattice://` scheme, not `http://localhost:PORT`.**
   The renderer keeps the workspace in localStorage and IndexedDB, both keyed by
   origin. Loading from a port would mean that a launch where that port happened to be
   busy opened a *different origin*, and the user's entire library would appear to
   have vanished. A fixed scheme makes storage independent of the port.
2. **The Express API runs inside the Electron main process** on an OS-assigned
   loopback port, and `/api` requests are proxied to it from the same handler. The API
   stays same-origin from the renderer's point of view, so the desktop build needs no
   CORS configuration and no separate base URL in the bundle. If it fails to start the
   app still opens: the library, notes, graph, and PDF reader are all local, and only
   metadata lookups and the AI actions are lost.
3. **The preload bridge exposes named operations, never a general escape hatch.** The
   renderer parses PDFs from the open web, so it is treated as the least trusted part
   of the app. It can ask for a save dialog; it cannot name a path to write to. PDF
   ids are validated against a strict pattern rather than sanitized, so
   `writePdf('../escape', ...)` is refused rather than cleaned up into something that
   still resolves somewhere unexpected.

The web build is unaffected. `client/src/lib/desktop.ts` degrades to a no-op when
`window.lattice` is absent, so the same bundle serves both.

### Verifying the shell

```bash
npm run desktop:smoke
```

Boots the real shell against a throwaway user-data directory and asserts, from inside
the renderer, that the custom scheme served the app, React mounted, the preload bridge
arrived, `/api/health` was proxied to the embedded server, the workspace and PDF
mirrors round-trip, a path-traversal write is refused, the frameless title bar inset is
applied so the macOS window controls do not sit on the logo, and the Guide is reachable
from the first screen. Exits non-zero on failure,
so it works unattended. Run it against a packaged build too:

```bash
LATTICE_SMOKE=1 release/lattice-darwin-arm64/lattice.app/Contents/MacOS/lattice --user-data-dir="$(mktemp -d)"
```

### Building a distributable app

```bash
npm run desktop:build
```

Writes `release/lattice-darwin-arm64/lattice.app` (about 244 MB, most of it Electron).
The icon is rasterised from `client/public/lattice.svg`, the same drawing the web build
uses as its favicon. By default the build is **unsigned**: on macOS, right-click the app
and choose Open the first time, or Gatekeeper will refuse to launch it.

#### Signing it, so other people can open it

That right-click dance is where most people give up, so a build you intend to send
somebody should be signed and notarised. Both need a paid Apple Developer account
($99/yr); the build script picks them up from the environment and skips them when they
are absent.

```bash
LATTICE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
APPLE_ID="you@example.com" \
APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
APPLE_TEAM_ID="TEAMID" \
npm run desktop:build
```

- The identity comes from the certificate in your keychain; `security find-identity -v
  -p codesigning` lists them.
- The app-specific password is generated at appleid.apple.com. It is not your Apple ID
  password.
- Notarisation uploads the app to Apple and usually takes a few minutes.
- Entitlements are written to `build/entitlements.plist` at sign time. Electron needs
  the JIT and unsigned-executable-memory exceptions, or notarisation rejects it.

Signing without the three `APPLE_*` variables produces a signed but un-notarised app,
which Gatekeeper still blocks on other machines. The script says so rather than letting
you find out after sending it.

Note that the desktop app's embedded API listens on loopback with an OS-assigned port,
so the **web clipper extension does not talk to it**. The clipper posts to the
separately run `npm start` server on port 3001.

---

## Web clipper (Chrome extension)

A Zotero-style article clipper lives in `extension/`. When you find an article
you like on the web, save it to a lattice collection with an optional note; it
lands in the app's **Web clippings** Inbox, where you file it into a collection
as a reference.

### Build and load

```bash
cd extension
npm install
npm run build     # type-checks, bundles with esbuild, writes extension/dist
```

Then in Chrome: open `chrome://extensions`, turn on Developer mode, click
**Load unpacked**, and select `extension/dist`.

### Point it at your lattice server

Open the extension's **Settings** (options page) and set the lattice server URL.
It defaults to the local dev server, `http://localhost:3001`. You can also set a
default collection name that pre-fills the popup and the right-click quick-save.

### Save an article

- Click the toolbar icon to open the popup: it auto-captures the page title,
  URL, any selected text (or the page description / first paragraph as a
  fallback), and lets you choose a collection and add a note, then **Save to
  lattice**.
- Or right-click a page or selection and choose **Save to lattice** for a quick
  save into your default collection.

If the lattice server is unreachable, the clipping is queued in
`chrome.storage.local` and synced automatically the next time the server is
reachable (the popup shows how many are waiting, with a **Sync now** button).

### File it in the app

Open lattice and click **Web clippings** in the sidebar (a badge shows how many
are waiting). Each clipping shows its title, URL, excerpt, and note; pick or type
a collection and click **Import**. The clipping becomes a paper reference
(title + URL, excerpt as the abstract) with the note attached as its notes doc,
the target collection is created if it does not exist, and the clipping is acked
so it leaves the queue.

The clipping queue is file-backed on the server at `server/data/clippings.json`
(gitignored). The extension talks to three routes: `POST /api/clippings`,
`GET /api/clippings` (add `?pending=1` for un-imported only), and
`POST /api/clippings/:id/imported` to ack (plus `DELETE /api/clippings/:id` to
dismiss). Those routes carry permissive CORS so the extension can post from its
own origin.

**Honest note on verification.** The extension build, the lattice build, and the
unit tests (payload construction/validation, the offline-queue logic, and the
clipping to paper/collection mapping) all pass, and the server + Inbox import
path is verified end to end via the API and in the app UI. Actually saving from a
real article requires loading the unpacked extension in a live Chrome session; a
headless run cannot exercise the in-browser capture and context menu.

---

## How the pieces fit

```
client/
  src/
    lib/
      repository.ts     single data-access interface over localStorage (papers, projects, tags, highlights, notes)
      collectionTree.ts nesting projects: tree, descendants, breadcrumb, cycle guards (unit tested)
      projectWorkspace.ts what a project contains across its subprojects, and what it still needs (unit tested)
      projectShare.ts   bundling a project into a file, and merging one back in without overwriting (unit tested)
      subjectGroups.ts  proposing subject areas from titles, tags, and abstracts (unit tested)
      fieldLexicon.ts   the vocabulary of research fields a cluster is named after (unit tested)
      researchProposals.ts  projects the library is pointing at, derived from its own counts (unit tested)
      graphGroups.ts    what the graph colours and clusters by, in either mode
      inlineFormat.ts   applying and removing bold/italic/code/wikilink over a selection (unit tested)
      projectContext.ts one or many projects rendered as grounded context for an LLM (unit tested)
      agentBrief.ts     a project as a CLAUDE.md: rules first, small, pointing at the MCP tools (unit tested)
      projectContext.ts a project rendered as text for an LLM chat (unit tested)
      labelColor.ts     the one shared colour palette for papers, notes, and projects
      blobStore.ts      PDF blobs in IndexedDB
      autoPdf.ts        fetch and attach an open-access PDF for a DOI/arXiv-only paper
      api.ts            fetch wrappers for /api
      wikilink.ts       [[link]] parsing (unit tested)
      graph.ts          backlinks + graph construction (unit tested)
      graphAnalysis.ts  degree, neighbourhood, shortest path, components, insights (unit tested)
      sampleWorkspace.ts  the seedable demo workspace (unit tested for graph shape)
      inlineMarkdown.ts inline **bold**/*italic*/`code` tokenizer (unit tested)
      desktop.ts        the renderer half of the Electron bridge; no-ops in a browser
      workspaceMirror.ts debounced mirror of the workspace to the desktop folder
      highlightAnchor.ts rect <-> quadpoint + screen <-> normalized (unit tested)
      blocks.ts         block model + Markdown serialize/parse (unit tested)
    components/
      ProjectView.tsx    a project's front page: premise, pulse, gaps, questions, evidence, notes, subprojects
      ProjectTree.tsx    the nested projects sidebar: create, rename, recolour, move, delete
      ProjectPicker.tsx  file a note (or anything else) into projects, from the project tree as checkboxes
      ShareProject.tsx   the share sheet: what travels, and what stays yours
      AutoGroup.tsx      proposing themed projects from the library, with every proposal inspectable
      ExportContext.tsx  picking projects to send to an assistant, with the size shown first
      dragTypes.ts       what can be dragged, and how the payload travels
      FileIntoProject.tsx the double-click quick-file dialog, with create-a-project-and-file in one step
      ColorPicker.tsx    the colour swatch popover and its flat variant for the sidebar
      PdfReader.tsx      pdf.js render + text layer + highlight create/render
      PaperView.tsx      PDF surface + highlights sidebar + AI actions
      NoteEditor.tsx     Notion style block editor + slash menu + Markdown shortcuts + Tab nesting + wikilink autocomplete
      GraphView.tsx      d3-force canvas graph: zoom/pan, focus, path tracing, filters, insights sidebar
      Guide.tsx          in-app tutorial (the researcher loop + how to read the graph)
      AddPaper.tsx       DOI / arXiv / PDF import
server/
  index.js   Express: /api metadata (DOI, arXiv, PDF), open-access PDF fetch, AI (explain, synthesize), clippings, health;
             serves client/dist in production. Exports startServer() so the desktop shell can embed the same API in-process.
  openAccess.js  resolves and proxies an open-access PDF (arXiv, Unpaywall, OpenAlex, CrossRef), with an SSRF guard (unit tested)
  crossref.js, arxiv.js, parse.js, http.js, ai.js
  clippings.js   file-backed web-clipping queue (server/data/clippings.json)
desktop/
  main.cjs     Electron shell: lattice:// scheme, /api proxy, native menu, workspace folder, dialogs, window state
  preload.cjs  the renderer bridge, one named operation per capability
  serve.cjs    request -> file or proxy mapping, and PDF path validation (unit tested)
  serve.test.mjs
mcp/
  src/index.ts       the MCP server: six read-only tools over the library
  src/workspace.ts   locating, loading, and cache-invalidating the workspace mirror
  build.mjs          esbuild bundle -> mcp/dist/lattice-mcp.mjs (one self-contained file)
  test/              spawns the built server and speaks real JSON-RPC to it
extension/
  src/
    background/service-worker.ts   context menu, save flow, offline-queue sync
    popup/                         capture the page, pick a collection, add a note
    options/                       lattice server URL + default collection
    lib/clipping.ts                pure payload build/validate + queue logic (unit tested)
    lib/capture.ts                 injected page-capture (title, URL, selection, description)
  build.mjs                        esbuild MV3 build -> extension/dist (Load unpacked)
```

Editor and graph libraries chosen: **pdf.js (`pdfjs-dist`)** for PDF rendering with a text layer, **d3-force** for the graph, and a **custom lightweight block model** for the Notion style editor (Markdown backed).

---

## Using your library from an LLM chat

Two ways, both grounded in your own records rather than the model's recollection of
the literature.

**Copy for chat.** Every project page has a *Copy for chat* button: it puts the
project on your clipboard as Markdown — premise, open questions with which papers are
evidence for each, every paper with its citation key and your own takeaway, your
notes, and the gap list — ready to paste into any assistant. Paper abstracts are left
out on purpose: your takeaway is the signal, and the abstract is the paper's own
marketing.

**The MCP server.** `mcp/` is a read-only [MCP](https://modelcontextprotocol.io)
server that exposes the library to Claude Desktop and Claude Code as tools
(`list_projects`, `get_project`, `search_library`, `get_paper`, `get_note`,
`list_questions`). It reads the desktop build's workspace mirror straight off disk —
no sync service, no API key — and re-reads it when it changes, so edits show up
mid-conversation. Build it with `npm run mcp:build` and see **[mcp/README.md](mcp/README.md)**
for the client configuration.

It imports lattice's own analysis modules rather than reimplementing them, so what a
tool reports about a project is the same thing the project page shows.

---

## Supabase upgrade path (not implemented)

Everything the UI needs goes through the `Repository` interface in `client/src/lib/repository.ts`; the only other persistence is PDF blobs in `blobStore.ts`. To move from local only to hosted multi user:

1. **Auth.** Add Supabase Auth. Gate the app on a session; use the user id as the owner of every row.
2. **Postgres schema.** One table per repository entity: `papers`, `collections`, `paper_collections`, `tags` (or a `text[]` column), `highlights`, `notes`. Each row carries `user_id`. Store `rects` as `jsonb` and note `body` as `text` (the same Markdown form used today).
3. **RLS.** Enable row level security with `user_id = auth.uid()` policies so each user sees only their own data.
4. **Repository swap.** Implement the same `Repository` interface against the Supabase client (async). The UI already treats persistence as an abstraction, so this is the main change. The methods would become async, so the few call sites that read synchronously would await.
5. **PDF blobs.** Move blobs from IndexedDB to **Supabase Storage** (a private bucket keyed by paper id and user id); replace `blobStore.ts` with signed URL uploads and downloads.
6. **AI.** The server AI endpoints are unchanged; point them at the same Anthropic key, now per deployment rather than per machine.

No UI component changes are required beyond making repository calls async.
