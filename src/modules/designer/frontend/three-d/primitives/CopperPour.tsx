import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { DesignerPcbProjection } from "../../../../../sdks";
import {
  buildCopperFillPourShapes,
  resolveCopperFillClearanceMm,
} from "../../pcb/layers/copper-fill-geometry";
import {
  COPPER_RELIEF_HEIGHT_MM,
  DEFAULT_BOARD_THICKNESS_MM,
} from "./geometry-utils";
import { COPPER_FILL_GREEN, COPPER_FILL_ROUGHNESS } from "./materials";

// The 3D board view fetches its own projection and has no access to the live
// pcb-view-store, so it can't know which net is poured. Default to no same-net
// merge (every copper object gets a clearance moat) — the common, safe look.
const POUR_NET_ID = null;
const EMPTY_PAD_NETS: ReadonlyMap<string, string> = new Map();

function PourLayer({
  shapes,
  zMm,
}: {
  shapes: THREE.Shape[];
  zMm: number;
}): ReactElement | null {
  const geometry = useMemo(() => {
    if (shapes.length === 0) return null;
    // Extrude the pour islands so the copper has real thickness (matching
    // traces); the edge wall at each clearance moat reads as the copper step.
    const parts = shapes.map(
      (shape) =>
        new THREE.ExtrudeGeometry(shape, {
          depth: COPPER_RELIEF_HEIGHT_MM,
          bevelEnabled: false,
        }),
    );
    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    return merged;
  }, [shapes]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;

  return (
    <mesh geometry={geometry} position={[0, 0, zMm]} receiveShadow castShadow>
      <meshStandardMaterial
        color={COPPER_FILL_GREEN}
        metalness={0}
        roughness={COPPER_FILL_ROUGHNESS}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Copper pour flooding the empty board area (the ground/power plane), mirroring
 * the 2D `CopperFillLayer`. Computed with the same net-aware clearance logic
 * (`buildCopperFillPourShapes`) so the 3D fill matches the 2D fill: copper up to
 * `copperToBoardEdge` from the edge, with clearance moats carved around traces,
 * pads and vias. Sits just under the translucent soldermask → reads as the
 * flooded green plane with subtle moats (see reference screenshots).
 */
export function CopperPour({
  projection,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
}: {
  projection: DesignerPcbProjection;
  boardThicknessMm?: number;
}): ReactElement | null {
  const designRules = projection.board?.designRules;

  const shapesByLayer = useMemo(() => {
    if (!designRules) return { front: [], back: [] };
    const common = {
      outline: projection.board.outline,
      placements: projection.placements,
      traces: projection.traces,
      vias: projection.vias,
      pourNetId: POUR_NET_ID,
      padNetIds: EMPTY_PAD_NETS,
      clearanceMm: resolveCopperFillClearanceMm(designRules.clearance),
      copperToBoardEdgeMm: designRules.clearance.copperToBoardEdgeMm,
    };
    return {
      front: buildCopperFillPourShapes({ ...common, layer: "F.Cu" }),
      back: buildCopperFillPourShapes({ ...common, layer: "B.Cu" }),
    };
  }, [
    designRules,
    projection.board,
    projection.placements,
    projection.traces,
    projection.vias,
  ]);

  if (!designRules) return null;

  // ExtrudeGeometry spans 0..height; place front on the top face (0..h) and back
  // just under the bottom face (-board-h..-board).
  const frontZ = 0;
  const backZ = -boardThicknessMm - COPPER_RELIEF_HEIGHT_MM;

  return (
    <group data-testid="designer-3d-copper-pour">
      <PourLayer shapes={shapesByLayer.front} zMm={frontZ} />
      <PourLayer shapes={shapesByLayer.back} zMm={backZ} />
    </group>
  );
}
