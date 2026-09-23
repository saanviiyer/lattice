// Bundle the MCP server into one self-contained ESM file.
//
// It imports the app's own analysis modules straight out of client/src, so a
// bundle step is what makes that possible: the sources are TypeScript, and the
// result has to be a plain file a person can point Claude Desktop at without
// knowing anything about this repo's layout.
//
// The SDK is bundled in too. One file, `node dist/lattice-mcp.mjs`, no install
// step at the far end.

import { build } from "esbuild";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist", "lattice-mcp.mjs");

await build({
  entryPoints: [path.join(ROOT, "src", "index.ts")],
  outfile: OUT,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Node builtins some dependencies reach for through createRequire.
  banner: {
    js: "import { createRequire as __lat_cr } from 'node:module';\nconst require = __lat_cr(import.meta.url);",
  },
  logLevel: "info",
});

// So it can be run directly as well as through node.
await chmod(OUT, 0o755);
console.log(`built ${OUT}`);
