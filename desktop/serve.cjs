// serve.cjs - how the desktop shell turns a request into a file or a proxy.
//
// No Electron import, so it can be tested in plain Node. The parts worth testing are
// exactly the parts that would be security bugs if they were wrong: which paths are
// allowed out of the built client, and which requests go to the embedded API instead
// of to the filesystem.

const path = require("node:path");

/** MIME types for what a Vite build of lattice actually emits. */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

/** The content type to serve a file as. */
function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

const API_PREFIX = "/api";

/** Whether a request should go to the embedded Express API rather than to disk. */
function isApiRequest(pathname) {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

/**
 * The localhost URL a proxied API request maps to. The prefix is kept, because the
 * embedded server mounts its routes under /api exactly as the web build does.
 */
function apiTarget(origin, pathname, search = "") {
  return `${origin.replace(/\/+$/, "")}${pathname}${search}`;
}

/**
 * Resolve a request path to a file inside `distRoot`, or null if it would escape.
 *
 * The containment check is the whole point. Without it the renderer could ask for
 * `lattice://app/../../../../etc/passwd` and the shell would read it off the user's
 * disk and hand it back.
 */
function resolveInDist(distRoot, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    // A malformed escape sequence is not a path worth guessing at.
    return null;
  }
  rel = rel.replace(/^\/+/, "");
  // A null byte truncates a path in some syscalls; never let one through.
  if (rel.includes("\0")) return null;
  const root = path.resolve(distRoot);
  const target = path.resolve(root, rel || "index.html");
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/**
 * Where a paper's PDF lives inside the workspace folder.
 *
 * Ids come from the renderer, so they are treated as untrusted: anything that is not
 * a plain id is rejected rather than sanitized, because a "cleaned" path that still
 * resolves somewhere unexpected is worse than a refusal.
 */
function pdfPathFor(workspaceDir, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return path.join(workspaceDir, "pdfs", `${id}.pdf`);
}

module.exports = {
  MIME,
  mimeFor,
  isApiRequest,
  apiTarget,
  resolveInDist,
  pdfPathFor,
  API_PREFIX,
};
