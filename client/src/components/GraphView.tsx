// Force-directed knowledge graph (d3-force simulation drawn on a canvas). Papers and
// notes are nodes; wikilinks and paper<->note relations are edges. Click a node to
// open it.

import { useEffect, useRef } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { GraphData } from "../types";

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: "paper" | "note";
}
type SimLink = SimulationLinkDatum<SimNode> & { kind: "wikilink" | "paper-note" };

interface Props {
  data: GraphData;
  onOpenNode: (id: string) => void;
}

const COLORS = {
  paper: "#818cf8",
  note: "#34d399",
  edge: "rgba(148,163,184,0.35)",
  edgePaperNote: "rgba(129,140,248,0.5)",
  label: "#cbd5e1",
};

export default function GraphView({ data, onOpenNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpenNode);
  onOpenRef.current = onOpenNode;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let width = wrap.clientWidth;
    let height = wrap.clientHeight;

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
    }));

    function resize() {
      width = wrap!.clientWidth;
      height = wrap!.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      sim.force("center", forceCenter(width / 2, height / 2));
      sim.alpha(0.5).restart();
    }

    const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(70)
          .strength(0.6)
      )
      .force("charge", forceManyBody<SimNode>().strength(-220))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<SimNode>(22));

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      // Edges
      for (const l of links) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (s.x == null || t.x == null) continue;
        ctx!.beginPath();
        ctx!.moveTo(s.x!, s.y!);
        ctx!.lineTo(t.x!, t.y!);
        ctx!.strokeStyle =
          l.kind === "paper-note" ? COLORS.edgePaperNote : COLORS.edge;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }
      // Nodes
      for (const n of nodes) {
        if (n.x == null) continue;
        const r = n.type === "paper" ? 8 : 6;
        ctx!.beginPath();
        ctx!.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx!.fillStyle = COLORS[n.type];
        ctx!.fill();
        ctx!.font = "11px Inter, system-ui, sans-serif";
        ctx!.fillStyle = COLORS.label;
        const label =
          n.label.length > 28 ? n.label.slice(0, 28) + "…" : n.label;
        ctx!.fillText(label, n.x! + r + 3, n.y! + 4);
      }
    }

    sim.on("tick", draw);

    function nodeAt(px: number, py: number): SimNode | null {
      let best: SimNode | null = null;
      let bestD = 16 * 16;
      for (const n of nodes) {
        if (n.x == null) continue;
        const dx = n.x! - px;
        const dy = n.y! - py;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }

    let dragging: SimNode | null = null;
    function toLocal(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function onDown(e: MouseEvent) {
      const { x, y } = toLocal(e);
      const n = nodeAt(x, y);
      if (n) {
        dragging = n;
        sim.alphaTarget(0.2).restart();
      }
    }
    function onMove(e: MouseEvent) {
      const { x, y } = toLocal(e);
      canvas!.style.cursor = nodeAt(x, y) ? "pointer" : "default";
      if (dragging) {
        dragging.fx = x;
        dragging.fy = y;
      }
    }
    function onUp(e: MouseEvent) {
      if (dragging) {
        dragging.fx = null;
        dragging.fy = null;
        dragging = null;
        sim.alphaTarget(0);
      } else {
        const { x, y } = toLocal(e);
        const n = nodeAt(x, y);
        if (n) onOpenRef.current(n.id);
      }
    }

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    return () => {
      sim.stop();
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      ro.disconnect();
    };
  }, [data]);

  return (
    <div ref={wrapRef} className="w-full h-full relative">
      {data.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
          Add papers and notes, link them with [[wikilinks]], and they will appear here.
        </div>
      )}
      <canvas ref={canvasRef} />
    </div>
  );
}
