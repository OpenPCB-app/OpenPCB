import { useMemo, type ReactElement } from "react";
import type { PcbVia } from "../../../../../sdks";
import {
  DEFAULT_BOARD_THICKNESS_MM,
  viasToMeshInputs,
} from "./geometry-utils";

const VIA_COPPER_COLOR = "rgb(184, 115, 51)";
const VIA_DRILL_COLOR = "rgb(8, 14, 10)";

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
    <group>
      {inputs.map((via) => {
        const radiusMm = via.diameterMm / 2;
        const drillRadiusMm = Math.min(via.drillMm / 2, radiusMm * 0.85);
        return (
          <group
            key={via.id}
            position={[via.centerMm.x, via.centerMm.y, -boardThicknessMm / 2]}
          >
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[radiusMm, radiusMm, boardThicknessMm, 32]} />
              <meshLambertMaterial color={VIA_COPPER_COLOR} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry
                args={[drillRadiusMm, drillRadiusMm, boardThicknessMm + 0.02, 24]}
              />
              <meshLambertMaterial color={VIA_DRILL_COLOR} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
