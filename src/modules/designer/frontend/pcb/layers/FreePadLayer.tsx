import { type ReactElement, useMemo } from "react";
import type { PcbCopperLayerId, PcbFreePad } from "../../../../../sdks";
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
  viewSide: "top" | "bottom";
  selectedFreePadIds?: ReadonlySet<string>;
  /** Per-layer opacity multiplier (slider / display-mode dim). */
  opacity?: number;
}

/**
 * Free standing pads (not part of any footprint). Routes through the
 * existing `PadInstances` primitive — same renderer the footprint pads use.
 * STD pads visually span F.Cu + B.Cu by passing through with their stored
 * `layer` field; v1 stores one row per pad so call sites filter per-layer.
 */
export function FreePadLayer({
  freePads,
  layer,
  viewSide,
  selectedFreePadIds,
  opacity = 1,
}: FreePadLayerProps): ReactElement | null {
  const pads = useMemo<PadData[]>(() => {
    const out: PadData[] = [];
    for (const pad of freePads) {
      // STD pads contribute copper on both F.Cu and B.Cu; everything else is
      // single-sided.
      const padOnLayer =
        pad.layer === layer ||
        (pad.padType === "std" && (layer === "F.Cu" || layer === "B.Cu"));
      if (!padOnLayer) continue;
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
        color: PCB_LAYER_COLORS[layer],
        selected: selectedFreePadIds?.has(pad.id) ?? false,
      });
    }
    return out;
  }, [freePads, layer, selectedFreePadIds]);

  if (pads.length === 0) return null;

  return (
    <PadInstances
      pads={pads}
      defaultColor={PCB_LAYER_COLORS[layer]}
      opacity={opacity}
      renderOrder={effectiveRenderOrder(layer, viewSide, "object")}
    />
  );
}
