import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbVia } from "../../../../../sdks";
import {
  COPPER_RELIEF_HEIGHT_MM,
  DEFAULT_BOARD_THICKNESS_MM,
  viasToMeshInputs,
} from "./geometry-utils";
import { COPPER_FILL_GREEN, COPPER_FILL_ROUGHNESS } from "./materials";

const RADIAL_SEGMENTS = 40; // smoothness of the revolved ring
const DISH_SEGMENTS = 10; // profile samples across the concave dent
// Dent floor as a fraction of the ring height — how deep the centre dimples.
const DENT_FLOOR_FACTOR = 0.2;

/**
 * Lathe profile (radius, height) for a via: a flat-topped copper annulus with a
 * smooth concave dent in the centre (the soldermask sagging over the tented
 * hole) — NOT an open hole. Revolved around the axis to form the via.
 */
function buildViaProfile(
  padR: number,
  dentR: number,
  ringTopZ: number,
): THREE.Vector2[] {
  const dentFloorZ = ringTopZ * DENT_FLOOR_FACTOR;
  const profile: THREE.Vector2[] = [];
  // Concave dish from the centre up to the inner rim.
  for (let i = 0; i <= DISH_SEGMENTS; i += 1) {
    const t = i / DISH_SEGMENTS;
    profile.push(
      new THREE.Vector2(
        dentR * t,
        dentFloorZ + (ringTopZ - dentFloorZ) * t * t,
      ),
    );
  }
  // Flat ring top out to the pad edge, then the outer wall down to the base.
  profile.push(new THREE.Vector2(padR, ringTopZ));
  profile.push(new THREE.Vector2(padR, 0));
  return profile;
}

interface ViaGeom {
  id: string;
  centerMm: { x: number; y: number };
  geometry: THREE.LatheGeometry;
}

/**
 * Vias rendered as a raised, copper-coloured (mask-over-copper green) **ring
 * with a concave dent** in the centre — matching the reference. The board/mask
 * are not drilled (tented), so the ring sits proud on the board and dimples in
 * the middle. Same shape on both faces.
 */
export function CopperVias({
  vias,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  vias: readonly PcbVia[];
  boardThicknessMm?: number;
  /** Accepted for API compatibility; via rings use the fixed copper-fill green. */
  maskColor?: string;
}): ReactElement | null {
  const inputs = useMemo(() => viasToMeshInputs(vias), [vias]);

  const geoms = useMemo<ViaGeom[]>(() => {
    return inputs.map((via) => {
      const padR = via.diameterMm / 2;
      const dentR = Math.min(via.drillMm / 2, padR * 0.72);
      const geometry = new THREE.LatheGeometry(
        buildViaProfile(padR, dentR, COPPER_RELIEF_HEIGHT_MM),
        RADIAL_SEGMENTS,
      );
      geometry.rotateX(Math.PI / 2); // lathe Y-axis → board-local +Z
      return { id: via.id, centerMm: via.centerMm, geometry };
    });
  }, [inputs]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: COPPER_FILL_GREEN,
        metalness: 0,
        roughness: COPPER_FILL_ROUGHNESS,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(
    () => () => {
      for (const g of geoms) g.geometry.dispose();
    },
    [geoms],
  );
  useEffect(() => () => material.dispose(), [material]);

  if (geoms.length === 0) return null;

  return (
    <group data-testid="designer-3d-copper-vias">
      {geoms.map((via) => (
        <group key={via.id}>
          {/* Top face: ring base on the board top (z=0), proud upward. */}
          <mesh
            geometry={via.geometry}
            material={material}
            position={[via.centerMm.x, via.centerMm.y, 0]}
            castShadow
            receiveShadow
          />
          {/* Bottom face: mirrored below the board. */}
          <mesh
            geometry={via.geometry}
            material={material}
            position={[via.centerMm.x, via.centerMm.y, -boardThicknessMm]}
            scale={[1, 1, -1]}
            castShadow
            receiveShadow
          />
        </group>
      ))}
    </group>
  );
}
