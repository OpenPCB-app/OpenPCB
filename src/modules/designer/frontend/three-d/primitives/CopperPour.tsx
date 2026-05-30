import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type {
  DesignerPcbProjection,
  PcbCopperLayerId,
} from "../../../../../sdks";
import {
  buildCopperFillPourShapes,
  resolveCopperFillClearanceMm,
} from "../../pcb/layers/copper-fill-geometry";
import { buildPadNetIds } from "../../pcb/pcb-pad-nets";
import {
  COPPER_RELIEF_HEIGHT_MM,
  DEFAULT_BOARD_THICKNESS_MM,
} from "./geometry-utils";
import { COPPER_FILL_GREEN, COPPER_FILL_ROUGHNESS } from "./materials";

function PourLayer({
  shapes,
  zMm,
  fillColor,
}: {
  shapes: THREE.Shape[];
  zMm: number;
  fillColor: string;
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
        color={fillColor}
        metalness={0}
        roughness={COPPER_FILL_ROUGHNESS}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Copper pour flooding the empty board area (the ground/power plane), mirroring
 * the 2D `CopperFillLayer` via the shared `buildCopperFillPourShapes`. Net-aware
 * off the projection's persisted view state: the poured net per layer
 * (`board.viewState.copperFillPourNetIds`) drives same-net merge, and the same
 * `buildPadNetIds` mapping the 2D scene uses resolves pad nets — so a same-net
 * plane reads as merged copper (no moat) here exactly as in 2D. Refreshes on
 * commit (the projection is re-fetched then). Sits just under the translucent
 * soldermask → flooded green plane with subtle moats around different-net copper.
 */
export function CopperPour({
  projection,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
  fillColor = COPPER_FILL_GREEN,
}: {
  projection: DesignerPcbProjection;
  boardThicknessMm?: number;
  fillColor?: string;
}): ReactElement | null {
  const designRules = projection.board?.designRules;

  const shapesByLayer = useMemo(() => {
    if (!designRules) return { front: [], back: [] };
    // The 3D model is a realistic board preview: always flood the pour on both
    // copper faces, independent of the 2D canvas's `copperFillLayers` visibility
    // toggle (an editor-only concern). The per-layer poured net still drives
    // same-net merge below.
    const viewState = projection.board.viewState;
    const pourNetIds = viewState?.copperFillPourNetIds ?? {};
    const padNetIds = buildPadNetIds(
      projection.ratsnest,
      projection.placements,
      projection.traces,
    );
    const common = {
      outline: projection.board.outline,
      placements: projection.placements,
      traces: projection.traces,
      vias: projection.vias,
      padNetIds,
      clearanceMm: resolveCopperFillClearanceMm(designRules.clearance),
      copperToBoardEdgeMm: designRules.clearance.copperToBoardEdgeMm,
      cutouts: projection.board.cutouts,
      freeHoles: projection.freeHoles,
      freePads: projection.freePads,
    };
    const forLayer = (layer: PcbCopperLayerId): THREE.Shape[] =>
      buildCopperFillPourShapes({
        ...common,
        layer,
        pourNetId: pourNetIds[layer] ?? null,
      });
    return { front: forLayer("F.Cu"), back: forLayer("B.Cu") };
  }, [
    designRules,
    projection.board,
    projection.ratsnest,
    projection.placements,
    projection.traces,
    projection.vias,
    projection.freeHoles,
    projection.freePads,
  ]);

  if (!designRules) return null;

  // ExtrudeGeometry spans 0..height; place front on the top face (0..h) and back
  // just under the bottom face (-board-h..-board).
  const frontZ = 0;
  const backZ = -boardThicknessMm - COPPER_RELIEF_HEIGHT_MM;

  return (
    <group data-testid="designer-3d-copper-pour">
      <PourLayer
        shapes={shapesByLayer.front}
        zMm={frontZ}
        fillColor={fillColor}
      />
      <PourLayer
        shapes={shapesByLayer.back}
        zMm={backZ}
        fillColor={fillColor}
      />
    </group>
  );
}
