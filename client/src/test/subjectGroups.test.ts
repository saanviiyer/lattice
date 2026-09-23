import { describe, it, expect } from "vitest";
import { proposeSubjectGroups, type GroupableDocument } from "../lib/subjectGroups";

function doc(id: string, title: string, tags: string[] = []): GroupableDocument {
  return { id, title, tags };
}

// Two clearly separate subjects, with one paper belonging to neither.
const LIBRARY: GroupableDocument[] = [
  doc("a1", "Protein structure prediction with deep learning"),
  doc("a2", "Improved protein structure prediction using neural potentials"),
  doc("a3", "Fast protein structure prediction from sequence"),
  doc("a4", "Protein structure prediction benchmarks"),
  doc("b1", "Directed evolution of enzymes for stereoselectivity"),
  doc("b2", "Machine learning guided directed evolution of enzymes"),
  doc("b3", "Directed evolution of enzymes with combinatorial libraries"),
  doc("b4", "Enzymes improved by directed evolution campaigns"),
  doc("z1", "A history of eighteenth century canal engineering"),
];

describe("proposeSubjectGroups", () => {
  it("separates two distinct subjects", () => {
    const { groups } = proposeSubjectGroups(LIBRARY, { minSize: 3 });
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const find = (id: string) => groups.find((g) => g.documentIds.includes(id));
    // Papers about one subject land together, and not with the other subject.
    expect(find("a1")).toBe(find("a3"));
    expect(find("b1")).toBe(find("b3"));
    expect(find("a1")).not.toBe(find("b1"));
  });

  it("leaves a paper with nothing in common ungrouped", () => {
    const { ungroupedIds } = proposeSubjectGroups(LIBRARY, { minSize: 3 });
    expect(ungroupedIds).toContain("z1");
  });

  it("labels groups from the words that defined them", () => {
    const { groups } = proposeSubjectGroups(LIBRARY, { minSize: 3 });
    const labels = groups.map((g) => g.label.toLowerCase());
    // The exact phrasing is the algorithm's to choose; what matters is that each
    // group is named after the subject it actually collected.
    expect(labels.some((l) => l.includes("structure") && l.includes("prediction"))).toBe(true);
    expect(labels.some((l) => l.includes("directed") && l.includes("evolution"))).toBe(true);
  });

  it("labels with readable words, not stems", () => {
    const { groups } = proposeSubjectGroups(LIBRARY, { minSize: 3 });
    for (const group of groups) {
      // "directed" not "direct", "learning" not "learn".
      expect(group.label).not.toMatch(/\b(direct|learn|supervis|predict|structur)\b/);
    }
  });

  it("does not invent a phrase across a dropped stopword", () => {
    // "Prediction of protein structure" must not yield the phrase "prediction protein".
    const docs = Array.from({ length: 4 }, (_, i) => doc(`p${i}`, "Prediction of protein structure by learning"));
    const { groups } = proposeSubjectGroups(docs, { minSize: 3 });
    for (const group of groups) {
      expect(group.terms.join(" | ")).not.toContain("prediction protein");
    }
  });

  it("is deterministic — the same library proposes the same groups", () => {
    const first = proposeSubjectGroups(LIBRARY, { minSize: 3 });
    const shuffled = [...LIBRARY].reverse();
    const second = proposeSubjectGroups(shuffled, { minSize: 3 });
    expect(second.groups.map((g) => g.documentIds.join(","))).toEqual(
      first.groups.map((g) => g.documentIds.join(","))
    );
  });

  it("uses tags as the strongest signal when they exist", () => {
    const tagged = [
      doc("t1", "An entirely unrelated title about canals", ["generative-models"]),
      doc("t2", "Another unrelated title about bridges", ["generative-models"]),
      doc("t3", "A third unrelated title about tunnels", ["generative-models"]),
    ];
    const { groups } = proposeSubjectGroups(tagged, { minSize: 3 });
    expect(groups).toHaveLength(1);
    expect(groups[0].documentIds).toEqual(["t1", "t2", "t3"]);
  });

  it("splits a group too large to be a subject", () => {
    // 60 papers sharing one word, in two clear halves.
    const many: GroupableDocument[] = [];
    for (let i = 0; i < 30; i += 1) many.push(doc(`s${i}`, `Protein structure prediction study number ${i}`));
    for (let i = 0; i < 30; i += 1) many.push(doc(`e${i}`, `Protein directed evolution campaign number ${i}`));
    const { groups } = proposeSubjectGroups(many, { maxGroupSize: 40 });
    expect(groups.every((g) => g.documentIds.length <= 45)).toBe(true);
    expect(groups.length).toBeGreaterThanOrEqual(2);
  });

  it("returns nothing to propose for a library too small to group", () => {
    const { groups, ungroupedIds } = proposeSubjectGroups([doc("only", "One paper")], { minSize: 3 });
    expect(groups).toEqual([]);
    expect(ungroupedIds).toEqual(["only"]);
  });

  it("never loses or duplicates a document", () => {
    const { groups, ungroupedIds } = proposeSubjectGroups(LIBRARY, { minSize: 3 });
    const seen = [...groups.flatMap((g) => g.documentIds), ...ungroupedIds].sort();
    expect(seen).toEqual(LIBRARY.map((d) => d.id).sort());
  });
});

