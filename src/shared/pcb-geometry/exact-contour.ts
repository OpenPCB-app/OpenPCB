/**
 * Every outline kind as EXACT primitives (exact-geometry contract 12 §2.2,
 * §2.4) — the one curved model the validity rules, the certified board-edge
 * interval and the Gerber Profile read.
 *
 * The chord rings stay: they are the broad phase and the polygon-only
 * consumers' input (fill, snapshot, canvas). They are never a verdict where an
 * exact answer exists.
 */
import type { PcbBoardContour, PcbBoardOutline, PcbPointMm } from "../../sdks";
import {
  arcSegmentCount,
  DEFAULT_ARC_SEGMENTS,
  MAX_CHORD_DEVIATION_MM,
  } from "./arc-chords";
import { canonicalContour } from "./canonical-contour";
import {
  type ExactPrim,
  type ExactRing,
  exactArcFromPoints,
  type RingBoundsMm,
} from "./exact-arcs";
import { exactRingBounds } from "./exact-ring";
import { flattenOutline } from "./outline-geometry";
import { canonicalizeRing, ringSignedArea } from "./ring-utils";
import { GEOM_EPS_MM } from "./tolerance";

const TAU = Math.PI * 2;

/** True arc extrema, not chord vertices (12 §2.2). */
export function exactContourBounds(ring: ExactRing): RingBoundsMm {
  return exactRingBounds(ring);
}

function ringToPrims(points: readonly PcbPointMm[]): ExactPrim[] {
  if (points.length < 2) return [];
  const prims: ExactPrim[] = [];
  for (let i = 0; i < points.length; i += 1) {
    prims.push({
      kind: "seg",
      a: points[i]!,
      b: points[(i + 1) % points.length]!,
    });
  }
  return prims;
}

/**
 * `roundRectPoints`' clamping, reproduced on exact primitives: corner radius 0
 * ⇒ four segments; a full radius in one dimension collapses that pair of
 * straight edges to zero length and they are DROPPED (emitting them made the
 * natural rounded-slot shape read as self-touching); full in both ⇒ two half
 * arcs and two quarter joins.
 */
function roundRectPrims(
  center: PcbPointMm,
  widthMm: number,
  heightMm: number,
  cornerRadiusMm: number,
): ExactPrim[] {
  const hw = widthMm / 2;
  const hh = heightMm / 2;
  const r = Math.max(0, Math.min(cornerRadiusMm, hw, hh));
  const off = (x: number, y: number): PcbPointMm => ({
    x: center.x + x,
    y: center.y + y,
  });
  if (r <= 0) {
    return ringToPrims([
      off(hw, -hh),
      off(hw, hh),
      off(-hw, hh),
      off(-hw, -hh),
    ]);
  }
  const wideEdge = hw - r > GEOM_EPS_MM;
  const tallEdge = hh - r > GEOM_EPS_MM;
  const prims: ExactPrim[] = [];
  const start = off(hw, hh - r);
  let cursor = start;
  const arcTo = (to: PcbPointMm, c: PcbPointMm): void => {
    prims.push(exactArcFromPoints(cursor, to, c, false));
    cursor = to;
  };
  const lineTo = (to: PcbPointMm): void => {
    prims.push({ kind: "seg", a: cursor, b: to });
    cursor = to;
  };
  arcTo(off(hw - r, hh), off(hw - r, hh - r));
  if (wideEdge) lineTo(off(-(hw - r), hh));
  arcTo(off(-hw, hh - r), off(-(hw - r), hh - r));
  if (tallEdge) lineTo(off(-hw, -(hh - r)));
  arcTo(off(-(hw - r), -hh), off(-(hw - r), -(hh - r)));
  if (wideEdge) lineTo(off(hw - r, -hh));
  arcTo(tallEdge ? off(hw, -(hh - r)) : start, off(hw - r, -(hh - r)));
  if (tallEdge) lineTo(start);
  return prims;
}

