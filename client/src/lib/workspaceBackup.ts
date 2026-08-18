import type { WorkspaceSnapshot } from "./repository";
import { repo } from "./repository";
import { clearPdfs, getPdf, putPdf } from "./blobStore";

const MANIFEST = "workspace.json";

export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const snapshot = value as Partial<WorkspaceSnapshot> | null;
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.papers) ||
    !Array.isArray(snapshot.collections) ||
    !Array.isArray(snapshot.highlights) ||
    !Array.isArray(snapshot.notes)
  ) {
    throw new Error("This is not a valid lattice workspace backup.");
  }
  return snapshot as WorkspaceSnapshot;
}

export async function createWorkspaceBackup(): Promise<Blob> {
  const { strToU8, zipSync } = await import("fflate");
  const snapshot = repo.exportWorkspace();
  const files: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(JSON.stringify(snapshot, null, 2)),
  };
  for (const paper of snapshot.papers) {
    if (!paper.hasPdf) continue;
    const pdf = await getPdf(paper.id);
    if (pdf) files[`pdfs/${paper.id}.pdf`] = new Uint8Array(await pdf.arrayBuffer());
  }
  const archive = zipSync(files, { level: 6 });
  return new Blob([Uint8Array.from(archive).buffer], {
    type: "application/vnd.lattice.workspace+zip",
  });
}

export async function restoreWorkspaceBackup(file: Blob): Promise<WorkspaceSnapshot> {
  const { strFromU8, unzipSync } = await import("fflate");
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifest = files[MANIFEST];
  if (!manifest) throw new Error("The backup is missing workspace.json.");
  const snapshot = parseWorkspaceSnapshot(JSON.parse(strFromU8(manifest)));

  await clearPdfs();
  for (const paper of snapshot.papers) {
    const bytes = files[`pdfs/${paper.id}.pdf`];
    paper.hasPdf = !!bytes;
    if (bytes) {
      await putPdf(
        paper.id,
        new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" })
      );
    }
  }
  repo.replaceWorkspace(snapshot);
  return snapshot;
}

export function workspaceBackupFilename(date = new Date()): string {
  return `lattice-workspace-${date.toISOString().slice(0, 10)}.lattice`;
}
