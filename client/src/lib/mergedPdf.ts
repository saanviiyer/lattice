// Combine a project's papers into one PDF — a reading dossier you can put on a
// tablet, print, or hand to somebody who does not run lattice.
//
// A bare concatenation of forty papers is close to useless: nothing marks where one
// paper ends and the next begins, and there is no way to reach paper 26 except by
// scrolling. So the output is built like a bound volume — a cover, a contents page
// with real page numbers, a divider before each paper carrying its citation and your
// own takeaway, and a PDF outline so a reader can jump straight to a paper.
//
// It is also honest about what it left out. Papers with no PDF, and files that would
// not open, are listed on the contents page rather than silently dropped: a dossier
// that quietly omits six papers is worse than one that says which six are missing.

import type { Highlight, Paper } from "../types";
import { getPdf } from "./blobStore";
import { createAnnotatedPdf } from "./annotatedPdf";

// A4. Dividers and front matter are generated at this size; the papers themselves keep
// whatever size they were, which readers handle fine and reflowing would degrade.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 64;

const INK: [number, number, number] = [0.06, 0.09, 0.16];
const MUTED: [number, number, number] = [0.35, 0.41, 0.49];
const ACCENT: [number, number, number] = [0.05, 0.45, 0.56];

const CONTENTS_LINE = 20;
const CONTENTS_TOP = PAGE_H - MARGIN - 34;
const CONTENTS_BOTTOM = MARGIN + 30;
const CONTENTS_CAPACITY = Math.floor((CONTENTS_TOP - CONTENTS_BOTTOM) / CONTENTS_LINE);

export interface MergeProgress {
  done: number;
  total: number;
  current: string;
}

/**
 * A group of papers bound under its own heading: a project, a subproject, or the
 * papers filed nowhere. A paper that sits in two groups is bound once, where it first
 * appears, and the later group points back to it rather than doubling the file.
 */
export interface MergeSection {
  title: string;
  /** 0 for a project, 1 for a subproject, and so on. */
  depth: number;
  /** Printed small above the title, e.g. "PROJECT". */
  label?: string;
  /** Where it sits, e.g. "Proteins / Folding", printed above the title. */
  context?: string;
  premise?: string;
  papers: Paper[];
}

export interface MergeResult {
  blob: Blob;
  /** Papers actually bound in, with the 1-based page their divider lands on. */
  included: { paper: Paper; page: number; pages: number }[];
  /** In the project, but with no PDF attached. */
  missing: Paper[];
  /** Had a PDF that could not be read. */
  failed: { paper: Paper; reason: string }[];
  totalPages: number;
  /** Each section with the page its heading lands on. Empty for an ungrouped merge. */
  sections: { title: string; depth: number; page: number; papers: number }[];
}

export interface MergeOptions {
  title: string;
  premise?: string;
  /** Burn the reader's own highlights into each paper before binding it in. */
  includeHighlights?: boolean;
  highlightsFor?: (paperId: string) => Highlight[];
  onProgress?: (progress: MergeProgress) => void;
}

