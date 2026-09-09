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
import type {
  PcbCopperLayerId,
  PcbFreePad,
  PcbPlacedPart,
} from "../../sdks/designer";
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
 * THE free-pad copper-layer model (SDK doc on `PcbFreePadType`): `hole` is an
 * NPTH and carries no copper at all; `std` is plated through and occupies every
 * copper layer of the stackup; `smd` / `conn` occupy exactly the one layer they
 * declare. Consumed by the copper records, the Gerber writer and the canvas
 * layer, so artwork, connectivity, the pour and DRC cannot disagree about which
 * layers a free pad's copper is on.
 *
 * `declaredLayerInvalid` means the declared layer is off this stackup (an inner
 * layer on a 2-layer board, or a non-copper id that reached persistence). The
 * layer is still reported — as itself when it is a copper id at all, else
 * `F.Cu` — so the consumer's own layer policy (clamp for DRC, fail-safe for
 * connectivity) decides what to do with it, exactly as before.
 */
export function freePadCopperLayers(
  pad: PcbFreePad,
  allCopperLayers: ReadonlySet<PcbCopperLayerId>,
): { layers: PcbCopperLayerId[]; declaredLayerInvalid: boolean } {
  if (pad.padType === "hole") return { layers: [], declaredLayerInvalid: false };
  if (pad.padType === "std") {
    return { layers: [...allCopperLayers], declaredLayerInvalid: false };
  }
  if (allCopperLayers.has(pad.layer)) {
    return { layers: [pad.layer], declaredLayerInvalid: false };
  }
  return {
    layers: [isCopperLayerId(pad.layer) ? pad.layer : "F.Cu"],
    declaredLayerInvalid: true,
  };
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
