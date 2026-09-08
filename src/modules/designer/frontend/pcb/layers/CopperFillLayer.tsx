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
  PcbLayerCount,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbViewSide,
} from "../../../../../sdks";
import type { ZonePourParams } from "../../../../../shared/pcb-areas/pour-params";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { copperLayerColor } from "../pcb-layer-colors";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";
import { buildCopperFillIslands } from "./copper-fill-geometry";
import { islandsToShapes } from "../../../../../shared/rendering/copper-fill/copper-fill-shapes";

/**
 * One effective copper zone (board plane or explicit polygon) plus the
 * board-wide obstacles it pours around. The zone-derived half — layer, net,
 * clearance, minimum width, pad connection, thermal / island overrides and the
 * clip polygon — is `ZonePourParams`, produced by `pourParamsForZone` so the
 * canvas, Gerber, DRC and the 3D preview compose overrides identically
 * (zone/keepout contract §6).
 */
interface CopperFillLayerProps extends ZonePourParams {
  outline: PcbBoardOutline;
  /** The board's real stackup size — the record layer policy depends on it. */
  layerCount: PcbLayerCount;
  placements: ReadonlyArray<PcbPlacedPart>;
  /** Traces on this layer. Same-net traces merge into the pour silently. */
  traces: ReadonlyArray<PcbTrace>;
  /** Vias whose barrel crosses this layer. Same-net merge applies. */
  vias: ReadonlyArray<PcbVia>;
  /** `"<placementId>|<padNumber>"` → netId for same-net pad merge. */
  padNetIds: ReadonlyMap<string, string>;
  /** Board rules — only `copperToBoardEdgeMm` is read; the rest is composed. */
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
  layerCount,
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
  clearanceMm,
  clearanceForItem,
  minThicknessMm,
  padConnection,
  islandRemoval,
  thermalReliefGapMm,
  thermalSpokeWidthMm,
  clipPolygonMm,
  clipHolesMm,
  excludeZonesMm,
  excludePolygonsMm,
  opacity = 0.95,
  viewSide = "top",
}: CopperFillLayerProps): ReactElement | null {
  const { theme } = useCanvasTheme();
  // A `failed` pour draws nothing (contract §8) — the canvas must never show
  // copper the kernel could not clear.
  const shapes = useMemo(
    () =>
      islandsToShapes(
        buildCopperFillIslands({
          layer,
          layerCount,
          outline,
          placements,
          traces,
          vias,
          pourNetId,
          padNetIds,
          clearanceMm,
          clearanceForItem,
          copperToBoardEdgeMm: designRules.clearance.copperToBoardEdgeMm,
          cutouts,
          freeHoles,
          freePads,
          minThicknessMm,
          padConnection,
          ...(islandRemoval === undefined ? {} : { islandRemoval }),
          ...(thermalReliefGapMm === undefined ? {} : { thermalReliefGapMm }),
          ...(thermalSpokeWidthMm === undefined ? {} : { thermalSpokeWidthMm }),
          ...(clipPolygonMm ? { clipPolygonMm } : {}),
          ...(clipHolesMm ? { clipHolesMm } : {}),
          ...(excludeZonesMm ? { excludeZonesMm } : {}),
          ...(excludePolygonsMm ? { excludePolygonsMm } : {}),
        }).islands,
      ),
    [
      layer,
      layerCount,
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
      clearanceMm,
      clearanceForItem,
      minThicknessMm,
      padConnection,
      islandRemoval,
      thermalReliefGapMm,
      thermalSpokeWidthMm,
      clipPolygonMm,
      clipHolesMm,
      excludeZonesMm,
      excludePolygonsMm,
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