function citation(paper: Paper): string {
  const authors =
    paper.authors.length > 3
      ? `${paper.authors[0]} et al.`
      : paper.authors.join(", ") || "Unknown author";
  return [authors, paper.year, paper.venue].filter(Boolean).join(" · ");
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on the whole document rather
 * than skipping a glyph they cannot encode. Paper titles routinely carry curly quotes,
 * en dashes, Greek and accented names, so text is folded down before it is drawn.
 */
function toWinAnsi(text: string): string {
  return String(text || "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -​  　]/g, " ")
    .replace(/[·•]/g, "·")
    .normalize("NFKD")
    // Drop combining marks, so "é" becomes "e" instead of failing to encode.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E·]/g, "");
}

function wrap(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // A single word wider than the column would loop forever; let it overhang.
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildMergedPdf(
  papers: Paper[],
  options: MergeOptions
): Promise<MergeResult> {
  return bind([{ title: "", depth: 0, papers }], options);
}

/** The same volume, but with a heading page and contents entry for every section. */
export async function buildGroupedPdf(
  sections: MergeSection[],
  options: MergeOptions
): Promise<MergeResult> {
  return bind(sections, options);
}

// A line of the contents. Positions are kept relative to the body until the number
// of contents pages is known, for the same reason as the papers' own positions.
type ContentsItem =
  | { kind: "section"; title: string; depth: number; bodyIndex: number }
  | { kind: "paper"; number: number; title: string; depth: number; bodyIndex: number; repeat?: boolean }
  | { kind: "gap" };

async function bind(sections: MergeSection[], options: MergeOptions): Promise<MergeResult> {
  const pdfLib = await import("pdf-lib");
  const { PDFDocument, StandardFonts, rgb } = pdfLib;

  const out = await PDFDocument.create();
  const body = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  // Position within the body, i.e. ignoring the front matter that gets inserted in
  // front of it later. Resolving to absolute page numbers only once the number of
  // contents pages is known is what keeps the printed numbers honest.
  const included: { paper: Paper; bodyIndex: number; pages: number }[] = [];
  const missing: Paper[] = [];
  const failed: MergeResult["failed"] = [];

  const bound = new Map<string, number>(); // paper id -> index in `included`
  const leftOut = new Set<string>(); // already counted as missing or failed
  const total = new Set(sections.flatMap((section) => section.papers.map((paper) => paper.id))).size;

  const headed: {
    section: MergeSection;
    page: any;
    bodyIndex: number;
    fresh: number;
    earlier: number;
    absent: number;
  }[] = [];
  const contents: ContentsItem[] = [];
  const outline: OutlineNode[] = [];
  const openSections: { depth: number; node: OutlineNode }[] = [];

  const cover = out.addPage([PAGE_W, PAGE_H]);
  const bodyStart = out.getPageCount(); // everything from here is a paper

  let done = 0;
  for (const section of sections) {
    const grouped = !!section.title;
    const depth = grouped ? section.depth : -1;
    let siblings = outline;
    let entry: (typeof headed)[number] | null = null;

    if (grouped) {
      const page = out.addPage([PAGE_W, PAGE_H]);
      const bodyIndex = out.getPageCount() - 1 - bodyStart;
      entry = { section, page, bodyIndex, fresh: 0, earlier: 0, absent: 0 };
      headed.push(entry);
      if (contents.length) contents.push({ kind: "gap" });
      contents.push({ kind: "section", title: section.title, depth: section.depth, bodyIndex });

      // Nest the bookmark under the nearest shallower section before it.
      while (openSections.length && openSections[openSections.length - 1]!.depth >= section.depth) {
        openSections.pop();
      }
      const node: OutlineNode = { title: section.title, bodyIndex, children: [] };
      (openSections.length ? openSections[openSections.length - 1]!.node.children : outline).push(node);
      openSections.push({ depth: section.depth, node });
      siblings = node.children;
    }

    for (const paper of section.papers) {
      const already = bound.get(paper.id);
      if (already !== undefined) {
        const first = included[already]!;
        contents.push({ kind: "paper", number: already + 1, title: paper.title, depth, bodyIndex: first.bodyIndex, repeat: true });
        siblings.push({ title: paper.title || "Untitled", bodyIndex: first.bodyIndex, children: [] });
        if (entry) entry.earlier += 1;
        continue;
      }
      if (leftOut.has(paper.id)) {
        if (entry) entry.absent += 1;
        continue;
      }

      options.onProgress?.({ done, total, current: paper.title });
      done += 1;

      const index = await bindPaper(paper);
      if (index === null) {
        leftOut.add(paper.id);
        if (entry) entry.absent += 1;
        continue;
      }
      const placed = included[index]!;
      contents.push({ kind: "paper", number: index + 1, title: paper.title, depth, bodyIndex: placed.bodyIndex });
      siblings.push({ title: paper.title || "Untitled", bodyIndex: placed.bodyIndex, children: [] });
      if (entry) entry.fresh += 1;
    }
  }

  // Binds one paper in and returns its place in `included`, or null when it has no
  // file or the file will not open, having recorded which.
  async function bindPaper(paper: Paper): Promise<number | null> {
    if (!paper.hasPdf) {
      missing.push(paper);
      return null;
    }

    try {
      let source = await getPdf(paper.id);
      if (!source) {
        missing.push(paper);
        return null;
      }

      if (options.includeHighlights) {
        const highlights = options.highlightsFor?.(paper.id) || [];
        if (highlights.length) {
          try {
            source = await createAnnotatedPdf(source, highlights);
          } catch {
            // Worth having, not worth failing the dossier for; bind the clean copy.
          }
        }
      }

      // Many publisher PDFs carry an owner password that permits reading but not
      // modification. Those are still fine to bind into a reading copy.
      const doc = await PDFDocument.load(await source.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const pageCount = doc.getPageCount();
      if (!pageCount) throw new Error("the file has no pages");

      const divider = out.addPage([PAGE_W, PAGE_H]);
      const bodyIndex = out.getPageCount() - 1 - bodyStart;

      drawDivider(divider, paper, included.length + 1, { body, bold, rgb });

      const copied = await out.copyPages(doc, doc.getPageIndices());
      for (const page of copied) out.addPage(page);

      included.push({ paper, bodyIndex, pages: pageCount });
      bound.set(paper.id, included.length - 1);
      return included.length - 1;
    } catch (error) {
      failed.push({
        paper,
        reason: error instanceof Error ? error.message : "could not be read",
      });
      return null;
    }
  }

  options.onProgress?.({ done, total, current: "Writing the contents" });

  // How many contents pages this needs, measured before any are created so the page
  // numbers printed on them are the numbers the reader will actually land on.
  const rows = countContentsRows(contents, missing, failed, body, bold);
  const contentsCount = Math.max(1, Math.ceil(rows / CONTENTS_CAPACITY));

  const contentsPages = [];
  for (let i = 0; i < contentsCount; i += 1) {
    contentsPages.push(out.insertPage(1 + i, [PAGE_W, PAGE_H]));
  }

  const frontMatter = 1 + contentsCount;
  const pageOf = (bodyIndex: number) => frontMatter + bodyIndex + 1; // 1-based
  const resolved: MergeResult["included"] = included.map((entry) => ({
    paper: entry.paper,
    pages: entry.pages,
    page: pageOf(entry.bodyIndex),
  }));

  drawCover(cover, options, resolved.length, { body, bold, rgb });
  for (const entry of headed) drawSectionPage(entry.page, entry, { body, bold, rgb });
  drawContents(contentsPages, contents, pageOf, missing, failed, { body, bold, rgb });

  out.setTitle(toWinAnsi(options.title));
  out.setCreator("lattice");
  out.setProducer("lattice");
  addOutline(out, pdfLib, outline, pageOf);

  // objectsPerTick is the difference between this feature working and not.
  //
  // pdf-lib yields to the event loop every 50 objects while serialising. In node each
  // yield is nearly free, but a browser clamps a nested setTimeout to about 4ms, so
  // the write becomes thousands of 4ms sleeps: measured here, one 10-page paper took
  // 42.8 seconds to save, and 4 milliseconds with the yielding turned off. That is the
  // whole cost — the actual work is trivial.
  //
  // Writing in one tick does block the main thread, which is why the yielding exists,
  // but for a few hundred milliseconds rather than a minute of unresponsive waiting.
  const bytes = await out.save({ useObjectStreams: false, objectsPerTick: Infinity });
  return {
    // Copy into a standalone buffer: the Uint8Array pdf-lib returns can be a view onto
    // a larger allocation, which Blob would otherwise capture in full.
    blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }),
    included: resolved,
    missing,
    failed,
    totalPages: out.getPageCount(),
    sections: headed.map((entry) => ({
      title: entry.section.title,
      depth: entry.section.depth,
      page: pageOf(entry.bodyIndex),
      papers: entry.section.papers.length,
    })),
  };
}

function drawDivider(page: any, paper: Paper, index: number, f: any) {
  const { body, bold, rgb } = f;
  const width = PAGE_W - MARGIN * 2;
  let y = PAGE_H - MARGIN - 18;

  page.drawText(String(index), { x: MARGIN, y, size: 11, font: bold, color: rgb(...ACCENT) });
  y -= 42;

  for (const line of wrap(toWinAnsi(paper.title || "Untitled"), bold, 20, width)) {
    page.drawText(line, { x: MARGIN, y, size: 20, font: bold, color: rgb(...INK) });
    y -= 26;
  }
  y -= 8;
  for (const line of wrap(toWinAnsi(citation(paper)), body, 11, width)) {
    page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: rgb(...MUTED) });
    y -= 15;
  }

  const takeaway = paper.takeaway?.trim();
  if (takeaway) {
    y -= 24;
    page.drawText("YOUR TAKEAWAY", { x: MARGIN, y, size: 8, font: bold, color: rgb(...ACCENT) });
    y -= 18;
    for (const line of wrap(toWinAnsi(takeaway), body, 11, width)) {
      if (y < MARGIN + 40) break;
      page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: rgb(...INK) });
      y -= 16;
    }
  }

  const id = paper.doi?.trim()
    ? `doi:${paper.doi.trim()}`
    : paper.arxivId?.trim()
      ? `arXiv:${paper.arxivId.trim()}`
      : "";
  if (id) {
    page.drawText(toWinAnsi(id), { x: MARGIN, y: MARGIN, size: 9, font: body, color: rgb(...MUTED) });
  }
}

