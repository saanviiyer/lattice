import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isDesktop } from "./lib/desktop";
import { applyTheme, readThemeChoice } from "./lib/theme";
import "./index.css";

// Marks the document when running inside the Electron shell, so the stylesheet can
// account for the frameless title bar without any component knowing about Electron.
if (isDesktop()) document.documentElement.classList.add("lattice-desktop");

// Before the first render, so the window never flashes the wrong theme.
applyTheme(readThemeChoice());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
