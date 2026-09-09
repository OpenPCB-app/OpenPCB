// Footprint courtyard → world-space polygon for the cloud snapshot.
//
// The placer's legality oracle prefers a real courtyard over its pad-hull proxy; without
// one it inflates the pad bounding hull, which is wrong in both directions (too small for
// a connector with a mating keepout, too large for a fine-pitch IC).
//
// COURTYARD AVAILABILITY IS BIFURCATED BY PROVENANCE, and that is the whole difficulty:
//
//   * IPC-7351B-generated and drawn-editor footprints keep every layer in the placement's
//     embedded render model, so `F.CrtYd`/`B.CrtYd` graphics are right there.
//   * The KiCad importer whitelists SilkS + Fab and DROPS CrtYd before persistence, so an
//     imported placement's render model has no courtyard at all. The full parsed footprint
//     does survive in `library_footprints.data_json.raw`, which is why this module accepts
//     an optional raw-footprint lookup: same board, two different retrieval paths.
//
// CONVEX HULL, deliberately. Courtyard geometry arrives as loose graphics (lines, rects,
// arcs, polylines) that would have to be stitched into a ring — fragile, and pointless
// here: the place engine convexifies the polygon for its integer-SAT overlap test anyway
// (`app/place` convex-SAT courtyards). Hulling the courtyard POINTS is therefore lossless
// with respect to what the consumer computes, and it cannot produce a self-intersecting or
// unclosed ring. A concave courtyard is over-approximated by exactly the amount the engine
// would have over-approximated it itself.
//
// Never synthesize a courtyard. No courtyard data ⇒ emit nothing ⇒ the service falls back
// to its pad-derived proxy, which is an honest answer.

import type { PcbPlacedPart, PcbPointMm } from "../../sdks/designer";
import {
  arcChordPoints,
  arcSegmentCount,
} from "./arc-chords";
import { placementMirrorX, transformPadCenterMm } from "./pad-geometry";

/** Minimum vertices for a polygon the service will accept. */
const MIN_RING_POINTS = 3;
/** Arc/circle flattening resolution — enough that the hull is not visibly polygonal. */
const CIRCLE_SEGMENTS = 16;

type PreviewGraphicLike = {
  kind: string;
  layer?: string;
  [key: string]: unknown;
};

export interface RawFootprintLookup {
  /** `library_footprints.data_json` for a footprint id, or null when unavailable. */
  (footprintId: string): Record<string, unknown> | null | undefined;
}

function isCourtyardLayer(layer: unknown): boolean {
  return layer === "F.CrtYd" || layer === "B.CrtYd";
}

function pushPoint(out: PcbPointMm[], x: unknown, y: unknown): void {
  if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
    out.push({ x, y });
  }
}

export interface CourtyardOptions {
  /**
   * Flatten circles and arcs OUTWARD (circumscribed) so the hull CONTAINS the
   * true curve. The keepout `footprints` extent needs a declared superset of
   * the part (zone/keepout contract §4, §13.1); the cloud snapshot keeps the
   * plain vertex hull (an inscribed 16-gon / the arc's three defining points),
   * which undershoots a circle of radius r by r·(1 − cos(π/16)) ≈ 1.9 % and an
   * arc by its whole bulge.
   */
  superset?: boolean;
}

function pushCircle(
  out: PcbPointMm[],
  cx: number,
  cy: number,
  r: number,
  superset: boolean,
): void {
  if (!Number.isFinite(r) || r <= 0) return;
  // Circumscribed: vertices at r·sec(π/N) so every edge is tangent to the circle.
  const rr = superset ? r / Math.cos(Math.PI / CIRCLE_SEGMENTS) : r;
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const t = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    out.push({ x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) });
  }
}

/** Circle through three points, or null when they are (nearly) collinear. */
function circumcircle(
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
): { center: PcbPointMm; r: number } | null {
  const d =
    2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - ux, a.y - uy);
  if (!Number.isFinite(r) || r <= 0) return null;
  return { center: { x: ux, y: uy }, r };
}

