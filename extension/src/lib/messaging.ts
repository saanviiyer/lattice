// Message contracts between the popup and the background service worker.

import type { ClipInput } from "./types.js";

export const MSG_SAVE = "lattice:save";
export const MSG_SYNC = "lattice:sync";

export interface SaveMessage {
  type: typeof MSG_SAVE;
  input: ClipInput;
}

export interface SyncMessage {
  type: typeof MSG_SYNC;
}

export type ClipperMessage = SaveMessage | SyncMessage;

export interface SaveResponse {
  ok: boolean;
  // "sent" = stored on the server; "queued" = kept offline for later sync.
  status: "sent" | "queued";
  error?: string;
  // Number of clippings still waiting in the offline queue.
  queued: number;
}

export interface SyncResponse {
  ok: boolean;
  // How many queued clippings were flushed to the server this run.
  flushed: number;
  // How many remain queued (server still unreachable, or partial flush).
  queued: number;
}
