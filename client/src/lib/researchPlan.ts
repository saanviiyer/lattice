// A research proposal, and the work broken down so agents can do it.
//
// The proposal half is the usual one: the question, what you expect and what would
// prove you wrong, what the literature already says, and the aims. The half that
// matters for agents is the task graph. Each task names one role, what it takes in,
// what it hands back, how you can tell it is done, and whether a person has to look
// before anything downstream runs. That last flag is the difference between a plan an
// agent can execute and one it will run straight off a cliff with: searches and
// reading can go ahead unattended, spending compute and writing claims should not.
//
// Every claim in the background points at papers in the library by id. A plan from
// the model goes through `sanitizePlan`, which drops any citation the library does
// not hold, so a proposal can never cite a paper nobody has.

import type { Collection, Paper, ResearchQuestion } from "../types";
import { citationKey } from "./citations";
import type { ProjectContents } from "./projectWorkspace";

export const AGENT_ROLES = {
  scout: { label: "Literature scout", does: "Finds work the library is missing and says why each one matters." },
  reader: { label: "Reader", does: "Reads papers and pulls out the claims, numbers and caveats, with page references." },
  data: { label: "Data steward", does: "Finds, checks and documents the data, and says what it can and cannot support." },
  runner: { label: "Experiment runner", does: "Runs the analysis or experiment exactly as specified and keeps the logs." },
  analyst: { label: "Analyst", does: "Reads the results against the stated criteria, including the ones that would refute the idea." },
  auditor: { label: "Claim auditor", does: "Tries to break every claim before it is written down." },
  writer: { label: "Writer", does: "Drafts the write-up from audited claims only." },
} as const;

export type AgentRole = keyof typeof AGENT_ROLES;
export const ROLE_ORDER = Object.keys(AGENT_ROLES) as AgentRole[];

export interface PlanClaim {
  text: string;
  /** Library papers that support it. */
  paperIds: string[];
}

export interface PlanAim {
  id: string;
  title: string;
  detail: string;
}

export interface AgentTask {
  id: string;
  title: string;
  role: AgentRole;
  goal: string;
  inputs: string[];
  tools: string[];
  output: string;
  doneWhen: string;
  dependsOn: string[];
  /** A person reviews the output before anything that depends on it starts. */
  checkpoint: boolean;
  aimId?: string;
  paperIds: string[];
}

