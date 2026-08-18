import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

import { fetchByDoi, looksLikeDoi } from "./crossref.js";
import { fetchByArxiv } from "./arxiv.js";
import {
  extractPdfText,
  findDoi,
  guessMetadata,
  abstractPreview,
  MAX_UPLOAD_BYTES,
} from "./parse.js";
import { explainHighlight, synthesizeNote, MOCK_MODE, MODEL } from "./ai.js";
import {
  addClipping,
  listClippings,
  markImported,
  deleteClipping,
} from "./clippings.js";

dotenv.config();

const PORT = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
if (process.env.NODE_ENV !== "production" || process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
}
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
    ].join("; "),
  });
  if (process.env.NODE_ENV === "production" && req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(express.json({ limit: "8mb" }));
app.use(express.static(CLIENT_DIST, {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

// Lightweight per-instance protection for endpoints that can trigger costly
// upstream/API work. A managed edge limiter should be added for multi-instance
// deployments; this still prevents accidental bursts on a single instance.
const requestBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const bucket = requestBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      requestBuckets.set(key, { startedAt: now, count: 1 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    next();
  };
}
const apiLimit = rateLimit({ windowMs: 60_000, max: 60 });
const aiLimit = rateLimit({ windowMs: 60_000, max: 12 });
app.use("/api", apiLimit);
app.use("/api/ai", aiLimit);

setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, bucket] of requestBuckets) {
    if (bucket.startedAt < cutoff) requestBuckets.delete(key);
  }
}, 60_000).unref();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, mockMode: MOCK_MODE, model: MODEL });
});

// ---------------------------------------------------------------------------
// Metadata by DOI (CrossRef)
// ---------------------------------------------------------------------------
app.post("/api/metadata/doi", async (req, res) => {
  const { doi = "" } = req.body || {};
  if (!doi.trim()) return res.status(400).json({ error: "Provide a DOI." });
  try {
    const paper = await fetchByDoi(doi);
    res.json({ paper });
  } catch (err) {
    console.error("doi error:", err.message);
    res.status(502).json({ error: err.message || "DOI lookup failed." });
  }
});

// ---------------------------------------------------------------------------
// Metadata by arXiv id / URL
// ---------------------------------------------------------------------------
app.post("/api/metadata/arxiv", async (req, res) => {
  const { id = "" } = req.body || {};
  if (!id.trim()) return res.status(400).json({ error: "Provide an arXiv id or URL." });
  try {
    const paper = await fetchByArxiv(id);
    res.json({ paper });
  } catch (err) {
    console.error("arxiv error:", err.message);
    res.status(502).json({ error: err.message || "arXiv lookup failed." });
  }
});

// ---------------------------------------------------------------------------
// Metadata from an uploaded PDF: extract text, then a DOI (-> CrossRef) or a
// first-page heuristic guess. Multipart field "file".
//
// NOTE: this endpoint returns metadata only. The PDF blob itself is stored
// client-side in IndexedDB and never uploaded to the server for persistence.
// ---------------------------------------------------------------------------
app.post("/api/metadata/pdf", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No PDF uploaded." });
  if (req.file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return res.status(415).json({ error: "The uploaded file is not a valid PDF." });
  }
  try {
    const text = await extractPdfText(req.file.buffer);
    if (!text || text.trim().length < 40) {
      return res.status(422).json({
        error:
          "Could not extract usable text from that PDF (it may be a scanned image). " +
          "You can still add it, but AI actions will have no text to work with. " +
          "Try a text-based PDF or add the paper by DOI instead.",
      });
    }

    const doi = findDoi(text);
    let paper;
    let via = "heuristic";

    if (doi && looksLikeDoi(doi)) {
      try {
        paper = await fetchByDoi(doi);
        via = "crossref";
      } catch {
        // Fall back to heuristics if CrossRef can't resolve the scraped DOI.
      }
    }

    if (!paper) {
      const guess = guessMetadata(text);
      paper = {
        title: guess.title || req.file.originalname.replace(/\.pdf$/i, ""),
        authors: guess.authors,
        year: null,
        venue: "",
        abstract: abstractPreview(text),
        doi: doi || "",
        url: "",
        source: "pdf",
      };
    }

    paper.source = "pdf";
    paper.pdfText = text.slice(0, 20000);

    res.json({ paper, via, filename: req.file.originalname, chars: text.length });
  } catch (err) {
    console.error("pdf error:", err.message);
    res.status(400).json({ error: err.message || "Failed to process the PDF." });
  }
});

