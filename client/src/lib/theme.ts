// Theme selection. Three states, not two: "system" is the default and follows the OS,
// which matters on a machine that switches at sunset. An explicit choice is what gets
// stored -- storing the resolved value instead would freeze the app in whichever mode
// the user first happened to open it in.

import { useEffect, useState } from "react";

import { bridge } from "./desktop";

const KEY = "lattice.theme.v1";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // A blocked store just means the choice does not persist.
  }
  return "system";
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") return prefersDark() ? "dark" : "light";
  return choice;
}

/**
 * Paint the choice onto the document. Called before React mounts so the first frame
 * is already the right theme -- applying it in an effect flashes dark then light.
 */
const listeners = new Set<(theme: ResolvedTheme) => void>();

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.setAttribute("data-theme", resolved);
  for (const listener of listeners) listener(resolved);
  // The desktop window paints before the page does; without this the shell keeps its
  // dark ground behind a light app -- visible on launch and at every resize edge.
  bridge()?.setTheme?.(resolved);
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not persisting is survivable; not applying is not.
  }
  return resolved;
}

/** Re-resolve when the OS flips, but only while the user is actually on "system". */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}


/**
 * The theme as a value, for anything CSS cannot reach. A <canvas> paints with
 * literal colours, so the graph has to be told what the theme is and repaint.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    (document.documentElement.getAttribute("data-theme") as ResolvedTheme) || "dark"
  );
  useEffect(() => {
    listeners.add(setTheme);
    // Also follow the OS while the choice is "system".
    const stop = watchSystemTheme(() => {
      if (readThemeChoice() === "system") setTheme(resolveTheme("system"));
    });
    return () => {
      listeners.delete(setTheme);
      stop();
    };
  }, []);
  return theme;
}
