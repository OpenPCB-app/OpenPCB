import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type {
  PcbBoardOutline,
  PcbPlacedPart,
  PcbViewSide,
} from "../../../../../sdks";
import { placementMirrorX } from "../../../../../sdks/designer/pcb-helpers";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
  effectiveRenderOrder,
} from "../../../../../shared/frontend/canvas/layers";
import {
  padAperturePath,
  pathAsShape,
  transformPath,
} from "../../../../../shared/frontend/canvas/scene/pad-aperture-geometry";

type Side = "top" | "bottom";

interface SolderMaskLayerProps {
  side: Side;
  placements: ReadonlyArray<PcbPlacedPart>;
  outline: PcbBoardOutline;
  /** IPC-7351 mask aperture expansion (mm, per side). Typ 0.075. */
  expansionMm: number;
  opacity?: number;
  /** Side-flip indicator. Drives renderOrder reversal (spec §5.2). */
  viewSide?: PcbViewSide;
}

/**
 * Solder mask render pass — a single translucent plane covering the board
 * with aperture cutouts (`THREE.Shape.holes`) at every pad on this side.
 * Pads expanded by `expansionMm` per IPC-7351 (typ 0.05–0.10 mm).
 *
 * One mesh per side. Pads on the other side (or on the wrong copper layer)
 * are ignored. Through-hole pads emit apertures on both sides.
 *
 * Black-mask convention (Apple/Pi/premium consumer-electronics look). The
 * mask renders at high opacity so the board reads as a solid black surface;
 * copper traces (rendered in the transparent pass with higher `renderOrder`)
 * remain fully readable on top.
 */
export function SolderMaskLayer({
  side,
  placements,
  outline,
  expansionMm,
  opacity = 0.7,
  viewSide = "top",
}: SolderMaskLayerProps): ReactElement | null {
  const geometry = useMemo(
    () => buildMaskGeometry(side, placements, outline, expansionMm),
    [side, placements, outline, expansionMm],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  const color = PCB_LAYER_COLORS[side === "top" ? "F.Mask" : "B.Mask"];
  const renderOrder = effectiveRenderOrder(
    side === "top" ? "F.Mask" : "B.Mask",
    viewSide,
    "object",
  );
  void RENDER_ORDER;
  return (
    <mesh
      geometry={geometry}
      position={[outline.centerMm.x, outline.centerMm.y, 0]}
      renderOrder={renderOrder}
    >
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function buildMaskGeometry(
  side: Side,
  placements: ReadonlyArray<PcbPlacedPart>,
  outline: PcbBoardOutline,
  expansionMm: number,
): THREE.ShapeGeometry | null {
  const hw = outline.widthMm / 2;
  const hh = outline.heightMm / 2;
  // Outer board polygon — Shape coordinates are relative to mesh position
  // (we offset the mesh to outline.centerMm).
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  let apertureCount = 0;
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    const placementMirrored = placementMirrorX(placement);
    for (const pad of pads) {
      if (!padOnSide(pad.layer, side, placementMirrored)) continue;
      const aperturePath = padAperturePath(pad, expansionMm);
      const worldPath = projectPadAperture(
        aperturePath,
        pad,
        placement,
        outline,
        placementMirrored,
      );
      shape.holes.push(pathAsShape(worldPath));
      apertureCount++;
    }
  }

  if (apertureCount === 0 && (outline.widthMm <= 0 || outline.heightMm <= 0)) {
    return null;
  }
  return new THREE.ShapeGeometry(shape);
}

/**
 * Pad layer assignment → side membership. Pads on `*.Cu` (all copper, e.g.
 * THT) appear on both sides; pads on F.* / B.* appear on the named side
 * unless the placement is mirrored (B.Cu placement), in which case sides
 * swap.
 */
function padOnSide(
  layer: string | undefined,
  side: Side,
  placementMirrored: boolean,
): boolean {
  const l = layer ?? "F.Cu";
  if (l.startsWith("*.")) return true;
  const onFront = l.startsWith("F.");
  const onBack = l.startsWith("B.");
  if (!onFront && !onBack) return false;
  const effectivelyFront = placementMirrored ? onBack : onFront;
  return side === "top" ? effectivelyFront : !effectivelyFront;
}

function projectPadAperture(
  localPath: THREE.Path,
  pad: { centerMm: { x: number; y: number }; rotationDeg: number },
  placement: PcbPlacedPart,
  outline: PcbBoardOutline,
  placementMirrored: boolean,
): THREE.Path {
  // Local pad-frame path → pad rotation → world translation. Then translate
  // into Shape-local frame (offset by board center, since the mesh is
  // positioned at outline.centerMm).
  const padCenter = padWorldCenter(pad, placement, placementMirrored);
  const padRotation =
    pad.rotationDeg +
    (placement.rotationDeg ?? 0) * (placementMirrored ? -1 : 1);
  return transformPath(
    localPath,
    padRotation,
    padCenter.x - outline.centerMm.x,
    padCenter.y - outline.centerMm.y,
    false,
  );
}

function padWorldCenter(
  pad: { centerMm: { x: number; y: number } },
  placement: PcbPlacedPart,
  mirrored: boolean,
): { x: number; y: number } {
  const rotation =
    (((Math.round(placement.rotationDeg / 90) * 90) % 360) + 360) % 360;
  const mx = mirrored ? -pad.centerMm.x : pad.centerMm.x;
  const my = pad.centerMm.y;
  let dx: number;
  let dy: number;
  switch (rotation) {
    case 90:
      dx = -my;
      dy = mx;
      break;
    case 180:
      dx = -mx;
      dy = -my;
      break;
    case 270:
      dx = my;
      dy = -mx;
      break;
    default:
      dx = mx;
      dy = my;
  }
  return {
    x: placement.positionMm.x + dx,
    y: placement.positionMm.y + dy,
  };
}
