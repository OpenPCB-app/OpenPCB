/**
 * Exact SIMPLICITY and exact ring CONTACT (exact-geometry contract 12 §3 (b),
 * §3.2) — the ONE validity predicate authoring and DRC share.
 *
 * `checks/outline.ts` runs it for `BOARD_OUTLINE_INVALID` and
 * `rendering/pcb/contour-validation.ts` for the editor gate, so the draw tool
 * can never refuse a contour DRC accepts (or the reverse). It reads exact rings
 * only; the chord rings never enter.
 *
 * Budgeted: exact simplicity is O(P²) in the worst case and the bounds sweep
 * only makes it output-sensitive, so every entry point takes an
 * {@link ExactBudget} and throws {@link ExactBudgetExceeded} when it runs out.
 * The caller falls back to the chord verdict and SAYS so — never a silent pass.
 */
import type { PcbPointMm as Point } from "../../sdks";
import {
  ARC_ANGLE_EPS_RAD,
  arcAngleOffset,
  arcArcIntersections,
  closestPointOnArc,
  type ExactArc,
  type ExactPrim,
  type ExactRing,
  type ExactSeg,
  pointToPrimDistance,
  primDistance,
  primIntersectionPoints,
  type RingBoundsMm,
} from "./exact-arcs";
import { boundsMeetMm, exactPrimBounds, ringPrims } from "./exact-ring";
import { type ExactBudget, ExactBudgetExceeded } from "./region-exact";
import { projectPointToSegment } from "./segment-predicates";
import { GEOM_EPS_MM } from "./tolerance";

/** One ring's exact primitives with their true (arc-extrema) boxes. */
export interface ExactEntry {
  ring: ExactRing;
  prims: ExactPrim[];
  boxes: RingBoundsMm[];
  /** False for a `{ kind: "chords" }` ring — no rule here may certify it. */
  exact: boolean;
}

export function exactEntryOf(ring: ExactRing): ExactEntry {
  const prims = ringPrims(ring);
  return {
    ring,
    prims,
    boxes: prims.map(exactPrimBounds),
    exact: "prims" in ring,
  };
}

/** Every number an exact primitive carries is finite. */
export function primIsFinite(prim: ExactPrim): boolean {
  const ends =
    Number.isFinite(prim.a.x) &&
    Number.isFinite(prim.a.y) &&
    Number.isFinite(prim.b.x) &&
    Number.isFinite(prim.b.y);
  if (!ends) return false;
  if (prim.kind === "seg") return true;
  return (
    Number.isFinite(prim.c.x) &&
    Number.isFinite(prim.c.y) &&
    Number.isFinite(prim.r) &&
    Number.isFinite(prim.a0) &&
    Number.isFinite(prim.sweep)
  );
}

export type RingFault = "crossing" | "retrace" | "degenerate";

export interface RingProblem {
  fault: RingFault;
  at: Point;
}

function spend(budget: ExactBudget): void {
  budget.comparisons -= 1;
  if (budget.comparisons < 0) throw new ExactBudgetExceeded();
}

/** Lexicographic minimum — the ONE tie-break every witness here resolves by. */
export function smaller(a: Point | null, b: Point): Point {
  if (!a) return b;
  if (b.x < a.x || (b.x === a.x && b.y < a.y)) return b;
  return a;
}

/**
 * Candidate primitive pairs through a BOUNDS SWEEP (12 §3, §10): the boxes are
 * ordered by `minX` and an active list drops everything the sweep has passed,
 * so only pairs whose boxes meet within `haloMm` are ever compared. Never all
 * pairs. `right === null` sweeps `left` against itself.
 *
 * The visitor always receives the LEFT list's primitive first, so a rule that
 * distinguishes its two operands (cutout vs outer) cannot depend on which side
 * the sweep reached first.
 */
