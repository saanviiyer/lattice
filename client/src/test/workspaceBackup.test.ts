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
});
