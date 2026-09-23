// main.cjs - the lattice desktop shell.
//
// Three things here are load bearing and none of them is boilerplate:
//
//  1. The UI is served over a custom `lattice://` scheme, not over
//     http://localhost:PORT. The renderer keeps the entire workspace in
//     localStorage and IndexedDB, both of which are keyed by origin. If the app
//     loaded from a port, then a launch where that port happened to be busy would
//     open a different origin and the user's whole library would appear to have
//     vanished. A fixed scheme makes the storage origin independent of the port.
//
//  2. The Express API runs inside this process on an OS-assigned port, and /api
//     requests are proxied to it from the same handler. That keeps the API
//     same-origin from the renderer's point of view, so the desktop build needs no
//     CORS configuration and no separate base URL baked into the bundle.
//
//  3. The workspace is mirrored to a real folder on disk (workspace.json plus one
//     PDF per paper). Browser storage is the live store because the repository is
//     synchronous, but a desktop app's data should be a file the user can find,
//     copy, and sync, and should survive the browser storage being cleared.
//
// Request mapping lives in serve.cjs so it can be tested without launching Electron.

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const {
  mimeFor,
  isApiRequest,
  apiTarget,
  resolveInDist,
  pdfPathFor,
} = require("./serve.cjs");

const DIST = path.join(__dirname, "..", "client", "dist");
const SCHEME = "lattice";
const APP_ORIGIN = `${SCHEME}://app`;

let apiOrigin = null; // set once the embedded server is listening
let mainWindow = null;
let pendingOpenPaths = []; // PDFs handed to us before the window was ready

const WORKSPACE_DIR = path.join(app.getPath("userData"), "workspace");
const WORKSPACE_FILE = path.join(WORKSPACE_DIR, "workspace.json");
const WINDOW_STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

// Must run before `ready`. `standard` gives the scheme a real origin, which is what
// localStorage and IndexedDB need in order to persist at all.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ---------------------------------------------------------------- request handling

function fileResponse(filePath) {
  return new Response(fs.readFileSync(filePath), {
    headers: { "content-type": mimeFor(filePath) },
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);

  if (isApiRequest(url.pathname)) {
    if (!apiOrigin) return new Response("lattice API is still starting", { status: 503 });
    try {
      return await net.fetch(apiTarget(apiOrigin, url.pathname, url.search), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        // Required by fetch whenever a request body is streamed.
        duplex: "half",
      });
    } catch (err) {
      return new Response(`lattice API unreachable: ${err.message}`, { status: 502 });
    }
  }

  const target = resolveInDist(DIST, url.pathname);
  if (!target) return new Response("forbidden", { status: 403 });

  try {
    return fileResponse(target);
  } catch {
    // A missing asset falls back to the shell rather than a blank window.
    try {
      return fileResponse(path.join(DIST, "index.html"));
    } catch {
      return new Response("lattice is not built yet. Run: npm run build", { status: 404 });
    }
  }
}

// ------------------------------------------------------------------ window state

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, "utf8"));
    if (typeof state.width === "number" && typeof state.height === "number") return state;
  } catch {
    // No saved state, or it is unreadable. Either way, fall back to the default.
  }
  return { width: 1440, height: 920 };
}

// The window is painted before the page is, so its background has to match the theme
// the app is about to render or the launch flashes the wrong colour -- and a resize
// shows the mismatch again, at the edges, every time.
const WINDOW_GROUND = { dark: "#080c13", light: "#ffffff" };

function launchBackground() {
  const state = readWindowState();
  const choice = state.theme === "light" || state.theme === "dark" ? state.theme : null;
  // No stored choice means the app is following the OS, and so does the window.
  const resolved = choice || (nativeTheme.shouldUseDarkColors ? "dark" : "light");
  return WINDOW_GROUND[resolved];
}

function saveWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const [width, height] = win.getSize();
  const [x, y] = win.getPosition();
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_FILE), { recursive: true });
    fs.writeFileSync(
      WINDOW_STATE_FILE,
      JSON.stringify({ width, height, x, y, maximized: win.isMaximized(), theme: currentTheme })
    );
  } catch {
    // Losing the window position is not worth interrupting a quit over.
  }
}

// -------------------------------------------------------------- renderer commands

/** Send a menu command to the renderer, which decides what it means. */
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function openPdfPaths(paths) {
  const pdfs = paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) return;
  if (!mainWindow || mainWindow.webContents.isLoadingMainFrame()) {
    pendingOpenPaths.push(...pdfs);
    return;
  }
  send("lattice:open-pdf", pdfs);
}

// -------------------------------------------------------------------------- menu

function buildMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    ...(isMac
      ? [
          {
            label: "lattice",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Add Paper…",
          accelerator: "CmdOrCtrl+N",
          click: () => send("lattice:command", "add-paper"),
        },
        {
          label: "New Note",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => send("lattice:command", "new-note"),
        },
        { type: "separator" },
        {
          label: "Open PDF…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: "Open a PDF in lattice",
              filters: [{ name: "PDF", extensions: ["pdf"] }],
              properties: ["openFile", "multiSelections"],
            });
            if (!result.canceled) openPdfPaths(result.filePaths);
          },
        },
        { type: "separator" },
        {
          label: "Export Workspace Backup…",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => send("lattice:command", "export-backup"),
        },
        {
          label: "Restore From Backup…",
          click: () => send("lattice:command", "restore-backup"),
        },
        { type: "separator" },
        {
          label: "Reveal Workspace Folder",
          click: () => {
            fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
            shell.openPath(WORKSPACE_DIR);
          },
        },
        ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find in Library",
          accelerator: "CmdOrCtrl+K",
          click: () => send("lattice:command", "search"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Research Desk",
          accelerator: "CmdOrCtrl+1",
          click: () => send("lattice:command", "view-home"),
        },
        {
          label: "Library",
          accelerator: "CmdOrCtrl+2",
          click: () => send("lattice:command", "view-library"),
        },
        {
          label: "Knowledge Graph",
          accelerator: "CmdOrCtrl+3",
          click: () => send("lattice:command", "view-graph"),
        },
        {
          label: "Guide",
          accelerator: "CmdOrCtrl+4",
          click: () => send("lattice:command", "view-guide"),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "lattice Guide",
          click: () => send("lattice:command", "view-guide"),
        },
        {
          label: "Reveal Workspace Folder",
          click: () => {
            fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
            shell.openPath(WORKSPACE_DIR);
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --------------------------------------------------------------------- IPC: disk

async function ensureWorkspaceDir() {
  await fsp.mkdir(path.join(WORKSPACE_DIR, "pdfs"), { recursive: true });
}

ipcMain.handle("lattice:workspace-path", () => WORKSPACE_DIR);

// Read the mirrored workspace back, for a first launch on a fresh browser store.
ipcMain.handle("lattice:read-workspace", async () => {
  try {
    return JSON.parse(await fsp.readFile(WORKSPACE_FILE, "utf8"));
  } catch {
    return null;
  }
});

// Mirror the current workspace to disk. Written to a temp file and renamed, so a
// crash mid-write cannot leave a truncated workspace.json behind.
ipcMain.handle("lattice:write-workspace", async (_event, snapshot) => {
  await ensureWorkspaceDir();
  const tmp = `${WORKSPACE_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  await fsp.rename(tmp, WORKSPACE_FILE);
  return true;
});

ipcMain.handle("lattice:write-pdf", async (_event, id, bytes) => {
  const target = pdfPathFor(WORKSPACE_DIR, id);
  if (!target) return false;
  await ensureWorkspaceDir();
  await fsp.writeFile(target, Buffer.from(bytes));
  return true;
});

ipcMain.handle("lattice:read-pdf", async (_event, id) => {
  const target = pdfPathFor(WORKSPACE_DIR, id);
  if (!target) return null;
  try {
    const buf = await fsp.readFile(target);
    return new Uint8Array(buf).buffer;
  } catch {
    return null;
  }
});

ipcMain.handle("lattice:delete-pdf", async (_event, id) => {
  const target = pdfPathFor(WORKSPACE_DIR, id);
  if (!target) return false;
  await fsp.rm(target, { force: true });
  return true;
});

// Read a PDF the user picked in Finder or dropped on the dock.
ipcMain.handle("lattice:read-file", async (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath.toLowerCase().endsWith(".pdf")) return null;
  try {
    const buf = await fsp.readFile(filePath);
    return { name: path.basename(filePath), bytes: new Uint8Array(buf).buffer };
  } catch {
    return null;
  }
});

// ------------------------------------------------------------------ IPC: dialogs

ipcMain.handle("lattice:save-file", async (_event, { name, bytes, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save",
    defaultPath: path.join(app.getPath("documents"), name || "lattice-export"),
    filters: filters || [],
  });
  if (result.canceled || !result.filePath) return null;
  await fsp.writeFile(result.filePath, Buffer.from(bytes));
  return result.filePath;
});

ipcMain.handle("lattice:open-file", async (_event, { filters } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open",
    filters: filters || [],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const buf = await fsp.readFile(filePath);
  return { name: path.basename(filePath), bytes: new Uint8Array(buf).buffer };
});

ipcMain.handle("lattice:confirm", async (_event, { message, detail, confirmLabel }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: [confirmLabel || "Continue", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: message || "Are you sure?",
    detail,
  });
  return result.response === 0;
});

// The renderer owns the theme choice; the main process only needs the resolved value,
// so the next launch paints the right background before the page exists.
let currentTheme = null;
ipcMain.on("lattice:theme", (_event, theme) => {
  if (theme !== "light" && theme !== "dark") return;
  currentTheme = theme;
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.setBackgroundColor(WINDOW_GROUND[theme]);
});

ipcMain.on("lattice:ready", () => {
  if (pendingOpenPaths.length) {
    send("lattice:open-pdf", pendingOpenPaths);
    pendingOpenPaths = [];
  }
});

// ------------------------------------------------------------------------ window

function createWindow() {
  const state = readWindowState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: launchBackground(),
    title: "lattice",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (state.maximized) win.maximize();
  win.loadURL(`${APP_ORIGIN}/index.html`);
  win.once("ready-to-show", () => win.show());

  for (const event of ["resize", "move", "close"]) {
    win.on(event, () => saveWindowState(win));
  }

  // Links out of the app open in the real browser, never in a shell window that
  // holds the app's own permissions.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  return win;
}

// ------------------------------------------------------------------------ startup

// A second launch focuses the running window instead of opening a rival copy that
// would write to the same workspace folder.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    openPdfPaths(argv.slice(1).filter((a) => a.toLowerCase().endsWith(".pdf")));
  });

  // macOS delivers "Open With" and dock drops through this event, which can fire
  // before the app is ready.
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    openPdfPaths([filePath]);
  });

  app.whenReady().then(async () => {
    protocol.handle(SCHEME, handleRequest);
    await ensureWorkspaceDir();

    // Port 0 asks the OS for a free port. Bound to loopback so the embedded API is
    // not reachable from the network; the web clipper extension talks to the
    // separately run `npm start` server, not to this one.
    try {
      const serverModule = await import(
        pathToFileURL(path.join(__dirname, "..", "server", "index.js")).href
      );
      const server = await serverModule.startServer(0, "127.0.0.1");
      apiOrigin = `http://127.0.0.1:${server.address().port}`;
    } catch (err) {
      // The library, notes, graph, and PDF reader are all local. Losing the API
      // only costs metadata lookups and the AI actions, so the app still opens.
      console.error(`lattice API failed to start: ${err.message}`);
    }

    buildMenu();
    mainWindow = createWindow();

    // A headless self-check for CI and for verifying a change to this file without a
    // human at the screen: boot the real shell, then assert that the custom scheme
    // actually served the app, that the preload bridge reached the renderer, and that
    // an /api request was proxied to the embedded server. Exits non-zero on failure.
    if (process.env.LATTICE_SMOKE) {
      mainWindow.webContents.once("did-finish-load", async () => {
        const checks = [];
        const check = async (name, expression) => {
          try {
            checks.push([name, await mainWindow.webContents.executeJavaScript(expression)]);
          } catch (err) {
            checks.push([name, `threw: ${err.message}`]);
          }
        };

        await check("app origin", "location.origin");
        await check("react mounted", "document.querySelector('#root')?.children.length > 0");
        await check("app rendered", "document.body.innerText.includes('lattice')");
        await check("preload bridge", "!!window.lattice?.desktop");
        await check("workspace path", "window.lattice.workspacePath()");
        await check(
          "api proxied",
          "fetch('/api/health').then(r => r.json()).then(j => j.ok === true)"
        );
        // The disk mirror round-trips. Safe to run because the smoke script points
        // Electron at a throwaway user-data directory.
        await check(
          "workspace mirror",
          `window.lattice.writeWorkspace({ version: 3, papers: [{ id: 'smoke' }], notes: [] })
             .then(() => window.lattice.readWorkspace())
             .then(w => w?.papers?.[0]?.id === 'smoke')`
        );
        await check(
          "pdf mirror",
          `window.lattice.writePdf('smoke', new Uint8Array([37, 80, 68, 70]).buffer)
             .then(() => window.lattice.readPdf('smoke'))
             .then(b => b != null && new Uint8Array(b)[1] === 80)`
        );
        await check(
          "pdf path traversal refused",
          "window.lattice.writePdf('../escape', new Uint8Array([1]).buffer).then(r => r === false)"
        );
        // The frameless title bar draws the window controls over the top-left of the
        // sidebar. If this inset ever stops applying they land on the logo again.
        await check(
          "titlebar inset applied",
          "getComputedStyle(document.querySelector('.lat-titlebar')).paddingTop === '34px'"
        );
        // The guide is the app's only onboarding. It has to be reachable from the
        // first screen, not just from a menu.
        await check(
          "guide reachable from the first screen",
          "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Guide')"
        );

        let failed = false;
        for (const [name, value] of checks) {
          const ok = value !== false && value !== null && typeof value !== "undefined" &&
            !String(value).startsWith("threw:");
          if (!ok) failed = true;
          console.log(`${ok ? "ok  " : "FAIL"}  ${name}: ${value}`);
        }
        app.exit(failed ? 1 : 0);
      });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