/**
 * One arc as `flattenOutline` will actually step it. `floorSteps` carries the
 * full-circle rule's 64-chord floor, which the ellipse and circle arms apply and
 * nothing else does.
 */
interface FlattenedArc {
  radiusMm: number;
  sweepRad: number;
  floorSteps: number;
}

/**
 * The arcs the FLATTENER sees — not the arcs `exactContour` decomposes the
 * shape into. A `circle` flattens as ONE 2π sweep (its two 180° exact arcs are
 * a different decomposition and would each be stepped separately), and only the
 * flattener's own structure bounds the ring it actually produces.
 */
function flattenedArcs(outline: PcbBoardOutline): FlattenedArc[] {
  switch (outline.kind) {
    case "rect":
    case "polygon":
      return [];
    case "roundrect": {
      const r = Math.max(
        0,
        Math.min(outline.cornerRadiusMm, outline.widthMm / 2, outline.heightMm / 2),
      );
      if (r <= 0) return [];
      return [0, 1, 2, 3].map(() => ({
        radiusMm: r,
        sweepRad: Math.PI / 2,
        floorSteps: 1,
      }));
    }
    case "circle":
      return [
        {
          radiusMm: Math.max(outline.widthMm / 2, outline.heightMm / 2),
          sweepRad: TAU,
          floorSteps: DEFAULT_ARC_SEGMENTS,
        },
      ];
    case "contour": {
      const canonical = canonicalContour(outline);
      const out: FlattenedArc[] = [];
      let cursor = canonical.start;
      for (const seg of canonical.segments) {
        if (seg.type === "arc") {
          const a = exactArcFromPoints(cursor, seg.to, seg.centerMm, seg.cw);
          out.push({
            radiusMm: a.r,
            sweepRad: Math.abs(a.sweep),
            floorSteps: 1,
          });
        }
        cursor = seg.to;
      }
      return out;
    }
  }
}

/**
 * The chord bound (mm) this shape's flattened ring carries — the deviation the
 * step rule promises, `MAX_CHORD_DEVIATION_MM`, raised to the achieved residual
 * wherever `MAX_ARC_SEGMENTS` caps the count (12 §4 `boundMm`); 0 for a shape
 * with no arcs at all.
 *
 * BOTH constructions are measured and the worse kept, so ONE number bounds the
 * inner ring, the outer ring, and a fallback ring's symmetric use of the
 * unbiased one. Computed at step multiplier 1, the COARSEST flattening
 * `buildBoardRegion` can adopt: refinement only shrinks the deviation, so this
 * stays an upper bound.
 */
export function outlineChordBoundMm(outline: PcbBoardOutline): number {
  let bound = 0;
  for (const a of flattenedArcs(outline)) {
    if (bound < MAX_CHORD_DEVIATION_MM) bound = MAX_CHORD_DEVIATION_MM;
    for (const bias of ["inscribed", "circumscribed"] as const) {
      const steps = Math.max(
        a.floorSteps,
        arcSegmentCount(a.radiusMm, a.sweepRad, bias, 1),
      );
      const half = a.sweepRad / steps / 2;
      const residual =
        bias === "circumscribed"
          ? a.radiusMm * (1 / Math.cos(half) - 1)
          : a.radiusMm * (1 - Math.cos(half));
      if (residual > bound) bound = residual;
    }
  }
  return bound;
}

function contourPrims(outline: PcbBoardContour): ExactPrim[] {
  const canonical = canonicalContour(outline);
  const start = canonical.start;
  const prims: ExactPrim[] = [];
  let cursor = start;
  for (const seg of canonical.segments) {
    if (seg.type === "line") {
      prims.push({ kind: "seg", a: cursor, b: seg.to });
    } else {
      prims.push(exactArcFromPoints(cursor, seg.to, seg.centerMm, seg.cw));
    }
    cursor = seg.to;
  }
  if (prims.length === 0) return prims;
  // Exact closure. `canonicalContour` already appends a closing LINE whenever
  // the gap exceeds GEOM_EPS_MM; anything left is a sub-tolerance residue of an
  // approximately-closed authored contour, and a ring that is not closed to the
  // bit breaks the half-open ray rule (a shared vertex would be two distinct
  // numbers). Pull the last vertex onto `start` rather than emit a degenerate
  // primitive that §3 (b) would call invalid.
  if (cursor.x !== start.x || cursor.y !== start.y) {
    const last = prims[prims.length - 1]!;
    prims[prims.length - 1] = { ...last, b: start };
  }
  return prims;
}

