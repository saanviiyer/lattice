import { describe, expect, it } from "vitest";
import { parseWorkspaceSnapshot, workspaceBackupFilename } from "../lib/workspaceBackup";

describe("workspace backups", () => {
  it("rejects malformed backups", () => {
    expect(() => parseWorkspaceSnapshot({ version: 1, papers: [] })).toThrow(/valid/i);
  });

  it("uses a stable dated filename", () => {
    expect(workspaceBackupFilename(new Date("2026-08-17T12:00:00Z")))
      .toBe("lattice-workspace-2026-08-17.lattice");
  });

  it("upgrades version 1 backups with an empty questions collection", () => {
    const snapshot = parseWorkspaceSnapshot({
      version: 1,
      exportedAt: "2026-01-01T00:00:00Z",
      papers: [], collections: [], highlights: [], notes: [],
    });
    expect(snapshot.version).toBe(3);
    expect(snapshot.questions).toEqual([]);
    expect(snapshot.savedSearches).toEqual([]);
  });

  it("upgrades version 2 backups with an empty saved-search collection", () => {
    const snapshot = parseWorkspaceSnapshot({
      version: 2,
      exportedAt: "2026-01-01T00:00:00Z",
      papers: [], collections: [], highlights: [], notes: [], questions: [],
    });
    expect(snapshot.version).toBe(3);
    expect(snapshot.savedSearches).toEqual([]);
  });

  it("preserves saved searches in version 3 backups", () => {
    const savedSearch = {
      id: "search-1",
      name: "Recent methods",
      query: "year:2026 tag:methods",
      createdAt: "2026-08-24T00:00:00Z",
    };
    const snapshot = parseWorkspaceSnapshot({
      version: 3,
      exportedAt: "2026-08-24T00:00:00Z",
      papers: [], collections: [], highlights: [], notes: [], questions: [],
      savedSearches: [savedSearch],
    });
    expect(snapshot.savedSearches).toEqual([savedSearch]);
  });
});