function drawCover(page: any, options: MergeOptions, count: number, f: any) {
  const { body, bold, rgb } = f;
  const width = PAGE_W - MARGIN * 2;
  let y = PAGE_H - MARGIN - 120;

  for (const line of wrap(toWinAnsi(options.title), bold, 30, width)) {
    page.drawText(line, { x: MARGIN, y, size: 30, font: bold, color: rgb(...INK) });
    y -= 38;
  }

  const premise = options.premise?.trim();
  if (premise) {
    y -= 14;
    for (const line of wrap(toWinAnsi(premise), body, 12, width)) {
      if (y < MARGIN + 80) break;
      page.drawText(line, { x: MARGIN, y, size: 12, font: body, color: rgb(...MUTED) });
      y -= 17;
    }
  }

  page.drawText(`${count} paper${count === 1 ? "" : "s"}`, {
    x: MARGIN, y: MARGIN + 22, size: 11, font: body, color: rgb(...MUTED),
  });
  const when = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });
  page.drawText(toWinAnsi(`Compiled ${when} with lattice`), {
    x: MARGIN, y: MARGIN, size: 9, font: body, color: rgb(...MUTED),
  });
}

function drawSectionPage(
  page: any,
  entry: { section: MergeSection; fresh: number; earlier: number; absent: number },
  f: any
) {
  const { body, bold, rgb } = f;
  const { section } = entry;
  const width = PAGE_W - MARGIN * 2;
  let y = PAGE_H - MARGIN - 120;

  if (section.label) {
    page.drawText(toWinAnsi(section.label), { x: MARGIN, y, size: 8, font: bold, color: rgb(...ACCENT) });
    y -= 18;
  }
  if (section.context) {
    for (const line of wrap(toWinAnsi(section.context), body, 11, width)) {
      page.drawText(line, { x: MARGIN, y, size: 11, font: body, color: rgb(...MUTED) });
      y -= 15;
    }
    y -= 6;
  }
  y -= 14;
  for (const line of wrap(toWinAnsi(section.title), bold, 26, width)) {
    page.drawText(line, { x: MARGIN, y, size: 26, font: bold, color: rgb(...INK) });
    y -= 33;
  }

  const premise = section.premise?.trim();
  if (premise) {
    y -= 10;
    for (const line of wrap(toWinAnsi(premise), body, 12, width)) {
      if (y < MARGIN + 80) break;
      page.drawText(line, { x: MARGIN, y, size: 12, font: body, color: rgb(...MUTED) });
      y -= 17;
    }
  }

  const n = (count: number) => `${count} paper${count === 1 ? "" : "s"}`;
  const facts = !section.papers.length
    ? ["Everything here is filed in its subprojects."]
    : [
        entry.fresh ? `${n(entry.fresh)} follow${entry.fresh === 1 ? "s" : ""}.` : "",
        entry.earlier ? `${n(entry.earlier)} bound earlier in this file; the contents gives the page.` : "",
        entry.absent ? `${n(entry.absent)} without a readable PDF, listed at the end of the contents.` : "",
      ].filter(Boolean);
  let factY = MARGIN + 22 + (facts.length - 1) * 15;
  for (const fact of facts) {
    page.drawText(toWinAnsi(fact), { x: MARGIN, y: factY, size: 10, font: body, color: rgb(...MUTED) });
    factY -= 15;
  }
}

