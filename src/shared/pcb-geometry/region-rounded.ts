/**
 * Board-region predicates for a ROUNDED shape — a convex core ⊕ a disc
 * (exact-geometry contract 12 §1.2, §4). Every function mirrors the shape of
 * its polygonal sibling in `board-region.ts` (optional trailing `RegionIndex`
 * for the containment family, optional trailing `haloMm` for the distance
 * family), so the indexed and exhaustive DRC bodies stay interchangeable.
 *
 * Kept out of `board-region.ts` for the 500-line budget, and imported FROM it
 * rather than re-exported BY it — a re-export would close an import cycle.
 */
import type { PcbPointMm } from "../../sdks";
import type { BoardRegion } from "./board-region";
import {
  polygonInsideRegion,
  regionBoundaryDistancePoint,
  regionBoundaryDistancePolyline,
  regionBoundaryDistanceRing,
  regionContainsPoint,
  segmentInsideRegion,
} from "./board-region";
import type { RegionIndex } from "./region-index";
import type { RoundedShape } from "./rounded-shape-types";
import { canonicalizeRing } from "./ring-utils";
import { GEOM_EPS_MM } from "./tolerance";

/**
 * The core's distinct points. A roundrect at full radius in one dimension has
 * two pairs of coincident corners, and a `w === h` oval a zero-length spine;
 * both must reduce to the point / segment form rather than present a degenerate
 * edge to the ring predicates.
 */
function distinctCore(shape: RoundedShape, eps: number): PcbPointMm[] {
  return canonicalizeRing(shape.core, eps);
}

/** The core measured as a CLOSED ring for 3+ points, a polyline / point below. */
function coreBoundaryDistance(
  region: BoardRegion,
  core: readonly PcbPointMm[],
  index: RegionIndex | undefined,
  haloMm: number | undefined,
): number {
  if (core.length >= 3) {
    return regionBoundaryDistanceRing(region, core, index, haloMm);
  }
  if (core.length === 2) {
    return regionBoundaryDistancePolyline(region, core, index, haloMm);
  }
  if (core.length === 1) {
    return regionBoundaryDistancePoint(region, core[0]!, index, haloMm);
  }
  return Infinity;
}

function coreInsideRegion(
  region: BoardRegion,
  core: readonly PcbPointMm[],
  eps: number,
  index: RegionIndex | undefined,
): boolean {
  if (core.length === 0) return true;
  if (core.length === 1) return regionContainsPoint(region, core[0]!, eps, index);
  if (core.length === 2) {
    return segmentInsideRegion(region, core[0]!, core[1]!, eps, index);
  }
  return polygonInsideRegion(region, core, eps, index);
}

/**
 * The WHOLE filled core inside the region, AND the core's boundary distance at
 * least `radiusMm`. Never "one point inside": a rect core `[9, 11] × [4, 6]` on
 * a `[0, 10]²` board has a vertex inside and is plainly off the board.
 *
 * The distance query carries a halo of exactly the radius — the only threshold
 * this comparison can see, since a true gap above it comes back `Infinity` and
 * `Infinity >= r − eps` is the same boolean (broad-phase contract 08 §1 L2).
 */
export function roundedInsideRegion(
  region: BoardRegion,
  shape: RoundedShape,
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): boolean {
  const core = distinctCore(shape, eps);
  if (!coreInsideRegion(region, core, eps, index)) return false;
  const r = shape.radiusMm;
  if (!(r > eps)) return true;
  return coreBoundaryDistance(region, core, index, r) >= r - eps;
}

/**
 * Distance from the rounded shape's BOUNDARY to the region's — the core's
 * perimeter distance less the radius, exactly as the `disc` path has always
 * grouped it. `Infinity − r` is still `Infinity`, so a halo that filters every
 * edge out still reads as "further than the halo".
 *
 * Callers comparing against a rule must pass `haloMm = required + radiusMm +
 * region.maxBoundMm`: a core-based distance is in the disc regime, so a plain
 * `required` halo silently DROPS the verdict for a shape whose core sits
 * between `required` and `required + r` from the edge, and the certified
 * interval needs every boundary that could move a candidate by the ring bound.
 */
export function regionBoundaryDistanceRounded(
  region: BoardRegion,
  shape: RoundedShape,
  index?: RegionIndex,
  haloMm?: number,
): number {
  const core = distinctCore(shape, GEOM_EPS_MM);
  return coreBoundaryDistance(region, core, index, haloMm) - shape.radiusMm;
}

/**
 * How deep the shape reaches past the region: the furthest core vertex that is
 * OUTSIDE, measured to the boundary, plus the radius. A shape whose core is
 * wholly inside but whose disc pokes out penetrates by at most `radiusMm`,
 * which is what this then reports.
 *
 * The distance is REPORTED, not compared, so it is queried UNHALOED.
 */
export function roundedPenetration(
  region: BoardRegion,
  shape: RoundedShape,
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): number {
  const core = distinctCore(shape, eps);
  let worst = 0;
  for (const v of core) {
    if (regionContainsPoint(region, v, eps, index)) continue;
    const d = regionBoundaryDistancePoint(region, v, index);
    if (Number.isFinite(d) && d > worst) worst = d;
  }
  return worst + shape.radiusMm;
}

/**
 * The signed material margin `m` of contract 12 §4: positive is clearance,
 * negative is penetration. Unsigned distances REVERSE their order outside the
 * region, so the certified interval `m_lo <= m_exact <= m_hi` only holds on a
 * signed quantity.
 *
 * A shape can fail containment with NO core vertex outside — a zero-radius core
 * whose EDGE alone crosses a notch — which leaves {@link roundedPenetration} at
 * 0. The margin is clamped to `-GEOM_EPS_MM` so `inside === false` never reports
 * a non-negative margin, matching the floor `checks/board.ts` already puts under
 * `measuredMm`. The clamp `x ↦ −max(x, eps)` is non-increasing, so applying it
 * to both ends of the interval preserves their order (R1).
 */
export function signedMargin(
  region: BoardRegion,
  shape: RoundedShape,
  index?: RegionIndex,
  haloMm?: number,
  eps = GEOM_EPS_MM,
): number {
  if (roundedInsideRegion(region, shape, eps, index)) {
    return regionBoundaryDistanceRounded(region, shape, index, haloMm);
  }
  return -Math.max(roundedPenetration(region, shape, eps, index), GEOM_EPS_MM);
}
