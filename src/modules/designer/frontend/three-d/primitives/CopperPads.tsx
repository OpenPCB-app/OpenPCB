import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbPlacedPart } from "../../../../../sdks";
import type { FootprintRenderSourcePad } from "../../../../../shared/rendering";
import { getPlacementTransformProps } from "../transform-helpers";
import { DEFAULT_BOARD_THICKNESS_MM } from "./geometry-utils";
import {
  ENIG_ENV_INTENSITY,
  ENIG_GOLD_COLOR,
  ENIG_METALNESS,
  ENIG_ROUGHNESS,
} from "./materials";

// Lift the copper face just off the board so it doesn't z-fight the substrate.
const PAD_SURFACE_Z_MM = 0.05;
const SHAPE_CURVE_SEGMENTS = 24;

function roundedRectPath(
  s: THREE.Shape | THREE.Path,
  hw: number,
  hh: number,
  r: number,
): void {
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  s.closePath();
}

/**
 * Pad copper outline (centered at origin, local pad space). Through-hole pads
 * (`drillDiameterMm > 0`) get a circular hole punched so the face copper is an
 * annular ring and the drilled board cutout + barrel show through.
 */
function buildPadShape(pad: FootprintRenderSourcePad): THREE.Shape {
  const hw = pad.widthMm / 2;
  const hh = pad.heightMm / 2;
  const shape = new THREE.Shape();
  switch (pad.shape) {
    case "circle":
    case "oval":
      shape.absellipse(0, 0, hw, hh, 0, Math.PI * 2, false, 0);
      break;
    case "roundrect": {
      const ratio = pad.roundrectRatio ?? 0.25;
      const r = Math.min(Math.min(hw, hh), ratio * 2 * Math.min(hw, hh));
      roundedRectPath(shape, hw, hh, r);
      break;
    }
    default:
      shape.moveTo(-hw, -hh);
      shape.lineTo(hw, -hh);
      shape.lineTo(hw, hh);
      shape.lineTo(-hw, hh);
      shape.closePath();
  }
  const drill = pad.drillDiameterMm ?? 0;
  if (drill > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, drill / 2, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return shape;
}

function isThruHole(pad: FootprintRenderSourcePad): boolean {
  return (pad.drillDiameterMm ?? 0) > 0;
}

function PadFace({ pad }: { pad: FootprintRenderSourcePad }): ReactElement {
  const geometry = useMemo(
    () => new THREE.ShapeGeometry(buildPadShape(pad), SHAPE_CURVE_SEGMENTS),
    [pad],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={[pad.centerMm.x, pad.centerMm.y, 0]}
      rotation={[0, 0, (pad.rotationDeg * Math.PI) / 180]}
      receiveShadow
    >
      <meshStandardMaterial
        color={ENIG_GOLD_COLOR}
        metalness={ENIG_METALNESS}
        roughness={ENIG_ROUGHNESS}
        envMapIntensity={ENIG_ENV_INTENSITY}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Pad copper for one placement. SMD pads sit on the placement's own face;
 * through-hole pads get an annular ring on **both** board faces (the hole is
 * plated through), matching KiCad's two-sided pads.
 */
function PlacementPads({
  placement,
  boardThicknessMm,
}: {
  placement: PcbPlacedPart;
  boardThicknessMm: number;
}): ReactElement | null {
  const pads = placement.footprint.preview?.pads ?? [];
  if (pads.length === 0) return null;

  const transform = getPlacementTransformProps(placement, boardThicknessMm);
  const [tx, ty] = transform.position;
  const topZ = PAD_SURFACE_Z_MM;
  const bottomZ = -boardThicknessMm - PAD_SURFACE_Z_MM;
  const isBack = placement.layer === "B.Cu";
  // Primary face carries every pad (SMD + THT); the opposite face carries only
  // the THT pads (plated through to the other side).
  const primaryZ = isBack ? bottomZ : topZ;
  const oppositeZ = isBack ? topZ : bottomZ;
  const thtPads = pads.filter(isThruHole);

  return (
    <>
      <group
        position={[tx, ty, primaryZ]}
        rotation={transform.rotation}
        scale={transform.scale}
      >
        {pads.map((pad) => (
          <PadFace key={pad.id} pad={pad} />
        ))}
      </group>
      {thtPads.length > 0 ? (
        <group
          position={[tx, ty, oppositeZ]}
          rotation={transform.rotation}
          scale={transform.scale}
        >
          {thtPads.map((pad) => (
            <PadFace key={pad.id} pad={pad} />
          ))}
        </group>
      ) : null}
    </>
  );
}

/**
 * Footprint pad copper for the 3D viewer. SMD pads are solid; through-hole pads
 * are annular (open center) on both board faces so the drilled cutout + copper
 * barrel show through. Replaces the shared `FootprintRenderLayer` pad copper,
 * which is suppressed in `FootprintOverlayLayer` via `layerOpacity`.
 */
export function CopperPads({
  placements,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  placements: readonly PcbPlacedPart[];
  boardThicknessMm?: number;
}): ReactElement | null {
  if (placements.length === 0) return null;
  return (
    <group data-testid="designer-3d-copper-pads">
      {placements.map((placement) => (
        <PlacementPads
          key={placement.id}
          placement={placement}
          boardThicknessMm={boardThicknessMm}
        />
      ))}
    </group>
  );
}
