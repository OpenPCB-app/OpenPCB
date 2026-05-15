import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbPlacedPart, PcbViewSide } from "../../../../../sdks";
import { placementMirrorX } from "../../../../../sdks/designer/pcb-helpers";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
  effectiveRenderOrder,
} from "../../../../../shared/frontend/canvas/layers";
import { padAperturePath } from "../../../../../shared/frontend/canvas/scene/pad-aperture-geometry";

type Side = "top" | "bottom";

interface SolderPasteLayerProps {
  side: Side;
  placements: ReadonlyArray<PcbPlacedPart>;
  /** Aperture inset (mm, per side). Typ negative (e.g. -0.05) so paste
   *  stencil is slightly smaller than the copper pad. */
  expansionMm: number;
  opacity?: number;
  /** Side-flip indicator. Drives renderOrder reversal (spec §5.2). */
  viewSide?: PcbViewSide;
}

interface PasteAperture {
  pathPoints: Float32Array;
  worldX: number;
  worldY: number;
  rotationDeg: number;
}

/**
 * Solder paste render pass — SMD pads only, drawn as ShapeGeometry slightly
 * inset from the pad outline. Through-hole pads (those carrying a drill)
 * are skipped because paste stencils never deposit into PTH apertures.
 */
export function SolderPasteLayer({
  side,
  placements,
  expansionMm,
  opacity = 0.85,
  viewSide = "top",
}: SolderPasteLayerProps): ReactElement | null {
  const apertures = useMemo(
    () => collectApertures(side, placements, expansionMm),
    [side, placements, expansionMm],
  );

  const geometries = useMemo(() => buildGeometries(apertures), [apertures]);

  useEffect(
    () => () => {
      for (const g of geometries) g.geometry.dispose();
    },
    [geometries],
  );

  if (geometries.length === 0) return null;
  const color = PCB_LAYER_COLORS[side === "top" ? "F.Paste" : "B.Paste"];
  const renderOrder = effectiveRenderOrder(
    side === "top" ? "F.Paste" : "B.Paste",
    viewSide,
    "object",
  );
  void RENDER_ORDER;
  return (
    <group renderOrder={renderOrder}>
      {geometries.map((g, i) => (
        <mesh
          key={i}
          geometry={g.geometry}
          position={[g.worldX, g.worldY, 0]}
          rotation={[0, 0, (g.rotationDeg * Math.PI) / 180]}
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
      ))}
    </group>
  );
}

function collectApertures(
  side: Side,
  placements: ReadonlyArray<PcbPlacedPart>,
  expansionMm: number,
): PasteAperture[] {
  const out: PasteAperture[] = [];
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    const mirrored = placementMirrorX(placement);
    for (const pad of pads) {
      // Skip THT pads — drillDiameterMm presence indicates a hole.
      if (pad.drillDiameterMm && pad.drillDiameterMm > 0) continue;
      if (!padOnSide(pad.layer, side, mirrored)) continue;
      const localPath = padAperturePath(pad, expansionMm);
      const points = localPath.getPoints(0);
      if (points.length < 3) continue;
      const flat = new Float32Array(points.length * 2);
      for (let i = 0; i < points.length; i++) {
        flat[i * 2] = points[i]!.x;
        flat[i * 2 + 1] = points[i]!.y;
      }
      const padCenter = padWorldCenter(pad, placement, mirrored);
      out.push({
        pathPoints: flat,
        worldX: padCenter.x,
        worldY: padCenter.y,
        rotationDeg:
          pad.rotationDeg + (placement.rotationDeg ?? 0) * (mirrored ? -1 : 1),
      });
    }
  }
  return out;
}

function buildGeometries(apertures: ReadonlyArray<PasteAperture>): Array<{
  geometry: THREE.ShapeGeometry;
  worldX: number;
  worldY: number;
  rotationDeg: number;
}> {
  const out: Array<{
    geometry: THREE.ShapeGeometry;
    worldX: number;
    worldY: number;
    rotationDeg: number;
  }> = [];
  for (const a of apertures) {
    const shape = new THREE.Shape();
    shape.moveTo(a.pathPoints[0]!, a.pathPoints[1]!);
    for (let i = 2; i < a.pathPoints.length; i += 2) {
      shape.lineTo(a.pathPoints[i]!, a.pathPoints[i + 1]!);
    }
    shape.closePath();
    out.push({
      geometry: new THREE.ShapeGeometry(shape),
      worldX: a.worldX,
      worldY: a.worldY,
      rotationDeg: a.rotationDeg,
    });
  }
  return out;
}

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
