/**
 * The EXACT analogues of the region containment and margin predicates
 * (exact-geometry contract 12 §4) — what an AMBIGUOUS certified interval is
 * recomputed with. They read the exact rings only; the chord region never
 * enters here.
 *
 * Budgeted: the recipe is O(core edges × ring primitives), so every entry point
 * accepts a `comparisons` counter and throws {@link ExactBudgetExceeded} when it
 * runs out. The caller keeps today's inner-region verdict and records a note —
 * never a silent pass, never a silent drop.
 */
import type { PcbPointMm } from "../../sdks";
import type { RegionExactRings } from "./board-region";
import {
  arcAngleAtOffset,
  arcAngleOffset,
  arcPointAt,
  type ExactPrim,
  type ExactRing,
  pointToPrimDistance,
  primIntersectionPoints,
  type RingBoundsMm,
  segmentToPrimDistance,
} from "./exact-arcs";
import {
  boundsMeetMm,
  exactRingBounds,
  pointInExactRing,
  ringBoundMm,
  ringPrims,
} from "./exact-ring";
import { PARAM_EPS, strictlyInsideRing } from "./region-rings";
import type { RoundedShape } from "./rounded-shape-types";
import { canonicalizeRing } from "./ring-utils";
import { projectPointToSegment } from "./segment-predicates";
import { GEOM_EPS_MM } from "./tolerance";

export class ExactBudgetExceeded extends Error {
  constructor(message = "exact geometry budget exhausted") {
    super(message);
    this.name = "ExactBudgetExceeded";
  }
}

/** Remaining primitive comparisons. Mutated in place, shared across one run. */
export interface ExactBudget {
  comparisons: number;
}

export interface ExactOptions {
  eps?: number;
  budget?: ExactBudget;
  /**
   * Rings whose bounds, inflated by this, do not meet the item are skipped —
   * they cannot touch it. Default: every ring.
   */
  haloMm?: number;
}

export interface ExactMarginResult {
  marginMm: number;
  inside: boolean;
  /**
   * False when a `{ kind: "chords" }` ring (an ellipse) was consulted: its
   * `boundMm` counts on both sides, so no answer through it is exact.
   */
  certain: boolean;
}

function spend(budget: ExactBudget | undefined, cost: number): void {
  if (!budget) return;
  budget.comparisons -= cost;
  if (budget.comparisons < 0) throw new ExactBudgetExceeded();
}

function coreOf(shape: RoundedShape, eps: number): PcbPointMm[] {
  return canonicalizeRing(shape.core, eps);
}

function coreBounds(core: readonly PcbPointMm[], r: number): RingBoundsMm {
  const b: RingBoundsMm = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const p of core) {
    if (p.x - r < b.minX) b.minX = p.x - r;
    if (p.y - r < b.minY) b.minY = p.y - r;
    if (p.x + r > b.maxX) b.maxX = p.x + r;
    if (p.y + r > b.maxY) b.maxY = p.y + r;
  }
  return b;
}

/** The core's edges: the closed ring for 3+ points, the single spine for 2. */
function coreEdges(
  core: readonly PcbPointMm[],
): Array<{ a: PcbPointMm; b: PcbPointMm }> {
  if (core.length < 2) return [];
  if (core.length === 2) return [{ a: core[0]!, b: core[1]! }];
  return core.map((a, i) => ({ a, b: core[(i + 1) % core.length]! }));
}

function coreToPrimDistance(
  core: readonly PcbPointMm[],
  prim: ExactPrim,
): number {
  if (core.length === 0) return Infinity;
  if (core.length === 1) return pointToPrimDistance(core[0]!, prim);
  let best = Infinity;
  for (const e of coreEdges(core)) {
    const d = segmentToPrimDistance(e.a, e.b, prim);
    if (d < best) best = d;
  }
  return best;
}

