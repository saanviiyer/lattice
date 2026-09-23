import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { startServer } from "./rpc.mjs";
import { writeFixture } from "./fixture.mjs";

const fixture = await writeFixture();

async function withServer(fn, env = { LATTICE_WORKSPACE: fixture.workspace }) {
  const client = startServer(env);
  try {
    await client.initialize();
    return await fn(client);
  } finally {
    client.stop();
  }
}

test("advertises its tools", async () => {
  await withServer(async (client) => {
    const names = (await client.listTools()).map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "get_note", "get_paper", "get_plan", "get_project", "list_projects", "list_questions", "search_library",
    ]);
  });
});

test("list_projects shows the tree, the premise, and what is filed under each", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("list_projects");
    assert.match(out, /\*\*Replay\*\* \(active\)/);
    assert.match(out, /Premise: Replay during quiet rest consolidates the memory\./);
    // The subproject is indented under its parent.
    assert.match(out, /\n {2}- \*\*Ripple detection\*\*/);
    // Replay's count rolls its subproject in: both papers, one note, two questions.
    assert.match(out, /\*\*Replay\*\* \(active\) — 2 papers, 1 notes, 2 questions/);
  });
});

test("get_project finds a project by partial name and grounds the answer", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("get_project", { project: "ripple det" });
    assert.match(out, /# Research project: Ripple detection/);
    assert.match(out, /_Part of: Replay_/);
  });
});

test("get_project carries the premise, takeaways, and evidence per question", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("get_project", { project: "Replay" });
    assert.match(out, /Replay during quiet rest consolidates the memory\./);
    assert.match(out, /My takeaway: Ripple rate predicts next-day recall\./);
    assert.match(out, /\*\*Does replay cause consolidation\?\*\* \(exploring\) — evidence: Lovelace2019sharp/);
    assert.match(out, /\*\*Is the effect sleep-specific\?\*\* \(open\) — _no evidence attached yet_/);
    // It tells the model what the project is missing, not only what it has.
    assert.match(out, /What this project is still missing/);
  });
});

test("get_project names the projects that exist when the name does not match", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("get_project", { project: "nonexistent" });
    assert.match(out, /No project matching "nonexistent"/);
    assert.match(out, /Replay, Ripple detection, Methods/);
  });
});

test("search_library covers papers, the user's notes, and their highlights", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("search_library", { query: "ripple" });
    assert.match(out, /## Papers \(1\)/);
    assert.match(out, /Sharp-wave ripples during quiet rest/);
    assert.match(out, /## The user's notes \(1\)/);
    assert.match(out, /Synthesis/);
    assert.match(out, /## Passages the user highlighted \(1\)/);
    assert.match(out, /Their note: This is the number to reproduce\./);
  });
});

test("search_library honours the app's own field filters", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("search_library", { query: "author:hopper", kinds: ["papers"] });
    assert.match(out, /## Papers \(1\)/);
    assert.match(out, /Decoding population spike trains/);
    assert.doesNotMatch(out, /Sharp-wave ripples/);
  });
});

test("search_library can be narrowed to one kind", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("search_library", { query: "ripple", kinds: ["highlights"] });
    assert.doesNotMatch(out, /## Papers/);
    assert.match(out, /## Passages the user highlighted/);
  });
});

test("get_paper resolves by citation key and returns highlights with their notes", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("get_paper", { paper: "Lovelace2019sharp" });
    assert.match(out, /# Sharp-wave ripples during quiet rest/);
    assert.match(out, /Filed in: Replay/);
    assert.match(out, /The user's takeaway/);
    assert.match(out, /Ripple rate predicts next-day recall\./);
    assert.match(out, /p\.4: "Ripple density during rest correlated/);
  });
});

test("get_paper resolves by arXiv id and says when no takeaway exists", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("get_paper", { paper: "1701.00001" });
    assert.match(out, /# Decoding population spike trains/);
    assert.match(out, /_They have not written one yet\._/);
    // Filed in two projects, one of them nested.
    assert.match(out, /Filed in: Replay \/ Ripple detection; Methods/);
  });
});

test("get_note returns the user's own words with its projects", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("get_note", { note: "Synthesis" });
    assert.match(out, /# Synthesis/);
    assert.match(out, /Filed in: Replay/);
    assert.match(out, /The causal claim rests on ripple timing\./);
  });
});

test("list_questions flags the questions with nothing behind them", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("list_questions");
    assert.match(out, /\*\*Does replay cause consolidation\?\*\* \(exploring\) · in Replay · evidence: Lovelace2019sharp/);
    assert.match(out, /\*\*Is the effect sleep-specific\?\*\* \(open\) · in Replay · \*\*no evidence attached\*\*/);
  });
});

test("list_questions can be filtered by status", async () => {
  await withServer(async (client) => {
    const out = await client.callTool("list_questions", { status: "open" });
    assert.match(out, /Is the effect sleep-specific/);
    assert.doesNotMatch(out, /Does replay cause consolidation/);
  });
});

test("picks up edits made while the conversation is running", async () => {
  await withServer(async (client) => {
    const before = await client.callTool("list_projects");
    assert.doesNotMatch(before, /Added mid-session/);

    const edited = structuredClone(fixture.snapshot);
    edited.collections.push({
      id: "new", name: "Added mid-session", parentId: null,
      createdAt: "2026-01-02T00:00:00.000Z", color: "blue",
    });
    // mtime resolution is coarse enough that an immediate rewrite can look unchanged.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(fixture.file, JSON.stringify(edited, null, 2));

    const after = await client.callTool("list_projects");
    assert.match(after, /Added mid-session/);
  });
  // Put the fixture back for any later run.
  await writeFile(fixture.file, JSON.stringify(fixture.snapshot, null, 2));
});

test("explains itself when there is no workspace to read", async () => {
  await withServer(async (client) => {
    const response = await client.callTool("list_projects").catch((error) => String(error));
    assert.match(response, /No lattice workspace found|Looked in/);
  }, { LATTICE_WORKSPACE: "/nonexistent/lattice/workspace" });
});

test("get_plan lists proposals, returns the agent plan, and one task's brief", async () => {
  await withServer(async (client) => {
    const list = await client.callTool("get_plan");
    assert.match(list, /\*\*Replay\*\* \(project: Replay\) — 2 tasks, 2 checkpoints/);

    const brief = await client.callTool("get_plan", { plan: "replay" });
    assert.match(brief, /# Agent plan: Replay/);
    assert.match(brief, /\*\*Counts against it:\*\* Recall is unchanged/);
    assert.match(brief, /## Stage 1\n\n### scout: Find what is missing/);
    assert.match(brief, /## Stage 2\n\n### run-1: Run aim 1/);
    assert.match(brief, /Checkpoint:\*\* stop here/);

    const task = await client.callTool("get_plan", { plan: "Replay", task: "run-1" });
    assert.match(task, /^You are the experiment runner on "Replay"\./);
    assert.match(task, /This task serves the aim: Block ripples\./);

    const missing = await client.callTool("get_plan", { plan: "Replay", task: "nope" });
    assert.match(missing, /Its tasks are: scout, run-1\./);
  });
});
