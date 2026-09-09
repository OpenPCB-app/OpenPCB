/**
 * Advisory milling checks for a routed contour, shared by DRC. Pure geometry.
 *
 *  - Internal corner radius: a routed corner can't be sharper than the
 *    router-bit radius.
 *  - Slot / neck width: the narrowest void the cutter has to fit into.
 *
 * Both read the same rings for the board OUTLINE and for a CUTOUT, but which
 * side of the ring the material is on flips which corners are un-millable, so
 * every entry point takes that as a parameter (`material`). See
 * `findSmallInternalRadii`.
 */
import type {
  PcbBoardContour,
  PcbBoardOutline,
  PcbBoardOutlinePolygon,
  PcbPointMm,
} from "../../../sdks";
// The shared segment kernel (S2 geometry contract §2) — a superset of the
// private endpoint-projection helper this file used to carry: it also reports 0
// for edges that actually touch, which a validated ring never has.
import { segmentToSegmentDistance } from "../../pcb-geometry/pcb-trace-geometry";
import { flattenOutline } from "../../pcb-geometry/outline-geometry";
import { ringSignedArea } from "../../pcb-geometry/ring-utils";
import { segmentsIntersect } from "../../pcb-geometry/segment-predicates";

/**
 * Kept at 0.1 µm rather than folded into `GEOM_EPS_MM` / `DRC_EPS_MM`: those
 * are float-noise floors for exact-spec geometry, while this is the ADVISORY
 * grace of a fab capability tier — a corner or neck may miss a router-bit
 * limit by a tenth of a micron without being worth a warning. Tightening it to
 * the noise floor would change verdicts in the 1e-6…1e-4 mm band.
 */
const EPS_MM = 1e-4;

export interface InternalRadiusHit {
  locationMm: PcbPointMm;
  radiusMm: number;
}

/**
 * Which side of the ring the copper substrate is on: `"inside"` for the board
 * outline, `"outside"` for a cutout (the material surrounds the void).
 */
export type RingMaterialSide = "inside" | "outside";

/** Vertex ring + per-edge arc info; edge i connects verts[i] → verts[(i+1)%n]. */
function ringWithArcs(outline: PcbBoardOutlinePolygon | PcbBoardContour): {
  verts: PcbPointMm[];
  arcs: (null | { centerMm: PcbPointMm; cw: boolean })[];
} {
  const verts: PcbPointMm[] = [];
  const arcs: (null | { centerMm: PcbPointMm; cw: boolean })[] = [];
  if (outline.kind === "polygon") {
    for (const p of outline.pointsMm) {
      verts.push({ x: p.x, y: p.y });
      arcs.push(null);
    }
    return { verts, arcs };
  }
  verts.push({ x: outline.start.x, y: outline.start.y });
  for (let i = 0; i < outline.segments.length - 1; i += 1) {
    verts.push({ x: outline.segments[i]!.to.x, y: outline.segments[i]!.to.y });
  }
  for (const seg of outline.segments) {
    arcs.push(seg.type === "arc" ? { centerMm: seg.centerMm, cw: seg.cw } : null);
  }
  return { verts, arcs };
}

/** The four bounding-box corners of a parametric shape, in a fixed order. */
function boxCorners(shape: {
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
}): PcbPointMm[] {
  const hw = shape.widthMm / 2;
  const hh = shape.heightMm / 2;
  const { x, y } = shape.centerMm;
  return [
    { x: x - hw, y: y - hh },
    { x: x + hw, y: y - hh },
    { x: x + hw, y: y + hh },
    { x: x - hw, y: y + hh },
  ];
}

/**
 * Parametric shapes as a CUTOUT: a rect void has four sharp corners the bit
 * cannot reach into, a roundrect four corners of its declared radius, a circle
 * none. As the board OUTLINE the same shapes are convex with the material
 * inside, so they have no un-millable corner at all — hence the empty result
 * for `"inside"`, which is the pre-S7 behaviour of every parametric outline.
 */
function parametricCornerHits(
  shape: PcbBoardOutline,
  minRadiusMm: number,
  material: RingMaterialSide,
): InternalRadiusHit[] {
  if (material === "inside") return [];
  if (shape.kind !== "rect" && shape.kind !== "roundrect") return [];
  const radiusMm = shape.kind === "roundrect" ? shape.cornerRadiusMm : 0;
  if (!(radiusMm < minRadiusMm - EPS_MM)) return [];
  return boxCorners(shape).map((locationMm) => ({ locationMm, radiusMm }));
}

/**
 * Corners a router bit can't cut: arc corners tighter than `minRadiusMm`, plus
 * sharp line-line corners (effective radius 0). Covers polygon + contour rings,
 * and — for a cutout only — the parametric shapes.
 *
 * Which corners count is decided by winding AND by where the material is. A
 * corner is un-millable when it bites INTO the material: for the board outline
 * (material inside the ring) that is a corner turning AGAINST the winding — a
 * notch cut into the board; for a cutout (material outside) it is the opposite,
 * a corner turning WITH the winding — a sharp corner of the void, which is why
 * a plain rectangular cutout has four of them and no reflex vertex at all. A
 * reflex vertex of a cutout ring is a tip of material the cutter passes around
 * freely. Winding is robust where "is the center inside?" is boundary-ambiguous
 * (fillet centers sit on the edge line).
 */
