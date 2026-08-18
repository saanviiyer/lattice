// Shared types for the lattice clipper. Pure, safe to import from anywhere
// (tests included) because nothing here touches chrome or the DOM.

// What a page capture yields before it becomes a clipping.
export interface ClipInput {
  url: string;
  title: string;
  // The user's selected text, if any.
  excerpt?: string;
  // A fallback excerpt: the page description or first paragraph.
  description?: string;
  // Target collection (folder) name; may be empty (filed on import instead).
  collection?: string;
  // An optional free-text note.
  note?: string;
}

// The payload posted to the lattice server (POST /api/clippings).
export interface ClippingPayload {
  url: string;
  title: string;
  excerpt: string;
  note: string;
  collection: string;
  savedAt: string; // ISO timestamp
}

// A clipping held in the local offline queue. Carries a client-side id so the
// queue can dedupe and remove entries without needing the server's id.
export interface QueuedClipping extends ClippingPayload {
  localId: string;
}

export interface Settings {
  // Base URL of the lattice server, e.g. "http://localhost:3001".
  baseUrl: string;
  // Default collection name pre-filled in the popup and used by quick-save.
  defaultCollection: string;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "http://localhost:3001",
  defaultCollection: "",
};
