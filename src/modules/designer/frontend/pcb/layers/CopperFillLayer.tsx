import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PcbCopperLayerId, PcbViewSide } from "../../../../../sdks";
import type { CopperFillIsland } from "../../../../../shared/rendering/copper-fill/copper-fill-geometry";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { copperLayerColor } from "../pcb-layer-colors";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";
import { islandsToShapes } from "../../../../../shared/rendering/copper-fill/copper-fill-shapes";

/**
 * One effective copper zone's poured islands. RENDER-ONLY (OPENPCB-67 §3.8):
 * the islands are the `buildProjectionPours` result `useProjectionPours`
 * computed for the scene — the same copper Gerber and DRC read — so this layer
 * never runs the pour kernel and cannot pour against a different board.
 */
interface CopperFillLayerProps {
  layer: PcbCopperLayerId;
  /** Empty for a `failed` pour: the canvas never draws uncleared copper (§8). */
  islands: ReadonlyArray<CopperFillIsland>;
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
  if (alpha >= 0.999) return copperLayerColor(layer);
  const color = new THREE.Color(boardFill);
  color.lerp(new THREE.Color(copperLayerColor(layer)), alpha);
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
  islands,
  opacity = 0.95,
  viewSide = "top",
}: CopperFillLayerProps): ReactElement | null {
  const { theme } = useCanvasTheme();
  const shapes = useMemo(() => islandsToShapes(islands), [islands]);

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
