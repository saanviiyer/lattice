import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { createPlanWriter, keepKnownCitations, planRequest, PlanSchema } from "./plan.js";

const input = {
  project: { name: "Heading through occlusion", premise: "A ring attractor keeps heading." },
  papers: [
    { id: "p1", title: "Head direction cells", year: 1996, takeaway: "A ring holds heading.", abstract: "We model..." },
    { id: "p2", title: "DreamerV3", year: 2023, abstract: "World models." },
  ],
  questions: [{ title: "Does it survive 2 s of occlusion?", detail: "Heading error" }],
  interests: ["Reinforcement learning"],
};

function plan(overrides = {}) {
  return {
    title: "T", question: "Q", hypothesis: "H", gap: "G", approach: "A", confirmIf: "C", refuteIf: "R",
    risks: [], aims: [{ id: "aim-1", title: "Aim", detail: "" }],
    background: [{ text: "Claim", paperIds: ["p1", "made-up"] }],
    tasks: [{
      id: "scout", title: "Scout", role: "scout", goal: "g", inputs: [], tools: [], output: "o",
      doneWhen: "d", dependsOn: [], checkpoint: true, aimId: "", paperIds: ["p2", "ghost"],
    }],
    ...overrides,
  };
}

function standIn(response) {
  const calls = [];
  return {
    calls,
    client: {
      beta: {
        messages: {
          parse: async (params, options) => {
            calls.push({ params, options });
            if (response instanceof Error) throw response;
            return response;
          },
        },
      },
    },
  };
}

test("sends the project with paper ids, on Opus 5 with fallbacks and a schema", async () => {
  const { client, calls } = standIn({ stop_reason: "end_turn", parsed_output: plan(), model: "claude-opus-5" });
  const writer = createPlanWriter({ client });
  const result = await writer.draft(input);

  const { params, options } = calls[0];
  assert.equal(params.model, "claude-opus-5");
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(params.fallbacks, "default");
  assert.equal(params.output_config.effort, "high");
  assert.ok(params.output_config.format, "structured output format is set");
  assert.equal("temperature" in params, false);
  assert.equal(params.messages.length, 1);
  assert.equal(params.messages[0].role, "user");
  assert.match(params.messages[0].content, /\[id: p1\] Head direction cells \(1996\)/);
  assert.match(params.messages[0].content, /Researcher's takeaway: A ring holds heading\./);
  assert.match(params.messages[0].content, /interested in: Reinforcement learning/);
  assert.equal(options.timeout, 300_000);

  // Citations to papers that were never sent are removed and counted.
  assert.deepEqual(result.plan.background[0].paperIds, ["p1"]);
  assert.deepEqual(result.plan.tasks[0].paperIds, ["p2"]);
  assert.equal(result.droppedCitations, 2);
  assert.equal(result.model, "claude-opus-5");
});

test("a refusal that survives the fallback is reported, not parsed", async () => {
  const { client } = standIn({ stop_reason: "refusal", parsed_output: null });
  await assert.rejects(createPlanWriter({ client }).draft(input), (error) => error.status === 422);
});

test("a cut-off response says so", async () => {
  const { client } = standIn({ stop_reason: "max_tokens", parsed_output: null });
  await assert.rejects(createPlanWriter({ client }).draft(input), /cut off/);
});

test("API errors become messages a person can act on", async () => {
  const rateLimited = new Anthropic.RateLimitError(429, { error: { message: "slow down" } }, "slow down", new Headers());
  const { client } = standIn(rateLimited);
  await assert.rejects(createPlanWriter({ client }).draft(input), (error) => error.status === 429 && /rate limited/.test(error.message));
});

test("without a key it says what is needed instead of calling anything", async () => {
  const writer = createPlanWriter({ client: null });
  assert.equal(writer.available, false);
  await assert.rejects(writer.draft(input), (error) => error.status === 503);
});

test("the schema accepts a full plan and rejects an unknown role", () => {
  assert.equal(PlanSchema.safeParse(plan()).success, true);
  const bad = plan({ tasks: [{ ...plan().tasks[0], role: "wizard" }] });
  assert.equal(PlanSchema.safeParse(bad).success, false);
});

test("the request caps what it sends", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, title: `Paper ${i}` }));
  const text = planRequest({ ...input, papers: many });
  assert.match(text, /Papers \(80\)/);
  assert.match(text, /\[id: p59\]/);
  assert.doesNotMatch(text, /\[id: p60\]/);
  assert.deepEqual(keepKnownCitations(plan({ background: [], tasks: [] }), []).droppedCitations, 0);
});
