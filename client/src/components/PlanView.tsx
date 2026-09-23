// A proposal and its agent plan, side by side with what it cites.
//
// The proposal fields are edited in place. The plan is laid out in stages: everything
// in a stage can run at once, and a stage starts when the one before it is done. A
// task marked for review stops there until the researcher has looked.

import { useEffect, useMemo, useState } from "react";
import type { Paper } from "../types";
import {
  AGENT_ROLES,
  aimSeparator,
  planAsAgentBrief,
  planAsMarkdown,
  planLayers,
  taskBrief,
  type AgentRole,
  type AgentTask,
  type ResearchPlan,
} from "../lib/researchPlan";
import { IconBack, IconCopy, IconNote, IconSparkle, IconTrash } from "./Icons";

interface Props {
  plan: ResearchPlan;
  papers: Paper[];
  projectName?: string;
  /** Whether the server can draft with Claude. */
  canDraftWithClaude: boolean;
  drafting: boolean;
  onChange: (plan: ResearchPlan) => void;
  onDraftWithClaude: () => void;
  onSaveAsNote: () => void;
  onDelete: () => void;
  onOpenPaper: (id: string) => void;
  onOpenProject?: () => void;
  onBack: () => void;
}

const ROLE_TINT: Record<AgentRole, string> = {
  scout: "text-sky-300 border-sky-400/20 bg-sky-400/10",
  reader: "text-fuchsia-300 border-fuchsia-300/20 bg-fuchsia-300/10",
  data: "text-amber-300 border-amber-400/20 bg-amber-400/10",
  runner: "text-indigo-300 border-indigo-400/20 bg-indigo-400/10",
  analyst: "text-emerald-300 border-emerald-400/20 bg-emerald-400/10",
  auditor: "text-rose-300 border-rose-400/20 bg-rose-400/10",
  writer: "text-cyan-300 border-cyan-400/20 bg-cyan-400/10",
};

