import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type {
  PcbBoardCutout,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbViewSide,
} from "../../../../../sdks";
import {
  PCB_TRACE_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";
import {
  buildCopperFillPourShapes,
  resolveCopperFillClearanceMm,
} from "./copper-fill-geometry";

interface CopperFillLayerProps {
  layer: PcbCopperLayerId;
  outline: PcbBoardOutline;
  placements: ReadonlyArray<PcbPlacedPart>;
  /** Traces on this layer. Same-net traces merge into the pour silently. */
  traces: ReadonlyArray<PcbTrace>;
  /** Vias whose barrel crosses this layer. Same-net merge applies. */
  vias: ReadonlyArray<PcbVia>;
  /** Net id of the pour on this layer (e.g. `"GND"`); `null` disables merge. */
  pourNetId: string | null;
  /** `"<placementId>|<padNumber>"` → netId for same-net pad merge. */
  padNetIds: ReadonlyMap<string, string>;
  designRules: PcbDesignRules;
  /** Board cutouts + free holes/pads — subtracted (apertures) from the pour. */
  cutouts?: ReadonlyArray<PcbBoardCutout>;
  freeHoles?: ReadonlyArray<PcbFreeHole>;
  freePads?: ReadonlyArray<PcbFreePad>;
  opacity?: number;
  /** Side-flip indicator; reverses render order so bottom-view shows B over F. */
  viewSide?: PcbViewSide;
}

function copperFillRenderOrder(
  layer: PcbCopperLayerId,
  viewSide: PcbViewSide,
): number {
  // The pour must sit BELOW its layer's pads / traces / vias (which render at
  // the copper object slot) so it never paints over the objects whose clearance
  // defines it. Anchored at the object slot − 0.35. (A full migration to the
  // dedicated fill slot is deferred to the Phase 6 render-order cleanup, which
  // also bumps vias to the object slot.)
  const sourceLayer: PcbCopperLayerId =
    viewSide === "bottom"
      ? layer === "F.Cu"
        ? "B.Cu"
        : layer === "B.Cu"
          ? "F.Cu"
          : layer
      : layer;
  if (sourceLayer === "F.Cu") return RENDER_ORDER.PINS - 0.35;
  if (sourceLayer === "In1.Cu") return RENDER_ORDER.IN1_COPPER - 0.35;
  if (sourceLayer === "In2.Cu") return RENDER_ORDER.IN2_COPPER - 0.35;
  return RENDER_ORDER.B_COPPER - 0.35;
}

function blendedCopperFillColor(
  layer: PcbCopperLayerId,
  opacity: number,
  boardFill: string,
): string {
  const alpha = Math.max(0, Math.min(1, opacity));
  if (alpha >= 0.999) return PCB_TRACE_COLORS[layer];
  const color = new THREE.Color(boardFill);
  color.lerp(new THREE.Color(PCB_TRACE_COLORS[layer]), alpha);
  return `#${color.getHexString()}`;
}

/**
 * Copper pour for one layer, rendered as the actual positive copper islands
 * (smoothed, sliver-free, clearance-correct) produced by the shared pour kernel
 * — the same geometry the 3D board extrudes. Replaces the old fill-rect +
 * board-color-mask trick, which couldn't express rounded copper and hid lower
 * layers through its clearance gaps.
 */
export function CopperFillLayer({
  layer,
  outline,
  placements,
  traces,
  vias,
  pourNetId,
  padNetIds,
  designRules,
  cutouts,
  freeHoles,
  freePads,
  opacity = 0.95,
  viewSide = "top",
}: CopperFillLayerProps): ReactElement | null {
  const { theme } = useCanvasTheme();
  const shapes = useMemo(
    () =>
      buildCopperFillPourShapes({
        layer,
        outline,
        placements,
        traces,
        vias,
        pourNetId,
        padNetIds,
        clearanceMm: resolveCopperFillClearanceMm(designRules.clearance),
        copperToBoardEdgeMm: designRules.clearance.copperToBoardEdgeMm,
        cutouts,
        freeHoles,
        freePads,
        minThicknessMm: designRules.minimums.traceWidthMm,
      }),
    [
      layer,
      outline,
      placements,
      traces,
      vias,
      pourNetId,
      padNetIds,
      designRules,
      cutouts,
      freeHoles,
      freePads,
    ],
  );

  const geometry = useMemo(() => {
    if (shapes.length === 0) return null;
    const parts = shapes.map((shape) => new THREE.ShapeGeometry(shape));
    if (parts.length === 1) return parts[0]!;
    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    return merged;
  }, [shapes]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const renderOrder = copperFillRenderOrder(layer, viewSide);
  const fillColor = useMemo(
    () => blendedCopperFillColor(layer, opacity, theme.pcbCanvas.boardFill),
    [layer, opacity, theme.pcbCanvas.boardFill],
  );

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={renderOrder} frustumCulled={false}>
      <meshBasicMaterial
        color={fillColor}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        transparent
        opacity={1}
      />
    </mesh>
  );
}
