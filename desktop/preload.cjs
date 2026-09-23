// preload.cjs - the desktop shell's bridge.
//
// Every call here is a named operation with a fixed shape, never a general "run this
// in the main process" escape hatch. The renderer parses PDFs from the open web, so
// it is treated as the least trusted part of the app: it can ask for a save dialog,
// but it cannot name an arbitrary path to write to.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lattice", {
  desktop: true,
  platform: process.platform,

  // Where the mirrored workspace lives, for display in the UI.
  workspacePath: () => ipcRenderer.invoke("lattice:workspace-path"),

  // The on-disk mirror of the workspace.
  readWorkspace: () => ipcRenderer.invoke("lattice:read-workspace"),
  writeWorkspace: (snapshot) => ipcRenderer.invoke("lattice:write-workspace", snapshot),

  // PDF bytes as real files in the workspace folder.
  writePdf: (id, bytes) => ipcRenderer.invoke("lattice:write-pdf", id, bytes),
  readPdf: (id) => ipcRenderer.invoke("lattice:read-pdf", id),
  deletePdf: (id) => ipcRenderer.invoke("lattice:delete-pdf", id),

  // Tells the shell which theme is on screen, so the window background matches it
  // now and on the next launch.
  setTheme: (theme) => ipcRenderer.send("lattice:theme", theme),

  // Native dialogs, in place of browser downloads and file inputs.
  saveFile: (payload) => ipcRenderer.invoke("lattice:save-file", payload),
  openFile: (payload) => ipcRenderer.invoke("lattice:open-file", payload),
  confirm: (payload) => ipcRenderer.invoke("lattice:confirm", payload),

  // A file the user opened from Finder, the dock, or the Open PDF menu item.
  readFile: (filePath) => ipcRenderer.invoke("lattice:read-file", filePath),

  // Menu commands arrive here. The renderer decides what each one means.
  onCommand: (handler) => {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on("lattice:command", listener);
    return () => ipcRenderer.removeListener("lattice:command", listener);
  },
  onOpenPdf: (handler) => {
    const listener = (_event, paths) => handler(paths);
    ipcRenderer.on("lattice:open-pdf", listener);
    return () => ipcRenderer.removeListener("lattice:open-pdf", listener);
  },

  // Tells the shell the UI is mounted and can receive queued open-file requests.
  ready: () => ipcRenderer.send("lattice:ready"),
});
