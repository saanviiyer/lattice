// A small workspace on disk, in the shape the desktop app mirrors.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const NOW = "2026-01-01T00:00:00.000Z";

export async function writeFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lattice-mcp-"));
  const workspace = path.join(dir, "workspace");
  await mkdir(workspace, { recursive: true });
  const snapshot = {
    version: 3,
    exportedAt: NOW,
    collections: [
      { id: "replay", name: "Replay", parentId: null, createdAt: NOW, color: "red",
        premise: "Replay during quiet rest consolidates the memory.", status: "active" },
      { id: "ripple", name: "Ripple detection", parentId: "replay", createdAt: NOW, color: "yellow" },
      { id: "methods", name: "Methods", parentId: null, createdAt: NOW, color: "orange" },
    ],
    papers: [
      { id: "p1", title: "Sharp-wave ripples during quiet rest", authors: ["Ada Lovelace"],
        year: 2019, venue: "Neuron", abstract: "Ripples recur during rest.", doi: "10.1/ripples",
        source: "manual", tags: ["replay"], collectionIds: ["replay"], addedAt: NOW,
        readingStatus: "read", takeaway: "Ripple rate predicts next-day recall." },
      { id: "p2", title: "Decoding population spike trains", authors: ["Grace Hopper"],
        year: 2017, venue: "JNeuro", abstract: "", doi: "", arxivId: "1701.00001",
        source: "arxiv", tags: ["methods"], collectionIds: ["ripple", "methods"], addedAt: NOW,
        readingStatus: "inbox" },
    ],
    notes: [
      { id: "n1", title: "Synthesis", body: "The causal claim rests on ripple timing.",
        collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
    ],
    questions: [
      { id: "q1", title: "Does replay cause consolidation?", detail: "Needs a matched-wake control.",
        status: "exploring", linkedPaperIds: ["p1"], collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
      { id: "q2", title: "Is the effect sleep-specific?", detail: "", status: "open",
        linkedPaperIds: [], collectionIds: ["replay"], createdAt: NOW, updatedAt: NOW },
    ],
    highlights: [
      { id: "h1", paperId: "p1", page: 4, color: "yellow",
        text: "Ripple density during rest correlated with recall the following day.",
        note: "This is the number to reproduce.", rects: [], createdAt: NOW },
    ],
    savedSearches: [],
    plans: [
      {
        id: "plan-1", projectId: "replay", title: "Replay", question: "Does replay cause consolidation?",
        hypothesis: "Replay during quiet rest consolidates the memory.",
        background: [{ text: "Ripple rate predicts next-day recall.", paperIds: ["p1", "not-in-library"] }],
        gap: "", aims: [{ id: "aim-1", title: "Block ripples", detail: "" }], approach: "",
        confirmIf: "Recall drops when ripples are blocked.", refuteIf: "Recall is unchanged when ripples are blocked.",
        risks: [],
        tasks: [
          { id: "scout", title: "Find what is missing", role: "scout", goal: "Search.", inputs: [], tools: [],
            output: "A shortlist.", doneWhen: "Every candidate has a DOI.", dependsOn: [], checkpoint: true, paperIds: ["p1"] },
          { id: "run-1", title: "Run aim 1", role: "runner", goal: "Run it.", inputs: [], tools: ["Code execution"],
            output: "Results.", doneWhen: "Repeatable from logs.", dependsOn: ["scout"], checkpoint: true, aimId: "aim-1", paperIds: [] },
        ],
        source: "draft", createdAt: NOW, updatedAt: NOW,
      },
    ],
  };
  await writeFile(path.join(workspace, "workspace.json"), JSON.stringify(snapshot, null, 2));
  return { dir, workspace, file: path.join(workspace, "workspace.json"), snapshot };
}
