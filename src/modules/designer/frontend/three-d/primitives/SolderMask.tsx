import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { DesignerPcbProjection } from "../../../../../sdks";
import {
  DEFAULT_BOARD_THICKNESS_MM,
  SOLDERMASK_Z_MM,
  boardSubstrateShape,
} from "./geometry-utils";
import {
  BOARD_EMISSIVE,
  SOLDERMASK_CLEARCOAT,
  SOLDERMASK_CLEARCOAT_ROUGHNESS,
  SOLDERMASK_ENV_INTENSITY,
  SOLDERMASK_GREEN,
  SOLDERMASK_OPACITY,
  SOLDERMASK_ROUGHNESS,
} from "./materials";

const MASK_CURVE_SEGMENTS = 24;

function MaskSheet({
  geometry,
  z,
  color,
  opacity,
}: {
  geometry: THREE.ShapeGeometry;
  z: number;
  color: string;
  opacity: number;
}): ReactElement {
  return (
    <mesh geometry={geometry} position={[0, 0, z]} receiveShadow>
      <meshPhysicalMaterial
        color={color}
        emissive={BOARD_EMISSIVE}
        roughness={SOLDERMASK_ROUGHNESS}
        metalness={0}
        clearcoat={SOLDERMASK_CLEARCOAT}
        clearcoatRoughness={SOLDERMASK_CLEARCOAT_ROUGHNESS}
        envMapIntensity={SOLDERMASK_ENV_INTENSITY}
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Translucent soldermask coating over both board faces. Shares the substrate
 * outline (with cutouts + drills already punched), so the satin green sits over
 * the FR4 core + copper. Copper traces underneath read as subtle relief; gold
 * pads render proud of this plane (see {@link SOLDERMASK_Z_MM}) so they stay
 * exposed. `color`/`opacity` are wired to the Board3D UI controls.
 */
export function SolderMask({
  projection,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
  color = SOLDERMASK_GREEN,
  opacity = SOLDERMASK_OPACITY,
}: {
  projection: DesignerPcbProjection;
  boardThicknessMm?: number;
  color?: string;
  opacity?: number;
}): ReactElement {
  const geometry = useMemo(
    () =>
      new THREE.ShapeGeometry(
        boardSubstrateShape(projection),
        MASK_CURVE_SEGMENTS,
      ),
    [projection],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <MaskSheet
        geometry={geometry}
        z={SOLDERMASK_Z_MM}
        color={color}
        opacity={opacity}
      />
      <MaskSheet
        geometry={geometry}
        z={-boardThicknessMm - SOLDERMASK_Z_MM}
        color={color}
        opacity={opacity}
      />
    </group>
  );
}
