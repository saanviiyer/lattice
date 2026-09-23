import { useEffect, useState } from "react";
import {
  applyTheme, readThemeChoice, watchSystemTheme, THEME_CHOICES, type ThemeChoice,
} from "../lib/theme";

const LABEL: Record<ThemeChoice, string> = { system: "Auto", light: "Light", dark: "Dark" };
const ICON: Record<ThemeChoice, string> = { system: "◐", light: "☀", dark: "☾" };

/** Cycles Auto → Light → Dark. Three states are too few to justify a menu. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);

  // Following the OS only means anything if the app notices when the OS changes.
  useEffect(() => {
    if (choice !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [choice]);

  const next = THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];

  return (
    <button
      onClick={() => {
        applyTheme(next);
        setChoice(next);
      }}
      title={`Theme: ${LABEL[choice]} — switch to ${LABEL[next]}`}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next]}.`}
      className={
        compact
          ? "grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-veil/[.06] hover:text-slate-100"
          : "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-veil/[.06] hover:text-slate-100"
      }
    >
      <span aria-hidden="true" className="text-[13px] leading-none">{ICON[choice]}</span>
      {!compact && <span>{LABEL[choice]}</span>}
    </button>
  );
}