// ---------------------------------------------------------------------------
// AI: explain a highlighted passage.
// Body: { text, context }
// ---------------------------------------------------------------------------
app.post("/api/ai/explain", async (req, res) => {
  const { text = "", context = "" } = req.body || {};
  if (typeof text !== "string" || typeof context !== "string") {
    return res.status(400).json({ error: "Text and context must be strings." });
  }
  if (text.length > 12_000 || context.length > 40_000) {
    return res.status(413).json({ error: "Selection or context is too large." });
  }
  try {
    const result = await explainHighlight(text, context);
    res.json(result);
  } catch (err) {
    console.error("explain error:", err.message);
    res.status(500).json({ error: err.message || "Explain failed." });
  }
});

// ---------------------------------------------------------------------------
// AI: synthesize a paper's highlights into a Markdown note.
// Body: { paperTitle, highlights: [{ text, note, page }] }
// ---------------------------------------------------------------------------
app.post("/api/ai/synthesize", async (req, res) => {
  const { paperTitle = "", highlights = [] } = req.body || {};
  if (typeof paperTitle !== "string" || !Array.isArray(highlights)) {
    return res.status(400).json({ error: "Invalid synthesis request." });
  }
  if (paperTitle.length > 1_000 || highlights.length > 250) {
    return res.status(413).json({ error: "Synthesis request is too large." });
  }
  try {
    const result = await synthesizeNote(paperTitle, highlights);
    res.json(result);
  } catch (err) {
    console.error("synthesize error:", err.message);
    res.status(500).json({ error: err.message || "Synthesize failed." });
  }
});

// ---------------------------------------------------------------------------
// Web clippings (browser extension -> app Inbox).
//
// The extension posts from a chrome-extension:// origin, so these routes carry
// their own permissive CORS regardless of the global CORS toggle. They only
// move small clipping records, never credentials or file bytes.
// ---------------------------------------------------------------------------
const clippingsCors = cors({ origin: true, methods: ["GET", "POST", "OPTIONS"] });
app.use("/api/clippings", clippingsCors);
app.options("/api/clippings", clippingsCors);
app.options("/api/clippings/:id/imported", clippingsCors);

// Save a clipping from the extension.
app.post("/api/clippings", async (req, res) => {
  try {
    const clipping = await addClipping(req.body || {});
    if (!clipping) return res.status(400).json({ error: "A clipping needs at least a URL." });
    res.status(201).json({ clipping });
  } catch (err) {
    console.error("clipping save error:", err.message);
    res.status(500).json({ error: "Could not save the clipping." });
  }
});

// List clippings. `?pending=1` returns only those not yet imported.
app.get("/api/clippings", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const pendingOnly = req.query.pending === "1" || req.query.pending === "true";
    const clippings = await listClippings({ pendingOnly });
    res.json({ clippings });
  } catch (err) {
    console.error("clipping list error:", err.message);
    res.status(500).json({ error: "Could not list clippings." });
  }
});

// Ack a clipping once the app has imported it into a collection.
app.post("/api/clippings/:id/imported", async (req, res) => {
  try {
    const clipping = await markImported(req.params.id);
    if (!clipping) return res.status(404).json({ error: "Clipping not found." });
    res.json({ clipping });
  } catch (err) {
    console.error("clipping ack error:", err.message);
    res.status(500).json({ error: "Could not update the clipping." });
  }
});

// Remove a clipping outright (a hard clear).
app.delete("/api/clippings/:id", async (req, res) => {
  try {
    const removed = await deleteClipping(req.params.id);
    if (!removed) return res.status(404).json({ error: "Clipping not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error("clipping delete error:", err.message);
    res.status(500).json({ error: "Could not delete the clipping." });
  }
});

// Multer errors (e.g. file too large).
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload failed: ${err.message}` });
  }
  next(err);
});

// SPA catch-all.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  const aiMode = MOCK_MODE ? "MOCK MODE — no API key" : `LIVE — ${MODEL}`;
  console.log(`lattice server on http://localhost:${PORT}  [AI: ${aiMode}]`);
});
