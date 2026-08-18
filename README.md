# lattice

A research knowledge workspace that combines the three tools researchers juggle:

- **Zotero** (a paper library): import papers by DOI, arXiv, or PDF upload; organize with collections and tags; search.
- **Obsidian** (linked notes plus a knowledge graph): write notes that link papers and other notes with `[[wikilinks]]`, see backlinks, and view a force directed graph of everything.
- **Notion** (a block editor): notes are made of typed blocks (headings, lists, to-dos, quotes, code) with a `/` slash menu.

The core loop is: import a paper, annotate its PDF (highlight plus attach notes), write linked block notes, and watch the knowledge graph and backlinks fill in.

This is a usable local-first research workspace, not a demo shell. The Feature status section below is explicit about what is fully working versus what remains intentionally lightweight.

---

## Quick start

Requirements: Node 18+ (Node 20 recommended).

```bash
npm install       # installs server deps and (via postinstall) client deps
npm run dev        # server on :3001, Vite client on :5173 (proxies /api)
```

Open http://localhost:5173.

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
npm test           # vitest: wikilink parsing, backlink/graph construction, highlight-anchor round-trip, block round-trip
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

- **Paper library (Zotero side).** Import by DOI (CrossRef), arXiv id or URL (arXiv API), or PDF upload (server extracts text with unpdf and guesses metadata, resolving an embedded DOI through CrossRef when present). Collections, editable per-paper tags and collection membership, full text search over the library, and a library sidebar. Duplicate papers merge by DOI, arXiv id, or normalized title.
- **Complete paper lifecycle.** Correct imported titles, authors, year, venue, DOI, URL, and abstract in place. A DOI/arXiv-only record can later receive a PDF, and an existing PDF can be replaced without recreating the paper or losing its notes and organization. Attaching remains useful while offline: the PDF is stored even if server-side text extraction is unavailable.
- **Citation export.** Export the whole library or the currently filtered collection/tag/search result as a deduplicated BibTeX file.
- **PDF storage split.** Uploaded PDF file bytes are stored as a blob in **IndexedDB**; all metadata, annotations, notes, and links go through a single repository abstraction backed by **localStorage**. Nothing is uploaded to the server for persistence.
- **PDF annotation (the core).** A paper's PDF renders with pdf.js including the selectable text layer. Selecting text creates a highlight in one of five colors. Each highlight stores `{ paperId, page, rects, text, color, note }` with rects normalized as fractions of the page, so highlights **re-anchor at any zoom and persist across reloads**. A sidebar lists highlights; clicking one scrolls to it; clicking a highlight (or its list row) lets you add or edit a note and change its color.
- **Linked notes (Obsidian plus Notion sides).** A block editor (see below) for standalone notes and per paper notes docs, with `[[wikilink]]` autocomplete that suggests papers and notes. Links are parsed and a **backlinks panel** shows what links to the current note. Each paper has a dedicated notes doc (the Notes button).
- **Knowledge graph (P1).** A force directed graph (d3-force on a canvas) of papers and notes as nodes, with `[[wikilink]]` edges and the implicit paper to note relation. Drag nodes; click a node to open it.
- **Annotated PDF export.** Download the original PDF with every lattice
  highlight embedded as a standard, portable PDF Highlight annotation. Attached
  notes are stored as annotation contents and appear in compatible PDF readers'
  comments sidebars; the original page text remains selectable.
- **Complete workspace backup and restore.** A single dated `.lattice` archive
  contains papers, collections, tags, notes, backlinks, highlights, and the
  original PDF blobs. Restore validates the archive and reconstructs both
  localStorage and IndexedDB, so a workspace can move between browsers or be
  kept as an offline backup.
- **AI actions (P2), with mock fallback.** Explain a highlight, and synthesize a paper's highlights into a Markdown note. Uses `claude-sonnet-5` when `ANTHROPIC_API_KEY` is set; otherwise a realistic structured mock. The synthesis is saved as a new note linked to the paper.

### MVP level (works, but intentionally lightweight)

