import { describe, expect, it } from "vitest";
import { annotatedPdfFilename, normalizedRectToPdf } from "../lib/annotatedPdf";

describe("annotated PDF coordinates", () => {
  it("converts top-origin normalized rectangles to PDF bottom-origin points", () => {
    expect(normalizedRectToPdf({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, 600, 800))
      .toEqual({ left: 60, bottom: 560, right: 240, top: 640 });
  });

  it("creates a filesystem-safe PDF name", () => {
    expect(annotatedPdfFilename("Attention: Is All You Need?"))
      .toBe("Attention-Is-All-You-Need-annotated.pdf");
  });
});