function sweepPairs(
  left: ExactEntry,
  right: ExactEntry | null,
  haloMm: number,
  budget: ExactBudget,
  visit: (i: number, j: number) => void,
): void {
  const self = right === null;
  const items: Array<{ side: 0 | 1; index: number; box: RingBoundsMm }> = [];
  left.boxes.forEach((box, index) => items.push({ side: 0, index, box }));
  right?.boxes.forEach((box, index) => items.push({ side: 1, index, box }));
  items.sort(
    (m, n) => m.box.minX - n.box.minX || m.side - n.side || m.index - n.index,
  );
  const active: typeof items = [];
  for (const cur of items) {
    for (let k = active.length - 1; k >= 0; k -= 1) {
      if (active[k]!.box.maxX + haloMm < cur.box.minX) active.splice(k, 1);
    }
    for (const other of active) {
      if (!self && other.side === cur.side) continue;
      spend(budget);
      if (!boundsMeetMm(other.box, cur.box, haloMm)) continue;
      if (self) visit(Math.min(other.index, cur.index), Math.max(other.index, cur.index));
      else if (other.side === 0) visit(other.index, cur.index);
      else visit(cur.index, other.index);
    }
    active.push(cur);
  }
}

/**
 * A witness point for a contact the intersection families cannot name: a
 * segment that misses an arc by less than the noise floor has NO quadratic
 * root, so `primIntersectionPoints` is empty while the true distance is under
 * `GEOM_EPS_MM`. The candidates are the four endpoints plus the one interior
 * stationary point of the segment↔arc family (the foot of the centre), scored
 * by their summed distance to both primitives. Stated limit (12 §3.1): for a
 * sub-nanometre near-tangency none of these need be the true contact point, so
 * the 0.1 mm id bucket can move.
 */
function nearContactWitness(a: ExactPrim, b: ExactPrim): Point {
  const candidates: Point[] = [a.a, a.b, b.a, b.b];
  const foot = (seg: ExactSeg, arc: ExactArc): Point => {
    const hit = projectPointToSegment(arc.c, seg.a, seg.b);
    return { x: hit.x, y: hit.y };
  };
  if (a.kind === "seg" && b.kind === "arc") candidates.push(foot(a, b));
  if (a.kind === "arc" && b.kind === "seg") candidates.push(foot(b, a));
  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const p of candidates) {
    const score = pointToPrimDistance(p, a) + pointToPrimDistance(p, b);
    if (score < bestScore) {
      bestScore = score;
      best = p;
    } else if (score === bestScore) {
      best = smaller(best, p);
    }
  }
  return best;
}

interface PrimContact {
  /** Contact within `GEOM_EPS_MM` — inclusive, as every §3 rule is. */
  touches: boolean;
  /** Two arcs of ONE circle covering a common interval: a boundary retrace. */
  overlap: boolean;
  points: Point[];
}

/**
 * Angular measure (radians) the two arcs' ranges SHARE. `arcArcIntersections`
 * reports coincident circles whose ranges merely TOUCH as an overlap, and two
 * adjacent arcs of one circle — a full-radius roundrect corner pair, the two
 * semicircles of a `circle` — always touch at their shared vertex. A retrace is
 * a shared INTERVAL (§3 (b)), so the measure, not the predicate, decides.
 *
 * Computed in `p`'s offset coordinates: `p` covers `[0, |p.sweep|]`, and `q`
 * covers one interval of length `|q.sweep|` starting at the offset of whichever
 * of its endpoints comes first ALONG p's direction. The shifted copy catches an
 * interval that wraps past `p.a0`.
 */
function arcOverlapRad(p: ExactArc, q: ExactArc): number {
  const span = Math.abs(p.sweep);
  const qSpan = Math.abs(q.sweep);
  if (span >= Math.PI * 2 - ARC_ANGLE_EPS_RAD) return qSpan;
  if (qSpan >= Math.PI * 2 - ARC_ANGLE_EPS_RAD) return span;
  const sameDirection = p.sweep >= 0 === q.sweep >= 0;
  const start = arcAngleOffset(p, sameDirection ? q.a0 : q.a0 + q.sweep);
  const overlapOf = (lo: number, hi: number): number =>
    Math.max(0, Math.min(span, hi) - Math.max(0, lo));
  return (
    overlapOf(start, start + qSpan) +
    overlapOf(start - Math.PI * 2, start + qSpan - Math.PI * 2)
  );
}

