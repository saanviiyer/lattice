// A small, deliberately shaped sample workspace.
//
// An empty knowledge graph teaches nothing, so the guide can seed one. The records
// below are illustrative, not real citations: every one carries the `sample` tag and
// a "lattice sample workspace" venue so it can never be mistaken for a real
// bibliographic entry, and so removing them again is exact.
//
// The shape is chosen to make each graph feature visible at once:
//   a hub note that several things hang off
//   a question with evidence, and a question with none
//   a second island of two related papers, unreachable from the main body
//   one paper connected to nothing at all

import type { PaperMetadata, ResearchQuestion } from "../types";
import type { Repository } from "./repository";

export const SAMPLE_TAG = "sample";
const SAMPLE_VENUE = "lattice sample workspace";

interface SamplePaper {
  key: string;
  title: string;
  year: number;
  abstract: string;
  collection: "Replay" | "Methods";
  takeaway?: string;
  readingStatus?: "inbox" | "reading" | "read";
  relatedKeys?: string[];
}

interface SampleNote {
  title: string;
  body: string;
  attachTo?: string; // paper key, making this the paper's notes doc
}

const PAPERS: SamplePaper[] = [
  {
    key: "ripples",
    title: "Sharp-wave ripples during quiet rest",
    year: 2019,
    abstract:
      "Population bursts recorded during quiet waking rest replay recently travelled trajectories in compressed time.",
    collection: "Replay",
    readingStatus: "read",
    takeaway: "Replay happens in rest, not only in sleep. The compression factor is the number to watch.",
    relatedKeys: ["disruption"],
  },
  {
    key: "sleep",
    title: "Sleep-dependent consolidation of spatial memory",
    year: 2020,
    abstract:
      "Behavioural performance after a night of sleep is compared against an equal interval of quiet waking.",
    collection: "Replay",
    readingStatus: "read",
    takeaway: "The sleep benefit survives a matched-wake control, which is what makes the claim interesting.",
  },
  {
    key: "disruption",
    title: "Disrupting ripples impairs subsequent learning",
    year: 2021,
    abstract:
      "Closed-loop stimulation cancels detected ripple events and measures the behavioural cost.",
    collection: "Replay",
    readingStatus: "reading",
    takeaway: "The closest thing to a causal handle in this literature. Read the stimulation controls closely.",
  },
  {
    key: "model",
    title: "A model of systems-level consolidation",
    year: 2018,
    abstract:
      "A two-stage account in which a fast hippocampal store trains a slow cortical one during offline periods.",
    collection: "Replay",
    readingStatus: "inbox",
  },
  {
    key: "decoding",
    title: "Bayesian decoding of population spike trains",
    year: 2017,
    abstract:
      "A maximum-likelihood method for reconstructing a covariate from simultaneously recorded units.",
    collection: "Methods",
    readingStatus: "reading",
  },
  {
    key: "stats",
    title: "Benchmarking sequence-detection statistics",
    year: 2022,
    abstract:
      "Shuffling procedures for sequence detection are compared on synthetic data with a known ground truth.",
    collection: "Methods",
    readingStatus: "inbox",
    takeaway: "Most published sequence tests fail their own null. Pick the shuffle before looking at the data.",
  },
  {
    key: "grid",
    title: "Grid cells and path integration",
    year: 2016,
    abstract:
      "Periodic spatial firing fields are characterized across the dorsoventral axis of entorhinal cortex.",
    collection: "Replay",
    readingStatus: "inbox",
  },
  {
    key: "hardware",
    title: "Open-source acquisition hardware for chronic recording",
    year: 2021,
    abstract: "A modular headstage and acquisition board for long-duration freely moving recordings.",
    collection: "Methods",
    readingStatus: "inbox",
    relatedKeys: ["drift"],
  },
  {
    key: "drift",
    title: "Drift correction for long recordings",
    year: 2022,
    abstract: "Electrode drift over days is estimated and corrected before spike sorting.",
    collection: "Methods",
    readingStatus: "inbox",
  },
];

const NOTES: SampleNote[] = [
  {
    title: "Reading log",
    body: [
      "Started with [[Sharp-wave ripples during quiet rest]], which sent me to",
      "[[Sleep-dependent consolidation of spatial memory]].",
      "",
      "- [ ] Come back to the matched-wake control",
    ].join("\n"),
  },
  {
    title: "Replay versus consolidation",
    body: [
      "The correlational work ([[Sharp-wave ripples during quiet rest]]) and the causal work",
      "([[Disrupting ripples impairs subsequent learning]]) are answering different questions.",
      "",
      "This is the crux of [[Does replay cause consolidation, or merely accompany it?]].",
      "",
      "> Cancelling an event is not the same as cancelling its content.",
    ].join("\n"),
  },
  {
    title: "Methods I would need to replicate this",
    body: [
      "[[Bayesian decoding of population spike trains]] for the reconstruction, and",
      "[[Benchmarking sequence-detection statistics]] to choose the null before I look.",
    ].join("\n"),
  },
  {
    title: "Notes on A model of systems-level consolidation",
    attachTo: "model",
    body: "The two-stage story predicts a specific time course. Does anyone measure it directly?",
  },
];

