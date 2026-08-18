import type { Highlight, HighlightColor, NormRect } from "../types";

const PDF_COLORS: Record<HighlightColor, [number, number, number]> = {
  yellow: [0.98, 0.8, 0.08],
  green: [0.13, 0.77, 0.37],
  blue: [0.23, 0.51, 0.96],
  pink: [0.93, 0.28, 0.6],
  orange: [0.98, 0.45, 0.09],
};

export function normalizedRectToPdf(
  rect: NormRect,
  width: number,
  height: number
): { left: number; bottom: number; right: number; top: number } {
  return {
    left: rect.x * width,
    bottom: height - (rect.y + rect.h) * height,
    right: (rect.x + rect.w) * width,
    top: height - rect.y * height,
  };
}

/**
 * Embed lattice highlights as standard PDF Highlight annotations. The output
 * remains selectable/searchable and attached notes appear in normal PDF
 * annotation sidebars instead of being permanently painted over the page.
 */
export async function createAnnotatedPdf(
  source: Blob,
  highlights: Highlight[]
): Promise<Blob> {
  // Keep the PDF writer out of the reading path; it is only downloaded when
  // the user explicitly exports.
  const { PDFArray, PDFDocument, PDFHexString, PDFName } = await import("pdf-lib");
  const input = await source.arrayBuffer();
  const document = await PDFDocument.load(input);
  const pages = document.getPages();

  for (const highlight of highlights) {
    const page = pages[highlight.page - 1];
    if (!page || highlight.rects.length === 0) continue;
    const { width, height } = page.getSize();
    const rects = highlight.rects.map((rect) =>
      normalizedRectToPdf(rect, width, height)
    );
    const bounds = {
      left: Math.min(...rects.map((rect) => rect.left)),
      bottom: Math.min(...rects.map((rect) => rect.bottom)),
      right: Math.max(...rects.map((rect) => rect.right)),
      top: Math.max(...rects.map((rect) => rect.top)),
    };
    const quadPoints = rects.flatMap((rect) => [
      rect.left,
      rect.top,
      rect.right,
      rect.top,
      rect.left,
      rect.bottom,
      rect.right,
      rect.bottom,
    ]);

    const annotation = document.context.register(
      document.context.obj({
        Type: "Annot",
        Subtype: "Highlight",
        Rect: [bounds.left, bounds.bottom, bounds.right, bounds.top],
        QuadPoints: quadPoints,
        C: PDF_COLORS[highlight.color],
        CA: 0.35,
        Contents: PDFHexString.fromText(highlight.note?.trim() || highlight.text),
        T: PDFHexString.fromText("lattice"),
        NM: PDFHexString.fromText(highlight.id),
        M: PDFHexString.fromText(
          `D:${highlight.createdAt
            .split("-").join("")
            .split(":").join("")
            .replace("T", "")
            .slice(0, 14)}Z`
        ),
        F: 4,
      })
    );

    const key = PDFName.of("Annots");
    let annotations = page.node.lookupMaybe(key, PDFArray);
    if (!annotations) {
      annotations = document.context.obj([]);
      page.node.set(key, annotations);
    }
    annotations.push(annotation);
  }

  const bytes = await document.save();
  return new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" });
}

export function annotatedPdfFilename(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "paper";
  return `${base}-annotated.pdf`;
}