export interface ResearchPlan {
  id: string;
  projectId: string | null;
  title: string;
  question: string;
  hypothesis: string;
  /** What the library already says. */
  background: PlanClaim[];
  /** What nobody has shown yet: the reason this is worth doing. */
  gap: string;
  aims: PlanAim[];
  approach: string;
  /** What result would support the hypothesis. */
  confirmIf: string;
  /** What result would count against it. Required: a plan with no way to fail is a wish. */
  refuteIf: string;
  risks: string[];
  tasks: AgentTask[];
  source: "draft" | "claude";
  model?: string;
  createdAt: string;
  updatedAt: string;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function oneLine(text: string, limit = 240): string {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

const ALL_TOOLS = {
  lattice: "lattice MCP (get_project, search_library, get_paper)",
  search: "Literature search (OpenAlex, Semantic Scholar, arXiv)",
  pdf: "PDF reading",
  code: "Code execution",
  files: "File system (data and results folder)",
} as const;

/**
 * A first plan built only from what the project already holds.
 *
 * Nothing here is invented. The question and hypothesis come from the project's own
 * questions and premise, the background from the takeaways the researcher wrote, the
 * gap from the questions no paper answers yet. Where the library has nothing to say,
 * the field is left empty for the researcher (or the model) to fill, rather than
 * padded with something that sounds right.
 */
export function draftPlan(
  project: Collection,
  contents: ProjectContents,
  options: { engagementOrder?: string[]; now?: string } = {}
): ResearchPlan {
  const now = options.now || new Date().toISOString();
  const rank = new Map((options.engagementOrder || []).map((id, index) => [id, index]));
  const byEngagement = (a: Paper, b: Paper) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9);
  const papers = [...contents.papers].sort(byEngagement);
  const paperIds = new Set(papers.map((paper) => paper.id));

  const open = contents.questions.filter((question) => question.status !== "resolved");
  const unanswered = open.filter((question) => !question.linkedPaperIds.some((id) => paperIds.has(id)));
  const withTakeaway = papers.filter((paper) => paper.takeaway?.trim());
  const unread = papers.filter((paper) => !paper.takeaway?.trim());

  const premise = project.premise?.trim() || "";
  const question = open[0]?.title.trim() || (premise ? `What would show whether ${lowerFirst(premise).replace(/\.$/, "")}?` : "");

  const background: PlanClaim[] = withTakeaway.slice(0, 8).map((paper) => ({
    text: oneLine(paper.takeaway!, 300),
    paperIds: [paper.id],
  }));

  const gap = unanswered.length
    ? `No paper in the library yet answers: ${unanswered.map((q) => `“${oneLine(q.title, 140)}”`).join("; ")}.`
    : "";

  const aims: PlanAim[] = (open.length ? open.slice(0, 4) : premise ? [null] : []).map((q: ResearchQuestion | null, index) => ({
    id: `aim-${index + 1}`,
    title: q ? oneLine(q.title, 140) : `Test the premise`,
    detail: q ? oneLine(q.detail || "", 400) : premise,
  }));

  const risks: string[] = [];
  if (papers.length < 5) risks.push(`The literature base is thin: ${papers.length} paper${papers.length === 1 ? "" : "s"} so far. The scout's pass matters more than usual.`);
  if (!premise) risks.push("There is no premise yet, so nothing here can be confirmed or refuted until one is written.");
  if (unread.length) risks.push(`${unread.length} paper${unread.length === 1 ? " has" : "s have"} no takeaway, so the background may be missing what they say.`);

  return {
    id: uid("plan"),
    projectId: project.id,
    title: project.name,
    question,
    hypothesis: premise,
    background,
    gap,
    aims,
    approach: "",
    confirmIf: "",
    refuteIf: "",
    risks,
    tasks: draftTasks(aims, unread, papers),
    source: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

/** What goes between an aim's title and its detail: no second stop after a "?" or ".". */
export function aimSeparator(title: string): string {
  return /[.?!]$/.test(title.trim()) ? " " : ". ";
}

function lowerFirst(text: string): string {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** The standard pipeline: scout and read in parallel, then per aim data, run, analyse; audit; write. */
function draftTasks(aims: PlanAim[], unread: Paper[], papers: Paper[]): AgentTask[] {
  const tasks: AgentTask[] = [];
  const task = (spec: Omit<AgentTask, "id" | "paperIds"> & { id: string; paperIds?: string[] }) => {
    tasks.push({ paperIds: [], ...spec });
    return spec.id;
  };

  const scout = task({
    id: "scout",
    title: "Find what the library is missing",
    role: "scout",
    goal: "Search for work that bears on the question and is not in the library yet, especially work that would contradict the hypothesis.",
    inputs: ["The question and hypothesis", "The project's papers, through lattice"],
    tools: [ALL_TOOLS.lattice, ALL_TOOLS.search],
    output: "A shortlist of papers, each with its DOI or arXiv id and one line on why it matters here.",
    doneWhen: "Every candidate has an identifier that resolves and a reason. Contradicting work is listed first.",
    dependsOn: [],
    checkpoint: true,
    paperIds: papers.slice(0, 10).map((paper) => paper.id),
  });

  const reading = unread.length
    ? task({
        id: "read",
        title: `Pull the claims out of ${unread.length} unread paper${unread.length === 1 ? "" : "s"}`,
        role: "reader",
        goal: "For each paper, state its main claim, the numbers behind it and the caveats the authors give.",
        inputs: unread.slice(0, 12).map((paper) => `\`${citationKey(paper)}\` ${oneLine(paper.title, 90)}`),
        tools: [ALL_TOOLS.lattice, ALL_TOOLS.pdf],
        output: "One takeaway per paper, with page references, ready to save back into lattice.",
        doneWhen: "Every paper has a takeaway that quotes where in the paper it comes from.",
        dependsOn: [],
        checkpoint: false,
        paperIds: unread.slice(0, 12).map((paper) => paper.id),
      })
    : null;

  const analysed: string[] = [];
  aims.forEach((aim, index) => {
    const n = index + 1;
    const upstream = [scout, ...(reading ? [reading] : [])];
    const data = task({
      id: `data-${n}`,
      title: `Data for aim ${n}`,
      role: "data",
      goal: `Find or build the data to answer "${aim.title}", then check its quality and say what it can and cannot support.`,
      inputs: ["The aim", "The reader's takeaways", "The scout's shortlist"],
      tools: [ALL_TOOLS.search, ALL_TOOLS.code, ALL_TOOLS.files],
      output: "A dataset with a provenance note: source, version, exclusions and known problems.",
      doneWhen: "Someone else could rebuild the dataset from the note alone.",
      dependsOn: upstream,
      checkpoint: false,
      aimId: aim.id,
    });
    const run = task({
      id: `run-${n}`,
      title: `Run aim ${n}`,
      role: "runner",
      goal: `Run the analysis for "${aim.title}" as written, with the confirm and refute criteria fixed before it starts.`,
      inputs: ["The dataset and its note", "The approach section of the proposal"],
      tools: [ALL_TOOLS.code, ALL_TOOLS.files],
      output: "Results, the exact commands and seeds, and logs.",
      doneWhen: "The run can be repeated from the logs and gives the same numbers.",
      dependsOn: [data],
      // Compute is spent here, so a person signs off on the setup first.
      checkpoint: true,
      aimId: aim.id,
    });
    analysed.push(
      task({
        id: `analyse-${n}`,
        title: `Read aim ${n}'s results`,
        role: "analyst",
        goal: "Compare the results with what would confirm and what would refute the hypothesis. Report either way.",
        inputs: ["The run's results and logs", "The confirm and refute criteria"],
        tools: [ALL_TOOLS.code],
        output: "A short verdict with the numbers, their uncertainty, and which criterion they meet.",
        doneWhen: "The verdict names a criterion and the evidence for it, and says what it does not show.",
        dependsOn: [run],
        checkpoint: false,
        aimId: aim.id,
      })
    );
  });

  const audit = task({
    id: "audit",
    title: "Audit every claim",
    role: "auditor",
    goal: "Try to break each claim: check it against the logs, look for leakage and confounds, and check every citation resolves to a real paper that says what is claimed.",
    inputs: ["The analysts' verdicts", "The proposal's background claims"],
    tools: [ALL_TOOLS.lattice, ALL_TOOLS.search, ALL_TOOLS.code],
    output: "Each claim marked supported, weakened or unsupported, with the reason.",
    doneWhen: "No claim is left unmarked.",
    dependsOn: analysed.length ? analysed : [scout, ...(reading ? [reading] : [])],
    checkpoint: true,
  });

  task({
    id: "write",
    title: "Write it up",
    role: "writer",
    goal: "Draft the write-up from the audited claims only, keeping every caveat the auditor raised.",
    inputs: ["The audited claims", "The proposal"],
    tools: [ALL_TOOLS.lattice, ALL_TOOLS.files],
    output: "A draft with each claim cited to a library paper or a logged result.",
    doneWhen: "Every sentence that states a finding has a citation or a result behind it.",
    dependsOn: [audit],
    checkpoint: true,
  });

  return tasks;
}

/**
 * Tasks in the order they can run: each layer depends only on earlier layers, so
 * everything in a layer can run at once. A task caught in a dependency loop goes in
 * a final layer rather than disappearing.
 */
export function planLayers(tasks: AgentTask[]): AgentTask[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const placed = new Set<string>();
  const layers: AgentTask[][] = [];
  let remaining = tasks.slice();
  while (remaining.length) {
    const ready = remaining.filter((task) =>
      task.dependsOn.every((dep) => placed.has(dep) || !byId.has(dep))
    );
    if (!ready.length) {
      layers.push(remaining);
      break;
    }
    layers.push(ready);
    for (const task of ready) placed.add(task.id);
    remaining = remaining.filter((task) => !placed.has(task.id));
  }
  return layers;
}

// ---- Output from the model --------------------------------------------------

const clip = (value: unknown, limit: number) => oneLine(typeof value === "string" ? value : "", limit);
const clipList = (value: unknown, count: number, limit: number) =>
  (Array.isArray(value) ? value : []).map((item) => clip(item, limit)).filter(Boolean).slice(0, count);

/**
 * Make a plan that came from outside (the model, a file, an old version) safe to keep.
 *
 * Citations to papers the library does not hold are removed, and a claim left with no
 * citation is kept only if it does not pretend to have one. Dependencies on tasks that
 * do not exist are dropped, and so is any edge that would close a loop.
 */
export function sanitizePlan(
  raw: any,
  libraryPaperIds: Iterable<string>,
  base: { id?: string; projectId?: string | null; source?: ResearchPlan["source"]; model?: string; now?: string } = {}
): { plan: ResearchPlan; droppedCitations: number } {
  const known = new Set(libraryPaperIds);
  let droppedCitations = 0;
  const keepIds = (ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    const kept = [...new Set(list.filter((id) => known.has(id)))];
    droppedCitations += list.length - list.filter((id) => known.has(id)).length;
    return kept;
  };

  const background: PlanClaim[] = (Array.isArray(raw?.background) ? raw.background : [])
    .map((claim: any) => ({ text: clip(claim?.text, 400), paperIds: keepIds(claim?.paperIds) }))
    .filter((claim: PlanClaim) => claim.text)
    .slice(0, 12);

  const aims: PlanAim[] = (Array.isArray(raw?.aims) ? raw.aims : [])
    .map((aim: any, index: number) => ({
      id: clip(aim?.id, 40) || `aim-${index + 1}`,
      title: clip(aim?.title, 160),
      detail: clip(aim?.detail, 600),
    }))
    .filter((aim: PlanAim) => aim.title)
    .slice(0, 6);
  const aimIds = new Set(aims.map((aim) => aim.id));

  const seen = new Set<string>();
  const tasks: AgentTask[] = (Array.isArray(raw?.tasks) ? raw.tasks : [])
    .slice(0, 24)
    .map((task: any, index: number) => {
      let id = clip(task?.id, 40).replace(/\s+/g, "-") || `task-${index + 1}`;
      while (seen.has(id)) id = `${id}-${index + 1}`;
      seen.add(id);
      const role = (ROLE_ORDER as string[]).includes(task?.role) ? (task.role as AgentRole) : "analyst";
      return {
        id,
        title: clip(task?.title, 140) || `Task ${index + 1}`,
        role,
        goal: clip(task?.goal, 600),
        inputs: clipList(task?.inputs, 8, 200),
        tools: clipList(task?.tools, 8, 120),
        output: clip(task?.output, 400),
        doneWhen: clip(task?.doneWhen, 400),
        dependsOn: clipList(task?.dependsOn, 12, 40),
        checkpoint: task?.checkpoint === true,
        aimId: aimIds.has(task?.aimId) ? task.aimId : undefined,
        paperIds: keepIds(task?.paperIds),
      };
    });

  // Dependencies: only on tasks that exist, never on itself, never closing a loop.
  const ids = new Set(tasks.map((task) => task.id));
  const accepted = new Map<string, string[]>();
  const reaches = (from: string, target: string, visiting = new Set<string>()): boolean => {
    if (from === target) return true;
    if (visiting.has(from)) return false;
    visiting.add(from);
    return (accepted.get(from) || []).some((next) => reaches(next, target, visiting));
  };
  for (const task of tasks) {
    const kept: string[] = [];
    accepted.set(task.id, kept);
    for (const dep of [...new Set(task.dependsOn)]) {
      if (!ids.has(dep) || dep === task.id) continue;
      if (reaches(dep, task.id)) continue; // would close a loop
      kept.push(dep);
    }
    task.dependsOn = kept;
  }

  const now = base.now || new Date().toISOString();
  return {
    droppedCitations,
    plan: {
      id: base.id || uid("plan"),
      projectId: base.projectId ?? null,
      title: clip(raw?.title, 160) || "Untitled proposal",
      question: clip(raw?.question, 400),
      hypothesis: clip(raw?.hypothesis, 600),
      background,
      gap: clip(raw?.gap, 800),
      aims,
      approach: clip(raw?.approach, 2000),
      confirmIf: clip(raw?.confirmIf, 600),
      refuteIf: clip(raw?.refuteIf, 600),
      risks: clipList(raw?.risks, 8, 300),
      tasks,
      source: base.source || "draft",
      model: base.model,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function normalizePlans(raw: unknown): ResearchPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object" && typeof item.id === "string")
    .map((item: any) => {
      const { plan } = sanitizePlan(item, collectPaperIds(item), {
        id: item.id,
        projectId: typeof item.projectId === "string" ? item.projectId : null,
        source: item.source === "claude" ? "claude" : "draft",
        model: typeof item.model === "string" ? item.model : undefined,
      });
      return {
        ...plan,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : plan.createdAt,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : plan.updatedAt,
      };
    });
}

/** Every paper id a stored plan mentions; stored plans were checked when they were made. */
function collectPaperIds(item: any): string[] {
  const ids: string[] = [];
  for (const claim of Array.isArray(item?.background) ? item.background : []) ids.push(...(claim?.paperIds || []));
  for (const task of Array.isArray(item?.tasks) ? item.tasks : []) ids.push(...(task?.paperIds || []));
  return ids.filter((id) => typeof id === "string");
}

// ---- Documents --------------------------------------------------------------

function referenceList(plan: ResearchPlan, papers: Map<string, Paper>): Paper[] {
  const ids = new Set([...plan.background.flatMap((claim) => claim.paperIds), ...plan.tasks.flatMap((task) => task.paperIds)]);
  return [...ids].map((id) => papers.get(id)).filter((paper): paper is Paper => !!paper);
}

function cite(ids: string[], papers: Map<string, Paper>): string {
  const keys = ids.map((id) => papers.get(id)).filter((paper): paper is Paper => !!paper).map((paper) => `@${citationKey(paper)}`);
  return keys.length ? ` [${keys.join("; ")}]` : "";
}

function section(title: string, body: string): string {
  return body.trim() ? `## ${title}\n\n${body.trim()}\n` : "";
}

/** The proposal as Markdown, citations as pandoc keys with a reference list. */
export function planAsMarkdown(plan: ResearchPlan, library: Paper[]): string {
  const papers = new Map(library.map((paper) => [paper.id, paper]));
  const refs = referenceList(plan, papers);
  const parts = [
    `# ${plan.title}\n`,
    section("Question", plan.question),
    section("Hypothesis", plan.hypothesis),
    section("What is already known", plan.background.map((claim) => `- ${claim.text}${cite(claim.paperIds, papers)}`).join("\n")),
    section("The gap", plan.gap),
    section("Aims", plan.aims.map((aim, index) => `${index + 1}. **${aim.title}**${aim.detail ? `${aimSeparator(aim.title)}${aim.detail}` : ""}`).join("\n")),
    section("Approach", plan.approach),
    section(
      "How we'll know",
      [plan.confirmIf && `- **Supports the hypothesis:** ${plan.confirmIf}`, plan.refuteIf && `- **Counts against it:** ${plan.refuteIf}`]
        .filter(Boolean)
        .join("\n")
    ),
    section("Risks", plan.risks.map((risk) => `- ${risk}`).join("\n")),
    section(
      "Work plan",
      planLayers(plan.tasks)
        .map((layer, index) =>
          `**Stage ${index + 1}**\n\n` +
          layer
            .map((task) => `- ${task.title} (${AGENT_ROLES[task.role].label}${task.checkpoint ? ", reviewed before the next stage" : ""})`)
            .join("\n")
        )
        .join("\n\n")
    ),
    section(
      "References",
      refs.map((paper) => `- \`${citationKey(paper)}\`: ${paper.authors.slice(0, 3).join(", ")}${paper.authors.length > 3 ? " et al." : ""} (${paper.year || "n.d."}). ${paper.title}.${paper.doi ? ` doi:${paper.doi}` : paper.arxivId ? ` arXiv:${paper.arxivId}` : ""}`).join("\n")
    ),
  ];
  return parts.filter(Boolean).join("\n").trim() + "\n";
}

const AGENT_RULES = `## Rules for every agent

- Cite only papers in the lattice library or that you have fetched and can quote. Never write a citation from memory.
- Stop at every checkpoint. Hand back what you have and wait for the researcher before any task that depends on it starts.
- Report results that count against the hypothesis as prominently as ones that support it.
- Say what you could not do. A missing step reported is fine; a missing step papered over is not.
- Keep everything you produce in the project folder, named by task id.`;

function taskSpec(task: AgentTask, papers: Map<string, Paper>): string {
  const lines = [
    `### ${task.id}: ${task.title}`,
    ``,
    `- **Role:** ${AGENT_ROLES[task.role].label}. ${AGENT_ROLES[task.role].does}`,
    `- **Goal:** ${task.goal}`,
  ];
  if (task.dependsOn.length) lines.push(`- **Starts after:** ${task.dependsOn.join(", ")}`);
  if (task.inputs.length) lines.push(`- **Inputs:** ${task.inputs.join("; ")}`);
  const cited = task.paperIds.map((id) => papers.get(id)).filter((paper): paper is Paper => !!paper);
  if (cited.length) lines.push(`- **Papers:** ${cited.map((paper) => `\`${citationKey(paper)}\``).join(", ")}`);
  if (task.tools.length) lines.push(`- **Tools:** ${task.tools.join("; ")}`);
  lines.push(`- **Hand back:** ${task.output}`, `- **Done when:** ${task.doneWhen}`);
  if (task.checkpoint) lines.push(`- **Checkpoint:** stop here for the researcher's review.`);
  return lines.join("\n");
}

/** The whole plan as a CLAUDE.md an orchestrating agent can work from. */
export function planAsAgentBrief(plan: ResearchPlan, library: Paper[]): string {
  const papers = new Map(library.map((paper) => [paper.id, paper]));
  const header = [
    `# Agent plan: ${plan.title}`,
    ``,
    plan.question && `**Question.** ${plan.question}`,
    plan.hypothesis && `**Hypothesis.** ${plan.hypothesis}`,
    plan.confirmIf && `**Supports it:** ${plan.confirmIf}`,
    plan.refuteIf && `**Counts against it:** ${plan.refuteIf}`,
  ].filter(Boolean).join("\n\n");

  const stages = planLayers(plan.tasks)
    .map((layer, index) => `## Stage ${index + 1}${layer.length > 1 ? " (these can run in parallel)" : ""}\n\n${layer.map((task) => taskSpec(task, papers)).join("\n\n")}`)
    .join("\n\n");

  return `${header}\n\n${AGENT_RULES}\n\n${stages}\n`;
}

/** One task as a prompt for the agent that will do it. */
export function taskBrief(plan: ResearchPlan, task: AgentTask, library: Paper[]): string {
  const papers = new Map(library.map((paper) => [paper.id, paper]));
  const aim = plan.aims.find((item) => item.id === task.aimId);
  return [
    `You are the ${AGENT_ROLES[task.role].label.toLowerCase()} on "${plan.title}".`,
    plan.question && `The research question: ${plan.question}`,
    plan.hypothesis && `The hypothesis being tested: ${plan.hypothesis}`,
    aim && `This task serves the aim: ${aim.title}.`,
    "",
    taskSpec(task, papers),
    "",
    AGENT_RULES,
  ]
    .filter((line) => typeof line === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}