const INDENT = 12;

function contentsWidths(bold: any) {
  const pageNumWidth = bold.widthOfTextAtSize("9999", 10) + 6;
  return { pageNumWidth, titleWidth: PAGE_W - MARGIN * 2 - 22 - pageNumWidth - 12 };
}

function indentOf(depth: number): number {
  return Math.max(0, depth) * INDENT;
}

function sectionLines(item: { title: string; depth: number }, bold: any): string[] {
  const { titleWidth } = contentsWidths(bold);
  return wrap(toWinAnsi(item.title || "Untitled"), bold, 10, titleWidth + 22 - indentOf(item.depth)).slice(0, 2);
}

function paperLines(item: { title: string; depth: number }, body: any, bold: any): string[] {
  const { titleWidth } = contentsWidths(bold);
  return wrap(toWinAnsi(item.title || "Untitled"), body, 10, titleWidth - indentOf(item.depth)).slice(0, 2);
}

/** Rows the contents will occupy, so the right number of pages is reserved up front. */
function countContentsRows(
  items: ContentsItem[],
  missing: Paper[],
  failed: MergeResult["failed"],
  body: any,
  bold: any
): number {
  let rows = 0;
  for (const item of items) {
    if (item.kind === "gap") rows += 1;
    else if (item.kind === "section") rows += Math.max(1, sectionLines(item, bold).length);
    else rows += Math.max(1, paperLines(item, body, bold).length);
  }
  if (missing.length || failed.length) rows += 2 + missing.length + failed.length;
  return rows;
}

