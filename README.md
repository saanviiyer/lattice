# lattice

lattice is a local-first reference manager for researchers. It keeps a paper library, PDF highlights, linked notes and a knowledge graph in one app. It can also hand your library to Claude or ChatGPT as a document built from your own records.

The app works fully with no API key. Grouping, naming, gap-finding and project suggestions come from counts over your own library. No model generates them. The homepage is `site/index.html`, served at `/home`.

## Features

- Paper library. Import by DOI (CrossRef), arXiv id or URL, PDF upload, or whole `.bib` and `.ris` files. Duplicates merge by DOI, arXiv id or normalized title. Export BibTeX or RIS, and copy APA, MLA or Chicago citations.
- Open-access PDFs. A paper added by DOI or arXiv id fetches its own PDF when a free copy exists (arXiv, Unpaywall, OpenAlex, CrossRef). The server checks that the bytes are a PDF and stores nothing. A paywalled paper waits for your own file.
- PDF annotation. pdf.js renders the PDF with a text layer. Highlights come in five colors, carry notes, and stay anchored at any zoom. You can export the PDF with the highlights as standard PDF annotations.
- Linked notes. A block editor with a `/` menu, Markdown shortcuts, nested lists and `[[wikilink]]` autocomplete. A backlinks panel shows what links to each note. The stored body is plain Markdown.
- Knowledge graph. A d3-force graph of papers, notes and research questions. You can focus a node, trace the shortest path between two nodes, and see hubs, unconnected nodes and separate islands. It can group nodes by project or by subject.
- Research desk. A home page with a reading queue, reading states, one takeaway per paper, research questions linked to evidence, and grounded Q&A over the library. With no key, Q&A returns a ranked evidence map and does not write an answer.
- Projects. Projects nest to any depth and hold papers, notes and questions. Each has a premise, a status and a ranked list of what it still needs. Deleting a project keeps its contents.
- Automatic grouping. One button files unfiled papers into collections named after research fields (from `client/src/lib/fieldLexicon.ts`). On a 495-paper import it filed 448 papers into 74 collections in about a second. Undo removes only the projects it made. A review mode shows proposals first (14 broad or 33 fine themes on the same import).
- Suggested projects. The desk proposes projects from counts in your library, and each suggestion shows the counts behind it.
- Share a project. Export a `.latticeproject` file. You choose whether to include your notes and highlights, and whether to include PDFs (off by default, since most publisher PDFs are not yours to share). Import merges and never overwrites.
- Send to an LLM. Export one or more projects as a Markdown document for a chat, or as a small `CLAUDE.md` for a coding agent. The size in tokens shows before you copy. On one 20-paper project the three detail levels are about 1.4k, 6k and 21k tokens.
- AI actions. Explain a highlight, or turn a paper's highlights into a note. These use `claude-sonnet-5` when `ANTHROPIC_API_KEY` is set, and a structured mock when it is not.
- Proposals. Each project can hold a proposal and an agent plan with tasks for seven roles. The first draft comes from the project alone. "Draft with Claude" uses `claude-opus-5` and removes any citation to a paper outside your library.
- Research brain. Infers your interests from what you do. It finds papers you do not have yet by looking up the reference lists of your most-used papers in OpenAlex.
- Backup. A dated `.lattice` archive holds the whole workspace, PDFs included. Restore rebuilds it in any browser.

In the browser, data lives in localStorage (records) and IndexedDB (PDF bytes). Nothing is uploaded to the server for storage.

Limits: the note editor is a light block model (no drag to reorder, no inline images). Metadata guesses for a PDF with no DOI can be wrong. Scanned PDFs with no text layer get no AI actions. There is no login and no live sync. Mouse-driven PDF highlighting was checked by hand in a browser, and the automated tests cover only the anchoring math.

## Run it

Needs Node 18 or later (Node 20 recommended).

```bash
git clone https://github.com/saanviiyer/lattice
cd lattice
npm install        # also installs client deps
npm run dev        # server on :3001, Vite client on :5173
```