export function PlanView({
  plan, papers, projectName, canDraftWithClaude, drafting, onChange, onDraftWithClaude, onSaveAsNote, onDelete,
  onOpenPaper, onOpenProject, onBack,
}: Props) {
  const byId = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);
  const layers = useMemo(() => planLayers(plan.tasks), [plan.tasks]);
  const [openTask, setOpenTask] = useState<string>("");
  const [copied, setCopied] = useState("");

  const set = (patch: Partial<ResearchPlan>) => onChange({ ...plan, ...patch });

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1500);
  }

  const checkpoints = plan.tasks.filter((task) => task.checkpoint).length;

  return (
    <div className="h-full overflow-auto bg-lattice-canvas">
      <div className="mx-auto max-w-6xl px-5 py-6 lg:px-9">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onBack} className="lat-secondary px-2.5 py-1.5 text-xs"><IconBack width={13} /> Back</button>
          <span className="text-xs text-slate-600">
            {projectName && onOpenProject ? (
              <>Proposal for <button onClick={onOpenProject} className="text-slate-400 hover:text-cyan-300">{projectName}</button></>
            ) : "Proposal"}
            {" · "}
            {plan.source === "claude" ? `drafted by ${plan.model || "Claude"}, edited by you` : "drafted from your library"}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => void copy("proposal", planAsMarkdown(plan, papers))} className="lat-secondary px-3 py-1.5 text-xs" title="The proposal as Markdown, with citation keys and references">
              <IconCopy width={13} /> {copied === "proposal" ? "Copied" : "Copy proposal"}
            </button>
            <button onClick={() => void copy("brief", planAsAgentBrief(plan, papers))} className="lat-secondary px-3 py-1.5 text-xs" title="The agent plan as a CLAUDE.md: rules, stages and a spec for every task">
              <IconCopy width={13} /> {copied === "brief" ? "Copied" : "Copy agent plan"}
            </button>
            <button onClick={onSaveAsNote} className="lat-secondary px-3 py-1.5 text-xs" title="Save the proposal as a note in the project, so it shows in the graph and to the lattice MCP server">
              <IconNote width={13} /> Save as note
            </button>
            {canDraftWithClaude && (
              <button onClick={onDraftWithClaude} disabled={drafting} className="lat-primary px-3 py-1.5 text-xs disabled:opacity-50" title="Replace this draft with one Claude writes from the project">
                <IconSparkle width={13} /> {drafting ? "Drafting… (a minute or two)" : "Draft with Claude"}
              </button>
            )}
            <button onClick={onDelete} className="lat-secondary px-2.5 py-1.5 text-xs hover:text-rose-300" title="Delete this proposal">
              <IconTrash width={13} />
            </button>
          </div>
        </div>

        <input
          key={`title-${plan.id}-${plan.updatedAt}`}
          defaultValue={plan.title}
          onBlur={(event) => event.target.value.trim() !== plan.title && set({ title: event.target.value.trim() || plan.title })}
          className="mt-5 w-full bg-transparent text-3xl font-semibold tracking-tight text-slate-100 outline-none"
          aria-label="Proposal title"
        />

        {!plan.refuteIf.trim() && (
          <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-sm text-amber-300">
            Say what result would count against the hypothesis. Until then the analysts have nothing to check against.
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Field label="Question" value={plan.question} placeholder="The thing you don't know yet." onSave={(question) => set({ question })} planKey={plan} />
          <Field label="Hypothesis" value={plan.hypothesis} placeholder="What you think is true, stated so it could turn out wrong." onSave={(hypothesis) => set({ hypothesis })} planKey={plan} />
          <Field label="Supports it if" value={plan.confirmIf} placeholder="The result that would count in favour." onSave={(confirmIf) => set({ confirmIf })} planKey={plan} />
          <Field label="Counts against it if" value={plan.refuteIf} placeholder="The result that would count against it." onSave={(refuteIf) => set({ refuteIf })} planKey={plan} />
        </div>

        <section className="mt-6 lat-panel p-5">
          <h2 className="text-sm font-medium text-slate-200">What the library already says</h2>
          {plan.background.length ? (
            <ul className="mt-3 space-y-2.5">
              {plan.background.map((claim, index) => (
                <li key={index} className="group flex gap-3 text-sm leading-6 text-slate-300">
                  <span className="min-w-0 flex-1">
                    {claim.text}{" "}
                    {claim.paperIds.length ? (
                      claim.paperIds.map((id) => (
                        <button key={id} onClick={() => onOpenPaper(id)} className="lat-chip mr-1 !py-0.5" title={byId.get(id)?.title}>
                          {shortTitle(byId.get(id))}
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-amber-300/80">no paper in the library backs this</span>
                    )}
                  </span>
                  <button
                    onClick={() => set({ background: plan.background.filter((_, i) => i !== index) })}
                    className="text-xs text-slate-600 opacity-0 hover:text-rose-300 group-hover:opacity-100"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Nothing yet. Takeaways you write on the project's papers show up here.</p>
          )}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Field label="The gap" value={plan.gap} placeholder="What nobody has shown yet." onSave={(gap) => set({ gap })} planKey={plan} rows={4} />
          <Field label="Approach" value={plan.approach} placeholder="How you'd test it: data, method, comparisons." onSave={(approach) => set({ approach })} planKey={plan} rows={4} />
        </div>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="lat-panel p-5">
            <h2 className="text-sm font-medium text-slate-200">Aims</h2>
            {plan.aims.length ? (
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
                {plan.aims.map((aim) => (
                  <li key={aim.id}>
                    <span className="text-slate-100">{aim.title}</span>
                    {aim.detail && <span className="text-slate-500">{aimSeparator(aim.title)}{aim.detail}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No aims yet. Open questions in the project become aims.</p>
            )}
          </div>
          <div className="lat-panel p-5">
            <h2 className="text-sm font-medium text-slate-200">Risks</h2>
            {plan.risks.length ? (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-400">
                {plan.risks.map((risk, index) => <li key={index}>{risk}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">None noted.</p>
            )}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Agent plan</h2>
              <p className="mt-1 text-xs text-slate-500">
                {plan.tasks.length} tasks in {layers.length} stages. Tasks in a stage can run at the same time. {checkpoints} stop for your review.
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto pb-2">
            <div className="flex min-w-max gap-3">
              {layers.map((layer, index) => (
                <div key={index} className="w-72 shrink-0">
                  <p className="lat-kicker mb-2">Stage {index + 1}{layer.length > 1 ? " · in parallel" : ""}</p>
                  <div className="space-y-3">
                    {layer.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        open={openTask === task.id}
                        onToggle={() => setOpenTask(openTask === task.id ? "" : task.id)}
                        papers={byId}
                        onOpenPaper={onOpenPaper}
                        copied={copied === `task-${task.id}`}
                        onCopy={() => void copy(`task-${task.id}`, taskBrief(plan, task, papers))}
                        onToggleCheckpoint={() =>
                          set({ tasks: plan.tasks.map((item) => (item.id === task.id ? { ...item, checkpoint: !item.checkpoint } : item)) })
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label, value, placeholder, onSave, planKey, rows = 3,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
  planKey: ResearchPlan;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  // A new draft from Claude replaces the text; a local edit in progress does not
  // survive that, which is what the researcher asked for by redrafting.
  useEffect(() => setDraft(value), [value, planKey.id]);
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft.trim() !== value.trim() && onSave(draft.trim())}
        placeholder={placeholder}
        rows={rows}
        className="lat-input mt-1.5 block w-full resize-y px-3 py-2 text-sm leading-6"
      />
    </label>
  );
}

function TaskCard({
  task, open, onToggle, papers, onOpenPaper, copied, onCopy, onToggleCheckpoint,
}: {
  task: AgentTask;
  open: boolean;
  onToggle: () => void;
  papers: Map<string, Paper>;
  onOpenPaper: (id: string) => void;
  copied: boolean;
  onCopy: () => void;
  onToggleCheckpoint: () => void;
}) {
  return (
    <div className={`lat-panel p-3.5 ${task.checkpoint ? "ring-1 ring-amber-400/25" : ""}`}>
      <button onClick={onToggle} className="block w-full text-left">
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${ROLE_TINT[task.role]}`}>{AGENT_ROLES[task.role].label}</span>
          {task.checkpoint && <span className="text-[10px] font-medium uppercase tracking-wide text-amber-300">review</span>}
        </div>
        <p className="mt-2 text-sm font-medium leading-5 text-slate-100">{task.title}</p>
        {!open && task.goal && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{task.goal}</p>}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs leading-5 text-slate-400">
          {task.goal && <p>{task.goal}</p>}
          {task.inputs.length > 0 && <Detail label="Takes">{task.inputs.map((input) => input.replace(/`/g, "")).join("; ")}</Detail>}
          {task.paperIds.length > 0 && (
            <Detail label="Papers">
              {task.paperIds.map((id) => (
                <button key={id} onClick={() => onOpenPaper(id)} className="mr-2 text-slate-300 hover:text-cyan-300">
                  {shortTitle(papers.get(id))}
                </button>
              ))}
            </Detail>
          )}
          {task.tools.length > 0 && <Detail label="Tools">{task.tools.join("; ")}</Detail>}
          {task.output && <Detail label="Hands back">{task.output}</Detail>}
          {task.doneWhen && <Detail label="Done when">{task.doneWhen}</Detail>}
          {task.dependsOn.length > 0 && <Detail label="After">{task.dependsOn.join(", ")}</Detail>}
          <div className="flex gap-2 pt-1">
            <button onClick={onCopy} className="lat-secondary px-2.5 py-1 text-[11px]"><IconCopy width={12} /> {copied ? "Copied" : "Copy prompt"}</button>
            <button onClick={onToggleCheckpoint} className="lat-secondary px-2.5 py-1 text-[11px]">
              {task.checkpoint ? "Don't stop here" : "Stop for review"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="text-slate-600">{label}: </span>
      {children}
    </p>
  );
}

function shortTitle(paper: Paper | undefined): string {
  if (!paper) return "missing paper";
  // "Zhang, Kechen" and "Kechen Zhang" both give "Zhang".
  const name = paper.authors[0]?.trim() || "";
  const author = name.includes(",") ? name.split(",")[0]!.trim() : name.split(/\s+/).pop();
  return author ? `${author}${paper.year ? ` ${paper.year}` : ""}` : paper.title.slice(0, 24);
}
