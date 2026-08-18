// Background service worker: owns the network calls (so page CORS never
// applies), the "Save to lattice" context menu, and the offline-queue sync.

import { postClipping, pingServer } from "../lib/api.js";
import { buildClipping, isValidClipping } from "../lib/clipping.js";
import { capturePageContext, type PageContext } from "../lib/capture.js";
import { getSettings } from "../lib/settings.js";
import { dequeue, enqueue, queueSize, readQueue } from "../lib/queue.js";
import {
  MSG_SAVE,
  MSG_SYNC,
  type ClipperMessage,
  type SaveResponse,
  type SyncResponse,
} from "../lib/messaging.js";
import type { ClipInput } from "../lib/types.js";

const CONTEXT_MENU_ID = "lattice-save";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Save to lattice",
    contexts: ["page", "selection", "link", "image"],
  });
  void syncQueue();
});

chrome.runtime.onStartup.addListener(() => {
  void syncQueue();
});

// Grab {title, url, selection, description} from the given tab.
async function captureFromTab(tabId: number): Promise<PageContext | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: capturePageContext,
    });
    return (result?.result as PageContext) ?? null;
  } catch {
    return null;
  }
}

// Reflect status on the toolbar badge (context-menu saves have no popup UI).
function flashBadge(text: string, color: string): void {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 2500);
}

// Try the server first; fall back to the offline queue on any failure.
async function saveClipping(input: ClipInput): Promise<SaveResponse> {
  const settings = await getSettings();
  const payload = buildClipping({
    ...input,
    collection: input.collection ?? settings.defaultCollection,
  });
  if (!isValidClipping(payload)) {
    return { ok: false, status: "queued", error: "Nothing to save from this page.", queued: await queueSize() };
  }
  try {
    await postClipping(settings.baseUrl, payload);
    // A successful save is a good moment to flush anything stranded offline.
    void syncQueue();
    return { ok: true, status: "sent", queued: await queueSize() };
  } catch (err) {
    await enqueue(payload);
    return {
      ok: true,
      status: "queued",
      error: err instanceof Error ? err.message : String(err),
      queued: await queueSize(),
    };
  }
}

// Flush queued clippings to the server, oldest first, stopping on the first
// failure so ordering is preserved and we do not hammer an unreachable server.
async function syncQueue(): Promise<SyncResponse> {
  const settings = await getSettings();
  const queue = await readQueue();
  if (queue.length === 0) return { ok: true, flushed: 0, queued: 0 };
  if (!(await pingServer(settings.baseUrl))) {
    return { ok: false, flushed: 0, queued: queue.length };
  }
  let flushed = 0;
  for (const clipping of queue) {
    try {
      await postClipping(settings.baseUrl, clipping);
      await dequeue(clipping.localId);
      flushed += 1;
    } catch {
      break;
    }
  }
  return { ok: true, flushed, queued: await queueSize() };
}

// Right-click "Save to lattice": quick-save with the default collection.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id == null) return;
  void (async () => {
    const ctx = await captureFromTab(tab.id!);
    const input: ClipInput = {
      url: info.linkUrl || ctx?.url || tab.url || "",
      title: ctx?.title || tab.title || "",
      excerpt: info.selectionText || ctx?.selection || "",
      description: ctx?.description || "",
    };
    const res = await saveClipping(input);
    if (res.status === "sent") flashBadge("✓", "#4f46e5");
    else if (res.ok) flashBadge("•", "#f59e0b");
    else flashBadge("!", "#ef4444");
  })();
});

// Messages from the popup.
chrome.runtime.onMessage.addListener((message: ClipperMessage, _sender, sendResponse) => {
  if (message?.type === MSG_SAVE) {
    void saveClipping(message.input).then(sendResponse);
    return true;
  }
  if (message?.type === MSG_SYNC) {
    void syncQueue().then(sendResponse);
    return true;
  }
  return false;
});
