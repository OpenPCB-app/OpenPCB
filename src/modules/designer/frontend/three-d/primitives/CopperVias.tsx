import { useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbVia } from "../../../../../sdks";
import { DEFAULT_BOARD_THICKNESS_MM, viasToMeshInputs } from "./geometry-utils";

const VIA_COPPER_COLOR = "rgb(184, 115, 51)";
// Sit the barrel just inside the drilled board wall to avoid coplanar z-fight.
const BARREL_RADIUS_FACTOR = 0.97;

/**
 * Vias as see-through plated through-holes: a copper annular ring on each board
 * face plus an open-ended copper barrel lining the wall. The board is already
 * drilled at via positions (`BoardSubstrate`), so the open center reads through.
 */
export function CopperVias({
  vias,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  vias: readonly PcbVia[];
  boardThicknessMm?: number;
}): ReactElement | null {
  const inputs = useMemo(() => viasToMeshInputs(vias), [vias]);
  if (inputs.length === 0) return null;

  return (
    <group data-testid="designer-3d-copper-vias">
      {inputs.map((via) => {
        const outerR = via.diameterMm / 2;
        const drillR = Math.min(via.drillMm / 2, outerR * 0.85);
        const barrelR = drillR * BARREL_RADIUS_FACTOR;
        return (
          <group key={via.id} position={[via.centerMm.x, via.centerMm.y, 0]}>
            {/* Top + bottom annular copper rings */}
            <mesh position={[0, 0, 0]}>
              <ringGeometry args={[drillR, outerR, 32]} />
              <meshLambertMaterial
                color={VIA_COPPER_COLOR}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh position={[0, 0, -boardThicknessMm]}>
              <ringGeometry args={[drillR, outerR, 32]} />
              <meshLambertMaterial
                color={VIA_COPPER_COLOR}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Open-ended copper barrel lining the drilled wall */}
            <mesh
              position={[0, 0, -boardThicknessMm / 2]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry
                args={[barrelR, barrelR, boardThicknessMm, 24, 1, true]}
              />
              <meshLambertMaterial
                color={VIA_COPPER_COLOR}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