/** Midpoints of a segment split at every exact contact with `prims`. */
function segmentSubMidpoints(
  a: PcbPointMm,
  b: PcbPointMm,
  prims: readonly ExactPrim[],
  eps: number,
  budget: ExactBudget | undefined,
): PcbPointMm[] {
  const params: number[] = [0, 1];
  const edge: ExactPrim = { kind: "seg", a, b };
  for (const prim of prims) {
    spend(budget, 1);
    for (const pt of primIntersectionPoints(edge, prim, eps)) {
      params.push(projectPointToSegment(pt, a, b).t);
    }
  }
  params.sort((x, y) => x - y);
  const out: PcbPointMm[] = [];
  let prev = params[0]!;
  for (let i = 1; i < params.length; i += 1) {
    const t = params[i]!;
    if (t - prev <= PARAM_EPS) continue;
    const mid = (prev + t) / 2;
    out.push({ x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid });
    prev = t;
  }
  return out;
}

/** Midpoints of one ring primitive split at every contact with the core's edges. */
function primSubMidpoints(
  prim: ExactPrim,
  core: readonly PcbPointMm[],
  eps: number,
  budget: ExactBudget | undefined,
): PcbPointMm[] {
  const contacts: PcbPointMm[] = [];
  for (const e of coreEdges(core)) {
    spend(budget, 1);
    const edge: ExactPrim = { kind: "seg", a: e.a, b: e.b };
    contacts.push(...primIntersectionPoints(prim, edge, eps));
  }
  if (prim.kind === "seg") {
    const params = [0, 1];
    for (const pt of contacts) {
      params.push(projectPointToSegment(pt, prim.a, prim.b).t);
    }
    params.sort((x, y) => x - y);
    const out: PcbPointMm[] = [];
    let prev = params[0]!;
    for (let i = 1; i < params.length; i += 1) {
      const t = params[i]!;
      if (t - prev <= PARAM_EPS) continue;
      const mid = (prev + t) / 2;
      out.push({
        x: prim.a.x + (prim.b.x - prim.a.x) * mid,
        y: prim.a.y + (prim.b.y - prim.a.y) * mid,
      });
      prev = t;
    }
    return out;
  }
  const span = Math.abs(prim.sweep);
  const offsets = [0, span];
  for (const pt of contacts) {
    offsets.push(
      arcAngleOffset(prim, Math.atan2(pt.y - prim.c.y, pt.x - prim.c.x)),
    );
  }
  offsets.sort((x, y) => x - y);
  const out: PcbPointMm[] = [];
  let prev = offsets[0]!;
  for (let i = 1; i < offsets.length; i += 1) {
    const u = offsets[i]!;
    if (u > span || u - prev <= PARAM_EPS) continue;
    out.push(arcPointAt(prim, arcAngleAtOffset(prim, (prev + u) / 2)));
    prev = u;
  }
  return out;
}

interface ConsultedRings {
  outer: ExactRing;
  holes: ExactRing[];
  certain: boolean;
}

function consult(
  exact: RegionExactRings,
  core: readonly PcbPointMm[],
  radiusMm: number,
  haloMm: number,
): ConsultedRings {
  const box = coreBounds(core, radiusMm);
  const holes: ExactRing[] = [];
  for (const hole of exact.holes) {
    // A chord ring's vertices UNDERSTATE the curve it stands for by up to its
    // own bound, so the prefilter has to pay that back or it can skip a ring
    // the item actually reaches.
    if (!boundsMeetMm(exactRingBounds(hole), box, haloMm + ringBoundMm(hole))) {
      continue;
    }
    holes.push(hole);
  }
  const certain =
    ringBoundMm(exact.outer) === 0 && holes.every((h) => ringBoundMm(h) === 0);
  return { outer: exact.outer, holes, certain };
}

/**
 * Budgeted: a ray cast walks every primitive of every consulted ring, so it is
 * as much of the O(core × primitives) cost as the contact splitting is. Leaving
 * it out would let the caller's budget certify a run it never bounded.
 */
function pointInsideMaterial(
  rings: ConsultedRings,
  p: PcbPointMm,
  eps: number,
  budget: ExactBudget | undefined,
): boolean {
  spend(budget, ringPrims(rings.outer).length);
  if (pointInExactRing(rings.outer, p, eps) === "outside") return false;
  for (const hole of rings.holes) {
    spend(budget, ringPrims(hole).length);
    if (pointInExactRing(hole, p, eps) === "inside") return false;
  }
  return true;
}

