import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type {
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbVia,
} from "../../../../../sdks";
import {
  PCB_DRILL_OUTLINE_COLOR,
  PCB_DRILL_OUTLINE_THICKNESS_MM,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";
import { collectDrills, type DrillInstance } from "../pcb-drills";

const MOUNTING_HOLE_THRESHOLD_MM = 1.5;
const MOUNTING_RING_THICKNESS_MM = 0.4;

interface DrillLayerProps {
  vias: ReadonlyArray<PcbVia>;
  placements: ReadonlyArray<PcbPlacedPart>;
  freeHoles?: ReadonlyArray<PcbFreeHole>;
  freePads?: ReadonlyArray<PcbFreePad>;
  selectedFreeHoleIds?: ReadonlySet<string>;
  /**
   * When true, draw a magenta annular ring on the silkscreen render order
   * around any drill larger than `MOUNTING_HOLE_THRESHOLD_MM`. Matches Flux's
   * "Top Overlay" mounting-hole halo convention (screenshot 16.39.34).
   */
  showMountingHoleRing?: boolean;
}

/**
 * DrillLayer — renders a thin lime-green outline around every PTH pad + via
 * drill. The actual hole is a real geometric cutout in the board substrate
 * (`BoardFill.ShapeGeometry.holes[]`), so the canvas background reads through.
 * This layer only paints the boundary ring.
 *
 * Mounting holes (drill ≥ 1.5 mm) additionally get a magenta annulus on the
 * top silkscreen render order to mark non-electrical mechanical holes.
 */
export function DrillLayer({
  vias,
  placements,
  freeHoles,
  freePads,
  selectedFreeHoleIds,
  showMountingHoleRing = true,
}: DrillLayerProps): ReactElement | null {
  const drills = useMemo(
    () => collectDrills(vias, placements, freeHoles, freePads),
    [vias, placements, freeHoles, freePads],
  );

  const mountingHoles = useMemo(
    () =>
      showMountingHoleRing
        ? drills.filter((d) => d.radiusMm * 2 >= MOUNTING_HOLE_THRESHOLD_MM)
        : [],
    [drills, showMountingHoleRing],
  );

  const selectedHoles = useMemo(
    () =>
      selectedFreeHoleIds && selectedFreeHoleIds.size > 0
        ? (freeHoles ?? []).filter((h) => selectedFreeHoleIds.has(h.id))
        : [],
    [freeHoles, selectedFreeHoleIds],
  );

  if (drills.length === 0) return null;
  return (
    <>
      <DrillOutlineRings drills={drills} />
      {mountingHoles.length > 0 ? (
        <MountingHoleRings holes={mountingHoles} />
      ) : null}
      {selectedHoles.map((hole) => (
        <SelectedHoleRing key={hole.id} hole={hole} />
      ))}
    </>
  );
}

/**
 * Per-drill `RingGeometry`. We cannot use `InstancedMesh` with a unit ring
 * because per-instance scale would warp ring thickness (`PCB_DRILL_OUTLINE_
 * THICKNESS_MM` must stay constant in mm regardless of drill size).
 */
function DrillOutlineRings({
  drills,
}: {
  drills: ReadonlyArray<DrillInstance>;
}): ReactElement {
  return (
    <group renderOrder={RENDER_ORDER.DRILL}>
      {drills.map((drill, i) => (
        <DrillOutlineRing key={i} drill={drill} />
      ))}
    </group>
  );
}

function DrillOutlineRing({ drill }: { drill: DrillInstance }): ReactElement {
  const geom = useMemo(
    () =>
      new THREE.RingGeometry(
        drill.radiusMm,
        drill.radiusMm + PCB_DRILL_OUTLINE_THICKNESS_MM,
        32,
      ),
    [drill.radiusMm],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      position={[drill.centerMm.x, drill.centerMm.y, 0]}
      renderOrder={RENDER_ORDER.DRILL}
    >
      <meshBasicMaterial
        color={PCB_DRILL_OUTLINE_COLOR}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        transparent={false}
      />
    </mesh>
  );
}

function MountingHoleRings({
  holes,
}: {
  holes: ReadonlyArray<DrillInstance>;
}): ReactElement {
  return (
    <group renderOrder={RENDER_ORDER.ANNULAR}>
      {holes.map((hole, i) => (
        <MountingHoleRing key={i} hole={hole} />
      ))}
    </group>
  );
}

const MOUNTING_HOLE_RING_COLOR = "#ec4899";
const SELECTED_HOLE_COLOR = "#facc15";

function SelectedHoleRing({ hole }: { hole: PcbFreeHole }): ReactElement {
  const r = hole.drillMm / 2;
  const geom = useMemo(
    () => new THREE.RingGeometry(r + 0.05, r + 0.35, 32),
    [r],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      position={[hole.centerMm.x, hole.centerMm.y, 0]}
      renderOrder={RENDER_ORDER.ANNULAR + 1}
    >
      <meshBasicMaterial
        color={SELECTED_HOLE_COLOR}
        transparent
        opacity={0.9}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function MountingHoleRing({ hole }: { hole: DrillInstance }): ReactElement {
  const geom = useMemo(
    () =>
      new THREE.RingGeometry(
        hole.radiusMm + 0.05,
        hole.radiusMm + 0.05 + MOUNTING_RING_THICKNESS_MM,
        32,
      ),
    [hole.radiusMm],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      position={[hole.centerMm.x, hole.centerMm.y, 0]}
      renderOrder={RENDER_ORDER.ANNULAR}
    >
      <meshBasicMaterial
        color={MOUNTING_HOLE_RING_COLOR}
        transparent
        opacity={0.92}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
