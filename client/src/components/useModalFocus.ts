// Keyboard behaviour a modal dialog owes its user.
//
// Three things, none of which a browser does on its own for a div-based dialog:
// focus moves into the dialog when it opens, Tab cycles within it instead of
// walking off into the page behind, and focus returns to whatever opened it when
// it closes. Without the last one, dismissing a dialog opened by a keyboard user
// drops them back at the top of the document.

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useModalFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const panel: HTMLElement | null = ref.current;
    if (!panel) return;
    const dialog: HTMLElement = panel;
    const restoreTo = document.activeElement as HTMLElement | null;

    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );

    // Only take focus if the dialog has not already placed it somewhere specific.
    if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it has escaped entirely.
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Only if focus is still inside the dialog being torn down; the user may
      // have deliberately clicked somewhere else.
      if (!dialog.contains(document.activeElement) && document.activeElement !== document.body) return;
      // Deferred a frame: React has not finished unmounting the dialog or
      // re-rendering the page behind it yet, and focusing an element that is about
      // to be replaced silently does nothing.
      requestAnimationFrame(() => {
        if (restoreTo?.isConnected) restoreTo.focus();
      });
    };
  }, [ref]);
}