const QUESTIONS: Array<{ title: string; detail: string; evidenceKeys: string[]; status: ResearchQuestion["status"] }> = [
  {
    title: "Does replay cause consolidation, or merely accompany it?",
    detail: "Correlational and causal evidence disagree about how much work replay is doing.",
    evidenceKeys: ["ripples", "sleep", "disruption"],
    status: "exploring",
  },
  {
    title: "What result would falsify the sequence-replay account?",
    detail: "Written down before reading further, so the answer is not chosen after the fact.",
    evidenceKeys: [],
    status: "open",
  },
];

function metadataFor(paper: SamplePaper): PaperMetadata {
  return {
    itemType: "journalArticle",
    title: paper.title,
    authors: ["Sample, A.", "Example, B."],
    year: paper.year,
    venue: SAMPLE_VENUE,
    abstract: paper.abstract,
    doi: "",
    source: "manual",
  };
}

// True when the workspace already contains the sample records.
export function hasSampleWorkspace(repository: Repository): boolean {
  return repository.listPapers().some((p) => p.tags.includes(SAMPLE_TAG));
}

// Seed the sample workspace. Returns the number of papers added.
export function seedSampleWorkspace(repository: Repository): number {
  const collections = new Map<string, string>();
  for (const name of ["Replay", "Methods"]) {
    const existing = repository.listCollections().find((c) => c.name === name);
    collections.set(name, existing ? existing.id : repository.createCollection(name).id);
  }

  const idByKey = new Map<string, string>();
  for (const paper of PAPERS) {
    const saved = repository.addPaper(metadataFor(paper), {
      tags: [SAMPLE_TAG],
      collectionIds: [collections.get(paper.collection)!],
    });
    idByKey.set(paper.key, saved.id);
    repository.updatePaper(saved.id, {
      readingStatus: paper.readingStatus || "inbox",
      takeaway: paper.takeaway,
    });
  }

  // Related-paper links, applied after every id exists so both directions resolve.
  for (const paper of PAPERS) {
    if (!paper.relatedKeys?.length) continue;
    const from = idByKey.get(paper.key)!;
    const to = paper.relatedKeys.map((k) => idByKey.get(k)!).filter(Boolean);
    repository.updatePaper(from, { relatedPaperIds: to });
    for (const otherId of to) {
      const other = repository.getPaper(otherId);
      if (!other) continue;
      const back = new Set(other.relatedPaperIds || []);
      back.add(from);
      repository.updatePaper(otherId, { relatedPaperIds: [...back] });
    }
  }

  for (const question of QUESTIONS) {
    const created = repository.createQuestion({
      title: question.title,
      detail: question.detail,
      linkedPaperIds: question.evidenceKeys.map((k) => idByKey.get(k)!).filter(Boolean),
    });
    if (question.status !== "open") repository.updateQuestion(created.id, { status: question.status });
  }

  for (const note of NOTES) {
    repository.createNote({
      title: note.title,
      body: note.body,
      paperId: note.attachTo ? idByKey.get(note.attachTo) : undefined,
    });
  }

  return PAPERS.length;
}

// Remove exactly what seedSampleWorkspace added, leaving real work untouched.
export function removeSampleWorkspace(repository: Repository): void {
  const sampleTitles = new Set(PAPERS.map((p) => p.title));
  const noteTitles = new Set(NOTES.map((n) => n.title));
  const questionTitles = new Set(QUESTIONS.map((q) => q.title));

  for (const note of repository.listNotes()) {
    if (noteTitles.has(note.title)) repository.deleteNote(note.id);
  }
  for (const question of repository.listQuestions()) {
    if (questionTitles.has(question.title)) repository.deleteQuestion(question.id);
  }
  for (const paper of repository.listPapers()) {
    if (paper.tags.includes(SAMPLE_TAG) && sampleTitles.has(paper.title)) {
      repository.deletePaper(paper.id);
    }
  }
  for (const collection of repository.listCollections()) {
    if (collection.name !== "Replay" && collection.name !== "Methods") continue;
    const stillUsed = repository
      .listPapers()
      .some((p) => p.collectionIds.includes(collection.id));
    if (!stillUsed) repository.deleteCollection(collection.id);
  }
}