export function exactContour(outline: PcbBoardOutline): ExactRing {
  const c = outline.centerMm;
  switch (outline.kind) {
    case "rect": {
      const hw = outline.widthMm / 2;
      const hh = outline.heightMm / 2;
      return {
        prims: ringToPrims(
          canonicalizeRing([
            { x: c.x - hw, y: c.y - hh },
            { x: c.x + hw, y: c.y - hh },
            { x: c.x + hw, y: c.y + hh },
            { x: c.x - hw, y: c.y + hh },
          ]),
        ),
      };
    }
    case "roundrect":
      return {
        prims: roundRectPrims(
          c,
          outline.widthMm,
          outline.heightMm,
          outline.cornerRadiusMm,
        ),
      };
    case "circle": {
      const rx = outline.widthMm / 2;
      const ry = outline.heightMm / 2;
      if (Math.abs(outline.widthMm - outline.heightMm) > GEOM_EPS_MM) {
        return {
          kind: "chords",
          ring: flattenOutline(outline, { bias: "none" }),
          boundMm: outlineChordBoundMm(outline),
        };
      }
      // Two 180° arcs. The axis points are written out rather than sampled:
      // `sin(Math.PI)` is 1.2e-16, not 0, so `arcPointAt` would not close the
      // ring on the bit.
      const east: PcbPointMm = { x: c.x + rx, y: c.y };
      const west: PcbPointMm = { x: c.x - rx, y: c.y };
      return {
        prims: [
          { kind: "arc", c, r: rx, a0: 0, sweep: Math.PI, a: east, b: west },
          {
            kind: "arc",
            c,
            r: rx,
            a0: Math.PI,
            sweep: Math.PI,
            a: west,
            b: east,
          },
        ],
      };
    }
    case "polygon":
      return {
        prims: ringToPrims(
          canonicalizeRing(outline.pointsMm.map((p) => ({ x: p.x, y: p.y }))),
        ),
      };
    case "contour":
      return { prims: contourPrims(outline) };
  }
}

/**
 * Signed area of the EXACT ring — the shoelace over the primitives' endpoints
 * plus, per arc, the circular segment `(r²/2)(θ − sin θ)`, added for a
 * counter-clockwise arc and subtracted for a clockwise one. Identical in value
 * and in float arithmetic to `outline-geometry.contourSignedArea`, which keeps
 * owning the chord path (12 §2.2: "exported in place").
 *
 * `θ − sin θ` loses its leading digits below ≈ 1e-3 rad; the series
 * `θ³/6 − θ⁵/120` is exact to the last bit there and the circular segment of
 * such an arc is ≤ 1e-10·r² anyway.
 */
export function exactRingSignedArea(ring: ExactRing): number {
  if (!("prims" in ring)) return ringSignedArea(ring.ring);
  let twice = 0;
  let arcs = 0;
  for (const prim of ring.prims) {
    twice += prim.a.x * prim.b.y - prim.b.x * prim.a.y;
    if (prim.kind !== "arc") continue;
    const sweep = Math.abs(prim.sweep);
    const excess =
      sweep < 1e-3
        ? (sweep * sweep * sweep) / 6 - (sweep * sweep * sweep * sweep * sweep) / 120
        : sweep - Math.sin(sweep);
    const segment = (prim.r * prim.r * excess) / 2;
    arcs += prim.sweep < 0 ? -segment : segment;
  }
  return twice / 2 + arcs;
}