function drawContents(
  pages: any[],
  items: ContentsItem[],
  pageOf: (bodyIndex: number) => number,
  missing: Paper[],
  failed: MergeResult["failed"],
  f: any
) {
  const { body, bold, rgb } = f;
  let pageIndex = 0;
  let page = pages[0];
  let y = CONTENTS_TOP;

  page.drawText("Contents", {
    x: MARGIN, y: PAGE_H - MARGIN, size: 16, font: bold, color: rgb(...INK),
  });

  const advance = () => {
    y -= CONTENTS_LINE;
    if (y < CONTENTS_BOTTOM && pageIndex < pages.length - 1) {
      pageIndex += 1;
      page = pages[pageIndex];
      y = CONTENTS_TOP;
    }
  };

  const { pageNumWidth } = contentsWidths(bold);
  const drawPageNumber = (bodyIndex: number) =>
    page.drawText(String(pageOf(bodyIndex)), {
      x: PAGE_W - MARGIN - pageNumWidth, y, size: 10, font: bold, color: rgb(...ACCENT),
    });

  for (const item of items) {
    if (item.kind === "gap") {
      advance();
      continue;
    }
    const x = MARGIN + indentOf(item.depth);
    if (item.kind === "section") {
      const lines = sectionLines(item, bold);
      page.drawText(lines[0] || "", { x, y, size: 10, font: bold, color: rgb(...INK) });
      drawPageNumber(item.bodyIndex);
      if (lines[1]) {
        advance();
        page.drawText(lines[1], { x, y, size: 10, font: bold, color: rgb(...INK) });
      }
      advance();
      continue;
    }
    // A paper listed again under a second project keeps its first number and page,
    // and is greyed so it reads as a pointer back rather than another copy.
    const lines = paperLines(item, body, bold);
    const ink = rgb(...(item.repeat ? MUTED : INK));
    page.drawText(`${item.number}.`, { x, y, size: 10, font: body, color: rgb(...MUTED) });
    page.drawText(lines[0] || "", { x: x + 22, y, size: 10, font: body, color: ink });
    drawPageNumber(item.bodyIndex);
    if (lines[1]) {
      advance();
      page.drawText(lines[1], { x: x + 22, y, size: 10, font: body, color: ink });
    }
    advance();
  }

  // The absent papers are part of the record, not something to hide.
  if (missing.length || failed.length) {
    advance();
    page.drawText("Not included", { x: MARGIN, y, size: 11, font: bold, color: rgb(...INK) });
    advance();
    // One line each, and the reason is the half worth keeping — so the title is
    // elided to fit rather than the line being cut wherever it happens to run out,
    // which truncated these to "...Protein Tasks - no".
    const note = (title: string, reason: string) => {
      const width = PAGE_W - MARGIN * 2;
      const tail = toWinAnsi(` — ${reason}`);
      const tailWidth = body.widthOfTextAtSize(tail, 9);
      let head = toWinAnsi(title || "Untitled");
      if (body.widthOfTextAtSize(head, 9) + tailWidth > width) {
        while (head.length > 1 && body.widthOfTextAtSize(`${head}...`, 9) + tailWidth > width) {
          head = head.slice(0, -1);
        }
        head = `${head.trimEnd()}...`;
      }
      page.drawText(head + tail, { x: MARGIN, y, size: 9, font: body, color: rgb(...MUTED) });
      advance();
    };
    for (const paper of missing) note(paper.title, "no PDF attached");
    for (const { paper, reason } of failed) note(paper.title, reason);
  }
}

