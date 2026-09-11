/**
 * Building the board region: biased flattening with look-ahead refinement, the
 * boundary-edge list, and the S12b certified-interval companions (exact-geometry
 * contract 12 §4).
 *
 * Kept out of `board-region.ts` so neither file outgrows the 500-line budget —
 * the same split `region-rings.ts` already makes. `board-region.ts` re-exports
 * {@link buildBoardRegion}, which is the import path every consumer should use.
 *
 * `bias: "board-inner"` gives `R_poly ⊆ R_true`; `"board-outer"` is its mirror
 * (circumscribe where inner inscribes and vice versa), so
 * `R_inner ⊆ R_true ⊆ R_outer`. One region cannot say how far a verdict is from
 * the truth; two can.
 */
import type { PcbBoardCutout, PcbBoardOutline, PcbPointMm } from "../../sdks";
import type {
  BoardRegion,
  BoardRegionOuterBias,
  BuildBoardRegionOptions,
  RegionEdge,
  RegionExactRings,
} from "./board-region";
import { exactContour, outlineChordBoundMm } from "./exact-contour";
import { flattenOutline, type OutlineBias } from "./outline-geometry";
import { buildRegionIndex } from "./region-index";
import {
  boundsOfPoints,
  EMPTY_BOUNDS,
  nearRing,
  PARAM_EPS,
  splitParamsAgainstRing,
} from "./region-rings";
import { pointInPolygon } from "./pcb-clearance-geometry";
import { ringSelfIntersects } from "./segment-predicates";
import { GEOM_EPS_MM } from "./tolerance";

/** The region's eagerly-built half; the rest is lazy (see {@link attachDerived}). */
type RegionRings = Omit<BoardRegion, "exact" | "outerBias" | "boundMm" | "maxBoundMm">;

/**
 * Only a free-form contour with an arc can gain a self-crossing from chord
 * approximation: rect and polygon carry no arcs at all, and roundrect / circle
 * are convex by construction in every bias. Skipping the O(n²) probe for them
 * keeps `bias: "none"` region builds (rendering, `pointInOutline`) cheap.
 */
function canSelfCrossFromFlattening(shape: PcbBoardOutline): boolean {
  return (
    shape.kind === "contour" && shape.segments.some((s) => s.type === "arc")
  );
}

/**
 * Closed containment of one simple ring in another: every sub-interval of
 * every inner edge (split at its contacts with the outer boundary) has its
 * midpoint inside-or-on the outer ring. Vertex tests alone are not enough —
 * two rings sharing all their vertices can still bound disjoint interiors.
 */
function ringWithinClosed(
  inner: readonly PcbPointMm[],
  outer: readonly PcbPointMm[],
): boolean {
  const eps = GEOM_EPS_MM;
  const insideOrOn = (q: PcbPointMm): boolean =>
    pointInPolygon(q, outer) || nearRing(outer, q, eps);
  for (let i = 0; i < inner.length; i += 1) {
    const a = inner[i]!;
    const b = inner[(i + 1) % inner.length]!;
    if (!insideOrOn(a)) return false;
    const params = splitParamsAgainstRing(a, b, outer, eps);
    let prev = params[0]!;
    for (let k = 1; k < params.length; k += 1) {
      const t = params[k]!;
      if (t - prev <= PARAM_EPS) continue;
      const mid = (prev + t) / 2;
      if (!insideOrOn({ x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid })) {
        return false;
      }
      prev = t;
    }
  }
  return true;
}

/**
 * A correctly-sided flattening is monotone under refinement: the inward
 * polygon grows toward the true shape (coarse ⊆ fine), the outward one shrinks
 * (fine ⊆ coarse). A coarse ring that stays simple but lands on the wrong side
 * of a sliver-thin feature breaks that (Astra §9.2 #1); default flattening has
 * no side and is never monotone-checked.
 */
function refinementMonotone(
  coarse: readonly PcbPointMm[],
  fine: readonly PcbPointMm[],
  bias: OutlineBias,
): boolean {
  if (bias === "inward") return ringWithinClosed(coarse, fine);
  if (bias === "outward") return ringWithinClosed(fine, coarse);
  return true;
}

/**
 * Flatten with `bias`, looking one refinement level ahead: while the ring or
 * its refinement self-intersects, or the two are not monotone, adopt the
 * refinement and look again (§3 topology rule). A ring still self-crossing at
 * the cap is reported as such; the caller decides what that means.
 */
function flattenRefined(
  shape: PcbBoardOutline,
  bias: OutlineBias,
): { ring: PcbPointMm[]; selfIntersects: boolean } {
  let ring = flattenOutline(shape, { bias });
  if (!canSelfCrossFromFlattening(shape)) {
    return { ring, selfIntersects: false };
  }
  let crosses = ringSelfIntersects(ring);
  let stepMultiplier = 1;
  for (;;) {
    const next = flattenOutline(shape, {
      bias,
      stepMultiplier: stepMultiplier * 2,
    });
    if (next.length <= ring.length) break; // the cap stopped the refinement
    const nextCrosses = ringSelfIntersects(next);
    if (!crosses && !nextCrosses && refinementMonotone(ring, next, bias)) break;
    stepMultiplier *= 2;
    ring = next;
    crosses = nextCrosses;
  }
  return { ring, selfIntersects: crosses };
}