- **The block editor is a lightweight block model, not TipTap/ProseMirror.** It is genuinely block based: the note body is an array of typed blocks (paragraph, H1, H2, H3, bulleted list, numbered list, to-do checkbox, quote, code, divider). Enter creates a new block, Backspace at the start of a styled block turns it back into a paragraph (and merges into the previous block when already a paragraph), and a `/` slash menu inserts or converts the current block. Each block is its own auto growing editable element with a light hover affordance (a `+` in the gutter). `[[wikilink]]` autocomplete works inside every block. We did **not** pull in full TipTap because of the package weight; instead blocks serialize to and from Markdown, which keeps wikilink parsing, backlinks, the graph, and the Supabase path all working on one plain string form. Trade offs: inline `[[links]]` show as raw source text while editing (navigation is via the contextual Links and Backlinks panel and the graph, not by clicking the inline text); rich inline marks beyond `[[links]]` are not styled in place.
- **PDF metadata heuristics.** For an uploaded PDF with no DOI, title and author guesses come from first page heuristics and can be imperfect. Scanned image PDFs with no text layer are flagged (the app still stores them, but there is no text for AI actions).
- **AI explain context** is the paper abstract or a slice of extracted text, not the full surrounding page.

### Not implemented (stubs / out of scope for this MVP)

- **Supabase / auth / multi device sync.** Documented below as the upgrade path; not implemented. All data is local to the browser.
- **Rich collaborative editing, drag to reorder blocks, nested lists, and inline images** in the note editor.

### An honest note on browser verification

The highlight **data model** and its re-anchoring math are covered by unit tests (serialize a highlight's rects to quadpoints and restore them). Live PDF text layer highlighting (select text with the mouse, get a colored highlight anchored to the page) genuinely needs a real browser with a real text selection; it was built against pdf.js's text layer and verified to render, but exercising the drag select gesture reliably requires a human browser session rather than an automated one.

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
      repository.ts     single data-access interface over localStorage (papers, collections, tags, highlights, notes)
      blobStore.ts      PDF blobs in IndexedDB
      api.ts            fetch wrappers for /api
      wikilink.ts       [[link]] parsing (unit tested)
      graph.ts          backlinks + graph construction (unit tested)
      highlightAnchor.ts rect <-> quadpoint + screen <-> normalized (unit tested)
      blocks.ts         block model + Markdown serialize/parse (unit tested)
    components/
      PdfReader.tsx      pdf.js render + text layer + highlight create/render
      PaperView.tsx      PDF surface + highlights sidebar + AI actions
      NoteEditor.tsx     Notion style block editor + slash menu + wikilink autocomplete + contextual panel
      GraphView.tsx      d3-force canvas graph
      AddPaper.tsx       DOI / arXiv / PDF import
server/
  index.js   Express: /api metadata (DOI, arXiv, PDF), AI (explain, synthesize), clippings, health; serves client/dist in production
  crossref.js, arxiv.js, parse.js, http.js, ai.js
  clippings.js   file-backed web-clipping queue (server/data/clippings.json)
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

## Supabase upgrade path (not implemented)

Everything the UI needs goes through the `Repository` interface in `client/src/lib/repository.ts`; the only other persistence is PDF blobs in `blobStore.ts`. To move from local only to hosted multi user:

1. **Auth.** Add Supabase Auth. Gate the app on a session; use the user id as the owner of every row.
2. **Postgres schema.** One table per repository entity: `papers`, `collections`, `paper_collections`, `tags` (or a `text[]` column), `highlights`, `notes`. Each row carries `user_id`. Store `rects` as `jsonb` and note `body` as `text` (the same Markdown form used today).
3. **RLS.** Enable row level security with `user_id = auth.uid()` policies so each user sees only their own data.
4. **Repository swap.** Implement the same `Repository` interface against the Supabase client (async). The UI already treats persistence as an abstraction, so this is the main change. The methods would become async, so the few call sites that read synchronously would await.
5. **PDF blobs.** Move blobs from IndexedDB to **Supabase Storage** (a private bucket keyed by paper id and user id); replace `blobStore.ts` with signed URL uploads and downloads.
6. **AI.** The server AI endpoints are unchanged; point them at the same Anthropic key, now per deployment rather than per machine.

No UI component changes are required beyond making repository calls async.
