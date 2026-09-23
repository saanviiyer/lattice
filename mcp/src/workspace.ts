// Locating and loading the lattice workspace.
//
// The desktop app mirrors the whole workspace to a plain JSON file after every
// change (see client/src/lib/workspaceMirror.ts). That file is the integration
// point: no server, no sync, no API keys — the library is already on disk in a
// documented shape, and this reads it.
//
// Read-only, deliberately. An assistant that can silently rewrite your library is
// a much larger promise than one that can read it, and everything valuable here
// comes from reading.

import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Collection, Note, Paper, ResearchQuestion } from "../../client/src/types";
import { normalizePlans, type ResearchPlan } from "../../client/src/lib/researchPlan";

export interface WorkspaceSnapshot {
  version: number;
  exportedAt: string;
  papers: Paper[];
  collections: Collection[];
  notes: Note[];
  questions: ResearchQuestion[];
  highlights: Array<{
    id: string;
    paperId: string;
    page: number;
    color: string;
    text: string;
    note?: string;
  }>;
  savedSearches: unknown[];
  /** Proposals with their agent plans. Absent from mirrors written before they existed. */
  plans: ResearchPlan[];
}

/**
 * Where Electron puts the app's userData, and so where lattice writes its mirror.
 * `LATTICE_WORKSPACE` overrides it, for a workspace kept in a synced folder or a
 * second library.
 */
export function workspacePaths(): string[] {
  const override = process.env.LATTICE_WORKSPACE;
  if (override) {
    // Accept either the folder or the file itself, since both are things a person
    // would reasonably paste in.
    return override.endsWith(".json") ? [override] : [path.join(override, "workspace.json")];
  }
  const home = os.homedir();
  const candidates =
    process.platform === "darwin"
      ? [path.join(home, "Library", "Application Support", "lattice")]
      : process.platform === "win32"
      ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "lattice")]
      : [
          path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "lattice"),
        ];
  return candidates.map((dir) => path.join(dir, "workspace", "workspace.json"));
}

function isSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<WorkspaceSnapshot>;
  return Array.isArray(snapshot.papers) && Array.isArray(snapshot.notes);
}

let cached: { path: string; mtimeMs: number; snapshot: WorkspaceSnapshot } | null = null;

export class WorkspaceMissingError extends Error {
  constructor(searched: string[]) {
    super(
      `No lattice workspace found. Looked in:\n${searched.map((p) => `  ${p}`).join("\n")}\n\n` +
        "Open the lattice desktop app once so it writes its workspace folder, or set " +
        "LATTICE_WORKSPACE to the folder holding workspace.json."
    );
    this.name = "WorkspaceMissingError";
  }
}

/**
 * The current workspace.
 *
 * Re-read whenever the file's mtime has moved, so a long-running session sees
 * edits made in the app while the conversation is going on rather than serving a
 * snapshot from whenever the server happened to start.
 */
export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const searched = workspacePaths();
  for (const candidate of searched) {
    let stats;
    try {
      stats = await stat(candidate);
    } catch {
      continue;
    }
    if (cached && cached.path === candidate && cached.mtimeMs === stats.mtimeMs) {
      return cached.snapshot;
    }
    const parsed: unknown = JSON.parse(await readFile(candidate, "utf8"));
    if (!isSnapshot(parsed)) {
      throw new Error(`${candidate} does not look like a lattice workspace.`);
    }
    // Older mirrors predate questions and saved searches; normalise so every
    // consumer can assume the arrays exist.
    const snapshot: WorkspaceSnapshot = {
      ...parsed,
      collections: parsed.collections || [],
      questions: parsed.questions || [],
      highlights: parsed.highlights || [],
      savedSearches: parsed.savedSearches || [],
      plans: normalizePlans((parsed as { plans?: unknown }).plans),
    };
    cached = { path: candidate, mtimeMs: stats.mtimeMs, snapshot };
    return snapshot;
  }
  throw new WorkspaceMissingError(searched);
}

/** Find a project by id, or by name (case-insensitive), so a person can just say it. */
export function findProject(
  collections: Collection[],
  needle: string
): Collection | undefined {
  const wanted = needle.trim().toLowerCase();
  return (
    collections.find((collection) => collection.id === needle) ||
    collections.find((collection) => collection.name.toLowerCase() === wanted) ||
    collections.find((collection) => collection.name.toLowerCase().includes(wanted))
  );
}
