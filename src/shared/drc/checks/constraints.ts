import type { DrcContext, LegalityContext } from "../drc-context";
import type { ItemSet } from "./clearance-judge";
import type { DrcViolationDraft } from "../types";

/**
 * The per-item stackup constraints of one item set (07 §3 "per item"): the same
 * bodies for the board's items and for pending copper, so a route's
 * `TRACE_LAYER_MISMATCH` / `VIA_LAYER_SPAN` wording and anchors are batch's.
 */
export function constraintItems(
  ctx: LegalityContext,
  items: ItemSet,
  opts: { out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  const layerCount = ctx.layerCount;
  for (const t of items.traces) {
    if (!ctx.validCopperLayers.has(t.layer)) {
      out.push({
        code: "TRACE_LAYER_MISMATCH",
        message: `Trace is on ${t.layer}, which is not a routable copper layer for a ${layerCount}-layer board`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
      });
    }
  }
  // Pads on an explicit copper layer that isn't valid for this stackup.
  for (const pad of items.pads) {
    if (pad.declaredLayerInvalid) {
      out.push({
        code: "PAD_LAYER_MISMATCH",
        message: `Pad is on a copper layer not valid for a ${layerCount}-layer board`,
        anchors: [pad.anchor],
        locationMm: pad.center,
      });
    }
  }
  // A via must span at least two valid copper layers for this stackup. The via
  // is still collision-checked on all valid layers (clamp-with-fallback), so
  // this error is non-waivable — waiving it must not hide the via's copper.
  for (const vg of items.vias) {
    if (vg.layerSpanInvalid || vg.viaTypeInvalid) {
      const message = vg.layerSpanInvalid
        ? `Via does not span two valid copper layers (${vg.via.fromLayer} → ${vg.via.toLayer}) for a ${layerCount}-layer board`
        : `Via span ${vg.via.fromLayer} → ${vg.via.toLayer} is invalid for a "${vg.via.viaType}" via on a ${layerCount}-layer board`;
      out.push({
        code: "VIA_LAYER_SPAN",
        message,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
      });
    }
  }
}

/** Structural/stackup constraint checks. */
export function checkConstraints(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  constraintItems(ctx, ctx, { out });
  return out;
}
