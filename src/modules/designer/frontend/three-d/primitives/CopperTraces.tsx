import { useMemo, type ReactElement } from "react";
import type { PcbTrace } from "../../../../../sdks";
import {
  DEFAULT_BOARD_THICKNESS_MM,
  DEFAULT_COPPER_THICKNESS_MM,
  traceToMeshInputs,
} from "./geometry-utils";

const FRONT_COPPER_COLOR = "rgb(184, 115, 51)";
const BACK_COPPER_COLOR = "rgb(132, 78, 39)";

export function CopperTraces({
  traces,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
  copperThicknessMm = DEFAULT_COPPER_THICKNESS_MM,
}: {
  traces: readonly PcbTrace[];
  boardThicknessMm?: number;
  copperThicknessMm?: number;
}): ReactElement | null {
  const segments = useMemo(
    () => traces.flatMap((trace) => traceToMeshInputs(trace)),
    [traces],
  );

  if (segments.length === 0) return null;

  return (
    <group>
      {segments.map((segment) => {
        if (segment.lengthMm <= 0) return null;
        const isFront = segment.layer === "F.Cu";
        const zMm = isFront
          ? copperThicknessMm / 2
          : -boardThicknessMm - copperThicknessMm / 2;
        return (
          <mesh
            key={segment.id}
            position={[segment.centerMm.x, segment.centerMm.y, zMm]}
            rotation={[0, 0, segment.angleRad]}
          >
            <boxGeometry
              args={[segment.lengthMm, segment.widthMm, copperThicknessMm]}
            />
            <meshLambertMaterial color={isFront ? FRONT_COPPER_COLOR : BACK_COPPER_COLOR} />
          </mesh>
        );
      })}
    </group>
  );
}
