import { useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { DesignerPcbProjection } from "../../../../../sdks";
import { collectDrills } from "../../pcb/pcb-drills";
import { DEFAULT_BOARD_THICKNESS_MM } from "./geometry-utils";
import { COPPER_COLOR, COPPER_METALNESS, COPPER_ROUGHNESS } from "./materials";

// Sit the barrel just inside the drilled board wall to avoid coplanar z-fight.
const BARREL_RADIUS_FACTOR = 0.97;
// Extend the barrel slightly past both faces so it meets the annular pad copper
// (which sits ~0.05 mm above each face) with no visible gap.
const BARREL_OVERHANG_MM = 0.05;

/**
 * Copper barrels lining the wall of every **plated** through-hole — component
 * pad drills and plated free pads (`padType === "std"`). Open-ended cylinders,
 * so the hole center stays see-through to the real board cutout. Vias own their
 * barrel in `CopperVias`; free/mounting holes (NPTH) get none (open hole).
 */
export function CopperBarrels({
  projection,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  projection: DesignerPcbProjection;
  boardThicknessMm?: number;
}): ReactElement | null {
  const drills = useMemo(() => {
    const platedFreePads = projection.freePads.filter(
      (pad) => pad.padType === "std",
    );
    return collectDrills([], projection.placements, [], platedFreePads);
  }, [projection.placements, projection.freePads]);

  if (drills.length === 0) return null;

  return (
    <group data-testid="designer-3d-copper-barrels">
      {drills.map((drill, i) => {
        const r = drill.radiusMm * BARREL_RADIUS_FACTOR;
        return (
          <mesh
            key={i}
            position={[
              drill.centerMm.x,
              drill.centerMm.y,
              -boardThicknessMm / 2,
            ]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry
              args={[
                r,
                r,
                boardThicknessMm + BARREL_OVERHANG_MM * 2,
                24,
                1,
                true,
              ]}
            />
            <meshStandardMaterial
              color={COPPER_COLOR}
              metalness={COPPER_METALNESS}
              roughness={COPPER_ROUGHNESS}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}
