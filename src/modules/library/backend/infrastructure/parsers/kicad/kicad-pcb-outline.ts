/**
 * Edge.Cuts geometry of a `.kicad_pcb`.
 *
 * `parseEdgeCutPrimitives` (H14 §3.10.1) returns EVERY Edge.Cuts primitive —
 * top-level `gr_*` and footprint `fp_*` alike — with arcs and circles kept
 * exact (three-point arcs, centre + edge-point circles); the planner chains
 * them into loops. Footprint primitives stay in footprint-local coordinates
 * and name their footprint, because composing them onto the board is the
 * frame's job, not the parser's.
 *
 * `computeBoardOutline` / `computeBoardOutlinePolygon` are the pre-H14
 * single-loop assembly the current commit pipeline still reads.
 */

import {
  type SExpr,
  findNode,
  findNodes,
  getNumberValue,
  getStringValue,
} from "@openpcb/kicad-parsers";
import {
  type KicadPointMm,
  readPointTagged,
  tessellateArcChords,
} from "./kicad-pcb-common";

export interface ParsedKicadPcbEdgeSource {
  /** `gr_line`, `fp_arc`, `gr_rect`, … */
  token: string;
  /** Ordinal of the source token among its parent's children, in file order. */
  index: number;
  /** File-order index of the owning `(footprint …)`; `null` = board level. */
  footprintIndex: number | null;
  reference: string | null;
}

/**
 * Lines, three-point arcs and full circles. A `gr_rect` becomes four lines
 * and a `gr_poly` its closed chain of lines and arcs, all sharing the source.
 */
export type ParsedKicadPcbEdgePrimitive =
  | {
      kind: "line";
      start: KicadPointMm;
      end: KicadPointMm;
      source: ParsedKicadPcbEdgeSource;
    }
  | {
      kind: "arc";
      start: KicadPointMm;
      mid: KicadPointMm;
      end: KicadPointMm;
      source: ParsedKicadPcbEdgeSource;
    }
  | {
      kind: "circle";
      center: KicadPointMm;
      /** A point on the circle (`(end …)`). */
      edge: KicadPointMm;
      source: ParsedKicadPcbEdgeSource;
    };

export interface ParsedKicadPcbBoardOutline {
  minXMm: number;
  minYMm: number;
  maxXMm: number;
  maxYMm: number;
}

const EDGE_CUTS = "Edge.Cuts";

/** Board `gr_*` Edge.Cuts primitives, then each footprint's `fp_*` ones. */
export function parseEdgeCutPrimitives(
  expr: SExpr[],
): ParsedKicadPcbEdgePrimitive[] {
  const out: ParsedKicadPcbEdgePrimitive[] = [];
  collectEdgeChildren(expr, "gr_", null, null, out);
  let footprintIndex = 0;
  for (const child of expr) {
    if (!Array.isArray(child) || child[0] !== "footprint") continue;
    const reference = footprintReference(child);
    collectEdgeChildren(child, "fp_", footprintIndex, reference, out);
    footprintIndex += 1;
  }
  return out;
}

function collectEdgeChildren(
  parent: SExpr[],
  prefix: "gr_" | "fp_",
  footprintIndex: number | null,
  reference: string | null,
  out: ParsedKicadPcbEdgePrimitive[],
): void {
  for (const [index, child] of parent.entries()) {
    if (!Array.isArray(child) || typeof child[0] !== "string") continue;
    if (!child[0].startsWith(prefix)) continue;
    if (getStringValue(findNode(child, "layer") ?? [], 1) !== EDGE_CUTS)
      continue;
    const source: ParsedKicadPcbEdgeSource = {
      token: child[0],
      index,
      footprintIndex,
      reference,
    };
    out.push(...edgePrimitivesOf(child, child[0].slice(prefix.length), source));
  }
}