Open http://localhost:5173.

Production, one origin:

```bash
npm run build      # type-check and build the client to client/dist
npm start          # Express serves the client and /api on $PORT (default 3001)
```

Tests:

```bash
npm test           # client (vitest), server and desktop (node:test), and the MCP server
```

Docker and Render: the `Dockerfile` is a multi-stage build. `render.yaml` deploys it with `ANTHROPIC_API_KEY` as a secret.

```bash
docker build -t lattice .
docker run -p 3001:3001 -e ANTHROPIC_API_KEY=... lattice
```

The server sends security headers and a same-origin CSP, and applies per-instance rate limits. If you scale to more than one instance, add a shared rate limit at the hosting edge. The arXiv client paces requests to about one every three seconds and backs off after a 429.

### Desktop app

```bash
npm run desktop          # build the client and open the Electron app
npm run desktop:dev      # open without rebuilding
npm run desktop:smoke    # headless check of the shell, exits non-zero on failure
npm run desktop:build    # write release/lattice-<platform>-<arch>/lattice.app (about 244 MB)
```

The desktop app mirrors the workspace to `<userData>/lattice/workspace/` (`workspace.json` plus `pdfs/`). It loads the UI over a `lattice://` scheme so storage does not depend on a port. The build is unsigned by default. On macOS, right-click the app and choose Open the first time. To sign and notarize, set the signing variables below (needs a paid Apple Developer account).

### Web clipper

A Chrome extension in `extension/` saves a web page to the lattice "Web clippings" inbox.

```bash
cd extension && npm install && npm run build
```

Load `extension/dist` as an unpacked extension in `chrome://extensions`. It posts to the server at `http://localhost:3001` by default (set this in its options page). It does not talk to the desktop app's embedded server. Offline clippings wait in a queue and sync later.

### MCP server

`mcp/` is a read-only MCP server that gives Claude Desktop or Claude Code access to the desktop app's workspace mirror. It has seven tools. Build it with `npm run mcp:build`. See [mcp/README.md](mcp/README.md).

## Environment variables

All are optional. With none set, the app runs in mock AI mode and metadata lookups still work.

| Name | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Turns on live AI actions. Without it the AI actions return a mock. |
| `ANTHROPIC_AUTH_TOKEN` | Alternative to the API key for proposal drafting. |
| `LATTICE_PLAN_MODEL` | Model for "Draft with Claude" (default `claude-opus-5`). |
| `OA_CONTACT_EMAIL` | Contact address sent to Unpaywall and OpenAlex. |
| `PORT` | Server port (default 3001). |
| `CORS_ORIGIN` | Set only when the UI runs on a different origin. |
| `LATTICE_ARXIV_INTERVAL_MS` | Minimum gap between arXiv requests (default 3000, used by tests). |
| `LATTICE_WORKSPACE` | MCP server only. Folder that holds `workspace.json`. |
| `LATTICE_SIGN_IDENTITY` | Desktop build. Code-signing identity. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Desktop build. Notarization. Signing without them gives an app that Gatekeeper still blocks on other machines. |
| `LATTICE_PLATFORM`, `LATTICE_ARCH` | Desktop build. Target platform and architecture. |

Copy `.env.example` to `.env` to set them locally.

## Layout

```
client/      React + Vite app (src/lib holds the data layer and analysis, src/components the UI)
server/      Express API: metadata, open-access PDF fetch, AI, clippings. Serves client/dist in production
desktop/     Electron shell (main, preload bridge, request mapping)
mcp/         read-only MCP server over the desktop workspace mirror
extension/   Chrome web clipper (Manifest V3)
scripts/     desktop packaging and signing
site/        homepage
```

All persistence goes through the `Repository` interface in `client/src/lib/repository.ts`, with PDF bytes in `blobStore.ts`. A hosted multi-user version (for example on Supabase) would replace those two files. That version is not built.

## Not in the repo

The desktop build output (`release/`, `build/`) is not committed. A personal workspace export is not committed either. The clipping queue at `server/data/clippings.json` is gitignored.
