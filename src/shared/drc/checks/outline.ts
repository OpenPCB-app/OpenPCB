import { ringsIntersect, ringStrictlyInside } from "../../pcb-geometry/board-region";
import { ringSelfIntersects } from "../../pcb-geometry/segment-predicates";
import { DEGENERATE_AREA_MM2, ringSignedArea } from "../../pcb-geometry/ring-utils";
import {
  boundsIntersectionCenter,
  boundsOfPoints,
} from "../../pcb-geometry/region-rings";
import type { ExactPrim, ExactRing } from "../../pcb-geometry/exact-arcs";
import { pointInExactRing } from "../../pcb-geometry/exact-ring";
import {
  type ExactEntry,
  exactEntryOf,
  exactRingProblem,
  primIsFinite,
  type RingFault,
  type RingProblem,
  ringsTouchExactly,
} from "../../pcb-geometry/exact-simplicity";
import {
  exactContourBounds,
  exactRingSignedArea,
} from "../../pcb-geometry/exact-contour";
import {
  type ExactBudget,
  ExactBudgetExceeded,
} from "../../pcb-geometry/region-exact";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import type { Point } from "../../pcb-geometry/pcb-trace-geometry";
import type { DrcContext, LegalityContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/** Everything the outline verdict reads — no items, no rules, no projection. */
type OutlineInput = Pick<
  LegalityContext,
  "outlineRing" | "cutoutRings" | "boardRegion"
>;

/**
 * Primitive comparisons ONE `outlineProblems` call may spend (12 §3, §10).
 * Exact simplicity is O(P²) in the worst case and the bounds sweep only makes
 * it output-sensitive; a shape that defeats the sweep must STOP and say so
 * rather than run for seconds. 500 000 comparisons is ~4 000 primitives'
 * worth of a well-separated board and far beyond any authored outline.
 */
const OUTLINE_EXACT_BUDGET = 500_000;

/**
 * Board-outline validity (resurrects the dead BOARD_OUTLINE_INVALID code —
 * audit B4-5). Runs FIRST so a malformed outline contextualizes the noise the
 * edge/off-board checks would otherwise emit.
 *
 * Every rule is judged on the EXACT rings (exact-geometry contract 12 §3): a
 * return edge 0.002 mm inside a fillet is simple, and a circular cutout
 * 0.005 mm outside the board is a breach — neither of which the chord rings
 * could tell apart. A `{ kind: "chords" }` ring (an ellipse, 12 §2.4) has no
 * exact form and keeps today's chord rules: `ringSelfIntersects` on the refined
 * unbiased ring, the biased containment and the biased separation.
 */
function ringIsFinite(ring: readonly Point[]): boolean {
  return ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Centre of a ring's true bounding box — the marker rule (e) asks for. */
function exactRingCenter(ring: ExactRing, fallback: Point): Point {
  const box = exactContourBounds(ring);
  if (!Number.isFinite(box.minX) || !Number.isFinite(box.maxX)) return fallback;
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** A point of the ring, for the strict-containment probes of (c) and (e). */
function ringProbe(entry: ExactEntry): Point | null {
  return entry.prims[0]?.a ?? null;
}

/**
 * The `BOARD_OUTLINE_INVALID` drafts of a board — the ONE outline verdict.
 * `buildDrcItems` runs it once for `ctx.outlineInvalid` (07 §6: with an invalid
 * outline the commit gate reports rather than refuses the off-board tier) and
 * `checkOutline` returns exactly this list, so the gate and the report can
 * never disagree about whether the outline is broken.
 */
export function outlineProblems(ctx: OutlineInput): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const outline = ctx.outlineRing;
  const region = ctx.boardRegion;

  const emit = (message: string, locationMm: Point) => {
    out.push({
      code: "BOARD_OUTLINE_INVALID",
      message,
      anchors: [{ kind: "boardEdge" }],
      locationMm,
    });
  };
  // ONE budget for the whole verdict. Exhausting it is a REPORTED outcome: the
  // ring or pair that ran out keeps today's chord verdict and the run carries a
  // note (12 §3, §10) — never a silent pass, never a silent drop.
  const budget: ExactBudget = { comparisons: OUTLINE_EXACT_BUDGET };
  let budgetSpent = false;
  /** Run an exact rule; on exhaustion fall back to the chord verdict. */
  const tryExact = <T>(exact: () => T, chord: () => T): T => {
    try {
      return exact();
    } catch (error) {
      if (!(error instanceof ExactBudgetExceeded)) throw error;
      budgetSpent = true;
      return chord();
    }
  };

  const exactRings = region.exact;
  const outerEntry = exactEntryOf(exactRings.outer);
  const holeEntries = exactRings.holes.map(exactEntryOf);

  // (a) A non-finite coordinate anywhere — the chord ring AND the exact
  // primitives, because a non-finite arc CENTRE flattens to a finite chord.
  if (!ringIsFinite(outline) || !outerEntry.prims.every(primIsFinite)) {
    emit("Board outline has a non-finite coordinate", outline[0] ?? { x: 0, y: 0 });
    return out;
  }
  // (a) Zero area. There is NO primitive-count rule on the exact ring (two
  // semicircles are a circle); a chords ring keeps today's vertex floor.
  const outerEmpty = outerEntry.exact
    ? outerEntry.prims.length === 0 ||
      Math.abs(exactRingSignedArea(outerEntry.ring)) < DEGENERATE_AREA_MM2
    : outline.length < 3 ||
      Math.abs(ringSignedArea(outline)) < DEGENERATE_AREA_MM2;
  if (outerEmpty) {
    emit("Board outline is empty or has zero area", outline[0] ?? { x: 0, y: 0 });
    return out; // nothing else is meaningful without a valid outer ring
  }
  const outerProblem = outerEntry.exact
    ? tryExact(
        () => exactRingProblem(outerEntry, budget),
        () =>
          ringSelfIntersects(outline)
            ? ({ fault: "crossing", at: outline[0]! } as RingProblem)
            : null,
      )
    : ringSelfIntersects(outline)
      ? ({ fault: "crossing", at: outline[0]! } as RingProblem)
      : null;
  if (outerProblem) emit(outlineFaultMessage(outerProblem.fault, "Board outline"), outerProblem.at);

  const degenerate = ctx.cutoutRings.map((cut, i) => {
    const entry = holeEntries[i];
    if (!entry) return true;
    if (!ringIsFinite(cut) || !entry.prims.every(primIsFinite)) return true;
    return entry.exact
      ? entry.prims.length === 0 ||
          Math.abs(exactRingSignedArea(entry.ring)) < DEGENERATE_AREA_MM2
      : cut.length < 3 || Math.abs(ringSignedArea(cut)) < DEGENERATE_AREA_MM2;
  });
  ctx.cutoutRings.forEach((cut, i) => {
    const where = cut[0] ?? outline[0]!;
    const entry = holeEntries[i]!;
    if (!ringIsFinite(cut) || !entry.prims.every(primIsFinite)) {
      emit(`Cutout ${i + 1} has a non-finite coordinate`, where);
      return;
    }
    if (degenerate[i]) {
      emit(`Cutout ${i + 1} is empty or has zero area`, where);
      return;
    }
    const problem = entry.exact
      ? tryExact(
          () => exactRingProblem(entry, budget),
          () =>
            ringSelfIntersects(cut)
              ? ({ fault: "crossing", at: where } as RingProblem)
              : null,
        )
      : ringSelfIntersects(cut)
        ? ({ fault: "crossing", at: where } as RingProblem)
        : null;
    if (problem) {
      emit(outlineFaultMessage(problem.fault, `Cutout ${i + 1}`), problem.at);
    }
    // (c) The cutout must lie strictly inside the outer outline: no primitive
    // contact (inclusive at GEOM_EPS_MM), and one of its points strictly
    // inside. Touching or crossing the edge leaves a zero-width or negative
    // web. A chords ring keeps the biased-ring containment.
    const breach = tryExact(
      (): Point | null => {
        if (!entry.exact || !outerEntry.exact) {
          return ringStrictlyInside(region.holes[i]!, region.outer) ? null : where;
        }
        const contact = ringsTouchExactly(outerEntry, entry, budget);
        if (contact) return contact;
        const probe = ringProbe(entry);
        if (!probe) return where;
        return pointInExactRing(outerEntry.ring, probe, GEOM_EPS_MM) === "inside"
          ? null
          : probe;
      },
      () => (ringStrictlyInside(region.holes[i]!, region.outer) ? null : where),
    );
    if (breach) {
      emit(`Cutout ${i + 1} touches or extends outside the board outline`, breach);
    }
  });
  // Cutouts must not touch, overlap or nest. Every eligible pair is tested and
  // reported, independent of the per-cutout early returns above, so the
  // violation multiset does not depend on authoring order.
  for (let i = 0; i < ctx.cutoutRings.length; i += 1) {
    if (degenerate[i]) continue;
    const a = holeEntries[i]!;
    for (let j = i + 1; j < ctx.cutoutRings.length; j += 1) {
      if (degenerate[j]) continue;
      const b = holeEntries[j]!;
      const chordTouch = (): boolean =>
        ringsIntersect(region.holes[i]!, region.holes[j]!);
      const touching = tryExact(
        () =>
          a.exact && b.exact ? ringsTouchExactly(a, b, budget) !== null : chordTouch(),
        chordTouch,
      );
      if (touching) {
        // Marker = the centre of the two rings' box overlap: symmetric in the
        // pair and distinct per pair, so two pairs sharing one cutout get two
        // ids (the code is location-hashed, contract 06 §6).
        emit(
          `Cutouts ${i + 1} and ${j + 1} touch or overlap`,
          boundsIntersectionCenter(
            boundsOfPoints(region.holes[i]!),
            boundsOfPoints(region.holes[j]!),
          ),
        );
        continue;
      }
      // (e) Nesting. Concentric cutouts pass every pairwise rule above — today
      // and under (b)–(d) — and the material between them is not material at
      // all. The marker is the INNER cutout's centre.
      const inner = nestedInside(a, b);
      if (inner === null) continue;
      const innerIdx = inner === 0 ? i : j;
      const outerIdx = inner === 0 ? j : i;
      emit(
        `Cutout ${innerIdx + 1} lies inside cutout ${outerIdx + 1} — merge them`,
        exactRingCenter(
          holeEntries[innerIdx]!.ring,
          ctx.cutoutRings[innerIdx]![0] ?? outline[0]!,
        ),
      );
    }
  }

  if (budgetSpent) {
    out.push({
      code: "OUTLINE_WEB_UNCHECKED",
      message: `Board outline validity not fully certified: the ${OUTLINE_EXACT_BUDGET} exact-geometry comparison budget was exhausted, so the chord verdict stands`,
      anchors: [{ kind: "boardEdge" }],
    });
  }

  return out;
}

/** Which ring lies inside the other, or null when neither does (§3 (e)). */
function nestedInside(a: ExactEntry, b: ExactEntry): 0 | 1 | null {
  const pa = ringProbe(a);
  if (pa && pointInExactRing(b.ring, pa, GEOM_EPS_MM) === "inside") return 0;
  const pb = ringProbe(b);
  if (pb && pointInExactRing(a.ring, pb, GEOM_EPS_MM) === "inside") return 1;
  return null;
}

/**
 * §3.1's wording. The crossing message is today's, verbatim — the goldens pin
 * its id — while the retrace and the degenerate primitive get their own.
 */
function outlineFaultMessage(fault: RingFault, subject: string): string {
  if (fault === "retrace") return `${subject} retraces the same arc`;
  if (fault === "degenerate") return `${subject} has a degenerate edge`;
  return `${subject} self-intersects`;
}

/**
 * The outline verdict `buildDrcItems` already computed (R1 #5) — a copy, so a
 * caller that mutates the returned array cannot corrupt the context's cache.
 */
export function checkOutline(ctx: DrcContext): DrcViolationDraft[] {
  return [...ctx.outlineDrafts];
}
