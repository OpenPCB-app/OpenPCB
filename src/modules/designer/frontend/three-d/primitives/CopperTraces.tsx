import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PcbTrace } from "../../../../../sdks";
import {
  COPPER_RELIEF_HEIGHT_MM,
  DEFAULT_BOARD_THICKNESS_MM,
  buildTraceRibbonGeometry,
} from "./geometry-utils";
import { COPPER_FILL_GREEN, COPPER_FILL_ROUGHNESS } from "./materials";

/**
 * One merged copper ribbon mesh per layer. Each trace is stroked into an
 * extruded ribbon (box per segment + cylinder per join → rounded corners + real
 * thickness) and all ribbons on a layer merge into a single BufferGeometry → one
 * draw call + one shared matte material per layer. Coloured as soldermask-over-
 * copper green so traces read as raised fill ridges proud of the bare laminate.
 */
function LayerTraces({
  traces,
  zMm,
}: {
  traces: PcbTrace[];
  zMm: number;
}): ReactElement | null {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const trace of traces) {
      const ribbon = buildTraceRibbonGeometry(
        trace.pointsNm,
        trace.widthMm,
        COPPER_RELIEF_HEIGHT_MM,
      );
      if (ribbon) parts.push(ribbon);
    }
    if (parts.length === 0) return null;
    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    return merged;
  }, [traces]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, 0, zMm]} castShadow receiveShadow>
      <meshStandardMaterial
        color={COPPER_FILL_GREEN}
        metalness={0}
        roughness={COPPER_FILL_ROUGHNESS}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function CopperTraces({
  traces,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  traces: readonly PcbTrace[];
  boardThicknessMm?: number;
  copperThicknessMm?: number;
}): ReactElement | null {
  const { front, back } = useMemo(() => {
    const front: PcbTrace[] = [];
    const back: PcbTrace[] = [];
    for (const trace of traces) {
      (trace.layer === "F.Cu" ? front : back).push(trace);
    }
    return { front, back };
  }, [traces]);

  if (traces.length === 0) return null;

  // Geometry is centred on z=0; lift each layer so the ribbon sits on its face.
  const frontZ = COPPER_RELIEF_HEIGHT_MM / 2;
  const backZ = -boardThicknessMm - COPPER_RELIEF_HEIGHT_MM / 2;

  return (
    <group>
      <LayerTraces traces={front} zMm={frontZ} />
      <LayerTraces traces={back} zMm={backZ} />
    </group>
  );
}
