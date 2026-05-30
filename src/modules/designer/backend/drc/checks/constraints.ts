import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/** Structural/stackup constraint checks. */
export function checkConstraints(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const layerCount = ctx.projection.board.layerCount;
  for (const t of ctx.traces) {
    if (!ctx.validCopperLayers.has(t.layer)) {
      out.push({
        code: "TRACE_LAYER_MISMATCH",
        ruleClass: "constraint",
        severity: "error",
        message: `Trace is on ${t.layer}, which is not a routable copper layer for a ${layerCount}-layer board`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
      });
    }
  }
  // A via must span at least two valid copper layers for this stackup.
  for (const vg of ctx.vias) {
    if (vg.layers.length < 2) {
      out.push({
        code: "VIA_LAYER_SPAN",
        ruleClass: "constraint",
        severity: "error",
        message: `Via does not span two valid copper layers (${vg.via.fromLayer} → ${vg.via.toLayer}) for a ${layerCount}-layer board`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
      });
    }
  }
  return out;
}
