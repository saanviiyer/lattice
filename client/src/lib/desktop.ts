// The renderer's half of the desktop bridge.
//
// Everything here degrades to a no-op in a browser tab, so the same bundle runs as a
// website and inside the Electron shell. Call sites ask `isDesktop()` when the two
// need to behave differently (a native save dialog instead of a download, say) and
// otherwise ignore this module entirely.

export interface OpenedFile {
  name: string;
  bytes: ArrayBuffer;
}

interface DesktopBridge {
  desktop: true;
  platform: string;
  workspacePath(): Promise<string>;
  readWorkspace(): Promise<unknown | null>;
  writeWorkspace(snapshot: unknown): Promise<boolean>;
  writePdf(id: string, bytes: ArrayBuffer): Promise<boolean>;
  readPdf(id: string): Promise<ArrayBuffer | null>;
  deletePdf(id: string): Promise<boolean>;
  /** Older shells predate this, so it is optional. */
  setTheme?(theme: "light" | "dark"): void;
  saveFile(payload: {
    name: string;
    bytes: ArrayBuffer;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  openFile(payload?: {
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenedFile | null>;
  confirm(payload: {
    message: string;
    detail?: string;
    confirmLabel?: string;
  }): Promise<boolean>;
  readFile(filePath: string): Promise<OpenedFile | null>;
  onCommand(handler: (command: string) => void): () => void;
  onOpenPdf(handler: (paths: string[]) => void): () => void;
  ready(): void;
}

declare global {
  interface Window {
    lattice?: DesktopBridge;
  }
}

export function bridge(): DesktopBridge | null {
  return typeof window !== "undefined" && window.lattice?.desktop ? window.lattice : null;
}

export function isDesktop(): boolean {
  return bridge() != null;
}

/**
 * Ask the user for a place to put a file.
 *
 * On the desktop this is a real save panel and the file lands wherever they chose.
 * In a browser it is a download, which is the closest equivalent available. Returns
 * the saved path on the desktop, an empty string for a browser download, and null
 * only when the user cancelled.
 */
export async function saveFileAs(
  blob: Blob,
  name: string,
  filters?: Array<{ name: string; extensions: string[] }>
): Promise<string | null> {
  const api = bridge();
  if (api) {
    return api.saveFile({ name, bytes: await blob.arrayBuffer(), filters });
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "";
}

/** A native confirmation sheet on the desktop, window.confirm in a browser. */
export async function confirmAction(
  message: string,
  detail?: string,
  confirmLabel?: string
): Promise<boolean> {
  const api = bridge();
  if (api) return api.confirm({ message, detail, confirmLabel });
  return window.confirm(detail ? `${message}\n\n${detail}` : message);
}
