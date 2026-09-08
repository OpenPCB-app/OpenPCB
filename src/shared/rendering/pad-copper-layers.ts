/**
 * THE single pad→copper-layer resolver, shared by the zone-fill engine, the
 * DRC context, and the cloud board-snapshot (DRC_HARDENING_PLAN.md P2, fixes
 * audit B1-1 and B1-6). Encodes the one side-flip rule so DRC, rendering and
 * pours agree on which copper layer a pad's copper actually lives on.
 *
 * Rules:
 * - `"*.Cu"` (all-layer) or any drilled pad → every valid copper layer.
 * - Explicit copper id → that layer, side-flipped (F.* ↔ B.*) when the
 *   placement is on B.Cu (mirrors KiCad's atomic F↔B remap on flip). Inner
 *   layers pass through the flip unchanged.
 * - Missing / non-copper `pad.layer` → the placement's own side (SMD default).
 */
import { flipLayerSide } from "@openpcb/r3f-eda-canvas/scene/layer-side";
import type { PcbCopperLayerId, PcbPlacedPart } from "../../sdks/designer";
import { isCopperLayerId } from "../../sdks/designer";
import type { FootprintRenderSourcePad } from "./index";

export function resolvePadCopperLayers(
  pad: FootprintRenderSourcePad,
  placement: PcbPlacedPart,
  allCopperLayers: ReadonlySet<PcbCopperLayerId>,
): ReadonlySet<PcbCopperLayerId> {
  if (pad.layer === "*.Cu") return allCopperLayers;
  if (pad.drillDiameterMm && pad.drillDiameterMm > 0) return allCopperLayers;

  const layer = pad.layer;
  if (layer !== undefined && isCopperLayerId(layer)) {
    const effective: PcbCopperLayerId =
      placement.layer === "B.Cu"
        ? (flipLayerSide(layer) as PcbCopperLayerId)
        : layer;
    // A flip could name a layer outside a narrow stackup (shouldn't for
    // valid data); fall back to the placement side if so.
    if (allCopperLayers.has(effective)) return new Set([effective]);
  }

  return new Set([placementSideLayer(placement)]);
}

/**
 * THE one resolution of a placement's outer copper layer (`F.Cu` top, `B.Cu`
 * bottom; zone/keepout contract §13.4). Every consumer that needs "which side
 * is this part on" — SMD pad fallback, keepout `footprints` items, route
 * obstacles, live DRC, the canvas, the cloud snapshot — calls this instead of
 * re-deriving it from `placement.layer`.
 */
export function placementSideLayer(
  placement: Pick<PcbPlacedPart, "layer">,
): "F.Cu" | "B.Cu" {
  return placement.layer === "B.Cu" ? "B.Cu" : "F.Cu";
}