function edgePrimitivesOf(
  node: SExpr[],
  shape: string,
  source: ParsedKicadPcbEdgeSource,
): ParsedKicadPcbEdgePrimitive[] {
  const at = (tag: string): KicadPointMm | null =>
    readPointTagged(findNode(node, tag));
  if (shape === "line") {
    const start = at("start");
    const end = at("end");
    return start && end ? [{ kind: "line", start, end, source }] : [];
  }
  if (shape === "arc") {
    const start = at("start");
    const mid = at("mid");
    const end = at("end");
    return start && mid && end
      ? [{ kind: "arc", start, mid, end, source }]
      : [];
  }
  if (shape === "circle") {
    const center = at("center");
    const edge = at("end");
    return center && edge ? [{ kind: "circle", center, edge, source }] : [];
  }
  if (shape === "rect") {
    const s = at("start");
    const e = at("end");
    if (!s || !e) return [];
    return closedLines(
      [s, { xMm: e.xMm, yMm: s.yMm }, e, { xMm: s.xMm, yMm: e.yMm }],
      source,
    );
  }
  if (shape === "poly") return polyPrimitives(node, source);
  // gr_curve, gr_text_box, … on Edge.Cuts: left to the census.
  return [];
}

function closedLines(
  corners: readonly KicadPointMm[],
  source: ParsedKicadPcbEdgeSource,
): ParsedKicadPcbEdgePrimitive[] {
  return corners.map((start, i) => ({
    kind: "line" as const,
    start,
    end: corners[(i + 1) % corners.length]!,
    source,
  }));
}

/** `(pts (xy …) (arc (start)(mid)(end)) …)` as a closed line/arc chain. */
function polyPrimitives(
  node: SExpr[],
  source: ParsedKicadPcbEdgeSource,
): ParsedKicadPcbEdgePrimitive[] {
  const pts = findNode(node, "pts");
  if (!pts) return [];
  const out: ParsedKicadPcbEdgePrimitive[] = [];
  const chain: { first: KicadPointMm | null; tail: KicadPointMm | null } = {
    first: null,
    tail: null,
  };
  const lineTo = (p: KicadPointMm): void => {
    const tail = chain.tail;
    if (tail && (tail.xMm !== p.xMm || tail.yMm !== p.yMm))
      out.push({ kind: "line", start: tail, end: p, source });
    chain.first ??= p;
    chain.tail = p;
  };
  for (const child of pts.slice(1)) {
    if (!Array.isArray(child)) continue;
    if (child[0] === "xy") {
      const p = readPointTagged(child);
      if (p) lineTo(p);
      continue;
    }
    if (child[0] !== "arc") continue;
    const start = readPointTagged(findNode(child, "start"));
    const mid = readPointTagged(findNode(child, "mid"));
    const end = readPointTagged(findNode(child, "end"));
    if (!start || !mid || !end) continue;
    lineTo(start);
    out.push({ kind: "arc", start, mid, end, source });
    chain.tail = end;
  }
  if (chain.first) lineTo(chain.first);
  return out;
}

function footprintReference(node: SExpr[]): string | null {
  for (const prop of findNodes(node, "property")) {
    if (getStringValue(prop, 1) === "Reference") return getStringValue(prop, 2);
  }
  for (const fp of findNodes(node, "fp_text")) {
    if (getStringValue(fp, 1) === "reference") return getStringValue(fp, 2);
  }
  return null;
}

export function computeBoardOutline(
  expr: SExpr[],
): ParsedKicadPcbBoardOutline | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let foundAny = false;

  const accumulatePoint = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    foundAny = true;
  };

  const visitGraphic = (node: SExpr[]): void => {
    const layer = getStringValue(findNode(node, "layer") ?? [], 1);
    if (layer !== EDGE_CUTS) return;
    for (const tag of ["start", "end", "center", "mid"] as const) {
      const p = readPointTagged(findNode(node, tag));
      if (p) accumulatePoint(p.xMm, p.yMm);
    }
    const pts = findNode(node, "pts");
    if (pts) {
      for (const xy of findNodes(pts, "xy")) {
        const x = getNumberValue(xy, 1);
        const y = getNumberValue(xy, 2);
        if (x !== null && y !== null) accumulatePoint(x, y);
      }
    }
  };

  for (const tag of ["gr_line", "gr_rect", "gr_arc", "gr_circle", "gr_poly"]) {
    for (const node of findNodes(expr, tag)) visitGraphic(node);
  }

  if (!foundAny) return null;
  return { minXMm: minX, minYMm: minY, maxXMm: maxX, maxYMm: maxY };
}

/**
 * Best-effort assembly of Edge.Cuts graphics into a single closed polyline.
 * Walks gr_line / gr_arc / gr_rect / gr_circle / gr_poly tokens, tessellates
 * arcs / circles, then chains by nearest-endpoint adjacency. Falls back to
 * the bbox-rect path (callers handle `null`) when the graphics don't form a
 * single closed loop.
 */
