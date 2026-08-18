// Options page: stores the lattice base URL and default collection in
// chrome.storage.local.

import { getSettings, saveSettings } from "../lib/settings.js";

const baseUrlEl = document.getElementById("baseUrl") as HTMLInputElement;
const defaultCollectionEl = document.getElementById("defaultCollection") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

async function load(): Promise<void> {
  const s = await getSettings();
  baseUrlEl.value = s.baseUrl;
  defaultCollectionEl.value = s.defaultCollection;
}

saveBtn.addEventListener("click", async () => {
  const saved = await saveSettings({
    baseUrl: baseUrlEl.value,
    defaultCollection: defaultCollectionEl.value,
  });
  baseUrlEl.value = saved.baseUrl;
  defaultCollectionEl.value = saved.defaultCollection;
  statusEl.textContent = "Saved.";
  window.setTimeout(() => (statusEl.textContent = ""), 1500);
});

void load();
