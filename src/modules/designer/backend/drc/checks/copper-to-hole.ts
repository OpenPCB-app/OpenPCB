import type {
  DrcAnchor,
  PcbCopperLayerId,
} from "../../../../../sdks/designer";
import { copperToHoleClearanceMm } from "../../../../../shared/drc/rule-resolver";
import type { RingBounds } from "../../pcb/pad-outline";
import { clearanceViolated } from "../../pcb/tolerance";
import { aabbGap, type DrcContext, type DrcHole } from "../drc-context";
import { copperHoleGap, type DrcCopperItem } from "../pair-gap";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";

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
  const required = copperToHoleClearanceMm(ctx.designRules);

  for (const hole of ctx.holes) {
    if (hole.kind !== "npth") continue;
    const holeBox = holeBounds(hole);
    const holeKey = anchorKey(hole.anchor);

    const judge = (
      item: DrcCopperItem,
      anchor: DrcAnchor,
      bounds: RingBounds,
      subject: "Trace" | "Pad" | "Via",
      layer?: PcbCopperLayerId,
    ): void => {
      // A drilled free pad's OWN hole is not a pair: its copper is placed on
      // that drill by construction.
      if (anchorKey(anchor) === holeKey) return;
      // Both boxes contain their shape, so the box gap is a LOWER bound of the
      // real one — this can skip a clearing pair, never a violating one.
      if (aabbGap(bounds, holeBox) > required) return;
      const { gap } = copperHoleGap(item, hole);
      if (!clearanceViolated(gap, required)) return;
      out.push({
        code: "COPPER_TO_HOLE",
        message: `${subject} is ${gap.toFixed(3)} mm from a non-plated hole (min ${required.toFixed(3)} mm)`,
        anchors: [anchor, hole.anchor],
        locationMm: hole.center,
        ...(layer ? { layer } : {}),
        measuredMm: gap,
        requiredMm: required,
      });
    };

    // A drill passes through the whole stackup, so every trace is a candidate
    // whatever layer it declares; a pad or a via spans layers of its own and
    // carries no single layer to report.
    for (const t of ctx.traces) {
      judge(t, { kind: "trace", traceId: t.id }, t.bounds, "Trace", t.layer);
    }
    for (const pad of ctx.pads) judge(pad, pad.anchor, pad.bounds, "Pad");
    for (const vg of ctx.vias) {
      judge(vg, { kind: "via", viaId: vg.via.id }, vg.bounds, "Via");
    }
  }

  return out;
}

/** The drill's own extent: the disc, or the slot stadium, as a box. */
function holeBounds(hole: DrcHole): RingBounds {
  if (hole.slot) {
    const r = hole.slot.widthMm / 2;
    return {
      minX: Math.min(hole.slot.a.x, hole.slot.b.x) - r,
      minY: Math.min(hole.slot.a.y, hole.slot.b.y) - r,
      maxX: Math.max(hole.slot.a.x, hole.slot.b.x) + r,
      maxY: Math.max(hole.slot.a.y, hole.slot.b.y) + r,
    };
  }
  const r = hole.drillMm / 2;
  return {
    minX: hole.center.x - r,
    minY: hole.center.y - r,
    maxX: hole.center.x + r,
    maxY: hole.center.y + r,
  };
}