export function computeBoardOutlinePolygon(
  expr: SExpr[],
): KicadPointMm[] | null {
  type Edge = { a: KicadPointMm; b: KicadPointMm };
  const edges: Edge[] = [];
  const pushEdge = (a: KicadPointMm, b: KicadPointMm): void => {
    if (Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) < 1e-6) return;
    edges.push({ a, b });
  };

  for (const node of findNodes(expr, "gr_line")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== EDGE_CUTS)
      continue;
    const s = readPointTagged(findNode(node, "start"));
    const e = readPointTagged(findNode(node, "end"));
    if (s && e) pushEdge(s, e);
  }
  for (const node of findNodes(expr, "gr_arc")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== EDGE_CUTS)
      continue;
    const s = readPointTagged(findNode(node, "start"));
    const m = readPointTagged(findNode(node, "mid"));
    const e = readPointTagged(findNode(node, "end"));
    if (!s || !m || !e) continue;
    // Tessellate the arc into chord segments (same algorithm as track arcs).
    const tessellated = tessellateArcChords(s, m, e, 16);
    for (let i = 1; i < tessellated.length; i += 1) {
      pushEdge(tessellated[i - 1]!, tessellated[i]!);
    }
  }
  for (const node of findNodes(expr, "gr_rect")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== EDGE_CUTS)
      continue;
    const s = readPointTagged(findNode(node, "start"));
    const e = readPointTagged(findNode(node, "end"));
    if (!s || !e) continue;
    const corners: KicadPointMm[] = [
      { xMm: s.xMm, yMm: s.yMm },
      { xMm: e.xMm, yMm: s.yMm },
      { xMm: e.xMm, yMm: e.yMm },
      { xMm: s.xMm, yMm: e.yMm },
    ];
    for (let i = 0; i < corners.length; i += 1) {
      pushEdge(corners[i]!, corners[(i + 1) % corners.length]!);
    }
  }
  for (const node of findNodes(expr, "gr_circle")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== EDGE_CUTS)
      continue;
    const center = readPointTagged(findNode(node, "center"));
    const end = readPointTagged(findNode(node, "end"));
    if (!center || !end) continue;
    const r = Math.hypot(end.xMm - center.xMm, end.yMm - center.yMm);
    const segments = 64;
    let prev: KicadPointMm | null = null;
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * 2 * Math.PI;
      const p: KicadPointMm = {
        xMm: center.xMm + r * Math.cos(t),
        yMm: center.yMm + r * Math.sin(t),
      };
      if (prev) pushEdge(prev, p);
      prev = p;
    }
  }
  for (const node of findNodes(expr, "gr_poly")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== EDGE_CUTS)
      continue;
    const pts = findNode(node, "pts");
    if (!pts) continue;
    const points: KicadPointMm[] = [];
    for (const xy of findNodes(pts, "xy")) {
      const x = getNumberValue(xy, 1);
      const y = getNumberValue(xy, 2);
      if (x !== null && y !== null) points.push({ xMm: x, yMm: y });
    }
    for (let i = 0; i < points.length; i += 1) {
      pushEdge(points[i]!, points[(i + 1) % points.length]!);
    }
  }
  if (edges.length === 0) return null;

  // Chain edges into a single ordered polyline by nearest-endpoint matching.
  const epsilon = 0.01; // mm — KiCad outline endpoints are typically exact.
  const sameish = (a: KicadPointMm, b: KicadPointMm): boolean =>
    Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) < epsilon;
  const consumed = new Array<boolean>(edges.length).fill(false);
  const start = edges[0]!;
  consumed[0] = true;
  const poly: KicadPointMm[] = [start.a, start.b];
  let tail = start.b;
  for (let safety = 0; safety < edges.length * 2; safety += 1) {
    const next = edges.findIndex(
      (e, i) => !consumed[i] && (sameish(e.a, tail) || sameish(e.b, tail)),
    );
    if (next === -1) break;
    consumed[next] = true;
    const e = edges[next]!;
    tail = sameish(e.a, tail) ? e.b : e.a;
    poly.push(tail);
    if (sameish(tail, start.a)) break; // closed loop
  }
  // Only return when the chain actually closes; otherwise the outline has
  // disjoint segments and the rectangle bbox fallback is safer.
  if (!sameish(poly[poly.length - 1]!, poly[0]!)) return null;
  // Drop the duplicate-closing point.
  if (poly.length > 1) poly.pop();
  return poly;
}
