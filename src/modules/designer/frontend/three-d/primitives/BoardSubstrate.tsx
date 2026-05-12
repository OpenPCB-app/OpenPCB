import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { DesignerPcbProjection } from "../../../../../sdks";
import {
  DEFAULT_BOARD_THICKNESS_MM,
  boardOutlineToShape,
  fallbackBoardBoundsFromProjection,
  shapeFromBounds,
} from "./geometry-utils";

const FR4_SOLDERMASK_COLOR = "rgb(28, 100, 42)";
const FR4_SOLDERMASK_EMISSIVE = "rgb(3, 12, 5)";

export function BoardSubstrate({
  projection,
  thicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  projection: DesignerPcbProjection;
  thicknessMm?: number;
}): ReactElement {
  const geometry = useMemo(() => {
    const outline = projection.board?.outline;
    const shape = outline
      ? boardOutlineToShape(outline)
      : shapeFromBounds(fallbackBoardBoundsFromProjection(projection));
    return new THREE.ExtrudeGeometry(shape, {
      depth: thicknessMm,
      bevelEnabled: false,
    });
  }, [projection, thicknessMm]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} position={[0, 0, -thicknessMm]} receiveShadow>
      <meshLambertMaterial
        color={FR4_SOLDERMASK_COLOR}
        emissive={FR4_SOLDERMASK_EMISSIVE}
      />
    </mesh>
  );
}
