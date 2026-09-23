// A render crash used to leave a blank page: no error, no navigation, and no way to
// reach the export button -- so a single malformed record could look exactly like a
// lost library. This keeps the failure legible and, more importantly, keeps the
// user's data reachable: the download below reads storage directly, so it works even
// when nothing renders.

import React from "react";
import { repo } from "../lib/repository";

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private rescue = () => {
    const dump = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        papers: repo.listPapers(),
        notes: repo.listNotes(),
        collections: repo.listCollections(),
        questions: repo.listQuestions(),
      },
      null,
      2
    );
    const url = URL.createObjectURL(new Blob([dump], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `lattice-library-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center bg-slate-950 p-8">
        <div className="max-w-lg space-y-4 text-slate-300">
          <h1 className="text-lg text-slate-100">lattice hit an error and stopped drawing.</h1>
          <p className="text-sm text-slate-400">
            Your library is still stored on this machine — nothing has been deleted. Save a
            copy before doing anything else.
          </p>
          <pre className="text-xs bg-slate-900 border border-slate-800 rounded p-3 overflow-x-auto text-slate-400">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2">
            <button onClick={this.rescue} className="lat-primary px-4 py-2 text-sm">
              Download my library
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm border border-slate-700 rounded text-slate-300"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
