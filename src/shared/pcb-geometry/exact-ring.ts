/**
 * Ring-level exact geometry (exact-geometry contract 12 §2.2, §2.3): what a
 * closed ring of primitives answers about a point, and what box it occupies.
 *
 * Kept out of `exact-arcs.ts` for the 500-line budget and imported FROM it
 * one-way, the same split `region-rings.ts` makes under `board-region.ts`.
 */
import type { PcbPointMm } from "../../sdks";
import {
  angleInArc,
  ARC_ANGLE_EPS_RAD,
  arcPointAt,
  type ExactArc,
  type ExactPrim,
  type ExactRing,
  type ExactSeg,
  pointToPrimDistance,
  type RingBoundsMm,
} from "./exact-arcs";
import { GEOM_EPS_MM } from "./tolerance";

/** The ring's primitives; a chord ring's edges are read as segments. */
export function ringPrims(ring: ExactRing): ExactPrim[] {
  if ("prims" in ring) return ring.prims;
  const out: ExactPrim[] = [];
  for (let i = 0; i < ring.ring.length; i += 1) {
    out.push({
      kind: "seg",
      a: ring.ring[i]!,
      b: ring.ring[(i + 1) % ring.ring.length]!,
    });
  }
  return out;
}

/** The chord deviation the ring carries on BOTH sides; 0 for exact primitives. */
export function ringBoundMm(ring: ExactRing): number {
  return "prims" in ring ? 0 : ring.boundMm;
}

/**
 * The y knots of an arc: its two ring VERTICES plus every vertical extremum it
 * sweeps. A circle's y extrema are at cos θ = 0, which also means each piece
 * between consecutive knots lies wholly in one x half-plane about the centre —
 * that is what lets the ray crossing be solved in closed form. The end knots
 * take their y from the ring vertices, so a vertex shared with the neighbouring
 * primitive is the SAME number on both sides and the half-open rule counts it
 * exactly once per piece.
 */
function arcYKnots(arc: ExactArc): Array<{ angle: number; y: number }> {
  const span = Math.abs(arc.sweep);
  const dir = arc.sweep >= 0 ? 1 : -1;
  const knots: Array<{ angle: number; y: number }> = [
    { angle: arc.a0, y: arc.a.y },
  ];
  // cos θ = 0 ⇔ θ = π/2 + kπ ⇔ offset ≡ dir·(π/2 − a0) (mod π).
  let first = (dir * (Math.PI / 2 - arc.a0)) % Math.PI;
  if (first < 0) first += Math.PI;
  for (let u = first; u < span; u += Math.PI) {
    if (u <= 0) continue;
    const angle = arc.a0 + dir * u;
    knots.push({ angle, y: arc.c.y + (Math.sin(angle) >= 0 ? arc.r : -arc.r) });
  }
  knots.push({ angle: arc.a0 + arc.sweep, y: arc.b.y });
  return knots;
}

/**
 * Crossings of the +x ray from `p` with one primitive, under ONE half-open rule
 * (12 §2.3): a piece crosses iff `yMin <= y < yMax`. Horizontal pieces are
 * excluded by that rule on their own; multiplicity is KEPT, so a local minimum
 * on the ray contributes two crossings (one per adjoining piece) and a local
 * maximum none.
 */
function rayCrossingsSeg(p: PcbPointMm, seg: ExactSeg): number {
  const yMin = Math.min(seg.a.y, seg.b.y);
  const yMax = Math.max(seg.a.y, seg.b.y);
  if (!(yMin <= p.y && p.y < yMax)) return 0;
  const t = (p.y - seg.a.y) / (seg.b.y - seg.a.y);
  return seg.a.x + (seg.b.x - seg.a.x) * t > p.x ? 1 : 0;
}

function rayCrossingsArc(p: PcbPointMm, arc: ExactArc): number {
  if (!(arc.r > 0)) return 0;
  const knots = arcYKnots(arc);
  let count = 0;
  for (let i = 1; i < knots.length; i += 1) {
    const lo = knots[i - 1]!;
    const hi = knots[i]!;
    if (Math.abs(hi.angle - lo.angle) <= ARC_ANGLE_EPS_RAD) continue;
    const yMin = Math.min(lo.y, hi.y);
    const yMax = Math.max(lo.y, hi.y);
    if (!(yMin <= p.y && p.y < yMax)) continue;
    const side = Math.cos((lo.angle + hi.angle) / 2) >= 0 ? 1 : -1;
    const sin = Math.max(-1, Math.min(1, (p.y - arc.c.y) / arc.r));
    const x = arc.c.x + side * arc.r * Math.sqrt(Math.max(0, 1 - sin * sin));
    if (x > p.x) count += 1;
  }
  return count;
}

export type ExactMembership = "inside" | "outside" | "boundary";

export function pointInExactRing(
  ring: ExactRing,
  p: PcbPointMm,
  eps = GEOM_EPS_MM,
): ExactMembership {
  const prims = ringPrims(ring);
  for (const prim of prims) {
    if (pointToPrimDistance(p, prim) <= eps) return "boundary";
  }
  let crossings = 0;
  for (const prim of prims) {
    crossings +=
      prim.kind === "seg" ? rayCrossingsSeg(p, prim) : rayCrossingsArc(p, prim);
  }
  return crossings % 2 === 1 ? "inside" : "outside";
}

// --------------------------------------------------------------------------
// Bounds
// --------------------------------------------------------------------------

function growBounds(b: RingBoundsMm, p: PcbPointMm): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}

function emptyBounds(): RingBoundsMm {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/** True extrema: an arc contributes every cardinal angle it actually sweeps. */
export function exactPrimBounds(prim: ExactPrim): RingBoundsMm {
  const b = emptyBounds();
  growBounds(b, prim.a);
  growBounds(b, prim.b);
  if (prim.kind === "arc") {
    for (const k of [0, 1, 2, 3]) {
      const angle = (k * Math.PI) / 2;
      if (angleInArc(prim, angle)) growBounds(b, arcPointAt(prim, angle));
    }
  }
  return b;
}

export function exactRingBounds(ring: ExactRing): RingBoundsMm {
  const b = emptyBounds();
  for (const prim of ringPrims(ring)) {
    const pb = exactPrimBounds(prim);
    growBounds(b, { x: pb.minX, y: pb.minY });
    growBounds(b, { x: pb.maxX, y: pb.maxY });
  }
  return b;
}

export function boundsMeetMm(
  a: RingBoundsMm,
  b: RingBoundsMm,
  haloMm: number,
): boolean {
  return (
    a.minX - haloMm <= b.maxX &&
    a.maxX + haloMm >= b.minX &&
    a.minY - haloMm <= b.maxY &&
    a.maxY + haloMm >= b.minY
  );
}
