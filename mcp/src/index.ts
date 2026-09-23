// The lattice MCP server.
//
// Exposes a lattice library to Claude (and any other MCP client) over stdio, so a
// chat can be grounded in the papers you have actually read and the notes you have
// actually written, instead of in the model's recollection of the literature.
//
// It imports the app's own analysis modules directly — projectWorkspace,
// collectionTree, citations, librarySearch — rather than reimplementing them. What
// a tool reports about a project is therefore the same thing the project page
// shows, and stays that way when the app changes.
//
// Read-only by design. See workspace.ts.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { planAsAgentBrief, taskBrief } from "../../client/src/lib/researchPlan";

import type { Note, Paper } from "../../client/src/types";
import { citationKey } from "../../client/src/lib/citations";
import {
  buildCollectionTree,
  collectionPath,
  flattenCollectionTree,
} from "../../client/src/lib/collectionTree";
import { matchesLibraryQuery } from "../../client/src/lib/librarySearch";
import { projectAsContext } from "../../client/src/lib/projectContext";
import {
  projectContents,
  projectGaps,
  projectPulse,
} from "../../client/src/lib/projectWorkspace";
import { findProject, loadWorkspace, workspacePaths } from "./workspace";

const MAX_RESULTS = 50;

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/** One line describing a paper, used wherever a list of papers is returned. */
function paperSummary(paper: Paper): string {
  const authors =
    paper.authors.length > 3
      ? `${paper.authors.slice(0, 3).join(", ")} et al.`
      : paper.authors.join(", ") || "Unknown author";
  const where = [paper.venue, paper.year].filter(Boolean).join(", ");
  const status =
    paper.readingStatus === "read"
      ? "read"
      : paper.readingStatus === "reading"
      ? "in progress"
      : "unread";
  const lines = [
    `- **${paper.title || "Untitled"}** — ${authors}${where ? ` (${where})` : ""} [${citationKey(paper)}] · ${status}`,
  ];
  if (paper.takeaway?.trim()) lines.push(`  - My takeaway: ${paper.takeaway.trim()}`);
  return lines.join("\n");
}

