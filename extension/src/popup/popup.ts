// Popup: auto-capture the active tab, let the user pick a collection and add a
// note, then hand the save off to the background service worker.

import { capturePageContext, type PageContext } from "../lib/capture.js";
import { getSettings } from "../lib/settings.js";
import {
  MSG_SAVE,
  MSG_SYNC,
  type SaveResponse,
  type SyncResponse,
} from "../lib/messaging.js";

const titleEl = document.getElementById("title") as HTMLInputElement;
const urlEl = document.getElementById("url") as HTMLInputElement;
const excerptEl = document.getElementById("excerpt") as HTMLTextAreaElement;
const collectionEl = document.getElementById("collection") as HTMLInputElement;
const noteEl = document.getElementById("note") as HTMLTextAreaElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const queueRow = document.getElementById("queue-row") as HTMLDivElement;
const queueInfo = document.getElementById("queue-info") as HTMLSpanElement;
const syncBtn = document.getElementById("sync") as HTMLButtonElement;

function setStatus(text: string, kind: "" | "ok" | "warn" | "err" = ""): void {
  statusEl.textContent = text;
  statusEl.className = kind ? `status ${kind}` : "status";
}

function renderQueue(count: number): void {
  if (count > 0) {
    queueRow.hidden = false;
    queueInfo.textContent = `${count} clipping${count === 1 ? "" : "s"} waiting to sync`;
  } else {
    queueRow.hidden = true;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function capture(): Promise<void> {
  const settings = await getSettings();
  collectionEl.value = settings.defaultCollection;

  const tab = await activeTab();
  let ctx: PageContext | null = null;
  if (tab?.id != null) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: capturePageContext,
      });
      ctx = (result?.result as PageContext) ?? null;
    } catch {
      ctx = null;
    }
  }

  titleEl.value = ctx?.title || tab?.title || "";
  urlEl.value = ctx?.url || tab?.url || "";
  excerptEl.value = ctx?.selection || ctx?.description || "";

  // Reflect anything already queued offline.
  const sync = (await chrome.runtime.sendMessage({ type: MSG_SYNC })) as SyncResponse;
  renderQueue(sync?.queued ?? 0);
}

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  setStatus("Saving…");
  try {
    const res = (await chrome.runtime.sendMessage({
      type: MSG_SAVE,
      input: {
        url: urlEl.value,
        title: titleEl.value,
        excerpt: excerptEl.value,
        collection: collectionEl.value,
        note: noteEl.value,
      },
    })) as SaveResponse;

    if (!res.ok) {
      setStatus(res.error || "Could not save.", "err");
    } else if (res.status === "sent") {
      setStatus("Saved to lattice. Open the app's Inbox to file it.", "ok");
      window.setTimeout(() => window.close(), 1200);
    } else {
      setStatus(
        "lattice server unreachable. Queued offline; it will sync automatically.",
        "warn"
      );
    }
    renderQueue(res.queued);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Save failed.", "err");
  } finally {
    saveBtn.disabled = false;
  }
});

syncBtn.addEventListener("click", async () => {
  setStatus("Syncing…");
  const res = (await chrome.runtime.sendMessage({ type: MSG_SYNC })) as SyncResponse;
  renderQueue(res.queued);
  if (res.flushed > 0) setStatus(`Synced ${res.flushed} clipping(s).`, "ok");
  else if (res.queued > 0) setStatus("Server still unreachable.", "warn");
  else setStatus("Nothing to sync.", "");
});

document.getElementById("options")?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

void capture();