interface OutlineNode {
  title: string;
  bodyIndex: number;
  children: OutlineNode[];
}

/**
 * Add a PDF outline, so a reader can jump to a paper from the sidebar instead of
 * scrolling several hundred pages. pdf-lib has no API for outlines, so the dictionaries
 * are written directly. Sections become bookmarks with their papers nested inside,
 * closed, so a whole library opens as a short list of projects. Bookmarks are a
 * convenience: if any of this fails the document is still complete, so it never throws.
 */
function addOutline(
  doc: any,
  pdfLib: any,
  nodes: OutlineNode[],
  pageOf: (bodyIndex: number) => number
): void {
  try {
    if (!nodes.length) return;
    const { PDFName, PDFNumber, PDFArray, PDFHexString, PDFNull } = pdfLib;
    const context = doc.context;
    const pages = doc.getPages();

    // Writes one level of siblings under `parentRef` and returns their first and last.
    const writeLevel = (level: OutlineNode[], parentRef: any): any[] => {
      const rows = level.filter((node) => !!pages[pageOf(node.bodyIndex) - 1]);
      const refs = rows.map(() => context.nextRef());
      rows.forEach((node, index) => {
        // [page /XYZ null null null] — top of the page, viewer keeps the current zoom.
        const dest = PDFArray.withContext(context);
        dest.push(pages[pageOf(node.bodyIndex) - 1].ref);
        dest.push(PDFName.of("XYZ"));
        dest.push(PDFNull);
        dest.push(PDFNull);
        dest.push(PDFNull);

        const item = context.obj({});
        item.set(PDFName.of("Title"), PDFHexString.fromText(node.title));
        item.set(PDFName.of("Parent"), parentRef);
        item.set(PDFName.of("Dest"), dest);
        if (index > 0) item.set(PDFName.of("Prev"), refs[index - 1]);
        if (index < refs.length - 1) item.set(PDFName.of("Next"), refs[index + 1]);

        const children = writeLevel(node.children, refs[index]);
        if (children.length) {
          item.set(PDFName.of("First"), children[0]);
          item.set(PDFName.of("Last"), children[children.length - 1]);
          // Negative: closed, with this many entries showing once it is opened.
          item.set(PDFName.of("Count"), PDFNumber.of(-children.length));
        }
        context.assign(refs[index], item);
      });
      return refs;
    };

    const outlineRef = context.nextRef();
    const refs = writeLevel(nodes, outlineRef);
    if (!refs.length) return;

    const outlines = context.obj({});
    outlines.set(PDFName.of("Type"), PDFName.of("Outlines"));
    outlines.set(PDFName.of("First"), refs[0]);
    outlines.set(PDFName.of("Last"), refs[refs.length - 1]);
    outlines.set(PDFName.of("Count"), PDFNumber.of(refs.length));
    context.assign(outlineRef, outlines);

    doc.catalog.set(PDFName.of("Outlines"), outlineRef);
  } catch {
    // No bookmarks; the dossier is still correct and complete.
  }
}