function noteSummary(note: Note): string {
  const firstLine =
    note.body
      .split("\n")
      .map((line) => line.replace(/^[#>\-*\s]+/, "").trim())
      .find(Boolean) || "empty";
  return `- **${note.title || "Untitled note"}** — ${firstLine.slice(0, 140)}`;
}

const server = new Server(
  { name: "lattice", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "list_projects",
    description:
      "List the research projects in the lattice library, as a tree with each project's premise, status, and how much is filed under it. Start here when the user refers to a project by name.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_project",
    description:
      "Everything in one lattice project: its premise, open questions and which papers are evidence for each, every paper with the user's own takeaway, the user's notes, subprojects, and what the project is still missing. Use this to ground any discussion of a project the user names.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or id. Partial names match." },
        include_notes: {
          type: "boolean",
          description: "Include the full text of the user's notes. Default true.",
        },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "search_library",
    description:
      "Search the whole lattice library — papers, the user's notes, and their PDF highlights. Supports the app's own filters: author:, tag:, year:, status:, has:pdf, is:favorite, color:. Use this to find what the user already has on a topic before suggesting they read something new.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text, optionally with field filters." },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["papers", "notes", "highlights"] },
          description: "What to search. Defaults to all three.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_paper",
    description:
      "One paper in full: metadata, abstract, the user's takeaway, which projects it is filed in, and every highlight they made in it with their notes on those highlights.",
    inputSchema: {
      type: "object",
      properties: {
        paper: { type: "string", description: "Paper id, citation key, DOI, arXiv id, or title." },
      },
      required: ["paper"],
      additionalProperties: false,
    },
  },
  {
    name: "get_note",
    description: "The full text of one of the user's notes, with the projects it belongs to.",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string", description: "Note id or title. Partial titles match." } },
      required: ["note"],
      additionalProperties: false,
    },
  },
  {
    name: "get_plan",
    description:
      "The user's research proposal for a project and its agent plan: the question, the hypothesis, what result would support or count against it, and every task with its role, inputs, tools, what to hand back, how to tell it is done, and whether it stops for the user's review. Pass a task id to get that one task's brief. Read this before doing any work on a plan, and stop at every checkpoint it marks.",
    inputSchema: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "Proposal title, project name, or id. Partial names match. Omit to list the proposals.",
        },
        task: { type: "string", description: "A task id from the plan, such as run-1, for that task's brief alone." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_questions",
    description:
      "The user's open research questions across the whole library, with how much evidence each has attached. Questions with no evidence are the ones worth talking about.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "exploring", "resolved"] },
      },
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const workspace = await loadWorkspace();
  const { papers, notes, questions, collections, highlights } = workspace;

  if (name === "list_projects") {
    if (collections.length === 0) {
      return text("This library has no projects yet.");
    }
    const rows = flattenCollectionTree(buildCollectionTree(collections));
    const lines = ["# Projects in this lattice library", ""];
    for (const { collection, depth } of rows) {
      const contents = projectContents(collection, collections, papers, notes, questions);
      const indent = "  ".repeat(depth);
      lines.push(
        `${indent}- **${collection.name}** (${collection.status || "idea"}) — ` +
          `${contents.papers.length} papers, ${contents.notes.length} notes, ${contents.questions.length} questions`
      );
      if (collection.premise?.trim()) {
        lines.push(`${indent}  - Premise: ${collection.premise.trim()}`);
      }
    }
    return text(lines.join("\n"));
  }

  if (name === "get_project") {
    const project = findProject(collections, String(args.project || ""));
    if (!project) {
      const available = collections.map((c) => c.name).join(", ") || "none";
      return text(`No project matching "${args.project}". Projects in this library: ${available}.`);
    }
    // The same rendering the app's "Copy for chat" button produces, so what the
    // model sees and what the user sees are the same document.
    const body = projectAsContext(project, collections, papers, notes, questions, {
      noteLimit: args.include_notes === false ? 0 : 4000,
    });
    return text(body);
  }

  if (name === "search_library") {
    const query = String(args.query || "").trim();
    if (!query) return text("Provide something to search for.");
    const kinds = new Set<string>(
      Array.isArray(args.kinds) && args.kinds.length
        ? (args.kinds as string[])
        : ["papers", "notes", "highlights"]
    );
    const needle = query.toLowerCase();
    const sections: string[] = [];

    if (kinds.has("papers")) {
      const hits = papers.filter((paper) => matchesLibraryQuery(paper, query)).slice(0, MAX_RESULTS);
      sections.push(
        `## Papers (${hits.length})`,
        hits.length ? hits.map(paperSummary).join("\n") : "_No matching papers._"
      );
    }

    if (kinds.has("notes")) {
      // Field filters are a paper concept; notes match on their own text.
      const hits = notes
        .filter(
          (note) =>
            note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle)
        )
        .slice(0, MAX_RESULTS);
      sections.push(
        "",
        `## The user's notes (${hits.length})`,
        hits.length ? hits.map(noteSummary).join("\n") : "_No matching notes._"
      );
    }

    if (kinds.has("highlights")) {
      const byPaper = new Map(papers.map((paper) => [paper.id, paper]));
      const hits = highlights
        .filter(
          (highlight) =>
            highlight.text.toLowerCase().includes(needle) ||
            (highlight.note || "").toLowerCase().includes(needle)
        )
        .slice(0, MAX_RESULTS);
      sections.push(
        "",
        `## Passages the user highlighted (${hits.length})`,
        hits.length
          ? hits
              .map((highlight) => {
                const paper = byPaper.get(highlight.paperId);
                const source = paper ? `${citationKey(paper)} p.${highlight.page}` : `p.${highlight.page}`;
                const note = highlight.note?.trim();
                return `- "${highlight.text.trim().slice(0, 300)}" — ${source}${note ? `\n  - Their note: ${note}` : ""}`;
              })
              .join("\n")
          : "_No matching highlights._"
      );
    }

    return text(sections.join("\n"));
  }

  if (name === "get_paper") {
    const needle = String(args.paper || "").trim().toLowerCase();
    const paper =
      papers.find((item) => item.id === args.paper) ||
      papers.find((item) => citationKey(item).toLowerCase() === needle) ||
      papers.find((item) => (item.doi || "").toLowerCase() === needle) ||
      papers.find((item) => (item.arxivId || "").toLowerCase() === needle) ||
      papers.find((item) => item.title.toLowerCase().includes(needle));
    if (!paper) return text(`No paper matching "${args.paper}" is in this library.`);

    const filedIn = paper.collectionIds
      .map((id) => collectionPath(collections, id).join(" / "))
      .filter(Boolean);
    const mine = highlights.filter((highlight) => highlight.paperId === paper.id);
    const lines = [
      `# ${paper.title || "Untitled"}`,
      "",
      `- Authors: ${paper.authors.join(", ") || "unknown"}`,
      `- Published: ${[paper.venue, paper.year].filter(Boolean).join(", ") || "unknown"}`,
      `- Citation key: ${citationKey(paper)}`,
      paper.doi ? `- DOI: ${paper.doi}` : "",
      paper.arxivId ? `- arXiv: ${paper.arxivId}` : "",
      `- Reading status: ${paper.readingStatus || "inbox"}`,
      `- Filed in: ${filedIn.join("; ") || "no project"}`,
      paper.tags.length ? `- Tags: ${paper.tags.join(", ")}` : "",
      "",
      "## The user's takeaway",
      paper.takeaway?.trim() || "_They have not written one yet._",
      "",
      "## Abstract",
      paper.abstract?.trim() || "_Not captured._",
      "",
      `## Passages they highlighted (${mine.length})`,
      mine.length
        ? mine
            .map((highlight) => {
              const note = highlight.note?.trim();
              return `- p.${highlight.page}: "${highlight.text.trim()}"${note ? `\n  - Their note: ${note}` : ""}`;
            })
            .join("\n")
        : "_None._",
    ];
    return text(lines.filter((line) => line !== "").join("\n"));
  }

  if (name === "get_note") {
    const needle = String(args.note || "").trim().toLowerCase();
    const note =
      notes.find((item) => item.id === args.note) ||
      notes.find((item) => item.title.toLowerCase() === needle) ||
      notes.find((item) => item.title.toLowerCase().includes(needle));
    if (!note) return text(`No note matching "${args.note}" is in this library.`);
    const filedIn = (note.collectionIds || [])
      .map((id) => collectionPath(collections, id).join(" / "))
      .filter(Boolean);
    return text(
      [
        `# ${note.title || "Untitled note"}`,
        `_Written by the user. Filed in: ${filedIn.join("; ") || "no project"}. Last edited ${note.updatedAt.slice(0, 10)}._`,
        "",
        note.body.trim() || "_Empty._",
      ].join("\n")
    );
  }

  if (name === "get_plan") {
    const { plans } = workspace;
    if (!plans.length) return text("There are no proposals in this library yet. The user drafts them from a project page in lattice.");
    const projectName = (id: string | null) => (id ? collections.find((c) => c.id === id)?.name : undefined);
    if (!args.plan) {
      return text(
        [
          "# Proposals in this lattice library",
          "",
          ...plans.map(
            (plan) =>
              `- **${plan.title}**${projectName(plan.projectId) ? ` (project: ${projectName(plan.projectId)})` : ""} — ` +
              `${plan.tasks.length} tasks, ${plan.tasks.filter((task) => task.checkpoint).length} checkpoints · id ${plan.id}`
          ),
        ].join("\n")
      );
    }
    const needle = String(args.plan).trim().toLowerCase();
    const plan =
      plans.find((item) => item.id === args.plan) ||
      plans.find((item) => item.title.toLowerCase() === needle) ||
      plans.find((item) => (projectName(item.projectId) || "").toLowerCase() === needle) ||
      plans.find((item) => item.title.toLowerCase().includes(needle)) ||
      plans.find((item) => (projectName(item.projectId) || "").toLowerCase().includes(needle));
    if (!plan) return text(`No proposal matching "${args.plan}". Call get_plan with no arguments to list them.`);
    if (args.task) {
      const task = plan.tasks.find((item) => item.id === String(args.task).trim());
      if (!task) {
        return text(`"${plan.title}" has no task "${args.task}". Its tasks are: ${plan.tasks.map((item) => item.id).join(", ")}.`);
      }
      return text(taskBrief(plan, task, papers));
    }
    return text(planAsAgentBrief(plan, papers));
  }

  if (name === "list_questions") {
    const wanted = args.status ? String(args.status) : null;
    const shown = questions.filter((question) => !wanted || question.status === wanted);
    if (shown.length === 0) return text("No research questions recorded in this library.");
    const byId = new Map(papers.map((paper) => [paper.id, paper]));
    const lines = ["# Open research questions", ""];
    for (const question of shown) {
      const evidence = question.linkedPaperIds
        .map((id) => byId.get(id))
        .filter((paper): paper is Paper => !!paper);
      const projects = (question.collectionIds || [])
        .map((id) => collectionPath(collections, id).join(" / "))
        .filter(Boolean);
      lines.push(
        `- **${question.title}** (${question.status})` +
          (projects.length ? ` · in ${projects.join("; ")}` : "") +
          (evidence.length
            ? ` · evidence: ${evidence.map((paper) => citationKey(paper)).join(", ")}`
            : " · **no evidence attached**")
      );
      if (question.detail.trim()) lines.push(`  - ${question.detail.trim()}`);
    }
    return text(lines.join("\n"));
  }

  return text(`Unknown tool: ${name}`);
});

async function main() {
  // A stray console.log would corrupt the JSON-RPC stream on stdout, so anything
  // diagnostic has to go to stderr.
  console.error(`lattice-mcp: reading ${workspacePaths().join(" or ")}`);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("lattice-mcp failed to start:", error);
  process.exit(1);
});
