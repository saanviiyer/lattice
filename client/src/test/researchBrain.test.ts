import { describe, expect, it } from "vitest";
import type { Collection, Highlight, Paper, ResearchQuestion } from "../types";
import {
  buildInterestProfile,
  forYouSeeds,
  interestFit,
  matchesStatement,
  normalizeBrain,
  paperEngagement,
  suggestionKey,
  topicKey,
} from "../lib/researchBrain";
import { buildPaperIndex, projectsForPaper, similarPapers } from "../lib/paperSimilarity";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function paper(id: string, title: string, extra: Partial<Paper> = {}): Paper {
  return {
    id, title, authors: [], year: 2024, venue: "", abstract: "", doi: `10.1/${id}`, source: "doi",
    tags: [], collectionIds: [], addedAt: daysAgo(200), ...extra,
  } as Paper;
}

function highlight(paperId: string, text: string, days = 3): Highlight {
  return { id: `h-${paperId}-${text.length}`, paperId, page: 1, color: "yellow", text, rects: [], createdAt: daysAgo(days) };
}

const library = [
  paper("hd1", "Head direction cells and ring attractor dynamics", { readingStatus: "read", takeaway: "The ring holds heading in darkness." }),
  paper("hd2", "A ring attractor model of head direction in the fly", { favorite: true }),
  paper("hd3", "Path integration with a ring attractor network"),
  paper("rl1", "Deep reinforcement learning with a learned world model", { addedAt: daysAgo(10), readingStatus: "reading" }),
  paper("rl2", "World model agents for reinforcement learning in Atari", { addedAt: daysAgo(12) }),
  paper("x", "Soil microbiome sampling in alpine meadows"),
];

describe("engagement", () => {
  it("ranks worked-with papers above ones that were only saved, and says why", () => {
    const engaged = paperEngagement({
      papers: library,
      highlights: [highlight("hd1", "the ring holds heading"), highlight("hd1", "bump of activity")],
      notes: [],
      questions: [
        { id: "q", title: "?", detail: "", status: "open", linkedPaperIds: ["hd2"], createdAt: "", updatedAt: "" } as ResearchQuestion,
      ],
      collections: [],
      now: NOW,
    });
    expect(engaged[0]!.paper.id).toBe("hd1");
    expect(engaged[0]!.reasons).toEqual(["read", "wrote a takeaway", "2 highlights"]);
    expect(engaged.find((entry) => entry.paper.id === "hd2")!.reasons).toContain("evidence for 1 open question");
    expect(engaged.at(-1)!.paper.id).toBe("x");
  });

  it("fades old activity but never to nothing", () => {
    const [fresh] = paperEngagement({ papers: [paper("a", "A", { addedAt: daysAgo(0) })], highlights: [], notes: [], questions: [], collections: [], now: NOW });
    const [old] = paperEngagement({ papers: [paper("a", "A", { addedAt: daysAgo(2000) })], highlights: [], notes: [], questions: [], collections: [], now: NOW });
    expect(fresh!.weight).toBeCloseTo(1);
    expect(old!.weight).toBeGreaterThan(0.3);
    expect(old!.weight).toBeLessThan(0.4);
  });
});

