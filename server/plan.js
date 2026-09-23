// Claude drafts a research proposal and the agent plan to carry it out.
//
// The model sees the project exactly as the researcher has it: the premise, the open
// questions, every paper with its id, abstract and the researcher's own takeaway,
// plus what the rest of their library says they care about. It answers in a fixed
// schema, and every citation has to be one of the paper ids it was given. Anything
// else is removed here before the plan leaves the server, and the client checks again
// against the whole library when it saves.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

export const PLAN_MODEL = process.env.LATTICE_PLAN_MODEL || "claude-opus-5";
// Routes a declined request to Anthropic's recommended fallback model by refusal
// category, instead of returning the refusal.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const ROLES = ["scout", "reader", "data", "runner", "analyst", "auditor", "writer"];

export const PlanSchema = z.object({
  title: z.string(),
  question: z.string(),
  hypothesis: z.string(),
  background: z.array(z.object({ text: z.string(), paperIds: z.array(z.string()) })),
  gap: z.string(),
  aims: z.array(z.object({ id: z.string(), title: z.string(), detail: z.string() })),
  approach: z.string(),
  confirmIf: z.string(),
  refuteIf: z.string(),
  risks: z.array(z.string()),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      role: z.enum(ROLES),
      goal: z.string(),
      inputs: z.array(z.string()),
      tools: z.array(z.string()),
      output: z.string(),
      doneWhen: z.string(),
      dependsOn: z.array(z.string()),
      checkpoint: z.boolean(),
      aimId: z.string(),
      paperIds: z.array(z.string()),
    })
  ),
});

export const PLAN_SYSTEM = `You write research proposals for a working researcher, and break the work into tasks that AI agents can carry out.

You are given one project from the researcher's library: its premise, its open questions, and its papers, each with an id, an abstract and often the researcher's own takeaway. You are also told what else the researcher is interested in.

The proposal:
- The hypothesis must be falsifiable. refuteIf states the result that would count against it, concretely enough that someone could check it. confirmIf does the same for support.
- background contains only claims the given papers make. Cite them by putting their ids in paperIds. Use only ids from the list you were given. If a claim needs a paper the library does not have, leave it out and say in gap or risks what is missing.
- gap says what nobody in the given papers has shown yet, which is why the work is worth doing.
- Build on the researcher's premise and questions. Where you disagree with them or see a stronger version, say so in risks rather than silently replacing their idea.
- Write plainly, the way a researcher writes to a colleague. No marketing language.

The tasks:
- Each task has exactly one role: scout (finds missing literature), reader (extracts claims from papers), data (finds and checks data), runner (runs analyses or experiments), analyst (reads results against confirmIf and refuteIf), auditor (tries to break claims and checks citations), writer (drafts from audited claims only).
- dependsOn lists the ids of tasks that must finish first. Tasks with no dependency between them can run in parallel, so only add a dependency when the output is actually needed.
- Set checkpoint to true where a person must review before anything downstream runs: at minimum before compute or money is spent, and before claims are written up.
- doneWhen is a check someone could actually run, not a restatement of the goal.
- tools names what the agent needs: literature search, the lattice MCP server (which can read the researcher's library), PDF reading, code execution, file system.
- aimId is the id of the aim the task serves, or "" if it serves the whole project. paperIds are the given papers the task works from.
- Keep the plan as small as the work allows. Six to twelve tasks is typical.`;

function flat(text, limit) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/** The project as the model reads it. Papers go in with their ids so it can cite them. */
export function planRequest({ project, papers = [], questions = [], interests = [], notes = [] }) {
  const lines = [`Project: ${flat(project?.name, 200) || "Untitled"}`];
  if (project?.premise) lines.push(`Premise (what the researcher thinks might be true): ${flat(project.premise, 600)}`);
  if (questions.length) {
    lines.push("", "Open questions:");
    for (const question of questions.slice(0, 12)) {
      lines.push(`- ${flat(question.title, 300)}${question.detail ? ` (${flat(question.detail, 300)})` : ""}`);
    }
  }
  lines.push("", `Papers (${papers.length}). Cite these by id and no others:`);
  for (const paper of papers.slice(0, 60)) {
    const parts = [`[id: ${paper.id}] ${flat(paper.title, 220)}${paper.year ? ` (${paper.year})` : ""}`];
    if (paper.takeaway) parts.push(`  Researcher's takeaway: ${flat(paper.takeaway, 400)}`);
    if (paper.abstract) parts.push(`  Abstract: ${flat(paper.abstract, 900)}`);
    lines.push(parts.join("\n"));
  }
  if (notes.length) {
    lines.push("", "The researcher's notes on this project:");
    for (const note of notes.slice(0, 6)) lines.push(`- ${flat(note.title, 120)}: ${flat(note.body, 600)}`);
  }
  if (interests.length) {
    lines.push("", `Elsewhere in their library they are interested in: ${interests.slice(0, 12).map((item) => flat(item, 80)).join("; ")}.`);
  }
  lines.push("", "Write the proposal and the agent plan.");
  return lines.join("\n");
}

