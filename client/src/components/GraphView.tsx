// Force-directed knowledge graph (d3-force drawn on a canvas).
//
// Nodes are papers, notes, and research questions. Edges are [[wikilinks]], the
// paper<->note relation, explicit related-paper links, and question->evidence links.
//
// The view is built for interrogation rather than decoration:
//   click        focus a node and dim everything outside its neighbourhood
//   shift-click  trace the shortest path from the focused node to another one
//   double-click open the node
//   drag node    reposition it; drag background to pan; wheel to zoom
//   sidebar      filter by node/edge kind, and read off hubs, orphans, and islands

import { useResolvedTheme } from "../lib/theme";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { GraphData, GraphEdge, GraphNodeType } from "../types";
import {
  degreeMap,
  edgeKindsPresent,
  graphInsights,
  neighborhood,
  shortestPath,
} from "../lib/graphAnalysis";
import { IconPlus, IconSearch } from "./Icons";
import {
  nodeColor,
  UNGROUPED_COLOR,
  type GraphGroup,
  type GraphGrouping,
  type GroupingMode,
} from "../lib/graphGroups";

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: GraphNodeType;
  degree: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { kind: GraphEdge["kind"] };

interface Props {
  data: GraphData;
  /** How the graph is grouped, and therefore coloured and clustered. */
  grouping: GraphGrouping;
  groupingMode: GroupingMode;
  onGroupingMode: (mode: GroupingMode) => void;
  /** Turn a proposed subject group into a real project. */
  onAdoptGroup: (group: GraphGroup) => void;
  onOpenNode: (id: string) => void;
}

// The canvas cannot read CSS variables, so each theme's paint is spelled out. Light
// is not a tint of dark: the pastels that read well against near-black wash out on
// white, and the halo behind a group name has to become light instead of dark or it
// prints a dark smear across the page.
type CanvasPaint = {
  nodes: Record<GraphNodeType, string>;
  edges: Record<GraphEdge["kind"], string>;
  label: string;
  labelMuted: string;
  focusRing: string;
  pathAccent: string;
  questionCore: string;
  groupHalo: string;
};

const CANVAS_PAINT: Record<"dark" | "light", CanvasPaint> = {
  dark: {
    nodes: { paper: "#818cf8", note: "#34d399", question: "#fbbf24" },
    edges: {
      wikilink: "rgba(148,163,184,0.40)",
      "paper-note": "rgba(129,140,248,0.50)",
      related: "rgba(34,211,238,0.62)",
      "question-paper": "rgba(251,191,36,0.55)",
    },
    label: "#e2e8f0",
    labelMuted: "#94a3b8",
    focusRing: "#f8fafc",
    pathAccent: "#f472b6",
    questionCore: "#0b1120",
    groupHalo: "rgba(8,12,20,.92)",
  },
  light: {
    nodes: { paper: "#4f46e5", note: "#059669", question: "#d97706" },
    edges: {
      wikilink: "rgba(71,85,105,0.35)",
      "paper-note": "rgba(79,70,229,0.45)",
      related: "rgba(14,116,144,0.55)",
      "question-paper": "rgba(180,83,9,0.50)",
    },
    label: "#1e293b",
    labelMuted: "#475569",
    focusRing: "#0f172a",
    pathAccent: "#be185d",
    questionCore: "#ffffff",
    groupHalo: "rgba(255,255,255,.92)",
  },
};


const NODE_LABELS: Record<GraphNodeType, string> = {
  paper: "Papers",
  note: "Notes",
  question: "Questions",
};


const EDGE_LABELS: Record<GraphEdge["kind"], string> = {
  wikilink: "[[wikilink]]",
  "paper-note": "Paper to its notes",
  related: "Related papers",
  "question-paper": "Question to evidence",
};

const ALL_TYPES: GraphNodeType[] = ["paper", "note", "question"];
const ALL_KINDS: GraphEdge["kind"][] = ["wikilink", "paper-note", "related", "question-paper"];

