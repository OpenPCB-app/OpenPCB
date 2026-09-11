/**
 * Pure board-outline geometry — no THREE, no DB. Shared by the Gerber writer,
 * the 2D / 3D renderers, containment / DRC, and bbox recomputation so every
 * consumer agrees on how a board shape flattens to points.
 *
 * `flatten*` returns an *open* ring (first point !== last); callers close the
 * loop themselves (line rendering duplicates, Gerber emits a closing move).
 *
 * Arc flattening carries an explicit BIAS (S2 geometry contract §3, §4):
 * "none" is the default sampling every renderer/exporter gets, while "inward" /
 * "outward" promise which side of the true curve the polygon lies on. The
 * board region uses them to build a shape that is provably a subset of the true
 * board.
 */
import type {
  PcbBoardCutoutShape,
  PcbBoardOutline,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../sdks";
import {
  type ArcBias,
  arcChordPoints,
  arcSegmentCount,
  DEFAULT_ARC_SEGMENTS,
  ellipseChordRing,
  MAX_ARC_SEGMENTS,
  MAX_CHORD_DEVIATION_MM,
  MIN_ARC_SEGMENTS,
} from "./arc-chords";
import { canonicalContour } from "./canonical-contour";
import { canonicalizeRing, DEGENERATE_AREA_MM2 } from "./ring-utils";
import { GEOM_EPS_MM } from "./tolerance";

export {
  arcSegmentCount,
  DEFAULT_ARC_SEGMENTS,
  MAX_ARC_SEGMENTS,
  MAX_CHORD_DEVIATION_MM,
  MIN_ARC_SEGMENTS,
};
export type { ArcBias };

// The segment kernel moved to ./segment-predicates; the old name stays
// reachable because contour validation and the outline DRC check import it.
export {
  ringSelfIntersects,
  segmentsIntersect as segmentsIntersectInclusive,
} from "./segment-predicates";

/**
 * Which side of the true shape the flattened polygon is allowed to be on.
 *  - `"inward"`  — the polygon lies inside the true shape.
 *  - `"outward"` — the polygon encloses the true shape.
 *  - `"none"`    — default sampling (arcs inscribed); no promise.
 */
export type OutlineBias = "none" | "inward" | "outward";

export interface FlattenOptions {
  bias?: OutlineBias;
  /** Refinement knob: multiplies every arc's chord count (§3 topology rule). */
  stepMultiplier?: number;
}

export interface OutlineBboxMm {
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
}

/**
 * Chords for one arc: the circle of the START radius, from the start angle to
 * the angle of `end`, ending on the exact `end`.
 *
 * The former ANNULUS arm — sampling a mismatched-radius arc on the smaller or
 * larger radius and joining the authored endpoints with radial stubs — is gone
 * (exact-geometry contract 12 §2.1). A tolerance was never a curve; the one
 * canonical curve is now derived by {@link canonicalContour} before any
 * flattening, so start and end radii agree here by construction.
 */
function arcTo(
  start: PcbPointMm,
  end: PcbPointMm,
  center: PcbPointMm,
  cw: boolean,
  bias: ArcBias,
  stepMultiplier: number,
): PcbPointMm[] {
  const rStart = Math.hypot(start.x - center.x, start.y - center.y);
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  // Normalise the swept angle to (0, 2π] in the requested direction.
  if (cw) {
    while (a1 >= a0) a1 -= Math.PI * 2;
  } else {
    while (a1 <= a0) a1 += Math.PI * 2;
  }
  const steps = arcSegmentCount(rStart, Math.abs(a1 - a0), bias, stepMultiplier);
  return arcChordPoints(center, rStart, a0, a1, steps, bias, end);
}

/** Convex parametric shapes: "inward" (and "none") inscribe, "outward" hugs. */
function convexArcBias(bias: OutlineBias): ArcBias {
  return bias === "outward" ? "circumscribed" : "inscribed";
}

function roundRectPoints(
  center: PcbPointMm,
  widthMm: number,
  heightMm: number,
  cornerRadiusMm: number,
  bias: OutlineBias,
  stepMultiplier: number,
): PcbPointMm[] {
  const hw = widthMm / 2;
  const hh = heightMm / 2;
  const r = Math.max(0, Math.min(cornerRadiusMm, hw, hh));
  if (r <= 0) {
    return [
      { x: center.x + hw, y: center.y - hh },
      { x: center.x + hw, y: center.y + hh },
      { x: center.x - hw, y: center.y + hh },
      { x: center.x - hw, y: center.y - hh },
    ];
  }
  const arcBias = convexArcBias(bias);
  const off = (p: PcbPointMm): PcbPointMm => ({
    x: center.x + p.x,
    y: center.y + p.y,
  });
  // A straight edge whose target coincides with the arc end (radius == half the
  // width or height) is a zero-length edge; emitting it made the natural
  // rounded-slot shape read as self-touching.
  const wideEdge = hw - r > GEOM_EPS_MM;
  const tallEdge = hh - r > GEOM_EPS_MM;
  const corner = (
    from: PcbPointMm,
    to: PcbPointMm,
    c: PcbPointMm,
  ): PcbPointMm[] =>
    arcTo(off(from), off(to), off(c), false, arcBias, stepMultiplier);

  const pts: PcbPointMm[] = [off({ x: hw, y: hh - r })];
  pts.push(
    ...corner(
      { x: hw, y: hh - r },
      { x: hw - r, y: hh },
      { x: hw - r, y: hh - r },
    ),
  );
  if (wideEdge) pts.push(off({ x: -(hw - r), y: hh }));
  pts.push(
    ...corner(
      { x: -(hw - r), y: hh },
      { x: -hw, y: hh - r },
      { x: -(hw - r), y: hh - r },
    ),
  );
  if (tallEdge) pts.push(off({ x: -hw, y: -(hh - r) }));
  pts.push(
    ...corner(
      { x: -hw, y: -(hh - r) },
      { x: -(hw - r), y: -hh },
      { x: -(hw - r), y: -(hh - r) },
    ),
  );
  if (wideEdge) pts.push(off({ x: hw - r, y: -hh }));
  pts.push(
    ...corner(
      { x: hw - r, y: -hh },
      { x: hw, y: -(hh - r) },
      { x: hw - r, y: -(hh - r) },
    ),
  );
  // implicit close back to `start` along the right edge
  return pts;
}

function contourRing(
  start: PcbPointMm,
  segments: readonly PcbOutlineSegment[],
  arcBiasOf: (cw: boolean) => ArcBias,
  stepMultiplier: number,
): PcbPointMm[] {
  const pts: PcbPointMm[] = [{ x: start.x, y: start.y }];
  let prev = start;
  for (const seg of segments) {
    if (seg.type === "line") {
      pts.push({ x: seg.to.x, y: seg.to.y });
    } else {
      const bias = arcBiasOf(seg.cw);
      pts.push(...arcTo(prev, seg.to, seg.centerMm, seg.cw, bias, stepMultiplier));
    }
    prev = seg.to;
  }
  return pts;
}

/**
 * Signed area of the EXACT contour — shoelace over the segment endpoints plus,
 * per arc, the circular segment between chord and arc: `(r²/2)(θ − sin θ)`,
 * added for a counter-clockwise arc and subtracted for a clockwise one. The
 * flattened ring's area is NOT a safe substitute: a sliver-thin cutout whose
 * shallow arc flattens to a single chord can come out as a simple polygon of
 * the OPPOSITE orientation (Astra §9.2), which would flip every arc's bias.
 */
export function contourSignedArea(
  start: PcbPointMm,
  segments: readonly PcbOutlineSegment[],
): number {
  let twice = 0;
  let arcs = 0;
  let prev = start;
  for (const seg of segments) {
    twice += prev.x * seg.to.y - seg.to.x * prev.y;
    if (seg.type === "arc") {
      const r = Math.hypot(prev.x - seg.centerMm.x, prev.y - seg.centerMm.y);
      const a0 = Math.atan2(prev.y - seg.centerMm.y, prev.x - seg.centerMm.x);
      let a1 = Math.atan2(seg.to.y - seg.centerMm.y, seg.to.x - seg.centerMm.x);
      if (seg.cw) {
        while (a1 >= a0) a1 -= Math.PI * 2;
      } else {
        while (a1 <= a0) a1 += Math.PI * 2;
      }
      const sweep = Math.abs(a1 - a0);
      const segment = (r * r * (sweep - Math.sin(sweep))) / 2;
      arcs += seg.cw ? -segment : segment;
    }
    prev = seg.to;
  }
  twice += prev.x * start.y - start.x * prev.y;
  return twice / 2 + arcs;
}

/**
 * Per-arc bias for a free-form contour. The interior side is COMPUTED, never
 * assumed: read the exact contour's orientation from its signed area (arcs
 * included), and derive which side of each arc its centre is on.
 *
 * For `cw === false` the centre lies to the LEFT of travel, for `cw === true`
 * to the RIGHT; the shape's interior is on the left when the ring runs
 * counter-clockwise. So the centre is on the interior side exactly when
 * `(cw === false) === (orientation === +1)`, and the chord polygon lands on the
 * requested side when that agrees with an inscribed construction.
 */
function contourPoints(
  start: PcbPointMm,
  segments: readonly PcbOutlineSegment[],
  bias: OutlineBias,
  stepMultiplier: number,
): PcbPointMm[] {
  const unbiased = contourRing(
    start,
    segments,
    () => "inscribed",
    stepMultiplier,
  );
  if (bias === "none") return unbiased;
  const area = contourSignedArea(start, segments);
  const orientation = Math.abs(area) < DEGENERATE_AREA_MM2 ? 0 : area > 0 ? 1 : -1;
  if (orientation === 0) return unbiased;
  return contourRing(
    start,
    segments,
    (cw) => {
      const centreOnShapeInterior = (cw === false) === (orientation === 1);
      return centreOnShapeInterior === (bias === "inward")
        ? "inscribed"
        : "circumscribed";
    },
    stepMultiplier,
  );
}

/** Flatten any outline shape to an open ring of points (mm). */
export function flattenOutline(
  outline: PcbBoardOutline,
  options: FlattenOptions = {},
): PcbPointMm[] {
  const bias = options.bias ?? "none";
  const stepMultiplier = options.stepMultiplier ?? 1;
  const c = outline.centerMm;
  switch (outline.kind) {
    case "rect": {
      const hw = outline.widthMm / 2;
      const hh = outline.heightMm / 2;
      return canonicalizeRing([
        { x: c.x - hw, y: c.y - hh },
        { x: c.x + hw, y: c.y - hh },
        { x: c.x + hw, y: c.y + hh },
        { x: c.x - hw, y: c.y + hh },
      ]);
    }
    case "roundrect":
      return canonicalizeRing(
        roundRectPoints(
          c,
          outline.widthMm,
          outline.heightMm,
          outline.cornerRadiusMm,
          bias,
          stepMultiplier,
        ),
      );
    case "circle": {
      const rx = outline.widthMm / 2;
      const ry = outline.heightMm / 2;
      const arcBias = convexArcBias(bias);
      // The chord rule alone would make small circles COARSER than the legacy
      // 64-gon (r = 1 → 23 chords, a visible facet in the renderers), so full
      // circles keep 64 as a floor; either bias holds for any count.
      const steps = Math.max(
        DEFAULT_ARC_SEGMENTS,
        arcSegmentCount(Math.max(rx, ry), Math.PI * 2, arcBias, stepMultiplier),
      );
      return canonicalizeRing(ellipseChordRing(c, rx, ry, steps, arcBias));
    }
    case "polygon":
      return canonicalizeRing(
        outline.pointsMm.map((p) => ({ x: p.x, y: p.y })),
      );
    case "contour": {
      // The ONE derivation every chord consumer shares (12 §2.1): an arc's
      // effective end is its authored `to` projected onto the circle of the
      // start radius, and the ring carries an explicit closing segment when the
      // chain of projections misses `start`. An already-conforming contour comes
      // back verbatim, so rendering / Gerber / fill / snapshot are unchanged.
      const canonical = canonicalContour(outline);
      return canonicalizeRing(
        contourPoints(
          canonical.start,
          canonical.segments,
          bias,
          stepMultiplier,
        ),
      );
    }
  }
}

/** Flatten a cutout shape (reuses the non-rect outline shapes). */
export function flattenCutout(
  shape: PcbBoardCutoutShape,
  options: FlattenOptions = {},
): PcbPointMm[] {
  return flattenOutline(shape, options);
}

function bboxOfPoints(points: readonly PcbPointMm[]): OutlineBboxMm {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { widthMm: 0, heightMm: 0, centerMm: { x: 0, y: 0 } };
  }
  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    centerMm: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/**
 * Recompute the cached bounding box from an outline's actual geometry. For
 * parametric kinds (rect/roundrect/circle) the stored w/h/center already IS the
 * bbox, but recomputing keeps a single code path after edits.
 */
export function computeOutlineBboxMm(outline: PcbBoardOutline): OutlineBboxMm {
  if (
    outline.kind === "rect" ||
    outline.kind === "roundrect" ||
    outline.kind === "circle"
  ) {
    return {
      widthMm: outline.widthMm,
      heightMm: outline.heightMm,
      centerMm: { ...outline.centerMm },
    };
  }
  return bboxOfPoints(flattenOutline(outline));
}
