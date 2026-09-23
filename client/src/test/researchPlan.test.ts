import { describe, expect, it } from "vitest";
import type { Collection, Paper, ResearchQuestion } from "../types";
import { projectContents } from "../lib/projectWorkspace";
import {
  draftPlan,
  normalizePlans,
  planAsAgentBrief,
  planAsMarkdown,
  planLayers,
  sanitizePlan,
  taskBrief,
  type AgentTask,
} from "../lib/researchPlan";

function paper(id: string, title: string, extra: Partial<Paper> = {}): Paper {
  return {
    id, title, authors: ["Kechen Zhang"], year: 1996, venue: "", abstract: "", doi: `10.1/${id}`, source: "doi",
    tags: [], collectionIds: ["p"], addedAt: "2026-01-01T00:00:00Z", ...extra,
  } as Paper;
}

const project: Collection = {
  id: "p", name: "Heading through occlusion", createdAt: "",
  premise: "A ring attractor in the latent space keeps heading through occlusion.", status: "active",
};

const papers = [
  paper("a", "Representation of spatial orientation by head-direction cells", { takeaway: "A ring of cells holds heading without visual input." }),
  paper("b", "DreamerV3", { takeaway: "World models can learn from pixels across domains." }),
  paper("c", "A neural circuit for angular integration"),
];

const questions: ResearchQuestion[] = [
  { id: "q1", title: "Does the latent ring survive 2 seconds of occlusion?", detail: "Measure heading error.", status: "open", linkedPaperIds: ["a"], collectionIds: ["p"], createdAt: "", updatedAt: "" },
  { id: "q2", title: "Is the ring there without a heading loss?", detail: "", status: "open", linkedPaperIds: [], collectionIds: ["p"], createdAt: "", updatedAt: "" },
];

const contents = projectContents(project, [project], papers, [], questions);

describe("drafting a plan from the library alone", () => {
  const plan = draftPlan(project, contents, { now: "2026-09-19T00:00:00Z" });

  it("takes the question, hypothesis and background from what the project holds", () => {
    expect(plan.question).toBe(questions[0]!.title);
    expect(plan.hypothesis).toBe(project.premise);
    expect(plan.background).toEqual([
      { text: "A ring of cells holds heading without visual input.", paperIds: ["a"] },
      { text: "World models can learn from pixels across domains.", paperIds: ["b"] },
    ]);
    expect(plan.gap).toContain("Is the ring there without a heading loss?");
    expect(plan.aims.map((aim) => aim.title)).toEqual(questions.map((q) => q.title));
  });

  it("leaves unknowns empty rather than inventing them", () => {
    expect(plan.approach).toBe("");
    expect(plan.confirmIf).toBe("");
    expect(plan.refuteIf).toBe("");
    expect(plan.risks.join(" ")).toMatch(/thin/);
  });

  it("builds a runnable task graph: scout and read first, compute and claims behind checkpoints", () => {
    const layers = planLayers(plan.tasks).map((layer) => layer.map((task) => task.id));
    expect(layers[0]).toEqual(["scout", "read"]);
    expect(layers[1]).toEqual(["data-1", "data-2"]);
    expect(layers.at(-2)).toEqual(["audit"]);
    expect(layers.at(-1)).toEqual(["write"]);
    const runs = plan.tasks.filter((task) => task.role === "runner");
    expect(runs.every((task) => task.checkpoint)).toBe(true);
    expect(plan.tasks.find((task) => task.id === "read")!.paperIds).toEqual(["c"]);
  });

  it("works for a project with no questions at all", () => {
    const bare = draftPlan({ ...project, premise: "" }, projectContents(project, [project], [], [], []));
    expect(bare.aims).toEqual([]);
    expect(bare.question).toBe("");
    expect(planLayers(bare.tasks).flat().map((task) => task.id)).toEqual(["scout", "audit", "write"]);
  });
});

describe("keeping a model's plan honest", () => {
  it("drops citations the library does not hold, and counts them", () => {
    const { plan, droppedCitations } = sanitizePlan(
      {
        title: "T",
        background: [
          { text: "Real claim", paperIds: ["a", "invented-1"] },
          { text: "Made-up claim", paperIds: ["invented-2"] },
        ],
        tasks: [{ id: "x", title: "X", role: "reader", paperIds: ["b", "nope"] }],
      },
      ["a", "b", "c"]
    );
    expect(droppedCitations).toBe(3);
    expect(plan.background).toEqual([
      { text: "Real claim", paperIds: ["a"] },
      { text: "Made-up claim", paperIds: [] },
    ]);
    expect(plan.tasks[0]!.paperIds).toEqual(["b"]);
  });

  it("repairs the task graph: unknown roles, missing and circular dependencies, duplicate ids", () => {
    const { plan } = sanitizePlan(
      {
        tasks: [
          { id: "a", role: "wizard", dependsOn: ["c", "ghost", "a"] },
          { id: "b", role: "runner", dependsOn: ["a"] },
          { id: "c", role: "writer", dependsOn: ["b"] },
          { id: "c", role: "writer" },
        ],
      },
      []
    );
    expect(plan.tasks.map((task) => task.id)).toEqual(["a", "b", "c", "c-4"]);
    expect(plan.tasks[0]!.role).toBe("analyst");
    // a -> c was accepted first, so c -> b -> a would close the loop and one edge goes.
    const layers = planLayers(plan.tasks);
    expect(layers.flat()).toHaveLength(4);
    expect(layers.some((layer) => layer.length === 0)).toBe(false);
    const edges = plan.tasks.flatMap((task) => task.dependsOn.map((dep) => `${task.id}<-${dep}`));
    expect(edges).not.toContain("a<-ghost");
    expect(edges).not.toContain("a<-a");
  });

  it("round-trips stored plans", () => {
    const plan = draftPlan(project, contents);
    const [back] = normalizePlans(JSON.parse(JSON.stringify([plan, null, { nope: true }])));
    expect(back).toEqual(plan);
  });
});

describe("documents", () => {
  const plan = { ...draftPlan(project, contents), refuteIf: "Heading error grows linearly with occlusion time." };

  it("writes the proposal with citation keys and a reference list", () => {
    const markdown = planAsMarkdown(plan, papers);
    expect(markdown).toMatch(/^# Heading through occlusion/);
    expect(markdown).toContain("## Hypothesis");
    expect(markdown).toMatch(/A ring of cells holds heading without visual input\. \[@Zhang1996\w*\]/);
    expect(markdown).toContain("**Counts against it:** Heading error grows linearly");
    expect(markdown).toContain("## References");
    // A question-mark title is not followed by a second stop.
    expect(markdown).toContain("1. **Does the latent ring survive 2 seconds of occlusion?** Measure heading error.");
    // Empty sections are left out, not printed as headings with nothing under them.
    expect(markdown).not.toContain("## Approach");
  });

  it("writes an agent brief with rules and parallel stages", () => {
    const brief = planAsAgentBrief(plan, papers);
    expect(brief).toContain("## Rules for every agent");
    expect(brief).toContain("## Stage 1 (these can run in parallel)");
    expect(brief).toContain("**Checkpoint:** stop here");
    expect(brief.indexOf("### scout")).toBeLessThan(brief.indexOf("### write"));
  });

  it("writes a prompt for one task", () => {
    const task = plan.tasks.find((item) => item.id === "run-1") as AgentTask;
    const prompt = taskBrief(plan, task, papers);
    expect(prompt).toMatch(/^You are the experiment runner on "Heading through occlusion"\./);
    expect(prompt).toContain("This task serves the aim: Does the latent ring survive");
    expect(prompt).toContain("**Starts after:** data-1");
  });
});
