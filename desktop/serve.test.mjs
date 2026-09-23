import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mimeFor, isApiRequest, apiTarget, resolveInDist, pdfPathFor } =
  require("./serve.cjs");

const DIST = "/app/client/dist";

test("mimeFor covers what the build emits, and falls back safely", () => {
  assert.equal(mimeFor("/a/index.html"), "text/html; charset=utf-8");
  assert.equal(mimeFor("/a/main.js"), "text/javascript; charset=utf-8");
  // pdf.js ships its worker as .mjs; serving it as octet-stream breaks the reader.
  assert.equal(mimeFor("/a/pdf.worker.min.mjs"), "text/javascript; charset=utf-8");
  assert.equal(mimeFor("/a/style.CSS"), "text/css; charset=utf-8");
  assert.equal(mimeFor("/a/font.woff2"), "font/woff2");
  assert.equal(mimeFor("/a/unknown.xyz"), "application/octet-stream");
});

test("isApiRequest matches the API prefix and nothing that merely starts with it", () => {
  assert.equal(isApiRequest("/api"), true);
  assert.equal(isApiRequest("/api/health"), true);
  assert.equal(isApiRequest("/api/doi/10.1/x"), true);
  assert.equal(isApiRequest("/apiary"), false);
  assert.equal(isApiRequest("/"), false);
  assert.equal(isApiRequest("/assets/index.js"), false);
});

test("apiTarget keeps the prefix, the path, and the query", () => {
  assert.equal(
    apiTarget("http://127.0.0.1:51234", "/api/arxiv", "?id=1706.03762"),
    "http://127.0.0.1:51234/api/arxiv?id=1706.03762"
  );
  assert.equal(apiTarget("http://127.0.0.1:1/", "/api/health"), "http://127.0.0.1:1/api/health");
});

test("resolveInDist serves index.html for the root", () => {
  assert.equal(resolveInDist(DIST, "/"), path.join(DIST, "index.html"));
  assert.equal(resolveInDist(DIST, ""), path.join(DIST, "index.html"));
});

test("resolveInDist resolves a normal asset", () => {
  assert.equal(
    resolveInDist(DIST, "/assets/index-abc123.js"),
    path.join(DIST, "assets", "index-abc123.js")
  );
});

test("resolveInDist refuses to escape the build directory", () => {
  assert.equal(resolveInDist(DIST, "/../../../../etc/passwd"), null);
  assert.equal(resolveInDist(DIST, "/assets/../../../secret"), null);
  // Percent-encoded traversal is the same attack wearing a hat.
  assert.equal(resolveInDist(DIST, "/%2e%2e/%2e%2e/etc/passwd"), null);
});

test("resolveInDist rejects a malformed escape and an embedded null byte", () => {
  assert.equal(resolveInDist(DIST, "/%E0%A4%A"), null);
  assert.equal(resolveInDist(DIST, "/a%00b"), null);
});

test("resolveInDist allows a path that only looks like traversal", () => {
  assert.equal(
    resolveInDist(DIST, "/assets/a/../b.js"),
    path.join(DIST, "assets", "b.js")
  );
});

test("pdfPathFor accepts a plain id and refuses anything else", () => {
  assert.equal(pdfPathFor("/ws", "abc123"), path.join("/ws", "pdfs", "abc123.pdf"));
  assert.equal(pdfPathFor("/ws", "a-b_C9"), path.join("/ws", "pdfs", "a-b_C9.pdf"));
  assert.equal(pdfPathFor("/ws", "../../etc/passwd"), null);
  assert.equal(pdfPathFor("/ws", "a/b"), null);
  assert.equal(pdfPathFor("/ws", ""), null);
  assert.equal(pdfPathFor("/ws", "a".repeat(129)), null);
  assert.equal(pdfPathFor("/ws", 42), null);
});
