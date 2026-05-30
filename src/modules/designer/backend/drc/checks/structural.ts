import { placementPads } from "../../pcb/pad-geometry";
import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/** Each placed part must carry a footprint with at least one pad. */
export function checkStructural(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  for (const p of ctx.projection.placements) {
    if (placementPads(p).length === 0) {
      out.push({
        code: "PLACED_PART_MISSING_FOOTPRINT",
        ruleClass: "structural",
        severity: "error",
        message: `Placed part ${p.reference} has no footprint pads — it cannot be routed or correlated to nets`,
        anchors: [{ kind: "placement", placementId: p.id }],
        locationMm: p.positionMm,
      });
    }
  }
  return out;
}
