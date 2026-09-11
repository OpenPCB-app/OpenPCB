/**
 * The canonical contour (exact-geometry contract 12 §2.1): ONE curve per arc,
 * derived and never persisted.
 *
 * A `PcbOutlineSegment` arc carries a centre, an END point and a direction; the
 * radius is implicit and the start / end radii may differ inside the validator's
 * acceptance band. A tolerance is not a curve — distance, intersection, area and
 * export would each pick a different shape — so every consumer reads the SAME
 * derived curve: the circle of the arc's START radius about the authored centre,
 * swept in the authored direction, with the authored `to` projected radially
 * onto it. The next segment starts at that projected point, so consecutive arcs
 * CHAIN (each arc's radius comes from its moved start).
 *
 * Derived, never persisted: a projected endpoint rounded back to integer
 * nanometres changes the radius by up to 0.7 nm, so "write once" is not a fixed
 * point. `flattenOutline` and `exactContour` both call this; the `pcb-store`
 * hydrator and the command executor keep the authored coordinates.
 *
 * Validation ORDER matters and is not this module's job: the authored radii,
 * `full-circle-arc` and `too-few-segments` are judged BEFORE canonicalisation
 * (projecting first would erase a 1 mm authored mismatch), and the canonical
 * ring's geometry — simplicity, area, closure — after.
 */
import type { PcbBoardContour, PcbOutlineSegment, PcbPointMm } from "../../sdks";
import { GEOM_EPS_MM } from "./tolerance";

/**
 * The validator's arc-radius acceptance band, mirrored here so the geometry
 * kernel can state its own displacement bound without importing the rendering
 * layer's authoring gate (`rendering/pcb/contour-validation.ts`, which imports
 * this layer). Both are `1e-3`; the band is `max(abs, rel · rStart)` on the
 * AUTHORED start radius, exactly as that module computes it.
 */
export const CANONICAL_RADIUS_TOLERANCE_MM = 1e-3;
export const CANONICAL_RADIUS_RELATIVE_TOLERANCE = 1e-3;

/** A contour reduced to the geometry the kernel reads. Never persisted. */
export interface CanonicalContour {
  start: PcbPointMm;
  segments: PcbOutlineSegment[];
}

type ContourGeometry = Pick<PcbBoardContour, "start" | "segments">;

function radius(p: PcbPointMm, c: PcbPointMm): number {
  return Math.hypot(p.x - c.x, p.y - c.y);
}

/**
 * The canonical geometry of `contour`. Idempotent: a projected endpoint's
 * radius differs from the start radius by float noise only (≈ 1e-16 relative),
 * far below {@link GEOM_EPS_MM}, so a second pass moves nothing and adds no
 * second closing segment.
 *
 * An arc whose authored radii already agree within {@link GEOM_EPS_MM} keeps its
 * authored `to` VERBATIM rather than being re-projected. Re-projecting it would
 * be a no-op in real arithmetic but `c + (to − c)·1` is not bit-identical to
 * `to`, and every chord consumer — rendering, Gerber, fill, the snapshot and
 * every DRC golden — reads this output.
 */
export function canonicalContour(contour: ContourGeometry): CanonicalContour {
  const start = contour.start;
  const out: PcbOutlineSegment[] = [];
  let prev = start;
  let changed = false;
  for (const seg of contour.segments) {
    if (seg.type === "line") {
      out.push(seg);
      prev = seg.to;
      continue;
    }
    const rStart = radius(prev, seg.centerMm);
    const rEnd = radius(seg.to, seg.centerMm);
    // A `to` AT the centre has no radial direction, and a non-finite radius has
    // no circle: hand the authored segment back and let the validator speak.
    if (
      !Number.isFinite(rStart) ||
      !Number.isFinite(rEnd) ||
      rEnd === 0 ||
      Math.abs(rStart - rEnd) <= GEOM_EPS_MM
    ) {
      out.push(seg);
      prev = seg.to;
      continue;
    }
    const scale = rStart / rEnd;
    const to: PcbPointMm = {
      x: seg.centerMm.x + (seg.to.x - seg.centerMm.x) * scale,
      y: seg.centerMm.y + (seg.to.y - seg.centerMm.y) * scale,
    };
    out.push({ type: "arc", to, centerMm: seg.centerMm, cw: seg.cw });
    changed = true;
    prev = to;
  }
  // Closure: the chain of projections ends at the last arc's projected end,
  // which may miss the authored `start`. An EXPLICIT closing segment carries
  // that gap as ordinary geometry — never a snap, and outside the authoring-time
  // coincidence rule (`CONTOUR_POINT_EPSILON_MM`), which would have eaten it.
  if (out.length > 0 && radius(prev, start) > GEOM_EPS_MM) {
    out.push({ type: "line", to: { x: start.x, y: start.y } });
    changed = true;
  }
  return { start, segments: changed ? out : contour.segments };
}

/**
 * Upper bound (mm) on how far canonicalisation moves any authored point of this
 * contour. Each arc's end moves by at most its own authored mismatch — at most
 * `max(1e-3, 1e-3·rStart)` — and consecutive arcs CHAIN, so a run of `n` arcs
 * carries `n` times that band. A line resets the run: its `to` is authored and
 * never moves.
 *
 * Topology and the sign of the exact area are NOT invariant under a
 * displacement this large, which is why the canonical ring is re-validated.
 */
export function canonicalDisplacementBound(contour: ContourGeometry): number {
  let bound = 0;
  let run = 0;
  let prev = contour.start;
  for (const seg of contour.segments) {
    if (seg.type === "line") {
      run = 0;
      prev = seg.to;
      continue;
    }
    run += 1;
    const band = Math.max(
      CANONICAL_RADIUS_TOLERANCE_MM,
      CANONICAL_RADIUS_RELATIVE_TOLERANCE * radius(prev, seg.centerMm),
    );
    const candidate = run * band;
    if (candidate > bound) bound = candidate;
    prev = seg.to;
  }
  return bound;
}
