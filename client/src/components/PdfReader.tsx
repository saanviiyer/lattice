// The core PDF annotation surface. Renders a PDF with pdf.js including a selectable
// text layer, lets the user select text to create a colored highlight, and re-renders
// stored highlights anchored to the correct place (using normalized rects) on reload.
//
// Live text-layer selection needs a real browser; the highlight data model and
// re-anchoring are covered by unit tests (highlightAnchor.test.ts).

import { useEffect, useLayoutEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Highlight, HighlightColor, NormRect } from "../types";
import { normToPixels, screenRectToNorm } from "../lib/highlightAnchor";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PageInfo {
  wrapper: HTMLDivElement;
  hlLayer: HTMLDivElement;
  w: number;
  h: number;
}

interface Props {
  blob: Blob | null;
  highlights: Highlight[];
  activeColor: HighlightColor;
  scale: number;
  onCreate: (h: { page: number; text: string; rects: NormRect[] }) => void;
  onSelectHighlight: (id: string) => void;
  scrollTargetId?: string | null;
  onStatus?: (msg: string) => void;
}

export default function PdfReader({
  blob,
  highlights,
  activeColor,
  scale,
  onCreate,
  onSelectHighlight,
  scrollTargetId,
  onStatus,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<PageInfo[]>([]);
  // Keep the latest callbacks/colors in refs so the render effect need not re-run.
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;

  // ---- Render the PDF whenever the blob or scale changes ----
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    pagesRef.current = [];
    if (!blob) return;

    const status = (m: string) => onStatus?.(m);

    (async () => {
      status("Loading PDF…");
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        status(`Rendering ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}…`);
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });

          const wrapper = document.createElement("div");
          wrapper.className = "lat-page";
          wrapper.style.width = `${viewport.width}px`;
          wrapper.style.height = `${viewport.height}px`;
          wrapper.style.setProperty("--scale-factor", String(scale));
          wrapper.dataset.page = String(i);

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d");
          wrapper.appendChild(canvas);

          const hlLayer = document.createElement("div");
          hlLayer.className = "lat-highlight-layer";
          wrapper.appendChild(hlLayer);

          const textLayerDiv = document.createElement("div");
          textLayerDiv.className = "textLayer";
          wrapper.appendChild(textLayerDiv);

          container.appendChild(wrapper);

          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;

          const textContent = await page.getTextContent();
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
          });
          await textLayer.render();

          pagesRef.current[i - 1] = {
            wrapper,
            hlLayer,
            w: viewport.width,
            h: viewport.height,
          };
        }
        if (!cancelled) {
          status(
            `${pdf.numPages} page${
              pdf.numPages === 1 ? "" : "s"
            }. Select text to highlight in the active color.`
          );
          drawHighlights();
        }
      } catch (err) {
        if (!cancelled)
          status(err instanceof Error ? err.message : "Failed to load PDF.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, scale]);

  // ---- Redraw the highlight overlays whenever the highlight set changes ----
  useLayoutEffect(() => {
    drawHighlights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights]);

  function drawHighlights() {
    const pages = pagesRef.current;
    for (const info of pages) {
      if (info) info.hlLayer.innerHTML = "";
    }
    for (const h of highlights) {
      const info = pages[h.page - 1];
      if (!info) continue;
      for (const r of h.rects) {
        const px = normToPixels(r, info.w, info.h);
        const div = document.createElement("div");
        div.className = `lat-highlight lat-hl-${h.color}`;
        div.style.left = `${px.left}px`;
        div.style.top = `${px.top}px`;
        div.style.width = `${px.width}px`;
        div.style.height = `${px.height}px`;
        div.dataset.hid = h.id;
        div.title = h.note ? h.note : "Click to add a note";
        div.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectHighlight(h.id);
        });
        info.hlLayer.appendChild(div);
      }
    }
  }

  // ---- Turn a text selection into a highlight in the active color ----
  function handleMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (!text) return;

    const range = sel.getRangeAt(0);
    // Find which page the selection started in.
    let node: Node | null = range.startContainer;
    let pageEl: HTMLElement | null = null;
    while (node) {
      if (node instanceof HTMLElement && node.classList?.contains("lat-page")) {
        pageEl = node;
        break;
      }
      node = node.parentNode;
    }
    if (!pageEl) return;
    const pageNum = Number(pageEl.dataset.page || "0");
    const info = pagesRef.current[pageNum - 1];
    if (!info) return;

    const box = pageEl.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects());
    const rects: NormRect[] = [];
    for (const cr of clientRects) {
      if (cr.width < 1 || cr.height < 1) continue;
      // Keep only rects that fall within this page.
      const cx = cr.left + cr.width / 2 - box.left;
      const cy = cr.top + cr.height / 2 - box.top;
      if (cx < -2 || cy < -2 || cx > info.w + 2 || cy > info.h + 2) continue;
      rects.push(
        screenRectToNorm(
          { left: cr.left, top: cr.top, width: cr.width, height: cr.height },
          { left: box.left, top: box.top },
          info.w,
          info.h
        )
      );
    }
    if (rects.length === 0) return;

    onCreateRef.current({ page: pageNum, text, rects });
    sel.removeAllRanges();
  }

  // ---- Scroll a highlight into view when requested ----
  useEffect(() => {
    if (!scrollTargetId) return;
    const el = containerRef.current?.querySelector(
      `[data-hid="${scrollTargetId}"]`
    ) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollTargetId]);

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      className="flex flex-col items-center gap-4 p-6 overflow-auto h-full bg-slate-950"
      data-active-color={activeColor}
    />
  );
}