/**
 * The exact analogue of `polygonInsideRegion` (12 §4). Vertices inside plus an
 * unsigned distance is NOT enough — it accepts a rect pad whose top edge crosses
 * a semicircular notch — so every core EDGE is split at its exact contacts with
 * the outer and hole primitives and every sub-interval midpoint is tested; then
 * no hole interior may meet the core interior; then, for `r > 0`, the exact
 * distance from the core to every primitive must clear the radius.
 */
export function exactInsideRegion(
  exact: RegionExactRings,
  shape: RoundedShape,
  options: ExactOptions = {},
): boolean {
  const eps = options.eps ?? GEOM_EPS_MM;
  const budget = options.budget;
  const core = coreOf(shape, eps);
  if (core.length === 0) return true;
  const r = shape.radiusMm;
  const rings = consult(exact, core, r, options.haloMm ?? Infinity);
  const prims = [...ringPrims(rings.outer), ...rings.holes.flatMap(ringPrims)];

  for (const v of core) {
    if (!pointInsideMaterial(rings, v, eps, budget)) return false;
  }
  for (const e of coreEdges(core)) {
    for (const mid of segmentSubMidpoints(e.a, e.b, prims, eps, budget)) {
      if (!pointInsideMaterial(rings, mid, eps, budget)) return false;
    }
  }
  if (core.length >= 3) {
    for (const hole of rings.holes) {
      for (const prim of ringPrims(hole)) {
        if (strictlyInsideRing(prim.a, core, eps)) return false;
        if (strictlyInsideRing(prim.b, core, eps)) return false;
        for (const mid of primSubMidpoints(prim, core, eps, budget)) {
          if (strictlyInsideRing(mid, core, eps)) return false;
        }
      }
    }
  }
  if (r > eps) {
    for (const prim of prims) {
      spend(budget, 1);
      if (coreToPrimDistance(core, prim) < r - eps) return false;
    }
  }
  return true;
}

/**
 * The exact signed margin (12 §4 `m`): the exact clearance less the radius when
 * the shape is inside, the exact penetration negated when it is not. Only rings
 * whose exact bounds, inflated by `haloMm`, meet the item are consulted.
 */
export function exactSignedMargin(
  exact: RegionExactRings,
  shape: RoundedShape,
  haloMm: number,
  options: ExactOptions = {},
): ExactMarginResult {
  const eps = options.eps ?? GEOM_EPS_MM;
  const budget = options.budget;
  const core = coreOf(shape, eps);
  const r = shape.radiusMm;
  const rings = consult(exact, core, r, haloMm);
  const prims = [...ringPrims(rings.outer), ...rings.holes.flatMap(ringPrims)];
  const inside = exactInsideRegion(exact, shape, { eps, budget, haloMm });
  if (inside) {
    let best = Infinity;
    for (const prim of prims) {
      spend(budget, 1);
      const d = coreToPrimDistance(core, prim);
      if (d < best) best = d;
    }
    return { marginMm: best - r, inside: true, certain: rings.certain };
  }
  let worst = 0;
  for (const v of core) {
    if (pointInsideMaterial(rings, v, eps, budget)) continue;
    let best = Infinity;
    for (const prim of prims) {
      spend(budget, 1);
      const d = pointToPrimDistance(v, prim);
      if (d < best) best = d;
    }
    if (Number.isFinite(best) && best > worst) worst = best;
  }
  // An item can fail containment with NO vertex outside — the Astra #3 rect
  // whose top edge alone crosses the notch has `worst = 0` and `r = 0`. The
  // margin must still be negative: `inside === false` and `marginMm >= 0` is a
  // contradiction the certified interval would read as a PASS. `GEOM_EPS_MM` is
  // the same floor `checks/board.ts` already puts under `measuredMm`, and the
  // clamp `x ↦ −max(x, eps)` is non-increasing, so `m_lo <= m_exact <= m_hi`
  // survives it (R1).
  return {
    marginMm: -Math.max(worst + r, GEOM_EPS_MM),
    inside: false,
    certain: rings.certain,
  };
}
