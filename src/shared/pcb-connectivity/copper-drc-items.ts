// Copper records → the three DRC copper primitives (traces, pads, vias).
//
// Extracted from `drc/drc-context.ts` `itemsFromRecords` so the COPPER POUR can
// derive the same items the DRC context does (electrical contract 13 §3.2 a):
// the pour needs effective nets, `pcb-connectivity/effective-nets.ts` is stated
// on these shapes, and a second, simpler conversion in the fill kernel would be
// a second layer policy — the very drift `itemsFromRecords` exists to prevent.
//
// `drc-context.ts` value-imports the fill kernel, so the fill kernel can never
// value-import it back; this module is the shared half, and its view of the
// three interfaces is type-only for exactly that reason.

import type {
  DrcAnchor,
  PcbCopperLayerId,
  PcbLayerCount,
} from "../../sdks/designer";
import { isValidViaSpan } from "../../sdks/designer";
import type { DrcPad, DrcTrace, DrcViaGeom } from "../drc/drc-context";
import { padRecordKey } from "./copper-items";
import type { CopperPadAnchor, CopperRecords } from "./copper-records";

export interface CopperDrcItems {
  traces: DrcTrace[];
  pads: DrcPad[];
  vias: DrcViaGeom[];
}

/** Widen a copper record's pad anchor to the DRC anchor union. */
function padAnchor(anchor: CopperPadAnchor): DrcAnchor {
  return anchor.kind === "pad"
    ? {
        kind: "pad",
        placementId: anchor.placementId,
        padNumber: anchor.padNumber,
      }
    : { kind: "freePad", freePadId: anchor.freePadId };
}

/**
 * The three copper item arrays of one record set, under the CLAMP policy: a
 * pad or via whose declared layer / span is invalid for this stackup is checked
 * on EVERY valid copper layer, so its physical copper cannot escape a short
 * (audit B5-PAD-LAYER, B5-VIA-MASK).
 *
 * Every array and point object is COPIED out of the records at this boundary:
 * the same records back the connectivity items, and a consumer that reordered
 * or mutated a primitive in place would silently corrupt the graph.
 */
export function copperDrcItems(
  records: CopperRecords,
  validCopperLayers: ReadonlySet<PcbCopperLayerId>,
  layerCount: PcbLayerCount,
): CopperDrcItems {
  const traces: DrcTrace[] = records.traces.map((t) => ({
    id: t.id,
    netId: t.netId,
    layer: t.layer,
    widthMm: t.widthMm,
    halfWidthMm: t.halfWidthMm,
    pointsMm: t.pointsMm.map((p) => ({ x: p.x, y: p.y })),
    bounds: { ...t.bounds },
    mid: { ...t.mid },
  }));

  const pads: DrcPad[] = records.pads.map((p) => {
    const ring = p.ring.map((v) => ({ x: v.x, y: v.y }));
    return {
      anchor: padAnchor(p.anchor),
      key: padRecordKey(p),
      netId: p.netId,
      layers: p.declaredLayerInvalid
        ? [...validCopperLayers]
        : [...p.resolvedLayers],
      ring,
      bounds: { ...p.bounds },
      center: { ...p.center },
      // Copied, not aliased — same reason as every other field here. A `rect` /
      // `trapezoid` / `custom` core IS the ring (12 §1.1), so it shares this
      // copy rather than allocating a second identical array.
      ...(p.disc
        ? { disc: { center: { ...p.disc.center }, radiusMm: p.disc.radiusMm } }
        : {}),
      rounded: {
        core:
          p.rounded.core === p.ring
            ? ring
            : p.rounded.core.map((v) => ({ x: v.x, y: v.y })),
        radiusMm: p.rounded.radiusMm,
      },
      exactShape: p.exactShape,
      declaredLayerInvalid: p.declaredLayerInvalid,
      plated: p.plated,
    };
  });

  const vias: DrcViaGeom[] = records.vias.map((v) => ({
    via: v.via,
    netId: v.netId,
    center: { ...v.center },
    radiusMm: v.radiusMm,
    layers: v.layerSpanInvalid ? [...validCopperLayers] : [...v.span],
    layerSpanInvalid: v.layerSpanInvalid,
    viaTypeInvalid:
      !v.layerSpanInvalid &&
      !isValidViaSpan(v.via.fromLayer, v.via.toLayer, v.via.viaType, layerCount)
        .ok,
    bounds: { ...v.bounds },
  }));

  return { traces, pads, vias };
}
