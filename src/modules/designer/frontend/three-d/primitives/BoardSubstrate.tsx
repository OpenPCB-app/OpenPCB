import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { DesignerPcbProjection } from "../../../../../sdks";
import {
  DEFAULT_BOARD_THICKNESS_MM,
  boardSubstrateShape,
} from "./geometry-utils";
import {
  BOARD_EMISSIVE,
  FR4_CORE_COLOR,
  FR4_CORE_ROUGHNESS,
  SOLDERMASK_GREEN,
} from "./materials";

export function BoardSubstrate({
  projection,
  thicknessMm = DEFAULT_BOARD_THICKNESS_MM,
  faceColor = SOLDERMASK_GREEN,
}: {
  projection: DesignerPcbProjection;
  thicknessMm?: number;
  faceColor?: string;
}): ReactElement {
  const geometry = useMemo(
    () =>
      new THREE.ExtrudeGeometry(boardSubstrateShape(projection), {
        depth: thicknessMm,
        bevelEnabled: false,
      }),
    [projection, thicknessMm],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      position={[0, 0, -thicknessMm]}
      receiveShadow
      castShadow
    >
      {/* ExtrudeGeometry emits two material groups: 0 = top/bottom caps,
          1 = side walls. Caps = opaque green base (so the tan core never bleeds
          through the translucent mask); walls = exposed FR4 tan core on the edge. */}
      <meshStandardMaterial
        attach="material-0"
        color={faceColor}
        emissive={BOARD_EMISSIVE}
        roughness={0.92}
        metalness={0}
        side={THREE.DoubleSide}
      />
      <meshStandardMaterial
        attach="material-1"
        color={FR4_CORE_COLOR}
        roughness={FR4_CORE_ROUGHNESS}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
