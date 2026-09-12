// Which copper the solder mask leaves UNCOVERED (electrical contract 13 §1.2).
//
// ONE rule for every item kind: an item is exposed on a face iff the union of
// ALL the mask openings on that face meets its copper. A pad's own opening
// exposes it; a TENTED via is still exposed where a neighbouring pad's opening
// reaches its copper (tenting says only that the via contributes no opening,
// never that no other opening covers it — Astra run 1 #4); a trace is exposed
// wherever any opening overlaps it.
//
// Closed at GEOM_EPS_MM on purpose. Exposure only ever moves a pair from the B4
// column to B2, which is the WIDER requirement in every band, so over-reporting
// it is the false-fail direction the contract allows and under-reporting it
// would be a false pass on an uncoated conductor.

import type { PcbPointMm } from "../../sdks/designer";
import type { EffectiveNetItem } from "../pcb-connectivity/effective-nets";
import { stadiumOverlapsRing } from "../pcb-geometry/area-overlap";
import {
  convexDistance,
  roundedOverlapsRing,
  roundedPoint,
  roundedPolylineGap,
} from "../pcb-geometry/rounded-shape";
import type { RoundedShape } from "../pcb-geometry/rounded-shape-types";
import { GEOM_EPS_MM } from "../pcb-geometry/tolerance";
// Type-only (erased): `drc-context.ts` imports VALUES from this module, so a
// value import back would be a real cycle.
import type { DrcPad, DrcTrace, DrcViaGeom, MaskFaceIndex } from "./drc-context";

/** Union of "interiors meet" and "boundaries within eps" — the closed relation. */
function shapeMeetsRing(
  shape: RoundedShape,
  ring: readonly PcbPointMm[],
): boolean {
  if (roundedOverlapsRing(shape, ring)) return true;
  return convexDistance(shape.core, ring) - shape.radiusMm <= GEOM_EPS_MM;
}

function traceMeetsRing(
  trace: DrcTrace,
  ring: readonly PcbPointMm[],
): boolean {
  if (trace.pointsMm.length === 0) return false;
  if (stadiumOverlapsRing(trace.pointsMm, trace.halfWidthMm, ring)) return true;
  return (
    roundedPolylineGap(trace.pointsMm, trace.halfWidthMm, {
      core: ring,
      radiusMm: 0,
    }) <= GEOM_EPS_MM
  );
}

function openingMeetsItem(
  item: EffectiveNetItem,
  ring: readonly PcbPointMm[],
): boolean {
  if (ring.length < 3) return false;
  if ("pointsMm" in item) return traceMeetsRing(item as DrcTrace, ring);
  if ("ring" in item) return shapeMeetsRing((item as DrcPad).rounded, ring);
  const via = item as DrcViaGeom;
  return shapeMeetsRing(roundedPoint(via.center, via.radiusMm), ring);
}

/**
 * Is this item's copper uncovered anywhere on `index`'s face? The broad phase
 * answers with a SUPERSET of the openings within the item's box, and each
 * candidate is then tested exactly — the same near-then-exact shape every other
 * indexed predicate has (08 §2.1).
 */
export function itemExposedOnFace(
  item: EffectiveNetItem,
  index: MaskFaceIndex,
): boolean {
  for (const i of index.near("pads", item.bounds, GEOM_EPS_MM)) {
    if (openingMeetsItem(item, index.rings[i]!)) return true;
  }
  return false;
}
