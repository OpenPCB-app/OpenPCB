import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { DesignerPcbProjection } from "../../../../../sdks";
import { copperToHoleClearanceMm } from "../../../../../shared/drc/rule-resolver";
import {
  collectCopperZones,
  collectKeepouts,
} from "../../../../../shared/pcb-areas/copper-zones";
import {
  pourParamsForZone,
  zonePourNets,
} from "../../../../../shared/pcb-areas/pour-params";
import { buildCopperFillIslands } from "../../pcb/layers/copper-fill-geometry";
import { islandsToShapes } from "../../../../../shared/rendering/copper-fill/copper-fill-shapes";
import {
  COPPER_RELIEF_HEIGHT_MM,
  DEFAULT_BOARD_THICKNESS_MM,
} from "./geometry-utils";
import { COPPER_FILL_GREEN, COPPER_FILL_ROUGHNESS } from "./materials";

/** One effective copper zone's poured islands on a visible board face. */
interface FacePour {
  id: string;
  shapes: THREE.Shape[];
}

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
 * Copper pour on the two outer faces, mirroring the 2D `CopperFillLayer` via
 * the shared `buildCopperFillIslands` + `islandsToShapes`. Which copper areas exist comes from
 * `collectCopperZones` — the one derivation the canvas, DRC, the snapshot and
 * Gerber also read (zone/keepout contract §3.1 / §7) — so the preview shows
 * exactly the copper that would be manufactured: a board plane only where the
 * layer carries a board zone row, plus every explicit zone clipped to its
 * polygon. The zones are the projection's, not a store slice: 3D is a preview
 * of the committed design, not the live-edit surface, and it refreshes when the
 * projection is re-fetched on commit.
 * Sits just under the translucent soldermask → flooded green plane with subtle
 * moats around different-net copper.
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

  const poursByFace = useMemo(() => {
    const empty: { front: FacePour[]; back: FacePour[] } = {
      front: [],
      back: [],
    };
    if (!designRules) return empty;
    // The authoritative schematic pad→net map, written on every projection load.
    const padNetIds = new Map(Object.entries(projection.padNets ?? {}));
    const common = {
      layerCount: projection.board.layerCount,
      outline: projection.board.outline,
      placements: projection.placements,
      traces: projection.traces,
      vias: projection.vias,
      padNetIds,
      copperToBoardEdgeMm: designRules.clearance.copperToBoardEdgeMm,
      copperToHoleMm: copperToHoleClearanceMm(designRules),
      cutouts: projection.board.cutouts,
      freeHoles: projection.freeHoles,
      freePads: projection.freePads,
    };
    const { zones } = collectCopperZones({
      zones: projection.zones,
      layerCount: projection.board.layerCount,
      knownNetIds: new Set(Object.keys(projection.netNames ?? {})),
    });
    const { keepouts } = collectKeepouts({
      keepouts: projection.keepouts ?? [],
      layerCount: projection.board.layerCount,
    });
    // One rule resolver per projection (rule-semantics contract §9) — building
    // it per zone would compile the rule table once per pour.
    const nets = zonePourNets(projection.board, projection.netNames ?? {});
    const out = { front: [] as FacePour[], back: [] as FacePour[] };
    // Only the two outer faces are visible on the 3D board; inner-layer zones
    // exist in the derivation but are buried in the substrate.
    for (const zone of zones) {
      if (zone.layer !== "F.Cu" && zone.layer !== "B.Cu") continue;
      const shapes = islandsToShapes(
        buildCopperFillIslands({
          ...common,
          ...pourParamsForZone(zone, designRules, keepouts, zones, nets),
        }).islands,
      );
      if (shapes.length === 0) continue;
      // Derivation order is fill order; the later pour on a face extrudes over
      // the earlier one, so reverse it (board plane down first, §5 precedence).
      (zone.layer === "F.Cu" ? out.front : out.back).unshift({
        id: zone.id,
        shapes,
      });
    }
    return out;
  }, [
    designRules,
    projection.board,
    projection.zones,
    projection.padNets,
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
      {poursByFace.front.map((pour) => (
        <PourLayer
          key={`front:${pour.id}`}
          shapes={pour.shapes}
          zMm={frontZ}
          fillColor={fillColor}
        />
      ))}
      {poursByFace.back.map((pour) => (
        <PourLayer
          key={`back:${pour.id}`}
          shapes={pour.shapes}
          zMm={backZ}
          fillColor={fillColor}
        />
      ))}
    </group>
  );
}
