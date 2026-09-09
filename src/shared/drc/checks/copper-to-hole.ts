import type {
  DrcAnchor,
  PcbCopperLayerId,
} from "../../../sdks/designer";
import { copperToHoleClearanceMm } from "../rule-resolver";
import type { RingBounds } from "../../pcb-geometry/pad-outline";
import {
  clearanceViolated,
  GEOM_EPS_MM,
} from "../../pcb-geometry/tolerance";
import {
  aabbGap,
  holeBounds,
  type DrcContext,
  type DrcHole,
  type LegalityContext,
} from "../drc-context";
import { copperHoleGap, type DrcCopperItem } from "../pair-gap";
import type { ItemSet } from "./clearance-judge";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";

/** One copper item with everything the pair needs, resolved once per item. */
interface CopperSubject {
  item: DrcCopperItem;
  anchor: DrcAnchor;
  key: string;
  bounds: RingBounds;
  subject: "Trace" | "Pad" | "Via";
  layer?: PcbCopperLayerId;
}

/**
 * A drill passes through the whole stackup, so every trace is a candidate
 * whatever layer it declares; a pad or a via spans layers of its own and
 * carries no single layer to report.
 */
function copperSubjects(copper: ItemSet): CopperSubject[] {
  const out: CopperSubject[] = [];
  for (const t of copper.traces) {
    const anchor: DrcAnchor = { kind: "trace", traceId: t.id };
    out.push({
      item: t,
      anchor,
      key: anchorKey(anchor),
      bounds: t.bounds,
      subject: "Trace",
      layer: t.layer,
    });
  }
  for (const pad of copper.pads) {
    out.push({
      item: pad,
      anchor: pad.anchor,
      key: anchorKey(pad.anchor),
      bounds: pad.bounds,
      subject: "Pad",
    });
  }
  for (const vg of copper.vias) {
    const anchor: DrcAnchor = { kind: "via", viaId: vg.via.id };
    out.push({
      item: vg,
      anchor,
      key: anchorKey(anchor),
      bounds: vg.bounds,
      subject: "Via",
    });
  }
  return out;
}

/**
 * `COPPER_TO_HOLE` for one copper set against one hole set — the shared body
 * batch and the live gate both run (07 §3). `replaces` filters the BOARD side
 * (a replaced via takes its barrel with it); the copper set is the caller's
 * chosen subject set and is never filtered by it.
 */
export function copperToHolePairs(
  ctx: LegalityContext,
  copper: ItemSet,
  holes: readonly DrcHole[],
  opts: { replaces?: ReadonlySet<string>; out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  const required = copperToHoleClearanceMm(ctx.designRules);
  const subjects = copperSubjects(copper);
  if (subjects.length === 0) return;
  // The grid indexes the CONTEXT's holes; any other `holes` falls back to the
  // hole-outer scan, which the exact `aabbGap` re-test in `judge` makes
  // equivalent. The batch call (board copper × board holes) now takes the
  // subject-outer branch too (08 §4) — except in `"exhaustive"` mode, where the
  // pre-S9 hole-outer scan below is the oracle (§3). A pending subject set was
  // already gridded before S9, so exhaustive leaves that path alone.
  const copperIsBoard =
    copper.traces === ctx.traces &&
    copper.pads === ctx.pads &&
    copper.vias === ctx.vias;
  const gridded =
    holes === ctx.holes && (!copperIsBoard || ctx.broadPhase !== "exhaustive");

  const judge = (s: CopperSubject, hole: DrcHole, holeKey: string): void => {
    // A drilled free pad's OWN hole is not a pair: its copper is placed on
    // that drill by construction.
    if (s.key === holeKey) return;
    // Both boxes contain their shape, so the box gap is a LOWER bound of the
    // real one — this can skip a clearing pair, never a violating one.
    // The same threshold grace `farApart` carries (Astra R2 #2): `aabbGap` is a
    // different float computation from `copperHoleGap`, so it must not be the
    // stricter of the two at an exact-boundary pair.
    if (aabbGap(s.bounds, holeBounds(hole)) > required + GEOM_EPS_MM) return;
    const { gap } = copperHoleGap(s.item, hole);
    if (!clearanceViolated(gap, required)) return;
    // Canonical anchor orientation (contract 06 §7): the smaller anchor key
    // leads. This was the one pair check without it — two coincident drilled
    // free pads are each other's copper AND hole, their two drafts hash to one
    // id and tie on every field the survivor order compares, so the reported
    // `anchors` followed draft order, which the S9 mode switch reverses (R1 #1).
    const anchors: [DrcAnchor, DrcAnchor] =
      s.key < holeKey ? [s.anchor, hole.anchor] : [hole.anchor, s.anchor];
    out.push({
      code: "COPPER_TO_HOLE",
      message: `${s.subject} is ${gap.toFixed(3)} mm from a non-plated hole (min ${required.toFixed(3)} mm)`,
      anchors,
      locationMm: hole.center,
      ...(s.layer ? { layer: s.layer } : {}),
      measuredMm: gap,
      requiredMm: required,
    });
  };

  const skipped = (hole: DrcHole): boolean =>
    hole.kind !== "npth" ||
    (opts.replaces !== undefined &&
      hole.anchor.kind === "via" &&
      opts.replaces.has(hole.anchor.viaId));

  if (!gridded) {
    // Hole-outer, exactly as the check has always enumerated: the subject order
    // inside one hole (traces, pads, vias) is what the draft order follows.
    for (const hole of holes) {
      if (skipped(hole)) continue;
      const holeKey = anchorKey(hole.anchor);
      for (const s of subjects) judge(s, hole, holeKey);
    }
    return;
  }
  // Subject-outer over the indexed holes — the same pair set (the grid is a
  // superset of the `aabbGap <= halo` neighbours, and `judge` re-tests
  // exactly), reached without walking every drill on the board (R1 #2).
  for (const s of subjects) {
    for (const i of ctx.near("holes", s.bounds, ctx.maxHoleBoundMm)) {
      const hole = ctx.holes[i]!;
      if (skipped(hole)) continue;
      judge(s, hole, ctx.holeKeys[i]!);
    }
  }
}

/**
 * `COPPER_TO_HOLE` — trace / pad / via copper against every NON-PLATED drill
 * (free holes and non-plated free-pad drills), the pair kind the pour has
 * always cleared and DRC never judged (contract 06 §4).
 *
 * The required value is `copperToHoleClearanceMm` — the SAME helper
 * `buildCopperFillIslands` reads for its NPTH halo, so the report and the
 * artwork agree by construction: a non-plated wall is bare substrate, which is
 * exactly what `copperToBoardEdgeMm` describes, and an absent
 * `clearance.copperToHoleMm` therefore changes nothing in either.
 *
 * A plated drill needs no pair of its own — its barrel is copper, and that
 * copper is already judged by `checks/clearance.ts`.
 */
export function checkCopperToHole(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  copperToHolePairs(ctx, ctx, ctx.holes, { out });
  return out;
}