function primContact(a: ExactPrim, b: ExactPrim): PrimContact {
  const overlap =
    a.kind === "arc" && b.kind === "arc"
      ? arcArcIntersections(a, b, GEOM_EPS_MM).overlap &&
        arcOverlapRad(a, b) > ARC_ANGLE_EPS_RAD
      : false;
  const points = primIntersectionPoints(a, b, GEOM_EPS_MM);
  if (overlap || points.length > 0) return { touches: true, overlap, points };
  if (primDistance(a, b) > GEOM_EPS_MM) {
    return { touches: false, overlap: false, points };
  }
  return { touches: true, overlap: false, points: [nearContactWitness(a, b)] };
}

/** A primitive with no curve at all — §3 (b)'s degenerate arm. */
function degeneratePrim(prim: ExactPrim): boolean {
  if (prim.kind === "seg") {
    return Math.hypot(prim.b.x - prim.a.x, prim.b.y - prim.a.y) <= GEOM_EPS_MM;
  }
  // A zero-radius arc is a point; a full 2π sweep is a circle authored as one
  // segment (the editor's `full-circle-arc`). A sweep of 2π − ε plus a short
  // closing chord is NOT degenerate — a short chord is not evidence.
  return (
    prim.r <= GEOM_EPS_MM ||
    Math.abs(prim.sweep) >= Math.PI * 2 - ARC_ANGLE_EPS_RAD
  );
}

/** The vertices two primitives of one ring share by construction (§3 (b)). */
function sharedVertices(i: number, j: number, n: number, prims: ExactPrim[]): Point[] {
  const out: Point[] = [];
  // A TWO-primitive ring (a `circle` = two semicircles) shares BOTH endpoints,
  // and both junctions are legal (Astra run 1 #12).
  if ((j - i + n) % n === 1) out.push(prims[i]!.b);
  if ((i - j + n) % n === 1) out.push(prims[j]!.b);
  return out;
}

/**
 * §3 (b) on one exact ring: the ONE simplicity verdict, reported at its
 * lexicographically smallest witness so the location — and with it the
 * location-hashed id — cannot follow the sweep's own order.
 */
export function exactRingProblem(
  entry: ExactEntry,
  budget: ExactBudget,
): RingProblem | null {
  const prims = entry.prims;
  const n = prims.length;
  // A holder, not a `let`: the witness is chosen inside the sweep's visitor and
  // read after it, which a captured local would lose the narrowing of.
  const best: { value: RingProblem | null } = { value: null };
  const record = (fault: RingFault, at: Point): void => {
    const cur = best.value;
    if (!cur || at.x < cur.at.x || (at.x === cur.at.x && at.y < cur.at.y)) {
      best.value = { fault, at };
    }
  };
  for (const prim of prims) {
    if (degeneratePrim(prim)) record("degenerate", prim.a);
  }
  sweepPairs(entry, null, GEOM_EPS_MM, budget, (i, j) => {
    if (i === j) return;
    const contact = primContact(prims[i]!, prims[j]!);
    if (contact.overlap) {
      record("retrace", smallestPoint(contact.points) ?? prims[i]!.a);
      return;
    }
    if (!contact.touches) return;
    const shared = sharedVertices(i, j, n, prims);
    if (shared.length === 0) {
      record("crossing", smallestPoint(contact.points) ?? prims[i]!.b);
      return;
    }
    // Adjacent: only a contact AWAY from the shared endpoint(s) is a crossing.
    for (const p of contact.points) {
      if (shared.some((s) => Math.hypot(p.x - s.x, p.y - s.y) <= GEOM_EPS_MM)) {
        continue;
      }
      record("crossing", p);
    }
  });
  return best.value;
}

export function smallestPoint(points: readonly Point[]): Point | null {
  let best: Point | null = null;
  for (const p of points) best = smaller(best, p);
  return best;
}

/** Any contact between two rings' primitives, at its smallest witness (§3 c/d). */
export function ringsTouchExactly(
  a: ExactEntry,
  b: ExactEntry,
  budget: ExactBudget,
): Point | null {
  const best: { value: Point | null } = { value: null };
  sweepPairs(a, b, GEOM_EPS_MM, budget, (i, j) => {
    const contact = primContact(a.prims[i]!, b.prims[j]!);
    if (!contact.touches) return;
    best.value = smaller(best.value, smallestPoint(contact.points) ?? b.prims[j]!.a);
  });
  return best.value;
}

