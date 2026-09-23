// Mirrors the live workspace to a real folder on disk, in the desktop build only.
//
// The Repository is synchronous (localStorage), which is what lets the UI read state
// during render. That is a good fit for a browser and a bad fit for a desktop app,
// where the user reasonably expects their library to be a file they can find, copy to
// a backup drive, and keep in a synced folder.
//
// So browser storage stays the live store, and this writes a mirror after each change:
//   workspace/workspace.json   papers, collections, notes, highlights, questions
//   workspace/pdfs/<id>.pdf    the file bytes, one real PDF per paper
//
// The mirror is also the recovery path. On a launch where browser storage is empty
// but the folder is not (a reinstall, a cleared profile, a workspace folder copied
// from another machine), the app loads from disk instead of opening blank.

import { repo, type WorkspaceSnapshot } from "./repository";
import { bridge } from "./desktop";

let pending: number | null = null;
let inFlight: Promise<void> | null = null;
let dirtyWhileInFlight = false;

async function write(): Promise<void> {
  const api = bridge();
  if (!api) return;
  try {
    await api.writeWorkspace(repo.exportWorkspace());
  } catch (error) {
    // A failed mirror must never take the app down: the live store is still intact
    // and the next change will try again.
    console.error("lattice: could not mirror the workspace to disk", error);
  }
}

/**
 * Queue a mirror write. Called after every mutation, so it is debounced: typing in a
 * note fires this on each keystroke and only the settled result needs to reach disk.
 */
export function scheduleWorkspaceMirror(delayMs = 600): void {
  if (!bridge()) return;
  if (inFlight) {
    dirtyWhileInFlight = true;
    return;
  }
  if (pending != null) window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = null;
    inFlight = write().finally(() => {
      inFlight = null;
      // A change that landed mid-write would otherwise be missed entirely.
      if (dirtyWhileInFlight) {
        dirtyWhileInFlight = false;
        scheduleWorkspaceMirror(delayMs);
      }
    });
  }, delayMs);
}

/** Write immediately, for a quit or a reload where a debounce would lose the tail. */
export async function flushWorkspaceMirror(): Promise<void> {
  if (!bridge()) return;
  if (pending != null) {
    window.clearTimeout(pending);
    pending = null;
  }
  await write();
}

/** True when the live store holds nothing a user would miss. */
export function workspaceIsEmpty(): boolean {
  return (
    repo.listPapers().length === 0 &&
    repo.listNotes().length === 0 &&
    repo.listQuestions().length === 0 &&
    repo.listCollections().length === 0
  );
}

function looksLikeSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<WorkspaceSnapshot>;
  return Array.isArray(snapshot.papers) && Array.isArray(snapshot.notes);
}

/**
 * On a fresh browser store, adopt whatever the workspace folder holds. Returns the
 * number of papers recovered, or 0 when there was nothing to recover.
 *
 * Deliberately refuses to run when the live store has anything in it: overwriting a
 * real library with a stale mirror would be far worse than opening blank.
 */
export async function adoptWorkspaceFromDisk(): Promise<number> {
  const api = bridge();
  if (!api || !workspaceIsEmpty()) return 0;
  try {
    const snapshot = await api.readWorkspace();
    if (!looksLikeSnapshot(snapshot) || snapshot.papers.length + snapshot.notes.length === 0) {
      return 0;
    }
    repo.replaceWorkspace(snapshot);
    return snapshot.papers.length;
  } catch (error) {
    console.error("lattice: could not read the workspace folder", error);
    return 0;
  }
}