export class PlanError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function explain(error) {
  if (error instanceof Anthropic.AuthenticationError) return new PlanError("The Anthropic API key was rejected.", 401);
  if (error instanceof Anthropic.PermissionDeniedError) return new PlanError(`This API key can't use ${PLAN_MODEL}.`, 403);
  if (error instanceof Anthropic.NotFoundError) return new PlanError(`The model ${PLAN_MODEL} wasn't found. Set LATTICE_PLAN_MODEL.`, 404);
  if (error instanceof Anthropic.RateLimitError) return new PlanError("Claude is rate limited right now. Try again in a minute.", 429);
  if (error instanceof Anthropic.BadRequestError) return new PlanError(`Claude rejected the request: ${error.message}`, 400);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new PlanError("Claude took too long to answer. Try again.", 504);
  if (error instanceof Anthropic.APIConnectionError) return new PlanError("Couldn't reach Claude. Check the connection.", 502);
  if (error instanceof Anthropic.APIError) return new PlanError(`Claude returned an error (${error.status}).`, 502);
  return new PlanError(error instanceof Error ? error.message : "Something went wrong drafting the plan.", 500);
}

/** Drop citations to anything that was not sent, and count them. */
export function keepKnownCitations(plan, paperIds) {
  const known = new Set(paperIds);
  let dropped = 0;
  const keep = (ids) => {
    const kept = ids.filter((id) => known.has(id));
    dropped += ids.length - kept.length;
    return kept;
  };
  const kept = {
    ...plan,
    background: plan.background.map((claim) => ({ ...claim, paperIds: keep(claim.paperIds) })),
    tasks: plan.tasks.map((task) => ({ ...task, paperIds: keep(task.paperIds) })),
  };
  // Counted only after the filtering above has run.
  return { droppedCitations: dropped, plan: kept };
}

export function createPlanWriter({ client, model = PLAN_MODEL } = {}) {
  return {
    available: !!client,
    model,
    async draft(input, { signal } = {}) {
      if (!client) throw new PlanError("Drafting with Claude needs ANTHROPIC_API_KEY on the server.", 503);
      const papers = Array.isArray(input?.papers) ? input.papers : [];
      if (!input?.project?.name) throw new PlanError("Which project is this for?", 400);

      let message;
      try {
        message = await client.beta.messages.parse(
          {
            model,
            max_tokens: 16000,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
            output_config: { effort: "high", format: betaZodOutputFormat(PlanSchema) },
            system: PLAN_SYSTEM,
            messages: [{ role: "user", content: planRequest(input) }],
          },
          { signal, timeout: 300_000 }
        );
      } catch (error) {
        throw explain(error);
      }
      // A refusal that survived the fallback has no usable content.
      if (message.stop_reason === "refusal") {
        throw new PlanError("Claude declined to draft this plan.", 422);
      }
      const parsed = message.parsed_output;
      if (!parsed) {
        throw new PlanError(
          message.stop_reason === "max_tokens"
            ? "The plan was cut off before it finished. Try again."
            : "Claude's plan couldn't be read. Try again.",
          502
        );
      }
      const { plan, droppedCitations } = keepKnownCitations(parsed, papers.map((paper) => paper.id));
      return { plan, droppedCitations, model: message.model || model };
    },
  };
}

export function planWriterFromEnvironment() {
  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return createPlanWriter({ client: hasKey ? new Anthropic() : null });
}
