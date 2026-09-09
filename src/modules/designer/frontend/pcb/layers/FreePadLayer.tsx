import { type ReactElement, useMemo } from "react";
import { copperLayerColor } from "../pcb-layer-colors";
import type {
  PcbCopperLayerId,
  PcbFreePad,
  PcbLayerCount,
} from "../../../../../sdks";
import { copperLayersForCount } from "../../../../../sdks";
import { freePadCopperLayers } from "../../../../../shared/rendering/pad-copper-layers";
import {
  PCB_LAYER_COLORS,
  effectiveRenderOrder,
} from "../../../../../shared/frontend/canvas/layers";
import {
  PadInstances,
  type PadData,
} from "../../../../../shared/frontend/canvas/primitives/PadInstances";

interface FreePadLayerProps {
  freePads: ReadonlyArray<PcbFreePad>;
  /** Restrict rendering to pads on this layer. */
  layer: PcbCopperLayerId;
  /** Stackup size — the layer set a `std` pad's copper spans. */
  layerCount: PcbLayerCount;
  viewSide: "top" | "bottom";
  selectedFreePadIds?: ReadonlySet<string>;
  /** Per-layer opacity multiplier (slider / display-mode dim). */
  opacity?: number;
}

/**
 * Free standing pads (not part of any footprint). Routes through the
 * existing `PadInstances` primitive — same renderer the footprint pads use.
 * Which layers a pad's copper occupies comes from the ONE free-pad layer model
 * (`freePadCopperLayers`), so the canvas draws exactly the copper DRC, the
 * pour and the Gerber writer see; v1 stores one row per pad, so call sites
 * still filter per-layer.
 */
export function FreePadLayer({
  freePads,
  layer,
  layerCount,
  viewSide,
  selectedFreePadIds,
  opacity = 1,
}: FreePadLayerProps): ReactElement | null {
  const validCopperLayers = useMemo(
    () => new Set<PcbCopperLayerId>(copperLayersForCount(layerCount)),
    [layerCount],
  );
  const pads = useMemo<PadData[]>(() => {
    const out: PadData[] = [];
    for (const pad of freePads) {
      if (!freePadCopperLayers(pad, validCopperLayers).layers.includes(layer)) {
        continue;
      }
      out.push({
        id: pad.id,
        x: pad.centerMm.x,
        y: pad.centerMm.y,
        width: pad.widthMm,
        height: pad.heightMm,
        rotation: (pad.rotationDeg * Math.PI) / 180,
        shape: pad.shape,
        ...(pad.roundrectRatio !== undefined
          ? { roundrectRatio: pad.roundrectRatio }
          : {}),
        color: copperLayerColor(layer),
        selected: selectedFreePadIds?.has(pad.id) ?? false,
      });
    }
    return out;
  }, [freePads, layer, selectedFreePadIds, validCopperLayers]);

  if (pads.length === 0) return null;

  return (
    <PadInstances
      pads={pads}
      defaultColor={copperLayerColor(layer)}
      opacity={opacity}
      renderOrder={effectiveRenderOrder(
        layer as Parameters<typeof effectiveRenderOrder>[0], viewSide, "object")}
    />
  );
}