// --------------------------------------------------------------------------
// Ring-pair distance (12 §5.1, amended): how far apart two DISTINCT boundary
// rings are. The board material between two voids, or between a void and the
// edge, IS that distance — a measurement no erosion can lose.
// --------------------------------------------------------------------------

export interface RingPairContact {
  /** The EXACT minimum distance between the two rings' primitives. */
  distanceMm: number;
  /** Midpoint of the closest pair — a marker, not the measurement. */
  at: Point;
}

/**
 * The point of `p` nearest `q`, from the closed-form candidate families
 * (12 §2.3): `p`'s own endpoints, and `q`'s endpoints — plus, for an arc `q`,
 * its CENTRE, which is what puts the candidate on the line of centres — each
 * projected onto `p`. Deterministic: ties resolve lexicographically.
 *
 * It answers the MARKER, never the measurement: `primDistance` is the exact
 * distance and this only has to land between the two primitives.
 */
function closestPointOn(p: ExactPrim, q: ExactPrim): Point {
  const onto = (x: Point): Point => {
    if (p.kind === "arc") return closestPointOnArc(x, p);
    const hit = projectPointToSegment(x, p.a, p.b);
    return { x: hit.x, y: hit.y };
  };
  const candidates: Point[] = [p.a, p.b];
  /**
   * `x` projected onto `p` — and, when `p` is an arc, its ANTIPODE too: the
   * near side of a circle is not always the closest one. A Ø4 void sitting
   * 0.002 mm inside a r = 20 fillet has its closest point on the side AWAY from
   * the fillet's centre, and taking only the near one put the witness 1 mm off,
   * inside the void (Astra run 2 #A follow-through).
   */
  const ontoBoth = (x: Point): void => {
    candidates.push(onto(x));
    if (p.kind === "arc") {
      candidates.push(onto({ x: 2 * p.c.x - x.x, y: 2 * p.c.y - x.y }));
    }
  };
  ontoBoth(q.a);
  ontoBoth(q.b);
  // The INTERIOR stationary point, which no endpoint reaches: on the line of
  // centres against another arc, on `p`'s own normal to the segment otherwise.
  if (q.kind === "arc") {
    ontoBoth(q.c);
  } else if (p.kind === "arc") {
    const foot = projectPointToSegment(p.c, q.a, q.b);
    ontoBoth({ x: foot.x, y: foot.y });
  } else {
    ontoBoth({ x: (q.a.x + q.b.x) / 2, y: (q.a.y + q.b.y) / 2 });
  }
  let best = candidates[0]!;
  let bestD = Infinity;
  for (const x of candidates) {
    const d = pointToPrimDistance(x, q);
    if (d < bestD) {
      bestD = d;
      best = x;
    } else if (d === bestD) {
      best = smaller(best, x);
    }
  }
  return best;
}

/**
 * The closest approach of two rings, or null when nothing is within `maxMm`.
 * Bounds-swept and budgeted like every other exact path here: only primitive
 * pairs whose true (arc-extrema) boxes meet within `maxMm` are compared.
 */
export function ringPairDistance(
  a: ExactEntry,
  b: ExactEntry,
  maxMm: number,
  budget: ExactBudget,
): RingPairContact | null {
  const best: { value: RingPairContact | null } = { value: null };
  sweepPairs(a, b, maxMm, budget, (i, j) => {
    const p = a.prims[i]!;
    const q = b.prims[j]!;
    const distanceMm = primDistance(p, q);
    if (!(distanceMm <= maxMm)) return;
    const cur = best.value;
    if (cur && distanceMm > cur.distanceMm) return;
    const pa = closestPointOn(p, q);
    const pb = closestPointOn(q, p);
    const at: Point = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    if (cur && distanceMm === cur.distanceMm && smaller(cur.at, at) === cur.at) {
      return;
    }
    best.value = { distanceMm, at };
  });
  return best.value;
}