const TWO_PI = 2 * Math.PI;

function normAngle(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/**
 * Points for a three-point arc. Plain hull: the three defining points (the
 * consumer convexifies). Superset: the S2 circumscribed tangent chain from
 * `start` to `end` through `mid`, so the hull contains the whole bulge.
 */
function pushArc3(
  out: PcbPointMm[],
  start: PcbPointMm,
  mid: PcbPointMm,
  end: PcbPointMm,
  superset: boolean,
): void {
  const pts = [start, mid, end];
  if (!pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return;
  if (!superset) {
    for (const p of pts) out.push(p);
    return;
  }
  const circle = circumcircle(start, mid, end);
  if (!circle) {
    for (const p of pts) out.push(p);
    return;
  }
  const { center, r } = circle;
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const am = Math.atan2(mid.y - center.y, mid.x - center.x);
  const ae = Math.atan2(end.y - center.y, end.x - center.x);
  // Sweep in the direction that passes through `mid`.
  const ccwToEnd = normAngle(ae - a0);
  const ccwToMid = normAngle(am - a0);
  const a1 = ccwToMid <= ccwToEnd ? a0 + ccwToEnd : a0 - (TWO_PI - ccwToEnd);
  const steps = arcSegmentCount(r, a1 - a0, "circumscribed");
  out.push(start);
  for (const p of arcChordPoints(center, r, a0, a1, steps, "circumscribed", end)) {
    out.push(p);
  }
}

/** Footprint-local points contributed by one render-model graphic. */
function previewGraphicPoints(
  graphic: PreviewGraphicLike,
  out: PcbPointMm[],
  superset: boolean,
): void {
  const g = graphic as Record<string, any>;
  switch (graphic.kind) {
    case "line":
      pushPoint(out, g.a?.x, g.a?.y);
      pushPoint(out, g.b?.x, g.b?.y);
      return;
    case "rect": {
      const { x, y, width, height } = g;
      if ([x, y, width, height].every((v) => typeof v === "number")) {
        pushPoint(out, x, y);
        pushPoint(out, x + width, y);
        pushPoint(out, x + width, y + height);
        pushPoint(out, x, y + height);
      }
      return;
    }
    case "circle":
      if (typeof g.center?.x === "number" && typeof g.center?.y === "number") {
        pushCircle(out, g.center.x, g.center.y, g.radiusMm, superset);
      }
      return;
    case "arc3":
      // Plain: the three defining points (the consumer convexifies). The bulge
      // beyond the chord/mid triangle is NOT bounded by it — a superset needs
      // the circumscribed chain (`pushArc3`).
      if (isPoint(g.start) && isPoint(g.mid) && isPoint(g.end)) {
        pushArc3(out, g.start, g.mid, g.end, superset);
      }
      return;
    case "polyline":
    case "bezier":
      if (Array.isArray(g.points)) {
        for (const p of g.points) pushPoint(out, p?.x, p?.y);
      }
      return;
    default:
      return;
  }
}

function isPoint(p: unknown): p is PcbPointMm {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof (p as { x?: unknown }).x === "number" &&
    typeof (p as { y?: unknown }).y === "number"
  );
}

/** Footprint-local points contributed by one RAW (KiCad-parsed) graphic. */
function rawGraphicPoints(
  graphic: Record<string, any>,
  out: PcbPointMm[],
  superset: boolean,
): void {
  const data = (graphic.data ?? {}) as Record<string, any>;
  switch (graphic.type) {
    case "line":
      pushPoint(out, data.start?.x, data.start?.y);
      pushPoint(out, data.end?.x, data.end?.y);
      return;
    case "rect":
      if (data.start && data.end) {
        pushPoint(out, data.start.x, data.start.y);
        pushPoint(out, data.end.x, data.start.y);
        pushPoint(out, data.end.x, data.end.y);
        pushPoint(out, data.start.x, data.end.y);
      }
      return;
    case "circle":
      if (data.center && data.end) {
        const r = Math.hypot(data.end.x - data.center.x, data.end.y - data.center.y);
        pushCircle(out, data.center.x, data.center.y, r, superset);
      }
      return;
    case "arc":
      if (isPoint(data.start) && isPoint(data.mid) && isPoint(data.end)) {
        pushArc3(out, data.start, data.mid, data.end, superset);
      }
      return;
    case "poly":
      if (Array.isArray(data.points)) {
        for (const p of data.points) pushPoint(out, p?.x, p?.y);
      }
      return;
    default:
      return;
  }
}

/** Andrew's monotone chain. Returns CCW hull, or [] when fewer than 3 distinct points. */
export function convexHull(points: readonly PcbPointMm[]): PcbPointMm[] {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const deduped: PcbPointMm[] = [];
  for (const p of pts) {
    const last = deduped[deduped.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) deduped.push(p);
  }
  if (deduped.length < MIN_RING_POINTS) return [];

  const cross = (o: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (source: PcbPointMm[]): PcbPointMm[] => {
    const chain: PcbPointMm[] = [];
    for (const p of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, p) <= 0) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop(); // shared endpoint with the other chain
    return chain;
  };

  const hull = [...build(deduped), ...build([...deduped].reverse())];
  return hull.length >= MIN_RING_POINTS ? hull : [];
}

/** Footprint-local courtyard points from the placement's embedded render model. */
function localPointsFromPreview(
  placement: PcbPlacedPart,
  superset: boolean,
): PcbPointMm[] {
  const graphics = placement.footprint?.preview?.graphics as
    | readonly PreviewGraphicLike[]
    | undefined;
  if (!graphics) return [];
  const out: PcbPointMm[] = [];
  for (const g of graphics) {
    if (isCourtyardLayer(g.layer)) previewGraphicPoints(g, out, superset);
  }
  return out;
}

/** Footprint-local courtyard points from the stored raw KiCad footprint. */
function localPointsFromRaw(
  data: Record<string, unknown> | null | undefined,
  superset: boolean,
): PcbPointMm[] {
  const raw = (data as any)?.raw;
  const graphics = raw?.graphics;
  if (!Array.isArray(graphics)) return [];
  const out: PcbPointMm[] = [];
  for (const g of graphics) {
    if (g && isCourtyardLayer(g.layer)) rawGraphicPoints(g, out, superset);
  }
  return out;
}

/**
 * World-space courtyard polygon for a placement, or `null` when the footprint carries no
 * courtyard geometry on either path.
 *
 * `lookupRaw` is optional: pass it to recover courtyards for KiCad-imported footprints
 * (whose render model has none), omit it for a pure projection-only build.
 */
export function placementCourtyardWorldMm(
  placement: PcbPlacedPart,
  lookupRaw?: RawFootprintLookup,
  options: CourtyardOptions = {},
): PcbPointMm[] | null {
  const superset = options.superset === true;
  let local = localPointsFromPreview(placement, superset);
  if (local.length === 0 && lookupRaw) {
    const footprintId = placement.footprint?.footprintId;
    if (footprintId) local = localPointsFromRaw(lookupRaw(footprintId), superset);
  }
  if (local.length < MIN_RING_POINTS) return null;

  // Same transform the pads use — and the same one the service pins in app/place/model.py:
  // world = pos + R_ccw(rotationDeg)·(s·local.x, local.y), s = -1 iff mirrored || B.Cu.
  const mirrored = placementMirrorX(placement);
  const world = local.map((p) => {
    const t = transformPadCenterMm(p, placement.rotationDeg, mirrored);
    return { x: placement.positionMm.x + t.x, y: placement.positionMm.y + t.y };
  });

  // Hull AFTER transforming: mirroring reverses winding, so hulling first would emit a
  // clockwise ring for back-side parts.
  const hull = convexHull(world);
  return hull.length >= MIN_RING_POINTS ? hull : null;
}
