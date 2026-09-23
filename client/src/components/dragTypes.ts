// What can be dragged in lattice, and how it travels.
//
// The payload rides in a custom MIME type so a drop target can tell what it is
// being offered *before* the drop — dataTransfer.getData is deliberately blank
// during dragover, but the type list is not. That is what lets a project light up
// for a paper and stay inert for a file dragged in from the desktop.

export const PROJECT_DRAG = "application/x-lattice-project";
export const RECORD_DRAG = "application/x-lattice-records";

export interface RecordDrag {
  papers: string[];
  notes: string[];
}

export function setProjectDrag(transfer: DataTransfer, id: string) {
  transfer.setData(PROJECT_DRAG, id);
  transfer.effectAllowed = "move";
}

export function setRecordDrag(transfer: DataTransfer, payload: RecordDrag) {
  transfer.setData(RECORD_DRAG, JSON.stringify(payload));
  transfer.effectAllowed = "copyMove";
}

export function isProjectDrag(transfer: DataTransfer | null) {
  return !!transfer?.types.includes(PROJECT_DRAG);
}

export function isRecordDrag(transfer: DataTransfer | null) {
  return !!transfer?.types.includes(RECORD_DRAG);
}

export function readRecordDrag(transfer: DataTransfer): RecordDrag | null {
  try {
    const raw = transfer.getData(RECORD_DRAG);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecordDrag;
    return { papers: parsed.papers || [], notes: parsed.notes || [] };
  } catch {
    return null;
  }
}
