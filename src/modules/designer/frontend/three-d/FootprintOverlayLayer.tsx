import { type ReactElement } from "react";
import type { PcbPlacedPart } from "../../../../sdks";
import { FootprintRenderLayer } from "../../../../shared/frontend/canvas/scene";
import { getPlacementTransformProps } from "./transform-helpers";

const PCB_HIDDEN_LAYERS: ReadonlySet<string> = new Set([
  "F.Fab",
  "B.Fab",
  "F.Fabrication",
  "B.Fabrication",
]);
const FOOTPRINT_OVERLAY_Z_OFFSET_MM = 0.06;

function FootprintOverlay({
  placement,
  boardThicknessMm,
}: {
  placement: PcbPlacedPart;
  boardThicknessMm: number;
}): ReactElement | null {
  const model = placement.footprint.preview;
  if (!model) return null;

  const transform = getPlacementTransformProps(placement, boardThicknessMm);
  const zOffset =
    placement.layer === "B.Cu"
      ? -FOOTPRINT_OVERLAY_Z_OFFSET_MM
      : FOOTPRINT_OVERLAY_Z_OFFSET_MM;

  return (
    <group
      data-testid="designer-3d-footprint-overlay"
      position={[
        transform.position[0],
        transform.position[1],
        transform.position[2] + zOffset,
      ]}
      rotation={transform.rotation}
      scale={transform.scale}
    >
      <FootprintRenderLayer
        model={model}
        useLayerColors
        surface="pcb"
        hiddenLayers={PCB_HIDDEN_LAYERS}
        placeholderSubstitutions={{ reference: placement.reference }}
        enableDepthTest
        hidePadNumbers
      />
    </group>
  );
}

export function FootprintOverlayLayer({
  placements,
  boardThicknessMm,
}: {
  placements: readonly PcbPlacedPart[];
  boardThicknessMm: number;
}): ReactElement | null {
  if (placements.length === 0) return null;

  return (
    <group data-testid="designer-3d-footprint-overlay-layer">
      {placements.map((placement) => (
        <FootprintOverlay
          key={placement.id}
          placement={placement}
          boardThicknessMm={boardThicknessMm}
        />
      ))}
    </group>
  );
}