function pushRingEdges(
  edges: RegionEdge[],
  ring: readonly PcbPointMm[],
  index: number,
): void {
  // A ring of fewer than two vertices has no perimeter. The per-ring helpers
  // (`pointToRingEdgeDistance` and friends) already return `Infinity` for it;
  // filing a degenerate `(p, p)` edge here made the region-level distances
  // disagree with them — a zero-size cutout canonicalises to one vertex, and
  // that disagreement surfaced as a two-mode DRC divergence (S9, WP3).
  if (ring.length < 2) return;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    edges.push({ a, b, bounds: boundsOfPoints([a, b]), ring: index });
  }
}

/** Outer ring shrinks the region for `"board-inner"` and grows it for `"board-outer"`. */
function ringBias(
  bias: BuildBoardRegionOptions["bias"],
  ringIndex: number,
): OutlineBias {
  if (bias === "board-inner") return ringIndex === 0 ? "inward" : "outward";
  return ringIndex === 0 ? "outward" : "inward";
}

function buildRings(
  outline: PcbBoardOutline,
  cutouts: readonly PcbBoardCutout[],
  bias: BuildBoardRegionOptions["bias"],
): RegionRings {
  const shapes: PcbBoardOutline[] = [outline, ...cutouts.map((c) => c.shape)];
  const biased: PcbPointMm[][] = [];
  const unbiased: PcbPointMm[][] = [];
  const fallbacks: number[] = [];
  for (let i = 0; i < shapes.length; i += 1) {
    const shape = shapes[i]!;
    if (bias === "none") {
      // Render / resize path: plain flattening, no O(n²) topology probe — the
      // refined unbiased rings exist for outline validity, which only the
      // legality build serves. A contour vertex drag rebuilds this per frame.
      const ring = flattenOutline(shape, { bias: "none" });
      unbiased.push(ring);
      biased.push(ring);
      continue;
    }
    const plain = flattenRefined(shape, "none");
    unbiased.push(plain.ring);
    const attempt = flattenRefined(shape, ringBias(bias, i));
    if (attempt.selfIntersects) {
      // Below any manufacturable web: fall back to the unbiased ring, say so.
      fallbacks.push(i);
      biased.push(plain.ring);
    } else {
      biased.push(attempt.ring);
    }
  }
  const edges: RegionEdge[] = [];
  const ringBounds = biased.map((ring) => boundsOfPoints(ring));
  for (let i = 0; i < biased.length; i += 1) pushRingEdges(edges, biased[i]!, i);
  return {
    outer: biased[0] ?? [],
    holes: biased.slice(1),
    unbiasedOuter: unbiased[0] ?? [],
    unbiasedHoles: unbiased.slice(1),
    bounds: ringBounds[0] ?? { ...EMPTY_BOUNDS },
    ringBounds,
    edges,
    fallbacks,
  };
}

/**
 * `exact`, `boundMm`, `maxBoundMm` and `outerBias` are memoised LAZY properties,
 * and deliberately NON-ENUMERABLE. `buildBoardRegion` runs on the render path
 * (`pointInOutline`, the resize warning, the fill extent) where a second biased
 * flattening plus an edge index would be pure cost, and the whole point of the
 * S2 byte-identity guarantee is that a region compares and serialises exactly as
 * it did before S12b. Reading any of them computes it once.
 *
 * A `"board-outer"` region's own `outerBias` is ITSELF: the mirror of the mirror
 * would be a fresh inner region, and nothing asks for one.
 */
function attachDerived(
  region: BoardRegion,
  outline: PcbBoardOutline,
  cutouts: readonly PcbBoardCutout[],
  isOuterBias: boolean,
): void {
  let exact: RegionExactRings | undefined;
  let bounds: { perRing: number[]; max: number } | undefined;
  let outerBias: BoardRegionOuterBias | undefined;

  const exactRings = (): RegionExactRings => {
    exact ??= {
      outer: exactContour(outline),
      holes: cutouts.map((c) => exactContour(c.shape)),
    };
    return exact;
  };
  const chordBounds = (): { perRing: number[]; max: number } => {
    if (!bounds) {
      const perRing = [outline, ...cutouts.map((c) => c.shape)].map(
        outlineChordBoundMm,
      );
      bounds = { perRing, max: perRing.reduce((m, b) => Math.max(m, b), 0) };
    }
    return bounds;
  };
  const lazy = (name: string, get: () => unknown): void => {
    Object.defineProperty(region, name, { get, enumerable: false, configurable: true });
  };

  lazy("exact", exactRings);
  lazy("boundMm", () => chordBounds().perRing);
  lazy("maxBoundMm", () => chordBounds().max);
  lazy("outerBias", () => {
    if (!outerBias) {
      const sub = isOuterBias
        ? region
        : buildBoardRegion(outline, cutouts, { bias: "board-outer" });
      outerBias = {
        outer: sub.outer,
        holes: sub.holes,
        index: buildRegionIndex(sub),
        region: sub,
      };
    }
    return outerBias;
  });
}

/**
 * One rule per arc: inscribe when the arc's centre lies on the region-interior
 * side, circumscribe otherwise. Per ring that is "inward" for the outer ring
 * and "outward" for every hole — both shrink the board region, so the
 * polygonal region is a subset of the true one. `"board-outer"` mirrors it.
 */
export function buildBoardRegion(
  outline: PcbBoardOutline,
  cutouts: readonly PcbBoardCutout[],
  options: BuildBoardRegionOptions = { bias: "none" },
): BoardRegion {
  const region = buildRings(outline, cutouts, options.bias) as BoardRegion;
  attachDerived(region, outline, cutouts, options.bias === "board-outer");
  return region;
}