describe("field naming", () => {
  function many(prefix: string, title: string, n = 5) {
    return Array.from({ length: n }, (_, i) => doc(`${prefix}${i}`, `${title} ${i}`));
  }

  it("names a cluster after the field it belongs to, not its top two words", () => {
    const docs = many("rl", "Safe exploration policy learning with reward shaping for an agent", 6);
    const { groups } = proposeSubjectGroups(docs, { minSize: 3 });
    // "reward, policy, agent" is a search query; "Reinforcement learning" is a field.
    expect(groups[0].label).toBe("Reinforcement learning");
  });

  it("recognises AI safety over the generic machine-learning terms it shares", () => {
    const docs = many("s", "Alignment and oversight of deceptive models, catastrophic harm", 6);
    const { groups } = proposeSubjectGroups(docs, { minSize: 3 });
    expect(groups[0].label).toBe("AI safety");
  });

  it("falls back to the group's own phrase when no field fits", () => {
    const docs = many("c", "Eighteenth century canal lock masonry survey", 5);
    const { groups } = proposeSubjectGroups(docs, { minSize: 3 });
    expect(groups[0].label).toMatch(/canal|masonry|lock|century/i);
  });

  it("tells apart two clusters that land on the same field", () => {
    const docs = [
      ...many("a", "Protein structure prediction from contact maps and distance geometry", 5),
      ...many("b", "Protein structure prediction of secondary structure from sequence", 5),
    ];
    const { groups } = proposeSubjectGroups(docs, { minSize: 3 });
    const structure = groups.filter((g) => g.label.startsWith("Protein structure prediction"));
    if (structure.length > 1) {
      // Same field, but each carries what makes it different.
      expect(new Set(structure.map((g) => g.label)).size).toBe(structure.length);
      expect(structure.every((g) => g.label.includes(" · "))).toBe(true);
    }
  });

  it("does not label a group with a fragment or a filler word", () => {
    const docs = many("e", "End-to-end learning of a differentiable pipeline", 5);
    const { groups } = proposeSubjectGroups(docs, { minSize: 3 });
    for (const group of groups) {
      expect(group.label.toLowerCase()).not.toMatch(/^(end|joint|upon|using|via) /);
    }
  });

  it("prefers many narrow groups over one broad one", () => {
    const docs = [
      ...many("s", "Protein structure prediction with neural potentials", 12),
      ...many("d", "Directed evolution of enzymes by machine learning", 12),
      ...many("g", "Generative diffusion models for molecule design", 12),
    ];
    const { groups } = proposeSubjectGroups(docs);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    // Nothing should swallow the whole library.
    expect(Math.max(...groups.map((g) => g.documentIds.length))).toBeLessThan(docs.length * 0.6);
  });
});