export default function GraphView({
  data,
  grouping,
  groupingMode,
  onGroupingMode,
  onAdoptGroup,
  onOpenNode,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [hiddenTypes, setHiddenTypes] = useState<Set<GraphNodeType>>(new Set());
  const [hiddenKinds, setHiddenKinds] = useState<Set<GraphEdge["kind"]>>(new Set());
  const [hideOrphans, setHideOrphans] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusDepth, setFocusDepth] = useState(1);
  const [pathTargetId, setPathTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // The graph after the sidebar filters are applied. Everything downstream (the
  // simulation, the insights, the focus maths) reads this, so what the sidebar
  // reports always matches what is on screen.
  const visible = useMemo<GraphData>(() => {
    const nodes = data.nodes.filter((n) => !hiddenTypes.has(n.type));
    const keptIds = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter(
      (e) => !hiddenKinds.has(e.kind) && keptIds.has(e.source) && keptIds.has(e.target)
    );
    if (!hideOrphans) return { nodes, edges };
    const linked = new Set<string>();
    for (const e of edges) {
      linked.add(e.source);
      linked.add(e.target);
    }
    return { nodes: nodes.filter((n) => linked.has(n.id)), edges };
  }, [data, hiddenTypes, hiddenKinds, hideOrphans]);

  const insights = useMemo(() => graphInsights(visible), [visible]);
  const kindsPresent = useMemo(() => edgeKindsPresent(data), [data]);
  const labelOf = useMemo(
    () => new Map(data.nodes.map((n) => [n.id, n.label])),
    [data]
  );

  // A focused node dims everything more than `focusDepth` hops away. A traced path
  // narrows that further to the chain itself.
  const pathIds = useMemo(() => {
    if (!focusId || !pathTargetId) return [] as string[];
    return shortestPath(visible, focusId, pathTargetId);
  }, [visible, focusId, pathTargetId]);

  const litIds = useMemo(() => {
    if (focusId && pathTargetId) return new Set(pathIds);
    if (focusId) return neighborhood(visible, focusId, focusDepth);
    return null; // nothing dimmed
  }, [visible, focusId, focusDepth, pathTargetId, pathIds]);

  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return visible.nodes
      .filter((n) => n.label.toLowerCase().includes(q))
      .slice(0, 6);
  }, [visible, search]);

  // Live state the canvas draw loop reads. Kept in a ref so changing focus repaints
  // without tearing down and re-running the force simulation.
  const paintRef = useRef({
    litIds: null as Set<string> | null,
    pathIds: [] as string[],
    focusId: null as string | null,
    hoverId: null as string | null,
    // Read on every frame, so a change of grouping recolours without the canvas
    // effect tearing down and restarting the simulation.
    colorOf: ((_id: string) => UNGROUPED_COLOR) as (id: string) => string,
    // Read on every frame for the same reason: switching theme must not restart the
    // simulation and throw away the layout the user has been reading.
    paint: CANVAS_PAINT.dark,
  });
  const redrawRef = useRef<() => void>(() => {});
  const centerOnRef = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    paintRef.current.litIds = litIds;
    paintRef.current.pathIds = pathIds;
    paintRef.current.focusId = focusId;
    redrawRef.current();
  }, [litIds, pathIds, focusId]);

  const theme = useResolvedTheme();
  useEffect(() => {
    paintRef.current.paint = CANVAS_PAINT[theme];
    redrawRef.current();
  }, [theme]);

  // Recolour on a grouping change without disturbing the layout: switching how the
  // graph is grouped should not throw away the positions you have been reading.
  useEffect(() => {
    paintRef.current.colorOf = (id: string) => nodeColor(id, grouping);
    redrawRef.current();
  }, [grouping]);

  const groupingRef = useRef(grouping);
  groupingRef.current = grouping;

  const onOpenRef = useRef(onOpenNode);
  onOpenRef.current = onOpenNode;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let width = wrap.clientWidth;
    let height = wrap.clientHeight;

    const degrees = degreeMap(visible);
    const nodes: SimNode[] = visible.nodes.map((n) => ({
      ...n,
      degree: degrees.get(n.id) || 0,
    }));
    const links: SimLink[] = visible.edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // View transform: screen = world * k + t.
    const view = { k: 1, tx: 0, ty: 0 };
    const toWorld = (sx: number, sy: number) => ({
      x: (sx - view.tx) / view.k,
      y: (sy - view.ty) / view.k,
    });

    // How far in you have to zoom before every node is labelled. A fifteen-node
    // graph carries every label at once; a five-hundred-node one becomes a wall of
    // overlapping text, so at that size labels are earned by zooming in.
    const labelZoom = nodes.length <= 60 ? 0.85 : nodes.length <= 180 ? 1.7 : 2.8;

    // Radius grows with degree so hubs read as hubs at a glance, with a ceiling so a
    // single very well connected note cannot swamp the canvas.
    const radiusOf = (n: SimNode) =>
      Math.min(16, (n.type === "paper" ? 7 : 6) + Math.sqrt(n.degree) * 2.1);

    function resize() {
      width = wrap!.clientWidth;
      height = wrap!.clientHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      sim.force("center", forceCenter(width / 2, height / 2));
      sim.alpha(0.4).restart();
    }

    const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => (l.kind === "question-paper" ? 72 : 96))
          .strength(0.55)
      )
      // Repulsion and collision are tuned to the size of the graph. A small graph
      // wants to spread out so its labels have room; a large one has no room to
      // give, and the same settings would blow it into an even dust where no
      // grouping can be seen. Big graphs trade space for structure.
      .force(
        "charge",
        forceManyBody<SimNode>()
          .strength(nodes.length > 180 ? -70 : nodes.length > 60 ? -280 : -620)
          .distanceMax(nodes.length > 180 ? 220 : 520)
      )
      .force("center", forceCenter(width / 2, height / 2))
      .force(
        "collide",
        forceCollide<SimNode>((d) => radiusOf(d as SimNode) + (nodes.length > 180 ? 3 : nodes.length > 60 ? 14 : 30))
      );

    // Pull each node towards its group's anchor, so a group reads as a place on
    // the canvas rather than as a colour scattered through a cloud. For a library
    // whose nodes barely link, this is the only thing the layout has to say.
    sim.force("cluster", (alpha: number) => {
      const current = groupingRef.current;
      if (!current.groups.length) return;
      // Anchors on a ring, sized to the canvas, recomputed each tick so a resize
      // or a change of grouping is picked up without rebuilding the simulation.
      const anchors = new Map<string, { x: number; y: number }>();
      const radius = Math.min(width, height) * (current.groups.length > 12 ? 0.42 : 0.32);
      current.groups.forEach((group, index) => {
        const angle = (index / current.groups.length) * Math.PI * 2 - Math.PI / 2;
        anchors.set(group.id, {
          x: width / 2 + Math.cos(angle) * radius,
          y: height / 2 + Math.sin(angle) * radius,
        });
      });
      // Strong enough to beat the repulsion above and actually gather a group into
      // one place, which is the entire point of grouping the graph.
      const strength = (nodes.length > 180 ? 0.9 : 0.35) * alpha;
      for (const node of nodes) {
        const anchor = anchors.get(current.groupOf.get(node.id) || "");
        if (!anchor) continue;
        node.vx = (node.vx || 0) + (anchor.x - (node.x || 0)) * strength;
        node.vy = (node.vy || 0) + (anchor.y - (node.y || 0)) * strength;
      }
    });

    function draw() {
      const { litIds: lit, pathIds: path, focusId: focused, hoverId } = paintRef.current;
      const paint = paintRef.current.paint;
      const pathSet = new Set(path);
      const pathPairs = new Set<string>();
      for (let i = 0; i + 1 < path.length; i++) {
        pathPairs.add([path[i], path[i + 1]].sort().join("::"));
      }

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      ctx!.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.tx, dpr * view.ty);

      for (const l of links) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (s.x == null || t.x == null) continue;
        const onPath = pathPairs.has([s.id, t.id].sort().join("::"));
        const dimmed = lit ? !(lit.has(s.id) && lit.has(t.id)) : false;
        ctx!.globalAlpha = onPath ? 1 : dimmed ? 0.07 : 1;
        ctx!.beginPath();
        ctx!.moveTo(s.x!, s.y!);
        ctx!.lineTo(t.x!, t.y!);
        ctx!.strokeStyle = onPath ? paint.pathAccent : paint.edges[l.kind];
        ctx!.lineWidth = onPath ? 2.4 / view.k : (l.kind === "related" ? 1.6 : 1) / view.k;
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      for (const n of nodes) {
        if (n.x == null) continue;
        const dimmed = lit ? !lit.has(n.id) : false;
        const r = radiusOf(n);
        ctx!.globalAlpha = dimmed ? 0.12 : 1;

        if (n.id === focused || pathSet.has(n.id)) {
          ctx!.beginPath();
          ctx!.arc(n.x!, n.y!, r + 5 / view.k, 0, Math.PI * 2);
          ctx!.strokeStyle = n.id === focused ? paint.focusRing : paint.pathAccent;
          ctx!.lineWidth = 1.75 / view.k;
          ctx!.stroke();
        }

        ctx!.beginPath();
        ctx!.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx!.fillStyle = paintRef.current.colorOf(n.id);
        ctx!.fill();
        if (n.type === "question") {
          // Ring the questions so they stay findable when the graph gets busy.
          ctx!.beginPath();
          ctx!.arc(n.x!, n.y!, r * 0.45, 0, Math.PI * 2);
          ctx!.fillStyle = paint.questionCore;
          ctx!.fill();
        }

        // Label when the view is zoomed in, when the node matters structurally, or
        // when it is the thing being pointed at. Otherwise stay out of the way.
        const important =
          n.id === focused ||
          n.id === hoverId ||
          pathSet.has(n.id) ||
          n.degree >= 4 ||
          (lit != null && lit.has(n.id));
        if (view.k >= labelZoom || important) {
          ctx!.globalAlpha = dimmed ? 0.12 : important ? 1 : 0.75;
          const size = 11 / view.k;
          ctx!.font = `${size}px Inter, system-ui, sans-serif`;
          ctx!.fillStyle = important ? paint.label : paint.labelMuted;
          const label = n.label.length > 34 ? `${n.label.slice(0, 34)}…` : n.label;
          ctx!.fillText(label, n.x! + r + 4 / view.k, n.y! + 4 / view.k);
        }
      }

      // Group names, drawn where each cluster actually settled. When the nodes are
      // too dense to label individually this is the layer that carries the meaning:
      // thirty named regions instead of five hundred unreadable titles.
      const grouping = groupingRef.current;
      if (grouping.groups.length && view.k < labelZoom) {
        const centres = new Map<string, { x: number; y: number; n: number }>();
        for (const node of nodes) {
          const groupId = grouping.groupOf.get(node.id);
          if (!groupId) continue;
          const centre = centres.get(groupId) || { x: 0, y: 0, n: 0 };
          centre.x += node.x || 0;
          centre.y += node.y || 0;
          centre.n += 1;
          centres.set(groupId, centre);
        }
        ctx!.textAlign = "center";
        ctx!.globalAlpha = 1;
        for (const group of grouping.groups) {
          const centre = centres.get(group.id);
          if (!centre || centre.n === 0) continue;
          const size = Math.min(22, 13 / view.k);
          ctx!.font = `600 ${size}px Inter, system-ui, sans-serif`;
          // A halo in the ground colour, so the name stays readable over the nodes.
          ctx!.lineWidth = 4 / view.k;
          ctx!.strokeStyle = paint.groupHalo;
          ctx!.strokeText(group.label, centre.x / centre.n, centre.y / centre.n);
          ctx!.fillStyle = group.color;
          ctx!.fillText(group.label, centre.x / centre.n, centre.y / centre.n);
        }
        ctx!.textAlign = "start";
      }

      ctx!.globalAlpha = 1;
    }

    redrawRef.current = draw;
    centerOnRef.current = (id: string) => {
      const n = byId.get(id);
      if (!n || n.x == null) return;
      view.tx = width / 2 - view.k * n.x!;
      view.ty = height / 2 - view.k * n.y!;
      draw();
    };
    sim.on("tick", draw);

    function nodeAt(sx: number, sy: number): SimNode | null {
      const { x, y } = toWorld(sx, sy);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        if (n.x == null) continue;
        const dx = n.x! - x;
        const dy = n.y! - y;
        const d = dx * dx + dy * dy;
        const hit = radiusOf(n) + 6;
        if (d < hit * hit && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }

    let dragging: SimNode | null = null;
    let panning: { x: number; y: number } | null = null;
    let moved = false;

    function toLocal(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onDown(e: MouseEvent) {
      const { x, y } = toLocal(e);
      moved = false;
      const n = nodeAt(x, y);
      if (n) {
        dragging = n;
        sim.alphaTarget(0.2).restart();
      } else {
        panning = { x: x - view.tx, y: y - view.ty };
      }
    }

    function onMove(e: MouseEvent) {
      const { x, y } = toLocal(e);
      if (dragging) {
        moved = true;
        const world = toWorld(x, y);
        dragging.fx = world.x;
        dragging.fy = world.y;
        return;
      }
      if (panning) {
        moved = true;
        view.tx = x - panning.x;
        view.ty = y - panning.y;
        draw();
        return;
      }
      const hovered = nodeAt(x, y);
      canvas!.style.cursor = hovered ? "pointer" : "grab";
      const nextHover = hovered?.id || null;
      if (nextHover !== paintRef.current.hoverId) {
        paintRef.current.hoverId = nextHover;
        draw();
      }
    }

    function onUp(e: MouseEvent) {
      const wasDragging = dragging;
      const wasPanning = panning;
      if (dragging) {
        dragging.fx = null;
        dragging.fy = null;
        dragging = null;
        sim.alphaTarget(0);
      }
      panning = null;
      // This listener is on the window so a drag can finish outside the canvas. Only
      // an interaction that *started* on the canvas is a graph click; without this a
      // click on the sidebar would land here and clear the focus out from under it.
      if (!wasDragging && !wasPanning) return;
      if (moved) return;

      const { x, y } = toLocal(e);
      const n = nodeAt(x, y);
      if (!n) {
        setFocusId(null);
        setPathTargetId(null);
        return;
      }
      // Shift-click traces a route from the already focused node to this one.
      if (e.shiftKey && focusRef.current && focusRef.current !== n.id) {
        setPathTargetId(n.id);
        return;
      }
      setPathTargetId(null);
      setFocusId(n.id);
    }

    function onDoubleClick(e: MouseEvent) {
      const { x, y } = toLocal(e);
      const n = nodeAt(x, y);
      if (n) onOpenRef.current(n.id);
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { x, y } = toLocal(e);
      const before = toWorld(x, y);
      const next = Math.min(4, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      view.k = next;
      // Keep the point under the cursor pinned while zooming.
      view.tx = x - before.x * view.k;
      view.ty = y - before.y * view.k;
      draw();
    }

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    return () => {
      sim.stop();
      redrawRef.current = () => {};
      centerOnRef.current = () => {};
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      ro.disconnect();
    };
  }, [visible]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setFocusId(null);
      setPathTargetId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle<T>(set: Set<T>, value: T, apply: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  function reveal(id: string) {
    setPathTargetId(null);
    setFocusId(id);
    setSearch("");
    // Let the focus repaint land before recentring on the node.
    requestAnimationFrame(() => centerOnRef.current(id));
  }

  const typeCounts = useMemo(() => {
    const counts = { paper: 0, note: 0, question: 0 } as Record<GraphNodeType, number>;
    for (const n of data.nodes) counts[n.type]++;
    return counts;
  }, [data]);

  return (
    <div className="flex h-full min-h-0">
      <div ref={wrapRef} className="flex-1 min-w-0 relative">
        {visible.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-slate-500 text-sm">
            {data.nodes.length === 0
              ? "Add papers and notes, link them with [[wikilinks]], and they will appear here."
              : "Every node is hidden by the current filters."}
          </div>
        )}
        <canvas ref={canvasRef} />

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="relative">
            <IconSearch
              width={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a node"
              className="lat-input !py-1.5 !pl-8 !w-56 text-xs"
            />
            {searchHits.length > 0 && (
              <div className="absolute z-10 mt-1 w-72 rounded-lg border border-slate-800 bg-slate-950 shadow-xl overflow-hidden">
                {searchHits.map((hit) => (
                  <button
                    key={hit.id}
                    onClick={() => reveal(hit.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-900"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CANVAS_PAINT[theme].nodes[hit.type] }}
                    />
                    <span className="truncate text-slate-300">{hit.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {focusId && (
            <button
              onClick={() => {
                setFocusId(null);
                setPathTargetId(null);
              }}
              className="lat-chip"
            >
              Clear focus
            </button>
          )}
        </div>

        <div className="absolute bottom-3 left-3 text-[11px] text-slate-600">
          Click to focus · Shift-click to trace a path · Double-click to open · Scroll to zoom
        </div>
      </div>

      <aside className="w-72 shrink-0 border-l border-slate-800 overflow-y-auto text-sm">
        {/* Grouping first: it decides what every colour in the graph means, so it
            belongs above the things it explains. */}
        <section className="border-b border-slate-800 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Group by</p>
          <div className="mt-1.5 flex rounded-lg border border-veil/[.07] bg-well/20 p-0.5 text-xs">
            {([
              ["project", "Project"],
              ["subject", "Subject"],
              ["none", "Nothing"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => onGroupingMode(mode)}
                className={`flex-1 rounded-md px-2 py-1 ${
                  groupingMode === mode ? "bg-veil/10 text-cyan-300" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-slate-600">
            {groupingMode === "project"
              ? "Coloured and clustered by the projects you have filed things into."
              : groupingMode === "subject"
              ? "Groups proposed from what the papers are about — titles, tags, and abstracts. Nothing is filed until you say so."
              : "No grouping: every node the same, positioned only by its links."}
          </p>

          {groupingMode !== "none" && (
            grouping.groups.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-veil/[.08] px-3 py-3 text-[11px] leading-4 text-slate-600">
                {groupingMode === "project"
                  ? "Nothing is filed into a project yet. Switch to Subject and lattice will propose groups from the papers themselves."
                  : "Not enough shared content to propose subjects yet. A handful more papers and this will fill in."}
              </p>
            ) : (
              <ul className="mt-3 space-y-1">
                {grouping.groups.map((group) => (
                  <li key={group.id} className="group/row">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: group.color }}
                      />
                      <button
                        onClick={() => setFocusId(group.nodeIds[0] || null)}
                        className="min-w-0 flex-1 truncate text-left text-xs text-slate-300 hover:text-slate-100"
                        title={group.terms?.length ? `Defined by: ${group.terms.join(", ")}` : group.label}
                      >
                        {group.label}
                      </button>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
                        {group.nodeIds.length}
                      </span>
                      {!group.isProject && (
                        <button
                          onClick={() => onAdoptGroup(group)}
                          className="shrink-0 text-slate-700 opacity-0 hover:text-cyan-300 group-hover/row:opacity-100 focus:opacity-100"
                          title={`Create a project from "${group.label}" and file these ${group.nodeIds.length} papers into it`}
                          aria-label={`Make "${group.label}" a project`}
                        >
                          <IconPlus width={12} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
          {groupingMode === "subject" && grouping.groups.length > 0 && (
            <p className="mt-2 text-[11px] leading-4 text-slate-600">
              Hover a group and press + to turn the proposal into a real project.
            </p>
          )}
        </section>

        {focusId && (
          <section className="border-b border-slate-800 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">In focus</p>
            <p className="mt-1 font-medium leading-snug text-slate-200">
              {labelOf.get(focusId) || "Unknown node"}
            </p>
            {pathIds.length > 0 ? (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-slate-400">
                  {pathIds.length - 1} hop{pathIds.length - 1 === 1 ? "" : "s"} to{" "}
                  {labelOf.get(pathTargetId || "")}
                </p>
                <ol className="space-y-0.5 text-xs text-slate-400">
                  {pathIds.map((id, i) => (
                    <li key={id} className="truncate">
                      <span className="text-slate-600">{i + 1}.</span> {labelOf.get(id)}
                    </li>
                  ))}
                </ol>
              </div>
            ) : pathTargetId ? (
              <p className="mt-2 text-xs text-amber-300/80">
                No route to {labelOf.get(pathTargetId)}. These sit in separate islands.
              </p>
            ) : (
              <div className="mt-2 flex items-center gap-1">
                <span className="text-xs text-slate-500">Show</span>
                {[1, 2].map((d) => (
                  <button
                    key={d}
                    onClick={() => setFocusDepth(d)}
                    className={`lat-chip ${focusDepth === d ? "!border-slate-500 !text-slate-200" : ""}`}
                  >
                    {d} hop{d === 1 ? "" : "s"}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => onOpenNode(focusId)}
              className="mt-2 text-xs text-sky-400 hover:text-sky-300"
            >
              Open this node →
            </button>
          </section>
        )}

        <section className="border-b border-slate-800 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Show</p>
          <div className="mt-2 space-y-1">
            {ALL_TYPES.filter((t) => typeCounts[t] > 0).map((type) => (
              <label key={type} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!hiddenTypes.has(type)}
                  onChange={() => toggle(hiddenTypes, type, setHiddenTypes)}
                />
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: CANVAS_PAINT[theme].nodes[type] }}
                />
                <span className="text-slate-300">{NODE_LABELS[type]}</span>
                <span className="ml-auto text-slate-600">{typeCounts[type]}</span>
              </label>
            ))}
          </div>
          {kindsPresent.length > 0 && (
            <div className="mt-3 space-y-1">
              {ALL_KINDS.filter((k) => kindsPresent.includes(k)).map((kind) => (
                <label key={kind} className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!hiddenKinds.has(kind)}
                    onChange={() => toggle(hiddenKinds, kind, setHiddenKinds)}
                  />
                  <span
                    className="h-0.5 w-3 rounded"
                    style={{ background: CANVAS_PAINT[theme].edges[kind] }}
                  />
                  <span className="text-slate-400">{EDGE_LABELS[kind]}</span>
                </label>
              ))}
            </div>
          )}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={hideOrphans}
              onChange={() => setHideOrphans((v) => !v)}
            />
            <span className="text-slate-400">Hide unconnected nodes</span>
          </label>
        </section>

        <section className="border-b border-slate-800 p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Shape</p>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-400">Nodes / links</dt>
              <dd className="text-slate-300">
                {insights.nodeCount} / {insights.edgeCount}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Separate islands</dt>
              <dd className="text-slate-300">{insights.componentCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Largest island</dt>
              <dd className="text-slate-300">
                {insights.largestComponentSize} node
                {insights.largestComponentSize === 1 ? "" : "s"}
              </dd>
            </div>
          </dl>
          {insights.componentCount > 1 && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              More than one island means parts of your library are not yet connected to
              the rest of your thinking.
            </p>
          )}
        </section>

        {insights.hubs.length > 0 && (
          <section className="border-b border-slate-800 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Load bearing
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              The most connected nodes: what your thinking currently rests on.
            </p>
            <ul className="mt-2 space-y-1">
              {insights.hubs.map((hub) => (
                <li key={hub.node.id}>
                  <button
                    onClick={() => reveal(hub.node.id)}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-900"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CANVAS_PAINT[theme].nodes[hub.node.type] }}
                    />
                    <span className="truncate text-slate-300">{hub.node.label}</span>
                    <span className="ml-auto shrink-0 text-slate-600">{hub.degree}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {insights.unevidencedQuestions.length > 0 && (
          <section className="border-b border-slate-800 p-3">
            <p className="text-[11px] uppercase tracking-wide text-amber-500/80">
              Questions with no evidence
            </p>
            <ul className="mt-2 space-y-1">
              {insights.unevidencedQuestions.map((q) => (
                <li key={q.id}>
                  <button
                    onClick={() => reveal(q.id)}
                    className="w-full truncate rounded px-1 py-0.5 text-left text-xs text-slate-300 hover:bg-slate-900"
                  >
                    {q.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {insights.orphans.length > 0 && (
          <section className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Not yet connected
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Saved, but linked to nothing. Each one is a note waiting to be written.
            </p>
            <ul className="mt-2 space-y-1">
              {insights.orphans.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => reveal(n.id)}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-900"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CANVAS_PAINT[theme].nodes[n.type] }}
                    />
                    <span className="truncate text-slate-400">{n.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            {insights.orphans.length > 12 && (
              <p className="mt-1 text-[11px] text-slate-600">
                and {insights.orphans.length - 12} more
              </p>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