describe("interest profile", () => {
  const inputs = { papers: library, highlights: [], notes: [], questions: [], collections: [] as Collection[], now: NOW };

  it("finds fields and recurring phrases, with the papers behind each", () => {
    const profile = buildInterestProfile(inputs);
    const labels = profile.topics.map((topic) => topic.label);
    expect(labels).toContain("Reinforcement learning");
    expect(labels).toContain("ring attractor");
    const ring = profile.topics.find((topic) => topic.label === "ring attractor")!;
    expect(ring.paperIds.sort()).toEqual(["hd1", "hd2", "hd3"]);
    // One paper about soil is not an interest.
    expect(labels.some((label) => /soil/i.test(label))).toBe(false);
  });

  it("names a specific word two papers chose, but not one the whole library uses", () => {
    const profile = buildInterestProfile({
      ...inputs,
      papers: [
        paper("c1", "Sleep-dependent consolidation of memory"),
        paper("c2", "A model of systems consolidation"),
        paper("n1", "Neural recordings one", { tags: ["everything"] }),
        paper("n2", "Neural recordings two", { tags: ["everything"] }),
        paper("n3", "Neural recordings three", { tags: ["everything"] }),
        paper("n4", "Neural recordings four", { tags: ["everything"] }),
      ],
    });
    const labels = profile.topics.map((topic) => topic.label);
    expect(labels).toContain("consolidation");
    expect(labels).not.toContain("everything");
    expect(interestFit({ title: "Consolidation after learning" }, profile).matches).toContain("consolidation");
  });

  it("marks a topic as rising when recent work piles onto it", () => {
    const profile = buildInterestProfile(inputs);
    expect(profile.topics.find((topic) => topic.label === "Reinforcement learning")!.trend).toBe("rising");
  });

  it("keeps what the researcher said, even with no papers yet, and honours mutes", () => {
    const profile = buildInterestProfile({
      ...inputs,
      prefs: { interests: ["grid cells in virtual reality"], muted: [topicKey("theme", "ring attractor")], dismissed: [] },
    });
    const stated = profile.topics.find((topic) => topic.kind === "stated")!;
    expect(stated.label).toBe("grid cells in virtual reality");
    expect(stated.paperIds).toEqual([]);
    expect(stated.score).toBeGreaterThanOrEqual(0.5);
    expect(profile.topics.some((topic) => topic.label === "ring attractor")).toBe(false);
    expect(profile.muted.map((topic) => topic.label)).toEqual(["ring attractor"]);
  });

  it("scores a suggestion by the interests it lands on, and damps muted ones", () => {
    const profile = buildInterestProfile(inputs);
    const fit = interestFit({ title: "A ring attractor for heading in mice" }, profile);
    expect(fit.matches).toContain("ring attractor");
    expect(fit.score).toBeGreaterThan(0);
    expect(interestFit({ title: "Crop yields in 1970" }, profile).score).toBe(0);

    const mutedProfile = buildInterestProfile({ ...inputs, prefs: { interests: [], muted: [topicKey("theme", "ring attractor")], dismissed: [] } });
    expect(interestFit({ title: "A ring attractor for heading in mice" }, mutedProfile).muted).toEqual(["ring attractor"]);
  });

  it("matches statements on their words, not on any one of them", () => {
    expect(matchesStatement("grid cells recorded in virtual reality", "grid cells in virtual reality")).toBe(true);
    expect(matchesStatement("virtual machines", "grid cells in virtual reality")).toBe(false);
  });

  it("seeds suggestions from the most engaged papers that have identifiers", () => {
    const profile = buildInterestProfile({ ...inputs, papers: [...library, paper("noid", "No id", { doi: "", favorite: true, takeaway: "x", readingStatus: "read" })] });
    const seeds = forYouSeeds(profile, 3);
    expect(seeds).toHaveLength(3);
    expect(seeds.some((seed) => seed.title === "No id")).toBe(false);
  });

  it("cleans stored preferences it cannot trust", () => {
    expect(normalizeBrain({ interests: ["a", "a", " ", 3], muted: "x", dismissed: [{ key: "k", title: "t" }, null] })).toEqual({
      interests: ["a"], muted: [], dismissed: [{ key: "k", title: "t" }],
    });
    expect(suggestionKey({ doi: "10.1/ABC" })).toBe("10.1/abc");
    expect(suggestionKey({ title: "A Title!" })).toBe("title:a title");
  });
});

describe("similar papers in the library", () => {
  const filed = library.map((item) =>
    item.id.startsWith("hd") && item.id !== "hd3" ? { ...item, collectionIds: ["heading"] } : item.id.startsWith("rl") ? { ...item, collectionIds: ["wm"] } : item
  );
  const collections = [
    { id: "heading", name: "Heading", createdAt: "" },
    { id: "wm", name: "World models", createdAt: "" },
  ] as Collection[];
  const index = buildPaperIndex(filed, [highlight("hd3", "ring attractor keeps heading")]);

  it("finds papers on the same subject and names what they share", () => {
    const similar = similarPapers(index, "hd3");
    expect(similar.map((entry) => entry.paper.id).slice(0, 2).sort()).toEqual(["hd1", "hd2"]);
    expect(similar[0]!.shared).toContain("ring attractor");
    expect(similar.some((entry) => entry.paper.id === "x")).toBe(false);
    // hd2 and rl1 share only "model", which half the library uses: not a match.
    expect(similarPapers(index, "hd2").map((entry) => entry.paper.id)).not.toContain("rl1");
  });

  it("matches singular and plural, and ignores a tag every paper carries", () => {
    const tagged = [
      paper("r1", "Sharp-wave ripples during quiet rest", { tags: ["sample"] }),
      paper("r2", "Disrupting ripples impairs learning", { tags: ["sample"], abstract: "Stimulation cancels each ripple event." }),
      paper("o1", "Drift correction for long recordings", { tags: ["sample"] }),
      paper("o2", "Open hardware for chronic recording", { tags: ["sample"] }),
    ];
    const similar = similarPapers(buildPaperIndex(tagged), "r2");
    expect(similar.map((entry) => entry.paper.id)).toEqual(["r1"]);
    expect(similar[0]!.shared).toContain("ripples");
    expect(similar[0]!.shared).not.toContain("sample");
  });

  it("suggests the project a paper belongs in, leaving out ones it is already in", () => {
    const fits = projectsForPaper(index, "hd3", collections);
    expect(fits[0]!.project.id).toBe("heading");
    expect(fits.some((fit) => fit.project.id === "wm")).toBe(false);
    expect(projectsForPaper(index, "hd1", collections).some((fit) => fit.project.id === "heading")).toBe(false);
  });
});
