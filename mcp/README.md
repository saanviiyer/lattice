# lattice MCP server

Gives Claude read-only access to your lattice library, so a chat can be grounded in
the papers you have actually read and the notes you have actually written.

Ask *"using my lattice project Replay, what is the weakest link in this argument?"*
and Claude pulls the premise, the open questions, each paper with your own takeaway,
your notes, and what the project is still missing. Claude does not have to recall
the literature from training data.

## How it works

The lattice **desktop app** mirrors your whole workspace to a plain JSON file after
every change:

```
~/Library/Application Support/lattice/workspace/workspace.json
```

This server reads that file. It needs no sync service and no API key, because the
library is already on disk in a documented shape. The file is re-read whenever its
modification time moves, so edits you make in the app show up mid-conversation.

**It only reads.** There is no tool here that writes to your library.

> Requires the desktop app, which is what writes the mirror. A browser-only
> workspace keeps its data in that browser, where this server cannot reach it. Run
> the app once and the mirror appears.

## Build

```bash
npm run mcp:build
```

That produces one self-contained file at `mcp/dist/lattice-mcp.mjs`. Rebuild it
after changing the app, since the server imports lattice's own analysis modules
(`projectWorkspace`, `collectionTree`, `citations`, `librarySearch`) so its answers
match what the project page shows.

## Connect it to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lattice": {
      "command": "node",
      "args": ["/absolute/path/to/lattice/mcp/dist/lattice-mcp.mjs"]
    }
  }
}
```

Restart Claude Desktop. A tools icon appears in the composer.

## Connect it to Claude Code

```bash
claude mcp add lattice -- node /absolute/path/to/lattice/mcp/dist/lattice-mcp.mjs
```

## A second library, or a synced folder

Set `LATTICE_WORKSPACE` to the folder holding `workspace.json` (or to the file
itself):

```json
{
  "mcpServers": {
    "lattice": {
      "command": "node",
      "args": ["/absolute/path/to/lattice/mcp/dist/lattice-mcp.mjs"],
      "env": { "LATTICE_WORKSPACE": "/Users/you/Dropbox/lattice/workspace" }
    }
  }
}
```

## Tools

| Tool | What it returns |
| --- | --- |
| `list_projects` | The project tree, each with its premise, status, and how much is filed under it. Start here when a project is named. |
| `get_project` | One project in full: premise, questions with their evidence, papers with your takeaways, your notes, subprojects, and what it is still missing. |
| `search_library` | Papers, your notes, and your PDF highlights. Takes lattice's own filters (`author:`, `tag:`, `year:`, `status:`, `has:pdf`, `is:favorite`, `color:`). |
| `get_paper` | One paper: metadata, abstract, your takeaway, its projects, and every passage you highlighted with your notes on it. |
| `get_note` | One note in full, with the projects it belongs to. |
| `list_questions` | Open research questions across the library, flagging the ones with no evidence attached. |
| `get_plan` | A project's proposal and agent plan: question, hypothesis, what would support or count against it, and each task with its role, inputs, tools, hand-back, done-when check and review stops. With `task`, one task's brief. With no arguments, the list of proposals. |

Papers are always identified by their citation key, so anything Claude drafts can be
traced back to a record in your library. A title that Claude invents has no key to match.

## Tests

```bash
npm --prefix mcp test
```

Spawns the built server and speaks real JSON-RPC to it against a fixture workspace,
including a check that an edit made mid-session is picked up.