export function findSmallInternalRadii(
  outline: PcbBoardOutline,
  minRadiusMm: number,
  material: RingMaterialSide = "inside",
): InternalRadiusHit[] {
  if (outline.kind !== "contour" && outline.kind !== "polygon") {
    return parametricCornerHits(outline, minRadiusMm, material);
  }
  const { verts, arcs } = ringWithArcs(outline);
  const n = verts.length;
  if (n < 3) return [];
  // Winding from the FLATTENED contour: a major arc can carry more signed area
  // than its chord, so the endpoint polygon may wind the other way and every
  // material-side verdict would flip (Astra S7 #8).
  const ccw = ringSignedArea(flattenOutline(outline)) > 0;
  const inside = material === "inside";
  /** A turn against the winding is reflex; with it, convex. */
  const bitesIntoMaterial = (cross: number): boolean =>
    inside === ccw ? cross < 0 : cross > 0;
  const hits: InternalRadiusHit[] = [];

  // Arc corners tighter than the bit radius.
  for (let i = 0; i < n; i += 1) {
    const arc = arcs[i];
    if (!arc) continue;
    const from = verts[i]!;
    const r = Math.hypot(from.x - arc.centerMm.x, from.y - arc.centerMm.y);
    if (arc.cw === (inside ? ccw : !ccw) && r < minRadiusMm - EPS_MM) {
      hits.push({ locationMm: { x: from.x, y: from.y }, radiusMm: r });
    }
  }

  // Sharp line-line corners (radius 0). Skip vertices flanked by an arc —
  // those are fillet tangent points, already covered by the arc check.
  for (let j = 0; j < n; j += 1) {
    const inEdge = (j - 1 + n) % n;
    if (arcs[inEdge] || arcs[j]) continue;
    const p = verts[(j - 1 + n) % n]!;
    const v = verts[j]!;
    const q = verts[(j + 1) % n]!;
    const cross = (v.x - p.x) * (q.y - v.y) - (v.y - p.y) * (q.x - v.x);
    if (bitesIntoMaterial(cross) && minRadiusMm > 0) {
      hits.push({ locationMm: { x: v.x, y: v.y }, radiusMm: 0 });
    }
  }
  return hits;
}

/**
 * Coarse vertex ring for slot detection: arc endpoints only, so tessellation
 * chords of one smooth curve never read as a narrow gap against each other.
 * Returns null for parametric shapes (rect / roundrect / circle) — as a board
 * OUTLINE they are convex and have no neck by construction; as a CUTOUT their
 * own width is the void the cutter must fit into, which
 * {@link parametricHoleNarrowestWidthMm} answers directly.
 */
export function boardSlotRing(outline: PcbBoardOutline): PcbPointMm[] | null {
  switch (outline.kind) {
    case "rect":
    case "roundrect":
    case "circle":
      return null;
    case "polygon":
      return outline.pointsMm.map((p) => ({ x: p.x, y: p.y }));
    case "contour":
      return [
        { x: outline.start.x, y: outline.start.y },
        ...outline.segments.slice(0, -1).map((s) => ({ x: s.to.x, y: s.to.y })),
      ];
  }
}

export interface SlotHit {
  locationMm: PcbPointMm;
  gapMm: number;
}

/**
 * The narrowest void a PARAMETRIC cutout presents to the cutter (mm), or null
 * when the shape is a polygon / contour ring — those go through
 * {@link boardSlotRing} + {@link findNarrowestSlot} instead. `widthMm` /
 * `heightMm` are the two diameters of a circle, so the minor axis is the
 * narrowest dimension of an oval as well as of a rect.
 */
export function parametricHoleNarrowestWidthMm(
  shape: PcbBoardOutline,
): number | null {
  switch (shape.kind) {
    case "rect":
    case "roundrect":
    case "circle":
      return Math.min(shape.widthMm, shape.heightMm);
    case "polygon":
    case "contour":
      return null;
  }
}

/**
 * The parametric twin of {@link findNarrowestSlot}, sharing its grace: a hole
 * whose own narrowest dimension is under the bit width cannot be routed at all.
 * Null for a non-parametric shape, and for one the cutter fits into.
 */
export function findParametricHoleSlot(
  shape: PcbBoardOutline,
  minWidthMm: number,
): SlotHit | null {
  const widthMm = parametricHoleNarrowestWidthMm(shape);
  if (widthMm === null || !(widthMm < minWidthMm - EPS_MM)) return null;
  return {
    gapMm: widthMm,
    locationMm: { x: shape.centerMm.x, y: shape.centerMm.y },
  };
}

/**
 * The narrowest gap between non-adjacent edges of the (open) ring, when it is
 * below `minWidthMm` — else null. One report for the thinnest neck / slot.
 */
export function findNarrowestSlot(
  ring: readonly PcbPointMm[],
  minWidthMm: number,
): SlotHit | null {
  const n = ring.length;
  if (n < 4) return null;
  let best: SlotHit | null = null;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      // Skip adjacent edges + the wrap-around pair (they share a vertex).
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      // Edges that touch or cross are an invalid outline (BOARD_OUTLINE_INVALID
      // reports that), not a slot; this coarse arc-endpoint ring is never
      // validated, so the case is reachable here.
      if (segmentsIntersect(a, b, c, d)) continue;
      const gap = segmentToSegmentDistance(a, b, c, d);
      if (gap < minWidthMm - EPS_MM && (!best || gap < best.gapMm)) {
        best = {
          gapMm: gap,
          locationMm: { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 },
        };
      }
    }
  }
  return best;
}
