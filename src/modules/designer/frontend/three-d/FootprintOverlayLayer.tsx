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
// Silkscreen / refdes sit just ABOVE the soldermask + copper traces (≈0.04mm)
// but just BELOW the exposed pad surface (`PAD_SURFACE_Z_MM` = 0.05mm in
// CopperPads). The pads render opaque and write depth, so placing silk beneath
// them lets the gold pad occlude any silk that overlaps it — matching real fab,
// where silkscreen is clipped out of soldermask openings — while silk between
// and around pads still shows. Avoids costly per-pad boolean clipping.
const FOOTPRINT_OVERLAY_Z_OFFSET_MM = 0.045;

// Pad copper is rendered by `CopperPads` (so through-hole pads can be annular
// and see-through). The shared layer can't hide pads via `hiddenLayers`, but
// `PadInstances` goes transparent when its opacity (= max of pad-layer
// opacities) drops below 1 — so force copper layers to 0 to suppress its pads
// while silkscreen / refdes labels (non-copper) stay fully opaque.
const COPPER_LAYERS_3D: ReadonlySet<string> = new Set([
  "F.Cu",
  "B.Cu",
  "In1.Cu",
  "In2.Cu",
]);
const hideCopperPadOpacity = (layer: string): number =>
  COPPER_LAYERS_3D.has(layer) ? 0 : 1;

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
        layerOpacity={hideCopperPadOpacity}
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
